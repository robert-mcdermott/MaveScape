// Calibrations in the window (wave 8, slice 2): made from a control set and a run when asked, kept
// with the workspace, deleted; and each one's metrics (lib/calibration.js), computed when shown and
// kept while the window is open. The Calibrate view (mode-calibrate.js), the inspector and remote
// control (remote.js) use these.

import { addCalibration, removeCalibration } from '../lib/workspace.js';
import { CALIBRATION_DEFAULTS, RULES, calibrationMetrics, classCounts, controlScores, scaleSide, threeFigures } from '../lib/calibration.js';
import { matchControls } from '../lib/controls.js';
import { KIND } from '../lib/variants.js';
import { ensureResults } from './run-results.js';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// The scored controls of a set in a run's condition: { P, B (their scores), keys: { P, B }, match,
// view (the results the match indexes: a nucleotide run's protein view), condition (its name, when
// the run has more than one) }.
export async function scoredControls(app, set, run, condition = 0) {
  const entry = await ensureResults(app, run);
  if (!entry?.results) throw new Error(`${run.name}'s scores could not be computed: ${entry?.message ?? 'no results'}.`);
  if (!entry.results.conditions[condition]) throw new Error(`${run.name} has no condition ${condition + 1}.`);
  const match = matchControls(set, entry.results, condition);
  const s = controlScores(set, match, condition);
  return { P: s.P.scores, B: s.B.scores, keys: { P: s.P.keys, B: s.B.keys }, match, view: match.view, condition: entry.results.conditions.length > 1 ? entry.results.conditions[condition].name : null };
}

// The run's scored variants (its protein view) by kind and class: { missense, nonsense, synonymous,
// all } each classCounts's.
export function variantClasses(view, condition, side, thresholds) {
  const score = view.conditions[condition]?.score;
  const kinds = { missense: KIND.MISSENSE, nonsense: KIND.NONSENSE, synonymous: KIND.SYNONYMOUS };
  const values = { missense: [], nonsense: [], synonymous: [], all: [] };
  for (let i = 0; i < view.rows; i += 1) {
    if (!Number.isFinite(score?.[i])) continue;
    const k = view.variants.kind[i];
    if (k === KIND.WT) continue;
    values.all.push(score[i]);
    for (const [name, kind] of Object.entries(kinds)) if (k === kind) values[name].push(score[i]);
  }
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { ...classCounts(v, side, thresholds), values: v }]));
}

// The settings a calibration is made with, checked, from what a form or an agent gives:
// { side ('auto' | 'below' | 'above'), rule, error, abnormal, normal, samples, seed, condition }.
export function calibrationSettings(given = {}) {
  const d = CALIBRATION_DEFAULTS;
  const rule = given.rule ?? d.rule;
  if (!RULES.includes(rule)) throw new Error(`Thresholds are set by ${RULES.join(', ')}, not "${rule}".`);
  const side = given.side ?? 'auto';
  if (!['auto', 'below', 'above'].includes(side)) throw new Error(`Abnormal-like scores are below or above the others (or auto: the readout's side, else the controls'), not "${side}".`);
  const number = (v, fallback) => (v === undefined || v === null || v === '' ? fallback : Number(v));
  const error = number(given.error, d.error);
  const samples = number(given.samples, d.samples);
  const seed = number(given.seed, d.seed);
  if (!Number.isInteger(seed)) throw new Error('The seed is a whole number.');
  const condition = number(given.condition, 0);
  if (!Number.isInteger(condition) || condition < 0) throw new Error('The condition is a run\'s condition, counted from 0.');
  return { side, rule, error, abnormal: number(given.abnormal, null), normal: number(given.normal, null), samples, seed, condition };
}

