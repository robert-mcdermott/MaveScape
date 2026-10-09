# MaveScape roadmap

The plan for building MaveScape, from the product definition
(`product_research/MaveScape-prd.md`) and the research in `research.md`. Each **wave** is one
release: wave 1 is 0.1.0, wave 2 is 0.2.0, and so on. Each wave has **slices**: units of work that
each end with something that runs, a test or validation suite that checks it, and an entry in
`CHANGELOG.md`. Slices are done in order within a wave unless noted; each slice names the
requirements (`requirements.md`) it serves.

The order follows CytoWeave's principle, adapted:
1. **trust first**: numbers equal to the reference tools (Enrich2, DiMSum, dms_variants, mutscan)
   and QC that says when not to trust them;
2. **then the daily workbench**: every common design, public data, comparison, structure, figures;
3. **then what no single tool combines**: robustness to analysis choices, a provable record,
   agents, research-use calibration.

## How the waves map to the PRD's phases

| PRD phase | Waves | Releases |
| --- | --- | --- |
| Phase 0, feasibility spike | wave 1, slice 2 (before any UI form) | inside 0.1.0 |
| Phase 1, vertical slice | wave 1 | 0.1.0 |
| Phase 2, research beta | waves 2–6 | 0.2.0–0.6.0 |
| Phase 3, 1.0 | waves 7–9, then 1.0 | 0.7.0–0.9.0, 1.0.0 |

The PRD puts MaveDB import in phase 2 and the MCP server in phase 3. This plan keeps that, with two
changes:
- the remote-control hub arrives first in wave 2, because the documentation's screenshots, headless
  runs and later agents all drive the page through it (as in CytoWeave, `mavescape run` and the
  capture script drive the same page agents will);
- the product site (GitHub Pages) and its screenshot capture start in wave 2 and grow with every
  wave, rather than arriving in wave 9;
- structure viewing is a full part of MaveScape (wave 4), not the PRD's "lightweight view", because
  MaveScape must stand on its own. The viewer is copied from Proteoscope; Proteoscope is never
  required. The PRD's first milestone ends with "open selected residues in Proteoscope"; here wave 1
  ends with the record and examples, and residues on a structure arrive with wave 4.

## Decisions taken in this plan

The PRD lists decisions to make before implementation. Proposed answers, to confirm:

| Decision | Proposal |
| --- | --- |
| Product and executable name | **MaveScape**, `mavescape`; Go module `mavescape`; archives `.msz` |
| A shared suite UI package | Not now. Copy CytoWeave's and Proteoscope's modules with an origin comment in each file; revisit at 1.0 (`design.md`). |
| First scoring reference | **Enrich2 2.0.2** (Python 3, BSD-3, `pip install enrich2`): ratio, WLS and random-effects combination. Cross-checked by dms_variants `func_scores`. DiMSum 1.4 for its error model (wave 2). |
| Three feasibility datasets | Done (wave 1, slice 2): all CC0 on MaveDB, with counts, deliberately different (`research.md` §3): **GRB2 SH3** (Domainome, `urn:mavedb:00000835-a-1`; two populations × 3 replicates; scored by DiMSum), **BRCA1 RING** (`urn:mavedb:00000003-a-1`/`-a-2`; 6 replicates × 6 rounds, inputs shared, plus a Y2H assay in the same table; scored by Enrich2, so its published scores are a reference too; legacy HGVS), **Factor IX MultiSTEP** (`urn:mavedb:00001200-a-1`; 4 FACS bins × 3 overlapping tiles × 3 replicates). |
| Design schema before UI forms | Yes: wave 1, slice 2 writes `mavescape-design` v1 and represents the three datasets in it before slice 4 builds the editor. |
| Structure viewing and Proteoscope code | A full Structure view in MaveScape (wave 4), copied from Proteoscope (Apache-2.0, same author): its parser, WebGPU renderer with Canvas fallback, cartoon, surfaces, DSSP, selection language, coloring and alignment. No runtime dependency on Proteoscope; an optional "Open in Proteoscope" for its deeper analyses. |
| MAVE-HGVS | Port `mavehgvs` 0.8.1's regular-expression grammar to JavaScript (BSD-3; no JS implementation exists; keep its notice) with a **strict** mode (the spec, for export) and a **lenient** mode (legacy MaveDB data and lab tables: `_wt`/`_sy`, duplicated components, `p.A12V`, `A12V`, `*`), always keeping the original string. Validate against `mavehgvs`'s own test cases and outputs, committed as a reference. |
| Terminology | "Functional score", "WT-like / intermediate / abnormal-like", "evidence strength (research use)"; never pathogenic or benign (`conventions.md`). |
| Default port | 8820 (8820–8839), clear of CytoWeave (8770–8789) and Proteoscope (8765–8814). |

## In every wave, from wave 2

- **Examples.** Each new capability arrives with an example that uses it: published data where
  MaveDB has it under CC0 (small tables embedded, as GRB2's; larger ones downloaded on request with
  their checksums, so the program stays small), otherwise simulated (`web/lib/simulate.js`, seeded,
  the truth kept beside the data, labeled simulated), especially for planted problems a learner
  should find. Each with its question, source and license, what to expect, the view it opens and
  its guided steps, checked by the validation suites as GRB2's and the simulated one are.
- **Documentation.** A feature's guide page on the site, its tutorial on an example, and the
  capture scenes that make its screenshots are part of the slice that builds it; `docs/FORMATS.md`
  grows with every file read or written.
- **Release.** Screenshots re-captured, the site built (no broken link, anchor or image) and
  published with the release.

## 0.1.0: counts to a trustworthy map (wave 1)

The PRD's vertical slice: a two-population count table becomes a validated design, QC findings,
scores with uncertainty equal to Enrich2's, an interactive map, an inspector that goes back to the
raw counts, exports with methods and provenance, and a saved workspace that reopens identically.

### Wave 1

