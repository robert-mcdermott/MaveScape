// Differential scores between conditions (requirement S10; mavescape-spec/research.md §2.6): each
// condition against the reference condition, by one of three methods.
//
// - paired (the default): replicates of the two conditions that share their input sample (one
//   library, selected two ways) are paired, and each variant's differences d = s_B − s_A within the
//   pairs are combined as the run combines replicates (REML, fixed effects, …). The input's
//   counting error is common to both scores of a pair and cancels from d, so its variance is
//   SE_A² + SE_B² − 2 cov, cov being the input's share 1/(c_in + p) (and 1/r_in when the
//   normalizer is the same). Treating the scores as independent counts the input twice and
//   overstates the uncertainty. Without shared inputs, the conditions are independent.
// - independent: the conditions' combined scores taken as independent, Δ = s_B − s_A,
//   SE = √(SE_A² + SE_B²), z = Δ/SE: Enrich2's comparison of conditions (calc_pvalues_pairwise).
// - limma: a linear model of every sample's voom log counts, relative to the wild type or to the
//   synonymous variants' summed counts (one term for each input library and one for selection in
//   each condition), with moderated t-statistics for each contrast, as mutscan's
//   calculateRelativeFC(method = "limma", WTrows = those rows) computes them (web/lib/limma.js); its
//   log₂ fold changes are reported in natural logarithms, like the scores.
//
// p-values are two-sided (normal for paired and independent, t for limma) and adjusted by
// Benjamini and Hochberg within each contrast.

import { adjustBH } from './distributions.js';
import { exp, log, normalUpper } from './dmath.js';
import { contrastFit, lmFit, moderatedT, voom } from './limma.js';
import { combine } from './replicates.js';

export const DIFFERENTIAL_METHODS = {
  paired: 'replicates paired by their shared input',
  independent: 'the conditions as independent (Enrich2\'s z)',
  limma: 'limma\'s moderated t on voom log counts (mutscan)',
};

// Why a variant has no differential score in a contrast.
export const DIFFERENTIAL_REASON = { ESTIMATED: 0, REFERENCE: 1, CONDITION: 2, UNPAIRED: 3, NOT_COUNTED: 4 };
export const DIFFERENTIAL_REASON_NAMES = ['estimated', 'not scored in the reference condition', 'not scored in the condition', 'no pair of replicates measures it in both conditions', 'not counted in every sample (limma)'];

const LN2 = 0.6931471805599453;
const Z95 = 1.959963984540054;

// The contrasts of a design: each condition against the reference (the condition marked
// reference, else the first).
export function contrastsOf(design) {
  const conditions = design.conditions ?? [];
  if (conditions.length < 2) return [];
  const reference = conditions.find((c) => c.reference) ?? conditions[0];
  return conditions.filter((c) => c !== reference).map((c) => ({ id: `${c.id}-vs-${reference.id}`, condition: c.id, reference: reference.id, name: `${c.name ?? c.id} vs ${reference.name ?? reference.id}` }));
}

// Pairs of replicates, one of each condition, that share their first sample (the input) and their
// tile; several candidates: the same biological replicate number first, then design order.
export function pairReplicates(reference, condition) {
  const used = new Set();
  const pairs = [];
  for (const b of condition) {
    const candidates = reference.filter((a) => !used.has(a) && a.samples[0] === b.samples[0] && (a.tile ?? null) === (b.tile ?? null));
    const a = candidates.find((x) => x.biological === b.biological) ?? candidates[0];
    if (!a) continue;
    used.add(a);
    pairs.push([a, b]);
  }
  const paired = new Set(pairs.flat());
  return { pairs, unpaired: [...reference, ...condition].filter((r) => !paired.has(r)) };
}

// The linear map of a condition's rescaling (s′ = offset + slope·s), identity without one.
export function transformOf(condition) {
  const r = condition.rescale;
  if (!r) return { offset: 0, slope: 1 };
  return { offset: r.anchors[0].to - r.anchors[0].from * r.slope, slope: r.slope };
}

