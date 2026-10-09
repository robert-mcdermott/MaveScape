// Small plots for the QC and Score views: bars, lines, scatter, class histograms, the filter flow
// and the coverage grid. SVG (canvas for many points and for the grid), themed with the page's
// CSS variables, each with an aria-label that says what it shows; the views give the numbers in
// text or a table beside each plot.

import { h, formatCount } from './dom.js';
import { categoricalColor } from '../lib/colormaps.js';
import { median } from '../lib/stats.js';
import { KIND } from '../lib/variants.js';

const NS = 'http://www.w3.org/2000/svg';
const fmt = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '—');
export const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function svg(width, height, label, className = 'plot') {
  const el = document.createElementNS(NS, 'svg');
  el.setAttribute('viewBox', `0 0 ${width} ${height}`);
  el.setAttribute('class', className);
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', label);
  el.add = (name, attrs = {}, text = null) => {
    const node = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (text !== null) node.textContent = text;
    el.append(node);
    return node;
  };
  return el;
}

// Tick values for a range: about n "nice" numbers.
export function ticks(lo, hi, n = 5) {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}
const logTicks = (lo, hi) => {
  const out = [];
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e += 1) out.push(10 ** e);
  return out.filter((v) => v >= lo / 1.0001 && v <= hi * 1.0001);
};
const tickText = (v) => (Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-2 && v !== 0) ? v.toExponential(0).replace('e+', 'e') : String(Number(v.toPrecision(3))));

// Axes on an SVG: returns scale functions.
function axes(el, { W, H, pad, x, y, xLabel, yLabel }) {
  const sx = x.log ? (v) => pad.l + ((Math.log10(v) - Math.log10(x.lo)) / (Math.log10(x.hi) - Math.log10(x.lo))) * (W - pad.l - pad.r) : (v) => pad.l + ((v - x.lo) / (x.hi - x.lo || 1)) * (W - pad.l - pad.r);
  const sy = y.log ? (v) => H - pad.b - ((Math.log10(v) - Math.log10(y.lo)) / (Math.log10(y.hi) - Math.log10(y.lo))) * (H - pad.t - pad.b) : (v) => H - pad.b - ((v - y.lo) / (y.hi - y.lo || 1)) * (H - pad.t - pad.b);
  el.add('line', { x1: pad.l, x2: W - pad.r, y1: H - pad.b, y2: H - pad.b, class: 'axis' });
  el.add('line', { x1: pad.l, x2: pad.l, y1: pad.t, y2: H - pad.b, class: 'axis' });
  for (const v of x.ticks ?? (x.log ? logTicks(x.lo, x.hi) : ticks(x.lo, x.hi))) el.add('text', { x: sx(v), y: H - pad.b + 13, 'text-anchor': 'middle', class: 'tick' }, tickText(v));
  for (const v of y.ticks ?? (y.log ? logTicks(y.lo, y.hi) : ticks(y.lo, y.hi, 4))) {
    el.add('line', { x1: pad.l, x2: W - pad.r, y1: sy(v), y2: sy(v), class: 'grid' });
    el.add('text', { x: pad.l - 4, y: sy(v) + 3, 'text-anchor': 'end', class: 'tick' }, tickText(v));
  }
  if (xLabel) el.add('text', { x: (pad.l + W - pad.r) / 2, y: H - 3, 'text-anchor': 'middle', class: 'axis-label' }, xLabel);
  if (yLabel) el.add('text', { x: 10, y: (pad.t + H - pad.b) / 2, 'text-anchor': 'middle', class: 'axis-label', transform: `rotate(-90 10 ${(pad.t + H - pad.b) / 2})` }, yLabel);
  return { sx, sy };
}

export function legend(items) {
  return h('div.legend', ...items.map((x) => h('span.legend-item', h(`span.swatch${x.dash ? '.dashed' : ''}`, { style: x.dash ? { borderTopColor: x.color } : { background: x.color } }), x.label)));
}

