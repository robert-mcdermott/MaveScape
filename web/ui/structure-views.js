// Structures in the record, the Structure view's part (wave 5, slice 5; requirement X5): a view of
// the structure shown saved with the workspace (its structure's file kept in the library by
// SHA-256, a model's aligned error with it), reopened as it was saved (the structure from the
// library, or fetched again by its ID and checked by its SHA-256; the mapping compared with the
// one it was saved with), and figure panels: an image of the view at a chosen scale with its
// legend drawn below it and what it shows written into it (lib/structure-record.js).

import { h } from './dom.js';
import { fetchPublic } from './public-data.js';
import { storeBytes } from './import.js';
import { sha256Hex } from './storage.js';
import { mapStructure, openStructure, shareSelection, structureState } from './mode-structure.js';
import { colorStructure, scoresSettings, scoreSource } from './structure-coloring.js';
import { computeEvidence, evidenceState } from './structure-evidence.js';
import { mappingChanges, mappingSummary, panelMetadata, PANEL_KEYWORD, pngWithText, structureWords } from '../lib/structure-record.js';
import { saveStructureView, removeStructureView } from '../lib/workspace.js';
import { ASYMMETRIC_UNIT_ID, describeStructure, originText } from '../lib/structures.js';
import { colorToHex, sampleColormap } from '../lib/structure/colors.js';
import { now } from '../lib/clock.js';

const asBytes = async (data) => (data instanceof Uint8Array ? data : data ? new Uint8Array(await new Response(data).arrayBuffer()) : null);

// The library's bytes of a file, or null.
async function libraryBytes(app, sha) {
  try {
    return await asBytes(await app.library.getFile(sha));
  } catch {
    return null;
  }
}

// --- Saving ------------------------------------------------------------------------------------------

// The structure shown as the workspace keeps it: its file in the library (and a model's aligned
// error), and the words that name it.
async function keptStructure(app) {
  const state = structureState(app);
  const structure = state.viewer.structure;
  const origin = state.origin;
  const file = state.file;
  if (!file?.bytes) throw new Error('The structure\'s file is not at hand: open it again, then save the view.');
  const stored = await storeBytes(app, file.bytes);
  let pae = null;
  if (origin?.kind === 'alphafold') {
    const got = await fetchPublic(app, `alphafold/${encodeURIComponent(origin.id)}/pae/${origin.version}`, { as: 'bytes' });
    if (got.ok) {
      const kept = await storeBytes(app, got.bytes);
      pae = { fileName: `AF-${origin.id}-F1-predicted_aligned_error_v${origin.version}.json`, sha256: kept.sha256, size: kept.size, retrieval: got.retrieval ?? null };
    }
  }
  const code = structure.meta.code || structure.label;
  const words = describeStructure(structure);
  return {
    id: origin?.kind === 'pdb' ? `pdb-${origin.id}` : origin?.kind === 'alphafold' ? `af-${origin.id}-v${origin.version}` : code,
    name: origin?.kind === 'alphafold' ? `AF-${origin.id}-F1 v${origin.version}` : code,
    title: words[0].replace(/\.$/, ''),
    method: (words[1] ?? '').replace(/\.$/, ''),
    origin: { ...origin, retrieval: origin?.retrieval ? { retrieved: origin.retrieval.retrieved ?? null, source: origin.retrieval.source ?? null, cache: undefined } : null },
    file: { fileName: file.name, sha256: stored.sha256, size: stored.size },
    ...(pae ? { pae } : {}),
  };
}