// Normal z-tests: two-sided p and BH-adjusted q over the estimated variants.
function finish(out) {
  const { delta, se, reason } = out;
  const n = delta.length;
  const z = new Float64Array(n).fill(Number.NaN);
  const p = new Float64Array(n).fill(Number.NaN);
  const ciLow = new Float64Array(n).fill(Number.NaN);
  const ciHigh = new Float64Array(n).fill(Number.NaN);
  for (let i = 0; i < n; i += 1) {
    if (reason[i]) continue;
    z[i] = delta[i] / se[i];
    p[i] = 2 * normalUpper(Math.abs(z[i]));
    ciLow[i] = delta[i] - Z95 * se[i];
    ciHigh[i] = delta[i] + Z95 * se[i];
  }
  return { ...out, z, p, q: adjustBH(p), ciLow, ciHigh };
}

// One pair's difference for row i (b's score less a's, each rescaled as its condition is) and its
// variance without the input they share: null when either replicate does not use the row.
export function pairDifference(a, b, i, { tA, tB, pseudocount, normalization }) {
  if (a.state[i] !== 0 || b.state[i] !== 0) return null;
  // The input's share of each score's variance, common to both.
  let shared = 1 / (a.first[i] + pseudocount);
  if (normalization !== 'synonymous' && a.normalizers[0] === b.normalizers[0]) shared += 1 / a.normalizers[0];
  return {
    d: tB.offset + tB.slope * b.score[i] - (tA.offset + tA.slope * a.score[i]),
    v: tB.slope * tB.slope * b.se[i] * b.se[i] + tA.slope * tA.slope * a.se[i] * a.se[i] - 2 * tA.slope * tB.slope * shared,
  };
}

// Paired or independent differential scores of one contrast. replicates: the run's replicate
// results; conditions: the run's per-condition results; p: parameters. Returns the contrast's
// result, with `method` the method used and `note` when it differs from the one asked.
export function differentialContrast(contrast, { replicates, conditions, p, method }) {
  const cA = conditions.find((c) => c.id === contrast.reference);
  const cB = conditions.find((c) => c.id === contrast.condition);
  const n = cA.score.length;
  const delta = new Float64Array(n).fill(Number.NaN);
  const se = new Float64Array(n).fill(Number.NaN);
  const tau2 = new Float64Array(n).fill(Number.NaN);
  const k = new Uint8Array(n);
  const reason = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    if (cA.reason[i]) reason[i] = DIFFERENTIAL_REASON.REFERENCE;
    else if (cB.reason[i]) reason[i] = DIFFERENTIAL_REASON.CONDITION;
  }
  const repsA = replicates.filter((r) => cA.replicates.includes(r.id));
  const repsB = replicates.filter((r) => cB.replicates.includes(r.id));
  const base = { ...contrast, requested: method, delta, se, tau2, k, reason, pairs: [], unpaired: [], note: null };
  let used = method;
  let note = null;
  let pairing = null;
  if (method === 'paired') {
    // The input cancels exactly only from log ratios of counts: not from slopes, bins, DiMSum's
    // scaled fitness or barcodes scored one by one.
    const ratio = p.model === 'ratio' && p.aggregation !== 'barcode';
    pairing = ratio ? pairReplicates(repsA, repsB) : null;
    if (!ratio) {
      used = 'independent';
      note = `Pairing by a shared input applies to log ratios of counts; ${p.model === 'dimsum' ? 'DiMSum\'s scaled fitness' : p.aggregation === 'barcode' ? 'barcodes scored one by one' : p.model === 'wls' || p.model === 'ols' ? 'slopes on time' : 'scores from bins'} are compared as independent.`;
    } else if (!pairing.pairs.length) {
      used = 'independent';
      note = `No replicate of ${contrast.name.split(' vs ')[0]} shares its input with one of the reference: the conditions are independent.`;
    } else if (pairing.unpaired.length) {
      note = `${pairing.unpaired.length} replicate${pairing.unpaired.length > 1 ? 's' : ''} (${pairing.unpaired.map((r) => r.name).join(', ')}) share${pairing.unpaired.length > 1 ? '' : 's'} no input with the other condition and ${pairing.unpaired.length > 1 ? 'are' : 'is'} not used in the differential scores.`;
    }
  }
  if (used === 'independent') {
    for (let i = 0; i < n; i += 1) {
      if (reason[i]) continue;
      delta[i] = cB.score[i] - cA.score[i];
      se[i] = Math.sqrt(cA.se[i] * cA.se[i] + cB.se[i] * cB.se[i]);
      k[i] = Math.min(cA.k[i], cB.k[i]);
    }
    return finish({ ...base, method: 'independent', note });
  }
  // Paired: each pair's difference, its variance without the shared input.
  const terms = { tA: transformOf(cA), tB: transformOf(cB), pseudocount: p.pseudocount, normalization: p.normalization };
  const pairs = pairing.pairs;
  const ys = new Array(n);
  const vs = new Array(n);
  let complete = 0;
  for (let i = 0; i < n; i += 1) {
    if (reason[i]) continue;
    const y = [];
    const v = [];
    for (const [a, b] of pairs) {
      const t = pairDifference(a, b, i, terms);
      if (!t) continue;
      y.push(t.d);
      v.push(t.v);
    }
    if (!y.length) {
      reason[i] = DIFFERENTIAL_REASON.UNPAIRED;
      continue;
    }
    ys[i] = y;
    vs[i] = v;
    if (y.length === pairs.length) complete += 1;
  }
  for (let i = 0; i < n; i += 1) {
    if (reason[i]) continue;
    const c = combine(p.combination, ys[i], vs[i], complete);
    delta[i] = c.estimate;
    se[i] = c.se;
    tau2[i] = c.tau2;
    k[i] = ys[i].length;
  }
  return finish({ ...base, method: 'paired', note, pairs: pairs.map(([a, b]) => [a.id, b.id]), unpaired: pairing.unpaired.map((r) => r.id) });
}

