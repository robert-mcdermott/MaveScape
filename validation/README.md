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
| `hgvs` | `web/lib/hgvs.js` against mavehgvs 0.8.1 on 16,959 strings: the same decision, reason, canonical form and parts for every one; mavehgvs's 54 tests against a target sequence (wave 3, slice 3) decided the same | `reference/mavehgvs.json` |
| `consequences` | Full MAVE-HGVS (wave 3, slice 3; `consequence-cases.mjs`): each nucleotide variant's protein change (`web/lib/consequence.js`) as biocommons hgvs 1.5.7 gives it, on NM_007294.3, NM_000546.6 and ENST00000460680 (16,188 variants); GenBank records (`web/lib/genbank.js`) as Biopython 1.88 reads them; every variant of thirteen imported tables valid on its target; every protein name MaveScape writes strict MAVE-HGVS; the protein names five records publish beside their nucleotide names the same protein; VarChAMP's 28 targets one at a time, DDX3X's genome refused; the merge at the protein level (`web/lib/collapse.js`) as DiMSum 1.4's own code merges CBS's codon variants | `reference/consequences.json`, `genbank.json`, `dimsum-aggregate.json`; `fixtures/public-data/`; MaveDB, external |
| `experiment` | The design editor's operations rebuild each feasibility design; sample sheets (`fixtures/*.samples.csv`) and DiMSum's design file give the same designs; every validation design written back as a sample sheet reads as itself (wave 2 slice 10); the workspace history's chain survives saving and catches an edited entry | MaveDB and DiMSum, external; `fixtures/` |
| `scoring` | The scoring engine (`web/lib/score.js`) against Enrich2 2.0.2 (replicate and combined scores, all three normalizations), dms_variants 1.6.0 (`func_scores`) and metafor 5.2-1 (REML and fixed effects); the PRD's two-population edge cases on a synthetic fixture (`fixtures/two-population.csv`); rescaling; determinism, row- and column-order invariance and symmetry; runs that reproduce from a saved workspace; BRCA1's two assays drafted into two conditions; time series (wave 2): weighted and ordinary regression against Enrich2 2.0.2 (BRCA1 E2 and Y2H, the time-series fixture) and statsmodels 0.15 (the fixture), the time-series edge cases, the simulated truth and the 95% intervals' coverage, "Missing = 0"; sorted bins (wave 2): factor IX's published MultiSTEP scores reproduced from its counts, the maximum-likelihood fit against fitdistrplus, the simulated sort's truth, the bootstrap against the analytic SE, the scales; barcodes (wave 2): every barcode and every variant's summed counts against dms_variants 1.6.0 by barcode and by substitution, the counts read with MaveScape's map, in dms_variants' `variant_counts` and in Enrich2's layout, the barcode fixture's truth and planted outliers, row order, refusals; DiMSum's model (wave 2): the threshold, the variants fitted, the scales and shifts, the error model, every fitness and σ and the merge against DiMSum 1.4's own functions on the fixture, GRB2 and DiMSum's demo, GRB2's published scores, the 95% intervals' coverage under a simulated bottleneck, refusals; differential scores (wave 2): limma against mutscan 1.2.0 on the two-condition fixture and CBS, Enrich2's z between conditions, the paired differential from first principles, the edge cases, the truth; scores per unit of time against the whole-course scores, DiMSum's model on a table of barcodes, the bins' defaults without the wild type (wave 2 slice 10) | `reference/enrich2.json`, `dms_variants.json`, `dms_variants-barcodes.json`, `metafor.json`, `statsmodels.json`, `fitdistcens.json`, `dimsum.json`, `mutscan.json`, `fixtures/`; MaveDB and DiMSum, external |
| `qc` | Quality control: simulated experiments with one problem each (`qc-cases.mjs`, `web/lib/simulate.js`: two populations, time series, sorts and barcoded libraries) raise exactly their findings, clean ones none, on three seeds; the variance check against simulated bottlenecks, and DiMSum's terms placing them before or after selection; invariance to row order and to a run; thresholds; the feasibility data's findings, locked as found; findings in context (wave 2 slice 8): every raised finding says what could cause it and what to do, the readout's direction, coverage of a single-base library, where BRCA1 Y2H's stops stop losing the function; the cells recorded against simulated bottlenecks (wave 2 slice 10) | simulated; MaveDB, external |
| `map` | The variant-effect map: the fixture's SVG against `golden/two-population.map.svg` (`UPDATE_GOLDEN=1` rewrites it), each state where planted, state colors apart from the neutral color (CIEDE2000) in every theme, the scale, row orders; GRB2's numbering and BRCA1's least tolerant positions | `fixtures/`; MaveDB, external |
| `roundtrip` | The record: the fixture and the GRB2 example as workspaces saved as `.msz`, reopened and saved again (the same bytes), every export again byte for byte, exported scores and counts imported again without loss, tampered, hostile and foreign archives caught, the examples and the blank layouts checked; an acknowledged finding through the archive; the archive each release saved (`archives/`; 0.3.0's three, from MaveDB; 0.4.0's two, with score sets kept beside and selections by query; 0.5.0's two, with saved views of structures; 0.6.0's two, with figures, kept analyses and checkpoints, and its certificate; 0.7.0's two, with an AI agent's proposals decided and one open, and its certificate) opened, its runs reproduced, its annotations' tracks read again, its kept score sets read again, its saved queries run again and its saved views' structures read again and mapped as saved; the analysis package (wave 2 slice 10) scored from its own files to the run's output hash, its sample sheet read as its design, the same bytes twice | `fixtures/`, `web/examples/`, `archives/` |
| `import` | The importer on the feasibility tables (every name valid against its target, missing never 0, designs drafted from column names with the hand-written designs' shape), on shuffled, split and part-read copies, on DiMSum's demo, and on a table with one problem of each kind (`fixtures/malformed-counts.csv`) | MaveDB and DiMSum, external; `fixtures/` |
| `readiness` | What each analysis can do with what a workspace holds (wave 2, slice 10; `readiness-cases.mjs`): the six examples, the five fixtures and a simulated bottleneck with its cells recorded, whole and with one part taken away (the wild-type row, a replicate, the gates, the cells, the times in generations, the middle time points, the readout, the nonsense or synonymous controls), 74 workspaces. The readiness model must name exactly what was taken away, and its verdict on every analysis must agree with the engine: each scoring analysis scored or refused with the parameters that use it, each QC finding assessed or not, and an analysis it leaves out for a design one the engine cannot do there either. An empty workspace and a broken design | `web/examples/`, `fixtures/`, simulated |
| `examples` | Every bundled example opened as the window opens it (wave 2, slice 11; `example-cases.mjs`): assembled (Hsp90's codon variants read at the protein level), scored with its parameters, raising exactly the QC findings it teaches, its readout stated and its readiness naming what its guide points to, at most six guided steps; the published examples' counts MaveDB's, byte for byte. Hsp90's codons (568 rows, 188 protein variants, the wild type's nine copies read once) and its per-generation scores against the published fitness; a single replicate's own SEs; factor IX against MultiSTEP's scores; the simulated problems against their truth, with and without replicate 3. Wave 3, slice 6: DHFR's two score sets opened together (each replicate measuring only its own sub-library, none combined twice; the scores against the published ones with the defaults and with the authors' unweighted regression; Lon's effect as the paper found it: the published 736 and 384 advantageous substitutions, about twice as many without Lon here, the differences called negative, most at native hydrophobic residues) and BRCA1 RING from MaveDB and back (every published replicate score with the defaults, within 2 × 10⁻¹⁴; the combined ones with the Enrich2-compatible preset; its zinc ligands among its least tolerant positions; Run 1 deposited and read back exactly, written again the same bytes). Wave 4, slice 6: TP53's two screens (the target checked against UniProt's P04637, P72R; Kotler et al.'s 936 protein variants merged from 2,908 rows and its 191 frameshifts left out, the report saying so; as published r −0.78, as stated 0.78, rescaled Lin's concordance 0.78 and a bias of −0.04; the positions that differ most; nutlin-3 against etoposide) and Hsp90 against its record's own scores kept beside (r 0.95; stated on one scale, Lin's concordance 0.48, a bias of 0.22, a Bland–Altman slope of −0.91, the differences largest at 585–587), each number as the guide states it. Wave 6, slice 8 (`example-lessons.mjs`): GRB2's figure (its map, the view Core and the variance beyond counting, acknowledged; its PDF's manifest naming Run 1, the acknowledgement and the view, read back unchanged, the map and QC panels saying a later rescoring); Hsp90's checkpoint before its first three samples are fitted (148 of 188 variants moved in Run 2's units, 102 changed class, the same per generation and computed apart; the stops' −0.41 per generation against −0.32; 584, 588 and 589 barely fallen; the pseudocount moving none); BRCA1 RING certified (110,975 numbers, verified bit for bit, its review report's numbers the certificate's) and without its tables (MaveDB's SHA-256, not checkable alone, verified with MaveDB's files). 57 checks | `web/examples/`; MaveDB, external (`mavedb-hsp90`, `mavedb-factor9`, and `mavedb-pten-vampseq` for the PTEN example opened from MaveDB, wave 3 slice 2; `mavedb-dhfr` and `mavedb-brca1-ring` for slice 6; `mavedb-tp53-screens` for wave 4, slice 6) |
| `public-data` | UniProt's and MaveDB's answers as MaveScape's fetcher cached them (wave 3, slices 1 and 2): every cached answer with its retrieval record; each published example's target where its design says in its UniProt entry (identical, at one place, the entry changing nothing in the design); GRB2's whole sequence looked up, P62993 first; the GRB2 example checked as its guide says, the design unchanged and the methods naming the check and citing UniProt; the feasibility records (four MaveDB score sets) read with no code for any of them, their published scores read as published equal to MaveDB's columns row for row, their counts drafted into valid designs (GRB2's and factor IX's as documented, but for the bins' values); keywords as the readout; a record whose target is an accession, and a record of scores alone, its readiness naming the counts and where they may be; a workspace of published scores through its archive, its run reproduced; GRB2's mapped variants (wave 3, slice 3) each joined to its row of scores, its protein on NP_002077.1 the table's at the target's position plus the UniProt offset | `fixtures/public-data/`; MaveDB, external |
| `annotations` | Sequence tracks and annotations (wave 3, slice 5; `annotation-cases.mjs`, the fetcher's cached answers served by `cached-fetch.mjs`): conservation from an alignment as Capra & Singh's `score_conservation.py` scores it, and PDBe-KB's profiles as its divergence gives them; UniProt's features the same from its JSON and its GFF3; AlphaMissense as AlphaFold DB's tables give it; ClinVar's records of GRB2 and F9 with ClinVar's own classifications; gnomAD's frequencies of BRCA1's variants against MaveDB's own join of gnomAD to its saturation genome editing score set; MaveDB's annotations joined to the BRCA1 example's run; annotations kept through an archive; the tracks' table read back; what each provider asks; the GRB2 example as its guide says | `reference/annotations.json`; `fixtures/public-data/`, `fixtures/annotations/`; the BRCA1 example's table, external |
| `mavedb-export` | MaveDB deposits (wave 3, slice 4; `mavedb-export-cases.mjs`): 19 deposits (`web/lib/mavedb-export.js`) of every kind of run and target, from the examples and published records, checked by MaveDB's own validators: every table accepted by `validate_and_standardize_dataframe_pair` with its column descriptions and targets (mavehgvs against a sequence, biocommons hgvs against a transcript), every name strict MAVE-HGVS, the experiment and score set taken by MaveDB's models where MaveScape says nothing is missing and refused for what it says is; the files written now those the reference checked (each SHA-256); export → import → export the same bytes; MaveScape's keyword vocabulary MaveDB's | `reference/mavedb-export.json`; `fixtures/public-data/` (`mavedb-keywords.json`, the transcripts); MaveDB, external |
| `compare` | Comparisons within a workspace (wave 4, slice 1; `compare-cases.mjs`, `web/lib/compare.js`, `web/lib/agreement.js`): the agreement statistics of seven pairs equal R's (`reference/compare.json`, by `reference/generate_compare.R`: `cor.test`, Spearman with Bonett and Wright's interval, DescTools' `CCC`, BlandAltmanLeh, `lm`) to 10⁻¹⁰; their 95% intervals' coverage in 2,000 simulated pairs of known agreement of each of five kinds (94–96%; Spearman's near r = 1 and Lin's with 30 variants on two scales reported apart, as they are); slice 2: the discordance and disagreement by position of 600 variants equal R's (`pnorm`, `p.adjust`), and in simulated pairs with planted differences the planted found (96%), the false calls within BH's 5%, none called with nothing planted (dispersion about 1); the compatibility report's rules on GRB2 (replicates, a replicate inside its run, one table scored twice, a run moved along UniProt P62993 and matched on its coordinates, the same blocked without an accession, a direction stated the other way) and the files; then BRCA1's counts against its published scores, DHFR's Run 1 against each record, DHFR's two published score sets matched as R's merge matches them, and BRCA1 RING's replicates sharing their input; DHFR's discordance its Run 1's own differential z, its filters, its difference map; GRB2's dispersion where QC finds variance beyond counting; slice 3: two assays on two scales rescaled by their anchors (both rescalings) equal R's with the anchors' SEs and the tests' share, GRB2's published scores against AlphaMissense by class equal R's (pROC's DeLong interval) and an AUC with ties, the anchors' uncertainty keeping false calls to 3.5–4% of null pairs (10–55% without it), DeLong's interval holding the AUC 94–95% of the time, GRB2's Run 1 against its record kept beside the workspace (rescaled, ρc 0.996) and against AlphaMissense, a score set and a predictor through the archive, DHFR's record kept the same as opened, DHFR's published pair stated on one scale, PTEN's abundance against its phosphatase activity and against AlphaMissense. 36 checks | `reference/compare.json`; `fixtures/public-data/` (GRB2's record, AlphaMissense); MaveDB, external (`mavedb-brca1-sge`, `mavedb-dhfr`, `mavedb-brca1-ring`, `mavedb-pten-vampseq`, `mavedb-pten-phosphatase`) for the last checks |
| `robustness` | Robustness to analysis choices (wave 4, slice 4; `robustness-cases.mjs`, `web/lib/robustness.js`): GRB2's specifications (the declared first, each alternative alone, seeded combinations, none twice); the declared analysis the run to the last bit; the classes against an independent computation (z against the wild type, t on the moderated degrees of freedom, Benjamini–Hochberg); ten simulated experiments with planted fragile results, declared by fixed effects: the fragile variants exactly the replicate-driven ones and those whose effect's size depends on the pseudocount exactly the zero-count ones, every time, the clearly lost robust; under MaveScape's defaults the replicate-driven effect not called and nothing fragile; GRB2's check (fixed effects not tried, the alternatives' rank correlations, the least tolerant positions) and its files the same bytes twice; DHFR's 377 differences (54 in every analysis). 9 checks | bundled; MaveDB, external (`mavedb-dhfr`) for the last check |
| `selections` | Selections (wave 4, slice 5; `selections-cases.mjs`, `web/lib/query.js`): the roadmap's phrases parsed as written and mistakes named in place; fourteen queries on GRB2's Run 1 against an independent account of each of its map's 1,176 cells read from the run's own arrays, the same variants in the same order; union, intersection and difference by query against the sets' own, De Morgan's laws, a saved selection on a second run (scored as Enrich2 does); each robustness verdict exactly GRB2's check's, and in three planted experiments (seeds 41–43) `fragile` and `size depends on the pseudocount` exactly the planted ones; factor IX's `feature disulfide` the 22 bonded cysteines of UniProt P00740 and the example's numbers; freeform shapes against the rectangle tool and a circle; the selection's files and the archive keeping its query. 8 checks | bundled |
| `structures` | Structures (wave 5, slices 1–6; `structure-cases.mjs`, `web/lib/structures.js`, `web/lib/mapping.js`, `web/lib/structure-scores.js`, Proteoscope's `web/lib/structure/`): each example protein's PDB entry (2VWF, 1JM7, 2CG9, 1RX2, 1RFN, 1TUP, 1D5R), read as the page reads it from the fetcher's cached answer, holds its target in the chain its guide names on the UniProt residues the entry gives, its cartoon drawing at least 95% of the chain's residues and ball and stick every atom but water and hydrogens; each protein's AlphaFold DB model a predicted model, its mean pLDDT within 0.05 of AlphaFold DB's own and its share in each confidence band within 0.01; 2VWF as gzipped mmCIF, RCSB's PDB-format file and BinaryCIF, and GRB2's model as mmCIF and BinaryCIF, the same atoms (to 0.001 Å); assemblies built with the atoms estimated, 3OG7's two its two chains, hemoglobin's (1HHO) the dimer moved whole by symmetry; on 1RFN the bonds drawn between cysteines' sulfur atoms the entry's own disulfide records, as factor IX's guide says; on 1TUP the residues within 4 Å of the DNA by the selection language those every distance finds, R248 and R273 among them. Slice 2: each example's target aligned to its entry places every residue where residue-level SIFTS does (`reference/sifts.json`, PDBe's updated mmCIF read with gemmi by `generate_sifts.py`) and calls not observed those SIFTS does, the one parting (PTEN's join in 1D5R) ambiguous; on each AlphaFold DB model, every position on the residue numbered as its reference, another residue exactly where the target differs; 2VWF's engineered mutation (also from its PDB-format file), 1RFN's light chain at 132–188 with its record five earlier, PTEN's removed loop, as the guide says; each target's structures ranked from PDBe's answers. Slice 3: each example's run, scored in Node, colored on its entry by every coloring, every residue of every chain that holds the target given the value its position's missense substitutions have in the run's results (read without the map's model: `positionScores`) and the map's color for it, every position with nothing scored gray, at least 100 (RGB) from the wild type's color; each example's ten least tolerant positions, selected on the map as `at` selects them, drawn on the residues SIFTS places them on and picked back; the GRB2 guide's account from the atoms (the least tolerant packed, the Gab2 peptide's neighbors, selected in its words, tolerant), its numbers in the guide; PTEN's fraction abnormal-like by two of its published calibrations, as the record's own JSON gives their ranges. Slice 4 (`web/lib/structure-evidence.js`, Proteoscope's `exposure.js` and `interactions.js`): each entry's secondary structure and accessibility as DSSP 4.6.1 gives them (`reference/dssp.json`, the DSSP databank's output read with gemmi by `generate_dssp.py`: every code but 1D5R's five π-helix residues, the area within 1 Å² on average); each chain's partners as every pair of atoms gives them; Mann–Whitney's test and BH's adjustment as SciPy's (`reference/mannwhitney.json`, `generate_mannwhitney.py`); disorder on the models read with their aligned error (PTEN's tail, p53's ends); the structure's tracks beside GRB2's map, queried by class; the cluster test calibrated on simulated maps of 1D5R and 1TUP (burial alone: 3–6% at p ≤ 0.05; burial ignored: every map; a planted patch: 62–71%); the PTEN guide's account, its domains UniProt's. Slice 5 (`web/lib/structure-record.js`): a saved view of each example protein's PDB entry and AlphaFold DB model (14) through the workspace archive, every structure's file the same bytes and every view the same, the mapping made again from each file the one its view was saved with; named by checksum only, no file in the archive and none said missing, each fetched again by its ID the file recorded; the methods of GRB2's run with a view of 2VWF (the entry, its retrieval and SHA-256, the mapping, the engineered difference, the view, each method cited). Slice 6 (`web/lib/proteoscope.js`): the Proteoscope session of each example's run on its entry and its AlphaFold DB model (16), each position's median, as the run's results give it, on the residue Proteoscope's reader keys it on, every scored position on a residue with one, the range centered on the wild type, the link read back with zlib as sent. 24 checks | `fixtures/public-data/` (`pdb/`, `alphafold/`, `pdbe/`, `uniprot/`), `fixtures/structures/`, `reference/sifts.json`, `reference/dssp.json`, `reference/mannwhitney.json` |
| `figures` | Figures (wave 6, slice 1; `figure-cases.mjs`, `web/lib/figures.js`, `web/lib/figure-map.js`, `web/lib/draw.js`): nine examples' maps (GRB2, Hsp90, factor IX and the six simulated) as a panel of a figure two columns wide with their built-in tracks: every cell the color `map-svg.js` gives it, by its title (9,681 of factor IX's); the PDF drawing what the SVG draws, its content streams read back (`readPDF`) giving the same filled rectangles in the same order, colors exact and places within 0.006 pt, and the same text as WinAnsi; written again, the same bytes, the page 174 × 120 mm; the text at 7 pt, none under 6 pt and nothing said wrong, every track's name whole; factor IX's positions 200–260 exactly their 1,281 designed cells, its 461 positions in one column said to be too narrow; the simulated two conditions' difference cell for cell; a figure through the workspace archive the same document and the same SVG; slice 2: every QC finding with a plot of eight examples as a panel one column wide (96), each bar the QC results' value, every point and line point drawn, each class's count, at least 80% with no text under 6 pt (the rest said); the scores by class each class's count read from the run; a contrast's volcano a point per difference; a variant's evidence each replicate's score and the combined interval as `intervalOf` gives it, with a time course and bins; GRB2's Run 1 against its Enrich2 rescoring a point per variant compared, in order of its scores; a figure of every kind of panel, its PDF the SVG's rectangles and text and its structure image the PNG byte for byte; slice 3 (`web/lib/figure-manifest.js`): a figure of GRB2's and factor IX's maps, GRB2's scores and two QC findings and text, its manifest read back intact from SVG, PDF, PNG and JSON, a manifest edited three ways caught by its fingerprint, GRB2's Enrich2 rescoring flagging exactly GRB2's four panels, stricter depth thresholds flagging both QC panels and drawing only the depth panel otherwise, and the figure rebuilt from its manifest in a copy of the workspace the same drawing panel by panel and the same SVG bytes. 18 checks | bundled |
| `report` | The report (wave 6, slice 4; `report-cases.mjs`, `web/lib/report.js`): GRB2's workspace built in Node one operation at a time (its run, its target checked against UniProt P62993, an Enrich2 rescoring, a QC threshold changed, a finding acknowledged, a selection by query, the comparison of the two runs and Run 1's robustness kept in the report, UniProt's features beside the map, a saved view of 2VWF, a figure), each operation's sentence in the report and the decision log the history entry by entry; the example opened and scored alone with only its data, design, scoring, QC, inputs, software, log, limitations and use, citing what its run's methods cite; each of the 14 examples' runs, the report's data, design, scoring and QC its methods word for word, the same references in the same order; every reference with a DOI (43) against Crossref's record of it (`fixtures/crossref.json`, recorded by `fixtures/make-crossref.mjs`: title, journal, year, volume, issue, first page or article number, first author; for three references a field Crossref records otherwise left out, each said); references numbered in citing order, one BibTeX entry each with its own key; the same text again, from a copy and from the archive, which carries it; a run removed takes out the comparison that read it. 8 checks | bundled |
| `diff` | Checkpoints and the diff (wave 6, slice 5; `diff-cases.mjs`, `web/lib/diff.js`): from a checkpoint of GRB2's run, five planted changes (the pseudocount 0.5 → 1 and the minimum input count 1 → 10, each scored again; Replicate 3 left out of the design and scored again; the replicate agreement threshold to review 0.8 → 0.9; the readout's mechanism edited), each described exactly and nothing else (the run scored, the parameter or design change, the threshold, the readout, and the QC verdicts that moved: agreement pass → review, the outlier-replicate finding no longer assessed with two replicates); the variants each rescoring moved beyond the earlier 95% interval, crossed a class, were filtered or newly scored, equal to a computation apart (`movedApart`: effects against the wild type, t p-values, Benjamini–Hochberg); an analysis against itself and a checkpoint against the workspace it was kept from unchanged; a checkpoint through the archive (its name, the history's hash, its state's SHA-256) giving the same changes; the map of the change a cell for each variant scored in both; the report naming the checkpoint. Wave 6, slice 8: Hsp90 scored per generation, then over its whole time course: none moved in the earlier run's units, none changed class. 7 checks | bundled |
| `certificate` | Reproducibility certificates (wave 6, slice 6; `certificate-cases.mjs`, `web/lib/certificate.js`): GRB2's workspace of every operation (two runs, a threshold changed, a finding acknowledged, a selection, a comparison and a robustness check kept in the report, an annotation, a structure view, a checkpoint, a figure of six panels: a map, a QC finding, the scores by class, a comparison, a variant's evidence, text) certified, each kind of number what is computed apart from the certificate (each run's scores, SEs and classes by scoring and `callsOf`; its QC, every number and each finding; the comparison and robustness check as the report keeps them; each panel drawn from the numbers computed apart; the report), and verified bit for bit; made again, the same bytes; its fingerprint the SHA-256 of `certificate.json`'s canonical JSON without it (computed with Node's own SHA-256), named in README.txt with what it proves and how to verify; the selection and structure view said not computed again; verified by another version and said so; six kinds of tampering caught and said, the archive's manifest made to list each change (a count changed in its table; a score changed in its last bit, with and without its fingerprint made again; a run's pseudocount, a history entry's words and a checkpoint's state edited, `certificate.json` made to agree); without its tables, not checkable (exit 2), the table named, then verified with it beside; each of the 14 examples opened as the window opens it, certified and verified (172,383 numbers); each earlier release's archive (0.1 to 0.7) certified and verified, 0.7.0's with a proposal open refused until it is accepted, and 0.6.0's and 0.7.0's own certificates verified. 7 checks | bundled |
| `review` | The review report (wave 6, slice 7; `certificate-cases.mjs`'s `checkTraced` and `externalReferences`, `web/lib/review.js`): GRB2's workspace of every operation, its review report's every traced number (182: each run's output, each QC finding's verdict, measure and acknowledgement and its QC's digest, each kept analysis's statistics and verdicts, each figure panel's drawing, the report; each parameter and recorded value; the counts by class) where it says it comes from: the certificate's value under its key, the workspace's at its path, a count of the certificate's classes; the file loading nothing (no element, CSS or address that loads, its only links DOIs; an image, a stylesheet and a request planted in it caught); made again, the same bytes, and from the certificate verified the same as its maker's, none from a tampered one; every section, the certificate whole in its JSON block (its fingerprint its own), each input's SHA-256, a map for each condition and difference, the QC findings' plots, each figure, the report's sections and references, every history entry; the 14 examples' reviews, every traced number as recorded (1,164) and nothing from outside. 5 checks | bundled |
| `controls` | Control sets, for calibration (wave 8, slice 1; `control-cases.mjs`, `web/lib/controls.js`): factor IX's ClinVar controls under four rules (the default, at least one star and missense; any review and every kind; two stars; three stars), every control, its side, stars, records, latest evaluation and kind as an account read straight from NCBI's cached answers gives them, with a reader of its own (169 P and 22 B by default); matched to the example's Run 1, each scored, not scored or not in the run as its scores export has it; a table of invented labels for GRB2 (`fixtures/controls/`) with every case a reader meets planted; each kind of circularity planted (scale anchors, the design's named controls, the assay's own publication, ClinVar classifications evaluated since the assay, as many as the account dates, few controls, a predictor set with ClinVar) and none for a clean set; the sets through the workspace archive and a checkpoint's diff. 5 checks | `fixtures/public-data/` (ClinVar's answers for F9), `fixtures/controls/` |
| `calibration` | Calibration's metrics (wave 8, slice 2; `calibration-cases.mjs`, `web/lib/calibration.js`) against R (`reference/calibration.json`, below): on seven cases, the ROC curve's points, the AUC and DeLong's interval as pROC 1.19 computes them; the precision–recall curve's points and area (Keilwagen et al. 2014's interpolation) as PRROC 1.4's; each rule's thresholds (the rule error at 5% and 10%, Youden's J, given), each side's controls in each class and Wilson's intervals as binom 1.1's, all to 13 digits; the stratified bootstrap (2000 samples) as distributions: every quantile of R's (2.5%, 50%, 97.5%; the AUC, the sensitivity at 21 specificities, the precision–recall area, the precision at 20 recalls, each rule's thresholds) where it falls among MaveScape's samples, within four standard errors (1,092); factor IX's scored controls (`fixtures/controls/factor9-run1-controls.csv`) still what the example makes; calibrations through the workspace archive and a checkpoint's diff, deleted with their control set. Slice 3 (`web/lib/oddspath.js`): OddsPath against Brnich et al. 2019's own spreadsheet (`reference/brnich-oddspath.json`, below), every row of its Tables S1 and S2 but one whose counts cannot be (Table S2's row 63), both readouts', to 15 digits; Table 3 at and around each threshold; 11 controls the fewest with which both readouts reach moderate (Table S2), as the paper says; Figure 1's example, 0.24 for a normal readout, BS3_supporting by Table 3; factor IX's calibration's evidence (each class's OddsPath on its counts, the seeded bootstrap the same twice) and its limitations. 9 checks | `reference/calibration.json`, `reference/brnich-oddspath.json`, `fixtures/controls/factor9-run1-controls.csv` |
| `likelihood` | Score-level likelihood ratios (wave 8, slice 4; `likelihood-cases.mjs`, `web/lib/likelihood.js`, `web/lib/rcompat.js`) against R and acmgscaler (`reference/likelihood.json`, below): R's random numbers (four seeds' 624 words of state, first uniforms and 80 draws from sample()) the same; R's kernel density, bw.bcv bandwidth, isoreg, optimize, approx, seq, mad, qbinom and Spearman within 1e-11; acmgscaler 1.0.0 on its own example by gene, at Pejaver et al.'s prior, on negated scores and on factor IX's Run 1 with its 8,827 unlabeled variants (`fixtures/controls/factor9-run1-scores.csv`, still what the example makes): every ratio, interval and evidence, every threshold, to 1e-12; c from the prior (350 at 0.1, 1,131 at 0.0441) and Pejaver et al. 2022's Table 1 at c = 1,124 as printed; MaveDB's published calibrations of six records read as MaveDB means them (105 ranged classes counted as MaveDB counts them, 12 stated strengths Table 3's, 17 calibrations' thresholds classing the scores as published); Fayer et al. 2021's BRCA1 OddsPath from their data (`fayer-brca1`), 52.4 and 0.02 as published; factor IX's published scores with the investigators' thresholds, every control classed as published, beside the record's ExCALIBR calibration. 8 checks | `reference/likelihood.json`, `fixtures/controls/factor9-run1-scores.csv`, `fixtures/public-data/mavedb/`, cache: `fayer-brca1`, `mavedb-brca1-sge`, `mavedb-pten-vampseq`, `mavedb-pten-phosphatase`, `mavedb-tp53-screens`, `mavedb-tp53-dbd`, `mavedb-factor9` |

## The remote-control session (`remote-session.mjs`)

`node validation/remote-session.mjs [--verbose] [--like-ci [rate]]` builds MaveScape, starts it with
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
byte Node's; and (wave 3, slice 1) the session runs `--offline` on UniProt's answers as the
fetcher cached them (`fixtures/public-data/`): `check_target` places GRB2's domain from the
cache, refuses another protein's entry and, offline, an entry not cached, and with `apply` keeps
the check with the workspace, the design and its run unchanged; the methods and the archive keep
it; and every request the page makes in the whole session, recorded through the DevTools
protocol, goes to its own origin, none beyond; and (slice 2) `search_mavedb` and `open_mavedb` on
the cached answers: GRB2's record opened by its MaveDB address, both tables MaveDB's as pinned, the
published scores' run with Node's output hash, a record whose table is not cached refused offline;
and (slice 3) GRB2 opened with MaveDB's mapped variants, `inspect_variant` giving p.Thr1Ter's
reference HGVS (NP_002077.1:p.Thr159Ter) and VRS identifier; BAP1's exon 1 opened on Ensembl's
cached transcript, its version said, its run Node's, a merged protein variant inspected (its
nucleotide variants listed in the inspector), the scores at the protein level exported as Node
writes them, and the map described at the protein level; and (slice 4) `mavedb_deposit` on BAP1's
published scores (named by ENST00000460680.6, nothing missing), `export` of `mavedb` the same
bytes as Node writes it (suite `mavedb-export`; Node's needs `mavedb-bap1-sge`, which CI's `remote`
job fetches, and `--require-data` requires), the deposit opened again from its folder and from
its ZIP and written again the same, and GRB2's MaveDB details set by `set_mavedb_details` (an
unknown one refused), its deposit's scores, counts and method text; and (slice 5) `list_tracks`
(the run's own four, hidden until shown), `add_track` from the cached answers (UniProt's features,
PDBe-KB's conservation, AlphaMissense, ClinVar, gnomAD) and from files (an alignment, UniProt's
GFF3), refused twice or for a run not from MaveDB, `set_track` (shown, moved, filtered; not in the
history), `inspect_variant`'s annotations, the tracks' table and the map with its tracks the same
bytes as Node's from the archive, the methods citing each source, `remove_track`; and (slice 6)
`open_mavedb` with DHFR's two URNs (from `mavedb-dhfr`, copied into the session's cache when
present; `--require-data` makes them required, as CI's `remote` job does after fetching them): both
records kept, a published run each, their counts joined with a design drafted as a condition each
in hours; `open_example "dhfr-lon"` with Node's output hash, its map on +Lon − −Lon, and Run 1
reproduced from the joined table's two files; and (0.3.0's release) GRB2's target checked against
UniProt after its run, the run's ClinVar refused before the check (no gene) and added after it;
and (wave 4, slice 1) `compare` on GRB2's replicates, on Run 1 against Run 2 (one table scored
twice) and against Run 3 (DiMSum's fitness: two scales, concordance and Bland–Altman withheld),
each the report and statistics Node gives for the runs it recomputes from the exported archive,
`export` of the comparison (CSV and JSON) as Node writes it, and a side that does not exist
refused; and (slice 2) `compare` with a filter (SE at most 0.3), its discordant variants and
disagreement by position as Node gives them, `export` of `comparison-positions` and
`comparison-map` (the difference and the second side's map) the same bytes as Node's; and (slice 3)
`compare` with GRB2's record by its URN (fetched from the cache and kept beside the workspace
without opening it) rescaled by their anchors, and with AlphaMissense by class, each as Node gives
them, `comparison` and `comparison-classes` the same bytes as Node's, and a scale not known
refused; and (slice 4) `check_robustness` on Run 1 (24 analyses), its record, variants and positions
the same bytes as Node's check of the run it recomputes from the archive, the inspector's block, too
few analyses refused; and (slice 6) the TP53 example opened offline (its tables copied into the
session's cache from `mavedb-tp53-screens`), its target checked against UniProt's P04637, and both
other screens compared by URN, as published and rescaled by their anchors, the statistics and report
as Node gives them; and (slice 5) `select_variants` by query, its matches subtracted from the
selection (the queries composed and saved), a saved selection named in a query and the robustness
verdicts of the run checked, each as Node selects on the run it recomputes from the archive, a
mistake named in place, the saved selection's file with its query, the Map view showing it; and
(wave 5, slice 1) `open_structure` with every example protein's PDB entry and AlphaFold DB model from
the cache, each drawn with WebGPU (headless Chrome is started with `--enable-unsafe-webgpu`; where
it offers none, the session says so and checks the Canvas renderer) with the atoms Node reads and an
image of the view that is not empty, then `set_structure` (factor IX's cysteines selected, drawn as
sticks, labeled, two focused on; the molecular surface; hemoglobin's assembly built by symmetry),
refusals saying why, a structure file opened with `open_files`, and, the page opened again with
`?renderer=canvas`, every entry and model drawn by the Canvas renderer, a surface refused; and
(slice 2) `find_structures` ranked as Node ranks PDBe's cached answer, `open_structure` mapping
GRB2's SH3 domain onto 2VWF as Node does, a selection by target position kept on GRB2's AlphaFold
DB model, the mapping's file the same bytes as Node's, and `map_structure` on 1RFN's light chain,
a chain that does not hold the target refused; and (slice 3) 2VWF colored by GRB2's median scores in
the page, every residue as Node colors it, a residue picked (its position's variants selected on the
map, the position in the inspector), a map query's selection drawn on the structure, the
coloring's file the same bytes as Node's, the other colorings and their refusals, and the strip
with GRB2's AlphaFold DB model's pLDDT; and (slice 4) `structure_evidence` on 2VWF as Node reads it
(classes, the scores by class, the cluster test), its choices and refusals, the structure's tracks
in `list_tracks`, the evidence's file the same bytes as Node's, the class coloring, and GRB2's
model read with its aligned error; and (slice 5) a view of 2VWF colored by GRB2's median scores
saved, changed and opened again by `open_structure_view`, its figure panel (`export` of
`structure-image`) the same image pixel for pixel, the panel's metadata (the file's SHA-256, the
view, Run 1 by its output's SHA-256, the legend), the view opened from the workspace's archive in a
copy the same image, an archive naming the structure by checksum only (the file then fetched again
by its ID, its SHA-256 the one saved), and `remove_structure_view` taking the structure with it.
(slice 6) a fake Proteoscope (its startup answer) where `--proteoscope` says: with none running,
`proteoscope_link` refused and no button; with 0.10.0, the link's session (read with zlib) the one
returned, GRB2's medians on the residues Node places them on, the residues drawn, hidden, focused on,
selected and labeled, and the camera where it comes to rest though handed over during a focus, the
fake asked nothing but its startup answer, the button shown and its click opening the link in a new
tab; with 0.11.0 the structure alone; a file of the person's embedded in a session file; the fake
stopped, the button gone and the session file still written; and (the 0.5.0 release) Chrome's GPU
process crashed under the Structure view (`Browser.crashGpuProcess`), the view going on with the
Canvas renderer, saying why, and drawing; where the browser loses WebGPU by itself (GitHub's runners
draw it in software, and lose it at the first image), the session finds the view on the Canvas
renderer and checks it so. (Wave 6, slice 1) a figure two columns wide made with `create_figure`
and shown in the Figures view; `add_figure_panel` with GRB2's map and two of its tracks, lettered A,
and a text panel B where placed, a range backward and an unknown track refused; the figure exported
as SVG the same bytes as Node draws it from the document `figures` returns and Run 1 scored in
Node; its PDF a page of 174 × 120 mm drawing Node's rectangles and text (`figure-cases.mjs`); its
PNG at 300 dpi 2055 × 1417 pixels with its resolution recorded; `set_figure` renaming it, changing
panel A's positions and moving B, a panel off the page and an unknown one refused; the token
required; the archive keeping the figure. (Slice 2) a figure of a QC finding (replicate agreement),
GRB2's scores by class, Run 1 against Run 2 and p.Trp36Ala's evidence exported as SVG, the same bytes
as Node draws its document from the runs recomputed from the archive (`computeQC`, `compareSides`,
`lib/view-plots.js`), an unknown finding and a variant not measured refused; a saved structure view
as a panel, its image the same pixels as `export` structure-image draws the view on white
(`decodePNG`), in the figure's SVG and the archive byte for byte. (Slice 3) each exported file's
manifest (`lib/figure-manifest.js`): Figure 1's SVG Node's drawing with the manifest in its
`<metadata>`, its PDF and PNG carrying the same panels; the figure of every view's manifest the one
Node writes from the archive (`buildManifest`); `export_figure` json the manifest alone;
`check_figure` in its own workspace every panel as then, an edited manifest caught, a file without
one refused, with `rebuild` every panel the same drawing; `open_files` of the figure the window's
dialog, four panels as then and Rebuild here; in a new workspace that scored the same table to the
same output, Run 1's panels found by its output and the comparison's Run 2 not there. (Slice 4)
the archive's report (`report.md`, `report.bib`) as Node writes it from the archive, each run's QC
and scores recomputed (`report-cases.mjs`, `contextOf`); `compare` and `check_robustness` with
`report`, what the workspace keeps the comparison and the check as Node computes them; the `report`
action's text, the Report view's sections, references and kept analyses, and `export` of `report`
and `report-references` Node's; `report` with `remove`, and an analysis not kept refused. (Slice 5) in the workspace opened from
files, a checkpoint kept and the run scored again with pseudocount 1 and a minimum input count of
10: `diff`'s changes and run pairs as Node finds them from the workspace's archive
(`diff-cases.mjs`, `pairsFor`), the Report view's changes with the moved variants and the map of the
change, the drawer's history marking the checkpoint; `diff` of the two archives before and after as
Node finds them; `checkpoint` with `remove`, an unknown checkpoint and a diff with none refused.
(Slice 6) in the first GRB2 workspace (its three runs, a robustness check kept in the report,
selections, annotations, two figures of every kind of panel): `certify` in the window's worker from
the library's files, verified in Node (`web/lib/certificate.js`) bit for bit and the same bytes as
Node certifies from the workspace's archive; every figure panel's drawing the one its manifest
(`export_figure` json) records; Node's certificate verified with `verify_certificate`, a tampered
one not verified with the one number that differs Node's; without its tables, verified from the
library by the table's SHA-256, not checkable with `library: false`, then verified with the table
given beside; a table alone and an archive that is not a certificate refused. (Slice 7)
`review_report` the same bytes as Node's review of the workspace's archive, every traced number the
certificate's or the workspace's; opened from its file, nothing requested but the file, no axe-core
violation (WCAG 2.1 A and AA; `fetch.mjs axe-core`) in the light theme or the dark, a QC number
traced, a variant looked up, the fingerprint checked in the file. (Slice 8) the wave's lessons on
the examples, as their guides make them (`example-lessons.mjs`): GRB2's figure (the variance beyond
counting acknowledged; Run 1's map, the view Core and the finding exported as PDF, `check_figure`
saying every panel as drawn, Node drawing each again from the archive the same, the acknowledgement
withdrawn said of the QC panel); Hsp90's checkpoint (Run 2 over the whole time course, the columns
of generations 9 to 21 set aside, Run 3 Node's, `diff` as Node says it); BRCA1 RING opened offline
from MaveDB's two tables (`fetch.mjs mavedb-brca1-ring`), scored with the Enrich2-compatible preset,
certified (110,975 numbers, verified in Node), certified without its tables and verified with
MaveDB's two files beside it, its review report's numbers the certificate's. (Wave 7, slice 2) a
script's QC thresholds applied at once, and nothing of a script's proposed. (Slice 3) results as
data and pictures, for a script: Run 1's scores as a table holding every number of its scores file
(`tableMatchesCSV`), a short last page, its provenance its file's JSON; a contrast's differential
scores and a nucleotide run's protein-level scores each holding every number of their files; the
map with its tracks as a PNG data URL, the SVG export's size and every cell its color there
(`mapCellsAgree`); the Structure view's picture pixel for pixel the `structure-image` export; a
figure page at the dpi asked. Control sets (wave 8, slice 1): made in the window from factor IX's
ClinVar records and from a table as Node makes them, matched to Run 1 and checked for circularity as
Node does, a table of another protein's labels refused, focused and deleted. Calibrations (wave 8,
slice 2): Run 1 against the ClinVar set calibrated in the window, every number as Node computes it
from the same scored controls (the seeded bootstrap's included, and each class's OddsPath and
evidence strength, slice 3), drawn in Calibrate with the evidence and its limitations; given
thresholds counted as Node counts them, thresholds in the wrong order refused; listed, focused,
deleted, and deleted with their set. Slice 4: the calibration's likelihood ratios acmgscaler's in
Node on the window's own rows; factor IX's published scores (`mavedb-factor9` copied into the
fetcher's cache) opened offline and calibrated with the investigators' published thresholds, the
OddsPath Node's, a calibration with no normal class refused. 210 checks; in CI as the `remote` job.

`--like-ci` runs the session as GitHub's runners do: WebGPU drawn in software (Chrome's
`--use-webgpu-adapter=swiftshader`, whose graphics process does not last) and the page's processor
slowed (`Emulation.setCPUThrottlingRate`, 4 times unless a rate is given). Every failure the 0.5.0
release met only in CI failed this way here first; run it before a release, and after any change to
the Structure view or to what runs in the background.

## The agent session (`agent-session.mjs`, wave 7 slices 1 to 3 and 6)

`node validation/agent-session.mjs [--verbose] [--like-ci [rate]]` builds MaveScape and starts
`mavescape mcp` (`--window none`, an empty library, `--offline` on the fetcher's cached answers in
`fixtures/public-data/`, `--proteoscope off`), then speaks MCP to it over stdin and stdout as an AI
agent's client does, with no model, and opens the window it would show in headless Chrome, where
it also acts as the person: accepting and rejecting the agent's proposals in the strip above the
view, and changing the workspace as a script does (not a proposal). It checks the protocol
(initialize: the version asked, the server named, instructions saying where to start and that
scores are never a clinical classification; `tools/list` the remote actions in order, each with
its title, description, schema and MCP's hints, as `GET /api/remote/tools` gives them; an unknown
tool, a missing argument and an unknown method answered with errors that say so), then calls every
one of the 54 tools on the examples:

- GRB2's example opened (not a proposal), checked, reproduced and its QC read; a finding
  acknowledged, QC thresholds set, the target's check applied, MaveDB's details and a design set:
  each waiting for the person, the workspace unchanged and the tool saying so; scored with the
  Enrich2-compatible preset (both runs' output hashes Node's), Run 2 made at once and marked
  proposed; a variant inspected (its score Node's), variants selected by a query (Node's variants)
  and saved, the map rendered, two runs compared (the result the remote action's, field for field),
  a robustness check with a progress token while the strip says the agent is working.
- Results as data and pictures: Run 1's scores as a table holding every number of its scores
  export, a query's variants Node's, the highest missense scores first; its provenance; the map as
  MCP image content after the text, captioned, decoded at the SVG export's size times its scale with
  every cell the color `map-svg.js` gives it (the whole map at 2×, positions 30–45 at 3×); the
  Structure view's picture with its legend; a figure page at the dpi asked, its manifest inside.
- In the window: the strip (who proposes how many changes, made and waiting, the list), the
  dataset tree's marks, the design proposed beside the person's, the QC view's note; certify
  refused while the proposal is open. Accepted: what waited applied under the agent's name, what
  was made stamped accepted, the decision the person's, the history's chain intact (checked in
  Node), `proposals` and the diff from a checkpoint saying so.
- A run and a figure of it proposed, the person putting a panel of that run in their own figure
  since, then rejected: the run, the agent's figure and the person's panel removed (MaveScape asking
  first), one history entry.
- GRB2's structure found, opened, mapped, colored, read as evidence, saved and reopened as a view,
  Proteoscope asked for and refused; the agent's removals of the person's (a track, a saved view, a
  checkpoint, an analysis kept in the report, a figure, a panel of their figure) waiting, struck out
  or hatched in the views, then accepted and made; the agent's own checkpoint removed at once; the
  person's view never saved over.
- A figure made and exported while proposed (its manifest read back) and checked; a checkpoint and
  what changed since; the report's *AI agents* section; certify refused, then made once the person
  accepted (verified in the window and in Node), the review report, files exported (an existing one
  not replaced).
- The archive opened again by path, MaveDB searched and a score set opened from the cache, a new
  workspace (none of them proposals); a table and its target opened into it (proposed), a design
  drafted (waiting), scoring refused until the person accepted it; on GRB2 before that, scoring
  refused too while a change to the design in place waited.
- The guide's session on Hsp90 (slice 6; the website's *Agents and scripts*, *A session on Hsp90*),
  its tool calls in its order: the time courses' fit failing, the comparison with the record's
  published scores and the stops' median per generation; a checkpoint, the design from Run 1's
  provenance with generations 9 to 21 not used, proposed, and scoring refused while it waits; the
  person accepting it; Run 2 scored per generation, the diff from the checkpoint, the stops again,
  p.Trp4Ter beside its published scores, the comparison again. Every number the guide's answers
  quote, at the precision they quote it.
- Control sets (wave 8, slice 1), on GRB2: the person's set made at once; the agent's made at once
  and marked proposed, `control_sets` listing both matched to Run 1, its deleting the person's set
  waiting; rejected, the agent's gone and the person's kept.
- Calibrations (wave 8, slice 2), on GRB2's Run 1 against the person's set: the person's
  calibration made at once; the agent's made at once and marked proposed, its metrics returned
  (each class's evidence strength and what limits it among them),
  `calibrations` listing both, its deleting the person's waiting; accepted, the agent's kept and
  marked accepted, the person's deleted.

Every tool said to read only must leave the workspace's history as it was; every change the agent
made must carry its name in the history (`by`), the other entries being the person's decisions and
the person's own changes; stdout must carry nothing but JSON-RPC; closing stdin must stop MaveScape
and remove its connection file. 36 checks; in CI as the `agents` job.

## Proteoscope itself (`proteoscope-handoff.mjs`, wave 5 slice 6)

`node validation/proteoscope-handoff.mjs [--verbose] [--require]` checks that Proteoscope opens what
MaveScape hands it. Proteoscope is another program, which MaveScape does not need, so this is not
in CI: where it is not installed it says so and stops (`--require` makes that a failure).
`PROTEOSCOPE` names its program, else `proteoscope` on the PATH. It starts Proteoscope on a port of
its own (its downloads cached in `cache/proteoscope/`: 2VWF and GRB2's AlphaFold DB model are
fetched the first time) and MaveScape with remote control, offline, looking for it there. GRB2's
example: 2VWF colored by the median score, residues drawn, hidden, focused on, selected and labeled,
handed over by `proteoscope_link` and the link opened in a browser; Proteoscope's own session of
what it opened read back (`proteoscope.session()`): every value on a residue its own reader reads,
the values, legend's title, colormap and range sent, the residues and the camera as MaveScape had
them. The same for GRB2's AlphaFold DB model; and RCSB's PDB-format 2VWF as a file of the person's,
its session file given to a second Proteoscope, offline, as a file. 4 checks, with Proteoscope
0.10.0.

## MaveDB, live (`mavedb-live.mjs`, wave 3 slices 2–3 and 6)

`node validation/mavedb-live.mjs [--offline] [--verbose]` builds MaveScape, starts it with remote
control and the fetcher's cache in `validation/cache/mavedb-live/`, and opens the three feasibility
records (four score sets: GRB2 SH3, BRCA1 RING at the nucleotide and amino-acid levels, factor IX)
from MaveDB by `open_mavedb`, as any script or agent would, with no code for any of them. For each:
the tables MaveDB sends are the ones `sources.json` pins, byte for byte, and every published score
and SE read as published equals MaveDB's. Then the PRD's phase-0 exit (score agreement within
documented tolerances) is checked again from the live import, each record's counts scored in the
window with its documented design (`designs/`) and its authors' method, against its published scores
at the tolerance the suites hold: GRB2 by DiMSum's model on the drafted design, r 0.994 (≥ 0.99,
`scoring`); BRCA1 E2 by Enrich2's weighted least squares with wild-type normalization, all 50,043
published replicate scores reproduced to 1.8 × 10⁻¹⁴ (≤ 10⁻¹⁰, `enrich2`); factor IX with
MultiSTEP's settings, r 0.9995 (≥ 0.999, `scoring`). And two records whose target is a transcript
(wave 3, slice 3): BRCA1's saturation genome editing, its RefSeq transcript fetched from NCBI as
GenBank, its tables those `sources.json` pins, all 3,893 variants valid and drawn at the protein
level; BAP1's exon 1, its Ensembl transcript's current version said and used, all 620 variants
valid. And (slice 6) DHFR's two score sets opened together, each record's tables those
`sources.json` pins, their counts joined with a condition each. 19 checks, about a minute live; `--offline` checks again from the cache, sending nothing. Not
in the CI of each commit, whose checks are all on fixed data: the workflow *Live public data*
(`.github/workflows/live.yml`) runs it weekly and by hand, so that a service being down or changing
what it sends fails that run, not a commit.

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

- BAP1's published nucleotide variants on its Ensembl transcript (wave 3, slice 3): `mavescape run`
  draws the map at the protein level and writes `protein_scores.csv` as Node merges the variants.

- `mavescape export` (wave 3, slice 4) of the GRB2 run's archive: `--format mavedb` twice the same
  bytes, the files MaveDB reads as Node writes them from the archive, `export.json` naming the
  abstract as missing; `--strict` exit 1, and 0 once `--details` gives it; the two-condition
  fixture's run a folder per condition; `--format tables` the same bytes as `mavescape run` wrote;
  wrong command lines (exit 2). (Wave 6, slice 3) a figure of the GRB2 run (its map, replicate
  agreement, its scores by class, text) made in the window through remote control and saved in its
  archive; `--format figures` writes it as SVG, PDF and PNG with `figures.json`, twice the same
  bytes, each file's manifest intact and `figures.json`'s, the SVG the window's byte for byte but
  for its manifest's time, every panel's drawing digest the window's; a workspace without figures
  exit 1, `--run` with `--format figures` exit 2. (Slice 4) `--format report` writes `report.md`
  and `report.bib`, twice the same bytes, the report the window wrote into the archive;
  `--condition` with it exit 2. (Slice 6) `mavescape verify` of a certificate Node writes of the
  window's workspace: exit 0 and every number identical, `--report` its JSON; tampered (a score's
  last bit, the fingerprint made again), exit 1 with the number listed; without its tables, exit 2
  naming the table, then exit 0 with `--data`; no certificate, a table, or an archive that is not a
  certificate, exit 2. (Slice 7) `mavescape verify --review` and `mavescape export --format review`
  write Node's review report byte for byte; a certificate that does not verify gives none (exit 1).

- `--from-workspace` on 0.5.0's PTEN archive (the 0.5.0 release), whose saved views name their
  structure by checksum: the run reproduced, and `workspace.msz` written again names the structure
  the same way, its two views kept.

33 checks, in CI's `remote` job; about 30 s.

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

## Public data's answers, as the fetcher caches them (`fixtures/public-data/`, wave 3 slices 1–5)

A cache of public data in the layout MaveScape's fetcher writes (`docs/FORMATS.md`, "The cache of
public data"), so that the tests, the `public-data` suite, the remote-control session (started
with `--offline --cache-dir` on a copy) and the screenshots (on a fresh copy, answered from it)
never reach the network. UniProt's own answers, retrieved 2026-10-10 (release 2026_03), and
MaveDB's, retrieved 2026-10-11, by the requests `docs/NETWORK.md` lists, byte for byte, each with its
retrieval record:

| File | What |
| --- | --- |
| `uniprot/P62993.json` | GRB2 (human), the GRB2 SH3 example's target's entry |
| `uniprot/P02829.json` | Hsp82 (yeast), the Hsp90 example's |
| `uniprot/P00740.json` | coagulation factor IX (human), the factor IX example's |
| `uniparc/da732b5e….json` | the lookup of GRB2's whole sequence: 120 active UniProtKB entries with exactly that sequence (named by the sequence's SHA-256) |
| `mavedb/urn_mavedb_00000835-a-1.json`, `.scores.csv`, `.counts.csv` | GRB2 SH3's MaveDB record and tables, retrieved 2026-10-11 (the tables byte for byte those `sources.json` pins) |
| `mavedb/urn_mavedb_00000003-a-1.json`, `-a-2`, `00001200-a-1`, `00000011-a-1` | the records of BRCA1 RING (two score sets), factor IX and Hsp90 |
| `mavedb/urn_mavedb_00000011-a-1.scores.csv` | Hsp90's published scores, retrieved 2026-10-10 (byte for byte the table `sources.json` pins as `mavedb-hsp90`): compared without opening them in the agent session's Hsp90 part and the capture's scene of it (wave 7, slice 6) |
| `mavedb/urn_mavedb_00000013-a-1.json` | PTEN VAMP-seq's record (the example; its table is external data, `mavedb-pten-vampseq`) |
| `mavedb/urn_mavedb_00000054-a-1.json` | PTEN's lipid phosphatase record (Mighell et al. 2018), compared with the PTEN example without opening it (wave 4, slice 3; its table is external data, `mavedb-pten-phosphatase`) |
| `mavedb/urn_mavedb_00000068-c-1.json`, `00000068-b-1`, `00000059-a-1`; `uniprot/P04637.json` | the TP53 example's records, retrieved 2026-10-12: Giacomelli et al.'s etoposide screen (opened) and nutlin-3 screen, and Kotler et al.'s screen of the DNA-binding domain (kept beside); and p53's UniProt entry (release 2026_03), which the example's target is checked against (wave 4, slice 6; their tables are external data, `mavedb-tp53-screens`) |
| `mavedb/urn_mavedb_00000662-a-2.json`, `.scores.csv` | BAP1 SGE exon 1's record and scores: CC BY 4.0, its target named by an Ensembl transcript (the remote-control session and the headless run open it) |
| `mavedb/urn_mavedb_00000835-a-1.mapped.json` | GRB2's mapped variants: MaveDB's mapping of its 1,120 variants to the human reference, VRS 2.0 (wave 3, slice 3) |
| `mavedb/urn_mavedb_00000097-0-2.json`, `00001277-a-1`, `00001245-a-1`, `00001237-a-1`, `00001228-a-1` | the records of BRCA1's saturation genome editing (RefSeq target), TP53's DNA-binding domain (RefSeq), TP53 base editing (an Ensembl transcript and its protein), VarChAMP (28 targets) and DDX3X's saturation genome editing (a genome) |
| `ncbi/NM_007294.3.gb`, `NM_000546.6.gb` | NCBI's GenBank records of BRCA1's and TP53's RefSeq transcripts |
| `ncbi/ON605209.1.gb`, `MK476504.1.gb` | a plasmid map with three coding features, one on the reverse strand, and HBB's gene joined from three exons: the GenBank reader against Biopython |
| `ensembl/ENST00000460680.json`, `ENST00000269305.json` | Ensembl's sequences of BAP1's (version 6) and TP53's (version 9) transcripts, the coding part in capitals |
| `mavedb-search/2f0e48c8….json`, `253d595f….json` | MaveDB's answers to the searches "GRB2" (1 score set) and "VAMP-seq" (22) |
| `mavedb-keywords.json` | MaveDB's controlled keywords for experiments, every key with its labels (retrieved 2026-10-10): the vocabulary a deposit's keywords are checked against (wave 3, slice 4) |
| `uniprot/P62993.features.json`, `P00740`, `P02829` | the three examples' entries' features: domains, regions, sites, secondary structure (wave 3, slice 5) |
| `pdbe/P62993.conservation.json`, `P00740`, `P02829` | PDBe-KB's conservation profiles of the three (each position's amino-acid probabilities) |
| `alphafold/P62993.aa-substitutions.csv`, `P00740`, `P60484` | AlphaMissense's tables of GRB2, factor IX and PTEN, as AlphaFold DB publishes them (PTEN's for the comparisons by class, wave 4 slice 3) |
| `clinvar/GRB2.search.1.json`, `F9.search.1.json`, `<sha256>.summary.json` | ClinVar's search for GRB2's and F9's missense, nonsense and synonymous records (10 and 553), and their summaries (one page for GRB2, two for F9; named by the SHA-256 of the record numbers asked) |
| `gnomad/GRB2.gene.json`, `F9`, `BRCA1`; `ENST00000316804.variants.json`, `ENST00000218099`, `ENST00000357654` | gnomAD's answers for the three genes (their MANE Select transcripts) and the transcripts' variants in gnomAD v4 (each with its GraphQL query in its record) |
| `mavedb/urn_mavedb_00000097-0-2.namespaces.json`, `.annotations.clinvar_2026_01.csv` | the annotations MaveDB keeps for BRCA1's saturation genome editing score set, and its ClinVar 2026_01 and gnomAD annotations of its variants |
| `pdb/2VWF.cif.gz`, `1JM7`, `2CG9`, `1RX2`, `1RFN`, `1TUP`, `1D5R` | the examples' proteins' PDB entries as RCSB sends them (gzipped mmCIF), retrieved 2026-10-12 (wave 5, slice 1): GRB2's SH3 domain, BRCA1's RING domain with BARD1's, Hsp90 (Hsp82) with Sba1, DHFR, factor IXa, p53 on DNA, PTEN |
| `pdb/1M17.cif.gz`, `1YCR`, `3OG7`, `4HHB`, `6VXX`, `7LYB`, `1HHO` | the entries Proteoscope's tests of its structure modules read (copied with them into `web/lib/structure/`), and hemoglobin's 1HHO, whose tetramer is built by symmetry |
| `alphafold/P62993.prediction.json`, `P38398`, `P02829`, `P0ABQ4`, `P00740`, `P04637`, `P60484`; `AF-<accession>-F1-model_v6.cif` | AlphaFold DB's entries for the seven proteins and their models (version 6, gzipped as AlphaFold DB stores them) |
| `pdbe/P62993.best-structures.json`, `P38398`, `P02829`, `P0ABQ4`, `P00740`, `P04637`, `P60484` | PDBe's PDB entries that cover each of the seven proteins, by SIFTS (wave 5, slice 2), retrieved 2026-10-12 |
| `pdb/2HYY.cif.gz`, `6OIM`, `4ZQK` | the entries Proteoscope's tests of `interactions.js` read (imatinib at Abl's hinge, magnesium's coordination, PD-1 with PD-L1), retrieved 2026-10-12 (wave 5, slice 4) |
| `alphafold/AF-P62993-F1-predicted_aligned_error_v6.json`, `P0ABQ4`, `P00740`, `P04637`, `P60484` | the predicted aligned error of five of the models, by which their exposure and disorder are read (wave 5, slice 4); BRCA1's (10 MB) and Hsp82's are not kept, and their models are read without it |
| `uniprot/P60484.features.json` | PTEN's features, for its domains in the PTEN example's account (wave 5, slice 4) |

