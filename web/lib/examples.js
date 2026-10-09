// Bundled examples (requirement T4): each with its question, source and license, citation, what
// to expect, the view it opens in and a guided workflow of a few minutes. Simulated data are
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
    opens: 'qc',
    expected: [
      'Quality control: everything passes except the variance beyond counting, about 11× (a bottleneck: the Domainome\'s own error model found one at the input).',
      'Nonsense variants score about −4.6 against the wild type\'s 0: the assay separates loss of function cleanly.',
      'The least tolerant positions are buried hydrophobic and glycine residues of the fold (A163, G196, G203, I183 on GRB2\'s numbering).',
    ],
    steps: [
      ['qc', 'Read the QC findings. Open "Variance beyond counting" and its plot: replicate differences sit above the dashed line of counting noise, in parallel, as a bottleneck does.'],
      ['score', 'In Score, the run with MaveScape\'s defaults is ready. Run it again with the Enrich2-compatible preset and compare the runs.'],
      ['map', 'Open the map. The darkest columns are the positions that tolerate nothing; hover one, then click a cell to see its replicates in the inspector.'],
      ['map', 'Shift-drag over a stretch of positions, save the selection, and export the map as SVG.'],
      ['score', 'Export the scores (MaveDB columns) and the methods paragraph from the run\'s menu.'],
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
      'Scores track the true effects closely (the guide shows the correlation once the run is scored).',
      'The least certain scores are the variants with the fewest reads before selection: their SEs are largest.',
      'Quality control passes: the counts vary as counting predicts.',
    ],
    steps: [
      ['map', 'Look at the map: nonsense (the * row) is uniformly low, synonymous cells (outlined) are white, missense varies by position.'],
      ['qc', 'Read the QC: a clean experiment passes everything. Change the "Variance beyond counting" threshold and see the finding react.'],
      ['score', 'In Score, rerun with fixed effects instead of REML: with replicates that agree, the scores barely move.'],
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
    ],
    steps: [
      ['map', 'Click a dark cell: the inspector draws its time course in each replicate, the points and the fitted line whose slope is the score.'],
      ['qc', 'In QC, read "Time points used" and "Fit of the time courses": both pass for a clean experiment.'],
      ['score', 'In Score, choose "Log ratio of the first and last samples" and score again; compare the runs\' scores and SEs in the inspector.'],
      ['score', 'Choose the Enrich2-compatible preset: its SEs are scaled by the residuals alone, and some are smaller than counting allows.'],
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
];

export const exampleById = (id) => EXAMPLES.find((e) => e.id === id) ?? null;

// The simulated example's files: { files: [{ name, text, role }] (the counts, and a barcoded
// library's barcode-to-variant map), csv, design, truth: { key: effect } }.
export function simulatedExample(example = exampleById('simulated')) {
  const sim = simulateExperiment(example.simulation);
  const design = { ...sim.design, name: `${sim.design.name} (simulated data)` };
  // The truth: each variant's effect (a sort-seq experiment's: its shift in log fluorescence).
  const truth = Object.fromEntries(sim.variants.map((v) => [v.name, v.shift ?? v.effect]));
  const files = [{ name: 'simulated-counts.csv', text: sim.csv, role: 'counts' }];
  if (sim.map) files.push({ name: 'simulated-barcode-map.csv', text: sim.map, role: 'map' });
  return { files, csv: sim.csv, design, truth };
}
