import assert from 'node:assert/strict';
import test from 'node:test';
import { drawMap, geometry, hitTest, mapPalette } from './map-render.js';
import { mapSVG, EXPORT_THEME } from './map-svg.js';
import { STATE } from './map-model.js';

// A small model by hand: 3 positions × 21 rows, one cell of each state at position 2.
function model() {
  const R = 21;
  const state = new Uint8Array(3 * R).fill(STATE.SCORED);
  const value = new Float64Array(3 * R).fill(-0.5);
  [STATE.MISSING, STATE.FILTERED, STATE.LOW, STATE.REFERENCE, STATE.NOT_DESIGNED].forEach((s, r) => { state[R + r] = s; });
  return {
    target: { name: 'Toy', offset: 10 }, protein: 'MSK', length: 3, rows: 'HKRDECMNQSTAILVFWYGP*', groups: null,
    condition: { id: 'all', name: 'All' }, colorBy: 'score', domain: { kind: 'diverging', center: 0, min: -2, max: 2 },
    cells: new Int32Array(3 * R).fill(0), state, value, reference: new Uint8Array(3 * R), columnMedian: Float64Array.of(-1, 0, 1), columnCount: Uint8Array.of(20, 20, 20), rowMedian: new Float64Array(R).fill(0),
    counts: {}, offMap: 0, offMapKinds: {},
  };
}
function recorder() {
  const log = [];
  const ctx = new Proxy({}, { get: (t, name) => (name in t ? t[name] : (...args) => log.push([name, ...args])), set: (t, name, v) => { log.push([`set ${String(name)}`, v]); return true; } });
  return { ctx, log };
}

test('hit testing: cells, the overview strip, outside', () => {
  const m = model();
  const view = { width: 300, cellW: 20, cellH: 14, x0: 1 };
  const g = geometry(m, view);
  assert.deepEqual(hitTest(m, view, g.left + 25, g.top + 14 * 3 + 2), { region: 'cell', position: 2, row: 3 });
  assert.equal(hitTest(m, view, g.left + 5, g.overviewTop + 5).region, 'overview');
  assert.equal(hitTest(m, view, 2, g.top + 2), null);
  assert.equal(hitTest(m, view, g.left + 25, g.top - 3), null);
});

test('each state is drawn its own way; small cells drop the marks', () => {
  const m = model();
  const { color, paler } = mapPalette(m, 'rdbu', EXPORT_THEME.gray);
  const big = recorder();
  drawMap(big.ctx, m, { width: 300, cellW: 20, cellH: 14, x0: 1, hover: -1, focus: -1, selected: new Set([21 + 11]) }, EXPORT_THEME, color, paler);
  const fills = big.log.filter((c) => c[0] === 'set fillStyle').map((c) => c[1]);
  assert.ok(fills.includes(EXPORT_THEME.empty), 'missing and filtered cells use the empty color');
  assert.ok(fills.includes(EXPORT_THEME.dot), 'missing cells have their dot');
  assert.ok(fills.includes(paler(0.375)), 'low confidence is paler');
  assert.ok(fills.includes(color(0.5)), 'the reference residue is the neutral color');
  assert.ok(big.log.some((c) => c[0] === 'set strokeStyle' && c[1] === EXPORT_THEME.accent), 'the selection is outlined');
  const small = recorder();
  drawMap(small.ctx, m, { width: 300, cellW: 2, cellH: 14, x0: 1, hover: -1, focus: -1, selected: new Set() }, EXPORT_THEME, color, paler);
  assert.ok(!small.log.some((c) => c[0] === 'set fillStyle' && c[1] === EXPORT_THEME.dot), 'no dot in a cell too small for it');
});

test('the SVG is the same text for the same model, and draws every state', () => {
  const m = model();
  const a = mapSVG(m);
  assert.equal(a, mapSVG(m));
  assert.match(a, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  for (const what of ['(missing)', '(filtered)', '(low confidence)', '(reference)']) assert.ok(a.includes(what), what);
  assert.ok(a.includes('url(#hatch)'));
  assert.ok(!a.includes('S2E<'), 'no cell where the substitution is not designed');
  assert.ok(a.includes('S2W<'));
});
