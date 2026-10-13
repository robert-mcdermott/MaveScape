// Calibration's metrics (wave 8, slice 2; requirement K2), for research: how far a run's scores
// separate a control set's P controls from its B controls (lib/controls.js), and the functional
// classes thresholds on the scores make. Every statistic is checked against R (validation suite
// `calibration`, reference/generate_calibration.R): the ROC curve and its AUC with DeLong's interval
// as pROC 1.19 computes them, the precision–recall curve and its area as PRROC 1.4 does (Keilwagen,
// Grosse and Grau 2014's interpolation), Wilson's intervals as binom's, and the bootstrap's
// intervals as pROC's stratified bootstrap (within its Monte Carlo error).
//
// A calibration (ws.calibrations, lib/workspace.js) is made when asked, never by itself, and keeps
// what it was made with, so that it reads the same later:
//
//   { id, name, created, controlSet (its id), run (its id), condition (index),
//     side ('below' | 'above': where abnormal-like scores are), sideFrom ('readout' | 'controls' |
//     'chosen'), rule ('error' | 'youden' | 'given'), error (the rule 'error''s rate),
//     thresholds: { abnormal, normal } (null: that class is empty), bootstrap: { samples, seed },
//     n: { P, B } (the controls scored) }
//
// The classes are MaveScape's words for research use (mavescape-spec/conventions.md, Terminology):
// abnormal-like, intermediate and WT-like, never a clinical classification. With the side 'below',
// a score at or below the abnormal threshold is abnormal-like, one above the normal threshold
// WT-like, and one between them intermediate (the indeterminate zone); with 'above', the mirror
// image. A score equal to a threshold is on its abnormal-like side, as pROC's thresholds put a
// case at the threshold among the positives.
//
// Internally the scores are oriented so that higher is more abnormal-like (o = −x for 'below'):
// the P controls are pROC's cases and PRROC's foreground, with pROC's direction "<".

import { aucAgreement } from './agreement.js';
import { normalQuantile } from './distributions.js';
import { quantileSorted } from './stats.js';
import { createRandom } from './random.js';
import { log } from './dmath.js';
import { lossSide } from './readout.js';

export const RULES = ['error', 'youden', 'given'];
export const SCALE_SIDES = ['below', 'above'];
export const CLASSES = ['abnormal-like', 'intermediate', 'WT-like'];
// The bootstrap's samples as pROC's default (boot.n), and MaveScape's default seed (as scoring's).
export const CALIBRATION_DEFAULTS = { rule: 'error', error: 0.05, samples: 2000, seed: 20261009, level: 0.95 };
export const MAX_SAMPLES = 20000;
// The specificities the ROC curve's band is given at (pROC's ci.se, at seq(0, 1, 0.05)) and the
// recalls the precision–recall curve's is.
export const SPECIFICITY_GRID = Array.from({ length: 21 }, (_, k) => k * 0.05);
export const RECALL_GRID = Array.from({ length: 20 }, (_, k) => (k + 1) * 0.05);

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const orient = (values, side) => (side === 'below' ? Float64Array.from(values, (v) => -v) : Float64Array.from(values));
const unorient = (t, side) => (side === 'below' ? -t : t);

// --- The curves ----------------------------------------------------------------------------------------

// The controls as steps from the most abnormal-like score: u (each distinct oriented score,
// descending), tp and fp (the P and B controls scoring it or beyond), nP, nB.
export function stepsOf(oP, oB) {
  const a = Float64Array.from(oP).sort().reverse();
  const b = Float64Array.from(oB).sort().reverse();
  const k = a.length + b.length;
  const u = new Float64Array(k);
  const tp = new Int32Array(k);
  const fp = new Int32Array(k);
  let i = 0;
  let j = 0;
  let m = 0;
  let t = 0;
  let f = 0;
  while (i < a.length || j < b.length) {
    const v = j >= b.length || (i < a.length && a[i] >= b[j]) ? a[i] : b[j];
    while (i < a.length && a[i] === v) {
      i += 1;
      t += 1;
    }
    while (j < b.length && b[j] === v) {
      j += 1;
      f += 1;
    }
    u[m] = v;
    tp[m] = t;
    fp[m] = f;
    m += 1;
  }
  return { u: u.subarray(0, m), tp: tp.subarray(0, m), fp: fp.subarray(0, m), nP: a.length, nB: b.length };
}

