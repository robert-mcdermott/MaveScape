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
//
// With `times` (wave 2, slice 2), a time series instead: the library grows from time 0, each
// variant's log frequency relative to the wild type changing by its true effect over the whole
// course (so the effect is the slope on time scaled to 0–1, what regression scores), sequenced at
// every time; `passageCells` per variant sampled at each later time is a bottleneck at every
// passage, which scatters the time courses about their lines.
//
// With `sort` (wave 2, slice 3), a sort-seq experiment instead: each variant's cells have log
// fluorescence N(μ_wt + scale × effect, σ²) (plus the replicate's noise), `cellsPerVariant` cells
// per variant on average are sorted by gates into ordered bins (the outer bins open), and each
// bin is sequenced to `readsPerVariant` reads per variant on average. The design records each
// bin's gates and the cells sorted into it; the truth is the shift in μ.
//
// With `barcodes` (wave 2, slice 4), a barcoded two-population experiment instead: the target is
// DNA (one codon per amino acid), each variant a codon substitution (and a few double mutants),
// each replicate an independent library in which every variant carries 1 + Poisson(perVariant − 1)
// random barcodes (the wild type `wildType`). A barcode's cells grow by its variant's effect, plus
// the barcode's own noise (`noise`, the SD of a multiplicative factor: clonal variation), and a
// fraction `outliers` of barcodes is off by 1.5–3 in either direction (a second mutation, a
// misread barcode). The counts are a table of barcodes; which variant each carries is in a
// separate barcode-to-variant map, in which a fraction `conflicts` of barcodes is given a second,
// different variant (both are wrong to trust) and a fraction `unmapped` is missing.
//
// With `conditions` (wave 2, slice 6), two conditions selected from one input: each replicate's
// input library and transformed cells (with any bottleneck) are shared, then split into a
// selection under each condition, each with its own noise and output. In the second condition,
// missense variants at the `site` positions change by `shift` ± `siteSd` (a binding site that
// matters only there); every other variant's effect is the same in both, so the true differential
// is known and 0 for most variants.

import { exp, log, normalCdf } from './dmath.js';
import { createRandom, poisson } from './random.js';

const THREE = { A: 'Ala', R: 'Arg', N: 'Asn', D: 'Asp', C: 'Cys', Q: 'Gln', E: 'Glu', G: 'Gly', H: 'His', I: 'Ile', L: 'Leu', K: 'Lys', M: 'Met', F: 'Phe', P: 'Pro', S: 'Ser', T: 'Thr', W: 'Trp', Y: 'Tyr', V: 'Val' };
const AMINO_ACIDS = Object.keys(THREE);

