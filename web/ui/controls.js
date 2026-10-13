// Control sets in the window (wave 8, slice 1): made from the ClinVar annotation beside the map or
// from a table of labels, kept with the workspace, deleted; and what a set is for a run (its
// composition, what of it the run measured, what may make it circular). The Calibrate view
// (mode-calibrate.js) and remote control (remote.js) use these.

import { addControlSet, removeControlSet } from '../lib/workspace.js';
import { circularity, clinvarControls, composition, makeControlSet, matchControls, tableControls } from '../lib/controls.js';
import { trackTarget } from '../lib/tracks.js';
import { sha256 } from '../lib/sha256.js';
import { annotationText } from './tracks.js';
import { ensureResults } from './run-results.js';

const encoder = new TextEncoder();

// The target a set is placed on: the run's design's (else the workspace's), with the identifiers
// the workspace's targets have since gained (a UniProt check), as the tracks place ClinVar's.
export function controlTarget(ws, run = null) {
  const design = run?.inputs.design ?? ws.design;
  const target = trackTarget(design?.targets?.[0] ?? null, ws.targets);
  if (!target) throw new Error('A control set is placed on the design\'s target: describe the experiment first (Experiment).');
  return target;
}

export const clinvarAnnotation = (ws) => (ws.annotations ?? []).find((a) => a.provider === 'clinvar') ?? null;

// The year a set's classifications must have been last evaluated before: a whole number, or null.
export function evaluatedBeforeOf(value) {
  if (value === undefined || value === null || value === '') return null;
  const year = Number(value);
  if (!Number.isInteger(year) || year < 1900 || year > 2100) throw new Error(`"Last evaluated before" is a year, such as 2018, not "${value}".`);
  return year;
}

// A control set made from the ClinVar annotation's records. options: { name, minStars, kinds,
// evaluatedBefore (a year), run }. Returns { id, set, read } (read: clinvarControls's, with what was
// left out and why).
export async function makeClinVarControls(app, { name = null, minStars = 1, kinds = ['missense'], evaluatedBefore = null, run = null } = {}) {
  const ws = app.store.ws;
  const annotation = clinvarAnnotation(ws);
  if (!annotation) throw new Error('ClinVar\'s records of the gene are not beside the map: add the ClinVar track first (Map, Tracks).');
  const before = evaluatedBeforeOf(evaluatedBefore);
  const rules = { minStars, kinds, ...(before ? { evaluatedBefore: before } : {}) };
  const read = clinvarControls(await annotationText(app, annotation), controlTarget(ws, run), rules);
  if (read.problem) throw new Error(read.problem);
  if (!read.labels.length) throw new Error(`None of ClinVar's ${read.records} records of the gene is a control with these rules (at least ${minStars} review star${minStars === 1 ? '' : 's'}; ${kinds.join(', ')}${before ? `; last evaluated before ${before}` : ''}): ${Object.entries(read.excluded).map(([why, n]) => `${n} ${why}`).join(', ')}.`);
  const source = { kind: 'clinvar', annotation: annotation.id, file: { sha256: annotation.file.sha256 }, retrieved: annotation.record?.retrieved ?? null, transcript: read.transcript };
  const set = makeControlSet({ name: name || `ClinVar, ${minStars === 0 ? 'any review' : `${'★'.repeat(minStars)} or more`}${before ? `, before ${before}` : ''}`, source, rules, read });
  const made = addControlSet(app.store.ws, set);
  app.store.commit(made.ws, 'Make a control set');
  return { id: made.id, set: made.ws.controlSets.find((c) => c.id === made.id), read };
}

// A control set made from a table of labels. options: { name, fileName, text, citation, numbering,
// kinds, evaluatedBefore (a year: the table's dates), run }.
export function makeTableControls(app, { name = null, fileName, text, citation = null, numbering = null, kinds = undefined, evaluatedBefore = null, run = null }) {
  const ws = app.store.ws;
  const bytes = encoder.encode(String(text));
  const before = evaluatedBeforeOf(evaluatedBefore);
  const read = tableControls(text, controlTarget(ws, run), { numbering, kinds, ...(before ? { evaluatedBefore: before } : {}) });
  if (read.problem) throw new Error(`${fileName}: ${read.problem}`);
  if (before && !read.dated) throw new Error(`${fileName} has no column of the dates its labels were last evaluated (last_evaluated): "Last evaluated before" needs one.`);
  if (!read.labels.length) throw new Error(`${fileName}: none of its ${read.rows} rows is a control on the target: ${Object.entries(read.excluded).map(([why, n]) => `${n} ${why}`).join(', ') || 'no labels'}.`);
  const source = { kind: 'table', file: { fileName, sha256: sha256(bytes), size: bytes.length }, ...(citation ? { citation } : {}), numbering: read.numbering };
  const set = makeControlSet({ name: name || `${fileName.replace(/\.[^.]+$/, '')}${before ? `, before ${before}` : ''}`, source, rules: { kinds: kinds ?? ['missense', 'nonsense', 'synonymous'], ...(before ? { evaluatedBefore: before } : {}) }, read });
  const made = addControlSet(app.store.ws, set);
  app.store.commit(made.ws, 'Make a control set');
  return { id: made.id, set: made.ws.controlSets.find((c) => c.id === made.id), read };
}

export function deleteControlSet(app, id) {
  app.store.commit(removeControlSet(app.store.ws, id), 'Delete a control set');
}

// A set for a run: { composition, match, warnings } (the run's results computed when not at hand).
export async function controlsForRun(app, set, run, condition = 0) {
  const entry = await ensureResults(app, run);
  if (!entry?.results) throw new Error(`${run.name}'s scores could not be computed: ${entry?.message ?? 'no results'}.`);
  const match = matchControls(set, entry.results, condition);
  return { composition: composition(set), match, warnings: circularity(set, { ws: app.store.ws, run, matched: match }) };
}

// A label in its source's words, attributed: "ClinVar: Likely pathogenic ★★", "kras.csv: abnormal".
export function attributed(set, label) {
  if (set.source.kind === 'clinvar') return `ClinVar: ${label.label}${Number.isInteger(label.stars) ? ` ${'★'.repeat(label.stars)}${'☆'.repeat(4 - label.stars)}` : ''}`;
  return `${set.source.citation ?? set.source.file?.fileName ?? 'table'}: ${label.label}`;
}
