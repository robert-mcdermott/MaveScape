// The report's validation cases (wave 6, slice 4): each reference against Crossref's record of its
// DOI (validation/fixtures/crossref.json, recorded by fixtures/make-crossref.mjs).

import { readFileSync } from 'node:fs';
import { REFERENCES } from '../web/lib/methods.js';
import { createHash } from 'node:crypto';
import { exampleRun, exampleById } from './compare-cases.mjs';
import { checkTable } from './robustness-cases.mjs';
import { cachedBytes, cachedJSON, exampleTarget, openCached, pdbFile } from './structure-cases.mjs';
import { inputFor, scoreTable } from './roundtrip-cases.mjs';
import { addRun, makeRun, runInputs } from '../web/lib/runs.js';
import { PRESETS } from '../web/lib/score.js';
import { computeQC } from '../web/lib/qc.js';
import { findingsFrom, measuresOf, withDefaultThresholds } from '../web/lib/findings.js';
import { acknowledgeFinding, addAnnotation, addSelection, keepAnalysis, recordTargetCheck, saveFigure, saveStructureView, setQcThresholds } from '../web/lib/workspace.js';
import { placeTarget, placementPatch, readUniProtEntry, referenceOf } from '../web/lib/uniprot.js';
import { buildMapModel } from '../web/lib/map-model.js';
import { queryContext, selectByQuery } from '../web/lib/query.js';
import { compareSides, describeSide } from '../web/lib/compare.js';
import { comparisonRecord, keptWords, robustnessRecord } from '../web/lib/report.js';
import { ROBUSTNESS_SEED } from '../web/lib/robustness.js';
import { mapTarget } from '../web/lib/mapping.js';
import { mappingSummary } from '../web/lib/structure-record.js';
import { addPanel, createFigure } from '../web/lib/figures.js';

