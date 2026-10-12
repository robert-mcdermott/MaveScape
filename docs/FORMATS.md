# File formats

Every file MaveScape 0.1 to 0.5 read and write. Researchers whose counts come from their own pipeline
need only a count table, the target's sequence, and the design: which column is which sample.
Blank, annotated layouts of each are on the Start page and in
[`web/examples/layouts/`](../web/examples/layouts/). The Start page also opens two worked examples.

| Kind | Read | Written |
| --- | --- | --- |
| Count tables | CSV, TSV, TXT, gzip of these; one table or one file per sample; tables of barcodes with their barcode-to-variant maps; dms_variants' `variant_counts`; Enrich2's counts files and barcode maps | the counts a run scored (CSV); a barcode table's barcodes, one by one (CSV) |
| Score tables | MaveDB's score layout, and any table with a column of scores: read as published by a design of model `scores`, as a run on the map (0.3) | a run's scores (CSV) |
| MaveDB score sets (0.3) | a record (JSON), its scores and counts (CSV), its mapped variants (JSON) and searches, through the program's fetcher | (kept in the workspace: the record, each table's origin; the mapped variants as CSV beside the tables) |
| MaveDB deposits (0.3) | a MaveDB package (a folder or `.zip` of `score_set.json`, `experiment.json`, `scores.csv` and `counts.csv`), as MaveScape writes one or as MaveDB's API takes one: opened as a record is | a run as MaveDB takes a score set (`*_mavedb.zip`, or a folder from `mavescape export`): scores, counts, column descriptions, experiment and score set |
| Targets | FASTA, DNA or protein, one or several records; GenBank (`.gb`, `.gbk`, `.gbff`, `.genbank`, `.ape`), a coding feature chosen (0.3); a RefSeq or Ensembl transcript a MaveDB record names, fetched (0.3) | (in the workspace and its archive, with where it came from) |
| Designs | `*.design.json`; sample sheets (CSV, TSV); DiMSum's experiment design file | `*.design.json` |
| Import templates | `*.import.json` | `*.import.json` |
| Workspaces | `*.msz` archives | `*.msz` archives; the workspace document (JSON) |
| Results | | QC per sample and per variant (CSV), selections (CSV, JSON), provenance (JSON), methods (Markdown) and references (BibTeX), the map (SVG, PNG); a nucleotide run's scores at the protein level (CSV, 0.3); a comparison's matched variants (CSV) and its report and statistics (JSON, 0.4) |
| Remote control | actions as JSON (`/api/remote/action`) | `remote.json` in the data folder: the address and token scripts use |
| Public data (0.3) | UniProt entries, features and sequence lookups, MaveDB, NCBI's RefSeq and GenBank records and ClinVar's records, Ensembl's transcripts, PDBe-KB's conservation profiles, AlphaMissense's predictions, gnomAD's variants, through the program's fetcher ([NETWORK.md](NETWORK.md)) | the cache of public data, each answer with its retrieval record |
| Tracks (0.3) | alignments (A3M, aligned FASTA, Stockholm, Clustal), predictors' tables (AlphaMissense, EVE, ESM1b-style matrices, any table of protein variants and scores), GFF3 (UniProt's among others), tables of values by position or of stretches (CSV, TSV) | the tracks shown, position by position (CSV); the map with its tracks (SVG, PNG); each annotation's file kept in the workspace's library and archive |
| Structures (0.5) | PDB, mmCIF and BinaryCIF files, gzipped or not; PDB entries, AlphaFold DB models and the structures that cover a protein (PDBe's SIFTS) through the program's fetcher | an image of the Structure view (PNG); the target on a structure, position by position (CSV); the scores a structure is colored by, with each residue's color (CSV); what a structure says of each position (CSV) |

Coming later: Excel workbooks, structures kept with the workspace (0.5).

## Structures

The Structure view (MaveScape 0.5) reads a structure from a file or through the program's fetcher
(a PDB entry by its ID; an AlphaFold DB model by a UniProt accession). The readers are
Proteoscope's (`web/lib/structure/`):

- **PDB** (`.pdb`, `.ent`): `ATOM` and `HETATM` records, `MODEL`s, `HELIX` and `SHEET`, `SEQRES`,
  `DBREF` (which UniProt residues a chain covers), `CONECT`, `REMARK 350` (biological
  assemblies).
- **mmCIF** (`.cif`, `.mmcif`), as the wwPDB writes it: `atom_site`, `struct_conf` and
  `struct_sheet_range`, `struct_conn` (disulfide bonds and other links), `struct_ref_seq`
  (UniProt residues), `pdbx_struct_assembly` and `pdbx_struct_oper_list` (assemblies), the
  components' `chem_comp_atom` and `chem_comp_bond` (bond orders), and ModelCIF's local pLDDT for
  predicted models (AlphaFold DB's). A file named `.cif` that holds PDB records is read as PDB.
- **BinaryCIF** (`.bcif`): MessagePack-encoded mmCIF, every column encoding, read as mmCIF.
- **Compressed:** any of these gzipped (`.gz`).

The first model of a file is drawn; an assembly is built from the deposited coordinates by its
operators. The entry's record of the UniProt residues each chain covers (`DBREF`, `struct_ref_seq`)
and of where its sequence differs from UniProt's (`SEQADV`, `struct_ref_seq_dif`) are read, and
reported beside the mapping of the target (below, "Structure mappings"). The view's image is a PNG
at twice the view's size. A structure is shown for the session: it is not yet saved with the
workspace.

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
| Codon variants (MaveScape 0.2) | a table naming each codon variant on its own row in a column of coding names (`hgvs_nt`, `c.…`), read at the protein level when chosen (*Each row is: a codon variant*): below |

**Codon variants** (MaveScape 0.2). A table such as MaveDB's EMPIRIC tables names each codon
variant on its own row, several to an amino-acid substitution, and often writes the wild type once
per position. Read at the protein level, each row's protein change is worked out from its
nucleotide name against the target's DNA in its reading frame (substitutions in the coding
sequence; any other change is not named, and not scored); a variant on several rows with the same
count in every column is one measurement written more than once, read once (with different
counts it is a blocking problem); and the codons of each protein variant are summed in every count
column (missing in a sample only if every codon is). The result has one row per protein variant,
named in a column `hgvs_pro (from <column>)`; the table's own protein column is not used. The
source's mapping records `assembly: { kind: "codons", codons: { from: "<column>" } }`, and a design
whose `variants.column` is `hgvs_pro (from <column>)` reads its table this way wherever it is
opened (`mavescape run`, a design file opened later).

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

A DNA target's protein is its coding sequence translated from the coding start to the first stop
(kept), or to its last whole codon: a transcript's 3′ UTR is not translated (MaveScape 0.3).
Nucleotide variants count c. positions from the coding start (c.1 is the first base of the first
codon), c.-N before it (the 5′ UTR) and c.*N after the stop (the 3′ UTR); n., g., m., o. and r.
positions count from the target's first base. A c. position in a UTR the target does not hold
(a coding construct has none) is not checked against it, as mavehgvs checks none.

## Targets: GenBank

A GenBank flat file (MaveScape 0.3), as NCBI writes it and map tools (SnapGene, Benchling, ApE,
Geneious) export it: `.gb`, `.gbk`, `.gbff`, `.genbank`, `.ape`, or any file beginning with its
`LOCUS` line. MaveScape reads LOCUS (name, length, molecule, topology), DEFINITION, ACCESSION,
VERSION, the organism, every feature with its location (ranges, partial ends `<` `>`,
`complement(…)`, `join(…)`, `order(…)`; a location on another record is refused) and qualifiers,
and the sequence.

A target is made from one coding feature (`CDS`), chosen when the record has several (the longest
whose translation checks is offered first). Its translation (the standard code; tables 1 and 11)
is checked against the record's `/translation`, and the check kept with the target. From an mRNA
whose coding sequence is one stretch of the forward strand, the target is **the whole record**, its
coding start the CDS's, so that variants in its UTRs are on it (a RefSeq transcript); otherwise (a
plasmid, a genomic record, a CDS on the reverse strand or joined from exons) it is **the coding
sequence alone**, as joined and read on its strand. The target's identifiers take the gene, the
accession (`refseq` for a RefSeq accession, `genbank` otherwise) and the protein's (`protein`,
from `/protein_id`).