// The view shown, as a saved view records it.
export function currentView(app, name) {
  const state = structureState(app);
  const viewer = state.viewer;
  const settings = scoresSettings(state);
  const ev = evidenceState(state);
  const scores = viewer.colorScheme === 'scores' && settings.how ? { how: settings.how, substitution: settings.substitution, abnormal: { ...settings.abnormal } } : null;
  const from = scores && scores.how !== 'class' && scores.how !== 'disagreement' ? scoreSource(app) : null;
  return {
    name,
    assembly: viewer.structure.activeAssemblyId ?? ASYMMETRIC_UNIT_ID,
    chain: state.mapping?.chain ?? null,
    mapping: mappingSummary(state.mapping),
    camera: viewer.camera,
    size: viewer.size,
    style: viewer.style,
    color: { scheme: viewer.colorScheme, scores, palette: app.mapView?.palette ?? 'rdbu', run: from?.ok ? from.run.id : null, condition: from?.ok ? from.condition : null, contrast: from?.ok && from.model.contrast ? (app.mapView?.contrast ?? 0) : null },
    surface: viewer.surface.kind,
    selection: [...viewer.selection],
    labels: [...viewer.labels],
    styles: Object.fromEntries(viewer.styled),
    hidden: viewer.hidden,
    focus: viewer.focused,
    evidence: ev.status === 'ready' ? { choice: ev.choice, fraction: ev.fraction, seed: ev.seed } : null,
  };
}

// Saves the view shown under a name (one already used is saved again). Returns { ok, id, message }.
export async function saveView(app, name) {
  const state = structureState(app);
  const viewer = state.viewer;
  const clean = String(name ?? '').trim();
  if (!viewer?.structure) return { ok: false, message: 'No structure is open: open one, then save the view of it.' };
  if (!clean) return { ok: false, message: 'A saved view needs a name.' };
  let structure;
  try {
    structure = await keptStructure(app);
  } catch (error) {
    return { ok: false, message: error.message };
  }
  const view = currentView(app, clean);
  const saved = saveStructureView(app.store.ws, structure, view, now());
  app.store.commit(saved.ws, `Save the view "${clean}"`);
  state.view = saved.id;
  const entry = saved.ws.structures.find((s) => s.id === saved.structure);
  const message = `Saved the view "${clean}" of ${structureWords(entry)}: it reopens with the workspace, and goes into its archive and methods.`;
  app.log(message);
  return { ok: true, id: saved.id, structure: entry, view: saved.ws.structureViews.find((v) => v.id === saved.id), message };
}

export function removeView(app, id) {
  const view = (app.store.ws.structureViews ?? []).find((v) => v.id === id);
  if (!view) return { ok: false, message: 'There is no such saved view.' };
  app.store.commit(removeStructureView(app.store.ws, id), `Remove the view "${view.name}"`);
  return { ok: true, message: `Removed the view "${view.name}".` };
}

// --- Reopening --------------------------------------------------------------------------------------

// The bytes of a kept structure: the library's; else, for a PDB entry or an AlphaFold DB model,
// fetched again by its ID and kept when its SHA-256 is the one saved. { bytes, note } or { message }.
async function structureBytes(app, entry) {
  const kept = await libraryBytes(app, entry.file.sha256);
  if (kept) return { bytes: kept, note: '' };
  const o = entry.origin ?? {};
  if (o.kind !== 'pdb' && o.kind !== 'alphafold') return { message: `${entry.file.fileName}, the file the view shows, is not in this library (the archive named it by its SHA-256 only): open the file again, then the view.` };
  const got = await fetchPublic(app, o.kind === 'pdb' ? `pdb/${encodeURIComponent(o.id)}` : `alphafold/${encodeURIComponent(o.id)}/model/${o.version}`, { as: 'bytes' });
  if (!got.ok) return { message: `${structureWords(entry, { sha: false })} is not in this library, and could not be fetched again: ${got.message}` };
  const sha = await sha256Hex(got.bytes);
  if (sha === entry.file.sha256) {
    await storeBytes(app, got.bytes);
    return { bytes: got.bytes, note: `${entry.name} was fetched again by its ID, its SHA-256 the one saved.` };
  }
  return { bytes: got.bytes, note: `${entry.name} was fetched again by its ID, but the file is not the one saved (SHA-256 ${sha.slice(0, 12)}… now, ${entry.file.sha256.slice(0, 12)}… then): the service has revised it, and the view is drawn on today's.` };
}

