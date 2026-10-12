// Checkpoints and the semantic diff of two analyses (wave 6, slice 5; requirement R6). A checkpoint
// keeps the analysis as it stood, named: the workspace's state (everything but its history and
// checkpoints) and the history's hash at that moment, which names the state in the chain. The diff
// says what changed between two states (two checkpoints, a checkpoint and now, two archives), in
// words: the tables and targets, the design, the runs scored and removed, the QC thresholds and
// acknowledgements, the selections, annotations, structure views, figures, the analyses kept in
// the report, the MaveDB details. For the latest run of each table in the two states it says how
// the analysis changed (its parameters and filters, its design) and what that did: the variants
// whose effect moved beyond their earlier 95% interval, crossed a class (lower than, like or
// higher than the wild type, q < 0.05, as the robustness check calls them), or were newly filtered
// or scored; the QC findings whose verdict changed; and a map of the change. After CytoWeave
// 0.8.0's web/lib/diff.js (a change list in words); the analysis and its words are MaveScape's.

import { sha256 } from './sha256.js';
import { canonicalJSON } from './workspace.js';
import { withDefaults } from './score.js';
import { describeParameters, isBarcodeRun } from './runs.js';
import { THRESHOLDS, defaultThresholds } from './findings.js';
import { callsOf, CLASS, CLASS_NAMES, CONTRAST_CLASS_NAMES } from './robustness.js';
import { panelSummary } from './figures.js';
import { possessive } from './words.js';

const encoder = new TextEncoder();
const same = (a, b) => canonicalJSON(a ?? null) === canonicalJSON(b ?? null);
const byId = (list, key = 'id') => new Map((list ?? []).map((x) => [x[key], x]));
const list = (items) => (items.length > 2 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : items.join(' and '));
const count = (n) => n.toLocaleString('en-US');
const plural = (n, word, many = `${word}s`) => `${count(n)} ${n === 1 ? word : many}`;
const short = (hash) => (hash ? `${hash.slice(0, 12)}…` : '—');
const lower = (text) => `${text.charAt(0).toLowerCase()}${text.slice(1)}`;
const show = (v) => (v === null || v === undefined ? 'none' : Array.isArray(v) ? (v.length ? v.join(', ') : 'none') : typeof v === 'boolean' ? (v ? 'yes' : 'no') : typeof v === 'object' ? canonicalJSON(v) : String(v));
// An effect beyond the earlier 95% interval (the robustness check's Z975).
const Z975 = 1.959963984540054;

// --- Checkpoints ------------------------------------------------------------------------------------------

// What a checkpoint keeps: the analysis, without the workspace's identity, its history (the
// checkpoint names its place in it) and its checkpoints.
const NOT_STATE = new Set(['format', 'version', 'id', 'created', 'modified', 'history', 'checkpoints']);
export function analysisState(ws) {
  return Object.fromEntries(Object.entries(ws).filter(([k, v]) => !NOT_STATE.has(k) && v !== undefined));
}

export const stateDigest = (state) => sha256(encoder.encode(canonicalJSON(state)));

// A checkpoint of the workspace: { id, name, created, head (the history's last hash), sha256 (of
// the state's canonical JSON), state }. Kept in ws.checkpoints (lib/workspace.js, addCheckpoint).
export function makeCheckpoint(ws, name, created) {
  const state = analysisState(ws);
  return { name, created, head: ws.history?.at(-1)?.hash ?? null, sha256: stateDigest(state), state };
}

// --- The parameters and the design, in words ---------------------------------------------------------------