Where a target came from is kept with the workspace's target, not in the design (`origin`): the
format (`GenBank`, or the service, `NCBI` or `Ensembl`), the accession, the feature (`CDS
233..5824`), the file or the retrieval record, whether it is the whole record, and the check of
its translation. The methods name it.

```json
"origin": { "format": "GenBank", "service": "NCBI", "accession": "NM_007294.3", "named": "NM_007294.3",
  "feature": "CDS 233..5824", "label": "BRCA1: breast cancer type 1 susceptibility protein isoform 1", "whole": true,
  "retrieval": { "retrieved": "2026-10-11T04:13:30Z", "source": "https://eutils.ncbi.nlm.nih.gov/…" },
  "check": { "status": "identical", "message": "Its 1863 amino acids are the record's translation, identical." } }
```

## Variants and their protein changes

Variant names are MAVE-HGVS (`hgvs_nt`, `hgvs_splice`, `hgvs_pro`; or forms MaveScape reads
leniently, said where they are read), optionally prefixed by their target (`NM_007294.3:c.68A>G`,
`LMNA:n.127G>A`): the prefix must be the design's target's id, name, `label` or one of its
accessions; a name prefixed by another of a score set's targets is set aside (the filter stage
`target`), not counted invalid.

A nucleotide variant of a DNA target is read for the protein change it makes (MaveScape 0.3): its
class (synonymous, missense, nonsense, start lost, stop lost, multi-variant, deletion, insertion,
duplication, deletion-insertion, frameshift; splice site, intronic, 5′ UTR, 3′ UTR) and its
protein change in MAVE-HGVS, as biocommons hgvs computes it, in MAVE-HGVS's forms: a frameshift
short (`p.Gly5fs`), a lost stop as the substitution at the stop (`p.Ter120Gln`), a change of a
methionine start codon "start lost" (named only as a substitution, `p.Met1Val`), substitutions of
several codons a multi-variant (`p.[Met133Thr;Phe134Leu]`), nothing after a stop the variant
makes. A splice site is an intronic position within two bases of the exon (or a change across an
exon's edge); further in, intronic. The class is the variant's class everywhere (QC's controls
included: a nucleotide library's synonymous and nonsense variants are found by translation).

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
column it copies). A sample may be named by replicates of several tiles (sub-libraries grown and
sequenced together): each of them measures only its own tile's positions there (MaveScape 0.3). For a table of barcodes, `library.level` is `barcode` and `library.barcodeColumn`
names the column of barcodes (MaveScape 0.2). A sample's `missingMeansZero: true` reads its missing counts as 0, for tables
that write variants that dropped out during selection as missing (MaveScape 0.2; "Missing = 0" in
the Experiment view; warned about on a replicate's first sample). For sorted bins, each bin of a replicate
may give its gates on the reporter, `lower` and `upper` (fluorescence; the lowest bin's lower and
the highest bin's upper left open), and each sample the `cells` sorted into it: with the gates the
bins can be scored by maximum likelihood, whose reads are reweighted by the cells (MaveScape 0.2). For two populations, an input's
`cells` are those carried into selection from it, and an output's those recovered after it: quality
control checks the bottleneck it infers against them (MaveScape 0.2). A target may have a `label`, the
name its variants give it when that is not its id, name or an accession (MaveDB's label in a score
set of several targets), and among its `identifiers` a `genbank` (INSDC) and a `protein` (RefSeq
or Ensembl) accession, with `refseq`, `ensembl`, `uniprot` and `gene` (MaveScape 0.3), and a
`taxonomyId`, its organism's NCBI Taxonomy id (9606 for *Homo sapiens*), which MaveDB keeps with a
target sequence (MaveScape 0.3: read from a MaveDB record and from a GenBank record's
`/db_xref="taxon:…"`). Written by
the Experiment view; the validation designs are examples
([`validation/designs/`](../validation/designs/)).

A design of **published scores** (model `scores`, MaveScape 0.3) reads a table of scores as they
were published, without counts: `scores` names its columns, `score` and, when the table gives them,
`se` (standard errors) and `ciLow`, `ciHigh` (a 95% interval); `samples` and `replicates` are empty,
and every other column is in `ignoredColumns`. Its run (the model `published`) takes each score,
SE and interval as given, never rescoring them; a variant is left out when its name is not valid
against the target, its class or itself is excluded, its SE is above a maximum, the table gives it
no score (the stage `given`), or it repeats an earlier row's variant with the same scores (`copy`:
read once). From MaveScape 0.4, a protein variant written on several rows with other scores (several
codons, or measurements, with no nucleotide names to tell them apart) is read as one, as DiMSum
merges a protein variant's codons: its first row holds the mean of its rows' scores, weighted by
1/SE² (unweighted, its SE unknown, without SEs), and the others are left out (`merged`); frameshifts
written alike on several rows (MAVE-HGVS names every frameshift at a codon alike) are left out, not
told apart (`alike`). Nucleotide variants on several rows with other scores are refused. The scores
export writes the given interval.
A design of a MaveDB record (Open from MaveDB) also has the record's `source` (URN, citation,
license), and its `readout` and `library.method` from the experiment's controlled keywords.

```json
{
  "format": "mavescape-design", "version": 1, "name": "PTEN VAMP-seq", "model": "scores",
  "source": { "mavedb": "urn:mavedb:00000013-a-1", "citation": "Matreyek KA, et al. …", "license": "CC0" },
  "readout": { "method": "Reporter", "mechanism": "Loss of function", "modelSystem": "Immortalized human cells", "phenotype": "Regulation of protein stability" },
  "variants": { "column": "hgvs_pro", "level": "protein" },
  "targets": [{ "id": "PTEN", "name": "PTEN", "sequenceType": "dna", "sequence": "ATG…", "codingStart": 1, "offset": 0, "organism": "Homo sapiens", "identifiers": { "uniprot": "P60484" } }],
  "library": { "level": "variant", "method": "Oligo-directed mutagenic PCR" },
  "samples": [], "replicates": [],
  "scores": { "score": "score", "se": "se", "ciLow": "lower_ci", "ciHigh": "upper_ci" },
  "controls": { "wildType": "auto", "synonymous": "auto", "nonsense": "auto" },
  "ignoredColumns": [{ "column": "sd", "reason": "published with the scores; not read" }]
}
```

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
sources/<sha256>.<ext>   each imported table, byte for byte (left out with "checksums only"), and
                         each annotation's file (always; MaveScape 0.3)
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

A table opened from MaveDB (MaveScape 0.3) keeps where it came from, as its source's `origin`:
`{ database: "MaveDB", urn, file: "scores" | "counts", url, retrieved, license, hasCounts,
rawReads }`, and, when it was opened with MaveDB's mapped variants, `mapped: { fileName, sha256,
size, variants, retrieved, url }`: a CSV kept in the library beside the table (and in the
archive), one row per variant MaveDB mapped to the human reference, joined to the table by its
accession column:

```csv
accession,vrs_id,hgvs,clingen_allele_id,alignment_level
urn:mavedb:00000835-a-1#1,ga4gh:VA.0lN4ih6CEbwrQ_YxlUsIp4eo225wMbtf,NP_002077.1:p.Thr159Ter,NA,protein
```

`vrs_id` is the GA4GH VRS 2.0 allele identifier of the current mapping (`postMapped`), `hgvs` the
HGVS on the reference sequence it maps to, `clingen_allele_id` its ClinGen allele (where MaveDB
gives one). The inspector shows a variant's; superseded mappings are left out.

Several score sets opened together (MaveScape 0.3, "Several score sets as conditions"): each
record's scores are a source of their own, as above; their counts are one source assembled from
every record's counts file, joined on the variant column (`files`, in order, each named by its
URN's number, `00000063-b-1.csv`, so that its columns are named `00000063-b-1:Repeat1_t_00hrs`;
`mapping.absentMeans` `missing`). Its `origin` names them all and no one:
`{ database: "MaveDB", urn: null, urns: [urn, …], file: "counts", joined: true, retrieved, license,
hasCounts, rawReads }`.

The workspace keeps each record opened in `records`: MaveDB's record as MaveScape reads
it (its title, short description and method text, license and its terms, citation and publications,
target, columns, the experiment's keywords and raw-read identifiers, and its published calibrations:
each with its functional classes, their ranges and the evidence strength each assigns), with when
and from where it was retrieved, so that the methods can cite it and the inspector show it offline.
From MaveScape 0.3 it also keeps what a MaveDB deposit of it says again: its abstract, its
publications as identifiers (`{ db, id }`), data DOIs, contributors (ORCID iDs), the descriptions of
its columns (`columns: { scores, counts }`), and its experiment's title, descriptions, method text,
raw reads and publications. A MaveDB package opened from files is kept the same way, with `package`
(its name) in place of the URN, its tables' `origin` `{ database: "package", package, file,
license }`.

`deposit` (MaveScape 0.3, absent until given) holds the **MaveDB details**: what a MaveDB deposit
says that the workspace does not hold otherwise (below, "A MaveDB deposit"). Each change is in the
history.

`annotations` (MaveScape 0.3, absent until the first) lists the **annotations** whose tracks are
drawn beside the map (below, "Tracks"), each `{ id, provider, name, file: { fileName, sha256,
size }, record, added }`. `provider` is one of `uniprot-features`, `pdbe-conservation`,
`alphamissense`, `clinvar`, `gnomad`, `mavedb-annotations`, `mavedb-scores` (public data) or
`alignment`, `predictor`, `custom` (a file). The file is kept in the library and the archive by its SHA-256, so
the tracks are read again from it offline: public data as MaveScape keeps them (below), a person's
file as it was opened. `record` says where it came from: for public data `{ service, url,
retrieved, release, requests, license, citation }` and what was asked (`accession`, `gene`, `urn`;
ClinVar's `records` and `kept`; gnomAD's `transcript` and `mane`), the earliest retrieval of the
answers it holds; for a file `{ service: "a file", file, bytes }`. A MaveDB score set kept beside
the workspace (`mavedb-scores`, MaveScape 0.4) keeps its scores file as MaveDB sends it, and in
`record.scoreSet` what reading them as published needs: `{ urn, title, shortDescription, citation,
license: { short, open }, keywords, variants, target, targetOrigin, others, readout: { direction }
}` (the target as a design's, fetched when the record names a transcript; `readout.direction` as a
person states it, MaveDB recording none). Adding and removing one, and stating a score set's
direction, are in the history.

`tracks` (MaveScape 0.3, absent until changed) is the arrangement of the tracks: `{ order: [track
ids], hidden: [track ids], filters: { track id: filter } }`. A track's id is a built-in one
(`reference`, `coverage`, `effect`, `uncertainty`) or its annotation's id and part
(`clinvar:clinvar`, `uniprot-features:domains`). A filter is `{ types: [...] }` (features),
`{ classes: [...], stars: n }` (ClinVar's, AlphaMissense's) or `{ min: x }` (gnomAD's allele
frequency). The arrangement is a view, not an analysis: it is saved with the workspace but not in
the history.

A **target** (in `targets`, and as the design's copy in `design.targets`) is as in a design
file (above). A target made from a GenBank record or fetched for a MaveDB record keeps `origin`,
where its sequence came from (above, "Targets: GenBank"), in the workspace and not in the design.
From MaveScape 0.3 the workspace's target can also keep `reference`, the record of
its last check against its UniProt entry (Experiment, Target: **Check against UniProt**). It is
provenance, kept with the workspace and not in the design, so a check that changes nothing leaves
the design and its runs as they were; the methods name it while the target's accession and offset
are still the ones checked:

```json
"reference": {
  "database": "UniProtKB", "accession": "P62993", "entryName": "GRB2_HUMAN",
  "release": "2026_03", "retrieved": "2026-10-10T17:35:33Z",
  "url": "https://rest.uniprot.org/uniprotkb/P62993.json?fields=accession,id,protein_name,gene_names,organism_name,length,sequence",
  "length": 217, "offset": 158, "start": 159, "end": 214, "identical": true, "differences": 0
}
```

`length` is the entry's; `start` and `end` the positions in it of the target's first and last
residues (a DNA target's protein); `differences` how many residues differ. What the check changed
in the design (the offset, `identifiers`, `organism` and `differences`) is in the design, and the
history says what changed.

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

## The cache of public data

Answers from the public services ([NETWORK.md](NETWORK.md)) are kept in the cache's folder
(`--cache-dir`; by default `<user cache dir>/MaveScape`), one folder per kind of request:

```
uniprot/P62993.json              UniProt's answer, byte for byte
uniprot/P62993.json.meta.json    its retrieval record
uniparc/<sha256>.json            a sequence's lookup, named by the SHA-256 of the sequence (its
                                 record's source has {sequence} in place of the sequence)
