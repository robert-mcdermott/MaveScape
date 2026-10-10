// Quality-control metrics (requirements Q1–Q7): whether an experiment supports reliable scores.
// Pure; the score worker computes them (message 'qc'), the validation suite `qc` in Node.
//
// From the counts and the design alone (no score run needed): each sample's depth, observed,
// zero, low and missing counts, count distribution and rank-abundance; coverage of the designed
// single substitutions by position and class; replicate agreement (Pearson and Spearman of
// replicates' log ratios, on variants with enough input reads); the variance of replicate
// differences against what counting predicts, fitted as a·(counting variance) + e: a ≈ 1 + reads
// per cell, so a > 1 points to a bottleneck (fewer cells than reads), and e is variance between
// replicates beyond counting (DiMSum's multiplicative and additive error terms; for two populations
// DiMSum's own error model too, which says whether the excess is at the input or the output, wave 2
// slice 5); leave-one-out z
// of each replicate against the others (an outlier replicate); synonymous log ratios against
// their Poisson expectation; missingness patterns.
//
// A table of barcodes (wave 2, slice 4) is summed per variant for all of these, and also gets its
// own: barcodes per variant, the reads of barcodes the map does not name, and per replicate how
// much a variant's barcodes disagree beyond counting (φ, score-barcodes.js, on raw log ratios),
// the outlier barcodes, and the agreement of each variant's two halves of barcodes (split-half r).
//
// From a score run's results, when given: the controls' scores and their separation, the median
// SE against the controls' gap (resolution), score uncertainty by input count, and the filter
// flow. Findings (pass, review, fail) are drawn from these by findings.js.

import { log, log10, pow, square } from './dmath.js';
import { buildVariants, KIND, STATUS } from './variants.js';
import { replicateSamples, targetLength } from './design.js';
import { sampleCounts } from './replicates.js';
import { binAverages, binTotals } from './score-bins.js';
import { barcodeDisagreement, groupBarcodes, OUTLIER_Z, sumByVariant } from './score-barcodes.js';
import { scoreDimsumGroup, substitutionsOf } from './score-dimsum.js';
import { auc, mad, mean, median, MEDIAN_CHI2_1, nonNegativeLine, pearson, quantileSorted, sorted, spearman, variance } from './stats.js';
import { controlRows } from './score.js';
import { CODONS } from './target.js';
import { lossSide, readoutOf, SINGLE_NUCLEOTIDE_LIBRARIES } from './readout.js';

export const QC_VERSION = '1';
// The measurements' own parameters (the review and fail thresholds are findings.js's).
export const DEFAULT_MEASURES = { lowCount: 10, agreementInput: 10 };
const P = 0.5;

function sampleMetrics(sample, counts, lowCount) {
  const n = counts.length;
  let counted = 0;
  let total = 0;
  let zeros = 0;
  let low = 0;
  const values = [];
  for (let i = 0; i < n; i += 1) {
    const c = counts[i];
    if (Number.isNaN(c)) continue;
    counted += 1;
    total += c;
    if (c === 0) zeros += 1;
    if (c < lowCount) low += 1;
    values.push(c);
  }
  const s = sorted(values);
  // Count distribution: log10(count + 1) in quarter-decade bins, as fractions.
  const top = s.length ? log10(s[s.length - 1] + 1) : 0;
  const bins = Math.max(1, Math.ceil(top * 4) + 1);
  const histogram = new Array(bins).fill(0);
  for (const c of values) histogram[Math.min(bins - 1, Math.floor(log10(c + 1) * 4))] += 1 / values.length;
  // Rank-abundance: counts from the most to the least abundant, at about 64 ranks.
  const rankAbundance = [];
  for (let k = 0; k < 64 && s.length; k += 1) {
    const rank = Math.min(s.length, Math.max(1, Math.round(pow(s.length, k / 63))));
    if (rankAbundance.length && rankAbundance.at(-1)[0] === rank) continue;
    rankAbundance.push([rank, s[s.length - rank]]);
  }
  return {
    id: sample.id,
    name: sample.name ?? sample.id,
    columns: sample.columns,
    counted,
    missing: n - counted,
    missingFraction: n ? (n - counted) / n : 0,
    total,
    zeros,
    zeroFraction: counted ? zeros / counted : Number.NaN,
    low,
    lowFraction: counted ? low / counted : Number.NaN,
    readsPerVariant: counted ? total / counted : 0,
    quantiles: [0.05, 0.25, 0.5, 0.75, 0.95].map((q) => quantileSorted(s, q)),
    histogram,
    rankAbundance,
  };
}

