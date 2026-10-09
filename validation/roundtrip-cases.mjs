// A workspace built as the window builds one (validation suite `roundtrip`, wave 1 slice 8): a
// table imported, its target, its design, a score run, a saved selection, changed QC thresholds;
// and every export of it, so that a saved, reopened workspace can be exported again and compared
// byte for byte.

import { columnText, parseTable } from '../web/lib/csv.js';
import { assembleTable } from '../web/lib/assemble.js';
import { reviewImport, suggestRoles } from '../web/lib/importer.js';
import { scoreExperiment, DEFAULT_PARAMETERS } from '../web/lib/score.js';
import { computeQC } from '../web/lib/qc.js';
import { findingsFrom, measuresOf, withDefaultThresholds } from '../web/lib/findings.js';
import { addRun, makeRun, recordedInputs, runInputs } from '../web/lib/runs.js';
import { addSelection, addSource, addTarget, createWorkspace, setDesign, setQcThresholds } from '../web/lib/workspace.js';
import { barcodesCSV, countsCSV, provenanceJSON, provenanceText, qcSamplesCSV, qcVariantsCSV, scoresCSV, selectionCSV, selectionJSON } from '../web/lib/exports.js';
import { writeMethods } from '../web/lib/methods.js';
import { buildMapModel } from '../web/lib/map-model.js';
import { mapSVG } from '../web/lib/map-svg.js';
import { sha256 } from '../web/lib/sha256.js';

export const SOFTWARE = { version: '0.1.0', commit: '0123456789abcdef' };

const columnsFor = (table, design) => {
  const out = {};
  for (const s of design.samples) for (const c of s.columns) out[c] = table.columns.find((x) => x.name === c).numeric;
  return out;
};

// The engine's input, as the window's (web/ui/score-input.js): names, a table of barcodes'
// barcodes, the count columns.
export const inputFor = (table, design) => ({
  names: columnText(table.columns.find((c) => c.name === design.variants.column)),
  barcodes: design.library?.level === 'barcode' ? columnText(table.columns.find((c) => c.name === design.library.barcodeColumn)) : null,
  columns: columnsFor(table, design),
});

export function scoreTable(table, design, parameters, mode = 'lenient') {
  return scoreExperiment({ ...inputFor(table, design), design, parameters, mode });
}

// The workspace, built with fixed times so that it is the same every time.
export function buildWorkspace({ bytes, design, fileName, name }) {
  const table = parseTable(bytes, { fileName });
  const countColumns = design.samples.flatMap((s) => s.columns);
  const review = reviewImport(table, { variantColumn: design.variants.column, level: design.variants.level, countColumns, target: design.targets[0] });
  let ws = createWorkspace(name, { now: '2026-10-09T12:00:00.000Z', id: `ws-roundtrip-${design.targets[0].id}` });
  const target = addTarget(ws, design.targets[0]);
  ws = target.ws;
  const hash = sha256(bytes);
  const source = {
    name: fileName, fileName, sha256: hash, size: bytes.length, files: [{ fileName, sha256: hash, size: bytes.length }], rows: table.rows,
    columns: table.columns.map((c) => ({ name: c.name, type: c.type, missing: c.missing })), encoding: 'utf-8', delimiter: table.delimiter, lineEnd: table.lineEnd,
    mapping: { variantColumn: design.variants.column, level: design.variants.level, mode: 'lenient', countColumns, scoreColumns: {} },
    target: target.id, roleSuggestions: suggestRoles(countColumns).filter((r) => r.role), summary: review.summary,
    problems: { blocking: review.blocking.map((p) => p.message), warnings: review.warnings.map((p) => p.message) }, imported: '2026-10-09T12:00:00.000Z',
  };
  const added = addSource(ws, source);
  ws = setDesign(added.ws, design, 'The design', added.id);
  const scored = scoreTable(table, design, DEFAULT_PARAMETERS);
  if (!scored.ok) throw new Error(scored.errors.join(' '));
  const run = makeRun({ inputs: runInputs({ source: ws.sources[0], design, parameters: DEFAULT_PARAMETERS }), source: ws.sources[0], results: scored.results, software: SOFTWARE, name: 'Run 1', created: '2026-10-09T12:05:00.000Z' });
  ws = addRun(ws, run).ws;
  const keys = scored.results.variants.key.filter((k, i) => k && scored.results.variants.position[i] >= 3 && scored.results.variants.position[i] <= 5);
  ws = addSelection(ws, { name: 'Positions 3–5', run: run.id, condition: 0, keys, created: '2026-10-09T12:06:00.000Z' }).ws;
  ws = setQcThresholds(ws, { ...withDefaultThresholds(null), agreement: { review: 0.85, fail: 0.5 } }, 'QC: replicate agreement review level 0.8 → 0.85');
  return { ws, table, results: scored.results, run, bytes };
}

// Every export of a workspace's (first) run, as { name: text }.
export function allExports(ws, table, results) {
  const run = ws.runs[0];
  const thresholds = withDefaultThresholds(ws.qc?.thresholds);
  const qc = computeQC({ ...inputFor(table, run.inputs.design), design: run.inputs.design, results, measures: measuresOf(thresholds) });
  const findings = findingsFrom(qc, thresholds);
  const methods = writeMethods(ws, run, { findings, thresholds });
  const scores = scoresCSV(results, run);
  const selection = ws.selections[0];
  return {
    'scores.csv': scores,
    'counts.csv': countsCSV(table, run.inputs.design),
    'qc_samples.csv': qcSamplesCSV(qc),
    'qc_variants.csv': qcVariantsCSV(results, run),
    'provenance.json': provenanceText(provenanceJSON(run, ws, { qc, findings, thresholds, files: [{ path: 'scores.csv', sha256: sha256(new TextEncoder().encode(scores)) }] })),
    'methods.md': methods.markdown,
    'references.bib': methods.bibtex,
    'selection.csv': selectionCSV(selection.keys, results, run, selection.condition),
    'selection.json': selectionJSON(selection, run),
    'map.svg': mapSVG(buildMapModel(results, run.inputs.design), { results }),
    ...(results.barcodes ? { 'barcodes.csv': barcodesCSV(results, run) } : {}),
    methods,
  };
}

// A run's scores recomputed from an archive's own files (assembled as the window assembles them:
// joined, named, a barcode map applied) and the run's recorded inputs.
export function recompute(ws, sources, which = 0) {
  const run = ws.runs[which];
  const recorded = recordedInputs(run);
  const source = ws.sources.find((s) => s.sha256 === recorded.source.sha256);
  const files = source?.files?.length ? source.files : [{ fileName: run.inputs.source.fileName, sha256: recorded.source.sha256 }];
  const m = source?.mapping ?? {};
  const assembled = assembleTable(files.map((f) => ({ name: f.fileName, table: parseTable(sources.get(f.sha256), { fileName: f.fileName }), role: f.role ?? 'counts' })), { absentMeans: m.absentMeans ?? 'missing', level: m.level, target: ws.targets.find((t) => t.id === source?.target), barcodeColumn: m.barcodeColumn, map: m.assembly?.map });
  const table = assembled.table;
  return { table, scored: scoreTable(table, recorded.design, recorded.parameters, recorded.mapping.mode) };
}
