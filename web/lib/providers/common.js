// What the annotation providers share (providers/index.js): the record of the fetcher's answers,
// placing an annotation's residues on the target, and counted words.

import { placeResidues } from '../tracks.js';

// The record of answers from the fetcher: the service, its release, the earliest retrieval (the
// oldest answer the track holds), the address of the first and how many were asked.
export function recordOf(retrievals, extra = {}) {
  const list = retrievals.filter(Boolean);
  const times = list.map((r) => r.retrieved).filter(Boolean).sort();
  return {
    service: list[0]?.service ?? null,
    url: list[0]?.source ?? null,
    retrieved: times[0] ?? null,
    release: list.find((r) => r.version)?.version ?? null,
    requests: list.length,
    ...extra,
  };
}

// Reads the protein numbering of an annotation onto the target: as the reference numbers it (the
// target's offset), else as the target numbers it, whichever agrees more. items: [{ refPosition, ref }].
// Returns placeResidues' answer with `numbering` ('reference' or 'target').
export function placeEither(items, context) {
  const offset = context.offset ?? 0;
  const asReference = placeResidues(items, context.protein, offset);
  if (!offset) return { ...asReference, numbering: 'target' };
  const asTarget = placeResidues(items, context.protein, 0);
  return asTarget.agree > asReference.agree && !asTarget.problem ? { ...asTarget, numbering: 'target' } : { ...asReference, numbering: 'reference' };
}

export const count = (n, one, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

// A note of what placing left out.
export function placementNotes(place, what) {
  const notes = [];
  if (place.outside) notes.push(`${count(place.outside, what)} beyond the target's ends left out.`);
  if (place.disagree.length) notes.push(`${count(place.disagree.length, what)} naming another residue than the target's left out (${place.disagree.slice(0, 3).map((d) => `${d.ref}${d.refPosition}, the target has ${d.target}`).join('; ')}${place.disagree.length > 3 ? '; …' : ''}).`);
  return notes;
}
