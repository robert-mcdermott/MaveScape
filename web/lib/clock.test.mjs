import assert from 'node:assert/strict';
import test from 'node:test';
import { clockFixed, fixClock, newId, now } from './clock.js';
import { createWorkspace, change } from './workspace.js';
import { makeRun } from './runs.js';

test('a fixed clock: every record at that time, identifiers counted from the start', () => {
  assert.equal(clockFixed(), false);
  assert.match(newId(), /^[0-9a-f]{20}$/, 'random in a window');
  assert.throws(() => fixClock('soon'), /not a time/);
  fixClock('2026-10-09T14:00:00+02:00');
  assert.equal(clockFixed(), true);
  assert.equal(now(), '2026-10-09T12:00:00.000Z');
  const first = [newId(), newId()];
  const ws = change(createWorkspace('w'), { name: 'v' }, 'rename', 'Renamed');
  assert.equal(ws.created, '2026-10-09T12:00:00.000Z');
  assert.equal(ws.history.at(-1).time, '2026-10-09T12:00:00.000Z');
  assert.equal(ws.id, 'ws-f0000000000000000003');
  // Fixed again: the same identifiers again.
  fixClock('2026-10-09T12:00:00Z');
  assert.deepEqual([newId(), newId()], first);
  assert.equal(makeRun({ inputs: { source: {}, mapping: {}, design: {}, parameters: {}, scoring: '2' }, source: { id: 's', name: 's' }, results: { format: 'mavescape-scores', version: 1, rows: 0, variants: { key: [] }, replicates: [], conditions: [], warnings: [], info: [] }, software: { version: '0.2.0' }, name: 'Run 1' }).created, '2026-10-09T12:00:00.000Z');
});
