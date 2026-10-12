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
import { ensureResults, runEntry } from './run-results.js';
import { runTracks } from './tracks.js';
import { possessive } from '../lib/words.js';

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

// Map(panel id → data) for every panel that needs data.
export async function resolveFigure(app, fig) {
  const out = new Map();
  for (const panel of fig.panels) {
    if (panel.kind === 'map') out.set(panel.id, await mapData(app, panel));
  }
  return out;
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

// The figure written as 'svg', 'pdf' or 'png' (options.dpi, 300 by default). Returns { data
// (string or bytes), type, fileName, description, notes }.
export async function exportFigure(app, fig, format, options = {}) {
  const resolved = await resolveFigure(app, fig);
  const drawn = figureMarks(fig, resolved);
  if (format === 'svg') return { data: await figureSVG(fig, resolved), type: 'image/svg+xml', fileName: fileNameOf(fig, 'svg'), description: drawn.description, notes: drawn.notes };
  if (format === 'pdf') return { data: await figurePDF(fig, resolved, { date: new Date(clockNow()) }), type: 'application/pdf', fileName: fileNameOf(fig, 'pdf'), description: drawn.description, notes: drawn.notes };
  if (format === 'png') {
    const dpi = options.dpi ?? 300;
    if (!(dpi >= 72 && dpi <= 1200)) throw new Error('A PNG is 72 to 1200 dpi.');
    return { data: await figurePNG(fig, drawn.marks, dpi), type: 'image/png', fileName: fileNameOf(fig, 'png'), description: drawn.description, notes: drawn.notes, dpi };
  }
  throw new Error(`A figure is written as svg, pdf or png, not "${format}".`);
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
