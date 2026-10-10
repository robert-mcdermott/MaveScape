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
11. **Examples (T4).** Three more: Hsp90 (`00000011-a-1`, 8 generations, 568 variants) as the
   growth time series; Factor IX MultiSTEP (one readout) as the FACS-bin assay; and a simulated
   problematic experiment (a bottleneck and a failing replicate), labeled simulated. (The simulated
   barcode map with conflicts came with slice 4. No barcode-level counts are on MaveDB; Enrich2's
   example data are CC BY-SA, whose ShareAlike term should not enter an Apache-2.0 binary.) Each
   with its question, source and license, its readout and direction (slice 8), its readiness
   (slice 10), expected findings, opening view and a guided workflow under ten minutes.

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
   calibrations; counts mapped into a design with the same wizard; the readout (wave 2, slice 8)
   taken from the record's experiment keywords; retries with backoff; cached for offline use.
   Records under CC BY-NC-SA or "other" licenses are shown with their terms.

   **Readiness** (wave 2, slice 10) applied to a MaveDB record. A record with scores alone supports
   the map, exploration and comparison; counts allow rescoring and count-based QC. What the record
   lacks (counts, replicates, a design, the readout) is named with where it is usually found: the
   paper's methods, its supplement, the authors' repository. Rebuilding a published experiment's
   design from scattered records is often the hardest part of a reanalysis.
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
   any run, with the analysis description written from the methods and the experiment's keywords
   from the design's readout (the MAVE minimum information); `mavescape export --format mavedb`.
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
   eleven.

## 0.4.0: compare (wave 4)

Comparison comes before structure ("How the waves map to the PRD's phases"). A laboratory's first
questions about its own experiment are about comparison: does an effect survive another reasonable
analysis, does one replicate drive it, and do two assays really disagree or only use different
scales?

### Wave 4

1. **Comparisons (C1–C3).** A comparison engine that matches variants across replicates,
   conditions, assays, runs, local and MaveDB data, and predictors.
   - **A compatibility report** comes first: target, coordinates, matched and unmatched variants,
     and the readouts (wave 2, slice 8: direction, units, reference state and rescaling). Two
     assays on different scales are then not read as disagreeing.
   - **Views:** synchronized and difference maps, scatter plots with Pearson, Spearman, Lin's
     concordance and Bland–Altman, discordant-variant tables, position-level disagreement, and
     confidence and depth filters.
   - Invalid comparisons are blocked or qualified.
2. **Robustness to analysis choices (C4).** A run is repeated across variations, following
   CytoWeave's `multiverse.js` pattern:
   - pseudocounts, normalizations, filters, combination methods and uncertainty models;
   - each replicate left out in turn;
   - low-depth measurements removed.

   For each variant and position, it shows what changes: the effect size, its rank, its
   uncertainty, whether it is scored at all, and its class. It shows more than which threshold a
   variant crosses. It says which conclusions hold under every reasonable choice and which depend
   on one. No DMS tool shows this.
   - Validation: simulated experiments with a planted fragile result: one replicate driving an
     effect, and an effect that appears at only one pseudocount. The variants reported as fragile
     are exactly the planted ones, and a robust result is reported as robust.
3. **Selections (V3).** Freeform and query selections ("missense at 40–80 with SE < 0.2",
   "variants whose class depends on the pseudocount"; structural classes such as "buried
   positions" with wave 5), named sets, set operations, export.

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
2. **Target-to-structure mapping (X2).** Structures that cover the target ranked by PDBe SIFTS
   (`best_structures`) and the AlphaFold model; the target aligned to each chain's observed
   residues (`align.js`, BLOSUM62) with the UniProt offset; a mapping report (coverage,
   unmapped, ambiguous and mismatched positions, engineered mutations, gaps); switching between
   experimental structures and the AlphaFold model keeps the mapping.
   - Validation: mappings equal SIFTS for every example protein (GRB2 SH3 2VWF, BRCA1 1JM7,
     Hsp90 2CG9, DHFR 1RX2, Factor IX 1RFN) and their AlphaFold models.
3. **Scores on the structure (X3).** Residues colored by a position summary (median, mean,
   minimum, fraction abnormal-like, number of scored substitutions), one substitution, the
   uncertainty, a comparison's disagreement (wave 4's difference coloring) or the QC state, with the map's visual grammar:
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
