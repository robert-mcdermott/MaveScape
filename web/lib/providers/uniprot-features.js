// UniProt's features of an entry as three tracks (wave 3, slice 5): domains and regions, sites and
// motifs, secondary structure. Fetched as JSON (/api/fetch/uniprot/{accession}/features), or read
// from UniProt's GFF3 (custom.js); both are placed on the target by its offset, the entry's
// sequence checked against the target's where it is given.

import { count, recordOf } from './common.js';

// UniProt's feature types (JSON's names; GFF3 writes "Signal peptide" for "Signal"), by track.
export const UNIPROT_GROUPS = [
  { part: 'domains', label: 'Domains and regions', types: ['Domain', 'Region', 'Repeat', 'Zinc finger', 'DNA binding', 'Compositional bias', 'Coiled coil', 'Topological domain', 'Transmembrane', 'Intramembrane', 'Signal', 'Transit peptide', 'Propeptide'] },
  { part: 'sites', label: 'Sites and motifs', types: ['Motif', 'Active site', 'Binding site', 'Site', 'Modified residue', 'Lipidation', 'Glycosylation', 'Disulfide bond', 'Cross-link'] },
  { part: 'structure', label: 'Secondary structure', types: ['Helix', 'Beta strand', 'Turn'] },
];
const GFF_NAMES = { 'Signal peptide': 'Signal' };
export const uniprotType = (type) => GFF_NAMES[type] ?? type;
const KNOWN = new Set(UNIPROT_GROUPS.flatMap((g) => g.types));
export const isUniProtType = (type) => KNOWN.has(uniprotType(type));

// A feature's name: its description, a binding site's ligand, else its type.
function labelOf(f) {
  const description = String(f.description ?? '').trim();
  if (description) return description;
  if (f.ligand?.name) return f.ligand.name;
  return f.type;
}

// UniProt's JSON features → [{ type, start, end, label }] on the entry's numbering. A feature
// whose ends are unknown (modifier UNKNOWN, no value) is left out.
export function readUniProtFeatures(json) {
  const features = [];
  for (const f of json?.features ?? []) {
    const start = f.location?.start?.value;
    const end = f.location?.end?.value;
    if (!Number.isInteger(start) || !Number.isInteger(end) || !KNOWN.has(f.type)) continue;
    features.push({ type: f.type, start, end, label: labelOf(f) });
  }
  return features;
}

// Features on the entry's numbering → the three tracks on the target's: placed by the offset,
// clipped to the target (and said so), those wholly beyond it left out. A disulfide bond is a
// feature at each of its two cysteines.
export function uniprotTracks(features, context, { label = null } = {}) {
  const offset = context.offset ?? 0;
  const L = context.length;
  const notes = [];
  let beyond = 0;
  const tracks = UNIPROT_GROUPS.map((group) => ({ part: group.part, label: label ? `${group.label} (${label})` : group.label, kind: 'features', length: L, features: [] }));
  for (const f of features) {
    const type = uniprotType(f.type);
    const g = UNIPROT_GROUPS.findIndex((x) => x.types.includes(type));
    if (g < 0) continue;
    const spans = type === 'Disulfide bond' && f.end > f.start ? [[f.start, f.start], [f.end, f.end]] : [[f.start, f.end]];
    for (const [a, b] of spans) {
      const start = a - offset;
      const end = b - offset;
      if (end < 1 || start > L) {
        beyond += 1;
        continue;
      }
      tracks[g].features.push({ type, start: Math.max(1, start), end: Math.min(L, end), label: f.label, ...(start < 1 || end > L ? { clipped: true } : {}) });
    }
  }
  if (beyond) notes.push(`${count(beyond, 'feature')} of the entry lie beyond the target (it covers positions ${1 + offset}–${L + offset}).`);
  return { tracks, notes };
}

// The entry's sequence against the target's at the offset: the share of the target's residues
// that agree. null without a sequence.
export function sequenceAgreement(sequence, protein, offset = 0) {
  if (!sequence) return null;
  let compared = 0;
  let same = 0;
  const target = protein.replace(/\*$/, '');
  for (let p = 1; p <= target.length; p += 1) {
    const r = sequence[p + offset - 1];
    if (!r) continue;
    compared += 1;
    if (r === target[p - 1]) same += 1;
  }
  return { compared, same, share: compared ? same / compared : 0 };
}

export const UNIPROT_FEATURES = {
  id: 'uniprot-features',
  name: 'UniProt features',
  kind: 'public',
  service: 'UniProt',
  what: 'domains, regions, motifs, sites, modified residues and secondary structure from the target\'s UniProt entry',
  license: 'CC BY 4.0',
  cite: ['uniprot'],
  needs(target) {
    return target?.identifiers?.uniprot ? null : 'The target has no UniProt accession: give it in Experiment, Target (or check the target against UniProt).';
  },
  async fetch(target, context, get) {
    const accession = target.identifiers.uniprot.toUpperCase();
    const got = await get(`uniprot/${encodeURIComponent(accession)}/features`, { as: 'text' });
    if (!got.ok) throw new Error(got.message);
    return { text: got.text, fileName: `${accession}.features.json`, record: recordOf([got.retrieval], { accession, license: 'CC BY 4.0', citation: 'UniProt Consortium. Nucleic Acids Res. 2025;53:D609–D617' }) };
  },
  read(text, context) {
    const json = JSON.parse(text);
    const accession = json.primaryAccession ?? context.record?.accession ?? 'UniProt';
    const agreement = sequenceAgreement(json.sequence?.value, context.protein, context.offset ?? 0);
    if (agreement && agreement.compared >= 5 && agreement.share < 0.9) {
      return { tracks: [], notes: [], problem: `Only ${agreement.same} of the target's ${agreement.compared} residues agree with ${accession}'s at the target's offset (${context.offset ?? 0}): its features would be misplaced. Check the target against UniProt (Experiment, Target).` };
    }
    const { tracks, notes } = uniprotTracks(readUniProtFeatures(json), context);
    if (agreement && agreement.same < agreement.compared) notes.push(`${agreement.compared - agreement.same} of the target's residues differ from ${accession}'s (as a construct may).`);
    return { tracks: tracks.filter((t) => t.features.length), notes };
  },
};
