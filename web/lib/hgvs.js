// MAVE-HGVS: the variant names of MaveDB, a strict subset of HGVS defined by the mavehgvs package
// (VariantEffect, BSD-3; https://github.com/VariantEffect/mavehgvs, spec docs/spec.rst). This is
// an independent parser written to the same grammar and rules as mavehgvs 0.8.1, not a port of
// its regular expressions: on a corpus of 16,959 strings (mavehgvs's own test cases, identifiers
// from public data sets, generated variants and near-misses) it accepts exactly what mavehgvs
// accepts, gives the same reason for what it refuses and writes the same canonical form
// (validation suite `hgvs`, reference/mavehgvs.json).
//
//   parseHgvs('p.[Ala12Val;Gly13Asp]')            → { ok: true, prefix: 'p', components: [...], … }
//   parseHgvs('A12V', { mode: 'lenient' })         → p.Ala12Val, with a note of what was changed
//
// Strict mode is MAVE-HGVS as written (for export and validation). Lenient mode also reads what
// lab tables and older MaveDB records hold, and normalizes it to MAVE-HGVS, saying what it changed
// (requirement D3; the original is always kept beside it by the caller):
//   Enrich2's _wt and _sy; WT, wt, wild-type; one-letter amino acids (A12V, p.A12V, A12*, A12=,
//   multi-variants written "A12V G13D"); * and X… for stop codons are read only as written in
//   one-letter form (* is Ter; X is refused, it means "any"); predicted forms in parentheses;
//   multi-variants out of order, with repeated components, or holding equalities; a substitution
//   to the same amino acid (p.Ala12Ala) as synonymous.

export const AA3 = ['Ala', 'Arg', 'Asn', 'Asp', 'Cys', 'Gln', 'Glu', 'Gly', 'His', 'Ile', 'Leu', 'Lys', 'Met', 'Phe', 'Pro', 'Ser', 'Thr', 'Trp', 'Tyr', 'Val', 'Ter'];
export const AA1 = ['A', 'R', 'N', 'D', 'C', 'Q', 'E', 'G', 'H', 'I', 'L', 'K', 'M', 'F', 'P', 'S', 'T', 'W', 'Y', 'V', '*'];
export const THREE_TO_ONE = Object.fromEntries(AA3.map((a, i) => [a, AA1[i]]));
export const ONE_TO_THREE = Object.fromEntries(AA1.map((a, i) => [a, AA3[i]]));
const AA3_SET = new Set(AA3);

export const PREFIXES = ['c', 'g', 'm', 'n', 'o', 'p', 'r'];
// The position syntax each prefix allows: plain positions, intronic offsets, and (c. only) UTR.
const POSITION_SYNTAX = { c: 'utr', n: 'intron', r: 'intron', g: 'plain', m: 'plain', o: 'plain', p: 'protein' };

const PARSE_FAILED = 'failed regular expression validation';

// --- Positions -----------------------------------------------------------------------------------
// { position: integer (negative in the 5' UTR), utr: true | null, intron: integer | null, aa: 'Ala' | null }

const DIGITS = /^[1-9][0-9]*/;

// Reads a position at text[i…] in a prefix's syntax; returns { pos, end } or null.
function readPosition(text, i, syntax) {
  let j = i;
  let aa = null;
  if (syntax === 'protein') {
    aa = text.slice(j, j + 3);
    if (!AA3_SET.has(aa)) return null;
    j += 3;
  }
  let sign = '';
  if (syntax === 'utr' && (text[j] === '*' || text[j] === '-')) {
    sign = text[j];
    j += 1;
  }
  const digits = DIGITS.exec(text.slice(j));
  if (!digits) return null;
  j += digits[0].length;
  let intron = null;
  if ((syntax === 'utr' || syntax === 'intron') && (text[j] === '+' || text[j] === '-')) {
    const offset = DIGITS.exec(text.slice(j + 1));
    if (offset) {
      intron = Number(text[j] + offset[0]);
      j += 1 + offset[0].length;
    }
  }
  const n = Number(digits[0]);
  return { pos: { position: sign === '-' ? -n : n, utr: sign ? true : null, intron, aa }, end: j };
}

