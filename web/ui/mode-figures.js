// The Figures view (wave 6, slice 1; requirement R5): the workspace's figures, each a page of
// panels laid out for a journal's column or a slide. Panels are dragged and resized (snapping to
// the page's margins and to each other's edges), nudged with the arrow keys and lettered A, B, C…
// in reading order; every change can be undone. A panel says what it shows, so the page is drawn
// again from the workspace (ui/figure-data.js) and follows a rescoring until it is exported as
// SVG, PDF, PNG or to the clipboard. The page is drawn by lib/draw.js, as its exports are.
// After CytoWeave 0.8.0's Figures view (web/ui/mode-figures.js).

import { h, icon, clear, downloadBlob } from './dom.js';
import { confirmDialog, showMenu, toast } from './overlays.js';
import { paintMarks } from '../lib/draw.js';
import { addPanel, createFigure, FIGURE_SIZES, figureSize, mm, panelSummary, removePanel, toMM, updatePanel } from '../lib/figures.js';
import { MIN_TEXT } from '../lib/figure-map.js';
import { COLOR_BY, ROW_ORDERS } from '../lib/map-model.js';
import { arrangeTracks } from '../lib/tracks.js';
import { removeFigure, saveFigure } from '../lib/workspace.js';
import { copyFigure, drawFigure, exportFigure, imageOf } from './figure-data.js';
import { activeRun } from './selections.js';
import { ensureResults, runEntry } from './run-results.js';
import { runTracks } from './tracks.js';

const PALETTES = [['rdbu', 'Blue (lower) – red (higher)'], ['puor', 'Purple (lower) – orange (higher)']];
const MARGIN = 8;
const SNAP = 4;

