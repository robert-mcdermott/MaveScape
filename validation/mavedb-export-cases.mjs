// MaveDB deposits written for the validation (wave 3, slice 4; suite `mavedb-export`): one for each
// kind of run and target MaveDB takes, from the bundled examples and the cached MaveDB records,
// as the window writes them (web/lib/mavedb-export.js). Each is
//   - checked by MaveDB's own validators (validation/reference/generate_mavedb_export.py, which
//     reads the packages this module writes with --write; its results, with the SHA-256 of every
//     file it checked, are reference/mavedb-export.json);
//   - read back as MaveScape opens a package (readDeposit, its published scores read as published)
//     and written again: the files MaveDB reads must be the same bytes.
//
//   node validation/mavedb-export-cases.mjs --write DIR     writes every package to DIR/<case>/

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTable } from '../web/lib/csv.js';
import { EXAMPLES } from '../web/lib/examples.js';
import { MAVEDB_FILES, mavedbDeposit, readDeposit } from '../web/lib/mavedb-export.js';
import { accessionTarget, countsDesign, readScoreSet, recordSummary, scoresDesign, targetsOf } from '../web/lib/mavedb.js';
import { detectLayout, reviewImport } from '../web/lib/importer.js';
import { addSource, addTarget, createWorkspace, setDesign } from '../web/lib/workspace.js';
import { addRun, makeRun, runInputs } from '../web/lib/runs.js';
import { defaultParameters, withDefaults } from '../web/lib/score.js';
import { writeMethods } from '../web/lib/methods.js';
import { computeQC } from '../web/lib/qc.js';
import { defaultThresholds, findingsFrom } from '../web/lib/findings.js';
import { sha256 } from '../web/lib/sha256.js';
import { exampleRecords, MissingExampleData, openExampleInNode } from './example-cases.mjs';
import { cbsCase } from './differential-cases.mjs';
import { inputFor, scoreTable } from './roundtrip-cases.mjs';

const encoder = new TextEncoder();
const fixture = (path) => new URL(`fixtures/public-data/${path}`, import.meta.url);
const NOW = '2026-10-10T12:00:00.000Z';
// The software the validation's runs record: fixed, so the packages do not change with the version.
const SOFTWARE = { version: 'validation' };

// What a researcher states for a deposit of their own run (ws.deposit): the validation's abstract,
// and for simulated data the synthetic construct's taxonomy.
const ABSTRACT = 'Written by MaveScape\'s validation suite to check its MaveDB deposits against MaveDB\'s own validators. Not for deposit.';
const DETAILS = { abstract: ABSTRACT };
const SIMULATED = { abstract: ABSTRACT, taxonomyId: 32630 };

// A cached table (node validation/fetch.mjs).
function cached(dataset, file) {
  const path = new URL(`cache/${dataset}/${file}`, import.meta.url);
  if (!existsSync(path)) throw new MissingExampleData(`needs ${dataset}/${file}: node validation/fetch.mjs ${dataset}`);
  return new Uint8Array(readFileSync(path));
}

const recordOf = (urn) => readScoreSet(JSON.parse(readFileSync(fixture(`mavedb/${urn.replaceAll(':', '_')}.json`), 'utf8')));

// A record's target and where it came from: its own sequence, or the transcript it names from the
// fetcher's cached answer.
function targetOf(record) {
  const { targets, pending } = targetsOf(record);
  if (targets.length) return { target: targets[0], origin: null };
  const p = pending[0];
  const file = p.kind === 'refseq' ? `ncbi/${p.accession}.gb` : `ensembl/${p.accession.replace(/\.\d+$/, '')}.json`;
  const made = accessionTarget(p, readFileSync(fixture(file), 'utf8'));
  if (made.problem) throw new Error(made.problem);
  return { target: made.target, origin: made.origin };
}

