import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMapModel } from './map-model.js';
import { scoreExperiment, DEFAULT_PARAMETERS } from './score.js';
import { combineKeys, combineSelections, evaluateQuery, parseQuery, queryContext, QueryError, queryUses, selectByQuery } from './query.js';
import { VERDICT } from './robustness.js';

// The map model's toy run (map-model.test.mjs): S2A scored; S2* low confidence; K3R filtered; K3=
// the synonymous variant; G4D not counted; position 1 a methionine (its substitutions start lost).
const target = { id: 't', name: 'Toy', sequenceType: 'protein', sequence: 'MSKG', offset: 100 };
const design = {
  format: 'mavescape-design', version: 1, name: 'toy', model: 'two-population',
  variants: { column: 'v', level: 'protein' }, targets: [target], library: { level: 'variant' },
  samples: ['in1', 'out1', 'in2', 'out2'].map((id) => ({ id, name: id, columns: [id] })),
  replicates: [{ id: 'r1', biological: 1, input: 'in1', output: 'out1' }, { id: 'r2', biological: 2, input: 'in2', output: 'out2' }],
  controls: { wildType: 'auto', synonymous: 'auto', nonsense: 'auto' },
};
const names = ['p.=', 'p.Ser2Ala', 'p.Ser2Ter', 'p.Lys3Arg', 'p.Lys3=', 'p.Gly4Asp', 'p.[Ser2Ala;Lys3Arg]'];
const col = (...x) => Float64Array.from(x);
const columns = { in1: col(1000, 50, 40, 3, 60, Number.NaN, 20), out1: col(1000, 30, 0, 9, 55, Number.NaN, 5), in2: col(900, 45, 35, 2, 50, Number.NaN, 25), out2: col(950, 25, 0, 8, 52, Number.NaN, 4) };
const results = scoreExperiment({ names, columns, design, parameters: { ...DEFAULT_PARAMETERS, filters: { ...DEFAULT_PARAMETERS.filters, minInputCount: 5 } } }).results;
const model = buildMapModel(results, design);
const context = (extra = {}) => queryContext({ model, results, design, ...extra });
const keys = (text, extra) => selectByQuery(text, context(extra)).keys;

test('query: the roadmap\'s phrases parse as written; juxtaposition, "with" and "whose" mean and', () => {
  assert.deepEqual(parseQuery('missense at 40–80 with SE < 0.2'), {
    type: 'and', left: { type: 'and', left: { type: 'kind', name: 'missense' }, right: { type: 'positions', key: 'pos', ranges: [[40, 80]] } }, right: { type: 'compare', key: 'se', operator: '<', value: 0.2 },
  });
  assert.deepEqual(parseQuery('variants whose class depends on the pseudocount'), { type: 'and', left: { type: 'all' }, right: { type: 'depends', scope: 'class', choices: ['pseudocount'], word: 'pseudocount' } });
  assert.deepEqual(parseQuery('in "Core" and not in Surface').right, { type: 'not', operand: { type: 'set', name: 'Surface', start: 21 } });
  assert.equal(parseQuery('score ≤ -1').operator, '<=');
  assert.ok(queryUses(parseQuery('missense and (fragile or in feature Gla)'), 'feature'));
  assert.ok(queryUses(parseQuery('depends on model'), 'verdict'));
});

test('query: mistakes are named, with where they are', () => {
  const fails = (text, pattern, position) => assert.throws(() => parseQuery(text), (e) => e instanceof QueryError && pattern.test(e.message) && (position === undefined || e.position === position));
  fails('missense bananas', /Unknown word "bananas"/, 9);
  fails('se < ', /needs a number/);
  fails('se 0.2', /needs a comparison/);
  fails('from Q9', /is not a residue/);
  fails('at 4-x', /not a position/);
  fails('in "Core', /Unclosed quote/, 3);
  fails('depends on bananas', /names a choice/);
  fails('(missense', /Missing "\)"/);
  fails('', /empty/);
});

test('query: classes, states, positions and residues on the toy map, in order along it', () => {
  assert.equal(keys('missense').length, 3 * 19, 'positions 2–4; position 1\'s substitutions lose the start');
  assert.equal(keys('start-lost').length, 19);
  assert.deepEqual(keys('scored'), ['p.Ser2Ala', 'p.Ser2Ter', 'p.Lys3=']);
  assert.deepEqual(keys('low'), ['p.Ser2Ter']);
  assert.deepEqual(keys('confident'), ['p.Ser2Ala', 'p.Lys3=']);
  assert.deepEqual(keys('filtered'), ['p.Lys3Arg']);
  assert.equal(keys('missing').length, 4 * 21 - 4);
  assert.deepEqual(keys('missing at 4 to D'), ['p.Gly4Asp']);
  assert.deepEqual(keys('to stop at 2-3'), ['p.Ser2Ter', 'p.Lys3Ter']);
  assert.deepEqual(keys('from S,K and synonymous'), ['p.Ser2=', 'p.Lys3=']);
  assert.deepEqual(keys('not missense and at 2'), ['p.Ser2=', 'p.Ser2Ter']);
  assert.deepEqual(keys('refpos 102'), keys('at 2'));
  assert.equal(keys('pos > 3').length, 21);
  assert.deepEqual(keys('se < 100'), keys('scored'), 'an unscored variant never passes a comparison');
  assert.deepEqual(keys('replicates >= 1'), keys('scored'));
  assert.deepEqual(keys('lower or higher or neutral'), keys('scored'), 'every scored variant has a class');
  // The order is the target's, then variants.js's amino acids, whatever the map's rows.
  const other = buildMapModel(results, design, { rowOrder: 'hydrophobicity' });
  assert.deepEqual(selectByQuery('at 2', queryContext({ model: other, results, design })).keys, keys('at 2'));
});

