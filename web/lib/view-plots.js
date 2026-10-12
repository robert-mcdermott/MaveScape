// What the Score view, the Compare view and the inspector plot, as chart specifications for
// lib/plots.js (wave 6, slice 2): a run's score distributions by class, its filter flow, a
// contrast's differences against their p; a comparison's scatter, Bland–Altman, disagreement by
// position and a predictor's classes; a variant's score and each replicate's, its time course, its
// distribution over the bins. The views draw them, and a figure's panels draw the same
// (ui/figure-data.js). Pure.

import { categoricalColor } from './colormaps.js';
import { KIND } from './variants.js';
import { log10 } from './dmath.js';
import { intervalOf } from './exports.js';
import { REPLICATE_STATE_NAMES } from './filters.js';
import { timeCourse } from './score-regression.js';
import { coversPosition } from './design.js';
import { unitOf } from './runs.js';
import { DISCORDANT_Q } from './compare.js';
import { PLOT_LIGHT } from './plots.js';

const fmt = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '—');
const qText = (q) => (!Number.isFinite(q) ? '—' : q < 0.001 ? q.toExponential(1) : q.toFixed(3));

// --- A run --------------------------------------------------------------------------------------------

// The scored variants of one condition by class (synonymous, nonsense, missense, other).
export function scoreGroups(c, kinds, rows) {
  const named = new Set([KIND.SYNONYMOUS, KIND.NONSENSE, KIND.MISSENSE, KIND.WT]);
  const classes = [['Synonymous', (k) => k === KIND.SYNONYMOUS, 0], ['Nonsense', (k) => k === KIND.NONSENSE, 1], ['Missense', (k) => k === KIND.MISSENSE, 2], ['Other', (k) => !named.has(k), 3]];
  return classes.map(([label, test, color]) => {
    const values = [];
    for (let i = 0; i < rows; i += 1) if (!c.reason[i] && test(kinds[i]) && Number.isFinite(c.score[i])) values.push(c.score[i]);
    return { label, values, color: categoricalColor(color) };
  });
}

// A condition's score distributions by class, with the wild type's score.
export function distributionChart(results, c) {
  const wt = results.controls.wt;
  return { kind: 'histogram', spec: { groups: scoreGroups(c, results.variants.kind, results.rows), marks: wt >= 0 && !c.reason[wt] ? [{ value: c.score[wt], label: 'wild type' }] : [], label: 'Score distributions by class' } };
}

// A contrast's volcano: each variant's difference against −log10 of its p, red where q < 0.05.
export function volcanoChart(d, theme = PLOT_LIGHT) {
  const points = [];
  for (let i = 0; i < d.reason.length; i += 1) if (!d.reason[i]) points.push([d.delta[i], -log10(Math.max(d.p[i], 1e-300)), d.q[i] < 0.05 ? 1 : 0]);
  return {
    kind: 'scatter',
    legend: [{ label: 'q < 0.05', color: theme.danger }, { label: 'the others', color: theme.muted }],
    spec: { points, colorOf: (g) => (g ? theme.danger : theme.muted), xLabel: 'difference (natural log)', yLabel: '−log10 p', label: `${d.name}: each variant's difference against −log10 of its p-value; red where q < 0.05` },
  };
}

// A score panel's charts: { title, charts, reason? }. plot: 'distribution', 'flow' or 'volcano'.
export function scoreCharts(results, run, { condition = 0, contrast = 0, plot = 'distribution', theme = PLOT_LIGHT } = {}) {
  const c = results.conditions[Math.min(condition, results.conditions.length - 1)];
  const of = results.conditions.length > 1 ? `, ${c.name}` : '';
  if (plot === 'flow') return { title: `${run.name}: the filter flow${of}`, charts: [{ kind: 'flow', spec: c.flow }] };
  if (plot === 'volcano') {
    const d = results.differential?.[contrast];
    if (!d) return { title: run.name, charts: [], reason: `${run.name} compares no conditions.` };
    return { title: `${run.name}: ${d.name}`, charts: [volcanoChart(d, theme)] };
  }
  return { title: `${run.name}: scores by class${of}`, charts: [distributionChart(results, c)] };
}

// --- A comparison ---------------------------------------------------------------------------------------

const classOf = (k) => (k === KIND.SYNONYMOUS ? 0 : k === KIND.NONSENSE ? 1 : k === KIND.MISSENSE ? 2 : 3);
export const COMPARISON_CLASSES = [['synonymous', 0], ['nonsense', 1], ['missense', 2], ['other', 3]];

// The points of a comparison for lib/plots.js's scatter: missense first, the controls drawn over
// them (order[j] is the variant drawn j-th), each colored by its class.
export function comparisonPoints(x, y, kinds) {
  const order = Array.from({ length: x.length }, (_, k) => k).sort((a, b) => classOf(kinds[b]) - classOf(kinds[a]) || a - b);
  return { order, points: order.map((k) => [x[k], y[k], classOf(kinds[k])]), colorOf: (cls) => categoricalColor(COMPARISON_CLASSES[cls][1]) };
}

