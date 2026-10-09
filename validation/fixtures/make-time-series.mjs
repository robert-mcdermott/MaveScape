// Writes the synthetic time-series fixture (validation suite `scoring`, wave 2 slice 2),
// deterministically:
//
//   node validation/fixtures/make-time-series.mjs
//
// time-series.csv: a 20-residue protein target, its wild type, a synonymous and a nonsense variant
// at most positions and 8 missense, grown in three biological replicates and sequenced at five
// unevenly spaced times (0, 1, 3, 6 and 10 generations). Counts are simulated (seed 20261010):
// library frequencies log-normal, growth at each variant's true effect per generation relative to
// the wild type, Poisson sequencing. On named variants, the time-series edge cases are planted
// (EDGE below). Also writes the design (time-series.design.json). The reference tools score the
// same table: Enrich2 (reference/generate_enrich2.py) and statsmodels
// (reference/generate_statsmodels.py).

import { writeFileSync } from 'node:fs';
import { createRandom } from '../../web/lib/random.js';
import { exp } from '../../web/lib/dmath.js';

const here = new URL('./', import.meta.url);
const random = createRandom(20261010);

const PROTEIN = 'MSKGEELFTGVVPILVELDG';
const THREE = { A: 'Ala', R: 'Arg', N: 'Asn', D: 'Asp', C: 'Cys', Q: 'Gln', E: 'Glu', G: 'Gly', H: 'His', I: 'Ile', L: 'Leu', K: 'Lys', M: 'Met', F: 'Phe', P: 'Pro', S: 'Ser', T: 'Thr', W: 'Trp', Y: 'Tyr', V: 'Val' };
const TIMES = [0, 1, 3, 6, 10];
const REPLICATES = 3;
const DEPTH = [300_000, 250_000, 280_000];

