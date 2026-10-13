// The workspace document: one immutable JSON value per analysis. Edits return a new value
// (store.commit records it for undo); nothing here mutates its argument.
//
// Material changes (a table imported, a target edited, the design changed) are written to the
// workspace's history, which is hash-chained (requirement E6; CytoWeave 0.8.0's change log, web/
// lib/workspace.js): each entry's hash is the SHA-256 of the hash before it and the entry itself,
// so an entry changed, removed, inserted or reordered afterward breaks the chain (verifyHistory).
// Beyond HISTORY_LIMIT entries the oldest are dropped and the hash of the last one dropped is kept
// as the history's anchor. See mavescape-spec/conventions.md, "Workspace".

import { sha256 } from './sha256.js';
import { newId as freshId, now as clockNow } from './clock.js';

export const WORKSPACE_FORMAT = 'mavescape-workspace';
export const WORKSPACE_VERSION = 1;
export const HISTORY_LIMIT = 5000;
const encoder = new TextEncoder();

const newId = () => `ws-${freshId()}`;

// --- The history ---------------------------------------------------------------------------------

// Keys sorted at every level, so a value has one text however it was built.
export function canonicalJSON(value) {
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJSON(v === undefined ? null : v)).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJSON(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export function historyEntryHash(previous, entry) {
  const { hash, ...content } = entry;
  return sha256(encoder.encode(`${previous}\n${canonicalJSON(content)}`));
}

function chained(previous, entry) {
  return { ...entry, hash: historyEntryHash(previous, entry) };
}

// Who makes the changes being made now, when it is not the person at the window: an AI agent
// through "mavescape mcp" (wave 7), by the name its client gives. Each history entry appended
// meanwhile records it as by, which its hash covers as it covers every field (remote.js sets it
// for the length of an agent's action; the page performs one action at a time).
let historyActor = null;
export function setHistoryActor(name) {
  historyActor = name || null;
}

// fn's result, with the history's entries made meanwhile by name (null: the person's). Accepting a
// proposal records the agent's changes under its name and the decision under none (proposals.js).
export function withHistoryActor(name, fn) {
  const before = historyActor;
  historyActor = name || null;
  try {
    return fn();
  } finally {
    historyActor = before;
  }
}

// The history fields of ws with an entry appended: { history, historyAnchor? }. by: who made the
// change, when not the person (by default, the actor of the moment).
export function appendHistory(ws, action, detail, time = clockNow(), by = historyActor) {
  const history = ws.history ?? [];
  const previous = history.length ? history[history.length - 1].hash : ws.historyAnchor ?? '';
  const all = [...history, chained(previous, { time, action, detail, ...(by ? { by } : {}) })];
  if (all.length <= HISTORY_LIMIT) return { history: all };
  return { history: all.slice(-HISTORY_LIMIT), historyAnchor: all[all.length - HISTORY_LIMIT - 1].hash };
}

// Checks the chain: { ok, entries, head, anchor, broken: [{ index, entry, reason }] }.
export function verifyHistory(ws) {
  const history = ws.history ?? [];
  let previous = ws.historyAnchor ?? '';
  const broken = [];
  history.forEach((entry, index) => {
    if (!entry.hash) broken.push({ index, entry, reason: 'not chained' });
    else if (entry.hash !== historyEntryHash(previous, entry)) broken.push({ index, entry, reason: 'its hash does not follow from the entries before it' });
    previous = entry.hash ?? previous;
  });
  return { ok: !broken.length, entries: history.length, head: history.length ? history[history.length - 1].hash ?? null : ws.historyAnchor ?? null, anchor: ws.historyAnchor ?? null, broken };
}

// A new value of ws with fields changed, modified now, and the change in the history.
export function change(ws, patch, action, detail, time = clockNow()) {
  return { ...ws, ...patch, modified: time, ...(action ? appendHistory(ws, action, detail, time) : {}) };
}

// --- The document --------------------------------------------------------------------------------

export function createWorkspace(name = 'Untitled workspace', options = {}) {
  const now = options.now ?? clockNow();
  return {
    format: WORKSPACE_FORMAT,
    version: WORKSPACE_VERSION,
    id: options.id ?? newId(),
    name,
    created: now,
    modified: now,
    // Imported tables (count sets, score sets) by SHA-256, with their mappings.
    sources: [],
    // Reference sequences and their identifiers.
    targets: [],
    // The experiment design (mavescape-design), once one is set, and the table it describes.
    design: null,
    designSource: null,
    // Immutable score runs.
    runs: [],
    // Quality control: its thresholds (null: MaveScape's defaults, web/lib/findings.js).
    qc: null,
    // Named sets of variants or positions.
    selections: [],
    // The hash-chained log of material changes: [{ time, action, detail, hash }].
    history: [chained('', { time: now, action: 'create', detail: `Created the workspace "${name}"`, ...(historyActor ? { by: historyActor } : {}) })],
  };
}

// A workspace from its saved text: checked for the format, completed with any field a later
// version added, and refused (with a plain message) when it is not a MaveScape workspace or is
// newer than this program.
export function parseWorkspace(text) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new Error('This is not a MaveScape workspace: it is not valid JSON.');
  }
  if (!doc || typeof doc !== 'object' || doc.format !== WORKSPACE_FORMAT) {
    throw new Error('This is not a MaveScape workspace (its format is not "mavescape-workspace").');
  }
  if (!Number.isInteger(doc.version) || doc.version < 1) throw new Error('The workspace has no valid version number.');
  if (doc.version > WORKSPACE_VERSION) {
    throw new Error(`The workspace was saved by a newer MaveScape (workspace version ${doc.version}; this program reads up to ${WORKSPACE_VERSION}). Update MaveScape to open it.`);
  }
  if (typeof doc.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(doc.id)) throw new Error('The workspace has no valid id.');
  const base = createWorkspace(typeof doc.name === 'string' ? doc.name : 'Untitled workspace', { id: doc.id, now: doc.created ?? doc.modified });
  return { ...base, ...doc, history: doc.history ?? [] };
}

