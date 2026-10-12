import test from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync, inflateRawSync } from 'node:zlib';
import { dataRange, fetchLink, fetchSource, fileSource, fileSourceText, linkPayload, proteoscopeColormap, readLinkPayload, residueData, sessionDocument, sessionFileName, sessionLink, SESSION_FORMAT } from './proteoscope.js';
import { POSITION } from './structure-scores.js';

// Toy values of five positions: scored, low confidence, missing, filtered, the residue itself.
const values = {
  value: Float64Array.of(-2.5, 0.75, Number.NaN, Number.NaN, Number.NaN),
  state: Uint8Array.of(POSITION.VALUE, POSITION.LOW, POSITION.MISSING, POSITION.FILTERED, POSITION.REFERENCE),
  domain: { kind: 'diverging', center: 0.25, min: -4, max: 5.25 },
};
const chain = (id, offset) => ({ chain: id, positions: [1, 2, 3, 4, 5].map((p) => ({ position: p, residue: p === 2 && id === 'B' ? null : `${id}:${p + offset}:ALA` })) });

test('the scores as residue data: positions with a value, on every chain mapped; the map\'s range centered on the wild type', () => {
  assert.deepEqual(residueData(values, [chain('A', 100), chain('B', 200)]), [['A:101:ALA', -2.5], ['A:102:ALA', 0.75], ['B:201:ALA', -2.5]]);
  assert.deepEqual(dataRange(values.domain), { min: -4.75, max: 5.25 });
  assert.deepEqual(dataRange({ kind: 'sequential', min: 0, max: 19 }), { min: 0, max: 19 });
  assert.equal(proteoscopeColormap(values.domain), 'bwr');
  assert.equal(proteoscopeColormap({ kind: 'sequential' }), 'viridis');
});

test('sources: a PDB entry and an AlphaFold DB model by their IDs, a file embedded as Proteoscope embeds one', async () => {
  assert.deepEqual(fetchSource({ kind: 'pdb', id: '2vwf' }), { type: 'fetch', id: '2VWF' });
  assert.deepEqual(fetchSource({ kind: 'alphafold', id: 'P62993', version: 6 }), { type: 'fetch', id: 'P62993' });
  assert.equal(fetchSource({ kind: 'file', name: 'mine.cif' }), null);
  const text = 'data_MINE\n#\n_entry.id MINE\n'.repeat(50);
  const source = await fileSource('mine.cif', text);
  assert.equal(source.type, 'file');
  assert.equal(source.encoding, 'gzip-base64');
  assert.equal(await fileSourceText(source), text);
  assert.equal(gunzipSync(Buffer.from(source.data, 'base64')).toString('utf8'), text);
});

test('the session: Proteoscope\'s format 1, the structure, its colors (residue data, residue colors or a scheme), residues and camera', () => {
  const camera = { target: [1, 2, 3], distance: 40, rotation: [0, 0, 0, 1], fov: 0.75, orthographic: false, near: 1, far: 100 };
  const doc = sessionDocument({
    name: '2VWF', title: 'GRB2 SH3', source: { type: 'fetch', id: '2VWF' }, assembly: null,
    display: { polymer: 'cartoon', ligand: 'ball-stick' }, residueStyles: [['A:21:ARG', 'sticks']], hidden: ['A:1:MET'], surface: 'off',
    data: { label: 'Median score, Run 1', values: [['A:21:ARG', -0.5]], domain: values.domain },
    selection: ['A:21:ARG'], labels: ['A:21:ARG'], focus: [], camera, software: { version: '0.5.0' }, created: '2026-10-12T00:00:00.000Z',
  });
  assert.equal(doc.format, SESSION_FORMAT);
  assert.equal(doc.version, 1);
  assert.equal(doc.application, 'MaveScape');
  assert.deepEqual(doc.view.camera, { target: [1, 2, 3], distance: 40, rotation: [0, 0, 0, 1], fov: 0.75, orthographic: false });
  const s = doc.structures[0];
  assert.deepEqual(s.source, { type: 'fetch', id: '2VWF' });
  assert.deepEqual(s.color, { scheme: 'data', colormap: 'bwr', range: { min: -4.75, max: 5.25 } });
  assert.deepEqual(s.proteomics.data, [['A:21:ARG', -0.5]]);
  assert.equal(s.proteomics.dataLabel, 'Median score, Run 1');
  assert.deepEqual(s.display.residueStyles, [['A:21:ARG', 'sticks']]);
  assert.deepEqual(s.display.hiddenResidues, ['A:1:MET']);
  assert.equal(s.colorOverrides, null);
  assert.equal(s.focus, null);
  assert.deepEqual([s.selection, s.labels], [['A:21:ARG'], ['A:21:ARG']]);
  // Categories as residue colors over a uniform gray; one of the structure's own schemes as itself.
  const classes = sessionDocument({ name: 'x', source: { type: 'fetch', id: '1D5R' }, overrides: [['A:124:CYS', '#3366cc']], uniformColor: '#cfcfcf' }).structures[0];
  assert.deepEqual([classes.color, classes.colorOverrides, classes.proteomics.data], [{ scheme: 'uniform', uniformColor: '#cfcfcf' }, [['A:124:CYS', '#3366cc']], null]);
  assert.deepEqual(sessionDocument({ name: 'x', source: { type: 'fetch', id: '1D5R' }, color: { scheme: 'secondary' } }).structures[0].color, { scheme: 'secondary' });
});

test('the link: the session deflated in URL-safe base64, as Proteoscope reads it; the structure alone; the file\'s name', async () => {
  const doc = sessionDocument({ name: '2VWF', source: { type: 'fetch', id: '2VWF' }, data: { label: 'Median', values: Array.from({ length: 300 }, (_, i) => [`A:${i + 1}:ALA`, i / 7]), domain: values.domain } });
  const payload = await linkPayload(doc);
  assert.match(payload, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(await readLinkPayload(payload), doc);
  const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
  assert.deepEqual(JSON.parse(inflateRawSync(Buffer.from(base64, 'base64')).toString('utf8')), doc);
  assert.equal(sessionLink('http://127.0.0.1:8765/', payload), `http://127.0.0.1:8765/#session=${payload}`);
  assert.equal(sessionLink('http://127.0.0.1:8766', 'x'), 'http://127.0.0.1:8766/#session=x');
  assert.equal(fetchLink('http://127.0.0.1:8765/', 'P62993'), 'http://127.0.0.1:8765/#fetch=P62993');
  assert.equal(sessionFileName('2VWF.cif.gz'), '2VWF.proteoscope.json');
  assert.equal(sessionFileName('my model (v2).pdb'), 'my_model_v2_.proteoscope.json');
});