// One codon per amino acid, and a synonymous codon for those that have one (barcoded simulations).
const CODON_OF = {
  A: 'GCT', R: 'CGT', N: 'AAT', D: 'GAT', C: 'TGT', Q: 'CAA', E: 'GAA', G: 'GGT', H: 'CAT', I: 'ATT',
  L: 'CTG', K: 'AAA', M: 'ATG', F: 'TTT', P: 'CCG', S: 'TCT', T: 'ACC', W: 'TGG', Y: 'TAT', V: 'GTT', '*': 'TAA',
};
const SYNONYMOUS_CODON = { A: 'GCC', R: 'CGC', N: 'AAC', D: 'GAC', C: 'TGC', Q: 'CAG', E: 'GAG', G: 'GGC', H: 'CAC', I: 'ATC', L: 'CTC', K: 'AAG', F: 'TTC', P: 'CCC', S: 'TCC', T: 'ACG', Y: 'TAC', V: 'GTC' };
const ONE = Object.fromEntries(Object.entries(THREE).map(([one, three]) => [three, one]));

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
  times: null, // [0, …]: a time series sampled at these times
  passageCells: Infinity, // cells per variant carried over at each later time point of a time series
  timeUnit: 'generation',
  sort: null, // { gates: [log offsets from the wild type's μ], sigma, effectScale, cellsPerVariant, wtFluorescence, values }
  barcodes: null, // { perVariant, wildType, readsPerBarcode, noise, outliers, conflicts, unmapped, doubles, length }
  conditions: null, // { names: [reference, other], site: [positions], shift, siteSd }
};

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
  const weights = variants.map((v) => (v.kind === 'wild type' ? 20 : exp(o.libraryLogSd * random.gaussian())));
  const total = weights.reduce((a, b) => a + b, 0);
  const f = weights.map((w) => w / total);
  const noise = (r) => (Array.isArray(o.replicateNoise) ? o.replicateNoise[r] : o.replicateNoise);
  const outDepth = o.outputReadsPerVariant ?? o.readsPerVariant;
  if (o.times) return simulateTimeSeries(o, random, variants, f, noise);
  if (o.sort) return simulateSort(o, random, variants, f, noise);
  if (o.barcodes) return simulateBarcodes(o, random, variants);
  if (o.conditions) return simulateConditions(o, random, variants, f, noise, outDepth);
  const columns = [];
  for (let r = 0; r < o.replicates; r += 1) {
    const input = f.map((x) => poisson(random, o.readsPerVariant * V * x));
    const cells = Number.isFinite(o.inputCells) ? f.map((x) => poisson(random, o.inputCells * V * x)) : f.map((x) => x);
    const grown = cells.map((c, i) => c * exp(variants[i].effect + noise(r) * random.gaussian()));
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

// Two conditions from shared inputs (see the top of this file).
function simulateConditions(o, random, variants, f, noise, outDepth) {
  const V = variants.length;
  const c = { names: ['Condition A', 'Condition B'], site: [], shift: -1.5, siteSd: 0.4, ...o.conditions };
  const site = new Set(c.site);
  // The effects in each condition, and the true differential.
  for (const v of variants) {
    const position = Number(/^p\.[A-Z][a-z]{2}(\d+)/.exec(v.name)?.[1] ?? 0);
    const change = v.kind === 'missense' && site.has(position) ? c.shift + c.siteSd * random.gaussian() : 0;
    v.effects = [v.effect, v.effect + change];
    v.differential = change;
  }
  const ids = ['a', 'b'];
  const columns = [];
  for (let r = 0; r < o.replicates; r += 1) {
    const input = f.map((x) => poisson(random, o.readsPerVariant * V * x));
    const cells = Number.isFinite(o.inputCells) ? f.map((x) => poisson(random, o.inputCells * V * x)) : f.map((x) => x);
    columns.push({ name: `input_rep${r + 1}`, values: input });
    for (let k = 0; k < 2; k += 1) {
      const grown = cells.map((x, i) => x * exp(variants[i].effects[k] + noise(r) * random.gaussian()));
      const total = grown.reduce((a, b) => a + b, 0);
      columns.push({ name: `${ids[k]}_rep${r + 1}`, values: grown.map((g) => poisson(random, (outDepth * V * g) / total)) });
    }
  }
  const lines = [['hgvs_pro', ...columns.map((x) => x.name)].join(',')];
  variants.forEach((v, i) => lines.push([v.name, ...columns.map((x) => String(x.values[i]))].join(',')));
  const design = {
    format: 'mavescape-design',
    version: 1,
    name: 'Simulated two-condition experiment',
    description: `Simulated by MaveScape (web/lib/simulate.js, seed ${o.seed}): not real data. One input per replicate selected under two conditions, ${o.replicates} replicates, ${o.readsPerVariant} reads per variant${Number.isFinite(o.inputCells) ? `, ${o.inputCells} cells per variant into selection` : ''}; in ${c.names[1]}, missense variants at positions ${[...site].join(', ')} change by ${c.shift} on average.`,
    model: 'two-population',
    variants: { column: 'hgvs_pro', level: 'protein' },
    targets: [{ id: 'simulated', name: 'Simulated protein', sequenceType: 'protein', sequence: o.protein }],
    library: { level: 'variant' },
    conditions: c.names.map((name, k) => ({ id: ids[k], name, ...(k === 0 ? { reference: true } : {}) })),
    samples: columns.map((x) => ({ id: x.name, name: x.name, columns: [x.name] })),
    replicates: Array.from({ length: o.replicates }, (_, r) => ids.map((id, k) => ({ id: `${id}-rep${r + 1}`, name: `${c.names[k]}, replicate ${r + 1}`, biological: r + 1, condition: id, input: `input_rep${r + 1}`, output: `${id}_rep${r + 1}` }))).flat(),
    controls: { wildType: 'p.=', synonymous: 'auto', nonsense: 'auto' },
  };
  return { csv: `${lines.join('\n')}\n`, design, variants, options: o };
}

const BARCODE_DEFAULTS = { perVariant: 3.5, wildType: 30, readsPerBarcode: 100, libraryLogSd: 0.6, noise: 0.1, outliers: 0.02, conflicts: 0.015, unmapped: 0.01, doubles: 20, length: 16 };

// A codon variant for a protein variant of simulatedVariants: its codon substitutions as
// dms_variants writes them (GCT2GTT), or null for one with no codon (a synonymous Met or Trp).
function codonsOf(name, protein) {
  if (name === 'p.=') return '';
  const m = /^p\.([A-Z][a-z]{2})(\d+)(=|[A-Z][a-z]{2})$/.exec(name);
  const pos = Number(m[2]);
  const wt = CODON_OF[protein[pos - 1]];
  const alt = m[3] === '=' ? SYNONYMOUS_CODON[protein[pos - 1]] : m[3] === 'Ter' ? CODON_OF['*'] : CODON_OF[ONE[m[3]]];
  return alt ? `${wt}${pos}${alt}` : null;
}

function simulateBarcodes(o, random, singles) {
  const bc = { ...BARCODE_DEFAULTS, ...o.barcodes };
  const dna = [...o.protein].map((aa) => CODON_OF[aa]).join('');
  const variants = singles.map((v) => ({ ...v, codons: codonsOf(v.name, o.protein) })).filter((v) => v.codons !== null);
  // Double mutants: two missense substitutions at different positions, their effects added.
  const missense = variants.filter((v) => v.kind === 'missense');
  for (let d = 0; d < bc.doubles; d += 1) {
    const a = missense[random.int(missense.length)];
    const b = missense[random.int(missense.length)];
    const position = (v) => Number(/^[ACGT]{3}(\d+)/.exec(v.codons)[1]);
    if (position(a) === position(b)) continue;
    const [first, second] = position(a) < position(b) ? [a, b] : [b, a];
    if (variants.some((v) => v.name === `p.[${first.name.slice(2)};${second.name.slice(2)}]`)) continue;
    variants.push({ name: `p.[${first.name.slice(2)};${second.name.slice(2)}]`, kind: 'multi-variant', effect: a.effect + b.effect, codons: `${first.codons} ${second.codons}` });
  }
  const used = new Set();
  const newBarcode = () => {
    for (;;) {
      let s = '';
      for (let k = 0; k < bc.length; k += 1) s += 'ACGT'[random.int(4)];
      if (!used.has(s)) {
        used.add(s);
        return s;
      }
    }
  };
  // Each replicate's library: barcodes, their variants, frequencies and counts.
  const rows = [];
  for (let r = 0; r < o.replicates; r += 1) {
    const library = [];
    variants.forEach((v, i) => {
      const k = v.kind === 'wild type' ? bc.wildType : 1 + poisson(random, bc.perVariant - 1);
      for (let j = 0; j < k; j += 1) {
        const outlier = random() < bc.outliers ? (random() < 0.5 ? -1 : 1) * (1.5 + 1.5 * random()) : 0;
        library.push({ id: newBarcode(), replicate: r, variant: i, weight: exp(bc.libraryLogSd * random.gaussian()), outlier });
      }
    });
    const B = library.length;
    const total = library.reduce((a, x) => a + x.weight, 0);
    const grown = library.map((x) => (x.weight / total) * exp(variants[x.variant].effect + bc.noise * random.gaussian() + x.outlier));
    const grownTotal = grown.reduce((a, b) => a + b, 0);
    library.forEach((x, j) => {
      x.pre = poisson(random, (bc.readsPerBarcode * B * x.weight) / total);
      x.post = poisson(random, (bc.readsPerBarcode * B * grown[j]) / grownTotal);
    });
    for (const x of library) rows.push(x);
  }
  // The barcode-to-variant map: unmapped barcodes left out, conflicting ones given a second variant.
  const map = [];
  for (const x of rows) {
    x.unmapped = random() < bc.unmapped;
    x.conflict = !x.unmapped && random() < bc.conflicts;
    if (x.unmapped) continue;
    map.push({ barcode: x.id, variant: variants[x.variant] });
    if (x.conflict) {
      let other = x.variant;
      while (other === x.variant) other = random.int(variants.length);
      map.push({ barcode: x.id, variant: variants[other] });
    }
  }
  const shuffled = (list) => {
    for (let i = list.length - 1; i > 0; i -= 1) {
      const j = random.int(i + 1);
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  };
  shuffled(rows);
  shuffled(map);
  const samples = [];
  for (let r = 0; r < o.replicates; r += 1) samples.push(`pre_rep${r + 1}`, `post_rep${r + 1}`);
  const lines = [['barcode', ...samples].join(',')];
  for (const x of rows) lines.push([x.id, ...samples.map((s, k) => (Math.floor(k / 2) !== x.replicate ? 'NA' : String(k % 2 ? x.post : x.pre)))].join(','));
  const mapLines = ['barcode,hgvs_pro,codon_substitutions', ...map.map((m) => `${m.barcode},${m.variant.name},${m.variant.codons}`)];
  const design = {
    format: 'mavescape-design',
    version: 1,
    name: 'Simulated barcoded experiment',
    description: `Simulated by MaveScape (web/lib/simulate.js, seed ${o.seed}): not real data. ${o.replicates} libraries (replicates) of barcoded codon variants, ${bc.perVariant} barcodes per variant on average, ${bc.readsPerBarcode} reads per barcode; ${(100 * bc.outliers).toFixed(1)}% of barcodes off from their variant, ${(100 * bc.conflicts).toFixed(1)}% given two variants by the map and ${(100 * bc.unmapped).toFixed(1)}% missing from it.`,
    model: 'two-population',
    variants: { column: 'hgvs_pro', level: 'protein' },
    targets: [{ id: 'simulated', name: 'Simulated gene', sequenceType: 'dna', sequence: dna }],
    library: { level: 'barcode', barcodeColumn: 'barcode' },
    samples: samples.map((s) => ({ id: s, name: s, columns: [s] })),
    replicates: Array.from({ length: o.replicates }, (_, r) => ({ id: `rep${r + 1}`, name: `Replicate ${r + 1}`, biological: r + 1, input: `pre_rep${r + 1}`, output: `post_rep${r + 1}` })),
    controls: { wildType: 'p.=', synonymous: 'auto', nonsense: 'auto' },
  };
  return {
    csv: `${lines.join('\n')}\n`,
    map: `${mapLines.join('\n')}\n`,
    design,
    variants: variants.map(({ name, kind, effect, codons }) => ({ name, kind, effect, codons })),
    barcodes: rows.map((x) => ({ id: x.id, replicate: x.replicate + 1, variant: variants[x.variant].name, outlier: x.outlier, unmapped: x.unmapped, conflict: x.conflict })),
    options: o,
  };
}

const SORT_DEFAULTS = { gates: [-0.9, -0.45, -0.1], sigma: 0.4, effectScale: 0.5, cellsPerVariant: 100, wtFluorescence: 1000, values: null };

function simulateSort(o, random, variants, f, noise) {
  const sort = { ...SORT_DEFAULTS, ...o.sort };
  const V = variants.length;
  const B = sort.gates.length + 1;
  const muWt = log(sort.wtFluorescence);
  // Gates as an instrument records them: rounded to whole fluorescence units.
  const gate = (k) => Math.round(exp(muWt + sort.gates[k]));
  const bounds = Array.from({ length: B }, (_, b) => ({ lower: b === 0 ? null : gate(b - 1), upper: b === B - 1 ? null : gate(b) }));
  const values = sort.values ?? Array.from({ length: B }, (_, b) => (b + 1) / B);
  const truth = variants.map((v) => sort.effectScale * v.effect);
  const columns = [];
  const cellsSorted = [];
  for (let r = 0; r < o.replicates; r += 1) {
    // Cells of each variant in each bin.
    const cells = variants.map((v, i) => {
      const mu = muWt + truth[i] + noise(r) * random.gaussian();
      const k = poisson(random, sort.cellsPerVariant * V * f[i]);
      return bounds.map((g) => {
        const lo = g.lower === null ? 0 : normalCdf((log(g.lower) - mu) / sort.sigma);
        const hi = g.upper === null ? 1 : normalCdf((log(g.upper) - mu) / sort.sigma);
        return poisson(random, k * (hi - lo));
      });
    });
    for (let b = 0; b < B; b += 1) {
      const inBin = cells.reduce((a, c) => a + c[b], 0);
      cellsSorted.push(inBin);
      const name = `rep${r + 1}_bin${b + 1}`;
      columns.push({ name, cells: inBin, values: cells.map((c) => poisson(random, (o.readsPerVariant * V * c[b]) / Math.max(1, inBin))) });
    }
  }
  const lines = [['hgvs_pro', ...columns.map((c) => c.name)].join(',')];
  variants.forEach((v, i) => lines.push([v.name, ...columns.map((c) => String(c.values[i]))].join(',')));
  const design = {
    format: 'mavescape-design',
    version: 1,
    name: 'Simulated sort-seq experiment',
    description: `Simulated by MaveScape (web/lib/simulate.js, seed ${o.seed}): not real data. ${o.replicates} replicates, cells sorted into ${B} bins by gates on a reporter (log fluorescence SD ${sort.sigma}), ${sort.cellsPerVariant} cells and ${o.readsPerVariant} reads per variant on average in each bin.`,
    model: 'bins',
    variants: { column: 'hgvs_pro', level: 'protein' },
    targets: [{ id: 'simulated', name: 'Simulated protein', sequenceType: 'protein', sequence: o.protein }],
    library: { level: 'variant' },
    bins: { weight: 'rank' },
    samples: columns.map((c) => ({ id: c.name, name: c.name, columns: [c.name], cells: c.cells })),
    replicates: Array.from({ length: o.replicates }, (_, r) => ({ id: `rep${r + 1}`, name: `Replicate ${r + 1}`, biological: r + 1, bins: bounds.map((g, b) => ({ sample: `rep${r + 1}_bin${b + 1}`, order: b + 1, value: values[b], ...(g.lower === null ? {} : { lower: g.lower }), ...(g.upper === null ? {} : { upper: g.upper }) })) })),
    controls: { wildType: 'p.=', synonymous: 'auto', nonsense: 'auto' },
  };
  return { csv: `${lines.join('\n')}\n`, design, variants: variants.map((v, i) => ({ ...v, shift: truth[i] })), options: o, bounds, values };
}

function simulateTimeSeries(o, random, variants, f, noise) {
  const V = variants.length;
  const tMax = Math.max(...o.times);
  const columns = [];
  for (let r = 0; r < o.replicates; r += 1) {
    const rate = variants.map((v) => v.effect + noise(r) * random.gaussian());
    let frequency = f.slice();
    let previous = o.times[0];
    for (const t of o.times) {
      if (t > previous) {
        const grown = frequency.map((x, i) => x * exp((rate[i] * (t - previous)) / tMax));
        const total = grown.reduce((a, b) => a + b, 0);
        frequency = grown.map((g) => g / total);
        if (Number.isFinite(o.passageCells)) {
          const sampled = frequency.map((x) => poisson(random, o.passageCells * V * x));
          const s = sampled.reduce((a, b) => a + b, 0);
          frequency = sampled.map((x) => x / s);
        }
      }
      previous = t;
      const name = `rep${r + 1}_t${t}`;
      const missing = o.missing.some((m) => m.replicate === r + 1 && m.time === t);
      columns.push({ name, values: missing ? null : frequency.map((x) => poisson(random, o.readsPerVariant * V * x)) });
    }
  }
  const lines = [['hgvs_pro', ...columns.map((c) => c.name)].join(',')];
  variants.forEach((v, i) => lines.push([v.name, ...columns.map((c) => (c.values ? String(c.values[i]) : 'NA'))].join(',')));
  const design = {
    format: 'mavescape-design',
    version: 1,
    name: 'Simulated time series',
    description: `Simulated by MaveScape (web/lib/simulate.js, seed ${o.seed}): not real data. ${o.replicates} replicates sampled at ${o.times.join(', ')} ${o.timeUnit}s, ${o.readsPerVariant} reads per variant${Number.isFinite(o.passageCells) ? `, ${o.passageCells} cells per variant at each passage` : ''}.`,
    model: 'time-series',
    variants: { column: 'hgvs_pro', level: 'protein' },
    targets: [{ id: 'simulated', name: 'Simulated protein', sequenceType: 'protein', sequence: o.protein }],
    library: { level: 'variant' },
    time: { unit: o.timeUnit },
    samples: columns.map((c) => ({ id: c.name, name: c.name, columns: [c.name] })),
    replicates: Array.from({ length: o.replicates }, (_, r) => ({ id: `rep${r + 1}`, name: `Replicate ${r + 1}`, biological: r + 1, timepoints: o.times.map((t) => ({ sample: `rep${r + 1}_t${t}`, time: t })) })),
    controls: { wildType: 'p.=', synonymous: 'auto', nonsense: 'auto' },
  };
  return { csv: `${lines.join('\n')}\n`, design, variants, options: o };
}
