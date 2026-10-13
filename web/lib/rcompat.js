// Numerics that give what R gives (wave 8, slice 4), so that score-level likelihood ratios equal
// acmgscaler's, an R package (lib/likelihood.js): R's Mersenne Twister as set.seed seeds it and
// sample()'s rejection sampling; the Gaussian kernel density estimate by linear binning and the
// fast Fourier transform, as density() makes it; the biased cross-validation bandwidth (bw.bcv);
// Brent's minimizer (optimize); isotonic regression (isoreg); linear interpolation (approx);
// the median absolute deviation, Spearman's correlation, findInterval and the binomial quantile.
// R is GPL: none of this is R's code. Each is written from its publication, and every convention
// (the scrambling of a seed, the grid a density is binned on, how distances are binned) was found
// by experiment against R 4.6.1 as a black box and is checked against it (validation suite
// `likelihood`, reference/generate_likelihood.R), as wave 2's limma.js was.

import { exp, log, pow } from './dmath.js';

// --- Random numbers ----------------------------------------------------------------------------------

// The Mersenne Twister MT19937 (Matsumoto and Nishimura, ACM TOMACS 1998;8:3–30), seeded as R's
// set.seed(seed, kind = "Mersenne-Twister") seeds it: the seed scrambled by the linear congruential
// generator x ← 69069 x + 1 (mod 2³²) fifty times, then each of the 624 words of the state the next
// value of it (found by comparing with R's .Random.seed). Returns { unif, index, state }:
//   unif(): a double in (0, 1), the 32-bit output over 2³² (R's unif_rand: 0 and 1 never);
//   index(n): an integer in [0, n) by rejection, as sample.kind = "Rejection" draws one: the bits
//     of the next power of two of n built 16 at a time from unif() (⌊65536 u⌋), the extra masked
//     off, again until below n (found by comparing with R's sample());
//   state(): the 624 words (for the validation).
export function rRandom(seed) {
  const mt = new Uint32Array(624);
  let s = (Number(seed) | 0) >>> 0;
  for (let j = 0; j < 50; j += 1) s = (Math.imul(69069, s) + 1) >>> 0;
  // The first value after the fifty is the position word (R's mti), not part of the state.
  s = (Math.imul(69069, s) + 1) >>> 0;
  for (let j = 0; j < 624; j += 1) {
    s = (Math.imul(69069, s) + 1) >>> 0;
    mt[j] = s;
  }
  let mti = 624;
  const next = () => {
    if (mti >= 624) {
      for (let k = 0; k < 624; k += 1) {
        const y = (mt[k] & 0x80000000) | (mt[(k + 1) % 624] & 0x7fffffff);
        mt[k] = mt[(k + 397) % 624] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
      }
      mti = 0;
    }
    let y = mt[mti];
    mti += 1;
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  };
  const I2_32M1 = 2.328306437080797e-10;
  const unif = () => {
    const v = next() * 2.3283064365386963e-10;
    if (v <= 0) return 0.5 * I2_32M1;
    if (1 - v <= 0) return 1 - 0.5 * I2_32M1;
    return v;
  };
  const index = (n) => {
    if (n <= 0) return 0;
    // The bits of the next power of two at or above n, counted exactly.
    let bits = 0;
    let span = 1;
    while (span < n) {
      span *= 2;
      bits += 1;
    }
    for (;;) {
      let v = 0;
      for (let k = 0; k <= bits; k += 16) v = v * 65536 + Math.floor(unif() * 65536);
      // The low `bits` bits (v < 2^53: exact in a double).
      const dv = v % span;
      if (dv < n) return dv;
    }
  };
  return { unif, index, state: () => Array.from(mt) };
}

// sample(x, length(x), replace = TRUE): each element drawn by index(n).
export function resample(x, random) {
  const n = x.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i += 1) out[i] = x[random.index(n)];
  return out;
}

// --- Order statistics ------------------------------------------------------------------------------

const sortedCopy = (x) => Float64Array.from(x).sort();

