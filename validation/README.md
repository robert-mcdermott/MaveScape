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
| `experiment` | The design editor's operations rebuild each feasibility design; sample sheets (`fixtures/*.samples.csv`) and DiMSum's design file give the same designs; every validation design written back as a sample sheet reads as itself (wave 2 slice 10); the workspace history's chain survives saving and catches an edited entry | MaveDB and DiMSum, external; `fixtures/` |
| `scoring` | The scoring engine (`web/lib/score.js`) against Enrich2 2.0.2 (replicate and combined scores, all three normalizations), dms_variants 1.6.0 (`func_scores`) and metafor 5.2-1 (REML and fixed effects); the PRD's two-population edge cases on a synthetic fixture (`fixtures/two-population.csv`); rescaling; determinism, row- and column-order invariance and symmetry; runs that reproduce from a saved workspace; BRCA1's two assays drafted into two conditions; time series (wave 2): weighted and ordinary regression against Enrich2 2.0.2 (BRCA1 E2 and Y2H, the time-series fixture) and statsmodels 0.15 (the fixture), the time-series edge cases, the simulated truth and the 95% intervals' coverage, "Missing = 0"; sorted bins (wave 2): factor IX's published MultiSTEP scores reproduced from its counts, the maximum-likelihood fit against fitdistrplus, the simulated sort's truth, the bootstrap against the analytic SE, the scales; barcodes (wave 2): every barcode and every variant's summed counts against dms_variants 1.6.0 by barcode and by substitution, the counts read with MaveScape's map, in dms_variants' `variant_counts` and in Enrich2's layout, the barcode fixture's truth and planted outliers, row order, refusals; DiMSum's model (wave 2): the threshold, the variants fitted, the scales and shifts, the error model, every fitness and σ and the merge against DiMSum 1.4's own functions on the fixture, GRB2 and DiMSum's demo, GRB2's published scores, the 95% intervals' coverage under a simulated bottleneck, refusals; differential scores (wave 2): limma against mutscan 1.2.0 on the two-condition fixture and CBS, Enrich2's z between conditions, the paired differential from first principles, the edge cases, the truth; scores per unit of time against the whole-course scores, DiMSum's model on a table of barcodes, the bins' defaults without the wild type (wave 2 slice 10) | `reference/enrich2.json`, `dms_variants.json`, `dms_variants-barcodes.json`, `metafor.json`, `statsmodels.json`, `fitdistcens.json`, `dimsum.json`, `mutscan.json`, `fixtures/`; MaveDB and DiMSum, external |
| `qc` | Quality control: simulated experiments with one problem each (`qc-cases.mjs`, `web/lib/simulate.js`: two populations, time series, sorts and barcoded libraries) raise exactly their findings, clean ones none, on three seeds; the variance check against simulated bottlenecks, and DiMSum's terms placing them before or after selection; invariance to row order and to a run; thresholds; the feasibility data's findings, locked as found; findings in context (wave 2 slice 8): every raised finding says what could cause it and what to do, the readout's direction, coverage of a single-base library, where BRCA1 Y2H's stops stop losing the function; the cells recorded against simulated bottlenecks (wave 2 slice 10) | simulated; MaveDB, external |
| `map` | The variant-effect map: the fixture's SVG against `golden/two-population.map.svg` (`UPDATE_GOLDEN=1` rewrites it), each state where planted, state colors apart from the neutral color (CIEDE2000) in every theme, the scale, row orders; GRB2's numbering and BRCA1's least tolerant positions | `fixtures/`; MaveDB, external |
| `roundtrip` | The record: the fixture and the GRB2 example as workspaces saved as `.msz`, reopened and saved again (the same bytes), every export again byte for byte, exported scores and counts imported again without loss, tampered, hostile and foreign archives caught, the examples and the blank layouts checked; an acknowledged finding through the archive; the archive each release saved (`archives/`) opened and its runs reproduced; the analysis package (wave 2 slice 10) scored from its own files to the run's output hash, its sample sheet read as its design, the same bytes twice | `fixtures/`, `web/examples/`, `archives/` |
| `import` | The importer on the feasibility tables (every name valid against its target, missing never 0, designs drafted from column names with the hand-written designs' shape), on shuffled, split and part-read copies, on DiMSum's demo, and on a table with one problem of each kind (`fixtures/malformed-counts.csv`) | MaveDB and DiMSum, external; `fixtures/` |
| `readiness` | What each analysis can do with what a workspace holds (wave 2, slice 10; `readiness-cases.mjs`): the six examples, the five fixtures and a simulated bottleneck with its cells recorded, whole and with one part taken away (the wild-type row, a replicate, the gates, the cells, the times in generations, the middle time points, the readout, the nonsense or synonymous controls), 74 workspaces. The readiness model must name exactly what was taken away, and its verdict on every analysis must agree with the engine: each scoring analysis scored or refused with the parameters that use it, each QC finding assessed or not, and an analysis it leaves out for a design one the engine cannot do there either. An empty workspace and a broken design | `web/examples/`, `fixtures/`, simulated |
| `examples` | Every bundled example opened as the window opens it (wave 2, slice 11; `example-cases.mjs`): assembled (Hsp90's codon variants read at the protein level), scored with its parameters, raising exactly the QC findings it teaches, its readout stated and its readiness naming what its guide points to, at most six guided steps; the published examples' counts MaveDB's, byte for byte. Hsp90's codons (568 rows, 188 protein variants, the wild type's nine copies read once) and its per-generation scores against the published fitness; a single replicate's own SEs; factor IX against MultiSTEP's scores; the simulated problems against their truth, with and without replicate 3 | `web/examples/`; MaveDB, external (`mavedb-hsp90`, `mavedb-factor9`) |

## The remote-control session (`remote-session.mjs`)

`node validation/remote-session.mjs [--verbose]` builds MaveScape, starts it with
`--remote-control` on an empty library, opens it in headless Chrome (`docs/capture/cdp.mjs`; set
`CHROME` to choose the browser) and sends every action (`actions.go`) as a script would. It checks
the connection file and its permissions, refusals (no page, no token, a relative or existing path,
a design that does not fit, parameters that cannot score) and forgiving names, then the results
against the same analysis in Node: the window's runs have the output hash of `scoreExperiment` on
the same table and design, a variant's evidence matches, and every export the hub writes is
byte for byte the file Node makes from the exported archive (provenance but for its file names).
It also checks that `web/lib/dmath.js` gives the same bits in the browser as in Node, and (wave 2,
slice 4) the barcoded example: its counts and map assembled in the window, scored barcode by
barcode with Node's output hash, its barcodes exported byte for byte as Node writes them; and
(slice 5) GRB2 scored with the DiMSum preset, Node's output hash and fitted terms; and (slice 6) the
two-condition example in the window with Node's hash, its differential map, a variant's difference
and the differential export as Node writes them; and (slice 7) `check` (valid, a design that does
not fit, parameters that cannot score) and `reproduce_run`; and (slice 8) a finding's causes and
next steps, `acknowledge_finding` (the finding still fails, the overall status counts it apart, a
passing one is left alone, an unknown one lists the findings) and the QC findings export, byte for
byte Node's. 75 checks; in CI as the `remote` job.

## Headless runs (`headless-run.mjs`, wave 2 slice 7)

`node validation/headless-run.mjs [--verbose]` builds MaveScape and runs it as a command, as a
pipeline would (headless Chrome: `CHROME`, else one installed):

- the GRB2 example (`web/examples/grb2-sh3`) twice with `--time`: every file the same bytes, the
  provenance and the workspace archive too; with SOURCE_DATE_EPOCH, the same; with no fixed time,
  the results the same and the provenance differing only in its times and identifiers;
- the run's own archive recomputed in Node (`roundtrip-cases.mjs`'s `recompute`): its recorded
  output hash, and the scores, counts, QC, map, methods and references as Node writes them; the
  same analysis through remote control in a window: the same files;
- `--from-workspace` with that archive: the run reproduced, every file the same bytes; with the
  run's recorded output hash altered: exit 1, nothing exported;
- the two-condition fixture (a scores file per condition, the differential scores) and the barcode
  fixture with its map (the barcodes export), as Node writes them;
- the failures: a design that does not fit the table and parameters that cannot score (exit 1,
  nothing scored), an output sample with no counts (QC's blocking finding: exit 1, the files
  written), `--strict` (GRB2's failing finding), and a wrong command line, an output folder in
  use, a missing input and conflicting options (exit 2, nothing run);
- `--strict --acknowledge excess-variance=…` (wave 2, slice 8): the finding still fails but is
  acknowledged, so the run exits 0, with the reason in `run.json`, `qc_findings.csv` and the
  methods; an acknowledgement of a finding that passes is left alone; one without a reason is a
  wrong command line (exit 2);
- `--log json` (one JSON object per line) and `mavescape validate` (0 valid; 1 with what blocks
  scoring, `--json`; a design alone; parameters; 2 for a wrong command line).

- the analysis package written by the window (wave 2, slice 10): unpacked and run by `mavescape run`
  from its own files, as its README says, it gives the window's run; `mavescape validate --json`'s
  readiness (GRB2 without its readout) equal to Node's, and the text naming what is missing.

- Hsp90's design run on MaveDB's counts as they are (wave 2, slice 11): `mavescape run` reads the
  codon variants at the protein level for the design and gives Node's output hash.

23 checks, in CI's `remote` job; about 25 s.

## Coverage of intervals (`coverage.mjs`, wave 2 slice 9)

`node validation/coverage.mjs [--verbose] [--seeds N] [--require-data]` asks whether MaveScape's
95% intervals hold the truth 95% of the time. The comparisons above show that MaveScape computes
what the reference tools compute; this shows whether the intervals mean what they say.

- **MaveScape's simulator** (`web/lib/simulate.js`): 26 kinds of experiment, each simulated 40
  times (seeds 1000 on), since the wild type's own counting noise moves every score of an
  experiment together and one experiment's coverage swings by several points. Depth from 30 to
  2,000 reads per variant; two to six replicates; bottlenecks of 100 and 25 cells per variant;
  selection noise up to 0.3; one input sample shared by every replicate, with and without a
  bottleneck; overdispersed reads (gamma-Poisson, k = 20); time series by weighted regression, with
  a bottleneck at every passage, with one time-0 sample, and a course that bends scored by the
  ratio of its ends; sorted bins by maximum likelihood; barcodes summed and scored each; DiMSum's
  fitness; scores rescaled to nonsense 0 and wild type 1; paired and limma differential scores.
  The defaults must hold 93–97%; REML is reported beside them. Found: 93.6–96.5% (REML
  81.8–95.5%). The exception is named with its reason: a bending time course scored by its slope
  holds 78.9%, because a slope is not the whole change of such a course; QC's "Fit of the time
  courses" flags it in 39 of 40 experiments (required), and the ratio of its ends holds 95.0%.
- **An independent simulator**, dms_variants 1.6.0 (below): three experiments of 800 variants
  (single substitutions and the wild type), three selections sharing one input sample, with
  counting noise alone, a bottleneck and selection noise. Variants with 5 reads or more in every
  sample must hold 92–98% (one experiment's sampling error is about ±1.5 points). Found: 94.1%,
  97.6%, 96.2% (REML 86.0%, 83.4%, 84.3%). Counting every variant, 90.1%, 96.4% and 95.9%: about a
  fifth have fewer reads somewhere, and the pseudocount biases their scores toward 0.
- **Real data**, which has no truth (with the external data): each replicate held out and
  predicted from the others, combined as the run combines them, each held-out score's departure
  over the SD the model predicts (the others' combined SE and the held-out score's variance under
  the model, less the covariance of a shared input; the departures centered per replicate, since a
  replicate's reference shift is not a variant's error). About 5% should
  fall beyond ±1.96. Found: GRB2 6.1% (robust SD 0.88), CBS 5.6% (0.98), factor IX 10.0% (1.05),
  BRCA1's E2 assay 12.3% (1.20); REML 22.6%, 3.5%, 26.3%, 17.7%. Each must be nearer 5% than
  REML's and under 15%. BRCA1's two libraries were selected with strengths 10–15% apart, every
  score of one proportionally larger, which no model of counting describes.

34 checks; about 35 s; in CI's `web` job with the external data.

## Public data (`sources.json`)

| Data set | Design | Why it is here |
| --- | --- | --- |
| `mavedb-grb2-sh3` (urn:mavedb:00000835-a-1) | two populations × 3 replicates | the common case; DiMSum behind the published scores |
| `mavedb-brca1-ring` (urn:mavedb:00000003-a-1, -a-2) | time series: 2 libraries × 3 replicates × 6 rounds (E2 binding), and 2 × 3 × 4 non-uniform times (Y2H), in one table | shared inputs, two assays in one table, legacy `_wt`/`_sy` rows, a DNA target with an offset and a known difference from UniProt; Enrich2 behind the published scores |
| `mavedb-factor9` (urn:mavedb:00001200-a-1) | FACS bins: 3 overlapping tiles × 3 replicates × 4 bins | tiled libraries, VAMP-seq-style weights |
| `mavedb-hsp90` (urn:mavedb:00000011-a-1) | time series: 1 replicate × 8 times, 0–21 generations; one row per codon, the wild type written once per position | the Hsp90 example (wave 2, slice 11): its counts byte for byte, its codons read at the protein level, its per-generation scores against the published fitness |
| `dimsum-demo` (lehner-lab/DiMSum `inst/demo`, MIT) | 40,591 whole nucleotide sequences × 4 inputs and 4 outputs; its design file | DiMSum's layout (variants as sequences, named against the 126-nt wild type); CR-only line ends |
| `mavedb-cbs` (urn:mavedb:00000005-a-5, -a-6) | two populations × 4 replicates at low and at high vitamin B6, in two records whose non-selected samples are the same | two conditions from shared inputs (wave 2, slice 6); counts not whole numbers; codon variants with no wild-type row |

All are CC0 on MaveDB. The GRB2, factor IX and Hsp90 examples (`web/examples/`) are their count
files, unchanged. MaveDB's API writes these CSV files identically on every request (checked
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

`reference/dms_variants-simulation.json` (wave 2, slice 9; 175 KB) is made by

```sh
uv run --python 3.12 --with dms_variants==1.6.0 python validation/reference/generate_dms_variants_simulation.py
```

dms_variants' `simulate_CodonVariantTable` (a 40-codon gene, 40,000 barcodes, a mean of one codon
mutation per variant), `SigmoidPhenotypeSimulator` and `simulateSampleCounts` (one pre-selection
sample of a million reads; three selections, each with its own bottleneck and noise): the counts
summed over each amino-acid variant's barcodes, the wild type and single substitutions kept, the
truth the logarithm of each variant's observed enrichment. Its noise and bottleneck are its own,
independent of MaveScape's simulator. dms_variants is GPLv3, used only to make this file.

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

## The time-series fixture (`fixtures/time-series.*`, wave 2 slice 2)

`node validation/fixtures/make-time-series.mjs` writes it, deterministically (seed 20261010): a
20-residue protein target in its design (`time-series.design.json`), a count table
(`time-series.csv`) of 199 variants grown in three replicates and sequenced at generations 0, 1,
3, 6 and 10 (unevenly spaced), and each variant's true effect per generation
(`time-series.truth.csv`; ten times it is the true slope on time scaled to 0–1). Seven edge cases
are planted on the first variant of a kind at a position, named in the design's description:
missing at one later time (replicate 1), at two middle times (replicate 2), a dropout written as
missing at the last two times (every replicate), missing at time 0 (replicate 3), counted at only
two times (replicate 1), a time course that rises then falls, and counts of 0 at the last two times.
Enrich2 scores it too (`generate_enrich2.py`, case `time-series`: WLS and OLS with wild-type
normalization, WLS with complete cases, and ratios).

## The sort-seq fixture (`fixtures/sort-seq.*`, wave 2 slice 3)

`node validation/fixtures/make-sort-seq.mjs` writes it, deterministically (seed 20261011): a
simulated sort (`web/lib/simulate.js`) of 839 variants of a 40-residue protein, cells sorted by
gates on a reporter into four bins in three replicates, each bin sequenced to the same depth
(`sort-seq.csv`); its design records each bin's gates and the cells sorted into it
(`sort-seq.design.json`), and `sort-seq.truth.csv` each variant's true shift in log fluorescence.

## fitdistrplus (`reference/fitdistcens.json`, wave 2 slice 3)

```sh
Rscript validation/reference/generate_fitdistcens.R
```

fitdistrplus 1.2.6 (R 4.6.1) fits each replicate's variants of the sort-seq fixture as
interval-censored observations between the gates, weighted by their reads: `fitdistcens(…,
"lnorm")` with meanlog and sdlog free (variants with reads in three or more bins) and with sdlog
fixed at the wild type's own fit, optim's tolerance tightened. It starts from the weighted mean and
SD of the bins' log midpoints: its default start ignores the weights, and from it Nelder–Mead
stopped far from the maximum for variants with nearly all reads in an outer bin.

### What the comparisons showed (wave 2, slice 3)

- **Factor IX's published scores** (MultiSTEP, Popp et al. 2025) are VAMP-seq's arithmetic with
  another scale: bin frequencies over the variants kept, the weighted average with rank weights
  0.25–1, then per replicate the wild type 1 and the median of the lowest ⌈5%⌉ of the kept variants
  0; combined by the mean, SE = SD/√k. Every one of 29,325 replicate scores is reproduced from the
  counts to 1.3 × 10⁻¹⁵ on the variants the authors kept, and the combined scores and SEs exactly.
  Which variants they kept is not recoverable from the table (no count or frequency threshold on
  it separates them; most likely the unsorted library, not on MaveDB): through the engine,
  MaveScape scores 3 to 13 more per replicate, which moves the lowest-5% anchor by up to 2 × 10⁻³.
- **The maximum-likelihood fit equals fitdistcens'** μ and σ to 3 × 10⁻⁷ over 4,800 fits, σ free
  and fixed, and the SE of μ to 0.07% (both from finite-difference Hessians).
- **Against the simulated truth**, the MLE's μ tracks the true shifts (r = 0.996) more closely than
  the weighted average (0.989), and its 95% intervals hold the truth 87% of the time after
  combining (78% per replicate; 57% if its information were scaled to the reads rather than the
  scarcer cells). The bootstrap's SEs equal the analytic ones (median ratio 1.003).

## statsmodels (`reference/statsmodels.json`, wave 2 slice 2)

```sh
uv run --python 3.12 --with statsmodels==0.15.0 --with scipy==1.18.1 --with numpy==2.5.3 --with pandas==3.0.6 python validation/reference/generate_statsmodels.py
```

For the time-series fixture, per replicate and variant, fitted on the time points where it was
counted (its first among them, three or more), with research.md §2.1's definitions written anew in
Python: `sm.WLS` (and OLS) with an intercept, its slope and residual-scaled `bse`, the slope's SE
from counting alone computed with numpy ((A diag(v) Aᵀ)[1,1]^½), and the departure from a line
(Σe²/v over n − 2). The same versions as the Enrich2 reference (statsmodels 0.14.4 does not import
with SciPy 1.18).

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

### What the comparisons showed (wave 2, slice 2)

- **The engine's WLS and OLS equal Enrich2 2.0.2's** with the Enrich2-compatible parameters, to
  5 × 10⁻¹³: BRCA1 E2 (six rounds; 9,279 replicate scores each), BRCA1 Y2H (four unevenly spaced
  times in two libraries sampled at different times; 11,932) and the fixture (WLS and OLS with
  wild-type normalization, WLS with complete cases, and the ratio), scoring exactly the variants
  Enrich2 scores; the combined scores to 5 × 10⁻¹³.
- **They equal statsmodels** on the fixture's 595 fits per method (3 to 5 points), slope,
  residual-scaled SE and departure, to 5 × 10⁻¹⁴, and the counting floor equals the larger of
  statsmodels' SE and numpy's counting SE (raised in 245 to 414 of 595 fits).
- **The counting floor holds the truth more often**: the fixture's 95% intervals hold the true
  slope 83% of the time per replicate and 90% combined, against 69% and 81% with Enrich2's
  residual-scaled SE, combined by REML (the rest is the replicate noise the simulation plants,
  which REML takes up only partly with three replicates). Combined by the moderated combination
  (wave 2, slice 9), which learns that noise from every variant, 93%.

## The barcode fixture (`fixtures/barcodes.*`, wave 2 slice 4)

`node validation/fixtures/make-barcodes.mjs` writes it, deterministically (seed 20261012): a
simulated barcoded library (`web/lib/simulate.js`) of a 30-codon gene's 649 codon variants (every
missense, synonymous and nonsense substitution and 20 double mutants), in two libraries (the
replicates) in which each variant carries its own random 16-nt barcodes, 1 + Poisson(2.5) of them
(the wild type 30), 4,608 in all, counted before and after selection at about 100 reads per
barcode. Each barcode's cells grow by its variant's effect times a clonal factor (SD 0.1), and 2%
of barcodes are off by 1.5–3 (a second mutation, a misassigned barcode). `barcodes.csv` holds the
counts, one row per barcode (`NA` in the other library's columns); `barcodes.map.csv` the
barcode-to-variant map (MAVE-HGVS and dms_variants' codon substitutions), which gives 63 barcodes
(1.5%) a second, different variant and misses 42 (1%); `barcodes.design.json` the design of the
counts with the map applied, `barcodes.fasta` the gene, `barcodes.truth.csv` each variant's true
effect and `barcodes.barcode-truth.csv` each barcode's library, variant, planted shift and place in
the map.

## dms_variants on barcodes (`reference/dms_variants-barcodes.json`, wave 2 slice 4)

The same generator as the fixture's dms_variants reference (above) builds a `CodonVariantTable` of
each library's barcodes from the map, leaving out the barcodes it gives two variants and those it
misses, as MaveScape does (dms_variants' tables cannot hold a conflict); adds each library's counts
as samples `pre` and `post`; and runs `func_scores` by barcode and by `aa_substitutions`,
pseudocount 0.5, natural logarithms, the wild type's barcodes (no codon substitution) summed as the
normalizer. It also writes the table's `variant_counts` in dms_variants' own layout,
`fixtures/barcodes.variant_counts.csv.gz` (gzip with no time stamp, so the same bytes each time).

### What the comparisons showed (wave 2, slice 4)

- **By barcode:** every one of the 4,503 barcodes' scores and variances equals `func_scores` by
  barcode to 4.8 × 10⁻¹³, the barcodes scored on both sides the same: each barcode against its
  replicate's normalizers from the summed counts (the wild type's barcodes summed).
- **By substitution:** each variant's counts summed over its barcodes equal `func_scores`'
  `pre_count` and `post_count` by `aa_substitutions` exactly, and its score and variance to
  4.4 × 10⁻¹³ (1,236 variant measurements; the empty substitution, which dms_variants makes the wild
  type and the synonymous variants together, is not compared).
- **Three ways in:** the counts read with MaveScape's map, in dms_variants' `variant_counts` (made
  one row per barcode) and in Enrich2's layout (a counts file per sample with its unnamed column of
  elements, and a headerless map of whole variant sequences named against the gene) give the same
  barcodes, the same 63 conflicts and the same combined scores to the last bit, summed and by
  barcode.
- **Against the truth:** scored barcode by barcode and combined by REML within each replicate, the
  scores track the true effects (r = 0.990) more closely than the sums (0.977) or the sums without
  the outliers (0.988), and their 95% intervals hold the truth 94% of the time (summed: 91%). Of the
  88 planted outliers in variants with three or more barcodes, 67 are found (76%); 2 of the 3,717
  other barcodes are called (0.05%). Most missed ones are off by 1.5 with few reads.
- Shuffling the rows and columns changes no combined score by a bit: a variant's barcodes are
  combined in the order of their identifiers.

## DiMSum (`reference/dimsum.json`, wave 2 slice 5)

```sh
node validation/fetch.mjs
Rscript validation/reference/generate_dimsum.R
```

(R 4.6.1, data.table 1.18.6, jsonlite 2.0.0.) The generator downloads DiMSum 1.4's release (MIT;
SHA-256 checked) and sources the functions of its counts-to-fitness stage, so the reference is
DiMSum's own code, not a rewriting of it. Each data set goes in as DiMSum's count table would be
after its earlier stages (one row per variant, its number of substitutions, each replicate's input
and output): the two-population fixture (three replicates, with zero counts and dropouts), GRB2's
MaveDB counts (the data DiMSum scored for the Domainome) and DiMSum's own demo (TDP-43, four
replicates of whole sequences, every 8th row). For each it records the input threshold, the
variants fitted, `nlm`'s scales and shifts with its minimum and code, the error model's 100
bootstrap fits (`numCores = 1`, so that it is reproducible), the same `nls` fit given every
variant in order (`sample` replaced by the identity), and `dimsum__calculate_fitness` with its
merge given DiMSum's parameters; for the fixture also with a dropout pseudocount of 1. 370 KB.

### What the comparisons showed (wave 2, slice 5)

- **Given DiMSum's parameters, every number is DiMSum's:** fitness and σ of each variant in each
  replicate within 8 × 10⁻¹³ (6,760 values), merged within 6 × 10⁻¹³, with and without the dropout
  pseudocount and the zero counts left unscored as DiMSum leaves them.
- **The threshold and the variants fitted** are DiMSum's (within 1.5 × 10⁻¹⁶; 193, 602 and 378
  variants), once a count within 10⁻¹² of the threshold counts as above it: the threshold is often a
  ratio of counts, which R's `exp` puts a unit of the last bit below the count (112 on GRB2) and
  JavaScript's above, and DiMSum keeps those variants.
