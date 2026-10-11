// The Compare view (wave 4, slices 1–2; requirements C1–C3): two sets of scores of the workspace (a
// run's condition or one of its replicates, of one run or two), the compatibility report that says
// what their comparison can mean, and filters by confidence and depth; then three tabs:
//   - Agreement: a scatter plot of the variants compared with their agreement (Pearson, Spearman,
//     Lin's concordance, Bland–Altman) and the Bland–Altman plot;
//   - Maps: the two sides' maps and the map of their difference, panned and zoomed as one;
//   - Disagreement: the variants that differ beyond their uncertainty, and disagreement by position.
// The pair, its filters and the tab are the session's (app.comparePairs, app.compareFilters,
// app.compareTab), not the workspace's: a comparison is a view of two runs, each kept with its own
// record.

import { h, icon, clear, downloadBlob, formatCount } from './dom.js';
import { compareSides, comparisonCSV, comparisonJSON, describeSide, differenceMap, DISCORDANT_Q, filtersApplied, MIN_POSITION_VARIANTS, NO_FILTERS, positionsCSV, sameSpec, sideMap, sideOptions, specKey } from '../lib/compare.js';
import { categoricalColor } from '../lib/colormaps.js';
import { buildMapModel, STATE, STATE_NAMES } from '../lib/map-model.js';
import { mapSVG } from '../lib/map-svg.js';
import { KIND } from '../lib/variants.js';
import { cssVar, legend, ticks } from './plots.js';
import { ensureResults, runEntry } from './run-results.js';
import { mountVariantMap } from './variant-map.js';

const fmt = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : '—');
const interval = (est, low, high, d = 3) => `${fmt(est, d)} (${fmt(low, d)} to ${fmt(high, d)})`;
const qText = (q) => (!Number.isFinite(q) ? '—' : q < 0.001 ? q.toExponential(1) : q.toFixed(3));

// The classes the plot colors, as the Score view's histograms color them.
const CLASSES = [['Synonymous', (k) => k === KIND.SYNONYMOUS, 0], ['Nonsense', (k) => k === KIND.NONSENSE, 1], ['Missense', (k) => k === KIND.MISSENSE, 2], ['Other', () => true, 3]];
const classOf = (kind) => CLASSES.findIndex(([, test]) => test(kind));
const TABS = [['agreement', 'Agreement'], ['maps', 'Maps'], ['disagreement', 'Disagreement']];

// The pair to show first: a run scored from a MaveDB record's counts against its published scores;
// else the latest run's first two replicates; else its first two conditions; else the last two
// runs. null when the workspace has nothing to compare.
export function defaultPair(ws) {
  const runs = ws.runs;
  if (!runs.length) return null;
  const published = runs.filter((r) => r.inputs.parameters?.model === 'published');
  const scored = runs.filter((r) => r.inputs.parameters?.model !== 'published');
  if (published.length && scored.length) return { a: { run: scored.at(-1).id, condition: 0 }, b: { run: published[0].id, condition: 0 } };
  const last = runs.at(-1);
  if (last.output.replicates.length >= 2) return { a: { run: last.id, replicate: last.output.replicates[0].id }, b: { run: last.id, replicate: last.output.replicates[1].id } };
  if (last.output.conditions.length >= 2) return { a: { run: last.id, condition: 1 }, b: { run: last.id, condition: 0 } };
  if (runs.length >= 2) return { a: { run: runs.at(-1).id, condition: 0 }, b: { run: runs.at(-2).id, condition: 0 } };
  return null;
}

// The pair shown for the open workspace (kept while its runs exist), or the default.
export function currentPair(app) {
  const ws = app.store.ws;
  app.comparePairs ??= new Map();
  const kept = app.comparePairs.get(ws.id);
  const exists = (spec) => {
    const run = ws.runs.find((r) => r.id === spec?.run);
    return run && sideOptions(run).some((o) => sameSpec(o.spec, spec));
  };
  if (kept && exists(kept.a) && exists(kept.b)) return kept;
  const pair = defaultPair(ws);
  if (pair) app.comparePairs.set(ws.id, pair);
  return pair;
}

export function setPair(app, pair) {
  app.comparePairs ??= new Map();
  app.comparePairs.set(app.store.ws.id, pair);
  app.store.notify(['compare']);
}

// The filters of the open workspace's comparison (none at first).
export function currentFilters(app) {
  app.compareFilters ??= new Map();
  return app.compareFilters.get(app.store.ws.id) ?? { ...NO_FILTERS };
}

export function setFilters(app, filters) {
  app.compareFilters ??= new Map();
  app.compareFilters.set(app.store.ws.id, { ...NO_FILTERS, ...filters });
  app.store.notify(['compare']);
}

// The comparison of a pair with filters, its runs' scores recomputed first when they are not yet:
// the result of compareSides (with its two sides, `sides`), or { error }. level 'protein': matched at
// the protein level (the maps').
const memo = new WeakMap();
export async function computeComparison(app, pair, filters = currentFilters(app), level = null) {
  const ws = app.store.ws;
  const runs = [pair.a, pair.b].map((s) => ws.runs.find((r) => r.id === s.run));
  if (runs.some((r) => !r)) return { error: 'A run of the pair is no longer in the workspace.' };
  const entries = await Promise.all(runs.map((r) => ensureResults(app, r)));
  const failed = entries.findIndex((e) => !e?.results);
  if (failed >= 0) return { error: `${runs[failed].name}'s scores could not be recomputed: ${entries[failed]?.message ?? 'unknown'}` };
  return comparisonOf(ws, runs, entries.map((e) => e.results), pair, filters, level);
}

