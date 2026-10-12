// Scores on the structure, the Structure view's part (wave 5, slice 3; requirement X3): the scores
// the residues are colored by (the run and condition, or contrast, the map shows; or the comparison
// Compare shows, for its disagreement), the coloring computed with lib/structure-scores.js and
// given to the viewer, its legend in the map's grammar, and the strip of the target's positions
// below the view: their colors in order, which are on the structure, and an AlphaFold DB model's
// confidence beside them. The view (ui/mode-structure.js) holds the state and shares the selection.

import { h, clear, formatCount } from './dom.js';
import { activeRun } from './selections.js';
import { ensureResults, runEntry } from './run-results.js';
import { comparisonMapModels, computeComparison, currentFilters, currentPair, currentScale } from './mode-compare.js';
import { proteinView } from '../lib/collapse.js';
import { buildMapModel } from '../lib/map-model.js';
import { lossSide } from '../lib/readout.js';
import { possessive } from '../lib/words.js';
import { calibrationClasses, coloringLegend, coloringPalette, describeColoring, placeOnTarget, POSITION, POSITION_NAMES, positionColor, positionValues, QC_CLASSES, residueColors, SCORE_COLORINGS, STATE_COLORS, thresholdClasses } from '../lib/structure-scores.js';
import { PLDDT_BANDS, colorToHex } from '../lib/structure/colors.js';
import { CLASSES, CLASS_BY_ID } from '../lib/structure-evidence.js';
import { hexToRgb, displayColor } from '../lib/colormaps.js';

const fmt = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '—');

// How the residues are colored by scores, for the session: the coloring (null: the structure's own
// colors), the substitution, what abnormal-like is.
export function scoresSettings(state) {
  state.scores ??= { how: null, substitution: 'P', abnormal: { kind: 'threshold', value: null, side: null, calibration: 0 } };
  return state.scores;
}

// The scores of the run the map shows: { ok, run, own, results, model, condition (index), words },
// or { ok: false, pending, message } (its scores being recomputed, or none to show).
export function scoreSource(app) {
  const run = activeRun(app);
  if (!run) return { ok: false, message: 'This workspace has no score run: score the counts (Score), or open scores from MaveDB, and each residue takes its position\'s scores.' };
  const entry = runEntry(app, run);
  if (!entry?.results) {
    if (entry?.status === 'failed') return { ok: false, run, message: `${possessive(run.name)} scores could not be recomputed: ${entry.message}` };
    ensureResults(app, run);
    return { ok: false, pending: true, run, message: `Recomputing ${possessive(run.name)} scores from its recorded inputs…` };
  }
  const own = entry.results;
  const results = proteinView(own) ?? own;
  const view = app.mapView ?? {};
  const differential = view.colorBy === 'differential' && results.differential?.length;
  let model;
  try {
    model = buildMapModel(results, run.inputs.design, differential ? { contrast: Math.min(view.contrast ?? 0, results.differential.length - 1), colorBy: 'differential' } : { condition: Math.min(view.condition ?? 0, results.conditions.length - 1) });
  } catch (error) {
    return { ok: false, run, message: error.message };
  }
  const condition = model.contrast ? Math.max(0, results.conditions.findIndex((c) => c.id === model.contrast.condition)) : Math.min(view.condition ?? 0, results.conditions.length - 1);
  const words = model.contrast ? `${run.name}, ${model.contrast.name}` : `${run.name}${results.conditions.length > 1 ? `, ${model.condition.name}` : ''}`;
  return { ok: true, run, own, results, model, condition, words };
}

// The published calibrations of the record a run's scores are, as published (calibrated on that
// scale): [{ index, calibration }] of those with an abnormal class with a range.
export function calibrationsFor(app, run) {
  if (!run || run.inputs.parameters?.model !== 'published') return [];
  const ws = app.store.ws;
  const source = ws.sources.find((s) => s.sha256 === run.inputs.source.sha256);
  const record = source?.origin?.urn ? (ws.records ?? []).find((r) => r.urn === source.origin.urn) : null;
  return (record?.calibrations ?? []).map((calibration, index) => ({ index, calibration })).filter(({ calibration }) => calibration.classes.some((k) => k.class === 'abnormal' && Array.isArray(k.range)));
}

