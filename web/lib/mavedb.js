// MaveDB records (wave 3, slice 2; requirement I1). A published score set comes through MaveScape's
// fetcher (fetch.go: its record, its scores and counts as MaveDB writes them, and the search), and
// this module reads it: the record's title and descriptions, license and its terms, citation,
// target, the experiment's controlled keywords (which give the design's readout and library
// method), and its published calibrations; the design of its published scores (model 'scores',
// read as published) and of its counts (drafted from their column names, as for any table); and
// search results. Pure: the window (ui/mavedb.js) and the validation read the same records.
//
//   normalizeUrn(text) → urn | null                       a URN, or one in a MaveDB address
//   readScoreSet(json) → record                           the parts MaveScape uses
//   targetsOf(record, { target }) → { targets, pending, choices, others, problems }
//   accessionTarget(pending, answer, { retrieval }) → { target, origin, messages } | { problem }
//   licenseOf(license) → { short, long, link, terms, open }
//   readoutOf(record) → { readout, libraryMethod, unknown }
//   scoresDesign(record, { table, layout, target }) → design
//   countsDesign(record, { table, layout, target }) → { design, notes }
//   searchHits(json) → { total, hits }

import { IDENTIFIER_COLUMNS } from './design.js';
import { codingFeatures, parseGenBank, preferredFeature, targetFromGenBank } from './genbank.js';
import { draftDesign, draftScoresDesign, suggestRoles } from './importer.js';
import { setAsideOtherColumns } from './design-edit.js';
import { ASSAY_MECHANISMS, ASSAY_METHODS, LIBRARY_METHODS, MODEL_SYSTEMS } from './readout.js';

export const URN = /^urn:mavedb:[0-9]{8}-[a-z0-9]+-[0-9]+$/;

// A published score set's URN, as written or in a MaveDB address
// (https://www.mavedb.org/score-sets/urn:mavedb:00000835-a-1); null for anything else, a
// temporary (unpublished) URN included.
export function normalizeUrn(text) {
  const found = /urn:mavedb:[0-9]{8}-[a-z0-9]+-[0-9]+/i.exec(String(text ?? '').trim())?.[0]?.toLowerCase();
  return found && URN.test(found) ? found : null;
}

// Licenses as MaveDB names them, and what each lets a researcher do. CC0, CC BY and CC BY-SA allow
// any use with the attribution or sharing they ask; CC BY-NC-SA forbids commercial use; a record
// under "other" terms has its own, to read before use.
const LICENSE_TERMS = {
  CC0: 'Public domain: free to use for any purpose. Citing the data is still good practice.',
  'CC BY 4.0': 'Free to use for any purpose, crediting the authors (cite the data and its publication).',
  'CC BY-SA 4.0': 'Free to use for any purpose, crediting the authors; what you share from the data must carry the same license.',
  'CC BY-NC-SA 4.0': 'Non-commercial use only, crediting the authors; what you share from the data must carry the same license.',
};

export function licenseOf(license) {
  const short = license?.shortName ?? 'unknown';
  const terms = LICENSE_TERMS[short] ?? `MaveDB lists this record under "${license?.longName ?? short}": read its terms before using the data${license?.link ? ` (${license.link})` : ''}.`;
  return { short, long: license?.longName ?? short, link: license?.link ?? null, terms, open: ['CC0', 'CC BY 4.0', 'CC BY-SA 4.0'].includes(short) };
}