// Opens a saved view (by id or name): the structure, assembly, chain, style, colors (the run and
// condition they are of), surface, residues drawn, labels, focus, selection, evidence settings and
// camera, as saved. Returns { ok, message, changes (the mapping's), notes }.
export async function openView(app, which) {
  const ws = app.store.ws;
  const view = (ws.structureViews ?? []).find((v) => v.id === which || v.name === which);
  if (!view) return { ok: false, message: `There is no saved view "${which}".` };
  const entry = (ws.structures ?? []).find((s) => s.id === view.structure);
  if (!entry) return { ok: false, message: `The structure of the view "${view.name}" is not in the workspace.` };
  const got = await structureBytes(app, entry);
  if (!got.bytes) return { ok: false, message: got.message };
  const notes = got.note ? [got.note] : [];
  const opened = await openStructure(app, { file: { name: entry.file.fileName, bytes: got.bytes }, origin: entry.origin, chain: view.chain, keep: false });
  if (!opened.ok) return opened;
  const state = structureState(app);
  const viewer = state.viewer;
  if (view.assembly && view.assembly !== (viewer.structure.activeAssemblyId ?? ASYMMETRIC_UNIT_ID)) {
    viewer.setAssembly(view.assembly);
    mapStructure(app, view.chain);
  }
  viewer.setStyle(view.style);
  // The colors: the scores of the run and condition (or contrast) the view was saved with.
  const settings = scoresSettings(state);
  const color = view.color ?? {};
  app.mapView ??= { colorBy: 'score', rowOrder: 'biochemical', palette: 'rdbu', condition: 0, contrast: 0, show: 'all', page: 0 };
  if (color.palette) app.mapView.palette = color.palette;
  if (color.scores) {
    if (color.run) {
      const run = ws.runs.find((r) => r.id === color.run);
      if (run) {
        app.mapView.run = run.id;
        app.focusItem({ kind: 'run', id: run.id });
        if (color.contrast !== null && color.contrast !== undefined) {
          app.mapView.colorBy = 'differential';
          app.mapView.contrast = color.contrast;
        } else {
          if (app.mapView.colorBy === 'differential') app.mapView.colorBy = 'score';
          app.mapView.condition = color.condition ?? 0;
        }
      } else notes.push('The run the view was colored by is no longer in the workspace: the run the map shows colors it.');
    }
    Object.assign(settings, { how: color.scores.how, substitution: color.scores.substitution ?? settings.substitution, abnormal: { ...settings.abnormal, ...(color.scores.abnormal ?? {}) } });
    if (color.scores.how === 'class' && view.evidence) Object.assign(evidenceState(state), view.evidence);
    if (color.scores.how === 'class') await computeEvidence(app, state);
    let colored = await colorStructure(app, state);
    for (let i = 0; i < 600 && colored?.pending; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      colored = await colorStructure(app, state);
    }
    if (colored && !colored.ok) notes.push(colored.message);
  } else {
    settings.how = null;
    state.colored = null;
    viewer.setColor(color.scheme ?? 'chain');
  }
  if (view.surface) viewer.setSurface(view.surface);
  // Residues drawn their own way, labels, focus, the selection (shared with the map), the evidence.
  const byStyle = new Map();
  for (const [key, how] of Object.entries(view.styles ?? {})) byStyle.set(how, [...(byStyle.get(how) ?? []), key]);
  for (const [how, keys] of byStyle) viewer.styleResidues(keys, how);
  if (view.hidden?.length) viewer.styleResidues(view.hidden, 'hide');
  if (view.labels?.length) viewer.label(view.labels, true);
  if (view.focus?.length) viewer.focus(view.focus);
  viewer.select(view.selection ?? []);
  shareSelection(app);
  if (view.evidence) {
    Object.assign(evidenceState(state), view.evidence);
    computeEvidence(app, state, { notify: () => state.handlers?.onChange?.() });
  }
  // The camera last, as it was.
  viewer.setCamera(view.camera);
  state.view = view.id;
  const changes = mappingChanges(view.mapping, mappingSummary(state.mapping));
  if (changes.length) notes.push(`The mapping is not the one the view was saved with: ${changes.join('; ')}.`);
  state.message = notes.length ? { kind: changes.length || /not the one saved/.test(notes.join(' ')) ? 'warn' : 'ok', text: notes.join(' ') } : null;
  app.store.notify(['structure']);
  const message = `Opened the view "${view.name}": ${originText(entry.origin, viewer.structure)}${notes.length ? `. ${notes.join(' ')}` : '.'}`;
  app.log(message);
  return { ok: true, message, view, structure: entry, changes, notes };
}

