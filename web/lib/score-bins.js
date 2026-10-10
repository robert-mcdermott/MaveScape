// Sorted-bin scores (requirement S7; mavescape-spec/research.md §2.4): cells sorted by a reporter
// into ordered bins, each bin sequenced. For one biological replicate (technical replicates
// already summed), two estimates per variant:
//
// - The weighted average of the bin values (VAMP-seq, Matreyek et al. 2018; MultiSTEP, Popp et al.
//   2025): with F_b = c_b / R_b the variant's frequency in bin b (R_b the bin's reads over every
//   variant counted there) and w_b the bin's value (its rank, the VAMP-seq weights 0.25–1, or a
//   fluorescence),
//       W = Σ_b w_b F_b / Σ_b F_b.
//   Its SE by the delta method from Poisson counts, Var W = Σ_b (w_b − W̃)² c̃_b / R_b² / (Σ_b c̃_b/R_b)²,
//   with c̃ = c + pseudocount so that a variant seen in one bin is not known exactly; or by a
//   seeded parametric bootstrap (counts redrawn as Poisson(c̃)).
// - The censored log-normal maximum-likelihood estimate (Peterman & Levine 2016), when the bins'
//   gates are known: the variant's cells have log fluorescence ~ N(μ, σ²) and are seen only as
//   counts per gate interval [ln L_b, ln U_b) (the outer bins open), so
//       log L(μ, σ) = Σ_b n_b ln[Φ((ln U_b − μ)/σ) − Φ((ln L_b − μ)/σ)],
//   with n_b the variant's cells in bin b: its reads there in proportion to the cells sorted into
//   the bin (equal cells when not given), scaled to the smaller of its reads and its estimated
//   cells (the scarcer sampling limits what is known). σ is the wild type's (one parameter
//   per variant, the default) or each variant's own (which needs reads in three bins). The score
//   is μ, its SE from the observed information.
//
// A replicate's scores can then be scaled (VAMP-seq: nonsense median 0, wild type 1; MultiSTEP:
// the median of the lowest 5% 0, wild type 1) before replicates are combined.

import { exp, log, normalCdf, normalPdf, normalUpper, square } from './dmath.js';
import { poisson } from './random.js';

export const BIN_SCALES = {
  'nonsense-wt': 'nonsense median 0, wild type 1 (VAMP-seq)',
  'low5-wt': 'median of the lowest 5% 0, wild type 1 (MultiSTEP)',
  none: 'unscaled (the weighted bin value, or μ of log fluorescence)',
};
export const BIN_SE = { analytic: 'from counting (delta method)', bootstrap: 'seeded bootstrap of the counts' };
export const BIN_SIGMA = { 'wild-type': 'the wild type\'s, for every variant', 'per-variant': 'each variant\'s own (needs reads in three bins)' };

// Each bin's reads over every variant counted in it.
export function binTotals(bins) {
  return bins.map((c) => {
    let s = 0;
    for (let i = 0; i < c.length; i += 1) if (!Number.isNaN(c[i])) s += c[i];
    return s;
  });
}

function average(c, values, totals) {
  let s = 0;
  let sw = 0;
  for (let b = 0; b < c.length; b += 1) {
    const f = c[b] / totals[b];
    s += f;
    sw += values[b] * f;
  }
  return s > 0 ? { w: sw / s, s } : { w: Number.NaN, s };
}