// The ROC curve's points as pROC's roc() keeps them (sorted by specificity, ascending): a threshold
// below every score (−∞: every control called abnormal-like), one midway between each two distinct
// scores, and one above them all (+∞); each with its tp and fp (the P and B controls at or beyond
// it, oriented), sensitivity tp / nP and specificity (nB − fp) / nB. Thresholds oriented.
export function rocPoints(s) {
  const k = s.u.length;
  const threshold = new Float64Array(k + 1);
  const tp = new Int32Array(k + 1);
  const fp = new Int32Array(k + 1);
  threshold[0] = -Infinity;
  tp[0] = s.nP;
  fp[0] = s.nB;
  for (let r = 1; r < k; r += 1) {
    const j = k - 1 - r;
    threshold[r] = (s.u[j + 1] + s.u[j]) / 2;
    tp[r] = s.tp[j];
    fp[r] = s.fp[j];
  }
  threshold[k] = Infinity;
  const sensitivity = Float64Array.from(tp, (v) => v / s.nP);
  const specificity = Float64Array.from(fp, (v) => (s.nB - v) / s.nB);
  return { threshold, tp, fp, sensitivity, specificity, nP: s.nP, nB: s.nB };
}

// The AUC of steps: P(a P control scores beyond a B control) + ½ P(equal).
function aucOfSteps(s) {
  let sum = 0;
  let tpPrev = 0;
  let fpPrev = 0;
  for (let j = 0; j < s.u.length; j += 1) {
    sum += (s.fp[j] - fpPrev) * (tpPrev + (s.tp[j] - tpPrev) / 2);
    tpPrev = s.tp[j];
    fpPrev = s.fp[j];
  }
  return sum / (s.nP * s.nB);
}

// The area under the precision–recall curve as PRROC's pr.curve computes it (auc.integral):
// between two steps, precision follows the interpolation of Keilwagen, Grosse and Grau (PLoS ONE
// 2014;9:e92209), and each step's area is that of its curve, written out as in PRROC 1.4's
// compute.pr, in its order of operations.
export function prAuc(s) {
  const r = s.nP;
  let auc = 0;
  let tpPrev = 0;
  let fpPrev = 0;
  for (let j = 0; j < s.u.length; j += 1) {
    const tp = s.tp[j];
    const fp = s.fp[j];
    if (tp !== tpPrev) {
      const h = (fp - fpPrev) / (tp - tpPrev);
      const a = 1 + h;
      const b = (fpPrev - h * tpPrev) / r;
      auc += b === 0 ? (tp / r - tpPrev / r) / a : (tp / r - tpPrev / r - (b / a) * (log((a * tp) / r + b) - log((a * tpPrev) / r + b))) / a;
    }
    tpPrev = tp;
    fpPrev = fp;
  }
  return auc;
}

// The precision–recall curve's points as PRROC's (curve = TRUE, without its interpolated points):
// from recall 0 (the first step's precision) to 1, each step's recall, precision and threshold
// (oriented); and, for drawing, `steps` points within each step on Keilwagen's interpolation.
export function prPoints(s, steps = 0) {
  const points = [];
  let tpPrev = 0;
  let fpPrev = 0;
  for (let j = 0; j < s.u.length; j += 1) {
    const tp = s.tp[j];
    const fp = s.fp[j];
    if (steps && j > 0 && tp - tpPrev > 1) {
      const h = (fp - fpPrev) / (tp - tpPrev);
      for (let q = 1; q < steps; q += 1) {
        const x = ((tp - tpPrev) * q) / steps;
        points.push({ recall: (tpPrev + x) / s.nP, precision: (tpPrev + x) / (tpPrev + x + fpPrev + h * x), threshold: s.u[j], between: true });
      }
    }
    points.push({ recall: tp / s.nP, precision: tp / (tp + fp), threshold: s.u[j] });
    tpPrev = tp;
    fpPrev = fp;
  }
  if (points.length) {
    points.unshift({ ...points.find((p) => !p.between), recall: 0 });
    points.push({ ...points.at(-1), recall: 1 });
  }
  return points;
}

