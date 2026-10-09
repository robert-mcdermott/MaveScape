import assert from 'node:assert/strict';
import test from 'node:test';
import { barcodeDisagreement, barcodeProblems, combineBarcodes, groupBarcodes, sumByVariant } from './score-barcodes.js';
import { DEFAULT_PARAMETERS, scoreExperiment } from './score.js';
import { REPLICATE_STATE, STAGE_BY_ID } from './filters.js';
import { createRandom } from './random.js';

const close = (a, b, tol = 1e-12) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≠ ${b}`);

test('barcodes grouped by variant: the same variant however written, blank names unmapped', () => {
  const g = groupBarcodes(['p.Ala2Val', 'A2V', '', 'p.=', 'p.Ala2Val', 'junk', 'p.Ala2Ala'], { level: 'protein' });
  assert.deepEqual(g.variants.original, ['p.Ala2Val', 'p.=', 'junk', 'p.Ala2Ala']);
  assert.deepEqual([...g.variantOf], [0, 0, -1, 1, 0, 2, 3]);
  assert.deepEqual([...g.members.slice(g.offsets[0], g.offsets[1])], [0, 1, 4]);
  assert.equal(g.unmapped, 1);
  assert.equal(g.rewritten, 1, 'A2V and p.Ala2Val');
  assert.deepEqual(barcodeProblems(['AC', 'GT', 'AC', '', 'TT', 'AC']), { repeated: [{ id: 'AC', rows: [0, 2, 5] }], blank: [3] });
});

test('counts summed per variant: missing never read as 0, barcodes left out on request', () => {
  const g = groupBarcodes(['p.=', 'p.=', 'p.Ala2Val', 'p.Ala2Val', 'p.Ala2Gly'], { level: 'protein' });
  const counts = Float64Array.of(10, 5, Number.NaN, 7, Number.NaN);
  const sums = sumByVariant(counts, g);
  assert.deepEqual([...sums.slice(0, 2)], [15, 7]);
  assert.ok(Number.isNaN(sums[2]));
  assert.deepEqual([...sumByVariant(counts, g, Uint8Array.of(0, 1, 0, 0, 0)).slice(0, 2)], [10, 7]);
});

test('a barcode far from its variant\'s others stands out; φ reads how much barcodes disagree', () => {
  // Barcodes that vary only by counting (SE 0.1), four per variant; among them one variant of six
  // barcodes, five alike and one far off, and one of two (compared, never called an outlier).
  const random = createRandom(9);
  const names = ['a', 'a', 'a', 'a', 'a', 'a', 'b', 'b'];
  const y = [0.1, -0.1, 0.05, -0.05, 0, 3, 1, 3];
  for (let v = 0; v < 200; v += 1) for (let k = 0; k < 4; k += 1) {
    names.push(`v${v}`);
    y.push(random.gaussian() * 0.1);
  }
  const g = groupBarcodes(names, { level: 'protein' });
  const d = barcodeDisagreement(Float64Array.from(y), new Float64Array(y.length).fill(0.1), new Uint8Array(y.length).fill(1), g);
  assert.equal(d.compared, y.length);
  assert.ok(d.phi >= 1 && d.phi < 1.2, `${d.phi}`);
  assert.ok(Math.abs(d.z[5]) > 10, `${d.z[5]}`);
  assert.equal(d.outlier[5], 1);
  // Its variant's other barcodes are compared without it, and are not off.
  assert.ok([0, 1, 2, 3, 4].every((r) => Math.abs(d.z[r]) < 3 && !d.outlier[r]));
  // By hand, the fifth barcode against the other four: their mean 0, variance 0.01/4.
  close(d.z[4] * Math.sqrt(d.phi), (0 - 0) / Math.sqrt(0.01 + 0.01 / 4));
  close(d.z[0] * Math.sqrt(d.phi), (0.1 - (-0.1 + 0.05 - 0.05 + 0) / 4) / Math.sqrt(0.01 + 0.01 / 4));
  assert.ok(Number.isNaN(d.z[6]) && !d.outlier[6], 'two barcodes cannot say which one is off');
  assert.ok(d.outliers <= 2, `${d.outliers}`);
  // φ near 1 for counting alone (never below), near 4 when barcodes vary twice as much.
  y.length = 0;
  names.length = 0;
  for (let v = 0; v < 400; v += 1) for (let k = 0; k < 4; k += 1) {
    names.push(`v${v}`);
    y.push(random.gaussian() * 0.2);
  }
  const quiet = barcodeDisagreement(Float64Array.from(y), new Float64Array(y.length).fill(0.2), new Uint8Array(y.length).fill(1), groupBarcodes(names, { level: 'protein' }));
  assert.ok(quiet.phi >= 1 && quiet.phi < 1.15, `${quiet.phi}`);
  const noisy = barcodeDisagreement(Float64Array.from(y, (x) => x * 2), new Float64Array(y.length).fill(0.2), new Uint8Array(y.length).fill(1), groupBarcodes(names, { level: 'protein' }));
  assert.ok(Math.abs(noisy.phi / 4 - 1) < 0.15, `${noisy.phi}`);
});

test('a variant\'s barcodes combined: fixed effects, REML, the mean', () => {
  const g = groupBarcodes(['a', 'a', 'a', 'b'], { level: 'protein' });
  const score = Float64Array.of(1, 2, 4, 7);
  const se = Float64Array.of(1, 1, 2, 0.5);
  const use = Uint8Array.of(1, 1, 1, 1);
  const fixed = combineBarcodes('fixed', score, se, use, g);
  close(fixed.score[0], (1 + 2 + 4 / 4) / 2.25);
  close(fixed.se[0], Math.sqrt(1 / 2.25));
  assert.equal(fixed.score[1], 7);
  assert.deepEqual([...fixed.k], [3, 1]);
  const mean = combineBarcodes('mean', score, se, Uint8Array.of(1, 1, 0, 1), g);
  close(mean.score[0], 1.5);
  close(mean.se[0], Math.sqrt(0.5 / 2));
  assert.ok(combineBarcodes('reml', score, se, use, g).se[0] >= fixed.se[0]);
});

// A barcode table: three variants and the wild type, each on several barcodes, two replicates.
const target = { id: 't', name: 'Toy', sequenceType: 'protein', sequence: 'MSKGEELFTG' };
const design = (extra = {}) => ({
  format: 'mavescape-design', version: 1, name: 'toy barcodes', model: 'two-population',
  variants: { column: 'v', level: 'protein' }, targets: [target], library: { level: 'barcode', barcodeColumn: 'bc' },
  samples: ['in1', 'out1', 'in2', 'out2'].map((id) => ({ id, name: id, columns: [id] })),
  replicates: [{ id: 'r1', biological: 1, input: 'in1', output: 'out1' }, { id: 'r2', biological: 2, input: 'in2', output: 'out2' }],
  controls: { wildType: 'auto', synonymous: 'auto', nonsense: 'auto' },
  ...extra,
});
const names = ['p.=', 'p.=', 'p.Ser2Ala', 'S2A', 'p.Ser2Ala', 'p.Lys3Ter', 'p.Lys3Ter', 'p.Lys3Ter', 'p.Gly4=', ''];
const barcodes = names.map((_, i) => `bc${i}`);
const col = (...x) => Float64Array.from(x);
const columns = () => ({
  in1: col(500, 600, 20, 30, 25, 40, 35, 30, 50, 8), out1: col(550, 650, 10, 12, 11, 2, 1, 40, 52, 3),
  in2: col(450, 520, 22, 28, 27, 38, 33, 29, 45, 7), out2: col(500, 560, 9, 14, 10, 1, 2, 3, 49, 2),
});

test('sum, then score: the same scores as the table of summed counts', () => {
  const out = scoreExperiment({ names, barcodes, columns: columns(), design: design(), parameters: DEFAULT_PARAMETERS });
  assert.ok(out.ok, out.errors?.join(' '));
  const r = out.results;
  assert.deepEqual(r.variants.original, ['p.=', 'p.Ser2Ala', 'p.Lys3Ter', 'p.Gly4=']);
  assert.equal(r.barcodes.unmapped, 1);
  assert.ok(r.warnings.some((w) => w.code === 'unmapped-barcodes'));
  const c = columns();
  const sum = (name, rows) => rows.reduce((a, i) => a + c[name][i], 0);
  const rows = [[0, 1], [2, 3, 4], [5, 6, 7], [8]];
  const summed = Object.fromEntries(Object.keys(c).map((name) => [name, Float64Array.from(rows, (x) => sum(name, x))]));
  const variantDesign = design({ library: { level: 'variant' } });
  const direct = scoreExperiment({ names: ['p.=', 'p.Ser2Ala', 'p.Lys3Ter', 'p.Gly4='], columns: summed, design: variantDesign, parameters: DEFAULT_PARAMETERS }).results;
  assert.deepEqual([...r.conditions[0].score], [...direct.conditions[0].score]);
  assert.deepEqual([...r.conditions[0].se], [...direct.conditions[0].se]);
  // Each barcode scored against the summed wild type, as dms_variants' func_scores by barcode.
  const b = r.replicates[0].barcodes;
  close(b.score[2], Math.log(((10 + 0.5) / (1200 + 0.5)) / ((20 + 0.5) / (1100 + 0.5))));
  close(b.se[2] ** 2, 1 / 10.5 + 1 / 1200.5 + 1 / 20.5 + 1 / 1100.5);
  assert.equal(b.state[9], REPLICATE_STATE.NOT_COUNTED, 'an unmapped barcode is not scored');
  assert.deepEqual([...b.measured], [2, 3, 3, 1]);
});

test('score each barcode, then combine; the barcode filters', () => {
  const byBarcode = scoreExperiment({ names, barcodes, columns: columns(), design: design(), parameters: { ...DEFAULT_PARAMETERS, aggregation: 'barcode', barcodeCombination: 'fixed' } });
  assert.ok(byBarcode.ok, byBarcode.errors?.join(' '));
  const rep = byBarcode.results.replicates[0];
  const b = rep.barcodes;
  const w = [2, 3, 4].map((i) => 1 / b.se[i] ** 2);
  close(rep.score[1], [2, 3, 4].reduce((a, i, j) => a + w[j] * b.score[i], 0) / (w[0] + w[1] + w[2]));
  // The wild type's barcodes are not 0 each, but combine near it.
  assert.ok(Math.abs(rep.score[0]) < 0.05);
  // Two barcodes required: p.Gly4= has one, and is left out at the barcode stage.
  const two = scoreExperiment({ names, barcodes, columns: columns(), design: design(), parameters: { ...DEFAULT_PARAMETERS, filters: { ...DEFAULT_PARAMETERS.filters, minBarcodes: 2 } } }).results;
  assert.equal(two.replicates[0].state[3], REPLICATE_STATE.FEW_BARCODES);
  assert.equal(two.conditions[0].reason[3], STAGE_BY_ID.get('barcodes').code);
  assert.ok(two.conditions[0].flow.some((x) => x.stage === 'barcodes' && x.removed === 1));
  // p.Lys3Ter's third barcode (40 reads out of 30, where the others nearly vanish) disagrees; the
  // filter leaves it out of the sum.
  const filtered = scoreExperiment({ names, barcodes, columns: columns(), design: design(), parameters: { ...DEFAULT_PARAMETERS, filters: { ...DEFAULT_PARAMETERS.filters, maxBarcodeZ: 3 } } }).results;
  const fb = filtered.replicates[0].barcodes;
  assert.ok(Math.abs(fb.z[7]) > 3, `${fb.z[7]}`);
  assert.equal(fb.outlier[7], 1);
  assert.equal(filtered.replicates[0].first[2], 75, 'its input reads left out of the sum');
  assert.ok(filtered.conditions[0].score[2] < byBarcode.results.conditions[0].score[2]);
});

test('barcode tables refused when a barcode repeats, or scored by barcode from sorted bins', () => {
  const twice = scoreExperiment({ names, barcodes: barcodes.map((x, i) => (i === 3 ? 'bc0' : x)), columns: columns(), design: design(), parameters: DEFAULT_PARAMETERS });
  assert.equal(twice.ok, false);
  assert.match(twice.errors[0], /bc0/);
  const none = scoreExperiment({ names, columns: columns(), design: design(), parameters: DEFAULT_PARAMETERS });
  assert.match(none.errors[0], /barcodes/);
  const variantTable = scoreExperiment({ names: ['p.=', 'p.Ser2Ala'], columns: { in1: col(1, 2), out1: col(1, 2), in2: col(1, 2), out2: col(1, 2) }, design: design({ library: { level: 'variant' } }), parameters: { ...DEFAULT_PARAMETERS, aggregation: 'barcode' } });
  assert.match(variantTable.errors[0], /table of barcodes/);
});
