import assert from 'node:assert/strict';
import test from 'node:test';
import { agreementOf, aucAgreement, blandAltman, concordance, pearsonAgreement, spearmanAgreement } from './agreement.js';
import { classesCSV, compareSides, comparisonCSV, comparisonJSON, describePredictor, describeScoreSet, describeSide, differenceMap, MIN_MATCHED, MIN_POSITION_VARIANTS, positionsCSV, scaleOf, sideMap, sideOptions } from './compare.js';
import { MISSENSE_CLASSES } from './tracks.js';
import { setScoreSetDirection } from './workspace.js';
import { buildMapModel, STATE } from './map-model.js';
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
    first: Float64Array.from({ length: n }, (_, i) => 5 + 10 * (i % 4)),
  }));
  const results = {
    rows: n,
    controls: { wt: 0, synonymous: 0, nonsense: 10 },
    variants: { key, original: key, kind, position: Int32Array.from(key, (k) => Number(/\d+/.exec(k)?.[0] ?? 0)), status: new Uint8Array(n), ref: new Uint8Array(n).fill(1), alt: Uint8Array.from(key, (k) => 1 + 'ARNDCQEGHILKMFPSTWYV*'.indexOf({ Val: 'V', Gly: 'G', Ter: '*' }[k.slice(-3)] ?? 'A')) },
    replicates: reps,
    conditions: [{ id: 'all', name: 'All replicates', replicates: reps.map((r) => r.id), score: Float64Array.from({ length: n }, (_, i) => base(i) * scale + shift), se: Float64Array.from({ length: n }, (_, i) => (i % 5 === 0 ? 0.5 : 0.1)), reason: new Uint8Array(n), flags: Uint8Array.from({ length: n }, (_, i) => (i % 7 === 0 ? 1 : 0)) }],
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
  assert.deepEqual(c.withheld, ['concordance', 'blandAltman', 'discordance', 'positions']);
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
  assert.equal(csv[0], 'variant,variant_a,variant_b,class,score_a,SE_a,score_b,SE_b,compared_a,compared_b,difference,mean,z,p,q');
  assert.equal(csv.length, 31);
  const json = JSON.parse(comparisonJSON(c, { version: '0.4.0' }));
  assert.equal(json.format, 'mavescape-comparison');
  assert.equal(json.a.output, 'run-a-out');
  assert.equal(json.matched.n, 30);
  assert.equal(json.report.status, 'ok');
  near(json.statistics.pearson.r, c.statistics.pearson.r);
});

test('compare: filters leave out low confidence, a large SE and few reads on either side, saying how many', () => {
  const a = makeRun();
  const b = makeRun({ id: 'run-b', table: 'b'.repeat(64), shift: 0.05 });
  const all = compareSides(side(a, { condition: 0 }), side(b, { condition: 0 }));
  const low = compareSides(side(a, { condition: 0 }), side(b, { condition: 0 }), { filters: { lowConfidence: true } });
  const flagged = all.rows.filter(([i, j]) => all.values.a.flags[i] || all.values.b.flags[j]).length;
  assert.equal(low.matched.compared, all.matched.n - flagged);
  assert.equal(low.matched.filtered.lowConfidence, flagged);
  assert.match(low.report.items.find((i) => i.id === 'filters').text, /of low confidence on either side/);
  const se = compareSides(side(a, { condition: 0 }), side(b, { condition: 0 }), { filters: { maxSE: 0.2 } });
  assert.ok(se.rows.every(([i, j]) => se.values.a.se[i] <= 0.2 && se.values.b.se[j] <= 0.2));
  const reads = compareSides(side(a, { condition: 0 }), side(b, { condition: 0 }), { filters: { minReads: 20 } });
  assert.ok(reads.rows.every(([i, j]) => reads.values.a.reads[i] >= 20 && reads.values.b.reads[j] >= 20) && reads.matched.filtered.reads > 0);
  const none = compareSides(side(a, { condition: 0 }), side(b, { condition: 0 }), { filters: { maxSE: 0.01 } });
  assert.equal(none.report.status, 'blocked');
  assert.equal(none.statistics, null);
});