- **The scales and shifts** agree within 4.5 × 10⁻⁷ on GRB2 and the demo. On the fixture `nlm`
  stopped with code 3 at 22.67239435957, short of the minimum, 22.67239435541 (MaveScape's BFGS;
  R's Nelder–Mead from `nlm`'s answer finds it too), and the parameters differ by 2.6 × 10⁻⁴. The
  check: within 5 × 10⁻⁴, at a minimum never above `nlm`'s.
- **The error model** is linear in its terms, so its least-squares fit has one answer: MaveScape's
  exact fit equals DiMSum's `nls` given every variant within 4.3 × 10⁻⁶ (8 × 10⁻⁷ on GRB2), and
  every term lies within the 10th–90th percentiles of DiMSum's 100 bootstrap fits, whose mean is
  what DiMSum reports. (DiMSum calls those percentiles a 90% interval.) GRB2's terms: inputs 20–38,
  outputs 1.7–5.3, the bottleneck before selection that the Domainome reported.
- **GRB2 scored by DiMSum's model** follows the published scores (from the Domainome's run of many
  domains together) with r = 0.994 over 1,108 variants.
- **Coverage:** on a simulated two-population experiment with 25 cells per variant into selection
  (three seeds), DiMSum's 95% intervals hold the true effects 96%, 93% and 95% of the time;
  counting alone with fixed effects 67–69%, with REML 87–88% (τ² sees the replicates' disagreement,
  not the noise they share). The moderated combination (wave 2, slice 9), from the log ratios'
  counting error alone, fits the bottleneck in its shared model: 97%, 95% and 97%.

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
- **BRCA1 E2**: coverage 76% of single substitutions, and 71% of those two or three bases from
  the wild-type codon (so not a library of single-base changes, as an earlier note had it), replicate
  agreement down to r = 0.68, variance 36× counting, and dropouts: about 30% of the variants are
  missing from the last round with no count of 0 anywhere in the table, and those had fallen to
  1–3% of their input a round earlier (others 12–54%).
