// Calibration's metrics against R (wave 8, slice 2): web/lib/calibration.js on each case of
// reference/calibration.json (generate_calibration.R: pROC 1.19, PRROC 1.4, binom 1.1), given the
// very scores R computed on. The suite `calibration` (run.mjs) checks these.
//   - exact: the ROC curve's points, AUC and DeLong's interval; the precision–recall curve's area
//     and points; each rule's thresholds, the controls in each class, Wilson's intervals (relative
//     differences, R's numbers rounded to 13 significant digits);
//   - the bootstrap, drawn by MaveScape's own seeded generator: where each of R's quantiles (2.5%,
//     50%, 97.5%) falls among MaveScape's samples, F(v−) ≤ q + ε and F(v) ≥ q − ε with ε four
//     standard errors of the difference of two such quantile levels, √(2 q (1 − q) / n); the share
//     of samples leaving a class empty, or with no intermediate zone, within four of theirs. A
//     comparison of distributions, not of numbers, so that discrete thresholds and few controls
//     compare as fairly as many: a wrong method (no interpolation, a side not stratified, ties broken
//     the other way) puts some of the 1,092 quantiles outside.

import { readFileSync } from 'node:fs';
import { bootstrapMetrics, calibrationMetrics, prPoints, RECALL_GRID, SPECIFICITY_GRID, stepsOf } from '../web/lib/calibration.js';

export const CALIBRATION_REFERENCE = new URL('./reference/calibration.json', import.meta.url);
export const readCalibrationReference = () => JSON.parse(readFileSync(CALIBRATION_REFERENCE, 'utf8'));

// Relative difference; null (an infinite threshold) equal only to a non-finite value.
export function relative(a, b) {
  if (b === null || b === undefined) return Number.isFinite(a) ? Infinity : 0;
  if (a === null || !Number.isFinite(a)) return Infinity;
  return Math.abs(a - b) / Math.max(1, Math.abs(b));
}

const RULES = (c) => c.rules.map((r) => ({ rule: r.rule, error: r.error ?? 0.05, abnormal: r.abnormal, normal: r.normal, reference: r }));

// The deterministic numbers of a case: the largest relative difference of each kind, and anything
// that differs outright (a count, a length).
export function exactAgreement(c) {
  const out = { roc: 0, auc: 0, pr: 0, thresholds: 0, wilson: 0, differ: [] };
  const base = calibrationMetrics(c.P, c.B, { side: c.side, samples: 0 });
  const pts = base.roc.points;
  if (pts.length !== c.roc.threshold.length) out.differ.push(`ROC: ${pts.length} points, R ${c.roc.threshold.length}`);
  else pts.forEach((p, i) => { out.roc = Math.max(out.roc, relative(Number.isFinite(p.threshold) ? p.threshold : null, c.roc.threshold[i]), relative(p.sensitivity, c.roc.sensitivity[i]), relative(p.specificity, c.roc.specificity[i])); });
  out.auc = Math.max(relative(base.auc.auc, c.auc.auc), relative(base.auc.low, c.auc.low), relative(base.auc.high, c.auc.high));
  const o = (x) => (c.side === 'below' ? -x : x);
  const pp = prPoints(stepsOf(c.P.map(o), c.B.map(o)), 0);
  out.pr = relative(base.pr.auc, c.pr.auc);
  if (pp.length !== c.pr.recall.length) out.differ.push(`PR: ${pp.length} points, R ${c.pr.recall.length}`);
  else pp.forEach((p, i) => { out.pr = Math.max(out.pr, relative(p.recall, c.pr.recall[i]), relative(p.precision, c.pr.precision[i]), relative(p.threshold, c.pr.threshold[i])); });
  for (const r of RULES(c)) {
    const m = calibrationMetrics(c.P, c.B, { side: c.side, rule: r.rule, error: r.error, abnormal: r.abnormal, normal: r.normal, samples: 0 });
    const ref = r.reference;
    out.thresholds = Math.max(out.thresholds, relative(m.thresholds.abnormal, ref.abnormal), relative(m.thresholds.normal, ref.normal));
    for (const side of ['P', 'B']) {
      const mine = m.classes[side];
      const theirs = ref[side];
      if (['abnormal-like', 'intermediate', 'WT-like'].some((k) => mine[k] !== theirs[k])) out.differ.push(`${r.rule}${r.rule === 'error' ? ` ${r.error}` : ''} ${side}: ${JSON.stringify(mine)}, R ${JSON.stringify(theirs)}`);
    }
    for (const [mine, theirs] of [[m.sensitivity, ref.sensitivity], [m.specificity, ref.specificity]]) {
      if (mine.x !== theirs.x || mine.n !== theirs.n) out.differ.push(`${r.rule}: ${mine.x}/${mine.n}, R ${theirs.x}/${theirs.n}`);
      out.wilson = Math.max(out.wilson, relative(mine.p, theirs.p), relative(mine.low, theirs.low), relative(mine.high, theirs.high));
    }
  }
  return out;
}

