// What a figure's panels show, gathered from the workspace (wave 6, slice 1): a map panel's run,
// its scores recomputed when no view has needed them yet (run-results.js), its map model and the
// tracks it names. And the figure written for export: SVG, PDF, PNG at a resolution of its printed
// size, the clipboard. The Figures view, the Map view's "Add to figure" and remote control use it.

import { buildMapModel } from '../lib/map-model.js';
import { proteinView } from '../lib/collapse.js';
import { arrangeTracks } from '../lib/tracks.js';
import { addPanel, createFigure, figureMarks, figurePDF, figureSVG, panelSummary, pngSize } from '../lib/figures.js';
import { paintMarks } from '../lib/draw.js';
import { crc32 } from '../lib/zip.js';
import { now as clockNow } from '../lib/clock.js';
import { saveFigure } from '../lib/workspace.js';
import { buildManifest, compareDrawings, compareManifest, embedPNG, embedSVG, figureForWorkspace, pdfAttachment, readFigureManifest } from '../lib/figure-manifest.js';
import { newId } from '../lib/clock.js';
import { ensureResults, runEntry } from './run-results.js';
import { runTracks } from './tracks.js';
import { possessive } from '../lib/words.js';
import { h, icon } from './dom.js';
import { showMenu, toast } from './overlays.js';
import { computeQc, qcInputsOf, qcSubjects } from './mode-qc.js';
import { findingsFrom, withDefaultThresholds } from '../lib/findings.js';
import { qcPanelData } from '../lib/qc-plots.js';
import { comparisonCharts, scoreCharts, variantCharts } from '../lib/view-plots.js';
import { comparisonMapModels, computeComparison } from './mode-compare.js';
import { NO_FILTERS } from '../lib/compare.js';
import { storeBytes } from './import.js';
import { figurePanel, openView } from './structure-views.js';
import { structureState } from './mode-structure.js';
import { PANEL_KEYWORD, pngTexts } from '../lib/structure-record.js';

// A map panel's data: { model, results, tracks, run } or { missing: why it cannot be drawn }.
async function mapData(app, panel) {
  const run = app.store.ws.runs.find((r) => r.id === panel.run);
  if (!run) return { missing: `The run ${panel.run} is no longer in the workspace.` };
  const entry = runEntry(app, run)?.results ? runEntry(app, run) : await ensureResults(app, run);
  if (!entry?.results) return { missing: `${possessive(run.name)} scores could not be recomputed${entry?.message ? `: ${entry.message}` : '.'}` };
  const results = proteinView(entry.results) ?? entry.results;
  const contrast = Number.isInteger(panel.contrast) ? panel.contrast : null;
  if (contrast !== null && !(results.differential?.length > contrast)) return { missing: `${run.name} has no difference between conditions to draw.` };
  let model;
  try {
    model = buildMapModel(results, run.inputs.design, contrast !== null ? { contrast, colorBy: 'differential', rowOrder: panel.rowOrder } : { condition: Math.min(panel.condition ?? 0, results.conditions.length - 1), colorBy: panel.colorBy, rowOrder: panel.rowOrder });
  } catch (error) {
    return { missing: error.message };
  }
  let tracks = [];
  if (panel.tracks?.length) {
    const state = await runTracks(app, run, model);
    const byId = new Map(arrangeTracks(state.tracks, app.store.ws.tracks).map((t) => [t.id, t]));
    tracks = panel.tracks.map((id) => byId.get(id)).filter(Boolean);
  }
  return { run, model, results, tracks };
}

// A run's results by its id: { run, own (its results), results (a nucleotide run's protein view
// where it has one) } or { missing }.
async function runResults(app, id) {
  const run = app.store.ws.runs.find((r) => r.id === id);
  if (!run) return { missing: `The run ${id} is no longer in the workspace.` };
  const entry = runEntry(app, run)?.results ? runEntry(app, run) : await ensureResults(app, run);
  if (!entry?.results) return { missing: `${possessive(run.name)} scores could not be recomputed${entry?.message ? `: ${entry.message}` : '.'}` };
  return { run, own: entry.results, results: proteinView(entry.results) ?? entry.results };
}

