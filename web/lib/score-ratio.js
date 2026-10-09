// Two-population log ratios (requirement S1; mavescape-spec/research.md §2.1). For one biological
// replicate with counts c₀ before and c_T after selection (technical replicates already summed):
//
//   score = [ln(c_T + p) − ln r_T] − [ln(c₀ + p) − ln r₀]
//   SE²   = 1/(c₀ + p) + 1/(c_T + p) + 1/r₀ + 1/r_T
//
// where p is the pseudocount and r the normalizer of each sample:
//
// - 'wt':       the wild type's count + p (its score is then 0);
// - 'complete': the sum over variants counted in every sample of the replicate, + p once;
// - 'full':     the sum over every variant counted in that sample, + p once;
// - 'synonymous': no normalizer (r = 1, no 1/r terms); the replicate's median synonymous score is
//   subtracted instead, so synonymous variants center on 0.
//
// With p = 0.5 these are Enrich2 2.0.2's "ratios" (its single 0.5 added to library sizes, issue
// #75, kept so that the numbers agree), and in 'wt' mode dms_variants' func_scores in natural
// logarithms. A time series scored this way uses its first and last time points, as Enrich2's
// "ratios" does. Library sizes count every row of the table, whatever the filters: they describe
// the sequencing, not the analysis.

import { log } from './dmath.js';

export const NORMALIZATIONS = {
  wt: 'wild type',
  complete: 'complete cases (variants counted in every sample)',
  full: 'all reads of each sample',
  synonymous: 'median of synonymous variants',
};

// The normalizers [r₀, r_T] of a replicate. samples: [Float64Array] (counts of its samples, in
// order); counted: Uint8Array (1 where a row is counted in every sample); wtRow: the wild type's
// row (for 'wt'). Throws, saying why, when the reference is not available.
export function normalizers(method, samples, counted, { pseudocount, wtRow = -1, label = 'this replicate' }) {
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (method === 'wt') {
    if (wtRow < 0) throw new Error('Wild-type normalization needs the wild type\'s row, and the table has none: choose another normalization, or name the wild type in the design\'s controls.');
    if (!counted[wtRow]) throw new Error(`The wild type is not counted in every sample of ${label}: its normalization is not available there.`);
    if (first[wtRow] <= 0 || last[wtRow] <= 0) throw new Error(`The wild type has no reads in a sample of ${label}: scores cannot be normalized to it.`);
    return [first[wtRow] + pseudocount, last[wtRow] + pseudocount];
  }
  if (method === 'complete') {
    let a = 0;
    let b = 0;
    for (let i = 0; i < first.length; i += 1) {
      if (!counted[i]) continue;
      a += first[i];
      b += last[i];
    }
    return [a + pseudocount, b + pseudocount];
  }
  if (method === 'full') {
    const sum = (c) => {
      let s = 0;
      for (let i = 0; i < c.length; i += 1) if (!Number.isNaN(c[i])) s += c[i];
      return s;
    };
    return [sum(first) + pseudocount, sum(last) + pseudocount];
  }
  if (method === 'synonymous') return [1, 1];
  throw new Error(`Unknown normalization "${method}".`);
}

// Scores and SEs of one replicate: { score, se } (Float64Array, NaN where `use` is 0).
// For 'synonymous', `reference` lists the synonymous rows whose median is subtracted (those used
// in this replicate); it throws when there is none.
export function ratioScores(method, samples, use, r, { pseudocount, reference = null, label = 'this replicate' }) {
  const first = samples[0];
  const last = samples[samples.length - 1];
  const n = first.length;
  const score = new Float64Array(n).fill(Number.NaN);
  const se = new Float64Array(n).fill(Number.NaN);
  const libraryTerm = method === 'synonymous' ? 0 : 1 / r[0] + 1 / r[1];
  for (let i = 0; i < n; i += 1) {
    if (!use[i]) continue;
    const c0 = first[i] + pseudocount;
    const cT = last[i] + pseudocount;
    // In Enrich2's order of operations, so that the numbers agree to the last digits.
    score[i] = method === 'synonymous' ? log(cT) - log(c0) : (log(cT) - log(r[1])) - (log(c0) - log(r[0]));
    se[i] = Math.sqrt(1 / c0 + 1 / cT + libraryTerm);
  }
  if (method === 'synonymous') {
    const values = (reference ?? []).filter((i) => use[i]).map((i) => score[i]);
    if (!values.length) throw new Error(`No synonymous variant is scored in ${label}: synonymous normalization is not available there.`);
    const m = median(values);
    for (let i = 0; i < n; i += 1) if (use[i]) score[i] -= m;
    return { score, se, median: m, references: values.length };
  }
  return { score, se };
}

export function median(values) {
  const sorted = Float64Array.from(values).sort();
  const n = sorted.length;
  if (!n) return Number.NaN;
  return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}
