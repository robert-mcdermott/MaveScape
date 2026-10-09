// Writes the synthetic sort-seq fixture (validation suite `scoring`, wave 2 slice 3),
// deterministically:
//
//   node validation/fixtures/make-sort-seq.mjs
//
// sort-seq.csv: a simulated sort-seq experiment (web/lib/simulate.js, seed 20261011): 839 variants
// of a 40-residue protein, cells sorted by gates on a reporter into four bins in three replicates,
// each bin sequenced to the same depth. sort-seq.design.json records each bin's gates and the cells
// sorted into it; sort-seq.truth.csv each variant's true shift in log fluorescence from the wild
// type. fitdistrplus scores the same table (reference/generate_fitdistcens.R).

import { writeFileSync } from 'node:fs';
import { simulateExperiment } from '../../web/lib/simulate.js';

export const SORT_SEQ = { seed: 20261011, readsPerVariant: 60, sort: {} };

const here = new URL('./', import.meta.url);
const sim = simulateExperiment(SORT_SEQ);
writeFileSync(new URL('sort-seq.csv', here), sim.csv);
writeFileSync(new URL('sort-seq.design.json', here), `${JSON.stringify({ ...sim.design, name: 'Synthetic sort-seq fixture (simulated)' }, null, 2)}\n`);
writeFileSync(new URL('sort-seq.truth.csv', here), `hgvs_pro,log_fluorescence_shift\n${sim.variants.map((v) => `${v.name},${v.shift}`).join('\n')}\n`);
console.log(`sort-seq.csv: ${sim.variants.length} variants × ${sim.design.replicates.length} replicates × ${sim.design.replicates[0].bins.length} bins`);
