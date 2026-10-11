// The variants of a table, column by column (conventions.md, "Variants"): each row's identifier
// as written, its canonical MAVE-HGVS key, what kind of variant it is, where, and whether it
// agrees with the target (requirements D3, D5). Built once per import; never rewrites the
// original identifiers.
//
// Nucleotide variants of a DNA target are also read for what they do to its protein (wave 3,
// slice 3; consequence.js): their kind is their consequence (a codon change that keeps the amino
// acid is synonymous; a deletion of one base in the coding sequence a frameshift; c.67+1G>A a
// splice site), and proKey, proPosition, proRef and proAlt hold the protein change (p.Ala12Val),
// mixed the substitutions that change one amino acid and leave another codon synonymous (DiMSum's
// "mixed substitutions"). A name prefixed by a target (NM_007294.3:c.68A>G, LMNA:n.127G>A) must
// name the design's target; one naming another of a score set's targets is set aside (otherTarget).

import { AA1, THREE_TO_ONE, parseHgvs, targetMismatches } from './hgvs.js';
import { targetProtein } from './target.js';
import { codingFrame, consequenceOf, nucleotideMismatches } from './consequence.js';

export const KIND = {
  NONE: 0, WT: 1, SYNONYMOUS: 2, MISSENSE: 3, NONSENSE: 4, START_LOST: 5, STOP_LOST: 6, MULTI: 7,
  DELETION: 8, INSERTION: 9, DUPLICATION: 10, DELINS: 11, FRAMESHIFT: 12, NT_SUBSTITUTION: 13, OTHER: 14,
  SPLICE: 15, INTRONIC: 16, UTR5: 17, UTR3: 18,
};
export const KIND_NAMES = ['none', 'wild type', 'synonymous', 'missense', 'nonsense', 'start lost', 'stop lost', 'multi-variant',
  'deletion', 'insertion', 'duplication', 'deletion-insertion', 'frameshift', 'nucleotide substitution', 'other',
  'splice site', 'intronic', '5\' UTR', '3\' UTR'];

// A consequence's class (consequence.js) as a kind.
const KIND_OF_CLASS = {
  'wild type': KIND.WT, synonymous: KIND.SYNONYMOUS, missense: KIND.MISSENSE, nonsense: KIND.NONSENSE, 'start lost': KIND.START_LOST,
  'stop lost': KIND.STOP_LOST, 'multi-variant': KIND.MULTI, deletion: KIND.DELETION, insertion: KIND.INSERTION, duplication: KIND.DUPLICATION,
  'deletion-insertion': KIND.DELINS, frameshift: KIND.FRAMESHIFT, 'splice site': KIND.SPLICE, intronic: KIND.INTRONIC, '5\' UTR': KIND.UTR5, '3\' UTR': KIND.UTR3,
};

// The names a target may be given in a variant's prefix: its id and name, and its accessions
// (versioned as written).
export function targetLabels(target) {
  if (!target) return [];
  const ids = target.identifiers ?? {};
  return [target.id, target.name, target.label, ids.refseq, ids.ensembl, ids.genbank, ids.protein].filter(Boolean);
}

export const STATUS = { VALID: 1, WARNING: 2, INVALID: 3, UNMAPPED: 4 };
export const STATUS_NAMES = ['', 'valid', 'read leniently', 'invalid', 'unmapped'];

// Amino-acid codes for single substitutions: 1 + index in AA1 (A R N D C Q E G H I L K M F P S T
// W Y V *); 0 for none.
export const AA_CODE = Object.fromEntries(AA1.map((a, i) => [a, i + 1]));
export const aminoAcidOf = (code) => (code ? AA1[code - 1] : null);

const PREFIX_FOR_LEVEL = { protein: 'p', nucleotide: 'c', splice: 'c' };
const BLANK = new Set(['', 'NA', 'N/A', 'NaN', 'null', 'None']);