// The designed single substitutions (every amino acid and stop at every position of the target,
// or of its tiles) and which are in the table and observed (input reads in some replicate).
function coverage(design, variants, observed) {
  const target = design.targets?.length === 1 ? design.targets[0] : null;
  if (!target || design.variants.level !== 'protein') {
    return { assessed: false, reason: !target ? 'the design has no single target' : 'coverage by position is computed for protein-level variants (nucleotide coverage comes with wave 3)' };
  }
  const length = targetLength(target, 'protein');
  const tiles = design.library?.tiles ?? [];
  const inDesign = (p) => !tiles.length || tiles.some((t) => p >= t.start && p <= t.end);
  // Rows by amino-acid code (variants.js AA_CODE: 1–20 amino acids, 21 stop).
  const grid = new Uint8Array(length * 21); // 0 designed, not in the table; 1 in the table, no input reads; 2 observed; 3 the reference; 4 not designed
  for (let p = 1; p <= length; p += 1) for (let a = 0; a < 21; a += 1) grid[(p - 1) * 21 + a] = inDesign(p) ? 0 : 4;
  for (let i = 0; i < variants.n; i += 1) {
    const kind = variants.kind[i];
    if (variants.status[i] === STATUS.INVALID || !(kind === KIND.MISSENSE || kind === KIND.NONSENSE || kind === KIND.START_LOST || kind === KIND.SYNONYMOUS)) continue;
    const p = variants.position[i];
    if (p < 1 || p > length) continue;
    if (kind === KIND.SYNONYMOUS) continue;
    const cell = (p - 1) * 21 + variants.alt[i] - 1;
    if (grid[cell] === 4) continue;
    grid[cell] = Math.max(grid[cell], observed[i] ? 2 : 1);
  }
  const protein = targetProteinOf(target);
  const codes = 'ARNDCQEGHILKMFPSTWYV*';
  for (let p = 1; p <= length; p += 1) {
    const ref = codes.indexOf(protein[p - 1]);
    if (ref >= 0 && grid[(p - 1) * 21 + ref] !== 4) grid[(p - 1) * 21 + ref] = 3;
  }
  const byClass = { missense: [0, 0], nonsense: [0, 0] };
  let designed = 0;
  let inTable = 0;
  let seen = 0;
  for (let p = 1; p <= length; p += 1) {
    for (let a = 0; a < 21; a += 1) {
      const g = grid[(p - 1) * 21 + a];
      if (g === 3 || g === 4) continue;
      designed += 1;
      if (g >= 1) inTable += 1;
      if (g === 2) seen += 1;
      const cls = a === 20 ? byClass.nonsense : byClass.missense;
      cls[1] += 1;
      if (g === 2) cls[0] += 1;
    }
  }
  // A library made mostly of single-nucleotide changes (error-prone PCR, doped oligos) reaches the
  // substitutions one base change away from each wild-type codon: judged against those when the
  // target's codons are known (a DNA target), named as expected otherwise.
  const method = design.library?.method ?? null;
  let reach = null;
  if (method && SINGLE_NUCLEOTIDE_LIBRARIES.has(method)) {
    const dna = target.sequenceType === 'dna' ? target.sequence.toUpperCase().slice((target.codingStart ?? 1) - 1) : null;
    if (!dna) reach = { known: false };
    else {
      const codes = 'ARNDCQEGHILKMFPSTWYV*';
      let reachable = 0;
      let reachableSeen = 0;
      for (let p = 1; p <= length; p += 1) {
        const codon = dna.slice(3 * (p - 1), 3 * p);
        if (codon.length < 3) continue;
        const alts = new Set();
        for (let j = 0; j < 3; j += 1) for (const b of 'ACGT') if (b !== codon[j]) alts.add(CODONS[codon.slice(0, j) + b + codon.slice(j + 1)]);
        alts.delete(CODONS[codon]);
        for (const aa of alts) {
          const g = grid[(p - 1) * 21 + codes.indexOf(aa)];
          if (g === 3 || g === 4 || g === undefined) continue;
          reachable += 1;
          if (g === 2) reachableSeen += 1;
        }
      }
      reach = { known: true, designed: reachable, observed: reachableSeen, fraction: reachable ? reachableSeen / reachable : Number.NaN };
    }
  }
  return { assessed: true, length, offset: target.offset ?? 0, grid, designed, inTable, observed: seen, fraction: designed ? seen / designed : Number.NaN, byClass, tiles: tiles.length, method, reach };
}

function targetProteinOf(target) {
  if (target.sequenceType === 'protein') return target.sequence.toUpperCase();
  const codons = { };
  const order = 'TCAG';
  const aas = 'FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG';
  let k = 0;
  for (const a of order) for (const b of order) for (const c of order) codons[a + b + c] = aas[k++];
  const dna = target.sequence.toUpperCase().slice((target.codingStart ?? 1) - 1);
  let out = '';
  for (let i = 0; i + 3 <= dna.length; i += 3) out += codons[dna.slice(i, i + 3)] ?? 'X';
  return out;
}

// One replicate's raw log ratio and counting variance per row (first and last samples, pseudocount
// 0.5), and whether the row is usable (counted in every sample, enough input reads, valid name).
function rawRatios(replicate, pooled, variants, agreementInput) {
  const slots = replicateSamples(replicate).filter((s) => s.role !== 'bin')
    .map((s) => ({ ...s, time: s.role === 'input' ? 0 : s.role === 'output' ? 1 : s.time })).sort((a, b) => a.time - b.time);
  const samples = slots.map((s) => pooled.get(s.sample));
  const first = samples[0];
  const last = samples[samples.length - 1];
  const n = variants.n;
  const y = new Float64Array(n).fill(Number.NaN);
  const v = new Float64Array(n).fill(Number.NaN);
  const usable = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    if (samples.some((s) => !s || Number.isNaN(s[i]))) continue;
    y[i] = log(last[i] + P) - log(first[i] + P);
    v[i] = 1 / (first[i] + P) + 1 / (last[i] + P);
    usable[i] = first[i] >= agreementInput && variants.status[i] !== STATUS.INVALID ? 1 : 0;
  }
  return { id: replicate.id, name: replicate.name ?? replicate.id, condition: replicate.condition ?? null, first, y, v, usable, firstSample: slots[0]?.sample, dropout: dropout(slots, samples, variants, agreementInput) };
}

