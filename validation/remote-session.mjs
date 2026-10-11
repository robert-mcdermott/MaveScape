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
import { outputDigest } from '../web/lib/runs.js';
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

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8836;
const verbose = process.argv.includes('--verbose');
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
  const nodeBap1 = depositPackages(['bap1']).packages[0].deposit;
  const mavedbFiles = (files) => Object.fromEntries([...files].filter(([n]) => MAVEDB_FILES.includes(n)).map(([n, b]) => [n, typeof b === 'string' ? b : new TextDecoder().decode(b)]));
  const nodeFiles = mavedbFiles(new Map(nodeBap1.files.map((f) => [f.name, f.text])));
  const sameAsNode = Object.keys(nodeFiles).length && Object.entries(nodeFiles).every(([n, t]) => mavedbFiles(bFiles)[n] === t) && Object.keys(mavedbFiles(bFiles)).length === Object.keys(nodeFiles).length;
  check('export mavedb: the deposit as one ZIP, the files MaveDB reads the same bytes as Node\'s (validated by MaveDB\'s own validators, suite mavedb-export)', `${bZip.message} ${[...bFiles.keys()].join(', ')}`, sameAsNode && bFiles.has('README.md') && bFiles.has('mavescape.json'));
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