export function formatPosition(p) {
  let s = p.utr && p.position > 0 ? `*${p.position}` : `${p.position}`;
  if (p.intron !== null && p.intron !== undefined) s += p.intron > 0 ? `+${p.intron}` : `${p.intron}`;
  else if (p.aa) s = `${p.aa}${s}`;
  return s;
}

// mavehgvs's VariantPosition equality: the amino acid is not compared.
export function samePosition(a, b) {
  return a.position === b.position && (a.intron ?? null) === (b.intron ?? null) && (a.utr ?? null) === (b.utr ?? null);
}

// mavehgvs's ordering: 5' UTR < coding < 3' UTR; within a base, intronic offsets on either side.
export function positionLess(a, b) {
  const au = a.utr ?? null;
  const bu = b.utr ?? null;
  if (au === bu) {
    if (a.position === b.position) {
      const ai = a.intron ?? null;
      const bi = b.intron ?? null;
      if (ai === bi) return false;
      if (ai === null) return bi > 0;
      if (bi === null) return ai < 0;
      return ai < bi;
    }
    return a.position < b.position;
  }
  if (au) return a.position < 0;
  return b.position >= 0;
}

const positionLessEqual = (a, b) => positionLess(a, b) || samePosition(a, b);

// mavehgvs's VariantPosition.is_adjacent (with its documented blind spots).
export function adjacent(a, b) {
  const au = a.utr ?? null;
  const bu = b.utr ?? null;
  const ai = a.intron ?? null;
  const bi = b.intron ?? null;
  if (au === bu) {
    if (ai === null && bi === null) return Math.abs(a.position - b.position) === 1;
    if (a.position === b.position) {
      if (ai !== null && bi !== null) return Math.abs(ai - bi) === 1;
      return ai === -1 || ai === 1 || bi === -1 || bi === 1;
    }
    return false;
  }
  return (a.position === -1 && b.position === 1) || (b.position === -1 && a.position === 1);
}

// --- Components ----------------------------------------------------------------------------------
// { type: 'sub' | 'equal' | 'del' | 'dup' | 'ins' | 'delins' | 'fs',
//   start: position | null, end: position | null (ranges), ref, alt (substitutions),
//   seq (insertions, delins), equal: '=' | '(=)' (equalities) }

const DNA_SEQ = /^[ACGT]+$/;
const RNA_SEQ = /^[acgu]+$/;

function readAminoAcids(text) {
  if (!text.length || text.length % 3) return null;
  for (let i = 0; i < text.length; i += 3) if (!AA3_SET.has(text.slice(i, i + 3))) return null;
  return text;
}

// One component (the text after "p." or inside "[…]") in a prefix's grammar, or null.
function readComponent(prefix, text) {
  const syntax = POSITION_SYNTAX[prefix];
  if (prefix === 'p') {
    if (text === '=') return { type: 'equal', start: null, end: null, equal: '=' };
    if (text === '(=)') return { type: 'equal', start: null, end: null, equal: '(=)' };
  } else if (text === '=') {
    return { type: 'equal', start: null, end: null, equal: '=' };
  }
  const first = readPosition(text, 0, syntax);
  if (!first) return null;
  let i = first.end;
  let second = null;
  if (text[i] === '_') {
    second = readPosition(text, i + 1, syntax);
    if (!second) return null;
    i = second.end;
  }
  const rest = text.slice(i);
  const start = first.pos;
  const end = second ? second.pos : null;
  const nucleotides = prefix === 'r' ? RNA_SEQ : DNA_SEQ;
  if (rest === '=') {
    // n. equality takes no position; p. equality takes an amino-acid position or range.
    if (prefix === 'n') return null;
    return { type: 'equal', start, end, equal: '=' };
  }
  if (rest === 'del') return { type: 'del', start, end };
  if (rest === 'dup') return { type: 'dup', start, end };
  if (rest.startsWith('delins')) {
    const seq = rest.slice(6);
    if (prefix === 'p' ? !readAminoAcids(seq) : !nucleotides.test(seq)) return null;
    return { type: 'delins', start, end, seq };
  }
  if (rest.startsWith('ins')) {
    const seq = rest.slice(3);
    if (!end || (prefix === 'p' ? !readAminoAcids(seq) : !nucleotides.test(seq))) return null;
    return { type: 'ins', start, end, seq };
  }
  if (end) return null;
  if (prefix === 'p') {
    if (rest === 'fs') return { type: 'fs', start, end: null };
    if (rest.length === 3 && AA3_SET.has(rest)) return { type: 'sub', start, end: null, ref: start.aa, alt: rest };
    return null;
  }
  const sub = /^([A-Za-z])>([A-Za-z])$/.exec(rest);
  if (sub && nucleotides.test(sub[1]) && nucleotides.test(sub[2])) return { type: 'sub', start, end: null, ref: sub[1], alt: sub[2] };
  return null;
}

