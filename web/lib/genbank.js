// Targets from GenBank records (requirement D13, wave 3, slice 3): a plasmid or construct map, or
// a RefSeq or GenBank record (NCBI's answer for a target named by its transcript, NM_007294.3).
// The reader takes the flat-file format as NCBI writes it (and SnapGene, Benchling, ApE and
// Geneious export it): LOCUS, DEFINITION, ACCESSION, VERSION, the organism, the features with their
// locations and qualifiers, and the sequence. The validation suite `consequences` checks it against
// Biopython's reader on the records it uses.
//
// A target is made from one coding feature (a CDS), which the person chooses when there are
// several: its translation is checked against the record's /translation. From an mRNA whose coding
// sequence is one stretch of the forward strand, the target is the whole record, its coding start
// the CDS's, so that variants in the UTRs (c.-12, c.*30) are on it; otherwise (a plasmid, a
// genomic record, a CDS on the reverse strand or in pieces) the target is the coding sequence
// alone, as joined and read on its strand.
//
//   parseGenBank(text)                     → { records: [record], problems: [text] }
//   codingFeatures(record)                 → [{ feature, label, location, length, protein }]
//   targetFromGenBank(record, feature, o)  → { target, origin, check, messages }

import { CODONS } from './target.js';

const COMPLEMENT = { A: 'T', C: 'G', G: 'C', T: 'A', N: 'N' };
const reverseComplement = (s) => [...s].reverse().map((b) => COMPLEMENT[b] ?? 'N').join('');

// Reads one or more records of a GenBank flat file.
export function parseGenBank(text) {
  const records = [];
  const problems = [];
  const lines = String(text).replace(/^﻿/, '').split(/\r\n|\n|\r/);
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].startsWith('LOCUS')) {
      i += 1;
      continue;
    }
    const start = i;
    while (i < lines.length && !lines[i].startsWith('//')) i += 1;
    try {
      records.push(readRecord(lines.slice(start, i)));
    } catch (error) {
      problems.push(`The record at line ${start + 1}: ${error.message}`);
    }
    i += 1;
  }
  if (!records.length && !problems.length) problems.push('No GenBank record: a GenBank file begins with a LOCUS line.');
  return { records, problems };
}

function readRecord(lines) {
  const locus = lines[0].slice(5).trim().split(/\s+/);
  const record = {
    name: locus[0] ?? '',
    length: Number(locus[1]) || null,
    molecule: locus.find((w) => /^(ss-|ds-|ms-)?(DNA|RNA|mRNA|rRNA|tRNA)$/i.test(w)) ?? null,
    topology: locus.find((w) => /^(linear|circular)$/i.test(w))?.toLowerCase() ?? 'linear',
    definition: '',
    accession: null,
    version: null,
    organism: null,
    features: [],
    sequence: '',
  };
  let section = null;
  let feature = null;
  let qualifier = null;
  const sequence = [];
  for (const line of lines.slice(1)) {
    const key = line.slice(0, 12).trim();
    if (line.startsWith('ORIGIN')) {
      section = 'origin';
      continue;
    }
    if (section === 'origin') {
      sequence.push(line.replace(/[^A-Za-z]/g, ''));
      continue;
    }
    if (line.startsWith('FEATURES')) {
      section = 'features';
      continue;
    }
    if (section === 'features' && /^ {5}\S/.test(line)) {
      feature = { type: line.slice(5, 21).trim(), location: line.slice(21).trim(), qualifiers: {} };
      record.features.push(feature);
      qualifier = null;
      continue;
    }
    if (section === 'features' && /^ {21}/.test(line)) {
      const body = line.slice(21);
      const q = /^\/([A-Za-z_][\w-]*)(?:=(.*))?$/.exec(body.trim());
      if (q) {
        qualifier = q[1];
        const value = q[2] === undefined ? true : q[2];
        feature.qualifiers[qualifier] = feature.qualifiers[qualifier] === undefined ? value : [].concat(feature.qualifiers[qualifier], value);
      } else if (qualifier) {
        const values = [].concat(feature.qualifiers[qualifier]);
        // A /translation (a protein) continues without a space; text with one.
        values[values.length - 1] += qualifier === 'translation' ? body.trim() : ` ${body.trim()}`;
        feature.qualifiers[qualifier] = values.length > 1 ? values : values[0];
      } else {
        feature.location += body.trim();
      }
      continue;
    }
    if (key && !line.startsWith(' ')) {
      section = key;
      const value = line.slice(12).trim();
      if (key === 'DEFINITION') record.definition = value;
      else if (key === 'ACCESSION') record.accession = value.split(/\s+/)[0] || null;
      else if (key === 'VERSION') record.version = value.split(/\s+/)[0] || null;
      continue;
    }
    if (section === 'DEFINITION' && line.startsWith(' ')) record.definition += ` ${line.trim()}`;
    else if (key === 'ORGANISM') record.organism = line.slice(12).trim();
  }
  record.definition = record.definition.replace(/\.$/, '');
  record.sequence = sequence.join('').toUpperCase();
  if (!record.sequence) throw new Error('it has no sequence (ORIGIN).');
  if (record.length && record.length !== record.sequence.length) throw new Error(`its LOCUS line says ${record.length} bases and its sequence has ${record.sequence.length}.`);
  for (const f of record.features) {
    for (const [k, v] of Object.entries(f.qualifiers)) f.qualifiers[k] = Array.isArray(v) ? v.map(unquote) : unquote(v);
    try {
      f.parts = parseLocation(f.location);
    } catch (error) {
      f.parts = null;
      f.problem = error.message;
    }
  }
  return record;
}