// Weighted averages of one replicate. bins: [Float64Array] (counts per bin, in bin order); values:
// the bins' values; use: Uint8Array (1 where scored). options: { pseudocount, totals, se:
// 'analytic' | 'bootstrap', samples, random (for the bootstrap) }. Returns { score, se, frequency
// (Σ F_b, the variant's summed bin frequency), reads }.
export function binAverages(bins, values, use, options = {}) {
  const { pseudocount = 0.5, totals = binTotals(bins), se: seMethod = 'analytic', samples = 200, random = null } = options;
  const n = bins[0].length;
  const B = bins.length;
  const score = new Float64Array(n).fill(Number.NaN);
  const se = new Float64Array(n).fill(Number.NaN);
  const frequency = new Float64Array(n).fill(Number.NaN);
  const reads = new Float64Array(n).fill(Number.NaN);
  const c = new Float64Array(B);
  const ct = new Float64Array(B);
  for (let i = 0; i < n; i += 1) {
    if (!use[i]) continue;
    let total = 0;
    for (let b = 0; b < B; b += 1) {
      c[b] = bins[b][i];
      ct[b] = c[b] + pseudocount;
      total += c[b];
    }
    const a = average(c, values, totals);
    score[i] = a.w;
    frequency[i] = a.s;
    reads[i] = total;
    if (!Number.isFinite(a.w)) continue;
    if (seMethod === 'bootstrap') {
      if (!random) throw new Error('A bootstrap needs a seeded random generator.');
      let m = 0;
      let m2 = 0;
      let k = 0;
      const draw = new Float64Array(B);
      for (let r = 0; r < samples; r += 1) {
        for (let b = 0; b < B; b += 1) draw[b] = poisson(random, ct[b]);
        const d = average(draw, values, totals);
        if (!Number.isFinite(d.w)) continue;
        k += 1;
        const delta = d.w - m;
        m += delta / k;
        m2 += delta * (d.w - m);
      }
      se[i] = k > 1 ? Math.sqrt(m2 / (k - 1)) : Number.NaN;
    } else {
      const t = average(ct, values, totals);
      let v = 0;
      for (let b = 0; b < B; b += 1) {
        const d = values[b] - t.w;
        v += (d * d * ct[b]) / (totals[b] * totals[b]);
      }
      se[i] = Math.sqrt(v) / t.s;
    }
  }
  return { score, se, frequency, reads };
}

// The anchors of a replicate's scale: { zero, one } (one: the wild type's score). Throws, saying
// why, when they are not available.
export function scaleAnchors(scale, score, use, { wt = -1, nonsense = [], label = 'this replicate' }) {
  if (scale === 'none') return null;
  if (wt < 0 || !use[wt] || !Number.isFinite(score[wt])) throw new Error(`Scaling ${label} to the wild type needs the wild type scored there, and it is not: choose "unscaled", or name the wild type in the design's controls.`);
  let zero;
  if (scale === 'nonsense-wt') {
    const values = nonsense.filter((i) => use[i] && Number.isFinite(score[i])).map((i) => score[i]);
    if (!values.length) throw new Error(`Scaling ${label} to its nonsense variants needs some scored there, and there are none: choose the lowest-5% scale, or "unscaled".`);
    zero = medianOf(values);
  } else if (scale === 'low5-wt') {
    const values = [];
    for (let i = 0; i < score.length; i += 1) if (use[i] && Number.isFinite(score[i])) values.push(score[i]);
    values.sort((a, b) => a - b);
    zero = medianOf(values.slice(0, Math.max(1, Math.ceil(values.length * 0.05))));
  } else {
    throw new Error(`Unknown bin scale "${scale}".`);
  }
  const one = score[wt];
  if (!(Math.abs(one - zero) > 0)) throw new Error(`In ${label} the wild type scores the same as the scale's zero: scores cannot be scaled by them.`);
  return { zero, one };
}