1. **Repository foundation (P1, P2, P4, P5, P6, T5, T8): done.** Ported from CytoWeave 0.8.0 with
   renames: `main.go`, `security.go`, `local.go`, `store.go`, `records.go`, `window.go` and their
   Go tests; the web shell (`index.html`, `styles.css`, `app.js`, `ui/dom.js`, `overlays.js`,
   `store.js`, `storage.js`, `workers.js`, `palette.js`, `icons.js`) with Start, Experiment, QC,
   Score and Map (each saying what it will do until its slice builds it, `ui/mode-planned.js`), the
   dataset tree (`ui/sidebar.js`), the inspector, the bottom drawer (history and session log,
   `ui/drawer.js`) and the status bar; light and dark themes and color-vision-friendly colors;
   `lib/random.js`, `sha256.js`, `zip.js`, `colormaps.js`, `colorvision.js`, `memory.js` with
   tests, and `lib/workspace.js` (the workspace envelope). `validation/run.mjs` with the
   `accessibility` suite. CI (gofmt, vet, race tests, `node --check`, `node --test`, validation,
   six-platform cross-compile, installer lint), the release workflow (tag, `main.go`,
   `web/app.js`, `index.html`'s cache keys, `CITATION.cff` and `CHANGELOG.md` must agree; the
   commit embedded with `-ldflags -X main.commit`, else Go's VCS stamp), `install.sh` and
   `install.ps1`, `LICENSE`, `CITATION.cff`, `README.md`, `docs/INSTALLING.md`,
   `mavescape-spec/ui-conventions.md`, `.gitignore`, `.claude/launch.json` (port 8820).
   - Validation: 14 Go tests (security headers, foreign hosts and cross-origin requests refused,
     library round trips, content addressing, range requests, folders in natural order, every
     web module embedded, the commit reported); 20 `node --test` tests; `accessibility` 14/14
     (lowest contrast 4.58:1). A release dry run built the six binaries with `SHA256SUMS`; the
     macOS one served the embedded app with its commit in `/api/info`, refused a foreign Host,
     and printed `mavescape 0.1.0` for the installers' check. The page is cross-origin isolated
     under the program and runs from a static server with the library in the browser.
   - Moved to the slices that use them: `connection.go` (remote control, wave 2, slice 1),
     `png.js` (it needs `pdf.js`'s deflate; wave 6), `stats.js` (CytoWeave's is tied to its event
     sets; MaveScape's own, with order statistics, correlations and intervals, comes with QC in
     slice 6).
   - `--version` prints one line (`mavescape X.Y.Z`), which the installers compare exactly; the
     commit is in `/api/info` and the status bar.
2. **Feasibility: the design schema on real data (E1, T2, PRD phase 0): done.** Three MaveDB data
   sets (CC0) in `validation/sources.json`, fetched and checksummed by `validation/fetch.mjs`:
   GRB2 SH3 (two populations × 3 replicates), BRCA1 RING (time series: E2 binding and Y2H in one
   table) and factor IX MultiSTEP (FACS bins × 3 overlapping tiles). `docs/schemas/design.v1.json`
   and `web/lib/design.js` (`validateDesign`, `summarizeDesign`, `sharedSamples`; 12 unit tests);
   four designs written as data (`validation/designs/`), with no code for any data set. Enrich2
   2.0.2 references (`validation/reference/generate_enrich2.py` builds Enrich2's configuration from
   the designs; `enrich2.json`, 2.2 MB, committed). Suites `designs` (37 checks) and `enrich2` (19).
   - Validation: every design satisfies the schema (checked by `validation/json-schema.mjs`) and
     `validateDesign` against its table, accounts for every column, and agrees with the data
     (copies identical cell for cell, the wild type counted in every sample, all 21,175 BRCA1 and
     9,681 factor IX reference residues the target's, tiles holding the variants counted in
     them). The formulas of `research.md` §2.1, computed independently in
     `validation/enrich2-formulas.mjs`, equal Enrich2 2.0.2 to 5 × 10⁻¹³ (13 significant digits
     stored) for log ratios with three normalizations, WLS and OLS, non-uniform times and the
     random-effects combination; slice 5 builds the engine on them.
   - Found by slice 2:
     - **The schema needed samples, and replicates that name them**, not one record per column:
       BRCA1's replicates share their inputs, which MaveDB writes once per replicate. Copies are
       declared (`ignoredColumns[].copyOf`) and checked; three "inputs" would overstate the
       replicates' independence.
     - **A table can hold two experiments** (BRCA1's E2 and Y2H), so every column must be a
       sample's or ignored with a reason; that is now an error, not a silent drop.
     - **Tiles overlap** (factor IX 146–164, 299–318) and **targets differ from the reference**
       (BRCA1 codon 174 R; UniProt K): both are in the schema.
     - **The published BRCA1 scores are reproduced** by Enrich2 2.0.2 with WLS and wild-type
       normalization (all 9,279 stored replicate values, 5 × 10⁻¹³), and their combined scores
       where Enrich2's 50 iterations converged; elsewhere they differ by up to 0.034 because the
       estimator's start depends on the number of variants (the quirk the Enrich2-compatible mode
       will reproduce).
     - **GRB2's published scores** are DiMSum growth rates, from culture densities and times the
       table does not hold: r = 0.987 against Enrich2's log ratios; DiMSum's model is wave 2.
     - **MaveDB writes CRLF line ends**, `NA` for missing and counts as decimals: the importer
       (slice 3) handles all three.
     - Factor IX's published scores set the median of the lowest 5% of missense variants to 0,
       not the nonsense median: rescaling conventions must be parameters (S11).
3. **Import (D1–D7, D12, E3, E4): done.** `web/lib/csv.js` (streaming; encoding by BOM, UTF-8 or
   Windows-1252; delimiter sniffing; RFC 4180 quoting across parts; CRLF, LF and CR line ends;
   header and comment lines; strict numbers, missing never 0, every irregular cell listed by line)
   and `web/workers/csv-worker.js` (16 MB parts, gzip); `web/lib/hgvs.js`, an independent
   MAVE-HGVS parser (every prefix and variant type, multi-variants, mavehgvs's rules and messages)
   with a lenient mode (one-letter names, `_wt`/`_sy`, `*`, repeated or unsorted components,
   equalities in multi-variants, predicted forms), and checks against a target;
   `web/lib/variants.js` (columnar variants: canonical key, kind, position, residues, status,
   messages; duplicates however written), `web/lib/target.js` (FASTA, translation, placing a
   target in its reference), `web/lib/counts.js` (count sets; identical columns; per-sample files
   joined, with what absence means chosen by the user), `web/lib/importer.js` (MaveDB, DiMSum and
   generic layouts; role suggestions from column names; designs drafted from them; the review of
   blocking problems; import templates). The import wizard (`web/ui/import.js`): what was found,
   the mapping, suggested roles (shown, not applied), the target (FASTA file or paste), checks and
   the first rows; tables stored in the library by SHA-256; FASTA files opened as targets; the
   inspector describes tables and targets. 66 unit tests; suites `hgvs` (5) and `import` (29).
   - Validation: on 16,959 strings (mavehgvs's own test cases, public identifiers, generated
     variants and near-misses; `reference/mavehgvs.json`, made by `generate_mavehgvs.py` with
     mavehgvs 0.8.1), `hgvs.js` makes the same decision, gives the same reason word for word, writes
     the same canonical form and finds the same parts as mavehgvs, for every one. The four
     feasibility tables import with every name valid against the designs' targets (GRB2 1,121;
     BRCA1 12,316 amino-acid and 20,724 nucleotide names; factor IX 9,682), nothing blocking, NA
     cells missing and zeros 0; the 13,757 legacy BRCA1 protein names strict MAVE-HGVS refuses are
     read leniently. Rows and columns shuffled, text read in 997-character parts, and GRB2 split into
     per-sample files and joined give the same counts. DiMSum's demo (40,591 sequences) is named
     against its wild type with every name valid, and its CR-terminated design file reads. A fixture
     with one problem of each kind (`fixtures/malformed-counts.csv`) raises exactly those problems,
     on their lines. In the window: GRB2 and its FASTA open together, import and save; DiMSum's
     5.6 MB demo reads in the worker and is named once its wild type is chosen.
   - Found by slice 3:
     - **The designs can be drafted from column names**: role suggestions turn GRB2's, BRCA1's
       (both assays) and factor IX's columns into designs with exactly the hand-written designs'
       shape (model, replicates, samples, shared inputs, time points or bins, tile ranges). The
       Experiment view (slice 4) starts from such a draft.
     - **MaveDB indexes by `hgvs_nt` when present**: BRCA1's nucleotide table has 3,194 protein
       names on several rows each, which would have been "duplicates".
     - **A column with a few non-numbers was left out silently** by the first layout detection:
       it is now offered, and its cells are listed as blocking problems (found by the fixture).
     - DiMSum's demo wild type is 126 nt, its count table CRLF-terminated (with an unterminated last
       line) and its design file CR-terminated.
