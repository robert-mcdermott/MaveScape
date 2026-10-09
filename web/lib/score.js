// The scoring pipeline (requirements S1–S5, S11): counts and a design in, scores with standard
// errors out, every variant accounted for. Pure: the score worker runs it, and the validation
// suite `scoring` runs it in Node.
//
//   names, count columns ─ variants.js (keys, kinds, validity against the target)
//     ─ technical replicates summed per sample (replicates.js, poolColumns)
//     ─ per biological replicate: normalizers, and log ratios (score-ratio.js) or the slope of a
//       regression on time (score-regression.js), and whether each variant's measurement is used
//       (filters.js: counted, time points, input and total counts)
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
import { MODELS, REGRESSION_SE, regressionScores } from './score-regression.js';
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

export const DEFAULT_PARAMETERS = {
  model: 'ratio',
  normalization: 'wt',
  pseudocount: 0.5,
  regressionSE: 'counting-floor',
  combination: 'reml',
  rescale: 'none',
  filters: DEFAULT_FILTERS,
};

// Named sets of parameters. "Enrich2-compatible" reproduces Enrich2 2.0.2's "ratios", "WLS" and
// "OLS" with its random-effects estimator: no count filter, every time point required, the SE of a
// regression scaled by its residuals alone, variants combined only when scored in every
// replicate, the wild type 0 ± 0. A preset keeps the model and normalization chosen.
export const PRESETS = {
  mavescape: { label: 'MaveScape defaults', parameters: DEFAULT_PARAMETERS },
  enrich2: {
    label: 'Enrich2-compatible',
    parameters: { ...DEFAULT_PARAMETERS, regressionSE: 'residual', combination: 'enrich2', filters: { ...DEFAULT_FILTERS, minInputCount: 0, minTimePoints: 'all', minReplicates: 'all' } },
  },
};

