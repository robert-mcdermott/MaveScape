// Score-level likelihood ratios, for research (wave 8, slice 4; requirement K3): how much more
// likely a score is among the P controls than among the B controls, at each score, and the
// evidence strength that makes for each variant and each range of scores. The method is
// acmgscaler's (Badonyi, Bioinformatics 2025), ported from its R package 1.0.0 (CRAN, MIT; its
// functions find_pvst, thresholds_from_pvst, build_grid, density_ratio, resample_density,
// monotonise, median_ci, score_interval, add_evidence_levels), with R's numerics as lib/rcompat.js
// gives them, so that the results equal the package's (validation suite `likelihood`,
// reference/generate_likelihood.R). acmgscaler's notice:
//
//   Copyright (c) 2025 Mihaly Badonyi
//
//   Permission is hereby granted, free of charge, to any person obtaining a copy of this software
//   and associated documentation files (the "Software"), to deal in the Software without
//   restriction, including without limitation the rights to use, copy, modify, merge, publish,
//   distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
//   Software is furnished to do so, subject to the following conditions:
//
//   The above copyright notice and this permission notice shall be included in all copies or
//   substantial portions of the Software.
//
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
//   BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
//   NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
//   DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
//   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
//
// The method: the scores rescaled to [0, 1] by the controls' range (the others clamped to it); each
// side's density on a grid of 1,024, a Gaussian kernel of the side's biased cross-validation
// bandwidth, in 1,000 bootstrap samples; the log ratio of the densities, each with a regularizing
// term (each grid point's median absolute deviation of the log ratio over the samples, scaled),
// made monotone (isotonic regression, the direction the scores' Spearman correlation with it
// says); the samples' median at each grid point with an interval from its order statistics,
// itself made monotone. The evidence thresholds are Tavtigian et al. (2018)'s: a single line of
// very strong evidence a likelihood ratio c, strong √c, moderate c^¼, supporting c^⅛ (benign the
// reciprocals), c the smallest that satisfies the ACMG/AMP combining rules at the prior (350 at
// 0.1). A variant's strength is read from the conservative end of its ratio's interval.
//
// The words are evidence strength for research use (mavescape-spec/conventions.md, Terminology):
// what a score would contribute as functional evidence, never a variant's classification.

import { rRandom, resample, mad, median, spearman, binomialQuantile, linspace, findInterval, approx, isotonic, bandwidthBCV, gaussianDensity } from './rcompat.js';
import { exp, log, pow } from './dmath.js';

// The strengths in acmgscaler's order and words (a variant's "indeterminate" in lower case, as the
// package writes it), and the boundaries between them (its threshold table's, "Indeterminate").
export const EVIDENCE = ['Benign-VeryStrong', 'Benign-Strong', 'Benign-Moderate', 'Benign-Supporting', 'indeterminate', 'Pathogenic-Supporting', 'Pathogenic-Moderate', 'Pathogenic-Strong', 'Pathogenic-VeryStrong'];
export const BOUNDARIES = ['Benign-VeryStrong|Benign-Strong', 'Benign-Strong|Benign-Moderate', 'Benign-Moderate|Benign-Supporting', 'Benign-Supporting|Indeterminate', 'Indeterminate|Pathogenic-Supporting', 'Pathogenic-Supporting|Pathogenic-Moderate', 'Pathogenic-Moderate|Pathogenic-Strong', 'Pathogenic-Strong|Pathogenic-VeryStrong'];
// acmgscaler's minimum: ten controls of each side.
export const MIN_CONTROLS = 10;
// Pejaver et al. 2022's (AJHG 109:2163–2177) Table 1: at the prior 0.0441, c = 1,124.
export const PEJAVER_2022 = { prior: 0.0441, c: 1124 };

