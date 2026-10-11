// The sequence tracks' cases (wave 3, slice 5; the validation suite `annotations`): the
// annotations of the published examples' targets read from public data as MaveScape's fetcher
// cached them (validation/fixtures/public-data, offline, through cached-fetch.mjs), and the files a
// person may add (validation/fixtures/annotations), each against an outside reference.

import { readFileSync } from 'node:fs';
import { EXAMPLES } from '../web/lib/examples.js';
import { annotationTracks, providerById } from '../web/lib/providers/index.js';
import { targetProtein } from '../web/lib/target.js';
import { arrangeTracks, builtinTracks } from '../web/lib/tracks.js';
import { cachedGet } from './cached-fetch.mjs';

const fixtures = new URL('./fixtures/', import.meta.url);
export const fixture = (path) => readFileSync(new URL(path, fixtures), 'utf8');
export const reference = () => JSON.parse(readFileSync(new URL('./reference/annotations.json', import.meta.url), 'utf8'));

// An example's design target, as the providers read it: its protein, offset and length.
export function exampleContext(id) {
  const example = EXAMPLES.find((e) => e.id === id);
  const design = JSON.parse(readFileSync(new URL(`../web/${example.files.design}`, import.meta.url), 'utf8'));
  const target = design.targets[0];
  const protein = targetProtein(target).replace(/\*$/, '');
  return { target, protein, offset: target.offset ?? 0, length: protein.length };
}

// The public annotations of a target, fetched from the cached answers as the window adds them:
// [{ provider, got: { text, fileName, record }, read, asked }]. gene: the symbol, where the design
// names none.
export async function publicAnnotations(context, providers, { gene = null } = {}) {
  const target = gene ? { ...context.target, identifiers: { ...context.target.identifiers, gene } } : context.target;
  const out = [];
  for (const id of providers) {
    const provider = providerById(id);
    const get = cachedGet();
    const got = await provider.fetch(target, { ...context, target }, get);
    const annotation = { id, provider: id, name: `${provider.name}`, file: { fileName: got.fileName, sha256: null, size: got.text.length }, record: got.record };
    out.push({ provider: id, got, annotation, read: annotationTracks(annotation, got.text, { ...context, target }), asked: get.asked });
  }
  return out;
}

// A run's tracks as the window arranges them (ui/tracks.js, runTracks), made in Node from a
// workspace and its archive's files: the run's own and its annotations', for its map model.
export function nodeTracks(ws, run, model, files) {
  const target = run.inputs.design.targets[0];
  const context = { target, protein: model.protein, offset: model.target.offset ?? 0, length: model.length, origin: null, variants: null };
  const all = builtinTracks(model);
  for (const a of ws.annotations ?? []) {
    const bytes = files.get(a.file.sha256);
    if (bytes) all.push(...annotationTracks(a, new TextDecoder().decode(bytes), context).tracks);
  }
  return arrangeTracks(all, ws.tracks);
}
