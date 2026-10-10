import assert from 'node:assert/strict';
import test from 'node:test';
import { boundedLeastSquares, dimsumFitness, dimsumSigma, fitNormalisation, replicateSubsets, scoreDimsumGroup, substitutionsOf, withDropout } from './score-dimsum.js';
import { checkParameters, DEFAULT_PARAMETERS, scoreExperiment } from './score.js';
import { REPLICATE_STATE } from './filters.js';

const close = (a, b, tol = 1e-12) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≠ ${b}`);

test('DiMSum\'s fitness: no pseudocount, a zero count no estimate, a dropout pseudocount on outputs of 0', () => {
  const inp = Float64Array.of(100, 50, 0, 20);
  const out = Float64Array.of(200, 25, 3, 0);
  const f = dimsumFitness(inp, out, 0);
  close(f[1], Math.log(25 / 50) - Math.log(2));
  assert.ok(Number.isNaN(f[2]) && Number.isNaN(f[3]));
  const raised = withDropout(inp, out, 1);
  assert.deepEqual([...raised], [200, 25, 3, 1], 'only an output of 0 whose input is above 0');
  close(dimsumFitness(inp, raised, 0)[3], Math.log(1 / 20) - Math.log(2));
  // σ: the four reciprocal counts, or the error model's (the scale not squared).
  close(dimsumSigma(50, 25, { wtIn: 100, wtOut: 200 }), Math.sqrt(1 / 25 + 1 / 50 + 1 / 200 + 1 / 100));
  close(dimsumSigma(50, 25, { scale: 0.9, input: 6, output: 1.5, reperror: 0.01 }), Math.sqrt(0.9 * (6 / 50 + 1.5 / 25) + 0.01));
});

test('substitutions from names, and replicate subsets in R\'s combn order', () => {
  assert.deepEqual(['p.=', 'p.Ala2Val', 'p.Ala2=', 'p.[Ala2Val;Leu5=]', 'p.[Ala2Val;Leu5Pro]', 'c.[4A>G;6T>C]', 'c.=', ''].map(substitutionsOf), [0, 1, 0, 1, 2, 2, 0, -1]);
  assert.deepEqual(replicateSubsets(3), [[0, 1, 2], [0, 1], [0, 2], [1, 2]]);
  assert.equal(replicateSubsets(4).length, 11);
  assert.deepEqual(replicateSubsets(4).slice(0, 5), [[0, 1, 2, 3], [0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]]);
});

test('least squares with lower bounds: the unconstrained answer when it is feasible, a bound otherwise', () => {
  // Rows y = X p, p = (3, 0.5, 2): with p₂ ≥ 1 the bound binds, and the others refit.
  const rows = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [0, 1, 1], [1, 0, 1], [1, 1, 1]];
  const p = [3, 0.5, 2];
  const G = new Float64Array(9);
  const g = new Float64Array(3);
  for (const x of rows) {
    const y = x[0] * p[0] + x[1] * p[1] + x[2] * p[2];
    for (let i = 0; i < 3; i += 1) {
      g[i] += x[i] * y;
      for (let j = 0; j < 3; j += 1) G[i * 3 + j] += x[i] * x[j];
    }
  }
  boundedLeastSquares(G, g, [0, 0, 0]).forEach((v, i) => close(v, p[i], 1e-12));
  const bound = boundedLeastSquares(G, g, [1, 1, 1]);
  close(bound[1], 1);
  // With p₂ fixed at 1, the others' least squares (by hand: rows 1, 3, 4, 6, 7 in p₁ and p₃).
  assert.ok(bound[0] < 3 && bound[2] < 2 && bound[0] >= 1 && bound[2] >= 1);
});

test('replicates that differ by a shift alone are brought together; one replicate keeps the counting error', () => {
  const x = Array.from({ length: 60 }, (_, i) => -2 + i / 20);
  const F = new Float64Array(60 * 3);
  x.forEach((v, i) => {
    F[i * 3] = v;
    F[i * 3 + 1] = v - 0.3;
    F[i * 3 + 2] = v + 0.2;
  });
  const nf = fitNormalisation(F, 3);
  assert.ok(nf.value < 1e-6, `${nf.value}`);
  nf.scale.forEach((a) => close(a, 1, 1e-6));
  close(nf.shift[1] - nf.shift[0], 0.3, 1e-6);
  const inp = Float64Array.of(100, 40, 30);
  const out = Float64Array.of(90, 10, 60);
  const one = scoreDimsumGroup({ inputs: [inp], outputs: [out], wtRow: 0, substitutions: [0, 1, 1] });
  close(one.se[0][1], Math.sqrt(1 / 10 + 1 / 40 + (1 / 90 + 1 / 100)));
  assert.match(scoreDimsumGroup({ inputs: [inp, inp], outputs: [Float64Array.of(0, 1, 1), out], wtRow: 0, substitutions: [0, 1, 1] }).refused, /wild type/);
});

test('the engine: DiMSum for two populations only, refused with a reason when its model cannot be fitted', () => {
  const target = { id: 't', name: 'Toy', sequenceType: 'protein', sequence: 'MSKGEELFTG' };
  const design = {
    format: 'mavescape-design', version: 1, name: 'toy', model: 'two-population', variants: { column: 'v', level: 'protein' }, targets: [target], library: { level: 'variant' },
    samples: ['in1', 'out1', 'in2', 'out2'].map((id) => ({ id, name: id, columns: [id] })),
    replicates: [{ id: 'r1', biological: 1, input: 'in1', output: 'out1' }, { id: 'r2', biological: 2, input: 'in2', output: 'out2' }],
    controls: { wildType: 'auto', synonymous: 'auto', nonsense: 'auto' },
  };
  const col = (...x) => Float64Array.from(x);
  const input = { names: ['p.=', 'p.Ser2Ala', 'p.Lys3Ter'], columns: { in1: col(1000, 50, 40), out1: col(1200, 20, 0), in2: col(900, 45, 35), out2: col(1000, 30, 1) }, design };
  const refused = scoreExperiment({ ...input, parameters: { ...DEFAULT_PARAMETERS, model: 'dimsum' } });
  assert.match(refused.errors[0], /needs 60 variants/);
  const plain = scoreExperiment({ ...input, parameters: { ...DEFAULT_PARAMETERS, model: 'dimsum', dimsumNormalise: false, dimsumErrorModel: false } }).results;
  close(plain.replicates[0].score[1], Math.log(20 / 50) - Math.log(1200 / 1000));
  assert.equal(plain.replicates[0].state[2], REPLICATE_STATE.NOT_ESTIMABLE, 'an output of 0: no estimate');
  assert.equal(plain.replicates[1].state[2], REPLICATE_STATE.USED);
  assert.match(checkParameters({ ...DEFAULT_PARAMETERS, model: 'dimsum' }, { ...design, model: 'time-series' }).errors.join(' '), /input and an output/);
  assert.deepEqual(checkParameters({ ...DEFAULT_PARAMETERS, model: 'dimsum', pseudocount: 0 }, design).errors, [], 'DiMSum takes no pseudocount');
});
