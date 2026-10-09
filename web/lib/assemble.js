// The table a source describes, assembled from its files (requirements D1, D8, D12): one table,
// or one file per sample joined on its first column; dms_variants' long variant_counts made one
// row per barcode; variant names derived where the table does not write them in MAVE-HGVS
// (DiMSum's whole sequences, Enrich2's elements); and a barcode-to-variant map applied. Pure: the
// import wizard assembles a table this way, and the workspace assembles it again, from the same
// files and the mapping recorded with the source, whenever the source is read from the library.
//
//   assembleTable(files, options) → { table, kind, notes, problems, map, samples }
//
// files: [{ name, table (csv.js), role: 'counts' | 'map' }]. options: { absentMeans ('missing' |
// 'zero'), level ('protein' | 'nucleotide'), target (to name sequences and synonymous changes),
// barcodeColumn (the counts' column of barcodes, for the map), map: { barcodeColumn,
// variantColumn } (the map's columns; found when not given) }.
// kind: 'table' | 'joined' | 'dms-variants' | 'enrich2' | 'dimsum'. map: applyBarcodeMap's report.
// samples: dms_variants' samples with their libraries.

import { joinCountTables } from './counts.js';
import { columnText } from './csv.js';
import { detectLayout, namesFromSequences } from './importer.js';
import { CODONS, targetProtein } from './target.js';
import { applyBarcodeMap, barcodeColumnOf, dmsVariantsName, enrich2Name, headerlessMap, isDmsVariantsCounts, isEnrich2Counts, pivotDmsVariants, textColumn } from './barcodes.js';

const DNA = /^[ACGTN]+$/i;
const stem = (name) => name.replace(/\.(csv|tsv|tab|txt)(\.gz)?$/i, '');
const isDna = (values) => values.length > 0 && values.slice(0, 200).every((v) => DNA.test(v));

// Whether a file looks like a barcode-to-variant map rather than counts: a column of barcodes, and
// no column of counts (dms_variants' variant_call_support and n_* columns are not counts).
export function looksLikeMap(table) {
  const headerless = headerlessMap(table);
  if (headerless !== table) return true;
  const barcode = barcodeColumnOf(table);
  if (!barcode) return false;
  const counts = table.columns.filter((c) => c.name !== barcode && (c.type === 'number' || c.type === 'mixed') && !/^(variant_call_support|n_codon_substitutions|n_aa_substitutions|n_.*|support)$/i.test(c.name));
  return counts.length === 0 && table.columns.some((c) => c.name !== barcode && c.type === 'text');
}

// The map's column of variants: one of MAVE-HGVS (or lab) names, dms_variants' substitutions, or
// whole sequences (Enrich2's variant maps), by its name or what it holds.
function mapVariantColumn(map, barcode) {
  const text = map.columns.filter((c) => c.name !== barcode && c.type !== 'number');
  const named = (re) => text.find((c) => re.test(c.name));
  return (named(/^(hgvs_pro|hgvs_nt|hgvs|variant|variants|hgvs_.*)$/i) ?? named(/^aa_substitutions$/i) ?? named(/^(codon_substitutions|substitutions)$/i) ?? named(/^(sequence|variant_sequence|seq)$/i) ?? text[0])?.name ?? null;
}

