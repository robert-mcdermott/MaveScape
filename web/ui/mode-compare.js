// The Compare view (wave 4, slice 1; requirements C1–C3): two sets of scores of the workspace (a
// run's condition or one of its replicates, of one run or two), the compatibility report that says
// what their comparison can mean, a scatter plot of the variants scored on both sides with their
// agreement (Pearson, Spearman, Lin's concordance, Bland–Altman), the Bland–Altman plot, and the
// matched variants exported. The pair shown is the session's (app.comparePairs, per workspace),
// not the workspace's: a comparison is a view of two runs, each kept with its own record.

import { h, icon, clear, downloadBlob, formatCount } from './dom.js';
import { compareSides, comparisonCSV, comparisonJSON, describeSide, sameSpec, sideOptions, specKey } from '../lib/compare.js';
import { categoricalColor } from '../lib/colormaps.js';
import { KIND } from '../lib/variants.js';
import { cssVar, legend, ticks } from './plots.js';
import { ensureResults, runEntry } from './run-results.js';

const fmt = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : '—');
const interval = (est, low, high, d = 3) => `${fmt(est, d)} (${fmt(low, d)} to ${fmt(high, d)})`;

// The classes the plot colors, as the Score view's histograms color them.
const CLASSES = [['Synonymous', (k) => k === KIND.SYNONYMOUS, 0], ['Nonsense', (k) => k === KIND.NONSENSE, 1], ['Missense', (k) => k === KIND.MISSENSE, 2], ['Other', () => true, 3]];
const classOf = (kind) => CLASSES.findIndex(([, test]) => test(kind));

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

// The comparison of a pair, its runs' scores recomputed first when they are not yet: the result of
// compareSides, or { error }.
const memo = new WeakMap();
export async function computeComparison(app, pair) {
  const ws = app.store.ws;
  const runs = [pair.a, pair.b].map((s) => ws.runs.find((r) => r.id === s.run));
  if (runs.some((r) => !r)) return { error: 'A run of the pair is no longer in the workspace.' };
  const entries = await Promise.all(runs.map((r) => ensureResults(app, r)));
  const failed = entries.findIndex((e) => !e?.results);
  if (failed >= 0) return { error: `${runs[failed].name}'s scores could not be recomputed: ${entries[failed]?.message ?? 'unknown'}` };
  return comparisonOf(ws, runs, entries.map((e) => e.results), pair);
}

function comparisonOf(ws, runs, results, pair) {
  const key = `${specKey(pair.a)}||${specKey(pair.b)}`;
  if (!memo.has(results[0])) memo.set(results[0], new Map());
  const cache = memo.get(results[0]);
  const hit = cache.get(key);
  if (hit && hit.other === results[1]) return hit.value;
  let value;
  try {
    value = compareSides(describeSide(ws, runs[0], results[0], pair.a), describeSide(ws, runs[1], results[1], pair.b));
  } catch (error) {
    value = { error: error.message };
  }
  cache.set(key, { other: results[1], value });
  return value;
}

// The comparison's files: { csv, json } named after the two sides.
export function comparisonFiles(app, c) {
  const base = `${c.a.label}_vs_${c.b.label}`.replace(/[^\w.-]+/g, '_').replace(/_+/g, '_');
  return {
    csv: { name: `${base}_comparison.csv`, text: comparisonCSV(c) },
    json: { name: `${base}_comparison.json`, text: comparisonJSON(c, { name: 'MaveScape', version: app.version, commit: app.commit || null }) },
  };
}

// A scatter of x against y on a canvas, colored by class, with lines: { el, update }. pick(k): the
// k-th point clicked. lines: [{ y } | { diagonal }] with a dash.
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