function kindOf(v) {
  // Nucleotide positions say what they are without the target: in an intron, a UTR.
  if (v.prefix !== 'p') {
    const positions = v.components.flatMap((c) => [c.start, c.end]).filter(Boolean);
    const offsets = positions.map((p) => p.intron).filter((x) => x !== null && x !== undefined);
    if (offsets.length) return offsets.some((x) => Math.abs(x) <= 2) || offsets.length < positions.length ? KIND.SPLICE : KIND.INTRONIC;
    if (v.prefix === 'c' && positions.length && positions.every((p) => p.position < 0)) return KIND.UTR5;
    if (v.prefix === 'c' && positions.length && positions.every((p) => p.utr && p.position > 0)) return KIND.UTR3;
  }
  if (v.multi) return KIND.MULTI;
  const c = v.components[0];
  if (c.type === 'equal') return v.prefix === 'p' && (c.start || c.equal === '(=)') ? KIND.SYNONYMOUS : KIND.WT;
  if (c.type === 'del') return KIND.DELETION;
  if (c.type === 'ins') return KIND.INSERTION;
  if (c.type === 'dup') return KIND.DUPLICATION;
  if (c.type === 'delins') return KIND.DELINS;
  if (c.type === 'fs') return KIND.FRAMESHIFT;
  if (c.type === 'sub') {
    if (v.prefix !== 'p') return KIND.NT_SUBSTITUTION;
    if (c.ref === c.alt) return KIND.SYNONYMOUS;
    if (c.alt === 'Ter') return KIND.NONSENSE;
    if (c.ref === 'Ter') return KIND.STOP_LOST;
    if (c.start.position === 1 && c.ref === 'Met') return KIND.START_LOST;
    return KIND.MISSENSE;
  }
  return KIND.OTHER;
}

// Builds the variant table from identifiers. options: { level ('protein' | 'nucleotide' |
// 'splice'), mode ('lenient' | 'strict'), target (a design target, to check against) }.
export function buildVariants(names, options = {}) {
  const level = options.level ?? 'protein';
  const mode = options.mode ?? 'lenient';
  const n = names.length;
  const out = {
    n,
    level,
    original: names.slice(),
    key: new Array(n).fill(''),
    kind: new Uint8Array(n),
    position: new Int32Array(n).fill(-1),
    ref: new Uint8Array(n),
    alt: new Uint8Array(n),
    status: new Uint8Array(n),
    messages: new Map(),
    // Rows named on another of a score set's targets (1).
    otherTarget: new Uint8Array(n),
  };
  const protein = options.target ? targetProtein(options.target) : null;
  const frame = level !== 'protein' ? codingFrame(options.target) : null;
  if (frame) {
    out.proKey = new Array(n).fill('');
    out.proPosition = new Int32Array(n).fill(-1);
    out.proRef = new Uint8Array(n);
    out.proAlt = new Uint8Array(n);
    out.mixed = new Uint8Array(n);
  }
  const labels = new Set(targetLabels(options.target));
  const cache = new Map();
  const note = (row, message) => {
    if (!out.messages.has(row)) out.messages.set(row, []);
    out.messages.get(row).push(message);
  };
  for (let row = 0; row < n; row += 1) {
    const name = names[row];
    if (BLANK.has(String(name ?? '').trim())) {
      out.status[row] = STATUS.INVALID;
      note(row, 'no variant name');
      continue;
    }
    let parsed = cache.get(name);
    if (!parsed) {
      parsed = parseHgvs(name, { mode, prefix: PREFIX_FOR_LEVEL[level] });
      cache.set(name, parsed);
    }
    if (!parsed.ok) {
      out.status[row] = STATUS.INVALID;
      note(row, parsed.error);
      continue;
    }
    out.key[row] = parsed.canonical;
    out.kind[row] = kindOf(parsed);
    const first = parsed.components[0];
    if (first.start) out.position[row] = first.start.position;
    if (!parsed.multi && first.type === 'sub' && parsed.prefix === 'p') {
      out.ref[row] = AA_CODE[THREE_TO_ONE[first.ref]];
      out.alt[row] = AA_CODE[THREE_TO_ONE[first.alt]];
    } else if (out.kind[row] === KIND.SYNONYMOUS && first.start?.aa) {
      out.ref[row] = AA_CODE[THREE_TO_ONE[first.start.aa]];
      out.alt[row] = out.ref[row];
    }
    out.status[row] = parsed.changes.length ? STATUS.WARNING : STATUS.VALID;
    for (const change of parsed.changes) note(row, change);
    // The variant's level and the target.
    const isProtein = parsed.prefix === 'p';
    if ((level === 'protein') !== isProtein) {
      out.status[row] = STATUS.INVALID;
      note(row, isProtein ? 'a protein variant in a column of nucleotide variants' : 'a nucleotide variant in a column of protein variants');
      continue;
    }
    if (parsed.target && options.target && !labels.has(parsed.target)) {
      out.status[row] = STATUS.INVALID;
      out.otherTarget[row] = 1;
      note(row, `named on ${parsed.target}, not on the design's target (${[...labels].slice(0, 3).join(', ')})`);
      continue;
    }
    if (options.target) {
      if (!isProtein && !frame) {
        out.status[row] = STATUS.INVALID;
        note(row, 'a nucleotide variant cannot be checked against a protein target');
        continue;
      }
      const problems = isProtein ? targetMismatches(parsed, protein) : nucleotideMismatches(parsed, frame);
      if (problems.length) {
        out.status[row] = STATUS.INVALID;
        for (const p of problems) note(row, p.message);
        continue;
      }
    }
    if (frame) {
      const c = consequenceOf(parsed, frame);
      if (c.problem) {
        note(row, `its protein change cannot be read: ${c.problem}`);
        continue;
      }
      out.kind[row] = KIND_OF_CLASS[c.class] ?? out.kind[row];
      out.proKey[row] = c.protein ?? '';
      out.proPosition[row] = c.position;
      if (c.ref && c.alt && c.ref.length === 1 && c.alt.length === 1) {
        out.proRef[row] = AA_CODE[c.ref];
        out.proAlt[row] = AA_CODE[c.alt];
      }
      out.mixed[row] = c.mixed ? 1 : 0;
    }
  }
  return out;
}

