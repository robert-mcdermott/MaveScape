import assert from 'node:assert/strict';
import test from 'node:test';
import { barChart, classHistogram, coverageGrid, evidencePlot, flowBars, legendMarks, lineChart, logTicks, PLOT_LIGHT, scatter, ticks } from './plots.js';
import { textMarks } from './draw.js';

const rects = (marks) => marks.flatMap((m) => (m.type === 'group' ? rects(m.marks) : m.type === 'rect' ? [m] : []));

test('ticks: nice numbers, 0 exactly 0, decades on a log axis', () => {
  assert.deepEqual(ticks(-0.3, 0.3), [-0.2, 0, 0.2]);
  assert.deepEqual(ticks(0, 1), [0, 0.25, 0.5, 0.75, 1]);
  assert.deepEqual(logTicks(0.03, 2000), [0.1, 1, 10, 100, 1000]);
});

test('bars: one per item, as long as its value, colored by its status, with threshold lines; fitted to a frame', () => {
  const items = [{ label: 'rep1', value: 10, status: '' }, { label: 'rep2', value: 20, status: 'review' }, { label: 'rep3', value: Number.NaN }];
  const drawn = barChart({ items, lines: [{ value: 15, kind: 'fail' }], label: 'Depth' }, { width: 300, text: 10 });
  const bars = rects(drawn.marks).filter((r) => r.title);
  assert.equal(bars.length, 2);
  assert.ok(Math.abs(bars[1].w / bars[0].w - 2) < 1e-9, 'twice as long');
  assert.equal(bars[1].fill, PLOT_LIGHT.warn);
  assert.deepEqual(drawn.bars, [{ label: 'rep1', value: 10 }, { label: 'rep2', value: 20 }, { label: 'rep3', value: null }]);
  assert.ok(drawn.marks.some((m) => m.type === 'line' && m.stroke === PLOT_LIGHT.danger && m.dash));
  assert.ok(textMarks(drawn.marks).some((m) => m.text === 'none'));
  const fitted = barChart({ items, label: 'Depth' }, { width: 300, height: 60, text: 7 });
  assert.equal(fitted.height, 60);
});

test('lines and scatters: points where their scales put them, hits for picking, log axes, nothing to draw said', () => {
  const line = lineChart({ series: [{ label: 'a', color: '#f00', points: [[1, 1], [10, 10], [100, 100]] }], xLog: true, yLog: true, vlines: [{ value: 10, kind: 'review' }] }, { width: 400, height: 200, text: 10 });
  assert.equal(line.series[0].points.length, 3);
  const path = line.marks.find((m) => m.type === 'path');
  const [p0, p1, p2] = path.d.match(/-?[\d.]+ -?[\d.]+/g).map((s) => s.split(' ').map(Number));
  assert.ok(Math.abs((p1[0] - p0[0]) - (p2[0] - p1[0])) < 1e-6, 'decades evenly spaced');
  const scat = scatter({ points: [[0, 0, 'a'], [1, 1, 'b'], [Number.NaN, 2, 'a']], colorOf: (k) => (k === 'a' ? '#111111' : '#222222'), diagonal: true, focus: 1 }, { width: 300, height: 300, text: 10 });
  assert.equal(scat.drawn, 2);
  assert.ok(Number.isNaN(scat.hits.px[2]));
  assert.ok(scat.hits.px[1] > scat.hits.px[0] && scat.hits.py[1] < scat.hits.py[0]);
  assert.ok(scat.marks.some((m) => m.type === 'circle' && m.fill === 'none'), 'the focus ringed');
  assert.equal(lineChart({ series: [] }, { width: 100 }).empty, true);
});

test('a class histogram: each class\'s density, its median in the legend, the wild type marked; small classes as ticks', () => {
  const values = Array.from({ length: 200 }, (_, i) => -2 + (4 * i) / 199);
  const drawn = classHistogram({ groups: [{ label: 'Missense', values, color: '#0a0' }, { label: 'Nonsense', values: [-3, -2.5], color: '#a00' }], marks: [{ value: 0, label: 'wild type' }], label: 'Scores' }, { width: 400, text: 10 });
  assert.deepEqual(drawn.groups.map((g) => [g.label, g.n]), [['Missense', 200], ['Nonsense', 2]]);
  assert.ok(Math.abs(drawn.groups[0].density.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.match(drawn.legend[1].label, /Nonsense \(2, ticks\): median -2\.75/);
  assert.equal(drawn.legend[2].label, 'wild type');
  assert.equal(drawn.marks.filter((m) => m.type === 'line' && m.stroke === '#a00').length, 2);
});

test('flow, coverage, evidence and legends', () => {
  const flow = flowBars([{ label: 'Measured', remaining: 100, removed: 0 }, { label: 'Minimum input', remaining: 80, removed: 20 }], { width: 300, text: 10 });
  assert.match(flow.description, /Minimum input 80 \(−20\)/);
  const grid = new Uint8Array(3 * 21).fill(2);
  grid[0] = 0;
  const cov = coverageGrid({ grid, length: 3, observed: 62, designed: 63 }, { width: 200, height: 100, text: 7 });
  assert.equal(rects(cov.marks).length, 63);
  const ev = evidencePlot({ rows: [{ label: 'Replicate 1', score: -1, low: -1.5, high: -0.5 }, { label: 'Replicate 2', score: Number.NaN, low: Number.NaN, high: Number.NaN, used: false }], combined: { label: 'Combined', score: -1, low: -1.2, high: -0.8 }, wt: 0 }, { width: 200, text: 7 });
  assert.ok(ev.marks.some((m) => m.type === 'path' && m.d.endsWith('Z')), 'the combined score a diamond');
  assert.ok(textMarks(ev.marks).some((m) => m.text === 'Combined' && m.bold));
  const legend = legendMarks([{ label: 'one', color: '#000' }, { label: 'two', color: '#111', dash: true }], { width: 40, text: 10 });
  assert.equal(legend.height, 30, 'two rows when they do not fit across');
});
