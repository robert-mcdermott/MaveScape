// The workspace document: one immutable JSON value per analysis. Edits return a new value
// (store.commit records it for undo); nothing here mutates its argument.
//
// Wave 1, slice 1 defines the envelope. Later slices fill it: sources and targets (slice 3), the
// design and the hash-chained history (slice 4), score runs (slice 5), QC thresholds (slice 6),
// selections (slice 7). See mavescape-spec/conventions.md, "Workspace".

export const WORKSPACE_FORMAT = 'mavescape-workspace';
export const WORKSPACE_VERSION = 1;

function newId() {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `ws-${random.replace(/-/g, '').slice(0, 20)}`;
}

export function createWorkspace(name = 'Untitled workspace', options = {}) {
  const now = options.now ?? new Date().toISOString();
  return {
    format: WORKSPACE_FORMAT,
    version: WORKSPACE_VERSION,
    id: options.id ?? newId(),
    name,
    created: now,
    modified: now,
    // Imported tables (count sets, score sets) by SHA-256, with their import templates.
    sources: [],
    // Reference sequences and their identifiers.
    targets: [],
    // The experiment design (mavescape-design), once one is set.
    design: null,
    // Immutable score runs.
    runs: [],
    // Named sets of variants or positions.
    selections: [],
    // The log of material changes: [{ time, action, detail }].
    history: [],
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
  return { ...base, ...doc };
}

// The saved text. Keys keep their order, so saving an unchanged workspace writes the same bytes.
export function serializeWorkspace(ws) {
  return JSON.stringify(ws);
}

export function touch(ws, now = new Date().toISOString()) {
  return { ...ws, modified: now };
}

export function rename(ws, name) {
  const trimmed = String(name).trim();
  if (!trimmed || trimmed === ws.name) return ws;
  return touch({ ...ws, name: trimmed });
}

// Whether a workspace holds anything worth saving (an empty, untitled one is not saved).
export function isEmptyWorkspace(ws) {
  return !ws.sources.length && !ws.targets.length && !ws.design && !ws.runs.length && !ws.selections.length;
}