// The sensitivity at a specificity, as pROC's coords(input = "specificity") reads it from the
// curve: a point's own where one has it (the first, of the lowest threshold), else linearly
// between the two around it.
export function sensitivityAt(roc, value) {
  const sp = roc.specificity;
  const se = roc.sensitivity;
  for (let i = 0; i < sp.length; i += 1) if (sp[i] === value) return se[i];
  let next = 0;
  while (next < sp.length && !(sp[next] > value)) next += 1;
  if (next === 0 || next >= sp.length) return Number.NaN;
  const proportion = (value - sp[next]) / (sp[next - 1] - sp[next]);
  return se[next] + proportion * (se[next - 1] - se[next]);
}

// The precision at a recall on Keilwagen's interpolation: in the first step that reaches it.
export function precisionAt(s, recall) {
  const want = recall * s.nP;
  let tpPrev = 0;
  let fpPrev = 0;
  for (let j = 0; j < s.u.length; j += 1) {
    const tp = s.tp[j];
    const fp = s.fp[j];
    if (tp > tpPrev && tp >= want - 1e-9) {
      const h = (fp - fpPrev) / (tp - tpPrev);
      const x = Math.max(0, Math.min(tp - tpPrev, want - tpPrev));
      return (tpPrev + x) / (tpPrev + x + fpPrev + h * x);
    }
    tpPrev = tp;
    fpPrev = fp;
  }
  return Number.NaN;
}

// --- Thresholds ------------------------------------------------------------------------------------------

// The thresholds a rule sets on the ROC curve's points, oriented: { abnormal, normal, crossed }.
//   'error' (rate α): the abnormal threshold where the most P controls are abnormal-like with at
//     most α of the B controls so (ties: the fewer B); the normal threshold where the most B
//     controls are WT-like with at most α of the P controls so (ties: the more P). Where these
//     cross (sides so well apart that both hold over a range), both are its middle: no score is
//     intermediate. Counts compared as counts (fp ≤ ⌊α nB⌋).
//   'youden': the one threshold of the largest sensitivity + specificity (Youden's J, pROC's
//     coords "best"; ties: the higher specificity).
export function ruleThresholds(roc, rule, error = CALIBRATION_DEFAULTS.error) {
  const n = roc.threshold.length;
  if (rule === 'youden') {
    let best = -1;
    for (let i = 0; i < n; i += 1) {
      const j = roc.sensitivity[i] + roc.specificity[i];
      if (best < 0 || j > roc.sensitivity[best] + roc.specificity[best] || (j === roc.sensitivity[best] + roc.specificity[best] && roc.fp[i] < roc.fp[best])) best = i;
    }
    return { abnormal: roc.threshold[best], normal: roc.threshold[best], crossed: false };
  }
  const maxB = Math.floor(error * roc.nB + 1e-9);
  const maxP = Math.floor(error * roc.nP + 1e-9);
  let a = -1;
  let w = -1;
  for (let i = 0; i < n; i += 1) {
    if (roc.fp[i] <= maxB && (a < 0 || roc.tp[i] > roc.tp[a] || (roc.tp[i] === roc.tp[a] && roc.fp[i] < roc.fp[a]))) a = i;
    if (roc.nP - roc.tp[i] <= maxP && (w < 0 || roc.fp[i] < roc.fp[w] || (roc.fp[i] === roc.fp[w] && roc.tp[i] > roc.tp[w]))) w = i;
  }
  const abnormal = roc.threshold[a];
  const normal = roc.threshold[w];
  // Abnormal-like is at or beyond `abnormal`, WT-like short of `normal`: they cross when the first
  // is the lower.
  if (abnormal < normal) {
    const middle = (abnormal + normal) / 2;
    return { abnormal: middle, normal: middle, crossed: true };
  }
  return { abnormal, normal, crossed: false };
}

