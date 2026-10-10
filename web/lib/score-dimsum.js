// DiMSum's fitness and error model (requirements S9, Q4; Faure et al. 2020), as DiMSum 1.4 (MIT)
// computes them (R/dimsum__calculate_fitness.R, dimsum__error_model.R, dimsum__fit_error_model.R,
// dimsum__fit_error_model_bootstrap.R, dimsum__replicate_fitness_deviation.R), for the replicates of
// one experiment (a condition and a tile), each an input and an output:
//
//   fitness    f_r = ln(N_out/N_in) − ln(N_out,wt/N_in,wt), with no pseudocount: a zero count gives
//              no estimate, but for a dropout pseudocount added to an output of 0 whose input is
//              above 0;
//   normalised f′_r = (f_r + b_r)·a_r − c: a scale a_r and a shift b_r per replicate that bring the
//              replicates together (minimising Σ_v ‖(f_v + b)∘a − mean(f_v + b)‖ over the variants
//              counted in every sample above the input threshold, then a_1 = 1), c the wild type's
//              mean, so that it scores 0;
//   error      σ_r² = a_r·(m_in,r/N_in + m_out,r/N_out) + e_r: a multiplicative term m ≥ 1 for each
//              input and output (1: counting alone; above it, fewer molecules than reads somewhere,
//              a bottleneck) and an additive e ≥ 10⁻⁴ per replicate (variation between replicates),
//              fitted to the variance of each variant's normalised fitness over every subset of two
//              or more replicates (a subset's variance predicted by the mean of its replicates' σ²),
//              weighted by 1 / (count-based variance × √(variants with its number of
//              substitutions)). Without the model, σ² is the four reciprocal counts.
//
// DiMSum fits the error model by nls (port) on 100 bootstrap samples from random starts and takes
// their mean. The model is linear in its terms, with lower bounds, so its least-squares fit has one
// answer: MaveScape computes it on every variant at once (bounded least squares by an active set)
// and reports the 10th–90th percentiles of a seeded bootstrap of it, as DiMSum reports its own
// (DiMSum labels them a 90% interval). The scale and shift are found by a quasi-Newton minimisation
// where DiMSum uses R's nlm; both stop at the same minimum to their tolerances.

import { log, exp, square } from './dmath.js';

export const DIMSUM_DEFAULTS = { dropoutPseudocount: 0, normalise: true, errorModel: true, lowerReperror: 1e-4, maxN: 10000, maxCombinations: 500 };

// R's quantile, type 7, as R writes it ((1 − h)·x_lo + h·x_hi), on sorted values.
function quantile7(s, q) {
  const n = s.length;
  if (!n) return Number.NaN;
  const index = 1 + (n - 1) * q;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  const h = index - lo;
  return h > 0 && s[hi - 1] !== s[lo - 1] ? (1 - h) * s[lo - 1] + h * s[hi - 1] : s[lo - 1];
}

// A replicate's DiMSum fitness, WT-corrected: Float64Array (NaN where not finite). inp, out: counts
// (NaN missing); out already holding any dropout pseudocount.
export function dimsumFitness(inp, out, wtRow) {
  const wt = log(out[wtRow] / inp[wtRow]);
  const f = new Float64Array(inp.length);
  for (let i = 0; i < inp.length; i += 1) {
    const x = log(out[i] / inp[i]) - wt;
    f[i] = Number.isFinite(x) ? x : Number.NaN;
  }
  return f;
}

// Counts with DiMSum's dropout pseudocount: an output of 0 whose input is above 0 raised by it.
export function withDropout(inp, out, pseudocount) {
  if (!(pseudocount > 0)) return out;
  return Float64Array.from(out, (x, i) => (x === 0 && inp[i] > 0 ? x + pseudocount : x));
}

// The input count above which a variant's fitness spans the full range: exp(−q₀.₀₁) of the raw
// log ratios (not WT-corrected) of the variants with reads in every sample, every replicate pooled.
export function inputThreshold(inputs, outputs, allReads) {
  const values = [];
  for (let r = 0; r < inputs.length; r += 1) {
    for (let i = 0; i < allReads.length; i += 1) {
      if (!allReads[i]) continue;
      const x = log(outputs[r][i] / inputs[r][i]);
      if (Number.isFinite(x)) values.push(x);
    }
  }
  return exp(-quantile7(Float64Array.from(values).sort(), 0.01));
}

