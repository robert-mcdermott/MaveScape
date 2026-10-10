// Moderated linear models of log counts, as mutscan's calculateRelativeFC computes them with limma
// (wave 2, slice 6): voom's log counts per million and their precision weights (Law et al., Genome
// Biology 2014), a weighted least-squares fit per variant, contrasts of its coefficients, and
// empirical Bayes moderation of the residual variances (Smyth, Stat Appl Genet Mol Biol 2004),
// with Cleveland's lowess (JASA 1979) for voom's trend. Written from those publications, not from
// limma's or edgeR's source (both GPL); R's limma is an external reference in validation
// (validation/reference/generate_mutscan.R), equal to it within 1e-10 on the data there.
//
// Data are row-major: G rows (variants) × S columns (samples); a design X is S × P.

import { digamma, tQuantile, tTwoSided, trigamma, trigammaInverse, adjustBH } from './distributions.js';
import { exp, log, pow } from './dmath.js';

const LN2 = 0.6931471805599453;
const log2 = (x) => log(x) / LN2;
const MILLION = 1e6;

// --- Lowess -------------------------------------------------------------------------------------

// Cleveland's robust locally weighted regression of y on x (x ascending): for each point, a line
// fitted by weighted least squares to the ⌊f n⌋ nearest points (tricube weights in distance), then
// `iterations` rounds of robustness weights (bisquare in the residual over six times the median
// absolute residual). Points within `delta` of the last point fitted are interpolated, as in
// Cleveland's program (The American Statistician 1981). Returns the fitted values.
export function lowess(x, y, { f = 2 / 3, iterations = 3, delta = 0.01 * (x[x.length - 1] - x[0]) } = {}) {
  const n = x.length;
  const ys = new Float64Array(n);
  if (n < 2) {
    if (n === 1) ys[0] = y[0];
    return ys;
  }
  const ns = Math.max(Math.min(Math.floor(f * n + 1e-7), n), 2);
  const res = new Float64Array(n);
  const rw = new Float64Array(n).fill(1);
  const w = new Float64Array(n);
  const range = x[n - 1] - x[0];
  // The fit at xs from the points nleft..nright (and ties beyond), with robustness weights after
  // the first pass. Returns NaN when every weight is 0.
  const fitAt = (xs, nleft, nright, robust) => {
    const h = Math.max(xs - x[nleft], x[nright] - xs);
    const h9 = 0.999 * h;
    const h1 = 0.001 * h;
    let a = 0;
    let j = nleft;
    for (; j < n; j += 1) {
      w[j] = 0;
      const r = Math.abs(x[j] - xs);
      if (r <= h9) {
        if (r <= h1) w[j] = 1;
        else {
          const q = r / h;
          const c = 1 - q * q * q;
          w[j] = c * c * c;
        }
        if (robust) w[j] *= rw[j];
        a += w[j];
      } else if (x[j] > xs) break;
    }
    const nrt = j - 1;
    if (!(a > 0)) return Number.NaN;
    for (let k = nleft; k <= nrt; k += 1) w[k] /= a;
    if (h > 0) {
      let mean = 0;
      for (let k = nleft; k <= nrt; k += 1) mean += w[k] * x[k];
      let b = xs - mean;
      let c = 0;
      for (let k = nleft; k <= nrt; k += 1) c += w[k] * (x[k] - mean) * (x[k] - mean);
      if (Math.sqrt(c) > 0.001 * range) {
        b /= c;
        for (let k = nleft; k <= nrt; k += 1) w[k] *= b * (x[k] - mean) + 1;
      }
    }
    let out = 0;
    for (let k = nleft; k <= nrt; k += 1) out += w[k] * y[k];
    return out;
  };
  for (let iter = 0; iter <= iterations; iter += 1) {
    let nleft = 0;
    let nright = ns - 1;
    let last = -1;
    let i = 0;
    for (;;) {
      // Move the window right while that brings it closer to x[i].
      while (nright < n - 1 && x[i] - x[nleft] > x[nright + 1] - x[i]) {
        nleft += 1;
        nright += 1;
      }
      const fitted = fitAt(x[i], nleft, nright, iter > 0);
      ys[i] = Number.isNaN(fitted) ? y[i] : fitted;
      // Points skipped since the last fit: linear interpolation.
      if (last < i - 1) {
        const denom = x[i] - x[last];
        for (let j = last + 1; j < i; j += 1) {
          const alpha = (x[j] - x[last]) / denom;
          ys[j] = alpha * ys[i] + (1 - alpha) * ys[last];
        }
      }
      last = i;
      const cut = x[last] + delta;
      for (i = last + 1; i < n; i += 1) {
        if (x[i] > cut) break;
        if (x[i] === x[last]) {
          ys[i] = ys[last];
          last = i;
        }
      }
      i = Math.max(last + 1, i - 1);
      if (last >= n - 1) break;
    }
    for (let k = 0; k < n; k += 1) res[k] = y[k] - ys[k];
    if (iter === iterations) break;
    // Robustness weights from six times the median absolute residual.
    const abs = Float64Array.from(res, Math.abs).sort();
    const m1 = Math.floor(n / 2);
    const cmad = n % 2 ? 6 * abs[m1] : 3 * (abs[m1] + abs[n - m1 - 1]);
    let meanAbs = 0;
    for (let k = 0; k < n; k += 1) meanAbs += Math.abs(res[k]);
    if (cmad < 1e-7 * (meanAbs / n)) break;
    const c9 = 0.999 * cmad;
    const c1 = 0.001 * cmad;
    for (let k = 0; k < n; k += 1) {
      const r = Math.abs(res[k]);
      if (r <= c1) rw[k] = 1;
      else if (r > c9) rw[k] = 0;
      else {
        const u = r / cmad;
        rw[k] = (1 - u * u) * (1 - u * u);
      }
    }
  }
  return ys;
}