4. **Experiment view (E2, E3, E5, E6, V6, D13): done.** `web/ui/mode-experiment.js`: the design
   as two tables, columns → samples (a sample of its own, a technical replicate of another, a copy
   of a shared sample's column, or not used, with why) and replicates × slots (input and output;
   each time, edited in the column heads; each bin, with its value), with conditions (a reference
   one), tiles, controls, the kind of experiment, the time unit and what bin values are; the
   plain-language summary and every error and warning of `validateDesign` as it changes; the
   target's name, offset, coding start and identifiers. A design starts from the draft MaveScape
   makes from the column names (slice 3) or from a sample sheet (`web/lib/samplesheet.js`:
   columns named loosely; DiMSum's experiment design file is one), and is exported and opened as
   `*.design.json`. `web/lib/design-edit.js`: the edits, each returning a new design.
   `web/lib/workspace.js`: the hash-chained history (CytoWeave's change log), written by every
   material change (import, target, design, rename) and shown, checked, in the drawer.
   - Validation (suite `experiment`, 12 checks): each of the four hand-written designs rebuilt with
     the editor's operations alone says what it says (slots, samples, copies) and validates;
     sample sheets for GRB2, BRCA1 and factor IX (`fixtures/*.samples.csv`) give designs with the
     hand-written designs' samples and slots; DiMSum's own experiment design file is a sample sheet
     for its demo; a workspace's history survives saving and reopening, and an entry edited
     afterward breaks it where it was edited. 12 more unit tests (78 in all). In the window: GRB2's
     and BRCA1's drafts are complete designs at once (BRCA1's shared inputs found from the data);
     the offset set in the view moves the summary's positions to 159–214; the drawer lists the
     chained history.
   - Found by slice 4:
     - **A sample sheet needs to say which replicates share a sample**: BRCA1's two libraries each
       have their own input, so "no replicate = shared by all" was not enough. A sheet now lists
       them ("1;2;3"); no replicate still means every replicate of its condition and tile.
     - **Drafting after reopening a workspace read empty columns as identical**, so every column
       became a "copy": a table not in the session is now read again from the library by its
       SHA-256 first, and columns with no values are never compared.
     - **Columns left out at import were reported as unaccounted**: a draft now sets them aside
       with that reason.
5. **Scoring (S1–S5, S11, V7): done.** `web/lib/score-ratio.js` (log ratios with wild-type,
   complete-case, all-read and synonymous-median normalization; pseudocount; SE),
   `web/lib/replicates.js` (technical replicates summed; fixed effects; REML random effects by
   metafor's Fisher scoring; Enrich2 2.0.2's estimator exactly; Q, I², τ², leave-one-out),
   `web/lib/filters.js` (eight ordered stages with reason codes, count filters per replicate, the
   filter flow), `web/lib/score.js` (the pipeline: controls by kind or name, conditions scored
   apart, tiles, rescaling, run warnings, refusals with reasons), `web/lib/runs.js` (ids from the
   canonical inputs; the output hashed; the method in sentences), `web/workers/score-worker.js`.
   The Score view (`web/ui/mode-score.js`): presets (MaveScape defaults, Enrich2-compatible),
   parameters, the filter bar, the run list, each run's warnings, filter flow, scores by class,
   replicates and every variant with its per-replicate evidence; the inspector describes runs.
   Runs keep their inputs and the hash of their output, not the scores: reopened, a run is
   recomputed in the worker and must have its output hash ("reproduced").
   - Validation (suite `scoring`, 46 checks): equal to Enrich2 2.0.2 (replicate and combined, three
     normalizations) on GRB2, BRCA1 E2 and a synthetic fixture with every PRD edge case planted
     (`fixtures/two-population.csv`, made by `make-two-population.mjs`), to 5 × 10⁻¹³; to
     dms_variants 1.6.0's `func_scores` on the fixture (natural log; 4.6 × 10⁻¹³); REML to metafor
     5.2-1 on 2,865 variants and six synthetic sets (3.4 × 10⁻¹²; required 10⁻⁶); each edge case's
     outcome; rescaling anchors exact; determinism, row- and column-order invariance (bit for bit,
     on the fixture and BRCA1) and input/output symmetry; a run saved, reopened and recomputed
     with its recorded output hash. 19 more unit tests (97 in all). References made by
     `generate_dms_variants.py` and `generate_metafor.R` (`validation/README.md`). In the window:
     GRB2 scored, reopened and reproduced; BRCA1's 12,316 rows × 12 replicates scored in half a
     second in the worker.
   - Found by slice 5:
     - **BRCA1's draft combined two assays**: the design drafted from all the column names made
       E2 binding and Y2H replicates of one experiment, and scoring averaged them. Replicates with
       different numbers of time points (or bins) now become separate conditions in the draft,
       named by their columns' common stem (PlusE2, Y2H), and a run warns when one condition mixes
       them; the E2 condition then scores exactly as the hand-written E2 design.
     - **Enrich2's estimator is REML where it has converged** (GRB2: 479 variants with epsilon 0,
       equal to metafor to 10⁻¹²), confirming research.md §2.1; elsewhere its answer depends on
       the table's size.
     - **dms_variants 1.6.0 adds no depth-scaled pseudocount**: its `func_scores` is Enrich2's
       wild-type ratio exactly, so it is a cross-check to machine precision, not "÷ ln 2".
     - **Shared inputs make replicates dependent** (BRCA1): the combined SE is then too small; runs
       say so. Wave 2's differential scores already plan for shared inputs.
     - MaveScape's default leaves out a replicate measurement with no input reads (the variant was
       not in that library); the Enrich2-compatible preset scores it from the pseudocount, as
       Enrich2 does. The difference is a parameter, recorded in each run.
