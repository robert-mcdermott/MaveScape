// The calibration examples (wave 8, slice 6), made in Node as their guides make them in the window:
// BRCA1's, TP53's and PTEN's published scores opened from MaveDB (their record kept, the scores a run
// "Published scores"), with ClinVar's records of the gene as the example brings them
// (web/examples/clinvar/, the annotation ui/examples.js adds); their control sets from ClinVar by
// the guide's rules (lib/controls.js's clinvarControls on the annotation's text) and calibrations
// as Calibrate makes them (record-cases.mjs's calibrateInNode), a published calibration's thresholds
// where the guide takes them. And the simulated calibration, its labels a table of their own,
// against its truth. The suite `examples` checks the guides' numbers on them; the remote session
// compares the window's with them.

import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { cachedRecord, openExampleInNode } from './example-cases.mjs';
import { calibrateInNode } from './record-cases.mjs';
import { exampleById, simulatedExample } from '../web/lib/examples.js';
import { clinvarControls, makeControlSet, tableControls } from '../web/lib/controls.js';
import { computeCalibration } from '../web/lib/calibration-record.js';
import { publishedThresholds } from '../web/lib/calibration.js';
import { recordSummary } from '../web/lib/mavedb.js';
import { addAnnotation, addControlSet, change } from '../web/lib/workspace.js';
import { addRun, makeRun, runInputs } from '../web/lib/runs.js';
import { sha256 } from '../web/lib/sha256.js';

const encoder = new TextEncoder();
const SOFTWARE = { version: 'validation', commit: '' };
const at = (minute) => `2026-10-13T16:${String(minute).padStart(2, '0')}:00.000Z`;

// The examples' ClinVar records (snapshots.json): { GENE: { fileName, sha256, size, record } }.
export const CLINVAR_SNAPSHOTS = JSON.parse(readFileSync(new URL('../web/examples/clinvar/snapshots.json', import.meta.url), 'utf8'));

// A gene's ClinVar records as the example brings them: { text, bytes, sha256, entry }.
export function clinvarSnapshot(gene) {
  const bytes = new Uint8Array(gunzipSync(readFileSync(new URL(`../web/examples/clinvar/${gene}.csv.gz`, import.meta.url))));
  return { text: new TextDecoder().decode(bytes), bytes, sha256: sha256(bytes), entry: CLINVAR_SNAPSHOTS[gene] };
}

// The annotation the window adds for an example's ClinVar records (ui/examples.js's
// exampleAnnotations): as the ClinVar track keeps one fetched on the snapshot's day.
export function snapshotAnnotation(gene) {
  const e = CLINVAR_SNAPSHOTS[gene];
  return { provider: 'clinvar', name: `ClinVar: ${gene}`, file: { fileName: e.fileName, sha256: e.sha256, size: e.size }, record: e.record, added: e.record.retrieved };
}

// A calibration example opened as the window opens it: { example, o, ws, run, results, gene, text }.
export function calibrationExample(id) {
  const example = exampleById(id);
  const o = openExampleInNode(example);
  if (example.simulated) {
    const run = makeRun({ inputs: runInputs({ source: o.ws.sources[0], design: o.design, parameters: o.parameters }), source: o.ws.sources[0], results: o.scored.results, software: SOFTWARE, name: 'Run 1', created: at(0) });
    return { example, o, ws: addRun(o.ws, run).ws, run, results: o.scored.results, labels: o.sim.labels, truth: o.sim.truth };
  }
  const record = cachedRecord(example.mavedb.urn);
  const source = { ...o.ws.sources[0], sha256: sha256(o.parts[0].bytes) };
  let ws = change({ ...o.ws, sources: [source] }, { records: [recordSummary(record)] }, 'mavedb', `Opened ${example.mavedb.urn}`);
  const run = makeRun({ inputs: runInputs({ source, design: o.design, parameters: o.parameters }), source, results: o.scored.results, software: SOFTWARE, name: 'Published scores', created: at(0) });
  ws = addRun(ws, run).ws;
  const snap = clinvarSnapshot(example.clinvar);
  ws = addAnnotation(ws, snapshotAnnotation(example.clinvar)).ws;
  return { example, o, ws, run, results: o.scored.results, gene: example.clinvar, text: snap.text, record };
}

