// Comparisons within a workspace (wave 4, slice 1; requirements C1–C3): two sets of scores, each a
// run's condition (its combined scores) or one of its replicates, their variants matched and their
// agreement measured. A compatibility report comes first and says what the comparison can mean:
//
//   - the targets: the same sequence, or one UniProt entry at two offsets (matched on its
//     coordinates), or no common reference (blocked);
//   - the level: nucleotide variants read at the protein level when the other side is protein;
//   - the variants matched, and those scored on one side only (blocked below MIN_MATCHED);
//   - the readouts: what a higher score means on each side (opposite directions: the second side
//     compared negated), and the assays;
//   - the scales: two sides on one scale (the same model, normalization, time scale and
//     rescaling, or one run's own replicates and conditions) are compared by every statistic;
//     on different or unknown scales (published scores), by correlation only: Lin's concordance
//     and Bland–Altman measure agreement on one scale, so they are withheld, saying why;
//   - independence: replicates that share a sample, a replicate against the condition it is
//     combined into, one table scored twice, or published scores against the counts they came
//     from agree for reasons beyond the biology.
//
// Each item is ok, qualified (the statistics hold, read as the item says) or blocked (no
// statistics). Results in, plain objects out; the view (ui/mode-compare.js), remote control's
// `compare` and the validation share it.
//
// Other sources and scales (wave 4, slice 3): a side can also be a MaveDB score set kept beside the
// workspace without opening it (read as published: lib/scoreset.js), or a predictor's scores of
// substitutions (AlphaMissense, EVE, ESM1b: the tracks' annotations), compared by rank and by its
// classes. Two sets of scores can be put on one scale: each rescaled by its own anchors (nonsense
// median 0 and wild type 1, or synonymous median 0 and nonsense median −1, the rescalings a run
// offers), the anchors' uncertainty carried into the tests of disagreement; or stated to be on one
// scale by the person comparing them.

import { agreementOf, aucAgreement } from './agreement.js';
import { mean as mergeMean, proteinView } from './collapse.js';
import { replicateSamples } from './design.js';
import { REPLICATE_STATE, STAGE_BY_ID } from './filters.js';
import { adjustBH } from './distributions.js';
import { normalUpper, square } from './dmath.js';
import { MEDIAN_CHI2_1, median, quantile } from './stats.js';
import { targetProtein } from './target.js';
import { trackTarget } from './tracks.js';
import { readoutOf } from './readout.js';
import { unitOf } from './runs.js';
import { RESCALINGS } from './score.js';
import { NORMALIZATIONS } from './score-ratio.js';
import { KIND, KIND_NAMES } from './variants.js';

// Fewer variants in common than this are not compared.
export const MIN_MATCHED = 10;

// --- Sides ----------------------------------------------------------------------------------------

// What can be compared in a run, from its record (its scores need not be computed yet): its
// conditions (one, "All replicates", for a run of one) and its replicates.
// [{ spec: { run, condition } | { run, replicate }, label }].
export function sideOptions(run) {
  const conditions = run.output.conditions;
  const several = conditions.length > 1;
  const names = new Map((run.inputs.design.replicates ?? []).map((r) => [r.id, r.name ?? r.id]));
  const out = conditions.map((c, i) => ({ spec: { run: run.id, condition: i }, label: several ? `${run.name}: ${c.name}` : run.name }));
  for (const r of run.output.replicates) out.push({ spec: { run: run.id, replicate: r.id }, label: `${run.name}: ${names.get(r.id) ?? r.id}` });
  return out;
}

// A side's spec: { run, condition } or { run, replicate } (a run's), or { annotation } (a MaveDB
// score set or a predictor kept beside the workspace: wave 4, slice 3).
export const sameSpec = (a, b) => {
  if (a?.annotation || b?.annotation) return Boolean(a?.annotation) && a?.annotation === b?.annotation;
  return a?.run === b?.run && (a.replicate ?? null) === (b.replicate ?? null) && (a.replicate ? true : (a.condition ?? 0) === (b.condition ?? 0));
};
export const specKey = (s) => (!s ? '' : s.annotation ? `a:${s.annotation}` : `${s.run}|${s.replicate ? `r:${s.replicate}` : `c:${s.condition ?? 0}`}`);

// The annotations that can be compared (ws.annotations): MaveDB score sets and predictors.
export const COMPARABLE_PROVIDERS = { 'mavedb-scores': 'scoreset', alphamissense: 'predictor', predictor: 'predictor' };
export const comparableAnnotations = (ws) => (ws.annotations ?? []).filter((a) => COMPARABLE_PROVIDERS[a.provider]);
// A comparable annotation's side label: a score set's title and URN; a predictor's name.
export function annotationLabel(annotation) {
  const set = annotation.record?.scoreSet;
  return set ? `${set.title} (${set.urn})` : annotation.name;
}

// A side of a comparison: the run, its scores, and what the report reads (the design's target and
// readout, the scale, the samples, the table and where it came from). ws: for the run's table.
export function describeSide(ws, run, results, spec) {
  const design = run.inputs.design;
  const replicate = spec.replicate ? results.replicates.find((r) => r.id === spec.replicate) : null;
  if (spec.replicate && !replicate) throw new Error(`${run.name} has no replicate "${spec.replicate}".`);
  const conditionIndex = replicate ? Math.max(0, results.conditions.findIndex((c) => c.replicates.includes(replicate.id))) : spec.condition ?? 0;
  const condition = results.conditions[conditionIndex];
  if (!condition) throw new Error(`${run.name} has no condition ${spec.condition}.`);
  const options = sideOptions(run);
  const label = options.find((o) => sameSpec(o.spec, spec))?.label ?? run.name;
  const replicateIds = replicate ? [replicate.id] : condition.replicates;
  const byId = new Map((design.replicates ?? []).map((r) => [r.id, r]));
  const samples = new Set(replicateIds.flatMap((id) => (byId.get(id) ? replicateSamples(byId.get(id)).map((s) => s.sample) : [])));
  const source = ws?.sources?.find((s) => s.sha256 === run.inputs.source.sha256) ?? null;
  return {
    spec: replicate ? { run: run.id, replicate: replicate.id } : { run: run.id, condition: conditionIndex },
    label,
    source: 'run',
    run: { id: run.id, name: run.name, sha256: run.output.sha256, scoring: run.inputs.scoring ?? null },
    kind: replicate ? 'replicate' : 'condition',
    name: replicate ? replicate.name : condition.name,
    condition: conditionIndex,
    replicates: replicateIds,
    results,
    design,
    parameters: run.inputs.parameters,
    // The target with the identifiers the workspace's has gained since (a UniProt accession from a
    // check against UniProt), to match on its coordinates.
    target: trackTarget(design.targets?.[0] ?? null, ws?.targets ?? []),
    samples,
    table: run.inputs.source.sha256,
    urns: urnsOf(source?.origin, design),
  };
}

// The MaveDB records a side's table came from: its source's origin, or the URN its design names (a
// bundled example of a record's counts).
const urnsOf = (origin, design = null) => [...new Set([
  ...(origin?.database === 'MaveDB' ? origin.urns ?? (origin.urn ? [origin.urn] : []) : []),
  ...(design?.source?.mavedb ? [design.source.mavedb] : []),
])];

// A MaveDB score set kept beside the workspace (an annotation of provider mavedb-scores), as a side:
// its published scores read (lib/scoreset.js: { results, design, parameters }), compared as a run's
// condition is. Its table is the scores file as MaveDB sent it.
export function describeScoreSet(annotation, read) {
  const label = annotationLabel(annotation);
  const { results, design, parameters } = read;
  return {
    spec: { annotation: annotation.id },
    label,
    source: 'scoreset',
    annotation: { id: annotation.id, name: annotation.name, provider: annotation.provider, urn: annotation.record?.scoreSet?.urn ?? null, sha256: annotation.file?.sha256 ?? null },
    run: { id: annotation.id, name: label, sha256: annotation.file?.sha256 ?? null, scoring: null },
    kind: 'condition',
    name: results.conditions[0].name,
    condition: 0,
    replicates: [],
    results,
    design,
    parameters,
    target: design.targets?.[0] ?? null,
    samples: new Set(),
    table: annotation.file?.sha256 ?? annotation.id,
    urns: urnsOf(null, design),
  };
}