export function assembleTable(files, options = {}) {
  const notes = [];
  const problems = [];
  const level = options.level === 'nucleotide' ? 'nucleotide' : 'protein';
  const countFiles = files.filter((f) => f.role !== 'map');
  const mapFile = files.find((f) => f.role === 'map') ?? null;
  if (!countFiles.length) return { table: null, kind: null, notes, problems: [{ level: 'error', code: 'no-counts', message: 'Only a barcode map was given: open the counts with it.' }], map: null, samples: null };
  let table;
  let kind = 'table';
  let samples = null;
  // dms_variants' long table: one row per barcode.
  if (countFiles.length === 1 && isDmsVariantsCounts(countFiles[0].table)) {
    const pivot = pivotDmsVariants(countFiles[0].table);
    problems.push(...pivot.problems);
    if (!pivot.table) return { table: null, kind: 'dms-variants', notes, problems, map: null, samples: null };
    table = { ...pivot.table, diagnostics: countFiles[0].table.diagnostics ?? [] };
    kind = 'dms-variants';
    samples = pivot.samples;
  } else if (countFiles.length > 1) {
    // One file per sample, joined on each file's first column (or its column of variants).
    // (Enrich2's: its elements and "count"; else the columns detectLayout finds.)
    const parts = countFiles.map((f) => {
      const t = f.table;
      if (isEnrich2Counts(t)) return { name: stem(f.name), table: t, variantColumn: t.columns[0].name, countColumns: ['count'], enrich2: true };
      const l = detectLayout(t);
      return { name: stem(f.name), table: t, variantColumn: l.barcodeColumn ?? l.variantColumn ?? t.columns[0]?.name, countColumns: l.countColumns };
    });
    // Enrich2's unnamed column of elements is named for what it holds.
    const joinedName = parts[0].enrich2 ? (isDna(columnText(parts[0].table.columns[0])) ? 'barcode' : 'element') : parts[0].variantColumn;
    const joined = joinCountTables(parts, { absentMeans: options.absentMeans ?? 'missing', variantColumn: joinedName });
    // Enrich2 leaves its elements' column unnamed: expected, not said.
    table = { ...joined.table, diagnostics: [...countFiles.flatMap((f, i) => (f.table.diagnostics ?? []).filter((d) => !(parts[i].enrich2 && d.code === 'unnamed-column')).map((d) => ({ ...d, message: `${f.name}: ${d.message}` }))), ...joined.problems] };
    kind = 'joined';
  } else {
    table = countFiles[0].table;
  }
  // Enrich2's counts: elements named in MAVE-HGVS, unless they are barcodes.
  if (countFiles.every((f) => isEnrich2Counts(f.table))) {
    const elements = table.columns[0];
    const values = columnText(elements);
    if (!isDna(values)) {
      const protein = options.target ? targetProtein(options.target) : null;
      const names = values.map((v) => enrich2Name(v, level, protein) ?? '');
      const unnamed = names.filter((x) => !x).length;
      const name = `${level === 'protein' ? 'hgvs_pro' : 'hgvs_nt'} (from Enrich2)`;
      table = { ...table, columns: [...table.columns, textColumn(name, table.columns.length, names, { derived: { from: elements.name } })], diagnostics: (table.diagnostics ?? []).filter((d) => d.code !== 'unnamed-column') };
      notes.push(`Enrich2's counts: its variants (${values.length}) named in MAVE-HGVS at the ${level} level, in "${name}".`);
      if (unnamed) problems.push({ level: 'warning', code: 'enrich2-unnamed', message: `${unnamed} of Enrich2's elements could not be named${level === 'protein' && !protein ? ' (a synonymous change is named by its codon, which needs the target)' : ''}: not scored.` });
    } else notes.push('Enrich2\'s counts of barcodes: open its barcode map with them.');
    kind = 'enrich2';
  }
  // DiMSum's whole sequences: named against the wild type, which needs a DNA target.
  if (table.columns.some((c) => c.name === 'nt_seq')) {
    kind = 'dimsum';
    if (!options.target || options.target.sequenceType !== 'dna') problems.push({ level: 'error', code: 'dimsum-target', message: 'DiMSum names its variants by whole sequences: choose (or add) the wild-type DNA sequence as the target to name them.' });
    else {
      const named = namesFromSequences(columnText(table.columns.find((c) => c.name === 'nt_seq')), options.target.sequence);
      table = { ...table, columns: [...table.columns, textColumn('hgvs_nt (from nt_seq)', table.columns.length, named.nt), textColumn('hgvs_pro (from nt_seq)', table.columns.length + 1, named.pro)] };
    }
  }
  // The barcode-to-variant map.
  let map = null;
  if (mapFile) {
    let mt = headerlessMap(mapFile.table);
    const mapBarcode = options.map?.barcodeColumn ?? barcodeColumnOf(mt) ?? mt.columns[0]?.name;
    const chosen = options.map?.variantColumn ?? mapVariantColumn(mt, mapBarcode);
    let mapVariant = chosen;
    const countsBarcode = options.barcodeColumn ?? barcodeColumnOf(table);
    if (!countsBarcode) problems.push({ level: 'error', code: 'no-barcode-column', message: 'The counts have no column of barcodes for the map to name: choose it.' });
    else if (!mapVariant) problems.push({ level: 'error', code: 'map-no-variants', message: `${mapFile.name} has no column of variants.` });
    else {
      // The map's variants as names: dms_variants' substitutions, or whole sequences.
      const column = mt.columns.find((c) => c.name === mapVariant);
      const values = columnText(column);
      let derived = null;
      if (/^aa_substitutions$/i.test(mapVariant)) {
        const codons = mt.columns.find((c) => c.name === 'codon_substitutions');
        const codonValues = codons ? columnText(codons) : null;
        derived = values.map((v, i) => dmsVariantsName(v, codonValues?.[i] ?? '') ?? '');
      } else if (/^(codon_substitutions|substitutions)$/i.test(mapVariant) && values.some((v) => /^[ACGT]{3}\d+[ACGT]{3}/i.test(v))) {
        // dms_variants' codon substitutions, named at the protein level by translating the codons.
        derived = values.map((v) => codonsToName(v));
      } else if (isDna(values.filter(Boolean))) {
        if (!options.target || options.target.sequenceType !== 'dna') problems.push({ level: 'error', code: 'map-target', message: `${mapFile.name} gives each barcode's variant as a whole sequence: choose (or add) the wild-type DNA sequence as the target to name them.` });
        else {
          const named = namesFromSequences(values, options.target.sequence);
          derived = level === 'protein' ? named.pro : named.nt;
        }
      }
      if (derived) {
        const name = `${level === 'protein' ? 'hgvs_pro' : 'hgvs_nt'} (from ${mapVariant})`;
        mt = { ...mt, columns: [...mt.columns, textColumn(name, mt.columns.length, derived)] };
        mapVariant = name;
      }
      if (!problems.some((p) => p.level === 'error' && /^map-/.test(p.code))) {
        map = applyBarcodeMap(table, countsBarcode, mt, mapBarcode, mapVariant);
        map.barcodeColumn = countsBarcode;
        map.mapBarcodeColumn = mapBarcode;
        map.mapVariantColumn = chosen;
        table = map.table;
        notes.push(`Barcode map ${mapFile.name}: ${map.mapped} of ${table.rows} barcodes named, in "${map.column}".`);
        if (map.conflicts.length) problems.push({ level: 'warning', code: 'map-conflicts', message: `The map gives ${map.conflicts.length} barcode${map.conflicts.length > 1 ? 's' : ''} two or more different variants (${map.conflicts.slice(0, 3).map((c) => `${c.barcode}: ${c.variants.join(' or ')}`).join('; ')}${map.conflicts.length > 3 ? '; …' : ''}): ${map.conflicts.length > 1 ? 'they are' : 'it is'} left unmapped and not scored.`, conflicts: map.conflicts.slice(0, 100) });
        if (map.unmapped.length) problems.push({ level: 'warning', code: 'map-unmapped', message: `${map.unmapped.length} counted barcode${map.unmapped.length > 1 ? 's are' : ' is'} not in the map: not scored.` });
        if (map.uncounted) problems.push({ level: 'info', code: 'map-uncounted', message: `${map.uncounted} barcode${map.uncounted > 1 ? 's' : ''} of the map ${map.uncounted > 1 ? 'are' : 'is'} not counted in this table.` });
        if (map.repeats) problems.push({ level: 'info', code: 'map-repeats', message: `${map.repeats} line${map.repeats > 1 ? 's' : ''} of the map repeat another exactly.` });
      }
    }
  }
  return { table, kind, notes, problems, map, samples };
}

// dms_variants' codon substitutions ("GCT2GTT CTG5CTC") at the protein level: each codon's change
// translated (synonymous ones kept only when nothing else changes).
function codonsToName(text) {
  const tokens = String(text ?? '').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return 'p.=';
  const aa = [];
  for (const token of tokens) {
    const m = /^([ACGT]{3})([1-9]\d*)([ACGT]{3})$/i.exec(token);
    if (!m) return '';
    aa.push([m[1].toUpperCase(), m[2], m[3].toUpperCase()]);
  }
  const codon = (c) => CODONS[c];
  const changed = aa.filter(([wt, , mut]) => codon(wt) !== codon(mut)).map(([wt, site, mut]) => `${codon(wt)}${site}${codon(mut)}`);
  return dmsVariantsName(changed.join(' '), changed.length ? '' : tokens.join(' ')) ?? '';
}
