// The bundled examples opened as the window opens them (web/ui/examples.js), for the validation
// suite `examples` (wave 2, slice 11): the files read (a published example's from web/examples/,
// a simulated one's from its seed), assembled (Hsp90's codon variants read at the protein level),
// the design set, scored with MaveScape's defaults and what the example sets, its QC and its
// readiness.

import { existsSync, readFileSync } from 'node:fs';
import { parseTable } from '../web/lib/csv.js';
import { assembleTable } from '../web/lib/assemble.js';
import { defaultParameters, withDefaults } from '../web/lib/score.js';
import { computeQC } from '../web/lib/qc.js';
import { defaultThresholds, findingsFrom } from '../web/lib/findings.js';
import { readiness } from '../web/lib/readiness.js';
import { simulatedExample } from '../web/lib/examples.js';
import { readScoreSet, scoresDesign, targetsOf, accessionTarget, joinedPrefix } from '../web/lib/mavedb.js';
import { detectLayout } from '../web/lib/importer.js';
import { inputFor, scoreTable } from './roundtrip-cases.mjs';
import { workspaceOf } from './readiness-cases.mjs';

const web = (path) => new URL(`../web/${path}`, import.meta.url);
const encoder = new TextEncoder();

// The data set of validation/sources.json each published example's counts come from.
export const EXAMPLE_DATASETS = { 'grb2-sh3': 'mavedb-grb2-sh3', hsp90: 'mavedb-hsp90', factor9: 'mavedb-factor9', 'pten-mavedb': 'mavedb-pten-vampseq', 'brca1-sge': 'mavedb-brca1-sge', 'dhfr-lon': 'mavedb-dhfr', 'brca1-ring': 'mavedb-brca1-ring' };
// Where in its data set each record's tables are (wave 3, slice 6).
const RECORD_DIRS = { 'urn:mavedb:00000003-a-2': 'aa/', 'urn:mavedb:00000063-b-1': 'minus-lon/', 'urn:mavedb:00000063-a-1': 'plus-lon/' };

// The records an example opened from MaveDB is made of (ui/mavedb.js exampleRecords).
export const exampleRecords = (example) => (example?.mavedb?.records ?? (example?.mavedb ? [example.mavedb] : []));

// A record's table as the validation keeps it: { bytes, path }.
export function recordTable(example, urn, file) {
  const relative = `${RECORD_DIRS[urn] ?? ''}${file}.csv`;
  const path = new URL(`cache/${EXAMPLE_DATASETS[example.id]}/${relative}`, import.meta.url);
  if (!existsSync(path)) throw new MissingExampleData(`${example.title} needs MaveDB's tables: node validation/fetch.mjs ${EXAMPLE_DATASETS[example.id]}`);
  return { bytes: new Uint8Array(readFileSync(path)), path, relative };
}

// A record as the fetcher cached it (validation/fixtures/public-data).
export const cachedRecord = (urn) => readScoreSet(JSON.parse(readFileSync(new URL(`fixtures/public-data/mavedb/${urn.replaceAll(':', '_')}.json`, import.meta.url), 'utf8')));

// An example opened from MaveDB (wave 3, slice 2) needs its table, which the program downloads when
// it is opened and the validation keeps in validation/cache/ (node validation/fetch.mjs).
export class MissingExampleData extends Error {}

// A record's target: its own sequence, or the transcript it names, from the fetcher's cached answer
// (validation/fixtures/public-data: NCBI's GenBank record, Ensembl's sequence; wave 3, slice 3).
export function recordTarget(record, options = {}) {
  const { targets, pending } = targetsOf(record, options);
  if (targets.length) return targets[0];
  const p = pending[0];
  const file = p.kind === 'refseq' ? `ncbi/${p.accession}.gb` : `ensembl/${p.accession.replace(/\.\d+$/, '')}.json`;
  const made = accessionTarget(p, readFileSync(new URL(`fixtures/public-data/${file}`, import.meta.url), 'utf8'));
  if (made.problem) throw new Error(made.problem);
  return made.target;
}