// A QC panel's charts: the finding's, as the QC view draws them (lib/qc-plots.js), of a run or of
// the counts with the current design.
async function qcData(app, panel) {
  const ws = app.store.ws;
  const sub = qcSubjects(ws).find((o) => o.id === (panel.subject === 'counts' ? 'counts' : `run:${panel.subject}`));
  if (!sub) return { missing: panel.subject === 'counts' ? 'The counts have no design to check now.' : `The run ${panel.subject} is no longer in the workspace.` };
  const inputs = qcInputsOf(ws, sub);
  if (inputs.problem) return { missing: inputs.problem };
  const entry = await computeQc(app, inputs);
  if (entry.status !== 'done') return { missing: `Quality control could not be computed: ${entry.message ?? 'unknown'}` };
  const t = withDefaultThresholds(ws.qc?.thresholds);
  const finding = findingsFrom(entry.qc, t, { acknowledged: ws.qc?.acknowledged }).find((f) => f.id === panel.finding);
  if (!finding) return { missing: `The finding "${panel.findingTitle ?? panel.finding}" is not raised for ${sub.label} now.` };
  return qcPanelData(finding, entry.qc, t, { pair: panel.pair ?? 0 });
}

async function scoresData(app, panel) {
  const got = await runResults(app, panel.run);
  if (got.missing) return got;
  return scoreCharts(got.own, got.run, { condition: panel.condition ?? 0, contrast: panel.contrast ?? 0, plot: panel.plot });
}

// A comparison panel: its charts (lib/view-plots.js) or one of its maps.
async function compareData(app, panel) {
  const map = panel.plot.startsWith('map-');
  const c = await computeComparison(app, { a: panel.a, b: panel.b }, panel.filters ?? { ...NO_FILTERS }, map ? 'protein' : null, panel.scale ?? 'scored');
  if (c.error) return { missing: c.error };
  if (!c.statistics) return { missing: `${c.a.label} and ${c.b.label} cannot be compared: ${c.report.items.filter((i) => i.status === 'blocked').map((i) => i.text).join(' ')}` };
  if (map) {
    const which = panel.plot.slice(4);
    const m = comparisonMapModels(c)[which];
    if (!m) return { missing: which === 'difference' ? 'No map of the difference: the two are not on one scale at the protein level.' : `No map of the ${which} side.` };
    return { ...m, tracks: [] };
  }
  return comparisonCharts(c, panel.plot);
}

async function variantData(app, panel) {
  const got = await runResults(app, panel.run);
  if (got.missing) return got;
  // A protein variant of a nucleotide run is in its protein view.
  const results = got.own.variants.key.includes(panel.variant) ? got.own : got.results;
  return variantCharts(results, got.run, panel.variant, { condition: panel.condition ?? 0, plot: panel.plot });
}

