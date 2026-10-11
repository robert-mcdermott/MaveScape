// What a nucleotide variant does to the protein its target encodes (requirement D10, wave 3,
// slice 3): its class (synonymous, missense, nonsense, start or stop lost, in-frame deletion,
// insertion, duplication or deletion-insertion, frameshift; a splice site, an intron, a UTR) and
// its protein change in MAVE-HGVS. The variant is applied to the target's sequence and both coding
// sequences translated, the altered one to its first stop (into the 3′ UTR when the stop is lost);
// the two proteins are then compared as HGVS describes protein changes, step for step as
// biocommons hgvs 1.5 does (Apache-2.0; utils/altseq_to_hgvsp.py), which the validation suite
// `consequences` checks variant by variant. MAVE-HGVS has fewer forms than HGVS, so:
//
//   - a frameshift is written short, at the first amino acid it changes (p.Gly5fs);
//   - a lost stop is the substitution at the stop (p.Ter120Gln), with no extension;
//   - a change to a first codon that is a methionine is "start lost", named only when it is a
//     substitution (p.Met1Val; HGVS writes p.Met1? for any, its effect unknown);
//   - substitutions changing several amino acids are a multi-variant (p.[Met133Thr;Phe134Leu]), as
//     MaveDB's tables write them, where biocommons writes one deletion-insertion over the span;
//   - nothing after a stop the variant creates is named: it is not made (biocommons names the
//     residues an insertion holds after its stop: p.Lys1171delinsGluTerGlu is p.Lys1171delinsGluTer);
//   - a change of several codons that leaves the protein as it was names each codon (p.[Phe2=;
//     Leu3=]), as codon tables are named (codons.js).
//
// Positions: c. counts from the target's coding start (c.1 is the first base of its first codon),
// c.-N before it (the 5′ UTR) and c.*N after its stop (the 3′ UTR); n., g., m., o. and r. count
// from the target's first base. An intronic position (c.67+1) is not in the target: its variant is
// a splice site (within two bases of the exon, VEP's splice donor and acceptor, or across the
// exon's edge) or intronic, with no protein change.
//
//   codingFrame(target)             → { sequence, start, end, protein, stop } | null
//   consequenceOf(parsed, frame)    → { class, protein, position, ref, alt, codons, changed, mixed,
//                                       region } | { problem }

import { CODONS } from './target.js';
import { ONE_TO_THREE } from './hgvs.js';

export const CONSEQUENCES = ['wild type', 'synonymous', 'missense', 'nonsense', 'start lost', 'stop lost', 'multi-variant', 'deletion', 'insertion', 'duplication', 'deletion-insertion', 'frameshift', 'splice site', 'intronic', '5\' UTR', '3\' UTR'];

const three = (aa) => ONE_TO_THREE[aa] ?? 'Xaa';
const seq3 = (aas) => [...aas].map(three).join('');

// The target's coding sequence: its sequence (upper case), the 0-based index of the first base of
// the reading frame (start), the end of the coding sequence (exclusive: after the first stop codon
// in frame, else after the last whole codon), and the protein, with its stop (*) when it has one.
// null for a protein target.
export function codingFrame(target) {
  if (!target || target.sequenceType !== 'dna') return null;
  const sequence = String(target.sequence ?? '').toUpperCase().replace(/U/g, 'T');
  const start = Math.max(0, (target.codingStart ?? 1) - 1);
  const { protein, end } = translateFrom(sequence, start, true);
  return { sequence, start, end, protein, stop: protein.endsWith('*') };
}

// Translates from a 0-based start, to the first stop (inclusive) when toStop, else to the last
// whole codon (or `limit`).
function translateFrom(sequence, start, toStop, limit = sequence.length) {
  let protein = '';
  let i = start;
  for (; i + 3 <= limit; i += 3) {
    const aa = CODONS[sequence.slice(i, i + 3)] ?? 'X';
    protein += aa;
    if (toStop && aa === '*') return { protein, end: i + 3 };
  }
  return { protein, end: i };
}

// A position's 0-based index in the target's sequence, or null when it is not in it (an intronic
// offset). c. positions count from the coding start; the others from the first base.
export function sequenceIndex(p, prefix, frame) {
  if (p.intron !== null && p.intron !== undefined) return null;
  if (prefix !== 'c') return p.position - 1;
  if (p.utr && p.position > 0) return frame.end + p.position - 1;
  if (p.position < 0) return frame.start + p.position;
  return frame.start + p.position - 1;
}

