// Codon variants read at the protein level (wave 2, slice 11). Some tables name each codon
// variant at the nucleotide level, several codons to an amino-acid substitution (MaveDB's EMPIRIC
// tables: Hsp90, ubiquitin…), and write the wild type once per position. Assembled at the protein
// level, such a table becomes one row per protein variant:
//
//  - each row's protein change from its nucleotide name, against the DNA target's reading frame
//    (substitutions in the coding sequence; any other change is not named, and not scored);
//  - a variant on several rows with the same count in every count column is one measurement
//    written more than once: read once. With different counts it is a problem: which row is right
//    is not for MaveScape to guess;
//  - the codons of each protein variant summed in every count column (a sample in which none of
//    them was counted stays missing).
//
// The table's own protein column is not used: Hsp90's names the wild type's nine copies p.Gln1= …
// p.Glu9=, synonymous changes, where their nucleotide names say no change at all.
//
//   combineCodons(table, { column, target, countColumns }) → { table, notes, problems, summary }

import { parseHgvs } from './hgvs.js';
import { CODONS } from './target.js';
import { columnText } from './csv.js';
import { textColumn } from './barcodes.js';

const THREE = { A: 'Ala', R: 'Arg', N: 'Asn', D: 'Asp', C: 'Cys', Q: 'Gln', E: 'Glu', G: 'Gly', H: 'His', I: 'Ile', L: 'Leu', K: 'Lys', M: 'Met', F: 'Phe', P: 'Pro', S: 'Ser', T: 'Thr', W: 'Trp', Y: 'Tyr', V: 'Val', '*': 'Ter' };

// A coding variant's protein change: { key (its canonical nucleotide name), protein } or
// { problem }. Synonymous codons are named by their codon (p.Phe2=); a change that alters an amino
// acid is named by the amino acids alone, as MaveScape names sequences (importer.js).
export function proteinChange(name, target) {
  const parsed = parseHgvs(String(name ?? ''), { mode: 'lenient' });
  if (!parsed.ok) return { problem: 'not a valid variant name' };
  if (parsed.prefix !== 'c') return { problem: 'not a coding (c.) name' };
  const key = parsed.canonical;
  if (key === 'c.=') return { key, protein: 'p.=' };
  const body = key.slice(2).replace(/^\[|\]$/g, '');
  const subs = [];
  for (const part of body.split(';')) {
    const m = /^([1-9]\d*)([ACGT])>([ACGT])$/.exec(part);
    if (!m) return { problem: 'a change other than a substitution in the coding sequence' };
    subs.push([Number(m[1]), m[2], m[3]]);
  }
  const wild = target.sequence.toUpperCase();
  const start = (target.codingStart ?? 1) - 1;
  const mutant = wild.split('');
  for (const [n, ref, alt] of subs) {
    const i = start + n - 1;
    if (wild[i] !== ref) return { problem: i < wild.length ? `base ${n} is ${wild[i]} in the target, not ${ref}` : `base ${n} is beyond the target` };
    mutant[i] = alt;
  }
  const changed = [];
  const synonymous = [];
  for (const k of [...new Set(subs.map(([n]) => Math.ceil(n / 3)))].sort((a, b) => a - b)) {
    const i = start + (k - 1) * 3;
    const from = CODONS[wild.slice(i, i + 3)];
    const to = CODONS[mutant.slice(i, i + 3).join('')];
    if (!from || !to) return { problem: `codon ${k} is beyond the target's coding sequence` };
    if (from !== to) changed.push(`${THREE[from]}${k}${THREE[to]}`);
    else synonymous.push(`${THREE[from]}${k}=`);
  }
  const named = changed.length ? changed : synonymous;
  return { key, protein: named.length === 1 ? `p.${named[0]}` : `p.[${named.join(';')}]` };
}

// Two rows' counts the same in every column (missing where the other is missing).
const sameCounts = (columns, a, b) => columns.every((c) => Object.is(c.numeric[a], c.numeric[b]) || (Number.isNaN(c.numeric[a]) && Number.isNaN(c.numeric[b])));

