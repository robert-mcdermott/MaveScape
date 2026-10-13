// Writes workspace archives and a certificate with MaveScape 0.7.0 itself (run from a v0.7.0
// checkout), so that later versions must reopen them, reproduce their runs, keep what an AI agent
// did and what the person decided, and verify the certificate (roadmap, "In every wave"). 0.7
// brought AI agents: `mavescape mcp`, an agent's changes as proposals the person accepts or
// rejects, every change in the history under the agent's name. The program is built from the
// checkout and started as an agent's client starts it (`mavescape mcp`), its window a headless
// browser with a fixed clock; it is driven over MCP as an agent ("make-0.7.0") and through remote
// control as the person, who also decides in the strip above the view, offline, on the public data
// the validation keeps (the fetcher's cached answers, validation/fixtures/public-data):
//   - release-0.7.0-grb2-agent.msz: GRB2's SH3 domain, opened by the person. The agent's first
//     proposal, accepted: Run 2 with the DiMSum-compatible preset, a selection and AlphaMissense
//     beside the map (made at once), the variance beyond counting acknowledged, a QC threshold and
//     the target checked against UniProt (waiting). Its second, rejected: Run 3 with a pseudocount
//     of 1 and a figure of it (made), and the removal of the person's UniProt features (waiting).
//     Then the person's comparison of Run 1 and Run 2 kept in the report, and a checkpoint;
//   - release-0.7.0-grb2-agent.certificate.msz: that workspace certified (its tables in it);
//   - release-0.7.0-hsp90-proposal.msz: the guide's session on Hsp90 to its open proposal (the
//     website's Agents and scripts): opened by the agent, compared with the record's published
//     scores (their score set kept beside the map), a checkpoint, and a design fitting the first
//     three samples waiting for the person. Saved with the proposal open.
// Each archive is then reopened in Node: its history's chain unbroken, the agent's entries under
// its name, each run recomputed from its own files to its recorded output hash, each checkpoint's
// state its own SHA-256, every number it reports computed again; the open proposal as kept; and the
// certificate verified.
//
// Usage: node make-0.7.0.mjs <v0.7.0 checkout> <out folder> [commit]
// Without a commit, the program records the one it was built from, as Go stamps it ("-dirty" when
// the checkout had changes not yet committed: 0.7.0's are saved before its release commit, as
// 0.6.0's were). Needs Go and Chrome, Chromium, Edge or Brave (CHROME=path).
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [rootArg, outArg, commit = ''] = process.argv.slice(2);
if (!rootArg || !outArg) throw new Error('Usage: node make-0.7.0.mjs <v0.7.0 checkout> <out folder> [commit]');
const root = resolve(rootArg);
const outDir = resolve(outArg);
const lib = (p) => import(pathToFileURL(join(root, p)).href);
const { launch, sleep } = await lib('docs/capture/cdp.mjs');
const { readArchive } = await lib('web/lib/archive.js');
const { outputDigest, reproduction } = await lib('web/lib/runs.js');
const { stateDigest } = await lib('web/lib/diff.js');
const { verifyHistory } = await lib('web/lib/workspace.js');
const { computeNumbers, readCertificate, verifyCertificate } = await lib('web/lib/certificate.js');
const { recompute } = await lib('validation/roundtrip-cases.mjs');

const CLOCK = '2026-10-13T04:00:00.000Z';
const PORT = 8851;
const AGENT = 'make-0.7.0';
mkdirSync(outDir, { recursive: true });
const temp = mkdtempSync(join(tmpdir(), 'mavescape-release-'));
const library = join(temp, 'library');
const cache = join(temp, 'cache');

// The fetcher's cache: its answers as the validation keeps them (UniProt's entry and features and
// AlphaMissense for GRB2, Hsp90's published scores among them).
cpSync(join(root, 'validation/fixtures/public-data'), cache, { recursive: true });

// MaveScape 0.7.0, built from the checkout and started as an agent's client starts it, offline on
// that cache, not looking for Proteoscope; its banner on stderr, the protocol on stdin and stdout.
const binary = join(temp, process.platform === 'win32' ? 'mavescape.exe' : 'mavescape');
await new Promise((done, fail) => spawn('go', ['build', ...(commit ? ['-ldflags', `-X main.commit=${commit}`] : []), '-o', binary, '.'], { cwd: root, stdio: 'inherit' }).on('exit', (code) => (code ? fail(new Error('go build failed')) : done())));
const server = spawn(binary, ['mcp', '--window', 'none', '--port', String(PORT), '--data-dir', library, '--offline', '--cache-dir', cache, '--proteoscope', 'off'], { cwd: temp, stdio: ['pipe', 'pipe', 'pipe'] });
let banner = '';
server.stderr.on('data', (chunk) => { banner += chunk; });

