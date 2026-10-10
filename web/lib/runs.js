// Score runs (requirement S4): immutable records of what was scored, how, by what, and what came
// out. A run's id is the SHA-256 of its canonical inputs (the table's SHA-256, the mapping, the
// design, the parameters, the scoring version), so the same inputs always make the same id and a
// run is never edited, only added or removed. Its output is hashed too: the scores are not stored
// in the workspace but recomputed from the inputs when needed, and the recomputed output must
// have the recorded hash (reproduced, or the run says it was not).

import { canonicalJSON, change } from './workspace.js';
import { sha256 } from './sha256.js';
import { SCORING_VERSION, withDefaults, RESCALINGS } from './score.js';
import { NORMALIZATIONS } from './score-ratio.js';
import { COMBINATIONS } from './replicates.js';
import { describeFilters } from './filters.js';
import { BARCODE_COMBINATIONS } from './score-barcodes.js';

const encoder = new TextEncoder();
const hash = (value) => sha256(encoder.encode(canonicalJSON(value)));

// The canonical inputs of a run. source: the workspace source (its sha256, rows, mapping; how its
// files were assembled, when a barcode map or another layout was, wave 2).
export function runInputs({ source, design, parameters }) {
  const m = source.mapping ?? {};
  return {
    source: { sha256: source.sha256, rows: source.rows ?? null, files: (source.files ?? []).map((f) => f.sha256) },
    mapping: { variantColumn: design.variants.column, level: design.variants.level, mode: m.mode ?? 'lenient', absentMeans: m.absentMeans ?? null, derivedNames: m.derivedNames ?? null, ...(m.assembly ? { assembly: m.assembly } : {}) },
    design,
    parameters: withDefaults(parameters),
    scoring: SCORING_VERSION,
  };
}

export function runId(inputs) {
  return `run-${hash(inputs).slice(0, 16)}`;
}

const list = (typed) => Array.from(typed, (x) => (Number.isFinite(x) ? x : null));

// What a run's output is, for its hash: every variant's key, each replicate's scores, SEs and
// states, and each condition's scores, SEs, replicates used, reasons and flags. Numbers in
// JavaScript's shortest round-trip form; NaN as null.
export function outputDigest(results) {
  return hash({
    format: results.format,
    version: results.version,
    keys: results.variants.key,
    replicates: results.replicates.map((r) => ({ id: r.id, normalizers: r.normalizers, score: list(r.score), se: list(r.se), state: Array.from(r.state) })),
    conditions: results.conditions.map((c) => ({ id: c.id, score: list(c.score), se: list(c.se), k: Array.from(c.k), reason: Array.from(c.reason), flags: Array.from(c.flags), rescale: c.rescale })),
  });
}

// The record kept in the workspace. software: { version, commit }.
export function makeRun({ inputs, source, results, software, name, created = new Date().toISOString() }) {
  return {
    id: runId(inputs),
    name,
    created,
    software: { name: 'MaveScape', version: software.version, commit: software.commit || null, scoring: SCORING_VERSION },
    inputs: { ...inputs, source: { ...inputs.source, id: source.id, name: source.name, fileName: source.fileName ?? source.name } },
    seed: null,
    output: {
      sha256: outputDigest(results),
      variants: results.rows,
      replicates: results.replicates.map((r) => ({ id: r.id, normalizers: r.normalizers, synonymousMedian: r.synonymousMedian ?? null, ...(r.dimsum ? { dimsum: r.dimsum } : {}) })),
      conditions: results.conditions.map((c) => ({ id: c.id, name: c.name, replicates: c.replicates, scored: c.scored, flow: c.flow, rescale: c.rescale, combinedFromAll: c.combinedFromAll })),
    },
    warnings: results.warnings,
    info: results.info,
  };
}

// The inputs of a run as they were recorded (for running it again): without the source's
// workspace fields.
export function recordedInputs(run) {
  const { id, name, fileName, ...source } = run.inputs.source;
  return { ...run.inputs, source };
}