// The c of the prior (acmgscaler's find_pvst): the largest c below the first at which 13 of the 14
// ACMG/AMP combining rules give a posterior of at least 0.9 (likely pathogenic, the first six) or
// 0.99 (pathogenic, the other eight). 8573 at a prior of 0.01 or less, 1 above 0.97.
export function findPvst(prior) {
  if (prior <= 0.01) return 8573;
  if (prior > 0.97) return 1;
  for (let pvst = 1; pvst <= 8573; pvst += 1) {
    const su = pow(pvst, 0.125);
    const mo = pow(pvst, 0.25);
    const st = pow(pvst, 0.5);
    // Integer powers as products, the same in every engine.
    const su2 = su * su;
    const mo2 = mo * mo;
    const mo3 = mo2 * mo;
    const su4 = su2 * su2;
    const lr = [mo * pvst, mo * st, su2 * st, mo3, su2 * mo2, su4 * mo, st * pvst, mo2 * pvst, su * mo * pvst, su2 * pvst, st * st, mo3 * st, su2 * mo2 * st, su4 * mo * st];
    let met = 0;
    lr.forEach((x, k) => {
      const post = (x * prior) / ((x - 1) * prior + 1);
      if (post >= (k < 6 ? 0.9 : 0.99)) met += 1;
    });
    if (met === 13) return pvst - 1;
  }
  return Number.NaN;
}

// The likelihood ratios bounding each strength (acmgscaler's thresholds_from_pvst): benign very
// strong 1/c, strong 1/√c, moderate c^−¼, supporting c^−⅛; pathogenic the reciprocals.
export function thresholdsFromPvst(pvst) {
  return [1 / pvst, 1 / pow(pvst, 0.5), 1 / pow(pvst, 0.25), 1 / pow(pvst, 0.125), pow(pvst, 0.125), pow(pvst, 0.25), pow(pvst, 0.5), pvst];
}

// A side's densities on the grid in 1,000 bootstrap samples (acmgscaler's resample_density): the
// bandwidth once, by biased cross-validation on the side's scores (bw.bcv, nb = 1024); each sample
// drawn with replacement, its density at 1,024 points, read at the grid (the ends' values beyond).
function resampleDensity(x, grid, random) {
  const bw = bandwidthBCV(x, 1024);
  const rows = [];
  for (let i = 0; i < 1000; i += 1) {
    const d = gaussianDensity(resample(x, random), bw, 1024);
    rows.push(approx(d.x, d.y, grid, { rule: 2 }));
  }
  return rows;
}

// The median of a column and the interval its order statistics give (acmgscaler's median_ci):
// the L-th and (n − L + 1)-th, L the binomial(n, ½) quantile at 0.025.
function medianInterval(values) {
  const n = values.length;
  const L = binomialQuantile(0.025, n, 0.5);
  const s = Float64Array.from(values).sort();
  return [s[L - 1], median(values), s[n - L]];
}

const monotonise = (x, inverse) => (inverse ? isotonic(Array.from(x).reverse()).reverse() : isotonic(x));

