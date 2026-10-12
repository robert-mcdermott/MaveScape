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

The first users are laboratories that have their own counts. They need to know whether to trust
them, compare reasonable analyses and produce results they can defend. Other tools serve other
needs: MaveDB shows published maps with their structures, and CountESS offers graphical DMS
workflows. A graphical interface or a colored structure does not set MaveScape apart. Checking an
experiment, and showing which conclusions survive other analysis choices, does.

## How the waves map to the PRD's phases

| PRD phase | Waves | Releases |
| --- | --- | --- |
| Phase 0, feasibility spike | wave 1, slice 2 (before any UI form) | inside 0.1.0 |
| Phase 1, vertical slice | wave 1 | 0.1.0 |
| Phase 2, research beta | waves 2–6 | 0.2.0–0.6.0 |
| Phase 3, 1.0 | waves 7–9, then 1.0 | 0.7.0–0.9.0, 1.0.0 |

The PRD puts MaveDB import in phase 2 and the MCP server in phase 3. This plan keeps that, with
these changes:
- the remote-control hub arrives first in wave 2, because the documentation's screenshots, headless
  runs and later agents all drive the page through it (as in CytoWeave, `mavescape run` and the
  capture script drive the same page agents will);
- the product site (GitHub Pages) and its screenshot capture start in wave 2 and grow with every
  wave, rather than arriving in wave 9;
- structure viewing is a full part of MaveScape (wave 5), not the PRD's "lightweight view", because
  MaveScape must stand on its own. The viewer is copied from Proteoscope; Proteoscope is never
  required. The PRD's first milestone ends with "open selected residues in Proteoscope"; here wave 1
  ends with the record and examples, and residues on a structure arrive with wave 5;
- comparison and robustness to analysis choices (wave 4) come before structure (wave 5). The order
  was changed on 2026-10-09 after a researcher's review: robustness is what no other DMS tool
  shows, and a laboratory checking its own experiment needs it sooner than a structure, while MaveDB
  already shows published maps on structures;
- the PRD's exits that need outside laboratories (phase 2's, and two before 1.0) gate no wave or
  release here: the maintainer arranges them outside this plan ("Toward 1.0");
- also from that review, wave 2 gains three slices before its examples:
  - one records what the assay measures;
  - one checks that the intervals hold the truth as often as they claim, since matching the
    reference tools shows only that MaveScape computes what they compute;
  - one helps a researcher assemble a complete package for analysis.

## Decisions taken in this plan

The PRD lists decisions to make before implementation. Proposed answers, to confirm:

| Decision | Proposal |
| --- | --- |
| Product and executable name | **MaveScape**, `mavescape`; Go module `mavescape`; archives `.msz` |
| A shared suite UI package | Not now. Copy CytoWeave's and Proteoscope's modules with an origin comment in each file; revisit at 1.0 (`design.md`). |
| First scoring reference | **Enrich2 2.0.2** (Python 3, BSD-3, `pip install enrich2`): ratio, WLS and random-effects combination. Cross-checked by dms_variants `func_scores`. DiMSum 1.4 for its error model (wave 2). |
| Three feasibility datasets | Done (wave 1, slice 2): all CC0 on MaveDB, with counts, deliberately different (`research.md` §3): **GRB2 SH3** (Domainome, `urn:mavedb:00000835-a-1`; two populations × 3 replicates; scored by DiMSum), **BRCA1 RING** (`urn:mavedb:00000003-a-1`/`-a-2`; 6 replicates × 6 rounds, inputs shared, plus a Y2H assay in the same table; scored by Enrich2, so its published scores are a reference too; legacy HGVS), **Factor IX MultiSTEP** (`urn:mavedb:00001200-a-1`; 4 FACS bins × 3 overlapping tiles × 3 replicates). |
| Design schema before UI forms | Yes: wave 1, slice 2 writes `mavescape-design` v1 and represents the three datasets in it before slice 4 builds the editor. |
| Structure viewing and Proteoscope code | A full Structure view in MaveScape (wave 5), copied from Proteoscope (Apache-2.0, same author): its parser, WebGPU renderer with Canvas fallback, cartoon, surfaces, DSSP, selection language, coloring and alignment. No runtime dependency on Proteoscope; an optional "Open in Proteoscope" for its deeper analyses. |
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
- **Archives that keep opening.** Researchers keep workspaces from the first release, so every
  release saves a workspace archive (an example, scored, with a selection and changed QC
  thresholds) as a fixture under `validation/archives/`. Every later version must open each fixture
  and reproduce its runs to their recorded hashes. The exception is 0.1.0's runs: that release
  used the browser's own logarithms, so its runs reproduce only to their last digits, and they must
  say so. Wave 9's migrations (T7) build on these fixtures; they do not start them. The 0.1.0
  fixture comes first, in wave 2, slice 8.

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
   the guide; opens in the map). Structure 2VWF joins GRB2's example with wave 5.
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
runs and the performance targets. Then the scores are given their meaning: what the assay
measures, and intervals checked against the truth.

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
3. **FACS bins (S7, Q10): done.** `web/lib/score-bins.js`: the weighted average of the bins' values
   over each variant's bin frequencies (VAMP-seq), its SE by the delta method from counting (a
   pseudocount in the SE only) or a seeded parametric bootstrap; the censored log-normal
   maximum-likelihood estimate (Peterman & Levine 2016) from the bins' gates, σ the wild type's or
   each variant's own, reads reweighted by the cells sorted into each bin and the information
   limited by the scarcer of reads and cells, the SE from the observed information; each
   replicate's scale (nonsense median 0 and wild type 1, VAMP-seq; the lowest 5% median 0 and wild
   type 1, MultiSTEP; none). `score.js`: models `bins` and `bins-mle`, the VAMP-seq preset (summed
   bin frequency ≥ 10^-4.75, two replicates, the mean), refusals. `replicates.js`: the mean
   combination (SE = SD/√k). `dmath.js` gains erfc and the normal distribution (the same bits
   everywhere), `random.js` the Poisson sampler. Filters: the minimum summed bin frequency, and
   states for bins with too low a frequency or no estimate. The design: each bin's gates
   (`lower`, `upper`), the cells sorted per sample; the Experiment view edits both. QC (Q10):
   "Occupancy of the bins" and "Cells sorted per variant"; replicate agreement, variance beyond
   counting and outlier replicates from the bins' weighted averages; replicates compared within
   their tile. The Score view's bin parameters; the inspector's distribution over the bins; the run's
   description and methods (two references, checked against Crossref). `simulate.js` sorts cells
   by gates into bins; a fourth example, a simulated sort with gates and cells. Four screenshot
   scenes; the site's scoring, QC, design and examples pages.
   - Validation (suite `scoring`, 12 more checks, 95 in all): factor IX's published MultiSTEP
     scores (urn:mavedb:00001200-a-1) reproduced from its counts, every replicate score of 9
     replicates on the variants the authors kept to 1.3 × 10⁻¹⁵ (29,325) and the combined scores
     and SEs exactly; through the engine with MultiSTEP's settings within 2 × 10⁻³ (the authors'
     filter used data not in the table); the MLE against fitdistrplus 1.2.6 `fitdistcens`
     (`reference/generate_fitdistcens.R`) on a simulated sort (`fixtures/make-sort-seq.mjs`), σ
     free and fixed, μ and σ to 3 × 10⁻⁷ over 4,800 fits, the SE to 0.07%; the simulated truth
     (MLE r = 0.996, weighted average 0.989; the MLE's intervals hold it 87% after combining); the
     bootstrap equal to the analytic SE and repeatable; the scales exact; refusals. Suite `qc`
     (3 more, 21): a clean sort raises nothing, too few cells and a nearly empty bin raise theirs,
     on three seeds; factor IX as found. Suite `roundtrip`: the sort-seq example as it teaches.
     `remote-session.mjs` 2 more (59). 7 more unit tests (146 in all). Not done as planned: a
     comparison with CountESS's VAMP-seq plugin; reproducing a laboratory's own published scores
     checks the same arithmetic against real outputs instead.
   - Found by slice 3:
     - **Factor IX's published scores are VAMP-seq's arithmetic with another scale**: frequencies
       over the variants kept, the rank-weighted average, then wild type 1 and the median of the
       lowest 5% (not nonsense) 0, per replicate; combined by the mean, SE = SD/√k. Reproduced
       exactly; the authors' filter used data MaveDB does not carry (most likely the unsorted
       library).
     - **fitdistcens' default start ignores the weights**: from it, Nelder–Mead stopped far from
       the maximum (μ 3.06 against 5.31) for variants with nearly all reads in an outer bin. The
       reference starts from the weighted bins' midpoints, as MaveScape does.
     - **The cells, not the reads, limit a sort**: factor IX was sequenced to about 10,000 reads per
       variant per bin, and its replicates differ about 2,000× more than counting predicts. The MLE
       limits its information by the scarcer of reads and cells (its intervals held the truth 57%
       of the time from reads alone, 78% per replicate with cells), and QC reports the cells per
       variant when the design records them.
4. **Barcodes and scale (D8, D9, D12, Q8, S8, S12): done.** `web/lib/score-barcodes.js`: a barcode
   table's rows grouped by variant (by MAVE-HGVS key, however written; blank names unmapped), counts
   summed per variant (missing never 0), every barcode scored against its replicate's normalizers
   from the summed counts, its departure from its variant's other barcodes over √φ (φ the median
   squared departure over the median of χ²₁, at least 1), outliers beyond 4 (or the filter's
   maximum) set aside one at a time, a variant's barcodes combined by REML, fixed effects or their
   mean. `score.js`: aggregations `sum` and `barcode` (refused for sorted bins, which are summed),
   the barcode filters (minimum barcodes; the departure beyond which outliers are left out), a
   barcode stage and state, results with each barcode's score, SE, state, departure and outlier
   mark. `web/lib/barcodes.js` (import): a barcode-to-variant map applied, a barcode given two
   variants left unmapped and listed; dms_variants' `variant_counts` made one row per library and
   barcode, its substitutions named in MAVE-HGVS; Enrich2's element names and headerless maps.
   `web/lib/assemble.js`: a source's table assembled from its files (joined per-sample files,
   dms_variants' layout, Enrich2's counts, DiMSum's and a map's sequences named, the map applied),
   by the wizard and again whenever the source is read (which also fixed joined and DiMSum sources,
   which could not be read again). The design's `library.barcodeColumn`; the Experiment view's
   rows. `csv.js`: columns built as rows are read, a column of numbers kept as numbers only
   (`cellText` gives the text back): a million rows in a second and 85 MB (500 before). QC (Q8):
   "Barcodes the map names", "Barcodes per variant", "Agreement of a variant's barcodes" (φ and the
   split-half r) and "Outlier barcodes", from the counts alone. The import wizard's file parts,
   rows, barcode and map columns; the Score view's barcode parameters and filters; the inspector's
   barcodes per replicate; the barcodes export; remote control's barcodes. Workers end when idle.
   A fifth example, a simulated barcoded library with a map in conflict (moved here from slice 8);
   three screenshot scenes; the site's opening-data, scoring, QC, examples, record and science
   pages; FORMATS.md.
   - Validation (suite `scoring`, 16 more checks, 111 in all): a simulated barcode fixture
     (`fixtures/make-barcodes.mjs`, 4,608 barcodes in two libraries, a map with 63 conflicts and
     42 gaps, 2% outlier barcodes) against dms_variants 1.6.0 `func_scores`
     (`reference/generate_dms_variants.py`): every barcode by barcode to 4.8 × 10⁻¹³, every
     variant's summed counts exactly and its score by `aa_substitutions` to 4.4 × 10⁻¹³; the same
     scores through dms_variants' own `variant_counts` (written by it) and Enrich2's layout; the
     truth (by barcode with REML r = 0.990 against the sums' 0.977, intervals holding 94%; 76% of
     planted outliers found, 0.05% of the others called); row order; refusals. Suite `qc` (5 more,
     26): clean, clonal, outlier, map and single-barcode libraries raise exactly theirs on three
     seeds. Suite `roundtrip`: the barcoded example from its files. `remote-session.mjs` 4 more
     (63): the example scored by barcode in the window with Node's hash, its barcodes exported
     byte for byte. 15 more unit tests (161). `validation/bench.mjs` (CI): a million barcodes and
     their map imported in 3.5 s, the process at most 830 MB (budgets 15 s, 1 GB), scored in 1.3 s
     either way; 105,000 variants × 6 samples in 0.5 s. `validation/browser-bench.mjs` (CI): the
     same in the window, 3–4 s and the browser's memory up by about 600 MB at most.
   - Found by slice 4:
     - **One outlier barcode makes its siblings look off** when each is compared with the others'
       mean: the outlier pulls that mean. Set aside one at a time, worst first, the siblings
       compare cleanly; φ comes first, from every barcode, by a median that the outliers barely
       move.
     - **Holding a table's text cost five times its numbers**: an array of strings per row and per
       cell held 500 MB for a million rows; columns of numbers as Float64Arrays alone hold 85 MB.
       In the window, a worker's heap kept a large parse's memory until the worker ended; workers
       now end when idle (750 MB held after the import before, 190 MB after).
     - **dms_variants groups synonymous variants with the wild type** by `aa_substitutions` (both
       empty), and its wild-type normalizer is the codon-identical barcodes (without
       `syn_as_wt`). MaveScape names synonymous variants by their codons (`p.Ala2=`), so the wild
       type's barcodes, and every other substitution, compare exactly; the empty group does not.