// The limma model of a two-population design: one column for each input library and one for
// selection in each condition. replicates: the design's replicates (input, output, condition);
// conditions: the design's. Returns { samples (ids, in order), X (S × P), P, libraries, columns
// (condition id → column) } or { refused }.
export function limmaDesign(design) {
  const reps = design.replicates;
  const conditions = design.conditions ?? [];
  const known = new Set(conditions.map((c) => c.id));
  const without = reps.filter((r) => !known.has(r.condition));
  if (without.length) return { refused: `limma needs every replicate in a condition; ${without.map((r) => r.name ?? r.id).slice(0, 4).join(', ')} ${without.length > 1 ? 'have' : 'has'} none.` };
  const inputs = [];
  for (const r of reps) if (!inputs.includes(r.input)) inputs.push(r.input);
  const outputs = reps.map((r) => r.output);
  if (outputs.some((o) => inputs.includes(o))) return { refused: 'limma needs each sample to be an input or an output, not both.' };
  if (new Set(outputs).size !== outputs.length) return { refused: 'limma needs each output sample in one replicate.' };
  const samples = [...inputs, ...outputs];
  const L = inputs.length;
  const columns = new Map(conditions.map((c, j) => [c.id, L + j]));
  const P = L + conditions.length;
  const S = samples.length;
  const X = new Float64Array(S * P);
  inputs.forEach((s, j) => {
    X[j * P + j] = 1;
  });
  reps.forEach((r, j) => {
    const row = L + j;
    X[row * P + inputs.indexOf(r.input)] = 1;
    X[row * P + columns.get(r.condition)] = 1;
  });
  if (S - P < 1) return { refused: `limma needs more samples than terms: ${S} samples for ${P} terms (an input library each and selection in each condition) leave no residual degrees of freedom. Use more replicates, or the paired differential.` };
  return { samples, X, P, S, libraries: L, columns };
}

