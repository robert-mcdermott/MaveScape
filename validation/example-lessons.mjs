// The wave's lessons on the examples (wave 6, slice 8), made in Node as their guides make them in
// the window: GRB2's figure (Run 1's map, the saved view Core of 2VWF, and the QC finding behind its
// bottleneck, acknowledged), exported as PDF with its manifest and read back; Hsp90's checkpoint
// before its time courses are cut to their first three samples (and, apart, the pseudocount
// changed, which moves nothing); and the BRCA1 RING domain certified, verified and reported, with
// and without its tables. The remote session (remote-session.mjs) makes them in the window.

import { exampleById, exampleRun, publishedRun } from './compare-cases.mjs';
import { findingsOf, pairsFor } from './diff-cases.mjs';
import { windowExample } from './certificate-cases.mjs';
import { openExampleInNode, recordTable } from './example-cases.mjs';
import { cachedBytes, cachedJSON, exampleTarget, openCached, pdbFile } from './structure-cases.mjs';
import { SOFTWARE, scoreTable } from './roundtrip-cases.mjs';
import { sha256 } from '../web/lib/sha256.js';
import { encodePNG } from '../web/lib/png.js';
import { addRun, makeRun, runInputs } from '../web/lib/runs.js';
import { acknowledgeFinding, addCheckpoint, addSource, saveFigure, saveStructureView, setDesign } from '../web/lib/workspace.js';
import { assignColumn } from '../web/lib/design-edit.js';
import { analysisState, diffStates, makeCheckpoint, pairWords } from '../web/lib/diff.js';
import { addPanel, createFigure, figurePDF, mm, panelLetters, panelSummary } from '../web/lib/figures.js';
import { buildManifest, compareManifest, pdfAttachment, readFigureManifest } from '../web/lib/figure-manifest.js';
import { computeNumbers, readCertificate, verifyCertificate, writeCertificate } from '../web/lib/certificate.js';
import { defaultParameters, withDefaults } from '../web/lib/score.js';
import { mapTarget } from '../web/lib/mapping.js';
import { mappingSummary } from '../web/lib/structure-record.js';

const at = (minute) => `2026-10-12T13:${String(minute).padStart(2, '0')}:00.000Z`;
const named = (ws, name) => ws.runs.find((r) => r.name === name);

// GRB2's figure: a page two columns wide and 186 mm high (its smallest text 6.9 pt), each panel
// [x, y, width, height] in mm.
export const GRB2_FIGURE = { height: 186, map: [3, 3, 168, 92], structure: [3, 98, 62, 85], qc: [68, 98, 103, 85] };

// The reason GRB2's guide acknowledges its variance beyond counting with.
export const GRB2_ACKNOWLEDGED = 'The input bottleneck the Domainome\'s own analysis found (DiMSum\'s error model puts it at the input)';