function poisson(lambda) {
  if (!(lambda > 0)) return 0;
  if (lambda < 30) {
    const limit = exp(-lambda);
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

// The variants: wild type, then by position synonymous, nonsense and 8 missense. Effects are the
// change in log frequency per generation relative to the wild type (so the slope on time scaled
// to 0–1 is ten times the effect).
const variants = [{ name: 'p.=', effect: 0, kind: 'wt' }];
for (let pos = 1; pos <= PROTEIN.length; pos += 1) {
  const ref = PROTEIN[pos - 1];
  if (pos > 1) {
    variants.push({ name: `p.${THREE[ref]}${pos}=`, effect: 0.005 * random.gaussian(), kind: 'synonymous' });
    variants.push({ name: `p.${THREE[ref]}${pos}Ter`, effect: -0.25 + 0.02 * random.gaussian(), kind: 'nonsense' });
  }
  const alts = Object.keys(THREE).filter((a) => a !== ref && a !== 'M');
  for (let j = 0; j < 8; j += 1) {
    const alt = alts.splice(random.int(alts.length), 1)[0];
    const effect = random() < 0.6 ? 0.015 * random.gaussian() : -0.04 - 0.18 * random();
    variants.push({ name: `p.${THREE[ref]}${pos}${THREE[alt]}`, effect, kind: 'missense' });
  }
}

// Library frequencies, growth and sequencing.
const weights = variants.map((v) => (v.kind === 'wt' ? 40 : exp(0.6 * random.gaussian())));
const counts = variants.map(() => Array.from({ length: REPLICATES }, () => []));
for (let r = 0; r < REPLICATES; r += 1) {
  const noise = variants.map(() => 0.004 * random.gaussian());
  for (const t of TIMES) {
    const grown = variants.map((v, i) => weights[i] * exp((v.effect + noise[i]) * t));
    const total = grown.reduce((a, b) => a + b, 0);
    variants.forEach((v, i) => {
      counts[i][r].push(poisson((DEPTH[r] * grown[i]) / total));
    });
  }
}

// The edge cases, each on the first variant of a kind at a position: [position, kind, what,
// [replicate (0-based), { time index: count (NaN: missing) }]]. Described in the design and
// checked by the suite (EDGE_CASES in the design's description, by name).
const EDGE = [
  [3, 'missense', 'missing at one later time (replicate 1, generation 6)', [[0, { 3: Number.NaN }]]],
  [4, 'missense', 'missing at two middle times (replicate 2, generations 1 and 3)', [[1, { 1: Number.NaN, 2: Number.NaN }]]],
  [5, 'nonsense', 'dropped out and written as missing at the last two times (every replicate)', [[0, { 3: Number.NaN, 4: Number.NaN }], [1, { 3: Number.NaN, 4: Number.NaN }], [2, { 3: Number.NaN, 4: Number.NaN }]]],
  [6, 'missense', 'missing at time 0 (replicate 3)', [[2, { 0: Number.NaN }]]],
  [7, 'missense', 'missing at three later times (replicate 1): too few points', [[0, { 1: Number.NaN, 2: Number.NaN, 3: Number.NaN }]]],
  [9, 'missense', 'rises then falls (every replicate): not a line', [[0, { 0: 200, 1: 600, 2: 1500, 3: 700, 4: 150 }], [1, { 0: 180, 1: 520, 2: 1300, 3: 600, 4: 140 }], [2, { 0: 210, 1: 640, 2: 1450, 3: 680, 4: 160 }]]],
  [10, 'missense', 'counted 0 at the last two times (every replicate): zeros are counts', [[0, { 3: 0, 4: 0 }], [1, { 3: 0, 4: 0 }], [2, { 3: 0, 4: 0 }]]],
];
const edgeNames = [];
for (const [position, kind, what, changes] of EDGE) {
  const i = variants.findIndex((v) => v.kind === kind && new RegExp(`^p\\.[A-Z][a-z]{2}${position}(?!\\d)`).test(v.name));
  if (i < 0) throw new Error(`no ${kind} variant at ${position}`);
  edgeNames.push([variants[i].name, what]);
  for (const [r, at] of changes) for (const [t, value] of Object.entries(at)) counts[i][r][Number(t)] = value;
}

const column = (r, t) => `rep${r + 1}_gen${t}`;
const header = ['hgvs_pro', ...Array.from({ length: REPLICATES }, (_, r) => TIMES.map((t) => column(r, t))).flat()];
const lines = [header.join(',')];
variants.forEach((v, i) => {
  lines.push([v.name, ...counts[i].flat().map((c) => (Number.isNaN(c) ? 'NA' : String(c)))].join(','));
});
writeFileSync(new URL('time-series.csv', here), `${lines.join('\n')}\n`);
writeFileSync(new URL('time-series.truth.csv', here), `hgvs_pro,effect_per_generation\n${variants.map((v) => `${v.name},${v.effect}`).join('\n')}\n`);

const design = {
  format: 'mavescape-design',
  version: 1,
  name: 'Synthetic time-series fixture (simulated)',
  description: `Simulated by validation/fixtures/make-time-series.mjs (seed 20261010): ${variants.length} variants of a 20-residue protein, 3 replicates sequenced at generations ${TIMES.join(', ')}. Edge cases: ${edgeNames.map(([name, what]) => `${name}, ${what}`).join('; ')}.`,
  model: 'time-series',
  variants: { column: 'hgvs_pro', level: 'protein' },
  targets: [{ id: 'synthetic-protein', name: 'Synthetic 20-residue protein', sequenceType: 'protein', sequence: PROTEIN }],
  library: { level: 'variant' },
  time: { unit: 'generation' },
  samples: Array.from({ length: REPLICATES }, (_, r) => TIMES.map((t) => ({ id: `rep${r + 1}-gen${t}`, name: `Replicate ${r + 1}, generation ${t}`, columns: [column(r, t)] }))).flat(),
  replicates: Array.from({ length: REPLICATES }, (_, r) => ({ id: `rep${r + 1}`, name: `Replicate ${r + 1}`, biological: r + 1, timepoints: TIMES.map((t) => ({ sample: `rep${r + 1}-gen${t}`, time: t })) })),
  controls: { wildType: 'p.=', synonymous: 'auto', nonsense: 'auto' },
};
writeFileSync(new URL('time-series.design.json', here), `${JSON.stringify(design, null, 2)}\n`);
console.log(`time-series.csv: ${variants.length} variants × ${REPLICATES} replicates × ${TIMES.length} times`);
