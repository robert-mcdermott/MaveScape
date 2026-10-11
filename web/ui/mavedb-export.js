// The MaveDB deposit in the window (wave 3, slice 4; requirements I2, M2): a run written as MaveDB
// takes a score set (lib/mavedb-export.js), with what MaveDB requires that the workspace does not
// hold. The dialog shows what the deposit will say and lacks, takes the MaveDB details (kept with
// the workspace, ws.deposit, in its history) and downloads the package as one ZIP. Nothing is sent:
// the researcher uploads it on mavedb.org or through MaveDB's API.

import { h, icon, downloadBlob } from './dom.js';
import { progressToast, showDialog } from './overlays.js';
import { DETAIL_NAMES, MAVEDB_LICENSES, TARGET_CATEGORIES, depositDetails, depositZip, mavedbDeposit, readPublication } from '../lib/mavedb-export.js';
import { DESIGN_KEYWORDS, MAVEDB_KEYWORDS } from '../lib/readout.js';
import { setDeposit } from '../lib/workspace.js';
import { ensureResults } from './run-results.js';
import { methodsOf } from './record.js';

const safe = (s) => String(s).replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'export';
const exact = (n) => n.toLocaleString('en-US');

// The tables a run of published scores passes through: its own, and the counts of the same record
// (a MaveDB score set's, or a MaveDB package's) when they are in the workspace.
async function publishedTables(app, run) {
  const ws = app.store.ws;
  const source = ws.sources.find((s) => s.sha256 === run.inputs.source.sha256);
  if (!source) return { scores: null, counts: null };
  const o = source.origin;
  const counts = o ? ws.sources.find((s) => s !== source && s.origin?.file === 'counts' && ((o.urn && s.origin.urn === o.urn) || (o.package && s.origin.package === o.package))) : null;
  return { scores: await app.sourceTable(source), counts: counts ? await app.sourceTable(counts) : null };
}

// The deposit of one condition of a run, made (not downloaded): { files, report }. Throws when it
// cannot be made.
export async function runDeposit(app, run, condition = 0) {
  const entry = await ensureResults(app, run);
  if (!entry?.results) throw new Error(`${run.name}'s scores could not be recomputed: ${entry?.message ?? 'unknown'}`);
  const published = run.inputs.design.model === 'scores';
  const methods = published ? null : await methodsOf(app, run);
  const tables = published ? await publishedTables(app, run) : {};
  const out = mavedbDeposit({ ws: app.store.ws, run, results: entry.results, condition, methods, tables, software: { version: app.version } });
  if (out.problem) throw new Error(out.problem);
  return out;
}

// The deposit as its ZIP: { name, bytes, deposit }, dated with the workspace's modification time.
export async function depositFile(app, run, condition = 0) {
  const deposit = await runDeposit(app, run, condition);
  const ws = app.store.ws;
  const several = run.output.conditions.length > 1;
  const bytes = await depositZip(deposit, { date: new Date(ws.modified) });
  return { name: `${safe(ws.name)}_${safe(run.name)}${several ? `_${safe(deposit.report.condition)}` : ''}_mavedb.zip`, bytes, deposit };
}

// The report in words: what is ready, what to give, what was chosen, what was left out.
export function reportView(report) {
  const t = report.target;
  const target = t.targetAccession
    ? `Named by the transcript ${t.targetAccession.accession} (gene ${t.targetAccession.gene}); each variant prefixed by it.`
    : `Given by its sequence: ${t.targetSequence.sequenceType === 'dna' ? 'DNA' : 'protein'}, ${exact(t.targetSequence.sequence.length)} ${t.targetSequence.sequenceType === 'dna' ? 'nt' : 'residues'}${t.targetSequence.taxonomy.code ? `, NCBI Taxonomy ${t.targetSequence.taxonomy.code}` : ''}; ${TARGET_CATEGORIES[t.category]}.`;
  const left = report.variants.leftOut.reduce((a, x) => a + x.count, 0);
  return h('div.deposit-report',
    report.missing.length
      ? h('div.callout.warn', icon('warning'), h('div', h('b', 'To give before depositing'), h('ul', ...report.missing.map((m) => h('li', m.text)))))
      : h('div.callout.ok', icon('check'), h('span', 'MaveDB has everything it requires: the tables, the experiment and the score set.')),
    h('dl.deposit-facts',
      h('dt', 'Variants'), h('dd', `${exact(report.variants.exported)} of ${exact(report.variants.of)}${left ? ` (${exact(left)} left out: ${report.variants.leftOut.map((x) => `${exact(x.count)} ${x.reason}`).join('; ')})` : ''}; ${exact(report.scored)} scored.`),
      h('dt', 'Target'), h('dd', target),
      h('dt', 'Scores'), h('dd', report.columns.scores.join(', ')),
      h('dt', 'Counts'), h('dd', report.columns.counts.length ? report.columns.counts.join(', ') : 'none'),
      h('dt', 'Keywords'), h('dd', report.keywords.length ? report.keywords.map((k) => `${k.key}: ${k.label}${k.description ? ` (${k.description})` : ''}`).join('; ') : 'none (the design states no readout)')),
    report.defaulted.length ? h('div', h('b.small', 'Chosen for you, to confirm'), h('ul.small', ...report.defaulted.map((d) => h('li', `${DETAIL_NAMES[d.field] ?? d.field}: ${d.text}`)))) : null,
    report.notes.length ? h('details.small', h('summary', `Notes (${report.notes.length})`), h('ul', ...report.notes.map((n) => h('li', n)))) : null);
}

