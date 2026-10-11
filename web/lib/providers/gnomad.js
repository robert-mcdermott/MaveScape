// gnomAD's variants of a gene (wave 3, slice 5): its MANE Select transcript (/api/fetch/gnomad/gene/
// {symbol}), then that transcript's variants in gnomAD v4 (/api/fetch/gnomad/transcript/{id}), kept
// as one table of what MaveScape reads (gnomadCSV): each variant's identifier, its c. and p. names
// on the transcript, its consequence, its allele count and number with exomes and genomes joined,
// and gnomAD's filters. On the map, each protein change's allele frequency (the frequencies of the
// variants that make it, added), a position its largest, on a log scale; variants failing gnomAD's
// filters, or not seen (AC 0), left out.

import { parseTable, columnText } from '../csv.js';
import { placeResidues, readSubstitution, substitutionKey, variantsTrack } from '../tracks.js';
import { count, placementNotes, recordOf } from './common.js';

export const GNOMAD_COLUMNS = ['variant_id', 'hgvsc', 'hgvsp', 'consequence', 'ac', 'an', 'filters', 'flags'];
export const GNOMAD_DATASET = 'gnomad_r4';

const csvCell = (s) => {
  const t = String(s ?? '');
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

// gnomAD's answer for a transcript → rows of GNOMAD_COLUMNS: the variants with a protein change.
export function gnomadRows(json) {
  const variants = json?.data?.transcript?.variants;
  if (!Array.isArray(variants)) throw new Error('gnomAD\'s answer holds no variants of the transcript.');
  return variants.filter((v) => v.hgvsp).map((v) => ({
    variant_id: v.variant_id, hgvsc: v.hgvsc ?? '', hgvsp: v.hgvsp, consequence: v.consequence ?? '',
    ac: v.joint?.ac ?? '', an: v.joint?.an ?? '', filters: (v.joint?.filters ?? []).join(';'), flags: (v.flags ?? []).join(';'),
  }));
}

export function gnomadCSV(rows) {
  return `${[GNOMAD_COLUMNS.join(','), ...rows.map((r) => GNOMAD_COLUMNS.map((k) => csvCell(r[k])).join(','))].join('\n')}\n`;
}

export function readGnomadTable(text) {
  const table = parseTable(String(text), { delimiter: ',' });
  const cols = Object.fromEntries(GNOMAD_COLUMNS.map((k) => [k, table.columns.find((c) => c.name === k)]));
  if (!cols.hgvsp || !cols.ac || !cols.an) throw new Error('This is not MaveScape\'s table of gnomAD variants.');
  const texts = Object.fromEntries(GNOMAD_COLUMNS.map((k) => [k, cols[k] ? columnText(cols[k]) : []]));
  return Array.from({ length: table.rows }, (_, r) => Object.fromEntries(GNOMAD_COLUMNS.map((k) => [k, texts[k][r] ?? ''])));
}

const FREQUENCIES = [1e-6, 1e-5, 1e-4, 1e-3, 1e-2];
const af = (x) => (x >= 0.001 ? x.toPrecision(2) : x.toExponential(1));

// Rows → the protein changes that are single substitutions, each with its frequency: [{ ref,
// refPosition, alt, value, ac, an, ids }], and what was left out.
export function gnomadSubstitutions(rows) {
  const byKey = new Map();
  let filtered = 0;
  let unseen = 0;
  let other = 0;
  for (const r of rows) {
    const s = readSubstitution(r.hgvsp);
    if (!s) {
      other += 1;
      continue;
    }
    const ac = Number(r.ac);
    const an = Number(r.an);
    if (r.filters) {
      filtered += 1;
      continue;
    }
    if (!(ac > 0) || !(an > 0)) {
      unseen += 1;
      continue;
    }
    const key = `${s.ref}${s.position}${s.alt}`;
    const item = byKey.get(key) ?? { ref: s.ref, refPosition: s.position, alt: s.alt, value: 0, ac: 0, ids: [] };
    item.value += ac / an;
    item.ac += ac;
    item.an = Math.max(item.an ?? 0, an);
    item.ids.push(r.variant_id);
    byKey.set(key, item);
  }
  return { items: [...byKey.values()], filtered, unseen, other };
}

export const GNOMAD = {
  id: 'gnomad',
  name: 'gnomAD',
  kind: 'public',
  service: 'gnomAD',
  what: 'gnomAD v4\'s allele frequencies of the gene\'s missense, nonsense and synonymous variants (exomes and genomes)',
  license: 'CC0',
  cite: ['gnomad'],
  needs(target) {
    if (!target?.identifiers?.gene) return 'The target names no gene: give its symbol in Experiment, Target.';
    if (target.organism && !/^homo sapiens$/i.test(target.organism.trim())) return `gnomAD holds human variants; the target is of ${target.organism}.`;
    return null;
  },
  async fetch(target, context, get) {
    const gene = target.identifiers.gene.toUpperCase();
    const g = await get(`gnomad/gene/${encodeURIComponent(gene)}`);
    if (!g.ok) throw new Error(g.message);
    const info = g.json?.data?.gene;
    const mane = info?.mane_select_transcript;
    const transcript = mane?.ensembl_id ?? info?.canonical_transcript_id;
    if (!transcript) throw new Error(`gnomAD names no MANE Select or canonical transcript of ${gene}.`);
    const t = await get(`gnomad/transcript/${encodeURIComponent(transcript)}`);
    if (!t.ok) throw new Error(t.message);
    const rows = gnomadRows(t.json);
    const version = t.json.data.transcript.transcript_version;
    return {
      text: gnomadCSV(rows),
      fileName: `gnomad_${gene}_${transcript}.csv`,
      record: recordOf([g.retrieval, t.retrieval], {
        gene, transcript: `${transcript}${version ? `.${version}` : ''}`, mane: mane ? `${mane.refseq_id}.${mane.refseq_version}` : null,
        release: 'v4 (gnomad_r4)', variants: rows.length, license: 'CC0', citation: 'Chen S, et al. Nature 2024;625:92–100',
      }),
    };
  },
  read(text, context) {
    const { items, filtered, unseen, other } = gnomadSubstitutions(readGnomadTable(text));
    const place = placeResidues(items, context.protein, context.offset ?? 0);
    if (place.problem) return { tracks: [], notes: [], problem: `gnomAD on ${context.record?.transcript ?? 'its transcript'}: ${place.problem}` };
    const entries = place.placed.map((x) => ({
      key: substitutionKey(x.ref, x.position, x.alt), position: x.position, ref: x.ref, alt: x.alt, value: x.value,
      label: `AF ${af(x.value)}`, detail: `allele count ${x.ac} of ${x.an}${x.ids.length > 1 ? `, from ${x.ids.length} variants` : ''}: ${x.ids.join(', ')}`,
    }));
    const notes = placementNotes(place, 'protein change');
    if (filtered) notes.push(`${count(filtered, 'variant')} failing gnomAD's filters left out.`);
    if (unseen) notes.push(`${count(unseen, 'variant')} with no allele seen (AC 0) left out.`);
    if (other) notes.push(`${count(other, 'variant')} changing the protein otherwise (frameshifts, in-frame indels, start or stop) not on the map.`);
    const track = variantsTrack({
      part: 'gnomad', label: 'gnomAD', length: context.length, unit: 'largest allele frequency', format: af,
      minimum: { label: 'Allele frequency, at least', options: FREQUENCIES, format: af },
      domain: { kind: 'sequential', min: 1e-6, max: 1 },
    }, entries, { summary: 'max', scale: 'log' });
    return { tracks: [track], notes };
  },
};