6. **Quality control (Q1–Q7, Q9): done.** `web/lib/stats.js` (order statistics, Pearson and
   Spearman, AUC, a robust variance, a non-negative line fit), `web/lib/qc.js` (the metrics) and
   `web/lib/findings.js` (twelve findings, each pass, review, fail or not assessed, advisory or
   blocking, with its threshold, rationale, affected samples or replicates and plot; thresholds
   in the workspace, every change in its history), `web/lib/simulate.js` (built here for the
   fixtures: library, bottlenecks, selection with replicate noise, sequencing; seeded, labeled
   simulated), the score worker's `qc` message, `web/ui/plots.js` (bars, lines, scatter, class
   histograms, the filter flow, the coverage grid) and the QC view (`web/ui/mode-qc.js`): QC of a
   run or of the counts alone, the findings beside the overall status, each finding's detail and
   plot, the thresholds. From the counts alone: every sample has counts (blocking), depth, low
   counts before selection, missingness, missing after selection (dropouts), coverage of the
   designed substitutions by position, replicate agreement, variance beyond counting
   (bottleneck), outlier replicates. From a run: separation of the controls, resolution, variants
   scored.
   - Validation (suite `qc`, 15 checks): simulated experiments, three seeds each, raise exactly
     their findings: clean, none; poor replicate agreement; one failing replicate; a severe
     bottleneck; a low-count tail; a missing sample (blocking, with scoring refused and QC still
     run). The variance ratio follows a simulated bottleneck (about 1 + D/2N for N cells and D
     reads per variant; within 30%, low by up to 25% at 20 cells); QC is the same with rows and
     columns shuffled and with or without a run; thresholds act and are recorded. The feasibility
     data's findings are locked as found. 14 more unit tests (111 in all). In the window: GRB2 and
     BRCA1 (two conditions), counts-only and from a run, light and dark.
   - Found by slice 6:
     - **GRB2's replicate differences vary 11× more than counting predicts**, as from a
       bottleneck: the Domainome's own DiMSum analysis found an input bottleneck (its
       multiplicative error term about 6). MaveScape's REML τ² takes up the excess between
       replicates; DiMSum's error model (wave 2) will model it.
     - **BRCA1's table writes variants that dropped out as missing, never 0**: about 30% of the
       variants are missing from the E2 assay's last round, and they had already fallen to 1–3% of
       their input by the round before (others 12–54%). Missing is not zero, so they are not scored
       in that replicate and scores lean toward wild type, as in the published Enrich2 scores. A
       "missing after selection" finding now says so; reading such cells as 0, per sample, is an
       import option for wave 2 (time series).
     - **BRCA1's Y2H nonsense variants are not loss-of-function controls**: before residue 61 they
       score about −3.7, after residue 110 about +0.5 (truncations that keep the RING domain keep
       binding BARD1), so the controls' separation fails. Controls named by position (the design's
       explicit nonsense list) are the remedy; the finding's rationale says so.
     - **A bottleneck and replicate noise cannot always be told apart**: a bottleneck multiplies
       the counting variance, replicate noise adds a constant, and separating them needs counts
       spanning a wide range. The finding reports the split only when the counts allow it, and
       rests its verdict on the ratio.
     - A sample with every count missing is read by the importer as an empty column; scoring and QC
       now take it as missing counts (QC's blocking "every sample has counts"), not as text.
7. **The map and the inspector (V2, V3, V4, R3, T6): done.** `web/lib/map-model.js` (a run's
   single substitutions as positions × the 20 amino acids and stop; each cell's state: scored, low
   confidence, filtered, missing, not designed, reference residue; values by score, SE,
   replicates or input count; a scale centered on the wild type and symmetric; row orders
   biochemical, by hydrophobicity or alphabetical; position and row medians; the map in words),
   `web/lib/map-render.js` (the drawing, on any 2D context: states as their own marks, the
   summaries, target and reference numbering, the overview strip, selection, hover and focus;
   hit testing), `web/lib/map-svg.js` (SVG export, deterministic), `web/ui/variant-map.js` (the
   canvas: pan, zoom, hover, click and rectangle selection, the overview, full keyboard operation
   with each focused cell announced), the Map view (`web/ui/mode-map.js`: run and condition,
   color, rows, palette, legend with each state's count, saved selections, SVG and PNG export,
   the description and every cell as a table), the variant inspector (`web/ui/variant-inspector.js`:
   identifiers as written and canonical, score with SE and 95% CI or why it has none, flags, each
   replicate and every sample's counts, the position's other substitutions, the sequence around
   it, the run), opened from the map, its table and the Score view; named selections in the
   workspace and its history (`addSelection`, `removeSelection`). Runs' results are shared by the
   views (`web/ui/run-results.js`); results carry each sample's counts and each variant's
   residues.
   - Validation (suite `map`, 9 checks; `validation/bench.mjs` in CI): the fixture's map as SVG
     byte for byte against `golden/two-population.map.svg`; each state where the fixture plants
     it; one state per cell; missing, filtered and low-confidence cells at least ΔE 10 (CIEDE2000)
     from the neutral color in the light, dark and export themes and both palettes; the scale
     centered on the wild type; the row orders; GRB2's numbering (1–56 and 159–214); BRCA1's least
     tolerant positions. The benchmark: a simulated 5,000-residue target (105,000 variants) scored
     in 0.5 s, its map model in 26 ms, 0.6 ms of JavaScript per frame while panning (budgets 10 s,
     1 s, 16 ms); in the window, a frame of that map draws in 3–8 ms at the median (at 14- to
     2-pixel cells). 15 more unit tests (118 in all). In the window: BRCA1's two conditions, zoom,
     keyboard, rectangle selection, saved selections restored from the dataset tree, PNG export
     (7,464 × 954) under the page's security policy, light and dark.
   - Found by slice 7:
     - **The map agrees with the biology**: BRCA1's least tolerant RING positions (E2 binding) are
       C27, C47, C64 and H41, zinc ligands, and D96; the suite checks it.
     - **Missing cells looked like "no effect"**: drawn in the panel's hover gray, they were ΔE 2.7
       from the white of a wild-type-like score, and low-confidence cells near 0 ΔE 5, so a zoomed-
       out map (cells too small for their dot or mark) showed unmeasured variants as neutral. The
       map now has state colors of its own (`--map-empty`, `--map-hatch`, `--map-low`), checked to
       stay ΔE ≥ 10 from the neutral color.
     - BRCA1's table holds 7,682 multi-variants (error-prone PCR), which a substitution map cannot
       show; the map counts them and says so, and the Score view lists them.
8. **Record and examples (R1–R4, T4, D13): done.** `web/lib/archive.js` (the `.msz` archive:
   manifest with every file's SHA-256, the workspace, the tables or their checksums only, each
   run's scores, the methods; written deterministically, in any time zone; read defensively:
   known names only, sizes enforced while decompressing, every checksum and the history's chain
   checked, problems reported; an archive of a workspace already in the library opens as a copy),
   `web/lib/exports.js` (scores and counts in MaveDB's column layout, QC per sample and per
   variant, selections as CSV and JSON, provenance JSON; numbers in their shortest exact form),
   `web/lib/methods.js` (the methods paragraph from what the run did, with numbered references
   and BibTeX; CytoWeave's framework, MaveScape's text), `web/lib/examples.js` and
   `web/ui/examples.js` (two examples opened as new workspaces with a first run, and their guide in
   the inspector), `web/ui/record.js` (the archive and the run's exports in the window: the
   workspace menu, the Score view's Export menu, the Map view's selection export), the Start
   page's examples and blank layouts (`web/examples/layouts/`: count table, sample sheet, target
   FASTA, annotated), `docs/FORMATS.md`. Examples: **GRB2 SH3** (MaveDB's CC0 counts, unchanged,
   with its notice; opens in QC) and **a simulated experiment** (40 residues, three replicates,
   seed 20261009, labeled simulated; its true effects downloadable and compared with the scores in
   the guide; opens in the map). Structure 2VWF joins GRB2's example with wave 4.
   - Validation (suite `roundtrip`, 25 checks): the fixture and GRB2, as workspaces with a run, a
     selection and changed QC thresholds, saved as `.msz`, reopened (scores recomputed from the
     archived table, with the recorded output hash) and saved again: the same bytes; every export
     again byte for byte (scores, counts, QC per sample and per variant, provenance, methods,
     references, selection, map); checksums-only archives; exported scores read back to the last
     bit and import as MaveDB score tables; exported counts scored again give the run's output
     hash; an edited run, a rewritten history entry (with the manifest made to match), an altered
     table, a path out of the archive and a missing file are reported, and archives from a newer
     version, without a manifest, or inflating beyond their declared size are refused; the methods
     cite in order with a BibTeX entry each; the GRB2 example is MaveDB's file byte for byte and
     its design fits; the simulated example is deterministic, its scores correlate with the truth
     at r = 0.993 and its QC passes; the blank layouts make a valid design. 8 more unit tests (126
     in all). The built program serves the examples from its embedded files; in the window, both
     examples open and save, and an archive reopens as a copy whose map draws from the archived
     table.
   - Found by slice 8:
     - **MaveDB's upload layout was not recognized**: the importer knew MaveDB's downloads (with
       `accession`) only, so MaveScape's own exports, which follow MaveDB's upload layout
       (`hgvs_nt`, `hgvs_splice`, `hgvs_pro`), read as generic tables. Both are recognized now.
     - **ZIP dates are local times**: the same workspace archived in two time zones differed by a
       few bytes. Archives are dated in UTC; the same SHA-256 in UTC, Tokyo and Los Angeles.
     - The suite caught a blank layout whose example rows named residues its own example target
       does not have: layouts are checked as a whole, as a researcher would use them.
     - **First use left people stranded** (found testing the release candidate): a table or a
       FASTA opened in a new workspace loaded, and nothing said what came next. The workflow strip
       (`web/lib/workflow.js`, `web/ui/workflow.js`; 4 unit tests) shows the steps and the next
       action above every view, and explains blocked steps; a second launch says which files it
       handed to the running MaveScape.

