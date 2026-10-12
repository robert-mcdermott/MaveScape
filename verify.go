package main

import (
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

// "mavescape verify" verifies a reproducibility certificate (web/lib/certificate.js; wave 6, slice
// 6) without a window: in a headless page, as "mavescape run" does, it checks the certificate's
// fingerprint, the workspace and every file against their SHA-256 and the history's chain,
// computes every number again from the files with the same code, and compares them bit for bit
// (the verify_certificate action). It prints the verdict and, with --report, writes what was found
// as JSON. After CytoWeave 0.8.0's verify.go.
//
// Exit status: 0 verified; 1 something differs (listed); 2 it could not be checked: a file the
// certificate names is missing (give it with --data), the command line is wrong, or no browser was
// found.

const (
	exitVerifyDiffers   = 1
	exitVerifyUnchecked = 2
	verifyClient        = "mavescape verify"
)

type verifyOptions struct {
	certificate string
	data        []string
	report      string
	overwrite   bool
	chrome      string
	timeout     time.Duration
	dev         bool
}

func parseVerifyArgs(args []string, stderr io.Writer) (verifyOptions, error) {
	var opts verifyOptions
	var data repeatFlag
	flags := flag.NewFlagSet("mavescape verify", flag.ContinueOnError)
	flags.SetOutput(stderr)
	flags.Var(&data, "data", "a folder (or a file) with the tables a certificate written without them names, found by their SHA-256; may be repeated")
	flags.StringVar(&opts.report, "report", "", "also write what was found as JSON to this file")
	flags.BoolVar(&opts.overwrite, "overwrite", false, "replace the report file if it exists")
	flags.StringVar(&opts.chrome, "chrome", "", "the Chrome, Chromium, Edge or Brave to run in (default: CHROME, else one installed)")
	flags.DurationVar(&opts.timeout, "timeout", 2*time.Hour, "stop a verification that takes longer")
	flags.BoolVar(&opts.dev, "dev", false, "serve web/ from the working directory instead of the embedded copy")
	flags.Usage = func() {
		out := flags.Output()
		fmt.Fprintln(out, "Usage: mavescape verify [flags] analysis.certificate.msz")
		fmt.Fprintln(out, "Computes every number of a MaveScape reproducibility certificate again from its files and")
		fmt.Fprintln(out, "compares them bit for bit; checks its fingerprint, files and history.")
		fmt.Fprintln(out, "Exit status: 0 verified, 1 something differs (listed), 2 it could not be checked (a file")
		fmt.Fprintln(out, "missing: give it with --data; a wrong command line; no browser).")
		flags.PrintDefaults()
	}
	positional, err := parseArgs(flags, args)
	if err != nil {
		return opts, err
	}
	if len(positional) != 1 {
		return opts, errors.New("name one certificate (.msz) to verify")
	}
	if opts.certificate, err = existingFile(positional[0]); err != nil {
		return opts, err
	}
	if !strings.HasSuffix(strings.ToLower(opts.certificate), ".msz") {
		return opts, fmt.Errorf("%s is not a certificate (.msz)", positional[0])
	}
	for _, d := range data {
		path, err := absPath(d)
		if err != nil {
			return opts, err
		}
		if _, err := os.Stat(path); err != nil {
			return opts, fmt.Errorf("--data %s: %v", d, err)
		}
		opts.data = append(opts.data, path)
	}
	if opts.report != "" {
		if opts.report, err = absPath(opts.report); err != nil {
			return opts, err
		}
		if _, err := os.Stat(opts.report); err == nil && !opts.overwrite {
			return opts, fmt.Errorf("%s exists; give --overwrite to replace it", opts.report)
		}
	}
	if opts.timeout <= 0 {
		return opts, errors.New("--timeout must be positive")
	}
	return opts, nil
}

// What the page's verify_certificate returns (web/lib/certificate.js, verifyCertificate), as far as
// the command needs it.
type verifyReport struct {
	Verdict string `json:"verdict"`
	Summary string `json:"summary"`
	Inputs  []struct {
		Role     string `json:"role"`
		FileName string `json:"fileName"`
		Status   string `json:"status"`
	} `json:"inputs"`
	Numbers struct {
		Checked int `json:"checked"`
		Same    int `json:"same"`
		Differs int `json:"differs"`
		Missing int `json:"missing"`
		Differ  []struct {
			Label    string          `json:"label"`
			Recorded json.RawMessage `json:"recorded"`
			Computed json.RawMessage `json:"computed"`
		} `json:"differ"`
	} `json:"numbers"`
}

func verifyHeadless(args []string, stdout, stderr io.Writer) int {
	opts, err := parseVerifyArgs(args, stderr)
	if errors.Is(err, flag.ErrHelp) {
		return 0
	}
	if err != nil {
		fmt.Fprintln(stderr, "mavescape verify:", err)
		return exitVerifyUnchecked
	}
	browser, err := chooseBrowser(opts.chrome)
	if err != nil {
		fmt.Fprintln(stderr, "mavescape verify:", err)
		return exitVerifyUnchecked
	}
	ctx, cancel := context.WithTimeout(context.Background(), opts.timeout)
	defer cancel()
	stopSignals := cancelOnSignal(cancel, stderr)
	defer stopSignals()
	page, err := startHeadlessPage(ctx, browser, opts.dev, "")
	if err != nil {
		fmt.Fprintln(stderr, "mavescape verify:", err)
		return exitVerifyUnchecked
	}
	defer page.stop()
	fmt.Fprintf(stdout, "MaveScape %s: verifying %s in %s\n", version, filepath.Base(opts.certificate), filepath.Base(browser))
	began := time.Now()
	encoded, _ := json.Marshal(map[string]any{"paths": append([]string{opts.certificate}, opts.data...), "show": false})
	files, err := page.hub.openFiles(encoded)
	if err != nil {
		fmt.Fprintln(stderr, "mavescape verify:", err)
		return exitVerifyUnchecked
	}
	outcome, err := page.hub.dispatch(ctx, remoteEvent{Action: "verify_certificate", Args: encoded, Client: verifyClient, Files: files})
	if err == nil && !outcome.OK {
		err = errors.New(outcome.Message)
	}
	if err != nil {
		if ctx.Err() != nil {
			err = fmt.Errorf("interrupted or timed out: %v", err)
		}
		fmt.Fprintln(stderr, "mavescape verify:", err)
		return exitVerifyUnchecked
	}
	var found verifyReport
	if err := json.Unmarshal(outcome.Data, &found); err != nil {
		fmt.Fprintln(stderr, "mavescape verify: the page's answer could not be read:", err)
		return exitVerifyUnchecked
	}
	fmt.Fprintln(stdout, found.Summary)
	ok := 0
	for _, input := range found.Inputs {
		if input.Status == "ok" {
			ok++
		}
	}
	missing := ""
	if found.Numbers.Missing > 0 {
		missing = fmt.Sprintf(", %d not computed", found.Numbers.Missing)
	}
	fmt.Fprintf(stdout, "Files: %d of %d as certified. Numbers: %d identical of %d%s (%.1f s).\n", ok, len(found.Inputs), found.Numbers.Same, found.Numbers.Checked, missing, time.Since(began).Seconds())
	for i, d := range found.Numbers.Differ {
		if i == 20 {
			fmt.Fprintf(stdout, "  … and %d more (--report lists the first %d)\n", found.Numbers.Differs-20, len(found.Numbers.Differ))
			break
		}
		fmt.Fprintf(stdout, "  %s: %s certified, %s now\n", d.Label, d.Recorded, d.Computed)
	}
	if opts.report != "" {
		var pretty any
		json.Unmarshal(outcome.Data, &pretty)
		text, _ := json.MarshalIndent(pretty, "", "  ")
		if _, err := writeOutput(opts.report, opts.overwrite, strings.NewReader(string(text)+"\n")); err != nil {
			fmt.Fprintln(stderr, "mavescape verify: could not write the report:", err)
			return exitVerifyUnchecked
		}
	}
	switch found.Verdict {
	case "verified":
		return 0
	case "differs":
		return exitVerifyDiffers
	default:
		return exitVerifyUnchecked
	}
}
