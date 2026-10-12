// Robustness to analysis choices (wave 4, slice 4; requirement C4): does a run's conclusion about
// each variant survive other reasonable analysis choices? The run as it was scored (the declared
// analysis) is repeated under alternatives, each one alone and then in random combinations (a
// multiverse or specification-curve analysis: Steegen, Tuerlinckx, Gelman & Vanpaemel 2016,
// doi:10.1177/1745691616658637; Simonsohn, Simmons & Nelson 2020, doi:10.1038/s41562-020-0912-z),
// the pattern of CytoWeave's multiverse.js (its `specifications` copied here):
//   - the pseudocount;
//   - the normalization (the wild type, the synonymous variants' median, complete cases, all reads);
//   - the uncertainty model: DiMSum's error model, with each replicate scaled and shifted (two
//     populations); a regression's SE from its residuals alone, or ordinary least squares, or the
//     ratio of the first and last time points (a time series);
//   - the combination of replicates (moderated, REML, fixed effects, their mean);
//   - the filters: low-depth measurements removed (a minimum input count), a minimum of replicates,
//     every time point;
//   - each replicate left out in turn.
// For each variant it follows what changes: its effect (its score against the wild type's, so that
// normalizations compare), its rank, its uncertainty, whether it is scored at all, and its class:
// lower than the wild type, like it, or higher, beyond its uncertainty (q < 0.05, Benjamini–Hochberg
// over the variants), and each difference between conditions likewise. A variant's verdict:
//   - robust: the same class in every analysis, and scored in every one;
//   - fragile: an analysis moves its effect beyond its declared 95% interval and changes its class,
//     each single choice that does so named (its estimate depends on a choice);
//   - depends on its uncertainty: its class changes where its effect stays within that interval
//     but its SE changes by more than half (another account of its uncertainty: the combination of
//     replicates, the error model), each such choice named;
//   - borderline: its class changes, but its effect and SE stay near the declared ones: it sits
//     near the threshold, and crossing it is no choice's doing;
//   - its effect's size depends on a choice: its class holds, but one choice alone moves its effect
//     beyond its declared interval (a zero count's score and the pseudocount);
//   - not always scored: the same class wherever it is scored, but left out by some choices.
// Where only choices combined change a variant, the smallest such combination is named.
// The declared analysis stays the result. This reports how much each conclusion depends on choices
// that could reasonably have been made otherwise, and which ones; it is not a search for the best.
// Pure: specifications and calls here, the scoring in the score worker, the summary in the window,
// remote control and the validation alike.

import { adjustBH, tTwoSided } from './distributions.js';
import { normalUpper } from './dmath.js';
import { createRandom } from './random.js';
import { readoutOf } from './readout.js';
import { checkParameters, scoreExperiment, withDefaults } from './score.js';
import { NORMALIZATIONS } from './score-ratio.js';
import { median, spearman } from './stats.js';
import { targetProtein } from './target.js';
import { KIND } from './variants.js';

// A class: lower than the wild type (or the reference condition), like it, or higher, beyond its
// uncertainty (q below ROBUSTNESS_Q); not scored.
export const ROBUSTNESS_Q = 0.05;
export const CLASS = { UNSCORED: 0, NEUTRAL: 1, LOWER: 2, HIGHER: 3 };
export const CLASS_NAMES = ['not scored', 'like the wild type', 'lower than the wild type', 'higher than the wild type'];
export const CONTRAST_CLASS_NAMES = ['not compared', 'no difference', 'lower', 'higher'];
export const VERDICT = { NONE: 0, ROBUST: 1, FRAGILE: 2, UNCERTAIN: 3, BORDERLINE: 4, SIZE: 5, INCLUSION: 6 };
export const VERDICT_NAMES = ['not scored in the declared analysis', 'robust', 'fragile', 'depends on its uncertainty', 'borderline', 'its effect\'s size depends on a choice', 'not always scored'];
// An effect moved: beyond its declared 95% interval, and an outlier among the moves the same
// analysis makes of every variant (more than MOVE_OUTLIER robust SDs, by the median absolute
// deviation, from their median), so that a choice that moves every estimate a little (a replicate
// left out moves each by a share of its sampling error) flags only the variants it moves unusually,
// not the few its ordinary moves carry past their interval by chance among a thousand. An SE
// changed by more than half.
const Z975 = 1.959963984540054;
export const MOVE_OUTLIER = 5;
const SE_SHIFT = 1.5;

// How an analysis moves the declared effects: { center, spread, typical } of z = (its effect −
// the declared) / the declared SE over the variants both score (spread: 1.4826 × the median
// absolute deviation; typical: the median |z|).
function movesOf(declared, other) {
  const z = [];
  for (let i = 0; i < declared.cls.length; i += 1) {
    if (!declared.cls[i] || !other.cls[i] || !(declared.se[i] > 0)) continue;
    z.push((other.effect[i] - declared.effect[i]) / declared.se[i]);
  }
  if (!z.length) return { center: 0, spread: 0, typical: Number.NaN };
  const center = median(z);
  return { center, spread: 1.482602218505602 * median(z.map((x) => Math.abs(x - center))), typical: median(z.map(Math.abs)) };
}
const movedBy = (m, declared, other, i) => {
  const z = (other.effect[i] - declared.effect[i]) / declared.se[i];
  return Math.abs(z) > Z975 && Math.abs(z - m.center) > MOVE_OUTLIER * m.spread;
};
// The least tolerant positions: the tenth with the least function.
export const LEAST_TOLERANT = 0.1;
export const DEFAULT_MAX_SPECIFICATIONS = 48;
// The seed of the combinations drawn: the same analyses each time a run is checked.
export const ROBUSTNESS_SEED = 20261016;
// A call held in most analyses: this share of them or more.
export const MOST = 0.9;

