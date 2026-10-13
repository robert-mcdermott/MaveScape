// A scripted agent session (wave 7, slice 1): `mavescape mcp` driven over stdin and stdout as an AI
// agent's client drives it, with no model, every tool called on the examples in a headless browser
// (the window the person would watch). It checks the protocol (initialize, tools/list equal to the
// actions with their titles and hints, errors), that every tool answers, that each tool said to
// read only leaves the workspace's history as it was, that every change the agent made carries its
// name in the history, that results are Node's where Node computes them (the runs' output hashes,
// a variant's score, a query's variants, a certificate verified) and the remote action's own, field
// for field; and that stdout carries nothing but JSON-RPC and the program stops when stdin closes.
//
//   node validation/agent-session.mjs [--verbose] [--like-ci [rate]]
//
// Needs Go (to build MaveScape) and Chrome, Chromium, Edge or Brave (CHROME=path). Offline: the
// public data come from the fetcher's cached answers (validation/fixtures/public-data). Exits with
// status 1 when a check fails.

import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, sleep } from '../docs/capture/cdp.mjs';
import { outputDigest } from '../web/lib/runs.js';
import { defaultParameters, withDefaults } from '../web/lib/score.js';
import { readCertificate, verifyCertificate } from '../web/lib/certificate.js';
import { readFigureManifest } from '../web/lib/figure-manifest.js';
import { buildMapModel } from '../web/lib/map-model.js';
import { queryContext, selectByQuery } from '../web/lib/query.js';
import { exampleById } from '../web/lib/examples.js';
import { openExampleInNode } from './example-cases.mjs';
import { scoreTable } from './roundtrip-cases.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8856;
const verbose = process.argv.includes('--verbose');
const likeCI = process.argv.includes('--like-ci');
const ciRate = likeCI ? Number(process.argv[process.argv.indexOf('--like-ci') + 1]) || 4 : 1;
const AGENT = 'Agent session';
const results = [];
function check(name, value, ok, required = '') {
  results.push({ name, ok });
  if (verbose || !ok) console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} — ${value}${required ? ` (required ${required})` : ''}`);
}

// --- mavescape mcp, and an MCP client on its stdio ---------------------------------------------

const temp = mkdtempSync(join(tmpdir(), 'mavescape-agent-'));
const library = join(temp, 'library');
const cache = join(temp, 'cache');
const out = join(temp, 'out');
mkdirSync(out);
cpSync(join(ROOT, 'validation/fixtures/public-data'), cache, { recursive: true });
const binary = join(temp, process.platform === 'win32' ? 'mavescape.exe' : 'mavescape');
await new Promise((done, fail) => spawn('go', ['build', '-o', binary, '.'], { cwd: ROOT, stdio: 'inherit' }).on('exit', (code) => (code ? fail(new Error('go build failed (is Go installed?)')) : done())));
const child = spawn(binary, ['mcp', '--window', 'none', '--port', String(PORT), '--data-dir', library, '--offline', '--cache-dir', cache, '--proteoscope', 'off'], { cwd: temp, stdio: ['pipe', 'pipe', 'pipe'] });
let stderr = '';
child.stderr.on('data', (chunk) => { stderr += chunk; });
const exited = new Promise((done) => child.on('exit', (code) => done(code)));

// One JSON-RPC message per line on stdout: replies by id, notifications kept, anything else noted.
const pending = new Map();
const notifications = [];
const notJSON = [];
let buffered = '';
child.stdout.on('data', (chunk) => {
  buffered += chunk;
  for (let at = buffered.indexOf('\n'); at >= 0; at = buffered.indexOf('\n')) {
    const line = buffered.slice(0, at);
    buffered = buffered.slice(at + 1);
    if (!line.trim()) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      notJSON.push(line);
      continue;
    }
    if (message.id !== undefined && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    } else notifications.push(message);
  }
});
let nextId = 1;
function rpc(method, params) {
  const id = nextId++;
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) })}\n`);
  return new Promise((done, fail) => {
    pending.set(id, done);
    setTimeout(() => {
      if (pending.delete(id)) fail(new Error(`${method} got no reply`));
    }, 15 * 60 * 1000);
  });
}

