import assert from 'node:assert/strict';
import test from 'node:test';
import { checkParameters, controlRows, DEFAULT_PARAMETERS, PRESETS, scoreExperiment } from './score.js';
import { buildVariants } from './variants.js';
import { STAGE_BY_ID } from './filters.js';

const target = { id: 't', name: 'Toy', sequenceType: 'protein', sequence: 'MSKGEELFTG' };
const design = (extra = {}) => ({
  format: 'mavescape-design', version: 1, name: 'toy', model: 'two-population',
  variants: { column: 'v', level: 'protein' }, targets: [target], library: { level: 'variant' },
  samples: ['in1', 'out1', 'in2', 'out2'].map((id) => ({ id, name: id, columns: [id] })),
  replicates: [{ id: 'r1', biological: 1, input: 'in1', output: 'out1' }, { id: 'r2', biological: 2, input: 'in2', output: 'out2' }],
  controls: { wildType: 'auto', synonymous: 'auto', nonsense: 'auto' },
  ...extra,
});
const names = ['p.=', 'p.Ser2Ala', 'p.Lys3Ter', 'p.Gly4=', 'p.Glu5Asp', 'bogus'];
const col = (...x) => Float64Array.from(x);
const columns = () => ({
  in1: col(1000, 50, 40, 30, 0, 9), out1: col(1200, 20, 2, 35, 7, 9),
  in2: col(900, 45, 35, 25, 10, 9), out2: col(1000, Number.NaN, 1, 30, 9, 9),
});

test('a small experiment: every variant scored or left out with its stage', () => {
  const out = scoreExperiment({ names, columns: columns(), design: design(), parameters: DEFAULT_PARAMETERS });
  assert.ok(out.ok);
  const c = out.results.conditions[0];
  assert.equal(c.score[0], 0, 'the wild type is 0 in wild-type normalization');
  assert.deepEqual([...c.k], [2, 1, 2, 2, 1, 2]);
  assert.equal(c.reason[5], STAGE_BY_ID.get('identifier').code, 'an invalid name is left out, its measurements kept');
  assert.ok(Number.isFinite(out.results.replicates[0].score[5]));
  assert.equal(c.scored, 5);
});

test('the Enrich2-compatible preset needs every replicate; a combination it cannot do is refused', () => {
  const out = scoreExperiment({ names, columns: columns(), design: design(), parameters: PRESETS.enrich2.parameters });
  const c = out.results.conditions[0];
  assert.equal(c.reason[1], STAGE_BY_ID.get('replicates').code);
  assert.equal(c.se[0], 0);
  assert.match(checkParameters({ ...DEFAULT_PARAMETERS, combination: 'enrich2' }, design()).errors[0], /every replicate/);
  assert.match(checkParameters({ pseudocount: 0 }).errors[0], /positive pseudocount/);
});

test('conditions are scored separately; tiles set how many replicates a variant should have', () => {
  const d = design({
    conditions: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
    replicates: [{ id: 'r1', biological: 1, input: 'in1', output: 'out1', condition: 'a', tile: 't1' }, { id: 'r2', biological: 1, input: 'in2', output: 'out2', condition: 'b', tile: 't1' }],
    library: { level: 'variant', tiles: [{ id: 't1', start: 1, end: 3 }] },
  });
  const out = scoreExperiment({ names, columns: columns(), design: d, parameters: DEFAULT_PARAMETERS });
  assert.ok(out.ok, out.errors?.join(' '));
  assert.deepEqual(out.results.conditions.map((c) => c.replicates), [['r1'], ['r2']]);
  assert.equal(out.results.conditions[0].expected[4], 0, 'position 5 is outside the tile');
  assert.ok(out.results.warnings.some((w) => w.code === 'one-replicate'));
});

test('controls by kind or by name', () => {
  const v = buildVariants(['p.=', 'p.Gly4=', 'p.Lys3Ter', '_wt'], { target });
  const auto = controlRows(design(), v);
  assert.equal(auto.wtProblem, 'The wild type is on 2 rows; which one normalizes is ambiguous.');
  const named = controlRows(design({ controls: { wildType: '_wt', synonymous: ['p.Gly4='], nonsense: 'none' } }), v);
  assert.deepEqual([named.synonymous, named.nonsense], [[1], []]);
});