// A structure panel's image (wave 5's figure panel of the saved view, kept in the library by its
// SHA-256), decoded once, and what it shows.
const images = new Map();
async function structureData(app, panel) {
  const ws = app.store.ws;
  const sha = panel.image.sha256;
  if (!images.has(sha)) {
    images.set(sha, (async () => {
      const bytes = await app.library.getFile(sha);
      if (!bytes) return null;
      const png = bytes instanceof Uint8Array ? bytes : new Uint8Array(await new Response(bytes).arrayBuffer());
      const bitmap = await createImageBitmap(new Blob([png], { type: 'image/png' }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0);
      const rgba = new Uint8Array(ctx.getImageData(0, 0, bitmap.width, bitmap.height).data.buffer);
      let metadata = null;
      try {
        metadata = JSON.parse(pngTexts(png).get(PANEL_KEYWORD) ?? 'null');
      } catch {
        metadata = null;
      }
      return { image: { width: bitmap.width, height: bitmap.height, rgba, png }, metadata };
    })());
    images.get(sha).catch(() => images.delete(sha));
  }
  const got = await images.get(sha);
  if (!got) return { missing: 'The structure image is not in the library: draw it again from its saved view.' };
  const view = (ws.structureViews ?? []).find((v) => v.id === panel.view);
  const notes = [];
  if (!view) notes.push('Its saved view was removed: the image is the one drawn from it then.');
  else if (view.created !== panel.image.drawn) notes.push(`The view "${view.name}" was saved again since its image was drawn: draw it again.`);
  const meta = got.metadata;
  const what = meta?.coloring?.label ? `, colored by ${meta.coloring.label}${meta.coloring.source ? ` (${meta.coloring.source})` : ''}` : '';
  return { image: got.image, title: view?.name ?? meta?.view?.name ?? null, description: `The structure ${meta?.structure?.name ?? ''}${view ? ` as the view "${view.name}" shows it` : ''}${what}.`.replace(/ {2,}/g, ' '), notes };
}

const RESOLVERS = { map: mapData, qc: qcData, scores: scoresData, compare: compareData, variant: variantData, structure: structureData };

// Map(panel id → data) for every panel that needs data.
export async function resolveFigure(app, fig) {
  const out = new Map();
  for (const panel of fig.panels) {
    const resolve = RESOLVERS[panel.kind];
    if (!resolve) continue;
    try {
      out.set(panel.id, await resolve(app, panel));
    } catch (error) {
      out.set(panel.id, { missing: error.message });
    }
  }
  return out;
}

// The image of a saved structure view, drawn for a figure (wave 5's figure panel, 4× the view) and
// kept in the library: the structure panel's image field. The view is opened in the Structure
// view first when it is not the one open.
export async function drawStructureImage(app, viewId, { scale = 4 } = {}) {
  const view = (app.store.ws.structureViews ?? []).find((v) => v.id === viewId);
  if (!view) throw new Error(`There is no saved view ${viewId}.`);
  if (structureState(app).view !== view.id || !structureState(app).viewer?.structure) {
    const opened = await openView(app, view.id);
    if (!opened.ok) throw new Error(opened.message);
  }
  const panel = await figurePanel(app, { scale, light: true });
  const stored = await storeBytes(app, panel.bytes);
  return { sha256: stored.sha256, width: panel.metadata.image.width, height: panel.metadata.image.height, scale, drawn: view.created };
}

// The figure drawn: figureMarks with the data gathered.
export async function drawFigure(app, fig) {
  const resolved = await resolveFigure(app, fig);
  return { resolved, ...figureMarks(fig, resolved) };
}

// An image mark's pixels as something a canvas draws.
export function imageOf(image) {
  if (!image.canvas) {
    const canvas = new OffscreenCanvas(image.width, image.height);
    canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(image.rgba), image.width, image.height), 0, 0);
    image.canvas = canvas;
  }
  return image.canvas;
}

// A PNG's pixels per meter (pHYs) set to its resolution, so that it opens at its printed size.
function withResolution(bytes, dpi) {
  const ppm = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4);
  view.setUint32(8, ppm);
  view.setUint32(12, ppm);
  chunk[16] = 1;
  view.setUint32(17, crc32(chunk.subarray(4, 17)));
  // After the signature (8) and IHDR (25).
  const out = new Uint8Array(bytes.length + chunk.length);
  out.set(bytes.subarray(0, 33), 0);
  out.set(chunk, 33);
  out.set(bytes.subarray(33), 54);
  return out;
}

async function figurePNG(fig, marks, dpi) {
  const size = pngSize(fig, dpi);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  ctx.scale(size.scale, size.scale);
  paintMarks(ctx, marks, { imageOf });
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  return withResolution(new Uint8Array(await blob.arrayBuffer()), dpi);
}

export const fileNameOf = (fig, extension) => `${(fig.name || 'figure').replace(/[^\w.-]+/g, '_')}.${extension}`;

