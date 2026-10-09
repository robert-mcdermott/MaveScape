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
