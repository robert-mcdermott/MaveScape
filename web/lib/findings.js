// QC findings (requirement Q9): the metrics of qc.js read against thresholds, each finding with
// its status (pass, review, fail; 'na' when it cannot be assessed, with why), what it found in
// numbers, the threshold, the rationale, the samples or replicates it concerns, the plot behind
// it, and whether it blocks the analysis or advises. Thresholds are parameters, kept in the
// workspace and its history; the overall status is the worst finding, shown beside the list.
//
// Wave 2, slice 8 (Q11): each finding that is not a pass also says which causes fit it and what to
// do next (advice.js), and can be acknowledged with a reason (ws.qc.acknowledged: { id: { reason,
// status, value, time } }): its status does not change, the reason goes on the record, and an
// acknowledgement holds while the finding is no worse than it was when acknowledged.

import { DEFAULT_MEASURES } from './qc.js';
import { adviceFor } from './advice.js';
import { inText } from './readout.js';

const pct = (x) => `${(100 * x).toFixed(x < 0.1 ? 1 : 0)}%`;
const num = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '—');

// Each threshold: review and fail levels, which way is bad, and why. `measure`: a parameter of the
// measurement itself (qc.js), not of the verdict.
export const THRESHOLDS = [
  { key: 'readsPerVariant', label: 'Reads per variant, per sample', bad: 'below', review: 30, fail: 10, unit: 'reads' },
  { key: 'lowCount', label: 'A low count is below', measure: true, value: DEFAULT_MEASURES.lowCount, unit: 'reads' },
  { key: 'lowFraction', label: 'Input variants with a low count', bad: 'above', review: 0.2, fail: 0.5, unit: 'fraction' },
  { key: 'missingExcess', label: 'Missing counts beyond the other samples', bad: 'above', review: 0.2, fail: 0.5, unit: 'fraction' },
  { key: 'coverage', label: 'Designed substitutions observed', bad: 'below', review: 0.9, fail: 0.5, unit: 'fraction' },
  { key: 'agreementInput', label: 'Replicates compared on variants with input reads of at least', measure: true, value: DEFAULT_MEASURES.agreementInput, unit: 'reads' },
  { key: 'agreement', label: 'Replicate agreement (Pearson r)', bad: 'below', review: 0.8, fail: 0.5, unit: 'r' },
  { key: 'excessVariance', label: 'Variance of replicate differences ÷ counting variance', bad: 'above', review: 2, fail: 5, unit: '×' },
  { key: 'outlierReplicate', label: 'A replicate\'s leave-one-out variance ÷ the others\'', bad: 'above', review: 2, fail: 4, unit: '×' },
  { key: 'separation', label: 'Separation of controls (AUC)', bad: 'below', review: 0.9, fail: 0.75, unit: 'AUC' },
  { key: 'resolution', label: 'Median SE ÷ the controls\' gap', bad: 'above', review: 0.25, fail: 0.5, unit: '×' },
  { key: 'scoredFraction', label: 'Measured variants scored', bad: 'below', review: 0.8, fail: 0.5, unit: 'fraction' },
  { key: 'fewerPoints', label: 'Time-series fits on fewer time points than the replicate has', bad: 'above', review: 0.1, fail: 0.3, unit: 'fraction' },
  { key: 'timeFit', label: 'Departure of time courses from a line ÷ counting noise (median)', bad: 'above', review: 2, fail: 5, unit: '×' },
  { key: 'binShare', label: 'A bin\'s share of a replicate\'s cells (or reads)', bad: 'below', review: 0.05, fail: 0.01, unit: 'fraction' },
  { key: 'cellsPerVariant', label: 'Cells sorted per variant into a bin', bad: 'below', review: 20, fail: 5, unit: 'cells' },
  { key: 'unmappedReads', label: 'Reads of barcodes the map does not name', bad: 'above', review: 0.05, fail: 0.2, unit: 'fraction' },
  { key: 'singleBarcode', label: 'Variants with a single barcode', bad: 'above', review: 0.5, fail: 0.95, unit: 'fraction' },
  { key: 'barcodeExcess', label: 'Disagreement of a variant\'s barcodes ÷ counting (φ)', bad: 'above', review: 2, fail: 5, unit: '×' },
  { key: 'splitHalf', label: 'Agreement of each variant\'s two halves of barcodes (Pearson r)', bad: 'below', review: 0.8, fail: 0.5, unit: 'r' },
  { key: 'outlierBarcodes', label: 'Outlier barcodes (beyond 4 in z/√φ)', bad: 'above', review: 0.01, fail: 0.05, unit: 'fraction' },
];

export function defaultThresholds() {
  const out = {};
  for (const t of THRESHOLDS) out[t.key] = t.measure ? t.value : { review: t.review, fail: t.fail };
  return out;
}

export function withDefaultThresholds(thresholds) {
  const d = defaultThresholds();
  const out = { ...d };
  for (const [k, v] of Object.entries(thresholds ?? {})) if (k in d) out[k] = typeof d[k] === 'object' ? { ...d[k], ...v } : v;
  return out;
}

// The measures qc.js needs from thresholds.
export const measuresOf = (thresholds) => {
  const t = withDefaultThresholds(thresholds);
  return { lowCount: t.lowCount, agreementInput: t.agreementInput };
};

// Checks thresholds: problems as messages.
export function checkThresholds(thresholds) {
  const t = withDefaultThresholds(thresholds);
  const problems = [];
  for (const d of THRESHOLDS) {
    const v = t[d.key];
    if (d.measure) {
      if (!(Number.isFinite(v) && v >= 0)) problems.push(`${d.label}: a number of 0 or more.`);
      continue;
    }
    if (!Number.isFinite(v.review) || !Number.isFinite(v.fail)) problems.push(`${d.label}: give numbers.`);
    else if (d.bad === 'above' ? v.fail < v.review : v.fail > v.review) problems.push(`${d.label}: the fail level must be ${d.bad === 'above' ? 'above' : 'below'} the review level.`);
  }
  return problems;
}