// --- Figure panels ------------------------------------------------------------------------------------

// The legend of the coloring shown, as a figure panel draws it: { title, gradient: { color(t),
// low, center, high, meaning } | null, items: [{ label, color }] } or null.
function legendOf(state) {
  const viewer = state.viewer;
  if (viewer.colorScheme === 'scores') {
    const c = state.colored;
    if (!c?.ok) return null;
    const g = c.legend.gradient;
    return {
      title: c.legend.title,
      gradient: g ? { color: c.palette.color, low: g.low, center: g.center, high: g.high, meaning: g.meaning ?? '' } : null,
      items: c.legend.items.map((i) => ({ label: i.count === null ? i.label : `${i.label} (${i.count})`, color: i.color })),
    };
  }
  const l = viewer.legend;
  if (!l) return null;
  if (l.type === 'categorical') return { title: l.title, gradient: null, items: l.items.map((i) => ({ label: i.label, color: colorToHex(i.color) })) };
  if (l.type === 'gradient') return { title: l.title, gradient: { color: (t) => colorToHex(sampleColormap(l.colormap, t)), low: l.minLabel, center: null, high: l.maxLabel, meaning: '' }, items: [] };
  return null;
}

// Draws the legend below the image, `scale` CSS pixels to a pixel: returns its height.
function drawLegend(ctx, legend, { x, y, width, scale, dark }) {
  const ink = dark ? '#e8e9ec' : '#1d2026';
  const muted = dark ? '#a5a9b3' : '#5b616e';
  const size = 12 * scale;
  ctx.textBaseline = 'top';
  let cy = y + 8 * scale;
  ctx.font = `600 ${size}px system-ui, sans-serif`;
  ctx.fillStyle = ink;
  ctx.fillText(legend.title, x, cy);
  cy += size * 1.6;
  if (legend.gradient) {
    const barW = Math.min(width, 260 * scale);
    for (let i = 0; i < barW; i += 1) {
      ctx.fillStyle = legend.gradient.color(i / Math.max(1, barW - 1));
      ctx.fillRect(x + i, cy, 1, 10 * scale);
    }
    ctx.strokeStyle = muted;
    ctx.lineWidth = Math.max(1, scale / 2);
    ctx.strokeRect(x, cy, barW, 10 * scale);
    cy += 13 * scale;
    ctx.font = `${size * 0.9}px system-ui, sans-serif`;
    ctx.fillStyle = muted;
    ctx.textAlign = 'left';
    ctx.fillText(legend.gradient.low, x, cy);
    if (legend.gradient.center) {
      ctx.textAlign = 'center';
      ctx.fillText(legend.gradient.center, x + barW / 2, cy);
    }
    ctx.textAlign = 'right';
    ctx.fillText(legend.gradient.high, x + barW, cy);
    ctx.textAlign = 'left';
    cy += size * 1.3;
    if (legend.gradient.meaning) {
      ctx.fillText(legend.gradient.meaning, x, cy);
      cy += size * 1.3;
    }
  }
  ctx.font = `${size}px system-ui, sans-serif`;
  let cx = x;
  const row = size * 1.5;
  if (legend.items.length) cy += 2 * scale;
  for (const item of legend.items) {
    const w = 14 * scale + 6 * scale + ctx.measureText(item.label).width + 16 * scale;
    if (cx > x && cx + w > x + width) {
      cx = x;
      cy += row;
    }
    ctx.fillStyle = item.color;
    ctx.fillRect(cx, cy + 1 * scale, 14 * scale, 11 * scale);
    ctx.fillStyle = ink;
    ctx.fillText(item.label, cx + 20 * scale, cy);
    cx += w;
  }
  return cy + (legend.items.length ? row : 0) + 6 * scale - y;
}

