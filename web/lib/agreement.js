// Agreement between two sets of scores of the same variants (wave 4, slice 1; requirement C2): the
// correlations, Lin's concordance correlation and Bland–Altman's limits of agreement, each with
// its 95% interval. Written from the publications (cited at each) in plain arithmetic and
// dmath.js's log and exp, so that every engine gives the same bits; checked against R (cor.test,
// DescTools' CCC, BlandAltmanLeh, lm) by the validation suite `compare`. Arrays in (x and y of the
// same length, every value finite), objects out; NaN where a statistic is not defined (too few
// values, or no spread), never an exception.

import { exp, log, square } from './dmath.js';
import { normalQuantile, tQuantile, tTwoSided } from './distributions.js';
import { mean, pearson, ranks } from './stats.js';

// Fisher's z and its inverse.
export function atanh(r) {
  if (r >= 1) return Infinity;
  if (r <= -1) return -Infinity;
  return 0.5 * log((1 + r) / (1 - r));
}
export function tanh(z) {
  if (z > 20) return 1;
  if (z < -20) return -1;
  const e = exp(2 * z);
  return (e - 1) / (e + 1);
}

// An interval for a correlation from its Fisher z and the z's standard error.
function fisherInterval(r, se, level) {
  if (!Number.isFinite(r) || !(se > 0)) return { low: Number.NaN, high: Number.NaN };
  if (Math.abs(r) === 1) return { low: r, high: r };
  const q = normalQuantile(1 - (1 - level) / 2);
  const z = atanh(r);
  return { low: tanh(z - q * se), high: tanh(z + q * se) };
}

// Pearson's r with the interval from Fisher's z, SE 1/√(n − 3) (Fisher 1921; as R's cor.test).
export function pearsonAgreement(x, y, level = 0.95) {
  const n = x.length;
  const r = pearson(x, y);
  return { n, r, ...fisherInterval(r, n > 3 ? 1 / Math.sqrt(n - 3) : Number.NaN, level) };
}

// Spearman's ρ (Pearson's r of the ranks, ties given their average rank) with the interval from
// Fisher's z and Bonett and Wright's SE, √((1 + ρ²/2)/(n − 3)) (Psychometrika 2000;65:23–28),
// which holds its level where 1/√(n − 3) is too narrow.
export function spearmanAgreement(x, y, level = 0.95) {
  const n = x.length;
  const rho = n >= 3 ? pearson(ranks(x), ranks(y)) : Number.NaN;
  return { n, rho, ...fisherInterval(rho, n > 3 ? Math.sqrt((1 + square(rho) / 2) / (n - 3)) : Number.NaN, level) };
}

// Lin's concordance correlation ρc = 2 s_xy / (s_x² + s_y² + (x̄ − ȳ)²), variances over n (Lin,
// Biometrics 1989;45:255–268): how near the points lie to the line y = x, the precision (Pearson's
// r) times the accuracy C_b = ρc / r. Its interval from the inverse hyperbolic tangent and the
// asymptotic variance of Lin's 2000 correction (Biometrics 2000;56:324–325), as DescTools' CCC
// (ci = "z-transform"). scaleShift v = s_y / s_x; locationShift u = (ȳ − x̄) / √(s_x s_y).
export function concordance(x, y, level = 0.95) {
  const n = x.length;
  const empty = { n, ccc: Number.NaN, low: Number.NaN, high: Number.NaN, r: Number.NaN, accuracy: Number.NaN, scaleShift: Number.NaN, locationShift: Number.NaN };
  if (n < 3) return empty;
  const xb = mean(x);
  const yb = mean(y);
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    sxx += square(x[i] - xb);
    syy += square(y[i] - yb);
  }
  const sx2 = sxx / n;
  const sy2 = syy / n;
  if (!(sx2 > 0) || !(sy2 > 0)) return empty;
  const r = pearson(x, y);
  const sxy = r * Math.sqrt(sx2 * sy2);
  const p = (2 * sxy) / (sx2 + sy2 + square(yb - xb));
  const u = (yb - xb) / Math.sqrt(Math.sqrt(sx2 * sy2));
  const variance = ((1 - square(r)) * square(p) * (1 - square(p))) / square(r)
    + (2 * p * p * p * (1 - p) * square(u)) / r
    - (0.5 * square(square(p)) * square(square(u))) / square(r);
  const sep = Math.sqrt(variance / (n - 2));
  const q = normalQuantile(1 - (1 - level) / 2);
  const t = atanh(p);
  const set = sep / (1 - square(p));
  const ok = Number.isFinite(set) && Math.abs(p) < 1;
  return {
    n,
    ccc: p,
    low: ok ? tanh(t - q * set) : Math.abs(p) === 1 ? p : Number.NaN,
    high: ok ? tanh(t + q * set) : Math.abs(p) === 1 ? p : Number.NaN,
    r,
    accuracy: p / r,
    scaleShift: Math.sqrt(sy2 / sx2),
    locationShift: u,
  };
}

