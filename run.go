package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// "mavescape run" scores a count table with a design without a window, for pipelines and CI
// (requirement M1): it starts MaveScape on a private port with no workspace library, opens it in
// a headless Chrome (or Chromium, Edge, Brave), performs the analysis through the same actions
// scripts use (actions.go), writes its files to a folder, and stops. It checks the table and the
// design first and scores nothing when something blocks scoring. run.json in the folder records
// what was read and written (with checksums), each step, the run and its QC. With --time (or
// SOURCE_DATE_EPOCH) every record carries that time and the same inputs write the same bytes.
// --from-workspace reruns a saved run from a workspace archive, and fails unless its scores
// reproduce exactly.
//
// "mavescape validate" checks tables, a design and parameters as scoring would, and says what
// blocks scoring (requirement M2).
//
// Exit status: 0 done; 1 the analysis could not be done or found a blocking problem (run.json
// says why); 2 the command line is wrong, an input is missing, outputs would be replaced, or no
// browser was found. Ported from CytoWeave 0.8.0's run.go.

const (
	runClient  = "mavescape run"
	exitFailed = 1
	exitUsage  = 2
	runFormat  = "mavescape-run"
)

// listFlag collects a flag given several times (--counts a.csv --counts b.csv) or with commas.
type listFlag []string

func (l *listFlag) String() string { return strings.Join(*l, ",") }
func (l *listFlag) Set(value string) error {
	for _, part := range strings.Split(value, ",") {
		if part = strings.TrimSpace(part); part != "" {
			*l = append(*l, part)
		}
	}
	return nil
}

// repeatFlag collects a flag given several times, each value whole (a reason may hold commas).
type repeatFlag []string

func (r *repeatFlag) String() string { return strings.Join(*r, "; ") }

func (r *repeatFlag) Set(value string) error {
	*r = append(*r, value)
	return nil
}

type runOptions struct {
	design     string
	counts     listFlag
	target     string
	out        string
	preset     string
	parameters string
	from       string
	run        string
	clock      string
	log        string
	overwrite  bool
	strict     bool
	// Findings expected here, each "id=reason": acknowledged before the QC is read.
	acknowledge repeatFlag
	chrome      string
	timeout     time.Duration
	dev         bool
	// Read from the files above.
	designJSON     json.RawMessage
	parametersJSON json.RawMessage
}

type runFile struct {
	Role   string `json:"role"`
	Path   string `json:"path"`
	Bytes  int64  `json:"bytes"`
	SHA256 string `json:"sha256"`
}

type runStepRecord struct {
	Action  string          `json:"action"`
	OK      bool            `json:"ok"`
	Message string          `json:"message"`
	Seconds float64         `json:"seconds"`
	Data    json.RawMessage `json:"data,omitempty"`
}

// run.json: format mavescape-run, version 1 (docs/FORMATS.md).
type runRecord struct {
	Format    string          `json:"format"`
	Version   int             `json:"version"`
	MaveScape string          `json:"mavescape"`
	Commit    string          `json:"commit,omitempty"`
	Command   []string        `json:"command"`
	Clock     string          `json:"clock,omitempty"`
	Browser   string          `json:"browser,omitempty"`
	Attempts  int             `json:"browserStarts,omitempty"`
	Started   string          `json:"started"`
	Finished  string          `json:"finished"`
	Seconds   float64         `json:"seconds"`
	OK        bool            `json:"ok"`
	Exit      int             `json:"exit"`
	Problems  []string        `json:"problems"`
	Inputs    []runFile       `json:"inputs"`
	Run       json.RawMessage `json:"run,omitempty"`
	QC        json.RawMessage `json:"qc,omitempty"`
	Steps     []runStepRecord `json:"steps"`
	Outputs   []runFile       `json:"outputs"`
}

// --- mavescape run ------------------------------------------------------------------------------

func runHeadless(args []string, stdout, stderr io.Writer) int {
	opts, err := parseRunArgs(args, stderr)
	if errors.Is(err, flag.ErrHelp) {
		return 0
	}
	if err != nil {
		fmt.Fprintln(stderr, "mavescape run:", err)
		return exitUsage
	}
	browser, err := chooseBrowser(opts.chrome)
	if err != nil {
		fmt.Fprintln(stderr, "mavescape run:", err)
		return exitUsage
	}
	log := newRunLog(opts.log, stdout, stderr)
	ctx, cancel := context.WithTimeout(context.Background(), opts.timeout)
	defer cancel()
	stopSignals := cancelOnSignal(cancel, stderr)
	defer stopSignals()

	record := runRecord{Format: runFormat, Version: 1, MaveScape: version, Commit: buildCommit(), Command: append([]string{"mavescape", "run"}, args...), Clock: opts.clock,
		Started: time.Now().UTC().Format(time.RFC3339), Problems: []string{}, Inputs: []runFile{}, Steps: []runStepRecord{}, Outputs: []runFile{}}
	for _, input := range runInputFiles(opts) {
		if f, err := describeFile(input[0], input[1]); err == nil {
			record.Inputs = append(record.Inputs, f)
		}
	}
	started := time.Now()
	exit := 0
	if err := os.MkdirAll(opts.out, 0o755); err != nil {
		record.Problems = append(record.Problems, err.Error())
		exit = exitFailed
	} else {
		exit = executeRun(ctx, opts, browser, &record, log)
	}
	record.Finished = time.Now().UTC().Format(time.RFC3339)
	record.Seconds = time.Since(started).Seconds()
	record.OK = exit == 0
	record.Exit = exit
	path := filepath.Join(opts.out, "run.json")
	if err := writeRunRecord(path, record); err != nil {
		log.problem("could not write run.json: " + err.Error())
		return exitFailed
	}
	log.done(record, path)
	return exit
}

