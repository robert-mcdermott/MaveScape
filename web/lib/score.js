// The scoring pipeline (requirements S1–S5, S11): counts and a design in, scores with standard
// errors out, every variant accounted for. Pure: the score worker runs it, and the validation
// suite `scoring` runs it in Node.
//
//   names, count columns ─ variants.js (keys, kinds, validity against the target); for a table of
//       barcodes, the barcodes grouped by variant (score-barcodes.js)
//     ─ technical replicates summed per sample (replicates.js, poolColumns); a barcode table's
//       counts summed per variant, and every barcode scored, compared with its variant's others
//       and, when they disagree beyond the filter, left out; a variant's score from its summed
//       counts, or its barcodes' scores combined
//     ─ per biological replicate: normalizers, and log ratios (score-ratio.js) or the slope of a
//       regression on time (score-regression.js); or for sorted bins, the weighted average of the
//       bins' values or the maximum-likelihood fit, scaled (score-bins.js); and whether each
//       variant's measurement is used (filters.js: counted, time points, counts, bin frequency)
//     ─ per condition: variant-level stages (identifier, class, exclusions, usable replicates),
//       the replicates combined (replicates.js) with heterogeneity and leave-one-out sensitivity
//     ─ rescaling (S11) ─ the maximum-SE stage ─ the filter flow, run warnings.
//
// A run that cannot be done as asked (the design invalid; its reference class absent; a
// rescaling anchor missing) is refused with the reasons, never quietly done another way.

import { buildVariants, duplicateKeys, KIND, STATUS } from './variants.js';
import { replicateSamples, sharedSamples, validateDesign } from './design.js';
import { parseHgvs } from './hgvs.js';
import { median, normalizers, ratioScores, NORMALIZATIONS } from './score-ratio.js';
import { MODELS as TIME_MODELS, REGRESSION_SE, regressionScores } from './score-regression.js';
import { BIN_SCALES, BIN_SE, BIN_SIGMA, binAverages, binMLEScores, binTotals, scaleAnchors } from './score-bins.js';
import { AGGREGATIONS, BARCODE_COMBINATIONS, OUTLIER_Z, barcodeDisagreement, barcodeProblems, combineBarcodes, groupBarcodes, sumByVariant } from './score-barcodes.js';
import { createRandom } from './random.js';
import { combine, COMBINATIONS, heterogeneity, leaveOneOut, sampleCounts } from './replicates.js';
import {
  checkFilters, DEFAULT_FILTERS, FLAG, filterFlow, kindCodes, REPLICATE_STATE, replicateState, STAGE_BY_ID, variantStage,
} from './filters.js';

// The scoring engine's version, recorded in every run. 2 (MaveScape 0.2.0): logarithms from
// dmath.js, the same in every browser; 1 (0.1.0) used the browser's own Math.log, whose last bit
// varies between engines, so its runs reproduce only in the browser that scored them.
export const SCORING_VERSION = '2';

export const RESCALINGS = {
  none: { label: 'none (scores as computed)', anchors: null },
  'nonsense-wt': { label: 'nonsense median 0, wild type 1', anchors: [['nonsense', 0], ['wild type', 1]] },
  'synonymous-nonsense': { label: 'synonymous median 0, nonsense median −1', anchors: [['synonymous', 0], ['nonsense', -1]] },
};

// How a run scores: the ratio or a regression on time (two populations, time series), or sorted
// bins' weighted average or maximum-likelihood fit.
export const MODELS = {
  ...TIME_MODELS,
  bins: 'weighted average of the bins\' values',
  'bins-mle': 'maximum likelihood (censored log-normal, from the gates)',
};
const BIN_MODELS = new Set(['bins', 'bins-mle']);

export const DEFAULT_PARAMETERS = {
  model: 'ratio',
  normalization: 'wt',
  pseudocount: 0.5,
  regressionSE: 'counting-floor',
  binScale: 'nonsense-wt',
  binSE: 'analytic',
  binSigma: 'wild-type',
  bootstrapSamples: 200,
  seed: 20261009,
  aggregation: 'sum',
  barcodeCombination: 'reml',
  combination: 'reml',
  rescale: 'none',
  filters: DEFAULT_FILTERS,
};

// Named sets of parameters. "Enrich2-compatible" reproduces Enrich2 2.0.2's "ratios", "WLS" and
// "OLS" with its random-effects estimator: no count filter, every time point required, the SE of a
// regression scaled by its residuals alone, variants combined only when scored in every
// replicate, the wild type 0 ± 0. A preset keeps the model and normalization chosen.
// "VAMP-seq" reproduces Matreyek et al. 2018's scoring of sorted bins: the weighted average scaled
// to nonsense 0 and wild type 1 per replicate, variants below a summed bin frequency of 10^-4.75 left
// out, variants seen in two or more replicates, combined by their mean with SE = SD/√k.
export const PRESETS = {
  mavescape: { label: 'MaveScape defaults', parameters: DEFAULT_PARAMETERS },
  enrich2: {
    label: 'Enrich2-compatible',
    parameters: { ...DEFAULT_PARAMETERS, regressionSE: 'residual', combination: 'enrich2', filters: { ...DEFAULT_FILTERS, minInputCount: 0, minTimePoints: 'all', minReplicates: 'all' } },
  },
  vampseq: {
    label: 'VAMP-seq',
    bins: true,
    parameters: { ...DEFAULT_PARAMETERS, model: 'bins', binScale: 'nonsense-wt', binSE: 'analytic', combination: 'mean', filters: { ...DEFAULT_FILTERS, minInputCount: 0, minFrequency: 1.7782794100389228e-5 /* 10^-4.75 */, minReplicates: 2 } },
  },
};