const levels = (t, key) => t[key];
// Status of a value: lower is worse ('below') or higher is worse ('above').
function statusOf(value, { review, fail }, bad) {
  if (!Number.isFinite(value)) return 'na';
  if (bad === 'above') return value > fail ? 'fail' : value > review ? 'review' : 'pass';
  return value < fail ? 'fail' : value < review ? 'review' : 'pass';
}
const RANK = { na: 0, pass: 1, review: 2, fail: 3 };
const worst = (list) => list.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), 'pass');
const thresholdText = ({ review, fail }, bad, fmt = num) => (bad === 'above' ? `review above ${fmt(review)}, fail above ${fmt(fail)}` : `review below ${fmt(review)}, fail below ${fmt(fail)}`);

// The findings of a QC result. qc: computeQC's output; thresholds: as defaultThresholds();
// options: { acknowledged } (the workspace's acknowledgements, by finding id).
export function findingsFrom(qc, thresholds, options = {}) {
  const t = withDefaultThresholds(thresholds);
  const out = [];
  const ctx = qc.context ?? null;
  const add = (f) => out.push({ blocking: false, affected: { samples: [], replicates: [] }, level: 'counts', ...f });

  // Every sample has counts.
  const empty = qc.samples.filter((s) => s.counted === 0 || s.total === 0);
  add({
    id: 'missing-sample', title: 'Every sample has counts', plot: 'missingness',
    status: empty.length ? 'fail' : 'pass', blocking: empty.length > 0,
    value: empty.length ? `${empty.length} without counts: ${empty.map((s) => s.name).join(', ')}` : `${qc.samples.length} samples, each with counts`,
    explanation: empty.length ? `${empty.map((s) => s.name).join(', ')} ${empty.length > 1 ? 'have' : 'has'} no counts at all (every value missing or 0). The replicates that use ${empty.length > 1 ? 'them' : 'it'} cannot be scored: check the table's columns and the design.` : 'No sample is empty.',
    threshold: 'fail when a sample has no counts', rationale: 'A sample with no counts is a missing file, a misnamed column or a failed library, never a result.',
    affected: { samples: empty.map((s) => s.id), replicates: [...new Set(empty.flatMap((s) => s.roles.map((r) => r.replicate)))] },
  });

  // Depth.
  const present = qc.samples.filter((s) => s.counted > 0 && s.total > 0);
  const rpv = levels(t, 'readsPerVariant');
  const depthStatus = present.map((s) => statusOf(s.readsPerVariant, rpv, 'below'));
  const shallow = present.filter((_, i) => depthStatus[i] !== 'pass');
  const minDepth = present.reduce((a, s) => Math.min(a, s.readsPerVariant), Infinity);
  add({
    id: 'depth', title: 'Sequencing depth', plot: 'depth', status: present.length ? worst(depthStatus) : 'na',
    value: present.length ? `lowest ${num(minDepth, 0)} reads per variant (${present.find((s) => s.readsPerVariant === minDepth)?.name})` : 'no sample has counts',
    explanation: shallow.length ? `${shallow.length} sample${shallow.length > 1 ? 's have' : ' has'} few reads per counted variant: ${shallow.map((s) => `${s.name} ${num(s.readsPerVariant, 0)}`).join(', ')}. Their counts carry large sampling error.` : 'Every sample is sequenced deeply enough for its variants.',
    threshold: thresholdText(rpv, 'below', (x) => `${x} reads per variant`),
    rationale: 'A count of c reads has a relative sampling error of about 1/√c: ±32% at 10 reads, ±18% at 30. Depth is the total reads of a sample over the variants counted in it.',
    affected: { samples: shallow.map((s) => s.id), replicates: [] },
  });

  // Low counts in the input.
  const inputs = present.filter((s) => s.input);
  const lf = levels(t, 'lowFraction');
  const lowStatus = inputs.map((s) => statusOf(s.lowFraction, lf, 'above'));
  const lowOnes = inputs.filter((_, i) => lowStatus[i] !== 'pass');
  const maxLow = inputs.reduce((a, s) => Math.max(a, s.lowFraction), 0);
  add({
    id: 'low-count', title: 'Low counts before selection', plot: 'counts', status: inputs.length ? worst(lowStatus) : 'na',
    value: inputs.length ? `up to ${pct(maxLow)} of input variants below ${t.lowCount} reads` : 'not assessed: no sample before selection (sorted bins)',
    explanation: lowOnes.length ? `In ${lowOnes.map((s) => `${s.name} (${pct(s.lowFraction)})`).join(', ')}, many variants have fewer than ${t.lowCount} reads before selection: their scores rest on a few molecules. A low-count tail shared by every input points to the library; one replicate's alone, to that replicate.` : `Few variants have fewer than ${t.lowCount} reads before selection.`,
    threshold: `${thresholdText(lf, 'above', pct)} of the input's variants below ${t.lowCount} reads`,
    rationale: 'The input count sets how precisely a variant\'s starting frequency is known; scores of variants seen a handful of times are mostly noise. The fraction of variants with at least 10 input reads is a common coverage measure.',
    affected: { samples: lowOnes.map((s) => s.id), replicates: [] },
  });

  // Missingness.
  const me = levels(t, 'missingExcess');
  const typical = present.length ? [...present.map((s) => s.missingFraction)].sort((a, b) => a - b)[Math.floor((present.length - 1) / 2)] : 0;
  const missStatus = present.map((s) => statusOf(s.missingFraction - typical, me, 'above'));
  const missing = present.filter((_, i) => missStatus[i] !== 'pass');
  add({
    id: 'missingness', title: 'Missing counts', plot: 'missingness', status: present.length ? worst(missStatus) : 'na',
    value: missing.length ? missing.map((s) => `${s.name} ${pct(s.missingFraction)}`).join(', ') : `typical sample: ${pct(typical)} of variants missing`,
    explanation: missing.length ? `${missing.map((s) => s.name).join(', ')} lack${missing.length > 1 ? '' : 's'} counts for many more variants than the other samples (typically ${pct(typical)}): a variant missing from a sample cannot be scored in its replicate.` : 'Samples miss counts for about the same variants (a variant outside a tile, or absent from the library, is missing everywhere).',
    threshold: `${thresholdText(me, 'above', pct)} more of the variants missing than the median sample`,
    rationale: 'Missing is not zero: a sample that misses many more variants than its peers was filtered, truncated or joined differently.',
    affected: { samples: missing.map((s) => s.id), replicates: [] },
  });

  // Missing after selection: dropouts written as missing?
  const drops = qc.conditions.flatMap((c) => c.dropout ?? []).filter((d) => d.counted >= 20);
  const looksLikeDropout = (d) => d.missing / d.counted >= 0.05 && d.zeros === 0 && d.missingTrend < 0.25 * d.countedTrend;
  const dropped = drops.filter(looksLikeDropout);
  add({
    id: 'dropout', title: 'Missing after selection', plot: 'dropout', status: !drops.some((d) => d.missing > 0) ? (drops.length ? 'pass' : 'na') : dropped.length ? 'review' : 'pass',
    value: !drops.length ? 'not assessed' : dropped.length ? `${dropped.length} sample${dropped.length > 1 ? 's' : ''} with no zeros, where the missing variants had been depleted` : `${drops.reduce((a, d) => a + d.missing, 0)} variants missing after selection; ${drops.some((d) => d.zeros > 0) ? 'zeros are written as 0' : 'none looks like a dropout'}`,
    explanation: dropped.length
      ? `${dropped.map((d) => `${d.sample} has no count of 0, yet ${pct(d.missing / d.counted)} of the variants counted before selection are missing from it, and those had ${d.by === 'trend' ? `fallen to ${pct(d.missingTrend)} of their input by the time point before (others ${pct(d.countedTrend)})` : `a median input of ${num(d.missingTrend, 0)} reads (others ${num(d.countedTrend, 0)})`}`).slice(0, 3).join('; ')}${dropped.length > 3 ? '; …' : ''}. The table seems to write a variant that dropped out as missing rather than 0. Missing variants are not scored in that replicate, so the most depleted variants go unscored and scores lean toward wild type. Enrich2 drops such variants too, so published Enrich2 scores share this.`
      : 'Variants missing after selection are not the ones selection depleted, or zeros are written as 0.',
    threshold: 'review when a sample after selection has no 0, 5% or more of the variants are missing from it, and they had been depleted to under a quarter of the others\' level',
    rationale: 'Missing is not zero, and MaveScape never reads one as the other. But a pipeline that writes "not seen" as NA turns the strongest depletions into missing values; telling the two apart needs the counts\' history.',
    affected: { samples: dropped.map((d) => d.sample), replicates: dropped.map((d) => d.replicate) },
  });

  // Coverage: of what the library can make, when it is made of single-base changes and the
  // target's codons are known (wave 2, slice 8).
  const cv = levels(t, 'coverage');
  const cov = qc.coverage;
  const reach = cov.assessed && cov.reach?.known ? cov.reach : null;
  add({
    id: 'coverage', title: 'Coverage of designed substitutions', plot: 'coverage', status: cov.assessed ? statusOf(reach ? reach.fraction : cov.fraction, cv, 'below') : 'na',
    value: cov.assessed ? `${reach ? `${pct(reach.fraction)} of the substitutions one base change makes (${reach.observed} of ${reach.designed}); ` : ''}${pct(cov.fraction)}${reach ? ' of all' : ''} (${cov.observed} of ${cov.designed}; missense ${cov.byClass.missense[0]}/${cov.byClass.missense[1]}, nonsense ${cov.byClass.nonsense[0]}/${cov.byClass.nonsense[1]})` : `not assessed: ${cov.reason}`,
    explanation: cov.assessed ? `Of the ${cov.designed} single amino-acid substitutions and stops possible across ${cov.length} positions, ${cov.observed} were seen before selection; ${cov.inTable - cov.observed} are in the table with no input reads, ${cov.designed - cov.inTable} are not in it.${reach ? ` The library was made by ${inText(cov.method)}, which reaches mostly the ${reach.designed} substitutions one base change away from each wild-type codon: ${reach.observed} of those were seen, and coverage is judged on them.` : cov.reach && !cov.reach.known ? ` The library was made by ${inText(cov.method)}, which reaches mostly the substitutions one base change makes (about a third of all); with the target's DNA sequence, coverage would be judged against those.` : ''} Unmeasured substitutions are missing on the map, never "no effect".` : `Coverage is not assessed: ${cov.reason}.`,
    threshold: `${thresholdText(cv, 'below', pct)}${reach ? ', of the substitutions the library can make' : ''}`,
    rationale: 'The fraction of designed variants observed. A library of single-base changes (error-prone PCR, doped oligos) reaches about a third of the substitutions, and a tiled one covers its tiles: coverage is judged against what the library could make when the design says how it was made. The threshold is a prompt to check, not a standard.',
  });

  // Replicate agreement.
  const ag = levels(t, 'agreement');
  const pairs = qc.conditions.flatMap((c) => c.pairs.filter((p) => p.n >= 20).map((p) => ({ ...p, condition: c.name })));
  const agStatus = pairs.map((p) => statusOf(p.pearson, ag, 'below'));
  const weak = pairs.filter((_, i) => agStatus[i] !== 'pass');
  const minR = pairs.reduce((a, p) => Math.min(a, p.pearson), Infinity);
  add({
    id: 'agreement', title: 'Replicate agreement', plot: 'agreement', status: pairs.length ? worst(agStatus) : 'na',
    value: pairs.length ? `lowest Pearson r ${num(minR)} (${pairs.length} pair${pairs.length > 1 ? 's' : ''}; Spearman ${num(pairs.find((p) => p.pearson === minR)?.spearman)})` : 'not assessed: fewer than two replicates with shared variants',
    explanation: weak.length ? `Replicates disagree: ${weak.map((p) => `${p.a} and ${p.b} r = ${num(p.pearson)} on ${p.n} variants`).join('; ')}. Scores combined from them carry the disagreement in their SEs (REML's τ²), but check the replicates.` : pairs.length ? `The replicates' ${qc.model === 'bins' ? 'weighted bin values' : 'log ratios'} agree.` : 'Agreement needs two replicates measuring the same variants.',
    threshold: `${thresholdText(ag, 'below')}, on variants with at least ${t.agreementInput} input reads in both replicates`,
    rationale: 'Pearson correlation of replicates\' log ratios (for sorted bins, their weighted averages of the bins\' values), on variants counted well enough to be compared; Spearman is reported beside it. Normalization shifts a replicate as a whole, which correlation ignores, so this is assessed from the counts before any scoring.',
    affected: { samples: [], replicates: [...new Set(weak.flatMap((p) => [p.a, p.b]))] },
  });

  // Variance beyond counting.
  const ev = levels(t, 'excessVariance');
  // DiMSum's error model of two populations: where the excess is (a term m means about m − 1 reads
  // per molecule beyond counting; above 2 at one end and under it at the other says which).
  const terms = qc.conditions.flatMap((c) => (c.errorModel ?? []).flatMap((g) => g.terms ?? []));
  const maxIn = terms.length ? Math.max(...terms.map((x) => x.input)) : 0;
  const maxOut = terms.length ? Math.max(...terms.map((x) => x.output)) : 0;
  const bottleneckAt = maxIn >= 2 && maxIn >= 2 * maxOut ? 'input' : maxOut >= 2 && maxOut >= 2 * maxIn ? 'output' : null;
  const evPairs = pairs.filter((p) => Number.isFinite(p.ratio));
  const synonymous = qc.conditions.flatMap((c) => c.synonymous).filter((s) => s.n >= 10 && Number.isFinite(s.ratio));
  const values = evPairs.length ? evPairs.map((p) => p.ratio) : synonymous.map((s) => s.ratio);
  const evStatus = values.map((v) => statusOf(v, ev, 'above'));
  const maxRatio = values.length ? Math.max(...values) : Number.NaN;
  const worstPair = evPairs.find((p) => p.ratio === maxRatio);
  const resolvable = worstPair && worstPair.bins.length >= 3 && worstPair.bins.at(-1).counting / worstPair.bins[0].counting >= 4;
  const flagged = evPairs.filter((p) => statusOf(p.ratio, ev, 'above') !== 'pass');
  add({
    id: 'excess-variance', title: 'Variance beyond counting (bottleneck)', plot: 'variance', status: values.length ? worst(evStatus) : 'na',
    value: values.length ? `${num(maxRatio, 1)}× the counting variance${synonymous.length ? `; synonymous variants ${synonymous.map((s) => `${num(s.ratio, 1)}×`).join(', ')}` : ''}${terms.length ? `; DiMSum's terms up to ${num(Math.max(...terms.map((x) => x.input)), 1)}× at the input, ${num(Math.max(...terms.map((x) => x.output)), 1)}× at the output` : ''}` : 'not assessed: no replicate pairs and fewer than 10 synonymous variants',
    explanation: values.length
      ? `${flagged.length ? `Replicate differences vary ${num(maxRatio, 1)}× more than counting alone predicts (${worstPair ? `${worstPair.a} and ${worstPair.b}` : 'synonymous variants'}): too few cells somewhere (a bottleneck), or noise between replicates. SEs from counts alone understate the uncertainty; REML's τ² takes up the excess between replicates, and DiMSum's error model (Score, Scored by) puts it in each variant's SE.` : 'Replicate differences vary about as much as counting predicts.'}${resolvable ? ` Fitted as a·counting + e: a = ${num(worstPair.multiplier, 1)}${worstPair.multiplier > 1.5 ? ' (above 1: a bottleneck)' : ''}, e = ${num(worstPair.additive, 3)} (replicate noise SD about ${num(Math.sqrt(worstPair.additive / 2), 2)}).` : flagged.length ? ' The counts span too narrow a range to tell a bottleneck (which scales with counting error) from replicate noise (which does not).' : ''}${terms.length ? ` DiMSum's error model: ${terms.map((x) => `${x.name} input ${num(x.input, 1)}×, output ${num(x.output, 1)}×, additive SD ${num(Math.sqrt(x.reperror), 2)}`).join('; ')}.${bottleneckAt ? ` The excess is at the ${bottleneckAt}: about ${num(bottleneckAt === 'input' ? Math.max(...terms.map((x) => x.input)) : Math.max(...terms.map((x) => x.output)), 0)} reads per molecule there, ${bottleneckAt === 'input' ? 'before selection (the cells transformed or carried into it)' : 'after it (the cells recovered, or the DNA extracted from them)'}.` : ''}` : ''}`
      : 'Variance beyond counting needs two replicates, or ten synonymous variants.',
    threshold: thresholdText(ev, 'above', (x) => `${x}×`),
    rationale: 'Under counting (Poisson) noise alone, the difference of two replicates\' log ratios has a variance equal to the sum of the reciprocal counts; its robust ratio to that is about 1. N cells per variant carried through a step add 1/N to each replicate\'s variance: with D reads per variant before and after selection, the ratio becomes about 1 + D/(2N), a multiplier of the counting variance (the multiplicative error term of DiMSum, Faure et al. 2020). Aim for an excess of molecules over reads at every step. Synonymous variants should vary as counting predicts.',
    affected: { samples: [], replicates: [...new Set(flagged.flatMap((p) => [p.a, p.b]))] },
  });

  // Outlier replicate.
  const or = levels(t, 'outlierReplicate');
  const loo = qc.conditions.flatMap((c) => (c.leaveOneOut ?? []).map((x) => ({ ...x, condition: c.name })));
  const orStatus = loo.map((x) => statusOf(x.ratio, or, 'above'));
  const outliers = loo.filter((_, i) => orStatus[i] !== 'pass');
  const maxOr = loo.length ? Math.max(...loo.map((x) => x.ratio)) : Number.NaN;
  add({
    id: 'outlier-replicate', title: 'Outlier replicates', plot: 'leave-one-out', status: loo.length ? worst(orStatus) : 'na',
    value: loo.length ? `largest ${num(maxOr, 1)}× the others (${loo.find((x) => x.ratio === maxOr)?.id})` : 'not assessed: fewer than three replicates',
    explanation: outliers.length ? `${outliers.map((x) => `${x.id} departs from the other replicates ${num(x.ratio, 1)}× as much as they do (leave-one-out z variance ${num(x.dispersion, 1)}, median z ${num(x.bias, 2)})`).join('; ')}. Look at it before combining; leaving it out is a decision to record, not a default.` : loo.length ? 'No replicate departs from the others more than they do from each other.' : 'Outliers need three replicates.',
    threshold: thresholdText(or, 'above', (x) => `${x}×`),
    rationale: 'Leave-one-out z = (a replicate\'s score − the others\' combined score) / its SE should be about N(0, 1) when SEs are right; it is compared with the other replicates\' so that a shared bottleneck does not single one out.',
    affected: { samples: [], replicates: outliers.map((x) => x.id) },
  });

  // From a score run.
  const scores = qc.scores;
  const noRun = 'not assessed: no score run (score the counts to see it)';
  const sp = levels(t, 'separation');
  const sep = (scores ?? []).filter((c) => c.separation);
  const sepStatus = sep.map((c) => statusOf(c.separation.auc, sp, 'below'));
  const first = sep[0]?.separation;
  // How far the nonsense variants sit from the reference, on the side the readout expects (or, a
  // negative distance, the other side).
  const sideWord = (x) => {
    const expected = x.side === 'above' ? 'above' : 'below';
    const other = x.side === 'above' ? 'below' : 'above';
    return x.side === 'either' ? `${num(Math.abs(x.standardized), 1)} robust SDs away from` : `${num(Math.abs(x.standardized), 1)} robust SDs ${x.standardized >= 0 ? expected : other}`;
  };
  const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1);
  const noControls = ctx && ctx.controls.nonsense === 'none' ? 'not assessed: the design names no nonsense controls' : 'not assessed: needs 5 scored nonsense controls and synonymous variants or the wild type';
  const limited = ctx?.controls.positions?.nonsense;
  const changes = sep.filter((c) => c.separation.change && !(limited?.end <= c.separation.change.lastControl));
  add({
    id: 'separation', title: 'Separation of controls', plot: 'controls', level: 'scores',
    status: !scores ? 'na' : sep.length ? worst(sepStatus) : 'na',
    value: !scores ? noRun : sep.length ? sep.map((c) => `${scores.length > 1 ? `${c.name}: ` : ''}AUC ${num(c.separation.auc, 3)} (${c.separation.reference} median ${num(c.separation.referenceMedian)}, nonsense ${num(c.separation.nonsenseMedian)}${c.separation.controls < c.separation.stops ? `; ${c.separation.controls} of ${c.separation.stops} stops as controls` : ''})`).join('; ') : noControls,
    explanation: sep.length ? [
      `Nonsense variants score ${sep.map((c) => `${sideWord(c.separation)} ${c.separation.reference === 'wild type' ? 'the wild type' : 'synonymous variants'}${scores.length > 1 ? ` in ${c.name}` : ''}`).join('; ')}${sep.some((c) => Number.isFinite(c.separation.nonsenseAbove)) ? `; ${sep.map((c) => pct(c.separation.nonsenseAbove)).join(', ')} of them score on the wild type's side of the synonymous ${first.side === 'above' ? '95th' : '5th'} percentile` : ''}.`,
      worst(sepStatus) === 'pass' ? 'The assay tells loss of function from wild-type-like.' : 'The assay struggles to tell loss of function from wild-type-like: intermediate scores will be hard to read.',
      first.stated ? (first.side === 'either' ? 'The readout\'s score has no sign, so separation is counted either way.' : `As the readout says, loss of function scores ${first.side === 'above' ? 'high' : 'low'}.`) : 'The readout\'s direction is not stated: loss of function is taken to score low (a higher score, more of the function).',
      sep.some((c) => c.separation.reversed) ? `The nonsense variants score ${first.side === 'below' ? 'above' : 'below'} the reference instead${first.stated ? ': check the readout\'s direction, and that the nonsense variants lose the function this assay measures.' : ': in this assay a higher score may mean less of the function. State the readout\'s direction (Experiment).'}` : '',
      changes.length ? capital(changes.map((c) => `${scores.length > 1 ? `${c.name}: ` : ''}stops after position ${c.separation.change.lastControl} score like the reference (median ${num(c.separation.change.after.median)}, ${c.separation.change.after.n} stops), those up to it ${num(c.separation.change.before.median)} (${c.separation.change.before.n})`).join('; ')) + ': truncations late in the target may keep the function, and are not loss-of-function controls.' : '',
    ].filter(Boolean).join(' ') : ctx && ctx.controls.nonsense === 'none' ? 'The design names no nonsense controls.' : 'Separation needs scored controls.',
    threshold: thresholdText(sp, 'below', (x) => `AUC ${x}`),
    rationale: 'No single separation statistic is standard, so three are reported: the AUC (the chance a reference variant sits on the wild-type side of a nonsense variant, in the direction the readout gives), the standardized median difference, and the nonsense fraction on the wild-type side of the synonymous 5th percentile (the class threshold of VAMP-seq, Matreyek et al. 2018). Nonsense variants are loss-of-function controls only where a truncation loses the function assayed: stops after the region an assay needs (BRCA1\'s Y2H construct) can keep it, and the design can limit them to the positions where they serve.',
  });
  const rs = levels(t, 'resolution');
  const res = (scores ?? []).filter((c) => Number.isFinite(c.resolution));
  add({
    id: 'resolution', title: 'Resolution of scores', plot: 'uncertainty', level: 'scores',
    status: !scores ? 'na' : res.length ? worst(res.map((c) => statusOf(c.resolution, rs, 'above'))) : 'na',
    value: !scores ? noRun : res.length ? res.map((c) => `${scores.length > 1 ? `${c.name}: ` : ''}median SE ${num(c.medianSE, 3)}, ${num(c.resolution, 2)}× the controls' gap`).join('; ') : 'not assessed: no control gap',
    explanation: res.length ? `A typical variant's SE is ${res.map((c) => pct(c.resolution)).join(', ')} of the distance between the controls: ${worst(res.map((c) => statusOf(c.resolution, rs, 'above'))) === 'pass' ? 'intermediate effects can be told apart.' : 'intermediate effects will be hard to tell from either end.'}` : 'Resolution needs the controls\' gap.',
    threshold: thresholdText(rs, 'above', (x) => `${x}×`),
    rationale: 'Effect against uncertainty: how many SEs fit between wild-type-like and nonsense scores.',
  });
  const sf = levels(t, 'scoredFraction');
  const flows = (scores ?? []).filter((c) => c.measured > 0);
  add({
    id: 'scored-fraction', title: 'Variants scored', plot: 'flow', level: 'scores',
    status: !scores ? 'na' : flows.length ? worst(flows.map((c) => statusOf(c.scored / c.measured, sf, 'below'))) : 'na',
    value: !scores ? noRun : flows.map((c) => `${scores.length > 1 ? `${c.name}: ` : ''}${c.scored} of ${c.measured} measured (${pct(c.scored / c.measured)})`).join('; '),
    explanation: flows.length ? `Filters left out ${flows.map((c) => `${c.measured - c.scored}${scores.length > 1 ? ` in ${c.name}` : ''}`).join(', ')} of the measured variants with valid names; the filter flow shows at which stage.` : '',
    threshold: thresholdText(sf, 'below', pct),
    rationale: 'Filters should remove the few variants that cannot be scored; when they remove many, the parameters or the experiment need a look.',
  });

  // Sorted bins (Q10): how the reads spread over the bins, and how many cells each variant had.
  if (qc.model === 'bins' && qc.bins?.length) {
    const bs = levels(t, 'binShare');
    const shares = qc.bins.map((r) => ({ ...r, smallest: Math.min(...r.bins.map((b) => b.share)) }));
    const shareStatus = shares.map((r) => statusOf(r.smallest, bs, 'below'));
    add({
      id: 'bin-occupancy', title: 'Occupancy of the bins', plot: 'bin-occupancy',
      status: worst(shareStatus),
      value: `smallest bin ${pct(Math.min(...shares.map((r) => r.smallest)))} of a replicate's ${shares[0].shareOf}`,
      explanation: `${shares.filter((r, i) => shareStatus[i] !== 'pass').map((r) => `${r.name}: bin ${r.bins.find((b) => b.share === r.smallest).order} holds ${pct(r.smallest)} of its ${r.shareOf}`).join('; ') || `Every bin holds a fair share of each replicate's ${shares[0].shareOf}.`}${shareStatus.some((x) => x !== 'pass') ? '. A nearly empty bin samples its variants coarsely, and the weighted average leans on the other bins.' : ''}`,
      threshold: thresholdText(bs, 'below', pct),
      rationale: 'Bins are usually gated to hold similar numbers of cells and sequenced to similar depths; a bin with a small share of the cells (or, when the cells are not recorded, of the reads) is nearly empty or undersequenced.',
      affected: { samples: [], replicates: shares.filter((r, i) => shareStatus[i] !== 'pass').map((r) => r.id) },
    });
    const cv = levels(t, 'cellsPerVariant');
    const known = qc.bins.filter((r) => r.bins.every((b) => b.cellsPerVariant !== null));
    const cellStatus = known.map((r) => statusOf(Math.min(...r.bins.map((b) => b.cellsPerVariant)), cv, 'below'));
    add({
      id: 'cells-per-bin', title: 'Cells sorted per variant', plot: 'cells-per-bin',
      status: known.length ? worst(cellStatus) : 'na',
      value: known.length ? `fewest ${num(Math.min(...known.flatMap((r) => r.bins.map((b) => b.cellsPerVariant))), 0)} cells per variant in a bin` : 'not assessed: the design does not record the cells sorted into each bin',
      explanation: known.length ? `${known.map((r) => `${r.name}: ${r.bins.map((b) => num(b.cellsPerVariant, 0)).join(', ')} cells per variant, ${r.bins.map((b) => num(b.readsPerCell, 1)).join(', ')} reads per cell`).join('; ')}. ${worst(cellStatus) === 'pass' ? 'Enough cells were sorted for each variant\'s distribution over the bins.' : 'Few cells per variant: a variant\'s distribution over the bins is sampled coarsely, whatever the depth of sequencing.'}` : 'Record the cells sorted into each bin with each sample (the Experiment view) to assess it; the maximum-likelihood fit uses them too.',
      threshold: thresholdText(cv, 'below', (x) => `${x} cells`),
      rationale: 'A variant\'s distribution over the bins is sampled twice: by the cells sorted, then by the reads. Fewer cells than reads per variant means the cells limit what is known.',
      affected: { samples: [], replicates: known.filter((r, i) => cellStatus[i] !== 'pass').map((r) => r.id) },
    });
  }

  // Barcodes (Q8): the map, barcodes per variant, how a variant's barcodes agree, outliers.
  if (qc.barcodes) {
    const bq = qc.barcodes;
    const ur = levels(t, 'unmappedReads');
    add({
      id: 'barcode-map', title: 'Barcodes the map names', plot: 'barcodes-per-variant',
      status: statusOf(bq.unmappedReadShare, ur, 'above'),
      value: `${pct(bq.unmappedReadShare)} of reads in ${bq.unmapped} barcode${bq.unmapped === 1 ? '' : 's'} (of ${bq.rows}) naming no variant`,
      explanation: bq.unmapped ? `${bq.unmapped} barcodes are not in the barcode-to-variant map or are given two variants by it; their reads are not scored. ${statusOf(bq.unmappedReadShare, ur, 'above') === 'pass' ? 'They are a small share of the reads.' : 'A large share of the reads: is the map from this library, and its barcodes written the same way (strand, length)?'}` : 'Every barcode counted names a variant.',
      threshold: thresholdText(ur, 'above', pct),
      rationale: 'Barcodes are linked to variants by sequencing the library once (long reads); a barcode missing from that map is one seen too rarely there, a sequencing error, or a map from another library. A barcode the map gives two variants cannot be trusted for either.',
    });
    const sb = levels(t, 'singleBarcode');
    const reps = bq.replicates;
    const singleShare = (r) => (r.variants ? r.perVariant.single / r.variants : Number.NaN);
    const singleStatus = reps.map((r) => statusOf(singleShare(r), sb, 'above'));
    add({
      id: 'barcodes-per-variant', title: 'Barcodes per variant', plot: 'barcodes-per-variant',
      status: reps.length ? worst(singleStatus) : 'na',
      value: reps.length ? reps.map((r) => `${reps.length > 1 ? `${r.name}: ` : ''}median ${num(r.perVariant.median, 0)} (${num(r.perVariant.q25, 0)}–${num(r.perVariant.q75, 0)}), ${pct(singleShare(r))} with one`).join('; ') : 'no replicate has barcodes counted',
      explanation: `${reps.map((r) => `${r.name}: ${r.barcodes} barcodes of ${r.variants} variants with reads before selection`).join('; ')}. ${worst(singleStatus) === 'pass' ? 'Most variants are measured by several barcodes, so a barcode\'s own noise can be told from its variant\'s effect.' : 'Many variants have a single barcode: their scores cannot be checked against another barcode, and an outlier barcode passes for an effect.'}`,
      threshold: thresholdText(sb, 'above', pct),
      rationale: 'Several independent barcodes per variant are independent clones: they average out clonal variation and expose barcodes that carry a second mutation or are misassigned.',
      affected: { samples: [], replicates: reps.filter((r, i) => singleStatus[i] !== 'pass').map((r) => r.id) },
    });
    const compared = reps.filter((r) => Number.isFinite(r.phi));
    if (compared.length || qc.model !== 'bins') {
      const be = levels(t, 'barcodeExcess');
      const sh = levels(t, 'splitHalf');
      const agreementStatus = compared.map((r) => worst([statusOf(r.phi, be, 'above'), r.splitHalf ? statusOf(r.splitHalf.r, sh, 'below') : 'pass']));
      add({
        id: 'barcode-agreement', title: 'Agreement of a variant\'s barcodes', plot: 'barcode-agreement',
        status: compared.length ? worst(agreementStatus) : 'na',
        value: compared.length ? compared.map((r) => `${compared.length > 1 ? `${r.name}: ` : ''}φ ${num(r.phi, 2)}${r.splitHalf ? `, split-half r ${num(r.splitHalf.r, 3)}` : ''}`).join('; ') : 'not assessed: no variant has two barcodes counted',
        explanation: compared.length ? `A variant's barcodes disagree ${num(Math.max(...compared.map((r) => r.phi)), 1)}× as much as counting explains at most${compared.some((r) => r.splitHalf) ? `, and the two halves of its barcodes score alike with r ${compared.filter((r) => r.splitHalf).map((r) => num(r.splitHalf.r, 3)).join(', ')}` : ''}. ${worst(agreementStatus) === 'pass' ? 'Barcodes of one variant agree about as counting predicts.' : 'More than counting explains: few cells per barcode (a bottleneck), or clones that differ. Scoring each barcode and combining them by REML takes the extra variation into a variant\'s SE; the sums leave it out.'}` : 'Needs variants with two or more barcodes counted.',
        threshold: `φ ${thresholdText(be, 'above', (x) => `${x}×`)}; split-half r ${thresholdText(sh, 'below')}`,
        rationale: 'Each barcode is compared with its variant\'s other barcodes, in units of their counting error together; φ, the median square of these over its value under counting alone, is 1 when barcodes differ only by counting. The split halves are a variant\'s barcodes in two groups, scored separately: their correlation is the replicate agreement of barcodes.',
        affected: { samples: [], replicates: compared.filter((r, i) => agreementStatus[i] !== 'pass').map((r) => r.id) },
      });
      const ob = levels(t, 'outlierBarcodes');
      const outlierStatus = compared.map((r) => statusOf(r.outlierShare, ob, 'above'));
      add({
        id: 'outlier-barcodes', title: 'Outlier barcodes', plot: 'barcode-agreement',
        status: compared.length ? worst(outlierStatus) : 'na',
        value: compared.length ? compared.map((r) => `${compared.length > 1 ? `${r.name}: ` : ''}${r.outliers} of ${r.compared} (${pct(r.outlierShare)})`).join('; ') : 'not assessed: no variant has three barcodes counted',
        explanation: compared.length ? `${compared.reduce((a, r) => a + r.outliers, 0)} barcodes depart from their variant's other barcodes by more than 4 in z/√φ (found one at a time, so that one does not hide another). ${worst(outlierStatus) === 'pass' ? 'Few: they move their variants little.' : 'Many: a barcode carrying a second mutation, or assigned to the wrong variant, scores as its variant. Leave them out with the barcode filter (Score, Filters), and look for a pattern (a library, low counts).'}` : 'Needs variants with three or more barcodes counted.',
        threshold: thresholdText(ob, 'above', pct),
        rationale: 'A barcode far from its siblings is rarely its variant\'s effect: it is a clone with a second mutation, a barcode linked to the wrong variant, or a sequencing artefact. Variants with fewer than three barcodes cannot say which barcode is off.',
        affected: { samples: [], replicates: compared.filter((r, i) => outlierStatus[i] !== 'pass').map((r) => r.id) },
      });
    }
  }

  // Time series (Q10): the time points the fits used, and how well the time courses follow a line.
  if (qc.model === 'time-series') {
    const ts = qc.timeSeries;
    const regression = ts && ts.length;
    const noRegression = qc.scores ? 'not assessed: the run scores by the log ratio of the first and last samples' : 'not assessed: needs a score run by regression';
    const fp = levels(t, 'fewerPoints');
    const fewer = regression ? ts.map((r) => ({ ...r, share: r.fits ? r.fewer / r.fits : Number.NaN })) : [];
    const fewerStatus = fewer.map((r) => statusOf(r.share, fp, 'above'));
    add({
      id: 'time-points', title: 'Time points used', plot: 'time-points', level: 'scores',
      status: regression ? worst(fewerStatus) : 'na',
      value: regression ? `${pct(Math.max(...fewer.map((r) => r.share).filter(Number.isFinite), 0))} of fits at most on fewer points; ${fewer.reduce((a, r) => a + r.excluded, 0)} replicate measurements with too few` : noRegression,
      explanation: regression ? `${fewer.map((r) => `${r.name}: ${r.fewer} of ${r.fits} fits on fewer than its ${r.times} time points${r.excluded ? `, ${r.excluded} measurements left out with too few` : ''}`).join('; ')}. A variant is fitted on the time points where it was counted; missing points are usually variants that dropped out and were written as missing, which the "Missing after selection" finding looks for.` : 'Needs a run scored by weighted or ordinary regression on time.',
      threshold: thresholdText(fp, 'above', pct),
      rationale: 'A slope fitted on fewer points is less certain, and points missing at the end of a time course bias it toward the wild type: the variants that dropped out are the most depleted.',
      affected: { samples: [], replicates: fewer.filter((r, i) => fewerStatus[i] !== 'pass').map((r) => r.id) },
    });
    const tf = levels(t, 'timeFit');
    const fit = regression ? ts.filter((r) => r.assessed) : [];
    const fitStatus = fit.map((r) => statusOf(r.departure, tf, 'above'));
    add({
      id: 'time-fit', title: 'Fit of the time courses', plot: 'time-fit', level: 'scores',
      status: fit.length ? worst(fitStatus) : 'na',
      value: fit.length ? `median ${num(Math.max(...fit.map((r) => r.departure)), 1)}× what counting predicts; up to ${pct(Math.max(...fit.map((r) => r.beyond)))} of fits beyond its 99.9th percentile` : regression ? 'not assessed: no fit has three or more points' : noRegression,
      explanation: fit.length ? `${fit.map((r) => `${r.name}: ${num(r.departure, 1)}×, ${pct(r.beyond)} far from a line`).join('; ')}. ${worst(fitStatus) === 'pass' ? 'The time courses scatter about their lines as counting predicts.' : 'The time courses scatter about their lines more than counting predicts: variation between time points (bottlenecks at each passage, growth that is not exponential, saturation) adds to the counting noise. The SEs are scaled by the residuals, so they include it.'} Trajectories far from a line are reported, never removed: a variant can rise and then fall for real.` : 'Needs fits of three or more time points.',
      threshold: thresholdText(tf, 'above', (x) => `${x}×`),
      rationale: 'Each fit\'s weighted residuals are compared with counting noise (χ² per degree of freedom over its median under counting alone, so 1 is typical). Departures well above 1 for most variants point to noise in the experiment at each time point; for a few, to time courses that are not exponential.',
      affected: { samples: [], replicates: fit.filter((r, i) => fitStatus[i] !== 'pass').map((r) => r.id) },
    });
  }
  // Context: what to do next, and the acknowledgements that still hold.
  return out.map((f) => ({ ...f, advice: adviceFor(f, qc), acknowledged: acknowledgementOf(f, options.acknowledged?.[f.id]) }));
}