Release 0.1.0 when the PRD's phase-1 exit holds: the whole workflow needs no command line, golden
and reference tests run in CI, and round trips lose no material data. **All three hold at the end
of slice 8** (validation suites `roundtrip`, `map`, `scoring`, `enrich2`; 211 checks in CI).

## 0.2.0: every design, checked (wave 2)

The other experiment designs of version 1, each against an independent reference, plus headless
runs and the performance targets.

### Wave 2

1. **Remote control, screenshots and the product site (M3; T4): done.** From CytoWeave 0.8.0:
   `remote.go` (actions posted to `/api/remote/action`, sent to the open page over server-sent
   events, one at a time, with timeouts; loopback peers and Host only; other web pages refused by
   the same-origin guard), `connection.go` (`<data-dir>/remote.json`, mode 0600, the address and a
   token, removed on exit), `output.go` (exports written to an absolute path through a temporary
   file, never replacing one unless asked), behind `--remote-control`; `actions.go`, the actions
   with their argument schemas (`GET /api/remote/tools`; the MCP tool list of wave 7), deciding
   which are long and which need the token. The page's `web/ui/remote.js` performs the 14 actions
   (`get_state`, `new_workspace`, `open_example`, `open_files`, `set_mode`, `focus`,
   `draft_design`, `set_design`, `score`, `qc_findings`, `select_variants`, `inspect_variant`,
   `render_map`, `export` of ten kinds) with forgiving names and errors that list the choices,
   logging each with its sender. To serve them, the views' work moved where scripts reach it: the
   record's exports make files without downloading them (`runFile`, `selectionFile`,
   `archiveFile`), QC computes outside its view into a shared cache (`computeQc`), the import wizard
   can accept what it detected, and `openExample` reports failure. `docs/capture/` (`cdp.mjs` from
   CytoWeave; `capture.mjs`: ten scenes driven by remote actions, each on a fresh library, light
   and dark `.webp` in `docs/images/`, optional axe-core audit). `docs/site/` (`build.mjs` from
   CytoWeave: Home, Install, Science and an eleven-page guide, with `<shot>` figures in both
   themes; every link, anchor and screenshot checked); published with `--publish` into a checkout
   of `gh-pages` (`../mavescape-site`). The README shows the map's screenshot.
   - Validation: 14 Go tests of the hub (an action and its answer, no page, one action at a time,
     a silent page and one that leaves, loopback and Host only, other web pages refused, the
     token for reading and writing files, paths checked before the page is asked, one upload per
     slot, the connection file private and removed, the action list served, and the page's
     action table and the hub's naming the same actions); `validation/remote-session.mjs` (54
     checks, CI job `remote`): every action in the built program and headless Chrome, the
     window's runs equal to Node's scoring by output hash, every export written by the hub byte
     for byte Node's from the exported archive, refusals and forgiving names; the site built in
     CI with no broken link, anchor or missing screenshot. 4 more unit tests (134 in all).
   - Found by slice 1:
     - **Scores depended on the browser.** The remote session's first run found the window's
       scores differing from Node's in the last bits: `Math.log`, `exp` and `pow` are
       implementation-approximated, and Chrome 154 and Node 22 disagree on about 2% of logarithms
       and 10% of exponentials. A run's output hash therefore depended on the browser, and a saved
       run could stop reproducing after a browser update; the simulated example's counts could
       differ by engine too. `web/lib/dmath.js` (fdlibm's logarithm and exponential in plain
       arithmetic, within one ulp, the same bits everywhere) replaces them in scoring, QC,
       statistics and simulation; `determinism.test.mjs` forbids the engine's functions there; the
       session checks a fingerprint in the browser; `SCORING_VERSION` is 2, and 0.1.0's runs
       reopen saying why their hash differs. The validation suites, all to 10⁻¹⁰ or tighter, pass
       unchanged.
