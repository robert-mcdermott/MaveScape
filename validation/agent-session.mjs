// A scripted agent session (wave 7, slices 1 and 2): `mavescape mcp` driven over stdin and stdout
// as an AI agent's client drives it, with no model, every tool called on the examples in a headless
// browser (the window the person watches, where the session also acts as the person: accepting and
// rejecting the agent's proposals in the strip above the view, and changing the workspace as a
// script does). It checks the protocol (initialize, tools/list equal to the actions with their
// titles and hints, errors), that every tool answers, that each tool said to read only leaves the
// workspace's history as it was, that every change the agent made carries its name in the history,
// that results are Node's where Node computes them (the runs' output hashes, a variant's score, a
// query's variants, a certificate verified) and the remote action's own, field for field; that
// each kind of change waits as it should, is applied when accepted and goes when rejected, with
// what the person built on it, and that nothing is certified meanwhile; and that stdout carries
// nothing but JSON-RPC and the program stops when stdin closes.
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
import { verifyHistory } from '../web/lib/workspace.js';
import { readFigureManifest } from '../web/lib/figure-manifest.js';
import { buildMapModel } from '../web/lib/map-model.js';
import { queryContext, selectByQuery } from '../web/lib/query.js';
import { exampleById } from '../web/lib/examples.js';
import { openExampleInNode } from './example-cases.mjs';
import { scoreTable, tableMatchesCSV } from './roundtrip-cases.mjs';
import { decodePNG, mapCellsAgree as cellsAgree, svgWidth } from './figure-cases.mjs';
import { mapSVG } from '../web/lib/map-svg.js';
import { pngSize } from '../web/lib/figures.js';

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