// --- Small dense algebra ------------------------------------------------------------------------

// The inverse of a symmetric positive-definite P × P matrix (row-major), by Cholesky; null when it
// is not positive definite.
export function invertSPD(A, P) {
  const L = new Float64Array(P * P);
  for (let i = 0; i < P; i += 1) {
    for (let j = 0; j <= i; j += 1) {
      let s = A[i * P + j];
      for (let k = 0; k < j; k += 1) s -= L[i * P + k] * L[j * P + k];
      if (i === j) {
        if (!(s > 0)) return null;
        L[i * P + i] = Math.sqrt(s);
      } else L[i * P + j] = s / L[j * P + j];
    }
  }
  // L⁻¹, then A⁻¹ = L⁻ᵀ L⁻¹.
  const M = new Float64Array(P * P);
  for (let c = 0; c < P; c += 1) {
    for (let i = c; i < P; i += 1) {
      let s = i === c ? 1 : 0;
      for (let k = c; k < i; k += 1) s -= L[i * P + k] * M[k * P + c];
      M[i * P + c] = s / L[i * P + i];
    }
  }
  const out = new Float64Array(P * P);
  for (let i = 0; i < P; i += 1) {
    for (let j = 0; j <= i; j += 1) {
      let s = 0;
      for (let k = i; k < P; k += 1) s += M[k * P + i] * M[k * P + j];
      out[i * P + j] = s;
      out[j * P + i] = s;
    }
  }
  return out;
}

// --- voom and the linear models -----------------------------------------------------------------

// Weighted least squares of every row of E (G × S) on the design X (S × P), each row with its own
// observation weights W (G × S; null for none): the coefficients, their unscaled standard deviations
// √diag((XᵀWX)⁻¹), the residual SD σ with S − P degrees of freedom, and each row's mean (Amean).
// Also (XᵀX)⁻¹ of the design alone (for contrasts). Rows whose XᵀWX is singular are NaN.
export function lmFit(E, X, W, G, S, P) {
  const coefficients = new Float64Array(G * P).fill(Number.NaN);
  const stdevUnscaled = new Float64Array(G * P).fill(Number.NaN);
  const sigma = new Float64Array(G).fill(Number.NaN);
  const Amean = new Float64Array(G);
  const df = S - P;
  const A = new Float64Array(P * P);
  const b = new Float64Array(P);
  for (let g = 0; g < G; g += 1) {
    A.fill(0);
    b.fill(0);
    let mean = 0;
    for (let s = 0; s < S; s += 1) {
      const y = E[g * S + s];
      mean += y;
      const w = W ? W[g * S + s] : 1;
      for (let i = 0; i < P; i += 1) {
        const xi = X[s * P + i];
        if (xi === 0) continue;
        b[i] += w * xi * y;
        for (let j = 0; j < P; j += 1) A[i * P + j] += w * xi * X[s * P + j];
      }
    }
    Amean[g] = mean / S;
    const inv = invertSPD(A, P);
    if (!inv) continue;
    for (let i = 0; i < P; i += 1) {
      let c = 0;
      for (let j = 0; j < P; j += 1) c += inv[i * P + j] * b[j];
      coefficients[g * P + i] = c;
      stdevUnscaled[g * P + i] = Math.sqrt(inv[i * P + i]);
    }
    if (df > 0) {
      let rss = 0;
      for (let s = 0; s < S; s += 1) {
        let fit = 0;
        for (let i = 0; i < P; i += 1) fit += X[s * P + i] * coefficients[g * P + i];
        const r = E[g * S + s] - fit;
        rss += (W ? W[g * S + s] : 1) * r * r;
      }
      sigma[g] = Math.sqrt(rss / df);
    }
  }
  const XtX = new Float64Array(P * P);
  for (let s = 0; s < S; s += 1) for (let i = 0; i < P; i += 1) for (let j = 0; j < P; j += 1) XtX[i * P + j] += X[s * P + i] * X[s * P + j];
  return { coefficients, stdevUnscaled, sigma, df, Amean, covariance: invertSPD(XtX, P), G, S, P };
}