// Some rows of a variant table, as a variant table of their own (in the order given).
export function selectVariants(variants, rows) {
  const n = rows.length;
  const pick = (array, Type) => Type.from(rows, (r) => array[r]);
  const messages = new Map();
  rows.forEach((r, i) => {
    if (variants.messages.has(r)) messages.set(i, variants.messages.get(r));
  });
  return {
    n,
    level: variants.level,
    original: rows.map((r) => variants.original[r]),
    key: rows.map((r) => variants.key[r]),
    kind: pick(variants.kind, Uint8Array),
    position: pick(variants.position, Int32Array),
    ref: pick(variants.ref, Uint8Array),
    alt: pick(variants.alt, Uint8Array),
    status: pick(variants.status, Uint8Array),
    messages,
    otherTarget: variants.otherTarget ? pick(variants.otherTarget, Uint8Array) : new Uint8Array(n),
    ...(variants.proKey ? {
      proKey: rows.map((r) => variants.proKey[r]),
      proPosition: pick(variants.proPosition, Int32Array),
      proRef: pick(variants.proRef, Uint8Array),
      proAlt: pick(variants.proAlt, Uint8Array),
      mixed: pick(variants.mixed, Uint8Array),
    } : {}),
  };
}

// The key under which two names are the same variant: p.Ala12Ala is valid MAVE-HGVS, and the
// same variant as p.Ala12=.
export const sameVariantKey = (key) => key.replace(/^(p\.)([A-Z][a-z]{2})([1-9][0-9]*)\2$/, '$1$2$3=');

// Rows whose canonical keys are the same (A12V and p.Ala12Val, or a row written twice): ambiguous,
// and blocking scoring until resolved (requirement D4). [{ key, rows }].
export function duplicateKeys(variants) {
  const rows = new Map();
  for (let i = 0; i < variants.n; i += 1) {
    const key = sameVariantKey(variants.key[i]);
    if (!key) continue;
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push(i);
  }
  return [...rows].filter(([, r]) => r.length > 1).map(([key, r]) => ({ key, rows: r }));
}

// Counts for a summary: { total, valid, warning, invalid, byKind: { name: n }, positions: [min, max] }.
export function summarizeVariants(variants) {
  const byKind = {};
  let valid = 0;
  let warning = 0;
  let invalid = 0;
  let otherTarget = 0;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < variants.n; i += 1) {
    const status = variants.status[i];
    if (variants.otherTarget?.[i]) {
      otherTarget += 1;
      continue;
    }
    if (status === STATUS.VALID) valid += 1;
    else if (status === STATUS.WARNING) warning += 1;
    else invalid += 1;
    if (status === STATUS.INVALID) continue;
    const kind = KIND_NAMES[variants.kind[i]];
    byKind[kind] = (byKind[kind] ?? 0) + 1;
    const p = variants.position[i];
    if (p > 0) {
      min = Math.min(min, p);
      max = Math.max(max, p);
    }
  }
  return { total: variants.n, valid, warning, invalid, otherTarget, byKind, positions: Number.isFinite(min) ? [min, max] : null };
}
