# MaveScape design

This document explains how MaveScape is built and why. For code conventions and the data model,
see `conventions.md`. For the methods, data sources and standards behind these choices, see
`research.md`. For the order of the work, see `roadmap.md`. The product definition is
`product_research/MaveScape-prd.md` (written under the working name VariantWeave).

## Goals

1. **Defensible numbers.** Every score agrees with the method it reimplements (Enrich2, DiMSum,
   VAMP-seq, dms_variants, mutscan), and that agreement is checked automatically
   (`validation/`).
2. **Evidence before interpretation.** Every score links back to its counts, design, model,
   parameters, filters and uncertainty. Missing, filtered and low-confidence measurements are
   never drawn in the neutral color.
3. **A workflow, not scripts.** From counts or a MaveDB record to a QC'd, scored, explored and
   exported map in under ten minutes, without a scripting environment.
4. **Local and private.** User files stay on the computer. Network requests go only to a fixed
   list of public services, only for public identifiers, and can be switched off.
5. **Open.** Apache-2.0, no third-party runtime dependencies, standard formats in and out
   (MaveDB CSV, MAVE-HGVS, JSON Schema-described design and provenance).
6. **Stand-alone.** Every part of an analysis, structure viewing included, works with MaveScape
   alone. Proteoscope and CytoWeave are sources of copied code, never runtime dependencies.
7. **Research use, not diagnosis.** Functional evidence is reported and, optionally, calibrated;
   clinical classification is out of scope by design.

## Architecture