test('query: saved selections, the selection now, and set operations', () => {
  const sets = [{ name: 'Core', keys: ['p.Ser2Ala', 'p.Ser2Ter', 'p.Lys3Arg'] }, { name: 'Edge', keys: ['p.Ser2Ter', 'p.Gly4Asp'] }];
  assert.deepEqual(keys('in Core or in Edge', { sets }), ['p.Ser2Ala', 'p.Ser2Ter', 'p.Lys3Arg', 'p.Gly4Asp']);
  assert.deepEqual(keys('in "core" and not in Edge', { sets }), ['p.Ser2Ala', 'p.Lys3Arg']);
  assert.deepEqual(keys('in Core and in Edge', { sets }), ['p.Ser2Ter']);
  assert.deepEqual(keys('selected and low', { selected: ['p.Ser2Ter', 'p.Lys3='] }), ['p.Ser2Ter']);
  assert.throws(() => keys('in Nowhere', { sets }), /no saved selection "Nowhere": "Core", "Edge"/);
  assert.deepEqual(combineKeys(['a', 'b'], ['b', 'c'], 'add'), ['a', 'b', 'c']);
  assert.deepEqual(combineKeys(['a', 'b'], ['b', 'c'], 'intersect'), ['b']);
  assert.deepEqual(combineKeys(['a', 'b'], ['b', 'c'], 'subtract'), ['a']);
  // A combination keeps a query when both have one, so that it can be made again.
  assert.deepEqual(combineSelections({ keys: ['a'], query: 'missense' }, { keys: ['b'], query: 'low' }, 'subtract'), { keys: ['a'], query: '(missense) and not (low)' });
  assert.equal(combineSelections({ keys: ['a'], query: null }, { keys: ['b'], query: 'low' }, 'add').query, null);
  assert.equal(combineSelections(null, { keys: ['b'], query: 'low' }, 'add').query, 'low');
});

test('query: features beside the map, and robustness verdicts, or what is missing', () => {
  const features = [{ type: 'Region', label: 'Loop', start: 2, end: 3 }, { type: 'Disulfide bond', label: 'Disulfide bond', start: 4, end: 4 }];
  assert.deepEqual(keys('feature loop and to A', { features }), ['p.Ser2Ala', 'p.Lys3Ala']);
  assert.equal(keys('in feature "disulfide*" and missense', { features }).length, 19);
  assert.throws(() => keys('feature helix', { features }), /No feature is named "helix". Beside this map: Loop, Disulfide bond/);
  assert.throws(() => keys('feature loop'), (e) => e.need === 'features');
  assert.throws(() => keys('fragile'), (e) => e instanceof QueryError && e.need === 'robustness');
  // A checked run: S2A fragile on the pseudocount, S2* size-dependent on it, K3= robust.
  const n = results.rows;
  const row = (name) => results.variants.key.indexOf(name);
  const verdict = new Uint8Array(n);
  const dependsOnIds = new Array(n).fill(null);
  verdict[row('p.Ser2Ala')] = VERDICT.FRAGILE;
  dependsOnIds[row('p.Ser2Ala')] = ['pseudocount'];
  verdict[row('p.Ser2Ter')] = VERDICT.SIZE;
  dependsOnIds[row('p.Ser2Ter')] = ['pseudocount', 'leaveOut'];
  verdict[row('p.Lys3=')] = VERDICT.ROBUST;
  const robustness = { targets: [{ id: `condition:${results.conditions[0].id}`, verdict, dependsOnIds }] };
  assert.deepEqual(keys('fragile', { robustness }), ['p.Ser2Ala']);
  assert.deepEqual(keys('variants whose class depends on the pseudocount', { robustness }), ['p.Ser2Ala']);
  assert.deepEqual(keys('depends on the pseudocount', { robustness }), ['p.Ser2Ala', 'p.Ser2Ter']);
  assert.deepEqual(keys('size depends on leave-out', { robustness }), ['p.Ser2Ter']);
  assert.deepEqual(keys('scored and not robust', { robustness }), ['p.Ser2Ala', 'p.Ser2Ter']);
  assert.equal(evaluateQuery(parseQuery('robust'), context({ robustness })).count, 1);
});