// Horizontal bars, one per item ({ label, value, status }), with threshold lines.
export function barChart({ items, log = false, lines = [], label, unit = '', format = (v) => fmt(v, 2) }) {
  const W = 560;
  const row = 20;
  const pad = { l: 170, r: 64, t: 6, b: 22 };
  const H = pad.t + pad.b + row * items.length;
  const values = items.map((x) => x.value).filter((v) => Number.isFinite(v) && (!log || v > 0));
  const all = [...values, ...lines.map((l) => l.value)].filter((v) => !log || v > 0);
  const lo = log ? Math.min(...all) / 1.5 : 0;
  const hi = Math.max(...all, log ? lo * 10 : 1e-9) * (log ? 1.5 : 1.05);
  const el = svg(W, H, label);
  const { sx } = axes(el, { W, H, pad, x: { lo, hi, log }, y: { lo: 0, hi: 1, ticks: [] } });
  items.forEach((x, i) => {
    const y = pad.t + i * row + 3;
    el.add('text', { x: pad.l - 6, y: y + 11, 'text-anchor': 'end', class: 'bar-label' }, x.label.length > 26 ? `${x.label.slice(0, 25)}…` : x.label);
    if (Number.isFinite(x.value) && (!log || x.value > 0)) {
      el.add('rect', { x: pad.l, y, width: Math.max(1, sx(x.value) - pad.l), height: row - 6, class: `bar ${x.status ?? ''}` });
      el.add('text', { x: sx(x.value) + 4, y: y + 11, class: 'bar-value' }, `${format(x.value)}${unit}`);
    } else {
      el.add('text', { x: pad.l + 4, y: y + 11, class: 'bar-value' }, 'none');
    }
  });
  for (const l of lines) {
    const x = sx(l.value);
    el.add('line', { x1: x, x2: x, y1: pad.t, y2: H - pad.b, class: `threshold ${l.kind}` });
  }
  return el;
}