export function mountFiguresMode(app, container) {
  const { store } = app;
  app.figuresView ??= { figure: null, panel: null };
  // The figure and panel shown, read from app.figuresView each time: remote control and the Map
  // view's "Open Figures" replace it.
  const state = {
    get figure() { return app.figuresView?.figure ?? null; },
    set figure(id) { app.figuresView = { ...(app.figuresView ?? {}), figure: id }; },
    get panel() { return app.figuresView?.panel ?? null; },
    set panel(id) { app.figuresView = { ...(app.figuresView ?? {}), panel: id }; },
  };
  let drawn = null;
  let token = 0;
  let zoom = 1;
  let tracksOf = { panel: null, tracks: null };
  // The letter the panel's properties were drawn with.
  let propsLetter = null;

  const headActions = h('div.btn-row');
  const listEl = h('div.btn-row.figure-list');
  const canvas = h('canvas.figure-canvas', { 'aria-hidden': 'true' });
  const overlay = h('div.figure-overlay');
  const page = h('div.figure-page', canvas, overlay);
  const stage = h('div.figure-stage', { tabIndex: 0, role: 'region', 'aria-label': 'Figure page: click a panel to select it; the arrow keys move it, Delete removes it.' }, page);
  const notesEl = h('div.figure-notes');
  const descEl = h('p.sr-only', { 'aria-live': 'polite' });
  const propsEl = h('div');
  const root = h('div.view',
    h('div.workbench-head', h('h1', icon('figure'), 'Figures'), listEl, h('span.spacer'), headActions),
    h('div.figure-layout',
      h('div.figure-center', stage, notesEl, descEl),
      h('div.figure-side', h('div.pane', propsEl))));
  container.append(root);

  const figures = () => store.ws.figures ?? [];
  const figure = () => figures().find((f) => f.id === state.figure) ?? figures()[0] ?? null;
  const panel = () => figure()?.panels.find((p) => p.id === state.panel) ?? null;

  function commit(next, label, detail = null) {
    store.commit(saveFigure(store.ws, next, detail), label);
  }

  // --- Figures --------------------------------------------------------------------------------------

  function newFigure(sizeId = 'double') {
    const fig = createFigure(`Figure ${figures().length + 1}`, sizeId);
    state.figure = fig.id;
    state.panel = null;
    commit(fig, 'New figure', `Made the figure "${fig.name}" (${figureSize(sizeId).label.toLowerCase()}, ${toMM(fig.width)} × ${toMM(fig.height)} mm)`);
  }

  function sizeMenu(anchor) {
    showMenu(anchor, FIGURE_SIZES.map((s) => ({ label: `${s.label} (${toMM(s.width)} × ${toMM(s.height)} mm)`, icon: 'figure', onSelect: () => newFigure(s.id) })));
  }

  async function deleteFigure(fig) {
    if (!await confirmDialog({ title: 'Delete the figure?', message: `"${fig.name}" and its ${fig.panels.length} panel${fig.panels.length === 1 ? '' : 's'} will be deleted (Undo brings it back).`, confirm: 'Delete', danger: true })) return;
    state.panel = null;
    store.commit(removeFigure(store.ws, fig.id), 'Delete figure');
  }

  // The workspace's figures, in the head: the one shown, and a new one.
  function renderList() {
    clear(listEl);
    const all = figures();
    if (all.length) {
      listEl.append(h('select.input.small', {
        'aria-label': 'The figure shown',
        onchange: (event) => {
          state.figure = event.target.value;
          state.panel = null;
          renderAll();
        },
      }, ...all.map((fig) => h('option', { value: fig.id, selected: fig.id === figure()?.id }, `${fig.name} (${fig.panels.length} panel${fig.panels.length === 1 ? '' : 's'})`))));
    }
    listEl.append(h('button.btn.small', { type: 'button', onclick: (event) => sizeMenu(event.currentTarget) }, icon('plus'), 'New figure'));
  }

  // --- Head: exports ----------------------------------------------------------------------------------

  async function exportAs(format, options = {}) {
    const fig = figure();
    try {
      const out = await exportFigure(app, fig, format, options);
      downloadBlob(new Blob([out.data], { type: out.type }), out.fileName);
      app.log(`Exported ${fig.name} as ${format.toUpperCase()}${out.dpi ? ` (${out.dpi} dpi)` : ''}: ${out.fileName}.`);
    } catch (error) {
      toast(`The export failed: ${error.message}`, { kind: 'error' });
    }
  }

  async function copy() {
    try {
      const what = await copyFigure(app, figure());
      toast(`Copied ${figure().name} (${what}).`, { kind: 'ok' });
    } catch (error) {
      toast(`Could not copy the figure: ${error.message}`, { kind: 'error' });
    }
  }

  function renderHead() {
    clear(headActions);
    if (!figure()) return;
    headActions.append(
      h('button.btn.small', { type: 'button', onclick: (event) => showMenu(event.currentTarget, [
        { label: 'SVG (vector, text as text)', icon: 'download', onSelect: () => exportAs('svg') },
        { label: 'PDF (vector)', icon: 'download', onSelect: () => exportAs('pdf') },
        { label: 'PNG, 300 dpi', icon: 'download', onSelect: () => exportAs('png', { dpi: 300 }) },
        { label: 'PNG, 600 dpi', icon: 'download', onSelect: () => exportAs('png', { dpi: 600 }) },
        '-',
        { label: 'Copy to the clipboard', icon: 'copy', onSelect: copy },
      ]) }, icon('download'), 'Export'));
  }

  // --- The page ---------------------------------------------------------------------------------------

  async function drawPage() {
    const fig = figure();
    const mine = (token += 1);
    if (!fig) {
      page.hidden = true;
      clear(notesEl);
      notesEl.append(h('div.empty',
        icon('figure'),
        h('h3', 'Figures for a paper'),
        h('p', 'A figure is a page of panels at a journal\'s column width or a slide. Panels say what they show (a run\'s map, its positions and tracks), so they follow the analysis until you export them as SVG, PDF or PNG.'),
        h('div.btn-row', { style: { justifyContent: 'center' } },
          h('button.btn.primary', { type: 'button', onclick: (event) => sizeMenu(event.currentTarget) }, icon('plus'), 'New figure'),
          h('button.btn', { type: 'button', onclick: () => app.setMode('map') }, icon('heatmap'), 'Open the Map (Add to figure)'))));
      return;
    }
    page.hidden = false;
    const available = Math.max(200, stage.clientWidth - 40);
    zoom = Math.min(2.5, available / fig.width);
    const dpr = window.devicePixelRatio || 1;
    const result = await drawFigure(app, fig);
    if (mine !== token) return;
    drawn = result;
    page.style.width = `${fig.width * zoom}px`;
    page.style.height = `${fig.height * zoom}px`;
    canvas.width = Math.round(fig.width * zoom * dpr);
    canvas.height = Math.round(fig.height * zoom * dpr);
    canvas.style.width = `${fig.width * zoom}px`;
    canvas.style.height = `${fig.height * zoom}px`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(zoom * dpr, 0, 0, zoom * dpr, 0, 0);
    ctx.clearRect(0, 0, fig.width, fig.height);
    paintMarks(ctx, drawn.marks, { imageOf });
    renderBoxes(fig);
    renderNotes(fig);
    descEl.textContent = drawn.description;
    // The properties again when they were drawn before the page: a new panel's letter, a map's tracks.
    const p = panel();
    if (p && ((p.kind === 'map' && tracksOf.panel !== p.id) || propsLetter !== (drawn.panels.find((x) => x.id === p.id)?.letter ?? null))) renderProps();
  }

  function renderNotes(fig) {
    clear(notesEl);
    const lines = [];
    lines.push(h('span', `${toMM(fig.width)} × ${toMM(fig.height)} mm · text ${fig.text} pt${drawn?.smallest ? ` · smallest ${drawn.smallest.toFixed(1)} pt` : ''}`));
    notesEl.append(h('p.muted', { style: { margin: '6px 0 0', fontSize: '11.5px' } }, ...lines));
    if (drawn?.smallest && drawn.smallest < MIN_TEXT) notesEl.append(h('div.callout.warn', icon('warning'), h('span', `Some text is under ${MIN_TEXT} pt at the printed size: journals ask for 5–7 pt at least.`)));
    for (const note of drawn?.notes ?? []) notesEl.append(h('div.callout.warn', icon('warning'), h('span', note)));
  }

  function renderBoxes(fig) {
    clear(overlay);
    const letters = new Map((drawn?.panels ?? []).map((p) => [p.id, p.letter]));
    for (const p of fig.panels) {
      const box = h(`div.figure-box${p.id === state.panel ? '.selected' : ''}`, {
        style: { left: `${p.x * zoom}px`, top: `${p.y * zoom}px`, width: `${p.w * zoom}px`, height: `${p.h * zoom}px` },
        title: `${letters.get(p.id) ? `Panel ${letters.get(p.id)}: ` : ''}${panelSummary(p, store.ws)}`,
        dataset: { id: p.id },
      }, h('div.figure-handle'));
      attachDrag(box, p);
      overlay.append(box);
    }
  }

  // Snaps a value to the page's margins and the other panels' edges (within SNAP points), or to
  // whole points.
  function snapper(fig, id, axis) {
    const edges = axis === 'x' ? [MARGIN, fig.width - MARGIN, fig.width / 2] : [MARGIN, fig.height - MARGIN, fig.height / 2];
    for (const p of fig.panels) {
      if (p.id === id) continue;
      if (axis === 'x') edges.push(p.x, p.x + p.w, p.x + p.w + MARGIN, p.x - MARGIN);
      else edges.push(p.y, p.y + p.h, p.y + p.h + MARGIN, p.y - MARGIN);
    }
    return (start, size) => {
      let best = null;
      for (const e of edges) {
        for (const [v, offset] of [[start, 0], [start + size, size]]) {
          const d = Math.abs(v - e);
          if (d <= SNAP && (!best || d < best.d)) best = { d, value: e - offset };
        }
      }
      return best ? best.value : Math.round(start);
    };
  }

  function attachDrag(box, p) {
    box.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      stage.focus({ preventScroll: true });
      if (state.panel !== p.id) {
        state.panel = p.id;
        for (const other of overlay.querySelectorAll('.figure-box.selected')) other.classList.remove('selected');
        box.classList.add('selected');
        renderProps();
      }
      const resizing = event.target.classList.contains('figure-handle');
      const fig = figure();
      const start = { x: event.clientX, y: event.clientY };
      const snapX = snapper(fig, p.id, 'x');
      const snapY = snapper(fig, p.id, 'y');
      let next = null;
      try {
        box.setPointerCapture(event.pointerId);
      } catch {
        // A pointer the browser no longer tracks: the drag goes on without capture.
      }
      const move = (e) => {
        const dx = (e.clientX - start.x) / zoom;
        const dy = (e.clientY - start.y) / zoom;
        if (Math.abs(dx) + Math.abs(dy) < 1.5 && !next) return;
        if (resizing) {
          const right = snapX(p.x + Math.max(20, p.w + dx), 0);
          const bottom = snapY(p.y + Math.max(20, p.h + dy), 0);
          next = { w: Math.max(20, Math.min(fig.width - p.x, right - p.x)), h: Math.max(20, Math.min(fig.height - p.y, bottom - p.y)) };
          box.style.width = `${next.w * zoom}px`;
          box.style.height = `${next.h * zoom}px`;
        } else {
          next = { x: Math.max(0, Math.min(fig.width - p.w, snapX(p.x + dx, p.w))), y: Math.max(0, Math.min(fig.height - p.h, snapY(p.y + dy, p.h))) };
          box.style.left = `${next.x * zoom}px`;
          box.style.top = `${next.y * zoom}px`;
        }
      };
      const up = () => {
        box.removeEventListener('pointermove', move);
        box.removeEventListener('pointerup', up);
        if (next) commit(updatePanel(figure(), p.id, next), resizing ? 'Resize panel' : 'Move panel');
      };
      box.addEventListener('pointermove', move);
      box.addEventListener('pointerup', up);
    });
  }

  stage.addEventListener('pointerdown', (event) => {
    if (event.target === stage || event.target === overlay || event.target === canvas) {
      state.panel = null;
      for (const other of overlay.querySelectorAll('.figure-box.selected')) other.classList.remove('selected');
      renderProps();
    }
  });

  stage.addEventListener('keydown', (event) => {
    const fig = figure();
    const p = panel();
    if (!fig || !p) return;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      removeSelected();
    } else if (event.key === 'Escape') {
      state.panel = null;
      renderAll();
    } else if (event.key.startsWith('Arrow')) {
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
      const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
      commit(updatePanel(fig, p.id, { x: Math.max(0, Math.min(fig.width - p.w, p.x + dx)), y: Math.max(0, Math.min(fig.height - p.h, p.y + dy)) }), 'Nudge panel');
    }
  });

  function removeSelected() {
    const fig = figure();
    const p = panel();
    if (!p) return;
    state.panel = null;
    const letter = drawn?.panels.find((x) => x.id === p.id)?.letter;
    commit(removePanel(fig, p.id), 'Remove panel', `Removed from the figure "${fig.name}"${letter ? ` panel ${letter}` : ''}: ${panelSummary(p, store.ws)}`);
  }

  // --- Properties -------------------------------------------------------------------------------------

  const field = (label, control) => h('label.field', h('span', label), control);
  const setPanel = (patch, label = 'Edit panel') => commit(updatePanel(figure(), state.panel, patch), label);

  function addMap() {
    const run = activeRun(app);
    if (!run) {
      toast('Score the counts first: a map panel shows a run.');
      return;
    }
    const fig = figure();
    const added = addPanel(fig, { kind: 'map', run: run.id, condition: 0, colorBy: 'score', rowOrder: 'biochemical', palette: 'rdbu', tracks: [] });
    state.panel = added.panel.id;
    commit(added.figure, 'Add map', `Added to the figure "${fig.name}" ${panelSummary(added.panel, store.ws)}`);
  }

  function addText() {
    const fig = figure();
    const added = addPanel(fig, { kind: 'text', text: 'Text', w: Math.min(200, fig.width - 2 * MARGIN), h: fig.text * 3 });
    state.panel = added.panel.id;
    commit(added.figure, 'Add text', `Added to the figure "${fig.name}" a text panel`);
  }

  function pageProps(fig) {
    const sizeSelect = h('select.input.small', {
      onchange: (event) => {
        const s = figureSize(event.target.value);
        if (s) commit({ ...fig, size: s.id, width: Math.round(s.width * 100) / 100, height: Math.round(s.height * 100) / 100, panels: fig.panels.map((p) => fit(p, s.width, s.height)) }, 'Page size');
      },
    }, ...FIGURE_SIZES.map((s) => h('option', { value: s.id, selected: s.id === fig.size }, `${s.label} (${toMM(s.width)} mm wide)`)), h('option', { value: 'custom', selected: !figureSize(fig.size) }, 'Custom'));
    const mmInput = (key) => h('input.input.small', {
      type: 'number', min: 25, max: 700, step: 1, value: toMM(fig[key]),
      onchange: (event) => {
        const v = Number(event.target.value);
        if (!(v >= 25 && v <= 700)) return;
        const next = { ...fig, size: 'custom', [key]: Math.round(mm(v) * 100) / 100 };
        commit({ ...next, panels: fig.panels.map((p) => fit(p, next.width, next.height)) }, 'Page size');
      },
    });
    propsEl.append(h('h3', icon('figure'), 'Page'),
      field('Name', h('input.input.small', { value: fig.name, onchange: (event) => { const name = event.target.value.trim(); if (name && name !== fig.name) commit({ ...fig, name }, 'Rename figure', `Renamed the figure "${fig.name}" "${name}"`); } })),
      field('Size', sizeSelect),
      h('div.row', field('Width (mm)', mmInput('width')), field('Height (mm)', mmInput('height'))),
      field('Text (pt)', h('input.input.small', { type: 'number', min: 4, max: 36, step: 0.5, value: fig.text, onchange: (event) => { const v = Number(event.target.value); if (v >= 4 && v <= 36) commit({ ...fig, text: v }, 'Text size'); } })),
      h('label.check', h('input', { type: 'checkbox', checked: fig.letters, onchange: (event) => commit({ ...fig, letters: event.target.checked }, 'Panel letters') }), 'Letter the panels A, B, C…'),
      h('div.section-title', 'Add a panel'),
      h('div.btn-row',
        h('button.btn.small', { type: 'button', onclick: addMap, title: 'The map of the run in focus; or use Add to figure in the Map view, which takes the map as it is shown' }, icon('heatmap'), 'Map'),
        h('button.btn.small', { type: 'button', onclick: addText }, icon('plus'), 'Text')),
      h('p.muted', { style: { fontSize: '11.5px' } }, 'Drag a panel to move it and its corner to resize it; they snap to the margins and to each other. The arrow keys nudge the selected panel (Shift: 10 pt); Delete removes it.'),
      h('div.btn-row', { style: { marginTop: '10px' } }, h('button.btn.small.danger', { type: 'button', onclick: () => deleteFigure(fig) }, icon('trash'), 'Delete figure')));
  }

  // A panel kept on a page of another size.
  function fit(p, width, height) {
    const w = Math.min(p.w, width - 2 * MARGIN);
    const hh = Math.min(p.h, height - 2 * MARGIN);
    return { ...p, w, h: hh, x: Math.max(0, Math.min(p.x, width - w)), y: Math.max(0, Math.min(p.y, height - hh)) };
  }

  function mapProps(p) {
    const ws = store.ws;
    const run = ws.runs.find((r) => r.id === p.run);
    const results = run ? runEntry(app, run)?.results : null;
    if (run && !results) ensureResults(app, run);
    const runSelect = h('select.input.small', { onchange: (event) => setPanel({ run: event.target.value, condition: 0, contrast: undefined, tracks: [] }, 'Panel run') },
      ...ws.runs.map((r) => h('option', { value: r.id, selected: r.id === p.run }, r.name)), run ? null : h('option', { value: p.run, selected: true }, `${p.run} (gone)`));
    const conditions = results?.conditions ?? [];
    const contrasts = results?.differential ?? [];
    const showSelect = h('select.input.small', {
      onchange: (event) => {
        const [kind, i] = event.target.value.split(':');
        setPanel(kind === 'contrast' ? { contrast: Number(i), condition: undefined, colorBy: undefined } : { condition: Number(i), contrast: undefined, colorBy: p.colorBy ?? 'score' }, 'Panel shows');
      },
    }, ...(conditions.length ? conditions : [{ name: 'The run' }]).map((c, i) => h('option', { value: `condition:${i}`, selected: !Number.isInteger(p.contrast) && (p.condition ?? 0) === i }, c.name)),
    ...contrasts.map((c, i) => h('option', { value: `contrast:${i}`, selected: p.contrast === i }, `Difference: ${c.name}`)));
    const colorSelect = h('select.input.small', { disabled: Number.isInteger(p.contrast), onchange: (event) => setPanel({ colorBy: event.target.value }, 'Panel colors') },
      ...Object.entries(COLOR_BY).filter(([id]) => id !== 'differential').map(([id, c]) => h('option', { value: id, selected: (p.colorBy ?? 'score') === id }, c.label ?? id)));
    const paletteSelect = h('select.input.small', { onchange: (event) => setPanel({ palette: event.target.value }, 'Panel palette') }, ...PALETTES.map(([id, label]) => h('option', { value: id, selected: (p.palette ?? 'rdbu') === id }, label)));
    const rowsSelect = h('select.input.small', { onchange: (event) => setPanel({ rowOrder: event.target.value }, 'Panel rows') }, ...Object.entries(ROW_ORDERS).map(([id, o]) => h('option', { value: id, selected: (p.rowOrder ?? 'biochemical') === id }, o.label)));
    const position = (key) => h('input.input.small', {
      type: 'number', min: 1, step: 1, value: p[key] ?? '', placeholder: key === 'from' ? '1' : 'the end',
      onchange: (event) => {
        const v = event.target.value === '' ? undefined : Math.round(Number(event.target.value));
        if (v === undefined || v >= 1) setPanel({ [key]: v }, 'Panel positions');
      },
    });
    const titleInput = h('input.input.small', { value: p.title ?? '', placeholder: 'The map\'s own (empty: none)', onchange: (event) => setPanel({ title: event.target.value === '' && p.title === undefined ? undefined : event.target.value }, 'Panel title') });
    const tracksEl = h('div.figure-tracks', h('p.muted', { style: { margin: 0, fontSize: '11.5px' } }, 'Reading the tracks…'));
    loadTracks(p, tracksEl);
    propsEl.append(
      field('Run', runSelect),
      field('Shows', showSelect),
      h('div.row', field('Colored by', colorSelect), field('Rows', rowsSelect)),
      field('Palette', paletteSelect),
      h('div.row', field('From position', position('from')), field('To', position('to'))),
      field('Title', titleInput),
      h('label.check', h('input', { type: 'checkbox', checked: p.medians !== false, onchange: (event) => setPanel({ medians: event.target.checked ? undefined : false }, 'Panel medians') }), 'The medians of each position and substitution'),
      h('label.check', h('input', { type: 'checkbox', checked: p.legend !== false, onchange: (event) => setPanel({ legend: event.target.checked ? undefined : false }, 'Panel legend') }), 'The color bar and the states\' key'),
      h('div.section-title', 'Tracks'), tracksEl);
  }

  // The run's tracks, each shown in the panel or not, in the Map view's order.
  async function loadTracks(p, el) {
    const data = drawn?.resolved?.get(p.id);
    tracksOf = { panel: p.id, tracks: null };
    if (!data?.model || !data.run) {
      clear(el);
      el.append(h('p.muted', { style: { margin: 0, fontSize: '11.5px' } }, data?.missing ?? 'The map is being drawn…'));
      tracksOf = { panel: null, tracks: null };
      return;
    }
    const all = arrangeTracks((await runTracks(app, data.run, data.model)).tracks, store.ws.tracks);
    if (state.panel !== p.id) return;
    tracksOf = { panel: p.id, tracks: all };
    clear(el);
    const shown = new Set(p.tracks ?? []);
    if (!all.length) el.append(h('p.muted', { style: { margin: 0, fontSize: '11.5px' } }, 'The run has no tracks.'));
    for (const t of all) {
      el.append(h('label.check', h('input', {
        type: 'checkbox',
        checked: shown.has(t.id),
        onchange: (event) => {
          const next = all.map((x) => x.id).filter((id) => (id === t.id ? event.target.checked : shown.has(id)));
          setPanel({ tracks: next }, 'Panel tracks');
        },
      }), t.label));
    }
  }

  function textProps(p) {
    const area = h('textarea.input', { rows: 4, value: p.text });
    area.addEventListener('change', () => setPanel({ text: area.value }, 'Edit text'));
    propsEl.append(field('Text', area),
      h('div.row',
        field('Size (pt)', h('input.input.small', { type: 'number', min: 4, max: 48, step: 0.5, value: p.size ?? figure().text, onchange: (event) => { const v = Number(event.target.value); if (v >= 4 && v <= 48) setPanel({ size: v }, 'Text size'); } })),
        field('Align', h('select.input.small', { onchange: (event) => setPanel({ align: event.target.value }, 'Align text') }, ...['left', 'center', 'right'].map((a) => h('option', { value: a, selected: (p.align ?? 'left') === a }, a))))),
      h('label.check', h('input', { type: 'checkbox', checked: Boolean(p.bold), onchange: (event) => setPanel({ bold: event.target.checked || undefined }, 'Bold text') }), 'Bold'));
  }

  function renderProps() {
    clear(propsEl);
    const fig = figure();
    if (!fig) {
      propsEl.append(h('h3', 'Properties'), h('p.muted', 'Make a figure to lay out its panels.'));
      return;
    }
    const p = panel();
    if (!p) {
      pageProps(fig);
      return;
    }
    const letter = drawn?.panels.find((x) => x.id === p.id)?.letter ?? null;
    propsLetter = letter;
    propsEl.append(h('h3', icon(p.kind === 'map' ? 'heatmap' : 'figure'), `${letter ? `Panel ${letter}: ` : ''}${p.kind === 'map' ? 'Map' : 'Text'}`, h('span.spacer'),
      h('button.icon-button.small', { type: 'button', title: 'Remove the panel', onclick: removeSelected }, icon('trash'))));
    if (p.kind === 'map') mapProps(p);
    else textProps(p);
    propsEl.append(
      h('div.section-title', 'Place'),
      h('div.row',
        field('x (mm)', h('input.input.small', { type: 'number', step: 0.5, value: toMM(p.x), onchange: (event) => setPanel({ x: Math.max(0, mm(Number(event.target.value) || 0)) }, 'Move panel') })),
        field('y (mm)', h('input.input.small', { type: 'number', step: 0.5, value: toMM(p.y), onchange: (event) => setPanel({ y: Math.max(0, mm(Number(event.target.value) || 0)) }, 'Move panel') }))),
      h('div.row',
        field('Width (mm)', h('input.input.small', { type: 'number', step: 0.5, value: toMM(p.w), onchange: (event) => setPanel({ w: Math.max(10, Math.min(fig.width - p.x, mm(Number(event.target.value) || 0))) }, 'Resize panel') })),
        field('Height (mm)', h('input.input.small', { type: 'number', step: 0.5, value: toMM(p.h), onchange: (event) => setPanel({ h: Math.max(10, Math.min(fig.height - p.y, mm(Number(event.target.value) || 0))) }, 'Resize panel') }))),
      h('label.check', h('input', { type: 'checkbox', checked: p.letter !== false, onchange: (event) => setPanel({ letter: event.target.checked ? undefined : false }, 'Panel letter') }), 'Lettered'));
    const notes = drawn?.panels.find((x) => x.id === p.id)?.notes ?? [];
    for (const note of notes) propsEl.append(h('div.callout.warn', icon('warning'), h('span', note)));
  }

  function renderAll() {
    if (state.figure !== figure()?.id) state.figure = figure()?.id ?? null;
    if (state.panel && !panel()) state.panel = null;
    renderList();
    renderHead();
    renderProps();
    drawPage();
  }

  const resize = new ResizeObserver(() => drawPage());
  resize.observe(stage);
  renderAll();
  return {
    update(topics) {
      if (topics.has('ws') || topics.has('workspace-loaded') || topics.has('focus')) renderAll();
      else if (topics.has('results')) {
        drawPage();
        if (panel()?.kind === 'map') renderProps();
      }
    },
    destroy() {
      resize.disconnect();
      token += 1;
      root.remove();
    },
  };
}
