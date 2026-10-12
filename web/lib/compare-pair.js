// A pair of sides compared as the Compare view compares them (moved from web/ui/mode-compare.js
// in wave 6, slice 6, so that the certificate, lib/certificate.js, computes a comparison kept in
// the report or drawn on a figure with the view's own code): a run's condition, difference or
// replicate (lib/compare.js, describeSide), a MaveDB score set read as published, or a predictor
// placed on the measured side's protein, as its track is placed beside that side's map.

import { COMPARABLE_PROVIDERS, compareSides, describePredictor, describeScoreSet, describeSide, differenceMap, sideMap, specKey } from './compare.js';
import { buildMapModel } from './map-model.js';
import { annotationTracks } from './providers/index.js';
import { scoreSetResults } from './scoreset.js';
import { trackTarget } from './tracks.js';
import { possessive } from './words.js';

export const annotationOf = (ws, spec) => (spec?.annotation ? (ws.annotations ?? []).find((a) => a.id === spec.annotation) ?? null : null);
export const runOf = (ws, spec) => (spec?.run ? ws.runs.find((r) => r.id === spec.run) ?? null : null);

// What a side needs that is missing: null, or the words. get: { results(run) → its scores or null,
// text(annotation) → its file's text or null }.
export function pairProblem(ws, pair, get) {
  for (const spec of [pair.a, pair.b]) {
    const a = annotationOf(ws, spec);
    if (spec?.annotation && !a) return 'A score set or predictor of the pair is no longer kept beside the workspace.';
    if (a) {
      if (get.text(a) === null || get.text(a) === undefined) return `${a.name}: its file is not at hand.`;
      continue;
    }
    const run = runOf(ws, spec);
    if (!run) return 'A run of the pair is no longer in the workspace.';
    if (!get.results(run)) return `${possessive(run.name)} scores could not be recomputed.`;
  }
  return null;
}

// Caches of what a side reads once: a score set read as published (by its text and the direction
// stated), a predictor placed on a measured side (by that side's scores and target).
export function pairCaches() {
  return { sets: new Map(), placed: new WeakMap() };
}

// A side of a pair, described (lib/compare.js), its scores and texts at hand. other: the measured
// side a predictor is placed on.
export function describePairSide(ws, spec, get, other = null, caches = pairCaches()) {
  const a = annotationOf(ws, spec);
  if (!a) {
    const run = runOf(ws, spec);
    return describeSide(ws, run, get.results(run), spec);
  }
  const text = get.text(a);
  if (COMPARABLE_PROVIDERS[a.provider] === 'scoreset') {
    const key = `${a.file.sha256}|${a.record?.scoreSet?.readout?.direction ?? ''}|${a.record?.scoreSet?.urn ?? ''}`;
    if (!caches.sets.has(key)) caches.sets.set(key, scoreSetResults(text, a.record?.scoreSet));
    const read = caches.sets.get(key);
    if (read.error) throw new Error(read.error);
    return describeScoreSet(a, read);
  }
  if (!other) throw new Error(`${a.name} is compared with a run's scores or a score set's: choose one for the other side.`);
  if (!caches.placed.has(other.results)) caches.placed.set(other.results, new Map());
  const cache = caches.placed.get(other.results);
  const key = `${a.id}|${a.file.sha256}|${specKey(other.spec)}`;
  if (!cache.has(key)) {
    const map = sideMap(other);
    if (!map) throw new Error(`${other.label} has no protein changes to place ${possessive(a.name)} substitutions on (nucleotide variants with no coding sequence).`);
    const model = buildMapModel(map.results, map.design, { condition: map.condition });
    const read = annotationTracks(a, text, { target: trackTarget(other.target, ws.targets), protein: model.protein, offset: model.target.offset ?? 0, length: model.length });
    if (!read.tracks.length) throw new Error(`${a.name}: ${read.problem ?? `nothing to place on ${other.target?.name ?? 'the target'}`}`);
    cache.set(key, describePredictor(a, read.tracks[0], other, read.notes));
  }
  return cache.get(key);
}

// The comparison of a pair (compareSides, with its two sides as `sides`), or { error }. options: {
// filters, level ('protein': matched as the maps are), scale, caches }.
export function comparePair(ws, pair, get, { filters, level = null, scale = 'scored', caches = pairCaches() } = {}) {
  const problem = pairProblem(ws, pair, get);
  if (problem) return { error: problem };
  try {
    // A predictor is placed on the other side, so that side is described first.
    const first = annotationOf(ws, pair.a) && COMPARABLE_PROVIDERS[annotationOf(ws, pair.a).provider] === 'predictor';
    let sides;
    if (first) {
      const b = describePairSide(ws, pair.b, get, null, caches);
      sides = [describePairSide(ws, pair.a, get, b, caches), b];
    } else {
      const a = describePairSide(ws, pair.a, get, null, caches);
      sides = [a, describePairSide(ws, pair.b, get, a, caches)];
    }
    const value = compareSides(sides[0], sides[1], { filters, scale, ...(level ? { level } : {}) });
    value.sides = sides;
    return value;
  } catch (error) {
    return { error: error.message };
  }
}

// The map models of a comparison at the protein level: { first, second, difference } (each
// { model, results } or null), with each side's target offset.
export function comparisonMapModels(c) {
  const [sa, sb] = c.sides;
  const made = (spec, colorBy = 'score') => {
    if (!spec) return null;
    try {
      return { model: buildMapModel(spec.results, spec.design, { condition: spec.condition, contrast: spec.contrast, colorBy }), results: spec.results };
    } catch {
      return null;
    }
  };
  return {
    first: made(sideMap(sa)),
    second: made(sideMap(sb)),
    difference: made(differenceMap(c, sa), 'differential'),
    offsets: [sa.target?.offset ?? 0, sb.target?.offset ?? 0],
  };
}
