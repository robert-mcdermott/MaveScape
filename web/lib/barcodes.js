// Barcode tables at import (requirements D8, D12): a table of barcode counts and the
// barcode-to-variant map that says which variant each barcode carries; dms_variants' long
// `variant_counts` table, one row per library, sample and barcode, turned into one row per barcode;
// and dms_variants' substitutions named in MAVE-HGVS. Pure; the import wizard uses them, and the
// workspace re-applies them when a table is read again (the map and the layout are recorded with
// the source).
//
// A map that gives one barcode two different variants is in conflict: neither can be trusted, so
// the barcode is left unmapped (not scored) and listed, never resolved by guessing. (Enrich2 stops
// with an error on such a map; dms_variants' tables cannot hold one.)

import { columnText } from './csv.js';
import { CODONS } from './target.js';
import { ONE_TO_THREE } from './hgvs.js';

const BLANK = new Set(['', 'NA', 'N/A', 'NaN', 'null', 'None']);
const DNA = /^[ACGTN]+$/i;
const BARCODE_NAMES = /^(barcode|barcodes|bc|barcode_seq|barcode_sequence|tag)$/i;

// A text column of the csv.js shape.
export function textColumn(name, index, values, extra = {}) {
  let missing = 0;
  for (const v of values) if (v === '') missing += 1;
  return { name, index, values, numeric: null, type: missing === values.length ? 'empty' : 'text', missing, missingTokens: missing ? [''] : [], nonNumeric: [], nonNumericCount: 0, integer: false, ...extra };
}

// The column of barcodes in a table: one named for them whose cells are DNA, else the first text
// column all of whose cells are DNA of one length (six bases or more). null when none.
export function barcodeColumnOf(table) {
  // The lengths of a sample of a column's cells, or null when one is not DNA.
  const lengths = (c) => {
    if (!c.values || c.type !== 'text') return null;
    const step = Math.max(1, Math.floor(c.values.length / 200));
    const out = new Set();
    for (let i = 0; i < c.values.length; i += step) {
      if (!DNA.test(c.values[i])) return null;
      out.add(c.values[i].length);
    }
    return out;
  };
  const named = table.columns.find((c) => BARCODE_NAMES.test(c.name) && lengths(c));
  if (named) return named.name;
  const found = table.columns.find((c) => {
    const l = lengths(c);
    return l?.size === 1 && [...l][0] >= 6;
  });
  return found?.name ?? null;
}

// Applies a barcode-to-variant map to a table of barcode counts. counts: the counts table and its
// column of barcodes; map: the map's table and its columns of barcodes and variants. options:
// { countsLibrary, mapLibrary } (columns naming each barcode's library, when barcodes are only
// unique within one), name (the new column's; the map's variant column's by default). Returns {
// table (the counts with the variants added as a column), column (its name), mapped, unmapped
// (rows of counted barcodes the map does not name), conflicts ([{ barcode, variants }]: barcodes
// the map gives different variants, left unmapped), repeats (map rows that repeat another
// exactly), uncounted (barcodes of the map not in the counts) }.
export function applyBarcodeMap(counts, countsBarcode, map, mapBarcode, mapVariant, options = {}) {
  const text = (table, name) => {
    const c = table.columns.find((x) => x.name === name);
    if (!c) throw new Error(`No column "${name}".`);
    return columnText(c);
  };
  const mapBarcodes = text(map, mapBarcode);
  const mapVariants = text(map, mapVariant);
  const mapLibraries = options.mapLibrary ? text(map, options.mapLibrary) : null;
  const countBarcodes = text(counts, countsBarcode);
  const countLibraries = options.countsLibrary ? text(counts, options.countsLibrary) : null;
  const key = (libraries, barcodes, i) => (libraries ? `${libraries[i]}\u0001${barcodes[i]}` : barcodes[i]);
  const variantOf = new Map();
  const conflicted = new Map();
  // One string per variant, however many barcodes carry it (a million barcodes, a few thousand
  // variants).
  const interned = new Map();
  const intern = (s) => {
    const seen = interned.get(s);
    if (seen !== undefined) return seen;
    interned.set(s, s);
    return s;
  };
  let repeats = 0;
  for (let i = 0; i < map.rows; i += 1) {
    const barcode = mapBarcodes[i].trim();
    const variant = intern(mapVariants[i].trim());
    if (!barcode || BLANK.has(barcode) || BLANK.has(variant)) continue;
    const k = key(mapLibraries, mapBarcodes, i).trim();
    if (conflicted.has(k)) {
      conflicted.get(k).add(variant);
      continue;
    }
    const seen = variantOf.get(k);
    if (seen === undefined) variantOf.set(k, variant);
    else if (seen === variant) repeats += 1;
    else {
      conflicted.set(k, new Set([seen, variant]));
      variantOf.delete(k);
    }
  }
  const values = new Array(counts.rows);
  const counted = new Set();
  let mapped = 0;
  const unmapped = [];
  for (let r = 0; r < counts.rows; r += 1) {
    const k = key(countLibraries, countBarcodes, r);
    counted.add(k);
    const v = variantOf.get(k);
    if (v === undefined) {
      values[r] = '';
      if (!conflicted.has(k)) unmapped.push(r);
    } else {
      values[r] = v;
      mapped += 1;
    }
  }
  let uncounted = 0;
  for (const k of variantOf.keys()) if (!counted.has(k)) uncounted += 1;
  let name = options.name ?? mapVariant;
  while (counts.columns.some((c) => c.name === name)) name = `${name} (from the map)`;
  const added = textColumn(name, counts.columns.length, values, { derived: { from: 'map' } });
  const conflicts = [...conflicted].map(([k, variants]) => ({ barcode: k.split('\u0001').pop(), library: mapLibraries ? k.split('\u0001')[0] : undefined, variants: [...variants] }));
  return { table: { ...counts, columns: [...counts.columns, added] }, column: name, mapped, unmapped, conflicts, repeats, uncounted };
}

