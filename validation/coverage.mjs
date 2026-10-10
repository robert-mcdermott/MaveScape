// The coverage suite (wave 2, slice 9; requirement S13): do MaveScape's 95% intervals hold the
// truth 95% of the time? The reference comparisons (run.mjs) show that MaveScape computes what
// Enrich2, DiMSum, mutscan and metafor compute; this shows whether the intervals mean what they say.
//
//   node validation/coverage.mjs [--verbose] [--seeds N] [--require-data]
//
// 1. MaveScape's simulator (web/lib/simulate.js) over a grid of depth, replicates (2 to 6),
//    bottlenecks, selection noise, shared inputs, overdispersed reads and a time course that is not
//    a line, for every model (log ratio, regression, sorted bins by maximum likelihood, barcodes
//    summed and scored each, DiMSum's model, differential scores), and rescaled scores with their
//    anchors' uncertainty. Each scenario is N simulated experiments (40 by default, seeds 1000 on):
//    the wild type's own noise moves every score of an experiment together, so one experiment's
//    coverage is not enough. MaveScape's default (the moderated combination) must hold the truth
//    93–97% of the time; REML is reported beside it. Exceptions are named, with their reason.
// 2. An independent simulator, dms_variants (reference/dms_variants-simulation.json, made by
//    reference/generate_dms_variants_simulation.py): barcoded libraries, three selections sharing
//    one input sample, with counting noise alone, a bottleneck, and noise; each a single experiment
//    of 800 variants. Variants with 5 reads or more in every sample are held to 92–98% (its own
//    sampling error is about ±1.5 points); those depleted to a few reads after selection, about a
//    fifth of this library, are reported: the pseudocount biases their scores toward 0, a bias no variance
//    model can make up for.
// 3. Real data, which has no truth (external: node validation/fetch.mjs): each replicate held out
//    and predicted from the others. Its departure, over the SD the model predicts, should be about
//    N(0, 1): about 5% beyond ±1.96. GRB2, BRCA1's E2 assay, Factor IX and CBS. Real replicates are
//    not always alike (BRCA1's two libraries were selected with strengths 10–15% apart, which no
//    model of counting describes), so each is held to beat REML's calibration and stay under 15%.
//
// Exits with status 1 when a check fails.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { simulateExperiment } from '../web/lib/simulate.js';
import { columnText, parseTable } from '../web/lib/csv.js';
import { applyBarcodeMap } from '../web/lib/barcodes.js';
import { defaultParameters, scoreExperiment, withDefaults } from '../web/lib/score.js';
import { computeQC } from '../web/lib/qc.js';
import { defaultThresholds, findingsFrom } from '../web/lib/findings.js';
import { tQuantile } from '../web/lib/distributions.js';
import { anchorUncertainty } from '../web/lib/anchors.js';
import { DESIGN_CASES, readDesign } from './design-cases.mjs';
import { cbsCase } from './differential-cases.mjs';

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const requireData = args.includes('--require-data');
const seedsArg = args.indexOf('--seeds');
const SEEDS = Array.from({ length: seedsArg >= 0 ? Number(args[seedsArg + 1]) : 40 }, (_, i) => 1000 + i);
const Z = 1.959963984540054;