function comparisonOf(ws, runs, results, pair, filters, level = null) {
  const key = `${specKey(pair.a)}||${specKey(pair.b)}||${JSON.stringify(filters)}||${level ?? ''}`;
  if (!memo.has(results[0])) memo.set(results[0], new Map());
  const cache = memo.get(results[0]);
  const hit = cache.get(key);
  if (hit && hit.other === results[1]) return hit.value;
  let value;
  try {
    const sides = [describeSide(ws, runs[0], results[0], pair.a), describeSide(ws, runs[1], results[1], pair.b)];
    value = compareSides(sides[0], sides[1], { filters, ...(level ? { level } : {}) });
    value.sides = sides;
  } catch (error) {
    value = { error: error.message };
  }
  cache.set(key, { other: results[1], value });
  return value;
}

// The map models of a comparison at the protein level: { first, second, difference } (each
// { model, results } or null), with each side's target offset.
export function comparisonMapModels(c) {
  const [sa, sb] = c.sides;
  const made = (spec, colorBy = 'score') => {
    if (!spec) return null;
    try {
      return { model: buildMapModel(spec.results, spec.design, { condition: spec.condition, contrast: spec.contrast, colorBy }), results: spec.results };
    } catch {
      return null;
    }
  };
  return {
    first: made(sideMap(sa)),
    second: made(sideMap(sb)),
    difference: made(differenceMap(c, sa), 'differential'),
    offsets: [sa.target?.offset ?? 0, sb.target?.offset ?? 0],
  };
}

// A map of a comparison at the protein level as SVG: which 'first', 'second' or 'difference'; null
// when there is none.
export function comparisonMapSVG(app, c, which = 'difference') {
  const m = comparisonMapModels(c)[which];
  return m ? mapSVG(m.model, { palette: app.mapView?.palette ?? 'rdbu', results: m.results }) : null;
}

// The comparison's files: { csv, json, positions } named after the two sides.
export function comparisonFiles(app, c) {
  const base = `${c.a.label}_vs_${c.b.label}`.replace(/[^\w.-]+/g, '_').replace(/_+/g, '_');
  return {
    csv: { name: `${base}_comparison.csv`, text: comparisonCSV(c) },
    json: { name: `${base}_comparison.json`, text: comparisonJSON(c, { name: 'MaveScape', version: app.version, commit: app.commit || null }) },
    positions: { name: `${base}_comparison_positions.csv`, text: positionsCSV(c) },
    base,
  };
}

