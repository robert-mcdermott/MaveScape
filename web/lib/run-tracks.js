// A run's tracks beside its map, from the workspace and the files it keeps: its own (reference,
// coverage, position effect, uncertainty) and its annotations' (lib/providers), as the window
// reads them (web/ui/tracks.js) and the certificate draws a figure's map panels (wave 6, slice 6).
// The structure's tracks need a structure open, so they are the window's alone.

import { annotationTracks } from './providers/index.js';
import { builtinTracks, trackTarget } from './tracks.js';
import { cellText } from './csv.js';

// Whether the providers read a run's variants (a MaveDB record's: by name and accession), so that
// its scores and its table are needed for its context.
export function readsVariants(ws, run) {
  const source = ws.sources.find((s) => s.sha256 === run.inputs.source.sha256);
  return Boolean(source?.origin?.database === 'MaveDB' && source.origin.urn);
}

// What a run gives the providers: its design's target (with the identifiers the workspace's has
// gained since: lib/tracks.js, trackTarget), the protein its map numbers, the offset, a MaveDB
// record's URN, and its variants by name and MaveDB accession (→ the map's cell and position).
// options: { results (the run's own, not its protein view), table (its source's) }, when
// readsVariants.
export function trackContext(ws, run, model, { results = null, table = null } = {}) {
  const design = run.inputs.design;
  const target = trackTarget(design.targets?.[0] ?? null, ws.targets);
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
  return { target, protein: model.protein, offset: model.target.offset ?? 0, length: model.length, origin, variants };
}

// Every track of a run's map (unarranged): its own, then each annotation's read from its text.
// text(annotation) → its file's text, or null when it is not at hand. Returns { tracks, problems:
// [{ annotation, message }], notes: Map(annotation id → [notes]) }.
export function runTrackList(ws, model, context, text) {
  const tracks = builtinTracks(model);
  const problems = [];
  const notes = new Map();
  for (const a of ws.annotations ?? []) {
    const t = text(a);
    if (t === null || t === undefined) {
      problems.push({ annotation: a, message: `${a.file?.fileName ?? a.name} is not at hand.` });
      continue;
    }
    let read;
    try {
      read = annotationTracks(a, t, context);
    } catch (error) {
      read = { tracks: [], notes: [], problem: error.message };
    }
    tracks.push(...read.tracks);
    notes.set(a.id, read.notes);
    if (read.problem) problems.push({ annotation: a, message: read.problem });
  }
  return { tracks, problems, notes };
}