// What abnormal-like is for "fraction", from the settings: thresholdClasses or calibrationClasses.
// Throws with what is missing.
function abnormalOf(app, run, settings) {
  const a = settings.abnormal;
  if (a.kind === 'calibration') {
    const found = calibrationsFor(app, run).find((c) => c.index === a.calibration);
    if (!found) throw new Error(`${run.name} has no such calibration: its record's calibrations are of its scores as published.`);
    return calibrationClasses(found.calibration);
  }
  if (!Number.isFinite(a.value)) throw new Error('Fraction abnormal-like needs a threshold: the score beyond which a substitution is abnormal-like (or, for a record\'s scores as published, one of its calibrations).');
  return thresholdClasses(a.value, a.side ?? defaultSide(run));
}

// The side of a threshold the readout implies: below where a higher score is more function.
export const defaultSide = (run) => (lossSide(run.inputs.design).side === 'above' ? 'above' : 'below');

// Colors the structure by its settings: computes the coloring (lib/structure-scores.js), gives the
// viewer its residues' colors and the 'scores' scheme. state: the view's (structureState). Returns
// { ok, values, palette, legend, words, source, run, condition, model } or { ok: false, pending,
// message }; kept as state.colored.
export async function colorStructure(app, state) {
  const settings = scoresSettings(state);
  const viewer = state.viewer;
  if (!settings.how || !viewer?.structure) {
    state.colored = null;
    return null;
  }
  const token = (state.coloring = (state.coloring ?? 0) + 1);
  const finish = (colored) => {
    if (token !== state.coloring) return state.colored;
    state.colored = colored;
    viewer.setResidueColors(colored.ok ? colored.colors : new Map(), STATE_COLORS.context);
    if (viewer.colorScheme !== 'scores') viewer.setColor('scores');
    return colored;
  };
  if (!state.mapping) return finish({ ok: false, message: state.mapTarget ? `${state.mapTarget.name} is on no chain of this structure: its positions' scores have no residues to color.` : 'This workspace has no target: the scores are its positions\', placed on the structure by mapping it.' });
  // The structural classes (wave 5, slice 4), read from the structure itself.
  if (settings.how === 'class') return finish(classColoring(state));
  let model;
  let source;
  let run = null;
  let condition = 0;
  if (settings.how === 'disagreement') {
    const pair = currentPair(app);
    if (!pair) return finish({ ok: false, message: 'Nothing is compared: the disagreement is the difference between the two sides chosen in Compare.' });
    const c = await computeComparison(app, pair, currentFilters(app), 'protein', currentScale(app));
    if (c.error) return finish({ ok: false, message: c.error });
    const maps = comparisonMapModels(c);
    if (!maps.difference) return finish({ ok: false, message: c.sameScale ? 'The comparison has no map of its difference: its variants are not protein substitutions on the first side\'s target.' : 'The comparison\'s two sides are not on one scale, so their difference is not drawn: rescale them by their anchors in Compare, Scale.' });
    model = maps.difference.model;
    source = `${c.a.label} − ${c.b.label}, as Compare compares them`;
  } else {
    const from = scoreSource(app);
    if (!from.ok) return finish({ ok: false, pending: Boolean(from.pending), message: from.message });
    ({ model, run, condition } = from);
    source = from.words;
  }
  let values;
  try {
    values = positionValues(model, settings.how, { substitution: settings.substitution, abnormal: settings.how === 'fraction' ? abnormalOf(app, run, settings) : null });
  } catch (error) {
    return finish({ ok: false, message: error.message, run });
  }
  const placed = placeOnTarget(values, state.mapTarget);
  if (!placed) return finish({ ok: false, run, message: `The scores are of ${values.target.name}, not of ${state.mapTarget.name}, the protein mapped on the structure: their residues differ.` });
  const palette = coloringPalette(placed, app.mapView?.palette ?? 'rdbu');
  const code = viewer.structure.meta.code || viewer.structure.label;
  return finish({
    ok: true, values: placed, palette, run, condition, model, source,
    colors: residueColors(placed, state.maps, palette),
    legend: coloringLegend(placed, state.mapping, palette, source),
    words: describeColoring(placed, state.mapping, code, source),
  });
}

