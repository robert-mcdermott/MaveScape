# Changelog

## 0.2.0 (unreleased)

Wave 2 of the [roadmap](mavescape-spec/roadmap.md): every common experiment design, each checked
against an independent reference, plus headless runs. Built slice by slice; this section grows with
each.

### Added

- **Remote control (wave 2, slice 1).** `mavescape --remote-control` lets programs on this computer
  drive the open window through `/api/remote/action`: `get_state`, `new_workspace`,
  `open_example`, `open_files`, `set_mode`, `focus`, `draft_design`, `set_design`, `score`,
  `qc_findings`, `select_variants`, `inspect_variant`, `render_map` and `export` (scores, counts,
  QC, provenance, methods, references, the map, a selection or the workspace archive). Each action
  happens in the window, its changes go into the history and can be undone; names are forgiving, and a wrong
  one is answered with the choices. `GET /api/remote/tools` lists the actions with their arguments.
  MaveScape writes its address and a token to `remote.json` in its data folder (readable by its
  owner only, removed on exit); reading and writing files needs the token. Only programs on this
  computer, never other web pages, can send actions. The hub, the connection file and the export
  writer are ported from CytoWeave 0.8.0.
- **Screenshots captured through remote control.** `docs/capture/capture.mjs` builds MaveScape,
  runs each scene on an empty library in headless Chrome by remote actions, and writes it in the
  light and dark themes to `docs/images/` (optionally auditing each with axe-core). Ten scenes: the
  start page, import, the design and its draft, scoring, QC, the map, a saved selection, the map by
  standard error, and the exports.
- **The website** (`docs/site/`, published on GitHub Pages from the `gh-pages` branch): home,
  install, science (the validation, with its numbers) and a guide of eleven pages (getting started,
  the examples, opening your data, the design, scoring, QC, the map and the inspector, the record,
  scripting, troubleshooting), with the screenshots in both themes. The build checks every link,
  anchor and screenshot. The README shows the map's screenshot.