// A scatter of x against y on a canvas, colored by class, with lines. pick(k): the k-th point
// clicked. lines: [{ y, dash }].
function plotPairs({ x, y, kinds, xLabel, yLabel, label, lines = [], diagonal = false, pick, width = 560, height = 320, name, focus = -1 }) {
  const wrap = h('div.plot-canvas.compare-plot', { role: 'img', 'aria-label': label });
  const canvas = h('canvas', { width: width * 2, height: height * 2, style: { width: '100%', height: 'auto', cursor: pick ? 'crosshair' : 'default' } });
  const hover = h('div.muted.compare-hover', { style: { fontSize: '11px', minHeight: '15px' } });
  wrap.append(canvas, hover);
  const ctx = canvas.getContext('2d');
  const n = x.length;
  if (!ctx || !n) return wrap;
  ctx.scale(2, 2);
  const pad = { l: 52, r: 12, t: 8, b: 34 };
  let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity];
  for (let k = 0; k < n; k += 1) {
    x0 = Math.min(x0, x[k]); x1 = Math.max(x1, x[k]);
    y0 = Math.min(y0, y[k]); y1 = Math.max(y1, y[k]);
  }
  for (const l of lines) if (Number.isFinite(l.y)) { y0 = Math.min(y0, l.y); y1 = Math.max(y1, l.y); }
  if (diagonal) {
    x0 = y0 = Math.min(x0, y0);
    x1 = y1 = Math.max(x1, y1);
  }
  const mx = (x1 - x0) * 0.04 || 1;
  const my = (y1 - y0) * 0.04 || 1;
  x0 -= mx; x1 += mx; y0 -= my; y1 += my;
  const sx = (v) => pad.l + ((v - x0) / (x1 - x0)) * (width - pad.l - pad.r);
  const sy = (v) => height - pad.b - ((v - y0) / (y1 - y0)) * (height - pad.t - pad.b);
  ctx.font = '10px system-ui, sans-serif';
  ctx.strokeStyle = cssVar('--line-strong');
  ctx.fillStyle = cssVar('--text-3');
  ctx.beginPath();
  ctx.moveTo(pad.l, pad.t);
  ctx.lineTo(pad.l, height - pad.b);
  ctx.lineTo(width - pad.r, height - pad.b);
  ctx.stroke();
  const text = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : Number(v.toPrecision(3)).toString());
  ctx.textAlign = 'center';
  for (const v of ticks(x0, x1)) ctx.fillText(text(v), sx(v), height - pad.b + 13);
  ctx.textAlign = 'right';
  for (const v of ticks(y0, y1, 4)) ctx.fillText(text(v), pad.l - 4, sy(v) + 3);
  ctx.textAlign = 'center';
  ctx.fillText(xLabel, (pad.l + width - pad.r) / 2, height - 3);
  ctx.save();
  ctx.translate(10, (pad.t + height - pad.b) / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(yLabel, 0, 0);
  ctx.restore();
  const dashed = (fx0, fy0, fx1, fy1, dash) => {
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(fx0, fy0);
    ctx.lineTo(fx1, fy1);
    ctx.stroke();
    ctx.setLineDash([]);
  };
  if (diagonal) dashed(sx(x0), sy(y0), sx(x1), sy(y1), [4, 3]);
  for (const l of lines) dashed(sx(x0), sy(l.y), sx(x1), sy(l.y), l.dash ?? []);
  ctx.globalAlpha = n > 1500 ? 0.4 : 0.65;
  const px = new Float32Array(n);
  const py = new Float32Array(n);
  // Missense first, the controls drawn over them.
  const order = Array.from({ length: n }, (_, k) => k).sort((a, b) => classOf(kinds[b]) - classOf(kinds[a]));
  for (const k of order) {
    px[k] = sx(x[k]);
    py[k] = sy(y[k]);
    ctx.fillStyle = categoricalColor(CLASSES[classOf(kinds[k])][2]);
    ctx.fillRect(px[k] - 1.5, py[k] - 1.5, 3, 3);
  }
  ctx.globalAlpha = 1;
  // The variant in the inspector, ringed.
  if (focus >= 0) {
    ctx.strokeStyle = cssVar('--text');
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(px[focus], py[focus], 5, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.lineWidth = 1;
  }
  const nearest = (event) => {
    const rect = canvas.getBoundingClientRect();
    const cx = ((event.clientX - rect.left) / rect.width) * width;
    const cy = ((event.clientY - rect.top) / rect.height) * height;
    let best = -1;
    let bestD = 36;
    for (let k = 0; k < n; k += 1) {
      const d = (px[k] - cx) ** 2 + (py[k] - cy) ** 2;
      if (d < bestD) { bestD = d; best = k; }
    }
    return best;
  };
  canvas.addEventListener('mousemove', (event) => {
    const k = nearest(event);
    hover.textContent = k >= 0 ? `${name(k)}: ${fmt(x[k])}, ${fmt(y[k])}` : '';
  });
  canvas.addEventListener('mouseleave', () => { hover.textContent = ''; });
  if (pick) canvas.addEventListener('click', (event) => {
    const k = nearest(event);
    if (k >= 0) pick(k);
  });
  return wrap;
}

// Disagreement by position as bars: each position's mean difference (first − second), darker where
// its q is below DISCORDANT_Q. pick(position entry) on a click.
function positionBars({ list, length, label, pick }) {
  const W = 560;
  const H = 150;
  const pad = { l: 40, r: 8, t: 8, b: 24 };
  const NS = 'http://www.w3.org/2000/svg';
  const el = document.createElementNS(NS, 'svg');
  el.setAttribute('viewBox', `0 0 ${W} ${H}`);
  el.setAttribute('class', 'plot compare-positions');
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', label);
  const add = (name, attrs, text = null) => {
    const node = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (text !== null) node.textContent = text;
    el.append(node);
    return node;
  };
  const span = Math.max(1e-9, ...list.map((x) => Math.abs(x.mean)));
  const sx = (p) => pad.l + ((p - 0.5) / length) * (W - pad.l - pad.r);
  const sy = (v) => pad.t + ((span - v) / (2 * span)) * (H - pad.t - pad.b);
  const bw = Math.max(1, (W - pad.l - pad.r) / length - 0.5);
  add('line', { x1: pad.l, x2: W - pad.r, y1: sy(0), y2: sy(0), stroke: cssVar('--line-strong') });
  for (const v of [-span, 0, span]) add('text', { x: pad.l - 4, y: sy(v) + 3, 'text-anchor': 'end', class: 'tick' }, Number(v.toPrecision(2)).toString());
  for (const t of ticks(1, length)) if (t >= 1) add('text', { x: sx(t), y: H - 8, 'text-anchor': 'middle', class: 'tick' }, String(Math.round(t)));
  for (const x of list) {
    const strong = x.q < DISCORDANT_Q;
    const rect = add('rect', { x: sx(x.position) - bw / 2, y: Math.min(sy(0), sy(x.mean)), width: bw, height: Math.max(0.5, Math.abs(sy(x.mean) - sy(0))), fill: strong ? cssVar('--danger') : cssVar('--text-3'), opacity: strong ? 0.9 : 0.45, ...(pick ? { style: 'cursor:pointer' } : {}) });
    const title = document.createElementNS(NS, 'title');
    title.textContent = `${x.residue}${x.position}${x.reference !== x.position ? ` (reference ${x.reference})` : ''}: ${x.n} variants, mean difference ${fmt(x.mean)}${Number.isFinite(x.q) ? `, q ${qText(x.q)}` : ''}${x.discordant ? `, ${x.discordant} discordant` : ''}`;
    rect.append(title);
    if (pick) rect.addEventListener('click', () => pick(x));
  }
  return el;
}

export function mountCompareMode(app, container) {
  const { store } = app;
  const root = h('div.view');
  container.append(root);
  let token = 0;
  // The maps, kept while the comparison they show is the same (so that their zoom stays).
  let maps = null;
  const palette = () => app.mapView?.palette ?? 'rdbu';

  function sideSelect(which, pair, options) {
    const value = specKey(pair[which]);
    const groups = new Map();
    for (const o of options) {
      const run = store.ws.runs.find((r) => r.id === o.spec.run);
      if (!groups.has(run.id)) groups.set(run.id, { run, options: [] });
      groups.get(run.id).options.push(o);
    }
    const select = h('select.input', { 'aria-label': which === 'a' ? 'First side' : 'Second side', onchange: (e) => {
      const chosen = options.find((o) => specKey(o.spec) === e.target.value);
      if (chosen) setPair(app, { ...pair, [which]: chosen.spec });
    } }, ...[...groups.values()].map((g) => h('optgroup', { label: g.run.name }, ...g.options.map((o) => h('option', { value: specKey(o.spec), selected: specKey(o.spec) === value }, o.label)))));
    return h('label.field', h('span', which === 'a' ? 'First (horizontal)' : 'Second (vertical)'), select);
  }

  function filtersPane() {
    const f = currentFilters(app);
    const number = (label, key, attrs) => {
      const el = h('input.input', { type: 'number', value: f[key] ?? '', 'aria-label': label, ...attrs, onchange: () => setFilters(app, { ...currentFilters(app), [key]: el.value.trim() === '' ? null : Number(el.value) }) });
      return h('label.field', h('span', label), el);
    };
    return h('div.pane', h('h3', icon('settings'), 'Filters'),
      h('label.check', h('input', { type: 'checkbox', checked: Boolean(f.lowConfidence), onchange: (e) => setFilters(app, { ...currentFilters(app), lowConfidence: e.target.checked }) }), h('span', 'Leave out low confidence (on either side)')),
      number('Maximum SE (on either side)', 'maxSE', { min: 0, step: 0.05, placeholder: 'none' }),
      number('Minimum input reads (on either side)', 'minReads', { min: 0, step: 1, placeholder: 'none' }),
      filtersApplied(f) ? h('div.btn-row', h('button.btn.small', { type: 'button', onclick: () => setFilters(app, { ...NO_FILTERS }) }, 'Clear the filters')) : null);
  }

  function reportPane(c) {
    const badge = (s) => h(`span.badge${s === 'ok' ? '.ok' : s === 'qualified' ? '.warn' : '.danger'}`, s === 'ok' ? 'ok' : s === 'qualified' ? 'qualified' : 'blocked');
    const overall = c.report.status === 'ok' ? h('div.callout', icon('check'), h('span', 'The two can be compared as they are.'))
      : c.report.status === 'qualified' ? h('div.callout.warn', icon('warning'), h('span', 'The statistics hold, read as the items marked qualified say.'))
        : h('div.callout.danger', icon('warning'), h('span', 'These two cannot be compared: see why below.'));
    return h('div.pane', h('h3', icon('qc'), 'Compatibility'), overall,
      h('ul.compare-report', ...c.report.items.map((item) => h('li', h('div.compare-report-head', h('b', item.label), badge(item.status)), h('div', item.text)))));
  }

  function statisticsTable(c) {
    const s = c.statistics;
    const withheld = 'withheld: not on one scale (see Scale)';
    const rows = [
      ['Variants compared', formatCount(s.n)],
      ['Pearson\'s r', interval(s.pearson.r, s.pearson.low, s.pearson.high)],
      ['Spearman\'s ρ', interval(s.spearman.rho, s.spearman.low, s.spearman.high)],
      ['Lin\'s concordance ρc', s.concordance ? interval(s.concordance.ccc, s.concordance.low, s.concordance.high) : withheld],
    ];
    if (s.concordance) rows.push(['… its accuracy C_b', `${fmt(s.concordance.accuracy)} (scale ${fmt(s.concordance.scaleShift, 2)}, location ${fmt(s.concordance.locationShift, 2)})`]);
    if (s.blandAltman) {
      const ba = s.blandAltman;
      rows.push(['Bias (first − second)', interval(ba.bias, ba.biasLow, ba.biasHigh)]);
      rows.push(['Limits of agreement', `${interval(ba.lower, ba.lowerLow, ba.lowerHigh)} to ${interval(ba.upper, ba.upperLow, ba.upperHigh)}`]);
      rows.push(['Trend of the difference with the mean', `slope ${interval(ba.trend.slope, ba.trend.low, ba.trend.high)}, p ${ba.trend.p < 0.001 ? ba.trend.p.toExponential(1) : fmt(ba.trend.p)}`]);
    } else rows.push(['Bland–Altman', withheld]);
    return h('table.data.compact.compare-stats', h('tbody', ...rows.map(([k, v]) => h('tr', h('th', k), h('td', v)))));
  }

  // The variant in the inspector, as the k-th compared (−1 when it is not).
  const focusIndex = (c) => {
    const f = store.ui.focus;
    if (f?.kind !== 'variant') return -1;
    if (f.run === c.a.run.id) return c.rows.findIndex(([i]) => c.values.a.keys[i] === f.id);
    if (f.run === c.b.run.id) return c.rows.findIndex(([, j]) => c.values.b.keys[j] === f.id);
    return -1;
  };
  const pickA = (c, i) => app.focusItem({ kind: 'variant', id: c.values.a.keys[i], run: c.a.run.id, condition: c.a.condition });
  const pickB = (c, j) => app.focusItem({ kind: 'variant', id: c.values.b.keys[j], run: c.b.run.id, condition: c.b.condition });

  function agreementPane(c) {
    const { a: va } = c.values;
    const kinds = Uint8Array.from(c.rows, ([i]) => va.kind[i]);
    const name = (k) => c.keys[k];
    const pick = (k) => pickA(c, c.rows[k][0]);
    const focus = focusIndex(c);
    const yLabel = c.flipped ? `${c.b.label} (negated)` : c.b.label;
    const ba = c.statistics.blandAltman;
    const files = comparisonFiles(app, c);
    const used = CLASSES.filter((_, idx) => kinds.some((k) => classOf(k) === idx));
    return h('div',
      plotPairs({ x: c.x, y: c.y, kinds, xLabel: c.a.label, yLabel, label: `${c.b.label} against ${c.a.label}: one point per variant compared${c.sameScale ? ', with the line y = x' : ''}`, diagonal: c.sameScale, pick, name, focus }),
      legend(used.map(([label, , color]) => ({ label, color: categoricalColor(color) }))),
      h('p.muted', { style: { fontSize: '11.5px', margin: '4px 0 8px' } }, `Click a point to see the variant in the inspector (as ${c.a.label} scored it).${c.sameScale ? ' The dashed line is y = x: on it, the two agree.' : ''}`),
      statisticsTable(c),
      ba ? h('div', { style: { marginTop: '12px' } },
        h('h4', 'Bland–Altman'),
        plotPairs({ x: Float64Array.from(c.x, (v, k) => (v + c.y[k]) / 2), y: Float64Array.from(c.x, (v, k) => v - c.y[k]), kinds, xLabel: 'mean of the two', yLabel: 'first − second', label: 'Each variant\'s difference against its mean, with the bias and the limits of agreement', lines: [{ y: ba.bias }, { y: ba.lower, dash: [4, 3] }, { y: ba.upper, dash: [4, 3] }], pick, name, height: 240, focus }),
        h('p.muted', { style: { fontSize: '11.5px', margin: '4px 0 0' } }, `The solid line is the bias (${fmt(ba.bias)}); between the dashed lines (${fmt(ba.lower)} to ${fmt(ba.upper)}) lie 95% of the differences, if they are normal.`)) : null,
      h('div.btn-row', { style: { marginTop: '12px' } },
        h('button.btn', { type: 'button', onclick: () => downloadBlob(new Blob([files.csv.text], { type: 'text/csv' }), files.csv.name) }, icon('download'), 'Variants compared (CSV)'),
        h('button.btn', { type: 'button', onclick: () => downloadBlob(new Blob([files.json.text], { type: 'application/json' }), files.json.name) }, icon('download'), 'Report and statistics (JSON)')));
  }

  // --- Maps ------------------------------------------------------------------------------------------

  function mapLegend(model, colors, title) {
    const d = model.domain;
    const stops = Array.from({ length: 13 }, (_, i) => `${colors.color(i / 12)} ${((100 * i) / 12).toFixed(1)}%`).join(', ');
    return h('div.map-scale.compare-map-scale', h('span.map-scale-bar', { style: { background: `linear-gradient(90deg, ${stops})` } }),
      h('span.map-scale-labels', h('span', fmt(d.min, 2)), h('span', model.contrast ? '0 no difference' : `${fmt(d.center, 2)} wild type`), h('span', fmt(d.max, 2))),
      h('span.map-scale-title', title));
  }

  // The three maps of a comparison at the protein level (cm), kept while it is the same.
  function mapsPane(cm) {
    const key = `${cm.a.run.sha256}|${cm.b.run.sha256}|${specKey(cm.sides[0].spec)}|${specKey(cm.sides[1].spec)}|${JSON.stringify(cm.filters)}|${palette()}`;
    if (!maps || maps.key !== key) {
      destroyMaps();
      const models = comparisonMapModels(cm);
      const matched = cm.matchedAll ?? cm.rows;
      const pairOfA = new Map(matched.map(([i, j]) => [i, j]));
      const pairOfB = new Map(matched.map(([i, j]) => [j, i]));
      const kOf = new Map(cm.rows.map(([i], k) => [i, k]));
      const entries = [];
      // Each map tells the others its view, on the reference's coordinates (its position + its
      // target's offset), so that maps of two stretches of one protein line up.
      const sync = (from, v) => {
        const reference = v.x0 + from.offset;
        for (const e of entries) if (e !== from) e.map.setView({ x0: reference - e.offset, cellW: v.cellW });
      };
      const describe = (which, m) => (cell) => {
        const i = m.model.cells[cell.k];
        const where = `position ${cell.position}${m.model.target.offset ? ` (reference ${cell.position + m.model.target.offset})` : ''}`;
        if (i < 0 || cell.state === STATE.MISSING || cell.state === STATE.NOT_DESIGNED) return `${where}: ${STATE_NAMES[cell.state]}`;
        const name = m.results.variants.key[i];
        if (which === 'difference') {
          const k = kOf.get(i);
          if (k === undefined) return `${name}: no difference (${pairOfA.has(i) ? 'left out by the filters, or scored on one side only' : `not among ${cm.b.label}'s variants`})`;
          const d = cm.discordance;
          return `${name}: ${fmt(cm.x[k])} − ${fmt(cm.y[k])} = ${fmt(cm.x[k] - cm.y[k])}${d?.valid ? ` (z ${fmt(d.z[k], 2)}, q ${qText(d.q[k])})` : ''}`;
        }
        const c = m.model.source;
        return cell.state === STATE.FILTERED ? `${name}: filtered` : `${name}: ${fmt(c.score[i])} ± ${fmt(c.se[i])}${cell.state === STATE.LOW ? ' (low confidence)' : ''}`;
      };
      const specs = [
        ['first', cm.a.label, models.offsets[0], (i) => pickA(cm, i)],
        ['second', cm.b.label, models.offsets[1], (j) => pickB(cm, j)],
        ['difference', `${cm.a.label} − ${cm.b.label}`, models.offsets[0], (i) => pickA(cm, i)],
      ];
      for (const [which, label, offset, pick] of specs) {
        const m = models[which];
        if (!m) continue;
        const entry = { which, label, offset, m };
        entry.map = mountVariantMap({
          model: m.model, palette: palette(), selected: [], cellH: 10,
          describe: describe(which, m),
          onSelect: (cells, primary) => {
            const i = primary ? m.model.cells[primary.k] : -1;
            if (i >= 0) pick(i);
          },
          onView: (v) => sync(entry, v),
        });
        entries.push(entry);
      }
      maps = { key, entries, models, pairOfA, pairOfB, cm };
    }
    selectFocused();
    const [blue, red] = palette() === 'puor' ? ['purple', 'orange'] : ['blue', 'red'];
    const blocks = maps.entries.map((e) => {
      const colors = e.map.colors();
      const title = e.which === 'difference' ? `${e.label}: ${blue} where the first is lower, ${red} where higher` : `${e.label}, on its own scale: ${blue} lower, ${red} higher than its wild type`;
      const heading = e.which === 'first' ? `First: ${e.label}` : e.which === 'second' ? `Second: ${e.label}` : `Difference: ${e.label}`;
      return h('div.compare-map', h('h4', heading), colors ? mapLegend(e.m.model, colors, title) : null, e.map.el);
    });
    const files = comparisonFiles(app, cm);
    const svgOf = (which) => mapSVG(maps.models[which].model, { palette: palette(), results: maps.models[which].results });
    const noMap = ['first', 'second'].filter((w) => !maps.models[w]).map((w) => (w === 'first' ? cm.a.label : cm.b.label));
    return h('div',
      h('p.muted', { style: { fontSize: '11.5px', margin: '0 0 8px' } }, 'The maps pan and zoom together (drag, or ⌘ or Ctrl and the wheel). Click a cell to see the variant in the inspector; it is selected in each map. In the difference, hatched cells were scored on one side only, or left out by the filters.'),
      ...blocks,
      !maps.models.difference && maps.models.first ? h('div.callout', icon('info'), h('span', cm.sameScale ? 'No difference map.' : 'No difference map: the two are not on one scale (see Scale), so their difference has no meaning.')) : null,
      noMap.length ? h('div.callout', icon('info'), h('span', `${noMap.join(' and ')}: no map (nucleotide variants with no protein change to draw).`)) : null,
      h('div.btn-row', { style: { marginTop: '12px' } },
        ...['first', 'second', 'difference'].filter((w) => maps.models[w]).map((w) => h('button.btn', { type: 'button', onclick: () => downloadBlob(new Blob([svgOf(w)], { type: 'image/svg+xml' }), `${files.base}_${w}_map.svg`) }, icon('download'), `${w === 'first' ? 'First' : w === 'second' ? 'Second' : 'Difference'} map (SVG)`))));
  }

  // The variant in the inspector, selected in each map (its pair in the other side's).
  function selectFocused() {
    if (!maps) return;
    const { cm } = maps;
    const f = store.ui.focus;
    let rowA = -1;
    let rowB = -1;
    if (f?.kind === 'variant' && f.run === cm.a.run.id) {
      rowA = cm.values.a.keys.indexOf(f.id);
      rowB = maps.pairOfA.get(rowA) ?? -1;
    } else if (f?.kind === 'variant' && f.run === cm.b.run.id) {
      rowB = cm.values.b.keys.indexOf(f.id);
      rowA = maps.pairOfB.get(rowB) ?? -1;
    }
    for (const e of maps.entries) {
      const row = e.which === 'second' ? rowB : rowA;
      const k = row < 0 ? -1 : e.m.model.cells.indexOf(row);
      e.map.setSelection(k >= 0 ? [k] : []);
    }
  }

  function destroyMaps() {
    for (const e of maps?.entries ?? []) e.map.destroy();
    maps = null;
  }

  // --- Disagreement ----------------------------------------------------------------------------------

  function disagreementPane(c) {
    const d = c.discordance;
    const files = comparisonFiles(app, c);
    const out = [];
    if (!d?.valid) {
      out.push(h('div.callout', icon('info'), h('span', `Discordant variants are not tested: ${d?.reason ?? 'see the report'}`)));
    } else {
      const order = c.rows.map((_, k) => k).filter((k) => d.q[k] < DISCORDANT_Q).sort((x, y) => d.q[x] - d.q[y] || Math.abs(d.z[y]) - Math.abs(d.z[x]));
      const lower = order.filter((k) => c.x[k] < c.y[k]).length;
      out.push(h('p', { style: { margin: '0 0 6px' } }, `${formatCount(order.length)} of ${formatCount(d.tested)} variants differ beyond their uncertainty (q < ${DISCORDANT_Q}, Benjamini–Hochberg; each difference's z from both SEs): ${formatCount(lower)} lower in ${c.a.label}, ${formatCount(order.length - lower)} higher.`));
      if (d.dispersion > 1.5) out.push(h('div.callout.warn', icon('warning'), h('span', `The differences are ${fmt(d.dispersion, 1)} times as variable as the SEs say (the median z² over its expected value). Either the SEs are too small (QC's variance beyond counting: a bottleneck), or the two differ nearly everywhere; either way, more variants test as discordant than truly differ.`)));
      else out.push(h('p.muted', { style: { fontSize: '11.5px', margin: '0 0 6px' } }, `The differences are ${fmt(d.dispersion, 2)} times as variable as the SEs say: about what they predict.`));
      if (order.length) {
        out.push(h('div', { style: { maxHeight: '260px', overflow: 'auto' } }, h('table.data.compact', h('thead', h('tr', h('th', 'Variant'), h('th.r', 'First'), h('th.r', 'Second'), h('th.r', 'Difference'), h('th.r', 'z'), h('th.r', 'q'))),
          h('tbody', ...order.slice(0, 100).map((k) => h('tr', { style: { cursor: 'pointer' }, onclick: () => pickA(c, c.rows[k][0]) },
            h('td.mono', c.keys[k]), h('td.r', fmt(c.x[k])), h('td.r', fmt(c.y[k])), h('td.r', fmt(c.x[k] - c.y[k])), h('td.r', fmt(d.z[k], 2)), h('td.r', qText(d.q[k]))))))));
        if (order.length > 100) out.push(h('p.muted', { style: { fontSize: '11.5px' } }, `The 100 of smallest q shown; all ${formatCount(order.length)} are in the variants exported (their q) and the report (JSON).`));
      }
    }
    const pos = c.positions;
    out.push(h('h4', { style: { marginTop: '14px' } }, 'By position'));
    if (!pos?.valid) {
      out.push(h('p.muted', { style: { margin: 0 } }, `Not shown: ${pos?.reason ?? 'see the report'}`));
    } else {
      const target = c.sides[0].target;
      const length = Math.max(...pos.list.map((x) => x.position), target ? Math.floor(target.sequence.length / (target.sequenceType === 'dna' ? 3 : 1)) : 1);
      const strong = pos.list.filter((x) => x.q < DISCORDANT_Q);
      const where = (i) => (c.level === 'protein' ? c.values.a.position[i] : c.values.a.proPosition?.[i]);
      out.push(positionBars({
        list: pos.list, length,
        label: `The mean difference (first − second) of the variants compared at each position${d?.valid ? `; darker where it differs beyond its uncertainty (q < ${DISCORDANT_Q})` : ''}`,
        pick: (x) => {
          const k = c.rows.findIndex(([i]) => where(i) === x.position);
          if (k >= 0) pickA(c, c.rows[k][0]);
        },
      }));
      const top = (d?.valid ? pos.list.filter((x) => Number.isFinite(x.q)) : [...pos.list]).sort((x, y) => (d?.valid ? x.q - y.q || Math.abs(y.z) - Math.abs(x.z) : Math.abs(y.mean) - Math.abs(x.mean))).slice(0, 10);
      out.push(h('p.muted', { style: { fontSize: '11.5px', margin: '4px 0 6px' } }, d?.valid ? `${formatCount(strong.length)} of ${formatCount(pos.list.filter((x) => Number.isFinite(x.q)).length)} positions with ${MIN_POSITION_VARIANTS} or more variants compared differ beyond their uncertainty (a position's z: the sum of its differences over their combined SE). The ten that differ most:` : 'The ten positions whose mean difference is largest:'));
      out.push(h('table.data.compact', h('thead', h('tr', h('th', 'Position'), h('th.r', 'Variants'), h('th.r', 'Mean difference'), h('th.r', 'Discordant'), h('th.r', 'q'))),
        h('tbody', ...top.map((x) => h('tr', h('td', `${x.residue}${x.position}${x.reference !== x.position ? ` (${x.reference})` : ''}`), h('td.r', x.n), h('td.r', fmt(x.mean)), h('td.r', d?.valid ? x.discordant : '—'), h('td.r', qText(x.q)))))));
    }
    out.push(h('div.btn-row', { style: { marginTop: '12px' } },
      h('button.btn', { type: 'button', onclick: () => downloadBlob(new Blob([files.csv.text], { type: 'text/csv' }), files.csv.name) }, icon('download'), 'Variants compared, with z and q (CSV)'),
      pos?.valid ? h('button.btn', { type: 'button', onclick: () => downloadBlob(new Blob([files.positions.text], { type: 'text/csv' }), files.positions.name) }, icon('download'), 'Positions (CSV)') : null));
    return h('div', ...out);
  }

  function empty(message) {
    root.append(h('div.view-body', h('div.planned', h('div.empty', icon('compare'), h('h3', 'Compare'), h('p', message),
      h('div.btn-row', { style: { marginTop: '12px' } }, h('button.btn.primary', { type: 'button', onclick: () => app.setMode('score') }, icon('score'), 'Open Score'))))));
  }

  function render() {
    clear(root);
    const ws = store.ws;
    const pair = currentPair(app);
    const label = (spec) => {
      const run = ws.runs.find((r) => r.id === spec.run);
      return sideOptions(run).find((o) => sameSpec(o.spec, spec))?.label ?? run.name;
    };
    root.append(h('div.workbench-head', h('h1', icon('compare'), 'Compare', pair ? h('span.crumbs', ` · ${label(pair.a)} and ${label(pair.b)}`) : null), h('span.spacer')));
    if (!pair) {
      destroyMaps();
      empty('Two sets of scores side by side: two replicates, two conditions, or two runs (a rescoring, or a MaveDB record\'s published scores against its counts scored again), with what their comparison can mean and how well they agree. Score a run with replicates first.');
      return;
    }
    const options = ws.runs.flatMap((r) => sideOptions(r));
    const swap = h('button.btn', { type: 'button', title: 'Swap the two sides', onclick: () => setPair(app, { a: pair.b, b: pair.a }) }, icon('swap'), 'Swap');
    const sides = h('div.pane', h('h3', icon('compare'), 'Sides'), sideSelect('a', pair, options), sideSelect('b', pair, options), h('div.btn-row', swap));
    const left = h('div', sides, filtersPane());
    const right = h('div');
    root.append(h('div.view-body', h('div.split.compare-split', left, right)));
    const runs = [pair.a, pair.b].map((s) => ws.runs.find((r) => r.id === s.run));
    const entries = runs.map((r) => runEntry(app, r));
    if (entries.every((e) => e?.results)) {
      const results = entries.map((e) => e.results);
      const filters = currentFilters(app);
      const c = comparisonOf(ws, runs, results, pair, filters);
      show(c, left, right, () => (c.level === 'protein' ? c : comparisonOf(ws, runs, results, pair, filters, 'protein')));
      return;
    }
    right.append(h('div.pane', h('p.muted', { style: { margin: 0 } }, `Recomputing the scores of ${[...new Set(runs.filter((r, i) => !entries[i]?.results).map((r) => r.name))].join(' and ')} from their recorded inputs…`)));
    const mine = ++token;
    computeComparison(app, pair).then(() => {
      if (mine === token) render();
    });
  }

  function show(c, left, right, atProteinLevel) {
    if (c.error) {
      right.append(h('div.pane', h('div.callout.danger', icon('warning'), h('span', c.error))));
      return;
    }
    left.append(reportPane(c));
    if (!c.statistics) {
      destroyMaps();
      right.append(h('div.pane', h('h3', icon('compare'), 'Agreement'), h('p.muted', { style: { margin: 0 } }, 'Nothing to measure: the report says why these two cannot be compared.')));
      return;
    }
    const tab = TABS.some(([id]) => id === app.compareTab) ? app.compareTab : 'agreement';
    const tabs = h('div.segmented.compare-tabs', { role: 'tablist', 'aria-label': 'What to show' }, ...TABS.map(([id, name]) => h(`button${id === tab ? '.active' : ''}`, { type: 'button', role: 'tab', 'aria-selected': id === tab ? 'true' : 'false', onclick: () => { app.compareTab = id; render(); } }, name)));
    let body;
    if (tab === 'maps') {
      const cm = atProteinLevel();
      body = cm.statistics ? mapsPane(cm) : h('p.muted', { style: { margin: 0 } }, 'No maps: at the protein level, these two cannot be compared.');
    } else {
      body = tab === 'agreement' ? agreementPane(c) : disagreementPane(c);
    }
    right.append(h('div.pane', h('div.compare-tabs-row', tabs), body));
  }

  render();
  return {
    update(topics) {
      // A variant focused on the maps: selected in each, the maps (their zoom, keyboard focus) kept.
      if (topics.size === 1 && topics.has('focus') && maps && app.compareTab === 'maps' && root.contains(maps.entries[0]?.map.el)) {
        selectFocused();
        return;
      }
      if (topics.has('theme') || topics.has('colors')) for (const e of maps?.entries ?? []) e.map.refreshTheme();
      if (topics.has('ws') || topics.has('results') || topics.has('workspace-loaded') || topics.has('compare') || topics.has('focus') || topics.has('colors') || topics.has('theme')) render();
    },
    destroy() {
      token += 1;
      destroyMaps();
      root.remove();
    },
  };
}