function formatComponent(prefix, c) {
  const range = c.end ? `${formatPosition(c.start)}_${formatPosition(c.end)}` : c.start ? formatPosition(c.start) : '';
  switch (c.type) {
    case 'sub': return prefix === 'p' ? `${formatPosition(c.start)}${c.alt}` : `${formatPosition(c.start)}${c.ref}>${c.alt}`;
    case 'fs': return `${formatPosition(c.start)}fs`;
    case 'del': case 'dup': return `${range}${c.type}`;
    case 'ins': case 'delins': return `${range}${c.type}${c.seq}`;
    case 'equal': return `${range}${c.equal}`;
    default: throw new Error(`unknown variant type ${c.type}`);
  }
}

// The canonical string of a parsed variant.
export function formatHgvs(v) {
  const parts = v.components.map((c) => formatComponent(v.prefix, c));
  const body = parts.length > 1 ? `[${parts.join(';')}]` : parts[0];
  return `${v.target ? `${v.target}:` : ''}${v.prefix}.${body}`;
}

// The checks mavehgvs makes after its regular expression, in its order. Returns an error or null.
function componentError(c, relaxed) {
  if (c.end) {
    if (!positionLess(c.start, c.end)) {
      if (!relaxed) return 'start position must be before end position';
      [c.start, c.end] = [c.end, c.start];
    }
    if (c.type === 'ins' && !adjacent(c.start, c.end)) return 'insertion positions must be adjacent';
  }
  return null;
}

function overlap(a, b) {
  if (!a.end && !b.end) return samePosition(a.start, b.start) ? 'multi-variant has multiple changes at same position' : null;
  const [s1, e1] = [a.start, a.end ?? a.start];
  const [s2, e2] = [b.start, b.end ?? b.start];
  const inside = (p, s, e) => positionLessEqual(s, p) && positionLessEqual(p, e);
  if (!a.end) return inside(a.start, s2, e2) ? 'multi-variant has overlapping changes' : null;
  if (!b.end) return inside(b.start, s1, e1) ? 'multi-variant has overlapping changes' : null;
  return inside(s2, s1, e1) || inside(e2, s1, e1) || inside(s1, s2, e2) || inside(e1, s2, e2) ? 'multi-variant has overlapping changes' : null;
}