export function median(x) {
  const s = sortedCopy(x);
  const n = s.length;
  if (!n) return Number.NaN;
  const h = n >> 1;
  return n % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
}

// The median absolute deviation, scaled to a normal SD (constant 1.4826, as R's mad).
export function mad(x) {
  const m = median(x);
  return 1.4826 * median(Array.from(x, (v) => Math.abs(v - m)));
}

// The sample variance (two passes, the mean first).
export function variance(x) {
  const n = x.length;
  let sum = 0;
  for (const v of x) sum += v;
  const m = sum / n;
  let ss = 0;
  for (const v of x) ss += (v - m) * (v - m);
  return ss / (n - 1);
}

// Ranks, ties at their average.
function ranks(x) {
  const n = x.length;
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => x[a] - x[b]);
  const r = new Float64Array(n);
  for (let i = 0; i < n;) {
    let j = i;
    while (j + 1 < n && x[order[j + 1]] === x[order[i]]) j += 1;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) r[order[k]] = avg;
    i = j + 1;
  }
  return r;
}

// Spearman's ρ over the pairs where both are finite; 0 where it is not defined (as acmgscaler's
// wrapper makes R's cor's warnings and errors).
export function spearman(x, y) {
  const a = [];
  const b = [];
  for (let i = 0; i < x.length; i += 1) if (Number.isFinite(x[i]) && Number.isFinite(y[i])) { a.push(x[i]); b.push(y[i]); }
  if (a.length < 2) return 0;
  const ra = ranks(a);
  const rb = ranks(b);
  const n = ra.length;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i += 1) { ma += ra[i]; mb += rb[i]; }
  ma /= n;
  mb /= n;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i += 1) {
    sab += (ra[i] - ma) * (rb[i] - mb);
    saa += (ra[i] - ma) * (ra[i] - ma);
    sbb += (rb[i] - mb) * (rb[i] - mb);
  }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0;
}

// The smallest k with P(X ≤ k) ≥ p for X ~ Binomial(n, prob), the probabilities summed exactly
// enough in logs (n up to some thousands).
export function binomialQuantile(p, n, prob) {
  const lq = log(1 - prob);
  const lp = log(prob);
  let lgamma = 0;
  const lfact = new Float64Array(n + 1);
  for (let k = 1; k <= n; k += 1) {
    lgamma += log(k);
    lfact[k] = lgamma;
  }
  let cum = 0;
  for (let k = 0; k <= n; k += 1) {
    cum += exp(lfact[n] - lfact[k] - lfact[n - k] + k * lp + (n - k) * lq);
    if (cum >= p * (1 - 64 * Number.EPSILON)) return k;
  }
  return n;
}

// --- Grids and interpolation --------------------------------------------------------------------------

// n equally spaced values from `from` to `to`: from + i·by, the last `to` itself (as R's seq(from,
// to, length.out = n)).
export function linspace(from, to, n) {
  const out = new Float64Array(n);
  if (n === 1) {
    out[0] = from;
    return out;
  }
  const by = (to - from) / (n - 1);
  for (let i = 0; i < n - 1; i += 1) out[i] = from + i * by;
  out[n - 1] = to;
  return out;
}

// For each value, how many of the sorted breaks are at or below it (R's findInterval: 0 below the
// first, n at or above the last).
export function findInterval(values, breaks) {
  const out = new Int32Array(values.length);
  for (let k = 0; k < values.length; k += 1) {
    const v = values[k];
    let lo = 0;
    let hi = breaks.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (breaks[mid] <= v) lo = mid + 1;
      else hi = mid;
    }
    out[k] = lo;
  }
  return out;
}

