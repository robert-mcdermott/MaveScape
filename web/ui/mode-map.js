// The Map view (wave 1, slice 7): a score run's variant-effect map (requirements V2, V3, R3, T6).
// Positions across, substitutions down, colored by score (or SE, replicates, input count), each
// state drawn its own way and named in the legend; the median of each position above and of each
// substitution at the right; target and reference numbering. Select by click or rectangle (the
// selection is shared, the inspector shows its first variant), save selections by name, export SVG
// and PNG. The map is described in words, and every cell is in the table below it.

import { h, icon, clear, downloadBlob, formatCount } from './dom.js';
import { promptDialog, showMenu, toast } from './overlays.js';
import { buildMapModel, cellAt, cellName, COLOR_BY, describeMap, ROW_ORDERS, STATE, STATE_NAMES } from '../lib/map-model.js';
import { mapSVG } from '../lib/map-svg.js';
import { flagNames, STAGE_BY_CODE } from '../lib/filters.js';
import { addSelection, removeSelection } from '../lib/workspace.js';
import { ensureResults, runEntry } from './run-results.js';
import { mountVariantMap } from './variant-map.js';
import { exportSelection } from './record.js';

const PALETTES = [['rdbu', 'Blue (loss) – red (gain)'], ['puor', 'Purple (loss) – orange (gain)']];
const fmt = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '—');
const PAGE = 50;

