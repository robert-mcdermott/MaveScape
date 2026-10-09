import assert from 'node:assert/strict';
import test from 'node:test';
import { WORKSPACE_FORMAT, WORKSPACE_VERSION, createWorkspace, isEmptyWorkspace, parseWorkspace, rename, serializeWorkspace } from './workspace.js';

test('a new workspace is an empty, versioned document with a valid id', () => {
  const ws = createWorkspace('GRB2 SH3', { now: '2026-10-08T12:00:00.000Z' });
  assert.equal(ws.format, WORKSPACE_FORMAT);
  assert.equal(ws.version, WORKSPACE_VERSION);
  assert.match(ws.id, /^[A-Za-z0-9_-]{1,80}$/);
  assert.equal(ws.created, '2026-10-08T12:00:00.000Z');
  assert.ok(isEmptyWorkspace(ws));
  assert.notEqual(createWorkspace().id, createWorkspace().id);
});

test('a workspace survives saving and reopening byte for byte', () => {
  const ws = createWorkspace('Round trip', { now: '2026-10-08T12:00:00.000Z' });
  const text = serializeWorkspace(ws);
  const back = parseWorkspace(text);
  assert.deepEqual(back, ws);
  assert.equal(serializeWorkspace(back), text);
});

test('fields a later version of the envelope added are filled in when an older document opens', () => {
  const old = JSON.stringify({ format: WORKSPACE_FORMAT, version: 1, id: 'ws-old', name: 'Old', created: '2026-10-01T00:00:00Z' });
  const ws = parseWorkspace(old);
  assert.deepEqual(ws.sources, []);
  assert.deepEqual(ws.runs, []);
  assert.equal(ws.design, null);
  assert.equal(ws.name, 'Old');
});

test('other documents are refused with a plain message', () => {
  assert.throws(() => parseWorkspace('{not json'), /not valid JSON/);
  assert.throws(() => parseWorkspace(JSON.stringify({ format: 'cytoweave-workspace', version: 1, id: 'x' })), /not a MaveScape workspace/);
  assert.throws(() => parseWorkspace(JSON.stringify({ format: WORKSPACE_FORMAT, version: 99, id: 'x' })), /newer MaveScape/);
  assert.throws(() => parseWorkspace(JSON.stringify({ format: WORKSPACE_FORMAT, version: 1, id: '../etc' })), /no valid id/);
});

test('rename returns a new value and leaves the original alone', () => {
  const ws = createWorkspace('A');
  const renamed = rename(ws, '  B  ');
  assert.equal(renamed.name, 'B');
  assert.equal(ws.name, 'A');
  assert.equal(rename(ws, '   '), ws);
  assert.equal(rename(ws, 'A'), ws);
});

test('sources and targets are added with ids of their own; an identical target is not added twice', async () => {
  const { addSource, addTarget, removeSource, uniqueId, updateTarget } = await import('./workspace.js');
  let ws = createWorkspace('W');
  let r = addSource(ws, { name: 'counts.csv', sha256: 'a'.repeat(64) });
  ws = r.ws;
  assert.equal(r.id, 'counts.csv');
  r = addSource(ws, { name: 'counts.csv', sha256: 'b'.repeat(64) });
  assert.equal(r.id, 'counts.csv-2');
  ws = removeSource(r.ws, 'counts.csv');
  assert.deepEqual(ws.sources.map((s) => s.id), ['counts.csv-2']);
  const t = { id: 'grb2', name: 'GRB2 SH3', sequenceType: 'protein', sequence: 'TYVQALFDF' };
  const first = addTarget(ws, t);
  const again = addTarget(first.ws, t);
  assert.equal(again.existing, true);
  assert.equal(again.ws, first.ws);
  ws = updateTarget(first.ws, 'grb2', { offset: 158 });
  assert.equal(ws.targets[0].offset, 158);
  assert.equal(uniqueId('a b/c', [{ id: 'a-b-c' }]), 'a-b-c-2');
});

test('the history is hash-chained: any entry changed, removed, inserted or reordered breaks it', async () => {
  const { addTarget, setDesign, verifyHistory, appendHistory, HISTORY_LIMIT } = await import('./workspace.js');
  let ws = createWorkspace('Chained', { now: '2026-10-08T00:00:00.000Z' });
  ws = addTarget(ws, { id: 't', name: 'T', sequenceType: 'protein', sequence: 'MSK' }).ws;
  ws = setDesign(ws, { format: 'mavescape-design' }, 'Set the design');
  ws = rename(ws, 'Renamed');
  const ok = verifyHistory(ws);
  assert.equal(ok.ok, true);
  assert.deepEqual(ws.history.map((e) => e.action), ['create', 'target', 'design', 'rename']);
  const edited = { ...ws, history: ws.history.map((e, i) => (i === 1 ? { ...e, detail: 'Added something else' } : e)) };
  assert.equal(verifyHistory(edited).broken[0].index, 1);
  const removed = { ...ws, history: ws.history.filter((_, i) => i !== 1) };
  assert.equal(verifyHistory(removed).broken[0].index, 1);
  const swapped = { ...ws, history: [ws.history[0], ws.history[2], ws.history[1], ws.history[3]] };
  assert.equal(verifyHistory(swapped).ok, false);
  // The chain survives saving and reopening.
  assert.equal(verifyHistory(parseWorkspace(serializeWorkspace(ws))).head, ok.head);
  // Beyond the limit the oldest entries go, and the anchor keeps the chain checkable.
  let long = { history: [], historyAnchor: undefined };
  for (let i = 0; i < HISTORY_LIMIT + 3; i += 1) long = { ...long, ...appendHistory(long, 'edit', `#${i}`, '2026-10-08T00:00:00.000Z') };
  assert.equal(long.history.length, HISTORY_LIMIT);
  assert.equal(verifyHistory(long).ok, true);
  assert.equal(long.history[0].detail, '#3');
});

test('named selections: saved and removed, each in the history', async () => {
  const { addSelection, removeSelection, createWorkspace, verifyHistory } = await import('./workspace.js');
  let ws = createWorkspace('s');
  const added = addSelection(ws, { name: 'Hot spot', run: 'run-x', condition: 0, keys: ['p.Ala2Val', 'p.Ala2Ter'] });
  ws = added.ws;
  assert.equal(added.id, 'Hot-spot');
  assert.equal(addSelection(ws, { name: 'Hot spot', run: 'run-x', keys: [] }).id, 'Hot-spot-2');
  ws = removeSelection(ws, added.id);
  assert.deepEqual(ws.history.map((e) => e.action), ['create', 'selection', 'remove-selection']);
  assert.ok(verifyHistory(ws).ok);
});