// Linear interpolation of the points (x, y) at xout (R's approx): x sorted, tied x's y values
// replaced by their mean (ties = mean); outside the range NaN (rule 1) or the end's y (rule 2).
export function approx(x, y, xout, { rule = 1, ties = true } = {}) {
  let xs = [];
  let ys = [];
  const order = Array.from(x.keys()).filter((i) => !Number.isNaN(x[i]) && !Number.isNaN(y[i])).sort((a, b) => x[a] - x[b] || a - b);
  if (ties) {
    for (let i = 0; i < order.length;) {
      let j = i;
      let sum = 0;
      while (j < order.length && x[order[j]] === x[order[i]]) {
        sum += y[order[j]];
        j += 1;
      }
      xs.push(x[order[i]]);
      ys.push(sum / (j - i));
      i = j;
    }
  } else {
    xs = order.map((i) => x[i]);
    ys = order.map((i) => y[i]);
  }
  const n = xs.length;
  const out = new Float64Array(xout.length);
  for (let k = 0; k < xout.length; k += 1) {
    const v = xout[k];
    if (!n || Number.isNaN(v)) {
      out[k] = Number.NaN;
      continue;
    }
    if (v < xs[0] || v > xs[n - 1]) {
      out[k] = rule === 2 ? (v < xs[0] ? ys[0] : ys[n - 1]) : Number.NaN;
      continue;
    }
    // The interval [xs[i], xs[j]] holding v, by bisection.
    let i = 0;
    let j = n - 1;
    while (i < j - 1) {
      const mid = (i + j) >> 1;
      if (v < xs[mid]) j = mid;
      else i = mid;
    }
    if (v === xs[j]) out[k] = ys[j];
    else if (v === xs[i]) out[k] = ys[i];
    else out[k] = ys[i] + (ys[j] - ys[i]) * ((v - xs[i]) / (xs[j] - xs[i]));
  }
  return out;
}

// --- Isotonic regression ------------------------------------------------------------------------------

// The least-squares non-decreasing fit to y (R's isoreg's yf): the slopes of the greatest convex
// minorant of the cumulative sums (Barlow, Bartholomew, Bremner and Brunk 1972), each block's value
// its cumulative sums' difference over its length; a run of equal slopes kept as separate blocks.
export function isotonic(y) {
  const n = y.length;
  const yc = new Float64Array(n + 1);
  let t = 0;
  for (let i = 0; i < n; i += 1) {
    t += y[i];
    yc[i + 1] = t;
  }
  // The knots of the minorant, by a stack: a point is dropped when the slope to it from the knot
  // before is not below the slope from it onward.
  const knots = [0];
  for (let i = 1; i <= n; i += 1) {
    while (knots.length > 1) {
      const a = knots[knots.length - 2];
      const b = knots[knots.length - 1];
      if ((yc[b] - yc[a]) / (b - a) > (yc[i] - yc[b]) / (i - b)) knots.pop();
      else break;
    }
    knots.push(i);
  }
  const yf = new Float64Array(n);
  for (let k = 1; k < knots.length; k += 1) {
    const a = knots[k - 1];
    const b = knots[k];
    const v = (yc[b] - yc[a]) / (b - a);
    for (let i = a; i < b; i += 1) yf[i] = v;
  }
  return yf;
}

// --- Minimization ---------------------------------------------------------------------------------------

