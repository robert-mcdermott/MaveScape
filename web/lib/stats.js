// Statistics for quality control and the views: order statistics, correlations, a robust
// variance, the area under the ROC curve. Arrays in, numbers out; NaN where a statistic is not
// defined (too few values), never an exception. MaveScape's own (CytoWeave's stats.js is tied to
// its event sets; roadmap, wave 1 slice 1).

export function sum(x) {
  let s = 0;
  for (const v of x) s += v;
  return s;
}

export function mean(x) {
  return x.length ? sum(x) / x.length : Number.NaN;
}

// Sample variance (n − 1).
export function variance(x) {
  const n = x.length;
  if (n < 2) return Number.NaN;
  const m = mean(x);
  let s = 0;
  for (const v of x) s += (v - m) ** 2;
  return s / (n - 1);
}

export const sorted = (x) => Float64Array.from(x).sort();

// The q-quantile of sorted values, by linear interpolation (R's type 7).
export function quantileSorted(s, q) {
  const n = s.length;
  if (!n) return Number.NaN;
  const h = (n - 1) * q;
  const lo = Math.floor(h);
  const hi = Math.min(n - 1, lo + 1);
  return s[lo] + (h - lo) * (s[hi] - s[lo]);
}

export const quantile = (x, q) => quantileSorted(sorted(x), q);
export const median = (x) => quantile(x, 0.5);

// The median absolute deviation, scaled to estimate a normal SD (× 1.4826).
export function mad(x) {
  const m = median(x);
  return 1.482602218505602 * median(Array.from(x, (v) => Math.abs(v - m)));
}

// The median of χ²₁: median(z²) / MEDIAN_CHI2_1 estimates the variance of z robustly.
export const MEDIAN_CHI2_1 = 0.454936423119572;

export function pearson(a, b) {
  const n = a.length;
  if (n < 3) return Number.NaN;
  const ma = mean(a);
  const mb = mean(b);
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i += 1) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    sab += x * y;
    saa += x * x;
    sbb += y * y;
  }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : Number.NaN;
}

// Ranks from 1, ties given their average rank.
export function ranks(x) {
  const n = x.length;
  const order = Array.from({ length: n }, (_, i) => i).sort((i, j) => x[i] - x[j]);
  const out = new Float64Array(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && x[order[j + 1]] === x[order[i]]) j += 1;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) out[order[k]] = r;
    i = j + 1;
  }
  return out;
}

export const spearman = (a, b) => pearson(ranks(a), ranks(b));

// P(a > b) + ½ P(a = b) for a value drawn from each sample: the area under the ROC curve of
// telling the two apart (Mann–Whitney U / (n_a n_b)).
export function auc(a, b) {
  if (!a.length || !b.length) return Number.NaN;
  const all = [...a, ...b];
  const r = ranks(all);
  let ra = 0;
  for (let i = 0; i < a.length; i += 1) ra += r[i];
  return (ra - (a.length * (a.length + 1)) / 2) / (a.length * b.length);
}

// Least squares of y = a·x + e with weights, both coefficients kept at 0 or more: { a, e }.
export function nonNegativeLine(x, y, w) {
  const fit = (useA, useE) => {
    let sw = 0;
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let sxy = 0;
    for (let i = 0; i < x.length; i += 1) {
      sw += w[i];
      sx += w[i] * x[i];
      sy += w[i] * y[i];
      sxx += w[i] * x[i] * x[i];
      sxy += w[i] * x[i] * y[i];
    }
    if (useA && useE) {
      const det = sw * sxx - sx * sx;
      return { a: (sw * sxy - sx * sy) / det, e: (sxx * sy - sx * sxy) / det };
    }
    if (useA) return { a: sxy / sxx, e: 0 };
    return { a: 0, e: sy / sw };
  };
  if (x.length < 2) return x.length ? { a: y[0] / x[0], e: 0 } : { a: Number.NaN, e: Number.NaN };
  let f = fit(true, true);
  if (!(f.e >= 0)) f = fit(true, false);
  if (!(f.a >= 0)) f = fit(false, true);
  return f;
}