// Sorted bins: a replicate's weighted average of the bins' values (score-bins.js), and its variance
// from counting, standing in for the log ratio in the comparisons of replicates.
function binRatios(replicate, pooled, variants, agreementInput) {
  const slots = [...(replicate.bins ?? [])].sort((a, b) => a.order - b.order);
  const samples = slots.map((s) => pooled.get(s.sample));
  const n = variants.n;
  const y = new Float64Array(n).fill(Number.NaN);
  const v = new Float64Array(n).fill(Number.NaN);
  const usable = new Uint8Array(n);
  const total = new Float64Array(n).fill(Number.NaN);
  if (samples.some((x) => !x)) return { id: replicate.id, name: replicate.name ?? replicate.id, condition: replicate.condition ?? null, first: total, y, v, usable, dropout: {} };
  const counted = Uint8Array.from({ length: n }, (_, i) => (samples.every((x) => !Number.isNaN(x[i])) ? 1 : 0));
  const avg = binAverages(samples, slots.map((x) => x.value), counted, { pseudocount: P });
  for (let i = 0; i < n; i += 1) {
    if (!counted[i] || !Number.isFinite(avg.score[i])) continue;
    y[i] = avg.score[i];
    v[i] = avg.se[i] * avg.se[i];
    total[i] = avg.reads[i];
    usable[i] = avg.reads[i] >= agreementInput && variants.status[i] !== STATUS.INVALID ? 1 : 0;
  }
  return { id: replicate.id, name: replicate.name ?? replicate.id, condition: replicate.condition ?? null, first: total, y, v, usable, dropout: {} };
}

// Each bin's share of a replicate's cells (when the design records the cells sorted into each bin)
// or else of its reads, and the cells per variant and reads per cell.
function binMetrics(design, pooled) {
  return design.replicates.map((r) => {
    const slots = [...(r.bins ?? [])].sort((a, b) => a.order - b.order);
    const samples = slots.map((s) => pooled.get(s.sample));
    if (samples.some((x) => !x)) return null;
    const totals = binTotals(samples);
    const all = totals.reduce((a, b) => a + b, 0);
    let variants = 0;
    for (let i = 0; i < samples[0].length; i += 1) if (samples.some((x) => x[i] > 0)) variants += 1;
    const cells = slots.map((s) => design.samples.find((x) => x.id === s.sample)?.cells ?? null);
    const known = cells.every((c) => c >= 0 && c !== null) && cells.some((c) => c > 0);
    const allCells = known ? cells.reduce((x, y) => x + y, 0) : 0;
    return {
      id: r.id, name: r.name ?? r.id, tile: r.tile ?? null, variants, shareOf: known ? 'cells' : 'reads',
      bins: slots.map((s, b) => ({ order: s.order, value: s.value, reads: totals[b], share: known ? cells[b] / allCells : all > 0 ? totals[b] / all : Number.NaN, cells: known ? cells[b] : null, cellsPerVariant: known && variants ? cells[b] / variants : null, readsPerCell: known && cells[b] > 0 ? totals[b] / cells[b] : null })),
    };
  }).filter(Boolean);
}

// DiMSum's error model of a group of replicates of two populations, from the counts alone
// (score-dimsum.js; no filter, no bootstrap): each replicate's multiplicative input and output terms
// (about 1 + reads per molecule where a step had fewer molecules than reads) and additive term.
// { replicates, variants (fitted), terms: [{ id, name, input, output, reperror }] } or { reason }.
function errorModelOf(group, design, pooled, variants) {
  const reps = group.map((g) => design.replicates.find((r) => r.id === g.id));
  const ids = reps.map((r) => r.id);
  const wtRows = [];
  for (let i = 0; i < variants.n; i += 1) if (variants.kind[i] === KIND.WT && variants.status[i] !== STATUS.INVALID) wtRows.push(i);
  if (wtRows.length !== 1) return { replicates: ids, reason: 'needs one wild-type row' };
  const inputs = reps.map((r) => pooled.get(r.input));
  const outputs = reps.map((r) => pooled.get(r.output));
  if (inputs.some((x) => !x) || outputs.some((x) => !x)) return { replicates: ids, reason: 'a sample has no counts' };
  const substitutions = variants.key.map((k, i) => (variants.status[i] === STATUS.INVALID ? -1 : substitutionsOf(k)));
  const res = scoreDimsumGroup({ inputs, outputs, wtRow: wtRows[0], substitutions, options: { normalise: true, errorModel: true } });
  if (res.refused) return { replicates: ids, reason: res.refused };
  const m = res.model;
  return { replicates: ids, variants: m.variants, terms: reps.map((r, k) => ({ id: r.id, name: r.name ?? r.id, input: m.input[k], output: m.output[k], reperror: m.reperror[k] })) };
}

