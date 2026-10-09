# MaveScape engineering conventions

MaveScape is a workbench for multiplexed assays of variant effect (MAVEs), starting with protein
deep mutational scanning. A Go program (standard library only) serves an embedded web app. All
parsing, scoring, QC and rendering run in the browser. The web app must also work when served as
static files by any web server (no Go backend), so nothing in `web/` may assume that the backend
exists. Features that need the host (the library on disk, public-data fetching, the Proteoscope
relay) detect it through `/api/info` and degrade with a plain message. License: Apache-2.0. No
third-party runtime dependencies, in Go or JavaScript.

MaveScape is a sibling of CytoWeave (`~/mycode/cytoweave`) and Proteoscope
(`~/mycode/proteoscope`). It copies their host, security model, conventions and test approach on
purpose, so that one person can maintain all three. When a CytoWeave module is copied, its origin
is noted in the file's header comment ("Adapted from CytoWeave 0.8.0 web/lib/zip.js"), so fixes can
be carried across.

## Layout

```
main.go, security.go, local.go, store.go,      Go host (embeds web/), adapted from CytoWeave
records.go, window.go
fetch.go, cache.go                             allowlisted public data, adapted from Proteoscope
handoff.go                                     optional handoff to a running Proteoscope
remote.go, output.go, connection.go,          automation (remote control, MCP, headless runs)
mcp.go, run.go, verify.go
web/index.html, web/styles.css, web/app.js     app shell
web/lib/*.js          pure modules: no DOM, no globals, importable by Node and by workers
                      (the structure viewer's modules are copied from Proteoscope)
web/lib/*.test.mjs    node:test unit tests, one file per module
web/ui/*.js           DOM components (only these touch document/window)
web/workers/*.js      module workers wrapping heavy lib functions
web/examples/         compact bundled example data (published, with license and citation)
validation/           comparisons against reference tools and fixtures (numbers only)
clients/              Python and R clients generated from the tool list
docs/                 installation, file formats, MCP, network requests, the handoff, site
mavescape-spec/       requirements, design, roadmap, research, these conventions
```

## Names

- Product: **MaveScape**. Executable and Go module: `mavescape`. Never "VariantWeave" (the PRD's
  working name).
- Default port 8820 (tries 8820–8839). CytoWeave uses 8770–8789 and Proteoscope 8765–8814.
- Data directory `<UserConfigDir>/MaveScape`; public-data cache `<UserCacheDir>/mavescape`.
- Headers `X-MaveScape-Token`, `X-MaveScape-Cache`, `X-MaveScape-Source`.
- Workspace archive extension `.msz` (a ZIP, see below). Design files `*.design.json`; import
  templates `*.import.json`.

## Code style

- Plain ES modules (`export function …`), modern JavaScript, no build step, no TypeScript.
- Two-space indent, single quotes, semicolons, trailing commas in multi-line literals.
- Comments explain *why* and cite the method (author, year, DOI or tool and version) where an
  algorithm reimplements a published one. Keep them brief and factual.
- Numerical code uses typed arrays: `Float64Array` for counts, scores and uncertainties (counts
  can exceed 2^24 and scores are compared with reference tools to 1e-10), `Int32Array` for
  positions and indices, `Uint8Array` for codes (variant kind, status, filter reason). Avoid
  per-variant object allocation in hot loops; a million-row barcode table must stay columnar.
- **Missing is not zero.** A count that was not observed in a sample's table is `NaN`; an explicit
  0 is 0. Reference tools treat them differently (Enrich2 drops a variant absent from a time point
  but scores an explicit 0), so the distinction is kept from parsing to export.
- Every stochastic function (bootstraps, simulations, permutation tests) takes `options.seed`
  (default a fixed number) and uses `createRandom(seed)` from `web/lib/random.js`. Results must be
  deterministic for a seed, and the seed is recorded in the score run.
- Long-running functions accept `options.onProgress(fraction, message)` and `options.signal` (an
  AbortSignal-like `{ aborted }`) and check it periodically.
- Errors that a user can fix throw an `Error` with a plain-language message naming the file, row,
  column, sample or variant.
- No `console.log` in library code.
- Tests: `node --test "web/lib/*.test.mjs"` must pass; tests are deterministic, run in well under a
  few seconds per file, and check numbers against independently known values (hand-computed,
  published, or reference-tool output), not just "runs".

