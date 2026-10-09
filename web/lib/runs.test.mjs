import assert from 'node:assert/strict';
import test from 'node:test';
import { addRun, describeMethod, describeParameters, makeRun, outputDigest, recordedInputs, removeRun, runId, runInputs } from './runs.js';
import { DEFAULT_PARAMETERS, PRESETS, scoreExperiment } from './score.js';
import { createWorkspace, verifyHistory } from './workspace.js';

const design = {
  format: 'mavescape-design', version: 1, name: 'toy', model: 'two-population',
  variants: { column: 'v', level: 'protein' }, targets: [{ id: 't', name: 'Toy', sequenceType: 'protein', sequence: 'MSK' }], library: { level: 'variant' },
  samples: [{ id: 'in', name: 'in', columns: ['in'] }, { id: 'out', name: 'out', columns: ['out'] }],
  replicates: [{ id: 'r1', biological: 1, input: 'in', output: 'out' }],
  controls: { wildType: 'auto', synonymous: 'auto', nonsense: 'auto' },
};
const source = { id: 'counts', name: 'counts.csv', sha256: 'a'.repeat(64), rows: 3, mapping: { mode: 'lenient' } };
const scored = (parameters) => scoreExperiment({ names: ['p.=', 'p.Ser2Ala', 'p.Ser2Ter'], columns: { in: Float64Array.of(100, 10, 10), out: Float64Array.of(100, 20, 1) }, design, parameters }).results;

test('a run\'s id comes from its inputs; its output hash from its scores', () => {
  const a = runInputs({ source, design, parameters: DEFAULT_PARAMETERS });
  assert.equal(runId(a), runId(runInputs({ source: { ...source, name: 'renamed.csv' }, design, parameters: {} })), 'names and defaults written out or not: the same run');
  assert.notEqual(runId(a), runId(runInputs({ source, design, parameters: { normalization: 'full' } })));
  assert.equal(outputDigest(scored(DEFAULT_PARAMETERS)), outputDigest(scored(DEFAULT_PARAMETERS)));
  assert.notEqual(outputDigest(scored(DEFAULT_PARAMETERS)), outputDigest(scored({ pseudocount: 1 })));
});

test('runs are added once, removed with a history entry, and describe their method', () => {
  const inputs = runInputs({ source, design, parameters: PRESETS.enrich2.parameters });
  const run = makeRun({ inputs, source, results: scored(PRESETS.enrich2.parameters), software: { version: '0.1.0', commit: 'abc1234def' }, name: 'Run 1' });
  let ws = createWorkspace('t');
  ws = addRun(ws, run).ws;
  assert.equal(addRun(ws, run).existing, true);
  assert.deepEqual(recordedInputs(ws.runs[0]).source, inputs.source);
  ws = removeRun(ws, run.id);
  assert.equal(ws.runs.length, 0);
  assert.deepEqual(ws.history.map((e) => e.action), ['create', 'score', 'remove-run']);
  assert.ok(verifyHistory(ws).ok);
  assert.match(describeParameters(run.inputs.parameters), /Enrich2's estimator, scored in every replicate/);
  assert.match(describeMethod(run).join(' '), /MaveScape 0\.1\.0 \(abc1234\)/);
});
