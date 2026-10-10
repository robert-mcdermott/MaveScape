# File formats

Every file MaveScape 0.1 and 0.2 read and write. Researchers whose counts come from their own pipeline
need only a count table, the target's sequence, and the design: which column is which sample.
Blank, annotated layouts of each are on the Start page and in
[`web/examples/layouts/`](../web/examples/layouts/). The Start page also opens two worked examples.

| Kind | Read | Written |
| --- | --- | --- |
| Count tables | CSV, TSV, TXT, gzip of these; one table or one file per sample; tables of barcodes with their barcode-to-variant maps; dms_variants' `variant_counts`; Enrich2's counts files and barcode maps | the counts a run scored (CSV); a barcode table's barcodes, one by one (CSV) |
| Score tables | MaveDB's score layout, recognized at import (shown on the map from 0.3) | a run's scores (CSV) |
| Targets | FASTA, DNA or protein, one or several records | (in the workspace and its archive) |
| Designs | `*.design.json`; sample sheets (CSV, TSV); DiMSum's experiment design file | `*.design.json` |
| Import templates | `*.import.json` | `*.import.json` |
| Workspaces | `*.msz` archives | `*.msz` archives; the workspace document (JSON) |
| Results | | QC per sample and per variant (CSV), selections (CSV, JSON), provenance (JSON), methods (Markdown) and references (BibTeX), the map (SVG, PNG) |
| Remote control | actions as JSON (`/api/remote/action`) | `remote.json` in the data folder: the address and token scripts use |

Coming later: Excel workbooks and GenBank files (0.3), structures (0.5).

## Count tables

One row per variant, one column per sequenced sample, a header row:

```csv
hgvs_pro,input_rep1,output_rep1,input_rep2,output_rep2
p.=,52011,61873,48320,57112
p.Ser2Val,812,640,775,591
p.Ser2Ter,905,12,880,9
p.Lys3Pro,488,NA,502,33
```

