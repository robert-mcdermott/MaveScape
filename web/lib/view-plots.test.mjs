import assert from 'node:assert/strict';
import test from 'node:test';
import { scoreCharts, scoreGroups, variantCharts, comparisonPoints } from './view-plots.js';
import { qcCharts, QC_PLOTS } from './qc-plots.js';
import { chartsPanel, imagePanel } from './figure-plots.js';
import { scoreExperiment, DEFAULT_PARAMETERS } from './score.js';
import { computeQC } from './qc.js';
import { findingsFrom, withDefaultThresholds } from './findings.js';
import { KIND } from './variants.js';
import { intervalOf } from './exports.js';
import { textMarks } from './draw.js';

const target = { id: 't', name: 'Toy', sequenceType: 'protein', sequence: 'MSKG', offset: 100 };
const design = {
  format: 'mavescape-design', version: 1, name: 'toy', model: 'two-population',
  variants: { column: 'v', level: 'protein' }, targets: [target], library: { level: 'variant' },
  samples: ['in1', 'out1', 'in2', 'out2'].map((id) => ({ id, name: id, columns: [id] })),
  replicates: [{ id: 'r1', biological: 1, input: 'in1', output: 'out1' }, { id: 'r2', biological: 2, input: 'in2', output: 'out2' }],
  controls: { wildType: 'auto', synonymous: 'auto', nonsense: 'auto' },
};
const names = ['p.=', 'p.Ser2Ala', 'p.Ser2Ter', 'p.Lys3Arg', 'p.Lys3=', 'p.Gly4Asp', 'p.Lys3Glu'];
const col = (...x) => Float64Array.from(x);
const columns = { in1: col(1000, 50, 40, 30, 60, 20, 45), out1: col(1000, 30, 4, 9, 55, 10, 40), in2: col(900, 45, 35, 28, 50, 22, 40), out2: col(950, 25, 3, 8, 52, 11, 38) };
const results = scoreExperiment({ names, columns, design, parameters: DEFAULT_PARAMETERS }).results;
const run = { id: 'run-1', name: 'Run 1', inputs: { design, parameters: DEFAULT_PARAMETERS } };

test('a run\'s charts: its scores by class (each class\'s scores), its flow, no volcano without conditions', () => {
  const c = results.conditions[0];
  const groups = scoreGroups(c, results.variants.kind, results.rows);
  const missense = [];
  for (let i = 0; i < results.rows; i += 1) if (!c.reason[i] && results.variants.kind[i] === KIND.MISSENSE) missense.push(c.score[i]);
  assert.deepEqual(groups.find((g) => g.label === 'Missense').values, missense);
  const dist = scoreCharts(results, run);
  assert.equal(dist.title, 'Run 1: scores by class');
  assert.equal(dist.charts[0].kind, 'histogram');
  assert.equal(dist.charts[0].spec.marks[0].value, c.score[results.controls.wt]);
  assert.deepEqual(scoreCharts(results, run, { plot: 'flow' }).charts[0].spec, c.flow);
  assert.match(scoreCharts(results, run, { plot: 'volcano' }).reason, /compares no conditions/);
});

test('a variant\'s evidence: each replicate\'s score ± 1.96 SE, the combined score and its interval, the wild type', () => {
  const key = 'p.Ser2Ala';
  const row = results.variants.key.indexOf(key);
  const c = results.conditions[0];
  const ev = variantCharts(results, run, key);
  assert.deepEqual(ev.rows.map((r) => r.score), results.replicates.map((r) => r.score[row]));
  assert.deepEqual(ev.rows.map((r) => r.high - r.score), results.replicates.map((r) => 1.96 * r.se[row]));
  assert.deepEqual([ev.combined.low, ev.combined.high], intervalOf(c, row));
  assert.equal(ev.charts[0].spec.wt, c.score[results.controls.wt]);
  assert.match(variantCharts(results, run, 'p.Trp9Ala').reason, /not in Run 1/);
  assert.match(variantCharts(results, run, key, { plot: 'time-course' }).reason, /not scored by regression/);
});

test('a comparison\'s points: missense first, the controls over them, colored by class', () => {
  const kinds = Uint8Array.of(KIND.NONSENSE, KIND.MISSENSE, KIND.SYNONYMOUS);
  const { order, points } = comparisonPoints([1, 2, 3], [4, 5, 6], kinds);
  assert.deepEqual(order, [1, 0, 2]);
  assert.deepEqual(points.map((p) => p.slice(0, 2)), [[2, 5], [1, 4], [3, 6]]);
});

test('QC: every finding with a plot has its charts (or says why not), as the QC view draws them', () => {
  const qc = computeQC({ names, columns, design, results });
  const t = withDefaultThresholds(null);
  for (const f of findingsFrom(qc, t)) {
    const out = qcCharts(f.plot, qc, t);
    assert.ok(out.charts.length || out.reason, f.id);
    if (f.plot !== 'dropout') assert.ok(QC_PLOTS[f.plot], f.plot);
  }
  const depth = qcCharts('depth', qc, t).charts[0];
  assert.deepEqual(depth.spec.items.map((x) => x.value), qc.samples.map((s) => s.readsPerVariant));
});

test('a panel of charts: title, legend and charts in the box at the figure\'s text size; too small said; an image fitted', () => {
  const panel = chartsPanel({ x: 0, y: 0, w: 240, h: 200 }, { title: 'Run 1', charts: [scoreCharts(results, run).charts[0]] }, { text: 7 });
  assert.equal(panel.charts.length, 1);
  assert.ok(textMarks(panel.marks).every((m) => m.size >= 7));
  assert.ok(panel.marks.some((m) => m.type === 'text' && /Missense/.test(m.text)), 'the histogram\'s legend');
  assert.deepEqual(panel.notes, []);
  const cramped = chartsPanel({ x: 0, y: 0, w: 240, h: 40 }, { title: 'Run 1', charts: [scoreCharts(results, run).charts[0]] }, { text: 7 });
  assert.match(cramped.notes[0], /make the panel taller/);
  assert.match(chartsPanel({ x: 0, y: 0, w: 240, h: 100 }, { title: 'x', charts: [], reason: 'Needs two replicates.' }, { text: 7 }).notes[0], /two replicates/);
  const image = { width: 400, height: 200, rgba: new Uint8Array(400 * 200 * 4) };
  const fitted = imagePanel({ x: 0, y: 0, w: 100, h: 100 }, { image, title: 'Core' }, { text: 7 });
  const mark = fitted.marks.find((m) => m.type === 'image');
  assert.deepEqual([mark.w, mark.h], [100, 50]);
  assert.match(imagePanel({ x: 0, y: 0, w: 500, h: 300 }, { image, title: '' }, { text: 7 }).notes[0], /dpi at this size/);
});
