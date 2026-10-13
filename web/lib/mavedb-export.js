// MaveDB deposits (wave 3, slice 4; requirements I2, M2): a run written as MaveDB takes a score set.
// The scores and counts are the CSV files MaveDB's upload reads, beside the descriptions of their
// columns. The experiment and the score set are the JSON bodies of MaveDB's API, with the analysis
// described by the methods and the experiment's keywords taken from the design's readout (the MAVE
// minimum information). What MaveDB requires that the workspace does not hold is named, never
// guessed. Pure: the window (ui/mavedb-export.js), remote control and `mavescape export` write the
// same bytes, and a package reads back (readDeposit) as a MaveDB record does.
//
// What MaveDB takes, as its own validator checks it (the mavedb package 2026.2.7.4, AGPL-3.0, used
// only as an external reference: validation/reference/generate_mavedb_export.py):
//   - one row per variant, each name once, valid MAVE-HGVS on the target;
//   - a target given by its sequence counts from the sequence's first base: protein variants alone
//     (hgvs_pro), c. names beside their protein change (hgvs_nt and hgvs_pro), or nucleotide names
//     alone, written n.; so a DNA target is given from its coding start ("coding"), or whole when
//     its variants are named n. ("noncoding");
//   - a target named by a RefSeq or Ensembl transcript: its variants prefixed by the accession
//     (NM_007294.3:c.5565A>T), checked by biocommons hgvs against the transcript ("accession");
//   - no hgvs_pro with gaps: MaveDB's validator stops at the first missing protein name, so a c.
//     variant with no protein change (in a UTR or an intron) of a target given by its sequence is
//     left out, and said;
//   - no column without a value, and no column of numbers and text mixed; MaveDB reads a CSV with
//     ' as its quote character, so no value or column name holds a comma or a quote.
//
//   depositDetails(ws, run) → { details, defaulted, record }      what the deposit says, filled
//   mavedbDeposit({ ws, run, results, condition, methods, tables, software, calibrations })
//     → { files: [{ name, text }], report } | { problem }
//   depositCalibration(outcome, details, software) → { body, notes, missing }   (wave 8, slice 5)
//   depositZip(deposit, { date }) → Uint8Array
//   readDeposit(files) → { record, details, problems }             a package read back

import { parseHgvs } from './hgvs.js';
import { codingFrame } from './consequence.js';
import { STATUS, buildVariants } from './variants.js';
import { intervalOf, num, statusOf } from './exports.js';
import { flagNames } from './filters.js';
import { anchorUncertainty } from './anchors.js';
import { DESIGN_KEYWORDS, MAVEDB_KEYWORDS } from './readout.js';
import { accessionKind, licenseOf, readCalibration } from './mavedb.js';
import { replicateSamples, summarizeDesign } from './design.js';
import { createZip } from './zip.js';
import { sha256 } from './sha256.js';
import { possessive } from './words.js';
import { ruleWords, thresholdWords } from './calibration.js';
import { controlSetWords } from './controls.js';

export const DEPOSIT_FORMAT = 'mavescape-mavedb';
export const DEPOSIT_VERSION = 1;
const encoder = new TextEncoder();
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const exact = (n) => n.toLocaleString('en-US');
const plural = (n, word, many = `${word}s`) => `${exact(n)} ${n === 1 ? word : many}`;

// The files MaveDB reads, in the order of the package; README.md and mavescape.json are MaveScape's.
export const MAVEDB_FILES = ['scores.csv', 'counts.csv', 'score_columns.json', 'count_columns.json', 'experiment.json', 'score_set.json', 'score_calibrations.json'];

// The licenses MaveDB takes for a new score set, by its ids (api.mavedb.org/api/v1/licenses,
// retrieved 2026-10-10; CC BY-NC-SA 4.0 and "Other" are no longer offered).
export const MAVEDB_LICENSES = [
  { id: 1, short: 'CC0' },
  { id: 3, short: 'CC BY 4.0' },
  { id: 6, short: 'CC BY-SA 4.0' },
];
export const DEFAULT_LICENSE = 'CC0';

// Organisms' NCBI Taxonomy ids, for a target that names its organism but not its id.
const TAXONOMY = {
  'Homo sapiens': 9606, 'Mus musculus': 10090, 'Rattus norvegicus': 10116, 'Danio rerio': 7955,
  'Drosophila melanogaster': 7227, 'Caenorhabditis elegans': 6239, 'Saccharomyces cerevisiae': 4932,
  'Schizosaccharomyces pombe': 4896, 'Escherichia coli': 562, 'Arabidopsis thaliana': 3702,
  'Severe acute respiratory syndrome coronavirus 2': 2697049, 'Human immunodeficiency virus 1': 11676,
  'Influenza A virus': 11320, 'synthetic construct': 32630,
};