mavedb/urn_mavedb_00000835-a-1.json         a MaveDB score set's record (its URN without colons)
mavedb/urn_mavedb_00000835-a-1.scores.csv   its scores, as MaveDB writes them
mavedb/urn_mavedb_00000835-a-1.counts.csv   its counts
mavedb/urn_mavedb_00000835-a-1.mapped.json  its mapped variants, as MaveDB gives them
mavedb-search/<sha256>.json      a search, named by the SHA-256 of its words and page (its record
                                 keeps the POST: "method": "POST", "request": its body)
ncbi/NM_007294.3.gb              a nucleotide record, as GenBank text (named by its accession)
ensembl/ENST00000460680.json     an Ensembl transcript's sequence (named without its version; the
                                 answer names the version Ensembl serves)
pdb/2VWF.cif.gz                  a PDB entry's coordinates, gzipped mmCIF as RCSB sends it (0.5)
pdbe/P62993.best-structures.json the PDB entries that cover a protein, by SIFTS, as PDBe gives them (0.5)
alphafold/P62993.prediction.json AlphaFold DB's entries for an accession: each model's version (0.5)
alphafold/AF-P62993-F1-model_v6.cif
                                 a predicted model, mmCIF gzipped as AlphaFold DB stores it (0.5)
```

A structure is kept as it came, compressed (its record's `contentType` is `application/gzip`), and
the page decompresses it; the program first reads a compressed answer to its end, which checks its
length and checksum, and keeps it only if it begins as mmCIF or PDB does.

The **retrieval record** (`*.meta.json`):

```json
{
  "contentType": "application/json",
  "service": "UniProt",
  "source": "https://rest.uniprot.org/uniprotkb/P62993.json?fields=accession,id,protein_name,gene_names,organism_name,length,sequence",
  "retrieved": "2026-10-10T17:35:33Z",
  "checked": "2026-11-12T09:02:41Z",
  "etag": "\"5f1c\"",
  "lastModified": "Tue, 02 Sep 2026 00:00:00 GMT",
  "version": "2026_03"
}
```

`retrieved` is when the answer was downloaded and `checked` when the service last confirmed it
unchanged (absent until then), both UTC; `etag`, `lastModified` and `version` (UniProt's release)
are present when the service gave them. A copy's age, for when it is checked again, is its file's.
The same fields reach the page as `X-MaveScape-*` headers with each answer. Answers saved by hand
in this layout are served like any other, which is how the validation and the screenshots work
offline ([`validation/fixtures/public-data/`](../validation/fixtures/public-data/)).

## Tracks

The sequence tracks beside the map (MaveScape 0.3; the Map view's **Tracks**; the remote actions
`list_tracks`, `add_track`, `set_track`, `remove_track`) are on the map's positions: the target's
numbering, 1 to its length. Each annotation is read by a provider (`web/lib/providers/`) from the
file the workspace keeps. A track is one of four kinds: the reference's residues; a value per
position; features (stretches); or variants (single substitutions), drawn by position and given to
each variant in the inspector.

**Placed on the target.** An annotation numbered on a reference (UniProt's, a transcript's protein)
is placed by the target's offset (target position = reference position − offset), and a variant or
residue only where the target has the residue it names; when more than a tenth of five or more
residues disagree, the offset is taken to be wrong and the annotation is refused, saying so, rather
than drawn in the wrong place. What is left out (beyond the target's ends, naming another residue,
on another transcript) is said in its notes.

**Kept as.** Public data are kept as they came, but for ClinVar and gnomAD, which are kept as one
table each of what MaveScape reads:

```csv
accession,variation_id,title,transcript,hgvs_c,hgvs_p,classification,review_status,last_evaluated,consequence
VCV004673731,4673731,NM_002086.5(GRB2):c.643C>T (p.Arg215Trp),NM_002086.5,c.643C>T,p.Arg215Trp,Uncertain significance,"criteria provided, single submitter",2025-10-22,missense variant
```

```csv
variant_id,hgvsc,hgvsp,consequence,ac,an,filters,flags
17-75320471-T-C,c.106A>G,p.Thr36Ala,missense_variant,6,1613890,,
```

ClinVar's: each record of the gene's missense, nonsense and synonymous variants (its title's
transcript and names), its germline classification, review status (as ClinVar's gold stars, 0–4)
and the date it was last evaluated; the records on the transcript most of them name are placed.
gnomAD's: each variant of the gene's MANE Select transcript with a protein change, its allele
count and number with exomes and genomes joined, and gnomAD's filters (a variant failing them, or
with no allele seen, is left out); a protein change's frequency is its variants' frequencies
added.

**Files a person adds.**

- An **alignment** (A3M, aligned FASTA, Stockholm, Clustal; `.a3m`, `.a2m`, `.sto`, `.stk`,
  `.aln`, `.clustal`, or a FASTA file of several gapped sequences), its first sequence the query:
  each query residue scored as Capra and Singh's `score_conservation.py` scores its column by
  default (the Jensen–Shannon divergence from the BLOSUM62 background, in bits; Henikoff sequence
  weights; a gap penalty; columns of more than 30% gaps unscored; a window of 3), the query placed
  on the target where 80% of its residues at least agree, ungapped.
- A **predictor's table** (CSV or TSV): AlphaMissense's (`protein_variant`, `am_pathogenicity`,
  `am_class`; the whole proteome's, with `uniprot_id`, read for the target's accession), EVE's
  (`wt_aa`, `position`, `mt_aa`, `EVE_scores_ASM`), a matrix with the amino acids down its first
  column and a column for each position (`M1`, `E2`, …; ESM1b's), or any table with a column of
  protein variants (`protein_variant`, `variant`, `hgvs_pro`, `mutant`, `mutation`…; `A123V` or
  `p.Ala123Val`) and a column of scores (`score`, else its first column of numbers). Positions are
  the reference's where the residues agree there, else the target's.
- A **custom track**: GFF3 (UniProt's feature format among others: tab-separated `seqid`, source,
  `type`, `start`, `end`, …, attributes with `Name` or `Note`; numbered as the reference is when
  the `seqid` is the target's UniProt accession, else as the target is; UniProt's types read into
  the tracks UniProt's features give); or a table with a column `position` (the target's
  numbering) or `reference_position`, and a track for each other column of numbers; or with
  columns `start` and `end` (the target's numbering), `label` and `type`, a track of stretches.

## Exports

All CSV exports use LF line ends, `NA` for a missing value, and numbers in the shortest form that
reads back to the same value, so they import again without loss.

### Scores (`*_scores.csv`)

MaveDB's score layout, one row per variant of the table, in the table's order:

| Column | |
| --- | --- |
| `hgvs_nt`, `hgvs_splice`, `hgvs_pro` | the variant in MAVE-HGVS, in its level's column (`NA` in the others); a nucleotide variant of a DNA target also its protein change in `hgvs_pro` (MaveScape 0.3; `NA` for one that changes no amino acid it can name: a UTR, an intron, a splice site) |
| `score`, `SE` | the combined score and its standard error; `NA` when not scored |
| `ci95_lower`, `ci95_upper` | the 95% interval: score ± t × SE, t at the score's degrees of freedom (from MaveScape 0.2, with the moderated combination); ± 1.96 SE with the other combinations |
| `df` | the score's degrees of freedom (moderated combination, MaveScape 0.2); `Inf` for a score whose replicates' variance is known; `NA` with the other combinations |
| `SE_scale` | for rescaled scores (MaveScape 0.2), the rescaling anchors' uncertainty at this score, shared by every score and not in `SE`: needed to compare a score with another assay's or with the anchors' true values; `NA` without rescaling |
| `replicates`, `replicates_expected` | biological replicates used, and that could have measured it |
| `status` | `scored`, `low confidence`, `filtered: <stage>` (`target`, `identifier`, `class`, `excluded`, `input-count`, `total-count`, `barcodes`, `replicates`, `se`; published scores also `given`, `copy`, `merged`, `alike`) or `not measured` |
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

### Scores at the protein level (`*_protein_scores.csv`)

A run of nucleotide variants of a DNA target (MaveScape 0.3), read at the protein level as the map
reads it: one row per protein variant its nucleotide variants make, in order of first appearance,
the wild type first. The nucleotide variants that make the same protein change are merged as
DiMSum merges them (its default, `mixedSubstitutions = FALSE`): their scores weighted by 1/SE², the
merged SE √(1/Σ 1/SE²) (without every SE, the plain mean and an SE of `NA`); a variant that changes
one amino acid and leaves another codon synonymous is left out, as DiMSum leaves it out;
synonymous codons merge into their codon's `p.Ala12=`; frameshifts (MAVE-HGVS names every one at a
codon alike) and variants with no protein change stay in the nucleotide scores alone.

| Column | |
| --- | --- |
| `hgvs_pro` | the protein variant |
| `score`, `SE`, `ci95_lower`, `ci95_upper` | merged; the interval ± 1.96 SE (a single variant's own, for published scores that give one) |
| `status`, `flags` | `scored`, or why none of its nucleotide variants is scored; their flags |
| `variant_class` | its class |
| `nucleotide_variants`, `hgvs_nt` | how many nucleotide variants make it, and which (space-separated) |

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
  replicate its counts before and after and whether that replicate was used (or why not: from
  MaveScape 0.3, `outside its tile (another tile's replicates measure it)` where a sample holds
  several tiles).