```
┌──────────────────────────── mavescape (one Go binary, stdlib only) ────────────────────────────┐
│ main.go       flags, startup, single-instance forwarding, /api/info, /api/open                │
│ security.go   loopback-only, Host-header check, same-origin API, CSP, COOP/COEP/CORP          │
│ local.go      files named on the command line, served read-only by index                      │
│ store.go      library: workspaces/*.json, files/<sha256>, trash/  (+ records.go)              │
│ window.go     app window (Chrome/Edge/Brave --app, own profile) or default browser            │
│ fetch.go      allowlisted public services, through cache.go: MaveDB, UniProt, RCSB, PDBe,     │
│ cache.go      AlphaFold DB, NCBI (ClinVar), Ensembl, gnomAD; --offline; size limits           │
│ handoff.go    optional: finds a running Proteoscope and sends it a structure and residue data │
│ remote.go     remote-control hub (SSE to the page, actions from local programs)               │
│ actions.go    the remote actions and their arguments (performed by web/ui/remote.js)          │
│ connection.go remote.json (address and token) for scripts; output.go: exports to a path       │
│ mcp.go        `mavescape mcp`: Model Context Protocol server on stdio, driving the hub         │
│ run.go        `mavescape run|validate|export`: headless runs in a hidden browser window       │
│ embed web/   ───────────────────────────────────────────────────────────────────────────┐     │
└──────────────────────────────────────────────────────────────────────────────────────────│─────┘
                                                                                           ▼
┌──────────────────────────────────────── browser ──────────────────────────────────────────────┐
│ web/app.js        shell, views, import dispatch, commands, shortcuts                          │
│ web/ui/*.js       views and components (the only code that touches the DOM)                   │
│ web/workers/*.js  module workers: CSV parsing, scoring, QC, bootstraps, simulation            │
│ web/lib/*.js      pure modules (no DOM), shared by page, workers, Node tests and validation   │
└───────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Why the analysis runs in the browser

The same reasons as CytoWeave: one implementation for the desktop program, a static web server,
Node tests and the validation suite; no upload step; no Python or R to install. DMS data are small
next to cytometry (a protein of 500 residues has about 10,000 single substitutions; barcode tables
reach a few million rows), so typed arrays and workers are more than enough. The million-row
barcode case is benchmarked from wave 2.

### The same numbers in every browser

A run is recomputed when its workspace is reopened and must reproduce its recorded output hash,
so its numbers must not depend on the JavaScript engine. IEEE 754 arithmetic (+, −, ×, ÷, `sqrt`)
is exact in every engine, but `Math.log`, `exp` and `pow` are not: Chrome 154 and Node 22 differ in
the last bit of about 2% of logarithms (found by wave 2, slice 1, when the remote-control session
compared the window's scores with Node's). Scoring, QC, statistics and simulation therefore use
`web/lib/dmath.js`, fdlibm's logarithm and exponential written in plain arithmetic: within one unit
in the last place of the engines', and the same bits everywhere. A test forbids the engine's
functions in those modules; `validation/remote-session.mjs` checks a fingerprint of `dmath.js` in
the browser against Node's.

### What is copied from the sibling apps

| From | What | How much changes |
| --- | --- | --- |
| CytoWeave | `security.go`, `window.go`, `connection.go`, `records.go` | renames only |
| CytoWeave | `main.go`, `local.go`, `store.go` | renames; file kinds (CSV/TSV/XLSX/JSON/`.msz`) |
| CytoWeave | `remote.go`, `output.go`, `mcp.go` framework, `run.go`/`verify.go` pattern | transport verbatim; actions and tools new |
| CytoWeave | `web/ui/dom.js`, `overlays.js`, `store.js`, `storage.js`, `workers.js`, `palette.js`, `icons.js` | renames |
| CytoWeave | `web/lib/random.js`, `sha256.js`, `zip.js`, `png.js`, `pdf.js`, `xlsx.js`, `colormaps.js`, `colorvision.js`, `stats.js`, `hypothesis.js`, `limma.js`, `linalg.js`, `multiverse.js`, `proposals.js`, `methods.js` (framework), `figure-svg.js`, `certificate.js` pattern | copied with tests |
| CytoWeave | CI, release workflow, installers, `validation/fetch.mjs` + `sources.json`, `docs/capture`, `clients/generate.mjs`, `benchmark/` harness | renames |
| Proteoscope | `cache.go`, the download/limit/serve parts of `fetch.go` | one explicit host list; retrieval date and ETag added to the metadata |
| Proteoscope | The structure viewer: `parse.js`, `bcif.js`, `structure.js`, `residues.js`, `elements.js`, `chemistry.js`, `dssp.js`, `math3d.js`, `camera.js`, `cartoon.js`, `scene.js`, `renderer.js` (WebGPU), `renderer-canvas.js` (fallback), `surface.js`, `exposure.js`, `interactions.js` (contacts), `select.js`, `coloring.js`, `colors.js`, `align.js`; `conservation.js` and `msa.js` for conservation tracks | copied with tests; trimmed of what MaveScape does not use (ligand chemistry depiction, density maps, prediction triage) |

A shared suite package was considered and rejected for now: the apps have no build step and no
dependencies, so a shared package would need a vendoring step in each. Copies with origin comments
are simpler while one person maintains all three. Revisit at 1.0.

### The Go host

- **Network exposure.** As CytoWeave: 127.0.0.1 only, Host header must be loopback, API calls
  same-origin, strict CSP (`connect-src 'self'`: the page reaches public services only through
  the host), COOP/COEP/CORP so the page is cross-origin isolated.
- **Single instance.** A second launch forwards its files or `--mavedb` URN to the running window.
- **Library.** Count tables and archives are stored once under their SHA-256; workspaces refer to
  them by hash. With no host (static hosting), `storage.js` uses OPFS, then IndexedDB.
- **Public data.** `fetch.go` serves `/api/fetch/<service>/<id>` from one allowlist. Every response
  is cached with its upstream URL, retrieval time, ETag and service version where given, and is
  marked `X-MaveScape-Cache: hit|miss|stale`. `--offline` serves only cached copies; `--no-fetch`
  switches the feature off entirely. Requests carry public identifiers only (URNs, accessions,
  gene symbols, HGVS of public variants). A sequence search (BLAST-like lookup of a target with no
  accession) shows exactly what will be sent and needs confirmation. `docs/NETWORK.md` lists every
  request MaveScape can make.

## The analysis pipeline

```
CSV/TSV/XLSX ─parse (worker, streaming)→ table (columns as strings + typed numeric columns)
             ─import template (column → sample, variant id columns)→ CountSet + variant table
             ─MAVE-HGVS parse + validate against the target→ canonical keys, kinds, positions
             ─design (roles, conditions, replicates, times, bins, barcodes, controls)
             ─QC (findings: pass / review / fail)
             ─score run (model, normalization, pseudocount, filters, combination) → results
             ─map, tracks, inspector, comparisons, structure view, calibration, figures, report