// What a higher score means for a predictor, by its table's layout (providers/predictors.js):
// AlphaMissense's pathogenicity and EVE's score rise as a substitution is more likely pathogenic
// (less of the function); ESM1b's log-likelihood ratio falls; another table's is not known.
export const PREDICTOR_DIRECTIONS = { alphamissense: 'higher-less', eve: 'higher-less', matrix: 'higher-more' };
// A predictor's classes: which is the damaging one and which the tolerated (AlphaMissense's likely
// pathogenic and likely benign; EVE's pathogenic and benign).
const DAMAGING = 'pathogenic';
const TOLERATED = 'benign';

// A predictor as a side (an annotation of provider alphamissense or predictor): its track read onto
// the other side's target (providers/index.js, annotationTracks, with the other side's map: its
// protein, offset and length), each substitution once. Its variants are the other side's protein
// changes, so the two are matched on the other side's target. notes: what placing it left out.
export function describePredictor(annotation, track, other, notes = []) {
  const seen = new Set();
  const entries = (track?.entries ?? []).filter((e) => Number.isFinite(e.value) && !seen.has(e.key) && seen.add(e.key));
  const n = entries.length;
  const kindOf = (e) => (e.alt === e.ref ? KIND.SYNONYMOUS : e.alt === '*' ? KIND.NONSENSE : KIND.MISSENSE);
  const keys = entries.map((e) => e.key);
  const condition = {
    id: 'predictor', name: annotationLabel(annotation), replicates: [],
    score: Float64Array.from(entries, (e) => e.value), se: new Float64Array(n).fill(Number.NaN),
    k: new Uint8Array(n).fill(1), reason: new Uint8Array(n), flags: new Uint8Array(n), rescale: null,
  };
  const results = {
    rows: n,
    variants: { n, key: keys, original: keys, kind: Uint8Array.from(entries, kindOf), position: Int32Array.from(entries, (e) => e.position) },
    replicates: [],
    conditions: [condition],
    controls: {},
  };
  const layout = track?.predictor?.layout ?? (annotation.provider === 'alphamissense' ? 'alphamissense' : null);
  const direction = PREDICTOR_DIRECTIONS[layout] ?? null;
  const label = annotationLabel(annotation);
  return {
    spec: { annotation: annotation.id },
    label,
    source: 'predictor',
    annotation: { id: annotation.id, name: annotation.name, provider: annotation.provider, sha256: annotation.file?.sha256 ?? null },
    run: { id: annotation.id, name: label, sha256: annotation.file?.sha256 ?? null, scoring: null },
    kind: 'condition',
    name: label,
    condition: 0,
    replicates: [],
    results,
    design: { targets: other.target ? [other.target] : [], variants: { level: 'protein' }, ...(direction ? { readout: { direction } } : {}) },
    parameters: { model: 'predictor' },
    target: other.target,
    samples: new Set(),
    table: annotation.file?.sha256 ?? annotation.id,
    urns: [],
    predictor: {
      layout,
      what: layout === 'alphamissense' ? 'pathogenicity' : track?.predictor?.column ?? 'score',
      classes: track?.classes ?? null,
      cls: entries.map((e) => e.cls ?? null),
      notes,
    },
  };
}

// A side's scores at a level ('protein' reads a nucleotide run at the protein level, merged as the
// map merges them): { view (the results read), keys, original, kind, position, score, se, usable,
// flags, reads }. reads: each variant's input reads (a condition's: the mean over its replicates
// that used it, as the map's input count; NaN without counts, as published scores have none).
function valuesOf(side, level) {
  const own = side.results;
  const view = level === 'protein' && own.variants.proKey ? proteinView(own) : own;
  const v = view.variants;
  const n = view.rows;
  const base = { view, keys: v.key, original: v.original, kind: v.kind, position: v.position, proPosition: v.proPosition ?? null };
  const readsOf = (reps) => Float64Array.from({ length: n }, (_, i) => {
    let sum = 0;
    let k = 0;
    for (const r of reps) {
      if (r.state[i] !== REPLICATE_STATE.USED || !r.first || !Number.isFinite(r.first[i])) continue;
      sum += r.first[i];
      k += 1;
    }
    return k ? sum / k : Number.NaN;
  });
  if (side.kind === 'condition') {
    const c = view.conditions[side.condition];
    const usable = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) usable[i] = !c.reason[i] && Number.isFinite(c.score[i]) ? 1 : 0;
    return { ...base, score: c.score, se: c.se, usable, flags: c.flags, reads: readsOf(view.replicates.filter((r) => c.replicates.includes(r.id))) };
  }
  const r = own.replicates.find((x) => x.id === side.spec.replicate);
  const used = (i) => r.state[i] === REPLICATE_STATE.USED && Number.isFinite(r.score[i]);
  const reads = readsOf(view.replicates.filter((x) => x.id === r.id));
  if (view === own) {
    const usable = Uint8Array.from({ length: n }, (_, i) => (used(i) ? 1 : 0));
    return { ...base, score: r.score, se: r.se, usable, flags: new Uint8Array(n), reads };
  }
  // A replicate of a nucleotide run at the protein level: its scores merged as the conditions' are.
  const score = new Float64Array(n).fill(Number.NaN);
  const se = new Float64Array(n).fill(Number.NaN);
  const usable = new Uint8Array(n);
  v.members.forEach((rows, j) => {
    const ok = Array.from(rows).filter(used);
    if (!ok.length) return;
    const merged = mergeMean(ok.map((i) => r.score[i]), ok.map((i) => r.se[i]));
    score[j] = merged.score;
    se[j] = merged.se;
    usable[j] = 1;
  });
  return { ...base, score, se, usable, flags: new Uint8Array(n), reads };
}

// --- Scales ---------------------------------------------------------------------------------------

// Where a normalization puts a score's zero, in a few words.
const REFERENCES = { wt: 'relative to the wild type', synonymous: 'relative to the synonymous median', complete: 'normalized by the variants counted in every sample', full: 'normalized by all reads' };

// What a side's scores are measured in: { key, words, known }. Two sides with one key are on one
// scale. Published scores' scale is the record's own, unknown to MaveScape (known: false).
export function scaleOf(side) {
  const p = side.parameters;
  const d = side.design;
  if (p.model === 'published') return { key: `published|${side.table}`, words: 'as published', known: false };
  if (p.rescale && p.rescale !== 'none') return { key: `rescaled|${p.rescale}`, words: `rescaled: ${RESCALINGS[p.rescale]?.label ?? p.rescale}`, known: true };
  const time = d.model === 'time-series';
  const perUnit = time && p.timeScale === 'unit';
  const unit = unitOf(d);
  const reference = ['ratio', 'wls', 'ols', 'dimsum'].includes(p.model) ? REFERENCES[p.normalization] ?? `normalized by the ${NORMALIZATIONS[p.normalization] ?? p.normalization}` : '';
  let family;
  let words;
  if (p.model === 'dimsum') {
    family = `dimsum|${p.dimsumNormalise ? 'scaled' : 'raw'}`;
    words = `DiMSum's fitness (natural log)${p.dimsumNormalise ? ', replicates scaled and shifted' : ''}`;
  } else if (p.model === 'bins' || p.model === 'bins-mle') {
    const values = (d.replicates?.[0]?.bins ?? []).map((b) => b.value).join(',');
    family = `${p.model}|${p.binScale ?? 'none'}|${values}`;
    words = `${p.model === 'bins' ? 'the bins\' weighted average' : 'mean log fluorescence (maximum likelihood)'}${p.binScale && p.binScale !== 'none' ? `, ${p.binScale === 'nonsense-wt' ? 'nonsense 0 and the wild type 1' : 'the lowest 5% 0 and the wild type 1'}` : ''}`;
  } else if (time && (p.model === 'wls' || p.model === 'ols' || p.model === 'ratio')) {
    family = `time|${perUnit ? `per-${unit}` : 'course'}`;
    words = perUnit ? `natural-log change per ${unit}` : 'natural-log change over the time course';
  } else {
    family = 'log-ratio';
    words = 'natural-log ratio after selection to before';
  }
  return { key: `${family}|${p.normalization ?? ''}`, words: reference ? `${words}, ${reference}` : words, known: true };
}