// A tool's call: { error } for a JSON-RPC error, else { isError, text, message, data }.
const called = new Set();
let hints = new Map();
let page = null;
const historyHead = () => page.eval('JSON.stringify([window.mavescape.store.ws.id, window.mavescape.store.ws.history.at(-1)?.hash ?? null])');
const readOnlyChanged = [];
async function call(name, args = {}, meta = null) {
  called.add(name);
  const before = hints.get(name)?.readOnlyHint && page ? await historyHead() : null;
  const reply = await rpc('tools/call', { name, arguments: args, ...(meta ? { _meta: meta } : {}) });
  if (reply.error) return { error: reply.error };
  const r = reply.result;
  const text = r.content?.find((c) => c.type === 'text')?.text ?? '';
  if (before !== null && before !== (await historyHead())) readOnlyChanged.push(name);
  return { isError: r.isError === true, text, message: r.structuredContent?.message, data: r.structuredContent?.data, result: r };
}
async function tool(name, args = {}, meta = null) {
  const r = await call(name, args, meta);
  if (r.error || r.isError) throw new Error(`${name} ${JSON.stringify(args).slice(0, 160)}: ${r.error?.message ?? r.text}`);
  return r;
}

let browser = null;
try {
  for (let i = 0; i < 300 && !/running at http/.test(stderr); i += 1) await sleep(100);
  const URL = `${/running at (http:\/\/[\d.]+:\d+)/.exec(stderr)?.[1]}/`;
  const token = /X-MaveScape-Token: (\S+)/.exec(stderr)?.[1];
  check('mavescape mcp starts MaveScape with remote control on, its banner on stderr', stderr.split('\n').filter(Boolean).slice(0, 2).join(' | '), URL.startsWith('http://127.0.0.1:') && /MCP: answering on stdin and stdout/.test(stderr) && Boolean(token));

  // --- The protocol -------------------------------------------------------------------------
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'agent-session', title: AGENT, version: '1' } });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  check('initialize: the protocol version asked, MaveScape named with its version, the tools offered and instructions saying where to start and what not to call a variant', `${init.result.protocolVersion}; ${init.result.serverInfo.name} ${init.result.serverInfo.version}; ${init.result.instructions.length} characters of instructions`,
    init.result.protocolVersion === '2025-06-18' && init.result.serverInfo.name === 'mavescape' && init.result.capabilities.tools && /Start with get_state/.test(init.result.instructions) && /never a clinical classification/.test(init.result.instructions));
  const listed = (await rpc('tools/list')).result.tools;
  hints = new Map(listed.map((t) => [t.name, t.annotations]));
  const actions = (await (await fetch(`${URL}api/remote/tools`)).json()).tools;
  const same = listed.length === actions.length && listed.every((t, i) => t.name === actions[i].name && t.title === actions[i].title && t.description === actions[i].description && JSON.stringify(t.inputSchema) === JSON.stringify(actions[i].inputSchema));
  const kinds = { read: listed.filter((t) => t.annotations.readOnlyHint).length, destructive: listed.filter((t) => t.annotations.destructiveHint).length, public: listed.filter((t) => t.annotations.openWorldHint).length };
  check('tools/list: the remote actions, in order, each with its title, description and arguments\' schema as GET /api/remote/tools gives them, and MCP\'s hints', `${listed.length} tools (${kinds.read} read only, ${kinds.destructive} destructive, ${kinds.public} reaching public data)`, same && listed.length === 49 && listed.every((t) => t.title && typeof t.annotations.readOnlyHint === 'boolean' && typeof t.annotations.openWorldHint === 'boolean'));
  const unknown = await rpc('tools/call', { name: 'no_such_tool', arguments: {} });
  const missing = await call('inspect_variant', {});
  const nonsense = await rpc('nonsense/method');
  check('a tool that does not exist, a required argument left out and an unknown method: errors that say so', `${unknown.error?.message}; ${missing.text}; ${nonsense.error?.message}`, unknown.error?.code === -32602 && /no_such_tool/.test(unknown.error.message) && missing.isError && missing.text === 'variant is required.' && nonsense.error?.code === -32601);
  called.delete('inspect_variant');

  // --- The window the person watches -------------------------------------------------------
  browser = await launch({ width: 1440, height: 900, scale: 1, args: likeCI ? ['--use-webgpu-adapter=swiftshader'] : [] });
  if (likeCI) await browser.send('Emulation.setCPUThrottlingRate', { rate: ciRate });
  const errors = [];
  browser.on('Runtime.exceptionThrown', (e) => errors.push(e.exceptionDetails?.exception?.description ?? e.exceptionDetails?.text));
  await browser.goto(URL, 1500);
  for (let i = 0; i < 100 && !(await browser.eval('Boolean(window.mavescape?.remote)')); i += 1) await sleep(100);
  page = browser;

  // --- GRB2: open, check, score, read ------------------------------------------------------
  const empty = await tool('get_state');
  const opened = await tool('open_example', { id: 'grb2-sh3' });
  const node = openExampleInNode(exampleById('grb2-sh3'));
  const state = await tool('get_state');
  const run1 = state.data.runs.find((r) => r.name === 'Run 1');
  check('open_example and get_state: GRB2\'s example opened and scored, Run 1 Node\'s output hash', `${empty.message.slice(0, 60)} → ${opened.message.slice(0, 80)}…; Run 1 ${run1?.outputSha256.slice(0, 12)}…`, run1?.outputSha256 === outputDigest(node.scored.results));
  await tool('check');
  const reproduced = await tool('reproduce_run', { run: 'Run 1' });
  const qc = await tool('qc_findings', { finding: 'variance' });
  const excess = qc.data.findings.find((f) => f.id === 'excess-variance');
  check('check, reproduce_run and qc_findings: the table valid, Run 1 reproduced, the variance beyond counting failing as Node finds it', `${reproduced.data.status}; ${excess?.status} (${excess?.value})`, reproduced.data.status === 'reproduced' && excess?.status === node.findings.find((f) => f.id === 'excess-variance').status);
  await tool('acknowledge_finding', { finding: 'excess-variance', reason: 'The input bottleneck the Domainome\'s own analysis found' });
  const enrich2 = await tool('score', { preset: 'enrich2' }, { progressToken: 'score' });
  const nodeEnrich2 = scoreTable(node.table, node.design, withDefaults(defaultParameters(node.design, node.ws.sources[0], 'enrich2')));
  const run2 = (await tool('get_state')).data.runs.find((r) => r.name === 'Run 2');
  check('score with the Enrich2-compatible preset: Run 2, Node\'s output hash', `${enrich2.message.slice(0, 80)}; ${run2?.outputSha256.slice(0, 12)}…`, run2?.outputSha256 === outputDigest(nodeEnrich2.results));
  const variant = await tool('inspect_variant', { variant: 'p.Trp36Ala', run: 'Run 1' });
  const row = node.scored.results.variants.key.indexOf('p.Trp36Ala');
  const nodeScore = node.scored.results.conditions[0].score[row];
  const query = 'lower and position 30-40';
  const selected = await tool('select_variants', { query, run: 'Run 1', save_as: 'Core lower' });
  const model = buildMapModel(node.scored.results, node.design);
  const nodeKeys = selectByQuery(query, queryContext({ model, results: node.scored.results, design: node.design })).keys;
  check('inspect_variant and select_variants by query: p.Trp36Ala\'s score and the query\'s variants Node\'s', `${variant.data.score} (as the page rounds it) against ${nodeScore.toPrecision(6)}; ${selected.data.variants.length} variants against ${nodeKeys.length}`, Math.abs(variant.data.score - nodeScore) <= 5e-4 * Math.max(1, Math.abs(nodeScore)) && JSON.stringify(selected.data.variants) === JSON.stringify(nodeKeys));
  const map = await tool('render_map', { run: 'Run 1' });
  const compared = await tool('compare', { a: 'Run 1', b: 'Run 2' });
  // The same comparison asked of remote control: the agent gets the action's own result.
  const byScript = await (await fetch(`${URL}api/remote/action`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'compare', args: { a: 'Run 1', b: 'Run 2' }, client: 'agent-session (as a script)' }) })).json();
  check('render_map and compare: the map in words, every cell counted; the comparison\'s statistics the remote action\'s, field for field', `${Object.values(map.data.counts).reduce((a, b) => a + b, 0)} cells; r ${compared.data.statistics?.pearson?.r}`, Object.values(map.data.counts).reduce((a, b) => a + b, 0) === 56 * 21 && JSON.stringify(compared.data) === JSON.stringify(byScript.data) && compared.message === byScript.message);
  const robust = await tool('check_robustness', { run: 'Run 1', max: 12 }, { progressToken: 'robustness' });
  const progress = notifications.filter((n) => n.method === 'notifications/progress');
  check('check_robustness, a long call with a progress token: answered, and any progress sent before its answer under its token', `${robust.message.slice(0, 100)}…; ${progress.length} progress notification(s)`, Boolean(robust.data) && progress.every((n) => ['score', 'robustness'].includes(n.params.progressToken)));

  // --- Annotations, the target, MaveDB's details -------------------------------------------
  await tool('list_tracks', { run: 'Run 1' });
  const added = await tool('add_track', { provider: 'uniprot-features', run: 'Run 1' });
  await tool('set_track', { track: 'Coverage', shown: true });
  await tool('remove_track', { annotation: added.data.annotation });
  await tool('check_target', { apply: true });
  await tool('mavedb_deposit', {});
  await tool('set_mavedb_details', { details: { abstract: 'Abundance of every substitution in the SH3 domain of GRB2.' } });
  await tool('draft_design');
  await tool('set_design', { design: JSON.parse(await page.eval('JSON.stringify(window.mavescape.store.ws.design)')) });
  await tool('set_mode', { mode: 'map' });
  await tool('focus', { kind: 'run', name: 'Run 2' });

  // --- Structures --------------------------------------------------------------------------
  await tool('find_structures', {});
  await tool('open_structure', { pdb: '2VWF' });
  await tool('map_structure', {});
  await tool('set_structure', { color: 'median' });
  await tool('structure_evidence', {});
  await tool('save_structure_view', { name: 'Core' });
  await tool('open_structure_view', { name: 'Core' });
  const handoff = await call('proteoscope_link');
  check('proteoscope_link with Proteoscope looked for nowhere (--proteoscope off): refused, saying why', handoff.text.slice(0, 120), handoff.isError && /Proteoscope/.test(handoff.text));

  // --- Figures, the record -----------------------------------------------------------------
  await tool('create_figure', { name: 'Figure 1', size: 'double' });
  await tool('add_figure_panel', { figure: 'Figure 1', run: 'Run 1', tracks: ['reference', 'effect'], height_mm: 90 });
  await tool('add_figure_panel', { figure: 'Figure 1', kind: 'structure', view: 'Core' });
  await tool('set_figure', { figure: 'Figure 1', name: 'GRB2' });
  await tool('figures', { figure: 'GRB2' });
  const figurePath = join(out, 'grb2.svg');
  await tool('export_figure', { figure: 'GRB2', path: figurePath });
  const manifest = readFigureManifest(readFileSync(figurePath, 'utf8'));
  const checkedFigure = await tool('check_figure', { paths: [figurePath] });
  await tool('remove_structure_view', { name: 'Core' });
  await tool('checkpoint', { name: 'Before the record' });
  const diff = await tool('diff');
  await tool('report');
  const certPath = join(out, 'grb2.certificate.msz');
  await tool('certify', { path: certPath });
  const verified = await tool('verify_certificate', { paths: [certPath] });
  const inNode = await verifyCertificate(await readCertificate(new Uint8Array(readFileSync(certPath))), { software: { version: init.result.serverInfo.version, commit: '' } });
  await tool('review_report', { path: join(out, 'grb2.review.html') });
  const scoresPath = join(out, 'scores.csv');
  await tool('export', { what: 'scores', path: scoresPath, run: 'Run 1' });
  const replace = await call('export', { what: 'scores', path: scoresPath, run: 'Run 1' });
  check('the record through the agent: a figure exported with its manifest and checked; a checkpoint and what changed since; certified, verified in the window and in Node; files written to the paths given, an existing one not replaced', `manifest ${manifest?.panels.length} panels, ${checkedFigure.data.panels?.map((p) => p.status).join(', ')}; ${diff.data.summary}; window ${verified.data.verdict}, Node ${inNode.verdict}; ${replace.text.slice(0, 80)}`,
    manifest?.panels.length === 2 && diff.data.same && verified.data.verdict === 'verified' && inNode.verdict === 'verified' && existsSync(join(out, 'grb2.review.html')) && readFileSync(scoresPath, 'utf8').split('\n').length > 1000 && replace.isError && /exists/.test(replace.text));

  // Every change the agent made carries its name in the workspace's history.
  const history = JSON.parse(await page.eval('JSON.stringify(window.mavescape.store.ws.history)'));
  const byAgent = history.filter((e) => e.by === AGENT).length;
  check('every change the agent made carries its name in the workspace\'s history (by), in each entry\'s hash', `${byAgent} of ${history.length} entries by "${AGENT}"; ${history.filter((e) => e.by !== AGENT).map((e) => e.action).join(', ') || 'none otherwise'}`, history.length > 10 && history.every((e) => e.by === AGENT));

  // --- Opening data by path and from MaveDB ------------------------------------------------
  const archive = join(out, 'grb2.msz');
  await tool('export', { what: 'archive', path: archive });
  const reopened = await tool('open_files', { paths: [archive] });
  const found = await tool('search_mavedb', { text: 'grb2' });
  const fromMaveDB = await tool('open_mavedb', { urn: 'urn:mavedb:00000835-a-1' });
  const blank = await tool('new_workspace', { name: 'Blank' });
  check('open_files of the archive the agent wrote, search_mavedb and open_mavedb from the cache, new_workspace', `${reopened.message.slice(0, 60)}…; ${found.data.total} found; ${fromMaveDB.message.slice(0, 60)}…; ${blank.message.slice(0, 40)}`, found.data.hits?.[0]?.urn === 'urn:mavedb:00000835-a-1' && /urn:mavedb:00000835-a-1/.test(fromMaveDB.message));

  // --- What the session as a whole shows ---------------------------------------------------
  const never = listed.map((t) => t.name).filter((n) => !called.has(n));
  check('every tool called', `${called.size} of ${listed.length}${never.length ? `; never: ${never.join(', ')}` : ''}`, !never.length);
  check('every tool said to read only left the workspace\'s history as it was', readOnlyChanged.length ? `changed it: ${readOnlyChanged.join(', ')}` : `${[...called].filter((n) => hints.get(n)?.readOnlyHint).length} read-only tools, none changed it`, !readOnlyChanged.length);
  check('the page threw nothing', errors.length ? errors[0].slice(0, 200) : 'nothing', !errors.length);
} catch (error) {
  check('the session ran to its end', error.stack ?? error.message, false);
} finally {
  // The agent closes stdin: MaveScape stops, its connection file removed.
  child.stdin.end();
  const code = await Promise.race([exited, sleep(10000).then(() => 'still running')]);
  check('stdout carried nothing but JSON-RPC, and closing stdin stopped MaveScape and removed its connection file', `${notJSON.length} other lines; exit ${code}; remote.json ${existsSync(join(library, 'remote.json')) ? 'still there' : 'removed'}`, !notJSON.length && code === 0 && !existsSync(join(library, 'remote.json')));
  if (code === 'still running') child.kill();
  await browser?.close();
  rmSync(temp, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`agent-session: ${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