// Missing after selection: of the variants counted well before selection, how many have no count
// in the replicate's last sample, whether that sample holds any explicit 0, and whether the missing
// ones had been depleted before they went missing (the second-to-last sample against the first,
// in a time series; the input count, with two samples). A table that writes a variant that dropped
// out as missing rather than 0 leaves the most depleted variants unscored.
function dropout(slots, samples, variants, minimum) {
  if (samples.length < 2 || samples.some((x) => !x)) return null;
  const first = samples[0];
  const last = samples[samples.length - 1];
  const previous = samples.length > 2 ? samples[samples.length - 2] : null;
  let counted = 0;
  let missing = 0;
  let zeros = 0;
  const trendMissing = [];
  const trendCounted = [];
  for (let i = 0; i < first.length; i += 1) {
    if (!(first[i] >= minimum) || variants.status[i] === STATUS.INVALID) continue;
    counted += 1;
    const trend = previous ? (Number.isFinite(previous[i]) ? previous[i] / first[i] : Number.NaN) : first[i];
    if (Number.isNaN(last[i])) {
      missing += 1;
      if (Number.isFinite(trend)) trendMissing.push(trend);
    } else {
      if (last[i] === 0) zeros += 1;
      if (Number.isFinite(trend)) trendCounted.push(trend);
    }
  }
  return { sample: slots[slots.length - 1].sample, by: previous ? 'trend' : 'input', counted, missing, zeros, missingTrend: median(trendMissing), countedTrend: median(trendCounted) };
}

// The bottleneck the cells recorded predict for a pair of replicates (wave 2, slice 10): N cells
// carried into selection (an input sample's cells) add 1/(N f) to a variant's variance at library
// frequency f, against counting's 1/(R_in f) + 1/(R_out f) for R reads (and the cells recovered
// after selection, an output's, add theirs), so the multiplier of the counting variance is about
//
//   1 + Σ (1/N_in + 1/N_out) / Σ (1/R_in + 1/R_out)   (sums over the pair's replicates),
//
// for any variant near the wild type's effect: 1 + reads per cell, as qc.js's header says. Null
// unless both replicates' inputs record their cells.
function recordedCells(design, pooled, ids) {
  const sample = (id) => design.samples.find((s) => s.id === id);
  const reads = (id) => {
    let total = 0;
    for (const c of pooled.get(id) ?? []) if (c > 0) total += c;
    return total;
  };
  const reps = ids.map((id) => design.replicates.find((r) => r.id === id));
  if (reps.some((r) => !r || !(sample(r.input)?.cells > 0) || !(reads(r.input) > 0) || !(reads(r.output) > 0))) return null;
  let counting = 0;
  let cells = 0;
  for (const r of reps) {
    counting += 1 / reads(r.input) + 1 / reads(r.output);
    cells += 1 / sample(r.input).cells;
    if (sample(r.output)?.cells > 0) cells += 1 / sample(r.output).cells;
  }
  return { input: reps.map((r) => sample(r.input).cells), output: reps.map((r) => sample(r.output)?.cells ?? null), predicted: 1 + cells / counting };
}

// Agreement and the variance of the difference of two replicates.
function pairMetrics(a, b) {
  const ya = [];
  const yb = [];
  const d = [];
  const pv = [];
  for (let i = 0; i < a.y.length; i += 1) {
    if (!a.usable[i] || !b.usable[i]) continue;
    ya.push(a.y[i]);
    yb.push(b.y[i]);
    d.push(a.y[i] - b.y[i]);
    pv.push(a.v[i] + b.v[i]);
  }
  const n = ya.length;
  const out = { a: a.id, b: b.id, n, pearson: pearson(ya, yb), spearman: spearman(ya, yb), multiplier: Number.NaN, additive: Number.NaN, ratio: Number.NaN, bins: [], points: [] };
  if (n < 20) return out;
  const offset = median(d);
  const r2 = d.map((x) => square(x - offset));
  out.ratio = median(r2.map((x, i) => x / pv[i])) / MEDIAN_CHI2_1;
  // Bins of counting variance; the robust variance of the differences in each.
  const order = pv.map((_, i) => i).sort((i, j) => pv[i] - pv[j]);
  const nb = Math.max(1, Math.min(10, Math.floor(n / 40)));
  for (let b = 0; b < nb; b += 1) {
    const idx = order.slice(Math.floor((b * n) / nb), Math.floor(((b + 1) * n) / nb));
    out.bins.push({ n: idx.length, counting: mean(idx.map((i) => pv[i])), observed: median(idx.map((i) => r2[i])) / MEDIAN_CHI2_1 });
  }
  const fit = nonNegativeLine(out.bins.map((x) => x.counting), out.bins.map((x) => x.observed), out.bins.map((x) => x.n / square(x.counting)));
  out.multiplier = fit.a;
  out.additive = fit.e;
  // A sample of points for the scatter plot (every k-th by row).
  const step = Math.max(1, Math.ceil(n / 2500));
  for (let i = 0; i < n; i += step) out.points.push([ya[i], yb[i]]);
  return out;
}