- **BRCA1 Y2H**: the controls do not separate (AUC 0.37): nonsense variants before residue 61
  score about −3.7, after residue 110 about +0.5. Truncations that keep the RING domain keep
  binding BARD1, so most nonsense variants are not loss-of-function controls in this assay. From
  wave 2, slice 8, the finding finds where (the change point of the stops' scores along the target:
  up to position 93, median −4.37 over 50 stops; after it, 0.81 over 164) and suggests limiting
  the nonsense controls to positions up to 93; limited so, the controls separate (AUC 1.000), and
  with their gap wider the resolution passes too.
- **Factor IX**: scored by the weighted average from wave 2 slice 3. Replicates of each tile agree,
  but differ about 2,000× more than counting predicts (about 10,000 reads per variant per bin far
  exceed the cells sorted, which MaveDB does not record); bin occupancy passes.

Barcoded libraries (wave 2, slice 4; three libraries of a 40-residue protein's codon variants, 3.5
barcodes per variant): clean (no clonal noise, outliers or map problems) raises nothing; clones that
differ (SD 0.5) raise the barcodes' disagreement (φ about 7.8, fail) and the variance between
replicates beyond counting; 12% of barcodes off their variant raise the outlier barcodes (about 6%
found, fail), the barcodes' disagreement (review), replicate agreement and the variance beyond
counting; a map missing a quarter of the barcodes raises the barcodes the map names (fail); one
barcode per variant raises barcodes per variant (fail).

