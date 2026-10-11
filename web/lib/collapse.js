// A nucleotide-level run read at the protein level (wave 3, slice 3; requirement D10): the
// nucleotide variants of a DNA target merged into the protein variants they make, as DiMSum
// merges them by default (DiMSum 1.4, MIT; mixedSubstitutions = FALSE;
// R/dimsum__aggregate_AA_variants_fitness.R, R/dimsum__process_merged_variants.R):
//
//   - the variants that make the same protein (the same protein change: p.Ala12Val; an in-frame
//     deletion, insertion or deletion-insertion; a multi-variant) are one protein variant, its
//     score the mean of theirs weighted by 1/SE² and its SE √(1/Σ 1/SE²); counts are summed;
//   - a variant that changes one amino acid and leaves another codon synonymous ("mixed") is left
//     out, as DiMSum leaves it out;
//   - the wild type stays itself; synonymous variants at one codon are merged the same way (into
//     p.Ala12=, the map's reference cell; DiMSum keeps them apart, in its table of synonymous
//     variants);
//   - a frameshift is not merged with another (MAVE-HGVS names every frameshift at a codon alike,
//     p.Gly5fs, though they make different proteins), nor are variants with no protein change
//     (UTR, intron, splice site): they stay at the nucleotide level, beside the map.
//
// Variants without an SE (published scores that give none) are averaged without weights, and the
// merged SE is unknown. Each protein variant keeps its members (rows of the nucleotide run).
//
//   proteinView(results) → { rows, variants, conditions, replicates, samples, controls,
//                            differential, collapse } | null (not a nucleotide run of a DNA target)

import { KIND, STATUS } from './variants.js';

const views = new WeakMap();

// The protein view of a run's results, computed once per results object.
export function proteinView(results) {
  if (!results?.variants?.proKey) return null;
  if (!views.has(results)) views.set(results, buildView(results));
  return views.get(results);
}

function buildView(results) {
  const v = results.variants;
  const n = results.rows;
  const groups = new Map();
  let mixed = 0;
  let unmerged = 0;
  let wt = -1;
  for (let i = 0; i < n; i += 1) {
    if (v.status[i] === 3) continue;
    const kind = v.kind[i];
    if (kind === KIND.WT) {
      if (wt < 0) wt = i;
      continue;
    }
    if (v.mixed[i]) {
      mixed += 1;
      continue;
    }
    const key = v.proKey[i];
    if (!key || kind === KIND.FRAMESHIFT || key.startsWith('p.[') && kind === KIND.SYNONYMOUS) {
      unmerged += 1;
      continue;
    }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  }
  const order = [...groups.keys()];
  if (wt >= 0) order.unshift('p.=');
  const members = order.map((key) => Int32Array.from(key === 'p.=' && wt >= 0 ? [wt] : groups.get(key)));
  const m = order.length;
  const firstOf = members.map((rows) => rows[0]);
  const variants = {
    n: m,
    level: 'protein',
    key: order,
    original: members.map((rows) => Array.from(rows, (r) => v.original[r]).join('; ')),
    kind: Uint8Array.from(firstOf, (r) => v.kind[r]),
    position: Int32Array.from(firstOf, (r) => v.proPosition[r]),
    ref: Uint8Array.from(firstOf, (r) => v.proRef[r]),
    alt: Uint8Array.from(firstOf, (r) => v.proAlt[r]),
    status: new Uint8Array(m).fill(STATUS.VALID),
    members,
  };
  const conditions = results.conditions.map((c) => mergeCondition(c, members));
  const replicates = results.replicates.map((r) => mergeReplicate(r, members));
  const samples = (results.samples ?? []).map((s) => ({ ...s, counts: sumRows(s.counts, members), barcodeCounts: null }));
  const differential = results.differential ? results.differential.map((d) => mergeContrast(d, members)) : null;
  const merged = members.filter((rows) => rows.length > 1).length;
  // Merged without weights: some of a protein variant's scored members have no SE.
  const c0 = results.conditions[0];
  const unweighted = c0 ? members.filter((rows) => {
    const used = Array.from(rows).filter((r) => !c0.reason[r] && Number.isFinite(c0.score[r]));
    return used.length > 1 && !used.every((r) => c0.se[r] > 0);
  }).length : 0;
  return {
    format: results.format,
    version: results.version,
    rows: m,
    variants,
    controls: { ...results.controls, wt: wt >= 0 ? 0 : -1 },
    parameters: results.parameters,
    replicates,
    conditions,
    samples,
    barcodes: null,
    dimsum: null,
    differential,
    warnings: [],
    info: [],
    collapse: {
      // The nucleotide variants read (valid names on the target), and those of a score set's other
      // targets, set aside.
      from: Array.from(v.status).filter((x) => x !== 3).length,
      elsewhere: v.otherTarget ? v.otherTarget.reduce((a, x) => a + x, 0) : 0,
      proteinVariants: m - (wt >= 0 ? 1 : 0),
      merged,
      unweighted,
      mergedFrom: members.reduce((a, rows) => a + (rows.length > 1 ? rows.length : 0), 0),
      mixed,
      unmerged,
      nucleotide: results,
    },
  };
}

