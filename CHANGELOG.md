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
- **Time series scored by regression (wave 2, slice 2).** A time series of three or more time
  points is scored by default from every time point: each variant's score is the slope of its
  normalized log count on time scaled to 0–1, by weighted least squares as Enrich2 computes it
  (ordinary least squares and the log ratio of the first and last samples are the other choices),
  on unevenly spaced times. A variant is fitted on the time points where it was counted, at least
  three with the first among them; fewer than the replicate has are flagged low confidence. The
  slope's SE is scaled by the residuals and, by default, never below what counting alone predicts;
  the Enrich2-compatible preset keeps Enrich2's. Equal to Enrich2 2.0.2's WLS and OLS to
  5 × 10⁻¹³ on BRCA1's two assays and a new time-series fixture, and to statsmodels to 5 × 10⁻¹⁴.
- **Time-series quality control:** "Time points used" and "Fit of the time courses" (how far the
  time courses scatter about their lines against counting noise), with plots; the variant inspector
  draws each replicate's time course and its fitted line.
- **"Missing = 0"** per sample in the Experiment view (`missingMeansZero` in the design), for tables
  that write variants that dropped out during selection as missing; scoring and QC read the counts
  the same way, and the run records it.
- **A third example: a simulated time series** with known effects (five times over eight
  generations), and time series in the simulator, with an optional bottleneck at every passage.
- **Sorted bins (FACS) scored (wave 2, slice 3)** by the weighted average of the bins' values
  (VAMP-seq), with an analytic or seeded-bootstrap SE, or by the censored log-normal
  maximum-likelihood fit from the bins' gates (Peterman and Levine 2016), reads reweighted by the
  cells sorted into each bin. Each replicate is scaled so that nonsense scores 0 and the wild type 1
  (VAMP-seq), or the median of its lowest 5% 0 (MultiSTEP). A VAMP-seq preset and the mean of
  replicates (SE = SD/√k). Factor IX's published scores are reproduced from its counts to
  10⁻¹⁵, and the maximum-likelihood fits equal fitdistrplus's to 3 × 10⁻⁷.
- **The design records each bin's gates and the cells sorted into it**, edited in the Experiment
  view.
- **Sorted-bin quality control:** "Occupancy of the bins" and "Cells sorted per variant", and
  replicate agreement, variance beyond counting and outlier replicates from the bins' weighted
  averages, replicates compared within their tile. The inspector shows a variant's distribution
  over the bins beside the wild type's.
- **A fourth example: a simulated sort-seq experiment** with gates, cells and known shifts.
- **Tables of barcodes (wave 2, slice 4).** A count table whose rows are barcodes, opened with the
  barcode-to-variant map that names each barcode's variant: MAVE-HGVS or lab names, dms_variants'
  substitutions, or whole variant sequences (Enrich2's map) named against the target. A barcode the
  map gives two different variants is left unmapped and listed, never resolved by guessing. The
  design names the column of barcodes (`library.barcodeColumn`); the source keeps the counts, the
  map and how they were put together, and assembles them again whenever it is read.
- **Barcodes scored two ways:** summed per variant, then scored (Enrich2; dms_variants by
  substitution), or each barcode scored against its replicate's normalizers (dms_variants by
  barcode) and a variant's barcodes combined within the replicate by REML, fixed effects or their
  mean. Every barcode is compared with its variant's others (its departure over √φ, φ being how much
  more a replicate's barcodes disagree than counting explains), and outliers are found one at a
  time. Two filters: a minimum of barcodes per variant, and the barcode filter, which leaves
  outliers out. Equal to dms_variants 1.6.0's `func_scores` by barcode and by substitution to
  5 × 10⁻¹³. The inspector lists a variant's barcodes in each replicate; a run's barcodes export
  one by one (CSV).
- **Barcode quality control:** "Barcodes the map names", "Barcodes per variant", "Agreement of a
  variant's barcodes" (φ and the split-half r) and "Outlier barcodes", with plots.
- **More layouts recognized at import (D12):** dms_variants' `variant_counts` (made one row per
  library and barcode, a count column per library and sample) and Enrich2's counts files (one per
  sample, its elements named in MAVE-HGVS, or barcodes with its map).