// The residues colored by their structural class (lib/structure-evidence.js), on the chain the
// evidence was read for: { ok, classes: true, colors, legend, words } or { ok: false, pending }.
function classColoring(state) {
  const ev = state.evidence;
  if (ev?.status !== 'ready' || !ev.result) return { ok: false, pending: ev?.status === 'computing', message: ev?.status === 'failed' ? ev.message : 'Reading the structural classes…' };
  const colors = new Map();
  const counts = new Map(CLASSES.map((c) => [c.id, 0]));
  for (const p of ev.result.positions) {
    if (!p.residue || !p.class) continue;
    colors.set(p.residue, hexToRgb(displayColor(CLASS_BY_ID.get(p.class).color)).map((v) => v / 255));
    counts.set(p.class, counts.get(p.class) + 1);
  }
  const items = CLASSES.filter((c) => counts.get(c.id)).map((c) => ({ label: c.label, color: displayColor(c.color), count: counts.get(c.id) }));
  items.push({ label: 'not the target', color: STATE_COLORS.context, count: null });
  return {
    ok: true, classes: true, values: null, colors, evidence: ev.result,
    legend: { title: `Structural class, chain ${ev.result.chain}`, gradient: null, items, counts: { onStructure: [...counts.values()].reduce((a, b) => a + b, 0) } },
    words: [`Each residue of the target on chain ${ev.result.chain} is colored by its structural class: ${CLASSES.filter((c) => counts.get(c.id)).map((c) => `${c.label} ${counts.get(c.id)} (${c.words})`).join('; ')}.`],
    source: 'the structure',
  };
}

// A position's value in words, for the tooltip, the strip and the inspector: "median −2.31 from 19
// substitutions" (null when the coloring has nothing to say).
export function positionWords(colored, position) {
  if (colored?.classes) {
    const p = colored.evidence.positions[position - 1];
    return p?.class ? CLASS_BY_ID.get(p.class).label : '';
  }
  if (!colored?.ok) return '';
  const v = colored.values;
  const i = position - 1;
  const s = v.state[i];
  if (s === POSITION.NOT_DESIGNED) return v.from && !v.from[i] ? 'not in the scores' : 'not designed';
  if (s === POSITION.MISSING) return 'missing: none of its substitutions measured';
  if (s === POSITION.FILTERED) return 'filtered: measured, none scored';
  if (s === POSITION.REFERENCE) return `the residue itself (${v.label.toLowerCase()})`;
  if (v.kind === 'qc') return `${QC_CLASSES[v.category[i]].label} (${v.scored[i]} of ${v.designed[i]} scored)`;
  const n = v.how === 'substitution' ? '' : ` from ${formatCount(v.scored[i])} substitution${v.scored[i] === 1 ? '' : 's'}`;
  const value = v.kind === 'count' ? `${v.value[i]} of ${v.designed[i]} scored` : v.kind === 'fraction' ? `${fmt(100 * v.value[i], 0)}% abnormal-like${n}` : `${v.label.toLowerCase()} ${fmt(v.value[i])}${n}`;
  return `${value}${s === POSITION.LOW ? ', low confidence' : ''}`;
}

// --- The legend ------------------------------------------------------------------------------------

export function scoresLegend(colored) {
  if (!colored) return null;
  if (!colored.ok) return h('span.muted', colored.message);
  const { legend } = colored;
  const swatch = (item) => h(`i.score-swatch${item.pattern ? `.${item.pattern}` : ''}`, { style: { background: item.color } });
  return h('div.score-legend',
    h('span.legend-title', legend.title),
    legend.gradient ? h('span.score-scale',
      h('span.score-scale-bar', { style: { background: legend.gradient.stops } }),
      h('span.score-scale-labels', h('span', legend.gradient.low), legend.gradient.center ? h('span', legend.gradient.center) : null, h('span', legend.gradient.high)),
      legend.gradient.meaning ? h('span.score-scale-title', legend.gradient.meaning) : null) : null,
    ...legend.items.map((item) => h('span.legend-item', swatch(item), item.count === null ? item.label : `${item.label} (${formatCount(item.count)})`)));
}

// --- The strip of positions ------------------------------------------------------------------------

const NS = 'http://www.w3.org/2000/svg';