// A score's class: 'abnormal-like', 'intermediate' or 'WT-like'. thresholds on the scores' own
// scale, null for a class that is empty.
export function classOf(x, side, thresholds) {
  const a = thresholds.abnormal ?? (side === 'below' ? -Infinity : Infinity);
  const n = thresholds.normal ?? (side === 'below' ? Infinity : -Infinity);
  if (side === 'below') return x <= a ? 'abnormal-like' : x > n ? 'WT-like' : 'intermediate';
  return x >= a ? 'abnormal-like' : x < n ? 'WT-like' : 'intermediate';
}

// Values counted by class: { 'abnormal-like', intermediate, 'WT-like', total }.
export function classCounts(values, side, thresholds) {
  const out = { 'abnormal-like': 0, intermediate: 0, 'WT-like': 0, total: 0 };
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    out[classOf(v, side, thresholds)] += 1;
    out.total += 1;
  }
  return out;
}

// Given thresholds checked: on the side 'below' the abnormal threshold is at most the normal one.
export function checkGivenThresholds(side, abnormal, normal) {
  if (!Number.isFinite(abnormal) || !Number.isFinite(normal)) return 'Given thresholds are two numbers: the abnormal threshold and the normal one (the same number for one threshold).';
  if (side === 'below' ? abnormal > normal : abnormal < normal) return `With abnormal-like scores ${side} the others, the abnormal threshold is ${side === 'below' ? 'at or below' : 'at or above'} the normal one: ${abnormal} is ${side === 'below' ? 'above' : 'below'} ${normal}.`;
  return null;
}

// --- Intervals -----------------------------------------------------------------------------------------

// Wilson's score interval for x of n (Wilson 1927), as binom's binom.confint(method = "wilson").
export function wilson(x, n, level = 0.95) {
  if (!(n > 0)) return { x, n, p: Number.NaN, low: Number.NaN, high: Number.NaN };
  const p = x / n;
  const z = normalQuantile(1 - (1 - level) / 2);
  const z2 = z * z;
  const p1 = p + (0.5 * z2) / n;
  const p2 = z * Math.sqrt((p * (1 - p) + (0.25 * z2) / n) / n);
  const p3 = 1 + z2 / n;
  // Within [0, 1] as the interval is; clamped only for rounding (1 + 2e-16 at x = n).
  return { x, n, p, low: Math.max(0, (p1 - p2) / p3), high: Math.min(1, (p1 + p2) / p3) };
}

// Percentiles of values (R's type 7), the non-finite left out: { low, median, high, n }.
function percentiles(values, level) {
  const s = Float64Array.from(values.filter(Number.isFinite)).sort();
  const q = (1 - level) / 2;
  return { low: quantileSorted(s, q), median: quantileSorted(s, 0.5), high: quantileSorted(s, 1 - q), n: s.length };
}