UniProt's data are under CC BY 4.0; MaveDB's records are CC0 but for BAP1's (CC BY 4.0, its
authors cited in its record); NCBI's and Ensembl's records, and ClinVar's, have no restriction on
use; PDBe-KB's and AlphaFold DB's data (AlphaMissense's predictions, the models) are CC BY 4.0;
gnomAD's are CC0, as are the PDB's entries.

## Structures in other formats (`fixtures/structures/`, wave 5 slice 1)

| File | What |
| --- | --- |
| `2VWF.pdb.gz` | RCSB's PDB-format file of 2VWF (files.rcsb.org, retrieved 2026-10-12, CC0) |
| `2VWF.bcif.gz` | RCSB's BinaryCIF of 2VWF (models.rcsb.org, retrieved 2026-10-12, CC0) |
| `AF-P62993-F1-model_v6.bcif` | AlphaFold DB's BinaryCIF of GRB2's model (retrieved 2026-10-12, CC BY 4.0) |

The suite `structures` reads each as the page does and compares it, atom by atom, with the mmCIF
of the same entry or model.

## SIFTS (`reference/sifts.json`, wave 5 slice 2)

SIFTS's residue-level mapping of the seven example entries, the reference for the target's
mapping onto structures (suite `structures`). `generate_sifts.py` downloads each entry's updated
mmCIF from PDBe (`https://www.ebi.ac.uk/pdbe/entry-files/download/<id>_updated.cif.gz`, its SHA-256
recorded) and reads its `_pdbx_sifts_xref_db` category with gemmi 0.7.5 (MPL-2.0), an mmCIF reader
independent of MaveScape's: for every residue of each chain's sequence (by `label_asym_id` and
`label_seq_id`), the UniProt accession, number and residue, and whether it is observed. Retrieved
2026-10-11:

```sh
python -m venv env && env/bin/pip install gemmi
env/bin/python -I validation/reference/generate_sifts.py
```

## DSSP (`reference/dssp.json`, wave 5 slice 4)

DSSP's own secondary structure and accessibility of the seven example entries, the reference for
structure as evidence (suite `structures`). `generate_dssp.py` downloads each entry's file from the
DSSP databank (`https://pdb-redo.eu/dssp/db/<id>/mmcif`: mkdssp's output, DSSP 4.6.1, its SHA-256
recorded) and reads its `_dssp_struct_summary` category with gemmi 0.7.5: each residue's
secondary structure code and accessibility (Å², DSSP's radii), by `label_asym_id` and
`label_seq_id`. Retrieved 2026-10-12. Kabsch W, Sander C. Dictionary of protein secondary
structure: pattern recognition of hydrogen-bonded and geometrical features. Biopolymers
1983;22:2577-2637. doi:10.1002/bip.360221211

```sh
python -m venv env && env/bin/pip install gemmi
env/bin/python -I validation/reference/generate_dssp.py
```

## Mann–Whitney (`reference/mannwhitney.json`, wave 5 slice 4)

SciPy 1.18.1's `mannwhitneyu` (two-sided, asymptotic, with the continuity correction) and
`false_discovery_control` (BH) on eight seeded data sets, the reference for the scores by
structural class:

```sh
python -m venv env && env/bin/pip install scipy
env/bin/python -I validation/reference/generate_mannwhitney.py
```

## The tracks' own fixtures (`fixtures/annotations/`, wave 3 slice 5)

| File | What |
| --- | --- |
| `grb2-sh3.sto`, `grb2-sh3.fasta` | Pfam PF00018's (SH3_1) seed alignment, 55 sequences (CC0), with the human GRB2 C-terminal SH3 (residues 162–207) added first, aligned as its chicken orthologue GRB2_CHICK/162-207 is (they differ by substitutions only); the same alignment as Stockholm and as aligned FASTA |
| `P62993.gff`, `P00740.gff`, `P02829.gff` | UniProt's GFF3 of the three examples' entries (release 2026_03, CC BY 4.0): the custom-track reader against UniProt's JSON |

## Conservation (`reference/annotations.json`, wave 3 slice 5)

```
SCORE_CONSERVATION=/path/to/conservation_code python3 validation/reference/generate_annotations.py
```

Capra & Singh's `score_conservation.py` (<https://compbio.cs.princeton.edu/conservation/>; Python 2
code under the GPL, not part of MaveScape) is run as an external reference, in a Python 3 copy the
generator makes as Proteoscope's `port-score-conservation.py` does (printing 12 decimals): the
alignment's query residues scored by default; and PDBe-KB's three profiles, each position's
probabilities scored by the tool's own divergence (its `js_divergence` from the background on,
with its BLOSUM62 background). The reference records the tool's SHA-256 and each fixture's.