2. **Time series (S6, Q10, E2): done.** `web/lib/score-regression.js`: weighted and ordinary least
   squares of each variant's normalized log count on time scaled to 0–1 (Enrich2's weights), on
   unevenly spaced times, fitted on the time points where the variant was counted (its first
   required, at least `minTimePoints`, default 3; fewer flagged low confidence, too few left out
   as "counted at too few time points"); the SE residual-scaled as Enrich2's, by default never
   below what counting alone predicts (`regressionSE: 'counting-floor'`); each fit's departure from
   a line against counting (χ²/df), reported, never used to remove a variant. `score.js`: `model`
   `ratio`, `wls` or `ols`, normalizers at every time point, `defaultParameters` (a time series of
   three or more times starts from WLS), refusals where a regression cannot be done; the
   Enrich2-compatible preset requires every time point and scales SEs by the residuals alone.
   "Missing = 0" is a per-sample setting of the design (`samples[].missingMeansZero`, the Experiment
   view), not an import option as planned: the run records the design, so the setting is recorded
   and QC reads the counts as scoring does (`replicates.js`, `sampleCounts`). QC (Q10): "Time points
   used" and "Fit of the time courses" (`qc.js`, `findings.js`), with plots. The Score view chooses
   the model and the SE; the variant inspector draws each replicate's time course with its fitted
   line; the run's description and methods paragraph say how it was fitted. `simulate.js` makes
   time series (growth, and an optional bottleneck at every passage), and a third example, a
   simulated time series with known truth. Remote control: `score` takes the model,
   `inspect_variant` reports each fit's time points and departure. Four new screenshot scenes; the
   site's scoring, QC, design and examples pages.
   - Validation (suite `scoring`, 37 more checks, 83 in all): the engine equal to Enrich2 2.0.2's
     WLS and OLS on BRCA1's E2 (six rounds) and Y2H (four unevenly spaced times) assays and on a
     new time-series fixture (`fixtures/make-time-series.mjs`: five unevenly spaced times, seven
     edge cases planted), to 5 × 10⁻¹³ over 32,000 replicate scores, and Enrich2's combination to
     5 × 10⁻¹³; to statsmodels 0.15 (`reference/generate_statsmodels.py`) on the fixture, slope,
     residual-scaled SE, departure and the counting SE (numpy), to 5 × 10⁻¹⁴; each edge case's
     points, state and flags; the simulated truth tracked (r = 0.999) and held by the 95% intervals
     more often with the counting floor; refusals; the defaults. `enrich2.json` regenerated with
     the fixture added, its other cases byte for byte unchanged. Suite `qc` (3 more, 18): a clean
     simulated time series raises nothing and one with a bottleneck at every passage raises the
     fit finding, on three seeds; BRCA1 E2 and Y2H by WLS, and E2 with "Missing = 0", as found.
     Suite `roundtrip`: the new example deterministic, r = 0.993 to its truth, QC passes.
     `remote-session.mjs`: 3 more (57). 5 more unit tests (139 in all).
   - Found by slice 2:
     - **Enrich2's residual-scaled SE is overconfident.** On the fixture's true effects, its 95%
       intervals hold the truth 69% of the time per replicate and 81% after combining, against
       83% and 90% with the counting floor: with three to five points, the residuals often
       understate the scatter, and the SE of a replicate that happens to fall on a line nears 0.
       The floor is MaveScape's default; the Enrich2-compatible preset keeps Enrich2's SE.
     - **BRCA1's E2 time courses scatter 7–10× more than counting predicts**, and the Y2H assay's
       about 30×: noise at each round of selection, consistent with wave 1's bottleneck finding.
       A quarter of the E2 fits miss their last rounds because dropouts are written as missing;
       with "Missing = 0" on its later samples every fit uses every round and 595 more variants are
       scored.
     - **Weighted regression gives zero counts little weight**, so reading dropouts as 0 changes a
       WLS score little; it matters most for the log ratio, which cannot score a variant missing
       from its last sample at all.
3. **FACS bins (S7, Q10).** `web/lib/score-bins.js`: weighted average of bin values (rank,
   fluorescence or other, recorded), the VAMP-seq procedure (frequency filter, nonsense = 0, WT
   = 1, replicates required), analytic SE and a seeded bootstrap, and the censored log-normal
   maximum-likelihood estimate (Peterman & Levine 2016) when cells sorted per bin and gate bounds
   are given. Bin occupancy and cells-per-bin diagnostics.
   - Validation: the VAMP-seq procedure equal to a reference script and CountESS's plugin; the
     MLE within 1e-4 of `fitdistrplus::fitdistcens`; the feasibility FACS dataset.
4. **Barcodes and scale (D8, D9, Q8, S8, S12).** Barcode count tables with a barcode-to-variant
   map; barcodes per variant, within-variant agreement, outlier barcodes, a barcode-disagreement
   filter; both aggregations (sum then score; score each barcode then combine). Templates for
   dms_variants' `variant_counts` CSV and Enrich2's per-library count files (D12). Columnar memory
   for a million rows; `validation/bench.mjs` gates the PRD's targets in CI.
   - Validation: equal to dms_variants `func_scores` by barcode and by substitution; benchmark
     numbers in `validation/README.md`.
5. **DiMSum's error model (S9, Q4).** `web/lib/score-dimsum.js`: DiMSum fitness with its
   dropout pseudocount and count filters, per-replicate scale and shift, the multiplicative and
   additive error terms, inverse-variance merging. Its multiplicative terms feed the bottleneck
   finding ("about m-fold more variance than counting alone").
   - Validation: exact against DiMSum 1.4's own functions with fixed parameters; the fitted
     parameters loosely against a full DiMSum run (`numCores = 1`).