// A workspace as the window builds it: the target (with where it came from), the table, its
// record, the design, the MaveDB details; the table scored, with its QC. Times and ids fixed.
function workspace({ name, bytes, design, target, targetOrigin = null, origin = null, record = null, deposit = null, parameters = null }) {
  const table = parseTable(bytes, { fileName: 'table.csv' });
  let ws = createWorkspace(name, { now: NOW, id: 'ws-mavedb-export' });
  const added = addTarget(ws, targetOrigin ? { ...target, origin: targetOrigin } : target);
  ws = added.ws;
  const d = { ...design, targets: [{ ...target, id: added.id }] };
  const countColumns = d.samples.flatMap((s) => s.columns);
  const review = reviewImport(table, { variantColumn: d.variants.column, level: d.variants.level, countColumns, target: d.targets[0] });
  const source = {
    name, fileName: 'table.csv', sha256: sha256(bytes), rows: table.rows,
    columns: table.columns.map((c) => ({ name: c.name, type: c.type, missing: c.missing })),
    mapping: { variantColumn: d.variants.column, level: d.variants.level, mode: 'lenient', countColumns },
    target: added.id, summary: review.summary, problems: { blocking: [], warnings: [] },
    ...(origin ? { origin } : {}),
  };
  const withSource = addSource(ws, source);
  ws = setDesign(withSource.ws, d, 'The design', withSource.id);
  if (record) ws = { ...ws, records: [recordSummary(record)] };
  if (deposit) ws = { ...ws, deposit };
  const p = withDefaults({ ...defaultParameters(d, ws.sources[0]), ...(parameters ?? {}) });
  const scored = scoreTable(table, d, p);
  if (!scored.ok) throw new Error(`${name}: ${scored.errors.join(' ')}`);
  const run = makeRun({ inputs: runInputs({ source: ws.sources[0], design: d, parameters: p }), source: ws.sources[0], results: scored.results, software: SOFTWARE, name: d.model === 'scores' ? 'Published scores' : 'Run 1', created: NOW });
  ws = addRun(ws, run).ws;
  const findings = d.model === 'scores' ? null : findingsFrom(computeQC({ ...inputFor(table, d), design: d, results: scored.results }), defaultThresholds());
  return { ws, run, results: scored.results, table, findings };
}

// The deposit of a built workspace's run.
function deposit(built, { condition = 0, counts = null } = {}) {
  const { ws, run, results, table, findings } = built;
  const published = run.inputs.design.model === 'scores';
  const methods = published ? null : writeMethods(ws, run, { findings, results });
  const out = mavedbDeposit({ ws, run, results, condition, methods, tables: published ? { scores: table, counts } : {}, software: SOFTWARE });
  if (out.problem) throw new Error(out.problem);
  return out;
}

// An example opened as the window opens it, scored, in a workspace of its own.
function exampleCase(id, details) {
  const example = EXAMPLES.find((e) => e.id === id);
  const opened = openExampleInNode(example);
  const design = opened.design;
  const bytes = encoder.encode(tableText(opened.table));
  return workspace({ name: example.title, bytes, design, target: design.targets[0], deposit: details, parameters: opened.parameters });
}

// A table as CSV text (its cells as read), for an assembled or derived table.
function tableText(table) {
  const quote = (s) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = [table.columns.map((c) => quote(c.name)).join(',')];
  for (let r = 0; r < table.rows; r += 1) lines.push(table.columns.map((c) => quote(c.values ? c.values[r] ?? '' : Number.isNaN(c.numeric[r]) ? '' : String(c.numeric[r]))).join(','));
  return `${lines.join('\n')}\n`;
}

// A published MaveDB record's scores (and counts), read as published.
function publishedCase(urn, dataset, { scores = 'scores.csv', counts = null, rename = null } = {}) {
  const record = recordOf(urn);
  const { target, origin: targetOrigin } = targetOf(record);
  let bytes = cached(dataset, scores);
  if (rename) bytes = rename(bytes);
  const table = parseTable(bytes, { fileName: 'scores.csv' });
  const design = scoresDesign(record, { table, layout: detectLayout(table), target });
  const built = workspace({ name: record.title, bytes, design, target, targetOrigin, origin: { database: 'MaveDB', urn, file: 'scores' }, record });
  return { built, counts: counts ? parseTable(cached(dataset, counts), { fileName: 'counts.csv' }) : null };
}

// BRCA1 RING's nucleotide scores named n. (the same 909-nt target counts from its first base, as
// c. does here): MaveDB's form for nucleotide variants given without protein names.
const asNoncoding = (bytes) => {
  const text = new TextDecoder().decode(bytes).replace(/\r\n/g, '\n');
  const [header, ...lines] = text.trimEnd().split('\n');
  const names = header.split(',');
  const nt = names.indexOf('hgvs_nt');
  const pro = names.indexOf('hgvs_pro');
  const keep = (cells) => cells.filter((_, k) => k !== pro);
  return encoder.encode(`${[keep(names), ...lines.map((l) => {
    const cells = l.split(',');
    cells[nt] = cells[nt].replace(/^c\./, 'n.');
    return keep(cells);
  })].map((r) => r.join(',')).join('\n')}\n`);
};

