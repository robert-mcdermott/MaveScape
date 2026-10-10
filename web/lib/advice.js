// Findings in context (wave 2, slice 8; requirement Q11): for a finding that is not a pass, the
// causes that fit it and what to do next. A "fail" can be a failed experiment, an analysis that
// does not suit the data, or what the library or the assay makes expected, and the next step
// differs: look at a plot, change an analysis choice, or settle it only with another experiment.
// The causes are read with the finding's context (qc.context: the readout, how the library was
// made, tiles, barcodes, whether cells were recorded), never guessed beyond it.
//
//   causes: [{ kind: 'technical' | 'model' | 'expected', text }]
//   next:   [{ kind: 'inspect' | 'analysis' | 'experiment', text }]

import { inText, SINGLE_NUCLEOTIDE_LIBRARIES } from './readout.js';

// Their names, short, for a badge beside each.
export const CAUSE_KINDS = {
  technical: 'experiment',
  model: 'analysis',
  expected: 'expected',
};
export const NEXT_KINDS = {
  inspect: 'look',
  analysis: 'analysis',
  experiment: 'experiment',
};

const technical = (text) => ({ kind: 'technical', text });
const model = (text) => ({ kind: 'model', text });
const expected = (text) => ({ kind: 'expected', text });
const inspect = (text) => ({ kind: 'inspect', text });
const analysis = (text) => ({ kind: 'analysis', text });
const experiment = (text) => ({ kind: 'experiment', text });