const none = (cls, region) => ({ class: cls, protein: null, position: -1, ref: null, alt: null, codons: 0, changed: 0, mixed: false, region });

// A c. position in a UTR (c.-12, c.*30): the target need not hold it (a coding construct has no
// UTRs); such a position is then not checked, as mavehgvs checks none.
const utrPosition = (p, prefix) => prefix === 'c' && (p.position < 0 || (p.utr && p.position > 0));
const written = (p, prefix) => (prefix === 'c' && p.utr && p.position > 0 ? `*${p.position}` : String(p.position));

// A nucleotide variant against the target, as hgvs.js's targetMismatches checks a protein's: each
// position in it (a c. position counted from the coding start; one in the coding numbering past
// the stop is written c.*N), and a substitution's reference base the target's. Intronic positions,
// and UTR positions beyond what the target holds, are not checked. [{ position, message }].
export function nucleotideMismatches(parsed, frame) {
  const problems = [];
  const length = frame.sequence.length;
  for (const c of parsed.components) {
    if (c.type === 'equal' && !c.start) continue;
    const positions = [c.start, c.end].filter(Boolean);
    if (positions.some((p) => p.intron !== null && p.intron !== undefined)) continue;
    for (const p of positions) {
      const i = sequenceIndex(p, parsed.prefix, frame);
      if (i < 0 || i >= length) {
        if (!utrPosition(p, parsed.prefix)) problems.push({ position: p.position, message: `position ${written(p, parsed.prefix)} is beyond the target (${parsed.prefix === 'c' ? `c.${1 - frame.start}–c.${length - frame.start}` : length})` });
        continue;
      }
      if (parsed.prefix === 'c' && !p.utr && p.position > 0 && i >= frame.end && frame.stop) {
        problems.push({ position: p.position, message: `position ${p.position} is after the stop codon (c.${frame.end - frame.start}): it is written c.*${i - frame.end + 1}` });
        continue;
      }
      if (c.type === 'sub' && positions.length === 1 && c.ref !== frame.sequence[i]) {
        problems.push({ position: p.position, expected: c.ref, found: frame.sequence[i], message: `the target has ${frame.sequence[i]} at ${written(p, parsed.prefix)}, not ${c.ref}` });
      }
    }
  }
  return problems;
}

