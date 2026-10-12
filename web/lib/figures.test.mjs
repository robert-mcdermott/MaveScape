import assert from 'node:assert/strict';
import test from 'node:test';
import { addPanel, checkFigure, createFigure, figureMarks, figurePDF, figureSVG, FIGURE_SIZES, mm, panelLetters, pngSize, removePanel, updatePanel } from './figures.js';
import { mapPanel } from './figure-map.js';
import { mapSVG } from './map-svg.js';
import { buildMapModel } from './map-model.js';
import { scoreExperiment, DEFAULT_PARAMETERS } from './score.js';
import { textMarks } from './draw.js';

const target = { id: 't', name: 'Toy', sequenceType: 'protein', sequence: 'MSKG', offset: 100 };
const design = {
  format: 'mavescape-design', version: 1, name: 'toy', model: 'two-population',
  variants: { column: 'v', level: 'protein' }, targets: [target], library: { level: 'variant' },
  samples: ['in1', 'out1', 'in2', 'out2'].map((id) => ({ id, name: id, columns: [id] })),
  replicates: [{ id: 'r1', biological: 1, input: 'in1', output: 'out1' }, { id: 'r2', biological: 2, input: 'in2', output: 'out2' }],
  controls: { wildType: 'auto', synonymous: 'auto', nonsense: 'auto' },
};
// As map-model.test.mjs: S2A scored, S2* low confidence, K3R filtered, K3= synonymous, G4D missing.
const names = ['p.=', 'p.Ser2Ala', 'p.Ser2Ter', 'p.Lys3Arg', 'p.Lys3=', 'p.Gly4Asp', 'p.[Ser2Ala;Lys3Arg]'];
const col = (...x) => Float64Array.from(x);
const columns = { in1: col(1000, 50, 40, 3, 60, Number.NaN, 20), out1: col(1000, 30, 0, 9, 55, Number.NaN, 5), in2: col(900, 45, 35, 2, 50, Number.NaN, 25), out2: col(950, 25, 0, 8, 52, Number.NaN, 4) };
const results = scoreExperiment({ names, columns, design, parameters: { ...DEFAULT_PARAMETERS, filters: { ...DEFAULT_PARAMETERS.filters, minInputCount: 5 } } }).results;
const model = buildMapModel(results, design);

function mapFigure() {
  let fig = createFigure('Figure 1', 'double');
  ({ figure: fig } = addPanel(fig, { kind: 'map', run: 'run-1', h: 210 }));
  ({ figure: fig } = addPanel(fig, { kind: 'text', text: 'Two replicates.', w: 120, h: 40 }));
  return fig;
}
const resolved = (fig) => new Map(fig.panels.filter((p) => p.kind === 'map').map((p) => [p.id, { model, results, tracks: [] }]));

test('pages in points from millimeters: journal columns and a slide', () => {
  assert.equal(mm(25.4), 72);
  const fig = createFigure('Figure 1', 'single');
  assert.deepEqual([fig.width, fig.height, fig.text], [240.94, 198.43, 7]);
  assert.equal(createFigure('Talk', 'slide').text, 14);
  assert.deepEqual(FIGURE_SIZES.map((s) => s.id), ['single', 'onehalf', 'double', 'slide']);
  assert.deepEqual(pngSize(fig, 300), { width: 1004, height: 827, scale: 300 / 72 });
});

test('panels placed below each other, lettered in reading order, moved and removed', () => {
  let fig = createFigure('F', 'double');
  let a;
  ({ figure: fig, panel: a } = addPanel(fig, { kind: 'text', text: 'a', w: 200, h: 100 }));
  assert.deepEqual([a.id, a.x, a.y], ['panel-1', 8, 8]);
  let b;
  ({ figure: fig, panel: b } = addPanel(fig, { kind: 'text', text: 'b', w: 200, h: 100 }));
  assert.equal(b.y, 116);
  // b beside a, on its row: A, B; then c below them.
  fig = updatePanel(fig, b.id, { x: 260, y: 20 });
  ({ figure: fig } = addPanel(fig, { kind: 'text', text: 'c', w: 100, h: 60 }));
  assert.deepEqual([...panelLetters(fig).values()], ['A', 'B', 'C']);
  assert.deepEqual([...panelLetters(updatePanel(fig, b.id, { letter: false })).entries()].map(([id, l]) => `${id}:${l}`), ['panel-1:A', 'panel-3:B']);
  assert.deepEqual(removePanel(fig, a.id).panels.map((p) => p.id), ['panel-2', 'panel-3']);
});