5. **DiMSum's error model (S9, Q4): done.** `web/lib/score-dimsum.js`: DiMSum 1.4's fitness (no
   pseudocount, a zero count no estimate; the dropout pseudocount for outputs of 0), its input
   threshold (R's type-7 quantile), each replicate's scale and shift (DiMSum's sum of distances to
   the replicates' mean, minimised by BFGS with its gradient where DiMSum uses `nlm`), the error
   model σ² = a(m_in/N_in + m_out/N_out) + e over every subset of two or more replicates with
   DiMSum's weights, and σ without it. The model is linear in its terms, so it is fitted exactly
   on every variant by bounded least squares (Lawson and Hanson's active set) where DiMSum averages
   100 `nls` fits of bootstrap samples; a seeded bootstrap gives the 10th–90th percentiles.
   `score.js`: the model `dimsum` (two populations only; refused for barcodes scored one by one),
   `dimsumNormalise`, `dimsumErrorModel`, `dimsumDropout`, a DiMSum-compatible preset (fixed
   effects, no input-count filter), refusals with reasons (no wild-type reads; fewer than 30
   variants per replicate to fit), and each replicate's fitted model in the results and the run
   record. QC (Q4): "Variance beyond counting" fits the model to the counts alone and says where
   the excess is, input or output, with a plot of the terms. The Score view's *Scored by*, DiMSum's
   switches and the replicates' table of scales, shifts and terms with their percentiles; the
   methods give the fitted values; remote control's `score` returns them. The GRB2 example's
   guide scores with the preset; two screenshot scenes; the site's scoring, QC, examples,
   getting-started, scripting and science pages; FORMATS.md.
   - Validation (suite `scoring`, 18 more checks, 129 in all): `reference/generate_dimsum.R`
     sources DiMSum 1.4's own functions (from its release, by checksum) and records, for GRB2,
     DiMSum's demo (TDP-43, four replicates, every 8th row) and a fixture with zero counts and
     dropouts planted (also with a dropout pseudocount of 1): the threshold, the variants fitted,
     `nlm`'s scales and shifts, the error model fitted by DiMSum's `nls` on every variant and its
     100 bootstrap fits, and `dimsum__calculate_fitness` and its merge given those parameters.
     MaveScape: the threshold within 1.5 × 10⁻¹⁶, the same variants (193, 602, 378), the scales
     and shifts within 4.5 × 10⁻⁷ (2.6 × 10⁻⁴ on the fixture, where `nlm` stopped early) at a
     minimum never above `nlm`'s, the error model within 4.3 × 10⁻⁶ of DiMSum's fit and inside its
     percentiles, every fitness and σ within 8 × 10⁻¹³ and the merge within 6 × 10⁻¹³. GRB2 follows
     its published scores (r = 0.994). On a simulated bottleneck (25 cells per variant, three
     seeds), DiMSum's 95% intervals hold the truth 93–96% of the time, counting alone with fixed
     effects 67–69%, with REML 87–88%. The engine equals the group fitted directly; refusals.
     Suite `qc` (1 more, 27): the terms locate simulated bottlenecks, input terms near 1 + D/N
     before selection (1.7, 5.1, 10.4 against 2, 5, 11) and output terms after it.
     `remote-session.mjs` 1 more (64): the DiMSum preset in the window with Node's hash and terms.
     6 more unit tests (167).
   - Found by slice 5:
     - **DiMSum's threshold sits on a count.** It is often a ratio of counts: exp(−log(1/112)) is
       112 within a unit of its last bit, below 112 in R and above it in JavaScript, so variants
       with exactly 112 input reads were fitted by one and not the other, moving the scales by
       0.2%. A count within 10⁻¹² of the threshold counts as above it, the same everywhere.
     - **`nlm` can stop short.** On the fixture it stopped with code 3 (no lower point found) at
       22.67239435957; the minimum is 22.67239435541 (MaveScape's BFGS, and R's Nelder–Mead from
       there). The check is that MaveScape's minimum is never above `nlm`'s. The sum of distances
       has kinks where its gradient never vanishes, so BFGS stops after five iterations without a
       change (it ran its 2,000 before, and QC took 13 s for 3).
     - **The error model has one answer.** It is linear in its terms with lower bounds, so its
       least-squares fit is unique; DiMSum's mean of 100 bootstrap fits from random starts
       differs from it by the bootstrap's noise, while DiMSum's own `nls` on every variant equals
       it to 4 × 10⁻⁶.
     - **DiMSum's "90% interval" is the 10th–90th percentiles** of its bootstrap fits, an 80%
       interval; MaveScape names them as what they are.
     - **A bottleneck shared by every replicate is missed by REML in part.** Its τ² sees only
       the disagreement between replicates, not the noise they share through counting too few
       cells; DiMSum's multiplicative terms put it into each replicate's SE.
6. **Two conditions (S10, E2): done.** `web/lib/differential.js`: each condition against the
   reference (the condition marked so in the design, else the first), by one of three methods
   (`differential`): limma's moderated t on voom log counts, a term for each input library and
   for selection in each condition, relative to the wild type or the synonymous variants' summed
   counts (their sums scaled to the libraries' geometric mean, as edgeR's scaleOffset does for
   mutscan), as mutscan's calculateRelativeFC(method = "limma") computes it; replicates paired by
   their shared input (and tile), each pair's difference with the input's counting error taken out
   (rescaled scores compared as rescaled), the pairs combined as the run's replicates; the
   conditions as independent (Enrich2's z). Two-sided p (normal, or t for limma) and
   Benjamini–Hochberg q per contrast. `web/lib/limma.js` (Cleveland's lowess, voom with limma's
   adaptive span, weighted least squares per row, contrasts with the design's correlation as
   limma documents, empirical Bayes moderation) and `web/lib/distributions.js` (ln Γ, digamma,
   trigamma and its inverse, the incomplete beta, Student's t and its quantile, the normal
   quantile AS 241, BH), written from the publications: CytoWeave's `limma.js` was written from
   limma's GPL source and is not used (the risk below, settled). `score.js`: the parameter
   (null by default, so runs made before keep their hashes; `defaultParameters` sets limma where
   it applies, paired otherwise, independent for the Enrich2-compatible preset), refusals with
   reasons, results per contrast in the run's output hash. The simulator's two conditions from
   shared inputs. The map's differential coloring (V2), the inspector's "Between conditions", the
   Score view's comparison pane (volcano plot, largest differences) and select, the differential
   export, the methods (Smyth 2004, Law et al. 2014, Soneson et al. 2023, Benjamini and Hochberg
   1995), remote control. A sixth example (a simulated ligand-binding site, opening on its
   differential map); two screenshot scenes; the site's scoring, map, experiment, examples,
   record, scripting and science pages; FORMATS.md.
   - Validation (suite `scoring`, 14 more checks, 143 in all): a two-condition fixture
     (`fixtures/make-two-condition.mjs`: one input per replicate selected under two conditions, a
     fourth replicate without a partner, five edge cases planted) against mutscan 1.2.0
     (`reference/generate_mutscan.R`, limma 3.68.5, edgeR 4.10.5): every log fold change and t
     within 1.8 × 10⁻¹⁰, SE, p, adjusted p and interval within 1.2 × 10⁻¹², the same 836 rows and
     prior; against Enrich2 2.0.2 (`generate_enrich2.py`, the experiment run through its API and
     calc_pvalues_pairwise called): both conditions' combined scores and |z| and p within
     5 × 10⁻¹³; the paired differential from first principles within 10⁻¹⁵; the per-condition
     scores unchanged by the differential, which enters the hash only when asked; the defaults;
     the edge cases; the truth on three seeds with shared inputs and a bottleneck (paired intervals
     95–97%, limma 97–98%, independent 99–100% and fewer found) and with noise between replicates
     (limma 93–98% and ≤ 0.4% of nulls called; paired 82–94% and 1–11%). External: CBS at low and
     high vitamin B6 (MaveDB urn:mavedb:00000005-a-5 and -a-6, joined on hgvs_nt, four shared
     inputs): limma against mutscan on 9,409 rows within 4.1 × 10⁻¹¹; independent SEs a median
     1.11× the paired. Suite `roundtrip` (7 more, 36): the new example, and a two-condition
     workspace saved, reopened and exported again byte for byte, its differential export with it.
     `remote-session.mjs` 5 more (69): the example in the window with Node's hash, its
     differential map, a variant's difference and the differential export as Node's. 17 more unit
     tests (178).
   - Found by slice 6:
     - **CytoWeave's `limma.js` follows limma's GPL source**, so it was not reused (the risk below);
       limma's statistics were written again from the papers and matched to R black-box, each
       convention found by experiment rather than read from limma.
     - **voom's span is not 0.5** in limma 3.68: `adaptive.span` is on by default and the span is
       min(1, 0.3 + 0.7 (50/n)^⅓) for n rows (chooseLowessSpan): 0.65 for 400 rows. With 0.5 the
       trend was 2.4% off.
     - **limma floors small residual variances at 10⁻⁵ of their median** when it estimates the
       prior. The wild type's own variance is nearly 0 when it is the normalizer, and its ln s² of
       −17 would otherwise pull the prior df from 5.7 to 3.2.
     - **mutscan's library sizes with WTrows** are the wild type's sums scaled to the libraries'
       geometric mean (edgeR's scaleOffset); its pseudocount argument does not reach limma, whose
       voom adds 0.5.
     - **Enrich2's command never compares conditions** (calc_pvalues_pairwise exists but
       `calculate` does not call it: issue #59), and with several conditions its random-effects
       estimator starts every condition from the variance over the variants combined in any
       condition. MaveScape used each condition's own count (1.5 × 10⁻⁵ apart); it now uses
       Enrich2's.
     - **Paired REML calls too much with three pairs** when replicates disagree beyond counting:
       τ² is poorly estimated from three differences (7–11% of nulls called in two seeds of
       three). limma's variances, moderated across variants, stay calibrated, so limma is the
       default where it applies.
     - **A single wild-type normalizer's own noise moves every difference of a pair together**
       (an offset of 0.2 in one simulated seed): neither the paired SE nor τ² sees it.
       Normalizing to the synonymous variants averages it out.
     - **"Shared samples" warned about inputs shared between conditions**, which the differential
       is built on; it now warns only of sharing within a condition.
     - **CBS's two MaveDB records share their non-selected samples** (identical wherever both count
       a variant): one set of inputs selected at two B6 levels. The low-B6 record's select5–8 are
       at a concentration the record does not give, so they are not used.
7. **Headless runs (M1, M2): done.** `run.go` (CytoWeave's pattern): `mavescape run --design
   design.json --out results/ counts.csv [map.csv]` starts MaveScape on a private port with a
   temporary library, opens it in headless Chrome (Chromium, Edge, Brave; `--chrome`, `CHROME`),
   and performs through the hub: a workspace named after the design, the files opened, the design
   set (the workspace given the design's target when it has none), the `check` action (names
   against the target, the design against the columns, the parameters against the design: nothing
   scored when anything blocks), `score` (`--preset`, `--parameters`), `qc_findings`, and the
   exports (scores, a file per condition; counts; QC; barcodes; differential scores; the map;
   provenance; methods and references; the workspace archive), then `run.json` (inputs and outputs
   with SHA-256, each step, the run, its QC, the browser and its starts). `--from-workspace` opens
   an archive and `reproduce_run` recomputes the run from its recorded inputs: it must have its
   recorded output hash. `--time` (or SOURCE_DATE_EPOCH) fixes the session's clock
   (`web/lib/clock.js`, `?clock=`): every record's time, and identifiers counted from the start,
   so every file is the same bytes. `--log json`; `--strict`; `--overwrite`; exit 0 done, 1 not
   done or a blocking problem (a design that does not fit, parameters that cannot score, a run
   that does not reproduce, a blocking QC finding), 2 a wrong command line, a missing input, an
   output folder in use, no browser. `mavescape validate [--design] [--target] [--parameters]
   [--json] [tables]` (M2's validate; its export is wave 3). The remote actions `check` and
   `reproduce_run`; each run's summary says what its files are. The scripting, install,
   troubleshooting and science pages, FORMATS.md (run.json), the README; no screenshot scene (the
   commands have no window: the guide shows their output).
   - Validation: `validation/headless-run.mjs` (18 checks, in CI's `remote` job): the GRB2
     example twice with `--time` (every file the same bytes, the provenance and the archive
     too), with SOURCE_DATE_EPOCH (the same), and with no fixed time (the results the same, the
     provenance differing only in its times and identifiers); the run's archive recomputed in Node
     (the output hash recorded; scores, counts, QC, map, methods, references as Node writes them);
     the same analysis through remote control in a window (the same files); `--from-workspace` (the
     same bytes) and a tampered archive refused; two conditions (a scores file per condition, the
     differential scores) and a table of barcodes with its map (the barcodes export), as Node
     writes them; each failure with its exit status and run.json's reasons; the JSON log; and
     `validate` (valid, not valid with `--json`, a design alone, parameters, a wrong command line).
     Go tests (`run_test.go`): the arguments, the clock, file names, a browser that does not start.
     `remote-session.mjs` 2 more (71): `check` and `reproduce_run` in a window. One more unit
     test (179): the session clock.
   - Found by slice 7:
     - **The results were deterministic, the records were not:** the scores, counts, QC, map and
       methods came out the same bytes, but each record took the wall clock's time and random
       identifiers, so two identical runs wrote different provenance and archives. A session
       clock that a headless run fixes makes every file the same; without one, records keep the
       real time.
     - **A name shared by two summaries hid a file:** the `score` action's per-comparison summary
       was also called `differential`, overwriting the run summary's flag of that name, and the
       differential scores were not written. The flag is now `comparesConditions`, and a summary
       that cannot be read stops the run rather than writing fewer files.
     - **A headless page occasionally did not start, or stalled** (macOS, a fresh profile; the
       Keychain is the likely wait). Chrome now starts with a mock Keychain and without background
       networking, a page that has not connected in 20 s gets a new browser (up to three), and
       run.json records how many starts it took.
     - **A column missing from the table was reported twice,** by the table's review and by the
       design's check; it is now said once, by the design.
     - The requirement numbers: `mavescape run` is M1 and `validate` M2 (this slice's heading said
       M2, M3).
8. **What the assay measures, and findings in context (E7, Q11; E2, V2, Q5, Q9, R4, T7): done.**
   - **The 0.1.0 archive as a fixture.** `validation/archives/grb2-0.1.0.msz` was written by 0.1.0's
     own code from a v0.1.0 checkout (`archives/make-0.1.0.mjs`): GRB2 scored twice, a selection, a
     changed threshold. The `roundtrip` suite opens every archive there and recomputes its runs
     through `reproduction` (`web/lib/runs.js`, now shared with the window).
   - **The readout.** `web/lib/readout.js` holds MaveDB's controlled keywords and the design's
     `readout`: `phenotype`, `method`, `mechanism`, `modelSystem` and `direction`
     (`higher-more`, `higher-less`, `unsigned`). `library.method` records how the library was made.
     They are checked by `validateDesign` (a term outside MaveDB's lists is kept, with a warning),
     edited in the Experiment view's *What the assay measures*, and described in the design's
     summary and the methods. The readout drives the map's legend ("blue is less function, red more
     function", or plain "lower" and "higher"; the palettes are named by color only), and the side
     the separation finding expects. GRB2's example states its readout, MaveDB's tags for a
     DHFR-PCA abundance assay (Reporter, loss of function, yeast); the simulated examples state
     theirs.
   - **Controls that fit the assay.** `controls.positions` limits a class to the positions where it
     serves, and `controls.why` says why. `controlRows` applies the limits, so normalization,
     rescaling and QC use them.
   - **Findings in context.** `web/lib/advice.js` gives every finding to review or failing its
     causes (experiment, analysis, expected) and next steps (look, analysis, experiment), read with
     the design's context (`qc.context`). The separation finding:
     - reads the direction, and when it is not stated and the nonsense variants score on the other
       side, says so;
     - finds where stops stop losing the function, by one change point in the stops' scores along
       the target, and suggests the limit.

     Coverage of a single-base library (error-prone PCR, doped oligos) with a DNA target is judged
     against the substitutions one base change makes.
   - **Acknowledgements** (`ws.qc.acknowledged`, `acknowledgeFinding`) keep a finding's status and
     hold while it is no worse. They are recorded in the history, the methods, the provenance and
     the new `qc_findings.csv` export. They are made in the QC view, by `acknowledge_finding` and by
     `mavescape run --acknowledge id=reason`; `--strict` fails only on unacknowledged failures.
   - Validation:
     - `qc` 33 checks:
       - every raised finding of the planted problems has causes and next steps;
       - a selection enriching loss of function (inputs and outputs swapped, three seeds) passes
         with the direction stated, and fails saying why without it;
       - no late-stop warning on a clean experiment;
       - a table of exactly the single-base substitutions (counted independently) fails coverage
         without the library's method and passes with it;
       - BRCA1 Y2H's change point at position 93 (between residues 61 and 110), and the controls
         limited to it separate (AUC 1.000).
     - `roundtrip` 41 checks: an acknowledged finding through the archive, the methods, the
       findings export and the provenance; the 0.1.0 archive opened, both runs reproduced, its
       scores equal to the archived ones.
     - `remote-session.mjs` 75 checks: advice, `acknowledge_finding` and the findings export, byte
       for byte Node's.
     - `headless-run.mjs` 20 checks: `--strict --acknowledge` exits 0 with the reason in `run.json`,
       the findings and the methods; `--acknowledge` without a reason exits 2.
     - Unit tests 193, including `readout.test.mjs` and `advice.test.mjs`.
   - Found by slice 8:
     - **The vocabulary is MaveDB's, not the minimum information's file.** MaveDB's controlled
       keywords (from its API) implement the MAVE vocabulary and add terms laboratories use
       (Reporter, Cell fitness, Protein stability assay); a design uses MaveDB's, so that wave 3
       can deposit it.
     - **The units and the reference state are the run's, not the design's.** The scoring model,
       normalization and rescaling fix them, and the run records them, so the readout does not
       repeat them.
     - **The separation of the controls ignored the design's controls:** it took every nonsense
       variant by kind, even where the design named others or none. It now uses `controlRows`, as
       scoring does.
     - **BRCA1's library is not one of single-base changes.** An earlier validation note called it
       error-prone PCR, but it holds 71% of the substitutions two or three bases from the wild-type
       codon. The note is corrected. MaveDB could not be reached to check how it was made.
     - **0.1.0's runs reproduce exactly in Node:** engine 1 took the JavaScript engine's logarithms,
       and Node's are fdlibm's, as `dmath.js`'s. A run scored in another browser would differ in
       its last digits and say so.
     - **A sample sheet does not carry the readout:** it is one row per sample. The design file,
       the Experiment view and (wave 3) MaveDB's metadata do.
     - **Acknowledging a finding that passes changes nothing, and is not refused** by remote control
       or `--acknowledge`, so that a pipeline can name what it expects on every data set. Only an
       unknown finding stops the run.
     - **Comparing the cells recorded with the bottleneck the data imply** is left to slice 10 (the
       readiness model); the bottleneck finding says how to do it by hand (a ratio of about
       1 + D/(2N)).
9. **Intervals that hold the truth (S13; S2, S7, S9, S10, S11, T2, T3): done.** The reference
   comparisons show that MaveScape computes what Enrich2, DiMSum, mutscan and metafor compute. They
   did not show that a 95% interval holds the true effect 95% of the time, and with three
   replicates it did not: sorted bins 87%, time series 90%, two populations through a bottleneck
   combined by REML 87–88%, paired differential scores with selection noise 82–94%. REML estimates
   each variant's noise between replicates from its own two to six scores, and often finds 0.
   - **The moderated combination** (`web/lib/moderate.js`; `combination: 'moderated'`, the new
     default), for every variant of a condition at once:
     - a shared error model: a replicate score's variance is *a* × counting + *b*, fitted to the
       pairs of replicate scores (each pair centered, the median standardized square per range of
       counts, reweighted ten times), on variants with 5 reads or more before and after selection
       in every replicate;
     - the reference's shift, which moves every score of a replicate together, measured apart from
       each replicate's median departure and added to every variance with the replicates' degrees
       of freedom;
     - each variant's dispersion over the model moderated by empirical Bayes (limma's prior, with a
       degrees of freedom per variant), its interval by t at the prior's degrees of freedom plus
       its own, combined with the reference's by Satterthwaite;
     - replicates sharing a sample (an input, a time-0 sample) combined by generalized least
       squares with the covariance of its counting error, for log ratios (coefficient −1) and
       regressions (the slope's weight on the first point), so that the shared-samples warning
       becomes a note;
     - paired differential scores combined the same way, with t.

     REML, fixed effects, the mean and Enrich2's estimator stay choices, so agreement with Enrich2
     and metafor holds. Runs keep their parameters, so earlier runs reproduce; an output hash
     covers each score's degrees of freedom only when it has them.
   - **Rescaling** (`web/lib/anchors.js`): rescaled to medians of controls, the reference's shift
     cancels, and the scores' SEs leave it out. The anchors' own uncertainty (the wild type's SE, a
     median's sampling error from its members' SEs) is propagated by the delta method and reported
     apart as `SE_scale`: in the inspector, the scores export and the methods.
   - **Exports and display:** the scores export gains `df` and `SE_scale`, and its intervals use t;
     the differential export names the paired statistic `t_`; the inspector shows "(t, N df)"; the
     run's notes and the methods give the fitted model; `inspect_variant` returns `df`.
   - **The simulator** gains a shared input sample, overdispersed reads (gamma-Poisson) and a time
     course that saturates; its defaults, and so the fixtures and examples, are unchanged.
   - Validation:
     - `coverage` (`validation/coverage.mjs`, CI job `web`), 34 checks:
       - 26 kinds of simulated experiment, 40 seeds each: depth 30 to 2,000 reads per variant, two
         to six replicates, bottlenecks of 25 and 100 cells, selection noise, a shared input with
         and without a bottleneck, overdispersed reads, time series (with a bottleneck at every
         passage, one time-0 sample, a course that bends scored by its ends), sorted bins by
         maximum likelihood, barcodes summed and scored each, DiMSum's fitness, rescaled scores,
         paired and limma differential scores. The defaults hold 93.6–96.5% in every kind (gate
         93–97%); REML 81.8–95.5%. The exception is named: a bending time course scored by its
         slope, 78.9%, flagged by QC in 39 of 40 experiments;
       - an independent simulator, dms_variants 1.6.0
         (`validation/reference/generate_dms_variants_simulation.py`, GPL, run outside MaveScape):
         three selections sharing one input, with counting noise, a bottleneck and noise. Variants
         with 5 reads or more in every sample: 94.1%, 97.6%, 96.2% (gate 92–98%); REML 83–86%;
       - real data, each replicate held out and predicted from the others: beyond ±1.96 predicted
         SDs, GRB2 6.1%, CBS 5.6%, factor IX 10.0%, BRCA1 E2 12.3% (REML 22.6%, 3.5%, 26.3%,
         17.7%); gated nearer 5% than REML and under 15%.
     - `scoring` (342 checks in all): the time series, DiMSum's bottleneck and the differential
       checks report the moderated combination beside REML (93%; 95–97%; paired 93–97%, with noise
       a mean of 95%), and BRCA1's shared inputs are combined with their covariance.
     - Unit tests 202, including `moderate.test.mjs` (the model recovers *a* and *b*; shifts are
       not taken for noise; the prior equals limma's; coverage near 95%; GLS for a shared input;
       Satterthwaite; any row order gives the same bits) and `anchors.test.mjs`.
     - `remote-session.mjs` 75 and `headless-run.mjs` 20 checks, as before.
   - Found by slice 9:
     - **One experiment is not enough to measure coverage.** The wild type's own counting noise
       shifts every score of an experiment together, so one seed's coverage moves by several
       points. The suite runs 40 seeds per kind, and the single-seed checks of `scoring` gate on
       their average.
     - **The reference's shift is not any variant's noise.** Taking it to be the model's *b* made
       intervals too wide where the wild type is steady (a prior dispersion of 0.38 on the
       fixture). It is measured from the replicates' median departures instead.
     - **Variants with few reads distort a shared model:** the pseudocount flattens their
       differences, which pulled dms_variants' prior dispersion to 0.28. Only variants with 5
       reads or more in every replicate fit the model.
     - **The pseudocount biases variants depleted to a few reads toward 0**, about a fifth of
       dms_variants' library. No variance makes up for a bias; the suite reports them apart, and
       the minimum counts leave them out.
     - **A regression's residual SE cannot be the model's covariate:** it already holds the noise
       between replicates, and the fit put *a* near 0. The model uses the slope's SE from counting.
     - **A shared input's covariance is its counting error alone.** Scaled by *a*, it overstated
       BRCA1's shared part (*a* = 35: its excess comes from selection, not from counting the
       input), so the covariance takes min(*a*, 1). Sorted bins, DiMSum's fitness and barcodes
       scored each are combined as independent.
     - **Rescaled to medians, the shift cancels.** Counting it in each SE and in `SE_scale` too
       held 98.6%; rescaled scores' SEs now leave it out, and `SE_scale` comes from the anchors'
       measurement error.
     - **Knapp–Hartung's intervals were rejected:** 97–100% coverage, at about twice the width.
     - **A time course that bends** biases a slope; the interval cannot fix that, QC finds it, and
       the ratio of the ends holds 95%.
     - **BRCA1's two libraries were selected with strengths 10–15% apart:** every score of one is
       proportionally larger, which no model of counting describes, so its held-out predictions
       miss 12% of the time. Scaling each replicate, as DiMSum does, is a candidate for wave 4's
       robustness to analysis choices.
     - **Sums in row order made the last bits depend on the table's order:** the model's sums are
       taken in sorted order, so a table in any order gives the same scores.
     - **Data:** CBS took Hsp90's place among the real data sets (its four replicates from shared
       inputs are already in the validation data), and dms_variants was the independent simulator
       (already the barcodes' reference; Rosette was not needed).
10. **A complete analysis package (E8; D13, E5, Q4, M2): done.** The hardest part of an analysis
    is often gathering what the experiment was, not scoring it: which sample is which, what the
    assay selects for, and numbers kept at the bench that never reach the count table. This slice
    shows, for the open workspace, what the analysis can do with what is there, and what would
    unlock more.
    - **One readiness model** (`web/lib/readiness.js`), computed from the workspace (the table's
      import summary, the target, the design) and never stored. For every analysis the design
      allows (each way of scoring, normalizing and rescaling, combining replicates, differential
      scores, each QC finding, the record and a deposit's needs) it says ready, partial (it runs,
      and something missing would make it more complete) or not possible, and why. Each gap says
      why it matters, where it is usually found and where to give it in MaveScape; what needs
      another experiment (replicates, time points, conditions) is listed apart.
    - **Where it is shown:**
      - the Experiment view's *What the analysis can do*, with *Give it* taking you to the place;
      - the workflow strip ("21/25 analyses, 3 missing");
      - the Start page's *What to bring*, from the same catalog, with the open workspace's gaps;
      - `mavescape validate` (in words, and `readiness` in `--json`), through the `check` action;
      - the methods: "Not recorded with the counts: …", each gap with what its absence meant.
    - **The bench records it names now do something:**
      - the cells carried into selection (an input's `cells`) and recovered after it (an output's):
        QC predicts the variance ratio 1 + Σ(1/N)/Σ(1/R_in + 1/R_out) and says whether the cells
        account for the bottleneck the replicates imply, more, or less; the Experiment view's Cells
        column now shows for two populations;
      - the times in generations: `timeScale: 'unit'` (*A score is the change*: per unit of time)
        gives a slope on time itself, a selection coefficient per generation, and the ratio of the
        ends over the time between them; Enrich2's whole time course stays the default;
      - the gates and cells per bin, how the library was made, the readout and controls, as before.
    - **The package, written out** (`web/lib/package.js`; *Write the analysis package*, a run's
      export menu, `export` `what: "package"`): the count table byte for byte, the target as
      FASTA, the design, the design as a sample sheet (`sampleSheetCSV`, read back to the same
      design; a sample under several conditions is one row, `A;B`), the parameters, the readiness
      as data, and a README with the `mavescape run` command and what is missing. Deterministic.
    - Validation:
      - `readiness` (77 checks): the six examples and five fixtures, and a simulated bottleneck
        with its cells, whole and with one part taken away (the wild-type row, a replicate, the
        gates, the cells, the times in generations, the middle time points, the readout, the
        nonsense or synonymous controls): 74 workspaces. The model names exactly what was taken
        away, and every verdict agrees with the engine: each scoring analysis scored or refused
        with the parameters that use it, each QC finding assessed or not, and an analysis left out
        for a design one the engine cannot do there either. An empty workspace needs the counts,
        target and design; a broken design is the gap, with its first problem.
      - `qc`: the cells recorded against simulated bottlenecks (three seeds): accounted for in
        every pair (20 and 100 cells into selection; 50 recovered after it); with noise between
        replicates, more in 8 of 9 pairs; with a tenth of the cells recorded, less in every pair;
        not recorded, the advice to record them.
      - `scoring`: per unit of time, the whole-course scores and SEs over the span within 5 ×
        10⁻¹⁶ (WLS, OLS, the ratio); refused for two populations; DiMSum's model on a table of
        barcodes; the bins' defaults without the wild type or with nonsense named none.
      - `experiment`: every validation design written as a sample sheet reads back as itself.
      - `roundtrip`: each case's package scores from its own files to the run's output hash, its
        sheet reads as its design, its readiness as computed, the same bytes twice.
      - `headless-run.mjs` 22 checks: the package written by the window, run by `mavescape run`
        from its own files, gives the window's run; `validate --json`'s readiness equals Node's,
        and the text names what is missing.
      - Unit tests 213, with `readiness.test.mjs`, `samplesheet.test.mjs`, `package.test.mjs`.
    - Found by slice 10:
      - **Probing every verdict against the engine found three engine faults:**
        - DiMSum's model on a table of barcodes (summed, which is allowed) crashed after scoring:
          the summary read barcode counts its replicates do not keep;
        - sorted bins without the wild type were refused by default, since both scales need it:
          they now start unscaled, and an MLE's σ each variant's own;
        - the defaults ignored controls the design names as none (bins scaled to nonsense that the
          design excludes).
      - **The fitted multiplier understates a bottleneck at the input**: depleted variants' counting
        error dwarfs it, which dilutes the slope (2.2–4.3 for a predicted 6). The pair's ratio, which
        the bottleneck check already validated, follows the cells (4.0–5.5 for 6), so the cells are
        checked against it.
      - **Rounds of selection are not generations**: no growth record would make them so, so the
        per-generation scores are not listed for them.
      - **A sample sheet could not say an input selected under two conditions**: the reader takes a
        list of conditions now, as it takes a list of replicates.
      - **What the engine can do decides, not the design alone**: the variance beyond counting is
        assessable with one replicate given ten synonymous variants; the separation of the controls
        needs nonsense variants and synonymous ones or the wild type; maximum likelihood needs the
        wild type only for its σ. The readiness follows each.
      - **The deposit's needs are listed now** (the assay in MaveDB's terms, how the library was
        made, the target's identifier), so a laboratory can gather them before wave 3 deposits.
      - `describe_experiment` (wave 7) will return the readiness as it is.
11. **Examples (T4; D10 in part): done.** Three more, nine in all, each with its question, source
    and license, its readout and direction, its readiness, the QC findings it teaches
    (`findings`), the gaps its guide points to (`teaches`), its opening view and a guided workflow
    of four to six steps:
    - **Hsp90** (`00000011-a-1`, CC0; Hietpas, Jensen and Bolon 2011), the growth time series: every
      codon at positions 582–590 of yeast Hsp82, sampled eight times over 21 generations in one
      replicate. It opens on the map, scored per generation (`parameters: { timeScale: 'unit' }`).
      Its lessons: codon variants read at the protein level; per-generation scores against the
      published fitness; a time course that reaches the floor; what one replicate cannot tell.
    - **Factor IX** (`00001200-a-1`, CC0; Popp et al. 2025), the FACS-bin assay (MultiSTEP, strep II
      tag): 461 positions in three overlapping tiles of three replicates, 2 MB of counts. It opens
      on the map. Its lessons: reads far beyond the cells sorted (QC fails the variance beyond
      counting, about 2,300×); the gates and cells MaveDB does not record; MaveScape's scale
      against MultiSTEP's (the guide's step sets MultiSTEP's own).
    - **A simulated experiment with problems** (seed 20261016, labeled simulated): about 50 cells
      per variant into selection, recorded with the inputs, and a third replicate far noisier than
      the others. It opens in QC. The lesson: find the problems, leave replicate 3 out, and compare
      the runs against the truth; the guide now shows every run's.
    - **Codon variants read at the protein level** (`web/lib/codons.js`; part of wave 3's
      translation brought forward, because Hsp90 needs it): each row's protein change from its
      nucleotide name against the target's DNA, in its reading frame (substitutions in the coding
      sequence); a variant on several rows with the same counts read once, with different counts a
      problem; each protein variant's codons summed, into `hgvs_pro (from hgvs_nt)`. Offered in the
      import wizard (*Each row is: a codon variant*, suggested when protein names repeat),
      recorded as the source's assembly, and applied whenever a design names the derived column
      (`readCodonsFor`: `mavescape run`, `set_design`, `check`, a design file opened later).
    - Validation:
      - `examples` (26 checks): all nine opened as the window opens them, each scored with its
        parameters and raising exactly the findings it teaches, its readout stated, its readiness
        naming what its guide points to, at most six steps; the published ones' counts MaveDB's,
        byte for byte, with notices saying so. Hsp90: 568 rows read as 188 protein variants, the
        wild type's nine copies once, MaveDB's protein names agreeing with the translation but for
        those nine; each score's SE its own slope's with one replicate; against the published
        fitness, r 0.954 over the 100 variants the authors fit on every time point, a median 0.005
        apart, a median ratio 0.97, stops less negative. Factor IX against MultiSTEP's scores:
        r 0.994 with the defaults, 0.9995 with MultiSTEP's settings. The simulated problems: the
        cells account for replicates 1 and 2, not 3; all three r 0.961 and intervals 99.5%, DiMSum's
        terms at the output; without replicate 3 r 0.983, 95.9%, at the input.
      - `headless-run.mjs` 23 checks: `mavescape run` on Hsp90's design and MaveDB's counts reads
        the codons for the design and gives Node's output hash.
      - Unit tests 217, with `codons.test.mjs` and a one-replicate case in `moderate.test.mjs`.
    - Found by slice 11:
      - **The moderated combination ignored a single replicate's own SE** (from slice 9): with no
        pairs of replicates, its model fell back to counting error alone, a regression's slope
        dropping the scatter of its own residuals. Hsp90's SEs were understated a median 6.3×
        (up to 21×). With no model to fit, each score now keeps its own SE, as with the other
        combinations. The coverage suite had tested two to six replicates.
      - **Hsp90's table writes its wild type once per position**, nine identical rows, and its
        protein column names them as synonymous changes (`p.Gln1=` … `p.Glu9=`) where their
        nucleotide names say no change; each substitution is on several rows, one per codon.
        Reading it at the protein level needed the translation of wave 3, in part.
      - **The record says log₂; its scores are natural-log slopes**: MaveScape's per-generation
        slopes, in natural logarithms, are a median 0.97 of the published; in log₂ they would be
        1.4×.
      - **The authors' null-like variants were fit on three time points**: a slope over all 21
        generations of a course that reaches the floor is shallower (−0.32 against −0.77), which
        QC's fit of the time courses shows.
      - **A failing replicate distorts DiMSum's error model too**: in the problems example its
        terms put the planted input bottleneck after selection; without replicate 3, before it.
      - **Factor IX's nonsense median is 0.47 on MultiSTEP's scale** (the lowest 5% of missense at
        0): the scale convention changes what 0 means.
      - Wave 2 is complete with slice 11.

**Released 0.2.0 on 2026-10-10.** Its workspace archive (`validation/archives/release-0.2.0.msz`,
written by `make-0.2.0.mjs` with 0.2.0's own code) holds every kind of source and run 0.2 brought:
a table of barcodes with its map, sorted bins, two conditions compared by limma, codon variants
read at the protein level and scored per generation, DiMSum's model and the moderated combination,
with a selection, a changed threshold and an acknowledged finding. Every later version must reopen
it and reproduce its six runs; the replay now assembles each run's source as the window does.

## 0.3.0: public data in and out (wave 3)

MaveDB both ways, annotations beside the map, and the full variant grammar that public data need.

### Wave 3

1. **The allowlisted fetcher (P3, I3): done.** `cache.go` and the download, limit and serve parts
   of `fetch.go`, adapted from Proteoscope 0.10.0, with one explicit host list (`publicHosts`:
   MaveDB, UniProt, RCSB, PDBe, AlphaFold DB, NCBI E-utilities, Ensembl, gnomAD, each with the
   paths it may be asked for), checked as every request is sent, redirects included
   (`guardedTransport`): HTTPS on the default port, no user name, no dot segments; redirects on
   the same host only, and without the `Referer` Go adds. The requests are listed once
   (`publicRequests`: the route the page asks, the request upstream, what is sent and why, the
   cache folder, age and size limit) and served at `/api/fetch/…`; `/api/fetch` describes them and
   `/api/fetch/cache` lists the cache. Each answer is cached with its retrieval record (the
   service, the URL, when retrieved and last confirmed, the ETag, date and release), confirmed by
   ETag or date once older than its age, served stale only when the service cannot be reached;
   retries on 429/502/503/504 (twice, after 1 and 3 s, or `Retry-After` up to 10 s); per-request
   size limits applied after decompression; JSON only. `--offline` (cached copies only; the
   fetcher has no way to send), `--no-fetch` (off), `--cache-dir` (default
   `<user cache dir>/MaveScape`); `/api/info` and the banner say which; a second launch with
   another setting is told the running one keeps its own; headless runs have public data off.
   A request that would send a sequence is refused with HTTP 428 and the exact request it would
   make, until the page confirms it (`X-MaveScape-Confirm: send-sequence`), which it does only
   when the person clicks *Send it* in a dialog showing the whole request; a lookup already
   cached is answered sending nothing, and its record names the request with `{sequence}` in place
   of the sequence, so the cache holds public answers only; no remote action sends a sequence. `docs/NETWORK.md` lists
   every host and request, and what each sends.

   The first requests, and what they serve: **a target checked against its UniProt entry**
   (`web/lib/uniprot.js`, `web/ui/public-data.js`). Experiment, Target: *Check against UniProt*
   fetches the entry its accession names and places the target (or the protein a DNA target
   encodes) in it, ungapped, a few residues allowed to hang over either end (a tag or linker),
   80% of residues agreeing at least, and a placement that fits equally well elsewhere left to
   the person; it shows the entry, where it came from and when, where the target sits and how it
   differs, and each field the entry would change (offset, accession and gene, species,
   differences, with notes kept). *Use these* changes them in the design; the check's record
   (`target.reference`: entry, release, retrieval, placement) is kept with the workspace's target,
   not in the design, so a check that changes nothing leaves the design and its runs current
   (`recordTargetCheck`). The history, the target pane and the inspector show it; the methods name
   the entry, release and date, citing UniProt, while the target is as checked. A target with no
   accession is found by its exact sequence (UniParc, active UniProtKB entries, reviewed first).
   An inactive accession is reported with the entries that replaced it. The status bar's
   *Public data* opens the Network dialog: the hosts, the requests, the cache's folder and what it
   holds. The remote action `check_target` (with `apply`). The GRB2 example's guide checks its
   target (six steps: the two map steps merged); a screenshot scene (`target-uniprot`); the guide
   page *Public data*.
   - Validation:
     - Go tests (`fetch_test.go`): the allowlist (allowed and refused URLs: look-alike hosts,
       other ports and schemes, user names, paths outside a host's, dot segments); nothing sent to
       an unlisted host; redirects on the same host followed, to another refused and never
       contacted; answers beyond the limit refused when declared, streamed, compressed by the
       transport, compressed in the body and both (a 4 KB answer expanding to 4 MB stops at
       1 MB); JSON only; retries, and none for HTTP 500; revalidation by ETag (304: the copy
       confirmed, `checked` recorded, fresh again); stale copies when the service is down; a 404
       not served from the cache; `--offline` serving cached copies and sending nothing;
       `--no-fetch`; the sequence sent only once confirmed, the request it would send shown first,
       cached lookups sending nothing, and no file of the cache holding the sequence; `docs/NETWORK.md` naming
       every host, route and upstream (`TestNetworkDocumentListsEveryRequest`); no script in
       `web/` naming another origin in a request, and the CSP's `connect-src 'self'`.
     - `public-data` (6 checks) on UniProt's answers as the fetcher cached them
       (`validation/fixtures/public-data/`, release 2026_03): each record complete; each published
       example's target where its design says in its entry, identical, at one place, the entry
       changing nothing (GRB2 159–214 of P62993, Hsp90 582–590 of P02829, factor IX 1–461 of
       P00740); GRB2's whole sequence finding P62993 first; the GRB2 example checked as its guide
       says, the design unchanged and the methods naming the check.
     - `remote-session.mjs` 81 checks, the session now offline on the cached answers:
       `check_target` (identical, from the cache; another protein refused; an uncached entry
       refused offline; applied, the design and its run unchanged); the methods and the archive
       keep the check; and every request the page made in the whole session recorded through the
       DevTools protocol: none beyond its own origin.
     - Unit tests: `uniprot.test.mjs` (8), a check kept outside the design in
       `workspace.test.mjs`, the methods' sentence in `methods.test.mjs`.
   - Found by slice 1:
     - **Go's HTTP client adds a `Referer` header to a redirected request**, naming the URL
       redirected from, which for a sequence's lookup holds the sequence (the tests' fake service
       refused requests carrying one). Redirects stay on their host, but a redirected request now
       carries nothing the first did not.
     - **UniProt answers an inactive accession with HTTP 200** and an entry of type "Inactive"
       naming where it went (P29354: split into P62993 and P62994), not a 404 or a redirect: the
       page reads it as such.
     - **A sequence's lookup returns every database's cross-reference** unless asked otherwise:
       1,147 for GRB2 (232 KB), of which 120 are active UniProtKB entries. The request asks for
       those only (30 KB).
     - **UniProt names an organism with its reference strain** ("Saccharomyces cerevisiae (strain
       ATCC 204508 / S288c)"), which need not be the experiment's: organisms are compared and set
       by species.
     - **Any change to the design makes its runs no longer current**, so recording a check in the
       design would have asked for a rescore that changes nothing: the record is kept with the
       workspace's target instead.
     - The three published examples' targets are exactly where their designs say in UniProt.
2. **MaveDB import (I1): done.** Through the fetcher of slice 1: a score set's record
   (`GET /score-sets/{urn}`, cached 7 days), its scores and counts (CSV, 30 days; CSV answers accepted
   where asked, a page refused), and the search (`POST /score-sets/search`, its words and page, 100 a
   page, a day); URNs of published score sets only (`tmp:` refused); cache names without colons.
   `web/lib/mavedb.js` reads a record: title and descriptions, license and what it allows (CC0, CC BY,
   CC BY-SA open; CC BY-NC-SA and "other" with a warning and their terms), citation (MaveDB's
   reference, rewritten from the publication's fields where it holds placeholders), target (a
   sequence; UniProt's offset as the target's, RefSeq and Ensembl as identifiers), what it holds, the
   experiment's controlled keywords (giving the design's readout and library method in MaveDB's
   terms; the direction is no keyword and stays unstated), raw-read identifiers, and published
   calibrations (functional classes as WT-like and abnormal-like, ranges, the evidence strength each
   assigns, research use flagged). *Open from MaveDB* (`web/ui/mavedb.js`; the Start page, the
   workspace menu, ⌘K) searches or takes a URN or MaveDB address and shows the record before opening
   it; `mavescape urn:mavedb:…` and `--mavedb` open one at start or hand it to the running window
   (`/api/info`'s `mavedb`, `/api/open`). Opened, a record becomes a workspace: its published
   scores, its counts (when deposited) with a design drafted from their column names by the same
   draft as any table (`countsDesign`), the record kept in `workspace.records` and each table's
   `origin`, shown in the inspector and named in the methods. A target named by an accession, or
   several targets, is shown and not opened (full MAVE-HGVS, slice 3). Remote actions
   `search_mavedb` and `open_mavedb`.

   **Published scores, read as published.** The design model `scores` (in the schema since wave 1)
   now has a run: the model `published` reads each score, SE and 95% interval as given (the scores
   export writes the given interval; the output hash covers it), with the stages `given` (no score in
   the table) and `copy` (a row repeating an earlier row's variant and scores, read once; different
   scores refused), and the classes, exclusions and maximum SE a person sets. It serves the map, QC
   (separation, resolution, coverage of substitutions with a score; the findings about counts not
   assessed), the inspector, the exports (no counts or package), the methods ("as published, not
   rescored") and the workflow. *Draft the design* reads any table with a column of scores this way
   (`draftScoresDesign`), and the Experiment and Score views show its columns and filters.

   **Readiness** applied to a MaveDB record: for published scores, the base is the scores, target and
   design; the map, exploration, QC of what scores show and comparison are ready; rescoring and QC of
   the counts need the counts, named with where they usually are: MaveDB when it keeps them, else
   the paper's supplement, the authors' repository, or the raw reads the record names, counted again
   with the design the paper's methods describe. The readout's where names the record's method text.

   The example: PTEN's VAMP-seq abundance (`urn:mavedb:00000013-a-1`), scores alone, opened from
   MaveDB when opened and checked against its checksum (pinned in `sources.json`), its direction
   stated from the paper; ten examples.
   - Validation:
     - Go tests: MaveDB's records, tables and search (URNs only, temporary ones refused, CSV accepted,
       a page of HTML refused, the search's words POSTed, cached by words and page, its record
       keeping the body); `--mavedb`, URNs among the arguments, forwarded to a running MaveScape.
     - `public-data` (15 checks): the feasibility records (four score sets) read with no code for any
       of them; their published scores read as published equal MaveDB's columns row for row (score
       and SE; 1,108, 11,530, 6,847 and 9,009 scored, the rest NA in MaveDB); their counts drafted
       into valid designs, GRB2's and factor IX's as documented but for the bins' values; factor IX's
       keywords as its readout; a target named by an accession (BAP1, CC BY 4.0) shown with its
       terms; PTEN's readiness naming the counts and its raw reads; a workspace of published scores saved as an archive, reopened and its run reproduced.
     - `validation/mavedb-live.mjs` (15 checks, in CI): the feasibility records opened from MaveDB,
       live, through the window: the tables MaveDB sends are the ones `sources.json` pins, the
       published scores equal MaveDB's, and the PRD's phase-0 exit holds again from the live import,
       at the suites' tolerances: GRB2 by DiMSum's model on the drafted design, r 0.994 (≥ 0.99);
       BRCA1 E2 with the documented design and Enrich2's weighted least squares, 50,043 published
       replicate scores reproduced to 1.8 × 10⁻¹⁴ (≤ 10⁻¹⁰); factor IX with MultiSTEP's settings,
       r 0.9995 (≥ 0.999). `--offline` repeats it from the cache.
     - `remote-session.mjs` 85 checks: `search_mavedb` and `open_mavedb` offline on the cached answers
       (GRB2 by its MaveDB address; the published run with Node's output hash; a record whose table is
       not cached refused offline).
     - `examples` (29 checks), unit tests 235: `mavedb.test.mjs`, the published model in
       `score.test.mjs`, the stages in `filters.test.mjs`, the SE ranking in `importer.test.mjs`.
   - Found by slice 2:
     - **PTEN's record lists `sd` before `se`**, and the importer took the first column with a
       standard-error-like name: the standard deviation across experiments would have been read as
       each score's SE. SE names are now ranked, `se` first; intervals are found too.
     - **MaveDB's references hold placeholders** ("(None). 2024; (Unknown volume):(Unknown pages)" for
       a preprint, "9:None", a title repeated as the journal), and some titles HTML (`<i>G6PD</i>`):
       such references are written again from the publication's fields.
     - **Hsp90's score table writes its wild type nine times** (`c.[1=;2=;3=]`, one per position),
       each scoring 0.0: copies, read once, as its counts were in slice 11.
     - **MaveDB answers a score set without counts** with a counts table of identifier columns alone
       (HTTP 200), not a 404: the record's list of count columns decides whether there are counts.
     - **MaveDB sends no ETag, date or release**: a cached copy is checked by its age, and a record's
       own dates say which version it is.
     - **A record's calibrations can be many**: PTEN has six (the investigators' classes by a class
       column; ExCALIBR's twice, research use only; a Gaussian mixture; IGVF's twice, one primary).
     - **BRCA1's counts table holds two assays**: its draft is one time series of two conditions (E2
       and Y2H), where the documented designs keep them apart; both are valid.
     - **The workflow said "the design or the table changed"** when another table (the published
       scores) had the only run, and the Score view's draft took that run's parameters for the counts:
       a run of the same table, and parameters of the same kind, are now what count.
3. **Full MAVE-HGVS and variant mapping (D3, D10): done.** The parser has read the whole grammar
   since wave 1; now every form is carried through. `web/lib/consequence.js` reads a nucleotide
   variant of a DNA target for its protein change: the variant applied to the target's sequence
   (c. counted from the coding start, c.-N and c.*N in the UTRs; n., g., m., o. from the first
   base), both coding sequences translated (a frameshift's to its first stop; one in frame codon by
   codon, into the 3′ UTR when its stop is lost), compared as HGVS describes protein changes and as
   biocommons hgvs computes them, in MAVE-HGVS's forms (frameshifts short, a lost stop as the
   substitution at it, a methionine start's change "start lost", substitutions of several codons a
   multi-variant, nothing after a stop the variant makes); intronic positions are splice sites
   within two bases of the exon (or across its edge), else intronic. The variant table
   (`variants.js`) gives a nucleotide variant its consequence as its kind (new kinds: splice site,
   intronic, 5′ UTR, 3′ UTR) and its protein change (`proKey`, `proPosition`, `proRef`,
   `proAlt`, DiMSum's `mixed`); a name prefixed by another target is set aside (`otherTarget`, the
   filter stage `target`). A DNA target's protein is its coding sequence to its first stop.

   **Nucleotide runs at the protein level** (`web/lib/collapse.js`): the variants making the same
   protein change merged as DiMSum merges them by default (inverse-variance; mixed substitutions
   left out; synonymous codons merged into their codon's cell; frameshifts and variants with no
   protein change apart), for the map, the inspector (a cell's nucleotide variants, each scored),
   QC's coverage, remote control and a new export, the scores at the protein level
   (`protein_scores.csv`, from `mavescape run` too). Beside every map, **Not on the map** lists what
   a map of substitutions cannot show, by class and in order along the target.

   **Targets from GenBank** (`web/lib/genbank.js`, `web/ui/genbank.js`): LOCUS, definition,
   accession and version, organism, features with their locations (ranges, partial ends,
   complement, join, order) and qualifiers, and the sequence; a coding feature chosen when there are
   several (the longest whose translation checks offered first), its translation checked against
   the record's; a plasmid's target its coding sequence on its strand, an mRNA's the whole record
   from its coding start. The target's origin is kept with the workspace (not the design), shown in
   the Experiment view and the inspector, and named in the methods (RefSeq, Ensembl and biocommons
   hgvs cited).

   **MaveDB records whose target is a transcript**, through the fetcher: NCBI's GenBank record of a
   RefSeq transcript (`/api/fetch/ncbi/nuccore/{accession}`) and Ensembl's sequence of one of its
   own (`/api/fetch/ensembl/transcript/{id}`, its current version said where the record names
   another); a transcript named beside its protein is one target; a score set of several targets
   opens one target at a time; a genome is not fetched. **MaveDB's mapped variants**
   (`/api/fetch/mavedb/score-sets/{urn}/mapped-variants`), when asked for, kept as a CSV beside the
   tables (and in the archive): the inspector shows each variant's HGVS on the reference, VRS
   identifier and ClinGen allele. `open_mavedb` takes `target` and `mapped`; `inspect_variant` gives
   `protein`, `nucleotideVariants` and `mapped`.

   The example: BRCA1's saturation genome editing (`urn:mavedb:00000097-0-2`, CC0; Findlay et al.
   2018), opened from MaveDB with its counts, its RefSeq transcript fetched from NCBI; eleven
   examples.
   - Validation:
     - `consequences` (8 checks; `validation/consequence-cases.mjs`): each nucleotide variant's
       protein change as biocommons hgvs 1.5.7's (`reference/consequences.json`,
       `generate_consequences.py`, its own data provider holding each transcript), 16,188 variants
       on NM_007294.3, NM_000546.6 and ENST00000460680 (every name of BRCA1's, TP53's and BAP1's
       score sets, and generated substitutions, deletions, insertions, duplications and
       deletion-insertions): all agree; GenBank records as Biopython 1.88 reads them (two RefSeq
       mRNAs, a plasmid of three coding features, HBB joined from three exons; 143 features, 6 coding
       sequences): all agree; every variant of thirteen imported tables valid on its target
       (GRB2, BRCA1 RING aa and nt, factor IX, Hsp90, CBS low and high, PTEN, BRCA1 SGE scores and
       counts, TP53's DNA-binding domain, BAP1, TP53 base editing); 71,005 protein names, all strict
       MAVE-HGVS; the protein names five records publish beside their nucleotide names the same
       protein (22,280 of CBS's written alike); VarChAMP's 28 targets each read on its own; DDX3X's
       genome target refused; the merge at the protein level as DiMSum 1.4's own
       `dimsum__aggregate_AA_variants_fitness` merges CBS's 11,478 codon variants
       (`generate_dimsum_aggregate.R`): 7,561 amino-acid variants within 5 × 10⁻¹³, the 1,034
       synonymous ones it keeps apart each in its codon's cell.
     - `hgvs` (6 checks): every mavehgvs test case, its 54 tests against a target sequence now too.
     - `public-data` (16 checks): GRB2's 1,120 mapped variants each joined to its row of scores, each
       VRS identifier well formed, each protein on NP_002077.1 the table's at the target's position
       plus 158.
     - `examples` (33 checks): the BRCA1 example opens as the window opens it (QC coverage failing, as
       its guide teaches); its counts drafted (two replicates, day 5 to day 11) and scored agree with
       the published scores at r 0.76.
     - `remote-session.mjs` (90 checks), `headless-run.mjs` (24), `mavedb-live.mjs` (18, live and
       offline): MaveDB's mapping kept and shown; BAP1 opened on Ensembl's transcript, a merged
       protein variant inspected, the scores at the protein level as Node writes them, by the window
       and by `mavescape run`; BRCA1's saturation genome editing and BAP1 opened live, their
       transcripts from NCBI and Ensembl.
     - Go tests: the new requests (accessions only; NCBI's and Ensembl's HTTP 400 for an unknown
       accession read as not found; an answer of the wrong kind refused). Unit tests 260:
       `consequence.test.mjs`, `genbank.test.mjs`, `collapse.test.mjs`, kinds and prefixes in
       `variants.test.mjs`, transcripts, several targets and mapped variants in `mavedb.test.mjs`,
       the mapped variants carried by the archive in `archive.test.mjs`.
   - Found by slice 3:
     - **biocommons hgvs names the residues an in-frame insertion holds after the stop it makes**
       (`p.Lys1171delinsGluTerGlu`): they are not made, and MaveScape names nothing after a stop
       (`p.Lys1171delinsGluTer`); 12 of 16,188 variants, the only difference.
     - **A duplicated stop codon is in the coding sequence** (the copy follows it, past the stop): no
       amino acid changes (`p.=`), where a first reading placed it in the 3′ UTR.
     - **MaveScape translated a DNA target past its stop**: a transcript's 3′ UTR would have been
       drawn on the map. A target's protein now ends at its first stop.
     - **Ensembl serves its current release only**: BAP1's record names ENST00000460680.5, Ensembl
       serves .6; every one of the record's reference bases agrees with .6. NCBI and Ensembl answer
       an unknown accession with HTTP 400, not 404.
     - **Base-editing screens name the same edit from several guides** (TP53's: 95 of 351 names
       repeated, with different scores): MaveScape refuses to merge them silently, so the record's
       published run is not made; which guide is right is not for MaveScape to guess.
     - **BRCA1's saturation genome editing counts a library beside day 5 and day 11**: the draft made
       it a replicate of one time point, which nothing can score. A lone sample is set aside now.
     - **A saturation genome editing screen covers exons, not the protein**: coverage of the whole
       protein is 5% (17% of the substitutions one base change makes). The finding names the
       stretches the variants lie in (BRCA1: 1–101, 1631–1855), to give as tiles.
     - **Published protein names differ in form from MAVE-HGVS's**: BRCA1's RING record names changes
       after a stop (`p.[Gly182Ter;Leu217Phe]`), TP53's base-editing record a codon left synonymous
       (`p.[Ser96Ser;Val97Ala]`) and `p.Asp41Asp`; each describes the protein MaveScape's translation
       makes.
     - **MaveDB's mapping confirms the UniProt offset independently**: each of GRB2's 1,120 mapped
       variants sits at its target position plus 158 on NP_002077.1.
     - **The deposited counts of a saturation genome editing screen do not record its normalization**:
       Findlay et al. normalized each exon apart and corrected for position within it; scored
       globally, BRCA1's counts agree with the published scores at r 0.76.
4. **MaveDB export (I2, M2): done.** `web/lib/mavedb-export.js` writes a run (one condition) as
   MaveDB takes a score set: `scores.csv` and `counts.csv` as MaveDB's upload reads them (strict
   MAVE-HGVS on the target; a run's score, SE, 95% interval, replicates, status and flags, its
   counts by sample of the condition's replicates; published scores passed through, the design's
   score column as `score`, with the record's counts), MaveDB's column descriptions
   (`score_columns.json`, `count_columns.json`), and the experiment and score set as the bodies of
   MaveDB's API (`experiment.json`, `score_set.json`): the methods as the score set's method text,
   the design's readout and library method as the experiment's keywords in MaveDB's controlled
   vocabulary (`MAVEDB_KEYWORDS`, the MAVE minimum information's, "Other" described where a term is
   not in it), the target as MaveDB holds one (`mode`: protein; coding, the sequence from its
   coding start, c. names beside their protein changes; noncoding, n. names on the whole sequence;
   accession, the RefSeq or Ensembl transcript it was fetched as, each name prefixed by it), the
   license by MaveDB's id. A README and `mavescape.json` say what was written, left out, chosen and
   missing. **The MaveDB details** (`ws.deposit`, `setDeposit`): title, descriptions, abstract,
   method note, license, publications, DOIs, raw reads, contributors, an experiment's URN, a score
   set superseded, the taxonomy id, MaveDB's target category, the other keywords; checked as MaveDB
   checks them (URNs, ORCID iDs, publication identifiers). Defaults come from the record (published
   scores; the experiment of a MaveDB record), the design, CC0 or a sentence MaveScape writes, each
   said; what MaveDB requires and nothing gives is `missing`, and the tables are written all the
   same. In the window: the run's Export menu, *Deposit in MaveDB…* (`ui/mavedb-export.js`: what the
   deposit holds and lacks, the details, the download). **A MaveDB package opens** (a folder or a
   ZIP; `readDeposit`, `importMaveDBPackage`) as a record from MaveDB does, its details kept.
   `mavescape export --format mavedb|tables` (`export.go`: `--details`, `--condition`, `--strict`,
   `--time`; `export.json`); remote actions `mavedb_deposit`, `set_mavedb_details`, `export` of
   `mavedb`. A design's target gives its `taxonomyId`. The GRB2 example's guide prepares a
   deposit; the guide's *Depositing in MaveDB*; a screenshot scene (`mavedb-deposit`).
   - Validation:
     - `mavedb-export` (8 checks; `validation/mavedb-export-cases.mjs`): 19 deposits (GRB2 with and
       without its details, Hsp90, factor IX, the five simulated designs, two conditions each a
       deposit, CBS's codon variants scored at two vitamin B6 levels, PTEN's, BRCA1 RING's
       nucleotide and BRCA1's and BAP1's saturation genome editing published scores, BRCA1's counts
       scored on NM_007294.3, BRCA1 RING's variants named n.) checked by MaveDB's own validators
       (`reference/generate_mavedb_export.py`: the `mavedb` package 2026.2.7.4, AGPL-3.0, as an
       external reference, its `csv_data_to_df` and `validate_and_standardize_dataframe_pair` with
       the column descriptions and targets, mavehgvs 0.8.1 strict, biocommons hgvs 1.5.7 given each
       transcript by a data provider of its own; `ExperimentCreate` with `validate_keyword_list` and
       MaveDB's vocabulary, `ScoreSetCreate`; results with each file's SHA-256 in
       `reference/mavedb-export.json`): every table accepted (92,253 rows, 133,173 names), the
       metadata accepted where MaveScape says nothing is missing and refused for the abstract
       where it says that is; all four modes, 14 scored and 5 published; export → import → export
       the same bytes for all 19; MaveScape's keyword vocabulary MaveDB's (13 keys, 119 labels,
       `fixtures/public-data/mavedb-keywords.json`).
     - Never sent: `TestNoRequestSendsADepositToMaveDB` (no request asks MaveDB's validators or
       upload, or POSTs but a search); `docs/NETWORK.md` says so.
     - `remote-session.mjs` (96 checks): BAP1's deposit from the window the same bytes as Node's,
       opened again from its folder and its ZIP and written again the same; GRB2's details set by
       `set_mavedb_details` (in the history), an unknown detail refused. `headless-run.mjs` (29):
       `mavescape export` twice the same bytes and as Node writes the deposit from the archive,
       `--strict`, `--details`, a folder per condition, `--format tables` as `mavescape run` wrote
       them, wrong command lines (exit 2). Go tests: `mavescape export`'s arguments; the program's
       file kinds.
     - Unit tests 271: `mavedb-export.test.mjs` (the four modes, the details and their checks, the
       keywords and MaveDB's rules for them, published scores passed through, a package read back,
       the ZIP), a record's deposit fields and "Other" read as its description, GenBank's taxonomy
       id.
   - Found by slice 4:
     - **MaveDB's validator stops at a gap in `hgvs_pro`**: a protein name missing on any row (a
       UTR or intronic variant beside c. names) ends it with "'float' object has no attribute
       'split'" (mavedb 2026.2.7.4), and c. names are refused without protein names. Such variants
       of a target given by its sequence are left out of a deposit, and said; a target named by its
       transcript keeps them (its names alone, checked by biocommons hgvs).
     - **MaveDB counts a target sequence from its first base**, c. and p. alike (it translates the
       DNA from there): a transcript with a 5′ UTR is given from its coding start.
     - **MaveDB reads an upload with `'` as its quote character**, and refuses a column without a
       value or of numbers and text mixed: MaveScape's own exports quote with `"` and write
       `hgvs_splice` and τ² empty. A deposit writes no quotes (a column holding a comma or quote is
       left out, and said) and no empty column.
     - **MaveDB's vocabulary had grown** since wave 2: one assay method was missing from
       MaveScape's list; "Molecular Mechanism Assessed" has no "Other", so a design's free-text
       phenotype is chosen on MaveDB. CC BY-NC-SA 4.0 is no longer offered for a new score set.
     - **The program did not open JSON files** (`fileKind`) though the page reads them: a package's
       folder arrived without its `score_set.json`. Its four JSON files open now; others still
       do not.
     - **A record kept with the workspace dropped its abstract**, which a deposit of it needs; and
       a keyword "Other" read as "Other" rather than what it describes.
     - **MaveDB's own checks of a transcript need no database**: given each transcript by a data
       provider holding only its sequence and coding region, biocommons hgvs validates every name
       offline (BRCA1's 3,893, a wrong reference base refused).
5. **Sequence tracks and annotations (V5, I3, I4): done.** Tracks synchronized with the map
   (`web/lib/tracks.js`, drawn by `track-render.js` into the map's canvas and its SVG): one row
   each below the grid, on its positions, panned and zoomed with it, its name in the margin; hover
   for what it holds at a position, click to select that position's variants (a feature's, every
   position it covers). Four kinds: the reference's residues; values by position; features
   (domains, sites, secondary structure: boxes in lanes, a helix, a strand's arrow); variants
   (classes stacked by position, or a value as a bar, an allele frequency on a log scale), given to
   each variant in the inspector. The run's own: reference, coverage, position effect (the median
   score from the wild type's) and uncertainty (the median SE), hidden until shown, so a map
   without tracks draws and exports as before. **Annotation providers behind one interface**
   (`web/lib/providers/`: `needs`, `fetch` through the fetcher, `accepts` a file, `read` → tracks),
   each annotation kept in `ws.annotations` with its record (service, URL, release, retrieval date,
   license) and its file in the library and the archive by SHA-256, so its tracks reopen offline:
   UniProt's features (`/api/fetch/uniprot/{accession}/features`; domains and regions, sites and
   motifs, secondary structure); conservation from PDBe-KB's profile
   (`/api/fetch/pdbe/conservation/{accession}`; each position's Jensen–Shannon divergence from the
   BLOSUM62 background, `distributionDivergence`) or the person's alignment (A3M, FASTA, Stockholm,
   Clustal; Proteoscope's `conservation.js`, Capra & Singh's defaults, the query placed by its
   residues); AlphaMissense (`/api/fetch/alphafold/{accession}/missense`); ClinVar
   (`/api/fetch/clinvar/search` and `/summary`, kept as one table of what MaveScape reads;
   classes, review status as stars); gnomAD v4 (`/api/fetch/gnomad/gene/{symbol}` and
   `/transcript/{id}`, GraphQL; the MANE Select transcript's variants, exomes and genomes joined);
   MaveDB's own join of ClinVar's latest release and gnomAD to a record's variants
   (`/api/fetch/mavedb/score-sets/{urn}/namespaces` and `/annotations`), found in the run by
   accession; predictors' downloads (AlphaMissense's, EVE's, ESM1b-style matrices, any table of
   variants and scores) and custom tracks (GFF3, tables of values or stretches). Every annotation
   numbered on a reference is placed by the target's offset where the target has the residues it
   names, refused when they disagree. The Map view's Tracks panel: show, hide, reorder, filter
   (features by kind, ClinVar by class and stars, gnomAD by frequency), remove, each with its
   source (`ws.tracks`, the arrangement: a view, not in the history); export of the tracks shown
   (CSV) and the map with them (SVG, PNG); the map's words and the methods name and cite each;
   alignments and GFF3 files dropped on the window. Remote actions `list_tracks`, `add_track`,
   `set_track`, `remove_track`, `export` of `tracks`; `inspect_variant`'s `annotations`. The GRB2
   example's guide adds tracks to its map; a screenshot scene (`map-tracks`); the guide's *Tracks*
   and *Annotations beside the map*. Structure availability as a track comes with the structures
   (wave 5).
   - Validation:
     - `annotations` (12 checks; `validation/annotation-cases.mjs`, served the fetcher's cached
       answers by `cached-fetch.mjs`): conservation from an alignment (Pfam PF00018's seed with the
       human GRB2 SH3 first, 56 sequences, `fixtures/annotations/`) as Capra & Singh's
       `score_conservation.py` scores it by default, the query's 46 residues on positions 4–49,
       within 4.8 × 10⁻¹³ (the tool prints 12 decimals), Stockholm and FASTA the same; PDBe-KB's
       profiles of GRB2, factor IX and Hsp90 as the tool's divergence gives them (1,382 positions,
       within 3.3 × 10⁻¹⁶; `reference/annotations.json`, `generate_annotations.py`, the tool
       GPL and only an external reference); UniProt's features the same from its JSON and its
       GFF3 for the three examples, GRB2's SH3 2 over the whole target, a wrong offset refused;
       AlphaMissense's every substitution of GRB2's and factor IX's targets as AlphaFold DB's
       tables give it (9,823), each class the authors' threshold on the score; ClinVar's records
       of GRB2 (10) and F9 (553, two pages of summaries) read with ClinVar's own classification and
       review status, those placed agreeing with the targets' residues; gnomAD's frequencies of
       BRCA1's variants equal MaveDB's own join of gnomAD v4.1 to its saturation genome editing
       score set, 41 of 41 exactly; MaveDB's annotations of that score set (1,376 ClinVar
       classifications, 41 gnomAD frequencies) joined to the BRCA1 example's run by accession, all
       found; seven annotations of GRB2 kept through an archive, the same 11 tracks, each naming its
       source; the tracks' table read back as custom tracks; what each provider asks the fetcher
       (accessions, a gene's symbol, ClinVar's record numbers, a transcript; never a sequence);
       the GRB2 example as its guide says (AlphaMissense calls its eight least tolerant positions
       likely pathogenic; conservation follows the position effect only in part, ρ −0.43).
     - Go tests (`annotations_test.go`): each new request asks what `docs/NETWORK.md` says, is
       cached under its own name, and refuses anything but public identifiers before a byte is
       sent (an isoform for AlphaMissense, a gene's symbol with a query in it, more than 500
       ClinVar records, a transcript of another species); gnomAD's GraphQL errors read as "not
       found" or refused, never cached; no request writes to MaveDB.
     - `remote-session.mjs` (105 checks): the tracks added offline from the cached answers and
       from files, refused twice or for a run not from MaveDB, shown, moved and filtered (not in
       the history), a variant's annotations, the tracks' table and the map with its tracks the
       same bytes as Node's from the archive, the methods citing each source, an annotation
       removed with its tracks.
     - Unit tests 302: `tracks.test.mjs`, `providers.test.mjs` (every provider on the fixtures),
       `conservation.test.mjs` (Proteoscope's, with the profile's divergence).
   - Found by slice 5:
     - **AlphaFold DB lists an alignment for each entry but refuses to send it** (HTTP 403 from its
       storage, for GRB2, factor IX, BRCA1, PTEN, TP53, Hsp90), as Proteoscope found: conservation
       is read from PDBe-KB's profile of the protein's homologues, on a path the fetcher already
       allowed, or from the person's own alignment. PDBe-KB's profile leaves out a protein's
       ends where its HMM has no match state (GRB2's last residue; factor IX's first three and
       last): said, not filled.
     - **gnomAD's GraphQL API answers an unknown gene with HTTP 200 and an error**: the fetcher
       now checks an answer's body where a service says "not found" so (`answer`), and caches
       neither that nor any other error as data.
     - **ClinVar keeps records with no classification at all** (two of GRB2's ten), and writes
       "1/01/01 00:00" where a record was never evaluated: read as not classified, with no date.
       A gene's summaries are about 2.4 KB a record (BRCA1's 9,384 coding records about 23 MB):
       MaveScape keeps one table of what it reads (about 150 bytes a record) with the workspace,
       the raw answers only in the cache.
     - **MaveDB annotates only the variants it maps at the nucleotide level**: GRB2's
       protein-level score set has no ClinVar or gnomAD annotation; BRCA1's saturation genome
       editing has 1,376 ClinVar classifications and 41 gnomAD frequencies. MaveDB's frequencies
       are gnomAD v4.1's, exomes and genomes joined, exactly as MaveScape reads gnomAD's own.
     - **UniProt's GFF3 and JSON name some features differently** ("Signal peptide" and
       "Signal"), and only the JSON names a binding site's ligand: otherwise the same features,
       read into the same tracks.
     - **Conservation and the position effect agree only in part** on GRB2's SH3 domain (Spearman
       ρ −0.43 with PDBe-KB's profile, −0.49 with AlphaMissense's mean): abundance is not all a
       residue is conserved for. The guide says so.
     - **Proteoscope's `conservation.js` used `Math.log`**, which MaveScape's determinism rule
       forbids in code that computes results: `dmath.js`'s log and exp in its place (within the
       tool's agreement either way).
     - **Built-in tracks shown by default would have changed every map export** (the headless
       `mavescape run` writes the map through the window): the run's own tracks are hidden until
       shown, an annotation's shown once added.
6. **Examples (T4): done.** The two-condition differential map (DHFR with Lon protease functional
   and deficient, `00000063-a-1`/`-b-1`) and the MaveDB round trip (BRCA1 RING), bringing the set to
   thirteen. **Several score sets opened together** (`importMaveDB` with several URNs; the MaveDB
   dialog's *Open together*, `open_mavedb` with several URNs in `urn`): each record kept, each one's
   published scores a run named for what tells the records apart (`distinctNames`), their counts
   joined into one source assembled from every record's file (`assemble.js`, each file named by its
   URN's number, `00000063-a-1:Repeat1_t_00hrs`; `origin.urns`, `joined`), with a design drafted
   from their names as a condition each, the first the reference (`countsDesignTogether`); their
   targets the same sequence. An example opened from MaveDB can give the design its counts need
   (`files.design`, the paper's) and its first run (`ui/examples.js`, `scoreExampleCounts`, through
   `importMaveDB`'s `prepare`), and states the target's offset and identifiers. *DHFR with and
   without the Lon protease* (`dhfr-lon`; Thompson et al., eLife 2020): four sub-libraries of 40
   positions, each grown three times, two in each of six repeats per condition, eight time points
   over 18 hours, the transformation and outgrowth samples set aside; the map opens on +Lon − −Lon.
   *BRCA1 RING domain, from MaveDB and back* (`brca1-ring`; urn:mavedb:00000003-a-2): the phage
   assay's design (two library preparations, shared inputs, the two-hybrid columns set aside), Run 1,
   the guide's deposit and its package opened again. **A replicate of a tile measures only its
   tile's positions** (`tileRows`, `tileView`, `coversPosition` in `design.js`; the scorer and QC
   read each replicate's samples through its tile; the state `OUTSIDE_TILE`); samples held by
   replicates of tiles that do not overlap are not shared (`sharedSamples`, `multiTileSamples`, the
   summary says so); the inspector and `inspect_variant` list a variant's tile's replicates.
   Conditions that share no input are compared as independent by default. A drafted time series
   takes its unit from its names (`t_02hrs`, `day5`, `gen10`). The examples page's two sections and
   screenshot scenes (`dhfr-lon`, `brca1-ring`); the guide's *Several score sets as conditions*.
   - Validation:
     - `examples` (46 checks): both examples opened as the window opens them, their tables
       MaveDB's as pinned (`mavedb-dhfr`, a new data set in `sources.json`; the DHFR records in
       `fixtures/public-data/mavedb`), QC raising exactly their findings. DHFR: 96 samples holding
       two tiles, 0 measurements used outside their tile, no variant combined from more than its
       three replicates; against the published scores r 0.898 and 0.959 with the defaults, 0.961 and
       0.983 with ordinary least squares, median ratios within 5% of 1; the published 736 and 384
       advantageous substitutions, here 877 and 391 (2.24×); 376 differences called at q < 0.05,
       346 negative; a mean difference of −0.48 at the 53 native hydrophobic positions, −0.20 at the
       others. BRCA1 RING: 12,316 variants, 6 replicates of rounds 0–5, 2 shared inputs, 24
       two-hybrid columns set aside; 50,055 replicate scores within 1.8 × 10⁻¹⁴ of the published with
       the defaults (combined r 0.992), the Enrich2-compatible preset's combined r 1.00000 with
       6,847 scored, as MaveDB's; the eight zinc ligands ranked 3–12 of 291 positions; Run 1
       deposited, its 11,618 scores read back exactly, written again the same bytes, its experiment
       described as the record's.
     - `remote-session.mjs` (108 checks): DHFR's two URNs opened together offline (the tables
       copied into the session's cache from `mavedb-dhfr`; CI's `remote` job fetches them and runs
       with `--require-data`): both records, a published run each (2,543 and 2,378 scored), the
       joined counts with a design drafted in hours, a condition each; `open_example "dhfr-lon"`,
       Run 1 with Node's output hash, its map on +Lon − −Lon; Run 1 reproduced from the two files.
     - `mavedb-live.mjs` (19 checks): DHFR's two score sets opened together live, each record's
       tables the ones `sources.json` pins.
     - `mavedb-export`: the reference regenerated by MaveDB's own validators (BRCA1's saturation
       genome editing counts now draft in days, which its deposit's descriptions say); all 19
       deposits accepted as before.
     - Unit tests 308: two tiles in one sample's variants (each replicate's own, none twice, the
       same scores as alone), the default comparison of conditions with and without a shared input,
       samples of non-overlapping tiles not shared, the draft's time unit, several URNs and a joined
       design.
   - Found by slice 6:
     - **A sample holding two tiles counted twice.** DHFR's repeats grew two sub-libraries each, so
       each replicate's samples held another tile's variants, which it scored, and the combination
       took every replicate that counted a variant: one measurement combined twice, its SE too
       small. 1,284 differences between the conditions were called at q < 0.05; measured once, 377.
       QC compared the same measurements twice too. Factor IX's tiles have samples of their own, so
       its scores are the same bytes.
     - **"Paired by their shared input" with no input shared** fell back to independent, and the
       run's parameters said paired: conditions that share no input are now independent by default.
     - **The draft read `t_02hrs` as a time with no unit**, though its pattern names hours.
     - **MaveDB's DHFR records disagree with themselves and the paper in places**: the +Lon record's
       method text says the library was transformed into the Lon-deficient strain (copied from the
       −Lon record); both name E. coli BL21(DE3) where the paper used ER2566 ΔfolA ΔthyA (both B
       strains, both without Lon). Neither says which sub-libraries each repeat holds: the counts
       do, and the conditions pair them differently. A count below 2 × 10⁻⁵ of the reads is `NA`,
       and the 4 double mutants of the −Lon record are off the map.
     - **The published DHFR scores are Enrich2's unweighted regression** over the whole 18 hours,
       which the record does not say (the paper does): r 0.96–0.98 with ordinary least squares,
       0.90–0.96 with MaveScape's weighted regression, whose weights follow each time point's counts.
     - **The BRCA1 RING design called its phage assay E2 binding.** The record and the paper: E3
       ubiquitin ligase activity, by autoubiquitination of the displayed RING with the E2 present
       ("PlusE2"); the two-hybrid assay measures BARD1 binding. The validation design, data set and
       checks say so now; earlier entries of this roadmap and the CHANGELOG keep the old words.
     - **An example's map view was not applied when the map was already shown** (the map keeps one
       view object): a two-condition example opened from the map showed its first condition, not
       the difference.
     - **The inspector listed every replicate of a condition**: 9 of DHFR's 12 (6 of factor IX's 9)
       do not measure a given variant. It lists the variant's tile's now.
     - Wave 3 is complete with slice 6.