// The cases: { id: () => [{ id, deposit }] }, each a run's deposit (several for a run of several
// conditions). expect: what MaveDB's validators should say of the metadata ('ok', or the field
// MaveScape reports missing and MaveDB refuses).
export const DEPOSIT_CASES = [
  { id: 'grb2-sh3', kind: 'protein variants, counts scored (two populations)', build: () => [deposit(exampleCase('grb2-sh3', { ...DETAILS, publications: [{ db: 'Crossref', id: '10.1038/s41586-024-08370-4' }] }))] },
  { id: 'grb2-sh3-incomplete', kind: 'no MaveDB details given: the abstract missing', expect: 'abstract', build: () => [deposit(exampleCase('grb2-sh3', null))] },
  { id: 'hsp90', kind: 'a time series, codons read at the protein level', build: () => [deposit(exampleCase('hsp90', DETAILS))] },
  { id: 'factor9', kind: 'sorted bins', build: () => [deposit(exampleCase('factor9', DETAILS))] },
  { id: 'simulated', kind: 'simulated, two populations', build: () => [deposit(exampleCase('simulated', SIMULATED))] },
  { id: 'simulated-time-series', kind: 'simulated time series', build: () => [deposit(exampleCase('simulated-time-series', SIMULATED))] },
  { id: 'simulated-sort-seq', kind: 'simulated sorted bins', build: () => [deposit(exampleCase('simulated-sort-seq', SIMULATED))] },
  { id: 'simulated-barcodes', kind: 'a table of barcodes, counts summed per variant', build: () => [deposit(exampleCase('simulated-barcodes', SIMULATED))] },
  { id: 'simulated-problems', kind: 'simulated, with problems planted', build: () => [deposit(exampleCase('simulated-problems', SIMULATED))] },
  {
    id: 'simulated-conditions', kind: 'two conditions: a score set each',
    build: () => {
      const built = exampleCase('simulated-conditions', SIMULATED);
      return built.results.conditions.map((_, k) => ({ suffix: built.results.conditions[k].id, ...deposit(built, { condition: k }) }));
    },
  },
  {
    id: 'cbs', kind: 'nucleotide variants of a coding sequence (c. with protein changes), counts scored, two conditions',
    build: () => {
      const c = cbsCase({ bytes: (file) => cached('mavedb-cbs', file) });
      const names = Object.keys(c.columns);
      const text = `hgvs_nt,${names.join(',')}\n${c.names.map((n, i) => `${n},${names.map((k) => (Number.isNaN(c.columns[k][i]) ? 'NA' : String(c.columns[k][i]))).join(',')}`).join('\n')}\n`;
      const built = workspace({ name: c.design.name, bytes: encoder.encode(text), design: c.design, target: c.design.targets[0], deposit: { ...DETAILS, taxonomyId: 9606 } });
      return built.results.conditions.map((_, k) => ({ suffix: built.results.conditions[k].id, ...deposit(built, { condition: k }) }));
    },
  },
  { id: 'pten-mavedb', kind: 'published protein scores from MaveDB, passed through', build: () => { const p = publishedCase('urn:mavedb:00000013-a-1', 'mavedb-pten-vampseq'); return [deposit(p.built)]; } },
  { id: 'brca1-ring-nt', kind: 'published nucleotide scores and counts of a coding sequence (c. and p.)', build: () => { const p = publishedCase('urn:mavedb:00000003-a-1', 'mavedb-brca1-ring', { scores: 'nt/scores.csv', counts: 'nt/counts.csv' }); return [deposit(p.built, { counts: p.counts })]; } },
  { id: 'brca1-ring-n', kind: 'nucleotide variants without protein names (n.)', build: () => { const p = publishedCase('urn:mavedb:00000003-a-1', 'mavedb-brca1-ring', { scores: 'nt/scores.csv', rename: asNoncoding }); return [deposit(p.built)]; } },
  { id: 'brca1-sge', kind: 'published scores and counts on a RefSeq transcript (NM_007294.3)', build: () => { const p = publishedCase('urn:mavedb:00000097-0-2', 'mavedb-brca1-sge', { counts: 'counts.csv' }); return [deposit(p.built, { counts: p.counts })]; } },
  {
    id: 'brca1-sge-counts', kind: 'counts on a RefSeq transcript, scored',
    build: () => {
      const record = recordOf('urn:mavedb:00000097-0-2');
      const { target, origin } = targetOf(record);
      const bytes = cached('mavedb-brca1-sge', 'counts.csv');
      const table = parseTable(bytes, { fileName: 'counts.csv' });
      const { design } = countsDesign(record, { table, layout: detectLayout(table), target });
      return [deposit(workspace({ name: record.title, bytes, design, target, targetOrigin: origin, origin: { database: 'MaveDB', urn: record.urn, file: 'counts' }, record }))];
    },
  },
  { id: 'bap1', kind: 'published scores on an Ensembl transcript (ENST00000460680)', build: () => { const p = publishedCase('urn:mavedb:00000662-a-2', 'mavedb-bap1-sge'); return [deposit(p.built)]; } },
];