## Terminology

MaveScape reports **experimental functional effects**. It never labels a variant pathogenic or
benign. Use these words consistently in the UI, exports, methods and agent tools:

| Use | Meaning | Never |
| --- | --- | --- |
| functional score, score | the estimate a scoring model produces for a variant | "pathogenicity" |
| standard error (SE), 95% CI | uncertainty of a score | "confidence" for a QC status |
| WT-like, intermediate, abnormal-like | research-use functional classes from user-set thresholds (exported in MaveDB's vocabulary: normal, not specified, abnormal) | "benign", "pathogenic" |
| evidence strength (research use) | calibration output (OddsPath, likelihood ratios) | an ACMG/AMP classification |
| missing | not observed in the counts | "zero", "neutral" |
| filtered | observed, excluded by a filter (with a reason code) | "missing" |
| low-confidence | scored, but flagged (SE, replicate disagreement, depth) | |
| not designed | not in the library (when a library definition is given) | "missing" |

## Data model

### Targets (`web/lib/target.js`)

```js
target = {
  id, name, organism,
  sequence: 'ATG…' | 'MSK…', sequenceType: 'dna' | 'protein',
  codingStart: 1,                 // for DNA targets: first base of the reading frame
  offset: 0,                      // added to positions to report them in the reference protein
  identifiers: { uniprot: 'P38398', refseq: 'NM_007294.4', ensembl: 'ENST…', gene: 'BRCA1' },
  differences: [{ position: 174, target: 'R', reference: 'K', note }],  // construct vs reference
}
```

### Variants (`web/lib/variants.js`, columnar)

```js
variants = {
  n: 12345,
  original: string[],            // the identifier exactly as in the source, never rewritten
  key: string[],                 // canonical target-relative MAVE-HGVS, e.g. 'p.Ala12Val', 'p.[Ala12Val;Gly13Asp]'
  ntKey: string[] | null, spliceKey: string[] | null, proKey: string[] | null,
  level: Uint8Array,             // NT | SPLICE | PRO: the level the key is at
  kind: Uint8Array,              // WT | SYNONYMOUS | MISSENSE | NONSENSE | START_LOST | STOP_LOST |
                                 //   MULTI | INDEL | OTHER
  position: Int32Array,          // first affected position in target coordinates (-1 none)
  ref: Uint8Array, alt: Uint8Array, // amino-acid codes for single substitutions (0 = n/a)
  status: Uint8Array,            // VALID | WARNING | INVALID | UNMAPPED
  messages: Map<number, string[]>, // validation messages by row
  vrs: string[] | null,          // optional GA4GH VRS identifiers (from MaveDB mapped variants)
}
```

Identifiers are parsed by `web/lib/hgvs.js` in two modes: **strict** (MAVE-HGVS as `mavehgvs`
0.8.1 defines it: three-letter amino acids, `Ter`, sorted non-overlapping multi-variants; used for
export) and **lenient** (legacy MaveDB data and lab tables: Enrich2's `_wt`/`_sy`, duplicated
components, `p.A12V`, `A12V`, `*`), which normalizes to the strict form and keeps the original.

The model never assumes single amino-acid substitutions. The map view specializes in them and
lists everything else (multi-substitutions, indels, splice variants) in a table beside it.

### Count sets (`web/lib/counts.js`)

An immutable import of one table:
`{ id, source: { fileName, sha256, size, importTemplate }, rows, variantIndex: Int32Array,
columns: [{ name, original, type }], samples: [{ id, column, total, observed }], counts:
Float64Array[] /* one per sample; NaN = missing */, barcodes?: { barcode: string[], variantRow:
Int32Array } }`. Original columns that are not counts are kept, as strings, for export.

### Design (`mavescape-design` v1, `docs/schemas/design.v1.json`, `web/lib/design.js`)

```js
design = {
  format: 'mavescape-design', version: 1, name, description,
  model: 'two-population' | 'time-series' | 'bins' | 'scores',
  source: { mavedb: 'urn:mavedb:…', citation, license },
  variants: { column: 'hgvs_pro', level: 'protein' | 'nucleotide' | 'splice' },
  targets: [target, ...],               // target.differences: known construct differences
  library: { level: 'variant' | 'barcode', tiles: [{ id, name, start, end }] },  // tiles may overlap
  conditions: [{ id, name, reference }],
  // Physical sequenced samples; a sample's columns are its technical replicates (summed).
  samples: [{ id, name, columns: ['input_count_rep1'], batch, cells }],
  // Biological replicates, each scored on its own and then combined. A sample may be named by
  // several replicates (an input selected three times).
  replicates: [{ id, name, biological: 1, condition, tile,
                 input, output,                                // two-population
                 timepoints: [{ sample, time }],               // time-series
                 bins: [{ sample, order, value }] }],          // bins
  time: { unit: 'round' | 'generation' | 'hour' | 'day' | 'minute' | 'other' },
  bins: { weight: 'rank' | 'fluorescence' | 'other' },
  scores: { score, se, ciLow, ciHigh },                       // model 'scores'
  controls: { wildType: 'auto' | id, synonymous: 'auto' | 'none' | [ids], nonsense: …, classes },
  // Every column of the table is a sample's, an identifier or here, with a reason; a column that
  // repeats a shared sample says so (copyOf).
  ignoredColumns: [{ column, reason, copyOf }],
  notes: [text],
}
```

`validateDesign(design, { columns }) → { ok, errors, warnings }` checks the structure and the
rules of each model against the table's header; `summarizeDesign(design) → { model, counts,
lines }` describes it for people (requirement E5). Technical replicates are pooled before scoring;
biological replicates are scored separately and combined. The UI never presents the two as
equivalent. Three public data sets of different designs are represented with no code for any of
them (`validation/designs/`, suite `designs`).

### Score runs (`web/lib/runs.js`)

```js
run = {
  format: 'mavescape-run', version: 1,
  id,                              // SHA-256 of the canonical inputs, design, model and parameters
  created, model: 'ratio' | 'wls' | 'ols' | 'bins' | 'bins-mle' | 'dimsum' | 'imported',
  software: { name: 'MaveScape', version, commit, engine },
  inputs: { countSets: [sha256], design: sha256, importTemplates: [sha256] },  // the design's SHA-256
  params: { pseudocount: 0.5, normalization: 'wt' | 'complete' | 'full' | 'synonymous',
            combination: 'fixed' | 'reml' | 'enrich2', filters: [{ id, kind, params }], seed },
  warnings: [{ code, message, variants? }],
  results: { score, se, ciLow, ciHigh: Float64Array, replicates: Uint8Array,
             status: Uint8Array /* SCORED | LOW_CONFIDENCE | FILTERED | MISSING | NOT_DESIGNED */,
             reason: Uint8Array /* filter code */, stage: Uint8Array /* filter order */,
             perReplicate: [{ score, se }] },
  outputSha256,
}
```

A run is immutable: changing a parameter makes a new run. Identical inputs and parameters give the
same id and bit-identical results in one JavaScript engine (across engines, equal to 12
significant digits; see CytoWeave's wave 8 finding).

### Workspace

In the library, a workspace is one JSON document (as CytoWeave's), referring to count tables by
SHA-256. Exported, it is a `.msz` ZIP archive:

```
manifest.json            format 'mavescape-archive', version, created, software, contents with SHA-256
workspace.json           targets, design, import templates, runs (parameters and summaries),
                         selections, figures, calibration, history (hash-chained), checkpoints
sources/<sha256>.csv     the imported tables, unless exported with checksums only
results/<run-id>.csv     each run's per-variant results
annotations/<source>.json cached public records with retrieval metadata
methods.md, references.bib
```

Archives are written atomically, read with path-traversal and decompression limits, and migrated
explicitly (`web/lib/migrate.js`); MaveScape opens at least the two previous schema versions.

## Workers

Module workers in `web/workers/` import from `../lib/`. Protocol: the page posts
`{ id, type, payload }`; the worker replies `{ id, progress: [fraction, message] }` zero or more
times, then `{ id, result }` or `{ id, error }`; `{ id, type: 'cancel' }` cancels. Transfer
typed-array buffers instead of copying.

## Performance targets

From the PRD, measured by `validation/bench.mjs` and gated in CI from wave 2:
- Import 1 million CSV rows in under 15 s without freezing the page; under 1 GB of browser memory.
- Score 100,000 variants across six samples in under 10 s.
- Pan and zoom a 20 × 5,000 map at 30 frames per second or better; repaint a selection in under
  100 ms.
- Start and open the UI in under 2 s with a warm cache.