const PARAMETERS = {
  model: 'the model', normalization: 'the normalization', pseudocount: 'the pseudocount', regressionSE: 'a regression\'s SE', timeScale: 'the time scale',
  binScale: 'the bins\' scale', binSE: 'the bins\' SE', binSigma: 'the bins\' σ', dimsumNormalise: 'DiMSum\'s scaling of replicates', dimsumErrorModel: 'DiMSum\'s error model',
  dimsumDropout: 'DiMSum\'s dropout pseudocount', bootstrapSamples: 'the bootstrap samples', seed: 'the seed', aggregation: 'the barcodes\' aggregation', barcodeCombination: 'the barcodes\' combination',
  combination: 'the combination of replicates', rescale: 'the rescaling', differential: 'the comparison of conditions',
};
const FILTERS = {
  minInputCount: 'the minimum input count', minTotalCount: 'the minimum total count', minTimePoints: 'the minimum time points', minFrequency: 'the minimum bin frequency',
  minReplicates: 'the minimum replicates', minBarcodes: 'the minimum barcodes', maxBarcodeZ: 'the outlier barcodes\' limit', maxSE: 'the maximum SE', excludeKinds: 'the classes left out', exclude: 'the variants left out',
};

// How two runs' parameters differ: ["the pseudocount 0.5 → 1", …] (MaveScape's defaults where a
// run set none, so that a default made explicit is no change).
export function parameterChanges(a, b) {
  const pa = withDefaults(a);
  const pb = withDefaults(b);
  const out = [];
  for (const [key, words] of Object.entries(PARAMETERS)) if (!same(pa[key], pb[key])) out.push(`${words} ${show(pa[key])} → ${show(pb[key])}`);
  for (const [key, words] of Object.entries(FILTERS)) if (!same(pa.filters[key], pb.filters[key])) out.push(`${words} ${show(pa.filters[key])} → ${show(pb.filters[key])}`);
  for (const key of Object.keys(pb)) if (!(key in PARAMETERS) && key !== 'filters' && !same(pa[key], pb[key])) out.push(`${key} ${show(pa[key])} → ${show(pb[key])}`);
  return out;
}

const nameOf = (x) => x?.name ?? x?.id;

// Items of two lists by id: what was added, removed and changed, in words. what: the noun.
function listChanges(a, b, what, describe = null) {
  const out = [];
  const ma = byId(a);
  const mb = byId(b);
  for (const [id, x] of mb) {
    if (!ma.has(id)) out.push(`${what} ${nameOf(x)} added`);
    else if (!same(ma.get(id), x)) out.push(`${what} ${nameOf(x)} ${describe ? describe(ma.get(id), x) : 'changed'}`);
  }
  for (const [id, x] of ma) if (!mb.has(id)) out.push(`${what} ${nameOf(x)} ${what === 'replicate' ? 'left out' : 'removed'}`);
  return out;
}

const fieldsChanged = (a, b) => {
  const keys = [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])].filter((k) => !same(a?.[k], b?.[k]));
  return keys.length ? `changed (${keys.join(', ')})` : 'changed';
};

// How two designs differ, in words: ["replicate Replicate 3 left out", "the readout changed
// (direction)", …].
export function designChanges(a, b) {
  if (same(a, b)) return [];
  if (!a) return ['a design set'];
  if (!b) return ['the design cleared'];
  const out = [];
  if (a.name !== b.name) out.push(`its name "${a.name}" → "${b.name}"`);
  if (a.model !== b.model) out.push(`the model ${a.model} → ${b.model}`);
  out.push(...listChanges(a.targets, b.targets, 'target', (x, y) => {
    const what = [];
    if (x.sequence !== y.sequence) what.push(`its sequence (${x.sequence.length} → ${y.sequence.length} ${y.sequenceType === 'dna' ? 'nt' : 'residues'})`);
    if ((x.offset ?? 0) !== (y.offset ?? 0)) what.push(`its offset ${x.offset ?? 0} → ${y.offset ?? 0}`);
    const rest = Object.keys({ ...x, ...y }).filter((k) => !['sequence', 'offset'].includes(k) && !same(x[k], y[k]));
    if (rest.length) what.push(rest.join(', '));
    return `changed: ${what.join('; ')}`;
  }));
  if (!same(a.variants, b.variants)) out.push(`the variants ${fieldsChanged(a.variants, b.variants)}`);
  if (!same(a.library, b.library)) out.push(`the library ${fieldsChanged(a.library, b.library)}`);
  out.push(...listChanges(a.samples, b.samples, 'sample', fieldsChanged));
  out.push(...listChanges(a.replicates, b.replicates, 'replicate', fieldsChanged));
  out.push(...listChanges(a.conditions, b.conditions, 'condition', fieldsChanged));
  for (const key of ['readout', 'controls', 'time', 'bins', 'source', 'assay', 'scores']) if (!same(a[key], b[key])) out.push(`the ${key} ${a[key] && b[key] ? fieldsChanged(a[key], b[key]) : a[key] ? 'removed' : 'added'}`);
  const known = new Set(['format', 'version', 'name', 'model', 'targets', 'variants', 'library', 'samples', 'replicates', 'conditions', 'readout', 'controls', 'time', 'bins', 'source', 'assay', 'scores']);
  for (const key of Object.keys({ ...a, ...b })) if (!known.has(key) && !same(a[key], b[key])) out.push(`its ${key} changed`);
  return out;
}