const lines = (text) => String(text).split(/\n|;/).map((x) => x.trim()).filter(Boolean);

// The dialog: the run (and condition) to deposit, the report, the MaveDB details, the download.
export function openDepositDialog(app, run, condition = 0) {
  const ws0 = app.store.ws;
  const runs = ws0.runs;
  let current = run;
  let cond = condition;
  const runSelect = h('select.input.small', { 'aria-label': 'The run to deposit', onchange: () => { current = runs.find((r) => r.id === runSelect.value); cond = 0; conditions(); refresh(); } },
    ...runs.map((r) => h('option', { value: r.id, selected: r.id === run.id }, r.name)));
  const condSelect = h('select.input.small', { 'aria-label': 'The condition', onchange: () => { cond = Number(condSelect.value); refresh(); } });
  const conditions = () => {
    const list = current.output.conditions;
    condSelect.replaceChildren(...list.map((c, k) => h('option', { value: k, selected: k === cond }, c.name)));
    condSelect.hidden = list.length < 2;
  };
  conditions();

  // The details: as stated, else the defaults depositDetails gives (shown as placeholders).
  const given = ws0.deposit ?? {};
  const shown = depositDetails(ws0, run).details;
  const field = (label, control, hint) => h('label.field', h('span', label), control, hint ? h('span.muted.small', hint) : null);
  const text = (key, placeholder) => h('input.input', { value: given[key] ?? '', placeholder: placeholder ?? shown[key] ?? '' });
  const area = (key, rows, placeholder) => h('textarea.input', { rows, placeholder: placeholder ?? '' }, given[key] ?? '');
  let licenseChosen = Boolean(given.license);
  const f = {
    title: text('title'),
    shortDescription: text('shortDescription'),
    abstract: area('abstract', 4, shown.abstract ?? 'The study, or a paragraph on these data (MaveDB requires one).'),
    method: area('method', 3, run.inputs.design.model === 'scores' ? (shown.method ? 'The record\'s method text.' : 'How the published scores were made.') : 'Optional: what MaveScape\'s methods do not say (they follow).'),
    // Shown as the default until chosen: stored only once chosen.
    license: h('select.input', { onchange: () => { licenseChosen = true; } }, ...MAVEDB_LICENSES.map((l) => h('option', { value: l.short, selected: l.short === (given.license ?? shown.license) }, l.short))),
    publications: h('textarea.input', { rows: 2, placeholder: 'PubMed 29785012, or a DOI; the first is the primary publication. One per line.' }),
    rawReads: h('input.input', { placeholder: 'SRA, BioProject or GEO accessions, separated by ;' }),
    contributors: h('input.input', { placeholder: 'ORCID iDs, separated by ;' }),
    experimentUrn: text('experimentUrn', 'urn:mavedb:… (an experiment of yours on MaveDB); empty: a new experiment'),
    supersedes: text('supersedes', 'urn:mavedb:… (a score set of yours this replaces)'),
    taxonomyId: h('input.input', { type: 'number', min: 1, step: 1, value: given.taxonomyId ?? '', placeholder: 'From the target (9606 for Homo sapiens)' }),
    category: h('select.input', h('option', { value: '' }, 'protein-coding (default)'), ...Object.entries(TARGET_CATEGORIES).map(([k, v]) => h('option', { value: k, selected: k === given.category }, v))),
  };
  f.publications.value = (given.publications ?? []).map((p) => `${p.db ?? ''} ${p.id}`.trim()).join('\n');
  f.rawReads.value = (given.rawReads ?? []).join('; ');
  f.contributors.value = (given.contributors ?? []).join('; ');
  // The MAVE minimum information's other keywords (the design's are its readout and library).
  const keywordFields = Object.keys(MAVEDB_KEYWORDS).filter((key) => !DESIGN_KEYWORDS[key]).map((key) => {
    const now = (given.keywords ?? []).find((k) => k.key === key);
    const select = h('select.input.small', { 'aria-label': key, onchange: () => { other.hidden = select.value !== 'Other'; } }, h('option', { value: '' }, '—'), ...MAVEDB_KEYWORDS[key].map((label) => h('option', { value: label, selected: label === now?.label }, label)));
    const other = h('input.input.small', { placeholder: 'What it is', value: now?.description ?? '', hidden: now?.label !== 'Other' });
    return { key, select, other, row: h('div.keyword-row', h('span.small', key), select, other) };
  });

  const read = () => ({
    title: f.title.value.trim(),
    shortDescription: f.shortDescription.value.trim(),
    abstract: f.abstract.value.trim(),
    method: f.method.value.trim(),
    license: licenseChosen ? f.license.value : null,
    publications: lines(f.publications.value.replace(/;/g, '\n')).map(readPublication),
    rawReads: lines(f.rawReads.value),
    contributors: lines(f.contributors.value),
    experimentUrn: f.experimentUrn.value.trim(),
    supersedes: f.supersedes.value.trim(),
    taxonomyId: f.taxonomyId.value ? Number(f.taxonomyId.value) : null,
    category: f.category.value || null,
    keywords: keywordFields.filter((k) => k.select.value).map((k) => ({ key: k.key, label: k.select.value, ...(k.select.value === 'Other' ? { description: k.other.value.trim() } : {}) })),
  });
  // The details into the workspace (undoable, in its history), when they changed.
  const save = () => {
    const next = setDeposit(app.store.ws, read());
    if (next !== app.store.ws) app.store.commit(next, 'Change the MaveDB details');
  };

  const report = h('div.deposit-status', h('p.muted', 'Writing the deposit…'));
  let pending = 0;
  async function refresh() {
    const ticket = (pending += 1);
    try {
      const { report: r } = await runDeposit(app, current, cond);
      if (ticket === pending) report.replaceChildren(reportView(r));
    } catch (error) {
      if (ticket === pending) report.replaceChildren(h('div.callout.danger', icon('warning'), h('span', error.message)));
    }
  }

  const dialog = showDialog({
    title: 'Deposit in MaveDB',
    width: 'wide',
    content: [
      h('p.small', 'MaveScape writes the run as MaveDB takes a score set: the scores and counts as its upload reads them, what each column is, and the experiment and score set as its API takes them, the methods as the analysis. Nothing is sent: upload the package on mavedb.org, or through its API.'),
      h('div.btn-row', h('label.check', 'Run: ', runSelect), condSelect),
      report,
      h('h3', 'MaveDB details'),
      h('p.muted.small', 'What MaveDB asks for that the workspace does not hold. Kept with the workspace; empty fields take what is shown in grey.'),
      h('div.form-grid.wide-fields', field('Title', f.title), field('Short description', f.shortDescription), field('License', f.license), field('Target category', f.category), field('Organism (NCBI Taxonomy id)', f.taxonomyId)),
      field('Abstract', f.abstract),
      field(run.inputs.design.model === 'scores' ? 'Method text' : 'A note before the methods', f.method),
      field('Publications', f.publications),
      h('div.form-grid.wide-fields', field('Raw reads', f.rawReads), field('Contributors', f.contributors), field('Experiment on MaveDB', f.experimentUrn), field('Supersedes', f.supersedes)),
      h('details.keywords', h('summary', 'More of the MAVE minimum information (keywords)'), h('p.muted.small', 'The assay\'s method, mechanism and model system, and the library\'s method, are the design\'s (Experiment, "What the assay measures").'), ...keywordFields.map((k) => k.row)),
    ],
    buttons: [
      { label: 'Close', ghost: true },
      { label: 'Save details', onClick: () => { save(); refresh(); return false; } },
      { label: 'Download (.zip)', primary: true, onClick: async () => { save(); await downloadDeposit(app, current, cond); return false; } },
    ],
  });
  dialog.body.addEventListener('change', (event) => {
    if (event.target === runSelect || event.target === condSelect) return;
    save();
    refresh();
  });
  refresh();
  return dialog;
}

export async function downloadDeposit(app, run, condition = 0) {
  const busy = progressToast('Writing the MaveDB deposit…');
  try {
    const { name, bytes, deposit } = await depositFile(app, run, condition);
    downloadBlob(new Blob([bytes], { type: 'application/zip' }), name);
    const missing = deposit.report.missing.length;
    busy.done(`Wrote ${name}: ${exact(deposit.report.variants.exported)} variants${missing ? `; ${missing} thing${missing === 1 ? '' : 's'} MaveDB requires still to give (README.md)` : ', ready for MaveDB'}.`);
  } catch (error) {
    busy.fail(`The MaveDB deposit could not be written: ${error.message}`);
  }
}