// A map file with no header (Enrich2's "barcode variant" lines, two DNA columns): its first row,
// read as column names, put back as data, and the columns named barcode and sequence.
export function headerlessMap(table) {
  if (table.columns.length !== 2 || !table.columns.every((c) => DNA.test(c.name))) return table;
  const columns = table.columns.map((c, i) => textColumn(i ? 'sequence' : 'barcode', i, [c.name, ...columnText(c)]));
  return { ...table, rows: table.rows + 1, columns, header: false, lineOfRow: table.lineOfRow ? Int32Array.from([1, ...table.lineOfRow]) : null };
}

// dms_variants' substitutions in MAVE-HGVS (protein): aa_substitutions ("A2V K3*", one-letter
// codes, sites from 1) as p.Ala2Val or p.[Ala2Val;Lys3Ter]; with none, the codon substitutions
// ("GCT2GCC") say whether it is the wild type (p.=) or synonymous (p.Ala2=, p.[Ala2=;Leu5=]).
// null for a substitution it cannot read (an indel, a site outside the protein).
export function dmsVariantsName(aaSubstitutions, codonSubstitutions = '') {
  const aa = String(aaSubstitutions ?? '').trim().split(/\s+/).filter(Boolean);
  const parts = [];
  if (aa.length) {
    for (const token of aa) {
      const m = /^([A-Z*])([1-9]\d*)([A-Z*])$/.exec(token);
      if (!m || !ONE_TO_THREE[m[1]] || !ONE_TO_THREE[m[3]]) return null;
      parts.push(`${ONE_TO_THREE[m[1]]}${m[2]}${m[1] === m[3] ? '=' : ONE_TO_THREE[m[3]]}`);
    }
  } else {
    const codons = String(codonSubstitutions ?? '').trim().split(/\s+/).filter(Boolean);
    if (!codons.length) return 'p.=';
    for (const token of codons) {
      const m = /^([ACGT]{3})([1-9]\d*)([ACGT]{3})$/i.exec(token);
      const residue = m && CODONS[m[1].toUpperCase()];
      if (!residue) return null;
      parts.push(`${ONE_TO_THREE[residue]}${m[2]}=`);
    }
  }
  return parts.length === 1 ? `p.${parts[0]}` : `p.[${parts.join(';')}]`;
}

