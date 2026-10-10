// Inputs for the differential checks of the suite `scoring` (wave 2, slice 6): the two-condition
// fixture (fixtures/make-two-condition.mjs) and cystathionine beta-synthase's two vitamin B6
// levels (MaveDB urn:mavedb:00000005-a-5 and -a-6, shared inputs) as MaveScape reads them, and the
// comparisons with mutscan's limma contrasts (reference/mutscan.json) and Enrich2's comparison of
// conditions (reference/enrich2.json, case two-condition).

import { readFileSync } from 'node:fs';
import { columnText, parseTable } from '../web/lib/csv.js';

export const mutscanReference = () => JSON.parse(readFileSync(new URL('./reference/mutscan.json', import.meta.url), 'utf8'));

// The fixture, its design and its truth (each variant's differential).
export function twoConditionCase() {
  const table = parseTable(new Uint8Array(readFileSync(new URL('./fixtures/two-condition.csv', import.meta.url))));
  const design = JSON.parse(readFileSync(new URL('./fixtures/two-condition.design.json', import.meta.url), 'utf8'));
  const truth = new Map(readFileSync(new URL('./fixtures/two-condition.truth.csv', import.meta.url), 'utf8').trim().split('\n').slice(1).map((line) => {
    const [name, kind, without, withLigand, differential] = line.split(',');
    return [name, { kind, effects: [Number(without), Number(withLigand)], differential: Number(differential) }];
  }));
  const names = columnText(table.columns.find((c) => c.name === 'hgvs_pro'));
  const columns = Object.fromEntries(table.columns.slice(1).map((c) => [c.name, c.numeric]));
  return { names, columns, design, truth, ids: names };
}

// CBS's coding sequence (MaveDB's target for both records: 551 codons and the stop).
const CBS = [
  'ATGCCTTCTGAGACCCCCCAGGCAGAAGTGGGGCCCACAGGCTGCCCCCACCGCTCAGGGCCACACTCGGCGAAGGGGAGCCTGGAGAAG',
  'GGGTCCCCAGAGGATAAGGAAGCCAAGGAGCCCCTGTGGATCCGGCCCGATGCTCCGAGCAGGTGCACCTGGCAGCTGGGCCGGCCTGCC',
  'TCCGAGTCCCCACATCACCACACTGCCCCGGCAAAATCTCCAAAAATCTTGCCAGATATTCTGAAGAAAATCGGGGACACCCCTATGGTC',
  'AGAATCAACAAGATTGGGAAGAAGTTCGGCCTGAAGTGTGAGCTCTTGGCCAAGTGTGAGTTCTTCAACGCGGGCGGGAGCGTGAAGGAC',
  'CGCATCAGCCTGCGGATGATTGAGGATGCTGAGCGCGACGGGACGCTGAAGCCCGGGGACACGATTATCGAGCCGACATCCGGGAACACC',
  'GGGATCGGGCTGGCCCTGGCTGCGGCAGTGAGGGGCTATCGCTGCATCATCGTGATGCCAGAGAAGATGAGCTCCGAGAAGGTGGACGTG',
  'CTGCGGGCACTGGGGGCTGAGATTGTGAGGACGCCCACCAATGCCAGGTTCGACTCCCCGGAGTCACACGTGGGGGTGGCCTGGCGGCTG',
  'AAGAACGAAATCCCCAATTCTCACATCCTAGACCAGTACCGCAACGCCAGCAACCCCCTGGCTCACTACGACACCACCGCTGATGAGATC',
  'CTGCAGCAGTGTGATGGGAAGCTGGACATGCTGGTGGCTTCAGTGGGCACGGGCGGCACCATCACGGGCATTGCCAGGAAGCTGAAGGAG',
  'AAGTGTCCTGGATGCAGGATCATTGGGGTGGATCCCGAAGGGTCCATCCTCGCAGAGCCGGAGGAGCTGAACCAGACGGAGCAGACAACC',
  'TACGAGGTGGAAGGGATCGGCTACGACTTCATCCCCACGGTGCTGGACAGGACGGTGGTGGACAAGTGGTTCAAGAGCAACGATGAGGAG',
  'GCGTTCACCTTTGCCCGCATGCTGATCGCGCAAGAGGGGCTGCTGTGCGGTGGCAGTGCTGGCAGCACGGTGGCGGTGGCCGTGAAGGCC',
  'GCGCAGGAGCTGCAGGAGGGCCAGCGCTGCGTGGTCATTCTGCCCGACTCAGTGCGGAACTACATGACCAAGTTCCTGAGCGACAGGTGG',
  'ATGCTGCAGAAGGGCTTTCTGAAGGAGGAGGACCTCACGGAGAAGAAGCCCTGGTGGTGGCACCTCCGTGTTCAGGAGCTGGGCCTGTCA',
  'GCCCCGCTGACCGTGCTCCCGACCATCACCTGTGGGCACACCATCGAGATCCTCCGGGAGAAGGGCTTCGACCAGGCGCCCGTGGTGGAT',
  'GAGGCGGGGGTAATCCTGGGAATGGTGACGCTTGGGAACATGCTCTCGTCCCTGCTTGCCGGGAAGGTGCAGCCGTCAGACCAAGTTGGC',
  'AAAGTCATCTACAAGCAGTTCAAACAGATCCGCCTCACGGACACGCTGGGCAGGCTCTCGCACATCCTGGAGATGGACCACTTCGCCCTG',
  'GTGGTGCACGAGCAGATCCAGTACCACAGCACCGGGAAGTCCAGTCAGCGGCAGATGGTGTTCGGGGTGGTCACCGCCATTGACTTGCTG',
  'AACTTCGTGGCCGCCCAGGAGCGGGACCAGAAGTGA',
].join('');

