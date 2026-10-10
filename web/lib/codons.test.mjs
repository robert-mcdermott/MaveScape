import assert from 'node:assert/strict';
import test from 'node:test';
import { codonsSource, combineCodons, proteinChange } from './codons.js';
import { parseTable, columnText } from './csv.js';
import { assembleTable } from './assemble.js';

// Hsp90's codons 582–590, as in the example.
const target = { id: 't', name: 'T', sequenceType: 'dna', sequence: 'CAATTTGGTTGGTCTGCTAATATGGAA', codingStart: 1 };

test('a coding variant\'s protein change: substitutions, synonymous codons, stops, the wild type, and what cannot be named', () => {
  assert.deepEqual(proteinChange('c.[1C>A;2=;3=]', target), { key: 'c.1C>A', protein: 'p.Gln1Lys' });
  assert.equal(proteinChange('c.[4T>G;5T>G;6T>A]', target).protein, 'p.Phe2Gly');
  assert.equal(proteinChange('c.6T>C', target).protein, 'p.Phe2=');
  assert.equal(proteinChange('c.[5T>A;6T>G]', target).protein, 'p.Phe2Ter');
  assert.equal(proteinChange('c.[1=;2=;3=]', target).protein, 'p.=');
  assert.equal(proteinChange('c.[1C>A;4T>G;5T>G]', target).protein, 'p.[Gln1Lys;Phe2Gly]');
  assert.match(proteinChange('c.1G>A', target).problem, /base 1 is C/);
  assert.match(proteinChange('c.4del', target).problem, /other than a substitution/);
  assert.match(proteinChange('p.Gln1Lys', target).problem, /not a coding/);
});

test('codon rows combined into protein variants: codons summed, a variant repeated with the same counts read once, with different counts a problem', () => {
  const table = parseTable([
    'hgvs_nt,a,b',
    'c.[1=;2=;3=],100,200',
    'c.[4=;5=;6=],100,200',
    'c.[1C>A;2=;3=],10,5',
    'c.[1C>A;2=;3A>G],7,NA',
    'c.6T>C,3,4',
    'c.4del,1,1',
  ].join('\n'));
  const out = combineCodons(table, { column: 'hgvs_nt', target });
  assert.deepEqual(columnText(out.table.columns[0]), ['p.=', 'p.Gln1Lys', 'p.Phe2=']);
  assert.deepEqual([...out.table.columns[1].numeric], [100, 17, 3]);
  assert.deepEqual([...out.table.columns[2].numeric], [200, 5, 4], 'a codon missing in a sample adds nothing; the others still count');
  assert.deepEqual(out.summary, { rows: 6, used: 4, variants: 3, copies: [{ key: 'c.=', rows: 2 }], unnamed: 1, conflicting: 0 });
  assert.ok(out.problems.some((p) => p.code === 'codons-copies' && /read once/.test(p.message)));
  assert.ok(out.problems.some((p) => p.code === 'codons-unnamed' && p.level === 'warning'));
  const conflict = combineCodons(parseTable('hgvs_nt,a\nc.=,100\nc.[1=;2=;3=],90\n'), { column: 'hgvs_nt', target });
  assert.ok(conflict.problems.some((p) => p.code === 'codons-conflict' && p.level === 'error'));
});

test('assembled at the protein level from a column of codons, and named by the design\'s derived column', () => {
  const files = [{ name: 'counts.csv', table: parseTable('hgvs_nt,hgvs_pro,a\nc.[1C>A;2=;3=],p.Gln1Lys,5\nc.=,p.Gln1=,9\nc.=,p.Phe2=,9\n'), role: 'counts' }];
  const out = assembleTable(files, { level: 'protein', target, codons: { from: 'hgvs_nt' } });
  assert.equal(out.kind, 'codons');
  assert.deepEqual(columnText(out.table.columns[0]), ['p.Gln1Lys', 'p.=']);
  assert.equal(codonsSource(out.table.columns[0].name), 'hgvs_nt');
  assert.equal(codonsSource('hgvs_pro (from nt_seq)'), null);
  assert.equal(assembleTable(files, { level: 'nucleotide', target, codons: { from: 'hgvs_nt' } }).kind, 'table', 'at the nucleotide level the rows stay codons');
});
