// The feasibility data sets of wave 1, slice 2 (validation/sources.json, validation/designs/): the
// MaveDB tables, read column by column, and checks of each hand-written design against its data
// that validateDesign cannot make from a header alone (copies really are copies, tiles hold the
// variants measured in them, the target agrees with the variants' reference residues).

import { readFileSync } from 'node:fs';
import { replicateSamples } from '../web/lib/design.js';

export const DESIGN_CASES = [
  { name: 'grb2-sh3', design: 'grb2-sh3.design.json', dataset: 'mavedb-grb2-sh3', counts: 'counts.csv', scores: 'scores.csv' },
  { name: 'brca1-ring-e2', design: 'brca1-ring-e2.design.json', dataset: 'mavedb-brca1-ring', counts: 'aa/counts.csv', scores: 'aa/scores.csv' },
  { name: 'brca1-ring-y2h', design: 'brca1-ring-y2h.design.json', dataset: 'mavedb-brca1-ring', counts: 'aa/counts.csv' },
  { name: 'factor9', design: 'factor9.design.json', dataset: 'mavedb-factor9', counts: 'counts.csv', scores: 'scores.csv' },
];

export function readDesign(file) {
  return JSON.parse(readFileSync(new URL(`./designs/${file}`, import.meta.url), 'utf8'));
}

// A MaveDB CSV (comma-separated, no quoting, CRLF line ends) as { columns, data: { column →
// strings } }. Enough for these files; web/lib/csv.js (wave 1, slice 3) reads tables in general.
export function readTable(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.length);
  const columns = lines[0].split(',');
  const data = Object.fromEntries(columns.map((c) => [c, new Array(lines.length - 1)]));
  for (let i = 1; i < lines.length; i += 1) {
    const cells = lines[i].split(',');
    if (cells.length !== columns.length) throw new Error(`row ${i + 1} has ${cells.length} cells, the header ${columns.length}`);
    for (let j = 0; j < columns.length; j += 1) data[columns[j]][i - 1] = cells[j];
  }
  return { columns, rows: lines.length - 1, data, crlf: text.includes('\r\n') };
}

// A count as a number: NA (or empty) is missing (NaN), not zero.
export function count(cell) {
  return cell === 'NA' || cell === '' ? Number.NaN : Number(cell);
}

const THREE = {
  Ala: 'A', Arg: 'R', Asn: 'N', Asp: 'D', Cys: 'C', Gln: 'Q', Glu: 'E', Gly: 'G', His: 'H', Ile: 'I',
  Leu: 'L', Lys: 'K', Met: 'M', Phe: 'F', Pro: 'P', Ser: 'S', Thr: 'T', Trp: 'W', Tyr: 'Y', Val: 'V', Ter: '*',
};
const CODONS = (() => {
  const bases = 'TCAG';
  const aas = 'FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG';
  const table = {};
  let i = 0;
  for (const a of bases) for (const b of bases) for (const c of bases) table[a + b + c] = aas[i++];
  return table;
})();

// The target's protein sequence (translated from its reading frame for a DNA target).
export function targetProtein(target) {
  if (target.sequenceType === 'protein') return target.sequence.toUpperCase();
  const dna = target.sequence.toUpperCase().slice((target.codingStart ?? 1) - 1);
  let out = '';
  for (let i = 0; i + 3 <= dna.length; i += 3) out += CODONS[dna.slice(i, i + 3)] ?? 'X';
  return out;
}

// Single substitutions and synonymous variants (p.Ala12Val, p.Ala12=, p.Ala12Ter), and the
// components of multi-variants: [{ position, ref }]. A stand-in for web/lib/hgvs.js (slice 3).
export function referenceResidues(name) {
  const out = [];
  const body = name.startsWith('p.[') ? name.slice(3, -1).split(';') : name.startsWith('p.') ? [name.slice(2)] : [];
  for (const part of body) {
    const m = /^([A-Z][a-z]{2})(\d+)(?:[A-Z][a-z]{2}|=)$/.exec(part);
    if (m && THREE[m[1]]) out.push({ position: Number(m[2]), ref: THREE[m[1]] });
  }
  return out;
}