- **Variant names** are MAVE-HGVS (MaveDB's nomenclature, as the `mavehgvs` package defines it):
  `p.Ala12Val`, `p.Ala12Ter`, `p.Ala12=` (synonymous), `p.=` (the wild type),
  `p.[Ala12Val;Lys14Arg]`; at the nucleotide level `c.34C>T`, `c.=`. Lenient reading (the default)
  also takes common lab and legacy forms and writes each in MAVE-HGVS beside the original:
  `A12V`, `p.A12V`, `p.Ala12*`, `_wt`, `_sy`, components repeated or out of order. Strict reading
  takes the specification only. Every name is checked against the target; a name that disagrees
  (another residue at that position, a position beyond the target) is not scored, and says why.
- **Counts** are numbers of reads. An empty cell or `NA` (also `N/A`, `NaN`, `nan`, `null`,
  `NULL`, `None`) is **missing**, never 0: the variant was not counted in that sample, and is not
  scored in that replicate. Write 0 only for a variant counted zero times. Counts written as
  decimals (`123.0`, as MaveDB writes them) are read; fractions are warned about.
- **Columns** are recognized by name: `hgvs_pro`, `hgvs_nt`, `hgvs_splice`, MaveDB's `accession`;
  any column whose cells read as variant names. Sample columns named for their role are given
  suggested roles (`input`, `pre`, `lib`; `output`, `post`, `sel`; `rep1`; `t0`, `_c_0`, `gen3`;
  `bin1`; `tile2`), which you confirm in the Experiment view.
- **Reading**: UTF-8 (with or without a byte-order mark), UTF-16 with a mark, else Windows-1252
  (said when used); comma, tab, semicolon or `|` as the delimiter, detected; quotes as in RFC 4180;
  CRLF, LF or CR line ends; leading lines starting with `#` skipped; `.gz` decompressed. Large
  files are read in a worker in 16 MB parts.
- **Blocking problems**, listed by line: the same variant on two rows (however it is written),
  counts that are not numbers or are negative, rows of the wrong width. Nothing is coerced
  silently.

Layouts recognized:

| Layout | How it is recognized |
| --- | --- |
| MaveDB count table | `accession` (MaveDB's downloads) or all of `hgvs_nt`, `hgvs_splice`, `hgvs_pro` (its upload layout, and MaveScape's exports), with sample columns. Indexed by `hgvs_nt` when every row has one |
| MaveDB score table | the same identifier columns and `score` |
| DiMSum | a `nt_seq` column of whole nucleotide sequences, named by comparing each with the wild type you give |
| Generic | any column of variant names and numeric columns |
| One file per sample | several files opened together, each a variant column and a count column; joined on the variants. A variant absent from one file is missing there (or 0, if you say so) |
| A table of barcodes | a column of barcodes (named `barcode`, `bc`, `tag`…, or DNA of one length, six bases or more) and the variant each carries, in a column of its own or from a barcode-to-variant map opened with it (below) |
| dms_variants' variant counts | `library`, `sample`, `barcode`, `count` and `aa_substitutions` or `codon_substitutions` (its `variant_counts` CSV) |
| Enrich2's counts files | two columns, the elements (Enrich2 leaves their column unnamed) and `count`; one file per sample, joined. Elements that are variants are named in MAVE-HGVS; barcodes need Enrich2's barcode map |

Large tables are held column by column, a column of numbers as numbers only: a million rows of
counts and barcodes take about 100 MB once read (MaveScape 0.2; `validation/bench.mjs` checks a
million-row table and its map imported in under 15 s and 1 GB).

## Tables of barcodes

In a barcoded library each variant is carried by several random barcodes, and a table of counts
has one row per barcode. MaveScape 0.2 reads it with the barcode-to-variant map that names each
barcode's variant, opened with it:

```csv
barcode,pre_rep1,post_rep1,pre_rep2,post_rep2
ACACAATAGACTCCGA,253,40,NA,NA
ATACCCAGCCCCGCCA,167,27,NA,NA
GGCTCGAGCAACTTTG,NA,NA,187,38
```

```csv
barcode,hgvs_pro
ACACAATAGACTCCGA,p.Glu6Asp
ATACCCAGCCCCGCCA,p.Glu6Asp
GGCTCGAGCAACTTTG,p.Glu6Asp
```

- **The map** is a table with a column of barcodes and a column of variants, and no counts: MAVE-HGVS
  or lab names; dms_variants' `aa_substitutions` (`A2V K3*`, with `codon_substitutions` naming
  synonymous changes by codon) or `codon_substitutions` (`GCT2GTT`); or whole variant sequences,
  named against the target's DNA (Enrich2's barcode map: two columns, `barcode sequence`, no
  header). Its columns can be chosen in the import wizard.
- **A barcode the map gives two different variants** is in conflict and left unmapped, with the
  others the map does not name: listed at import, counted by quality control, never scored.
- **A barcode in one library only** is missing (not 0) in the other libraries' samples: write its
  other columns empty or `NA`, or let dms_variants' layout say it.
- **The same barcode on two rows** blocks scoring; a variant written in two ways across its barcodes
  (`A12V`, `p.Ala12Val`) is one variant.
- The design names the column of barcodes: `library: { "level": "barcode", "barcodeColumn":
  "barcode" }`. The source keeps the counts and the map, and how they were put together.

dms_variants' `variant_counts` (one row per library, sample and barcode) is made one row per library
and barcode, with a column of counts per library and sample, `pre (lib1)`; a barcode in two
libraries is written `lib1/ACGT…`. Enrich2's counts files of barcodes are joined on the barcodes.


## Targets: FASTA

```fasta
>my-target My protein, construct residues 1-60 (UniProt P00000 residues 101-160)
MSKGEELFTGVVPILVELDGDVNGHKFSVSGEGEGDATYGKLTLKFICTTGKLPVPWPTL
```

Protein or DNA (detected). For DNA named at the protein level, the coding start can be set (the
first base of the first codon). Positions are numbered from 1 on the target; the **offset** (set in
the Experiment view) numbers them on the reference too (an offset of 100 makes position 1 residue
101), and the map shows both. UniProt and gene identifiers can be recorded with the target.

## Designs

### Sample sheets

One row per sequenced sample, matched to the count table's columns:

```csv
column,role,replicate,technical_replicate,condition,time,bin,value,tile
input_rep1,input,1,1,,,,,
output_rep1,output,1,1,,,,,
input_rep2,input,2,1,,,,,
output_rep2,output,2,1,,,,,
```