// The parameters to start from for a design and its table: the wild type's normalization when the
// table counts it (else complete cases), and for a time series of three or more time points in
// every replicate, weighted regression.
export function defaultParameters(design, source = null, preset = 'mavescape') {
  const hasWildType = source ? (source.summary?.byKind?.['wild type'] ?? 0) > 0 : true;
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
  if (!NORMALIZATIONS[p.normalization]) errors.push(`Unknown normalization "${p.normalization}".`);
  if (!(Number.isFinite(p.pseudocount) && p.pseudocount >= 0)) errors.push('The pseudocount must be a number of 0 or more.');
  if (!COMBINATIONS[p.combination]) errors.push(`Unknown combination "${p.combination}".`);
  if (!RESCALINGS[p.rescale]) errors.push(`Unknown rescaling "${p.rescale}".`);
  errors.push(...checkFilters(p.filters));
  if (design) {
    if (design.model === 'bins') errors.push('FACS-bin experiments are scored from MaveScape 0.2.0 (weighted bin averages and the maximum-likelihood fit). This build scores two-population experiments and time series.');
    if (p.model !== 'ratio') {
      if (design.model !== 'time-series') errors.push(`A regression on time needs a time series; this design is ${design.model === 'two-population' ? 'a two-population experiment' : `of kind "${design.model}"`}: score it by the log ratio.`);
      else {
        const short = (design.replicates ?? []).filter((r) => orderedSlots(r).length < 3);
        if (short.length) errors.push(`A regression on time needs three or more time points in every replicate; ${short.map((r) => r.name ?? r.id).slice(0, 4).join(', ')} ${short.length > 1 ? 'have' : 'has'} fewer: score by the log ratio of the first and last samples.`);
      }
    }
    if (design.model === 'scores') errors.push('This design holds precomputed scores: there are no counts to score.');
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

function run({ names, columns, design, mode = 'lenient', parameters, onProgress = () => {} }) {
  const p = withDefaults(parameters);
  const f = p.filters;
  const checked = checkParameters(p, design);
  if (checked.errors.length) throw new Refused(checked.errors);
  // The design's structure; its columns against the table are checked where the table is known.
  const validation = validateDesign(design);
  if (!validation.ok) throw new Refused(validation.errors.map((e) => `The design: ${e.message}`));

  const n = names.length;
  const variants = buildVariants(names, { level: design.variants.level, mode, target: design.targets?.length === 1 ? design.targets[0] : undefined });
  const duplicates = duplicateKeys(variants);
  if (duplicates.length) throw new Refused([`${duplicates.length} variant${duplicates.length > 1 ? 's are' : ' is'} on more than one row (${duplicates.slice(0, 3).map((d) => d.key).join(', ')}): resolve them at import before scoring.`]);
  const controls = controlRows(design, variants);
  const warnings = [];
  const info = [];
  if (p.normalization === 'wt' && controls.wtProblem) throw new Refused([controls.wtProblem]);

  // Samples: technical replicates summed.
  const missingColumns = [];
  const pooled = new Map();
  for (const sample of design.samples) {
    const parts = sample.columns.map((c) => columns[c]);
    if (parts.some((c) => !c)) {
      missingColumns.push(...sample.columns.filter((c) => !columns[c]));
      continue;
    }
    pooled.set(sample.id, sampleCounts(sample, parts));
    if (sample.columns.length > 1) info.push(`Technical replicates summed: ${sample.name ?? sample.id} is ${sample.columns.join(' + ')} (one library sequenced more than once; not an independent replicate).`);
    if (sample.missingMeansZero) info.push(`Missing counts read as 0 in ${sample.name ?? sample.id}, as the design says (a table that writes variants that dropped out as missing).`);
  }
  if (missingColumns.length) throw new Refused([`The count table has no column ${missingColumns.map((c) => `"${c}"`).join(', ')}.`]);

  // Per biological replicate: counted rows, normalizers, log ratios, and each measurement's state.
  const replicates = [];
  const repById = new Map();
  const regression = p.model !== 'ratio';
  design.replicates.forEach((replicate, index) => {
    onProgress((index / design.replicates.length) * 0.6, `Scoring ${replicate.name ?? replicate.id}`);
    const slots = orderedSlots(replicate);
    const samples = slots.map((s) => pooled.get(s.sample));
    const label = `replicate ${replicate.name ?? replicate.id}`;
    const T = samples.length;
    // A regression fits a variant on the time points where it was counted: its first and at least
    // `need` in all. A ratio needs every sample.
    const need = regression ? (f.minTimePoints === 'all' ? T : Math.min(f.minTimePoints, T)) : T;
    const counted = new Uint8Array(n);
    const usable = new Uint8Array(n);
    const state = new Uint8Array(n);
    const total = new Float64Array(n);
    for (let i = 0; i < n; i += 1) {
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
      total[i] = sum;
      state[i] = replicateState(usable[i], samples[0][i], sum, f, regression && first && points > 1 && points < need);
    }
    let r;
    try {
      r = normalizers(p.normalization, samples, counted, { pseudocount: p.pseudocount, wtRow: controls.wt, label });
    } catch (error) {
      throw new Refused([error.message]);
    }
    let scored;
    try {
      const reference = p.normalization === 'synonymous' ? controls.synonymous.filter((i) => state[i] === REPLICATE_STATE.USED) : null;
      scored = regression
        ? regressionScores(samples, slots.map((s) => s.time), r, usable, { weighted: p.model === 'wls', pseudocount: p.pseudocount, method: p.normalization, se: p.regressionSE, reference, label })
        : ratioScores(p.normalization, samples, counted, r, { pseudocount: p.pseudocount, reference, label });
    } catch (error) {
      throw new Refused([error.message]);
    }
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
    const entry = {
      id: replicate.id,
      name: replicate.name ?? replicate.id,
      biological: replicate.biological,
      condition: replicate.condition ?? null,
      tile: replicate.tile ?? null,
      samples: slots.map((s) => s.sample),
      times: slots.map((s) => s.time),
      normalizers: r,
      synonymousMedian: scored.median,
      first: samples[0],
      last: samples[samples.length - 1],
      score: scored.score,
      se: scored.se,
      state,
      // A regression's time points used and its departure from a line against counting noise
      // (χ²/(n − 2)), per variant.
      points: scored.points ?? null,
      fit: scored.fit ?? null,
    };
    replicates.push(entry);
    repById.set(replicate.id, entry);
  });

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
      let exp = 0;
      for (const rep of reps) {
        if (coversRow(rep, i)) exp += 1;
        const s = rep.state[i];
        if (s !== REPLICATE_STATE.NOT_COUNTED && s !== REPLICATE_STATE.FEW_POINTS) anyCounted = true;
        if (s === REPLICATE_STATE.USED || s === REPLICATE_STATE.TOTAL_COUNT) anyPastInput = true;
        if (s === REPLICATE_STATE.USED) these.push(rep);
      }
      expected[i] = exp;
      k[i] = these.length;
      // The first stage, in order, that leaves the variant out.
      const stage = variantStage(i, variants, excludeKinds, excluded);
      if (!anyCounted) reason[i] = STAGE_BY_ID.get('measured').code;
      else if (stage) reason[i] = stage;
      else if (!these.length) reason[i] = STAGE_BY_ID.get(anyPastInput ? 'total-count' : 'input-count').code;
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
      for (const rep of these) {
        if (rep.last[i] === 0) bits |= FLAG.OUTPUT_ZERO;
        if (rep.first[i] === 0) bits |= FLAG.INPUT_ZERO;
      }
      if (these.length < expected[i]) bits |= FLAG.FEWER_REPLICATES;
      if (regression && these.some((rep) => rep.points[i] < rep.times.length)) bits |= FLAG.FEWER_POINTS;
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
      flow: filterFlow(reason),
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
    // Each sample's counts (technical replicates summed), for the inspector.
    samples: design.samples.filter((x) => pooled.has(x.id)).map((x) => ({ id: x.id, name: x.name ?? x.id, columns: x.columns, counts: pooled.get(x.id) })),
    warnings,
    info,
  };
}
