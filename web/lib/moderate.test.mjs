import assert from 'node:assert/strict';
import test from 'node:test';
import { fitErrorModel, moderatedCombination, replicateShifts, squeezeVariances } from './moderate.js';
import { squeezeVariances as limmaSqueeze } from './limma.js';
import { createRandom } from './random.js';

// Rows of K replicate measurements, each with counting variance v and variance a·v + b in truth,
// replicate k shifted by shift[k] (the reference's), from true means mu.
function rows({ n = 800, K = 3, a = 2, b = 0.01, shift = [0, 0, 0], seed = 3 }) {
  const random = createRandom(seed);
  const out = [];
  const mu = [];
  for (let i = 0; i < n; i += 1) {
    const m = random.gaussian();
    mu.push(m);
    const v = [];
    const y = [];
    for (let k = 0; k < K; k += 1) {
      const vi = 0.002 + 0.05 * random();
      v.push(vi);
      y.push(m + shift[k] + Math.sqrt(a * vi + b) * random.gaussian());
    }
    out.push({ y, v, rep: [...Array(K).keys()], share: null, u: null });
  }
  return { rows: out, mu };
}

test('the shared error model recovers a bottleneck (a) and noise between replicates (b)', () => {
  const { a, b, fitted } = fitErrorModel(rows({ a: 3, b: 0.004, n: 4000 }).rows);
  assert.ok(fitted);
  assert.ok(Math.abs(a - 3) < 0.4, `a ${a}`);
  assert.ok(Math.abs(b - 0.004) < 0.002, `b ${b}`);
  assert.deepEqual(fitErrorModel(rows({ n: 5 }).rows), { a: 1, b: 0, pairs: 15, fitted: false }, 'too few pairs: counting alone');
});

test('a shift shared by every variant of a replicate is the reference\'s: measured from the replicates\' shifts, not taken for noise', () => {
  const planted = rows({ a: 1, b: 0.001, shift: [0.3, -0.1, -0.2], n: 2000 });
  const { a, b } = fitErrorModel(planted.rows);
  assert.ok(b < 0.003 && Math.abs(a - 1) < 0.2, `a ${a}, b ${b}: the shift does not enter b`);
  const { shifts, variance } = replicateShifts(planted.rows);
  assert.deepEqual([...shifts.values()].map((x) => Math.round(x * 10) / 10), [0.3, -0.1, -0.2]);
  assert.ok(Math.abs(variance - 0.07) < 0.01, `variance of the shifts ${variance}`);
});

test('the prior equals limma\'s when every row has the same degrees of freedom', () => {
  const random = createRandom(5);
  const s2 = Array.from({ length: 300 }, () => Math.exp(0.6 * random.gaussian()));
  const ours = squeezeVariances(s2, s2.map(() => 2));
  const theirs = limmaSqueeze(s2.map(Math.sqrt), 2);
  assert.ok(Math.abs(ours.s2Prior - theirs.s2Prior) < 1e-12 * theirs.s2Prior && (ours.dfPrior === theirs.dfPrior || Math.abs(ours.dfPrior - theirs.dfPrior) < 1e-9 * theirs.dfPrior), `${JSON.stringify(ours)} ${JSON.stringify(theirs)}`);
  // With spread beyond sampling (a finite prior), too.
  const wide = Array.from({ length: 300 }, () => Math.exp(1.5 * random.gaussian()));
  const [w1, w2] = [squeezeVariances(wide, wide.map(() => 3)), limmaSqueeze(wide.map(Math.sqrt), 3)];
  assert.ok(Number.isFinite(w2.dfPrior) && Math.abs(w1.dfPrior - w2.dfPrior) < 1e-9 * w2.dfPrior && Math.abs(w1.s2Prior - w2.s2Prior) < 1e-12 * w2.s2Prior, `${JSON.stringify(w1)} ${JSON.stringify(w2)}`);
});