6. **Two conditions (S10, E2).** Conditions in the design; per-condition runs; differential
   scores with a shared-input model (the naive SE overstates uncertainty when the input is
   shared), and limma contrasts (from CytoWeave's `limma.js`) as mutscan computes them.
   - Validation: Enrich2's between-condition z; mutscan `calculateRelativeFC` (limma) within
     1e-8.
7. **Headless runs (M2, M3).** On slice 1's hub, the `run.go` pattern: `mavescape run --design
   design.json --counts counts.csv --out results/` (validate first, deterministic outputs,
   `run.json` with input and output hashes, structured JSON logs, non-zero exit on blocking errors,
   `--from-workspace` reruns a saved run exactly) and `mavescape validate`.
   - Validation: `validation/headless-run.mjs` runs twice with identical outputs and once through
     the UI with the same results.
8. **Examples (T4).** Three more: Hsp90 (`00000011-a-1`, 8 generations, 568 variants) as the
   growth time series; Factor IX MultiSTEP (one readout) as the FACS-bin assay; and a simulated
   barcode map with conflicts plus a simulated problematic experiment (a bottleneck and a failing
   replicate), both labeled simulated. (No barcode-level counts are on MaveDB; Enrich2's example
   data are CC BY-SA, whose ShareAlike term should not enter an Apache-2.0 binary.) Each with its
   question, source and license, expected findings, opening view and a guided workflow under ten
   minutes.

## 0.3.0: public data in and out (wave 3)

MaveDB both ways, annotations beside the map, and the full variant grammar that public data need.

### Wave 3

1. **The allowlisted fetcher (P3, I3).** Port Proteoscope's `cache.go` and the download, limit
   and serve parts of `fetch.go` with one explicit host list (MaveDB, UniProt, RCSB, PDBe,
   AlphaFold DB, NCBI E-utilities, Ensembl, gnomAD); retrieval time and ETag in each record;
   `--offline`, `--no-fetch`, `--cache-dir`; size and decompression limits; confirmation before
   any request that would send a sequence; `docs/NETWORK.md` listing every request.
   - Validation: Go tests for the allowlist, redirects, limits, gzip bombs, offline and stale
     serving; a test that the page makes no request outside `/api/`.
2. **MaveDB import (I1).** Search (`POST /score-sets/search`, 100 per page) and fetch by URN
   (`mavescape --mavedb urn:mavedb:…`): scores, counts, metadata, targets (sequence or
   accession, with UniProt/RefSeq/Ensembl offsets), license and citation, published
   calibrations; counts mapped into a design with the same wizard; retries with backoff; cached
   for offline use. Records under CC BY-NC-SA or "other" licenses are shown with their terms.
   - Validation: the three feasibility records import through the UI with no dataset-specific
     code; imported scores equal MaveDB's; the PRD's phase-0 exit ("score agreement within
     documented tolerances") re-checked from the live import.
3. **Full MAVE-HGVS and variant mapping (D3, D10).** Multi-variants, insertions, deletions,
   delins, duplications, stop and start loss, splice; nucleotide-to-protein translation for
   nucleotide-level libraries (and synonymous collapsing, as DiMSum's); targets from GenBank
   files (a plasmid or construct map: the coding feature chosen, its translation checked);
   optional VRS identifiers from MaveDB's mapped variants.
   - Validation: every `mavehgvs` test case; every variant of the imported records parses.
4. **MaveDB export (I2, M2).** A MaveDB-ready package (scores and counts CSV, metadata JSON) from
   any run, with the analysis description written from the methods; `mavescape export --format
   mavedb`.
   - Validation: the package passes MaveDB's own validators (the `mavedb` package's models and
     `mavehgvs` strict mode, pinned; results committed as a reference); export → import → export
     is identical. Never sent to MaveDB's `/hgvs/validate` (unpublished data stay local).
5. **Sequence tracks and annotations (V5, I3, I4).** Tracks synchronized with the map:
   reference, coverage, position effect and uncertainty, UniProt domains, motifs and secondary
   structure, conservation (Jensen–Shannon divergence, Proteoscope's `conservation.js` and
   `msa.js`, from the AlphaFold DB alignment or the user's FASTA or A3M alignment), ClinVar
   observations, gnomAD frequencies, AlphaMissense and other imported predictors (their CSV/TSV
   downloads), custom tracks from CSV or GFF3 (UniProt's feature format) (for MaveDB
   records, MaveDB's own `clinvar`, `gnomad` and `vep` namespaces first); show, hide,
   reorder, filter, export; each record with source, version and retrieval date. Annotation
   providers behind one interface (`web/lib/providers/*.js`), cached and usable offline.
6. **Examples (T4).** The two-condition differential map (DHFR with Lon protease functional and
   deficient, `00000063-a-1`/`-b-1`) and the MaveDB round trip (BRCA1 RING), bringing the set to
   seven.

## 0.4.0: variants in 3D (wave 4)

Structure viewing as a full part of MaveScape: a variant-effect map seen on the protein, and the
structure used as evidence. The viewer is copied from Proteoscope (Apache-2.0, same author), with
an origin comment in each file, and runs without Proteoscope installed. It needs the fetcher of
wave 3 for PDB IDs and AlphaFold models; local files work offline.

### Wave 4

1. **The structure engine, copied from Proteoscope (X1).** From Proteoscope's `web/lib`, with
   their tests: `parse.js` (PDB, mmCIF), `bcif.js` (BinaryCIF), `structure.js`, `residues.js`,
   `elements.js`, `chemistry.js`, `dssp.js`, `math3d.js`, `camera.js`, `cartoon.js`, `scene.js`,
   `renderer.js` (WebGPU: impostors, ambient occlusion, outlines, picking, image capture) and
   `renderer-canvas.js` (the fallback for browsers without WebGPU), `surface.js`, `select.js`
   (the residue selection language), `coloring.js` and `colors.js`. Trimmed to what MaveScape
   uses (no ligand chemistry, density maps or prediction triage). The Structure view: open a
   local file, fetch a PDB entry or an AlphaFold model, biological assemblies, cartoon, surface,
   sticks for selected residues, labels, focus on a neighborhood.
   - Validation: Proteoscope's own tests for the copied modules pass here; every example's
     structure opens in both renderers.
2. **Target-to-structure mapping (X2).** Structures that cover the target ranked by PDBe SIFTS
   (`best_structures`) and the AlphaFold model; the target aligned to each chain's observed
   residues (`align.js`, BLOSUM62) with the UniProt offset; a mapping report (coverage,
   unmapped, ambiguous and mismatched positions, engineered mutations, gaps); switching between
   experimental structures and the AlphaFold model keeps the mapping.
   - Validation: mappings equal SIFTS for every example protein (GRB2 SH3 2VWF, BRCA1 1JM7,
     Hsp90 2CG9, DHFR 1RX2, Factor IX 1RFN) and their AlphaFold models.
3. **Scores on the structure (X3).** Residues colored by a position summary (median, mean,
   minimum, fraction abnormal-like, number of scored substitutions), one substitution, the
   uncertainty, a comparison's disagreement or the QC state, with the map's visual grammar:
   missing and filtered positions never in the neutral color; a legend; AlphaFold confidence
   shown beside. Selections are shared both ways: a map selection highlights residues, a picked
   residue selects its map column and fills the inspector. The view follows the active run and
   condition.
4. **Structure as evidence (X4).** Structure-derived position tracks beside the map: secondary
   structure (DSSP), relative solvent accessibility (`surface.js`), exposure and disorder (pPSE,
   Bludau et al. 2022, Proteoscope's `exposure.js`), AlphaFold pLDDT, distance to a partner
   chain or ligand and interface residues (contacts from `interactions.js`). Effects by
   structural class (buried, exposed, interface, disordered) with statistics, and spatial
   clusters of sensitive positions (a seeded permutation test against random positions of the
   same burial).
   - Validation: DSSP and solvent accessibility equal to the reference values Proteoscope's
     validation uses; the cluster test calibrated on simulated maps (false positives at the stated
     rate).
5. **Structures in the record (X5).** Structures stored in the library by SHA-256 and in the
   `.msz` archive (or referenced by ID with checksums); saved views (structure, chain, mapping,
   camera, style, coloring) reopen identically; high-resolution images with their legend as
   figure panels for wave 6; the mapping and structural tracks in the methods.
6. **Optional: open in Proteoscope (X6).** For Proteoscope's deeper analyses (interfaces,
   ligands, validation reports, superposition, maps), when it is installed: `handoff.go` finds a
   running Proteoscope and sends what it already accepts (a link with the structure and a
   residue-data session for the versions tested against; selection and binned colors by remote
   command otherwise; files as the last resort). Nothing else in MaveScape depends on it.
   - Validation: Go tests against a fake Proteoscope (tested version, unknown version, no remote
     control, absent).

## 0.5.0: compare (wave 5)

### Wave 5

1. **Comparisons (C1–C3).** A comparison engine that matches variants across replicates,
   conditions, assays, runs, local and MaveDB data, and predictors, with a compatibility report;
   synchronized and difference maps (and difference coloring on the structure), scatter plots
   with Pearson, Spearman, Lin's concordance and Bland–Altman, discordant-variant tables,
   position-level disagreement, confidence and depth filters; invalid comparisons blocked or
   qualified.
2. **Robustness to analysis choices (C4).** A run repeated across pseudocounts, normalizations,
   filters and combination methods (CytoWeave's `multiverse.js` pattern): which variants change
   class, which positions are sensitive. No DMS tool shows this.
3. **Selections (V3).** Freeform and query selections ("missense at 40–80 with SE < 0.2",
   "buried positions"), named sets, set operations, export.

## 0.6.0: figures and a provable record (wave 6)

### Wave 6

1. **Figure builder (R5).** Multi-panel figures from live views (maps, tracks, QC plots,
   comparisons, control distributions, structure images, variant evidence, text); SVG,
   high-resolution PNG, vector PDF, clipboard; embedded analysis metadata and a figure manifest;
   a reopened figure rebuilt from its inputs with differences reported (CytoWeave's
   `figure-provenance.js` pattern).
2. **Methods and citations, complete (R4).** Methods for every model, filter, comparison,
   annotation and structure mapping, retrieval dates, parameter tables, input checksums, version
   and commit, the decision log, QC findings, limitations and the research-use statement;
   regenerated on change.
3. **Checkpoints and semantic diff (R6).** What changed between two states of an analysis, and
   which variants it moved.
4. **Certificate and review report (R7).** A certificate that recomputes every reported number
   (`mavescape verify`, exit status as the verdict) and a self-contained HTML review report with
   every number traced.

## 0.7.0: agents and scripts (wave 7)

### Wave 7

1. **MCP server (M4).** `mavescape mcp` with the PRD's tools (`open_dataset`, `fetch_mavedb`,
   `describe_experiment`, `configure_design`, `run_qc`, `list_qc_findings`, `run_scoring`,
   `compare_runs`, `select_variants`, `inspect_variant`, `create_figure`, `export_results`,
   `write_methods`) plus `open_structure`, `map_structure` and `render_structure`. Design,
   filter, scoring, calibration and export changes arrive as proposals (CytoWeave's
   `proposals.js`); read-only tools run directly.
   - Validation: `validation/agent-session.mjs` runs every tool without a model.
2. **Python and R clients (M5).** Generated from `clients/tools.json` (CytoWeave's
   `generate.mjs`), installable from the repository; tested against a running build in CI.
3. **Docs:** `docs/MCP.md`, scripting guide, examples in notebooks.

## 0.8.0: calibration, for research (wave 8)

### Wave 8

1. **Control sets (K1).** Known-effect labels from ClinVar (with review status), user tables or
   published sets, each with provenance; circularity warnings (labels that informed the assay's
   design or thresholds, or predictors trained on the same labels).
2. **Metrics (K2).** Distributions by class, ROC and precision–recall with bootstrap intervals,
   thresholds and an indeterminate zone, sensitivity and specificity with Wilson intervals,
   threshold stability by seeded bootstrap.
3. **Evidence strength (K3, K4).** OddsPath (Brnich et al. 2019) and score-level
   likelihood-ratio calibration (Pejaver et al. 2022's local posterior; van Loggerenberg et al.
   2023), labeled research use only, with control composition and limitations in the report;
   classes exported in MaveDB's calibration vocabulary (normal, abnormal, not specified). ClinGen
   retired its SVI working group in 2025, so the method is chosen from the publications, and
   recorded.
   - Validation: equal to acmgscaler (MIT) on its examples; published calibrations reproduced
     (Fayer et al. 2021 for BRCA1, TP53 and PTEN; calibrations MaveDB publishes for its score
     sets); maveLLR (GPL-3) as an external reference only.

## 0.9.0: ready for others (wave 9)

The 1.0 candidate: what the PRD's phase 3 asks for beyond features.

### Wave 9

1. **Accessibility audit (T6).** axe-core on every view in both themes, keyboard operation of the
   map, structure view and tables, screen-reader descriptions, UI scaling.
2. **Workspace migrations (T7).** Schema version 2 if needed, with migrations and tests opening
   0.1–0.8 archives.
3. **Security review (T5, D11).** Fuzzing of CSV, FASTA, GenBank, HGVS, PDB/mmCIF, ZIP and design
   parsing (CytoWeave's `fuzz.mjs` pattern), request-forgery and token tests, path handling, a
   written review.
4. **Documentation complete, and teaching mode.** The site (begun in wave 2) reviewed as a whole:
   a full tutorial for each experiment type, every page's screenshots current. Exercises on the
   examples, as CytoWeave's: a question, hints, answers checked against the simulated truth (which
   the workspace never stores: it is regenerated from the exercise's seed), class codes.
5. **Agent benchmark (M6).** Graded tasks on the examples (CytoWeave's `benchmark/` harness).

## Toward 1.0

1.0 means, from the PRD's phase-3 exit:
- stable design, run and archive schemas, with a promise that later versions open them;
- a versioned HTTP and MCP API covered by the clients' tests;
- an external reproducibility review;
- at least two independent laboratories that analyzed their own data (the PRD's phase-2 exit),
  and three contributed fixtures or examples;
- automated, signed releases and documented exceptions to unmet metrics.

Beside waves 2–9, and what 1.0 most needs: find the two laboratories early (wave 2), and let what
they hit reorder the waves.

## Parking lot

- **WebMCP**, for the same reason CytoWeave parked it.
- **Publishing the clients** to PyPI and r-universe, until there are users (as CytoWeave).

## Ideas (unscheduled; the PRD's "future")

- Saturation genome editing, regulatory MPRA, combinatorial and haplotype libraries, base-editing
  screens; continuous phenotypes from many bins; Rosace's Bayesian time-series model.
- Protein-language-model-assisted interpolation of missing variants (a non-goal for version 1).
- Raw FASTQ processing (a non-goal: MaveScape starts from counts).

## Risks

| Risk | Why it matters | What MaveScape does |
| --- | --- | --- |
| Designs are more heterogeneous than expected | Schema fragmentation | Three deliberately different datasets fix the schema before any form (wave 1, slice 2); capability-based design |
| Scoring becomes a reimplementation trap | Long schedule, maintenance | Few transparent models, each against a pinned reference; imported scores accepted as they are |
| Reference tools have quirks | Agreement looks wrong or hides bugs | Enrich2's quirks reproduced in an explicit compatible mode and documented; defaults follow the papers |
| Drift toward clinical claims | Regulatory and trust risk | Terminology fixed in `conventions.md`; no automatic classification; calibration labeled research use |
| A second copy of Proteoscope's viewer to maintain | Fixes made in one app missed in the other | Copied modules carry an origin comment and Proteoscope's tests; fixes carried across; a shared package revisited at 1.0 |
| WebGPU is not in every browser | The viewer's best renderer unavailable | Proteoscope's Canvas renderer as the fallback, as Proteoscope does |
| Proteoscope's session format may change | The optional handoff loses its values and legend | Used only for Proteoscope versions tested against; commands and files as fallbacks; MaveScape's own Structure view does not depend on it |
| Barcode-scale tables in the browser | Memory and speed | Streaming parse, columnar arrays, workers, a million-row benchmark gated in CI |
| Public APIs change | Broken imports and tracks | Provider adapters, cached records with retrieval metadata, recorded fixtures, graceful degradation |
| Color maps overstate certainty | Misinterpretation | Separate state patterns and uncertainty channels; missing never neutral |
| Licensing of reference code | GPL tools (dms_variants, dms_tools2) in an Apache-2.0 project; CytoWeave's `limma.js` follows GPL limma closely (an open decision there) | GPL tools used only as external references in validation; no code ported from GPL sources; the limma question settled before wave 2, slice 6 reuses `limma.js` (reimplement from the publications if needed) |
| One developer | Adoption and continuity | Validation and documentation that let others check and continue; external labs from wave 2 |