export function addRun(ws, run) {
  if (ws.runs.some((r) => r.id === run.id)) return { ws, existing: true };
  const conditions = run.output.conditions.map((c) => `${run.output.conditions.length > 1 ? `${c.name}: ` : ''}${c.scored} of ${run.output.variants} scored`).join('; ');
  const detail = `Scored ${run.inputs.source.name} (${run.id}): ${describeParameters(run.inputs.parameters, isBarcodeRun(run))}; ${conditions}; output SHA-256 ${run.output.sha256.slice(0, 12)}…`;
  return { ws: change(ws, { runs: [...ws.runs, run] }, 'score', detail), existing: false };
}

export function removeRun(ws, id) {
  const run = ws.runs.find((r) => r.id === id);
  if (!run) return ws;
  return change(ws, { runs: ws.runs.filter((r) => r.id !== id) }, 'remove-run', `Removed the score run ${run.name} (${run.id})`);
}

// Whether a run scored a table of barcodes.
export const isBarcodeRun = (run) => run.inputs.design.library?.level === 'barcode';

// One line of parameters, for lists and the history. barcodes: whether the table is of barcodes.
export function describeParameters(parameters, barcodes = false) {
  const p = withDefaults(parameters);
  const f = p.filters;
  const regression = p.model === 'wls' || p.model === 'ols';
  const bins = p.model === 'bins' || p.model === 'bins-mle';
  const parts = p.model === 'dimsum'
    ? [
      `DiMSum's fitness${p.dimsumNormalise ? ', replicates scaled and shifted' : ''}, ${p.dimsumErrorModel ? 'its error model' : 'counting error'}`,
      ...(p.dimsumDropout ? [`dropout pseudocount ${p.dimsumDropout}`] : []),
      p.combination === 'reml' ? 'REML' : p.combination === 'fixed' ? 'fixed effects' : p.combination === 'mean' ? 'mean of replicates' : 'Enrich2\'s estimator',
    ]
    : bins
    ? [
      p.model === 'bins' ? `weighted bin average, ${p.binSE === 'bootstrap' ? `bootstrap SE (${p.bootstrapSamples}, seed ${p.seed})` : 'analytic SE'}` : `maximum likelihood, σ ${p.binSigma === 'wild-type' ? 'the wild type\'s' : 'per variant'}`,
      p.binScale === 'none' ? 'unscaled' : p.binScale === 'nonsense-wt' ? 'nonsense 0, wild type 1' : 'lowest 5% 0, wild type 1',
      p.combination === 'reml' ? 'REML' : p.combination === 'fixed' ? 'fixed effects' : p.combination === 'mean' ? 'mean of replicates' : 'Enrich2\'s estimator',
    ]
    : [
      `${regression ? `${p.model.toUpperCase()} on time` : 'log ratio'}, ${p.normalization === 'wt' ? 'wild-type' : p.normalization === 'synonymous' ? 'synonymous-median' : `${p.normalization}-library`} normalization`,
      `pseudocount ${p.pseudocount}`,
      p.combination === 'reml' ? 'REML' : p.combination === 'fixed' ? 'fixed effects' : p.combination === 'mean' ? 'mean of replicates' : 'Enrich2\'s estimator',
    ];
  if (regression) {
    parts.push(p.regressionSE === 'residual' ? 'residual-scaled SE' : 'SE at least counting\'s');
    parts.push(f.minTimePoints === 'all' ? 'every time point' : `time points ≥ ${f.minTimePoints}`);
  }
  if (barcodes) {
    parts.unshift(p.aggregation === 'sum' ? 'barcodes summed' : `barcodes scored each, combined by ${p.barcodeCombination === 'reml' ? 'REML' : p.barcodeCombination === 'fixed' ? 'fixed effects' : 'their mean'}`);
    if (f.minBarcodes > 1) parts.push(`barcodes ≥ ${f.minBarcodes}`);
    if (f.maxBarcodeZ !== null) parts.push(`outlier barcodes (beyond ${f.maxBarcodeZ}) left out`);
  }
  if (f.minInputCount) parts.push(`input ≥ ${f.minInputCount}`);
  if (f.minTotalCount) parts.push(`total ≥ ${f.minTotalCount}`);
  if (f.minFrequency) parts.push(`bin frequency ≥ ${f.minFrequency.toPrecision(3)}`);
  if (f.minReplicates !== 1) parts.push(f.minReplicates === 'all' ? 'scored in every replicate' : `replicates ≥ ${f.minReplicates}`);
  if (f.maxSE !== null) parts.push(`SE ≤ ${f.maxSE}`);
  if (f.excludeKinds.length) parts.push(`without ${f.excludeKinds.join(', ')}`);
  if (f.exclude.length) parts.push(`${f.exclude.length} excluded`);
  if (p.rescale !== 'none') parts.push(`rescaled: ${RESCALINGS[p.rescale].label}`);
  return parts.join(', ');
}