func parseRunArgs(args []string, stderr io.Writer) (runOptions, error) {
	var opts runOptions
	flags := flag.NewFlagSet("mavescape run", flag.ContinueOnError)
	flags.SetOutput(stderr)
	flags.StringVar(&opts.design, "design", "", "the design (a mavescape-design JSON file, docs/FORMATS.md)")
	flags.Var(&opts.counts, "counts", "the count table, and for a table of barcodes its barcode-to-variant map (repeat, or separate with commas; or name them after the flags)")
	flags.StringVar(&opts.target, "target", "", "the target's sequence (FASTA), when the design does not hold it")
	flags.StringVar(&opts.out, "out", "", "the folder for the outputs (made if missing; must be empty unless --overwrite)")
	flags.StringVar(&opts.preset, "preset", "mavescape", "the parameters to start from: mavescape, enrich2, dimsum or vampseq")
	flags.StringVar(&opts.parameters, "parameters", "", "a JSON file of parameters to change from the preset (as the score action takes them)")
	flags.StringVar(&opts.from, "from-workspace", "", "rerun a run of a workspace archive (.msz) exactly, instead of scoring a table")
	flags.StringVar(&opts.run, "run", "", "with --from-workspace: the run by name or id (default: the latest)")
	flags.StringVar(&opts.clock, "time", "", "the time every record carries (ISO 8601), so that the same inputs write the same bytes (default: SOURCE_DATE_EPOCH if set, else now)")
	flags.StringVar(&opts.log, "log", "text", "progress as text or json (one JSON object per line)")
	flags.BoolVar(&opts.overwrite, "overwrite", false, "replace outputs already in the folder")
	flags.BoolVar(&opts.strict, "strict", false, "exit 1 when any quality-control finding fails and is not acknowledged (by default only a blocking one fails the run)")
	flags.Var(&opts.acknowledge, "acknowledge", "a finding expected here, as id=reason (\"coverage=error-prone PCR library\"): its status stays, the reason goes on the record, and --strict does not fail on it (repeatable)")
	flags.StringVar(&opts.chrome, "chrome", "", "the Chrome, Chromium, Edge or Brave to run in (default: CHROME, else one installed)")
	flags.DurationVar(&opts.timeout, "timeout", time.Hour, "stop a run that takes longer")
	flags.BoolVar(&opts.dev, "dev", false, "serve web/ from the working directory instead of the embedded copy")
	flags.Usage = func() {
		out := flags.Output()
		fmt.Fprintln(out, "Usage: mavescape run --design design.json --out results/ [flags] counts.csv [barcode-map.csv]")
		fmt.Fprintln(out, "       mavescape run --from-workspace analysis.msz [--run \"Run 1\"] --out results/ [flags]")
		fmt.Fprintln(out, "Scores a count table with its design without a window, and writes the scores, counts, QC, the")
		fmt.Fprintln(out, "differential scores between conditions, the map, the methods and references, the provenance,")
		fmt.Fprintln(out, "the workspace archive and run.json. Exit status: 0 done, 1 not done or a blocking problem (run.json")
		fmt.Fprintln(out, "says why), 2 a wrong command line, a missing input, outputs in the way, or no browser.")
		flags.PrintDefaults()
	}
	rest, err := parseArgs(flags, args)
	if err != nil {
		return opts, err
	}
	opts.counts = append(opts.counts, rest...)
	if opts.out == "" {
		return opts, errors.New("give --out, the folder for the outputs")
	}
	if opts.out, err = absPath(opts.out); err != nil {
		return opts, err
	}
	switch opts.log {
	case "text", "json":
	default:
		return opts, fmt.Errorf("--log is text or json, not %q", opts.log)
	}
	if opts.timeout <= 0 {
		return opts, errors.New("--timeout must be positive")
	}
	if _, err := acknowledgements(opts.acknowledge); err != nil {
		return opts, err
	}
	if opts.clock, err = runClock(opts.clock, os.Getenv("SOURCE_DATE_EPOCH")); err != nil {
		return opts, err
	}
	if opts.from != "" {
		if opts.design != "" || len(opts.counts) > 0 || opts.target != "" || opts.parameters != "" || opts.preset != "mavescape" {
			return opts, errors.New("--from-workspace reruns a saved run with its own table, design and parameters: give no --design, tables, --target, --preset or --parameters")
		}
		if opts.from, err = existingFile(opts.from); err != nil {
			return opts, err
		}
	} else {
		if opts.run != "" {
			return opts, errors.New("--run chooses a run of --from-workspace")
		}
		if opts.design == "" {
			return opts, errors.New("give --design (a mavescape-design JSON file), or --from-workspace")
		}
		if len(opts.counts) == 0 {
			return opts, errors.New("name the count table (and, for a table of barcodes, its barcode-to-variant map)")
		}
		if opts.design, err = existingFile(opts.design); err != nil {
			return opts, err
		}
		if opts.designJSON, err = readDesignFile(opts.design); err != nil {
			return opts, err
		}
		for i, path := range opts.counts {
			if opts.counts[i], err = existingFile(path); err != nil {
				return opts, err
			}
		}
		if opts.target != "" {
			if opts.target, err = existingFile(opts.target); err != nil {
				return opts, err
			}
		}
		if opts.parameters != "" {
			if opts.parameters, err = existingFile(opts.parameters); err != nil {
				return opts, err
			}
			if opts.parametersJSON, err = readJSONObject(opts.parameters, "parameters"); err != nil {
				return opts, err
			}
		}
	}
	if !opts.overwrite {
		if entries, err := os.ReadDir(opts.out); err == nil && len(entries) > 0 {
			return opts, fmt.Errorf("%s is not empty; give --overwrite to replace its outputs, or another --out", opts.out)
		}
	}
	return opts, nil
}

