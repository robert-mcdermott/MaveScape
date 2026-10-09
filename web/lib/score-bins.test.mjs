import assert from 'node:assert/strict';
import test from 'node:test';
import { binAverages, binMLE, binMLEScores, binTotals, scaleAnchors } from './score-bins.js';
import { combineMean } from './replicates.js';
import { createRandom } from './random.js';

const close = (a, b, tol = 1e-12) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≠ ${b}`);

test('the weighted average of bin values, by hand, and its analytic SE', () => {
  // Two variants in four bins; bin totals 100, 200, 200, 400.
  const bins = [Float64Array.of(10, 90), Float64Array.of(20, 180), Float64Array.of(40, 160), Float64Array.of(80, 320)];
  const values = [0.25, 0.5, 0.75, 1];
  assert.deepEqual(binTotals(bins), [100, 200, 200, 400]);
  const out = binAverages(bins, values, Uint8Array.of(1, 1), { pseudocount: 0 });
  // Variant 0: frequencies 0.1, 0.1, 0.2, 0.2 → W = (0.025 + 0.05 + 0.15 + 0.2) / 0.6.
  close(out.score[0], 0.425 / 0.6);
  close(out.frequency[0], 0.6);
  assert.equal(out.reads[0], 150);
  // Its SE with no pseudocount: Σ (w − W)² c / R² over S².
  const W = 0.425 / 0.6;
  const v = [[0.25, 10, 100], [0.5, 20, 200], [0.75, 40, 200], [1, 80, 400]].reduce((a, [w, c, r]) => a + ((w - W) ** 2 * c) / (r * r), 0);
  close(out.se[0], Math.sqrt(v) / 0.6);
  // All reads in one bin: the weighted average is that bin's value; with a pseudocount the SE is not 0.
  const one = binAverages([Float64Array.of(0), Float64Array.of(0), Float64Array.of(0), Float64Array.of(5)], values, Uint8Array.of(1), { totals: [100, 100, 100, 100] });
  assert.equal(one.score[0], 1);
  assert.ok(one.se[0] > 0);
  // No reads: no score.
  assert.ok(Number.isNaN(binAverages([Float64Array.of(0), Float64Array.of(0)], [0, 1], Uint8Array.of(1), { totals: [10, 10] }).score[0]));
});

test('the bootstrap is seeded and close to the analytic SE', () => {
  const bins = [Float64Array.of(300), Float64Array.of(500), Float64Array.of(900), Float64Array.of(400)];
  const values = [0.25, 0.5, 0.75, 1];
  const totals = [1e5, 1e5, 1e5, 1e5];
  const analytic = binAverages(bins, values, Uint8Array.of(1), { totals });
  const a = binAverages(bins, values, Uint8Array.of(1), { totals, se: 'bootstrap', samples: 2000, random: createRandom(3) });
  const b = binAverages(bins, values, Uint8Array.of(1), { totals, se: 'bootstrap', samples: 2000, random: createRandom(3) });
  assert.equal(a.se[0], b.se[0]);
  assert.ok(Math.abs(a.se[0] / analytic.se[0] - 1) < 0.06, `${a.se[0]} against ${analytic.se[0]}`);
  assert.throws(() => binAverages(bins, values, Uint8Array.of(1), { totals, se: 'bootstrap' }), /seeded/);
});

test('scales: nonsense median 0 and wild type 1, or the lowest 5% median 0', () => {
  const score = Float64Array.of(0.9, 0.3, 0.35, 0.4, 0.8, 0.7);
  const use = Uint8Array.of(1, 1, 1, 1, 1, 1);
  assert.deepEqual(scaleAnchors('nonsense-wt', score, use, { wt: 0, nonsense: [1, 2, 3] }), { zero: 0.35, one: 0.9 });
  // Six scores: the lowest ceil(5%) = 1 of them, 0.3.
  assert.deepEqual(scaleAnchors('low5-wt', score, use, { wt: 0 }), { zero: 0.3, one: 0.9 });
  assert.equal(scaleAnchors('none', score, use, {}), null);
  assert.throws(() => scaleAnchors('nonsense-wt', score, use, { wt: 0, nonsense: [] }), /nonsense/);
  assert.throws(() => scaleAnchors('nonsense-wt', score, use, { wt: -1, nonsense: [1] }), /wild type/);
});

test('maximum likelihood: symmetric counts about a gate put μ on it; what cannot be estimated says why', () => {
  const lo = [-Infinity, Math.log(100), Math.log(200), Math.log(400)];
  const hi = [Math.log(100), Math.log(200), Math.log(400), Infinity];
  // Equal counts in the two middle bins (equally wide in log), none outside: with σ fixed, μ is the
  // gate between them.
  const fixed = binMLE([0, 50, 50, 0], lo, hi, 0.3);
  assert.ok(fixed.estimable);
  close(fixed.mu, Math.log(200), 1e-8);
  // A log-normal's expected counts are fitted back to its parameters.
  const mu = Math.log(180);
  const sigma = 0.45;
  const expected = [];
  const phi = (z) => 0.5 * erfcApprox(-z / Math.SQRT2);
  for (let b = 0; b < 4; b += 1) expected.push(1e6 * (phi((hi[b] - mu) / sigma) - phi((lo[b] - mu) / sigma)));
  const free = binMLE(expected, lo, hi, null);
  close(free.mu, mu, 1e-6);
  close(free.sigma, sigma, 1e-6);
  assert.equal(binMLE([10, 0, 0, 0], lo, hi, 0.3).reason, 'all reads in an open outer bin');
  assert.match(binMLE([0, 10, 5, 0], lo, hi, null).reason, /three bins/);
  assert.equal(binMLE([0, 0, 0, 0], lo, hi, 0.3).reason, 'no reads');
});

// erfc for the test's expected counts, independently of dmath: a series below 1, a continued
// fraction (evaluated bottom-up) above.
function erfcApprox(x) {
  if (x < 0) return 2 - erfcApprox(-x);
  if (x < 1) {
    let term = x;
    let sum = x;
    for (let n = 1; n < 60; n += 1) {
      term *= (-x * x) / n;
      sum += term / (2 * n + 1);
    }
    return 1 - (2 / Math.sqrt(Math.PI)) * sum;
  }
  let f = 0;
  for (let k = 400; k >= 1; k -= 1) f = (k / 2) / (x + f);
  return Math.exp(-x * x) / Math.sqrt(Math.PI) / (x + f);
}

test('maximum-likelihood scores of a replicate: reads reweighted by the cells sorted, limited by the scarcer', () => {
  const lower = [null, 100, 200, 400];
  const upper = [100, 200, 400, null];
  const bins = [Float64Array.of(10, 0), Float64Array.of(30, 0), Float64Array.of(40, 0), Float64Array.of(20, 7)];
  const equal = binMLEScores(bins, lower, upper, null, Uint8Array.of(1, 1), { sigma: 0.4, totals: [1000, 1000, 1000, 1000] });
  assert.ok(Number.isFinite(equal.score[0]));
  assert.equal(equal.reason[1], 'all reads in an open outer bin');
  // Twice the cells in the top bin moves μ up, and fewer cells than reads widens the SE.
  const cells = binMLEScores(bins, lower, upper, [20, 20, 20, 40], Uint8Array.of(1, 0), { sigma: 0.4, totals: [1000, 1000, 1000, 1000] });
  assert.ok(cells.score[0] > equal.score[0]);
  assert.ok(cells.se[0] > equal.se[0]);
});

test('the mean of replicates, with SE = SD/√k', () => {
  const c = combineMean([1, 2, 6], [0.1, 0.1, 0.1]);
  close(c.estimate, 3);
  close(c.se, Math.sqrt(((1 - 3) ** 2 + (2 - 3) ** 2 + (6 - 3) ** 2) / 2 / 3));
  close(combineMean([4], [0.25]).se, 0.5);
});
