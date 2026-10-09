import assert from 'node:assert/strict';
import test from 'node:test';
import { median, normalizers, ratioScores } from './score-ratio.js';

const close = (a, b) => assert.ok(Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(b)), `${a} ≠ ${b}`);
// Rows: the wild type, two variants, one not counted after selection.
const before = Float64Array.of(100, 10, 0, 5);
const after = Float64Array.of(200, 5, 8, Number.NaN);
const counted = Uint8Array.of(1, 1, 1, 0);

test('normalizers: wild type, complete cases, all reads (each + p once)', () => {
  assert.deepEqual(normalizers('wt', [before, after], counted, { pseudocount: 0.5, wtRow: 0 }), [100.5, 200.5]);
  assert.deepEqual(normalizers('complete', [before, after], counted, { pseudocount: 0.5 }), [110.5, 213.5]);
  assert.deepEqual(normalizers('full', [before, after], counted, { pseudocount: 0.5 }), [115.5, 213.5]);
  assert.throws(() => normalizers('wt', [before, after], counted, { pseudocount: 0.5, wtRow: -1 }), /has none/);
  assert.throws(() => normalizers('wt', [Float64Array.of(0), Float64Array.of(3)], Uint8Array.of(1), { pseudocount: 0.5, wtRow: 0 }), /no reads/);
});

test('log ratios and SEs by hand; the wild type scores 0 in wild-type mode', () => {
  const r = [100.5, 200.5];
  const { score, se } = ratioScores('wt', [before, after], counted, r, { pseudocount: 0.5 });
  assert.equal(score[0], 0);
  close(score[1], Math.log(5.5 / 200.5) - Math.log(10.5 / 100.5));
  close(se[2], Math.sqrt(1 / 0.5 + 1 / 8.5 + 1 / 100.5 + 1 / 200.5));
  assert.ok(Number.isNaN(score[3]), 'not counted: not scored');
});

test('synonymous normalization: the median synonymous score is subtracted; none is an error', () => {
  const out = ratioScores('synonymous', [before, after], counted, [1, 1], { pseudocount: 0.5, reference: [0, 1] });
  close(out.median, (Math.log(200.5 / 100.5) + Math.log(5.5 / 10.5)) / 2);
  close(out.score[0] + out.score[1], 0);
  close(out.se[1], Math.sqrt(1 / 10.5 + 1 / 5.5));
  assert.throws(() => ratioScores('synonymous', [before, after], counted, [1, 1], { pseudocount: 0.5, reference: [] }), /No synonymous/);
  assert.equal(median([3, 1, 2, 10]), 2.5);
});