test('compare: discordance is tested for independent sides on one scale only; a position needs three variants', () => {
  const a = makeRun();
  const b = makeRun({ id: 'run-b', table: 'b'.repeat(64), shift: 0.05 });
  const c = compareSides(side(a, { condition: 0 }), side(b, { condition: 0 }));
  assert.equal(c.discordance.valid, true);
  assert.equal(c.discordance.tested, 30);
  c.rows.forEach(([i, j], k) => {
    const z = (c.x[k] - c.y[k]) / Math.sqrt(c.values.a.se[i] ** 2 + c.values.b.se[j] ** 2);
    near(c.discordance.z[k], z);
  });
  for (const x of c.positions.list) assert.equal(Number.isFinite(x.z), x.n >= MIN_POSITION_VARIANTS);
  assert.equal(positionsCSV(c).trim().split('\n').length, c.positions.list.length + 1);
  // Shared samples, one table twice, different scales: not tested, saying why.
  const shared = makeRun({ replicates: [['r1', 's0', 's1'], ['r2', 's0', 's2']] });
  assert.match(compareSides(side(shared, { replicate: 'r1' }), side(shared, { replicate: 'r2' })).discordance.reason, /Not independent/);
  const twice = makeRun({ id: 'run-c' });
  assert.equal(compareSides(side(a, { condition: 0 }), side(twice, { condition: 0 })).discordance.valid, false);
  const published = makeRun({ id: 'run-p', model: 'published', table: 'p'.repeat(64) });
  assert.match(compareSides(side(a, { condition: 0 }), side(published, { condition: 0 })).discordance.reason, /Not on one scale/);
});

test('compare: the maps of a comparison: each side as a condition, and the difference as a contrast', () => {
  const a = makeRun({ sequence: 'A'.repeat(40) });
  const b = makeRun({ id: 'run-b', table: 'b'.repeat(64), shift: 0.3 });
  const sa = side(a, { condition: 0 });
  const c = compareSides(sa, side(b, { condition: 0 }), { filters: { lowConfidence: true } });
  const dm = differenceMap(c, sa);
  const model = buildMapModel(dm.results, dm.design, { colorBy: 'differential', contrast: 0 });
  assert.equal(model.colorBy, 'differential');
  assert.equal(model.domain.center, 0);
  const compared = new Map(c.rows.map(([i], k) => [i, c.x[k] - c.y[k]]));
  let drawn = 0;
  let filtered = 0;
  for (let k = 0; k < model.cells.length; k += 1) {
    const i = model.cells[k];
    if (i < 0) continue;
    if (compared.has(i)) {
      near(model.value[k], compared.get(i));
      drawn += 1;
    } else if (model.state[k] === STATE.FILTERED) filtered += 1;
  }
  assert.equal(drawn, c.rows.length);
  assert.ok(filtered > 0, 'the variants left out by the filter are drawn filtered');
  const replicateMap = sideMap(side(a, { replicate: 'r2' }));
  const rm = buildMapModel(replicateMap.results, replicateMap.design, { condition: 0 });
  assert.equal(rm.condition.name, 'Replicate 2');
  assert.equal(differenceMap(compareSides(sa, side(makeRun({ id: 'run-p', model: 'published', table: 'p'.repeat(64) }), { condition: 0 })), sa), null);
});

// --- Other sources and scales (wave 4, slice 3) ----------------------------------------------------

test('agreement: the AUC with DeLong\'s interval, by hand: three cases against two controls, one tie', () => {
  const a = aucAgreement(Float64Array.from([1, 2, 3]), Float64Array.from([0, 2]));
  near(a.auc, 0.75);
  near(a.se, Math.sqrt(1 / 12));
  near(a.high, 1);
  near(a.low, 0.75 - 1.959963984540054 * Math.sqrt(1 / 12), 1e-9);
  assert.ok(Number.isNaN(aucAgreement([], [1, 2]).auc));
  near(aucAgreement([5, 6], [1, 2]).auc, 1);
});

