// The Map view (wave 1, slice 7): a score run's variant-effect map (requirements V2, V3, R3, T6).
// Positions across, substitutions down, colored by score (or SE, replicates, input count), each
// state drawn its own way and named in the legend; the median of each position above and of each
// substitution at the right; target and reference numbering. Select by click, rectangle,
// freeform shape or query (wave 4, slice 5: lib/query.js; the selection is shared, the inspector
// shows its first variant), save selections by name and combine them, export SVG and PNG. The map is described in words, and every cell is in the table below it. A nucleotide
// run is drawn from its protein view (collapse.js); every variant not on the map (frameshifts,
// splice-site, intronic and UTR variants, insertions, deletions, multi-variants) is in a table
// beside it (wave 3, slice 3). Sequence tracks below the grid (ui/tracks.js; wave 3, slice 5): the
// run's own and the workspace's annotations, arranged in the Tracks panel, in the exports and in
// words.

import { h, icon, clear, downloadBlob, formatCount } from './dom.js';
import { promptDialog, showMenu, toast } from './overlays.js';
import { buildMapModel, cellAt, cellName, COLOR_BY, describeMap, NO_DIFFERENTIAL, offMapRows, ROW_ORDERS, STATE, STATE_NAMES } from '../lib/map-model.js';
import { proteinView } from '../lib/collapse.js';
import { KIND_NAMES } from '../lib/variants.js';
import { DIFFERENTIAL_REASON_NAMES } from '../lib/differential.js';
import { mapSVG } from '../lib/map-svg.js';
import { flagNames, STAGE_BY_CODE } from '../lib/filters.js';
import { addSelection, removeSelection } from '../lib/workspace.js';
import { combineSelections, QUERY_HELP, QueryError } from '../lib/query.js';
import { activeRun, runQuery, setsFor } from './selections.js';
import { checkRobustness, robustnessOf } from './robustness.js';
import { addPublicTrack } from './tracks.js';
import { ensureResults, runEntry } from './run-results.js';
import { mountVariantMap } from './variant-map.js';
import { exportSelection } from './record.js';
import { annotationsSignature, exportTracks, runTracks, tracksPanel } from './tracks.js';
import { arrangeTracks, describeTrack, describeTrackAt, sourceText } from '../lib/tracks.js';
import { possessive } from '../lib/words.js';
import { figureMenu, mapPanelOf } from './figure-data.js';

// Named by their colors only: which end is loss of function depends on the assay (the readout).
const PALETTES = [['rdbu', 'Blue (lower) – red (higher)'], ['puor', 'Purple (lower) – orange (higher)']];
const fmt = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '—');
const PAGE = 50;

