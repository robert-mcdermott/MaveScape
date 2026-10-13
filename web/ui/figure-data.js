// What a figure's panels show, gathered from the workspace (wave 6, slice 1; lib/figure-data.js
// since slice 6, with the window's context: the runs' scores recomputed when no view has needed
// them yet, run-results.js; QC and comparisons as their views compute them; the Map view's tracks).
// And the figure written for export: SVG, PDF, PNG at a resolution of its printed
// size, the clipboard. The Figures view, the Map view's "Add to figure" and remote control use it.

import { addPanel, createFigure, figureMarks, figurePDF, figureSVG, panelSummary, pngSize } from '../lib/figures.js';
import { paintMarks } from '../lib/draw.js';
import { crc32 } from '../lib/zip.js';
import { now as clockNow } from '../lib/clock.js';
import { saveFigure } from '../lib/workspace.js';
import { buildManifest, compareDrawings, compareManifest, embedPNG, embedSVG, figureForWorkspace, pdfAttachment, readFigureManifest } from '../lib/figure-manifest.js';
import { pngImage, resolveFigure as resolvePanels } from '../lib/figure-data.js';
import { newId } from '../lib/clock.js';
import { ensureResults, runEntry } from './run-results.js';
import { runTracks } from './tracks.js';
import { h, icon } from './dom.js';
import { showMenu, toast } from './overlays.js';
import { computeQc } from './mode-qc.js';
import { computeComparison } from './mode-compare.js';
import { storeBytes } from './import.js';
import { figurePanel, openView } from './structure-views.js';
import { structureState } from './mode-structure.js';
import { calibrationReport, calibrationWithLikelihood } from './calibration.js';

// A structure panel's image (wave 5's figure panel of the saved view, kept in the library by its
// SHA-256), decoded once: its pixels for the page and the PDF, its PNG for the SVG.
const images = new Map();
function decodedImage(app, sha) {
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
      const read = pngImage(png);
      return { image: { width: bitmap.width, height: bitmap.height, rgba, png }, metadata: read?.metadata ?? null };
    })());
    images.get(sha).catch(() => images.delete(sha));
  }
  return images.get(sha);
}

// What the window's figures are drawn from (lib/figure-data.js): the runs' scores and QC computed
// in the workers and kept for the session, the Compare view's comparisons, the Map view's tracks
// (the structure's shown among them) and the images in the library.
export function figureContext(app) {
  return {
    ws: app.store.ws,
    results: async (run) => (runEntry(app, run)?.results ? runEntry(app, run) : await ensureResults(app, run)),
    qc: async (inputs) => {
      const entry = await computeQc(app, inputs);
      return entry.status === 'done' ? { qc: entry.qc } : { message: entry.message };
    },
    comparison: (pair, filters, level, scale) => computeComparison(app, pair, filters, level, scale),
    tracks: async (run, model) => (await runTracks(app, run, model)).tracks,
    image: (sha) => decodedImage(app, sha),
    // A calibration as the Calibrate view computed it (wave 8, slice 5), kept for the session.
    calibration: (cal, { likelihood } = {}) => (likelihood ? calibrationWithLikelihood(app, cal) : calibrationReport(app, cal)),
  };
}

// Map(panel id → data) for every panel that needs data.
export function resolveFigure(app, fig) {
  return resolvePanels(figureContext(app), fig);
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
  // The page is white to its last pixel: its size in points rarely makes whole pixels, and the
  // page's own background would leave the last row or column partly transparent.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
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
