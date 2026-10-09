# Validation

`node validation/run.mjs [suite …] [--verbose] [--require-data]` runs the validation suites and
exits with status 1 when a check fails. Each check states what is compared, the value found and
the tolerance required. Suites that need public data skip without it (and fail with
`--require-data`, as in CI); `node validation/fetch.mjs` downloads it into `validation/cache/`
(not stored in the repository) and checks every file's size and SHA-256 against `sources.json`.

| Suite | What it checks | Data |
| --- | --- | --- |
| `accessibility` | WCAG AA contrast of every text-on-surface pair in both themes, with color-vision-friendly colors off and on; palettes, status colors and score maps apart in protanopia, deuteranopia and tritanopia (Machado et al. 2009, CIEDE2000) | `web/styles.css` |
| `designs` | The design schema on three public data sets of different designs: each design satisfies `docs/schemas/design.v1.json` and `validateDesign` against its table, accounts for every column, and agrees with the data (copied columns identical, the wild type counted everywhere, every variant's reference residue the target's, tiles holding the variants counted in them) | MaveDB, external |
| `enrich2` | Enrich2 2.0.2's scores of those data (`reference/enrich2.json`) against the formulas of `mavescape-spec/research.md` §2.1 computed independently, and the published BRCA1 scores against Enrich2 2.0.2 | MaveDB, external; `reference/enrich2.json` |

## Public data (`sources.json`)

| Data set | Design | Why it is here |
| --- | --- | --- |
| `mavedb-grb2-sh3` (urn:mavedb:00000835-a-1) | two populations × 3 replicates | the common case; DiMSum behind the published scores |
| `mavedb-brca1-ring` (urn:mavedb:00000003-a-1, -a-2) | time series: 2 libraries × 3 replicates × 6 rounds (E2 binding), and 2 × 3 × 4 non-uniform times (Y2H), in one table | shared inputs, two assays in one table, legacy `_wt`/`_sy` rows, a DNA target with an offset and a known difference from UniProt; Enrich2 behind the published scores |
| `mavedb-factor9` (urn:mavedb:00001200-a-1) | FACS bins: 3 overlapping tiles × 3 replicates × 4 bins | tiled libraries, VAMP-seq-style weights |

All are CC0 on MaveDB. MaveDB's API writes these CSV files identically on every request (checked
2026-10-08), with Windows line ends (CRLF) and `NA` for missing values; counts are written as
decimals (`3232.0`).

## The designs (`designs/`)

Each data set's design is written by hand as data (`*.design.json`); nothing in MaveScape is
specific to any of them. What they asked of the schema (wave 1, slice 2):

- **Samples, not columns, and replicates that name them.** BRCA1's three replicates of a library
  share one input, which MaveDB writes once per replicate; the design names one sample and lists
  the other columns as copies (`ignoredColumns[].copyOf`), which the suite checks cell for cell.
  Treating the copies as three inputs would make the replicates look more independent than they
  are.
- **Every column accounted for.** BRCA1's count table holds two experiments (E2 binding and
  yeast two-hybrid); each design uses its own columns and names the others as ignored, with the
  reason. A column that is neither a sample's nor ignored is an error.
- **Tiles with ranges, and overlapping.** Factor IX's tiles overlap (positions 146–164 and
  299–318 are measured twice); each replicate names its tile.
- **Known differences from the reference.** The BRCA1 construct encodes Arg at codon 174 (UniProt
  P38398 residue 175 is Lys); the target records it, so it is not reported as an error.
- **Non-uniform times, and replicates with different times.** The two Y2H libraries were sampled
  at different times; the design allows it and warns that the replicates are combined only on what
  they share.

## Reference outputs (`reference/`)

`reference/enrich2.json` is made by

```sh
node validation/fetch.mjs
uv run --python 3.12 --with enrich2==2.0.2 python validation/reference/generate_enrich2.py
```

and committed, so CI needs neither Python nor Enrich2. The generator builds Enrich2's
configuration from the design files. Enrich2 scores the whole tables; for BRCA1 the file keeps a
fixed subset of variants (every sixth by name, the `_wt` and `_sy` rows, and 300 variants missing
from some replicates), 2.2 MB in all.

Enrich2 2.0.2 (BSD-3, `pip install enrich2`, Python 3.12, pandas 3.0) as found when generating
it:

- An ID-only library reads a tab-separated file whose one column is headed `count` (its
  documentation says `counts`; issue #77); counts are read as 32-bit integers.
- A variant missing from any time point's table is left out of that replicate; an explicit 0 is
  kept and scores from ln 0.5.
- Wild-type normalization needs a row named `_wt`. The library-size normalizations (`complete`,
  `full`) add one pseudocount to the summed counts (issue #75).
- The regression's x is t / max t, with an intercept; its SE is scaled by the residuals.
- Output folders are named with its `fix_filename`, which drops `-` and other punctuation.
- **The random-effects combination** starts the between-replicate variance at Σ(yᵢ − ȳ)² ÷
  (number of variants − 1) and iterates exactly 50 times without a convergence test. Where 50
  iterations do not converge, the result depends on the number of variants in the table. The
  suite reproduces the estimator exactly (`enrich2-formulas.mjs`).

### What the comparisons showed

- **Each formula of `research.md` §2.1 equals Enrich2 2.0.2**, to the file's 13 significant digits
  (largest relative difference about 5 × 10⁻¹³): log ratios with wild-type, complete-case and
  all-read normalization (GRB2, 3,354 replicate scores each), weighted and ordinary least squares
  (BRCA1 E2, 9,279; Y2H with non-uniform times, 11,932), and the random-effects combination in
  every case.
- **The published BRCA1 replicate scores** (Rubin et al. 2017, made with the Enrich2 of 2017) are
  reproduced by Enrich2 2.0.2 with weighted least squares and wild-type normalization, to 5 × 10⁻¹³
  for all 9,279 stored values: that is the published method, now confirmed.
- **The published BRCA1 combined scores** agree where the random-effects estimator converged
  (591 stored variants, 5 × 10⁻¹³). Where it had not (549 stored variants; 488 of all 6,847), they
  differ by up to 0.0025 here and 0.034 over all variants: the estimator's start depends on how
  many variants were in the table, which differed in 2017. MaveScape's REML runs to convergence;
  its "Enrich2-compatible" option reproduces 2.0.2 exactly, and this difference is expected.
- **GRB2's published scores** come from DiMSum (absolute growth rates from culture densities and
  times, which the table does not hold, and another error model); Enrich2's log ratios correlate
  with them at r = 0.987. DiMSum's model arrives in wave 2.