**Released 0.3.0 on 2026-10-11.** Each workspace opened from MaveDB is a workspace of its own, so
0.3 leaves three archives (`validation/archives/release-0.3.0-*.msz`, 2.5 MB together). They were
saved by 0.3.0 itself, its window driven through remote control offline by `make-0.3.0.mjs`:
- GRB2 opened from MaveDB: the record, the published scores, MaveDB's mapped variants, the counts
  scored, the UniProt check, and seven annotations arranged and filtered;
- DHFR's two score sets opened together: the counts joined, two tiles in each sample, time in
  hours, the conditions independent;
- BRCA1's saturation genome editing: a RefSeq target, nucleotide variants, the counts scored, and
  MaveDB's annotations and gnomAD.

Every later version must reopen them, reproduce their seven runs and read their annotations' tracks
again.
- Found by the release:
  - **A run's tracks kept the identifiers its target had when it was scored.** Checking the target
    against UniProt after the run gave the target its gene, yet that run's ClinVar and gnomAD still
    asked for one. A run's tracks now take the identifiers the workspace's target has, while its
    sequence and offset are the run's (`trackTarget`).
  - **The archive replay assumed what 0.3's runs do not have**: standard errors (published scores
    may have none), a map at the level of the variants (a nucleotide run's is drawn at the protein
    level), and tracks read without the run's record (MaveDB's annotations join by its variants and
    accessions, which the Node tracks now give as the window does).
  - **The first run scored after opening a MaveDB record was Run 2**: the published scores counted
    as a run. They take no number now (`nextRunName`), and a name already taken is skipped.
  - **CI had never run wave 3**: it runs on pull requests and `main`, so the release's pull request
    was the first. Its remote job lacked BAP1's MaveDB table, which the session's deposit has been
    compared with since slice 4 (cached on this computer, so every local run passed). The job
    fetches it now, and the session names a missing table instead of stopping.

