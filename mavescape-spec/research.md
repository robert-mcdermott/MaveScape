# MaveScape: methods, data and standards research

*Research date: 2026-10-08. Background for the design of MaveScape. MaveDB facts were checked
live against its API (OpenAPI version 2026.2.7.4), and formulas against the reference tools'
current source code.*

**Conventions**
- **(unverified)** marks a claim that could not be confirmed from a primary source.
- **(code)** marks behavior read from a tool's source code, not its documentation.

## 0. Summary

1. **There is no file-format standard for DMS counts** like FCS is for cytometry. What exists:
   - MaveDB's CSV conventions, the closest thing to a community standard;
   - MAVE-HGVS for variant identifiers;
   - the MAVE minimum-information metadata (Claussnitzer et al. 2024);
   - GA4GH VRS and VA-Spec for mapped variants and annotations.

   MaveScape therefore imports any per-variant table through a mapping wizard, with built-in
   templates for MaveDB, DiMSum, dms_variants and Enrich2 layouts. MaveDB is one source, not a
   requirement.
2. **Enrich2 is maintained again** (2.0.2: Python 3, BSD-3, pip). It is the CI reference for
   ratio, regression and replicate combination. Its quirks must be reproduced in an explicit
   compatible mode, not by default (§2.1).
3. **MAVE-HGVS has no JavaScript implementation.** The Python package's regular-expression
   grammar (BSD-3) ports directly. Legacy MaveDB data break the spec, so a lenient mode is needed
   (§1.3).
4. **CC0 data sets with counts** are available on MaveDB for every design except barcode-level
   counts (§3), so the examples can be real published data, with simulated data only where
   nothing suitable exists.
5. **Calibration guidance moved:** ClinGen retired its SVI working group in April 2025. MaveDB now
   publishes calibrations (OddsPath, likelihood ratios) with a research-use flag (§4).

## 1. Data formats and standards

### 1.1 MaveDB API

Base URL `https://api.mavedb.org/api/v1/`. Spec at `https://api.mavedb.org/openapi.json`.