// Lines ({ label, points: [[x, y]], color, dash }) on linear or log axes.
export function lineChart({ series, xLog = false, yLog = false, xLabel, yLabel, label, width = 560, height = 220, extra = null }) {
  const pad = { l: 52, r: 12, t: 8, b: 34 };
  const xs = series.flatMap((s) => s.points.map((p) => p[0])).filter((v) => Number.isFinite(v) && (!xLog || v > 0));
  const ys = series.flatMap((s) => s.points.map((p) => p[1])).filter((v) => Number.isFinite(v) && (!yLog || v > 0));
  if (!xs.length || !ys.length) return h('p.muted', 'Nothing to draw.');
  const span = (v, log) => {
    let lo = Math.min(...v);
    let hi = Math.max(...v);
    if (log) return [lo / 1.3, hi * 1.3];
    if (lo === hi) { lo -= 1; hi += 1; }
    const m = (hi - lo) * 0.05;
    return [lo - m, hi + m];
  };
  const [x0, x1] = span(xs, xLog);
  const [y0, y1] = span(ys, yLog);
  const el = svg(width, height, label);
  const { sx, sy } = axes(el, { W: width, H: height, pad, x: { lo: x0, hi: x1, log: xLog }, y: { lo: y0, hi: y1, log: yLog }, xLabel, yLabel });
  for (const s of series) {
    const pts = s.points.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y) && (!xLog || x > 0) && (!yLog || y > 0));
    if (!pts.length) continue;
    el.add('path', { d: pts.map(([x, y], i) => `${i ? 'L' : 'M'}${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join(' '), fill: 'none', stroke: s.color, 'stroke-width': s.width ?? 2, 'stroke-dasharray': s.dash ? '4 3' : 'none' });
    if (s.markers) for (const [x, y] of pts) el.add('circle', { cx: sx(x), cy: sy(y), r: 3, fill: s.color });
  }
  extra?.(el, sx, sy);
  return el;
}

// Many points on a canvas: [[x, y, group]], colors by group, an optional y = x line.
export function scatter({ points, xLabel, yLabel, label, colorOf = () => cssVar('--accent'), diagonal = false, width = 560, height = 300 }) {
  const wrap = h('div.plot-canvas', { role: 'img', 'aria-label': label });
  const canvas = h('canvas', { width: width * 2, height: height * 2, style: { width: '100%', height: 'auto' } });
  wrap.append(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx || !points.length) return wrap;
  ctx.scale(2, 2);
  const pad = { l: 52, r: 12, t: 8, b: 34 };
  const xs = points.map((p) => p[0]).filter(Number.isFinite);
  const ys = points.map((p) => p[1]).filter(Number.isFinite);
  let [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
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
  ctx.textAlign = 'center';
  for (const v of ticks(x0, x1)) ctx.fillText(tickText(v), sx(v), height - pad.b + 13);
  ctx.textAlign = 'right';
  for (const v of ticks(y0, y1, 4)) ctx.fillText(tickText(v), pad.l - 4, sy(v) + 3);
  ctx.textAlign = 'center';
  if (xLabel) ctx.fillText(xLabel, (pad.l + width - pad.r) / 2, height - 3);
  if (yLabel) {
    ctx.save();
    ctx.translate(10, (pad.t + height - pad.b) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(yLabel, 0, 0);
    ctx.restore();
  }
  if (diagonal) {
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(sx(x0), sy(y0));
    ctx.lineTo(sx(x1), sy(y1));
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.globalAlpha = points.length > 1500 ? 0.35 : 0.6;
  for (const p of points) {
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    ctx.fillStyle = colorOf(p[2]);
    ctx.fillRect(sx(p[0]) - 1.5, sy(p[1]) - 1.5, 3, 3);
  }
  return wrap;
}

// Score distributions by variant class, as density step lines (classes of fewer than 10 as
// ticks), with marks (the wild type). groups: [{ label, values, color }].
export function classHistogram({ groups, marks = [], label }) {
  const all = groups.flatMap((g) => g.values).filter(Number.isFinite);
  if (all.length < 2) return h('p.muted', 'Too few scores to draw.');
  const sorted = Float64Array.from(all).sort();
  const lo = sorted[Math.floor(sorted.length * 0.005)];
  const hi = sorted[Math.ceil(sorted.length * 0.995) - 1];
  const span = hi - lo || 1;
  const B = 48;
  const W = 560;
  const H = 150;
  const pad = { l: 8, r: 8, t: 8, b: 22 };
  const shown = groups.filter((g) => g.values.length).map((g) => {
    const counts = new Float64Array(B);
    for (const v of g.values) counts[Math.min(B - 1, Math.max(0, Math.floor(((v - lo) / span) * B)))] += 1;
    return { ...g, density: Array.from(counts, (c) => c / g.values.length), median: median(g.values) };
  });
  const top = Math.max(...shown.filter((g) => g.values.length >= 10).flatMap((g) => g.density), 1e-9);
  const X = (v) => pad.l + ((v - lo) / span) * (W - pad.l - pad.r);
  const Y = (d) => H - pad.b - (d / top) * (H - pad.t - pad.b);
  const el = svg(W, H, `${label}: ${shown.map((g) => `${g.label.toLowerCase()} median ${fmt(g.median)} (${g.values.length})`).join(', ')}.`, 'score-histogram');
  el.add('line', { x1: pad.l, x2: W - pad.r, y1: H - pad.b, y2: H - pad.b, class: 'axis' });
  for (let t = 0; t <= 6; t += 1) el.add('text', { x: X(lo + (t / 6) * span), y: H - 6, 'text-anchor': 'middle', class: 'tick' }, fmt(lo + (t / 6) * span, 1));
  for (const m of marks) {
    const x = X(m.value);
    if (x >= pad.l && x <= W - pad.r) el.add('line', { x1: x, x2: x, y1: pad.t, y2: H - pad.b, class: 'wt-mark' });
  }
  for (const g of shown) {
    if (g.values.length >= 10) {
      el.add('path', { d: g.density.map((d, b) => `${b ? 'L' : 'M'}${X(lo + (b / B) * span).toFixed(1)},${Y(d).toFixed(1)} L${X(lo + ((b + 1) / B) * span).toFixed(1)},${Y(d).toFixed(1)}`).join(' '), fill: 'none', stroke: g.color, 'stroke-width': 2 });
    } else {
      for (const v of g.values) el.add('line', { x1: X(Math.min(hi, Math.max(lo, v))), x2: X(Math.min(hi, Math.max(lo, v))), y1: H - pad.b - 14, y2: H - pad.b, stroke: g.color, 'stroke-width': 2 });
    }
  }
  return h('div',
    h('div.legend', ...shown.map((g) => h('span.legend-item', h('span.swatch', { style: { background: g.color } }), `${g.label} (${formatCount(g.values.length)}${g.values.length < 10 ? `, ${g.values.length === 1 ? 'a tick' : 'ticks'}` : ''}): median ${fmt(g.median)}`)),
      ...marks.map((m) => h('span.legend-item', h('span.swatch.wt'), m.label))),
    el);
}

// The scored variants of one condition by class (synonymous, nonsense, missense, other).
export function scoreGroups(c, kinds, rows) {
  const named = new Set([KIND.SYNONYMOUS, KIND.NONSENSE, KIND.MISSENSE, KIND.WT]);
  const classes = [['Synonymous', (k) => k === KIND.SYNONYMOUS, 0], ['Nonsense', (k) => k === KIND.NONSENSE, 1], ['Missense', (k) => k === KIND.MISSENSE, 2], ['Other', (k) => !named.has(k), 3]];
  return classes.map(([label, test, color]) => {
    const values = [];
    for (let i = 0; i < rows; i += 1) if (!c.reason[i] && test(kinds[i]) && Number.isFinite(c.score[i])) values.push(c.score[i]);
    return { label, values, color: categoricalColor(color) };
  });
}

// The filter flow as bars: each stage, what remains after it and what it removed.
export function flowBars(flow, describe = () => '') {
  const total = flow.length ? flow[0].remaining + flow[0].removed : 0;
  return h('div.flow', ...flow.map((x) => h('div.flow-row', { title: x.removed ? describe(x) : '' },
    h('span.flow-label', x.label),
    h('span.flow-bar', h('span', { style: { width: `${total ? (x.remaining / total) * 100 : 0}%` } })),
    h('span.flow-count', formatCount(x.remaining)),
    h('span.flow-removed', x.removed ? `−${formatCount(x.removed)}` : ''))));
}

// Coverage: positions across, the 20 amino acids and stop down (biochemical order), on a canvas;
// hover names the cell.
const ROWS = 'GAVLIMFWPSTCYNQDEKRH*';
const CODES = 'ARNDCQEGHILKMFPSTWYV*';
export function coverageGrid(coverage) {
  const { grid, length, offset } = coverage;
  const wrap = h('div.coverage-grid');
  const cell = Math.max(2, Math.min(10, Math.floor(1100 / length)));
  const W = length * cell;
  const H = 21 * 8;
  const canvas = h('canvas', { width: W * 2, height: H * 2, style: { width: `${W}px`, height: `${H}px` }, role: 'img', 'aria-label': `Coverage: ${coverage.observed} of ${coverage.designed} designed substitutions observed across ${length} positions.` });
  const tip = h('div.coverage-tip', ' ');
  const ctx = canvas.getContext('2d');
  const colors = [cssVar('--line'), cssVar('--warn'), cssVar('--accent'), cssVar('--text-2'), 'transparent'];
  if (ctx) {
    ctx.scale(2, 2);
    for (let p = 0; p < length; p += 1) {
      for (let r = 0; r < 21; r += 1) {
        const g = grid[p * 21 + CODES.indexOf(ROWS[r])];
        if (g === 4) continue;
        ctx.fillStyle = colors[g];
        ctx.fillRect(p * cell, r * 8, Math.max(1, cell - (cell > 3 ? 1 : 0)), 7);
      }
    }
  }
  const STATES = ['designed, not in the table', 'in the table, no reads before selection', 'observed', 'the reference residue', 'outside the tiles'];
  canvas.addEventListener('mousemove', (event) => {
    const rect = canvas.getBoundingClientRect();
    const p = Math.floor((event.clientX - rect.left) / cell);
    const r = Math.floor((event.clientY - rect.top) / 8);
    if (p < 0 || p >= length || r < 0 || r > 20) return;
    tip.textContent = `Position ${p + 1}${offset ? ` (reference ${p + 1 + offset})` : ''}, ${ROWS[r] === '*' ? 'stop' : ROWS[r]}: ${STATES[grid[p * 21 + CODES.indexOf(ROWS[r])]]}`;
  });
  wrap.append(h('div.coverage-rows', ...[...ROWS].map((r) => h('span', r === '*' ? '*' : r))), h('div', { style: { overflowX: 'auto' } }, canvas), tip,
    legend([{ label: 'observed', color: colors[2] }, { label: 'no reads before selection', color: colors[1] }, { label: 'not in the table', color: colors[0] }, { label: 'reference', color: colors[3] }]));
  return wrap;
}