function medianOf(values) {
  const sorted = Float64Array.from(values).sort();
  const n = sorted.length;
  return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

// --- Maximum likelihood ------------------------------------------------------------------------

// P(lower ≤ log fluorescence < upper) for N(μ, σ²), without cancellation in either tail.
function intervalProbability(lo, hi, mu, sigma) {
  const a = (lo - mu) / sigma;
  const b = (hi - mu) / sigma;
  if (a > 0) return normalUpper(a) - normalUpper(b);
  return normalCdf(b) - normalCdf(a);
}

// The log-likelihood and its gradient in (μ, σ).
function likelihood(n, lo, hi, mu, sigma) {
  let ll = 0;
  let gm = 0;
  let gs = 0;
  for (let b = 0; b < n.length; b += 1) {
    if (!(n[b] > 0)) continue;
    const p = intervalProbability(lo[b], hi[b], mu, sigma);
    if (!(p > 0)) return { ll: -Infinity, gm: Number.NaN, gs: Number.NaN };
    ll += n[b] * log(p);
    const za = (lo[b] - mu) / sigma;
    const zb = (hi[b] - mu) / sigma;
    const pa = Number.isFinite(za) ? normalPdf(za) : 0;
    const pb = Number.isFinite(zb) ? normalPdf(zb) : 0;
    gm += (n[b] * (pa - pb)) / (sigma * p);
    gs += (n[b] * ((Number.isFinite(za) ? za * pa : 0) - (Number.isFinite(zb) ? zb * pb : 0))) / (sigma * p);
  }
  return { ll, gm, gs };
}

// The maximum-likelihood (μ, σ) of a censored log-normal. n: effective counts per bin; lo, hi: the
// bins' bounds in log fluorescence (−Infinity and Infinity for the open outer bins); sigma: fixed,
// or null to fit it too. Returns { mu, sigma, se (of μ), converged, estimable, reason }.
export function binMLE(n, lo, hi, sigma = null) {
  const B = n.length;
  let total = 0;
  let occupied = 0;
  for (let b = 0; b < B; b += 1) {
    if (n[b] > 0) {
      total += n[b];
      occupied += 1;
    }
  }
  const out = (fields) => ({ mu: Number.NaN, sigma: Number.NaN, se: Number.NaN, converged: false, estimable: false, ...fields });
  if (!(total > 0)) return out({ reason: 'no reads' });
  const only = occupied === 1 ? n.findIndex((x) => x > 0) : -1;
  if (only >= 0 && (!Number.isFinite(lo[only]) || !Number.isFinite(hi[only]))) return out({ reason: 'all reads in an open outer bin' });
  if (sigma === null && occupied < 3) return out({ reason: 'reads in fewer than three bins, with σ fitted' });
  // A start: the mean and SD of the bins' midpoints (an open bin one width beyond its gate).
  const widths = [];
  for (let b = 0; b < B; b += 1) if (Number.isFinite(lo[b]) && Number.isFinite(hi[b])) widths.push(hi[b] - lo[b]);
  const width = widths.length ? widths.reduce((a, x) => a + x, 0) / widths.length : 1;
  const mid = (b) => (Number.isFinite(lo[b]) && Number.isFinite(hi[b]) ? (lo[b] + hi[b]) / 2 : Number.isFinite(hi[b]) ? hi[b] - width / 2 : lo[b] + width / 2);
  let mu = 0;
  for (let b = 0; b < B; b += 1) mu += (n[b] * mid(b)) / total;
  let s = sigma;
  if (s === null) {
    let v = 0;
    for (let b = 0; b < B; b += 1) v += (n[b] * square(mid(b) - mu)) / total;
    s = Math.max(Math.sqrt(v), width / 2);
  }
  // Newton's method on (μ, ln σ) (or μ alone), with the Hessian from differences of the gradient
  // and step halving until the likelihood rises.
  const fitSigma = sigma === null;
  const grad = (m, t) => {
    const g = likelihood(n, lo, hi, m, exp(t));
    return [g.gm, g.gs * exp(t), g.ll];
  };
  let t = log(s);
  let converged = false;
  for (let it = 0; it < 200; it += 1) {
    const [gm, gt, ll] = grad(mu, t);
    const h = 1e-6;
    const [gmM, gtM] = grad(mu + h, t);
    let step;
    if (fitSigma) {
      const [gmT, gtT] = grad(mu, t + h);
      const hmm = (gmM - gm) / h;
      const hmt = ((gtM - gt) / h + (gmT - gm) / h) / 2;
      const htt = (gtT - gt) / h;
      const det = hmm * htt - hmt * hmt;
      step = det > 0 && hmm < 0 ? [-(htt * gm - hmt * gt) / det, -(hmm * gt - hmt * gm) / det] : [gm * 0.1, gt * 0.1];
    } else {
      const hmm = (gmM - gm) / h;
      step = [hmm < 0 ? -gm / hmm : gm * 0.1, 0];
    }
    let scale = 1;
    let accepted = false;
    for (let k = 0; k < 60; k += 1) {
      const m2 = mu + scale * step[0];
      const t2 = t + scale * step[1];
      const l2 = likelihood(n, lo, hi, m2, exp(t2)).ll;
      if (l2 >= ll - 1e-12 * Math.abs(ll)) {
        mu = m2;
        t = t2;
        accepted = true;
        break;
      }
      scale /= 2;
    }
    if (!accepted || (Math.abs(scale * step[0]) < 1e-11 && Math.abs(scale * step[1]) < 1e-11)) {
      converged = accepted || Math.abs(gm) < 1e-6 * total;
      break;
    }
  }
  s = exp(t);
  // The SE of μ: the inverse of the observed information in (μ, σ) (or μ alone).
  const g0 = likelihood(n, lo, hi, mu, s);
  const h = 1e-5 * Math.max(1, Math.abs(mu));
  const gMu = likelihood(n, lo, hi, mu + h, s);
  const imm = -(gMu.gm - g0.gm) / h;
  let varMu;
  if (fitSigma) {
    const hs = 1e-5 * s;
    const gS = likelihood(n, lo, hi, mu, s + hs);
    const iss = -(gS.gs - g0.gs) / hs;
    const ims = -((gMu.gs - g0.gs) / h + (gS.gm - g0.gm) / hs) / 2;
    const det = imm * iss - ims * ims;
    varMu = det > 0 ? iss / det : Number.NaN;
  } else {
    varMu = imm > 0 ? 1 / imm : Number.NaN;
  }
  if (!Number.isFinite(mu) || !(s > 0)) return out({ reason: 'the fit did not converge' });
  return { mu, sigma: s, se: Math.sqrt(varMu), converged, estimable: true, reason: null };
}

// One replicate's MLE scores. bins: [Float64Array]; lower, upper: the bins' gates in fluorescence
// (null at the open ends); cells: cells sorted into each bin (null: equal); use: Uint8Array;
// sigma: a fixed σ or null. Returns { score (μ), se, sigma, reason: [per row, or null] }.
export function binMLEScores(bins, lower, upper, cells, use, { sigma = null, totals = binTotals(bins) } = {}) {
  const B = bins.length;
  const n = bins[0].length;
  const lo = lower.map((x) => (x === null || x === undefined || !(x > 0) ? -Infinity : log(x)));
  const hi = upper.map((x) => (x === null || x === undefined ? Infinity : log(x)));
  const weighted = Boolean(cells && cells.every((x) => x > 0));
  const weight = totals.map((r, b) => (weighted ? cells[b] : 1) / r);
  const score = new Float64Array(n).fill(Number.NaN);
  const se = new Float64Array(n).fill(Number.NaN);
  const sigmas = new Float64Array(n).fill(Number.NaN);
  const reason = new Array(n).fill(null);
  const eff = new Float64Array(B);
  for (let i = 0; i < n; i += 1) {
    if (!use[i]) continue;
    let reads = 0;
    let p = 0;
    for (let b = 0; b < B; b += 1) {
      reads += bins[b][i];
      eff[b] = bins[b][i] * weight[b];
      p += eff[b];
    }
    // Effective counts: the cells' distribution over the bins, scaled to the variant's reads or, when
    // fewer, its estimated cells (Σ_b c_b × cells_b / R_b).
    const size = weighted ? Math.min(reads, p) : reads;
    for (let b = 0; b < B; b += 1) eff[b] = p > 0 ? (eff[b] / p) * size : 0;
    const fit = binMLE(eff, lo, hi, sigma);
    if (!fit.estimable) {
      reason[i] = fit.reason;
      continue;
    }
    score[i] = fit.mu;
    se[i] = fit.se;
    sigmas[i] = fit.sigma;
  }
  return { score, se, sigma: sigmas, reason };
}