const unquote = (v) => (typeof v === 'string' && v.startsWith('"') ? v.slice(1, v.endsWith('"') && v.length > 1 ? -1 : undefined).replace(/""/g, '"') : v);

// A feature's location as parts in reading order: [{ start, end (1-based, inclusive), strand,
// partialStart, partialEnd }]. complement() reverses the order of its parts; join() and order()
// concatenate. A location on another record (J00194.1:100..202) is refused.
export function parseLocation(text) {
  const s = String(text).replace(/\s+/g, '');
  let i = 0;
  const fail = (why) => {
    throw new Error(`the location ${text} ${why}`);
  };
  function expression() {
    if (s.startsWith('complement(', i)) {
      i += 'complement('.length;
      const parts = expression();
      if (s[i] !== ')') fail('is not closed');
      i += 1;
      return parts.reverse().map((p) => ({ ...p, strand: -p.strand, partialStart: p.partialEnd, partialEnd: p.partialStart }));
    }
    for (const word of ['join(', 'order(']) {
      if (s.startsWith(word, i)) {
        i += word.length;
        const parts = [...expression()];
        while (s[i] === ',') {
          i += 1;
          parts.push(...expression());
        }
        if (s[i] !== ')') fail('is not closed');
        i += 1;
        return parts;
      }
    }
    const m = /^(<)?(\d+)(?:(\.\.|\^)(>)?(\d+))?(>)?/.exec(s.slice(i));
    if (!m) fail(/^[A-Za-z]/.test(s.slice(i)) && s.slice(i).includes(':') ? 'is on another record' : 'cannot be read');
    i += m[0].length;
    const a = Number(m[2]);
    const b = m[5] ? Number(m[5]) : a;
    if (m[3] === '^') return [{ start: a, end: a, strand: 1, between: true, partialStart: false, partialEnd: false }];
    if (b < a) fail('runs backwards');
    return [{ start: a, end: b, strand: 1, partialStart: Boolean(m[1]), partialEnd: Boolean(m[4] || m[6]) }];
  }
  const parts = expression();
  if (i !== s.length) fail('has more after its end');
  return parts;
}

// The bases a feature covers, in reading order (on its strand). A circular record's feature may
// run through the origin (join(5000..5386,1..200)).
export function featureSequence(record, feature) {
  return feature.parts.map((p) => {
    const bases = record.sequence.slice(p.start - 1, p.end);
    return p.strand < 0 ? reverseComplement(bases) : bases;
  }).join('');
}

function translateBases(bases) {
  let protein = '';
  for (let i = 0; i + 3 <= bases.length; i += 3) protein += CODONS[bases.slice(i, i + 3)] ?? 'X';
  return protein;
}

const first = (v) => (Array.isArray(v) ? v[0] : v);

// The record's coding features (CDS), each with a label and its translation checked.
export function codingFeatures(record) {
  return record.features.filter((f) => f.type === 'CDS').map((feature) => {
    const q = feature.qualifiers;
    const label = [first(q.gene), first(q.product) ?? first(q.label) ?? first(q.note)].filter(Boolean).join(': ') || 'CDS';
    if (!feature.parts) return { feature, label, location: feature.location, problem: feature.problem };
    const bases = featureSequence(record, feature);
    const frame = Math.max(0, (Number(first(q.codon_start)) || 1) - 1);
    const table = Number(first(q.transl_table)) || 1;
    const protein = translateBases(bases.slice(frame));
    return { feature, label, location: feature.location, length: bases.length, frame, table, protein, check: checkTranslation(protein, first(q.translation), table, feature) };
  });
}

// The translation against the record's own: identical (the stop aside), or how it differs.
function checkTranslation(protein, given, table, feature) {
  if (table !== 1 && table !== 11) return { status: 'unchecked', message: `It uses genetic code ${table}; MaveScape translates with the standard code (1 and 11) only.` };
  const translated = protein.replace(/\*$/, '');
  const internal = translated.indexOf('*');
  if (!given) {
    return internal >= 0
      ? { status: 'differs', message: `Its translation has a stop at codon ${internal + 1}, before its end.` }
      : { status: 'unchecked', message: `The record gives no translation to check it against; its ${translated.length} codons translate with no stop before the end.` };
  }
  // A start codon other than ATG is read as methionine (GenBank's translations do so).
  const ours = feature.parts[0].partialStart ? translated : translated.replace(/^[A-Z]/, given[0] === 'M' ? 'M' : translated[0]);
  if (ours === given) return { status: 'identical', message: `Its ${given.length} amino acids are the record's translation, identical.` };
  const n = Math.min(ours.length, given.length);
  let k = 0;
  while (k < n && ours[k] === given[k]) k += 1;
  return { status: 'differs', message: `It differs from the record's translation from residue ${k + 1} (${ours[k] ?? 'end'} here, ${given[k] ?? 'end'} in the record; ${ours.length} and ${given.length} residues).` };
}