// Brent's minimizer of f on [a, b] (Brent 1973, Algorithms for Minimization without Derivatives,
// ch. 5; as Forsythe, Malcolm and Moler 1977 give it, fmin): golden-section steps and parabolic
// interpolation, the tolerance √ε |x| + tol/3. Returns the minimizing x (R's optimize's $minimum).
export function brentMinimize(f, a, b, tol) {
  const c = (3 - Math.sqrt(5)) * 0.5;
  const eps = Math.sqrt(Number.EPSILON);
  let v = a + c * (b - a);
  let w = v;
  let x = v;
  let d = 0;
  let e = 0;
  let fx = f(x);
  let fv = fx;
  let fw = fx;
  const tol3 = tol / 3;
  for (;;) {
    const xm = (a + b) * 0.5;
    const tol1 = eps * Math.abs(x) + tol3;
    const t2 = tol1 * 2;
    if (Math.abs(x - xm) <= t2 - (b - a) * 0.5) break;
    let p = 0;
    let q = 0;
    let r = 0;
    if (Math.abs(e) > tol1) {
      r = (x - w) * (fx - fv);
      q = (x - v) * (fx - fw);
      p = (x - v) * q - (x - w) * r;
      q = (q - r) * 2;
      if (q > 0) p = -p;
      else q = -q;
      r = e;
      e = d;
    }
    if (Math.abs(p) >= Math.abs(q * 0.5 * r) || p <= q * (a - x) || p >= q * (b - x)) {
      // A golden-section step.
      e = x < xm ? b - x : a - x;
      d = c * e;
    } else {
      // A parabolic step, not too near either end.
      d = p / q;
      const u = x + d;
      if (u - a < t2 || b - u < t2) {
        d = tol1;
        if (x >= xm) d = -d;
      }
    }
    let u;
    if (Math.abs(d) >= tol1) u = x + d;
    else if (d > 0) u = x + tol1;
    else u = x - tol1;
    const fu = f(u);
    if (fu <= fx) {
      if (u < x) b = x;
      else a = x;
      v = w; w = x; x = u;
      fv = fw; fw = fx; fx = fu;
    } else {
      if (u < x) a = u;
      else b = u;
      if (fu <= fw || w === x) {
        v = w; fv = fw;
        w = u; fw = fu;
      } else if (fu <= fv || v === x || v === w) {
        v = u; fv = fu;
      }
    }
  }
  return x;
}

// --- Kernel density ------------------------------------------------------------------------------------

const SQRT_PI = Math.sqrt(Math.PI);
const M_1_SQRT_2PI = 0.398942280401432677939946059934;

// The biased cross-validation bandwidth of a Gaussian kernel (Scott and Terrell, JASA
// 1987;82:1131–1146), its pairwise distances binned as R's bw.bcv(x, nb) bins them: each value
// placed in a bin of width 1.01 × its range / nb, the pairs counted by the difference of their bins
// (found by comparing with R); minimized by Brent's method between 0.1 and 1 times
// 1.144 √var(x) n^(−1/5), with the tolerance 0.1 times the lower end.
export function bandwidthBCV(x, nb = 1000) {
  const n = x.length;
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of x) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const dd = ((hi - lo) * 1.01) / nb;
  const cnt = new Float64Array(nb);
  const bin = Int32Array.from(x, (v) => Math.trunc(v / dd));
  for (let i = 1; i < n; i += 1) {
    for (let j = 0; j < i; j += 1) cnt[Math.abs(bin[i] - bin[j])] += 1;
  }
  const hmax = 1.144 * Math.sqrt(variance(x)) * pow(n, -1 / 5);
  const lower = 0.1 * hmax;
  const fbcv = (h) => {
    let sum = 0;
    for (let k = 0; k < nb; k += 1) {
      let delta = (k * dd) / h;
      delta *= delta;
      if (delta >= 1000) break;
      sum += (delta * delta - 12 * delta + 12) * exp(-delta / 4) * cnt[k];
    }
    return (1 + sum / (32 * n)) / (2 * n * h * SQRT_PI);
  };
  return brentMinimize(fbcv, lower, hmax, 0.1 * lower);
}

// e^{−2πik/n} for k = 0 … n/2 − 1 (n a power of two), the same in every engine: the angles 2π/2^j
// by half angles (cos θ/2 = √((1 + cos θ)/2), sin θ/2 = sin θ / (2 cos θ/2): square roots, exactly
// rounded), and each k's as the product of those of its binary digits, in a fixed order.
const twiddleTables = new Map();
function twiddles(n) {
  if (twiddleTables.has(n)) return twiddleTables.get(n);
  // base[j]: (cos, sin) of 2π/2^j, j = 1 … log2 n.
  const base = [null, [-1, 0], [0, 1]];
  let p = 2;
  while ((1 << p) < n) {
    const [c, s] = base[p];
    const half = Math.sqrt((1 + c) / 2);
    base.push([half, s / (2 * half)]);
    p += 1;
  }
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let k = 0; k < n / 2; k += 1) {
    let c = 1;
    let s = 0;
    // 2πk/n = Σ over k's set bits b of 2π/2^(p − b).
    for (let b = 0; b < p; b += 1) {
      if (!(k & (1 << b))) continue;
      const [bc, bs] = base[p - b];
      const nc = c * bc - s * bs;
      s = c * bs + s * bc;
      c = nc;
    }
    cos[k] = c;
    sin[k] = -s;
  }
  const table = { cos, sin };
  twiddleTables.set(n, table);
  return table;
}

