# MaveScape requirements

What MaveScape must do, derived from the product definition
(`product_research/MaveScape-prd.md`), and the wave that delivers each requirement.
- `research.md` explains the methods, data sources and standards behind them.
- `design.md` explains how they are met.
- `roadmap.md` orders them into waves; wave *N* is released as 0.*N*.0.

Status: **planned (wave N)** until built; then **done**, **partial** (the gap noted) or
**parked**, with the validation that shows it, as in CytoWeave's requirements.

## Users

- **Experimental MAVE researchers** with count tables from a sequencing core or pipeline, who need
  to know whether the assay worked, score variants, explore the map and publish.
- **Translational researchers** inspecting published or local maps against annotations and
  controls, who need assay effect kept separate from clinical classification.
- **Computational analysts** who need deterministic headless runs, documented schemas, stable
  exports and programmatic access.
- **Data curators** preparing MaveDB-ready score and count sets.
- **AI agents** acting for any of them, through a typed and reviewable interface.

## Distribution and platform

| # | Requirement | Status |
| --- | --- | --- |
| P1 | One self-contained program for macOS, Linux and Windows (x64 and ARM64); one-line install with checksum verification; no administrator rights, account, Python or R | done (wave 1, slice 1: six binaries from the release workflow, installers adapted from CytoWeave) |
| P2 | The web application also runs from a static web server, without the Go host (library in OPFS/IndexedDB; public data unavailable, said plainly) | done (wave 1, slice 1; public data arrive in wave 3) |
| P3 | User files never leave the computer; the only network requests are to the documented public services, for public identifiers; `--offline` blocks them all | planned (wave 1 for no requests; wave 3 for the fetcher) |
| P4 | Apache-2.0; no third-party runtime dependencies | done |
| P5 | Opens as a desktop window; a second launch hands its files or MaveDB URN to the open window | partial (wave 1, slice 1: files; the URN with MaveDB import, wave 3) |
| P6 | Version and build commit reported in the UI, `--version`, exports and methods | partial (UI and `/api/info`: wave 1, slice 1; exports and methods: slice 8) |

## Data and import

