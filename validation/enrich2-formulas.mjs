// Enrich2's scores computed independently from the formulas in mavescape-spec/research.md §2.1,
// for the `enrich2` validation suite: if these equal the committed outputs of Enrich2 2.0.2
// (validation/reference/enrich2.json) on real data, the formulas the scoring engine will be built
// on (web/lib/score-*.js, wave 1 slice 5 and wave 2) are confirmed before any of it is written.
// This file is a check of the specification, not part of MaveScape.

import { replicateSamples } from '../web/lib/design.js';
import { count } from './design-cases.mjs';

const P = 0.5; // Enrich2's pseudocount

// The counts of one replicate: { names, times: [t…], counts: [Float64Array per time] }, with
// technical replicates summed and a variant kept only where counted at every time (Enrich2
// leaves a variant absent from any time point out of the replicate; an explicit 0 is kept).
export function replicateCounts(design, table, replicate) {
  const samples = new Map(design.samples.map((s) => [s.id, s]));
  const parts = replicateSamples(replicate).map((p) => ({ ...p, time: p.role === 'input' ? 0 : p.role === 'output' ? 1 : p.time }));
  const names = table.data[design.variants.column];
  const columns = parts.map((p) => samples.get(p.sample).columns.map((c) => table.data[c]));
  const keep = [];
  for (let i = 0; i < names.length; i += 1) {
    if (columns.every((cols) => cols.every((col) => Number.isFinite(count(col[i]))))) keep.push(i);
  }
  return {
    names: keep.map((i) => names[i]),
    times: parts.map((p) => p.time),
    counts: columns.map((cols) => Float64Array.from(keep, (i) => cols.reduce((sum, col) => sum + Math.round(count(col[i])), 0))),
  };
}

// The normalizing count at each time: the wild type's ('wt'), the sum over variants counted at
// every time ('complete'), or the sum over all variants counted at that time ('full'), each plus
// one pseudocount only (Enrich2 issue #75).
export function normalizers(design, table, replicate, data, method) {
  if (method === 'wt') {
    const w = data.names.indexOf(design.controls.wildType);
    if (w < 0) throw new Error(`no wild-type row "${design.controls.wildType}" in ${replicate.id}`);
    return data.counts.map((c) => c[w] + P);
  }
  if (method === 'complete') return data.counts.map((c) => c.reduce((a, b) => a + b, 0) + P);
  if (method === 'full') {
    const samples = new Map(design.samples.map((s) => [s.id, s]));
    return replicateSamples(replicate).map((p) => {
      let sum = 0;
      const cols = samples.get(p.sample).columns.map((c) => table.data[c]);
      for (let i = 0; i < cols[0].length; i += 1) {
        if (cols.every((col) => Number.isFinite(count(col[i])))) sum += cols.reduce((s, col) => s + Math.round(count(col[i])), 0);
      }
      return sum + P;
    });
  }
  throw new Error(`unknown normalization ${method}`);
}

// Two time points (the first and last): log ratio and its standard error.
export function ratioScores(data, r) {
  const first = 0;
  const last = data.times.length - 1;
  const out = new Map();
  data.names.forEach((name, i) => {
    const c0 = data.counts[first][i] + P;
    const cT = data.counts[last][i] + P;
    const score = (Math.log(cT) - Math.log(r[last])) - (Math.log(c0) - Math.log(r[first]));
    const variance = 1 / c0 + 1 / cT + 1 / r[first] + 1 / r[last];
    out.set(name, [score, Math.sqrt(variance)]);
  });
  return out;
}

// Weighted (or ordinary) least squares of normalized log counts on t / max t, with an intercept;
// the standard error of the slope scaled by the residuals (statsmodels' bse).
export function regressionScores(data, r, weighted) {
  const tMax = Math.max(...data.times);
  const x = data.times.map((t) => t / tMax);
  const n = x.length;
  const out = new Map();
  data.names.forEach((name, i) => {
    const y = data.counts.map((c, t) => Math.log(c[i] + P) - Math.log(r[t]));
    const w = data.counts.map((c, t) => (weighted ? 1 / (1 / (c[i] + P) + 1 / r[t]) : 1));
    let sw = 0; let swx = 0; let swy = 0;
    for (let t = 0; t < n; t += 1) { sw += w[t]; swx += w[t] * x[t]; swy += w[t] * y[t]; }
    const mx = swx / sw;
    const my = swy / sw;
    let sxx = 0; let sxy = 0;
    for (let t = 0; t < n; t += 1) { sxx += w[t] * (x[t] - mx) ** 2; sxy += w[t] * (x[t] - mx) * (y[t] - my); }
    const slope = sxy / sxx;
    const intercept = my - slope * mx;
    let rss = 0;
    for (let t = 0; t < n; t += 1) rss += w[t] * (y[t] - intercept - slope * x[t]) ** 2;
    out.set(name, [slope, Math.sqrt(rss / (n - 2) / sxx)]);
  });
  return out;
}

// Enrich2 2.0.2's random-effects combination (enrich2/random_effects.py), exactly: the starting
// between-replicate variance divides by the number of variants less one (not of replicates), and
// the update runs 50 times without a convergence test. `y` and `s2` are per replicate, per variant
// (variants scored in every replicate). Returns per variant [score, SE, epsilon].
export function enrich2Combination(y, s2, iterations = 50) {
  const k = y.length;
  const V = y[0].length;
  const out = [];
  for (let v = 0; v < V; v += 1) {
    let mean = 0;
    for (let j = 0; j < k; j += 1) mean += y[j][v];
    mean /= k;
    let tau2 = 0;
    for (let j = 0; j < k; j += 1) tau2 += (y[j][v] - mean) ** 2 / (V - 1);
    let beta = Number.NaN;
    let eps = 0;
    for (let it = 0; it < iterations; it += 1) {
      let sw = 0; let sw2 = 0; let swy = 0;
      for (let j = 0; j < k; j += 1) {
        const w = 1 / (s2[j][v] + tau2);
        sw += w; sw2 += w * w; swy += w * y[j][v];
      }
      beta = swy / sw;
      let num = 0;
      for (let j = 0; j < k; j += 1) {
        const w = 1 / (s2[j][v] + tau2);
        num += (y[j][v] - beta) ** 2 * w * w;
      }
      const next = tau2 * num / (sw - sw2 / sw);
      eps = Math.abs(tau2 - next);
      tau2 = next;
    }
    let inv = 0;
    for (let j = 0; j < k; j += 1) inv += 1 / (s2[j][v] + tau2);
    out.push([beta, Math.sqrt(1 / inv), eps]);
  }
  return out;
}
