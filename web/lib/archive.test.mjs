import assert from 'node:assert/strict';
import test from 'node:test';
import { readArchive, writeArchive } from './archive.js';
import { createWorkspace, addSource } from './workspace.js';
import { sha256 } from './sha256.js';
import { createZip } from './zip.js';

const bytes = new TextEncoder().encode('v,in,out\np.=,1,2\n');
const ws = addSource(createWorkspace('A', { now: '2026-10-09T00:00:00.000Z', id: 'ws-a' }), { name: 't.csv', fileName: 't.csv', sha256: sha256(bytes), rows: 1 }).ws;

test('written twice, the same bytes; read back, the same workspace and table', async () => {
  const a = await writeArchive(ws, { software: { version: '0.1.0' }, sources: new Map([[sha256(bytes), bytes]]) });
  const b = await writeArchive(ws, { software: { version: '0.1.0' }, sources: new Map([[sha256(bytes), bytes]]) });
  assert.deepEqual(a.bytes, b.bytes);
  const r = await readArchive(a.bytes);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.ws, ws);
  assert.deepEqual(r.sources.get(sha256(bytes)), bytes);
  assert.deepEqual(a.manifest.contents.map((c) => c.path), ['workspace.json', `sources/${sha256(bytes)}.csv`]);
});

test('a table missing from the library is said, not skipped; checksums only is allowed', async () => {
  await assert.rejects(writeArchive(ws, { sources: new Map() }), /not in the library/);
  const light = await readArchive((await writeArchive(ws, { sources: null })).bytes);
  assert.equal(light.manifest.sources, 'checksums');
  assert.deepEqual(light.problems, []);
});

test('foreign names are not read; a missing workspace is refused', async () => {
  const a = await writeArchive(ws, { sources: null });
  const { listZip, readZipEntry } = await import('./zip.js');
  const files = [];
  for (const e of listZip(a.bytes)) files.push({ name: e.name, data: await readZipEntry(a.bytes, e) });
  const r = await readArchive(await createZip([...files, { name: '/etc/passwd', data: 'x' }]));
  assert.match(r.problems[0], /"\/etc\/passwd" is not part of a MaveScape archive/);
  await assert.rejects(readArchive(await createZip(files.filter((f) => f.name !== 'workspace.json'))), /no workspace.json/);
});