// Each replicate against the others: z = (y_j − mean of the others) / sqrt(s_j² + var of that mean),
// after centering each replicate on its median; dispersion = robust variance of z.
function leaveOneOut(reps) {
  const n = reps[0].y.length;
  const common = [];
  for (let i = 0; i < n; i += 1) if (reps.every((r) => r.usable[i])) common.push(i);
  if (common.length < 20) return null;
  const centers = reps.map((r) => median(common.map((i) => r.y[i])));
  const out = reps.map((r, j) => {
    const z = [];
    for (const i of common) {
      let sw = 0;
      let swy = 0;
      reps.forEach((o, k) => {
        if (k === j) return;
        const w = 1 / o.v[i];
        sw += w;
        swy += w * (o.y[i] - centers[k]);
      });
      z.push((r.y[i] - centers[j] - swy / sw) / Math.sqrt(r.v[i] + 1 / sw));
    }
    return { id: r.id, n: z.length, dispersion: median(z.map((x) => x * x)) / MEDIAN_CHI2_1, bias: median(z) };
  });
  for (const [j, r] of out.entries()) r.ratio = r.dispersion / median(out.filter((_, k) => k !== j).map((x) => x.dispersion));
  return out;
}

// Synonymous variants' log ratios against their Poisson expectation, in one replicate.
function synonymousCheck(rep, variants) {
  const y = [];
  const v = [];
  for (let i = 0; i < variants.n; i += 1) {
    if (variants.kind[i] !== KIND.SYNONYMOUS || !rep.usable[i]) continue;
    y.push(rep.y[i]);
    v.push(rep.v[i]);
  }
  return { id: rep.id, n: y.length, observed: variance(y), expected: mean(v), ratio: y.length >= 2 ? variance(y) / mean(v) : Number.NaN };
}

// Where the nonsense variants stop scoring as loss of function: the position that best splits them,
// in order along the target, into an earlier group and a later group whose median is nearer the
// reference's (the least squares of one change point, at least 3 variants after it). Truncations
// after the region an assay needs keep the function (BRCA1's Y2H construct, Starita et al. 2015):
// those are not loss-of-function controls. Returns null when no such split stands out.
function nonsenseChange(points, referenceMedian) {
  if (points.length < 8) return null;
  const xs = points.slice().sort((a, b) => a.position - b.position);
  const ys = xs.map((p) => p.score);
  const n = ys.length;
  const prefix = [0];
  const prefix2 = [0];
  for (const y of ys) {
    prefix.push(prefix.at(-1) + y);
    prefix2.push(prefix2.at(-1) + y * y);
  }
  const sse = (a, b) => {
    const m = b - a;
    const sum = prefix[b] - prefix[a];
    return prefix2[b] - prefix2[a] - (sum * sum) / m;
  };
  let best = null;
  for (let k = 3; k <= n - 3; k += 1) {
    if (xs[k].position === xs[k - 1].position) continue;
    const cost = sse(0, k) + sse(k, n);
    if (!best || cost < best.cost) best = { k, cost };
  }
  if (!best) return null;
  const before = median(ys.slice(0, best.k));
  const after = median(ys.slice(best.k));
  // The later group must sit nearer the reference than the earlier, by most of their gap.
  if (!(Math.abs(after - referenceMedian) < 0.5 * Math.abs(before - referenceMedian))) return null;
  // And the split must explain most of the spread (R² of one change point).
  const total = sse(0, n);
  if (!(total > 0) || 1 - best.cost / total < 0.5) return null;
  return { lastControl: xs[best.k - 1].position, firstAfter: xs[best.k].position, before: { n: best.k, median: before }, after: { n: n - best.k, median: after } };
}

