// The Compare view (wave 4, slices 1–3; requirements C1–C3): two sets of scores (a run's condition
// or one of its replicates, of one run or two; a MaveDB score set or a predictor kept beside the
// workspace), the compatibility report that says what their comparison can mean, filters by
// confidence and depth, and the scale they are compared on (as scored, stated, or each rescaled by
// its anchors); then the tabs:
//   - Agreement: a scatter plot of the variants compared with their agreement (Pearson, Spearman,
//     Lin's concordance, Bland–Altman) and the Bland–Altman plot;
//   - Maps: the two sides' maps and the map of their difference, panned and zoomed as one;
//   - Disagreement: the variants that differ beyond their uncertainty, and disagreement by position;
//   - Classes (a predictor): the measured side's scores in each of the predictor's classes, and how
//     well they tell its classes apart.
// The pair, its filters, scale and tab are the session's (app.comparePairs, app.compareFilters,
// app.compareScales, app.compareTab), not the workspace's: a comparison is a view of what the
// workspace keeps (its runs, each with its record; the score sets and predictors beside it).

import { h, icon, clear, downloadBlob, formatCount } from './dom.js';
import { annotationLabel, classesCSV, comparableAnnotations, compareSides, comparisonCSV, comparisonJSON, COMPARABLE_PROVIDERS, describePredictor, describeScoreSet, describeSide, differenceMap, DISCORDANT_Q, filtersApplied, MIN_POSITION_VARIANTS, NO_FILTERS, positionsCSV, possessive, sameSpec, SCALES, sideMap, sideOptions, specKey } from '../lib/compare.js';
import { categoricalColor } from '../lib/colormaps.js';
import { buildMapModel, cellAt, cellName, STATE, STATE_NAMES } from '../lib/map-model.js';
import { mapSVG } from '../lib/map-svg.js';
import { annotationTracks, providerById } from '../lib/providers/index.js';
import { scoreSetResults } from '../lib/scoreset.js';
import { trackTarget } from '../lib/tracks.js';
import { KIND } from '../lib/variants.js';
import { setScoreSetDirection } from '../lib/workspace.js';
import { publicDataState } from './public-data.js';
import { cssVar, legend, ticks } from './plots.js';
import { ensureResults, runEntry } from './run-results.js';
import { addFileTrack, addPublicTrack, annotationText } from './tracks.js';
import { toast } from './overlays.js';
import { mountVariantMap } from './variant-map.js';
import { selectOnMap } from './selections.js';

const fmt = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : '—');
const interval = (est, low, high, d = 3) => `${fmt(est, d)} (${fmt(low, d)} to ${fmt(high, d)})`;
const qText = (q) => (!Number.isFinite(q) ? '—' : q < 0.001 ? q.toExponential(1) : q.toFixed(3));

// The classes the plot colors, as the Score view's histograms color them.
const CLASSES = [['Synonymous', (k) => k === KIND.SYNONYMOUS, 0], ['Nonsense', (k) => k === KIND.NONSENSE, 1], ['Missense', (k) => k === KIND.MISSENSE, 2], ['Other', () => true, 3]];
const classOf = (kind) => CLASSES.findIndex(([, test]) => test(kind));
const TABS = [['agreement', 'Agreement'], ['maps', 'Maps'], ['disagreement', 'Disagreement'], ['classes', 'Classes']];

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

// What a side of the workspace can be: each run's conditions and replicates, then the score sets
// and predictors kept beside it: [{ spec, label, group }].
export function compareOptions(ws) {
  return [
    ...ws.runs.flatMap((r) => sideOptions(r).map((o) => ({ ...o, group: r.name }))),
    ...comparableAnnotations(ws).map((a) => ({ spec: { annotation: a.id }, label: annotationLabel(a), group: COMPARABLE_PROVIDERS[a.provider] === 'scoreset' ? 'MaveDB score sets (kept beside the workspace)' : 'Predictors (kept beside the workspace)' })),
  ];
}

const annotationOf = (ws, spec) => (spec?.annotation ? (ws.annotations ?? []).find((a) => a.id === spec.annotation) ?? null : null);
const runOf = (ws, spec) => (spec?.run ? ws.runs.find((r) => r.id === spec.run) ?? null : null);