// The saved text. Keys keep their order, so saving an unchanged workspace writes the same bytes.
export function serializeWorkspace(ws) {
  return JSON.stringify(ws);
}

export function touch(ws, now = clockNow()) {
  return { ...ws, modified: now };
}

export function rename(ws, name) {
  const trimmed = String(name).trim();
  if (!trimmed || trimmed === ws.name) return ws;
  return change(ws, { name: trimmed }, 'rename', `Renamed the workspace "${trimmed}"`);
}

// Whether a workspace holds anything worth saving (an empty, untitled one is not saved).
export function isEmptyWorkspace(ws) {
  return !ws.sources.length && !ws.targets.length && !ws.design && !ws.runs.length && !ws.selections.length && !(ws.structureViews ?? []).length && !(ws.controlSets ?? []).length;
}

// An id not yet used in a list: the base, or the base with a number.
export function uniqueId(base, list) {
  const taken = new Set(list.map((x) => x.id));
  const clean = String(base).replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 56) || 'item';
  if (!taken.has(clean)) return clean;
  let n = 2;
  while (taken.has(`${clean}-${n}`)) n += 1;
  return `${clean}-${n}`;
}

// Adds an imported table (a source: file, SHA-256, layout, mapping, summary; wave 1 slice 3).
export function addSource(ws, source) {
  const id = uniqueId(source.id ?? source.name ?? 'table', ws.sources);
  const detail = `Imported ${source.name}${source.sha256 ? ` (SHA-256 ${source.sha256.slice(0, 12)}…)` : ''}: ${source.rows ?? '?'} rows, ${source.mapping?.countColumns?.length ?? 0} count columns`;
  return { ws: change(ws, { sources: [...ws.sources, { ...source, id }] }, 'import', detail), id };
}

export function removeSource(ws, id) {
  const source = ws.sources.find((s) => s.id === id);
  if (!source) return ws;
  return change(ws, { sources: ws.sources.filter((s) => s.id !== id), designSource: ws.designSource === id ? null : ws.designSource }, 'remove-table', `Removed the table ${source.name}`);
}

// Adds a target; a target with the same sequence and name already there is returned instead.
export function addTarget(ws, target) {
  const same = ws.targets.find((t) => t.sequence === target.sequence && t.name === target.name);
  if (same) return { ws, id: same.id, existing: true };
  const id = uniqueId(target.id ?? target.name ?? 'target', ws.targets);
  const detail = `Added the target ${target.name} (${target.sequenceType === 'dna' ? `${target.sequence.length} nt` : `${target.sequence.length} aa`})`;
  return { ws: change(ws, { targets: [...ws.targets, { ...target, id }] }, 'target', detail), id, existing: false };
}