- **A fifth example: a simulated barcoded library** with a map in conflict and outlier barcodes.
- **A million rows (D9, S12).** `validation/bench.mjs` imports a million-barcode table and its
  million-line map in 3.5 s (budget 15 s, the process at most 830 MB of a 1 GB budget) and scores
  it in 1.3 s; `validation/browser-bench.mjs` does the same in the window in headless Chrome (3–4 s,
  the browser's memory up by about 600 MB at most). Both run in CI.
- **DiMSum's fitness and error model (wave 2, slice 5; S9).** For an input and an output,
  *Scored by* offers DiMSum's model (Faure et al. 2020), as DiMSum 1.4 computes it: fitness with
  no pseudocount (an optional dropout pseudocount for outputs of 0), each replicate scaled and
  shifted to agree with the others, and an error model with a multiplicative term for each input
  and output and an additive term per replicate, carried into every variant's SE; replicates are
  merged by inverse variance. The error model is linear in its terms, so MaveScape fits it exactly
  on every variant (bounded least squares) where DiMSum averages 100 nonlinear fits of bootstrap
  samples, and reports the 10th–90th percentiles of a seeded bootstrap. A DiMSum-compatible
  preset; the run lists each replicate's scale, shift and terms, and its methods give them.
  Against DiMSum 1.4's own functions on GRB2, DiMSum's demo and a fixture: the same threshold and
  variants fitted, the scales and shifts within 5 × 10⁻⁷, the error model within 5 × 10⁻⁶ of
  DiMSum's own fit on every variant and inside its percentiles, and every fitness, σ and merged
  score within 10⁻¹² given DiMSum's parameters. On simulated bottlenecks, its 95% intervals hold
  the true effects 93–96% of the time (counting alone, 67–69%).
- **Where the bottleneck is (Q4).** "Variance beyond counting" fits DiMSum's error model to the
  counts and says whether the excess is before selection or after it, with a plot of the terms.
  The GRB2 example now shows its bottleneck at the inputs (20–38× counting) and scores with the
  DiMSum-compatible preset in its guide.
- **Remote control's `score` takes the `dimsum` preset** and returns each replicate's fitted model.
- **Two conditions compared (wave 2, slice 6; S10).** With two or more conditions, each condition
  is compared with the reference: every variant measured in both gets a differential score with its
  SE, 95% interval, p and Benjamini–Hochberg q. Three methods, under *Conditions compared by*:
  limma's moderated t on voom log counts with a term for each input library and for selection in
  each condition, as mutscan's `calculateRelativeFC` computes it (the default where it applies:
  two populations, relative to the wild type or the synonymous variants, with residual degrees of
  freedom); replicates paired by their shared input, whose counting error cancels from each pair's
  difference; and the conditions as independent (Enrich2's z, the Enrich2-compatible preset's).
  limma's statistics (`web/lib/limma.js`, `web/lib/distributions.js`) are written from the
  publications, not from limma's source (GPL). Equal to mutscan 1.2.0 within 2 × 10⁻¹⁰ on a
  two-condition fixture and on CBS at two vitamin B6 levels (MaveDB, four shared inputs), and to
  Enrich2 2.0.2's z between conditions within 5 × 10⁻¹³. Runs made before keep their output
  hashes: the differential enters a run only when its parameters ask for it.
- **The differential on the map and in the inspector (V2):** *Color by* differential score, centered
  on no difference, a variant without one shown filtered with why; the inspector gives a variant's
  score in each condition and each difference with its interval and q (paired, each pair's too).
  The Score view's *Between conditions* pane: how each comparison was made, how many variants
  differ, a volcano plot and the largest differences. A run's differential scores export as CSV,
  and its methods describe the comparison with its references.
- **A sixth example: a simulated two-condition experiment** (one input selected without and with a
  ligand; a binding site that matters only with it), opening on its differential map; and two
  conditions in the simulator.
- **Remote control:** `score` summarizes each comparison, `inspect_variant` gives a variant's
  differences, `render_map` colors by the differential (`contrast` chooses one), `export` writes
  `differential`.
- **Headless runs (wave 2, slice 7; M1).** `mavescape run --design design.json --out results/
  counts.csv` scores without a window, in a headless Chrome on a private port: it checks the table,
  the design and the parameters first and scores nothing when anything blocks scoring, then writes
  the scores (a file per condition), counts, QC, differential scores, barcodes, the map, the
  provenance, methods and references, the workspace archive and `run.json` (the inputs and outputs
  with SHA-256, each step, the run and its QC). `--time` or SOURCE_DATE_EPOCH: every file the same
  bytes for the same inputs. `--from-workspace` reruns a saved run and fails unless it reproduces.
  `--log json`, `--strict`, `--overwrite`; exit status 0, 1 (not done, or a blocking problem) or 2
  (a wrong command line). Checked by `validation/headless-run.mjs` in CI.
- **`mavescape validate` (M2):** tables, a design and parameters checked as scoring would; exit 1
  with what blocks scoring; `--json`.
- **Remote control:** `check` (what would block scoring) and `reproduce_run` (a saved run recomputed
  and checked against its output hash).

### Changed

- **Records take their time from a session clock** (`web/lib/clock.js`), the wall clock in a window;
  a headless run with a fixed time makes them, and their identifiers, the same every time.

- **Tables are held column by column, a column of numbers as numbers only** (its text is not kept;
  `cellText` gives it back): a million rows take about 85 MB once read, not 500 MB, and are read in
  about a second.
- **Workers end when they have nothing more to do**, so that what a large table or run left in
  their memory is released.
- **Synonymous variants named from whole sequences** (DiMSum's, Enrich2's maps) are named by the
  codons changed (`p.Ala2=`), not `p.(=)`.
- **A time series is scored by weighted regression by default** (it was the log ratio of its first
  and last samples). Runs keep their parameters, so earlier runs are unchanged; score again to use
  every time point.

### Fixed

- **Enrich2's estimator with several conditions** started, in MaveScape, from the variance over the
  variants scored in every replicate of that condition; Enrich2 starts every condition from its
  table of variants scored in every replicate of at least one condition. Enrich2-compatible runs of
  designs with conditions now equal Enrich2's (they differed by up to 1.5 × 10⁻⁵).
- **"Samples shared between replicates"** was raised for an input selected under two conditions,
  which does not make one condition's replicates dependent; it is now raised only for samples
  shared within a condition.
- **A table joined from several files, or named from DiMSum's sequences, could not be read again
  from the library** (it had to be opened again): the source's files are now assembled again as at
  import.
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
