// Writes workspace archives and a certificate with MaveScape 0.8.0 itself (run from a v0.8.0
// checkout), so that later versions must reopen them, reproduce their runs, keep their control sets
// and calibrations and compute every calibration again to the same numbers, keep an AI agent's
// proposal open as it was, and verify the certificate (roadmap, "In every wave"). 0.8 brought
// calibration, for research: control sets of variants of known effect (from ClinVar's records of
// the gene or a table of labels, only those last evaluated before a year when asked) and
// calibrations of a run's scores against them (the curves and their bootstrap, thresholds and
// classes, each class's OddsPath, score-level likelihood ratios), in the report, figures, the
// certificate (format 2) and the checkpoint diff. The program is built from the checkout and
// started as an agent's client starts it (`mavescape mcp`), its window a headless browser with a
// fixed clock; it is driven through remote control as the person and over MCP as an agent
// ("make-0.8.0"), offline, on the public data the validation keeps (the fetcher's cached answers,
// validation/fixtures/public-data: factor IX's ClinVar records among them):
//   - release-0.8.0-factor9-calibration.msz: factor IX, opened by the person. ClinVar's records of
//     F9 beside the map; two control sets from them (at least one star, missense; and those last
//     evaluated before 2025, when the assay was published); Run 1 calibrated against each by the
//     defaults, and against the first with given thresholds and Pejaver et al.'s likelihood
//     thresholds; a figure of the first calibration's four plots; and a checkpoint;
//   - release-0.8.0-factor9-calibration.certificate.msz: that workspace certified (format 2: its
//     calibrations' numbers among them);
//   - release-0.8.0-simulated-labels.msz: the simulated calibration example: its labels made a
//     control set and calibrated by the person; then the agent's control set of those last
//     evaluated before 2024 and its calibration with Pejaver et al.'s thresholds, made at once and
//     marked proposed, saved with the proposal open.
// Each archive is then reopened in Node: its history's chain unbroken, each run recomputed from its
// own files to its recorded output hash, each ClinVar set read again from the annotation's own file
// the same labels, each calibration computed again with the thresholds it keeps, each checkpoint's
// state its own SHA-256, every number it reports computed again; the open proposal as kept; and the
// certificate verified.
//
// Usage: node make-0.8.0.mjs <v0.8.0 checkout> <out folder> [commit]
// Without a commit, the program records the one it was built from, as Go stamps it ("-dirty" when
// the checkout had changes not yet committed: 0.8.0's are saved before its release commit, as
// 0.7.0's were). Needs Go and Chrome, Chromium, Edge or Brave (CHROME=path).
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [rootArg, outArg, commit = ''] = process.argv.slice(2);
if (!rootArg || !outArg) throw new Error('Usage: node make-0.8.0.mjs <v0.8.0 checkout> <out folder> [commit]');
const root = resolve(rootArg);
const outDir = resolve(outArg);
const lib = (p) => import(pathToFileURL(join(root, p)).href);
const { launch, sleep } = await lib('docs/capture/cdp.mjs');
const { readArchive } = await lib('web/lib/archive.js');
const { outputDigest, reproduction } = await lib('web/lib/runs.js');
const { stateDigest } = await lib('web/lib/diff.js');
const { verifyHistory } = await lib('web/lib/workspace.js');
const { computeNumbers, readCertificate, verifyCertificate } = await lib('web/lib/certificate.js');
const { computeCalibration, thresholdsDiffer } = await lib('web/lib/calibration-record.js');
const { clinvarControls } = await lib('web/lib/controls.js');
const { trackTarget } = await lib('web/lib/tracks.js');
const { recompute } = await lib('validation/roundtrip-cases.mjs');

const CLOCK = '2026-10-13T20:00:00.000Z';
const PORT = 8852;
const AGENT = 'make-0.8.0';
mkdirSync(outDir, { recursive: true });
const temp = mkdtempSync(join(tmpdir(), 'mavescape-release-'));
const library = join(temp, 'library');
const cache = join(temp, 'cache');

// The fetcher's cache: its answers as the validation keeps them (factor IX's UniProt entry and
// ClinVar records among them).
cpSync(join(root, 'validation/fixtures/public-data'), cache, { recursive: true });

// MaveScape 0.8.0, built from the checkout and started as an agent's client starts it, offline on
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

  console.log('Factor IX: two control sets from ClinVar, three calibrations, a figure and a checkpoint');
  await act('open_example', { id: 'factor9' });
  await act('add_track', { provider: 'clinvar' });
  await act('make_control_set', {});
  await act('make_control_set', { evaluated_before: 2025 });
  await act('calibrate', { run: 'Run 1', control_set: 'ClinVar, ★ or more' });
  await act('calibrate', { run: 'Run 1', control_set: 'ClinVar, ★ or more, before 2025' });
  await act('calibrate', { run: 'Run 1', control_set: 'ClinVar, ★ or more', rule: 'given', abnormal: 0.7, normal: 1.2, pejaver: true, name: 'Run 1 · given, Pejaver' });
  await act('create_figure', { name: 'Calibration', height_mm: 172 });
  const places = { distribution: [2.8, 2.8, 168.4, 46], roc: [2.8, 51, 83, 72], pr: [88.2, 51, 83, 72], likelihood: [2.8, 125, 168.4, 44] };
  for (const [plot, [x, y, w, h]] of Object.entries(places)) await act('add_figure_panel', { figure: 'Calibration', kind: 'calibration', calibration: 'Run 1 · ClinVar, ★ or more', plot, x_mm: x, y_mm: y, width_mm: w, height_mm: h });
  await act('checkpoint', { name: 'Calibrated' });
  await save('release-0.8.0-factor9-calibration.msz');
  const certPath = join(outDir, 'release-0.8.0-factor9-calibration.certificate.msz');
  await act('certify', { path: certPath, overwrite: true });
  certificate = certPath;

  console.log('The simulated calibration: the person\'s set of the labels, and the agent\'s, waiting');
  await act('open_example', { id: 'simulated-calibration' });
  await act('make_control_set', { source: 'example' });
  await act('calibrate', {});
  await agent('make_control_set', { source: 'example', evaluated_before: 2024 });
  await agent('calibrate', { control_set: 'simulated-labels, before 2024', pejaver: true });
  await save('release-0.8.0-simulated-labels.msz');
  if (errors.length) throw new Error(`The page threw: ${errors[0]}`);
} finally {
  await browser.close();
  server.stdin.end();
  server.kill();
  await sleep(500);
  rmSync(temp, { recursive: true, force: true });
}

