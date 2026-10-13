import assert from 'node:assert/strict';
import test from 'node:test';
import { analysisState, designChanges, diffStates, makeCheckpoint, pairWords, parameterChanges, stateDigest, variantChanges } from './diff.js';
import { addCheckpoint, addSelection, createWorkspace, removeCheckpoint, saveFigure, setQcThresholds } from './workspace.js';
import { addPanel, createFigure } from './figures.js';
import { scoreExperiment } from './score.js';
import { addRun, makeRun, runInputs } from './runs.js';

const target = { id: 't', name: 'Toy', sequenceType: 'protein', sequence: 'MSKGEELFTG', offset: 0 };
const design = {
  format: 'mavescape-design', version: 1, name: 'toy', model: 'two-population',
  variants: { column: 'v', level: 'protein' }, targets: [target], library: { level: 'variant' },
  samples: ['in1', 'out1', 'in2', 'out2'].map((id) => ({ id, name: id, columns: [id] })),
  replicates: [{ id: 'r1', name: 'Replicate 1', biological: 1, input: 'in1', output: 'out1' }, { id: 'r2', name: 'Replicate 2', biological: 2, input: 'in2', output: 'out2' }],
  controls: { wildType: 'auto', synonymous: 'auto', nonsense: 'auto' },
};
const names = ['p.=', 'p.Ser2Ala', 'p.Lys3Arg', 'p.Gly4Asp', 'p.Glu5Lys', 'p.Glu6Gly', 'p.Leu7Pro', 'p.Phe8Leu', 'p.Thr9Ala', 'p.Gly10Ser'];
const col = (base, k) => Float64Array.from(names, (_, i) => (i ? base + ((i * k) % 37) : 2000));
const columns = { in1: col(80, 7), out1: col(30, 11), in2: col(85, 5), out2: col(32, 13) };
const source = { id: 's', name: 'counts.csv', sha256: 'b'.repeat(64), rows: names.length };
const run = (parameters, name) => {
  const results = scoreExperiment({ names, columns, design, parameters }).results;
  return { results, run: makeRun({ inputs: runInputs({ source, design, parameters }), source, results, software: { version: '0.6.0', commit: '' }, name, created: '2026-10-12T10:00:00.000Z' }) };
};
const one = run({}, 'Run 1');
const base = addRun({ ...createWorkspace('Toy', { now: '2026-10-12T09:00:00.000Z', id: 'ws-toy' }), sources: [source], targets: [target], design, designSource: 's' }, one.run).ws;

test('a checkpoint keeps the analysis without the history, named by its state\'s SHA-256 and the history\'s hash then', () => {
  const state = analysisState(base);
  assert.equal(state.history, undefined);
  assert.equal(state.id, undefined);
  assert.deepEqual(state.runs, base.runs);
  const c = makeCheckpoint(base, 'Before', '2026-10-12T11:00:00.000Z');
  assert.equal(c.head, base.history.at(-1).hash);
  assert.equal(c.sha256, stateDigest(state));
  const { ws, id } = addCheckpoint(base, c);
  assert.equal(ws.checkpoints[0].id, id);
  assert.match(ws.history.at(-1).detail, /^Checkpoint "Before": the analysis as it stood \(state SHA-256 [0-9a-f]{12}…\)$/);
  assert.deepEqual(analysisState(ws), state, 'a checkpoint is not part of the analysis');
  assert.equal(removeCheckpoint(ws, id).checkpoints, undefined);
});

test('the same analysis: no change; parameters and designs in words', () => {
  assert.deepEqual(diffStates(analysisState(base), analysisState(base)), { same: true, changes: [], pairs: [], calibrations: [], summary: 'No change in the analysis.' });
  assert.deepEqual(parameterChanges({}, { pseudocount: 1, filters: { minReplicates: 'all' } }), ['the pseudocount 0.5 → 1', 'the minimum replicates 1 → all']);
  assert.deepEqual(parameterChanges({}, { pseudocount: 0.5 }), [], 'a default made explicit is no change');
  assert.deepEqual(designChanges(design, { ...design, replicates: design.replicates.slice(0, 1) }), ['replicate Replicate 2 left out']);
  assert.deepEqual(designChanges(design, { ...design, readout: { direction: 'higher-less' } }), ['the readout added']);
});

