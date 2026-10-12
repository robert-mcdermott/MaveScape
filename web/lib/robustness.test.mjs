import assert from 'node:assert/strict';
import test from 'node:test';
import { callsOf, CLASS, methodsSentence, replicateDispersion, robustnessChoices, robustnessCSV, robustnessJSON, specificationInputs, specificationLabel, specifications, summarizeRobustness, VERDICT } from './robustness.js';
import { KIND } from './variants.js';

const design = (replicates = 3, extra = {}) => ({
  model: 'two-population',
  targets: [{ id: 't', name: 'T', sequence: 'A'.repeat(40), sequenceType: 'protein', offset: 0 }],
  variants: { level: 'protein', column: 'v' },
  readout: { direction: 'higher-more' },
  replicates: Array.from({ length: replicates }, (_, r) => ({ id: `r${r + 1}`, name: `Replicate ${r + 1}`, input: `i${r}`, output: `o${r}` })),
  ...extra,
});

test('robustness: specifications are the declared analysis, each alternative alone, then seeded combinations of two or more, none twice', () => {
  const choices = [{ id: 'a', options: [{}, {}, {}] }, { id: 'b', options: [{}, {}] }, { id: 'c', options: [{}, {}, {}, {}] }];
  const specs = specifications(choices, { max: 12, seed: 7 });
  assert.equal(specs[0].kind, 'declared');
  assert.deepEqual(specs[0].picks, [0, 0, 0]);
  assert.equal(specs.filter((s) => s.kind === 'single').length, 2 + 1 + 3);
  assert.ok(specs.filter((s) => s.kind === 'combined').every((s) => s.changed >= 2));
  assert.equal(new Set(specs.map((s) => s.picks.join())).size, specs.length);
  assert.equal(specs.length, 12);
  assert.deepEqual(specifications(choices, { max: 12, seed: 7 }), specs);
  // Never more than the space holds.
  assert.equal(specifications([{ id: 'a', options: [{}, {}] }], { max: 50 }).length, 2);
});

test('robustness: the choices a run offers, its own first; published scores none; fixed effects left out where replicates differ beyond their SEs', () => {
  const p = { model: 'ratio', normalization: 'wt', pseudocount: 0.5, combination: 'moderated' };
  const results = { controls: { wt: 0 }, variants: { kind: Uint8Array.from([KIND.WT, KIND.SYNONYMOUS, KIND.SYNONYMOUS, KIND.SYNONYMOUS, KIND.MISSENSE]) }, conditions: [] };
  const { choices } = robustnessChoices(design(), p, results);
  const ids = choices.map((c) => c.id);
  assert.deepEqual(ids, ['pseudocount', 'normalization', 'model', 'combination', 'minInputCount', 'minReplicates', 'leaveOut']);
  assert.ok(choices.every((c) => c.options[0].id === 'declared'));
  assert.deepEqual(choices.find((c) => c.id === 'pseudocount').options.map((o) => o.label), ['0.5', '0.1', '1']);
  assert.ok(choices.find((c) => c.id === 'normalization').options.some((o) => o.parameters?.normalization === 'synonymous'));
  assert.equal(choices.find((c) => c.id === 'leaveOut').options.length, 4);
  assert.deepEqual(robustnessChoices(design(), { model: 'published' }).choices, []);
  // One replicate: nothing to combine or leave out.
  assert.ok(!robustnessChoices(design(1), p, results).choices.some((c) => c.id === 'combination' || c.id === 'leaveOut'));
  // Replicates differing 4 times as much as their SEs say: no fixed effects.
  const heterogeneous = { ...results, conditions: [{ q: Float64Array.from({ length: 50 }, () => 4 * 1.405), k: new Uint8Array(50).fill(3), reason: new Uint8Array(50) }] };
  assert.ok(replicateDispersion(heterogeneous) > 3);
  const out = robustnessChoices(design(), p, heterogeneous);
  assert.ok(!out.choices.find((c) => c.id === 'combination').options.some((o) => o.id === 'fixed'));
  assert.match(out.notes.join(' '), /Fixed effects \(inverse variance\) are not tried/);
  // A time series: its models and a regression's SE.
  const ts = robustnessChoices(design(3, { model: 'time-series' }), { ...p, model: 'wls', regressionSE: 'counting-floor' }, results).choices;
  assert.deepEqual(ts.find((c) => c.id === 'model').options.map((o) => o.id), ['declared', 'ols', 'ratio']);
  assert.ok(ts.some((c) => c.id === 'regressionSE') && ts.some((c) => c.id === 'minTimePoints'));
});

test('robustness: a specification\'s inputs and label', () => {
  const p = { model: 'ratio', normalization: 'wt', pseudocount: 0.5, combination: 'moderated' };
  const { choices } = robustnessChoices(design(), p, null);
  const picks = choices.map((c) => (c.id === 'pseudocount' || c.id === 'leaveOut' || c.id === 'minInputCount' ? 2 : 0));
  const inputs = specificationInputs(design(), p, choices, picks);
  assert.equal(inputs.parameters.pseudocount, 1);
  assert.equal(inputs.parameters.filters.minInputCount, 10);
  assert.deepEqual(inputs.design.replicates.map((r) => r.id), ['r1', 'r3']);
  assert.equal(specificationLabel(choices, picks), 'pseudocount 1; minimum input count 10; Replicate 2 left out');
  assert.equal(specificationLabel(choices, choices.map(() => 0)), 'the declared analysis');
});