| # | Requirement | Status |
| --- | --- | --- |
| D1 | Read CSV and TSV (streaming, in a worker): delimiter, quoting, header, BOM and encoding detection; XLSX sheets | done for CSV/TSV (wave 1, slice 3: CRLF, LF and CR line ends, gzip, validation `import`); XLSX planned (wave 3) |
| D2 | Detect candidate variant identifier columns and numeric columns; preview counts, missingness and duplicates | done (wave 1, slice 3) |
| D3 | Parse and validate MAVE-HGVS (nucleotide, splice and protein; single and multi-variants; synonymous and WT special values) against the target sequence, with a message per invalid row | done (wave 1, slice 3: the whole grammar, equal to mavehgvs 0.8.1 on 16,959 strings, validation `hgvs`; a lenient mode for lab and legacy forms). Nucleotide-to-protein mapping of imported c. names: wave 3 |
| D4 | Never coerce silently: block scoring on ambiguous duplicate keys or non-numeric counts, listing rows | done (wave 1, slice 3: duplicates however written, non-numbers, negative counts and ragged rows block, by line; fixture `malformed-counts.csv`) |
| D5 | Keep original identifiers and columns verbatim beside the normalized fields | done (wave 1, slice 3) |
| D6 | Reusable import templates (column mapping, roles, identifier columns) | done (wave 1, slice 3: library records of kind import-template, applied when a table fits) |
| D7 | Content-addressed library: tables stored once by SHA-256; workspaces survive moved files | done (wave 1, slices 1 and 3) |
| D8 | Barcode tables with a barcode-to-variant map | planned (wave 2) |
| D9 | One million rows imported in under 15 s, under 1 GB of memory | planned (wave 2, benchmarked) |
| D10 | Variants beyond single substitutions: multi-substitutions, insertions, deletions, delins, stop, nucleotide-to-protein translation, splice; optional GA4GH VRS identifiers | planned (wave 3) |
| D12 | Built-in import templates for the layouts in common use, none of them required: MaveDB score and count CSVs, DiMSum count tables, generic per-variant tables (HGVS or `A12V`-style identifiers); later dms_variants and Enrich2 count files | done for MaveDB, DiMSum and generic tables (wave 1, slice 3); dms_variants and Enrich2 count files planned (wave 2) |
| D13 | Standard files for everything that is not counts: targets from FASTA (single or multi-record) or GenBank; designs from a sample sheet (CSV/XLSX); one count table or one file per sample; barcode maps as CSV/TSV; structures as PDB, mmCIF or BinaryCIF; alignments as FASTA or A3M; custom tracks as CSV or GFF3; predictor scores as CSV/TSV. Every format documented in `docs/FORMATS.md`, with blank layouts on the Start page | partial (wave 1: FASTA, per-sample files, sample sheets in CSV/TSV, DiMSum's design file, slices 3–4; `docs/FORMATS.md` and the blank layouts, slice 8; XLSX and GenBank wave 3; structures wave 4) |
| D11 | Hardened readers: fuzzed CSV, HGVS and archive parsing with no crash or hang and a clear message for every refusal | planned (wave 9) |

## Experiment design

| # | Requirement | Status |
| --- | --- | --- |
| E1 | A versioned, documented design schema (`mavescape-design` v1, JSON Schema) able to represent two-population, time-series, bin, barcode and score-only experiments without dataset-specific code | done (wave 1, slice 2: three MaveDB data sets of different designs, four designs, no data-set code; validation `designs`). Barcode libraries are planned (wave 2) |
| E2 | Design editor: sample name and column, condition, role, biological and technical replicate, time and unit, bin order and value, batch, control classes | done (wave 1, slice 4: every model, conditions and tiles; validation `experiment`). Barcode libraries planned (wave 2); named control classes planned (wave 6) |
| E3 | Targets: reference sequence (DNA or protein), coordinate offset, gene, UniProt, RefSeq, Ensembl and organism identifiers | done (wave 1, slices 3–4: from FASTA files or pasted; name, offset, coding start and identifiers edited in the Experiment view). Offsets found from UniProt: wave 3 |
| E4 | Role suggestions shown as suggestions, never applied silently | done (wave 1, slice 3: suggested from column names, drafts equal the hand-written designs' shape on all four feasibility designs) |
| E5 | A human-readable design summary and validation before scoring | done (wave 1, slice 4) |
| E6 | Every material change undoable and recorded in a hash-chained history | done (wave 1, slice 4: verified in the drawer; validation `experiment`) |

## Quality control

| # | Requirement | Status |
| --- | --- | --- |
| Q1 | Depth: total counts per sample, observed variant fraction, count distributions, low- and zero-count fractions, rank-abundance | done (wave 1, slice 6) |
| Q2 | Coverage by position and substitution class | done (wave 1, slice 6: protein-level single substitutions; nucleotide coverage with wave 3's mapping) |
| Q3 | Replicate agreement (pairwise, filtered by input count) and replicate outlier detection (leave-one-out z) | done (wave 1, slice 6) |
| Q4 | Bottleneck diagnostics (input-to-output; synonymous log-ratio variance against the Poisson expectation; DiMSum's multiplicative error terms) | done for wave 1 (slice 6: replicate differences and synonymous variants against counting, a multiplier fitted when the counts allow; checked on simulated bottlenecks); DiMSum's terms: wave 2 |
| Q5 | Control distributions (WT, synonymous, nonsense, user classes) and their separation | done (wave 1, slice 6: AUC, standardized median difference, nonsense above the synonymous 5th percentile) |
| Q6 | Score stability against starting count; effect against uncertainty; missingness patterns | done (wave 1, slice 6, with dropouts written as missing) |
| Q7 | Filter flow: retained and excluded variants at each stage, by reason | done (wave 1: Score view, slice 5; QC, slice 6) |
| Q8 | Barcode agreement within variants and outlier barcodes | planned (wave 2) |
| Q9 | Findings with status (pass/review/fail), explanation, affected samples or variants, threshold and rationale, link to the visual, advisory or blocking; thresholds configurable and recorded | done (wave 1, slice 6: thresholds in the workspace and its history; validation `qc`) |
| Q10 | Time-series fit diagnostics (usable points, residuals) and bin diagnostics (cells per bin, bin occupancy) | planned (wave 2) |

## Scoring

| # | Requirement | Status |
| --- | --- | --- |
| S1 | Two-population log ratio with WT, complete-case, all-read or synonymous normalization and a configurable pseudocount; SE per variant | done (wave 1, slice 5: equal to Enrich2 2.0.2 and dms_variants 1.6.0 to 5 × 10⁻¹³, validation `scoring`; time series scored by their first and last samples until wave 2) |
| S2 | Technical replicates pooled; biological replicates scored separately and combined by fixed effects or REML random effects, with an Enrich2-compatible estimator; heterogeneity and leave-one-replicate-out sensitivity | done (wave 1, slice 5: REML equal to metafor 5.2-1 to 3.4 × 10⁻¹², Enrich2's estimator to Enrich2; Q, I², τ², leave-one-out per variant) |
| S3 | Ordered, visible filters with reason codes and stage; filtered variants keep their measurements; explicit NA for unscored variants | done (wave 1, slice 5: eight stages, count filters per replicate, the filter flow; barcode disagreement comes with barcodes, wave 2) |
| S4 | Immutable score runs: input and output hashes, import mapping, design, software and algorithm versions, parameters, filters, seeds, warnings | done (wave 1, slice 5: ids from the canonical inputs; scores recomputed when a run is reopened and checked against its output hash) |
| S5 | The PRD's two-population edge cases (zero in both, in input only, in output only; missing replicate; very low depth; absent from one replicate; observed but filtered; reference class unavailable) specified and tested | done (wave 1, slice 5: planted in `fixtures/two-population.csv`, each checked, Enrich2 and dms_variants scoring the same table) |
| S6 | Time series: weighted (and ordinary) regression of normalized log frequency on time, non-uniform spacing, slope, SE, usable points; insufficient support flagged | planned (wave 2; equal to Enrich2) |
| S7 | Bin scores: weighted average from ordered bins with explicit values and weight type; uncertainty analytically or by seeded bootstrap; optional maximum-likelihood estimate | planned (wave 2) |
| S8 | Barcode aggregation: sum-then-score and score-then-combine | planned (wave 2; equal to dms_variants) |
| S9 | DiMSum's error model as an alternative uncertainty model | planned (wave 2) |
| S10 | Differential scores between compatible conditions, with a model that accounts for a shared input | planned (wave 2; against Enrich2's z and mutscan's limma contrasts) |
| S11 | Score rescaling conventions (WT = 0; nonsense = 0 and WT = 1; synonymous and nonsense medians) recorded in the run | done (wave 1, slice 5: none, nonsense 0 and WT 1, synonymous 0 and nonsense −1; anchors recorded; factor IX's lowest-5%-of-missense convention to add with its data, wave 2) |
| S12 | 100,000 variants × 6 samples scored in under 10 s | planned (wave 2, benchmarked) |

## Views

| # | Requirement | Status |
| --- | --- | --- |
| V1 | Shell: Start, Experiment, QC, Score, Map, Compare, Structure, Calibrate, Figures, Report; left dataset tree, right inspector, bottom drawer, top command bar | planned (wave 1, views added by later waves) |
| V2 | Variant-effect map: pan and zoom, color by score, differential, uncertainty, missingness, depth or QC status; distinct missing, filtered, low-confidence and not-designed states; WT marks; row orders; row and column summaries | done (wave 1, slice 7: score, SE, replicates, input count; differential with wave 2) |
| V3 | Selection by click, rectangle, freeform and query; named selection sets that propagate across views | partial (wave 1, slice 7: click, rectangle and keyboard; named selections in the workspace; wave 5: freeform and query) |
| V4 | Variant inspector: identifiers, score and CI, counts by sample, replicate scores, filters and warnings, sequence context, position distribution, provenance; later barcodes, conditions, annotations, structure | done for wave 1 (slice 7); extended by waves 2–4 |
| V5 | Sequence tracks synchronized with the map: reference, coverage, position effect and uncertainty, domains and motifs, secondary structure, conservation, ClinVar, population frequency, custom tracks, structure availability; show, hide, reorder, filter, export | planned (wave 3) |
| V6 | Undo, history and a visible filter bar; analysis-changing actions distinct from view-only actions | done (wave 1: undo and the history, slice 4; the filter bar in the Score view, slice 5) |
| V7 | Long operations in workers with progress and cancel | done (wave 1: reading tables, slice 3; scoring, slice 5) |

## Comparison

| # | Requirement | Status |
| --- | --- | --- |
| C1 | Compare replicates, conditions, assays, score runs, local against MaveDB, and experiment against an imported predictor | planned (wave 5) |
| C2 | Synchronized maps, difference maps, scatter plots with agreement statistics, discordant-variant tables, position-level disagreement, confidence and depth filters | planned (wave 5) |
| C3 | Compatibility report (target, coordinates, matched and unmatched variants); invalid comparisons blocked or qualified | planned (wave 5) |
| C4 | Robustness to analysis choices: scores and classes recomputed across pseudocounts, normalizations, filters and combination methods | planned (wave 5) |

## Structure

| # | Requirement | Status |
| --- | --- | --- |
| X1 | A Structure view in MaveScape, needing no other program: open PDB, mmCIF and BinaryCIF files, fetch PDB entries and AlphaFold models, assemblies; cartoon, surface and stick styles; WebGPU with a Canvas fallback (copied from Proteoscope) | planned (wave 4) |
| X2 | Target positions mapped to residues (SIFTS, alignment, UniProt offsets), with unmapped, ambiguous and mismatched positions reported; experimental and AlphaFold models interchangeable | planned (wave 4) |
| X3 | Residues colored by position summary, substitution, uncertainty, disagreement or QC state, with a legend and the map's visual grammar; selections shared both ways with the map and inspector | planned (wave 4) |
| X4 | Structure as evidence: secondary structure, solvent accessibility, exposure and disorder, pLDDT, interface and ligand distance as tracks; effects by structural class; spatial clusters of sensitive positions | planned (wave 4) |
| X5 | Structures, mappings and saved views in the library and archive; structure images as figure panels | planned (wave 4) |
| X6 | Optional handoff to Proteoscope for deeper structural analysis, when installed, using only what it already accepts; nothing else depends on it | planned (wave 4) |

## Calibration (research use)

| # | Requirement | Status |
| --- | --- | --- |
| K1 | Known-effect control sets with provenance; circularity warnings | planned (wave 8) |
| K2 | Score distributions by control class; ROC and precision–recall curves; thresholds and an indeterminate zone; sensitivity and specificity with intervals; bootstrap threshold stability | planned (wave 8) |
| K3 | OddsPath and likelihood-ratio evidence strength, labeled research use only; assay validity, functional class and clinical classification kept as separate concepts | planned (wave 8) |
| K4 | Calibration never runs automatically and reports control composition and limitations | planned (wave 8) |

## Output, provenance and reporting

| # | Requirement | Status |
| --- | --- | --- |
| R1 | Exports: variant scores CSV, variant counts CSV, per-variant and per-sample QC tables, design JSON, provenance JSON, selected variants CSV/JSON | done (wave 1, slice 8: MaveDB columns; re-import without loss, validation `roundtrip`) |
| R2 | Workspace archive (`.msz`): manifest, targets, sources or checksums, design, runs, annotation cache, selections, figures, history, methods and citations; save and reopen with identical results | done for wave 1 (slice 8: identical bytes on reopening; tampering reported); annotations with wave 3, figures with wave 6 |
| R3 | Map and plot export as SVG and PNG | done for the map (wave 1, slice 7; golden-file test); other plots with figures, wave 6 |
| R4 | Methods text from the operations actually performed, with numbered references and BibTeX, parameter tables, input checksums, software version and commit, research-use statement; regenerated when a setting changes | partial (wave 1, slice 8: scoring and QC, with references and BibTeX; parameter tables and the rest with wave 6) |
| R5 | Figure builder: multi-panel figures from live views; SVG, high-resolution PNG, vector PDF, clipboard; embedded analysis metadata and a figure manifest; reopened figures rebuilt with differences reported | planned (wave 6) |
| R6 | Analysis decision log, checkpoints and semantic diff of analyses | planned (wave 6) |
| R7 | Reproducibility certificate re-computing every reported number (`mavescape verify`) and a self-contained review report | planned (wave 6) |

## Interchange

| # | Requirement | Status |
| --- | --- | --- |
| I1 | MaveDB: search, fetch score sets by URN with scores, counts, metadata, license and citation; cached with retrieval metadata | planned (wave 3) |
| I2 | MaveDB-ready export (scores and counts CSV, metadata) that passes MaveDB's own validators | planned (wave 3) |
| I3 | Annotation providers behind one interface (UniProt features, ClinVar, gnomAD, conservation, AlphaMissense and other predictors, custom tables), each record with source, version, identifiers and retrieval date | planned (wave 3) |
| I4 | Imported predictor scores as variant-level tracks | planned (wave 3) |

## Automation

| # | Requirement | Status |
| --- | --- | --- |
| M1 | `mavescape run`: a versioned design, validation before execution, deterministic outputs (scores, QC, figures, methods, provenance), structured JSON logs, non-zero exit on blocking errors, exact reruns from a workspace run | planned (wave 2) |
| M2 | `mavescape validate` (a score or count table, a design) and `mavescape export` (an archive to MaveDB or tables) | planned (wave 2 validate; wave 3 export) |
| M3 | Remote-control API with per-session tokens | planned (wave 2) |
| M4 | MCP server with the PRD's tools; changes to design, filters, scoring, calibration or exports arrive as reviewable proposals; read-only queries run directly | planned (wave 7) |
| M5 | Python and R clients generated from the tool list | planned (wave 7) |
| M6 | A public agent benchmark of graded tasks on the examples | planned (wave 9) |

## Quality, security and accessibility

| # | Requirement | Status |
| --- | --- | --- |
| T1 | Unit, property, cross-implementation, golden UI, round-trip, MaveDB conformance, security and performance tests in CI | planned (from wave 1, by layer) |
| T2 | Reference comparisons document tool and version, input transformation, compared values, tolerances, known differences and failure threshold | done for Enrich2 (wave 1, slice 2: `validation/README.md`, `reference/enrich2.json`); each later reference the same way |
| T3 | Fixtures: clean two-population, poor replicate agreement, severe bottleneck, low-count tail, barcode conflicts, missing samples, malformed variants, time series, bins, two conditions, a published MaveDB record | planned (waves 1–3) |
| T4 | Bundled examples (five to seven), each with a question, source and license, expected findings, opening view, known QC outcomes, reference scores, citation and a guided workflow under ten minutes; simulated data labeled as such | partial (wave 1, slice 8: two, GRB2 SH3 and a simulated experiment; wave 2: five; wave 3: seven) |
| T5 | Security: loopback binding, Host check, tokens, file-access restriction, response and decompression limits, archive path traversal, CSP, no remote code, escaped labels; `--offline` and `--no-remote-control`; tested | planned (wave 1; reviewed in wave 9) |
| T6 | WCAG AA contrast in both themes, color-vision-safe palettes, patterns besides colors, full keyboard operation, screen-reader descriptions and tabular alternatives for every chart, adjustable scale | partial (wave 1: contrast and palettes, slice 1; the map's states as marks, keyboard, description and table, slice 7; wave 9 audit) |
| T7 | Workspace migrations, opening at least two previous schema versions | planned (wave 9) |
| T8 | Crash-safe writes; network failure cannot corrupt local work | planned (wave 1) |
