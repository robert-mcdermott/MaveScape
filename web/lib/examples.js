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
    ],
    steps: [
      ['qc', 'Read the QC findings. Open "Variance beyond counting" and its plot: replicate differences sit above the dashed line of counting noise, in parallel, as a bottleneck does. DiMSum\'s terms below it show where: the inputs.'],
      ['score', 'In Score, the run with MaveScape\'s defaults is ready. Run it again with the DiMSum-compatible preset: its error model carries the bottleneck into every SE. Compare the runs\' tables of replicates.'],
      ['map', 'Open the map. The darkest columns are the positions that tolerate nothing; click a cell to see its replicates in the inspector. Below it, Tracks, "Add a track": UniProt\'s features, conservation (PDBe-KB) and AlphaMissense line up with the positions, asked for by GRB2\'s accession only. Shift-drag over a stretch, save the selection, and export the map with its tracks as SVG.'],
      ['experiment', 'In Experiment, Target, "Check against UniProt" fetches GRB2\'s entry (P62993) through the MaveScape program and finds the SH3 domain at positions 159–214, identical: the design\'s offset is the entry\'s. "Record the check" keeps the release and the date with the workspace, and the methods cite them. Only the accession is sent.'],
      ['score', 'From the run\'s Export menu, "Deposit in MaveDB" writes the run as MaveDB takes a score set: the scores and counts, what each column is, and the experiment and score set, the methods as the analysis and the readout as the MAVE minimum information\'s keywords. It names what MaveDB still requires (an abstract): give it there, and download the package.'],
      ['experiment', 'In Experiment, read "What the analysis can do": the published counts do not say how the library was made or how many cells were carried into selection. With the cells recorded, QC would check the bottleneck it finds against them.'],
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
    ],
    steps: [
      ['map', 'Look at the map: nine positions by every substitution. Click a dark cell at position 585: the inspector draws its time course over the eight samples.'],
      ['qc', 'In QC, open "Fit of the time courses": the departures from a line are large, most of all for stops, which fall to the floor and stay.'],
      ['score', 'In Score, set "A score is the change" to over the whole time course and score again: every score is 21 times the one per generation.'],
      ['experiment', 'In Experiment, read "What the analysis can do": with one replicate nothing between replicates is assessed, and a second replicate would add it.'],
      ['score', 'Export the scores and the methods from the run\'s menu: the methods say the scores are per generation, and what was not recorded.'],
      ['compare', 'In Compare, Other sources: add urn:mavedb:00000011-a-1, the record\'s own published scores (a higher score is more growth), kept beside without opening it. They correlate at r 0.95, but under Scale, stated to be on one scale, Lin\'s concordance is only 0.48: the Bland–Altman plot shows the difference growing with the effect, most at 585–587. The authors fit null-like variants on their first three time points, before they reach the floor; Run 1 fits all eight. How deleterious those variants are depends on that choice.'],
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
    ],
    steps: [
      ['map', 'The map shows PTEN\'s abundance as MaveDB publishes it, the wild type at 1 and nonsense near 0, in the run "Published scores". Click a cell: its score, SE and 95% interval are the record\'s own.'],
      ['experiment', 'Select the table in the sidebar: the inspector shows the MaveDB record, its license and citation, and the assay in MaveDB\'s terms (a reporter, loss of function, human cells), which became the design\'s readout; the record does not say what a higher score means, so the example states it, from the paper. Below it, its six calibrations: the investigators\' classes, and ExCALIBR\'s evidence strengths for research use only, shown as published (MaveScape classifies no variant).'],
      ['qc', 'In QC, what scores alone show: the controls separate (AUC 0.98) and the scores resolve them; coverage is 53% of all substitutions. The findings about counts are not assessed.'],
      ['experiment', 'In Experiment, read "What the analysis can do": the map and comparison need only the scores; rescoring and QC of the counts need the counts, and the readiness says where they may be (the paper\'s supplement, the authors\' repository, the raw reads PRJNA428380).'],
      ['score', 'In Score, set a maximum SE of 0.15 and read the scores again: the second run leaves the uncertain variants out, each with the stage that left it out.'],
      ['compare', 'In Compare, under Other sources, add urn:mavedb:00000054-a-1, PTEN\'s lipid phosphatase activity, saying that a higher score means more of the function: it is kept beside the workspace, not opened, and compared with the abundance as another assay of PTEN. Then add AlphaMissense and choose it as the second side: by rank, and in Classes, how well the abundance tells its likely benign substitutions from its likely pathogenic ones.'],
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
    ],
    steps: [
      ['map', 'The map shows Run 1, the counts scored with MaveScape\'s defaults: the RING\'s eight zinc ligands (C24, C27, C39, H41, C44, C47, C61, C64 on BRCA1\'s numbering) are among its twelve least tolerant positions. Click a cell: its six replicate scores, and the published score in the run "Published scores".'],
      ['experiment', 'In Experiment, the design: two library preparations, three replicates each, rounds 0 to 5, the inputs shared; the yeast two-hybrid columns, BARD1 binding, set aside with the reason.'],
      ['score', 'In Score, choose the Enrich2-compatible preset and score again: the combined scores now equal the published ones, made by Enrich2 in 2017.'],
      ['score', 'From Run 1\'s Export menu, "Deposit in MaveDB": the scores, counts and methods as MaveDB takes a score set, the experiment described as the record\'s (give its URN, urn:mavedb:00000003-a, to add the score set to it). Download the package as a ZIP.'],
      ['experiment', 'Drop the ZIP on the window: it opens as a record from MaveDB does, and its scores, read as published, are Run 1\'s exactly.'],
      ['qc', 'In QC, the dropout and the fit of the time courses: over five rounds most variants that lose activity fall below detection, as stops do.'],
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
];

export const exampleById = (id) => EXAMPLES.find((e) => e.id === id) ?? null;

// The simulated example's files: { files: [{ name, text, role }] (the counts, and a barcoded
// library's barcode-to-variant map), csv, design, truth: { key: effect } }.
export function simulatedExample(example = exampleById('simulated')) {
  const sim = simulateExperiment(example.simulation);
  // A simulated selection for function: a variant that loses it becomes rarer (wave 2, slice 8).
  const design = { ...sim.design, name: `${sim.design.name} (simulated data)`, readout: { phenotype: `Simulated ${example.simulation.sort ? 'reporter fluorescence, sorted into bins' : 'growth under a selection for function'}`, direction: 'higher-more' } };
  // The truth: each variant's effect (a sort-seq experiment's: its shift in log fluorescence; two
  // conditions': the difference between them).
  const truth = Object.fromEntries(sim.variants.map((v) => [v.name, v.differential ?? v.shift ?? v.effect]));
  const files = [{ name: 'simulated-counts.csv', text: sim.csv, role: 'counts' }];
  if (sim.map) files.push({ name: 'simulated-barcode-map.csv', text: sim.map, role: 'map' });
  return { files, csv: sim.csv, design, truth, truthOf: example.simulation.conditions ? 'differential' : 'effect' };
}