## Public data (`sources.json`)

| Data set | Design | Why it is here |
| --- | --- | --- |
| `mavedb-grb2-sh3` (urn:mavedb:00000835-a-1) | two populations × 3 replicates | the common case; DiMSum behind the published scores |
| `mavedb-brca1-ring` (urn:mavedb:00000003-a-1, -a-2) | time series: 2 libraries × 3 replicates × 6 rounds (E3 ligase activity, phage autoubiquitination), and 2 × 3 × 4 non-uniform times (BARD1 binding, Y2H), in one table | shared inputs, two assays in one table, legacy `_wt`/`_sy` rows, a DNA target with an offset and a known difference from UniProt; Enrich2 behind the published scores |
| `mavedb-factor9` (urn:mavedb:00001200-a-1) | FACS bins: 3 overlapping tiles × 3 replicates × 4 bins | tiled libraries, VAMP-seq-style weights |
| `mavedb-hsp90` (urn:mavedb:00000011-a-1) | time series: 1 replicate × 8 times, 0–21 generations; one row per codon, the wild type written once per position | the Hsp90 example (wave 2, slice 11): its counts byte for byte, its codons read at the protein level, its per-generation scores against the published fitness |
| `dimsum-demo` (lehner-lab/DiMSum `inst/demo`, MIT) | 40,591 whole nucleotide sequences × 4 inputs and 4 outputs; its design file | DiMSum's layout (variants as sequences, named against the 126-nt wild type); CR-only line ends |
| `mavedb-cbs` (urn:mavedb:00000005-a-5, -a-6) | two populations × 4 replicates at low and at high vitamin B6, in two records whose non-selected samples are the same | two conditions from shared inputs (wave 2, slice 6); counts not whole numbers; codon variants with no wild-type row |
| `mavedb-pten-vampseq` (urn:mavedb:00000013-a-1) | published scores only, no counts: VAMP-seq abundance of 4,409 PTEN variants, with SEs and 95% intervals | the PTEN example opened from MaveDB (wave 3, slice 2): its table as MaveDB writes it, which the example checks when it opens |
| `mavedb-tp53-screens` (urn:mavedb:00000068-c-1, 00000068-b-1, 00000059-a-1) | published scores only, no SEs: Giacomelli et al.'s Z-scores of every substitution of TP53 (P72R) under etoposide and under nutlin-3, and Kotler et al.'s log₂ fold changes of the DNA-binding domain (numbered from 1 on its target, UniProt P04637 at offset 101), which writes 936 protein variants on several rows | the TP53 example (wave 4, slice 6): two screens on two scales, compared on UniProt's numbering, as published, as stated and rescaled by their anchors; repeated protein variants merged |
| `mavedb-pten-phosphatase` (urn:mavedb:00000054-a-1) | published scores only: lipid phosphatase activity of 8,680 PTEN variants (codon variants named at the nucleotide level), Enrich2 scores with SEs and each replicate's, a `_wt` row of 1 with an SE of 0 | another assay of the PTEN example's protein, compared with it without opening it (wave 4, slice 3) |
| `mavedb-brca1-sge` (urn:mavedb:00000097-0-2) | saturation genome editing: 3,893 single-nucleotide variants on NM_007294.3 (coding, splice-site, intronic, 5′ UTR), scores and counts (library, day 5 and day 11 of two replicates, RNA) | the BRCA1 example (wave 3, slice 3): a RefSeq target, nucleotide variants at the protein level, its counts scored against its published scores |
| `mavedb-dhfr` (urn:mavedb:00000063-b-1, -a-1) | time series: 4 sub-libraries × 3 replicates, two grown in each of 6 repeats, 8 times over 18 hours, without and with the Lon protease, in two records (scores and counts) | the DHFR example (wave 3, slice 6): two score sets opened together as conditions, samples holding two tiles, counts below a reporting frequency written as missing |
| `mavedb-tp53-dbd` (urn:mavedb:00001277-a-1) | published scores: 8,058 variants of TP53's DNA-binding domain on NM_000546.6, 5,609 of them deletions, insertions, duplications and deletion-insertions | the protein changes of insertions and deletions, against biocommons hgvs |
| `mavedb-bap1-sge` (urn:mavedb:00000662-a-2) | published scores: 620 variants of BAP1's exon 1 on ENST00000460680.5 (UTR, coding, intronic; single-base deletions and deletion-insertions); CC BY 4.0 | an Ensembl target, its version not Ensembl's current one |
| `mavedb-tp53-base-editing` (urn:mavedb:00001245-a-1) | published scores: 465 base-editor outcomes as multi-variants on ENST00000269305.9, with their protein names on ENSP00000269305.4 | multi-variants' protein changes against the authors' names |
| `mavedb-varchamp` (urn:mavedb:00001237-a-1) | published scores: 430 variants of 28 genes, each named with its target's label | a score set of several targets |