## 0.4.0: compare (wave 4)

Comparison comes before structure ("How the waves map to the PRD's phases"). A laboratory's first
questions about its own experiment are about comparison: does an effect survive another reasonable
analysis, does one replicate drive it, and do two assays really disagree or only use different
scales?

### Wave 4

The roadmap first had three items for this wave. Before the wave began, the first item
(comparisons, C1–C3) was split into three slices, as large as wave 3's. Robustness and selections
follow, and the wave ends with its examples, as waves 2 and 3 did.

1. **Comparisons within a workspace (C1, C3, part of C2): done.** A comparison engine (`web/lib/compare.js`)
   that pairs two sets of scores in one workspace and matches their variants: two replicates of a
   run, two conditions, a run's condition and another run's (a rescoring, or the published scores
   of a MaveDB record against its counts scored again). A Compare view and the remote action
   `compare`.
   - **The compatibility report comes first** (C3):
     - the targets: the same sequence, or one UniProt entry at different offsets, matched on its
       coordinates;
     - the level: nucleotide variants read at the protein level when the other side is protein;
     - the variants matched, and those scored on one side only;
     - the readouts: direction, units, reference state and rescaling;
     - whether the two sides are independent: replicates that share an input, or one table scored
       twice, agree for reasons other than the biology.

     Two sets of scores on different or unknown scales are compared by correlation only: Lin's
     concordance and Bland–Altman, which measure agreement on one scale, are withheld and the
     report says why. A comparison that cannot be made (different targets with no common
     reference, too few variants in common) is blocked, saying why.
   - **A scatter plot with agreement statistics** (C2, in part): Pearson's r and Spearman's ρ, Lin's
     concordance correlation and Bland–Altman's bias and limits of agreement, each with a 95%
     interval; the Bland–Altman plot; a variant clicked shown in the inspector.
   - The matched variants exported (`comparison.csv`), with the report and the statistics
     (`comparison.json`).
   - The statistics are in `web/lib/agreement.js`. The BRCA1 saturation genome editing example's
     last step compares its counts, scored, with the published scores; a screenshot scene for each
     (`compare`, `compare-published`); the guide page *Comparisons*. An example opened from MaveDB
     gives its readout to its counts' draft too.
   - Validation:
     - `compare` (19 checks):
       - every statistic of seven pairs equal to R's (`cor.test`, Spearman with Bonett and
         Wright's interval, DescTools' `CCC`, BlandAltmanLeh, `lm`) to 10⁻¹⁰;
       - in 2,000 simulated pairs of known agreement of each of five kinds, the 95% intervals
         holding the truth 94–96% of the time (two weaker, reported apart);
       - the report's rules on GRB2 and on pairs made from it (moved along UniProt P62993 and
         matched on its coordinates; blocked without an accession; a direction stated the other
         way);
       - the examples compared as their guides say: BRCA1's counts against its published scores
         (r 0.76, correlations only); DHFR's Run 1 against each record (0.898 and 0.959); DHFR's
         published pair matched as R's merge matches it; BRCA1 RING's replicates sharing an input.
     - `remote-session.mjs` 114 checks: `compare` and its export, as Node compares the runs it
       recomputes from the archive.
     - Unit tests: `compare.test.mjs` (8).
   - Found by slice 1:
     - **DHFR's Run 1 scores 626 variants that the published scores leave out**, at about four
       times the SE. They agree little between the conditions (r 0.15), so −Lon and +Lon
       correlate at 0.52 in Run 1, 0.76 on the published scores' variants, and 0.81 in the
       published scores. The confidence and depth filters of slice 2 are for this.
     - **Two intervals hold the truth less often than they claim**, and the suite reports them as
       they are rather than tolerating them unseen:
       - Spearman's near r = 1 (86% with 30 variants, 92% with 200): the sample ρ is biased below
         the truth there;
       - Lin's with 30 variants on two scales (92%).
     - **An example's readout reached only its published scores**: compared with them, the counts'
       drafted design said nothing of the direction. The readout is the assay's, and now reaches
       both.
     - **DHFR's two published score sets are on one scale in fact** (one study, one pipeline), but
       nothing in their records says so: they are compared by correlation only until slice 3 lets a
       person put two sets on one scale.