const results = [];
function check(name, value, ok, required) {
  results.push({ name, ok });
  if (verbose || !ok) console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} — ${value} (required ${required})`);
}
const pct = (x) => `${(100 * x).toFixed(1)}%`;
const median = (a) => {
  const s = Float64Array.from(a).sort();
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const quantiles = new Map();
const quantile = (df) => {
  if (!quantiles.has(df)) quantiles.set(df, Number.isFinite(df) ? tQuantile(0.975, df) : Z);
  return quantiles.get(df);
};

// --- 1. MaveScape's simulator ----------------------------------------------------------------------

// One simulated experiment, as the app reads it (a barcoded one with its map applied).
function simulated(options, seed) {
  const sim = simulateExperiment({ ...options, seed });
  let table = parseTable(sim.csv);
  let barcodes = null;
  if (sim.map) {
    table = applyBarcodeMap(table, 'barcode', parseTable(sim.map), 'barcode', 'hgvs_pro').table;
    barcodes = columnText(table.columns[0]);
  }
  const names = columnText(table.columns.find((c) => c.name === sim.design.variants.column));
  const columns = Object.fromEntries(table.columns.filter((c) => c.numeric).map((c) => [c.name, c.numeric]));
  return { sim, names, barcodes, columns };
}

// Whether each scored variant's 95% interval holds its truth: { inside, total, low: [inside,
// total] of those flagged low confidence, offset (the median error: the experiment's shared shift) }.
function holds(results, truthOf, { kind = 'effect', design = null }) {
  if (kind === 'differential') {
    const d = results.differential[0];
    let inside = 0;
    let total = 0;
    results.variants.original.forEach((name, i) => {
      if (d.reason[i] || name === 'p.=') return;
      total += 1;
      const t = truthOf.get(name);
      if (t >= d.ciLow[i] && t <= d.ciHigh[i]) inside += 1;
    });
    return { inside, total, low: [0, 0] };
  }
  const c = results.conditions[0];
  const wt = results.variants.original.indexOf('p.=');
  const scale = kind === 'rescaled' ? anchorUncertainty(results, design, 0) : null;
  let inside = 0;
  let total = 0;
  const low = [0, 0];
  const errors = [];
  results.variants.original.forEach((name, i) => {
    if (c.reason[i] || name === 'p.=' || !truthOf.has(name)) return;
    // Sorted bins, unscaled: μ against the truth relative to the wild type, with its SE too.
    const truth = truthOf.get(name) + (kind === 'bins' ? c.score[wt] : 0);
    const se = kind === 'bins' ? Math.hypot(c.se[i], c.se[wt]) : scale ? Math.hypot(c.se[i], scale.at(c.score[i])) : c.se[i];
    const ok = Math.abs(c.score[i] - truth) < quantile(c.df ? c.df[i] : Infinity) * se;
    total += 1;
    if (ok) inside += 1;
    errors.push(c.score[i] - truth);
    if (c.flags[i]) {
      low[1] += 1;
      if (ok) low[0] += 1;
    }
  });
  return { inside, total, low, offset: median(errors) };
}

// The truth on a rescaled scale: nonsense median 0, wild type 1 (the true nonsense median of the
// controls scored).
function rescaledTruth(sim, results) {
  const c = results.conditions[0];
  const scored = new Set(results.variants.original.filter((_, i) => !c.reason[i]));
  const nonsense = sim.variants.filter((v) => v.kind === 'nonsense' && scored.has(v.name)).map((v) => v.effect);
  const m = median(nonsense);
  return new Map(sim.variants.map((v) => [v.name, (v.effect - m) / (0 - m)]));
}

// [name, simulation, parameters, what is compared, gate ([low, high] or a function), why]
const GATE = [0.93, 0.97];
const TIMES = [0, 2, 4, 6, 8];
const SCENARIOS = [
  ['two populations, 200 reads per variant, selection noise 0.05 (MaveScape\'s examples)', {}, {}, 'effect', GATE],
  ['shallow: 30 reads per variant, noise 0.1', { readsPerVariant: 30, replicateNoise: 0.1 }, {}, 'effect', GATE],
  ['deep: 2,000 reads per variant, noise 0.1', { readsPerVariant: 2000, replicateNoise: 0.1 }, {}, 'effect', GATE],
  ['2 replicates, noise 0.1', { replicates: 2, replicateNoise: 0.1 }, {}, 'effect', GATE],
  ['3 replicates, noise 0.1', { replicateNoise: 0.1 }, {}, 'effect', GATE],
  ['4 replicates, noise 0.1', { replicates: 4, replicateNoise: 0.1 }, {}, 'effect', GATE],
  ['6 replicates, noise 0.1', { replicates: 6, replicateNoise: 0.1 }, {}, 'effect', GATE],
  ['a bottleneck: 100 cells per variant into selection', { inputCells: 100 }, {}, 'effect', GATE],
  ['a severe bottleneck: 25 cells per variant', { inputCells: 25 }, {}, 'effect', GATE],
  ['a bottleneck (25 cells) and noise 0.1', { inputCells: 25, replicateNoise: 0.1 }, {}, 'effect', GATE],
  ['strong selection noise: 0.3', { replicateNoise: 0.3 }, {}, 'effect', GATE],
  ['one input sample shared by every replicate', { sharedInput: true }, {}, 'effect', GATE],
  ['a shared input and a bottleneck (25 cells)', { sharedInput: true, inputCells: 25 }, {}, 'effect', GATE],
  ['overdispersed reads (gamma-Poisson, k = 20)', { readDispersion: 20 }, {}, 'effect', GATE],
  ['time series, 5 points, weighted regression, noise 0.1', { times: TIMES, replicateNoise: 0.1 }, { model: 'wls' }, 'effect', GATE],
  ['time series, a bottleneck of 20 cells at every passage', { times: TIMES, passageCells: 20 }, { model: 'wls' }, 'effect', GATE],
  ['time series, one sample at time 0 for every replicate', { times: TIMES, sharedInput: true, replicateNoise: 0.1 }, { model: 'wls' }, 'effect', GATE],
  ['time series not a line (selection acting early), by the ratio of its ends', { times: TIMES, timeCourse: 'saturating' }, { model: 'ratio' }, 'effect', GATE],
  ['time series not a line, by weighted regression (exception)', { times: TIMES, timeCourse: 'saturating' }, { model: 'wls' }, 'effect', [0, 0.9],
    'a slope is not the whole change of a course that is not a line: the regression is biased, which "Fit of the time courses" reports; the ratio of the first and last samples holds the truth'],
  ['sorted bins, maximum likelihood, 300 cells per variant', { sort: { cellsPerVariant: 300 }, readsPerVariant: 80, replicateNoise: 0.02 }, { model: 'bins-mle', binScale: 'none' }, 'bins', GATE],
  ['sorted bins, maximum likelihood, noise 0.1', { sort: { cellsPerVariant: 300 }, readsPerVariant: 80, replicateNoise: 0.1 }, { model: 'bins-mle', binScale: 'none' }, 'bins', GATE],
  ['barcodes summed per variant (clonal noise 0.1)', { barcodes: { noise: 0.1, outliers: 0, conflicts: 0, unmapped: 0 } }, {}, 'effect', GATE],
  ['barcodes scored each, then combined (clonal noise 0.1)', { barcodes: { noise: 0.1, outliers: 0, conflicts: 0, unmapped: 0 } }, { aggregation: 'barcode' }, 'effect', GATE],
  ['DiMSum\'s fitness, moderated (a bottleneck of 25 cells)', { inputCells: 25 }, { model: 'dimsum' }, 'effect', GATE],
  ['rescaled to nonsense 0 and wild type 1, with SE_scale (noise 0.1)', { replicateNoise: 0.1 }, { rescale: 'nonsense-wt' }, 'rescaled', GATE],
  ['two conditions from shared inputs: paired differential, moderated', { replicates: 3, readsPerVariant: 150, inputCells: 25, replicateNoise: 0.1, conditions: { names: ['A', 'B'], site: [12, 13, 14, 15, 16], shift: -1.5 } }, { differential: 'paired' }, 'differential', GATE],
  ['two conditions from shared inputs: limma', { replicates: 3, readsPerVariant: 150, inputCells: 25, replicateNoise: 0.1, conditions: { names: ['A', 'B'], site: [12, 13, 14, 15, 16], shift: -1.5 } }, { differential: 'limma' }, 'differential', GATE],
];

function runScenario([name, options, parameters, kind, gate, why]) {
  const tally = { moderated: [0, 0], reml: [0, 0], low: [0, 0], offsets: [] };
  let qcFlag = 0;
  for (const seed of SEEDS) {
    const { sim, names, barcodes, columns } = simulated(options, seed);
    const base = { ...defaultParameters(sim.design), ...parameters };
    const truthOf = kind === 'differential' ? new Map(sim.variants.map((v) => [v.name, v.differential])) : new Map(sim.variants.map((v) => [v.name, v.shift ?? v.effect]));
    for (const [method, p] of [['moderated', base], ['reml', { ...base, combination: 'reml' }]]) {
      if (method === 'reml' && kind === 'differential' && parameters.differential === 'limma') continue;
      const out = scoreExperiment({ names, barcodes, columns, design: sim.design, parameters: withDefaults(p) });
      if (!out.ok) throw new Error(`${name}, seed ${seed}: ${out.errors.join(' ')}`);
      const truth = kind === 'rescaled' ? rescaledTruth(sim, out.results) : truthOf;
      const h = holds(out.results, truth, { kind, design: sim.design });
      tally[method][0] += h.inside;
      tally[method][1] += h.total;
      if (method === 'moderated') {
        tally.low[0] += h.low[0];
        tally.low[1] += h.low[1];
        if (Number.isFinite(h.offset)) tally.offsets.push(h.offset);
        // A time course that is not a line: the QC's fit of the time courses says so.
        if (why && sim.design.model === 'time-series') {
          const qc = computeQC({ names, columns, design: sim.design, results: out.results });
          if (findingsFrom(qc, defaultThresholds()).find((f) => f.id === 'time-fit')?.status !== 'pass') qcFlag += 1;
        }
      }
    }
  }
  const cover = tally.moderated[0] / tally.moderated[1];
  const reml = tally.reml[1] ? tally.reml[0] / tally.reml[1] : Number.NaN;
  const [lo, hi] = gate;
  const ok = cover >= lo && cover <= hi && (!why || !/time courses/.test(why) || qcFlag >= SEEDS.length / 2);
  const value = `moderated ${pct(cover)} of ${tally.moderated[1]} intervals${tally.low[1] ? ` (low confidence ${pct(tally.low[0] / tally.low[1])} of ${tally.low[1]})` : ''}${Number.isFinite(reml) ? `; REML ${pct(reml)}` : ''}${why ? `; ${qcFlag} of ${SEEDS.length} experiments' QC flag the time courses` : ''}`;
  check(`${name}${why ? ` — ${why}` : ''}`, value, ok, why ? `under ${pct(hi)}, and the QC flags it` : `${pct(lo)}–${pct(hi)}`);
  return { name, cover, reml, ok };
}

console.log(`Coverage of 95% intervals: ${SEEDS.length} simulated experiments per scenario.`);
const t0 = performance.now();
const grid = SCENARIOS.map(runScenario);
const regular = grid.filter((_, k) => !SCENARIOS[k][5]);
console.log(`${regular.filter((r) => r.ok).length}/${regular.length} scenarios within 93–97%; REML ${pct(Math.min(...regular.map((r) => r.reml).filter(Number.isFinite)))}–${pct(Math.max(...regular.map((r) => r.reml).filter(Number.isFinite)))} (${((performance.now() - t0) / 1000).toFixed(0)} s)`);

// --- 2. An independent simulator: dms_variants ---------------------------------------------------

{
  const reference = JSON.parse(readFileSync(new URL('./reference/dms_variants-simulation.json', import.meta.url), 'utf8'));
  for (const scenario of reference.scenarios) {
    const names = scenario.variants.map((v) => v.hgvs);
    const columns = Object.fromEntries(scenario.samples.map((s, j) => [s, Float64Array.from(scenario.variants, (v) => v.counts[j])]));
    const design = {
      format: 'mavescape-design', version: 1, model: 'two-population', variants: { column: 'hgvs_pro', level: 'protein' },
      targets: [{ id: 'gene', name: 'Simulated gene (dms_variants)', sequenceType: 'dna', sequence: reference.gene }], library: { level: 'variant' },
      samples: scenario.samples.map((s) => ({ id: s, columns: [s] })),
      replicates: [1, 2, 3].map((r) => ({ id: `rep${r}`, biological: r, input: 'pre', output: `rep${r}` })),
      controls: { wildType: 'p.=', synonymous: 'auto', nonsense: 'auto' },
    };
    const truthOf = new Map(scenario.variants.map((v) => [v.hgvs, v.truth]));
    const fewReads = new Set(scenario.variants.filter((v) => v.counts.some((x) => x < 5)).map((v) => v.hgvs));
    const measure = (p) => {
      const out = scoreExperiment({ names, columns, design, parameters: withDefaults(p) });
      const c = out.results.conditions[0];
      const t = { all: [0, 0], reads: [0, 0] };
      names.forEach((name, i) => {
        if (c.reason[i] || name === 'p.=') return;
        const ok = Math.abs(c.score[i] - truthOf.get(name)) < quantile(c.df ? c.df[i] : Infinity) * c.se[i] ? 1 : 0;
        t.all[0] += ok;
        t.all[1] += 1;
        if (!fewReads.has(name)) {
          t.reads[0] += ok;
          t.reads[1] += 1;
        }
      });
      return { all: t.all[0] / t.all[1], reads: t.reads[0] / t.reads[1], n: t.reads[1], zero: t.all[1] - t.reads[1] };
    };
    const m = measure(defaultParameters(design));
    const r = measure({ ...defaultParameters(design), combination: 'reml' });
    check(`dms_variants, ${scenario.description}, three selections sharing one input: variants with 5 reads or more in every sample`, `moderated ${pct(m.reads)} of ${m.n} (all ${pct(m.all)}, the ${m.zero} with fewer reads somewhere among them); REML ${pct(r.reads)}`, m.reads >= 0.92 && m.reads <= 0.98, '92–98% (one experiment)');
  }
}

// --- 3. Real data: each replicate held out ---------------------------------------------------------

const sources = JSON.parse(readFileSync(new URL('./sources.json', import.meta.url), 'utf8'));
function dataset(name) {
  const set = sources.datasets[name];
  const root = join(fileURLToPath(new URL('./cache/', import.meta.url)), name);
  if (!set.files.every((f) => existsSync(join(root, f.path)) && statSync(join(root, f.path)).size === f.size)) return null;
  return { bytes: (path) => new Uint8Array(readFileSync(join(root, path))) };
}

// Each replicate predicted from the others: z = (y_j − μ̂₋ⱼ − its shift) / √(SE₋ⱼ² + its predicted
// variance − 2 cov), the predicted variance from the others' model (moderated: φ₀(a s² + b); REML:
// s² + τ²), the covariance of a shared input taken out. The held-out replicate's shift (the median
// of its departures, shared by all its variants: the reference's, checked by the simulations) is
// taken out, so that this checks each variant's interval. { beyond (share of |z| > 1.96), sd
// (robust), n }.
function heldOut(label, design, names, columns, parameters) {
  const full = scoreExperiment({ names, columns, design, parameters });
  if (!full.ok) throw new Error(`${label}: ${full.errors.join(' ')}`);
  const z = [];
  for (const replicate of design.replicates) {
    const d = [];
    const others = { ...design, replicates: design.replicates.filter((r) => r.id !== replicate.id) };
    const peers = others.replicates.filter((r) => (r.condition ?? null) === (replicate.condition ?? null) && (r.tile ?? null) === (replicate.tile ?? null));
    if (!peers.length) continue;
    const out = scoreExperiment({ names, columns, design: others, parameters });
    if (!out.ok) continue;
    const ci = design.conditions?.length ? out.results.conditions.findIndex((c) => c.id === replicate.condition) : 0;
    const c = out.results.conditions[ci];
    const rep = full.results.replicates.find((r) => r.id === replicate.id);
    const model = c.errorModel;
    for (let i = 0; i < names.length; i += 1) {
      if (rep.state[i] !== 0 || c.reason[i] || !Number.isFinite(c.se[i])) continue;
      // Only where the held-out replicate's tile measures the row.
      const s = rep.seCounting ? rep.seCounting[i] : rep.se[i];
      let predicted;
      if (model) {
        let cov = 0;
        const first = (r) => r.input ?? r.timepoints?.[0]?.sample ?? null;
        if (rep.shared && first(replicate) !== null && peers.some((p) => first(p) === first(replicate))) {
          const u = (rep.shared.coef ? rep.shared.coef[i] : -1) * Math.sqrt(rep.shared.variance[i] || 0);
          cov = Math.min(model.a, 1) * u * u;
        }
        predicted = c.se[i] * c.se[i] + model.phiPrior * (model.a * s * s + model.b) - 2 * cov;
      } else predicted = c.se[i] * c.se[i] + s * s + (Number.isFinite(c.tau2[i]) ? c.tau2[i] : 0);
      if (predicted > 0) d.push([rep.score[i] - c.score[i], Math.sqrt(predicted)]);
    }
    if (!d.length) continue;
    const shift = median(d.map(([x]) => x));
    for (const [x, sd] of d) z.push((x - shift) / sd);
  }
  const beyond = z.filter((x) => Math.abs(x) > Z).length / z.length;
  const center = median(z);
  const sd = 1.4826 * median(z.map((x) => Math.abs(x - center)));
  return { beyond, sd, n: z.length };
}

const REAL = [
  ['GRB2 SH3 (3 replicates, two populations)', 'mavedb-grb2-sh3', (d) => {
    const c = DESIGN_CASES.find((x) => x.name === 'grb2-sh3');
    return { design: readDesign(c.design), table: parseTable(d.bytes(c.counts)) };
  }],
  ['BRCA1 RING, E2 binding (6 replicates, time series sharing inputs)', 'mavedb-brca1-ring', (d) => {
    const c = DESIGN_CASES.find((x) => x.name === 'brca1-ring-e2');
    return { design: readDesign(c.design), table: parseTable(d.bytes(c.counts)) };
  }],
  ['Factor IX (sorted bins, 3 tiles × 3 replicates)', 'mavedb-factor9', (d) => {
    const c = DESIGN_CASES.find((x) => x.name === 'factor9');
    return { design: readDesign(c.design), table: parseTable(d.bytes(c.counts)) };
  }],
  ['CBS (4 replicates at two vitamin B6 levels)', 'mavedb-cbs', (d) => {
    const c = cbsCase(d);
    return { design: c.design, names: c.names, columns: c.columns };
  }],
];
let missing = 0;
for (const [label, name, read] of REAL) {
  const d = dataset(name);
  if (!d) {
    missing += 1;
    if (requireData) check(`${label}: external data present`, 'missing', false, 'present (--require-data)');
    continue;
  }
  const got = read(d);
  const names = got.names ?? columnText(got.table.columns.find((x) => x.name === got.design.variants.column));
  const columns = got.columns ?? Object.fromEntries(got.table.columns.filter((x) => x.numeric).map((x) => [x.name, x.numeric]));
  // CBS's table has no wild-type row: its synonymous variants normalize (as slice 6 scores it).
  const p = { ...defaultParameters(got.design), ...(name === 'mavedb-cbs' ? { normalization: 'synonymous' } : {}) };
  const m = heldOut(label, got.design, names, columns, withDefaults(p));
  const r = heldOut(label, got.design, names, columns, withDefaults({ ...p, combination: 'reml' }));
  check(`${label}: each replicate predicted from the others`, `moderated ${pct(m.beyond)} beyond ±1.96 (robust SD of z ${m.sd.toFixed(2)}, ${m.n} predictions); REML ${pct(r.beyond)} (SD ${r.sd.toFixed(2)})`, Math.abs(m.beyond - 0.05) < Math.abs(r.beyond - 0.05) && m.beyond <= 0.15, 'nearer 5% than REML (5% if calibrated); under 15%');
}
if (missing) console.log(`Real data: ${missing} data set${missing > 1 ? 's' : ''} skipped for want of external data (node validation/fetch.mjs).`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed in ${((performance.now() - t0) / 1000).toFixed(0)} s.`);
if (failed.length) process.exit(1);
