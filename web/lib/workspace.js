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

// The history fields of ws with an entry appended: { history, historyAnchor? }.
export function appendHistory(ws, action, detail, time = clockNow()) {
  const history = ws.history ?? [];
  const previous = history.length ? history[history.length - 1].hash : ws.historyAnchor ?? '';
  const all = [...history, chained(previous, { time, action, detail })];
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
    history: [chained('', { time: now, action: 'create', detail: `Created the workspace "${name}"` })],
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
  return !ws.sources.length && !ws.targets.length && !ws.design && !ws.runs.length && !ws.selections.length;
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

// Sets the QC thresholds (null: the defaults), with what changed in the history.
export function setQcThresholds(ws, thresholds, detail) {
  if (JSON.stringify(thresholds ?? null) === JSON.stringify(ws.qc?.thresholds ?? null)) return ws;
  return change(ws, { qc: thresholds ? { ...(ws.qc ?? {}), thresholds } : null }, 'qc', detail);
}

// Sets (or clears) the design, and the table it describes.
export function setDesign(ws, design, detail, sourceId = ws.designSource) {
  return change(ws, { design, designSource: design ? sourceId : null }, 'design', detail);
}
