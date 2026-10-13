// Selections across views (wave 4, slice 5; requirement V3). A selection is a list of variant names
// on a run's map (store.ui.selection: { run, condition, keys, query }); a saved one keeps its query
// too. The Map view makes them (click, rectangle, freeform, query); the Score view's table, the
// Robustness pane, the Compare view and remote control read them or send variants to the map.
// A saved selection is a list of names, so it applies to every run of the same protein.

import { proteinView } from '../lib/collapse.js';
import { buildMapModel, cellName, cellAt, STATE } from '../lib/map-model.js';
import { evaluateQuery, featuresOf, parseQuery, queryContext, queryUses } from '../lib/query.js';
import { targetProtein } from '../lib/target.js';
import { runTracks } from './tracks.js';
import { ensureResults, runEntry } from './run-results.js';
import { possessive } from '../lib/words.js';

// A run's protein, for matching runs of one target (null: none to read).
export function proteinOfRun(run) {
  const target = run?.inputs?.design?.targets?.length === 1 ? run.inputs.design.targets[0] : null;
  if (!target) return null;
  try {
    return targetProtein(target);
  } catch {
    return null;
  }
}

// The run the map shows, and the Structure view colors by (wave 5, slice 3): the one in focus (a
// run, or a variant's, position's or saved selection's run), else the one last shown, else the
// latest.
export function activeRun(app) {
  const ws = app.store.ws;
  const focus = app.store.ui.focus;
  const byId = (id) => ws.runs.find((r) => r.id === id) ?? null;
  // A run focused that is no longer in the workspace (undone, or an agent's rejected) is passed over.
  if (focus?.kind === 'run' && byId(focus.id)) return byId(focus.id);
  if ((focus?.kind === 'variant' || focus?.kind === 'position') && focus.run) return byId(focus.run) ?? ws.runs.at(-1) ?? null;
  if (focus?.kind === 'selection') {
    const saved = ws.selections.find((s) => s.id === focus.id);
    if (saved) return byId(saved.run) ?? ws.runs.at(-1) ?? null;
  }
  const shown = app.mapView?.run;
  if (shown && byId(shown)) return byId(shown);
  return ws.runs.at(-1) ?? null;
}

// The saved selections that apply to a run: its own, and those of other runs of the same protein.
export function setsFor(ws, run) {
  const protein = proteinOfRun(run);
  return ws.selections.filter((s) => {
    if (s.run === run.id) return true;
    const other = ws.runs.find((r) => r.id === s.run);
    return Boolean(other && protein && proteinOfRun(other) === protein);
  });
}

// A run's map: { own (its results), results (the map's: a nucleotide run's protein view), model }.
export async function runMap(app, run, { condition = 0, contrast = null } = {}) {
  const entry = runEntry(app, run) ?? await ensureResults(app, run);
  if (!entry?.results) throw new Error(entry?.message ?? `${possessive(run.name)} scores could not be recomputed.`);
  const own = entry.results;
  const results = proteinView(own) ?? own;
  const model = buildMapModel(results, run.inputs.design, contrast === null ? { condition } : { contrast, colorBy: 'differential' });
  return { own, results, model };
}

// The map's keys of a run's own rows (a nucleotide variant: the protein variant it makes), those
// not on the map left out. { keys, offMap }.
export function mapKeysOfRows(model, results, own, rows) {
  const cellOfRow = new Map();
  for (let k = 0; k < model.cells.length; k += 1) if (model.cells[k] >= 0 && model.state[k] !== STATE.NOT_DESIGNED) cellOfRow.set(model.cells[k], k);
  let mapRows = rows;
  if (results !== own) {
    const of = new Map();
    results.variants.members.forEach((members, j) => { for (const r of members) of.set(r, j); });
    mapRows = rows.map((i) => of.get(i) ?? -1);
  }
  const R = model.rows.length;
  const keys = [];
  const seen = new Set();
  let offMap = 0;
  for (const i of mapRows) {
    const k = cellOfRow.get(i);
    if (k === undefined) {
      offMap += 1;
      continue;
    }
    if (seen.has(k)) continue;
    seen.add(k);
    keys.push(cellName(model, cellAt(model, Math.floor(k / R) + 1, k % R)));
  }
  return { keys, offMap };
}