- **The import wizard accepts what it detected** when asked (remote control's `open_files`), and
  leaves the wizard open for review otherwise.

### Fixed

- **Scores depended on the browser.** JavaScript's `Math.log` and `Math.exp` differ in their last
  bit between engines and their versions (Chrome 154 and Node 22 on about 2% of logarithms), so a
  run's output hash depended on the browser that scored it, and a saved run could stop reproducing
  after a browser update. Scoring, QC, statistics and simulation now use `web/lib/dmath.js`
  (fdlibm's logarithm and exponential in plain arithmetic): within one unit in the last place of
  the engines' functions, and the same bits everywhere. The scoring engine's version is now 2; runs
  made by 0.1.0 reopen with scores that differ only in their last digits, and say why.

## 0.1.0 (2026-10-09)

MaveScape's first release, wave 1 of the [roadmap](mavescape-spec/roadmap.md): from a
two-population count table to QC, scores checked against Enrich2, an interactive variant-effect
map and a saved, reproducible record.

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

- **The Experiment view (wave 1, slice 4).** Say what each column of the counts is: a sample, a
  technical replicate of one (summed), a copy of a shared sample's column, or not used (and why);
  and each replicate's samples: input and output, each time, or each bin, with conditions, tiles,
  controls and the target's offset and identifiers. A design starts from MaveScape's draft from the
  column names, or from a sample sheet (one row per sample: column, role, replicate, condition,
  time or bin, tile, batch; DiMSum's experiment design file works as one), and is checked and
  described in plain language as you edit. Designs export and open as `*.design.json`.
- **A history that cannot be rewritten quietly.** Every material change (an import, a target, the
  design) is written to the workspace's history, each entry chained to the one before by SHA-256;
  the drawer lists it and says whether the chain holds.

- **Scoring (wave 1, slice 5).** The Score view turns the counts and the design into functional
  scores with standard errors: log ratios normalized to the wild type, complete cases, all reads
  or the synonymous median, with a pseudocount; technical replicates summed, biological
  replicates scored separately and combined by REML random effects, fixed effects or Enrich2's own
  estimator (an "Enrich2-compatible" preset reproduces Enrich2 2.0.2's numbers); heterogeneity
  (Q, I², τ²) and leave-one-replicate-out sensitivity for every variant; optional rescaling
  (nonsense 0 and wild type 1; synonymous 0 and nonsense −1). Filters are ordered and visible (a
  filter bar and the filter flow), and a filtered variant keeps its counts and replicate scores
  with the stage that left it out; nothing unscored is shown as 0. Conditions are scored apart.
  Scoring runs in a worker, with progress and cancel.
- **Runs that can be repeated.** Each run is kept unchanged with its table's SHA-256, the design,
  the parameters, the software version and the hash of its output; the same inputs always make
  the same run. Reopened, a run is recomputed and checked against its output hash. The run says in
  sentences how its scores were made.
- **Drafts that keep experiments apart.** A table holding two assays (BRCA1's E2 binding and
  yeast two-hybrid) drafts into two conditions instead of one experiment.

- **Quality control (wave 1, slice 6).** The QC view says whether the experiment supports
  reliable scores, finding by finding: every sample has counts (blocking when not), sequencing
  depth, low counts before selection, missing counts, variants missing after selection (a table
  that writes dropouts as missing), coverage of the designed substitutions (a grid by position),
  replicate agreement, variance beyond counting (a bottleneck), outlier replicates, and from a
  score run the separation of the controls, the resolution of the scores and the variants
  scored. Each says pass, review, fail or not assessed (and why), with what it found in numbers,
  its threshold and rationale, what it concerns and its plot; the overall status is shown beside
  the list. QC runs from the counts alone, before scoring, or of any score run. Thresholds can be
  changed, and each change goes into the history.
- **Simulated experiments** (`web/lib/simulate.js`): a library, bottlenecks, selection with
  replicate noise and sequencing, seeded and labeled simulated.

- **The variant-effect map (wave 1, slice 7).** Positions across, the 20 amino acids and stop
  down, colored by score (blue for loss, red for gain, or purple and orange; white is the wild
  type), or by SE, replicates used or input count. Missing, filtered, low-confidence and
  not-designed cells are each drawn their own way, never in the wild type's color; reference
  residues are outlined and hold the synonymous variant. The median of each position is shown
  above and of each substitution at the right, with target and reference numbering and an
  overview of the whole target. Pan, zoom, hover; click, ⌘-click and Shift-drag to select; the
  keyboard moves through the cells and announces each. Selections can be saved by name. The map
  exports as SVG and PNG, is described in words, and lists every cell in a table.
- **The variant inspector.** A variant chosen on the map, in its table or in the Score view shows
  its identifiers as written and canonical, its score with SE and 95% interval (or why it has
  none), its flags, each replicate's counts and score, every sample's counts, the other
  substitutions at its position, the sequence around it and the run it comes from.

- **The workspace archive (`.msz`, wave 1, slice 8).** One file with everything needed to reopen
  an analysis on another computer: the workspace (targets, design, score runs, selections, QC
  thresholds, the chained history), each run's scores, the methods with references, and the
  tables (or only their checksums). Saved, reopened and saved again it has the same bytes; opened,
  every file is checked against the manifest's SHA-256 and the history's chain, and anything that
  does not hold is reported. Workspace menu → Export.
- **Exports.** From a run's Export menu: scores and the counts it scored, in MaveDB's columns (they
  import again without loss, and MaveDB's upload layout is now recognized at import); QC per
  sample and per variant; the run's provenance as JSON; the methods paragraph, written from what
  the run did, with numbered references and their BibTeX. From the map: the selected variants as
  CSV or JSON.
- **Examples.** Two on the Start page, each opened as a new workspace with a first score run and a
  guide in the inspector (its question, steps, what to expect, source and license): the **GRB2
  SH3 domain** (the Human Domainome's CC0 counts from MaveDB) and **a simulated experiment** whose
  true effects are known (and compared with its scores). Simulated data are labeled as such.
- **Blank layouts and `docs/FORMATS.md`.** Annotated count table, sample sheet and target FASTA to
  fill in, from the Start page; every file MaveScape reads and writes, described.

- **The workflow strip.** Above every view, the analysis as steps (counts, target, design, score,
  QC, map, record), each done, next, needing attention or still to do, and the next step said in
  words with its button: "Draft the design" drafts it in one click. It says what is wrong when a
  step is blocked: a table of scores rather than counts, problems that block scoring, a design to
  fix, a design changed since the last run, a FASTA opened without its count table.
- Starting MaveScape while one is already running now says which files were handed to it and
  where to find its window.

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
- `validation/run.mjs experiment` (wave 1, slice 4): each feasibility design rebuilt with the
  editor's operations alone says what the hand-written one says; sample sheets for GRB2, BRCA1 and
  factor IX, and DiMSum's own design file, give the same samples and slots; a workspace's history
  survives saving and reopening, and an entry edited afterward is caught (12 checks).
- `validation/run.mjs scoring` (wave 1, slice 5): the scoring engine equals Enrich2 2.0.2 replicate
  by replicate and combined (GRB2 with three normalizations, BRCA1 E2, a synthetic fixture), and
  dms_variants 1.6.0's `func_scores`, to 5 × 10⁻¹³; its REML equals metafor 5.2-1 to 3.4 × 10⁻¹²;
  each of the PRD's two-population edge cases, planted in the fixture, behaves as specified;
  scores are deterministic, independent of row and column order, and reproduced from a saved
  workspace (46 checks).
- `validation/run.mjs qc` (wave 1, slice 6): simulated experiments with one problem each (poor
  replicate agreement, a failing replicate, a severe bottleneck, a low-count tail, a missing
  sample) raise exactly their findings on three seeds, and a clean one none; the variance check
  follows a simulated bottleneck; findings do not depend on row order or on a run; the
  feasibility data's findings as found (15 checks).
- `validation/run.mjs map` (wave 1, slice 7): the map's SVG against a golden file, each state where
  it is planted, state colors apart from the neutral color in every theme, the scale centered on
  the wild type, and on BRCA1 the zinc ligands as the least tolerant positions (9 checks).
  `validation/bench.mjs`: 105,000 variants scored, mapped and drawn within budget.
- `validation/run.mjs roundtrip` (wave 1, slice 8): workspaces saved as archives, reopened and
  saved again give the same bytes, and every export the same bytes; exported scores and counts
  import again without loss; tampered, hostile and foreign archives are caught; the examples and
  layouts are what they say (25 checks).