// --- Specifications (copied from CytoWeave's web/lib/multiverse.js) -------------------------------

// The specifications to run: the declared one, every alternative alone, then random combinations
// (seeded) up to `max` in all. choices: [{ id, options: [declared, ...alternatives] }]. Returns
// [{ picks: [option index per choice], kind: 'declared' | 'single' | 'combined', changed }].
export function specifications(choices, options = {}) {
  const max = options.max ?? 64;
  const out = [{ picks: choices.map(() => 0), kind: 'declared', changed: 0 }];
  const seen = new Set([out[0].picks.join(',')]);
  choices.forEach((choice, c) => {
    for (let o = 1; o < choice.options.length; o += 1) {
      const picks = choices.map((_, k) => (k === c ? o : 0));
      seen.add(picks.join(','));
      out.push({ picks, kind: 'single', changed: 1 });
    }
  });
  const random = createRandom(options.seed ?? 1);
  const variable = choices.map((choice, c) => (choice.options.length > 1 ? c : -1)).filter((c) => c >= 0);
  let space = 1;
  for (const choice of choices) space *= choice.options.length;
  let attempts = 0;
  while (out.length < max && out.length < space && attempts < 50 * max) {
    attempts += 1;
    // Each choice keeps its declared option or takes a random alternative, so combinations of a
    // few changes are as likely as combinations of many.
    const picks = choices.map((choice) => (choice.options.length > 1 && random() < 0.5 ? 1 + Math.floor(random() * (choice.options.length - 1)) : 0));
    const changed = picks.filter((p) => p > 0).length;
    if (changed < 2 && variable.length >= 2) continue;
    const key = picks.join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ picks, kind: 'combined', changed });
  }
  return out;
}

// --- Choices -------------------------------------------------------------------------------------

const PSEUDOCOUNTS = [0.1, 0.5, 1];
// Short names for the options, in sentences.
const NORMALIZATION_LABELS = { wt: 'the wild type', synonymous: 'the synonymous median', complete: 'complete cases', full: 'all reads' };
const COMBINATION_LABELS = { moderated: 'moderated (MaveScape\'s)', reml: 'REML random effects', fixed: 'fixed effects', mean: 'the mean (SD/√k)', enrich2: 'Enrich2\'s estimator' };
const fmtNumber = (x) => String(Number(x.toPrecision(3)));