// The parameters to start from for a design and its table: the wild type's normalization when the
// table counts it (else complete cases), and for a time series of three or more time points in
// every replicate, weighted regression.
// For sorted bins: the weighted average, scaled to nonsense 0 and wild type 1 when the table has
// nonsense variants (else to the lowest 5%).
export function defaultParameters(design, source = null, preset = 'mavescape') {
  const hasWildType = source ? (source.summary?.byKind?.['wild type'] ?? 0) > 0 : true;
  if (design?.model === 'bins') {
    const hasNonsense = source ? (source.summary?.byKind?.nonsense ?? 0) > 0 : true;
    const base = PRESETS[preset].bins ? PRESETS[preset].parameters : { ...PRESETS[preset].parameters, model: 'bins' };
    return withDefaults({ ...base, binScale: base.binScale === 'nonsense-wt' && !hasNonsense ? 'low5-wt' : base.binScale });
  }
  const model = design?.model === 'time-series' && design.replicates?.length && design.replicates.every((r) => orderedSlots(r).length >= 3) ? 'wls' : 'ratio';
  return withDefaults({ ...PRESETS[preset].parameters, model, normalization: hasWildType ? 'wt' : 'complete' });
}

export function withDefaults(parameters = {}) {
  return { ...DEFAULT_PARAMETERS, ...parameters, filters: { ...DEFAULT_FILTERS, ...(parameters.filters ?? {}) } };
}

// Checks parameters against the design: { errors: [], warnings: [] } (messages).
export function checkParameters(parameters, design) {
  const p = withDefaults(parameters);
  const errors = [];
  if (!MODELS[p.model]) errors.push(`Unknown scoring model "${p.model}".`);
  if (!REGRESSION_SE[p.regressionSE]) errors.push(`Unknown standard error "${p.regressionSE}" for a regression.`);
  if (!BIN_SCALES[p.binScale]) errors.push(`Unknown scale "${p.binScale}" for sorted bins.`);
  if (!BIN_SE[p.binSE]) errors.push(`Unknown standard error "${p.binSE}" for sorted bins.`);
  if (!BIN_SIGMA[p.binSigma]) errors.push(`Unknown spread "${p.binSigma}" for the maximum-likelihood fit.`);
  if (!(Number.isInteger(p.bootstrapSamples) && p.bootstrapSamples >= 20 && p.bootstrapSamples <= 100000)) errors.push('The bootstrap needs a whole number of samples, from 20 to 100,000.');
  if (!Number.isInteger(p.seed)) errors.push('The seed is a whole number.');
  if (!NORMALIZATIONS[p.normalization]) errors.push(`Unknown normalization "${p.normalization}".`);
  if (!AGGREGATIONS[p.aggregation]) errors.push(`Unknown aggregation of barcodes "${p.aggregation}".`);
  if (!BARCODE_COMBINATIONS[p.barcodeCombination]) errors.push(`Unknown combination of barcodes "${p.barcodeCombination}".`);
  if (!(Number.isFinite(p.pseudocount) && p.pseudocount >= 0)) errors.push('The pseudocount must be a number of 0 or more.');
  if (!COMBINATIONS[p.combination]) errors.push(`Unknown combination "${p.combination}".`);
  if (!RESCALINGS[p.rescale]) errors.push(`Unknown rescaling "${p.rescale}".`);
  errors.push(...checkFilters(p.filters));
  if (design) {
    if (design.model === 'bins' && !BIN_MODELS.has(p.model)) errors.push('Sorted bins are scored by the weighted average of their values or by the maximum-likelihood fit, not as a selection: choose one under "Scored by".');
    if (design.model !== 'bins' && BIN_MODELS.has(p.model)) errors.push(`${MODELS[p.model][0].toUpperCase()}${MODELS[p.model].slice(1)} scores sorted bins; this design is not one.`);
    if (design.model === 'bins' && p.model === 'bins-mle') {
      const ungated = (design.replicates ?? []).filter((r) => {
        const bins = [...(r.bins ?? [])].sort((a, b) => a.order - b.order);
        return bins.some((b, k) => (k > 0 && !(b.lower > 0)) || (k < bins.length - 1 && !(b.upper > 0)));
      });
      if (ungated.length) errors.push(`The maximum-likelihood fit needs each bin's gates, and ${ungated.map((r) => r.name ?? r.id).slice(0, 4).join(', ')} ${ungated.length > 1 ? 'lack' : 'lacks'} some: give them in the Experiment view, or score by the weighted average.`);
    }
    if (p.model === 'wls' || p.model === 'ols') {
      if (design.model !== 'time-series') errors.push(`A regression on time needs a time series; this design is ${design.model === 'two-population' ? 'a two-population experiment' : `of kind "${design.model}"`}: score it by the log ratio.`);
      else {
        const short = (design.replicates ?? []).filter((r) => orderedSlots(r).length < 3);
        if (short.length) errors.push(`A regression on time needs three or more time points in every replicate; ${short.map((r) => r.name ?? r.id).slice(0, 4).join(', ')} ${short.length > 1 ? 'have' : 'has'} fewer: score by the log ratio of the first and last samples.`);
      }
    }
    if (design.model === 'scores') errors.push('This design holds precomputed scores: there are no counts to score.');
    const barcodes = design.library?.level === 'barcode';
    if (p.aggregation === 'barcode' && !barcodes) errors.push('Scoring each barcode needs a table of barcodes; this table\'s rows are variants: sum (there is nothing to sum) or describe the barcodes in the Experiment view.');
    if (p.aggregation === 'barcode' && design.model === 'bins') errors.push('Sorted bins are scored from each variant\'s barcodes summed: a barcode\'s few cells spread over the bins give no estimate of their own. Choose "sum, then score".');
    if (p.filters.maxBarcodeZ !== null && barcodes && design.model === 'bins') errors.push('The barcode filter compares barcodes\' scores, and sorted bins score variants only: set no maximum departure.');
    if (p.combination === 'enrich2' && p.filters.minReplicates !== 'all') errors.push('Enrich2\'s estimator combines only variants scored in every replicate: set the minimum usable replicates to "all", or choose another combination.');
  }
  if (p.pseudocount === 0) errors.push('A pseudocount of 0 leaves every variant with a zero count unscorable (log 0); use a positive pseudocount.');
  return { errors, warnings: [] };
}

