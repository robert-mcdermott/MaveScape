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

import { agreementOf } from './agreement.js';
import { mean as mergeMean, proteinView } from './collapse.js';
import { replicateSamples } from './design.js';
import { REPLICATE_STATE } from './filters.js';
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

export const sameSpec = (a, b) => a?.run === b?.run && (a.replicate ?? null) === (b.replicate ?? null) && (a.replicate ? true : (a.condition ?? 0) === (b.condition ?? 0));
export const specKey = (s) => (s ? `${s.run}|${s.replicate ? `r:${s.replicate}` : `c:${s.condition ?? 0}`}` : '');

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
    run: { id: run.id, name: run.name, sha256: run.output.sha256, scoring: run.inputs.scoring ?? null },
    kind: replicate ? 'replicate' : 'condition',
    name: replicate ? replicate.name : condition.name,
    condition: conditionIndex,
    replicates: replicateIds,
    results,
    design,
    parameters: run.inputs.parameters,
    target: design.targets?.[0] ?? null,
    samples,
    table: run.inputs.source.sha256,
    urns: urnsOf(source?.origin),
  };
}

const urnsOf = (origin) => (origin?.database === 'MaveDB' ? origin.urns ?? (origin.urn ? [origin.urn] : []) : []);

// A side's scores at a level ('protein' reads a nucleotide run at the protein level, merged as the
// map merges them): { keys, original, kind, position, score, se, usable, flags }.
function valuesOf(side, level) {
  const own = side.results;
  const view = level === 'protein' && own.variants.proKey ? proteinView(own) : own;
  const v = view.variants;
  const n = view.rows;
  if (side.kind === 'condition') {
    const c = view.conditions[side.condition];
    const usable = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) usable[i] = !c.reason[i] && Number.isFinite(c.score[i]) ? 1 : 0;
    return { keys: v.key, original: v.original, kind: v.kind, position: v.position, score: c.score, se: c.se, usable, flags: c.flags };
  }
  const r = own.replicates.find((x) => x.id === side.spec.replicate);
  const used = (i) => r.state[i] === REPLICATE_STATE.USED && Number.isFinite(r.score[i]);
  if (view === own) {
    const usable = Uint8Array.from({ length: n }, (_, i) => (used(i) ? 1 : 0));
    return { keys: v.key, original: v.original, kind: v.kind, position: v.position, score: r.score, se: r.se, usable, flags: new Uint8Array(n) };
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
  return { keys: v.key, original: v.original, kind: v.kind, position: v.position, score, se, usable, flags: new Uint8Array(n) };
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
function matchingOf(a, b) {
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
  if (coordinates === 'target' && nucleotide(a) && nucleotide(b)) {
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
const STATUS_RANK = { ok: 0, qualified: 1, blocked: 2 };

// Compares side b with side a: { a, b, level, coordinates, report: { status, items }, flipped,
// sameScale, matched: { n, onlyA, onlyB, notScoredA, notScoredB }, rows, keys, x, y, statistics,
// withheld }. x: a's scores; y: b's as compared (negated when their directions are opposite).
export function compareSides(a, b) {
  const items = [];
  const blocked = (id, label, text) => {
    items.push({ id, status: 'blocked', label, text });
    return finish();
  };
  let level = null;
  let coordinates = null;
  let flipped = false;
  let sameScale = false;
  let matched = null;
  let rows = [];
  let keys = [];
  const finish = () => {
    const status = items.reduce((s, x) => (STATUS_RANK[x.status] > STATUS_RANK[s] ? x.status : s), 'ok');
    const out = { a: summary(a), b: summary(b), level, coordinates, flipped, sameScale, report: { status, items }, matched, rows, keys, x: null, y: null, statistics: null, withheld: [] };
    if (status === 'blocked') return out;
    const va = valuesOf(a, level);
    const vb = valuesOf(b, level);
    out.x = Float64Array.from(rows, ([i]) => va.score[i]);
    out.y = Float64Array.from(rows, ([, j]) => (flipped ? -vb.score[j] : vb.score[j]));
    out.values = { a: va, b: vb };
    const stats = agreementOf(out.x, out.y);
    if (!sameScale) {
      out.withheld = ['concordance', 'blandAltman'];
      stats.concordance = null;
      stats.blandAltman = null;
    }
    out.statistics = stats;
    return out;
  };

  if (sameSpec(a.spec, b.spec)) return blocked('sides', 'Sides', `${a.label} is compared with itself.`);
  const m = matchingOf(a, b);
  if (m.problem) return blocked('target', 'Target', m.problem);
  ({ level, coordinates } = m);
  items.push(...m.items);

  // The variants matched.
  const va = valuesOf(a, level);
  const vb = valuesOf(b, level);
  const found = matchVariants(va, vb, coordinates, m.offsets);
  rows = found.rows;
  keys = found.keys;
  matched = { n: rows.length, onlyA: found.onlyA, onlyB: found.onlyB, notScoredA: found.notScoredA, notScoredB: found.notScoredB };
  // Scored on one side only: absent from the other's variants, or there but not scored.
  const oneSide = (side, other, absent, unscored) => {
    const total = absent + unscored;
    if (!total) return '';
    const why = absent && unscored ? ` (${fmtCount(absent)} not among ${other.label}'s variants, ${fmtCount(unscored)} not scored there)` : absent ? ` (not among ${other.label}'s variants)` : ' (not scored on the other side)';
    return `${fmtCount(total)} scored in ${side.label} only${why}`;
  };
  const unmatched = [oneSide(a, b, found.onlyA, found.notScoredB), oneSide(b, a, found.onlyB, found.notScoredA)].filter(Boolean);
  if (rows.length < MIN_MATCHED) return blocked('variants', 'Variants', `${fmtCount(rows.length)} variant${rows.length === 1 ? ' is' : 's are'} scored on both sides: too few to compare (${MIN_MATCHED} at least).${unmatched.length ? ` ${unmatched.join('; ')}.` : ''}`);
  items.push({ id: 'variants', status: 'ok', label: 'Variants', text: `${fmtCount(rows.length)} scored on both sides${unmatched.length ? `; ${unmatched.join('; ')}` : ''}. The wild type, the reference of both, is left out.` });

  // The readouts.
  const ra = readoutOf(a.design);
  const rb = readoutOf(b.design);
  const unsigned = [a, b].filter((s) => readoutOf(s.design).direction === 'unsigned');
  if (unsigned.length === 1) {
    items.push({ id: 'direction', status: 'qualified', label: 'Direction', text: `${unsigned[0].label}'s scores have no sign (a larger change either way) and the other's do: a correlation between them mixes losses and gains.` });
  } else if (ra.direction !== rb.direction) {
    flipped = true;
    items.push({ id: 'direction', status: 'qualified', label: 'Direction', text: `A higher score means more of the function in ${ra.direction === 'higher-more' ? a.label : b.label} and less in ${ra.direction === 'higher-more' ? b.label : a.label}: ${b.label} is compared negated, so that agreement reads as agreement.` });
  } else if (!ra.stated || !rb.stated) {
    const unstated = [a, b].filter((s) => !readoutOf(s.design).stated).map((s) => s.label);
    if (a.run.id === b.run.id) items.push({ id: 'direction', status: 'ok', label: 'Direction', text: 'One run: the same direction on both sides (not stated in its design).' });
    else items.push({ id: 'direction', status: 'qualified', label: 'Direction', text: `What a higher score means is not stated for ${unstated.join(' and ')}: taken as more of the function measured on both sides. State it in Experiment (the readout) if it is not.` });
  } else {
    items.push({ id: 'direction', status: 'ok', label: 'Direction', text: `On both sides ${ra.direction === 'higher-more' ? 'a higher score means more of the function measured' : ra.direction === 'higher-less' ? 'a higher score means less of the function measured' : 'the scores have no sign'}.` });
  }
  const assay = (r) => [r.phenotype, r.method].filter(Boolean).join('; ');
  if (a.run.id !== b.run.id && assay(ra) && assay(rb) && assay(ra) !== assay(rb)) {
    items.push({ id: 'assay', status: 'qualified', label: 'Assays', text: `Two assays (${assay(ra)}; ${assay(rb)}): they can disagree for reasons of biology, not only of measurement.` });
  }

  // The scales.
  const sa = scaleOf(a);
  const sb = scaleOf(b);
  sameScale = a.run.id === b.run.id || (sa.known && sb.known && sa.key === sb.key);
  if (flipped) sameScale = false;
  if (sameScale) {
    items.push({ id: 'scale', status: 'ok', label: 'Scale', text: a.run.id === b.run.id ? `One run, one scale: ${sa.words}.` : `One scale: ${sa.words}.` });
  } else {
    const what = !sa.known || !sb.known
      ? `${[a, b].filter((s) => !scaleOf(s).known).map((s) => s.label).join(' and ')} ${[sa, sb].filter((s) => !s.known).length > 1 ? 'are' : 'is'} on ${[sa, sb].filter((s) => !s.known).length > 1 ? 'their records\' own scales' : 'its record\'s own scale'}, which MaveScape does not know${sa.known ? ` (${a.label}: ${sa.words})` : sb.known ? ` (${b.label}: ${sb.words})` : ''}`
      : flipped ? 'Opposite directions' : `Different scales (${a.label}: ${sa.words}; ${b.label}: ${sb.words})`;
    items.push({ id: 'scale', status: 'qualified', label: 'Scale', text: `${what}. The correlations compare their order and their linear relation; Lin's concordance and Bland–Altman, which measure agreement on one scale, are withheld.` });
  }

  // Independence.
  const shared = [...a.samples].filter((s) => b.samples.has(s));
  if (a.run.id === b.run.id) {
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

const summary = (s) => ({ label: s.label, run: s.run, kind: s.kind, name: s.name, condition: s.condition, ...(s.kind === 'replicate' ? { replicate: s.spec.replicate } : {}) });

// --- Exports --------------------------------------------------------------------------------------

const num = (x) => (Number.isFinite(x) ? String(x) : 'NA');
const cell = (s) => (/[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s);

// The matched variants (comparison.csv): the variant (on the reference's coordinates when matched
// there), as each side names it, its class, each side's score and SE as scored, and the difference
// and mean as compared (the second side negated when the directions are opposite).
export function comparisonCSV(c) {
  const lines = ['variant,variant_a,variant_b,class,score_a,SE_a,score_b,SE_b,difference,mean'];
  if (!c.statistics) return `${lines[0]}\n`;
  const { a: va, b: vb } = c.values;
  c.rows.forEach(([i, j], k) => {
    const x = c.x[k];
    const y = c.y[k];
    lines.push([cell(c.keys[k]), cell(va.keys[i]), cell(vb.keys[j]), KIND_NAMES[va.kind[i]], num(va.score[i]), num(va.se[i]), num(vb.score[j]), num(vb.se[j]), num(x - y), num((x + y) / 2)].join(','));
  });
  return `${lines.join('\n')}\n`;
}

// The comparison's record (comparison.json): the two sides (each run's id and output hash), how they
// were matched, the report, the counts and the statistics, with what was withheld.
export function comparisonJSON(c, software = null) {
  const side = (s) => ({ label: s.label, run: s.run.id, runName: s.run.name, output: s.run.sha256, ...(s.kind === 'replicate' ? { replicate: s.replicate } : { condition: s.name }) });
  const clean = (o) => JSON.parse(JSON.stringify(o, (k, v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v)));
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
    report: c.report,
    matched: c.matched,
    statistics: c.statistics,
    withheld: c.withheld,
  }), null, 2)}\n`;
}