2. **Comparison views across the map (C2): done.** Synchronized maps of the two sides, the difference
   map, the variants that disagree beyond their uncertainty (each difference's z from both SEs,
   where the two are independent), disagreement by position, and filters by confidence and depth.
   Exports of each.
   - The Compare view has three tabs: Agreement, Maps and Disagreement.
     - **Filters:** low confidence on either side, a maximum SE, a minimum of input reads. A side
       without SEs or counts is not filtered on them, and the report says so.
     - **Maps:** the two maps and the difference map (the comparison drawn as the map draws a
       contrast), panned and zoomed as one. The map component tells others its view and takes
       theirs, two stretches of one protein lined up on its coordinates. A variant clicked is
       selected in each.
     - **Disagreement:** each difference's z, p and q, valid for two independent sides on one
       scale; the dispersion (median z² over its expected value); and the disagreement by
       position, a position tested with 3 variants or more.
   - Exports: `*_comparison.csv` with z, p and q; `*_comparison_positions.csv`; the three maps as
     SVG; the report with the discordance and positions. Remote control's `compare` takes the
     filters and the tab; `export` writes `comparison-positions` and `comparison-map`.
   - The DHFR example's sixth step compares its conditions; two screenshot scenes
     (`compare-maps`, `compare-disagreement`).
   - Validation:
     - `compare` (25 checks):
       - the discordance and the positions of 600 variants equal R's (`pnorm`, `p.adjust`);
       - in 20 simulated pairs with planted differences, 96% of planted variants found, 4% of
         calls false, 57 of 60 planted positions; with nothing planted, dispersion about 1 and
         none called;
       - DHFR's discordance equal to Run 1's own differential z;
       - the filters as this suite counts them;
       - the difference map drawing every difference;
       - GRB2's dispersion where QC finds variance beyond counting.
     - `remote-session.mjs` 116 checks: the comparison with a filter, its positions and maps the
       same bytes as Node's.
     - Unit tests: `compare.test.mjs` 11 (the filters, when discordance is tested, a position's
       three variants, the maps of a comparison).
   - Found by slice 2:
     - **Replicates differ far more than their counting SEs say.** GRB2's replicate differences are
       8.2 times as variable as their SEs (the dispersion), so a test of each difference would call
       479 of 1,109 discordant. The view reports the dispersion and warns above 1.5; QC's variance
       beyond counting finds the same bottleneck.
     - **DHFR's two conditions differ 2.8 times as much as their SEs say**, even with low
       confidence left out. Run 1's own differential between them (the conditions as
       independent, wave 3 slice 6) uses the same SEs, so its 377 calls are an upper bound too.
       Comparing analysis choices is slice 4's work.
     - **A position's test was one variant's when it had only one compared** (DHFR's V99 ranked
       second): a position is now tested with 3 variants or more.
     - **Clicking a map cell moved the keyboard focus away**, because the view was drawn again.
       The maps now update their selection in place.
