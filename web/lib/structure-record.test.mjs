import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateSync } from 'node:zlib';
import { mappingChanges, mappingSummary, panelMetadata, PANEL_KEYWORD, pngTexts, pngWithText, structureWords, viewWords } from './structure-record.js';
import { createWorkspace, isEmptyWorkspace, removeStructureView, saveStructureView, verifyHistory } from './workspace.js';
import { readArchive, structureFiles, writeArchive } from './archive.js';
import { writeMethods } from './methods.js';
import { makeRun, runInputs } from './runs.js';
import { PRESETS, scoreExperiment } from './score.js';
import { crc32 } from './zip.js';
import { sha256 } from './sha256.js';

// A mapping of a 6-residue target (offset 100) on chain A, position 4 another residue.
const mapping = {
  chain: 'A',
  target: { name: 'Toy', length: 6, offset: 100, accession: 'P12345' },
  counts: { identical: 4 },
  aligned: 5,
  identity: 0.8,
  onStructure: 5,
  positions: [1, 2, 3, 4, 5, 6].map((position) => ({ position, reference: position + 100, code: 'MSKGAL'[position - 1], residue: position < 6 ? `A:${position}:ALA` : null, state: position === 6 ? 'unobserved' : position === 4 ? 'different' : 'identical', structureCode: position === 4 ? 'W' : 'MSKGAL'[position - 1] })),
};

test('a mapping in brief, and what changed since it was saved', () => {
  const m = mappingSummary(mapping);
  assert.deepEqual(m, { target: { name: 'Toy', length: 6, offset: 100, accession: 'P12345' }, chain: 'A', onStructure: 5, identical: 4, aligned: 5, identity: 0.8, positions: ['1–5'], reference: ['101–105'], differences: ['G4W'] });
  assert.deepEqual(mappingChanges(m, m), []);
  const other = mappingSummary({ ...mapping, chain: 'B', onStructure: 4, positions: mapping.positions.map((p) => (p.position === 5 ? { ...p, residue: null } : p)) });
  assert.deepEqual(mappingChanges(m, other).map((x) => x.split(' ')[0]), ['chain', 'onStructure', 'positions']);
  assert.match(mappingChanges(m, null)[0], /on no chain/);
  assert.equal(mappingSummary(null), null);
});

// A structure kept, as saving a view keeps it.
const kept = { id: 'pdb-1ABC', name: '1ABC', title: '1ABC: a toy', method: 'X-ray diffraction, 2 Å', origin: { kind: 'pdb', id: '1ABC', retrieval: { retrieved: '2026-10-12T00:00:00Z', source: 'https://files.rcsb.org/download/1ABC.cif.gz' } }, file: { fileName: '1ABC.cif.gz', sha256: 'a'.repeat(64), size: 10 } };
const view = (name, extra = {}) => ({ name, assembly: 'asym', chain: 'A', mapping: mappingSummary(mapping), camera: { target: [0, 0, 0], distance: 40, rotation: [0, 0, 0, 1] }, size: { width: 600, height: 400 }, style: 'cartoon', color: { scheme: 'scores', scores: { how: 'median' }, palette: 'rdbu', run: 'run-1', condition: 0, contrast: null }, surface: 'off', selection: ['A:1:ALA'], labels: [], styles: {}, focus: [], evidence: { choice: 'all', fraction: 0.2, seed: 1 }, ...extra });

