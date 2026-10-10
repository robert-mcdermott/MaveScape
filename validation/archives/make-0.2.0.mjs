// Writes a workspace archive with MaveScape 0.2.0's own code (run from a v0.2.0 checkout), so that
// later versions must reopen it and reproduce its runs (roadmap, "In every wave"). It holds what
// 0.2 brought, each kind of source and run:
//   - the GRB2 SH3 example scored with the defaults (the moderated combination, each score's
//     degrees of freedom) and with DiMSum's model, a selection, a changed QC threshold and an
//     acknowledged finding;
//   - the Hsp90 example, its codon variants read at the protein level, a time series scored per
//     generation from one replicate;
//   - the two-condition fixture, compared by limma;
//   - the barcode fixture with its barcode-to-variant map, each barcode scored and combined;
//   - the sort-seq fixture, sorted bins by their weighted average.
// Usage: node make-0.2.0.mjs <v0.2.0 checkout> <out.msz> [commit]
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [root, out, commit = ''] = process.argv.slice(2);
const lib = (p) => import(pathToFileURL(join(root, p)).href);
const { fixClock } = await lib('web/lib/clock.js');
const { parseTable } = await lib('web/lib/csv.js');
const { assembleTable } = await lib('web/lib/assemble.js');
const { reviewImport } = await lib('web/lib/importer.js');
const { sha256 } = await lib('web/lib/sha256.js');
const { scoreExperiment, defaultParameters, withDefaults, PRESETS } = await lib('web/lib/score.js');
const { addRun, makeRun, runInputs } = await lib('web/lib/runs.js');
const { acknowledgeFinding, addSelection, addSource, addTarget, createWorkspace, setDesign, setQcThresholds } = await lib('web/lib/workspace.js');
const { computeQC } = await lib('web/lib/qc.js');
const { findingsFrom, withDefaultThresholds } = await lib('web/lib/findings.js');
const { writeArchive } = await lib('web/lib/archive.js');
const { writeMethods } = await lib('web/lib/methods.js');
const { inputFor } = await lib('validation/roundtrip-cases.mjs');

fixClock('2026-10-10T12:00:00.000Z');
const SOFTWARE = { version: '0.2.0', commit };
const read = (path) => new Uint8Array(readFileSync(join(root, path)));
const json = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));
const sources = new Map();
let ws = createWorkspace('Every kind of 0.2 source and run (saved by MaveScape 0.2.0)', { now: '2026-10-10T12:00:00.000Z', id: 'ws-release-0-2-0' });
const results = new Map();

// A source imported as the window imports it: its files assembled, its target, its review.
function importSource(name, files, design, assembly = {}) {
  const target = addTarget(ws, design.targets[0]);
  ws = target.ws;
  const parts = files.map((f) => ({ ...f, bytes: read(f.path), fileName: f.path.split('/').pop() }));
  const assembled = assembleTable(parts.map((p) => ({ name: p.fileName, table: parseTable(p.bytes, { fileName: p.fileName }), role: p.role ?? 'counts' })), { level: design.variants.level, target: design.targets[0], ...assembly });
  if (!assembled.table) throw new Error(`${name}: ${assembled.problems.map((p) => p.message).join(' ')}`);
  const table = assembled.table;
  const countColumns = design.samples.flatMap((s) => s.columns);
  const barcodeColumn = design.library?.level === 'barcode' ? design.library.barcodeColumn : undefined;
  const review = reviewImport(table, { variantColumn: design.variants.column, level: design.variants.level, countColumns, target: design.targets[0], barcodeColumn });
  for (const p of parts) sources.set(sha256(p.bytes), p.bytes);
  const stored = parts.map((p) => ({ fileName: p.fileName, sha256: sha256(p.bytes), size: p.bytes.length, ...(p.role === 'map' ? { role: 'map' } : {}) }));
  const added = addSource(ws, {
    name, fileName: stored[0].fileName, sha256: stored[0].sha256, size: stored[0].size, files: stored, rows: table.rows,
    columns: table.columns.map((c) => ({ name: c.name, type: c.type, missing: c.missing })), encoding: 'utf-8', delimiter: table.delimiter, lineEnd: table.lineEnd,
    mapping: {
      variantColumn: design.variants.column, level: design.variants.level, mode: 'lenient', countColumns, scoreColumns: {},
      ...(barcodeColumn ? { barcodeColumn } : {}),
      ...(assembled.map ? { assembly: { kind: assembled.kind, map: { barcodeColumn: assembled.map.mapBarcodeColumn, variantColumn: assembled.map.mapVariantColumn } } } : {}),
      ...(assembled.kind === 'codons' ? { assembly: { kind: 'codons', codons: assembly.codons } } : {}),
    },
    target: target.id, summary: review.summary,
    problems: { blocking: review.blocking.map((p) => p.message), warnings: review.warnings.map((p) => p.message) }, imported: '2026-10-10T12:00:00.000Z',
  });
  ws = setDesign(added.ws, { ...design, targets: [{ ...design.targets[0], id: target.id }] }, `The design of ${name}`, added.id);
  return { source: ws.sources.find((s) => s.id === added.id), table, design: ws.design };
}