test('a figure from outside is checked before it is drawn', () => {
  const fig = mapFigure();
  assert.equal(checkFigure(fig), fig);
  assert.throws(() => checkFigure({ ...fig, panels: [{ ...fig.panels[0], kind: 'violin' }] }), /not a kind of panel/);
  assert.throws(() => checkFigure({ ...fig, panels: [{ ...fig.panels[0], x: fig.width }] }), /not on the page/);
  assert.throws(() => checkFigure({ ...fig, panels: [{ ...fig.panels[0], from: 1.5 }] }), /whole number/);
  assert.throws(() => checkFigure({ ...fig, panels: [fig.panels[0], fig.panels[0]] }), /two panels/);
  assert.throws(() => checkFigure({ ...fig, text: 2 }), /4 to 36 pt/);
});

test('the map panel: each cell the color map-svg.js gives it, the states named, the text at the figure\'s size', async () => {
  const fig = mapFigure();
  const drawn = figureMarks(fig, resolved(fig));
  assert.deepEqual(drawn.panels.map((p) => p.letter), ['A', 'B']);
  // The substitutions' names shrink to their rows (here 6.3 pt), never under 6 pt unsaid.
  assert.ok(drawn.smallest >= 6 && drawn.smallest < 7, String(drawn.smallest));
  assert.deepEqual(drawn.notes, []);
  assert.match(drawn.description, /^Figure 1, 174 × 120 mm, 2 panels\. Panel A: Variant-effect map of Toy/);
  // Every cell of the figure's SVG has the fill map-svg.js gives the same cell.
  const cellsOf = (svg) => new Map([...svg.matchAll(/<rect [^>]*fill="([^"]+)"[^>]*><title>([^<]+)<\/title><\/rect>/g)].map((m) => [m[2], m[1]]));
  const ours = cellsOf(await figureSVG(fig, resolved(fig)));
  const theirs = cellsOf(mapSVG(model, { results }));
  const comparable = [...theirs].filter(([id]) => !id.endsWith('(filtered)'));
  assert.equal(comparable.length, 4 * 21 - 1);
  for (const [id, fill] of comparable) assert.equal(ours.get(id), fill, id);
  assert.ok(ours.has('K3R (filtered)'));
  // A range of positions; a panel too small says so.
  const part = mapPanel({ x: 0, y: 0, w: 300, h: 200 }, { model, results, tracks: [] }, { from: 2, to: 3 });
  assert.deepEqual(part.range, [2, 3]);
  assert.match(part.description, /Positions 2–3 \(102–103 in the reference\) shown\./);
  assert.ok(textMarks(part.marks).every((m) => m.size >= 6));
  // A sequential coloring (SE, input count, replicates) draws its own legend, with no center.
  for (const colorBy of ['se', 'input', 'replicates']) {
    const seq = mapPanel({ x: 0, y: 0, w: 300, h: 200 }, { model: buildMapModel(results, design, { colorBy }), results, tracks: [] }, {});
    assert.ok(textMarks(seq.marks).every((m) => !/wild type/.test(m.text)), colorBy);
  }
  const tiny = mapPanel({ x: 0, y: 0, w: 300, h: 60 }, { model, results, tracks: [] }, {});
  assert.match(tiny.notes.join(' '), /make the panel taller|too small/);
});

test('a panel that cannot be drawn says why; text panels wrap', () => {
  const fig = mapFigure();
  const drawn = figureMarks(fig, new Map([[fig.panels[0].id, { missing: 'Run 1 is no longer in the workspace.' }]]));
  assert.deepEqual(drawn.notes, ['Panel A: Run 1 is no longer in the workspace.']);
  const long = updatePanel(fig, fig.panels[1].id, { text: 'word '.repeat(80), h: 30 });
  assert.match(figureMarks(long, resolved(long)).notes.join(' '), /lines of text do not fit/);
});

test('written twice, the same bytes: SVG and PDF (vector, its page in points, its text extractable)', async () => {
  const fig = mapFigure();
  const date = new Date('2026-10-12T00:00:00Z');
  assert.equal(await figureSVG(fig, resolved(fig)), await figureSVG(fig, resolved(fig)));
  const pdf = await figurePDF(fig, resolved(fig), { date });
  assert.deepEqual(pdf, await figurePDF(fig, resolved(fig), { date }));
  const text = new TextDecoder('latin1').decode(pdf);
  assert.match(text, /\/MediaBox \[0 0 493.23 340.16\]/);
  assert.match(text, /\/Title \(Figure 1\)/);
});