test('saved views keep their structure while one shows it; a name used again saves the view again; each in the history', () => {
  let ws = createWorkspace('W', { now: '2026-10-12T00:00:00.000Z', id: 'ws-w' });
  assert.equal(isEmptyWorkspace(ws), true);
  const a = saveStructureView(ws, kept, view('Core'), '2026-10-12T01:00:00.000Z');
  ws = a.ws;
  assert.equal(isEmptyWorkspace(ws), false);
  assert.deepEqual([ws.structures.length, ws.structureViews.length, a.structure], [1, 1, 'pdb-1ABC']);
  const b = saveStructureView(ws, { ...kept, id: 'other' }, view('Surface', { selection: [] }), '2026-10-12T02:00:00.000Z');
  ws = b.ws;
  assert.equal(ws.structures.length, 1, 'the same file is kept once');
  ws = saveStructureView(ws, kept, view('Core', { labels: ['A:1:ALA'] }), '2026-10-12T03:00:00.000Z').ws;
  assert.equal(ws.structureViews.length, 2);
  assert.deepEqual(ws.structureViews.find((v) => v.name === 'Core').labels, ['A:1:ALA']);
  ws = removeStructureView(ws, 'Core');
  assert.equal(ws.structures.length, 1, 'kept while "Surface" shows it');
  ws = removeStructureView(ws, b.id);
  assert.equal(ws.structures, undefined);
  assert.equal(ws.structureViews, undefined);
  assert.deepEqual(ws.history.slice(1).map((h) => h.detail.split(' ').slice(0, 3).join(' ')), ['Saved the view', 'Saved the view', 'Saved again the', 'Removed the view', 'Removed the view']);
  assert.equal(verifyHistory(ws).ok, true);
});

test('a kept structure and a view in words', () => {
  assert.equal(structureWords(kept), `PDB 1ABC (RCSB PDB, retrieved 2026-10-12; SHA-256 ${'a'.repeat(64)})`);
  assert.equal(structureWords({ ...kept, origin: { kind: 'alphafold', id: 'P12345', version: 6, retrieval: null } }, { sha: false }), 'the AlphaFold DB model of P12345, version 6 (AlphaFold DB)');
  const ws = saveStructureView({ ...createWorkspace('W'), runs: [{ id: 'run-1', name: 'Run 1' }] }, kept, view('Core')).ws;
  assert.equal(viewWords(ws.structureViews[0], ws), '1ABC, chain A; colored by the median score of Run 1; 1 residue selected');
});

test('the structures\' files in the archive, or named by their checksums; their absence said', async () => {
  const file = new TextEncoder().encode('data_1ABC\n');
  const pae = new TextEncoder().encode('[{"predicted_aligned_error":[[0]]}]');
  const entry = { ...kept, file: { ...kept.file, sha256: sha256(file) }, pae: { fileName: 'pae.json', sha256: sha256(pae), size: pae.length } };
  const ws = saveStructureView(createWorkspace('W', { now: '2026-10-12T00:00:00.000Z', id: 'ws-w' }), entry, view('Core'), '2026-10-12T01:00:00.000Z').ws;
  assert.deepEqual(structureFiles(ws).map((f) => f.fileName), ['1ABC.cif.gz', 'pae.json']);
  const full = await writeArchive(ws, { sources: null, structures: new Map([[sha256(file), file], [sha256(pae), pae]]) });
  assert.equal(full.manifest.structures, 'included');
  assert.deepEqual(full.manifest.contents.map((c) => c.path), ['workspace.json', `sources/${sha256(file)}.cif.gz`, `sources/${sha256(pae)}.json`]);
  const read = await readArchive(full.bytes);
  assert.deepEqual(read.problems, []);
  assert.deepEqual(read.sources.get(sha256(file)), file);
  assert.deepEqual(read.ws.structureViews, ws.structureViews);
  const light = await writeArchive(ws, { sources: null, structures: null });
  assert.equal(light.manifest.structures, 'checksums');
  assert.deepEqual((await readArchive(light.bytes)).problems, []);
  await assert.rejects(writeArchive(ws, { sources: null, structures: new Map() }), /not in the library/);
});

