// Simulated two-population experiments with known true effects (roadmap wave 1: the QC fixtures of
// slice 6 and the simulated example of slice 8). Seeded and deterministic; everything it makes is
// labeled simulated.
//
// For each biological replicate: the input is sequenced from the plasmid library (frequencies
// log-normal); cells are transformed from the same library (a bottleneck of `inputCells` per
// variant on average: Poisson sampling); they grow under selection by each variant's true effect
// plus the replicate's own noise (`replicateNoise`, the SD of a per-variant multiplicative
// factor); `outputCells` per variant are sampled after selection (a second bottleneck); the output
// is sequenced. Reads are Poisson. A bottleneck of N cells against D reads per variant adds about
// D/N times the counting variance; replicate noise adds a constant variance (DiMSum's
// multiplicative and additive error terms).

import { createRandom } from './random.js';

const THREE = { A: 'Ala', R: 'Arg', N: 'Asn', D: 'Asp', C: 'Cys', Q: 'Gln', E: 'Glu', G: 'Gly', H: 'His', I: 'Ile', L: 'Leu', K: 'Lys', M: 'Met', F: 'Phe', P: 'Pro', S: 'Ser', T: 'Thr', W: 'Trp', Y: 'Tyr', V: 'Val' };
const AMINO_ACIDS = Object.keys(THREE);

export const DEFAULT_SIMULATION = {
  seed: 1,
  protein: 'MSKGEELFTGVVPILVELDGDVNGHKFSVSGEGEGDATYG',
  replicates: 3,
  readsPerVariant: 200, // input and output depth, reads per variant on average
  outputReadsPerVariant: null, // when the output is sequenced to another depth
  libraryLogSd: 0.5, // spread of library frequencies (log-normal SD)
  inputCells: Infinity, // cells per variant entering selection (Infinity: no bottleneck)
  outputCells: Infinity, // cells per variant sampled after selection
  replicateNoise: 0.05, // SD of the per-variant noise of selection, per replicate (a number or one per replicate)
  missing: [], // [{ replicate: 1, sample: 'output' }]: samples written as missing
};

function poisson(random, lambda) {
  if (!(lambda > 0)) return 0;
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

// The variants of a protein: the wild type, then by position a synonymous variant, a nonsense
// variant and every missense substitution, with true effects (natural-log fitness, WT = 0).
export function simulatedVariants(protein, random) {
  const out = [{ name: 'p.=', kind: 'wild type', effect: 0 }];
  for (let pos = 1; pos <= protein.length; pos += 1) {
    const ref = THREE[protein[pos - 1]];
    if (pos > 1) {
      out.push({ name: `p.${ref}${pos}=`, kind: 'synonymous', effect: 0.02 * random.gaussian() });
      out.push({ name: `p.${ref}${pos}Ter`, kind: 'nonsense', effect: -3 + 0.25 * random.gaussian() });
    }
    for (const aa of AMINO_ACIDS) {
      if (aa === protein[pos - 1]) continue;
      const effect = random() < 0.6 ? 0.15 * random.gaussian() : -0.3 - 2.7 * random();
      out.push({ name: `p.${ref}${pos}${THREE[aa]}`, kind: pos === 1 ? 'start lost' : 'missense', effect });
    }
  }
  return out;
}

// A simulated experiment: { csv (the count table's text), design, variants: [{ name, kind,
// effect }], options }.
export function simulateExperiment(options = {}) {
  const o = { ...DEFAULT_SIMULATION, ...options };
  const random = createRandom(o.seed);
  const variants = simulatedVariants(o.protein, random);
  const V = variants.length;
  const weights = variants.map((v) => (v.kind === 'wild type' ? 20 : Math.exp(o.libraryLogSd * random.gaussian())));
  const total = weights.reduce((a, b) => a + b, 0);
  const f = weights.map((w) => w / total);
  const noise = (r) => (Array.isArray(o.replicateNoise) ? o.replicateNoise[r] : o.replicateNoise);
  const outDepth = o.outputReadsPerVariant ?? o.readsPerVariant;
  const columns = [];
  for (let r = 0; r < o.replicates; r += 1) {
    const input = f.map((x) => poisson(random, o.readsPerVariant * V * x));
    const cells = Number.isFinite(o.inputCells) ? f.map((x) => poisson(random, o.inputCells * V * x)) : f.map((x) => x);
    const grown = cells.map((c, i) => c * Math.exp(variants[i].effect + noise(r) * random.gaussian()));
    const grownTotal = grown.reduce((a, b) => a + b, 0);
    let after = grown.map((g) => g / grownTotal);
    if (Number.isFinite(o.outputCells)) {
      const sampled = after.map((x) => poisson(random, o.outputCells * V * x));
      const s = sampled.reduce((a, b) => a + b, 0);
      after = sampled.map((x) => x / s);
    }
    const output = after.map((x) => poisson(random, outDepth * V * x));
    const missing = (sample) => o.missing.some((m) => m.replicate === r + 1 && m.sample === sample);
    columns.push({ name: `input_rep${r + 1}`, values: missing('input') ? null : input });
    columns.push({ name: `output_rep${r + 1}`, values: missing('output') ? null : output });
  }
  const lines = [['hgvs_pro', ...columns.map((c) => c.name)].join(',')];
  variants.forEach((v, i) => lines.push([v.name, ...columns.map((c) => (c.values ? String(c.values[i]) : 'NA'))].join(',')));
  const design = {
    format: 'mavescape-design',
    version: 1,
    name: 'Simulated two-population experiment',
    description: `Simulated by MaveScape (web/lib/simulate.js, seed ${o.seed}): not real data. ${o.replicates} replicates, ${o.readsPerVariant} reads per variant${Number.isFinite(o.inputCells) ? `, ${o.inputCells} cells per variant into selection` : ''}${Number.isFinite(o.outputCells) ? `, ${o.outputCells} cells per variant after it` : ''}.`,
    model: 'two-population',
    variants: { column: 'hgvs_pro', level: 'protein' },
    targets: [{ id: 'simulated', name: 'Simulated protein', sequenceType: 'protein', sequence: o.protein }],
    library: { level: 'variant' },
    samples: columns.map((c) => ({ id: c.name, name: c.name, columns: [c.name] })),
    replicates: Array.from({ length: o.replicates }, (_, r) => ({ id: `rep${r + 1}`, name: `Replicate ${r + 1}`, biological: r + 1, input: `input_rep${r + 1}`, output: `output_rep${r + 1}` })),
    controls: { wildType: 'p.=', synonymous: 'auto', nonsense: 'auto' },
  };
  return { csv: `${lines.join('\n')}\n`, design, variants, options: o };
}
