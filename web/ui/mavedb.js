// MaveDB in the window (wave 3, slice 2; requirement I1): search MaveDB's published score sets, read
// a record (its license and terms, citation, target, keywords, columns and calibrations), and open
// it as a workspace: its published scores, read as published, as a run on the map ("Published
// scores"); its counts, when the authors deposited them, with a design drafted from their column
// names to check and score; the record kept with the workspace. Everything comes through the
// MaveScape program's fetcher (public-data.js), cached for offline use.

import { h, icon, formatCount } from './dom.js';
import { progressToast, showDialog, toast } from './overlays.js';
import { fetchPublic, publicDataState } from './public-data.js';
import { storeBytes } from './import.js';
import { runScore, workerInput } from './score-input.js';
import { countsDesign, normalizeUrn, readScoreSet, scoresDesign, searchHits, targetsOf } from '../lib/mavedb.js';
import { detectLayout, reviewImport, suggestRoles } from '../lib/importer.js';
import { addRun, makeRun, runInputs } from '../lib/runs.js';
import { defaultParameters } from '../lib/score.js';
import { addSource, addTarget, change, createWorkspace, setDesign } from '../lib/workspace.js';
import { retrievalText } from '../lib/retrieval.js';
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

// What the workspace keeps of a record (workspace.records): enough to cite, license and describe it
// offline, with its calibrations.
function recordSummary(record, retrieval) {
  const { abstract, ...kept } = record;
  return { database: 'MaveDB', ...kept, retrieved: retrieval?.retrieved ?? null, url: retrieval?.source ?? null };
}