export function updateTarget(ws, id, patch, detail = null) {
  const target = ws.targets.find((t) => t.id === id);
  if (!target) return ws;
  const fields = Object.keys(patch).filter((k) => JSON.stringify(patch[k]) !== JSON.stringify(target[k]));
  if (!fields.length) return ws;
  const next = ws.targets.map((t) => (t.id === id ? { ...t, ...patch, id } : t));
  // The design holds its own copy of its targets: kept in step.
  const design = ws.design ? { ...ws.design, targets: ws.design.targets.map((t) => (t.id === id ? { ...t, ...patch, id } : t)) } : ws.design;
  return change(ws, { targets: next, design }, 'target', detail ?? `Changed the target ${target.name}: ${fields.join(', ')}`);
}

// A target checked against its reference entry (wave 3, slice 1): the design's fields the check
// changes (offset, identifiers, organism, differences), and its record (uniprot.js, referenceOf),
// kept with the workspace's target only, as provenance. A check that changes nothing leaves the
// design, and so its runs, as they were. One entry in the history.
export function recordTargetCheck(ws, id, patch, reference, detail) {
  const target = ws.targets.find((t) => t.id === id);
  if (!target) return ws;
  const fields = Object.keys(patch).filter((k) => JSON.stringify(patch[k]) !== JSON.stringify(target[k]));
  const patched = (t) => (t.id === id ? { ...t, ...Object.fromEntries(fields.map((k) => [k, patch[k]])), id } : t);
  const design = fields.length && ws.design ? { ...ws.design, targets: ws.design.targets.map(patched) } : ws.design;
  const targets = ws.targets.map((t) => (t.id === id ? { ...patched(t), reference } : t));
  return change(ws, { targets, design }, 'target', detail);
}

// Adds a named selection of variants (by their MAVE-HGVS keys), made on the map of a run.
export function addSelection(ws, selection) {
  const id = uniqueId(selection.name ?? 'selection', ws.selections);
  const entry = { ...selection, id, created: selection.created ?? clockNow() };
  return { ws: change(ws, { selections: [...ws.selections, entry] }, 'selection', `Saved the selection "${entry.name}": ${entry.keys.length} variant${entry.keys.length === 1 ? '' : 's'}`), id };
}

export function removeSelection(ws, id) {
  const selection = ws.selections.find((s) => s.id === id);
  if (!selection) return ws;
  return change(ws, { selections: ws.selections.filter((s) => s.id !== id) }, 'remove-selection', `Removed the selection "${selection.name}"`);
}

// The QC record with a field set (null or undefined: removed), null when nothing is left.
function qcWith(ws, key, value) {
  const next = { ...(ws.qc ?? {}) };
  if (value === null || value === undefined) delete next[key];
  else next[key] = value;
  return Object.keys(next).length ? next : null;
}

// Sets the QC thresholds (null: the defaults), with what changed in the history.
export function setQcThresholds(ws, thresholds, detail) {
  if (JSON.stringify(thresholds ?? null) === JSON.stringify(ws.qc?.thresholds ?? null)) return ws;
  return change(ws, { qc: qcWith(ws, 'thresholds', thresholds) }, 'qc', detail);
}

// Acknowledges a QC finding with a reason (wave 2, slice 8): { reason, status, value, time } kept
// by the finding's id, in the history. The finding keeps its status; the acknowledgement holds
// while it is no worse (findings.js). An empty reason withdraws it.
export function acknowledgeFinding(ws, finding, reason, time = clockNow()) {
  const text = String(reason ?? '').trim();
  const all = { ...(ws.qc?.acknowledged ?? {}) };
  if (!text) {
    if (!all[finding.id]) return ws;
    delete all[finding.id];
    return change(ws, { qc: qcWith(ws, 'acknowledged', Object.keys(all).length ? all : null) }, 'qc', `Withdrew the acknowledgement of "${finding.title}"`, time);
  }
  if (finding.blocking) throw new Error(`"${finding.title}" blocks the analysis and cannot be acknowledged: fix the table or the design.`);
  if (finding.status !== 'review' && finding.status !== 'fail') throw new Error(`"${finding.title}" is ${finding.status === 'pass' ? 'a pass' : 'not assessed'}: only a finding to review or failing is acknowledged.`);
  all[finding.id] = { reason: text, status: finding.status, value: finding.value, time };
  return change(ws, { qc: qcWith(ws, 'acknowledged', all) }, 'qc', `Acknowledged "${finding.title}" (${finding.status}): ${text}`, time);
}

