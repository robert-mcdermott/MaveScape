// A scripted remote-control session: every action (actions.go) driven through the program's hub,
// as a script drives it, in the real program and a headless browser, on the bundled examples.
// Each result is checked against the same analysis made in Node: scores against the scoring
// engine, and every export, written to disk by the hub, against the files made in Node from the
// workspace archive the session exported (the record's round trip, wave 1 slice 8).
//
//   node validation/remote-session.mjs [--verbose] [--like-ci [rate]]
//
// --like-ci runs the page as GitHub's runners do (the 0.5.0 release): WebGPU drawn in software
// (Chrome's SwiftShader adapter, whose graphics process does not last) and the page's processor
// slowed (rate times, 4 by default), so that what fails there first fails here.
//
// Needs Go (to build MaveScape from source) and Chrome, Chromium, Edge or Brave (CHROME=path).
// Exits with status 1 when a check fails.

import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, sleep } from '../docs/capture/cdp.mjs';
import { readArchive } from '../web/lib/archive.js';
import { parseTable } from '../web/lib/csv.js';
import { makeRun, outputDigest, recordedInputs, runInputs } from '../web/lib/runs.js';
import { DEFAULT_PARAMETERS, PRESETS, defaultParameters } from '../web/lib/score.js';
import { FINGERPRINT } from '../web/lib/dmath.js';
import { allExports, inputFor, recompute, scoreTable } from './roundtrip-cases.mjs';
import { exampleById, simulatedExample } from '../web/lib/examples.js';
import { assembleTable } from '../web/lib/assemble.js';
import { barcodesCSV, differentialCSV, proteinScoresCSV } from '../web/lib/exports.js';
import { proteinView } from '../web/lib/collapse.js';
import { readZip } from '../web/lib/zip.js';
import { MAVEDB_FILES } from '../web/lib/mavedb-export.js';
import { depositPackages } from './mavedb-export-cases.mjs';
import { nodeTracks } from './annotation-cases.mjs';
import { buildMapModel } from '../web/lib/map-model.js';
import { mapSVG } from '../web/lib/map-svg.js';
import { builtinTracks, tracksCSV } from '../web/lib/tracks.js';
import { figureMarks, figureSVG } from '../web/lib/figures.js';
import { buildManifest, checkManifest, embedSVG, readFigureManifest } from '../web/lib/figure-manifest.js';
import { asPDFText, decodePNG, readPDF, readSVG, sameRects } from './figure-cases.mjs';
import { qcPanelData } from '../web/lib/qc-plots.js';
import { comparisonCharts, scoreCharts, variantCharts } from '../web/lib/view-plots.js';
import { computeQC } from '../web/lib/qc.js';
import { findingsFrom, withDefaultThresholds } from '../web/lib/findings.js';
import { openExampleInNode } from './example-cases.mjs';
import { classesCSV, compareSides, comparisonCSV, comparisonJSON, describeSide, differenceMap, positionsCSV, sideMap } from '../web/lib/compare.js';
import { predictorSide, scoreSetSide } from './compare-cases.mjs';
import { checkTable } from './robustness-cases.mjs';
import { contextOf } from './report-cases.mjs';
import { pairsFor } from './diff-cases.mjs';
import { analysisState, diffStates } from '../web/lib/diff.js';
import { comparisonRecord, robustnessRecord, writeReport } from '../web/lib/report.js';
import { robustnessCSV, robustnessJSON, robustnessPositionsCSV, ROBUSTNESS_SEED } from '../web/lib/robustness.js';
import { combineKeys, queryContext, selectByQuery } from '../web/lib/query.js';
import { placeTarget, placementPatch, readUniProtEntry, referenceOf } from '../web/lib/uniprot.js';
import { recordTargetCheck } from '../web/lib/workspace.js';
import { sha256 } from '../web/lib/sha256.js';
import { EXAMPLE_STRUCTURES, cachedBytes, cachedJSON, exampleTarget, modelFile, nodeEvidence, openCached, paeFixture, pdbFile } from './structure-cases.mjs';
import { clusterTest, effectsByClass, evidenceCSV } from '../web/lib/structure-evidence.js';
import { PANEL_KEYWORD, pngTexts } from '../web/lib/structure-record.js';
import { dataRange, residueData } from '../web/lib/proteoscope.js';
import { createServer } from 'node:http';
import { gunzipSync, inflateRawSync } from 'node:zlib';
import { mapTarget, mapTargetOnChain, mappingCSV, rankStructures } from '../web/lib/mapping.js';
import { cellsAtPositions, coloringCSV, coloringLegend, coloringPalette, placeOnTarget, POSITION, positionValues, residueColors, thresholdClasses } from '../web/lib/structure-scores.js';
import { cellAt, cellName } from '../web/lib/map-model.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8836;
// Where MaveScape looks for Proteoscope (--proteoscope): a fake one runs there for slice 6's checks,
// and nothing before them, whatever runs on Proteoscope's own ports on this computer.
const PROTEOSCOPE_PORT = 8856;
const verbose = process.argv.includes('--verbose');
const requireData = process.argv.includes('--require-data');
const likeCI = process.argv.includes('--like-ci');
const ciRate = likeCI ? Number(process.argv[process.argv.indexOf('--like-ci') + 1]) || 4 : 1;
// DHFR's MaveDB tables (wave 3, slice 6), as node validation/fetch.mjs mavedb-dhfr keeps them: copied
// into the fetcher's cache, so that its two score sets open together offline.
const DHFR = join(dirname(fileURLToPath(import.meta.url)), 'cache', 'mavedb-dhfr');
const DHFR_TABLES = [['urn:mavedb:00000063-b-1', 'minus-lon'], ['urn:mavedb:00000063-a-1', 'plus-lon']];
// TP53's three score sets (wave 4, slice 6), as node validation/fetch.mjs mavedb-tp53-screens keeps
// them: the example opens the first, and compares the others kept beside.
const TP53 = join(dirname(fileURLToPath(import.meta.url)), 'cache', 'mavedb-tp53-screens');
const TP53_TABLES = [['urn:mavedb:00000068-c-1', 'scores.csv'], ['urn:mavedb:00000068-b-1', 'nutlin.csv'], ['urn:mavedb:00000059-a-1', 'kotler.csv']];
const results = [];
const fmtShare = (x) => `${(100 * x).toFixed(0)}% drawn`;
function check(name, value, ok, required = '') {
  results.push({ name, ok });
  if (verbose || !ok) console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} — ${value}${required ? ` (required ${required})` : ''}`);
}

// --- MaveScape and the page ---------------------------------------------------------------------

let URL = `http://127.0.0.1:${PORT}/`;
const temp = mkdtempSync(join(tmpdir(), 'mavescape-remote-'));
const library = join(temp, 'library');
const out = join(temp, 'out');
const cache = join(temp, 'cache');
mkdirSync(out);
let token = '';