// Per finding id: (finding, qc, ctx) → { causes, next } for a review or fail.
const ADVICE = {
  'missing-sample': () => ({
    causes: [technical('A missing file, a misnamed column, or a library that failed to sequence.')],
    next: [inspect('The sample\'s column in the table (the inspector lists each column\'s values).'), analysis('Map the right column to the sample in Experiment, or remove the replicate that uses it.'), experiment('Sequence the library again if it failed.')],
  }),
  depth: () => ({
    causes: [technical('Too few reads for the variants in the sample: the sequencer under-loaded, or reads lost in demultiplexing or filtering upstream.')],
    next: [inspect('Sequencing depth: reads per variant, by sample.'), analysis('The count minimums (Score, Filters) leave out variants with too few reads; their SEs already carry the sampling error.'), experiment('Sequence the sample deeper, to at least the review level per variant.')],
  }),
  'low-count': (f, qc, ctx) => ({
    causes: [
      ...(SINGLE_NUCLEOTIDE_LIBRARIES.has(ctx.libraryMethod) ? [expected(`A library made by ${inText(ctx.libraryMethod)} has a long tail of rare variants.`)] : []),
      technical('An uneven library (skewed in cloning or PCR), or an input sequenced too shallowly.'),
    ],
    next: [inspect('The count distribution and rank-abundance of the inputs.'), analysis('Raise the input-count minimum (Score, Filters) so that scores rest on more molecules; compare the runs.'), experiment('Sequence the input deeper, or build a more even library.')],
  }),
  missingness: () => ({
    causes: [technical('The counting pipeline filtered or truncated this sample, or its file lists fewer variants than the others.'), technical('Variants that dropped out during selection written as missing rather than 0.')],
    next: [inspect('Missing counts by sample, and their patterns.'), analysis('Check the sample\'s column in Experiment; if dropouts are written as missing, read missing as 0 in the samples after selection ("Missing = 0").'), experiment('Count the sample again with the same pipeline as the others.')],
  }),
  dropout: () => ({
    causes: [technical('The table writes a variant that was not seen after selection as missing, not 0: a convention of the counting pipeline, not the experiment.')],
    next: [inspect('Missing after selection: the missing variants\' counts before they went missing.'), analysis('In Experiment, read missing as 0 ("Missing = 0") in the samples after selection, then score again.')],
  }),
  coverage: (f, qc, ctx) => {
    const cov = qc.coverage ?? {};
    const single = SINGLE_NUCLEOTIDE_LIBRARIES.has(ctx.libraryMethod);
    return {
      causes: [
        ...(single ? [expected(cov.reach?.known ? `${ctx.libraryMethod} reaches mostly the substitutions one base change makes; coverage is judged against those.` : `${ctx.libraryMethod} reaches mostly the substitutions one base change makes (about a third of all); with a DNA target MaveScape would judge coverage against those.`)] : []),
        ...(ctx.tiles ? [expected('Tiles cover parts of the target by design; positions in no tile are not counted as designed.')] : []),
        technical('Variants lost in cloning or transformation (a bottleneck before selection), or an input sequenced too shallowly to see them.'),
      ],
      next: [
        inspect('The coverage grid: which positions and substitutions are missing.'),
        ...(!ctx.libraryMethod ? [analysis('Say how the library was made (Experiment, Library): a library of single-base changes is judged against what it can make.')] : []),
        experiment('Add the missing substitutions to the library, or sequence the input deeper.'),
      ],
    };
  },
  agreement: () => ({
    causes: [technical('Too few cells per variant at some step (a bottleneck): replicates then disagree by chance.'), technical('A sample swap or a mislabeled column.'), expected('Most variants with effects near the wild type\'s: a narrow range of true effects lowers the correlation of good replicates too.')],
    next: [inspect('The replicates\' log ratios against each other.'), analysis('Check which column is which replicate in Experiment. The moderated combination (the default) or DiMSum\'s error model carry the disagreement into the SEs.'), experiment('Carry more cells per variant through each step, or add a replicate.')],
  }),
  'excess-variance': (f) => {
    // The cells recorded (wave 2, slice 10): whether they account for the excess.
    const explained = f.cells?.length && f.cells.every((c) => c.verdict === 'explained');
    return {
      causes: [
        ...(explained ? [expected('The bottleneck the recorded cells predict: they account for the excess.')] : []),
        technical('Too few cells carried through a step (transformation, selection, recovery) when the variance grows with the counting variance (a multiplicative term).'),
        technical('Noise between replicates (selection of different strength) when the excess is the same at every depth (an additive term).'),
      ],
      next: [
        inspect('The variance plot: observed against counting, by depth.'),
        analysis('Score with the moderated combination (the default) or DiMSum\'s error model (Score, preset), so that the SEs carry the excess.'),
        f.cells?.length ? inspect('The cells recorded against the excess (above): where they fall short of it, look for the step that had fewer cells.') : analysis('Record the cells carried into selection with each input sample (Experiment, Columns, Cells): QC then checks the bottleneck it infers against them. N cells per variant against D reads raise the ratio to about 1 + D/(2N).'),
        experiment('Carry more cells than reads per variant through every step.'),
      ],
    };
  },
  'outlier-replicate': () => ({
    causes: [technical('A replicate that failed, was mislabeled or contaminated, or was selected with a different strength.')],
    next: [inspect('Leave-one-out: each replicate against the others, and its samples\' depth.'), analysis('Score without it (remove the replicate in Experiment) and compare the runs; leaving it out is a decision for the record, not a default.'), experiment('Repeat the replicate.')],
  }),
  separation: (f, qc, ctx) => {
    const seps = (qc.scores ?? []).map((c) => c.separation).filter(Boolean);
    const reversed = seps.some((s) => s.reversed);
    const change = seps.map((s) => s.change).find(Boolean);
    const limited = ctx.controls.positions?.nonsense?.end;
    const causes = [];
    const next = [inspect('The control distributions: synonymous, nonsense and missense scores.')];
    if (reversed && !ctx.readout.stated) {
      causes.push(model('The readout\'s direction is not stated, and the nonsense variants score on the other side: in this assay a higher score may mean less of the function.'));
      next.push(analysis('State the readout\'s direction in Experiment.'));
    }
    if (change && !(limited <= change.lastControl)) {
      causes.push(expected(`Stops after position ${change.lastControl} score like the reference: truncations there may keep the function this assay measures, so they are not loss-of-function controls.`));
      next.push(analysis(`Limit the nonsense controls to positions up to ${change.lastControl} (Experiment, Controls), if the construct supports it.`));
    }
    if (ctx.readout.mechanism && /gain/i.test(ctx.readout.mechanism) && !/loss/i.test(ctx.readout.mechanism)) causes.push(expected('An assay built to detect gain of function need not separate loss-of-function controls from the wild type.'));
    causes.push(expected('Nonsense variants are loss-of-function controls only where a stop loses the function assayed; a construct, a reporter fusion or a read-through can keep it.'));
    causes.push(technical('A selection too weak to deplete loss-of-function variants, or a bottleneck that blurs every score.'));
    next.push(experiment('A stronger selection, or controls known to lose the function in this assay.'));
    return { causes, next };
  },
  resolution: () => ({
    causes: [technical('Large SEs (shallow counts, few replicates, a bottleneck) or a small gap between the controls (a weak selection).'), expected('An assay with a narrow dynamic range.')],
    next: [inspect('Each variant\'s score against its SE.'), analysis('Combine more replicates; a filter on SE leaves out the least certain scores (Score, Filters).'), experiment('Deeper sequencing, more replicates, or a stronger selection.')],
  }),
  'scored-fraction': () => ({
    causes: [model('Filters stricter than this experiment\'s depth supports.'), technical('Many variants with too few reads to score.')],
    next: [inspect('The filter flow: which stage left them out.'), analysis('Loosen the count minimums (Score, Filters) and compare the runs; scores on fewer reads carry larger SEs.')],
  }),
  'time-points': () => ({
    causes: [technical('Variants that dropped out and were written as missing at the later time points.')],
    next: [inspect('The time points each fit used.'), analysis('Read missing as 0 in the later samples ("Missing = 0", Experiment) if the table writes dropouts as missing.')],
  }),
  'time-fit': () => ({
    causes: [technical('Bottlenecks at each passage, or growth that is not exponential (saturation, a lag) add noise between time points.'), model('A straight line in log frequency does not fit a selection whose strength changes over time.'), expected('A few variants rise, then fall, for real.')],
    next: [inspect('The time courses of the variants furthest from a line.'), analysis('The residual-scaled SEs (the default) carry the departure; compare with the log ratio of the first and last samples.'), experiment('More cells at each passage, and passages in exponential growth.')],
  }),
  'bin-occupancy': () => ({
    causes: [technical('A gate that caught few cells, or a bin sequenced too shallowly.'), expected('A reporter whose distribution leaves an outer bin nearly empty.')],
    next: [inspect('Each bin\'s share of the cells (or reads).'), analysis('With the gates recorded, the maximum-likelihood fit uses uneven bins better than the weighted average (Score).'), experiment('Gates set to hold similar numbers of cells.')],
  }),
  'cells-per-bin': () => ({
    causes: [technical('Too few cells sorted for the variants in the library.')],
    next: [inspect('Cells sorted per variant in each bin.'), experiment('Sort more cells: tens per variant in each bin.')],
  }),
  'barcode-map': () => ({
    causes: [technical('A barcode-to-variant map from another library, or barcodes written differently (strand, length).')],
    next: [inspect('Barcodes per variant, and the barcodes the map does not name.'), analysis('Check the barcode column and the map\'s barcodes (Experiment, Rows).'), experiment('Sequence the library again to link more barcodes to their variants.')],
  }),
  'barcodes-per-variant': () => ({
    causes: [expected('A library designed with few barcodes per variant.'), technical('A bottleneck in cloning that lost barcodes.')],
    next: [inspect('Barcodes per variant.'), analysis('Scoring each barcode, then combining, needs two or more per variant; summing works with one.'), experiment('More barcodes per variant.')],
  }),
  'barcode-agreement': () => ({
    causes: [technical('Few cells per barcode (a bottleneck), or clones that differ (a second mutation).')],
    next: [inspect('Each barcode against its variant\'s others.'), analysis('Score each barcode and combine by REML (Score), so that the extra variation enters a variant\'s SE.')],
  }),
  'outlier-barcodes': () => ({
    causes: [technical('Barcodes carrying a second mutation, or linked to the wrong variant.')],
    next: [inspect('The outlier barcodes, and whether they share a library or low counts.'), analysis('Leave them out with the barcode filter (Score, Filters) and compare the runs.')],
  }),
};

// What is needed to assess a finding that is not assessed: next steps only.
const ASSESS = {
  'cells-per-bin': [analysis('Record the cells sorted into each bin with its sample (Experiment).')],
  separation: [analysis('Name the controls (Experiment, Controls): synonymous variants or the wild type, and nonsense variants.')],
  coverage: [analysis('Give a single target, with variants named at the protein level.')],
  'outlier-replicate': [experiment('Three or more replicates.')],
  agreement: [experiment('Two or more replicates measuring the same variants.')],
};

// The advice for a finding: { causes, next } (empty for a pass).
export function adviceFor(finding, qc) {
  const ctx = qc.context ?? { readout: { stated: false }, controls: {}, libraryMethod: null, tiles: 0 };
  if (finding.status === 'pass') return { causes: [], next: [] };
  if (finding.status === 'na') {
    // A finding that reads a score run, of the counts alone.
    if (finding.level === 'scores' && /no score run/.test(finding.value ?? '')) return { causes: [], next: [analysis('Score the counts (Score): this finding reads a score run.')] };
    return { causes: [], next: ASSESS[finding.id] ?? [] };
  }
  const make = ADVICE[finding.id];
  return make ? make(finding, qc, ctx) : { causes: [], next: [] };
}