// The stratified bootstrap (as pROC's, boot.stratified): `samples` times, each side's controls
// drawn again with replacement, as many as it has, by the seeded generator (lib/random.js; P then
// B). Each sample's AUC, area under the precision–recall curve, sensitivity at each specificity
// and precision at each recall of the grids, and (a rule's) thresholds. Returns their percentile
// intervals: { auc, prAuc, roc: [{ specificity, low, median, high }], pr: [{ recall, … }],
// thresholds: { abnormal, normal, withoutZone (the share of samples with no intermediate zone),
// empty: { abnormal, normal } (the samples that left that class empty) } | null }; with keep, also
// every sample's measures (drawn: { auc, prAuc, roc, pr, abnormal, normal }, thresholds oriented),
// for the validation's comparison of distributions.
export function bootstrapMetrics(oP, oB, { rule, error, samples, seed, level, keep = false }) {
  const random = createRandom(seed);
  const nP = oP.length;
  const nB = oB.length;
  const rp = new Float64Array(nP);
  const rb = new Float64Array(nB);
  const auc = new Float64Array(samples);
  const pr = new Float64Array(samples);
  const se = SPECIFICITY_GRID.map(() => new Float64Array(samples));
  const prec = RECALL_GRID.map(() => new Float64Array(samples));
  const abnormal = rule === 'given' ? null : new Float64Array(samples);
  const normal = rule === 'given' ? null : new Float64Array(samples);
  let withoutZone = 0;
  for (let k = 0; k < samples; k += 1) {
    for (let i = 0; i < nP; i += 1) rp[i] = oP[random.int(nP)];
    for (let i = 0; i < nB; i += 1) rb[i] = oB[random.int(nB)];
    const s = stepsOf(rp, rb);
    const roc = rocPoints(s);
    auc[k] = aucOfSteps(s);
    pr[k] = prAuc(s);
    SPECIFICITY_GRID.forEach((v, g) => { se[g][k] = sensitivityAt(roc, v); });
    RECALL_GRID.forEach((v, g) => { prec[g][k] = precisionAt(s, v); });
    if (abnormal) {
      const t = ruleThresholds(roc, rule, error);
      abnormal[k] = t.abnormal;
      normal[k] = t.normal;
      if (t.abnormal === t.normal) withoutZone += 1;
    }
  }
  const all = (a) => Array.from(a);
  return {
    samples, seed, level,
    ...(keep ? { drawn: { auc, prAuc: pr, roc: se, pr: prec, abnormal, normal } } : {}),
    auc: percentiles(all(auc), level),
    prAuc: percentiles(all(pr), level),
    roc: SPECIFICITY_GRID.map((v, g) => ({ specificity: v, ...percentiles(all(se[g]), level) })),
    pr: RECALL_GRID.map((v, g) => ({ recall: v, ...percentiles(all(prec[g]), level) })),
    // Oriented; percentiles of the finite thresholds (a class some samples leave empty gives ±∞).
    thresholds: abnormal ? { abnormal: percentiles(all(abnormal), level), normal: percentiles(all(normal), level), withoutZone: withoutZone / samples, empty: { abnormal: all(abnormal).filter((v) => !Number.isFinite(v)).length, normal: all(normal).filter((v) => !Number.isFinite(v)).length } } : null,
  };
}

// --- A calibration ------------------------------------------------------------------------------------

// The scored controls of a set in a run (matchControls's match, lib/controls.js), by side:
// { P: { keys, scores }, B: … }.
export function controlScores(set, match, condition = 0) {
  const score = match.view.conditions[condition]?.score;
  const out = { P: { keys: [], scores: [] }, B: { keys: [], scores: [] } };
  set.labels.forEach((l, k) => {
    const i = match.rows[k];
    if (i >= 0 && score && Number.isFinite(score[i])) {
      out[l.side].keys.push(l.key);
      out[l.side].scores.push(score[i]);
    }
  });
  return out;
}

const medianOf = (values) => quantileSorted(Float64Array.from(values).sort(), 0.5);

