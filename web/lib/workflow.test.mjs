import assert from 'node:assert/strict';
import test from 'node:test';
import { focusStep, workflowSteps } from './workflow.js';
import { createWorkspace } from './workspace.js';

const target = { id: 't', name: 'Toy', sequenceType: 'protein', sequence: 'MSKG' };
const design = {
  format: 'mavescape-design', version: 1, name: 'toy', model: 'two-population',
  variants: { column: 'v', level: 'protein' }, targets: [target], library: { level: 'variant' },
  samples: [{ id: 'in', name: 'in', columns: ['in'] }, { id: 'out', name: 'out', columns: ['out'] }],
  replicates: [{ id: 'r1', biological: 1, input: 'in', output: 'out' }],
  controls: { wildType: 'auto', synonymous: 'auto', nonsense: 'auto' },
};
const source = { id: 's', name: 'counts.csv', sha256: 'a'.repeat(64), rows: 4, target: 't', columns: [{ name: 'v' }, { name: 'in' }, { name: 'out' }], mapping: { countColumns: ['in', 'out'] }, problems: { blocking: [] }, summary: { total: 4 } };
const ws = (patch) => ({ ...createWorkspace('w'), ...patch });
const states = (steps) => steps.map((s) => `${s.id}:${s.state}`).join(' ');
const run = (d = design) => ({ id: 'run-1', name: 'Run 1', inputs: { source: { sha256: source.sha256 }, design: d }, output: { variants: 4, conditions: [{ scored: 3 }] } });

test('from nothing to the counts; a FASTA alone asks for its count table', () => {
  assert.equal(states(workflowSteps(ws({}))), 'counts:next target:todo design:todo score:todo qc:todo map:todo record:optional');
  const fasta = workflowSteps(ws({ targets: [target] }));
  assert.equal(fasta[0].state, 'next');
  assert.match(fasta[0].detail, /count table whose variants are named on Toy/);
  assert.equal(fasta[1].state, 'done');
});

test('a table of scores, or with blocking problems, needs attention, and says why', () => {
  const scores = workflowSteps(ws({ sources: [{ ...source, layout: 'mavedb-scores', mapping: { countColumns: [] } }], targets: [target] }));
  assert.equal(focusStep(scores).id, 'counts');
  assert.match(focusStep(scores).detail, /holds scores, not counts/);
  const broken = workflowSteps(ws({ sources: [{ ...source, problems: { blocking: ['"p.Ser2Ala" is on two rows'] } }], targets: [target] }));
  assert.equal(broken[0].state, 'attention');
  assert.equal(broken[0].action.kind, 'focus');
});

test('counts and target: draft the design; a broken design is to fix; a missing target is said', () => {
  const ready = workflowSteps(ws({ sources: [source], targets: [target] }));
  assert.equal(states(ready), 'counts:done target:done design:next score:todo qc:todo map:todo record:optional');
  assert.equal(ready[2].action.kind, 'draft');
  const noTarget = workflowSteps(ws({ sources: [{ ...source, target: undefined }] }));
  assert.equal(noTarget[1].state, 'attention');
  const bad = workflowSteps(ws({ sources: [source], targets: [target], design: { ...design, replicates: [] } }));
  assert.equal(bad[2].state, 'attention');
  assert.equal(bad[2].action.mode, 'experiment');
});

test('scored, then QC, then the map; a changed design asks to score again; sorted bins are scored too', () => {
  const base = { sources: [source], targets: [target], design, designSource: 's' };
  assert.equal(workflowSteps(ws(base))[3].state, 'next');
  const stale = workflowSteps(ws({ ...base, runs: [run({ ...design, name: 'older' })] }));
  assert.equal(stale[3].state, 'attention');
  assert.match(stale[3].detail, /changed since the last run/);
  const scored = workflowSteps(ws({ ...base, runs: [run()] }));
  assert.equal(states(scored), 'counts:done target:done design:done score:done qc:next map:todo record:optional');
  const read = workflowSteps(ws({ ...base, runs: [run()] }), { qc: new Map([['run-1', { status: 'review', counts: { fail: 0, review: 2 } }]]), map: new Set() });
  assert.deepEqual([read[4].state, read[4].verdict, read[5].state], ['done', 'review', 'next']);
  const all = workflowSteps(ws({ ...base, runs: [run()] }), { qc: new Map([['run-1', { status: 'pass', counts: { fail: 0, review: 0 } }]]), map: new Set(['run-1']) });
  assert.equal(focusStep(all).id, 'record');
  const bins = workflowSteps(ws({ ...base, design: { ...design, model: 'bins', bins: { weight: 'rank' }, replicates: [{ id: 'r1', biological: 1, bins: [{ sample: 'in', order: 1, value: 1 }, { sample: 'out', order: 2, value: 2 }] }] } }));
  assert.equal(bins[3].state, 'next');
});