// A figure panel of the view shown: a PNG `scale` times the view's size in CSS pixels (a saved view
// opened: the size it was saved at, so the same view gives the same image), its legend drawn below
// it (legend: false, the image alone), what it shows written into it (an iTXt chunk, keyword
// mavescape-figure-panel). Returns { name, bytes, metadata }.
export async function figurePanel(app, { scale = 4, legend: withLegend = true, light = false } = {}) {
  const state = structureState(app);
  const viewer = state.viewer;
  if (!viewer?.structure) throw new Error('No structure is open.');
  const opened = (app.store.ws.structureViews ?? []).find((v) => v.id === state.view);
  const size = opened?.size ?? viewer.size;
  // light: on white whatever the page's theme (a figure's panel, wave 6 slice 2).
  const themed = document.documentElement.dataset.theme === 'dark';
  const dark = themed && !light;
  if (themed && light) viewer.setTheme(false);
  let blob;
  try {
    blob = await viewer.capturePNG(scale, size);
  } finally {
    if (themed && light) viewer.setTheme(true);
  }
  const image = await createImageBitmap(blob);
  const legend = withLegend ? legendOf(state) : null;
  // The legend's height, measured by drawing it on a scratch canvas first.
  const scratch = h('canvas', { width: image.width, height: 10 });
  const legendHeight = legend ? Math.ceil(drawLegend(scratch.getContext('2d'), legend, { x: 16 * scale, y: 0, width: image.width - 32 * scale, scale, dark })) : 0;
  const canvas = h('canvas', { width: image.width, height: image.height + legendHeight });
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = dark ? '#16181d' : '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0);
  if (legend) drawLegend(ctx, legend, { x: 16 * scale, y: image.height, width: image.width - 32 * scale, scale, dark });
  const png = await asBytes(await new Promise((resolve) => canvas.toBlob(resolve, 'image/png')));
  const ws = app.store.ws;
  // The structure's file by its SHA-256, and the kept structure when a saved view was opened.
  const saved = (ws.structureViews ?? []).find((v) => v.id === state.view);
  const kept = saved ? (ws.structures ?? []).find((s) => s.id === saved.structure) : null;
  const entry = kept ?? (state.file?.bytes ? { id: null, file: { sha256: await sha256Hex(state.file.bytes) } } : null);
  const settings = scoresSettings(state);
  const from = viewer.colorScheme === 'scores' && settings.how && settings.how !== 'class' && settings.how !== 'disagreement' ? scoreSource(app) : null;
  const coloring = viewer.colorScheme === 'scores' && state.colored?.ok
    ? { kind: settings.how === 'class' ? 'structural class' : 'scores', how: settings.how, label: state.colored.values?.label ?? 'Structural class', source: state.colored.source, run: from?.ok ? { id: from.run.id, name: from.run.name, output: from.run.output.sha256 } : null, condition: from?.ok ? from.condition : null, palette: state.colored.palette?.name ?? null, domain: state.colored.values?.domain ?? null }
    : { kind: 'structure', scheme: viewer.colorScheme };
  const metadata = panelMetadata({
    ws, entry, structure: viewer.structure, origin: state.origin,
    view: { saved: state.view ?? null, ...currentView(app, null) },
    coloring,
    legend: legend ? { title: legend.title, low: legend.gradient?.low ?? null, center: legend.gradient?.center ?? null, high: legend.gradient?.high ?? null, meaning: legend.gradient?.meaning ?? null, items: legend.items.map((i) => ({ label: i.label, color: i.color })) } : null,
    image: { width: canvas.width, height: canvas.height, scale, view: { width: size.width, height: size.height }, legend: Boolean(legend), renderer: viewer.kind },
    software: { version: app.version, commit: app.commit },
    created: now(),
  });
  const bytes = pngWithText(png, PANEL_KEYWORD, JSON.stringify(metadata));
  const code = (viewer.structure.meta.code || 'structure').toLowerCase();
  return { name: `${code}${state.view ? `_${String(state.view).replace(/[^A-Za-z0-9_.-]+/g, '_')}` : ''}_panel.png`, bytes, metadata };
}
