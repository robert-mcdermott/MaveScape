// MaveDB's own annotations of a score set's variants (wave 3, slice 5), first for a run of a MaveDB
// record: which it keeps (/api/fetch/mavedb/score-sets/{urn}/namespaces), then gnomAD's frequencies
// and the latest ClinVar release's classifications, variant by variant
// (/api/fetch/mavedb/score-sets/{urn}/annotations), kept as MaveDB sends them. MaveDB maps each
// variant to the human genome (Arbesfeld et al. 2025) to join them, so they need no gene or offset:
// each row is the score set's own variant, found in the run by its accession (urn#n) or name. MaveDB annotates the
// variants it maps at the nucleotide level; a score set of protein variants has none.

import { parseTable, columnText } from '../csv.js';
import { CLINVAR_CLASSES, REVIEW_STARS, clinvarClass, variantsTrack } from '../tracks.js';
import { count, recordOf } from './common.js';

const missing = (x) => x === undefined || x === '' || x === 'NA' || x === '-';
const af = (x) => (x >= 0.001 ? x.toPrecision(2) : x.toExponential(1));

// The latest ClinVar release among a score set's namespaces (clinvar.2026_01 → 2026_01).
export function latestClinVar(namespaces) {
  return (namespaces ?? []).map((n) => /^clinvar\.(\d{4}_\d{2})$/.exec(n.namespace)?.[1]).filter(Boolean).sort().at(-1) ?? null;
}

export const MAVEDB_ANNOTATIONS = {
  id: 'mavedb-annotations',
  name: 'MaveDB\'s annotations',
  kind: 'public',
  service: 'MaveDB',
  what: 'gnomAD\'s frequencies and ClinVar\'s classifications that MaveDB joins to the score set\'s variants',
  license: 'CC0 (gnomAD), public domain (ClinVar)',
  cite: ['mavedb', 'mavedbmapping', 'clinvar', 'gnomad'],
  needs(target, context) {
    return context?.origin?.urn ? null : 'The run is not of a MaveDB record: MaveDB annotates the variants of the score sets it holds.';
  },
  async fetch(target, context, get) {
    const urn = context.origin.urn;
    const ns = await get(`mavedb/score-sets/${encodeURIComponent(urn)}/namespaces`);
    if (!ns.ok) throw new Error(ns.message);
    const release = latestClinVar(ns.json);
    const got = await get(`mavedb/score-sets/${encodeURIComponent(urn)}/annotations${release ? `?clinvar=${release}` : ''}`, { as: 'text' });
    if (!got.ok) throw new Error(got.message);
    return { text: got.text, fileName: `${urn.replace(/:/g, '_')}.annotations.csv`, record: recordOf([ns.retrieval, got.retrieval], { urn, release: release ? `ClinVar ${release}` : null, clinvar: release, license: 'CC0 (gnomAD), public domain (ClinVar)', citation: 'Arbesfeld JA, et al. Genome Biol. 2025;26:179' }) };
  },
  read(text, context) {
    const table = parseTable(String(text), { delimiter: ',' });
    const col = (name) => table.columns.find((c) => c.name === name) ?? null;
    const texts = (c) => (c ? columnText(c) : []);
    const accessions = texts(col('accession'));
    const nt = texts(col('hgvs_nt'));
    const pro = texts(col('hgvs_pro'));
    const sigCol = table.columns.find((c) => /^clinvar\.\d{4}_\d{2}\.clinical_significance$/.test(c.name));
    const release = sigCol ? /^clinvar\.(\d{4}_\d{2})/.exec(sigCol.name)[1] : null;
    const sig = texts(sigCol);
    const review = texts(release ? col(`clinvar.${release}.clinical_review_status`) : null);
    const afs = texts(col('gnomad.gnomad_af'));
    const acs = texts(col('gnomad.gnomad_ac'));
    const ans = texts(col('gnomad.gnomad_an'));
    const ids = texts(col('gnomad.gnomad_id'));
    const version = texts(col('gnomad.gnomad_version')).find((x) => !missing(x)) ?? null;
    const clinvar = [];
    const gnomad = [];
    let unmatched = 0;
    let offMap = 0;
    for (let r = 0; r < table.rows; r += 1) {
      const name = !missing(nt[r]) ? nt[r] : pro[r];
      const hasClinVar = !missing(sig[r]);
      const hasGnomad = !missing(afs[r]);
      if (!hasClinVar && !hasGnomad) continue;
      // Found by its MaveDB accession (urn#n) in the run's table, else by its name.
      const v = context.variants?.get(accessions[r]) ?? context.variants?.get(name);
      if (!v) {
        unmatched += 1;
        continue;
      }
      if (!(v.position >= 1 && v.position <= context.length) || !v.key) {
        offMap += 1;
        continue;
      }
      if (hasClinVar) {
        const stars = REVIEW_STARS[String(review[r]).toLowerCase()] ?? 0;
        clinvar.push({ key: v.key, name, position: v.position, value: stars, stars, cls: clinvarClass(sig[r]) ?? 'other', label: `${sig[r]} ${'★'.repeat(stars)}${'☆'.repeat(4 - stars)}`, detail: `${name}; ${review[r]}` });
      }
      if (hasGnomad) {
        const x = Number(afs[r]);
        gnomad.push({ key: v.key, name, position: v.position, value: x, label: `AF ${af(x)}`, detail: `${name}; allele count ${acs[r]} of ${ans[r]}, ${ids[r]}` });
      }
    }
    const notes = [];
    if (unmatched) notes.push(`${count(unmatched, 'annotated variant')} not in the run left out.`);
    if (offMap) notes.push(`${count(offMap, 'annotated variant')} not on the map (no protein position) left out.`);
    const tracks = [];
    if (clinvar.length) tracks.push(variantsTrack({ part: 'clinvar', label: 'ClinVar (MaveDB)', release: `ClinVar ${release}`, length: context.length, unit: 'variants', format: (x) => String(x) }, clinvar, { summary: 'count', classes: CLINVAR_CLASSES }));
    if (gnomad.length) {
      tracks.push(variantsTrack({
        part: 'gnomad', label: 'gnomAD (MaveDB)', release: version ? `gnomAD ${version}` : null, length: context.length, unit: 'largest allele frequency', format: af,
        minimum: { label: 'Allele frequency, at least', options: [1e-6, 1e-5, 1e-4, 1e-3, 1e-2], format: af }, domain: { kind: 'sequential', min: 1e-6, max: 1 },
      }, gnomad, { summary: 'max', scale: 'log' }));
    }
    if (!tracks.length) return { tracks, notes, problem: 'MaveDB holds no ClinVar classification or gnomAD frequency for this score set\'s variants (it annotates variants it maps at the nucleotide level).' };
    return { tracks, notes };
  },
};