// The rows of the wild type, synonymous and nonsense controls, as the design names them ('auto':
// by kind). Returns { wt: row or -1, wtProblem, synonymous: [rows], nonsense: [rows] }.
export function controlRows(design, variants) {
  const controls = design.controls ?? {};
  const byName = (name) => {
    const parsed = parseHgvs(name, { mode: 'lenient' });
    const rows = [];
    for (let i = 0; i < variants.n; i += 1) if (variants.original[i] === name || (parsed.ok && variants.key[i] === parsed.canonical)) rows.push(i);
    return rows;
  };
  const kindRows = (kind) => {
    const rows = [];
    for (let i = 0; i < variants.n; i += 1) if (variants.kind[i] === kind && variants.status[i] !== STATUS.INVALID) rows.push(i);
    return rows;
  };
  const wtRows = !controls.wildType || controls.wildType === 'auto' ? kindRows(KIND.WT) : byName(controls.wildType);
  const list = (value, kind) => (value === 'none' ? [] : Array.isArray(value) ? [...new Set(value.flatMap(byName))] : kindRows(kind));
  return {
    wt: wtRows.length === 1 ? wtRows[0] : -1,
    wtProblem: wtRows.length > 1 ? `The wild type is on ${wtRows.length} rows; which one normalizes is ambiguous.` : null,
    synonymous: list(controls.synonymous, KIND.SYNONYMOUS),
    nonsense: list(controls.nonsense, KIND.NONSENSE),
  };
}

// The samples of a replicate in scoring order: input then output, or time points by time.
function orderedSlots(replicate) {
  const parts = replicateSamples(replicate).filter((p) => p.role !== 'bin');
  return parts.map((p) => ({ ...p, time: p.role === 'input' ? 0 : p.role === 'output' ? 1 : p.time })).sort((a, b) => a.time - b.time);
}

// The bins of a replicate in order, with their values and gates.
function binSlots(replicate) {
  return [...(replicate.bins ?? [])].sort((a, b) => a.order - b.order);
}

// One replicate of sorted bins (score-bins.js): its variants' states, scores and SEs, scaled.
function scoreBinReplicate({ replicate, index, design, pooled, p, controls, n, warnings }) {
  const f = p.filters;
  const slots = binSlots(replicate);
  const samples = slots.map((x) => pooled.get(x.sample));
  const label = `replicate ${replicate.name ?? replicate.id}`;
  const B = samples.length;
  const totals = binTotals(samples);
  const counted = new Uint8Array(n);
  const state = new Uint8Array(n);
  const frequency = new Float64Array(n).fill(Number.NaN);
  for (let i = 0; i < n; i += 1) {
    let points = 0;
    let sum = 0;
    let freq = 0;
    for (let b = 0; b < B; b += 1) {
      const c = samples[b][i];
      if (Number.isNaN(c)) continue;
      points += 1;
      sum += c;
      freq += c / totals[b];
    }
    counted[i] = points === B ? 1 : 0;
    if (counted[i]) frequency[i] = freq;
    // The reads across the bins stand for the input's: a variant not seen in the sort is not measured.
    state[i] = replicateState(counted[i], sum, sum, f);
    if (state[i] === REPLICATE_STATE.USED && f.minFrequency > 0 && freq < f.minFrequency) state[i] = REPLICATE_STATE.LOW_FREQUENCY;
  }
  let scored;
  let sigma = null;
  if (p.model === 'bins') {
    scored = binAverages(samples, slots.map((x) => x.value), counted, { pseudocount: p.pseudocount, totals, se: p.binSE, samples: p.bootstrapSamples, random: p.binSE === 'bootstrap' ? createRandom(p.seed + index) : null });
  } else {
    const lower = slots.map((x) => x.lower ?? null);
    const upper = slots.map((x) => x.upper ?? null);
    const cellsOf = slots.map((x) => design.samples.find((s) => s.id === x.sample)?.cells);
    const cells = cellsOf.every((c) => c > 0) ? cellsOf : null;
    if (p.binSigma === 'wild-type') {
      if (controls.wt < 0 || !counted[controls.wt]) throw new Refused([`The maximum-likelihood fit with the wild type's spread needs the wild type counted in every bin of ${label}: fit each variant's own spread instead.`]);
      const only = new Uint8Array(n);
      only[controls.wt] = 1;
      const wt = binMLEScores(samples, lower, upper, cells, only, { sigma: null, totals });
      sigma = wt.sigma[controls.wt];
      if (!(sigma > 0)) throw new Refused([`The wild type's spread could not be fitted in ${label} (${wt.reason[controls.wt]}): fit each variant's own spread instead.`]);
    }
    scored = binMLEScores(samples, lower, upper, cells, counted, { sigma, totals });
    for (let i = 0; i < n; i += 1) if (counted[i] && scored.reason[i] && state[i] === REPLICATE_STATE.USED) state[i] = REPLICATE_STATE.NOT_ESTIMABLE;
  }
  // No reads in any bin (with no minimum count): nothing to estimate.
  for (let i = 0; i < n; i += 1) if (state[i] === REPLICATE_STATE.USED && !Number.isFinite(scored.score[i])) state[i] = REPLICATE_STATE.NOT_ESTIMABLE;
  // The replicate's scale (VAMP-seq: nonsense 0, wild type 1), from the variants used.
  let anchors = null;
  if (p.binScale !== 'none') {
    const used = Uint8Array.from(state, (x) => (x === REPLICATE_STATE.USED ? 1 : 0));
    try {
      anchors = scaleAnchors(p.binScale, scored.score, used, { wt: controls.wt, nonsense: controls.nonsense, label });
    } catch (error) {
      throw new Refused([error.message]);
    }
    const span = anchors.one - anchors.zero;
    for (let i = 0; i < n; i += 1) {
      scored.score[i] = (scored.score[i] - anchors.zero) / span;
      scored.se[i] /= Math.abs(span);
    }
  }
  for (const [b, s] of samples.entries()) {
    let reads = 0;
    let variantsCounted = 0;
    for (let i = 0; i < n; i += 1) {
      if (Number.isNaN(s[i])) continue;
      reads += s[i];
      variantsCounted += 1;
    }
    if (variantsCounted && reads / variantsCounted < 10) warnings.push({ code: 'low-depth', message: `Bin ${slots[b].order} (sample ${slots[b].sample}) of ${label} has ${reads} reads for ${variantsCounted} variants (${(reads / variantsCounted).toFixed(1)} per variant): its counts are mostly sampling noise.` });
  }
  return {
    id: replicate.id,
    name: replicate.name ?? replicate.id,
    biological: replicate.biological,
    condition: replicate.condition ?? null,
    tile: replicate.tile ?? null,
    samples: slots.map((x) => x.sample),
    times: [],
    normalizers: totals,
    synonymousMedian: undefined,
    first: samples[0],
    last: samples[B - 1],
    score: scored.score,
    se: scored.se,
    state,
    points: null,
    fit: null,
    // Sorted bins: each bin's value and gates, the variant's summed bin frequency, the fitted spread
    // (MLE; the wild type's when shared), and the scale's anchors.
    bins: { values: slots.map((x) => x.value), lower: slots.map((x) => x.lower ?? null), upper: slots.map((x) => x.upper ?? null), frequency, sigma: p.model === 'bins-mle' ? (sigma ?? null) : null, sigmas: scored.sigma ?? null, scale: anchors },
  };
}