// How two sets of scores are put on one scale (wave 4, slice 3; requirement C3): as scored (one
// scale only when scaleOf says so); stated to be on one scale by the person comparing them (two
// score sets of one study and one pipeline, which their records do not say); or each rescaled by
// its own anchors, as a run's rescaling does (score.js, RESCALINGS), so that the anchors land on
// the same values in both.
export const SCALES = {
  scored: { label: 'as scored' },
  stated: { label: 'stated to be on one scale' },
  'nonsense-wt': { label: 'rescaled by their anchors: nonsense median 0, wild type 1', anchors: RESCALINGS['nonsense-wt'].anchors },
  'synonymous-nonsense': { label: 'rescaled by their anchors: synonymous median 0, nonsense median −1', anchors: RESCALINGS['synonymous-nonsense'].anchors },
};

// A side's anchors for a rescaling, from its own scored variants at the comparison's level (not
// only those compared: the anchors define its scale): the wild type's score, a class's median.
// Each with its uncertainty, as anchors.js gives a run's: the wild type's SE; a median's, about
// √(π/2 × the mean squared SE / n) of its members with an SE. Returns { anchors: [{ what, to,
// from, se, n }], slope, u: [u₀, u₁] (on the rescaled scale) } or { problem }.
export function anchorsOf(v, preset, label = 'A side') {
  const anchors = [];
  for (const [what, to] of preset) {
    if (what === 'wild type') {
      let i = -1;
      for (let k = 0; k < v.keys.length; k += 1) if (v.kind[k] === KIND.WT && v.usable[k]) { i = k; break; }
      if (i < 0) return { problem: `${label} has no wild type scored to anchor its scale.` };
      anchors.push({ what, to, from: v.score[i], se: Number.isFinite(v.se[i]) ? v.se[i] : Number.NaN, n: 1 });
      continue;
    }
    const kind = what === 'nonsense' ? KIND.NONSENSE : KIND.SYNONYMOUS;
    const scores = [];
    let ss = 0;
    let withSE = 0;
    for (let k = 0; k < v.keys.length; k += 1) {
      if (v.kind[k] !== kind || !v.usable[k]) continue;
      scores.push(v.score[k]);
      if (Number.isFinite(v.se[k])) {
        ss += square(v.se[k]);
        withSE += 1;
      }
    }
    if (!scores.length) return { problem: `${label} has no ${what} variants scored to anchor its scale.` };
    anchors.push({ what, to, from: median(scores), se: withSE >= 2 ? Math.sqrt(((Math.PI / 2) * ss) / withSE / withSE) : Number.NaN, n: scores.length });
  }
  const span = anchors[1].from - anchors[0].from;
  if (!(Math.abs(span) > 0)) return { problem: `${possessive(label)} anchors (${anchors[0].what} and ${anchors[1].what}) have the same score: it cannot be rescaled by them.` };
  const slope = (anchors[1].to - anchors[0].to) / span;
  return { anchors, slope, u: anchors.map((x) => x.se * Math.abs(slope)) };
}

// A side's scores as compared: x → shift + slope·x (identity; negated, for opposite directions;
// rescaled by its anchors). place(x′): where a compared score lies between the anchors (0 at the
// first, 1 at the second), for the anchors' share of its uncertainty.
const IDENTITY = { slope: 1, shift: 0, u: null, to: null };
const negated = { slope: -1, shift: 0, u: null, to: null };
function rescaled(r) {
  const [a0, a1] = r.anchors;
  return { slope: r.slope, shift: a0.to - a0.from * r.slope, u: r.u, to: [a0.to, a1.to] };
}
// The anchors' variance of a compared score: (1 − t)² u₀² + t² u₁², t its place between them
// (anchors.js); 0 without anchors, or with their uncertainty unknown.
function anchorVariance(t, x) {
  if (!t.u || !t.u.every(Number.isFinite)) return 0;
  const place = (x - t.to[0]) / (t.to[1] - t.to[0]);
  return square(1 - place) * square(t.u[0]) + square(place) * square(t.u[1]);
}

// --- Matching -------------------------------------------------------------------------------------

const SINGLE = /^p\.([A-Z][a-z]{2})(\d+)([A-Z][a-z]{2}|=)$/;
const accession = (t) => (t?.identifiers?.uniprot ?? '').toUpperCase().replace(/-1$/, '');

// A single substitution's key on the reference's coordinates (its position + the offset), or null.
function onReference(key, offset) {
  const m = SINGLE.exec(key ?? '');
  return m ? `p.${m[1]}${Number(m[2]) + offset}${m[3]}` : null;
}

// The level and coordinates two sides are matched on, or why they cannot be:
// { level, coordinates: 'target' | 'reference', offsets, problem, items }.
function matchingOf(a, b, forceProtein = false) {
  const ta = a.target;
  const tb = b.target;
  const nucleotide = (s) => s.design.variants?.level !== 'protein';
  const protein = (s) => !nucleotide(s) || Boolean(s.results.variants.proKey);
  const sameSequence = ta && tb && ta.sequence === tb.sequence && (ta.sequenceType ?? null) === (tb.sequenceType ?? null);
  const items = [];
  const len = (t) => `${t.sequence.length} ${t.sequenceType === 'dna' ? 'nt' : 'aa'}`;
  if (!ta || !tb) return { problem: 'A side has no target to match its variants on.' };
  let coordinates = 'target';
  let offsets = [0, 0];
  if (sameSequence) {
    items.push({ id: 'target', status: 'ok', label: 'Target', text: ta.name === tb.name ? `Both are of ${ta.name} (${len(ta)}).` : `${ta.name} and ${tb.name} are the same sequence (${len(ta)}).` });
  } else {
    const ua = accession(ta);
    if (ua && ua === accession(tb) && protein(a) && protein(b)) {
      coordinates = 'reference';
      offsets = [ta.offset ?? 0, tb.offset ?? 0];
      items.push({ id: 'target', status: 'qualified', label: 'Target', text: `${ta.name} and ${tb.name} are different sequences of UniProt ${ua}: their single substitutions are matched on its coordinates (${ta.name} from residue ${offsets[0] + 1}, ${tb.name} from ${offsets[1] + 1}); other variants are not matched.` });
    } else {
      return { problem: `${ta.name} and ${tb.name} are different sequences with no common reference: give each its UniProt accession and offset (Experiment, Target; or check it against UniProt) to compare them on its coordinates.` };
    }
  }
  let level;
  if (coordinates === 'target' && nucleotide(a) && nucleotide(b) && !(forceProtein && protein(a) && protein(b))) {
    level = 'nucleotide';
    items.push({ id: 'level', status: 'ok', label: 'Level', text: 'Nucleotide variants, matched as written.' });
  } else if (protein(a) && protein(b)) {
    level = 'protein';
    const read = [a, b].filter(nucleotide);
    items.push({ id: 'level', status: 'ok', label: 'Level', text: read.length ? `Protein variants: ${read.map((s) => s.label).join(' and ')} read at the protein level (nucleotide variants making one protein change merged, as on the map).` : 'Protein variants.' });
  } else {
    return { problem: `${[a, b].find((s) => !protein(s)).label} has nucleotide variants that are not read at the protein level (no coding sequence), and the other side has protein variants.` };
  }
  return { level, coordinates, offsets, items };
}