DiMSum's terms (wave 2, slice 5), fitted from the counts alone, place a simulated bottleneck (three
seeds, medians): with N cells per variant before selection and D reads per variant, the input terms
rise to about 1 + D/N (1.73, 5.11 and 10.37 against 2, 5 and 11) while the outputs stay near 1;
with the cells too few after selection, the output terms rise instead (4.29 and 7.66 against 5 and
11). On GRB2 they put the 11× excess at the inputs.

### Findings in context (wave 2, slice 8)

- **Every finding the planted problems raise** (the fixtures above, seed 20261009) names the causes
  that fit it and at least one next step.
- **A selection that enriches loss of function:** the clean two-population experiment with each
  replicate's input and output swapped, so that every score changes sign (three seeds). With the
  readout's direction stated (`higher-less`) the controls separate as in the clean experiment (AUC
  ≥ 0.9, pass). Without it, separation fails, the explanation says the higher score may mean less
  of the function, and the next steps ask for the direction. On the clean experiment no late-stop
  warning is raised.
- **A library of single-base changes:** the two-population fixture's 20 DNA codons, with a table of
  exactly the substitutions one base away from each wild-type codon (122, counted here
  independently with a separate genetic code). Judged against all substitutions coverage fails;
  with the design's library made by error-prone PCR, coverage is judged against those 122 and
  passes at 100%.
