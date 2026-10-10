import assert from 'node:assert/strict';
import test from 'node:test';
import { adaptiveSpan, contrastFit, lmFit, lowess, moderatedT, squeezeVariances } from './limma.js';

const close = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≠ ${b}`);

test('lowess as R gives it: the local fits, the robustness rounds, and interpolation within delta', () => {
  const x = Float64Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  const y = Float64Array.from([2, 4, 3, 7, 5, 9, 8, 30, 10, 13, 11, 15]);
  // R 4.6.1: lowess(x, y, f = 0.5, iter = 0 / 3) and with delta = 2.5.
  const r0 = [2.16764733159194, 3.26502099535638, 4.38198182428194, 5.36163260542938, 6.63836739457062, 9.61909763248873, 13.7968141438011, 15.4297550800111, 15.7968141438011, 13.6190976324887, 12.997237735011, 12.9155947550288];
  const r3 = [2.17367713639677, 3.26813308446252, 4.38178603401815, 5.36393915754048, 6.63522634056471, 7.5641196334263, 8.48505457681579, 9.54109590744788, 10.4901411743993, 11.5824197918202, 12.9263223337352, 14.2238256683354];
  const rd = [2.17203839618554, 3.28031518851807, 4.3885919808506, 5.51500730426433, 6.64142262767805, 7.56284093394328, 8.48425924020851, 9.489107441971, 10.4939556437335, 11.7138620416192, 12.933768439505, 14.2307716604989];
  lowess(x, y, { f: 0.5, iterations: 0 }).forEach((v, i) => close(v, r0[i], 1e-13));
  lowess(x, y, { f: 0.5, iterations: 3 }).forEach((v, i) => close(v, r3[i], 1e-13));
  lowess(x, y, { f: 0.5, iterations: 3, delta: 2.5 }).forEach((v, i) => close(v, rd[i], 1e-13));
  // limma's chooseLowessSpan.
  [[10, 1], [51, 0.9953946], [400, 0.65], [12345, 0.4115812]].forEach(([n, s]) => close(adaptiveSpan(n), s, 1e-7));
});

test('weighted least squares per row, a contrast, and the moderated t', () => {
  // Two groups of three; row 2 noisier. y = group means + residuals.
  const X = Float64Array.from([1, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1]);
  const E = Float64Array.from([1, 1.2, 0.8, 2, 2.1, 1.9, 5, 6, 4, 3, 2, 4]);
  const fit = lmFit(E, X, null, 2, 6, 2);
  close(fit.coefficients[0], 1, 1e-15);
  close(fit.coefficients[1], 2, 1e-15);
  close(fit.sigma[0], Math.sqrt((0.04 + 0.04 + 0.01 + 0.01) / 4), 1e-15);
  close(fit.stdevUnscaled[0], Math.sqrt(1 / 3), 1e-15);
  const c = contrastFit(fit, [-1, 1]);
  close(c.coefficient[0], 1, 1e-15);
  close(c.stdevUnscaled[0], Math.sqrt(2 / 3), 1e-15);
  // The prior from the two rows' ln s² (Smyth 2004): each variance shrunk toward s₀² by d₀.
  const prior = squeezeVariances(fit.sigma, fit.df);
  const m = moderatedT(fit, c);
  assert.equal(m.dfTotal[0], Math.min(4 + prior.dfPrior, 8), 'd + d₀, at most the pooled residual df');
  const s2 = fit.sigma[1] * fit.sigma[1];
  close(m.s2Post[1], (prior.dfPrior * prior.s2Prior + 4 * s2) / (prior.dfPrior + 4), 1e-15);
  close(m.se[0], Math.sqrt(m.s2Post[0]) * Math.sqrt(2 / 3), 1e-15);
  close(m.t[0], 1 / m.se[0], 1e-15);
});