// The variants scored on both sides, in the first side's order (the wild type, the reference of
// both, left out): { rows: [[i, j]], keys, onlyA, onlyB, notScoredA, notScoredB }.
function matchVariants(va, vb, coordinates, offsets) {
  const keyOf = (vals, i, offset) => (coordinates === 'target' ? vals.keys[i] : onReference(vals.keys[i], offset));
  const inB = new Map();
  for (let j = 0; j < vb.keys.length; j += 1) {
    if (vb.kind[j] === KIND.WT) continue;
    const k = keyOf(vb, j, offsets[1]);
    if (k && !inB.has(k)) inB.set(k, j);
  }
  const rows = [];
  const keys = [];
  let onlyA = 0;
  let notScoredB = 0;
  const matchedB = new Set();
  for (let i = 0; i < va.keys.length; i += 1) {
    if (va.kind[i] === KIND.WT || !va.usable[i]) continue;
    const k = keyOf(va, i, offsets[0]);
    const j = k ? inB.get(k) : undefined;
    if (j === undefined) {
      onlyA += 1;
      continue;
    }
    if (!vb.usable[j]) {
      notScoredB += 1;
      continue;
    }
    rows.push([i, j]);
    keys.push(k);
    matchedB.add(j);
  }
  let onlyB = 0;
  let notScoredA = 0;
  const inA = new Map();
  for (let i = 0; i < va.keys.length; i += 1) {
    const k = keyOf(va, i, offsets[0]);
    if (k && va.kind[i] !== KIND.WT) inA.set(k, i);
  }
  for (const [k, j] of inB) {
    if (!vb.usable[j] || matchedB.has(j)) continue;
    const i = inA.get(k);
    if (i === undefined) onlyB += 1;
    else notScoredA += 1;
  }
  return { rows, keys, onlyA, onlyB, notScoredA, notScoredB };
}


// --- The report and the statistics ----------------------------------------------------------------

const fmtCount = (n) => n.toLocaleString('en-US');
// A label's possessive: "Published scores'", "Run 1's".
export const possessive = (label) => (/s$/.test(label) ? `${label}'` : `${label}'s`);
const fmt3 = (x) => (Number.isFinite(x) ? Number(x.toFixed(3)).toString() : '—');
const STATUS_RANK = { ok: 0, qualified: 1, blocked: 2 };

// The filters a comparison can apply to the variants scored on both sides (wave 4, slice 2): leave
// out a variant of low confidence on either side, one whose SE on either side is above maxSE, or one
// with fewer than minReads input reads on either side (a side with no SEs or no counts, as
// published scores may be, is not filtered on them).
export const NO_FILTERS = { lowConfidence: false, maxSE: null, minReads: null };
const filtersOf = (f) => ({ ...NO_FILTERS, ...(f ?? {}) });
export const filtersApplied = (f) => Boolean(f && (f.lowConfidence || Number.isFinite(f.maxSE) || Number.isFinite(f.minReads)));

// Discordant: q below this (Benjamini–Hochberg over the variants tested).
export const DISCORDANT_Q = 0.05;

