import assert from 'node:assert/strict';
import test from 'node:test';
import { cellValue, countsCSV, csv, num, proteinScoresCSV, scoresCSV, scoresTable, selectionCSV, statusOf } from './exports.js';
import { proteinView } from './collapse.js';
import { columnText, parseTable } from './csv.js';
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
  assert.ok(Number.isNaN(t.columns.find((c) => c.name === 'score').numeric[2]));
  assert.equal(detectLayout(t).layout, 'mavedb-scores');
  assert.equal(statusOf(results.conditions[0], 2), 'not measured');
});

test('counts as the table has them, the variant column kept; selections with scores', () => {
  const t = parseTable(countsCSV(table, design));
  assert.deepEqual(t.columns.map((c) => c.name), ['hgvs_nt', 'hgvs_splice', 'hgvs_pro', 'v', 'in', 'out']);
  assert.deepEqual(columnText(t.columns[4]), ['100', '10', '', '7']);
  assert.deepEqual(t.columns[4].missingTokens, ['NA']);
  assert.equal(t.columns[5].numeric[3], 0.5);
  assert.equal(detectLayout(t).layout, 'mavedb-counts');
  const sel = parseTable(selectionCSV(['p.Ser2Ala', 'p.Gly4Trp'], results, run));
  assert.deepEqual(sel.columns[3].values, ['scored', 'not in the table']);
});

// Wave 3, slice 3: a nucleotide run's protein changes, and its scores at the protein level.
test('a nucleotide run\'s scores give each variant\'s protein change, and merge at the protein level', () => {
  const target = { id: 't', name: 'T', sequenceType: 'dna', sequence: 'ATGGCTAAAAAAGGCTGGTAA', codingStart: 1 };
  const nt = parseTable('hgvs_nt,in,out\nc.=,100,100\nc.4G>T,100,50\nc.[4G>T;6T>A],80,40\nc.6del,90,10\nc.6T>C,100,110\n');
  const ntDesign = { format: 'mavescape-design', version: 1, name: 'nt', model: 'two-population', variants: { column: 'hgvs_nt', level: 'nucleotide' }, targets: [target], library: { level: 'variant' }, samples: [{ id: 'in', columns: ['in'] }, { id: 'out', columns: ['out'] }], replicates: [{ id: 'r', biological: 1, input: 'in', output: 'out' }], controls: { wildType: 'auto', synonymous: 'auto', nonsense: 'auto' } };
  const out = scoreExperiment({ names: columnText(nt.columns[0]), columns: { in: nt.columns[1].numeric, out: nt.columns[2].numeric }, design: ntDesign, parameters: DEFAULT_PARAMETERS });
  const run = { inputs: { design: ntDesign } };
  const lines = scoresCSV(out.results, run).trim().split('\n');
  assert.deepEqual(lines.slice(1).map((l) => l.split(',').slice(0, 3).join(',')), ['c.=,NA,p.=', 'c.4G>T,NA,p.Ala2Ser', 'c.[4G>T;6T>A],NA,p.Ala2Ser', 'c.6del,NA,p.Gly5fs', 'c.6T>C,NA,p.Ala2=']);
  const protein = proteinScoresCSV(proteinView(out.results)).trim().split('\n');
  assert.equal(protein[0], 'hgvs_pro,score,SE,ci95_lower,ci95_upper,status,flags,variant_class,nucleotide_variants,hgvs_nt');
  assert.deepEqual(protein.slice(1).map((l) => [l.split(',')[0], l.split(',').at(-2), l.split(',').at(-1)]), [['p.=', '1', 'c.='], ['p.Ala2Ser', '2', 'c.4G>T c.[4G>T;6T>A]'], ['p.Ala2=', '1', 'c.6T>C']]);
});

test('a run\'s scores as data (the remote action scores): the CSV\'s cells, numbers as numbers, NA as null', () => {
  const t = scoresTable(results, run);
  const [header, ...lines] = scoresCSV(results, run).trimEnd().split('\n').map((line) => line.split(','));
  assert.deepEqual(t.header, header);
  t.rows.forEach((row, i) => row.forEach((value, j) => {
    const data = cellValue(value, t.header[j]);
    assert.equal(data === null ? 'NA' : String(data), lines[i][j]);
  }));
  assert.equal(cellValue(Number.NaN, 'score'), null);
  assert.equal(cellValue(Infinity, 'df'), 'Inf');
  assert.equal(cellValue('NA', 'hgvs_nt'), null);
  assert.equal(cellValue(2, 'replicates'), 2);
});
