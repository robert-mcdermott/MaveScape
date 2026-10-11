// Conservation from PDBe-KB (wave 3, slice 5): for a UniProt entry, the probability of each amino
// acid at each position in a profile of its homologues (3DPatch's, from HMMER; Jakubec et al.
// 2019), as PDBe-KB serves it (/api/fetch/pdbe/conservation/{accession}). MaveScape scores each
// position as conservation.js scores an alignment's column: the Jensen–Shannon divergence of its
// distribution from the BLOSUM62 background (Capra & Singh 2007), in bits, 0 to about 1; PDBe-KB's
// own score is kept beside it. AlphaFold DB lists an alignment for each entry but has refused
// to send them since 2026 (HTTP 403), so a profile, or the person's own alignment
// (alignment.js), is what conservation is read from.

import { distributionDivergence } from '../conservation.js';
import { placementNotes, recordOf } from './common.js';
import { placeResidues } from '../tracks.js';

const LETTERS = 'ACDEFGHIKLMNPQRSTVWY';

// PDBe-KB's answer → [{ refPosition, divergence, score, top }] on the entry's numbering.
export function readProfile(json) {
  const d = json?.data;
  if (!d || !Array.isArray(d.index)) throw new Error('PDBe-KB\'s answer holds no conservation profile.');
  const out = [];
  for (let j = 0; j < d.index.length; j += 1) {
    const p = {};
    for (const a of LETTERS) p[a] = Number(d[`probability_${a}`]?.[j]);
    let top = null;
    for (const a of LETTERS) if (Number.isFinite(p[a]) && (!top || p[a] > p[top])) top = a;
    out.push({ refPosition: Number(d.index[j]), divergence: distributionDivergence(p), score: Number(d.conservation_score?.[j]), top });
  }
  return out;
}

export const PDBE_CONSERVATION = {
  id: 'pdbe-conservation',
  name: 'Conservation (PDBe-KB)',
  kind: 'public',
  service: 'PDBe-KB',
  what: 'each position\'s conservation among the protein\'s homologues, from PDBe-KB\'s profile of them',
  license: 'CC BY 4.0',
  cite: ['pdbekb', 'threedpatch', 'capra2007'],
  needs(target) {
    return target?.identifiers?.uniprot ? null : 'The target has no UniProt accession: give it in Experiment, Target.';
  },
  async fetch(target, context, get) {
    const accession = target.identifiers.uniprot.toUpperCase();
    const got = await get(`pdbe/conservation/${encodeURIComponent(accession)}`, { as: 'text' });
    if (!got.ok) throw new Error(got.message);
    return { text: got.text, fileName: `${accession}.conservation.json`, record: recordOf([got.retrieval], { accession, license: 'CC BY 4.0', citation: 'PDBe-KB consortium. Nucleic Acids Res. 2022;50:D534–D542' }) };
  },
  read(text, context) {
    const json = JSON.parse(text);
    const profile = readProfile(json);
    // The profile names no residue of the entry, so its positions are placed by the offset alone.
    const place = placeResidues(profile.map((x) => ({ ...x, ref: null })), context.protein, context.offset ?? 0);
    const values = new Float64Array(context.length).fill(Number.NaN);
    const scores = new Float64Array(context.length).fill(Number.NaN);
    for (const x of place.placed) {
      values[x.position - 1] = x.divergence;
      scores[x.position - 1] = x.score;
    }
    const placed = place.placed.length;
    const notes = placementNotes(place, 'position');
    if (placed < context.length) notes.push(`${context.length - placed} of the target's ${context.length} positions are not in the profile.`);
    return {
      tracks: [{
        part: 'conservation', label: 'Conservation (PDBe-KB)', kind: 'values', length: context.length, values, profileScores: scores,
        domain: { kind: 'sequential', min: 0, max: 1 }, unit: 'bits', format: (x) => x.toFixed(3),
      }],
      notes,
    };
  },
};
