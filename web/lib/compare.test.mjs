import assert from 'node:assert/strict';
import test from 'node:test';
import { agreementOf, blandAltman, concordance, pearsonAgreement, spearmanAgreement } from './agreement.js';
import { compareSides, comparisonCSV, comparisonJSON, describeSide, MIN_MATCHED, scaleOf, sideOptions } from './compare.js';
import { KIND } from './variants.js';

const near = (a, b, tol = 1e-12) => assert.ok(Math.abs(a - b) <= tol, `${a} is not ${b}`);

test('agreement: identical scores agree perfectly; a doubled scale correlates but does not concord; a shift is the bias', () => {
  const x = Float64Array.from({ length: 50 }, (_, i) => Math.sin(i) * 2 + i / 25);
  const same = agreementOf(x, x);
  near(same.pearson.r, 1);
  near(same.concordance.ccc, 1);
  near(same.blandAltman.bias, 0);
  const doubled = agreementOf(x, x.map((v) => 2 * v));
  near(doubled.pearson.r, 1);
  near(doubled.concordance.scaleShift, 2);
  assert.ok(doubled.concordance.ccc < 0.9);
  const shifted = blandAltman(x, x.map((v) => v + 1));
  near(shifted.bias, -1);
  near(shifted.lower, -1);
  near(shifted.upper, -1);
  near(shifted.trend.slope, 0);
});

test('agreement: intervals hold the estimate; too few values give NaN, never an exception', () => {
  const x = Float64Array.from([0.1, 0.5, 0.2, 0.9, 1.4, 1.1, 2.0, 1.7]);
  const y = Float64Array.from([0.3, 0.4, 0.1, 1.0, 1.2, 1.5, 1.8, 2.1]);
  for (const s of [pearsonAgreement(x, y), spearmanAgreement(x, y), concordance(x, y)]) {
    const est = s.r ?? s.rho ?? s.ccc;
    assert.ok(s.low < est && est < s.high, JSON.stringify(s));
  }
  assert.ok(Number.isNaN(pearsonAgreement([1, 2, 3], [1, 2, 4]).low));
  assert.ok(Number.isNaN(concordance([1, 2], [1, 3]).ccc));
  assert.ok(Number.isNaN(blandAltman([1], [2]).sd));
  assert.ok(Number.isNaN(concordance([1, 1, 1], [1, 2, 3]).ccc));
});

// A run of protein variants with one condition and its replicates, for the report's rules.
const KEYS = Array.from({ length: 30 }, (_, i) => `p.Ala${i + 1}${['Val', 'Gly', 'Ter'][i % 3]}`);
function makeRun({ id = 'run-a', name = 'Run 1', sequence = 'A'.repeat(40), offset = 0, uniprot = null, direction = 'higher-more', model = 'ratio', table = 'a'.repeat(64), replicates = [['r1', 's0', 's1'], ['r2', 's2', 's3']], keys = KEYS, shift = 0, scale = 1 } = {}) {
  const n = keys.length + 1;
  const key = ['_wt', ...keys];
  const kind = Uint8Array.from(key, (k) => (k === '_wt' ? KIND.WT : k.endsWith('Ter') ? KIND.NONSENSE : KIND.MISSENSE));
  const base = (i) => (i ? Math.cos(i) * 1.5 - (kind[i] === KIND.NONSENSE ? 2 : 0) : 0);
  const reps = replicates.map(([rid], r) => ({
    id: rid, name: `Replicate ${r + 1}`, condition: null,
    score: Float64Array.from({ length: n }, (_, i) => base(i) * scale + shift + (r ? 0.1 * Math.sin(3 * i) : 0)),
    se: new Float64Array(n).fill(0.2),
    state: new Uint8Array(n),
  }));
  const results = {
    rows: n,
    variants: { key, original: key, kind, position: Int32Array.from(key, (k) => Number(/\d+/.exec(k)?.[0] ?? 0)), status: new Uint8Array(n) },
    replicates: reps,
    conditions: [{ id: 'all', name: 'All replicates', replicates: reps.map((r) => r.id), score: Float64Array.from({ length: n }, (_, i) => base(i) * scale + shift), se: new Float64Array(n).fill(0.1), reason: new Uint8Array(n), flags: new Uint8Array(n) }],
  };
  const design = {
    model: 'two-population',
    targets: [{ id: 't', name: 'Target', sequence, sequenceType: 'protein', offset, identifiers: uniprot ? { uniprot } : {} }],
    variants: { level: 'protein', column: 'hgvs_pro' },
    readout: { direction },
    replicates: replicates.map(([rid, input, output], r) => ({ id: rid, name: `Replicate ${r + 1}`, input, output })),
  };
  const output = { sha256: `${id}-out`, conditions: [{ id: 'all', name: 'All replicates', replicates: reps.map((r) => r.id) }], replicates: reps.map((r) => ({ id: r.id })) };
  const run = { id, name, inputs: { design, parameters: { model, normalization: 'wt', rescale: 'none' }, source: { sha256: table } }, output };
  return { run, results };
}
const side = (r, spec, ws = { sources: [] }) => describeSide(ws, r.run, r.results, { run: r.run.id, ...spec });

