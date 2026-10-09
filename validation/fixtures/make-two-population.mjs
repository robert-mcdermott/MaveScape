// Writes the synthetic two-population fixture (validation suite `scoring`), deterministically:
//
//   node validation/fixtures/make-two-population.mjs
//
// two-population.csv: a 20-codon target, its wild type, one synonymous and one nonsense variant
// at most positions and 8 missense, counted before and after selection in three biological
// replicates (replicate 3's output sequenced on two lanes: technical replicates). Counts are
// simulated (seed 20261008): input library frequencies log-normal, selection by each variant's
// true effect, Poisson sequencing. On named variants, the PRD's two-population edge cases are
// planted (EDGE below). Also writes the target (two-population.fasta) and the design
// (two-population.design.json). Every column is named for what it is, and the `codon` column
// gives each variant as dms_variants writes codon substitutions, so that reference tools can
// score the same table (reference/generate_enrich2.py, reference/generate_dms_variants.py).

import { writeFileSync } from 'node:fs';
import { createRandom } from '../../web/lib/random.js';
import { CODONS } from '../../web/lib/target.js';

const here = new URL('./', import.meta.url);
const random = createRandom(20261008);

const PROTEIN = 'MSKGEELFTGVVPILVELDG';
// One codon per amino acid (the first in this list), so each protein variant is one codon variant.
const CODON_OF = {
  A: 'GCT', R: 'CGT', N: 'AAT', D: 'GAT', C: 'TGT', Q: 'CAA', E: 'GAA', G: 'GGT', H: 'CAT', I: 'ATT',
  L: 'CTG', K: 'AAA', M: 'ATG', F: 'TTT', P: 'CCG', S: 'TCT', T: 'ACC', W: 'TGG', Y: 'TAT', V: 'GTT', '*': 'TAA',
};
// A synonymous codon for each amino acid that has one.
const SYNONYMOUS_CODON = { A: 'GCC', R: 'CGC', N: 'AAC', D: 'GAC', C: 'TGC', Q: 'CAG', E: 'GAG', G: 'GGC', H: 'CAC', I: 'ATC', L: 'CTC', K: 'AAG', F: 'TTC', P: 'CCC', S: 'TCC', T: 'ACG', Y: 'TAC', V: 'GTC' };
const DNA = [...PROTEIN].map((aa) => CODON_OF[aa]).join('');
const THREE = { A: 'Ala', R: 'Arg', N: 'Asn', D: 'Asp', C: 'Cys', Q: 'Gln', E: 'Glu', G: 'Gly', H: 'His', I: 'Ile', L: 'Leu', K: 'Lys', M: 'Met', F: 'Phe', P: 'Pro', S: 'Ser', T: 'Thr', W: 'Trp', Y: 'Tyr', V: 'Val', '*': 'Ter' };
for (const [aa, codon] of Object.entries(SYNONYMOUS_CODON)) if (CODONS[codon] !== aa || CODONS[CODON_OF[aa]] !== aa) throw new Error(`codon table: ${aa} ${codon}`);

const REPLICATES = 3;
const INPUT_DEPTH = [400_000, 300_000, 350_000];
const OUTPUT_DEPTH = [380_000, 320_000, 330_000];

function poisson(lambda) {
  if (lambda < 30) {
    const limit = Math.exp(-lambda);
    let k = 0;
    let p = random();
    while (p > limit) {
      k += 1;
      p *= random();
    }
    return k;
  }
  return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * random.gaussian()));
}

// The variants: wild type, then by position synonymous, nonsense and 8 missense.
const variants = [{ name: 'p.=', codon: '', effect: 0, kind: 'wt' }];
for (let pos = 1; pos <= PROTEIN.length; pos += 1) {
  const ref = PROTEIN[pos - 1];
  const wtCodon = CODON_OF[ref];
  if (SYNONYMOUS_CODON[ref] && pos > 1) variants.push({ name: `p.${THREE[ref]}${pos}=`, codon: `${wtCodon}${pos}${SYNONYMOUS_CODON[ref]}`, effect: 0.05 * random.gaussian(), kind: 'synonymous' });
  if (pos > 1) variants.push({ name: `p.${THREE[ref]}${pos}Ter`, codon: `${wtCodon}${pos}TAA`, effect: -2.5 + 0.2 * random.gaussian(), kind: 'nonsense' });
  const alts = Object.keys(CODON_OF).filter((a) => a !== ref && a !== '*' && a !== 'M');
  for (let j = 0; j < 8; j += 1) {
    const alt = alts.splice(random.int(alts.length), 1)[0];
    const effect = random() < 0.6 ? 0.15 * random.gaussian() : -0.4 - 1.8 * random();
    variants.push({ name: `p.${THREE[ref]}${pos}${THREE[alt]}`, codon: `${wtCodon}${pos}${CODON_OF[alt]}`, effect, kind: 'missense' });
  }
}

// Library frequencies and simulated counts.
const weights = variants.map((v) => (v.kind === 'wt' ? 40 : Math.exp(0.6 * random.gaussian())));
const sumWeights = weights.reduce((a, b) => a + b, 0);
const meanFitness = variants.reduce((a, v, i) => a + weights[i] * Math.exp(v.effect), 0) / sumWeights;
const counts = variants.map(() => ({ input: [], output: [] }));
for (let r = 0; r < REPLICATES; r += 1) {
  variants.forEach((v, i) => {
    const f = weights[i] / sumWeights;
    counts[i].input[r] = poisson(INPUT_DEPTH[r] * f);
    counts[i].output[r] = poisson((OUTPUT_DEPTH[r] * f * Math.exp(v.effect + 0.08 * random.gaussian())) / meanFitness);
  });
}