export function mountMapMode(app, container) {
  const { store } = app;
  const root = h('div.view');
  container.append(root);
  app.mapView ??= { colorBy: 'score', rowOrder: 'biochemical', palette: 'rdbu', condition: 0, contrast: 0, show: 'all', page: 0, offKind: 'all', offPage: 0 };
  const view = app.mapView;
  view.dragMode ??= 'pan';
  view.query ??= '';
  view.queryOp ??= 'replace';
  let map = null;
  let mapKey = '';
  let model = null;
  let results = null;
  // The run's own results (a nucleotide run's, whose protein view is `results`).
  let own = null;
  let run = null;
  let cellOfKey = new Map();
  // The tracks read for the model shown: { run, model, all, tracks (arranged), problems, notes }.
  let trackState = null;
  let tracksToken = 0;
  const panel = tracksPanel(app);
  const shownTracks = () => (trackState && trackState.model === model ? trackState.tracks.filter((t) => t.shown) : []);

  const currentRun = () => activeRun(app);

  // The condition a selection or the inspector refers to: the one shown, or a contrast's condition.
  const conditionIndex = () => (model?.contrast ? results.conditions.findIndex((x) => x.id === model.contrast.condition) : view.condition);

  // A cell in words: for the tooltip, the keyboard and screen readers.
  function describeCell(cell) {
    const c = model.source;
    const name = cellName(model, cell);
    const where = model.target.offset ? ` (reference ${cell.position + model.target.offset})` : '';
    const i = cell.index;
    if (cell.state === STATE.NOT_DESIGNED) return `${name}${where}: outside the designed tiles`;
    if (i < 0) return `${name}${where}: ${cell.reference ? 'the reference residue (no synonymous variant in the table)' : 'missing: not in the table'}`;
    if (c.reason[i] === NO_DIFFERENTIAL) return `${name}${where}: no differential score (${DIFFERENTIAL_REASON_NAMES[c.contrast.reason[i]]})`;
    if (model.contrast && !c.reason[i]) {
      const d = c.contrast;
      const base = `${name}${where}: difference ${fmt(d.delta[i])} ± ${fmt(d.se[i])}, q ${d.q[i] < 0.001 ? d.q[i].toExponential(1) : fmt(d.q[i], 3)} (${d.method === 'limma' ? 'limma' : `from ${d.k[i]} ${d.method === 'paired' ? 'pairs' : 'replicates'}`})`;
      return c.flags[i] ? `${base}; from a score of low confidence` : base;
    }
    if (c.reason[i]) {
      const stage = STAGE_BY_CODE.get(c.reason[i]);
      return `${name}${where}: ${stage.id === 'measured' ? 'missing: not counted in every sample of any replicate' : `filtered (${stage.label.toLowerCase()}: ${stage.reason})`}`;
    }
    const base = `${name}${where}: score ${fmt(c.score[i])} ± ${fmt(c.se[i])} from ${c.k[i]} of ${c.expected[i]} replicates`;
    return c.flags[i] ? `${base}; low confidence: ${flagNames(c.flags[i]).join('; ')}` : base;
  }

  function selectionCells() {
    const sel = store.ui.selection;
    if (!sel || sel.run !== run?.id || sel.condition !== conditionIndex()) return [];
    return sel.keys.map((k) => cellOfKey.get(k)).filter((k) => k !== undefined);
  }

  // A selection made by hand has no query.
  function onSelect(cells, primary) {
    const keys = [...cells].map((k) => cellName(model, cellAt(model, Math.floor(k / model.rows.length) + 1, k % model.rows.length)));
    store.setUI({ selection: keys.length ? { run: run.id, condition: conditionIndex(), keys } : null }, ['selection']);
    if (primary) app.focusItem({ kind: 'variant', id: cellName(model, primary), run: run.id, condition: conditionIndex() });
    renderSelectionBar();
  }

  // A click on a track selects the variants of its position (a feature's: every position it covers).
  function onTrackClick(track, position, add) {
    const spans = track.kind === 'features' ? track.features.filter((f) => position >= f.start && position <= f.end).map((f) => [f.start, f.end]) : [];
    if (!spans.length) spans.push([position, position]);
    const R = model.rows.length;
    const cells = new Set(add ? selectionCells() : []);
    for (const [a, b] of spans) {
      for (let p = a; p <= b; p += 1) {
        for (let r = 0; r < R; r += 1) {
          const k = (p - 1) * R + r;
          if (model.state[k] === STATE.SCORED || model.state[k] === STATE.LOW || model.state[k] === STATE.FILTERED) cells.add(k);
        }
      }
    }
    map?.setSelection([...cells]);
    onSelect(cells, null);
  }

  const trackWordsEl = h('div');
  // Reads the run's tracks (its own at once, the annotations' from the library) and shows them.
  async function refreshTracks() {
    const token = (tracksToken += 1);
    const r = run;
    const m = model;
    const state = await runTracks(app, r, m);
    if (token !== tracksToken || m !== model) return;
    trackState = { run: r, model: m, all: state.tracks, tracks: arrangeTracks(state.tracks, store.ws.tracks), problems: state.problems, notes: state.notes, signature: annotationsSignature(store.ws) };
    app.trackStates ??= new Map();
    app.trackStates.set(r.id, trackState);
    map?.setTracks(shownTracks());
    panel.update(trackState);
    clear(trackWordsEl);
    const shown = shownTracks();
    if (shown.length) trackWordsEl.append(h('p.map-description', `Tracks below the map: ${shown.map((t) => describeTrack(t)).join(' ')}`));
    if (store.ui.focus?.kind === 'variant') store.notify(['tracks']);
  }

  // --- Export ------------------------------------------------------------------------------------
  const fileBase = () => `${(model.target.name || 'map').replace(/[^\w.-]+/g, '_')}${results.conditions.length > 1 ? `_${model.condition.name.replace(/[^\w.-]+/g, '_')}` : ''}${model.contrast ? '_differential' : ''}_${run.name.replace(/\s+/g, '')}`;
  function exportSVG() {
    downloadBlob(new Blob([mapSVG(model, { palette: view.palette, results, tracks: shownTracks() })], { type: 'image/svg+xml' }), `${fileBase()}.svg`);
  }
  async function exportPNG() {
    const svg = mapSVG(model, { palette: view.palette, results, tracks: shownTracks() });
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    try {
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error('The map could not be drawn as an image.'));
        img.src = url;
      });
      const scale = 3;
      const canvas = h('canvas', { width: img.width * scale, height: img.height * scale });
      const ctx = canvas.getContext('2d');
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      downloadBlob(blob, `${fileBase()}.png`);
    } catch (error) {
      toast(error.message, { kind: 'error' });
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // --- Panes -------------------------------------------------------------------------------------
  function controls() {
    const ws = store.ws;
    const select = (label, value, options, onChange) => {
      const el = h('select.input.small', { 'aria-label': label, title: label, onchange: () => onChange(el.value) }, ...options.map(([v, text]) => h('option', { value: v, selected: v === value }, text)));
      return el;
    };
    return h('div.map-controls',
      ws.runs.length > 1 ? select('Score run', run.id, ws.runs.slice().reverse().map((r) => [r.id, r.name]), (v) => { view.run = v; app.focusItem({ kind: 'run', id: v }); }) : null,
      results.conditions.length > 1 && !model.contrast ? h('div.segmented', ...results.conditions.map((c, i) => h(`button${i === view.condition ? '.active' : ''}`, { type: 'button', 'aria-pressed': i === view.condition ? 'true' : 'false', onclick: () => { view.condition = i; render(); } }, c.name))) : null,
      model.contrast && results.differential.length > 1 ? select('Contrast', String(view.contrast), results.differential.map((d, j) => [String(j), d.name]), (v) => { view.contrast = Number(v); render(); }) : null,
      select('Color by', model.colorBy, Object.entries(COLOR_BY).filter(([k]) => k !== 'differential' || results.differential?.length).map(([k, v]) => [k, v.label]), (v) => { view.colorBy = v; render(); }),
      select('Rows', view.rowOrder, Object.entries(ROW_ORDERS).map(([k, v]) => [k, `Rows: ${v.label.toLowerCase()}`]), (v) => { view.rowOrder = v; render(); }),
      model.domain.kind === 'diverging' ? select('Colors', view.palette, PALETTES, (v) => { view.palette = v; map?.setPalette(v); renderLegend(); }) : null,
      h('span.spacer'),
      h('button.icon-button', { type: 'button', title: 'Zoom out (−)', 'aria-label': 'Zoom out', onclick: () => map?.zoom(1 / 1.5) }, icon('minus')),
      h('button.icon-button', { type: 'button', title: 'Zoom in (+)', 'aria-label': 'Zoom in', onclick: () => map?.zoom(1.5) }, icon('plus')),
      h('button.btn.small', { type: 'button', onclick: () => map?.fit() }, 'Fit'),
      h('button.btn.small', { type: 'button', title: 'The map as it is shown (its positions, colors and tracks) as a panel of a figure', onclick: (event) => addToFigureMenu(event.currentTarget) }, icon('figure'), 'Add to figure'),
      h('button.btn.small', { type: 'button', onclick: (event) => showMenu(event.currentTarget, [
        { label: 'SVG (vector, for figures)', icon: 'download', onSelect: exportSVG },
        { label: 'PNG (3× resolution)', icon: 'download', onSelect: exportPNG },
        { label: 'The tracks shown (CSV)', icon: 'download', disabled: !shownTracks().length, onSelect: () => exportTracks(app, run, model, shownTracks()) },
      ]) }, icon('download'), 'Export'));
  }

  // The map as it is shown, as a panel of a figure (wave 6, slice 1): an existing figure or a new one.
  function addToFigureMenu(anchor) {
    const range = map?.shownRange();
    const whole = !range || (range.from === 1 && range.to === model.length);
    const panel = mapPanelOf({ ...view, colorBy: model.colorBy }, run, whole ? null : range, shownTracks());
    figureMenu(app, anchor, () => panel, `${possessive(run.name)} map${whole ? '' : ` (positions ${range.from}–${range.to})`}`);
  }

  const legendEl = h('div.map-legend');
  function renderLegend() {
    clear(legendEl);
    const colors = map?.colors();
    if (!colors) return;
    const d = model.domain;
    const stops = Array.from({ length: 13 }, (_, i) => `${colors.color(i / 12)} ${((100 * i) / 12).toFixed(1)}%`).join(', ');
    const label = model.contrast ? `Differential score, ${model.contrast.name}` : COLOR_BY[model.colorBy].label;
    const [low, high] = view.palette === 'puor' ? ['purple', 'orange'] : ['blue', 'red'];
    const [condition, reference] = model.contrast ? model.contrast.name.split(' vs ') : [];
    legendEl.append(
      h('div.map-scale', h('span.map-scale-bar', { style: { background: `linear-gradient(90deg, ${stops})` } }),
        h('span.map-scale-labels', h('span', fmt(d.min)), d.kind === 'diverging' ? h('span', model.contrast ? '0 no difference' : `${fmt(d.center)} wild type`) : null, h('span', fmt(d.max))),
        h('span.map-scale-title', { title: model.contrast ? `${label}: ${low} where a variant scores lower in ${condition} than in ${reference}, ${high} where higher` : d.kind === 'diverging' && !model.scale.stated ? 'The readout\'s direction is not stated (Experiment, Readout): which end means loss of function depends on what the assay selects for.' : null }, model.contrast ? `${condition} − ${reference}: ${low} lower, ${high} higher` : d.kind === 'diverging' ? (model.scale.stated ? `${label}: ${low} is ${model.scale.low}, ${high} ${model.scale.high}` : `${label}: ${low} lower, ${high} higher`) : label)),
      h('span.map-state', h('span.map-swatch.low', { style: { background: colors.paler(0.2) } }), `${STATE_NAMES[STATE.LOW]} (${formatCount(model.counts[STATE.LOW])})`),
      h('span.map-state', h('span.map-swatch.filtered'), `${STATE_NAMES[STATE.FILTERED]} (${formatCount(model.counts[STATE.FILTERED])})`),
      h('span.map-state', h('span.map-swatch.missing'), `${STATE_NAMES[STATE.MISSING]} (${formatCount(model.counts[STATE.MISSING])})`),
      h('span.map-state', h('span.map-swatch.reference', { style: { background: d.kind === 'diverging' ? colors.color(0.5) : undefined } }), 'reference residue'),
      model.counts[STATE.NOT_DESIGNED] ? h('span.map-state', h('span.map-swatch.none'), `not designed (${formatCount(model.counts[STATE.NOT_DESIGNED])})`) : null);
  }

  const selectionEl = h('div.map-selection');
  // The selection shown (of this run and condition), or null.
  const currentSelection = () => {
    const sel = store.ui.selection;
    return sel && sel.run === run?.id && sel.condition === conditionIndex() && sel.keys.length ? sel : null;
  };
  function setSelection(next) {
    store.setUI({ selection: next.keys.length ? { run: run.id, condition: conditionIndex(), keys: next.keys, ...(next.query ? { query: next.query } : {}) } : null }, ['selection']);
    map?.setSelection(selectionCells());
    renderSelectionBar();
    if (view.show === 'selected') renderTable();
  }
  // A saved selection used on this map: its variants here (a set saved on another run of the
  // protein keeps the names this map has), combined with the selection by an operation.
  function useSet(saved, operation) {
    if (operation === 'replace' && saved.run === run.id && !model.contrast && (saved.condition ?? 0) !== view.condition) {
      view.condition = saved.condition ?? 0;
      store.setUI({ selection: { run: run.id, condition: view.condition, keys: saved.keys, ...(saved.query ? { query: saved.query } : {}) } }, ['selection']);
      render();
      return;
    }
    const keys = saved.keys.filter((k) => cellOfKey.has(k) && model.state[cellOfKey.get(k)] !== STATE.NOT_DESIGNED);
    const own = saved.run === run.id && (saved.condition ?? 0) === conditionIndex();
    const query = operation === 'replace' && own && saved.query ? saved.query : `in "${saved.name}"`;
    setSelection(combineSelections(currentSelection(), { keys, query }, operation));
  }
  function setMenu(saved) {
    const any = Boolean(currentSelection());
    return [
      { label: `Select its variants${saved.run === run.id ? '' : ' on this map'}`, icon: 'pointer', onSelect: () => useSet(saved, 'replace') },
      { label: 'Add them to the selection', icon: 'plus', disabled: !any, onSelect: () => useSet(saved, 'add') },
      { label: 'Keep only the selected that are in it', icon: 'filter', disabled: !any, onSelect: () => useSet(saved, 'intersect') },
      { label: 'Remove them from the selection', icon: 'minus', disabled: !any, onSelect: () => useSet(saved, 'subtract') },
      ...(saved.query ? [{ label: `Run its query here: ${saved.query}`, icon: 'search', onSelect: () => { view.query = saved.query; view.queryOp = 'replace'; applyQuery(); } }] : []),
      { label: 'Delete it', icon: 'trash', onSelect: () => store.commit(removeSelection(store.ws, saved.id), `Remove the selection "${saved.name}"`) },
    ];
  }
  function renderSelectionBar() {
    clear(selectionEl);
    const sel = currentSelection();
    const keys = sel ? sel.keys : [];
    const saved = setsFor(store.ws, run);
    const runName = (id) => store.ws.runs.find((r) => r.id === id)?.name ?? 'a run no longer here';
    selectionEl.append(
      keys.length
        ? h('div.btn-row', h('b', `${formatCount(keys.length)} selected`), sel.query ? h('span.muted.map-selection-keys', { title: sel.query }, `by query: ${sel.query}`) : h('span.muted.map-selection-keys', keys.slice(0, 6).join(', '), keys.length > 6 ? ', …' : ''), h('span.spacer'),
          h('button.btn.small', { type: 'button', onclick: async () => {
            const name = await promptDialog({ title: 'Save the selection', label: 'Name', value: `Selection ${store.ws.selections.length + 1}` });
            if (!name) return;
            const added = addSelection(store.ws, { name, run: run.id, condition: conditionIndex(), keys, ...(sel.query ? { query: sel.query } : {}) });
            store.commit(added.ws, `Save the selection "${name}"`);
          } }, icon('save'), 'Save as…'),
          h('button.btn.small', { type: 'button', onclick: (event) => showMenu(event.currentTarget, [
            { label: 'Selected variants with scores (CSV)', icon: 'download', onSelect: () => exportSelection(app, { name: 'selection', run: run.id, condition: conditionIndex(), keys }, 'csv') },
            { label: 'Selected variants (JSON)', icon: 'download', onSelect: () => exportSelection(app, { name: 'selection', run: run.id, condition: conditionIndex(), keys, query: sel.query ?? null, created: new Date().toISOString() }, 'json') },
          ]) }, icon('download'), 'Export'),
          h('button.btn.small', { type: 'button', onclick: () => { store.setUI({ selection: null }, ['selection']); map?.setSelection([]); renderSelectionBar(); } }, 'Clear'))
        : h('p.muted', { style: { margin: 0, fontSize: '12px' } }, 'Click a cell to inspect it; ⌘- or Ctrl-click adds to the selection, Shift-drag selects a rectangle, Option- or Alt-drag a freeform shape (or choose what a drag does, above). Drag to pan; ⌘ or Ctrl and the wheel (or a pinch) zooms. With the map focused, arrow keys move and Enter selects.'),
      saved.length ? h('div.btn-row', { style: { marginTop: '6px' } }, h('span.muted', { style: { fontSize: '12px' } }, 'Saved:'),
        ...saved.map((s) => h('span.chip', { title: `${s.keys.length} variants saved on ${runName(s.run)}${s.query ? ` by the query ${s.query}` : ''}. Click to select them, or to combine them with the selection.` },
          h('button.chip-button', { type: 'button', 'aria-haspopup': 'menu', onclick: (event) => showMenu(event.currentTarget, setMenu(s)) }, `${s.name} (${s.keys.length})`, s.run === run.id ? null : h('span.muted', ` · ${runName(s.run)}`)),
          h('button.chip-x', { type: 'button', 'aria-label': `Remove the selection ${s.name}`, onclick: () => store.commit(removeSelection(store.ws, s.id), `Remove the selection "${s.name}"`) }, '×')))) : null);
  }

  // --- Selection by query ----------------------------------------------------------------------
  const queryEl = h('div.map-query');
  let queryNote = null;
  // A query waiting for the run's robustness check.
  let pendingQuery = false;
  async function applyQuery() {
    const text = (view.query ?? '').trim();
    if (!text || !run) return;
    queryNote = null;
    try {
      const found = await runQuery(app, run, text, { model, results, own });
      setSelection(combineSelections(currentSelection(), found, view.queryOp));
      queryNote = { kind: 'ok', message: `${formatCount(found.count)} variant${found.count === 1 ? '' : 's'} match${found.count === 1 ? 'es' : ''}${view.queryOp === 'replace' ? '' : `; ${formatCount(currentSelection()?.keys.length ?? 0)} selected`}.` };
    } catch (error) {
      if (!(error instanceof QueryError)) throw error;
      queryNote = { kind: 'error', message: error.message, need: error.need, position: error.position, focus: true };
    }
    renderQueryBar();
  }
  function renderQueryBar() {
    clear(queryEl);
    const input = h('input.input.mono.map-query-input', {
      type: 'text', value: view.query ?? '', spellcheck: false, autocomplete: 'off',
      placeholder: 'Select by query: missense at 40-80 with se < 0.2',
      'aria-label': 'Select variants by query', 'aria-describedby': 'map-query-note',
      oninput: () => { view.query = input.value; },
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); view.query = input.value; applyQuery(); } },
    });
    const op = h('select.input.small', { 'aria-label': 'What the query does to the selection', onchange: () => { view.queryOp = op.value; } },
      ...[['replace', 'Replace the selection'], ['add', 'Add to it'], ['intersect', 'Keep the matches in it'], ['subtract', 'Remove the matches from it']].map(([k, label]) => h('option', { value: k, selected: view.queryOp === k }, label)));
    const drag = h('div.segmented', { role: 'group', 'aria-label': 'What a drag on the map does' },
      ...[['pan', 'pointer', 'Pan', 'A drag pans the map (Shift-drag still selects a rectangle, Option- or Alt-drag a freeform shape)'], ['rectangle', 'rectangle', 'Rectangle', 'A drag selects a rectangle of cells'], ['freeform', 'lasso', 'Freeform', 'A drag draws a freeform shape and selects the cells inside it']].map(([k, glyph, label, title]) => h(`button${view.dragMode === k ? '.active' : ''}`, { type: 'button', title, 'aria-pressed': view.dragMode === k ? 'true' : 'false', onclick: () => { view.dragMode = k; map?.setDragMode(k); renderQueryBar(); } }, icon(glyph), label)));
    const robustness = run ? robustnessOf(app, run) : null;
    let note = null;
    if (queryNote?.kind === 'error') {
      const fix = queryNote.need === 'robustness'
        ? (robustness?.status === 'running' ? h('span.muted', ` Checking robustness… ${robustness.progress?.[1] ?? ''}`) : h('button.btn.small', { type: 'button', onclick: () => { pendingQuery = true; checkRobustness(app, run); renderQueryBar(); } }, icon('play'), 'Check robustness, then select'))
        : queryNote.need === 'features' && run.inputs.design.targets?.[0]?.identifiers?.uniprot
          ? h('button.btn.small', { type: 'button', onclick: async () => { const added = await addPublicTrack(app, run, 'uniprot-features'); if (added.ok) applyQuery(); else toast(added.message, { kind: 'error' }); } }, icon('plus'), 'Add UniProt\'s features, then select')
          : null;
      note = h('div.map-query-note.error', { id: 'map-query-note', role: 'alert' }, icon('warning'), h('span', queryNote.message), fix);
      // The input focused with the words from the error's place selected.
      if (queryNote.focus) {
        queryNote.focus = false;
        queueMicrotask(() => {
          input.focus();
          if (queryNote?.position >= 0) input.setSelectionRange(queryNote.position, input.value.length);
        });
      }
    } else if (queryNote?.kind === 'ok') note = h('div.map-query-note', { id: 'map-query-note' }, queryNote.message);
    queryEl.append(
      h('div.btn-row.map-query-row', drag, input, op, h('button.btn.small', { type: 'button', onclick: () => { view.query = input.value; applyQuery(); } }, icon('search'), 'Select')),
      note,
      h('details.map-query-help', h('summary', 'Query words'),
        h('table.data.compact', h('tbody', ...QUERY_HELP.map(([words, means, example]) => h('tr', h('td.mono', words), h('td', means), h('td', h('button.chip-button.mono', { type: 'button', title: 'Use this example', onclick: () => { view.query = example; renderQueryBar(); } }, example))))))));
  }

  // The table alternative: every designed cell, with its state.
  function tableOf() {
    const c = model.source;
    const rows = [];
    const selected = new Set(selectionCells());
    for (let p = 1; p <= model.length; p += 1) {
      for (let r = 0; r < model.rows.length; r += 1) {
        const cell = cellAt(model, p, r);
        if (cell.state === STATE.NOT_DESIGNED) continue;
        if (view.show === 'scored' && cell.state !== STATE.SCORED && cell.state !== STATE.LOW) continue;
        if (view.show === 'other' && (cell.state === STATE.SCORED || cell.state === STATE.LOW)) continue;
        if (view.show === 'selected' && !selected.has(cell.k)) continue;
        rows.push(cell);
      }
    }
    const pages = Math.max(1, Math.ceil(rows.length / PAGE));
    view.page = Math.min(view.page, pages - 1);
    const show = h('select.input.small', { 'aria-label': 'Cells shown', onchange: () => { view.show = show.value; view.page = 0; renderTable(); } },
      ...[['all', 'Every designed cell'], ['scored', 'Scored'], ['other', 'Not scored'], ['selected', 'Selected']].map(([k, label]) => h('option', { value: k, selected: view.show === k }, label)));
    return h('div',
      h('div.btn-row', { style: { margin: '8px 0' } }, show, h('span.spacer'), h('span.muted', { style: { fontSize: '12px' } }, `${formatCount(rows.length)} cells`),
        h('button.btn.small', { type: 'button', disabled: view.page === 0, 'aria-label': 'Previous page', onclick: () => { view.page -= 1; renderTable(); } }, '‹'),
        h('span.muted', { style: { fontSize: '12px' } }, `${view.page + 1} / ${pages}`),
        h('button.btn.small', { type: 'button', disabled: view.page >= pages - 1, 'aria-label': 'Next page', onclick: () => { view.page += 1; renderTable(); } }, '›')),
      h('table.data', h('thead', h('tr', h('th', 'Variant'), h('th.r', 'Position'), model.target.offset ? h('th.r', 'Reference position') : null, h('th.r', model.contrast ? 'Difference' : 'Score'), h('th.r', 'SE'), h('th', 'State'))),
        h('tbody', ...rows.slice(view.page * PAGE, (view.page + 1) * PAGE).map((cell) => {
          const i = cell.index;
          const scored = cell.state === STATE.SCORED || cell.state === STATE.LOW || (cell.reference && i >= 0 && !c.reason[i]);
          return h('tr', { style: { cursor: 'pointer' }, onclick: () => { map?.focusCell(cell.k); onSelect(new Set([cell.k]), cell); map?.setSelection([cell.k]); } },
            h('td.mono', cellName(model, cell)), h('td.r', String(cell.position)), model.target.offset ? h('td.r', String(cell.position + model.target.offset)) : null,
            h('td.r', scored ? fmt(c.score[i]) : '—'), h('td.r', scored ? fmt(c.se[i]) : '—'), h('td', model.contrast && cell.state === STATE.FILTERED ? 'no difference estimated' : STATE_NAMES[cell.state]));
        }))));
  }
  const tableEl = h('div');
  function renderTable() {
    clear(tableEl).append(tableOf());
  }

  // The variants not on the map, from the run's own rows: what each is, its protein change, its
  // score or why it has none.
  function offMapTable() {
    const v = own.variants;
    // In order along the target (the 5′ UTR first; an intronic variant after its exon's base).
    const rows = offMapRows(own, model, own === results ? null : results).sort((a, b) => v.position[a] - v.position[b] || (v.key[a] < v.key[b] ? -1 : 1));
    if (!rows.length) return null;
    // Names shown without the target's accession, which every one of them repeats.
    const shortName = (key) => key.replace(/^[A-Za-z0-9_.-]+:(?=[cgmnopr]\.)/, '');
    const ci = conditionIndex();
    const c = own.conditions[Math.max(0, ci)];
    const kinds = [...new Set(rows.map((i) => v.kind[i]))].sort((a, b) => a - b);
    const shownRows = view.offKind === 'all' ? rows : rows.filter((i) => KIND_NAMES[v.kind[i]] === view.offKind);
    const pages = Math.max(1, Math.ceil(shownRows.length / PAGE));
    view.offPage = Math.min(view.offPage, pages - 1);
    const pick = h('select.input.small', { 'aria-label': 'Classes shown', onchange: () => { view.offKind = pick.value; view.offPage = 0; renderOffMap(); } },
      h('option', { value: 'all', selected: view.offKind === 'all' }, 'Every class'),
      ...kinds.map((k) => h('option', { value: KIND_NAMES[k], selected: view.offKind === KIND_NAMES[k] }, `${KIND_NAMES[k]} (${formatCount(rows.filter((i) => v.kind[i] === k).length)})`)));
    const state = (i) => {
      if (!c.reason[i]) return c.flags[i] ? 'low confidence' : 'scored';
      const stage = STAGE_BY_CODE.get(c.reason[i]);
      return stage?.id === 'measured' ? 'missing' : `filtered (${stage?.label.toLowerCase() ?? 'no score'})`;
    };
    return h('details.off-map', { open: view.offOpen ?? false, ontoggle: (e) => { view.offOpen = e.target.open; } },
      h('summary', `Not on the map (${formatCount(rows.length)})`),
      h('div.btn-row', { style: { margin: '8px 0' } }, pick, h('span.spacer'), h('span.muted', { style: { fontSize: '12px' } }, `${formatCount(shownRows.length)} variants`),
        h('button.btn.small', { type: 'button', disabled: view.offPage === 0, 'aria-label': 'Previous page', onclick: () => { view.offPage -= 1; renderOffMap(); } }, '‹'),
        h('span.muted', { style: { fontSize: '12px' } }, `${view.offPage + 1} / ${pages}`),
        h('button.btn.small', { type: 'button', disabled: view.offPage >= pages - 1, 'aria-label': 'Next page', onclick: () => { view.offPage += 1; renderOffMap(); } }, '›')),
      h('div.table-scroll', h('table.data', h('thead', h('tr', h('th', 'Variant'), h('th', 'Class'), v.proKey ? h('th', 'Protein') : null, h('th.r', 'Score'), h('th.r', 'SE'), h('th', 'State'))),
        h('tbody', ...shownRows.slice(view.offPage * PAGE, (view.offPage + 1) * PAGE).map((i) => h('tr', { style: { cursor: 'pointer' }, onclick: () => app.focusItem({ kind: 'variant', id: v.key[i], run: run.id, condition: Math.max(0, ci) }) },
          h('td.mono', { title: v.key[i] }, shortName(v.key[i])), h('td', KIND_NAMES[v.kind[i]]), v.proKey ? h('td.mono', v.proKey[i] || '—') : null,
          h('td.r', c.reason[i] ? '—' : fmt(c.score[i])), h('td.r', c.reason[i] ? '—' : fmt(c.se[i])), h('td', state(i))))))));
  }
  const offMapEl = h('div');
  function renderOffMap() {
    clear(offMapEl);
    const table = offMapTable();
    if (table) offMapEl.append(table);
  }

  // --- The view ----------------------------------------------------------------------------------
  function render() {
    clear(root);
    run = currentRun();
    root.append(h('div.workbench-head', h('h1', icon('heatmap'), 'Map', run ? h('span.crumbs', ` · ${run.name}`) : null), h('span.spacer')));
    const empty = (message, actions) => root.append(h('div.view-body', h('div.planned', h('div.empty', icon('heatmap'), h('h3', 'Variant-effect map'), h('p', message), h('div.btn-row', { style: { marginTop: '12px' } }, ...actions)))));
    if (!run) {
      empty('Positions across, substitutions down, colored by score; missing, filtered and low-confidence measurements each drawn their own way, never as "no effect". Score the counts first.', [
        h('button.btn.primary', { type: 'button', onclick: () => app.setMode(store.ws.sources.length ? 'score' : 'welcome') }, icon('score'), store.ws.sources.length ? 'Open Score' : 'Start')]);
      destroyMap();
      return;
    }
    view.run = run.id;
    const entry = runEntry(app, run);
    if (!entry?.results) {
      if (!entry) ensureResults(app, run);
      const failed = entry && entry.status === 'failed';
      root.append(h('div.view-body', h('div.pane', failed ? h('div.callout.danger', icon('warning'), h('span', `The run's scores could not be recomputed: ${entry.message}`)) : h('p.muted', { style: { margin: 0 } }, `Recomputing ${possessive(run.name)} scores from its recorded inputs…`))));
      destroyMap();
      return;
    }
    own = entry.results;
    // A nucleotide run is drawn at the protein level.
    results = proteinView(own) ?? own;
    view.condition = Math.min(view.condition, results.conditions.length - 1);
    try {
      view.contrast = Math.min(view.contrast ?? 0, Math.max(0, (results.differential?.length ?? 1) - 1));
      model = buildMapModel(results, run.inputs.design, { condition: view.condition, contrast: view.contrast, rowOrder: view.rowOrder, colorBy: view.colorBy });
    } catch (error) {
      root.append(h('div.view-body', h('div.pane', h('div.callout.warn', icon('warning'), h('span', error.message)))));
      destroyMap();
      return;
    }
    app.seen ??= { qc: new Map(), map: new Set() };
    if (!app.seen.map.has(run.id)) {
      app.seen.map.add(run.id);
      queueMicrotask(() => store.notify(['workflow']));
    }
    cellOfKey = new Map();
    for (let p = 1; p <= model.length; p += 1) for (let r = 0; r < model.rows.length; r += 1) { const cell = cellAt(model, p, r); cellOfKey.set(cellName(model, cell), cell.k); }
    const key = `${run.id}|${model.contrast ? `Δ${view.contrast}` : view.condition}`;
    if (!map || mapKey !== key) {
      destroyMap();
      map = mountVariantMap({
        model, palette: view.palette, selected: [], describe: describeCell, onSelect, onTrackClick, dragMode: view.dragMode,
        describeTrack: (t, p) => (p ? describeTrackAt(t, p, model.target.offset) : `${t.label}${t.source ? `: ${sourceText(t.source)}` : ''}`),
      });
      mapKey = key;
      // Remote control zooms the map shown (ui/remote.js, render_map).
      app.mapControl = map;
    } else {
      map.setModel(model);
    }
    map.setSelection(selectionCells());
    const description = describeMap(model, results);
    root.append(h('div.view-body.map-body',
      h('div.pane.map-pane', controls(), legendEl, map.el, queryEl, selectionEl, panel.el),
      h('div.pane', h('h3', icon('info'), 'In words'), ...description.map((line) => h('p.map-description', line)), trackWordsEl,
        offMapEl,
        h('details', h('summary', 'Every cell as a table'), tableEl))));
    map.el.setAttribute('aria-description', description.join(' '));
    renderLegend();
    renderQueryBar();
    renderSelectionBar();
    renderTable();
    renderOffMap();
    refreshTracks();
  }
  function destroyMap() {
    map?.destroy();
    if (app.mapControl === map) app.mapControl = null;
    map = null;
    mapKey = '';
  }

  // A saved selection focused in the dataset tree is shown on the map.
  function applyFocusedSelection() {
    const focus = store.ui.focus;
    if (focus?.kind !== 'selection') return false;
    const saved = store.ws.selections.find((s) => s.id === focus.id);
    if (!saved) return false;
    view.condition = saved.condition ?? 0;
    store.setUI({ selection: { run: saved.run, condition: saved.condition ?? 0, keys: saved.keys } }, ['selection']);
    return true;
  }

  applyFocusedSelection();
  render();
  return {
    update(topics) {
      if (topics.has('focus') && applyFocusedSelection()) {
        render();
        return;
      }
      if (topics.has('theme') || topics.has('colors')) map?.refreshTheme();
      if (topics.has('ws') || topics.has('results') || topics.has('workspace-loaded') || (topics.has('focus') && store.ui.focus?.kind === 'run')) render();
      else if (topics.has('selection') && map) {
        map.setSelection(selectionCells());
        renderSelectionBar();
        if (view.show === 'selected') renderTable();
      }
      if (topics.has('robustness') && run) {
        const state = robustnessOf(app, run);
        if (pendingQuery && state.status === 'done') {
          pendingQuery = false;
          applyQuery();
        } else if (pendingQuery && state.status === 'failed') {
          pendingQuery = false;
          queryNote = { kind: 'error', message: `The robustness check failed: ${state.error}` };
          renderQueryBar();
        } else if (queryNote?.need === 'robustness') renderQueryBar();
      }
      if (topics.has('theme') || topics.has('colors')) renderLegend();
    },
    destroy() {
      destroyMap();
      root.remove();
    },
  };
}