// A regression's method in one sentence (also the methods paragraph's).
export function regressionSentence(p, citation) {
  const f = p.filters;
  return `Scores are the slopes of ${p.model === 'wls' ? 'a weighted' : 'an ordinary'} least-squares regression of each variant's natural-log count, normalized by the ${NORMALIZATIONS[p.normalization]}, on time scaled to 0–1 (${citation}), with a pseudocount of ${p.pseudocount}${p.model === 'wls' ? ' and weights 1/(1/(c + p) + 1/r) for a count c, the pseudocount p and the sample\'s normalizer r' : ''}; a variant was fitted on the time points where it was counted, ${f.minTimePoints === 'all' ? 'all of them required' : `its first and at least ${f.minTimePoints} in all`}; each replicate's SE is the slope's standard error scaled by the residuals${p.regressionSE === 'residual' ? '' : ', and never below what counting alone predicts'}.`;
}

// Sorted bins' method in one sentence (also the methods paragraph's).
export function binSentence(p, cite) {
  const scale = p.binScale === 'none' ? '' : p.binScale === 'nonsense-wt' ? '; each replicate was then scaled so that its median nonsense variant scores 0 and the wild type 1' : '; each replicate was then scaled so that the median of its lowest 5% of scores is 0 and the wild type 1';
  if (p.model === 'bins') return `Scores are the weighted average of the sorted bins' values over each variant's frequency in each bin (its reads over the bin's) (${cite.average}), with SEs ${p.binSE === 'bootstrap' ? `from a parametric bootstrap of the counts (${p.bootstrapSamples} samples, seed ${p.seed})` : 'from Poisson counting by the delta method'}, a pseudocount of ${p.pseudocount} in the SE${scale}.`;
  return `Scores are the maximum-likelihood mean μ of each variant's log fluorescence under a log-normal censored by the bins' gates (${cite.mle}), its reads reweighted by the cells sorted into each bin, with ${p.binSigma === 'wild-type' ? 'the spread σ fitted to the wild type and shared' : 'its own spread σ'} and SEs from the observed information${scale}.`;
}

// A table of barcodes' aggregation in a sentence or two (also the methods paragraph's). cite: {
// enrich2, dmsVariants }.
export function barcodeSentence(p, cite) {
  const f = p.filters;
  const outliers = f.maxBarcodeZ === null ? '' : ` Barcodes departing from their variant's other barcodes by more than ${f.maxBarcodeZ} were left out: a barcode's departure is its difference from the others' inverse-variance mean in units of their counting error together, over the square root of the replicate's median dispersion φ, and outliers were set aside one at a time.`;
  const minimum = f.minBarcodes > 1 ? ` A variant needed ${f.minBarcodes} barcodes measured in a replicate.` : '';
  if (p.aggregation === 'sum') return `The counts of each variant's barcodes were summed in each sample before scoring (${cite.enrich2}).${outliers}${minimum}`;
  return `Each barcode was scored on its own, against its replicate's normalizers from the summed counts (as dms_variants' func_scores by barcode, ${cite.dmsVariants}), and a variant's barcodes were combined within each replicate by ${BARCODE_COMBINATIONS[p.barcodeCombination]}${p.barcodeCombination === 'reml' ? ', the variance between barcodes estimated as between replicates' : ''}.${outliers}${minimum}`;
}