// --- Two states -----------------------------------------------------------------------------------------------

// The runs whose effect a diff describes: for each table scored in both states, its latest run in
// each ([{ table, a, b }]), the same run when it was not scored again (its QC verdicts can still
// change with the thresholds).
export function runPairs(before, after) {
  const latest = (state) => {
    const out = new Map();
    for (const run of state.runs ?? []) out.set(run.inputs.source.sha256, run);
    return out;
  };
  const la = latest(before);
  const lb = latest(after);
  return [...lb].filter(([table]) => la.has(table)).map(([table, b]) => ({ table, a: la.get(table), b }));
}

// What a change of a run did to its variants, for each condition (and difference between
// conditions) of the two: { id, name, kind, both (scored in both), moved (beyond the earlier 95%
// interval), crossed (another class), crossings: [{ from, to, n }], filtered (scored before, not
// now), scored (now, not before), variants: the moved and crossed, largest first, up to 25 }.
export function variantChanges(runA, resultsA, runB, resultsB) {
  const ta = callsOf(resultsA, runA.inputs.design);
  const tb = callsOf(resultsB, runB.inputs.design);
  const rowB = new Map(resultsB.variants.key.map((k, i) => [k, i]));
  const out = [];
  for (const x of ta) {
    const y = tb.find((t) => t.id === x.id);
    if (!y) continue;
    const names = x.kind === 'contrast' ? CONTRAST_CLASS_NAMES : CLASS_NAMES;
    let both = 0;
    let moved = 0;
    let crossed = 0;
    let filtered = 0;
    let scored = 0;
    const crossings = new Map();
    const variants = [];
    resultsA.variants.key.forEach((key, i) => {
      const j = rowB.get(key);
      const ca = x.cls[i];
      const cb = j === undefined ? 0 : y.cls[j];
      if (ca && !cb) filtered += 1;
      if (!ca && cb) scored += 1;
      if (!ca || !cb) return;
      both += 1;
      const z = x.se[i] > 0 ? (y.effect[j] - x.effect[i]) / x.se[i] : Number.NaN;
      const isMoved = Math.abs(z) > Z975;
      const isCrossed = ca !== cb;
      if (isMoved) moved += 1;
      if (isCrossed) {
        crossed += 1;
        const k = `${ca}>${cb}`;
        crossings.set(k, (crossings.get(k) ?? 0) + 1);
      }
      if (isMoved || isCrossed) variants.push({ variant: key, before: x.effect[i], after: y.effect[j], z, from: names[ca], to: names[cb] });
    });
    // Each variant not in the earlier run but scored now.
    const keysA = new Set(resultsA.variants.key);
    resultsB.variants.key.forEach((key, j) => {
      if (!keysA.has(key) && y.cls[j]) scored += 1;
    });
    variants.sort((p, q) => Math.abs(q.z || 0) - Math.abs(p.z || 0) || (p.variant < q.variant ? -1 : 1));
    out.push({
      id: x.id, name: x.name, kind: x.kind, both, moved, crossed, filtered, scored,
      crossings: [...crossings].map(([k, n]) => {
        const [from, to] = k.split('>').map(Number);
        return { from: names[from], to: names[to], n };
      }).sort((p, q) => q.n - p.n),
      variants: variants.slice(0, 25),
    });
  }
  return out;
}

