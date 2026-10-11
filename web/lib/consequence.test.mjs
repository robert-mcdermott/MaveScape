import assert from 'node:assert/strict';
import test from 'node:test';
import { codingFrame, consequenceOf, nucleotideMismatches } from './consequence.js';
import { parseHgvs } from './hgvs.js';

// A transcript: a 5′ UTR of three bases, M A K K G W and a stop, a 3′ UTR of three.
const target = { id: 't', name: 'T', sequenceType: 'dna', sequence: 'GGGATGGCTAAAAAAGGCTGGTAACCC', codingStart: 4 };
const frame = codingFrame(target);
const of = (name) => consequenceOf(parseHgvs(name, { mode: 'lenient' }), frame);
const named = (name) => {
  const c = of(name);
  return [c.class, c.protein];
};

test('the coding frame: from the coding start to the first stop, the UTRs on either side', () => {
  assert.equal(frame.protein, 'MAKKGW*');
  assert.deepEqual([frame.start, frame.end, frame.stop], [3, 24, true]);
  assert.equal(codingFrame({ sequenceType: 'protein', sequence: 'MAK' }), null);
});

test('substitutions: missense, synonymous, nonsense, start and stop lost, several codons', () => {
  assert.deepEqual(named('c.4G>T'), ['missense', 'p.Ala2Ser']);
  assert.deepEqual(named('c.6T>C'), ['synonymous', 'p.Ala2=']);
  assert.deepEqual(named('c.1A>G'), ['start lost', 'p.Met1Val']);
  assert.deepEqual(named('c.19T>A'), ['stop lost', 'p.Ter7Lys']);
  assert.deepEqual(named('c.20A>G'), ['synonymous', 'p.Ter7=']);
  assert.deepEqual(named('c.16T>A'), ['missense', 'p.Trp6Arg']);
  assert.deepEqual(named('c.17G>A'), ['nonsense', 'p.Trp6Ter']);
  assert.deepEqual(named('c.[4G>T;5C>A]'), ['missense', 'p.Ala2Tyr'], 'two bases of one codon: one amino acid');
  assert.deepEqual(named('c.[6T>C;9A>G]'), ['synonymous', 'p.[Ala2=;Lys3=]']);
  assert.deepEqual(named('c.[4G>T;10A>G]'), ['multi-variant', 'p.[Ala2Ser;Lys4Glu]']);
  assert.deepEqual(named('c.[1A>G;4G>T]'), ['start lost', null], 'a change of the start codon among others: start lost, unnamed');
  // Changes after a stop the variant makes are not made, nor named.
  assert.deepEqual(named('c.[10A>T;17G>C]'), ['nonsense', 'p.Lys4Ter']);
  assert.deepEqual(named('c.[4G>T;10A>T;17G>C]'), ['multi-variant', 'p.[Ala2Ser;Lys4Ter]']);
});

test('deletions, insertions, duplications and deletion-insertions, as HGVS names them', () => {
  assert.deepEqual(named('c.7_9del'), ['deletion', 'p.Lys4del'], 'the 3′-most of a repeat');
  assert.deepEqual(named('c.10_12dup'), ['duplication', 'p.Lys4dup']);
  assert.deepEqual(named('c.13_15dup'), ['duplication', 'p.Gly5dup']);
  assert.deepEqual(named('c.8_9insGGG'), ['insertion', 'p.Lys3_Lys4insGly']);
  assert.deepEqual(named('c.4_5delinsTA'), ['missense', 'p.Ala2Tyr']);
  assert.deepEqual(named('c.16_18del'), ['nonsense', 'p.Trp6Ter'], 'a deletion up to the stop: the stop where it was');
  assert.deepEqual(named('c.10_11insTAA'), ['insertion', 'p.Lys3_Lys4insIle']);
  // A stop inside an insertion is named, and nothing after it.
  assert.deepEqual(named('c.9_10insGAGTAAGAG'), ['insertion', 'p.Lys3_Lys4insGluTer']);
});

test('frameshifts are named short, at the first amino acid they change; an immediate stop is nonsense', () => {
  assert.deepEqual(named('c.6del'), ['frameshift', 'p.Gly5fs']);
  assert.deepEqual(named('c.6_7insG'), ['frameshift', 'p.Lys3fs']);
  assert.deepEqual(named('c.9_10insC'), ['frameshift', 'p.Lys4fs']);
  assert.deepEqual(named('c.9_10insT'), ['nonsense', 'p.Lys4Ter'], 'a frameshift whose first new codon is a stop');
});

test('UTRs, introns, splice sites and the wild type', () => {
  assert.deepEqual(named('c.-1G>A'), ['5\' UTR', null]);
  assert.deepEqual(named('c.*1C>T'), ['3\' UTR', null]);
  assert.deepEqual(named('c.-2_2del'), ['start lost', null], 'a deletion from the 5′ UTR into the first codon');
  assert.deepEqual(named('c.12+1G>A'), ['splice site', null]);
  assert.deepEqual(named('c.12+6G>A'), ['intronic', null]);
  assert.deepEqual(named('c.12_12+3del'), ['splice site', null], 'across an exon\'s edge');
  assert.deepEqual(named('c.='), ['wild type', 'p.=']);
  assert.deepEqual(named('c.-10A>G'), ['5\' UTR', null], 'beyond what the target holds: a UTR variant all the same');
  assert.deepEqual(named('c.1180_1182dup'.replace('1180_1182', '19_21')), ['synonymous', 'p.='], 'a duplicated stop changes no amino acid');
});

test('DiMSum\'s mixed substitutions: a codon changed to another amino acid and another left synonymous', () => {
  const c = of('c.[4G>T;9A>G]');
  assert.deepEqual([c.class, c.protein, c.codons, c.changed, c.mixed], ['missense', 'p.Ala2Ser', 2, 1, true]);
  assert.equal(of('c.4G>T').mixed, false);
});

test('a construct whose first codon is no methionine: a change there is not a start lost', () => {
  const construct = codingFrame({ sequenceType: 'dna', sequence: 'ACCTATGTGCAG', codingStart: 1 });
  const c = consequenceOf(parseHgvs('c.1A>G'), construct);
  assert.deepEqual([c.class, c.protein], ['missense', 'p.Thr1Ala']);
});

test('nucleotide names against the target: bases, the coding numbering, UTRs it does not hold', () => {
  const check = (name) => nucleotideMismatches(parseHgvs(name), frame).map((p) => p.message);
  assert.deepEqual(check('c.4G>T'), []);
  assert.match(check('c.4A>T')[0], /the target has G at 4, not A/);
  assert.match(check('c.30A>T')[0], /beyond the target/);
  assert.match(check('c.22C>T')[0], /after the stop codon \(c\.21\): it is written c\.\*1/);
  assert.deepEqual(check('c.-3G>A'), []);
  assert.deepEqual(check('c.-9G>A'), [], 'a 5′ UTR position beyond the target is not checked');
  assert.match(check('c.-3C>A')[0], /the target has G at -3, not C/);
  assert.deepEqual(check('c.12+1G>A'), [], 'intronic: not in the target, not checked');
});
