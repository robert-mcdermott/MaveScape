// Replicates combined with a shared error model and moderated dispersions (wave 2, slice 9;
// requirement S13), MaveScape's default from 0.2. With two or three replicates, a variant's own
// between-replicate variance (REML's τ²) is too uncertain to build an interval on: 95% intervals
// held the truth 82–93% of the time in simulations. Here every variant borrows from the others,
// in two steps:
//
// 1. A shared error model, as DiMSum's (Faure et al. 2020): a replicate score's variance is
//    a·s² + b, s² its counting variance. a > 1 is a bottleneck (fewer cells than reads), b noise
//    between replicates beyond counting. a and b are fitted to the differences between replicates
//    of the same variant, centered on their median for each pair of replicates (a shift shared by
//    every variant there is the reference's, below): the robust variance of the differences in
//    bins of counting variance against a(s₁² + s₂²) + 2b, by least squares reweighted by the
//    fitted variance. Replicates that share an input sample share its counting error: their
//    difference leaves it out, and their scores are combined with that covariance (generalized
//    least squares) rather than as independent. The covariance is the shared sample's counting
//    variance itself, not scaled by a: a bottleneck or the scatter of a time course happens in
//    each replicate on its own (scaled down with a when a < 1, so that counting is not overstated
//    and V stays positive definite).
// 2. Each variant's dispersion about the model, φ = rᵀV⁻¹r/(k − 1), moderated across variants as
//    limma moderates variances (Smyth 2004): a scaled inverse-χ² prior (φ₀, d₀) fitted to every
//    variant's φ, each shrunk to φ̃ = (d₀φ₀ + (k−1)φ)/(d₀ + k − 1); the SE is √(φ̃ / 1ᵀV⁻¹1) and
//    the interval uses t with d₀ + k − 1 degrees of freedom.
//
// The reference a score is relative to (the wild type, the synonymous variants' median, totals) can
// vary between replicates too, and shifts every score of a replicate together: the differences the
// model is fitted to, centered for each pair of replicates, never show it. It is measured instead
// from each replicate's shift, the median of its scores' departures from their variants' means:
// their variance (with one degree of freedom fewer than the replicates) is added to each
// replicate's variance, so that an interval holds the truth relative to the true reference. That
// variance is known from as many degrees of freedom as replicates less one, so a score's degrees of
// freedom combine the two parts' (Satterthwaite's approximation): with two or three replicates and a
// reference that varies as much as the variants, the intervals widen accordingly.
//
// Each row: { y, v, rep (replicate indices), share (each measurement's shared first sample, or
// null), u (√ of the counting variance it shares, signed by its coefficient), informative (false
// for a row whose counts are a few reads: its scores sit at the floor the pseudocount sets, their
// spread says nothing of the model's, and it takes no part in fitting the model or the prior) };
// null for a row not combined.

import { exp, log, square } from './dmath.js';
import { digamma, trigamma, trigammaInverse } from './distributions.js';
import { invertSPD } from './limma.js';
import { mean, median, MEDIAN_CHI2_1, nonNegativeLine } from './stats.js';

// Fewer pairs of replicate measurements than this leave the model at counting alone (a = 1, b = 0).
export const MIN_PAIRS = 40;

// The covariance of two measurements of a row: the counting variance of a shared sample.
const sharedCov = (row, j, k) => (row.share && row.share[j] !== null && row.share[j] === row.share[k] ? row.u[j] * row.u[k] : 0);