// GRB2's figure as its guide makes it: Run 1 scored, its variance beyond counting acknowledged, Run 2
// the DiMSum-compatible preset (step 2), the view Core of 2VWF colored by Run 1's median scores
// (step 5), then a figure two columns wide of Run 1's map with its own tracks, the view and the QC
// finding. The view's image is the window's to draw (WebGL); here a plain image stands in for it,
// kept by its SHA-256 as the window keeps its own. Returns { ws, files, fig, run1, finding,
// computed, manifest, pdf, read, comparison, rescored (compareManifest after a Run 3) }.
export async function grb2Figure() {
  const g = exampleRun('grb2-sh3');
  const table = g.o.table;
  let ws = addRun(g.ws, g.run).ws;
  const run1 = g.run;
  const finding = findingsOf(ws, table, run1, g.results).find((f) => f.id === 'excess-variance');
  ws = acknowledgeFinding(ws, finding, GRB2_ACKNOWLEDGED, at(1));
  const dimsum = withDefaults(defaultParameters(run1.inputs.design, ws.sources[0], 'dimsum'));
  const s2 = scoreTable(table, run1.inputs.design, dimsum);
  ws = addRun(ws, makeRun({ inputs: runInputs({ source: ws.sources[0], design: run1.inputs.design, parameters: dimsum }), source: ws.sources[0], results: s2.results, software: SOFTWARE, name: 'Run 2', created: at(2) })).ws;

  const pdb = cachedBytes('pdb', pdbFile('2VWF'));
  const meta = cachedJSON('pdb', `${pdbFile('2VWF')}.meta.json`);
  const structure = await openCached('pdb', pdbFile('2VWF'));
  const [mapping] = mapTarget(structure, exampleTarget('grb2-sh3'));
  const view = { name: 'Core', assembly: 'asym', chain: mapping.chain, mapping: mappingSummary(mapping), camera: { target: [0, 0, 0], distance: 50, rotation: [0, 0, 0, 1] }, size: { width: 800, height: 600 }, style: 'cartoon', color: { scheme: 'scores', scores: { how: 'median' }, run: run1.id, condition: 0 }, surface: 'off', selection: [], labels: [], styles: {}, focus: [], evidence: null };
  ws = saveStructureView(ws, { id: 'pdb-2VWF', name: '2VWF', title: structure.meta.title, method: '', origin: { kind: 'pdb', id: '2VWF', retrieval: { retrieved: meta.retrieved, source: meta.source } }, file: { fileName: pdbFile('2VWF'), sha256: sha256(pdb), size: pdb.length } }, view, at(5)).ws;
  const saved = ws.structureViews.find((v) => v.name === 'Core');
  const image = await encodePNG(new Uint8Array(800 * 600 * 4).fill(235), 800, 600);
  const imageSha = sha256(image);

  // The page and panels as the guide's screenshot lays them out (docs/capture, grb2-figure), in mm.
  let fig = createFigure('GRB2 SH3', 'double', { height: mm(GRB2_FIGURE.height) });
  const placed = (at) => ({ x: mm(at[0]), y: mm(at[1]), w: mm(at[2]), h: mm(at[3]) });
  for (const panel of [
    { kind: 'map', run: run1.id, tracks: ['reference', 'effect'], ...placed(GRB2_FIGURE.map) },
    { kind: 'structure', view: saved.id, image: { sha256: imageSha, width: 800, height: 600, drawn: saved.created }, ...placed(GRB2_FIGURE.structure) },
    { kind: 'qc', subject: run1.id, finding: finding.id, findingTitle: finding.title, ...placed(GRB2_FIGURE.qc) },
  ]) ({ figure: fig } = addPanel(fig, panel));
  ws = saveFigure(ws, fig, 'Made the figure "GRB2 SH3": Run 1\'s map, the view Core and the variance beyond counting', at(10));
  fig = ws.figures[0];

  const files = new Map([[sha256(g.o.parts[0].bytes), g.o.parts[0].bytes], [sha256(pdb), pdb], [imageSha, image]]);
  const computed = await computeNumbers(ws, async (sha) => files.get(sha) ?? null, { software: SOFTWARE });
  const { resolved, drawn } = computed.detail.figures.get(fig.id);
  const created = at(11);
  const manifest = buildManifest(ws, fig, drawn, { software: SOFTWARE, created });
  const pdf = await figurePDF(fig, resolved, { date: new Date(created), attachments: [pdfAttachment(manifest)] });
  const read = readFigureManifest(pdf);
  const comparison = compareManifest(read, ws);
  // Scored again after the figure was made: the panels drawn from Run 1 say so.
  const later = withDefaults({ ...run1.inputs.parameters, pseudocount: 1 });
  const s3 = scoreTable(table, run1.inputs.design, later);
  const after = addRun(ws, makeRun({ inputs: runInputs({ source: ws.sources[0], design: run1.inputs.design, parameters: later }), source: ws.sources[0], results: s3.results, software: SOFTWARE, name: 'Run 3', created: at(20) })).ws;
  const letters = panelLetters(fig);
  return { ws, files, fig, run1, finding, letters, shows: fig.panels.map((p) => `${letters.get(p.id)}, ${panelSummary(p, ws)}`), resolved, drawn, computed, manifest, pdf, read, comparison, rescored: compareManifest(read, after) };
}