// Each archive reopened in Node: the history's chain, each run recomputed from the archive's
// files, each ClinVar set read again from its annotation's file, each calibration computed again
// with its thresholds, each checkpoint's state its own SHA-256, every number computed again, and an
// open proposal as kept.
let failed = 0;
for (const path of written) {
  const opened = await readArchive(new Uint8Array(readFileSync(path)));
  const chain = verifyHistory(opened.ws);
  if (!chain.ok) failed += 1;
  const lines = [];
  const results = new Map();
  for (const [index, run] of opened.ws.runs.entries()) {
    const { scored } = recompute(opened.ws, opened.sources, index);
    const verdict = scored.ok ? reproduction(run, outputDigest(scored.results), '0.8.0') : { status: scored.errors[0] };
    if (verdict.status !== 'reproduced') failed += 1;
    if (scored.ok) results.set(run.id, scored.results);
    lines.push(`${run.name} ${run.output.sha256.slice(0, 12)} ${verdict.status}`);
  }
  const sets = (opened.ws.controlSets ?? []).map((set) => {
    if (set.source.kind !== 'clinvar') return `${set.name} (a table, ${set.labels.length} labels)${set.proposed ? ', proposed' : ''}`;
    const annotation = opened.ws.annotations.find((a) => a.id === set.source.annotation);
    const text = new TextDecoder().decode(opened.sources.get(annotation.file.sha256));
    const read = clinvarControls(text, trackTarget(opened.ws.design.targets[0], opened.ws.targets), set.rules);
    const same = JSON.stringify(read.labels) === JSON.stringify(set.labels);
    if (!same) failed += 1;
    return `${set.name} ${same ? 'read again the same' : 'READ OTHERWISE'}`;
  });
  const calibrations = (opened.ws.calibrations ?? []).map((cal) => {
    const o = computeCalibration(opened.ws, cal, results.get(cal.run));
    const kept = !thresholdsDiffer(o.metrics.thresholds, cal.thresholds) && o.metrics.n.P === cal.n.P && o.metrics.n.B === cal.n.B;
    if (!kept) failed += 1;
    return `${cal.name}: AUC ${o.metrics.auc.auc.toPrecision(3)}, ${kept ? 'its thresholds again' : 'OTHER THRESHOLDS'}${cal.proposed ? ', proposed' : ''}`;
  });
  const checkpoints = (opened.ws.checkpoints ?? []).map((c) => `${c.name} ${stateDigest(c.state) === c.sha256 ? 'as kept' : 'changed'}`);
  failed += checkpoints.filter((c) => c.endsWith('changed')).length;
  const open = opened.ws.proposals ?? [];
  let numbers = 'not certified (a proposal open)';
  if (!open.length) {
    const computed = await computeNumbers(opened.ws, async (sha) => opened.sources.get(sha) ?? null, { software: { version: '0.8.0', commit: '' } });
    failed += computed.notes.length + computed.blocked.size;
    numbers = `${computed.notes.length} notes, ${computed.blocked.size} not computed`;
  }
  const byAgent = opened.ws.history.filter((e) => e.by === AGENT).length;
  console.log(`${path}: ${readFileSync(path).length} bytes; ${opened.problems.length ? opened.problems.join(' ') : 'no problems'}; history ${chain.ok ? 'unbroken' : 'BROKEN'}, ${opened.ws.history.length} entries, ${byAgent} by ${AGENT}; ${lines.join(', ')}; control sets: ${sets.join('; ')}; calibrations: ${calibrations.join('; ')}; checkpoints ${checkpoints.join(', ') || 'none'}; figures ${(opened.ws.figures ?? []).map((f) => `${f.name} (${f.panels.length})`).join(', ') || 'none'}; proposals open: ${open.map((p) => `${p.author}'s, ${p.changes.length} changes`).join(', ') || 'none'}; ${numbers}`);
}
const read = await readCertificate(new Uint8Array(readFileSync(certificate)));
const verified = await verifyCertificate(read, { software: { version: '0.8.0', commit: read.certificate.software?.commit ?? '' } });
if (verified.verdict !== 'verified' || read.certificate.version !== 2) failed += 1;
console.log(`${certificate}: ${readFileSync(certificate).length} bytes; format ${read.certificate.version}; ${verified.summary}`);
if (failed) throw new Error(`${failed} histories broken, runs not reproduced, sets read otherwise, calibrations changed, checkpoints changed, numbers not computed or the certificate not verified`);
