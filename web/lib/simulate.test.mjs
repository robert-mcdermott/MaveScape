import assert from 'node:assert/strict';
import test from 'node:test';
import { simulateExperiment } from './simulate.js';
import { parseTable } from './csv.js';
import { validateDesign } from './design.js';
import { reviewImport } from './importer.js';

test('a simulated experiment: deterministic, labeled, every name valid, its design valid', () => {
  const a = simulateExperiment({ seed: 3, protein: 'MSKGE' });
  assert.equal(a.csv, simulateExperiment({ seed: 3, protein: 'MSKGE' }).csv);
  assert.notEqual(a.csv, simulateExperiment({ seed: 4, protein: 'MSKGE' }).csv);
  assert.match(a.design.description, /Simulated .* not real data/);
  const table = parseTable(a.csv);
  assert.equal(table.rows, 1 + 4 * 2 + 5 * 19);
  assert.ok(validateDesign(a.design, { columns: table.columns.map((c) => c.name) }).ok);
  const review = reviewImport(table, { variantColumn: 'hgvs_pro', level: 'protein', countColumns: table.columns.slice(1).map((c) => c.name), target: a.design.targets[0] });
  assert.equal(review.summary.invalid, 0);
  assert.deepEqual(review.blocking, []);
});

test('a missing sample is written as NA; depth scales the reads', () => {
  const a = simulateExperiment({ seed: 3, protein: 'MSKGE', missing: [{ replicate: 2, sample: 'output' }], readsPerVariant: 1000 });
  const table = parseTable(a.csv);
  assert.equal(table.columns.find((c) => c.name === 'output_rep2').type, 'empty');
  const total = table.columns.find((c) => c.name === 'input_rep1').numeric.reduce((x, y) => x + y, 0);
  assert.ok(Math.abs(total / (table.rows * 1000) - 1) < 0.05);
});