### Selections

CSV (`hgvs_pro`, `score`, `SE`, `status`) or JSON (`format: "mavescape-selection"`, `name`,
`run`, `condition`, `created`, `query`, `keys`). `keys` are the variants' MAVE-HGVS names on the
run's map (a nucleotide run's: the protein variants it makes), in the order selected; a selection
by query lists them along the target, then by amino acid (`ARNDCQEGHILKMFPSTWYV*`). From MaveScape
0.4, `query` is the query that made the selection, in MaveScape's selection language
([Selections](https://robert-mcdermott.github.io/mavescape/docs/selections.html#query)), or
`null` when it was made or changed by hand: run on the same run, it selects `keys` again.

```json
{
  "format": "mavescape-selection",
  "version": 1,
  "name": "Disulfides",
  "run": "run-d34c038c88c5e0e9",
  "condition": 0,
  "created": "2026-10-11T22:40:00.000Z",
  "query": "missense from C in feature disulfide and lower",
  "keys": ["p.Cys69Glu", "p.Cys69Trp", "p.Cys97Ala", "…"]
}
```

The workspace keeps each saved selection as `{ id, name, run, condition, keys, query?, created }`
(`workspace.json` in the archive); one saved before 0.4 has no `query`.

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

### A MaveDB deposit (`*_mavedb.zip`; `mavescape export --format mavedb`)

MaveScape 0.3 (`web/lib/mavedb-export.js`): a run written as MaveDB takes a score set, one deposit
per condition. A ZIP dated with the workspace's modification time, or the same files in a folder
(`mavescape export`, a folder per condition when there are several):

| File | |
| --- | --- |
| `README.md` | what each file is, how to deposit them (on mavedb.org, or through MaveDB's API), what MaveDB requires that the workspace lacks, what was chosen to confirm, the notes |
| `scores.csv` | MaveDB's `scores_file`: the variant columns, `score`, and the other columns (below) |
| `counts.csv` | MaveDB's `counts_file`: the same variants, one column of counts per sample of the condition's replicates (technical replicates summed; a table of barcodes' summed per variant); for published scores, the record's counts as they are |
| `score_columns.json`, `count_columns.json` | MaveDB's `score_columns_metadata` and `count_columns_metadata`: each column beyond the standard ones, `{ "description", "details" }` |
| `experiment.json` | the experiment, the body of MaveDB's `POST /api/v1/experiments/` (its `ExperimentCreate`, in camelCase): `title`, `shortDescription`, `abstractText`, `methodText`, `keywords`, publications, `rawReadIdentifiers`, `contributors` |
| `score_set.json` | the score set, the body of `POST /api/v1/score-sets/` (`ScoreSetCreate`): `title`, `shortDescription`, `abstractText`, `methodText`, `licenseId` (MaveDB's: 1 CC0, 3 CC BY 4.0, 6 CC BY-SA 4.0), `experimentUrn` (`null` for a new experiment: MaveDB gives it one), `supersededScoreSetUrn`, `targetGenes`, publications, `doiIdentifiers`, `contributors` |
| `mavescape.json` | format `mavescape-mavedb`, version 1: the software, workspace, run (`outputSha256`, `published`), condition, `mode`, each file with its SHA-256, the variants exported and left out (each reason with its count and examples), `missing`, `defaulted`, `notes` |

The tables are written as MaveDB's validator checks them (MaveDB's own validators pass them:
validation suite `mavedb-export`): commas between values, no quoting (MaveDB reads a CSV with `'`
as its quote character, so no value or column name holds a comma or a quote), `NA` where missing,
numbers in their shortest exact form; no column without a value; one name per variant, strict
MAVE-HGVS. How the variants are named follows the target (`mode`):

| `mode` | Target in `score_set.json` | Variant columns |
| --- | --- | --- |
| `protein` | its sequence: the protein, or a DNA target from its coding start to its stop codon | `hgvs_pro` |
| `coding` | its sequence, a DNA target from its coding start to its stop codon (MaveDB counts from a target's first base) | `hgvs_nt` (c.) and `hgvs_pro`, each variant's protein change; a variant with none (in a UTR or an intron) is left out, as MaveDB takes c. names only beside a protein name and its validator stops at a missing one |
| `noncoding` | its whole sequence | `hgvs_nt`, written n. (g., m. and o. names count from the first base as n. does) |
| `accession` | `targetAccession`: the RefSeq or Ensembl transcript it was fetched as (the version checked), its gene | `hgvs_nt`, each name prefixed by the accession (`NM_007294.3:c.5565A>T`) |

For a run scored from counts, `scores.csv` holds `score`, `SE`, `ci95_lower`, `ci95_upper`,
`SE_scale` (with rescaling), `replicates` (combined), `tau2` and `I2` (when estimated), each
replicate's `score_<id>` and `SE_<id>`, `status` (scored, low confidence, filtered: the stage, not
measured) and `flags`; MaveScape's methods (paragraphs and references, in Markdown) are the score
set's `methodText`, after the researcher's note. Published scores pass through: the design's score
column is `score`, the table's other columns as they are (one MaveDB would refuse is left out and
said). The experiment's `keywords` are the design's readout and library method in MaveDB's
controlled vocabulary (the MAVE minimum information's; a term outside it is `Other`, described),
then the MaveDB details' for the other keys. Its `methodText` is the details' experiment method, or
the design's summary.

The **MaveDB details** (`ws.deposit`; `set_mavedb_details`; `mavescape export --details file.json`),
each optional:

```json
{
  "title": "GRB2 SH3 domain, abundance", "shortDescription": "…", "abstract": "…",
  "method": "A note before MaveScape's methods (for published scores: the whole method text)",
  "experiment": { "title": null, "shortDescription": null, "abstract": null, "method": "The assay, in the researcher's words" },
  "license": "CC0", "publications": [{ "db": "PubMed", "id": "29785012" }, { "db": "Crossref", "id": "10.1038/s41586-024-08370-4" }],
  "dois": [], "rawReads": ["PRJNA428380"], "contributors": ["0000-0002-1825-0097"],
  "experimentUrn": "urn:mavedb:00000835-a", "supersedes": null,
  "taxonomyId": 9606, "category": "protein_coding",
  "keywords": [{ "key": "Delivery Method", "label": "Electroporation" }]
}
```

The first publication is the primary one; `db` is `PubMed`, `Crossref` (a DOI), `bioRxiv` or
`medRxiv` (remote control and `--details` also take `"PubMed 29785012"` or `"doi:10.…"`).
`category` is MaveDB's `protein_coding` (the default), `regulatory` or `other_noncoding`. Where a
detail is not given, the deposit takes the record's (for published scores, or the experiment of a
MaveDB record), the design's (title, description, the data's license), CC0 (MaveDB's default), or a
sentence MaveScape writes (the short description), and says so (`defaulted`). What MaveDB requires
and nothing gives (an abstract; a target sequence's taxonomy id; a detail in a form MaveDB refuses)
is `missing`: the tables are written all the same.

A package opens again (Open files: its folder or ZIP) as a MaveDB record does: its published scores
read as published, its counts with a design drafted, its details kept; written again, its MaveDB
files are the same bytes (validation suite `mavedb-export`).

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
size. With tracks shown (MaveScape 0.3), they are below the grid as in the window, their names in
the margin, and their descriptions in the `<desc>`.

### The tracks (`*_tracks_*.csv`)

The tracks shown, position by position: `position`, `reference_position` (with an offset),
`residue`, then a column for each track: its value at the position (a variants track: its summary,
the count, largest or mean as the track draws it, and a second column, `<track>: variants`, each
variant there with its label; a features track: the features covering the position). Read again,
it is a custom track (above).

### Structure mappings

`<entry>_chain-<chain>_mapping.csv` (the Structure view's **Mapping**; `export` with `what:
"structure-mapping"`; MaveScape 0.5): the workspace's target on one chain of the structure shown,
one row per target position:

```csv
target_position,reference_position,target_residue,structure,chain,residue_number,insertion_code,structure_residue,state,ambiguous,entry_record_position,difference
54,212,Pro,2VWF,A,54,,Ala,different,,212,engineered mutation
```

- `target_position`, `reference_position` (the target's offset added: UniProt's numbering when the
  target is placed in its entry), `target_residue` (three letters);
- `structure` (the PDB ID, or the file's name), `chain`, `residue_number` and `insertion_code` (the
  entry's own numbering), `structure_residue`, empty for a position on no residue of the entry's
  sequence;
- `state`: `identical`, `different`, `unobserved` (in the entry's sequence, without coordinates),
  `deleted` (missing from the entry's sequence within the stretch it holds) or `outside`;
- `ambiguous`: `yes` where an alignment that scores the same places the position otherwise;
- `entry_record_position`: the UniProt position the entry's own record (`DBREF`,
  `struct_ref_seq`) gives the residue, to set beside `reference_position`;
- `difference`: the entry's reason for another residue (`engineered mutation`, `conflict`…), as it
  records it (`SEQADV`, `struct_ref_seq_dif`).

### Scores on a structure

`<entry>_chain-<chain>_<coloring>.csv` (the Structure view's **Colors**, under *Scores on the
structure*; `export` with `what: "structure-scores"`; MaveScape 0.5): the values the residues are
colored by, one row per target position, on the chain the target is mapped onto:

```csv
target_position,reference_position,target_residue,structure,chain,residue_number,insertion_code,structure_residue,coloring,value,state,substitutions_scored,substitutions_designed,color
25,183,Ile,2VWF,A,25,,Ile,median,-4.39105,scored,19,19,#195696
54,212,Pro,2VWF,A,54,,Ala,median,-0.299877,scored,19,19,#ecf2f5
```

- `target_position` to `structure_residue`: as in the mapping's file (above), the residue empty for
  a position on no residue of the structure;
- `coloring`: `median`, `mean`, `minimum`, `maximum` (of the position's missense substitutions
  scored, low confidence or not; at the first methionine, its start-lost substitutions), `fraction`
  (the share abnormal-like, by a threshold or a published calibration's abnormal classes), `count`
  (substitutions scored), `substitution:<letter>` (the score of one substitution; `*` a stop),
  `uncertainty` (the median SE), `disagreement` (the median difference between the two sides
  Compare shows) or `qc`;
- `value`: the position's value (6 significant digits); for `qc`, its class (`complete`, `low`,
  `partial`, `sparse`); `NA` where there is none;
- `state`: `scored`, `low confidence` (a value from scores of low confidence only), `filtered`
  (measured, nothing scored), `missing` (nothing measured), `not designed`, or `the residue itself`
  (one substitution: the wild type's own residue);
- `substitutions_scored`, `substitutions_designed`: of its missense substitutions (1 or 0 for one
  substitution);
- `color`: the residue's color as drawn (hex): the map's palette at the map's scale for scores,
  viridis for the rest; `#4f5357` filtered, `#8c8c8c` missing, `#cfcfcf` not designed; empty for a
  position on no residue.

### What a structure says of each position

`<entry>_chain-<chain>_evidence.csv` (the Structure view's **Evidence**, under *Structure as
evidence*; `export` with `what: "structure-evidence"`; MaveScape 0.5): one row per target
position, on the chain the target is mapped onto, with the median score of its missense
substitutions when there is a score run:

```csv
target_position,reference_position,target_residue,structure,chain,residue_number,insertion_code,secondary_structure,accessible_area,relative_accessibility,relative_accessibility_in_structure,ppse,disordered,plddt,partner_distance,partner,interface,interactions,structural_class,median_score
25,183,Ile,2VWF,A,25,,E,0,0,0,19,,,12.71,chain:B,,,buried,-4.39105
51,209,Tyr,2VWF,A,51,,G,80.7,0.307,0.06,13,,,2.88,chain:B,yes,Hydrogen bond PRO 4 · B,interface,-0.447693
```

- `target_position` to `insertion_code`: as in the mapping's file (above); the rest is empty for a
  position on no residue;
- `secondary_structure`: DSSP's code (`H` α-helix, `G` 3₁₀-helix, `I` π-helix, `E` strand, `B`
  bridge, `T` turn, `S` bend, `-` none);
- `accessible_area`: the residue's water-accessible area in its chain alone (Å², Shrake–Rupley with
  DSSP's radii and a 1.4 Å probe); `relative_accessibility`, relative to its largest (Tien et al.
  2013), and `relative_accessibility_in_structure`, among every protein chain of the structure (as
  DSSP computes it);
- `ppse`: the Cα atoms within 12 Å in a 70° cone of its side chain (StructureMap's part-sphere
  exposure); `disordered`: `yes` in a predicted model's disordered region; `plddt`: a predicted
  model's confidence;
- `partner_distance` (Å) and `partner` (`chain:<id>`, or `ligand:<chain>:<number>:<name>`): the
  nearest heavy atom of the partners chosen; `interface`: `yes` within 4 Å; `interactions`: those
  interactions.js finds there (PLIP's types), with what;
- `structural_class`: `disordered`, `interface`, `buried` (relative accessibility in its chain below
  0.25) or `exposed`;
- `median_score`: the position's median score (the map's run and condition), when there is one.

## Comparisons

A comparison (the Compare view, remote control's `compare`; MaveScape 0.4) pairs two sets of scores,
each a run's condition or one of its replicates, or a MaveDB score set or a predictor kept beside
the workspace (its `annotations`, above: `mavedb-scores`, `alphamissense`, `predictor`). It is a
view, not kept in the workspace: the runs and annotations are, each with its record, and the
comparison is made again from them. Its files, named after the two sides
(`<first>_vs_<second>_comparison*`):

**The variants compared** (`*_comparison.csv`), one row per variant scored on both sides and kept
by the filters, in the first side's order (the wild type left out):

| Column | Meaning |
| --- | --- |
| `variant` | the variant, as matched: its name on the target, or on the UniProt entry's coordinates (its position plus the target's offset) when the two targets are different stretches of one entry |
| `variant_a`, `variant_b` | as each side names it (a nucleotide run read at the protein level: its protein variant) |
| `class` | the first side's class of the variant (missense, nonsense, synonymous, …) |
| `score_a`, `SE_a`, `score_b`, `SE_b` | each side's score and SE as scored (`NA`: none) |
| `compared_a`, `compared_b` | each score as compared: rescaled by its side's anchors (`scale` below), or the second negated when the two directions are opposite (`bNegated` below); as scored otherwise |
| `difference`, `mean` | first − second and their mean, as compared |
| `z`, `p`, `q` | the difference over √(SE_a² + SE_b²) (rescaled, with the anchors' share of each score's variance added), its two-sided normal p, and q by Benjamini and Hochberg over the variants tested (`NA` where not tested: not on one scale, not independent, a predictor, or an SE missing); discordant where q < 0.05 |

**The disagreement by position** (`*_comparison_positions.csv`; two sides on one scale), one row per
position of the first side's target with variants compared (a nucleotide run's, by the protein
position each changes):

| Column | Meaning |
| --- | --- |
| `position`, `reference_position`, `residue` | the position on the target, on the reference (with the target's offset, or the entry's when matched on its coordinates), and the target's residue there |
| `variants` | the variants compared there |
| `mean_difference`, `rms_difference` | their mean difference (first − second) and its root mean square |
| `discordant` | how many of them are discordant |
| `z`, `p`, `q` | the position's z, the sum of its differences over √Σ(SE_a² + SE_b²) (rescaled, with the anchors' shared variance added), with 3 variants compared or more; its p; q by Benjamini and Hochberg over the positions tested (`NA` otherwise) |

**A predictor by its classes** (`*_comparison_classes.csv`; a predictor that classes its
substitutions, AlphaMissense or EVE), one row per class:

| Column | Meaning |
| --- | --- |
| `class` | the predictor's class (AlphaMissense: likely pathogenic, ambiguous, likely benign) |
| `variants` | the variants compared in it |
| `median`, `lower_quartile`, `upper_quartile` | the measured side's scores of them, as scored: median and quartiles (R's type 7) |