// The shared error model from the rows' pairs of measurements: { a, b, pairs, fitted }.
export function fitErrorModel(rows) {
  const byPair = new Map();
  for (const row of rows) {
    if (!row || row.informative === false) continue;
    const k = row.y.length;
    for (let j = 0; j < k; j += 1) {
      for (let l = j + 1; l < k; l += 1) {
        const [first, second] = row.rep[j] < row.rep[l] ? [j, l] : [l, j];
        const key = `${row.rep[first]}|${row.rep[second]}`;
        const x = row.v[j] + row.v[l];
        if (!(x > 0) || !Number.isFinite(row.y[j] - row.y[l])) continue;
        if (!byPair.has(key)) byPair.set(key, []);
        // The difference of two scores sharing a sample leaves its counting error out: E[d²] =
        // a(v₁ + v₂) + 2b − 2c.
        byPair.get(key).push([row.y[first] - row.y[second], x, 2 * sharedCov(row, j, l)]);
      }
    }
  }
  // In an order of their values alone, so that the table's row order cannot change a sum's last
  // digit (scores are the same bits however the table is sorted).
  const points = [];
  for (const key of [...byPair.keys()].sort()) {
    const list = byPair.get(key);
    const center = median(list.map((p) => p[0]));
    for (const [d, s, c2] of list) points.push([s, square(d - center), c2]);
  }
  points.sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2]);
  const x = points.map((p) => p[0]);
  const r2 = points.map((p) => p[1]);
  const c2 = points.map((p) => p[2]);
  const n = x.length;
  if (n < MIN_PAIRS) return { a: 1, b: 0, pairs: n, fitted: false };
  const nb = Math.max(2, Math.min(10, Math.floor(n / 40)));
  const bins = [];
  for (let b = 0; b < nb; b += 1) {
    const from = Math.floor((b * n) / nb);
    const to = Math.floor(((b + 1) * n) / nb);
    bins.push({ from, to, n: to - from, x: mean(x.slice(from, to)) });
  }
  const bx = bins.map((b) => b.x);
  // A bin's variance, robustly: the median of its squared differences, each standardized by the
  // variance the current fit predicts for it (the counting variance varies within a bin, and a
  // plain median would then understate the bin's mean; a shared sample's 2c comes off), rescaled
  // to the bin's mean of a(v₁ + v₂) + 2b.
  const binVariances = (fit) => bins.map((b) => {
    const z = [];
    let predicted = 0;
    for (let i = b.from; i < b.to; i += 1) {
      const v = Math.max(fit.a * x[i] + fit.e - c2[i], 1e-12 * (fit.a * x[i] + fit.e) + 1e-300);
      z.push(r2[i] / v);
      predicted += fit.a * x[i] + fit.e;
    }
    return (median(z) / MEDIAN_CHI2_1) * (predicted / b.n);
  });
  let fit = { a: 1, e: 0 };
  // Each bin's variance has an SD about proportional to the variance itself: least squares
  // weighted by the fitted variance, iterated.
  for (let it = 0; it < 10; it += 1) {
    const by = binVariances(fit);
    fit = nonNegativeLine(bx, by, bins.map((b) => b.n / square(Math.max(fit.a * b.x + fit.e, 1e-12))));
  }
  return { a: fit.a, b: fit.e / 2, pairs: n, fitted: true };
}

// A scaled inverse-χ² prior for variances s² with degrees of freedom d (one each), by limma's
// moment matching on ln s² (fitFDist without a covariate): { s2Prior, dfPrior }. Variances below
// 10⁻⁵ of their median count as that.
export function squeezeVariances(s2, d) {
  const values = [];
  for (let i = 0; i < s2.length; i += 1) if (Number.isFinite(s2[i]) && d[i] > 0) values.push([Math.max(s2[i], 0), d[i]]);
  if (values.length < 2) return { s2Prior: Number.NaN, dfPrior: 0 };
  // Summed in an order of their values alone (see fitErrorModel).
  values.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const middle = median(values.map((x) => x[0]));
  const floor = 1e-5 * (middle > 0 ? middle : 1);
  let emean = 0;
  let trigammaMean = 0;
  const e = values.map(([s, df]) => {
    const z = log(Math.max(s, floor)) - digamma(df / 2) + log(df / 2);
    emean += z;
    trigammaMean += trigamma(df / 2);
    return z;
  });
  const n = e.length;
  emean /= n;
  trigammaMean /= n;
  let evar = 0;
  for (const z of e) evar += square(z - emean);
  evar = evar / (n - 1) - trigammaMean;
  if (evar > 0) {
    const dfPrior = 2 * trigammaInverse(evar);
    return { s2Prior: exp(emean + digamma(dfPrior / 2) - log(dfPrior / 2)), dfPrior };
  }
  return { s2Prior: exp(emean), dfPrior: Infinity };
}

// Each replicate's shift (the median departure of its scores from their rows' means) and the
// variance of those shifts: { shifts: Map(replicate → shift), variance }.
export function replicateShifts(rows) {
  const departures = new Map();
  for (const row of rows) {
    if (!row || row.y.length < 2 || row.informative === false) continue;
    const m = mean(row.y);
    row.y.forEach((y, j) => {
      if (!departures.has(row.rep[j])) departures.set(row.rep[j], []);
      departures.get(row.rep[j]).push(y - m);
    });
  }
  const shifts = new Map();
  for (const key of [...departures.keys()].sort((x, y) => x - y)) if (departures.get(key).length >= 10) shifts.set(key, median(departures.get(key)));
  const values = [...shifts.values()];
  if (values.length < 2) return { shifts, variance: 0 };
  const center = mean(values);
  let ss = 0;
  for (const v of values) ss += square(v - center);
  return { shifts, variance: ss / (values.length - 1) };
}

