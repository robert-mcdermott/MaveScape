// Calibration in the record (wave 8, slice 5; validation suite `record`): factor IX's example with
// its ClinVar controls (at least one review star, missense; from the fetcher's cached answers) and
// a calibration of Run 1 made as the window makes one by default, in Node, for the report, the
// figures, the certificate, the diff and the MaveDB deposit to be checked on.

import { openExampleInNode } from './example-cases.mjs';
import { windowExample } from './certificate-cases.mjs';
import { exampleById } from '../web/lib/examples.js';
import { cachedGet } from './cached-fetch.mjs';
import { CLINVAR } from '../web/lib/providers/clinvar.js';
import { clinvarControls, makeControlSet } from '../web/lib/controls.js';
import { calibrationMetrics, scaleSide } from '../web/lib/calibration.js';
import { computeCalibration, scoredControls } from '../web/lib/calibration-record.js';
import { likelihoodSettings } from '../web/lib/likelihood.js';
import { addCalibration, addControlSet } from '../web/lib/workspace.js';
import { sha256 } from '../web/lib/sha256.js';

export const RECORD_SOFTWARE = { version: 'validation', commit: '' };
const encoder = new TextEncoder();

// The calibration the window makes of a run against a set with these settings (ui/calibration.js's
// makeCalibration): the side from the readout, the rule's thresholds, the bootstrap's samples and
// seed, the likelihood setting. Returns { ws, id, cal }.
export function calibrateInNode(ws, set, run, results, { name = null, side = 'auto', rule = 'error', error = 0.05, abnormal = null, normal = null, samples = 2000, seed = 20261009, prior = null, pejaver = false, condition = 0, time = '2026-10-12T12:35:00.000Z' } = {}) {
  const scored = scoredControls(set, run, results, condition);
  const where = scaleSide(side, run.inputs.design, scored.P, scored.B);
  const metrics = calibrationMetrics(scored.P, scored.B, { side: where.side, rule, error, abnormal, normal, samples, seed });
  const cal = {
    name: name ?? `${run.name} · ${set.name}`, controlSet: set.id, run: run.id, condition,
    side: where.side, sideFrom: where.from, rule, ...(rule === 'error' ? { error } : {}),
    thresholds: { abnormal: metrics.thresholds.abnormal, normal: metrics.thresholds.normal },
    bootstrap: { samples, seed }, likelihood: likelihoodSettings({ prior, pejaver }), n: metrics.n,
  };
  const made = addCalibration(ws, cal, `${run.name} against "${set.name}": ${metrics.n.P} P and ${metrics.n.B} B controls scored, AUC ${metrics.auc.auc.toPrecision(3)}`, time);
  return { ws: made.ws, id: made.id, cal: made.ws.calibrations.find((c) => c.id === made.id) };
}

// Factor IX's example opened as the window opens it and scored (Run 1; certificate-cases.mjs's
// windowExample), its ClinVar controls made a set, and Run 1 calibrated against them with the
// defaults. Returns { ws, files (Map(sha256 → bytes): its table), run, results, set, cal, text
// (ClinVar's answer) }.
export async function factor9Calibrated() {
  const { ws: opened, files } = windowExample('factor9');
  const f9 = openExampleInNode(exampleById('factor9'));
  const results = f9.scored.results;
  const run = opened.runs[0];
  const design = run.inputs.design;
  const target = { ...design.targets[0], identifiers: { ...(design.targets[0].identifiers ?? {}), gene: 'F9' } };
  const answer = await CLINVAR.fetch(target, {}, cachedGet());
  const read = clinvarControls(answer.text, target, { minStars: 1, kinds: ['missense'] });
  const source = { kind: 'clinvar', annotation: null, file: { sha256: sha256(encoder.encode(answer.text)) }, retrieved: answer.retrieval?.retrieved ?? null, transcript: read.transcript };
  const added = addControlSet(opened, makeControlSet({ name: 'ClinVar, ★ or more', source, rules: { minStars: 1, kinds: ['missense'] }, read }), '2026-10-12T12:30:00.000Z');
  const set = added.ws.controlSets.find((c) => c.id === added.id);
  const calibrated = calibrateInNode(added.ws, set, run, results);
  return { ws: calibrated.ws, files, run, results, set, cal: calibrated.cal, text: answer.text };
}

// Every calibration of a workspace computed again from its runs' results (Map(run id → results)):
// Map(calibration id → outcome).
export function outcomesOf(ws, results, options = {}) {
  return new Map((ws.calibrations ?? []).map((cal) => [cal.id, computeCalibration(ws, cal, results.get(cal.run), options)]));
}
