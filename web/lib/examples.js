// Bundled examples (requirement T4): each with its question, source and license, citation, what
// to expect (the QC findings it teaches, `findings`, and the gaps its guide points to, `teaches`),
// the view it opens in and a guided workflow of a few minutes. A published example's table can be
// assembled as at import (`assembly`: Hsp90's codon variants read at the protein level), and its
// first run can set parameters beyond MaveScape's defaults (`parameters`). Simulated data are
// labeled simulated everywhere they appear. The published example's files are in web/examples/;
// the simulated one is made from its seed (lib/simulate.js), with its true effects. An example
// opened from MaveDB (`mavedb`: one record, or `records` opened together, each table with the
// checksum it had) may give its counts the design they need (`files.design`, from the paper) and is
// scored with it (wave 3, slice 6).

import { simulateExperiment } from './simulate.js';
import { createRandom } from './random.js';
import { parseTable } from './csv.js';
import { KIND } from './variants.js';
import { classOf } from './calibration.js';
import { log } from './dmath.js';

export const EXAMPLES = [
  {
    id: 'grb2-sh3',
    title: 'GRB2 SH3 domain (published)',
    summary: 'An abundance selection of every substitution in the 56-residue SH3 domain of GRB2, in three replicates, from the Human Domainome.',
    question: 'Which positions of the SH3 domain does the protein need to fold and stay abundant, and how sure are the scores?',
    source: 'MaveDB urn:mavedb:00000835-a-1 (counts, unchanged)',
    license: 'CC0 1.0',
    citation: 'Beltran A, et al. Site-saturation mutagenesis of 500 human protein domains. Nature 2025. doi:10.1038/s41586-024-08370-4',
    simulated: false,
    files: { counts: 'examples/grb2-sh3/counts.csv', design: 'examples/grb2-sh3/design.json', target: 'examples/grb2-sh3/target.fasta', notice: 'examples/grb2-sh3/NOTICE.txt' },
    findings: { 'excess-variance': 'fail' },
    // What is missing that its guide points to (readiness.js gaps; wave 2, slice 10).
    teaches: ['selection-cells', 'library-method'],
    opens: 'qc',
    expected: [
      'Quality control: everything passes except the variance beyond counting, about 11× (a bottleneck). DiMSum\'s error model puts it at the input, 20–38× counting, as the Domainome\'s own analysis found.',
      'Nonsense variants score about −4.6 against the wild type\'s 0: the assay separates loss of function cleanly.',
      'The least tolerant positions are buried hydrophobic and glycine residues of the fold (A163, G196, G203, I183 on GRB2\'s numbering).',
      'Checked against UniProt, the domain is residues 159–214 of P62993, identical: the offset of 158 the design gives.',
      'Beside the map, AlphaMissense calls the eight least tolerant positions likely pathogenic (a mean above 0.9 each), while conservation follows the position effects only in part (Spearman ρ about −0.4): abundance is not all a residue is conserved for.',
      'In Compare, against its record\'s published scores (urn:mavedb:00000835-a-1, kept beside the workspace without opening it), Run 1 agrees at r 0.997 on another scale (the authors rescaled theirs); rescaled by their anchors (nonsense median 0, wild type 1), Lin\'s concordance is 0.996 and the bias 0.009. Against AlphaMissense, ρ 0.55 by rank, and its classes are told apart with an AUC of 0.78.',
      'On 2VWF, colored by each position\'s median score, the least tolerant residues pack the core (the ten lowest have a median of 20.5 Cα atoms within 10 Å, the ten highest 14.5), while the ten that touch the Gab2 peptide are tolerant (a median of −0.39, against −0.81 for the rest): the assay measured abundance, not binding.',
      'A figure of Run 1\'s map, the view Core and the variance beyond counting, exported as PDF, carries its manifest: Run 1 by its output\'s SHA-256, the QC thresholds and the acknowledgement\'s reason, 2VWF and the view\'s image by theirs. Dropped on the window, each panel is as it was drawn; once the table is scored again, the map and the QC panel say so.',
    ],
    steps: [
      ['qc', 'Read the QC findings. Open "Variance beyond counting" and its plot: replicate differences sit above the dashed line of counting noise, in parallel, as a bottleneck does. DiMSum\'s terms below it show where: the inputs. Acknowledge it with that reason (the input bottleneck the Domainome\'s own analysis found): the methods, and any figure of it, carry the reason.'],
      ['score', 'In Score, the run with MaveScape\'s defaults is ready. Run it again with the DiMSum-compatible preset: its error model carries the bottleneck into every SE. Compare the runs\' tables of replicates. From a run\'s Export menu, "Deposit in MaveDB" writes it as MaveDB takes a score set (the scores and counts, what each column is, the methods, the readout as the MAVE minimum information\'s keywords) and names what MaveDB still requires: an abstract.'],
      ['map', 'Open the map. The darkest columns are the positions that tolerate nothing; click a cell to see its replicates in the inspector. Below it, Tracks, "Add a track": UniProt\'s features, conservation (PDBe-KB) and AlphaMissense line up with the positions, asked for by GRB2\'s accession only. Shift-drag over a stretch and save the selection.'],
      ['experiment', 'In Experiment, Target, "Check against UniProt" fetches GRB2\'s entry (P62993) through the MaveScape program and finds the SH3 domain at positions 159–214, identical: the design\'s offset is the entry\'s. "Record the check" keeps the release and the date with the workspace, and the methods cite them. Then read "What the analysis can do": the published counts do not say how the library was made or how many cells were carried into selection.'],
      ['structure', 'In Structure, Structures of the target: open 2VWF, GRB2\'s SH3 domain holding a peptide of Gab2 (chain B), and color it by the median score. The least tolerant residues (A163, G196, G203, I183) are dark blue, in the core. Under Residues, select "byres (chain A and protein and within 4 of (chain B and protein))": the ten residues that touch the peptide are pale, and their substitutions are selected on the map. Click I183: the inspector shows its position. Under Saved views, save the view as "Core": it reopens as it is with the workspace, and goes into its archive and methods.'],
      ['figures', 'Put what the guide found on one page: "Add to figure" in Map (Run 1\'s map, to a new figure), in Structure (the view Core) and in QC (the variance beyond counting). In Figures, arrange them: the scores, where the least tolerant residues sit, and the bottleneck behind every SE. Export the figure as PDF: it carries what each panel shows and was drawn from (Run 1 by its output\'s SHA-256, the QC thresholds and the acknowledgement, the view\'s image). Drop the PDF on the window: it says so, panel by panel, and what has changed since.'],
    ],
  },
  {
    id: 'hsp90',
    title: 'Hsp90, nine positions over 21 generations (published)',
    summary: 'A growth selection of every codon at positions 582–590 of yeast Hsp90 (Hsp82), sampled eight times over 21 generations in one replicate: the first EMPIRIC experiment.',
    question: 'How fast does each variant grow per generation, which of the nine positions tolerate change, and what can one replicate tell and not tell?',
    source: 'MaveDB urn:mavedb:00000011-a-1 (counts, unchanged)',
    license: 'CC0 1.0',
    citation: 'Hietpas RT, Jensen JD, Bolon DNA. Experimental illumination of a fitness landscape. PNAS 2011;108:7896–7901. doi:10.1073/pnas.1016024108',
    simulated: false,
    files: { counts: 'examples/hsp90/counts.csv', design: 'examples/hsp90/design.json', target: 'examples/hsp90/target.fasta', notice: 'examples/hsp90/NOTICE.txt' },
    // MaveDB names each codon variant on its own row: read at the protein level (codons.js).
    assembly: { codons: { from: 'hgvs_nt' } },
    // The times are generations: the first run scores per generation.
    parameters: { timeScale: 'unit' },
    findings: { 'time-fit': 'fail' },
    teaches: ['replicates', 'readout-terms', 'library-method'],
    opens: 'map',
    expected: [
      'Read as codon variants, MaveDB\'s 568 rows become 188 protein variants: each substitution\'s codons combined, and the wild type, which MaveDB writes once per position, read once.',
      'Per generation, positions 585–587 (W, S, A) tolerate almost nothing (missense medians about −0.35) and 582 and 590 almost everything; synonymous codons score near 0.',
      'The scores follow the published fitness per generation where the authors fit every time point: r about 0.95, a median 0.005 apart. The record says its slopes are of log₂ ratios, but they are of natural logarithms, as MaveScape\'s are. Stops score about −0.32 against the published −0.77: the authors fit null-like variants on the first three time points only.',
      'QC fails the fit of the time courses: they scatter about 44× more than counting predicts, and stops fall to the floor within a few generations. Each slope\'s SE comes from its own residuals.',
      'One replicate: agreement, the variance beyond counting and outlier replicates are not assessed. What the analysis can do says so, and that the record gives no MaveDB terms for the assay or the library.',
      'Compared with the record\'s own published scores, kept beside (urn:mavedb:00000011-a-1): 187 variants, r 0.95; stated to be on one scale (both natural-log change per generation), Lin\'s concordance is only 0.48 and the bias 0.22. The difference grows with the effect (a Bland–Altman slope of −0.91), most at 585–587 (0.34 to 0.39 on average). One experiment analysed twice: the agreement measures the analyses.',
      'From a checkpoint, the first three samples fitted (generations 9 to 21 not used): 148 of the 188 variants move beyond their earlier 95% interval and 102 change class, 93 from lower than the wild type to like it. The time courses bend: the stops fall faster at first (a median of −0.41 per generation over six generations, −0.32 over 21, not the published −0.77), while at 584, 588 and 589 most substitutions have barely begun to fall (medians of about −0.02 per generation, against −0.16 to −0.26). The pseudocount moves none (0.5 → 0.1): weighted regression gives the few reads at the floor little weight.',
    ],
    steps: [
      ['map', 'Look at the map: nine positions by every substitution. Click a dark cell at position 585: the inspector draws its time course over the eight samples.'],
      ['qc', 'In QC, open "Fit of the time courses": the departures from a line are large, most of all for stops, which fall to the floor and stay.'],
      ['score', 'In Score, set "A score is the change" to over the whole time course and score again: every score is 21 times the one per generation. In Report, the methods say what each run\'s scores are, and what was not recorded.'],
      ['experiment', 'In Experiment, read "What the analysis can do": with one replicate nothing between replicates is assessed, and a second replicate would add it.'],
      ['report', 'In Report, keep a checkpoint ("All eight samples"). In Experiment, set the columns of generations 9 to 21 "Not used", fitting the first three samples as the authors fit their null-like variants, and score again. Back in Report, what changed from the checkpoint: 148 of the 188 variants moved beyond their earlier 95% interval and 102 changed class. The time courses are not straight: over the first six generations the stops fall faster, while at 584, 588 and 589 most substitutions have barely begun to fall. The map of the change shows where.'],
      ['compare', 'In Compare, Other sources: add urn:mavedb:00000011-a-1, the record\'s own published scores (a higher score is more growth), kept beside without opening it, and compare Run 1 with it. They correlate at r 0.95, but under Scale, stated to be on one scale, Lin\'s concordance is only 0.48: the Bland–Altman plot shows the difference growing with the effect, most at 585–587. The authors fit null-like variants on their first three time points, before they reach the floor; Run 1 fits all eight. How deleterious those variants are depends on that choice.'],
    ],
  },
  {
    id: 'factor9',
    title: 'Coagulation factor IX, sorted bins (published)',
    summary: 'Every substitution of the 461-residue factor IX, secreted from human cells and displayed on their surface (MultiSTEP), sorted into four bins of its strep II tag signal, in three overlapping tiles of three replicates.',
    question: 'Which factor IX variants are still secreted, and how sure are the scores when the reads far outnumber the cells sorted?',
    source: 'MaveDB urn:mavedb:00001200-a-1 (counts, unchanged)',
    license: 'CC0 1.0',
    citation: 'Popp NA, et al. Multiplex, multimodal mapping of variant effects in secreted proteins. Nature Structural & Molecular Biology 2025. doi:10.1038/s41594-025-01582-w',
    simulated: false,
    files: { counts: 'examples/factor9/counts.csv', design: 'examples/factor9/design.json', target: 'examples/factor9/target.fasta', notice: 'examples/factor9/NOTICE.txt' },
    findings: { 'excess-variance': 'fail' },
    teaches: ['gates', 'bin-cells'],
    opens: 'map',
    expected: [
      'The map covers all 461 positions; positions 146–164 and 299–318 are measured in two tiles, and their scores combine both.',
      'QC fails the variance beyond counting, about 2,300× what counting predicts: some 10,000 reads per variant in each bin far exceed the cells sorted. The moderated combination carries the excess into every SE.',
      'The cells per bin are not assessed, and the bins cannot be scored by maximum likelihood: MaveDB records neither the cells sorted nor the gates. What the analysis can do names both, and the sorter\'s report that has them.',
      'With MaveScape\'s defaults (each replicate scaled to nonsense 0 and wild type 1) the scores follow the published ones with r 0.994; with MultiSTEP\'s own scale (the lowest 5% of missense at 0) and the replicates\' mean, r 0.9995, and the nonsense median is 0.47.',
      'Selected by query, with UniProt\'s features beside the map, the substitutions of the 22 cysteines in factor IX\'s 11 disulfide bonds ("missense from C in feature disulfide") are mostly lost: 345 of the 399 scored are lower than the wild type beyond their uncertainty, against 2,124 of the 8,529 missense variants scored in all. A secreted protein needs its disulfide bonds.',
      'The structure of activated factor IX (PDB 1RFN, X-ray at 2.8 Å) holds its protease domain (chain A) and second EGF domain (chain B): 14 of the cysteines, in seven of the disulfide bonds, one of them joining the two chains. Mapped onto it, the target is on chain A at 227–461, all identical, and on chain B at 132–188, where SIFTS places them; the entry\'s own record numbers chain B five earlier.',
    ],
    steps: [
      ['map', 'Look at the map: the protease domain and the second EGF domain hold most of the positions that tolerate nothing, the propeptide and the Gla domain almost none. Click a cell: the inspector shows its distribution over the four bins in each replicate.'],
      ['qc', 'In QC, open "Variance beyond counting": the replicates of each tile differ about 2,300× more than counting predicts, because the cells sorted, not the reads, limit what is known.'],
      ['experiment', 'In Experiment, read "What the analysis can do": the gates and the cells sorted into each bin are missing, and would unlock maximum likelihood and the cells per bin.'],
      ['score', 'In Score, set the bins\' scale to the lowest 5% and the replicates combined by their mean, and score again: MultiSTEP\'s own settings, close to the published scores.'],
      ['map', 'Back on the map, Tracks, "Add a track": UniProt\'s features. Then type in the query field below the map "missense from C in feature disulfide": the substitutions of the cysteines that make factor IX\'s disulfide bonds. Add "and lower" to keep those lower than the wild type beyond their uncertainty, save the selection as Disulfides, and try "missense and lower and not in Disulfides" for the rest.'],
      ['structure', 'In Structure, Structures of the target lists the 63 PDB entries SIFTS places factor IX on. Open 1RFN by its ID: activated factor IX, its protease domain (chain A) and second EGF domain (chain B). The target on the structure: chain A holds positions 227–461, all identical, though the entry numbers them as chymotrypsin is numbered (16–245); choose chain B, at 132–188, which the entry\'s own record numbers five earlier. Under Residues, select "resn CYS" and draw them as sticks: 14 cysteines in seven disulfide bonds, one joining the two chains.'],
    ],
  },
  {
    id: 'pten-mavedb',
    title: 'PTEN abundance, opened from MaveDB (published scores)',
    summary: 'VAMP-seq abundance of 4,409 PTEN variants, opened from MaveDB as published: scores alone, no counts, with the record\'s license, citation, assay and six calibrations.',
    question: 'What can a published record of scores alone show, what does it leave out, and where would the rest be found?',
    source: 'MaveDB urn:mavedb:00000013-a-1 (the scores, downloaded when opened; SHA-256 checked)',
    license: 'CC0 1.0',
    citation: 'Matreyek KA, et al. Multiplex assessment of protein variant abundance by massively parallel sequencing. Nat Genet 2018;50:874–882. doi:10.1038/s41588-018-0122-z',
    simulated: false,
    // Opened from MaveDB through the program's fetcher (wave 3, slice 2), its table checked against
    // the checksum it had when the example was made.
    mavedb: { urn: 'urn:mavedb:00000013-a-1', scores: { sha256: 'ceaf3f0720af8aa06012d60959efbcd7ab54a5317d2bebdace8a0f49de4b2b97', size: 1735960 } },
    // The record gives the assay in MaveDB's terms, not what a higher score means: from the paper,
    // more abundance.
    readout: { direction: 'higher-more' },
    findings: { coverage: 'review' },
    teaches: ['counts'],
    opens: 'map',
    expected: [
      'All 4,409 variants have a score, with the standard error and 95% interval the record gives: synonymous median 1.00, nonsense 0.06 (the separation of the controls, AUC 0.98). MaveScape reads them as published and does not rescore them.',
      'About a quarter of missense variants (25%) score below 0.5; the least tolerant positions are spread through both the phosphatase and the C2 domain, as a stability readout expects.',
      'QC passes what it can assess from scores alone, but coverage: 53% of all possible substitutions, the library made by oligo-directed mutagenic PCR. Every finding about counts is not assessed.',
      'What the analysis can do: rescoring and QC of the counts need counts, which MaveDB does not hold for this record; the readiness says where they may be found.',
      'Against PTEN\'s lipid phosphatase activity (urn:mavedb:00000054-a-1, Mighell et al. 2018, kept beside the workspace without opening it), abundance agrees only in part (4,057 variants, r 0.45, ρ 0.37): two assays, and a variant can be stable but inactive. Rescaled by their anchors, the report names each: the activity record\'s wild type is its row, 1 with an SE of 0, though its methods place wild type-like variants from −1.11 to 0.89. Against AlphaMissense, abundance tells its likely benign substitutions from its likely pathogenic ones with an AUC of 0.77 (ρ 0.48).',
      'On PTEN\'s structure (1D5R), buried positions (158) score a median of 0.51, exposed ones (119) 0.84: a buried position scores lower 80% of the time (Mann–Whitney, q 9.5e-18). The 55 least tolerant positions make 117 pairs within 8 Å, against 88.0 among positions as buried (p 0.001) and 47.3 among any: beyond their burial they cluster, one compact group joining the phosphatase and C2 domains.',
    ],
    steps: [
      ['map', 'The map shows PTEN\'s abundance as MaveDB publishes it, the wild type at 1 and nonsense near 0, in the run "Published scores". Click a cell: its score, SE and 95% interval are the record\'s own.'],
      ['experiment', 'Select the table in the sidebar: the inspector shows the MaveDB record, its license and citation, and the assay in MaveDB\'s terms (a reporter, loss of function, human cells), which became the design\'s readout; the record does not say what a higher score means, so the example states it, from the paper. Below it, its six calibrations, shown as published (MaveScape classifies no variant). In Experiment, "What the analysis can do" says the counts are not in MaveDB, and where they may be (the paper\'s supplement, the raw reads PRJNA428380).'],
      ['qc', 'In QC, what scores alone show: the controls separate (AUC 0.98) and the scores resolve them; coverage is 53% of all substitutions. The findings about counts are not assessed.'],
      ['score', 'In Score, set a maximum SE of 0.15 and read the scores again: the second run leaves the uncertain variants out, each with the stage that left it out.'],
      ['compare', 'In Compare, under Other sources, add urn:mavedb:00000054-a-1, PTEN\'s lipid phosphatase activity, saying that a higher score means more of the function: it is kept beside the workspace, not opened, and compared with the abundance as another assay of PTEN. Then add AlphaMissense and choose it as the second side: by rank, and in Classes, how well the abundance tells its likely benign substitutions from its likely pathogenic ones.'],
      ['structure', 'In Structure, open 1D5R from Structures of the target: PTEN\'s phosphatase and C2 domains. Under Structure as evidence, buried positions score lower than exposed ones, as an abundance assay expects. The 20% least tolerant positions cluster beyond what their burial explains: one compact group joins the two domains (L98, S170, Y174, Y177 with W274 and N276). Select it: its variants are selected on the map, where the structural classes and secondary structure now lie beside the scores.'],
    ],
  },
  {
    id: 'brca1-sge',
    title: 'BRCA1 saturation genome editing, opened from MaveDB (nucleotide variants)',
    summary: '3,893 single-nucleotide variants of 13 exons of BRCA1 and their flanking introns, edited into the genome of HAP1 cells, named on the RefSeq transcript (fetched from NCBI) and read at the protein level, with the counts the authors deposited.',
    question: 'What do nucleotide variants of a gene do to its protein, which of them can a map of substitutions not show, and how close do the deposited counts come to the published scores?',
    source: 'MaveDB urn:mavedb:00000097-0-2 (its scores and counts, downloaded when opened; SHA-256 checked) and NCBI\'s RefSeq NM_007294.3',
    license: 'CC0 1.0',
    citation: 'Findlay GM, et al. Accurate classification of BRCA1 variants with saturation genome editing. Nature 2018;562:217–222. doi:10.1038/s41586-018-0461-z',
    simulated: false,
    // Opened from MaveDB through the program's fetcher (wave 3, slice 3), its target the transcript
    // its record names, fetched from NCBI as GenBank.
    mavedb: { urn: 'urn:mavedb:00000097-0-2', scores: { sha256: '906dc152f28b4c8261e4e532a03c9c42f2e45e211aa3ada12e3c826c151580ec', size: 610024 }, counts: { sha256: '9d2e8281ff55d87e6ef0ada99a8fc6973073741d9c97ce6bea70e62eca7cdabc', size: 368636 } },
    // Function scores: from the paper, a lower score is less of the function (depletion from the
    // cells, which need BRCA1).
    readout: { direction: 'higher-more' },
    findings: { coverage: 'fail' },
    teaches: [],
    opens: 'map',
    expected: [
      'Every one of the 3,893 variants is valid on NM_007294.3: 2,077 missense, 579 synonymous, 138 nonsense and 9 at the start codon, with 891 intronic, 143 at splice sites and 56 in the 5′ UTR. MaveScape reads their scores as published.',
      'On the map, the coding variants read at the protein level: 2,251 protein variants, 391 of them made by more than one nucleotide variant and merged as DiMSum merges them. The 1,090 variants with no protein change to draw (intronic, splice-site, UTR) are listed beside the map.',
      'Nonsense variants score far below synonymous ones (medians −2.12 and −0.01; AUC 0.99); splice-site variants score like nonsense (median −2.02, 92% below −1), intronic ones a few bases further in like synonymous ones (median −0.18).',
      'QC fails coverage: 17% of the substitutions one base change makes, on the whole protein. The variants lie in two stretches, positions 1–101 and 1631–1855, the exons the experiment edited.',
      'The counts open with a design drafted from their names: two replicates, day 5 to day 11. Scored, they agree with the published scores at r ≈ 0.76 (Compare): the authors normalized each exon apart and corrected for position within it, which the counts do not record, so the comparison gives correlations only.',
    ],
    steps: [
      ['map', 'The map shows BRCA1\'s function scores as published, each coding variant read for the protein change it makes. Click the stop at codon 1853 (p.Tyr1853Ter): two nucleotide variants make it, each with its score, merged into the cell.'],
      ['map', 'Open "Not on the map" beside it and choose splice site: the variants at the exons\' edges (c.5194-2A>G), scoring as low as stops. Intronic ones, a few bases further in, mostly score like synonymous variants.'],
      ['experiment', 'Select the target in the sidebar: the RefSeq transcript NM_007294.3, fetched from NCBI as GenBank, numbered from its coding sequence (233–5,824), its translation the record\'s protein.'],
      ['qc', 'In QC, the stops separate from the synonymous variants (AUC 0.99), but coverage fails: the whole protein counts as designed. The variants lie in two stretches (1–101, 1631–1855), the exons edited: given as the library\'s tiles in Experiment, coverage is judged within them.'],
      ['experiment', 'Select the counts table: its design was drafted from the column names, two replicates from day 5 to day 11, the library and RNA counts set aside.'],
      ['compare', 'In Score, score the counts; then open Compare: Run 1 against the published scores, all 3,893 variants matched. They agree at r ≈ 0.76, and the report says why only correlations are shown: the published scores were normalized exon by exon and corrected for position within each, a scale the counts do not record, and both come from one experiment.'],
    ],
  },
  {
    id: 'dhfr-lon',
    title: 'DHFR with and without the Lon protease, opened from MaveDB (two conditions)',
    summary: 'Growth of E. coli that depends on each substitution of its dihydrofolate reductase, over 18 hours in a turbidostat, in a strain without the Lon protease and again with Lon restored: two MaveDB score sets, their counts opened together as one experiment of two conditions.',
    question: 'Which substitutions does the Lon protease penalize, how sure is each difference, and where in the protein are they?',
    source: 'MaveDB urn:mavedb:00000063-b-1 (−Lon) and urn:mavedb:00000063-a-1 (+Lon) (their scores and counts, downloaded when opened; SHA-256 checked)',
    license: 'CC0 1.0',
    citation: 'Thompson S, Zhang Y, Ingle C, Reynolds KA, Kortemme T. Altered expression of a quality control protease in E. coli reshapes the in vivo mutational landscape of a model enzyme. eLife 2020;9:e53476. doi:10.7554/eLife.53476',
    simulated: false,
    // Two score sets opened together (wave 3, slice 6): their counts joined, a condition each, with
    // the design the paper describes (four sub-libraries, two grown in each repeat), which the
    // column names do not say.
    mavedb: {
      records: [
        { urn: 'urn:mavedb:00000063-b-1', scores: { sha256: 'adbc659430f09e964d04ddcc234d98fbd70123703edbd8ca53009726b371c04f', size: 242193 }, counts: { sha256: '297484d87b619aee5d0c408bf75a82b8988be9e5c66169a5758b69b1b19364fc', size: 968272 } },
        { urn: 'urn:mavedb:00000063-a-1', scores: { sha256: 'd39a97f64c378d7d102b0cbc8c5151fe202a1258f229c7cdd58b048a0e85b90e', size: 239726 }, counts: { sha256: 'c63e1d4e521b4246b2b2588f2d999856521261dd772062282da1f71498124e49', size: 974798 } },
      ],
    },
    files: { design: 'examples/dhfr-lon/design.json' },
    // Growth: a higher score is a faster-growing variant (the paper's selection coefficients).
    readout: { direction: 'higher-more' },
    findings: { missingness: 'review', dropout: 'review', agreement: 'review', 'excess-variance': 'fail', 'outlier-replicate': 'review', separation: 'review', 'time-points': 'fail', 'time-fit': 'fail' },
    teaches: [],
    // The map opens on the difference between the conditions.
    map: { colorBy: 'differential' },
    opens: 'map',
    expected: [
      'Opened together, the two score sets become one experiment: 24 time series under two conditions (−Lon the reference), four sub-libraries of 40 positions each grown three times, two sub-libraries in each repeat. Each replicate measures only its own sub-library\'s positions, though its samples hold two.',
      'With MaveScape\'s defaults (weighted regression) the scores follow the published ones at r ≈ 0.90 without Lon and 0.96 with it; with the authors\' unweighted regression (ordinary least squares), r ≈ 0.96 and 0.98, on the same scale (the published scores are Enrich2\'s slopes over the whole 18 hours).',
      'Without Lon about twice as many substitutions grow faster than the wild type (a score above 0.2) as with it, as the paper found (736 and 384 published). The difference +Lon − −Lon is negative almost everywhere it is called, most at native hydrophobic residues (V, I, L, M, F, W, Y), as the paper found for the buried core.',
      'QC fails the variance beyond counting and the fit of the time courses, and reviews the time points used and the dropout: a variant below 2 × 10⁻⁵ of the reads was not reported at a time point, so the most depleted drop out and their slopes rest on the early time points, as the authors\' did.',
      'Compared, −Lon and +Lon agree at r 0.52 over every variant both score, and 0.77 with low confidence left out: Run 1 scores many variants of few reads, which agree little. Of the 1,715 then compared, 201 differ beyond their uncertainty, 186 lower with Lon; the differences are 2.8 times as variable as their SEs say.',
      'Checked against 47 other reasonable analyses, 54 of Run 1\'s 377 differences between the conditions are called in every one and 172 in 90% of them or more. Most of the others depend on how uncertain each difference is taken to be (REML or the replicates\' mean in place of the moderated combination), some on the model of the time course (ordinary least squares, or the first and last time points). Fixed effects are not tried: the replicates differ 1.7 times as much as their SEs say.',
    ],
    steps: [
      ['map', 'The map shows the difference +Lon − −Lon (Run 1): blue where Lon penalizes a substitution. Click a dark blue cell: the inspector shows the variant\'s time courses in its sub-library\'s three replicates, its score in each condition, and the difference with its interval and q.'],
      ['experiment', 'In Experiment, the design the paper describes: two conditions, four sub-libraries (tiles) of 40 positions, each grown three times, two in each repeat; the transformation and outgrowth samples set aside. MaveDB keeps the conditions as two score sets; opened together, their counts are joined, each record\'s columns named by its URN.'],
      ['qc', 'In QC, read "Missing after selection" and "Fit of the time courses": counts below the reporting frequency are missing, not zero, so depleted variants are fitted on their early time points.'],
      ['score', 'In Score, below Run 1, "Check robustness": the run is scored again 47 other reasonable ways (ordinary least squares, the authors\' unweighted regression, among them; each of the 24 replicates left out). Under +Lon vs −Lon, only 54 of the 377 differences are called in every analysis, 172 in 90% of them: the model of the time course and the combination of replicates decide the rest. Scoring with least squares as the run reproduces the published scores more closely.'],
      ['map', 'Color the map by each condition\'s scores, or open the published runs: the substitutions that grow faster than the wild type without Lon (red) mostly lose that advantage with it.'],
      ['compare', 'In Compare, choose Run 1: −Lon and Run 1: +Lon and leave out low confidence: they agree at r 0.77. Under Disagreement, 201 of 1,715 variants differ beyond their uncertainty, 186 of them lower with Lon, most at W47, W30 and P126; the differences are 2.8 times as variable as their SEs say, so read those counts as an upper bound. Under Maps, the difference beside the two maps.'],
    ],
  },
  {
    id: 'brca1-ring',
    title: 'BRCA1 RING domain, from MaveDB and back (round trip)',
    summary: 'E3 ubiquitin ligase activity of 12,316 amino-acid variants of the BRCA1 RING domain, phage-displayed and selected for their own ubiquitination over five rounds: opened from MaveDB with its counts, scored, deposited in MaveDB\'s format and opened again.',
    question: 'Does rescoring the counts reproduce the published scores, and does a deposit carry the scores and their record back to MaveDB without loss?',
    source: 'MaveDB urn:mavedb:00000003-a-2 (its scores and counts, downloaded when opened; SHA-256 checked)',
    license: 'CC0 1.0',
    citation: 'Starita LM, et al. Massively parallel functional analysis of BRCA1 RING domain variants. Genetics 2015;200:413–422. doi:10.1534/genetics.115.175802; scored by Enrich2: Rubin AF, et al. A statistical framework for analyzing deep mutational scanning data. Genome Biol 2017;18:150. doi:10.1186/s13059-017-1272-5',
    simulated: false,
    // Opened from MaveDB with the design the record's method text and the paper describe (the
    // counts' names hold the yeast two-hybrid assay too, a separate experiment).
    mavedb: { urn: 'urn:mavedb:00000003-a-2', scores: { sha256: '4f18e53106ce809bc2fea09f7af21b70e6f08faf4f46efdd2a79183168d573a5', size: 3193620 }, counts: { sha256: 'c6afef9deec861cea25f879473fc9de3d718e0bd1109b1860fdfc77e4c1973a3', size: 4607317 } },
    files: { design: 'examples/brca1-ring/design.json' },
    readout: { direction: 'higher-more' },
    findings: { dropout: 'review', coverage: 'review', agreement: 'review', 'excess-variance': 'fail', 'time-points': 'review', 'time-fit': 'fail' },
    teaches: [],
    opens: 'map',
    expected: [
      'MaveDB\'s counts read as 12,316 amino-acid variants with Enrich2\'s _wt and _sy rows; the design gives two library preparations of three replicates, rounds 0–5, the replicates of a preparation sharing its input, and sets the yeast two-hybrid columns aside.',
      'The RING\'s eight zinc ligands are among its twelve least tolerant positions (median scores about −3, against −0.7 for a typical position).',
      'With MaveScape\'s defaults every replicate score equals the published one (about 50,000, within 2 × 10⁻¹⁴): weighted regression with wild-type normalization is Enrich2\'s. The combined scores differ a little (r ≈ 0.99): the moderated combination against Enrich2\'s random effects.',
      'With the Enrich2-compatible preset the combined scores follow the published ones exactly where Enrich2\'s estimator converged (r 1.000), and 6,847 variants are scored, as many as MaveDB\'s.',
      'Deposited in MaveDB\'s format and opened again, the run\'s scores come back exactly and the deposit written again is the same bytes: nothing is lost on the round trip.',
      'Certified with the published scores, Run 1 and the Enrich2 rescoring, its 110,975 numbers (each variant\'s score, SE and class, each run\'s QC, the report) are computed again from MaveDB\'s two tables and verified bit for bit. The review report holds them in one file, every number it shows traced to where it comes from and any variant\'s looked up. Certified without its tables, it names them by the SHA-256 of MaveDB\'s files: verifying it alone says they are missing, and with the two files downloaded from the record it is verified.',
    ],
    steps: [
      ['map', 'The map shows Run 1, the counts scored with MaveScape\'s defaults: the RING\'s eight zinc ligands (C24, C27, C39, H41, C44, C47, C61, C64 on BRCA1\'s numbering) are among its twelve least tolerant positions. Click a cell: its six replicate scores, and the published score in the run "Published scores".'],
      ['experiment', 'In Experiment, the design: two library preparations, three replicates each, rounds 0 to 5, the inputs shared; the yeast two-hybrid columns, BARD1 binding, set aside with the reason.'],
      ['qc', 'In QC, the dropout and the fit of the time courses: over five rounds most variants that lose activity fall below detection, as stops do.'],
      ['score', 'In Score, choose the Enrich2-compatible preset and score again: the combined scores now equal the published ones, made by Enrich2 in 2017.'],
      ['report', 'In Report, Certificate, "Certify…": the workspace with every number it reports (110,975: each run\'s scores, SEs and classes, its QC, the report) computed again from MaveDB\'s two tables, and a fingerprint to quote. "Verify…" computes them all once more and compares them bit for bit: verified. "Review report…" writes one HTML file a reviewer opens in any browser: every number it shows traced to where it comes from, any variant\'s looked up. With "Include the count tables" unchecked, the certificate names the tables by their SHA-256, MaveDB\'s files: a reviewer downloads them from the record and verifies it with them.'],
      ['score', 'From Run 1\'s Export menu, "Deposit in MaveDB": the scores, counts and methods as MaveDB takes a score set, the experiment described as the record\'s (give its URN, urn:mavedb:00000003-a, to add the score set to it). Download the package as a ZIP and drop it on the window: it opens as a record from MaveDB does, and its scores, read as published, are Run 1\'s exactly.'],
    ],
  },
  {
    id: 'tp53-screens',
    title: 'TP53, two screens on two scales, opened from MaveDB (published scores)',
    summary: 'Every substitution of TP53 (with arginine at 72) screened in p53-null A549 cells under etoposide, as Z-scores (Giacomelli et al. 2018), compared with an independent screen of its DNA-binding domain by the growth of H1299 cells, as log₂ fold changes (Kotler et al. 2018): two assays, two scales, opposite signs.',
    question: 'Do two screens of p53\'s function, in different cells, on different scales and with opposite signs, agree on which variants lose it?',
    source: 'MaveDB urn:mavedb:00000068-c-1 (opened) and urn:mavedb:00000059-a-1 and urn:mavedb:00000068-b-1 (kept beside, not opened): published scores, downloaded when used; SHA-256 checked',
    license: 'CC0 1.0',
    citation: 'Giacomelli AO, et al. Mutational processes shape the landscape of TP53 mutations in human cancer. Nature Genetics 2018;50:1381–1387. doi:10.1038/s41588-018-0204-y; Kotler E, et al. A systematic p53 mutation library links differential functional impact to cancer mutation pattern and evolutionary conservation. Molecular Cell 2018;71:178–190. doi:10.1016/j.molcel.2018.06.012',
    simulated: false,
    // Published scores only (wave 4, slice 6): the two other screens are compared without opening
    // them (Compare, Other sources).
    mavedb: { urn: 'urn:mavedb:00000068-c-1', scores: { sha256: '085237d96f287ce8642d49372b46ef9dc07c08e84240c04cfc17d8fb42977022', size: 553289 } },
    // Under etoposide a variant like the wild type scores higher (its synonymous variants' median
    // 0.37, its nonsense variants' −1.52); MaveDB records no direction.
    readout: { direction: 'higher-more' },
    findings: { separation: 'review' },
    teaches: ['target-identifiers', 'score-se'],
    opens: 'map',
    expected: [
      'Opened from MaveDB, the etoposide screen\'s published scores: 8,258 of 8,274 variants, Z-scores without standard errors, on TP53 with arginine at 72. The record names no UniProt entry; checked against P04637, the target is its positions 1–393 with one difference, P72R.',
      'Kotler et al.\'s record (urn:mavedb:00000059-a-1), kept beside without opening it, writes 936 protein variants on several rows with different scores (2,908 rows: several codons, and no nucleotide names to tell them apart). Each is read as one, averaged, as DiMSum merges codons; its 191 frameshifts written alike at a codon are left out.',
      'Matched on P04637\'s numbering (Kotler et al.\'s target is the DNA-binding domain alone, numbered from 102), 3,341 variants: r −0.78 as published. With Kotler et al.\'s direction stated (a higher score is less of p53\'s function), r 0.78 and Spearman\'s ρ 0.72; on two scales, Lin\'s concordance and Bland–Altman are withheld.',
      'Rescaled by their anchors (synonymous median 0, nonsense median −1), Lin\'s concordance is 0.78 and the bias −0.04 (limits of agreement −0.71 to 0.63): on one scale the two screens agree. Of the positions whose differences are largest, four lie at 180–184 (D184, E180, R181, C182), lower under etoposide.',
      'Giacomelli et al.\'s nutlin-3 screen of the same library (urn:mavedb:00000068-b-1; there a higher score is less function) against etoposide: 8,258 variants, r 0.75 as stated, Lin\'s concordance 0.72 rescaled.',
      'QC reviews the separation of the controls. Neither record gives standard errors, so the scores\' resolution is not judged and no difference between the screens is tested.',
    ],
    steps: [
      ['map', 'The map shows Giacomelli et al.\'s etoposide screen as published: Z-scores of 8,258 variants over all 393 residues of TP53, with arginine at 72. Here a variant like the wild type scores higher (synonymous variants 0.37, nonsense −1.52); the positions that tolerate nothing lie in the DNA-binding domain, 102–292.'],
      ['experiment', 'The record names no UniProt entry. In Experiment, Target, "Check against UniProt" with P04637: positions 1–393, one difference, arginine at 72 (the allele the screen used). "Record the check": the target now carries P04637, as Kotler et al.\'s record does.'],
      ['compare', 'In Compare, Other sources: add urn:mavedb:00000059-a-1, Kotler et al.\'s screen of the DNA-binding domain by the growth of H1299 cells, kept beside the workspace without opening it, and compare it with the published scores. Matched on P04637\'s numbering (its target is the domain alone, numbered from 102): 3,341 variants, r −0.78. The two screens seem to disagree completely.'],
      ['compare', 'MaveDB records no direction. In Kotler et al.\'s screen cells without p53\'s function outgrow the others, so a higher score is less of it: say so for the score set. Compared negated, r 0.78; but a Z-score and a log₂ fold change are two scales, so Lin\'s concordance and Bland–Altman are withheld, and the report says why.'],
      ['compare', 'Under Scale, rescale each by its own anchors (synonymous median 0, nonsense median −1): Lin\'s concordance 0.78, a bias of −0.04. On one scale the two screens agree. Neither gives SEs, so no variant is tested as different; under Disagreement, the positions that differ most, four of them at 180–184.'],
      ['compare', 'Add urn:mavedb:00000068-b-1, Giacomelli et al.\'s nutlin-3 screen of the same library (a higher score is less function there too) and compare it with etoposide: r 0.75, Lin\'s concordance 0.72 rescaled. Two selections of one library differ about as much as two laboratories\' screens.'],
    ],
  },
  {
    id: 'brca1-calibration',
    title: 'BRCA1 against ClinVar, calibrated (published scores)',
    summary: 'Findlay et al.\'s saturation genome editing of BRCA1, opened from MaveDB as published, with ClinVar\'s records of BRCA1 as NCBI gave them on 13 October 2026: how far the function scores separate ClinVar\'s pathogenic and benign missense variants, the evidence each class would give, for research, and how much of the agreement may rest on the assay itself.',
    question: 'How far do the function scores separate ClinVar\'s pathogenic and benign missense variants of BRCA1, and how much of that agreement could rest on the assay itself?',
    source: 'MaveDB urn:mavedb:00000097-0-2 (its scores, downloaded when opened; SHA-256 checked) and ClinVar\'s records of BRCA1 (NCBI E-utilities, retrieved 2026-10-13, with the example)',
    license: 'CC0 1.0 and public domain (ClinVar)',
    citation: 'Findlay GM, et al. Accurate classification of BRCA1 variants with saturation genome editing. Nature 2018;562:217–222. doi:10.1038/s41586-018-0461-z; Landrum MJ, et al. ClinVar. Nucleic Acids Res 2018;46:D1062–D1067',
    simulated: false,
    mavedb: { urn: 'urn:mavedb:00000097-0-2', scores: { sha256: '906dc152f28b4c8261e4e532a03c9c42f2e45e211aa3ada12e3c826c151580ec', size: 610024 } },
    readout: { direction: 'higher-more' },
    // ClinVar's records of the gene, as the ClinVar track keeps them (web/examples/clinvar/): the
    // annotation the example opens with, so that its numbers hold (wave 8, slice 6).
    clinvar: 'BRCA1',
    findings: { coverage: 'fail' },
    teaches: [],
    opens: 'calibrate',
    expected: [
      'ClinVar\'s records of BRCA1 come with the example: 9,385 records as NCBI gave them on 13 October 2026, kept as the ClinVar track keeps them. By the defaults (at least one review star, missense) they make 212 P controls and 447 B; the published scores hold 196 and 111 of them, since the experiment edited 13 exons. 552 were last evaluated by ClinVar\'s submitters in or after 2018, when the assay was published: their classifications may rest on it.',
      'Calibrated by the defaults: AUC 0.993 (DeLong\'s interval 0.985 to 1.000). The two thresholds, each letting at most 5% of the other side\'s controls into its class, cross, so they meet at −0.997 and no score is intermediate: 193 of the 196 P controls are abnormal-like and 109 of the 111 B WT-like.',
      'Evidence strength, for research: the abnormal-like class\'s OddsPath is 36.4, PS3 (strong) in 95% of the bootstrap\'s samples; the WT-like class\'s 0.0208, BS3 (strong) in all of them. Pathogenic-Strong begins below −1.34 by the scores\' likelihood ratios, Benign-Strong above −0.652.',
      'With the record\'s Fayer calibration (Findlay et al.\'s classes: below −1.328 and above −0.748), today\'s controls give OddsPath 53.5 and 0.0157 (189 P and 1 B abnormal-like; 2 P and 108 B WT-like), beside the 52.4 and 0.02 it states from ClinVar as it was in 2020, observed without the control Brnich et al. add (107 and 0.0105 here).',
      'Only the classifications last evaluated before 2018: 28 P and 87 B, of which the scores hold 25 and 12. They separate too (AUC 0.980), but the abnormal-like class\'s OddsPath is 9.12 (PS3_moderate; 5.76 with Fayer et al.\'s thresholds), and the WT-like class\'s 0.0436 rests on 11 B controls. The strong evidence rests on classifications made since the assay was published, some of which may have used it.',
    ],
    steps: [
      ['calibrate', 'The example opens in Calibrate with ClinVar\'s records of BRCA1 as they were on 13 October 2026, the ClinVar track beside the map (removing it and adding ClinVar again in Map, Tracks fetches today\'s). Under New control set, Make from ClinVar with the defaults: at least one review star, missense. Read the set\'s composition, what the published scores hold of it, and what may make it circular: 552 controls were last evaluated since the assay was published in 2018.'],
      ['calibrate', 'Calibrate with the defaults. Each side\'s scores against the run\'s: the controls barely overlap, so the two thresholds cross and meet at −0.997. The ROC curve\'s AUC is 0.993.'],
      ['calibrate', 'Under Evidence strength, each class\'s OddsPath and the strength Brnich et al.\'s Table 3 makes of it, for research: PS3 and BS3, both strong. What it rests on names the limits: thresholds set on these same controls, and 552 classifications that may rest on the assay itself.'],
      ['calibrate', 'Under Published calibrations, Calibrate with the thresholds of the Fayer calibration (Findlay et al.\'s classes). Its OddsPath on today\'s controls stands beside the one the calibration states, from ClinVar as it was in 2020.'],
      ['calibrate', 'Under New control set, give Last evaluated before 2018 and Make from ClinVar again, then calibrate the new set. Classifications made before the assay cannot rest on it: the scores separate them as well, but there are 25 P and 12 B, and the abnormal-like class\'s evidence is moderate, not strong.'],
      ['report', 'In Report, the section Calibration, for research: each control set, each calibration with its numbers and methods cited, and what limits it.'],
    ],
  },
  {
    id: 'tp53-calibration',
    title: 'TP53 against ClinVar, calibrated (published scores)',
    summary: 'Giacomelli et al.\'s screen of every substitution of TP53 under etoposide, opened from MaveDB as published, with ClinVar\'s records of TP53 as NCBI gave them on 13 October 2026: how far the screen separates ClinVar\'s pathogenic and benign missense variants, the evidence each class would give, for research, and why almost none of the labels predate it.',
    question: 'How far does the etoposide screen separate ClinVar\'s pathogenic and benign missense variants of TP53, and how firmly do the bootstrap and the controls\' history let its evidence stand?',
    source: 'MaveDB urn:mavedb:00000068-c-1 (its scores, downloaded when opened; SHA-256 checked) and ClinVar\'s records of TP53 (NCBI E-utilities, retrieved 2026-10-13, with the example)',
    license: 'CC0 1.0 and public domain (ClinVar)',
    citation: 'Giacomelli AO, et al. Mutational processes shape the landscape of TP53 mutations in human cancer. Nature Genetics 2018;50:1381–1387. doi:10.1038/s41588-018-0204-y; Landrum MJ, et al. ClinVar. Nucleic Acids Res 2018;46:D1062–D1067',
    simulated: false,
    mavedb: { urn: 'urn:mavedb:00000068-c-1', scores: { sha256: '085237d96f287ce8642d49372b46ef9dc07c08e84240c04cfc17d8fb42977022', size: 553289 } },
    readout: { direction: 'higher-more' },
    clinvar: 'TP53',
    findings: { separation: 'review' },
    teaches: [],
    opens: 'calibrate',
    expected: [
      'ClinVar\'s records of TP53 come with the example: 2,171 as NCBI gave them on 13 October 2026. By the defaults they make 227 P and 146 B missense controls, every one in the screen; the 17 records of a change at proline 72 are left out, since the screen\'s TP53 has arginine there. 370 of the 373 were last evaluated in or after 2018, when the screen was published.',
      'Calibrated by the defaults: AUC 0.984 (0.974 to 0.995). The thresholds, at Z-scores 0.0150 and 0.0554, make 211 P controls and 7 B abnormal-like, 135 B and 11 P WT-like.',
      'Evidence strength, for research: OddsPath 17.0 (PS3_moderate) and 0.0572 (BS3_moderate), each strong in about four of the bootstrap\'s samples in ten (44% and 43%); the thresholds\' intervals (−0.159 to 0.0716 and −0.0337 to 0.260) overlap. What it rests on says the strength is not held.',
      'Only the classifications last evaluated before 2018: 2 P and 3 B, too few for any measure; before 2021, 9 P and 10 B. Nearly every TP53 classification has been evaluated again since the screens of 2018 were published (133 of the controls by an expert panel), and may count them as functional evidence.',
      'With the record\'s ExCALIBR calibration (thresholds −0.318 and −0.0467, set by another method), the abnormal-like class holds 200 P controls and 1 B: OddsPath 64.3, PS3 in every sample; the WT-like 141 B and 18 P, 0.0867 (BS3_moderate). Thresholds not fitted to these controls are measured fairly by them.',
      'By the scores\' likelihood ratios, Pathogenic-Supporting begins below −0.222 and Pathogenic-VeryStrong below −0.621; Benign-Supporting above −0.0184 and Benign-VeryStrong above 1.23.',
    ],
    steps: [
      ['calibrate', 'The example opens in Calibrate with ClinVar\'s records of TP53 as they were on 13 October 2026. Make from ClinVar with the defaults: 227 P and 146 B missense controls, all of them in the screen; 370 were last evaluated since 2018.'],
      ['calibrate', 'Calibrate with the defaults: AUC 0.984. Under How far the bootstrap moves the thresholds, each threshold\'s interval is wider than the gap between them.'],
      ['calibrate', 'Under Evidence strength, both classes are moderate, but strong in about four samples of ten: what it rests on says the strength is not held.'],
      ['calibrate', 'Under New control set, give Last evaluated before 2018 and Make from ClinVar again: five controls are left. TP53\'s classifications have nearly all been evaluated again since these screens appeared.'],
      ['calibrate', 'Under Published calibrations, Calibrate with the ExCALIBR calibration\'s thresholds. They were not set on these controls, so these controls measure them fairly: the abnormal-like class\'s evidence is strong.'],
      ['calibrate', 'Under Score-level likelihood ratios, the ratio of the P controls\' density to the B controls\' at each score: where each strength begins, and how many of the screen\'s missense variants reach it.'],
    ],
  },
  {
    id: 'pten-calibration',
    title: 'PTEN abundance against ClinVar, calibrated (published scores)',
    summary: 'Matreyek et al.\'s VAMP-seq abundance of PTEN variants, opened from MaveDB as published, with ClinVar\'s records of PTEN as NCBI gave them on 13 October 2026: an abundance assay against pathogenic variants that may fold and still fail, and a gene with few benign controls.',
    question: 'What can an abundance assay\'s scores say about ClinVar\'s pathogenic and benign PTEN variants, and what do too few benign controls leave unsaid?',
    source: 'MaveDB urn:mavedb:00000013-a-1 (the scores, downloaded when opened; SHA-256 checked) and ClinVar\'s records of PTEN (NCBI E-utilities, retrieved 2026-10-13, with the example)',
    license: 'CC0 1.0 and public domain (ClinVar)',
    citation: 'Matreyek KA, et al. Multiplex assessment of protein variant abundance by massively parallel sequencing. Nat Genet 2018;50:874–882. doi:10.1038/s41588-018-0122-z; Landrum MJ, et al. ClinVar. Nucleic Acids Res 2018;46:D1062–D1067',
    simulated: false,
    mavedb: { urn: 'urn:mavedb:00000013-a-1', scores: { sha256: 'ceaf3f0720af8aa06012d60959efbcd7ab54a5317d2bebdace8a0f49de4b2b97', size: 1735960 } },
    readout: { direction: 'higher-more' },
    clinvar: 'PTEN',
    findings: { coverage: 'review' },
    teaches: [],
    opens: 'calibrate',
    expected: [
      'ClinVar\'s records of PTEN come with the example: 2,071 as NCBI gave them on 13 October 2026. By the defaults they make 255 P missense controls but only 9 B, of which the abundance scores hold 152 and 8: with fewer than 10 B controls, the view says, no measure of separation can be relied on. 251 were last evaluated in or after 2018.',
      'Calibrated by the defaults: AUC 0.698 (0.548 to 0.848). The normal threshold, letting at most 5% of the P controls be WT-like, lies above all B controls but one (1.19): 94 P controls and 7 B are intermediate, 55 P and no B abnormal-like (below 0.341).',
      'Evidence strength, for research: the abnormal-like class\'s OddsPath is 2.89 (PS3_supporting). The WT-like class holds one B control and three P (0.211), and 37% of the bootstrap\'s samples have no normal threshold at all. Score-level likelihood ratios need 10 B controls; there are 8.',
      'With the record\'s ExCALIBR calibration (0.551 and 0.818), 44 of the 152 P controls score WT-like: a pathogenic PTEN variant can be stable and still lose its function, which an abundance assay cannot see. Neither class gives evidence (OddsPath 1.39 and 0.592).',
      'With nonsense and synonymous controls too (375 P and 300 B, of which 198 and 127 scored), the AUC is 0.857 and the abnormal-like class PS3_moderate (12.5). MaveScape warns that 411 of them are on published scores whose scale may be set by such variants: this record\'s is, nonsense at 0 and the wild type at 1.',
    ],
    steps: [
      ['calibrate', 'The example opens in Calibrate with ClinVar\'s records of PTEN as they were on 13 October 2026. Make from ClinVar with the defaults: 255 P controls but only 9 B, and the view says what so few B controls mean.'],
      ['calibrate', 'Calibrate with the defaults: AUC 0.70. Each side\'s scores against the run\'s: many P controls score as high as the wild type, among the B controls.'],
      ['calibrate', 'Under Evidence strength: supporting for the abnormal-like class, a WT-like class resting on one B control, and no likelihood ratios, with fewer than 10 B controls.'],
      ['calibrate', 'Under Published calibrations, Calibrate with the ExCALIBR calibration\'s thresholds: 44 of the 152 P controls score WT-like. VAMP-seq measures abundance, and a pathogenic variant can be stable but inactive.'],
      ['calibrate', 'Under New control set, tick nonsense and synonymous too and Make from ClinVar, then calibrate the new set: the separation looks far better, and MaveScape says why it is not evidence: the published scale may be set by those very variants.'],
      ['report', 'In Report, the section Calibration, for research: each calibration with what limits it.'],
    ],
  },
  {
    id: 'simulated',
    title: 'A simulated experiment (known truth)',
    summary: 'A simulated two-population selection of a 40-residue protein, three replicates, where every variant\'s true effect is known.',
    question: 'How close do the scores come to the true effects, and where are they least certain?',
    source: 'Simulated by MaveScape (web/lib/simulate.js, seed 20261009): not real data',
    license: 'Simulated: no license needed',
    citation: null,
    simulated: true,
    simulation: { seed: 20261009, readsPerVariant: 150, libraryLogSd: 0.7, replicateNoise: 0.08 },
    opens: 'map',
    expected: [
      'Scores track the true effects closely, and their 95% intervals hold about 95% of them (the guide shows both once the run is scored).',
      'The least certain scores are the variants with the fewest reads before selection: their SEs are largest.',
      'Quality control passes: the counts vary as counting predicts.',
    ],
    steps: [
      ['map', 'Look at the map: nonsense (the * row) is uniformly low, synonymous cells (outlined) are white, missense varies by position.'],
      ['qc', 'Read the QC: a clean experiment passes everything. Change the "Variance beyond counting" threshold and see the finding react.'],
      ['score', 'In Score, rerun with REML instead of the moderated combination (the default): the scores barely move, but REML judges each variant from its three replicates alone, and its intervals are narrow wherever they happen to agree.'],
      ['map', 'Color the map by standard error: the uncertain cells are the variants rare in the library.'],
    ],
  },
  {
    id: 'simulated-time-series',
    title: 'A simulated time series (known truth)',
    summary: 'A simulated growth selection of a 40-residue protein sampled at five times over 8 generations, in three replicates, where every variant\'s true effect is known.',
    question: 'What does a regression on every time point add over the ratio of the first and last, and how linear are the time courses?',
    source: 'Simulated by MaveScape (web/lib/simulate.js, seed 20261012): not real data',
    license: 'Simulated: no license needed',
    citation: null,
    simulated: true,
    simulation: { seed: 20261012, times: [0, 2, 4, 6, 8], readsPerVariant: 100, libraryLogSd: 0.7, replicateNoise: 0.08 },
    opens: 'map',
    expected: [
      'Scored by weighted regression on every time point, the scores track the true effects (r about 0.99; the guide shows it).',
      'Quality control passes, including the two time-series findings: every fit uses every time point, and the time courses scatter about their lines as counting predicts.',
      'Scored again by the log ratio of the first and last samples, the scores are a little noisier and their SEs larger: the middle time points carry information.',
      'Per generation, every score and SE is the whole-course one over the 8 generations: a selection coefficient, comparable with experiments of other lengths.',
    ],
    steps: [
      ['map', 'Click a dark cell: the inspector draws its time course in each replicate, the points and the fitted line whose slope is the score.'],
      ['qc', 'In QC, read "Time points used" and "Fit of the time courses": both pass for a clean experiment.'],
      ['score', 'In Score, choose "Log ratio of the first and last samples" and score again; compare the runs\' scores and SEs in the inspector.'],
      ['score', 'Choose the Enrich2-compatible preset: its SEs are scaled by the residuals alone, and some are smaller than counting allows.'],
      ['score', 'Set "A score is the change" to per generation and score again: the times are in generations, so each score is a selection coefficient.'],
    ],
  },
  {
    id: 'simulated-sort-seq',
    title: 'A simulated sort-seq experiment (known truth)',
    summary: 'Cells displaying every variant of a 40-residue protein sorted by a fluorescent reporter into four gated bins, in three replicates, with the true shift of each variant known.',
    question: 'How do the weighted average of the bins and the maximum-likelihood fit compare, and what limits the measurement: the cells or the reads?',
    source: 'Simulated by MaveScape (web/lib/simulate.js, seed 20261013): not real data',
    license: 'Simulated: no license needed',
    citation: null,
    simulated: true,
    simulation: { seed: 20261013, sort: { cellsPerVariant: 300 }, readsPerVariant: 80, replicateNoise: 0.02 },
    // The QC findings that do not pass, by design: the lesson.
    findings: { 'excess-variance': 'review' },
    opens: 'map',
    expected: [
      'Scored by the weighted average of the bins (VAMP-seq\'s), scaled so that nonsense scores 0 and the wild type 1; the scores track the true shifts.',
      'Quality control reviews the variance beyond counting, about 2–3×: about 300 cells per variant were sorted against about 320 reads, so the cells, not the reads, limit what is known. The bins hold even shares of the cells.',
      'Scored by maximum likelihood (the design records the gates and the cells sorted into each bin), the scores follow the true shifts more closely, and their SEs account for the cells.',
    ],
    steps: [
      ['map', 'Click a dark cell: the inspector shows the variant\'s distribution over the four bins in each replicate, beside the wild type\'s.'],
      ['qc', 'In QC, read "Occupancy of the bins", "Cells sorted per variant" and "Variance beyond counting".'],
      ['experiment', 'In Experiment, see each bin\'s gates and the cells sorted into it.'],
      ['score', 'In Score, choose "Maximum likelihood" and score again; compare the runs in the inspector, and try the VAMP-seq preset.'],
    ],
  },
  {
    id: 'simulated-barcodes',
    title: 'A simulated barcoded library (known truth)',
    summary: 'Codon variants of a 30-codon gene in three independently made libraries, each variant carrying about five random barcodes, counted before and after selection, with a barcode-to-variant map that has gaps and conflicts, and a few barcodes that are off from their variant.',
    question: 'Do a variant\'s barcodes agree, which barcodes are outliers, and does scoring each barcode before combining them beat summing them?',
    source: 'Simulated by MaveScape (web/lib/simulate.js, seed 20261014): not real data',
    license: 'Simulated: no license needed',
    citation: null,
    simulated: true,
    simulation: { seed: 20261014, protein: 'MSKGEELFTGVVPILVELDGDVNGHKFSVS', replicates: 3, barcodes: { perVariant: 5, readsPerBarcode: 100, noise: 0.1, outliers: 0.03, conflicts: 0.02, unmapped: 0.02 } },
    // The QC findings that do not pass, by design: the lesson.
    findings: { 'excess-variance': 'review', 'outlier-barcodes': 'review' },
    opens: 'qc',
    expected: [
      'The map names about 96% of the barcodes: a few are missing from it, and about 2% are given two variants by it, which leaves them unmapped (the import lists them).',
      'Quality control reviews the outlier barcodes, about 2% of those compared (3% were planted 1.5–3 off their variant), and the variance between replicates beyond counting that they and the barcodes\' own noise add.',
      'Summed per variant (the default), the scores track the true effects with r about 0.985; each barcode scored and combined by REML, about 0.996; summed with the outliers left out, about 0.995.',
    ],
    steps: [
      ['qc', 'Read "Barcodes per variant", "Agreement of a variant\'s barcodes" and "Outlier barcodes", and their plots.'],
      ['map', 'Click a dark cell: the inspector lists the variant\'s barcodes in each replicate, their counts, scores and departures from the others; outliers are marked.'],
      ['score', 'In Score, choose "Score each barcode, then combine" and score again; then go back to summing, and leave the outlier barcodes out with the barcode filter. Compare the runs.'],
      ['score', 'Export the barcodes, one by one, from the run\'s menu.'],
    ],
  },
  {
    id: 'simulated-conditions',
    title: 'A simulated two-condition experiment (known truth)',
    summary: 'Every variant of a 40-residue protein selected from one input library under two conditions, without and with a ligand, in three replicates; the variants of a five-residue binding site lose fitness only with the ligand.',
    question: 'Which variants behave differently with the ligand, and how sure is each difference?',
    source: 'Simulated by MaveScape (web/lib/simulate.js, seed 20261015): not real data',
    license: 'Simulated: no license needed',
    citation: null,
    simulated: true,
    simulation: { seed: 20261015, replicates: 3, readsPerVariant: 150, inputCells: 40, replicateNoise: 0.05, conditions: { names: ['Without ligand', 'With ligand'], site: [12, 13, 14, 15, 16], shift: -1.5, siteSd: 0.4 } },
    // The QC findings that do not pass, by design: the lesson.
    findings: { 'excess-variance': 'review' },
    // The map opens on the difference between the conditions.
    map: { colorBy: 'differential' },
    opens: 'map',
    expected: [
      'The map, colored by the difference With ligand vs Without ligand, is pale everywhere but positions 12–16, where missense variants lose about 1.5 with the ligand.',
      'limma\'s moderated t (as mutscan computes it) calls the site\'s variants at q < 0.05 and nothing else; the guide counts both against the truth.',
      'Quality control reviews the variance beyond counting in each condition: about 40 cells per variant were transformed. Both conditions grew from the same cells, so the bottleneck cancels from their differences.',
      'Compared as independent (Enrich2\'s z), the same differences have SEs about 1.6× larger: the input both conditions share is counted twice.',
    ],
    steps: [
      ['map', 'The map shows the difference between the conditions. Click a cell at positions 12–16: the inspector shows the variant\'s score in each condition and the difference, with its interval and q.'],
      ['experiment', 'In Experiment, see one input per replicate, selected under both conditions, and "Without ligand" marked the reference.'],
      ['score', 'In Score, read "Between conditions": the volcano plot and the largest differences. Choose "Replicates paired by their shared input", then "As independent", and score again each time; compare the SEs in the inspector.'],
      ['score', 'Export the differential scores (CSV) and the methods from the run\'s menu.'],
    ],
  },
  {
    id: 'simulated-problems',
    title: 'A simulated experiment with problems (known truth)',
    summary: 'A simulated two-population selection of a 40-residue protein in three replicates, with two problems planted: about 50 cells per variant carried into selection (recorded with the inputs), and a third replicate whose selection was far less even than the others\'.',
    question: 'Two problems are planted here. Can you find them in the QC, and what do they do to the scores and their intervals?',
    source: 'Simulated by MaveScape (web/lib/simulate.js, seed 20261016): not real data',
    license: 'Simulated: no license needed',
    citation: null,
    simulated: true,
    simulation: { seed: 20261016, replicates: 3, readsPerVariant: 150, libraryLogSd: 0.7, inputCells: 50, replicateNoise: [0.05, 0.05, 0.8], recordCells: true },
    findings: { agreement: 'review', 'excess-variance': 'fail', 'outlier-replicate': 'review' },
    // The planted problems lower how closely the first run follows the truth.
    minimumR: 0.95,
    opens: 'qc',
    expected: [
      'QC fails the variance beyond counting, and reviews the agreement between replicates and replicate 3, an outlier.',
      'The cells recorded with the inputs account for the excess between replicates 1 and 2 (about 2.5× counting predicted, 2.2× seen); with replicate 3 the replicates differ about 12×, more than the cells explain.',
      'From all three replicates, the scores track the truth with r about 0.96, and their 95% intervals hold 99% of the true effects: too wide, since the shared error model takes replicate 3\'s noise into every variant.',
      'Without replicate 3, r about 0.98, and the intervals hold about 96%.',
      'With replicate 3, DiMSum\'s terms put the excess after selection; without it, before selection (about 3× at the inputs), where it was planted: a failing replicate distorts the fit of an error model too.',
    ],
    steps: [
      ['qc', 'Read the QC findings. Open "Variance beyond counting": the cells recorded explain replicates 1 and 2, not replicate 3.'],
      ['qc', 'Open "Outlier replicates": replicate 3 departs from the others more than they depart from each other.'],
      ['experiment', 'In Experiment, remove replicate 3 (leaving it out is a decision for the record, which the history keeps), then score again in Score.'],
      ['map', 'The guide compares each run with the truth: how close the scores are, and how often their intervals hold the true effects.'],
    ],
  },
  {
    id: 'simulated-calibration',
    title: 'A simulated calibration with circular labels (known truth)',
    summary: 'A simulated selection of a 40-residue protein in three replicates, with classifications of 100 of its missense variants, each dated as ClinVar dates them: half made before the simulated assay was published, from the truth; half made since, from the assay\'s own scores.',
    question: 'Half of the labels were made from the assay itself. Can you find them, and how far do they overstate the evidence its classes would give?',
    source: 'Simulated by MaveScape (web/lib/simulate.js, seed 20261017): not real data',
    license: 'Simulated: no license needed',
    citation: null,
    simulated: true,
    simulation: { seed: 20261017, replicates: 3, readsPerVariant: 30, libraryLogSd: 0.7, replicateNoise: 0.8, neutralSd: 0.1, lossMin: 0.4 },
    // Its classifications (lib/examples.js's simulatedLabels): 25 a side from the truth before the
    // assay's year, 25 a side from its own scores since.
    labels: { independent: 25, circular: 25, published: 2024 },
    // The assay is noisy on purpose (mild losses overlap the wild type): how closely the first run
    // follows the truth is lower.
    minimumR: 0.85,
    findings: { depth: 'review', agreement: 'review', 'excess-variance': 'review', resolution: 'review' },
    opens: 'calibrate',
    expected: [
      'The simulated assay is noisy: QC reviews the depth, the agreement between replicates, the variance beyond counting and the scores\' resolution. Of the 741 missense variants Run 1 scores, 319 lose function in truth (a true effect of −0.4 or less) and 422 do not.',
      'The labels (simulated-labels.csv) classify 100 missense variants, 50 P and 50 B, each with the date it was last evaluated. Made a control set, they draw a warning: 50 were last evaluated in or after 2024, when the assay was published, and may rest on it. Here they do: they were made from the assay\'s own scores, and 6 of them are wrong by the truth.',
      'Calibrated with every label: AUC 0.964, the abnormal-like class\'s OddsPath 20.0 (PS3, strong) and the WT-like class\'s 0.0769 (BS3_moderate). Against the truth at the same thresholds, the abnormal-like class holds 262 of the 319 variants that lose function and 31 of the 422 that do not: a likelihood ratio of 11.2, moderate.',
      'With only the classifications made before 2024 (25 a side, from the truth alone): AUC 0.933, OddsPath 10.5 (PS3_moderate) and 0.0833 (BS3_moderate). Against the truth, 13.6 and 0.0584: moderate both, as the calibration says.',
      'The labels made from the assay agree with it by construction: they add confidence, not information, and lift the abnormal-like class to a strength the truth does not hold.',
    ],
    steps: [
      ['calibrate', 'In the guide below, Make a control set of the labels: simulated-labels.csv, 100 classifications of missense variants, each dated (or download it and open it under New control set, From a table). Read what may make them circular: 50 were last evaluated since 2024, when the simulated assay was published.'],
      ['calibrate', 'Calibrate with the defaults. The guide compares the calibration with the truth: at its thresholds, the share of the variants that lose function in each class over the share of those that do not, the ratio its OddsPath estimates.'],
      ['calibrate', 'Make a control set of only those last evaluated before 2024 (the guide\'s second button, or Last evaluated before under New control set): 25 P and 25 B, made from the truth alone. Calibrate it, and compare both calibrations with the truth in the guide.'],
      ['report', 'In Report, the section Calibration, for research: what limits each calibration. The first says that 50 of its classifications may rest on the assay.'],
    ],
  },
];

