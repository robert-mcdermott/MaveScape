// Time-series scores (requirement S6; mavescape-spec/research.md §2.1): for one biological
// replicate sampled at times t₀ < t₁ < … (technical replicates already summed), each variant's
// score is the slope of its normalized log count against scaled time, as Enrich2 2.0.2 computes it:
//
//   y_t = ln(c_t + p) − ln r_t,   w_t = 1 / (1/(c_t + p) + 1/r_t)   (OLS: w_t = 1),   x_t = t / max t
//
// fitted as y = a + b·x by weighted (or ordinary) least squares with an intercept; the score is b.
// Spacing need not be uniform. r_t is the sample's normalizer (score-ratio.js, normalizers); with
// synonymous normalization r_t = 1 without its 1/r_t term, and the replicate's median synonymous
// slope is subtracted afterward.
//
// Standard errors:
// - 'residual': statsmodels' bse, the slope's variance scaled by the residuals,
//   SE² = [Σ w e² / (n − 2)] / Σ w (x − x̄)², exactly Enrich2's. Three points that happen to fall on
//   a line get an SE near 0 and dominate a combination of replicates.
// - 'counting-floor' (MaveScape's default): the residual SE, but never below what counting alone
//   predicts for the slope, Σ w² (x − x̄)² v / [Σ w (x − x̄)²]² with v_t = 1/(c_t + p) + 1/r_t
//   (for WLS, where w = 1/v, this is 1 / Σ w (x − x̄)²): the Birge-ratio rule of scaling up, never
//   down.
//
// A variant is fitted on the time points where it was counted (missing is not 0): every one in
// Enrich2's way, or at least `minPoints` (3 or more, the first always among them). Each fit also
// reports its departure from a line against counting noise, χ²/(n − 2) with χ² = Σ e²/v, for quality
// control: a trajectory that is not a line is reported, never treated as invalid.

import { log } from './dmath.js';

export const MODELS = {
  ratio: 'log ratio of the first and last samples',
  wls: 'weighted least squares on every time point',
  ols: 'ordinary least squares on every time point',
};

export const REGRESSION_SE = {
  'counting-floor': 'residual-scaled, at least what counting predicts',
  residual: 'residual-scaled (Enrich2, statsmodels)',
};

// One fit: x (scaled times), y, w (weights), v (counting variances), the points to use.
// Returns { slope, intercept, se, seResidual, seCounting, fit, n }.
export function fitLine(x, y, w, v, use, seMethod = 'counting-floor') {
  let n = 0;
  let sw = 0;
  let swx = 0;
  let swy = 0;
  for (let t = 0; t < x.length; t += 1) {
    if (!use[t]) continue;
    n += 1;
    sw += w[t];
    swx += w[t] * x[t];
    swy += w[t] * y[t];
  }
  const nan = { slope: Number.NaN, intercept: Number.NaN, se: Number.NaN, seResidual: Number.NaN, seCounting: Number.NaN, fit: Number.NaN, n };
  if (n < 2) return nan;
  const mx = swx / sw;
  const my = swy / sw;
  let sxx = 0;
  let sxy = 0;
  for (let t = 0; t < x.length; t += 1) {
    if (!use[t]) continue;
    const dx = x[t] - mx;
    sxx += w[t] * dx * dx;
    sxy += w[t] * dx * (y[t] - my);
  }
  if (!(sxx > 0)) return nan;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  let rss = 0;
  let chi2 = 0;
  let counting = 0;
  for (let t = 0; t < x.length; t += 1) {
    if (!use[t]) continue;
    const e = y[t] - intercept - slope * x[t];
    const dx = x[t] - mx;
    rss += w[t] * e * e;
    chi2 += (e * e) / v[t];
    counting += w[t] * w[t] * dx * dx * v[t];
  }
  const df = n - 2;
  const seResidual = df > 0 ? Math.sqrt(rss / df / sxx) : Number.NaN;
  const seCounting = Math.sqrt(counting) / sxx;
  const se = seMethod === 'residual' ? seResidual : (df > 0 ? Math.max(seResidual, seCounting) : Number.NaN);
  return { slope, intercept, se, seResidual, seCounting, fit: df > 0 ? chi2 / df : Number.NaN, n };
}

