// Combining biological replicates (requirement S2). Technical replicates are pooled first (their
// counts summed, poolColumns); each biological replicate is scored on its own, and the replicate
// scores of a variant are combined here:
//
// - fixed effects: the inverse-variance weighted mean;
// - REML random effects: τ² by Fisher scoring as metafor's rma(method = "REML") computes it (the
//   Hedges estimate to start, step halving at τ² = 0, the check against τ² = 0), run to
//   convergence;
// - Enrich2's estimator, exactly as Enrich2 2.0.2 computes it (enrich2/random_effects.py): τ²
//   starts from the spread of the replicate scores divided by the number of *variants* less one,
//   and is updated 50 times without a test of convergence (mavescape-spec/research.md §2.1). Its
//   fixed point is the REML condition, so where it has converged it equals REML.
//
// Each combination reports Cochran's Q, I² and τ², and leave-one-replicate-out sensitivity.
// Variances (v = SE²), not SEs, are passed in.

import { log, square } from './dmath.js';

// Sums the columns of technical replicates: a count missing (NaN) in any column is missing in
// the sum, never read as 0.
export function poolColumns(columns) {
  if (columns.length === 1) return columns[0];
  const n = columns[0].length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    let sum = 0;
    for (const column of columns) sum += column[i];
    out[i] = sum;
  }
  return out;
}

// Inverse-variance weighted mean: { estimate, se, tau2: 0 }. A variance of 0 (a score known
// exactly, as the wild type's in some modes) takes all the weight: the mean of those scores, SE 0.
export function combineFixed(y, v) {
  const k = y.length;
  if (!k) return { estimate: Number.NaN, se: Number.NaN, tau2: Number.NaN };
  const exact = [];
  for (let j = 0; j < k; j += 1) if (v[j] === 0) exact.push(y[j]);
  if (exact.length) return { estimate: exact.reduce((a, b) => a + b, 0) / exact.length, se: 0, tau2: 0 };
  let sw = 0;
  let swy = 0;
  for (let j = 0; j < k; j += 1) {
    const w = 1 / v[j];
    sw += w;
    swy += w * y[j];
  }
  return { estimate: swy / sw, se: Math.sqrt(1 / sw), tau2: 0 };
}

// Cochran's Q about the fixed-effect mean, its degrees of freedom and I² = (Q − df) / Q, floored
// at 0 (Higgins & Thompson 2002). NaN for one replicate.
export function heterogeneity(y, v) {
  const k = y.length;
  if (k < 2 || v.some((x) => x === 0)) return { q: Number.NaN, df: k - 1, i2: Number.NaN };
  const { estimate } = combineFixed(y, v);
  let q = 0;
  for (let j = 0; j < k; j += 1) q += square(y[j] - estimate) / v[j];
  return { q, df: k - 1, i2: q > 0 ? Math.max(0, (q - (k - 1)) / q) : 0 };
}

// The restricted log-likelihood of an intercept-only random-effects model at τ² (up to the
// constant metafor also leaves out of its comparison).
function remlLogLikelihood(y, v, tau2) {
  let sw = 0;
  let swy = 0;
  let logs = 0;
  for (let j = 0; j < y.length; j += 1) {
    const w = 1 / (v[j] + tau2);
    sw += w;
    swy += w * y[j];
    logs += log(v[j] + tau2);
  }
  const beta = swy / sw;
  let rss = 0;
  for (let j = 0; j < y.length; j += 1) rss += square(y[j] - beta) / (v[j] + tau2);
  return -0.5 * logs - 0.5 * log(sw) - 0.5 * rss;
}

export const REML_DEFAULTS = { threshold: 1e-12, maxIterations: 1000, tolerance: 1.220703125e-4 };