// An acknowledgement as acknowledgeFinding made it (null: withdrawn), set by a finding's id: an
// agent's, accepted (lib/proposals.js). In the history, with detail.
export function setAcknowledgement(ws, id, entry, detail) {
  const all = { ...(ws.qc?.acknowledged ?? {}) };
  if (canonicalJSON(all[id] ?? null) === canonicalJSON(entry ?? null)) return ws;
  if (entry) all[id] = entry;
  else delete all[id];
  return change(ws, { qc: qcWith(ws, 'acknowledged', Object.keys(all).length ? all : null) }, 'qc', detail);
}

// Sets (or clears) the design, and the table it describes.
export function setDesign(ws, design, detail, sourceId = ws.designSource) {
  // A target's check against its entry (recordTargetCheck), and where its sequence came from (a
  // GenBank record, NCBI or Ensembl: origin, wave 3 slice 3), are the workspace's, never the
  // design's, even when the design takes its target from the workspace.
  if (design?.targets?.some((t) => t.reference || t.origin)) design = { ...design, targets: design.targets.map(({ reference, origin, ...t }) => t) };
  return change(ws, { design, designSource: design ? sourceId : null }, 'design', detail);
}

// Sets the MaveDB details (ws.deposit, absent until stated; lib/mavedb-export.js, DEPOSIT_FIELDS):
// the fields given replace the workspace's, an empty one removes it; the change is in the history,
// named by its fields.
export function setDeposit(ws, patch, detail = null) {
  const next = { ...(ws.deposit ?? {}) };
  const changed = [];
  for (const [key, value] of Object.entries(patch)) {
    const empty = value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length);
    if (canonicalJSON(next[key] ?? null) === canonicalJSON(empty ? null : value)) continue;
    changed.push(key);
    if (empty) delete next[key];
    else next[key] = value;
  }
  if (!changed.length) return ws;
  return change(ws, { deposit: Object.keys(next).length ? next : null }, 'deposit', detail ?? `MaveDB details: ${changed.join(', ')} ${changed.length === 1 ? 'was' : 'were'} changed`);
}

// --- Annotations and tracks (wave 3, slice 5) ------------------------------------------------------

// Adds an annotation (ws.annotations, absent until the first): { id, provider, name, file: {
// fileName, sha256, size }, record (the source: service, url, retrieved, release, license…),
// added }. Its file is kept in the library and the archive, so its tracks reopen offline.
export function addAnnotation(ws, annotation, detail = null) {
  const list = ws.annotations ?? [];
  const id = uniqueId(annotation.id ?? annotation.provider, list);
  const entry = { ...annotation, id };
  return { ws: change(ws, { annotations: [...list, entry] }, 'annotation', detail ?? `Added the annotation "${entry.name}"`), id };
}

export function removeAnnotation(ws, id) {
  const list = ws.annotations ?? [];
  const gone = list.find((a) => a.id === id);
  if (!gone) return ws;
  const rest = list.filter((a) => a.id !== id);
  // Its tracks leave the arrangement too.
  const prefix = `${id}:`;
  const layout = ws.tracks ? { ...ws.tracks, order: (ws.tracks.order ?? []).filter((t) => !t.startsWith(prefix)), hidden: (ws.tracks.hidden ?? []).filter((t) => !t.startsWith(prefix)), filters: Object.fromEntries(Object.entries(ws.tracks.filters ?? {}).filter(([t]) => !t.startsWith(prefix))) } : undefined;
  // The comparisons kept in the report that read it go with it (wave 6, slice 4).
  const read = new Set(analysesOf(ws, id).map((a) => a.id));
  const analyses = (ws.analyses ?? []).filter((a) => !read.has(a.id));
  return change(ws, { annotations: rest.length ? rest : undefined, ...(layout ? { tracks: layout } : {}), ...(read.size ? { analyses: analyses.length ? analyses : undefined } : {}) }, 'annotation', `Removed the annotation "${gone.name}"${read.size ? `, and from the report the ${read.size === 1 ? 'comparison' : `${read.size} comparisons`} reading it` : ''}`);
}