- **BRCA1 Y2H** (above): the stops' change point at position 93, and the controls limited to it.

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

## Scale (wave 2, slice 4)

`validation/bench.mjs` (in CI) also simulates a table of a million barcodes (1,004,914 in two
libraries; 33,452 variants of a 1,600-codon gene, 15 barcodes each per library) and its
million-line barcode-to-variant map, writes them (29 and 40 MB), and imports them in a process of
their own as the window does: read in 16 MB parts, decoded as they come, the map applied, the
review of the import wizard. Then it scores them both ways. On an Apple M4 laptop (Node 22.17):

| Step | Time | Memory |
| --- | --- | --- |
| Import (read, map applied, reviewed) | 3.5 s (budget 15 s) | the process at most 830 MB (budget 1 GB); the table and its review then hold 102 MB |
| Scored, barcodes summed | 1.3 s (budget 15 s) | |
| Scored, each barcode then combined by REML | 1.3 s (budget 15 s) | |
| 105,000 variants × 6 samples scored (S12) | 0.5 s (budget 10 s) | |

A table is held column by column, a column of numbers as a Float64Array alone (its text is not
kept): a million rows of a barcode and four counts take about 85 MB once read, where an array of
strings per row and per cell took 500 MB (0.1.0). The map's million variant names are held as one
string per variant.