// runClock is the fixed time of a run: --time, else SOURCE_DATE_EPOCH (seconds since 1970, the
// reproducible-builds convention), else none (now).
func runClock(value, epoch string) (string, error) {
	if value != "" {
		t, err := time.Parse(time.RFC3339, value)
		if err != nil {
			return "", fmt.Errorf("--time %q is not ISO 8601 (such as 2026-10-09T12:00:00Z)", value)
		}
		return t.UTC().Format(time.RFC3339), nil
	}
	if epoch != "" {
		seconds, err := strconv.ParseInt(epoch, 10, 64)
		if err != nil || seconds < 0 {
			return "", fmt.Errorf("SOURCE_DATE_EPOCH %q is not a number of seconds", epoch)
		}
		return time.Unix(seconds, 0).UTC().Format(time.RFC3339), nil
	}
	return "", nil
}

func existingFile(path string) (string, error) {
	abs, err := absPath(path)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(abs)
	if err != nil {
		return "", fmt.Errorf("%s: %v", path, err)
	}
	if info.IsDir() {
		return "", fmt.Errorf("%s is a folder; name a file", path)
	}
	return abs, nil
}

func readJSONObject(path, what string) (json.RawMessage, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var object map[string]any
	if err := json.Unmarshal(data, &object); err != nil {
		return nil, fmt.Errorf("%s: the %s must be a JSON object: %v", path, what, err)
	}
	return json.RawMessage(data), nil
}

func readDesignFile(path string) (json.RawMessage, error) {
	data, err := readJSONObject(path, "design")
	if err != nil {
		return nil, err
	}
	var head struct {
		Format string `json:"format"`
	}
	if err := json.Unmarshal(data, &head); err != nil || head.Format != "mavescape-design" {
		return nil, fmt.Errorf("%s is not a MaveScape design (its format is not \"mavescape-design\"; docs/FORMATS.md)", path)
	}
	return data, nil
}

// The files a run reads, with their roles: [path, role].
func runInputFiles(opts runOptions) [][2]string {
	var files [][2]string
	if opts.from != "" {
		return append(files, [2]string{opts.from, "workspace"})
	}
	files = append(files, [2]string{opts.design, "design"})
	for i, path := range opts.counts {
		role := "counts"
		if i > 0 {
			role = "counts (part or map)"
		}
		files = append(files, [2]string{path, role})
	}
	if opts.target != "" {
		files = append(files, [2]string{opts.target, "target"})
	}
	if opts.parameters != "" {
		files = append(files, [2]string{opts.parameters, "parameters"})
	}
	return files
}

// runSummary is what the score and reproduce_run actions say of a run (web/ui/remote.js).
type runSummary struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	OutputSHA256 string   `json:"outputSha256"`
	Conditions   []string `json:"conditions"`
	Differential bool     `json:"comparesConditions"`
	Barcodes     bool     `json:"barcodes"`
	Map          bool     `json:"map"`
}

type qcOverall struct {
	Overall struct {
		Status         string         `json:"status"`
		Counts         map[string]int `json:"counts"`
		Blocking       []string       `json:"blocking"`
		Acknowledged   []string       `json:"acknowledged"`
		Unacknowledged map[string]int `json:"unacknowledged"`
	} `json:"overall"`
}

// acknowledgements reads --acknowledge values, "id=reason", in order.
func acknowledgements(values []string) ([][2]string, error) {
	var out [][2]string
	for _, v := range values {
		id, reason, ok := strings.Cut(v, "=")
		id, reason = strings.TrimSpace(id), strings.TrimSpace(reason)
		if !ok || id == "" || reason == "" {
			return nil, fmt.Errorf("--acknowledge takes a finding and the reason it is expected, as id=reason (%q)", v)
		}
		out = append(out, [2]string{id, reason})
	}
	return out, nil
}