// DiMSum's measure of how far replicates disagree, for scales a and shifts b: Σ over the rows of
// F (each a variant's fitness in every replicate) of ‖(f + b)∘a − mean(f + b)‖, and its gradient.
function deviation(F, R, x) {
  const a = x.subarray(0, R);
  const b = x.subarray(R);
  let total = 0;
  const grad = new Float64Array(2 * R);
  const r = new Float64Array(R);
  for (let v = 0; v < F.length; v += R) {
    let m = 0;
    for (let j = 0; j < R; j += 1) m += F[v + j] + b[j];
    m /= R;
    let ss = 0;
    for (let j = 0; j < R; j += 1) {
      r[j] = (F[v + j] + b[j]) * a[j] - m;
      ss += r[j] * r[j];
    }
    const d = Math.sqrt(ss);
    total += d;
    if (!(d > 0)) continue;
    let sr = 0;
    for (let j = 0; j < R; j += 1) sr += r[j];
    for (let j = 0; j < R; j += 1) {
      grad[j] += (r[j] * (F[v + j] + b[j])) / d;
      grad[R + j] += (r[j] * a[j] - sr / R) / d;
    }
  }
  return { value: total, grad };
}

// The scale and shift of each replicate (DiMSum's replicate normalisation). F: Float64Array of
// rows × R (WT-corrected fitness of the variants counted in every sample above the threshold).
// Minimised by BFGS from a = 1, b = 0, then a divided by a_1. Returns { scale, shift, value,
// iterations, converged }.
export function fitNormalisation(F, R, { maxIterations = 2000 } = {}) {
  const n = 2 * R;
  let x = new Float64Array(n);
  for (let j = 0; j < R; j += 1) x[j] = 1;
  let cur = deviation(F, R, x);
  // The inverse Hessian, from the identity scaled to the first step.
  let H = new Float64Array(n * n);
  for (let j = 0; j < n; j += 1) H[j * n + j] = 1;
  let iterations = 0;
  let converged = false;
  // Iterations in a row that have not lowered the sum (it has kinks, where the gradient never
  // vanishes: five without a change is a minimum).
  let still = 0;
  const gnorm = (g) => Math.sqrt(g.reduce((s, v) => s + v * v, 0));
  const scale0 = Math.max(1, cur.value);
  for (; iterations < maxIterations; iterations += 1) {
    if (gnorm(cur.grad) <= 1e-12 * scale0) {
      converged = true;
      break;
    }
    const dir = new Float64Array(n);
    for (let i = 0; i < n; i += 1) for (let j = 0; j < n; j += 1) dir[i] -= H[i * n + j] * cur.grad[j];
    let slope = 0;
    for (let i = 0; i < n; i += 1) slope += dir[i] * cur.grad[i];
    if (!(slope < 0)) {
      // Not a descent direction: start the curvature again.
      H = new Float64Array(n * n);
      for (let j = 0; j < n; j += 1) H[j * n + j] = 1;
      for (let i = 0; i < n; i += 1) dir[i] = -cur.grad[i];
      slope = -square(gnorm(cur.grad));
    }
    // Backtracking (Armijo) line search; the first step of the identity is scaled.
    let t = iterations === 0 ? Math.min(1, 0.1 / Math.max(1e-300, gnorm(cur.grad) / Math.sqrt(n))) : 1;
    let next;
    let xn;
    for (let k = 0; k < 60; k += 1) {
      xn = Float64Array.from(x, (v, i) => v + t * dir[i]);
      next = deviation(F, R, xn);
      if (next.value <= cur.value + 1e-4 * t * slope) break;
      t /= 2;
    }
    if (!(next.value <= cur.value)) {
      converged = true;
      break;
    }
    const s = Float64Array.from(xn, (v, i) => v - x[i]);
    const y = Float64Array.from(next.grad, (v, i) => v - cur.grad[i]);
    let sy = 0;
    for (let i = 0; i < n; i += 1) sy += s[i] * y[i];
    const change = Math.abs(cur.value - next.value);
    x = xn;
    cur = next;
    if (sy > 1e-300) {
      // BFGS update of the inverse Hessian.
      const Hy = new Float64Array(n);
      for (let i = 0; i < n; i += 1) for (let j = 0; j < n; j += 1) Hy[i] += H[i * n + j] * y[j];
      let yHy = 0;
      for (let i = 0; i < n; i += 1) yHy += y[i] * Hy[i];
      for (let i = 0; i < n; i += 1) {
        for (let j = 0; j < n; j += 1) {
          H[i * n + j] += ((sy + yHy) * s[i] * s[j]) / (sy * sy) - (Hy[i] * s[j] + s[i] * Hy[j]) / sy;
        }
      }
    }
    still = change <= 1e-14 * scale0 ? still + 1 : 0;
    if (still >= 5) {
      converged = true;
      break;
    }
  }
  const scale = Array.from(x.subarray(0, R));
  const shift = Array.from(x.subarray(R));
  const first = scale[0];
  return { scale: scale.map((v) => v / first), shift, value: cur.value, iterations, converged };
}