// The figure written as 'svg', 'pdf' or 'png' (options.dpi, 300 by default), each carrying its
// manifest (lib/figure-manifest.js; wave 6, slice 3), or the manifest alone as 'json'. Returns
// { data (string or bytes), type, fileName, description, notes, manifest }.
export async function exportFigure(app, fig, format, options = {}) {
  const resolved = await resolveFigure(app, fig);
  const drawn = figureMarks(fig, resolved);
  const created = clockNow();
  const manifest = buildManifest(app.store.ws, fig, drawn, { software: { version: app.version, commit: app.commit }, created });
  const out = { description: drawn.description, notes: drawn.notes, manifest };
  if (format === 'svg') return { ...out, data: embedSVG(await figureSVG(fig, resolved), manifest), type: 'image/svg+xml', fileName: fileNameOf(fig, 'svg') };
  if (format === 'pdf') return { ...out, data: await figurePDF(fig, resolved, { date: new Date(created), attachments: [pdfAttachment(manifest)] }), type: 'application/pdf', fileName: fileNameOf(fig, 'pdf') };
  if (format === 'png') {
    const dpi = options.dpi ?? 300;
    if (!(dpi >= 72 && dpi <= 1200)) throw new Error('A PNG is 72 to 1200 dpi.');
    return { ...out, data: embedPNG(await figurePNG(fig, drawn.marks, dpi), manifest), type: 'image/png', fileName: fileNameOf(fig, 'png'), dpi };
  }
  if (format === 'json') return { ...out, data: `${JSON.stringify(manifest, null, 2)}\n`, type: 'application/json', fileName: fileNameOf(fig, 'manifest.json') };
  throw new Error(`A figure is written as svg, pdf, png or json (its manifest), not "${format}".`);
}

// --- A figure read back (wave 6, slice 3) -------------------------------------------------------------

// A figure's file read: { manifest, comparison } (compared with the workspace open), or null when
// it carries no MaveScape manifest.
export function readFigureFile(app, bytes) {
  const manifest = readFigureManifest(bytes);
  if (!manifest) return null;
  return { manifest, comparison: compareManifest(manifest, app.store.ws) };
}

// The figure rebuilt in the workspace from its manifest: added (its runs found by their outputs,
// its name made unique), drawn again from its inputs, and each panel's drawing compared with the
// one recorded. Returns { figure, comparison, drawings: [{ id, letter, shows, same, … }], notes }.
export async function rebuildFigure(app, manifest) {
  const { store } = app;
  const comparison = compareManifest(manifest, store.ws);
  const names = new Set((store.ws.figures ?? []).map((f) => f.name));
  let name = manifest.figure.name;
  for (let n = 2; names.has(name); n += 1) name = `${manifest.figure.name} (${n})`;
  const fig = figureForWorkspace(manifest, comparison, { id: `figure-${newId()}`, name });
  const when = manifest.created ? ` on ${manifest.created.slice(0, 10)}` : '';
  store.commit(saveFigure(store.ws, fig, `Rebuilt the figure "${manifest.figure.name}" from its file (exported by MaveScape ${manifest.software?.version ?? '?'}${when})${name !== manifest.figure.name ? ` as "${name}"` : ''}`), 'Rebuild figure');
  const drawn = await drawFigure(app, fig);
  return { figure: fig, comparison, drawings: compareDrawings(manifest, fig, drawn), notes: drawn.notes };
}

// A rebuilt figure's report in words: each panel the same, drawn differently (and why, as far as
// the comparison says), or not drawn.
export function rebuildWords(report) {
  return report.drawings.map((d) => {
    const p = report.comparison.panels.find((x) => x.id === d.id);
    const label = `${d.letter ? `Panel ${d.letter}` : 'A panel'} (${d.shows})`;
    if (p?.status === 'missing') return `${label}: not drawn: ${p.changes.join('; ')}.`;
    if (d.same) return `${label}: the same drawing.${p?.changes.length ? ` (${p.changes.join('; ')}.)` : ''}`;
    return `${label}: drawn differently${p?.changes.length ? `: ${p.changes.join('; ')}` : ', though what it was drawn from is the same (another MaveScape draws it otherwise)'}.`;
  });
}