| Column (other names read) | Meaning |
| --- | --- |
| `column` (`count_column`, `sample_name`, `sample`, `name`, `file`) | the count table's column |
| `role` (`type`, `sample_type`, `selection_id`, `selection`) | `input` (`pre`, `before`, `library`, `0`), `output` (`post`, `after`, `selected`, `1`), `timepoint`, `bin` |
| `replicate` (`rep`, `biological_replicate`, `experiment_replicate`) | the biological replicate's number; a sample shared by several replicates lists them, `1;2;3`, or is left empty (shared by every replicate of its condition and tile) |
| `technical_replicate` (`technical`, `tech_rep`) | 1, 2, … for one library sequenced more than once: summed |
| `time` (`timepoint`, `generation`, `round`, `day`, `hours`) | a time point's time; the unit is taken from the column's name |
| `bin` and `value` (`weight`, `fluorescence`) | a sorted bin's order and its value |
| `condition` | the condition's name; a sample selected under several conditions lists them, `Without ligand;With ligand` (MaveScape 0.2) |
| `cells` | the cells sorted into a bin, or carried into selection from an input (recovered after it, for an output) |
| `tile`, `batch` (`library`, `lane`) | optional |

DiMSum's experiment design file (`sample_name`, `experiment_replicate`, `selection_id`, …) reads as a
sample sheet. The analysis package (below) writes a design back as a sheet, one row per column of
counts (its `cells` on a sample's first column), with the time column named by the unit
(`generation`, `round`, `day`, `hours`, else `time`); read again, it gives the same design. The
gates, the readout, the controls and the target are the design file's alone.

### `*.design.json`

The design as data: format `mavescape-design`, version 1, described by
[`docs/schemas/design.v1.json`](schemas/design.v1.json): the model (`two-population`,
`time-series`, `bins`, `scores`), the variant column and level, the targets, the samples (each with
its columns: several are technical replicates, summed), the replicates (each naming its samples:
input and output, time points, or bins; its biological number, condition and tile), conditions,
tiles, controls, and `ignoredColumns` (every other column of the table, with the reason, or the
column it copies). For a table of barcodes, `library.level` is `barcode` and `library.barcodeColumn`
names the column of barcodes (MaveScape 0.2). A sample's `missingMeansZero: true` reads its missing counts as 0, for tables
that write variants that dropped out during selection as missing (MaveScape 0.2; "Missing = 0" in
the Experiment view; warned about on a replicate's first sample). For sorted bins, each bin of a replicate
may give its gates on the reporter, `lower` and `upper` (fluorescence; the lowest bin's lower and
the highest bin's upper left open), and each sample the `cells` sorted into it: with the gates the
bins can be scored by maximum likelihood, whose reads are reweighted by the cells (MaveScape 0.2). For two populations, an input's
`cells` are those carried into selection from it, and an output's those recovered after it: quality
control checks the bottleneck it infers against them (MaveScape 0.2). Written by the Experiment view; the validation designs are examples
([`validation/designs/`](../validation/designs/)).

#### What the assay measures (MaveScape 0.2)

`readout` says what the scores mean, in MaveDB's controlled keywords for an experiment (the MAVE
minimum information's vocabulary, Claussnitzer et al. 2024). `library.method` says how the library
was made, and `controls.positions` and `controls.why` say where each control class serves and why.
All are optional. Until `readout.direction` is given, MaveScape takes a higher score to mean more of
the function measured, and says so in the summary, the legend and the QC.

```json
"readout": {
  "phenotype": "Cellular abundance of the GRB2 SH3 domain (abundancePCA)",
  "method": "Reporter",
  "mechanism": "Loss of function",
  "modelSystem": "Yeast",
  "direction": "higher-more"
},
"library": { "level": "variant", "method": "Error-prone PCR" },
"controls": {
  "wildType": "auto", "synonymous": "auto", "nonsense": "auto",
  "positions": { "nonsense": { "end": 93 } },
  "why": { "nonsense": "Stops before residue 94 lose the RING domain's helices that bind BARD1." }
}
```

| Field | Meaning |
| --- | --- |
| `readout.phenotype` | what was measured, in words |
| `readout.method` | MaveDB's Phenotypic Assay Method (`Reporter`, `Cell fitness`, `Binding assay`, …) |
| `readout.mechanism` | MaveDB's Phenotypic Assay Mechanism: what the assay detects (`Loss of function`, `Gain of function`, …) |
| `readout.modelSystem` | MaveDB's Phenotypic Assay Model System (`Yeast`, `Immortalized human cells`, …) |
| `readout.direction` | `higher-more` (a higher score, more of the function), `higher-less` (less of it), or `unsigned` (a larger change, either way) |
| `library.method` | MaveDB's In Vitro Construct Library Method System (`Error-prone PCR`, `Doped oligo synthesis`, `Oligo pool synthesis`, …); a library of single-base changes has its coverage judged against the substitutions one base change makes |
| `controls.positions` | `{ "synonymous" or "nonsense": { "start", "end" } }`: target positions where the class serves as a control (either end may be left open) |
| `controls.why` | `{ "wildType", "synonymous", "nonsense" }`: why each is a control here |

A term outside MaveDB's lists is kept as written, with a warning; a deposit would say "Other". The
limits apply wherever the controls are used: normalization to synonymous variants, rescaling, and
the separation of the controls.

### Import templates, `*.import.json`

A table's mapping (variant column, level, count columns, roles, strict or lenient reading, what
absence means, and a table of barcodes' column of barcodes), applied when a table with the same
columns is opened.

## Workspace archives, `*.msz`

A ZIP archive holding everything needed to reopen an analysis elsewhere:

```
manifest.json            format "mavescape-archive", version 1, created, software (version, commit),
                         sources ("included" or "checksums"), and every other file with its
                         SHA-256 and size
workspace.json           the workspace document (below)
sources/<sha256>.<ext>   each imported table, byte for byte (left out with "checksums only")
results/<run-id>.csv     each run's scores (results/<run-id>.<condition>.csv for further
                         conditions), as the scores export below
methods.md               the latest run's methods
references.bib           and their references
```

Saved, reopened and saved again, an archive has the same bytes. On opening, MaveScape reads only
these names (nothing outside the archive's folders), limits each file's size and checks it while
decompressing, checks every file's SHA-256 against the manifest and every table's against its
name, and verifies the workspace history's chain; what does not hold is reported. A workspace
already in the library opens as a copy.

The **workspace document** (`workspace.json`, also exported alone as JSON) is format
`mavescape-workspace`, version 1: `id`, `name`, `created`, `modified`, `sources` (each table's file
name, SHA-256, size, rows, encoding, layout, mapping and import summary), `targets`, `design` and
`designSource`, `runs`, `selections`, `qc` (its `thresholds`, and from MaveScape 0.2 the findings
`acknowledged`, by id: `{ reason, status, value, time }`, the status and value when acknowledged),
`example`, and `history`: every
material change, `{ time, action, detail, hash }`, each hash the SHA-256 of the one before and the
entry, so that a change made later breaks the chain.

A **score run** keeps its inputs, not its scores: the table's SHA-256, the mapping, the design,
the parameters and the scoring version (whose canonical JSON's SHA-256 is the run's id), the
software, the warnings, and the output's SHA-256. Reopened, a run is recomputed from its inputs
and must have that output hash (which covers its differential scores when it has some). Archives
saved by earlier releases keep opening: the validation keeps one from each release
([`validation/archives/`](../validation/archives/), from 0.1.0) and reproduces its runs. Its `output.replicates` keep each replicate's normalizers and, for
DiMSum's model, `dimsum`: the scale, shift, multiplicative `input` and `output` terms, additive
`reperror` (a variance), and `intervals` (the 10th and 90th percentiles of their bootstrap).
Combined by the moderated combination (MaveScape 0.2, the default; the parameter `combination`:
`moderated`, `reml`, `fixed`, `mean` or `enrich2`), each of its `output.conditions` keeps the
`errorModel`: `a` and `b` (a replicate score's variance is `a` × counting + `b`), `pairs` (the
pairs of replicate scores it was fitted to) and `fitted` (false when there were too few: counting
alone), `bReference` (the variance of the replicates' shared shift) and `shifts` (each replicate's, by
its id), `phiPrior` and `dfPrior` (the moderated dispersions' prior; `null` for infinite degrees
of freedom). Runs that combined by another method record it, and
runs made before 0.2 recorded `reml`; they reopen to their hashes. A run's output hash covers each
score's degrees of freedom when it has them.

## Exports

All CSV exports use LF line ends, `NA` for a missing value, and numbers in the shortest form that
reads back to the same value, so they import again without loss.

### Scores (`*_scores.csv`)

MaveDB's score layout, one row per variant of the table, in the table's order:

| Column | |
| --- | --- |
| `hgvs_nt`, `hgvs_splice`, `hgvs_pro` | the variant in MAVE-HGVS, in its level's column (`NA` in the others) |
| `score`, `SE` | the combined score and its standard error; `NA` when not scored |
| `ci95_lower`, `ci95_upper` | the 95% interval: score ± t × SE, t at the score's degrees of freedom (from MaveScape 0.2, with the moderated combination); ± 1.96 SE with the other combinations |
| `df` | the score's degrees of freedom (moderated combination, MaveScape 0.2); `Inf` for a score whose replicates' variance is known; `NA` with the other combinations |
| `SE_scale` | for rescaled scores (MaveScape 0.2), the rescaling anchors' uncertainty at this score, shared by every score and not in `SE`: needed to compare a score with another assay's or with the anchors' true values; `NA` without rescaling |
| `replicates`, `replicates_expected` | biological replicates used, and that could have measured it |
| `status` | `scored`, `low confidence`, `filtered: <stage>` (`identifier`, `class`, `excluded`, `input-count`, `total-count`, `barcodes`, `replicates`, `se`) or `not measured` |
| `flags` | why a score has low confidence |
| `tau2`, `I2`, `leave_one_out` | between-replicate variance (REML and Enrich2's estimator; `NA` with the others), I², and the largest change when one replicate is left out |
| `variant_as_written`, `variant_class` | the name as in the table, and its class |
| `score_<replicate>`, `SE_<replicate>` | each replicate's score and SE (kept for filtered variants too) |

For sorted bins (MaveScape 0.2), a score is the weighted average of the bins' values, or the
maximum-likelihood mean of the variant's log fluorescence, scaled per replicate (by default so that
nonsense scores 0 and the wild type 1); the run's methods say which.

For a table of barcodes (MaveScape 0.2), a score is the variant's, from its barcodes summed or from
each barcode scored and combined within the replicate; the run's methods say which, and whether
outlier barcodes were left out.

For a time series scored by regression (MaveScape 0.2), a score is the slope of the variant's
normalized log count on time scaled to 0–1, and `score_<replicate>` is each replicate's slope; the
provenance and methods say which model, standard error and minimum of time points the run used.
With the parameter `timeScale: "unit"` (MaveScape 0.2; `"course"`, the default, is Enrich2's), the
slope is on time itself, per the design's unit of time (per generation with times in generations),
and the log ratio of the first and last samples is over the time between them.

Scored by DiMSum's model (MaveScape 0.2; parameters `model: "dimsum"`, `dimsumNormalise`,
`dimsumErrorModel`, `dimsumDropout`), `score_<replicate>` is DiMSum's fitness, scaled and shifted,
and `SE_<replicate>` its σ from the error model; a replicate with a zero count is `NA` there (no
pseudocount). The methods list each replicate's fitted scale, shift and error terms.

With two or more conditions, the scores file holds one condition (its name in the file name);
differential scores between conditions are in their own file (below).

### Differential scores (`*_differential.csv`)

With conditions compared (MaveScape 0.2; the parameter `differential`: `limma`, `paired` or
`independent`; `null` for none), one row per variant of the table: `hgvs_nt`, `hgvs_splice`,
`hgvs_pro`, `variant_as_written`, then for each contrast (each condition against the reference,
`<condition>-vs-<reference>`): `difference_<contrast>` (natural log; limma's log₂ fold change
times ln 2), `SE_`, `ci95_lower_`, `ci95_upper_`, `t_` (limma, and pairs combined by the moderated
combination, whose intervals and p-values use t) or `z_`, `p_`, `q_`
(Benjamini–Hochberg within the contrast), `replicates_` (limma) or `pairs_`, and `status_`
(`estimated`, or why not: not scored in the reference condition or in the condition, no pair of
replicates measuring it, not counted in every sample for limma). `NA` where there is none.

### Counts (`*_counts.csv`)

The run's variant column and every count column its design uses (copies of shared samples too),
as the table has them, with MaveDB's identifier columns first (a table of barcodes: its column of
barcodes first, one row per barcode). Imported again with the same design and parameters, it gives
the run's output hash.

### Barcodes (`*_barcodes.csv`)

A table of barcodes, one row per barcode: `barcode`, its variant (`hgvs_pro` or `hgvs_nt`, and
`variant_as_written`; `NA` for a barcode that names none), and for each replicate `before_<r>`,
`after_<r>`, `score_<r>`, `SE_<r>` (the barcode's own score, against the replicate's normalizers),
`z_<r>` (its departure from its variant's other barcodes, over √φ; `NA` with fewer than three),
`outlier_<r>` (`yes` beyond 4, or the barcode filter's maximum) and `used_<r>` (`yes`, `no
(outlier)` when the filter left it out, or why not). For sorted bins, its reads in each bin.
`NA` where a replicate does not count the barcode.

### Quality control

- `*_qc_samples.csv`: per sample: its columns and roles, variants counted and missing, total reads,
  reads per variant, zeros, counts below the low-count threshold, quantiles.
- `*_qc_findings.csv` (MaveScape 0.2): per finding: `finding` (its id), `title`, `status` (`pass`,
  `review`, `fail` or `not assessed`), `blocking`, `from` (`counts` or `scores`), `value`, `threshold`,
  `acknowledged` (`yes` while an acknowledgement holds), `acknowledged_status` and `reason`, and
  `causes` and `next` (each `kind: text`, separated by ` | `; causes are `technical`, `model` or
  `expected`, next steps `inspect`, `analysis` or `experiment`).
- `*_qc_variants.csv`: per variant: the state of its name, its status and flags, and for each
  replicate its counts before and after and whether that replicate was used (or why not).

### Selections

CSV (`hgvs_pro`, `score`, `SE`, `status`) or JSON (`format: "mavescape-selection"`, `name`,
`run`, `condition`, `created`, `keys`).

### Provenance (`*_provenance.json`)

Format `mavescape-provenance`, version 1: the run (id, name, created, software and commit,
parameters, output hash, warnings), its inputs (the table's name, SHA-256, rows, encoding and
import time; the mapping; the design and its SHA-256), the QC thresholds and findings (an
acknowledged one with `acknowledged: { reason, status, time }`), the
workspace (id, name, the history's latest hash), the files exported with it and their SHA-256, and
the research-use statement.

### Methods (`*_methods.md`, `*_references.bib`)

A methods paragraph written from what the run did: the table and its SHA-256, the identifiers and
target, the design (and what was not recorded with the counts, with what that meant: "Not recorded
with the counts: the cells carried into selection (the bottleneck QC infers was not checked against
them)", MaveScape 0.2), the scoring with every parameter and filter, the QC findings, the software
and the run's output hash, with numbered references, and the same references as BibTeX.

### The analysis package (`*_package.zip`)

MaveScape 0.2: what an analysis needs, as the files `mavescape run` reads and the MAVE minimum
information asks for. A ZIP, written the same way every time (dated with the workspace's
modification time, in UTC):

| File | |
| --- | --- |
| `README.md` | what each file is, the `mavescape run` command that scores them (with any acknowledged QC finding as `--acknowledge`), the run's output hash, and the readiness in words |
| `counts/<file>` | the count table as imported, byte for byte (each part of a table joined from several files; a table of barcodes' map after it) |
| `target.fasta` | the target, 60 letters to a line |
| `design.json` | the design (a run's, or the workspace's) |
| `samples.csv` | the design as a sample sheet (above) |
| `parameters.json` | the parameters, complete: a run's, or MaveScape's defaults for the design |
| `readiness.json` | the readiness (below) |

Scored from a run's package alone, `mavescape run --design design.json --parameters parameters.json
--out results counts/<file>` gives that run's output hash.

### The readiness (`readiness.json`; `mavescape validate --json`'s `readiness`)

What each analysis can do with what a workspace holds, and what is missing (MaveScape 0.2,
`web/lib/readiness.js`): `version` (1), `model`, `base` (`counts`, `target`, `design`: whether each
is there), `analyses`, `gaps` and `counts` (`ready`, `partial`, `unavailable`).

| Field | |
| --- | --- |
| `analyses[]` | `id` (`score.log-ratio`, `score.dimsum`, `score.regression`, `score.ratio-of-ends`, `score.per-generation`, `score.bin-average`, `score.bin-mle`, `score.barcodes-each`, `normalize.wild-type`, `normalize.synonymous`, `scale.bins-nonsense-wt`, `scale.bins-low5-wt`, `rescale.nonsense-wt`, `rescale.synonymous-nonsense`, `replicates.combine`, `replicates.leave-one-out`, `conditions.differential`, `qc.<finding id>`, `record.scores`, `record.methods`, `record.package`, `record.deposit`), `group`, `label`, `status` (`ready`, `partial`: it runs, and what `improves` lists would make it more complete; `unavailable`: `needs` lists what it lacks, or `note` says why), `needs`, `improves` (gap ids), `note` |
| `gaps[]` | `id` (`counts`, `target`, `design`, `wild-type`, `synonymous`, `nonsense`, `replicates`, `third-replicate`, `time-points`, `conditions`, `readout`, `readout-terms`, `library-method`, `gates`, `bin-cells`, `selection-cells`, `generations`, `target-identifiers`), `label`, `kind` (`required`, `counts`, `experiment`, `bench`, `description`), `why`, `where` (where it is usually found), `how` (where to give it in MaveScape), `place`, `consequence` (what its absence meant, for the methods), `detail` (the design's first problem), `unlocks` and `improves` (analysis ids) |

Only the analyses a design allows are listed: no per-generation scores for rounds of selection, no
bins' scales for a selection.

### The map (`*.svg`, `*.png`)

The whole map at a fixed cell size on a light background, with the position and row medians, both
numberings, the color scale and a key to the states; the SVG carries the map's description as its
`<desc>`, and each cell its variant as a `<title>`. The PNG is the SVG drawn at three times its
size.

## Headless runs: `run.json`

`mavescape run` (MaveScape 0.2) writes the run's files to its `--out` folder (the scores, counts,
QC (with `qc_findings.csv`), differential scores, barcodes and map exports above, `provenance.json`, `methods.md`,
`references.bib` and `workspace.msz`) and `run.json`, format `mavescape-run`, version 1:

| Field | |
| --- | --- |
| `mavescape`, `commit` | the program |
| `command` | the command line |
| `clock` | the fixed time every record carries (`--time` or `SOURCE_DATE_EPOCH`), if any |
| `browser`, `browserStarts` | the headless browser, and how many starts its page took |
| `started`, `finished`, `seconds` | the wall-clock times of the run (these differ between runs) |
| `ok`, `exit` | the outcome and the exit status: 0 done, 1 not done or a blocking problem, 2 a wrong command line |
| `problems` | why not, in words |
| `inputs` | each file read: `role` (`design`, `counts`, `target`, `parameters`, `workspace`), `path`, `bytes`, `sha256` |
| `run` | the run: `id`, `name`, `outputSha256`, `conditions`, and what its files are |
| `qc` | the quality control: `overall` (`status`, counts by status, `blocking` finding ids, `acknowledged` ids and the `unacknowledged` counts of `fail` and `review`) and every finding, with its `causes`, `next` steps and acknowledgement |
| `steps` | each action performed: `action`, `ok`, `message`, `seconds`, `data` |
| `outputs` | each file written: `role`, `path`, `bytes`, `sha256` |

With a fixed time, the same inputs write the same bytes in every file but `run.json`.

## Remote control: `remote.json`

Started with `--remote-control`, MaveScape writes `remote.json` to its data folder
(`~/Library/Application Support/MaveScape` on macOS, `~/.config/MaveScape` on Linux,
`%AppData%\MaveScape` on Windows, or `--data-dir`), readable by its owner only, and removes it when
it stops:

```json
{
  "url": "http://127.0.0.1:8820",
  "token": "…",
  "version": "0.2.0",
  "pid": 41237
}
```

Actions are posted to `<url>/api/remote/action` as `{"action": "…", "args": {…}, "client": "…"}`
and answered with `{"ok": true|false, "message": "…", "data": …}`; `open_files` and `export` need
the header `X-MaveScape-Token: <token>`. `GET <url>/api/remote/tools` lists every action with its
arguments as JSON Schema. The site's guide describes each action
([Remote control and scripting](https://robert-mcdermott.github.io/mavescape/docs/scripting.html)).

MaveScape reports experimental functional effects for research; nothing it writes classifies a
variant as pathogenic or benign.