// Every subset of two or more of R replicates, as R's combn lists them, the largest first (at
// most `max`).
export function replicateSubsets(R, max = DIMSUM_DEFAULTS.maxCombinations) {
  const out = [];
  for (let size = R; size >= 2; size -= 1) {
    const pick = Array.from({ length: size }, (_, i) => i);
    for (;;) {
      out.push(pick.slice());
      let i = size - 1;
      while (i >= 0 && pick[i] === R - size + i) i -= 1;
      if (i < 0) break;
      pick[i] += 1;
      for (let j = i + 1; j < size; j += 1) pick[j] = pick[j - 1] + 1;
    }
  }
  return out.slice(0, max);
}

// Each fitting variant's contribution to the error model's normal equations, over every subset of
// replicates: G_v = Σ w x xᵀ and g_v = Σ w x y (3R terms: the input, output and additive terms of
// each replicate). fitness: normalised, by replicate; inputs, outputs: counts; cbe: count-based
// SDs; scale: a_r; rows: the fitting variants; weightOf(v): DiMSum's 1 / √(variants with its
// number of substitutions) part of the weight. Returns { G (rows × P²), g (rows × P), P }.
export function errorModelTerms({ fitness, inputs, outputs, cbe, scale, rows, weightOf, subsets }) {
  const R = fitness.length;
  const P = 3 * R;
  const G = new Float64Array(rows.length * P * P);
  const g = new Float64Array(rows.length * P);
  const x = new Float64Array(P);
  rows.forEach((v, k) => {
    for (const subset of subsets) {
      const size = subset.length;
      // The subset's variance of normalised fitness (n − 1), and its mean count-based SD.
      let mean = 0;
      let meanCbe = 0;
      for (const r of subset) {
        mean += fitness[r][v];
        meanCbe += cbe[r][v];
      }
      mean /= size;
      meanCbe /= size;
      let ss = 0;
      for (const r of subset) ss += square(fitness[r][v] - mean);
      const y = ss / (size - 1);
      const w = 1 / (meanCbe * meanCbe) / weightOf(v);
      x.fill(0);
      for (const r of subset) {
        x[r] = (scale[r] / inputs[r][v]) / size;
        x[R + r] = (scale[r] / outputs[r][v]) / size;
        x[2 * R + r] = 1 / size;
      }
      const baseG = k * P * P;
      const baseg = k * P;
      for (let i = 0; i < P; i += 1) {
        if (!x[i]) continue;
        g[baseg + i] += w * x[i] * y;
        for (let j = 0; j < P; j += 1) if (x[j]) G[baseG + i * P + j] += w * x[i] * x[j];
      }
    }
  });
  return { G, g, P };
}