// Combines every row: { estimate, se, df, phi (moderated), seWithin and dfWithin (without the
// reference's part, for scores rescaled to a median of controls, in which the replicates' shared
// shift cancels), model: { a, b, bReference, shifts, phiPrior, dfPrior, pairs, fitted } }.
export function moderatedCombination(rows) {
  const n = rows.length;
  const estimate = new Float64Array(n).fill(Number.NaN);
  const se = new Float64Array(n).fill(Number.NaN);
  const df = new Float64Array(n).fill(Number.NaN);
  const phi = new Float64Array(n).fill(Number.NaN);
  const seWithin = new Float64Array(n).fill(Number.NaN);
  const dfWithin = new Float64Array(n).fill(Number.NaN);
  const model = fitErrorModel(rows);
  const reference = replicateShifts(rows);
  const extra = model.b + reference.variance;
  // Each row by generalized least squares under the model: its estimate, unscaled variance and
  // dispersion φ with k − 1 degrees of freedom.
  const unscaled = new Float64Array(n).fill(Number.NaN);
  const raw = new Float64Array(n).fill(Number.NaN);
  const dfRow = new Float64Array(n);
  // The reference's share of each estimate's variance (Σ λ² times its variance, λ the weights).
  const referencePart = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    const row = rows[i];
    if (!row) continue;
    const k = row.y.length;
    const V = new Float64Array(k * k);
    for (let j = 0; j < k; j += 1) {
      V[j * k + j] = model.a * row.v[j] + extra;
      for (let l = 0; l < j; l += 1) {
        const c = Math.min(model.a, 1) * sharedCov(row, j, l);
        V[j * k + l] = c;
        V[l * k + j] = c;
      }
    }
    const W = invertSPD(V, k);
    if (!W) {
      // A score known exactly (variance 0: the wild type as its own normalizer, without noise
      // between replicates): its mean, SE 0.
      estimate[i] = mean(row.y);
      unscaled[i] = 0;
      continue;
    }
    let s1 = 0;
    let sy = 0;
    for (let j = 0; j < k; j += 1) {
      let rowSum = 0;
      for (let l = 0; l < k; l += 1) rowSum += W[j * k + l];
      s1 += rowSum;
      sy += rowSum * row.y[j];
    }
    const m = sy / s1;
    estimate[i] = m;
    unscaled[i] = 1 / s1;
    if (reference.variance > 0) {
      let l2 = 0;
      for (let j = 0; j < k; j += 1) {
        let rowSum = 0;
        for (let l = 0; l < k; l += 1) rowSum += W[j * k + l];
        l2 += square(rowSum / s1);
      }
      referencePart[i] = reference.variance * l2;
    }
    if (k > 1) {
      let q = 0;
      for (let j = 0; j < k; j += 1) for (let l = 0; l < k; l += 1) q += (row.y[j] - m) * W[j * k + l] * (row.y[l] - m);
      raw[i] = q / (k - 1);
      dfRow[i] = k - 1;
    }
    // A row at the counts' floor keeps the prior's dispersion: its own spread is not evidence.
    if (row.informative === false) {
      raw[i] = Number.NaN;
      dfRow[i] = 0;
    }
  }
  let { s2Prior: phiPrior, dfPrior } = squeezeVariances(raw, dfRow);
  // Without enough variants to estimate a prior, the model is taken as it is.
  if (!Number.isFinite(phiPrior)) {
    phiPrior = 1;
    dfPrior = Infinity;
  }
  let pooled = 0;
  for (let i = 0; i < n; i += 1) if (Number.isFinite(raw[i])) pooled += dfRow[i];
  for (let i = 0; i < n; i += 1) {
    if (!rows[i] || !Number.isFinite(unscaled[i])) continue;
    const d = Number.isFinite(raw[i]) ? dfRow[i] : 0;
    const shrunk = dfPrior === Infinity || !d ? phiPrior : (dfPrior * phiPrior + d * raw[i]) / (dfPrior + d);
    phi[i] = shrunk;
    se[i] = Math.sqrt(shrunk * unscaled[i]);
    // At most the degrees of freedom of every row together, as limma.
    const dfModel = dfPrior === Infinity ? Infinity : Math.min(dfPrior + d, pooled);
    // The reference's part, from the replicates' shifts alone (Satterthwaite).
    const total = shrunk * unscaled[i];
    const B = shrunk * referencePart[i];
    const A = total - B;
    seWithin[i] = Math.sqrt(Math.max(A, 0));
    dfWithin[i] = dfModel;
    const dfReference = reference.shifts.size - 1;
    if (B > 0 && dfReference > 0) {
      const denominator = (Number.isFinite(dfModel) ? square(A) / dfModel : 0) + square(B) / dfReference;
      // Down to a tenth (a little conservative, and few distinct values for t's quantiles).
      df[i] = Math.min(dfModel, Math.floor((10 * square(total)) / denominator) / 10);
    } else df[i] = dfModel;
  }
  return { estimate, se, df, phi, seWithin, dfWithin, model: { ...model, bReference: reference.variance, shifts: Object.fromEntries(reference.shifts), phiPrior, dfPrior } };
}