export const exampleById = (id) => EXAMPLES.find((e) => e.id === id) ?? null;

// The simulated example's files: { files: [{ name, text, role }] (the counts, and a barcoded
// library's barcode-to-variant map), csv, design, truth: { key: effect }, labels (the calibration
// example's: { name, text }, simulatedLabels's) }.
export function simulatedExample(example = exampleById('simulated')) {
  const sim = simulateExperiment(example.simulation);
  // A simulated selection for function: a variant that loses it becomes rarer (wave 2, slice 8).
  const design = { ...sim.design, name: `${sim.design.name} (simulated data)`, readout: { phenotype: `Simulated ${example.simulation.sort ? 'reporter fluorescence, sorted into bins' : 'growth under a selection for function'}`, direction: 'higher-more' } };
  // The year the calibration example's assay was "published", for its dated labels.
  if (example.labels) design.source = { citation: `Simulated by MaveScape (web/lib/simulate.js, seed ${example.simulation.seed}), its assay taken to be published in ${example.labels.published}: not real data` };
  // The truth: each variant's effect (a sort-seq experiment's: its shift in log fluorescence; two
  // conditions': the difference between them).
  const truth = Object.fromEntries(sim.variants.map((v) => [v.name, v.differential ?? v.shift ?? v.effect]));
  const files = [{ name: 'simulated-counts.csv', text: sim.csv, role: 'counts' }];
  if (sim.map) files.push({ name: 'simulated-barcode-map.csv', text: sim.map, role: 'map' });
  return { files, csv: sim.csv, design, truth, truthOf: example.simulation.conditions ? 'differential' : 'effect', ...(example.labels ? { labels: simulatedLabels(sim, example) } : {}) };
}