// Bland and Altman's limits of agreement (Lancet 1986;i:307–310): the differences d = x − y, their
// mean (the bias) and SD, the limits bias ± 1.96 SD, with t intervals for the bias (SE SD/√n) and
// for each limit (SE √(3 SD²/n)), as BlandAltmanLeh's bland.altman.stats; and the trend of the
// differences with the means ((x + y)/2), by least squares (Bland and Altman, Stat Methods Med Res
// 1999;8:135–160): a slope beyond 0 says the two differ in scale, not only by a bias.
export function blandAltman(x, y, level = 0.95) {
  const n = x.length;
  const d = new Float64Array(n);
  const m = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    d[i] = x[i] - y[i];
    m[i] = (x[i] + y[i]) / 2;
  }
  const nan = Number.NaN;
  if (n < 2) return { n, bias: n ? d[0] : nan, sd: nan, lower: nan, upper: nan, biasLow: nan, biasHigh: nan, lowerLow: nan, lowerHigh: nan, upperLow: nan, upperHigh: nan, trend: trendOf(m, d, level) };
  const bias = mean(d);
  let ss = 0;
  for (const v of d) ss += square(v - bias);
  const sd = Math.sqrt(ss / (n - 1));
  const lower = bias - 1.96 * sd;
  const upper = bias + 1.96 * sd;
  const t = tQuantile(1 - (1 - level) / 2, n - 1);
  const seBias = sd / Math.sqrt(n);
  const seLimit = Math.sqrt((3 * sd * sd) / n);
  return {
    n,
    bias,
    sd,
    lower,
    upper,
    biasLow: bias - t * seBias,
    biasHigh: bias + t * seBias,
    lowerLow: lower - t * seLimit,
    lowerHigh: lower + t * seLimit,
    upperLow: upper - t * seLimit,
    upperHigh: upper + t * seLimit,
    trend: trendOf(m, d, level),
  };
}

// The least-squares line of y on x: { slope, low, high, intercept, p } (p: slope 0, t on n − 2).
export function trendOf(x, y, level = 0.95) {
  const n = x.length;
  const nan = { slope: Number.NaN, low: Number.NaN, high: Number.NaN, intercept: Number.NaN, p: Number.NaN };
  if (n < 3) return nan;
  const xb = mean(x);
  const yb = mean(y);
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i += 1) {
    sxx += square(x[i] - xb);
    sxy += (x[i] - xb) * (y[i] - yb);
  }
  if (!(sxx > 0)) return nan;
  const slope = sxy / sxx;
  const intercept = yb - slope * xb;
  let rss = 0;
  for (let i = 0; i < n; i += 1) rss += square(y[i] - intercept - slope * x[i]);
  const se = Math.sqrt(rss / (n - 2) / sxx);
  const t = tQuantile(1 - (1 - level) / 2, n - 2);
  return { slope, low: slope - t * se, high: slope + t * se, intercept, p: se > 0 ? tTwoSided(slope / se, n - 2) : slope === 0 ? 1 : 0 };
}

// Every statistic of a pair: { n, pearson, spearman, concordance, blandAltman }.
export function agreementOf(x, y, level = 0.95) {
  return {
    n: x.length,
    pearson: pearsonAgreement(x, y, level),
    spearman: spearmanAgreement(x, y, level),
    concordance: concordance(x, y, level),
    blandAltman: blandAltman(x, y, level),
  };
}
