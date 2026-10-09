// Writes the synthetic barcode fixture (validation suite `scoring`, wave 2 slice 4),
// deterministically:
//
//   node validation/fixtures/make-barcodes.mjs
//
// A simulated barcoded experiment (web/lib/simulate.js, seed 20261012): the codon variants of a
// 30-codon gene, two libraries (the replicates) in which each variant carries its own random
// barcodes, 3.5 on average, counted before and after selection. barcodes.csv: the counts, one row
// per barcode, missing in the other library's columns. barcodes.map.csv: the barcode-to-variant
// map (MAVE-HGVS, and the codon substitutions as dms_variants writes them), with 1.5% of barcodes
// given a second variant (in conflict) and 1% missing. barcodes.design.json: the design of the
// counts with the map applied. barcodes.truth.csv: each variant's true effect;
// barcodes.barcode-truth.csv: each barcode's library, variant, planted shift (2% are off by 1.5–3)
// and place in the map; barcodes.fasta: the gene. dms_variants scores the same barcodes
// (reference/generate_dms_variants.py).

import { writeFileSync } from 'node:fs';
import { simulateExperiment } from '../../web/lib/simulate.js';

export const BARCODES = { seed: 20261012, protein: 'MSKGEELFTGVVPILVELDGDVNGHKFSVS', replicates: 2, barcodes: { perVariant: 3.5, readsPerBarcode: 100, noise: 0.1, outliers: 0.02, conflicts: 0.015, unmapped: 0.01 } };

const here = new URL('./', import.meta.url);
const sim = simulateExperiment(BARCODES);
writeFileSync(new URL('barcodes.csv', here), sim.csv);
writeFileSync(new URL('barcodes.map.csv', here), sim.map);
writeFileSync(new URL('barcodes.design.json', here), `${JSON.stringify({ ...sim.design, name: 'Synthetic barcode fixture (simulated)' }, null, 2)}\n`);
writeFileSync(new URL('barcodes.fasta', here), `>simulated-gene Simulated gene (simulated data)\n${sim.design.targets[0].sequence}\n`);
writeFileSync(new URL('barcodes.truth.csv', here), `hgvs_pro,effect\n${sim.variants.map((v) => `${v.name},${v.effect}`).join('\n')}\n`);
writeFileSync(new URL('barcodes.barcode-truth.csv', here), `barcode,replicate,hgvs_pro,shift,map\n${sim.barcodes.map((b) => `${b.id},${b.replicate},${b.variant},${b.outlier},${b.unmapped ? 'missing' : b.conflict ? 'conflict' : 'yes'}`).join('\n')}\n`);
console.log(`barcodes.csv: ${sim.barcodes.length} barcodes of ${sim.variants.length} variants in ${BARCODES.replicates} libraries`);
