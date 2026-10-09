import assert from 'node:assert/strict';
import test from 'node:test';
import { checkThresholds, defaultThresholds, findingsFrom, measuresOf, overall, THRESHOLDS, withDefaultThresholds } from './findings.js';

// A QC result with what each finding reads, at chosen values.
const qc = (over = {}) => ({
  samples: [
    { id: 'in', name: 'in', counted: 100, total: 20000, readsPerVariant: 200, lowFraction: 0.01, missingFraction: 0, input: true, roles: [{ replicate: 'r1' }] },
    { id: 'out', name: 'out', counted: 100, total: 20000, readsPerVariant: 200, lowFraction: 0.05, missingFraction: 0, input: false, roles: [{ replicate: 'r1' }] },
  ],
  coverage: { assessed: true, fraction: 0.95, designed: 100, inTable: 97, observed: 95, length: 5, byClass: { missense: [90, 95], nonsense: [5, 5] } },
  conditions: [{ name: 'All', pairs: [{ a: 'r1', b: 'r2', n: 100, pearson: 0.9, spearman: 0.9, ratio: 1.2, bins: [] }], leaveOneOut: null, synonymous: [] }],
  measures: { lowCount: 10, agreementInput: 10 },
  scores: null,
  ...over,
});

test('every finding passes, or is not assessed, on a good experiment; each has its parts', () => {
  const findings = findingsFrom(qc(), defaultThresholds());
  assert.deepEqual(findings.filter((f) => f.status !== 'pass').map((f) => [f.id, f.status]), [['dropout', 'na'], ['outlier-replicate', 'na'], ['separation', 'na'], ['resolution', 'na'], ['scored-fraction', 'na']]);
  for (const f of findings) for (const key of ['title', 'value', 'explanation', 'threshold', 'rationale', 'plot']) assert.ok(typeof f[key] === 'string', `${f.id}.${key}`);
  assert.equal(overall(findings).status, 'pass');
});

test('statuses follow the thresholds, at their edges', () => {
  const at = (r) => findingsFrom(qc({ conditions: [{ name: 'All', pairs: [{ a: 'r1', b: 'r2', n: 100, pearson: r, spearman: r, ratio: 1, bins: [] }], leaveOneOut: null, synonymous: [] }] }), defaultThresholds()).find((f) => f.id === 'agreement').status;
  assert.deepEqual([at(0.8), at(0.79), at(0.5), at(0.49)], ['pass', 'review', 'review', 'fail']);
  const empty = findingsFrom(qc({ samples: [{ id: 'in', name: 'in', counted: 0, total: 0, readsPerVariant: 0, lowFraction: Number.NaN, missingFraction: 1, input: true, roles: [{ replicate: 'r1' }] }] }), defaultThresholds());
  const missing = empty.find((f) => f.id === 'missing-sample');
  assert.deepEqual([missing.status, missing.blocking, missing.affected.replicates], ['fail', true, ['r1']]);
  assert.deepEqual(overall(empty).blocking, ['missing-sample']);
});

test('thresholds: defaults, merged changes, checks, measures', () => {
  const d = defaultThresholds();
  assert.equal(Object.keys(d).length, THRESHOLDS.length);
  const t = withDefaultThresholds({ agreement: { review: 0.9 }, lowCount: 5, unknown: 1 });
  assert.deepEqual(t.agreement, { review: 0.9, fail: 0.5 });
  assert.equal(t.unknown, undefined);
  assert.deepEqual(measuresOf(t), { lowCount: 5, agreementInput: 10 });
  assert.deepEqual(checkThresholds(d), []);
  assert.equal(checkThresholds({ excessVariance: { review: 5, fail: 2 } }).length, 1);
});

test('dropout: a sample with no zeros whose missing variants had been depleted is to review', () => {
  const at = (d) => findingsFrom(qc({ conditions: [{ name: 'All', pairs: [], leaveOneOut: null, synonymous: [], dropout: [d] }] }), defaultThresholds()).find((f) => f.id === 'dropout');
  const base = { replicate: 'r1', sample: 'out', by: 'trend', counted: 1000, missing: 300, zeros: 0, missingTrend: 0.01, countedTrend: 0.4 };
  assert.equal(at(base).status, 'review');
  assert.match(at(base).explanation, /dropped out as missing rather than 0/);
  assert.equal(at({ ...base, zeros: 12 }).status, 'pass', 'zeros are written as 0: missing means something else');
  assert.equal(at({ ...base, missingTrend: 0.3 }).status, 'pass', 'not depleted before going missing');
  assert.equal(at({ ...base, missing: 20 }).status, 'pass', 'too few to matter');
});