test('moderated intervals hold the truth about 95% of the time where REML-like per-variant intervals would not', () => {
  const { rows: data, mu } = rows({ a: 1.5, b: 0.01, n: 2000, seed: 11 });
  const m = moderatedCombination(data);
  let inside = 0;
  for (let i = 0; i < data.length; i += 1) if (Math.abs(m.estimate[i] - mu[i]) < 1.96 * m.se[i] * (Number.isFinite(m.df[i]) ? 1.03 : 1)) inside += 1;
  assert.ok(inside / data.length > 0.93 && inside / data.length < 0.97, `coverage ${inside / data.length}`);
  assert.ok(Math.abs(m.model.phiPrior - 1) < 0.1, `prior dispersion ${m.model.phiPrior}`);
});

test('replicates sharing an input are combined with its covariance (generalized least squares)', () => {
  // Two replicates of one input: the input's counting variance (0.04) is in both scores.
  const row = { y: [1, 2], v: [0.05, 0.05], rep: [0, 1], share: ['in', 'in'], u: [-0.2, -0.2] };
  const filler = rows({ a: 1, b: 0, n: 100, K: 2 }).rows;
  const m = moderatedCombination([row, ...filler]);
  const independent = moderatedCombination([{ ...row, share: null, u: null }, ...filler]);
  assert.ok(m.se[0] > independent.se[0] * 1.5, `SE ${m.se[0]} against ${independent.se[0]} as independent`);
  assert.ok(Math.abs(m.estimate[0] - 1.5) < 1e-12);
});

test('the same rows in any order give the same bits; a score known exactly keeps SE 0', () => {
  const { rows: data } = rows({ n: 500, seed: 7 });
  const order = data.map((_, i) => i).reverse();
  const a = moderatedCombination(data);
  const b = moderatedCombination(order.map((i) => data[i]));
  order.forEach((i, j) => assert.ok(Object.is(a.se[i], b.se[j]) && Object.is(a.estimate[i], b.estimate[j])));
  const exact = moderatedCombination([{ y: [0, 0], v: [0, 0], rep: [0, 1], share: null, u: null }]);
  assert.deepEqual([exact.estimate[0], exact.se[0]], [0, 0]);
});

test('a reference that varies widens a score\'s degrees of freedom toward the replicates\' (Satterthwaite)', () => {
  const steady = moderatedCombination(rows({ a: 1, b: 0.001, n: 1500, seed: 21 }).rows);
  const shifting = moderatedCombination(rows({ a: 1, b: 0.001, n: 1500, seed: 21, shift: [0.4, -0.3, -0.1] }).rows);
  assert.ok(shifting.model.bReference > 0.05, `the shifts' variance ${shifting.model.bReference}`);
  assert.ok(steady.df[0] > 15 && shifting.df[0] < 4 && shifting.df[0] >= 2, `${steady.df[0]} against ${shifting.df[0]}`);
  assert.ok(shifting.seWithin[0] < shifting.se[0] && Math.abs(steady.seWithin[0] - steady.se[0]) < 0.01 * steady.se[0]);
});

test('with one replicate there is no model to fit: each measurement keeps its own SE (a regression\'s residual-scaled one)', () => {
  const data = rows({ n: 300, K: 1, seed: 31 }).rows.map((row) => ({ ...row, own: row.v.map((v) => 9 * v) }));
  const m = moderatedCombination(data);
  assert.equal(m.model.fitted, false);
  data.forEach((row, i) => assert.ok(Math.abs(m.se[i] - Math.sqrt(row.own[0])) < 1e-12 * m.se[i] && Math.abs(m.estimate[i] - row.y[0]) <= 1e-15 * Math.max(1, Math.abs(row.y[0]))));
  // With a model, own is not used.
  const fitted = moderatedCombination(rows({ n: 800, seed: 32 }).rows.map((row) => ({ ...row, own: row.v.map(() => 100) })));
  assert.ok(fitted.model.fitted && fitted.se.every((x) => x < 1));
});

