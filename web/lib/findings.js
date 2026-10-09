// QC findings (requirement Q9): the metrics of qc.js read against thresholds, each finding with
// its status (pass, review, fail; 'na' when it cannot be assessed, with why), what it found in
// numbers, the threshold, the rationale, the samples or replicates it concerns, the plot behind
// it, and whether it blocks the analysis or advises. Thresholds are parameters, kept in the
// workspace and its history; the overall status is the worst finding, shown beside the list.

import { DEFAULT_MEASURES } from './qc.js';

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

// The findings of a QC result. qc: computeQC's output; thresholds: as defaultThresholds().
export function findingsFrom(qc, thresholds) {
  const t = withDefaultThresholds(thresholds);
  const out = [];
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

  // Coverage.
  const cv = levels(t, 'coverage');
  const cov = qc.coverage;
  add({
    id: 'coverage', title: 'Coverage of designed substitutions', plot: 'coverage', status: cov.assessed ? statusOf(cov.fraction, cv, 'below') : 'na',
    value: cov.assessed ? `${pct(cov.fraction)} (${cov.observed} of ${cov.designed}; missense ${cov.byClass.missense[0]}/${cov.byClass.missense[1]}, nonsense ${cov.byClass.nonsense[0]}/${cov.byClass.nonsense[1]})` : `not assessed: ${cov.reason}`,
    explanation: cov.assessed ? `Of the ${cov.designed} single amino-acid substitutions and stops possible across ${cov.length} positions${qc.coverage.grid ? '' : ''}, ${cov.observed} were seen before selection; ${cov.inTable - cov.observed} are in the table with no input reads, ${cov.designed - cov.inTable} are not in it. Unmeasured substitutions are missing on the map, never "no effect".` : `Coverage is not assessed: ${cov.reason}.`,
    threshold: thresholdText(cv, 'below', pct),
    rationale: 'The fraction of designed variants observed. Libraries built by error-prone PCR or with tiles cover less by design; the threshold is a prompt to check, not a standard.',
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
    explanation: weak.length ? `Replicates disagree: ${weak.map((p) => `${p.a} and ${p.b} r = ${num(p.pearson)} on ${p.n} variants`).join('; ')}. Scores combined from them carry the disagreement in their SEs (REML's τ²), but check the replicates.` : pairs.length ? 'The replicates\' log ratios agree.' : 'Agreement needs two replicates measuring the same variants.',
    threshold: `${thresholdText(ag, 'below')}, on variants with at least ${t.agreementInput} input reads in both replicates`,
    rationale: 'Pearson correlation of replicates\' log ratios, on variants counted well enough to be compared; Spearman is reported beside it. Normalization shifts a replicate as a whole, which correlation ignores, so this is assessed from the counts before any scoring.',
    affected: { samples: [], replicates: [...new Set(weak.flatMap((p) => [p.a, p.b]))] },
  });

  // Variance beyond counting.
  const ev = levels(t, 'excessVariance');
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
    value: values.length ? `${num(maxRatio, 1)}× the counting variance${synonymous.length ? `; synonymous variants ${synonymous.map((s) => `${num(s.ratio, 1)}×`).join(', ')}` : ''}` : 'not assessed: no replicate pairs and fewer than 10 synonymous variants',
    explanation: values.length
      ? `${flagged.length ? `Replicate differences vary ${num(maxRatio, 1)}× more than counting alone predicts (${worstPair ? `${worstPair.a} and ${worstPair.b}` : 'synonymous variants'}): too few cells somewhere (a bottleneck), or noise between replicates. SEs from counts alone understate the uncertainty; REML's τ² takes up the excess between replicates.` : 'Replicate differences vary about as much as counting predicts.'}${resolvable ? ` Fitted as a·counting + e: a = ${num(worstPair.multiplier, 1)}${worstPair.multiplier > 1.5 ? ' (above 1: a bottleneck)' : ''}, e = ${num(worstPair.additive, 3)} (replicate noise SD about ${num(Math.sqrt(worstPair.additive / 2), 2)}).` : flagged.length ? ' The counts span too narrow a range to tell a bottleneck (which scales with counting error) from replicate noise (which does not).' : ''}`
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
  add({
    id: 'separation', title: 'Separation of controls', plot: 'controls', level: 'scores',
    status: !scores ? 'na' : sep.length ? worst(sepStatus) : 'na',
    value: !scores ? noRun : sep.length ? sep.map((c) => `${scores.length > 1 ? `${c.name}: ` : ''}AUC ${num(c.separation.auc, 3)} (${c.separation.reference} median ${num(c.separation.referenceMedian)}, nonsense ${num(c.separation.nonsenseMedian)})`).join('; ') : 'not assessed: needs 5 scored nonsense variants and synonymous variants or the wild type',
    explanation: sep.length ? `Nonsense variants score ${sep.map((c) => `${num(c.separation.standardized, 1)} robust SDs below ${c.separation.reference === 'wild type' ? 'the wild type' : 'synonymous variants'}${scores.length > 1 ? ` in ${c.name}` : ''}`).join('; ')}${sep.some((c) => Number.isFinite(c.separation.nonsenseAbove)) ? `; ${sep.map((c) => pct(c.separation.nonsenseAbove)).join(', ')} of nonsense variants score above the synonymous 5th percentile` : ''}. ${worst(sepStatus) === 'pass' ? 'The assay tells loss of function from wild-type-like.' : 'The assay struggles to tell loss of function from wild-type-like: intermediate scores will be hard to read.'}` : 'Separation needs scored controls.',
    threshold: thresholdText(sp, 'below', (x) => `AUC ${x}`),
    rationale: 'No single separation statistic is standard, so three are reported: the AUC (the chance a reference variant outscores a nonsense variant), the standardized median difference, and the nonsense fraction above the synonymous 5th percentile (the class threshold of VAMP-seq, Matreyek et al. 2018). Nonsense variants are loss-of-function controls only where a truncation loses the function assayed: stops after the region an assay needs (BRCA1\'s Y2H construct) can keep it.',
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
  return out;
}

// The overall status: the worst finding, and how many of each.
export function overall(findings) {
  const counts = { fail: 0, review: 0, pass: 0, na: 0 };
  for (const f of findings) counts[f.status] += 1;
  return { status: counts.fail ? 'fail' : counts.review ? 'review' : 'pass', counts, blocking: findings.filter((f) => f.blocking && f.status === 'fail').map((f) => f.id) };
}