// Results of one condition: the wild type at 0, then variants with scores and SEs.
function resultsOf(scores, ses, { reason = null, differential = null } = {}) {
  const n = scores.length + 1;
  const key = ['p.=', ...scores.map((_, i) => `p.Ala${i + 1}Val`)];
  return {
    rows: n,
    controls: { wt: 0 },
    parameters: { model: 'ratio', normalization: 'wt' },
    variants: { key, original: key, kind: Uint8Array.from(key, (k, i) => (i ? KIND.MISSENSE : KIND.WT)), position: Int32Array.from(key, (k, i) => i) },
    conditions: [{ id: 'all', name: 'All replicates', score: Float64Array.from([0, ...scores]), se: Float64Array.from([0.1, ...ses]), reason: reason ?? new Uint8Array(n), flags: new Uint8Array(n) }],
    ...(differential ? { differential } : {}),
  };
}

test('robustness: a variant\'s class against the wild type, beyond its uncertainty; a difference\'s from its q', () => {
  const r = resultsOf([-3, -0.05, 2, -0.1], [0.1, 0.1, 0.1, 0.5], { differential: [{ id: 'c', name: 'B vs A', delta: Float64Array.from([0, -1, 0.01, 0, 0]), se: Float64Array.from([1, 0.1, 0.1, 0.1, 0.1]), q: Float64Array.from([1, 0.001, 0.9, 0.5, 0.5]), reason: new Uint8Array(5) }] });
  const [condition, contrast] = callsOf(r, {});
  assert.deepEqual([...condition.cls], [CLASS.NEUTRAL, CLASS.LOWER, CLASS.NEUTRAL, CLASS.HIGHER, CLASS.NEUTRAL]);
  assert.equal(condition.reference, 'the wild type');
  assert.equal(contrast.kind, 'contrast');
  assert.deepEqual([...contrast.cls], [CLASS.NEUTRAL, CLASS.LOWER, CLASS.NEUTRAL, CLASS.NEUTRAL, CLASS.NEUTRAL]);
});

test('robustness: each variant\'s verdict, from what every analysis says of it', () => {
  // 30 variants: most the same in every analysis; variant 1 moved and reclassed by one choice
  // (fragile); 2 reclassed by a smaller SE (its uncertainty); 3 reclassed at the threshold
  // (borderline); 4 moved, its class kept (its size); 5 dropped by one choice (not always scored).
  const n = 31;
  const base = Array.from({ length: 30 }, (_, i) => (i < 15 ? -2 : 0));
  base[0] = -2; base[1] = -0.15; base[2] = -0.24; base[3] = -2; base[4] = -2;
  const ses = Array.from({ length: 30 }, () => 0.1);
  const results = resultsOf(base, ses);
  const target = (scores, se, unscored = []) => {
    const r = resultsOf(scores, se, { reason: Uint8Array.from({ length: n }, (_, i) => (unscored.includes(i) ? 1 : 0)) });
    return callsOf(r, {})[0];
  };
  const alt = (fn) => {
    const s = [...base];
    const e = [...ses];
    const out = fn(s, e) ?? [];
    return target(s, e, out);
  };
  const choices = [{ id: 'x', label: 'X', options: [{ id: 'declared', label: 'as run' }, { id: 'x1', label: 'one' }, { id: 'x2', label: 'two' }, { id: 'x3', label: 'three' }, { id: 'x4', label: 'four' }, { id: 'x5', label: 'five' }] }];
  const specs = [
    { kind: 'declared', picks: [0], changed: 0, ok: true, label: 'the declared analysis', targets: [target(base, ses)] },
    { kind: 'single', picks: [1], changed: 1, ok: true, label: 'one', targets: [alt((s) => { s[0] = -0.05; })] },
    { kind: 'single', picks: [2], changed: 1, ok: true, label: 'two', targets: [alt((s, e) => { e[1] = 0.03; })] },
    { kind: 'single', picks: [3], changed: 1, ok: true, label: 'three', targets: [alt((s) => { s[2] = -0.22; })] },
    { kind: 'single', picks: [4], changed: 1, ok: true, label: 'four', targets: [alt((s) => { s[3] = -3; })] },
    { kind: 'single', picks: [5], changed: 1, ok: true, label: 'five', targets: [alt(() => [5])] },
  ];
  const summary = summarizeRobustness(specs, choices, results, design());
  const t = summary.targets[0];
  assert.equal(t.verdict[1], VERDICT.FRAGILE);
  assert.deepEqual(t.dependsOn[1], ['one']);
  assert.equal(t.verdict[2], VERDICT.UNCERTAIN);
  assert.equal(t.verdict[3], VERDICT.BORDERLINE);
  assert.equal(t.verdict[4], VERDICT.SIZE);
  assert.equal(t.verdict[5], VERDICT.INCLUSION);
  assert.deepEqual(t.droppedBy[5], ['five']);
  assert.equal(t.verdict[10], VERDICT.ROBUST);
  assert.equal(t.counts.fragile + t.counts.uncertain + t.counts.borderline + t.counts.size + t.counts.inclusion + t.counts.robust, t.n);
  assert.match(t.text, /1 are fragile/);
  assert.match(methodsSentence(summary), /checked against 5 alternative analyses/);
  const csv = robustnessCSV(summary, results).trim().split('\n');
  assert.equal(csv[0], 'target,variant,class,effect,SE,q,analyses,scored_in,class_kept_in,verdict,depends_on,effect_min,effect_max,rank,rank_min,rank_max');
  const record = JSON.parse(robustnessJSON(summary, { id: 'run-x', name: 'Run 1', output: { sha256: 'abc' } }, specs));
  assert.equal(record.format, 'mavescape-robustness');
  assert.equal(record.analyses, 6);
});
