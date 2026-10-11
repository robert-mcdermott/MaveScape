// ClinVar's records of a gene's missense, nonsense and synonymous variants (wave 3, slice 5), from
// NCBI's E-utilities: the search (/api/fetch/clinvar/search, 10,000 records a page) and the records'
// summaries (/api/fetch/clinvar/summary, 500 at a time), kept as one table of what MaveScape reads
// (clinvarCSV): each record's accession, variant (its transcript, c. and p. names), classification,
// review status and date. On the map, each protein change at its position, classed as ClinVar
// classes it (pathogenic, conflicting, uncertain, benign, other), with its review status as stars.
// ClinVar names a variant on a RefSeq transcript (its MANE Select, mostly); the records on the
// transcript most of them use are placed, by the target's offset, where the residues agree.

import { parseTable, columnText } from '../csv.js';
import { CLINVAR_CLASSES, REVIEW_STARS, clinvarClass, placeResidues, readSubstitution, substitutionKey, variantsTrack } from '../tracks.js';
import { count, placementNotes, recordOf } from './common.js';

export const CLINVAR_COLUMNS = ['accession', 'variation_id', 'title', 'transcript', 'hgvs_c', 'hgvs_p', 'classification', 'review_status', 'last_evaluated', 'consequence'];
const SEARCH_PAGE = 10000;
const SUMMARY_SIZE = 500;
// NM_002086.5(GRB2):c.643C>T (p.Arg215Trp)
const TITLE = /^((?:NM|XM|NR)_\d+\.\d+)\(([^)]+)\):(c\.\S+)(?: \((p\.[^)]+)\))?$/;