// The choices a run's analysis offers, its own as the first option of each: { choices: [{ id,
// label, options: [{ id, label, parameters (a patch), filters (a patch), leaveOut (a replicate
// id) }] }], notes: [what is not varied, and why] }. design and parameters: the run's recorded
// inputs; results: its scores (for the controls the normalizations need).
export function robustnessChoices(design, parameters, results = null) {
  const p = withDefaults(parameters);
  const notes = [];
  if (p.model === 'published') return { choices: [], notes: ['Published scores are read as published: there is no analysis of theirs to vary.'] };
  const choices = [];
  const option = (id, label, extra = {}) => ({ id, label, ...extra });
  const add = (id, label, options) => {
    if (options.length > 1) choices.push({ id, label, options });
  };
  const replicates = design.replicates ?? [];
  const bins = design.model === 'bins';
  const time = design.model === 'time-series';
  // The pseudocount (DiMSum's fitness has none; sorted bins' frequencies are not log ratios).
  if (p.model === 'dimsum' || bins) notes.push(p.model === 'dimsum' ? 'DiMSum\'s fitness has no pseudocount.' : 'Sorted bins are scored from their frequencies: no pseudocount.');
  else add('pseudocount', 'Pseudocount', [option('declared', fmtNumber(p.pseudocount)), ...PSEUDOCOUNTS.filter((x) => x !== p.pseudocount).map((x) => option(`pc-${x}`, fmtNumber(x), { parameters: { pseudocount: x } }))]);
  // The normalization, where its reference is in the table.
  if (!bins) {
    const variants = results?.variants;
    const hasWT = results ? results.controls?.wt >= 0 : true;
    const synonymous = variants ? variants.kind.reduce((a, k) => a + (k === KIND.SYNONYMOUS ? 1 : 0), 0) : 0;
    const available = Object.keys(NORMALIZATIONS).filter((n) => (n === 'wt' ? hasWT : n === 'synonymous' ? synonymous >= 3 : true));
    add('normalization', 'Normalization', [option('declared', NORMALIZATION_LABELS[p.normalization] ?? p.normalization), ...available.filter((n) => n !== p.normalization).map((n) => option(`norm-${n}`, NORMALIZATION_LABELS[n], { parameters: { normalization: n } }))]);
  } else notes.push('Sorted bins are not normalized to a reference: their scale (nonsense and the wild type) is kept.');
  // The uncertainty model.
  if (design.model === 'two-population' && (p.model === 'ratio' || p.model === 'dimsum') && p.aggregation !== 'barcode') {
    add('model', 'Model', p.model === 'dimsum'
      ? [option('declared', 'DiMSum\'s (replicates scaled, its error model)'), option('ratio', 'the log ratio (counting error)', { parameters: { model: 'ratio' } })]
      : [option('declared', 'the log ratio (counting error)'), option('dimsum', 'DiMSum\'s (replicates scaled, its error model)', { parameters: { model: 'dimsum' } })]);
  }
  if (time && ['wls', 'ols', 'ratio'].includes(p.model)) {
    const models = { wls: 'weighted least squares', ols: 'ordinary least squares', ratio: 'first and last time points' };
    add('model', 'Time course', [option('declared', models[p.model]), ...Object.keys(models).filter((m) => m !== p.model).map((m) => option(m, models[m], { parameters: { model: m } }))]);
    if (p.model !== 'ratio') add('regressionSE', 'A regression\'s SE', [option('declared', p.regressionSE === 'residual' ? 'from its residuals alone' : 'from its residuals, at least counting\'s'), option(p.regressionSE === 'residual' ? 'counting-floor' : 'residual', p.regressionSE === 'residual' ? 'from its residuals, at least counting\'s' : 'from its residuals alone (Enrich2\'s)', { parameters: { regressionSE: p.regressionSE === 'residual' ? 'counting-floor' : 'residual' } })]);
  }
  // The combination of replicates (Enrich2's needs every replicate, a filter of its own).
  const perCondition = new Map();
  for (const r of replicates) perCondition.set(r.condition ?? '', (perCondition.get(r.condition ?? '') ?? 0) + 1);
  const most = Math.max(0, ...perCondition.values());
  if (most >= 2) {
    // Fixed effects assume the replicates differ by their SEs alone: not a reasonable choice where
    // they differ more (QC's variance beyond counting), which the declared run's heterogeneity says.
    const spread = results ? replicateDispersion(results) : Number.NaN;
    const unreasonable = spread > DISPERSION_LIMIT && p.combination !== 'fixed';
    if (unreasonable) notes.push(`Fixed effects (inverse variance) are not tried: the replicates differ ${spread.toFixed(1)} times as much as their SEs say (QC's variance beyond counting), and fixed effects assume they do not.`);
    const combinations = ['moderated', 'reml', 'fixed', 'mean'].filter((c) => c !== p.combination && !(c === 'fixed' && unreasonable));
    add('combination', 'Combination', [option('declared', COMBINATION_LABELS[p.combination] ?? p.combination), ...combinations.map((c) => option(c, COMBINATION_LABELS[c], { parameters: { combination: c } }))]);
  } else notes.push('One replicate: nothing to combine or leave out.');
  // The filters: low-depth measurements, replicates, time points.
  if (!bins) {
    const f = p.filters;
    const inputs = [0, 10].filter((x) => x !== f.minInputCount);
    add('minInputCount', 'Minimum input count', [option('declared', String(f.minInputCount)), ...inputs.map((x) => option(`in-${x}`, String(x), { filters: { minInputCount: x } }))]);
  }
  if (most >= 2 && p.combination !== 'enrich2') {
    const f = p.filters;
    add('minReplicates', 'Minimum replicates', [option('declared', String(f.minReplicates)), option(f.minReplicates === 1 ? 'reps-2' : 'reps-1', f.minReplicates === 1 ? '2' : '1', { filters: { minReplicates: f.minReplicates === 1 ? 2 : 1 } })]);
  }
  if (time && p.model !== 'ratio') {
    const f = p.filters;
    add('minTimePoints', 'Time points', [option('declared', f.minTimePoints === 'all' ? 'every one' : `at least ${f.minTimePoints}`), option(f.minTimePoints === 'all' ? 'tp-3' : 'tp-all', f.minTimePoints === 'all' ? 'at least 3' : 'every one', { filters: { minTimePoints: f.minTimePoints === 'all' ? 3 : 'all' } })]);
  }
  // Each replicate left out in turn, where its condition keeps another.
  if (most >= 2) {
    const out = replicates.filter((r) => (perCondition.get(r.condition ?? '') ?? 0) >= 2);
    add('leaveOut', 'Left out', [option('declared', 'none'), ...out.map((r) => option(`without-${r.id}`, r.name ?? r.id, { leaveOut: r.id }))]);
  }
  return { choices, notes };
}

// How much a run's replicates differ beyond their SEs: the median over variants of Cochran's Q
// over its expected median (χ² on k − 1 degrees of freedom, by Wilson and Hilferty), about 1 where
// they differ by their SEs alone.
export const DISPERSION_LIMIT = 1.5;
export function replicateDispersion(results) {
  const ratios = [];
  for (const c of results.conditions) {
    if (!c.q || !c.k) continue;
    for (let i = 0; i < c.q.length; i += 1) {
      const df = c.k[i] - 1;
      if (df < 1 || c.reason[i] || !Number.isFinite(c.q[i])) continue;
      const a = 1 - 2 / (9 * df);
      ratios.push(c.q[i] / (df * a * a * a));
    }
  }
  return ratios.length ? median(ratios) : Number.NaN;
}

// The design and parameters of one specification.
export function specificationInputs(design, parameters, choices, picks) {
  let p = withDefaults(parameters);
  let d = design;
  choices.forEach((choice, c) => {
    if (!picks[c]) return;
    const o = choice.options[picks[c]];
    if (o.parameters) p = { ...p, ...o.parameters };
    if (o.filters) p = { ...p, filters: { ...p.filters, ...o.filters } };
    if (o.leaveOut) d = { ...d, replicates: (d.replicates ?? []).filter((r) => r.id !== o.leaveOut) };
  });
  // Enrich2's estimator combines only variants in every replicate; another combination with the
  // declared Enrich2 filters keeps them.
  return { design: d, parameters: p };
}

// A choice's option in words ("pseudocount 1", "REML random effects", "Replicate 2 left out").
export function phraseOf(choice, option) {
  switch (choice.id) {
    case 'pseudocount': return `pseudocount ${option.label}`;
    case 'normalization': return `normalized to ${option.label}`;
    case 'regressionSE': return `a regression's SE ${option.label}`;
    case 'minInputCount': return `minimum input count ${option.label}`;
    case 'minReplicates': return `minimum replicates ${option.label}`;
    case 'minTimePoints': return `time points: ${option.label}`;
    case 'leaveOut': return `${option.label} left out`;
    default: return option.label;
  }
}

