import assert from 'node:assert/strict';
import test from 'node:test';
import { combine, combineEnrich2, combineFixed, combineREML, heterogeneity, leaveOneOut, poolColumns } from './replicates.js';

const close = (a, b, tol = 1e-12) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≠ ${b}`);

test('technical replicates are summed; missing in one is missing in the sum', () => {
  const sum = poolColumns([Float64Array.of(1, 2, Number.NaN), Float64Array.of(3, 0, 4)]);
  assert.deepEqual([...sum].slice(0, 2), [4, 2]);
  assert.ok(Number.isNaN(sum[2]));
  const one = Float64Array.of(5);
  assert.equal(poolColumns([one]), one);
});

test('fixed effects: the inverse-variance mean; an exact score takes all the weight', () => {
  const f = combineFixed([1, 3], [1, 3]);
  close(f.estimate, (1 / 1 + 3 / 3) / (1 + 1 / 3));
  close(f.se, Math.sqrt(1 / (1 + 1 / 3)));
  assert.deepEqual(combineFixed([0, 0.4], [0, 0.1]), { estimate: 0, se: 0, tau2: 0 });
});

test('REML: one replicate passes through; agreeing replicates have τ² = 0 (fixed effects)', () => {
  assert.deepEqual(combineREML([0.7], [0.04]), { estimate: 0.7, se: 0.2, tau2: Number.NaN, iterations: 0, converged: true });
  const r = combineREML([0.10, 0.11, 0.09, 0.10], [0.5, 0.4, 0.6, 0.5]);
  assert.equal(r.tau2, 0);
  close(r.estimate, combineFixed([0.10, 0.11, 0.09, 0.10], [0.5, 0.4, 0.6, 0.5]).estimate);
});

test('REML: heterogeneous replicates, the REML condition holds at the estimate', () => {
  const y = [-3.1, -0.2, 1.4, -1.9, 0.8, -2.6];
  const v = [0.02, 0.03, 0.01, 0.05, 0.02, 0.04];
  const r = combineREML(y, v);
  assert.ok(r.converged && r.tau2 > 1);
  // Σw²(y − β)² = Σw − Σw²/Σw (Enrich2's fixed point; metafor agrees, validation suite `scoring`).
  const w = v.map((x) => 1 / (x + r.tau2));
  const sw = w.reduce((a, b) => a + b, 0);
  const sw2 = w.reduce((a, b) => a + b * b, 0);
  close(w.reduce((a, wi, j) => a + wi * wi * (y[j] - r.estimate) ** 2, 0), sw - sw2 / sw, 1e-9);
  const h = heterogeneity(y, v);
  assert.equal(h.df, 5);
  assert.ok(h.i2 > 0.9 && h.i2 < 1);
});

test('Enrich2\'s estimator: its start depends on the number of variants; converged, it is REML', () => {
  // Just above τ² = 0, where its multiplicative update creeps: 50 iterations are not enough.
  const y = [0.1, 0.3, 0.25];
  const v = [0.01, 0.01, 0.01];
  const few = combineEnrich2(y, v, 3);
  const many = combineEnrich2(y, v, 1e6);
  assert.ok(few.epsilon > 0 && many.epsilon > 0, 'not converged after 50 iterations');
  assert.ok(Math.abs(few.se - many.se) > 1e-3, 'a different start, a different SE');
  const long = combineEnrich2(y, v, 3, 100000);
  const reml = combineREML(y, v);
  close(long.tau2, reml.tau2, 1e-9);
  close(long.se, reml.se, 1e-9);
  assert.equal(combine('enrich2', [1], [0.25], 10).se, 0.5);
});

test('leave-one-out: the largest shift and the replicate that causes it', () => {
  const l = leaveOneOut('fixed', [0, 0, 3], [1, 1, 1], 1);
  assert.equal(l.which, 2);
  close(l.shift, 1);
  assert.equal(leaveOneOut('reml', [1], [1], 1).which, -1);
});