function strictParse(text, relaxed = false) {
  const fail = (error) => ({ ok: false, error });
  if (typeof text !== 'string') return fail(PARSE_FAILED);
  let target = null;
  let rest = text;
  const colon = text.indexOf(':');
  if (colon >= 0) {
    target = text.slice(0, colon);
    if (!/^[A-Za-z0-9_.-]+$/.test(target)) return fail(PARSE_FAILED);
    rest = text.slice(colon + 1);
  }
  const prefix = rest[0];
  if (!PREFIXES.includes(prefix) || rest[1] !== '.') return fail(PARSE_FAILED);
  const body = rest.slice(2);
  let components;
  if (body.startsWith('[') && body.endsWith(']')) {
    const parts = body.slice(1, -1).split(';');
    if (parts.length < 2) return fail(PARSE_FAILED);
    components = parts.map((part) => readComponent(prefix, part));
  } else {
    components = [readComponent(prefix, body)];
  }
  if (components.some((c) => c === null)) return fail(PARSE_FAILED);
  const multi = components.length > 1;
  for (const c of components) {
    const error = componentError(c, relaxed);
    if (error) return fail(error);
    if (multi && c.type === 'equal' && (prefix !== 'p' || !c.start || c.end)) {
      return fail('multi-variants cannot contain target-identical variants unless they are single amino acids');
    }
  }
  if (multi) {
    for (let i = 0; i < components.length; i += 1) {
      for (let j = i + 1; j < components.length; j += 1) {
        const error = overlap(components[i], components[j]);
        if (error) return fail(error);
      }
    }
    const sorted = components.map((c, i) => ({ c, i })).sort((a, b) => (positionLess(a.c.start, b.c.start) ? -1 : positionLess(b.c.start, a.c.start) ? 1 : a.i - b.i)).map((x) => x.c);
    if (sorted.some((c, i) => c !== components[i])) {
      if (!relaxed) return fail('multi-variants not in sorted order');
      components = sorted;
    }
    const shifts = components.filter((c) => c.type === 'fs').length;
    if (shifts > 1) return fail('maximum of one frame shift is permitted');
    if (shifts && components[components.length - 1].type !== 'fs') return fail('no variants are permitted to follow a frame shift');
  }
  const single = components.length === 1 ? components[0] : null;
  return {
    ok: true,
    target,
    prefix,
    multi,
    components,
    // mavehgvs's is_synonymous and is_target_identical (false for multi-variants).
    synonymous: Boolean(single && single.type === 'equal' && prefix === 'p'),
    identical: Boolean(single && single.type === 'equal' && (prefix !== 'p' || !single.start)),
  };
}

// --- Lenient forms -------------------------------------------------------------------------------

const ONE_LETTER = /^([ACDEFGHIKLMNPQRSTVWY*])([1-9][0-9]*)([ACDEFGHIKLMNPQRSTVWY*=])$/;

// One-letter protein components ("A12V", "A12*", "*12K"?), as three-letter MAVE-HGVS.
function fromOneLetter(token) {
  const m = ONE_LETTER.exec(token);
  if (!m) return null;
  if (m[1] === '*') return null; // a stop-codon read-through is written p.Ter12Lys, not *12K: refused rather than guessed
  return `${ONE_TO_THREE[m[1]]}${m[2]}${m[3] === '=' ? '=' : ONE_TO_THREE[m[3]]}`;
}