async function startMaveScape() {
  const binary = join(temp, process.platform === 'win32' ? 'mavescape.exe' : 'mavescape');
  await new Promise((done, fail) => spawn('go', ['build', '-o', binary, '.'], { cwd: ROOT, stdio: 'inherit' }).on('exit', (code) => (code ? fail(new Error('go build failed (is Go installed?)')) : done())));
  // Offline, with UniProt's answers as the fetcher cached them (validation/fixtures/public-data):
  // the session makes no request beyond this computer.
  cpSync(join(ROOT, 'validation/fixtures/public-data'), cache, { recursive: true });
  if (existsSync(join(DHFR, 'plus-lon', 'counts.csv'))) {
    for (const [urn, dir] of DHFR_TABLES) {
      for (const table of ['scores', 'counts']) {
        const name = `${urn.replaceAll(':', '_')}.${table}.csv`;
        cpSync(join(DHFR, dir, `${table}.csv`), join(cache, 'mavedb', name));
        writeFileSync(join(cache, 'mavedb', `${name}.meta.json`), `${JSON.stringify({ contentType: 'text/csv; charset=utf-8', service: 'MaveDB', source: `https://api.mavedb.org/api/v1/score-sets/${urn}/${table}`, retrieved: '2026-10-11T16:30:00Z' }, null, 2)}\n`);
      }
    }
  }
  if (existsSync(join(TP53, 'kotler.csv'))) {
    for (const [urn, file] of TP53_TABLES) {
      const name = `${urn.replaceAll(':', '_')}.scores.csv`;
      cpSync(join(TP53, file), join(cache, 'mavedb', name));
      writeFileSync(join(cache, 'mavedb', `${name}.meta.json`), `${JSON.stringify({ contentType: 'text/csv; charset=utf-8', service: 'MaveDB', source: `https://api.mavedb.org/api/v1/score-sets/${urn}/scores`, retrieved: '2026-10-12T01:15:25Z' }, null, 2)}\n`);
    }
  }
  const server = spawn(binary, ['--remote-control', '--window', 'none', '--port', String(PORT), '--data-dir', library, '--offline', '--cache-dir', cache, '--proteoscope', String(PROTEOSCOPE_PORT)], { cwd: temp, stdio: ['ignore', 'pipe', 'inherit'] });
  let output = '';
  server.stdout.on('data', (chunk) => { output += chunk; });
  for (let i = 0; i < 300; i += 1) {
    const address = /running at (http:\/\/[\d.]+:\d+)/.exec(output)?.[1];
    if (address && existsSync(join(library, 'remote.json'))) {
      URL = `${address}/`;
      try {
        if ((await fetch(`${URL}api/info`)).ok) return { stop: () => server.kill(), banner: () => output };
      } catch { /* starting */ }
    }
    await sleep(200);
  }
  server.kill();
  throw new Error(`MaveScape did not start:\n${output}`);
}

const called = new Set();
// An action, as a script sends it; returns { status, ok, message, data, error }.
async function send(action, args = {}, { withToken = true } = {}) {
  called.add(action);
  const headers = { 'Content-Type': 'application/json' };
  if (withToken) headers['X-MaveScape-Token'] = token;
  const response = await fetch(`${URL}api/remote/action`, { method: 'POST', headers, body: JSON.stringify({ action, args, client: 'remote-session' }) });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, ...body };
}
async function act(action, args = {}) {
  const r = await send(action, args);
  if (!r.ok) throw new Error(`${action} ${JSON.stringify(args)}: ${r.message ?? r.error}`);
  return r;
}

// --- The session ----------------------------------------------------------------------------------

const maveScape = await startMaveScape();
let browser = null;
try {
  // The connection file scripts read: the address and the token, for this user only.
  const connection = JSON.parse(readFileSync(join(library, 'remote.json'), 'utf8'));
  token = connection.token;
  check('remote.json gives the address and the token', `${connection.url}, token of ${connection.token.length} characters`, `${connection.url}/` === URL && connection.token.length >= 20 && maveScape.banner().includes(connection.token));
  if (process.platform !== 'win32') check('remote.json is readable by its owner only', (statSync(join(library, 'remote.json')).mode & 0o777).toString(8), (statSync(join(library, 'remote.json')).mode & 0o777) === 0o600, '600');

  const tools = await (await fetch(`${URL}api/remote/tools`)).json();
  const names = tools.tools.map((t) => t.name);
  check('the program lists its actions with their arguments', `${names.length} actions`, names.length >= 14 && tools.tools.every((t) => t.description && t.inputSchema?.type === 'object'));

  const noPage = await send('get_state');
  called.delete('get_state');
  check('without a page, an action is refused with a reason', `${noPage.status}: ${noPage.error}`, noPage.status === 503 && /No MaveScape page/.test(noPage.error));

  browser = await launch({ width: 1440, height: 900, scale: 1, args: likeCI ? ['--use-webgpu-adapter=swiftshader'] : [] });
  if (likeCI) {
    await browser.send('Emulation.setCPUThrottlingRate', { rate: ciRate });
    console.log(`Like CI: WebGPU in software, the page's processor ${ciRate} times slower.`);
  }
  const errors = [];
  browser.on('Runtime.exceptionThrown', (e) => errors.push(e.exceptionDetails?.exception?.description ?? e.exceptionDetails?.text));
  // Every request the page makes in the whole session (wave 3, slice 1: none beyond its origin).
  const requested = [];
  await browser.send('Network.enable');
  browser.on('Network.requestWillBeSent', (e) => requested.push(e.request.url));
  await browser.goto(URL, 1500);
  for (let i = 0; i < 100 && !(await browser.eval('Boolean(window.mavescape?.remote)')); i += 1) await sleep(100);
  await sleep(500);

  // Scores must not depend on the engine: the browser's logarithms are not Node's (dmath.js).
  const pageFingerprint = await browser.eval(`import('/lib/dmath.js').then((m) => m.fingerprint())`);
  check('log, exp and pow give the same bits in the browser as in Node', `${pageFingerprint} in the browser, ${FINGERPRINT} recorded`, pageFingerprint === FINGERPRINT);

  // An empty workspace.
  let state = await act('get_state');
  check('get_state: a new workspace, the next step is the counts', state.message, state.data.tables.length === 0 && state.data.next?.step === 'counts' && state.data.mode === 'start');
  const unknown = await send('no_such_action');
  check('an unknown action lists the actions', unknown.message, !unknown.ok && names.every((n) => unknown.message.includes(n)));
  const wrongMode = await send('set_mode', { mode: 'heatmap' });
  check('a wrong name lists the choices', wrongMode.message, !wrongMode.ok && /experiment/.test(wrongMode.message) && /map/.test(wrongMode.message));
  const noRun = await send('score');
  check('scoring with no table is refused with what to do', noRun.message, !noRun.ok && /open a count table/i.test(noRun.message));

  // GRB2, by a forgiving name.
  const opened = await act('open_example', { id: 'grb2' });
  state = await act('get_state');
  check('open_example "grb2": the GRB2 example, scored, in QC', opened.message, opened.data.id === 'grb2-sh3' && state.data.runs.length === 1 && state.data.mode === 'qc' && state.data.design?.valid);
  // The target checked against UniProt (wave 3, slice 1), offline, from the cache.
  const placed = await act('check_target');
  check('check_target: GRB2\'s SH3 domain is residues 159–214 of UniProt P62993, identical, from the cache (release 2026_03); nothing to change', placed.message, placed.data.placement.start === 159 && placed.data.placement.end === 214 && placed.data.placement.identical && !Object.keys(placed.data.changes).length && placed.data.retrieval.cache === 'hit' && placed.data.retrieval.version === '2026_03' && !placed.data.applied);
  const elsewhere = await send('check_target', { accession: 'P00740' });
  check('check_target against another protein\'s entry: refused, saying why', elsewhere.message, !elsewhere.ok && /fewer than 80%/.test(elsewhere.message));
  const uncached = await send('check_target', { accession: 'Q9Y6K9' });
  check('check_target offline, for an entry not in the cache: refused, saying MaveScape is offline', uncached.message, !uncached.ok && /--offline/.test(uncached.message));
  const designBefore = await browser.eval('JSON.stringify(window.mavescape.store.ws.design)');
  const recorded = await act('check_target', { apply: true });
  const kept = await browser.eval('window.mavescape.store.ws.targets[0].reference');
  const stillCurrent = await act('get_state');
  check('check_target with apply: the check kept with the workspace\'s target, the design (and so its run) unchanged', `${recorded.message} Kept: ${JSON.stringify(kept)}; next ${stillCurrent.data.next?.step}`, kept?.accession === 'P62993' && kept.release === '2026_03' && kept.start === 159 && (await browser.eval('JSON.stringify(window.mavescape.store.ws.design)')) === designBefore && stillCurrent.data.steps.find((x) => x.id === 'score')?.state === 'done');
  const examplesListed = await send('open_example', { id: 'nothing-like-it' });
  check('an unknown example lists the examples', examplesListed.message, !examplesListed.ok && /grb2-sh3/.test(examplesListed.message) && /simulated/.test(examplesListed.message));

  // The run equals the scoring engine's in Node.
  const exampleTable = parseTable(readFileSync(join(ROOT, 'web/examples/grb2-sh3/counts.csv')), { fileName: 'counts.csv' });
  const exampleDesign = JSON.parse(readFileSync(join(ROOT, 'web/examples/grb2-sh3/design.json'), 'utf8'));
  // The design as the workspace holds it (the example's, with the workspace's own target).
  const workspaceDesign = await browser.eval('window.mavescape.store.ws.design');
  const nodeDigest = outputDigest(scoreTable(exampleTable, workspaceDesign, DEFAULT_PARAMETERS).results);
  check('the run scored in the window has the output hash of the same scoring in Node', `${state.data.runs[0].outputSha256.slice(0, 16)}… and ${nodeDigest.slice(0, 16)}…`, state.data.runs[0].outputSha256 === nodeDigest);

  // Views.
  for (const [name, mode] of [['Map', 'map'], ['score', 'score'], ['quality control', 'qc'], ['experiment', 'experiment'], ['start', 'start']]) {
    const r = await act('set_mode', { mode: name });
    check(`set_mode "${name}"`, r.message, r.data.mode === mode && (await browser.eval(`document.getElementById('app').dataset.mode`)) === (mode === 'start' ? 'welcome' : mode));
  }

  // check and reproduce_run (mavescape validate and run --from-workspace use them).
  const checked = await act('check');
  const misfit = await act('check', { design: { ...exampleDesign, samples: exampleDesign.samples.map((x, i) => (i ? x : { ...x, columns: ['no_such_column'] })) } });
  const unscorable = await act('check', { parameters: { pseudocount: 0 } });
  check('check: the example valid; a design that does not fit and parameters that cannot score not, each saying why', `${checked.message} | ${misfit.data.blocking[0]} | ${unscorable.data.blocking[0]}`, checked.data.valid && checked.data.table.names.valid > 1000 && !misfit.data.valid && /no_such_column/.test(misfit.data.blocking.join(' ')) && !unscorable.data.valid && /pseudocount/.test(unscorable.data.blocking.join(' ')));
  const reproduced = await act('reproduce_run', { run: 'Run 1' });
  check('reproduce_run: Run 1 recomputed from its recorded inputs, with its recorded output hash', reproduced.message, reproduced.data.status === 'reproduced' && reproduced.data.recomputed === reproduced.data.recorded && reproduced.data.conditions.length === 1 && reproduced.data.map === true);

  // QC: GRB2 passes everything but the variance beyond counting (its bottleneck).
  const qc = await act('qc_findings', { finding: 'variance' });
  const notPass = qc.data.findings.filter((f) => f.status !== 'pass' && f.status !== 'na');
  check('qc_findings: twelve findings, only the variance beyond counting not passing', `${qc.message} Not passing: ${notPass.map((f) => `${f.id} ${f.status}`).join(', ')}`, qc.data.findings.length === 12 && notPass.length === 1 && notPass[0].id === 'excess-variance');
  check('qc_findings shows the finding asked for in the QC view', await browser.eval('window.mavescape.qcView?.finding'), (await browser.eval(`window.mavescape.qcView?.finding`)) === 'excess-variance' && (await browser.eval(`document.getElementById('app').dataset.mode`)) === 'qc');
  const countsQc = await act('qc_findings', { run: 'counts' });
  check('qc_findings of the counts alone: the run-level findings are not assessed', countsQc.message, countsQc.data.findings.find((f) => f.id === 'separation')?.status === 'na');
  // Findings in context (wave 2, slice 8): what to do, and an acknowledgement that keeps the status.
  const variance = qc.data.findings.find((f) => f.id === 'excess-variance');
  check('qc_findings: a finding not passing says what could cause it and what to do next', `${variance.causes.length} causes, ${variance.next.length} next steps: ${variance.next.map((x) => x.kind).join(', ')}`, variance.causes.length > 0 && variance.next.some((x) => x.kind === 'analysis') && variance.next.some((x) => x.kind === 'experiment'));
  const acked = await act('acknowledge_finding', { finding: 'excess-variance', reason: 'The input bottleneck the Domainome\'s analysis reported' });
  const afterAck = await act('qc_findings', {});
  const ackedFinding = afterAck.data.findings.find((f) => f.id === 'excess-variance');
  check('acknowledge_finding: GRB2\'s variance beyond counting acknowledged with a reason; it still fails, and the overall status counts it apart', `${acked.message} | ${afterAck.message}`, acked.ok && ackedFinding.status === 'fail' && ackedFinding.acknowledged?.current && afterAck.data.overall.status === 'fail' && afterAck.data.overall.unacknowledged.fail === 0 && afterAck.data.overall.acknowledged.includes('excess-variance'));
  const passing = await act('acknowledge_finding', { finding: 'depth', reason: 'Expected' });
  const unknownFinding = await send('acknowledge_finding', { finding: 'nonsense', reason: 'Expected' });
  check('acknowledging a finding that passes changes nothing and says so; an unknown one lists the findings', `${passing.message} | ${unknownFinding.message}`, passing.ok && /nothing to acknowledge/.test(passing.message) && !unknownFinding.ok && /Separation of controls/.test(unknownFinding.message));

  // Scoring: a second preset, the same run not computed twice, refused parameters.
  const enrich2 = await act('score', { preset: 'Enrich2' });
  const again = await act('score', { preset: 'enrich2' });
  const enrich2Digest = outputDigest(scoreTable(exampleTable, workspaceDesign, { ...PRESETS.enrich2.parameters, normalization: 'wt' }).results);
  check('score with the Enrich2 preset: a new run equal to Node\'s', enrich2.message, enrich2.data.name === 'Run 2' && enrich2.data.outputSha256 === enrich2Digest);
  check('scoring the same inputs again shows the existing run', again.message, again.data.existing === true && again.data.id === enrich2.data.id);
  const refused = await send('score', { parameters: { pseudocount: 0 } });
  check('parameters that cannot score are refused with the reason', refused.message, !refused.ok && /pseudocount/i.test(refused.message));
  const dimsum = await act('score', { preset: 'DiMSum' });
  const dimsumNode = scoreTable(exampleTable, workspaceDesign, defaultParameters(workspaceDesign, null, 'dimsum')).results;
  check('score with the DiMSum preset: Node\'s run, and its fitted terms (a bottleneck at the inputs)', dimsum.message, dimsum.data.name === 'Run 3' && dimsum.data.outputSha256 === outputDigest(dimsumNode)
    && dimsum.data.dimsum.length === 3 && dimsum.data.dimsum.every((x, i) => x.input === +dimsumNode.replicates[i].dimsum.input.toPrecision(4) && x.input > 4 * x.output));

  // The map.
  const map = await act('render_map', { run: 'Run 1', color_by: 'SE', rows: 'hydro', zoom: 2 });
  const total = Object.values(map.data.counts).reduce((a, b) => a + b, 0);
  check('render_map: the map in words, by state, with the settings asked', `${map.data.colorBy}, ${map.data.rows}; ${JSON.stringify(map.data.counts)}`, map.data.colorBy === 'se' && map.data.rows === 'hydrophobicity' && total === 56 * 21 && /Variant-effect map/.test(map.message) && (await browser.eval(`Boolean(document.querySelector('.map-pane canvas'))`)));
  await act('render_map', { run: 'Run 1', color_by: 'score', rows: 'biochemical', zoom: 1 });

  // Figures (wave 6, slice 1): a page of panels, drawn in the window as Node draws it.
  const made = await act('create_figure', { name: 'Figure 1', size: 'double' });
  check('create_figure: a page two columns wide, shown in the Figures view', made.message, made.data.widthMm === 174 && made.data.heightMm === 120 && made.data.text === 7 && (await browser.eval(`document.getElementById('app').dataset.mode`)) === 'figures');
  const mapPanel = await act('add_figure_panel', { figure: 'Figure 1', run: 'Run 1', tracks: ['reference', 'effect'], height_mm: 90 });
  const textPanel = await act('add_figure_panel', { figure: 'Figure 1', kind: 'text', text: 'Abundance of every substitution in the SH3 domain of GRB2 (Human Domainome).', x_mm: 95, y_mm: 94, width_mm: 75, height_mm: 20 });
  const badPanel = await send('add_figure_panel', { figure: 'Figure 1', run: 'Run 1', from: 50, to: 10 });
  const badTrack = await send('add_figure_panel', { figure: 'Figure 1', run: 'Run 1', tracks: ['no-such-track'] });
  check('add_figure_panel: a run\'s map with two of its tracks, lettered A, and a text panel B where placed; a range backward and an unknown track refused, saying why', `${mapPanel.message} ${textPanel.message} ${badPanel.message} ${badTrack.message}`, mapPanel.data.panel.letter === 'A' && mapPanel.data.panel.notes.length === 0 && textPanel.data.panel.letter === 'B' && textPanel.data.panel.xMm === 95 && !badPanel.ok && /after/.test(badPanel.message) && !badTrack.ok && /reference, coverage, effect, uncertainty/.test(badTrack.message));
  const figureDoc = (await act('figures', { figure: 'Figure 1' })).data.figures[0];
  const run1Node = scoreTable(exampleTable, workspaceDesign, DEFAULT_PARAMETERS).results;
  const run1Model = buildMapModel(run1Node, workspaceDesign, { condition: 0, colorBy: 'score', rowOrder: 'biochemical' });
  const run1Tracks = builtinTracks(run1Model);
  const nodeResolved = new Map([[figureDoc.document.panels[0].id, { model: run1Model, results: run1Node, tracks: ['reference', 'effect'].map((id) => run1Tracks.find((t) => t.id === id)) }]]);
  await act('export_figure', { figure: 'Figure 1', path: join(out, 'figure-1.svg') });
  await act('export_figure', { figure: 'Figure 1', format: 'pdf', path: join(out, 'figure-1.pdf') });
  const png = await act('export_figure', { figure: 'Figure 1', dpi: 300, path: join(out, 'figure-1.png') });
  const windowSVG = readFileSync(join(out, 'figure-1.svg'), 'utf8');
  const nodeSVG = await figureSVG(figureDoc.document, nodeResolved);
  const windowManifest = readFigureManifest(windowSVG);
  check('export_figure SVG: the same bytes as Node draws the figure from its document and Run 1 scored in Node, with its manifest (intact) in <metadata>', `${windowSVG.length} bytes; manifest ${windowManifest ? (checkManifest(windowManifest).ok ? 'intact' : checkManifest(windowManifest).problem) : 'none'}`, windowManifest && checkManifest(windowManifest).ok && windowSVG === embedSVG(nodeSVG, windowManifest), `${nodeSVG.length} bytes and the manifest`);
  const windowPDF = readPDF(readFileSync(join(out, 'figure-1.pdf')));
  const pdfManifest = readFigureManifest(new Uint8Array(readFileSync(join(out, 'figure-1.pdf'))));
  const nodeRects = readSVG(nodeSVG);
  const pdfRects = sameRects(nodeRects.rects, windowPDF.rects);
  const pdfTexts = windowPDF.texts.map((b) => String.fromCharCode(...b));
  const svgTexts = asPDFText(nodeRects.texts).map((b) => String.fromCharCode(...b));
  check('export_figure PDF: a page of 174 × 120 mm drawing Node\'s rectangles and text, the manifest attached', `${windowPDF.width} × ${windowPDF.height} pt; ${pdfRects.why}; ${pdfTexts.length} strings`, windowPDF.width === 493.23 && windowPDF.height === 340.16 && pdfRects.ok && pdfTexts.join('|') === svgTexts.join('|') && JSON.stringify(pdfManifest?.panels) === JSON.stringify(windowManifest?.panels));
  const pngBytes = readFileSync(join(out, 'figure-1.png'));
  const pngW = pngBytes.readUInt32BE(16);
  const pngH = pngBytes.readUInt32BE(20);
  const phys = pngBytes.indexOf(Buffer.from('pHYs'));
  check('export_figure PNG at 300 dpi: 2055 × 1417 pixels, its resolution recorded (11811 pixels per meter), the manifest in it', `${png.message} ${pngW} × ${pngH}; pHYs ${phys > 0 ? pngBytes.readUInt32BE(phys + 4) : 'none'}`, pngW === 2055 && pngH === 1417 && phys > 0 && pngBytes.readUInt32BE(phys + 4) === 11811 && pngBytes[phys + 12] === 1 && JSON.stringify(readFigureManifest(new Uint8Array(pngBytes))?.panels) === JSON.stringify(windowManifest?.panels));
  const changedFigure = await act('set_figure', { figure: 'Figure 1', name: 'Figure 2', panels: [{ panel: 'A', from: 20, to: 40, height_mm: 60 }, { panel: 'B', y_mm: 70 }] });
  const offPage = await send('set_figure', { figure: 'Figure 2', panels: [{ panel: 'B', x_mm: 160 }] });
  const unknownPanel = await send('set_figure', { figure: 'Figure 2', panels: [{ panel: 'Z', remove: true }] });
  check('set_figure: renamed, panel A showing positions 20–40 and shorter, B moved; a panel off the page and an unknown one refused, saying why', `${changedFigure.data.name}: ${changedFigure.data.panels.map((p) => `${p.letter} ${p.shows}`).join('; ')}. ${offPage.message} ${unknownPanel.message}`, changedFigure.data.name === 'Figure 2' && changedFigure.data.panels[0].shows === 'the map of Run 1, positions 20–40' && changedFigure.data.panels[0].heightMm === 60 && changedFigure.data.panels[1].yMm === 70 && !offPage.ok && /leave the page/.test(offPage.message) && !unknownPanel.ok && /not a panel/.test(unknownPanel.message));
  const noTokenFigure = await send('export_figure', { figure: 'Figure 2', path: join(out, 'x.svg') }, { withToken: false });
  check('export_figure without the token is refused', `${noTokenFigure.status}`, noTokenFigure.status === 401);

  // Selection and the inspector.
  const sel = await act('select_variants', { positions: [36], filter: 'scored', save_as: 'Position 36', run: '1' });
  check('select_variants by position, saved by name', sel.message, sel.data.variants.length >= 15 && sel.data.saved === 'Position 36' && (await act('get_state')).data.selections.some((s) => s.name === 'Position 36'));
  const byName = await act('select_variants', { variants: [sel.data.variants[0], sel.data.variants[1].replace('p.', '')] });
  check('select_variants by name (with or without "p.")', byName.message, byName.data.variants.length === 2);
  const notOnMap = await send('select_variants', { variants: ['p.Trp999Ala'] });
  check('a variant not on the map is refused with the positions', notOnMap.message, !notOnMap.ok && /1–56/.test(notOnMap.message));
  const node = scoreTable(exampleTable, workspaceDesign, DEFAULT_PARAMETERS).results;
  const key = sel.data.variants[0];
  const row = node.variants.key.indexOf(key);
  const inspected = await act('inspect_variant', { variant: key, run: 'Run 1' });
  const c = node.conditions[0];
  check('inspect_variant: the score, SE and counts of Node\'s scoring', inspected.message, inspected.data.score === +c.score[row].toPrecision(4) && inspected.data.se === +c.se[row].toPrecision(4) && inspected.data.replicates.length === 3 && Object.keys(inspected.data.counts).length === exampleDesign.samples.length
    && (await browser.eval(`window.mavescape.store.ui.focus?.kind`)) === 'variant');
  const missing = await act('inspect_variant', { variant: 'p.Trp1Ala', run: 'Run 1' }).catch((e) => ({ message: e.message, data: {} }));
  check('inspect_variant of a variant not measured says so', missing.message, missing.data.measured === false || /not/.test(missing.message));

  // Focus.
  const focusRun = await act('focus', { kind: 'run', name: 'Run 2' });
  const focusVariant = await act('focus', { name: key });
  const focusNone = await send('focus', { kind: 'table', name: 'no such table' });
  check('focus: a run, a variant by name, and an unknown name listing the choices', `${focusRun.message} ${focusVariant.message} ${focusNone.message}`, focusRun.data.name === 'Run 2' && focusVariant.data.variant === key && !focusNone.ok && /GRB2/.test(focusNone.message));

  // Exports, written by the program, need the token and an absolute path that does not exist yet.
  const noToken = await send('export', { what: 'scores', path: join(out, 'x.csv') }, { withToken: false });
  check('export without the token is refused', `${noToken.status}: ${noToken.error}`, noToken.status === 401);
  const files = {
    scores: 'scores.csv', counts: 'counts.csv', 'qc-samples': 'qc_samples.csv', 'qc-variants': 'qc_variants.csv', 'qc-findings': 'qc_findings.csv',
    provenance: 'provenance.json', methods: 'methods.md', references: 'references.bib', map: 'map.svg',
  };
  for (const [what, file] of Object.entries(files)) await act('export', { what, path: join(out, file), run: 'Run 1' });
  await act('export', { what: 'selection', selection: 'Position 36', path: join(out, 'selection.csv') });
  await act('export', { what: 'selection', selection: 'position 36', path: join(out, 'selection.json') });
  const archived = await act('export', { what: 'archive', path: join(out, 'grb2.msz') });
  const exists = await send('export', { what: 'scores', path: join(out, 'scores.csv') });
  check('export refuses to replace a file unless told', `${exists.status}: ${exists.error}`, exists.status === 400 && /overwrite/.test(exists.error));
  const relative = await send('export', { what: 'scores', path: 'scores.csv' });
  check('export refuses a relative path', `${relative.status}: ${relative.error}`, relative.status === 400);
  const overwritten = await send('export', { what: 'scores', path: join(out, 'scores.csv'), overwrite: true, run: 'Run 1' });
  check('export replaces a file when told', overwritten.message, overwritten.ok);

  // Every export equals the same file made in Node from the exported archive.
  const archive = await readArchive(readFileSync(join(out, 'grb2.msz')));
  check('the exported archive opens', `${archived.message} ${archive.problems.length} problems`, archive.problems.length === 0 && archive.ws.runs.length === 3 && archive.ws.selections.length === 1);
  check('the archive keeps the figure as the workspace has it', `${archive.ws.figures?.map((f) => `${f.name}, ${f.panels.length} panels`).join('; ') ?? 'none'}`, archive.ws.figures?.length === 1 && archive.ws.figures[0].name === 'Figure 2' && archive.ws.figures[0].panels.length === 2);
  // The workspace's report (wave 6, slice 4), in the archive as Node writes it from the archive: each
  // run's QC findings and scores recomputed, the window's MaveScape (its version and commit).
  const info = await (await fetch(`${connection.url}/api/info`)).json();
  const windowSoftware = { version: info.version, commit: info.commit ?? '' };
  const recomputedRuns = (w, sources) => new Map(w.runs.map((run, i) => {
    const x = recompute(w, sources, i);
    return [run.id, { table: x.table, results: x.scored.results }];
  }));
  const archiveReport = writeReport(archive.ws, contextOf(archive.ws, recomputedRuns(archive.ws, archive.sources), windowSoftware));
  check('the archive carries the workspace\'s report (report.md, report.bib) as Node writes it from the archive, each run\'s QC and scores recomputed', `${archive.report ? `${archive.report.markdown.length} characters, ${archive.report.bibtex.split('@').length - 1} references` : 'none'}; ${archive.report?.markdown === archiveReport.markdown && archive.report?.bibtex === archiveReport.bibtex ? 'Node\'s' : 'not Node\'s'}`, archive.report?.markdown === archiveReport.markdown && archive.report?.bibtex === archiveReport.bibtex);
  const { table, scored } = recompute(archive.ws, archive.sources);
  const expected = allExports(archive.ws, table, scored.results);
  for (const name of ['scores.csv', 'counts.csv', 'qc_samples.csv', 'qc_variants.csv', 'qc_findings.csv', 'methods.md', 'references.bib', 'map.svg', 'selection.csv', 'selection.json']) {
    const written = readFileSync(join(out, name), 'utf8');
    check(`export ${name}: the same bytes as Node's from the archive`, `${written.length} bytes`, written === expected[name], `${expected[name].length} bytes`);
  }
  const methodsWritten = readFileSync(join(out, 'methods.md'), 'utf8');
  check('the methods name the target\'s check against UniProt, cite UniProt, and the archive keeps the check', /checked against UniProt P62993 \[\d+\], release 2026_03, retrieved 2026-10-10: residues 159–214, identical/.exec(methodsWritten)?.[0] ?? 'not named', /checked against UniProt P62993/.test(methodsWritten) && /UniProt Consortium/.test(readFileSync(join(out, 'references.bib'), 'utf8')) && archive.ws.targets[0].reference?.release === '2026_03');
  const provenance = JSON.parse(readFileSync(join(out, 'provenance.json'), 'utf8'));
  const expectedProvenance = JSON.parse(expected['provenance.json']);
  delete provenance.files;
  delete expectedProvenance.files;
  check('export provenance.json: Node\'s, but for the file names', `${Object.keys(provenance).length} fields`, JSON.stringify(provenance) === JSON.stringify(expectedProvenance));

  // Comparisons (wave 4, slice 1): two replicates, one table scored twice, two scales; each as Node
  // compares the runs it recomputes from the exported archive, and the files the same bytes.
  const nodeRuns = archive.ws.runs.map((run, i) => ({ run, results: recompute(archive.ws, archive.sources, i).scored.results }));
  const nodeCompare = (a, b) => compareSides(describeSide(archive.ws, nodeRuns[a[0]].run, nodeRuns[a[0]].results, a[1]), describeSide(archive.ws, nodeRuns[b[0]].run, nodeRuns[b[0]].results, b[1]));
  const withoutSoftware = (text) => { const { software, ...rest } = JSON.parse(text); return JSON.stringify(rest); };
  const reps = nodeRuns[0].results.replicates.map((r) => r.id);
  const repCompare = await act('compare', { a: 'Run 1: Replicate 1', b: 'Run 1: Replicate 2' });
  const repNode = nodeCompare([0, { run: nodeRuns[0].run.id, replicate: reps[0] }], [0, { run: nodeRuns[0].run.id, replicate: reps[1] }]);
  check('compare: GRB2\'s replicates 1 and 2 in the Compare view, the report and every statistic as Node compares them', repCompare.message.slice(0, 200), JSON.stringify(repCompare.data) === withoutSoftware(comparisonJSON(repNode)) && repCompare.data.report.status === 'ok' && (await browser.eval(`document.getElementById('app').dataset.mode`)) === 'compare' && (await browser.eval(`Boolean(document.querySelector('.compare-report'))`)));
  // Every view's plots as panels (wave 6, slice 2): drawn in the window as Node draws them from the
  // runs it recomputes from the archive.
  await act('create_figure', { name: 'Every view', height_mm: 200 });
  const qcPanel = await act('add_figure_panel', { figure: 'Every view', kind: 'qc', subject: 'Run 1', finding: 'agreement', x_mm: 3, y_mm: 3, width_mm: 83, height_mm: 62 });
  await act('add_figure_panel', { figure: 'Every view', kind: 'scores', run: 'Run 1', x_mm: 89, y_mm: 3, width_mm: 82, height_mm: 62 });
  await act('add_figure_panel', { figure: 'Every view', kind: 'compare', a: 'Run 1', b: 'Run 2', x_mm: 3, y_mm: 68, width_mm: 83, height_mm: 70 });
  await act('add_figure_panel', { figure: 'Every view', kind: 'variant', run: 'Run 1', variant: 'p.Trp36Ala', x_mm: 89, y_mm: 68, width_mm: 82, height_mm: 50 });
  const noFinding = await send('add_figure_panel', { figure: 'Every view', kind: 'qc', finding: 'no-such-finding' });
  const noVariant = await send('add_figure_panel', { figure: 'Every view', kind: 'variant', variant: 'p.Trp999Ala' });
  const everyDoc = (await act('figures', { figure: 'Every view' })).data.figures[0].document;
  await act('export_figure', { figure: 'Every view', path: join(out, 'every-view.svg') });
  const everySVG = readFileSync(join(out, 'every-view.svg'), 'utf8');
  {
    const [r1, r2] = nodeRuns;
    const t = withDefaultThresholds(archive.ws.qc?.thresholds);
    const qcNode = computeQC({ ...inputFor(table, r1.run.inputs.design), design: r1.run.inputs.design, results: r1.results });
    const finding = findingsFrom(qcNode, t, { acknowledged: archive.ws.qc?.acknowledged }).find((f) => f.id === 'agreement');
    const sides = [describeSide(archive.ws, r1.run, r1.results, { run: r1.run.id, condition: 0 }), describeSide(archive.ws, r2.run, r2.results, { run: r2.run.id, condition: 0 })];
    const resolvedNode = new Map([
      [everyDoc.panels[0].id, qcPanelData(finding, qcNode, t, { pair: 0 })],
      [everyDoc.panels[1].id, scoreCharts(r1.results, r1.run)],
      [everyDoc.panels[2].id, comparisonCharts({ ...compareSides(sides[0], sides[1]), sides }, 'agreement')],
      [everyDoc.panels[3].id, variantCharts(r1.results, r1.run, 'p.Trp36Ala')],
    ]);
    const nodeEverySVG = await figureSVG(everyDoc, resolvedNode);
    const everyManifest = readFigureManifest(everySVG);
    check('add_figure_panel of every view\'s plots (a QC finding\'s, the scores by class, a comparison, a variant\'s evidence) and export_figure: the window\'s SVG the same bytes as Node draws the same document from Run 1 and Run 2 recomputed from the archive, with its manifest; an unknown finding and a variant not measured refused, saying why', `${everySVG.length} bytes against ${nodeEverySVG.length}; ${qcPanel.data.panel.shows}; ${noFinding.message.slice(0, 60)}; ${noVariant.message.slice(0, 60)}`, everyManifest && everySVG === embedSVG(nodeEverySVG, everyManifest) && !noFinding.ok && /Name the finding|not raised|no-such/.test(noFinding.message) && !noVariant.ok && /is not in Run \d/.test(noVariant.message));
    // What the figure carries (wave 6, slice 3): its manifest as Node writes it from the archive.
    const nodeManifest = buildManifest(archive.ws, everyDoc, figureMarks(everyDoc, resolvedNode), { software: everyManifest.software, created: everyManifest.created });
    check('export_figure\'s manifest: what Node writes from the archive (each panel\'s inputs: Run 1\'s and Run 2\'s outputs and their table by SHA-256, the QC thresholds, the comparison\'s sides; a digest of each panel\'s drawing; MaveScape\'s version; its fingerprint)', `${everyManifest.panels.map((p) => `${p.letter}: ${p.shows}`).join('; ')}; fingerprint ${everyManifest.fingerprint.slice(0, 12)}… against ${nodeManifest.fingerprint.slice(0, 12)}…`, JSON.stringify(nodeManifest) === JSON.stringify(everyManifest) && everyManifest.panels[0].inputs.run.output === r1.run.output.sha256);
  }
  {
    // The manifest alone; the figure read back, edited, rebuilt and opened in the window.
    const asJSON = await act('export_figure', { figure: 'Every view', format: 'json', path: join(out, 'every-view.json') });
    const jsonManifest = JSON.parse(readFileSync(join(out, 'every-view.json'), 'utf8'));
    const svgManifest = readFigureManifest(readFileSync(join(out, 'every-view.svg'), 'utf8'));
    check('export_figure json: the manifest alone, the SVG\'s but for when it was written', asJSON.message, checkManifest(jsonManifest).ok && JSON.stringify(jsonManifest.panels) === JSON.stringify(svgManifest.panels) && JSON.stringify(jsonManifest.figure) === JSON.stringify(svgManifest.figure) && asJSON.message.includes(jsonManifest.fingerprint.slice(0, 12)));
    const checked = await act('check_figure', { paths: [join(out, 'every-view.svg')] });
    check('check_figure of the figure\'s SVG in its own workspace: its manifest intact, every panel as it was drawn from', checked.message, checked.data.intact && checked.data.workspace.same && checked.data.panels.length === 4 && checked.data.panels.every((p) => p.status === 'unchanged'));
    const edited = readFileSync(join(out, 'every-view.svg'), 'utf8').replace('"shows":"score distributions by class of Run 1"', '"shows":"score distributions by class of Run 2"');
    writeFileSync(join(out, 'every-view-edited.svg'), edited);
    const tampered = await act('check_figure', { paths: [join(out, 'every-view-edited.svg')] });
    const plain = await send('check_figure', { paths: [join(out, 'map.svg')] });
    check('check_figure: a manifest edited after it was written is caught (its fingerprint); a file without one refused, saying so', `${tampered.data.problem} | ${plain.message}`, edited.includes('of Run 2"') && tampered.data.intact === false && /changed after it was written/.test(tampered.data.problem) && !plain.ok && /no MaveScape figure manifest/.test(plain.message));
    const rebuilt = await act('check_figure', { paths: [join(out, 'every-view.svg')], rebuild: true });
    const listedFigures = (await act('figures')).data.figures.map((f) => f.name);
    check('check_figure with rebuild: the figure added to the workspace from its manifest, each panel drawn again the same drawing the file records', `${rebuilt.data.rebuilt?.figure}: ${rebuilt.data.rebuilt?.panels.map((p) => `${p.letter} ${p.same ? 'the same' : 'different'}`).join(', ')}`, rebuilt.data.rebuilt?.panels.length === 4 && rebuilt.data.rebuilt.panels.every((p) => p.same) && listedFigures.includes(rebuilt.data.rebuilt.figure));
    await act('open_files', { paths: [join(out, 'every-view.svg')] });
    await sleep(300);
    const dialog = await browser.eval(`(() => { const d = document.querySelector('.dialog[aria-label="A figure from MaveScape"]'); return d ? { rows: d.querySelectorAll('tbody tr').length, badges: [...d.querySelectorAll('tbody .badge')].map((b) => b.textContent), buttons: [...d.querySelectorAll('.dialog-foot button')].map((b) => b.textContent) } : null; })()`);
    await browser.eval(`document.querySelector('.dialog[aria-label="A figure from MaveScape"] .dialog-head button')?.click()`);
    check('open_files of the figure: the window says what it shows and where it came from, panel by panel as it was, and offers to rebuild it', JSON.stringify(dialog), dialog?.rows === 4 && dialog.badges.every((b) => b === 'as then') && dialog.buttons.includes('Rebuild here'));
  }
  const runsCompare = await act('compare', { a: 'Run 1', b: 'Run 2' });
  check('compare: Run 1 against Run 2 (the Enrich2 preset): one table scored twice, qualified, on one scale', runsCompare.data.report.items.find((i) => i.id === 'independence').text, runsCompare.data.report.status === 'qualified' && runsCompare.data.sameScale === true && runsCompare.data.statistics.concordance !== null);
  const scalesCompare = await act('compare', { a: 'Run 1', b: 'Run 3' });
  const scalesNode = nodeCompare([0, { run: nodeRuns[0].run.id, condition: 0 }], [2, { run: nodeRuns[2].run.id, condition: 0 }]);
  check('compare: Run 1 against Run 3 (DiMSum\'s fitness): two scales, so Lin\'s concordance, Bland–Altman, discordance and disagreement by position withheld, saying why', scalesCompare.data.report.items.find((i) => i.id === 'scale').text, scalesCompare.data.sameScale === false && scalesCompare.data.withheld.join() === 'concordance,blandAltman,discordance,positions' && JSON.stringify(scalesCompare.data) === withoutSoftware(comparisonJSON(scalesNode)));
  await act('export', { what: 'comparison', path: join(out, 'comparison.csv') });
  await act('export', { what: 'comparison', path: join(out, 'comparison.json') });
  const comparedCSV = readFileSync(join(out, 'comparison.csv'), 'utf8');
  const comparedJSON = readFileSync(join(out, 'comparison.json'), 'utf8');
  check('export comparison: the matched variants (CSV) and the report and statistics (JSON) of the comparison shown, as Node writes them', `${comparedCSV.split('\n').length - 2} variants; ${JSON.parse(comparedJSON).a.label} and ${JSON.parse(comparedJSON).b.label}`, comparedCSV === comparisonCSV(scalesNode) && withoutSoftware(comparedJSON) === withoutSoftware(comparisonJSON(scalesNode)) && JSON.parse(comparedJSON).software?.version === connection.version);
  // Slice 2: a filter, the discordant variants and the disagreement by position, and the maps.
  const rep1 = describeSide(archive.ws, nodeRuns[0].run, nodeRuns[0].results, { run: nodeRuns[0].run.id, replicate: reps[0] });
  const rep2 = describeSide(archive.ws, nodeRuns[0].run, nodeRuns[0].results, { run: nodeRuns[0].run.id, replicate: reps[1] });
  const filteredCompare = await act('compare', { a: 'Run 1: Replicate 1', b: 'Run 1: Replicate 2', max_se: 0.3 });
  const filteredNode = compareSides(rep1, rep2, { filters: { lowConfidence: false, maxSE: 0.3, minReads: null } });
  check('compare with a filter (SE at most 0.3): the variants left out, the discordant variants and the disagreement by position, as Node gives them', filteredCompare.message.slice(0, 220), JSON.stringify(filteredCompare.data) === withoutSoftware(comparisonJSON(filteredNode)) && filteredCompare.data.matched.filtered.se > 0 && filteredCompare.data.discordance.valid && filteredCompare.data.positions.list.length > 40);
  await act('export', { what: 'comparison-positions', path: join(out, 'comparison_positions.csv') });
  await act('export', { what: 'comparison-map', path: join(out, 'comparison_difference.svg') });
  await act('export', { what: 'comparison-map', map: 'second', path: join(out, 'comparison_second.svg') });
  const palette = (await browser.eval('window.mavescape.mapView?.palette ?? null')) ?? 'rdbu';
  const diffNode = differenceMap(filteredNode, rep1);
  const diffSVG = mapSVG(buildMapModel(diffNode.results, diffNode.design, { colorBy: 'differential', contrast: 0 }), { palette, results: diffNode.results });
  const secondNode = sideMap(rep2);
  const secondSVG = mapSVG(buildMapModel(secondNode.results, secondNode.design, { condition: secondNode.condition }), { palette, results: secondNode.results });
  check('export comparison-positions and comparison-map (the difference, and the second side\'s): the same bytes as Node\'s', `${readFileSync(join(out, 'comparison_positions.csv'), 'utf8').split('\n').length - 2} positions; maps ${readFileSync(join(out, 'comparison_difference.svg'), 'utf8').length} and ${readFileSync(join(out, 'comparison_second.svg'), 'utf8').length} bytes`, readFileSync(join(out, 'comparison_positions.csv'), 'utf8') === positionsCSV(filteredNode) && readFileSync(join(out, 'comparison_difference.svg'), 'utf8') === diffSVG && readFileSync(join(out, 'comparison_second.svg'), 'utf8') === secondSVG);
  await act('compare', { a: 'Run 1: Replicate 1', b: 'Run 1: Replicate 2', max_se: null });
  const noSide = await send('compare', { a: 'Run 9' });
  check('compare with a side that does not exist: refused, listing the sides', noSide.message, !noSide.ok && /No side "Run 9"/.test(noSide.message) && /Run 1: Replicate 2/.test(noSide.message));

  // Sequence tracks (wave 3, slice 5), offline, from the cached answers: the run's own, hidden until
  // shown; annotations from public data and from files; shown, moved, filtered; beside a variant;
  // in the exports, the archive and the methods, as Node makes them.
  const bare = await act('list_tracks', { run: 'Run 1' });
  const why = Object.fromEntries(bare.data.available.map((p) => [p.provider, p.unavailable ?? null]));
  check('list_tracks: the run\'s own four (reference, coverage, position effect, uncertainty), hidden until shown; what can be added, and why a MaveDB record\'s annotations cannot', `${bare.message} mavedb-annotations: ${why['mavedb-annotations']}`, bare.data.tracks.length === 4 && bare.data.tracks.every((t) => !t.shown) && why.clinvar === null && why['uniprot-features'] === null && /not of a MaveDB record/.test(why['mavedb-annotations'] ?? ''));
  const historyBefore = await browser.eval('window.mavescape.store.ws.history.length');
  const addedPublic = [];
  for (const provider of ['uniprot-features', 'pdbe-conservation', 'alphamissense', 'clinvar', 'gnomad']) addedPublic.push(await act('add_track', { provider, run: 'Run 1' }));
  check('add_track from public data, offline from the cache: UniProt\'s features, PDBe-KB\'s conservation, AlphaMissense, ClinVar and gnomAD for GRB2\'s SH3 domain, each in the history', addedPublic.map((a) => `${a.data.name}: ${a.data.tracks.map((t) => t.label).join(', ')}`).join('; '), addedPublic.length === 5 && addedPublic.map((a) => a.data.tracks.length).join() === '3,1,1,1,1' && (await browser.eval('window.mavescape.store.ws.history.length')) === historyBefore + 5);
  const twice = await send('add_track', { provider: 'clinvar' });
  const notMaveDB = await send('add_track', { provider: 'mavedb-annotations' });
  check('the same annotation twice, and MaveDB\'s annotations of a run not from MaveDB: refused, saying why', `${twice.message} ${notMaveDB.message}`, !twice.ok && /already/.test(twice.message) && !notMaveDB.ok && /not of a MaveDB record/.test(notMaveDB.message));
  const fromAlignment = await act('add_track', { name: 'grb2-sh3.sto', text: readFileSync(join(ROOT, 'validation/fixtures/annotations/grb2-sh3.sto'), 'utf8') });
  const fromGFF = await act('add_track', { name: 'P62993.gff', text: readFileSync(join(ROOT, 'validation/fixtures/annotations/P62993.gff'), 'utf8') });
  const notATrack = await send('add_track', { name: 'notes.txt', text: 'Nothing to draw.' });
  check('add_track from files: an alignment (conservation, the query on positions 4–49) and UniProt\'s GFF3; a file that is neither refused', `${fromAlignment.message.slice(0, 160)}… ${fromGFF.data.tracks.length} tracks from the GFF3; ${notATrack.message.slice(0, 80)}`, /4–49/.test(fromAlignment.message) && fromGFF.data.tracks.length === 3 && !notATrack.ok);
  const historyAfterAdding = await browser.eval('window.mavescape.store.ws.history.length');
  const shownCoverage = await act('set_track', { track: 'Coverage', shown: true });
  const moved = await act('set_track', { track: 'ClinVar', position: 1 });
  const uncertain = await act('set_track', { track: 'ClinVar', filter: { classes: ['uncertain'] } });
  const frequent = await act('set_track', { track: 'gnomAD', filter: { min: 1e-5 } });
  const wrongFilter = await send('set_track', { track: 'Coverage', filter: { stars: 2 } });
  const arranged = await act('list_tracks');
  const clinvarNow = arranged.data.tracks[0];
  check('set_track: coverage shown, ClinVar moved to the top and filtered to uncertain significance, gnomAD to AF ≥ 10⁻⁵; a filter a track does not offer refused; none of it in the history (a view)', `${shownCoverage.message} ${moved.message} ${uncertain.message} ${frequent.message} ${wrongFilter.message}`, clinvarNow.label === 'ClinVar' && clinvarNow.variants === 1 && /uncertain/.test(clinvarNow.filtered ?? '') && arranged.data.tracks.find((t) => t.label === 'Coverage').shown && !wrongFilter.ok && (await browser.eval('window.mavescape.store.ws.history.length')) === historyAfterAdding);
  const annotated = await act('inspect_variant', { variant: 'W36A', run: 'Run 1' });
  const notes = Object.fromEntries((annotated.data.annotations ?? []).map((a) => [a.track, a.text]));
  check('inspect_variant: a variant\'s annotations, from the tracks (AlphaMissense\'s score and class, the domain and strand it lies in, its conservation)', JSON.stringify(notes).slice(0, 300), /likely pathogenic/.test(notes.AlphaMissense ?? '') && /SH3 2/.test(notes['Domains and regions'] ?? '') && /Beta strand/.test(notes['Secondary structure'] ?? '') && /bits/.test(notes['Conservation (PDBe-KB)'] ?? ''));
  await act('export', { what: 'tracks', run: 'Run 1', path: join(out, 'tracks.csv') });
  await act('export', { what: 'map', run: 'Run 1', path: join(out, 'map-tracks.svg') });
  await act('export', { what: 'methods', run: 'Run 1', path: join(out, 'methods-tracks.md') });
  await act('export', { what: 'archive', path: join(out, 'grb2-tracks.msz') });
  const withTracks = await readArchive(readFileSync(join(out, 'grb2-tracks.msz')));
  const tRun = withTracks.ws.runs[0];
  const { scored: tScored } = recompute(withTracks.ws, withTracks.sources);
  const tModel = buildMapModel(proteinView(tScored.results) ?? tScored.results, tRun.inputs.design);
  const tShown = nodeTracks(withTracks.ws, tRun, tModel, withTracks.sources).filter((t) => t.shown);
  const tracksWritten = readFileSync(join(out, 'tracks.csv'), 'utf8');
  const svgWritten = readFileSync(join(out, 'map-tracks.svg'), 'utf8');
  check('the archive keeps the annotations\' files and the arrangement; the tracks exported (CSV) and the map with its tracks (SVG) are the same bytes as Node\'s from the archive', `${withTracks.ws.annotations.length} annotations, ${withTracks.problems.length} problems; ${tShown.length} tracks shown (${tShown.map((t) => t.label).join(', ')}); tracks.csv ${tracksWritten === tracksCSV(tShown, tModel) ? 'Node\'s' : 'different'}; map ${svgWritten === mapSVG(tModel, { results: proteinView(tScored.results) ?? tScored.results, tracks: tShown }) ? 'Node\'s' : 'different'}`, withTracks.ws.annotations.length === 7 && !withTracks.problems.length && tracksWritten === tracksCSV(tShown, tModel) && svgWritten === mapSVG(tModel, { results: proteinView(tScored.results) ?? tScored.results, tracks: tShown }) && /ClinVar/.test(svgWritten));
  const tMethods = readFileSync(join(out, 'methods-tracks.md'), 'utf8');
  check('the methods name each annotation with its source and date, and cite ClinVar, gnomAD, AlphaMissense, PDBe-KB and Capra & Singh', /Annotations shown beside the map: [^\n]{0,200}/.exec(tMethods)?.[0] ?? 'not named', /Annotations shown beside the map/.test(tMethods) && ['Landrum', 'Chen S', 'Cheng J', 'PDBe-KB consortium', 'Capra JA'].every((who) => tMethods.includes(who)));
  const gffId = fromGFF.data.annotation;
  const removedTrack = await act('remove_track', { annotation: gffId });
  const afterRemoval = await act('list_tracks');
  check('remove_track: the GFF3\'s annotation and its tracks gone', `${removedTrack.message} ${afterRemoval.data.tracks.length} tracks`, !afterRemoval.data.tracks.some((t) => t.annotation === gffId) && afterRemoval.data.tracks.length === 4 + 3 + 1 + 1 + 1 + 1 + 1);

  // Other sources and scales (wave 4, slice 3), offline from the cache: GRB2's Run 1 against its
  // record's published scores, kept beside the workspace by URN without opening it, rescaled by
  // their anchors; against AlphaMissense (added above) by rank and by its classes; each as Node
  // compares them, and the files the same bytes.
  const runOne = describeSide(archive.ws, nodeRuns[0].run, nodeRuns[0].results, { run: nodeRuns[0].run.id, condition: 0 });
  const viaUrn = await act('compare', { a: 'Run 1', b: 'urn:mavedb:00000835-a-1', scale: 'nonsense-wt' });
  const keptSet = scoreSetSide('urn:mavedb:00000835-a-1', join(ROOT, 'validation/fixtures/public-data/mavedb/urn_mavedb_00000835-a-1.scores.csv'));
  const viaUrnNode = compareSides(runOne, keptSet.side, { scale: 'nonsense-wt' });
  const keptNow = await browser.eval('JSON.stringify((window.mavescape.store.ws.annotations ?? []).filter((a) => a.provider === "mavedb-scores").map((a) => [a.id, a.file.sha256, a.record.scoreSet.urn]))');
  check('compare with a MaveDB score set by its URN: fetched (from the cache) and kept beside the workspace without opening it, its scores read as published, rescaled with Run 1 by their anchors: the report and statistics as Node gives them', `${viaUrn.message.slice(0, 240)}… kept: ${keptNow}`, JSON.stringify(viaUrn.data) === withoutSoftware(comparisonJSON(viaUrnNode)) && viaUrn.data.scale.applied && viaUrn.data.statistics.concordance.ccc > 0.99 && JSON.parse(keptNow).length === 1 && JSON.parse(keptNow)[0][1] === keptSet.annotation.file.sha256 && (await act('get_state')).data.runs.length === 3);
  await act('export', { what: 'comparison', path: join(out, 'comparison_scoreset.csv') });
  const amCompare = await act('compare', { a: 'Run 1', b: 'AlphaMissense: P62993', scale: 'scored', show: 'classes' });
  const amNode = compareSides(runOne, predictorSide('alphamissense', readFileSync(join(ROOT, 'validation/fixtures/public-data/alphafold/P62993.aa-substitutions.csv'), 'utf8'), runOne, { name: 'AlphaMissense: P62993' }).side);
  await act('export', { what: 'comparison-classes', path: join(out, 'comparison_classes.csv') });
  check('compare with AlphaMissense: by rank and by its classes, as Node gives them, the Classes tab shown; the exports (the score set\'s variants compared, AlphaMissense\'s classes) the same bytes as Node\'s', amCompare.message.slice(0, 260), JSON.stringify(amCompare.data) === withoutSoftware(comparisonJSON(amNode)) && amCompare.data.classes.valid && readFileSync(join(out, 'comparison_scoreset.csv'), 'utf8') === comparisonCSV(viaUrnNode) && readFileSync(join(out, 'comparison_classes.csv'), 'utf8') === classesCSV(amNode) && (await browser.eval('Boolean(document.querySelector(".compare-classes"))')));
  const badScale = await send('compare', { scale: 'twice' });
  const setTracks = await act('list_tracks', { run: 'Run 1' });
  check('compare with a scale it does not know: refused, listing the scales; the score set\'s scores a track beside the map', `${badScale.message} ${setTracks.data.tracks.filter((t) => /00000835/.test(t.label)).map((t) => `${t.label}: ${t.summary ?? t.kind}`).join('; ')}`, !badScale.ok && /nonsense-wt/.test(badScale.message) && setTracks.data.tracks.some((t) => /urn:mavedb:00000835-a-1/.test(t.label)));

  // Robustness to analysis choices (wave 4, slice 4): Run 1 checked in the score worker, as Node
  // checks the run it recomputes from the archive; its files the same bytes.
  const robust = await act('check_robustness', { run: 'Run 1', max: 24 });
  const r1 = archive.ws.runs[0];
  const r1Recorded = recordedInputs(r1);
  const nodeCheck = checkTable(recompute(archive.ws, archive.sources, 0).table, r1Recorded.design, r1Recorded.parameters, { max: 24 });
  const nodeSpecs = nodeCheck.out.map(({ kind, picks, label, ok, error }) => ({ kind, picks, label, ok, error }));
  const { notes: robustNotes, ...robustData } = robust.data;
  await act('export', { what: 'robustness', run: 'Run 1', path: join(out, 'robustness.csv') });
  await act('export', { what: 'robustness', run: 'Run 1', path: join(out, 'robustness.json') });
  await act('export', { what: 'robustness-positions', run: 'Run 1', path: join(out, 'robustness_positions.csv') });
  const robustJSON = JSON.parse(readFileSync(join(out, 'robustness.json'), 'utf8'));
  const { software: robustSoftware, ...robustFile } = robustJSON;
  const robustParts = {
    data: JSON.stringify(robustData) === JSON.stringify(JSON.parse(robustnessJSON(nodeCheck.summary, r1, nodeSpecs))),
    csv: readFileSync(join(out, 'robustness.csv'), 'utf8') === robustnessCSV(nodeCheck.summary, nodeCheck.results),
    positions: readFileSync(join(out, 'robustness_positions.csv'), 'utf8') === robustnessPositionsCSV(nodeCheck.summary),
    record: JSON.stringify(robustFile) === JSON.stringify(JSON.parse(robustnessJSON(nodeCheck.summary, r1, nodeSpecs))) && robustSoftware?.version === connection.version,
    notes: robustNotes.length === 1,
    view: await browser.eval(`Boolean(document.querySelector('.robustness-pane .robustness-verdicts'))`),
  };
  check('check_robustness: Run 1 scored again 23 other ways in the score worker, each variant\'s verdict and each alternative\'s effect as Node finds them for the run it recomputes from the archive; its variants, positions and record the same bytes as Node\'s; the Score view shows it', `${robust.message.slice(0, 160)}… ${Object.entries(robustParts).map(([k, v]) => `${k} ${v ? 'as Node' : 'different'}`).join(', ')}`, Object.values(robustParts).every(Boolean));
  const focusedRobust = await act('inspect_variant', { variant: 'p.Trp36Ala', run: 'Run 1' });
  check('the inspector shows a checked variant\'s robustness: its class across the analyses and its verdict', String(await browser.eval(`[...document.querySelectorAll('#inspector h4')].some((e) => e.textContent === 'Robustness')`)), focusedRobust.ok && (await browser.eval(`[...document.querySelectorAll('#inspector h4')].some((e) => e.textContent === 'Robustness')`)));
  const publishedRobust = await send('check_robustness', { run: 'Run 1', max: 1 });
  check('check_robustness with too few analyses: refused, saying how many', publishedRobust.message, !publishedRobust.ok && /from 2 to 256/.test(publishedRobust.message));

  // Kept in the report (wave 6, slice 4): the comparison of Run 1 and Run 2 and Run 1's robustness,
  // as Node computes them; the window's report as Node writes it from the workspace's archive; its
  // files; an analysis taken out.
  {
    const keptCompare = await act('compare', { a: 'Run 1', b: 'Run 2', scale: 'scored', low_confidence: false, max_se: null, min_reads: null, report: true });
    const keptRobust = await act('check_robustness', { run: 'Run 1', max: 24, report: true });
    const shown = await act('report');
    await act('export', { what: 'archive', path: join(out, 'with-report.msz') });
    await act('export', { what: 'report', path: join(out, 'report.md') });
    await act('export', { what: 'report-references', path: join(out, 'report.bib') });
    const withReport = await readArchive(readFileSync(join(out, 'with-report.msz')));
    const strip = (a) => JSON.parse(JSON.stringify(a, (k, v) => (k === 'id' || k === 'created' ? undefined : v)));
    const [comparisonKept, robustnessKept] = withReport.ws.analyses ?? [];
    const pairNode = { a: { run: nodeRuns[0].run.id, condition: 0 }, b: { run: nodeRuns[1].run.id, condition: 0 } };
    const comparisonNode = comparisonRecord(nodeCompare([0, pairNode.a], [1, pairNode.b]), pairNode);
    const robustnessNode = robustnessRecord(r1, nodeCheck.summary, { max: 24, seed: ROBUSTNESS_SEED });
    check('compare and check_robustness with report: the comparison of Run 1 and Run 2 and Run 1\'s robustness kept in the workspace, in its history, as Node computes them from the archive (sides, scale, report, statistics; choices, analyses, verdicts)', `${keptCompare.data.report} and ${keptRobust.data.report}; ${withReport.ws.history.slice(-2).map((e) => e.detail).join(' | ')}`,
      JSON.stringify(strip(comparisonKept)) === JSON.stringify(strip(comparisonNode)) && JSON.stringify(strip(robustnessKept)) === JSON.stringify(strip(robustnessNode)) && withReport.ws.history.slice(-2).every((e) => e.action === 'report' && e.detail.startsWith('Added to the report')));
    const nodeReport = writeReport(withReport.ws, contextOf(withReport.ws, recomputedRuns(withReport.ws, withReport.sources), windowSoftware));
    const sections = shown.data.sections.filter((x) => x.title).map((x) => x.title);
    const view = await browser.eval(`(() => { const d = document.querySelector('.report-doc'); return d ? { headings: d.querySelectorAll('h3').length, references: d.querySelectorAll('.report-references li').length, kept: document.querySelectorAll('.report-kept li').length } : null; })()`);
    check('report: the window\'s report the same text as Node writes from the workspace\'s archive (and the archive\'s report.md and report.bib), shown in the Report view with its references and the two analyses kept; export report and report-references write it', `${sections.join(', ')}; ${shown.data.references.length} references; view ${JSON.stringify(view)}`,
      shown.data.markdown === nodeReport.markdown && shown.data.bibtex === nodeReport.bibtex && withReport.report?.markdown === nodeReport.markdown && readFileSync(join(out, 'report.md'), 'utf8') === nodeReport.markdown && readFileSync(join(out, 'report.bib'), 'utf8') === nodeReport.bibtex
      && sections.includes('Comparisons') && sections.includes('Robustness to analysis choices') && view?.headings === sections.length + 1 && view.references === shown.data.references.length && view.kept === 2);
    const taken = await act('report', { remove: 'the comparison of Run 1 and Run 2', show: false });
    const unknownAnalysis = await send('report', { remove: 'no such analysis' });
    check('report with remove: the comparison taken out of the report (in the history), the robustness check kept; an analysis not kept refused, listing those that are', `${taken.data.analyses.map((a) => a.name).join('; ')}; ${unknownAnalysis.message}`, taken.data.analyses.length === 1 && taken.data.analyses[0].kind === 'robustness' && !taken.data.sections.some((x) => x.id === 'comparisons') && !unknownAnalysis.ok && /is kept in the report\. Kept: Run 1's robustness/.test(unknownAnalysis.message));
  }

  // Selections by query (wave 4, slice 5), as Node selects on the run it recomputes from the archive:
  // a query, an operation on the selection, a saved selection used in another query, the robustness
  // verdicts (Run 1 checked above), a mistake named in place, and the selection's file.
  const r1Model = buildMapModel(nodeCheck.results, r1Recorded.design);
  const nodeQuery = (text, extra = {}) => selectByQuery(text, queryContext({ model: r1Model, results: nodeCheck.results, design: r1Recorded.design, ...extra })).keys;
  const q1 = await act('select_variants', { run: 'Run 1', query: 'missense at 10-30 with se < 0.2' });
  const q2 = await act('select_variants', { run: 'Run 1', query: 'low', operation: 'subtract', save_as: 'Core 10-30' });
  const q3 = await act('select_variants', { run: 'Run 1', query: 'in "Core 10-30" and lower' });
  const q4 = await act('select_variants', { run: 'Run 1', query: 'fragile or uncertain' });
  const badQuery = await send('select_variants', { run: 'Run 1', query: 'missense bananas' });
  const savedSets = [{ name: 'Core 10-30', keys: combineKeys(nodeQuery('missense at 10-30 with se < 0.2'), nodeQuery('low'), 'subtract') }];
  await act('export', { what: 'selection', selection: 'Core 10-30', path: join(out, 'core.json') });
  const coreFile = JSON.parse(readFileSync(join(out, 'core.json'), 'utf8'));
  const queryParts = {
    query: JSON.stringify(q1.data.variants) === JSON.stringify(nodeQuery('missense at 10-30 with se < 0.2')),
    subtract: JSON.stringify(q2.data.variants) === JSON.stringify(savedSets[0].keys) && q2.data.query === '(missense at 10-30 with se < 0.2) and not (low)',
    saved: (await act('get_state')).data.selections.some((x) => x.name === 'Core 10-30' && x.query === q2.data.query),
    set: JSON.stringify(q3.data.variants) === JSON.stringify(nodeQuery('in "Core 10-30" and lower', { sets: savedSets })),
    verdicts: q4.data.variants.length > 0 && JSON.stringify(q4.data.variants) === JSON.stringify(nodeQuery('fragile or uncertain', { robustness: nodeCheck.summary })),
    mistake: !badQuery.ok && /Unknown word "bananas"/.test(badQuery.message) && /character 10/.test(badQuery.message),
    file: coreFile.query === q2.data.query && JSON.stringify(coreFile.keys) === JSON.stringify(savedSets[0].keys),
    view: await browser.eval(`Boolean(document.querySelector('.map-query-input')) && /by query/.test(document.querySelector('.map-selection')?.textContent ?? '')`),
  };
  check('select_variants by query, as Node selects on the run it recomputes from the archive: a query, its matches subtracted from the selection (the query composed and saved with it), a saved selection named in a query, the robustness verdicts of the run checked, a mistake named in place; the saved selection\'s file keeps its query; the Map view shows the query', `${q1.data.count} by query, ${q2.data.count} after subtracting, ${q3.data.count} of the saved lower, ${q4.data.count} fragile or uncertain; ${Object.entries(queryParts).map(([k, v]) => `${k} ${v ? 'ok' : 'different'}`).join(', ')}`, Object.values(queryParts).every(Boolean));

  // Files by path, into a new workspace: GRB2's own files, the design set, the same scores.
  const noTokenOpen = await send('open_files', { paths: [join(ROOT, 'web/examples/grb2-sh3/counts.csv')] }, { withToken: false });
  check('open_files without the token is refused', `${noTokenOpen.status}: ${noTokenOpen.error}`, noTokenOpen.status === 401);
  const blank = await act('new_workspace', { name: 'From files' });
  check('new_workspace', blank.message, blank.data.name === 'From files' && (await act('get_state')).data.tables.length === 0);
  const fromFiles = await act('open_files', { paths: [join(ROOT, 'web/examples/grb2-sh3/counts.csv'), join(ROOT, 'web/examples/grb2-sh3/target.fasta')] });
  check('open_files: the table imported with the target', fromFiles.message, fromFiles.data.tables.length === 1 && fromFiles.data.targets.length === 1);
  const draft = await act('draft_design');
  check('draft_design from the column names', draft.message, draft.data.model === 'two-population' && draft.data.samples === exampleDesign.samples.length);
  const badDesign = await send('set_design', { design: { ...exampleDesign, samples: exampleDesign.samples.map((s, i) => (i ? s : { ...s, columns: ['no_such_column'] })) } });
  check('set_design refuses a design that does not fit the table, listing why', badDesign.message, !badDesign.ok && /no_such_column/.test(badDesign.message));
  const set = await act('set_design', { design: exampleDesign });
  const rescored = await act('score');
  check('set_design, then score: the example\'s run, from files opened by path', `${set.message} ${rescored.message}`, set.data.valid && rescored.data.outputSha256 === nodeDigest);
  const inAnother = await act('check_figure', { paths: [join(out, 'every-view.svg')] });
  check('check_figure in another workspace that scored the same table to the same output: Run 1\'s panels found by its output\'s SHA-256, as they were; the comparison missing Run 2', inAnother.message, !inAnother.data.workspace.same && inAnother.data.panels.map((p) => p.status).join() === 'unchanged,unchanged,missing,unchanged' && /Run 2 \(output [0-9a-f]{12}…\) is not in this workspace/.test(inAnother.data.panels[2].changes.join(' ')));
  // Checkpoints and the diff (wave 6, slice 5), in this workspace (its one run): a checkpoint kept,
  // the run scored again with another pseudocount and minimum input count, the changes as Node
  // finds them from the workspace's archive (each run recomputed, its QC read with each state's
  // thresholds); the same between two archives; shown in the Report view and the drawer's history.
  {
    const kept = await act('checkpoint', { name: 'Before the rescoring' });
    await act('export', { what: 'archive', path: join(out, 'diff-before.msz') });
    const noFrom = await send('diff', { from: 'no such checkpoint' });
    await act('score', { parameters: { pseudocount: 1, filters: { minInputCount: 10 } } });
    const diffed = await act('diff');
    await act('export', { what: 'archive', path: join(out, 'diff-after.msz') });
    const [archiveBefore, archiveAfter] = [await readArchive(readFileSync(join(out, 'diff-before.msz'))), await readArchive(readFileSync(join(out, 'diff-after.msz')))];
    const scoredOf = (read) => new Map(read.ws.runs.map((run, i) => [run.id, recompute(read.ws, read.sources, i)]));
    const after = scoredOf(archiveAfter);
    const tableOf = [...after.values()][0].table;
    const results = new Map([...after].map(([id, x]) => [id, x.scored.results]));
    const checkpointState = archiveAfter.ws.checkpoints[0].state;
    const nodeDiff = diffStates(checkpointState, analysisState(archiveAfter.ws), { pairs: pairsFor(checkpointState, analysisState(archiveAfter.ws), tableOf, results) });
    const strip = (x) => JSON.parse(JSON.stringify(x));
    check('checkpoint and diff: a checkpoint kept (in the history), the run scored again with pseudocount 1 and a minimum input count of 10; the changes the window finds (the run scored, the parameters, the variants moved, crossed, filtered and named) as Node finds them from the workspace\'s archive; an unknown checkpoint refused, listing those kept', `${kept.message.slice(0, 80)} | ${diffed.data.words.slice(1, 4).join(' ')} | ${noFrom.message}`,
      kept.data.checkpoints.length === 1 && archiveAfter.ws.checkpoints[0].sha256 === kept.data.checkpoints[0].sha256 && JSON.stringify(diffed.data.changes) === JSON.stringify(strip(nodeDiff.changes)) && JSON.stringify(diffed.data.pairs) === JSON.stringify(strip(nodeDiff.pairs)) && diffed.data.pairs[0].parameters.join() === 'the pseudocount 0.5 → 1,the minimum input count 1 → 10' && !noFrom.ok && /Before the rescoring/.test(noFrom.message));
    const shown = await browser.eval(`(() => ({ head: document.querySelector('.report-changes .report-title')?.textContent, map: Boolean(document.querySelector('.report-change-map svg')), rows: document.querySelectorAll('.report-changes tbody tr').length }))()`);
    await browser.eval('window.mavescape.toggleDrawer(true)');
    await sleep(200);
    const drawn = await browser.eval(`[...document.querySelectorAll('#drawer .history-list li.checkpoint button')].map((b) => b.textContent)`);
    await browser.eval('window.mavescape.toggleDrawer(false)');
    check('diff in the Report view: the changes since the checkpoint above the report, the variants that moved most, and the map of the change; the drawer\'s history marks the checkpoint, with the changes since it', `${JSON.stringify(shown)}; drawer ${JSON.stringify(drawn)}`, shown.head === 'Changes since "Before the rescoring"' && shown.map && shown.rows > 0 && drawn.join() === 'Changes since');
    const two = await act('diff', { paths: [join(out, 'diff-before.msz'), join(out, 'diff-after.msz')] });
    const before = scoredOf(archiveBefore);
    const both = new Map([...results, ...[...before].map(([id, x]) => [id, x.scored.results])]);
    const nodeTwo = diffStates(analysisState(archiveBefore.ws), analysisState(archiveAfter.ws), { pairs: pairsFor(analysisState(archiveBefore.ws), analysisState(archiveAfter.ws), tableOf, both) });
    check('diff of two workspace archives (before and after the rescoring): the changes as Node finds them from the two, the runs recomputed from each archive\'s own table (the checkpoint kept in between one of them)', two.data.words.slice(0, 3).join(' '), JSON.stringify(two.data.changes) === JSON.stringify(strip(nodeTwo.changes)) && JSON.stringify(two.data.pairs) === JSON.stringify(strip(nodeTwo.pairs)) && two.data.changes.some((c) => c.kind === 'run'));
    const removed = await act('checkpoint', { remove: 'Before the rescoring' });
    const none = await send('diff', {});
    check('checkpoint with remove: deleted (in the history); diff with no checkpoint kept refused, saying how to keep one', `${removed.message} | ${none.message}`, removed.data.checkpoints.length === 0 && !none.ok && /keep one with checkpoint/.test(none.message));
  }

  // The other example.
  const simulated = await act('open_example', { id: 'simulated' });
  check('open_example "simulated": opens in the map', simulated.message, simulated.data.simulated && (await browser.eval(`document.getElementById('app').dataset.mode`)) === 'map');

  // The time-series example: weighted regression by default, the ratio on request.
  const ts = await act('open_example', { id: 'simulated-time-series' });
  const tsState = await act('get_state');
  const tsQc = await act('qc_findings');
  const ids = tsQc.data.findings.map((f) => f.id);
  check('open_example "simulated-time-series": scored by weighted regression, with the two time-series findings passing', `${tsState.data.runs[0]?.name}; ${tsQc.message}`, ts.data.simulated && tsState.data.design.model === 'time-series' && ids.includes('time-points') && ids.includes('time-fit') && tsQc.data.findings.filter((f) => /^time-/.test(f.id)).every((f) => f.status === 'pass'));
  const tsMap = await act('render_map', {});
  const nonsense = (await browser.eval(`window.mavescape.store.ws.runs[0] && (() => { const e = window.mavescape.runResults.get(window.mavescape.store.ws.runs[0].id); const v = e.results.variants; const i = [...v.kind].findIndex((k, j) => k === 4 && !e.results.conditions[0].reason[j]); return v.key[i]; })()`));
  const course = await act('inspect_variant', { variant: nonsense });
  check('inspect_variant on a regression run: each replicate\'s time points and departure from a line, and the time course drawn in the inspector', `${course.message} ${course.data.replicates.map((r) => `${r.name}: ${r.timePoints} points, departure ${r.departure}`).join('; ')}`, course.data.replicates.every((r) => r.timePoints === 5 && Number.isFinite(r.departure)) && (await browser.eval(`[...document.querySelectorAll('#inspector h4')].some((e) => e.textContent === 'Time course')`)) && /map/.test(tsMap.message.toLowerCase()));
  const ratio = await act('score', { parameters: { model: 'ratio' } });
  const wlsDigest = tsState.data.runs[0].outputSha256;
  check('score with the model "ratio": a second run, by the first and last samples', ratio.message, ratio.data.name === 'Run 2' && ratio.data.outputSha256 !== wlsDigest);

  // The sort-seq example: the weighted average by default, the maximum-likelihood fit on request.
  await act('open_example', { id: 'simulated-sort-seq' });
  const binQc = await act('qc_findings');
  const binIds = binQc.data.findings.map((f) => f.id);
  check('open_example "simulated-sort-seq": the bin findings, and the variance beyond counting under review (the cells limit)', binQc.message, binIds.includes('bin-occupancy') && binIds.includes('cells-per-bin') && binQc.data.findings.find((f) => f.id === 'excess-variance').status === 'review');
  const mle = await act('score', { parameters: { model: 'bins-mle' } });
  const sortedVariant = await act('inspect_variant', { variant: 'p.Ser2Ter', run: mle.data.name });
  check('score by maximum likelihood, then inspect_variant: each replicate\'s reads by bin, and the distribution drawn in the inspector', `${mle.message} ${sortedVariant.data.replicates.map((r) => `${r.name}: ${r.readsByBin.join('/')}`).join('; ')}`, mle.data.name === 'Run 2' && sortedVariant.data.replicates.every((r) => r.readsByBin.length === 4) && (await browser.eval(`[...document.querySelectorAll('#inspector h4')].some((e) => e.textContent === 'Distribution over the bins')`)));

  // The barcoded example: its counts and map assembled in the window, scored barcode by barcode,
  // equal to the same in Node, and its barcodes exported equal to Node's export.
  await act('open_example', { id: 'simulated-barcodes' });
  const bcQc = await act('qc_findings');
  const bcIds = bcQc.data.findings.map((f) => f.id);
  check('open_example "simulated-barcodes": the four barcode findings, the outlier barcodes under review', bcQc.message, ['barcode-map', 'barcodes-per-variant', 'barcode-agreement', 'outlier-barcodes'].every((id) => bcIds.includes(id)) && bcQc.data.findings.find((f) => f.id === 'outlier-barcodes').status === 'review');
  const byBarcode = await act('score', { parameters: { aggregation: 'barcode' } });
  const sim = simulatedExample(exampleById('simulated-barcodes'));
  const bcDesign = await browser.eval('window.mavescape.store.ws.design');
  const bcTable = assembleTable(sim.files.map((f) => ({ name: f.name, table: parseTable(f.text, { fileName: f.name }), role: f.role })), { level: bcDesign.variants.level, target: bcDesign.targets[0] }).table;
  const bcNode = scoreTable(bcTable, bcDesign, { ...defaultParameters(bcDesign), aggregation: 'barcode' }).results;
  check('score each barcode, then combine: the run scored in the window has the output hash of the same in Node', `${byBarcode.data.outputSha256.slice(0, 16)}… and ${outputDigest(bcNode).slice(0, 16)}…`, byBarcode.data.outputSha256 === outputDigest(bcNode));
  await act('export', { what: 'barcodes', run: byBarcode.data.name, path: join(out, 'barcodes.csv') });
  const bcRun = await browser.eval(`window.mavescape.store.ws.runs.find((r) => r.name === ${JSON.stringify(byBarcode.data.name)})`);
  const bcWritten = readFileSync(join(out, 'barcodes.csv'), 'utf8');
  check('export barcodes.csv: the same bytes as Node\'s', `${bcWritten.length} bytes, ${bcWritten.split('\n').length - 2} barcodes`, bcWritten === barcodesCSV(bcNode, bcRun));
  const outlying = await act('inspect_variant', { variant: 'p.Glu6Gln', run: byBarcode.data.name });
  check('inspect_variant on a barcode run: each replicate\'s barcodes measured and its outliers, and the barcodes listed in the inspector', `${outlying.message} ${outlying.data.replicates.map((r) => `${r.name}: ${r.barcodesMeasured} measured, outliers ${r.outlierBarcodes.join(', ') || 'none'}`).join('; ')}`, outlying.data.replicates.every((r) => r.barcodesMeasured >= 3) && outlying.data.replicates.some((r) => r.outlierBarcodes.length === 1) && (await browser.eval(`Boolean(document.querySelector('#inspector .barcode-table'))`)));

  // Several score sets opened together (wave 3, slice 6), offline from MaveDB's tables as the
  // validation keeps them: DHFR without and with Lon, their counts joined with a design drafted as
  // a condition each; then the example, with the paper's design, scored as Node scores it.
  if (existsSync(join(DHFR, 'plus-lon', 'counts.csv'))) {
    const together = await act('open_mavedb', { urn: 'urn:mavedb:00000063-b-1, urn:mavedb:00000063-a-1' });
    const tState = await act('get_state');
    const tWs = await browser.eval('({ records: window.mavescape.store.ws.records.map((r) => r.urn), runs: window.mavescape.store.ws.runs.map((r) => r.name), design: window.mavescape.store.ws.design, joined: window.mavescape.store.ws.sources.find((s) => s.origin?.joined) })');
    check('open_mavedb with two URNs: DHFR\'s score sets opened together, both records kept, each one\'s published scores a run, their counts joined into one table (each record\'s columns named by its URN) with a design drafted as a condition each, the first the reference, in hours', `${together.message.slice(0, 260)}… Runs ${tWs.runs.join(', ')}; conditions ${tWs.design?.conditions?.map((c) => `${c.name}${c.reference ? ' (reference)' : ''}`).join(', ')}; time in ${tWs.design?.time?.unit}s; joined from ${tWs.joined?.files.map((f) => f.fileName).join(' and ')}`, tWs.records.join() === 'urn:mavedb:00000063-b-1,urn:mavedb:00000063-a-1' && tWs.runs.join() === 'Published scores (deficient Lon),Published scores (functioning Lon)' && together.data.published.map((p) => p.scored).join() === '2543,2378' && tWs.design?.conditions?.map((c) => c.id).join() === '00000063-b-1,00000063-a-1' && tWs.design.conditions[0].reference === true && tWs.design.time.unit === 'hour' && tWs.joined?.files.map((f) => f.fileName).join() === '00000063-b-1.csv,00000063-a-1.csv' && tState.data.tables.length === 3);
    const dhfr = await act('open_example', { id: 'dhfr-lon' });
    const dRun = await browser.eval('window.mavescape.store.ws.runs.find((r) => r.name === "Run 1")');
    const dNode = openExampleInNode(exampleById('dhfr-lon'));
    const dMap = await act('render_map', {});
    check('open_example "dhfr-lon": the two score sets opened together, the paper\'s design in place of the draft, Run 1 with Node\'s output hash, the map colored by +Lon − −Lon', `${dhfr.message.slice(0, 160)}…; ${dRun?.output.sha256.slice(0, 16)}… and ${outputDigest(dNode.scored.results).slice(0, 16)}…; ${dMap.data.contrast}, colored by ${dMap.data.colorBy}`, dhfr.ok !== false && dRun?.output.sha256 === outputDigest(dNode.scored.results) && dRun.inputs.design.library.tiles.length === 4 && dMap.data.colorBy === 'differential' && dMap.data.contrast === '+Lon vs −Lon' && (await browser.eval('document.getElementById(\'app\').dataset.mode')) === 'map');
    const reproducedDhfr = await act('reproduce_run', { run: 'Run 1' });
    check('reproduce_run on the joined table: DHFR\'s Run 1 recomputed from its two files, its recorded output hash', reproducedDhfr.message, reproducedDhfr.data.status === 'reproduced');
  } else {
    console.log('  DHFR\'s MaveDB tables are not in validation/cache: node validation/fetch.mjs mavedb-dhfr (the checks of score sets opened together skipped)');
    if (requireData) check('DHFR\'s MaveDB tables present', 'not in validation/cache', false, 'present (--require-data)');
  }

  // Two screens on two scales (wave 4, slice 6): the TP53 example opened offline, its target checked
  // against UniProt's entry, and the other two screens compared without opening them, as Node
  // compares them (the examples suite's way).
  if (existsSync(join(TP53, 'kotler.csv'))) {
    const tp53 = await act('open_example', { id: 'tp53-screens' });
    const checked = await act('check_target', { accession: 'P04637', apply: true });
    const unstated = await act('compare', { a: 'Published scores', b: 'urn:mavedb:00000059-a-1', scale: 'scored' });
    const rescaled = await act('compare', { a: 'Published scores', b: 'urn:mavedb:00000059-a-1', direction: 'higher-less', scale: 'synonymous-nonsense' });
    const nutlin = await act('compare', { a: 'Published scores', b: 'urn:mavedb:00000068-b-1', direction: 'higher-less', scale: 'synonymous-nonsense' });
    const o = openExampleInNode(exampleById('tp53-screens'));
    const entry = readUniProtEntry(JSON.parse(readFileSync(join(ROOT, 'validation/fixtures/public-data/uniprot/P04637.json'), 'utf8')));
    const placement = placeTarget(o.ws.targets[0], entry);
    const ws = recordTargetCheck(o.ws, o.ws.targets[0].id, placementPatch(o.ws.targets[0], entry, placement), referenceOf(entry, { service: 'UniProt', version: '2026_03' }, placement), 'check');
    const source = { ...ws.sources[0], sha256: sha256(o.parts[0].bytes) };
    const run = makeRun({ inputs: runInputs({ source, design: o.design, parameters: o.parameters }), source, results: o.scored.results, software: { version: 'node', commit: '' }, name: 'Published scores' });
    const sideA = describeSide({ ...ws, sources: [source] }, run, o.scored.results, { run: run.id, condition: 0 });
    const nodeUnstated = compareSides(sideA, scoreSetSide('urn:mavedb:00000059-a-1', join(TP53, 'kotler.csv')).side);
    const nodeRescaled = compareSides(sideA, scoreSetSide('urn:mavedb:00000059-a-1', join(TP53, 'kotler.csv'), { direction: 'higher-less' }).side, { scale: 'synonymous-nonsense' });
    const nodeNutlin = compareSides(sideA, scoreSetSide('urn:mavedb:00000068-b-1', join(TP53, 'nutlin.csv'), { direction: 'higher-less' }).side, { scale: 'synonymous-nonsense' });
    const sameStats = (window, node) => JSON.stringify(window.data.statistics) === JSON.stringify(JSON.parse(JSON.stringify(node.statistics)));
    const reportOf = (x) => JSON.stringify(x.items.map((i) => [i.id, i.status, i.text]));
    const parts = {
      opened: tp53.ok !== false && checked.data.applied !== false && /P72R/.test(checked.message),
      unstated: sameStats(unstated, nodeUnstated) && unstated.data.statistics.pearson.r < -0.78,
      rescaled: sameStats(rescaled, nodeRescaled) && reportOf(rescaled.data.report) === reportOf(nodeRescaled.report) && /936 protein variants on several rows/.test(rescaled.message + JSON.stringify(rescaled.data.report)),
      nutlin: sameStats(nutlin, nodeNutlin),
    };
    check('open_example "tp53-screens" offline, its target checked against UniProt P04637 (P72R), and the two other screens compared by URN without opening them: as published r −0.78; Kotler et al.\'s direction stated and both rescaled by their anchors, its protein variants on several rows merged, the statistics and report as Node gives them', `${rescaled.message.slice(0, 220)}… ${Object.entries(parts).map(([k, v]) => `${k} ${v ? 'as Node' : 'different'}`).join(', ')}`, Object.values(parts).every(Boolean));
  } else {
    console.log('  TP53\'s MaveDB tables are not in validation/cache: node validation/fetch.mjs mavedb-tp53-screens (the TP53 example\'s checks skipped)');
    if (requireData) check('TP53\'s MaveDB tables present', 'not in validation/cache', false, 'present (--require-data)');
  }

  // Two conditions (wave 2, slice 6): the example opens on its differential map; scored in the
  // window with Node's hash; the map, a variant and the differential export as Node makes them.
  await act('open_example', { id: 'simulated-conditions' });
  const twoSim = simulatedExample(exampleById('simulated-conditions'));
  const twoDesign = await browser.eval('window.mavescape.store.ws.design');
  const twoNode = scoreTable(parseTable(twoSim.csv), twoDesign, defaultParameters(twoDesign)).results;
  const twoState = await act('get_state');
  const twoRun = twoState.data.runs?.[0] ?? null;
  const twoRecord = await browser.eval('window.mavescape.store.ws.runs[0]');
  check('open_example "simulated-conditions": Run 1 compares the conditions by limma, with Node\'s output hash', `${twoRecord.inputs.parameters.differential}; ${twoRecord.output.sha256.slice(0, 16)}… and ${outputDigest(twoNode).slice(0, 16)}…`, twoRecord.inputs.parameters.differential === 'limma' && twoRecord.output.sha256 === outputDigest(twoNode) && Boolean(twoRun));
  const diffMap = await act('render_map', { color_by: 'differential' });
  check('render_map colored by the differential: the contrast named, the map described as the difference', diffMap.message, diffMap.data.contrast === 'With ligand vs Without ligand' && diffMap.data.colorBy === 'differential' && /Differential map/.test(diffMap.message));
  const pro13 = await act('inspect_variant', { variant: 'p.Pro13Ala' });
  const d0 = twoNode.differential[0];
  const i13 = twoNode.variants.key.indexOf('p.Pro13Ala');
  const got = pro13.data.differential?.[0];
  check('inspect_variant with conditions compared: the difference, its SE and q as Node\'s, and the block in the inspector', `${got?.contrast}: ${got?.difference} ± ${got?.se}, q ${got?.q}`, got?.difference === +d0.delta[i13].toPrecision(4) && got?.se === +d0.se[i13].toPrecision(4) && got?.q === +d0.q[i13].toPrecision(4) && (await browser.eval(`[...document.querySelectorAll('#inspector h4')].some((e) => e.textContent === 'Between conditions')`)));
  await act('export', { what: 'differential', path: join(out, 'differential.csv') });
  const diffWritten = readFileSync(join(out, 'differential.csv'), 'utf8');
  check('export differential.csv: the same bytes as Node\'s', `${diffWritten.length} bytes`, diffWritten === differentialCSV(twoNode, twoRecord));
  const paired = await act('score', { parameters: { differential: 'paired' } });
  check('score with the paired differential: a second run, summarized per contrast', paired.message, paired.data.name === 'Run 2' && paired.data.differential?.[0]?.method === 'paired' && paired.data.differential[0].compared > 800);

  // MaveDB (wave 3, slice 2), offline on the fetcher's cached answers: a search, and GRB2's record
  // opened as a workspace by its address, its published scores read as Node reads them.
  const found = await act('search_mavedb', { text: 'grb2' });
  check('search_mavedb: MaveDB\'s published score sets matching "grb2", from the cache', found.message, found.data.total === 1 && found.data.hits[0].urn === 'urn:mavedb:00000835-a-1' && found.data.retrieval.cache === 'hit');
  const fromMaveDB = await act('open_mavedb', { urn: 'https://www.mavedb.org/score-sets/urn:mavedb:00000835-a-1' });
  const mState = await act('get_state');
  const mTables = Object.fromEntries(mState.data.tables.map((t) => [t.origin?.file, t]));
  check('open_mavedb: GRB2\'s record as a workspace: its published scores read as published, its counts with a two-population design drafted from their names, both tables MaveDB\'s as pinned', `${fromMaveDB.message} Tables ${mState.data.tables.map((t) => `${t.origin?.file} ${t.sha256.slice(0, 12)}…`).join(', ')}; design ${mState.data.design?.model}`, fromMaveDB.data.published?.scored === 1108 && fromMaveDB.data.counts?.design === 'two-population' && mTables.scores?.sha256 === 'f04ee5723ab52c6d470925e3300c4b198f75f836afd42dd33f7c1eb08c5bb7c0' && mTables.counts?.sha256 === 'd4c966d5e7b9605227b5931904685358b68f1952818cb7523e606d86dff9e016' && mState.data.design?.model === 'two-population');
  const pRun = await browser.eval('window.mavescape.store.ws.runs.find((r) => r.name === "Published scores")');
  const pTable = parseTable(readFileSync(join(ROOT, 'validation/fixtures/public-data/mavedb/urn_mavedb_00000835-a-1.scores.csv')), { fileName: 'scores.csv' });
  const pNode = scoreTable(pTable, pRun.inputs.design, pRun.inputs.parameters);
  check('the published scores\' run: Node\'s output hash, read as published (model "published"), and the record kept with the workspace', `${pRun.output.sha256.slice(0, 16)}… and ${outputDigest(pNode.results).slice(0, 16)}…; ${pRun.inputs.parameters.model}`, pRun.output.sha256 === outputDigest(pNode.results) && pRun.inputs.parameters.model === 'published' && (await browser.eval('window.mavescape.store.ws.records?.[0]?.urn')) === 'urn:mavedb:00000835-a-1');
  // The target checked against UniProt after the run (0.3.0's release): the run's tracks are found
  // by the identifiers the check gave, its sequence and offset the same (lib/tracks.js, trackTarget).
  const noGene = await send('add_track', { provider: 'clinvar', run: 'Published scores' });
  await act('check_target', { apply: true });
  const withGene = await send('add_track', { provider: 'clinvar', run: 'Published scores' });
  check('a target checked against UniProt after its run: the run\'s tracks found by the gene the check gave (ClinVar refused before it, added after)', `${noGene.message} | ${withGene.message.slice(0, 120)}`, !noGene.ok && /names no gene/.test(noGene.message) && withGene.ok && /GRB2/.test(withGene.data?.name ?? ''));
  const ptenOffline = await send('open_mavedb', { urn: 'urn:mavedb:00000013-a-1' });
  check('open_mavedb offline, for a record whose table is not in the cache: refused, saying MaveScape is offline', ptenOffline.message, !ptenOffline.ok && /--offline/.test(ptenOffline.message));

  // Wave 3, slice 3: GRB2 opened with MaveDB's mapped variants (VRS); a record whose target is an
  // Ensembl transcript (BAP1, CC BY 4.0), its nucleotide variants read at the protein level.
  const mappedOpen = await act('open_mavedb', { urn: 'urn:mavedb:00000835-a-1', counts: false, mapped: true });
  const thr1 = await act('inspect_variant', { variant: 'p.Thr1Ter' });
  check('open_mavedb with mapped: MaveDB\'s mapping kept beside the table; inspect_variant gives a variant\'s VRS identifier and HGVS on the reference, its position the target\'s plus the UniProt offset (1 + 158)', `${mappedOpen.data.mapped} mapped; p.Thr1Ter: ${thr1.data.mapped?.hgvs} ${thr1.data.mapped?.vrs}`, mappedOpen.data.mapped === 1120 && thr1.data.mapped?.hgvs === 'NP_002077.1:p.Thr159Ter' && /^ga4gh:VA\.[A-Za-z0-9_-]{32}$/.test(thr1.data.mapped?.vrs ?? ''));
  const bap1 = await act('open_mavedb', { urn: 'urn:mavedb:00000662-a-2' });
  const bState = await act('get_state');
  const bRun = await browser.eval('window.mavescape.store.ws.runs.find((r) => r.name === "Published scores")');
  const bTable = parseTable(readFileSync(join(ROOT, 'validation/fixtures/public-data/mavedb/urn_mavedb_00000662-a-2.scores.csv')), { fileName: 'scores.csv' });
  const bNode = scoreTable(bTable, bRun.inputs.design, bRun.inputs.parameters);
  check('open_mavedb, a target named by a transcript (BAP1 exon 1, ENST00000460680.5): Ensembl\'s cached transcript, its current version (.6) said and used, every variant\'s reference base agreeing with it, the run Node\'s', `${bap1.message} Target: ${JSON.stringify(bState.data.targets[0])}`, bap1.data.target?.accession === 'ENST00000460680.6' && /Ensembl's current release has ENST00000460680\.6/.test(bap1.message) && bState.data.targets[0]?.from === 'Ensembl' && bRun.inputs.design.targets[0].identifiers.ensembl === 'ENST00000460680.5' && bRun.output.sha256 === outputDigest(bNode.results) && bap1.data.published?.scored === 620);
  const view = proteinView(bNode.results);
  const mergedAt = view.variants.members.findIndex((m) => m.length > 1);
  const mergedKey = view.variants.key[mergedAt];
  const cell = await act('inspect_variant', { variant: mergedKey });
  check(`inspect_variant on a protein variant of a nucleotide run (${mergedKey}): its score merged from its nucleotide variants as Node merges them, each listed`, cell.message, mergedAt >= 0 && cell.data.score === +view.conditions[0].score[mergedAt].toPrecision(4) && cell.data.nucleotideVariants?.length === view.variants.members[mergedAt].length && (await browser.eval(`[...document.querySelectorAll('#inspector h4')].some((e) => e.textContent === 'Nucleotide variants')`)));
  await act('export', { what: 'protein-scores', path: join(out, 'protein_scores.csv') });
  const proteinWritten = readFileSync(join(out, 'protein_scores.csv'), 'utf8');
  check('export protein-scores: the run\'s scores at the protein level, the same bytes as Node\'s', `${proteinWritten.split('\n').length - 2} protein variants`, proteinWritten === proteinScoresCSV(view));
  const tMap = await act('render_map', {});
  check('render_map of a nucleotide run: drawn at the protein level, saying how the variants were read and what is beside the map', tMap.message.slice(0, 200), /Read at the protein level/.test(JSON.stringify(tMap.data)) && /not on the map/.test(JSON.stringify(tMap.data)));

  // Wave 3, slice 4: MaveDB deposits. BAP1's published scores as MaveDB takes them, the same files
  // as Node writes; written as a ZIP, opened again from a folder and from the ZIP, and written
  // again the same; then GRB2 rescored from its counts, its MaveDB details set.
  const bDeposit = await act('mavedb_deposit', {});
  check('mavedb_deposit: BAP1\'s published scores as MaveDB takes them, named by the transcript MaveScape checked them on (ENST00000460680.6), the record\'s abstract, license and method text kept: nothing missing', bDeposit.message, bDeposit.data.mode === 'accession' && bDeposit.data.target.targetAccession?.accession === 'ENST00000460680.6' && bDeposit.data.variants.exported === 620 && !bDeposit.data.missing.length);
  const bZip = await act('export', { what: 'mavedb', path: join(out, 'bap1-mavedb.zip') });
  const bFiles = await readZip(new Uint8Array(readFileSync(join(out, 'bap1-mavedb.zip'))));
  // Node's deposit of the same record needs BAP1's MaveDB table (validation/cache, as
  // node validation/fetch.mjs mavedb-bap1-sge keeps it).
  const nodeBap1 = depositPackages(['bap1']).packages[0]?.deposit ?? null;
  if (!nodeBap1) {
    console.log('  BAP1\'s MaveDB table is not in validation/cache: node validation/fetch.mjs mavedb-bap1-sge (the deposit compared with Node\'s skipped)');
    if (requireData) check('BAP1\'s MaveDB table present', 'not in validation/cache', false, 'present (--require-data)');
  }
  const mavedbFiles = (files) => Object.fromEntries([...files].filter(([n]) => MAVEDB_FILES.includes(n)).map(([n, b]) => [n, typeof b === 'string' ? b : new TextDecoder().decode(b)]));
  const nodeFiles = nodeBap1 ? mavedbFiles(new Map(nodeBap1.files.map((f) => [f.name, f.text]))) : null;
  const sameAsNode = !nodeFiles || (Object.keys(nodeFiles).length && Object.entries(nodeFiles).every(([n, t]) => mavedbFiles(bFiles)[n] === t) && Object.keys(mavedbFiles(bFiles)).length === Object.keys(nodeFiles).length);
  check('export mavedb: the deposit as one ZIP, the files MaveDB reads the same bytes as Node\'s (validated by MaveDB\'s own validators, suite mavedb-export)', `${bZip.message} ${[...bFiles.keys()].join(', ')}${nodeFiles ? '' : ' (not compared with Node\'s)'}`, sameAsNode && bFiles.has('README.md') && bFiles.has('mavescape.json'));
  const folder = join(out, 'bap1-package');
  mkdirSync(folder, { recursive: true });
  for (const [name, bytes] of bFiles) writeFileSync(join(folder, name), bytes);
  const fromFolder = await act('open_files', { paths: [folder] });
  const pkgState = await act('get_state');
  await act('export', { what: 'mavedb', path: join(out, 'bap1-again.zip') });
  const bAgain = mavedbFiles(await readZip(new Uint8Array(readFileSync(join(out, 'bap1-again.zip')))));
  check('a MaveDB package opened from its folder: a workspace of its published scores (its transcript fetched), its MaveDB details kept; written again, the files MaveDB reads the same bytes (export → import → export)', `${fromFolder.message} Records: ${pkgState.data.tables.map((t) => t.origin?.database).join(', ')}`, pkgState.data.tables.some((t) => t.origin?.database === 'package') && Object.entries(nodeFiles).every(([n, t]) => bAgain[n] === t));
  const fromZip = await act('open_files', { paths: [join(out, 'bap1-mavedb.zip')] });
  const zipState = await act('get_state');
  check('a MaveDB package opened as its ZIP', fromZip.message, zipState.data.tables.some((t) => t.origin?.database === 'package' && /bap1-mavedb/.test(t.origin?.package ?? '')));
  await act('open_example', { id: 'grb2' });
  const gDeposit = await act('mavedb_deposit', {});
  const gSet = await act('set_mavedb_details', { details: { abstract: 'Abundance of every substitution in the SH3 domain of GRB2.', publications: ['doi:10.1038/s41586-024-08370-4'], contributors: '0000-0002-1825-0097', license: 'CC BY 4.0' } });
  const gAfter = await act('mavedb_deposit', {});
  const gBad = await send('set_mavedb_details', { details: { abstrct: 'x' } });
  check('a run rescored from counts: mavedb_deposit says MaveDB needs an abstract; set_mavedb_details gives it (with a DOI, an ORCID iD and a license), kept with the workspace and in its history; an unknown detail refused', `${gDeposit.data.missing.map((m) => m.field).join(', ')} → ${gAfter.data.missing.map((m) => m.field).join(', ') || 'nothing'}; ${gSet.message} ${gBad.message}`, gDeposit.data.missing.some((m) => m.field === 'abstract') && !gAfter.data.missing.length && gAfter.data.details.license === 'CC BY 4.0' && gAfter.data.details.publications[0]?.db === 'Crossref' && (await browser.eval('window.mavescape.store.ws.history.at(-1).action')) === 'deposit' && !gBad.ok && /abstrct/.test(gBad.message));
  await act('export', { what: 'mavedb', path: join(out, 'grb2-mavedb.zip') });
  const gFiles = await readZip(new Uint8Array(readFileSync(join(out, 'grb2-mavedb.zip'))));
  const gSetJSON = JSON.parse(new TextDecoder().decode(gFiles.get('score_set.json')));
  const gScores = parseTable(gFiles.get('scores.csv'), { fileName: 'scores.csv' });
  check('the deposit of a run rescored from counts: its scores, SEs, intervals and replicates, its counts by sample, the methods as MaveDB\'s method text, the details given', `${gScores.rows} rows; ${gScores.columns.map((c) => c.name).join(', ')}; license ${gSetJSON.licenseId}`, gScores.rows === 1121 && gScores.columns[0].name === 'hgvs_pro' && gScores.columns.some((c) => c.name === 'SE') && gFiles.has('counts.csv') && /^Variant counts were read from/.test(gSetJSON.methodText) && gSetJSON.licenseId === 3 && gSetJSON.abstractText.startsWith('Abundance'));

  // Wave 5, slice 1: the Structure view. Every example protein's PDB entry and AlphaFold DB model
  // opened by remote control, from the cache, and drawn: with WebGPU where the browser offers it,
  // then, the page opened again with ?renderer=canvas, with the Canvas renderer; each with the
  // atoms Node reads, and an image of the view that is not empty.
  const drawnShare = `(async () => { const m = await import('/ui/mode-structure.js'); const v = m.structureState(window.mavescape).viewer; const blob = await v.capturePNG(0.5); const bitmap = await createImageBitmap(blob); const c = new OffscreenCanvas(bitmap.width, bitmap.height); const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(bitmap, 0, 0); const d = g.getImageData(0, 0, bitmap.width, bitmap.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - d[0]) + Math.abs(d[i + 1] - d[1]) + Math.abs(d[i + 2] - d[2]) > 30) n += 1; return n / (d.length / 4); })()`;
  async function openEveryStructure() {
    const opened = [];
    for (const e of EXAMPLE_STRUCTURES) {
      for (const [args, kind, file] of [[{ pdb: e.pdb }, 'pdb', pdbFile(e.pdb)], [{ alphafold: e.accession }, 'alphafold', modelFile(e.accession, e.model)]]) {
        const r = await send('open_structure', args);
        const node = await openCached(kind, file);
        await sleep(300);
        const share = r.ok ? await browser.eval(drawnShare) : 0;
        opened.push({ name: r.data?.name ?? Object.values(args)[0], ok: r.ok && r.data.atoms === node.models[0].atoms.length && r.data.residues === node.models[0].residues.length && r.data.origin?.cache === 'hit' && share > 0.03, renderer: r.data?.renderer, share, message: r.ok ? '' : r.message });
      }
    }
    return opened;
  }
  const first = await act('open_structure', { pdb: '2VWF' });
  // WebGPU where the browser gives the viewer a device that keeps working (headless Chrome on macOS
  // does); otherwise the viewer's own reason for the Canvas renderer is reported. A device the
  // browser loses (on GitHub's runners, which draw in software, the GPU process does not last)
  // leaves the view on the Canvas renderer, saying why: an image drawn first finds out, and a
  // device lost later is said where it happens.
  const viewerNow = () => browser.eval(`import('/ui/mode-structure.js').then((m) => { const v = m.structureState(window.mavescape).viewer; return { kind: v.kind, failure: v.failure }; })`);
  await browser.eval(drawnShare);
  let webgpu = (await viewerNow()).kind === 'webgpu';
  const noGPU = webgpu ? '' : (await viewerNow()).failure;
  check('open_structure: a PDB entry by its ID, from the cache, in the Structure view, described in words (its chains and the UniProt residues each covers)', first.message.slice(0, 220), first.data.name === '2VWF' && first.data.origin.kind === 'pdb' && first.data.chains.find((c) => c.id === 'A')?.uniprot[0]?.from === 159 && (await browser.eval(`document.getElementById('app').dataset.mode`)) === 'structure' && /Chain A: Growth Factor Receptor-Bound Protein 2/.test(first.message));
  const everyGPU = await openEveryStructure();
  const afterEvery = await viewerNow();
  const lostDuring = webgpu && afterEvery.kind === 'canvas';
  check(`every example protein's PDB entry and AlphaFold DB model opened and drawn ${webgpu ? 'with WebGPU' : `by the Canvas renderer (${noGPU})`}, with the atoms and residues Node reads, from the cache; an image of each view not empty`, `${everyGPU.map((x) => `${x.name} ${x.renderer} ${fmtShare(x.share)}${x.message ? ` ${x.message}` : ''}`).join('; ')}${lostDuring ? `; WebGPU lost on the way (${afterEvery.failure}), the rest drawn by the Canvas renderer` : ''}`, everyGPU.length === 2 * EXAMPLE_STRUCTURES.length && everyGPU.every((x) => x.ok && (x.renderer === (webgpu ? 'webgpu' : 'canvas') || (lostDuring && x.renderer === 'canvas'))));
  if (lostDuring) webgpu = false;
  if (!webgpu) console.log(`  No WebGPU for the viewer (${noGPU}): the Structure view was checked with the Canvas renderer only.`);
  const target = await act('open_structure', { alphafold: 'target' });
  check('open_structure with alphafold "target": the AlphaFold DB model of the open workspace\'s target (the last example opened), its confidence the color', target.message.slice(0, 160), target.data.origin.kind === 'alphafold' && target.data.predicted && target.data.color === 'plddt');
  await act('open_structure', { pdb: '1RFN' });
  const cys = await act('set_structure', { select: 'resn CYS', show: 'sticks', label: true });
  const focused = await act('set_structure', { select: 'chain A and resi 191+220', focus: true });
  check('set_structure: factor IX\'s cysteines (1RFN) selected in words, drawn as sticks and labeled; two focused on, their neighborhood drawn', `${cys.message} | ${focused.message}`, cys.data.selected.count === 14 && Object.values(cys.data.styled).filter((x) => x === 'sticks').length === 14 && cys.data.labels === 14 && focused.data.focused === 2 && focused.data.selected.residues.join() === 'Cys 191 · A,Cys 220 · A');
  const surface = await act('set_structure', { surface: 'ses', focus: false, select: '' });
  if ((await viewerNow()).kind !== 'webgpu') webgpu = false;
  check(`set_structure surface: the molecular surface ${webgpu ? 'computed in its worker and drawn' : 'refused by the Canvas renderer, saying why'}`, surface.message, webgpu ? surface.data.surface.ready && /triangles/.test(surface.data.surface.status) : /need WebGPU/.test(surface.data.surface.status));
  await act('set_structure', { surface: 'off' });
  await act('open_structure', { pdb: '1HHO' });
  const tetramer = await act('set_structure', { assembly: '1' });
  check('set_structure assembly: hemoglobin (1HHO), its αβ dimer as deposited, built into its tetramer by symmetry', `${tetramer.message} ${tetramer.data.atoms} atoms`, tetramer.data.assembly === '1' && tetramer.data.atoms === 2 * (await openCached('pdb', pdbFile('1HHO'))).models[0].atoms.length);
  const wrong = await send('set_structure', { select: 'resn FOO' });
  const badSyntax = await send('set_structure', { select: 'chain A and (resi 40' });
  const noSuch = await send('open_structure', { pdb: '9ZZZ' });
  const neither = await send('open_structure', {});
  check('what cannot be done is refused, saying why: a selection of nothing, a selection that does not parse, an entry not in the cache (offline), no structure named', [wrong.message, badSyntax.message, noSuch.message, neither.message].join(' | ').slice(0, 400), !wrong.ok && /selects no residue/.test(wrong.message) && !badSyntax.ok && !noSuch.ok && /offline/.test(noSuch.message) && !neither.ok);
  const fromFile = await act('open_files', { paths: [join(ROOT, 'validation/fixtures/structures/2VWF.pdb.gz')] });
  const withStructure = await act('get_state');
  check('open_files with a structure file (RCSB\'s PDB-format 2VWF, gzipped): shown in the Structure view, in get_state', `${fromFile.message} get_state: ${withStructure.data.structure?.name}, ${withStructure.data.structure?.atoms} atoms`, /the structure 2VWF\.pdb/.test(fromFile.message) && withStructure.data.structure?.name === '2VWF' && withStructure.data.structure.origin.kind === 'file' && withStructure.data.structure.atoms === first.data.atoms);
  // Wave 5, slice 2: the target mapped onto structures, as Node maps it. The workspace is GRB2's.
  const grb2Target = exampleTarget('grb2-sh3');
  const listed = await act('find_structures', {});
  const listedNode = rankStructures(cachedJSON('pdbe', 'P62993.best-structures.json'), grb2Target);
  check('find_structures: the PDB entries that cover GRB2\'s SH3 domain, from PDBe\'s SIFTS in the cache, ranked as Node ranks them', listed.message.slice(0, 200), listed.data.total === listedNode.length && listed.data.structures.slice(0, 20).map((r) => `${r.id}:${r.from}-${r.to}`).join() === listedNode.slice(0, 20).map((r) => `${r.id}:${r.from}-${r.to}`).join() && listed.data.structures[0].id === '2VWF');
  const onVWF = await act('open_structure', { pdb: '2VWF' });
  const [vwfNode] = mapTarget(await openCached('pdb', pdbFile('2VWF')), grb2Target);
  check('open_structure maps the workspace\'s target: GRB2\'s SH3 domain on chain A of 2VWF, 56 positions, P54A an engineered mutation, as Node maps it', JSON.stringify(onVWF.data.mapping?.positions.different), onVWF.data.mapping?.chain === 'A' && onVWF.data.mapping.onStructure === vwfNode.onStructure && onVWF.data.mapping.counts.identical === vwfNode.counts.identical && onVWF.data.mapping.positions.different[0]?.reason === 'engineered mutation' && onVWF.data.mapping.positions.different[0].reference === 212);
  const byPosition = await act('set_structure', { select: 'pos 30-40' });
  const keptOnModel = await act('open_structure', { alphafold: 'target' });
  const byReference = await act('set_structure', { select: 'uniprot 188-198' });
  check('a selection by target position ("pos 30-40") on 2VWF, kept when GRB2\'s AlphaFold DB model is opened: the same positions, at UniProt 188–198 on the model, as "uniprot 188-198" selects them', `${byPosition.data.selected.runs.join(', ')} → ${keptOnModel.data.selected.runs.join(', ')} (${keptOnModel.data.selected.count}); by reference ${byReference.data.selected.runs.join(', ')}`, byPosition.data.selected.count === 11 && keptOnModel.data.selected.runs.join() === 'Asn 188–Cys 198 · A' && byReference.data.selected.runs.join() === 'Asn 188–Cys 198 · A');
  await act('export', { what: 'structure-mapping', path: join(out, 'mapping.csv') });
  const [modelNode] = mapTarget(await openCached('alphafold', modelFile('P62993', 6)), grb2Target);
  check('export structure-mapping: the target on the structure shown, position by position, the same bytes as Node\'s', `${readFileSync(join(out, 'mapping.csv'), 'utf8').split('\n').length - 2} positions`, readFileSync(join(out, 'mapping.csv'), 'utf8') === mappingCSV(modelNode, 'AF-P62993-F1'));
  // Wave 5, slice 3: scores on the structure, as Node colors them. GRB2's Run 1 on 2VWF; the
  // selection shared with the map both ways; the coloring's file; the other colorings; a model's
  // confidence beside the scores.
  const grb2Node = openExampleInNode(exampleById('grb2-sh3'));
  const grb2Results = proteinView(grb2Node.scored.results) ?? grb2Node.scored.results;
  const grb2Model = buildMapModel(grb2Results, grb2Node.design, {});
  const vwfMaps = mapTarget(await openCached('pdb', pdbFile('2VWF')), grb2Target);
  const medianNode = placeOnTarget(positionValues(grb2Model, 'median'), grb2Target);
  const medianPalette = coloringPalette(medianNode, 'rdbu');
  const hexOf = (rgb) => `#${rgb.map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('')}`;
  const nodeColors = new Map([...residueColors(medianNode, vwfMaps, medianPalette)].map(([k, rgb]) => [k, hexOf(rgb)]));
  await act('open_structure', { pdb: '2VWF' });
  const byMedian = await act('set_structure', { color: 'median' });
  const drawn = await browser.eval(`import('/ui/mode-structure.js').then((m) => { const s = m.structureState(window.mavescape); return s.mapping.positions.filter((p) => p.residue).map((p) => [p.residue, s.viewer.residueColor(p.residue)]); })`);
  const legendNode = coloringLegend(medianNode, vwfMaps[0], medianPalette, 'Run 1');
  check('set_structure color median: GRB2\'s Run 1 on 2VWF, every residue of the target drawn in the color Node gives its position (the map\'s scale and palette), the legend and words as Node\'s', `${byMedian.message.slice(0, 260)} | ${drawn.length} residues, ${drawn.filter(([k, c]) => nodeColors.get(k) === c).length} as Node's`, byMedian.data.scores?.coloring === 'median' && byMedian.data.scores.source === 'Run 1' && drawn.length === 56 && drawn.every(([k, c]) => nodeColors.get(k) === c) && byMedian.data.scores.legend.low === legendNode.gradient.low && byMedian.data.scores.legend.center === legendNode.gradient.center && byMedian.data.scores.positions.scored === 56 && /less function/.test(byMedian.data.scores.legend.meaning));
  const pickedResidue = await act('set_structure', { pick: 'A 25' });
  const afterPick = await act('get_state');
  const inspectorText = await browser.eval(`document.getElementById('inspector').innerText`);
  const column = cellsAtPositions(grb2Model, [25], cellName, cellAt);
  check('set_structure pick: Ile 183 (2VWF A 25) picked as a click picks it: its position\'s 21 variants selected on the map ("at 25"), the position in the inspector', `${pickedResidue.message.slice(-160)} | selection ${afterPick.data.selection?.count} by "${afterPick.data.selection?.query}"; focus ${JSON.stringify(afterPick.data.focus)}`, pickedResidue.data.picked?.position === 25 && afterPick.data.selection?.count === column.length && afterPick.data.selection.query === 'at 25' && afterPick.data.selection.variants.every((k) => column.includes(k)) && afterPick.data.focus?.kind === 'position' && afterPick.data.focus.position === 25 && /Position 25 · Ile/i.test(inspectorText) && /2VWF Ile 25 · A/.test(inspectorText));
  await act('select_variants', { query: 'missense at 1-10 and score < -3' });
  await act('set_mode', { mode: 'structure' });
  const fromMap = await act('get_state');
  const mapPositions = [...new Set(fromMap.data.selection.variants.map((k) => Number(/\d+/.exec(k)[0])))].sort((a, b) => a - b);
  check('a selection made on the map (select_variants, a query) drawn on the structure when the Structure view is shown again: the residues of its positions', `${fromMap.data.selection.count} variants at ${mapPositions.join(', ')} → ${fromMap.data.structure.selected.runs.join(', ')}`, fromMap.data.structure.selected.count === mapPositions.length && fromMap.data.structure.selected.residues.length === mapPositions.length && mapPositions.length >= 5);
  await act('export', { what: 'structure-scores', path: join(out, 'scores-on-2vwf.csv') });
  check('export structure-scores: the scores the structure is colored by, position by position with each residue\'s color, the same bytes as Node\'s', `${readFileSync(join(out, 'scores-on-2vwf.csv'), 'utf8').split('\n').length - 2} positions`, readFileSync(join(out, 'scores-on-2vwf.csv'), 'utf8') === coloringCSV(medianNode, vwfMaps[0], '2VWF', medianPalette));
  const noThreshold = await send('set_structure', { color: 'fraction' });
  const fraction = await act('set_structure', { color: 'fraction', threshold: -2 });
  const fractionNode = placeOnTarget(positionValues(grb2Model, 'fraction', { abnormal: thresholdClasses(-2, 'below') }), grb2Target);
  const byQC = await act('set_structure', { color: 'qc' });
  const qcNode = coloringLegend(placeOnTarget(positionValues(grb2Model, 'qc'), grb2Target), vwfMaps[0], medianPalette);
  const toPro = await act('set_structure', { color: 'substitution', substitution: 'Pro' });
  const badAmino = await send('set_structure', { substitution: 'Xyz' });
  const disagreement = await act('set_structure', { color: 'disagreement' });
  check('the other colorings: fraction abnormal-like refused without a threshold, saying so, then below −2 as Node computes it; the QC state\'s classes as Node counts them; the substitution to proline; the disagreement of the comparison Compare shows (Run 1\'s two replicates); an amino acid that is none refused', `${noThreshold.message.slice(0, 120)} | ${fraction.data.scores.words[0].slice(0, 80)} | QC ${byQC.data.scores.legend.items.slice(0, 4).map((i) => i.count).join('/')} | ${toPro.data.scores.label} | ${disagreement.data.scores?.source} | ${badAmino.message}`, !noThreshold.ok && /needs a threshold/.test(noThreshold.message) && fraction.data.scores.abnormal === fractionNode.abnormal && fraction.data.scores.positions.scored === 56 && JSON.stringify(byQC.data.scores.legend.items.slice(0, 4).map((i) => i.count)) === JSON.stringify(qcNode.items.slice(0, 4).map((i) => i.count)) && toPro.data.scores.label === 'Substitution to Pro' && toPro.data.scores.positions.residueItself === 4 && /Replicate 1 − Run 1: Replicate 2/.test(disagreement.data.scores?.source ?? '') && !badAmino.ok && /not an amino acid/.test(badAmino.message));
  await act('open_structure', { alphafold: 'target' });
  const onModel = await act('set_structure', { color: 'median' });
  const strip = await browser.eval(`(() => [...document.querySelectorAll('.structure-strip-label')].map((x) => x.textContent))()`);
  check('on GRB2\'s AlphaFold DB model, colored by the median score: every position of the target on the model; the strip below the view shows the scores, the positions on the structure and the model\'s confidence (pLDDT) beside them', `${onModel.data.scores.positions.onStructure} positions; strip rows: ${strip.filter(Boolean).join(', ')}`, onModel.data.scores.positions.onStructure === 56 && onModel.data.scores.positions.scored === 56 && strip.includes('pLDDT') && strip.includes('Median score'));
  await act('set_structure', { color: 'plddt' });
  // Wave 5, slice 4: structure as evidence, as Node reads it: GRB2 on 2VWF and on its model.
  await act('open_structure', { pdb: '2VWF' });
  const evEvidence = await act('structure_evidence', {});
  const evVwfNode = nodeEvidence(await openCached('pdb', pdbFile('2VWF')), vwfMaps[0]);
  const evValueAtNode = (q) => (medianNode.state[q - 1] === POSITION.VALUE || medianNode.state[q - 1] === POSITION.LOW ? medianNode.value[q - 1] : Number.NaN);
  const evEffectsNode = effectsByClass(evVwfNode.evidence, evValueAtNode);
  const evClustersNode = clusterTest(evVwfNode.evidence, evValueAtNode, { fraction: 0.2, seed: 1 });
  const evClassesNode = Object.fromEntries(['buried', 'exposed', 'interface', 'disordered'].map((c) => [c, evVwfNode.evidence.positions.filter((p) => p.class === c).length]));
  // Remote control gives six significant digits.
  const near6 = (x, y) => Math.abs(x - y) <= 1e-5 * Math.max(1e-300, Math.abs(y));
  const evSameEffects = evEvidence.data.effects?.length === evEffectsNode.classes.length && evEvidence.data.effects.every((x, k) => x.class === evEffectsNode.classes[k].id && x.positions === evEffectsNode.classes[k].n && near6(x.median, evEffectsNode.classes[k].median) && near6(x.q, evEffectsNode.classes[k].test.q));
  const evSameClusters = evEvidence.data.clusters?.pairs === evClustersNode.observed && near6(evEvidence.data.clusters.expected, evClustersNode.expected) && near6(evEvidence.data.clusters.p, evClustersNode.p) && JSON.stringify(evEvidence.data.clusters.sensitive) === JSON.stringify(evClustersNode.sensitive);
  check('structure_evidence: GRB2\'s SH3 domain on 2VWF in the page as Node reads it (the accessibility in the surface worker): its structural classes, the Gab2 peptide the one partner; the median scores of each class against the rest; the cluster test with seed 1, the same pairs, expectation and p', `${evEvidence.message.slice(0, 300)}`, JSON.stringify(evEvidence.data.classes) === JSON.stringify(evClassesNode) && evEvidence.data.partners.length === 1 && evEvidence.data.partners[0].chosen && evSameEffects && evSameClusters);
  const evPeptideOnly = await act('structure_evidence', { partner: 'chain:B', fraction: 0.3, seed: 2 });
  const evNoPartner = await send('structure_evidence', { partner: 'chain:Z' });
  const evTooMany = await send('structure_evidence', { fraction: 0.9 });
  check('structure_evidence\'s choices: the partner by its id, the share called least tolerant and the seed (the test drawn again); a partner the structure has not, and a share beyond a half, refused', `${evPeptideOnly.data.clusters?.leastTolerant} of ${evPeptideOnly.data.clusters?.positions}, seed ${evPeptideOnly.data.clusters?.seed} | ${evNoPartner.message} | ${evTooMany.message}`, evPeptideOnly.data.clusters?.fraction === 0.3 && evPeptideOnly.data.clusters.seed === 2 && evPeptideOnly.data.clusters.leastTolerant === Math.round(0.3 * evPeptideOnly.data.clusters.positions) && !evNoPartner.ok && !evTooMany.ok && /from 0\.05 to 0\.5/.test(evTooMany.message));
  await act('structure_evidence', { partner: 'all', fraction: 0.2, seed: 1 });
  const evBesideMap = await act('list_tracks', {});
  const evStructureTrackIds = evBesideMap.data.tracks.filter((t) => t.id.startsWith('structure:')).map((t) => `${t.id}${t.shown ? '' : ' (hidden)'}`);
  const evClassTrack = evBesideMap.data.tracks.find((t) => t.id === 'structure:class');
  check('list_tracks: the structure\'s tracks beside GRB2\'s map, its classes and secondary structure shown, the classes\' stretches as Node gives them', evStructureTrackIds.join(', '), evStructureTrackIds.length === 5 && evBesideMap.data.tracks.find((t) => t.id === 'structure:class')?.shown && evBesideMap.data.tracks.find((t) => t.id === 'structure:ss')?.shown && evClassTrack.features.filter((f) => f.label === 'buried').reduce((a, f) => a + f.end - f.start + 1, 0) === evClassesNode.buried);
  await act('set_mode', { mode: 'structure' });
  await act('export', { what: 'structure-evidence', path: join(out, 'evidence-2vwf.csv') });
  check('export structure-evidence: what 2VWF says of each position, with its median score, the same bytes as Node\'s', `${readFileSync(join(out, 'evidence-2vwf.csv'), 'utf8').split('\n').length - 2} positions`, readFileSync(join(out, 'evidence-2vwf.csv'), 'utf8') === evidenceCSV(evVwfNode.evidence, '2VWF', evValueAtNode, 'median_score'));
  const evByClass = await act('set_structure', { color: 'class' });
  check('set_structure color class: the residues colored by their structural class, the legend\'s counts Node\'s', JSON.stringify(evByClass.data.scores?.legend.items.map((i) => [i.label, i.count])), evByClass.data.scores?.coloring === 'class' && evByClass.data.scores.legend.items.filter((i) => i.count !== null).every((i) => i.count === evClassesNode[i.label]));
  await act('open_structure', { alphafold: 'target' });
  const evOnModelEvidence = await act('structure_evidence', {});
  const evModelNode = nodeEvidence(await openCached('alphafold', modelFile('P62993', 6)), mapTarget(await openCached('alphafold', modelFile('P62993', 6)), grb2Target)[0], { pae: paeFixture('P62993') });
  const evDisorderedNode = evModelNode.evidence.positions.filter((p) => p.class === 'disordered').length;
  check('structure_evidence on GRB2\'s AlphaFold DB model: its aligned error fetched (from the cache) and used, the classes as Node reads them with it', `aligned error ${evOnModelEvidence.data.alignedError}; ${JSON.stringify(evOnModelEvidence.data.classes)}`, evOnModelEvidence.data.alignedError === true && evModelNode.pae && evOnModelEvidence.data.classes.disordered === evDisorderedNode && evOnModelEvidence.data.classes.buried === evModelNode.evidence.positions.filter((p) => p.class === 'buried').length);
  await act('set_structure', { color: 'plddt' });
  // Wave 5, slice 5: structures in the record. A view of 2VWF saved, changed, opened again: its
  // figure panels the same image; through the archive; its structure fetched again by its ID.
  // A PNG without its text chunks: the image alone, to compare.
  const imageOnly = (bytes) => {
    const out = [bytes.subarray(0, 8)];
    let at = 8;
    while (at + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(at);
      const type = bytes.subarray(at + 4, at + 8).toString('latin1');
      if (type !== 'tEXt' && type !== 'iTXt') out.push(bytes.subarray(at, at + 12 + length));
      at += 12 + length;
    }
    return Buffer.concat(out);
  };
  const turn = (q) => browser.eval(`import('/ui/mode-structure.js').then((m) => { const v = m.structureState(window.mavescape).viewer; const c = v.camera; c.rotation = ${JSON.stringify(q)}; v.setCamera(c); return true; })`);
  await act('open_structure', { pdb: '2VWF' });
  await act('set_structure', { color: 'median', select: 'pos 20-26', show: 'sticks', label: true });
  await turn([0.2, 0.3, 0.1, Math.sqrt(1 - 0.14)]);
  const savedCore = await act('save_structure_view', { name: 'Core' });
  await act('export', { what: 'structure-image', path: join(out, 'core-1.png'), scale: 2 });
  await act('set_structure', { show: 'none' });
  await act('set_structure', { color: 'secondary', select: '' });
  await turn([0.5, 0.1, 0.3, Math.sqrt(1 - 0.35)]);
  await act('export', { what: 'structure-image', path: join(out, 'core-changed.png'), scale: 2 });
  const reopenedCore = await act('open_structure_view', { name: 'Core' });
  await act('export', { what: 'structure-image', path: join(out, 'core-2.png'), scale: 2 });
  const core1 = readFileSync(join(out, 'core-1.png'));
  const core2 = readFileSync(join(out, 'core-2.png'));
  const coreChanged = readFileSync(join(out, 'core-changed.png'));
  const vwfSha = sha256(cachedBytes('pdb', pdbFile('2VWF')));
  check('save_structure_view and open_structure_view: 2VWF colored by GRB2\'s median scores, residues selected, drawn and labeled, turned; saved with its file (the fetcher\'s, by its SHA-256) and the mapping; changed (colors, selection, camera), then opened: the same image as when saved (a figure panel, pixel for pixel), the changed one another', `${savedCore.message.slice(0, 160)} | ${reopenedCore.message.slice(0, 120)}; images ${imageOnly(core1).equals(imageOnly(core2)) ? 'the same' : 'different'}, changed ${imageOnly(core1).equals(imageOnly(coreChanged)) ? 'the same' : 'different'}`, savedCore.data.structure.file.sha256 === vwfSha && savedCore.data.view.chain === 'A' && savedCore.data.view.selection.length === 7 && savedCore.data.view.color.scores.how === 'median' && !reopenedCore.data.mappingChanges.length && reopenedCore.data.state.selected.count === 7 && reopenedCore.data.state.labels === 7 && imageOnly(core1).equals(imageOnly(core2)) && !imageOnly(core1).equals(imageOnly(coreChanged)));
  const panel = JSON.parse(pngTexts(new Uint8Array(core2)).get(PANEL_KEYWORD));
  const grb2RunState = await act('get_state');
  const run1 = grb2RunState.data.runs.find((r) => r.name === 'Run 1');
  check('export structure-image: a figure panel, twice the view saved, its legend below it, what it shows written into it (PNG text): the structure\'s file by its SHA-256, the view, the coloring of Run 1 by its output\'s SHA-256, the legend', JSON.stringify({ structure: panel.structure.sha256.slice(0, 12), view: panel.view.saved, coloring: panel.coloring.how, run: panel.coloring.run?.name, legend: panel.legend?.title, image: panel.image }), panel.format === 'mavescape-figure-panel' && panel.structure.sha256 === vwfSha && panel.view.saved === 'Core' && panel.coloring.how === 'median' && panel.coloring.run?.output === run1?.outputSha256 && panel.legend?.title === 'Median score, Run 1' && panel.image.legend && panel.image.width === 2 * panel.image.view.width && panel.image.height > 2 * panel.image.view.height);
  // A saved view as a figure's panel (wave 6, slice 2): its figure panel drawn on white at 4×, kept
  // with the figure in the library and the archive, the same pixels as the view's own figure panel.
  const structureFigure = await act('add_figure_panel', { kind: 'structure', view: 'Core' });
  await act('export', { what: 'structure-image', path: join(out, 'core-4x.png'), scale: 4, light: true });
  await act('export_figure', { figure: structureFigure.data.figure, path: join(out, 'structure-figure.svg') });
  const structureSVG = readFileSync(join(out, 'structure-figure.svg'), 'utf8');
  const panelImage = Buffer.from(structureSVG.match(/href="data:image\/png;base64,([^"]+)"/)?.[1] ?? '', 'base64');
  const own4x = decodePNG(readFileSync(join(out, 'core-4x.png')));
  const inFigure = panelImage.length ? decodePNG(panelImage) : null;
  const imageField = structureFigure.data.panel.options.image;
  // Through the archive, opened again in the page (a copy: the workspace is in the library).
  await act('export', { what: 'archive', path: join(out, 'grb2-views.msz') });
  const viewsArchive = await readArchive(readFileSync(join(out, 'grb2-views.msz')));
  const archivedImage = viewsArchive.sources.get(imageField.sha256);
  check('add_figure_panel of a saved structure view: its figure panel drawn at 4× on white and kept with the figure, the same pixels as export structure-image draws the view (light: on white), the same bytes in the figure\'s SVG and in the archive', `${structureFigure.message.slice(0, 80)}; ${inFigure ? `${inFigure.width} × ${inFigure.height}` : 'no image'} against ${own4x.width} × ${own4x.height}, ${inFigure && Buffer.compare(Buffer.from(inFigure.rgba), Buffer.from(own4x.rgba)) === 0 ? 'the same pixels' : 'different pixels'}; archive ${archivedImage && Buffer.compare(Buffer.from(archivedImage), panelImage) === 0 ? 'the same bytes' : 'not the same'}`, inFigure && inFigure.width === own4x.width && inFigure.height === own4x.height && Buffer.compare(Buffer.from(inFigure.rgba), Buffer.from(own4x.rgba)) === 0 && imageField.width === own4x.width && archivedImage && Buffer.compare(Buffer.from(archivedImage), panelImage) === 0);
  const methodsText = viewsArchive.methods?.markdown ?? '';
  await act('open_files', { paths: [join(out, 'grb2-views.msz')] });
  const fromArchive = await act('open_structure_view', { name: 'Core' });
  await act('export', { what: 'structure-image', path: join(out, 'core-3.png'), scale: 2 });
  const core3 = readFileSync(join(out, 'core-3.png'));
  const copyState = await act('get_state');
  check('the workspace archive with the saved view: the structure\'s file in it (by its SHA-256), the methods naming it and its mapping; opened as a copy, the view opens from it as it was saved, the same image', `${viewsArchive.manifest.structures}; ${viewsArchive.sources.has(vwfSha) ? 'the file in it' : 'no file'}; methods ${/its file's SHA-256 [0-9a-f]{64}/.test(methodsText) ? 'name it' : 'do not name it'}; opened in "${copyState.data.workspace.name}": ${fromArchive.message.slice(0, 100)}; images ${imageOnly(core1).equals(imageOnly(core3)) ? 'the same' : 'different'}`, viewsArchive.manifest.structures === 'included' && viewsArchive.sources.has(vwfSha) && !viewsArchive.problems.length && methodsText.includes(`its file's SHA-256 ${vwfSha}`) && /placed on chain A: 56 of its 56 positions on residues/.test(methodsText) && copyState.data.structureViews.some((v) => v.name === 'Core') && imageOnly(core1).equals(imageOnly(core3)));
  // Named by checksum only (the file not in the library): fetched again by its ID, its SHA-256 the one saved.
  await act('export', { what: 'archive', path: join(out, 'grb2-views-light.msz'), include_structures: false });
  const lightArchive = await readArchive(readFileSync(join(out, 'grb2-views-light.msz')));
  await browser.eval(`(() => { const lib = window.mavescape.library; const get = lib.getFile.bind(lib); window.__getFile = get; lib.getFile = async (sha) => (sha === ${JSON.stringify(vwfSha)} ? null : get(sha)); return true; })()`);
  const refetchedView = await act('open_structure_view', { name: 'Core' });
  await browser.eval(`(() => { window.mavescape.library.getFile = window.__getFile; return true; })()`);
  check('an archive with the structures named by checksum only: no structure file in it; a view whose file the library lacks fetches it again by its ID (the fetcher\'s cache) and finds its SHA-256 the one saved', `${lightArchive.manifest.structures}, ${lightArchive.sources.has(vwfSha) ? 'the file in it' : 'no file'} | ${refetchedView.message}`, lightArchive.manifest.structures === 'checksums' && !lightArchive.sources.has(vwfSha) && refetchedView.data.notes.some((n) => /fetched again by its ID, its SHA-256 the one saved/.test(n)));
  const removedView = await act('remove_structure_view', { name: 'Core' });
  const noView = await send('open_structure_view', { name: 'Core' });
  check('remove_structure_view: the view removed, and its structure with it (no other view shows it); opened again, refused', `${removedView.message} | ${noView.message}`, !removedView.data.views.includes('Core') && !removedView.data.structures.length && !noView.ok);

  // Wave 5, slice 6: open in Proteoscope. A fake Proteoscope (its startup answer, as 0.10.0's
  // local.go writes it) where --proteoscope says; nothing there at first.
  const psSeen = [];
  let psVersion = '0.10.0';
  const fakeProteoscope = createServer((request, response) => {
    psSeen.push(`${request.method} ${request.url}`);
    if (request.url === '/api/startup') {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ version: psVersion, offline: false, remoteControl: false, files: null }));
    } else {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end('<!doctype html><title>Proteoscope (a fake)</title>');
    }
  });
  const psListen = () => new Promise((done) => fakeProteoscope.listen(PROTEOSCOPE_PORT, '127.0.0.1', done));
  const psClose = () => new Promise((done) => { fakeProteoscope.close(() => done()); fakeProteoscope.closeAllConnections?.(); });
  const psButton = () => browser.eval(`Boolean(document.querySelector('.proteoscope-handoff'))`);
  const payloadOf = (link) => JSON.parse(inflateRawSync(Buffer.from(link.split('#session=')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64')).toString('utf8'));
  await act('open_structure', { pdb: '2VWF' });
  await act('set_structure', { color: 'median', select: 'pos 20-26', show: 'sticks' });
  await act('set_structure', { select: 'chain B and resi 1-3', show: 'hide' });
  await act('set_structure', { select: 'pos 21+25', label: true });
  const noProteoscope = await send('proteoscope_link');
  const noButton = !(await psButton());
  check('proteoscope_link with no Proteoscope running: refused, saying where it was looked for; the Structure view offers no Proteoscope button', noProteoscope.message, !noProteoscope.ok && new RegExp(`not running on this computer \\(looked at 127\\.0\\.0\\.1:${PROTEOSCOPE_PORT}\\)`).test(noProteoscope.message) && noButton);

  await psListen();
  // Handed over at once after a focus, while the camera moves to it: the session has the camera
  // where it comes to rest.
  await act('set_structure', { select: 'pos 25', focus: true });
  await act('set_structure', { select: 'pos 21+25' });
  const handed = await act('proteoscope_link');
  const cameraNow = () => browser.eval(`import('/ui/mode-structure.js').then((m) => JSON.stringify(m.structureState(window.mavescape).viewer.camera))`);
  for (let i = 0, last = ''; i < 50; i += 1) {
    const c = await cameraNow();
    if (c === last) break;
    last = c;
    await sleep(200);
  }
  const link = handed.data.link ?? '';
  const sent = link.includes('#session=') ? payloadOf(link) : null;
  const one = sent?.structures?.[0];
  const viewNow = await browser.eval(`import('/ui/mode-structure.js').then((m) => { const v = m.structureState(window.mavescape).viewer; return { camera: v.camera, styled: [...v.styled], hidden: v.hidden, focus: v.focused, selection: [...v.selection], labels: [...v.labels] }; })`);
  const dataNode = residueData(medianNode, vwfMaps);
  const sameData = one?.proteomics?.data?.length === dataNode.length && dataNode.every(([k, v], i) => one.proteomics.data[i][0] === k && Math.abs(one.proteomics.data[i][1] - v) <= 1e-5 * Math.max(1, Math.abs(v)));
  const range = dataRange(medianNode.domain);
  const unlike = Object.entries({
    how: handed.data.how === 'session', link: link.startsWith(`http://127.0.0.1:${PROTEOSCOPE_PORT}/#session=`), returned: JSON.stringify(sent) === JSON.stringify(handed.data.session),
    format: sent?.format === 'proteoscope-session' && sent?.version === 1, source: one?.source?.type === 'fetch' && one?.source?.id === '2VWF',
    data: sameData && dataNode.length === 56 && one.proteomics.dataLabel === 'Median score, Run 1',
    colors: one?.color?.scheme === 'data' && one.color.colormap === 'bwr' && Math.abs(one.color.range.min - range.min) < 1e-9 && Math.abs(one.color.range.max - range.max) < 1e-9 && Math.abs((range.min + range.max) / 2 - medianNode.domain.center) < 1e-9,
    styles: JSON.stringify(one?.display?.residueStyles) === JSON.stringify(viewNow.styled) && viewNow.styled.length === 7,
    hidden: JSON.stringify(one?.display?.hiddenResidues) === JSON.stringify(viewNow.hidden) && viewNow.hidden.length === 3,
    focus: JSON.stringify(one?.focus) === JSON.stringify(viewNow.focus) && viewNow.focus.length === 1,
    selection: one?.selection?.join() === 'A:21:ARG,A:25:ILE' && one?.labels?.join() === 'A:21:ARG,A:25:ILE',
    camera: sent?.view?.camera?.distance === viewNow.camera.distance && sent.view.camera.rotation.join() === viewNow.camera.rotation.join() && sent.view.camera.target.join() === viewNow.camera.target.join(),
  }).filter(([, ok]) => !ok).map(([k]) => k);
  check('proteoscope_link with Proteoscope 0.10.0 running: a link to it carrying the session (deflated, URL-safe base64), the session the action returns; 2VWF fetched by its ID; GRB2\'s median scores on the 56 residues Node places them on, as its custom residue data, on Proteoscope\'s blue–white–red over the map\'s range centered on the wild type; the residues drawn as sticks, hidden, focused on, selected and labeled, and the camera, as the view has them', `${handed.message} | ${link.length} characters; ${one?.proteomics?.data?.length} values, ${sameData ? 'as Node\'s' : 'not Node\'s'}; range ${one?.color?.range?.min?.toFixed(3)} to ${one?.color?.range?.max?.toFixed(3)}${unlike.length ? `; not as the view: ${unlike.join(', ')}` : ''}`, !unlike.length);
  check('the handoff sends Proteoscope nothing: MaveScape only asked its startup answer, the session travels in the link', psSeen.join(', '), psSeen.length >= 1 && psSeen.every((r) => r === 'GET /api/startup'));

  // The button, as a click opens the link: a new tab at the fake Proteoscope's address.
  for (let i = 0; i < 50 && !(await psButton()); i += 1) await sleep(100);
  const buttonShown = await psButton();
  await browser.send('Runtime.evaluate', { expression: `document.querySelector('.proteoscope-handoff').click()`, userGesture: true });
  let psTab = null;
  for (let i = 0; i < 50 && !psTab; i += 1) {
    await sleep(100);
    psTab = (await browser.send('Target.getTargets')).targetInfos.find((t) => t.type === 'page' && t.url.startsWith(`http://127.0.0.1:${PROTEOSCOPE_PORT}/`));
  }
  const toastText = await browser.eval(`[...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | ')`);
  if (psTab) await browser.send('Target.closeTarget', { targetId: psTab.targetId });
  check('the Structure view\'s Proteoscope button, shown while Proteoscope runs: a click opens the link in a new tab, the same session, and says what it sent', `${buttonShown ? 'shown' : 'not shown'}; ${psTab ? `a tab at ${psTab.url.slice(0, 60)}…` : 'no tab'}; ${toastText.slice(0, 200)}`, buttonShown && Boolean(psTab) && JSON.stringify(payloadOf(psTab.url).structures[0].proteomics) === JSON.stringify(one.proteomics) && /Opened 2VWF in Proteoscope 0\.10\.0/.test(toastText));

  // A version not tested: the structure alone in the link, the session as a file.
  psVersion = '0.11.0';
  const untested = await act('proteoscope_link');
  check('proteoscope_link with Proteoscope 0.11.0 (a version not tested): a link to the structure alone (#fetch=2VWF), the scores and view in a session file, saying why', untested.message, untested.data.how === 'structure' && untested.data.link === `http://127.0.0.1:${PROTEOSCOPE_PORT}/#fetch=2VWF` && untested.data.file === '2VWF.proteoscope.json' && untested.data.session.structures[0].proteomics.data.length === 56 && /tested with Proteoscope 0\.10/.test(untested.message));

  // A file of the person's: the session as a file, the file embedded (its text, as MaveScape read it).
  psVersion = '0.10.0';
  const pdbPath = join(ROOT, 'validation/fixtures/structures/2VWF.pdb.gz');
  await act('open_files', { paths: [pdbPath] });
  await act('set_structure', { color: 'median' });
  const psFromFile = await act('proteoscope_link');
  const embedded = psFromFile.data.session.structures[0].source;
  const embeddedText = embedded.type === 'file' ? gunzipSync(Buffer.from(embedded.data, 'base64')).toString('utf8') : '';
  const fileData = psFromFile.data.session.structures[0].proteomics.data ?? [];
  check('proteoscope_link on a file of the person\'s (RCSB\'s PDB-format 2VWF): no link; the session to open as a file, the file\'s text embedded as Proteoscope embeds one (gzip, base64), the same scores on the same residues as the entry\'s', `${psFromFile.message.slice(0, 220)} | ${embedded.name}: ${embeddedText.length} characters, the file's ${gunzipSync(readFileSync(pdbPath)).length}; ${fileData.length} values`, psFromFile.data.how === 'file' && psFromFile.data.link === null && embedded.name === '2VWF.pdb' && embeddedText === gunzipSync(readFileSync(pdbPath)).toString('utf8') && JSON.stringify(fileData) === JSON.stringify(one.proteomics.data));

  // Proteoscope gone: the button goes, the action is refused; the session file is still written.
  await psClose();
  const gone = await send('proteoscope_link');
  for (let i = 0; i < 50 && (await psButton()); i += 1) await sleep(100);
  const sessionPath = join(out, '2VWF.proteoscope.json');
  const exported = await act('export', { what: 'proteoscope-session', path: sessionPath });
  const written = JSON.parse(readFileSync(sessionPath, 'utf8'));
  check('Proteoscope stopped: proteoscope_link refused, the button gone; export proteoscope-session writes the session file all the same (Proteoscope need not run)', `${gone.message} | ${exported.message.slice(0, 160)}`, !gone.ok && /not running/.test(gone.message) && !(await psButton()) && written.format === 'proteoscope-session' && written.structures[0].source.type === 'file' && written.structures[0].proteomics.data.length === 56);
  await act('open_example', { id: 'factor9' });
  await act('open_structure', { pdb: '1RFN' });
  const lightChain = await act('map_structure', { chain: 'B' });
  const lightNode = mapTargetOnChain(await openCached('pdb', pdbFile('1RFN')), 'B', exampleTarget('factor9'));
  const noChain = await send('map_structure', { chain: 'X' });
  check('map_structure: factor IX on 1RFN\'s light chain (chain B), at 132–188, the entry\'s own record five earlier, as Node maps it; a chain that does not hold it refused, naming those that do', `${lightChain.message.slice(0, 260)} | ${noChain.message}`, lightChain.data.chain === 'B' && lightChain.data.onStructure === lightNode.onStructure && lightChain.data.positions.onStructure.join() === '132–188' && lightChain.data.record.differ.length === 56 && /5 earlier/.test(lightChain.message) && !noChain.ok && /Chains that hold it: A, B/.test(noChain.message));

  // WebGPU lost under the view (the 0.5.0 release; GitHub's runner lost it on its own): the GPU
  // process crashed (Browser.crashGpuProcess) while factor IX's 1RFN is drawn with WebGPU, the view goes on with
  // the Canvas renderer on a fresh canvas, its badge and words saying why, the structure drawn again
  // with its colors. Where WebGPU was lost already, the view is found so.
  await act('open_structure', { pdb: '1RFN' });
  await act('set_structure', { color: 'median', select: 'resn CYS', label: true });
  const beforeCrash = await viewerNow();
  if (beforeCrash.kind === 'webgpu') await browser.send('Browser.crashGpuProcess').catch(() => { /* not offered: found below */ });
  let afterCrash = await viewerNow();
  for (let i = 0; i < 50 && afterCrash.kind === 'webgpu'; i += 1) {
    await sleep(100);
    afterCrash = await viewerNow();
  }
  const lostShare = await browser.eval(drawnShare).catch(() => 0);
  const badge = await browser.eval(`document.querySelector('.renderer-badge')?.textContent ?? ''`);
  const afterLoss = await send('set_structure', { select: 'chain B', show: 'sticks' });
  check('WebGPU lost under the view (the GPU process crashed): the view goes on with the Canvas renderer, its badge and words saying why, the structure drawn again, still answering', `${beforeCrash.kind === 'webgpu' ? 'crashed under WebGPU' : `already ${beforeCrash.kind}`}; now ${afterCrash.kind} (${afterCrash.failure.slice(0, 120)}); badge ${badge}; ${fmtShare(lostShare)}; then ${afterLoss.ok ? afterLoss.data.renderer : afterLoss.message}`, afterCrash.kind === 'canvas' && /graphics device was lost|WebGPU failed|does not offer WebGPU|No WebGPU|WebGPU did not start/.test(afterCrash.failure) && badge === 'Canvas' && lostShare > 0.03 && afterLoss.ok && afterLoss.data.renderer === 'canvas');

  // The Canvas renderer, the page opened again.
  await browser.goto(`${URL}?renderer=canvas`, 1500);
  for (let i = 0; i < 100 && !(await browser.eval('Boolean(window.mavescape?.remote)')); i += 1) await sleep(100);
  await sleep(500);
  const everyCanvas = await openEveryStructure();
  const canvasSurface = await act('set_structure', { surface: 'ses' });
  check('the page opened with ?renderer=canvas: every example protein\'s entry and model drawn by the Canvas renderer, with the atoms Node reads; an image of each view not empty; a surface refused, saying it needs WebGPU', `${everyCanvas.map((x) => `${x.name} ${x.renderer} ${fmtShare(x.share)}${x.message ? ` ${x.message}` : ''}`).join('; ')}; surface: ${canvasSurface.data.surface.status}`, everyCanvas.length === 2 * EXAMPLE_STRUCTURES.length && everyCanvas.every((x) => x.ok && x.renderer === 'canvas') && /need WebGPU: the Canvas renderer was asked for/.test(canvasSurface.data.surface.status));

  const foreign = requested.filter((u) => !u.startsWith(URL) && !/^(data|blob):/.test(u));
  check('the page asked nothing of any origin but its own, public data through the program\'s /api/fetch/ only', `${requested.length} requests, ${requested.filter((u) => u.includes('/api/fetch/')).length} for public data; beyond the origin: ${foreign.slice(0, 3).join(', ') || 'none'}`, requested.length > 50 && !foreign.length && requested.some((u) => u.includes('/api/fetch/uniprot/P62993')));
  check('every action listed was exercised', `${[...called].length} of ${names.length}: missing ${names.filter((n) => !called.has(n)).join(', ') || 'none'}`, names.every((n) => called.has(n)));
  check('no uncaught errors in the page', errors.join(' | ') || 'none', errors.length === 0);
} catch (error) {
  check('the session ran to the end', error.stack ?? error.message, false);
} finally {
  await browser?.close();
  maveScape.stop();
  if (process.env.KEEP_REMOTE) console.log(`Kept ${temp}`);
  else rmSync(temp, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`remote-session: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