// DiMSum's method in a sentence or two (also the methods paragraph's).
export function dimsumSentence(p, cite) {
  const fitted = p.dimsumErrorModel ? ` Each replicate's SE is DiMSum's error model, σ² = a·(m_in/N_in + m_out/N_out) + e, with a multiplicative term m ≥ 1 for each input and output and an additive term e ≥ 10⁻⁴ per replicate, fitted by weighted least squares to the variance of each variant's normalised fitness over every subset of two or more replicates (on every variant at once; 10th–90th percentiles from ${p.bootstrapSamples} bootstrap samples, seed ${p.seed}), where DiMSum takes the mean of 100 bootstrap fits.` : ' Each replicate\'s SE is the square root of the four reciprocal counts.';
  return `Scores are DiMSum's fitness (${cite}): the natural-log ratio of each variant's counts after to before selection less the wild type's, with no pseudocount, so that a zero count gives no score${p.dimsumDropout ? `, but for outputs of 0 raised by a dropout pseudocount of ${p.dimsumDropout}` : ''}.${p.dimsumNormalise ? ' Each replicate was scaled and shifted to agree with the others (minimising the sum over variants of the distance between the replicates\' fitness and their mean, the first replicate\'s scale 1), the wild type then 0.' : ''}${fitted}`;
}

// The run's method in sentences (the methods paragraph of slice 8 builds on it).
export function describeMethod(run) {
  const p = withDefaults(run.inputs.parameters);
  const design = run.inputs.design;
  const lines = [];
  if (p.model === 'dimsum') lines.push(dimsumSentence(p, 'Faure et al. 2020'));
  else if (p.model === 'ratio') lines.push(`Scores are natural-log ratios of each variant's frequency after selection to before${design.model === 'time-series' ? ' (the first and last time points)' : ''}, normalized by the ${NORMALIZATIONS[p.normalization]}, with a pseudocount of ${p.pseudocount}; each replicate's SE is the square root of the sum of the reciprocal counts${p.normalization === 'synonymous' ? '' : ' and normalizers'} (Rubin et al. 2017).`);
  else if (p.model === 'wls' || p.model === 'ols') lines.push(regressionSentence(p, 'Rubin et al. 2017'));
  else lines.push(binSentence(p, { average: 'Matreyek et al. 2018', mle: 'Peterman and Levine 2016' }));
  if (design.library?.level === 'barcode') lines.push(barcodeSentence(p, { enrich2: 'Rubin et al. 2017', dmsVariants: 'the Bloom lab\'s dms_variants' }));
  lines.push(`Biological replicates were scored separately and combined by ${COMBINATIONS[p.combination]}${p.combination === 'enrich2' ? ' (Enrich2 2.0.2\'s random-effects estimator, 50 iterations)' : p.combination === 'reml' ? ' (Fisher scoring as metafor\'s REML)' : ''}; technical replicates were summed before scoring.`);
  lines.push(`Filters, in order: ${describeFilters(p.filters, null, p.model === 'wls' || p.model === 'ols', design.library?.level === 'barcode').filter((x) => x.active !== false).map((x) => x.text.toLowerCase()).join('; ')}.`);
  if (p.rescale !== 'none') lines.push(`Scores were rescaled so that ${RESCALINGS[p.rescale].label}.`);
  lines.push(`MaveScape ${run.software.version}${run.software.commit ? ` (${run.software.commit.slice(0, 7)})` : ''}, scoring version ${run.software.scoring}; run ${run.id}, output SHA-256 ${run.output.sha256}.`);
  return lines;
}