// A MaveDB example's counts (several records' joined, each named by its URN's number, as
// ui/mavedb.js joins them) and the example's own design for them, its target the record's
// (wave 3, slice 6).
function mavedbCountsExample(example) {
  const records = exampleRecords(example);
  const parts = records.map((r) => ({ name: records.length > 1 ? `${joinedPrefix(r.urn)}.csv` : `${r.urn.replaceAll(':', '_')}.counts.csv`, bytes: recordTable(example, r.urn, 'counts').bytes, role: 'counts' }));
  const given = JSON.parse(readFileSync(web(example.files.design), 'utf8'));
  const record = cachedRecord(records[0].urn);
  const target = recordTarget(record);
  if (target.sequence !== given.targets[0].sequence) throw new Error(`${example.title}: the design's target is not the record's.`);
  const origin = records.length > 1
    ? { database: 'MaveDB', urn: null, urns: records.map((r) => r.urn), file: 'counts', joined: true, license: record.license.short, hasCounts: true, rawReads: record.experiment.rawReads.map((r) => r.id) }
    : { database: 'MaveDB', urn: records[0].urn, file: 'counts', license: record.license.short, hasCounts: true, rawReads: record.experiment.rawReads.map((r) => r.id) };
  return { parts, design: given, origin, records: records.map((r) => cachedRecord(r.urn)) };
}

// A MaveDB example's record (as the fetcher cached it, validation/fixtures/public-data) and table.
function mavedbExample(example) {
  const urn = example.mavedb.urn;
  const record = readScoreSet(JSON.parse(readFileSync(new URL(`fixtures/public-data/mavedb/${urn.replaceAll(':', '_')}.json`, import.meta.url), 'utf8')));
  const path = new URL(`cache/${EXAMPLE_DATASETS[example.id]}/scores.csv`, import.meta.url);
  if (!existsSync(path)) throw new MissingExampleData(`${example.title} needs MaveDB's table: node validation/fetch.mjs ${EXAMPLE_DATASETS[example.id]}`);
  const bytes = new Uint8Array(readFileSync(path));
  const table = parseTable(bytes, { fileName: 'scores.csv' });
  const target = recordTarget(record);
  const design = scoresDesign(record, { table, layout: detectLayout(table), target });
  // What the example states that the record does not (its direction, from the paper).
  if (example.readout) design.readout = { ...(design.readout ?? {}), ...example.readout };
  return { record, bytes, design };
}

export function openExampleInNode(example, extra = {}) {
  let parts;
  let design;
  let sim = null;
  let origin = null;
  if (example.simulated) {
    sim = simulatedExample(example);
    parts = sim.files.map((f) => ({ name: f.name, bytes: encoder.encode(f.text), role: f.role }));
    design = sim.design;
  } else if (example.mavedb && example.files?.design) {
    // Its counts with its own design: Run 1 (DHFR's two conditions, BRCA1 RING's round trip).
    const opened = mavedbCountsExample(example);
    parts = opened.parts;
    design = opened.design;
    origin = opened.origin;
  } else if (example.mavedb) {
    const opened = mavedbExample(example);
    parts = [{ name: 'scores.csv', bytes: opened.bytes, role: 'counts' }];
    design = opened.design;
    origin = { database: 'MaveDB', urn: example.mavedb.urn, file: 'scores', license: opened.record.license.short, hasCounts: opened.record.hasCounts, rawReads: opened.record.experiment.rawReads.map((r) => r.id) };
  } else {
    parts = [{ name: 'counts.csv', bytes: new Uint8Array(readFileSync(web(example.files.counts))), role: 'counts' }];
    design = JSON.parse(readFileSync(web(example.files.design), 'utf8'));
  }
  if (extra.design) design = extra.design(design);
  const assembled = assembleTable(parts.map((p) => ({ name: p.name, table: parseTable(p.bytes, { fileName: p.name }), role: p.role })), { level: design.variants.level, target: design.targets[0], ...(example.assembly ?? {}) });
  const table = assembled.table;
  const ws = workspaceOf(table, design, origin ? { origin, layout: origin.file === 'counts' ? assembled.kind === 'joined' ? 'generic' : 'mavedb-counts' : 'mavedb-scores' } : {});
  const parameters = withDefaults({ ...defaultParameters(design, ws.sources[0]), ...(example.parameters ?? {}), ...(extra.parameters ?? {}) });
  const scored = scoreTable(table, design, parameters);
  const qc = computeQC({ ...inputFor(table, design), design, results: scored.ok ? scored.results : null });
  const findings = findingsFrom(qc, defaultThresholds());
  return { parts, design, assembled, table, ws, parameters, scored, findings, readiness: readiness(ws), sim };
}

// The findings that do not pass, as { id: status }.
export const raisedOf = (findings) => Object.fromEntries(findings.filter((f) => f.status === 'review' || f.status === 'fail').map((f) => [f.id, f.status]));
