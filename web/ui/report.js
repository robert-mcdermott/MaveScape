// The report in the window (wave 6, slice 4; requirement R4): the workspace's report written with
// what the window knows of each run (its QC findings, its scores recomputed: lib/report.js), and
// the analyses kept in it. A comparison or a robustness check is the session's until it is added
// to the report (Add to report, in the Compare view and the Score view's robustness pane); then the
// workspace keeps what it found, in its history, and the report says it.

import { h, icon } from './dom.js';
import { toast } from './overlays.js';
import { analysisName, comparisonRecord, keptWords, robustnessRecord, writeReport } from '../lib/report.js';
import { canonicalJSON, keepAnalysis, removeAnalysis } from '../lib/workspace.js';
import { ROBUSTNESS_SEED } from '../lib/robustness.js';
import { ensureResults } from './run-results.js';
import { qcOf } from './record.js';
import { calibrationWithLikelihood } from './calibration.js';

// What the report is written with: each run's QC findings and scores (null where they cannot be
// had: the run's table not in the workspace), and each calibration computed again (wave 8, slice
// 5), or why it could not be.
export async function reportContext(app) {
  const runs = new Map();
  for (const run of app.store.ws.runs) {
    const q = await qcOf(app, run).catch(() => null);
    const entry = await ensureResults(app, run).catch(() => null);
    runs.set(run.id, { findings: q?.findings ?? null, results: entry?.results ?? null });
  }
  const calibrations = new Map();
  for (const cal of app.store.ws.calibrations ?? []) calibrations.set(cal.id, await calibrationWithLikelihood(app, cal).catch((error) => ({ problem: error.message })));
  return { software: { version: app.version, commit: app.commit }, runs, calibrations };
}

export async function reportOf(app) {
  const ws = app.store.ws;
  const context = await reportContext(app);
  return writeReport(ws, context);
}

// --- Kept in the report ---------------------------------------------------------------------------------

const comparisonKey = (a) => canonicalJSON([a.a.spec, a.b.spec, a.scale.mode, a.filters]);
const robustnessKey = (a) => canonicalJSON([a.run.id, a.max, a.total]);
const keyOf = (a) => (a.kind === 'comparison' ? comparisonKey(a) : robustnessKey(a));

// The analysis kept like this one (the same sides, scale and filters; the same run and size), or null.
export function keptLike(ws, record) {
  return (ws.analyses ?? []).find((a) => a.kind === record.kind && keyOf(a) === keyOf(record)) ?? null;
}

// Keeps an analysis in the report: its id (the one already kept, when it is).
export function keepInReport(app, record) {
  const kept = keptLike(app.store.ws, record);
  if (kept) {
    toast(`${analysisName(record).replace(/^./, (c) => c.toUpperCase())} is already in the report.`);
    return kept.id;
  }
  const words = keptWords(record);
  const { ws, id } = keepAnalysis(app.store.ws, record, words);
  app.store.commit(ws, 'Add to report');
  app.log(words);
  toast(`Added to the report: ${analysisName(record)}.`, { kind: 'ok' });
  return id;
}

export const comparisonForReport = (c, pair) => comparisonRecord(c, pair);
export const robustnessForReport = (run, state) => robustnessRecord(run, state.summary, { max: state.max, seed: ROBUSTNESS_SEED });

export function removeFromReport(app, id) {
  const a = (app.store.ws.analyses ?? []).find((x) => x.id === id);
  if (!a) return false;
  app.store.commit(removeAnalysis(app.store.ws, id, `Took ${analysisName(a)} out of the report`), 'Remove from report');
  return true;
}

// A button that adds an analysis to the report (make: () => its record), or says it is there.
export function reportButton(app, make, { small = true } = {}) {
  const record = make();
  const kept = keptLike(app.store.ws, record);
  return h(`button.btn${small ? '.small' : ''}`, {
    type: 'button',
    title: kept ? 'This is in the workspace\'s report (the Report view).' : 'Keep this in the workspace\'s report: its methods and what it found, in the record.',
    onclick: () => {
      if (kept) app.setMode('report');
      else keepInReport(app, record);
    },
  }, icon(kept ? 'check' : 'report'), kept ? 'In the report' : 'Add to report');
}