// A specification's label: the declared analysis, or its changes from it.
export function specificationLabel(choices, picks) {
  const changes = choices.map((choice, c) => (picks[c] ? phraseOf(choice, choice.options[picks[c]]) : null)).filter(Boolean);
  return changes.length ? changes.join('; ') : 'the declared analysis';
}

// --- Calls ---------------------------------------------------------------------------------------

// What a scoring says of each variant: one target per condition (its class against the wild type,
// or the synonymous variants' median without one) and per difference between conditions (its
// class from the difference's q). Each { id, name, kind: 'condition' | 'contrast', reference,
// classified, effect, se, q, cls } over the run's rows: effect is the score less the reference's
// (a contrast's difference), so that normalizations compare.
export function callsOf(results, design) {
  const n = results.rows;
  const targets = [];
  const variants = results.variants;
  const wt = results.controls?.wt ?? -1;
  const p = results.parameters ?? {};
  // A score relative to the wild type already carries its counts' error; against another
  // reference, the reference's own error is added (the wild type's SE; a median's, as anchors.js).
  const relativeToWT = p.normalization === 'wt' && ['ratio', 'wls', 'ols', 'dimsum'].includes(p.model);
  for (const c of results.conditions) {
    let reference = Number.NaN;
    let referenceSE = 0;
    let what = null;
    if (wt >= 0 && !c.reason[wt] && Number.isFinite(c.score[wt])) {
      reference = c.score[wt];
      if (!relativeToWT && Number.isFinite(c.se[wt])) referenceSE = c.se[wt];
      what = 'the wild type';
    } else {
      const syn = [];
      let ss = 0;
      for (let i = 0; i < n; i += 1) {
        if (variants.kind[i] !== KIND.SYNONYMOUS || c.reason[i] || !Number.isFinite(c.score[i])) continue;
        syn.push(c.score[i]);
        if (Number.isFinite(c.se[i])) ss += c.se[i] * c.se[i];
      }
      if (syn.length) {
        reference = median(syn);
        referenceSE = Math.sqrt(((Math.PI / 2) * ss) / syn.length / syn.length);
        what = 'the synonymous variants\' median';
      }
    }
    const classified = Number.isFinite(reference);
    const effect = new Float64Array(n).fill(Number.NaN);
    const se = new Float64Array(n).fill(Number.NaN);
    const p = new Float64Array(n).fill(Number.NaN);
    const cls = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) {
      if (c.reason[i] || !Number.isFinite(c.score[i])) continue;
      effect[i] = classified ? c.score[i] - reference : c.score[i];
      se[i] = c.se[i];
      cls[i] = CLASS.NEUTRAL;
      if (!classified || i === wt || !(se[i] > 0)) continue;
      const z = effect[i] / Math.sqrt(se[i] * se[i] + referenceSE * referenceSE);
      const df = c.df?.[i];
      p[i] = Number.isFinite(df) ? tTwoSided(z, df) : 2 * normalUpper(Math.abs(z));
    }
    const q = adjustBH(p);
    for (let i = 0; i < n; i += 1) if (cls[i] && q[i] < ROBUSTNESS_Q) cls[i] = effect[i] < 0 ? CLASS.LOWER : CLASS.HIGHER;
    targets.push({ id: `condition:${c.id}`, name: c.name, kind: 'condition', reference: what, classified, effect, se, q, cls });
  }
  for (const d of results.differential ?? []) {
    const effect = new Float64Array(n).fill(Number.NaN);
    const se = new Float64Array(n).fill(Number.NaN);
    const q = new Float64Array(n).fill(Number.NaN);
    const cls = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) {
      if (d.reason[i] || !Number.isFinite(d.delta[i])) continue;
      effect[i] = d.delta[i];
      se[i] = d.se[i];
      q[i] = d.q[i];
      cls[i] = q[i] < ROBUSTNESS_Q ? (effect[i] < 0 ? CLASS.LOWER : CLASS.HIGHER) : CLASS.NEUTRAL;
    }
    targets.push({ id: `contrast:${d.id ?? d.name}`, name: d.name, kind: 'contrast', reference: null, classified: true, effect, se, q, cls });
  }
  return targets;
}

// --- Running ---------------------------------------------------------------------------------------

// Scores every specification of a run. input: { names, barcodes, columns, design, parameters,
// mode, choices, specs, onProgress(fraction, message) }. Returns [{ ...spec, label, ok, error,
// targets }] (each target's effect, se, q and cls; the declared's first).
export function runRobustness(input) {
  const { design, parameters, choices, specs } = input;
  const out = [];
  specs.forEach((spec, k) => {
    const label = specificationLabel(choices, spec.picks);
    input.onProgress?.(k / specs.length, `Analysis ${k + 1} of ${specs.length}: ${label}`);
    const inputs = specificationInputs(design, parameters, choices, spec.picks);
    const checked = checkParameters(inputs.parameters, inputs.design);
    if (checked.errors.length) {
      out.push({ ...spec, label, ok: false, error: checked.errors.join(' '), targets: null });
      return;
    }
    let scored;
    try {
      scored = scoreExperiment({ names: input.names, barcodes: input.barcodes ?? null, columns: input.columns, design: inputs.design, parameters: inputs.parameters, mode: input.mode ?? 'lenient' });
    } catch (error) {
      scored = { ok: false, errors: [error.message] };
    }
    if (!scored.ok) {
      out.push({ ...spec, label, ok: false, error: scored.errors.join(' '), targets: null });
      return;
    }
    out.push({ ...spec, label, ok: true, error: null, targets: callsOf(scored.results, inputs.design).map(({ id, name, kind, reference, classified, effect, se, q, cls }) => ({ id, name, kind, reference, classified, effect, se, q, cls })) });
  });
  input.onProgress?.(1, 'Done');
  return out;
}

