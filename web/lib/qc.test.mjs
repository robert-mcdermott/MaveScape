import assert from 'node:assert/strict';
import test from 'node:test';
import { computeQC } from './qc.js';
import { simulateExperiment } from './simulate.js';
import { parseTable } from './csv.js';

const target = { id: 't', name: 'Toy', sequenceType: 'protein', sequence: 'MSK' };
const design = {
  format: 'mavescape-design', version: 1, name: 'toy', model: 'two-population',
  variants: { column: 'v', level: 'protein' }, targets: [target], library: { level: 'variant' },
  samples: [{ id: 'in', name: 'in', columns: ['in'] }, { id: 'out', name: 'out', columns: ['out'] }],
  replicates: [{ id: 'r1', biological: 1, input: 'in', output: 'out' }],
  controls: { wildType: 'auto', synonymous: 'auto', nonsense: 'auto' },
};

test('sample metrics: depth, zeros, low and missing counts, by sample', () => {
  const qc = computeQC({ names: ['p.=', 'p.Ser2Ala', 'p.Ser2Ter', 'p.Lys3Arg'], columns: { in: Float64Array.of(100, 5, 0, Number.NaN), out: Float64Array.of(80, 20, 1, 3) }, design });
  const [input, output] = qc.samples;
  assert.deepEqual([input.counted, input.missing, input.total, input.zeros, input.low], [3, 1, 105, 1, 2]);
  assert.equal(input.readsPerVariant, 35);
  assert.equal(input.input, true);
  assert.equal(output.input, false);
  assert.equal(output.missingFraction, 0);
  assert.deepEqual(qc.missingness.patterns, [{ pattern: '00', count: 3 }, { pattern: '10', count: 1 }]);
});

test('coverage: designed substitutions, in the table, observed before selection', () => {
  const qc = computeQC({ names: ['p.=', 'p.Ser2Ala', 'p.Ser2Ter', 'p.Lys3Arg'], columns: { in: Float64Array.of(100, 5, 0, Number.NaN), out: Float64Array.of(80, 20, 1, 3) }, design });
  const c = qc.coverage;
  assert.deepEqual([c.length, c.designed, c.inTable, c.observed], [3, 60, 3, 1]);
  assert.deepEqual(c.byClass.nonsense, [0, 3]);
  // Rows by amino-acid code: S2A observed, S2* in the table without input reads, the reference S2.
  const cell = (p, aa) => c.grid[(p - 1) * 21 + 'ARNDCQEGHILKMFPSTWYV*'.indexOf(aa)];
  assert.deepEqual([cell(2, 'A'), cell(2, '*'), cell(2, 'S'), cell(3, 'R'), cell(1, 'W')], [2, 1, 3, 1, 0]);
});

test('replicates: agreement, leave-one-out and variance beyond counting on a simulation', () => {
  const sim = simulateExperiment({ seed: 5, inputCells: 25 });
  const table = parseTable(sim.csv);
  const qc = computeQC({ names: table.columns[0].values, columns: Object.fromEntries(table.columns.slice(1).map((c) => [c.name, c.numeric])), design: sim.design });
  const c = qc.conditions[0];
  assert.equal(c.pairs.length, 3);
  assert.ok(c.pairs.every((p) => p.n > 700 && p.pearson > 0.8 && p.ratio > 3), 'a bottleneck: agreeing replicates, variance well beyond counting');
  assert.equal(c.leaveOneOut.length, 3);
  assert.ok(c.leaveOneOut.every((x) => x.ratio > 0.7 && x.ratio < 1.4), 'shared by every replicate: no outlier');
  assert.ok(c.synonymous.every((s) => s.n >= 30 && s.ratio > 2));
});

test('dropout: variants missing after selection, with no zeros written, and how depleted they were', () => {
  const ts = {
    ...design,
    model: 'time-series',
    time: { unit: 'round' },
    samples: ['t0', 't1', 't2'].map((id) => ({ id, name: id, columns: [id] })),
    replicates: [{ id: 'r1', biological: 1, timepoints: [{ sample: 't0', time: 0 }, { sample: 't1', time: 1 }, { sample: 't2', time: 2 }] }],
  };
  const names = Array.from({ length: 40 }, (_, i) => `p.Ser2${['Ala', 'Gly', 'Val', 'Leu'][i % 4]}`).map((n, i) => (i < 4 ? n : `p.Lys3${['Ala', 'Gly', 'Val', 'Leu', 'Pro', 'Thr', 'Asp', 'Glu', 'Asn', 'Gln', 'His', 'Ile', 'Met', 'Phe', 'Trp', 'Tyr', 'Cys', 'Ser', 'Arg'][i % 19]}`));
  const t0 = Float64Array.from(names, () => 100);
  const t1 = Float64Array.from(names, (_, i) => (i < 10 ? 2 : 50));
  const t2 = Float64Array.from(names, (_, i) => (i < 10 ? Number.NaN : 40));
  const qc = computeQC({ names, columns: { t0, t1, t2 }, design: ts });
  const d = qc.conditions[0].dropout[0];
  assert.deepEqual([d.sample, d.by, d.counted, d.missing, d.zeros], ['t2', 'trend', 40, 10, 0]);
  assert.equal(d.missingTrend, 0.02);
  assert.equal(d.countedTrend, 0.5);
});