test('the methods describe each structure, its file\'s SHA-256, the mapping its views were saved with, and how the structure was read', () => {
  const design = { format: 'mavescape-design', version: 1, name: 'toy', model: 'two-population', variants: { column: 'v', level: 'protein' }, targets: [{ id: 't', name: 'Toy', sequenceType: 'protein', sequence: 'MSKGAL', offset: 100 }], library: { level: 'variant' }, samples: [{ id: 'in', name: 'in', columns: ['in'] }, { id: 'out', name: 'out', columns: ['out'] }], replicates: [{ id: 'r1', biological: 1, input: 'in', output: 'out' }], controls: { wildType: 'auto', synonymous: 'auto', nonsense: 'auto' } };
  const source = { id: 's', name: 'c.csv', sha256: 'f'.repeat(64), rows: 2, mapping: { mode: 'lenient' } };
  const results = scoreExperiment({ names: ['p.=', 'p.Ser2Ala'], columns: { in: Float64Array.of(10, 10), out: Float64Array.of(10, 5) }, design, parameters: PRESETS.enrich2.parameters }).results;
  const run = makeRun({ inputs: runInputs({ source, design, parameters: PRESETS.enrich2.parameters }), source, results, software: { version: '0.5.0', commit: '' }, name: 'Run 1', created: '2026-10-12T00:00:00.000Z' });
  const ws = saveStructureView({ ...createWorkspace('m'), sources: [source], runs: [run] }, kept, view('Core', { color: { ...view('Core').color, run: run.id } })).ws;
  const m = writeMethods(ws, run);
  const structures = m.paragraphs.find((p) => p.startsWith('Structures:'));
  assert.match(structures, /PDB entry 1ABC \[\d+\] \(1ABC: a toy; X-ray diffraction, 2 Å\), retrieved from RCSB PDB 2026-10-12 \(its file's SHA-256 a{64}\)/);
  assert.match(structures, /BLOSUM62 \[\d+\], gap opening 12 and extension 1, free end gaps\) and placed on chain A: 5 of its 6 positions on residues \(target positions 1–5; 101–105 in the reference\), 4 identical \(80% identity over 5 aligned\), one residue different \(G4W\)/);
  assert.match(structures, /Saved views: "Core" \(1ABC, chain A; colored by the median score of Run 1; 1 residue selected\)\./);
  assert.match(m.paragraphs.find((p) => p.startsWith('What each structure says')), /DSSP's rules \[\d+\].*Shrake and Rupley's method \[\d+\].*Tien et al\. \[\d+\].*the 20% least tolerant, seed 1\)\.$/);
  for (const key of ['pdb', 'proteoscope', 'blosum62', 'dssp', 'shrake', 'tien', 'structuremap', 'plip', 'mannwhitney', 'bh']) assert.ok(m.references.some((r) => r.key === key), key);
  assert.equal(writeMethods({ ...ws, structures: undefined, structureViews: undefined }, run).paragraphs.some((p) => p.startsWith('Structures:')), false);
});

// A 1 × 1 PNG.
function tinyPNG() {
  const chunk = (type, data) => {
    const out = new Uint8Array(12 + data.length);
    const v = new DataView(out.buffer);
    v.setUint32(0, data.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(data, 8);
    v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
  const parts = [Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10), chunk('IHDR', ihdr), chunk('IDAT', new Uint8Array(deflateSync(Uint8Array.of(0, 255, 0, 0)))), chunk('IEND', new Uint8Array())];
  const total = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    total.set(p, at);
    at += p.length;
  }
  return total;
}

test('a figure panel\'s metadata travels inside its PNG (iTXt, UTF-8), read back; a damaged chunk is said', () => {
  const png = tinyPNG();
  const meta = panelMetadata({ ws: { id: 'ws-w', name: 'W' }, entry: kept, structure: { meta: { code: '1ABC', title: '1ABC: a toy' } }, origin: kept.origin, view: { name: 'Core' }, coloring: { kind: 'scores', how: 'median' }, legend: { title: 'Median score — 0.00 wild type, Å' }, image: { width: 1, height: 1, scale: 4 }, software: { version: '0.5.0' }, created: '2026-10-12T00:00:00Z' });
  const out = pngWithText(png, PANEL_KEYWORD, JSON.stringify(meta));
  assert.equal(out.length > png.length, true);
  const read = JSON.parse(pngTexts(out).get(PANEL_KEYWORD));
  assert.deepEqual(read, meta);
  assert.equal(read.structure.sha256, 'a'.repeat(64));
  assert.equal(read.legend.title, 'Median score — 0.00 wild type, Å');
  // The image is still the image: the chunks before the text unchanged, IEND last.
  assert.deepEqual(out.subarray(0, png.length - 12), png.subarray(0, png.length - 12));
  assert.deepEqual(out.subarray(-12), png.subarray(-12));
  const damaged = Uint8Array.from(out);
  damaged[png.length - 12 + 20] ^= 1;
  assert.throws(() => pngTexts(damaged), /damaged/);
  assert.throws(() => pngWithText(new Uint8Array(10), 'k', 'v'), /Not a PNG/);
});