const fold = (text) => String(text ?? '').normalize('NFKD').replace(/<[^>]+>/g, ' ').replace(/\{\\["'`^~]?([A-Za-z])\}/g, '$1').replace(/\\["'`^~]\{?([A-Za-z])\}?/g, '$1').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim();
const firstPage = (pages) => String(pages ?? '').split(/--|-|–/)[0].trim();

// Crossref's records that differ from the publication as cited, for reasons of their own: each
// field not compared, and why.
export const CROSSREF_EXCEPTIONS = {
  '10.1111/j.0006-341X.2000.00324.x': { fields: ['title', 'author'], why: 'Crossref records Lin\'s 2000 note as "Corrections", without its author' },
  '10.2202/1544-6115.1027': { fields: ['pages'], why: 'the journal numbers its articles (Article 3); Crossref records the article\'s pages, 1–25' },
  '10.1111/j.2517-6161.1995.tb02031.x': { fields: ['journal'], why: 'Crossref gives the journal\'s present name (Series B: Statistical Methodology), not its name in 1995 (Methodological)' },
};

// Each reference with a DOI against its record: [{ key, doi, problems: [text], unchecked: [field] }].
export function checkReferences(fixture = JSON.parse(readFileSync(new URL('./fixtures/crossref.json', import.meta.url), 'utf8'))) {
  const out = [];
  for (const [key, ref] of Object.entries(REFERENCES)) {
    if (!ref.doi) continue;
    const r = fixture.records[ref.doi];
    const problems = [];
    const skip = CROSSREF_EXCEPTIONS[ref.doi]?.fields ?? [];
    if (!r || r.missing) {
      out.push({ key, doi: ref.doi, problems: ['not in the fixture'] });
      continue;
    }
    if (r.doi.toLowerCase() !== ref.doi.toLowerCase()) problems.push(`DOI ${r.doi}`);
    if (!skip.includes('title') && fold(r.title) !== fold(ref.title)) problems.push(`title "${r.title}"`);
    const journals = [r.journal, r.short].filter(Boolean).map(fold);
    if (!skip.includes('journal') && !journals.some((j) => j === fold(ref.journal) || fold(ref.journal).startsWith(j) || j.startsWith(fold(ref.journal)))) problems.push(`journal "${r.journal}"`);
    if (![r.year, r.print, r.online].includes(ref.year)) problems.push(`year ${r.print ?? r.year} (online ${r.online})`);
    if (String(r.volume ?? '') !== String(ref.volume ?? '')) problems.push(`volume ${r.volume}`);
    if (r.issue && ref.number !== undefined && String(r.issue) !== String(ref.number)) problems.push(`issue ${r.issue}`);
    // Pages, where Crossref records them (a first page or an article number).
    const page = firstPage(ref.pages);
    if (!skip.includes('pages') && (r.page || r.article) && ![firstPage(r.page), r.article].filter(Boolean).map(String).includes(page)) problems.push(`pages ${r.page ?? r.article}`);
    // The first author's family name (a consortium aside), or its end where Crossref records a
    // compound one ("Martin Bland").
    const family = fold(ref.authors?.[0]?.split(',')[0]);
    const theirs = fold(r.authors?.[0]);
    if (!skip.includes('author') && ref.authors?.[0] && !/^\{/.test(ref.authors[0]) && theirs !== family && !theirs.endsWith(` ${family}`)) problems.push(`first author ${r.authors?.[0]}`);
    out.push({ key, doi: ref.doi, problems, unchecked: [...skip, ...(r.page || r.article ? [] : ['pages'])] });
  }
  return out;
}

// --- A workspace that does everything the report says ------------------------------------------------


const FIXTURES = new URL('./fixtures/', import.meta.url);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const at = (n) => `2026-10-12T${String(12 + Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}:00.000Z`;

// Each run's QC findings and scores, as the window gives them to the report.
export function contextOf(ws, scored, software = { version: 'validation', commit: '' }) {
  const runs = new Map();
  for (const run of ws.runs) {
    const s = scored.get(run.id);
    if (!s) continue;
    const thresholds = withDefaultThresholds(ws.qc?.thresholds);
    const qc = computeQC({ ...inputFor(s.table, run.inputs.design), design: run.inputs.design, results: s.results, measures: measuresOf(thresholds) });
    runs.set(run.id, { findings: findingsFrom(qc, thresholds, { acknowledged: ws.qc?.acknowledged }), results: s.results });
  }
  return { software, runs };
}

// GRB2's example (Run 1), and then every operation the report describes, one by one: its target
// checked against UniProt, an Enrich2 rescoring (Run 2), a QC threshold changed, a finding
// acknowledged, a selection by query, the comparison of the two runs and Run 1's robustness kept
// in the report, UniProt's features beside the map, a saved view of 2VWF, a figure. Returns { bare
// (the example as opened and scored), ws, scored: Map(run id → { table, results }), steps: [{
// action, expect: (report, markdown) → true when the report says it }] }.
export async function reportWorkspace() {
  const g = exampleRun('grb2-sh3');
  const table = g.o.table;
  const scored = new Map([[g.run.id, { table, results: g.results }]]);
  let ws = addRun(g.ws, g.run).ws;
  const bare = ws;
  const steps = [];
  const section = (r, id) => r.sections.find((s) => s.id === id);
  const textOf = (s) => (s ? s.blocks.map((b) => (b.kind === 'p' ? `${b.label ?? ''} ${b.text}` : b.kind === 'list' ? b.items.join('\n') : b.rows.map((x) => x.join(' ')).join('\n'))).join('\n') : '');
  const says = (id, ...parts) => (r) => parts.every((p) => (p instanceof RegExp ? p.test(textOf(section(r, id))) : textOf(section(r, id)).includes(p)));

  // The target checked against its UniProt entry.
  const target = ws.targets[0];
  const entry = readUniProtEntry(cachedJSON('uniprot', 'P62993.json'));
  const meta = cachedJSON('uniprot', 'P62993.json.meta.json');
  const placement = placeTarget(target, entry);
  ws = recordTargetCheck(ws, target.id, placementPatch(target, entry, placement), referenceOf(entry, { source: meta.source, retrieved: meta.retrieved, version: meta.version }, placement), 'Checked the target against UniProt P62993');
  steps.push({ action: 'target', what: 'its target checked against UniProt P62993', expect: says('data', /checked against UniProt P62993 \[\d+\]/) });

  // A rescoring with Enrich2's estimator.
  const parameters = { ...PRESETS.enrich2.parameters, model: g.run.inputs.parameters.model, normalization: g.run.inputs.parameters.normalization };
  const enrich2 = scoreTable(table, g.run.inputs.design, parameters);
  const run2 = makeRun({ inputs: runInputs({ source: ws.sources[0], design: g.run.inputs.design, parameters }), source: ws.sources[0], results: enrich2.results, software: g.run.software, name: 'Run 2', created: at(5) });
  ws = addRun(ws, run2).ws;
  scored.set(run2.id, { table, results: enrich2.results });
  steps.push({ action: 'score', what: 'Run 2, an Enrich2 rescoring', expect: (r) => says('scoring', 'Run 2', 'Enrich2\'s random-effects estimator')(r) && says('software', run2.output.sha256)(r) });

  // A QC threshold changed, and a finding acknowledged.
  ws = setQcThresholds(ws, { agreement: { review: 0.85, fail: 0.6 } }, 'Replicate agreement: review below 0.85, fail below 0.6');
  steps.push({ action: 'qc', what: 'a QC threshold changed', expect: says('qc', 'QC thresholds were changed', 'replicate agreement (Pearson r): to review below 0.85, failing below 0.6') });
  const findings = contextOf(ws, scored).runs.get(g.run.id).findings;
  ws = acknowledgeFinding(ws, findings.find((f) => f.id === 'excess-variance'), 'The input bottleneck the Domainome\'s analysis reported', at(10));
  steps.push({ action: 'qc', what: 'a finding acknowledged', expect: says('qc', 'acknowledged', 'The input bottleneck the Domainome\'s analysis reported') });

  // A selection by query.
  const model = buildMapModel(g.results, g.run.inputs.design);
  const selected = selectByQuery('lower and position 30-40', queryContext({ model, results: g.results, design: g.run.inputs.design }));
  ws = addSelection(ws, { name: 'Core lower', run: g.run.id, condition: 0, keys: selected.keys, query: selected.query, created: at(15) }).ws;
  steps.push({ action: 'selection', what: 'a selection by query', expect: says('selections', `"Core lower": ${selected.keys.length} variants of Run 1, selected by the query "lower and position 30-40"`) });

  // The comparison of the two runs, and Run 1's robustness, kept in the report.
  const pair = { a: { run: g.run.id, condition: 0 }, b: { run: run2.id, condition: 0 } };
  const c = compareSides(describeSide(ws, g.run, g.results, pair.a), describeSide(ws, run2, enrich2.results, pair.b));
  const comparison = comparisonRecord(c, pair);
  ws = keepAnalysis(ws, comparison, keptWords(comparison), at(20)).ws;
  steps.push({ action: 'report', what: 'the comparison of Run 1 and Run 2 kept in the report', expect: says('comparisons', 'Run 1 and Run 2 were compared', `on ${c.statistics.n.toLocaleString('en-US')} variants`, `Pearson's r = ${c.statistics.pearson.r.toFixed(3)}`) });
  const check = checkTable(table, g.run.inputs.design, g.run.inputs.parameters, { max: 12 });
  const robustness = robustnessRecord(g.run, check.summary, { max: 12, seed: ROBUSTNESS_SEED });
  ws = keepAnalysis(ws, robustness, keptWords(robustness), at(25)).ws;
  steps.push({ action: 'report', what: 'Run 1\'s robustness kept in the report', expect: says('robustness', `checked against ${check.summary.total - 1} alternative analyses`, check.summary.targets[0].text) });

  // UniProt's features beside the map.
  const gff = new Uint8Array(readFileSync(new URL('annotations/P62993.gff', FIXTURES)));
  ws = addAnnotation(ws, { provider: 'uniprot-features', name: 'UniProt features: P62993', record: { accession: 'P62993', release: '2026_03', retrieved: '2026-10-10T12:00:00Z' }, file: { fileName: 'P62993.gff', sha256: sha(gff), size: gff.length } }, 'Added UniProt P62993\'s features').ws;
  steps.push({ action: 'annotation', what: 'UniProt\'s features beside the map', expect: (r) => says('annotations', 'UniProt P62993\'s features')(r) && says('inputs', sha(gff))(r) });

  // A saved view of 2VWF.
  const bytes = cachedBytes('pdb', pdbFile('2VWF'));
  const pdbMeta = cachedJSON('pdb', `${pdbFile('2VWF')}.meta.json`);
  const structure = await openCached('pdb', pdbFile('2VWF'));
  const [mapping] = mapTarget(structure, exampleTarget('grb2-sh3'));
  const view = { name: 'Core', assembly: 'asym', chain: mapping.chain, mapping: mappingSummary(mapping), camera: { target: [0, 0, 0], distance: 50, rotation: [0, 0, 0, 1] }, size: { width: 800, height: 600 }, style: 'cartoon', color: { scheme: 'scores', scores: { how: 'median' }, run: g.run.id, condition: 0 }, surface: 'off', selection: [], labels: [], styles: {}, focus: [], evidence: null };
  ws = saveStructureView(ws, { id: 'pdb-2VWF', name: '2VWF', title: structure.meta.title, method: '', origin: { kind: 'pdb', id: '2VWF', retrieval: { retrieved: pdbMeta.retrieved, source: pdbMeta.source } }, file: { fileName: pdbFile('2VWF'), sha256: sha(bytes), size: bytes.length } }, view, at(30)).ws;
  steps.push({ action: 'structure-view', what: 'a saved view of 2VWF', expect: (r) => says('structures', 'PDB entry 2VWF', '"Core"', sha(bytes))(r) && says('inputs', sha(bytes))(r) });

  // A figure of Run 1's map.
  let fig = createFigure('Figure 1', 'double');
  ({ figure: fig } = addPanel(fig, { kind: 'map', run: g.run.id }));
  ws = saveFigure(ws, fig, 'Made the figure "Figure 1" with the map of Run 1', at(35));
  steps.push({ action: 'figure', what: 'a figure', expect: says('figures', 'Figure 1 (two columns, 174 × 120 mm, text 7 pt): A, the map of Run 1.') });
  return { g, bare, ws, scored, steps, run2, comparison, robustness, files: { annotations: new Map([[sha(gff), gff]]), structures: new Map([[sha(bytes), bytes]]) } };
}