// A workspace's acknowledgement of a finding, as the finding carries it: { reason, time, status,
// value, current }, current while the finding is still to review or failing and no worse than when
// it was acknowledged. A blocking finding cannot be acknowledged.
function acknowledgementOf(f, ack) {
  if (!ack || f.blocking) return null;
  return { reason: ack.reason, time: ack.time ?? null, status: ack.status, value: ack.value ?? null, current: (f.status === 'review' || f.status === 'fail') && RANK[f.status] <= RANK[ack.status] };
}

// The overall status: the worst finding, and how many of each; acknowledgements do not change it,
// but are counted apart (unacknowledged: the findings to review or failing that no one has
// acknowledged).
export function overall(findings) {
  const counts = { fail: 0, review: 0, pass: 0, na: 0 };
  for (const f of findings) counts[f.status] += 1;
  const open = (status) => findings.filter((f) => f.status === status && !f.acknowledged?.current).length;
  return {
    status: counts.fail ? 'fail' : counts.review ? 'review' : 'pass',
    counts,
    blocking: findings.filter((f) => f.blocking && f.status === 'fail').map((f) => f.id),
    acknowledged: findings.filter((f) => f.acknowledged?.current).map((f) => f.id),
    unacknowledged: { fail: open('fail'), review: open('review') },
  };
}