// Opens a published score set as a new workspace. counts: also its counts, when it has them.
// example: a bundled example opened from MaveDB (lib/examples.js): what it states that the record
// does not (its readout), and the checksum its table had when the example was made. Returns
// { ok, message, data }.
export async function importMaveDB(app, text, { counts = true, example = null } = {}) {
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
    const { targets, problems } = targetsOf(record);
    if (targets.length !== 1) throw new Error(problems.join(' ') || 'The record names no target.');
    const stem = urn.replaceAll(':', '_');
    busy.update(0.15, 'Reading the published scores');
    const scoresFile = await fetchPublic(app, `mavedb/score-sets/${urn}/scores`, { as: 'bytes' });
    if (!scoresFile.ok) throw new Error(scoresFile.message);
    const scores = await readTable(app, `${stem}.scores.csv`, scoresFile.bytes, targets[0]);
    let countsPart = null;
    let countsRetrieval = null;
    if (counts && record.hasCounts) {
      busy.update(0.4, 'Reading the counts');
      const countsFile = await fetchPublic(app, `mavedb/score-sets/${urn}/counts`, { as: 'bytes' });
      if (!countsFile.ok) throw new Error(countsFile.message);
      countsPart = await readTable(app, `${stem}.counts.csv`, countsFile.bytes, targets[0]);
      countsRetrieval = countsFile.retrieval;
    }

    await app.saveNow();
    let ws = createWorkspace(record.title);
    const added = addTarget(ws, targets[0]);
    ws = added.ws;
    const target = ws.targets.find((t) => t.id === added.id);
    const origin = (file, retrieval) => ({ database: 'MaveDB', urn, file, url: retrieval?.source ?? null, retrieved: retrieval?.retrieved ?? null, license: record.license.short, hasCounts: record.hasCounts, rawReads: record.experiment.rawReads.map((r) => r.id) });
    ws = change(ws, { records: [...(ws.records ?? []), recordSummary(record, got.retrieval)] }, 'mavedb', `Opened ${urn} from MaveDB: "${record.title}" (${record.license.short}; ${retrievalText(got.retrieval) || 'retrieved now'})`);
    // The published scores, read as published: a run of their own.
    const scoresSource = addSource(ws, sourceOf(scores, { name: `${record.title}: scores (MaveDB)`, target: target.id, origin: origin('scores', scoresFile.retrieval) }));
    const design = scoresDesign(record, { table: scores.table, layout: scores.layout, target });
    if (example?.readout) design.readout = { ...(design.readout ?? {}), ...example.readout };
    ws = setDesign(scoresSource.ws, design, `The published scores of ${urn}, read as published${example?.readout ? ' (the readout\'s direction as the example states it, from the paper)' : ''}`, scoresSource.id);
    // An example's table is the one it was made with, or the guide's numbers may not hold.
    changed = Boolean(example?.mavedb?.scores?.sha256 && scores.stored.sha256 !== example.mavedb.scores.sha256);
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
      const countsSource = addSource(ws, sourceOf(countsPart, { name: `${record.title}: counts (MaveDB)`, target: target.id, origin: origin('counts', countsRetrieval) }));
      countsId = countsSource.id;
      draft = countsDesign(record, { table: countsPart.table, layout: countsPart.layout, target });
      ws = setDesign(countsSource.ws, draft.design, `A design drafted from the column names of ${urn}'s counts`, countsId);
    }
    await app.loadWorkspace(ws);
    app.tables.set(scoresSource.id, { table: scores.table, review: scores.review });
    if (countsPart) app.tables.set(countsId, { table: countsPart.table, review: countsPart.review });
    app.store.markSaved(null);
    await app.saveNow();
    await app.setMode(published ? 'map' : 'experiment');
    const scored = published ? published.output.conditions[0].scored : 0;
    const message = [
      `Opened ${urn} from MaveDB: "${record.title}" (${record.license.short}).`,
      published ? `Its published scores are on the map: ${exact(scored)} of ${exact(scores.table.rows)} variants have one (the run "Published scores", read as published).` : `Its scores could not be read: ${result.errors.join(' ')}`,
      countsPart ? `Its counts (${plural(countsPart.layout.countColumns.length, 'column')}) have a design drafted from their names (${{ 'two-population': 'two populations', 'time-series': 'a time series', bins: 'sorted bins' }[draft.design.model] ?? draft.design.model}): check it in Experiment, then score.` : record.hasCounts ? 'Its counts were not opened.' : 'MaveDB has no counts for it: the readiness says where they may be.',
      record.license.open ? '' : `License: ${record.license.terms}`,
      changed ? 'MaveDB\'s table has changed since the example was made: what its guide expects may not hold.' : '',
    ].filter(Boolean).join(' ');
    busy.done(`Opened ${urn} from MaveDB.`);
    return { ok: true, message, data: { urn, title: record.title, license: record.license, citation: record.citation, published: published ? { run: published.name, scored, variants: scores.table.rows } : null, counts: countsPart ? { columns: countsPart.layout.countColumns.length, design: draft.design.model } : null, calibrations: record.calibrations.length, warnings: problems } };
  } catch (error) {
    busy.fail(`${urn} could not be opened: ${error.message}`);
    return { ok: false, message: `${urn} could not be opened: ${error.message}` };
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
  const { targets, problems } = targetsOf(record);
  const t = record.targets[0];
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
    h('div.section-title', 'Target'),
    t ? h('p.small', [t.name, t.sequence ? `${t.sequenceType === 'dna' ? 'DNA' : 'protein'}, ${formatCount(t.sequence.length)} ${t.sequenceType === 'dna' ? 'nt' : 'aa'}` : t.accession ? `named by ${t.accession.accession}` : null, t.organism, ...t.identifiers.map((x) => `${x.db} ${x.id}${x.offset ? ` (offset ${x.offset})` : ''}`)].filter(Boolean).join(' · ')) : h('p.small.muted', 'No target.'),
    ...problems.map((p) => h(`div.callout.${targets.length ? 'warn' : 'danger'}`, icon('warning'), h('span', p))),
    h('div.section-title', 'What it holds'),
    h('ul.summary-lines',
      h('li', `Scores: ${record.scoreColumns.slice(0, 6).join(', ')}${record.scoreColumns.length > 6 ? `, and ${record.scoreColumns.length - 6} more columns` : ''}.`),
      h('li', record.hasCounts ? `Counts: ${plural(record.countColumns.length, 'column')} (${record.countColumns.slice(0, 3).join(', ')}${record.countColumns.length > 3 ? ', …' : ''}), which MaveScape can score again with a design.` : 'No counts: the scores alone, for the map and for comparison. The readiness says where counts may be found.'),
      record.experiment.rawReads.length ? h('li', `Raw reads: ${record.experiment.rawReads.map((r) => r.id).join(', ')}.`) : null),
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
      h('p.muted.small', state === 'offline' ? 'Offline: only searches and records already in MaveScape\'s cache.' : 'MaveScape asks MaveDB (api.mavedb.org) for its published score sets: the words you search for are sent, nothing else.'),
      body,
    ],
    buttons: [{ label: 'Close' }],
  });

  async function go(page) {
    const text = input.value.trim();
    if (!text) return;
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
    const readable = targetsOf(record).targets.length === 1;
    const withCounts = h('input', { type: 'checkbox', checked: record.hasCounts, disabled: !record.hasCounts });
    show(
      last ? h('button.btn.small.ghost', { type: 'button', onclick: results }, '← Back to the results') : null,
      h('div.btn-row.open-row',
        h('label.check', withCounts, record.hasCounts ? ' Open its counts too, with a design drafted from their names' : ' No counts to open'),
        h('span.spacer'),
        h('button.btn.primary', { type: 'button', disabled: !readable, title: readable ? `Open ${urn} as a new workspace` : 'MaveScape cannot read this record\'s target yet', onclick: async () => {
          dialog.close();
          const opened = await importMaveDB(app, urn, { counts: withCounts.checked });
          if (!opened.ok) toast(opened.message, { kind: 'error' });
        } }, icon('download'), 'Open as a new workspace')),
      recordView(record, { retrieval: got.retrieval }));
  }

  if (query) go(1);
  return dialog;
}