// One row of the strip: a color per position (null: nothing drawn), runs of a color drawn as one.
function stripRow(colors, label) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${Math.max(1, colors.length)} 1`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('class', 'structure-strip-row');
  svg.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < colors.length;) {
    const color = colors[i];
    let j = i + 1;
    while (j < colors.length && colors[j] === color) j += 1;
    if (color) {
      const rect = document.createElementNS(NS, 'rect');
      rect.setAttribute('x', String(i));
      rect.setAttribute('y', '0');
      rect.setAttribute('width', String(j - i + 0.02));
      rect.setAttribute('height', '1');
      rect.setAttribute('style', `fill: ${color}`);
      svg.append(rect);
    }
    i = j;
  }
  return [h('span.structure-strip-label', label), svg];
}

// The strip: { el, update({ length, offset, rows: [{ label, colors }], selected: Set }) }.
// onSelect(positions, additive) on a click (one position) or a drag (a stretch); describe(position)
// → words shown below it as the pointer moves.
export function createPositionStrip({ onSelect, describe }) {
  const grid = h('div.structure-strip-grid');
  const ticks = h('div.structure-strip-ticks', { 'aria-hidden': 'true' });
  const readout = h('div.structure-strip-readout', { role: 'status' });
  const el = h('div.structure-strip', grid, ticks, readout);
  let length = 0;
  let drag = null;
  let band = null;
  const positionAt = (event) => {
    const area = grid.querySelector('svg')?.getBoundingClientRect();
    if (!area || !length) return null;
    return Math.max(1, Math.min(length, Math.floor(((event.clientX - area.left) / Math.max(1, area.width)) * length) + 1));
  };
  const showBand = (a, b) => {
    band?.remove();
    const area = grid.querySelector('svg');
    if (!area) return;
    const [lo, hi] = a < b ? [a, b] : [b, a];
    band = h('span.structure-strip-band', { style: { left: `calc(var(--strip-label) + (100% - var(--strip-label)) * ${(lo - 1) / length})`, width: `calc((100% - var(--strip-label)) * ${(hi - lo + 1) / length})` } });
    grid.append(band);
  };
  grid.addEventListener('pointerdown', (event) => {
    const p = positionAt(event);
    if (!p) return;
    grid.setPointerCapture(event.pointerId);
    drag = { from: p, to: p, additive: event.shiftKey || event.metaKey || event.ctrlKey };
    showBand(p, p);
  });
  grid.addEventListener('pointermove', (event) => {
    const p = positionAt(event);
    if (!p) return;
    readout.textContent = describe(p);
    if (drag && p !== drag.to) {
      drag.to = p;
      showBand(drag.from, p);
    }
  });
  const end = (event) => {
    if (!drag) return;
    const { from, to, additive } = drag;
    drag = null;
    band?.remove();
    band = null;
    if (event.type !== 'pointerup') return;
    const [lo, hi] = from < to ? [from, to] : [to, from];
    onSelect(Array.from({ length: hi - lo + 1 }, (_, k) => lo + k), additive);
  };
  grid.addEventListener('pointerup', end);
  grid.addEventListener('pointercancel', end);
  grid.addEventListener('pointerleave', () => { if (!drag) readout.textContent = ''; });
  return {
    el,
    update({ length: n, offset = 0, rows, selected = new Set() }) {
      length = n;
      clear(grid);
      clear(ticks);
      el.hidden = !n || !rows.length;
      if (el.hidden) return;
      grid.append(...stripRow(Array.from({ length: n }, (_, i) => (selected.has(i + 1) ? 'var(--accent)' : null)), ''));
      grid.lastChild.classList.add('selected');
      for (const row of rows) grid.append(...stripRow(row.colors, row.label));
      const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].find((s) => n / s <= 10) ?? 1000;
      for (let p = step; p <= n; p += step) ticks.append(h('span', { style: { left: `calc(var(--strip-label) + (100% - var(--strip-label)) * ${(p - 0.5) / n})` } }, offset ? `${p} (${p + offset})` : String(p)));
    },
  };
}

// The strip's rows for a coloring on a mapping: the coloring, the positions on the structure (on a
// residue, or in its sequence but not observed), their structural classes (wave 5, slice 4), and a
// predicted model's confidence.
export function stripRows(colored, mapping, model, code, evidence = null) {
  const rows = [];
  const L = mapping.positions.length;
  if (colored?.ok && colored.values) rows.push({ label: colored.values.label.replace(/ \(.*\)$/, ''), colors: Array.from({ length: L }, (_, i) => positionColor(colored.values, i + 1, colored.palette)) });
  rows.push({ label: `On ${code} ${mapping.chain}`, colors: mapping.positions.map((p) => (p.residue ? 'var(--text-2)' : p.state === 'unobserved' ? 'var(--line-strong)' : null)) });
  if (evidence?.chain === mapping.chain && evidence.positions.length === L) rows.push({ label: 'Class', colors: evidence.positions.map((p) => (p.class ? displayColor(CLASS_BY_ID.get(p.class).color) : null)) });
  if (model?.residueMap && mapping.positions.some((p) => p.residue && Number.isFinite(model.residueMap.get(p.residue)?.confidence))) {
    rows.push({ label: 'pLDDT', colors: mapping.positions.map((p) => {
      const c = p.residue ? model.residueMap.get(p.residue)?.confidence : Number.NaN;
      if (!Number.isFinite(c)) return null;
      const band = PLDDT_BANDS.find((b) => c > b.min) ?? PLDDT_BANDS.at(-1);
      return colorToHex(band.color);
    }) });
  }
  return rows;
}

// --- The pane's controls ---------------------------------------------------------------------------

const AMINO_NAMES = [['A', 'Ala'], ['R', 'Arg'], ['N', 'Asn'], ['D', 'Asp'], ['C', 'Cys'], ['Q', 'Gln'], ['E', 'Glu'], ['G', 'Gly'], ['H', 'His'], ['I', 'Ile'], ['L', 'Leu'], ['K', 'Lys'], ['M', 'Met'], ['F', 'Phe'], ['P', 'Pro'], ['S', 'Ser'], ['T', 'Thr'], ['W', 'Trp'], ['Y', 'Tyr'], ['V', 'Val'], ['*', 'Stop']];

// The controls of a coloring's own choices: the substitution; what abnormal-like is.
export function coloringControls(app, settings, run, onChange) {
  const select = (label, value, options, change) => {
    const el = h('select.input.small', { 'aria-label': label, title: label, onchange: () => change(el.value) }, ...options.map(([v, text]) => h('option', { value: v, selected: String(v) === String(value) }, text)));
    return el;
  };
  if (settings.how === 'substitution') {
    return h('div.structure-chain', h('label', 'Substitution to'), select('The substitution each residue is colored by', settings.substitution, AMINO_NAMES.map(([code, name]) => [code, `${name} (${code})`]), (v) => { settings.substitution = v; onChange(); }));
  }
  if (settings.how !== 'fraction') return null;
  const a = settings.abnormal;
  const calibrations = calibrationsFor(app, run);
  if (a.kind === 'calibration' && !calibrations.some((c) => c.index === a.calibration)) a.kind = 'threshold';
  const kinds = [['threshold', 'A threshold set here'], ...calibrations.map(({ index, calibration }) => [`calibration:${index}`, `${calibration.title}${calibration.researchUseOnly ? ' (research use)' : ''}`])];
  const kindSelect = select('What abnormal-like is', a.kind === 'calibration' ? `calibration:${a.calibration}` : 'threshold', kinds, (v) => {
    if (v === 'threshold') a.kind = 'threshold';
    else {
      a.kind = 'calibration';
      a.calibration = Number(v.split(':')[1]);
    }
    onChange();
  });
  const rows = [h('div.structure-chain', h('label', 'Abnormal-like'), kindSelect)];
  if (a.kind === 'threshold') {
    const input = h('input.input.small', { type: 'number', step: 'any', value: Number.isFinite(a.value) ? String(a.value) : '', placeholder: 'score', 'aria-label': 'Threshold', style: { width: '90px' }, onchange: () => { const x = input.value.trim() === '' ? null : Number(input.value); a.value = Number.isFinite(x) ? x : null; onChange(); } });
    rows.push(h('div.structure-chain', h('label', 'Scores'), select('Which side of the threshold is abnormal-like', a.side ?? defaultSide(run), [['below', 'below'], ['above', 'above']], (v) => { a.side = v; onChange(); }), input));
  }
  return h('div', ...rows);
}

// The run and condition (or contrast) the map shows, chosen here as on the map.
export function sourceControls(app, from, onChange) {
  if (!from?.ok) return null;
  const ws = app.store.ws;
  const view = (app.mapView ??= { colorBy: 'score', rowOrder: 'biochemical', palette: 'rdbu', condition: 0, contrast: 0, show: 'all', page: 0 });
  const parts = [];
  if (ws.runs.length > 1) {
    const el = h('select.input.small', { 'aria-label': 'Score run', title: 'Score run (the map shows the same)', onchange: () => { view.run = el.value; app.focusItem({ kind: 'run', id: el.value }); onChange(); } },
      ...ws.runs.slice().reverse().map((r) => h('option', { value: r.id, selected: r.id === from.run.id }, r.name)));
    parts.push(el);
  }
  const conditions = from.results.conditions;
  if (conditions.length > 1 && !from.model.contrast) {
    parts.push(h('div.segmented', ...conditions.map((c, i) => h(`button${i === from.condition ? '.active' : ''}`, { type: 'button', 'aria-pressed': i === from.condition ? 'true' : 'false', onclick: () => { view.condition = i; onChange(); } }, c.name))));
  }
  if (from.model.contrast) parts.push(h('span.muted', `Contrast ${from.model.contrast.name}`));
  return parts.length ? h('div.btn-row.structure-source', ...parts) : null;
}

export { POSITION_NAMES, SCORE_COLORINGS };
