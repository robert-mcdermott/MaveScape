// MaveDB in the window (wave 3, slice 2; requirement I1): search MaveDB's published score sets, read
// a record (its license and terms, citation, target, keywords, columns and calibrations), and open
// it as a workspace: its published scores, read as published, as a run on the map ("Published
// scores"); its counts, when the authors deposited them, with a design drafted from their column
// names to check and score; the record kept with the workspace. Everything comes through the
// MaveScape program's fetcher (public-data.js), cached for offline use.
//
// A target named by a transcript (wave 3, slice 3) is fetched (NCBI's GenBank record of a RefSeq
// transcript, Ensembl's sequence of one of its own) and kept with where it came from; a score set
// of several targets opens one, chosen, at a time; MaveDB's mapped variants (VRS identifiers), when
// asked for, are kept beside the tables (source.origin.mapped) for the inspector.

import { h, icon, formatCount } from './dom.js';
import { progressToast, showDialog, toast } from './overlays.js';
import { fetchPublic, publicDataState } from './public-data.js';
import { storeBytes } from './import.js';
import { runScore, workerInput } from './score-input.js';
import { accessionTarget, countsDesign, countsDesignTogether, distinctNames, joinedPrefix, mappedCSV, mappedVariants, normalizeUrn, normalizeUrns, readScoreSet, recordSummary, scoresDesign, searchHits, targetsOf } from '../lib/mavedb.js';
import { assembleTable } from '../lib/assemble.js';
import { detectLayout, reviewImport, suggestRoles } from '../lib/importer.js';
import { addRun, makeRun, runInputs } from '../lib/runs.js';
import { defaultParameters } from '../lib/score.js';
import { addSource, addTarget, change, createWorkspace, setDesign } from '../lib/workspace.js';
import { retrievalText } from '../lib/retrieval.js';
import { readDeposit } from '../lib/mavedb-export.js';
import { isZip, readZip } from '../lib/zip.js';
import { now } from '../lib/clock.js';

const exact = (n) => n.toLocaleString('en-US');
const plural = (n, word, many = `${word}s`) => `${exact(n)} ${n === 1 ? word : many}`;

// A table from MaveDB read as an imported one: parsed, its layout detected, its names checked
// against the target, its bytes stored in the library.
async function readTable(app, name, bytes, target) {
  const table = await app.parseTableFile({ name, bytes });
  const layout = detectLayout(table);
  if (!layout.variantColumn) throw new Error(`${name}: no column of variant names.`);
  const review = reviewImport(table, { variantColumn: layout.variantColumn, level: layout.level, countColumns: layout.countColumns, target, mode: 'lenient' });
  const stored = await storeBytes(app, bytes);
  return { name, table, layout, review, stored };
}

// The workspace's source for a table from MaveDB, with where it came from (origin).
function sourceOf(part, { name, target, origin }) {
  const { table, layout, review, stored } = part;
  return {
    name,
    fileName: part.name,
    sha256: stored.sha256,
    size: stored.size,
    files: [{ fileName: part.name, sha256: stored.sha256, size: stored.size }],
    rows: table.rows,
    columns: table.columns.map((c) => ({ name: c.name, type: c.type, missing: c.missing })),
    encoding: table.encoding ?? 'utf-8',
    delimiter: table.delimiter,
    lineEnd: table.lineEnd,
    layout: layout.layout,
    mapping: { variantColumn: layout.variantColumn, level: layout.level, mode: 'lenient', countColumns: layout.countColumns.slice(), scoreColumns: { ...layout.scoreColumns } },
    target,
    roleSuggestions: suggestRoles(layout.countColumns).filter((r) => r.role),
    summary: review.summary,
    problems: { blocking: review.blocking.map((p) => p.message), warnings: review.warnings.map((p) => p.message) },
    imported: now(),
    origin,
  };
}

// The target of a record: its own sequence, or the transcript its accession names, fetched.
// Returns { target, origin, notes } (origin: where a fetched target came from).
async function recordTarget(app, record, choice, busy) {
  const { targets, pending, choices, problems } = targetsOf(record, { target: choice });
  if (choices.length && !targets.length && !pending.length) {
    throw new Error(choice ? problems.join(' ') : `The score set has ${choices.length} targets (${choices.slice(0, 6).map((c) => c.label).join(', ')}${choices.length > 6 ? ', …' : ''}), each variant named with its target's: choose the one to open.`);
  }
  if (targets.length) return { target: targets[0], origin: null, notes: [] };
  if (!pending.length) throw new Error(problems.join(' ') || 'The record names no target.');
  const p = pending[0];
  busy?.update(0.08, `Fetching the transcript ${p.accession}`);
  const got = p.kind === 'refseq' ? await fetchPublic(app, `ncbi/nuccore/${p.accession}`, { as: 'text' }) : await fetchPublic(app, `ensembl/transcript/${p.accession}`);
  if (!got.ok) throw new Error(`The target's transcript ${p.accession}: ${got.message}`);
  const made = accessionTarget(p, p.kind === 'refseq' ? got.text : got.json, { retrieval: got.retrieval });
  if (made.problem) throw new Error(made.problem);
  return { target: made.target, origin: made.origin, notes: made.messages.map((m) => m.message) };
}