// Least squares with lower bounds on its normal equations: minimise ½pᵀGp − gᵀp subject to
// p ≥ lower (Lawson and Hanson's active set, on p − lower ≥ 0, columns scaled to unit diagonal).
// Returns p, or null when G is singular on the free set.
export function boundedLeastSquares(G, g, lower) {
  const P = lower.length;
  const d = Float64Array.from({ length: P }, (_, i) => (G[i * P + i] > 0 ? 1 / Math.sqrt(G[i * P + i]) : 1));
  // Scaled: G' = D G D, h' = D (g − G lower); q' = D⁻¹ (p − lower).
  const Gs = new Float64Array(P * P);
  for (let i = 0; i < P; i += 1) for (let j = 0; j < P; j += 1) Gs[i * P + j] = d[i] * G[i * P + j] * d[j];
  const h = new Float64Array(P);
  for (let i = 0; i < P; i += 1) {
    let s = g[i];
    for (let j = 0; j < P; j += 1) s -= G[i * P + j] * lower[j];
    h[i] = d[i] * s;
  }
  const q = new Float64Array(P);
  const free = new Uint8Array(P);
  const tol = 1e-12 * Math.max(1, ...h.map(Math.abs));
  const gradient = () => Float64Array.from(h, (v, i) => {
    let s = v;
    for (let j = 0; j < P; j += 1) s -= Gs[i * P + j] * q[j];
    return s;
  });
  const solveFree = () => {
    const idx = [];
    for (let i = 0; i < P; i += 1) if (free[i]) idx.push(i);
    const m = idx.length;
    // Cholesky of G'[free, free].
    const L = new Float64Array(m * m);
    for (let i = 0; i < m; i += 1) {
      for (let j = 0; j <= i; j += 1) {
        let s = Gs[idx[i] * P + idx[j]];
        for (let k = 0; k < j; k += 1) s -= L[i * m + k] * L[j * m + k];
        if (i === j) {
          if (!(s > 1e-14)) return null;
          L[i * m + i] = Math.sqrt(s);
        } else L[i * m + j] = s / L[j * m + j];
      }
    }
    const z = new Float64Array(m);
    for (let i = 0; i < m; i += 1) {
      let s = h[idx[i]];
      for (let k = 0; k < i; k += 1) s -= L[i * m + k] * z[k];
      z[i] = s / L[i * m + i];
    }
    const sol = new Float64Array(P);
    for (let i = m - 1; i >= 0; i -= 1) {
      let s = z[i];
      for (let k = i + 1; k < m; k += 1) s -= L[k * m + i] * sol[idx[k]];
      sol[idx[i]] = s / L[i * m + i];
    }
    return sol;
  };
  for (let outer = 0; outer < 10 * P; outer += 1) {
    const w = gradient();
    let best = -1;
    for (let i = 0; i < P; i += 1) if (!free[i] && w[i] > tol && (best < 0 || w[i] > w[best])) best = i;
    if (best < 0) break;
    free[best] = 1;
    for (let inner = 0; inner < 10 * P; inner += 1) {
      const s = solveFree();
      if (!s) return null;
      let feasible = true;
      for (let i = 0; i < P; i += 1) if (free[i] && s[i] <= 0) feasible = false;
      if (feasible) {
        q.set(s);
        break;
      }
      let alpha = Infinity;
      for (let i = 0; i < P; i += 1) if (free[i] && s[i] <= 0) alpha = Math.min(alpha, q[i] / (q[i] - s[i]));
      for (let i = 0; i < P; i += 1) if (free[i]) q[i] += alpha * (s[i] - q[i]);
      for (let i = 0; i < P; i += 1) {
        if (free[i] && q[i] <= 1e-15) {
          free[i] = 0;
          q[i] = 0;
        }
      }
    }
  }
  return Array.from(q, (v, i) => lower[i] + d[i] * v);
}

// Sums the rows' terms with multiplicities (all 1: every variant; a bootstrap's draws otherwise).
function summed(terms, count = null) {
  const { G, g, P } = terms;
  const rows = g.length / P;
  const GG = new Float64Array(P * P);
  const gg = new Float64Array(P);
  for (let k = 0; k < rows; k += 1) {
    const c = count ? count[k] : 1;
    if (!c) continue;
    for (let i = 0; i < P * P; i += 1) GG[i] += c * G[k * P * P + i];
    for (let i = 0; i < P; i += 1) gg[i] += c * g[k * P + i];
  }
  return { G: GG, g: gg };
}

// The error model of R replicates from its terms: { input, output, reperror } (each R values), the
// fit on every variant; with `random` and `samples`, the 10th and 90th percentiles of a bootstrap
// (each sample min(variants, maxN) variants drawn with replacement, as DiMSum draws them).
export function fitErrorModel(terms, R, { lowerReperror = DIMSUM_DEFAULTS.lowerReperror, random = null, samples = 0, maxN = DIMSUM_DEFAULTS.maxN } = {}) {
  const lower = [...new Array(2 * R).fill(1), ...new Array(R).fill(lowerReperror)];
  const all = summed(terms);
  const p = boundedLeastSquares(all.G, all.g, lower);
  if (!p) return null;
  const split = (x) => ({ input: x.slice(0, R), output: x.slice(R, 2 * R), reperror: x.slice(2 * R) });
  const out = { ...split(p), intervals: null, bootstrap: 0 };
  if (random && samples > 0) {
    const rows = terms.g.length / terms.P;
    const draws = Math.min(rows, maxN);
    const fits = [];
    const count = new Int32Array(rows);
    for (let b = 0; b < samples; b += 1) {
      count.fill(0);
      for (let k = 0; k < draws; k += 1) count[random.int(rows)] += 1;
      const s = summed(terms, count);
      const q = boundedLeastSquares(s.G, s.g, lower);
      if (q) fits.push(q);
    }
    const lo = [];
    const hi = [];
    for (let i = 0; i < 3 * R; i += 1) {
      const col = Float64Array.from(fits, (f) => f[i]).sort();
      lo.push(quantile7(col, 0.1));
      hi.push(quantile7(col, 0.9));
    }
    out.intervals = { lower: split(lo), upper: split(hi) };
    out.bootstrap = fits.length;
  }
  return out;
}