// The consequence of a parsed nucleotide variant (hgvs.js) for the target's protein.
export function consequenceOf(parsed, frame) {
  if (!frame) return { problem: 'the target is not a DNA sequence' };
  if (parsed.prefix === 'p') return { problem: 'a protein variant' };
  if (parsed.identical) return { ...none('wild type', 'coding'), protein: 'p.=' };
  // Each component as a replacement of [from, to) by a sequence; intronic ones apart.
  const edits = [];
  let intronic = null;
  let utrOutside = null;
  for (const c of parsed.components) {
    if (c.type === 'equal') continue;
    const positions = [c.start, c.end].filter(Boolean);
    const offsets = positions.map((p) => p.intron).filter((x) => x !== null && x !== undefined);
    if (offsets.length) {
      const site = offsets.some((x) => Math.abs(x) <= 2) || offsets.length < positions.length;
      intronic = site || intronic === 'splice site' ? 'splice site' : 'intronic';
      continue;
    }
    const s = sequenceIndex(c.start, parsed.prefix, frame);
    const e = c.end ? sequenceIndex(c.end, parsed.prefix, frame) : s;
    if (s < 0 || e >= frame.sequence.length) {
      // In a UTR beyond what the target holds: a UTR variant, whatever it does there.
      if (positions.every((p) => utrPosition(p, parsed.prefix)) && (s < 0) === (e < 0)) {
        utrOutside = s < 0 ? '5\' UTR' : '3\' UTR';
        continue;
      }
      return { problem: `position ${written(s < 0 || s >= frame.sequence.length ? c.start : c.end, parsed.prefix)} is outside the target` };
    }
    if (c.type === 'sub') edits.push({ from: s, to: s + 1, seq: c.alt, sub: true });
    else if (c.type === 'del') edits.push({ from: s, to: e + 1, seq: '' });
    else if (c.type === 'delins') edits.push({ from: s, to: e + 1, seq: c.seq, sub: c.seq.length === e - s + 1 });
    else if (c.type === 'dup') edits.push({ from: e + 1, to: e + 1, seq: frame.sequence.slice(s, e + 1), span: [s, e + 1] });
    else if (c.type === 'ins') edits.push({ from: s + 1, to: s + 1, seq: c.seq });
    else return { problem: `a ${c.type} cannot be applied to a sequence` };
  }
  if (intronic) return none(intronic, 'intron');
  if (!edits.length) return utrOutside ? none(utrOutside, utrOutside) : { ...none('wild type', 'coding'), protein: 'p.=' };

  // Where the edits fall: the 5′ UTR (shifting the coding start), the coding sequence, the 3′ UTR.
  let shift = 0;
  let coding = false;
  let first = Infinity;
  let region = null;
  for (const x of edits) {
    // A duplication is where the bases it repeats are (the copy follows them).
    const [from, to] = x.span ?? [x.from, x.to];
    if (to <= frame.start) {
      shift += x.seq.length - (x.to - x.from);
      region ??= '5\' UTR';
    } else if (from >= frame.end) {
      region ??= '3\' UTR';
    } else {
      // A change reaching from the 5′ UTR into the first codon removes the start.
      if (from < frame.start) return none('start lost', 'coding');
      coding = true;
      first = Math.min(first, x.from);
    }
  }
  if (!coding) return none(region, region);
  let alt = frame.sequence;
  for (const x of edits.slice().sort((a, b) => b.from - a.from)) alt = alt.slice(0, x.from) + x.seq + alt.slice(x.to);
  const ref = frame.protein;
  const methionine = ref[0] === 'M';
  const lengthChange = alt.length - frame.sequence.length;
  // The codon of the first changed base (biocommons' variant_start_aa), 1-based.
  const variantStart = Math.floor((first - frame.start) / 3) + 1;

  if (!lengthChange && edits.every((x) => x.sub || x.from >= frame.end || x.to <= frame.start)) {
    // Substitutions: the codons compared one by one, over the reference's coding sequence.
    const altProtein = translateFrom(alt, frame.start, false, frame.end).protein;
    let codons = 0;
    const synonymous = [];
    const diffs = [];
    for (let k = 0; k < ref.length; k += 1) {
      const i = frame.start + 3 * k;
      if (alt.slice(i, i + 3) === frame.sequence.slice(i, i + 3)) continue;
      codons += 1;
      if (ref[k] === altProtein[k]) synonymous.push(k);
      else diffs.push(k);
    }
    if (!diffs.length) {
      if (!synonymous.length) return none('3\' UTR', '3\' UTR');
      const names = synonymous.map((k) => `${three(ref[k])}${k + 1}=`);
      const k = synonymous[0];
      return { class: 'synonymous', protein: names.length > 1 ? `p.[${names.join(';')}]` : `p.${names[0]}`, position: k + 1, ref: ref[k], alt: ref[k], codons, changed: 0, mixed: false, region: 'coding' };
    }
    // Changes after a stop the variant creates are not expressed.
    const stop = diffs.findIndex((k) => altProtein[k] === '*');
    const expressed = stop >= 0 ? diffs.slice(0, stop + 1) : diffs;
    const changed = expressed.length;
    const mixed = codons > diffs.length;
    if (expressed.length === 1) return { ...single(ref, altProtein, expressed[0], methionine), codons, changed, mixed, region: 'coding' };
    const k = expressed[0];
    if (k === 0 && methionine) return { ...none('start lost', 'coding'), position: 1, codons, changed, mixed };
    return { class: 'multi-variant', protein: `p.[${expressed.map((j) => `${three(ref[j])}${j + 1}${three(altProtein[j])}`).join(';')}]`, position: k + 1, ref: null, alt: null, codons, changed, mixed, region: 'coding' };
  }

  // Insertions and deletions. A frameshift's protein is translated to its first stop; one in frame
  // codon by codon to where the reference's coding sequence now ends (a stop it inserts is in the
  // insertion), and on to a stop when it has lost its own.
  const frameshift = lengthChange % 3 !== 0;
  let altProtein;
  if (frameshift) altProtein = translateFrom(alt, frame.start + shift, true).protein;
  else {
    const end = frame.end + lengthChange;
    altProtein = translateFrom(alt, frame.start + shift, false, end).protein;
    // A stop where the reference's is, or after it, ends the protein there (a duplicated stop).
    const stop = altProtein.indexOf('*', ref.length - 1);
    if (stop >= 0) altProtein = altProtein.slice(0, stop + 1);
    else if (frame.stop && !altProtein.endsWith('*')) altProtein += translateFrom(alt, frame.start + shift + 3 * altProtein.length, true).protein;
  }
  const out = describe(ref, altProtein, { frameshift, variantStart, methionine });
  return { ...out, codons: 0, changed: 0, mixed: false, region: 'coding' };
}