// --- Summary ---------------------------------------------------------------------------------------

const rankOf = (values) => {
  // Each scored value's place among the scored, from 0 (lowest) to 1 (highest); NaN unscored.
  const idx = [];
  for (let i = 0; i < values.length; i += 1) if (Number.isFinite(values[i])) idx.push(i);
  idx.sort((a, b) => values[a] - values[b] || a - b);
  const out = new Float64Array(values.length).fill(Number.NaN);
  const m = idx.length;
  idx.forEach((i, k) => { out[i] = m > 1 ? k / (m - 1) : 0.5; });
  return out;
};

// What every specification says of a run's variants and positions, target by target. specs: the
// result of runRobustness; results: the run's (its variants); design: the run's. Returns { total
// (analyses scored), skipped: [{ label, error }], choices, targets: [{ id, name, kind, reference,
// classified, n, counts: { robust, fragile, uncertain, borderline, size, inclusion, added }, alone (of each verdict, under one choice alone), attribution, classes: { declared:
// [per class], every: [per class] }, verdict, dependsOn, droppedBy, scoredIn, agree, effectMin,
// effectMax, rank, rankMin, rankMax, byChoice, positions, leastTolerant, text }] }.
export function summarizeRobustness(specs, choices, results, design) {
  const valid = specs.filter((s) => s.ok);
  const declared = specs.find((s) => s.kind === 'declared');
  const skipped = specs.filter((s) => !s.ok).map((s) => ({ label: s.label, error: s.error }));
  if (!declared?.ok) return { total: valid.length, skipped, choices, targets: [], error: declared?.error ?? 'The declared analysis could not be scored.' };
  const n = results.rows;
  const singleLabel = (s) => {
    const c = s.picks.findIndex((x) => x > 0);
    return c >= 0 ? phraseOf(choices[c], choices[c].options[s.picks[c]]) : '';
  };
  // The single choices among some analyses, else the smallest combination of them.
  const namesOf = (list) => {
    const singles = list.filter((s) => s.kind === 'single').map(singleLabel);
    if (singles.length) return singles;
    const smallest = [...list].sort((a, b) => a.changed - b.changed)[0];
    return smallest ? [`${smallest.label} (together)`] : [];
  };
  const direction = readoutOf(design).direction === 'higher-less' ? -1 : 1;
  const targets = declared.targets.map((dt) => {
    const across = valid.map((s) => s.targets.find((x) => x.id === dt.id) ?? null);
    const verdict = new Uint8Array(n);
    const scoredIn = new Uint16Array(n);
    const agree = new Uint16Array(n);
    const effectMin = new Float64Array(n).fill(Number.NaN);
    const effectMax = new Float64Array(n).fill(Number.NaN);
    const rankMin = new Float64Array(n).fill(Number.NaN);
    const rankMax = new Float64Array(n).fill(Number.NaN);
    const dependsOn = new Array(n).fill(null);
    const droppedBy = new Array(n).fill(null);
    const ranks = across.map((x) => (x ? rankOf(x.effect) : null));
    const moves = across.map((x) => (x ? movesOf(dt, x) : null));
    const rank = ranks[valid.indexOf(declared)];
    let mostCalls = 0;
    const attribution = { fragile: new Map(), uncertain: new Map(), borderline: new Map(), size: new Map(), inclusion: new Map(), robust: new Map() };
    const alone = { fragile: 0, uncertain: 0, borderline: 0, size: 0, inclusion: 0, robust: 0 };
    const declaredClasses = [0, 0, 0, 0];
    const everyClasses = [0, 0, 0, 0];
    const counts = { robust: 0, fragile: 0, uncertain: 0, borderline: 0, size: 0, inclusion: 0, added: 0 };
    for (let i = 0; i < n; i += 1) {
      const c0 = dt.cls[i];
      // The analyses that change its class, by what changed: its effect (beyond its declared
      // interval), else its SE (by more than half), else neither (a threshold crossed).
      const by = { fragile: [], uncertain: [], borderline: [], size: [] };
      const drops = [];
      across.forEach((x, k) => {
        const s = valid[k];
        if (!x) return;
        const ci = x.cls[i];
        if (ci) {
          scoredIn[i] += 1;
          const e = x.effect[i];
          if (!(effectMin[i] <= e)) effectMin[i] = e;
          if (!(effectMax[i] >= e)) effectMax[i] = e;
          if (!(rankMin[i] <= ranks[k][i])) rankMin[i] = ranks[k][i];
          if (!(rankMax[i] >= ranks[k][i])) rankMax[i] = ranks[k][i];
        }
        if (!c0) return;
        if (!ci) {
          drops.push(s);
          return;
        }
        if (ci === c0) {
          agree[i] += 1;
          // Its class holds; one choice alone moving its effect beyond its interval is its size's.
          if (s.kind === 'single' && movedBy(moves[k], dt, x, i)) by.size.push(s);
          return;
        }
        const ratio = x.se[i] / dt.se[i];
        if (movedBy(moves[k], dt, x, i)) by.fragile.push(s);
        else if (ratio > SE_SHIFT || ratio < 1 / SE_SHIFT) by.uncertain.push(s);
        else by.borderline.push(s);
      });
      if (!c0) {
        if (scoredIn[i]) counts.added += 1;
        continue;
      }
      declaredClasses[c0] += 1;
      if (agree[i] === valid.length) everyClasses[c0] += 1;
      if ((c0 === CLASS.LOWER || c0 === CLASS.HIGHER) && agree[i] >= MOST * valid.length) mostCalls += 1;
      const kind = by.fragile.length ? 'fragile' : by.uncertain.length ? 'uncertain' : by.borderline.length ? 'borderline' : by.size.length ? 'size' : drops.length ? 'inclusion' : 'robust';
      counts[kind] += 1;
      verdict[i] = { robust: VERDICT.ROBUST, fragile: VERDICT.FRAGILE, uncertain: VERDICT.UNCERTAIN, borderline: VERDICT.BORDERLINE, size: VERDICT.SIZE, inclusion: VERDICT.INCLUSION }[kind];
      if (kind === 'inclusion') droppedBy[i] = namesOf(drops);
      else if (kind !== 'robust') dependsOn[i] = namesOf(by[kind]);
      // What each single choice accounts for, verdict by verdict, and how many a single choice does.
      const names = (kind === 'inclusion' ? droppedBy[i] : dependsOn[i]) ?? [];
      if (names.some((label) => !label.endsWith('(together)'))) alone[kind] += 1;
      for (const label of names) {
        if (label.endsWith('(together)')) continue;
        attribution[kind].set(label, (attribution[kind].get(label) ?? 0) + 1);
      }
    }
    // Each single alternative against the declared analysis.
    const byChoice = [];
    valid.forEach((s, k) => {
      if (s.kind !== 'single') return;
      const x = across[k];
      if (!x) return;
      let changedN = 0;
      let lowered = 0;
      let raised = 0;
      let droppedN = 0;
      let addedN = 0;
      let movedN = 0;
      const kinds = { fragile: 0, uncertain: 0, borderline: 0, size: 0 };
      const a = [];
      const b = [];
      for (let i = 0; i < n; i += 1) {
        const c0 = dt.cls[i];
        const ci = x.cls[i];
        if (c0 && !ci) droppedN += 1;
        if (!c0 && ci) addedN += 1;
        if (!c0 || !ci) continue;
        a.push(dt.effect[i]);
        b.push(x.effect[i]);
        const moved = movedBy(moves[k], dt, x, i);
        if (moved) movedN += 1;
        if (moved && ci === c0) kinds.size += 1;
        if (ci !== c0) {
          changedN += 1;
          if (ci === CLASS.LOWER) lowered += 1;
          if (ci === CLASS.HIGHER) raised += 1;
          const ratio = x.se[i] / dt.se[i];
          kinds[moved ? 'fragile' : ratio > SE_SHIFT || ratio < 1 / SE_SHIFT ? 'uncertain' : 'borderline'] += 1;
        }
      }
      const c = s.picks.findIndex((v) => v > 0);
      byChoice.push({ choice: choices[c].id, choiceLabel: choices[c].label, option: choices[c].options[s.picks[c]].id, optionLabel: choices[c].options[s.picks[c]].label, phrase: singleLabel(s), changed: changedN, ...kinds, lowered, raised, dropped: droppedN, added: addedN, moved: movedN, typicalMove: moves[k].typical, rho: a.length >= 3 ? spearman(a, b) : Number.NaN, compared: a.length });
    });
    const positions = positionsOf(dt, across, valid.indexOf(declared), verdict, results, design, direction);
    return {
      id: dt.id, name: dt.name, kind: dt.kind, reference: dt.reference, classified: dt.classified,
      n: declaredClasses.reduce((s, x) => s + x, 0), counts,
      classes: { declared: declaredClasses, every: everyClasses },
      calls: { declared: declaredClasses[CLASS.LOWER] + declaredClasses[CLASS.HIGHER], every: everyClasses[CLASS.LOWER] + everyClasses[CLASS.HIGHER], most: mostCalls },
      verdict, dependsOn, droppedBy, scoredIn, agree, effectMin, effectMax, rank, rankMin, rankMax,
      effect: dt.effect, se: dt.se, q: dt.q, cls: dt.cls,
      byChoice, positions: positions.list, leastTolerant: positions.leastTolerant,
      alone,
      attribution: Object.fromEntries(Object.entries(attribution).map(([k, m]) => [k, [...m.entries()].sort((a, b) => b[1] - a[1])])),
      text: textOf(dt, counts, declaredClasses, everyClasses, attribution, alone, valid.length, positions.leastTolerant, mostCalls),
    };
  });
  return { total: valid.length, skipped, choices, targets };
}

