// A scripted remote-control session: every action (actions.go) driven through the program's hub,
// as a script drives it, in the real program and a headless browser, on the bundled examples.
// Each result is checked against the same analysis made in Node: scores against the scoring
// engine, and every export, written to disk by the hub, against the files made in Node from the
// workspace archive the session exported (the record's round trip, wave 1 slice 8).
//
//   node validation/remote-session.mjs [--verbose]
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
import { allExports, recompute, scoreTable } from './roundtrip-cases.mjs';
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
import { tracksCSV } from '../web/lib/tracks.js';
import { openExampleInNode } from './example-cases.mjs';
import { classesCSV, compareSides, comparisonCSV, comparisonJSON, describeSide, differenceMap, positionsCSV, sideMap } from '../web/lib/compare.js';
import { predictorSide, scoreSetSide } from './compare-cases.mjs';
import { checkTable } from './robustness-cases.mjs';
import { robustnessCSV, robustnessJSON, robustnessPositionsCSV } from '../web/lib/robustness.js';
import { combineKeys, queryContext, selectByQuery } from '../web/lib/query.js';
import { placeTarget, placementPatch, readUniProtEntry, referenceOf } from '../web/lib/uniprot.js';
import { recordTargetCheck } from '../web/lib/workspace.js';
import { sha256 } from '../web/lib/sha256.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8836;
const verbose = process.argv.includes('--verbose');
const requireData = process.argv.includes('--require-data');
// DHFR's MaveDB tables (wave 3, slice 6), as node validation/fetch.mjs mavedb-dhfr keeps them: copied
// into the fetcher's cache, so that its two score sets open together offline.
const DHFR = join(dirname(fileURLToPath(import.meta.url)), 'cache', 'mavedb-dhfr');
const DHFR_TABLES = [['urn:mavedb:00000063-b-1', 'minus-lon'], ['urn:mavedb:00000063-a-1', 'plus-lon']];
// TP53's three score sets (wave 4, slice 6), as node validation/fetch.mjs mavedb-tp53-screens keeps
// them: the example opens the first, and compares the others kept beside.
const TP53 = join(dirname(fileURLToPath(import.meta.url)), 'cache', 'mavedb-tp53-screens');
const TP53_TABLES = [['urn:mavedb:00000068-c-1', 'scores.csv'], ['urn:mavedb:00000068-b-1', 'nutlin.csv'], ['urn:mavedb:00000059-a-1', 'kotler.csv']];
const results = [];
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
  const server = spawn(binary, ['--remote-control', '--window', 'none', '--port', String(PORT), '--data-dir', library, '--offline', '--cache-dir', cache], { cwd: temp, stdio: ['ignore', 'pipe', 'inherit'] });
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

  browser = await launch({ width: 1440, height: 900, scale: 1 });
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