3. **Other sources and scales (C1, C3): done.** A MaveDB score set compared with a local run without
   opening it into the workspace, another assay of the same protein, and a predictor (AlphaMissense,
   EVE or ESM1b, from the tracks' providers). Two assays rescaled onto one scale by their anchors
   (wave 2, slice 8: nonsense and the wild type), which published scores refuse today; a
   predictor compared by rank and by its classes.
   - **A MaveDB score set kept beside the workspace**, by its URN: an annotation of a new
     provider, `mavedb-scores`. Its record and published scores come through the fetcher, the
     scores file kept as MaveDB sends it, with the record's target (fetched when a transcript names
     it), keywords, and the direction a person states (MaveDB records none). `lib/scoreset.js`
     reads its scores as published, as opening the record would. It is a comparison side (matched
     on one sequence, or on UniProt's numbering) and a track beside the map. Added from Compare's
     Other sources, the Tracks menu, `compare` with a URN, or `add_track`.
   - **A predictor as a side:** AlphaMissense, or a predictor's file, placed on the measured side's
     protein as its track is. AlphaMissense's and EVE's scores are compared negated, ESM1b's as
     they are, another table's direction is said to be unknown.
     - By rank: Spearman's ρ with its interval; Pearson's r, Lin's concordance, Bland–Altman and
       the tests of disagreement withheld.
     - By its classes (the Classes tab): the measured scores in each class (median, quartiles),
       the synonymous and nonsense medians for reference, and the AUC of telling the tolerated
       class from the damaging one with DeLong's interval (`aucAgreement`, `lib/agreement.js`).
     - EVE's table now gives its classes.
   - **Scale** (`SCALES`, `lib/compare.js`):
     - as scored;
     - stated to be on one scale;
     - each side rescaled by its own anchors (`anchorsOf`): the nonsense median and the wild type,
       or the synonymous and nonsense medians, as a run's rescaling does.

     The anchors' SEs (the wild type's; a median's √(π/2 × mean SE²/n), as `anchors.js`) are
     carried into each difference's test and, shared, into each position's. Rescaled sides are
     aligned by their anchors rather than negated.
   - Exports: `compared_a` and `compared_b` in `*_comparison.csv`; `*_comparison_classes.csv`;
     the report's `scale`, `classes` and each side's source. Remote control's `compare` takes
     URNs, predictors, `scale`, `direction` and `show: classes`; `export` writes
     `comparison-classes`; `add_track` takes `mavedb-scores` with a `urn`.
   - The PTEN example's sixth step compares its abundance with its phosphatase activity (a score
     set not opened) and with AlphaMissense by class. Two screenshot scenes (`compare-scales`,
     `compare-classes`).
   - Validation:
     - `compare` (36 checks):
       - two assays on two scales rescaled by their anchors (both rescalings) equal to R's, with
         the anchors' SEs and the tests' share;
       - GRB2's published scores against AlphaMissense by class equal to R's (pROC's DeLong
         interval), and an AUC with ties;
       - in 600 simulated pairs of two assays differing only in scale, false calls in 3.5–4% of
         pairs with the anchors' uncertainty, 10–55% without it;
       - DeLong's interval holding the AUC 94–95% of the time;
       - DHFR's record kept beside the workspace the same as opened;
       - a score set and a predictor through the archive;
       - the examples' numbers (GRB2, DHFR's published pair stated on one scale, PTEN).
     - `remote-session.mjs` 119 checks: a URN compared, rescaled, and AlphaMissense by class, as
       Node gives them; their exports the same bytes.
     - Unit tests: `compare.test.mjs` 15; `providers.test.mjs` a score set from the cache.
   - Found by slice 3:
     - **DHFR's published standard errors were never read.** Its records name the column
       `standard error`, in words, which the importer did not recognize, so DHFR's published runs
       had no SEs. The importer now reads it. Stated on one scale, DHFR's two published sets get
       Lin's concordance (0.79) and a test of their differences: 761 of 2,277 differ, but their
       dispersion is 5.3.
     - **A deposited wild type can be a placeholder.** PTEN's lipid phosphatase record writes its
       wild type as 1 with an SE of 0. Its methods put the wild type-like variants from −1.11 to
       0.89, and the missense median is −0.37. So its map is centered on 1, and rescaled by that
       row its activity sits low. The report names every anchor, so the row is visible. Stating an
       anchor's value, where a deposit's is wrong, is left for later (slice 6's examples may need
       it).
     - **Leaving the anchors' uncertainty out of the tests calls many differences that are not
       there**: 10% of null pairs when the anchors are well measured, 55% when the wild type is
       uncertain and nonsense variants few. With it, 3.5–4%.
     - **Two assays of one protein differ far beyond their SEs.** PTEN's rescaled abundance and
       activity have a dispersion of 9.4, and 1,887 of 4,057 variants test as different. Much of
       that is biology: a variant can be stable but inactive.
     - **A long side label was cut off** on the plot's axis (a score set's title and URN); labels
       now shorten to fit.
4. **Robustness to analysis choices (C4): done.** A run is repeated across variations, following
   CytoWeave's `multiverse.js` pattern:
   - pseudocounts, normalizations, filters, combination methods and uncertainty models (scaling
     each replicate, as DiMSum does, among them: wave 2, slice 9);
   - each replicate left out in turn;
   - low-depth measurements removed.

   For each variant and position, it shows what changes: the effect size, its rank, its
   uncertainty, whether it is scored at all, and its class. It shows more than which threshold a
   variant crosses. It says which conclusions hold under every reasonable choice and which depend
   on one. No DMS tool shows this.
   - Validation: simulated experiments with a planted fragile result: one replicate driving an
     effect, and an effect that appears at only one pseudocount. The variants reported as fragile
     are exactly the planted ones, and a robust result is reported as robust.

   What it does:
   - **The engine:** `lib/robustness.js`.
     - The choices a run offers, its own first. Fixed effects are left out where the replicates'
       dispersion (Cochran's Q over its median) is above 1.5.
     - The specifications: CytoWeave's `specifications`, copied, with a fixed seed; 48 by default.
     - Each scored in the score worker (job `robustness`).
     - The calls: each condition's class against the wild type (z from the score less the wild
       type's, the reference's SE added unless the scores are relative to it; t on the moderated
       degrees of freedom; BH q < 0.05), and each difference's from its q.
   - **The summary:**
     - each variant's verdict: robust, fragile, depends on its uncertainty, borderline, its effect's
       size depends on a choice, not always scored;
     - the single choices it depends on, else the smallest combination;
     - each alternative's effect;
     - calls held in every analysis and in 90%;
     - the least tolerant positions.

     A move counts when beyond the declared 95% interval and five robust SDs from that analysis's
     median move.
   - **In the window:** the Score view's Robustness pane, full width below the run; the inspector's
     block.
   - **Exports and remote control:** `*_robustness.csv`, `*_robustness_positions.csv` and
     `*_robustness.json`; remote control's `check_robustness`, and `export` of `robustness` and
     `robustness-positions`.
   - **Guides:** the DHFR example's fourth step; the guide page *Robustness*; a screenshot scene
     (`robustness`).
   - Validation:
     - `robustness` (9 checks):
       - the specifications;
       - the declared analysis is the run;
       - the classes equal an independent computation;
       - in ten planted experiments (declared by fixed effects), the fragile variants exactly the
         replicate-driven ones and the pseudocount-sized ones exactly the zero-count ones, every
         time;
       - the clearly lost variants robust;
       - under the defaults, nothing fragile;
       - GRB2's and DHFR's checks;
       - the files the same bytes from a second check.
     - `remote-session.mjs` 122 checks.
     - Unit tests: `robustness.test.mjs` (5).
   - Found by slice 4:
     - **MaveScape's moderated combination is not misled by one replicate**: an effect that one
       replicate drives is not called (its SE carries the disagreement), nor is a dropout's. The
       planted test needed an analysis that can be misled (fixed effects) to plant a fragile
       conclusion at all.
     - **With three replicates, the account of uncertainty decides many calls.** GRB2's Run 1 keeps
       the class of 504 of 1,118 variants in every analysis; 445 change only with REML or the
       replicates' mean in place of the moderated combination. Its least tolerant positions hold.
     - **DHFR's differences between the conditions mostly do not survive** (slice 2's question):
       54 of 377 hold in every analysis, 172 in 90%. Most depend on the account of their
       uncertainty, some on the model of the time course.
     - **A pseudocount moves a zero count's size, not its class**: counting SEs grow as the
       pseudocount shrinks, so a zero count's call holds while its effect moves. The verdict "its
       effect's size depends on a choice" was added for it.
     - **A 95% interval alone flags chance moves**: leaving a replicate out moves every estimate,
       and among a thousand variants a few cross their interval by chance. A move must also be an
       outlier among the moves that analysis makes (five robust SDs).
     - **Fixed effects are not a reasonable choice where QC finds variance beyond counting**: tried
       on GRB2, they changed 373 classes by shrinking every SE. They are left out there, saying
       why.
     - The determinism guard caught `**` in the new module; the Score view's narrow column could
       not hold the pane's tables (now full width).
