// Distribution functions for differential scores (wave 2, slice 6): ln Γ, digamma and trigamma,
// the regularized incomplete beta function, Student's t (distribution, upper tail, quantile), the
// normal quantile, and Benjamini–Hochberg adjustment. Written from the published formulas (cited
// at each), in plain arithmetic and dmath.js's log and exp, so that every engine gives the same
// bits; accurate to about 1e-14 relative in the body of each distribution, with tail probabilities
// computed directly (not as 1 − F) so that small p-values keep their relative precision.

import { exp, log, normalUpper } from './dmath.js';

const LN_SQRT_2PI = 0.9189385332046728; // ln √(2π)
const LN_PI = 1.1447298858494002;

// ln Γ(x) for x > 0: Lanczos's approximation (g = 7, nine coefficients; Lanczos 1964, as Press et
// al., Numerical Recipes 3rd ed. §6.1 tabulate it), Γ(x + 1) = x Γ(x) below ½.
const LANCZOS = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
export function logGamma(x) {
  if (!(x > 0)) return x === 0 ? Infinity : Number.NaN;
  if (x === 1 || x === 2) return 0;
  if (x === 0.5) return 0.5723649429247001; // ln √π
  if (x < 0.5) return logGamma(x + 1) - log(x);
  const z = x - 1;
  let a = LANCZOS[0];
  const t = z + 7.5;
  for (let i = 1; i < 9; i += 1) a += LANCZOS[i] / (z + i);
  return LN_SQRT_2PI + (z + 0.5) * log(t) - t + log(a);
}

// ln(1 + u), accurate for small u from an accurate log (Goldberg 1991, "What every computer
// scientist should know about floating-point arithmetic", theorem 4).
export function log1p(u) {
  const w = 1 + u;
  return w === 1 ? u : (log(w) * u) / (w - 1);
}

// Stirling's correction δ(x) in ln Γ(x) = (x − ½) ln x − x + ½ ln 2π + δ(x), for x ≥ 10: its
// series Σ B₂ₖ / (2k (2k − 1) x²ᵏ⁻¹) (Abramowitz and Stegun 6.1.40), to the 7th term.
function stirling(x) {
  const r = 1 / (x * x);
  return (1 / 12 - r * (1 / 360 - r * (1 / 1260 - r * (1 / 1680 - r * (1 / 1188 - r * (691 / 360360 - r / 156)))))) / x;
}

// ln Γ(a) − ln Γ(a + b) without the cancellation of two large logarithms when a is large:
// −(a − ½) ln(1 + b/a) − b ln(a + b) + b + δ(a) − δ(a + b).
export function logGammaDifference(a, b) {
  if (a < 10) return logGamma(a) - logGamma(a + b);
  return -(a - 0.5) * log1p(b / a) - b * log(a + b) + b + stirling(a) - stirling(a + b);
}

// ln B(a, b) = ln Γ(a) + ln Γ(b) − ln Γ(a + b), the larger argument's two terms taken together.
export function logBeta(a, b) {
  return a >= b ? logGamma(b) + logGammaDifference(a, b) : logGamma(a) + logGammaDifference(b, a);
}

// ψ(x), the digamma function, for x > 0: the recurrence ψ(x) = ψ(x + 1) − 1/x up to x ≥ 10, then
// its asymptotic series ln x − 1/(2x) − Σ B₂ₖ/(2k x²ᵏ) (Abramowitz and Stegun 6.3.5, 6.3.18).
export function digamma(x) {
  if (!(x > 0)) return Number.NaN;
  let shift = 0;
  while (x < 10) {
    shift -= 1 / x;
    x += 1;
  }
  const r = 1 / (x * x);
  const series = r * (1 / 12 - r * (1 / 120 - r * (1 / 252 - r * (1 / 240 - r * (1 / 132 - r * (691 / 32760 - r / 12))))));
  return shift + log(x) - 0.5 / x - series;
}

// ψ′(x), the trigamma function, for x > 0: ψ′(x) = ψ′(x + 1) + 1/x² up to x ≥ 10, then
// 1/x + 1/(2x²) + Σ B₂ₖ/x²ᵏ⁺¹ (Abramowitz and Stegun 6.4.6, 6.4.12).
export function trigamma(x) {
  if (!(x > 0)) return Number.NaN;
  let shift = 0;
  while (x < 10) {
    shift += 1 / (x * x);
    x += 1;
  }
  const r = 1 / (x * x);
  const series = r * (1 / 6 - r * (1 / 30 - r * (1 / 42 - r * (1 / 30 - r * (5 / 66 - r * (691 / 2730 - r * 7 / 6))))));
  return shift + 1 / x + 0.5 * r + series / x;
}