export function mountMapMode(app, container) {
  const { store } = app;
  const root = h('div.view');
  container.append(root);
  app.mapView ??= { colorBy: 'score', rowOrder: 'biochemical', palette: 'rdbu', condition: 0, show: 'all', page: 0 };
  const view = app.mapView;
  let map = null;
  let mapKey = '';
  let model = null;
  let results = null;
  let run = null;
  let cellOfKey = new Map();

  function currentRun() {
    const ws = store.ws;
    const focus = store.ui.focus;
    if (focus?.kind === 'run') return ws.runs.find((r) => r.id === focus.id) ?? null;
    if (focus?.kind === 'variant' && focus.run) return ws.runs.find((r) => r.id === focus.run) ?? ws.runs.at(-1) ?? null;
    if (focus?.kind === 'selection') {
      const saved = ws.selections.find((s) => s.id === focus.id);
      if (saved) return ws.runs.find((r) => r.id === saved.run) ?? ws.runs.at(-1) ?? null;
    }
    if (view.run && ws.runs.some((r) => r.id === view.run)) return ws.runs.find((r) => r.id === view.run);
    return ws.runs.at(-1) ?? null;
  }

  // A cell in words: for the tooltip, the keyboard and screen readers.
  function describeCell(cell) {
    const c = results.conditions[view.condition];
    const name = cellName(model, cell);
    const where = model.target.offset ? ` (reference ${cell.position + model.target.offset})` : '';
    const i = cell.index;
    if (cell.state === STATE.NOT_DESIGNED) return `${name}${where}: outside the designed tiles`;
    if (i < 0) return `${name}${where}: ${cell.reference ? 'the reference residue (no synonymous variant in the table)' : 'missing: not in the table'}`;
    if (c.reason[i]) {
      const stage = STAGE_BY_CODE.get(c.reason[i]);
      return `${name}${where}: ${stage.id === 'measured' ? 'missing: not counted in every sample of any replicate' : `filtered (${stage.label.toLowerCase()}: ${stage.reason})`}`;
    }
    const base = `${name}${where}: score ${fmt(c.score[i])} ± ${fmt(c.se[i])} from ${c.k[i]} of ${c.expected[i]} replicates`;
    return c.flags[i] ? `${base}; low confidence: ${flagNames(c.flags[i]).join('; ')}` : base;
  }

  function selectionCells() {
    const sel = store.ui.selection;
    if (!sel || sel.run !== run?.id || sel.condition !== view.condition) return [];
    return sel.keys.map((k) => cellOfKey.get(k)).filter((k) => k !== undefined);
  }

  function onSelect(cells, primary) {
    const keys = [...cells].map((k) => cellName(model, cellAt(model, Math.floor(k / model.rows.length) + 1, k % model.rows.length)));
    store.setUI({ selection: keys.length ? { run: run.id, condition: view.condition, keys } : null }, ['selection']);
    if (primary) app.focusItem({ kind: 'variant', id: cellName(model, primary), run: run.id, condition: view.condition });
    renderSelectionBar();
  }

  // --- Export ------------------------------------------------------------------------------------
  const fileBase = () => `${(model.target.name || 'map').replace(/[^\w.-]+/g, '_')}${results.conditions.length > 1 ? `_${model.condition.name.replace(/[^\w.-]+/g, '_')}` : ''}_${run.name.replace(/\s+/g, '')}`;
  function exportSVG() {
    downloadBlob(new Blob([mapSVG(model, { palette: view.palette, results })], { type: 'image/svg+xml' }), `${fileBase()}.svg`);
  }
  async function exportPNG() {
    const svg = mapSVG(model, { palette: view.palette, results });
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
      results.conditions.length > 1 ? h('div.segmented', ...results.conditions.map((c, i) => h(`button${i === view.condition ? '.active' : ''}`, { type: 'button', 'aria-pressed': i === view.condition ? 'true' : 'false', onclick: () => { view.condition = i; render(); } }, c.name))) : null,
      select('Color by', view.colorBy, Object.entries(COLOR_BY).map(([k, v]) => [k, v.label]), (v) => { view.colorBy = v; render(); }),
      select('Rows', view.rowOrder, Object.entries(ROW_ORDERS).map(([k, v]) => [k, `Rows: ${v.label.toLowerCase()}`]), (v) => { view.rowOrder = v; render(); }),
      view.colorBy === 'score' ? select('Colors', view.palette, PALETTES, (v) => { view.palette = v; map?.setPalette(v); renderLegend(); }) : null,
      h('span.spacer'),
      h('button.icon-button', { type: 'button', title: 'Zoom out (−)', 'aria-label': 'Zoom out', onclick: () => map?.zoom(1 / 1.5) }, icon('minus')),
      h('button.icon-button', { type: 'button', title: 'Zoom in (+)', 'aria-label': 'Zoom in', onclick: () => map?.zoom(1.5) }, icon('plus')),
      h('button.btn.small', { type: 'button', onclick: () => map?.fit() }, 'Fit'),
      h('button.btn.small', { type: 'button', onclick: (event) => showMenu(event.currentTarget, [
        { label: 'SVG (vector, for figures)', icon: 'download', onSelect: exportSVG },
        { label: 'PNG (3× resolution)', icon: 'download', onSelect: exportPNG },
      ]) }, icon('download'), 'Export'));
  }

  const legendEl = h('div.map-legend');
  function renderLegend() {
    clear(legendEl);
    const colors = map?.colors();
    if (!colors) return;
    const d = model.domain;
    const stops = Array.from({ length: 13 }, (_, i) => `${colors.color(i / 12)} ${((100 * i) / 12).toFixed(1)}%`).join(', ');
    const label = COLOR_BY[model.colorBy].label;
    legendEl.append(
      h('div.map-scale', h('span.map-scale-bar', { style: { background: `linear-gradient(90deg, ${stops})` } }),
        h('span.map-scale-labels', h('span', fmt(d.min)), d.kind === 'diverging' ? h('span', `${fmt(d.center)} wild type`) : null, h('span', fmt(d.max))),
        h('span.map-scale-title', d.kind === 'diverging' ? `${label}: ${view.palette === 'puor' ? 'purple' : 'blue'} is loss, ${view.palette === 'puor' ? 'orange' : 'red'} gain` : label)),
      h('span.map-state', h('span.map-swatch.low', { style: { background: colors.paler(0.2) } }), `${STATE_NAMES[STATE.LOW]} (${formatCount(model.counts[STATE.LOW])})`),
      h('span.map-state', h('span.map-swatch.filtered'), `${STATE_NAMES[STATE.FILTERED]} (${formatCount(model.counts[STATE.FILTERED])})`),
      h('span.map-state', h('span.map-swatch.missing'), `${STATE_NAMES[STATE.MISSING]} (${formatCount(model.counts[STATE.MISSING])})`),
      h('span.map-state', h('span.map-swatch.reference', { style: { background: model.colorBy === 'score' ? colors.color(0.5) : undefined } }), 'reference residue'),
      model.counts[STATE.NOT_DESIGNED] ? h('span.map-state', h('span.map-swatch.none'), `not designed (${formatCount(model.counts[STATE.NOT_DESIGNED])})`) : null);
  }

  const selectionEl = h('div.map-selection');
  function renderSelectionBar() {
    clear(selectionEl);
    const sel = store.ui.selection;
    const keys = sel && sel.run === run?.id && sel.condition === view.condition ? sel.keys : [];
    const saved = store.ws.selections.filter((s) => s.run === run?.id);
    selectionEl.append(
      keys.length
        ? h('div.btn-row', h('b', `${formatCount(keys.length)} selected`), h('span.muted.map-selection-keys', keys.slice(0, 6).join(', '), keys.length > 6 ? ', …' : ''), h('span.spacer'),
          h('button.btn.small', { type: 'button', onclick: async () => {
            const name = await promptDialog({ title: 'Save the selection', label: 'Name', value: `Selection ${store.ws.selections.length + 1}` });
            if (!name) return;
            const added = addSelection(store.ws, { name, run: run.id, condition: view.condition, keys });
            store.commit(added.ws, `Save the selection "${name}"`);
          } }, icon('save'), 'Save as…'),
          h('button.btn.small', { type: 'button', onclick: (event) => showMenu(event.currentTarget, [
            { label: 'Selected variants with scores (CSV)', icon: 'download', onSelect: () => exportSelection(app, { name: 'selection', run: run.id, condition: view.condition, keys }, 'csv') },
            { label: 'Selected variants (JSON)', icon: 'download', onSelect: () => exportSelection(app, { name: 'selection', run: run.id, condition: view.condition, keys, created: new Date().toISOString() }, 'json') },
          ]) }, icon('download'), 'Export'),
          h('button.btn.small', { type: 'button', onclick: () => { store.setUI({ selection: null }, ['selection']); map?.setSelection([]); renderSelectionBar(); } }, 'Clear'))
        : h('p.muted', { style: { margin: 0, fontSize: '12px' } }, 'Click a cell to inspect it; ⌘- or Ctrl-click adds to the selection, Shift-drag selects a rectangle. Drag to pan; ⌘ or Ctrl and the wheel (or a pinch) zooms. With the map focused, arrow keys move and Enter selects.'),
      saved.length ? h('div.btn-row', { style: { marginTop: '6px' } }, h('span.muted', { style: { fontSize: '12px' } }, 'Saved:'),
        ...saved.map((s) => h('span.chip', h('button.chip-button', { type: 'button', title: `Select the ${s.keys.length} variants of "${s.name}"`, onclick: () => { view.condition = s.condition ?? 0; store.setUI({ selection: { run: s.run, condition: s.condition ?? 0, keys: s.keys } }, ['selection']); render(); } }, `${s.name} (${s.keys.length})`),
          h('button.chip-x', { type: 'button', 'aria-label': `Remove the selection ${s.name}`, onclick: () => store.commit(removeSelection(store.ws, s.id), `Remove the selection "${s.name}"`) }, '×')))) : null);
  }

  // The table alternative: every designed cell, with its state.
  function tableOf() {
    const c = results.conditions[view.condition];
    const rows = [];
    for (let p = 1; p <= model.length; p += 1) {
      for (let r = 0; r < model.rows.length; r += 1) {
        const cell = cellAt(model, p, r);
        if (cell.state === STATE.NOT_DESIGNED) continue;
        if (view.show === 'scored' && cell.state !== STATE.SCORED && cell.state !== STATE.LOW) continue;
        if (view.show === 'other' && (cell.state === STATE.SCORED || cell.state === STATE.LOW)) continue;
        rows.push(cell);
      }
    }
    const pages = Math.max(1, Math.ceil(rows.length / PAGE));
    view.page = Math.min(view.page, pages - 1);
    const show = h('select.input.small', { 'aria-label': 'Cells shown', onchange: () => { view.show = show.value; view.page = 0; renderTable(); } },
      ...[['all', 'Every designed cell'], ['scored', 'Scored'], ['other', 'Not scored']].map(([k, label]) => h('option', { value: k, selected: view.show === k }, label)));
    return h('div',
      h('div.btn-row', { style: { margin: '8px 0' } }, show, h('span.spacer'), h('span.muted', { style: { fontSize: '12px' } }, `${formatCount(rows.length)} cells`),
        h('button.btn.small', { type: 'button', disabled: view.page === 0, 'aria-label': 'Previous page', onclick: () => { view.page -= 1; renderTable(); } }, '‹'),
        h('span.muted', { style: { fontSize: '12px' } }, `${view.page + 1} / ${pages}`),
        h('button.btn.small', { type: 'button', disabled: view.page >= pages - 1, 'aria-label': 'Next page', onclick: () => { view.page += 1; renderTable(); } }, '›')),
      h('table.data', h('thead', h('tr', h('th', 'Variant'), h('th.r', 'Position'), model.target.offset ? h('th.r', 'Reference position') : null, h('th.r', 'Score'), h('th.r', 'SE'), h('th', 'State'))),
        h('tbody', ...rows.slice(view.page * PAGE, (view.page + 1) * PAGE).map((cell) => {
          const i = cell.index;
          const scored = cell.state === STATE.SCORED || cell.state === STATE.LOW || (cell.reference && i >= 0 && !c.reason[i]);
          return h('tr', { style: { cursor: 'pointer' }, onclick: () => { map?.focusCell(cell.k); onSelect(new Set([cell.k]), cell); map?.setSelection([cell.k]); } },
            h('td.mono', cellName(model, cell)), h('td.r', String(cell.position)), model.target.offset ? h('td.r', String(cell.position + model.target.offset)) : null,
            h('td.r', scored ? fmt(c.score[i]) : '—'), h('td.r', scored ? fmt(c.se[i]) : '—'), h('td', STATE_NAMES[cell.state]));
        }))));
  }
  const tableEl = h('div');
  function renderTable() {
    clear(tableEl).append(tableOf());
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
      root.append(h('div.view-body', h('div.pane', failed ? h('div.callout.danger', icon('warning'), h('span', `The run's scores could not be recomputed: ${entry.message}`)) : h('p.muted', { style: { margin: 0 } }, `Recomputing ${run.name}'s scores from its recorded inputs…`))));
      destroyMap();
      return;
    }
    results = entry.results;
    view.condition = Math.min(view.condition, results.conditions.length - 1);
    try {
      model = buildMapModel(results, run.inputs.design, { condition: view.condition, rowOrder: view.rowOrder, colorBy: view.colorBy });
    } catch (error) {
      root.append(h('div.view-body', h('div.pane', h('div.callout.warn', icon('warning'), h('span', error.message)))));
      destroyMap();
      return;
    }
    cellOfKey = new Map();
    for (let p = 1; p <= model.length; p += 1) for (let r = 0; r < model.rows.length; r += 1) { const cell = cellAt(model, p, r); cellOfKey.set(cellName(model, cell), cell.k); }
    const key = `${run.id}|${view.condition}`;
    if (!map || mapKey !== key) {
      destroyMap();
      map = mountVariantMap({ model, palette: view.palette, selected: [], describe: describeCell, onSelect });
      mapKey = key;
    } else {
      map.setModel(model);
    }
    map.setSelection(selectionCells());
    const description = describeMap(model, results);
    root.append(h('div.view-body.map-body',
      h('div.pane.map-pane', controls(), legendEl, map.el, selectionEl),
      h('div.pane', h('h3', icon('info'), 'In words'), ...description.map((line) => h('p.map-description', line)),
        h('details', h('summary', 'Every cell as a table'), tableEl))));
    map.el.setAttribute('aria-description', description.join(' '));
    renderLegend();
    renderSelectionBar();
    renderTable();
  }
  function destroyMap() {
    map?.destroy();
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
      }
      if (topics.has('theme') || topics.has('colors')) renderLegend();
    },
    destroy() {
      destroyMap();
      root.remove();
    },
  };
}