// The positions of a target: each position's median effect over its substitutions in each analysis
// (as the map's position effect), its rank among the positions (0: least function), the share of
// analyses in which it is among the least tolerant tenth, and its variants' verdicts. The least
// tolerant positions of the declared analysis, and how many stay among them in every analysis.
function positionsOf(dt, across, declaredIndex, verdict, results, design, direction) {
  const v = results.variants;
  const where = v.proPosition ?? v.position;
  const protein = design.targets?.[0] ? targetProtein(design.targets[0]) : '';
  const byPosition = new Map();
  for (let i = 0; i < results.rows; i += 1) {
    const pos = where[i];
    const kind = v.kind[i];
    if (!(pos >= 1) || kind === KIND.WT || kind === KIND.SYNONYMOUS) continue;
    if (!byPosition.has(pos)) byPosition.set(pos, []);
    byPosition.get(pos).push(i);
  }
  const positions = [...byPosition.keys()].sort((a, b) => a - b);
  const medians = across.map((x) => (x ? Float64Array.from(positions, (pos) => {
    const xs = byPosition.get(pos).map((i) => x.effect[i]).filter(Number.isFinite);
    return xs.length ? direction * median(xs) : Number.NaN;
  }) : null));
  const ranks = medians.map((m) => (m ? rankOf(m) : null));
  const scoredPositions = (m) => m.reduce((a, x) => a + (Number.isFinite(x) ? 1 : 0), 0);
  const list = positions.map((pos, k) => {
    let low = Number.NaN;
    let high = Number.NaN;
    let rlow = Number.NaN;
    let rhigh = Number.NaN;
    let inLeast = 0;
    let analyses = 0;
    medians.forEach((m, s) => {
      if (!m || !Number.isFinite(m[k])) return;
      analyses += 1;
      const e = direction * m[k];
      if (!(low <= e)) low = e;
      if (!(high >= e)) high = e;
      if (!(rlow <= ranks[s][k])) rlow = ranks[s][k];
      if (!(rhigh >= ranks[s][k])) rhigh = ranks[s][k];
      const cut = Math.max(1, Math.round(LEAST_TOLERANT * scoredPositions(m)));
      if (ranks[s][k] * (scoredPositions(m) - 1) < cut) inLeast += 1;
    });
    const members = byPosition.get(pos);
    const d = medians[declaredIndex];
    return {
      position: pos, reference: pos + (design.targets?.[0]?.offset ?? 0), residue: protein[pos - 1] ?? '',
      variants: members.length, fragile: members.filter((i) => verdict[i] === VERDICT.FRAGILE).length,
      effect: d && Number.isFinite(d[k]) ? direction * d[k] : Number.NaN, effectMin: low, effectMax: high,
      rank: ranks[declaredIndex]?.[k] ?? Number.NaN, rankMin: rlow, rankMax: rhigh,
      leastTolerantIn: inLeast, analyses,
    };
  });
  const scored = list.filter((x) => Number.isFinite(x.rank));
  const cut = Math.max(1, Math.round(LEAST_TOLERANT * scored.length));
  const least = scored.filter((x) => x.rank * (scored.length - 1) < cut);
  const total = across.filter(Boolean).length;
  // Within twice the cut (the least tolerant fifth) in every analysis: a ranking that holds but for
  // neighbours trading places.
  const wide = least.filter((x) => x.rankMax * (scored.length - 1) < 2 * cut).length;
  return { list, leastTolerant: { size: least.length, every: least.filter((x) => x.leastTolerantIn === total).length, wide, positions: least.map((x) => x.position) } };
}