All are CC0 on MaveDB but `mavedb-bap1-sge` (CC BY 4.0). The GRB2, factor IX and Hsp90 examples (`web/examples/`) are their count
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
- **Every column accounted for.** BRCA1's count table holds two experiments (E3 ligase activity by phage and
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

## Protein changes, GenBank and DiMSum's merge (`reference/consequences.json`, `genbank.json`, `dimsum-aggregate.json`, wave 3 slice 3)

`generate_consequences.py` gives biocommons hgvs 1.5.7 (Apache-2.0) each transcript through a data
provider of its own that holds the transcript's sequence and coding region and nothing else (no
database is consulted), and records its protein change for every name of BRCA1's, TP53's and BAP1's
score sets and for generated variants on each transcript (substitutions at the coding sequence's
ends and a sample, deletions, insertions, duplications and deletion-insertions of 1–9 bases; seed
20261011): 16,188 variants. hgvs needs psycopg2, which it does not use here: the script's
docstring installs it without its dependencies. `generate_genbank.py` reads the four GenBank
records with Biopython 1.88: fields, features, locations, each CDS's bases and translation.
`generate_dimsum_aggregate.R` sources DiMSum 1.4's `dimsum__aggregate_AA_variants_fitness` from its
release (SHA-256 checked) and runs it on CBS's 11,478 codon variants with a count ratio as fitness,
applying DiMSum's rule for mixed substitutions as `dimsum__process_merged_variants` does.

