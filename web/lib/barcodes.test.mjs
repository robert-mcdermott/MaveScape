import assert from 'node:assert/strict';
import test from 'node:test';
import { applyBarcodeMap, barcodeColumnOf, dmsVariantsName, enrich2Name, headerlessMap, isDmsVariantsCounts, isEnrich2Counts, pivotDmsVariants } from './barcodes.js';
import { parseTable } from './csv.js';

test('dms_variants substitutions named in MAVE-HGVS', () => {
  assert.equal(dmsVariantsName('A2V'), 'p.Ala2Val');
  assert.equal(dmsVariantsName('A2V K3*'), 'p.[Ala2Val;Lys3Ter]');
  assert.equal(dmsVariantsName('', ''), 'p.=');
  assert.equal(dmsVariantsName('', 'GCT2GCC'), 'p.Ala2=');
  assert.equal(dmsVariantsName('', 'GCT2GCC CTG5CTC'), 'p.[Ala2=;Leu5=]');
  assert.equal(dmsVariantsName('A2-'), null, 'a deletion is not read');
});

test('a barcode map applied: conflicts left unmapped and listed, repeats and strays counted', () => {
  const counts = parseTable('barcode,pre,post\nAAAACCCC,10,5\nAAAAGGGG,3,9\nAAAATTTT,7,7\nCCCCAAAA,1,0\n');
  assert.equal(barcodeColumnOf(counts), 'barcode');
  const map = parseTable('bc,variant\nAAAACCCC,p.Ala2Val\nAAAAGGGG,p.Lys3Ter\nAAAAGGGG,p.Lys3Arg\nAAAACCCC,p.Ala2Val\nGGGGGGGG,p.=\n');
  const out = applyBarcodeMap(counts, 'barcode', map, 'bc', 'variant');
  assert.deepEqual(out.table.columns.at(-1).values, ['p.Ala2Val', '', '', '']);
  assert.equal(out.column, 'variant');
  assert.deepEqual(out.conflicts, [{ barcode: 'AAAAGGGG', library: undefined, variants: ['p.Lys3Ter', 'p.Lys3Arg'] }]);
  assert.deepEqual(out.unmapped, [2, 3]);
  assert.equal(out.repeats, 1);
  assert.equal(out.uncounted, 1);
  // Enrich2's map: two columns, no header.
  const enrich2 = headerlessMap(parseTable('AAAACCCC\tGCTGTT\nAAAAGGGG\tGCTGCT\n'));
  assert.deepEqual(enrich2.columns.map((c) => [c.name, c.values]), [['barcode', ['AAAACCCC', 'AAAAGGGG']], ['sequence', ['GCTGTT', 'GCTGCT']]]);
});

test('dms_variants variant counts: one row per library and barcode, a column per library and sample', () => {
  const long = parseTable([
    'library,sample,barcode,count,variant_call_support,codon_substitutions,aa_substitutions,n_codon_substitutions,n_aa_substitutions',
    'lib1,pre,AAAA,10,2,GCT2GTT,A2V,1,1',
    'lib1,post,AAAA,4,2,GCT2GTT,A2V,1,1',
    'lib1,pre,CCCC,8,1,,,0,0',
    'lib1,post,CCCC,9,1,,,0,0',
    'lib2,pre,AAAA,5,3,GCT2GCC,,1,0',
    'lib2,post,AAAA,6,3,GCT2GCC,,1,0',
  ].join('\n'));
  assert.ok(isDmsVariantsCounts(long));
  const out = pivotDmsVariants(long);
  const t = out.table;
  assert.equal(t.rows, 3);
  assert.deepEqual(t.columns.find((c) => c.name === 'barcode').values, ['lib1/AAAA', 'CCCC', 'lib2/AAAA']);
  assert.deepEqual(t.columns.find((c) => c.name === out.variantColumn).values, ['p.Ala2Val', 'p.=', 'p.Ala2=']);
  assert.deepEqual(out.samples.map((s) => [s.column, s.replicate]), [['pre (lib1)', 1], ['post (lib1)', 1], ['pre (lib2)', 2], ['post (lib2)', 2]]);
  assert.deepEqual([...t.columns.find((c) => c.name === 'pre (lib2)').numeric].map((x) => (Number.isNaN(x) ? null : x)), [null, null, 5]);
  assert.ok(out.problems.some((p) => p.code === 'barcodes-in-libraries'));
});

test('Enrich2\'s element names in MAVE-HGVS', () => {
  assert.equal(enrich2Name('p.Thr11Ala, p.Val14Leu'), 'p.[Thr11Ala;Val14Leu]');
  assert.equal(enrich2Name('c.33A>G (p.Thr11Ala), c.40G>T (p.=)'), 'p.Thr11Ala');
  assert.equal(enrich2Name('c.33A>G (p.Thr11Ala), c.40G>T (p.=)', 'nucleotide'), 'c.[33A>G;40G>T]');
  assert.equal(enrich2Name('c.33A>G (p.=)', 'protein', 'MSKGEELFTGT'), 'p.Thr11=');
  assert.equal(enrich2Name('c.33A>G (p.=)'), null, 'a synonymous change needs the target');
  assert.equal(enrich2Name('_wt'), '_wt');
  assert.equal(enrich2Name('n.12A>G', 'nucleotide'), 'n.12A>G');
  assert.equal(enrich2Name('ACGTACGT'), null);
  assert.ok(isEnrich2Counts(parseTable('\tcount\n_wt\t100\np.Thr11Ala\t5\n')));
});