const csvCell = (s) => {
  const t = String(s ?? '');
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

// One summary (esummary's result[uid]) → a row of CLINVAR_COLUMNS, or null when its title names
// no single variant of the gene on a transcript.
export function clinvarRow(record, gene) {
  const m = TITLE.exec(String(record.title ?? '').trim());
  if (!m || (gene && m[2].toUpperCase() !== gene.toUpperCase())) return null;
  const classification = record.germline_classification ?? record.clinical_significance ?? {};
  return {
    accession: record.accession ?? '',
    variation_id: record.uid ?? '',
    title: record.title,
    transcript: m[1],
    hgvs_c: m[3],
    hgvs_p: m[4] ?? '',
    classification: classification.description ?? '',
    review_status: classification.review_status ?? '',
    // ClinVar writes "1/01/01 00:00" where there is no date.
    last_evaluated: /^\d{4}\/\d{2}\/\d{2}/.test(classification.last_evaluated ?? '') ? classification.last_evaluated.slice(0, 10).replace(/\//g, '-') : '',
    consequence: (record.molecular_consequence_list ?? []).join('; '),
  };
}

export function clinvarCSV(rows) {
  return `${[CLINVAR_COLUMNS.join(','), ...rows.map((r) => CLINVAR_COLUMNS.map((k) => csvCell(r[k])).join(','))].join('\n')}\n`;
}

// The table → its rows (CLINVAR_COLUMNS).
export function readClinVarTable(text) {
  const table = parseTable(String(text), { delimiter: ',' });
  const cols = Object.fromEntries(CLINVAR_COLUMNS.map((k) => [k, table.columns.find((c) => c.name === k)]));
  if (!cols.hgvs_p || !cols.classification) throw new Error('This is not MaveScape\'s table of ClinVar records.');
  const text_ = Object.fromEntries(CLINVAR_COLUMNS.map((k) => [k, cols[k] ? columnText(cols[k]) : []]));
  return Array.from({ length: table.rows }, (_, r) => Object.fromEntries(CLINVAR_COLUMNS.map((k) => [k, text_[k][r] ?? ''])));
}

export const CLINVAR = {
  id: 'clinvar',
  name: 'ClinVar',
  kind: 'public',
  service: 'ClinVar (NCBI E-utilities)',
  what: 'ClinVar\'s classifications of the gene\'s missense, nonsense and synonymous variants, with their review status',
  license: 'public domain (NCBI)',
  cite: ['clinvar'],
  needs(target) {
    if (!target?.identifiers?.gene) return 'The target names no gene: give its symbol in Experiment, Target (as UniProt\'s check does).';
    if (target.organism && !/^homo sapiens$/i.test(target.organism.trim())) return `ClinVar holds human variants; the target is of ${target.organism}.`;
    return null;
  },
  async fetch(target, context, get, progress = () => {}) {
    const gene = target.identifiers.gene.toUpperCase();
    const retrievals = [];
    const ids = [];
    let total = Infinity;
    for (let page = 1; ids.length < total && page <= 20; page += 1) {
      const got = await get(`clinvar/search?gene=${encodeURIComponent(gene)}&page=${page}`);
      if (!got.ok) throw new Error(got.message);
      retrievals.push(got.retrieval);
      const result = got.json?.esearchresult;
      if (!result) throw new Error('ClinVar\'s search answered without results.');
      total = Number(result.count);
      ids.push(...(result.idlist ?? []));
      if ((result.idlist ?? []).length < SEARCH_PAGE) break;
    }
    const rows = [];
    let unnamed = 0;
    for (let i = 0; i < ids.length; i += SUMMARY_SIZE) {
      progress(i / Math.max(1, ids.length), `ClinVar's records ${i + 1}–${Math.min(ids.length, i + SUMMARY_SIZE)} of ${ids.length}`);
      const got = await get(`clinvar/summary?ids=${ids.slice(i, i + SUMMARY_SIZE).join(',')}`);
      if (!got.ok) throw new Error(got.message);
      retrievals.push(got.retrieval);
      const result = got.json?.result ?? {};
      for (const uid of result.uids ?? []) {
        const row = clinvarRow(result[uid], gene);
        if (row) rows.push(row);
        else unnamed += 1;
      }
    }
    rows.sort((a, b) => (a.accession < b.accession ? -1 : a.accession > b.accession ? 1 : 0));
    return { text: clinvarCSV(rows), fileName: `clinvar_${gene}.csv`, record: recordOf(retrievals, { gene, records: ids.length, kept: rows.length, unnamed, service: 'ClinVar (NCBI E-utilities)', license: 'public domain (NCBI)', citation: 'Landrum MJ, et al. Nucleic Acids Res. 2018;46:D1062–D1067' }) };
  },
  read(text, context) {
    const rows = readClinVarTable(text);
    // The transcript most records name: its protein is the one numbered.
    const tally = new Map();
    for (const r of rows) tally.set(r.transcript, (tally.get(r.transcript) ?? 0) + 1);
    const transcript = [...tally].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? null;
    const items = [];
    let other = 0;
    let unread = 0;
    for (const r of rows) {
      if (r.transcript !== transcript) {
        other += 1;
        continue;
      }
      const s = readSubstitution(r.hgvs_p);
      if (!s) {
        unread += 1;
        continue;
      }
      items.push({ refPosition: s.position, ref: s.ref, alt: s.alt, row: r });
    }
    const place = placeResidues(items, context.protein, context.offset ?? 0);
    if (place.problem) return { tracks: [], notes: [], problem: `ClinVar on ${transcript}: ${place.problem}` };
    const entries = place.placed.map(({ position, ref, alt, row }) => {
      const stars = REVIEW_STARS[row.review_status.toLowerCase()] ?? 0;
      const cls = clinvarClass(row.classification) ?? 'other';
      return {
        key: substitutionKey(ref, position, alt), position, ref, alt, value: stars, cls, stars, name: row.hgvs_c,
        label: `${row.classification || 'not classified'} ${'★'.repeat(stars)}${'☆'.repeat(4 - stars)}`,
        detail: `${row.accession}, ${row.hgvs_c}; ${row.review_status}${row.last_evaluated ? `; last evaluated ${row.last_evaluated}` : ''}`,
      };
    });
    const notes = placementNotes(place, 'record');
    if (other) notes.push(`${count(other, 'record')} on other transcripts than ${transcript} left out.`);
    if (unread) notes.push(`${count(unread, 'record')} whose protein change is not a single substitution left out.`);
    const track = variantsTrack({ part: 'clinvar', label: 'ClinVar', length: context.length, unit: 'records', format: (x) => String(x), transcript }, entries, { summary: 'count', classes: CLINVAR_CLASSES });
    return { tracks: [track], notes };
  },
};
