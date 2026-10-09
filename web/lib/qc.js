// Quality-control metrics (requirements Q1–Q7): whether an experiment supports reliable scores.
// Pure; the score worker computes them (message 'qc'), the validation suite `qc` in Node.
//
// From the counts and the design alone (no score run needed): each sample's depth, observed,
// zero, low and missing counts, count distribution and rank-abundance; coverage of the designed
// single substitutions by position and class; replicate agreement (Pearson and Spearman of
// replicates' log ratios, on variants with enough input reads); the variance of replicate
// differences against what counting predicts, fitted as a·(counting variance) + e: a ≈ 1 + reads
// per cell, so a > 1 points to a bottleneck (fewer cells than reads), and e is variance between
// replicates beyond counting (DiMSum's multiplicative and additive error terms); leave-one-out z
// of each replicate against the others (an outlier replicate); synonymous log ratios against
// their Poisson expectation; missingness patterns.
//
// From a score run's results, when given: the controls' scores and their separation, the median
// SE against the controls' gap (resolution), score uncertainty by input count, and the filter
// flow. Findings (pass, review, fail) are drawn from these by findings.js.

import { buildVariants, KIND, STATUS } from './variants.js';
import { replicateSamples, targetLength } from './design.js';
import { poolColumns } from './replicates.js';
import { auc, mad, mean, median, MEDIAN_CHI2_1, nonNegativeLine, pearson, quantileSorted, sorted, spearman, variance } from './stats.js';

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
  const top = s.length ? Math.log10(s[s.length - 1] + 1) : 0;
  const bins = Math.max(1, Math.ceil(top * 4) + 1);
  const histogram = new Array(bins).fill(0);
  for (const c of values) histogram[Math.min(bins - 1, Math.floor(Math.log10(c + 1) * 4))] += 1 / values.length;
  // Rank-abundance: counts from the most to the least abundant, at about 64 ranks.
  const rankAbundance = [];
  for (let k = 0; k < 64 && s.length; k += 1) {
    const rank = Math.min(s.length, Math.max(1, Math.round(s.length ** (k / 63))));
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
  return { assessed: true, length, offset: target.offset ?? 0, grid, designed, inTable, observed: seen, fraction: designed ? seen / designed : Number.NaN, byClass };
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
    y[i] = Math.log(last[i] + P) - Math.log(first[i] + P);
    v[i] = 1 / (first[i] + P) + 1 / (last[i] + P);
    usable[i] = first[i] >= agreementInput && variants.status[i] !== STATUS.INVALID ? 1 : 0;
  }
  return { id: replicate.id, name: replicate.name ?? replicate.id, condition: replicate.condition ?? null, first, y, v, usable, firstSample: slots[0]?.sample, dropout: dropout(slots, samples, variants, agreementInput) };
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
  const r2 = d.map((x) => (x - offset) ** 2);
  out.ratio = median(r2.map((x, i) => x / pv[i])) / MEDIAN_CHI2_1;
  // Bins of counting variance; the robust variance of the differences in each.
  const order = pv.map((_, i) => i).sort((i, j) => pv[i] - pv[j]);
  const nb = Math.max(1, Math.min(10, Math.floor(n / 40)));
  for (let b = 0; b < nb; b += 1) {
    const idx = order.slice(Math.floor((b * n) / nb), Math.floor(((b + 1) * n) / nb));
    out.bins.push({ n: idx.length, counting: mean(idx.map((i) => pv[i])), observed: median(idx.map((i) => r2[i])) / MEDIAN_CHI2_1 });
  }
  const fit = nonNegativeLine(out.bins.map((x) => x.counting), out.bins.map((x) => x.observed), out.bins.map((x) => x.n / x.counting ** 2));
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

// From a score run's results: per condition, the controls and resolution.
function scoreMetrics(results) {
  const kind = results.variants.kind;
  return results.conditions.map((c) => {
    const scored = (k) => {
      const out = [];
      for (let i = 0; i < results.rows; i += 1) if (!c.reason[i] && kind[i] === k && Number.isFinite(c.score[i])) out.push(c.score[i]);
      return out;
    };
    const synonymous = scored(KIND.SYNONYMOUS);
    const nonsense = scored(KIND.NONSENSE);
    const missense = scored(KIND.MISSENSE);
    const wt = results.controls.wt >= 0 && !c.reason[results.controls.wt] ? c.score[results.controls.wt] : Number.NaN;
    const reference = synonymous.length >= 5 ? { what: 'synonymous', scores: synonymous } : Number.isFinite(wt) ? { what: 'wild type', scores: [wt] } : null;
    let separation = null;
    if (reference && nonsense.length >= 5) {
      const mRef = median(reference.scores);
      const mNon = median(nonsense);
      const spread = reference.scores.length > 1 ? Math.sqrt((mad(reference.scores) ** 2 + mad(nonsense) ** 2) / 2) : mad(nonsense);
      separation = {
        reference: reference.what,
        auc: auc(reference.scores, nonsense),
        referenceMedian: mRef,
        nonsenseMedian: mNon,
        standardized: (mRef - mNon) / spread,
        // The fraction of nonsense variants scored above the reference's 5th percentile (VAMP-seq's class threshold).
        nonsenseAbove: reference.scores.length > 1 ? nonsense.filter((x) => x > quantileSorted(sorted(reference.scores), 0.05)).length / nonsense.length : Number.NaN,
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

// QC of an experiment. input: { names, columns: { name: Float64Array }, design, mode, results
// (a score run's results, optional), measures: { lowCount, agreementInput } }.
export function computeQC({ names, columns, design, mode = 'lenient', results = null, measures = {} }) {
  const m = { ...DEFAULT_MEASURES, ...measures };
  const variants = buildVariants(names, { level: design.variants.level, mode, target: design.targets?.length === 1 ? design.targets[0] : undefined });
  const n = names.length;
  const pooled = new Map();
  for (const s of design.samples) {
    const parts = s.columns.map((c) => columns[c]).filter(Boolean);
    pooled.set(s.id, parts.length === s.columns.length ? poolColumns(parts) : new Float64Array(n).fill(Number.NaN));
  }
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
  const replicates = design.model === 'bins' ? [] : design.replicates.map((r) => rawRatios(r, pooled, variants, m.agreementInput));
  const conditionList = design.conditions?.length ? design.conditions : [{ id: null, name: 'All replicates' }];
  const conditions = conditionList.map((c) => {
    const reps = replicates.filter((r) => (c.id === null ? true : r.condition === c.id));
    const pairs = [];
    for (let j = 0; j < reps.length; j += 1) for (let k = j + 1; k < reps.length; k += 1) pairs.push(pairMetrics(reps[j], reps[k]));
    return { id: c.id ?? 'all', name: c.name, replicates: reps.map((r) => r.id), dropout: reps.map((r) => ({ replicate: r.id, ...r.dropout })).filter((d) => d.sample), pairs, leaveOneOut: reps.length >= 3 ? leaveOneOut(reps) : null, synonymous: reps.map((r) => synonymousCheck(r, variants)) };
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
    scores: results ? scoreMetrics(results) : null,
  };
}