// CBS: the two records joined on hgvs_nt in the low-B6 record's order; inputs nonselect1–4 (counted
// only where both records count them), outputs select1–4 of each record. data: run.mjs's
// dataset('mavedb-cbs'). Variants by their codon (hgvs_nt: several codons give one protein
// variant), the synonymous ones named in the design's controls (their hgvs_pro ends in "="); scored
// relative to them (the data have no wild type).
export function cbsCase(data) {
  const low = parseTable(data.bytes('low-b6-counts.csv'));
  const high = parseTable(data.bytes('high-b6-counts.csv'));
  const col = (t, name) => t.columns.find((c) => c.name === name);
  const lowNt = columnText(col(low, 'hgvs_nt'));
  const highNt = columnText(col(high, 'hgvs_nt'));
  const highRow = new Map(highNt.map((k, i) => [k, i]));
  const rows = [];
  lowNt.forEach((k, i) => {
    if (highRow.has(k)) rows.push([i, highRow.get(k)]);
  });
  const lowPro = columnText(col(low, 'hgvs_pro'));
  const ids = rows.map(([i]) => lowNt[i]);
  const names = ids;
  const synonymous = rows.filter(([i]) => lowPro[i].endsWith('=')).map(([i]) => lowNt[i]);
  const columns = {};
  for (let r = 1; r <= 4; r += 1) {
    const a = col(low, `nonselect${r}`).numeric;
    const b = col(high, `nonselect${r}`).numeric;
    columns[`nonselect${r}`] = Float64Array.from(rows, ([i, j]) => (Number.isNaN(a[i]) || Number.isNaN(b[j]) ? Number.NaN : a[i]));
    columns[`low${r}`] = Float64Array.from(rows, ([i]) => col(low, `select${r}`).numeric[i]);
    columns[`high${r}`] = Float64Array.from(rows, ([, j]) => col(high, `select${r}`).numeric[j]);
  }
  const design = {
    format: 'mavescape-design', version: 1,
    name: 'CBS yeast complementation, low and high vitamin B6',
    source: { mavedb: 'urn:mavedb:00000005-a-5 and urn:mavedb:00000005-a-6', citation: 'Sun et al., Genome Medicine 2020, doi:10.1186/s13073-020-0711-1', license: 'CC0' },
    model: 'two-population',
    variants: { column: 'hgvs_nt', level: 'nucleotide' },
    targets: [{ id: 'cbs', name: 'CBS', sequenceType: 'dna', sequence: CBS, codingStart: 1, identifiers: { uniprot: 'P35520', gene: 'CBS' } }],
    library: { level: 'variant' },
    conditions: [{ id: 'low', name: 'Low B6', reference: true }, { id: 'high', name: 'High B6' }],
    samples: Object.keys(columns).map((id) => ({ id, name: id, columns: [id] })),
    replicates: [1, 2, 3, 4].flatMap((r) => [
      { id: `low-${r}`, name: `Low B6, replicate ${r}`, biological: r, condition: 'low', input: `nonselect${r}`, output: `low${r}` },
      { id: `high-${r}`, name: `High B6, replicate ${r}`, biological: r, condition: 'high', input: `nonselect${r}`, output: `high${r}` },
    ]),
    controls: { wildType: 'auto', synonymous, nonsense: 'none' },
  };
  return { names, columns, design, ids };
}

// MaveScape's limma differential against mutscan's, row by row: the worst relative difference of
// each quantity (log₂ fold change and its SE, t, p, the BH-adjusted p, the interval) and of
// df.prior, and whether the rows fitted are the same.
export function compareLimma(contrast, ids, ref) {
  const LN2 = Math.LN2;
  const row = new Map(ids.map((k, i) => [k, i]));
  const rel = (a, b) => (a === b ? 0 : Math.abs(a - b) / Math.max(Math.abs(b), 1e-300));
  const worst = { logFC: 0, se: 0, t: 0, p: 0, q: 0, ci: 0, dfTotal: 0 };
  let compared = 0;
  let missing = 0;
  ref.ids.forEach((id, k) => {
    const i = row.get(id);
    if (i === undefined || contrast.reason[i]) {
      missing += 1;
      return;
    }
    compared += 1;
    // log₂ fold changes near 0 (the reference itself) are compared absolutely.
    const fc = contrast.delta[i] / LN2;
    worst.logFC = Math.max(worst.logFC, Math.abs(ref.logFC[k]) < 1e-6 ? Math.abs(fc - ref.logFC[k]) : rel(fc, ref.logFC[k]));
    worst.se = Math.max(worst.se, rel(contrast.se[i] / LN2, ref.se[k]));
    worst.t = Math.max(worst.t, Math.abs(ref.t[k]) < 1e-6 ? Math.abs(contrast.z[i] - ref.t[k]) : rel(contrast.z[i], ref.t[k]));
    worst.p = Math.max(worst.p, rel(contrast.p[i], ref.p[k]));
    worst.q = Math.max(worst.q, rel(contrast.q[i], ref.q[k]));
    worst.ci = Math.max(worst.ci, Math.abs(contrast.ciLow[i] / LN2 - ref.ciLow[k]) / ref.se[k], Math.abs(contrast.ciHigh[i] / LN2 - ref.ciHigh[k]) / ref.se[k]);
    worst.dfTotal = Math.max(worst.dfTotal, rel(contrast.df, ref.dfTotal[k]));
  });
  const fitted = contrast.reason.reduce((a, r) => a + (r ? 0 : 1), 0);
  return { worst, compared, missing, fitted, rows: ref.rows, dfPrior: [contrast.prior.df, ref.dfPrior] };
}