// Checks of a design against its table: [{ name, value, ok, required }].
export function dataChecks(design, table) {
  const checks = [];
  const add = (name, value, ok, required) => checks.push({ name, value, ok, required });
  const samples = new Map(design.samples.map((s) => [s.id, s]));
  const variants = table.data[design.variants.column];

  // Copies: every column declared a copy of another holds exactly the same cells.
  const copies = (design.ignoredColumns ?? []).filter((c) => c.copyOf);
  if (copies.length) {
    const differing = copies.filter((c) => table.data[c.column].some((v, i) => v !== table.data[c.copyOf][i]));
    add('columns declared copies of a shared sample are identical to it, cell for cell', `${copies.length - differing.length} of ${copies.length}${differing.length ? `; differing: ${differing.map((c) => c.column).join(', ')}` : ''}`, !differing.length, 'all');
  }
  // No other column of counts used by this design duplicates another (an undeclared shared sample).
  const used = design.samples.flatMap((s) => s.columns);
  const seen = new Map();
  const duplicates = [];
  for (const column of used) {
    const key = table.data[column].join(',');
    if (seen.has(key)) duplicates.push(`${column} = ${seen.get(key)}`);
    else seen.set(key, column);
  }
  add('no two samples of the design have identical columns (an undeclared shared sample)', duplicates.length ? duplicates.join('; ') : 'none', !duplicates.length, 'none');

  // Wild type present, with counts in every sample.
  const wildType = design.controls?.wildType;
  if (wildType && wildType !== 'auto') {
    const row = variants.indexOf(wildType);
    const missing = row < 0 ? used : used.filter((c) => !Number.isFinite(count(table.data[c][row])));
    add(`the wild-type row "${wildType}" is present and counted in every sample`, row < 0 ? 'no such row' : `${used.length - missing.length} of ${used.length} samples`, row >= 0 && !missing.length, 'all');
  }

  // The target: every variant's reference residue is the target's (or a known difference).
  const protein = targetProtein(design.targets[0]);
  const differences = new Map((design.targets[0].differences ?? []).map((d) => [d.position, d]));
  let checked = 0;
  const wrong = [];
  let beyond = 0;
  for (const name of variants) {
    for (const { position, ref } of referenceResidues(name)) {
      if (position > protein.length) {
        beyond += 1;
        continue;
      }
      checked += 1;
      const expected = protein[position - 1];
      if (ref !== expected && !(differences.has(position) && ref === differences.get(position).target)) wrong.push(`${name} (target ${expected})`);
    }
  }
  add(`variants' reference residues agree with the target (${protein.length} positions)`, `${checked - wrong.length} of ${checked} residues${wrong.length ? `; disagree: ${wrong.slice(0, 4).join(', ')}` : ''}${beyond ? `; ${beyond} beyond the target` : ''}`, !wrong.length && !beyond && checked > 0, 'all');

  // Tiles: the variants counted in a tile's columns lie within the tile.
  const tiles = design.library?.tiles ?? [];
  if (tiles.length) {
    const outside = [];
    for (const tile of tiles) {
      const columns = design.replicates.filter((r) => r.tile === tile.id).flatMap((r) => replicateSamples(r).flatMap((s) => samples.get(s.sample).columns));
      let positions = 0;
      for (let i = 0; i < variants.length; i += 1) {
        const residues = referenceResidues(variants[i]);
        if (!residues.length || !columns.some((c) => Number.isFinite(count(table.data[c][i])))) continue;
        positions += 1;
        for (const { position } of residues) if (position < tile.start || position > tile.end) outside.push(`${variants[i]} in ${tile.id}`);
      }
      if (!positions) outside.push(`${tile.id} counts no variant`);
    }
    add('every variant counted in a tile lies within the tile', outside.length ? outside.slice(0, 4).join('; ') : `${tiles.length} tiles`, !outside.length, 'all');
  }
  return checks;
}