// --- The simulated calibration (wave 8, slice 6) -----------------------------------------------------

// A variant loses function, in the simulation's truth, when its true effect is at or below
// −lossMin (the smallest loss it draws); the others are the wild type's within a few neutralSd.
export const losesFunction = (effect, simulation) => effect <= -(simulation.lossMin ?? 0.3);

const day = (random, from, to) => {
  const t = Date.UTC(...from) + Math.floor(random() * (Date.UTC(...to) - Date.UTC(...from)) / 86400000) * 86400000;
  return new Date(t).toISOString().slice(0, 10);
};

// The calibration example's classifications of its missense variants, each with the date it was
// last evaluated, as a table of labels (variant, classification, last_evaluated): { name, text,
// rows: [{ variant, classification, evaluated, from ('truth' | 'assay') }] }. example.labels:
// { independent, circular, published (a year) }. `independent` variants a side, drawn at random,
// were classified before the assay was published, from the truth alone (pathogenic or likely
// pathogenic when they lose function, benign or likely benign when not). `circular` a side were
// classified since, from the assay's own scores, as a laboratory using it as functional evidence
// would: likely pathogenic where the variant's log ratio to the wild type, averaged over the
// replicates, is clearly low (below −0.6), likely benign where it is near the wild type's (within
// 0.2), whatever its truth. Seeded by the simulation's seed.
export function simulatedLabels(sim, example) {
  const { independent, circular, published } = example.labels;
  const random = createRandom(example.simulation.seed + 7);
  const shuffled = (list) => {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  // Each variant's log ratio to the wild type, averaged over the replicates (pseudocount 0.5): the
  // assay's scores as a laboratory reads them.
  const table = parseTable(sim.csv, { fileName: 'simulated-counts.csv' });
  const column = (name) => table.columns.find((c) => c.name === name).numeric;
  const reps = sim.design.replicates.map((r) => ({ input: column(r.input), output: column(r.output) }));
  const wt = sim.variants.findIndex((v) => v.kind === 'wild type');
  const logRatio = (i) => reps.reduce((sum, r) => sum + log((r.output[i] + 0.5) / (r.input[i] + 0.5)) - log((r.output[wt] + 0.5) / (r.input[wt] + 0.5)), 0) / reps.length;
  const missense = sim.variants.map((v, i) => ({ ...v, measured: logRatio(i) })).filter((v) => v.kind === 'missense');
  const loss = shuffled(missense.filter((v) => losesFunction(v.effect, example.simulation)));
  const kept = shuffled(missense.filter((v) => !losesFunction(v.effect, example.simulation)));
  const before = [published - 12, 0, 1];
  const end = [published - 1, 11, 31];
  const rows = [];
  for (const v of loss.slice(0, independent)) rows.push({ variant: v.name, classification: random() < 0.5 ? 'Pathogenic' : 'Likely pathogenic', evaluated: day(random, before, end), from: 'truth' });
  for (const v of kept.slice(0, independent)) rows.push({ variant: v.name, classification: random() < 0.5 ? 'Benign' : 'Likely benign', evaluated: day(random, before, end), from: 'truth' });
  const used = new Set(rows.map((r) => r.variant));
  const rest = shuffled(missense.filter((v) => !used.has(v.name)));
  const since = [published, 1, 1];
  const last = [published + 2, 8, 30];
  for (const v of rest.filter((x) => x.measured < -0.6).slice(0, circular)) rows.push({ variant: v.name, classification: 'Likely pathogenic', evaluated: day(random, since, last), from: 'assay' });
  for (const v of rest.filter((x) => Math.abs(x.measured) < 0.2).slice(0, circular)) rows.push({ variant: v.name, classification: 'Likely benign', evaluated: day(random, since, last), from: 'assay' });
  // In the order of the protein, as a table of labels usually is.
  const order = new Map(sim.variants.map((v, i) => [v.name, i]));
  rows.sort((a, b) => order.get(a.variant) - order.get(b.variant));
  const text = `variant,classification,last_evaluated\n${rows.map((r) => `${r.variant},${r.classification},${r.evaluated}`).join('\n')}\n`;
  return { name: 'simulated-labels.csv', text, rows };
}

// A calibration against the simulated truth: its thresholds applied to every missense variant the
// run scores (view: its protein view), each known to lose function or not. Returns { loss:
// { n, 'abnormal-like', intermediate, 'WT-like' }, kept: { … }, ratio: { abnormal, normal } }, a
// class's ratio its share of the variants that lose function over its share of those that do not
// (the likelihood ratio its OddsPath estimates; null where a share is 0), and the sensitivity and
// specificity on every variant.
export function calibrationTruth(view, cal, truth, simulation) {
  const score = view.conditions[cal.condition ?? 0]?.score;
  const tally = () => ({ n: 0, 'abnormal-like': 0, intermediate: 0, 'WT-like': 0 });
  const out = { loss: tally(), kept: tally() };
  for (let i = 0; i < view.rows; i += 1) {
    const key = view.variants.key[i];
    if (view.variants.kind[i] !== KIND.MISSENSE || !Number.isFinite(score?.[i]) || !(key in truth)) continue;
    const t = out[losesFunction(truth[key], simulation) ? 'loss' : 'kept'];
    t.n += 1;
    t[classOf(score[i], cal.side, cal.thresholds)] += 1;
  }
  const ratio = (cls) => {
    const a = out.loss[cls] / out.loss.n;
    const b = out.kept[cls] / out.kept.n;
    return a > 0 && b > 0 ? a / b : null;
  };
  return { ...out, ratio: { abnormal: ratio('abnormal-like'), normal: ratio('WT-like') }, sensitivity: out.loss['abnormal-like'] / out.loss.n, specificity: out.kept['WT-like'] / out.kept.n };
}
