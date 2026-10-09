import assert from 'node:assert/strict';
import test from 'node:test';
import { CODONS, parseFasta, placeInReference, sequenceType, targetFromSequence, targetProtein, translate } from './target.js';

test('the genetic code: 64 codons, 3 stops, 61 sense, every amino acid', () => {
  const values = Object.values(CODONS);
  assert.equal(values.length, 64);
  assert.equal(values.filter((a) => a === '*').length, 3);
  assert.equal(new Set(values.filter((a) => a !== '*')).size, 20);
  assert.equal(CODONS.ATG, 'M');
  assert.equal(CODONS.TGG, 'W');
  assert.equal(CODONS.TGA, '*');
});

test('FASTA: several records, wrapped lines, numbered listings, a pasted sequence without a header', () => {
  const records = parseFasta('>sp|P62993|GRB2_HUMAN Growth factor receptor-bound protein 2\nMEAIAKYDFK\nATADDELSF\r\n>tile2 second tile\n  1 acgt acgt\n 11 tt\n');
  assert.equal(records.length, 2);
  assert.equal(records[0].id, 'sp|P62993|GRB2_HUMAN');
  assert.equal(records[0].description, 'Growth factor receptor-bound protein 2');
  assert.equal(records[0].sequence, 'MEAIAKYDFKATADDELSF');
  assert.equal(records[1].sequence, 'ACGTACGTTT');
  assert.deepEqual(parseFasta('mskgee\nlftg'), [{ id: '', description: '', sequence: 'MSKGEELFTG' }]);
});

test('sequence type and translation', () => {
  assert.equal(sequenceType('acgtACGT').type, 'dna');
  assert.equal(sequenceType('MSKGEELFTG').type, 'protein');
  assert.deepEqual(sequenceType('MSK1J').invalid, ['1', 'J']);
  assert.deepEqual(translate('ATGGCCTAAGG'), { protein: 'MA*', stops: [], partial: 2 });
  assert.deepEqual(translate('ATGTAAGCCGGG').stops, [2]);
  assert.equal(translate('xxATGGCC', 3).protein, 'MA');
});

test('a target from a record: type, identifiers, and problems a person should see', () => {
  const grb2 = targetFromSequence(parseFasta('>sp|P62993|GRB2_HUMAN GRB2\nTYVQALFDF')[0]);
  assert.equal(grb2.target.sequenceType, 'protein');
  assert.deepEqual(grb2.target.identifiers, { uniprot: 'P62993' });
  assert.equal(grb2.target.id, 'sp_P62993_GRB2_HUMAN');
  const dna = targetFromSequence({ id: 'brca1', description: '', sequence: 'GATTTATCTGCTCTTCGCGTTTAA' });
  assert.equal(dna.target.codingStart, 1);
  assert.equal(targetProtein(dna.target), 'DLSALRV*');
  assert.deepEqual(dna.messages, []);
  const framed = targetFromSequence({ id: 'x', description: '', sequence: 'ATGTAAGCCGG' });
  assert.deepEqual(framed.messages.map((m) => m.level), ['warning', 'warning']);
  assert.equal(targetFromSequence({ id: 'n', description: '', sequence: 'ACGTN' }).messages[0].level, 'error');
});

test('placing a target in its reference protein finds the offset and the differences', () => {
  // BRCA1: the construct starts at residue 2 and has Arg where UniProt has Lys at 175.
  const reference = 'MDLSALRVEEVQNVINAMQKILECPICLEL';
  assert.deepEqual(placeInReference('DLSALRVEE', reference), { offset: 1, differences: [] });
  assert.deepEqual(placeInReference('DLSALRVEEVQRVINA', reference), { offset: 1, differences: [{ position: 12, target: 'R', reference: 'N' }] });
  assert.equal(placeInReference('WWWWWWWW', reference), null);
});
