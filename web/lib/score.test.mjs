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

test('controls serve only at the positions the design gives them', () => {
  const v = buildVariants(['p.=', 'p.Ser2Ter', 'p.Lys3Ter', 'p.Gly4Ter', 'p.Gly4='], { target });
  const rows = (positions) => controlRows(design({ controls: { wildType: 'auto', synonymous: 'auto', nonsense: 'auto', positions } }), v);
  assert.deepEqual(rows(undefined).nonsense, [1, 2, 3]);
  assert.deepEqual(rows({ nonsense: { end: 3 } }).nonsense, [1, 2]);
  assert.deepEqual(rows({ nonsense: { start: 3 } }).nonsense, [2, 3]);
  assert.deepEqual(rows({ synonymous: { end: 3 } }).synonymous, []);
});

test('published scores (a design of model "scores"): read as given, each left out with its stage', async () => {
  const { defaultParameters } = await import('./score.js');
  const { intervalOf } = await import('./exports.js');
  const { outputDigest } = await import('./runs.js');
  const published = design({ model: 'scores', samples: [], replicates: [], scores: { score: 'score', se: 'se', ciLow: 'low', ciHigh: 'high' } });
  const p = defaultParameters(published);
  assert.equal(p.model, 'published');
  const input = { names, design: published, parameters: p, columns: { score: col(0, -0.4, Number.NaN, 0.02, -1.2, 5), se: col(0.01, 0.1, 0.2, 0.05, 0.3, 1), low: col(-0.02, -0.6, Number.NaN, -0.08, -1.8, 3), high: col(0.02, -0.2, Number.NaN, 0.12, -0.6, 7) } };
  const { ok, results } = scoreExperiment(input);
  assert.ok(ok);
  const c = results.conditions[0];
  assert.equal(results.replicates.length, 0);
  assert.equal(c.published, true);
  assert.deepEqual(Array.from(c.score).map((x) => (Number.isNaN(x) ? null : x)), [0, -0.4, null, 0.02, -1.2, null]);
  assert.equal(c.reason[2], STAGE_BY_ID.get('given').code, 'no score in the table');
  assert.equal(c.reason[5], STAGE_BY_ID.get('identifier').code, 'a name not valid against the target');
  assert.equal(c.scored, 4);
  assert.deepEqual(intervalOf(c, 1), [-0.6, -0.2], 'the interval as given, not computed');
  assert.deepEqual(c.flow.map((x) => x.stage), ['given', 'copy', 'identifier', 'class', 'excluded', 'se']);
  // Filters apply; the intervals count in the output's hash.
  const filtered = scoreExperiment({ ...input, parameters: { ...p, filters: { ...p.filters, maxSE: 0.2, excludeKinds: ['synonymous'] } } }).results.conditions[0];
  assert.equal(filtered.reason[4], STAGE_BY_ID.get('se').code);
  assert.equal(filtered.reason[3], STAGE_BY_ID.get('class').code);
  const other = scoreExperiment({ ...input, columns: { ...input.columns, low: col(-0.03, -0.6, Number.NaN, -0.08, -1.8, 3) } }).results;
  assert.notEqual(outputDigest(other), outputDigest(results));
  // Read as published only: not scored as counts, not rescaled, the columns it names present.
  assert.match(checkParameters({ ...p, model: 'ratio' }, published).errors.join(' '), /read as published/);
  assert.match(checkParameters({ ...p, rescale: 'nonsense-wt' }, published).errors.join(' '), /rescaling them comes with/);
  assert.match(checkParameters(p, design()).errors.join(' '), /need a design of published scores/);
  assert.match(scoreExperiment({ ...input, columns: { score: input.columns.score } }).errors.join(' '), /no column "se"/);
  const bare = scoreExperiment({ names, design: design({ model: 'scores', samples: [], replicates: [], scores: { score: 'score' } }), parameters: p, columns: { score: input.columns.score } }).results;
  assert.equal(bare.warnings[0].code, 'no-se');
});

test('published scores: a variant written twice with the same scores is read once; with different ones, refused', async () => {
  const { defaultParameters } = await import('./score.js');
  const published = design({ model: 'scores', samples: [], replicates: [], scores: { score: 'score' } });
  const twice = ['p.=', 'p.Ser2Ala', 'p.=', 'p.Lys3Ter'];
  const { results } = scoreExperiment({ names: twice, design: published, parameters: defaultParameters(published), columns: { score: col(0, -0.4, 0, -1) } });
  const c = results.conditions[0];
  assert.equal(c.reason[2], STAGE_BY_ID.get('copy').code);
  assert.equal(c.scored, 3);
  assert.match(results.info.join(' '), /1 row repeats an earlier row's variant and scores \(p\.=\): read once/);
  const differ = scoreExperiment({ names: twice, design: published, parameters: defaultParameters(published), columns: { score: col(0, -0.4, 0.1, -1) } });
  assert.match(differ.errors.join(' '), /on more than one row \(p\.=\) with different scores/);
});