### What the comparisons showed (wave 3, slice 3)

- **Protein changes agree on all 16,188 variants**, after one rule: biocommons names the residues
  an in-frame insertion holds after the stop it makes (`p.Lys1171delinsGluTerGlu`), which are not
  made, and MaveScape does not (`p.Lys1171delinsGluTer`); 12 variants. The forms differ as
  MAVE-HGVS's differ from HGVS's (`p.(Gly5AlafsTer12)` is `p.Gly5fs`; `p.(Ter7LysextTer?)`,
  `p.Ter7Lys`; `p.Met1?`, start lost; a deletion-insertion as long as what it replaces, the
  substitutions it holds), which the comparison writes out.
- **GenBank agrees with Biopython** on all 4 records, 143 features and 6 coding sequences; each
  coding sequence's translation is its record's.
- **DiMSum's merge** gives 7,561 amino-acid variants from CBS's codon variants (2,522 of them from
  6,065 codons); MaveScape's agree within 5 × 10⁻¹³, the order of summation. The 1,034 synonymous
  codon variants DiMSum keeps apart are each a member of MaveScape's synonymous cell.

## MaveDB's validators (`reference/mavedb-export.json`, wave 3 slice 4)

`generate_mavedb_export.py` runs MaveDB's own checks on the deposits MaveScape writes (`node
validation/mavedb-export-cases.mjs --write DIR` writes them; the script's docstring has the commands).
MaveDB's server, the `mavedb` package 2026.2.7.4 (AGPL-3.0), is used only here, as an external
reference: nothing of it is in MaveScape. Its server modules need their dependencies installed
(fastapi and others), and hgvs and cdot need psycopg2, which they do not use here and which may not
build: they are installed without it, psycopg2 as its binary package. For each deposit:

- the tables as MaveDB's upload reads them (`csv_data_to_df`: `'` as the quote character, its
  missing values) and as its variant-creation job checks them (`validate_and_standardize_dataframe_pair`,
  with the column descriptions and the score set's targets): mavehgvs checks each name against a
  target's sequence; biocommons hgvs 1.5.7 checks the names on a transcript, given each transcript
  (NM_007294.3, NM_000546.6, ENST00000460680.6, ENST00000269305.9, from MaveScape's cached answers)
  by a data provider of its own that holds only its sequence and coding region, so no database is
  consulted;
- every name by mavehgvs 0.8.1 in strict mode;
- the column descriptions as MaveDB's `DatasetColumnMetadata` and `DatasetColumnsCreate`;
- `experiment.json` as `ExperimentCreate`, its keywords by `validate_keyword_list` and each in
  MaveDB's controlled vocabulary (`fixtures/public-data/mavedb-keywords.json`, its answers to
  `/api/v1/controlled-keywords/{key}`, retrieved 2026-10-10);
- `score_set.json` as `ScoreSetCreate`, a new experiment's URN (which MaveDB gives when the
  experiment is created) replaced by a temporary one.