5. **Selections (V3): done.** Freeform and query selections ("missense at 40–80 with SE < 0.2",
   "variants whose class depends on the pseudocount"; structural classes such as "buried
   positions" with wave 5), named sets, set operations, export.

   What it does:
   - **The query language** (`lib/query.js`), its tokenizer and parser adapted from Proteoscope's
     `select.js` (whose residue selections wave 5 copies), so that the roadmap's phrases are
     queries as written: terms side by side, and "with", "whose" and "that", mean and.
     - Words for the class, the state, positions (target or reference numbering), the wild-type
       and substituted residues (letters or the map's groups), the score, SE, q, replicates and mean
       input count compared with a number, and the class against the wild type (robustness.js's
       calls).
     - The robustness verdicts, and "depends on", "class depends on" and "size depends on" a choice:
       the choices that alone account for a verdict, which the summary now keeps by id
       (`dependsOnIds`).
     - "feature": positions under a feature beside the map (UniProt's, a GFF3 file's).
     - "in": a saved selection by name; "selected": the selection now.
     - A query that names what the run lacks says so and offers it: the robustness check, or
       UniProt's features.
   - **Freeform shapes** on the map: ⌥- or Alt-drag, or a drag mode (Pan, Rectangle, Freeform) for
     a touch screen; the cells whose centers the shape holds (`cellsInPolygon`, `map-render.js`).
   - **Named sets and set operations:** a saved selection keeps its query. Under the map, each saved
     selection selects, adds to, intersects or subtracts from the selection, or runs its query
     again; a query does the same by name. A selection made by queries keeps them, combined, so
     that it can be made again. A saved selection applies to every run of the same protein.
   - **Across the views:** the Score view's table lists the selection and sends any list to the
     map; the Robustness pane sends each verdict's variants (by its word); Compare's maps outline the
     selection, and its discordant variants go to the map; the inspector shows a saved selection's
     query and the runs it applies to.
   - **Exports and remote control:** the selection's JSON has its `query`; `select_variants` takes
     a `query`, an `operation` and a `contrast`, and checks the run's robustness when a query needs
     it.
   - **Guides:** factor IX's fifth step (its disulfide bonds' cysteines by query); the guide page
     *Selections*; a screenshot scene (`selections`).
   - Validation:
     - `selections` (8 checks):
       - the roadmap's phrases;
       - fourteen queries on GRB2's Run 1 against an independent account of each of its 1,176
         cells, read from the run's own arrays;
       - set operations and their laws, and a saved selection on a second run;
       - each robustness verdict exactly the check's;
       - in three planted experiments, the planted variants exactly;
       - factor IX's 22 bonded cysteines from UniProt P00740;
       - freeform shapes against the rectangle tool and a circle;
       - the files and the archive.
     - `remote-session.mjs` 123 checks.
     - Unit tests: `query.test.mjs` (5), and a freeform shape's cells in `map-render.test.mjs`.
   - Found by slice 5:
     - **Depending on a choice has to mean depending on it alone.** A verdict that only choices
       together account for first counted for each of them. "Class depends on the pseudocount" then
       selected variants at the threshold that four to six changes together moved: 6, 1 and 1 in
       the three planted experiments the suite checks, none of them planted. The summary now keeps by id only the choices that
       alone account for a verdict.
     - **On GRB2, the roadmap's own query selects 4 variants, all at the threshold.** "Variants whose
       class depends on the pseudocount" are borderline (q 0.031 to 0.047), each moved by leaving
       out a replicate too. No variant's size depends on the pseudocount there. In the planted
       experiments, the pseudocount moves the zero counts' size and never their class.
     - **A secreted protein needs its disulfide bonds.** Of the substitutions of the 22 cysteines in
       factor IX's 11 bonds, 345 of 399 scored are lower than the wild type, against 2,124 of 8,529
       missense variants (25%). Its two other cysteines are in the signal peptide (C18, C28): 24 of
       their 38 are lower, which needs another explanation than a bond.
     - **A saved selection was shown only on the run it was made on**, though a list of names applies
       to every run of the protein. It is now listed, and used, on each.
     - **A rectangle always added to the selection**, because the Shift that drew it also meant add.
       With the drag modes, a rectangle or a shape replaces the selection unless ⌘, Ctrl or Shift is
       held.
6. **Examples: done.** Published comparisons that teach what the wave built: two assays of one
   protein that only seem to disagree until they are on one scale, a rescoring against the published
   scores, and a conclusion that depends on an analysis choice.

   Earlier slices had already given the examples a rescoring each (BRCA1 SGE's counts against its
   published scores, slice 1; GRB2's record, slice 3) and a conclusion that depends on a choice
   (DHFR's differences, slice 4). The lesson no example taught was two assays that only seem to
   disagree; PTEN's two assays (slice 3) disagree for real. This slice adds:
   - **TP53, two screens on two scales** (`tp53-screens`), the fourteenth example, opened from MaveDB.
     It opens Giacomelli et al.'s etoposide screen (urn:mavedb:00000068-c-1), published Z-scores of
     every substitution of TP53 with arginine at 72. It keeps two others beside it, not opened:
     Kotler et al.'s screen of the DNA-binding domain by the growth of H1299 cells
     (urn:mavedb:00000059-a-1), log₂ fold changes; and Giacomelli et al.'s nutlin-3 screen
     (urn:mavedb:00000068-b-1). The guide:
     - checks the target against UniProt P04637 (the record names none);
     - compares the screens as published, with the direction stated, and rescaled by their anchors;
     - reads the positions that differ most;
     - compares the study's two selections.
   - **Hsp90's sixth step**, a rescoring against the published scores that is also a conclusion
     depending on a choice. Run 1 is compared with the record's own scores kept beside; stated on
     one scale, the Bland–Altman plot shows the authors' choice of time points for null-like variants.
   - The examples page, the guide *Comparisons* (two screens that only seem to disagree; a rescoring
     against the published scores), two screenshot scenes (`tp53-screens`, `hsp90-rescoring`).
   - Validation:
     - `examples` (52 checks):
       - the TP53 example opened as the window opens it, its table MaveDB's, pinned as a new data set
         (`mavedb-tp53-screens`; the three records and UniProt's P04637 in `fixtures/public-data`);
       - TP53's numbers as its guide states them, and Hsp90's comparison with its record.
     - `remote-session.mjs` 124 checks: the TP53 example offline, its target checked, both other
       screens compared by URN as Node compares them.
     - Unit tests: `score.test.mjs`, repeated published protein variants merged.
   - Found by slice 6:
     - **A published score set that writes a protein variant on several rows could not be compared
       at all.** Kotler et al.'s record writes 936 protein variants on 2,908 rows with different
       scores (several codons, and no nucleotide names to tell them apart), and MaveScape refused
       it. Published protein variants on several rows are now merged as DiMSum merges a protein
       variant's codons (unweighted, without SEs), and the report says so. Its 191 frameshifts,
       which MAVE-HGVS names alike at a codon, are left out rather than merged.
     - **Two laboratories' screens of TP53 only seemed to disagree.** As published, the 3,341
       variants they share correlate at r −0.78: opposite signs, and a Z-score against a log₂ fold
       change. With the direction stated, r 0.78; rescaled each by its own anchors, Lin's
       concordance is 0.78 and the bias −0.04. Four of the eight positions that differ most lie at
       180–184, lower under etoposide.
     - **Two selections of one library differ about as much as two laboratories' screens.**
       Giacomelli et al.'s nutlin-3 and etoposide screens agree at Lin's 0.72 rescaled; their
       records' keywords name two assays.
     - **Correlation is not agreement in a rescoring.** Hsp90's Run 1 correlates with its record's
       scores at r 0.95, but on one scale Lin's concordance is 0.48. The difference grows with the
       effect (Bland–Altman slope −0.91), largest at 585–587, where the authors fit null-like
       variants on their first three time points. How deleterious those variants are depends on that
       choice. MaveScape's own robustness check cannot vary it: it is not among the run's choices.
     - **A record without a UniProt entry is matched once its target is checked.** Giacomelli et
       al.'s record names none, and its target carries arginine at 72; checked against P04637 (one
       difference, P72R), it is matched with Kotler et al.'s domain on UniProt's numbering.
     - **Two data sets were considered and set aside.** UBE2I's TileSeq and BarSeq scores
       (urn:mavedb:00000001-a-3 and -a-2) are already put on 0 to 1 by their authors, and BarSeq's
       are mostly multi-mutants. CBS's low-B6 record (urn:mavedb:00000005-a-5) holds eight selections
       on four inputs (inputs 5–8 copies of 1–4), and the paper's low B6 is two levels (0 and 1
       ng/ml), but the record does not say which columns are which. Its published scores agree with
       selections 1–4 and 5–8 alike (r 0.71 and 0.72), and a quarter of them are exactly 0 (2,538
       of 11,478, floored). The validation's limma check uses selections 1–4 as low B6, as before.
     - **A plot's axis read −5.55e-17 for 0** (Hsp90's Bland–Altman plot): ticks summed a
       fractional step; each is now a whole multiple of it. A robustness check of nine positions
       said "Of the 1 least tolerant positions"; one is now said as one.
     - Wave 4 is complete with slice 6.

**Released 0.4.0 on 2026-10-11.** A comparison is the session's, but what it rests on is the
workspace's, so 0.4 leaves two archives that keep it (`validation/archives/release-0.4.0-*.msz`,
0.9 MB together). They were saved by 0.4.0 itself, its window driven through remote control offline
by `make-0.4.0.mjs`:
- TP53, two screens on two scales: the published scores, the target checked against UniProt, two
  MaveDB score sets kept beside it with their directions stated (one with protein variants on
  several rows), a selection by query and another made from it by a set operation;
- GRB2's SH3 domain, compared: two runs, its record's published scores kept beside, AlphaMissense
  and UniProt's features beside the map, and selections by query (a feature's positions, an
  operation on a saved selection, Run 1's robustness verdicts).

Every later version must reopen them and reproduce their three runs. It must also read their score
sets again, and run their saved queries again to the same variants (a query of the robustness
verdicts must keep its variants on the map). At the release, `mavescape run --from-workspace`
reran all eighteen runs of every release's archives in a window, each to its recorded hash.
- Found by the release:
  - **Messages wrote "Published scores's"**: a run, table or annotation whose name ends in "s" took
    "'s" wherever a message named it (remote control's selections among them). One helper writes
    every such possessive now (`lib/words.js`).
  - **Remote control's message for an operation on the selection was garbled** ("kept those also
    394 variants in the selection"); it says how many matched and what was done.
  - **The screenshots' accessibility audit has never run**: `capture.mjs --audit` asks for an
    `axe-core` data set that `sources.json` does not have. The screenshots were recaptured without
    it, as at 0.3.0; adding the data set is left for later.

## 0.5.0: variants in 3D (wave 5)

Structure viewing as a full part of MaveScape: a variant-effect map seen on the protein, and the
structure used as evidence. The viewer is copied from Proteoscope (Apache-2.0, same author), with
an origin comment in each file, and runs without Proteoscope installed. It needs the fetcher of
wave 3 for PDB IDs and AlphaFold models; local files work offline.
MaveDB already shows published maps on structures, so the view must earn its place in two ways:
as evidence (slice 4), and through wave 4's comparisons drawn on the protein.

### Wave 5

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
   - **Done.** Seventeen modules copied into `web/lib/structure/`, each with an origin comment,
     fifteen unchanged; `chemistry.js` without ligands given as SMILES, `coloring.js` without the
     color schemes of data MaveScape does not read. The surface worker answers surfaces and areas
     (`web/workers/surface-worker.js`).
     - **The program:** `structures.go` asks RCSB for an entry (`/api/fetch/pdb/{id}`) and AlphaFold
       DB for a protein's entries and a model by its version (`…/prediction`, `…/model/{version}`),
       sending an ID or an accession only. A structure is kept compressed, as the service sent it,
       once read to its end and found whole.
     - **The page:** `ui/structure-viewer.js` drives the renderers for one structure (Proteoscope's
       scene, colors, selection flags, labels and camera); `ui/mode-structure.js` is the view:
       opening, styles, colors, surfaces, assemblies, residues selected in words, drawn, labeled
       and focused on, the structure in words, an image. `lib/structures.js` reads a file however
       it comes and describes it. Remote control's `open_structure` and `set_structure`.
     - The factor IX example's sixth step opens 1RFN and draws its cysteines as sticks; two
       screenshot scenes (`structure`, `structure-alphafold`); the guide page *Structures*.
     - Validation:
       - Proteoscope's tests of the copied modules (66) pass, reading the structures the
         validation keeps as the fetcher's cached answers (`validation/fixtures/public-data/pdb/`,
         `…/alphafold/`: the examples' proteins, and the entries Proteoscope's tests name).
       - `structures` (6 checks): each example protein's entry holds its target on the UniProt
         residues it gives, and draws; each AlphaFold DB model's pLDDT agrees with the entry's own
         mean (0.05) and bands (0.01); 2VWF as gzipped mmCIF, PDB-format file and BinaryCIF, and
         GRB2's model as mmCIF and BinaryCIF, give the same atoms; assemblies built with the atoms
         estimated, hemoglobin's by symmetry; 1RFN's disulfide bonds drawn as its records say;
         1TUP's residues within 4 Å of DNA selected in words as every distance finds them.
       - `remote-session.mjs` (133 checks): every example protein's entry and model drawn with
         WebGPU and with the Canvas renderer, with the atoms Node reads and an image that is not
         empty; the structure actions, refusals included.
       - Unit tests: `structures.test.mjs` (6). Go: the structure requests.
   - Found by slice 1:
     - **AlphaFold DB names a model's file by its version** (v6 since 2025), which only its entry
       list gives, and refuses clients that announce themselves as curl (HTTP 403). The program
       asks for the list, then the model by its version; its User-Agent is answered.
     - **An entry's own numbering is not UniProt's everywhere.** 1RFN numbers factor IX's protease
       domain as chymotrypsin is numbered: 16–245, with eight insertions (60A, 95A, 95B, 129A, 129B,
       184A, 188A, 221A) and three numbers skipped, for UniProt's 227–461. Read linearly, as its
       record of the UniProt residues it covers gives them, positions drift by up to five. Positions
       on the structure wait for slice 2's alignment; the selection language's `uniprot` keyword is
       not offered until then.
     - **RCSB has revised entries Proteoscope bundles** (7LYB and 3OG7 are larger than its copies).
       Proteoscope's tests pass on the current files.
     - **A structure opened by a script was drawn small**: the camera was fitted before the view
       had its size. The view now fits once it has its size, and again whenever the size changes,
       until the camera is moved by hand.
     - **Headless Chrome offers WebGPU when asked** (`--enable-unsafe-webgpu`, on macOS). Where it
       does not (a Linux runner without a GPU may not), the session checks the Canvas renderer and
       says so.
     - Two of Proteoscope's chemistry tests (2HYY, 4HHB) need its `interactions.js`, which comes
       with slice 4; they are left out until then.
