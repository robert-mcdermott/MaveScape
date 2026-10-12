// The views' plots as figure panels (wave 6, slice 2; requirement R5): a panel's charts (what its
// view draws: a QC finding's, a run's score distribution, a comparison's scatter, a variant's
// evidence), laid out in the panel's box at the figure's text size, each with its heading and
// legend; and an image (a saved structure view, as its figure panel draws it). The charts are
// lib/plots.js's, the same the views draw. Pure.

import { barChart, classBoxes, classHistogram, coverageGrid, evidencePlot, flowBars, legendMarks, lineChart, PLOT_LIGHT, positionBars, scatter } from './plots.js';
import { textMarks } from './draw.js';

export const CHARTS = { bar: barChart, line: lineChart, scatter, histogram: classHistogram, flow: flowBars, coverage: coverageGrid, positions: positionBars, classes: classBoxes, evidence: evidencePlot };

// The smallest a chart is drawn, in multiples of the text size.
const MIN_CHART = 6;

// What a chart needs, in multiples of the text size: its height drawn as a view draws it.
function naturalHeight(chart) {
  const s = chart.spec;
  switch (chart.kind) {
    case 'bar': return s.items.length * 2 + 2.8;
    case 'flow': return s.length * 2.2;
    case 'classes': return s.list.length * 3.4 + 5.2;
    case 'evidence': return (s.rows.length + (s.combined ? 2 : 1)) * 2 + 3.4;
    case 'line': return 22;
    case 'scatter': return 30;
    case 'coverage': return 16.8;
    default: return 15;
  }
}

// A panel of charts in a box { x, y, w, h }. data: { title, charts: [{ kind, spec, heading?, legend? }],
// description? }. options: { text, title (absent: data.title; '': none) }. Returns { marks,
// description, notes, charts: [{ kind, drawn }] } (drawn: each chart's own return, for checks).
export function chartsPanel(box, data, options = {}) {
  const t = options.text ?? 7;
  const theme = PLOT_LIGHT;
  const marks = [];
  const notes = [];
  const title = options.title === undefined || options.title === null ? data.title : options.title;
  let y = box.y;
  if (title) {
    marks.push({ type: 'text', x: box.x, y, text: title, size: t + 1, bold: true, fill: theme.text, baseline: 'top' });
    y += t + 4;
  }
  const charts = data.charts ?? [];
  if (!charts.length) {
    marks.push({ type: 'text', x: box.x + box.w / 2, y: (y + box.y + box.h) / 2, text: data.reason ?? 'Nothing to draw.', size: t, fill: theme.muted, anchor: 'middle', baseline: 'middle' });
    return { marks, description: data.reason ?? 'Nothing to draw.', notes: [data.reason ?? 'Nothing to draw.'], charts: [] };
  }
  // Each chart's heading and legend first, then the room left shared among the charts.
  const parts = charts.map((raw) => {
    // A histogram's legend and a coverage grid's key are the chart's own.
    const own = raw.kind === 'histogram' ? classHistogram : raw.kind === 'coverage' ? coverageGrid : null;
    const c = raw.legend || !own ? raw : { ...raw, legend: own(raw.spec, { width: 100, height: 100, text: t, theme }).legend };
    const heading = c.heading ? t + 4 : 0;
    const legend = c.legend?.length ? legendMarks(c.legend, { x: box.x, y: 0, width: box.w, text: t, theme }) : null;
    return { chart: c, heading, legend, fixed: heading + (legend ? legend.height + 2 : 0) };
  });
  const room = box.y + box.h - y - parts.reduce((sum, p) => sum + p.fixed, 0) - (parts.length - 1) * t;
  // The room shared in proportion to what each chart needs at this text size.
  const weights = parts.map((p) => naturalHeight(p.chart));
  const total = weights.reduce((a, b) => a + b, 0);
  const heights = weights.map((w) => (room * w) / total);
  if (heights.some((x) => x < MIN_CHART * t)) notes.push(`Too little room for ${parts.length > 1 ? 'its charts' : 'the chart'}: make the panel taller.`);
  const drawn = [];
  parts.forEach((p, i) => {
    if (p.heading) {
      marks.push({ type: 'text', x: box.x, y, text: p.chart.heading, size: t, bold: true, fill: theme.text, baseline: 'top' });
      y += p.heading;
    }
    if (p.legend) {
      const legend = legendMarks(p.chart.legend, { x: box.x, y, width: box.w, text: t, theme });
      marks.push(...legend.marks);
      y += legend.height + 2;
    }
    const draw = CHARTS[p.chart.kind];
    if (!draw) {
      notes.push(`MaveScape does not draw "${p.chart.kind}" charts.`);
      return;
    }
    const height = Math.max(MIN_CHART * t, heights[i]);
    const out = draw(p.chart.spec, { x: box.x, y, width: box.w, height, text: t, theme });
    marks.push(...out.marks);
    drawn.push({ kind: p.chart.kind, drawn: out });
    y += height + t;
  });
  const description = data.description ?? [title, ...drawn.map((d) => d.drawn.description)].filter(Boolean).join('. ');
  return { marks, description, notes, charts: drawn };
}

// An image ({ width, height, rgba, png? }) fitted in a box at its aspect ratio, at the top and
// centered across, with a caption below it when one is given. options: { text, title, caption }.
export function imagePanel(box, data, options = {}) {
  const t = options.text ?? 7;
  const marks = [];
  let y = box.y;
  const title = options.title === undefined || options.title === null ? data.title : options.title;
  if (title) {
    marks.push({ type: 'text', x: box.x, y, text: title, size: t + 1, bold: true, fill: PLOT_LIGHT.text, baseline: 'top' });
    y += t + 4;
  }
  const { image } = data;
  const room = { w: box.w, h: box.y + box.h - y };
  const scale = Math.min(room.w / image.width, room.h / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  marks.push({ type: 'image', x: box.x + (box.w - w) / 2, y, w, h, image, smooth: true });
  const notes = [];
  // A resolution under 300 dpi at the printed size (one pixel per 0.24 pt).
  const dpi = (image.width / w) * 72;
  if (dpi < 300) notes.push(`The image is ${Math.round(dpi)} dpi at this size: draw it again at a larger scale, or make the panel smaller.`);
  return { marks, description: data.description ?? title ?? 'An image.', notes, dpi };
}

// The text sizes a panel's marks use, for the figure's check.
export function textSizes(marks) {
  return textMarks(marks).map((m) => m.size);
}