// The pictures of a tool's result (MCP image content), decoded: [{ width, height, rgba }].
const imagesOf = (r) => (r.result?.content ?? []).filter((c) => c.type === 'image').map((c) => decodePNG(Buffer.from(c.data, 'base64')));
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
  check('tools/list: the remote actions, in order, each with its title, description and arguments\' schema as GET /api/remote/tools gives them, and MCP\'s hints', `${listed.length} tools (${kinds.read} read only, ${kinds.destructive} destructive, ${kinds.public} reaching public data)`, same && listed.length === 54 && listed.every((t) => t.title && typeof t.annotations.readOnlyHint === 'boolean' && typeof t.annotations.openWorldHint === 'boolean'));
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

  // --- The person at the window ---------------------------------------------------------------
  const workspace = async () => JSON.parse(await page.eval('JSON.stringify(window.mavescape.store.ws)'));
  // The person's own changes, made as a script makes them (applied at once, not proposals): the
  // history entries they wrote.
  const personEntries = new Set();
  async function person(action, args = {}) {
    const before = (await workspace()).history.length;
    const r = await (await fetch(`${URL}api/remote/action`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-MaveScape-Token': token }, body: JSON.stringify({ action, args, client: 'The person' }) })).json();
    if (!r.ok) throw new Error(`The person's ${action}: ${r.message}`);
    for (const e of (await workspace()).history.slice(before)) personEntries.add(e.hash);
    return r;
  }
  const strip = () => page.eval(`[...document.querySelectorAll('.proposal-strip')].map((s) => s.textContent).join(' | ')`);
  // The person clicks Accept all or Reject all in the strip above the view (and Reject in the
  // dialog asking whether to remove what was built on the proposal): { dialog } (its text).
  async function decide(choice) {
    const clicked = await page.eval(`(() => { const s = document.querySelector('.proposal-strip[aria-label="The proposal of ${AGENT}"]'); const b = s && [...s.querySelectorAll('button')].find((x) => x.textContent === '${choice}'); if (b) b.click(); return Boolean(b); })()`);
    if (!clicked) throw new Error(`The strip has no ${choice} for ${AGENT}`);
    let dialog = null;
    for (let i = 0; i < 100; i += 1) {
      await sleep(100);
      if (!(await page.eval('Boolean(window.mavescape.store.ws.proposals)'))) return { dialog };
      const text = await page.eval(`document.querySelector('.dialog')?.textContent ?? ''`);
      if (text && !dialog) {
        dialog = text;
        await page.eval(`[...document.querySelectorAll('.dialog button')].find((b) => b.textContent === 'Reject')?.click()`);
      }
    }
    throw new Error(`${choice}: the proposal is still open`);
  }

  // --- GRB2: open, check, score, read ------------------------------------------------------
  const empty = await tool('get_state');
  const opened = await tool('open_example', { id: 'grb2-sh3' });
  const node = openExampleInNode(exampleById('grb2-sh3'));
  const state = await tool('get_state');
  const run1 = state.data.runs.find((r) => r.name === 'Run 1');
  check('open_example and get_state: GRB2\'s example opened and scored, Run 1 Node\'s output hash; opening a workspace is not a proposal', `${empty.message.slice(0, 60)} → ${opened.message.slice(0, 80)}…; Run 1 ${run1?.outputSha256.slice(0, 12)}…`, run1?.outputSha256 === outputDigest(node.scored.results) && !(await workspace()).proposals);
  await tool('check');
  const reproduced = await tool('reproduce_run', { run: 'Run 1' });
  const qc = await tool('qc_findings', { finding: 'variance' });
  const excess = qc.data.findings.find((f) => f.id === 'excess-variance');
  check('check, reproduce_run and qc_findings: the table valid, Run 1 reproduced, the variance beyond counting failing as Node finds it', `${reproduced.data.status}; ${excess?.status} (${excess?.value})`, reproduced.data.status === 'reproduced' && excess?.status === node.findings.find((f) => f.id === 'excess-variance').status);

  // --- What waits for the person, and what is made at once (wave 7, slice 2) ----------------
  const designNow = (await workspace()).design;
  const acked = await tool('acknowledge_finding', { finding: 'excess-variance', reason: 'The input bottleneck the Domainome\'s own analysis found' });
  const thresholds = await tool('set_qc_thresholds', { thresholds: { agreement: { review: 0.75 } } });
  const targetCheck = await tool('check_target', { apply: true });
  const details = await tool('set_mavedb_details', { details: { abstract: 'Abundance of every substitution in the SH3 domain of GRB2.' } });
  await tool('draft_design');
  const designed = await tool('set_design', { design: { ...designNow, name: 'GRB2 SH3, as the agent reads it' } });
  const held = await workspace();
  check('an agent\'s acknowledgement, QC thresholds, target check, MaveDB details and design wait for the person: the workspace unchanged, each tool saying so', [acked, thresholds, targetCheck, details, designed].map((r) => r.message.slice(0, 50)).join(' | '),
    [acked, thresholds, targetCheck, details, designed].every((r) => r.data.waiting || r.data.proposed) && !held.qc?.acknowledged && !held.qc?.thresholds && !held.targets[0].reference && !held.deposit?.abstract && held.design.name === designNow.name
    && held.history.filter((e) => e.action === 'propose').length >= 5 && held.history.filter((e) => e.action === 'propose').every((e) => e.by === AGENT));
  const enrich2 = await tool('score', { preset: 'enrich2' }, { progressToken: 'score' });
  const nodeEnrich2 = scoreTable(node.table, node.design, withDefaults(defaultParameters(node.design, node.ws.sources[0], 'enrich2')));
  const run2 = (await tool('get_state')).data.runs.find((r) => r.name === 'Run 2');
  check('score with the Enrich2-compatible preset: Run 2, Node\'s output hash, made at once and marked proposed, the result saying so', `${enrich2.message.slice(-120)}; ${run2?.outputSha256.slice(0, 12)}…`, run2?.outputSha256 === outputDigest(nodeEnrich2.results) && /Proposed to the person/.test(enrich2.message) && enrich2.data.proposal?.made.includes('Run 2 scored') && (await workspace()).runs[1].proposed?.by === AGENT);
  const variant = await tool('inspect_variant', { variant: 'p.Trp36Ala', run: 'Run 1' });
  const row = node.scored.results.variants.key.indexOf('p.Trp36Ala');
  const nodeScore = node.scored.results.conditions[0].score[row];
  const query = 'lower and position 30-40';
  const selected = await tool('select_variants', { query, run: 'Run 1', save_as: 'Core lower' });
  const model = buildMapModel(node.scored.results, node.design);
  const nodeKeys = selectByQuery(query, queryContext({ model, results: node.scored.results, design: node.design })).keys;
  check('inspect_variant and select_variants by query: p.Trp36Ala\'s score and the query\'s variants Node\'s', `${variant.data.score} (as the page rounds it) against ${nodeScore.toPrecision(6)}; ${selected.data.variants.length} variants against ${nodeKeys.length}`, Math.abs(variant.data.score - nodeScore) <= 5e-4 * Math.max(1, Math.abs(nodeScore)) && JSON.stringify(selected.data.variants) === JSON.stringify(nodeKeys));

  // --- Results as data and pictures (wave 7, slice 3) ----------------------------------------
  const table = await tool('scores', { run: 'Run 1', limit: 0 });
  const run1Export = join(out, 'run1-scores.csv');
  await tool('export', { what: 'scores', path: run1Export, run: 'Run 1' });
  const matched = tableMatchesCSV(table.data.variants, table.data.columns, readFileSync(run1Export, 'utf8'));
  const queried = await tool('scores', { run: 'Run 1', query, columns: ['hgvs_pro', 'score'], limit: 0 });
  const top = await tool('scores', { run: 'Run 1', kinds: ['missense'], sort: '-score', columns: ['hgvs_pro', 'score', 'variant_class'], limit: 5 });
  const highest = table.data.variants.filter((v) => v.variant_class === 'missense' && v.score !== null).map((v) => v.score).sort((a, b) => b - a).slice(0, 5);
  const provenance = await tool('provenance', { run: 'Run 1' });
  check('scores: Run 1\'s variants as a table holding every number of its scores export; a query\'s variants Node\'s; the highest missense scores first; provenance the run\'s, inline', `${table.data.total} rows, ${matched.numbers} numbers compared${matched.differ.length ? `: ${matched.differ.join('; ')}` : ''}; ${queried.data.total} by the query; the highest ${top.data.variants.map((v) => v.score).join(', ')}; ${provenance.message.slice(0, 70)}…`,
    matched.ok && matched.numbers > 10000 && table.data.total === 1121 && JSON.stringify(queried.data.variants.map((v) => v.hgvs_pro).sort()) === JSON.stringify([...nodeKeys].sort())
    && JSON.stringify(top.data.variants.map((v) => v.score)) === JSON.stringify(highest) && top.data.variants.every((v) => v.variant_class === 'missense') && top.data.total > 1000
    && provenance.data.format === 'mavescape-provenance' && provenance.data.run.output.sha256 === run1.outputSha256);
  const picture = await tool('render_map', { run: 'Run 1', color_by: 'score', rows: 'biochemical', palette: 'rdbu', image: true });
  const nodeModel = buildMapModel(node.scored.results, node.design, { condition: 0, rowOrder: 'biochemical', colorBy: 'score' });
  const fullSVG = mapSVG(nodeModel, { palette: 'rdbu', results: node.scored.results });
  const [whole] = imagesOf(picture);
  const full = whole ? cellsAgree(fullSVG, whole, 2) : { n: 0, wrong: [] };
  const stretch = await tool('render_map', { run: 'Run 1', image: true, from: 30, to: 45, scale: 3 });
  const stretchSVG = mapSVG(nodeModel, { palette: 'rdbu', results: node.scored.results, from: 30, to: 45 });
  const [part] = imagesOf(stretch);
  const partCells = part ? cellsAgree(stretchSVG, part, 3) : { n: 0, wrong: [] };
  check('render_map with image: the map as a picture after the text, captioned, the data naming it by its number; decoded, its size the SVG export\'s at the scale asked, and every cell the color map-svg.js gives it (the whole map at 2×, positions 30–45 at 3×)', `${picture.result.content.map((c) => c.type).join(', ')}; ${whole?.width} × ${whole?.height}, ${full.n} cells, ${full.wrong.length} otherwise; positions 30–45 ${part?.width} × ${part?.height}, ${partCells.n} cells, ${partCells.wrong.length} otherwise${[...full.wrong, ...partCells.wrong].slice(0, 3).map((x) => `; ${x}`).join('')}`,
    picture.data.image === 1 && picture.data.tracks.length === 0 && /^Image 1: The variant-effect map of Run 1/.test(picture.result.content[1]?.text ?? '') && imagesOf(picture).length === 1
    && whole.width === svgWidth(fullSVG) * 2 && whole.width === picture.data.width && whole.height === picture.data.height && full.n > 1000 && !full.wrong.length
    && part.width === svgWidth(stretchSVG) * 3 && partCells.n > 300 && !partCells.wrong.length);

  const map = await tool('render_map', { run: 'Run 1' });
  const compared = await tool('compare', { a: 'Run 1', b: 'Run 2' });
  // The same comparison asked of remote control: the agent gets the action's own result.
  const byScript = await (await fetch(`${URL}api/remote/action`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'compare', args: { a: 'Run 1', b: 'Run 2' }, client: 'agent-session (as a script)' }) })).json();
  check('render_map and compare: the map in words, every cell counted; the comparison\'s statistics the remote action\'s, field for field', `${Object.values(map.data.counts).reduce((a, b) => a + b, 0)} cells; r ${compared.data.statistics?.pearson?.r}`, Object.values(map.data.counts).reduce((a, b) => a + b, 0) === 56 * 21 && JSON.stringify(compared.data) === JSON.stringify(byScript.data) && compared.message === byScript.message);
  // While a long action runs, the strip above the view says the agent is working.
  const robustCall = tool('check_robustness', { run: 'Run 1', max: 12 }, { progressToken: 'robustness' });
  let working = '';
  for (let i = 0; i < 200 && !working; i += 1) {
    working = await page.eval(`document.querySelector('.agent-working')?.textContent ?? ''`);
    if (!working) await sleep(25);
  }
  const robust = await robustCall;
  const progress = notifications.filter((n) => n.method === 'notifications/progress');
  check('check_robustness, a long call with a progress token: answered, any progress sent before its answer under its token; the strip saying the agent is working while it runs, and not after', `${robust.message.slice(0, 80)}…; ${progress.length} progress notification(s); "${working}"`, Boolean(robust.data) && progress.every((n) => ['score', 'robustness'].includes(n.params.progressToken)) && /Agent session is working: check robustness/.test(working) && !(await page.eval(`document.querySelector('.agent-working')?.textContent ?? ''`)));

  // In the window: the strip, the marks, the views; nothing certified meanwhile.
  const yours = (await tool('proposals')).data.yours;
  const stripText = await strip();
  await page.eval(`[...document.querySelectorAll('.proposal-strip button')].find((b) => b.textContent === 'Review')?.click()`);
  await sleep(100);
  const listedItems = JSON.parse(await page.eval(`JSON.stringify([...document.querySelectorAll('.proposal-strip li')].map((li) => li.textContent))`));
  const marks = await page.eval(`document.querySelectorAll('#sidebar .dataset-row .badge').length`);
  await tool('set_mode', { mode: 'experiment' });
  const designPane = await page.eval(`document.querySelector('.proposed-design')?.textContent ?? ''`);
  await tool('set_mode', { mode: 'qc' });
  let qcNote = '';
  for (let i = 0; i < 300 && !qcNote; i += 1) {
    qcNote = await page.eval(`[...document.querySelectorAll('.callout')].map((c) => c.textContent).find((t) => /Proposed by/.test(t)) ?? ''`);
    if (!qcNote) await sleep(100);
  }
  const refused = await call('certify', { path: join(out, 'refused.certificate.msz') });
  check('the strip: who proposes how many changes, made and waiting, listed for review; the sidebar\'s marks, the proposed design beside the person\'s, the QC view\'s note; certify refused while a proposal is open', `${stripText.slice(0, 90)}; ${listedItems.length} items; ${marks} marks; ${refused.text.slice(0, 80)}`,
    yours.made.length === 2 && yours.waiting.length === 5 && /Agent session proposes 7 changes \(2 made, 5 waiting for you\)/.test(stripText) && listedItems.length === 7 && marks >= 3
    && /proposes a design/.test(designPane) && /GRB2 SH3, as the agent reads it/.test(designPane) && /QC thresholds set by Agent session/.test(qcNote) && /Acknowledged/.test(qcNote)
    && refused.isError && /proposal open/.test(refused.text) && !existsSync(join(out, 'refused.certificate.msz')));
  await tool('checkpoint', { name: 'Proposed' });
  const accepted = await decide('Accept all');
  const after = await workspace();
  const chain = verifyHistory(after);
  const decision = after.history.at(-1);
  const proposalsNow = await tool('proposals');
  const since = await tool('diff', { from: 'Proposed' });
  check('accepted in the window: what waited applied (the acknowledgement, thresholds, target check, MaveDB details, design), in the history under the agent\'s name; what was made stamped accepted; the decision the person\'s; the chain intact; proposals and the diff from a checkpoint saying so', `${decision.detail.slice(0, 90)}…; ${since.data.changes.map((c) => c.text).filter((t) => /proposed by/.test(t)).join(' ')}`,
    !accepted.dialog && after.qc.acknowledged?.['excess-variance'] && after.qc.thresholds?.agreement?.review === 0.75 && after.targets[0].reference && after.deposit?.abstract && after.design.name === 'GRB2 SH3, as the agent reads it'
    && after.runs[1].proposed?.accepted && after.selections[0].proposed?.accepted && !after.proposals && decision.action === 'proposal' && !decision.by && /^Accepted the proposal of Agent session: /.test(decision.detail)
    && ['design', 'qc', 'target', 'deposit'].every((a) => after.history.some((e) => e.action === a && e.by === AGENT)) && chain.ok
    && proposalsNow.data.yours === null && proposalsNow.data.decisions[0]?.decision === 'accepted' && since.data.changes.some((c) => c.text === 'Run 2, proposed by Agent session, was accepted.'));

  await tool('mavedb_deposit', {});
  await tool('focus', { kind: 'run', name: 'Run 2' });

  // --- Rejected, with what the person built on it since -----------------------------------
  await tool('score', { parameters: { pseudocount: 1 } });
  await tool('create_figure', { name: 'Agent figure', size: 'single' });
  await tool('add_figure_panel', { figure: 'Agent figure', run: 'Run 3' });
  await person('create_figure', { name: 'Figure 1', size: 'double' });
  await person('add_figure_panel', { figure: 'Figure 1', run: 'Run 1' });
  await person('add_figure_panel', { figure: 'Figure 1', run: 'Run 3' });
  const beforeReject = await workspace();
  const rejected = await decide('Reject all');
  const afterReject = await workspace();
  const figure1 = afterReject.figures.find((f) => f.name === 'Figure 1');
  check('rejected in the window: Run 3 and the figure the agent made removed, and the panel of Run 3 the person put in Figure 1 since (MaveScape asked first); one history entry, the person\'s; the chain intact', `${afterReject.history.at(-1).detail.slice(0, 160)}…`,
    /Figure 1/.test(rejected.dialog ?? '') && !afterReject.runs.some((r) => r.name === 'Run 3') && !afterReject.figures.some((f) => f.name === 'Agent figure') && figure1?.panels.length === 1 && figure1.panels[0].run === run1.id
    && afterReject.history.length === beforeReject.history.length + 1 && /^Rejected the proposal of Agent session: Run 3 scored; the figure "Agent figure" made; with it, what was built on it since: the figure "Figure 1"/.test(afterReject.history.at(-1).detail) && !afterReject.history.at(-1).by && verifyHistory(afterReject).ok);

  // --- Structures; removals of the person's, held ------------------------------------------
  await tool('find_structures', {});
  await tool('open_structure', { pdb: '2VWF' });
  await tool('map_structure', {});
  await tool('set_structure', { color: 'median' });
  await tool('structure_evidence', {});
  const shot = await tool('render_structure', {});
  const [view] = imagesOf(shot);
  const shades = view ? new Set(Array.from({ length: view.width * view.height }, (_, i) => (view.rgba[i * 4] << 16) | (view.rgba[i * 4 + 1] << 8) | view.rgba[i * 4 + 2])).size : 0;
  check('render_structure: the Structure view as a picture with its legend (the median score), decoded at the size the data says', `${view?.width} × ${view?.height}, ${shades} colors; ${shot.message.slice(0, 90)}…`, view && view.width === shot.data.width && view.height === shot.data.height && shades > 100 && /^Median score/.test(shot.data.legend?.title ?? '') && shot.data.image === 1);
  await tool('save_structure_view', { name: 'Core' });
  await tool('open_structure_view', { name: 'Core' });
  const handoff = await call('proteoscope_link');
  check('proteoscope_link with Proteoscope looked for nowhere (--proteoscope off): refused, saying why', handoff.text.slice(0, 120), handoff.isError && /Proteoscope/.test(handoff.text));
  await person('save_structure_view', { name: 'Interface' });
  const notTheirs = await call('save_structure_view', { name: 'Interface' });
  const track = await person('add_track', { provider: 'uniprot-features', run: 'Run 1' });
  await person('checkpoint', { name: 'Mine' });
  await person('compare', { a: 'Run 1', b: 'Run 2', report: true });
  await person('create_figure', { name: 'Draft', size: 'single' });
  await tool('list_tracks', { run: 'Run 1' });
  await tool('set_track', { track: 'Coverage', shown: true });
  await tool('add_figure_panel', { figure: 'Figure 1', kind: 'structure', view: 'Core' });
  await tool('set_figure', { figure: 'Figure 1', panels: [{ panel: 'A', remove: true }] });
  const removals = [
    await tool('remove_track', { annotation: track.data.annotation }),
    await tool('remove_structure_view', { name: 'Interface' }),
    await tool('checkpoint', { remove: 'Mine' }),
    await tool('report', { remove: 'the comparison of Run 1 and Run 2', show: false }),
    await tool('set_figure', { figure: 'Draft', delete: true }),
  ];
  await tool('checkpoint', { name: 'Scratch' });
  await tool('checkpoint', { remove: 'Scratch' });
  const waitingRemovals = await workspace();
  await tool('set_mode', { mode: 'figures' });
  await tool('figures', { figure: 'Figure 1' });
  const boxes = await page.eval(`JSON.stringify([document.querySelectorAll('.figure-box.removal-box').length, document.querySelectorAll('.figure-box.proposed-box').length])`);
  const struck = await page.eval(`[...document.querySelectorAll('#sidebar .dataset-row.held-removal')].map((r) => r.textContent).join(', ')`);
  check('removals of the person\'s wait for the person (a track, a saved view, a checkpoint, an analysis kept in the report, a figure, a panel of their figure), struck out in the views; a panel the agent adds to their figure is made at once, outlined; the agent removes its own checkpoint at once, and never saves over the person\'s view', `${removals.map((r) => r.message.slice(0, 40)).join(' | ')}; boxes ${boxes}; struck: ${struck}; ${notTheirs.text.slice(0, 60)}`,
    removals.every((r) => /^Proposed (removing|deleting|taking)|Proposed taking/.test(r.message)) && waitingRemovals.annotations?.length === 1 && waitingRemovals.structureViews.some((v) => v.name === 'Interface') && waitingRemovals.checkpoints.some((c) => c.name === 'Mine') && !waitingRemovals.checkpoints.some((c) => c.name === 'Scratch')
    && waitingRemovals.analyses?.length === 1 && waitingRemovals.figures.some((f) => f.name === 'Draft') && waitingRemovals.figures.find((f) => f.name === 'Figure 1').panels.length === 2 && boxes === '[1,1]' && /Interface/.test(struck)
    && notTheirs.isError && /The person has a view "Interface"/.test(notTheirs.text));
  await decide('Accept all');
  const removed = await workspace();
  const fig1 = removed.figures.find((f) => f.name === 'Figure 1');
  check('accepted: each removal made, as the person\'s would be; the panel the agent added kept', removed.history.at(-1).detail.slice(0, 120),
    !removed.annotations?.length && !removed.structureViews.some((v) => v.name === 'Interface') && removed.structureViews.find((v) => v.name === 'Core')?.proposed?.accepted && !removed.checkpoints.some((c) => c.name === 'Mine') && !removed.analyses?.length && !removed.figures.some((f) => f.name === 'Draft')
    && fig1.panels.length === 1 && fig1.panels[0].kind === 'structure' && verifyHistory(removed).ok);

  // --- Figures, the record -----------------------------------------------------------------
  const added = await tool('add_track', { provider: 'uniprot-features', run: 'Run 1' });
  check('add_track: the annotation the agent adds beside the map is made at once, marked proposed', added.message.slice(-90), (await workspace()).annotations?.[0]?.proposed?.by === AGENT && added.data.proposal?.made.some((t) => /added beside the map/.test(t)));
  await tool('create_figure', { name: 'Figure 2', size: 'double' });
  await tool('add_figure_panel', { figure: 'Figure 2', run: 'Run 1', tracks: ['reference', 'effect'], height_mm: 90 });
  await tool('add_figure_panel', { figure: 'Figure 2', kind: 'structure', view: 'Core' });
  await tool('set_figure', { figure: 'Figure 2', name: 'GRB2' });
  await tool('figures', { figure: 'GRB2' });
  const pages = await tool('figures', { figure: 'GRB2', image: true, dpi: 100 });
  const [sheet] = imagesOf(pages);
  const pageSize = pngSize(pages.data.figures[0].document, 100);
  const inside = readFigureManifest(new Uint8Array(Buffer.from(pages.result.content.find((c) => c.type === 'image').data, 'base64')));
  check('figures with image: the page as export_figure writes it, a PNG at the dpi asked, its manifest inside', `${sheet?.width} × ${sheet?.height} (${pageSize.width} × ${pageSize.height} at 100 dpi); manifest ${inside?.figure?.name}, ${inside?.panels?.length} panels`, sheet?.width === pageSize.width && sheet.height === pageSize.height && inside?.figure?.name === 'GRB2' && inside.panels.length === 2 && pages.data.figures[0].image === 1);
  const figurePath = join(out, 'grb2.svg');
  await tool('export_figure', { figure: 'GRB2', path: figurePath });
  const manifest = readFigureManifest(readFileSync(figurePath, 'utf8'));
  const checkedFigure = await tool('check_figure', { paths: [figurePath] });
  await tool('checkpoint', { name: 'Before the record' });
  const diff = await tool('diff');
  const report = await tool('report');
  const certPath = join(out, 'grb2.certificate.msz');
  const notYet = await call('certify', { path: certPath });
  await decide('Accept all');
  await tool('certify', { path: certPath });
  const verified = await tool('verify_certificate', { paths: [certPath] });
  const inNode = await verifyCertificate(await readCertificate(new Uint8Array(readFileSync(certPath))), { software: { version: init.result.serverInfo.version, commit: '' } });
  await tool('review_report', { path: join(out, 'grb2.review.html') });
  const scoresPath = join(out, 'scores.csv');
  await tool('export', { what: 'scores', path: scoresPath, run: 'Run 1' });
  const replace = await call('export', { what: 'scores', path: scoresPath, run: 'Run 1' });
  check('the record through the agent: a figure exported while proposed (exports are not proposals) with its manifest, and checked; a checkpoint and what changed since; the report\'s AI agents section; certified once the person accepted, verified in the window and in Node; files written to the paths given, an existing one not replaced', `manifest ${manifest?.panels.length} panels, ${checkedFigure.data.panels?.map((p) => p.status).join(', ')}; ${diff.data.summary}; ${notYet.text.slice(0, 60)}; window ${verified.data.verdict}, Node ${inNode.verdict}; ${replace.text.slice(0, 60)}`,
    manifest?.panels.length === 2 && diff.data.same && /## AI agents/.test(report.data.markdown) && /Accepted the proposal of Agent session/.test(report.data.markdown) && notYet.isError && /proposal open/.test(notYet.text)
    && verified.data.verdict === 'verified' && inNode.verdict === 'verified' && existsSync(join(out, 'grb2.review.html')) && readFileSync(scoresPath, 'utf8').split('\n').length > 1000 && replace.isError && /exists/.test(replace.text));

  // Every change the agent made carries its name in the workspace's history; the others are the
  // person's decisions and the person's own changes.
  const history = JSON.parse(await page.eval('JSON.stringify(window.mavescape.store.ws.history)'));
  const others = history.filter((e) => e.by !== AGENT);
  check('every change the agent made carries its name in the workspace\'s history (by), in each entry\'s hash; the entries without it are the person\'s decisions and the person\'s own changes', `${history.length - others.length} of ${history.length} entries by "${AGENT}"; ${others.length} the person's (${[...new Set(others.map((e) => e.action))].join(', ')})`,
    history.length > 20 && others.every((e) => !e.by && (e.action === 'proposal' || personEntries.has(e.hash))) && others.filter((e) => e.action === 'proposal').length === 4 && verifyHistory({ history }).ok);

  // --- Opening data by path and from MaveDB; a design proposed before scoring ---------------
  const archive = join(out, 'grb2.msz');
  await tool('export', { what: 'archive', path: archive });
  const reopened = await tool('open_files', { paths: [archive] });
  const found = await tool('search_mavedb', { text: 'grb2' });
  const fromMaveDB = await tool('open_mavedb', { urn: 'urn:mavedb:00000835-a-1' });
  const blank = await tool('new_workspace', { name: 'Blank' });
  check('open_files of the archive the agent wrote, search_mavedb and open_mavedb from the cache, new_workspace: workspaces opened, not proposals', `${reopened.message.slice(0, 60)}…; ${found.data.total} found; ${fromMaveDB.message.slice(0, 60)}…; ${blank.message.slice(0, 40)}`, found.data.hits?.[0]?.urn === 'urn:mavedb:00000835-a-1' && /urn:mavedb:00000835-a-1/.test(fromMaveDB.message) && !(await workspace()).proposals);
  const files = await tool('open_files', { paths: [join(ROOT, 'web/examples/grb2-sh3/counts.csv'), join(ROOT, 'web/examples/grb2-sh3/target.fasta')] });
  const drafted = await tool('draft_design');
  const tooSoon = await call('score');
  await decide('Accept all');
  const scored = await tool('score');
  const blankNow = await workspace();
  check('tables and a target opened into the agent\'s workspace are proposed; its draft design waits, and so does scoring with it, until the person accepts it', `${files.data.proposal?.made.join('; ')}; ${drafted.message.slice(0, 50)}…; ${tooSoon.text.slice(0, 70)}; ${scored.message.slice(0, 40)}`,
    files.data.proposal?.made.length === 2 && drafted.data.waiting && tooSoon.isError && /waits for the person to accept it/.test(tooSoon.text) && blankNow.design && blankNow.sources[0].proposed?.accepted && blankNow.runs[0]?.proposed?.proposal);

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
