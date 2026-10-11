// Custom tracks from a file (wave 3, slice 5): GFF3 (UniProt's feature format among others) or a
// CSV or TSV table.
//   GFF3: each feature (seqid, type, start, end, attributes); UniProt's types become the tracks
//     UniProt's JSON gives (uniprot-features.js), any other type one features track. Numbered as
//     the reference is when the seqid is the target's UniProt accession, else as the target is.
//   A table: a column `position` (the target's numbering) or `reference_position` (the
//     reference's), and a track for each other column of numbers; or columns `start` and `end`
//     (the target's numbering, with `label`, `type`), stretches of a features track. MaveScape's own export of tracks
//     (tracksCSV) reads back this way.

import { parseTable, columnText } from '../csv.js';
import { count } from './common.js';
import { isUniProtType, uniprotTracks } from './uniprot-features.js';

// GFF3's attributes (key=value;…, values %-escaped).
function attributesOf(text) {
  const out = {};
  for (const part of String(text ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    let value = part.slice(i + 1).trim();
    try {
      value = decodeURIComponent(value);
    } catch {
      // Kept as written.
    }
    out[part.slice(0, i).trim()] = value;
  }
  return out;
}

// GFF3 text → [{ seqid, type, start, end, label, attributes }]; null when it is not GFF3.
export function readGFF3(text) {
  const lines = String(text).split(/\r?\n/);
  if (!lines.some((l) => /^##gff-version\s+3/.test(l)) && !lines.some((l) => l.split('\t').length >= 9 && /^\d+$/.test(l.split('\t')[3] ?? ''))) return null;
  const features = [];
  for (const line of lines) {
    if (/^##FASTA/.test(line)) break;
    if (!line.trim() || line.startsWith('#')) continue;
    const f = line.split('\t');
    if (f.length < 9) continue;
    const start = Number(f[3]);
    const end = Number(f[4]);
    if (!Number.isInteger(start) || !Number.isInteger(end)) continue;
    const attributes = attributesOf(f[8]);
    features.push({ seqid: decodeURIComponent(f[0]), type: f[2], start, end, label: attributes.Name || attributes.Note || attributes.ID || f[2], attributes });
  }
  return features;
}

const label = (record, fallback) => record?.file ?? fallback;

function gffTracks(features, context) {
  const accession = context.target?.identifiers?.uniprot?.toUpperCase();
  const seqids = [...new Set(features.map((f) => f.seqid))];
  const reference = accession && seqids.some((s) => s.toUpperCase() === accession);
  const offset = reference ? context.offset ?? 0 : 0;
  const notes = [`Numbered as ${reference ? `${accession} (the reference) numbers it` : 'the target is'}.`];
  const ours = reference ? features.filter((f) => f.seqid.toUpperCase() === accession) : features;
  if (ours.length < features.length) notes.push(`${count(features.length - ours.length, 'feature')} of other sequences (${seqids.filter((s) => s.toUpperCase() !== accession).slice(0, 3).join(', ')}) left out.`);
  const uniprot = ours.filter((f) => isUniProtType(f.type));
  const tracks = [];
  if (uniprot.length) {
    const read = uniprotTracks(uniprot, { ...context, offset }, { label: label(context.record, 'GFF3') });
    tracks.push(...read.tracks.filter((t) => t.features.length));
    notes.push(...read.notes);
  }
  const others = ours.filter((f) => !isUniProtType(f.type) && !['Chain', 'Natural variant', 'Mutagenesis', 'Alternative sequence', 'Sequence conflict', 'Non-terminal residue', 'Non-standard residue', 'Non-adjacent residues', 'Sequence uncertainty', 'Initiator methionine', 'Peptide'].includes(f.type));
  if (others.length) {
    const placed = [];
    let beyond = 0;
    for (const f of others) {
      const start = f.start - offset;
      const end = f.end - offset;
      if (end < 1 || start > context.length) {
        beyond += 1;
        continue;
      }
      placed.push({ type: f.type, start: Math.max(1, start), end: Math.min(context.length, end), label: f.label, ...(start < 1 || end > context.length ? { clipped: true } : {}) });
    }
    if (beyond) notes.push(`${count(beyond, 'feature')} beyond the target left out.`);
    if (placed.length) tracks.push({ part: 'features', label: `Features (${label(context.record, 'GFF3')})`, kind: 'features', length: context.length, features: placed });
  }
  const skipped = ours.length - uniprot.length - others.length;
  if (skipped) notes.push(`${count(skipped, 'feature')} that are not stretches of the protein (chains, variants, mutagenesis, isoforms) left out.`);
  return { tracks, notes };
}

function tableTracks(text, context) {
  const table = parseTable(String(text));
  const named = (...names) => table.columns.find((c) => names.includes(c.name.trim().toLowerCase())) ?? null;
  const name = label(context.record, 'table');
  const start = named('start');
  const end = named('end');
  if (start?.numeric && end?.numeric) {
    const labels = named('label', 'name', 'feature', 'description', 'note');
    const types = named('type', 'kind');
    const features = [];
    let beyond = 0;
    for (let r = 0; r < table.rows; r += 1) {
      const a = start.numeric[r];
      const b = end.numeric[r];
      if (!Number.isInteger(a) || !Number.isInteger(b)) continue;
      if (b < 1 || a > context.length) {
        beyond += 1;
        continue;
      }
      const type = types ? columnText(types)[r] || 'feature' : 'feature';
      features.push({ type, start: Math.max(1, a), end: Math.min(context.length, b), label: labels ? columnText(labels)[r] || type : type });
    }
    const notes = beyond ? [`${count(beyond, 'feature')} beyond the target left out.`] : [];
    return { tracks: [{ part: 'features', label: `Features (${name})`, kind: 'features', length: context.length, features }], notes };
  }
  const position = named('position');
  const refPosition = named('reference_position', 'uniprot_position');
  const at = position ?? refPosition;
  if (!at?.numeric) return { tracks: [], notes: [], problem: 'The table has no column `position` (the target\'s numbering) or `reference_position`, nor `start` and `end`.' };
  const offset = at === position ? 0 : context.offset ?? 0;
  const skip = new Set([position, refPosition, named('residue')].filter(Boolean));
  const tracks = [];
  let beyond = 0;
  for (const c of table.columns) {
    if (skip.has(c) || !c.numeric) continue;
    const values = new Float64Array(context.length).fill(Number.NaN);
    for (let r = 0; r < table.rows; r += 1) {
      const p = at.numeric[r] - offset;
      if (!Number.isInteger(p)) continue;
      if (p < 1 || p > context.length) {
        if (c === table.columns.find((x) => !skip.has(x) && x.numeric)) beyond += 1;
        continue;
      }
      values[p - 1] = c.numeric[r];
    }
    const xs = [...values].filter(Number.isFinite);
    if (!xs.length) continue;
    const min = Math.min(...xs);
    const max = Math.max(...xs);
    tracks.push({ part: `column-${c.index}`, label: `${c.name} (${name})`, kind: 'values', length: context.length, values, domain: min < 0 && max > 0 ? { kind: 'diverging', center: 0, min: -Math.max(-min, max), max: Math.max(-min, max) } : { kind: 'sequential', min: Math.min(0, min), max: max || 1 }, format: (x) => Number(x.toPrecision(4)).toString() });
  }
  if (!tracks.length) return { tracks, notes: [], problem: 'The table has positions but no column of numbers to draw.' };
  const notes = [`Numbered as ${at === position ? 'the target is (position)' : 'the reference is (reference_position)'}.`];
  if (beyond) notes.push(`${count(beyond, 'row')} beyond the target left out.`);
  return { tracks, notes };
}

export const CUSTOM = {
  id: 'custom',
  name: 'Custom track',
  kind: 'file',
  service: 'a file',
  what: 'features from GFF3 (as UniProt writes them, or any), or a table of values (position, then columns of numbers) or of stretches (start, end, label)',
  cite: [],
  accepts(fileName, text) {
    if (/\.gff3?$/i.test(fileName)) return true;
    if (readGFF3(String(text).slice(0, 20000))?.length) return true;
    if (!/\.(csv|tsv|txt)$/i.test(fileName)) return false;
    const head = String(text).split(/\r?\n/, 1)[0].toLowerCase();
    return /(^|[,\t])(position|reference_position|start)([,\t]|$)/.test(head);
  },
  read(text, context) {
    const gff = readGFF3(text);
    if (gff) return gff.length ? gffTracks(gff, context) : { tracks: [], notes: [], problem: 'The GFF3 file holds no feature.' };
    return tableTracks(text, context);
  },
};