// executeRun performs the analysis in a headless page and returns the exit status.
func executeRun(ctx context.Context, opts runOptions, browser string, record *runRecord, log *runLog) int {
	page, err := startHeadlessPage(ctx, browser, opts.dev, opts.clock)
	if err != nil {
		record.Problems = append(record.Problems, err.Error())
		log.problem(err.Error())
		return exitFailed
	}
	defer page.stop()
	record.Browser = filepath.Base(browser)
	record.Attempts = page.attempts
	log.started(filepath.Base(browser), opts.clock)
	steps := &runStepper{ctx: ctx, hub: page.hub, record: record, log: log, overwrite: opts.overwrite}

	// The table and its design, checked; or the workspace, its run reproduced.
	var summary runSummary
	if opts.from != "" {
		if _, ok := steps.do("open_files", map[string]any{"paths": []string{opts.from}}); !ok {
			return exitFailed
		}
		args := map[string]any{}
		if opts.run != "" {
			args["run"] = opts.run
		}
		data, ok := steps.do("reproduce_run", args)
		if !ok {
			return exitFailed
		}
		if err := json.Unmarshal(data, &summary); err != nil {
			record.Problems = append(record.Problems, "the run's summary could not be read: "+err.Error())
			return exitFailed
		}
		record.Run = data
	} else {
		// A workspace named after the design.
		var named struct {
			Name string `json:"name"`
		}
		json.Unmarshal(opts.designJSON, &named)
		if named.Name == "" {
			named.Name = "MaveScape run"
		}
		if _, ok := steps.do("new_workspace", map[string]any{"name": named.Name}); !ok {
			return exitFailed
		}
		paths := append([]string{}, opts.counts...)
		if opts.target != "" {
			paths = append(paths, opts.target)
		}
		if _, ok := steps.do("open_files", map[string]any{"paths": paths}); !ok {
			return exitFailed
		}
		if _, ok := steps.do("set_design", map[string]any{"design": opts.designJSON}); !ok {
			return exitFailed
		}
		scoring := map[string]any{"preset": opts.preset}
		if opts.parametersJSON != nil {
			scoring["parameters"] = opts.parametersJSON
		}
		data, ok := steps.do("check", scoring)
		if !ok {
			return exitFailed
		}
		var check struct {
			Valid    bool     `json:"valid"`
			Blocking []string `json:"blocking"`
		}
		json.Unmarshal(data, &check)
		if !check.Valid {
			record.Problems = append(record.Problems, check.Blocking...)
			log.problem("scoring is blocked: " + strings.Join(check.Blocking, " "))
			return exitFailed
		}
		data, ok = steps.do("score", scoring)
		if !ok {
			return exitFailed
		}
		if err := json.Unmarshal(data, &summary); err != nil {
			record.Problems = append(record.Problems, "the run's summary could not be read: "+err.Error())
			return exitFailed
		}
		record.Run = data
	}

	// Quality control: the findings expected here acknowledged first (a refusal, such as a finding
	// that is not there, stops the run), then read.
	acks, _ := acknowledgements(opts.acknowledge)
	for _, a := range acks {
		if _, ok := steps.do("acknowledge_finding", map[string]any{"finding": a[0], "reason": a[1], "run": summary.ID}); !ok {
			return exitFailed
		}
	}
	qcData, qcOK := steps.do("qc_findings", map[string]any{"run": summary.ID})
	var qc qcOverall
	if qcOK {
		record.QC = qcData
		json.Unmarshal(qcData, &qc)
	}

	// The files.
	out := func(name string) string { return filepath.Join(opts.out, name) }
	exports := []struct {
		what, file, condition string
	}{}
	if len(summary.Conditions) > 1 {
		used := map[string]bool{}
		for _, condition := range summary.Conditions {
			exports = append(exports, struct{ what, file, condition string }{"scores", "scores_" + safeFileName(condition, used) + ".csv", condition})
		}
	} else {
		exports = append(exports, struct{ what, file, condition string }{"scores", "scores.csv", ""})
	}
	exports = append(exports,
		struct{ what, file, condition string }{"counts", "counts.csv", ""},
		struct{ what, file, condition string }{"qc-samples", "qc_samples.csv", ""},
		struct{ what, file, condition string }{"qc-variants", "qc_variants.csv", ""},
		struct{ what, file, condition string }{"qc-findings", "qc_findings.csv", ""},
	)
	if summary.Barcodes {
		exports = append(exports, struct{ what, file, condition string }{"barcodes", "barcodes.csv", ""})
	}
	if summary.Differential {
		exports = append(exports, struct{ what, file, condition string }{"differential", "differential.csv", ""})
	}
	if summary.Map {
		exports = append(exports, struct{ what, file, condition string }{"map", "map.svg", ""})
	}
	exports = append(exports,
		struct{ what, file, condition string }{"provenance", "provenance.json", ""},
		struct{ what, file, condition string }{"methods", "methods.md", ""},
		struct{ what, file, condition string }{"references", "references.bib", ""},
		struct{ what, file, condition string }{"archive", "workspace.msz", ""},
	)
	failed := false
	for _, e := range exports {
		args := map[string]any{"what": e.what, "path": out(e.file)}
		if e.what != "archive" {
			args["run"] = summary.ID
		}
		if e.condition != "" {
			args["condition"] = e.condition
		}
		if _, ok := steps.do("export", args); !ok {
			failed = true
		}
	}

	switch {
	case failed || !qcOK:
		record.Problems = append(record.Problems, "Some outputs could not be written (see the steps).")
		return exitFailed
	case len(qc.Overall.Blocking) > 0:
		message := "quality control found blocking problems: " + strings.Join(qc.Overall.Blocking, ", ")
		record.Problems = append(record.Problems, message)
		log.problem(message)
		return exitFailed
	case opts.strict && qc.Overall.Unacknowledged["fail"] > 0:
		message := fmt.Sprintf("quality control: %d finding(s) fail (--strict)", qc.Overall.Unacknowledged["fail"])
		if acknowledged := qc.Overall.Counts["fail"] - qc.Overall.Unacknowledged["fail"]; acknowledged > 0 {
			message += fmt.Sprintf(", besides %d acknowledged", acknowledged)
		}
		record.Problems = append(record.Problems, message)
		log.problem(message)
		return exitFailed
	}
	return 0
}

