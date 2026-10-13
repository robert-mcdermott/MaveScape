// The plots of the views as marks (wave 6, slice 2; requirement R5): bars, lines, scatters, score
// distributions by class, the filter flow, coverage, disagreement by position, a predictor's
// classes as boxes, a variant's evidence, and their legends. Pure: the views draw them (ui/plots.js
// renders the marks in the page, in the page's colors) and figures draw the same plots at a
// figure's size and text size (lib/figure-plots.js), in Node as in the page.
//
// Every plot takes its data and a frame: { x, y (its top left), width, height (a figure's panel
// gives one; else the plot's own), text (the text size; 10 in the views, a figure's in points),
// theme (colors by name: PLOT_LIGHT, or the page's) }. It returns { marks, width, height,
// description, legend? ([{ label, color, dash, mark }]), hits? (where things are, for a page to
// pick them) }.

import { ellipsizeText, textWidth } from './draw.js';
import { median } from './stats.js';
import { log10, pow } from './dmath.js';

// The light theme's colors (web/styles.css), as figures print them.
export const PLOT_LIGHT = {
  background: '#ffffff', text: '#171b26', label: '#4b5468', muted: '#636c7e', axis: '#d0d6e2', grid: '#e3e7ef',
  accent: '#5b4ce6', warn: '#c27a00', danger: '#d63b4a', ok: '#138a52',
};

const fmt = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '—');
const finite = (v) => Number.isFinite(v);