// A run of a source with parameters (MaveScape's defaults and those given).
function score(imported, name, extra = {}, created) {
  const { source, table, design } = imported;
  const parameters = withDefaults({ ...defaultParameters(design, source), ...extra });
  const scored = scoreExperiment({ ...inputFor(table, design), design, parameters, mode: 'lenient' });
  if (!scored.ok) throw new Error(`${name}: ${scored.errors.join(' ')}`);
  const run = makeRun({ inputs: runInputs({ source, design, parameters }), source, results: scored.results, software: SOFTWARE, name, created });
  ws = addRun(ws, run).ws;
  results.set(run.id, scored.results);
  return { run, results: scored.results };
}

const barcodes = importSource('Barcode fixture with its map', [{ path: 'validation/fixtures/barcodes.csv' }, { path: 'validation/fixtures/barcodes.map.csv', role: 'map' }], json('validation/fixtures/barcodes.design.json'));
score(barcodes, 'Barcodes, each scored and combined', { aggregation: 'barcode' }, '2026-10-10T12:01:00.000Z');
const bins = importSource('Sort-seq fixture', [{ path: 'validation/fixtures/sort-seq.csv' }], json('validation/fixtures/sort-seq.design.json'));
score(bins, 'Sorted bins', {}, '2026-10-10T12:02:00.000Z');
const conditions = importSource('Two-condition fixture', [{ path: 'validation/fixtures/two-condition.csv' }], json('validation/fixtures/two-condition.design.json'));
score(conditions, 'Two conditions, limma', {}, '2026-10-10T12:03:00.000Z');
const hsp90 = importSource('Hsp90 (codon variants)', [{ path: 'web/examples/hsp90/counts.csv' }], json('web/examples/hsp90/design.json'), { codons: { from: 'hgvs_nt' } });
score(hsp90, 'Hsp90 per generation', { timeScale: 'unit' }, '2026-10-10T12:04:00.000Z');
// GRB2 last: the workspace's design, its runs, selection, threshold and acknowledgement.
const grb2 = importSource('GRB2 SH3 domain counts', [{ path: 'web/examples/grb2-sh3/counts.csv' }], json('web/examples/grb2-sh3/design.json'));
score(grb2, 'DiMSum-compatible', { ...PRESETS.dimsum.parameters, model: 'dimsum' }, '2026-10-10T12:05:00.000Z');
const first = score(grb2, 'Run 1', {}, '2026-10-10T12:06:00.000Z');
const keys = first.results.variants.key.filter((k, i) => k && first.results.variants.position[i] >= 3 && first.results.variants.position[i] <= 5);
ws = addSelection(ws, { name: 'Positions 3–5', run: first.run.id, condition: 0, keys, created: '2026-10-10T12:07:00.000Z' }).ws;
ws = setQcThresholds(ws, { ...withDefaultThresholds(null), agreement: { review: 0.85, fail: 0.5 } }, 'QC: replicate agreement review level 0.8 → 0.85');
const qc = computeQC({ ...inputFor(grb2.table, grb2.design), design: grb2.design, results: first.results });
const finding = findingsFrom(qc, withDefaultThresholds(ws.qc?.thresholds)).find((f) => f.id === 'excess-variance');
ws = acknowledgeFinding(ws, finding, 'The input bottleneck the Domainome\'s own analysis reported', '2026-10-10T12:08:00.000Z');

const methods = writeMethods(ws, first.run, { results: first.results });
const archive = await writeArchive(ws, { software: SOFTWARE, sources, results, methods: { markdown: methods.markdown, bibtex: methods.bibtex } });
writeFileSync(out, archive.bytes);
console.log(`${out}: ${archive.bytes.length} bytes; ${ws.sources.length} sources; runs ${ws.runs.map((r) => `${r.name} ${r.output.sha256.slice(0, 12)}`).join(', ')}`);