// A barcode table's rows grouped by variant (score-barcodes.js), refused when a barcode is missing
// or written twice.
function barcodeGroups(names, barcodes, design, mode, target) {
  if (!barcodes || barcodes.length !== names.length) throw new Refused([`The design describes a table of barcodes, and the barcodes (column "${design.library.barcodeColumn}") were not given.`]);
  const problems = barcodeProblems(barcodes);
  if (problems.repeated.length) throw new Refused([`${problems.repeated.length} barcode${problems.repeated.length > 1 ? 's are' : ' is'} on more than one row (${problems.repeated.slice(0, 3).map((x) => x.id).join(', ')}): a barcode is counted once per sample; resolve them at import before scoring.`]);
  if (problems.blank.length) throw new Refused([`${problems.blank.length} row${problems.blank.length > 1 ? 's have' : ' has'} no barcode (the first is row ${problems.blank[0] + 1}).`]);
  return groupBarcodes(names, { level: design.variants.level, mode, target }, barcodes);
}

// The rows 0…n − 1 for which test(row) holds.
function rowsWhere(n, test) {
  const out = [];
  for (let i = 0; i < n; i += 1) if (test(i)) out.push(i);
  return out;
}

// Scored by barcode, each variant's state in a replicate from its barcodes': used with at least
// `minimum` measured; too few barcodes when fewer (outliers left out not counting); else the
// furthest any of its barcodes got (counted, then past the input count, then the total count).
const STATE_RANK = [5, 1, 3, 4, 2, 0, 0, 4.5];
function barcodeVariantStates(groups, barcodeState, measured, minimum) {
  const nv = groups.offsets.length - 1;
  const state = new Uint8Array(nv);
  for (let g = 0; g < nv; g += 1) {
    if (measured[g] >= minimum) {
      state[g] = REPLICATE_STATE.USED;
      continue;
    }
    let best = REPLICATE_STATE.NOT_COUNTED;
    for (let m = groups.offsets[g]; m < groups.offsets[g + 1]; m += 1) {
      const b = groups.members[m];
      const s = barcodeState[b] === REPLICATE_STATE.USED ? REPLICATE_STATE.FEW_BARCODES : barcodeState[b];
      if (STATE_RANK[s] > STATE_RANK[best]) best = s;
    }
    state[g] = best;
  }
  return state;
}

class Refused extends Error {
  constructor(errors) {
    super(errors.join(' '));
    this.errors = errors;
  }
}

// Scores an experiment. input: { names: [variant identifiers by row], columns: { name:
// Float64Array } (count columns, NaN where missing), design, mode ('lenient' | 'strict'),
// parameters, onProgress(fraction, message) }. Returns { ok: true, results } or { ok: false,
// errors }.
export function scoreExperiment(input) {
  try {
    return { ok: true, results: run(input) };
  } catch (error) {
    if (error instanceof Refused) return { ok: false, errors: error.errors };
    throw error;
  }
}

