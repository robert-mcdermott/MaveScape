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
| `hgvs` | `web/lib/hgvs.js` against mavehgvs 0.8.1 on 16,959 strings: the same decision, reason, canonical form and parts for every one | `reference/mavehgvs.json` |
| `experiment` | The design editor's operations rebuild each feasibility design; sample sheets (`fixtures/*.samples.csv`) and DiMSum's design file give the same designs; the workspace history's chain survives saving and catches an edited entry | MaveDB and DiMSum, external; `fixtures/` |
| `scoring` | The scoring engine (`web/lib/score.js`) against Enrich2 2.0.2 (replicate and combined scores, all three normalizations), dms_variants 1.6.0 (`func_scores`) and metafor 5.2-1 (REML and fixed effects); the PRD's two-population edge cases on a synthetic fixture (`fixtures/two-population.csv`); rescaling; determinism, row- and column-order invariance and symmetry; runs that reproduce from a saved workspace; BRCA1's two assays drafted into two conditions | `reference/enrich2.json`, `dms_variants.json`, `metafor.json`, `fixtures/`; MaveDB, external |
| `qc` | Quality control: simulated experiments with one problem each (`qc-cases.mjs`, `web/lib/simulate.js`) raise exactly their findings, a clean one none, on three seeds; the variance check against simulated bottlenecks; invariance to row order and to a run; thresholds; the feasibility data's findings, locked as found | simulated; MaveDB, external |
| `map` | The variant-effect map: the fixture's SVG against `golden/two-population.map.svg` (`UPDATE_GOLDEN=1` rewrites it), each state where planted, state colors apart from the neutral color (CIEDE2000) in every theme, the scale, row orders; GRB2's numbering and BRCA1's least tolerant positions | `fixtures/`; MaveDB, external |
| `import` | The importer on the feasibility tables (every name valid against its target, missing never 0, designs drafted from column names with the hand-written designs' shape), on shuffled, split and part-read copies, on DiMSum's demo, and on a table with one problem of each kind (`fixtures/malformed-counts.csv`) | MaveDB and DiMSum, external; `fixtures/` |

## Public data (`sources.json`)

| Data set | Design | Why it is here |
| --- | --- | --- |
| `mavedb-grb2-sh3` (urn:mavedb:00000835-a-1) | two populations × 3 replicates | the common case; DiMSum behind the published scores |
| `mavedb-brca1-ring` (urn:mavedb:00000003-a-1, -a-2) | time series: 2 libraries × 3 replicates × 6 rounds (E2 binding), and 2 × 3 × 4 non-uniform times (Y2H), in one table | shared inputs, two assays in one table, legacy `_wt`/`_sy` rows, a DNA target with an offset and a known difference from UniProt; Enrich2 behind the published scores |
| `mavedb-factor9` (urn:mavedb:00001200-a-1) | FACS bins: 3 overlapping tiles × 3 replicates × 4 bins | tiled libraries, VAMP-seq-style weights |
| `dimsum-demo` (lehner-lab/DiMSum `inst/demo`, MIT) | 40,591 whole nucleotide sequences × 4 inputs and 4 outputs; its design file | DiMSum's layout (variants as sequences, named against the 126-nt wild type); CR-only line ends |

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
  at different times; the design allows it and warns that combining their scores treats them as
  one experiment, on one scale.

## The MAVE-HGVS reference (`reference/mavehgvs.json`)

Made by

```sh
uv run --python 3.12 --with mavehgvs==0.8.1 python validation/reference/generate_mavehgvs.py
```

from a corpus of 16,959 strings: every string literal of mavehgvs's own tests at v0.8.1 (as
written, and with each prefix in front), identifiers from the feasibility data (all of GRB2, a fixed
sample of the others), 3,000 variants generated from the grammar and 4,000 single-character edits
(seed 20261008). mavehgvs accepts 7,741 and refuses 9,218 for nine reasons; for every valid string
its canonical form is the string itself. `web/lib/hgvs.js` is written to the same grammar and
rules, not ported from mavehgvs's regular expressions, and agrees on every string.

## Reference outputs (`reference/`)

`reference/enrich2.json` is made by

```sh
node validation/fetch.mjs
uv run --python 3.12 --with enrich2==2.0.2 python validation/reference/generate_enrich2.py
```

and committed, so CI needs neither Python nor Enrich2. The generator builds Enrich2's
configuration from the design files, and scores the synthetic fixture too (`two-population`,
below). Enrich2 scores the whole tables; for BRCA1 the file keeps a fixed subset of variants
(every sixth by name, the `_wt` and `_sy` rows, and 300 variants missing from some replicates),
2.3 MB in all.

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

## The synthetic fixture (`fixtures/two-population.*`)

`node validation/fixtures/make-two-population.mjs` writes it, deterministically (seed 20261008):
a 20-codon target (`two-population.fasta`), its design (`two-population.design.json`) and a count
table (`two-population.csv`) of 202 variants (the wild type; synonymous, nonsense and 8 missense
variants by position), simulated before and after selection in three biological replicates, the
third's output on two sequencing lanes (technical replicates, summed). The PRD's two-population
edge cases are planted on named variants: zero in both samples (p.Lys3Arg, replicate 1), zero in
the input only (p.Gly4Asp), zero in the output only (p.Glu5Ter, every replicate), a missing
measurement (p.Glu6Lys, no output count in replicate 2), absent from one replicate (p.Leu7Pro),
very low depth (p.Phe8Ser, 2 and 1 reads), observed but below an input filter of 10 (p.Thr9Ala, 3
reads) and not counted at all (p.Gly10Ala). Each variant is also written as a codon substitution
(column `codon`), so that dms_variants can score the same table. The suite derives the other edge
cases from it: the wild-type row removed, controls declared absent, counts divided by 2,000.