// The column names MaveDB reserves.
const STANDARD = new Set(['hgvs_nt', 'hgvs_splice', 'hgvs_pro', 'score', 'guide_sequence']);
const IDENTIFIERS = new Set(['accession', 'hgvs_nt', 'hgvs_splice', 'hgvs_pro']);
// What MaveDB's reader would not read back as written: a comma, a quote (it quotes with '), a line
// break; and the values it reads as missing.
const UNSAFE = /[,'"\r\n]/;
const MAVEDB_MISSING = /^(\s*|nan|na|none|undefined|n\/a|null|nil|-)$/i;

const cleanName = (name) => String(name).replace(/[,'"\r\n]+/g, '_').trim() || 'column';
const lowerFirst = (text) => (/^[A-Z][a-z]/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text);

// --- What the deposit says ------------------------------------------------------------------------

// The fields of ws.deposit (the MaveDB details the researcher states; FORMATS.md, "MaveDB details").
export const DEPOSIT_FIELDS = ['title', 'shortDescription', 'abstract', 'method', 'experiment', 'license', 'publications', 'dois', 'rawReads', 'contributors', 'experimentUrn', 'supersedes', 'taxonomyId', 'category', 'keywords', 'columns'];

// The details in words, for what was chosen and what is missing.
export const DETAIL_NAMES = {
  title: 'Title', shortDescription: 'Short description', abstract: 'Abstract', method: 'Method text', experiment: 'The experiment',
  license: 'License', publications: 'Publications', dois: 'Data DOIs', rawReads: 'Raw reads', contributors: 'Contributors',
  experimentUrn: 'Experiment on MaveDB', supersedes: 'Supersedes', taxonomyId: 'Organism (NCBI Taxonomy id)', category: 'Target category',
  keywords: 'Keywords', columns: 'Column descriptions',
};

// MaveDB's target categories.
export const TARGET_CATEGORIES = { protein_coding: 'protein-coding', regulatory: 'regulatory', other_noncoding: 'other non-coding' };

// The record a run's table came from (a MaveDB score set, or a MaveDB package opened from files):
// ws.records' entry for its source's origin, or null.
export function recordOfRun(ws, run) {
  const source = ws.sources.find((s) => s.sha256 === run.inputs.source.sha256);
  const origin = source?.origin;
  if (!origin) return null;
  return (ws.records ?? []).find((r) => (origin.urn && r.urn === origin.urn) || (origin.package && r.package === origin.package)) ?? null;
}

const published = (run) => run.inputs.design.model === 'scores';

// What the deposit says: ws.deposit's fields where given; else, for a run of published scores, its
// record's (title, descriptions, methods, license, publications, keywords, columns); else the
// design's, or what MaveScape writes. defaulted: [{ field, text }] the values chosen for the
// researcher, to confirm. record: the run's record, if it has one.
export function depositDetails(ws, run) {
  const given = ws.deposit ?? {};
  const design = run.inputs.design;
  const record = recordOfRun(ws, run);
  const fromRecord = published(run) && record;
  const defaulted = [];
  const pick = (field, ...candidates) => {
    if (given[field] !== undefined && given[field] !== null && given[field] !== '') return given[field];
    for (const [value, why] of candidates) {
      if (value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && !value.length)) {
        if (why) defaulted.push({ field, text: why });
        return value;
      }
    }
    return null;
  };
  const recordLicense = record?.license?.short && MAVEDB_LICENSES.some((l) => l.short === record.license.short) ? record.license.short : null;
  const experiment = record?.experiment ?? {};
  const details = {
    title: pick('title', [fromRecord ? record.title : null], [design.name ?? ws.name, `the design's name, "${design.name ?? ws.name}"`]),
    shortDescription: pick('shortDescription', [fromRecord ? record.shortDescription : null], [design.description, 'the design\'s description']),
    abstract: pick('abstract', [fromRecord ? record.abstract : null], [record?.abstract, record ? `the abstract of ${record.urn ?? record.package}` : null]),
    method: pick('method', [fromRecord ? record.method : null]),
    experiment: given.experiment ?? (record ? { title: experiment.title ?? null, shortDescription: experiment.shortDescription ?? null, abstract: experiment.abstract ?? null, method: experiment.method ?? null } : null),
    license: pick('license', [recordLicense, record ? `the license of ${record.urn ?? record.package}` : null], [MAVEDB_LICENSES.some((l) => l.short === design.source?.license) ? design.source.license : null, 'the data\'s license, as the design gives it'], [DEFAULT_LICENSE, 'CC0, MaveDB\'s default']),
    publications: pick('publications', [fromRecord ? record.publications ?? null : null]) ?? [],
    dois: pick('dois', [fromRecord ? record.dois ?? null : null]) ?? [],
    rawReads: pick('rawReads', [record ? experiment.rawReads?.map((r) => r.id ?? r) ?? null : null]) ?? [],
    contributors: pick('contributors', [fromRecord ? record.contributors ?? null : null]) ?? [],
    experimentUrn: given.experimentUrn ?? null,
    supersedes: given.supersedes ?? null,
    taxonomyId: given.taxonomyId ?? null,
    category: given.category ?? null,
    keywords: given.keywords ?? (record ? (record.keywords ?? []).filter((k) => !DESIGN_KEYWORDS[k.key]) : []),
    columns: given.columns ?? (fromRecord ? record.columns ?? null : null),
  };
  return { details, defaulted, record };
}

// The forms MaveDB takes: its URNs (lib/validation/urn_re.py), ORCID iDs, and publication
// identifiers (PubMed ids, DOIs for Crossref, bioRxiv and medRxiv ids).
const EXPERIMENT_URN = /^urn:mavedb:\d{8}-([a-z]+|0)$/;
const SCORE_SET_URN = /^urn:mavedb:\d{8}-([a-z]+|0)-[1-9]\d*$/;
const ORCID = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/;
const PUBLICATION = {
  PubMed: /^[1-9]\d{0,8}$/,
  Crossref: /^10\.\d{4,9}\/\S+$/,
  bioRxiv: /^(\d{6}|\d{4}\.\d{2}\.\d{2}\.\d{6})$/,
  medRxiv: /^(\d{8}|\d{4}\.\d{2}\.\d{2}\.\d{8})$/,
};

// A publication as written ("PubMed 29785012", "doi:10.1038/…", a bare id): { db, id }.
export function readPublication(text) {
  const m = /^(pubmed|pmid|biorxiv|medrxiv|crossref|doi)\s*:?\s*(.+)$/i.exec(String(text).trim());
  const id = (m ? m[2] : String(text)).trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
  const named = m ? { pubmed: 'PubMed', pmid: 'PubMed', biorxiv: 'bioRxiv', medrxiv: 'medRxiv', crossref: 'Crossref', doi: 'Crossref' }[m[1].toLowerCase()] : null;
  const db = named ?? Object.keys(PUBLICATION).find((k) => PUBLICATION[k].test(id)) ?? null;
  return { db, id };
}

// What MaveDB would refuse among the details stated: [{ field, text }].
export function detailProblems(details) {
  const out = [];
  if (details.experimentUrn && !EXPERIMENT_URN.test(details.experimentUrn)) out.push({ field: 'experimentUrn', text: `"${details.experimentUrn}" is not an experiment's URN (urn:mavedb:00000835-a).` });
  if (details.supersedes && !SCORE_SET_URN.test(details.supersedes)) out.push({ field: 'supersedes', text: `"${details.supersedes}" is not a score set's URN (urn:mavedb:00000835-a-1).` });
  for (const id of details.contributors ?? []) if (!ORCID.test(id)) out.push({ field: 'contributors', text: `"${id}" is not an ORCID iD (0000-0002-1825-0097).` });
  for (const p of details.publications ?? []) if (!PUBLICATION[p.db]?.test(p.id)) out.push({ field: 'publications', text: `"${p.id}" is not ${p.db ? `a ${p.db} identifier` : 'a PubMed id, DOI, bioRxiv or medRxiv id'}.` });
  for (const d of details.dois ?? []) if (!PUBLICATION.Crossref.test(d)) out.push({ field: 'dois', text: `"${d}" is not a DOI.` });
  if (details.taxonomyId !== null && details.taxonomyId !== undefined && !(Number.isInteger(details.taxonomyId) && details.taxonomyId > 0)) out.push({ field: 'taxonomyId', text: 'The NCBI Taxonomy id is a positive whole number (9606 for Homo sapiens).' });
  if (details.category && !TARGET_CATEGORIES[details.category]) out.push({ field: 'category', text: `MaveDB's target categories are ${Object.keys(TARGET_CATEGORIES).join(', ')}.` });
  if (details.license && !MAVEDB_LICENSES.some((l) => l.short === details.license)) out.push({ field: 'license', text: `MaveDB takes ${MAVEDB_LICENSES.map((l) => l.short).join(', ')}.` });
  return out;
}

// --- The target, and how its variants are named ---------------------------------------------------

// The nucleotide prefix most of a table's valid names use (c., n., g., …), or null.
function mainPrefix(v) {
  const counts = new Map();
  for (let i = 0; i < v.key.length; i += 1) {
    // The wild type (c.=) takes the column's prefix: it does not choose it.
    if (v.status[i] === STATUS.INVALID || !v.key[i] || /\.=$/.test(v.key[i])) continue;
    const prefix = /(?:^|:)([cngmo])\./.exec(v.key[i])?.[1];
    if (prefix) counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || (a[0] === 'c' ? -1 : 1))[0]?.[0] ?? null;
}

// The target as MaveDB takes it, and how the run's variants are named for it: { mode, prefix,
// accession, frame, gene (MaveDB's TargetGeneCreate), notes, missing, defaulted } or { problem }.
// mode: protein (protein names on a protein, or a DNA target's coding sequence), coding (c. names
// beside their protein change, on the coding sequence), noncoding (n. names on the whole sequence),
// accession (names prefixed by the transcript's accession).
function depositTarget(ws, design, details, variants) {
  const level = design.variants.level;
  if (level === 'splice') return { problem: 'MaveDB takes splice variants (hgvs_splice) only beside genomic names, which MaveScape does not write: export the scores as MaveScape\'s tables instead.' };
  if ((design.targets?.length ?? 0) !== 1) return { problem: design.targets?.length ? `The design has ${design.targets.length} targets; a MaveDB deposit is written for a design of one target (open one target at a time).` : 'The design has no target: MaveDB needs the sequence or transcript the variants are named on.' };
  const target = design.targets[0];
  const origin = (ws.targets ?? []).find((t) => t.id === target.id && t.sequence === target.sequence)?.origin ?? null;
  const notes = [];
  const missing = [];
  const defaulted = [];
  const identifiers = target.identifiers ?? {};
  const externalIdentifiers = identifiers.uniprot ? [{ identifier: { dbName: 'UniProt', identifier: identifiers.uniprot }, offset: target.offset ?? 0 }] : [];
  const frame = target.sequenceType === 'dna' ? codingFrame(target) : null;
  // MaveDB's category: the details', else protein-coding (a DNA target named n. may as well be a
  // regulatory element, which its sequence does not say).
  const category = details.category ?? 'protein_coding';
  const base = { name: target.name, category, externalIdentifiers };
  const prefix = level === 'protein' ? 'p' : mainPrefix(variants);
  // A transcript named by its accession: as MaveDB names it.
  const accession = origin?.accession ?? null;
  if (level !== 'protein' && accession && ['refseq', 'ensembl'].includes(accessionKind(accession)) && target.sequenceType === 'dna') {
    const gene = identifiers.gene ?? null;
    if (!gene) notes.push(`MaveDB names a transcript's gene: the target's name, ${target.name}, is given as its gene.`);
    return {
      mode: 'accession', prefix, accession, frame, notes, missing, defaulted,
      gene: { ...base, targetAccession: { accession, assembly: null, gene: gene ?? target.name, isBaseEditor: false } },
    };
  }
  // A sequence: from the coding start when its variants are protein or c. names.
  const taxonomy = details.taxonomyId ?? target.taxonomyId ?? TAXONOMY[target.organism] ?? null;
  if (!taxonomy) missing.push({ field: 'taxonomyId', text: `The target's organism, as its NCBI Taxonomy id${target.organism ? ` (${target.organism})` : ''}: MaveDB keeps one with every target sequence.` });
  const label = target.label && !/:/.test(target.label) ? { label: target.label } : {};
  const sequenceOf = (sequence, sequenceType) => ({ ...base, targetSequence: { sequence, sequenceType, taxonomy: { code: taxonomy ?? 0 }, ...label } });
  if (target.sequenceType === 'protein') {
    if (level !== 'protein') return { problem: 'Nucleotide variants need a DNA target.' };
    return { mode: 'protein', prefix, frame: null, notes, missing, defaulted, gene: sequenceOf(target.sequence.toUpperCase(), 'protein') };
  }
  if (level === 'protein' || prefix === 'c') {
    if (!frame?.protein.length) return { problem: 'The DNA target has no reading frame to name protein variants on.' };
    const sequence = frame.sequence.slice(frame.start, frame.end);
    if (frame.start > 0 || frame.end < frame.sequence.length) notes.push(`MaveDB numbers a target's sequence from its first base, so the target is given from its coding start to its ${frame.stop ? 'stop codon' : 'last whole codon'} (bases ${exact(frame.start + 1)}–${exact(frame.end)} of ${exact(frame.sequence.length)}).`);
    if (accession) notes.push(`The target is given by its sequence, ${accession}'s coding sequence${level === 'protein' ? ', as its variants are protein variants' : ''}.`);
    return { mode: level === 'protein' ? 'protein' : 'coding', prefix, frame, notes, missing, defaulted, gene: sequenceOf(sequence, 'dna') };
  }
  if (!details.category) defaulted.push({ field: 'category', text: 'protein-coding: say regulatory or other non-coding if the target is not a gene\'s coding sequence' });
  if (prefix && prefix !== 'n') notes.push(`MaveDB writes nucleotide variants without protein names with n.: the ${prefix}. names, which count from the target's first base as n. does, are written n.`);
  return { mode: 'noncoding', prefix, frame, notes, missing, defaulted, gene: sequenceOf(target.sequence.toUpperCase(), 'dna') };
}

// The names of a variant for MaveDB: { nt, pro } or { left: reason }.
function exportedName(v, i, plan) {
  if (v.otherTarget?.[i]) return { left: 'named on another of the score set\'s targets' };
  if (v.status[i] === STATUS.INVALID || !v.key[i]) return { left: 'not a valid name on the target' };
  const parsed = parseHgvs(v.key[i], { mode: 'strict' });
  if (!parsed.ok) return { left: `not strict MAVE-HGVS (${parsed.error})` };
  const bare = parsed.target ? v.key[i].slice(parsed.target.length + 1) : v.key[i];
  if (plan.mode === 'protein') return { nt: null, pro: bare };
  // The wild type (_wt, c.=): written with the column's prefix.
  if (parsed.identical && !parsed.multi && /^[cngmo]\.=$/.test(bare)) {
    const wt = `${plan.mode === 'noncoding' ? 'n' : plan.prefix}.=`;
    if (plan.mode === 'accession') return { nt: `${plan.accession}:${wt}`, pro: null };
    return { nt: wt, pro: plan.mode === 'coding' ? 'p.=' : null };
  }
  if (parsed.prefix !== plan.prefix) return { left: `a ${parsed.prefix}. name among ${plan.prefix}. names: MaveDB takes one prefix per column` };
  if (plan.mode === 'accession') return { nt: `${plan.accession}:${bare}`, pro: null };
  if (plan.mode === 'coding') {
    const pro = v.proKey?.[i];
    if (!pro) return { left: 'no protein change (in a UTR, an intron or across the coding sequence\'s ends): MaveDB takes c. names only beside a protein name, and its validator stops at a missing one' };
    return { nt: bare, pro };
  }
  // noncoding: n. names; g., m. and o. count from the first base as n. does on a target sequence.
  return { nt: bare.replace(/^[gmo]\./, 'n.'), pro: null };
}

// --- The tables ------------------------------------------------------------------------------------

// A MaveDB CSV: comma-separated, unquoted (no value holds a comma or a quote), NA where missing.
function mavedbCSV(header, rows) {
  return `${[header, ...rows].map((r) => r.join(',')).join('\n')}\n`;
}

// Columns of values, each kept unless MaveDB would refuse it: { name, values, description?, details? }.
// A column with no value is left out (MaveDB refuses it), and so is one of text holding a comma or
// a quote, or of numbers and text mixed. Returns { columns, notes }.
function keepColumns(columns, notes) {
  const kept = [];
  const used = new Set([...STANDARD]);
  for (const c of columns) {
    const present = c.values.filter((x) => x !== 'NA');
    if (!present.length) continue;
    if (c.text) {
      if (present.some((x) => UNSAFE.test(x))) {
        notes.push(`The column "${c.name}" holds text with commas or quotes, which MaveDB's reader (its quote character is ') would not read back as written: left out.`);
        continue;
      }
      const numeric = present.filter((x) => Number.isFinite(Number(x)) && x.trim() !== '');
      if (numeric.length && numeric.length < present.length) {
        notes.push(`The column "${c.name}" mixes numbers and text, which MaveDB refuses: left out.`);
        continue;
      }
    }
    let name = cleanName(c.name);
    for (let n = 2; used.has(name.toLowerCase()); n += 1) name = `${cleanName(c.name)}_${n}`;
    used.add(name.toLowerCase());
    kept.push({ ...c, name });
  }
  return kept;
}

// A cell of a table passed through: its text, NA where missing (as MaveDB reads it).
const passCell = (column, row) => {
  if (column.numeric) return num(column.numeric[row]);
  const text = column.values[row] ?? '';
  return MAVEDB_MISSING.test(text) ? 'NA' : text;
};

// The score columns of a run scored from counts: the score, its SE and 95% interval, the scale's
// uncertainty, the replicates combined and their scores, heterogeneity, and the status.
function scoredColumns(results, run, condition, rows) {
  const c = results.conditions[condition];
  const design = run.inputs.design;
  const reps = results.replicates.filter((r) => c.replicates.includes(r.id));
  const scale = anchorUncertainty(results, design, condition);
  const at = (f) => rows.map((i) => f(i));
  const scored = (i) => !c.reason[i];
  const interval = rows.map((i) => (scored(i) ? intervalOf(c, i) : [Number.NaN, Number.NaN]));
  const t = Boolean(c.df);
  const repName = (r) => {
    const name = design.replicates.find((x) => x.id === r.id)?.name ?? r.id;
    return /replicate/i.test(name) ? name : `replicate ${name}`;
  };
  const columns = [
    { name: 'SE', values: at((i) => num(scored(i) ? c.se[i] : Number.NaN)), description: 'Standard error of the score', details: 'From the combination of the replicates\' scores, as the methods describe.' },
    { name: 'ci95_lower', values: interval.map((x) => num(x[0])), description: 'Lower bound of the score\'s 95% interval', details: t ? 'The score minus the t quantile at the variant\'s degrees of freedom times its SE.' : 'The score minus 1.96 SE.' },
    { name: 'ci95_upper', values: interval.map((x) => num(x[1])), description: 'Upper bound of the score\'s 95% interval', details: t ? 'The score plus the t quantile at the variant\'s degrees of freedom times its SE.' : 'The score plus 1.96 SE.' },
    { name: 'SE_scale', values: at((i) => num(scored(i) && scale ? scale.at(c.score[i]) : Number.NaN)), description: 'Uncertainty of the rescaling', details: 'The rescaling anchors\' own uncertainty, which moves every score together; apart from SE.' },
    { name: 'replicates', values: at((i) => (scored(i) ? String(c.k[i]) : 'NA')), description: 'Replicates combined', details: `The number of replicates whose scores were combined (of ${reps.length}).` },
    { name: 'tau2', values: at((i) => num(c.tau2[i])), description: 'Between-replicate variance (τ²)', details: 'The variance of the variant\'s replicate scores beyond their SEs.' },
    { name: 'I2', values: at((i) => num(c.i2[i])), description: 'Heterogeneity (I²)', details: 'The share of the variation between replicates beyond their SEs (Higgins and Thompson).' },
    ...reps.flatMap((r) => [
      { name: `score_${r.id}`, values: at((i) => num(r.score[i])), description: `Score in ${repName(r)}`, details: null },
      { name: `SE_${r.id}`, values: at((i) => num(r.se[i])), description: `Standard error in ${repName(r)}`, details: null },
    ]),
    { name: 'status', text: true, values: at((i) => statusOf(c, i)), description: 'Whether the variant was scored', details: 'scored; low confidence (see flags); filtered, with the filter that removed it; or not measured. A variant not scored has no score (NA).' },
    { name: 'flags', text: true, values: at((i) => (c.flags[i] ? flagNames(c.flags[i]).join('; ') : 'NA')), description: 'Why a score has low confidence', details: null },
  ];
  return columns;
}

// The counts a condition of a run scored, one column per sample of its replicates (technical
// replicates summed; a table of barcodes' summed per variant).
function scoredCounts(results, run, condition, rows) {
  const design = run.inputs.design;
  const replicates = new Set(results.conditions[condition].replicates);
  const used = new Set((design.replicates ?? []).filter((r) => replicates.has(r.id)).flatMap((r) => replicateSamples(r).map((x) => x.sample)));
  const words = { input: 'input', output: 'selected' };
  // Where a sample is used: "input of Replicate 1 and Replicate 2", "time 4 generations of …".
  const roleOf = (id) => {
    const uses = [];
    for (const r of design.replicates ?? []) {
      if (!replicates.has(r.id)) continue;
      for (const part of replicateSamples(r)) {
        if (part.sample !== id) continue;
        const role = part.role === 'timepoint' ? `time ${part.time}${design.time?.unit ? ` ${design.time.unit}` : ''}` : part.role === 'bin' ? `bin ${part.order}` : words[part.role];
        uses.push({ role, replicate: r.name ?? r.id });
      }
    }
    if (!uses.length) return null;
    const roles = [...new Set(uses.map((u) => u.role))];
    return `${roles.join(', ')} of ${uses.map((u) => u.replicate).filter((x, k, all) => all.indexOf(x) === k).join(' and ')}`;
  };
  return (results.samples ?? []).filter((s) => used.has(s.id)).map((s) => {
    const role = roleOf(s.id);
    return {
      name: s.id,
      values: rows.map((i) => num(s.counts[i])),
      description: `Reads of the variant in ${s.name ?? s.id}${role ? `, ${role}` : ''}`,
      details: s.columns?.length > 1 ? `The sum of the columns ${s.columns.join(', ')} of the table imported (technical replicates).` : s.columns?.length ? `The column ${s.columns[0]} of the table imported.` : null,
    };
  });
}

// --- The JSON bodies --------------------------------------------------------------------------------

// A term as MaveDB's keyword: its label as MaveDB writes it, else "Other" with the term described.
function keywordOf(key, term) {
  const labels = MAVEDB_KEYWORDS[key];
  const label = labels.find((l) => l.toLowerCase() === String(term).toLowerCase());
  if (label) return { keyword: { key, label } };
  if (!labels.includes('Other')) return null;
  return { keyword: { key, label: 'Other' }, description: String(term) };
}

// The experiment's keywords: the design's (readout, library method), then the deposit's for the
// other keys, in MaveDB's order of keys. notes: what could not be written.
export function depositKeywords(design, extra = [], notes = []) {
  const byKey = new Map();
  for (const [key, [part, field]] of Object.entries(DESIGN_KEYWORDS)) {
    const term = design[part]?.[field];
    if (!term) continue;
    const k = keywordOf(key, term);
    if (k) byKey.set(key, k);
    else notes.push(`"${term}" is not one of MaveDB's terms for "${key}", which has no "Other": choose it on MaveDB.`);
  }
  for (const k of extra) {
    if (!MAVEDB_KEYWORDS[k.key] || byKey.has(k.key) || !k.label) continue;
    const made = /^other$/i.test(k.label) ? { keyword: { key: k.key, label: 'Other' }, description: k.description ?? '' } : keywordOf(k.key, k.label);
    if (made) byKey.set(k.key, k.description && made.keyword.label !== 'Other' ? { ...made, description: k.description } : made);
  }
  return Object.keys(MAVEDB_KEYWORDS).filter((key) => byKey.has(key)).map((key) => byKey.get(key));
}

// MaveDB's rules for the keywords together (its validate_keyword_list): what a choice requires.
export function keywordProblems(keywords) {
  const has = (key) => keywords.some((k) => k.keyword.key === key);
  const label = (key) => keywords.find((k) => k.keyword.key === key)?.keyword.label?.toLowerCase() ?? '';
  const problems = [];
  const method = label('Variant Library Creation Method');
  const pairs = {
    'endogenous locus library method': ['Endogenous Locus Library Method System', 'Endogenous Locus Library Method Mechanism'],
    'in vitro construct library method': ['In Vitro Construct Library Method System', 'In Vitro Construct Library Method Mechanism'],
  };
  if (pairs[method]) for (const key of pairs[method]) if (!has(key)) problems.push(`"Variant Library Creation Method" is "${keywords.find((k) => k.keyword.key === 'Variant Library Creation Method').keyword.label}", so MaveDB needs "${key}" too.`);
  if (method === 'other') for (const key of Object.values(pairs).flat()) if (has(key)) problems.push(`"Variant Library Creation Method" is "Other", so MaveDB takes no "${key}".`);
  for (const k of keywords) if (k.keyword.label === 'Other' && !k.description?.trim()) problems.push(`"${k.keyword.key}" is "Other" without a description.`);
  return problems;
}

const publicationsOf = (list) => list.map((p) => ({ identifier: String(p.id ?? p.identifier), dbName: p.db ?? p.dbName ?? null }));

// The methods as MaveDB's method text (Markdown): the paragraphs and their references.
function methodsText(methods) {
  if (!methods) return null;
  return `${methods.paragraphs.join('\n\n')}\n\n**References**\n\n${methods.references.map((r) => `${r.n}. ${r.text}`).join('\n')}`;
}

// --- Calibrations (wave 8, slice 5) -----------------------------------------------------------------

// Brnich et al.'s recommendations (the OddsPath and its Table 3), as MaveDB names a publication.
const BRNICH = { identifier: '10.1186/s13073-019-0690-2', dbName: 'Crossref' };
// MaveScape's evidence strengths (lib/oddspath.js) as MaveDB's ACMG classification.
const ACMG = {
  PS3_very_strong: ['PS3', 'VERY_STRONG'], PS3: ['PS3', 'STRONG'], PS3_moderate: ['PS3', 'MODERATE'], PS3_supporting: ['PS3', 'SUPPORTING'],
  BS3: ['BS3', 'STRONG'], BS3_moderate: ['BS3', 'MODERATE'], BS3_supporting: ['BS3', 'SUPPORTING'],
};

// The strength MaveDB reads an OddsPath as (its own Table 3, which its validator holds a class's
// stated strength to): as Brnich et al.'s but PS3 strong beyond 18.6, where the paper prints 18.7.
// [criterion, strength], or null for indeterminate.
export function mavedbOddsPathStrength(x) {
  if (x > 350) return ['PS3', 'VERY_STRONG'];
  if (x > 18.6) return ['PS3', 'STRONG'];
  if (x > 4.3) return ['PS3', 'MODERATE'];
  if (x > 2.1) return ['PS3', 'SUPPORTING'];
  if (x >= 0.48) return null;
  if (x >= 0.23) return ['BS3', 'SUPPORTING'];
  if (x >= 0.053) return ['BS3', 'MODERATE'];
  return ['BS3', 'STRONG'];
}

// The ranges of a calibration's classes in MaveDB's terms: [{ class ('abnormal-like' |
// 'intermediate' | 'WT-like'), range: [lower, upper] (null unbounded), inclusive: [lower, upper] }],
// a score at a threshold on its abnormal-like side (lib/calibration.js's classOf), empty classes
// left out.
export function calibrationRanges(side, thresholds) {
  const { abnormal: a, normal: n } = thresholds;
  const out = [];
  if (side === 'below') {
    if (a !== null) out.push({ class: 'abnormal-like', range: [null, a], inclusive: [false, true] });
    if (a === null || n === null || a !== n) out.push({ class: 'intermediate', range: [a, n], inclusive: [false, n !== null] });
    if (n !== null) out.push({ class: 'WT-like', range: [n, null], inclusive: [false, false] });
  } else {
    if (n !== null) out.push({ class: 'WT-like', range: [null, n], inclusive: [false, false] });
    if (a === null || n === null || a !== n) out.push({ class: 'intermediate', range: [n, a], inclusive: [n !== null, false] });
    if (a !== null) out.push({ class: 'abnormal-like', range: [a, null], inclusive: [true, false] });
  }
  // Both thresholds absent: no class at all.
  return out.filter((r) => r.range[0] !== null || r.range[1] !== null);
}

const FUNCTIONAL = { 'abnormal-like': 'abnormal', intermediate: 'not_specified', 'WT-like': 'normal' };
const LABELS = { 'abnormal-like': 'Abnormal-like', intermediate: 'Intermediate', 'WT-like': 'WT-like' };

// A calibration (lib/calibration-record.js's calibrationOutcome) as the body of MaveDB's POST
// /api/v1/score-calibrations/ (ScoreCalibrationCreate), in MaveDB's vocabulary: its classes' ranges
// abnormal, not specified (the intermediate zone) and normal, each class's OddsPath and the strength
// Table 3 makes of it (where MaveDB reads the OddsPath the same), research use only; how it was made
// in its notes and metadata. details: the MaveDB details (the threshold source is the study's
// primary publication). Returns { body, notes, missing }.
export function depositCalibration(o, details, software = {}) {
  const { cal, set, run, metrics: m } = o;
  const notes = [];
  const missing = [];
  const fmt = (x) => Number(x.toPrecision(3)).toString();
  const classes = calibrationRanges(cal.side, cal.thresholds).map((r) => {
    const x = r.class === 'abnormal-like' ? m.evidence.abnormal : r.class === 'WT-like' ? m.evidence.normal : null;
    const k = { label: LABELS[r.class], description: null, functionalClassification: FUNCTIONAL[r.class], range: r.range, inclusiveLowerBound: r.inclusive[0], inclusiveUpperBound: r.inclusive[1] };
    const bounds = `${r.range[0] === null ? '' : `${r.inclusive[0] ? 'at or above' : 'above'} ${fmt(r.range[0])}`}${r.range[0] !== null && r.range[1] !== null ? ' and ' : ''}${r.range[1] === null ? '' : `${r.inclusive[1] ? 'at or below' : 'below'} ${fmt(r.range[1])}`}`;
    k.description = `Scores ${bounds}: ${r.class} in this assay, by MaveScape's calibration against ${m.classes.P[r.class]} P and ${m.classes.B[r.class]} B controls of "${set.name}" (for research).`;
    if (x && x.oddsPath !== null) {
      k.oddspathsRatio = x.oddsPath;
      const acmg = x.strength && ACMG[x.strength.code];
      if (acmg) {
        const theirs = mavedbOddsPathStrength(x.oddsPath);
        if (theirs && theirs[0] === acmg[0] && theirs[1] === acmg[1]) k.acmgClassification = { criterion: acmg[0], evidenceStrength: acmg[1] };
        else notes.push(`"${cal.name}": the ${r.class} class's OddsPath, ${fmt(x.oddsPath)}, is ${x.strength.code} by Brnich et al.'s Table 3 as printed; MaveDB reads it as ${theirs ? theirs.join(' ') : 'indeterminate'} (strong beyond 18.6, not 18.7), so its strength is left for MaveDB's reading of the ratio.`);
      }
    }
    return k;
  });
  const primary = details.publications?.[0] ?? null;
  if (!primary) missing.push({ field: 'calibrations', text: `A threshold source for the calibration "${cal.name}": MaveDB asks for the publication that reports its thresholds (the study's own, the first of the publications in the MaveDB details).` });
  const hasAcmg = classes.some((k) => k.acmgClassification);
  const evidence = (x) => ({ P: x.P, B: x.B, oddsPath: x.oddsPath, observed: x.observed, strength: x.strength?.code ?? null });
  const lr = o.likelihood && !o.likelihood.problem ? o.likelihood : null;
  const body = {
    scoreSetUrn: null,
    title: cal.name,
    researchUseOnly: true,
    notes: `Made with MaveScape${software.version ? ` ${software.version}` : ''} against the control set ${controlSetWords(set)}, of which ${m.n.P} P and ${m.n.B} B are scored here (${run.name}${o.scored?.condition ? `, ${o.scored.condition}` : ''}). Abnormal-like scores are ${cal.side} the others; thresholds ${cal.rule === 'given' ? 'given' : `set by the controls, ${ruleWords(cal.rule, cal.error)}`}: ${thresholdWords(cal.side, cal.thresholds)}. AUC ${fmt(m.auc.auc)} (DeLong's 95% interval ${fmt(m.auc.low)} to ${fmt(m.auc.high)}). Each class's OddsPath as Brnich et al. (Genome Medicine 2020) define it, one control of the other side added, and its strength by their Table 3. ${o.limitations.length ? `Limitations: ${o.limitations.map((l) => l.text).join(' ')} ` : ''}For research: functional classes in this assay and the evidence strength they would give, not a classification of any variant.`,
    functionalClassifications: classes,
    thresholdSources: primary ? publicationsOf([primary]) : [],
    evidenceSources: hasAcmg ? [BRNICH] : [],
    methodSources: [BRNICH],
    calibrationMetadata: {
      software: { name: 'MaveScape', version: software.version ?? null },
      controls: { name: set.name, source: set.source?.kind === 'clinvar' ? { database: 'ClinVar', transcript: set.source.transcript ?? null, sha256: set.source.file?.sha256 ?? null, retrieved: set.source.retrieved ?? null, minStars: set.rules?.minStars ?? null, kinds: set.rules?.kinds ?? null } : { file: set.source?.file?.fileName ?? null, sha256: set.source?.file?.sha256 ?? null, citation: set.source?.citation ?? null }, scored: m.n },
      side: cal.side,
      rule: cal.rule,
      ...(cal.rule === 'error' ? { error: cal.error } : {}),
      thresholds: cal.thresholds,
      auc: { auc: m.auc.auc, low: m.auc.low, high: m.auc.high, method: 'DeLong' },
      sensitivity: { p: m.sensitivity.p, low: m.sensitivity.low, high: m.sensitivity.high },
      specificity: { p: m.specificity.p, low: m.specificity.low, high: m.specificity.high },
      bootstrap: cal.bootstrap,
      oddsPath: { method: 'Brnich et al. 2020, one misclassified control added', abnormal: evidence(m.evidence.abnormal), normal: evidence(m.evidence.normal) },
      ...(lr ? { likelihoodRatios: { method: 'acmgscaler 1.0.0 (Badonyi 2025), ported', prior: lr.settings.prior, c: lr.settings.c, seed: cal.bootstrap.seed, thresholds: lr.result.thresholds.map((t) => ({ boundary: t.boundary, ratio: t.lr, score: t.score, lower: t.lower, upper: t.upper })) } } : {}),
      limitations: o.limitations.map((l) => l.id),
    },
  };
  return { body, notes, missing };
}

// What the design says of the experiment, for its method text when the researcher gives none.
function experimentText(design) {
  return summarizeDesign(design).lines.join(' ');
}

// --- The deposit ----------------------------------------------------------------------------------

// The deposit of one condition of a run. methods: writeMethods' result for a run scored from
// counts (its paragraphs are the score set's method text). tables: for published scores, the
// tables to pass through: { scores, counts } (parsed tables; counts null when the record has none
// in the workspace). calibrations: the run's calibrations computed again (lib/calibration-record.js's
// calibrationOutcome), written as MaveDB's score calibrations of this condition (wave 8, slice 5).
// Returns { files: [{ name, text }], report } or { problem }.
export function mavedbDeposit({ ws, run, results, condition = 0, methods = null, tables = {}, software = {}, calibrations = [] }) {
  const design = run.inputs.design;
  const { details, defaulted, record } = depositDetails(ws, run);
  const plan = depositTarget(ws, design, details, results.variants);
  if (plan.problem) return { problem: plan.problem };
  const notes = [...plan.notes];
  const missing = [...plan.missing];
  defaulted.push(...plan.defaulted);
  const c = results.conditions[condition];
  if (!c) return { problem: `${run.name} has ${results.conditions.length} condition${results.conditions.length === 1 ? '' : 's'}.` };
  const isPublished = published(run);

  // The variants: those with a name MaveDB takes, in the table's order.
  const v = results.variants;
  const rows = [];
  const names = [];
  const left = new Map();
  for (let i = 0; i < results.rows; i += 1) {
    const name = exportedName(v, i, plan);
    if (name.left) {
      if (!left.has(name.left)) left.set(name.left, []);
      left.get(name.left).push(v.original[i]);
      continue;
    }
    rows.push(i);
    names.push(name);
  }
  if (!rows.length) return { problem: `None of ${possessive(run.name)} variants can be named as MaveDB takes them${left.size ? `: ${[...left.keys()].join('; ')}` : ''}.` };
  const hasPro = names.some((x) => x.pro);
  const hasNt = names.some((x) => x.nt);
  const ids = (i) => [...(hasNt ? [names[i].nt] : []), ...(hasPro ? [names[i].pro ?? 'NA'] : [])];
  const idHeader = [...(hasNt ? ['hgvs_nt'] : []), ...(hasPro ? ['hgvs_pro'] : [])];

  // The scores: computed from counts, or passed through as published (renamed "score").
  let scoreColumns;
  let scoreValues;
  const columnNotes = [];
  if (isPublished) {
    const table = tables.scores;
    if (!table) return { problem: `The table of ${possessive(run.name)} published scores is not open: open it again to write its deposit.` };
    if (table.rows !== results.rows) return { problem: `The table of ${possessive(run.name)} published scores has ${table.rows} rows, not the run's ${results.rows}.` };
    const scoreName = design.scores?.score ?? 'score';
    const scoreColumn = table.columns.find((x) => x.name === scoreName);
    scoreValues = rows.map((i) => passCell(scoreColumn, i));
    if (scoreName !== 'score') notes.push(`The column "${scoreName}" is MaveDB's score.`);
    const given = details.columns?.scores ?? {};
    scoreColumns = keepColumns(table.columns.filter((x) => x.name !== scoreName && x.name !== design.variants.column && !IDENTIFIERS.has(x.name)).map((x) => ({
      name: x.name, text: !x.numeric, values: rows.map((i) => passCell(x, i)), description: given[x.name]?.description ?? null, details: given[x.name]?.details ?? null,
    })), columnNotes);
  } else {
    scoreValues = rows.map((i) => num(c.reason[i] ? Number.NaN : c.score[i]));
    scoreColumns = keepColumns(scoredColumns(results, run, condition, rows), columnNotes);
  }
  notes.push(...columnNotes);
  const scoresText = mavedbCSV([...idHeader, 'score', ...scoreColumns.map((x) => x.name)], rows.map((_, k) => [...ids(k), scoreValues[k], ...scoreColumns.map((x) => x.values[k])]));

  // The counts: those the run scored, or the record's passed through, for the same variants.
  let countColumns = [];
  if (isPublished) {
    const table = tables.counts;
    if (table) {
      const variantColumn = table.columns.find((x) => x.name === design.variants.column) ?? table.columns.find((x) => IDENTIFIERS.has(x.name) && x.name !== 'accession');
      const read = buildVariants(Array.from(variantColumn.values ?? []), { level: design.variants.level, mode: 'lenient', target: design.targets[0] });
      const where = new Map();
      for (let r = 0; r < read.n; r += 1) if (read.key[r] && read.status[r] !== STATUS.INVALID) where.set(read.key[r], where.has(read.key[r]) ? -1 : r);
      const at = rows.map((i) => where.get(v.key[i]) ?? -2);
      const valid = [...where.values()].filter((r) => r >= 0).length;
      if (at.some((r) => r < 0) || valid !== rows.length) {
        notes.push(`The counts name other variants than the scores (MaveDB needs the same ones in both): left out.`);
      } else {
        const given = details.columns?.counts ?? {};
        countColumns = keepColumns(table.columns.filter((x) => x !== variantColumn && !IDENTIFIERS.has(x.name)).map((x) => ({
          name: x.name, text: !x.numeric, values: at.map((r) => passCell(x, r)), description: given[x.name]?.description ?? null, details: given[x.name]?.details ?? null,
        })), notes);
        if (countColumns.some((x) => x.text)) {
          notes.push('The counts hold a column of text, which MaveDB refuses in counts: left out.');
          countColumns = countColumns.filter((x) => !x.text);
        }
      }
    }
  } else {
    countColumns = keepColumns(scoredCounts(results, run, condition, rows), notes);
  }
  const countsText = countColumns.length ? mavedbCSV([...idHeader, ...countColumns.map((x) => x.name)], rows.map((_, k) => [...ids(k), ...countColumns.map((x) => x.values[k])])) : null;

  // The column descriptions MaveDB keeps (score_columns_metadata, count_columns_metadata).
  const described = (columns) => Object.fromEntries(columns.filter((x) => x.description).map((x) => [x.name, { description: x.description, ...(x.details ? { details: x.details } : {}) }]));
  const scoreMeta = described(scoreColumns);
  const countMeta = described(countColumns);

  // The experiment and the score set, as MaveDB's API takes them.
  const keywordNotes = [];
  const keywords = depositKeywords(design, details.keywords ?? [], keywordNotes);
  notes.push(...keywordNotes);
  const keywordIssues = keywordProblems(keywords);
  for (const text of keywordIssues) missing.push({ field: 'keywords', text });
  for (const p of detailProblems(details)) if (p.field !== 'license') missing.push(p);
  const methodText = isPublished ? details.method ?? methodsText(methods) : [details.method, methodsText(methods)].filter(Boolean).join('\n\n') || null;
  const shortDescription = details.shortDescription ?? shortDescriptionOf(design, run, rows.length);
  if (!details.shortDescription) defaulted.push({ field: 'shortDescription', text: 'a sentence MaveScape wrote from the design' });
  const license = MAVEDB_LICENSES.find((l) => l.short === details.license);
  if (!license) missing.push({ field: 'license', text: `The license: MaveDB takes ${MAVEDB_LICENSES.map((l) => l.short).join(', ')}${details.license ? ` (not ${details.license})` : ''}.` });
  if (!details.abstract) missing.push({ field: 'abstract', text: 'The abstract: MaveDB asks for one with the experiment and the score set (the study\'s, or a paragraph on these data).' });
  if (!methodText) missing.push({ field: 'method', text: 'The method text: the analysis that made the scores.' });
  const ex = details.experiment ?? {};
  const experimentMethod = ex.method ?? experimentText(design);
  const [primary, ...secondary] = details.publications ?? [];
  const experimentJSON = {
    title: ex.title ?? details.title,
    shortDescription: ex.shortDescription ?? shortDescription,
    abstractText: ex.abstract ?? details.abstract ?? '',
    methodText: experimentMethod,
    keywords,
    doiIdentifiers: [],
    primaryPublicationIdentifiers: primary ? publicationsOf([primary]) : [],
    secondaryPublicationIdentifiers: publicationsOf(secondary),
    rawReadIdentifiers: (details.rawReads ?? []).map((identifier) => ({ identifier })),
    contributors: (details.contributors ?? []).map((orcidId) => ({ orcidId })),
  };
  const scoreSetJSON = {
    title: details.title,
    shortDescription,
    abstractText: details.abstract ?? '',
    methodText: methodText ?? '',
    licenseId: license?.id ?? null,
    experimentUrn: details.experimentUrn ?? null,
    ...(details.supersedes ? { supersededScoreSetUrn: details.supersedes } : {}),
    targetGenes: [plan.gene],
    primaryPublicationIdentifiers: primary ? publicationsOf([primary]) : [],
    secondaryPublicationIdentifiers: publicationsOf(secondary),
    doiIdentifiers: (details.dois ?? []).map((identifier) => ({ identifier })),
    contributors: (details.contributors ?? []).map((orcidId) => ({ orcidId })),
  };

  // Rows left out, and what remains to give.
  const leftOut = [...left].map(([reason, list]) => ({ reason, count: list.length, examples: list.slice(0, 5) }));
  const leftCount = leftOut.reduce((a, x) => a + x.count, 0);
  if (leftCount) notes.unshift(`${plural(leftCount, 'variant')} of ${exact(results.rows)} ${leftCount === 1 ? 'is' : 'are'} left out: ${leftOut.map((x) => `${exact(x.count)} ${x.reason}`).join('; ')}.`);
  if (results.conditions.length > 1) notes.push(`This score set holds the condition ${c.name}; MaveDB keeps each condition as a score set of its own, in the same experiment.`);
  if (!details.experimentUrn) notes.push(record?.experiment?.urn ? `The score set's experiment is new (experiment.json); to add it to ${record.experiment.urn} instead, give that experiment's URN.` : 'The score set\'s experiment is new (experiment.json): MaveDB gives it a URN when it is created, and the score set needs that URN (experimentUrn).');

  // The run's calibrations of this condition, in MaveDB's vocabulary (wave 8, slice 5): those made
  // with a published calibration's thresholds are MaveDB's already; an agent's proposal waits.
  const deposited = [];
  for (const o of calibrations) {
    const cal = o.cal;
    if (cal.run !== run.id || (cal.condition ?? 0) !== condition) continue;
    if (cal.published) notes.push(`The calibration "${cal.name}" takes the thresholds of "${cal.published.title}", which MaveDB holds already (${cal.published.urn}): not deposited again.`);
    else if (cal.proposed && !cal.proposed.accepted) notes.push(`The calibration "${cal.name}" is still proposed by ${cal.proposed.by}: not deposited until it is accepted.`);
    else if (!o.metrics) notes.push(`The calibration "${cal.name}" could not be computed again: ${o.problem ?? 'its scores are not at hand'}.`);
    else {
      const d = depositCalibration(o, details, software);
      deposited.push({ name: cal.name, body: d.body });
      notes.push(...d.notes);
      for (const x of d.missing) if (!missing.some((y) => y.text === x.text)) missing.push(x);
    }
  }

  const files = [];
  files.push({ name: 'scores.csv', text: scoresText });
  if (countsText) files.push({ name: 'counts.csv', text: countsText });
  if (Object.keys(scoreMeta).length) files.push({ name: 'score_columns.json', text: json(scoreMeta) });
  if (countsText && Object.keys(countMeta).length) files.push({ name: 'count_columns.json', text: json(countMeta) });
  files.push({ name: 'experiment.json', text: json(experimentJSON) });
  files.push({ name: 'score_set.json', text: json(scoreSetJSON) });
  // A package's own calibrations, as it wrote them, with its published scores.
  const passed = isPublished && record?.package && Array.isArray(record.calibrationBodies) ? record.calibrationBodies : [];
  if (passed.length) notes.push(`The package's ${passed.length === 1 ? 'calibration is' : `${passed.length} calibrations are`} passed through as ${passed.length === 1 ? 'it was' : 'they were'} written.`);
  for (const body of passed) deposited.unshift({ name: body.title, body });
  if (deposited.length) files.push({ name: 'score_calibrations.json', text: json(deposited.map((d) => d.body)) });
  const report = {
    mode: plan.mode,
    target: plan.gene,
    variants: { exported: rows.length, of: results.rows, leftOut },
    scored: rows.filter((i) => !c.reason[i] && Number.isFinite(c.score[i])).length,
    columns: { scores: ['score', ...scoreColumns.map((x) => x.name)], counts: countColumns.map((x) => x.name) },
    condition: c.name,
    keywords: keywords.map((k) => ({ key: k.keyword.key, label: k.keyword.label, ...(k.description ? { description: k.description } : {}) })),
    calibrations: deposited.map((d) => ({ name: d.name, classes: d.body.functionalClassifications.map((k) => ({ label: k.label, class: k.functionalClassification, range: k.range, oddsPath: k.oddspathsRatio ?? null, strength: k.acmgClassification ? `${k.acmgClassification.criterion} ${k.acmgClassification.evidenceStrength}` : null })) })),
    missing,
    defaulted,
    notes,
    ready: { tables: true, metadata: !missing.length },
  };
  const manifest = {
    format: DEPOSIT_FORMAT,
    version: DEPOSIT_VERSION,
    software: { name: 'MaveScape', version: software.version ?? null },
    workspace: { id: ws.id, name: ws.name },
    run: { id: run.id, name: run.name, outputSha256: run.output?.sha256 ?? null, published: isPublished },
    condition: c.name,
    mode: plan.mode,
    files: files.map((f) => ({ path: f.name, sha256: sha256(encoder.encode(f.text)) })),
    variants: report.variants,
    missing,
    defaulted,
    notes,
    researchUse: 'Experimental functional effects for research. Not a clinical classification: no variant is called pathogenic or benign.',
  };
  files.push({ name: 'mavescape.json', text: json(manifest) });
  files.unshift({ name: 'README.md', text: readmeOf({ ws, run, report, files, details, software }) });
  return { files, report };
}

// A sentence for MaveDB's short description, from the design, when the researcher gives none.
function shortDescriptionOf(design, run, n) {
  const target = design.targets?.[0];
  const phenotype = design.readout?.phenotype ? ` for ${lowerFirst(design.readout.phenotype.replace(/[.\s]+$/, ''))}` : '';
  if (published(run)) return `Published scores of ${exact(n)} variants of ${target?.name ?? 'the target'}${phenotype}.`;
  const reps = design.replicates?.length ?? 0;
  const kind = { 'two-population': 'a selection', 'time-series': 'a time series', bins: 'sorted bins' }[design.model] ?? 'an assay';
  return `Scores of ${exact(n)} variants of ${target?.name ?? 'the target'}${phenotype}, from ${kind} in ${plural(reps, 'replicate')}, analyzed with MaveScape.`;
}

// The README: what each file is, how to deposit it, and what is still to give.
function readmeOf({ ws, run, report, files, details, software }) {
  const has = (name) => files.some((f) => f.name === name);
  const target = report.target;
  const targetLine = target.targetAccession
    ? `the transcript ${target.targetAccession.accession} (gene ${target.targetAccession.gene}), its variants prefixed by it`
    : `its sequence (${target.targetSequence.sequenceType === 'dna' ? 'DNA' : 'protein'}, ${exact(target.targetSequence.sequence.length)} ${target.targetSequence.sequenceType === 'dna' ? 'nt' : 'residues'}, taxonomy ${target.targetSequence.taxonomy.code || 'not given'})`;
  const rows = [
    ['scores.csv', `the scores (${report.columns.scores.join(', ')}); MaveDB's scores_file`],
    ...(has('counts.csv') ? [['counts.csv', `the counts of the same variants (${plural(report.columns.counts.length, 'column')}); MaveDB's counts_file`]] : []),
    ...(has('score_columns.json') ? [['score_columns.json', 'what each column of scores.csv beyond the score is; MaveDB\'s score_columns_metadata']] : []),
    ...(has('count_columns.json') ? [['count_columns.json', 'what each column of counts.csv is; MaveDB\'s count_columns_metadata']] : []),
    ['experiment.json', 'the experiment: its title, descriptions, method, keywords (the MAVE minimum information), publications and raw reads; the body of POST /api/v1/experiments/'],
    ['score_set.json', 'the score set: its title, descriptions, the analysis (the methods), license, target and publications; the body of POST /api/v1/score-sets/'],
    ...(has('score_calibrations.json') ? [['score_calibrations.json', `${report.calibrations.length === 1 ? 'the calibration' : `the ${report.calibrations.length} calibrations`} of these scores, for research: each class's range (abnormal, not specified, normal), OddsPath and evidence strength, how it was made; each the body of POST /api/v1/score-calibrations/`]] : []),
    ['mavescape.json', 'what MaveScape wrote: the run, each file\'s SHA-256, the variants left out and why, what is missing'],
  ];
  return `# ${details.title}: a MaveDB deposit

Written by MaveScape ${software.version ?? ''} from the workspace "${ws.name}", ${run.name}${report.condition && run.inputs.design.conditions?.length > 1 ? ` (${report.condition})` : ''}, ${ws.modified}.
${published(run) ? '\nThe scores are as published, passed through; MaveScape did not rescore them.\n' : ''}
| File | What it is |
| --- | --- |
${rows.map(([f, w]) => `| \`${f}\` | ${w} |`).join('\n')}

The target is given by ${targetLine}. ${exact(report.variants.exported)} variants are in the tables${report.variants.leftOut.length ? `; ${exact(report.variants.leftOut.reduce((a, x) => a + x.count, 0))} are left out (mavescape.json says which and why)` : ''}.

## Depositing it

On mavedb.org, signed in: create the experiment (its fields are experiment.json's), then a score
set in it (score_set.json's fields), and upload scores.csv${has('counts.csv') ? ' and counts.csv' : ''}${has('score_columns.json') ? ', with the column descriptions' : ''}. Or through MaveDB's API, with
an access key: POST experiment.json to /api/v1/experiments/, put the experiment's URN in
score_set.json's experimentUrn, POST it to /api/v1/score-sets/, then POST the files to
/api/v1/score-sets/{urn}/variants/data (scores_file, counts_file, score_columns_metadata,
count_columns_metadata).${has('score_calibrations.json') ? ` Then each calibration in score_calibrations.json, its
scoreSetUrn the score set's URN, to /api/v1/score-calibrations/ (MaveDB marks it research use).` : ''} Nothing here is sent anywhere by MaveScape.

${report.missing.length ? `## Still to give\n\nMaveDB requires these, which the workspace does not hold (MaveScape's Record, "MaveDB details"):\n\n${report.missing.map((m) => `- ${m.text}`).join('\n')}\n` : '## Still to give\n\nNothing MaveDB requires is missing.\n'}
${report.defaulted.length ? `## Chosen for you, to confirm\n\n${report.defaulted.map((d) => `- ${DETAIL_NAMES[d.field] ?? d.field}: ${d.text}`).join('\n')}\n` : ''}
${report.notes.length ? `## Notes\n\n${report.notes.map((n) => `- ${n}`).join('\n')}\n` : ''}
MaveScape reports experimental functional effects for research; it does not classify variants as
pathogenic or benign.
`;
}

// The deposit as one ZIP, dated as given (the workspace's modification time, so that the same
// workspace writes the same bytes).
export async function depositZip(deposit, { date = new Date(0) } = {}) {
  return createZip(deposit.files.map((f) => ({ name: f.name, data: encoder.encode(f.text) })), { date, utc: true });
}

// --- A package read back ----------------------------------------------------------------------------

// A MaveDB package (experiment.json and score_set.json, as above, or as one writes them for MaveDB's
// API) read as a MaveDB record (the shape readScoreSet gives), with the MaveDB details it states.
// files: Map(name → text). Returns { record, details, problems }.
export function readDeposit(files, { name = 'package' } = {}) {
  const problems = [];
  const parse = (file) => {
    if (!files.has(file)) return null;
    try {
      return JSON.parse(files.get(file));
    } catch {
      problems.push(`${file} is not valid JSON.`);
      return null;
    }
  };
  const scoreSet = parse('score_set.json');
  const experiment = parse('experiment.json') ?? {};
  if (!scoreSet) return { problems: [...problems, 'The package has no score_set.json.'] };
  if (!files.has('scores.csv')) problems.push('The package has no scores.csv.');
  const scoreColumns = parse('score_columns.json');
  const countColumns = parse('count_columns.json');
  // Its score calibrations (wave 8, slice 5), read as a MaveDB record's.
  const calibrations = parse('score_calibrations.json');
  const license = MAVEDB_LICENSES.find((l) => l.id === scoreSet.licenseId);
  const pubs = (list) => (list ?? []).map((p) => ({ db: p.dbName ?? null, id: String(p.identifier) }));
  const target = scoreSet.targetGenes?.[0];
  const targets = (scoreSet.targetGenes ?? []).map((t) => ({
    name: t.name,
    category: t.category ?? null,
    sequenceType: t.targetSequence?.sequenceType ?? null,
    sequence: t.targetSequence?.sequence ?? null,
    label: t.targetSequence?.label ?? null,
    accession: t.targetAccession ? { accession: t.targetAccession.accession, assembly: t.targetAccession.assembly ?? null, gene: t.targetAccession.gene ?? null } : null,
    organism: Object.entries(TAXONOMY).find(([, code]) => code === t.targetSequence?.taxonomy?.code)?.[0] ?? null,
    taxonomyId: t.targetSequence?.taxonomy?.code || null,
    identifiers: (t.externalIdentifiers ?? []).map((x) => ({ db: x.identifier?.dbName, id: x.identifier?.identifier, offset: x.offset ?? 0 })),
  }));
  if (!target) problems.push('score_set.json names no target.');
  const keywords = (experiment.keywords ?? []).map((k) => ({ key: k.keyword?.key, label: k.keyword?.label, description: k.description ?? null }));
  const record = {
    urn: null,
    package: name,
    title: scoreSet.title ?? name,
    shortDescription: scoreSet.shortDescription ?? '',
    abstract: scoreSet.abstractText ?? '',
    method: scoreSet.methodText ?? '',
    license: licenseOf(license ? { shortName: license.short } : null),
    publication: pubs(scoreSet.primaryPublicationIdentifiers)[0] ?? null,
    publications: [...pubs(scoreSet.primaryPublicationIdentifiers), ...pubs(scoreSet.secondaryPublicationIdentifiers)],
    citation: null,
    dois: (scoreSet.doiIdentifiers ?? []).map((d) => d.identifier),
    contributors: (scoreSet.contributors ?? []).map((c) => c.orcidId),
    scoreColumns: [],
    countColumns: [],
    hasCounts: files.has('counts.csv'),
    targets,
    keywords,
    calibrations: Array.isArray(calibrations) ? calibrations.map(readCalibration) : [],
    // As written, so that a deposit of the package's scores passes them through (wave 8, slice 5).
    ...(Array.isArray(calibrations) && calibrations.length ? { calibrationBodies: calibrations } : {}),
    experiment: {
      urn: scoreSet.experimentUrn ?? null,
      title: experiment.title ?? null,
      shortDescription: experiment.shortDescription ?? null,
      abstract: experiment.abstractText ?? null,
      method: experiment.methodText ?? null,
      rawReads: (experiment.rawReadIdentifiers ?? []).map((r) => ({ id: r.identifier, url: null })),
      publications: [...pubs(experiment.primaryPublicationIdentifiers), ...pubs(experiment.secondaryPublicationIdentifiers)],
    },
    columns: { scores: scoreColumns ?? {}, counts: countColumns ?? {} },
    superseded: null,
    mapping: null,
  };
  // The MaveDB details the package states (ws.deposit): what a deposit of it says again. The score
  // set's method text and column descriptions are the record's, for its published scores only (a
  // run scored again from its counts has its own).
  const details = {
    title: record.title,
    shortDescription: record.shortDescription || null,
    abstract: record.abstract || null,
    experiment: { title: experiment.title ?? null, shortDescription: experiment.shortDescription ?? null, abstract: experiment.abstractText ?? null, method: experiment.methodText ?? null },
    license: license?.short ?? null,
    publications: record.publications,
    dois: record.dois,
    rawReads: record.experiment.rawReads.map((r) => r.id),
    contributors: record.contributors,
    experimentUrn: scoreSet.experimentUrn ?? null,
    supersedes: scoreSet.supersededScoreSetUrn ?? null,
    taxonomyId: targets[0]?.taxonomyId ?? null,
    keywords: keywords.filter((k) => !DESIGN_KEYWORDS[k.key]),
  };
  return { record, details, problems };
}