// The workspace of a record and its tables (a score set from MaveDB, or a MaveDB package opened from
// files): the target, the record kept, the published scores read as published (a run of their own),
// the counts with a design drafted from their column names. Loaded into the window. Returns
// { ws, target, published, result, draft, changed }.
async function openRecordWorkspace(app, { record, retrieval, recordsTarget, targetOrigin, scores, scoresRetrieval, countsPart, countsRetrieval, origin, example = null, prepare = null, deposit = null, busy, label, named, history }) {
  await app.saveNow();
  let ws = createWorkspace(record.title);
  const added = addTarget(ws, targetOrigin ? { ...recordsTarget, origin: targetOrigin } : recordsTarget);
  ws = added.ws;
  const target = ws.targets.find((t) => t.id === added.id);
  ws = change(ws, { records: [...(ws.records ?? []), recordSummary(record, retrieval)], ...(deposit ? { deposit } : {}) }, ...history);
  // The published scores, read as published: a run of their own.
  const scoresSource = addSource(ws, sourceOf(scores, { name: `${record.title}: scores (${label})`, target: target.id, origin: origin('scores', scoresRetrieval) }));
  const design = scoresDesign(record, { table: scores.table, layout: scores.layout, target });
  if (example?.readout) design.readout = { ...(design.readout ?? {}), ...example.readout };
  ws = setDesign(scoresSource.ws, design, `The published scores of ${named}, read as published${example?.readout ? ' (the readout\'s direction as the example states it, from the paper)' : ''}`, scoresSource.id);
  // An example's table is the one it was made with, or the guide's numbers may not hold.
  const changed = Boolean(example?.mavedb?.scores?.sha256 && scores.stored.sha256 !== example.mavedb.scores.sha256) || Boolean(example?.mavedb?.counts?.sha256 && countsPart && countsPart.stored.sha256 !== example.mavedb.counts.sha256);
  if (example) ws = change(ws, { example: { id: example.id, simulated: false } }, 'example', `Opened the example "${example.title}" (${example.source}, ${example.license})${changed ? `; MaveDB's table has changed since the example was made (SHA-256 ${scores.stored.sha256.slice(0, 12)}…, not ${example.mavedb.scores.sha256.slice(0, 12)}…)` : ''}`);
  busy.update(0.6, 'Reading the scores as published');
  const input = workerInput(scores.table, ws.design);
  const parameters = defaultParameters(ws.design, ws.sources.find((s) => s.id === scoresSource.id));
  const result = await runScore(app, { names: input.names, barcodes: input.barcodes, columns: input.columns, design: ws.design, parameters, mode: 'lenient' }, { transfer: input.transfer }).promise;
  let published = null;
  if (result.ok) {
    const source = ws.sources.find((s) => s.id === scoresSource.id);
    published = makeRun({ inputs: runInputs({ source, design: ws.design, parameters }), source, results: result.results, software: { version: app.version, commit: app.commit }, name: 'Published scores' });
    ws = addRun(ws, published).ws;
    app.runResults ??= new Map();
    app.runResults.set(published.id, { results: result.results, status: 'computed' });
  }
  // The counts, with a design drafted from their column names: to check, then score.
  let countsId = null;
  let draft = null;
  if (countsPart) {
    const countsSource = addSource(ws, sourceOf(countsPart, { name: `${record.title}: counts (${label})`, target: target.id, origin: origin('counts', countsRetrieval) }));
    countsId = countsSource.id;
    draft = countsDesign(record, { table: countsPart.table, layout: countsPart.layout, target });
    ws = setDesign(countsSource.ws, draft.design, `A design drafted from the column names of ${named}'s counts`, countsId);
  }
  // An example's own design of the counts, and its first run (ui/examples.js).
  if (prepare) ws = await prepare(ws, { counts: countsPart ? { id: countsId, table: countsPart.table } : null, busy });
  await app.loadWorkspace(ws);
  app.tables.set(scoresSource.id, { table: scores.table, review: scores.review });
  if (countsPart) app.tables.set(countsId, { table: countsPart.table, review: countsPart.review });
  app.store.markSaved(null);
  await app.saveNow();
  await app.setMode(published ? 'map' : 'experiment');
  return { ws: app.store.ws, target, published, result, draft, changed };
}

// Opens a published score set as a new workspace. counts: also its counts, when it has them.
// target: of a score set of several targets, the one to open (its label). mapped: also MaveDB's
// mapped variants. example: a bundled example opened from MaveDB (lib/examples.js): what it states
// that the record does not (its readout), and the checksum its table had when the example was made.
// Returns { ok, message, data }.
export async function importMaveDB(app, text, { counts = true, example = null, prepare = null, target: choice = null, mapped = false } = {}) {
  // Several score sets written together open as one workspace, a condition each (wave 3, slice 6).
  const urns = normalizeUrns(text);
  if (urns.length > 1) return importMaveDBTogether(app, urns, { counts, example, prepare });
  const urn = normalizeUrn(text);
  if (!urn) return { ok: false, message: `"${text}" is not the URN of a published MaveDB score set (such as urn:mavedb:00000835-a-1).` };
  const state = publicDataState(app);
  if (state === 'web' || state === 'off') {
    const got = await fetchPublic(app, `mavedb/score-sets/${urn}`);
    return { ok: false, message: got.message };
  }
  const busy = progressToast(`Opening ${urn} from MaveDB…`);
  let changed = false;
  try {
    const got = await fetchPublic(app, `mavedb/score-sets/${urn}`);
    if (!got.ok) throw new Error(got.message);
    const record = readScoreSet(got.json);
    if (record.problem) throw new Error(record.problem);
    const { target: recordsTarget, origin: targetOrigin, notes: targetNotes } = await recordTarget(app, record, choice ?? example?.mavedb?.target ?? null, busy);
    const problems = targetNotes;
    const stem = urn.replaceAll(':', '_');
    busy.update(0.15, 'Reading the published scores');
    const scoresFile = await fetchPublic(app, `mavedb/score-sets/${urn}/scores`, { as: 'bytes' });
    if (!scoresFile.ok) throw new Error(scoresFile.message);
    const scores = await readTable(app, `${stem}.scores.csv`, scoresFile.bytes, recordsTarget);
    let countsPart = null;
    let countsRetrieval = null;
    if (counts && record.hasCounts) {
      busy.update(0.4, 'Reading the counts');
      const countsFile = await fetchPublic(app, `mavedb/score-sets/${urn}/counts`, { as: 'bytes' });
      if (!countsFile.ok) throw new Error(countsFile.message);
      countsPart = await readTable(app, `${stem}.counts.csv`, countsFile.bytes, recordsTarget);
      countsRetrieval = countsFile.retrieval;
    }
    // MaveDB's mapped variants, kept beside the tables (a CSV in the library).
    let mappedFile = null;
    if (mapped) {
      busy.update(0.5, 'Reading MaveDB\'s mapped variants');
      const got2 = await fetchPublic(app, `mavedb/score-sets/${urn}/mapped-variants`);
      if (!got2.ok) throw new Error(`MaveDB's mapped variants: ${got2.message}`);
      const rows = mappedVariants(got2.json);
      const stored = await storeBytes(app, new TextEncoder().encode(mappedCSV(rows)));
      mappedFile = { fileName: `${stem}.mapped.csv`, sha256: stored.sha256, size: stored.size, variants: rows.length, retrieved: got2.retrieval?.retrieved ?? null, url: got2.retrieval?.source ?? null };
    }

    const origin = (file, retrieval) => ({ database: 'MaveDB', urn, file, url: retrieval?.source ?? null, retrieved: retrieval?.retrieved ?? null, license: record.license.short, hasCounts: record.hasCounts, rawReads: record.experiment.rawReads.map((r) => r.id), ...(mappedFile ? { mapped: mappedFile } : {}) });
    const opened = await openRecordWorkspace(app, {
      record, retrieval: got.retrieval, recordsTarget, targetOrigin, scores, scoresRetrieval: scoresFile.retrieval, countsPart, countsRetrieval, origin, example, prepare, busy,
      label: 'MaveDB', named: urn,
      history: ['mavedb', `Opened ${urn} from MaveDB: "${record.title}" (${record.license.short}; ${retrievalText(got.retrieval) || 'retrieved now'})`],
    });
    const { ws, target, published, result, draft } = opened;
    changed = opened.changed;
    const scored = published ? published.output.conditions[0].scored : 0;
    const message = [
      `Opened ${urn} from MaveDB: "${record.title}" (${record.license.short}).`,
      targetOrigin ? `Its target, ${target.name}, is the transcript ${targetOrigin.accession} (${targetOrigin.service ?? targetOrigin.format}).` : '',
      ...targetNotes,
      published ? `Its published scores are on the map: ${exact(scored)} of ${exact(scores.table.rows)} variants have one (the run "Published scores", read as published)${ws.design.variants.level !== 'protein' ? ', its nucleotide variants read at the protein level' : ''}.` : `Its scores could not be read: ${result.errors.join(' ')}`,
      mappedFile ? `MaveDB's mapping of ${exact(mappedFile.variants)} variants to the human reference (VRS identifiers) is kept: the inspector shows each variant's.` : '',
      countsPart && prepare ? `Its counts (${plural(countsPart.layout.countColumns.length, 'column')}) have the example's design, scored (Run 1).` : countsPart ? `Its counts (${plural(countsPart.layout.countColumns.length, 'column')}) have a design drafted from their names (${{ 'two-population': 'two populations', 'time-series': 'a time series', bins: 'sorted bins' }[draft.design.model] ?? draft.design.model}): check it in Experiment, then score.` : record.hasCounts ? 'Its counts were not opened.' : 'MaveDB has no counts for it: the readiness says where they may be.',
      record.license.open ? '' : `License: ${record.license.terms}`,
      changed ? 'MaveDB\'s table has changed since the example was made: what its guide expects may not hold.' : '',
    ].filter(Boolean).join(' ');
    busy.done(`Opened ${urn} from MaveDB.`);
    return { ok: true, message, data: { urn, title: record.title, license: record.license, citation: record.citation, target: { name: target.name, ...(targetOrigin ? { accession: targetOrigin.accession, from: targetOrigin.service ?? targetOrigin.format } : {}) }, published: published ? { run: published.name, scored, variants: scores.table.rows } : null, counts: countsPart ? { columns: countsPart.layout.countColumns.length, design: draft.design.model } : null, mapped: mappedFile ? mappedFile.variants : null, calibrations: record.calibrations.length, warnings: problems } };
  } catch (error) {
    busy.fail(`${urn} could not be opened: ${error.message}`);
    return { ok: false, message: `${urn} could not be opened: ${error.message}` };
  }
}

// Several published score sets of one target opened as one workspace (wave 3, slice 6): two
// selections of one library, or of one gene's library in two strains, that MaveDB keeps as score
// sets of their own. Each record is kept and its published scores are a run of their own; their
// counts, when every one has them, are joined into one table on their variant names, each
// record's columns named by its URN's number ("00000063-a-1:Repeat1_t_00hrs"), with a design
// drafted from their names, a condition each, the first the reference: the differential map
// compares them. Their targets must be the same sequence. Returns { ok, message, data }.
async function importMaveDBTogether(app, urns, { counts = true, example = null, prepare = null } = {}) {
  const state = publicDataState(app);
  if (state === 'web' || state === 'off') {
    const got = await fetchPublic(app, `mavedb/score-sets/${urns[0]}`);
    return { ok: false, message: got.message };
  }
  const named = urns.join(' and ');
  const busy = progressToast(`Opening ${named} from MaveDB…`);
  try {
    const opened = [];
    for (const urn of urns) {
      busy.update(0.02 + 0.08 * opened.length / urns.length, `Reading ${urn}`);
      const got = await fetchPublic(app, `mavedb/score-sets/${urn}`);
      if (!got.ok) throw new Error(`${urn}: ${got.message}`);
      const record = readScoreSet(got.json);
      if (record.problem) throw new Error(`${urn}: ${record.problem}`);
      opened.push({ urn, record, retrieval: got.retrieval });
    }
    // One target: each record's, fetched when a transcript names it, the same sequence.
    let first = null;
    for (const o of opened) {
      const t = await recordTarget(app, o.record, null, busy);
      if (!first) first = t;
      else if (t.target.sequence !== first.target.sequence || t.target.sequenceType !== first.target.sequenceType) throw new Error(`${o.urn}'s target (${t.target.name}, ${t.target.sequence.length} ${t.target.sequenceType === 'dna' ? 'nt' : 'aa'}) is not ${opened[0].urn}'s (${first.target.name}, ${first.target.sequence.length}): score sets open together when they measure one target.`);
    }
    const { target: recordsTarget, origin: targetOrigin, notes: targetNotes } = first;
    const names = distinctNames(opened.map((o) => o.record.title));
    for (const [k, o] of opened.entries()) {
      busy.update(0.1 + 0.4 * k / opened.length, `Reading the tables of ${o.urn}`);
      const stem = o.urn.replaceAll(':', '_');
      const scoresFile = await fetchPublic(app, `mavedb/score-sets/${o.urn}/scores`, { as: 'bytes' });
      if (!scoresFile.ok) throw new Error(`${o.urn}: ${scoresFile.message}`);
      o.scores = await readTable(app, `${stem}.scores.csv`, scoresFile.bytes, recordsTarget);
      o.scoresRetrieval = scoresFile.retrieval;
      if (counts && o.record.hasCounts) {
        const countsFile = await fetchPublic(app, `mavedb/score-sets/${o.urn}/counts`, { as: 'bytes' });
        if (!countsFile.ok) throw new Error(`${o.urn}: ${countsFile.message}`);
        // Named by the URN's number: the joined table names each record's columns so.
        o.counts = await readTable(app, `${joinedPrefix(o.urn)}.csv`, countsFile.bytes, recordsTarget);
        o.countsRetrieval = countsFile.retrieval;
      }
    }
    const notes = [...targetNotes];
    const joinCounts = counts && opened.every((o) => o.counts);
    if (counts && !joinCounts && opened.some((o) => o.counts)) notes.push(`${opened.filter((o) => !o.counts).map((o) => o.urn).join(', ')} ${opened.filter((o) => !o.counts).length > 1 ? 'have' : 'has'} no counts: the scores alone, and no counts joined.`);

    await app.saveNow();
    let ws = createWorkspace(example?.title ?? opened.map((o) => o.record.title).join('; '));
    const added = addTarget(ws, targetOrigin ? { ...recordsTarget, origin: targetOrigin } : recordsTarget);
    ws = added.ws;
    const target = ws.targets.find((t) => t.id === added.id);
    ws = change(ws, { records: opened.map((o) => recordSummary(o.record, o.retrieval)) }, 'mavedb', `Opened ${named} from MaveDB together: ${opened.map((o, k) => `"${o.record.title}" (${o.record.license.short}; ${retrievalText(o.retrieval) || 'retrieved now'}${k === 0 ? '; the reference' : ''})`).join(', ')}`);
    const originOf = (o, file, retrieval) => ({ database: 'MaveDB', urn: o.urn, file, url: retrieval?.source ?? null, retrieved: retrieval?.retrieved ?? null, license: o.record.license.short, hasCounts: o.record.hasCounts, rawReads: o.record.experiment.rawReads.map((r) => r.id) });
    // Each record's published scores, read as published: a run each.
    const published = [];
    for (const [k, o] of opened.entries()) {
      busy.update(0.5 + 0.2 * k / opened.length, `Reading the scores of ${o.urn} as published`);
      const added2 = addSource(ws, sourceOf(o.scores, { name: `${o.record.title}: scores (MaveDB)`, target: target.id, origin: originOf(o, 'scores', o.scoresRetrieval) }));
      const design = scoresDesign(o.record, { table: o.scores.table, layout: o.scores.layout, target });
      if (example?.readout) design.readout = { ...(design.readout ?? {}), ...example.readout };
      ws = setDesign(added2.ws, design, `The published scores of ${o.urn}, read as published`, added2.id);
      const source = ws.sources.find((s) => s.id === added2.id);
      const input = workerInput(o.scores.table, ws.design);
      const parameters = defaultParameters(ws.design, source);
      const result = await runScore(app, { names: input.names, barcodes: input.barcodes, columns: input.columns, design: ws.design, parameters, mode: 'lenient' }, { transfer: input.transfer }).promise;
      if (!result.ok) {
        notes.push(`${o.urn}'s scores could not be read: ${result.errors.join(' ')}`);
        continue;
      }
      const run = makeRun({ inputs: runInputs({ source, design: ws.design, parameters }), source, results: result.results, software: { version: app.version, commit: app.commit }, name: `Published scores (${names[k]})` });
      ws = addRun(ws, run).ws;
      app.runResults ??= new Map();
      app.runResults.set(run.id, { results: result.results, status: 'computed' });
      published.push({ urn: o.urn, run: run.name, scored: run.output.conditions[0].scored, variants: o.scores.table.rows });
    }
    // Their counts, joined: one table, a condition each.
    let joined = null;
    let draft = null;
    let countsId = null;
    if (joinCounts) {
      busy.update(0.75, 'Joining the counts');
      const level = opened[0].counts.layout.level;
      const assembled = assembleTable(opened.map((o) => ({ name: o.counts.name, table: o.counts.table, role: 'counts' })), { absentMeans: 'missing', level, target: recordsTarget });
      if (!assembled.table) throw new Error(`The counts could not be joined: ${assembled.problems.map((x) => x.message).join(' ')}`);
      joined = assembled.table;
      const layout = detectLayout(joined);
      const countColumns = joined.columns.slice(1).filter((c) => c.type === 'number').map((c) => c.name);
      const review = reviewImport(joined, { variantColumn: joined.columns[0].name, level, countColumns, target: recordsTarget, mode: 'lenient' });
      const source = {
        name: `${opened.map((o, k) => names[k]).join(' and ')}: counts joined (MaveDB)`,
        fileName: opened[0].counts.name,
        sha256: opened[0].counts.stored.sha256,
        size: opened[0].counts.stored.size,
        files: opened.map((o) => ({ fileName: o.counts.name, sha256: o.counts.stored.sha256, size: o.counts.stored.size })),
        rows: joined.rows,
        columns: joined.columns.map((c) => ({ name: c.name, type: c.type, missing: c.missing })),
        encoding: 'utf-8',
        delimiter: joined.delimiter ?? ',',
        lineEnd: joined.lineEnd ?? '\n',
        layout: layout.layout,
        mapping: { variantColumn: joined.columns[0].name, level, mode: 'lenient', absentMeans: 'missing', countColumns, scoreColumns: {} },
        target: target.id,
        roleSuggestions: suggestRoles(countColumns).filter((r) => r.role),
        summary: review.summary,
        problems: { blocking: review.blocking.map((x) => x.message), warnings: [...review.warnings, ...assembled.problems.filter((x) => x.level === 'warning')].map((x) => x.message) },
        imported: now(),
        // The counts of several records: each named, none the table's alone.
        origin: { database: 'MaveDB', urn: null, urns: opened.map((o) => o.urn), file: 'counts', joined: true, url: null, retrieved: opened[0].countsRetrieval?.retrieved ?? null, license: [...new Set(opened.map((o) => o.record.license.short))].join(', '), hasCounts: true, rawReads: [...new Set(opened.flatMap((o) => o.record.experiment.rawReads.map((r) => r.id)))] },
      };
      const added3 = addSource(ws, source);
      countsId = added3.id;
      draft = countsDesignTogether(opened.map((o) => ({ record: o.record, table: o.counts.table, layout: o.counts.layout })), { joined, target });
      if (draft.problem) {
        notes.push(draft.problem);
        ws = added3.ws;
      } else {
        ws = setDesign(added3.ws, draft.design, `A design drafted from the column names of ${named}'s counts, joined: a condition each, ${names[0]} the reference`, countsId);
      }
    }
    // An example's tables are the ones it was made with, or the guide's numbers may not hold.
    const pinned = example ? exampleRecords(example) : [];
    const changed = pinned.some((x) => {
      const o = opened.find((y) => y.urn === x.urn);
      return o && ((x.scores?.sha256 && o.scores.stored.sha256 !== x.scores.sha256) || (x.counts?.sha256 && o.counts && o.counts.stored.sha256 !== x.counts.sha256));
    });
    if (example) ws = change(ws, { example: { id: example.id, simulated: false } }, 'example', `Opened the example "${example.title}" (${example.source}, ${example.license})${changed ? '; MaveDB\'s tables have changed since the example was made' : ''}`);
    if (prepare) ws = await prepare(ws, { counts: countsId ? { id: countsId, table: joined } : null, busy });
    await app.loadWorkspace(ws);
    for (const o of opened) {
      const source = ws.sources.find((x) => x.origin?.urn === o.urn && x.origin.file === 'scores');
      if (source) app.tables.set(source.id, { table: o.scores.table, review: o.scores.review });
    }
    if (countsId) app.tables.set(countsId, { table: joined, review: null });
    app.store.markSaved(null);
    await app.saveNow();
    await app.setMode(published.length ? 'map' : 'experiment');
    const message = [
      `Opened ${named} from MaveDB together: ${opened.map((o, k) => `"${o.record.title}" (${o.record.license.short})${k === 0 ? ', the reference' : ''}`).join('; ')}.`,
      targetOrigin ? `Their target, ${target.name}, is the transcript ${targetOrigin.accession} (${targetOrigin.service ?? targetOrigin.format}).` : '',
      published.length ? `Their published scores are on the map, a run each (${published.map((x) => `"${x.run}": ${exact(x.scored)} of ${exact(x.variants)} variants`).join('; ')}).` : '',
      joined ? `Their counts are joined into one table (${exact(joined.rows)} variants, ${plural(joined.columns.length - 1, 'column')})${prepare ? ', with the example\'s design, scored (Run 1)' : draft?.design ? `, with a design drafted from their names, a condition each (${names.join(' and ')}): check it in Experiment, then score to compare them` : ''}.` : '',
      ...notes,
      changed ? 'MaveDB\'s tables have changed since the example was made: what its guide expects may not hold.' : '',
    ].filter(Boolean).join(' ');
    busy.done(`Opened ${named} from MaveDB.`);
    return { ok: true, message, data: { urns, titles: opened.map((o) => o.record.title), conditions: draft?.design?.conditions?.map((c) => c.name) ?? null, target: { name: target.name }, published, counts: joined ? { rows: joined.rows, columns: joined.columns.length - 1, design: draft?.design?.model ?? null } : null, warnings: notes } };
  } catch (error) {
    busy.fail(`${named} could not be opened: ${error.message}`);
    return { ok: false, message: `${named} could not be opened: ${error.message}` };
  }
}

// The records an example opened from MaveDB is made of, with the checksums their tables had:
// [{ urn, scores, counts }] (one, or several opened together).
export const exampleRecords = (example) => (example?.mavedb?.records ?? (example?.mavedb ? [example.mavedb] : []));

// Opens a MaveDB package (wave 3, slice 4): experiment.json, score_set.json, scores.csv and
// counts.csv, as MaveScape writes one (lib/mavedb-export.js) or as one is written for MaveDB's API,
// from a folder or a ZIP. It is read as a record from MaveDB is: its published scores as published,
// its counts with a design drafted from their column names, and the MaveDB details it states kept
// with the workspace (ws.deposit), so that a deposit of its published scores says the same again.
// Its target is its own sequence, or the transcript it names (fetched). files: Map(name → bytes).
// Returns { ok, message, data }.
export async function importMaveDBPackage(app, { name, files }) {
  const busy = progressToast(`Opening the MaveDB package ${name}…`);
  try {
    const texts = new Map([...files].map(([file, bytes]) => [file, /\.json$/.test(file) ? new TextDecoder().decode(bytes) : '']));
    const { record, details, problems } = readDeposit(texts, { name });
    if (!record || problems.length) throw new Error(problems.join(' '));
    const { target: recordsTarget, origin: targetOrigin, notes: targetNotes } = await recordTarget(app, record, null, busy);
    busy.update(0.15, 'Reading the scores');
    const scores = await readTable(app, `${name}/scores.csv`, files.get('scores.csv'), recordsTarget);
    const countsPart = files.has('counts.csv') ? await readTable(app, `${name}/counts.csv`, files.get('counts.csv'), recordsTarget) : null;
    const origin = (file) => ({ database: 'package', package: name, file, license: record.license.short });
    const { ws, target, published, result, draft } = await openRecordWorkspace(app, {
      record, retrieval: null, recordsTarget, targetOrigin, scores, countsPart, origin, deposit: details, busy,
      label: 'MaveDB package', named: name,
      history: ['mavedb', `Opened the MaveDB package ${name}: "${record.title}" (${record.license.short})`],
    });
    const scored = published ? published.output.conditions[0].scored : 0;
    const message = [
      `Opened the MaveDB package ${name}: "${record.title}" (${record.license.short}).`,
      targetOrigin ? `Its target, ${target.name}, is the transcript ${targetOrigin.accession} (${targetOrigin.service ?? targetOrigin.format}).` : '',
      ...targetNotes,
      published ? `Its scores are on the map, read as published: ${exact(scored)} of ${exact(scores.table.rows)} variants have one.` : `Its scores could not be read: ${result.errors.join(' ')}`,
      countsPart ? `Its counts have a design drafted from their column names (${{ 'two-population': 'two populations', 'time-series': 'a time series', bins: 'sorted bins' }[draft.design.model] ?? draft.design.model}).` : '',
      `Its MaveDB details are kept: a deposit of "${published?.name ?? 'Published scores'}" says them again (Record, MaveDB).`,
    ].filter(Boolean).join(' ');
    busy.done(`Opened ${name}.`);
    return { ok: true, message, data: { package: name, title: record.title, license: record.license.short, target: { name: target.name, ...(targetOrigin ? { accession: targetOrigin.accession } : {}) }, published: published ? { run: published.name, scored, variants: scores.table.rows } : null, counts: countsPart ? { columns: countsPart.layout.countColumns.length, design: draft.design.model } : null, design: ws.design?.model ?? null } };
  } catch (error) {
    busy.fail(`${name} could not be opened: ${error.message}`);
    return { ok: false, message: `${name} could not be opened: ${error.message}` };
  }
}

// The MaveDB packages among opened files: a folder (or the files opened together) holding
// score_set.json and scores.csv. Returns { packages: [{ name, items }], rest }.
export function findPackages(items) {
  const groups = new Map();
  for (const item of items) {
    const key = item.folder ?? '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const packages = [];
  const taken = new Set();
  for (const [folder, group] of groups) {
    const names = new Set(group.map((x) => x.name));
    if (!names.has('score_set.json') || !names.has('scores.csv')) continue;
    const parts = group.filter((x) => ['experiment.json', 'score_set.json', 'scores.csv', 'counts.csv', 'score_columns.json', 'count_columns.json', 'README.md', 'mavescape.json'].includes(x.name));
    for (const x of parts) taken.add(x);
    packages.push({ name: folder || 'MaveDB package', items: parts });
  }
  return { packages, rest: items.filter((x) => !taken.has(x)) };
}

// Opens .zip files: a MaveDB package (score_set.json and scores.csv inside), else says what a .zip
// MaveScape opens is.
export async function openZips(app, items) {
  for (const item of items) {
    const bytes = await app.readBytes(item);
    const files = isZip(bytes) ? await readZip(bytes) : null;
    const flat = files ? new Map([...files].map(([path, data]) => [path.split('/').pop(), data])) : null;
    if (!flat?.has('score_set.json') || !flat.has('scores.csv')) throw new Error(`${item.name}: MaveScape opens a .zip that is a MaveDB package (score_set.json and scores.csv inside); a workspace is a .msz.`);
    const result = await importMaveDBPackage(app, { name: item.name.replace(/\.zip$/i, ''), files: flat });
    app.log(result.message);
    if (!result.ok) throw new Error(result.message);
  }
}

// --- The record --------------------------------------------------------------------------------

const range = (r) => {
  if (!r) return '';
  const [low, high] = r;
  const g = (x) => String(Number(x.toPrecision(3)));
  if (low === null && high === null) return 'any score';
  if (low === null) return `below ${g(high)}`;
  if (high === null) return `above ${g(low)}`;
  return `${g(low)} to ${g(high)}`;
};

// A published calibration: its classes and ranges, and the evidence strength each assigns (research
// use: MaveScape classifies no variant).
export function calibrationView(c) {
  return h('div.calibration',
    h('div.calibration-head', h('b', c.title), c.researchUseOnly ? h('span.badge.warn', 'research use only') : null, c.investigatorProvided ? h('span.badge', 'by the investigators') : null, c.primary ? h('span.badge.accent', 'primary') : null),
    h('div.table-scroll', h('table.data.compact', h('thead', h('tr', h('th', 'Class'), h('th', 'Functional class'), h('th', 'Scores'), h('th', 'Evidence strength (research use)'), h('th.r', 'Variants'))),
      h('tbody', ...c.classes.map((k) => h('tr', h('td', k.label), h('td', k.className), h('td', k.byClassColumn ? 'by the record\'s class column' : range(k.range)), h('td', k.evidence ? `${k.evidence.criterion ?? ''} ${k.evidence.strength ?? ''}`.trim() : ''), h('td.r', k.variants === null ? '' : formatCount(k.variants))))))));
}

// A record as MaveScape reads it: what it is, its license and terms, its target, what it holds,
// the assay in MaveDB's terms, and its calibrations.
export function recordView(record, { retrieval = null } = {}) {
  const { targets, pending, choices, problems } = targetsOf(record);
  const t = record.targets[0];
  const fetched = pending[0] ? `the ${pending[0].kind === 'refseq' ? 'RefSeq' : 'Ensembl'} transcript ${pending[0].accession}${pending[0].assembly ? ` (${pending[0].assembly})` : ''}, fetched from ${pending[0].kind === 'refseq' ? 'NCBI' : 'Ensembl'} when it is opened${pending[0].protein ? `; its protein ${pending[0].protein}` : ''}` : null;
  const keyword = (key) => record.keywords.find((k) => k.key === key)?.label;
  const assay = [['Method', 'Phenotypic Assay Method'], ['Detects', 'Phenotypic Assay Mechanism'], ['Model system', 'Phenotypic Assay Model System'], ['Library', 'In Vitro Construct Library Method System'], ['Mechanism assessed', 'Molecular Mechanism Assessed']].filter(([, key]) => keyword(key));
  return h('div.record-view',
    h('div.entry-card',
      h('div', h('b', record.title), h(`span.badge${record.license.open ? '' : '.warn'}`, record.license.short)),
      h('div.muted', [record.urn, record.variants !== null ? plural(record.variants, 'variant') : null, record.published ? `published ${record.published}` : null].filter(Boolean).join(' · ')),
      record.shortDescription ? h('div', record.shortDescription) : null),
    record.license.open ? h('p.muted.small', record.license.terms) : h('div.callout.warn', icon('warning'), h('span', `${record.license.long}. ${record.license.terms}`)),
    record.citation ? h('p.small', h('b', 'Cite: '), record.citation) : null,
    retrieval ? h('p.muted.small', `Record ${retrievalText(retrieval) || 'retrieved now'}${retrieval.cache === 'hit' ? ', from MaveScape\'s cache' : ''}.`) : null,
    h('div.section-title', choices.length ? `Targets (${choices.length})` : 'Target'),
    choices.length ? h('p.small', `${choices.map((c) => c.label).join(', ')}. Each variant is named with its target's label (${choices[0].label}:…); MaveScape opens one target at a time, the others' variants set aside.`)
      : t ? h('p.small', [t.name, t.sequence ? `${t.sequenceType === 'dna' ? 'DNA' : 'protein'}, ${formatCount(t.sequence.length)} ${t.sequenceType === 'dna' ? 'nt' : 'aa'}` : fetched ?? (t.accession ? `named by ${t.accession.accession}` : null), t.organism, ...t.identifiers.map((x) => `${x.db} ${x.id}${x.offset ? ` (offset ${x.offset})` : ''}`)].filter(Boolean).join(' · ')) : h('p.small.muted', 'No target.'),
    ...problems.map((p) => h(`div.callout.${targets.length || pending.length ? 'warn' : 'danger'}`, icon('warning'), h('span', p))),
    h('div.section-title', 'What it holds'),
    h('ul.summary-lines',
      h('li', `Scores: ${record.scoreColumns.slice(0, 6).join(', ')}${record.scoreColumns.length > 6 ? `, and ${record.scoreColumns.length - 6} more columns` : ''}.`),
      h('li', record.hasCounts ? `Counts: ${plural(record.countColumns.length, 'column')} (${record.countColumns.slice(0, 3).join(', ')}${record.countColumns.length > 3 ? ', …' : ''}), which MaveScape can score again with a design.` : 'No counts: the scores alone, for the map and for comparison. The readiness says where counts may be found.'),
      record.experiment.rawReads.length ? h('li', `Raw reads: ${record.experiment.rawReads.map((r) => r.id).join(', ')}.`) : null,
      record.mapping === 'complete' || record.mapping === 'incomplete' ? h('li', `Mapped by MaveDB to the human reference${record.mapping === 'incomplete' ? ' (in part)' : ''}: each variant's VRS identifier and HGVS on the reference, which MaveScape can keep.`) : null),
    assay.length ? h('div.section-title', 'The assay, in MaveDB\'s terms') : null,
    assay.length ? h('ul.summary-lines', ...assay.map(([label, key]) => h('li', `${label}: ${keyword(key)}`))) : null,
    record.calibrations.length ? h('div.section-title', `Calibrations (${record.calibrations.length})`) : null,
    record.calibrations.length ? h('p.muted.small', 'As published in MaveDB, shown for research: MaveScape reports functional evidence and does not classify variants.') : null,
    ...record.calibrations.map(calibrationView));
}

// --- The dialog --------------------------------------------------------------------------------

// Search MaveDB, preview a record, and open it. query: the words (or URN) to start with.
export function openMaveDBDialog(app, { query = '' } = {}) {
  const state = publicDataState(app);
  const input = h('input.input', { value: query, placeholder: 'A gene, an assay or a URN (urn:mavedb:…)', 'aria-label': 'Search MaveDB, or a score set\'s URN', onkeydown: (e) => { if (e.key === 'Enter') go(1); } });
  const body = h('div.mavedb-body');
  let last = null;
  const show = (...children) => body.replaceChildren(...children.filter(Boolean));
  const dialog = showDialog({
    title: 'Open from MaveDB',
    width: 'wide',
    content: [
      h('div.search-row', input, h('button.btn.primary', { type: 'button', onclick: () => go(1) }, icon('search'), 'Search')),
      h('p.muted.small', state === 'offline' ? 'Offline: only searches and records already in MaveScape\'s cache.' : 'MaveScape asks MaveDB (api.mavedb.org) for its published score sets: the words you search for are sent, nothing else. Several URNs open together, a condition each.'),
      body,
    ],
    buttons: [{ label: 'Close' }],
  });

  async function go(page) {
    const text = input.value.trim();
    if (!text) return;
    const urns = normalizeUrns(text);
    if (urns.length > 1) {
      previewTogether(urns);
      return;
    }
    const urn = normalizeUrn(text);
    if (urn) {
      preview(urn);
      return;
    }
    show(h('p.muted', `Searching MaveDB for "${text}"…`));
    const got = await fetchPublic(app, `mavedb/search?text=${encodeURIComponent(text)}&page=${page}`);
    if (!got.ok) {
      show(h('div.callout.danger', icon('warning'), h('span', got.message)));
      return;
    }
    last = { text, page, ...searchHits(got.json) };
    results();
  }

  function results() {
    const { text, page, total, hits } = last;
    const more = total > page * 100;
    show(
      h('p.small', total ? `${plural(total, 'published score set')} match "${text}"${total > 100 ? ` (${(page - 1) * 100 + 1}–${(page - 1) * 100 + hits.length} shown)` : ''}.` : `No published score set matches "${text}".`),
      h('ul.mavedb-results', ...hits.map((hit) => h('li',
        h('button.mavedb-hit', { type: 'button', onclick: () => preview(hit.urn) },
          h('div', h('b', hit.title), hit.license ? h(`span.badge${['CC0', 'CC BY 4.0', 'CC BY-SA 4.0'].includes(hit.license) ? '' : '.warn'}`, hit.license) : null),
          h('div.muted.small', [hit.urn, hit.targets.join(', '), hit.organism, hit.variants !== null ? plural(hit.variants, 'variant') : null, hit.published, hit.accessionTarget ? 'target named by an accession' : null].filter(Boolean).join(' · ')),
          hit.publication ? h('div.muted.small', hit.publication) : null)))),
      h('div.btn-row',
        page > 1 ? h('button.btn.small', { type: 'button', onclick: () => go(page - 1) }, 'Previous 100') : null,
        more ? h('button.btn.small', { type: 'button', onclick: () => go(page + 1) }, 'Next 100') : null));
  }

  async function preview(urn) {
    show(h('p.muted', `Reading ${urn}…`));
    const got = await fetchPublic(app, `mavedb/score-sets/${urn}`);
    if (!got.ok) {
      show(h('div.callout.danger', icon('warning'), h('span', got.message)), last ? h('button.btn.small', { type: 'button', onclick: results }, 'Back to the results') : null);
      return;
    }
    const record = readScoreSet(got.json);
    if (record.problem) {
      show(h('div.callout.danger', icon('warning'), h('span', record.problem)));
      return;
    }
    const read = targetsOf(record);
    const readable = read.targets.length === 1 || read.pending.length === 1 || read.choices.length > 0;
    const withCounts = h('input', { type: 'checkbox', checked: record.hasCounts, disabled: !record.hasCounts });
    const mappable = record.mapping === 'complete' || record.mapping === 'incomplete';
    const withMapped = h('input', { type: 'checkbox', checked: false, disabled: !mappable });
    const which = read.choices.length ? h('select.input.small', { 'aria-label': 'The target to open' }, ...read.choices.map((c) => h('option', { value: c.label }, c.label === c.name ? c.label : `${c.name} (${c.label})`))) : null;
    show(
      last ? h('button.btn.small.ghost', { type: 'button', onclick: results }, '← Back to the results') : null,
      h('div.btn-row.open-row',
        h('div.open-options',
          h('label.check', withCounts, record.hasCounts ? ' Open its counts too, with a design drafted from their names' : ' No counts to open'),
          mappable ? h('label.check', withMapped, ' Keep MaveDB\'s mapping to the human reference (VRS identifiers)') : null,
          which ? h('label.check', 'Target: ', which) : null),
        h('span.spacer'),
        h('button.btn.primary', { type: 'button', disabled: !readable, title: readable ? `Open ${urn} as a new workspace` : 'MaveScape cannot read this record\'s target', onclick: async () => {
          dialog.close();
          const opened = await importMaveDB(app, urn, { counts: withCounts.checked, mapped: withMapped.checked, target: which?.value ?? null });
          if (!opened.ok) toast(opened.message, { kind: 'error' });
        } }, icon('download'), 'Open as a new workspace')),
      recordView(record, { retrieval: got.retrieval }));
  }

  // Several score sets (wave 3, slice 6): each record in brief, whether they share a target, and
  // their opening together, a condition each.
  async function previewTogether(urns) {
    show(h('p.muted', `Reading ${urns.join(', ')}…`));
    const records = [];
    for (const urn of urns) {
      const got = await fetchPublic(app, `mavedb/score-sets/${urn}`);
      if (!got.ok) {
        show(h('div.callout.danger', icon('warning'), h('span', `${urn}: ${got.message}`)));
        return;
      }
      const record = readScoreSet(got.json);
      if (record.problem) {
        show(h('div.callout.danger', icon('warning'), h('span', `${urn}: ${record.problem}`)));
        return;
      }
      records.push(record);
    }
    const sequences = records.map((r) => targetsOf(r).targets[0]?.sequence ?? targetsOf(r).pending[0]?.accession ?? null);
    const same = sequences.every((x) => x && x === sequences[0]);
    const allCounts = records.every((r) => r.hasCounts);
    const names = distinctNames(records.map((r) => r.title));
    const withCounts = h('input', { type: 'checkbox', checked: allCounts, disabled: !allCounts });
    show(
      h('div.btn-row.open-row',
        h('div.open-options',
          h('label.check', withCounts, allCounts ? ' Join their counts into one table, a condition each, with a design drafted from their names' : ' Not all of them have counts: their scores alone')),
        h('span.spacer'),
        h('button.btn.primary', { type: 'button', disabled: !same, title: same ? `Open ${urns.join(' and ')} as one workspace` : 'They do not measure one target', onclick: async () => {
          dialog.close();
          const opened = await importMaveDB(app, urns.join(' '), { counts: withCounts.checked });
          if (!opened.ok) toast(opened.message, { kind: 'error' });
        } }, icon('download'), 'Open together')),
      same ? h('p.small', `One target; ${records.length} conditions, ${names[0]} the reference (the first given): the map compares each with it.`) : h('div.callout.warn', icon('warning'), h('span', 'These score sets do not measure one target: open them apart.')),
      ...records.map((r, k) => h('div.entry-card',
        h('div', h('b', r.title), h(`span.badge${r.license.open ? '' : '.warn'}`, r.license.short), h('span.badge', `condition: ${names[k]}`)),
        h('div.muted', [r.urn, r.variants !== null ? plural(r.variants, 'variant') : null, r.hasCounts ? 'counts' : 'no counts', r.published ? `published ${r.published}` : null].filter(Boolean).join(' · ')),
        r.shortDescription ? h('div.small', r.shortDescription) : null)));
  }

  if (query) go(1);
  return dialog;
}