// Tick values for a range: about n "nice" numbers.
export function ticks(lo, hi, n = 5) {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / n;
  const mag = pow(10, Math.floor(log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out = [];
  // Each tick a whole multiple of the step, so that 0 is 0 (not the sum of steps, −5.55e-17).
  for (let k = Math.ceil(lo / step); k * step <= hi + step * 1e-9; k += 1) out.push(Number((k * step).toPrecision(12)));
  return out;
}

export function logTicks(lo, hi) {
  const out = [];
  for (let e = Math.floor(log10(lo)); e <= Math.ceil(log10(hi)); e += 1) out.push(Number(pow(10, e).toPrecision(12)));
  return out.filter((v) => v >= lo / 1.0001 && v <= hi * 1.0001);
}

export const tickText = (v) => (Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-2 && v !== 0) ? v.toExponential(0).replace('e+', 'e') : String(Number(v.toPrecision(3))));

function frameOf(frame = {}) {
  return { x: frame.x ?? 0, y: frame.y ?? 0, width: frame.width, height: frame.height ?? null, text: frame.text ?? 10, theme: frame.theme ?? PLOT_LIGHT };
}

// Axes: the x and y lines, ticks, grid lines across, and the labels. a: { left, right, top,
// bottom } of the plot area; x, y: { lo, hi, log, ticks (a list, or [] for none) }. Returns the
// scales { sx, sy }.
function axes(marks, a, { x, y, xLabel, yLabel, t, theme, grid = true, frame }) {
  const k = t / 10;
  const span = (s) => (s.log ? [log10(s.lo), log10(s.hi)] : [s.lo, s.hi]);
  const [xl, xh] = span(x);
  const [yl, yh] = span(y);
  const sx = (v) => a.left + (((x.log ? log10(v) : v) - xl) / (xh - xl || 1)) * (a.right - a.left);
  const sy = (v) => a.bottom - (((y.log ? log10(v) : v) - yl) / (yh - yl || 1)) * (a.bottom - a.top);
  marks.push({ type: 'line', x1: a.left, y1: a.bottom, x2: a.right, y2: a.bottom, stroke: theme.axis, width: k });
  marks.push({ type: 'line', x1: a.left, y1: a.top, x2: a.left, y2: a.bottom, stroke: theme.axis, width: k });
  // Ticks thinned to every other (or fewer) where their labels would crowd.
  const thin = (list, room, need) => {
    if (list.length < 3 || room / (list.length - 1) >= need) return list;
    const step = Math.ceil((need * (list.length - 1)) / room);
    return list.filter((_, i) => i % step === 0);
  };
  const xTicks = x.ticks ?? (x.log ? logTicks(x.lo, x.hi) : ticks(x.lo, x.hi));
  const yTicks = y.ticks ?? (y.log ? logTicks(y.lo, y.hi) : ticks(y.lo, y.hi, 4));
  const widest = Math.max(0, ...xTicks.map((v) => textWidth(tickText(v), t)));
  for (const v of thin(xTicks, a.right - a.left, widest + 0.8 * t)) marks.push({ type: 'text', x: sx(v), y: a.bottom + 1.3 * t, text: tickText(v), size: t, fill: theme.muted, anchor: 'middle' });
  for (const v of thin(yTicks, a.bottom - a.top, 1.3 * t)) {
    if (grid) marks.push({ type: 'line', x1: a.left, y1: sy(v), x2: a.right, y2: sy(v), stroke: theme.grid, width: k, dash: [2 * k, 3 * k] });
    marks.push({ type: 'text', x: a.left - 0.4 * t, y: sy(v), text: tickText(v), size: t, fill: theme.muted, anchor: 'end', baseline: 'middle' });
  }
  const size = t * 1.05;
  if (xLabel) marks.push({ type: 'text', x: (a.left + a.right) / 2, y: frame.y + frame.height - 0.3 * t, text: ellipsizeText(xLabel, a.right - a.left, size), size, fill: theme.label, anchor: 'middle' });
  if (yLabel) {
    const cy = (a.top + a.bottom) / 2;
    marks.push({ type: 'text', x: frame.x + 1.1 * t, y: cy, text: ellipsizeText(yLabel, a.bottom - a.top, size), size, fill: theme.label, anchor: 'middle', rotate: -90 });
  }
  return { sx, sy };
}

const statusColor = (status, theme) => (status === 'fail' ? theme.danger : status === 'review' ? theme.warn : theme.accent);
const lineColor = (kind, theme) => (kind === 'fail' ? theme.danger : kind === 'review' ? theme.warn : theme.muted);

// --- Bars ---------------------------------------------------------------------------------------------

// Horizontal bars, one per item ({ label, value, status: '' | 'review' | 'fail' }), on a linear or
// log axis, with threshold lines ({ value, kind: 'review' | 'fail' | 'reference' }).
export function barChart(spec, frame) {
  const { items, log = false, lines = [], label = '', unit = '', format = (v) => fmt(v, 2) } = spec;
  const f = frameOf(frame);
  const t = f.text;
  const k = t / 10;
  const theme = f.theme;
  const W = f.width ?? 560;
  const values = items.map((x) => x.value).filter((v) => finite(v) && (!log || v > 0));
  const all = [...values, ...lines.map((l) => l.value)].filter((v) => !log || v > 0);
  const lo = log ? Math.min(...all) / 1.5 : 0;
  const hi = Math.max(...all, log ? lo * 10 : 1e-9) * (log ? 1.5 : 1.05);
  const labelSize = t * 1.1;
  const valueText = (x) => (finite(x.value) && (!log || x.value > 0) ? `${format(x.value)}${unit}` : 'none');
  const pad = {
    l: Math.min(W * 0.45, Math.max(...items.map((x) => textWidth(x.label, labelSize)), 0) + 0.6 * t),
    r: Math.max(...items.map((x) => textWidth(valueText(x), t)), 0) + 0.8 * t,
    t: 0.6 * t,
    b: 2.2 * t,
  };
  const H = f.height ?? pad.t + pad.b + 2 * t * items.length;
  const row = (H - pad.t - pad.b) / Math.max(1, items.length);
  const size = Math.min(labelSize, row * 0.8);
  const marks = [];
  const area = { left: f.x + pad.l, right: f.x + W - pad.r, top: f.y + pad.t, bottom: f.y + H - pad.b };
  const { sx } = axes(marks, area, { x: { lo, hi, log }, y: { lo: 0, hi: 1, ticks: [] }, t, theme, grid: false, frame: { ...f, width: W, height: H } });
  const bars = [];
  items.forEach((x, i) => {
    const y = area.top + i * row + row * 0.15;
    const h = row * 0.7;
    marks.push({ type: 'text', x: area.left - 0.6 * t, y: y + h / 2, text: ellipsizeText(x.label, pad.l - 0.6 * t, size), size, fill: theme.label, anchor: 'end', baseline: 'middle', title: x.label });
    if (finite(x.value) && (!log || x.value > 0)) {
      const w = Math.max(k, sx(x.value) - area.left);
      marks.push({ type: 'rect', x: area.left, y, w, h, fill: statusColor(x.status, theme), opacity: x.status ? 1 : 0.85, title: `${x.label}: ${valueText(x)}` });
      marks.push({ type: 'text', x: area.left + w + 0.4 * t, y: y + h / 2, text: valueText(x), size: Math.min(t * 1.05, row * 0.8), fill: theme.label, baseline: 'middle' });
      bars.push({ label: x.label, value: x.value });
    } else {
      marks.push({ type: 'text', x: area.left + 0.4 * t, y: y + h / 2, text: 'none', size: Math.min(t * 1.05, row * 0.8), fill: theme.label, baseline: 'middle' });
      bars.push({ label: x.label, value: null });
    }
  });
  for (const l of lines) {
    const x = sx(l.value);
    marks.push({ type: 'line', x1: x, y1: area.top, x2: x, y2: area.bottom, stroke: lineColor(l.kind, theme), width: 1.5 * k, dash: [4 * k, 3 * k] });
  }
  return { marks, width: W, height: H, description: label, bars };
}

// --- Lines --------------------------------------------------------------------------------------------

// Lines ({ label, points: [[x, y]], color, dash, width, markers }) on linear or log axes, with
// vertical lines ({ value, kind }).
export function lineChart(spec, frame) {
  const { series, xLog = false, yLog = false, xLabel, yLabel, label = '', vlines = [] } = spec;
  const f = frameOf(frame);
  const t = f.text;
  const k = t / 10;
  const theme = f.theme;
  const W = f.width ?? 560;
  const H = f.height ?? 220 * k;
  const xs = series.flatMap((s) => s.points.map((p) => p[0])).filter((v) => finite(v) && (!xLog || v > 0));
  const ys = series.flatMap((s) => s.points.map((p) => p[1])).filter((v) => finite(v) && (!yLog || v > 0));
  const marks = [];
  if (!xs.length || !ys.length) {
    marks.push({ type: 'text', x: f.x + W / 2, y: f.y + H / 2, text: 'Nothing to draw.', size: t, fill: theme.muted, anchor: 'middle', baseline: 'middle' });
    return { marks, width: W, height: H, description: label, empty: true };
  }
  const range = (v, log) => {
    let lo = Math.min(...v);
    let hi = Math.max(...v);
    if (log) return [lo / 1.3, hi * 1.3];
    if (lo === hi) {
      lo -= 1;
      hi += 1;
    }
    const m = (hi - lo) * 0.05;
    return [lo - m, hi + m];
  };
  const [x0, x1] = range(xs, xLog);
  const [y0, y1] = range(ys, yLog);
  const area = { left: f.x + 5.2 * t, right: f.x + W - 1.2 * t, top: f.y + 0.8 * t, bottom: f.y + H - 3.4 * t };
  const { sx, sy } = axes(marks, area, { x: { lo: x0, hi: x1, log: xLog }, y: { lo: y0, hi: y1, log: yLog }, xLabel, yLabel, t, theme, frame: { ...f, width: W, height: H } });
  const drawn = [];
  for (const s of series) {
    const pts = s.points.filter(([x, y]) => finite(x) && finite(y) && (!xLog || x > 0) && (!yLog || y > 0));
    if (!pts.length) continue;
    const width = (s.width ?? 2) * k;
    if (width > 0 && pts.length > 1) marks.push({ type: 'path', d: pts.map(([x, y], i) => `${i ? 'L' : 'M'}${sx(x)} ${sy(y)}`).join(''), fill: 'none', stroke: s.color, width, dash: s.dash ? [4 * k, 3 * k] : undefined, title: s.label });
    if (s.markers || width === 0 || pts.length === 1) for (const [x, y] of pts) marks.push({ type: 'circle', x: sx(x), y: sy(y), r: 3 * k, fill: s.color });
    drawn.push({ label: s.label ?? null, points: pts });
  }
  for (const v of vlines) {
    if (!finite(v.value) || (xLog && v.value <= 0)) continue;
    const x = sx(v.value);
    marks.push({ type: 'line', x1: x, y1: area.top, x2: x, y2: area.bottom, stroke: lineColor(v.kind, theme), width: 1.5 * k, dash: [4 * k, 3 * k] });
  }
  return { marks, width: W, height: H, description: label, series: drawn };
}

// --- Scatter ------------------------------------------------------------------------------------------

// Points ([x, y, key]) colored by key (colorOf(key)), with an optional y = x line, horizontal lines
// ({ y, dash }) and a point ringed (focus: its index). Returns hits: { px, py } of every point.
export function scatter(spec, frame) {
  const { points, xLabel, yLabel, label = '', colorOf = () => null, diagonal = false, lines = [], focus = -1, size = 3 } = spec;
  const f = frameOf(frame);
  const t = f.text;
  const k = t / 10;
  const theme = f.theme;
  const W = f.width ?? 560;
  const H = f.height ?? 300 * k;
  const marks = [];
  const xs = points.map((p) => p[0]).filter(finite);
  const ys = points.map((p) => p[1]).filter(finite);
  if (!xs.length || !ys.length) {
    marks.push({ type: 'text', x: f.x + W / 2, y: f.y + H / 2, text: 'Nothing to draw.', size: t, fill: theme.muted, anchor: 'middle', baseline: 'middle' });
    return { marks, width: W, height: H, description: label, hits: { px: new Float32Array(0), py: new Float32Array(0) }, empty: true };
  }
  let [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  for (const l of lines) {
    if (finite(l.y)) {
      y0 = Math.min(y0, l.y);
      y1 = Math.max(y1, l.y);
    }
  }
  if (diagonal) {
    x0 = y0 = Math.min(x0, y0);
    x1 = y1 = Math.max(x1, y1);
  }
  const mx = (x1 - x0) * 0.04 || 1;
  const my = (y1 - y0) * 0.04 || 1;
  x0 -= mx;
  x1 += mx;
  y0 -= my;
  y1 += my;
  const area = { left: f.x + 5.2 * t, right: f.x + W - 1.2 * t, top: f.y + 0.8 * t, bottom: f.y + H - 3.4 * t };
  const { sx, sy } = axes(marks, area, { x: { lo: x0, hi: x1 }, y: { lo: y0, hi: y1 }, xLabel, yLabel, t, theme, grid: false, frame: { ...f, width: W, height: H } });
  if (diagonal) marks.push({ type: 'line', x1: sx(x0), y1: sy(y0), x2: sx(x1), y2: sy(y1), stroke: theme.muted, width: k, dash: [4 * k, 3 * k] });
  for (const l of lines) if (finite(l.y)) marks.push({ type: 'line', x1: sx(x0), y1: sy(l.y), x2: sx(x1), y2: sy(l.y), stroke: theme.muted, width: k, dash: l.dash ? l.dash.map((d) => d * k) : undefined });
  const opacity = points.length > 1500 ? 0.4 : 0.65;
  const px = new Float32Array(points.length);
  const py = new Float32Array(points.length);
  const s = size * k;
  const dots = [];
  points.forEach((p, i) => {
    if (!finite(p[0]) || !finite(p[1])) {
      px[i] = Number.NaN;
      py[i] = Number.NaN;
      return;
    }
    px[i] = sx(p[0]);
    py[i] = sy(p[1]);
    dots.push({ type: 'rect', x: px[i] - s / 2, y: py[i] - s / 2, w: s, h: s, fill: colorOf(p[2]) ?? theme.accent, opacity });
  });
  marks.push({ type: 'group', label: 'points', marks: dots });
  if (focus >= 0 && finite(px[focus])) marks.push({ type: 'circle', x: px[focus], y: py[focus], r: 5 * k, fill: 'none', stroke: theme.text, width: 1.5 * k });
  return { marks, width: W, height: H, description: label, hits: { px, py }, drawn: dots.length };
}

// --- Score distributions --------------------------------------------------------------------------------

// Score distributions by class as density step lines (classes of fewer than 10 as ticks), with
// marks (the wild type). groups: [{ label, values, color }]; marks: [{ value, label }].
export function classHistogram(spec, frame) {
  const { groups, marks: lines = [], label = '' } = spec;
  const f = frameOf(frame);
  const t = f.text;
  const k = t / 10;
  const theme = f.theme;
  const W = f.width ?? 560;
  const H = f.height ?? 150 * k;
  const all = groups.flatMap((g) => g.values).filter(finite);
  const marks = [];
  if (all.length < 2) {
    marks.push({ type: 'text', x: f.x + W / 2, y: f.y + H / 2, text: 'Too few scores to draw.', size: t, fill: theme.muted, anchor: 'middle', baseline: 'middle' });
    return { marks, width: W, height: H, description: label, legend: [], groups: [], empty: true };
  }
  const sorted = Float64Array.from(all).sort();
  const lo = sorted[Math.floor(sorted.length * 0.005)];
  const hi = sorted[Math.ceil(sorted.length * 0.995) - 1];
  const span = hi - lo || 1;
  const B = 48;
  const area = { left: f.x + 0.8 * t, right: f.x + W - 0.8 * t, top: f.y + 0.8 * t, bottom: f.y + H - 2.2 * t };
  const shown = groups.filter((g) => g.values.length).map((g) => {
    const counts = new Float64Array(B);
    for (const v of g.values) counts[Math.min(B - 1, Math.max(0, Math.floor(((v - lo) / span) * B)))] += 1;
    return { ...g, density: Array.from(counts, (c) => c / g.values.length), median: median(g.values) };
  });
  const top = Math.max(...shown.filter((g) => g.values.length >= 10).flatMap((g) => g.density), 1e-9);
  const X = (v) => area.left + ((v - lo) / span) * (area.right - area.left);
  const Y = (d) => area.bottom - (d / top) * (area.bottom - area.top);
  marks.push({ type: 'line', x1: area.left, y1: area.bottom, x2: area.right, y2: area.bottom, stroke: theme.axis, width: k });
  for (let i = 0; i <= 6; i += 1) marks.push({ type: 'text', x: X(lo + (i / 6) * span), y: f.y + H - 0.6 * t, text: fmt(lo + (i / 6) * span, 1), size: t, fill: theme.muted, anchor: 'middle' });
  for (const m of lines) {
    const x = X(m.value);
    if (x >= area.left && x <= area.right) marks.push({ type: 'line', x1: x, y1: area.top, x2: x, y2: area.bottom, stroke: theme.text, width: 1.5 * k, dash: [3 * k, 2 * k] });
  }
  for (const g of shown) {
    if (g.values.length >= 10) {
      marks.push({ type: 'path', d: g.density.map((d, b) => `${b ? 'L' : 'M'}${X(lo + (b / B) * span)} ${Y(d)}L${X(lo + ((b + 1) / B) * span)} ${Y(d)}`).join(''), fill: 'none', stroke: g.color, width: 2 * k, title: g.label });
    } else {
      for (const v of g.values) {
        const x = X(Math.min(hi, Math.max(lo, v)));
        marks.push({ type: 'line', x1: x, y1: area.bottom - 1.4 * t, x2: x, y2: area.bottom, stroke: g.color, width: 2 * k });
      }
    }
  }
  const count = (n) => n.toLocaleString('en-US');
  const legend = [
    ...shown.map((g) => ({ label: `${g.label} (${count(g.values.length)}${g.values.length < 10 ? `, ${g.values.length === 1 ? 'a tick' : 'ticks'}` : ''}): median ${fmt(g.median)}`, color: g.color })),
    ...lines.map((m) => ({ label: m.label, color: theme.text, dash: true, mark: 'line' })),
  ];
  const description = `${label}: ${shown.map((g) => `${g.label.toLowerCase()} median ${fmt(g.median)} (${g.values.length})`).join(', ')}.`;
  return { marks, width: W, height: H, description, legend, groups: shown.map((g) => ({ label: g.label, n: g.values.length, median: g.median, density: g.density })), range: [lo, hi] };
}

// --- The filter flow ----------------------------------------------------------------------------------

// The filter flow as bars: each stage ({ label, remaining, removed }), what remains after it and
// what it removed.
export function flowBars(flow, frame) {
  const f = frameOf(frame);
  const t = f.text;
  const k = t / 10;
  const theme = f.theme;
  const W = f.width ?? 560;
  const total = flow.length ? flow[0].remaining + flow[0].removed : 0;
  const count = (n) => n.toLocaleString('en-US');
  const labelW = Math.min(W * 0.42, Math.max(...flow.map((x) => textWidth(x.label, t)), 0) + 0.8 * t);
  const countW = Math.max(...flow.map((x) => textWidth(count(x.remaining), t)), 0) + 0.8 * t;
  const removedW = Math.max(...flow.map((x) => (x.removed ? textWidth(`−${count(x.removed)}`, t) : 0)), 0) + 0.8 * t;
  const H = f.height ?? flow.length * 2.2 * t;
  const row = H / Math.max(1, flow.length);
  const size = Math.min(t, row * 0.8);
  const barLeft = f.x + labelW;
  const barW = Math.max(10 * k, W - labelW - countW - removedW);
  const marks = [];
  flow.forEach((x, i) => {
    const y = f.y + i * row;
    const mid = y + row / 2;
    marks.push({ type: 'text', x: f.x, y: mid, text: ellipsizeText(x.label, labelW - 0.8 * t, size), size, fill: theme.label, baseline: 'middle', title: x.label });
    marks.push({ type: 'rect', x: barLeft, y: y + row * 0.2, w: barW, h: row * 0.6, fill: theme.grid });
    marks.push({ type: 'rect', x: barLeft, y: y + row * 0.2, w: total ? (x.remaining / total) * barW : 0, h: row * 0.6, fill: theme.accent, opacity: 0.85 });
    marks.push({ type: 'text', x: barLeft + barW + countW - 0.4 * t, y: mid, text: count(x.remaining), size, fill: theme.text, anchor: 'end', baseline: 'middle' });
    if (x.removed) marks.push({ type: 'text', x: f.x + W, y: mid, text: `−${count(x.removed)}`, size, fill: theme.danger, anchor: 'end', baseline: 'middle' });
  });
  return { marks, width: W, height: H, description: `The filter flow: ${flow.map((x) => `${x.label} ${count(x.remaining)}${x.removed ? ` (−${count(x.removed)})` : ''}`).join(', ')}.` };
}

// --- Coverage -----------------------------------------------------------------------------------------

// Coverage: positions across, the 20 amino acids and stop down (biochemical order), each cell
// observed, with no reads before selection, not in the table, the reference or outside the tiles.
export const COVERAGE_ROWS = 'GAVLIMFWPSTCYNQDEKRH*';
const CODES = 'ARNDCQEGHILKMFPSTWYV*';
export const COVERAGE_STATES = ['designed, not in the table', 'in the table, no reads before selection', 'observed', 'the reference residue', 'outside the tiles'];
export function coverageGrid(coverage, frame) {
  const { grid, length } = coverage;
  const f = frameOf(frame);
  const t = f.text;
  const k = t / 10;
  const theme = f.theme;
  const colors = [theme.grid, theme.warn, theme.accent, theme.label, null];
  const labelW = 1.2 * t;
  const W = f.width ?? labelW + Math.max(2, Math.min(10, Math.floor(1100 / length))) * length;
  const cellW = (W - labelW) / length;
  const H = f.height ?? 21 * 8 * k;
  const cellH = H / 21;
  const marks = [];
  const size = Math.min(t, cellH * 1.05);
  for (let r = 0; r < 21; r += 1) marks.push({ type: 'text', x: f.x + labelW - 0.3 * t, y: f.y + r * cellH + cellH / 2, text: COVERAGE_ROWS[r], size, fill: theme.muted, anchor: 'end', baseline: 'middle' });
  const cells = [];
  const gapW = cellW > 3 ? k : 0;
  for (let p = 0; p < length; p += 1) {
    for (let r = 0; r < 21; r += 1) {
      const g = grid[p * 21 + CODES.indexOf(COVERAGE_ROWS[r])];
      if (!colors[g]) continue;
      cells.push({ type: 'rect', x: f.x + labelW + p * cellW, y: f.y + r * cellH, w: Math.max(0.5 * k, cellW - gapW), h: cellH - k, fill: colors[g] });
    }
  }
  marks.push({ type: 'group', label: 'cells', marks: cells });
  const legend = [{ label: 'observed', color: colors[2] }, { label: 'no reads before selection', color: colors[1] }, { label: 'not in the table', color: colors[0] }, { label: 'reference', color: colors[3] }];
  return { marks, width: W, height: H, description: `Coverage: ${coverage.observed} of ${coverage.designed} designed substitutions observed across ${length} positions.`, legend, hits: { left: f.x + labelW, top: f.y, cellW, cellH } };
}

// --- A comparison ---------------------------------------------------------------------------------------

// Disagreement by position as bars: each position's mean difference ({ position, mean, q, … }),
// darker where its q is below `q`. hits: { left, right, length } to find a position from x.
export function positionBars(spec, frame) {
  const { list, length, label = '', q: limit = 0.05 } = spec;
  const f = frameOf(frame);
  const t = f.text;
  const k = t / 10;
  const theme = f.theme;
  const W = f.width ?? 560;
  const H = f.height ?? 150 * k;
  const area = { left: f.x + 4 * t, right: f.x + W - 0.8 * t, top: f.y + 0.8 * t, bottom: f.y + H - 2.4 * t };
  const span = Math.max(1e-9, ...list.map((x) => Math.abs(x.mean)));
  const sx = (p) => area.left + ((p - 0.5) / length) * (area.right - area.left);
  const sy = (v) => area.top + ((span - v) / (2 * span)) * (area.bottom - area.top);
  const bw = Math.max(k, (area.right - area.left) / length - 0.5 * k);
  const marks = [{ type: 'line', x1: area.left, y1: sy(0), x2: area.right, y2: sy(0), stroke: theme.axis, width: k }];
  for (const v of [-span, 0, span]) marks.push({ type: 'text', x: area.left - 0.4 * t, y: sy(v), text: String(Number(v.toPrecision(2))), size: t * 0.9, fill: theme.muted, anchor: 'end', baseline: 'middle' });
  for (const p of ticks(1, length)) if (p >= 1) marks.push({ type: 'text', x: sx(p), y: f.y + H - 0.8 * t, text: String(Math.round(p)), size: t * 0.9, fill: theme.muted, anchor: 'middle' });
  for (const x of list) {
    const strong = x.q < limit;
    marks.push({ type: 'rect', x: sx(x.position) - bw / 2, y: Math.min(sy(0), sy(x.mean)), w: bw, h: Math.max(0.5 * k, Math.abs(sy(x.mean) - sy(0))), fill: strong ? theme.danger : theme.muted, opacity: strong ? 0.9 : 0.45, title: x.title ?? `${x.position}: ${fmt(x.mean)}` });
  }
  return { marks, width: W, height: H, description: label, hits: { left: area.left, right: area.right, length } };
}

// A predictor's classes as boxes: for each class ({ id, label, n, low, median, high }), the quartiles
// of the measured scores as a box and the median as a line; references' medians ({ synonymous:
// { median }, nonsense: { median } }) as dashed lines.
export function classBoxes(spec, frame) {
  const { list, references, label = '', xLabel = '' } = spec;
  const f = frameOf(frame);
  const t = f.text;
  const k = t / 10;
  const theme = f.theme;
  const W = f.width ?? 420;
  // The classes' names in a column of their own, as the bar chart's: at most 45% of the width, a
  // name longer than that cut short with an ellipsis (it was clipped by the panel's edge).
  const pad = { l: Math.min(W * 0.45, Math.max(...list.map((x) => textWidth(x.label.replace(/ \(.*\)$/, ''), t * 1.1)), 0) + 1.2 * t), r: 1.2 * t, t: 1.8 * t, b: 3.4 * t };
  const H = f.height ?? pad.t + pad.b + 3.4 * t * list.length;
  const rowH = (H - pad.t - pad.b) / Math.max(1, list.length);
  const marks = [];
  const values = [...list.flatMap((x) => (x.n ? [x.low, x.high] : [])), references.synonymous?.median, references.nonsense?.median].filter(finite);
  if (!values.length) return { marks, width: W, height: H, description: label, empty: true };
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  const margin = (hi - lo) * 0.06 || 1;
  lo -= margin;
  hi += margin;
  const left = f.x + pad.l;
  const right = f.x + W - pad.r;
  const sx = (v) => left + ((v - lo) / (hi - lo)) * (right - left);
  const bottom = f.y + H - pad.b;
  marks.push({ type: 'line', x1: left, y1: bottom, x2: right, y2: bottom, stroke: theme.axis, width: k });
  for (const v of ticks(lo, hi)) marks.push({ type: 'text', x: sx(v), y: bottom + 1.3 * t, text: tickText(v), size: t, fill: theme.muted, anchor: 'middle' });
  if (xLabel) marks.push({ type: 'text', x: (left + right) / 2, y: f.y + H - 0.4 * t, text: ellipsizeText(xLabel, right - left, t), size: t, fill: theme.label, anchor: 'middle' });
  for (const [what, ref] of [['synonymous', references.synonymous], ['nonsense', references.nonsense]]) {
    if (!finite(ref?.median)) continue;
    marks.push({ type: 'line', x1: sx(ref.median), y1: f.y + pad.t, x2: sx(ref.median), y2: bottom, stroke: theme.muted, width: k, dash: [4 * k, 3 * k] });
    marks.push({ type: 'text', x: sx(ref.median), y: f.y + pad.t - 0.6 * t, text: what, size: t, fill: theme.muted, anchor: 'middle' });
  }
  list.forEach((x, i) => {
    const y = f.y + pad.t + 0.4 * t + i * rowH;
    const size = Math.min(t * 1.1, rowH * 0.4);
    marks.push({ type: 'text', x: left - 0.8 * t, y: y + rowH / 2 - 0.4 * size, text: ellipsizeText(x.label.replace(/ \(.*\)$/, ''), pad.l - 0.8 * t, size), size, fill: theme.text, anchor: 'end' });
    marks.push({ type: 'text', x: left - 0.8 * t, y: y + rowH / 2 + 0.9 * size, text: ellipsizeText(`${x.n.toLocaleString('en-US')} variants`, pad.l - 0.8 * t, size * 0.9), size: size * 0.9, fill: theme.muted, anchor: 'end' });
    if (!x.n) return;
    const color = x.id === 'pathogenic' ? theme.danger : x.id === 'benign' ? theme.ok : theme.muted;
    marks.push({ type: 'rect', x: sx(x.low), y: y + 0.4 * t, w: Math.max(k, sx(x.high) - sx(x.low)), h: rowH - 1.4 * t, fill: color, opacity: 0.35, title: `${x.label}: ${x.n} variants, median ${fmt(x.median)}, quartiles ${fmt(x.low)} to ${fmt(x.high)}` });
    marks.push({ type: 'rect', x: sx(x.low), y: y + 0.4 * t, w: Math.max(k, sx(x.high) - sx(x.low)), h: rowH - 1.4 * t, fill: 'none', stroke: color, width: k });
    marks.push({ type: 'line', x1: sx(x.median), y1: y + 0.2 * t, x2: sx(x.median), y2: y + rowH - 0.8 * t, stroke: color, width: 2.5 * k });
  });
  return { marks, width: W, height: H, description: label };
}

// --- A variant's evidence -------------------------------------------------------------------------------

// A variant's score with its 95% interval, and each replicate's score with its own (± 1.96 SE), as
// rows against the score's axis, with the wild type's score as a dashed line. rows: [{ label,
// score, low, high, used }]; combined: { label, score, low, high } or null.
export function evidencePlot(spec, frame) {
  const { rows, combined = null, wt = null, xLabel = 'score', label = '' } = spec;
  const f = frameOf(frame);
  const t = f.text;
  const k = t / 10;
  const theme = f.theme;
  const W = f.width ?? 300;
  const all = [...rows, ...(combined ? [combined] : [])];
  const labelW = Math.min(W * 0.4, Math.max(...all.map((r) => textWidth(r.label, t)), 0) + 0.8 * t);
  const H = f.height ?? (all.length + 1) * 2 * t + 3.4 * t;
  const area = { left: f.x + labelW, right: f.x + W - 1.2 * t, top: f.y + 0.6 * t, bottom: f.y + H - 3.4 * t };
  const values = [...all.flatMap((r) => [r.low, r.high, r.score]), ...(finite(wt) ? [wt] : [])].filter(finite);
  const marks = [];
  if (!values.length) {
    marks.push({ type: 'text', x: f.x + W / 2, y: f.y + H / 2, text: 'Not scored.', size: t, fill: theme.muted, anchor: 'middle', baseline: 'middle' });
    return { marks, width: W, height: H, description: label, empty: true };
  }
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  const m = (hi - lo) * 0.08 || 0.5;
  lo -= m;
  hi += m;
  const { sx } = axes(marks, area, { x: { lo, hi }, y: { lo: 0, hi: 1, ticks: [] }, xLabel, t, theme, grid: false, frame: { ...f, width: W, height: H } });
  if (finite(wt)) marks.push({ type: 'line', x1: sx(wt), y1: area.top, x2: sx(wt), y2: area.bottom, stroke: theme.muted, width: k, dash: [3 * k, 2 * k] });
  const row = (area.bottom - area.top) / Math.max(1, all.length);
  all.forEach((r, i) => {
    const y = area.top + (i + 0.5) * row;
    const isCombined = r === combined;
    const color = isCombined ? theme.text : r.used === false ? theme.muted : theme.accent;
    marks.push({ type: 'text', x: area.left - 0.6 * t, y, text: r.label, size: Math.min(t, row * 0.8), fill: isCombined ? theme.text : theme.label, anchor: 'end', baseline: 'middle', bold: isCombined });
    if (!finite(r.score)) return;
    if (finite(r.low) && finite(r.high)) marks.push({ type: 'line', x1: sx(r.low), y1: y, x2: sx(r.high), y2: y, stroke: color, width: (isCombined ? 2 : 1.5) * k });
    if (isCombined) {
      const d = Math.min(row * 0.35, 0.6 * t);
      marks.push({ type: 'path', d: `M${sx(r.score) - d} ${y}L${sx(r.score)} ${y - d}L${sx(r.score) + d} ${y}L${sx(r.score)} ${y + d}Z`, fill: color });
    } else marks.push({ type: 'circle', x: sx(r.score), y, r: Math.min(row * 0.3, 3 * k), fill: r.used === false ? 'none' : color, stroke: color, width: k });
  });
  return { marks, width: W, height: H, description: label };
}

// --- Legends --------------------------------------------------------------------------------------------

// A legend ([{ label, color, dash, mark: 'line' | 'box' }]) as rows of swatches and labels across a
// width. Returns { marks, height }.
export function legendMarks(items, frame) {
  const f = frameOf(frame);
  const t = f.text;
  const k = t / 10;
  const theme = f.theme;
  const W = f.width ?? 560;
  const marks = [];
  let x = f.x;
  let y = f.y;
  const line = 1.5 * t;
  for (const item of items) {
    const need = 1.4 * t + textWidth(item.label, t) + 1.4 * t;
    if (x > f.x && x + need > f.x + W) {
      x = f.x;
      y += line;
    }
    const mid = y + line / 2;
    if (item.dash || item.mark === 'line') marks.push({ type: 'line', x1: x, y1: mid, x2: x + t, y2: mid, stroke: item.color, width: 2 * k, dash: item.dash ? [3 * k, 2 * k] : undefined });
    else marks.push({ type: 'rect', x, y: mid - 0.4 * t, w: t * 0.8, h: t * 0.8, fill: item.color });
    marks.push({ type: 'text', x: x + 1.4 * t, y: mid, text: item.label, size: t, fill: theme.label, baseline: 'middle' });
    x += need;
  }
  return { marks, height: items.length ? y - f.y + line : 0 };
}

// --- Calibration (wave 8, slice 2) -------------------------------------------------------------------

// The colors of a control set's two sides: the ClinVar track's (theme.P, theme.B where the page
// gives its own), Okabe and Ito's vermilion and blue.
export const sideColors = (theme) => ({ P: theme.P ?? '#d55e00', B: theme.B ?? '#0072b2' });

// A control set's scores against the run's: the run's scored variants as a histogram (gray), each
// side's controls as dots in a row of its own (spread up and down so that they do not hide each
// other), and, with thresholds, the classes they make: the abnormal-like zone and the intermediate
// one tinted, each threshold a dashed line. spec: { all (the run's scores), P, B, side ('below' |
// 'above'), thresholds ({ abnormal, normal } or null), label }.
export function controlStrips(spec, frame) {
  const { all = [], P, B, side = 'below', thresholds = null, label = '' } = spec;
  const f = frameOf(frame);
  const t = f.text;
  const k = t / 10;
  const theme = f.theme;
  const colors = sideColors(theme);
  const W = f.width ?? 560;
  const H = f.height ?? 190 * k;
  const marks = [];
  const values = [...all, ...P, ...B].filter(finite);
  if (values.length < 2) {
    marks.push({ type: 'text', x: f.x + W / 2, y: f.y + H / 2, text: 'Too few scores to draw.', size: t, fill: theme.muted, anchor: 'middle', baseline: 'middle' });
    return { marks, width: W, height: H, description: label, legend: [], empty: true };
  }
  // The range: the run's middle 99% and every control, with the thresholds.
  const s = Float64Array.from(all.filter(finite)).sort();
  const edges = s.length >= 20 ? [s[Math.floor(s.length * 0.005)], s[Math.ceil(s.length * 0.995) - 1]] : [];
  const tv = thresholds ? [thresholds.abnormal, thresholds.normal].filter(finite) : [];
  let lo = Math.min(...edges, ...P.filter(finite), ...B.filter(finite), ...tv);
  let hi = Math.max(...edges, ...P.filter(finite), ...B.filter(finite), ...tv);
  const m = (hi - lo) * 0.04 || 0.5;
  lo -= m;
  hi += m;
  const names = [['All', `${s.length.toLocaleString('en-US')} variants`], ['B', `${B.length} controls`], ['P', `${P.length} controls`]];
  const labelW = Math.max(...names.map(([a, b]) => Math.max(textWidth(a, t * 1.1), textWidth(b, t * 0.9))), 0) + 1.2 * t;
  const area = { left: f.x + labelW, right: f.x + W - 1.2 * t, top: f.y + 1.6 * t, bottom: f.y + H - 3.4 * t };
  const sx = (v) => area.left + ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (area.right - area.left);
  const rowsTop = area.top + (area.bottom - area.top) * 0.42;
  const rowH = (area.bottom - rowsTop) / 2;
  // The classes' zones, under everything.
  if (thresholds) {
    const a = finite(thresholds.abnormal) ? sx(thresholds.abnormal) : side === 'below' ? area.left : area.right;
    const n = finite(thresholds.normal) ? sx(thresholds.normal) : side === 'below' ? area.right : area.left;
    const abnormal = side === 'below' ? [area.left, a] : [a, area.right];
    const between = side === 'below' ? [a, n] : [n, a];
    if (abnormal[1] > abnormal[0]) marks.push({ type: 'rect', x: abnormal[0], y: area.top, w: abnormal[1] - abnormal[0], h: area.bottom - area.top, fill: theme.danger, opacity: 0.11, title: 'abnormal-like' });
    if (between[1] > between[0]) marks.push({ type: 'rect', x: between[0], y: area.top, w: between[1] - between[0], h: area.bottom - area.top, fill: theme.warn, opacity: 0.1, title: 'intermediate' });
    const zone = (x0, x1, text) => {
      if (x1 - x0 < textWidth(text, t * 0.9) + 0.4 * t) return;
      marks.push({ type: 'text', x: (x0 + x1) / 2, y: f.y + 0.9 * t, text, size: t * 0.9, fill: theme.muted, anchor: 'middle' });
    };
    zone(abnormal[0], abnormal[1], 'abnormal-like');
    zone(between[0], between[1], 'intermediate');
    zone(...(side === 'below' ? [n, area.right] : [area.left, n]), 'WT-like');
  }
  marks.push({ type: 'line', x1: area.left, y1: area.bottom, x2: area.right, y2: area.bottom, stroke: theme.axis, width: k });
  for (const v of ticks(lo, hi)) {
    if (v < lo || v > hi) continue;
    marks.push({ type: 'line', x1: sx(v), y1: area.bottom, x2: sx(v), y2: area.bottom + 0.3 * t, stroke: theme.axis, width: k });
    marks.push({ type: 'text', x: sx(v), y: area.bottom + 1.3 * t, text: tickText(v), size: t, fill: theme.muted, anchor: 'middle' });
  }
  marks.push({ type: 'text', x: (area.left + area.right) / 2, y: f.y + H - 0.3 * t, text: 'score', size: t * 1.05, fill: theme.label, anchor: 'middle' });
  // The run's variants: a histogram over the top of the plot.
  if (s.length) {
    const bins = 60;
    const counts = new Float64Array(bins);
    for (const v of s) counts[Math.min(bins - 1, Math.max(0, Math.floor(((v - lo) / (hi - lo)) * bins)))] += 1;
    const top = Math.max(...counts) || 1;
    const hTop = rowsTop - area.top - 0.4 * t;
    let d = `M${area.left} ${rowsTop - 0.4 * t}`;
    for (let b = 0; b < bins; b += 1) {
      const y = rowsTop - 0.4 * t - (counts[b] / top) * hTop;
      d += `L${area.left + (b / bins) * (area.right - area.left)} ${y}L${area.left + ((b + 1) / bins) * (area.right - area.left)} ${y}`;
    }
    d += `L${area.right} ${rowsTop - 0.4 * t}Z`;
    marks.push({ type: 'path', d, fill: theme.muted, opacity: 0.35, title: `The run's ${s.length.toLocaleString('en-US')} scored variants` });
  }
  // Each side's controls as dots, spread over its row by a fixed sequence (the golden ratio's).
  const rowOf = (values, row, color, name) => {
    const y0 = rowsTop + row * rowH;
    const dots = [];
    values.forEach((v, i) => {
      if (!finite(v)) return;
      const jitter = ((i * 0.6180339887498949) % 1) * 0.7 + 0.15;
      dots.push({ type: 'circle', x: sx(v), y: y0 + jitter * rowH, r: Math.min(2.6 * k, rowH * 0.12), fill: color, opacity: 0.75 });
    });
    marks.push({ type: 'group', label: name, marks: dots });
  };
  rowOf(B, 0, colors.B, 'B controls');
  rowOf(P, 1, colors.P, 'P controls');
  const rowLabel = (y, a, b, color) => {
    marks.push({ type: 'text', x: area.left - 0.6 * t, y: y - 0.2 * t, text: a, size: t * 1.1, fill: color, anchor: 'end', bold: true });
    marks.push({ type: 'text', x: area.left - 0.6 * t, y: y + 1.0 * t, text: b, size: t * 0.9, fill: theme.muted, anchor: 'end' });
  };
  if (s.length) rowLabel(area.top + (rowsTop - area.top) / 2, ...names[0], theme.label);
  rowLabel(rowsTop + rowH / 2, ...names[1], colors.B);
  rowLabel(rowsTop + 1.5 * rowH, ...names[2], colors.P);
  if (thresholds) {
    for (const v of tv) marks.push({ type: 'line', x1: sx(v), y1: area.top, x2: sx(v), y2: area.bottom, stroke: theme.text, width: 1.5 * k, dash: [4 * k, 3 * k] });
  }
  const legend = [{ label: `P controls (${P.length})`, color: colors.P }, { label: `B controls (${B.length})`, color: colors.B }, ...(s.length ? [{ label: `the run's variants (${s.length.toLocaleString('en-US')})`, color: theme.muted }] : []), ...(thresholds ? [{ label: 'thresholds', color: theme.text, dash: true }] : [])];
  return { marks, width: W, height: H, description: label, legend, range: [lo, hi] };
}

// A square plot of 0–1 on both axes, for the ROC and precision–recall curves: a band ([[x, low,
// high]]), a curve ([[x, y]]), points marked ([{ x, y, label }]) and reference lines.
function unitCurve(spec, f, { xLabel, yLabel, reference }) {
  const { curve, band = null, points = [], color = null, label = '' } = spec;
  const t = f.text;
  const k = t / 10;
  const theme = f.theme;
  const W = f.width ?? 300;
  const H = f.height ?? 280 * k;
  const marks = [];
  const area = { left: f.x + 4.6 * t, right: f.x + W - 1.2 * t, top: f.y + 0.8 * t, bottom: f.y + H - 3.4 * t };
  const unit = [0, 0.25, 0.5, 0.75, 1];
  const { sx, sy } = axes(marks, area, { x: { lo: 0, hi: 1, ticks: unit }, y: { lo: 0, hi: 1, ticks: unit }, xLabel, yLabel, t, theme, frame: { ...f, width: W, height: H } });
  const c = color ?? theme.accent;
  reference(marks, sx, sy, k);
  const ok = band?.filter((b) => finite(b[1]) && finite(b[2])) ?? [];
  if (ok.length > 1) {
    const up = ok.map((b) => `${sx(b[0])} ${sy(b[2])}`);
    const down = ok.slice().reverse().map((b) => `${sx(b[0])} ${sy(b[1])}`);
    marks.push({ type: 'path', d: `M${up.join('L')}L${down.join('L')}Z`, fill: c, opacity: 0.16, title: 'the bootstrap\'s 95% band' });
  }
  const pts = curve.filter((p) => finite(p[0]) && finite(p[1]));
  if (pts.length > 1) marks.push({ type: 'path', d: pts.map(([x, y], i) => `${i ? 'L' : 'M'}${sx(x)} ${sy(y)}`).join(''), fill: 'none', stroke: c, width: 2 * k, title: label });
  for (const p of points) {
    if (!finite(p.x) || !finite(p.y)) continue;
    marks.push({ type: 'circle', x: sx(p.x), y: sy(p.y), r: 3.5 * k, fill: theme.background, stroke: theme.text, width: 1.5 * k, title: p.label });
    // Its label beside it, below where it is near the top, on a patch of the background so that
    // the curve and the band do not run through it.
    if (!p.label) continue;
    const below = p.below || p.y > 0.9;
    const size = t * 0.9;
    const w = textWidth(p.label, size);
    const x = sx(p.x) + (p.x > 0.6 ? -0.7 * t : 0.7 * t);
    const y = sy(p.y) + (below ? 1.4 * t : -0.6 * t);
    marks.push({ type: 'rect', x: (p.x > 0.6 ? x - w : x) - 0.2 * t, y: y - 0.95 * size, w: w + 0.4 * t, h: 1.25 * size, fill: theme.background, opacity: 0.85 });
    marks.push({ type: 'text', x, y, text: p.label, size, fill: theme.text, anchor: p.x > 0.6 ? 'end' : 'start' });
  }
  return { marks, width: W, height: H, description: label };
}

// The ROC curve: sensitivity against 1 − specificity, with the line of chance and the bootstrap's
// band of sensitivity at each specificity. spec: { points: [{ sensitivity, specificity }], band:
// [{ specificity, low, high }] | null, marks: [{ sensitivity, specificity, label }], label }.
export function rocChart(spec, frame) {
  const f = frameOf(frame);
  const curve = spec.points.map((p) => [1 - p.specificity, p.sensitivity]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return unitCurve({
    curve, band: spec.band ? spec.band.map((b) => [1 - b.specificity, b.low, b.high]).sort((a, b) => a[0] - b[0]) : null,
    points: (spec.marks ?? []).map((m) => ({ x: 1 - m.specificity, y: m.sensitivity, label: m.label, below: m.below })), label: spec.label,
  }, f, {
    xLabel: '1 − specificity (B controls called abnormal-like)', yLabel: 'sensitivity (P called)',
    reference: (marks, sx, sy, k) => marks.push({ type: 'line', x1: sx(0), y1: sy(0), x2: sx(1), y2: sy(1), stroke: f.theme.muted, width: k, dash: [4 * k, 3 * k] }),
  });
}

// The precision–recall curve, with the precision of chance (the P controls' share, a dashed line)
// and the bootstrap's band of precision at each recall. spec: { points: [{ recall, precision }],
// band: [{ recall, low, high }] | null, baseline, marks: [{ recall, precision, label }], label }.
export function prChart(spec, frame) {
  const f = frameOf(frame);
  return unitCurve({
    curve: spec.points.map((p) => [p.recall, p.precision]),
    band: spec.band ? [[0, Number.NaN, Number.NaN], ...spec.band.map((b) => [b.recall, b.low, b.high])] : null,
    points: (spec.marks ?? []).map((m) => ({ x: m.recall, y: m.precision, label: m.label, below: m.below })), label: spec.label,
  }, f, {
    xLabel: 'recall (P controls called)', yLabel: 'precision (among these controls)',
    reference: (marks, sx, sy, k) => {
      if (finite(spec.baseline)) marks.push({ type: 'line', x1: sx(0), y1: sy(spec.baseline), x2: sx(1), y2: sy(spec.baseline), stroke: f.theme.muted, width: k, dash: [4 * k, 3 * k] });
    },
  });
}

// Score-level likelihood ratios (wave 8, slice 4): the ratio against the score on a log axis, the
// interval of its bootstrap's median as a band, the evidence thresholds as dashed lines (the
// pathogenic side in the danger color, the benign in the ok color, each named at its right), 1 as a
// line, and each side's controls as ticks along the bottom. spec: { grid (scores), llr, lo, hi
// (natural logs), thresholds (the eight likelihood ratios, benign very strong first), P, B, label }.
export function likelihoodChart(spec, frame) {
  const { grid, llr, lo, hi, thresholds, P = [], B = [], label = '' } = spec;
  const f = frameOf(frame);
  const t = f.text;
  const k = t / 10;
  const theme = f.theme;
  const colors = sideColors(theme);
  const W = f.width ?? 560;
  const H = f.height ?? 260 * k;
  const marks = [];
  const L10 = Math.LN10;
  const toLog10 = (v) => v / L10;
  const all = [...Array.from(lo, toLog10), ...Array.from(hi, toLog10)].filter(finite);
  const tl = thresholds.map((v) => log10(v));
  const yl = Math.max(-5, Math.min(...all, tl[0]) - 0.3);
  const yh = Math.min(5, Math.max(...all, tl[7]) + 0.3);
  const names = ['very strong', 'strong', 'moderate', 'supporting', 'supporting', 'moderate', 'strong', 'very strong'];
  const labelW = Math.max(...names.map((n) => textWidth(n, t * 0.85))) + 0.8 * t;
  // Below the axis: its tick labels, two rows of the controls' ticks, then its name.
  const area = { left: f.x + 5.2 * t, right: f.x + W - labelW - 0.6 * t, top: f.y + 0.8 * t, bottom: f.y + H - 5.6 * t };
  const yTicks = [];
  for (let e = Math.ceil(yl); e <= Math.floor(yh); e += 1) yTicks.push(e);
  const xs = Array.from(grid);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const { sx, sy } = axes(marks, area, { x: { lo: x0, hi: x1 }, y: { lo: yl, hi: yh, ticks: [] }, xLabel: 'score', yLabel: 'likelihood ratio (P : B)', t, theme, grid: false, frame: { ...f, width: W, height: H } });
  for (const e of yTicks) {
    marks.push({ type: 'line', x1: area.left, y1: sy(e), x2: area.right, y2: sy(e), stroke: theme.grid, width: k, dash: [2 * k, 3 * k] });
    // A power of ten as written ("1e3" read exactly), no engine's pow.
    marks.push({ type: 'text', x: area.left - 0.4 * t, y: sy(e), text: e >= 0 ? String(Number(`1e${e}`)) : `1/${Number(`1e${-e}`)}`, size: t, fill: theme.muted, anchor: 'end', baseline: 'middle' });
  }
  // The thresholds, each side's color, named at the right.
  tl.forEach((v, i) => {
    if (v < yl || v > yh) return;
    const color = i < 4 ? theme.ok : theme.danger;
    marks.push({ type: 'line', x1: area.left, y1: sy(v), x2: area.right, y2: sy(v), stroke: color, width: k, dash: [4 * k, 3 * k], opacity: 0.8 });
    marks.push({ type: 'text', x: area.right + 0.4 * t, y: sy(v), text: names[i], size: t * 0.85, fill: color, baseline: 'middle' });
  });
  marks.push({ type: 'line', x1: area.left, y1: sy(0), x2: area.right, y2: sy(0), stroke: theme.muted, width: k });
  const clampY = (v) => Math.max(yl, Math.min(yh, v));
  const band = [];
  for (let i = 0; i < xs.length; i += 1) if (finite(lo[i]) && finite(hi[i])) band.push(i);
  if (band.length > 1) {
    const up = band.map((i) => `${sx(xs[i])} ${sy(clampY(toLog10(hi[i])))}`);
    const down = band.slice().reverse().map((i) => `${sx(xs[i])} ${sy(clampY(toLog10(lo[i])))}`);
    marks.push({ type: 'path', d: `M${up.join('L')}L${down.join('L')}Z`, fill: theme.accent, opacity: 0.16, title: 'the interval of the bootstrap\'s median' });
  }
  marks.push({ type: 'path', d: xs.map((x, i) => `${i ? 'L' : 'M'}${sx(x)} ${sy(clampY(toLog10(llr[i])))}`).join(''), fill: 'none', stroke: theme.accent, width: 2 * k, title: label });
  // The controls along the bottom, B above P.
  const rug = (values, row, color) => {
    const y0 = area.bottom + 2.1 * t + row * 0.9 * t;
    for (const v of values) if (finite(v) && v >= x0 && v <= x1) marks.push({ type: 'line', x1: sx(v), y1: y0, x2: sx(v), y2: y0 + 0.6 * t, stroke: color, width: k, opacity: 0.7 });
  };
  rug(B, 0, colors.B);
  rug(P, 1, colors.P);
  const legend = [{ label: 'likelihood ratio', color: theme.accent, mark: 'line' }, { label: 'pathogenic thresholds', color: theme.danger, dash: true }, { label: 'benign thresholds', color: theme.ok, dash: true }, { label: `B controls (${B.length})`, color: colors.B }, { label: `P controls (${P.length})`, color: colors.P }];
  return { marks, width: W, height: H, description: label, legend };
}
