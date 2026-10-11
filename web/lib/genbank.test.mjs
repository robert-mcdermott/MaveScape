import assert from 'node:assert/strict';
import test from 'node:test';
import { codingFeatures, looksLikeGenBank, parseGenBank, parseLocation, preferredFeature, targetFromGenBank, targetOriginText } from './genbank.js';

// A small construct map, as a map tool exports it: a tagged coding sequence on the forward strand
// and a resistance gene on the reverse strand, of a circular plasmid.
const PLASMID = `LOCUS       pTEST                     60 bp    DNA     circular SYN 01-JAN-2026
DEFINITION  Test plasmid pTEST.
ACCESSION   pTEST
VERSION     pTEST
SOURCE      synthetic construct
  ORGANISM  synthetic construct
FEATURES             Location/Qualifiers
     source          1..60
     CDS             4..21
                     /gene="tag"
                     /product="a tagged
                     peptide"
                     /codon_start=1
                     /translation="MAKKG"
     CDS             complement(31..48)
                     /label=resistance
                     /translation="MSQAV"
ORIGIN
        1 cccatggcta aaaaaggctg aggggggggg ttacaccgcc tgcgacatgg gggggggggg
//
`;

test('a record\'s fields, features, qualifiers (quoted, over several lines) and sequence', () => {
  assert.equal(looksLikeGenBank(PLASMID), true);
  assert.equal(looksLikeGenBank('>seq\nACGT'), false);
  const { records, problems } = parseGenBank(PLASMID);
  assert.deepEqual(problems, []);
  const r = records[0];
  assert.deepEqual([r.name, r.length, r.molecule, r.topology, r.accession, r.organism, r.definition], ['pTEST', 60, 'DNA', 'circular', 'pTEST', 'synthetic construct', 'Test plasmid pTEST']);
  assert.equal(r.sequence.length, 60);
  assert.deepEqual(r.features.map((f) => f.type), ['source', 'CDS', 'CDS']);
  assert.equal(r.features[1].qualifiers.product, 'a tagged peptide');
  assert.equal(r.features[1].qualifiers.translation, 'MAKKG');
});

test('locations: ranges, partial ends, complement, join and order; one on another record refused', () => {
  assert.deepEqual(parseLocation('4..21'), [{ start: 4, end: 21, strand: 1, partialStart: false, partialEnd: false }]);
  assert.deepEqual(parseLocation('<1..>30').map((p) => [p.partialStart, p.partialEnd]), [[true, true]]);
  assert.deepEqual(parseLocation('complement(join(1..5,10..20))').map((p) => [p.start, p.end, p.strand]), [[10, 20, -1], [1, 5, -1]], 'read on the reverse strand: the last part first');
  assert.deepEqual(parseLocation('join(complement(10..20),complement(1..5))').map((p) => [p.start, p.end, p.strand]), [[10, 20, -1], [1, 5, -1]]);
  assert.deepEqual(parseLocation('order(1..3, 7..9)').length, 2);
  assert.throws(() => parseLocation('J00194.1:100..202'), /another record/);
  assert.throws(() => parseLocation('join(1..5'), /not closed/);
});

test('coding features, each translated and checked against the record\'s own; the one to offer first', () => {
  const r = parseGenBank(PLASMID).records[0];
  const coding = codingFeatures(r);
  assert.deepEqual(coding.map((c) => [c.label, c.length, c.protein, c.check.status]), [['tag: a tagged peptide', 18, 'MAKKG*', 'identical'], ['resistance', 18, 'MSQAV*', 'identical']]);
  assert.equal(preferredFeature(coding), coding[0], 'the longest whose translation checks (the first of equals)');
  const altered = parseGenBank(PLASMID.replace('/translation="MAKKG"', '/translation="MAKRG"')).records[0];
  assert.match(codingFeatures(altered)[0].check.message, /differs from the record's translation from residue 4/);
});

test('a target from a coding feature: a plasmid\'s is its coding sequence, read on its strand; an mRNA\'s the whole record', () => {
  const r = parseGenBank(PLASMID).records[0];
  const [forward, reverse] = codingFeatures(r);
  const a = targetFromGenBank(r, forward, { file: 'pTEST.gb' });
  assert.deepEqual([a.target.sequence, a.target.codingStart, a.target.id, a.target.identifiers], ['ATGGCTAAAAAAGGCTGA', 1, 'tag', { gene: 'tag', genbank: 'pTEST' }]);
  assert.equal(a.origin.whole, false);
  assert.match(targetOriginText(a.origin), /^The coding sequence \(4\.\.21\) of the GenBank record pTEST, from pTEST\.gb \(tag: a tagged peptide\); its translation is the record's\.$/);
  const b = targetFromGenBank(r, reverse);
  assert.equal(b.target.sequence, 'ATGTCGCAGGCGGTGTAA', 'the reverse strand, read 5′ to 3′');
  const mrna = parseGenBank(PLASMID.replace('DNA     circular', 'mRNA    linear').replace('ACCESSION   pTEST', 'ACCESSION   NM_000001').replace('VERSION     pTEST', 'VERSION     NM_000001.1')).records[0];
  const m = targetFromGenBank(mrna, codingFeatures(mrna)[0]);
  assert.deepEqual([m.target.sequence.length, m.target.codingStart, m.target.identifiers.refseq, m.origin.whole], [60, 4, 'NM_000001.1', true]);
  // The organism's NCBI Taxonomy id, from the source feature (wave 3, slice 4).
  assert.equal(a.target.taxonomyId, undefined);
  const tagged = parseGenBank(PLASMID.replace('     source          1..60\n', '     source          1..60\n                     /db_xref="taxon:32630"\n')).records[0];
  assert.equal(targetFromGenBank(tagged, codingFeatures(tagged)[0]).target.taxonomyId, 32630);
});

test('records that cannot be read say why', () => {
  assert.match(parseGenBank('hello').problems[0], /begins with a LOCUS line/);
  assert.match(parseGenBank(PLASMID.replace('60 bp', '61 bp')).problems[0], /says 61 bases and its sequence has 60/);
});
