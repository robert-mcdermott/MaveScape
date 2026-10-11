package main

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// "mavescape export" writes a run of a saved workspace as files, without a window (requirement M2,
// wave 3 slice 4): as a MaveDB deposit (--format mavedb: the scores, counts, column descriptions,
// experiment and score set as MaveDB takes them, web/lib/mavedb-export.js) or as MaveScape's
// tables (--format tables: the files mavescape run writes). Like run, it opens the archive in a
// headless page and performs the actions scripts use (actions.go); export.json in the folder records
// what was read, done and written. --details sets the MaveDB details first (set_mavedb_details).
//
// Exit status: 0 written; 1 not written, or (--strict) a deposit lacking something MaveDB
// requires; 2 the command line is wrong, an input is missing, outputs are in the way, or no browser
// was found.

const (
	exportFormat = "mavescape-export"
	exportClient = "mavescape export"
)

type exportOptions struct {
	format    string
	workspace string
	out       string
	run       string
	condition string
	details   string
	clock     string
	log       string
	overwrite bool
	strict    bool
	chrome    string
	timeout   time.Duration
	dev       bool
	// Read from --details.
	detailsJSON json.RawMessage
}

func exportHeadless(args []string, stdout, stderr io.Writer) int {
	opts, err := parseExportArgs(args, stderr)
	if errors.Is(err, flag.ErrHelp) {
		return 0
	}
	if err != nil {
		fmt.Fprintln(stderr, "mavescape export:", err)
		return exitUsage
	}
	browser, err := chooseBrowser(opts.chrome)
	if err != nil {
		fmt.Fprintln(stderr, "mavescape export:", err)
		return exitUsage
	}
	log := newRunLog(opts.log, stdout, stderr)
	log.command, log.recordName = "export", "export.json"
	ctx, cancel := context.WithTimeout(context.Background(), opts.timeout)
	defer cancel()
	stopSignals := cancelOnSignal(cancel, stderr)
	defer stopSignals()

	record := runRecord{Format: exportFormat, Version: 1, MaveScape: version, Commit: buildCommit(), Command: append([]string{"mavescape", "export"}, args...), Clock: opts.clock,
		Started: time.Now().UTC().Format(time.RFC3339), Problems: []string{}, Inputs: []runFile{}, Steps: []runStepRecord{}, Outputs: []runFile{}}
	for _, input := range [][2]string{{opts.workspace, "workspace"}, {opts.details, "details"}} {
		if input[0] == "" {
			continue
		}
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
		exit = executeExport(ctx, opts, browser, &record, log)
	}
	record.Finished = time.Now().UTC().Format(time.RFC3339)
	record.Seconds = time.Since(started).Seconds()
	record.OK = exit == 0
	record.Exit = exit
	path := filepath.Join(opts.out, "export.json")
	if err := writeRunRecord(path, record); err != nil {
		log.problem("could not write export.json: " + err.Error())
		return exitFailed
	}
	log.done(record, path)
	return exit
}

