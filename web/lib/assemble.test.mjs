import assert from 'node:assert/strict';
import test from 'node:test';
import { assembleTable, looksLikeMap } from './assemble.js';
import { parseTable } from './csv.js';
import { detectLayout, reviewImport } from './importer.js';

const target = { id: 't', name: 'T', sequenceType: 'dna', sequence: 'ATGGCTAAACTG' }; // M A K L

test('a table of barcode counts and its map: the variants named, conflicts left unmapped', () => {
  const counts = parseTable('barcode,pre_rep1,post_rep1\nAAAACCCC,10,5\nAAAAGGGG,3,9\nAAAATTTT,7,7\n');
  const map = parseTable('barcode,hgvs_pro\nAAAACCCC,p.Ala2Val\nAAAAGGGG,p.Lys3Ter\nAAAAGGGG,p.Lys3Arg\n');
  assert.ok(looksLikeMap(map));
  assert.ok(!looksLikeMap(counts));
  const out = assembleTable([{ name: 'counts.csv', table: counts, role: 'counts' }, { name: 'map.csv', table: map, role: 'map' }]);
  assert.deepEqual(out.table.columns.map((c) => c.name), ['barcode', 'pre_rep1', 'post_rep1', 'hgvs_pro']);
  assert.equal(out.map.conflicts.length, 1);
  assert.deepEqual(out.problems.map((p) => p.code), ['map-conflicts', 'map-unmapped']);
  const layout = detectLayout(out.table);
  assert.equal(layout.layout, 'barcodes');
  assert.equal(layout.barcodeColumn, 'barcode');
  assert.equal(layout.variantColumn, 'hgvs_pro');
  assert.deepEqual(layout.countColumns, ['pre_rep1', 'post_rep1']);
});

test('Enrich2: per-library counts of barcodes joined, its headerless map of sequences named against the target', () => {
  const pre = parseTable('\tcount\nAAAACCCC\t10\nAAAAGGGG\t3\n');
  const post = parseTable('\tcount\nAAAACCCC\t5\nAAAATTTT\t2\n');
  const map = parseTable('AAAACCCC\tATGGTTAAACTG\nAAAAGGGG\tATGGCTAAACTG\nAAAATTTT\tATGGCTTAACTG\n');
  assert.ok(looksLikeMap(map));
  const out = assembleTable([{ name: 'pre.tsv', table: pre, role: 'counts' }, { name: 'post.tsv', table: post, role: 'counts' }, { name: 'map.txt', table: map, role: 'map' }], { target });
  assert.equal(out.kind, 'enrich2');
  const named = out.table.columns.at(-1);
  assert.equal(named.name, 'hgvs_pro (from sequence)');
  assert.deepEqual(named.values, ['p.Ala2Val', 'p.=', 'p.Lys3Ter']);
  assert.ok(Number.isNaN(out.table.columns.find((c) => c.name === 'pre').numeric[2]), 'absent from a file: missing');
  // Enrich2's counts of variants: named in MAVE-HGVS.
  const variants = assembleTable([{ name: 'a.tsv', table: parseTable('\tcount\n_wt\t100\nc.5C>T (p.Ala2Val)\t7\n'), role: 'counts' }, { name: 'b.tsv', table: parseTable('\tcount\n_wt\t90\nc.5C>T (p.Ala2Val)\t3\n'), role: 'counts' }]);
  assert.deepEqual(variants.table.columns.at(-1).values, ['_wt', 'p.Ala2Val']);
  assert.equal(detectLayout(variants.table).variantColumn, 'hgvs_pro (from Enrich2)');
});

test('dms_variants\' variant_counts: one row per barcode, a design-ready layout', () => {
  const long = parseTable('library,sample,barcode,count,variant_call_support,codon_substitutions,aa_substitutions,n_codon_substitutions,n_aa_substitutions\nlib1,pre,AAAACCCC,10,2,GCT2GTT,A2V,1,1\nlib1,post,AAAACCCC,4,2,GCT2GTT,A2V,1,1\n');
  const out = assembleTable([{ name: 'variant_counts.csv', table: long, role: 'counts' }]);
  assert.equal(out.kind, 'dms-variants');
  const layout = detectLayout(out.table);
  assert.equal(layout.layout, 'barcodes');
  assert.equal(layout.variantColumn, 'hgvs_pro (from aa_substitutions)');
  assert.deepEqual(layout.countColumns, ['pre (lib1)', 'post (lib1)']);
});

test('the review of a table of barcodes: variants grouped, a repeated barcode blocks', () => {
  const t = parseTable('barcode,v,pre,post\nAAAACCCC,p.Ala2Val,10,5\nAAAAGGGG,A2V,3,9\nAAAATTTT,,7,7\nAAAACCCC,p.Lys3Ter,1,1\n');
  const review = reviewImport(t, { variantColumn: 'v', barcodeColumn: 'barcode', countColumns: ['pre', 'post'] });
  assert.equal(review.summary.total, 2);
  assert.deepEqual(review.summary.barcodes, { rows: 4, unmapped: 1, perVariant: 1.5 });
  assert.deepEqual([...review.variantOfRow], [0, 0, -1, 1]);
  assert.deepEqual(review.blocking.map((b) => b.code), ['duplicate-barcodes']);
  assert.match(review.blocking[0].message, /lines 2, 5/);
});