// An in-place radix-2 complex FFT (Cooley and Tukey 1965) of length a power of two; inverse
// unnormalized, as R's fft(inverse = TRUE).
function fft(re, im, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  const table = twiddles(n);
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const step = n / len;
    for (let k = 0; k < half; k += 1) {
      const wr = table.cos[k * step];
      const wi = inverse ? -table.sin[k * step] : table.sin[k * step];
      for (let i = k; i < n; i += len) {
        const j = i + half;
        const tr = re[j] * wr - im[j] * wi;
        const ti = re[j] * wi + im[j] * wr;
        re[j] = re[i] - tr;
        im[j] = im[i] - ti;
        re[i] += tr;
        im[i] += ti;
      }
    }
  }
}

// The Gaussian kernel density estimate of x with bandwidth bw at nOut points from min(x) − 3 bw to
// max(x) + 3 bw, as R's density(x, n, bw) computes it (Silverman, Applied Statistics 1982;31:93–99,
// AS 176): the mass linearly binned (Jones and Lotwick 1984) on a grid of m points (nOut rounded
// up to a power of two, at least 512) widened by 4 bw each side, convolved with the kernel through
// the FFT on 2m points (the kernel wrapped), negative round-off set to 0, then interpolated linearly
// at the points asked for (the grid, padding and interpolation found by comparing with R). Returns
// { x, y }.
export function gaussianDensity(x, bw, nOut = 512) {
  const nx = x.length;
  let m = Math.max(nOut, 512);
  if (m > 512) {
    let p2 = 512;
    while (p2 < m) p2 *= 2;
    m = p2;
  }
  let xmin = Infinity;
  let xmax = -Infinity;
  for (const v of x) {
    if (v < xmin) xmin = v;
    if (v > xmax) xmax = v;
  }
  const from = xmin - 3 * bw;
  const to = xmax + 3 * bw;
  const lo = from - 4 * bw;
  const up = to + 4 * bw;
  // Linear binning on m points from lo to up, each value carrying 1/nx.
  const re = new Float64Array(2 * m);
  const im = new Float64Array(2 * m);
  const delta = (up - lo) / (m - 1);
  const w = 1 / nx;
  for (const v of x) {
    const pos = (v - lo) / delta;
    const ix = Math.floor(pos);
    const fx = pos - ix;
    if (ix >= 0 && ix <= m - 2) {
      re[ix] += w * (1 - fx);
      re[ix + 1] += w * fx;
    } else if (ix === -1) re[0] += w * fx;
    else if (ix === m - 1) re[ix] += w * (1 - fx);
  }
  // The kernel on 2m points: 0 to 2(up − lo), the second half mirrored to negative distances.
  const kre = new Float64Array(2 * m);
  const kim = new Float64Array(2 * m);
  for (let i = 0; i < 2 * m; i += 1) {
    const d = (i >= m + 1 ? i - 2 * m : i) * delta;
    const z = d / bw;
    kre[i] = (M_1_SQRT_2PI * exp(-0.5 * z * z)) / bw;
  }
  fft(re, im);
  fft(kre, kim);
  // y × conj(kernel), back.
  for (let i = 0; i < 2 * m; i += 1) {
    const a = re[i];
    const b = im[i];
    re[i] = a * kre[i] + b * kim[i];
    im[i] = b * kre[i] - a * kim[i];
  }
  fft(re, im, true);
  const dens = new Float64Array(m);
  for (let i = 0; i < m; i += 1) dens[i] = Math.max(0, re[i] / (2 * m));
  const xords = linspace(lo, up, m);
  const xs = linspace(from, to, nOut);
  return { x: xs, y: approx(xords, dens, xs) };
}