func parseExportArgs(args []string, stderr io.Writer) (exportOptions, error) {
	var opts exportOptions
	flags := flag.NewFlagSet("mavescape export", flag.ContinueOnError)
	flags.SetOutput(stderr)
	flags.StringVar(&opts.format, "format", "mavedb", "mavedb (a MaveDB deposit) or tables (MaveScape's tables, as mavescape run writes them)")
	flags.StringVar(&opts.out, "out", "", "the folder for the files (made if missing; must be empty unless --overwrite)")
	flags.StringVar(&opts.run, "run", "", "the run by name or id (default: the latest)")
	flags.StringVar(&opts.condition, "condition", "", "mavedb: the condition, by name or number (default: each, in a folder of its own)")
	flags.StringVar(&opts.details, "details", "", "mavedb: a JSON file of MaveDB details to set first (title, abstract, license, publications…; docs/FORMATS.md)")
	flags.StringVar(&opts.clock, "time", "", "the time every record carries (ISO 8601), so that the same inputs write the same bytes (default: SOURCE_DATE_EPOCH if set, else now)")
	flags.StringVar(&opts.log, "log", "text", "progress as text or json (one JSON object per line)")
	flags.BoolVar(&opts.overwrite, "overwrite", false, "replace files already in the folder")
	flags.BoolVar(&opts.strict, "strict", false, "mavedb: exit 1 when the deposit lacks something MaveDB requires (an abstract, a license…)")
	flags.StringVar(&opts.chrome, "chrome", "", "the Chrome, Chromium, Edge or Brave to run in (default: CHROME, else one installed)")
	flags.DurationVar(&opts.timeout, "timeout", 30*time.Minute, "stop an export that takes longer")
	flags.BoolVar(&opts.dev, "dev", false, "serve web/ from the working directory instead of the embedded copy")
	flags.Usage = func() {
		out := flags.Output()
		fmt.Fprintln(out, "Usage: mavescape export --format mavedb --out deposit/ [flags] analysis.msz")
		fmt.Fprintln(out, "       mavescape export --format tables --out tables/ [flags] analysis.msz")
		fmt.Fprintln(out, "Writes a run of a saved workspace without a window: as a MaveDB deposit (the scores, counts,")
		fmt.Fprintln(out, "column descriptions, experiment and score set as MaveDB takes them; nothing is sent), or as")
		fmt.Fprintln(out, "MaveScape's tables. export.json records what was written. Exit status: 0 written, 1 not written")
		fmt.Fprintln(out, "(or, with --strict, a deposit lacking what MaveDB requires), 2 a wrong command line, a missing")
		fmt.Fprintln(out, "input, outputs in the way, or no browser.")
		flags.PrintDefaults()
	}
	rest, err := parseArgs(flags, args)
	if err != nil {
		return opts, err
	}
	switch opts.format {
	case "mavedb", "tables":
	default:
		return opts, fmt.Errorf("--format is mavedb or tables, not %q", opts.format)
	}
	if len(rest) != 1 {
		return opts, errors.New("name one workspace archive (.msz)")
	}
	if opts.workspace, err = existingFile(rest[0]); err != nil {
		return opts, err
	}
	if !strings.HasSuffix(strings.ToLower(opts.workspace), ".msz") {
		return opts, fmt.Errorf("%s is not a workspace archive (.msz)", opts.workspace)
	}
	if opts.out == "" {
		return opts, errors.New("give --out, the folder for the files")
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
	if opts.clock, err = runClock(opts.clock, os.Getenv("SOURCE_DATE_EPOCH")); err != nil {
		return opts, err
	}
	if opts.format == "tables" && (opts.details != "" || opts.condition != "" || opts.strict) {
		return opts, errors.New("--details, --condition and --strict are for --format mavedb (the tables hold every condition)")
	}
	if opts.details != "" {
		if opts.details, err = existingFile(opts.details); err != nil {
			return opts, err
		}
		if opts.detailsJSON, err = readJSONObject(opts.details, "MaveDB details"); err != nil {
			return opts, err
		}
	}
	if !opts.overwrite {
		if entries, err := os.ReadDir(opts.out); err == nil && len(entries) > 0 {
			return opts, fmt.Errorf("%s is not empty; give --overwrite to replace its files, or another --out", opts.out)
		}
	}
	return opts, nil
}

// depositSummary is what the mavedb_deposit action says of a deposit (web/ui/remote.js).
type depositSummary struct {
	Run        string   `json:"run"`
	Condition  string   `json:"condition"`
	Conditions []string `json:"conditions"`
	Mode       string   `json:"mode"`
	Missing    []struct {
		Field string `json:"field"`
		Text  string `json:"text"`
	} `json:"missing"`
}

// executeExport performs the export in a headless page and returns the exit status.
func executeExport(ctx context.Context, opts exportOptions, browser string, record *runRecord, log *runLog) int {
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
	steps := &runStepper{ctx: ctx, hub: page.hub, record: record, log: log, overwrite: opts.overwrite, client: exportClient}

	if _, ok := steps.do("open_files", map[string]any{"paths": []string{opts.workspace}}); !ok {
		return exitFailed
	}
	if opts.format == "tables" {
		args := map[string]any{}
		if opts.run != "" {
			args["run"] = opts.run
		}
		data, ok := steps.do("reproduce_run", args)
		if !ok {
			return exitFailed
		}
		var summary runSummary
		if err := json.Unmarshal(data, &summary); err != nil {
			record.Problems = append(record.Problems, "the run's summary could not be read: "+err.Error())
			return exitFailed
		}
		record.Run = data
		failed := false
		for _, e := range tableExports(summary) {
			args := map[string]any{"what": e.what, "path": filepath.Join(opts.out, e.file), "run": summary.ID}
			if e.condition != "" {
				args["condition"] = e.condition
			}
			if _, ok := steps.do("export", args); !ok {
				failed = true
			}
		}
		if failed {
			record.Problems = append(record.Problems, "Some files could not be written (see the steps).")
			return exitFailed
		}
		return 0
	}

	// A MaveDB deposit: the details first, then what the deposit holds and lacks, then its files.
	if opts.detailsJSON != nil {
		if _, ok := steps.do("set_mavedb_details", map[string]any{"details": opts.detailsJSON}); !ok {
			return exitFailed
		}
	}
	args := map[string]any{}
	if opts.run != "" {
		args["run"] = opts.run
	}
	if opts.condition != "" {
		args["condition"] = opts.condition
	}
	data, ok := steps.do("mavedb_deposit", args)
	if !ok {
		return exitFailed
	}
	record.Deposit = data
	var first depositSummary
	if err := json.Unmarshal(data, &first); err != nil {
		record.Problems = append(record.Problems, "the deposit's summary could not be read: "+err.Error())
		return exitFailed
	}
	// One deposit per condition (MaveDB keeps each as a score set), each in a folder of its own when
	// there are several.
	conditions := []string{first.Condition}
	if opts.condition == "" && len(first.Conditions) > 1 {
		conditions = first.Conditions
	}
	missing := len(first.Missing)
	used := map[string]bool{}
	for _, condition := range conditions {
		dir := opts.out
		if len(conditions) > 1 {
			dir = filepath.Join(opts.out, safeFileName(condition, used))
		}
		if err := writeDeposit(steps, opts, record, dir, condition, len(first.Conditions) > 1); err != nil {
			record.Problems = append(record.Problems, err.Error())
			log.problem(err.Error())
			return exitFailed
		}
	}
	if missing > 0 {
		texts := make([]string, len(first.Missing))
		for i, m := range first.Missing {
			texts[i] = m.Text
		}
		message := "MaveDB requires what the workspace lacks: " + strings.Join(texts, " ")
		if opts.strict {
			record.Problems = append(record.Problems, message+" (--strict)")
			log.problem(message)
			return exitFailed
		}
		log.problem(message + " The files are written; README.md says what to give.")
	}
	return 0
}

// writeDeposit writes one condition's deposit: the ZIP the export action makes, unpacked into dir.
func writeDeposit(steps *runStepper, opts exportOptions, record *runRecord, dir, condition string, named bool) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	archive := filepath.Join(dir, ".mavedb-deposit.zip")
	defer os.Remove(archive)
	args := map[string]any{"what": "mavedb", "path": archive, "overwrite": true}
	if opts.run != "" {
		args["run"] = opts.run
	}
	if named {
		args["condition"] = condition
	}
	before := len(record.Outputs)
	if _, ok := steps.do("export", args); !ok {
		return errors.New("the deposit could not be written (see the steps)")
	}
	// The ZIP is a step's output only on the way: its files are the outputs.
	record.Outputs = record.Outputs[:before]
	data, err := os.ReadFile(archive)
	if err != nil {
		return err
	}
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return fmt.Errorf("the deposit is not a ZIP: %w", err)
	}
	for _, entry := range reader.File {
		name := entry.Name
		if name == "" || strings.ContainsAny(name, `/\`) || name == "." || name == ".." || entry.FileInfo().IsDir() {
			return fmt.Errorf("the deposit holds an unexpected entry %q", name)
		}
		rc, err := entry.Open()
		if err != nil {
			return err
		}
		path := filepath.Join(dir, name)
		_, err = writeOutput(path, opts.overwrite, io.LimitReader(rc, 1<<31))
		rc.Close()
		if err != nil {
			return err
		}
		if f, err := describeFile(path, "mavedb"); err == nil {
			record.Outputs = append(record.Outputs, f)
		}
	}
	return nil
}