export function combineCodons(table, { column, target, countColumns }) {
  const notes = [];
  const problems = [];
  const names = table.columns.find((c) => c.name === column);
  if (!names) return { table: null, notes, problems: [{ level: 'error', code: 'codons-no-column', message: `The table has no column "${column}" of nucleotide names to read the codons from.` }], summary: null };
  if (!target || target.sequenceType !== 'dna') return { table: null, notes, problems: [{ level: 'error', code: 'codons-target', message: 'Reading codon variants at the protein level needs the target\'s DNA sequence: choose (or add) it.' }], summary: null };
  const counts = (countColumns ?? table.columns.filter((c) => c.type === 'number').map((c) => c.name)).map((name) => table.columns.find((c) => c.name === name)).filter((c) => c?.numeric);
  const values = columnText(names);
  const line = (row) => table.lineOfRow?.[row] ?? row + 2;
  // Each row's protein change, and the rows of each nucleotide variant.
  const changes = values.map((v) => proteinChange(v, target));
  const byKey = new Map();
  changes.forEach((c, row) => {
    if (c.key) byKey.set(c.key, [...(byKey.get(c.key) ?? []), row]);
  });
  const use = Uint8Array.from(changes, (c) => (c.protein ? 1 : 0));
  const copies = [];
  const conflicting = [];
  for (const [key, rows] of byKey) {
    if (rows.length < 2) continue;
    if (rows.every((r) => sameCounts(counts, rows[0], r))) {
      for (const r of rows.slice(1)) use[r] = 0;
      copies.push({ key, rows });
    } else conflicting.push({ key, rows });
  }
  // The protein variants, in order of first appearance, and their codons' counts summed.
  const order = [];
  const members = new Map();
  for (let row = 0; row < values.length; row += 1) {
    if (!use[row]) continue;
    const p = changes[row].protein;
    if (!members.has(p)) {
      members.set(p, []);
      order.push(p);
    }
    members.get(p).push(row);
  }
  const columns = [textColumn(`hgvs_pro (from ${column})`, 0, order, { derived: { from: column, codons: true } })];
  for (const c of counts) {
    const numeric = new Float64Array(order.length).fill(Number.NaN);
    order.forEach((p, i) => {
      let sum = Number.NaN;
      for (const row of members.get(p)) {
        const x = c.numeric[row];
        if (!Number.isNaN(x)) sum = Number.isNaN(sum) ? x : sum + x;
      }
      numeric[i] = sum;
    });
    let missing = 0;
    for (const x of numeric) if (Number.isNaN(x)) missing += 1;
    columns.push({ name: c.name, index: columns.length, values: null, numeric, type: 'number', missing, missingTokens: missing ? [''] : [], nonNumeric: [], nonNumericCount: 0, integer: numeric.every((x) => Number.isNaN(x) || Number.isInteger(x)), source: { column: c.name, codons: true } });
  }
  const unnamed = changes.map((c, row) => [c, row]).filter(([c]) => c.problem);
  const used = use.reduce((a, b) => a + b, 0);
  notes.push(`Codon variants read at the protein level: ${used} rows of "${column}" named by their protein change against ${target.name} and combined into ${order.length} protein variants (their counts summed${counts.length ? ` in ${counts.length} columns` : ''}), in "${columns[0].name}".`);
  for (const c of copies) problems.push({ level: 'info', code: 'codons-copies', message: `${c.key} is written on ${c.rows.length} rows (lines ${c.rows.map(line).join(', ')}) with the same count in every column: one measurement written ${c.rows.length} times, read once.` });
  if (conflicting.length) problems.push({ level: 'error', code: 'codons-conflict', message: `${conflicting.length} variant${conflicting.length > 1 ? 's are' : ' is'} on more than one row with different counts (${conflicting.slice(0, 3).map((c) => `${c.key}: lines ${c.rows.map(line).join(', ')}`).join('; ')}${conflicting.length > 3 ? '; …' : ''}). Which row is right is not for MaveScape to guess.` });
  if (unnamed.length) problems.push({ level: 'warning', code: 'codons-unnamed', message: `${unnamed.length} row${unnamed.length > 1 ? 's' : ''} could not be read at the protein level (${unnamed.slice(0, 3).map(([c, row]) => `line ${line(row)}: ${c.problem}`).join('; ')}${unnamed.length > 3 ? '; …' : ''}): not scored.` });
  return {
    table: { columns, rows: order.length, delimiter: table.delimiter ?? null, lineEnd: table.lineEnd ?? null, header: true, diagnostics: table.diagnostics ?? [] },
    notes,
    problems,
    summary: { rows: values.length, used, variants: order.length, copies: copies.map((c) => ({ key: c.key, rows: c.rows.length })), unnamed: unnamed.length, conflicting: conflicting.length },
  };
}

// The column of codons a design's protein names come from: "hgvs_pro (from hgvs_nt)" → "hgvs_nt";
// null for any other column (DiMSum's names from whole sequences are derived when its table is
// read, and are not codons).
export function codonsSource(column) {
  const m = /^hgvs_pro \(from (.+)\)$/.exec(String(column ?? ''));
  return m && m[1] !== 'nt_seq' ? m[1] : null;
}
