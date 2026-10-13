// Calibrations in the window (wave 8, slice 2): made from a control set and a run when asked, kept
// with the workspace, deleted; and each one's metrics (lib/calibration.js), computed when shown and
// kept while the window is open; its score-level likelihood ratios (slice 4, lib/likelihood.js)
// apart, as they take a second. The Calibrate view (mode-calibrate.js), the inspector and remote
// control (remote.js) use these.

import { addCalibration, removeCalibration } from '../lib/workspace.js';
import { CALIBRATION_DEFAULTS, RULES, calibrationMetrics, classCounts, controlScores, publishedThresholds, scaleSide, threeFigures } from '../lib/calibration.js';
import { recordOfRun } from '../lib/mavedb-export.js';
import { matchControls } from '../lib/controls.js';
import { KIND } from '../lib/variants.js';
import { calibrateScores, EVIDENCE, likelihoodSettings, MIN_CONTROLS } from '../lib/likelihood.js';
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

// --- Score-level likelihood ratios (slice 4) ----------------------------------------------------------

// The rows acmgscaler is given for a calibration: every variant the run scores in the condition (its
// protein view; not the wild type), in the run's order, each control with its side, the others
// unlabeled. Returns { rows: [{ key, score, class, kind }] }.
export function likelihoodRows(set, match, condition = 0) {
  const view = match.view;
  const score = view.conditions[condition]?.score;
  const side = new Map();
  set.labels.forEach((l, k) => { if (match.rows[k] >= 0) side.set(match.rows[k], l.side); });
  const rows = [];
  for (let i = 0; i < view.rows; i += 1) {
    if (!Number.isFinite(score?.[i]) || view.variants.kind[i] === KIND.WT) continue;
    rows.push({ key: view.variants.key[i], score: score[i], class: side.get(i) ?? 'U', kind: view.variants.kind[i] });
  }
  return rows;
}

// Counts of rows by evidence: { evidence: n }, in EVIDENCE's order.
function evidenceCounts(rows, result, test) {
  const out = Object.fromEntries(EVIDENCE.map((e) => [e, 0]));
  rows.forEach((r, i) => { if (test(r) && result.rows[i]) out[result.rows[i].evidence] += 1; });
  return out;
}

const likelihoods = new Map();

// A calibration's score-level likelihood ratios, as acmgscaler computes them with the calibration's
// seed and its likelihood settings (prior 0.1, c by acmgscaler's search, unless set): { result
// (lib/likelihood.js's calibrateScores's), rows, counts: { P, B, missense, all }, settings } or {
// problem } with fewer than 10 controls a side. Kept while the window is open.
export async function likelihoodReport(app, cal) {
  const key = JSON.stringify([cal.controlSet, cal.run, cal.condition, cal.bootstrap.seed, cal.likelihood ?? null]);
  if (!likelihoods.has(key)) {
    likelihoods.set(key, (async () => {
      const ws = app.store.ws;
      const set = (ws.controlSets ?? []).find((c) => c.id === cal.controlSet);
      const run = ws.runs.find((r) => r.id === cal.run);
      if (!set || !run) throw new Error(`The calibration "${cal.name}" reads ${!set ? 'a control set' : 'a run'} the workspace no longer has.`);
      const scored = await scoredControls(app, set, run, cal.condition ?? 0);
      const settings = likelihoodSettings(cal.likelihood ?? {});
      if (scored.P.length < MIN_CONTROLS || scored.B.length < MIN_CONTROLS) return { problem: `Score-level likelihood ratios need at least ${MIN_CONTROLS} P and ${MIN_CONTROLS} B controls scored (acmgscaler's minimum): ${run.name} scores ${scored.P.length} P and ${scored.B.length} B of "${set.name}".`, settings };
      // Let the page draw what it has before the second this takes.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const rows = likelihoodRows(set, scored.match, cal.condition ?? 0);
      const result = calibrateScores(rows, { prior: settings.prior, pvst: settings.c, seed: cal.bootstrap.seed });
      if (result.problem) return { problem: result.problem, settings };
      return {
        result, rows, settings,
        counts: {
          P: evidenceCounts(rows, result, (r) => r.class === 'P'),
          B: evidenceCounts(rows, result, (r) => r.class === 'B'),
          missense: evidenceCounts(rows, result, (r) => r.kind === KIND.MISSENSE),
          all: evidenceCounts(rows, result, () => true),
        },
      };
    })());
    likelihoods.get(key).catch(() => likelihoods.delete(key));
    while (likelihoods.size > 12) likelihoods.delete(likelihoods.keys().next().value);
  }
  return likelihoods.get(key);
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