// One condition's scores merged: the inverse-variance mean of the members scored.
function mergeCondition(c, members) {
  const m = members.length;
  const score = new Float64Array(m).fill(Number.NaN);
  const se = new Float64Array(m).fill(Number.NaN);
  const k = new Uint8Array(m);
  const expected = new Uint8Array(m);
  const reason = new Uint8Array(m);
  const flags = new Uint8Array(m);
  const ciLow = c.ciLow ? new Float64Array(m).fill(Number.NaN) : null;
  const ciHigh = c.ciHigh ? new Float64Array(m).fill(Number.NaN) : null;
  let scored = 0;
  members.forEach((rows, j) => {
    const used = Array.from(rows).filter((r) => !c.reason[r] && Number.isFinite(c.score[r]));
    expected[j] = Math.max(...Array.from(rows, (r) => c.expected[r]));
    if (!used.length) {
      reason[j] = c.reason[rows[0]] || 1;
      return;
    }
    scored += 1;
    const merged = mean(used.map((r) => c.score[r]), used.map((r) => c.se[r]));
    score[j] = merged.score;
    se[j] = merged.se;
    k[j] = Math.max(...used.map((r) => c.k[r]));
    flags[j] = used.reduce((a, r) => a | c.flags[r], 0);
    if (ciLow && used.length === 1) {
      ciLow[j] = c.ciLow[used[0]];
      ciHigh[j] = c.ciHigh[used[0]];
    }
  });
  const nan = () => new Float64Array(m).fill(Number.NaN);
  return {
    id: c.id,
    name: c.name,
    replicates: c.replicates,
    score, se, k, expected, reason, flags,
    tau2: nan(), i2: nan(), q: nan(), loo: nan(), looReplicate: new Int16Array(m).fill(-1), epsilon: null,
    ...(ciLow ? { ciLow, ciHigh } : {}),
    rescale: c.rescale,
    scored,
    combinedFromAll: 0,
    ...(c.published ? { published: true } : {}),
  };
}

// DiMSum's merge: Σ(s/σ²)/Σ(1/σ²) and √(1/Σ(1/σ²)); without every SE, the plain mean.
export function mean(scores, ses) {
  if (scores.length === 1) return { score: scores[0], se: ses[0] };
  if (ses.every((s) => s > 0 && Number.isFinite(s))) {
    let w = 0;
    let ws = 0;
    scores.forEach((s, i) => {
      const x = 1 / (ses[i] * ses[i]);
      w += x;
      ws += x * s;
    });
    return { score: ws / w, se: Math.sqrt(1 / w) };
  }
  return { score: scores.reduce((a, b) => a + b, 0) / scores.length, se: Number.NaN };
}

// A replicate's counts summed over the members (as DiMSum sums them); used where any member is.
function mergeReplicate(r, members) {
  const m = members.length;
  const out = { ...r, state: new Uint8Array(m), first: sumRows(r.first, members), last: sumRows(r.last, members), score: new Float64Array(m).fill(Number.NaN), se: new Float64Array(m).fill(Number.NaN) };
  members.forEach((rows, j) => {
    out.state[j] = Array.from(rows).some((x) => r.state[x] === 0) ? 0 : r.state[rows[0]];
  });
  return out;
}

function sumRows(values, members) {
  if (!values) return values;
  return Float64Array.from(members, (rows) => {
    let sum = Number.NaN;
    for (const r of rows) if (Number.isFinite(values[r])) sum = Number.isNaN(sum) ? values[r] : sum + values[r];
    return sum;
  });
}

// A contrast's differences merged as the scores are; its p and q values are not (they are each
// variant's, and are shown with its members).
function mergeContrast(d, members) {
  const m = members.length;
  const delta = new Float64Array(m).fill(Number.NaN);
  const se = new Float64Array(m).fill(Number.NaN);
  const nan = () => new Float64Array(m).fill(Number.NaN);
  const reason = new Uint8Array(m);
  const k = new Uint8Array(m);
  members.forEach((rows, j) => {
    const used = Array.from(rows).filter((r) => !d.reason[r] && Number.isFinite(d.delta[r]));
    if (!used.length) {
      reason[j] = d.reason[rows[0]] || 1;
      return;
    }
    const merged = mean(used.map((r) => d.delta[r]), used.map((r) => d.se[r]));
    delta[j] = merged.score;
    se[j] = merged.se;
    k[j] = Math.max(...used.map((r) => d.k[r]));
  });
  const ciLow = Float64Array.from(delta, (x, j) => x - 1.959963984540054 * se[j]);
  const ciHigh = Float64Array.from(delta, (x, j) => x + 1.959963984540054 * se[j]);
  return { ...d, delta, se, reason, k, z: nan(), p: nan(), q: nan(), ciLow, ciHigh, pairs: d.pairs, merged: true };
}
