// Bundled examples (requirement T4): each with its question, source and license, citation, what
// to expect (the QC findings it teaches, `findings`, and the gaps its guide points to, `teaches`),
// the view it opens in and a guided workflow of a few minutes. A published example's table can be
// assembled as at import (`assembly`: Hsp90's codon variants read at the protein level), and its
// first run can set parameters beyond MaveScape's defaults (`parameters`). Simulated data are
// labeled simulated everywhere they appear. The published example's files are in web/examples/;
// the simulated one is made from its seed (lib/simulate.js), with its true effects.

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
    ],
    steps: [
      ['qc', 'Read the QC findings. Open "Variance beyond counting" and its plot: replicate differences sit above the dashed line of counting noise, in parallel, as a bottleneck does. DiMSum\'s terms below it show where: the inputs.'],
      ['score', 'In Score, the run with MaveScape\'s defaults is ready. Run it again with the DiMSum-compatible preset: its error model carries the bottleneck into every SE. Compare the runs\' tables of replicates.'],
      ['map', 'Open the map. The darkest columns are the positions that tolerate nothing; hover one, then click a cell to see its replicates in the inspector.'],
      ['map', 'Shift-drag over a stretch of positions, save the selection, and export the map as SVG.'],
      ['score', 'Export the scores (MaveDB columns) and the methods paragraph from the run\'s menu.'],
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
    ],
    steps: [
      ['map', 'Look at the map: nine positions by every substitution. Click a dark cell at position 585: the inspector draws its time course over the eight samples.'],
      ['qc', 'In QC, open "Fit of the time courses": the departures from a line are large, most of all for stops, which fall to the floor and stay.'],
      ['score', 'In Score, set "A score is the change" to over the whole time course and score again: every score is 21 times the one per generation.'],
      ['experiment', 'In Experiment, read "What the analysis can do": with one replicate nothing between replicates is assessed, and a second replicate would add it.'],
      ['score', 'Export the scores and the methods from the run\'s menu: the methods say the scores are per generation, and what was not recorded.'],
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
    ],
    steps: [
      ['map', 'Look at the map: the protease domain and the second EGF domain hold most of the positions that tolerate nothing, the propeptide and the Gla domain almost none. Click a cell: the inspector shows its distribution over the four bins in each replicate.'],
      ['qc', 'In QC, open "Variance beyond counting": the replicates of each tile differ about 2,300× more than counting predicts, because the cells sorted, not the reads, limit what is known.'],
      ['experiment', 'In Experiment, read "What the analysis can do": the gates and the cells sorted into each bin are missing, and would unlock maximum likelihood and the cells per bin.'],
      ['score', 'In Score, set the bins\' scale to the lowest 5% and the replicates combined by their mean, and score again: MultiSTEP\'s own settings, close to the published scores.'],
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
