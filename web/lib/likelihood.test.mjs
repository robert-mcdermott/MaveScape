import assert from 'node:assert/strict';
import test from 'node:test';
import { approx, binomialQuantile, brentMinimize, findInterval, isotonic, linspace, mad, rRandom, spearman } from './rcompat.js';
import { calibrateScores, evidenceOf, findPvst, likelihoodSettings, thresholdsFromPvst } from './likelihood.js';

const close = (a, b, eps = 1e-12) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));

test('R\'s generator, by hand: set.seed(42)\'s first uniform and draws as R gives them (R 4.6.1)', () => {
  const r = rRandom(42);
  // runif(3) after set.seed(42).
  assert.deepEqual([r.unif(), r.unif(), r.unif()].map((v) => v.toFixed(12)), ['0.914806043496', '0.937075413298', '0.286139534786']);
  // sample.int(10, 5, replace = TRUE) after set.seed(42).
  const s = rRandom(42);
  assert.deepEqual(Array.from({ length: 5 }, () => s.index(10) + 1), [1, 5, 1, 9, 10]);
});

test('the small numerics: isotonic regression, interpolation with ties, the binomial quantile, findInterval, Brent', () => {
  // Pool adjacent violators: (1, 3, 2) pools the last two.
  assert.deepEqual(Array.from(isotonic([1, 3, 2])), [1, 2.5, 2.5]);
  assert.deepEqual(Array.from(isotonic([3, 2, 1])), [2, 2, 2]);
  // Tied x's y values averaged; outside the range NaN (rule 1) or the end (rule 2).
  assert.deepEqual(Array.from(approx([0, 1, 1, 2], [0, 2, 4, 6], [0.5, 1, 3])).map((v) => (Number.isNaN(v) ? null : v)), [1.5, 3, null]);
  assert.deepEqual(Array.from(approx([0, 2], [10, 20], [-1, 3], { rule: 2 })), [10, 20]);
  assert.equal(binomialQuantile(0.025, 1000, 0.5), 469);
  assert.equal(binomialQuantile(0.5, 2, 0.5), 1);
  assert.deepEqual(Array.from(findInterval([-1, 0, 0.5, 1, 2], [0, 0.5, 1])), [0, 1, 2, 3, 3]);
  assert.ok(close(brentMinimize((x) => (x - 2) ** 2, 0, 5, 1e-8), 2, 1e-6));
  const g = linspace(0, 1, 5);
  assert.deepEqual(Array.from(g), [0, 0.25, 0.5, 0.75, 1]);
  assert.ok(close(mad([1, 2, 3, 4, 100]), 1.4826));
  assert.ok(close(spearman([1, 2, 3, 4], [10, 20, 30, 1]), -0.2));
});

test('Tavtigian et al.\'s c from a prior, as acmgscaler finds it; its thresholds; Pejaver et al.\'s table', () => {
  assert.equal(findPvst(0.1), 350);
  assert.equal(findPvst(0.0441), 1131);
  assert.equal(findPvst(0.005), 8573);
  const t = thresholdsFromPvst(350);
  assert.ok(close(t[4], 350 ** 0.125) && close(t[7], 350) && close(t[0], 1 / 350));
  assert.deepEqual(likelihoodSettings({ pejaver: true }), { from: 'pejaver2022', prior: 0.0441, c: 1124 });
  assert.deepEqual(likelihoodSettings({}), { from: 'prior', prior: 0.1, c: 350 });
  assert.throws(() => likelihoodSettings({ prior: 1.2 }), /between 0 and 1/);
});

test('a variant\'s strength from the conservative end of its interval; the supporting thresholds themselves indeterminate', () => {
  const t = thresholdsFromPvst(350);
  assert.equal(evidenceOf(50, 20, 80, t), 'Pathogenic-Strong', 'its lower end, 20, is beyond strong (18.7)');
  assert.equal(evidenceOf(50, 10, 80, t), 'Pathogenic-Moderate');
  assert.equal(evidenceOf(0.01, 0.005, 0.04, t), 'Benign-Strong', 'its upper end, 0.04, is below strong (0.0535)');
  assert.equal(evidenceOf(t[4], t[4], t[4], t), 'indeterminate');
  assert.equal(evidenceOf(Number.NaN, 0, 0, t), null);
});

test('likelihood ratios of scores: ten controls a side at least; seeded, the same twice; lower scores the more pathogenic found', () => {
  assert.match(calibrateScores([{ score: 1, class: 'P' }, { score: 2, class: 'B' }]).problem, /at least 10 P and 10 B/);
  const rows = [];
  for (let i = 0; i < 30; i += 1) rows.push({ score: -2 + Math.sin(i) * 0.6, class: 'P' });
  for (let i = 0; i < 30; i += 1) rows.push({ score: 1 + Math.cos(i) * 0.6, class: 'B' });
  for (let i = 0; i < 40; i += 1) rows.push({ score: -3 + i * 0.12, class: 'U' });
  const a = calibrateScores(rows, { seed: 3 });
  const b = calibrateScores(rows, { seed: 3 });
  assert.deepEqual(a.rows, b.rows);
  assert.equal(a.curve.inverse, true);
  assert.ok(a.rows[0].lr > 1 && a.rows[30].lr < 1, 'a P control\'s ratio above 1, a B control\'s below');
  assert.equal(a.thresholds.length, 8);
});
