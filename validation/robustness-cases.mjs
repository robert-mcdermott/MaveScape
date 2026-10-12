// Robustness to analysis choices for the validation suite `robustness` (wave 4, slice 4): simulated
// experiments with planted fragile results, and a run's check made as the window makes it (the
// specifications, the score worker's runRobustness, the summary).
//
// The planted experiment: a simulated two-population experiment of a 50-residue protein in four
// replicates, read deep (400 reads per variant), its missense effects either the wild type's (60%)
// or clearly lost (1 to 3, natural log), with no noise between replicates beyond counting (so that
// fixed effects, which assume none, are a reasonable choice). Among the missense variants with
// the wild type's effect and ordinary counts in every sample (0.7 to 1.5 times each sample's
// median), two sets are planted:
//   - one replicate driving an effect: replicate 1's output cut to a quarter (its score about
//     −1.4 there, the wild type's elsewhere);
//   - an effect whose size appears at one pseudocount: no reads after selection in any replicate,
//     so that its score rests on the pseudocount, and moves with it.

import { simulateExperiment } from '../web/lib/simulate.js';
import { parseTable } from '../web/lib/csv.js';
import { defaultParameters, scoreExperiment } from '../web/lib/score.js';
import { robustnessChoices, ROBUSTNESS_SEED, runRobustness, specifications, summarizeRobustness } from '../web/lib/robustness.js';
import { inputFor } from './roundtrip-cases.mjs';

const PROTEIN = 'MSKGEELFTGVVPILVELDGDVNGHKFSVSGEGEGDATYGKLTLKFICTT';

// { table, design, variants (the simulation's, by row), planted: { replicate: [names], zero:
// [names] } }.
export function plantedExperiment(seed) {
  const sim = simulateExperiment({ seed, replicates: 4, replicateNoise: 0, readsPerVariant: 400, neutralSd: 0, lossMin: 1, protein: PROTEIN });
  const lines = sim.csv.trim().split('\n');
  const header = lines[0].split(',');
  const rows = lines.slice(1).map((l) => l.split(','));
  const columnOf = (sampleId) => header.indexOf(sim.design.samples.find((x) => x.id === sampleId).columns[0]);
  const columns = sim.design.samples.map((x) => header.indexOf(x.columns[0]));
  const medians = columns.map((c) => {
    const xs = rows.map((r) => Number(r[c])).sort((a, b) => a - b);
    return xs[Math.floor(xs.length / 2)];
  });
  const typical = (i) => columns.every((c, k) => Number(rows[i][c]) >= 0.7 * medians[k] && Number(rows[i][c]) <= 1.5 * medians[k]);
  const nulls = sim.variants.map((v, i) => [v, i]).filter(([v, i]) => v.kind === 'missense' && v.effect === 0 && typical(i)).map(([, i]) => i);
  const replicate = nulls.filter((_, k) => k % 6 === 1).slice(0, 10);
  const zero = nulls.filter((_, k) => k % 6 === 4).slice(0, 10);
  const first = sim.design.replicates[0];
  for (const i of replicate) rows[i][columnOf(first.output)] = String(Math.round(Number(rows[i][columnOf(first.output)]) * 0.25));
  for (const i of zero) for (const r of sim.design.replicates) rows[i][columnOf(r.output)] = '0';
  const csv = `${[header.join(','), ...rows.map((r) => r.join(','))].join('\n')}\n`;
  return {
    table: parseTable(csv, { fileName: `planted-${seed}.csv` }),
    design: sim.design,
    planted: { replicate: replicate.map((i) => sim.variants[i].name), zero: zero.map((i) => sim.variants[i].name) },
    replicateName: first.name ?? first.id,
  };
}

// A run's check, as the window makes it: { results (the declared run's), choices, notes, specs,
// out (each specification's calls), summary, ms }.
export function checkTable(table, design, parameters, { max = 48 } = {}) {
  const t0 = performance.now();
  const scored = scoreExperiment({ ...inputFor(table, design), design, parameters });
  if (!scored.ok) throw new Error(scored.errors.join(' '));
  const { choices, notes } = robustnessChoices(design, parameters, scored.results);
  const specs = specifications(choices, { max, seed: ROBUSTNESS_SEED });
  const out = runRobustness({ ...inputFor(table, design), design, parameters, choices, specs });
  const summary = summarizeRobustness(out, choices, scored.results, design);
  return { results: scored.results, choices, notes, specs, out, summary, ms: performance.now() - t0 };
}

// The planted experiment checked, its declared analysis fixed effects (combination 'fixed') or
// MaveScape's defaults.
export function checkPlanted(seed, combination = 'fixed') {
  const p = plantedExperiment(seed);
  const parameters = { ...defaultParameters(p.design), combination };
  return { ...p, parameters, ...checkTable(p.table, p.design, parameters) };
}