// One residue changed: missense, nonsense, start or stop lost.
function single(ref, alt, k, methionine) {
  const r = ref[k];
  const a = alt[k];
  const p = k + 1;
  const cls = p === 1 && methionine ? 'start lost' : r === '*' ? 'stop lost' : a === '*' ? 'nonsense' : 'missense';
  return { class: cls, protein: `p.${three(r)}${p}${three(a)}`, position: p, ref: r, alt: a };
}

// Two proteins compared as HGVS (and biocommons' AltSeqToHgvsp) describe a change of length.
function describe(ref, alt, { frameshift, variantStart, methionine }) {
  const result = (cls, protein, position, r = null, a = null) => ({ class: cls, protein, position, ref: r, alt: a });
  if (!alt.length) return result('start lost', null, 1);
  if (ref === alt) {
    const p = variantStart;
    if (p > ref.length) return result('synonymous', 'p.=', -1);
    return result('synonymous', `p.${three(ref[p - 1])}${p}=`, p, ref[p - 1], ref[p - 1]);
  }
  let start = 0;
  const bound = Math.min(ref.length, alt.length);
  while (start < bound && ref[start] === alt[start]) start += 1;
  if (start === 0 && methionine) return result('start lost', null, 1);
  const stopAt = ref.endsWith('*') ? ref.length : -1;
  if (frameshift) {
    if (start >= alt.length || start >= ref.length) {
      const p = Math.min(start, ref.length - 1);
      return result('frameshift', `p.${three(ref[p])}${p + 1}fs`, p + 1);
    }
    if (alt[start] === '*') return result('nonsense', `p.${three(ref[start])}${start + 1}Ter`, start + 1, ref[start], '*');
    if (start + 1 === stopAt) return result('stop lost', `p.Ter${start + 1}${three(alt[start])}`, start + 1, '*', alt[start]);
    return result('frameshift', `p.${three(ref[start])}${start + 1}fs`, start + 1);
  }
  // In frame: what is deleted and inserted, from the first difference to the last.
  const delta = alt.length - ref.length;
  const offset = start + Math.abs(delta);
  let insertion = delta > 0 ? alt.slice(start, offset) : '';
  let deletion = delta < 0 ? ref.slice(start, offset) : '';
  const refSub = delta < 0 ? ref.slice(offset) : ref.slice(start);
  const altSub = delta > 0 ? alt.slice(offset) : alt.slice(start);
  let last = -1;
  for (let i = 0; i < refSub.length; i += 1) if (refSub[i] !== altSub[i]) last = i;
  if (last < 0 && !deletion && insertion[0] === '*') last = 0;
  if (last >= 0) {
    insertion += altSub.slice(0, last + 1);
    deletion += refSub.slice(0, last + 1);
  }
  const s = start + 1;
  // Nothing after a stop it makes is named.
  if (insertion.indexOf('*') > 0) insertion = insertion.slice(0, insertion.indexOf('*') + 1);
  if (insertion[0] === '*') {
    if (s === alt.length && !deletion) return result('synonymous', `p.Ter${s}=`, s, '*', '*');
    return result('nonsense', `p.${three(deletion[0])}${s}Ter`, s, deletion[0], '*');
  }
  if (s === stopAt) return result('stop lost', `p.Ter${s}${three(insertion[0])}`, s, '*', insertion[0]);
  if (insertion.length === 1 && deletion.length === 1) {
    const cls = s === 1 && methionine ? 'start lost' : 'missense';
    return result(cls, `p.${three(deletion)}${s}${three(insertion)}`, s, deletion, insertion);
  }
  const range = (a, b) => (b > a ? `${three(ref[a - 1])}${a}_${three(ref[b - 1])}${b}` : `${three(ref[a - 1])}${a}`);
  if (deletion.length && insertion.length) return result('deletion-insertion', `p.${range(s, s + deletion.length - 1)}delins${seq3(insertion)}`, s);
  if (deletion.length) {
    if (deletion.length + s === stopAt) return result('nonsense', `p.${three(deletion[0])}${s}Ter`, s, deletion[0], '*');
    return result('deletion', `p.${range(s, s + deletion.length - 1)}del`, s);
  }
  // An insertion, or a duplication when it repeats the residues before it.
  const before = s - insertion.length - 1;
  if (before >= 0 && ref.slice(before, before + insertion.length) === insertion) return result('duplication', `p.${range(before + 1, before + insertion.length)}dup`, before + 1);
  return result('insertion', `p.${three(ref[s - 2])}${s - 1}_${three(ref[s - 1])}${s}ins${seq3(insertion)}`, s - 1);
}