// Enrich2's element names in MAVE-HGVS. Enrich2 writes a variant as its changes joined by ", ":
// at the amino-acid level p.Thr11Ala, p.Val14Leu; at the coding level c.33A>G (p.Thr11Ala), each
// nucleotide change with its codon's (p.= for a synonymous one); noncoding n.33A>G; and _wt and _sy.
// level 'protein': p.[Thr11Ala;Val14Leu], a coding variant named by its amino-acid changes (a
// synonymous one by its codons, which needs the target's protein); 'nucleotide': c.[33A>G;40G>T].
// _wt and _sy are left for the reader of names (lenient: p.= and p.(=)). null when not Enrich2's.
export function enrich2Name(element, level = 'protein', protein = null) {
  const s = String(element ?? '').trim();
  if (s === '_wt' || s === '_sy') return s;
  const tokens = s.split(', ');
  const join = (prefix, parts) => (parts.length === 1 ? `${prefix}.${parts[0]}` : `${prefix}.[${parts.join(';')}]`);
  const protein1 = /^p\.([A-Z][a-z]{2}-?\d+[A-Z][a-z]{2})$/;
  if (tokens.every((t) => protein1.test(t))) {
    if (level !== 'protein') return null;
    return join('p', tokens.map((t) => protein1.exec(t)[1]).map((x) => x.replace(/^([A-Z][a-z]{2})(\d+)\1$/, '$1$2=')));
  }
  const coding = /^c\.(-?\d+)([ACGT])>([ACGT]) \(p\.(=|[A-Z][a-z]{2}-?\d+[A-Z][a-z]{2})\)$/;
  const noncoding = /^n\.(-?\d+)([ACGT])>([ACGT])$/;
  if (tokens.every((t) => coding.test(t))) {
    const parsed = tokens.map((t) => coding.exec(t));
    if (level !== 'protein') return join('c', parsed.map((m) => `${m[1]}${m[2]}>${m[3]}`));
    const changes = [...new Set(parsed.filter((m) => m[4] !== '=').map((m) => m[4]))];
    if (changes.length) return join('p', changes);
    // Synonymous: the codons changed, named by their residues.
    const codons = [...new Set(parsed.map((m) => Math.ceil(Number(m[1]) / 3)))];
    if (!protein || codons.some((c) => c < 1 || c > protein.length)) return null;
    return join('p', codons.map((c) => `${ONE_TO_THREE[protein[c - 1]]}${c}=`));
  }
  if (tokens.every((t) => noncoding.test(t))) return level === 'protein' ? null : join('n', tokens.map((t) => noncoding.exec(t)).map((m) => `${m[1]}${m[2]}>${m[3]}`));
  return null;
}

// Enrich2's counts file: two columns, the elements (Enrich2 writes their column unnamed) and
// "count".
export function isEnrich2Counts(table) {
  return table.columns.length === 2 && table.columns[1].name === 'count';
}

// Recognizes dms_variants' variant_counts table: library, sample, barcode, count, and its
// substitution columns.
export function isDmsVariantsCounts(table) {
  const names = new Set(table.columns.map((c) => c.name));
  return ['library', 'sample', 'barcode', 'count'].every((n) => names.has(n)) && (names.has('aa_substitutions') || names.has('codon_substitutions'));
}

