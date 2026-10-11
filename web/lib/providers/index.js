// Annotation providers behind one interface (wave 3, slice 5; requirement I3). Each provider turns
// a source of annotations into tracks (lib/tracks.js) for the map: public data through MaveScape's
// fetcher (docs/NETWORK.md), or a file the person opens. A provider is
//
//   { id, name, kind: 'public' | 'file', service, what, license, cite: [reference keys],
//     needs(target, context) → null, or why it cannot serve this target,
//     fetch(target, context, get) → { text, fileName, record } (public: asks the fetcher through
//       get(path, { as }) → { ok, json | text, retrieval, message }; the answer is reduced to the
//       text kept with the workspace, so the tracks reopen from it offline),
//     accepts(fileName, text) → bool (file),
//     read(text, context) → { tracks, notes, problem } }
//
// context: { target (the design's), protein (its residues), offset, length, origin (a MaveDB
// record's: { urn }), variants (the run's names → { key, position }: for annotations named as a
// score set names its variants), record (the annotation's record), id (the annotation's) }.
// read is pure and the same for what fetch returned and what the archive gave back.

import { UNIPROT_FEATURES } from './uniprot-features.js';
import { PDBE_CONSERVATION } from './pdbe.js';
import { ALPHAMISSENSE } from './alphamissense.js';
import { CLINVAR } from './clinvar.js';
import { GNOMAD } from './gnomad.js';
import { MAVEDB_ANNOTATIONS } from './mavedb.js';
import { MAVEDB_SCORES } from './mavedb-scores.js';
import { ALIGNMENT } from './alignment.js';
import { PREDICTOR } from './predictors.js';
import { CUSTOM } from './custom.js';

export const PROVIDERS = [UNIPROT_FEATURES, PDBE_CONSERVATION, ALPHAMISSENSE, CLINVAR, GNOMAD, MAVEDB_ANNOTATIONS, MAVEDB_SCORES, ALIGNMENT, PREDICTOR, CUSTOM];

export function providerById(id) {
  return PROVIDERS.find((p) => p.id === id) ?? null;
}

// The file providers that take a file, most specific first: an alignment, a predictor's table, a
// custom track.
export function providerForFile(fileName, text) {
  for (const p of [ALIGNMENT, PREDICTOR, CUSTOM]) if (p.accepts(fileName, text)) return p;
  return null;
}

// The tracks of an annotation kept in a workspace (ws.annotations[]), from its kept text: each
// track's id prefixed by the annotation's, with its source.
export function annotationTracks(annotation, text, context) {
  const provider = providerById(annotation.provider);
  if (!provider) return { tracks: [], notes: [], problem: `MaveScape does not know the provider "${annotation.provider}".` };
  let read;
  try {
    read = provider.read(text, { ...context, record: annotation.record, id: annotation.id });
  } catch (error) {
    return { tracks: [], notes: [], problem: `${annotation.name}: ${error.message}` };
  }
  const source = sourceOf(annotation, provider);
  const tracks = (read.tracks ?? []).map((t) => ({ ...t, id: `${annotation.id}:${t.part}`, annotation: annotation.id, provider: provider.id, source }));
  return { tracks, notes: read.notes ?? [], problem: read.problem ?? null };
}

// The source a track names: the service, release, retrieval date and address, or the file.
export function sourceOf(annotation, provider = providerById(annotation.provider)) {
  const r = annotation.record ?? {};
  return {
    service: r.service ?? provider?.service ?? annotation.provider,
    release: r.release ?? null,
    retrieved: r.retrieved ?? null,
    url: r.url ?? null,
    file: provider?.kind === 'file' ? annotation.file?.fileName ?? null : null,
    license: r.license ?? provider?.license ?? null,
  };
}
