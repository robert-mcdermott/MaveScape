// Predictors' scores of single substitutions as a variants track (wave 3, slice 5; requirement
// I4): a predictor's own download, read as it is written:
//   AlphaMissense (Cheng et al. 2023): protein_variant, am_pathogenicity, am_class (AlphaFold DB's
//     table of one protein; the whole proteome's TSV, with uniprot_id, filtered to the target's);
//   EVE (Frazer et al. 2021): wt_aa, position, mt_aa, EVE_scores_ASM (and its classes);
//   ESM1b (Brandes et al. 2023) and other matrices: a column of amino acids, one column a position
//     (M1, E2, …);
//   any table with a column of protein variants (variant, protein_variant, mutant, mutation,
//     hgvs_pro…: A123V, p.Ala123Val) and a column of scores (score, or the first column of numbers).
// Positions are the reference's (UniProt) where the residues agree there, else the target's.

import { parseTable, columnText } from '../csv.js';
import { MISSENSE_CLASSES, readSubstitution, substitutionKey, variantsTrack } from '../tracks.js';
import { count, placeEither, placementNotes } from './common.js';

const VARIANT_COLUMNS = ['protein_variant', 'variant', 'hgvs_pro', 'mutant', 'mutation', 'aa_substitution', 'substitution', 'aa_change', 'protein_change', 'mut'];
const SCORE_COLUMNS = ['am_pathogenicity', 'eve_scores_asm', 'score', 'prediction', 'pred', 'value'];
const AA = 'ACDEFGHIKLMNPQRSTVWY';
const lower = (s) => String(s).trim().toLowerCase();

// EVE's classes (EVE_classes_75_pct_retained_ASM: the 75% of substitutions it classes most surely),
// as the comparisons by class read them (wave 4, slice 3).
export const EVE_CLASSES = [
  { id: 'pathogenic', label: 'pathogenic (EVE)', token: 'pathogenic', code: 'pathogenic' },
  { id: 'ambiguous', label: 'uncertain', token: 'other', code: 'uncertain' },
  { id: 'benign', label: 'benign (EVE)', token: 'benign', code: 'benign' },
];