// A position's bar of the disagreement by position, in words.
export function positionTitle(x) {
  return `${x.residue}${x.position}${x.reference !== x.position ? ` (reference ${x.reference})` : ''}: ${x.n} variants, mean difference ${fmt(x.mean)}${Number.isFinite(x.q) ? `, q ${qText(x.q)}` : ''}${x.discordant ? `, ${x.discordant} discordant` : ''}`;
}

// The length a comparison's positions run to.
export function comparisonLength(c) {
  const target = (c.sides?.[0] ?? c.a)?.target;
  return Math.max(...(c.positions?.list ?? []).map((x) => x.position), target ? Math.floor(target.sequence.length / (target.sequenceType === 'dna' ? 3 : 1)) : 1);
}

// A comparison panel's charts (c: a computed comparison, ui/mode-compare.js's computeComparison):
// { title, charts, reason? }. plot: 'agreement', 'bland-altman', 'positions' or 'classes'.
export function comparisonCharts(c, plot) {
  const title = `${c.b.label} against ${c.a.label}`;
  const kinds = Uint8Array.from(c.rows, ([i]) => c.values.a.kind[i]);
  const used = COMPARISON_CLASSES.filter(([, idx]) => kinds.some((k) => classOf(k) === idx));
  const legend = used.map(([label, idx]) => ({ label, color: categoricalColor(idx) }));
  const rescaled = c.scale?.applied && c.scale.anchors;
  const axis = (label, w) => (rescaled ? `${label} (rescaled)` : w === 'b' && c.flipped ? `${label} (negated)` : label);
  if (plot === 'agreement') {
    if (!c.statistics) return { title, charts: [], reason: 'The two cannot be compared (the report says why).' };
    const { points, colorOf } = comparisonPoints(c.x, c.y, kinds);
    return { title, charts: [{ kind: 'scatter', legend, spec: { points, colorOf, xLabel: axis(c.a.label, 'a'), yLabel: axis(c.b.label, 'b'), diagonal: c.sameScale, label: `${c.b.label} against ${c.a.label}: one point per variant compared${c.sameScale ? ', with the line y = x' : ''}` } }] };
  }
  if (plot === 'bland-altman') {
    const ba = c.statistics?.blandAltman;
    if (!ba) return { title, charts: [], reason: 'Bland–Altman needs the two on one scale.' };
    const mean = Float64Array.from(c.x, (v, k) => (v + c.y[k]) / 2);
    const diff = Float64Array.from(c.x, (v, k) => v - c.y[k]);
    const { points, colorOf } = comparisonPoints(mean, diff, kinds);
    return { title: `${title}: Bland–Altman`, charts: [{ kind: 'scatter', legend, spec: { points, colorOf, xLabel: 'mean of the two', yLabel: 'first − second', lines: [{ y: ba.bias }, { y: ba.lower, dash: [4, 3] }, { y: ba.upper, dash: [4, 3] }], label: `Each variant's difference against its mean: bias ${fmt(ba.bias)}, limits of agreement ${fmt(ba.lower)} to ${fmt(ba.upper)}` } }] };
  }
  if (plot === 'positions') {
    const pos = c.positions;
    if (!pos?.valid) return { title, charts: [], reason: `No disagreement by position: ${pos?.reason ?? 'see the report'}` };
    return { title: `${title}: by position`, charts: [{ kind: 'positions', spec: { list: pos.list.map((x) => ({ ...x, title: positionTitle(x) })), length: comparisonLength(c), q: DISCORDANT_Q, label: `The mean difference (first − second) of the variants compared at each position; darker where it differs beyond its uncertainty (q < ${DISCORDANT_Q})` } }] };
  }
  if (plot === 'classes') {
    const k = c.classes;
    if (!k?.valid) return { title, charts: [], reason: `No classes: ${k?.reason ?? 'neither side is a predictor that classes its substitutions.'}` };
    return { title: `${k.measured} by ${k.predictor}'s classes`, charts: [{ kind: 'classes', spec: { list: k.list, references: k.references, xLabel: k.measured, label: `${k.measured} in each of ${k.predictor}'s classes, with its synonymous and nonsense medians` } }] };
  }
  return { title, charts: [], reason: `A comparison panel shows agreement, bland-altman, positions or classes, not "${plot}".` };
}

// --- A variant -----------------------------------------------------------------------------------------

// The replicates that measure a variant (those of its tile).
function replicatesOf(results, run, c, row) {
  const tiles = new Map((run.inputs.design.library?.tiles ?? []).map((t) => [t.id, t]));
  return results.replicates.filter((r) => c.replicates.includes(r.id) && coversPosition(r, tiles, results.variants.position[row]));
}