// The span of voom's lowess, as limma documents its default (adaptive.span = TRUE in limma 3.68,
// chooseLowessSpan): min(1, 0.3 + 0.7 (50/n)^⅓) for n rows in the trend, so that small tables are
// smoothed over more of their rows.
export const adaptiveSpan = (n) => Math.min(1, 0.3 + 0.7 * pow(50 / n, 1 / 3));

// voom: log₂ counts per million of each row (0.5 added to the count, 1 to the library size), and
// a precision weight for each from the trend of the rows' residual SDs on their mean log count
// (Law et al. 2014): √σ of an unweighted fit against the mean log count, by lowess, read at each
// observation's fitted log count, w = trend⁻⁴. counts: G × S; libSize: S; span: a number, or
// 'adaptive' (the default).
export function voom(counts, X, libSize, G, S, P, { span = 'adaptive' } = {}) {
  const E = new Float64Array(G * S);
  const logLib = Float64Array.from(libSize, (L) => log2(L + 1));
  for (let g = 0; g < G; g += 1) for (let s = 0; s < S; s += 1) E[g * S + s] = log2((counts[g * S + s] + 0.5) / (libSize[s] + 1) * MILLION);
  const fit = lmFit(E, X, null, G, S, P);
  let meanLogLib = 0;
  for (let s = 0; s < S; s += 1) meanLogLib += logLib[s];
  meanLogLib /= S;
  // The trend, on rows with any reads.
  const points = [];
  for (let g = 0; g < G; g += 1) {
    let total = 0;
    for (let s = 0; s < S; s += 1) total += counts[g * S + s];
    if (total > 0 && Number.isFinite(fit.sigma[g])) points.push([fit.Amean[g] + meanLogLib - log2(MILLION), Math.sqrt(fit.sigma[g])]);
  }
  // Sorted by x (stably), as lowess wants them.
  const order = points.map((_, i) => i).sort((a, b) => points[a][0] - points[b][0] || a - b);
  const sx = Float64Array.from(order, (i) => points[i][0]);
  const sy = Float64Array.from(order, (i) => points[i][1]);
  const f = span === 'adaptive' ? adaptiveSpan(sx.length) : span;
  const ly = lowess(sx, sy, { f });
  const trend = interpolator(sx, ly);
  const weights = new Float64Array(G * S);
  for (let g = 0; g < G; g += 1) {
    for (let s = 0; s < S; s += 1) {
      let fitted = 0;
      for (let i = 0; i < P; i += 1) fitted += X[s * P + i] * fit.coefficients[g * P + i];
      // The fitted log count: log₂(2^fitted × (libSize + 1) / 10⁶).
      const logCount = fitted + logLib[s] - log2(MILLION);
      const t = trend(logCount);
      weights[g * S + s] = 1 / (t * t * t * t);
    }
  }
  return { E, weights, span: f, trend: { x: sx, y: ly } };
}

// Linear interpolation through (x ascending, y), the y of tied x averaged, constant beyond the ends.
function interpolator(x, y) {
  const xs = [];
  const yv = [];
  for (let i = 0; i < x.length;) {
    let j = i;
    let sum = 0;
    while (j < x.length && x[j] === x[i]) {
      sum += y[j];
      j += 1;
    }
    xs.push(x[i]);
    yv.push(sum / (j - i));
    i = j;
  }
  const n = xs.length;
  return (v) => {
    if (v <= xs[0]) return yv[0];
    if (v >= xs[n - 1]) return yv[n - 1];
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] <= v) lo = mid;
      else hi = mid;
    }
    return yv[lo] + ((yv[hi] - yv[lo]) * (v - xs[lo])) / (xs[hi] - xs[lo]);
  };
}

// A contrast cᵀβ of each row's coefficients, with its unscaled SD. As limma documents for
// contrasts.fit, the correlation between coefficients is the design's alone, (XᵀX)⁻¹ scaled to a
// correlation, combined with each row's own unscaled SDs: exact without weights or with an
// orthogonal design, an approximation otherwise (mutscan's numbers are made this way).
export function contrastFit(fit, c) {
  const { G, P, coefficients, stdevUnscaled, covariance } = fit;
  const rho = new Float64Array(P * P);
  for (let i = 0; i < P; i += 1) for (let j = 0; j < P; j += 1) rho[i * P + j] = covariance[i * P + j] / Math.sqrt(covariance[i * P + i] * covariance[j * P + j]);
  const coefficient = new Float64Array(G);
  const unscaled = new Float64Array(G);
  for (let g = 0; g < G; g += 1) {
    let est = 0;
    let v = 0;
    for (let i = 0; i < P; i += 1) {
      if (!c[i]) continue;
      est += c[i] * coefficients[g * P + i];
      for (let j = 0; j < P; j += 1) if (c[j]) v += c[i] * c[j] * stdevUnscaled[g * P + i] * stdevUnscaled[g * P + j] * rho[i * P + j];
    }
    coefficient[g] = est;
    unscaled[g] = Math.sqrt(v);
  }
  return { coefficient, stdevUnscaled: unscaled };
}