// Compares side b with side a. options: { filters, scale (a key of SCALES: 'scored', the default;
// 'stated'; 'nonsense-wt' or 'synonymous-nonsense', each side rescaled by its own anchors), level:
// 'protein' (match at the protein level whenever both sides can be read there, as the maps need) }.
// Returns { a, b, level, coordinates, report: { status, items }, flipped, sameScale, scale: { mode,
// label, applied, anchors: { a, b }, slope: { a, b }, reason }, matched: { n, onlyA, onlyB,
// notScoredA, notScoredB, compared, filtered }, rows, keys, x, y, seX, seY, statistics, withheld,
// discordance, positions, classes, values, transforms }. rows, keys, x and y are the variants
// compared (after the filters); x and y their scores as compared (each rescaled by its anchors, or
// b's negated when the directions are opposite), seX and seY their SEs.
export function compareSides(a, b, options = {}) {
  const filters = filtersOf(options.filters);
  const mode = Object.hasOwn(SCALES, options.scale ?? '') ? options.scale : 'scored';
  const items = [];
  const blocked = (id, label, text) => {
    items.push({ id, status: 'blocked', label, text });
    return finish();
  };
  let level = null;
  let coordinates = null;
  let offsets = [0, 0];
  let flipped = false;
  let sameScale = false;
  let matched = null;
  let rows = [];
  let keys = [];
  let va = null;
  let vb = null;
  let scale = { mode, label: SCALES[mode].label, applied: false, anchors: null, slope: null, reason: null };
  let ta = IDENTITY;
  let tb = IDENTITY;
  // A predictor is compared with a measured side (a run's or a score set's), by rank and by class.
  const predictor = [a, b].find((s) => s.source === 'predictor') ?? null;
  const measured = predictor ? (predictor === a ? b : a) : null;
  const finish = () => {
    const statusOf = () => items.reduce((s, x) => (STATUS_RANK[x.status] > STATUS_RANK[s] ? x.status : s), 'ok');
    const out = { a: summary(a), b: summary(b), level, coordinates, offsets, flipped, sameScale, scale, filters, report: { status: statusOf(), items }, matched, rows: [], keys: [], x: null, y: null, seX: null, seY: null, statistics: null, withheld: [], discordance: null, positions: null, classes: null };
    if (out.report.status === 'blocked') return out;
    out.values = { a: va, b: vb };
    out.transforms = { a: ta, b: tb };
    out.matchedAll = rows;
    // The filters.
    const kept = [];
    const dropped = { lowConfidence: 0, se: 0, reads: 0 };
    rows.forEach(([i, j], k) => {
      if (filters.lowConfidence && (va.flags[i] || vb.flags[j])) dropped.lowConfidence += 1;
      else if (Number.isFinite(filters.maxSE) && (va.se[i] > filters.maxSE || vb.se[j] > filters.maxSE)) dropped.se += 1;
      else if (Number.isFinite(filters.minReads) && (va.reads[i] < filters.minReads || vb.reads[j] < filters.minReads)) dropped.reads += 1;
      else kept.push(k);
    });
    matched.compared = kept.length;
    matched.filtered = dropped;
    if (filtersApplied(filters)) {
      const parts = [
        dropped.lowConfidence ? `${fmtCount(dropped.lowConfidence)} of low confidence on either side` : '',
        dropped.se ? `${fmtCount(dropped.se)} with an SE above ${filters.maxSE} on either side` : '',
        dropped.reads ? `${fmtCount(dropped.reads)} with fewer than ${filters.minReads} input reads on either side` : '',
      ].filter(Boolean);
      const unfiltered = [
        Number.isFinite(filters.maxSE) ? [a, b].filter((s, w) => ![va, vb][w].se.some((x) => Number.isFinite(x))).map((s) => `${s.label} gives no SEs`) : [],
        Number.isFinite(filters.minReads) ? [a, b].filter((s, w) => ![va, vb][w].reads.some((x) => Number.isFinite(x))).map((s) => `${s.label} has no counts`) : [],
      ].flat();
      const text = `${parts.length ? `Left out: ${parts.join('; ')}.` : 'The filters leave out none of them.'} ${fmtCount(kept.length)} compared.${unfiltered.length ? ` ${unfiltered.join('; ')}: the filter applies to the other side only.` : ''}`;
      if (kept.length < MIN_MATCHED) {
        items.push({ id: 'filters', status: 'blocked', label: 'Filters', text: `${text} Too few to compare (${MIN_MATCHED} at least).` });
        out.report.status = statusOf();
        return out;
      }
      items.push({ id: 'filters', status: 'ok', label: 'Filters', text });
    }
    out.rows = kept.map((k) => rows[k]);
    out.keys = kept.map((k) => keys[k]);
    out.x = Float64Array.from(out.rows, ([i]) => ta.shift + ta.slope * va.score[i]);
    out.y = Float64Array.from(out.rows, ([, j]) => tb.shift + tb.slope * vb.score[j]);
    out.seX = Float64Array.from(out.rows, ([i]) => va.se[i] * Math.abs(ta.slope));
    out.seY = Float64Array.from(out.rows, ([, j]) => vb.se[j] * Math.abs(tb.slope));
    const stats = agreementOf(out.x, out.y);
    if (predictor) {
      out.withheld = ['pearson', 'concordance', 'blandAltman'];
      stats.pearson = null;
      stats.concordance = null;
      stats.blandAltman = null;
    } else if (!sameScale) {
      out.withheld = ['concordance', 'blandAltman'];
      stats.concordance = null;
      stats.blandAltman = null;
    }
    out.statistics = stats;
    out.discordance = discordanceOf(out, items, predictor);
    if (!out.discordance.valid) out.withheld.push('discordance');
    out.positions = positionsOf(out, a);
    if (!out.positions.valid) out.withheld.push('positions');
    if (predictor) out.classes = classesOf(out, predictor === a ? 'a' : 'b', predictor, measured);
    out.report.status = statusOf();
    return out;
  };

  if (sameSpec(a.spec, b.spec)) return blocked('sides', 'Sides', `${a.label} is compared with itself.`);
  if (a.source === 'predictor' && b.source === 'predictor') return blocked('sides', 'Sides', `${a.label} and ${b.label} are both predictions: compare a predictor with a run's scores or a score set's.`);
  const m = matchingOf(a, b, options.level === 'protein');
  if (m.problem) return blocked('target', 'Target', m.problem);
  ({ level, coordinates, offsets } = m);
  if (predictor) {
    // The predictor was placed on the measured side's target (its UniProt numbering, else its own).
    const t = measured.target;
    const notes = predictor.predictor.notes ?? [];
    items.push({ id: 'target', status: 'ok', label: 'Target', text: `${possessive(predictor.label)} substitutions placed on ${t.name}${t.identifiers?.uniprot ? ` by UniProt ${t.identifiers.uniprot}'s numbering${t.offset ? ` (the target from residue ${t.offset + 1})` : ''}` : ''}.${notes.length ? ` ${notes.join(' ')}` : ''}` });
    items.push(...m.items.filter((i) => i.id !== 'target'));
  } else {
    items.push(...m.items);
  }

  // The variants matched.
  va = valuesOf(a, level);
  vb = valuesOf(b, level);
  const found = matchVariants(va, vb, coordinates, m.offsets);
  rows = found.rows;
  keys = found.keys;
  matched = { n: rows.length, onlyA: found.onlyA, onlyB: found.onlyB, notScoredA: found.notScoredA, notScoredB: found.notScoredB };
  // Scored on one side only: absent from the other's variants, or there but not scored.
  const oneSide = (side, other, absent, unscored) => {
    const total = absent + unscored;
    if (!total) return '';
    const why = absent && unscored ? ` (${fmtCount(absent)} not among ${possessive(other.label)} variants, ${fmtCount(unscored)} not scored there)` : absent ? ` (not among ${possessive(other.label)} variants)` : ' (not scored on the other side)';
    return `${fmtCount(total)} scored in ${side.label} only${why}`;
  };
  const unmatched = [oneSide(a, b, found.onlyA, found.notScoredB), oneSide(b, a, found.onlyB, found.notScoredA)].filter(Boolean);
  if (rows.length < MIN_MATCHED) return blocked('variants', 'Variants', `${fmtCount(rows.length)} variant${rows.length === 1 ? ' is' : 's are'} scored on both sides: too few to compare (${MIN_MATCHED} at least).${unmatched.length ? ` ${unmatched.join('; ')}.` : ''}`);
  items.push({ id: 'variants', status: 'ok', label: 'Variants', text: `${fmtCount(rows.length)} scored on both sides${unmatched.length ? `; ${unmatched.join('; ')}` : ''}. The wild type, the reference of both, is left out.` });

  // Rescaling by the anchors (wave 4, slice 3): each side's from its own scores; not a prediction's.
  const preset = SCALES[mode].anchors ?? null;
  let rescaling = null;
  if (preset && !predictor) {
    const anchoredA = anchorsOf(va, preset, a.label);
    const anchoredB = anchorsOf(vb, preset, b.label);
    if (anchoredA.problem || anchoredB.problem) scale = { ...scale, reason: [anchoredA.problem, anchoredB.problem].filter(Boolean).join(' ') };
    else rescaling = { a: anchoredA, b: anchoredB };
  }

  // The readouts.
  const ra = readoutOf(a.design);
  const rb = readoutOf(b.design);
  const means = (s, r) => (s.source === 'predictor'
    ? (!r.stated ? 'what it does not say (taken as more of the function)' : r.direction === 'higher-less' ? 'more likely pathogenic (less of the function)' : 'more likely tolerated (more of the function)')
    : `${r.direction === 'higher-more' ? 'more' : 'less'} of the function${r.stated ? '' : ' (not stated: taken so)'}`);
  const unsigned = [a, b].filter((s) => readoutOf(s.design).direction === 'unsigned');
  if (unsigned.length === 1) {
    items.push({ id: 'direction', status: 'qualified', label: 'Direction', text: `${possessive(unsigned[0].label)} scores have no sign (a larger change either way) and the other's do: a correlation between them mixes losses and gains.` });
  } else if (ra.direction !== rb.direction) {
    if (rescaling) {
      items.push({ id: 'direction', status: 'ok', label: 'Direction', text: `A higher score means ${means(a, ra)} in ${a.label} and ${means(b, rb)} in ${b.label}; rescaled by their anchors, both read as their anchors do, so neither is negated.` });
    } else {
      flipped = true;
      tb = negated;
      items.push({ id: 'direction', status: 'qualified', label: 'Direction', text: `A higher score means ${means(a, ra)} in ${a.label} and ${means(b, rb)} in ${b.label}: ${b.label} is compared negated, so that agreement reads as agreement.` });
    }
  } else if (!ra.stated || !rb.stated) {
    const unstated = [a, b].filter((s) => !readoutOf(s.design).stated).map((s) => s.label);
    if (a.run.id === b.run.id) items.push({ id: 'direction', status: 'ok', label: 'Direction', text: 'One run: the same direction on both sides (not stated in its design).' });
    else if (predictor && unstated.includes(predictor.label)) items.push({ id: 'direction', status: 'qualified', label: 'Direction', text: `What a higher score of ${predictor.label} means is not known (its table is not AlphaMissense's, EVE's or ESM1b's): taken as more of the function, so a predictor of pathogenicity correlates negatively.` });
    else items.push({ id: 'direction', status: 'qualified', label: 'Direction', text: `What a higher score means is not stated for ${unstated.join(' and ')}: taken as more of the function measured on both sides. State it ${[a, b].some((s) => s.source === 'scoreset' && unstated.includes(s.label)) ? '(Experiment for a run; when adding a score set, for the score set)' : 'in Experiment (the readout)'} if it is not.` });
  } else {
    items.push({ id: 'direction', status: 'ok', label: 'Direction', text: `On both sides ${ra.direction === 'higher-more' ? 'a higher score means more of the function measured' : ra.direction === 'higher-less' ? 'a higher score means less of the function measured' : 'the scores have no sign'}.` });
  }
  const assay = (r) => [r.phenotype, r.method].filter(Boolean).join('; ');
  if (!predictor && a.run.id !== b.run.id && assay(ra) && assay(rb) && assay(ra) !== assay(rb)) {
    items.push({ id: 'assay', status: 'qualified', label: 'Assays', text: `Two assays (${assay(ra)}; ${assay(rb)}): they can disagree for reasons of biology, not only of measurement.` });
  }

  // The scales.
  const sa = scaleOf(a);
  const sb = scaleOf(b);
  if (predictor) {
    sameScale = false;
    items.push({ id: 'scale', status: 'qualified', label: 'Scale', text: `${predictor.label} is a prediction (its ${predictor.predictor.what}), not a measurement on ${possessive(measured.label)} scale: compared by rank (Spearman's ρ) and by its classes. Pearson's r, Lin's concordance, Bland–Altman and the tests of disagreement are withheld.${mode !== 'scored' ? ' A rescaling or a stated scale puts two measurements on one scale, not a prediction.' : ''}` });
  } else if (rescaling) {
    sameScale = true;
    flipped = false;
    ta = rescaled(rescaling.a);
    tb = rescaled(rescaling.b);
    scale = { ...scale, applied: true, anchors: { a: rescaling.a.anchors, b: rescaling.b.anchors }, slope: { a: rescaling.a.slope, b: rescaling.b.slope } };
    const words = (s, r) => `${possessive(s.label)} ${r.anchors.map((x) => (x.what === 'wild type' ? `wild type ${fmt3(x.from)}` : `${x.what} median ${fmt3(x.from)} (${fmtCount(x.n)} variant${x.n === 1 ? '' : 's'})`)).join(' and ')}`;
    const unknown = [rescaling.a, rescaling.b].some((r) => !r.u.every(Number.isFinite));
    items.push({ id: 'scale', status: 'qualified', label: 'Scale', text: `Rescaled onto one scale by their anchors (${SCALES[mode].label.replace(/^rescaled by their anchors: /, '')}), each from its own scores: ${words(a, rescaling.a)}; ${words(b, rescaling.b)}. Rescaling assumes the anchors mean the same in both: a nonsense variant the complete loss of what each measures, ${mode === 'nonsense-wt' ? 'the wild type' : 'a synonymous variant'} all of it.${unknown ? ' The anchors\' uncertainty is not known (no SEs) and is left out.' : ' Their uncertainty is carried into the tests of disagreement.'}` });
  } else if (mode === 'stated' && !flipped) {
    sameScale = true;
    scale = { ...scale, applied: true };
    const known = sa.known && sb.known && sa.key === sb.key;
    items.push({ id: 'scale', status: known || a.run.id === b.run.id ? 'ok' : 'qualified', label: 'Scale', text: known || a.run.id === b.run.id ? `One scale: ${sa.words} (and stated so).` : `Stated to be on one scale (MaveScape does not check it: ${a.label} ${sa.known ? `is ${sa.words}` : 'is as published'}, ${b.label} ${sb.known ? `${sb.words}` : 'as published'}): compared by every statistic, as for two measurements on one scale.` });
  } else {
    sameScale = a.run.id === b.run.id || (sa.known && sb.known && sa.key === sb.key);
    if (flipped) sameScale = false;
    if (sameScale) {
      items.push({ id: 'scale', status: 'ok', label: 'Scale', text: a.run.id === b.run.id ? `One run, one scale: ${sa.words}.` : `One scale: ${sa.words}.` });
    } else {
      const what = !sa.known || !sb.known
        ? `${[a, b].filter((s) => !scaleOf(s).known).map((s) => s.label).join(' and ')} ${[sa, sb].filter((s) => !s.known).length > 1 ? 'are' : 'is'} on ${[sa, sb].filter((s) => !s.known).length > 1 ? 'their records\' own scales' : 'its record\'s own scale'}, which MaveScape does not know${sa.known ? ` (${a.label}: ${sa.words})` : sb.known ? ` (${b.label}: ${sb.words})` : ''}`
        : flipped ? 'Opposite directions' : `Different scales (${a.label}: ${sa.words}; ${b.label}: ${sb.words})`;
      const why = scale.reason ? ` Not rescaled: ${scale.reason}` : mode === 'stated' ? ' Not put on one scale as stated: their directions are opposite.' : '';
      items.push({ id: 'scale', status: 'qualified', label: 'Scale', text: `${what}. The correlations compare their order and their linear relation; Lin's concordance and Bland–Altman, which measure agreement on one scale, are withheld.${why}` });
    }
  }

  // Independence.
  const shared = [...a.samples].filter((s) => b.samples.has(s));
  if (predictor) {
    items.push({ id: 'independence', status: 'ok', label: 'Independence', text: `${predictor.label} predicts from sequence (and structure), not from these measurements: its errors are independent of theirs, unless it was trained on these data.` });
  } else if (a.run.id === b.run.id) {
    const within = a.kind !== b.kind && (a.kind === 'replicate' ? b.replicates.includes(a.spec.replicate) : a.replicates.includes(b.spec.replicate));
    if (within) items.push({ id: 'independence', status: 'qualified', label: 'Independence', text: `${a.kind === 'replicate' ? a.label : b.label} is one of the replicates combined into ${a.kind === 'replicate' ? b.label : a.label}: they agree in part because one contains the other.` });
    else if (shared.length) items.push({ id: 'independence', status: 'qualified', label: 'Independence', text: `They share ${shared.length === 1 ? 'the sample' : 'the samples'} ${shared.join(', ')}: its counting error is in both, so they agree more than independent measurements would.` });
    else items.push({ id: 'independence', status: 'ok', label: 'Independence', text: 'No sample in common.' });
  } else if (a.table === b.table) {
    items.push({ id: 'independence', status: 'qualified', label: 'Independence', text: 'One table scored twice: the agreement measures the difference between the two analyses, not the experiment\'s reproducibility.' });
  } else if (a.urns.some((u) => b.urns.includes(u))) {
    items.push({ id: 'independence', status: 'qualified', label: 'Independence', text: `Both come from ${a.urns.filter((u) => b.urns.includes(u)).join(' and ')}: one experiment analysed twice (its published scores and its counts), so the agreement measures the analyses, not the experiment's reproducibility.` });
  } else {
    items.push({ id: 'independence', status: 'ok', label: 'Independence', text: 'Different tables.' });
  }
  return finish();
}

const summary = (s) => ({
  label: s.label, source: s.source ?? 'run', run: s.run, kind: s.kind, name: s.name, condition: s.condition,
  ...(s.kind === 'replicate' ? { replicate: s.spec.replicate } : {}),
  ...(s.annotation ? { annotation: s.annotation } : {}),
});

// --- Disagreement (wave 4, slice 2) ---------------------------------------------------------------

// The variants that disagree beyond their uncertainty: each difference's z = (x − y)/√(SE_a² + SE_b²),
// its two-sided normal p, and q by Benjamini–Hochberg over the variants with both SEs; discordant
// where q < DISCORDANT_Q. Valid only on one scale and for independent sides: the SE of a difference
// from both SEs assumes their errors independent (a shared sample's cancels from the difference;
// one table scored twice has one error). Two sides rescaled by their anchors (wave 4, slice 3) add
// each anchor's share of the score's uncertainty (anchorVariance). dispersion: median(z²)/median(χ²₁),
// about 1 when the SEs describe how far the two differ, above 1 when they differ more than their SEs
// say.
function discordanceOf(c, items, predictor = null) {
  const n = c.rows.length;
  const empty = { valid: false, reason: '', z: null, p: null, q: null, tested: 0, discordant: 0, dispersion: Number.NaN };
  const independence = items.find((i) => i.id === 'independence');
  if (predictor) return { ...empty, reason: `${predictor.label} is a prediction: compared by rank and by its classes, not by differences.` };
  if (!c.sameScale) return { ...empty, reason: 'Not on one scale: a difference between the two has no meaning until they are.' };
  if (independence?.status !== 'ok') return { ...empty, reason: `Not independent (${independence?.text ?? 'see the report'}): the SE of a difference from both SEs assumes independent errors.` };
  const z = new Float64Array(n).fill(Number.NaN);
  const p = new Float64Array(n).fill(Number.NaN);
  const z2 = [];
  for (let k = 0; k < n; k += 1) {
    const se = Math.sqrt(c.seX[k] * c.seX[k] + c.seY[k] * c.seY[k] + anchorVariance(c.transforms.a, c.x[k]) + anchorVariance(c.transforms.b, c.y[k]));
    if (!(se > 0)) continue;
    z[k] = (c.x[k] - c.y[k]) / se;
    p[k] = 2 * normalUpper(Math.abs(z[k]));
    z2.push(z[k] * z[k]);
  }
  if (!z2.length) return { ...empty, reason: 'No variant has an SE on both sides.' };
  const q = adjustBH(p);
  let discordant = 0;
  for (let k = 0; k < n; k += 1) if (q[k] < DISCORDANT_Q) discordant += 1;
  return { valid: true, reason: '', z, p, q, tested: z2.length, discordant, dispersion: median(z2) / MEDIAN_CHI2_1 };
}

// A position's own test needs this many variants compared there: with fewer, its z would be one
// variant's.
export const MIN_POSITION_VARIANTS = 3;

// The anchors' variance of a sum of compared scores of one side: the anchors' errors are shared,
// so the sum's is (Σ(1 − t))² u₀² + (Σt)² u₁² (t each score's place between the anchors).
function anchorSumVariance(t, values) {
  if (!t.u || !t.u.every(Number.isFinite)) return 0;
  let s0 = 0;
  let s1 = 0;
  for (const x of values) {
    const place = (x - t.to[0]) / (t.to[1] - t.to[0]);
    s0 += 1 - place;
    s1 += place;
  }
  return square(s0) * square(t.u[0]) + square(s1) * square(t.u[1]);
}

// Disagreement by position: the variants compared at each position of the first side's target (a
// nucleotide run's, by the protein position each changes), their mean difference and its root mean
// square, those discordant, and the position's z = Σ(x − y)/√Σ(SE_a² + SE_b²) (at least
// MIN_POSITION_VARIANTS compared; with the anchors' shared variance when rescaled), with p and q
// over the positions tested. Valid on one scale; z, p and q where discordance is.
function positionsOf(c, a) {
  if (!c.sameScale) return { valid: false, reason: 'Not on one scale.', list: [] };
  const { a: va } = c.values;
  const where = c.level === 'protein' ? va.position : va.proPosition;
  if (!where) return { valid: false, reason: 'Nucleotide variants with no protein position.', list: [] };
  const protein = a.target ? targetProtein(a.target) : '';
  const offset = c.coordinates === 'reference' ? c.offsets[0] : (a.target?.offset ?? 0);
  const byPosition = new Map();
  c.rows.forEach(([i], k) => {
    const pos = where[i];
    if (!(pos >= 1)) return;
    if (!byPosition.has(pos)) byPosition.set(pos, []);
    byPosition.get(pos).push(k);
  });
  const d = c.discordance;
  const list = [...byPosition.keys()].sort((x, y) => x - y).map((pos) => {
    const members = byPosition.get(pos);
    let sum = 0;
    let squares = 0;
    let variance = 0;
    let discordant = 0;
    for (const k of members) {
      const diff = c.x[k] - c.y[k];
      sum += diff;
      squares += diff * diff;
      variance += c.seX[k] * c.seX[k] + c.seY[k] * c.seY[k];
      if (d.valid && d.q[k] < DISCORDANT_Q) discordant += 1;
    }
    variance += anchorSumVariance(c.transforms.a, members.map((k) => c.x[k])) + anchorSumVariance(c.transforms.b, members.map((k) => c.y[k]));
    const z = d.valid && variance > 0 && members.length >= MIN_POSITION_VARIANTS ? sum / Math.sqrt(variance) : Number.NaN;
    return { position: pos, reference: pos + offset, residue: protein[pos - 1] ?? '', n: members.length, mean: sum / members.length, rms: Math.sqrt(squares / members.length), discordant, z, p: Number.isFinite(z) ? 2 * normalUpper(Math.abs(z)) : Number.NaN };
  });
  const q = adjustBH(Float64Array.from(list, (x) => x.p));
  list.forEach((x, k) => { x.q = q[k]; });
  return { valid: true, reason: '', list };
}

// --- A predictor by its classes (wave 4, slice 3) -------------------------------------------------

// The measured side's scores, as scored, of the variants compared in each of the predictor's classes
// (how many, their median and quartiles, R's type 7), and how well those scores tell the predictor's
// tolerated class from its damaging one: the AUC, the chance that a tolerated substitution has more
// of the function than a damaging one (the measured side's direction; not stated: higher, more),
// with DeLong's 95% interval. The measured side's synonymous and nonsense medians, of every variant
// it scores, are the references.
function classesOf(c, which, predictor, measured) {
  const p = predictor.predictor;
  if (!p.classes?.length) return { valid: false, reason: `${predictor.label} gives no classes.`, list: [] };
  const vm = which === 'a' ? c.values.b : c.values.a;
  const own = (r) => (which === 'a' ? r[0] : r[1]);
  const other = (r) => (which === 'a' ? r[1] : r[0]);
  const direction = readoutOf(measured.design);
  const sign = direction.direction === 'higher-less' ? -1 : 1;
  const byClass = new Map(p.classes.map((k) => [k.id, []]));
  for (const r of c.rows) {
    const cls = p.cls[own(r)];
    if (byClass.has(cls)) byClass.get(cls).push(vm.score[other(r)]);
  }
  const list = p.classes.map((k) => {
    const xs = byClass.get(k.id);
    return { id: k.id, label: k.label, n: xs.length, median: quantile(xs, 0.5), low: quantile(xs, 0.25), high: quantile(xs, 0.75) };
  });
  const tolerated = (byClass.get(TOLERATED) ?? []).map((x) => sign * x);
  const damaging = (byClass.get(DAMAGING) ?? []).map((x) => sign * x);
  const reference = (kind) => {
    const xs = [];
    for (let i = 0; i < vm.keys.length; i += 1) if (vm.kind[i] === kind && vm.usable[i]) xs.push(vm.score[i]);
    return { n: xs.length, median: xs.length ? median(xs) : Number.NaN };
  };
  return {
    valid: true,
    reason: '',
    predictor: predictor.label,
    measured: measured.label,
    list,
    auc: { ...aucAgreement(tolerated, damaging), tolerated: TOLERATED, damaging: DAMAGING, measuredNegated: sign < 0, directionStated: direction.stated },
    references: { synonymous: reference(KIND.SYNONYMOUS), nonsense: reference(KIND.NONSENSE) },
  };
}

// --- Maps (wave 4, slice 2) -----------------------------------------------------------------------

const MEASURED = STAGE_BY_ID.get('measured').code;

// A side as the map reads it: { results, design, condition } for buildMapModel (map-model.js), its
// condition the side's scores (a replicate's as a condition of its own), at the protein level.
// null when the side cannot be drawn (nucleotide variants of a target with no coding sequence; a
// predictor, which is a track beside the map).
export function sideMap(side) {
  if (side.source === 'predictor') return null;
  if (side.design.variants?.level !== 'protein' && !side.results.variants.proKey) return null;
  const v = valuesOf(side, 'protein');
  if (side.kind === 'condition') return { results: v.view, design: side.design, condition: side.condition };
  const n = v.keys.length;
  const r = side.results.replicates.find((x) => x.id === side.spec.replicate);
  const condition = {
    id: r.id, name: r.name ?? r.id, replicates: [r.id], score: v.score, se: v.se, k: v.usable,
    reason: Uint8Array.from(v.usable, (u) => (u ? 0 : MEASURED)), flags: new Uint8Array(n), rescale: null,
  };
  return { results: { ...v.view, conditions: [condition] }, design: side.design, condition: 0 };
}

// The difference of a comparison as the map reads a contrast (the first side − the second, as
// compared, on the first side's target): { results, design, contrast: 0 } for buildMapModel with
// colorBy 'differential'. Compared variants have their difference, SE (where both have one) and q;
// a variant scored on the first side only, or left out by the filters, has none (drawn filtered);
// one the first side did not score is missing. c: a comparison at the protein level.
export function differenceMap(c, a) {
  if (!c.statistics || c.level !== 'protein' || !c.sameScale) return null;
  const { a: va, b: vb } = c.values;
  const view = va.view;
  const n = view.rows;
  const nan = () => new Float64Array(n).fill(Number.NaN);
  const delta = nan();
  const se = nan();
  const q = nan();
  const z = nan();
  const p = nan();
  const reason = new Uint8Array(n).fill(1);
  const reasonA = Uint8Array.from(va.usable, (u) => (u ? 0 : MEASURED));
  const reasonB = new Uint8Array(n).fill(MEASURED);
  const flagsB = new Uint8Array(n);
  for (const [i, j] of matchedPairs(c)) {
    reasonB[i] = vb.usable[j] ? 0 : MEASURED;
    flagsB[i] = vb.flags[j];
  }
  c.rows.forEach(([i], k) => {
    delta[i] = c.x[k] - c.y[k];
    se[i] = Math.sqrt(c.seX[k] * c.seX[k] + c.seY[k] * c.seY[k] + anchorVariance(c.transforms.a, c.x[k]) + anchorVariance(c.transforms.b, c.y[k]));
    reason[i] = 0;
    if (c.discordance?.valid) {
      z[i] = c.discordance.z[k];
      p[i] = c.discordance.p[k];
      q[i] = c.discordance.q[k];
    }
  });
  const first = { id: 'first', name: c.a.label, replicates: [], score: va.score, se: va.se, k: va.usable, reason: reasonA, flags: va.flags };
  const second = { id: 'second', name: c.b.label, replicates: [], score: nan(), se: nan(), k: new Uint8Array(n), reason: reasonB, flags: flagsB };
  const contrast = { id: 'comparison', name: `${c.a.label} vs ${c.b.label}`, reference: 'second', condition: 'first', method: 'comparison', delta, se, z, p, q, reason, k: new Uint8Array(n).fill(1), pairs: [], unpaired: [] };
  return { results: { ...view, controls: { ...view.controls, wt: -1 }, replicates: [], conditions: [second, first], differential: [contrast] }, design: a.design, contrast: 0 };
}

// Every variant matched (before the filters), as [first row, second row], kept for the maps.
function matchedPairs(c) {
  return c.matchedAll ?? c.rows;
}

// --- Exports --------------------------------------------------------------------------------------

const num = (x) => (Number.isFinite(x) ? String(x) : 'NA');
const cell = (s) => (/[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s);

// The variants compared (comparison.csv): the variant (on the reference's coordinates when matched
// there), as each side names it, its class, each side's score and SE as scored, each score as
// compared (rescaled by its anchors, or the second negated when the directions are opposite), the
// difference and mean as compared, and the difference's z, p and q where the two are independent
// and on one scale (NA otherwise).
export function comparisonCSV(c) {
  const lines = ['variant,variant_a,variant_b,class,score_a,SE_a,score_b,SE_b,compared_a,compared_b,difference,mean,z,p,q'];
  if (!c.statistics) return `${lines[0]}\n`;
  const { a: va, b: vb } = c.values;
  const d = c.discordance?.valid ? c.discordance : null;
  c.rows.forEach(([i, j], k) => {
    const x = c.x[k];
    const y = c.y[k];
    lines.push([cell(c.keys[k]), cell(va.keys[i]), cell(vb.keys[j]), KIND_NAMES[va.kind[i]], num(va.score[i]), num(va.se[i]), num(vb.score[j]), num(vb.se[j]), num(x), num(y), num(x - y), num((x + y) / 2), num(d?.z[k]), num(d?.p[k]), num(d?.q[k])].join(','));
  });
  return `${lines.join('\n')}\n`;
}

// Disagreement by position (comparison_positions.csv): each position of the first side's target with
// variants compared, its reference position (with the offset), residue, the variants compared, their
// mean and root-mean-square difference, those discordant, and the position's z, p and q.
export function positionsCSV(c) {
  const lines = ['position,reference_position,residue,variants,mean_difference,rms_difference,discordant,z,p,q'];
  for (const x of c.positions?.list ?? []) lines.push([x.position, x.reference, x.residue, x.n, num(x.mean), num(x.rms), x.discordant, num(x.z), num(x.p), num(x.q)].join(','));
  return `${lines.join('\n')}\n`;
}

// A predictor by its classes (comparison_classes.csv): each class, the variants compared in it, and
// the measured side's median and quartiles of their scores, as scored.
export function classesCSV(c) {
  const lines = ['class,variants,median,lower_quartile,upper_quartile'];
  for (const x of c.classes?.list ?? []) lines.push([cell(x.label), x.n, num(x.median), num(x.low), num(x.high)].join(','));
  return `${lines.join('\n')}\n`;
}

// The comparison's record (comparison.json): the two sides (a run's id and output hash; a score
// set's or predictor's annotation, URN and file hash), how they were matched, scaled and filtered,
// the report, the counts and the statistics, the discordant variants, the disagreement by position
// and a predictor's classes, with what was withheld.
export function comparisonJSON(c, software = null) {
  const side = (s) => (s.annotation
    ? { label: s.label, source: s.source, annotation: s.annotation.id, name: s.annotation.name, ...(s.annotation.urn ? { urn: s.annotation.urn } : {}), file: s.annotation.sha256 }
    : { label: s.label, source: 'run', run: s.run.id, runName: s.run.name, output: s.run.sha256, ...(s.kind === 'replicate' ? { replicate: s.replicate } : { condition: s.name }) });
  const clean = (o) => JSON.parse(JSON.stringify(o, (k, v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v)));
  const d = c.discordance;
  const discordant = d?.valid ? c.rows.map((_, k) => k).filter((k) => d.q[k] < DISCORDANT_Q).sort((x, y) => d.q[x] - d.q[y] || Math.abs(d.z[y]) - Math.abs(d.z[x])).map((k) => ({ variant: c.keys[k], difference: c.x[k] - c.y[k], z: d.z[k], q: d.q[k] })) : [];
  return `${JSON.stringify(clean({
    format: 'mavescape-comparison',
    version: 1,
    ...(software ? { software } : {}),
    a: side(c.a),
    b: side(c.b),
    level: c.level,
    coordinates: c.coordinates,
    bNegated: c.flipped,
    sameScale: c.sameScale,
    scale: c.scale ? { mode: c.scale.mode, applied: c.scale.applied, anchors: c.scale.anchors, slope: c.scale.slope, reason: c.scale.reason } : null,
    filters: c.filters,
    report: c.report,
    matched: c.matched,
    statistics: c.statistics,
    discordance: d ? { valid: d.valid, reason: d.reason || null, tested: d.tested, discordant: d.discordant, dispersion: d.dispersion, q: DISCORDANT_Q, variants: discordant } : null,
    positions: c.positions ? { valid: c.positions.valid, reason: c.positions.reason || null, list: c.positions.list } : null,
    classes: c.classes ? { valid: c.classes.valid, reason: c.classes.reason || null, predictor: c.classes.predictor ?? null, measured: c.classes.measured ?? null, list: c.classes.list, auc: c.classes.auc ?? null, references: c.classes.references ?? null } : null,
    withheld: c.withheld,
  }), null, 2)}\n`;
}
