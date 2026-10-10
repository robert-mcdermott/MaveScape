// Opening a bundled example (lib/examples.js) as a new workspace: its counts imported into the
// library, its target, its design, and a first score run with MaveScape's defaults, then the view
// it opens in; and the example's guide in the inspector (its question, steps, what to expect,
// source, license and citation; for the simulated one, how close the scores come to the truth).

import { h, icon, downloadBlob } from './dom.js';
import { progressToast, toast } from './overlays.js';
import { EXAMPLES, exampleById, simulatedExample } from '../lib/examples.js';
import { parseTable } from '../lib/csv.js';
import { assembleTable } from '../lib/assemble.js';
import { detectLayout, reviewImport, suggestRoles } from '../lib/importer.js';
import { sha256 } from '../lib/sha256.js';
import { addRun, makeRun, runInputs } from '../lib/runs.js';
import { defaultParameters } from '../lib/score.js';
import { addSource, addTarget, change, createWorkspace, setDesign } from '../lib/workspace.js';
import { now } from '../lib/clock.js';
import { pearson } from '../lib/stats.js';
import { runScore, workerInput } from './score-input.js';
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
    // The example's files: its counts (and a barcoded library's barcode-to-variant map).
    let parts;
    let design;
    let truth = null;
    let truthOf = 'effect';
    if (example.simulated) {
      const sim = simulatedExample(example);
      parts = sim.files.map((f) => ({ name: f.name, bytes: new TextEncoder().encode(f.text), role: f.role }));
      design = sim.design;
      truth = sim.truth;
      truthOf = sim.truthOf;
    } else {
      parts = [{ name: 'counts.csv', bytes: await fetchBytes(example.files.counts), role: 'counts' }];
      design = JSON.parse(new TextDecoder().decode(await fetchBytes(example.files.design)));
    }
    const assembled = assembleTable(parts.map((p) => ({ name: p.name, table: parseTable(p.bytes, { fileName: p.name }), role: p.role })), { level: design.variants.level, target: design.targets[0] });
    const table = assembled.table;
    const layout = detectLayout(table);
    const countColumns = design.samples.flatMap((s) => s.columns);
    const barcodeColumn = design.library?.level === 'barcode' ? design.library.barcodeColumn : null;
    const review = reviewImport(table, { variantColumn: design.variants.column, level: design.variants.level, countColumns, target: design.targets[0], barcodeColumn });
    const stored = parts.map((p) => ({ fileName: p.name, sha256: sha256(p.bytes), size: p.bytes.length, ...(p.role === 'map' ? { role: 'map' } : {}) }));
    for (const [i, p] of parts.entries()) await app.library.putFile(stored[i].sha256, p.bytes);
    await app.saveNow();
    let ws = createWorkspace(example.title);
    const target = addTarget(ws, design.targets[0]);
    ws = target.ws;
    const source = {
      name: example.simulated ? `Simulated counts${assembled.map ? ' with a barcode map' : ''} (simulated data)` : `${example.title}: counts`,
      fileName: stored[0].fileName,
      sha256: stored[0].sha256,
      size: stored[0].size,
      files: stored,
      rows: table.rows,
      columns: table.columns.map((c) => ({ name: c.name, type: c.type, missing: c.missing })),
      encoding: 'utf-8',
      delimiter: table.delimiter,
      lineEnd: table.lineEnd,
      layout: layout.layout,
      mapping: {
        variantColumn: design.variants.column, level: design.variants.level, mode: 'lenient', countColumns, scoreColumns: {},
        ...(barcodeColumn ? { barcodeColumn } : {}),
        ...(assembled.map ? { assembly: { kind: assembled.kind, map: { barcodeColumn: assembled.map.mapBarcodeColumn, variantColumn: assembled.map.mapVariantColumn } } } : {}),
      },
      target: target.id,
      roleSuggestions: suggestRoles(countColumns).filter((r) => r.role),
      summary: review.summary,
      problems: { blocking: review.blocking.map((p) => p.message), warnings: [...review.warnings, ...assembled.problems.filter((p) => p.level === 'warning')].map((p) => p.message) },
      imported: now(),
    };
    const added = addSource(ws, source);
    ws = setDesign(added.ws, { ...design, targets: [{ ...design.targets[0], id: target.id }] }, `The design of the example "${example.title}"`, added.id);
    ws = change(ws, { example: { id: example.id, simulated: example.simulated, truth, ...(truthOf === 'differential' ? { truthOf } : {}) } }, 'example', `Opened the example "${example.title}"${example.simulated ? ' (simulated data)' : ` (${example.source}, ${example.license})`}`);
    // A first score run with MaveScape's defaults.
    const { names, barcodes, columns, transfer } = workerInput(table, ws.design);
    const parameters = defaultParameters(ws.design, ws.sources[0]);
    const result = await runScore(app, { names, barcodes, columns, design: ws.design, parameters, mode: 'lenient' }, { transfer }).promise;
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
    if (example.map) app.mapView = { ...(app.mapView ?? { rowOrder: 'biochemical', palette: 'rdbu', condition: 0, contrast: 0, show: 'all', page: 0 }), ...example.map };
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
    if (results && info.truthOf === 'differential' && results.differential?.length) {
      // Two conditions: the differences against the true ones, and the calls at q < 0.05.
      const d = results.differential[0];
      const a = [];
      const b = [];
      let site = 0;
      let found = 0;
      let others = 0;
      let called = 0;
      results.variants.key.forEach((k, i) => {
        if (d.reason[i] || !(k in info.truth) || k === 'p.=') return;
        a.push(d.delta[i]);
        b.push(info.truth[k]);
        if (info.truth[k] !== 0) {
          site += 1;
          if (d.q[i] < 0.05) found += 1;
        } else {
          others += 1;
          if (d.q[i] < 0.05) called += 1;
        }
      });
      truthLine = h('div.callout.ok', { style: { margin: '8px 0', fontSize: '12px' } }, icon('check'), h('span', `${run.name}'s differences (${d.method}) against the simulated true ones: Pearson r = ${pearson(a, b).toFixed(3)} over ${a.length} variants; at q < 0.05, ${found} of the site's ${site} variants called, and ${called} of the ${others} others.`));
    } else if (results) {
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
    info.truth ? h('div.btn-row', { style: { marginTop: '6px' } }, h('button.btn.small', { type: 'button', onclick: () => downloadBlob(new Blob([`hgvs_pro,${info.truthOf === 'differential' ? 'true_differential' : 'true_effect'}\n${Object.entries(info.truth).map(([k, v]) => `${k},${v}`).join('\n')}\n`], { type: 'text/csv' }), 'simulated-truth.csv') }, icon('download'), info.truthOf === 'differential' ? 'The true differences (simulated)' : 'The true effects (simulated)')) : null);
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