// Parses a variant name. options.mode: 'strict' (default) or 'lenient'; options.prefix: the
// prefix to assume for prefix-less lab forms and Enrich2's _wt/_sy ('p' by default).
// Returns { ok: true, canonical, prefix, target, multi, components, synonymous, identical,
// changes: [text] } or { ok: false, error }.
export function parseHgvs(text, options = {}) {
  const mode = options.mode ?? 'strict';
  const strict = strictParse(text);
  if (strict.ok || mode === 'strict') return strict.ok ? { ...strict, canonical: formatHgvs(strict), changes: [] } : strict;
  const changes = [];
  const prefix = options.prefix ?? 'p';
  let s = String(text ?? '').trim();
  if (s !== text) changes.push('removed surrounding spaces');
  const special = { _wt: `${prefix}.=`, wt: `${prefix}.=`, WT: `${prefix}.=`, 'wild-type': `${prefix}.=`, wildtype: `${prefix}.=`, _sy: 'p.(=)' };
  if (special[s] !== undefined) {
    if (s === '_sy' && prefix !== 'p') return { ok: false, error: 'Enrich2\'s _sy (synonymous variants pooled) has no meaning at the nucleotide level' };
    changes.push(s === '_sy' ? 'Enrich2\'s _sy (synonymous variants pooled) read as p.(=)' : `${s} read as the wild type (${special[s]})`);
    s = special[s];
  }
  // A predicted form in parentheses: p.(Glu27Trp).
  let m = /^((?:[A-Za-z0-9_.-]+:)?[cgmnopr]\.)\((.+)\)$/.exec(s);
  if (m && m[2] !== '=') {
    s = m[1] + m[2];
    changes.push('removed the parentheses of a predicted form');
  }
  // One-letter protein names, with or without "p.", alone or several separated by spaces.
  const bare = s.startsWith('p.') ? s.slice(2) : s;
  const tokens = bare.replace(/^\[|\]$/g, '').split(/[\s;]+/).filter(Boolean);
  if (tokens.length && tokens.every((t) => ONE_LETTER.test(t))) {
    const converted = tokens.map(fromOneLetter);
    if (converted.some((t) => t === null)) return { ok: false, error: 'a stop codon is not a reference residue to substitute from (write p.Ter…)' };
    s = converted.length > 1 ? `p.[${converted.join(';')}]` : `p.${converted[0]}`;
    changes.push('one-letter amino acids written in three letters');
  } else if (/^[A-Z][a-z]{2}[1-9][0-9]*(?:[A-Z][a-z]{2}|=)$/.test(s)) {
    s = `p.${s}`;
    changes.push('added the p. prefix');
  }
  // Stop written * in three-letter names: p.Ala12*.
  if (/^p\..*\*/.test(s) && !/^p\.\(=\)$/.test(s)) {
    const replaced = s.replace(/([A-Z][a-z]{2}[1-9][0-9]*)\*/g, '$1Ter');
    if (replaced !== s) {
      s = replaced;
      changes.push('* written as Ter');
    }
  }
  // Multi-variants: repeated components, bare or nucleotide equalities, order.
  m = /^((?:[A-Za-z0-9_.-]+:)?([cgmnopr])\.)\[(.+)\]$/.exec(s);
  if (m) {
    let parts = m[3].split(';');
    const unique = [...new Set(parts)];
    if (unique.length < parts.length) changes.push(`removed ${parts.length - unique.length} repeated component${parts.length - unique.length > 1 ? 's' : ''}`);
    parts = unique;
    const kept = parts.filter((part) => !(part === '=' || part === '(=)' || (m[2] !== 'p' && /=$/.test(part))));
    if (kept.length < parts.length) changes.push(`removed ${parts.length - kept.length} equalit${parts.length - kept.length > 1 ? 'ies' : 'y'} from a multi-variant`);
    if (!kept.length) s = `${m[1]}=`;
    else s = kept.length === 1 ? `${m[1]}${kept[0]}` : `${m[1]}[${kept.join(';')}]`;
  }
  // A substitution to the same amino acid is synonymous.
  s = s.replace(/^(p\.)([A-Z][a-z]{2})([1-9][0-9]*)\2$/, (whole, p, aa, n) => {
    changes.push(`${aa}${n}${aa} written as synonymous (${aa}${n}=)`);
    return `${p}${aa}${n}=`;
  });
  const parsed = strictParse(s, true);
  if (!parsed.ok) return { ok: false, error: strict.error === PARSE_FAILED ? `not a MAVE-HGVS name, even read leniently (${parsed.error})` : strict.error };
  const canonical = formatHgvs(parsed);
  if (canonical !== s) changes.push('components put in order');
  return { ...parsed, canonical, changes };
}

// --- Against a target ----------------------------------------------------------------------------

// Checks a parsed variant against its target sequence, as mavehgvs's targetseq option does:
// positions in range, and the reference amino acid (or base, for nucleotide substitutions) the
// target's. sequence: amino acids for p. variants, bases for the others (DNA upper case, RNA lower
// case). Positions in UTRs or introns are not checked (the target does not hold them). Returns
// [{ position, expected, found, message }].
export function targetMismatches(variant, sequence) {
  const problems = [];
  for (const c of variant.components) {
    if (c.type === 'equal' && !c.start) continue;
    const positions = [c.start, c.end].filter(Boolean);
    if (positions.some((p) => p.utr || (p.intron !== null && p.intron !== undefined))) continue;
    for (const p of positions) {
      if (p.position > sequence.length) {
        problems.push({ position: p.position, message: `position ${p.position} is beyond the target (${sequence.length})` });
        continue;
      }
      const found = sequence[p.position - 1];
      if (variant.prefix === 'p') {
        const expected = THREE_TO_ONE[p.aa];
        if (expected !== found) problems.push({ position: p.position, expected, found, message: `the target has ${ONE_TO_THREE[found] ?? found} at ${p.position}, not ${p.aa}` });
      } else if (c.type === 'sub' && positions.length === 1 && c.ref !== found) {
        problems.push({ position: p.position, expected: c.ref, found, message: `the target has ${found} at ${p.position}, not ${c.ref}` });
      }
    }
  }
  return problems;
}