// Every case's deposits: [{ id, kind, expect, deposit }] (a case of several conditions gives one
// per condition, id-condition). missing: the cases whose data are not cached.
export function depositPackages(only = null) {
  const out = [];
  const missing = [];
  for (const c of DEPOSIT_CASES) {
    if (only && !only.includes(c.id)) continue;
    try {
      for (const d of c.build()) out.push({ id: d.suffix ? `${c.id}-${d.suffix}` : c.id, kind: c.kind, expect: c.expect ?? 'ok', deposit: d });
    } catch (error) {
      if (error instanceof MissingExampleData) missing.push(`${c.id}: ${error.message}`);
      else throw error;
    }
  }
  return { packages: out, missing };
}

// The SHA-256 of each file MaveDB reads in a deposit: { name: hash }.
export const mavedbHashes = (d) => Object.fromEntries(d.files.filter((f) => MAVEDB_FILES.includes(f.name)).map((f) => [f.name, sha256(encoder.encode(f.text))]));

// A deposit read back as MaveScape opens a package (its published scores read as published, its
// counts beside them, its MaveDB details kept) and written again. Returns { same, differ: [file] }.
export function roundTrip(first) {
  const files = new Map(first.files.map((f) => [f.name, f.text]));
  const { record, details, problems } = readDeposit(files, { name: 'package' });
  if (problems.length) throw new Error(problems.join(' '));
  const { target, origin: targetOrigin } = targetOf(record);
  const bytes = encoder.encode(files.get('scores.csv'));
  const table = parseTable(bytes, { fileName: 'scores.csv' });
  const design = scoresDesign(record, { table, layout: detectLayout(table), target });
  const built = workspace({ name: record.title, bytes, design, target, targetOrigin, origin: { database: 'package', package: 'package', file: 'scores' }, record, deposit: details });
  const counts = files.has('counts.csv') ? parseTable(encoder.encode(files.get('counts.csv')), { fileName: 'counts.csv' }) : null;
  const second = deposit(built, { counts });
  const text = (d) => new Map(d.files.filter((f) => MAVEDB_FILES.includes(f.name)).map((f) => [f.name, f.text]));
  const a = text(first);
  const b = text(second);
  const names = [...new Set([...a.keys(), ...b.keys()])];
  const differ = names.filter((n) => a.get(n) !== b.get(n));
  return { same: !differ.length, differ, second, back: built };
}

// An example opened from MaveDB with its counts (wave 3, slice 6: BRCA1 RING's round trip), its
// Run 1 deposited as the window deposits it (its record kept, for the deposit's defaults), and the
// deposit read back and written again: { built, first, trip }.
export function exampleRoundTrip(id) {
  const example = EXAMPLES.find((e) => e.id === id);
  const opened = openExampleInNode(example);
  const record = recordOf(exampleRecords(example)[0].urn);
  const bytes = encoder.encode(tableText(opened.table));
  const built = workspace({ name: example.title, bytes, design: opened.design, target: opened.design.targets[0], origin: { database: 'MaveDB', urn: record.urn, file: 'counts' }, record, parameters: opened.parameters });
  const first = deposit(built);
  return { built, first, trip: roundTrip(first) };
}

// --write DIR: each package's files in DIR/<id>/, for the reference.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const at = process.argv.indexOf('--write');
  if (at < 0 || !process.argv[at + 1]) {
    console.error('usage: node validation/mavedb-export-cases.mjs --write DIR [case …]');
    process.exit(2);
  }
  const dir = process.argv[at + 1];
  const only = process.argv.slice(at + 2);
  const { packages, missing } = depositPackages(only.length ? only : null);
  for (const p of packages) {
    mkdirSync(join(dir, p.id), { recursive: true });
    for (const f of p.deposit.files) writeFileSync(join(dir, p.id, f.name), f.text);
    console.log(`${p.id}: ${p.deposit.report.variants.exported} variants (${p.deposit.report.mode})${p.deposit.report.missing.length ? `; missing ${p.deposit.report.missing.map((m) => m.field).join(', ')}` : ''}`);
  }
  for (const m of missing) console.log(`not written: ${m}`);
}