2. **Target-to-structure mapping (X2).** Structures that cover the target ranked by PDBe SIFTS
   (`best_structures`) and the AlphaFold model; the target aligned to each chain's observed
   residues (`align.js`, BLOSUM62) with the UniProt offset; a mapping report (coverage,
   unmapped, ambiguous and mismatched positions, engineered mutations, gaps); switching between
   experimental structures and the AlphaFold model keeps the mapping.
   - Validation: mappings equal SIFTS for every example protein (GRB2 SH3 2VWF, BRCA1 1JM7,
     Hsp90 2CG9, DHFR 1RX2, Factor IX 1RFN) and their AlphaFold models.
   - **Done.** `lib/mapping.js` aligns the workspace's target to every protein chain (Proteoscope's
     `align.js`, copied with its tests, against the entry's SEQRES with its residues observed
     marked) and gives each target position its state: on a residue (identical, or another with
     the entry's reason from `struct_ref_seq_dif`/`SEQADV`), not observed, missing from the
     structure's sequence, or outside; ambiguous where an alignment scoring the same places it
     otherwise. The entry's own record of the UniProt residues (`struct_ref_seq`/`DBREF`) is
     compared residue by residue. The chain holding the most of the target is chosen.
     - **Structures of the target:** PDBe's `best_structures` (a new request, the accession only),
       ranked by the target positions each entry covers, then resolution, the AlphaFold DB model
       first.
     - **Interchangeable structures:** `pos` and `uniprot` select by the target's and the
       reference's positions, placed by the mapping; a selection is kept, position by position,
       when another structure, experimental or predicted, is opened.
     - The Structure view's pane *The target on the structure*; the mapping's file (FORMATS.md);
       remote control's `find_structures` and `map_structure`, `open_structure`'s `chain`,
       `export` of `structure-mapping`. Factor IX's sixth step reads 1RFN's mapping; a screenshot
       scene (`structure-mapping`); the guide page *Structures*, its section on the mapping.
     - Validation:
       - `structures` (10 checks, 4 new): every example's target on its entry as residue-level
         SIFTS places it (`reference/sifts.json`: PDBe's updated mmCIF read with gemmi by
         `generate_sifts.py`), not observed where SIFTS says so, the one parting ambiguous; on each
         AlphaFold DB model, the model's numbering, with the targets' own differences; the entries'
         records (2VWF's engineered mutation, 1RFN's light chain, PTEN's removed loop); each
         target's structures ranked.
       - `remote-session.mjs` (138 checks): the list, the mappings and the mapping's file as Node
         makes them, a selection kept from 2VWF to GRB2's model, a chain refused.
       - Unit tests: `mapping.test.mjs` (8), `align.test.mjs` (8, Proteoscope's). Go: a file
         stored again is read to its end.
   - Found by slice 2:
     - **1RFN's own record of its light chain is five off.** Its `struct_ref_seq` numbers chain B
       (the second EGF domain) as UniProt 128–183; SIFTS and the alignment place it at 132–188,
       its first residue an initiator methionine where factor IX has V132. The mapping reports the
       record's shift rather than trusting it.
     - **Two alignments can score the same, and SIFTS takes one.** Where PTEN's loop (287–308) was
       removed from 1D5R's construct, the valine at the join scores as well against T286 as
       against A309; SIFTS places it at 286, the entry's own record and MaveScape's alignment at
       309. Ambiguity was first defined by identical residues; it is now by equal scores, and
       both positions are called ambiguous.
     - **2VWF engineers GRB2's P212 to alanine** (target position 54 of the SH3 example): the only
       difference between the example's target and its structure.
     - **SIFTS's ranking is not observation.** `best_structures` gives the span of each entry's
       sequence: TP53's first-ranked entries are cryo-EM structures whose sequence is the whole
       protein (p53 on a nucleosome, 9R2Q), how much of it observed only the entry says. The list
       says that its positions are the sequence's, observed or not; opened, the mapping says which
       are observed.
     - **Opening the factor IX example a second time in one library failed** ("Failed to fetch"):
       the program answered that it already had the 2 MB table before reading the upload, and its
       connection was closed under the browser. The program now reads the upload first.
     - **A PDB-format file without residue numbers in its SEQRES** places observed residues by
       name, and a run of repeated residues next to unobserved ones can be placed either way
       (Proteoscope's `alignResidueNames`). The mmCIF files the program fetches number every
       residue; RCSB's PDB-format 2VWF maps as its mmCIF does.
3. **Scores on the structure (X3).** Residues colored by a position summary (median, mean,
   minimum, fraction abnormal-like, number of scored substitutions), one substitution, the
   uncertainty, a comparison's disagreement (wave 4's difference coloring) or the QC state, with the map's visual grammar:
   missing and filtered positions never in the neutral color; a legend; AlphaFold confidence
   shown beside. Selections are shared both ways: a map selection highlights residues, a picked
   residue selects its map column and fills the inspector. The view follows the active run and
   condition.
   - **Done.** `lib/structure-scores.js` gives each target position its value for a coloring of
     the run's map (median, mean, lowest and highest score of its missense substitutions, the
     fraction abnormal-like, the count scored, one substitution, the median SE, Compare's
     disagreement, the QC state) and its state in the map's grammar, places it on the mapped
     target by reference numbering, and colors every chain that holds the target: the map's
     palette and scale, filtered and missing in grays no palette holds, low confidence paler.
     - **The view** (`ui/structure-coloring.js`): *Scores on the structure* beside it, the scores'
       colorings first under Color by, a legend with each state's positions, and a strip of the
       target's positions below it (their colors, which are on the structure, an AlphaFold DB
       model's pLDDT beside them). The run and condition (or contrast) are the map's; the target
       mapped is the run's.
     - **Abnormal-like** by a threshold set by hand (research use), or, for a MaveDB record's scores
       as published, by one of its calibrations' abnormal ranges.
     - **One selection:** a residue picked selects its position's variants on the map ("at …") and
       fills the inspector's new position section (`ui/position-inspector.js`); a map selection is
       drawn on the structure; residues selected in words, or by remote control, select their
       positions on the map.
     - The coloring's file (FORMATS.md); remote control's `set_structure` colorings and `pick`,
       `export` of `structure-scores`. The GRB2 example's sixth step (2VWF by the median score, the
       Gab2 peptide's neighbors); a screenshot scene (`structure-scores`); the guide page
       *Structures*, its section on the scores.
     - Validation:
       - `structures` (14 checks, 4 new): every example's run on its entry by every coloring,
         each residue's value and color against the run's results read without the map's model,
         nothing scored gray; the ten least tolerant positions shared both ways, on the residues
         SIFTS places them on; the GRB2 guide's account from the atoms; PTEN's fraction
         abnormal-like by its published calibrations' ranges as its JSON gives them.
       - `remote-session.mjs` (144 checks): 2VWF colored in the page as Node colors it, a pick, a
         map query drawn on the structure, the coloring's file, the other colorings, the strip.
       - Unit tests: `structure-scores.test.mjs` (7).
   - Found by slice 3:
     - **The selection's tint hid the scores.** Proteoscope marks selected residues by mixing
       their color half way to green; on residues colored by scores that changed what the colors
       say (the peptide's tolerant neighbors read green). Colored by scores, a selection is drawn by
       its side chains, in their own colors, with a faint tint. The renderers are unchanged.
     - **Waters carry their chain.** On 2VWF, "within 4 of chain B" also reaches Pro206 through the
       waters the entry gives chain B, and selects chain A's own waters; the guide's words add
       `protein` on both sides.
     - **The first methionine's column is start-lost.** Its substitutions are start-lost variants,
       not missense; they are its column on the map, and are counted as its substitutions. The
       validation's own reading first left them out, and found BRCA1's (SGE) and DHFR's Met1
       colored where it expected missing.
     - **Half of PTEN's calibrations classify variants, not ranges.** Three of its six (the
       investigators' and IGVF's two) give each variant's class in a column of the scores, with no
       range; fraction abnormal-like reads a calibration by its ranges, so those are not offered.
     - **The map's scale leaves medians pale.** It spans the cells (GRB2: ±5.10 about the wild
       type), and a position's median runs only from −4.60 to 0.08. It is kept, so that a residue
       is the color of a cell with its score.
     - **An abundance assay does not see binding.** On 2VWF, the ten residues within 4 Å of the Gab2
       peptide (W193 and Y209 among them) score a median of −0.39,
       against −0.81 for the rest; the ten least tolerant pack the core.
     - TP53's published Z-scores and BRCA1's saturation genome editing scores at the protein level
       have no standard errors: the uncertainty coloring is refused for them, saying so.
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
   - **Done.** `lib/structure-evidence.js` reads each target position on the chain mapped: DSSP's
     secondary structure (Proteoscope's `dssp.js`), the accessible area by Shrake–Rupley with DSSP's
     radii (1,000 points) in the chain alone and in the structure, relative to Tien et al.'s maxima,
     StructureMap's pPSE and disorder (Proteoscope's `exposure.js`, copied with its tests; an
     AlphaFold DB model read with its aligned error, the program's new request), pLDDT, and the
     nearest partner, its contacts typed by Proteoscope's `interactions.js` (copied with its tests;
     the two chemistry tests that waited for it restored). Each position's structural class:
     disordered, interface, buried or exposed.
     - **Beside the map:** the classes and secondary structure as features (shown; `in feature
       buried` in queries), the accessibility, pPSE, distance and pLDDT as values (to show).
     - **The scores by class** (Mann–Whitney against the rest, BH-adjusted) and **the cluster
       test**: the least tolerant positions' pairs within 8 Å (Cβ) against seeded draws of as many
       positions within strata of relative accessibility (about twelve positions each, 4 to 16),
       with the same burial ignored beside it; compact groups (complete linkage within 12 Å).
     - The Structure view's pane *Structure as evidence* (partners, the classes' table, the test),
       a class coloring and a strip row, the words of a residue and the inspector's; the evidence's
       file (FORMATS.md); remote control's `structure_evidence`, `color: "class"`, `export` of
       `structure-evidence`. PTEN's sixth step (1D5R); a screenshot scene
       (`structure-evidence`); the guide page *Structures*, its section on evidence.
     - Validation:
       - `structures` (21 checks, 7 new): DSSP 4.6.1's own output for each entry (the DSSP
         databank, read with gemmi: `reference/dssp.json`); partners against every pair of atoms;
         Mann–Whitney and BH against SciPy (`reference/mannwhitney.json`); disorder on two models
         with their aligned error; the tracks queried; the cluster test on simulated maps of 1D5R
         and 1TUP (burial alone: 3–6% at p ≤ 0.05; burial ignored: 100%; a planted patch: 62–71%);
         the PTEN guide's account.
       - `remote-session.mjs` (150 checks): the evidence in the page as Node reads it, its choices
         and refusals, the tracks, the file, the class coloring, a model's aligned error.
       - Unit tests: `structure-evidence.test.mjs` (9); Proteoscope's `exposure.test.mjs` (3) and
         `interactions.test.mjs` (21), two more of `chemistry.test.mjs`.
   - Found by slice 4:
     - **Proteoscope's validation has no reference for DSSP or accessibility.** Its tests check
       DSSP against entries' helix and sheet records (80% and 75%) and accessibility for
       plausibility. The reference is DSSP's own output: the DSSP databank's file of each entry,
       read with gemmi. Against it, Proteoscope's DSSP gives every residue of six entries DSSP's
       code.
     - **DSSP 4 calls π-helices where Proteoscope's DSSP calls α.** In 1D5R, W111–D115 are a π-helix
       to DSSP 4.6.1 (which gives π-helices priority) and α-helix or turn to Proteoscope's. DSSP 4
       also assigns polyproline helices (47 residues in the seven entries), which Proteoscope's does
       not. For Proteoscope to carry across; MaveScape's copy is unchanged.
     - **Accessibility depends on the radii.** With the viewer's van der Waals radii, residues
       differ from DSSP's by 2.7–3.7 Å² on average and up to 18.6 Å²; with DSSP's radii and 1,000
       points a sphere, by 0.64–0.89 Å², without bias.
     - **Burial explains most clustering.** Buried positions lie together, and the least tolerant
       are mostly buried: drawn from every position, simulated maps whose scores depend on burial
       alone look clustered every time. Matched on burial in 4 strata, 10–12% of them still did;
       about twelve positions a stratum brings it to 3–6%. In GRB2's SH3 domain the least
       tolerant make 26 pairs, 8.7 expected from any positions but 21.5 from positions as buried
       (p 0.11): they are its core. PTEN's cluster beyond burial (117 against 88.0, p 0.001).
     - **Clusters chain.** Connected within 8 Å, 49 of PTEN's 55 least tolerant positions were one
       cluster; the groups shown are compact (complete linkage, every two within 12 Å).
     - **A crystallization additive in PTEN's active site.** 1D5R holds a tartrate within 3 Å of
       C124, R130, K125, H93 and D92; as a partner it was the chain's only interface. Common
       additives (Proteoscope's list, with tartrate) are partners only when chosen.
     - **`Math.hypot` is not the same in every engine.** The determinism test found it in the new
       module; distances there use a square root, which is.
5. **Structures in the record (X5).** Structures stored in the library by SHA-256 and in the
   `.msz` archive (or referenced by ID with checksums); saved views (structure, chain, mapping,
   camera, style, coloring) reopen identically; high-resolution images with their legend as
   figure panels for wave 6; the mapping and structural tracks in the methods.
   - **Done.** `lib/structure-record.js` (pure) and `ui/structure-views.js`. A view saved in the
     Structure view's *Saved views* keeps the structure, assembly, chain, the mapping in brief
     (`mappingSummary`), the camera and the view's size, style, coloring (with the run,
     condition or contrast and palette it shows), surface, selection, labels, residue styles,
     focus and the evidence's choices (`ws.structureViews`); its structure (`ws.structures`) keeps
     the file as it came (RCSB's gzipped mmCIF, AlphaFold DB's model and its aligned error, a
     file of the person's) by SHA-256 in the library, with where and when it was retrieved, and
     stays while a view shows it.
     - **Reopened** from the list, the sidebar's *Structure views* or the inspector: everything
       restored, the camera last; the target mapped again and any difference from the mapping
       saved said (`mappingChanges`).
     - **The archive** carries each structure's file under `sources/` (`structures: "included"`),
       or names it by checksum (`"checksums"`): a PDB entry or AlphaFold DB model is then fetched
       again by its ID when its view opens, its SHA-256 compared with the one saved.
     - **Figure panels:** *Image*, *Figure panel*: 4× the view's size in CSS pixels (a saved view:
       the size it was saved at), the legend of its colors drawn below, and what it shows as JSON
       in the PNG (`iTXt`, `mavescape-figure-panel`) for wave 6's figure builder (FORMATS.md).
     - **The methods:** each structure (its source, retrieval date and file's SHA-256, read with
       MaveScape's copy of Proteoscope's readers), the target's alignment and chain, the saved
       views, and the structural measures and tests with their settings; ten new references.
     - Remote control's `save_structure_view`, `open_structure_view`, `remove_structure_view`,
       `export` of `structure-image` and of an archive without the structures
       (`include_structures`), `focus` on a structure view. GRB2's sixth step saves its view; a
       screenshot scene (`structure-views`); the guide page *Structures*, its section on saved
       views and figure panels.
     - Validation:
       - `structures` (23 checks, 2 new): a saved view of each example protein's PDB entry and
         AlphaFold DB model (14) through the archive, every file the same bytes and every view the
         same, the mapping made again from each file the one saved, named by checksum only and
         each fetched again by its ID; the methods of GRB2's run with a view of 2VWF.
       - `remote-session.mjs` (155 checks): a view of 2VWF saved, changed and opened again gives
         the same figure panel pixel for pixel, as does the view opened from the workspace's
         archive in a copy and from an archive naming the structure by checksum (fetched again);
         the panel's metadata; a view removed with its structure.
       - Unit tests: `structure-record.test.mjs` (6).
   - Found by slice 5:
     - **Reopening identically needs the view's size.** The same camera draws a different image in
       a canvas of another shape, and the canvas's shape follows the window and the panes beside
       it. A view keeps its size in CSS pixels, and its panel is drawn at that size, scaled from
       CSS pixels rather than by the screen's density: the panel of a view saved, changed and
       opened again, or opened from its archive in another workspace, is the same image pixel for
       pixel.
     - **0.4 reads 0.5's archives.** The structures' files go under `sources/`, which 0.4's reader
       accepts by name, and the workspace's new fields pass through it: 0.4.0's `readArchive`
       reads an archive with them, included or named by checksum, with no problems and its
       history whole.
     - **A structure fetched again may not be the one saved.** RCSB revises entries (slice 1), so
       a structure named by checksum is compared, after it is fetched again, with the SHA-256
       saved, and the view says when it differs; its mapping is checked as well.
     - **A legend is not Latin-1.** The legend's minus sign and Ångström do not fit a PNG `tEXt`
       chunk; the panel's metadata goes in `iTXt` (UTF-8).
     - **Every example structure maps again as saved** from its archived file: all 14 entries
       and models, the same chain, positions and differences.
6. **Optional: open in Proteoscope (X6).** For Proteoscope's deeper analyses (interfaces,
   ligands, validation reports, superposition, maps), when it is installed: `handoff.go` finds a
   running Proteoscope and sends what it already accepts (a link with the structure and a
   residue-data session for the versions tested against; selection and binned colors by remote
   command otherwise; files as the last resort). Nothing else in MaveScape depends on it.
   - Validation: Go tests against a fake Proteoscope (tested version, unknown version, no remote
     control, absent).
   - **Done.** `handoff.go` finds a running Proteoscope: its ports (8765–8814; `--proteoscope`
     names others, or `off`) asked for `/api/startup`, whose answer (version, offline, remote
     control, files) tells it from any other program; only a page on this computer is answered, and
     nothing leaves the computer (NETWORK.md). `lib/proteoscope.js` writes the view as Proteoscope
     0.10's own session (`proteoscope-session`, version 1; FORMATS.md): the structure by its ID (a
     file of the person's embedded), the scores as its custom residue data with the legend's title,
     `bwr` (or `viridis`) over the map's range centered on the wild type, categories as residue
     colors, the style, residues drawn, hidden, selected, labeled and focused on, the camera once
     still. `ui/proteoscope.js`: the Structure view's **Proteoscope** button, only while one runs.
     - **Delivered:** for Proteoscope 0.10, a `#session=` link (deflated, URL-safe base64) opened in
       a new tab; another version, `#fetch=<ID>` and the session as a file; a file of the person's,
       the session file. Not built, as proposed before the slice: remote commands with binned
       colors (they need `--remote-control`, which lets any program command Proteoscope, and carry
       no values or legend), a B-factor file (the session file carries the values), a separate
       handoff document (design.md says why).
     - Remote control's `proteoscope_link`, `export` of `proteoscope-session`. The guide page
       *Structures*, its section *Open in Proteoscope* with GRB2's three steps; a screenshot scene
       of Proteoscope's window (`structure-proteoscope`, the real Proteoscope started for it).
     - Validation:
       - Go tests (`handoff_test.go`): found by its startup answer (0.10.0 tested, 0.11.2 not,
         without remote control, the first in order); not found where nothing, another program,
         MaveScape itself or a port that never answers is; the flag; the endpoint.
       - `structures` (24 checks, 1 new): each example's session on its entry and model (16), each
         median on the residue Proteoscope's reader keys, the link read back with zlib.
       - `remote-session.mjs` (162 checks): a fake Proteoscope where `--proteoscope` says; absent,
         0.10.0 (the session, the residues, the camera handed over during a focus, the button's new
         tab), 0.11.0, a file of the person's, stopped.
       - `proteoscope-handoff.mjs` (4 checks, where Proteoscope is installed; not in CI):
         Proteoscope 0.10.0 itself opens the links of 2VWF and GRB2's model and the session file
         of a PDB-format file, every value on a residue its reader reads, the residues and camera
         as sent.
       - Unit tests: `proteoscope.test.mjs` (4).
   - Found by slice 6:
     - **Proteoscope's ports are not only Proteoscope's.** On the computer this was built on, two
       other programs answer JSON on 8767 and 8768, inside Proteoscope's range (one asks for a
       bearer token, one says "route not found"). Proteoscope is told by its startup answer's
       fields, not by a port or an answer.
     - **A Proteoscope may already be running.** Two were, for an AI agent's use (`proteoscope
       mcp`), on 8765 and 8766. The screenshots and the remote session look on ports of their own
       (`--proteoscope`), or every Structure view picture would show the button there and not
       elsewhere.
     - **The camera on its way.** Handed over just after a focus, the session had the camera in
       mid-flight (the remote session caught it); the handoff now waits for the view to come to
       rest.
     - **Saved views did not keep hidden residues.** Writing the session's `hiddenResidues` showed
       slice 5's views kept residues drawn their own way but not those hidden: a view with hidden
       residues did not reopen as it was. They are kept now (`hidden`).
     - **The residue keys agree by construction.** Every value MaveScape sent landed on a residue
       Proteoscope's own reader reads, including on the copy of 2VWF Proteoscope fetched for
       itself: MaveScape's reader is a copy of Proteoscope's.
     - **The links are short.** The largest of the examples' sessions is 4,818 characters (factor
       IX on its model, 452 values); the part after `#` never leaves the browser.
     - Wave 5 is complete with slice 6.

**Released 0.5.0 on 2026-10-12.** A view of a structure is kept with the workspace, so 0.5 leaves two
archives that keep views (`validation/archives/release-0.5.0-*.msz`, 1.2 MB together), saved by
0.5.0 itself, its window driven through remote control offline by `make-0.5.0.mjs`:
- GRB2's SH3 domain and its structures: Run 1 and three saved views, their structures' files in
  the archive (2VWF by the median score with residues drawn and labeled; 2VWF by structural class
  with residues hidden; GRB2's AlphaFold DB model with its aligned error);
- PTEN on 1D5R: its published scores and two views (the fraction abnormal-like of its record's
  ExCALIBR calibration; structural class), the structure named by its ID and SHA-256 only.

Every later version must reopen them and reproduce their two runs. It must also read each view's
structure again (from the archive, or fetched again by its ID, the file recorded) and map its
target onto the view's chain as it was saved. At the release, `mavescape run --from-workspace`
reran all twenty runs of every release's archives in a window, each to its recorded hash.
- Found by the release:
  - **The README said count tables could be Excel workbooks**, as did the guide's *Opening your
    data*; MaveScape reads CSV and TSV, gzipped or not, and FORMATS.md lists Excel as to come. Both
    now say so.
  - **The archives' replay assumed a selection**: every earlier release's archive had one, 0.5.0's
    have none, and the replay's exports failed on them. A workspace without a selection is replayed
    now.
  - **The site's home page and science page said nothing of structure**: the home page's release
    line still described 0.1.0, and neither validation table had a row for wave 5's checks. Both
    describe wave 5 now, with its validation and methods.
  - **A workspace whose structures were named by checksum could not be archived again**:
    `mavescape run --from-workspace` on 0.5.0's PTEN archive reproduced its run and then failed
    writing its archive, which asked for the structure's file the library did not hold; so would
    the window's export, until a view was opened. Not asked otherwise, an archive names such
    structures by ID and SHA-256 again, and says so; the export dialog says which files are missing.
  - **One Chrome that did not start ended the recapture**: the light screenshots were done when a
    headless Chrome did not open its debugging connection, and the script stopped there, leaving that
    scene's MaveScape running. A Chrome is now started again once, and a scene that still cannot
    start fails alone.

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
   every number traced. The certificate says what it proves: that the recorded inputs give the
   recorded outputs. That is reproducibility. Whether the scores are right still rests on the
   experiment's design and the model's assumptions, which the report states beside it.

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
2. **Workspace migrations (T7).** Schema version 2 if needed, with migrations, tested on the
   archive fixtures each release has kept since wave 2 (0.1–0.8).
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
- automated, signed releases and documented exceptions to unmet metrics.

Outside laboratories using MaveScape on their own data (the PRD's phase-2 exit, and its 1.0 goal of
two) are arranged by the maintainer, outside this plan. No wave or release waits for them; what they
report is taken in when it comes, and may reorder the waves.

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
| Licensing of reference code | GPL tools (dms_variants, dms_tools2) in an Apache-2.0 project; CytoWeave's `limma.js` follows GPL limma closely (an open decision there) | GPL tools used only as external references in validation; no code ported from GPL sources. Settled in wave 2, slice 6: CytoWeave's `limma.js` is not used; MaveScape's `limma.js` is written from the publications and checked against R's limma as a black box |
| Intervals that look right but do not hold | Scores that match the reference tools while their 95% intervals hold the truth less often (87–90% with three replicates in wave 2's simulations) | A coverage suite over depth, replicates, bottlenecks, shared inputs and model mismatch, with an independent simulator, as an acceptance gate (wave 2, slice 9: done; the defaults hold 93.6–96.5% in 26 kinds, REML 81.8–95.5%) |
| Scores read the wrong way round | A selection that enriches loss of function is drawn as "gain" and its controls judged failed | The readout's direction stated in the design and used by legends, QC and comparisons; "not stated" never guessed (wave 2, slice 8) |
| One developer | Adoption and continuity | Validation and documentation that let others check and continue |
