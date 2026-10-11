// Conservation from the person's own alignment (wave 3, slice 5): A3M, aligned FASTA, Stockholm or
// Clustal, its first sequence the query. Each query residue is scored as Capra & Singh's
// score_conservation.py scores its column, by default (conservation.js, copied from Proteoscope):
// the Jensen–Shannon divergence from the BLOSUM62 background, Henikoff sequence weights, a gap
// penalty, columns of more than 30% gaps unscored, a window of 3. The query is placed on the target
// by its residues: where it agrees with the target ungapped, at 80% of the residues at least, so
// a domain's alignment, the whole protein's or one of a homologue all fall where they belong.

import { conservationScores, parseAlignment } from '../conservation.js';
import { count } from './common.js';

const ALIGNMENT_NAME = /\.(a3m|a2m|sto|stk|sth|stockholm|aln|clustal|clw|afa|afasta|mfa)$/i;

// The query's best ungapped placement on the target: { shift (target position − query index − 1),
// overlap, same } where the most residues agree, or null when under 80% agree (or under 10, or
// under half the shorter of the two, overlap).
export function placeQuery(query, protein) {
  const target = protein.replace(/\*$/, '');
  const Q = query.length;
  const T = target.length;
  let best = null;
  for (let shift = -(Q - 1); shift <= T - 1; shift += 1) {
    let overlap = 0;
    let same = 0;
    const from = Math.max(0, -shift);
    const to = Math.min(Q, T - shift);
    for (let j = from; j < to; j += 1) {
      overlap += 1;
      if (query[j] === target[j + shift]) same += 1;
    }
    if (overlap < Math.min(10, Q, T) || overlap < Math.min(Q, T) / 2) continue;
    if (!best || same > best.same || (same === best.same && overlap > best.overlap)) best = { shift, overlap, same };
  }
  return best && best.same >= 0.8 * best.overlap ? best : null;
}

export const ALIGNMENT = {
  id: 'alignment',
  name: 'Conservation (alignment)',
  kind: 'file',
  service: 'a file',
  what: 'each position\'s conservation in your alignment (A3M, FASTA, Stockholm or Clustal; the first sequence the query)',
  cite: ['capra2007', 'henikoff1994'],
  accepts(fileName, text) {
    if (ALIGNMENT_NAME.test(fileName)) return true;
    if (!/\.(fasta|fa|faa|fas|txt)$/i.test(fileName)) return /^\s*(#\s*STOCKHOLM|CLUSTAL)/i.test(String(text).slice(0, 200));
    // A FASTA file of several sequences with gaps is an alignment; one sequence is a target.
    const head = String(text).slice(0, 200000);
    return (head.match(/^>/gm) ?? []).length >= 2 && /^[A-Za-z.]*-[A-Za-z.-]*$/m.test(head);
  },
  read(text, context) {
    const alignment = parseAlignment(text, context.record?.file ?? '');
    if (!alignment) return { tracks: [], notes: [], problem: 'This is not an alignment MaveScape reads (A3M, aligned FASTA, Stockholm or Clustal), or its first sequence has no residue.' };
    const query = alignment.query.toUpperCase();
    const place = placeQuery(query, context.protein);
    if (!place) return { tracks: [], notes: [], problem: `The alignment's first sequence (${alignment.names[0] ?? 'the query'}, ${query.length} residues) does not agree with the target's residues anywhere (80% at least, ungapped): it must be the target, a part of it, or a close homologue.` };
    const scored = conservationScores(alignment);
    const values = new Float64Array(context.length).fill(Number.NaN);
    let first = Infinity;
    let last = -Infinity;
    let unscored = 0;
    for (let j = 0; j < query.length; j += 1) {
      const p = j + place.shift + 1;
      if (p < 1 || p > context.length) continue;
      first = Math.min(first, p);
      last = Math.max(last, p);
      if (Number.isFinite(scored.scores[j])) values[p - 1] = scored.scores[j];
      else unscored += 1;
    }
    const notes = [
      `${count(scored.sequences, 'sequence')} (${alignment.format}; ${scored.effectiveSequences.toFixed(1)} effective); the query ${alignment.names[0] ?? ''} on the target's positions ${first}–${last}, ${place.same} of ${place.overlap} residues the same.`,
    ];
    if (unscored) notes.push(`${count(unscored, 'position')} in columns of more than 30% gaps left unscored.`);
    if (alignment.skipped) notes.push(`${count(alignment.skipped, 'sequence')} of another length than the query left out.`);
    return {
      tracks: [{
        part: 'conservation', label: `Conservation (${context.record?.file ?? 'alignment'})`, kind: 'values', length: context.length, values,
        domain: { kind: 'sequential', min: 0, max: 1 }, unit: 'bits', format: (x) => x.toFixed(3),
        alignment: { sequences: scored.sequences, effective: scored.effectiveSequences, format: alignment.format, first, last },
      }],
      notes,
    };
  },
};