test('compare: a run\'s sides; two replicates with no sample in common, one scale, every statistic', () => {
  const r = makeRun();
  assert.deepEqual(sideOptions(r.run).map((o) => o.label), ['Run 1', 'Run 1: Replicate 1', 'Run 1: Replicate 2']);
  const c = compareSides(side(r, { replicate: 'r1' }), side(r, { replicate: 'r2' }));
  assert.equal(c.report.status, 'ok');
  assert.equal(c.matched.n, 30);
  assert.ok(c.statistics.concordance && c.statistics.blandAltman);
  assert.equal(c.x.length, 30);
});

test('compare: the report qualifies a shared sample, a replicate inside its condition, one table twice', () => {
  const shared = makeRun({ replicates: [['r1', 's0', 's1'], ['r2', 's0', 's2']] });
  const c = compareSides(side(shared, { replicate: 'r1' }), side(shared, { replicate: 'r2' }));
  assert.equal(c.report.status, 'qualified');
  assert.match(c.report.items.find((i) => i.id === 'independence').text, /share the sample s0/);
  const inside = compareSides(side(shared, { condition: 0 }), side(shared, { replicate: 'r1' }));
  assert.match(inside.report.items.find((i) => i.id === 'independence').text, /one of the replicates combined into/);
  const again = makeRun({ id: 'run-b', name: 'Run 2' });
  const twice = compareSides(side(shared, { condition: 0 }), side(again, { condition: 0 }));
  assert.match(twice.report.items.find((i) => i.id === 'independence').text, /One table scored twice/);
  assert.ok(twice.statistics.concordance, 'one scale: the same model and normalization');
});

test('compare: itself, different targets with no reference, too few in common: blocked, no statistics', () => {
  const r = makeRun();
  assert.equal(compareSides(side(r, { condition: 0 }), side(r, { condition: 0 })).report.status, 'blocked');
  const other = makeRun({ id: 'run-b', sequence: 'G'.repeat(40), table: 'b'.repeat(64) });
  const c = compareSides(side(r, { condition: 0 }), side(other, { condition: 0 }));
  assert.equal(c.report.status, 'blocked');
  assert.equal(c.statistics, null);
  assert.match(c.report.items.at(-1).text, /no common reference/);
  const few = makeRun({ id: 'run-c', table: 'c'.repeat(64), keys: KEYS.slice(0, MIN_MATCHED - 1) });
  assert.match(compareSides(side(r, { condition: 0 }), side(few, { condition: 0 })).report.items.at(-1).text, /too few to compare/);
});

test('compare: one UniProt entry at two offsets, matched on its coordinates', () => {
  // A's residue i is the entry's i + 100; B's target starts 5 residues later in the entry (offset
  // 105), so B's residue i is A's i + 5.
  const a = makeRun({ uniprot: 'P12345', offset: 100 });
  const bKeys = KEYS.map((k) => k.replace(/\d+/, (p) => String(Number(p) - 5))).filter((k) => !/Ala-?\d+/.test(k) || Number(/-?\d+/.exec(k)[0]) >= 1);
  const b = makeRun({ id: 'run-b', sequence: 'A'.repeat(35), uniprot: 'P12345-1', offset: 105, table: 'b'.repeat(64), keys: bKeys });
  const c = compareSides(side(a, { condition: 0 }), side(b, { condition: 0 }));
  assert.equal(c.coordinates, 'reference');
  assert.equal(c.report.items.find((i) => i.id === 'target').status, 'qualified');
  assert.equal(c.matched.n, bKeys.length);
  assert.ok(c.keys.every((k) => Number(/\d+/.exec(k)[0]) > 100));
});

test('compare: opposite directions negate the second side; published scores are compared by correlation only', () => {
  const a = makeRun();
  const b = makeRun({ id: 'run-b', direction: 'higher-less', table: 'b'.repeat(64), scale: -1 });
  const c = compareSides(side(a, { condition: 0 }), side(b, { condition: 0 }));
  assert.equal(c.flipped, true);
  near(c.statistics.pearson.r, 1);
  assert.deepEqual(c.withheld, ['concordance', 'blandAltman']);
  const published = makeRun({ id: 'run-p', name: 'Published scores', model: 'published', table: 'p'.repeat(64), scale: 3, shift: 1 });
  assert.equal(scaleOf(side(published, { condition: 0 })).known, false);
  const p = compareSides(side(a, { condition: 0 }), side(published, { condition: 0 }));
  assert.equal(p.report.items.find((i) => i.id === 'scale').status, 'qualified');
  near(p.statistics.pearson.r, 1);
  assert.equal(p.statistics.concordance, null);
});

test('compare: the matched variants and the record as files', () => {
  const r = makeRun();
  const c = compareSides(side(r, { replicate: 'r1' }), side(r, { replicate: 'r2' }));
  const csv = comparisonCSV(c).trim().split('\n');
  assert.equal(csv[0], 'variant,variant_a,variant_b,class,score_a,SE_a,score_b,SE_b,difference,mean');
  assert.equal(csv.length, 31);
  const json = JSON.parse(comparisonJSON(c, { version: '0.4.0' }));
  assert.equal(json.format, 'mavescape-comparison');
  assert.equal(json.a.output, 'run-a-out');
  assert.equal(json.matched.n, 30);
  assert.equal(json.report.status, 'ok');
  near(json.statistics.pearson.r, c.statistics.pearson.r);
});