// Empirical Bayes moderation (Smyth 2004): the residual variances s² (each with d degrees of
// freedom) taken as scaled inverse-χ² around a prior s₀² with d₀ degrees of freedom, d₀ and s₀²
// found by matching the mean and variance of ln s² (with digamma and trigamma); each variance
// shrunk to s̃² = (d₀ s₀² + d s²)/(d₀ + d), and t = estimate / (unscaled SD · s̃) with d + d₀
// degrees of freedom (at most the rows' pooled d). For the prior, variances below 10⁻⁵ of their
// median count as that (as limma does; checked against it: the wild type's, nearly 0 when it is
// the normalizer, would otherwise dominate the variance of ln s²); variances not finite take no part.
export function squeezeVariances(sigma, df) {
  const finite = [];
  for (let g = 0; g < sigma.length; g += 1) {
    const s2 = sigma[g] * sigma[g];
    if (Number.isFinite(s2)) finite.push(Math.max(s2, 0));
  }
  const sorted = Float64Array.from(finite).sort();
  const n0 = sorted.length;
  const middle = n0 ? (n0 % 2 ? sorted[(n0 - 1) / 2] : (sorted[n0 / 2 - 1] + sorted[n0 / 2]) / 2) : Number.NaN;
  const floor = 1e-5 * (middle > 0 ? middle : 1);
  const e = [];
  let trigammaMean = 0;
  for (const s2 of finite) {
    e.push(log(Math.max(s2, floor)) - digamma(df / 2) + log(df / 2));
    trigammaMean += trigamma(df / 2);
  }
  const n = e.length;
  if (n < 2) return { s2Prior: Number.NaN, dfPrior: 0 };
  trigammaMean /= n;
  let emean = 0;
  for (const v of e) emean += v;
  emean /= n;
  let evar = 0;
  for (const v of e) evar += (v - emean) * (v - emean);
  evar = evar / (n - 1) - trigammaMean;
  if (evar > 0) {
    const dfPrior = 2 * trigammaInverse(evar);
    return { s2Prior: exp(emean + digamma(dfPrior / 2) - log(dfPrior / 2)), dfPrior };
  }
  return { s2Prior: exp(emean), dfPrior: Infinity };
}

// Moderated t-statistics of a contrast: the prior, each row's moderated variance, estimate, SE
// (√s̃² × unscaled SD), t, total degrees of freedom, two-sided p, Benjamini–Hochberg adjusted p,
// and the 95% interval with t's quantile.
export function moderatedT(fit, contrast, { level = 0.95 } = {}) {
  const { G, df, sigma } = fit;
  const { s2Prior, dfPrior } = squeezeVariances(sigma, df);
  let dfPooled = 0;
  for (let g = 0; g < G; g += 1) if (Number.isFinite(sigma[g])) dfPooled += df;
  const s2Post = new Float64Array(G);
  const se = new Float64Array(G);
  const t = new Float64Array(G);
  const dfTotal = new Float64Array(G);
  const p = new Float64Array(G);
  const ciLow = new Float64Array(G);
  const ciHigh = new Float64Array(G);
  const quantiles = new Map();
  for (let g = 0; g < G; g += 1) {
    const s2 = sigma[g] * sigma[g];
    s2Post[g] = dfPrior === Infinity ? s2Prior : (dfPrior * s2Prior + df * s2) / (dfPrior + df);
    se[g] = Math.sqrt(s2Post[g]) * contrast.stdevUnscaled[g];
    t[g] = contrast.coefficient[g] / se[g];
    dfTotal[g] = Math.min(df + dfPrior, dfPooled);
    p[g] = tTwoSided(t[g], dfTotal[g]);
    if (!quantiles.has(dfTotal[g])) quantiles.set(dfTotal[g], tQuantile((1 + level) / 2, dfTotal[g]));
    const margin = quantiles.get(dfTotal[g]) * se[g];
    ciLow[g] = contrast.coefficient[g] - margin;
    ciHigh[g] = contrast.coefficient[g] + margin;
  }
  return { s2Prior, dfPrior, s2Post, estimate: contrast.coefficient, se, t, dfTotal, p, q: adjustBH(p), ciLow, ciHigh };
}