// From a score run's results: per condition, the controls (as the design names them, where it
// says they serve) and their separation in the direction the readout gives, and resolution.
function scoreMetrics(results, design) {
  const kind = results.variants.kind;
  const rows = controlRows(design, { ...results.variants, n: results.rows });
  const isSyn = new Uint8Array(results.rows);
  const isNon = new Uint8Array(results.rows);
  for (const i of rows.synonymous) isSyn[i] = 1;
  for (const i of rows.nonsense) isNon[i] = 1;
  const { side, stated } = lossSide(design);
  return results.conditions.map((c) => {
    const scoredWhere = (test) => {
      const out = [];
      for (let i = 0; i < results.rows; i += 1) if (!c.reason[i] && test(i) && Number.isFinite(c.score[i])) out.push(c.score[i]);
      return out;
    };
    const synonymous = scoredWhere((i) => isSyn[i]);
    const nonsense = scoredWhere((i) => isNon[i]);
    const missense = scoredWhere((i) => kind[i] === KIND.MISSENSE);
    // Every scored stop, controls or not, by position: where stops stop losing the function.
    const stops = [];
    for (let i = 0; i < results.rows; i += 1) if (!c.reason[i] && kind[i] === KIND.NONSENSE && Number.isFinite(c.score[i])) stops.push({ position: results.variants.position[i], score: c.score[i] });
    const wt = results.controls.wt >= 0 && !c.reason[results.controls.wt] ? c.score[results.controls.wt] : Number.NaN;
    const reference = synonymous.length >= 5 ? { what: 'synonymous', scores: synonymous } : Number.isFinite(wt) ? { what: 'wild type', scores: [wt] } : null;
    let separation = null;
    if (reference && nonsense.length >= 5) {
      const mRef = median(reference.scores);
      const mNon = median(nonsense);
      const spread = reference.scores.length > 1 ? Math.sqrt((square(mad(reference.scores)) + square(mad(nonsense))) / 2) : mad(nonsense);
      // The chance a reference variant sits on the wild-type side of a nonsense variant: below
      // them when loss of function scores high, either way when the score has no sign.
      const below = auc(reference.scores, nonsense);
      const aucValue = side === 'below' ? below : side === 'above' ? 1 - below : Math.max(below, 1 - below);
      const toward = side === 'above' ? -1 : side === 'below' ? 1 : Math.sign(mRef - mNon) || 1;
      const ref = sorted(reference.scores);
      separation = {
        reference: reference.what,
        side,
        stated,
        auc: aucValue,
        // Nonsense variants on the other side of the reference than the direction says (an AUC
        // well under 0.5): the direction may be the other way round.
        reversed: side !== 'either' && aucValue < 0.25,
        referenceMedian: mRef,
        nonsenseMedian: mNon,
        standardized: (toward * (mRef - mNon)) / spread,
        // The fraction of nonsense variants on the reference's side of its 5th (or 95th)
        // percentile (VAMP-seq's class threshold).
        nonsenseAbove: reference.scores.length > 1 ? nonsense.filter((x) => (toward > 0 ? x > quantileSorted(ref, 0.05) : x < quantileSorted(ref, 0.95))).length / nonsense.length : Number.NaN,
        controls: nonsense.length,
        stops: stops.length,
        change: nonsenseChange(stops, mRef),
      };
    }
    const ses = [];
    const points = [];
    const firsts = [];
    for (let i = 0; i < results.rows; i += 1) {
      if (c.reason[i] || !Number.isFinite(c.se[i])) continue;
      ses.push(c.se[i]);
      // The variant's input count: the mean over the condition's replicates that used it.
      const used = results.replicates.filter((r) => c.replicates.includes(r.id) && r.state[i] === 0);
      firsts.push([used.length ? mean(used.map((r) => r.first[i])) : Number.NaN, c.se[i], c.loo[i]]);
    }
    const step = Math.max(1, Math.ceil(ses.length / 3000));
    for (let i = 0, k = 0; i < results.rows; i += 1) {
      if (c.reason[i] || !Number.isFinite(c.se[i])) continue;
      if (k % step === 0) points.push([c.score[i], c.se[i], kind[i]]);
      k += 1;
    }
    // Uncertainty by input count: quintiles of the input count.
    const byInput = [];
    const ordered = firsts.filter((x) => Number.isFinite(x[0])).sort((a, b) => a[0] - b[0]);
    for (let b = 0; b < 5 && ordered.length >= 25; b += 1) {
      const part = ordered.slice(Math.floor((b * ordered.length) / 5), Math.floor(((b + 1) * ordered.length) / 5));
      byInput.push({ n: part.length, input: median(part.map((x) => x[0])), se: median(part.map((x) => x[1])), loo: median(part.map((x) => x[2]).filter(Number.isFinite)) });
    }
    const measured = c.flow.find((x) => x.stage === 'identifier')?.remaining ?? results.rows;
    return {
      id: c.id,
      name: c.name,
      scored: c.scored,
      measured,
      flow: c.flow,
      wt,
      classes: { synonymous: synonymous.length, nonsense: nonsense.length, missense: missense.length },
      separation,
      medianSE: median(ses),
      resolution: separation ? median(ses) / Math.abs(separation.referenceMedian - separation.nonsenseMedian) : Number.NaN,
      points,
      byInput,
      scores: { synonymous, nonsense, missense: missense.length > 4000 ? missense.filter((_, i) => i % Math.ceil(missense.length / 4000) === 0) : missense, wt },
    };
  });
}

// The χ² quantile at probability p for df degrees of freedom, by Wilson and Hilferty (1931), with
// z the standard normal quantile: within a few percent from df = 1, which is enough to read fits.
function chi2Quantile(z, df) {
  const a = 2 / (9 * df);
  const c = 1 - a + z * Math.sqrt(a);
  return df * c * c * c;
}

// From a regression run (score-regression.js), per replicate: the fits made, those on fewer time
// points than the replicate has, the measurements left out with too few points, and how far the
// fits depart from a line against counting noise: each fit's χ²/df over its median under counting
// noise alone (so 1 is typical), and the share beyond the 99.9th percentile (z = 3.0902).
function timeSeriesMetrics(results) {
  return results.replicates.filter((r) => r.points && r.fit).map((r) => {
    const T = r.times.length;
    let fits = 0;
    let fewer = 0;
    let excluded = 0;
    let beyond = 0;
    const ratios = [];
    for (let i = 0; i < results.rows; i += 1) {
      if (r.state[i] === 4) excluded += 1;
      if (r.state[i] !== 0) continue;
      fits += 1;
      if (r.points[i] < T) fewer += 1;
      const df = r.points[i] - 2;
      if (df < 1 || !Number.isFinite(r.fit[i])) continue;
      ratios.push(r.fit[i] / (chi2Quantile(0, df) / df));
      if (r.fit[i] > chi2Quantile(3.0902, df) / df) beyond += 1;
    }
    return { id: r.id, name: r.name, times: T, fits, fewer, excluded, departure: ratios.length ? median(ratios) : Number.NaN, beyond: ratios.length ? beyond / ratios.length : Number.NaN, assessed: ratios.length };
  });
}