// The log likelihood ratio on the grid and at each score (acmgscaler's density_ratio). x: the
// scores in order, cls: each one's side ('P', 'B' or 'U'), t: the log thresholds. Returns { lrLower,
// lr, lrUpper (at each score), grid (on the scores' scale), llr, lo, hi (on the grid), inverse
// (lower scores the more pathogenic), tLower, t, tUpper (the score at each threshold, NaN where
// the curve does not reach it) }.
export function densityRatio(x, cls, t, random) {
  let a = Infinity;
  let b = -Infinity;
  x.forEach((v, i) => {
    if ((cls[i] === 'P' || cls[i] === 'B') && Number.isFinite(v)) {
      if (v < a) a = v;
      if (v > b) b = v;
    }
  });
  const scaled = Float64Array.from(x, (v) => ((v < a ? a : v > b ? b : v) - a) / (b - a));
  const grid = linspace(0, 1, 1024);
  const gridX = Float64Array.from(grid, (g) => g * (b - a) + a);
  const idx = findInterval(scaled, grid);
  const pd = resampleDensity(Array.from(scaled).filter((_, i) => cls[i] === 'P'), grid, random);
  const bd = resampleDensity(Array.from(scaled).filter((_, i) => cls[i] === 'B'), grid, random);
  const eps = Number.EPSILON;
  const G = grid.length;
  const R = pd.length;
  const mads = new Float64Array(G);
  const column = new Float64Array(R);
  for (let j = 0; j < G; j += 1) {
    for (let i = 0; i < R; i += 1) column[i] = log(pd[i][j] + eps) - log(bd[i][j] + eps);
    mads[j] = mad(column);
  }
  let top = -Infinity;
  let sum = 0;
  let sq = 0;
  for (let j = 0; j < G; j += 1) {
    if (mads[j] > top) top = mads[j];
    sum += mads[j];
    if (j) {
      const d = mads[j] - mads[j - 1];
      sq += d * d;
    }
  }
  const lambda = Float64Array.from(mads, (m) => ((m / top) * Math.sqrt(sq)) / sum);
  const llrRows = pd.map((row, i) => Float64Array.from(row, (p, j) => log(p + lambda[j]) - log(bd[i][j] + lambda[j])));
  const colMeans = new Float64Array(G);
  for (let j = 0; j < G; j += 1) {
    let s = 0;
    for (let i = 0; i < R; i += 1) s += llrRows[i][j];
    colMeans[j] = s / R;
  }
  const inverse = spearman(Array.from(idx, (k) => colMeans[k - 1]), scaled) < 0;
  for (let i = 0; i < R; i += 1) llrRows[i] = monotonise(llrRows[i], inverse);
  const lower = new Float64Array(G);
  const mid = new Float64Array(G);
  const upper = new Float64Array(G);
  for (let j = 0; j < G; j += 1) {
    for (let i = 0; i < R; i += 1) column[i] = llrRows[i][j];
    [lower[j], mid[j], upper[j]] = medianInterval(column);
  }
  const llr = monotonise(mid, inverse);
  const lo = Float64Array.from(llr, (v, j) => lower[j] + mid[j] - v);
  const hi = Float64Array.from(llr, (v, j) => upper[j] + mid[j] - v);
  const at = (curve) => approx(curve, gridX, t, { rule: 1 });
  const xLo = at(lo);
  const xTh = at(llr);
  const xHi = at(hi);
  return {
    lrLower: Float64Array.from(idx, (k) => exp(lo[k - 1])),
    lr: Float64Array.from(idx, (k) => exp(llr[k - 1])),
    lrUpper: Float64Array.from(idx, (k) => exp(hi[k - 1])),
    grid: gridX, llr, lo, hi, inverse,
    tLower: inverse ? xLo : xHi, t: xTh, tUpper: inverse ? xHi : xLo,
  };
}

// A variant's strength (acmgscaler's add_evidence_levels): from its ratio's conservative end (the
// upper below 1, the lower otherwise), benign below each threshold, pathogenic beyond, the
// supporting thresholds themselves indeterminate.
export function evidenceOf(lr, lrLower, lrUpper, thresholds) {
  if (!Number.isFinite(lr)) return null;
  const v = lr < 1 ? lrUpper : lrLower;
  const lp = thresholds;
  if (v < lp[0]) return EVIDENCE[0];
  if (v < lp[1]) return EVIDENCE[1];
  if (v < lp[2]) return EVIDENCE[2];
  if (v < lp[3]) return EVIDENCE[3];
  if (v <= lp[4]) return EVIDENCE[4];
  if (v <= lp[5]) return EVIDENCE[5];
  if (v <= lp[6]) return EVIDENCE[6];
  if (v <= lp[7]) return EVIDENCE[7];
  return EVIDENCE[8];
}