## Scoring references (`reference/dms_variants.json`, `reference/metafor.json`)

```sh
uv run --python 3.12 --with dms_variants==1.6.0 python validation/reference/generate_dms_variants.py
Rscript validation/reference/generate_metafor.R
```

- **dms_variants 1.6.0** (Bloom lab; GPLv3, an external reference only) scores the fixture with
  `CodonVariantTable.func_scores` by barcode (one barcode per variant), pseudocount 0.5, natural
  logarithms. Its formula is Enrich2's wild-type ratio, and its variance the same four reciprocal
  counts; it does not tell a missing count from 0, so rows the fixture leaves NA are not compared.
- **metafor 5.2-1** (R 4.6.1) combines Enrich2's replicate scores of GRB2 and BRCA1 E2 (taken from
  `enrich2.json`, so the reference does not depend on MaveScape's scoring) and six synthetic sets,
  by `rma(method = "REML")` with a convergence threshold of 10⁻¹⁴ and by `rma(method = "EE")`.

### What the comparisons showed (wave 1, slice 5)

- **The engine equals Enrich2 2.0.2** with its Enrich2-compatible parameters, replicate by replicate
  and combined, to about 5 × 10⁻¹³ (the reference's 13 digits): GRB2 with the three normalizations,
  BRCA1 E2 (a time series scored by its ends, shared inputs; 9,279 replicate and 1,141 combined
  scores) and the fixture, scoring exactly the variants Enrich2 scores.
- **It equals dms_variants' func_scores** on the fixture (601 replicate scores and variances,
  4.6 × 10⁻¹³).
- **Its REML equals metafor's** to 3.4 × 10⁻¹² on 2,865 real variants (τ² at its bound of 0 for
  231 of them) and the synthetic sets, following metafor's Fisher scoring (the Hedges start, step
  halving at 0, the check against τ² = 0); fixed effects and Cochran's Q to 5 × 10⁻¹³.
- **Enrich2's estimator is REML where it converged**: on GRB2, its combined scores with epsilon 0
  equal metafor's REML to 10⁻¹²; elsewhere they differ, as its start predicts.
- **The edge cases** each behave as specified: a replicate with no input reads does not count
  (MaveScape's default minimum input count is 1; Enrich2-compatible scores it from the
  pseudocount); a zero output is scored and flagged as resting on the pseudocount; a variant
  missing from a replicate is combined from the others and flagged; a filtered variant keeps its
  counts and replicate scores with its score NA and its stage; a missing reference class (no
  wild-type row, no synonymous or nonsense controls when needed) refuses the run with the reason;
  very low depth is warned about sample by sample.

## Quality control (wave 1, slice 6)

`qc-cases.mjs` simulates (web/lib/simulate.js, seeds 20261009–11) a 40-residue protein's 839
variants (wild type, synonymous, nonsense, every missense) in three replicates at 200 reads per
variant, each case with one problem: replicate noise of SD 0.7 in every replicate (poor
agreement), or 0.9 in one (a failing replicate); 20 cells per variant into selection (a
bottleneck); library frequencies of log-SD 1.6 at 60 reads per variant (a low-count tail); one
output sample missing. Each must raise exactly its findings (review or fail); the clean
experiment none. Findings that need one another are expected together: replicate noise raises
both disagreement and variance beyond counting, a failing replicate also an outlier.

What QC found in the feasibility data, with MaveScape's default scoring (locked by the suite):

- **GRB2 SH3**: variance beyond counting, about 11× (fail): the input bottleneck the data's own
  DiMSum analysis reported. Everything else passes, coverage 100%.
- **BRCA1 E2**: coverage 76% of single substitutions (an error-prone-PCR library), replicate
  agreement down to r = 0.68, variance 36× counting, and dropouts: about 30% of the variants are
  missing from the last round with no count of 0 anywhere in the table, and those had fallen to
  1–3% of their input a round earlier (others 12–54%).
- **BRCA1 Y2H**: the controls do not separate (AUC 0.39): nonsense variants before residue 61
  score about −3.7, after residue 110 about +0.5. Truncations that keep the RING domain keep
  binding BARD1, so most nonsense variants are not loss-of-function controls in this assay.
- **Factor IX**: counts-level findings pass; bins are scored from wave 2.

## The map (wave 1, slice 7)

`golden/two-population.map.svg` is the synthetic fixture's map (minimum input count 10, so that
every state appears: p.Thr9Ala and p.Phe8Ser filtered, p.Gly10Ala missing, p.Lys3Arg and p.Glu5Ter
low confidence). A change to the map's drawing shows up as a difference from it; when the change is
meant, `UPDATE_GOLDEN=1 node validation/run.mjs map` writes the new file, to review and commit.

`node validation/bench.mjs` (in CI) simulates a 5,000-residue target (105,000 variants, three
replicates), scores it, builds its map and draws 180 frames while panning on a stand-in context:
scoring 0.5 s, the model 26 ms, 0.6 ms of JavaScript per frame at the median (budgets 10 s, 1 s,
16 ms). Drawn on a real canvas in Chrome (1,600 × 500 pixels at 2× resolution), a frame takes a
median of 2.9, 3.9 and 8.1 ms at 14-, 6- and 2-pixel cells, against 33 ms for 30 frames per second.