**The maps** (`*_first_map.svg`, `*_second_map.svg`, `*_difference_map.svg`): each side's map, as
the map's SVG export (above), and the difference's, colored by first − second centered on 0, its
legend saying so; a variant scored on one side only, or left out by the filters, is drawn filtered.

**The report and statistics** (`*_comparison.json`):

```json
{
  "format": "mavescape-comparison",
  "version": 1,
  "software": { "name": "MaveScape", "version": "0.4.0", "commit": "…" },
  "a": { "label": "Run 1: Replicate 1", "source": "run", "run": "run-…", "runName": "Run 1", "output": "<SHA-256>", "replicate": "rep1" },
  "b": { "label": "Run 1: Replicate 2", "source": "run", "run": "run-…", "runName": "Run 1", "output": "<SHA-256>", "replicate": "rep2" },
  "level": "protein",
  "coordinates": "target",
  "bNegated": false,
  "sameScale": true,
  "scale": { "mode": "scored", "applied": false, "anchors": null, "slope": null, "reason": null },
  "filters": { "lowConfidence": false, "maxSE": null, "minReads": null },
  "report": { "status": "ok", "items": [{ "id": "target", "status": "ok", "label": "Target", "text": "…" }] },
  "matched": { "n": 1109, "onlyA": 0, "onlyB": 0, "notScoredA": 1, "notScoredB": 2, "compared": 1109, "filtered": { "lowConfidence": 0, "se": 0, "reads": 0 } },
  "statistics": {
    "n": 1109,
    "pearson": { "n": 1109, "r": 0.874, "low": 0.860, "high": 0.888 },
    "spearman": { "n": 1109, "rho": 0.823, "low": 0.800, "high": 0.844 },
    "concordance": { "n": 1109, "ccc": 0.874, "low": 0.860, "high": 0.887, "r": 0.874, "accuracy": 1.0, "scaleShift": 0.98, "locationShift": 0.01 },
    "blandAltman": { "n": 1109, "bias": -0.019, "sd": 0.97, "lower": -1.909, "upper": 1.870, "biasLow": -0.076, "biasHigh": 0.037, "lowerLow": -2.007, "lowerHigh": -1.811, "upperLow": 1.772, "upperHigh": 1.969, "trend": { "slope": 0.018, "low": -0.012, "high": 0.049, "intercept": 0.06, "p": 0.24 } }
  },
  "discordance": { "valid": true, "reason": null, "tested": 1109, "discordant": 479, "dispersion": 8.15, "q": 0.05, "variants": [{ "variant": "p.Trp36Ala", "difference": 1.2, "z": 9.1, "q": 1e-17 }] },
  "positions": { "valid": true, "reason": null, "list": [{ "position": 36, "reference": 194, "residue": "W", "n": 20, "mean": 0.4, "rms": 0.9, "discordant": 9, "z": 7.2, "p": 6e-13, "q": 1e-11 }] },
  "classes": null,
  "withheld": []
}
```