// y with ψ′(y) = x, by Newton's method on 1/ψ′(y), which is nearly linear in y, from y = ½ + 1/x
// (Smyth 2004, appendix), to convergence.
export function trigammaInverse(x) {
  if (Number.isNaN(x) || x < 0) return Number.NaN;
  if (x === 0) return Infinity;
  if (x > 1e7) return 1 / Math.sqrt(x);
  if (x < 1e-6) return 1 / x;
  let y = 0.5 + 1 / x;
  for (let i = 0; i < 100; i += 1) {
    const tri = trigamma(y);
    // d/dy (1/ψ′(y)) = −ψ″(y)/ψ′(y)²; ψ″ by the difference of ψ′ is avoided: ψ″(y) from its series.
    const step = (tri * (1 - tri / x)) / tetragamma(y);
    y += step;
    if (Math.abs(step) <= 1e-15 * y) break;
  }
  return y;
}

// ψ″(x), for Newton's step above: ψ″(x) = ψ″(x + 1) − 2/x³ up to x ≥ 10, then
// −1/x² − 1/x³ − Σ (2k + 1) B₂ₖ / x²ᵏ⁺² (Abramowitz and Stegun 6.4.12 differentiated).
export function tetragamma(x) {
  if (!(x > 0)) return Number.NaN;
  let shift = 0;
  while (x < 10) {
    shift -= 2 / (x * x * x);
    x += 1;
  }
  const r = 1 / (x * x);
  const series = r * (3 / 6 - r * (5 / 30 - r * (7 / 42 - r * (9 / 30 - r * (11 * 5 / 66 - r * (13 * 691 / 2730 - r * 15 * 7 / 6))))));
  return shift - r - r / x - series * r;
}

// The regularized incomplete beta function I_x(a, b), given x and y = 1 − x (each exact, so that
// neither comes from a cancelling subtraction, and optionally their logarithms): x^a y^b /
// (a B(a, b)) times its continued fraction (Abramowitz and Stegun 26.5.8), by Lentz's method,
// where it converges fast (x below (a + 1)/(a + b + 2)); above, 1 − I_y(b, a).
export function incompleteBeta(x, y, a, b, logX = log(x), logY = log(y)) {
  if (x <= 0) return 0;
  if (y <= 0) return 1;
  const front = exp(a * logX + b * logY - logBeta(a, b));
  if (x < (a + 1) / (a + b + 2)) return (front * betaFraction(x, a, b)) / a;
  return 1 - (front * betaFraction(y, b, a)) / b;
}
function betaFraction(x, a, b) {
  const tiny = 1e-300;
  const clamp = (v) => (Math.abs(v) < tiny ? tiny : v);
  let c = 1;
  let d = 1 / clamp(1 - ((a + b) * x) / (a + 1));
  let h = d;
  for (let m = 1; m <= 10000; m += 1) {
    const m2 = 2 * m;
    const even = (m * (b - m) * x) / ((a - 1 + m2) * (a + m2));
    d = 1 / clamp(1 + even * d);
    c = clamp(1 + even / c);
    h *= d * c;
    const odd = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + 1 + m2));
    d = 1 / clamp(1 + odd * d);
    c = clamp(1 + odd / c);
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-16) break;
  }
  return h;
}

// Student's t with df degrees of freedom (df > 0, not necessarily whole): the probability of a
// value above t, P(T > t) = ½ I_{df/(df + t²)}(df/2, ½) for t ≥ 0.
export function tUpper(t, df) {
  if (Number.isNaN(t) || !(df > 0)) return Number.NaN;
  if (df === Infinity) return normalUpper(t);
  if (t < 0) return 1 - tUpper(-t, df);
  const t2 = t * t;
  const u = t2 / df;
  // ln x = −ln(1 + t²/df) and ln y = ln(t²/df) − ln(1 + t²/df), each without rounding x near 1.
  const l = log1p(u);
  return 0.5 * incompleteBeta(df / (df + t2), t2 / (df + t2), df / 2, 0.5, -l, t2 > 0 ? log(u) - l : -Infinity);
}
// P(T ≤ t).
export const tCdf = (t, df) => tUpper(-t, df);
// Two-sided p-value of t: P(|T| ≥ |t|).
export const tTwoSided = (t, df) => 2 * tUpper(Math.abs(t), df);

// ln of Student's t density at t.
function tLogDensity(t, df) {
  return -logGammaDifference(df / 2, 0.5) - 0.5 * (log(df) + LN_PI) - ((df + 1) / 2) * log1p((t * t) / df);
}