// limma's differential scores for every contrast, from one fit. counts: Map sample id →
// Float64Array (all rows); rows: the rows to fit (counted in every sample); reference: the rows
// whose summed counts are the library sizes (the wild type, or the synonymous variants), those of
// them among `rows` used. Returns { contrasts: [...], fit: { rows, samples, libSize, span } } or
// { refused }.
export function limmaDifferential(design, contrasts, { counts, rows, reference, referenceName = 'the wild type', n }) {
  const model = limmaDesign(design);
  if (model.refused) return model;
  const { samples, X, P, S } = model;
  const fitted = new Set(rows);
  const refRows = reference.filter((i) => fitted.has(i));
  if (!refRows.length) return { refused: `limma's differential is relative to ${referenceName} (mutscan's WTrows), which must be counted in every sample.` };
  const G = rows.length;
  const Y = new Float64Array(G * S);
  const lib = new Float64Array(S);
  samples.forEach((s, j) => {
    const c = counts.get(s);
    rows.forEach((i, g) => {
      Y[g * S + j] = c[i];
      lib[j] += c[i];
    });
  });
  const wt = samples.map((s) => {
    const c = counts.get(s);
    let sum = 0;
    for (const i of refRows) sum += c[i];
    return sum;
  });
  if (wt.some((w) => !(w > 0))) return { refused: `limma's differential is relative to ${referenceName}, which ${refRows.length > 1 ? 'have' : 'has'} no reads in a sample.` };
  // The wild type's counts as library sizes, scaled to the libraries' geometric mean (edgeR's
  // scaleOffset, as mutscan uses it): exp(ln w − mean ln w + mean ln L).
  let meanLogWt = 0;
  let meanLogLib = 0;
  for (let j = 0; j < S; j += 1) {
    meanLogWt += log(wt[j]);
    meanLogLib += log(lib[j]);
  }
  meanLogWt /= S;
  meanLogLib /= S;
  const libSize = Float64Array.from(wt, (w) => exp(log(w) - meanLogWt + meanLogLib));
  const v = voom(Y, X, libSize, G, S, P);
  const fit = lmFit(v.E, X, v.weights, G, S, P);
  const results = contrasts.map((contrast) => {
    const c = new Float64Array(P);
    c[model.columns.get(contrast.condition)] = 1;
    c[model.columns.get(contrast.reference)] = -1;
    const m = moderatedT(fit, contrastFit(fit, c));
    const out = {
      ...contrast, requested: 'limma', method: 'limma', note: null, pairs: [], unpaired: [],
      delta: new Float64Array(n).fill(Number.NaN), se: new Float64Array(n).fill(Number.NaN), z: new Float64Array(n).fill(Number.NaN),
      p: new Float64Array(n).fill(Number.NaN), q: new Float64Array(n).fill(Number.NaN), ciLow: new Float64Array(n).fill(Number.NaN), ciHigh: new Float64Array(n).fill(Number.NaN),
      tau2: null, k: new Uint8Array(n), reason: new Uint8Array(n).fill(DIFFERENTIAL_REASON.NOT_COUNTED),
      df: m.dfTotal[0], prior: { s2: m.s2Prior, df: m.dfPrior },
      // The values as limma gives them (log₂), for checking against mutscan.
      log2: { logFC: m.estimate, se: m.se, t: m.t, p: m.p, q: m.q, ciLow: m.ciLow, ciHigh: m.ciHigh, dfTotal: m.dfTotal },
    };
    rows.forEach((i, g) => {
      out.reason[i] = 0;
      out.delta[i] = m.estimate[g] * LN2;
      out.se[i] = m.se[g] * LN2;
      out.z[i] = m.t[g];
      out.p[i] = m.p[g];
      out.q[i] = m.q[g];
      out.ciLow[i] = m.ciLow[g] * LN2;
      out.ciHigh[i] = m.ciHigh[g] * LN2;
    });
    return out;
  });
  return { contrasts: results, fit: { rows: G, samples, libSize: Array.from(libSize), span: v.span, reference: refRows.length } };
}