// The figure on the clipboard: a PNG at 300 dpi, and its SVG where the browser takes one.
export async function copyFigure(app, fig) {
  const png = await exportFigure(app, fig, 'png', { dpi: 300 });
  const svg = await exportFigure(app, fig, 'svg');
  const items = { 'image/png': new Blob([png.data], { type: 'image/png' }) };
  try {
    await navigator.clipboard.write([new ClipboardItem({ ...items, 'image/svg+xml': new Blob([svg.data], { type: 'image/svg+xml' }) })]);
    return 'PNG and SVG';
  } catch {
    await navigator.clipboard.write([new ClipboardItem(items)]);
    return 'PNG';
  }
}

// --- Adding to a figure ----------------------------------------------------------------------------

// The map as the Map view shows it, as a panel: its run, condition or contrast, what colors it,
// the rows' order, palette, the positions shown and the tracks shown.
export function mapPanelOf(view, run, range, tracks) {
  const contrast = view.colorBy === 'differential' ? view.contrast ?? 0 : null;
  return {
    kind: 'map',
    run: run.id,
    ...(contrast === null ? { condition: view.condition ?? 0, colorBy: view.colorBy ?? 'score' } : { contrast }),
    rowOrder: view.rowOrder ?? 'biochemical',
    palette: view.palette ?? 'rdbu',
    ...(range ? { from: range.from, to: range.to } : {}),
    tracks: tracks.map((t) => t.id),
  };
}

// Adds a panel to a figure (figureId), or to a new figure (figureId null, named name). Committed
// with its words in the history. Returns { figure, panel }.
export function addToFigure(app, figureId, panel, { name = null, size = 'double' } = {}) {
  const { store } = app;
  const existing = figureId ? (store.ws.figures ?? []).find((f) => f.id === figureId) : null;
  if (figureId && !existing) throw new Error(`No figure ${figureId} in this workspace.`);
  let fig = existing ?? createFigure(name || `Figure ${(store.ws.figures?.length ?? 0) + 1}`, size);
  const made = !existing;
  const added = addPanel(fig, panel);
  fig = added.figure;
  const what = panelSummary(added.panel, store.ws);
  const detail = made ? `Made the figure "${fig.name}" with ${what}` : `Added to the figure "${fig.name}" ${what}`;
  store.commit(saveFigure(store.ws, fig, detail), made ? 'New figure' : 'Add to figure');
  return { figure: fig, panel: added.panel };
}

// "Add to figure": a menu of the workspace's figures and a new one; make() gives the panel (it may
// draw first: a structure's image). what: the panel in words, for the message.
export function figureMenu(app, anchor, make, what) {
  const add = async (id) => {
    try {
      const panel = await make();
      const { figure, panel: placed } = addToFigure(app, id, panel);
      app.log(`Added ${what} to the figure "${figure.name}".`);
      toast(`Added ${what} to ${figure.name}.`, { kind: 'ok', action: { label: 'Open Figures', onClick: () => { app.figuresView = { figure: figure.id, panel: placed.id }; app.setMode('figures'); } } });
    } catch (error) {
      toast(error.message, { kind: 'error' });
    }
  };
  const figures = app.store.ws.figures ?? [];
  showMenu(anchor, [
    { section: 'Add to figure' },
    ...figures.map((f) => ({ label: f.name, hint: `${f.panels.length} panel${f.panels.length === 1 ? '' : 's'}`, icon: 'figure', onSelect: () => add(f.id) })),
    ...(figures.length ? ['-'] : []),
    { label: 'A new figure (two columns)', icon: 'plus', onSelect: () => add(null) },
  ]);
}

// A small "Add to figure" button for a view's plot.
export function figureButton(app, make, what, { title = 'Put this plot on a figure (the Figures view), drawn again from the analysis until you export it' } = {}) {
  return h('button.btn.small.figure-add', { type: 'button', title, onclick: (event) => figureMenu(app, event.currentTarget, make, what) }, icon('figure'), 'Add to figure');
}
