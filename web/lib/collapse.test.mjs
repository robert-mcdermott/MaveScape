import assert from 'node:assert/strict';
import test from 'node:test';
import { mean, proteinView } from './collapse.js';
import { buildVariants, KIND, KIND_NAMES } from './variants.js';

// M A K K G W *: nucleotide variants, some making the same protein change.
const target = { id: 't', name: 'T', sequenceType: 'dna', sequence: 'ATGGCTAAAAAAGGCTGGTAA', codingStart: 1 };
const names = ['c.=', 'c.4G>T', 'c.[4G>T;6T>A]', 'c.[4G>T;5C>A]', 'c.6T>C', 'c.6T>A', 'c.[4G>T;9A>G]', 'c.6del', 'c.7_9del', 'c.*1C>T'];

function results(score, se, reason = new Uint8Array(names.length)) {
  const variants = buildVariants(names, { level: 'nucleotide', target });
  const n = names.length;
  return {
    rows: n,
    variants,
    controls: { wt: 0 },
    replicates: [{ id: 'r1', state: new Uint8Array(n), first: Float64Array.from(names, (_, i) => 10 * (i + 1)), last: new Float64Array(n), score: new Float64Array(n), se: new Float64Array(n) }],
    samples: [],
    conditions: [{ id: 'c', name: 'C', replicates: ['r1'], score: Float64Array.from(score), se: Float64Array.from(se), k: new Uint8Array(n).fill(2), expected: new Uint8Array(n).fill(2), reason, flags: new Uint8Array(n), tau2: new Float64Array(n), i2: new Float64Array(n), loo: new Float64Array(n) }],
    differential: null,
  };
}

test('nucleotide variants making one protein change are one protein variant, merged as DiMSum merges them', () => {
  const r = results([0, -1, -1.2, -0.8, 0.1, -0.1, -1, -2, -1.5, 0.05], [0.1, 0.2, 0.4, 0.2, 0.1, 0.1, 0.3, 0.2, 0.2, 0.1]);
  const view = proteinView(r);
  assert.equal(proteinView(r), view, 'computed once per results');
  assert.deepEqual(view.variants.key, ['p.=', 'p.Ala2Ser', 'p.Ala2Tyr', 'p.Ala2=', 'p.Lys4del']);
  assert.deepEqual(view.variants.members.map((m) => [...m]), [[0], [1, 2], [3], [4, 5], [8]]);
  // Ala2Ser from c.4G>T and c.[4G>T;6T>A] (GCT → TCT, TCA): 1/SE² weights.
  const w1 = 1 / 0.04;
  const w2 = 1 / 0.16;
  assert.ok(Math.abs(view.conditions[0].score[1] - (-1 * w1 + -1.2 * w2) / (w1 + w2)) < 1e-15);
  assert.ok(Math.abs(view.conditions[0].se[1] - Math.sqrt(1 / (w1 + w2))) < 1e-15);
  // Synonymous codons merged into the reference cell's variant; the wild type itself apart.
  assert.equal(view.variants.kind[3], KIND.SYNONYMOUS);
  assert.deepEqual([view.controls.wt, view.variants.key[0]], [0, 'p.=']);
  // Counts summed, positions and residues from the protein change.
  assert.equal(view.replicates[0].first[1], 20 + 30);
  assert.deepEqual([view.variants.position[2], view.variants.level], [2, 'protein']);
  // Mixed (a missense codon and a synonymous one), a frameshift and a UTR variant are not merged.
  assert.deepEqual([view.collapse.mixed, view.collapse.unmerged, view.collapse.merged, view.collapse.mergedFrom], [1, 2, 2, 4]);
  assert.deepEqual(names.map((_, i) => KIND_NAMES[r.variants.kind[i]]).slice(6), ['missense', 'frameshift', 'deletion', '3\' UTR']);
});

test('members not scored are left out; a protein variant none of whose members is scored has no score', () => {
  const reason = new Uint8Array(names.length);
  reason[1] = 5;
  reason[4] = 1;
  reason[5] = 1;
  const view = proteinView(results([0, -1, -1.2, -0.8, 0.1, -0.1, -1, -2, -1.5, 0.05], [0.1, 0.2, 0.4, 0.2, 0.1, 0.1, 0.3, 0.2, 0.2, 0.1], reason));
  assert.deepEqual([view.conditions[0].score[1], view.conditions[0].se[1], view.conditions[0].reason[1]], [-1.2, 0.4, 0]);
  assert.ok(Number.isNaN(view.conditions[0].score[3]));
  assert.equal(view.conditions[0].reason[3], 1);
});

test('without every SE, the plain mean, its SE unknown', () => {
  assert.deepEqual(mean([1, 2], [Number.NaN, 0.1]).score, 1.5);
  assert.ok(Number.isNaN(mean([1, 2], [Number.NaN, 0.1]).se));
  assert.deepEqual(mean([3], [0.5]), { score: 3, se: 0.5 });
});

test('a protein-level run has no protein view', () => {
  assert.equal(proteinView({ variants: { key: [] }, rows: 0 }), null);
});
