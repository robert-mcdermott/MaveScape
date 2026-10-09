// The record in the window (wave 1, slice 8): the workspace archive (.msz) written and opened, and
// a run's files exported (scores and counts in MaveDB's columns, QC per sample and per variant,
// provenance, the methods with their references). Built on lib/archive.js, lib/exports.js and
// lib/methods.js.

import { h, downloadBlob } from './dom.js';
import { progressToast, showDialog, toast } from './overlays.js';
import { readArchive, writeArchive } from '../lib/archive.js';
import { countsCSV, provenanceJSON, provenanceText, qcSamplesCSV, qcVariantsCSV, scoresCSV, selectionCSV, selectionJSON } from '../lib/exports.js';
import { writeMethods } from '../lib/methods.js';
import { findingsFrom, measuresOf, withDefaultThresholds } from '../lib/findings.js';
import { sha256 } from '../lib/sha256.js';
import { change } from '../lib/workspace.js';
import { ensureResults } from './run-results.js';
import { workerInput } from './score-input.js';

const encoder = new TextEncoder();
const safe = (s) => String(s).replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'export';

// QC of a run (its recorded inputs), for provenance and methods: { qc, findings, thresholds }.
async function qcOf(app, run) {
  const source = app.store.ws.sources.find((s) => s.sha256 === run.inputs.source.sha256);
  if (!source) return null;
  const table = await app.sourceTable(source);
  const { names, columns, transfer } = workerInput(table, run.inputs.design);
  const thresholds = withDefaultThresholds(app.store.ws.qc?.thresholds);
  const result = await app.worker('score').run('qc', { names, columns, design: run.inputs.design, mode: run.inputs.mapping.mode, parameters: run.inputs.parameters, measures: measuresOf(thresholds) }, { transfer }).promise;
  return { qc: result.qc, findings: findingsFrom(result.qc, thresholds), thresholds };
}

// The methods of a run, with its QC findings.
export async function methodsOf(app, run) {
  const q = await qcOf(app, run).catch(() => null);
  return writeMethods(app.store.ws, run, { findings: q?.findings ?? null, thresholds: q?.thresholds ?? null });
}

// --- A run's files ------------------------------------------------------------------------------

export async function exportRunFile(app, run, kind, condition = 0) {
  const entry = await ensureResults(app, run);
  if (!entry?.results) {
    toast(`${run.name}'s scores could not be recomputed: ${entry?.message ?? 'unknown'}`, { kind: 'error' });
    return;
  }
  const results = entry.results;
  const base = `${safe(app.store.ws.name)}_${safe(run.name)}${results.conditions.length > 1 ? `_${safe(results.conditions[condition].name)}` : ''}`;
  const busy = progressToast('Preparing the export…');
  try {
    if (kind === 'scores') downloadBlob(new Blob([scoresCSV(results, run, condition)], { type: 'text/csv' }), `${base}_scores.csv`);
    else if (kind === 'counts') {
      const source = app.store.ws.sources.find((s) => s.sha256 === run.inputs.source.sha256);
      downloadBlob(new Blob([countsCSV(await app.sourceTable(source), run.inputs.design)], { type: 'text/csv' }), `${base}_counts.csv`);
    } else if (kind === 'qc-samples' || kind === 'qc-variants') {
      if (kind === 'qc-variants') downloadBlob(new Blob([qcVariantsCSV(results, run, condition)], { type: 'text/csv' }), `${base}_qc_variants.csv`);
      else {
        const q = await qcOf(app, run);
        downloadBlob(new Blob([qcSamplesCSV(q.qc)], { type: 'text/csv' }), `${base}_qc_samples.csv`);
      }
    } else if (kind === 'provenance') {
      const q = await qcOf(app, run).catch(() => null);
      const scores = scoresCSV(results, run, condition);
      const doc = provenanceJSON(run, app.store.ws, { qc: q?.qc, findings: q?.findings, thresholds: q?.thresholds, files: [{ path: `${base}_scores.csv`, sha256: sha256(encoder.encode(scores)) }] });
      downloadBlob(new Blob([provenanceText(doc)], { type: 'application/json' }), `${base}_provenance.json`);
    } else if (kind === 'methods') {
      const m = await methodsOf(app, run);
      downloadBlob(new Blob([m.markdown], { type: 'text/markdown' }), `${base}_methods.md`);
      downloadBlob(new Blob([m.bibtex], { type: 'application/x-bibtex' }), `${base}_references.bib`);
    }
    busy.done('Exported.');
  } catch (error) {
    busy.fail(`The export failed: ${error.message}`);
  }
}