// σ of a replicate's normalised fitness: with the error model √(a·(m_in/N_in + m_out/N_out) + e)
// (DiMSum's, the scale not squared); without it, the four reciprocal counts.
export function dimsumSigma(N_in, N_out, { scale = 1, input = null, output = null, reperror = null, wtIn, wtOut }) {
  if (input === null) return Math.sqrt(1 / N_out + 1 / N_in + (1 / wtOut + 1 / wtIn));
  return Math.sqrt(scale * (input / N_in + output / N_out) + reperror);
}

// A variant's number of substitutions from its MAVE-HGVS key, for DiMSum's weights (its Hamming
// distance from the wild type; at the protein level, synonymous changes not counting): p.= and
// c.= 0, a single change 1, p.[Ala2Val;Leu5=] 1, c.[4A>G;6T>C] 2; −1 without a key.
export function substitutionsOf(key) {
  if (!key) return -1;
  if (key === 'p.=' || key === 'c.=' || key === 'p.(=)') return 0;
  const protein = key.startsWith('p.');
  const parts = key.includes('[') ? key.slice(key.indexOf('[') + 1, key.lastIndexOf(']')).split(';') : [key.slice(2)];
  return parts.filter((x) => !(protein && x.endsWith('='))).length;
}

// Scores the replicates of one experiment by DiMSum. inputs, outputs: each replicate's counts
// (Float64Array, NaN where not counted or left out by a count filter); wtRow; substitutions: each
// variant's (substitutionsOf; −1 leaves it out of the fit); options: { dropoutPseudocount,
// normalise, errorModel, random, samples (bootstrap), fixed: { scale, shift, input, output,
// reperror } (DiMSum's own parameters, for validation) }. Returns { score, se (per replicate,
// Float64Array), model: { scale, shift, input, output, reperror, intervals, bootstrap, threshold,
// variants (fitted), wildType }, refused (a reason) }.
export function scoreDimsumGroup({ inputs, outputs, wtRow, substitutions, options = {} }) {
  const o = { ...DIMSUM_DEFAULTS, ...options };
  const R = inputs.length;
  const n = inputs[0].length;
  const fit = R >= 2 && (o.normalise || o.errorModel);
  const model = { scale: new Array(R).fill(1), shift: new Array(R).fill(0), input: null, output: null, reperror: null, intervals: null, bootstrap: 0, threshold: Number.NaN, variants: 0, normalised: false };
  // Variants with reads in every input and output.
  const allReads = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    let ok = substitutions[i] >= 0;
    for (let r = 0; r < R && ok; r += 1) if (!(inputs[r][i] > 0 && outputs[r][i] > 0)) ok = false;
    allReads[i] = ok ? 1 : 0;
  }
  if (wtRow < 0 || !allReads[wtRow]) return { refused: 'DiMSum normalises to the wild type, which needs reads in every input and output of the experiment.' };
  if (o.fixed) {
    Object.assign(model, { scale: o.fixed.scale, shift: o.fixed.shift, input: o.fixed.input ?? null, output: o.fixed.output ?? null, reperror: o.fixed.reperror ?? null, normalised: true });
  } else if (fit) {
    // The input threshold, and the variants above it in every replicate. The threshold is often a
    // ratio of counts (112 reads in, 1 out), which exp(−log(1/112)) gives within a unit of its last
    // bit, below it in one engine and above in another: a count within 10⁻¹² of it counts as above,
    // the same everywhere (R's exp puts 112 below; DiMSum keeps those variants there).
    model.threshold = inputThreshold(inputs, outputs, allReads);
    const above = new Uint8Array(n);
    const bar = model.threshold * (1 - 1e-12);
    for (let i = 0; i < n; i += 1) {
      if (!allReads[i]) continue;
      let ok = true;
      for (let r = 0; r < R; r += 1) if (!(inputs[r][i] > bar)) ok = false;
      above[i] = ok ? 1 : 0;
    }
    const raw = inputs.map((inp, r) => dimsumFitness(inp, outputs[r], wtRow));
    const fitting = [];
    for (let i = 0; i < n; i += 1) if (above[i] && i !== wtRow) fitting.push(i);
    if (fitting.length < 10 * 3 * R) return { refused: `DiMSum's ${o.errorModel ? 'error model' : 'scaling of replicates'} needs ${10 * 3 * R} variants (ten for each of the model's ${3 * R} terms) with reads in every sample and input counts above ${model.threshold.toPrecision(3)} in every replicate; ${fitting.length} have them. Turn off DiMSum's ${o.errorModel && o.normalise ? 'scaling and error model' : o.errorModel ? 'error model' : 'scaling'} to score with the counting error alone.` };
    if (o.normalise) {
      const rows = [];
      for (let i = 0; i < n; i += 1) if (above[i]) rows.push(i);
      const F = new Float64Array(rows.length * R);
      rows.forEach((i, k) => {
        for (let r = 0; r < R; r += 1) F[k * R + r] = raw[r][i];
      });
      const nf = fitNormalisation(F, R);
      model.scale = nf.scale;
      model.shift = nf.shift;
      model.value = nf.value;
      model.normalised = true;
    }
    if (o.errorModel) {
      const wtCorr = mean(model.shift.map((b, r) => b * model.scale[r]));
      const fitness = raw.map((f, r) => Float64Array.from(f, (x) => (x + model.shift[r]) * model.scale[r] - wtCorr));
      const cbe = inputs.map((inp, r) => {
        const wt = 1 / outputs[r][wtRow] + 1 / inp[wtRow];
        const a = Math.sqrt(Math.abs(model.scale[r]));
        return Float64Array.from(inp, (x, i) => a * Math.sqrt(1 / outputs[r][i] + 1 / x + wt));
      });
      // The weight of a number of substitutions: √(max(variants with it, √(variants))), over every
      // variant counted somewhere.
      // (Every variant DiMSum keeps: counted in some input and some output.)
      const counted = [];
      for (let i = 0; i < n; i += 1) if (substitutions[i] >= 0 && inputs.some((inp) => !Number.isNaN(inp[i])) && outputs.some((out) => !Number.isNaN(out[i]))) counted.push(i);
      const groups = new Map();
      for (const i of counted) groups.set(substitutions[i], (groups.get(substitutions[i]) ?? 0) + 1);
      const floor = Math.sqrt(counted.length);
      const weightOf = (i) => Math.sqrt(Math.max(groups.get(substitutions[i]), floor));
      const terms = errorModelTerms({ fitness, inputs, outputs, cbe, scale: model.scale, rows: fitting, weightOf, subsets: replicateSubsets(R) });
      const em = fitErrorModel(terms, R, { random: o.random, samples: o.samples });
      if (!em) return { refused: 'DiMSum\'s error model could not be fitted (its terms are not identifiable from these counts). Use the counting error alone.' };
      Object.assign(model, { input: em.input, output: em.output, reperror: em.reperror, intervals: em.intervals, bootstrap: em.bootstrap });
    }
    model.variants = fitting.length;
  }
  // Fitness and σ of every variant, from counts with the dropout pseudocount.
  const wtCorr = model.normalised ? mean(model.shift.map((b, r) => b * model.scale[r])) : 0;
  const score = [];
  const se = [];
  for (let r = 0; r < R; r += 1) {
    const out = withDropout(inputs[r], outputs[r], o.dropoutPseudocount);
    const f = dimsumFitness(inputs[r], out, wtRow);
    const s = new Float64Array(n).fill(Number.NaN);
    const terms = { scale: model.scale[r], input: model.input?.[r] ?? null, output: model.output?.[r] ?? null, reperror: model.reperror?.[r] ?? null, wtIn: inputs[r][wtRow], wtOut: out[wtRow] };
    for (let i = 0; i < n; i += 1) {
      if (Number.isNaN(f[i])) continue;
      if (model.normalised) f[i] = (f[i] + model.shift[r]) * model.scale[r] - wtCorr;
      s[i] = dimsumSigma(inputs[r][i], out[i], terms);
    }
    score.push(f);
    se.push(s);
  }
  return { score, se, model };
}

function mean(x) {
  let s = 0;
  for (const v of x) s += v;
  return s / x.length;
}