// REML random effects: { estimate, se, tau2, iterations, converged }. One replicate passes
// through unchanged (τ² cannot be estimated: NaN). Fisher scoring as metafor 5.2: start from the
// Hedges estimate max(0, var(y) − mean(v)); step by (y'PPy − tr P) / tr PP, halved while it would
// make τ² negative; stop when τ² changes by less than `threshold`; then, if τ² = 0 gives a higher
// restricted likelihood (by more than `tolerance`), take τ² = 0.
export function combineREML(y, v, options = {}) {
  const k = y.length;
  if (!k) return { estimate: Number.NaN, se: Number.NaN, tau2: Number.NaN, iterations: 0, converged: false };
  if (k === 1) return { estimate: y[0], se: Math.sqrt(v[0]), tau2: Number.NaN, iterations: 0, converged: true };
  if (v.some((x) => x === 0)) return { ...combineFixed(y, v), iterations: 0, converged: true };
  const { threshold, maxIterations, tolerance } = { ...REML_DEFAULTS, ...options };
  let mean = 0;
  let meanV = 0;
  for (let j = 0; j < k; j += 1) {
    mean += y[j];
    meanV += v[j];
  }
  mean /= k;
  meanV /= k;
  let spread = 0;
  for (let j = 0; j < k; j += 1) spread += square(y[j] - mean);
  let tau2 = Math.max(0, spread / (k - 1) - meanV);
  let iterations = 0;
  let converged = true;
  let change = threshold + 1;
  while (change > threshold) {
    iterations += 1;
    const old = tau2;
    let sw = 0;
    let sw2 = 0;
    let sw3 = 0;
    let swy = 0;
    for (let j = 0; j < k; j += 1) {
      const w = 1 / (v[j] + tau2);
      sw += w;
      sw2 += w * w;
      sw3 += w * w * w;
      swy += w * y[j];
    }
    const beta = swy / sw;
    // P = W − w wᵀ / Σw: Py = w (y − β), tr P = Σw − Σw²/Σw, tr PP = Σw² − 2Σw³/Σw + (Σw²/Σw)².
    let yPPy = 0;
    for (let j = 0; j < k; j += 1) {
      const w = 1 / (v[j] + tau2);
      yPPy += square(w * (y[j] - beta));
    }
    const trP = sw - sw2 / sw;
    const trPP = sw2 - (2 * sw3) / sw + square(sw2 / sw);
    let adj = (yPPy - trP) / trPP;
    if (!Number.isFinite(adj)) adj = 0;
    while (tau2 + adj < 0) adj /= 2;
    tau2 += adj;
    change = Math.abs(old - tau2);
    if (iterations > maxIterations) {
      converged = false;
      break;
    }
  }
  if (converged && tau2 > threshold && remlLogLikelihood(y, v, 0) - remlLogLikelihood(y, v, tau2) > tolerance) tau2 = 0;
  let sw = 0;
  let swy = 0;
  for (let j = 0; j < k; j += 1) {
    const w = 1 / (v[j] + tau2);
    sw += w;
    swy += w * y[j];
  }
  return { estimate: swy / sw, se: Math.sqrt(1 / sw), tau2, iterations, converged };
}

// Enrich2 2.0.2's estimator for one variant, given V, the number of variants Enrich2 combines
// (those scored in every replicate), on which its starting value depends. Returns { estimate, se,
// tau2, epsilon } (epsilon: the last change in τ², which Enrich2 reports; 0 when converged).
export function combineEnrich2(y, v, V, iterations = 50) {
  const k = y.length;
  if (k === 1) return { estimate: y[0], se: Math.sqrt(v[0]), tau2: Number.NaN, epsilon: 0 };
  let mean = 0;
  for (let j = 0; j < k; j += 1) mean += y[j];
  mean /= k;
  let tau2 = 0;
  for (let j = 0; j < k; j += 1) tau2 += square(y[j] - mean) / (V - 1);
  let beta = Number.NaN;
  let epsilon = 0;
  for (let it = 0; it < iterations; it += 1) {
    let sw = 0;
    let sw2 = 0;
    let swy = 0;
    for (let j = 0; j < k; j += 1) {
      const w = 1 / (v[j] + tau2);
      sw += w;
      sw2 += w * w;
      swy += w * y[j];
    }
    beta = swy / sw;
    let num = 0;
    for (let j = 0; j < k; j += 1) {
      const w = 1 / (v[j] + tau2);
      num += square(y[j] - beta) * w * w;
    }
    const next = (tau2 * num) / (sw - sw2 / sw);
    epsilon = Math.abs(tau2 - next);
    tau2 = next;
  }
  let inv = 0;
  for (let j = 0; j < k; j += 1) inv += 1 / (v[j] + tau2);
  return { estimate: beta, se: Math.sqrt(1 / inv), tau2, epsilon };
}

export const COMBINATIONS = {
  reml: 'REML random effects',
  fixed: 'fixed effects (inverse variance)',
  enrich2: 'Enrich2\'s estimator (compatible)',
};

// One variant's combination by method ('reml', 'fixed' or 'enrich2', which needs V).
export function combine(method, y, v, V) {
  if (method === 'fixed') return combineFixed(y, v);
  if (method === 'enrich2') return combineEnrich2(y, v, V);
  return combineREML(y, v);
}

// Leave-one-replicate-out sensitivity: the combined estimate without each replicate in turn
// (by fixed effects or REML; Enrich2's estimator is replaced by REML here, as its start depends
// on every variant). { shift: the largest |change|, which: the index of that replicate } or NaN
// for fewer than two replicates.
export function leaveOneOut(method, y, v, full) {
  const k = y.length;
  if (k < 2) return { shift: Number.NaN, which: -1 };
  const how = method === 'fixed' ? 'fixed' : 'reml';
  let shift = -1;
  let which = -1;
  for (let j = 0; j < k; j += 1) {
    const yy = y.filter((_, i) => i !== j);
    const vv = v.filter((_, i) => i !== j);
    const d = Math.abs(combine(how, yy, vv).estimate - full);
    if (d > shift) {
      shift = d;
      which = j;
    }
  }
  return { shift, which };
}
