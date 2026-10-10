package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeFile(t *testing.T, dir, name, text string) string {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestRunArguments(t *testing.T) {
	dir := t.TempDir()
	design := writeFile(t, dir, "design.json", `{"format": "mavescape-design", "version": 1, "name": "toy"}`)
	notDesign := writeFile(t, dir, "other.json", `{"format": "something-else"}`)
	counts := writeFile(t, dir, "counts.csv", "hgvs_pro,a,b\np.=,1,2\n")
	barcodeMap := writeFile(t, dir, "map.csv", "barcode,hgvs_pro\nAAA,p.=\n")
	params := writeFile(t, dir, "params.json", `{"combination": "fixed"}`)
	notObject := writeFile(t, dir, "list.json", `[1, 2]`)
	out := filepath.Join(dir, "out")
	full := filepath.Join(dir, "full")
	os.MkdirAll(full, 0o755)
	writeFile(t, full, "scores.csv", "x")
	archive := writeFile(t, dir, "analysis.msz", "PK")

	parse := func(args ...string) (runOptions, error) {
		var stderr bytes.Buffer
		return parseRunArgs(args, &stderr)
	}
	opts, err := parse("--design", design, "--out", out, counts, "--counts", barcodeMap, "--parameters", params)
	if err != nil {
		t.Fatal(err)
	}
	if len(opts.counts) != 2 || opts.counts[0] != barcodeMap || opts.counts[1] != counts {
		t.Errorf("tables: %v (flags first, then the names after them)", opts.counts)
	}
	if string(opts.parametersJSON) != `{"combination": "fixed"}` || !strings.Contains(string(opts.designJSON), "toy") {
		t.Errorf("files read: %s, %s", opts.parametersJSON, opts.designJSON)
	}
	if opts.preset != "mavescape" || opts.log != "text" || opts.clock != "" {
		t.Errorf("defaults: preset %q, log %q, clock %q", opts.preset, opts.log, opts.clock)
	}

	refused := []struct {
		args []string
		want string
	}{
		{[]string{"--design", design, counts}, "give --out"},
		{[]string{"--out", out, counts}, "give --design"},
		{[]string{"--design", design, "--out", out}, "name the count table"},
		{[]string{"--design", notDesign, "--out", out, counts}, "not a MaveScape design"},
		{[]string{"--design", design, "--out", out, "--parameters", notObject, counts}, "must be a JSON object"},
		{[]string{"--design", design, "--out", out, filepath.Join(dir, "missing.csv")}, "missing.csv"},
		{[]string{"--design", design, "--out", out, "--log", "xml", counts}, "--log is text or json"},
		{[]string{"--design", design, "--out", out, "--time", "yesterday", counts}, "not ISO 8601"},
		{[]string{"--design", design, "--out", full, counts}, "is not empty"},
		{[]string{"--from-workspace", archive, "--design", design, "--out", out}, "give no --design"},
		{[]string{"--design", design, "--out", out, "--run", "Run 1", counts}, "--run chooses a run of --from-workspace"},
	}
	for _, c := range refused {
		if _, err := parse(c.args...); err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("%v: got %v, want an error with %q", c.args, err, c.want)
		}
	}
	if _, err := parse("--design", design, "--out", full, "--overwrite", counts); err != nil {
		t.Errorf("--overwrite allows a folder with outputs: %v", err)
	}
	if opts, err := parse("--from-workspace", archive, "--run", "Run 2", "--out", out); err != nil || opts.from != archive || opts.run != "Run 2" {
		t.Errorf("--from-workspace: %v, %+v", err, opts)
	}
}

func TestRunClock(t *testing.T) {
	cases := []struct{ flag, epoch, want string }{
		{"2026-10-09T12:00:00Z", "", "2026-10-09T12:00:00Z"},
		{"2026-10-09T14:00:00+02:00", "", "2026-10-09T12:00:00Z"},
		{"", "1791547200", "2026-10-09T12:00:00Z"},
		{"2026-01-01T00:00:00Z", "1791547200", "2026-01-01T00:00:00Z"},
		{"", "", ""},
	}
	for _, c := range cases {
		got, err := runClock(c.flag, c.epoch)
		if err != nil || got != c.want {
			t.Errorf("runClock(%q, %q) = %q, %v; want %q", c.flag, c.epoch, got, err, c.want)
		}
	}
	if _, err := runClock("", "soon"); err == nil {
		t.Error("SOURCE_DATE_EPOCH that is not a number is refused")
	}
}

func TestSafeFileName(t *testing.T) {
	used := map[string]bool{}
	got := []string{safeFileName("Without ligand", used), safeFileName("With ligand", used), safeFileName("without ligand", used), safeFileName("…", used)}
	want := []string{"Without_ligand", "With_ligand", "without_ligand_2", "condition"}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("safeFileName: %v, want %v", got, want)
			break
		}
	}
}

func TestValidateArguments(t *testing.T) {
	dir := t.TempDir()
	design := writeFile(t, dir, "design.json", `{"format": "mavescape-design"}`)
	counts := writeFile(t, dir, "counts.csv", "hgvs_pro,a\n")
	var stderr bytes.Buffer
	if _, err := parseValidateArgs(nil, &stderr); err == nil || !strings.Contains(err.Error(), "name a table") {
		t.Errorf("nothing to check: %v", err)
	}
	opts, err := parseValidateArgs([]string{"--json", counts, "--design", design}, &stderr)
	if err != nil || !opts.json || len(opts.tables) != 1 || opts.designJSON == nil {
		t.Errorf("validate: %v, %+v", err, opts)
	}
	if opts, err := parseValidateArgs([]string{"--design", design}, &stderr); err != nil || len(opts.tables) != 0 {
		t.Errorf("a design alone: %v", err)
	}
}

func TestHeadlessCommandsWithoutABrowser(t *testing.T) {
	dir := t.TempDir()
	design := writeFile(t, dir, "design.json", `{"format": "mavescape-design"}`)
	counts := writeFile(t, dir, "counts.csv", "hgvs_pro,a\n")
	var stdout, stderr bytes.Buffer
	if code := runHeadless([]string{"--design", design, "--out", filepath.Join(dir, "out"), "--chrome", filepath.Join(dir, "no-browser"), counts}, &stdout, &stderr); code != exitFailed {
		// The browser named does not exist: the page cannot start, and run.json says so.
		t.Errorf("a browser that does not start: exit %d (%s)", code, stderr.String())
	}
	record, err := os.ReadFile(filepath.Join(dir, "out", "run.json"))
	if err != nil || !strings.Contains(string(record), `"exit": 1`) || !strings.Contains(string(record), "could not start") {
		t.Errorf("run.json: %v %s", err, record)
	}
	if code := runHeadless([]string{"--out", filepath.Join(dir, "out2")}, &stdout, &stderr); code != exitUsage {
		t.Errorf("a wrong command line: exit %d, want %d", code, exitUsage)
	}
}
