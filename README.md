# MaveScape

MaveScape is a free, open-source (Apache 2.0) workbench for multiplexed assays of variant effect
(MAVEs), starting with protein deep mutational scanning. It turns variant count tables into
checked, uncertainty-aware variant-effect scores and maps, with quality control, comparison and
protein structure, and keeps every analysis decision on record.

It runs on your own computer as one self-contained program, with no account, Python or R. Files
are analyzed in the browser and never leave your machine. MaveScape reports experimental
functional effects for research; it does not classify variants as pathogenic or benign.

> **Status: in development.** Wave 1 (release 0.1.0) is being built. Count tables import, designs
> are set in the Experiment view, and two-population experiments (and time series, by their first
> and last samples) are scored, with numbers checked against Enrich2, dms_variants and metafor.
> QC, the map and exports arrive in the next slices ([roadmap](mavescape-spec/roadmap.md)).

## Install

**macOS and Linux**

```sh
curl --proto '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/robert-mcdermott/mavescape/main/install.sh | sh
```

**Windows** (PowerShell)

```powershell
irm https://raw.githubusercontent.com/robert-mcdermott/mavescape/main/install.ps1 | iex
```

The installers check the download against `SHA256SUMS` and its version before installing, and
need no administrator rights ([docs/INSTALLING.md](docs/INSTALLING.md)). Then run `mavescape`: it
opens in its own window.

## What you bring

- **Variant counts**: a table with one row per variant and one column per sample (CSV, TSV or
  Excel), as Enrich2, DiMSum, dms_variants or a lab's own scripts write them, or one file per
  sample.
- **The target sequence** the variants are named against (FASTA, or pasted).
- **The design**: which column is which sample, its role, condition and replicate; a sample sheet
  fills it in.
- Or **published scores**, from MaveDB and other sources.

MaveScape starts from counts; reads (FASTQ) are counted by those upstream tools.

## Command-line options

| Option | Meaning |
| --- | --- |
| `mavescape [files or folders]` | Start and open the files (tables, sequences, structures, workspaces) |
| `--port N` | Preferred port (default 8820; the next 19 are tried) |
| `--window app\|browser\|none` | A desktop window (Chrome, Edge, Brave or Chromium), the default browser, or none |
| `--data-dir DIR` | Where the workspace library is kept |
| `--no-library` | Keep workspaces in the browser's storage instead |
| `--keep-running` | Keep serving after the window is closed |
| `--version` | Print the version |

A second `mavescape <files>` hands its files to the window already open.

## Privacy and security

MaveScape listens on 127.0.0.1 only, refuses requests whose Host header is not this computer and
API calls from other web pages, and serves its page with a strict Content-Security-Policy. It
makes no network requests of its own; public-data fetching (MaveDB, UniProt, PDB, AlphaFold) will
come through a fixed list of services and can be switched off (`--offline`).

## Development

Requirements: Go (the version in `go.mod` or newer) and Node 22 for the tests. There are no
dependencies to install.

```sh
go run . --dev                    # serve web/ from disk, edits show on reload
go test -race ./...               # the host
node --test "web/lib/*.test.mjs"  # the browser modules
node validation/run.mjs           # the validation suites
```

The web app also runs from any static web server (`python3 -m http.server --directory web`),
with the workspace library in the browser.

### Code layout

```
main.go, security.go, local.go, store.go, records.go, window.go   the Go host
web/index.html, web/styles.css, web/app.js                        the app shell
web/lib/       pure modules (no DOM): parsing, scoring, QC; run in Node, workers and the page
web/ui/        views and components
validation/    comparisons with reference tools and fixtures
mavescape-spec/  requirements, design, roadmap, research and conventions
```

MaveScape is a sibling of [CytoWeave](https://github.com/robert-mcdermott/cytoweave) (flow
cytometry) and Proteoscope (protein structure). It shares their architecture and copies some of
their code, noted in each file; it does not depend on either.

## License, citation

Apache License 2.0 ([LICENSE](LICENSE)). To cite MaveScape, see [CITATION.cff](CITATION.cff).
