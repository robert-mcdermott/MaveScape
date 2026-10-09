import assert from 'node:assert/strict';
import test from 'node:test';
import { adjacent, formatHgvs, parseHgvs, positionLess, targetMismatches } from './hgvs.js';

const canonical = (s, mode) => {
  const v = parseHgvs(s, { mode });
  return v.ok ? v.canonical : `ERR ${v.error}`;
};

test('strict MAVE-HGVS: the forms of the specification parse and print back unchanged', () => {
  for (const s of ['p.Glu27Trp', 'p.Ter345Lys', 'p.Gly18del', 'p.His7_Gln8insSer', 'p.Cys22=', 'p.(=)', 'p.=', 'p.Glu27fs',
    'p.Cys22_Ala25=', 'p.[Ala2Val;Cys3=]', 'c.122-6T>A', 'c.*33G>C', 'c.-12_-10del', 'c.1_95del', 'c.83_85delinsT', 'c.=', 'c.1_3=',
    'n.12+3A>G', 'g.48C>A', 'r.22g>u', 'NM_007294.4:c.79A>T', 'c.[12A>G;15C>T]']) {
    assert.equal(canonical(s), s);
  }
});

test('strict MAVE-HGVS refuses what mavehgvs refuses, with its reasons', () => {
  assert.equal(canonical('p.A12V'), 'ERR failed regular expression validation');
  assert.equal(canonical('p.Ala12*'), 'ERR failed regular expression validation');
  assert.equal(canonical('_wt'), 'ERR failed regular expression validation');
  assert.equal(canonical('p.(Glu27Trp)'), 'ERR failed regular expression validation');
  assert.equal(canonical('p.[Glu32Val;Glu32Val]'), 'ERR multi-variant has multiple changes at same position');
  assert.equal(canonical('p.[Pro61Leu;=]'), 'ERR multi-variants cannot contain target-identical variants unless they are single amino acids');
  assert.equal(canonical('p.[Cys3=;Ala2Val]'), 'ERR multi-variants not in sorted order');
  assert.equal(canonical('g.25_24del'), 'ERR start position must be before end position');
  assert.equal(canonical('p.His7_Gln9insSer'), 'ERR insertion positions must be adjacent');
  assert.equal(canonical('p.[Glu27fs;Ala30Val]'), 'ERR no variants are permitted to follow a frame shift');
  assert.equal(canonical('n.12='), 'ERR failed regular expression validation');
  assert.equal(canonical('c.012A>G'), 'ERR failed regular expression validation');
});

test('lenient reading: lab and legacy forms, written in MAVE-HGVS, saying what changed', () => {
  const cases = {
    A12V: 'p.Ala12Val', 'p.A12V': 'p.Ala12Val', 'A12*': 'p.Ala12Ter', 'A12=': 'p.Ala12=', 'A12V G13D': 'p.[Ala12Val;Gly13Asp]',
    'G13D A12V': 'p.[Ala12Val;Gly13Asp]', 'p.Ala12*': 'p.Ala12Ter', 'p.(Glu27Trp)': 'p.Glu27Trp', _wt: 'p.=', _sy: 'p.(=)', WT: 'p.=',
    'p.[Glu32Val;Glu32Val;Val265Phe]': 'p.[Glu32Val;Val265Phe]', 'p.[Pro61Leu;=]': 'p.Pro61Leu', 'p.[Cys3=;Ala2Val]': 'p.[Ala2Val;Cys3=]',
    Ala12Val: 'p.Ala12Val', ' p.Ala12Val ': 'p.Ala12Val',
  };
  for (const [input, expected] of Object.entries(cases)) assert.equal(canonical(input, 'lenient'), expected, input);
  assert.equal(canonical('c.[1C>A;2=;3=]', 'lenient'), 'c.1C>A');
  assert.equal(parseHgvs('_wt', { mode: 'lenient', prefix: 'c' }).canonical, 'c.=');
  const v = parseHgvs('p.[Glu32Val;Glu32Val;Val265Phe]', { mode: 'lenient' });
  assert.deepEqual(v.changes, ['removed 1 repeated component']);
  assert.deepEqual(parseHgvs('p.Ala12Val', { mode: 'lenient' }).changes, [], 'valid names are not changed');
  // Still refused: X (any amino acid), a stop as the reference in one-letter form, nonsense.
  for (const s of ['A12X', '*12K', 'hello', 'p.Xaa12Val', '']) assert.equal(parseHgvs(s, { mode: 'lenient' }).ok, false, s);
});

test('positions order and adjacency as mavehgvs defines them', () => {
  const p = (position, extra = {}) => ({ position, utr: null, intron: null, aa: null, ...extra });
  assert.ok(positionLess(p(-5, { utr: true }), p(1)));
  assert.ok(positionLess(p(10), p(3, { utr: true })), "3' UTR after the coding sequence");
  assert.ok(positionLess(p(10, { intron: -2 }), p(10)));
  assert.ok(positionLess(p(10), p(10, { intron: 1 })));
  assert.ok(adjacent(p(7), p(8)));
  assert.ok(adjacent(p(-1, { utr: true }), p(1)));
  assert.ok(!adjacent(p(7), p(9)));
});

test('a variant against its target: positions in range and the reference residue or base', () => {
  const protein = 'MSKGEELFTG';
  assert.deepEqual(targetMismatches(parseHgvs('p.Ser2Ala'), protein), []);
  assert.match(targetMismatches(parseHgvs('p.Ala2Ser'), protein)[0].message, /has Ser at 2, not Ala/);
  assert.match(targetMismatches(parseHgvs('p.Gly11Ala'), protein)[0].message, /beyond the target \(10\)/);
  assert.deepEqual(targetMismatches(parseHgvs('p.(=)'), protein), []);
  assert.deepEqual(targetMismatches(parseHgvs('c.2T>C'), 'ATGGCC'), []);
  assert.match(targetMismatches(parseHgvs('c.2A>C'), 'ATGGCC')[0].message, /has T at 2, not A/);
  assert.deepEqual(targetMismatches(parseHgvs('c.122-6T>A'), 'ATG'), [], 'intronic positions are not in the target');
  assert.equal(formatHgvs(parseHgvs('p.[Ala2Val;Cys3=]')), 'p.[Ala2Val;Cys3=]');
});