var unsafeName = regexp.MustCompile(`[^A-Za-z0-9._-]+`)

// safeFileName makes a name part of a file name, unique among those used.
func safeFileName(name string, used map[string]bool) string {
	base := strings.Trim(unsafeName.ReplaceAllString(name, "_"), "_.")
	if base == "" {
		base = "condition"
	}
	candidate := base
	for n := 2; used[strings.ToLower(candidate)]; n++ {
		candidate = fmt.Sprintf("%s_%d", base, n)
	}
	used[strings.ToLower(candidate)] = true
	return candidate
}

// runStepper performs actions in the page one by one, recording each.
type runStepper struct {
	ctx       context.Context
	hub       *remoteHub
	record    *runRecord
	log       *runLog
	overwrite bool
	count     int
}

// do performs an action and returns its data, or false (recorded, logged) when it fails.
func (s *runStepper) do(action string, args map[string]any) (json.RawMessage, bool) {
	s.count++
	began := time.Now()
	if _, has := args["path"]; has && s.overwrite {
		args["overwrite"] = true
	}
	outcome, err := s.perform(action, args)
	entry := runStepRecord{Action: action, Seconds: time.Since(began).Seconds()}
	switch {
	case err != nil:
		entry.Message = err.Error()
	case !outcome.OK:
		entry.Message = outcome.Message
	default:
		entry.OK = true
		entry.Message = outcome.Message
		entry.Data = outcome.Data
	}
	if entry.OK {
		if path, _ := args["path"].(string); path != "" {
			role, _ := args["what"].(string)
			if f, err := describeFile(path, role); err == nil {
				s.record.Outputs = append(s.record.Outputs, f)
			}
		}
	}
	if !entry.OK && s.ctx.Err() != nil {
		entry.Message = "Not done: the run was interrupted or timed out. " + entry.Message
	}
	s.record.Steps = append(s.record.Steps, entry)
	s.log.step(s.count, entry)
	if !entry.OK {
		s.record.Problems = append(s.record.Problems, fmt.Sprintf("%s: %s", action, entry.Message))
	}
	return entry.Data, entry.OK
}

func (s *runStepper) perform(action string, args map[string]any) (remoteResult, error) {
	if s.ctx.Err() != nil {
		return remoteResult{}, s.ctx.Err()
	}
	encoded, err := json.Marshal(args)
	if err != nil {
		return remoteResult{}, err
	}
	event := remoteEvent{Action: action, Args: encoded, Client: runClient}
	if spec, ok := findAction(action); ok {
		if spec.output {
			output, release, err := s.hub.prepareOutput(encoded)
			if err != nil {
				return remoteResult{}, errors.New(strings.Replace(err.Error(), "pass overwrite: true", "give --overwrite", 1))
			}
			defer release()
			event.Output = output
		}
		if spec.reads {
			files, err := s.hub.openFiles(encoded)
			if err != nil {
				return remoteResult{}, err
			}
			event.Files = files
		}
	}
	return s.hub.dispatch(s.ctx, event)
}

// --- mavescape validate -------------------------------------------------------------------------

type validateOptions struct {
	design     string
	target     string
	preset     string
	parameters string
	json       bool
	chrome     string
	timeout    time.Duration
	dev        bool
	tables     []string

	designJSON     json.RawMessage
	parametersJSON json.RawMessage
}