// Makes a calibration of a run against a control set (a request: nothing calibrates by itself).
// options: calibrationSettings's, and { set, run, name }. Returns { id, calibration, metrics, where }.
export async function makeCalibration(app, { set, run, name = null, ...given }) {
  const settings = calibrationSettings(given);
  const scored = await scoredControls(app, set, run, settings.condition);
  if (!scored.P.length || !scored.B.length) throw new Error(`${run.name} scores ${plural(scored.P.length, 'P control')} and ${plural(scored.B.length, 'B control')} of "${set.name}": calibration needs both sides scored.`);
  const where = scaleSide(settings.side, run.inputs.design, scored.P, scored.B);
  const metrics = calibrationMetrics(scored.P, scored.B, { ...settings, side: where.side });
  const conditionName = scored.condition ? ` (${scored.condition})` : '';
  const calibration = {
    name: name || `${run.name}${conditionName} · ${set.name}`,
    controlSet: set.id, run: run.id, condition: settings.condition,
    side: where.side, sideFrom: where.from, rule: settings.rule, ...(settings.rule === 'error' ? { error: settings.error } : {}),
    thresholds: { abnormal: metrics.thresholds.abnormal, normal: metrics.thresholds.normal },
    bootstrap: { samples: settings.samples, seed: settings.seed },
    n: metrics.n,
  };
  const detail = `${run.name}${conditionName} against "${set.name}": ${plural(metrics.n.P, 'P control')} and ${plural(metrics.n.B, 'B control')} scored, AUC ${threeFigures(metrics.auc.auc)}`;
  const made = addCalibration(app.store.ws, calibration, detail);
  app.store.commit(made.ws, 'Calibrate');
  const kept = (app.store.ws.calibrations ?? []).find((c) => c.id === made.id) ?? made.ws.calibrations.find((c) => c.id === made.id);
  remember(kept, { metrics, scored, where });
  return { id: made.id, calibration: kept, metrics, where };
}

export function deleteCalibration(app, id) {
  app.store.commit(removeCalibration(app.store.ws, id), 'Delete a calibration');
}

// Each calibration's metrics while the window is open, by what it was made with.
const reports = new Map();
const keyOf = (c) => JSON.stringify([c.controlSet, c.run, c.condition, c.side, c.rule, c.error ?? null, c.thresholds, c.bootstrap]);
function remember(cal, report) {
  reports.set(keyOf(cal), Promise.resolve(report));
  while (reports.size > 24) reports.delete(reports.keys().next().value);
}

// A kept calibration's metrics, computed again from its run and control set (the same: the run's
// results and the set do not change, and the bootstrap is seeded): { metrics, scored, where, set,
// run, differs (when the thresholds computed again are not those kept: never, unless MaveScape's
// computation changed since) }.
export async function calibrationReport(app, cal) {
  const ws = app.store.ws;
  const set = (ws.controlSets ?? []).find((c) => c.id === cal.controlSet);
  const run = ws.runs.find((r) => r.id === cal.run);
  if (!set || !run) throw new Error(`The calibration "${cal.name}" reads ${!set ? 'a control set' : 'a run'} the workspace no longer has.`);
  const key = keyOf(cal);
  if (!reports.has(key)) {
    reports.set(key, (async () => {
      const scored = await scoredControls(app, set, run, cal.condition ?? 0);
      const metrics = calibrationMetrics(scored.P, scored.B, { side: cal.side, rule: cal.rule, error: cal.error, abnormal: cal.thresholds.abnormal, normal: cal.thresholds.normal, samples: cal.bootstrap.samples, seed: cal.bootstrap.seed });
      return { metrics, scored, where: scaleSide(cal.side, run.inputs.design, scored.P, scored.B) };
    })());
    reports.get(key).catch(() => reports.delete(key));
  }
  const report = await reports.get(key);
  const same = (a, b) => (a === null && b === null) || Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(b));
  const differs = !same(report.metrics.thresholds.abnormal, cal.thresholds.abnormal) || !same(report.metrics.thresholds.normal, cal.thresholds.normal);
  return { ...report, set, run, differs };
}
