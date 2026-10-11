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
//   targetsOf(record) → { targets, problems }             MaveScape targets, or why not
//   licenseOf(license) → { short, long, link, terms, open }
//   readoutOf(record) → { readout, libraryMethod, unknown }
//   scoresDesign(record, { table, layout, target }) → design
//   countsDesign(record, { table, layout, target }) → { design, notes }
//   searchHits(json) → { total, hits }

import { IDENTIFIER_COLUMNS } from './design.js';
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
  };
}

const slug = (text) => String(text ?? 'target').replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'target';

// MaveScape targets from a record's: its sequence (DNA read in frame from its first base), its
// organism, and its UniProt, RefSeq and Ensembl identifiers, the UniProt offset as the target's
// offset (MaveScape numbers reference positions on the protein). A target named by an accession,
// with no sequence, and a score set of several targets are not yet read (their variants are named
// on a transcript or genome, or prefixed by the target: full MAVE-HGVS, wave 3 slice 3).
export function targetsOf(record) {
  const problems = [];
  if (record.targets.length > 1) problems.push(`The score set has ${record.targets.length} targets (${record.targets.map((t) => t.name).join(', ')}), its variants named with each target's label: MaveScape reads one target per score set for now.`);
  const targets = [];
  for (const t of record.targets) {
    if (!t.sequence) {
      problems.push(`The target ${t.name} is named by ${t.accession ? `the accession ${t.accession.accession}${t.accession.assembly ? ` (${t.accession.assembly})` : ''}` : 'no sequence'}, its variants on that ${/^(NC_|chr)/.test(t.accession?.accession ?? '') ? 'genome' : 'transcript'}: MaveScape reads variants named on an accession with full MAVE-HGVS (0.3, to come). The record, its license and calibrations can be read now.`);
      continue;
    }
    const identifiers = {};
    let offset = 0;
    for (const x of t.identifiers) {
      if (x.db === 'UniProt' && x.id) {
        identifiers.uniprot = x.id;
        offset = x.offset ?? 0;
      } else if (x.db === 'RefSeq' && x.id) identifiers.refseq = x.id;
      else if (x.db === 'Ensembl' && x.id) identifiers.ensembl = x.id;
    }
    const dna = t.sequenceType === 'dna';
    targets.push({
      id: slug(t.name), name: t.name, sequenceType: dna ? 'dna' : 'protein', sequence: t.sequence.toUpperCase(),
      ...(dna ? { codingStart: 1 } : {}), offset,
      ...(t.organism ? { organism: t.organism } : {}),
      ...(Object.keys(identifiers).length ? { identifiers } : {}),
    });
  }
  return { targets, problems };
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
