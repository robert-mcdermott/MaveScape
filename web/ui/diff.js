// Checkpoints and the diff in the window (wave 6, slice 5; requirement R6): a checkpoint kept from
// the Report view, the drawer's history or remote control; and what changed between two states of
// the analysis (a checkpoint, now, another checkpoint), with each latest run's scores recomputed in
// the score worker and its QC read with each state's thresholds (lib/diff.js).

import { addCheckpoint, removeCheckpoint } from '../lib/workspace.js';
import { analysisState, calibrationChangeWords, changeMap, diffStates, makeCheckpoint, pairWords, runPairs } from '../lib/diff.js';
import { buildMapModel } from '../lib/map-model.js';
import { ensureResults } from './run-results.js';
import { qcOf } from './record.js';
import { promptDialog, toast } from './overlays.js';
import { now } from '../lib/clock.js';
import { readArchive, sourceFiles } from '../lib/archive.js';

// Keeps a checkpoint of the analysis as it stands: its id.
export function keepCheckpoint(app, name) {
  const ws = app.store.ws;
  const text = String(name ?? '').trim() || `Checkpoint ${(ws.checkpoints ?? []).length + 1}`;
  const { ws: next, id } = addCheckpoint(ws, makeCheckpoint(ws, text, now()));
  app.store.commit(next, 'Checkpoint');
  app.log(`Checkpoint "${text}": the analysis as it stood.`);
  return id;
}

export async function askCheckpoint(app) {
  const name = await promptDialog({ title: 'Keep a checkpoint', label: 'Name', value: `Checkpoint ${(app.store.ws.checkpoints ?? []).length + 1}`, hint: 'A checkpoint keeps the analysis as it stands (targets, design, runs, QC thresholds, selections, annotations, structure views, figures), with the workspace and in its archive, to see later what changed since and what that did to the scores.' });
  if (name === null || name === undefined) return null;
  const id = keepCheckpoint(app, name);
  toast(`Checkpoint "${app.store.ws.checkpoints.find((c) => c.id === id).name}" kept.`, { kind: 'ok' });
  return id;
}

export function deleteCheckpoint(app, id) {
  const c = (app.store.ws.checkpoints ?? []).find((x) => x.id === id);
  if (!c) return false;
  app.store.commit(removeCheckpoint(app.store.ws, id), 'Delete checkpoint');
  return true;
}

// A state to compare: 'now', or a checkpoint by id: { id, label, created, state } or null.
export function stateOf(app, which) {
  if (!which || which === 'now') return { id: 'now', label: 'now', created: null, state: analysisState(app.store.ws) };
  const c = (app.store.ws.checkpoints ?? []).find((x) => x.id === which);
  return c ? { id: c.id, label: `"${c.name}"`, created: c.created, state: c.state } : null;
}

// What changed from one state to another, each latest run's scores recomputed (where its table is
// in the workspace, or, for a state read from an archive, the archive's: from.tableOf(run) → {
// source, target }) and its QC read with each state's thresholds: { from, to, diff, words, maps:
// [{ pair, model } | null] }.
export async function diffWith(app, from, to) {
  const pairs = [];
  for (const p of runPairs(from.state, to.state)) {
    const ta = from.tableOf?.(p.a) ?? null;
    const tb = to.tableOf?.(p.b) ?? null;
    const [ea, eb] = await Promise.all([ensureResults(app, p.a, ta).catch(() => null), ensureResults(app, p.b, tb).catch(() => null)]);
    const [qa, qb] = await Promise.all([qcOf(app, p.a, from.state.qc ?? null, ta).catch(() => null), qcOf(app, p.b, to.state.qc ?? null, tb).catch(() => null)]);
    pairs.push({ ...p, resultsA: ea?.results ?? null, resultsB: eb?.results ?? null, findingsA: qa?.findings ?? null, findingsB: qb?.findings ?? null });
  }
  const diff = diffStates(from.state, to.state, { pairs });
  const maps = diff.pairs.map((d) => {
    const p = pairs.find((x) => x.a.id === d.a.id && x.b.id === d.b.id);
    if (!p?.resultsA || !p.resultsB || d.a.id === d.b.id) return null;
    try {
      const spec = changeMap(p.a, p.resultsA, p.b, p.resultsB);
      return spec ? { pair: d, model: buildMapModel(spec.results, spec.design, { contrast: 0, colorBy: 'differential' }), results: spec.results } : null;
    } catch {
      return null;
    }
  });
  const words = [diff.summary, ...diff.changes.map((c) => c.text), ...diff.pairs.flatMap(pairWords), ...diff.calibrations.flatMap(calibrationChangeWords)];
  return { from, to, diff, words, maps };
}

// A state read from a workspace archive: { id, label, state, tableOf }, its tables put in the
// library (by their SHA-256, as opening the archive would) so that its runs can be scored again.
export async function archiveState(app, name, bytes) {
  const read = await readArchive(bytes);
  for (const s of read.ws.sources) {
    for (const f of sourceFiles(s)) {
      const data = read.sources.get(f.sha256);
      if (data && !(await app.library.getFile(f.sha256))) await app.library.putFile(f.sha256, data);
    }
  }
  const tableOf = (run) => {
    const source = read.ws.sources.find((s) => s.sha256 === run.inputs.source.sha256);
    return source && sourceFiles(source).every((f) => read.sources.has(f.sha256)) ? { source: { ...source, id: `archive:${source.sha256}` }, target: read.ws.targets.find((t) => t.id === source.target) } : null;
  };
  return { id: `archive:${name}`, label: name, created: read.ws.modified, state: analysisState(read.ws), tableOf, problems: read.problems, workspace: { id: read.ws.id, name: read.ws.name } };
}