// Where R's quantile v of level q falls among samples (the non-finite left out).
function quantileFits(samples, v, q, n) {
  const s = Array.from(samples).filter(Number.isFinite);
  if (v === null || v === undefined) return !s.length;
  const below = s.filter((x) => x < v - 1e-12).length / s.length;
  const upTo = s.filter((x) => x <= v + 1e-12).length / s.length;
  const eps = 4 * Math.sqrt((2 * q * (1 - q)) / n);
  return below <= q + eps && upTo >= q - eps;
}

const shareFits = (a, b, n) => {
  const p = (a + b) / 2;
  return Math.abs(a - b) <= 4 * Math.sqrt((2 * p * (1 - p)) / n) + 1e-9;
};

// The bootstrap of a case under each rule: { compared, outside: [what] }.
export function bootstrapAgreement(c, seed = 20261009) {
  const n = c.bootstrap.samples;
  const o = (x) => (c.side === 'below' ? -x : x);
  const oP = Float64Array.from(c.P, o);
  const oB = Float64Array.from(c.B, o);
  const outside = [];
  let compared = 0;
  const three = (label, samples, r) => {
    for (const [k, q] of [['low', 0.025], ['median', 0.5], ['high', 0.975]]) {
      compared += 1;
      if (!quantileFits(samples, r[k], q, n)) outside.push(`${label} ${k}`);
    }
  };
  const rules = [['error', 0.05], ['error', 0.1], ['youden', 0.05]];
  rules.forEach(([rule, error], i) => {
    const b = bootstrapMetrics(oP, oB, { rule, error, samples: n, seed, level: 0.95, keep: true });
    if (i === 0) {
      three('AUC', b.drawn.auc, c.bootstrap.auc);
      three('PR area', b.drawn.prAuc, c.bootstrap.prAuc);
      SPECIFICITY_GRID.forEach((v, g) => three(`sensitivity at ${v.toFixed(2)}`, b.drawn.roc[g], c.bootstrap.roc[g]));
      RECALL_GRID.forEach((v, g) => three(`precision at ${v.toFixed(2)}`, b.drawn.pr[g], c.bootstrap.pr[g]));
    }
    const ref = c.bootstrap.thresholds[i];
    const name = `${rule}${rule === 'error' ? ` ${error}` : ''}`;
    three(`${name} abnormal threshold`, Array.from(b.drawn.abnormal, (t) => (c.side === 'below' ? -t : t)), ref.abnormal);
    three(`${name} normal threshold`, Array.from(b.drawn.normal, (t) => (c.side === 'below' ? -t : t)), ref.normal);
    for (const k of ['abnormal', 'normal']) {
      compared += 1;
      if (!shareFits(b.thresholds.empty[k] / n, ref.empty[k] / n, n)) outside.push(`${name}: ${k} class empty in ${b.thresholds.empty[k]}, R ${ref.empty[k]}`);
    }
    compared += 1;
    if (!shareFits(b.thresholds.withoutZone, ref.withoutZone, n)) outside.push(`${name}: no intermediate zone in ${b.thresholds.withoutZone}, R ${ref.withoutZone}`);
  });
  return { compared, outside };
}