func validateHeadless(args []string, stdout, stderr io.Writer) int {
	opts, err := parseValidateArgs(args, stderr)
	if errors.Is(err, flag.ErrHelp) {
		return 0
	}
	if err != nil {
		fmt.Fprintln(stderr, "mavescape validate:", err)
		return exitUsage
	}
	browser, err := chooseBrowser(opts.chrome)
	if err != nil {
		fmt.Fprintln(stderr, "mavescape validate:", err)
		return exitUsage
	}
	ctx, cancel := context.WithTimeout(context.Background(), opts.timeout)
	defer cancel()
	stopSignals := cancelOnSignal(cancel, stderr)
	defer stopSignals()
	report, err := performValidate(ctx, opts, browser)
	if err != nil {
		fmt.Fprintln(stderr, "mavescape validate:", err)
		return exitFailed
	}
	if opts.json {
		data, _ := json.MarshalIndent(report, "", "  ")
		fmt.Fprintln(stdout, string(data))
	} else {
		if report.Valid {
			fmt.Fprintln(stdout, report.Message)
		} else {
			fmt.Fprintf(stdout, "Not valid: %d problem(s) block scoring.\n", len(report.Blocking))
		}
		for _, problem := range report.Blocking {
			fmt.Fprintln(stdout, "  ✗", problem)
		}
		for _, warning := range report.Warnings {
			fmt.Fprintln(stdout, "  !", warning)
		}
	}
	if !report.Valid {
		return exitFailed
	}
	return 0
}

type validateReport struct {
	Valid    bool            `json:"valid"`
	Message  string          `json:"message"`
	Blocking []string        `json:"blocking"`
	Warnings []string        `json:"warnings"`
	Table    json.RawMessage `json:"table,omitempty"`
	Design   json.RawMessage `json:"design,omitempty"`
	Inputs   []runFile       `json:"inputs"`
}

func parseValidateArgs(args []string, stderr io.Writer) (validateOptions, error) {
	var opts validateOptions
	flags := flag.NewFlagSet("mavescape validate", flag.ContinueOnError)
	flags.SetOutput(stderr)
	flags.StringVar(&opts.design, "design", "", "a design to check (and to check the tables against)")
	flags.StringVar(&opts.target, "target", "", "the target's sequence (FASTA), to check variant names against when the design does not hold it")
	flags.StringVar(&opts.preset, "preset", "mavescape", "the preset whose parameters are checked against the design")
	flags.StringVar(&opts.parameters, "parameters", "", "a JSON file of parameters to check against the design")
	flags.BoolVar(&opts.json, "json", false, "print the report as JSON")
	flags.StringVar(&opts.chrome, "chrome", "", "the Chrome, Chromium, Edge or Brave to run in (default: CHROME, else one installed)")
	flags.DurationVar(&opts.timeout, "timeout", 10*time.Minute, "give up after this long")
	flags.BoolVar(&opts.dev, "dev", false, "serve web/ from the working directory instead of the embedded copy")
	flags.Usage = func() {
		out := flags.Output()
		fmt.Fprintln(out, "Usage: mavescape validate [--design design.json] [--target target.fasta] [flags] [count or score tables...]")
		fmt.Fprintln(out, "Checks tables, a design and parameters as scoring would, and says what blocks scoring.")
		fmt.Fprintln(out, "Exit status: 0 valid, 1 not valid, 2 a wrong command line, a missing file or no browser.")
		flags.PrintDefaults()
	}
	tables, err := parseArgs(flags, args)
	if err != nil {
		return opts, err
	}
	if len(tables) == 0 && opts.design == "" {
		return opts, errors.New("name a table to check, give --design, or both")
	}
	for _, path := range tables {
		abs, err := existingFile(path)
		if err != nil {
			return opts, err
		}
		opts.tables = append(opts.tables, abs)
	}
	if opts.design != "" {
		if opts.design, err = existingFile(opts.design); err != nil {
			return opts, err
		}
		if opts.designJSON, err = readDesignFile(opts.design); err != nil {
			return opts, err
		}
	}
	if opts.target != "" {
		if opts.target, err = existingFile(opts.target); err != nil {
			return opts, err
		}
	}
	if opts.parameters != "" {
		if opts.parameters, err = existingFile(opts.parameters); err != nil {
			return opts, err
		}
		if opts.parametersJSON, err = readJSONObject(opts.parameters, "parameters"); err != nil {
			return opts, err
		}
	}
	if opts.timeout <= 0 {
		return opts, errors.New("--timeout must be positive")
	}
	return opts, nil
}

