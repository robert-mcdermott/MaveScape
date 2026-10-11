// The sequence tracks' cases (wave 3, slice 5; the validation suite `annotations`): the
// annotations of the published examples' targets read from public data as MaveScape's fetcher
// cached them (validation/fixtures/public-data, offline, through cached-fetch.mjs), and the files a
// person may add (validation/fixtures/annotations), each against an outside reference.

import { readFileSync } from 'node:fs';
import { EXAMPLES } from '../web/lib/examples.js';
import { annotationTracks, providerById } from '../web/lib/providers/index.js';
import { targetProtein } from '../web/lib/target.js';
import { arrangeTracks, builtinTracks, trackTarget } from '../web/lib/tracks.js';
import { cellText } from '../web/lib/csv.js';
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
// With the run's own results and table (its scores, not drawn at the protein level), a run of a
// MaveDB record's table also gives the record's URN and its variants by name, key and MaveDB
// accession, as the window gives MaveDB's annotations (ui/tracks.js, contextOf).
export function nodeTracks(ws, run, model, files, { results = null, table = null } = {}) {
  const target = trackTarget(run.inputs.design.targets[0], ws.targets);
  const source = ws.sources.find((s) => s.sha256 === run.inputs.source.sha256);
  const origin = source?.origin?.database === 'MaveDB' && source.origin.urn ? { urn: source.origin.urn } : null;
  let variants = null;
  if (origin && results) {
    variants = new Map();
    const v = results.variants;
    const single = (key) => /^p\.[A-Z][a-z]{2}\d+([A-Z][a-z]{2}|=)$/.test(key ?? '');
    const column = table?.columns.find((c) => c.name === 'accession');
    const accession = column && table.rows === results.rows ? (i) => cellText(column, i) : null;
    for (let i = 0; i < results.rows; i += 1) {
      const key = v.proKey ? v.proKey[i] : v.key[i];
      const item = { key: single(key) ? key : null, position: v.proPosition ? v.proPosition[i] : v.position[i] };
      variants.set(v.original[i], item);
      variants.set(v.key[i], item);
      if (accession) variants.set(accession(i), item);
    }
  }
  const context = { target, protein: model.protein, offset: model.target.offset ?? 0, length: model.length, origin, variants };
  const all = builtinTracks(model);
  for (const a of ws.annotations ?? []) {
    const bytes = files.get(a.file.sha256);
    if (bytes) all.push(...annotationTracks(a, new TextDecoder().decode(bytes), context).tracks);
  }
  return arrangeTracks(all, ws.tracks);
}