// The NCBI Taxonomy id of a record's source feature (/db_xref="taxon:9606"), or null.
function taxonOf(record) {
  const source = record.features.find((f) => f.type === 'source');
  const xref = [].concat(source?.qualifiers?.db_xref ?? []).map(String).find((x) => /^taxon:\d+$/.test(x));
  return xref ? Number(xref.slice(6)) : null;
}

// A design target from a coding feature, with where it came from (origin, kept with the
// workspace's target) and the check of its translation. options: { id, name, file, retrieval }.
export function targetFromGenBank(record, coding, options = {}) {
  const messages = [];
  const { feature } = coding;
  const q = feature.qualifiers;
  const gene = first(q.gene) ?? null;
  const accession = record.version ?? record.accession ?? record.name;
  const single = feature.parts.length === 1 && feature.parts[0].strand > 0;
  const mrna = /RNA/i.test(record.molecule ?? '') && single;
  let sequence;
  let codingStart;
  if (mrna) {
    sequence = record.sequence;
    codingStart = feature.parts[0].start + coding.frame;
  } else {
    sequence = featureSequence(record, feature);
    codingStart = 1 + coding.frame;
  }
  if (!/^[ACGT]+$/.test(sequence)) messages.push({ level: 'error', message: 'The sequence holds letters other than A, C, G and T (ambiguous bases): a target needs every base.' });
  if (coding.check.status === 'differs') messages.push({ level: 'warning', message: coding.check.message });
  if (feature.parts.some((p) => p.partialStart || p.partialEnd)) messages.push({ level: 'warning', message: 'The coding feature is partial (< or >): its start or end lies beyond what the record holds.' });
  const refseq = /^[A-Z]{2}_\d+(\.\d+)?$/.test(accession ?? '');
  const identifiers = {};
  if (gene) identifiers.gene = gene;
  if (refseq) identifiers.refseq = accession;
  else if (accession) identifiers.genbank = accession;
  const protein = first(q.protein_id);
  if (protein) identifiers.protein = protein;
  const id = (options.id ?? gene ?? record.name ?? 'target').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 64) || 'target';
  const target = {
    id,
    name: options.name ?? (gene ? `${gene}${accession ? ` (${accession})` : ''}` : record.definition || accession || 'Target'),
    sequenceType: 'dna',
    sequence,
    codingStart,
    offset: 0,
    ...(record.organism ? { organism: record.organism } : {}),
    // The organism's NCBI Taxonomy id, from the source feature's /db_xref="taxon:9606" (wave 3,
    // slice 4: MaveDB keeps one with a target).
    ...(taxonOf(record) ? { taxonomyId: taxonOf(record) } : {}),
    ...(Object.keys(identifiers).length ? { identifiers } : {}),
  };
  const origin = {
    format: 'GenBank',
    accession,
    feature: `CDS ${feature.location}`,
    label: coding.label,
    whole: mrna,
    ...(options.file ? { file: options.file } : {}),
    ...(options.retrieval ? { retrieval: options.retrieval } : {}),
    check: coding.check,
  };
  return { target, origin, check: coding.check, messages };
}

// The coding feature to offer first: the only one, else the longest whose translation checks.
export function preferredFeature(features) {
  const usable = features.filter((f) => !f.problem);
  if (!usable.length) return null;
  const rank = (f) => (f.check.status === 'identical' ? 1e12 : 0) + f.length;
  return usable.reduce((best, f) => (rank(f) > rank(best) ? f : best));
}

// Is this text a GenBank record? (its first line a LOCUS line)
export const looksLikeGenBank = (text) => /^﻿?\s*LOCUS\s/.test(String(text).slice(0, 200));

// Where a target's sequence came from (its origin, kept with the workspace's target), in words.
export function targetOriginText(origin) {
  if (!origin) return null;
  const day = String(origin.retrieval?.retrieved ?? '').slice(0, 10);
  const check = origin.check?.status === 'identical' ? '; its translation is the record\'s' : origin.check?.status === 'differs' ? `; ${origin.check.message}` : '';
  if (origin.service === 'NCBI') return `The RefSeq transcript ${origin.accession} from NCBI${day ? `, retrieved ${day}` : ''}: the whole record, numbered from its coding sequence (${origin.feature.replace(/^CDS /, '')})${check}.`;
  if (origin.service === 'Ensembl') return `The Ensembl transcript ${origin.accession}${day ? `, retrieved ${day}` : ''}${origin.versionDiffers ? ` (the data name ${origin.named}; Ensembl serves its current release only, and each variant's reference base was checked against this one)` : ''}.`;
  return `${origin.whole ? 'The whole record' : `The coding sequence (${origin.feature.replace(/^CDS /, '')})`} of the GenBank record ${origin.accession}${origin.file ? `, from ${origin.file}` : ''}${origin.label ? ` (${origin.label})` : ''}${check}.`;
}
