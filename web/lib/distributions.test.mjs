import assert from 'node:assert/strict';
import test from 'node:test';
import { adjustBH, digamma, logGamma, normalQuantile, tQuantile, trigamma, trigammaInverse, tTwoSided, tUpper } from './distributions.js';

// Reference values from R 4.6.1 (lgamma, digamma, trigamma, pt, qt, qnorm, p.adjust) and limma
// 3.68.5 (trigammaInverse).
const close = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol * Math.abs(b), `${a} ≠ ${b} (${Math.abs(a - b) / Math.abs(b)})`);

test('ln Γ, digamma and trigamma, and trigamma\'s inverse, as R and limma give them', () => {
  const x = [0.1, 0.5, 1.3, 2.5, 7, 12.25, 150, 40000];
  const lg = [2.25271265173421, 0.5723649429247, -0.10817480950786, 0.284682870472919, 6.5792512120101, 18.1156695057109, 600.009470555327, 383861.009947093];
  const dg = [-10.4237549404111, -1.96351002602142, -0.169190888866799, 0.703156640645243, 1.87278433509847, 2.46415465518537, 5.00729825707568, 10.596622233044];
  const tg = [101.433299150793, 4.93480220054468, 1.13425343499662, 0.490357756100235, 0.153545177959338, 0.0850551429881632, 0.006688938271166, 2.50003125026042e-05];
  x.forEach((v, i) => {
    close(logGamma(v), lg[i], 1e-13);
    close(digamma(v), dg[i], 1e-13);
    close(trigamma(v), tg[i], 1e-13);
  });
  [0.01, 0.3, 1, 5, 40, 2e3].forEach((v, i) => close(trigammaInverse(v), [100.499166681943, 3.80871901205117, 1.42625512021508, 0.496168734704107, 0.160805597503035, 0.0223695887536716][i], 1e-13));
});

test('Student\'s t: tails to 10⁻¹³⁸ for whole and fractional degrees of freedom, and quantiles', () => {
  const df = [1, 2.5, 4, 7.3, 30, 512.7, 100000];
  df.forEach((d, j) => {
    close(tUpper(4.2, d), [0.0744027652986172, 0.0174821543628407, 0.00684790515254823, 0.00183752850082445, 0.00010989421710801, 1.57386093118019e-05, 1.33572890148399e-05][j], 1e-12);
    close(tUpper(25, d), [0.0127256113479918, 0.000229296927370304, 7.59876288165787e-06, 1.2138286245851e-08, 6.04591119064349e-22, 4.32410969369871e-91, 8.1088827760358e-138][j], 1e-12);
    close(tQuantile(0.975, d), [12.7062047361747, 3.57465484200369, 2.77644510519779, 2.3450667365477, 2.04227245630124, 1.96460175737272, 1.95998770753461][j], 1e-12);
    close(tQuantile(0.9999999, d), [3183098.86351324, 553.059983164766, 73.9857580575105, 18.6512201268584, 6.70139951237931, 5.2712592034169, 5.19970198846292][j], 1e-11);
  });
  assert.equal(tUpper(0, 3), 0.5);
  close(tTwoSided(-4.2, 4), 2 * 0.00684790515254823, 1e-13);
  [1e-300, 1e-10, 0.01, 0.3, 0.8, 0.999].forEach((p, i) => close(normalQuantile(p), [-37.0470962993612, -6.36134090240406, -2.32634787404084, -0.524400512708041, 0.841621233572914, 3.09023230616781][i], 1e-14));
});

test('Benjamini–Hochberg as R\'s p.adjust, missing p-values left out', () => {
  const q = adjustBH([0.01, 0.04, 0.03, 0.5, NaN, 0.001, 0.04]);
  [0.03, 0.048, 0.048, 0.5, NaN, 0.006, 0.048].forEach((v, i) => (Number.isNaN(v) ? assert.ok(Number.isNaN(q[i])) : close(q[i], v, 1e-15)));
});