Each result is kept with the SHA-256 of every file checked: the suite fails when MaveScape writes
other bytes, until the reference is made again.

### What the comparisons showed (wave 3, slice 4)

- **Every table is accepted**: 19 deposits, 92,253 rows, 133,173 names strict MAVE-HGVS, 16 with
  their counts. The metadata of 18 is accepted; the one written without MaveDB details is refused
  for its abstract, which MaveScape names as missing.
- **MaveDB's validator stops at a gap in `hgvs_pro`** ("'float' object has no attribute 'split'"),
  and refuses c. names without protein names: c. variants with no protein change (in a UTR or an
  intron) of a target given by its sequence are left out of a deposit, and said.
- **A target sequence counts from its first base**, and a DNA one is translated from there: a
  transcript with a 5′ UTR is given from its coding start.
- **MaveDB reads an upload with `'` as its quote character**, and refuses a column without a value:
  a deposit writes no quotes and no empty column (MaveScape's own exports do both).
- **The names on a transcript are checked without a database**: biocommons hgvs given only each
  transcript's sequence and coding region validates BRCA1's 3,893 names, and refuses a wrong
  reference base.

## Agreement statistics (`reference/compare.json`, wave 4 slices 1–3)

`reference/generate_compare.R` (R 4.6.1, DescTools 0.99.60, BlandAltmanLeh 0.3.1, pROC 1.19.1,
jsonlite; run from the repository root with DHFR's tables in `cache/`) writes seven pairs of scores and their
statistics, each pair's x and y kept in the reference so that MaveScape is given the same numbers:
six simulated (`set.seed(20261011)`: close agreement on one scale, twice the scale, a shift of 0.5,
weak and negative, ties at one decimal, twelve variants) and DHFR's published scores without and
with Lon (`urn:mavedb:00000063-b-1` and `-a-1`), merged in R on their protein variants (2,277). For
each:
- Pearson's r and its interval (`cor.test`);
- Spearman's ρ (`cor`, ties at their average rank) with Bonett and Wright's interval, written out
  from the paper;
- Lin's concordance with its z-transform interval, scale and location shifts and accuracy C_b
  (DescTools' `CCC`);
- Bland–Altman's bias and limits with their intervals (BlandAltmanLeh's `bland.altman.stats`);
- the trend of the differences on the means (`lm`).

MaveScape's `web/lib/agreement.js` gives every number to 10⁻¹² of R's (the reference is rounded to
13 digits), and the suite matches DHFR's pair as R's merge does: the same 2,277 variants.

The intervals' coverage is checked by simulation (`compare-cases.mjs`, `coverage`): x ~ N(0, 1),
y = a + b·x + e with e ~ N(0, s²), whose true Pearson's ρ, Spearman's ρ_s = (6/π) asin(ρ/2), Lin's
ρc = 2b/(1 + b² + s² + a²), bias and limits are known. In 2,000 pairs of each of five kinds (30 to
1,000 variants; one scale or twice it; shifted or not; r 0.29 to 0.99), each 95% interval holds the
truth 94–96% of the time. Two are weaker, and the suite reports them as they are:
- near r = 1 (0.99), Spearman's: 86% with 30 variants and 92% with 200, the sample ρ being biased
  below the truth there;
- with 30 variants on two scales, Lin's: 92%.

The reference also holds a case of discordance (slice 2): 600 variants at 60 positions with their
SEs, 30 variants and 3 positions planted to differ (`set.seed(20261012)`), each difference's
z = (x − y)/√(sx² + sy²), p = 2 pnorm(−|z|) and q = p.adjust(p, "BH"), and each position's z, the
sum of its differences over √Σ(sx² + sy²), with p and q over the positions. MaveScape gives every
one to 10⁻¹² of R's. The suite then simulates 20 such pairs (`compare-cases.mjs`, `plantedPair`)
and counts what is called. 96% of the planted variants are found. Of the variants called, 4% on
average differ by chance, within the 5% Benjamini and Hochberg allow. 57 of the 60 planted
positions are found, with 7 of 147 positions called that hold no planted difference. In 10 pairs
with nothing planted, none is called and the dispersion is 0.86–1.11.

Slice 3 adds three cases:
- **Rescaling** (`set.seed(20261013)`): two assays of 361 variants (the wild type, then at each of
  60 positions a synonymous one, a nonsense one and five missense) measuring one function on two
  scales, −3 + 3f and 0.05 + 0.95f, each with its own SEs. For each rescaling (nonsense median 0
  and wild type 1; synonymous median 0 and nonsense median −1), R writes out:
  - each side's anchors (the wild type's score, a class's median) and their SEs (the wild type's;
    a median's √(π/2 × Σse²/n)/√n, as `anchors.js`);
  - the rescaled scores;
  - Lin's concordance and Bland–Altman of them (DescTools, BlandAltmanLeh);
  - each difference's z with the anchors' share of its variance ((1 − t)² u₀² + t² u₁² on each
    side, t the score's place between the anchors), p and q;
  - each position's z with the anchors' shared variance ((Σ(1 − t))² u₀² + (Σt)² u₁²).

  MaveScape's rescaled comparison gives every one to 10⁻¹² (4,010 numbers).
- **Classes:** GRB2's published scores (`urn:mavedb:00000835-a-1`) against AlphaMissense
  (P62993), joined in R on UniProt's numbering (the domain from residue 159): 1,053 variants. R
  gives:
  - Spearman's ρ of the score and the negated pathogenicity, with its interval;
  - each class's median and quartiles (type 7);
  - the AUC of telling the likely benign from the likely pathogenic substitutions, with DeLong's
    interval and SE (pROC's `roc`, `ci.auc` and `var`, method "delong").

  MaveScape gives them through its whole comparison: the score set read as published, kept beside
  a workspace, and AlphaMissense placed on it as its track is.
- **An AUC with ties** (`set.seed(20261014)`): 80 cases against 120 controls, rounded to one
  decimal.

The suite also simulates:
- 600 pairs of two assays that differ only in scale (`compare-cases.mjs`, `twoAssays`), rescaled
  by their anchors. Any variant is called in 3.5–4% of the pairs with the anchors' uncertainty in
  the test, and in 10%, 30% and 55% without it, as the wild type is less certain and the nonsense
  variants fewer.
- 6,000 pairs of classes of known AUC (two normal groups). DeLong's interval holds the AUC 94–95%
  of the time.

## Calibration (`reference/calibration.json`, wave 8 slice 2)

`reference/generate_calibration.R` (R 4.6.1, pROC 1.19.1, PRROC 1.4, binom 1.1.2, jsonlite; run
from the repository root after `node validation/fixtures/make-calibration.mjs`) writes seven cases,
each two vectors of scores, P and B, and the side where abnormal-like scores are, rounded to 13
significant digits before anything is computed so that MaveScape is given the very numbers R used:
five simulated (`set.seed(20261014)`: P below B, overlapping; P above B; ties at one decimal; well
apart, where the rule error's thresholds cross; fully apart, AUC 1; few controls, 8 and 6) and
factor IX's ClinVar controls as the example's Run 1 scores them
(`fixtures/controls/factor9-run1-controls.csv`, 164 P and 22 B, which the suite checks is what the
example makes now). For each:
- the ROC curve: pROC's `roc` (the P controls the cases, the direction the side gives), every point
  of `coords(r, "all")`, the AUC and DeLong's interval (`ci.auc`);
- the precision–recall curve: PRROC's `pr.curve` on scores oriented so that higher is more
  abnormal-like, its area (`auc.integral`; and Davis and Goadrich's) and points (`minStepSize = Inf`);
- MaveScape's threshold rules written out on pROC's points (the rule error at 0.05 and 0.1, Youden's
  J; factor IX's given 0.3 and 0.7), each side's controls in each class, sensitivity and
  specificity with binom's Wilson intervals;
- a stratified bootstrap of 2000 samples (`set.seed` per case): pROC's `ci.auc` and `ci.se` (at
  `seq(0, 1, 0.05)`), and written out on each sample's curves the precision–recall area, the
  precision at the recalls 0.05 to 1 and each rule's thresholds; their quantiles (type 7), and how
  many samples leave a class empty or no intermediate zone.

MaveScape draws its samples with its own seeded generator, so the suite compares distributions:
where each of R's quantiles falls among MaveScape's samples (four standard errors of the difference
of two quantile levels from as many samples). Four mistakes planted in a copy of the module (the
ROC band not interpolated, the precision–recall band not interpolated, a side not resampled whole,
ties broken toward more B) each put 14 to 31 of the 1,092 quantiles outside.

## OddsPath (`reference/brnich-oddspath.json`, wave 8 slice 3)

`reference/extract_brnich_oddspath.py` (any Python 3, its standard library) reads Brnich et al.
2019's Additional file 1 (`13073_2019_690_MOESM1_ESM.xlsx`, MD5 d6be13538a2721ab0a5716d550c9841a,
CC BY 4.0; Europe PMC serves it, the script says how) and writes each row of its Table S1 (39 rows:
a perfect binary readout) and Table S2 (70: one control indeterminate) as the spreadsheet holds
it: the counts (total, pathogenic, benign; abnormal, indeterminate, normal readouts) and the two
OddsPath values the spreadsheet computed and saved. In the paper's model the abnormal readouts are
pathogenic controls and the normal ones benign, so the suite gives MaveScape each row as classes
(the indeterminate control the one left over) and compares both readouts' OddsPath. Table S2's row
63 cannot be read so (9 pathogenic and 1 benign control, yet 8 normal readouts and one
indeterminate) and is left out, the check saying so.

## Likelihood ratios and R's numerics (`reference/likelihood.json`, wave 8 slice 4)

`reference/generate_likelihood.R` (R 4.6.1, acmgscaler 1.0.0, jsonlite; run from the repository root
after `node validation/fixtures/make-calibration.mjs`) records R as a black box for `web/lib/rcompat.js`
(which ports none of R, GPL, but writes each numeric from its publication and finds R's conventions
by experiment): set.seed's state and the first uniforms and sample.int draws of four seeds; seq;
density (every eighth point) and bw.bcv on four sets of scores; isoreg; optimize on two functions;
approx with ties and both rules; mad; qbinom; Spearman. Then acmgscaler itself (`web/lib/likelihood.js`
ports it, MIT): its example variant_data by gene as its documentation calls it (prior 0.1, seed 42);
BRCA1 alone at the prior 0.0441 (seed 7); TP53 with its scores negated (seed 11); factor IX's Run 1
(`fixtures/controls/factor9-run1-scores.csv`: the 164 P and 22 B ClinVar controls and every other
variant, seed 20261009), its controls' rows and every tenth other with the evidence of every row
counted; find_pvst at 0.1 and 0.0441; and Pejaver et al. 2022's Table 1, typed from the paper (CC BY).
Numbers with 17 significant digits.

`fayer-brca1` (sources.json) is Fayer et al. 2021's published data from their repository at a pinned
commit, which states no license: fetched into the cache for the check of their BRCA1 OddsPath, never
copied into MaveScape or its repository.

## Robustness to analysis choices (`robustness-cases.mjs`, wave 4 slice 4)

The planted experiments (`plantedExperiment(seed)`, seeds 41–50) are simulated two-population
experiments of a 50-residue protein in four replicates, 400 reads per variant, the missense effects
either the wild type's (60%) or lost by 1 to 3 (natural log; the simulator's `neutralSd: 0`,
`lossMin: 1`), with no noise between replicates beyond counting, so that fixed effects, which assume
none, are a reasonable choice. Among the wild type-like missense variants with ordinary counts in
every sample (0.7 to 1.5 times each sample's median), two sets of up to ten are planted in the count
table:
- one replicate driving an effect: replicate 1's output cut to a quarter (a score near −1.4 there,
  the wild type's elsewhere);
- an effect whose size appears at one pseudocount: no reads after selection in any replicate.

Each experiment is scored with the defaults but fixed effects (the declared analysis) and checked
against 47 other analyses. Every time, the variants reported fragile are exactly the replicate-driven
ones (92 of 93 naming replicate 1 left out, the other the combinations that weigh it as the others),
and the variants whose effect's size depends on the pseudocount are exactly the zero-count ones,
each on pseudocount 0.1 alone. The clearly lost variants (effect below −2) keep their class in every
analysis. Two unplanted variants over the ten experiments have their effect's size moved: a strongly
lost variant with a replicate left out, another whose unequal replicates the mean weighs equally;
none by the pseudocount. Under MaveScape's defaults (the moderated combination), the replicate-driven
effect is not called at all, its SE carrying the replicates' disagreement, and nothing is fragile.

A move counts when the alternative's effect is beyond the declared 95% interval and more than five
robust SDs (1.4826 × the median absolute deviation) from the median of that analysis's moves (in
declared SEs). Without the second condition, a few of each experiment's thousand variants crossed
their interval by chance when a replicate was left out (about 0.2% of variant-analyses).

## Selections (`selections-cases.mjs`, wave 4 slice 5)

`mapCells(results, design)` accounts for every substitution of a protein target without the map
model or the query engine: its MAVE-HGVS name (built from the target's sequence, `p.Ala12Val`,
`p.Ala12=`, `p.Ala12Ter`), its row in the run (looked up by name), its class (from the residues: the
wild type's own residue synonymous, a stop nonsense, any substitution of a methionine at position 1
start lost, the rest missense), its state (no row, or not measured: missing; a filter's reason:
filtered; a flag: low confidence; else scored), and its score, SE, replicates and mean input count
from the condition's own arrays, in the order of variants.js's amino acids. Each query's expected
variants are a predicate over these cells, written apart from the query (`missense at 10-30 with se
< 0.2` is `kind === 'missense' && 10 ≤ p ≤ 30 && se < 0.2`), and the query must select the same
names in the same order. `circleCells` gives the cells whose centers lie within a circle on the
map's geometry, with half a pixel's margin, for a shape of 96 corners drawn on it.

## Figures (`figure-cases.mjs`, wave 6 slice 1)

`readSVG(svg)` reads an SVG figure without MaveScape's drawing code: its filled rectangles in the
order drawn (a hatch as its pattern's base color; outlines, rounded rectangles, clip paths and the
patterns' own rectangles left out), its text, and each titled cell's fill by its title (the
variant, as `map-svg.js` names its cells). `readPDF(bytes)` inflates the PDF's content streams with
zlib and reads them operator by operator: `rg` sets the fill, `re` adds a rectangle, `f` and `B`
fill those collected with the color set (a clip's `re W n` and a stroke's `S` drop them), `Tj`
shows a string (its escapes and octal codes read), `BT`…`ET` joining a line's runs; the page size
from `/MediaBox`, y measured from the top as the SVG's. `sameRects` compares two lists mark for
mark. The remote session uses the same readers on the figure the window exports. `decodePNG(bytes)`
reads an 8-bit RGB or RGBA PNG (its IDAT inflated, each row unfiltered) to compare pixels.

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

0.3 brought public data in and out, and each workspace opened from MaveDB is a workspace of its
own, so 0.3.0 saved three: `archives/release-0.3.0-grb2-mavedb.msz`,
`release-0.3.0-dhfr-together.msz` and `release-0.3.0-brca1-sge.msz` (2.5 MB together).
`archives/make-0.3.0.mjs` (`node validation/archives/make-0.3.0.mjs <v0.3.0 checkout> <out folder>
[commit]`) builds MaveScape from the checkout. It opens its page in a headless browser with a fixed
clock and drives it through remote control, offline, on the fetcher's cached answers
(`fixtures/public-data/`) and MaveDB's tables (`mavedb-dhfr`, `mavedb-brca1-sge`). So the archives
are what the window saves. Their runs name the commit they were built from: c0d7f4f, the release
commit, marked `-dirty` because the release's last changes (the run naming, CI's tables) were not
yet committed. They hold:
- **GRB2's SH3 domain, opened from MaveDB** (`urn:mavedb:00000835-a-1`): the record, its published
  scores as a run, MaveDB's mapped variants kept, and the counts with their drafted design, scored.
  The target was checked against UniProt P62993 after that run. The archive also has UniProt's
  features, PDBe-KB's conservation, AlphaMissense, ClinVar, gnomAD, an alignment and a GFF3 beside
  the map, ClinVar moved to the top and gnomAD filtered.
- **DHFR without and with Lon** (the `dhfr-lon` example): two score sets opened together, both
  records kept and a published run each. Their counts are joined, with the paper's design (two
  tiles grown in each sample, time in hours), and Run 1 compares the conditions as independent.
- **BRCA1's saturation genome editing** (the `brca1-sge` example): the RefSeq transcript
  NM_007294.3 as the target, nucleotide variants read at the protein level, and the counts scored
  with their drafted design. MaveDB's own annotations and gnomAD are beside the map.

Each has a saved selection and an acknowledged finding. The suite reopens them and recomputes their
seven runs from the archives' own files, each to its recorded output hash and its archived scores
exactly; published scores without standard errors are compared by score alone. It makes every
export again, drawing a nucleotide run's map at the protein level. It also reads every annotation's
tracks again from the archive's files, in the order the workspace keeps; MaveDB's annotations are
joined by the run's variants and accessions, as the window joins them. `mavescape run
--from-workspace` reruns each of the seven in a window to the same hash.

0.4 brought comparison. A comparison is the session's, but what it rests on is the workspace's, so
0.4.0 saved two archives that keep it: `archives/release-0.4.0-tp53-screens.msz` and
`release-0.4.0-grb2-compare.msz` (0.9 MB together). `archives/make-0.4.0.mjs` (`node
validation/archives/make-0.4.0.mjs <v0.4.0 checkout> <out folder> [commit]`) drives the window as
0.3.0's script does, offline, on the fetcher's cached answers and TP53's tables
(`mavedb-tp53-screens`). Their runs name the commit they were built from: f73d0c7 (wave 4's last
slice), marked `-dirty` because the release's changes were not yet committed. They hold:
- **TP53, two screens on two scales** (the `tp53-screens` example): its published scores as a run;
  the target checked against UniProt P04637 (P72R); Kotler et al.'s screen
  (`urn:mavedb:00000059-a-1`, its protein variants on several rows) and Giacomelli et al.'s
  nutlin-3 screen (`urn:mavedb:00000068-b-1`) kept beside it, each with the direction stated; a
  selection by query (the hotspot arginines lost), and another made from it by an operation (to
  histidine).
- **GRB2's SH3 domain, compared** (the `grb2-sh3` example): Run 1 and Run 2 (the Enrich2-compatible
  preset); its record's published scores kept beside by URN; AlphaMissense and UniProt's features
  beside the map. Its selections are made by queries: a feature's positions with an SE bound, an
  operation on that saved selection, and Run 1's robustness verdicts ("lower and not robust").

Each has an acknowledged finding. The suite recomputes their three runs to their recorded output
hashes and archived scores, and reads their annotations' tracks again. It also reads each score set
kept beside a workspace again from the archive's own file, as published with its stated direction.
It runs each saved selection's query again on its run's map: it must select the same variants. A
query of the robustness verdicts must keep its variants on the map, since a later version's check
may vary them. `mavescape run --from-workspace` reruns the three in a window to the same hashes, and,
at 0.4.0, every earlier archive's fifteen runs too.

0.5.0 saved two archives that keep its saved views of structures:
`archives/release-0.5.0-grb2-structures.msz` (0.3 MB) and `release-0.5.0-pten-structures.msz`
(0.9 MB). `archives/make-0.5.0.mjs` (`node validation/archives/make-0.5.0.mjs <v0.5.0 checkout> <out
folder> [commit]`) drives the window as 0.4.0's script does, offline, on the fetcher's cached
answers (the PDB entries and AlphaFold DB models among them) and PTEN's table
(`mavedb-pten-vampseq`), not looking for Proteoscope. Their runs name the commit they were built
from: 695f27d (wave 5's last slice), marked `-dirty` because the release's changes were not yet
committed. They hold:
- **GRB2's SH3 domain and its structures** (the `grb2-sh3` example): Run 1, and three saved views
  whose structures' files are in the archive: 2VWF colored by the median score, residues 20–26 drawn
  as sticks and two labeled ("Core"); 2VWF by structural class, the Gab2 peptide's first residues
  hidden ("Classes"); GRB2's AlphaFold DB model by the median, its aligned error kept with it
  ("Model").
- **PTEN on 1D5R, named by checksum** (the `pten-mavedb` example): its published scores as a run;
  two views of 1D5R, by the fraction abnormal-like of its record's ExCALIBR calibration
  ("Abnormal-like") and by structural class ("Burial"); the archive names the structure by its ID
  and SHA-256 only (`structures: "checksums"`).

The suite recomputes their two runs to their recorded output hashes. It reads each saved view's
structure again: from the archive's own file, or, for PTEN's, as the fetcher's answer for its ID
(here, the cache), and checks its SHA-256 is the one recorded. It maps each view's target onto its
chain again and compares the mapping with the one the view was saved with, which must not differ.
They hold no selection: the suite replays a workspace without one. `mavescape run --from-workspace`
reruns the two in a window to the same hashes (PTEN's archive written again naming its structure
by checksum, as it came), and, at 0.5.0, every earlier archive's eighteen runs too.

0.6.0 saved two archives and a certificate of one, which keep what wave 6 put in the record
(figures, analyses kept in the report, checkpoints) and its numbers:
`archives/release-0.6.0-grb2-figure.msz` (0.8 MB), `release-0.6.0-grb2-figure.certificate.msz`
(0.8 MB) and `release-0.6.0-hsp90-checkpoint.msz` (0.06 MB). `archives/make-0.6.0.mjs` (`node
validation/archives/make-0.6.0.mjs <v0.6.0 checkout> <out folder> [commit]`) drives the window as
0.5.0's script does, offline, on the fetcher's cached answers alone, not looking for Proteoscope.
Their runs name the commit they were built from: 0fe98a7 (wave 6's last slice), marked `-dirty`
because the release's changes were not yet committed. They hold:
- **GRB2's SH3 domain, its record whole** (the `grb2-sh3` example): a QC threshold changed and the
  variance beyond counting acknowledged; Run 1 and Run 2 (the Enrich2-compatible preset); their
  comparison and Run 1's robustness check kept in the report; a selection by query; UniProt's
  features and AlphaMissense beside the map; a saved view of 2VWF; a checkpoint ("Before the
  figure"); and a figure of six panels: the map with its sequence, secondary structure,
  AlphaMissense and position effect below it, the saved view, the scores by AlphaMissense class,
  the replicates' agreement, a variant's evidence and a caption.
- **Its certificate**, made by 0.6.0 in its worker: 6,872 numbers, its table, annotation files and
  the figure's structure image in it.
- **Hsp90 with a checkpoint** (the `hsp90` example): Run 1 per generation, Run 2 over the whole time
  course, a checkpoint ("All eight samples"), then the columns of generations 9 to 21 set aside and
  Run 3 scored: a design with columns set aside, and a checkpoint whose state is not now's.

The suite recomputes their five runs (and the certificate's two) to their recorded output hashes.
It checks each checkpoint's state against its own SHA-256, and computes every number the two
workspaces report again from the archive's own files: each figure is drawn, and each analysis kept
in the report must compute what was kept (no note, nothing left out). The certificate suite verifies
0.6.0's certificate with this MaveScape: every number computed again and compared bit for bit with
the one 0.6.0 computed. A later version that writes the report or draws a panel otherwise will find
those numbers differ, and says which; whether it may is that version's to decide. `headless-run`
verifies it with `mavescape verify` and reruns the GRB2 archive with `mavescape run
--from-workspace`, the archive written again keeping its figure, analyses and checkpoint.

0.7.0 saved two archives and a certificate of one, which keep what wave 7 put in the record: an AI
agent's work, its changes under its name in the history, what it made marked proposed, and the
person's decisions. `archives/release-0.7.0-grb2-agent.msz` (0.3 MB),
`release-0.7.0-grb2-agent.certificate.msz` (0.4 MB) and `release-0.7.0-hsp90-proposal.msz` (0.05
MB). `archives/make-0.7.0.mjs` (`node validation/archives/make-0.7.0.mjs <v0.7.0 checkout> <out
folder> [commit]`) starts the program as an agent's client does (`mavescape mcp`), offline on the
fetcher's cached answers, and drives it over MCP as an agent named "make-0.7.0" and through remote
control as the person, who decides in the strip above the view in the headless window. Their runs
name the commit they were built from: c43020c (wave 7's last slice), marked `-dirty` because the
release's changes were not yet committed. They hold:
- **GRB2's SH3 domain, worked on by an agent** (the `grb2-sh3` example, opened by the person, with
  UniProt's features beside the map): the agent's first proposal accepted (Run 2 with the
  DiMSum-compatible preset, a selection by query and AlphaMissense beside the map, made at once; the
  variance beyond counting acknowledged, a QC threshold and the target's check against UniProt,
  waiting until then); its second rejected (Run 3 with a pseudocount of 1 and a figure of it, made,
  and the removal of the person's UniProt features, waiting), so that none of it is left; then the
  person's comparison of Run 1 and Run 2 kept in the report, and a checkpoint ("Decided"). 13 of
  its 24 history entries are the agent's.
- **Its certificate**, made by 0.7.0: 6,833 numbers.
- **Hsp90 with an agent's proposal open** (the guide's session on Hsp90 to its second answer): the
  example opened by the agent, compared with the record's published scores (their score set kept
  beside the map), a checkpoint ("All eight samples"), and a design fitting the first three samples
  waiting for the person. Every one of its nine history entries is the agent's.

The `roundtrip` suite reopens them like every release's (their three runs, and the certificate's
two, to their recorded output hashes; the checkpoints as kept; every number computed again) and
checks what 0.7 keeps: the agent's entries in an unbroken history, what it made marked proposed and
accepted (or open), and the open proposal as it was saved. Accepted in Node, the design it holds
is applied and what it made is kept; rejected, what it made is removed and the design is as it was;
either decision is one entry of the history, the person's. The `certificate` suite certifies each
release's archive: the one with a proposal open must be refused, saying so, and is certified once
the proposal is accepted; it verifies 0.7.0's certificate as 0.6.0's. `headless-run` verifies it with
`mavescape verify` and reruns the Hsp90 archive with `mavescape run --from-workspace`, the archive
written again keeping the open proposal, what it made and the agent's entries.