test('what was done, in words: a threshold, a selection, a figure, a rescoring with what it moved', () => {
  const before = analysisState(base);
  let ws = setQcThresholds(base, { agreement: { review: 0.9, fail: 0.5 } }, 'x');
  ws = addSelection(ws, { name: 'Low', run: one.run.id, condition: 0, keys: ['p.Leu7Pro'], query: 'lower', created: '2026-10-12T11:00:00.000Z' }).ws;
  let fig = createFigure('Figure 1', 'single');
  ({ figure: fig } = addPanel(fig, { kind: 'map', run: one.run.id }));
  ws = saveFigure(ws, fig, 'made');
  const two = run({ pseudocount: 1 }, 'Run 2');
  ws = addRun(ws, two.run).ws;
  const after = analysisState(ws);
  const d = diffStates(before, after, { pairs: [{ table: source.sha256, a: one.run, b: two.run, resultsA: one.results, resultsB: two.results, findingsA: null, findingsB: null }] });
  assert.deepEqual(d.changes.map((c) => c.kind), ['run', 'qc', 'selection', 'figure']);
  assert.equal(d.changes[2].text, 'The selection "Low" was saved (1 variant, by the query "lower").');
  assert.equal(d.changes[3].text, 'The figure "Figure 1" was made (1 panel).');
  const [pair] = d.pairs;
  assert.deepEqual(pair.parameters, ['the pseudocount 0.5 → 1']);
  const t = pair.targets[0];
  const v = variantChanges(one.run, one.results, two.run, two.results)[0];
  assert.deepEqual(t, v);
  assert.ok(t.both > 0);
  assert.match(pairWords(pair)[0], /^Run 1 → Run 2: the pseudocount 0\.5 → 1\.$/);
  assert.match(pairWords(pair)[1], /^Of \d+ variants scored in both, \d+ moved beyond their earlier 95% interval and \d+ changed class/);
});

test('a change of units is not a change of effect: the time scale and the time points, in the earlier run\'s units', () => {
  const series = {
    ...design, model: 'time-series', time: { unit: 'generation' },
    samples: ['a', 'b'].flatMap((r) => [0, 2, 4, 6].map((t) => ({ id: `${r}${t}`, name: `${r}${t}`, columns: [`${r}${t}`] }))),
    replicates: ['a', 'b'].map((r, k) => ({ id: r, name: `Replicate ${k + 1}`, biological: k + 1, timepoints: [0, 2, 4, 6].map((time) => ({ sample: `${r}${time}`, time })) })),
  };
  const fall = (base, k, t) => Float64Array.from(names, (_, i) => (i ? Math.round((base + ((i * k) % 37)) * Math.exp(-0.05 * t * (i % 4))) : 2000));
  const cols = Object.fromEntries(['a', 'b'].flatMap((r, k) => [0, 2, 4, 6].map((t) => [`${r}${t}`, fall(80 + 5 * k, 7 - 2 * k, t)])));
  const scored = (parameters, d, name) => {
    const results = scoreExperiment({ names, columns: cols, design: d, parameters }).results;
    return { results, run: makeRun({ inputs: runInputs({ source, design: d, parameters }), source, results, software: { version: '0.6.0', commit: '' }, name, created: '2026-10-12T10:00:00.000Z' }) };
  };
  const unit = scored({ model: 'wls', timeScale: 'unit' }, series, 'Run 1');
  const course = scored({ model: 'wls' }, series, 'Run 2');
  const [t] = variantChanges(unit.run, unit.results, course.run, course.results);
  assert.deepEqual([t.moved, t.crossed, t.units], [0, 0, { factor: 1 / 6, why: ['the time scale changed'] }], 'over the course of 6 units, every effect 6 times');
  const pair = { a: { id: 'x', name: 'Run 1' }, b: { id: 'y', name: 'Run 2' }, parameters: ['the time scale unit → course'], design: [], targets: [t], findings: [], recomputed: true };
  assert.match(pairWords(pair)[1], /^Of \d+ variants scored in both, 0 moved beyond their earlier 95% interval \(Run 2's effects × 0\.167, in Run 1's units: the time scale changed\) and 0 changed class/);
  // One replicate's time points cut short: over its course, the two no longer span one time.
  const uneven = { ...series, replicates: [series.replicates[0], { ...series.replicates[1], timepoints: series.replicates[1].timepoints.slice(0, 3) }] };
  const short = scored({ model: 'wls' }, uneven, 'Run 3');
  const [u] = variantChanges(course.run, course.results, short.run, short.results);
  assert.deepEqual([u.moved, u.units.factor, u.units.why], [null, null, ['the time points changed']]);
  assert.match(pairWords({ ...pair, targets: [u] })[1], /whether they moved is not said \(the time points changed: their effects are in units that cannot be put in one\) and \d+ changed class/);
});