Each side names its run's id and output hash, so the comparison can be traced to the two runs and
made again. A side is a condition (`condition`: its name) or a replicate (`replicate`: its id); a
score set or predictor kept beside the workspace is `{ label, source: "scoreset" | "predictor",
annotation, name, urn, file }` (its annotation's id and name, a score set's URN, the SHA-256 of the
file kept). `scale` says how the two were put on one scale: `mode` `scored` (as scored), `stated`
(stated by the person comparing them), `nonsense-wt` or `synonymous-nonsense` (each side rescaled by
its own anchors: `anchors.a` and `anchors.b`, each `[{ what, to, from, se, n }]`, the score each
anchor had, the value it is rescaled to, its SE and how many variants it is the median of; `slope`,
each side's), with `applied` and, when a side could not be rescaled, `reason`. A predictor is
compared by rank: `pearson`, `concordance`, `blandAltman`, `discordance` and `positions` are
withheld, and `classes` gives `{ valid, reason, predictor, measured, list: [{ id, label, n, median,
low, high }], auc: { m, n, auc, low, high, se, tolerated, damaging, measuredNegated, directionStated },
references: { synonymous: { n, median }, nonsense: { n, median } } }`: the measured side's scores in
each class, the AUC of telling the tolerated class from the damaging one (DeLong's 95% interval, as
pROC's `ci.auc`), and the measured side's synonymous and nonsense medians.
`coordinates` is `target` (variants matched by name on one target) or `reference` (two stretches
of one UniProt entry, matched on its coordinates). Each report item is `ok`, `qualified` or
`blocked`, with its words; the report's `status` is the worst of them. A blocked comparison has
`statistics: null`. On different or unknown scales (`sameScale: false`), `concordance` and
`blandAltman` are `null` and named in `withheld`. `matched.n` counts the variants scored on both
sides, `matched.compared` those the filters kept, and `matched.filtered` those each filter left out
(in that order: low confidence, SE, reads). `discordance` (`valid: false` with its `reason` when the
two are not independent or not on one scale, also named in `withheld`) gives the variants tested,
those discordant (q < 0.05) with their difference, z and q, and the dispersion, the median z² over
its expected value (about 1 when the SEs describe how far the two differ). `positions` is the
disagreement by position, as its CSV. Every interval is 95%: Pearson's from Fisher's
z; Spearman's from Fisher's z with Bonett and Wright's SE; Lin's from its z-transform (Lin 2000);
Bland–Altman's with t on n − 1 degrees of freedom, the limits' SE √(3 SD²/n); the trend's
(the least-squares slope of the differences on the means) with t on n − 2. A number that is not
defined (too few variants, no spread) is `null`.

## Robustness

A run's robustness to analysis choices (the Score view's Robustness pane, remote control's
`check_robustness`; MaveScape 0.4) scores the run again across other reasonable choices: each
alternative alone, then combinations drawn with a fixed seed (48 analyses by default). It is a view,
not kept in the workspace: the same seed makes it again. Its files, named after the run
(`<run>_robustness*`):

**The variants** (`*_robustness.csv`), one row per variant of each target (each condition, and each
difference between conditions) scored in some analysis:

| Column | Meaning |
| --- | --- |
| `target` | the condition, or the difference (`+Lon vs −Lon`) |
| `variant` | the variant (its key) |
| `class` | its class in the declared analysis: lower than the wild type, like it, higher, or not scored (a difference: lower, no difference, higher, not compared); q < 0.05 by Benjamini and Hochberg |
| `effect`, `SE`, `q` | in the declared analysis: its score less the wild type's (else the synonymous variants' median), its SE and q; a difference's own |
| `analyses`, `scored_in`, `class_kept_in` | the analyses scored, how many score it, how many give it its declared class |
| `verdict` | robust, fragile, depends on its uncertainty, borderline, its effect's size depends on a choice, not always scored |
| `depends_on` | the single choices its verdict comes from (`pseudocount 1; Replicate 2 left out`), else the smallest combination (`… (together)`); or, not always scored, those that leave it out |
| `effect_min`, `effect_max` | its effect's range across the analyses |
| `rank`, `rank_min`, `rank_max` | its place among the variants scored (0 the lowest effect, 1 the highest), declared and across the analyses |