// Hsp90 as its guide leaves it before its fifth step: Run 1 per generation, Run 2 over the whole time
// course (step 3); then a checkpoint, the samples of generations 9 to 21 set "Not used" in Experiment
// (the authors fit their null-like variants on the first three) and Run 3 scored with Run 2's
// parameters. Also, apart: Run 1 → over the whole time course (every effect 21 times), the time
// points cut per generation, and the pseudocount 0.5 → 0.1. Returns { g, ws, checkpoint, diff
// (checkpoint → now), words, runs: { run1, run2, run3 }, results: Map(run id → results), apart: {
// course, firstThree, pseudocount } (each variantChanges's first target, Run 1 → it) }.
export function hsp90Checkpoint() {
  const g = exampleRun('hsp90');
  const table = g.o.table;
  const design = g.run.inputs.design;
  const results = new Map([[g.run.id, g.results]]);
  const score = (ws, parameters, runDesign, name, minute) => {
    const s = scoreTable(table, runDesign, parameters);
    if (!s.ok) throw new Error(`Hsp90 ${name}: ${s.errors.join(' ')}`);
    const run = makeRun({ inputs: runInputs({ source: ws.sources[0], design: runDesign, parameters }), source: ws.sources[0], results: s.results, software: SOFTWARE, name, created: at(minute) });
    results.set(run.id, s.results);
    return { ws: addRun(ws, run).ws, run };
  };
  let ws = addRun(g.ws, g.run).ws;
  const course = withDefaults({ ...g.run.inputs.parameters, timeScale: 'course' });
  const two = score(ws, course, design, 'Run 2', 3);
  ws = two.ws;
  ws = addCheckpoint(ws, makeCheckpoint(ws, 'All eight samples', at(5)), at(5)).ws;
  // Experiment: each later sample's column "Not used", as the view sets it (lib/design-edit.js).
  let cut = ws.design;
  for (const column of ['Gen_9', 'Gen_12', 'Gen_15', 'Gen_18', 'Gen_21']) cut = assignColumn(cut, column, { kind: 'ignored', reason: 'not used: the first three samples fitted, as the authors fit null-like variants' }).design;
  ws = setDesign(ws, cut, 'Generations 9 to 21 not used');
  const three = score(ws, course, cut, 'Run 3', 7);
  ws = three.ws;
  const checkpoint = ws.checkpoints[0];
  const now = analysisState(ws);
  const scored = new Map([...results].map(([id, r]) => [id, r]));
  const diff = diffStates(checkpoint.state, now, { pairs: pairsFor(checkpoint.state, now, table, scored) });
  // Apart, each change from Run 1 alone.
  const alone = (parameters, runDesign) => {
    const s = scoreTable(table, runDesign, parameters);
    const run = makeRun({ inputs: runInputs({ source: g.ws.sources[0], design: runDesign, parameters }), source: g.ws.sources[0], results: s.results, software: SOFTWARE, name: 'Apart' });
    return { run, results: s.results };
  };
  const apart = {
    course: alone(course, design),
    firstThree: alone(g.run.inputs.parameters, cut),
    pseudocount: alone(withDefaults({ ...g.run.inputs.parameters, pseudocount: 0.1 }), design),
  };
  return { g, ws, checkpoint, diff, words: [diff.summary, ...diff.changes.map((c) => c.text), ...diff.pairs.flatMap(pairWords)], runs: { run1: g.run, run2: two.run, run3: three.run }, results, apart, cut };
}

// The BRCA1 RING domain as the window opens it from MaveDB (ui/mavedb.js): its published scores read
// as published (the run "Published scores", their table MaveDB's scores) and its counts with the
// example's design scored with MaveScape's defaults (Run 1), then, as its guide's fourth step, with
// the Enrich2-compatible preset (Run 2). Returns { ws, files: Map(sha256 → bytes), tables: [{ file,
// sha256 }] (MaveDB's two files), made (writeCertificate's, with its review), bare (without its
// tables), verified, missing (the bare one alone), supplied (the bare one with MaveDB's files) }.
export async function ringCertified() {
  const example = exampleById('brca1-ring');
  const urn = example.mavedb.urn;
  const counts = windowExample('brca1-ring');
  const published = publishedRun('brca1-ring', urn);
  const scoresBytes = recordTable(example, urn, 'scores').bytes;
  // One workspace: the counts' (target, table, design, Run 1) with the published scores' table and run.
  const target = counts.ws.targets[0].id;
  const added = addSource(counts.ws, { ...published.ws.sources[0], name: `${example.title}: scores`, target });
  let ws = added.ws;
  const source = ws.sources.find((s) => s.id === added.id);
  const pub = makeRun({ inputs: runInputs({ source, design: published.run.inputs.design, parameters: published.run.inputs.parameters }), source, results: published.results, software: SOFTWARE, name: 'Published scores', created: '2026-10-12T11:59:00.000Z' });
  ws = { ...ws, runs: [pub, ...ws.runs] };
  const run1 = named(ws, 'Run 1');
  const countsSource = ws.sources.find((s) => s.sha256 === run1.inputs.source.sha256);
  const enrich2 = withDefaults(defaultParameters(run1.inputs.design, countsSource, 'enrich2'));
  const o = openExampleInNode(example);
  const s2 = scoreTable(o.table, run1.inputs.design, enrich2);
  ws = addRun(ws, makeRun({ inputs: runInputs({ source: countsSource, design: run1.inputs.design, parameters: enrich2 }), source: countsSource, results: s2.results, software: SOFTWARE, name: 'Run 2', created: at(30) })).ws;
  const files = new Map([...counts.files, [sha256(scoresBytes), scoresBytes]]);
  const file = async (sha) => files.get(sha) ?? null;
  const made = await writeCertificate(ws, file, { software: SOFTWARE, review: true });
  const bare = await writeCertificate(ws, file, { software: SOFTWARE, tables: false });
  const verified = await verifyCertificate(await readCertificate(made.bytes), { software: SOFTWARE });
  const missing = await verifyCertificate(await readCertificate(bare.bytes), { software: SOFTWARE });
  const supplied = await verifyCertificate(await readCertificate(bare.bytes), { software: SOFTWARE, file });
  const tables = [['scores', example.mavedb.scores.sha256], ['counts', example.mavedb.counts.sha256]].map(([which, sha]) => ({ which, sha256: sha, held: files.has(sha) }));
  return { ws, files, tables, made, bare, verified, missing, supplied };
}