// The edge cases (PRD, "Two-population scoring"), each on a named variant. NaN: missing (NA).
const EDGE = {
  'p.Lys3Arg': { what: 'zero in both samples (replicate 1)', set: (c) => { c.input[0] = 0; c.output[0] = 0; } },
  'p.Gly4Asp': { what: 'zero only in the input (replicate 1)', set: (c) => { c.input[0] = 0; c.output[0] = 25; } },
  'p.Glu5Ter': { what: 'zero only in the output (every replicate)', set: (c) => { c.output = [0, 0, 0]; } },
  'p.Glu6Lys': { what: 'a missing measurement: output of replicate 2 not given', set: (c) => { c.output[1] = Number.NaN; } },
  'p.Leu7Pro': { what: 'absent from replicate 3 (neither sample)', set: (c) => { c.input[2] = Number.NaN; c.output[2] = Number.NaN; } },
  'p.Phe8Ser': { what: 'very low depth (2 and 1 reads)', set: (c) => { c.input = [2, 2, 2]; c.output = [1, 1, 1]; } },
  'p.Thr9Ala': { what: 'observed but filtered by a minimum input count of 10 (3 input reads)', set: (c) => { c.input = [3, 3, 3]; c.output = [4, 2, 3]; } },
  'p.Gly10Ala': { what: 'not counted at all', set: (c) => { c.input = [Number.NaN, Number.NaN, Number.NaN]; c.output = [Number.NaN, Number.NaN, Number.NaN]; } },
};
for (const [name, edge] of Object.entries(EDGE)) {
  const i = variants.findIndex((v) => v.name === name);
  if (i < 0) {
    // The variant was not drawn: add it.
    const pos = Number(name.match(/\d+/)[0]);
    const alt = Object.entries(THREE).find(([, t]) => name.endsWith(t))[0];
    variants.push({ name, codon: `${CODON_OF[PROTEIN[pos - 1]]}${pos}${CODON_OF[alt]}`, effect: -0.5, kind: alt === '*' ? 'nonsense' : 'missense' });
    counts.push({ input: [500, 450, 480], output: [300, 280, 260] });
  }
  edge.set(counts[variants.findIndex((v) => v.name === name)]);
}

// Replicate 3's output on two lanes (technical replicates): the reads split between them.
const lanes = counts.map((c) => {
  const total = c.output[2];
  if (Number.isNaN(total)) return [Number.NaN, Number.NaN];
  let a = 0;
  for (let k = 0; k < total; k += 1) if (random() < 0.45) a += 1;
  return [a, total - a];
});

const cell = (x) => (Number.isNaN(x) ? 'NA' : String(x));
const header = ['hgvs_pro', 'codon', 'input_rep1', 'output_rep1', 'input_rep2', 'output_rep2', 'input_rep3', 'output_rep3_lane1', 'output_rep3_lane2'];
const lines = [header.join(',')];
variants.forEach((v, i) => {
  const c = counts[i];
  lines.push([v.name, v.codon, cell(c.input[0]), cell(c.output[0]), cell(c.input[1]), cell(c.output[1]), cell(c.input[2]), cell(lanes[i][0]), cell(lanes[i][1])].join(','));
});
writeFileSync(new URL('two-population.csv', here), `${lines.join('\n')}\n`);
writeFileSync(new URL('two-population.fasta', here), `>synthetic-20 Synthetic 20-codon target (MaveScape validation fixture)\n${DNA}\n`);

const sample = (id, name, columns) => ({ id, name, columns });
const design = {
  format: 'mavescape-design',
  version: 1,
  name: 'Synthetic two-population fixture (simulated)',
  description: `Simulated by validation/fixtures/make-two-population.mjs (seed 20261008): ${variants.length} variants of a 20-codon target, 3 replicates, replicate 3's output on two lanes. Edge cases: ${Object.entries(EDGE).map(([n, e]) => `${n}, ${e.what}`).join('; ')}.`,
  model: 'two-population',
  variants: { column: 'hgvs_pro', level: 'protein' },
  targets: [{ id: 'synthetic-20', name: 'Synthetic 20-codon target', sequenceType: 'dna', sequence: DNA, codingStart: 1 }],
  library: { level: 'variant' },
  samples: [
    sample('input-1', 'Input, replicate 1', ['input_rep1']),
    sample('output-1', 'Output, replicate 1', ['output_rep1']),
    sample('input-2', 'Input, replicate 2', ['input_rep2']),
    sample('output-2', 'Output, replicate 2', ['output_rep2']),
    sample('input-3', 'Input, replicate 3', ['input_rep3']),
    sample('output-3', 'Output, replicate 3 (two lanes)', ['output_rep3_lane1', 'output_rep3_lane2']),
  ],
  replicates: [1, 2, 3].map((r) => ({ id: `rep${r}`, name: `Replicate ${r}`, biological: r, input: `input-${r}`, output: `output-${r}` })),
  controls: { wildType: 'p.=', synonymous: 'auto', nonsense: 'auto' },
  ignoredColumns: [{ column: 'codon', reason: 'the variant as a codon substitution (for dms_variants)' }],
};
writeFileSync(new URL('two-population.design.json', here), `${JSON.stringify(design, null, 2)}\n`);
console.log(`wrote two-population.csv (${variants.length} variants), two-population.fasta, two-population.design.json`);