**The positions** (`*_robustness_positions.csv`), one row per position of each condition: its
`position`, `reference_position` and `residue`, its `variants`, its `median_effect` (the median of its
substitutions', as the map's position effect) with `effect_min` and `effect_max`, its `rank` among the
positions (0: least function, the readout's direction taken) with `rank_min` and `rank_max`, and in how
many `analyses` it is among the least tolerant tenth (`least_tolerant_in`).

**The record** (`*_robustness.json`):

```json
{
  "format": "mavescape-robustness",
  "version": 1,
  "software": { "name": "MaveScape", "version": "0.4.0", "commit": "…" },
  "run": { "id": "run-…", "name": "Run 1", "output": "<SHA-256>" },
  "q": 0.05,
  "choices": [{ "id": "pseudocount", "label": "Pseudocount", "options": [{ "id": "declared", "label": "0.5" }, { "id": "pc-0.1", "label": "0.1", "parameters": { "pseudocount": 0.1 } }] }],
  "specifications": [{ "kind": "declared", "picks": [0, 0], "label": "the declared analysis", "scored": true, "error": null }],
  "analyses": 48,
  "targets": [{
    "id": "condition:all", "name": "All replicates", "kind": "condition", "reference": "the wild type", "classified": true, "variants": 1118,
    "counts": { "robust": 504, "fragile": 6, "uncertain": 445, "borderline": 133, "size": 11, "inclusion": 19, "added": 0 },
    "classes": { "declared": { "like the wild type": 488, "lower than the wild type": 623, "higher than the wild type": 7 }, "every": { "…": 0 } },
    "byChoice": [{ "choice": "pseudocount", "option": "pc-0.1", "phrase": "pseudocount 0.1", "changed": 14, "fragile": 0, "uncertain": 0, "borderline": 14, "size": 0, "lowered": 0, "raised": 0, "dropped": 0, "added": 0, "moved": 0, "typicalMove": 0.01, "rho": 0.999, "compared": 1118 }],
    "leastTolerant": { "size": 6, "every": 2, "wide": 6, "positions": [5, 25, 27, 38, 45, 47] },
    "text": "Of 1,118 variants …"
  }],
  "methods": "The scores were checked against 47 alternative analyses …"
}
```

Each choice lists its options, the first the run's own, each alternative with the parameters, filters
or replicate left out (`leaveOut`) it changes; each specification its option per choice (`picks`), its
kind (`declared`, `single`, `combined`) and whether it could be scored (`error`, when not). A target's
`counts` are its variants by verdict; `byChoice` each alternative alone: the classes it changes
(`changed`, by what changed: `fragile`, `uncertain`, `borderline`), the effects it moves while their
class holds (`size`), the variants it drops and adds, how far it moves the effects (`typicalMove`, the
median |z| of the moves in declared SEs) and their Spearman ρ with the declared. A move counts when
it is beyond the variant's declared 95% interval and more than five robust SDs (by the median
absolute deviation) from the median of that analysis's moves.

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

`mavescape export` (MaveScape 0.3) writes `export.json` beside its files: format
`mavescape-export`, version 1, the fields of `run.json` (its `inputs` the workspace archive and the
`--details` file), with `deposit` (`--format mavedb`: what the deposit holds and lacks, as the
`mavedb_deposit` action gives it) or `run` (`--format tables`).

## Remote control: `remote.json`

Started with `--remote-control`, MaveScape writes `remote.json` to its data folder
(`~/Library/Application Support/MaveScape` on macOS, `~/.config/MaveScape` on Linux,
`%AppData%\MaveScape` on Windows, or `--data-dir`), readable by its owner only, and removes it when
it stops:

```json
{
  "url": "http://127.0.0.1:8820",
  "token": "…",
  "version": "0.4.0",
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