// dms_variants' variant_counts (one row per library, sample and barcode) as a table of barcodes:
// one row per library and barcode, one column of counts per library and sample ("pre (lib1)"),
// missing where that library's sample does not count the barcode (another library's barcode); the
// substitution columns, and the variant named in MAVE-HGVS ("hgvs_pro (from aa_substitutions)").
// A barcode in two libraries is written library/barcode, so that each row's is its own. Returns {
// table, samples: [{ column, library, sample }], problems }.
export function pivotDmsVariants(table) {
  const problems = [];
  const get = (name) => {
    const c = table.columns.find((x) => x.name === name);
    return c ? columnText(c) : null;
  };
  const library = get('library');
  const sample = get('sample');
  const barcode = get('barcode');
  const countColumn = table.columns.find((c) => c.name === 'count');
  const count = countColumn?.numeric;
  if (!count) {
    problems.push({ level: 'error', code: 'count-not-numbers', message: 'The column "count" is not all numbers.' });
    return { table: null, samples: [], problems };
  }
  const aa = get('aa_substitutions');
  const codon = get('codon_substitutions');
  const rowOf = new Map();
  const rows = [];
  const columnOf = new Map();
  const samples = [];
  const libraries = [];
  for (let i = 0; i < table.rows; i += 1) {
    const lib = library[i];
    if (!libraries.includes(lib)) libraries.push(lib);
    const k = `${lib}\u0001${barcode[i]}`;
    let row = rowOf.get(k);
    if (row === undefined) {
      row = rows.length;
      rowOf.set(k, row);
      rows.push({ library: lib, barcode: barcode[i], aa: aa?.[i] ?? '', codon: codon?.[i] ?? '' });
    } else if ((aa && rows[row].aa !== aa[i]) || (codon && rows[row].codon !== codon[i])) {
      problems.push({ level: 'error', code: 'barcode-variants-differ', message: `Barcode ${barcode[i]} of ${lib} has different substitutions on line ${table.lineOfRow?.[i] ?? i + 2}.` });
    }
    const s = `${sample[i]}\u0001${lib}`;
    if (!columnOf.has(s)) {
      columnOf.set(s, samples.length);
      samples.push({ column: `${sample[i]} (${lib})`, library: lib, sample: sample[i], values: new Map() });
    }
    const target = samples[columnOf.get(s)].values;
    if (target.has(row)) problems.push({ level: 'error', code: 'repeated-count', message: `Barcode ${barcode[i]} of ${lib} is counted twice in sample ${sample[i]} (line ${table.lineOfRow?.[i] ?? i + 2}).` });
    target.set(row, count[i]);
  }
  const n = rows.length;
  const seen = new Map();
  for (const r of rows) seen.set(r.barcode, (seen.get(r.barcode) ?? 0) + 1);
  const shared = [...seen.values()].filter((x) => x > 1).length;
  if (shared) problems.push({ level: 'info', code: 'barcodes-in-libraries', message: `${shared} barcode${shared > 1 ? 's are' : ' is'} in more than one library: written library/barcode, each library's its own.` });
  const ids = rows.map((r) => (seen.get(r.barcode) > 1 ? `${r.library}/${r.barcode}` : r.barcode));
  const names = rows.map((r) => dmsVariantsName(r.aa, r.codon) ?? '');
  const unnamed = names.filter((x) => !x).length;
  if (unnamed) problems.push({ level: 'warning', code: 'unnamed-substitutions', message: `${unnamed} barcode${unnamed > 1 ? 's carry' : ' carries'} substitutions not named in MAVE-HGVS here (an indel, or a site it cannot read): not scored.` });
  const columns = [
    textColumn('barcode', 0, ids),
    textColumn('library', 1, rows.map((r) => r.library)),
  ];
  if (aa) columns.push(textColumn('aa_substitutions', columns.length, rows.map((r) => r.aa)));
  if (codon) columns.push(textColumn('codon_substitutions', columns.length, rows.map((r) => r.codon)));
  const variantName = aa ? 'hgvs_pro (from aa_substitutions)' : 'hgvs_pro (from codon_substitutions)';
  columns.push(textColumn(variantName, columns.length, names, { derived: { from: aa ? 'aa_substitutions' : 'codon_substitutions' } }));
  for (const s of samples) {
    const numeric = new Float64Array(n).fill(Number.NaN);
    let missing = n;
    let integer = true;
    for (const [row, value] of s.values) {
      numeric[row] = value;
      if (!Number.isNaN(value)) missing -= 1;
      if (!Number.isInteger(value)) integer = false;
    }
    columns.push({ name: s.column, index: columns.length, values: null, numeric, type: 'number', missing, missingTokens: missing ? [''] : [], nonNumeric: [], nonNumericCount: 0, integer, source: { library: s.library, sample: s.sample } });
  }
  problems.push({ level: 'info', code: 'dms-variants', message: `dms_variants' variant counts: ${n} barcodes in ${libraries.length} librar${libraries.length > 1 ? 'ies' : 'y'} (${libraries.join(', ')}), ${samples.length} samples; a barcode not counted in another library's samples is missing there, not 0. Variants are named from ${aa ? 'aa_substitutions (synonymous ones from codon_substitutions)' : 'codon_substitutions'}.` });
  return {
    table: { columns, rows: n, delimiter: table.delimiter, lineEnd: table.lineEnd, header: true, diagnostics: [], lineOfRow: null },
    samples: samples.map(({ column, library: lib, sample: name }) => ({ column, library: lib, sample: name, replicate: libraries.indexOf(lib) + 1 })),
    variantColumn: variantName,
    problems,
  };
}