function run({ names, barcodes = null, columns, design, mode = 'lenient', parameters, onProgress = () => {} }) {
  const p = withDefaults(parameters);
  const f = p.filters;
  const checked = checkParameters(p, design);
  if (checked.errors.length) throw new Refused(checked.errors);
  // The design's structure; its columns against the table are checked where the table is known.
  const validation = validateDesign(design);
  if (!validation.ok) throw new Refused(validation.errors.map((e) => `The design: ${e.message}`));

  // A table of barcodes: its rows grouped by the variants they carry, each barcode on one row.
  const target = design.targets?.length === 1 ? design.targets[0] : undefined;
  const groups = design.library?.level === 'barcode' ? barcodeGroups(names, barcodes, design, mode, target) : null;
  const variants = groups ? groups.variants : buildVariants(names, { level: design.variants.level, mode, target });
  const n = variants.n;
  if (!groups) {
    const duplicates = duplicateKeys(variants);
    if (duplicates.length) throw new Refused([`${duplicates.length} variant${duplicates.length > 1 ? 's are' : ' is'} on more than one row (${duplicates.slice(0, 3).map((d) => d.key).join(', ')}): resolve them at import before scoring.`]);
  }
  const controls = controlRows(design, variants);
  const warnings = [];
  const info = [];
  if (p.normalization === 'wt' && controls.wtProblem) throw new Refused([controls.wtProblem]);

  // Samples: technical replicates summed; a barcode table's counts also summed per variant.
  const missingColumns = [];
  const pooledRows = new Map();
  for (const sample of design.samples) {
    const parts = sample.columns.map((c) => columns[c]);
    if (parts.some((c) => !c)) {
      missingColumns.push(...sample.columns.filter((c) => !columns[c]));
      continue;
    }
    pooledRows.set(sample.id, sampleCounts(sample, parts));
    if (sample.columns.length > 1) info.push(`Technical replicates summed: ${sample.name ?? sample.id} is ${sample.columns.join(' + ')} (one library sequenced more than once; not an independent replicate).`);
    if (sample.missingMeansZero) info.push(`Missing counts read as 0 in ${sample.name ?? sample.id}, as the design says (a table that writes variants that dropped out as missing).`);
  }
  if (missingColumns.length) throw new Refused([`The count table has no column ${missingColumns.map((c) => `"${c}"`).join(', ')}.`]);
  const pooled = groups ? new Map([...pooledRows].map(([id, counts]) => [id, sumByVariant(counts, groups)])) : pooledRows;
  if (groups) {
    if (groups.unmapped) warnings.push({ code: 'unmapped-barcodes', message: `${groups.unmapped} barcode${groups.unmapped > 1 ? 's name' : ' names'} no variant (not in the barcode map, or given two variants by it): not scored.` });
    if (groups.rewritten) info.push(`${groups.rewritten} variant${groups.rewritten > 1 ? 's are' : ' is'} written in more than one way across ${groups.rewritten > 1 ? 'their' : 'its'} barcodes (A12V and p.Ala12Val): grouped as one, named as first written.`);
  }

  // Per biological replicate: counted rows, normalizers, log ratios, and each measurement's state.
  const replicates = [];
  const repById = new Map();
  const regression = p.model === 'wls' || p.model === 'ols';
  const sorted = BIN_MODELS.has(p.model);
  const synonymousRow = new Uint8Array(n);
  for (const i of controls.synonymous) synonymousRow[i] = 1;
  design.replicates.forEach((replicate, index) => {
    onProgress((index / design.replicates.length) * 0.6, `Scoring ${replicate.name ?? replicate.id}`);
    if (sorted) {
      const entry = scoreBinReplicate({ replicate, index, design, pooled, p, controls, n, warnings });
      if (groups) {
        // A variant's barcodes measured: those counted in every bin, with reads.
        const rows = binSlots(replicate).map((x) => pooledRows.get(x.sample));
        const measured = new Int32Array(n);
        for (let b = 0; b < groups.rows; b += 1) {
          const g = groups.variantOf[b];
          if (g < 0) continue;
          let reads = 0;
          let counted = true;
          for (const s of rows) {
            if (Number.isNaN(s[b])) counted = false;
            else reads += s[b];
          }
          if (counted && reads > 0) measured[g] += 1;
        }
        for (let i = 0; i < n; i += 1) if (entry.state[i] === REPLICATE_STATE.USED && measured[i] < f.minBarcodes) entry.state[i] = REPLICATE_STATE.FEW_BARCODES;
        entry.barcodes = { measured, score: null, se: null, state: null, z: null, phi: Number.NaN, compared: 0, outlier: null, outliers: 0, excluded: 0, limit: null, tau2: null };
      }
      replicates.push(entry);
      repById.set(replicate.id, entry);
      return;
    }
    const slots = orderedSlots(replicate);
    const label = `replicate ${replicate.name ?? replicate.id}`;
    const T = slots.length;
    const times = slots.map((s) => s.time);
    // A regression fits a variant on the time points where it was counted: its first and at least
    // `need` in all. A ratio needs every sample.
    const need = regression ? (f.minTimePoints === 'all' ? T : Math.min(f.minTimePoints, T)) : T;
    // Which rows (variants, or barcodes) a replicate's samples count, and whether each is used;
    // and the replicate's normalizers, from variants' counts (given for barcodes).
    const measure = (samples, given = null) => {
      const m = samples[0].length;
      const counted = new Uint8Array(m);
      const usable = new Uint8Array(m);
      const state = new Uint8Array(m);
      for (let i = 0; i < m; i += 1) {
        let points = 0;
        let sum = 0;
        for (const s of samples) {
          if (Number.isNaN(s[i])) continue;
          points += 1;
          sum += s[i];
        }
        const first = !Number.isNaN(samples[0][i]);
        counted[i] = points === T ? 1 : 0;
        usable[i] = first && points >= need ? 1 : 0;
        state[i] = replicateState(usable[i], samples[0][i], sum, f, regression && first && points > 1 && points < need);
      }
      if (given) return { counted, usable, state, r: given };
      try {
        return { counted, usable, state, r: normalizers(p.normalization, samples, counted, { pseudocount: p.pseudocount, wtRow: controls.wt, label }) };
      } catch (error) {
        throw new Refused([error.message]);
      }
    };
    const scoreRows = (samples, m, reference) => {
      try {
        return regression
          ? regressionScores(samples, times, m.r, m.usable, { weighted: p.model === 'wls', pseudocount: p.pseudocount, method: p.normalization, se: p.regressionSE, reference, label })
          : ratioScores(p.normalization, samples, m.counted, m.r, { pseudocount: p.pseudocount, reference, label });
      } catch (error) {
        throw new Refused([error.message]);
      }
    };
    let samples = slots.map((s) => pooled.get(s.sample));
    let m = measure(samples);
    let scored = null;
    let bc = null;
    if (groups) {
      // Every barcode scored against the replicate's normalizers, and compared with its variant's
      // other barcodes.
      const rows = slots.map((s) => pooledRows.get(s.sample));
      const mb = measure(rows, m.r);
      for (let b = 0; b < groups.rows; b += 1) {
        if (groups.variantOf[b] >= 0) continue;
        mb.counted[b] = 0;
        mb.usable[b] = 0;
        mb.state[b] = REPLICATE_STATE.NOT_COUNTED;
      }
      const reference = p.normalization === 'synonymous' ? rowsWhere(groups.rows, (b) => synonymousRow[groups.variantOf[b]] && mb.state[b] === REPLICATE_STATE.USED) : null;
      const sb = scoreRows(rows, mb, reference);
      const used = Uint8Array.from(mb.state, (s) => (s === REPLICATE_STATE.USED ? 1 : 0));
      // Outliers: beyond the filter's maximum departure, and then left out; else beyond 4, and only
      // reported.
      const d = barcodeDisagreement(sb.score, sb.se, used, groups, f.maxBarcodeZ ?? OUTLIER_Z);
      const filtering = f.maxBarcodeZ !== null;
      const outlier = filtering ? d.outlier : new Uint8Array(groups.rows);
      const outliers = filtering ? d.outliers : 0;
      if (filtering) for (let b = 0; b < groups.rows; b += 1) if (outlier[b]) used[b] = 0;
      const measured = new Int32Array(n);
      for (let b = 0; b < groups.rows; b += 1) if (used[b]) measured[groups.variantOf[b]] += 1;
      bc = { score: sb.score, se: sb.se, state: mb.state, z: d.z, phi: d.phi, compared: d.compared, outlier: d.outlier, outliers: d.outliers, excluded: outliers, limit: f.maxBarcodeZ ?? OUTLIER_Z, measured, tau2: null };
      if (outliers) info.push(`${outliers} barcode${outliers > 1 ? 's' : ''} of ${label} departing from ${outliers > 1 ? 'their' : 'its'} variant's others by more than ${f.maxBarcodeZ} (z/√φ, φ = ${d.phi.toFixed(2)}) left out.`);
      if (p.aggregation === 'sum') {
        if (outliers) {
          samples = slots.map((s) => sumByVariant(pooledRows.get(s.sample), groups, outlier));
          m = measure(samples);
        }
        for (let i = 0; i < n; i += 1) if (m.state[i] === REPLICATE_STATE.USED && measured[i] < f.minBarcodes) m.state[i] = REPLICATE_STATE.FEW_BARCODES;
      } else {
        const c = combineBarcodes(p.barcodeCombination, sb.score, sb.se, used, groups);
        scored = { score: c.score, se: c.se };
        bc.tau2 = c.tau2;
        m.state = barcodeVariantStates(groups, mb.state, measured, f.minBarcodes);
        if (p.normalization === 'synonymous') {
          // Synonymous variants center on 0, as when scored from their sums.
          const values = rowsWhere(n, (i) => synonymousRow[i] && m.state[i] === REPLICATE_STATE.USED).map((i) => c.score[i]);
          if (!values.length) throw new Refused([`No synonymous variant is scored in ${label}: synonymous normalization is not available there.`]);
          const shift = median(values);
          for (let i = 0; i < n; i += 1) c.score[i] -= shift;
          for (let b = 0; b < groups.rows; b += 1) sb.score[b] -= shift;
          scored.median = (sb.median ?? 0) + shift;
          scored.references = values.length;
        }
      }
    }
    if (!scored) scored = scoreRows(samples, m, p.normalization === 'synonymous' ? controls.synonymous.filter((i) => m.state[i] === REPLICATE_STATE.USED) : null);
    const r = m.r;
    const state = m.state;
    if (p.normalization === 'synonymous' && scored.references < 10) warnings.push({ code: 'few-synonymous', message: `Only ${scored.references} synonymous variant${scored.references === 1 ? '' : 's'} set the center of ${label}: its normalization is uncertain.` });
    if (p.normalization === 'wt') {
      for (const [j, s] of [samples[0], samples[samples.length - 1]].entries()) {
        if (s[controls.wt] < 100) warnings.push({ code: 'low-wild-type', message: `The wild type has ${s[controls.wt]} reads in the ${j ? 'last' : 'first'} sample of ${label}: every score of the replicate is normalized to it.` });
      }
    }
    // Depth: reads per counted variant in each sample.
    for (const [j, s] of samples.entries()) {
      let reads = 0;
      let variantsCounted = 0;
      for (let i = 0; i < n; i += 1) {
        if (Number.isNaN(s[i])) continue;
        reads += s[i];
        variantsCounted += 1;
      }
      if (variantsCounted && reads / variantsCounted < 10) warnings.push({ code: 'low-depth', message: `Sample ${slots[j].sample} of ${label} has ${reads} reads for ${variantsCounted} variants (${(reads / variantsCounted).toFixed(1)} per variant): its counts are mostly sampling noise.` });
    }
    const byBarcode = groups && p.aggregation === 'barcode';
    const entry = {
      id: replicate.id,
      name: replicate.name ?? replicate.id,
      biological: replicate.biological,
      condition: replicate.condition ?? null,
      tile: replicate.tile ?? null,
      samples: slots.map((s) => s.sample),
      times,
      normalizers: r,
      synonymousMedian: scored.median,
      first: samples[0],
      last: samples[samples.length - 1],
      score: scored.score,
      se: scored.se,
      state,
      // A regression's time points used and its departure from a line against counting noise
      // (χ²/(n − 2)), per variant (per barcode, in bc, when barcodes are scored each).
      points: byBarcode ? null : scored.points ?? null,
      fit: byBarcode ? null : scored.fit ?? null,
      // A barcode table: each barcode's score, SE, state, departure from its variant's others (z,
      // over √φ) and whether it is an outlier (beyond `limit`; `excluded` of them left out, when the
      // filter is on); φ; each variant's barcodes measured; and, scored by barcode, the variance
      // between a variant's barcodes (τ²).
      barcodes: bc,
    };
    replicates.push(entry);
    repById.set(replicate.id, entry);
  });

  // A table of barcodes: how many measure a variant in a replicate.
  if (groups) {
    const perReplicate = replicates.map((r) => {
      let variantsMeasured = 0;
      let barcodes = 0;
      for (const k of r.barcodes.measured) {
        if (!k) continue;
        variantsMeasured += 1;
        barcodes += k;
      }
      return variantsMeasured ? barcodes / variantsMeasured : 0;
    });
    const mean = perReplicate.reduce((a, x) => a + x, 0) / Math.max(1, perReplicate.length);
    info.push(`${groups.rows - groups.unmapped} barcodes of ${n} variants, ${mean.toFixed(1)} measuring a variant in a replicate on average; ${p.aggregation === 'sum' ? 'their counts summed per variant before scoring' : `each scored, then combined per variant by ${BARCODE_COMBINATIONS[p.barcodeCombination]}`}.`);
  }

  // Run-level notes on the design.
  if (design.model === 'time-series' && !regression) warnings.push({ code: 'time-series-ratio', message: 'A time series scored by the ratio of its first and last time points (as Enrich2\'s "ratios"): the time points between them are not used. Weighted regression uses every one.' });
  const shared = sharedSamples(design);
  if (shared.size) warnings.push({ code: 'shared-samples', message: `${shared.size} sample${shared.size > 1 ? 's are' : ' is'} shared between replicates (${[...shared.keys()].join(', ')}): those replicates' scores are not independent, so the combined SE is likely too small.` });

  // Per condition.
  const conditionList = design.conditions?.length ? design.conditions : [{ id: 'all', name: 'All replicates' }];
  const excludeKinds = kindCodes(f.excludeKinds);
  const excluded = new Set(f.exclude);
  const tiles = new Map((design.library?.tiles ?? []).map((t) => [t.id, t]));
  const conditions = [];
  conditionList.forEach((condition, ci) => {
    onProgress(0.6 + (ci / conditionList.length) * 0.35, `Combining replicates${conditionList.length > 1 ? ` of ${condition.name}` : ''}`);
    const reps = replicates.filter((r) => (design.conditions?.length ? r.condition === condition.id : true));
    const K = reps.length;
    const pointCounts = new Set(reps.map((r) => r.samples.length));
    if (pointCounts.size > 1) warnings.push({ code: 'mixed-replicates', message: `Replicates${conditionList.length > 1 ? ` of ${condition.name}` : ''} have different numbers of samples (${[...pointCounts].sort((a, b) => a - b).join(' and ')}): combining them assumes they measure one thing. If they are different assays or selections, give them different conditions in the Experiment view.` });
    const score = new Float64Array(n).fill(Number.NaN);
    const se = new Float64Array(n).fill(Number.NaN);
    const tau2 = new Float64Array(n).fill(Number.NaN);
    const i2 = new Float64Array(n).fill(Number.NaN);
    const q = new Float64Array(n).fill(Number.NaN);
    const loo = new Float64Array(n).fill(Number.NaN);
    const looReplicate = new Int16Array(n).fill(-1);
    const epsilon = p.combination === 'enrich2' ? new Float64Array(n).fill(Number.NaN) : null;
    const k = new Uint8Array(n);
    const expected = new Uint8Array(n);
    const reason = new Uint8Array(n);
    const flags = new Uint8Array(n);
    // Which replicates measure a row: those of its tile (all, without tiles or a position).
    const coversRow = (rep, i) => {
      const tile = rep.tile ? tiles.get(rep.tile) : null;
      const position = variants.position[i];
      return !tile || position < 1 || (position >= tile.start && position <= tile.end);
    };
    const minimum = (i) => (f.minReplicates === 'all' ? Math.max(1, expected[i]) : f.minReplicates);
    // Stages before combination.
    const used = new Array(n);
    let combinedFromAll = 0;
    for (let i = 0; i < n; i += 1) {
      const these = [];
      let anyCounted = false;
      let anyPastInput = false;
      let anyFewBarcodes = false;
      let exp = 0;
      for (const rep of reps) {
        if (coversRow(rep, i)) exp += 1;
        const s = rep.state[i];
        if (s !== REPLICATE_STATE.NOT_COUNTED && s !== REPLICATE_STATE.FEW_POINTS && s !== REPLICATE_STATE.NOT_ESTIMABLE) anyCounted = true;
        if (s === REPLICATE_STATE.USED || s === REPLICATE_STATE.TOTAL_COUNT || s === REPLICATE_STATE.LOW_FREQUENCY || s === REPLICATE_STATE.FEW_BARCODES) anyPastInput = true;
        if (s === REPLICATE_STATE.FEW_BARCODES) anyFewBarcodes = true;
        if (s === REPLICATE_STATE.USED) these.push(rep);
      }
      expected[i] = exp;
      k[i] = these.length;
      // The first stage, in order, that leaves the variant out.
      const stage = variantStage(i, variants, excludeKinds, excluded);
      if (!anyCounted) reason[i] = STAGE_BY_ID.get('measured').code;
      else if (stage) reason[i] = stage;
      else if (!these.length) reason[i] = STAGE_BY_ID.get(anyFewBarcodes ? 'barcodes' : anyPastInput ? 'total-count' : 'input-count').code;
      else if (these.length < minimum(i)) reason[i] = STAGE_BY_ID.get('replicates').code;
      used[i] = reason[i] ? null : these;
      if (!reason[i] && these.length === K) combinedFromAll += 1;
    }
    // Combination.
    let notConverged = 0;
    let notConvergedEnrich2 = 0;
    for (let i = 0; i < n; i += 1) {
      const these = used[i];
      if (!these) continue;
      const y = these.map((rep) => rep.score[i]);
      const v = these.map((rep) => rep.se[i] * rep.se[i]);
      if (p.combination === 'enrich2' && p.normalization === 'wt' && i === controls.wt) {
        // Enrich2 sets the wild type to 0 ± 0 in wild-type normalization.
        score[i] = 0;
        se[i] = 0;
        epsilon[i] = 0;
      } else {
        const c = combine(p.combination, y, v, combinedFromAll);
        score[i] = c.estimate;
        se[i] = c.se;
        tau2[i] = c.tau2;
        if (c.converged === false) notConverged += 1;
        if (epsilon) {
          epsilon[i] = c.epsilon;
          if (c.epsilon > 1e-8 * Math.max(1, c.tau2)) notConvergedEnrich2 += 1;
        }
      }
      const h = heterogeneity(y, v);
      q[i] = h.q;
      i2[i] = h.i2;
      const l = leaveOneOut(p.combination, y, v, score[i]);
      loo[i] = l.shift;
      looReplicate[i] = l.which >= 0 ? reps.indexOf(these[l.which]) : -1;
      let bits = 0;
      if (!sorted) {
        for (const rep of these) {
          if (rep.last[i] === 0) bits |= FLAG.OUTPUT_ZERO;
          if (rep.first[i] === 0) bits |= FLAG.INPUT_ZERO;
        }
      }
      if (these.length < expected[i]) bits |= FLAG.FEWER_REPLICATES;
      if (regression && these.some((rep) => rep.points && rep.points[i] < rep.times.length)) bits |= FLAG.FEWER_POINTS;
      flags[i] = bits;
    }
    if (notConverged) warnings.push({ code: 'reml-not-converged', message: `REML did not converge for ${notConverged} variant${notConverged > 1 ? 's' : ''}${conditionList.length > 1 ? ` of ${condition.name}` : ''}.` });
    if (notConvergedEnrich2) warnings.push({ code: 'enrich2-not-converged', message: `Enrich2's estimator had not converged after its 50 iterations for ${notConvergedEnrich2} variant${notConvergedEnrich2 > 1 ? 's' : ''}${conditionList.length > 1 ? ` of ${condition.name}` : ''} (as in Enrich2: its start depends on the number of variants); REML runs to convergence.` });
    if (K === 1) warnings.push({ code: 'one-replicate', message: `${conditionList.length > 1 ? `${condition.name} has` : 'The experiment has'} one replicate: the SEs are counting error only, with nothing of the variation between replicates.` });

    // Rescaling (S11): anchors from the scored variants, before the SE stage.
    let rescale = null;
    const preset = RESCALINGS[p.rescale];
    if (preset.anchors) {
      const anchorValue = ([what]) => {
        if (what === 'wild type') {
          if (controls.wt < 0 || reason[controls.wt]) throw new Refused([`Rescaling to the wild type needs the wild type scored${conditionList.length > 1 ? ` in ${condition.name}` : ''}; it is not.`]);
          return score[controls.wt];
        }
        const rows = (what === 'nonsense' ? controls.nonsense : controls.synonymous).filter((i) => !reason[i]);
        if (!rows.length) throw new Refused([`Rescaling needs scored ${what} variants${conditionList.length > 1 ? ` in ${condition.name}` : ''}, and there are none: choose another rescaling.`]);
        return median(rows.map((i) => score[i]));
      };
      const [a, b] = preset.anchors;
      const from = [anchorValue(a), anchorValue(b)];
      if (!(Math.abs(from[1] - from[0]) > 0)) throw new Refused([`The rescaling anchors (${a[0]} and ${b[0]}) have the same score: scores cannot be rescaled by them.`]);
      const slope = (b[1] - a[1]) / (from[1] - from[0]);
      for (let i = 0; i < n; i += 1) {
        if (reason[i]) continue;
        score[i] = a[1] + (score[i] - from[0]) * slope;
        se[i] *= Math.abs(slope);
        loo[i] *= Math.abs(slope);
        tau2[i] *= slope * slope;
      }
      rescale = { method: p.rescale, anchors: [{ what: a[0], from: from[0], to: a[1] }, { what: b[0], from: from[1], to: b[1] }], slope };
    }

    // The last stage: maximum SE.
    if (f.maxSE !== null) for (let i = 0; i < n; i += 1) if (!reason[i] && !(se[i] <= f.maxSE)) reason[i] = STAGE_BY_ID.get('se').code;
    const scoredCount = reason.reduce((a, r) => a + (r ? 0 : 1), 0);
    conditions.push({
      id: condition.id,
      name: condition.name,
      replicates: reps.map((r) => r.id),
      score, se, tau2, i2, q, loo, looReplicate, epsilon, k, expected, reason, flags,
      rescale,
      flow: filterFlow(reason, Boolean(groups)),
      scored: scoredCount,
      combinedFromAll,
    });
  });

  const replicateMeasurementsDropped = replicates.reduce((a, r) => a + r.state.reduce((x, s) => x + (s === REPLICATE_STATE.INPUT_COUNT || s === REPLICATE_STATE.TOTAL_COUNT ? 1 : 0), 0), 0);
  if (replicateMeasurementsDropped) info.push(`${replicateMeasurementsDropped} replicate measurement${replicateMeasurementsDropped > 1 ? 's' : ''} below the count minimums not used (the variants' other replicates still count).`);
  onProgress(1, 'Done');
  return {
    format: 'mavescape-scores',
    version: 1,
    rows: n,
    variants: { key: variants.key, original: variants.original, kind: variants.kind, position: variants.position, ref: variants.ref, alt: variants.alt, status: variants.status },
    controls: { wt: controls.wt, synonymous: controls.synonymous.length, nonsense: controls.nonsense.length },
    parameters: p,
    replicates,
    conditions,
    // Each sample's counts (technical replicates summed; a barcode table's summed per variant), for
    // the inspector.
    samples: design.samples.filter((x) => pooled.has(x.id)).map((x) => ({ id: x.id, name: x.name ?? x.id, columns: x.columns, counts: pooled.get(x.id), barcodeCounts: groups ? pooledRows.get(x.id) : null })),
    // A barcode table: each barcode's identifier and variant (−1: none), the barcodes of each
    // variant (members, from offsets[i] to offsets[i + 1]), and those that name no variant.
    barcodes: groups ? { rows: groups.rows, ids: barcodes, variantOf: groups.variantOf, offsets: groups.offsets, members: groups.members, unmapped: groups.unmapped } : null,
    warnings,
    info,
  };
}