// One JSON-RPC message per line on stdout.
const pending = new Map();
let buffered = '';
let next = 1;
server.stdout.on('data', (chunk) => {
  buffered += chunk;
  for (let at = buffered.indexOf('\n'); at >= 0; at = buffered.indexOf('\n')) {
    const line = buffered.slice(0, at);
    buffered = buffered.slice(at + 1);
    try {
      const message = JSON.parse(line);
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    } catch { /* not a reply */ }
  }
});
const rpc = (method, params) => {
  const id = next++;
  server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) })}\n`);
  return new Promise((done) => pending.set(id, done));
};

let URL = '';
for (let i = 0; i < 300 && !URL; i += 1) {
  const address = /running at (http:\/\/[\d.]+:\d+)/.exec(banner)?.[1];
  if (address && existsSync(join(library, 'remote.json'))) URL = `${address}/`;
  else await sleep(200);
}
if (!URL) throw new Error(`MaveScape did not start:\n${banner}`);
const token = JSON.parse(readFileSync(join(library, 'remote.json'), 'utf8')).token;
await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: AGENT, title: AGENT, version: '1' } });
server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);

// The agent's tool calls, and the person's actions through remote control.
async function agent(name, args = {}) {
  const reply = await rpc('tools/call', { name, arguments: args });
  const result = reply.result;
  if (reply.error || result?.isError) throw new Error(`The agent's ${name} ${JSON.stringify(args).slice(0, 160)}: ${reply.error?.message ?? result.content?.[0]?.text}`);
  console.log(`  agent ${name}: ${String(result.structuredContent?.message ?? '').slice(0, 150)}`);
  return result.structuredContent;
}
async function act(action, args = {}) {
  const response = await fetch(`${URL}api/remote/action`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-MaveScape-Token': token }, body: JSON.stringify({ action, args, client: 'The person' }) });
  const result = await response.json();
  if (!result.ok) throw new Error(`${action} ${JSON.stringify(args).slice(0, 200)}: ${result.message ?? result.error}`);
  console.log(`  person ${action}: ${String(result.message).slice(0, 150)}`);
  return result;
}

const browser = await launch({ width: 1440, height: 900, scale: 1 });
const errors = [];
browser.on('Runtime.exceptionThrown', (e) => errors.push(e.exceptionDetails?.exception?.description ?? e.exceptionDetails?.text));
// The person clicks Accept all or Reject all in the strip above the view (and Reject in the dialog
// asking whether to remove what was built on the proposal).
async function decide(choice) {
  const clicked = await browser.eval(`(() => { const s = document.querySelector('.proposal-strip[aria-label="The proposal of ${AGENT}"]'); const b = s && [...s.querySelectorAll('button')].find((x) => x.textContent === '${choice}'); if (b) b.click(); return Boolean(b); })()`);
  if (!clicked) throw new Error(`The strip has no ${choice} for ${AGENT}`);
  for (let i = 0; i < 100; i += 1) {
    await sleep(100);
    if (!(await browser.eval('Boolean(window.mavescape.store.ws.proposals)'))) {
      console.log(`  person: ${choice}`);
      return;
    }
    await browser.eval(`[...document.querySelectorAll('.dialog button')].find((b) => b.textContent === 'Reject')?.click()`);
  }
  throw new Error(`${choice}: the proposal is still open`);
}

const written = [];
let certificate = null;
try {
  await browser.goto(`${URL}?clock=${CLOCK}`, 1500);
  for (let i = 0; i < 100 && !(await browser.eval('Boolean(window.mavescape?.remote)')); i += 1) await sleep(100);
  await sleep(500);
  const save = async (file) => {
    const path = join(outDir, file);
    await act('export', { what: 'archive', path, overwrite: true });
    written.push(path);
  };

  console.log('GRB2 SH3: two proposals of an agent, one accepted and one rejected');
  await act('open_example', { id: 'grb2-sh3' });
  const features = (await act('add_track', { provider: 'uniprot-features' })).data.annotation;
  await agent('score', { preset: 'dimsum' });
  await agent('select_variants', { query: 'lower and position 30-40', run: 'Run 1', save_as: 'Core lower' });
  await agent('add_track', { provider: 'alphamissense' });
  await agent('acknowledge_finding', { finding: 'excess-variance', run: 'Run 1', reason: 'The input bottleneck the Domainome\'s own analysis found (DiMSum\'s error model, Run 2, puts it at the input)' });
  await agent('set_qc_thresholds', { thresholds: { agreement: { review: 0.85, fail: 0.5 } } });
  await agent('check_target', { apply: true });
  await decide('Accept all');
  await agent('score', { parameters: { pseudocount: 1 } });
  await agent('create_figure', { name: 'Pseudocount 1', size: 'single' });
  await agent('add_figure_panel', { figure: 'Pseudocount 1', run: 'Run 3' });
  await agent('remove_track', { annotation: features });
  await decide('Reject all');
  await act('compare', { a: 'Run 1', b: 'Run 2', report: true });
  await act('checkpoint', { name: 'Decided' });
  await save('release-0.7.0-grb2-agent.msz');
  const certPath = join(outDir, 'release-0.7.0-grb2-agent.certificate.msz');
  await act('certify', { path: certPath, overwrite: true });
  certificate = certPath;

  console.log('Hsp90: the guide\'s session, to its open proposal');
  await agent('open_example', { id: 'hsp90' });
  await agent('qc_findings', { run: 'Run 1' });
  await agent('compare', { a: 'Run 1', b: 'urn:mavedb:00000011-a-1', scale: 'stated', direction: 'higher-more' });
  await agent('checkpoint', { name: 'All eight samples' });
  const design = structuredClone((await agent('provenance', { run: 'Run 1' })).data.inputs.design);
  const later = design.samples.slice(3);
  design.samples = design.samples.slice(0, 3);
  design.replicates[0].timepoints = design.replicates[0].timepoints.slice(0, 3);
  design.ignoredColumns = later.flatMap((x) => x.columns).map((column) => ({ column, reason: 'later time points: the authors fit their null-like variants on the first three' }));
  await agent('set_design', { design });
  await save('release-0.7.0-hsp90-proposal.msz');
  if (errors.length) throw new Error(`The page threw: ${errors[0]}`);
} finally {
  await browser.close();
  server.stdin.end();
  server.kill();
  await sleep(500);
  rmSync(temp, { recursive: true, force: true });
}

// Each archive reopened in Node: the history's chain, the agent's entries, each run recomputed from
// the archive's files, each checkpoint's state its own SHA-256, every number computed again, and an
// open proposal as kept.
let failed = 0;
for (const path of written) {
  const opened = await readArchive(new Uint8Array(readFileSync(path)));
  const chain = verifyHistory(opened.ws);
  if (!chain.ok) failed += 1;
  const lines = [];
  for (const [index, run] of opened.ws.runs.entries()) {
    const { scored } = recompute(opened.ws, opened.sources, index);
    const verdict = scored.ok ? reproduction(run, outputDigest(scored.results), '0.7.0') : { status: scored.errors[0] };
    if (verdict.status !== 'reproduced') failed += 1;
    lines.push(`${run.name} ${run.output.sha256.slice(0, 12)} ${verdict.status}${run.proposed ? ` (proposed by ${run.proposed.by}${run.proposed.accepted ? ', accepted' : ''})` : ''}`);
  }
  const checkpoints = (opened.ws.checkpoints ?? []).map((c) => `${c.name} ${stateDigest(c.state) === c.sha256 ? 'as kept' : 'changed'}`);
  failed += checkpoints.filter((c) => c.endsWith('changed')).length;
  const computed = await computeNumbers(opened.ws, async (sha) => opened.sources.get(sha) ?? null, { software: { version: '0.7.0', commit: '' } });
  failed += computed.notes.length + computed.blocked.size;
  const byAgent = opened.ws.history.filter((e) => e.by === AGENT).length;
  const open = opened.ws.proposals ?? [];
  console.log(`${path}: ${readFileSync(path).length} bytes; ${opened.problems.length ? opened.problems.join(' ') : 'no problems'}; history ${chain.ok ? 'unbroken' : 'BROKEN'}, ${opened.ws.history.length} entries, ${byAgent} by ${AGENT}; ${lines.join(', ')}; checkpoints ${checkpoints.join(', ') || 'none'}; ${(opened.ws.analyses ?? []).length} analyses kept; proposals open: ${open.map((p) => `${p.author}'s, ${p.changes.length} changes`).join(', ') || 'none'}; ${computed.notes.length} notes, ${computed.blocked.size} not computed`);
}
const read = await readCertificate(new Uint8Array(readFileSync(certificate)));
const verified = await verifyCertificate(read, { software: { version: '0.7.0', commit: read.certificate.software?.commit ?? '' } });
if (verified.verdict !== 'verified') failed += 1;
console.log(`${certificate}: ${readFileSync(certificate).length} bytes; ${verified.summary}`);
if (failed) throw new Error(`${failed} histories broken, runs not reproduced, checkpoints changed, numbers not computed or the certificate not verified`);