// QC of an experiment. input: { names, columns: { name: Float64Array }, design, mode, results
// (a score run's results, optional), measures: { lowCount, agreementInput } }.
export function computeQC({ names, barcodes = null, columns, design, mode = 'lenient', results = null, measures = {} }) {
  const m = { ...DEFAULT_MEASURES, ...measures };
  const options = { level: design.variants.level, mode, target: design.targets?.length === 1 ? design.targets[0] : undefined };
  // A table of barcodes: counts summed per variant (score-barcodes.js).
  const groups = design.library?.level === 'barcode' && barcodes ? groupBarcodes(names, options, barcodes) : null;
  const variants = groups ? groups.variants : buildVariants(names, options);
  const n = variants.n;
  const pooledRows = new Map();
  for (const s of design.samples) {
    const parts = s.columns.map((c) => columns[c]).filter(Boolean);
    pooledRows.set(s.id, parts.length === s.columns.length ? sampleCounts(s, parts) : new Float64Array(names.length).fill(Number.NaN));
  }
  const pooled = groups ? new Map([...pooledRows].map(([id, c]) => [id, sumByVariant(c, groups)])) : pooledRows;
  // The samples, with their roles.
  const roles = new Map(design.samples.map((s) => [s.id, []]));
  const firstSamples = new Set();
  const binSamples = new Set();
  for (const r of design.replicates) {
    const slots = replicateSamples(r);
    for (const s of slots) {
      roles.get(s.sample)?.push({ replicate: r.id, role: s.role, time: s.time, order: s.order });
      if (s.role === 'bin') binSamples.add(s.sample);
    }
    const timed = slots.filter((s) => s.role !== 'bin');
    const times = timed.map((s) => (s.role === 'input' ? 0 : s.role === 'output' ? Infinity : s.time));
    timed.forEach((s, k) => {
      if (times[k] === Math.min(...times)) firstSamples.add(s.sample);
    });
  }
  const samples = design.samples.map((s) => ({ ...sampleMetrics(s, pooled.get(s.id), m.lowCount), roles: roles.get(s.id), input: firstSamples.has(s.id) }));
  // Observed: reads before selection in some replicate (in any bin, for sorted bins).
  const observed = new Uint8Array(n);
  for (const id of [...firstSamples, ...binSamples]) {
    const c = pooled.get(id);
    for (let i = 0; i < n; i += 1) if (c[i] > 0) observed[i] = 1;
  }
  // Replicates, by condition.
  const replicates = design.replicates.map((r) => ({ ...(design.model === 'bins' ? binRatios(r, pooled, variants, m.agreementInput) : rawRatios(r, pooled, variants, m.agreementInput)), tile: r.tile ?? null }));
  const conditionList = design.conditions?.length ? design.conditions : [{ id: null, name: 'All replicates' }];
  const conditions = conditionList.map((c) => {
    const reps = replicates.filter((r) => (c.id === null ? true : r.condition === c.id));
    // Replicates are compared within a tile: those of different tiles measure different variants
    // (but where tiles overlap) from different libraries.
    const groups = [...new Set(reps.map((r) => r.tile))].map((tile) => reps.filter((r) => r.tile === tile));
    const pairs = [];
    for (const g of groups) for (let j = 0; j < g.length; j += 1) for (let k = j + 1; k < g.length; k += 1) pairs.push(pairMetrics(g[j], g[k]));
    // The cells recorded (wave 2, slice 10): the bottleneck they predict, beside the one the pair's
    // disagreement implies.
    if (design.model === 'two-population') for (const pair of pairs) pair.recorded = recordedCells(design, pooled, [pair.a, pair.b]);
    const loo = groups.filter((g) => g.length >= 3).flatMap((g) => leaveOneOut(g) ?? []);
    const errorModel = design.model === 'two-population' ? groups.filter((g) => g.length >= 2).map((g) => errorModelOf(g, design, pooled, variants)) : [];
    return { id: c.id ?? 'all', name: c.name, replicates: reps.map((r) => r.id), dropout: reps.map((r) => ({ replicate: r.id, ...r.dropout })).filter((d) => d.sample), pairs, leaveOneOut: loo.length ? loo : null, synonymous: reps.map((r) => synonymousCheck(r, variants)), errorModel };
  });
  // Missingness: rows by their pattern of missing samples.
  const patterns = new Map();
  for (let i = 0; i < n; i += 1) {
    let key = '';
    for (const s of design.samples) key += Number.isNaN(pooled.get(s.id)[i]) ? '1' : '0';
    patterns.set(key, (patterns.get(key) ?? 0) + 1);
  }
  return {
    version: QC_VERSION,
    measures: m,
    rows: n,
    model: design.model,
    samples,
    coverage: coverage(design, variants, observed),
    conditions,
    missingness: { samples: design.samples.map((s) => s.id), patterns: [...patterns].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([pattern, count]) => ({ pattern, count })) },
    scores: results ? scoreMetrics(results, design) : null,
    // What the findings read their context from: the readout, how the library was made, where the
    // controls serve, whether the cells were recorded (wave 2, slice 8).
    context: {
      readout: readoutOf(design),
      libraryMethod: design.library?.method ?? null,
      tiles: design.library?.tiles?.length ?? 0,
      barcodes: design.library?.level === 'barcode',
      controls: { positions: design.controls?.positions ?? null, nonsense: design.controls?.nonsense ?? 'auto', synonymous: design.controls?.synonymous ?? 'auto' },
      cellsRecorded: design.samples.some((x) => Number.isFinite(x.cells)),
      conditions: design.conditions?.length ?? 0,
    },
    timeSeries: results && (results.parameters?.model === 'wls' || results.parameters?.model === 'ols') ? timeSeriesMetrics(results) : null,
    bins: design.model === 'bins' ? binMetrics(design, pooled) : null,
    barcodes: groups ? barcodeMetrics(design, pooledRows, groups, m.agreementInput) : null,
  };
}

