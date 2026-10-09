# Changelog

## 0.1.0 (unreleased)

MaveScape's first release, wave 1 of the [roadmap](mavescape-spec/roadmap.md): from a
two-population count table to QC, scores checked against Enrich2, an interactive variant-effect
map and a saved, reproducible record. Built slice by slice; this section grows with each.

### Added

- **The program and its window (wave 1, slice 1).** One self-contained program (`mavescape`) for
  macOS, Linux and Windows, x64 and ARM64, that serves its embedded web app on 127.0.0.1 (port
  8820, or the next free one) and opens it in a desktop window. A second launch hands its files to
  the open window. The host, its security (Host-header check against DNS rebinding, same-origin
  API, Content-Security-Policy, cross-origin isolation) and its content-addressed workspace
  library are adapted from CytoWeave 0.8.0; the web app also runs from any static web server, with
  the library in the browser.
- **The workbench shell.** Views in the order of an analysis (Start, Experiment, QC, Score, Map;
  each says what it will do until it is built), a dataset tree, an inspector, a bottom drawer with
  the history of the analysis and the session's log, a status bar, the command palette (⌘K), undo
  and redo, light and dark themes and color-vision-friendly colors.
- **The build commit** in the status bar and `/api/info`: release builds embed it, other builds
  take Go's version-control stamp.
- **Installers** (`install.sh`, `install.ps1`) that check the download's SHA-256 and version, and a
  release workflow that builds six binaries with their checksums.

- **The experiment design (wave 1, slice 2).** A versioned schema (`mavescape-design` v1,
  `docs/schemas/design.v1.json`) and `web/lib/design.js`, which checks a design against its table
  and describes it in plain language. One schema represents two-population, time-series, FACS-bin
  and score-only experiments, samples shared between replicates, tiled libraries (overlapping too),
  several experiments in one table and known differences between a construct and its reference.
  Every column of a table is a sample's or set aside with a reason: none is dropped silently.

- **Import (wave 1, slice 3).** Open count or score tables (CSV or TSV, gzip too; per-sample
  files together) and the target's FASTA. The import wizard says what it found (layout, rows,
  delimiter, line ends, encoding), lets you choose the variant names and the count columns,
  suggests each column's role from its name (input, output, time, bin, tile, replicate; shown,
  never applied), checks every variant name against the target and lists, by line, every problem
  that blocks scoring: the same variant on two rows (however written), counts that are not numbers
  or are negative, rows of the wrong width. Missing counts are never read as 0. Tables are kept in
  the library by SHA-256; a mapping can be saved as a template. MaveDB's tables, DiMSum's (whose
  variants are whole sequences, named against the wild type) and generic tables are recognized.
- **MAVE-HGVS** (`web/lib/hgvs.js`): the whole grammar, agreeing with mavehgvs 0.8.1 on every one of
  16,959 test strings, and a lenient mode for lab and legacy names (A12V, `_wt`, `p.Ala12*`,
  repeated or unsorted components), which keeps the original beside the canonical name.

### Validation

- Go tests of the host: security headers, foreign Host headers and cross-origin requests refused,
  the library's round trips, files stored under the hash the program computes, range requests,
  folders opened in natural order, every web module embedded.
- `node --test` of the shared modules (seeded random numbers against FNV-1a test vectors and
  their moments, SHA-256, ZIP, color-vision simulation, the workspace document).
- `validation/run.mjs accessibility`: every text-on-surface pair of both themes, with
  color-vision-friendly colors off and on, at WCAG AA contrast (lowest 4.58:1); the palettes and
  status colors apart in protanopia, deuteranopia and tritanopia; the diverging score maps' two
  ends apart in every vision.
- `validation/run.mjs designs` (wave 1, slice 2): three public MaveDB data sets of different
  designs (GRB2 SH3, two populations; BRCA1 RING, time series with shared inputs and a second assay
  in the same table; factor IX, FACS bins in overlapping tiles), downloaded and checksummed by
  `validation/fetch.mjs`, each described by a design written as data, with no code for any of them;
  every design satisfies the schema and agrees with its data (37 checks).
- `validation/run.mjs enrich2`: reference scores from Enrich2 2.0.2 (`validation/reference/`,
  generated from MaveScape's designs) equal the scoring formulas MaveScape will use, computed
  independently, to 5 × 10⁻¹³; Enrich2 2.0.2 reproduces the BRCA1 replicate scores published in 2017
  to the same precision, which confirms their method (19 checks).
- `validation/run.mjs hgvs` (wave 1, slice 3): the MAVE-HGVS parser against mavehgvs 0.8.1 on
  16,959 strings: the same decision, reason, canonical form and parts for every one.
- `validation/run.mjs import`: the four feasibility tables import with every variant name valid
  against its target; 13,757 legacy BRCA1 names read leniently; designs drafted from column names
  have the hand-written designs' shape; shuffled rows and columns, text read in parts and per-sample
  files joined give the same counts; DiMSum's demo is named against its wild type; a fixture with
  one problem of each kind raises exactly those, on their lines (29 checks).