// What a higher score of a MaveDB score set kept beside the workspace means, as a person states it
// (wave 4, slice 3; MaveDB records none): its record's readout.direction ('higher-more',
// 'higher-less', 'unsigned'; null: not stated). In the history.
export function setScoreSetDirection(ws, id, direction) {
  const list = ws.annotations ?? [];
  const a = list.find((x) => x.id === id);
  if (!a?.record?.scoreSet) return ws;
  const current = a.record.scoreSet.readout?.direction ?? null;
  if ((direction ?? null) === current) return ws;
  const { readout, ...rest } = a.record.scoreSet;
  const scoreSet = direction ? { ...rest, readout: { ...(readout ?? {}), direction } } : rest;
  const next = { ...a, record: { ...a.record, scoreSet } };
  const words = { 'higher-more': 'a higher score means more of the function measured', 'higher-less': 'a higher score means less of the function measured', unsigned: 'the scores have no sign' };
  return change(ws, { annotations: list.map((x) => (x.id === id ? next : x)) }, 'annotation', `${a.name}: ${direction ? words[direction] ?? direction : 'what a higher score means not stated'}`);
}

// The arrangement of tracks (ws.tracks: { order, hidden, filters }; lib/tracks.js, arrangement): a
// view of the analysis, not a change to it, so not in the history.
export function setTrackLayout(ws, layout) {
  if (canonicalJSON(ws.tracks ?? null) === canonicalJSON(layout ?? null)) return ws;
  return change(ws, { tracks: layout ?? undefined });
}

// --- Structures and their saved views (wave 5, slice 5) ----------------------------------------------

// Saves a view of a structure (ws.structureViews), keeping the structure it shows (ws.structures,
// by its file's SHA-256; lib/structure-record.js describes both). A view saved under a name already
// used replaces that one. In the history. Returns { ws, id, structure }.
export function saveStructureView(ws, structure, view, time = clockNow()) {
  const structures = ws.structures ?? [];
  let entry = structures.find((s) => s.file.sha256 === structure.file.sha256);
  const nextStructures = entry ? structures : [...structures, (entry = { ...structure, id: uniqueId(structure.id ?? structure.name, structures), added: time })];
  const views = ws.structureViews ?? [];
  const old = views.find((v) => v.name === view.name);
  const id = old?.id ?? uniqueId(view.id ?? view.name, views);
  const record = { ...view, id, structure: entry.id, created: time };
  const nextViews = old ? views.map((v) => (v.id === id ? record : v)) : [...views, record];
  // A structure no view shows any longer (the view replaced showed another) is not kept.
  const shown = new Set(nextViews.map((v) => v.structure));
  const kept = nextStructures.filter((s) => shown.has(s.id));
  const detail = `${old ? 'Saved again' : 'Saved'} the view "${view.name}" of ${entry.name} (SHA-256 ${entry.file.sha256.slice(0, 12)}…${view.chain ? `; the target on chain ${view.chain}` : ''})`;
  return { ws: change(ws, { structures: kept, structureViews: nextViews }, 'structure-view', detail, time), id, structure: entry.id };
}

// Removes a saved view, and its structure when no other view shows it. In the history.
export function removeStructureView(ws, id) {
  const views = ws.structureViews ?? [];
  const gone = views.find((v) => v.id === id);
  if (!gone) return ws;
  const rest = views.filter((v) => v.id !== id);
  const shown = new Set(rest.map((v) => v.structure));
  const structures = (ws.structures ?? []).filter((s) => shown.has(s.id));
  return change(ws, { structureViews: rest.length ? rest : undefined, structures: structures.length ? structures : undefined }, 'structure-view', `Removed the view "${gone.name}"`);
}

// --- Figures (wave 6, slice 1) -----------------------------------------------------------------------