// Where abnormal-like scores are: chosen ('below' or 'above'), else the design's readout's side
// for less function when it is stated, else the side of the P controls' median (pROC's direction
// "auto": below when the B controls' median is the higher). Returns { side, from, against } where
// against is set when the controls' medians run the other way to the readout.
export function scaleSide(choice, design, P, B) {
  const mP = medianOf(P);
  const mB = medianOf(B);
  const byControls = mB > mP ? 'below' : 'above';
  if (choice === 'below' || choice === 'above') return { side: choice, from: 'chosen', against: Number.isFinite(mP) && Number.isFinite(mB) && mP !== mB && byControls !== choice ? { P: mP, B: mB } : null };
  const loss = lossSide(design);
  if (loss.stated && (loss.side === 'below' || loss.side === 'above')) return { side: loss.side, from: 'readout', against: Number.isFinite(mP) && Number.isFinite(mB) && mP !== mB && byControls !== loss.side ? { P: mP, B: mB } : null };
  return { side: byControls, from: 'controls', against: null };
}

// Every metric of P's and B's scores (the scored controls) under the settings { side, rule, error,
// abnormal, normal (given), samples, seed, level }:
//   { n, side, distributions: { P: { median, q1, q3, min, max }, B }, auc (DeLong's, with the
//     bootstrap's), roc: { points (thresholds on the scores' scale), band }, pr: { auc, baseline,
//     points, band, boot }, thresholds: { rule, error, abnormal, normal, crossed, stability },
//     classes: { P: counts, B: counts }, sensitivity, specificity (Wilson), misses: { P (WT-like),
//     B (abnormal-like) } }.
// Needs a control on each side; the intervals two.
export function calibrationMetrics(P, B, settings) {
  const s0 = { ...CALIBRATION_DEFAULTS, ...settings };
  const { side, rule, level } = s0;
  if (!SCALE_SIDES.includes(side)) throw new Error(`The side of abnormal-like scores is below or above, not "${side}".`);
  if (!RULES.includes(rule)) throw new Error(`Thresholds are set by ${RULES.join(', ')}, not "${rule}".`);
  if (!P.length || !B.length) throw new Error(`Calibration needs scored controls on both sides: ${plural(P.length, 'P control')} and ${plural(B.length, 'B control')} are scored.`);
  if (rule === 'error' && !(s0.error > 0 && s0.error < 0.5)) throw new Error('The rate of the rule "error" is above 0 and below 0.5 (0.05: at most 5% of each side misclassified).');
  if (!(Number.isInteger(s0.samples) && s0.samples >= 0 && s0.samples <= MAX_SAMPLES)) throw new Error(`The bootstrap's samples are a whole number from 0 to ${MAX_SAMPLES}.`);
  const oP = orient(P, side);
  const oB = orient(B, side);
  const steps = stepsOf(oP, oB);
  const roc = rocPoints(steps);
  // Thresholds, on the scores' own scale.
  let thresholds;
  if (rule === 'given') {
    const number = (v) => (v === null || v === undefined || v === '' ? Number.NaN : Number(v));
    const problem = checkGivenThresholds(side, number(s0.abnormal), number(s0.normal));
    if (problem) throw new Error(problem);
    thresholds = { abnormal: number(s0.abnormal), normal: number(s0.normal), crossed: false };
  } else {
    const t = ruleThresholds(roc, rule, s0.error);
    thresholds = { abnormal: unorient(t.abnormal, side), normal: unorient(t.normal, side), crossed: t.crossed };
  }
  const finiteOrNull = (v) => (Number.isFinite(v) ? v : null);
  thresholds = { abnormal: finiteOrNull(thresholds.abnormal), normal: finiteOrNull(thresholds.normal), crossed: thresholds.crossed };
  const classes = { P: classCounts(P, side, thresholds), B: classCounts(B, side, thresholds) };
  const delong = aucAgreement(oP, oB, level);
  const boot = s0.samples > 0 && P.length >= 2 && B.length >= 2 ? bootstrapMetrics(oP, oB, { ...s0 }) : null;
  const summary = (values) => {
    const s = Float64Array.from(values).sort();
    return { n: s.length, median: quantileSorted(s, 0.5), q1: quantileSorted(s, 0.25), q3: quantileSorted(s, 0.75), min: s[0], max: s[s.length - 1] };
  };
  const unorientBand = (t) => (t ? { low: unorient(side === 'below' ? t.high : t.low, side), median: unorient(t.median, side), high: unorient(side === 'below' ? t.low : t.high, side), n: t.n } : null);
  return {
    n: { P: P.length, B: B.length },
    side, rule, error: rule === 'error' ? s0.error : null, level,
    distributions: { P: summary(P), B: summary(B) },
    auc: { auc: delong.auc, low: delong.low, high: delong.high, se: delong.se, boot: boot?.auc ?? null },
    roc: {
      points: Array.from(roc.threshold, (t, i) => ({ threshold: unorient(t, side), sensitivity: roc.sensitivity[i], specificity: roc.specificity[i] })),
      band: boot?.roc ?? null,
    },
    pr: {
      auc: prAuc(steps), baseline: P.length / (P.length + B.length), boot: boot?.prAuc ?? null,
      points: prPoints(steps, 8).map((p) => ({ ...p, threshold: unorient(p.threshold, side) })),
      band: boot?.pr ?? null,
    },
    thresholds: {
      rule, error: rule === 'error' ? s0.error : null, ...thresholds,
      stability: boot?.thresholds ? { abnormal: unorientBand(boot.thresholds.abnormal), normal: unorientBand(boot.thresholds.normal), withoutZone: boot.thresholds.withoutZone, empty: boot.thresholds.empty } : null,
    },
    bootstrap: boot ? { samples: boot.samples, seed: boot.seed } : null,
    classes,
    sensitivity: wilson(classes.P['abnormal-like'], P.length, level),
    specificity: wilson(classes.B['WT-like'], B.length, level),
    misses: { P: wilson(classes.P['WT-like'], P.length, level), B: wilson(classes.B['abnormal-like'], B.length, level) },
  };
}