// The table's layout and its substitutions: { layout, name, column (the score's), entries:
// [{ ref, refPosition, alt, value, cls }], problem }. accession: keeps the rows of that UniProt
// entry where the table holds several.
export function readPredictorTable(text, { fileName = '', accession = null } = {}) {
  const table = parseTable(String(text).replace(/^(#[^\n]*\n)+/, ''));
  const cols = new Map(table.columns.map((c) => [lower(c.name), c]));
  const col = (name) => cols.get(name) ?? null;
  const numbers = (c) => c?.numeric ?? (c ? Float64Array.from(c.values, Number) : null);
  // A matrix: amino acids down the first column, positions (M1, E2, …) across.
  const posColumns = table.columns.filter((c) => /^[A-Z]\s?\d+$/.test(c.name.trim()));
  if (posColumns.length >= 3 && table.columns[0].values?.every((x) => AA.includes(String(x).trim().toUpperCase()) || x === '')) {
    const entries = [];
    const alts = table.columns[0].values.map((x) => String(x).trim().toUpperCase());
    for (const c of posColumns) {
      const m = /^([A-Z])\s?(\d+)$/.exec(c.name.trim());
      const xs = numbers(c);
      for (let r = 0; r < table.rows; r += 1) if (alts[r] && Number.isFinite(xs[r])) entries.push({ ref: m[1], refPosition: Number(m[2]), alt: alts[r], value: xs[r], cls: null });
    }
    return { layout: 'matrix', name: 'ESM1b-style matrix', column: 'matrix', entries };
  }
  // EVE: residues and position in columns of their own.
  if (col('wt_aa') && col('position') && col('mt_aa')) {
    const score = col('eve_scores_asm') ?? table.columns.find((c) => c.numeric && !['position'].includes(lower(c.name)));
    if (!score) return { problem: 'The table names its variants (wt_aa, position, mt_aa) but has no column of scores.' };
    const wt = columnText(col('wt_aa'));
    const pos = numbers(col('position'));
    const mt = columnText(col('mt_aa'));
    const xs = numbers(score);
    const classes = col('eve_classes_75_pct_retained_asm') ? columnText(col('eve_classes_75_pct_retained_asm')) : null;
    const entries = [];
    for (let r = 0; r < table.rows; r += 1) {
      if (!Number.isFinite(xs[r]) || !Number.isInteger(pos[r])) continue;
      const cls = classes ? EVE_CLASSES.find((k) => k.code === lower(classes[r]))?.id ?? null : null;
      entries.push({ ref: wt[r].trim().toUpperCase(), refPosition: pos[r], alt: mt[r].trim().toUpperCase(), value: xs[r], cls, detail: classes?.[r] || null });
    }
    const eve = lower(score.name) === 'eve_scores_asm';
    return { layout: eve ? 'eve' : 'positions', name: eve ? 'EVE' : score.name, column: score.name, entries, classes: classes ? EVE_CLASSES : null };
  }
  const variant = VARIANT_COLUMNS.map(col).find(Boolean);
  if (!variant) return { problem: 'The table has no column of protein variants (protein_variant, variant, hgvs_pro, mutant…).' };
  const score = SCORE_COLUMNS.map(col).find(Boolean) ?? table.columns.find((c) => c !== variant && c.numeric && [...c.numeric].some(Number.isFinite));
  if (!score) return { problem: `The table names its variants (${variant.name}) but has no column of scores.` };
  const names = columnText(variant);
  const xs = numbers(score);
  const am = lower(score.name) === 'am_pathogenicity';
  const amClass = col('am_class') ? columnText(col('am_class')) : null;
  const ids = col('uniprot_id') ? columnText(col('uniprot_id')) : null;
  const want = accession ? accession.toUpperCase().replace(/-1$/, '') : null;
  const entries = [];
  let unread = 0;
  let others = 0;
  for (let r = 0; r < table.rows; r += 1) {
    if (ids && want && ids[r].trim().toUpperCase() !== want) {
      others += 1;
      continue;
    }
    const s = readSubstitution(names[r]);
    if (!s || !Number.isFinite(xs[r])) {
      unread += 1;
      continue;
    }
    const cls = amClass ? MISSENSE_CLASSES.find((k) => k.code === amClass[r].trim())?.id ?? null : null;
    entries.push({ ref: s.ref, refPosition: s.position, alt: s.alt, value: xs[r], cls });
  }
  if (ids && want && !entries.length) return { problem: `The table holds no rows of ${want} (its uniprot_id column names other entries).` };
  const name = am ? 'AlphaMissense' : score.name;
  return { layout: am ? 'alphamissense' : 'variants', name, column: score.name, entries, unread, others, classes: amClass ? MISSENSE_CLASSES : null };
}

// The predictor's entries as a track on the target.
export function predictorTrack(read, context, { part = 'scores', label } = {}) {
  const place = placeEither(read.entries.map((e) => ({ ...e })), context);
  if (place.problem) return { tracks: [], notes: [], problem: `${read.name}: ${place.problem}` };
  const entries = place.placed.map((e) => ({
    key: substitutionKey(e.ref, e.position, e.alt), position: e.position, ref: e.ref, alt: e.alt, value: e.value, cls: e.cls,
    label: `${Number(e.value.toPrecision(4))}${e.cls ? ` ${read.classes?.find((k) => k.id === e.cls)?.label.replace(/ \(.*\)$/, '') ?? e.cls}` : ''}`, detail: e.detail ?? null,
  }));
  const notes = placementNotes(place, 'substitution');
  if (read.unread) notes.push(`${count(read.unread, 'row')} not read as a single substitution with a score.`);
  if (place.numbering === 'target' && context.offset) notes.push('Numbered as the target is (its residues agree there, not at the reference\'s numbering).');
  const xs = entries.map((e) => e.value);
  const domain = read.layout === 'alphamissense' ? { kind: 'sequential', min: 0, max: 1 } : { kind: 'sequential', min: Math.min(...xs, 0), max: Math.max(...xs, 1e-9) };
  // What the comparisons read (wave 4, slice 3): the table's layout (what a higher score means) and
  // its score's name.
  const predictor = { layout: read.layout, name: read.name, column: read.column };
  const track = variantsTrack({ part, label: label ?? read.name, length: context.length, domain, unit: read.layout === 'alphamissense' ? 'mean pathogenicity' : `mean ${read.column}`, format: (x) => x.toFixed(3), predictor }, entries, { summary: 'mean', classes: read.classes ?? null });
  return { tracks: [track], notes };
}

export const PREDICTOR = {
  id: 'predictor',
  name: 'Predictor scores',
  kind: 'file',
  service: 'a file',
  what: 'a predictor\'s scores of substitutions (AlphaMissense, EVE, ESM1b or any table of protein variants and scores; CSV or TSV)',
  cite: [],
  accepts(fileName, text) {
    if (!/\.(csv|tsv|txt)(\.gz)?$/i.test(fileName)) return false;
    const read = readPredictorTable(String(text).slice(0, 20000), { fileName });
    return !read.problem && read.entries.length > 0;
  },
  read(text, context) {
    const read = readPredictorTable(text, { fileName: context.record?.file ?? '', accession: context.target?.identifiers?.uniprot ?? null });
    if (read.problem) return { tracks: [], notes: [], problem: read.problem };
    const label = context.record?.label ?? `${read.name} (${context.record?.file ?? 'file'})`;
    return predictorTrack(read, context, { label });
  },
};
