// Fixtures for the validation suite `qc` (wave 1, slice 6): simulated experiments
// (web/lib/simulate.js), each made to have one problem, and the findings each must raise, no more
// and no fewer. Three seeds each, so that a pass is not luck.

import { simulateExperiment } from '../web/lib/simulate.js';
import { parseTable } from '../web/lib/csv.js';
import { computeQC } from '../web/lib/qc.js';
import { findingsFrom, defaultThresholds } from '../web/lib/findings.js';
import { scoreExperiment, defaultParameters } from '../web/lib/score.js';

export const QC_SEEDS = [20261009, 20261010, 20261011];

// [name, simulation options, the findings that must not pass (id: status)]
export const QC_FIXTURES = [
  ['a clean experiment', {}, {}],
  ['poor replicate agreement (replicate noise SD 0.7)', { replicateNoise: 0.7 }, { agreement: 'review', 'excess-variance': 'fail' }],
  ['one failing replicate (replicate 3, noise SD 0.9)', { replicateNoise: [0.05, 0.05, 0.9] }, { agreement: 'review', 'excess-variance': 'fail', 'outlier-replicate': ['review', 'fail'] }],
  ['a severe bottleneck (20 cells per variant into selection)', { inputCells: 20 }, { 'excess-variance': ['review', 'fail'] }],
  ['a low-count tail (library spread SD 1.6, 60 reads per variant)', { libraryLogSd: 1.6, readsPerVariant: 60 }, { 'low-count': 'review' }],
  ['a missing sample (replicate 2\'s output)', { missing: [{ replicate: 2, sample: 'output' }] }, { 'missing-sample': 'fail' }],
  // Time series (wave 2, slice 2), scored by weighted regression.
  ['a clean time series (5 times)', { times: [0, 2, 4, 6, 8] }, {}],
  ['a time series with a bottleneck at every passage (8 cells per variant)', { times: [0, 2, 4, 6, 8], passageCells: 8 }, { agreement: ['review', 'fail'], 'excess-variance': 'fail', 'time-fit': 'fail' }],
];

// The simulation as the app reads it, scored with MaveScape's defaults for its design when it can
// be (weighted regression for a time series), and its QC.
export function runFixture(options, seed, thresholds = defaultThresholds()) {
  const sim = simulateExperiment({ ...options, seed });
  const table = parseTable(sim.csv);
  const names = table.columns[0].values;
  const columns = Object.fromEntries(table.columns.slice(1).map((c) => [c.name, c.numeric ?? new Float64Array(table.rows).fill(Number.NaN)]));
  const scored = scoreExperiment({ names, columns, design: sim.design, parameters: defaultParameters(sim.design) });
  const qc = computeQC({ names, columns, design: sim.design, results: scored.ok ? scored.results : null });
  return { sim, table, names, columns, scored, qc, findings: findingsFrom(qc, thresholds) };
}

// The findings that did not pass, as { id: status } ('na' left out).
export const raised = (findings) => Object.fromEntries(findings.filter((f) => f.status === 'review' || f.status === 'fail').map((f) => [f.id, f.status]));

export function matches(got, expected) {
  const keys = new Set([...Object.keys(got), ...Object.keys(expected)]);
  for (const k of keys) {
    const want = expected[k];
    if (want === undefined || got[k] === undefined) return false;
    if (Array.isArray(want) ? !want.includes(got[k]) : got[k] !== want) return false;
  }
  return true;
}
