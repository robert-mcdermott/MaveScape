// Writes the synthetic two-condition fixture (validation suite `scoring`, wave 2 slice 6),
// deterministically:
//
//   node validation/fixtures/make-two-condition.mjs
//
// two-condition.csv: the simulator's 40-residue protein (web/lib/simulate.js, seed 20261013), one
// input per replicate selected under two conditions ("Without ligand", the reference, and "With
// ligand", where missense variants at positions 12–16 lose about 1.5 in log fitness). Replicate 4
// is selected without the ligand only: its input is shared with no other condition, so it has no
// partner. On named variants, the differential's edge cases are planted (EDGE below). Also writes
// the design (two-condition.design.json) and the truth (two-condition.truth.csv: each variant's
// effect in each condition and the differential). Enrich2 (reference/generate_enrich2.py) and
// mutscan (reference/generate_mutscan.R) score the same table.

import { writeFileSync } from 'node:fs';
import { simulateExperiment } from '../../web/lib/simulate.js';

const here = new URL('./', import.meta.url);

const sim = simulateExperiment({
  seed: 20261013, replicates: 4, readsPerVariant: 150, inputCells: 40, replicateNoise: 0.05,
  conditions: { names: ['Without ligand', 'With ligand'], site: [12, 13, 14, 15, 16], shift: -1.5, siteSd: 0.4 },
});
const lines = sim.csv.trim().split('\n').map((l) => l.split(','));
const header = lines[0];
// Replicate 4 under the ligand is not part of the experiment.
const dropped = header.indexOf('b_rep4');
const rows = lines.map((cells) => cells.filter((_, j) => j !== dropped));
const columns = rows[0];
const at = (name, column) => {
  const row = rows.find((r) => r[0] === name);
  if (!row) throw new Error(`no variant ${name}`);
  return { row, j: columns.indexOf(column) };
};
const set = (name, column, value) => {
  const { row, j } = at(name, column);
  row[j] = value;
};

// The edge cases: [variant, what is planted, how].
const EDGE = [
  ['p.Glu5Lys', 'missing from the ligand\'s output of replicate 2: two pairs', () => set('p.Glu5Lys', 'b_rep2', 'NA')],
  ['p.Gly4Asp', 'missing from replicate 1\'s shared input: neither condition measures it there', () => set('p.Gly4Asp', 'input_rep1', 'NA')],
  ['p.Lys3Arg', 'missing from every output with the ligand: no differential', () => ['b_rep1', 'b_rep2', 'b_rep3'].forEach((c) => set('p.Lys3Arg', c, 'NA'))],
  ['p.Leu7Pro', '0 reads with the ligand in replicate 3 (counted as 0)', () => set('p.Leu7Pro', 'b_rep3', '0')],
  ['p.Thr9Ile', 'no input reads in replicate 2 (left out there by the minimum input count)', () => set('p.Thr9Ile', 'input_rep2', '0')],
];
for (const [, , plant] of EDGE) plant();

writeFileSync(new URL('two-condition.csv', here), `${rows.map((r) => r.join(',')).join('\n')}\n`);
const design = {
  ...sim.design,
  name: 'Two-condition fixture',
  description: `${sim.design.description} Replicate 4 is selected without the ligand only. Edge cases planted on: ${EDGE.map(([v, what]) => `${v} (${what})`).join('; ')}.`,
  samples: sim.design.samples.filter((s) => s.id !== 'b_rep4'),
  replicates: sim.design.replicates.filter((r) => r.output !== 'b_rep4'),
};
writeFileSync(new URL('two-condition.design.json', here), `${JSON.stringify(design, null, 2)}\n`);
writeFileSync(new URL('two-condition.truth.csv', here), `hgvs_pro,kind,effect_without,effect_with,differential\n${sim.variants.map((v) => [v.name, v.kind, v.effects[0], v.effects[1], v.differential].join(',')).join('\n')}\n`);
console.log(`two-condition.csv: ${rows.length - 1} variants, ${columns.length - 1} samples; ${EDGE.length} edge cases`);
