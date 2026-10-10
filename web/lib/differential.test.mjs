import assert from 'node:assert/strict';
import test from 'node:test';
import { contrastsOf, limmaDesign, pairReplicates } from './differential.js';
import { checkParameters, defaultParameters, DEFAULT_PARAMETERS, scoreExperiment } from './score.js';
import { log } from './dmath.js';

const close = (a, b, tol = 1e-13) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≠ ${b}`);

// One input per replicate, selected under two conditions; replicate 3 of A with its own input.
const target = { id: 't', name: 'Toy', sequenceType: 'protein', sequence: 'MSKGEELFTG' };
const design = {
  format: 'mavescape-design', version: 1, name: 'toy', model: 'two-population', variants: { column: 'v', level: 'protein' }, targets: [target], library: { level: 'variant' },
  conditions: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B', reference: true }],
  samples: ['in1', 'a1', 'b1', 'in2', 'a2', 'b2', 'in3', 'a3'].map((id) => ({ id, name: id, columns: [id] })),
  replicates: [
    { id: 'a1', biological: 1, condition: 'a', input: 'in1', output: 'a1' }, { id: 'b1', biological: 1, condition: 'b', input: 'in1', output: 'b1' },
    { id: 'a2', biological: 2, condition: 'a', input: 'in2', output: 'a2' }, { id: 'b2', biological: 2, condition: 'b', input: 'in2', output: 'b2' },
    { id: 'a3', biological: 3, condition: 'a', input: 'in3', output: 'a3' },
  ],
  controls: { wildType: 'auto', synonymous: 'auto', nonsense: 'auto' },
};
const col = (...x) => Float64Array.from(x);
const input = {
  names: ['p.=', 'p.Ser2Ala', 'p.Lys3Ter'],
  columns: { in1: col(1000, 50, 40), a1: col(1200, 20, 5), b1: col(900, 60, 4), in2: col(900, 45, 35), a2: col(1000, 30, 3), b2: col(1100, 50, 6), in3: col(800, 30, 30), a3: col(900, 25, 2) },
  design,
};

test('contrasts: each condition against the reference (the condition marked so, else the first)', () => {
  assert.deepEqual(contrastsOf(design).map((c) => [c.condition, c.reference, c.name]), [['a', 'b', 'A vs B']]);
  assert.deepEqual(contrastsOf({ ...design, conditions: design.conditions.map(({ reference, ...c }) => c) }).map((c) => c.reference), ['a']);
  assert.deepEqual(contrastsOf({ ...design, conditions: [design.conditions[0]] }), []);
});

test('pairs: replicates sharing their input and tile, the same biological replicate first', () => {
  const r = (id, condition, input, biological, tile = null) => ({ id, condition, samples: [input, `${id}-out`], biological, tile });
  const A = [r('a1', 'a', 'x', 1), r('a2', 'a', 'x', 2), r('a3', 'a', 'y', 3, 't2')];
  const B = [r('b2', 'b', 'x', 2), r('b1', 'b', 'x', 1), r('b3', 'b', 'y', 3, 't1')];
  const { pairs, unpaired } = pairReplicates(A, B);
  assert.deepEqual(pairs.map(([a, b]) => [a.id, b.id]), [['a2', 'b2'], ['a1', 'b1']]);
  assert.deepEqual(unpaired.map((x) => x.id), ['a3', 'b3'], 'another tile: no pair');
});

test('paired: the shared input cancels from the difference and from its variance', () => {
  const p = { ...DEFAULT_PARAMETERS, differential: 'paired' };
  const { results } = scoreExperiment({ ...input, parameters: p });
  const d = results.differential[0];
  assert.equal(d.method, 'paired');
  assert.deepEqual(d.pairs, [['b1', 'a1'], ['b2', 'a2']]);
  assert.deepEqual(d.unpaired, ['a3']);
  assert.match(d.note, /\(a3\).*not used/);
  // A vs B for p.Ser2Ala in pair 1: ln((20.5/1200.5)/(60.5/900.5)), the input gone; with fixed
  // effects over the pairs (REML with τ² = 0 here would agree).
  const pc = 0.5;
  const pair = (oa, wa, ob, wb) => ({ d: log((oa + pc) / (wa + pc)) - log((ob + pc) / (wb + pc)), v: 1 / (oa + pc) + 1 / (wa + pc) + 1 / (ob + pc) + 1 / (wb + pc) });
  const fixed = scoreExperiment({ ...input, parameters: { ...p, combination: 'fixed' } }).results.differential[0];
  const [x, y] = [pair(20, 1200, 60, 900), pair(30, 1000, 50, 1100)];
  const w = [1 / x.v, 1 / y.v];
  close(fixed.delta[1], (w[0] * x.d + w[1] * y.d) / (w[0] + w[1]));
  close(fixed.se[1], Math.sqrt(1 / (w[0] + w[1])));
  // As independent, the input is counted in both conditions: a larger SE for the same difference.
  const run = scoreExperiment({ ...input, parameters: { ...p, combination: 'fixed', differential: 'independent' } }).results;
  const ind = run.differential[0];
  const [cA, cB] = ['a', 'b'].map((id) => run.conditions.find((c) => c.id === id));
  close(ind.delta[1], cA.score[1] - cB.score[1]);
  close(ind.se[1], Math.sqrt(cA.se[1] ** 2 + cB.se[1] ** 2));
  close(ind.z[1], ind.delta[1] / ind.se[1]);
  assert.ok(ind.se[1] > fixed.se[1] * 1.15, `${ind.se[1]} against ${fixed.se[1]}`);
});

test('paired falls back to independent where the input does not cancel, and says why', () => {
  const ts = {
    ...design, model: 'time-series', time: { unit: 'generation' },
    samples: ['t0', 't1', 't2', 'u1', 'u2'].map((id) => ({ id, name: id, columns: [id] })),
    replicates: [
      { id: 'a1', biological: 1, condition: 'a', timepoints: [{ sample: 't0', time: 0 }, { sample: 't1', time: 1 }, { sample: 't2', time: 2 }] },
      { id: 'b1', biological: 1, condition: 'b', timepoints: [{ sample: 't0', time: 0 }, { sample: 'u1', time: 1 }, { sample: 'u2', time: 2 }] },
    ],
  };
  const columns = { t0: col(1000, 50, 40), t1: col(1100, 40, 20), t2: col(1200, 30, 10), u1: col(1000, 50, 30), u2: col(900, 55, 20) };
  const r = scoreExperiment({ names: input.names, columns, design: ts, parameters: { ...defaultParameters(ts), differential: 'paired' } });
  assert.equal(r.results.differential[0].method, 'independent');
  assert.match(r.results.differential[0].note, /slopes on time are compared as independent/);
});

test('limma: a term for each input library and for selection in each condition; refused without residual df', () => {
  const m = limmaDesign(design);
  assert.deepEqual(m.samples, ['in1', 'in2', 'in3', 'a1', 'b1', 'a2', 'b2', 'a3']);
  assert.equal(m.P, 5);
  // a1: library in1 + selection in a.
  assert.deepEqual(Array.from(m.X.slice(3 * 5, 4 * 5)), [1, 0, 0, 1, 0]);
  const two = { ...design, samples: design.samples.slice(0, 6), replicates: design.replicates.slice(0, 2) };
  assert.match(limmaDesign(two).refused, /no residual degrees of freedom/);
  assert.match(checkParameters({ ...DEFAULT_PARAMETERS, differential: 'limma', normalization: 'complete' }, design).errors.join(' '), /wild type or the synonymous variants/);
  assert.match(checkParameters({ ...DEFAULT_PARAMETERS, differential: 'limma' }, { ...design, model: 'time-series' }).errors.join(' '), /two-population design/);
});

test('differential scores only when asked: none by default (runs made before keep their hashes); for new runs with conditions limma where it applies, paired otherwise', () => {
  assert.equal(scoreExperiment({ ...input, parameters: DEFAULT_PARAMETERS }).results.differential, null);
  assert.equal(defaultParameters(design).differential, 'limma');
  assert.equal(defaultParameters(design, { summary: { byKind: {} } }).differential, 'paired', 'no wild type: complete cases, which limma does not take');
  const two = { ...design, samples: design.samples.slice(0, 6), replicates: design.replicates.slice(0, 2) };
  assert.equal(defaultParameters(two).differential, 'paired', 'one pair: no residual degrees of freedom for limma');
  assert.equal(defaultParameters(design, null, 'enrich2').differential, 'independent');
  assert.equal(defaultParameters({ ...design, conditions: [] }).differential, null);
  assert.match(checkParameters({ ...DEFAULT_PARAMETERS, differential: 'bayes' }, design).errors.join(' '), /Unknown differential method/);
});