test('compare: two runs on two scales, each rescaled by its own anchors, are on one scale; stated to be one; a side without its anchors is not rescaled, saying why', () => {
  const a = makeRun();
  const b = makeRun({ id: 'run-b', name: 'Run 2', table: 'b'.repeat(64), model: 'bins', scale: 2, shift: 0.5 });
  const scored = compareSides(side(a, { condition: 0 }), side(b, { condition: 0 }));
  assert.equal(scored.sameScale, false);
  assert.equal(scored.statistics.concordance, null);
  const rescaled = compareSides(side(a, { condition: 0 }), side(b, { condition: 0 }), { scale: 'nonsense-wt' });
  assert.ok(rescaled.sameScale && rescaled.scale.applied);
  assert.deepEqual(rescaled.scale.anchors.a.map((x) => x.what), ['nonsense', 'wild type']);
  near(rescaled.scale.slope.a, 2 * rescaled.scale.slope.b);
  near(rescaled.statistics.concordance.ccc, 1, 1e-12);
  near(rescaled.statistics.blandAltman.bias, 0, 1e-12);
  assert.match(rescaled.report.items.find((i) => i.id === 'scale').text, /^Rescaled onto one scale by their anchors/);
  const row = comparisonCSV(rescaled).trim().split('\n')[1].split(',');
  near(Number(row[8]), rescaled.x[0]);
  near(Number(row[9]), rescaled.y[0]);
  const none = compareSides(side(a, { condition: 0 }), side(b, { condition: 0 }), { scale: 'synonymous-nonsense' });
  assert.equal(none.sameScale, false);
  assert.match(none.report.items.find((i) => i.id === 'scale').text, /Not rescaled: Run 1 has no synonymous variants scored/);
  const stated = compareSides(side(a, { condition: 0 }), side(b, { condition: 0 }), { scale: 'stated' });
  assert.ok(stated.sameScale && stated.statistics.concordance);
  assert.equal(stated.report.items.find((i) => i.id === 'scale').status, 'qualified');
  assert.equal(JSON.parse(comparisonJSON(stated)).scale.mode, 'stated');
});

test('compare: a predictor, placed on a run\'s target, by rank and by its classes; two predictors are not compared', () => {
  const a = side(makeRun(), { condition: 0 });
  const missense = KEYS.filter((k) => !k.endsWith('Ter'));
  const entries = missense.map((key, k) => {
    const i = KEYS.indexOf(key) + 1;
    const value = 1 - (Math.cos(i) * 1.5 + 2) / 4;
    return { key, position: i, ref: 'A', alt: key.endsWith('Val') ? 'V' : 'G', value, cls: value > 0.564 ? 'pathogenic' : value < 0.34 ? 'benign' : 'ambiguous' };
  });
  const track = { entries, classes: MISSENSE_CLASSES, predictor: { layout: 'alphamissense' } };
  const annotation = { id: 'alphamissense', provider: 'alphamissense', name: 'AlphaMissense: P00000', file: { sha256: 'c'.repeat(64) } };
  const p = describePredictor(annotation, track, a);
  assert.equal(sideMap(p), null);
  const c = compareSides(a, p);
  assert.equal(c.flipped, true);
  assert.equal(c.statistics.pearson, null);
  near(c.statistics.spearman.rho, 1);
  assert.deepEqual(c.withheld, ['pearson', 'concordance', 'blandAltman', 'discordance', 'positions']);
  assert.equal(c.classes.list.length, 3);
  assert.equal(c.classes.list.reduce((s, x) => s + x.n, 0), missense.length);
  near(c.classes.auc.auc, 1);
  assert.equal(classesCSV(c).split('\n')[0], 'class,variants,median,lower_quartile,upper_quartile');
  assert.equal(JSON.parse(comparisonJSON(c)).b.source, 'predictor');
  const two = compareSides(p, describePredictor({ ...annotation, id: 'eve', name: 'EVE' }, track, a));
  assert.equal(two.report.status, 'blocked');
});

test('compare: a MaveDB score set kept beside the workspace, read as published, as a side; its direction stated in the history', () => {
  const r = makeRun({ id: 'run-b', table: 'b'.repeat(64) });
  const scoreSet = { urn: 'urn:mavedb:00000001-a-1', title: 'A score set', target: r.run.inputs.design.targets[0] };
  const annotation = { id: 'mavedb-scores', provider: 'mavedb-scores', name: 'MaveDB score set: urn:mavedb:00000001-a-1', file: { sha256: 'd'.repeat(64) }, record: { scoreSet } };
  const set = describeScoreSet(annotation, { results: r.results, design: { ...r.run.inputs.design, source: { mavedb: scoreSet.urn } }, parameters: { model: 'published' } });
  assert.equal(set.label, 'A score set (urn:mavedb:00000001-a-1)');
  const c = compareSides(side(makeRun(), { condition: 0 }), set);
  assert.equal(c.report.items.find((i) => i.id === 'scale').status, 'qualified');
  assert.equal(JSON.parse(comparisonJSON(c)).b.urn, scoreSet.urn);
  const ws = { id: 'w', history: [], annotations: [annotation] };
  const stated = setScoreSetDirection(ws, 'mavedb-scores', 'higher-less');
  assert.equal(stated.annotations[0].record.scoreSet.readout.direction, 'higher-less');
  assert.equal(setScoreSetDirection(stated, 'mavedb-scores', null).annotations[0].record.scoreSet.readout, undefined);
});