```

### Import

- The parser streams the file in a worker (16 MB parts), detects the delimiter, quoting, header,
  BOM, encoding and line ends (MaveDB writes CRLF), and keeps every column as text plus a typed numeric view where every value
  parses. Values that do not parse are listed by row; they are never coerced silently.
- Candidate identifier columns are found by trying the MAVE-HGVS parser on a sample of rows
  (`hgvs_nt`, `hgvs_pro`, `hgvs_splice` and MaveDB's `accession` are recognized by name too).
- Sample roles are *suggested* from column names (`input`, `pre`, `sel`, `rep1`, `t0`, `bin3`…)
  and shown as suggestions until the user accepts them.
- Ambiguous duplicate identifiers and non-numeric counts block scoring, with the rows listed.
- The mapping is saved as a reusable import template (JSON), which the score run records.

### Scoring models

| Model | Formula (details in `research.md` §2) | Reference in CI |
| --- | --- | --- |
| Ratio (two populations) | ln((c_out+p)/r_out) − ln((c_in+p)/r_in); SE from the four reciprocal counts; r from WT, complete-case or all-read library sizes, or synonymous median | Enrich2 2.0.2; dms_variants `func_scores` |
| Weighted regression (time series) | WLS of ln((c_t+p)/r_t) on t/max t, weights 1/(1/(c_t+p) + 1/r_t); SE scaled by residuals | Enrich2 2.0.2; statsmodels WLS |
| Weighted bins (sort-seq, VAMP-seq) | bin-frequency-weighted average of bin values, rescaled to nonsense = 0, WT = 1 | VAMP-seq procedure (Matreyek 2018); CountESS |
| Bins, maximum likelihood | censored log-normal fit per variant (Peterman & Levine 2016) | R `fitdistrplus::fitdistcens` |
| DiMSum error model | per-replicate scale/shift and multiplicative + additive error terms | DiMSum 1.4 functions with fixed parameters |
| Imported scores | validation and mapping only | MaveDB |

Replicates: technical replicates are summed before scoring. Biological replicates are scored
separately and combined by inverse-variance fixed effects or by REML random effects (Fisher
scoring as metafor's `rma`: the Hedges start, step halving at τ² = 0, the check against τ² = 0, to
convergence); an "Enrich2-compatible" option reproduces Enrich2's estimator exactly, including its
starting value and fixed 50 iterations, so that numbers can be compared with published Enrich2
results. Each combination reports heterogeneity (τ², Cochran's Q and I² = (Q − df)/Q) and
leave-one-replicate-out sensitivity. Conditions are scored apart; a variant's expected replicates
are those whose tile covers it. (`web/lib/score.js`, wave 1, slice 5.)

Filters are ordered stages: counted in a replicate and a valid identifier (always), variant class,
user exclusions, minimum input count and minimum total count (per replicate: a replicate below
them does not count for that variant), minimum usable replicates, maximum SE; barcode
disagreement joins with barcodes (wave 2). A filtered variant keeps its measurements, reason code
and stage, and the filter flow is drawn. A run that cannot be done as asked (the reference class
absent, a rescaling anchor missing, an unsupported design) is refused with the reason, never done
another way.

Runs keep their inputs (the table's SHA-256, the mapping, the design, the parameters, the scoring
version), which give the run its id, and the SHA-256 of their output, not the scores: scoring a
large table takes well under a second in the worker, so a reopened run is recomputed and checked
against its output hash. A run that no longer reproduces says so.

### QC findings

`web/lib/qc.js` computes metrics; `web/lib/findings.js` turns them into findings, each `{ id,
status: 'pass'|'review'|'fail'|'na', blocking, title, value, explanation, threshold, rationale,
affected: { samples, replicates }, plot, level: 'counts'|'scores' }`. Thresholds are parameters
kept in the workspace (`ws.qc.thresholds`), each change in its history. The overall indicator is
the worst finding, shown next to the list, never instead of it. (Wave 1, slice 6.)

Most findings need only the counts and the design, so QC runs before (or without) scoring:
replicate agreement and variance are computed on raw log ratios, which per-replicate
normalization only shifts. The bottleneck check compares the variance of replicate differences
with the counting (Poisson) variance, robustly (median of squared standardized differences ÷
0.4549), and fits observed = a·counting + e over bins of counting variance when the counts span
enough of a range: a > 1 is a multiplier (a bottleneck), e a constant (replicate noise), as
DiMSum's error terms. Scored-variant findings (control separation, resolution, variants scored)
come from a run, recomputed with its recorded inputs in the score worker.

### The variant-effect map

- Canvas 2D, drawn from a precomputed cell raster (positions × rows), with an overview strip and
  a zoomed viewport. A 20 × 5,000 matrix is 100,000 cells; drawing it is not the bottleneck, so no
  WebGL renderer is planned (CytoWeave reached the same conclusion for ten million events).
- Two independent visual channels: score color (diverging, color-vision-safe, centered on the WT
  normalization) and state (missing = empty cell with a dot, filtered = diagonal hatch,
  low-confidence = reduced saturation plus a corner mark, not designed = no cell, WT = outlined
  cell). Uncertainty can be shown as cell size, or as its own map.
- Rows: the 20 amino acids plus stop (and synonymous), in biochemical, alphabetical or user order.
  Positions: target coordinates, with the reference offset as a second axis.
- Selections (click, rectangle, freeform, by query) are named `SelectionSet`s that propagate to
  tracks, tables, plots, structure and exports.
- Every map has a tabular alternative and a generated text description for screen readers.
- Built in wave 1, slice 7: the model (`lib/map-model.js`), the renderer on any 2D context
  (`lib/map-render.js`, which the benchmark runs in Node) and the SVG export (`lib/map-svg.js`) are
  pure; the canvas component (`ui/variant-map.js`) adds pointer and keyboard. The score scale is
  symmetric about the wild type, so equal color distances are equal score distances on both
  sides. States have colors of their own (`--map-*`), kept ΔE ≥ 10 from the neutral score color,
  because at small zoom a cell is too small for its mark. Selections are kept by MAVE-HGVS key, so
  they hold for any row order and for variants not in the table.

### Workspace state, undo and provenance

As CytoWeave: the workspace is one immutable JSON value; each edit goes through
`store.commit(next, label)`; undo and redo walk those values; the history is hash-chained; view-only
changes (zoom, palette) are not analysis changes and are not logged as such. Checkpoints snapshot
the analysis and a semantic diff explains what changed between two (which parameters, which
variants moved).

## The Structure view

Seeing a variant-effect map on the protein is part of a MaveScape analysis, so MaveScape has its
own structure viewer, copied from Proteoscope's (both Apache-2.0, same author) and kept close to it
so fixes can be carried across:

- **Files and sources.** Local PDB, mmCIF and BinaryCIF files; PDB entries and AlphaFold models
  through the fetcher (cached, so a structure opened once is available offline).
- **Rendering.** Proteoscope's WebGPU renderer (impostor spheres and cylinders, cartoon, surfaces,
  ambient occlusion, outlines, picking, image capture), and its Canvas renderer where WebGPU is
  missing.
- **Mapping.** PDBe SIFTS ranks the structures that cover the target; the target is aligned to
  each chain's observed residues (BLOSUM62), using the UniProt offset; the mapping report lists
  unmapped, ambiguous and mismatched positions. A mapping is stored with the structure's SHA-256
  and reused when the structure is reopened.
- **Coloring.** Residues take a position summary (median, mean, minimum, fraction abnormal-like),
  a single substitution, uncertainty, disagreement or QC state, through the same palettes and
  state grammar as the map: a residue with no measurement is drawn as missing, never as neutral.
- **Linked selection.** One selection model for map, tracks, tables and structure: picking a
  residue selects its map column; a map selection highlights its residues.
- **Structure as data.** DSSP, solvent accessibility, exposure (pPSE), pLDDT and contacts become
  position tracks and the grouping variables of "effects by structural class" and the
  spatial-cluster test.

## Proteoscope handoff (optional)

Proteoscope adds deeper structural analysis (interfaces, ligands, validation reports,
superposition, density maps) for users who have it. MaveScape needs nothing from it, and this plan
makes no changes to Proteoscope: the handoff uses only what released Proteoscope versions already
accept. The browser cannot call
Proteoscope's API directly (it refuses cross-origin requests, by design), so the MaveScape host
does the talking:

1. `handoff.go` finds a running Proteoscope by probing 8765–8814 for `/api/startup`, which also
   gives its version.
2. MaveScape writes its own handoff document (`mavescape-proteoscope-handoff`, version 1,
   `docs/HANDOFF.md`): structure reference (PDB ID, AlphaFold accession or a local file the user
   chose), chain and sequence mapping, per-residue values with palette, range and legend title,
   selected residues, the active condition, and the workspace and run IDs. It is MaveScape's
   record of what was sent, exported with the workspace.
3. It delivers what Proteoscope can take, best first:
   - **A Proteoscope link** opened in the browser: `#fetch=<id>` for the structure, or a
     `#session=` payload whose "Custom residue data" coloring carries the values, color map and
     legend. The session format is internal to Proteoscope, so MaveScape uses it only for
     Proteoscope versions it has been tested against (from `/api/startup`).
   - **Remote commands**, when Proteoscope runs with `--remote-control`: select residues
     (`/A:315`, `uniprot 175`) and color them in binned palette steps. No legend.
   - **Files**: the structure with scores in the B-factor column and a residue-value table, with
     short instructions.

## Testing

- `go test -race ./...`: host, library, fetch allowlist and limits, cache, offline mode, archive
  extraction, remote control, MCP protocol, handoff relay (against a fake Proteoscope).
- `node --test "web/lib/*.test.mjs"`: every pure module, against hand-computed, published or
  reference-tool values; property tests for row-order and column-order invariance, pseudocount
  scaling and deterministic serialization.
- `node validation/run.mjs`: end-to-end suites against committed reference outputs
  (`validation/reference/*.json`, produced by pinned Enrich2, DiMSum, mutscan, dms_variants,
  mavehgvs and R scripts) and the fixture set; `--require-data` in CI.
- `node validation/headless-run.mjs`: `mavescape run` twice (identical outputs) and the same
  analysis through the real UI in headless Chrome.
- `node --expose-gc validation/bench.mjs`: the performance targets in `conventions.md`.
- CI also runs `node --check` on every web file, cross-compiles six platforms and lints the
  installers.
