import assert from 'node:assert/strict';
import test from 'node:test';
import { buildManifest, checkManifest, compareDrawings, compareManifest, embedPNG, embedSVG, figureForWorkspace, pdfAttachment, readFigureManifest } from './figure-manifest.js';
import { addPanel, createFigure, figureMarks, figureSVG } from './figures.js';
import { writePDF } from './pdf.js';
import { pdfPage } from './draw.js';
import { encodePNG } from './png.js';
import { buildMapModel } from './map-model.js';
import { scoreExperiment, DEFAULT_PARAMETERS } from './score.js';

const target = { id: 't', name: 'Toy', sequenceType: 'protein', sequence: 'MSKG', offset: 100 };
const design = {
  format: 'mavescape-design', version: 1, name: 'toy', model: 'two-population',
  variants: { column: 'v', level: 'protein' }, targets: [target], library: { level: 'variant' },
  samples: ['in1', 'out1', 'in2', 'out2'].map((id) => ({ id, name: id, columns: [id] })),
  replicates: [{ id: 'r1', biological: 1, input: 'in1', output: 'out1' }, { id: 'r2', biological: 2, input: 'in2', output: 'out2' }],
  controls: { wildType: 'auto', synonymous: 'auto', nonsense: 'auto' },
};
const col = (...x) => Float64Array.from(x);
const results = scoreExperiment({ names: ['p.=', 'p.Ser2Ala', 'p.Lys3=', 'p.Gly4Asp'], columns: { in1: col(1000, 50, 60, 20), out1: col(1000, 30, 55, 10), in2: col(900, 45, 50, 22), out2: col(950, 25, 52, 11) }, design, parameters: DEFAULT_PARAMETERS }).results;
const model = buildMapModel(results, design);
const run = { id: 'run-a', name: 'Run 1', created: '2026-10-12T10:00:00.000Z', output: { sha256: 'a'.repeat(64) }, inputs: { source: { sha256: 'b'.repeat(64), name: 'counts' } } };
const ws = { id: 'ws-1', name: 'Toy', runs: [run], sources: [{ id: 's', sha256: 'b'.repeat(64) }], design, qc: null };

let fig = createFigure('Figure 1', 'single');
({ figure: fig } = addPanel(fig, { kind: 'map', run: 'run-a', h: 150 }));
({ figure: fig } = addPanel(fig, { kind: 'qc', subject: 'run-a', finding: 'agreement', findingTitle: 'Replicate agreement', h: 30 }));
const resolved = new Map([[fig.panels[0].id, { model, results, tracks: [] }], [fig.panels[1].id, { title: 'Replicate agreement', charts: [], reason: 'Agreement needs two replicates.' }]]);
const drawn = figureMarks(fig, resolved);
const context = { software: { version: '0.6.0', commit: 'abc1234' }, created: '2026-10-12T12:00:00.000Z' };
const record = buildManifest(ws, fig, drawn, context);

test('the manifest: the figure, each panel with what it shows, its inputs and its drawing\'s digest, a fingerprint', () => {
  assert.equal(record.format, 'mavescape-figure-manifest');
  assert.deepEqual(record.figure, fig);
  assert.deepEqual(record.panels.map((p) => [p.letter, p.kind, p.shows]), [['A', 'map', 'the map of Run 1'], ['B', 'qc', 'the QC finding "Replicate agreement" of Run 1']]);
  assert.deepEqual(record.panels[0].inputs.run, { id: 'run-a', name: 'Run 1', output: 'a'.repeat(64), table: 'b'.repeat(64), tableName: 'counts', others: [] });
  assert.match(record.panels[0].drawing, /^[0-9a-f]{64}$/);
  assert.equal(checkManifest(record).ok, true);
  const edited = { ...record, panels: record.panels.map((p, i) => (i ? p : { ...p, shows: 'something else' })) };
  assert.match(checkManifest(edited).problem, /changed after it was written/);
  assert.deepEqual(buildManifest(ws, fig, figureMarks(fig, resolved), context), record, 'the same figure, the same manifest');
});

test('embedded in SVG, PNG and PDF, and read back intact; JSON too; nothing from a file without one', async () => {
  const svg = embedSVG(await figureSVG(fig, resolved), record);
  assert.deepEqual(readFigureManifest(svg), record);
  assert.deepEqual(readFigureManifest(new TextEncoder().encode(svg)), record);
  const png = embedPNG(await encodePNG(new Uint8Array(4 * 4 * 4), 4, 4), record);
  assert.deepEqual(readFigureManifest(png), record);
  const pdf = await writePDF([pdfPage(drawn.marks, fig.width, fig.height)], { title: fig.name, date: new Date(context.created), attachments: [pdfAttachment(record)] });
  assert.deepEqual(readFigureManifest(pdf), record);
  assert.deepEqual(readFigureManifest(new TextEncoder().encode(JSON.stringify(record))), record);
  assert.equal(readFigureManifest(await figureSVG(fig, resolved)), null);
  assert.equal(readFigureManifest(await encodePNG(new Uint8Array(16), 2, 2)), null);
});

test('compared with a workspace: unchanged in its own; a run scored again since, thresholds changed, a run missing', () => {
  const same = compareManifest(record, ws);
  assert.equal(same.sameWorkspace, true);
  assert.deepEqual(same.panels.map((p) => p.status), ['unchanged', 'unchanged']);
  const later = { ...run, id: 'run-b', name: 'Run 2', created: '2026-10-12T13:00:00.000Z', output: { sha256: 'c'.repeat(64) } };
  const moved = compareManifest(record, { ...ws, runs: [run, later], qc: { thresholds: { agreement: { review: 0.9, fail: 0.7 } } } });
  assert.deepEqual(moved.panels.map((p) => p.status), ['changed', 'changed']);
  assert.match(moved.panels[0].changes[0], /scored again since \(Run 2\)/);
  assert.ok(moved.panels[1].changes.includes('the QC thresholds changed since'));
  const elsewhere = compareManifest(record, { ...ws, id: 'ws-2', runs: [later] });
  assert.equal(elsewhere.sameWorkspace, false);
  assert.equal(elsewhere.panels[0].status, 'missing');
  assert.match(elsewhere.panels[0].changes[0], /Run 1 \(output aaaaaaaaaaaa…\) is not in this workspace/);
});

test('a copy of the workspace: its run found by its output, the figure drawn again the same', () => {
  const copied = { ...run, id: 'run-copy' };
  const comparison = compareManifest(record, { ...ws, id: 'ws-3', runs: [copied] });
  assert.equal(comparison.panels[0].status, 'unchanged');
  const rebuilt = figureForWorkspace(record, comparison, { id: 'figure-rebuilt', name: 'Figure 1 (rebuilt)' });
  assert.equal(rebuilt.panels[0].run, 'run-copy');
  assert.equal(rebuilt.panels[1].subject, 'run-copy');
  const again = figureMarks(rebuilt, new Map([[rebuilt.panels[0].id, { model, results, tracks: [] }], [rebuilt.panels[1].id, resolved.get(fig.panels[1].id)]]));
  assert.deepEqual(compareDrawings(record, rebuilt, again).map((p) => p.same), [true, true]);
  const otherModel = buildMapModel(results, design, { colorBy: 'se' });
  const differently = figureMarks(rebuilt, new Map([[rebuilt.panels[0].id, { model: otherModel, results, tracks: [] }], [rebuilt.panels[1].id, resolved.get(fig.panels[1].id)]]));
  assert.deepEqual(compareDrawings(record, rebuilt, differently).map((p) => p.same), [false, true]);
});