// --- Words ---------------------------------------------------------------------------------------------

const g3 = (x) => (Number.isFinite(x) ? Number(x.toPrecision(3)).toString() : '—');
const pct = (x) => (Number.isFinite(x) ? `${(100 * x).toFixed(Math.abs(100 * x - Math.round(100 * x)) < 0.05 ? 0 : 1)}%` : '—');

export const ruleWords = (rule, error) => (rule === 'error' ? `at most ${pct(error)} of either side's controls on the other side's class` : rule === 'youden' ? 'one threshold, of the largest sensitivity + specificity (Youden\'s J)' : 'given thresholds');

// A calibration's thresholds as the classes' ranges: "abnormal-like ≤ −1.2; intermediate −1.2 to
// −0.4; WT-like > −0.4".
export function thresholdWords(side, thresholds) {
  const { abnormal: a, normal: n } = thresholds;
  const lo = side === 'below';
  const ab = a === null ? 'abnormal-like: none' : `abnormal-like ${lo ? '≤' : '≥'} ${g3(a)}`;
  const wt = n === null ? 'WT-like: none' : `WT-like ${lo ? '>' : '<'} ${g3(n)}`;
  const between = a !== null && n !== null && a !== n ? `; intermediate ${lo ? `${g3(a)} to ${g3(n)}` : `${g3(n)} to ${g3(a)}`}` : a !== null && n !== null ? '; no intermediate zone' : '';
  return `${ab}${between}; ${wt}`;
}

// A calibration in a sentence, with its metrics when given.
export function calibrationWords(cal, { set = null, run = null, metrics = null } = {}) {
  const parts = [`"${cal.name}": ${run?.name ?? cal.run} against ${set ? `"${set.name}"` : cal.controlSet}, ${plural(cal.n.P, 'P control')} and ${plural(cal.n.B, 'B control')} scored`];
  if (metrics) parts.push(`AUC ${g3(metrics.auc.auc)} (${g3(metrics.auc.low)} to ${g3(metrics.auc.high)})`);
  parts.push(thresholdWords(cal.side, cal.thresholds));
  return parts.join('; ');
}

export { pct as percentText, g3 as threeFigures };