// A variant's evidence panel's charts: { title, charts, reason? }. plot: 'evidence' (its score and
// interval, each replicate's with ± 1.96 SE, the wild type's score), 'time-course' (a regression's
// normalized log counts at each time and the fitted lines) or 'bins' (its share in each bin, with
// the wild type's).
export function variantCharts(results, run, key, { condition = 0, plot = 'evidence', theme = PLOT_LIGHT } = {}) {
  const row = results.variants.key.indexOf(key);
  const c = results.conditions[Math.min(condition, results.conditions.length - 1)];
  const title = `${key}${results.conditions.length > 1 ? `, ${c.name}` : ''}`;
  if (row < 0) return { title, charts: [], reason: `${key} is not in ${run.name}: not measured.` };
  const reps = replicatesOf(results, run, c, row);
  const wtRow = results.controls?.wt ?? -1;
  if (plot === 'evidence') {
    const rows = reps.map((r) => {
      const ok = Number.isFinite(r.score[row]) && Number.isFinite(r.se[row]);
      return { label: r.name, score: r.score[row], low: ok ? r.score[row] - 1.96 * r.se[row] : Number.NaN, high: ok ? r.score[row] + 1.96 * r.se[row] : Number.NaN, used: !r.state[row], state: r.state[row] ? REPLICATE_STATE_NAMES[r.state[row]] : 'used' };
    });
    const [low, high] = c.reason[row] ? [Number.NaN, Number.NaN] : intervalOf(c, row);
    const combined = c.reason[row] ? null : { label: 'Combined', score: c.score[row], low, high };
    const wt = wtRow >= 0 && !c.reason[wtRow] ? c.score[wtRow] : null;
    return { title, charts: [{ kind: 'evidence', legend: [{ label: 'each replicate, ± 1.96 SE', color: theme.accent }, { label: 'combined, 95% interval', color: theme.text }, ...(Number.isFinite(wt) ? [{ label: 'wild type', color: theme.muted, dash: true }] : [])], spec: { rows, combined, wt, xLabel: 'score', label: `${key}: ${combined ? `${fmt(combined.score)} (95% interval ${fmt(low)} to ${fmt(high)})` : 'not scored'}; ${rows.map((r) => `${r.label} ${fmt(r.score)}`).join(', ')}` } }], rows, combined };
  }
  const counts = new Map((results.samples ?? []).map((x) => [x.id, x.counts]));
  if (plot === 'time-course') {
    const p = run.inputs.parameters;
    if (p.model !== 'wls' && p.model !== 'ols') return { title, charts: [], reason: `${run.name} is not scored by regression on time.` };
    const series = [];
    const legend = [];
    reps.forEach((r, k) => {
      const color = categoricalColor(k);
      const course = timeCourse(r.samples.map((id) => counts.get(id)?.[row] ?? Number.NaN), r.times, r.normalizers, { weighted: p.model === 'wls', pseudocount: p.pseudocount, method: p.normalization, perUnit: p.timeScale === 'unit' });
      series.push({ label: r.name, points: course.points, color, markers: true, width: 0 });
      if (course.line.length && !r.state[row]) series.push({ label: `${r.name}, fitted`, points: course.line, color, dash: true, width: 1.5 });
      legend.push({ label: `${r.name}: ${r.state[row] ? REPLICATE_STATE_NAMES[r.state[row]] : `slope ${fmt(course.slope, 2)}`}`, color });
    });
    const unit = run.inputs.design.time?.unit;
    return { title: `${title}: time course`, charts: [{ kind: 'line', legend, spec: { series, xLabel: `time${unit && unit !== 'other' ? ` (${unit}s)` : ''}`, yLabel: 'normalized ln count', label: `${key}: its normalized log count at each time in each replicate, with the fitted lines (per ${unitOf(run.inputs.design)})` } }] };
  }
  if (plot === 'bins') {
    if (!reps.some((r) => r.bins)) return { title, charts: [], reason: `${run.name} is not of sorted bins.` };
    const share = (r, i) => {
      const f = r.samples.map((id, b) => (counts.get(id)?.[i] ?? Number.NaN) / r.normalizers[b]);
      const total = f.reduce((a, x) => a + x, 0);
      return f.map((x, b) => [b + 1, total > 0 ? x / total : Number.NaN]);
    };
    const series = [];
    const legend = [];
    reps.forEach((r, k) => {
      const color = categoricalColor(k);
      series.push({ label: r.name, points: share(r, row), color, markers: true, width: 1.5 });
      legend.push({ label: r.name, color });
    });
    if (wtRow >= 0 && wtRow !== row) {
      series.push({ label: 'wild type', points: share(reps[0], wtRow), color: theme.muted, dash: true, width: 1.5 });
      legend.push({ label: `the wild type (${reps[0].name})`, color: theme.muted, dash: true });
    }
    return { title: `${title}: over the bins`, charts: [{ kind: 'line', legend, spec: { series, xLabel: 'bin', yLabel: 'share of the variant', label: `${key}: its share in each bin, by replicate, with the wild type's` } }] };
  }
  return { title, charts: [], reason: `A variant panel shows evidence, time-course or bins, not "${plot}".` };
}