// Saves a figure (ws.figures; lib/figures.js), replacing the one with its id. detail: the change in
// words, for the history (a figure made or deleted, a panel added or removed: what the record
// reports); null for a change of layout only (a panel moved, resized, its text edited), which is
// saved and undoable but not in the history.
export function saveFigure(ws, figure, detail = null, time = clockNow()) {
  const list = ws.figures ?? [];
  const next = list.some((f) => f.id === figure.id) ? list.map((f) => (f.id === figure.id ? figure : f)) : [...list, figure];
  return change(ws, { figures: next }, detail ? 'figure' : null, detail, time);
}

export function removeFigure(ws, id) {
  const list = ws.figures ?? [];
  const gone = list.find((f) => f.id === id);
  if (!gone) return ws;
  const rest = list.filter((f) => f.id !== id);
  return change(ws, { figures: rest.length ? rest : undefined }, 'figure', `Deleted the figure "${gone.name}"`);
}

// --- The report (wave 6, slice 4) ---------------------------------------------------------------------

// Analyses kept in the report (ws.analyses, absent until one is kept): a comparison or a check of a
// run's robustness to analysis choices, recorded as it was made (lib/report.js: comparisonRecord,
// robustnessRecord), so that the report says it whenever it is written. Both are views of
// immutable runs, so what was recorded stays true. detail: the history's words.
export function keepAnalysis(ws, analysis, detail, time = clockNow()) {
  const list = ws.analyses ?? [];
  const id = uniqueId(analysis.kind, list);
  return { ws: change(ws, { analyses: [...list, { ...analysis, id, created: analysis.created ?? time }] }, 'report', detail, time), id };
}

export function removeAnalysis(ws, id, detail) {
  const list = ws.analyses ?? [];
  if (!list.some((a) => a.id === id)) return ws;
  const rest = list.filter((a) => a.id !== id);
  return change(ws, { analyses: rest.length ? rest : undefined }, 'report', detail);
}

// The analyses kept in the report that read a run or an annotation (by its id).
export function analysesOf(ws, id) {
  return (ws.analyses ?? []).filter((a) => a.run?.id === id || [a.a, a.b].some((side) => side?.spec?.run === id || side?.spec?.annotation === id));
}


// --- Checkpoints (wave 6, slice 5) ------------------------------------------------------------------------

// Keeps a checkpoint (lib/diff.js, makeCheckpoint: a named state of the analysis and the history's
// hash then) in ws.checkpoints, absent until the first, in the history.
export function addCheckpoint(ws, checkpoint, time = clockNow()) {
  const list = ws.checkpoints ?? [];
  const id = uniqueId(checkpoint.name ?? 'checkpoint', list);
  const entry = { ...checkpoint, id, created: checkpoint.created ?? time };
  return { ws: change(ws, { checkpoints: [...list, entry] }, 'checkpoint', `Checkpoint "${entry.name}": the analysis as it stood (state SHA-256 ${entry.sha256.slice(0, 12)}…)`, time), id };
}

export function removeCheckpoint(ws, id) {
  const list = ws.checkpoints ?? [];
  const gone = list.find((c) => c.id === id);
  if (!gone) return ws;
  const rest = list.filter((c) => c.id !== id);
  return change(ws, { checkpoints: rest.length ? rest : undefined }, 'checkpoint', `Deleted the checkpoint "${gone.name}"`);
}

// --- Control sets (wave 8, slice 1) -------------------------------------------------------------------------

// Keeps a control set (lib/controls.js: variants of known effect, each label as its source gives it)
// in ws.controlSets, absent until the first, in the history.
export function addControlSet(ws, set, time = clockNow()) {
  const list = ws.controlSets ?? [];
  const id = uniqueId(set.name ?? 'controls', list);
  const entry = { ...set, id, created: set.created ?? time };
  const sides = ['P', 'B'].map((side) => `${entry.labels.filter((l) => l.side === side).length} ${side}`).join(' and ');
  return { ws: change(ws, { controlSets: [...list, entry] }, 'controls', `Made the control set "${entry.name}" from ${entry.source.kind === 'clinvar' ? 'ClinVar' : `the table ${entry.source.file?.fileName ?? ''}`.trim()}: ${sides} controls`, time), id };
}

export function removeControlSet(ws, id) {
  const list = ws.controlSets ?? [];
  const gone = list.find((c) => c.id === id);
  if (!gone) return ws;
  const rest = list.filter((c) => c.id !== id);
  return change(ws, { controlSets: rest.length ? rest : undefined }, 'controls', `Deleted the control set "${gone.name}"`);
}

