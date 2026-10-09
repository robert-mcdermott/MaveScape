// Targets: the reference sequence variants are named against (requirement E3), from a FASTA file
// or pasted text. A target is the design's target object (conventions.md, "Targets"):
// { id, name, sequenceType: 'dna' | 'protein', sequence, codingStart, offset, organism,
//   identifiers: { uniprot, refseq, ensembl, gene }, differences }.

const CODON_ORDER = 'TCAG';
const CODON_AMINO_ACIDS = 'FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG';
// The standard genetic code (NCBI table 1).
export const CODONS = (() => {
  const table = {};
  let i = 0;
  for (const a of CODON_ORDER) for (const b of CODON_ORDER) for (const c of CODON_ORDER) table[a + b + c] = CODON_AMINO_ACIDS[i++];
  return table;
})();

// Records of FASTA text: [{ id, description, sequence }]. Line breaks and spaces inside sequences
// are removed; digits (from GenBank-style numbered listings) too. Text with no ">" line is one
// unnamed sequence (a pasted sequence).
export function parseFasta(text) {
  const records = [];
  let current = null;
  for (const raw of String(text).split(/\r\n|\n|\r/)) {
    const line = raw.trim();
    if (!line || line.startsWith(';')) continue;
    if (line.startsWith('>')) {
      const header = line.slice(1).trim();
      const space = header.search(/\s/);
      current = { id: space < 0 ? header : header.slice(0, space), description: space < 0 ? '' : header.slice(space + 1).trim(), sequence: '' };
      records.push(current);
    } else {
      if (!current) {
        current = { id: '', description: '', sequence: '' };
        records.push(current);
      }
      current.sequence += line.replace(/[\s0-9]/g, '');
    }
  }
  for (const record of records) record.sequence = record.sequence.toUpperCase();
  return records.filter((r) => r.sequence.length || r.id);
}

// 'dna' when the sequence is only A, C, G, T (and N, U), else 'protein'; with the letters that
// are neither, for a message.
export function sequenceType(sequence) {
  const s = sequence.toUpperCase();
  if (/^[ACGTUN]+$/.test(s)) return { type: 'dna', invalid: [] };
  const invalid = [...new Set(s.replace(/[ACDEFGHIKLMNPQRSTVWY*]/g, ''))];
  return { type: 'protein', invalid };
}

// Translates DNA from a 1-based start, codon by codon; a final partial codon is left out.
// Returns { protein, stops: [positions of internal stops], partial: number of leftover bases }.
export function translate(dna, codingStart = 1) {
  const s = dna.toUpperCase().replace(/U/g, 'T');
  let protein = '';
  const stops = [];
  let i = codingStart - 1;
  for (; i + 3 <= s.length; i += 3) {
    const aa = CODONS[s.slice(i, i + 3)] ?? 'X';
    protein += aa;
    // Internal: another whole codon follows (a final partial codon does not count).
    if (aa === '*' && i + 6 <= s.length) stops.push(protein.length);
  }
  return { protein, stops, partial: s.length - i };
}

// A design target from a FASTA record (or pasted sequence), with problems a person should see:
// { target, messages: [{ level, message }] }.
export function targetFromSequence(record, options = {}) {
  const messages = [];
  const sequence = record.sequence.toUpperCase();
  const { type, invalid } = sequenceType(sequence);
  if (invalid.length) messages.push({ level: 'error', message: `The sequence holds letters that are neither bases nor amino acids: ${invalid.join(', ')}.` });
  if (type === 'dna' && /[NU]/.test(sequence)) messages.push({ level: 'error', message: 'A DNA target may hold only A, C, G and T (no N or U).' });
  const id = (options.id ?? record.id ?? '').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 64) || 'target';
  const name = options.name ?? (record.description || record.id || 'Target');
  const target = { id, name, sequenceType: type, sequence, offset: options.offset ?? 0 };
  if (type === 'dna') {
    target.codingStart = options.codingStart ?? 1;
    const t = translate(sequence, target.codingStart);
    if (t.partial) messages.push({ level: 'warning', message: `From base ${target.codingStart}, the sequence ends with ${t.partial} base${t.partial > 1 ? 's' : ''} beyond the last whole codon.` });
    if (t.stops.length) messages.push({ level: 'warning', message: `The reading frame holds a stop codon at codon ${t.stops[0]}${t.stops.length > 1 ? ` (and ${t.stops.length - 1} more)` : ''}: check the coding start.` });
  }
  const uniprot = /(?:^|\|)(?:sp|tr)\|([A-Z0-9]{6,10})\|/.exec(record.id ?? '')?.[1] ?? /^([OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9](?:[A-Z][A-Z0-9]{2}[0-9]){1,2})$/.exec(record.id ?? '')?.[1];
  if (uniprot) target.identifiers = { uniprot };
  return { target, messages };
}

// The protein the target encodes (its own sequence for a protein target).
export function targetProtein(target) {
  return target.sequenceType === 'protein' ? target.sequence.toUpperCase() : translate(target.sequence, target.codingStart ?? 1).protein;
}

// Where a protein (the target's) sits in a reference protein: { offset, differences } for the
// best ungapped placement, or null when under 80% of residues agree. For setting a target's offset
// from its UniProt sequence.
export function placeInReference(protein, reference) {
  let best = null;
  for (let offset = 0; offset + protein.length <= reference.length; offset += 1) {
    let same = 0;
    for (let i = 0; i < protein.length; i += 1) if (protein[i] === reference[offset + i]) same += 1;
    if (!best || same > best.same) best = { offset, same };
    if (same === protein.length) break;
  }
  if (!best || best.same < 0.8 * protein.length) return null;
  const differences = [];
  for (let i = 0; i < protein.length; i += 1) {
    if (protein[i] !== reference[best.offset + i]) differences.push({ position: i + 1, target: protein[i], reference: reference[best.offset + i] });
  }
  return { offset: best.offset, differences };
}