const stripTags = (html) => String(html ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

// A publication as MaveDB gives it: its reference as text, DOI, PubMed id and address.
// MaveDB writes some references with placeholders ("(None). 2024; (Unknown volume):(Unknown
// pages)", "9:None") or with the title again as the journal; such a reference is written again from
// the publication's fields.
const PLACEHOLDER = /\bNone\b|Unknown (volume|pages)|\bundefined\b/;
const none = (x) => !x || /^\(?(none|preprint)\)?$/i.test(String(x).trim());

function publicationOf(p) {
  if (!p) return null;
  const authors = (p.authors ?? []).map((a) => a.name);
  const html = stripTags(p.referenceHtml);
  // "Beltran, T." → "Beltran T".
  const first = authors[0] ? authors[0].replace(/,\s*/, ' ').replace(/\./g, '').trim() : null;
  // The venue: the journal, or a preprint server; never the index MaveDB looked it up in (Crossref,
  // PubMed).
  const server = /^(bioRxiv|medRxiv|arXiv)$/i.test(p.dbName ?? '') ? p.dbName : null;
  const venue = [none(p.publicationJournal) ? server : p.publicationJournal, p.publicationYear].filter(Boolean).join(' ');
  const title = stripTags(p.title ?? '').replace(/\.$/, '');
  const built = [first ? `${first}${authors.length > 1 ? ', et al' : ''}` : null, title || null, venue || null].filter(Boolean).join('. ');
  // MaveDB's reference, unless it holds placeholders or names the title twice (as the journal).
  const twice = title.length > 20 && html.split(title).length > 2;
  const reference = html && !PLACEHOLDER.test(html) && !twice ? html : built;
  return {
    db: p.dbName, id: p.identifier, title: stripTags(p.title ?? '') || null, authors, year: p.publicationYear ?? null, journal: none(p.publicationJournal) ? null : p.publicationJournal,
    doi: p.doi ?? (/^10\./.test(p.identifier ?? '') ? p.identifier : null), url: p.url ?? null, reference,
  };
}

// The citation of a record: its primary publication's reference, with its DOI.
function citationText(pub) {
  if (!pub) return null;
  return `${pub.reference.replace(/\.?$/, '.')}${pub.doi ? ` doi:${pub.doi}` : pub.db === 'PubMed' ? ` PMID ${pub.id}` : ''}`;
}

const CLASS_NAMES = { normal: 'WT-like (normal)', abnormal: 'abnormal-like (abnormal)', not_specified: 'not specified' };

// A published calibration: its functional classes (MaveDB's normal, abnormal, not specified; shown
// in MaveScape's words, WT-like and abnormal-like), each with its range of scores, and, for a
// clinical calibration, the evidence strength it assigns (research use: MaveScape classifies no
// variant).
function calibrationOf(c) {
  return {
    title: c.title ?? 'Calibration',
    researchUseOnly: Boolean(c.researchUseOnly),
    investigatorProvided: Boolean(c.investigatorProvided),
    primary: Boolean(c.primary),
    baseline: Number.isFinite(c.baselineScore) ? c.baselineScore : null,
    classes: (c.functionalClassifications ?? []).map((k) => ({
      label: k.label ?? k.class ?? '',
      class: k.functionalClassification ?? 'not_specified',
      className: CLASS_NAMES[k.functionalClassification] ?? 'not specified',
      range: Array.isArray(k.range) ? k.range.map((x) => (Number.isFinite(x) ? x : null)) : null,
      inclusive: [Boolean(k.inclusiveLowerBound), Boolean(k.inclusiveUpperBound)],
      byClassColumn: !Array.isArray(k.range) && Boolean(k.class),
      evidence: k.acmgClassification ? { criterion: k.acmgClassification.criterion ?? null, strength: (k.acmgClassification.evidenceStrength ?? '').toLowerCase().replace(/_/g, ' ') || null, points: k.acmgClassification.points ?? null } : null,
      oddsPath: k.oddspathsRatio ?? null,
      variants: k.variantCount ?? null,
    })),
    sources: [...(c.thresholdSources ?? []), ...(c.evidenceSources ?? []), ...(c.methodSources ?? [])].map(publicationOf).filter(Boolean),
  };
}

// The parts of a MaveDB score set's record (GET /score-sets/{urn}) MaveScape uses.
export function readScoreSet(json) {
  if (!json || typeof json !== 'object' || !json.urn) return { problem: 'MaveDB sent something that is not a score set\'s record.' };
  const experiment = json.experiment ?? {};
  const primary = publicationOf(json.primaryPublicationIdentifiers?.[0] ?? experiment.primaryPublicationIdentifiers?.[0]);
  const columns = json.datasetColumns ?? {};
  return {
    urn: json.urn,
    title: json.title ?? json.urn,
    shortDescription: json.shortDescription ?? '',
    abstract: json.abstractText ?? '',
    method: json.methodText ?? '',
    published: json.publishedDate ?? null,
    modified: json.modificationDate ?? null,
    variants: json.numVariants ?? null,
    license: licenseOf(json.license),
    publication: primary,
    citation: citationText(primary),
    secondary: (json.secondaryPublicationIdentifiers ?? []).map(publicationOf).filter(Boolean),
    doi: json.doiIdentifiers?.[0]?.identifier ?? null,
    scoreColumns: columns.scoreColumns ?? [],
    countColumns: columns.countColumns ?? [],
    hasCounts: (columns.countColumns ?? []).length > 0,
    targets: (json.targetGenes ?? []).map((t) => ({
      name: t.name,
      category: t.category ?? null,
      sequenceType: t.targetSequence?.sequenceType ?? null,
      sequence: t.targetSequence?.sequence ?? null,
      label: t.targetSequence?.label ?? null,
      accession: t.targetAccession ? { accession: t.targetAccession.accession, assembly: t.targetAccession.assembly ?? null, gene: t.targetAccession.gene ?? null } : null,
      organism: t.targetSequence?.taxonomy?.organismName ?? null,
      taxonomyId: t.targetSequence?.taxonomy?.code ?? null,
      identifiers: (t.externalIdentifiers ?? []).map((x) => ({ db: x.identifier?.dbName, id: x.identifier?.identifier, offset: x.offset ?? 0 })),
    })),
    keywords: (experiment.keywords ?? []).map((k) => ({ key: k.keyword?.key, label: k.keyword?.label, description: k.description ?? null })),
    calibrations: (json.scoreCalibrations ?? []).map(calibrationOf),
    experiment: { urn: experiment.urn ?? null, title: experiment.title ?? null, rawReads: (experiment.rawReadIdentifiers ?? []).map((r) => ({ id: r.identifier, url: r.url ?? null })) },
    superseded: json.supersedingScoreSet?.urn ?? null,
    // MaveDB's mapping of the variants to the human reference: complete, incomplete, failed…
    mapping: json.mappingState ?? null,
  };
}

const slug = (text) => String(text ?? 'target').replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'target';

// What an accession names, for fetching a target from it: a RefSeq or GenBank transcript (from
// NCBI), an Ensembl transcript, a protein (named beside its transcript), or a genome (not fetched).
export function accessionKind(accession) {
  const a = String(accession ?? '');
  if (/^(NM|NR|XM|XR)_\d+(\.\d+)?$/.test(a)) return 'refseq';
  if (/^ENS[A-Z]*T\d{11}(\.\d+)?$/.test(a)) return 'ensembl';
  if (/^(NP|XP)_\d+(\.\d+)?$/.test(a) || /^ENS[A-Z]*P\d{11}(\.\d+)?$/.test(a)) return 'protein';
  if (/^(NC|NG|NT|NW|NZ|AC)_\d+(\.\d+)?$/.test(a) || /^chr/i.test(a)) return 'genome';
  return 'unknown';
}

// A record target's UniProt, RefSeq and Ensembl identifiers, and the UniProt offset.
function identifiersOf(t) {
  const identifiers = {};
  let offset = 0;
  for (const x of t.identifiers) {
    if (x.db === 'UniProt' && x.id) {
      identifiers.uniprot = x.id;
      offset = x.offset ?? 0;
    } else if (x.db === 'RefSeq' && x.id) identifiers.refseq = x.id;
    else if (x.db === 'Ensembl' && x.id) identifiers.ensembl = x.id;
  }
  return { identifiers, offset };
}

// MaveScape targets from a record's (wave 3, slices 2 and 3):
//   - a sequence: the target itself (DNA read in frame from its first base), with its organism,
//     identifiers and the UniProt offset as the target's offset (positions on the reference
//     protein);
//   - a transcript named by its accession (NM_007294.3, ENST00000460680.5): `pending`, to fetch
//     (NCBI's GenBank record, Ensembl's sequence) and read with accessionTarget; a protein accession
//     beside it (ENSP00000269305.4, the same gene's) names its protein;
//   - several targets (each variant named with its target's label, LMNA:n.127G>A): `choices`, one
//     opened at a time (options.target, a label or name), the others' variants set aside;
//   - a genome (NC_000023.11) is not fetched.
// Returns { targets, pending, choices, others, problems }.
export function targetsOf(record, options = {}) {
  const problems = [];
  let entries = record.targets.map((t) => ({ t, label: t.label ?? t.accession?.accession ?? t.name, kind: t.sequence ? 'sequence' : accessionKind(t.accession?.accession) }));
  // A transcript and its protein, named as two targets: one.
  if (entries.length === 2) {
    const transcript = entries.find((e) => e.kind === 'refseq' || e.kind === 'ensembl');
    const protein = entries.find((e) => e.kind === 'protein');
    if (transcript && protein && (transcript.t.name === protein.t.name || transcript.t.accession?.gene === protein.t.accession?.gene)) entries = [{ ...transcript, protein: protein.t.accession.accession }];
  }
  let choices = [];
  let others = [];
  if (entries.length > 1) {
    choices = entries.map((e) => ({ label: e.label, name: e.t.name, kind: e.kind }));
    const wanted = options.target ? entries.find((e) => e.label === options.target || e.t.name === options.target) : null;
    if (!wanted) {
      if (options.target) problems.push(`The score set has no target ${options.target}.`);
      return { targets: [], pending: [], choices, others, problems };
    }
    others = entries.filter((e) => e !== wanted).map((e) => e.label);
    entries = [wanted];
  }
  const targets = [];
  const pending = [];
  for (const { t, label, kind, protein } of entries) {
    const { identifiers, offset } = identifiersOf(t);
    if (kind === 'sequence') {
      const dna = t.sequenceType === 'dna';
      targets.push({
        id: slug(t.name), name: t.name, ...(label && label !== t.name ? { label } : {}),
        sequenceType: dna ? 'dna' : 'protein', sequence: t.sequence.toUpperCase(),
        ...(dna ? { codingStart: 1 } : {}), offset,
        ...(t.organism ? { organism: t.organism } : {}),
        ...(Object.keys(identifiers).length ? { identifiers } : {}),
      });
    } else if (kind === 'refseq' || kind === 'ensembl') {
      pending.push({ kind, accession: t.accession.accession, name: t.name, gene: t.accession.gene ?? null, assembly: t.accession.assembly ?? null, ...(protein ? { protein } : {}), identifiers, offset });
    } else {
      const accession = t.accession?.accession;
      problems.push(kind === 'genome'
        ? `${t.name === accession ? 'The target is' : `The target ${t.name} is named on`} the genome ${accession}${t.accession?.assembly ? ` (${t.accession.assembly})` : ''}: MaveScape fetches a target that is a transcript or reads one given as a sequence, and does not fetch a genome. The record, its license and calibrations can be read.`
        : `The target ${t.name} is named by ${accession ? `the accession ${accession}` : 'no sequence'}, which MaveScape cannot fetch a transcript from (a RefSeq transcript, NM_…, or an Ensembl one, ENST…, it can). The record, its license and calibrations can be read.`);
    }
  }
  return { targets, pending, choices, others, problems };
}

// A target fetched for a record (targetsOf's `pending`): from NCBI's GenBank record of a RefSeq
// transcript (its coding feature; the whole transcript, so its UTRs are on it) or Ensembl's
// sequence of a transcript (its coding part in capitals). Ensembl serves its current release only:
// a transcript of another version than the record names is used and said, and the variants'
// reference bases then show whether it differs where they are. answer: the GenBank text, or
// Ensembl's JSON. retrieval: the cache's record (retrieval.js). Returns { target, origin,
// messages } or { problem }.
export function accessionTarget(pending, answer, { retrieval } = {}) {
  const messages = [];
  const identifiers = { ...pending.identifiers, ...(pending.gene ? { gene: pending.gene } : {}) };
  let target;
  let origin;
  if (pending.kind === 'refseq') {
    const { records, problems } = parseGenBank(answer);
    if (!records.length) return { problem: `NCBI's record of ${pending.accession} could not be read: ${problems.join(' ')}` };
    const record = records[0];
    const coding = codingFeatures(record);
    const chosen = preferredFeature(coding);
    if (!chosen) return { problem: `NCBI's record of ${pending.accession} has no coding sequence (CDS) to number the variants by.` };
    const made = targetFromGenBank(record, chosen, { id: slug(pending.name), name: pending.name, retrieval });
    target = made.target;
    origin = { ...made.origin, service: 'NCBI', named: pending.accession };
    messages.push(...made.messages);
    if (record.version && record.version !== pending.accession && /\.\d+$/.test(pending.accession)) messages.push({ level: 'warning', message: `MaveDB names ${pending.accession}; NCBI sent ${record.version}.` });
    target.identifiers = { ...identifiers, ...target.identifiers, refseq: pending.accession };
    if (coding.length > 1) messages.push({ level: 'info', message: `The record has ${coding.length} coding features; the target is numbered by ${chosen.label} (${chosen.location}).` });
  } else {
    let json;
    try {
      json = typeof answer === 'string' ? JSON.parse(answer) : answer;
    } catch {
      return { problem: `Ensembl's answer for ${pending.accession} could not be read.` };
    }
    const seq = String(json?.seq ?? '');
    const first = seq.search(/[A-Z]/);
    if (!seq || first < 0) return { problem: `Ensembl's sequence of ${pending.accession} has no coding part (in capitals) to number the variants by.` };
    const served = `${json.id}${json.version ? `.${json.version}` : ''}`;
    target = { id: slug(pending.name), name: pending.name, sequenceType: 'dna', sequence: seq.toUpperCase(), codingStart: first + 1, offset: 0, organism: 'Homo sapiens', identifiers: { ...identifiers, ensembl: pending.accession } };
    if (!/^ENST/.test(json.id ?? '')) delete target.organism;
    const named = /\.(\d+)$/.exec(pending.accession)?.[1];
    origin = { format: 'Ensembl', service: 'Ensembl', accession: served, named: pending.accession, whole: true, ...(retrieval ? { retrieval } : {}) };
    if (named && json.version && Number(named) !== json.version) {
      origin.versionDiffers = true;
      messages.push({ level: 'warning', message: `MaveDB names ${pending.accession}; Ensembl's current release has ${served}, which MaveScape uses: each variant's reference base is checked against it.` });
    }
  }
  if (pending.protein) target.identifiers.protein = pending.protein;
  if (pending.offset) target.offset = pending.offset;
  return { target, origin, messages };
}

// A keyword's label in a list of MaveDB's terms (as listed), or null.
const termIn = (list, label) => list.find((x) => x.toLowerCase() === String(label ?? '').toLowerCase()) ?? null;

// The design's readout and library method from the experiment's controlled keywords. The direction
// (what a higher score means) is no keyword: it stays unstated until given, and the readiness
// names it. A keyword outside MaveScape's lists is kept as written.
export function readoutOf(record) {
  const keyword = (key) => record.keywords.find((k) => k.key === key)?.label ?? null;
  const readout = {};
  const unknown = [];
  for (const [field, key, list] of [['method', 'Phenotypic Assay Method', ASSAY_METHODS], ['mechanism', 'Phenotypic Assay Mechanism', ASSAY_MECHANISMS], ['modelSystem', 'Phenotypic Assay Model System', MODEL_SYSTEMS]]) {
    const label = keyword(key);
    if (!label) continue;
    readout[field] = termIn(list, label) ?? label;
    if (!termIn(list, label)) unknown.push(`${key}: ${label}`);
  }
  const library = keyword('In Vitro Construct Library Method System');
  const libraryMethod = library ? termIn(LIBRARY_METHODS, library) ?? library : null;
  const phenotype = keyword('Molecular Mechanism Assessed');
  if (phenotype) readout.phenotype = phenotype;
  return { readout, libraryMethod, unknown };
}

// The design's source: the record's URN, citation and license.
const sourceOf = (record) => ({ mavedb: record.urn, ...(record.citation ? { citation: record.citation } : {}), license: record.license.short });

// The common part of a record's designs.
function base(record, { layout, target }, model) {
  const { readout, libraryMethod } = readoutOf(record);
  return {
    format: 'mavescape-design', version: 1,
    name: record.title,
    ...(record.shortDescription ? { description: record.shortDescription } : {}),
    source: sourceOf(record),
    model,
    ...(Object.keys(readout).length ? { readout } : {}),
    variants: { column: layout.variantColumn, level: layout.level === 'nucleotide' ? 'nucleotide' : 'protein' },
    targets: target ? [target] : [],
    library: { level: 'variant', ...(libraryMethod ? { method: libraryMethod } : {}) },
  };
}

// The design of a record's published scores: read as published from the score column, with the
// standard errors and 95% intervals the table gives (importer.js, draftScoresDesign), and the
// record's source, readout and library method.
export function scoresDesign(record, { table, layout, target }) {
  const drafted = draftScoresDesign(table, { variantColumn: layout.variantColumn, level: layout.level, target, name: record.title, scoreColumns: layout.scoreColumns });
  const { scores, ignoredColumns, samples, replicates, controls } = drafted;
  return { ...base(record, { layout, target }, 'scores'), samples, replicates, scores, controls, ...(ignoredColumns ? { ignoredColumns } : {}) };
}

// The design of a record's counts, drafted from their column names as for any table (which sample
// each column is, its replicate, time point or bin): a draft to check, since MaveDB records no
// design. The record gives its source, readout and library method.
export function countsDesign(record, { table, layout, target }) {
  const columns = layout.countColumns ?? [];
  const roles = suggestRoles(columns).map((r) => (r.role ? r : { ...r, group: r.column }));
  const { design, notes } = draftDesign(table, roles, { variantColumn: layout.variantColumn, level: layout.level, target, name: record.title });
  const record_ = base(record, { layout, target }, design.model);
  const drafted = {
    ...design,
    name: record_.name,
    ...(record_.description ? { description: record_.description } : {}),
    source: record_.source,
    ...(record_.readout ? { readout: { ...(design.readout ?? {}), ...record_.readout } } : {}),
    library: { ...design.library, ...(record_.library.method ? { method: record_.library.method } : {}) },
    targets: target ? [target] : [],
  };
  return { design: setAsideOtherColumns(drafted, table.columns.map((c) => c.name), IDENTIFIER_COLUMNS), notes };
}

// MaveDB's mapped variants (GET /score-sets/{urn}/mapped-variants; wave 3, slice 3): for each
// variant MaveDB has mapped to the human reference (Arbesfeld et al. 2025), the current mapping's
// variant URN (the tables' accession column), its GA4GH VRS 2.0 allele identifier, the HGVS on the
// reference sequence (NP_002077.1:p.Thr159Ter), its ClinGen allele id and the level it was aligned
// at. Superseded mappings are left out. [{ urn, vrs, hgvs, clingen, level }]
export function mappedVariants(json) {
  const out = [];
  for (const m of Array.isArray(json) ? json : []) {
    if (!m?.current || !m.variantUrn || !m.postMapped) continue;
    const post = m.postMapped;
    const expression = (post.expressions ?? []).find((e) => /^hgvs/.test(e.syntax ?? ''))?.value ?? null;
    out.push({ urn: m.variantUrn, vrs: post.id ?? null, hgvs: expression, clingen: m.clingenAlleleId ?? null, level: m.alignmentLevel ?? null });
  }
  return out;
}

const csvField = (x) => (x === null || x === undefined ? 'NA' : /[",\r\n]/.test(String(x)) ? `"${String(x).replace(/"/g, '""')}"` : String(x));

// The mapped variants as the CSV MaveScape keeps beside a score set's tables (docs/FORMATS.md).
export function mappedCSV(rows) {
  return ['accession,vrs_id,hgvs,clingen_allele_id,alignment_level', ...rows.map((r) => [r.urn, r.vrs, r.hgvs, r.clingen, r.level].map(csvField).join(','))].join('\n') + '\n';
}

// That CSV read back: Map(variant URN → { vrs, hgvs, clingen, level }).
export function readMapped(table) {
  const col = (name) => table.columns.find((c) => c.name === name)?.values ?? [];
  const [urns, vrs, hgvs, clingen, level] = ['accession', 'vrs_id', 'hgvs', 'clingen_allele_id', 'alignment_level'].map(col);
  const na = (x) => (x === undefined || x === '' || x === 'NA' ? null : x);
  return new Map(urns.map((u, i) => [u, { vrs: na(vrs[i]), hgvs: na(hgvs[i]), clingen: na(clingen[i]), level: na(level[i]) }]));
}

// Search results (POST /score-sets/search): each score set's URN, title, description, targets,
// license, variants and date.
export function searchHits(json) {
  const sets = json?.scoreSets ?? [];
  return {
    total: json?.numScoreSets ?? sets.length,
    hits: sets.map((s) => ({
      urn: s.urn,
      title: s.title ?? s.urn,
      shortDescription: s.shortDescription ?? '',
      targets: (s.targetGenes ?? []).map((t) => t.name),
      organism: s.targetGenes?.[0]?.targetSequence?.taxonomy?.organismName ?? null,
      accessionTarget: (s.targetGenes ?? []).some((t) => !t.targetSequence && t.targetAccession),
      license: s.license?.shortName ?? null,
      variants: s.numVariants ?? null,
      published: s.publishedDate ?? null,
      publication: publicationOf(s.primaryPublicationIdentifiers?.[0])?.reference ?? null,
    })),
  };
}
