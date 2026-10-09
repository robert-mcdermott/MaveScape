import assert from 'node:assert/strict';
import test from 'node:test';
import { countsCSV, csv, num, scoresCSV, selectionCSV, statusOf } from './exports.js';
import { parseTable } from './csv.js';
import { scoreExperiment, DEFAULT_PARAMETERS } from './score.js';
import { detectLayout } from './importer.js';

const design = {
  format: 'mavescape-design', version: 1, name: 'toy', model: 'two-population',
  variants: { column: 'v', level: 'protein' }, targets: [{ id: 't', name: 'Toy', sequenceType: 'protein', sequence: 'MSKG' }], library: { level: 'variant' },
  samples: [{ id: 'in', name: 'in', columns: ['in'] }, { id: 'out', name: 'out', columns: ['out'] }],
  replicates: [{ id: 'r1', biological: 1, input: 'in', output: 'out' }],
  controls: { wildType: 'auto', synonymous: 'auto', nonsense: 'auto' },
};
const table = parseTable('v,in,out\np.=,100,90\np.Ser2Ala,10,3\np.Lys3Arg,NA,4\nS2G,7,0.5\n');
const run = { inputs: { design } };
const results = scoreExperiment({ names: table.columns[0].values, columns: { in: table.columns[1].numeric, out: table.columns[2].numeric }, design, parameters: DEFAULT_PARAMETERS }).results;

test('numbers in their shortest exact form; NA for missing; quoting', () => {
  assert.equal(num(0.1 + 0.2), '0.30000000000000004');
  assert.equal(num(Number.NaN), 'NA');
  assert.equal(Number(num(-1.2345678901234567e-7)), -1.2345678901234567e-7);
  assert.equal(csv(['a', 'b'], [['x,y', 'say "hi"']]), 'a,b\n"x,y","say ""hi"""\n');
});

test('scores in MaveDB\'s columns: every variant, its state, the name as written', () => {
  const text = scoresCSV(results, run);
  const t = parseTable(text);
  assert.deepEqual(t.columns.slice(0, 5).map((c) => c.name), ['hgvs_nt', 'hgvs_splice', 'hgvs_pro', 'score', 'SE']);
  assert.equal(t.rows, 4);
  const col = (n) => t.columns.find((c) => c.name === n).values;
  assert.deepEqual(col('hgvs_pro'), ['p.=', 'p.Ser2Ala', 'p.Lys3Arg', 'p.Ser2Gly']);
  assert.deepEqual(col('status'), ['scored', 'scored', 'not measured', 'scored']);
  assert.equal(col('variant_as_written')[3], 'S2G');
  assert.equal(col('score')[2], 'NA');
  assert.equal(detectLayout(t).layout, 'mavedb-scores');
  assert.equal(statusOf(results.conditions[0], 2), 'not measured');
});

test('counts as the table has them, the variant column kept; selections with scores', () => {
  const t = parseTable(countsCSV(table, design));
  assert.deepEqual(t.columns.map((c) => c.name), ['hgvs_nt', 'hgvs_splice', 'hgvs_pro', 'v', 'in', 'out']);
  assert.deepEqual(t.columns[4].values, ['100', '10', 'NA', '7']);
  assert.equal(t.columns[5].values[3], '0.5');
  assert.equal(detectLayout(t).layout, 'mavedb-counts');
  const sel = parseTable(selectionCSV(['p.Ser2Ala', 'p.Gly4Trp'], results, run));
  assert.deepEqual(sel.columns[3].values, ['scored', 'not in the table']);
});