// One variant's time course in one replicate, as the regression saw it: { points: [[t, y]], line:
// [[t, y], [t, y]] (the fitted line over the replicate's times), slope, fit }. counts: the count
// at each time (NaN where missing); for the inspector.
export function timeCourse(counts, times, r, { weighted = true, pseudocount, method }) {
  const tMax = Math.max(...times);
  const synonymous = method === 'synonymous';
  const x = times.map((t) => t / tMax);
  const y = [];
  const w = [];
  const v = [];
  const use = [];
  counts.forEach((c, t) => {
    use.push(Number.isNaN(c) ? 0 : 1);
    const cp = c + pseudocount;
    y.push(log(cp) - (synonymous ? 0 : log(r[t])));
    v.push(synonymous ? 1 / cp : 1 / cp + 1 / r[t]);
    w.push(weighted ? 1 / v[t] : 1);
  });
  const f = fitLine(x, y, w, v, use);
  return {
    points: times.map((t, k) => [t, use[k] ? y[k] : Number.NaN]),
    line: Number.isFinite(f.slope) ? [[times[0], f.intercept + f.slope * x[0]], [tMax, f.intercept + f.slope]] : [],
    slope: f.slope,
    fit: f.fit,
  };
}

// Scores of one replicate. samples: [Float64Array] (counts at each time, in time order, NaN where
// missing); times: [t]; r: [normalizer per time]; use: Uint8Array (1 where the variant is scored in
// this replicate); counted: [Uint8Array per time] (1 where counted at that time).
// options: { weighted, pseudocount, method ('wt' | 'complete' | 'full' | 'synonymous'), se,
// reference (synonymous rows, for 'synonymous'), label }.
// Returns { score, se, fit, points } (Float64Array, Float64Array, Float64Array, Uint8Array), and
// for 'synonymous' { median, references }.
export function regressionScores(samples, times, r, use, options) {
  const { weighted = true, pseudocount, method, se: seMethod = 'counting-floor', reference = null, label = 'this replicate' } = options;
  const T = samples.length;
  const tMax = Math.max(...times);
  if (!(tMax > 0)) throw new Error(`The time points of ${label} are all at time 0 or before: a regression on time needs a later time.`);
  const x = times.map((t) => t / tMax);
  const n = samples[0].length;
  const score = new Float64Array(n).fill(Number.NaN);
  const se = new Float64Array(n).fill(Number.NaN);
  const fit = new Float64Array(n).fill(Number.NaN);
  const points = new Uint8Array(n);
  const y = new Float64Array(T);
  const w = new Float64Array(T);
  const v = new Float64Array(T);
  const at = new Uint8Array(T);
  const synonymous = method === 'synonymous';
  const logR = r.map((value) => (synonymous ? 0 : log(value)));
  for (let i = 0; i < n; i += 1) {
    if (!use[i]) continue;
    for (let t = 0; t < T; t += 1) {
      const c = samples[t][i];
      at[t] = Number.isNaN(c) ? 0 : 1;
      if (!at[t]) continue;
      const cp = c + pseudocount;
      // In Enrich2's order of operations, so that the numbers agree to the last digits.
      y[t] = log(cp) - logR[t];
      v[t] = synonymous ? 1 / cp : 1 / cp + 1 / r[t];
      w[t] = weighted ? 1 / v[t] : 1;
    }
    const f = fitLine(x, y, w, v, at, seMethod);
    score[i] = f.slope;
    se[i] = f.se;
    fit[i] = f.fit;
    points[i] = f.n;
  }
  if (synonymous) {
    const values = (reference ?? []).filter((i) => use[i] && Number.isFinite(score[i])).map((i) => score[i]);
    if (!values.length) throw new Error(`No synonymous variant is scored in ${label}: synonymous normalization is not available there.`);
    const sorted = Float64Array.from(values).sort();
    const m = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
    for (let i = 0; i < n; i += 1) if (use[i]) score[i] -= m;
    return { score, se, fit, points, median: m, references: values.length };
  }
  return { score, se, fit, points };
}
