import assert from 'node:assert/strict';
import test from 'node:test';
import { fitLine, regressionScores } from './score-regression.js';
import { checkFilters } from './filters.js';
import { validateDesign } from './design.js';

const close = (a, b, tol = 1e-12) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≠ ${b}`);

test('a least-squares line, by hand: slope, residual-scaled SE, counting SE and departure', () => {
  // Points (0, 0), (0.5, 1), (1, 1), equal weights 1 and counting variances 1.
  // x̄ = 0.5, ȳ = 2/3, Sxx = 0.5, Sxy = 0.5 → slope 1, intercept 1/6; residuals −1/6, 1/3, −1/6;
  // RSS = 1/6, df 1 → SE = √(1/6 / 0.5) = √(1/3); counting SE = √(Σ dx² v) / Sxx = √0.5 / 0.5 = √2;
  // χ²/df = 1/6.
  const f = fitLine([0, 0.5, 1], [0, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1], 'residual');
  close(f.slope, 1);
  close(f.seResidual, Math.sqrt(1 / 3));
  close(f.seCounting, Math.sqrt(2));
  close(f.fit, 1 / 6);
  close(f.se, Math.sqrt(1 / 3));
  assert.equal(f.n, 3);
  // The counting floor raises an SE below what counting predicts.
  close(fitLine([0, 0.5, 1], [0, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1]).se, Math.sqrt(2));
});

test('points on an exact line: slope exact, residual SE 0, the floor keeps the counting SE', () => {
  const x = [0, 0.1, 0.3, 1];
  const y = x.map((t) => 2 - 3 * t);
  const v = [0.01, 0.02, 0.04, 0.08];
  const w = v.map((q) => 1 / q);
  const residual = fitLine(x, y, w, v, [1, 1, 1, 1], 'residual');
  close(residual.slope, -3);
  assert.ok(residual.se < 1e-12);
  const floored = fitLine(x, y, w, v, [1, 1, 1, 1]);
  // For WLS (w = 1/v) the counting SE is 1/√(Σ w (x − x̄)²).
  let sw = 0;
  let swx = 0;
  for (let t = 0; t < 4; t += 1) {
    sw += w[t];
    swx += w[t] * x[t];
  }
  const mx = swx / sw;
  const sxx = w.reduce((a, wt, t) => a + wt * (x[t] - mx) ** 2, 0);
  close(floored.se, 1 / Math.sqrt(sxx));
});

test('only the points in use, and too few points', () => {
  const f = fitLine([0, 0.5, 1, 0.7], [0, 1, 1, 99], [1, 1, 1, 1], [1, 1, 1, 1], [1, 1, 1, 0], 'residual');
  close(f.slope, 1);
  assert.equal(f.n, 3);
  const two = fitLine([0, 1], [0, 1], [1, 1], [1, 1], [1, 1]);
  close(two.slope, 1);
  assert.ok(Number.isNaN(two.se) && Number.isNaN(two.fit));
  assert.ok(Number.isNaN(fitLine([0], [0], [1], [1], [1]).slope));
});

test('a replicate scored by regression: Enrich2\'s normalized log counts, weights and scaled time', () => {
  // Wild type in row 0, a variant in row 1 counted at three of four times, one missing at time 0.
  const samples = [Float64Array.of(1000, 100, 50), Float64Array.of(1000, 80, Number.NaN), Float64Array.of(1000, 60, 40), Float64Array.of(1000, 50, 30)];
  const times = [0, 2, 5, 10];
  const r = samples.map((s) => s[0] + 0.5);
  const out = regressionScores(samples, times, r, Uint8Array.of(1, 1, 0), { weighted: true, pseudocount: 0.5, method: 'wt', se: 'residual' });
  // The wild type normalizes to a flat line.
  close(out.score[0], 0);
  // Row 1 by hand.
  const x = times.map((t) => t / 10);
  const y = samples.map((s, t) => Math.log(s[1] + 0.5) - Math.log(r[t]));
  const v = samples.map((s, t) => 1 / (s[1] + 0.5) + 1 / r[t]);
  const ref = fitLine(x, y, v.map((q) => 1 / q), v, [1, 1, 1, 1], 'residual');
  close(out.score[1], ref.slope, 1e-12);
  close(out.se[1], ref.se, 1e-12);
  assert.equal(out.points[1], 4);
  assert.ok(Number.isNaN(out.score[2]), 'a row not in use stays NaN');
  assert.throws(() => regressionScores(samples, [0, 0, 0, 0], r, Uint8Array.of(1, 1, 1), { pseudocount: 0.5, method: 'wt' }), /time 0/);
});

test('filters and designs for time series', () => {
  assert.deepEqual(checkFilters({ minTimePoints: 3 }), []);
  assert.deepEqual(checkFilters({ minTimePoints: 'all' }), []);
  assert.match(checkFilters({ minTimePoints: 2 })[0], /3 or more/);
  const design = {
    format: 'mavescape-design', version: 1, model: 'time-series', time: { unit: 'generation' },
    variants: { column: 'v', level: 'protein' }, targets: [{ id: 't', name: 't', sequenceType: 'protein', sequence: 'MSK' }],
    samples: [{ id: 'a', columns: ['a'], missingMeansZero: true }, { id: 'b', columns: ['b'] }, { id: 'c', columns: ['c'], missingMeansZero: true }],
    replicates: [{ id: 'r1', biological: 1, timepoints: [{ sample: 'a', time: 0 }, { sample: 'b', time: 1 }, { sample: 'c', time: 2 }] }],
  };
  const result = validateDesign(design);
  assert.ok(result.ok);
  assert.ok(result.warnings.some((w) => /"a" is the first of replicate "r1"/.test(w.message)), 'missing as 0 in an input is warned about');
  assert.ok(!result.warnings.some((w) => /"c" is the first/.test(w.message)));
  assert.equal(validateDesign({ ...design, samples: [{ id: 'a', columns: ['a'], missingMeansZero: 'yes' }, ...design.samples.slice(1)] }).ok, false);
});
