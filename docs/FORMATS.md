# File formats

Every file MaveScape 0.1 reads and writes. Researchers whose counts come from their own pipeline
need only a count table, the target's sequence, and the design: which column is which sample.
Blank, annotated layouts of each are on the Start page and in
[`web/examples/layouts/`](../web/examples/layouts/). The Start page also opens two worked examples.

| Kind | Read | Written |
| --- | --- | --- |
| Count tables | CSV, TSV, TXT, gzip of these; one table or one file per sample | the counts a run scored (CSV) |
| Score tables | MaveDB's score layout, recognized at import (shown on the map from 0.3) | a run's scores (CSV) |
| Targets | FASTA, DNA or protein, one or several records | (in the workspace and its archive) |
| Designs | `*.design.json`; sample sheets (CSV, TSV); DiMSum's experiment design file | `*.design.json` |
| Import templates | `*.import.json` | `*.import.json` |
| Workspaces | `*.msz` archives | `*.msz` archives; the workspace document (JSON) |
| Results | | QC per sample and per variant (CSV), selections (CSV, JSON), provenance (JSON), methods (Markdown) and references (BibTeX), the map (SVG, PNG) |

Coming later: Excel workbooks and GenBank files (0.3), barcode tables (0.2), structures (0.4).

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
| `condition`, `tile`, `batch` (`library`, `lane`), `cells` | optional |

DiMSum's experiment design file (`sample_name`, `experiment_replicate`, `selection_id`, …) reads as a
sample sheet.

### `*.design.json`

The design as data: format `mavescape-design`, version 1, described by
[`docs/schemas/design.v1.json`](schemas/design.v1.json): the model (`two-population`,
`time-series`, `bins`, `scores`), the variant column and level, the targets, the samples (each with
its columns: several are technical replicates, summed), the replicates (each naming its samples:
input and output, time points, or bins; its biological number, condition and tile), conditions,
tiles, controls, and `ignoredColumns` (every other column of the table, with the reason, or the
column it copies). Written by the Experiment view; the validation designs are examples
([`validation/designs/`](../validation/designs/)).

### Import templates, `*.import.json`

A table's mapping (variant column, level, count columns, roles, strict or lenient reading, what
absence means), applied when a table with the same columns is opened.

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
`designSource`, `runs`, `selections`, `qc` (its thresholds), `example`, and `history`: every
material change, `{ time, action, detail, hash }`, each hash the SHA-256 of the one before and the
entry, so that a change made later breaks the chain.

A **score run** keeps its inputs, not its scores: the table's SHA-256, the mapping, the design,
the parameters and the scoring version (whose canonical JSON's SHA-256 is the run's id), the
software, the warnings, and the output's SHA-256. Reopened, a run is recomputed from its inputs
and must have that output hash.

## Exports

All CSV exports use LF line ends, `NA` for a missing value, and numbers in the shortest form that
reads back to the same value, so they import again without loss.

### Scores (`*_scores.csv`)

MaveDB's score layout, one row per variant of the table, in the table's order:

| Column | |
| --- | --- |
| `hgvs_nt`, `hgvs_splice`, `hgvs_pro` | the variant in MAVE-HGVS, in its level's column (`NA` in the others) |
| `score`, `SE` | the combined score and its standard error; `NA` when not scored |
| `ci95_lower`, `ci95_upper` | score ± 1.96 SE |
| `replicates`, `replicates_expected` | biological replicates used, and that could have measured it |
| `status` | `scored`, `low confidence`, `filtered: <stage>` (`identifier`, `class`, `excluded`, `input-count`, `total-count`, `replicates`, `se`) or `not measured` |
| `flags` | why a score has low confidence |
| `tau2`, `I2`, `leave_one_out` | between-replicate variance, I², and the largest change when one replicate is left out |
| `variant_as_written`, `variant_class` | the name as in the table, and its class |
| `score_<replicate>`, `SE_<replicate>` | each replicate's score and SE (kept for filtered variants too) |

### Counts (`*_counts.csv`)

The run's variant column and every count column its design uses (copies of shared samples too),
as the table has them, with MaveDB's identifier columns first. Imported again with the same design
and parameters, it gives the run's output hash.

### Quality control

- `*_qc_samples.csv`: per sample: its columns and roles, variants counted and missing, total reads,
  reads per variant, zeros, counts below the low-count threshold, quantiles.
- `*_qc_variants.csv`: per variant: the state of its name, its status and flags, and for each
  replicate its counts before and after and whether that replicate was used (or why not).

### Selections

CSV (`hgvs_pro`, `score`, `SE`, `status`) or JSON (`format: "mavescape-selection"`, `name`,
`run`, `condition`, `created`, `keys`).

### Provenance (`*_provenance.json`)

Format `mavescape-provenance`, version 1: the run (id, name, created, software and commit,
parameters, output hash, warnings), its inputs (the table's name, SHA-256, rows, encoding and
import time; the mapping; the design and its SHA-256), the QC thresholds and findings, the
workspace (id, name, the history's latest hash), the files exported with it and their SHA-256, and
the research-use statement.

### Methods (`*_methods.md`, `*_references.bib`)

A methods paragraph written from what the run did: the table and its SHA-256, the identifiers and
target, the design, the scoring with every parameter and filter, the QC findings, the software and
the run's output hash, with numbered references, and the same references as BibTeX.

### The map (`*.svg`, `*.png`)

The whole map at a fixed cell size on a light background, with the position and row medians, both
numberings, the color scale and a key to the states; the SVG carries the map's description as its
`<desc>`, and each cell its variant as a `<title>`. The PNG is the SVG drawn at three times its
size.

MaveScape reports experimental functional effects for research; nothing it writes classifies a
variant as pathogenic or benign.
