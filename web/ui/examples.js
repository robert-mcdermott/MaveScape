// Opening a bundled example (lib/examples.js) as a new workspace: its counts imported into the
// library, its target, its design, and a first score run with MaveScape's defaults, then the view
// it opens in; and the example's guide in the inspector (its question, steps, what to expect,
// source, license and citation; for the simulated one, how close the scores come to the truth).

import { h, icon, downloadBlob } from './dom.js';
import { progressToast, toast } from './overlays.js';
import { EXAMPLES, exampleById, simulatedExample } from '../lib/examples.js';
import { parseTable } from '../lib/csv.js';
import { detectLayout, reviewImport, suggestRoles } from '../lib/importer.js';
import { sha256 } from '../lib/sha256.js';
import { addRun, makeRun, runInputs } from '../lib/runs.js';
import { defaultParameters } from '../lib/score.js';
import { addSource, addTarget, change, createWorkspace, setDesign } from '../lib/workspace.js';
import { pearson } from '../lib/stats.js';
import { workerInput } from './score-input.js';
import { runEntry } from './run-results.js';

const fetchBytes = async (path) => {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path} is not in this build of MaveScape.`);
  return new Uint8Array(await response.arrayBuffer());
};

// Returns { ok, message }.
export async function openExample(app, id) {
  const example = exampleById(id);
  if (!example) return { ok: false, message: `No example "${id}".` };
  const busy = progressToast(`Opening the example "${example.title}"…`);
  try {
    let bytes;
    let design;
    let truth = null;
    if (example.simulated) {
      const sim = simulatedExample(example);
      bytes = new TextEncoder().encode(sim.csv);
      design = sim.design;
      truth = sim.truth;
    } else {
      bytes = await fetchBytes(example.files.counts);
      design = JSON.parse(new TextDecoder().decode(await fetchBytes(example.files.design)));
    }
    const fileName = example.simulated ? 'simulated-counts.csv' : 'counts.csv';
    const table = parseTable(bytes, { fileName });
    const layout = detectLayout(table);
    const countColumns = design.samples.flatMap((s) => s.columns);
    const review = reviewImport(table, { variantColumn: design.variants.column, level: design.variants.level, countColumns, target: design.targets[0] });
    const hash = sha256(bytes);
    await app.library.putFile(hash, bytes);
    await app.saveNow();
    let ws = createWorkspace(example.title);
    const target = addTarget(ws, design.targets[0]);
    ws = target.ws;
    const source = {
      name: example.simulated ? 'Simulated counts (simulated data)' : `${example.title}: counts`,
      fileName,
      sha256: hash,
      size: bytes.length,
      files: [{ fileName, sha256: hash, size: bytes.length }],
      rows: table.rows,
      columns: table.columns.map((c) => ({ name: c.name, type: c.type, missing: c.missing })),
      encoding: 'utf-8',
      delimiter: table.delimiter,
      lineEnd: table.lineEnd,
      layout: layout.layout,
      mapping: { variantColumn: design.variants.column, level: design.variants.level, mode: 'lenient', countColumns, scoreColumns: {} },
      target: target.id,
      roleSuggestions: suggestRoles(countColumns).filter((r) => r.role),
      summary: review.summary,
      problems: { blocking: review.blocking.map((p) => p.message), warnings: review.warnings.map((p) => p.message) },
      imported: new Date().toISOString(),
    };
    const added = addSource(ws, source);
    ws = setDesign(added.ws, { ...design, targets: [{ ...design.targets[0], id: target.id }] }, `The design of the example "${example.title}"`, added.id);
    ws = change(ws, { example: { id: example.id, simulated: example.simulated, truth } }, 'example', `Opened the example "${example.title}"${example.simulated ? ' (simulated data)' : ` (${example.source}, ${example.license})`}`);
    // A first score run with MaveScape's defaults.
    const { names, columns, transfer } = workerInput(table, ws.design);
    const parameters = defaultParameters(ws.design, ws.sources[0]);
    const result = await app.worker('score').run('score', { names, columns, design: ws.design, parameters, mode: 'lenient' }, { transfer }).promise;
    if (result.ok) {
      const run = makeRun({ inputs: runInputs({ source: ws.sources[0], design: ws.design, parameters }), source: ws.sources[0], results: result.results, software: { version: app.version, commit: app.commit }, name: 'Run 1' });
      ws = addRun(ws, run).ws;
      app.runResults ??= new Map();
      app.runResults.set(run.id, { results: result.results, status: 'computed' });
    }
    await app.loadWorkspace(ws);
    app.tables.set(ws.sources[0].id, { table, review });
    // A new workspace: not in the library until it is saved.
    app.store.markSaved(null);
    await app.saveNow();
    await app.setMode(example.opens);
    busy.done(`Opened the example "${example.title}". Its guide is in the inspector.`);
    return { ok: true, message: `Opened the example "${example.title}"${result.ok ? ', scored with MaveScape\'s defaults' : ''}.` };
  } catch (error) {
    busy.fail(`The example could not be opened: ${error.message}`);
    return { ok: false, message: `The example could not be opened: ${error.message}` };
  }
}

// The guide of the open example, as an inspector section (null when the workspace is not one).
export function exampleGuide(app) {
  const info = app.store.ws.example;
  const example = info ? exampleById(info.id) : null;
  if (!example) return null;
  let truthLine = null;
  if (info.truth) {
    const run = app.store.ws.runs[0];
    const results = run ? runEntry(app, run)?.results : null;
    if (results) {
      const c = results.conditions[0];
      const a = [];
      const b = [];
      results.variants.key.forEach((k, i) => {
        if (c.reason[i] || !(k in info.truth) || k === 'p.=') return;
        a.push(c.score[i]);
        b.push(info.truth[k]);
      });
      truthLine = h('div.callout.ok', { style: { margin: '8px 0', fontSize: '12px' } }, icon('check'), h('span', `${run.name}'s scores against the simulated true effects: Pearson r = ${pearson(a, b).toFixed(3)} over ${a.length} variants.`));
    }
  }
  return h('section.inspector-section.example-guide',
    h('h3', icon('school'), 'Example', example.simulated ? h('span.badge.warn', 'simulated data') : h('span.badge.accent', example.license)),
    h('p', { style: { margin: '0 0 6px', fontWeight: 600 } }, example.question),
    truthLine,
    h('ol.example-steps', ...example.steps.map(([mode, text]) => h('li', h('span', text), h('button.btn.small', { type: 'button', onclick: () => app.setMode(mode) }, `Open ${mode === 'qc' ? 'QC' : mode[0].toUpperCase() + mode.slice(1)}`)))),
    h('details', h('summary', 'What to expect'), h('ul.summary-lines', ...example.expected.map((x) => h('li', x)))),
    h('p.muted', { style: { fontSize: '11.5px', margin: '8px 0 0' } }, `Source: ${example.source}. License: ${example.license}.${example.citation ? ` Cite: ${example.citation}.` : ''}`),
    example.files?.notice ? h('div.btn-row', { style: { marginTop: '6px' } }, h('button.btn.small', { type: 'button', onclick: async () => downloadBlob(new Blob([await fetchBytes(example.files.notice)], { type: 'text/plain' }), 'NOTICE.txt') }, icon('download'), 'Notice'),
      h('button.btn.small', { type: 'button', onclick: async () => downloadBlob(new Blob([await fetchBytes(example.files.counts)], { type: 'text/csv' }), `${example.id}-counts.csv`) }, icon('download'), 'The counts')) : null,
    info.truth ? h('div.btn-row', { style: { marginTop: '6px' } }, h('button.btn.small', { type: 'button', onclick: () => downloadBlob(new Blob([`hgvs_pro,true_effect\n${Object.entries(info.truth).map(([k, v]) => `${k},${v}`).join('\n')}\n`], { type: 'text/csv' }), 'simulated-truth.csv') }, icon('download'), 'The true effects (simulated)')) : null);
}

export const LAYOUTS = [
  ['examples/layouts/count-table.csv', 'Count table', 'One row per variant, one column per sample; MAVE-HGVS names; NA for a missing count.'],
  ['examples/layouts/sample-sheet.csv', 'Sample sheet', 'One row per sample: its column, role, replicate, and optionally time, bin, condition, tile.'],
  ['examples/layouts/target.fasta', 'Target FASTA', 'The sequence the variants are named against, protein or DNA, with its reference numbering in the header.'],
];

export async function downloadLayout(path) {
  try {
    downloadBlob(new Blob([await fetchBytes(path)], { type: path.endsWith('.csv') ? 'text/csv' : 'text/plain' }), path.split('/').pop());
  } catch (error) {
    toast(error.message, { kind: 'error' });
  }
}

export { EXAMPLES };