// The pair shown for the open workspace (kept while its sides exist), or the default.
export function currentPair(app) {
  const ws = app.store.ws;
  app.comparePairs ??= new Map();
  const kept = app.comparePairs.get(ws.id);
  const exists = (spec) => {
    if (spec?.annotation) return Boolean(annotationOf(ws, spec) && COMPARABLE_PROVIDERS[annotationOf(ws, spec).provider]);
    const run = runOf(ws, spec);
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

// The scale of the open workspace's comparison (wave 4, slice 3): a key of SCALES, 'scored' at
// first.
export function currentScale(app) {
  app.compareScales ??= new Map();
  return app.compareScales.get(app.store.ws.id) ?? 'scored';
}

export function setScale(app, scale) {
  app.compareScales ??= new Map();
  app.compareScales.set(app.store.ws.id, Object.hasOwn(SCALES, scale) ? scale : 'scored');
  app.store.notify(['compare']);
}

// What an annotation side needs, read once: its kept text (by SHA-256), a score set read as
// published (by its text and the direction stated), a predictor placed on a measured side (by that
// side's scores and target).
const texts = new Map();
const readSets = new Map();
const placed = new WeakMap();

// Whether every side of a pair can be described now (its run's scores computed, its annotation's
// text read).
function ready(app, pair) {
  const ws = app.store.ws;
  return [pair.a, pair.b].every((spec) => {
    const a = annotationOf(ws, spec);
    if (a) return texts.has(a.file?.sha256);
    const run = runOf(ws, spec);
    return Boolean(run && runEntry(app, run)?.results);
  });
}

// Recomputes the runs' scores and reads the annotations' texts a pair needs: null, or what failed.
async function prepare(app, pair) {
  const ws = app.store.ws;
  for (const spec of [pair.a, pair.b]) {
    const a = annotationOf(ws, spec);
    if (spec?.annotation && !a) return 'A score set or predictor of the pair is no longer kept beside the workspace.';
    if (a) {
      const sha = a.file?.sha256;
      if (!texts.has(sha)) {
        try {
          texts.set(sha, await annotationText(app, a));
        } catch (error) {
          return `${a.name}: ${error.message}`;
        }
      }
      continue;
    }
    const run = runOf(ws, spec);
    if (!run) return 'A run of the pair is no longer in the workspace.';
    const entry = await ensureResults(app, run);
    if (!entry?.results) return `${run.name}'s scores could not be recomputed: ${entry?.message ?? 'unknown'}`;
  }
  return null;
}

// A side of a pair, described (lib/compare.js), once ready. other: the measured side a predictor is
// placed on.
function describe(app, spec, other = null) {
  const ws = app.store.ws;
  const a = annotationOf(ws, spec);
  if (!a) {
    const run = runOf(ws, spec);
    return describeSide(ws, run, runEntry(app, run).results, spec);
  }
  const text = texts.get(a.file.sha256);
  if (COMPARABLE_PROVIDERS[a.provider] === 'scoreset') {
    const key = `${a.file.sha256}|${a.record?.scoreSet?.readout?.direction ?? ''}|${a.record?.scoreSet?.urn ?? ''}`;
    if (!readSets.has(key)) readSets.set(key, scoreSetResults(text, a.record?.scoreSet));
    const read = readSets.get(key);
    if (read.error) throw new Error(read.error);
    return describeScoreSet(a, read);
  }
  // A predictor: placed on the measured side's protein, as its track is placed beside that side's map.
  if (!other) throw new Error(`${a.name} is compared with a run's scores or a score set's: choose one for the other side.`);
  if (!placed.has(other.results)) placed.set(other.results, new Map());
  const cache = placed.get(other.results);
  const key = `${a.id}|${a.file.sha256}|${specKey(other.spec)}`;
  if (!cache.has(key)) {
    const map = sideMap(other);
    if (!map) throw new Error(`${other.label} has no protein changes to place ${a.name}'s substitutions on (nucleotide variants with no coding sequence).`);
    const model = buildMapModel(map.results, map.design, { condition: map.condition });
    const read = annotationTracks(a, text, { target: trackTarget(other.target, ws.targets), protein: model.protein, offset: model.target.offset ?? 0, length: model.length });
    if (!read.tracks.length) throw new Error(`${a.name}: ${read.problem ?? `nothing to place on ${other.target?.name ?? 'the target'}`}`);
    cache.set(key, describePredictor(a, read.tracks[0], other, read.notes));
  }
  return cache.get(key);
}

// The comparison of a pair with filters and a scale, its runs' scores recomputed and its
// annotations read first when they are not yet: the result of compareSides (with its two sides,
// `sides`), or { error }. level 'protein': matched at the protein level (the maps').
const memo = new Map();
export async function computeComparison(app, pair, filters = currentFilters(app), level = null, scale = currentScale(app)) {
  const failed = await prepare(app, pair);
  if (failed) return { error: failed };
  return comparisonOf(app, pair, filters, level, scale);
}

function comparisonOf(app, pair, filters, level = null, scale = 'scored') {
  const ws = app.store.ws;
  const identity = [pair.a, pair.b].map((spec) => {
    const a = annotationOf(ws, spec);
    return a ? `${a.file?.sha256}|${a.record?.scoreSet?.readout?.direction ?? ''}` : runEntry(app, runOf(ws, spec))?.results;
  });
  const key = `${ws.id}||${specKey(pair.a)}||${specKey(pair.b)}||${JSON.stringify(filters)}||${level ?? ''}||${scale}`;
  const hit = memo.get(key);
  if (hit && hit.identity.every((x, i) => x === identity[i])) return hit.value;
  let value;
  try {
    // A predictor is placed on the other side, so that side is described first.
    const first = annotationOf(ws, pair.a) && COMPARABLE_PROVIDERS[annotationOf(ws, pair.a).provider] === 'predictor';
    let sides;
    if (first) {
      const b = describe(app, pair.b);
      sides = [describe(app, pair.a, b), b];
    } else {
      const a = describe(app, pair.a);
      sides = [a, describe(app, pair.b, a)];
    }
    value = compareSides(sides[0], sides[1], { filters, scale, ...(level ? { level } : {}) });
    value.sides = sides;
  } catch (error) {
    value = { error: error.message };
  }
  // Kept for the open workspace's latest few comparisons.
  memo.set(key, { identity, value });
  if (memo.size > 24) memo.delete(memo.keys().next().value);
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

// The comparison's files: { csv, json, positions, classes } named after the two sides.
export function comparisonFiles(app, c) {
  const base = `${c.a.label}_vs_${c.b.label}`.replace(/[^\w.-]+/g, '_').replace(/_+/g, '_');
  return {
    csv: { name: `${base}_comparison.csv`, text: comparisonCSV(c) },
    json: { name: `${base}_comparison.json`, text: comparisonJSON(c, { name: 'MaveScape', version: app.version, commit: app.commit || null }) },
    positions: { name: `${base}_comparison_positions.csv`, text: positionsCSV(c) },
    classes: { name: `${base}_comparison_classes.csv`, text: classesCSV(c) },
    base,
  };
}

// Keeps a MaveDB score set beside the workspace by its URN, or a predictor (AlphaMissense from
// AlphaFold DB, or a predictor's file), placed by a run's target; then compares it with the first
// side when that is a run's condition, else with the run's combined scores. Returns
// addPublicTrack's or addFileTrack's answer.
export async function addCompared(app, run, { urn = null, direction = null, provider = null, file = null, quiet = false } = {}) {
  const result = file ? await addFileTrack(app, run, file) : await addPublicTrack(app, run, provider ?? 'mavedb-scores', { urn, direction, quiet });
  if (result.ok) {
    const added = (app.store.ws.annotations ?? []).find((a) => a.id === result.id);
    if (added && COMPARABLE_PROVIDERS[added.provider]) {
      const pair = currentPair(app);
      setPair(app, { a: pair?.a?.run && !pair.a.replicate ? pair.a : { run: run.id, condition: 0 }, b: { annotation: added.id } });
    }
  }
  return result;
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
  // An axis label shortened to its axis's length, with an ellipsis (a score set's title and URN).
  const fit = (text, room) => {
    if (ctx.measureText(text).width <= room) return text;
    let cut = text;
    while (cut.length > 4 && ctx.measureText(`${cut}…`).width > room) cut = cut.slice(0, -1);
    return `${cut.trimEnd()}…`;
  };
  ctx.textAlign = 'center';
  ctx.fillText(fit(xLabel, width - pad.l - pad.r), (pad.l + width - pad.r) / 2, height - 3);
  ctx.save();
  ctx.translate(10, (pad.t + height - pad.b) / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(fit(yLabel, height - pad.t - pad.b), 0, 0);
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

// A predictor's classes as boxes (wave 4, slice 3): for each class, the measured side's scores of
// its variants compared (the quartiles as a box, the median as a line), with the measured side's
// synonymous and nonsense medians as dashed lines.
function classBoxes({ list, references, label, xLabel }) {
  const W = 420;
  const rowH = 34;
  const pad = { l: 118, r: 12, t: 18, b: 34 };
  const H = pad.t + pad.b + rowH * list.length;
  const NS = 'http://www.w3.org/2000/svg';
  const el = document.createElementNS(NS, 'svg');
  el.setAttribute('viewBox', `0 0 ${W} ${H}`);
  el.setAttribute('class', 'plot compare-classes');
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', label);
  const add = (name, attrs, text = null) => {
    const node = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (text !== null) node.textContent = text;
    el.append(node);
    return node;
  };
  const values = [...list.flatMap((x) => (x.n ? [x.low, x.high] : [])), references.synonymous.median, references.nonsense.median].filter(Number.isFinite);
  if (!values.length) return el;
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  const margin = (hi - lo) * 0.06 || 1;
  lo -= margin;
  hi += margin;
  const sx = (v) => pad.l + ((v - lo) / (hi - lo)) * (W - pad.l - pad.r);
  const bottom = H - pad.b;
  add('line', { x1: pad.l, x2: W - pad.r, y1: bottom, y2: bottom, stroke: cssVar('--line-strong') });
  for (const v of ticks(lo, hi)) add('text', { x: sx(v), y: bottom + 13, 'text-anchor': 'middle', class: 'tick' }, Number(v.toPrecision(3)).toString());
  add('text', { x: (pad.l + W - pad.r) / 2, y: H - 4, 'text-anchor': 'middle', class: 'tick' }, xLabel);
  for (const [what, ref] of [['synonymous', references.synonymous], ['nonsense', references.nonsense]]) {
    if (!Number.isFinite(ref.median)) continue;
    add('line', { x1: sx(ref.median), x2: sx(ref.median), y1: pad.t, y2: bottom, stroke: cssVar('--text-3'), 'stroke-dasharray': '4 3' });
    add('text', { x: sx(ref.median), y: pad.t - 6, 'text-anchor': 'middle', class: 'tick' }, what);
  }
  list.forEach((x, k) => {
    const y = pad.t + 4 + k * rowH;
    add('text', { x: pad.l - 8, y: y + rowH / 2 - 4, 'text-anchor': 'end', class: 'label' }, x.label.replace(/ \(.*\)$/, ''));
    add('text', { x: pad.l - 8, y: y + rowH / 2 + 9, 'text-anchor': 'end', class: 'tick' }, `${x.n.toLocaleString('en-US')} variants`);
    if (!x.n) return;
    const color = x.id === 'pathogenic' ? cssVar('--danger') : x.id === 'benign' ? cssVar('--ok') : cssVar('--text-3');
    const box = add('rect', { x: sx(x.low), y: y + 4, width: Math.max(1, sx(x.high) - sx(x.low)), height: rowH - 14, fill: color, opacity: 0.35, stroke: color });
    const title = document.createElementNS(NS, 'title');
    title.textContent = `${x.label}: ${x.n} variants, median ${fmt(x.median)}, quartiles ${fmt(x.low)} to ${fmt(x.high)}`;
    box.append(title);
    add('line', { x1: sx(x.median), x2: sx(x.median), y1: y + 2, y2: y + rowH - 8, stroke: color, 'stroke-width': 2.5 });
  });
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
      if (!groups.has(o.group)) groups.set(o.group, []);
      groups.get(o.group).push(o);
    }
    const select = h('select.input', { 'aria-label': which === 'a' ? 'First side' : 'Second side', onchange: (e) => {
      const chosen = options.find((o) => specKey(o.spec) === e.target.value);
      if (chosen) setPair(app, { ...pair, [which]: chosen.spec });
    } }, ...[...groups.entries()].map(([group, list]) => h('optgroup', { label: group }, ...list.map((o) => h('option', { value: specKey(o.spec), selected: specKey(o.spec) === value }, o.label)))));
    return h('label.field', h('span', which === 'a' ? 'First (horizontal)' : 'Second (vertical)'), select);
  }

  // What a higher score of a MaveDB score set means, as the person states it (MaveDB records none).
  function directionField(spec) {
    const a = spec?.annotation ? (store.ws.annotations ?? []).find((x) => x.id === spec.annotation) : null;
    if (!a?.record?.scoreSet) return null;
    const current = a.record.scoreSet.readout?.direction ?? '';
    const choices = [['', 'not stated'], ['higher-more', 'more of the function'], ['higher-less', 'less of the function'], ['unsigned', 'a larger change, either way']];
    return h('label.field', h('span', `A higher score of ${a.record.scoreSet.title} means`),
      h('select.input', { 'aria-label': `What a higher score of ${a.record.scoreSet.title} means`, onchange: (e) => store.commit(setScoreSetDirection(store.ws, a.id, e.target.value || null), `${a.name}: what a higher score means`) },
        ...choices.map(([v, label]) => h('option', { value: v, selected: v === current }, label))));
  }

  // Score sets and predictors to compare (wave 4, slice 3), kept beside the workspace: a MaveDB score
  // set by its URN, AlphaMissense for a human protein, a predictor's file. Placed by the first
  // side's run (or the latest).
  function sourcesPane(pair) {
    const ws = store.ws;
    const run = (pair?.a?.run ? ws.runs.find((r) => r.id === pair.a.run) : null) ?? ws.runs.at(-1);
    if (!run) return null;
    const online = ['on', 'offline'].includes(publicDataState(app));
    const target = trackTarget(run.inputs.design.targets?.[0], ws.targets);
    const am = providerById('alphamissense');
    const amWhy = !online ? 'Public data are off.' : am.needs(target, {});
    const amAdded = (ws.annotations ?? []).some((a) => a.provider === 'alphamissense');
    const urn = h('input.input', { placeholder: 'urn:mavedb:00000054-a-1', 'aria-label': 'A MaveDB score set\'s URN', disabled: !online });
    const direction = h('select.input', { 'aria-label': 'What a higher score of the score set means', disabled: !online },
      h('option', { value: '' }, 'a higher score means: not stated'), h('option', { value: 'higher-more' }, 'more of the function'), h('option', { value: 'higher-less' }, 'less of the function'), h('option', { value: 'unsigned' }, 'a larger change, either way'));
    const busy = (button, work) => async () => {
      button.disabled = true;
      try {
        const result = await work();
        if (result && !result.ok) toast(result.message, { kind: 'error' });
      } finally {
        button.disabled = false;
      }
    };
    const add = h('button.btn.small', { type: 'button', disabled: !online }, icon('plus'), 'Add');
    add.addEventListener('click', busy(add, () => addCompared(app, run, { urn: urn.value.trim(), direction: direction.value || null })));
    urn.addEventListener('keydown', (e) => { if (e.key === 'Enter') add.click(); });
    const amButton = h('button.btn.small', { type: 'button', disabled: Boolean(amWhy) || amAdded, title: amWhy ?? (amAdded ? 'AlphaMissense is kept beside the workspace: choose it as a side.' : am.what) }, icon('globe'), 'AlphaMissense');
    amButton.addEventListener('click', busy(amButton, () => addCompared(app, run, { provider: 'alphamissense' })));
    const fileButton = h('button.btn.small', { type: 'button' }, icon('table'), 'A predictor\'s file…');
    fileButton.addEventListener('click', busy(fileButton, async () => {
      const file = await new Promise((resolve) => {
        const input = h('input', { type: 'file', accept: '.csv,.tsv,.txt', hidden: true, onchange: () => resolve(input.files[0] ?? null) });
        document.body.append(input);
        input.click();
        setTimeout(() => input.remove(), 60000);
      });
      return file ? addCompared(app, run, { file: { name: file.name, text: await file.text() } }) : null;
    }));
    return h('div.pane', h('h3', icon('plus'), 'Other sources'),
      h('p.muted', { style: { fontSize: '11.5px', margin: '0 0 6px' } }, `Kept beside the workspace (not opened as one), placed on ${run.name}'s target: a MaveDB score set of the same protein (another assay, or the published scores of these counts), or a predictor.`),
      h('div.compare-urn', urn, add), direction,
      h('div.btn-row', { style: { marginTop: '6px' } }, amButton, fileButton),
      online ? null : h('p.muted', { style: { fontSize: '11.5px', margin: '6px 0 0' } }, 'Public data are off: a predictor\'s file can still be added.'));
  }

  // The scale the two are compared on (wave 4, slice 3).
  function scalePane(pair) {
    const mode = currentScale(app);
    const predictor = [pair.a, pair.b].some((spec) => {
      const a = spec?.annotation ? (store.ws.annotations ?? []).find((x) => x.id === spec.annotation) : null;
      return a && COMPARABLE_PROVIDERS[a.provider] === 'predictor';
    });
    const hints = {
      scored: 'Each as it was scored: one scale only when the same model, normalization and rescaling made both.',
      stated: 'You know they are on one scale (one study, one pipeline) though their records do not say so.',
      'nonsense-wt': 'Each side\'s nonsense median to 0 and its wild type to 1, from its own scores.',
      'synonymous-nonsense': 'Each side\'s synonymous median to 0 and its nonsense median to −1, from its own scores.',
    };
    return h('div.pane', h('h3', icon('calibrate'), 'Scale'),
      predictor ? h('p.muted', { style: { fontSize: '11.5px', margin: '0 0 6px' } }, 'A predictor is compared by rank and by its classes: a scale applies to two measurements.') : null,
      h('div.compare-scales', { role: 'radiogroup', 'aria-label': 'The scale they are compared on' }, ...Object.entries(SCALES).map(([id, s]) => h('label.check', { title: hints[id] },
        h('input', { type: 'radio', name: 'compare-scale', value: id, checked: id === mode, disabled: predictor && id !== 'scored', onchange: () => setScale(app, id) }),
        h('span', s.label.replace(/^rescaled by their anchors: /, 'rescaled: '))))));
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
    const predictor = Boolean(c.classes);
    const withheld = predictor ? 'withheld: a prediction, compared by rank' : 'withheld: not on one scale (see Scale)';
    const rows = [
      ['Variants compared', formatCount(s.n)],
      ['Pearson\'s r', s.pearson ? interval(s.pearson.r, s.pearson.low, s.pearson.high) : withheld],
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
    if (c.classes?.valid && Number.isFinite(c.classes.auc?.auc)) rows.push(['AUC, its classes (Classes)', interval(c.classes.auc.auc, c.classes.auc.low, c.classes.auc.high)]);
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
  // A variant clicked is shown in the inspector as a run scored it: the first side's, else the
  // second's (a score set or a predictor has no run to show it in).
  const isRun = (s) => (s.source ?? 'run') === 'run';
  const pickA = (c, i) => {
    if (isRun(c.a)) app.focusItem({ kind: 'variant', id: c.values.a.keys[i], run: c.a.run.id, condition: c.a.condition });
    else if (isRun(c.b)) {
      const row = c.rows.find(([x]) => x === i) ?? (c.matchedAll ?? []).find(([x]) => x === i);
      if (row) app.focusItem({ kind: 'variant', id: c.values.b.keys[row[1]], run: c.b.run.id, condition: c.b.condition });
    }
  };
  const pickB = (c, j) => {
    if (isRun(c.b)) app.focusItem({ kind: 'variant', id: c.values.b.keys[j], run: c.b.run.id, condition: c.b.condition });
    else if (isRun(c.a)) {
      const row = c.rows.find(([, y]) => y === j) ?? (c.matchedAll ?? []).find(([, y]) => y === j);
      if (row) app.focusItem({ kind: 'variant', id: c.values.a.keys[row[0]], run: c.a.run.id, condition: c.a.condition });
    }
  };
  const runSide = (c) => (isRun(c.a) ? c.a : isRun(c.b) ? c.b : null);

  function agreementPane(c) {
    const { a: va } = c.values;
    const kinds = Uint8Array.from(c.rows, ([i]) => va.kind[i]);
    const name = (k) => c.keys[k];
    const shown = runSide(c);
    const pick = shown ? (k) => pickA(c, c.rows[k][0]) : null;
    const focus = focusIndex(c);
    const rescaled = c.scale?.applied && c.scale.anchors;
    const axis = (label, w) => (rescaled ? `${label} (rescaled)` : w === 'b' && c.flipped ? `${label} (negated)` : label);
    const ba = c.statistics.blandAltman;
    const files = comparisonFiles(app, c);
    const used = CLASSES.filter((_, idx) => kinds.some((k) => classOf(k) === idx));
    return h('div',
      plotPairs({ x: c.x, y: c.y, kinds, xLabel: axis(c.a.label, 'a'), yLabel: axis(c.b.label, 'b'), label: `${c.b.label} against ${c.a.label}: one point per variant compared${c.sameScale ? ', with the line y = x' : ''}`, diagonal: c.sameScale, pick, name, focus }),
      legend(used.map(([label, , color]) => ({ label, color: categoricalColor(color) }))),
      h('p.muted', { style: { fontSize: '11.5px', margin: '4px 0 8px' } }, `${shown ? `Click a point to see the variant in the inspector (as ${shown.label} scored it).` : ''}${c.sameScale ? ' The dashed line is y = x: on it, the two agree.' : ''}${rescaled ? ' Both are drawn rescaled by their anchors.' : ''}`),
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
    const key = `${cm.a.run.sha256}|${cm.b.run.sha256}|${specKey(cm.sides[0].spec)}|${specKey(cm.sides[1].spec)}|${JSON.stringify(cm.filters)}|${cm.scale?.mode ?? ''}|${palette()}`;
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
      const describeCell = (which, m) => (cell) => {
        const i = m.model.cells[cell.k];
        const where = `position ${cell.position}${m.model.target.offset ? ` (reference ${cell.position + m.model.target.offset})` : ''}`;
        if (i < 0 || cell.state === STATE.MISSING || cell.state === STATE.NOT_DESIGNED) return `${where}: ${STATE_NAMES[cell.state]}`;
        const name = m.results.variants.key[i];
        if (which === 'difference') {
          const k = kOf.get(i);
          if (k === undefined) return `${name}: no difference (${pairOfA.has(i) ? 'left out by the filters, or scored on one side only' : `not among ${possessive(cm.b.label)} variants`})`;
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
          describe: describeCell(which, m),
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
      const title = e.which === 'difference' ? `${e.label}: ${blue} where the first is lower, ${red} where higher${cm.scale?.applied && cm.scale.anchors ? ' (rescaled by their anchors)' : ''}` : `${e.label}, on its own scale: ${blue} lower, ${red} higher than its wild type`;
      const heading = e.which === 'first' ? `First: ${e.label}` : e.which === 'second' ? `Second: ${e.label}` : `Difference: ${e.label}`;
      return h('div.compare-map', h('h4', heading), colors ? mapLegend(e.m.model, colors, title) : null, e.map.el);
    });
    const files = comparisonFiles(app, cm);
    const svgOf = (which) => mapSVG(maps.models[which].model, { palette: palette(), results: maps.models[which].results });
    const predictors = cm.sides.filter((s) => s.source === 'predictor').map((s) => s.label);
    const noMap = ['first', 'second'].filter((w) => !maps.models[w]).map((w) => cm.sides[w === 'first' ? 0 : 1]).filter((s) => s.source !== 'predictor').map((s) => s.label);
    return h('div',
      h('p.muted', { style: { fontSize: '11.5px', margin: '0 0 8px' } }, 'The maps pan and zoom together (drag, or ⌘ or Ctrl and the wheel). Click a cell to see the variant in the inspector; it is selected in each map. In the difference, hatched cells were scored on one side only, or left out by the filters.'),
      ...blocks,
      !maps.models.difference && maps.models.first && !predictors.length ? h('div.callout', icon('info'), h('span', cm.sameScale ? 'No difference map.' : 'No difference map: the two are not on one scale (see Scale), so their difference has no meaning.')) : null,
      predictors.length ? h('div.callout', icon('info'), h('span', `${predictors.join(' and ')}: a prediction, drawn as a track beside the map (Map view, Tracks), not as a map of its own; no difference map.`)) : null,
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
    // The map's selection (wave 4, slice 5) outlined on the side of its run, by name.
    const sel = store.ui.selection;
    for (const e of maps.entries) {
      const row = e.which === 'second' ? rowB : rowA;
      const k = row < 0 ? -1 : e.m.model.cells.indexOf(row);
      const side = e.which === 'second' ? cm.b : cm.a;
      const cells = new Set(k >= 0 ? [k] : []);
      if (sel?.keys.length && side.run?.id === sel.run) {
        e.cellOfKey ??= keyIndex(e.m.model);
        for (const key of sel.keys) if (e.cellOfKey.has(key)) cells.add(e.cellOfKey.get(key));
      }
      e.map.setSelection([...cells]);
    }
  }
  function keyIndex(model) {
    const index = new Map();
    const R = model.rows.length;
    for (let k = 0; k < model.cells.length; k += 1) if (model.state[k] !== STATE.NOT_DESIGNED) index.set(cellName(model, cellAt(model, Math.floor(k / R) + 1, k % R)), k);
    return index;
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
      out.push(h('p', { style: { margin: '0 0 6px' } }, `${formatCount(order.length)} of ${formatCount(d.tested)} variants differ beyond their uncertainty (q < ${DISCORDANT_Q}, Benjamini–Hochberg; each difference's z from both SEs${c.scale?.applied && c.scale.anchors ? ' and the anchors\'' : ''}): ${formatCount(lower)} lower in ${c.a.label}, ${formatCount(order.length - lower)} higher.`));
      if (d.dispersion > 1.5) out.push(h('div.callout.warn', icon('warning'), h('span', `The differences are ${fmt(d.dispersion, 1)} times as variable as the SEs say (the median z² over its expected value). Either the SEs are too small (QC's variance beyond counting: a bottleneck), or the two differ nearly everywhere (two assays measuring different things); either way, more variants test as discordant than truly differ.`)));
      else out.push(h('p.muted', { style: { fontSize: '11.5px', margin: '0 0 6px' } }, `The differences are ${fmt(d.dispersion, 2)} times as variable as the SEs say: about what they predict.`));
      const side = runSide(c);
      if (order.length && side) {
        const values = side === c.a ? c.values.a : c.values.b;
        const names = order.map((k) => values.keys[side === c.a ? c.rows[k][0] : c.rows[k][1]]);
        out.push(h('div.btn-row', { style: { margin: '0 0 6px' } }, h('span.spacer'),
          h('button.btn.small', { type: 'button', title: `Select the ${formatCount(order.length)} discordant variants on the map of ${side.run.name}`, onclick: async () => {
            const run = store.ws.runs.find((r) => r.id === side.run.id);
            if (!run) return;
            const { offMap } = await selectOnMap(app, run, { names, condition: Math.max(0, side.condition ?? 0) });
            if (offMap) toast(`${formatCount(offMap)} of them are not on the map (not single substitutions).`);
          } }, icon('heatmap'), 'Select them on the map')));
      }
      if (order.length) {
        out.push(h('div', { style: { maxHeight: '260px', overflow: 'auto' } }, h('table.data.compact', h('thead', h('tr', h('th', 'Variant'), h('th.r', 'First'), h('th.r', 'Second'), h('th.r', 'Difference'), h('th.r', 'z'), h('th.r', 'q'))),
          h('tbody', ...order.slice(0, 100).map((k) => h('tr', { style: { cursor: runSide(c) ? 'pointer' : 'default' }, onclick: () => pickA(c, c.rows[k][0]) },
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

  // --- Classes (wave 4, slice 3) ---------------------------------------------------------------------

  function classesPane(c) {
    const k = c.classes;
    if (!k?.valid) return h('div.callout', icon('info'), h('span', `No classes: ${k?.reason ?? 'one side must be a predictor that classes its substitutions (AlphaMissense, EVE).'}`));
    const files = comparisonFiles(app, c);
    const auc = k.auc;
    const tolerated = k.list.find((x) => x.id === 'benign')?.label.replace(/ \(.*\)$/, '') ?? 'tolerated';
    const damaging = k.list.find((x) => x.id === 'pathogenic')?.label.replace(/ \(.*\)$/, '') ?? 'damaging';
    return h('div',
      h('p', { style: { margin: '0 0 6px' } }, `${k.measured}, as scored, in each of ${possessive(k.predictor)} classes (the variants compared): the box holds the middle half, the line is the median.`),
      classBoxes({ list: k.list, references: k.references, label: `${k.measured} in each of ${possessive(k.predictor)} classes, with its synonymous and nonsense medians`, xLabel: k.measured }),
      h('table.data.compact', { style: { marginTop: '8px' } }, h('thead', h('tr', h('th', 'Class'), h('th.r', 'Variants'), h('th.r', 'Median'), h('th.r', 'Quartiles'))),
        h('tbody', ...k.list.map((x) => h('tr', h('td', x.label), h('td.r', formatCount(x.n)), h('td.r', fmt(x.median)), h('td.r', `${fmt(x.low)} to ${fmt(x.high)}`))))),
      Number.isFinite(auc?.auc)
        ? h('p', { style: { margin: '10px 0 4px' } }, `${k.measured} tells ${possessive(k.predictor)} ${tolerated} substitutions from its ${damaging} ones with an AUC of ${interval(auc.auc, auc.low, auc.high)} (DeLong): the chance that a ${tolerated} one has more of the function than a ${damaging} one${auc.measuredNegated ? ' (a lower score meaning more of it)' : auc.directionStated ? '' : ' (a higher score taken as more of it: not stated)'}. 0.5 is no better than chance; 1, always.`)
        : h('p.muted', { style: { margin: '10px 0 4px' } }, `No AUC: the variants compared do not include both ${tolerated} and ${damaging} ones.`),
      h('p.muted', { style: { fontSize: '11.5px', margin: 0 } }, `The dashed lines are the synonymous median of ${k.measured} (${fmt(k.references.synonymous.median)}, ${formatCount(k.references.synonymous.n)} variants) and its nonsense median (${fmt(k.references.nonsense.median)}, ${formatCount(k.references.nonsense.n)}), where they are scored: what full function and its loss look like in the assay.`),
      h('div.btn-row', { style: { marginTop: '12px' } },
        h('button.btn', { type: 'button', onclick: () => downloadBlob(new Blob([files.classes.text], { type: 'text/csv' }), files.classes.name) }, icon('download'), 'By class (CSV)'),
        h('button.btn', { type: 'button', onclick: () => downloadBlob(new Blob([files.json.text], { type: 'application/json' }), files.json.name) }, icon('download'), 'Report and statistics (JSON)')));
  }

  function empty(message) {
    root.append(h('div.view-body', h('div.planned', h('div.empty', icon('compare'), h('h3', 'Compare'), h('p', message),
      h('div.btn-row', { style: { marginTop: '12px' } }, h('button.btn.primary', { type: 'button', onclick: () => app.setMode('score') }, icon('score'), 'Open Score'))))));
  }

  function render() {
    clear(root);
    const ws = store.ws;
    const pair = currentPair(app);
    const options = compareOptions(ws);
    const label = (spec) => options.find((o) => sameSpec(o.spec, spec))?.label ?? '';
    root.append(h('div.workbench-head', h('h1', icon('compare'), 'Compare', pair ? h('span.crumbs', ` · ${label(pair.a)} and ${label(pair.b)}`) : null), h('span.spacer')));
    if (!pair) {
      destroyMaps();
      empty('Two sets of scores side by side: two replicates, two conditions, or two runs (a rescoring, or a MaveDB record\'s published scores against its counts scored again); or a run against another MaveDB score set or a predictor. With what their comparison can mean and how well they agree. Score a run first.');
      return;
    }
    const swap = h('button.btn', { type: 'button', title: 'Swap the two sides', onclick: () => setPair(app, { a: pair.b, b: pair.a }) }, icon('swap'), 'Swap');
    const sides = h('div.pane', h('h3', icon('compare'), 'Sides'), sideSelect('a', pair, options), directionField(pair.a), sideSelect('b', pair, options), directionField(pair.b), h('div.btn-row', swap));
    const left = h('div', sides, scalePane(pair), filtersPane());
    const right = h('div');
    root.append(h('div.view-body', h('div.split.compare-split', left, right)));
    // The report, then the sources that can be added (wave 4, slice 3), below the controls.
    if (ready(app, pair)) {
      const filters = currentFilters(app);
      const scale = currentScale(app);
      const c = comparisonOf(app, pair, filters, null, scale);
      show(c, left, right, () => (c.level === 'protein' ? c : comparisonOf(app, pair, filters, 'protein', scale)));
      const sources = sourcesPane(pair);
      if (sources) left.append(sources);
      return;
    }
    const sources = sourcesPane(pair);
    if (sources) left.append(sources);
    right.append(h('div.pane', h('p.muted', { style: { margin: 0 } }, 'Recomputing the scores of the runs compared from their recorded inputs, and reading the score sets and predictors kept beside the workspace…')));
    const mine = ++token;
    prepare(app, pair).then((failed) => {
      if (mine !== token) return;
      if (failed) {
        clear(right);
        right.append(h('div.pane', h('div.callout.danger', icon('warning'), h('span', failed))));
        return;
      }
      render();
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
    const offered = TABS.filter(([id]) => id !== 'classes' || c.classes);
    const tab = offered.some(([id]) => id === app.compareTab) ? app.compareTab : 'agreement';
    const tabs = h('div.segmented.compare-tabs', { role: 'tablist', 'aria-label': 'What to show' }, ...offered.map(([id, name]) => h(`button${id === tab ? '.active' : ''}`, { type: 'button', role: 'tab', 'aria-selected': id === tab ? 'true' : 'false', onclick: () => { app.compareTab = id; render(); } }, name)));
    let body;
    if (tab === 'maps') {
      const cm = atProteinLevel();
      body = cm.statistics ? mapsPane(cm) : h('p.muted', { style: { margin: 0 } }, 'No maps: at the protein level, these two cannot be compared.');
    } else {
      body = tab === 'agreement' ? agreementPane(c) : tab === 'classes' ? classesPane(c) : disagreementPane(c);
    }
    right.append(h('div.pane', h('div.compare-tabs-row', tabs), body));
  }

  render();
  return {
    update(topics) {
      // A variant focused on the maps: selected in each, the maps (their zoom, keyboard focus) kept.
      if (topics.size === 1 && (topics.has('focus') || topics.has('selection')) && maps && app.compareTab === 'maps' && root.contains(maps.entries[0]?.map.el)) {
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
