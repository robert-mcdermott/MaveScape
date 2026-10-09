import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMapModel, cellAt, cellName, colorPosition, describeMap, STATE } from './map-model.js';
import { scoreExperiment, DEFAULT_PARAMETERS } from './score.js';

const target = { id: 't', name: 'Toy', sequenceType: 'protein', sequence: 'MSKG', offset: 100 };
const design = (extra = {}) => ({
  format: 'mavescape-design', version: 1, name: 'toy', model: 'two-population',
  variants: { column: 'v', level: 'protein' }, targets: [target], library: { level: 'variant' },
  samples: ['in1', 'out1', 'in2', 'out2'].map((id) => ({ id, name: id, columns: [id] })),
  replicates: [{ id: 'r1', biological: 1, input: 'in1', output: 'out1' }, { id: 'r2', biological: 2, input: 'in2', output: 'out2' }],
  controls: { wildType: 'auto', synonymous: 'auto', nonsense: 'auto' },
  ...extra,
});
// The wild type; S2A scored; S2* low confidence (no output reads); K3R filtered (minimum input);
// K3= the synonymous variant; G4D not counted; a multi-variant, off the map.
const names = ['p.=', 'p.Ser2Ala', 'p.Ser2Ter', 'p.Lys3Arg', 'p.Lys3=', 'p.Gly4Asp', 'p.[Ser2Ala;Lys3Arg]'];
const col = (...x) => Float64Array.from(x);
const columns = { in1: col(1000, 50, 40, 3, 60, Number.NaN, 20), out1: col(1000, 30, 0, 9, 55, Number.NaN, 5), in2: col(900, 45, 35, 2, 50, Number.NaN, 25), out2: col(950, 25, 0, 8, 52, Number.NaN, 4) };
const results = scoreExperiment({ names, columns, design: design(), parameters: { ...DEFAULT_PARAMETERS, filters: { ...DEFAULT_PARAMETERS.filters, minInputCount: 5 } } }).results;

test('cells and their states; names as MAVE-HGVS; what is off the map', () => {
  const m = buildMapModel(results, design());
  const at = (p, aa) => cellAt(m, p, m.rows.indexOf(aa));
  assert.deepEqual([at(2, 'A').state, at(2, '*').state, at(3, 'R').state, at(3, 'K').state, at(4, 'D').state, at(4, 'W').state], [STATE.SCORED, STATE.LOW, STATE.FILTERED, STATE.SCORED, STATE.MISSING, STATE.MISSING]);
  assert.equal(at(1, 'M').state, STATE.REFERENCE, 'a reference residue with no synonymous variant');
  assert.equal(at(3, 'K').reference, true);
  assert.deepEqual([cellName(m, at(2, 'A')), cellName(m, at(3, 'K')), cellName(m, at(1, '*'))], ['p.Ser2Ala', 'p.Lys3=', 'p.Met1Ter']);
  assert.equal(m.offMap, 1);
  assert.equal(Object.values(m.counts).reduce((a, b) => a + b, 0), 4 * 21);
});

test('the score scale: centered on the wild type, symmetric; tiles leave cells undesigned', () => {
  const m = buildMapModel(results, design());
  assert.equal(colorPosition(m, 0), 0.5);
  assert.equal(colorPosition(m, m.domain.min), 0);
  assert.equal(colorPosition(m, m.domain.max), 1);
  assert.ok(Number.isNaN(colorPosition(m, Number.NaN)));
  const tiled = buildMapModel(results, design({ library: { level: 'variant', tiles: [{ id: 'a', start: 2, end: 3 }] } }));
  assert.equal(cellAt(tiled, 4, 0).state, STATE.NOT_DESIGNED);
  assert.equal(cellAt(tiled, 1, 0).state, STATE.NOT_DESIGNED);
  assert.match(describeMap(tiled, results)[0], /42 outside the designed tiles/);
});

test('rows in another order keep every cell; other values color by their own scale; refusals', () => {
  const a = buildMapModel(results, design(), { rowOrder: 'alphabetical' });
  const b = buildMapModel(results, design(), { rowOrder: 'hydrophobicity', colorBy: 'se' });
  assert.equal(cellAt(a, 2, a.rows.indexOf('A')).index, cellAt(b, 2, b.rows.indexOf('A')).index);
  assert.equal(b.domain.kind, 'sequential');
  assert.throws(() => buildMapModel(results, design({ targets: [] })), /target/);
  assert.throws(() => buildMapModel(results, design({ variants: { column: 'v', level: 'nucleotide' } })), /protein-level/);
});