**Access**
- Public reads need no authentication.
- There is no rate limit (issue #669).
- CORS is open. MaveScape still goes through its host, for the cache, offline mode and its CSP.
- CSV endpoints sometimes return **504 after about 10 s** and succeed on retry, so use backoff
  and paging (`start`, `limit`).

**Endpoints**

| Purpose | Endpoint |
| --- | --- |
| Metadata | `GET /score-sets/{urn}`: title, method and abstract text, license, DOIs, publications, `targetGenes`, `datasetColumns{scoreColumns,countColumns}`, `scoreCalibrations`, experiment, mapping state |
| Data | `GET /score-sets/{urn}/scores`, `GET /score-sets/{urn}/counts` (CSV) |
| Combined data | `GET /score-sets/{urn}/variants/data?namespaces=…`: `scores`, `counts`, `mavedb`, `vep`, `gnomad`, `clingen`, `clinvar.YYYY_MM`, … (`/csv-namespaces` lists a set's namespaces) |
| Mapped variants | `GET /score-sets/{urn}/mapped-variants`: VRS 2.0 alleles, ClinGen allele IDs. Superseded mappings are included; filter on `current: true`. |
| Calibrations | `GET /score-calibrations/score-set/{urn}`: functional classes (`normal`, `abnormal`, `not_specified`), ranges, OddsPath, likelihood ratios, ACMG evidence strength, `researchUseOnly` |
| Search | `POST /score-sets/search` (text, targets, organisms, accessions, authors, keywords…). `limit` is at most 100. The response is `{scoreSets, numScoreSets}`. Hits omit `datasetColumns`, so finding which sets have counts takes one GET per set. |

**Identifiers and targets**
- URNs: `urn:mavedb:00000003` (experiment set), `-a` (experiment), `-a-1` (score set), `#N`
  (variant). `tmp:` marks unpublished records.
- A target is either a sequence (`dna` or `protein`) or an accession (for example
  `NM_007294.3`).
- `externalIdentifiers` (UniProt, RefSeq, Ensembl) carry an **offset**: target-relative positions
  plus the offset give reference positions.
- Accession targets need fully qualified variants. Multi-target sets need label prefixes.

**CSV conventions**
- Downloads begin `accession, hgvs_nt, hgvs_splice, hgvs_pro`, then data columns.
- Missing values are written `NA`.
- Counts are written as floats (`3232.0`).
- Lines end in CRLF; no field is quoted (seen in every file of the feasibility data, 2026-10-08).
- The files are byte-identical from one request to the next, so they can be checksummed.
- An upload needs `hgvs_nt` or `hgvs_pro` and a `score` column. The counts file must have the same
  variants and index.
- Other column names are free, and described in column-metadata JSON
  (`{col: {description, details}}`).
- MaveDB counts are always per variant, never per barcode.

**A MaveDB-ready package**
- Experiment JSON: title, short description, abstract, method text; optional keywords,
  publications, raw-read identifiers.
- Score-set JSON: the same, plus target genes and license id.
- Scores CSV, optional counts CSV, column metadata.
- The `mavedb` PyPI package's models validate these locally. That is the conformance reference;
  MaveDB's `POST /hgvs/validate` is not used, because unpublished data stay local.

**Licenses** (counts of published sets)

| License | Sets | Notes |
| --- | --- | --- |
| CC0 | 2,745 | default |
| CC BY 4.0 | 60 | |
| CC BY-SA 4.0 | 11 | |
| CC BY-NC-SA 4.0 | 7 | legacy |
| "other" | — | |

The quarterly Zenodo archive (doi:10.5281/zenodo.11201736) holds the CC0 sets.

**Variant mapping**
- Arbesfeld et al. 2025 (doi:10.1186/s13059-025-03647-x): BLAT to GRCh38, MANE transcript, then
  VRS.
- Human targets only.

### 1.2 MAVE minimum information and related standards

- **Claussnitzer et al. 2024** (*Genome Biol*, doi:10.1186/s13059-024-03223-9): minimum
  information for MAVEs, with a controlled vocabulary. MaveScape's design and methods export should
  fill it (wave 5).
- **Atlas of Variant Effects** (Fowler et al. 2023, doi:10.1186/s13059-023-02986-x).
- **MaveDB papers:** Esposito 2019 (doi:10.1186/s13059-019-1845-6); MaveDB 2024 (Rubin 2025,
  doi:10.1186/s13059-025-03476-y).
- **GA4GH VRS 2.0 and VA-Spec:** the formats of MaveDB's mapped variants and annotations.

### 1.3 MAVE-HGVS

- **Package:** `mavehgvs` 0.8.1 (2026-09-22), BSD-3, pure regular expressions. Spec source:
  `docs/spec.rst` in VariantEffect/mavehgvs. The readthedocs site is gone; the docs are now at
  mavedb.org/docs/mavehgvs.
- **There is no JavaScript implementation.**
- **Porting:** convert `(?P<name>…)` groups to `(?<name>…)`; there are no backreferences. Keep the
  BSD notice.
- **Grammar:**
  - Prefixes `c g m n o p r`, with an optional `target:` prefix.
  - `c.` allows intronic offsets and UTR positions (`c.-12`, `c.*33`).
  - DNA is uppercase ACGT; RNA is lowercase acgu.
  - Protein uses three-letter codes and `Ter`. **One-letter codes and `*` are not allowed.**
  - Substitution, deletion (no sequence after `del`), duplication, insertion (full sequence,
    adjacent positions), delins.
  - Frameshift only as the short `p.Glu27fs`.
  - Equality: `c.=`, `p.=`, `c.22=`, `p.Cys22=` (synonymous), `p.(=)` (synonymous at protein
    level only).
  - Multi-variants `p.[A;B]` with one prefix, components sorted and not overlapping, at most one
    `fs` (last).
- **Not allowed:** predicted forms in parentheses, extensions, inversions, uncertain breakpoints,
  ambiguity codes, long frameshift forms.
- **Legacy data break the spec**, for example:
  - `p.[Glu32Val;Glu32Val;Val265Phe]` and `p.[Pro61Leu;=]` (00000003-a-1);
  - `c.[1C>A;2=;3=]` (00000011-a-1);
  - `_wt` as `hgvs_pro` (00000052-b-1).

  Hence a lenient mode that normalizes and keeps the original string.

## 2. Scoring methods

All logarithms are natural unless stated. Normalized scores have WT = 0 unless stated.

### 2.1 Enrich2 (Rubin et al. 2017, doi:10.1186/s13059-017-1272-5)

**Status**
- 2.0.0 (January 2025) moved to Python 3; 2.0.2 (March 2025); `pip install enrich2`. Needs
  PyTables.
- The license changed from GPLv3 to BSD-3 at 2.0. Use 1.2.0 or later: an erratum fixed overstated
  replicate SEs.

**Feeding it count tables**
- Use ID-only SeqLibs with a "counts file". The header must be `count`, not `counts` as the
  documentation says (issue #77).
- A `_wt` row turns on WT normalization.

**Ratio** (input and last time point). Each count gets +0.5. Let r_t be the normalizer:

| Mode | r_t |
| --- | --- |
| `wt` | c_wt,t + 0.5 |
| `complete` | (sum over variants present at every time point) + 0.5 |
| `full` | (sum of all unfiltered counts) + 0.5 |

- score = [ln(c_T + 0.5) − ln r_T] − [ln(c_0 + 0.5) − ln r_0]
- SE² = 1/(c_0 + 0.5) + 1/(c_T + 0.5) + 1/r_0 + 1/r_T
- The single 0.5 added to the library-size sums is a known quirk (issue #75; PR #76 is unmerged).
  Match the code.

**Weighted regression** (at least 3 time points)
- y_t = ln(c_t + 0.5) − ln r_t
- w_t = 1/(1/(c_t + 0.5) + 1/r_t)
- x_t = t/max t
- Fit y = a + b·x by WLS with an intercept; the score is b.
- SE(b) = sqrt([Σw·e²/(n − 2)] / Σw·(x − x̄_w)²), scaled by the residuals (statsmodels `bse`).
- OLS is the same with w = 1. P-values use a t distribution in the code (z in the paper).

**Filtering (code)**
- A variant absent from any time point's table becomes NaN and is dropped.
- An explicit 0 is kept and scores from ln 0.5.

**Random-effects combination** (`enrich2/random_effects.py`)
- Start: τ² = Σ(y_i − ȳ)²/(**V** − 1), where V is the number of *variants*, not replicates. This
  is a bug.
- Then **exactly 50** iterations:
  - w_i = 1/(s_i² + τ²)
  - β = Σw_i·y_i / Σw_i
  - τ² ← τ²·Σw_i²(y_i − β)² / (Σw_i − Σw_i²/Σw_i)
- SE = sqrt(1/Σ 1/(s_i² + τ²)).
- The fixed point is the REML condition, so converged cases equal `metafor::rma(method = "REML")`.
- A start at τ² = 0 stays at 0.
- s_i = 0 gives infinite weights.
- One replicate passes through unchanged; in `wt` mode WT is forced to 0 ± 0.

MaveScape's REML runs to convergence. An "Enrich2-compatible" option reproduces the code exactly.

**Confirmed on real data (wave 1, slice 2).** Every formula above, computed independently, equals
Enrich2 2.0.2 to 5 × 10⁻¹³ on the feasibility data: ratios with the three normalizations, WLS and
OLS (including non-uniform times), and the random-effects combination with its starting value.
Enrich2 2.0.2 also reproduces the BRCA1 replicate scores published in 2017 (WLS, wild-type
normalization) to 5 × 10⁻¹³; the published combined scores agree where the 50 iterations
converged and differ by up to 0.034 where they had not, as the starting value predicts. Details in
`validation/README.md`.

**Comparisons**
- Between conditions: z = |β₁ − β₂|/sqrt(SE₁² + SE₂²), uncorrected.
- Issue #59 reports that multi-condition configurations give identical scores (unconfirmed).

### 2.2 DiMSum (Faure et al. 2020, doi:10.1186/s13059-020-02091-3)

**Status and input**
- 1.4 (April 2025), MIT, bioconda `r-dimsum`.
- `countPath` runs only the counts-to-fitness stages.
- Count table: `nt_seq` (ACGT, unique) plus one integer column per sample. WT is matched to
  `wildtypeSequence`.

**Fitness for replicate r**
- f = ln(N_out/N_in) − ln(N_out,wt/N_in,wt), with no pseudocount.
- Non-finite values become NA.
- `fitnessDropoutPseudocount` replaces a zero output when the input is above 0.
- `…All` filters drop the variant; `…Any` filters set that replicate to NA.

**Normalizing replicates**
- A scale a_r and shift b_r per replicate, fitted by `nlm` to agree across replicates.
- f′ = (f + b_r)·a_r − c, where c is the mean WT fitness.

**Error model**
- σ² = a_r·(m_in/N_in + m_out/N_out) + e_r, with m ≥ 1 and e ≥ 1e-4.
- Fitted by `nls` on replicate subsets, averaged over 100 bootstraps.
- The seed is fixed per worker, so use `numCores = 1` for reproducibility.
- Without the error model: σ² is the sum of the four reciprocal counts.

**Merging and output**
- Merge by inverse variance (fixed effects), skipping NA.
- Synonymous nucleotide variants are merged into amino-acid variants.
- With generations, f and σ are divided by g·ln 2.

**For CI**
- Call `dimsum__calculate_fitness` and `dimsum__merge_fitness` with fixed parameters for exact
  tests.
- `normalisationmodel.txt` is rounded to 4 decimals, so compare the fitted parameters loosely.

### 2.3 Other references

| Tool | License | Use |
| --- | --- | --- |
| dms_variants `func_scores` (Bloom lab, 1.6.0) | GPLv3 | Cross-check of the ratio in WT mode (its score = Enrich2's ÷ ln 2; pseudocount 0.5, log base 2; per barcode or summed by substitution). External reference only, never ported. |
| mutscan (Bioconductor) | MIT | `calculateFitnessScore` (Diss & Lehner; divides by mean WT); `calculateRelativeFC` (limma-voom or edgeR quasi-likelihood contrasts on a design matrix). limma is the reference for differential scores. |
| Rosace 1.1.0 | MIT | Bayesian time series (cmdstan): statistical agreement only. Its `runSLR` is a deterministic OLS check. |
| CountESS 0.1.27 | BSD-3 | A Python 3 reimplementation of Enrich2 plus a VAMP-seq plugin. Its random effects starts at k − 1 and stops early, so it differs from Enrich2 where Enrich2 has not converged. A second opinion. |
| dms_tools2 2.6.12 | GPLv3 | Differential selection; old environment; low priority. |

### 2.4 Bins

**VAMP-seq** (Matreyek et al. 2018, doi:10.1038/s41588-018-0122-z)
- Bin frequency F_v,b = c_v,b/Σ_u c_u,b.
- Drop variants whose total frequency is below 10^−4.75.
- W_v = Σ_b w_b·F_v,b / Σ_b F_v,b, with w = 0.25, 0.5, 0.75, 1.
- Score = (W_v − median W of nonsense) / (W_wt − median W of nonsense), so nonsense = 0 and
  WT = 1.
- Keep variants seen in at least 2 replicates; combine by the mean of replicates, SE = sd/√n.

**Maximum likelihood** (Peterman & Levine 2016, doi:10.1186/s12864-016-2533-5)
- log L = Σ_j r_j·ln[Φ((ln U_j − μ)/σ) − Φ((ln L_j − μ)/σ)], with open outer bins.
- An optional contamination term γ.
- Mean = exp(μ + σ²/2).
- Reads are reweighted by cells sorted per bin.
- Biased when σ is small against the bin width.
- Reference: `fitdistrplus::fitdistcens` (as in the Bloom lab's RBD pipeline).

### 2.5 Barcodes

- Two approaches:
  - sum barcode counts per variant, then score (Enrich2's variant level, DiMSum, dms_variants by
    substitution);
  - score each barcode, then combine (Enrich2's barcode level, dms_variants by barcode, Bloom-lab
    means above a minimum count).
- Implement both; the second reuses the replicate-combination code.

### 2.6 Differential scores

- The simple Δ = s₁ − s₂ with SE = sqrt(SE₁² + SE₂²) **overstates** the SE when the conditions
  share an input sample. The shared terms (1/c_in + 1/r_in) cancel in the difference, so the
  differential SE should leave them out.
- limma contrasts on log counts (mutscan) handle the general case.

## 3. Datasets

**Survey method**
- 2,800 of MaveDB's 2,823 published score sets were checked. 636 carry counts: 521 of them
  Domainome sets, and all CC0 except 15 CC BY 4.0 sets.
- No set carries barcode-level counts.

| # | Data set (URN) | Design | Size | Structure | Use in this plan |
| --- | --- | --- | --- | --- | --- |
| 1 | GRB2 SH3, Domainome (Beltran 2025; `00000835-a-1`) | two populations × 3 replicates; DiMSum | 1,121 variants; 56 aa; P62993, offset 158 | 2VWF | feasibility; example (wave 1) |
| 2 | BRCA1 RING (Starita 2015, scored by Enrich2; `00000003-a-1` nt, `-a-2` aa) | 2 libraries × 3 replicates × rounds 0–5, each library's input shared by its replicates; the same table holds a Y2H assay (2 × 3 × 4 non-uniform times) | 20,724 nt / 12,316 aa variants; 303 codons (UniProt P38398 offset 1; codon 174 R where UniProt has K) | 1JM7 | feasibility; MaveDB round trip (wave 3); legacy HGVS |
| 3 | Factor IX MultiSTEP (Popp 2025; `00001200-a-1`…`-e-1`) | 4 FACS bins × 3 tiles (1–164, 146–318, 299–461: overlapping) × 3 replicates; 5 readouts; scores set the lowest 5% of missense to 0 | 9,682 variants; 461 aa | 1RFN | feasibility; FACS example (wave 2) |
| 4 | Hsp90 (Hietpas 2011; `00000011-a-1`) | 8 generations | 568 variants; 9 aa; P02829 | 2CG9 | time-series example (wave 2) |
| 5 | DHFR (Thompson 2020; `00000063-a-1`, `-b-1`) | time series × 6 repeats × Lon protease functional / deficient | ~3,100 variants each; 159 aa | 1RX2 | two-condition example (wave 3) |
| 6 | PSD95 PDZ3 (`00000053-a-2`, doubles `-a-1`) | two populations × 6 replicates | 1,235 singles; 648,022 doubles | 1BE9 | scale test (doubles); unpublished, replicate structure undocumented |
| 7 | Gcn4 activation domain (Staller 2018; `00000052-b-1`) | sort-seq, 8 bins × 3 conditions | 6,500 variants; 44 aa | disordered | backup FACS set; `_wt` legacy HGVS |
| 8 | CBS (Sun 2020; `00000005-a-5`, `-a-6`) | select / non-select × 4 replicates; two vitamin B6 conditions | ~11,000 variants each | 4COO | backup two-condition set |
| 9 | TEM-1 (Firnberg 2014; `00000070-a-3`/`-a-4`) | 13 ampicillin concentrations | 5,740 aa variants | 1BTL | bin-like stress test |
| 10 | BRCA1 SGE (Findlay 2018; `00000097-0-2`) | accession target, library / day 5 / day 11 | 3,893 SNVs | — | future (saturation genome editing) |

**Barcode data**
- The only public barcode data are Enrich2-Example (FowlerLab; CC BY-SA 4.0). Its ShareAlike
  term should not be bundled into an Apache-2.0 binary, but it can be used as an external
  validation fixture, fetched by `validation/fetch.mjs`.
- The bundled barcode example is simulated and labeled so.
- DiMSum's demo `countFile_Toy.txt` (TDP-43, MIT) is a valid DiMSum-format fixture.

**Scores only on MaveDB** (no counts): GB1 (Olson 2014), VAMP-seq PTEN/TPMT, Gal4, Mighell PTEN,
Weile 2017.
- These are usable for the score-import path and comparisons.
- The VAMP-seq scores on GitHub carry a non-commercial license that conflicts with MaveDB's CC0;
  use MaveDB's copy.

## 4. Calibration (research use)

| Reference | What it gives MaveScape |
| --- | --- |
| Brnich et al. 2019 (*Genome Med*, doi:10.1186/s13073-019-0690-2) | The OddsPath framework for PS3/BS3. Thresholds to re-check against the paper before use **(unverified)**: PS3 Supporting > 2.1, Moderate > 4.3, Strong > 18.7, Very Strong > 350; BS3 Supporting < 0.48, Moderate < 0.23, Strong < 0.053; at least 11 controls for Moderate without formal statistics. |
| Tavtigian 2018 and 2020 | The Bayesian points scale behind evidence strengths. |
| Pejaver et al. 2022 (*AJHG*, doi:10.1016/j.ajhg.2022.10.013) | Local posterior calibration; the template for score-level calibration. |
| Fayer et al. 2021 (*AJHG*, doi:10.1016/j.ajhg.2021.11.001) | Calibrated MAVE data for BRCA1, TP53 and PTEN: results to reproduce. |
| van Loggerenberg et al. 2023 (*AJHG*, doi:10.1016/j.ajhg.2023.08.012) | Log-likelihood ratios. maveLLR is GPL-3, so external reference only. |
| acmgscaler (Badonyi 2025, *Bioinformatics*, MIT) | Gene-level calibration; a CI reference. |
| Zeiberg et al., ExCALIBR (bioRxiv 2025, revised 2026) | Still a preprint; watch. |
| MaveMD (McEwen et al. 2026, *Genome Med*) | MaveDB's clinical interface exposing calibrations. |

ClinGen retired the SVI working group in April 2025. Its guidance has no MAVE-specific document.

## 5. QC metrics

**Coverage**
- Input reads per variant: median, and the fraction with at least 10 reads.
- The fraction of designed variants observed.

**Bottlenecks**
- DiMSum's multiplicative error terms: m ≈ 1 is counting noise. GRB2's input value of about 6 was
  read as an input bottleneck.
- Aim for a 5–10× excess of molecules at every step.
- Count-distribution shapes: a low-count peak shared by inputs points to the library; one specific
  to a replicate points to that replicate; a mismatch between input and output points to
  extraction.
- An easy check: synonymous log-ratio variance against its Poisson expectation.
- "Effective molecules ≈ reads/m" is an interpretation **(unverified)**.

**Replicates**
- Pearson r of replicate scores above an input-count filter.
- Leave-one-out z = (f̄_others − f_j)/sqrt(σ̄²_others + σ_j²) should be about N(0, 1).

**Controls**
- Synonymous against nonsense distributions; the synonymous 5th percentile as a class threshold
  (VAMP-seq).
- There is no single standard separation statistic, so report several (overlap, AUC, the
  standardized median difference).

**Normalization conventions differ**

| Convention | Used by |
| --- | --- |
| WT = 0 | Enrich2, DiMSum, dms_variants |
| nonsense = 0, WT = 1 | VAMP-seq |
| synonymous and nonsense median "pivots" | TileSeqMave |
| synonymous median = 0 (log2) | Findlay 2018 SGE; nonsense median about −2.1 there, not −1 |

Rescaling s′ = (s − m₀)/(m₁ − m₀), SE′ = SE/|m₁ − m₀| ignores the medians' own uncertainty.
MaveScape should say so where it applies it.

## 6. The sibling applications

- **CytoWeave 0.8.0:** see `design.md` for what is copied.
  - The host, security, library, window, connection file, remote control, MCP framework, headless
    runs (hidden Chrome driven through the remote-control hub), CI, release, installers,
    validation harness, docs capture and client generator all carry over with renames.
  - CytoWeave makes no network requests of its own, so the fetch layer comes from Proteoscope.
  - CytoWeave hardcodes its version and does not embed the build commit; the PRD asks for the
    commit in methods, so MaveScape adds `-ldflags -X`.
- **Proteoscope 0.10.0:**
  - `cache.go` and the download, limit, serve and gzip-guard parts of `fetch.go` can be reused.
    Hosts are spread over a base-URL table and a model-host list, so MaveScape gathers them into
    one list and adds retrieval time and ETag (Proteoscope relies on file times).
  - Proteoscope's API refuses cross-origin requests, so MaveScape's host must relay.
  - It writes no connection file. It has a "Custom residue data" coloring with color maps and a
    legend, but **no way for another program to load values into it**. Its commands can open
    structures (`#fetch=`), select residues (`/A:315`, `uniprot 175`) and color selections with
    hex colors.
  - Default port 8765, with fallback to 8814.

## 7. To verify before relying on it

- **MaveDB API:** the docs and the live API differ on the search response shape and on license
  headers in CSV downloads (none seen in API CSVs).
- **Brnich thresholds:** to check against the paper (wave 7).
- **Enrich2 issue #59** (multi-condition scores): unconfirmed. Test it before using Enrich2 as the
  differential reference.
- **Findlay SGE HGVS format:** not inspected.
- **GB1 supplement license:** unclear.
- **PDZ3 00000053:** unpublished; replicate structure undocumented.