// The QC findings whose verdict changed between two lists of findings (each run's, read with each
// state's thresholds and acknowledgements): [{ id, title, from, to }].
export function findingChanges(a, b) {
  const ma = byId(a);
  const out = [];
  for (const f of b ?? []) {
    const g = ma.get(f.id);
    const was = g ? `${g.status}${g.acknowledged?.current ? ', acknowledged' : ''}` : 'not assessed';
    const now = `${f.status}${f.acknowledged?.current ? ', acknowledged' : ''}`;
    if (was !== now) out.push({ id: f.id, title: f.title, from: was, to: now });
  }
  return out;
}

// The change of a run as the map reads a contrast (after − before, of the effects callsOf gives:
// each score less the wild type's), on the later run's variants: { results, design, contrast: 0 }
// for buildMapModel with colorBy 'differential'; null when the two have no condition in common.
export function changeMap(runA, resultsA, runB, resultsB, condition = 0) {
  const x = callsOf(resultsA, runA.inputs.design).filter((t) => t.kind === 'condition')[condition];
  const y = callsOf(resultsB, runB.inputs.design).filter((t) => t.kind === 'condition')[condition];
  if (!x || !y) return null;
  const n = resultsB.rows;
  const rowA = new Map(resultsA.variants.key.map((k, i) => [k, i]));
  const nan = () => new Float64Array(n).fill(Number.NaN);
  const delta = nan();
  const se = nan();
  const reason = new Uint8Array(n).fill(1);
  const c = resultsB.conditions[condition];
  for (let j = 0; j < n; j += 1) {
    const i = rowA.get(resultsB.variants.key[j]);
    if (i === undefined || !x.cls[i] || !y.cls[j]) continue;
    delta[j] = y.effect[j] - x.effect[i];
    se[j] = x.se[i];
    reason[j] = 0;
  }
  const before = { ...c, id: 'before', name: runA.name, reason: Uint8Array.from(c.reason, (r, j) => (rowA.has(resultsB.variants.key[j]) ? r : 1)) };
  const after = { ...c, id: 'after', name: runB.name };
  const contrast = { id: 'change', name: `${runB.name} − ${runA.name}`, reference: 'before', condition: 'after', method: 'change', delta, se, z: nan(), p: nan(), q: nan(), reason, k: new Uint8Array(n).fill(1), pairs: [], unpaired: [] };
  return { results: { ...resultsB, conditions: [before, after], differential: [contrast] }, design: runB.inputs.design, contrast: 0 };
}