// A control set as Calibrate makes it: from the example's ClinVar records (rules: minStars, kinds,
// evaluatedBefore), or from its simulated labels (table: true). Returns { state (ws updated), set,
// read }.
export function controlSetOf(state, rules = {}, { name = null, table = false, minute = 1 } = {}) {
  const target = state.ws.design.targets[0];
  let set;
  let read;
  if (table) {
    read = tableControls(state.labels.text, target, rules);
    const bytes = encoder.encode(state.labels.text);
    const before = Number.isInteger(rules.evaluatedBefore) ? `, before ${rules.evaluatedBefore}` : '';
    set = makeControlSet({ name: name ?? `simulated-labels${before}`, source: { kind: 'table', file: { fileName: state.labels.name, sha256: sha256(bytes), size: bytes.length }, numbering: read.numbering }, rules: { kinds: rules.kinds ?? ['missense', 'nonsense', 'synonymous'], ...(Number.isInteger(rules.evaluatedBefore) ? { evaluatedBefore: rules.evaluatedBefore } : {}) }, read });
  } else {
    const r = { minStars: rules.minStars ?? 1, kinds: rules.kinds ?? ['missense'], ...(Number.isInteger(rules.evaluatedBefore) ? { evaluatedBefore: rules.evaluatedBefore } : {}) };
    read = clinvarControls(state.text, target, r);
    const annotation = state.ws.annotations.find((a) => a.provider === 'clinvar');
    const stars = r.minStars === 0 ? 'any review' : `${'★'.repeat(r.minStars)} or more`;
    set = makeControlSet({ name: name ?? `ClinVar, ${stars}${r.evaluatedBefore ? `, before ${r.evaluatedBefore}` : ''}`, source: { kind: 'clinvar', annotation: annotation.id, file: { sha256: annotation.file.sha256 }, retrieved: annotation.record.retrieved, transcript: read.transcript }, rules: r, read });
  }
  const added = addControlSet(state.ws, set, at(minute));
  return { state: { ...state, ws: added.ws }, set: added.ws.controlSets.find((c) => c.id === added.id), read };
}

// A calibration as Calibrate makes it (the defaults, or settings), or with a published
// calibration's thresholds (published: its title). Returns { state, cal, outcome }.
export function calibrationOf(state, set, { published = null, minute = 2, likelihood = true, ...settings } = {}) {
  let given = settings;
  let from = null;
  if (published) {
    const calibration = state.record.calibrations.find((c) => c.title === published);
    const t = publishedThresholds(calibration);
    given = { ...settings, rule: 'given', side: t.side, abnormal: t.abnormal, normal: t.normal };
    from = { urn: state.example.mavedb.urn, title: published };
  }
  const made = calibrateInNode(state.ws, set, state.run, state.results, { ...given, name: `${state.run.name} · ${set.name}${from ? ` · ${from.title}` : ''}`, time: at(minute) });
  let { ws, cal } = made;
  if (from) {
    ws = { ...ws, calibrations: ws.calibrations.map((c) => (c.id === cal.id ? { ...c, published: from } : c)) };
    cal = ws.calibrations.find((c) => c.id === made.id);
  }
  return { state: { ...state, ws }, cal, outcome: computeCalibration(ws, cal, state.results, { likelihood }) };
}

// The simulated calibration's example opened, ready for its labels.
export const simulatedCalibration = () => calibrationExample('simulated-calibration');

// The simulated example's files (its labels among them).
export const simulatedFiles = () => simulatedExample(exampleById('simulated-calibration'));
