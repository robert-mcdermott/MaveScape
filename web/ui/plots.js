// Small plots for the QC and Score views and the inspector: bars, lines, scatter, class histograms,
// the filter flow and the coverage grid. Drawn by lib/plots.js (wave 6, slice 2), which figures
// draw too, here in the page's colors: SVG (canvas for many points and for the grid), each with an
// aria-label that says what it shows; the views give the numbers in text or a table beside each.

import { h, formatCount } from './dom.js';
import { marksToSVGSync, paintMarks } from '../lib/draw.js';
import * as plots from '../lib/plots.js';

export { ticks } from '../lib/plots.js';
export const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// The page's colors, as lib/plots.js names them.
export function viewTheme() {
  return {
    background: cssVar('--panel'), text: cssVar('--text'), label: cssVar('--text-2'), muted: cssVar('--text-3'), axis: cssVar('--line-strong'), grid: cssVar('--line'),
    accent: cssVar('--accent'), warn: cssVar('--warn'), danger: cssVar('--danger'), ok: cssVar('--ok'),
  };
}

const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

// A plot's marks as an SVG element that fills its container's width.
export function plotSVG(drawn, label, className = 'plot') {
  const template = document.createElement('template');
  template.innerHTML = marksToSVGSync(drawn.marks, drawn.width, drawn.height, { sized: false, font: FONT });
  const el = template.content.firstElementChild;
  el.setAttribute('class', className);
  el.setAttribute('aria-label', label);
  return el;
}

// A plot's marks on a canvas at twice its size, in a div of the given class.
export function plotCanvas(drawn, label, className = 'plot-canvas') {
  const wrap = h(`div.${className.split(' ').join('.')}`, { role: 'img', 'aria-label': label });
  const canvas = h('canvas', { width: Math.round(drawn.width * 2), height: Math.round(drawn.height * 2), style: { width: '100%', height: 'auto' } });
  wrap.append(canvas);
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.scale(2, 2);
    paintMarks(ctx, drawn.marks);
  }
  return { wrap, canvas };
}

export function legend(items) {
  return h('div.legend', ...items.map((x) => h('span.legend-item', h(`span.swatch${x.dash ? '.dashed' : ''}${x.mark === 'line' && !x.dash ? '.wt' : ''}`, { style: x.dash ? { borderTopColor: x.color } : x.mark === 'line' ? {} : { background: x.color } }), x.label)));
}

const frame = (width, height) => ({ width, height, text: 10, theme: viewTheme() });

// Horizontal bars, one per item ({ label, value, status }), with threshold lines.
export function barChart(spec) {
  return plotSVG(plots.barChart(spec, frame(560)), spec.label);
}

// Lines ({ label, points: [[x, y]], color, dash }) on linear or log axes, with vertical lines
// (vlines: [{ value, kind }]).
export function lineChart(spec) {
  const drawn = plots.lineChart(spec, frame(spec.width ?? 560, spec.height ?? 220));
  if (drawn.empty) return h('p.muted', 'Nothing to draw.');
  return plotSVG(drawn, spec.label);
}

// Many points on a canvas: [[x, y, group]], colors by group, an optional y = x line.
export function scatter(spec) {
  const { width = 560, height = 300 } = spec;
  return plotCanvas(plots.scatter({ ...spec, colorOf: spec.colorOf ?? (() => cssVar('--accent')) }, frame(width, height)), spec.label).wrap;
}

// Score distributions by variant class, as density step lines (classes of fewer than 10 as ticks),
// with marks (the wild type). groups: [{ label, values, color }].
export function classHistogram(spec) {
  const drawn = plots.classHistogram(spec, frame(560, 150));
  if (drawn.empty) return h('p.muted', 'Too few scores to draw.');
  return h('div', legend(drawn.legend), plotSVG(drawn, drawn.description, 'plot score-histogram'));
}

export { scoreGroups } from '../lib/view-plots.js';

// The filter flow as bars: each stage, what remains after it and what it removed; a stage's
// reason in its tooltip.
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
export function coverageGrid(coverage) {
  const { grid, length, offset } = coverage;
  const cell = Math.max(2, Math.min(10, Math.floor(1100 / length)));
  const drawn = plots.coverageGrid(coverage, { width: 12 + cell * length, height: 21 * 8, text: 10, theme: viewTheme() });
  const wrap = h('div.coverage-grid');
  const canvas = h('canvas', { width: drawn.width * 2, height: drawn.height * 2, style: { width: `${drawn.width}px`, height: `${drawn.height}px` }, role: 'img', 'aria-label': drawn.description });
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.scale(2, 2);
    paintMarks(ctx, drawn.marks);
  }
  const tip = h('div.coverage-tip', ' ');
  const CODES = 'ARNDCQEGHILKMFPSTWYV*';
  canvas.addEventListener('mousemove', (event) => {
    const rect = canvas.getBoundingClientRect();
    const p = Math.floor((event.clientX - rect.left - drawn.hits.left) / drawn.hits.cellW);
    const r = Math.floor((event.clientY - rect.top) / drawn.hits.cellH);
    if (p < 0 || p >= length || r < 0 || r > 20) return;
    const row = plots.COVERAGE_ROWS[r];
    tip.textContent = `Position ${p + 1}${offset ? ` (reference ${p + 1 + offset})` : ''}, ${row === '*' ? 'stop' : row}: ${plots.COVERAGE_STATES[grid[p * 21 + CODES.indexOf(row)]]}`;
  });
  wrap.append(h('div', { style: { overflowX: 'auto' } }, canvas), tip, legend(drawn.legend));
  return wrap;
}
