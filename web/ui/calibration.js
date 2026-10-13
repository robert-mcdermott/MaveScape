// Calibrations in the window (wave 8, slice 2): made from a control set and a run when asked, kept
// with the workspace, deleted; and each one's metrics (lib/calibration.js), computed when shown and
// kept while the window is open; its score-level likelihood ratios (slice 4, lib/likelihood.js)
// apart, as they take a second. The Calibrate view (mode-calibrate.js), the inspector and remote
// control (remote.js) use these.

import { addCalibration, removeCalibration } from '../lib/workspace.js';
import { CALIBRATION_DEFAULTS, RULES, calibrationMetrics, publishedThresholds, scaleSide, threeFigures } from '../lib/calibration.js';
import { calibrationLikelihood, calibrationOutcome, calibrationSubjects, metricsOf, scoredControls as scoredOf, variantClasses } from '../lib/calibration-record.js';
import { recordOfRun } from '../lib/mavedb-export.js';
import { likelihoodSettings } from '../lib/likelihood.js';
import { ensureResults } from './run-results.js';

export { variantClasses };

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// The scored controls of a set in a run's condition (lib/calibration-record.js's scoredControls),
// the run's scores computed first when no view has needed them.
export async function scoredControls(app, set, run, condition = 0) {
  const entry = await ensureResults(app, run);
  if (!entry?.results) throw new Error(`${run.name}'s scores could not be computed: ${entry?.message ?? 'no results'}.`);
  return scoredOf(set, run, entry.results, condition);
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
  const likelihood = likelihoodSettings({ prior: number(given.prior, null), pejaver: given.pejaver === true || given.pejaver === 'true' });
  return { side, rule, error, abnormal: number(given.abnormal, null), normal: number(given.normal, null), samples, seed, condition, likelihood };
}

// Makes a calibration of a run against a control set (a request: nothing calibrates by itself).
// options: calibrationSettings's, and { set, run, name }. Returns { id, calibration, metrics, where }.
export async function makeCalibration(app, { set, run, name = null, published = null, ...given }) {
  // A published calibration's thresholds (slice 4), for a run of the record's own scores.
  let from = null;
  if (published) {
    const found = publishedCalibrationsOf(app.store.ws, run).find((c) => c.calibration.title === published);
    if (!found) throw new Error(`${run.name} has no published calibration "${published}": a record's calibrations are of its own scores, as published.`);
    if (!found.applies) throw new Error(`"${published}" is a calibration of the record's scores as published; ${run.name} scored its counts again, on a scale of its own.`);
    if (!found.thresholds) throw new Error(`"${published}" gives no abnormal and normal ranges on two sides of each other to take thresholds from.`);
    from = { urn: found.record.urn, title: published };
    Object.assign(given, { rule: 'given', side: found.thresholds.side, abnormal: found.thresholds.abnormal, normal: found.thresholds.normal });
  }
  const settings = calibrationSettings(given);
  const scored = await scoredControls(app, set, run, settings.condition);
  if (!scored.P.length || !scored.B.length) throw new Error(`${run.name} scores ${plural(scored.P.length, 'P control')} and ${plural(scored.B.length, 'B control')} of "${set.name}": calibration needs both sides scored.`);
  const where = scaleSide(settings.side, run.inputs.design, scored.P, scored.B);
  const metrics = calibrationMetrics(scored.P, scored.B, { ...settings, side: where.side });
  const conditionName = scored.condition ? ` (${scored.condition})` : '';
  const calibration = {
    name: name || `${run.name}${conditionName} · ${set.name}${from ? ` · ${from.title}` : ''}`,
    controlSet: set.id, run: run.id, condition: settings.condition,
    side: where.side, sideFrom: where.from, rule: settings.rule, ...(settings.rule === 'error' ? { error: settings.error } : {}),
    thresholds: { abnormal: metrics.thresholds.abnormal, normal: metrics.thresholds.normal },
    bootstrap: { samples: settings.samples, seed: settings.seed },
    likelihood: settings.likelihood,
    ...(from ? { published: from } : {}),
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
// results and the set do not change, and the bootstrap is seeded): lib/calibration-record.js's
// calibrationOutcome without the likelihood ratios ({ metrics, scored, where, set, run, differs
// (when the thresholds computed again are not those kept: never, unless MaveScape's computation
// changed since), warnings, limitations, classes }).
export async function calibrationReport(app, cal) {
  const ws = app.store.ws;
  const { set, run, problem } = calibrationSubjects(ws, cal);
  if (problem) throw new Error(problem);
  const key = keyOf(cal);
  if (!reports.has(key)) {
    reports.set(key, (async () => {
      const scored = await scoredControls(app, set, run, cal.condition ?? 0);
      return { metrics: metricsOf(cal, scored), scored, where: scaleSide(cal.side, run.inputs.design, scored.P, scored.B) };
    })());
    reports.get(key).catch(() => reports.delete(key));
  }
  const report = await reports.get(key);
  return calibrationOutcome(app.store.ws, cal, { set, run, scored: report.scored, metrics: report.metrics });
}

// --- Score-level likelihood ratios (slice 4) ----------------------------------------------------------

const likelihoods = new Map();

// A calibration's score-level likelihood ratios, as acmgscaler computes them with the calibration's
// seed and its likelihood settings (prior 0.1, c by acmgscaler's search, unless set): lib/
// calibration-record.js's calibrationLikelihood ({ result, rows, counts: { P, B, missense, all },
// settings } or { problem, settings }). Kept while the window is open.
export async function likelihoodReport(app, cal) {
  const key = JSON.stringify([cal.controlSet, cal.run, cal.condition, cal.bootstrap.seed, cal.likelihood ?? null]);
  if (!likelihoods.has(key)) {
    likelihoods.set(key, (async () => {
      const { set, run, problem } = calibrationSubjects(app.store.ws, cal);
      if (problem) throw new Error(problem);
      const scored = await scoredControls(app, set, run, cal.condition ?? 0);
      // Let the page draw what it has before the second this takes.
      await new Promise((resolve) => setTimeout(resolve, 0));
      return calibrationLikelihood(cal, set, scored);
    })());
    likelihoods.get(key).catch(() => likelihoods.delete(key));
    while (likelihoods.size > 12) likelihoods.delete(likelihoods.keys().next().value);
  }
  return likelihoods.get(key);
}

// A calibration with its likelihood ratios, as the report, figures and the deposit read it
// (calibrationOutcome's).
export async function calibrationWithLikelihood(app, cal) {
  const o = await calibrationReport(app, cal);
  return { ...o, likelihood: await likelihoodReport(app, cal) };
}

// --- Published calibrations (slice 4) ------------------------------------------------------------------

// The published calibrations of the record a run's table came from: [{ record, calibration,
// thresholds (publishedThresholds's, null where it gives none), applies (the run is the record's
// scores as published, the scale the calibration was made on) }].
export function publishedCalibrationsOf(ws, run) {
  const record = run ? recordOfRun(ws, run) : null;
  if (!record) return [];
  const applies = run.inputs.parameters?.model === 'published';
  return (record.calibrations ?? []).map((calibration) => ({ record, calibration, thresholds: publishedThresholds(calibration), applies }));
}