// The normal quantile Φ⁻¹(p): Wichura's algorithm AS 241 (PPND16; Applied Statistics 37, 1988),
// accurate to about 1e-16.
export function normalQuantile(p) {
  if (Number.isNaN(p) || p < 0 || p > 1) return Number.NaN;
  if (p === 0) return -Infinity;
  if (p === 1) return Infinity;
  const q = p - 0.5;
  if (Math.abs(q) <= 0.425) {
    const r = 0.180625 - q * q;
    return (q * (((((((2509.0809287301226727 * r + 33430.575583588128105) * r + 67265.770927008700853) * r + 45921.953931549871457) * r + 13731.693765509461125) * r + 1971.5909503065514427) * r + 133.14166789178437745) * r + 3.387132872796366608))
      / (((((((5226.495278852545925 * r + 28729.085735721942674) * r + 39307.89580009271061) * r + 21213.794301586595867) * r + 5394.1960214247511077) * r + 687.1870074920579083) * r + 42.313330701600911252) * r + 1);
  }
  let r = q < 0 ? p : 1 - p;
  r = Math.sqrt(-log(r));
  let value;
  if (r <= 5) {
    r -= 1.6;
    value = (((((((7.7454501427834140764e-4 * r + 0.0227238449892691845833) * r + 0.24178072517745061177) * r + 1.27045825245236838258) * r + 3.64784832476320460504) * r + 5.7694972214606914055) * r + 4.6303378461565452959) * r + 1.42343711074968357734)
      / (((((((1.05075007164441684324e-9 * r + 5.475938084995344946e-4) * r + 0.0151986665636164571966) * r + 0.14810397642748007459) * r + 0.68976733498510000455) * r + 1.6763848301838038494) * r + 2.05319162663775882187) * r + 1);
  } else {
    r -= 5;
    value = (((((((2.01033439929228813265e-7 * r + 2.71155556874348757815e-5) * r + 0.0012426609473880784386) * r + 0.026532189526576123093) * r + 0.29656057182850489123) * r + 1.7848265399172913358) * r + 5.4637849111641143699) * r + 6.6579046435011037772)
      / (((((((2.04426310338993978564e-15 * r + 1.4215117583164458887e-7) * r + 1.8463183175100546818e-5) * r + 7.868691311456132591e-4) * r + 0.0148753612908506148525) * r + 0.13692988092273580531) * r + 0.59983220655588793769) * r + 1);
  }
  return q < 0 ? -value : value;
}

// Student's t quantile: t with P(T ≤ t) = p, by Newton's method on the distribution from the
// normal quantile (Halley's correction keeps the steps short in the tails).
export function tQuantile(p, df) {
  if (Number.isNaN(p) || p < 0 || p > 1 || !(df > 0)) return Number.NaN;
  if (p === 0.5) return 0;
  if (df === Infinity) return normalQuantile(p);
  if (p < 0.5) return -tQuantile(1 - p, df);
  // P(T > t) = 1 − p: solve in the upper tail, where it is computed directly.
  const target = 1 - p;
  let t = normalQuantile(p);
  if (df < 3) t = Math.max(t, 1);
  for (let i = 0; i < 200; i += 1) {
    const f = tUpper(t, df) - target;
    const density = exp(tLogDensity(t, df));
    // d/dt P(T > t) = −density; Halley: the density's derivative is −density · (df + 1) t / (df + t²).
    const newton = f / density;
    const halley = newton / (1 - (0.5 * newton * (df + 1) * t) / (df + t * t));
    const step = Number.isFinite(halley) ? halley : newton;
    t += step;
    if (Math.abs(step) <= 1e-14 * Math.max(1, Math.abs(t))) break;
  }
  return t;
}

// Benjamini and Hochberg's adjusted p-values (J R Stat Soc B 1995), as R's p.adjust(method =
// "BH"): pᵢ n/rank, made monotone from the largest, at most 1. NaN p-values are left out and stay
// NaN.
export function adjustBH(p) {
  const out = new Float64Array(p.length).fill(Number.NaN);
  const idx = [];
  for (let i = 0; i < p.length; i += 1) if (!Number.isNaN(p[i])) idx.push(i);
  const n = idx.length;
  idx.sort((a, b) => p[b] - p[a] || b - a);
  let min = 1;
  for (let k = 0; k < n; k += 1) {
    const i = idx[k];
    const rank = n - k;
    min = Math.min(min, (p[i] * n) / rank);
    out[i] = min;
  }
  return out;
}