export function runExportItems(app, run, condition = 0) {
  return [
    { section: 'MaveDB columns' },
    { label: 'Scores (CSV)', icon: 'download', onSelect: () => exportRunFile(app, run, 'scores', condition) },
    { label: 'Counts scored (CSV)', icon: 'download', onSelect: () => exportRunFile(app, run, 'counts', condition) },
    '-',
    { section: 'Quality control' },
    { label: 'QC per sample (CSV)', icon: 'download', onSelect: () => exportRunFile(app, run, 'qc-samples', condition) },
    { label: 'QC per variant (CSV)', icon: 'download', onSelect: () => exportRunFile(app, run, 'qc-variants', condition) },
    '-',
    { section: 'Record' },
    { label: 'Provenance (JSON)', icon: 'download', onSelect: () => exportRunFile(app, run, 'provenance', condition) },
    { label: 'Methods and references (.md, .bib)', icon: 'download', onSelect: () => exportRunFile(app, run, 'methods', condition) },
  ];
}

export async function exportSelection(app, selection, format) {
  const run = app.store.ws.runs.find((r) => r.id === selection.run);
  if (format === 'json') {
    downloadBlob(new Blob([selectionJSON(selection, run)], { type: 'application/json' }), `${safe(selection.name ?? 'selection')}.json`);
    return;
  }
  const entry = run ? await ensureResults(app, run) : null;
  if (!entry?.results) {
    toast('The selection\'s run could not be recomputed, so its scores cannot be exported.', { kind: 'error' });
    return;
  }
  downloadBlob(new Blob([selectionCSV(selection.keys, entry.results, run, selection.condition ?? 0)], { type: 'text/csv' }), `${safe(selection.name ?? 'selection')}.csv`);
}

// --- The archive ---------------------------------------------------------------------------------

export async function exportArchive(app, { includeTables = true } = {}) {
  const ws = app.store.ws;
  const busy = progressToast('Writing the workspace archive…');
  try {
    let sources = null;
    if (includeTables) {
      sources = new Map();
      for (const s of ws.sources) {
        for (const f of s.files?.length ? s.files : [s]) {
          const bytes = await app.library.getFile(f.sha256);
          if (!bytes) throw new Error(`${f.fileName ?? s.name} is not in the library; export with checksums only.`);
          sources.set(f.sha256, bytes instanceof Uint8Array ? bytes : new Uint8Array(await new Response(bytes).arrayBuffer()));
        }
      }
    }
    const results = new Map();
    for (const run of ws.runs) {
      const entry = await ensureResults(app, run);
      if (entry?.results) results.set(run.id, entry.results);
    }
    const last = ws.runs.at(-1);
    const methods = last ? await methodsOf(app, last) : null;
    const { bytes } = await writeArchive(ws, { software: { version: app.version, commit: app.commit }, sources, results, methods });
    downloadBlob(new Blob([bytes], { type: 'application/zip' }), `${safe(ws.name)}.msz`);
    busy.done(`Wrote ${safe(ws.name)}.msz${includeTables ? '' : ' (tables by checksum only)'}.`);
  } catch (error) {
    busy.fail(`The archive could not be written: ${error.message}`);
  }
}

export function chooseArchiveExport(app) {
  const tables = h('input', { type: 'checkbox', checked: true });
  showDialog({
    title: 'Export the workspace archive (.msz)',
    content: [
      h('p', 'One file with everything needed to reopen this analysis on another computer: the workspace (targets, design, score runs, selections, QC thresholds and the chained history), each run\'s scores, the methods with references, and the tables.'),
      h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, tables, 'Include the count tables (otherwise each is named by its SHA-256 only, and must be opened again to rescore)'),
    ],
    buttons: [{ label: 'Cancel' }, { label: 'Export', primary: true, onClick: () => exportArchive(app, { includeTables: tables.checked }) }],
  });
}

// Opens .msz files: the tables into the library, the workspace into the window. A workspace whose
// id is already in the library opens as a copy, so that neither overwrites the other.
export async function openArchives(app, items) {
  for (const item of items) {
    const busy = progressToast(`Opening ${item.name}…`);
    try {
      const { ws, sources, problems } = await readArchive(await app.readBytes(item));
      for (const [hash, bytes] of sources) await app.library.putFile(hash, bytes);
      let doc = ws;
      const existing = (await app.library.listWorkspaces().catch(() => [])).some((x) => x.id === ws.id);
      if (existing) {
        doc = change({ ...ws, id: `ws-${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`, name: `${ws.name} (from ${item.name})` }, {}, 'open-archive', `Opened as a copy of workspace ${ws.id} from ${item.name}`);
      }
      await app.saveNow();
      await app.loadWorkspace(doc);
      // Not in the library until saved.
      app.store.markSaved(null);
      await app.saveNow();
      busy.done(`Opened ${item.name}${existing ? ' as a copy' : ''}.`);
      app.log(`Opened the archive ${item.name}: workspace ${ws.name}, ${ws.runs.length} runs, ${sources.size} tables${problems.length ? `; ${problems.length} problems` : ''}.`);
      if (problems.length) {
        showDialog({ title: `${item.name}: problems`, content: [h('p', 'The archive opened, but:'), h('ul', ...problems.map((p) => h('li', p)))] });
      }
    } catch (error) {
      busy.fail(`${item.name} could not be opened: ${error.message}`);
    }
  }
}