export function mountCompareMode(app, container) {
  const { store } = app;
  const root = h('div.view');
  container.append(root);
  let token = 0;

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

  function agreementPane(c) {
    const { a: va } = c.values;
    const kinds = Uint8Array.from(c.rows, ([i]) => va.kind[i]);
    const name = (k) => c.keys[k];
    const pick = (k) => app.focusItem({ kind: 'variant', id: va.keys[c.rows[k][0]], run: c.a.run.id, condition: c.a.condition });
    const f = store.ui.focus;
    const focus = f?.kind === 'variant' && f.run === c.a.run.id ? c.rows.findIndex(([i]) => va.keys[i] === f.id) : -1;
    const yLabel = c.flipped ? `${c.b.label} (negated)` : c.b.label;
    const ba = c.statistics.blandAltman;
    const files = comparisonFiles(app, c);
    const used = CLASSES.filter(([, , color], idx) => kinds.some((k) => classOf(k) === idx));
    return h('div.pane', h('h3', icon('compare'), 'Agreement'),
      plotPairs({ x: c.x, y: c.y, kinds, xLabel: c.a.label, yLabel, label: `${c.b.label} against ${c.a.label}: one point per variant scored on both sides${c.sameScale ? ', with the line y = x' : ''}`, diagonal: c.sameScale, pick, name, focus }),
      legend(used.map(([label, , color]) => ({ label, color: categoricalColor(color) }))),
      h('p.muted', { style: { fontSize: '11.5px', margin: '4px 0 8px' } }, `Click a point to see the variant in the inspector (as ${c.a.label} scored it).${c.sameScale ? ' The dashed line is y = x: on it, the two agree.' : ''}`),
      statisticsTable(c),
      ba ? h('div', { style: { marginTop: '12px' } },
        h('h4', 'Bland–Altman'),
        plotPairs({ x: Float64Array.from(c.x, (v, k) => (v + c.y[k]) / 2), y: Float64Array.from(c.x, (v, k) => v - c.y[k]), kinds, xLabel: 'mean of the two', yLabel: 'first − second', label: 'Each variant\'s difference against its mean, with the bias and the limits of agreement', lines: [{ y: ba.bias }, { y: ba.lower, dash: [4, 3] }, { y: ba.upper, dash: [4, 3] }], pick, name, height: 240, focus }),
        h('p.muted', { style: { fontSize: '11.5px', margin: '4px 0 0' } }, `The solid line is the bias (${fmt(ba.bias)}); between the dashed lines (${fmt(ba.lower)} to ${fmt(ba.upper)}) lie 95% of the differences, if they are normal.`)) : null,
      h('div.btn-row', { style: { marginTop: '12px' } },
        h('button.btn', { type: 'button', onclick: () => downloadBlob(new Blob([files.csv.text], { type: 'text/csv' }), files.csv.name) }, icon('download'), 'Matched variants (CSV)'),
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
    const label = (spec) => {
      const run = ws.runs.find((r) => r.id === spec.run);
      return sideOptions(run).find((o) => sameSpec(o.spec, spec))?.label ?? run.name;
    };
    root.append(h('div.workbench-head', h('h1', icon('compare'), 'Compare', pair ? h('span.crumbs', ` · ${label(pair.a)} and ${label(pair.b)}`) : null), h('span.spacer')));
    if (!pair) {
      empty('Two sets of scores side by side: two replicates, two conditions, or two runs (a rescoring, or a MaveDB record\'s published scores against its counts scored again), with what their comparison can mean and how well they agree. Score a run with replicates first.');
      return;
    }
    const options = ws.runs.flatMap((r) => sideOptions(r));
    const swap = h('button.btn', { type: 'button', title: 'Swap the two sides', onclick: () => setPair(app, { a: pair.b, b: pair.a }) }, icon('swap'), 'Swap');
    const sides = h('div.pane', h('h3', icon('compare'), 'Sides'), sideSelect('a', pair, options), sideSelect('b', pair, options), h('div.btn-row', swap));
    const left = h('div', sides);
    const right = h('div');
    root.append(h('div.view-body', h('div.split.compare-split', left, right)));
    const runs = [pair.a, pair.b].map((s) => ws.runs.find((r) => r.id === s.run));
    const entries = runs.map((r) => runEntry(app, r));
    if (entries.every((e) => e?.results)) {
      show(comparisonOf(ws, runs, entries.map((e) => e.results), pair), left, right);
      return;
    }
    right.append(h('div.pane', h('p.muted', { style: { margin: 0 } }, `Recomputing the scores of ${[...new Set(runs.filter((r, i) => !entries[i]?.results).map((r) => r.name))].join(' and ')} from their recorded inputs…`)));
    const mine = ++token;
    computeComparison(app, pair).then(() => {
      if (mine === token) render();
    });
  }

  function show(c, left, right) {
    if (c.error) {
      right.append(h('div.pane', h('div.callout.danger', icon('warning'), h('span', c.error))));
      return;
    }
    left.append(reportPane(c));
    if (c.statistics) right.append(agreementPane(c));
    else right.append(h('div.pane', h('h3', icon('compare'), 'Agreement'), h('p.muted', { style: { margin: 0 } }, 'Nothing to measure: the report says why these two cannot be compared.')));
  }

  render();
  return {
    update(topics) {
      if (topics.has('ws') || topics.has('results') || topics.has('workspace-loaded') || topics.has('compare') || topics.has('focus') || topics.has('colors') || topics.has('theme')) render();
    },
    destroy() {
      token += 1;
      root.remove();
    },
  };
}