func performValidate(ctx context.Context, opts validateOptions, browser string) (validateReport, error) {
	report := validateReport{Blocking: []string{}, Warnings: []string{}, Inputs: []runFile{}}
	for _, path := range opts.tables {
		if f, err := describeFile(path, "table"); err == nil {
			report.Inputs = append(report.Inputs, f)
		}
	}
	for _, input := range [][2]string{{opts.design, "design"}, {opts.target, "target"}, {opts.parameters, "parameters"}} {
		if input[0] != "" {
			if f, err := describeFile(input[0], input[1]); err == nil {
				report.Inputs = append(report.Inputs, f)
			}
		}
	}
	page, err := startHeadlessPage(ctx, browser, opts.dev, "")
	if err != nil {
		return report, err
	}
	defer page.stop()
	ask := func(action string, args map[string]any) (remoteResult, error) {
		encoded, err := json.Marshal(args)
		if err != nil {
			return remoteResult{}, err
		}
		event := remoteEvent{Action: action, Args: encoded, Client: "mavescape validate"}
		if spec, ok := findAction(action); ok && spec.reads {
			files, err := page.hub.openFiles(encoded)
			if err != nil {
				return remoteResult{}, err
			}
			event.Files = files
		}
		return page.hub.dispatch(ctx, event)
	}
	if len(opts.tables) > 0 {
		paths := append([]string{}, opts.tables...)
		if opts.target != "" {
			paths = append(paths, opts.target)
		}
		opened, err := ask("open_files", map[string]any{"paths": paths})
		if err != nil {
			return report, err
		}
		if !opened.OK {
			report.Message = "Not valid: " + opened.Message
			report.Blocking = append(report.Blocking, opened.Message)
			return report, nil
		}
	}
	args := map[string]any{"preset": opts.preset}
	if opts.designJSON != nil {
		args["design"] = opts.designJSON
	}
	if opts.parametersJSON != nil {
		args["parameters"] = opts.parametersJSON
	}
	checked, err := ask("check", args)
	if err != nil {
		return report, err
	}
	if !checked.OK {
		report.Message = "Not valid: " + checked.Message
		report.Blocking = append(report.Blocking, checked.Message)
		return report, nil
	}
	var data struct {
		Valid    bool            `json:"valid"`
		Blocking []string        `json:"blocking"`
		Warnings []string        `json:"warnings"`
		Table    json.RawMessage `json:"table"`
		Design   json.RawMessage `json:"design"`
	}
	if err := json.Unmarshal(checked.Data, &data); err != nil {
		return report, fmt.Errorf("the check's answer could not be read: %v", err)
	}
	report.Valid = data.Valid
	report.Message = checked.Message
	report.Blocking = append(report.Blocking, data.Blocking...)
	report.Warnings = append(report.Warnings, data.Warnings...)
	if string(data.Table) != "null" {
		report.Table = data.Table
	}
	if string(data.Design) != "null" {
		report.Design = data.Design
	}
	return report, nil
}

// --- The headless page --------------------------------------------------------------------------

type headlessPage struct {
	hub  *remoteHub
	stop func()
	// How many browsers were started before one's page connected.
	attempts int
}

func chooseBrowser(flagValue string) (string, error) {
	browser := flagValue
	if browser == "" {
		browser = os.Getenv("CHROME")
	}
	if browser == "" {
		browser = findChromium()
	}
	if browser == "" {
		return "", errors.New("it runs in Chrome, Chromium, Edge or Brave, and none was found (give --chrome PATH or set CHROME)")
	}
	return browser, nil
}

// startHeadlessPage starts MaveScape on a private port with remote control and a workspace
// library of its own in a temporary folder (not the user's, and not the browser's storage), opens
// it in a headless browser with its own temporary profile (with ?clock= when the run's time is
// fixed), and waits for the page to connect; stop ends both and removes the folder. A browser
// whose page has not connected within pageAttempt is replaced, up to three times (a fresh
// profile's first start is occasionally slow).
func startHeadlessPage(ctx context.Context, browser string, dev bool, clock string) (*headlessPage, error) {
	scratch, err := os.MkdirTemp("", "mavescape-run-")
	if err != nil {
		return nil, err
	}
	cfg := config{host: "127.0.0.1", port: 0, window: "none", remote: true, dev: dev, dataDir: filepath.Join(scratch, "library")}
	running, err := start(cfg, io.Discard)
	if err != nil {
		os.RemoveAll(scratch)
		return nil, err
	}
	go running.serve()
	address := running.url + "/"
	if clock != "" {
		address += "?clock=" + url.QueryEscape(clock)
	}
	hub := running.app.control
	var chrome *exec.Cmd
	var exited chan struct{}
	kill := func() {
		if chrome != nil && chrome.Process != nil {
			chrome.Process.Kill()
			select {
			case <-exited:
			case <-time.After(5 * time.Second):
			}
		}
	}
	stop := func() {
		kill()
		running.stop(3 * time.Second)
		os.RemoveAll(scratch)
	}
	for attempt := 1; ; attempt++ {
		chrome = exec.CommandContext(ctx, browser,
			"--headless=new",
			"--user-data-dir="+filepath.Join(scratch, fmt.Sprintf("profile-%d", attempt)),
			"--no-first-run",
			"--no-default-browser-check",
			"--disable-extensions",
			"--disable-sync",
			"--disable-background-networking",
			"--disable-component-update",
			"--disable-features=Translate,MediaRouter,OptimizationHints",
			// macOS: no Keychain ("Chrome Safe Storage"), which a new profile may wait on.
			"--use-mock-keychain",
			"--password-store=basic",
			"--window-size=1600,1000",
			address,
		)
		if err := chrome.Start(); err != nil {
			running.stop(3 * time.Second)
			os.RemoveAll(scratch)
			return nil, fmt.Errorf("could not start %s: %v", browser, err)
		}
		exited = make(chan struct{})
		go func(cmd *exec.Cmd, done chan struct{}) {
			cmd.Wait()
			close(done)
		}(chrome, exited)
		if hub.waitForPage(ctx, pageAttempt) {
			return &headlessPage{hub: hub, stop: stop, attempts: attempt}, nil
		}
		kill()
		if ctx.Err() != nil || attempt == 3 {
			running.stop(3 * time.Second)
			os.RemoveAll(scratch)
			return nil, fmt.Errorf("the page did not start in %s (%d attempts)", filepath.Base(browser), attempt)
		}
	}
}