// A table of barcodes: how many barcodes each variant has (counted with reads in a replicate's
// first sample, or any bin), the reads of the barcodes the map does not name, and per replicate
// (not sorted bins) φ and the outliers from raw log ratios (first and last samples, pseudocount
// 0.5, each sample's total as its normalizer), and the split-half agreement: each variant's
// barcodes split alternately into two halves, their counts summed, and the halves' log ratios
// correlated over variants with enough input reads in both.
function barcodeMetrics(design, pooledRows, groups, agreementInput) {
  const nv = groups.offsets.length - 1;
  const nb = groups.rows;
  // Reads of unmapped barcodes, over all samples.
  let reads = 0;
  let unmappedReads = 0;
  for (const counts of pooledRows.values()) {
    for (let b = 0; b < nb; b += 1) {
      const c = counts[b];
      if (!(c > 0)) continue;
      reads += c;
      if (groups.variantOf[b] < 0) unmappedReads += c;
    }
  }
  const replicates = design.replicates.map((r) => {
    const slots = replicateSamples(r);
    const timed = slots.filter((s) => s.role !== 'bin').map((s) => ({ ...s, time: s.role === 'input' ? 0 : s.role === 'output' ? Infinity : s.time })).sort((a, b) => a.time - b.time);
    const samples = (timed.length ? timed : slots).map((s) => pooledRows.get(s.sample));
    if (samples.some((x) => !x)) return null;
    // Barcodes per variant: counted, with reads before selection (in any bin, for sorted bins).
    const perVariant = new Int32Array(nv);
    const seen = new Uint8Array(nb);
    for (let b = 0; b < nb; b += 1) {
      const g = groups.variantOf[b];
      if (g < 0) continue;
      const before = timed.length ? samples[0][b] : samples.reduce((a, s) => a + s[b], 0);
      if (before > 0 && samples.every((s) => !Number.isNaN(s[b]))) {
        seen[b] = 1;
        perVariant[g] += 1;
      }
    }
    const measured = [];
    for (let g = 0; g < nv; g += 1) if (perVariant[g] > 0) measured.push(perVariant[g]);
    const histogram = new Array(11).fill(0);
    for (const k of measured) histogram[Math.min(10, k)] += 1;
    const out = {
      id: r.id, name: r.name ?? r.id, tile: r.tile ?? null,
      variants: measured.length, barcodes: measured.reduce((a, k) => a + k, 0),
      perVariant: { median: median(measured), q25: quantileSorted(sorted(measured), 0.25), q75: quantileSorted(sorted(measured), 0.75), single: measured.filter((k) => k === 1).length, histogram },
      phi: Number.NaN, outliers: 0, compared: 0, splitHalf: null,
    };
    if (!timed.length) return out;
    const first = samples[0];
    const last = samples[samples.length - 1];
    let r0 = P;
    let rT = P;
    for (let b = 0; b < nb; b += 1) {
      if (!seen[b]) continue;
      r0 += first[b];
      rT += last[b];
    }
    const score = new Float64Array(nb).fill(Number.NaN);
    const se = new Float64Array(nb).fill(Number.NaN);
    for (let b = 0; b < nb; b += 1) {
      if (!seen[b]) continue;
      score[b] = (log(last[b] + P) - log(rT)) - (log(first[b] + P) - log(r0));
      se[b] = Math.sqrt(1 / (first[b] + P) + 1 / (last[b] + P));
    }
    const d = barcodeDisagreement(score, se, seen, groups, OUTLIER_Z);
    // Split halves: alternate barcodes (in the order of their identifiers) to each half.
    const halves = [[], []];
    for (let g = 0; g < nv; g += 1) {
      const sums = [[0, 0], [0, 0]];
      let k = 0;
      for (let j = groups.offsets[g]; j < groups.offsets[g + 1]; j += 1) {
        const b = groups.members[j];
        if (!seen[b]) continue;
        sums[k % 2][0] += first[b];
        sums[k % 2][1] += last[b];
        k += 1;
      }
      if (k < 2 || sums[0][0] < agreementInput || sums[1][0] < agreementInput) continue;
      for (const h of [0, 1]) halves[h].push(log(sums[h][1] + P) - log(sums[h][0] + P));
    }
    return { ...out, phi: d.phi, outliers: d.outliers, compared: d.compared, outlierShare: d.compared ? d.outliers / d.compared : Number.NaN, splitHalf: halves[0].length >= 10 ? { r: pearson(halves[0], halves[1]), n: halves[0].length } : null };
  }).filter(Boolean);
  return { rows: nb, unmapped: groups.unmapped, unmappedReadShare: reads > 0 ? unmappedReads / reads : 0, rewritten: groups.rewritten, replicates };
}
