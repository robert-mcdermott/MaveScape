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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, sleep } from '../docs/capture/cdp.mjs';
import { readArchive } from '../web/lib/archive.js';
import { parseTable } from '../web/lib/csv.js';
import { outputDigest } from '../web/lib/runs.js';
import { DEFAULT_PARAMETERS, PRESETS } from '../web/lib/score.js';
import { FINGERPRINT } from '../web/lib/dmath.js';
import { allExports, recompute, scoreTable } from './roundtrip-cases.mjs';

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
mkdirSync(out);
let token = '';

async function startMaveScape() {
  const binary = join(temp, process.platform === 'win32' ? 'mavescape.exe' : 'mavescape');
  await new Promise((done, fail) => spawn('go', ['build', '-o', binary, '.'], { cwd: ROOT, stdio: 'inherit' }).on('exit', (code) => (code ? fail(new Error('go build failed (is Go installed?)')) : done())));
  const server = spawn(binary, ['--remote-control', '--window', 'none', '--port', String(PORT), '--data-dir', library], { cwd: temp, stdio: ['ignore', 'pipe', 'inherit'] });
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

  // QC: GRB2 passes everything but the variance beyond counting (its bottleneck).
  const qc = await act('qc_findings', { finding: 'variance' });
  const notPass = qc.data.findings.filter((f) => f.status !== 'pass' && f.status !== 'na');
  check('qc_findings: twelve findings, only the variance beyond counting not passing', `${qc.message} Not passing: ${notPass.map((f) => `${f.id} ${f.status}`).join(', ')}`, qc.data.findings.length === 12 && notPass.length === 1 && notPass[0].id === 'excess-variance');
  check('qc_findings shows the finding asked for in the QC view', await browser.eval('window.mavescape.qcView?.finding'), (await browser.eval(`window.mavescape.qcView?.finding`)) === 'excess-variance' && (await browser.eval(`document.getElementById('app').dataset.mode`)) === 'qc');
  const countsQc = await act('qc_findings', { run: 'counts' });
  check('qc_findings of the counts alone: the run-level findings are not assessed', countsQc.message, countsQc.data.findings.find((f) => f.id === 'separation')?.status === 'na');

  // Scoring: a second preset, the same run not computed twice, refused parameters.
  const enrich2 = await act('score', { preset: 'Enrich2' });
  const again = await act('score', { preset: 'enrich2' });
  const enrich2Digest = outputDigest(scoreTable(exampleTable, workspaceDesign, { ...PRESETS.enrich2.parameters, normalization: 'wt' }).results);
  check('score with the Enrich2 preset: a new run equal to Node\'s', enrich2.message, enrich2.data.name === 'Run 2' && enrich2.data.outputSha256 === enrich2Digest);
  check('scoring the same inputs again shows the existing run', again.message, again.data.existing === true && again.data.id === enrich2.data.id);
  const refused = await send('score', { parameters: { pseudocount: 0 } });
  check('parameters that cannot score are refused with the reason', refused.message, !refused.ok && /pseudocount/i.test(refused.message));

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
    scores: 'scores.csv', counts: 'counts.csv', 'qc-samples': 'qc_samples.csv', 'qc-variants': 'qc_variants.csv',
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
  check('the exported archive opens', `${archived.message} ${archive.problems.length} problems`, archive.problems.length === 0 && archive.ws.runs.length === 2 && archive.ws.selections.length === 1);
  const { table, scored } = recompute(archive.ws, archive.sources);
  const expected = allExports(archive.ws, table, scored.results);
  for (const name of ['scores.csv', 'counts.csv', 'qc_samples.csv', 'qc_variants.csv', 'methods.md', 'references.bib', 'map.svg', 'selection.csv', 'selection.json']) {
    const written = readFileSync(join(out, name), 'utf8');
    check(`export ${name}: the same bytes as Node's from the archive`, `${written.length} bytes`, written === expected[name], `${expected[name].length} bytes`);
  }
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