// Likelihood ratios of scores (acmgscaler's build_grid): rows [{ score, class: 'P' | 'B' | other }]
// in any order; those without a score are left out, the others taken by score, highest first (as
// the package orders them, ties kept in their order). options: { pvst, random (rRandom's) }.
// Returns { rows: [{ lrLower, lr, lrUpper, evidence }] in the rows' order (null without a score or
// with fewer than 20 scored), thresholds: [{ boundary, lr, lower, score, upper }], curve } or,
// with too few controls, { problem }.
export function scoreLikelihoods(rows, { pvst, random }) {
  const cls = rows.map((r) => (String(r.class ?? '').toUpperCase() === 'P' ? 'P' : String(r.class ?? '').toUpperCase() === 'B' ? 'B' : 'U'));
  const nP = cls.filter((c, i) => c === 'P' && Number.isFinite(rows[i].score)).length;
  const nB = cls.filter((c, i) => c === 'B' && Number.isFinite(rows[i].score)).length;
  if (nP < MIN_CONTROLS || nB < MIN_CONTROLS) return { problem: `Score-level likelihood ratios need at least ${MIN_CONTROLS} P and ${MIN_CONTROLS} B controls scored (acmgscaler's minimum): ${nP} P and ${nB} B are.` };
  const kept = rows.map((r, i) => i).filter((i) => Number.isFinite(rows[i].score) && !Number.isNaN(rows[i].score));
  const out = rows.map(() => null);
  const thresholds = thresholdsFromPvst(pvst);
  if (kept.length < 20) return { rows: out, thresholds: BOUNDARIES.map((boundary, k) => ({ boundary, lr: thresholds[k], lower: null, score: null, upper: null })), curve: null };
  // Highest first; R's order(decreasing = TRUE) keeps ties in their order.
  const sorted = kept.slice().sort((a, b) => rows[b].score - rows[a].score || a - b);
  const d = densityRatio(sorted.map((i) => rows[i].score), sorted.map((i) => cls[i]), thresholds.map((v) => log(v)), random);
  sorted.forEach((i, k) => {
    out[i] = { lrLower: d.lrLower[k], lr: d.lr[k], lrUpper: d.lrUpper[k], evidence: evidenceOf(d.lr[k], d.lrLower[k], d.lrUpper[k], thresholds) };
  });
  const finiteOrNull = (v) => (Number.isFinite(v) ? v : null);
  return {
    rows: out,
    thresholds: BOUNDARIES.map((boundary, k) => ({ boundary, lr: thresholds[k], lower: finiteOrNull(d.tLower[k]), score: finiteOrNull(d.t[k]), upper: finiteOrNull(d.tUpper[k]) })),
    curve: { grid: d.grid, llr: d.llr, lo: d.lo, hi: d.hi, inverse: d.inverse },
  };
}

// A calibration's likelihood settings: { from: 'prior', prior, c } (c by acmgscaler's search from
// the prior, 0.1 by default: 350) or Pejaver et al.'s Table 1, { from: 'pejaver2022', prior: 0.0441,
// c: 1124 } (acmgscaler's search at that prior gives 1131).
export function likelihoodSettings({ prior = null, pejaver = false, from = null } = {}) {
  if (pejaver || from === 'pejaver2022') return { from: 'pejaver2022', ...PEJAVER_2022 };
  const p = prior === null || prior === undefined ? 0.1 : Number(prior);
  if (!(p > 0 && p < 1)) throw new Error('The prior of pathogenicity is between 0 and 1 (0.1, acmgscaler\'s default; 0.0441, Pejaver et al.\'s).');
  return { from: 'prior', prior: p, c: findPvst(p) };
}

// The settings in words: "prior 0.1, c = 350", "Pejaver et al. 2022's Table 1: prior 0.0441, c =
// 1,124".
export const likelihoodWords = (s) => `${s.from === 'pejaver2022' ? 'Pejaver et al. 2022\'s Table 1: ' : ''}prior ${s.prior}, c = ${s.c.toLocaleString('en-US')}`;

// acmgscaler's calibrate(df, value, prior, seed) for one set of scores: the generator seeded as
// set.seed(seed) seeds R's, c from the prior (or given). Returns scoreLikelihoods's, with { prior,
// pvst }.
export function calibrateScores(rows, { prior = 0.1, seed = 42, pvst = null, random = null } = {}) {
  if (!(prior > 0 && prior < 1)) throw new Error('The prior is between 0 and 1.');
  const c = pvst ?? findPvst(prior);
  const r = scoreLikelihoods(rows, { pvst: c, random: random ?? rRandom(seed) });
  return { ...r, prior, pvst: c };
}