`node validation/browser-bench.mjs` (in CI, in the `remote` job) measures the same in the window:
MaveScape built from source, driven by remote control in headless Chrome, the files opened together
(served by the hub, read by the csv worker, assembled and reviewed, kept in the library), then
scored both ways. The browser's memory is that of all its processes (the page, its workers, the GPU
and the browser), sampled every 100 ms. On the same laptop (Chrome 154), over two runs:

| Step | Time | The browser's memory |
| --- | --- | --- |
| Import | 3.2–4.3 s (budget 15 s) | +540 to +620 MB at most during it (budget 1 GB); +190 to +280 MB after it |
| Scored, summed and by barcode | 1.5–2.3 s each | +390 to +420 MB after both runs (their results kept for the map and the inspector) |

A worker ends when it has nothing more to do (`web/ui/workers.js`), so what a large table or run
leaves in its memory goes with it; before that, the import held 750 MB after it was done.

## The two-condition fixture (`fixtures/two-condition.*`, wave 2 slice 6)

`node validation/fixtures/make-two-condition.mjs` writes it from the simulator (seed 20261013):
the 40-residue protein's 839 variants, one input per replicate (40 cells per variant transformed)
selected without and with a ligand, the missense variants of positions 12–16 losing about 1.5 with
it; a fourth replicate without the ligand only, whose input no other condition shares. Planted:
`p.Glu5Lys` missing from the ligand's output of replicate 2, `p.Gly4Asp` missing from replicate 1's
shared input, `p.Lys3Arg` missing from every output with the ligand, `p.Leu7Pro` with 0 reads with
the ligand in replicate 3, `p.Thr9Ile` with no input reads in replicate 2. The truth
(`two-condition.truth.csv`) is each variant's effect in each condition and the difference.
Enrich2 scores it as case `two-condition` (`generate_enrich2.py`, run through Enrich2's Python API
so that its comparison of conditions, `calc_pvalues_pairwise`, can be called).