const plural = (n, one, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

// A target's summary in words.
function textOf(dt, counts, declaredClasses, everyClasses, attribution, alone, total, least, mostCalls) {
  const names = dt.kind === 'contrast' ? CONTRAST_CLASS_NAMES : CLASS_NAMES;
  const n = declaredClasses.reduce((s, x) => s + x, 0);
  const kept = [CLASS.LOWER, CLASS.NEUTRAL, CLASS.HIGHER].filter((c) => everyClasses[c]).map((c) => `${everyClasses[c].toLocaleString('en-US')} ${names[c]}`);
  const parts = [`Of ${plural(n, dt.kind === 'contrast' ? 'difference' : 'variant')} the declared analysis ${dt.kind === 'contrast' ? 'estimates' : 'scores'}, ${counts.robust.toLocaleString('en-US')} keep their class in all ${total} analyses${kept.length ? ` (${kept.join(', ')} in every one)` : ''}`];
  // The single choices that account for most variants of a verdict (a variant may name several).
  // Each verdict's count, how many one choice alone explains (the choices that account for most),
  // and how many only choices combined.
  const how = (kind) => {
    const most = [...attribution[kind].entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([label, k]) => `${label}: ${k.toLocaleString('en-US')}`);
    const combined = counts[kind] - alone[kind];
    if (!alone[kind]) return ', only when several choices are combined';
    return ` (${alone[kind] === counts[kind] ? '' : `${alone[kind].toLocaleString('en-US')} under one choice alone: `}${most.join('; ')}${combined ? `; ${combined.toLocaleString('en-US')} only when several are combined` : ''})`;
  };
  if (counts.fragile) parts.push(`${counts.fragile.toLocaleString('en-US')} are fragile: a choice moves their effect beyond its 95% interval and changes their class${how('fragile')}`);
  if (counts.uncertain) parts.push(`${counts.uncertain.toLocaleString('en-US')} depend on their uncertainty: their class changes with another account of their SE${how('uncertain')}`);
  if (counts.borderline) parts.push(`${counts.borderline.toLocaleString('en-US')} are borderline: their class changes while their effect and SE barely move`);
  if (counts.size) parts.push(`${counts.size.toLocaleString('en-US')} keep their class, but one choice moves their effect beyond its interval${how('size')}`);
  if (counts.inclusion) parts.push(`${counts.inclusion.toLocaleString('en-US')} are not scored under some choices${how('inclusion')}`);
  const calls = declaredClasses[CLASS.LOWER] + declaredClasses[CLASS.HIGHER];
  const callsKept = everyClasses[CLASS.LOWER] + everyClasses[CLASS.HIGHER];
  let text = `${parts.join('; ')}.`;
  if (calls) text += ` Of the ${plural(calls, dt.kind === 'contrast' ? 'difference' : 'variant')} it calls ${dt.kind === 'contrast' ? 'beyond their uncertainty' : 'lower or higher than the wild type'}, ${callsKept.toLocaleString('en-US')} are called so in every analysis, and ${mostCalls.toLocaleString('en-US')} in ${Math.round(100 * MOST)}% of them or more.`;
  if (!dt.classified) text += ' The run scores no wild type and no synonymous variants: classes cannot be called, and only the effects, ranks and inclusion are followed.';
  if (dt.kind === 'condition' && least?.size) text += ` Of the ${least.size} least tolerant positions (the tenth with the least function), ${least.every} are among them in every analysis, and ${least.wide} among the least tolerant fifth.`;
  return text;
}

// --- Exports --------------------------------------------------------------------------------------

const num = (x) => (Number.isFinite(x) ? String(x) : 'NA');
const cell = (s) => (/[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s);

// Every variant of every target (robustness.csv): its class, effect, SE and q in the declared
// analysis, in how many analyses it is scored and keeps its class, its verdict and what it depends
// on, its effect's and rank's range.
export function robustnessCSV(summary, results) {
  const lines = ['target,variant,class,effect,SE,q,analyses,scored_in,class_kept_in,verdict,depends_on,effect_min,effect_max,rank,rank_min,rank_max'];
  for (const t of summary.targets) {
    const names = t.kind === 'contrast' ? CONTRAST_CLASS_NAMES : CLASS_NAMES;
    for (let i = 0; i < results.rows; i += 1) {
      if (!t.cls[i] && !t.scoredIn[i]) continue;
      const why = t.dependsOn[i] ?? t.droppedBy[i] ?? [];
      lines.push([cell(t.name), cell(results.variants.key[i]), cell(names[t.cls[i]]), num(t.effect[i]), num(t.se[i]), num(t.q[i]), summary.total, t.scoredIn[i], t.agree[i], cell(VERDICT_NAMES[t.verdict[i]] ?? ''), cell(why.join('; ')), num(t.effectMin[i]), num(t.effectMax[i]), num(t.rank[i]), num(t.rankMin[i]), num(t.rankMax[i])].join(','));
    }
  }
  return `${lines.join('\n')}\n`;
}

// Every position of each condition (robustness_positions.csv): its median effect in the declared
// analysis and its range, its rank (0: least function) and range, and in how many analyses it is
// among the least tolerant tenth.
export function robustnessPositionsCSV(summary) {
  const lines = ['target,position,reference_position,residue,variants,median_effect,effect_min,effect_max,rank,rank_min,rank_max,least_tolerant_in,analyses'];
  for (const t of summary.targets) {
    if (t.kind !== 'condition') continue;
    for (const x of t.positions) lines.push([cell(t.name), x.position, x.reference, x.residue, x.variants, num(x.effect), num(x.effectMin), num(x.effectMax), num(x.rank), num(x.rankMin), num(x.rankMax), x.leastTolerantIn, x.analyses].join(','));
  }
  return `${lines.join('\n')}\n`;
}

// The record of a check (robustness.json): the run (its id and output hash), the choices and every
// specification (scored or not, and why), each target's counts, classes, each single choice's
// effect, the least tolerant positions, and the methods' sentence.
export function robustnessJSON(summary, run, specs, software = null) {
  const clean = (o) => JSON.parse(JSON.stringify(o, (k, v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v)));
  return `${JSON.stringify(clean({
    format: 'mavescape-robustness',
    version: 1,
    ...(software ? { software } : {}),
    run: { id: run.id, name: run.name, output: run.output.sha256 },
    q: ROBUSTNESS_Q,
    choices: summary.choices.map((c) => ({ id: c.id, label: c.label, options: c.options.map((o) => ({ id: o.id, label: o.label, ...(o.parameters ? { parameters: o.parameters } : {}), ...(o.filters ? { filters: o.filters } : {}), ...(o.leaveOut ? { leaveOut: o.leaveOut } : {}) })) })),
    specifications: specs.map((s) => ({ kind: s.kind, picks: s.picks, label: s.label, scored: s.ok, error: s.error })),
    analyses: summary.total,
    targets: summary.targets.map((t) => ({
      id: t.id, name: t.name, kind: t.kind, reference: t.reference, classified: t.classified, variants: t.n, counts: t.counts,
      classes: { declared: Object.fromEntries(t.classes.declared.map((x, c) => [(t.kind === 'contrast' ? CONTRAST_CLASS_NAMES : CLASS_NAMES)[c], x]).slice(1)), every: Object.fromEntries(t.classes.every.map((x, c) => [(t.kind === 'contrast' ? CONTRAST_CLASS_NAMES : CLASS_NAMES)[c], x]).slice(1)) },
      byChoice: t.byChoice,
      leastTolerant: t.kind === 'condition' ? t.leastTolerant : null,
      text: t.text,
    })),
    methods: methodsSentence(summary),
  }), null, 2)}\n`;
}

// A sentence for the methods.
export function methodsSentence(summary) {
  const list = (items) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : items[0] ?? '');
  const parts = summary.choices.map((c) => (c.id === 'leaveOut' ? `each of ${c.options.length - 1} replicates left out in turn` : `${c.label.toLowerCase()}: ${list(c.options.slice(1).map((o) => o.label))}`));
  const t = summary.targets[0];
  const kept = t ? `; ${t.counts.robust.toLocaleString('en-US')} of ${t.n.toLocaleString('en-US')} variants (${t.name}) kept their class (lower than, like or higher than the wild type, q < ${ROBUSTNESS_Q}) in every one, ${t.counts.fragile.toLocaleString('en-US')} depended on a choice` : '';
  return `The scores were checked against ${summary.total - 1} alternative analyses, alone and combined (a specification-curve analysis; Steegen et al. 2016, Simonsohn et al. 2020): ${list(parts)}${kept}.`;
}
