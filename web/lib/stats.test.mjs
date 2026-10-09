import assert from 'node:assert/strict';
import test from 'node:test';
import { auc, mad, mean, median, nonNegativeLine, pearson, quantile, ranks, spearman, variance } from './stats.js';

const close = (a, b, tol = 1e-12) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≠ ${b}`);

test('moments and order statistics (R type 7 quantiles)', () => {
  assert.equal(mean([1, 2, 3, 4]), 2.5);
  close(variance([1, 2, 3, 4]), 5 / 3);
  assert.equal(quantile([1, 2, 3, 4], 0.25), 1.75);
  assert.equal(median([5, 1, 3]), 3);
  close(mad([1, 2, 3, 4, 100]), 1.482602218505602);
  assert.ok(Number.isNaN(variance([1])) && Number.isNaN(median([])));
});

test('ranks with ties, Spearman and Pearson', () => {
  assert.deepEqual([...ranks([10, 20, 20, 5])], [2, 3.5, 3.5, 1]);
  close(pearson([1, 2, 3, 4], [2, 4, 6, 8]), 1);
  close(spearman([1, 2, 3, 4], [1, 4, 9, 100]), 1);
  close(pearson([1, 2, 3], [3, 2, 1]), -1);
  assert.ok(Number.isNaN(pearson([1, 1, 1], [1, 2, 3])), 'no variance: undefined, not 0');
});

test('AUC: the chance one sample outscores the other, ties halved', () => {
  assert.equal(auc([3, 4], [1, 2]), 1);
  assert.equal(auc([1, 2], [3, 4]), 0);
  assert.equal(auc([1], [1]), 0.5);
  assert.equal(auc([0], [-1, 1]), 0.5);
});

test('a line with non-negative coefficients', () => {
  const f = nonNegativeLine([1, 2, 3], [3, 5, 7], [1, 1, 1]);
  close(f.a, 2);
  close(f.e, 1);
  const g = nonNegativeLine([1, 2, 3], [1, 3, 5], [1, 1, 1]);
  assert.equal(g.e, 0, 'a negative intercept is refitted through 0');
  assert.ok(g.a > 0);
});