## mutscan (`reference/mutscan.json`, wave 2 slice 6)

```sh
node validation/fetch.mjs
Rscript validation/reference/generate_mutscan.R
```

(R 4.6.1, mutscan 1.2.0, limma 3.68.5, edgeR 4.10.5, from Bioconductor.) mutscan's
`calculateRelativeFC(method = "limma")` on the design ~ Library + Condition (a term for each input
library, the input the baseline for selection in each condition) with the contrast of one
condition's selection less the reference's, the reference rows as `WTrows` (normMethod "sum"): the
fixture relative to its wild type, and CBS (the low- and high-B6 records joined on `hgvs_nt` in the
low-B6 record's order, nonselect1–4 shared, select1–4 of each) relative to its synonymous variants'
summed counts. Rows: those counted in every sample. Kept: every row of the fixture, every 5th of
CBS's and its reference rows. limma is GPL: it is the reference here only, and MaveScape's
`web/lib/limma.js` is written from the publications (Smyth 2004; Law et al. 2014; Cleveland 1979).

### What the comparisons showed (wave 2, slice 6)

- **limma, as mutscan computes it:** on the fixture (836 rows, 11 samples) every log₂ fold change
  and t within 1.8 × 10⁻¹⁰ (largest where the change is near 0), SE, p, adjusted p and the 95%
  interval within 1.2 × 10⁻¹², df.prior equal (11.22); on CBS (9,409 rows, 12 samples, relative
  to 466 synonymous variants) within 4.1 × 10⁻¹¹ and 6.5 × 10⁻¹³, df.prior 9.47. Three of limma's
  conventions were found by experiment against R, not read from its source: voom's lowess span
  is chosen from the number of rows (limma 3.68's `adaptive.span`, 0.65 for 400 rows: 0.5 put the
  trend 2.4% off); variances below 10⁻⁵ of the median count as that when the prior is estimated
  (the wild type's, nearly 0, otherwise moved the prior df from 5.7 to 3.2); and mutscan's library
  sizes are the reference rows' sums scaled to the libraries' geometric mean (edgeR's
  scaleOffset).
- **Enrich2's z between conditions** (|s₁ − s₂|/√(SE₁² + SE₂²), and its normal p) with the
  Enrich2-compatible preset, and each condition's combined scores: within 5 × 10⁻¹³ over 835
  variants, the same variants with none (those not scored in every replicate of a condition) —
  once MaveScape's estimator starts, as Enrich2's does with several conditions, from the variance
  over the variants combined in any condition (it had used the condition's own: 1.5 × 10⁻⁵ apart).
- **Paired, from first principles:** each pair's difference is the log ratio of its two outputs,
  each relative to the wild type's, with the variance of their counts alone: within 10⁻¹⁵.
- **Against the truth** (three seeds, three replicates, 25 cells per variant shared by both
  selections, counting noise only): 95% intervals hold the true difference 93–97% of the time
  paired (combined by the moderated combination, the default since wave 2 slice 9), 98–99% by
  limma, 100% as independent (the shared input counted twice: too wide, median SE 2.7× the
  paired, and 256 of the site's variants found over the three seeds against 269 paired); at most
  0.3% of unchanged variants called at q < 0.05. With noise between replicates (SD 0.1 per
  condition): limma 95–99% and at most 0.4% called; paired 88–99% (a mean of 94.7%; one seed's
  coverage moves with the wild type's own shift, which every variant shares) and at most 2.7%;
  independent 100%. Combined by REML, three pairs gave it little to estimate τ² from: 82–94% and
  1–11% called. Over 40 experiments (`coverage.mjs`), paired 95.0% and limma 96.5%.
- **CBS:** the inputs are 16% of a replicate's counting variance (median); as independent, the
  SEs are a median 1.11× the paired. At q < 0.05: 3,643 variants by limma, 2,417 paired, 1,687
  as independent.

## The record (wave 1, slice 8)

`roundtrip-cases.mjs` builds a workspace as the window does (a table imported, its target and
design, a score run with MaveScape's defaults, a saved selection, a changed QC threshold, all at
fixed times) and writes every export of it. The suite saves it as a `.msz` archive, reads the
archive back, recomputes the run's scores from the archived table (they must have the run's
recorded output hash), saves again and compares the archives and every export byte for byte. It
reads the exported scores back (every score and SE to the last bit, NA where none) and scores the
exported counts again (the run's output hash). Then it damages archives on purpose: an edited
run, a history entry rewritten with the manifest made to match, an altered table, an entry named
`../escape.txt`, a missing file (each reported), and archives from a newer version, without a
manifest, or with an entry that inflates beyond its declared size (each refused).

The GRB2 example's counts (`web/examples/grb2-sh3/counts.csv`) must be MaveDB's file byte for byte
(the SHA-256 in `sources.json`); the simulated example must be the same from its seed, labeled
simulated, its scores within r > 0.98 of the true effects, and pass every QC finding. The
two-condition example's differences must be within r > 0.95 of the true ones (r = 0.966, most
being 0). A two-condition workspace (the fixture, compared by limma) is saved, reopened and
exported again too, its differential export byte for byte.

An acknowledged finding (wave 2, slice 8): GRB2's variance beyond counting acknowledged with a
reason keeps its status (fail) and the overall status; the reason survives the archive and is in
the history, the methods, the QC findings and the provenance; withdrawn, it is gone, and a finding
that passes cannot be acknowledged.

### Archives that keep opening (`archives/`, wave 2 slice 8)

Each release saves a workspace archive that every later MaveScape must open and reproduce.
`archives/grb2-0.1.0.msz` was written by MaveScape 0.1.0's own code, from a v0.1.0 checkout, by
`archives/make-0.1.0.mjs`: the GRB2 example scored with the defaults and the Enrich2-compatible
preset, a saved selection and a changed QC threshold, with the first run's scores. The suite opens
it (every file's SHA-256 as the manifest records, the history's chain unbroken) and recomputes each
run from its recorded inputs. Scoring engine 1 (0.1.0) took its logarithms from the JavaScript
engine. Node's are fdlibm's, as `web/lib/dmath.js`'s are, so here both runs have their recorded
output hashes, and the first run's scores equal the archived ones exactly. A 0.1.0 run scored in
another browser would differ in its last digits and say so (`reproduction` in `web/lib/runs.js`).
The reopened workspace keeps its threshold and selection and makes every export and the methods.

`archives/release-0.2.0.msz` was written by MaveScape 0.2.0's own code by
`archives/make-0.2.0.mjs` (`node validation/archives/make-0.2.0.mjs <v0.2.0 checkout> <out>
<commit>`), and holds every kind of source and run 0.2 brought, each with its scores: the barcode
fixture with its barcode-to-variant map (each barcode scored and combined), the sort-seq fixture
(sorted bins), the two-condition fixture (limma), the Hsp90 example (its codon variants read at the
protein level, scored per generation from one replicate), and the GRB2 example scored with DiMSum's
model and with the defaults (the moderated combination, each score's degrees of freedom), with a
selection, a changed threshold and an acknowledged finding. The suite assembles each run's source
from the archive's files as the window does, and every run has its recorded output hash and its
archived scores exactly; `mavescape run --from-workspace` reruns them in a window to the same
hashes.