// How long a browser's page has to connect before the browser is replaced.
const pageAttempt = 20 * time.Second

// waitForPage waits until a page has connected to the hub.
func (h *remoteHub) waitForPage(ctx context.Context, limit time.Duration) bool {
	deadline := time.NewTimer(limit)
	defer deadline.Stop()
	for {
		h.mu.Lock()
		has := len(h.clients) > 0
		connected := h.connected
		h.mu.Unlock()
		if has {
			return true
		}
		select {
		case <-connected:
		case <-ctx.Done():
			return false
		case <-deadline.C:
			return false
		}
	}
}

func cancelOnSignal(cancel context.CancelFunc, stderr io.Writer) func() {
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt, syscall.SIGTERM)
	done := make(chan struct{})
	go func() {
		select {
		case <-signals:
			fmt.Fprintln(stderr, "mavescape: interrupted")
			cancel()
		case <-done:
		}
	}()
	return func() {
		signal.Stop(signals)
		close(done)
	}
}

// --- Records and the log ------------------------------------------------------------------------

func describeFile(path, role string) (runFile, error) {
	file, err := os.Open(path)
	if err != nil {
		return runFile{}, err
	}
	defer file.Close()
	hash := sha256.New()
	n, err := io.Copy(hash, file)
	if err != nil {
		return runFile{}, err
	}
	return runFile{Role: role, Path: path, Bytes: n, SHA256: hex.EncodeToString(hash.Sum(nil))}, nil
}

func writeRunRecord(path string, record runRecord) error {
	data, err := json.MarshalIndent(record, "", "  ")
	if err != nil {
		return err
	}
	_, err = writeOutput(path, true, strings.NewReader(string(data)+"\n"))
	return err
}

// runLog writes the run's progress: lines of text, or one JSON object per line (--log json).
type runLog struct {
	json   bool
	stdout io.Writer
	stderr io.Writer
}

func newRunLog(mode string, stdout, stderr io.Writer) *runLog {
	return &runLog{json: mode == "json", stdout: stdout, stderr: stderr}
}

func (l *runLog) emit(fields map[string]any) {
	fields["time"] = time.Now().UTC().Format(time.RFC3339Nano)
	data, _ := json.Marshal(fields)
	fmt.Fprintln(l.stdout, string(data))
}

func (l *runLog) started(browser, clock string) {
	if l.json {
		fields := map[string]any{"level": "info", "event": "start", "mavescape": version, "browser": browser}
		if clock != "" {
			fields["clock"] = clock
		}
		l.emit(fields)
		return
	}
	suffix := ""
	if clock != "" {
		suffix = ", every record at " + clock
	}
	fmt.Fprintf(l.stdout, "MaveScape %s: running in %s%s\n", version, browser, suffix)
}

func (l *runLog) step(n int, entry runStepRecord) {
	if l.json {
		level := "info"
		if !entry.OK {
			level = "error"
		}
		l.emit(map[string]any{"level": level, "event": "step", "step": n, "action": entry.Action, "ok": entry.OK, "seconds": entry.Seconds, "message": entry.Message})
		return
	}
	status := "ok"
	if !entry.OK {
		status = "FAILED"
	}
	fmt.Fprintf(l.stdout, "[%d] %s: %s (%.1f s) %s\n", n, entry.Action, status, entry.Seconds, firstSentence(entry.Message))
}

func (l *runLog) problem(message string) {
	if l.json {
		l.emit(map[string]any{"level": "error", "event": "problem", "message": message})
		return
	}
	fmt.Fprintln(l.stderr, "mavescape run:", message)
}

func (l *runLog) done(record runRecord, path string) {
	if l.json {
		l.emit(map[string]any{"level": "info", "event": "done", "ok": record.OK, "exit": record.Exit, "seconds": record.Seconds, "outputs": len(record.Outputs), "record": path})
		return
	}
	if record.OK {
		fmt.Fprintf(l.stdout, "Done in %.1f s: %d files written to %s (run.json lists them).\n", record.Seconds, len(record.Outputs), filepath.Dir(path))
		return
	}
	fmt.Fprintf(l.stderr, "mavescape run: not done (exit %d) after %.1f s; %s says why.\n", record.Exit, record.Seconds, path)
}

// The first sentence of a message, for the progress lines.
func firstSentence(message string) string {
	message = strings.TrimSpace(strings.SplitN(message, "\n", 2)[0])
	if i := strings.Index(message, ". "); i > 0 && i < 200 {
		return message[:i+1]
	}
	if len(message) > 200 {
		return message[:197] + "…"
	}
	return message
}