// What changed between two analysis states (analysisState, or a checkpoint's state). pairs: what
// the caller computed for runPairs(before, after), each { a, b, resultsA, resultsB, findingsA,
// findingsB } (results and findings null where they could not be had). Returns { same, changes:
// [{ kind, id, name, text }], pairs: [{ table, a, b, parameters, design, targets, findings,
// recomputed }], summary }.
export function diffStates(before, after, { pairs = [] } = {}) {
  const changes = [];
  const add = (kind, id, name, text) => changes.push({ kind, id, name, text });
  if (before.name !== after.name) add('workspace', 'name', after.name, `The workspace was renamed "${before.name}" → "${after.name}".`);

  // Tables and targets.
  const sa = byId(before.sources);
  const sb = byId(after.sources);
  for (const [id, s] of sb) if (!sa.has(id)) add('table', id, s.name, `The table ${s.name} was imported (SHA-256 ${short(s.sha256)}${s.rows ? `, ${count(s.rows)} rows` : ''}).`);
  for (const [id, s] of sa) if (!sb.has(id)) add('table', id, s.name, `The table ${s.name} was removed.`);
  for (const [id, s] of sb) if (sa.has(id) && !same(sa.get(id), s)) add('table', id, s.name, `The table ${s.name}: ${lower(fieldsChanged(sa.get(id), s))}.`);
  const tb = byId(after.targets);
  const ta = byId(before.targets);
  for (const [id, t] of tb) {
    const old = ta.get(id);
    if (!old) add('target', id, t.name, `The target ${t.name} was added (${t.sequence?.length ?? '?'} ${t.sequenceType === 'dna' ? 'nt' : 'aa'}).`);
    else if (!same(old, t)) {
      const what = [];
      if (old.sequence !== t.sequence) what.push(`its sequence (${old.sequence.length} → ${t.sequence.length})`);
      if ((old.offset ?? 0) !== (t.offset ?? 0)) what.push(`its offset ${old.offset ?? 0} → ${t.offset ?? 0}`);
      if (!same(old.reference, t.reference)) what.push(t.reference ? `checked against UniProt ${t.reference.accession}${t.reference.release ? ` (release ${t.reference.release})` : ''}` : 'its check against UniProt removed');
      const rest = Object.keys({ ...old, ...t }).filter((k) => !['sequence', 'offset', 'reference'].includes(k) && !same(old[k], t[k]));
      if (rest.length) what.push(`its ${rest.join(', ')}`);
      add('target', id, t.name, `The target ${t.name}: ${what.join('; ')}.`);
    }
  }
  for (const [id, t] of ta) if (!tb.has(id)) add('target', id, t.name, `The target ${t.name} was removed.`);

  // The design.
  const dc = designChanges(before.design, after.design);
  if (dc.length) add('design', 'design', after.design?.name ?? before.design?.name ?? 'the design', `The design: ${dc.join('; ')}.`);

  // Runs.
  const ra = byId(before.runs);
  const rb = byId(after.runs);
  for (const [id, r] of rb) if (!ra.has(id)) add('run', id, r.name, `${r.name} was scored: ${describeParameters(r.inputs.parameters, isBarcodeRun(r))} (output SHA-256 ${short(r.output.sha256)}).`);
  for (const [id, r] of ra) if (!rb.has(id)) add('run', id, r.name, `${r.name} was removed.`);

  // QC thresholds and acknowledgements.
  const d = defaultThresholds();
  const th = (state) => ({ ...d, ...(state.qc?.thresholds ?? {}) });
  const tha = th(before);
  const thb = th(after);
  for (const t of THRESHOLDS) {
    if (same(tha[t.key], thb[t.key])) continue;
    const words = (v) => (t.measure ? `${v} ${t.unit}` : `review ${t.bad} ${v.review}, fail ${t.bad} ${v.fail}`);
    add('qc', `threshold:${t.key}`, t.label, `The QC threshold "${t.label}": ${words(tha[t.key])} → ${words(thb[t.key])}.`);
  }
  const aa = before.qc?.acknowledged ?? {};
  const ab = after.qc?.acknowledged ?? {};
  for (const id of new Set([...Object.keys(aa), ...Object.keys(ab)])) {
    if (same(aa[id], ab[id])) continue;
    if (!aa[id]) add('qc', `acknowledged:${id}`, id, `The QC finding ${id} was acknowledged (${ab[id].status}): "${ab[id].reason}".`);
    else if (!ab[id]) add('qc', `acknowledged:${id}`, id, `The acknowledgement of the QC finding ${id} was withdrawn.`);
    else add('qc', `acknowledged:${id}`, id, `The acknowledgement of the QC finding ${id}: "${aa[id].reason}" → "${ab[id].reason}".`);
  }

  // Selections, annotations, structure views, figures, the report's analyses.
  const sel = (s) => `${plural(s.keys.length, 'variant')}${s.query ? `, by the query "${s.query}"` : ''}`;
  const sla = byId(before.selections);
  const slb = byId(after.selections);
  for (const [id, s] of slb) {
    if (!sla.has(id)) add('selection', id, s.name, `The selection "${s.name}" was saved (${sel(s)}).`);
    else if (!same(sla.get(id), s)) add('selection', id, s.name, `The selection "${s.name}": ${sel(sla.get(id))} → ${sel(s)}.`);
  }
  for (const [id, s] of sla) if (!slb.has(id)) add('selection', id, s.name, `The selection "${s.name}" was removed.`);
  const ana = byId(before.annotations);
  const anb = byId(after.annotations);
  for (const [id, a] of anb) {
    if (!ana.has(id)) add('annotation', id, a.name, `The annotation "${a.name}" was added beside the map${a.file?.sha256 ? ` (its file's SHA-256 ${short(a.file.sha256)})` : ''}.`);
    else if (!same(ana.get(id), a)) add('annotation', id, a.name, `The annotation "${a.name}": ${lower(fieldsChanged(ana.get(id), a))}.`);
  }
  for (const [id, a] of ana) if (!anb.has(id)) add('annotation', id, a.name, `The annotation "${a.name}" was removed.`);
  const va = byId(before.structureViews);
  const vb = byId(after.structureViews);
  for (const [id, v] of vb) {
    if (!va.has(id)) add('structure-view', id, v.name, `The structure view "${v.name}" was saved.`);
    else if (!same(va.get(id), v)) add('structure-view', id, v.name, `The structure view "${v.name}" was saved again (${Object.keys({ ...va.get(id), ...v }).filter((k) => !same(va.get(id)[k], v[k]) && k !== 'created').join(', ') || 'its time'}).`);
  }
  for (const [id, v] of va) if (!vb.has(id)) add('structure-view', id, v.name, `The structure view "${v.name}" was removed.`);
  const fa = byId(before.figures);
  const fb = byId(after.figures);
  for (const [id, f] of fb) {
    const old = fa.get(id);
    if (!old) {
      add('figure', id, f.name, `The figure "${f.name}" was made (${plural(f.panels.length, 'panel')}).`);
      continue;
    }
    if (same(old, f)) continue;
    const what = [];
    if (old.name !== f.name) what.push(`renamed from "${old.name}"`);
    const pa = byId(old.panels);
    const pb = byId(f.panels);
    const added = f.panels.filter((p) => !pa.has(p.id)).map((p) => panelSummary(p, after));
    const removed = old.panels.filter((p) => !pb.has(p.id)).map((p) => panelSummary(p, before));
    const place = new Set(['x', 'y', 'w', 'h']);
    const shown = f.panels.filter((p) => pa.has(p.id) && Object.keys({ ...pa.get(p.id), ...p }).some((k) => !place.has(k) && !same(pa.get(p.id)[k], p[k]))).map((p) => panelSummary(p, after));
    const moved = f.panels.filter((p) => pa.has(p.id) && [...place].some((k) => pa.get(p.id)[k] !== p[k])).length;
    if (added.length) what.push(`${added.length === 1 ? 'a panel' : `${added.length} panels`} added (${added.join('; ')})`);
    if (removed.length) what.push(`${removed.length === 1 ? 'a panel' : `${removed.length} panels`} removed (${removed.join('; ')})`);
    if (shown.length) what.push(`what ${shown.length === 1 ? 'a panel shows' : `${shown.length} panels show`} changed (${shown.join('; ')})`);
    if (moved) what.push(`${plural(moved, 'panel')} moved or resized`);
    const page = Object.keys({ ...old, ...f }).filter((k) => !['name', 'panels'].includes(k) && !same(old[k], f[k]));
    if (page.length) what.push(`its ${page.join(', ')}`);
    add('figure', id, f.name, `The figure "${f.name}": ${what.join('; ') || 'changed'}.`);
  }
  for (const [id, f] of fa) if (!fb.has(id)) add('figure', id, f.name, `The figure "${f.name}" was deleted.`);
  const ka = byId(before.analyses);
  const kb = byId(after.analyses);
  const kept = (a) => (a.kind === 'comparison' ? `the comparison of ${a.a.label} and ${a.b.label}` : `${possessive(a.run.name)} robustness check`);
  for (const [id, a] of kb) if (!ka.has(id)) add('report', id, kept(a), `${kept(a).replace(/^./, (c) => c.toUpperCase())} was added to the report.`);
  for (const [id, a] of ka) if (!kb.has(id)) add('report', id, kept(a), `${kept(a).replace(/^./, (c) => c.toUpperCase())} was taken out of the report.`);
  if (!same(before.deposit, after.deposit)) add('deposit', 'deposit', 'MaveDB details', `The MaveDB details: ${lower(fieldsChanged(before.deposit ?? {}, after.deposit ?? {})).replace(/^changed \((.*)\)$/, '$1 changed')}.`);
  if (!same(before.tracks, after.tracks)) add('tracks', 'tracks', 'tracks', 'The tracks beside the map were arranged or filtered otherwise.');
  const covered = new Set(['name', 'sources', 'targets', 'design', 'designSource', 'runs', 'qc', 'selections', 'annotations', 'structureViews', 'structures', 'figures', 'analyses', 'deposit', 'tracks']);
  for (const key of Object.keys({ ...before, ...after })) if (!covered.has(key) && !same(before[key], after[key])) add('workspace', key, key, `The workspace's ${key} changed.`);

  // The latest run of each table: how its analysis changed and what that did.
  const described = pairs.map((p) => {
    const parameters = p.a.id === p.b.id ? [] : parameterChanges(p.a.inputs.parameters, p.b.inputs.parameters);
    const design = p.a.id === p.b.id ? [] : designChanges(p.a.inputs.design, p.b.inputs.design);
    const recomputed = Boolean(p.resultsA && p.resultsB);
    const targets = recomputed && p.a.id !== p.b.id ? variantChanges(p.a, p.resultsA, p.b, p.resultsB) : [];
    const findings = p.findingsA && p.findingsB ? findingChanges(p.findingsA, p.findingsB) : [];
    return { table: p.table, a: { id: p.a.id, name: p.a.name }, b: { id: p.b.id, name: p.b.name }, parameters, design, targets, findings, recomputed: recomputed || p.a.id === p.b.id };
  }).filter((p) => p.a.id !== p.b.id || p.findings.length);
  const n = changes.length;
  const summary = n || described.length
    ? `${plural(n, 'change')}${described.length ? `; ${described.map((p) => (p.a.id === p.b.id ? `${p.b.name}'s QC verdicts` : `${p.a.name} → ${p.b.name}`)).join(', ')}` : ''}.`
    : 'No change in the analysis.';
  return { same: !n && !described.length, changes, pairs: described, summary };
}

// A run pair's change in sentences.
export function pairWords(p) {
  const out = [];
  if (p.a.id !== p.b.id) {
    out.push(`${p.a.name} → ${p.b.name}${p.parameters.length ? `: ${p.parameters.join('; ')}` : ''}${p.design.length ? `${p.parameters.length ? '; ' : ': '}the design: ${p.design.join('; ')}` : ''}${!p.parameters.length && !p.design.length ? ': the same analysis' : ''}.`);
    if (!p.recomputed) out.push('Their scores could not be recomputed here, so what the change did to the variants is not said.');
    for (const t of p.targets) {
      const where = p.targets.length > 1 ? `${t.name}: ` : '';
      const crossings = t.crossings.length ? ` (${t.crossings.map((c) => `${count(c.n)} ${c.from} → ${c.to}`).join('; ')})` : '';
      out.push(`${where}${where ? 'of' : 'Of'} ${plural(t.both, t.kind === 'contrast' ? 'difference' : 'variant')} scored in both, ${count(t.moved)} moved beyond their earlier 95% interval and ${count(t.crossed)} changed class${crossings}; ${count(t.filtered)} no longer scored, ${count(t.scored)} newly scored.`);
    }
  }
  if (p.findings.length) out.push(`QC of ${p.b.name}: ${p.findings.map((f) => `${f.title} ${f.from} → ${f.to}`).join('; ')}.`);
  return out;
}
