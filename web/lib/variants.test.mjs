import assert from 'node:assert/strict';
import test from 'node:test';
import { AA_CODE, KIND, KIND_NAMES, STATUS, aminoAcidOf, buildVariants, duplicateKeys, summarizeVariants } from './variants.js';
import { buildCountSet, identicalColumns, joinCountTables } from './counts.js';
import { parseTable } from './csv.js';

const target = { id: 't', name: 'Toy', sequenceType: 'protein', sequence: 'MSKGEELFTG' };

test('kinds, positions and residues of protein variants', () => {
  const v = buildVariants(['p.Met1Val', 'p.Ser2Ala', 'p.Ser2Ter', 'p.Ser2=', 'p.=', 'p.(=)', 'p.[Ser2Ala;Lys3Arg]', 'p.Gly4del', 'p.Glu5fs', 'K3R'], { target });
  assert.deepEqual([...v.kind].map((k) => KIND_NAMES[k]), ['start lost', 'missense', 'nonsense', 'synonymous', 'wild type', 'synonymous', 'multi-variant', 'deletion', 'frameshift', 'missense']);
  assert.deepEqual([...v.position], [1, 2, 2, 2, -1, -1, 2, 4, 5, 3]);
  assert.equal(aminoAcidOf(v.ref[1]), 'S');
  assert.equal(aminoAcidOf(v.alt[2]), '*');
  assert.equal(v.ref[3], AA_CODE.S);
  assert.equal(v.alt[3], AA_CODE.S);
  assert.equal(v.key[9], 'p.Lys3Arg');
  assert.equal(v.original[9], 'K3R', 'the original is kept as written');
  assert.equal(v.status[9], STATUS.WARNING);
  assert.deepEqual(v.messages.get(9), ['one-letter amino acids written in three letters']);
});

test('names that do not parse, or disagree with the target, are invalid with a reason; empty names too', () => {
  const v = buildVariants(['p.Ala2Val', 'p.Ser11Ala', 'hello', 'NA', 'c.4G>A'], { target });
  assert.deepEqual([...v.status], [STATUS.INVALID, STATUS.INVALID, STATUS.INVALID, STATUS.INVALID, STATUS.INVALID]);
  assert.match(v.messages.get(0)[0], /has Ser at 2, not Ala/);
  assert.match(v.messages.get(1)[0], /beyond the target/);
  assert.deepEqual(v.messages.get(3), ['no variant name']);
  assert.match(v.messages.get(4)[0], /nucleotide variant in a column of protein variants/);
  const strict = buildVariants(['A12V'], { mode: 'strict' });
  assert.equal(strict.status[0], STATUS.INVALID);
  assert.equal(summarizeVariants(v).invalid, 5);
});

test('the same variant on two rows is a duplicate, however it is written', () => {
  const v = buildVariants(['p.Ala12Val', 'A12V', 'p.Ala12Ala', 'p.Ala12=', 'p.Gly13Asp']);
  assert.deepEqual(duplicateKeys(v), [{ key: 'p.Ala12Val', rows: [0, 1] }, { key: 'p.Ala12=', rows: [2, 3] }]);
});

test('count sets: missing is NaN, an explicit 0 is 0, problems listed by line', () => {
  const table = parseTable('v,in,out,bad,neg\np.=,10,20,1,1\np.Ser2Ala,NA,0,x,-3\np.Lys3Arg,4,2.5,2,0\n');
  const set = buildCountSet(table, { variantColumn: 'v', countColumns: ['in', 'out', 'bad', 'neg', 'nope'] });
  const [input, output] = set.samples;
  assert.ok(Number.isNaN(input.counts[1]));
  assert.equal(output.counts[1], 0);
  assert.deepEqual({ total: input.total, observed: input.observed, missing: input.missing }, { total: 14, observed: 2, missing: 1 });
  assert.equal(output.nonInteger, 1);
  const codes = set.problems.map((p) => `${p.level}:${p.code}:${p.column}`);
  assert.deepEqual(codes.sort(), ['error:negative:neg', 'error:no-column:nope', 'error:not-numeric:bad', 'warning:non-integer:out']);
  assert.match(set.problems.find((p) => p.code === 'not-numeric').message, /"x" \(line 3\)/);
  assert.match(set.problems.find((p) => p.code === 'negative').message, /line 3/);
});

test('identical columns (a shared input written once per replicate) are found', () => {
  const table = parseTable('v,a_c_0,b_c_0,a_c_1\nx,1,1,5\ny,2,2,6\n');
  assert.deepEqual(identicalColumns(table, ['a_c_0', 'b_c_0', 'a_c_1']), [['a_c_0', 'b_c_0']]);
});

test('per-sample files joined on their variants; what absence means is the user\'s choice', () => {
  const a = { name: 'input', variantColumn: 'variant', countColumns: ['count'], table: parseTable('variant\tcount\np.=\t100\np.Ser2Ala\t7\n') };
  const b = { name: 'output', variantColumn: 'variant', countColumns: ['count'], table: parseTable('variant\tcount\np.=\t90\np.Lys3Arg\t3\n') };
  const missing = joinCountTables([a, b]);
  assert.deepEqual(missing.table.columns.map((c) => c.name), ['variant', 'input', 'output']);
  assert.deepEqual(missing.table.columns[0].values, ['p.=', 'p.Ser2Ala', 'p.Lys3Arg']);
  assert.ok(Number.isNaN(missing.table.columns[2].numeric[1]), 'absent means missing by default');
  const zero = joinCountTables([a, b], { absentMeans: 'zero' });
  assert.equal(zero.table.columns[2].numeric[1], 0);
  assert.match(zero.problems.at(-1).message, /read as a count of 0/);
  const doubled = { ...a, table: parseTable('variant\tcount\np.=\t1\np.=\t2\n') };
  assert.equal(joinCountTables([doubled, b]).problems[0].code, 'duplicate-in-file');
});

test('kind names cover every kind', () => {
  assert.equal(KIND_NAMES.length, Object.keys(KIND).length);
});

test('columns with no values are not reported identical', () => {
  assert.deepEqual(identicalColumns({ rows: 0, columns: [{ name: 'a', values: [] }, { name: 'b', values: [] }] }, ['a', 'b']), []);
});