// A run's own rows in the selection (a protein variant's nucleotide variants), or null when the
// selection is not of this run.
export function selectedRows(app, run, own) {
  const sel = app.store.ui.selection;
  if (!sel || sel.run !== run.id || !sel.keys.length) return null;
  const want = new Set(sel.keys);
  const view = proteinView(own);
  const rows = new Set();
  if (!view) {
    own.variants.key.forEach((k, i) => { if (want.has(k)) rows.add(i); });
  } else {
    view.variants.key.forEach((k, j) => { if (want.has(k)) for (const r of view.variants.members[j]) rows.add(r); });
  }
  return rows;
}

// What a query on a run's map is evaluated against: its robustness check when done, the features
// beside the map, the saved selections and the selection now.
export function selectionContext(app, run, { model, results, own, features = null }) {
  // The run's robustness check (ui/robustness.js), when done for its output.
  const state = app.robustness?.get(run.id);
  const checked = state && state.output === run.output.sha256 && state.status === 'done' ? state.summary : null;
  const sel = app.store.ui.selection;
  return queryContext({
    model, results, own, design: run.inputs.design,
    robustness: checked,
    features,
    sets: app.store.ws.selections.map((s) => ({ name: s.name, keys: s.keys })),
    selected: sel?.run === run.id ? sel.keys : [],
  });
}

// A query on a run's map: { query, keys, count }. Throws QueryError (with need 'robustness' or
// 'features' when that is what is missing).
export async function runQuery(app, run, text, map) {
  const ast = parseQuery(text);
  const features = queryUses(ast, 'feature') ? featuresOf((await runTracks(app, run, map.model)).tracks) : null;
  const { keys, count } = evaluateQuery(ast, selectionContext(app, run, { ...map, features }));
  return { query: String(text).trim(), keys, count };
}

// Shows variants of a run selected on its map: rows of the run's own results, or names (the map's,
// or the run's own: a nucleotide variant's protein variant), of a condition (index) or a contrast
// (index). The Map view opens with them. Returns { keys, offMap }.
export async function selectOnMap(app, run, { rows = null, names = null, condition = 0, contrast = null, query = null }) {
  const map = await runMap(app, run, { condition, contrast });
  let found = { keys: [], offMap: 0 };
  if (rows) found = mapKeysOfRows(map.model, map.results, map.own, rows);
  if (names) {
    const onMap = new Set();
    for (let k = 0; k < map.model.cells.length; k += 1) if (map.model.state[k] !== STATE.NOT_DESIGNED) onMap.add(cellName(map.model, cellAt(map.model, Math.floor(k / map.model.rows.length) + 1, k % map.model.rows.length)));
    const rowOf = new Map(map.own.variants.key.map((key, i) => [key, i]));
    const direct = names.filter((n) => onMap.has(n));
    const other = mapKeysOfRows(map.model, map.results, map.own, names.filter((n) => !onMap.has(n) && rowOf.has(n)).map((n) => rowOf.get(n)));
    found = { keys: [...new Set([...found.keys, ...direct, ...other.keys])], offMap: found.offMap + other.offMap + names.filter((n) => !onMap.has(n) && !rowOf.has(n)).length };
  }
  const { keys, offMap } = found;
  const at = contrast === null ? condition : Math.max(0, map.results.conditions.findIndex((c) => c.id === map.model.contrast.condition));
  app.mapView ??= { colorBy: 'score', rowOrder: 'biochemical', palette: 'rdbu', condition: 0, contrast: 0, show: 'all', page: 0 };
  app.mapView.run = run.id;
  if (contrast === null) {
    app.mapView.condition = condition;
    if (app.mapView.colorBy === 'differential') app.mapView.colorBy = 'score';
  } else {
    app.mapView.colorBy = 'differential';
    app.mapView.contrast = contrast;
  }
  app.store.setUI({ selection: keys.length ? { run: run.id, condition: at, keys, query } : null }, ['selection']);
  app.focusItem({ kind: 'run', id: run.id });
  app.setMode('map');
  return { keys, offMap };
}
