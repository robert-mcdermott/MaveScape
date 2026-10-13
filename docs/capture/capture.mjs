// Captures the documentation screenshots from the bundled examples, in the light and dark themes,
// as docs/images/<scene>-<theme>.webp: the README shows the one matching the reader's theme, and
// the website (docs/site/build.mjs copies them) the one matching the page's. Each scene drives a
// MaveScape built from source through its remote control (actions.go), as any script can, on a
// fresh, empty library, so every run gives the same pictures. Follows CytoWeave 0.8.0's
// docs/capture/capture.mjs. The figures scene also writes the figure it makes as MaveScape exports
// it, docs/images/figure-export.png (one file for both themes: a figure's page is white).
//
//   node docs/capture/capture.mjs [scene …] [--theme light|dark|both] [--audit [--no-shots]]
//
// --audit runs axe-core (node validation/fetch.mjs axe-core fetches it) in every scene with the
// WCAG 2.1 A and AA rules, and writes the violations to docs/capture/audit.json (one entry per scene
// and theme; a run of some scenes replaces only theirs) and a summary to the console; with
// --no-shots, no picture is written.
//
// A scene's name is the name of its pictures, so two scenes may not share one: the run stops
// before it starts if they do.
//
// Needs Go (to build MaveScape) and Chrome, Chromium, Edge or Brave (CHROME=path).

import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, sleep } from './cdp.mjs';
import { assignColumn } from '../../web/lib/design-edit.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const IMAGES = join(ROOT, 'docs/images');
const PORT = 8830;
// Where MaveScape looks for Proteoscope (--proteoscope): only the structure-proteoscope scene starts
// one there, so no other picture shows a Proteoscope running on this computer.
const PROTEOSCOPE_PORT = 8840;
// What the status bar and start page show as the library's place (not this run's temporary one).
const LIBRARY_SHOWN = '~/Library/Application Support/MaveScape';

const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
};
const themes = { light: ['light'], dark: ['dark'], both: ['light', 'dark'] }[option('theme') ?? 'both'];
if (!themes) throw new Error('--theme is light, dark or both');
const wanted = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--theme');
const audit = args.includes('--audit');
const shots = !args.includes('--no-shots');
const AXE = join(ROOT, 'validation/cache/axe-core/axe.min.js');
const PTEN = join(ROOT, 'validation/cache/mavedb-pten-vampseq/scores.csv');
if (wanted.length === 0 || wanted.includes('pten-mavedb') || wanted.includes('compare-classes')) {
  if (!existsSync(PTEN)) throw new Error('The PTEN example\'s scene needs MaveDB\'s table: run node validation/fetch.mjs mavedb-pten-vampseq');
}
// BRCA1's saturation genome editing (wave 3, slice 3): its scores and counts.
const BRCA1_SGE = join(ROOT, 'validation/cache/mavedb-brca1-sge');
if (wanted.length === 0 || wanted.some((w) => ['brca1-sge', 'merged-variant', 'compare-published'].includes(w))) {
  if (!existsSync(join(BRCA1_SGE, 'counts.csv'))) throw new Error('The BRCA1 example\'s scenes need MaveDB\'s tables: run node validation/fetch.mjs mavedb-brca1-sge');
}
// The examples opened from MaveDB with their counts (wave 3, slice 6): DHFR's two score sets, BRCA1
// RING's amino-acid score set; each record's tables and the folder that holds them.
const MAVEDB_TABLES = [
  ['urn:mavedb:00000063-b-1', join(ROOT, 'validation/cache/mavedb-dhfr/minus-lon'), 'dhfr-lon'],
  ['urn:mavedb:00000063-a-1', join(ROOT, 'validation/cache/mavedb-dhfr/plus-lon'), 'dhfr-lon'],
  ['urn:mavedb:00000003-a-2', join(ROOT, 'validation/cache/mavedb-brca1-ring/aa'), 'brca1-ring'],
];
// Published scores compared without opening them, or opened (wave 4, slice 6): TP53's three screens
// and Hsp90's record's scores, from the validation's external data.
const SCORE_TABLES = [
  ['urn:mavedb:00000068-c-1', join(ROOT, 'validation/cache/mavedb-tp53-screens/scores.csv'), 'tp53-screens'],
  ['urn:mavedb:00000068-b-1', join(ROOT, 'validation/cache/mavedb-tp53-screens/nutlin.csv'), 'tp53-screens'],
  ['urn:mavedb:00000059-a-1', join(ROOT, 'validation/cache/mavedb-tp53-screens/kotler.csv'), 'tp53-screens'],
  ['urn:mavedb:00000011-a-1', join(ROOT, 'validation/cache/mavedb-hsp90/scores.csv'), 'hsp90-rescoring'],
];
for (const [, file, scene] of SCORE_TABLES) {
  if ((wanted.length === 0 || wanted.includes(scene)) && !existsSync(file)) throw new Error(`The ${scene} scene needs MaveDB's tables: run node validation/fetch.mjs ${scene === 'tp53-screens' ? 'mavedb-tp53-screens' : 'mavedb-hsp90'}`);
}
for (const [, dir, scene] of MAVEDB_TABLES) {
  const scenes = scene === 'dhfr-lon' ? ['dhfr-lon', 'compare-maps', 'compare-disagreement', 'robustness'] : [scene, `${scene}-certificate`];
  if ((wanted.length === 0 || wanted.some((w) => scenes.includes(w))) && !existsSync(join(dir, 'counts.csv'))) throw new Error(`The ${scene} scene needs MaveDB's tables: run node validation/fetch.mjs ${scene === 'dhfr-lon' ? 'mavedb-dhfr' : 'mavedb-brca1-ring'}`);
}
if (audit && !existsSync(AXE)) throw new Error('axe-core is missing: run node validation/fetch.mjs axe-core');
// Proteoscope, for the scene of a view handed to it (wave 5, slice 6): PROTEOSCOPE names its
// program, else "proteoscope" on the PATH.
const PROTEOSCOPE = process.env.PROTEOSCOPE ?? (process.env.PATH ?? '').split(delimiter).map((dir) => join(dir, process.platform === 'win32' ? 'proteoscope.exe' : 'proteoscope')).find((file) => existsSync(file));
if ((wanted.length === 0 || wanted.includes('structure-proteoscope')) && !(PROTEOSCOPE && existsSync(PROTEOSCOPE))) throw new Error('The structure-proteoscope scene needs Proteoscope 0.10: install it, or set PROTEOSCOPE to its program');
// Run after the scene's picture is taken (a program the scene started).
const afterScene = [];

// --- MaveScape ------------------------------------------------------------------------------------

const temp = mkdtempSync(join(tmpdir(), 'mavescape-capture-'));
const binary = join(temp, process.platform === 'win32' ? 'mavescape.exe' : 'mavescape');
let URL = '';
let token = '';

// An AI agent's scenes (wave 7, slice 5) start "mavescape mcp" instead and drive it over its stdin
// and stdout as Claude Code does (an agent's client): their changes are proposals.
const AGENT_SCENES = new Set(['agent-proposal', 'agent-accepted', 'agent-hsp90']);
let rpc = null;

function connectAgent(server) {
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
  return (method, params) => new Promise((done) => {
    const id = next++;
    pending.set(id, done);
    server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
}

// Started per scene on an empty library, so that no scene sees another's workspaces.
async function startMaveScape({ agent = false } = {}) {
  const library = mkdtempSync(join(temp, 'library-'));
  // UniProt's answers as the fetcher cached them (validation/fixtures/public-data), copied fresh,
  // so the scenes that check a target are answered from the cache and send nothing.
  const cache = mkdtempSync(join(temp, 'cache-'));
  cpSync(join(ROOT, 'validation/fixtures/public-data'), cache, { recursive: true });
  // The PTEN example's table, from the validation's external data (node validation/fetch.mjs
  // mavedb-pten-vampseq), with the retrieval record the fetcher would write.
  if (existsSync(PTEN)) {
    cpSync(PTEN, join(cache, 'mavedb', 'urn_mavedb_00000013-a-1.scores.csv'));
    writeFileSync(join(cache, 'mavedb', 'urn_mavedb_00000013-a-1.scores.csv.meta.json'), `${JSON.stringify({ contentType: 'text/csv; charset=utf-8', service: 'MaveDB', source: 'https://api.mavedb.org/api/v1/score-sets/urn:mavedb:00000013-a-1/scores', retrieved: '2026-10-11T02:24:52Z' }, null, 2)}\n`);
  }
  for (const table of ['scores', 'counts']) {
    if (!existsSync(join(BRCA1_SGE, `${table}.csv`))) continue;
    cpSync(join(BRCA1_SGE, `${table}.csv`), join(cache, 'mavedb', `urn_mavedb_00000097-0-2.${table}.csv`));
    writeFileSync(join(cache, 'mavedb', `urn_mavedb_00000097-0-2.${table}.csv.meta.json`), `${JSON.stringify({ contentType: 'text/csv; charset=utf-8', service: 'MaveDB', source: `https://api.mavedb.org/api/v1/score-sets/urn:mavedb:00000097-0-2/${table}`, retrieved: '2026-10-11T04:13:31Z' }, null, 2)}\n`);
  }
  for (const [urn, file] of SCORE_TABLES) {
    if (!existsSync(file)) continue;
    const name = `${urn.replaceAll(':', '_')}.scores.csv`;
    cpSync(file, join(cache, 'mavedb', name));
    writeFileSync(join(cache, 'mavedb', `${name}.meta.json`), `${JSON.stringify({ contentType: 'text/csv; charset=utf-8', service: 'MaveDB', source: `https://api.mavedb.org/api/v1/score-sets/${urn}/scores`, retrieved: '2026-10-12T01:15:25Z' }, null, 2)}\n`);
  }
  for (const [urn, dir] of MAVEDB_TABLES) {
    for (const table of ['scores', 'counts']) {
      if (!existsSync(join(dir, `${table}.csv`))) continue;
      const name = `${urn.replaceAll(':', '_')}.${table}.csv`;
      cpSync(join(dir, `${table}.csv`), join(cache, 'mavedb', name));
      writeFileSync(join(cache, 'mavedb', `${name}.meta.json`), `${JSON.stringify({ contentType: 'text/csv; charset=utf-8', service: 'MaveDB', source: `https://api.mavedb.org/api/v1/score-sets/${urn}/${table}`, retrieved: '2026-10-11T16:30:00Z' }, null, 2)}\n`);
    }
  }
  const flags = ['--window', 'none', '--port', String(PORT), '--data-dir', library, '--cache-dir', cache, '--proteoscope', `${PROTEOSCOPE_PORT}-${PROTEOSCOPE_PORT + 4}`];
  const server = spawn(binary, agent ? ['mcp', ...flags] : ['--remote-control', ...flags], { cwd: temp, stdio: [agent ? 'pipe' : 'ignore', 'pipe', agent ? 'pipe' : 'inherit'] });
  let output = '';
  // mcp's banner is on stderr: its stdout is the agent's.
  (agent ? server.stderr : server.stdout).on('data', (chunk) => { output += chunk; });
  rpc = agent ? connectAgent(server) : null;
  const stop = async () => {
    const exited = new Promise((done) => server.once('exit', done));
    if (agent) server.stdin.end();
    server.kill();
    await Promise.race([exited, sleep(3000)]);
  };
  for (let i = 0; i < 150; i += 1) {
    const address = /running at (http:\/\/[\d.]+:\d+)/.exec(output)?.[1];
    if (address && existsSync(join(library, 'remote.json'))) {
      URL = `${address}/`;
      token = JSON.parse(readFileSync(join(library, 'remote.json'), 'utf8')).token;
      if (agent) {
        await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code', title: 'Claude Code', version: '2' } });
        server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
      }
      return { stop };
    }
    await sleep(100);
  }
  await stop();
  throw new Error(`MaveScape did not start:\n${output}`);
}

// An action through remote control, as any script sends it.
async function act(action, actionArgs = {}) {
  const response = await fetch(`${URL}api/remote/action`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-MaveScape-Token': token }, body: JSON.stringify({ action, args: actionArgs, client: 'docs/capture' }) });
  const result = await response.json();
  if (!result.ok) throw new Error(`${action}: ${result.message ?? result.error}`);
  return result;
}

// A tool called as an AI agent calls it, through mavescape mcp (the agent scenes).
async function agent(name, toolArgs = {}) {
  const reply = await rpc('tools/call', { name, arguments: toolArgs });
  if (reply.error || reply.result?.isError) throw new Error(`${name}: ${reply.error?.message ?? reply.result.content[0].text}`);
  return reply.result;
}

// --- Page helpers ---------------------------------------------------------------------------------

let b;
const js = (expression) => b.eval(expression);

async function waitFor(expression, timeout = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await js(expression)) return true;
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${expression}`);
}

async function click(text, scope = 'button') {
  const ok = await js(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(scope)})].find((e) => e.offsetParent !== null && e.textContent.trim().includes(${JSON.stringify(text)})); if (!el) return false; el.click(); return true; })()`);
  if (!ok) throw new Error(`No ${scope} "${text}"`);
  await sleep(400);
}

const scrollTo = async (selector, block = 'start') => {
  await js(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: ${JSON.stringify(block)} })`);
  await sleep(500);
};
const clearToasts = () => js(`document.querySelectorAll('.toast').forEach((t) => t.remove())`);
const example = (id) => act('open_example', { id });

// GRB2's example as Claude Code works on it (wave 7, slice 5): opened, scored again with the
// DiMSum-compatible preset (whose error model carries the bottleneck at the inputs that QC finds),
// the least tolerant core saved as a selection, the variance beyond counting acknowledged; the QC
// view of Run 1. The run and the selection are made, marked proposed; the acknowledgement waits.
async function agentOnGRB2() {
  await agent('open_example', { id: 'grb2-sh3' });
  await agent('score', { preset: 'dimsum' });
  await agent('select_variants', { run: 'Run 1', query: 'lower and position 30-40', save_as: 'Core, lower' });
  await agent('acknowledge_finding', { run: 'Run 1', finding: 'excess-variance', reason: 'The input bottleneck the Domainome\'s own analysis found; DiMSum\'s error model (Run 2) carries it' });
  await agent('qc_findings', { run: 'Run 1', finding: 'variance' });
  await waitFor(`Boolean(document.querySelector('.proposal-strip'))`);
  await sleep(800);
}

// The guide's session on Hsp90 (wave 7, slice 6) to its second answer, as validation/agent-session.mjs
// makes it: compared with the record's published scores (their score set kept beside the map), a
// checkpoint kept, and a design fitting the first three samples proposed (generations 9 to 21 not
// used); the Experiment view shows it beside the person's.
async function agentOnHsp90() {
  await agent('open_example', { id: 'hsp90' });
  await agent('qc_findings', { run: 'Run 1' });
  await agent('compare', { a: 'Run 1', b: 'urn:mavedb:00000011-a-1', scale: 'stated', direction: 'higher-more' });
  await agent('checkpoint', { name: 'All eight samples' });
  const design = structuredClone((await agent('provenance', { run: 'Run 1' })).structuredContent.data.inputs.design);
  const later = design.samples.slice(3);
  design.samples = design.samples.slice(0, 3);
  design.replicates[0].timepoints = design.replicates[0].timepoints.slice(0, 3);
  design.ignoredColumns = later.flatMap((x) => x.columns).map((column) => ({ column, reason: 'later time points: the authors fit their null-like variants on the first three' }));
  await agent('set_design', { design });
  await agent('set_mode', { mode: 'experiment' });
  await waitFor(`Boolean(document.querySelector('.proposal-strip'))`);
  await sleep(800);
}

// --- Scenes ---------------------------------------------------------------------------------------

const scenes = {
  // The start page: the examples, what to bring, the blank layouts.
  async start() {
    await act('set_mode', { mode: 'start' });
  },
  // A count table and its target opened, the import wizard showing what MaveScape found.
  async import() {
    await act('open_files', { paths: [join(ROOT, 'web/examples/grb2-sh3/target.fasta')] });
    await act('open_files', { paths: [join(ROOT, 'web/examples/grb2-sh3/counts.csv')], review: true });
    await waitFor(`Boolean(document.querySelector('.import-wizard'))`);
    await sleep(800);
  },
  // GRB2's design in the Experiment view, with the workflow strip above it.
  async experiment() {
    await example('grb2-sh3');
    await act('set_mode', { mode: 'experiment' });
    await act('focus', { kind: 'table', name: 'GRB2' });
  },
  // A design drafted from the column names of a table opened by path.
  async 'draft-design'() {
    await act('open_files', { paths: [join(ROOT, 'web/examples/grb2-sh3/counts.csv'), join(ROOT, 'web/examples/grb2-sh3/target.fasta')] });
    await act('draft_design');
    await act('set_mode', { mode: 'experiment' });
  },
  // What the assay measures (wave 2, slice 8): GRB2's readout in MaveDB's terms, and its controls.
  async readout() {
    await example('grb2-sh3');
    await act('set_mode', { mode: 'experiment' });
    await scrollTo('.readout-pane', 'center');
  },
  // The target checked against its UniProt entry (wave 3, slice 1): GRB2's SH3 domain at
  // positions 159–214 of P62993, from the cache.
  async 'target-uniprot'() {
    await example('grb2-sh3');
    await act('set_mode', { mode: 'experiment' });
    await scrollTo('[data-place="target"]', 'start');
    await click('Check against UniProt');
    await waitFor(`Boolean(document.querySelector('.dialog .entry-card'))`);
    await clearToasts();
    await sleep(600);
  },
  // Open from MaveDB (wave 3, slice 2): a search for VAMP-seq, MaveDB's answer from the cache.
  async 'mavedb-search'() {
    await act('set_mode', { mode: 'start' });
    await js(`import('/ui/mavedb.js').then((m) => { m.openMaveDBDialog(window.mavescape, { query: 'VAMP-seq' }); return true; })`);
    await waitFor(`document.querySelectorAll('.mavedb-hit').length > 3`);
    await sleep(500);
  },
  // A record before it is opened: PTEN's VAMP-seq, its license, the assay in MaveDB's terms, and
  // its calibrations.
  async 'mavedb-record'() {
    await act('set_mode', { mode: 'start' });
    await js(`import('/ui/mavedb.js').then((m) => { m.openMaveDBDialog(window.mavescape, { query: 'urn:mavedb:00000013-a-1' }); return true; })`);
    await waitFor(`Boolean(document.querySelector('.dialog .record-view .calibration'))`);
    await js(`document.querySelector('.dialog .record-view .section-title:nth-of-type(3)')?.scrollIntoView({ block: 'start' })`);
    await sleep(500);
  },
  // GRB2 opened from MaveDB: its published scores on the map, the record in the inspector.
  async 'mavedb-published'() {
    await act('open_mavedb', { urn: 'urn:mavedb:00000835-a-1' });
    await act('set_mode', { mode: 'map' });
    await act('focus', { kind: 'table', name: 'scores' });
    await clearToasts();
    await sleep(800);
  },
  // A record whose target is a transcript (wave 3, slice 3): BRCA1's saturation genome editing,
  // before it is opened.
  async 'mavedb-transcript'() {
    await act('set_mode', { mode: 'start' });
    await js(`import('/ui/mavedb.js').then((m) => { m.openMaveDBDialog(window.mavescape, { query: 'urn:mavedb:00000097-0-2' }); return true; })`);
    await waitFor(`Boolean(document.querySelector('.dialog .record-view .calibration'))`);
    await sleep(500);
  },
  // Nucleotide variants at the protein level (wave 3, slice 3): BRCA1's saturation genome editing on
  // the map, and beside it the splice-site variants a map of substitutions cannot show.
  async 'brca1-sge'() {
    await example('brca1-sge');
    await act('set_mode', { mode: 'map' });
    await clearToasts();
    await js(`(() => { const d = document.querySelector('details.off-map'); d.open = true; d.dispatchEvent(new Event('toggle')); return true; })()`);
    await sleep(300);
    await js(`(() => { const s = document.querySelector('details.off-map select'); s.value = 'splice site'; s.dispatchEvent(new Event('change')); return true; })()`);
    await sleep(400);
    // The map's lower part, what it says in words, and the table's first rows.
    await js(`(() => { const d = document.querySelector('details.off-map'); d.scrollIntoView({ block: 'start' }); const c = d.closest('.view-body'); if (c) c.scrollTop -= 560; return true; })()`);
    await sleep(500);
  },
  // A protein variant of a nucleotide run in the inspector: BRCA1's p.Tyr1853Ter, made by two.
  async 'merged-variant'() {
    await example('brca1-sge');
    await act('inspect_variant', { variant: 'p.Tyr1853Ter' });
    await clearToasts();
    await sleep(600);
  },
  // A GenBank plasmid map with three coding features (wave 3, slice 3): the chooser.
  async 'genbank-cds'() {
    await act('set_mode', { mode: 'start' });
    const gb = readFileSync(join(ROOT, 'validation/fixtures/public-data/ncbi/ON605209.1.gb'), 'utf8');
    await js(`(window.mavescape.importFiles([new File([${JSON.stringify(gb)}], 'pMK-RQ-BCD_LacZ-cmyc-EB2-H6.gb')]), true)`);
    await waitFor(`Boolean(document.querySelector('.dialog .cds-list'))`);
    await sleep(500);
  },
  // A MaveDB deposit (wave 3, slice 4): the GRB2 example's run, what the deposit holds and what
  // MaveDB still requires (an abstract), and the MaveDB details to give.
  async 'mavedb-deposit'() {
    await example('grb2-sh3');
    await act('set_mode', { mode: 'score' });
    await js(`import('/ui/mavedb-export.js').then((m) => { const ws = window.mavescape.store.ws; m.openDepositDialog(window.mavescape, ws.runs.at(-1)); return true; })`);
    await waitFor(`Boolean(document.querySelector('.dialog .deposit-report'))`);
    await clearToasts();
    await sleep(600);
  },
  // What the analysis can do (wave 2, slice 10): GRB2's readiness in the Experiment view, and what
  // the published counts leave out.
  async readiness() {
    await example('grb2-sh3');
    await act('set_mode', { mode: 'experiment' });
    await scrollTo('.readiness-pane', 'start');
  },
  // Scores with their evidence: the filter flow, the classes, the variants.
  async score() {
    await example('grb2-sh3');
    await act('score', { preset: 'enrich2' });
    await act('focus', { kind: 'run', name: 'Run 1' });
  },
  // GRB2 scored by DiMSum's model: each replicate's scale, shift and error terms.
  async 'dimsum-score'() {
    await example('grb2-sh3');
    await act('score', { preset: 'dimsum' });
    await scrollTo('.replicates-pane', 'center');
  },
  // QC of GRB2: everything passes but the variance beyond counting (a bottleneck).
  async qc() {
    await example('grb2-sh3');
    await act('qc_findings', { finding: 'excess-variance' });
    await sleep(600);
  },
  // A finding in context (wave 2, slice 8): what could cause GRB2's bottleneck, what to do, and the
  // finding acknowledged with a reason, its status unchanged.
  async 'qc-advice'() {
    await example('grb2-sh3');
    await act('acknowledge_finding', { finding: 'excess-variance', reason: 'The input bottleneck the Domainome\'s own analysis reported' });
    await act('qc_findings', { finding: 'excess-variance' });
    await sleep(600);
    await scrollTo('.finding-context', 'center');
  },
  // The same finding's plots: DiMSum's terms put the bottleneck at the inputs.
  async 'dimsum-qc'() {
    await example('grb2-sh3');
    await act('qc_findings', { finding: 'excess-variance' });
    await sleep(600);
    await scrollTo('svg.plot[aria-label^="DiMSum"]', 'center');
  },
  // The map of GRB2, a variant in the inspector.
  async map() {
    await example('grb2-sh3');
    await act('render_map', { color_by: 'score', rows: 'biochemical' });
    await act('inspect_variant', { variant: 'p.Trp36Ala' });
    await sleep(600);
  },
  // Sequence tracks (wave 3, slice 5): GRB2's map with UniProt's features, conservation (PDBe-KB's
  // and an alignment's), AlphaMissense, ClinVar and gnomAD below it, from the cached answers; the
  // Tracks panel; a variant's annotations in the inspector.
  async 'map-tracks'() {
    await example('grb2-sh3');
    for (const provider of ['uniprot-features', 'pdbe-conservation', 'alphamissense', 'clinvar', 'gnomad']) await act('add_track', { provider });
    await act('add_track', { name: 'grb2-sh3.sto', text: readFileSync(join(ROOT, 'validation/fixtures/annotations/grb2-sh3.sto'), 'utf8') });
    await act('set_track', { track: 'Conservation (grb2-sh3.sto)', position: 9 });
    await act('render_map', { color_by: 'score', rows: 'biochemical' });
    await act('inspect_variant', { variant: 'p.Trp36Ala' });
    await clearToasts();
    await scrollTo('.map-pane .map-legend', 'start');
    await sleep(800);
  },
  // A position selected and saved, on the map zoomed in.
  async 'map-selection'() {
    await example('grb2-sh3');
    await act('select_variants', { positions: [35, 36, 37], save_as: 'WW motif' });
    await act('render_map', { zoom: 2 });
  },
  // The simulated example's map colored by standard error: the uncertain cells.
  async 'map-se'() {
    await example('simulated');
    await act('render_map', { color_by: 'se' });
    await act('inspect_variant', { variant: 'p.Gly10Trp' });
  },
  // Intervals that hold the truth (wave 2, slice 9): the simulated example rescaled to nonsense 0
  // and wild type 1, a variant's interval by t at its degrees of freedom and the anchors' shared
  // uncertainty (SE_scale) in the inspector.
  async intervals() {
    await example('simulated');
    await act('score', { parameters: { rescale: 'nonsense-wt' } });
    await act('render_map', { color_by: 'score', rows: 'biochemical' });
    await act('inspect_variant', { variant: 'p.Lys3Glu' });
    await sleep(600);
  },
  // Wave 2, slice 11: the three new examples. Hsp90 per generation: its nine positions, and a
  // variant's time course over 21 generations in its one replicate.
  async hsp90() {
    await example('hsp90');
    await act('render_map', { color_by: 'score', rows: 'biochemical' });
    await act('inspect_variant', { variant: 'p.Ser5Ala' });
    await sleep(600);
  },
  // Factor IX: 461 positions in three overlapping tiles, a variant's distribution over the bins.
  // PTEN opened from MaveDB (wave 3, slice 2): its published scores on the map, the record and its
  // calibrations in the inspector.
  async 'pten-mavedb'() {
    await example('pten-mavedb');
    await act('focus', { kind: 'table', name: 'scores' });
    await clearToasts();
    await sleep(800);
  },
  async factor9() {
    await example('factor9');
    await act('render_map', { color_by: 'score', rows: 'biochemical' });
    await act('inspect_variant', { variant: 'p.Gly254Asp' });
    await sleep(600);
  },
  // The simulated problems: the variance beyond counting, the recorded cells against it.
  async problems() {
    await example('simulated-problems');
    await act('qc_findings', { finding: 'excess-variance' });
    await sleep(600);
  },
  // A time series: a nonsense variant's time course in each replicate, with its fitted lines.
  async 'time-course'() {
    await example('simulated-time-series');
    await act('select_variants', { variants: ['p.Ser2Ter'] });
    await act('inspect_variant', { variant: 'p.Ser2Ter' });
    await sleep(600);
  },
  // A time series in the Score view: scored by weighted regression on every time point.
  async 'time-series-score'() {
    await example('simulated-time-series');
    await act('set_mode', { mode: 'score' });
    await act('focus', { kind: 'run', name: 'Run 1' });
  },
  // A time series' quality control: the fit of the time courses.
  async 'time-series-qc'() {
    await example('simulated-time-series');
    await act('qc_findings', { finding: 'time-fit' });
    await sleep(600);
  },
  // The design of a time series: samples at each time, "Missing = 0" per sample.
  async 'time-series-design'() {
    await example('simulated-time-series');
    await act('set_mode', { mode: 'experiment' });
  },
  // Sorted bins: a nonsense variant's distribution over the bins in each replicate, beside the
  // wild type's.
  async 'sort-seq'() {
    await example('simulated-sort-seq');
    await act('select_variants', { variants: ['p.Ser2Ter'] });
    await act('inspect_variant', { variant: 'p.Ser2Ter' });
    await sleep(600);
  },
  // Sorted bins in the Score view, scored by maximum likelihood.
  async 'sort-seq-score'() {
    await example('simulated-sort-seq');
    await act('score', { parameters: { model: 'bins-mle' } });
  },
  // Sorted bins' quality control: the cells sorted per variant.
  async 'sort-seq-qc'() {
    await example('simulated-sort-seq');
    await act('qc_findings', { finding: 'cells-per-bin' });
    await sleep(600);
  },
  // The design of sorted bins: each bin's value and gates, the cells sorted into it.
  async 'sort-seq-design'() {
    await example('simulated-sort-seq');
    await act('set_mode', { mode: 'experiment' });
    await scrollTo('.experiment-split > div:last-child .pane:nth-child(2)');
  },
  // A table of barcode counts and its barcode-to-variant map opened together: the map applied, the
  // barcodes it gives two variants and those it misses listed.
  async 'barcode-import'() {
    await act('open_files', { paths: [join(ROOT, 'validation/fixtures/barcodes.fasta')] });
    await act('open_files', { paths: [join(ROOT, 'validation/fixtures/barcodes.csv'), join(ROOT, 'validation/fixtures/barcodes.map.csv')], review: true });
    await waitFor(`Boolean(document.querySelector('.import-wizard'))`);
    await sleep(800);
  },
  // A barcoded library scored barcode by barcode: a variant's barcodes in each replicate, one an
  // outlier.
  async barcodes() {
    await example('simulated-barcodes');
    await act('score', { parameters: { aggregation: 'barcode' } });
    await act('render_map', { color_by: 'score', rows: 'biochemical' });
    await act('inspect_variant', { variant: 'p.Glu6Gln' });
    await sleep(600);
    await scrollTo('.barcode-block');
  },
  // A barcoded library's quality control: how a variant's barcodes agree, and the outliers.
  async 'barcode-qc'() {
    await example('simulated-barcodes');
    await act('qc_findings', { finding: 'outlier-barcodes' });
    await sleep(600);
  },
  // Two conditions from shared inputs: the map of their difference, a binding-site variant in the
  // inspector with its score in each condition and the difference.
  async 'differential-map'() {
    await example('simulated-conditions');
    await act('render_map', { color_by: 'differential' });
    await act('inspect_variant', { variant: 'p.Pro13Ala' });
    await sleep(600);
    await scrollTo('#inspector h4.inspector-sub:nth-of-type(2)', 'start');
  },
  // Two MaveDB score sets opened together (wave 3, slice 6): DHFR's map of +Lon − −Lon, a variant
  // Lon penalizes in the inspector, its sub-library's three replicates.
  async 'dhfr-lon'() {
    await example('dhfr-lon');
    await act('render_map', { color_by: 'differential' });
    await act('inspect_variant', { variant: 'p.Met20Ala', condition: '+Lon' });
    await clearToasts();
    await sleep(600);
  },
  // BRCA1 RING from MaveDB (wave 3, slice 6): its counts scored (Run 1) on the map, a zinc ligand
  // of the RING (C61 on BRCA1's numbering) in the inspector, its six replicates.
  async 'brca1-ring'() {
    await example('brca1-ring');
    await act('inspect_variant', { variant: 'p.Cys60Tyr', run: 'Run 1' });
    await clearToasts();
    await sleep(600);
  },
  // The Score view's comparison of the conditions: how, how many differ, the volcano plot.
  async 'differential-score'() {
    await example('simulated-conditions');
    await act('set_mode', { mode: 'score' });
    await act('focus', { kind: 'run', name: 'Run 1' });
    await scrollTo('.differential-pane', 'center');
  },
  // Comparisons (wave 4, slice 1): GRB2's replicates 1 and 2, every item of the report ok and every
  // statistic given, a variant in the inspector and ringed in the plots.
  async compare() {
    await example('grb2-sh3');
    await act('compare', { a: 'Run 1: Replicate 1', b: 'Run 1: Replicate 2' });
    await act('focus', { kind: 'variant', name: 'p.Trp36Ala', run: 'Run 1' });
    await act('set_mode', { mode: 'compare' });
    await clearToasts();
    await sleep(600);
  },
  // BRCA1's counts scored against its published scores: correlations only, the report saying why.
  async 'compare-published'() {
    await example('brca1-sge');
    await act('score', {});
    await act('compare', {});
    await clearToasts();
    await sleep(600);
  },
  // DHFR's conditions compared on the maps (wave 4, slice 2): −Lon, +Lon and their difference, with
  // low confidence left out, panned and zoomed as one, a variant of W47 selected in each.
  async 'compare-maps'() {
    await example('dhfr-lon');
    await act('compare', { a: 'Run 1: −Lon', b: 'Run 1: +Lon', low_confidence: true, show: 'maps' });
    await act('focus', { kind: 'variant', name: 'p.Trp47Arg', run: 'Run 1' });
    await act('set_mode', { mode: 'compare' });
    await clearToasts();
    await sleep(800);
  },
  // The same, its disagreement: the discordant variants, the dispersion, and the positions.
  async 'compare-disagreement'() {
    await example('dhfr-lon');
    await act('compare', { a: 'Run 1: −Lon', b: 'Run 1: +Lon', low_confidence: true, show: 'disagreement' });
    await clearToasts();
    await sleep(600);
  },
  // Other sources and scales (wave 4, slice 3): GRB2's Run 1 against its record's published scores,
  // kept beside the workspace by URN without opening it (from the cache), rescaled by their anchors.
  async 'compare-scales'() {
    await example('grb2-sh3');
    await act('compare', { a: 'Run 1', b: 'urn:mavedb:00000835-a-1', scale: 'nonsense-wt', show: 'agreement' });
    await act('set_mode', { mode: 'compare' });
    await clearToasts();
    await sleep(700);
  },
  // PTEN's abundance against AlphaMissense (P60484, from the cache): by rank and by its classes.
  async 'compare-classes'() {
    await example('pten-mavedb');
    await act('add_track', { provider: 'alphamissense', run: 'Published scores' });
    await act('compare', { a: 'Published scores', b: 'AlphaMissense: P60484', show: 'classes' });
    await act('set_mode', { mode: 'compare' });
    await clearToasts();
    await sleep(700);
  },
  // Robustness to analysis choices (wave 4, slice 4): DHFR's Run 1 scored again 47 other ways, its
  // differences between the conditions: how many hold in every analysis, and on what the others
  // depend.
  async robustness() {
    await example('dhfr-lon');
    await act('check_robustness', { run: 'Run 1' });
    await click('+Lon vs −Lon');
    await scrollTo('.robustness-pane', 'start');
    await clearToasts();
    await sleep(600);
  },
  // Two screens on two scales (wave 4, slice 6): TP53's etoposide screen, its target checked against
  // UniProt, against Kotler et al.'s screen of the DNA-binding domain kept beside, both rescaled by
  // their anchors.
  async 'tp53-screens'() {
    await example('tp53-screens');
    await act('check_target', { accession: 'P04637', apply: true });
    await act('compare', { a: 'Published scores', b: 'urn:mavedb:00000059-a-1', direction: 'higher-less', scale: 'synonymous-nonsense', show: 'agreement' });
    await act('set_mode', { mode: 'compare' });
    await clearToasts();
    await sleep(800);
  },
  // A rescoring against the published scores (wave 4, slice 6): Hsp90's Run 1 against its record's
  // own scores kept beside, stated to be on one scale, the Bland–Altman plot's trend in view.
  async 'hsp90-rescoring'() {
    await example('hsp90');
    await act('compare', { a: 'Run 1', b: 'urn:mavedb:00000011-a-1', direction: 'higher-more', scale: 'stated', show: 'agreement' });
    await act('set_mode', { mode: 'compare' });
    await clearToasts();
    await scrollTo('.compare-stats', 'start');
    await sleep(800);
  },
  // Selections by query (wave 4, slice 5): factor IX's map with UniProt's features beside it, the
  // lost substitutions of the cysteines in its disulfide bonds selected by query and saved, the
  // query in its field.
  async selections() {
    await example('factor9');
    await act('add_track', { provider: 'uniprot-features' });
    await act('select_variants', { query: 'missense from C in feature disulfide and lower', save_as: 'Disulfides' });
    await js(`(() => { const i = document.querySelector('.map-query-input'); i.value = 'missense from C in feature disulfide and lower'; i.dispatchEvent(new Event('input')); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
    await waitFor(`/variants? match/.test(document.querySelector('.map-query-note')?.textContent ?? '')`);
    await js(`document.querySelector('.map-query-input').blur()`);
    await clearToasts();
    await scrollTo('.map-pane .map-legend', 'start');
    await sleep(800);
  },
  // The Structure view (wave 5, slice 1): factor IX's structure (PDB 1RFN) from the cache, its
  // cysteines selected in words and drawn as sticks, the pair that joins its two chains labeled.
  async structure() {
    await example('factor9');
    await act('open_structure', { pdb: '1RFN' });
    await act('set_structure', { select: 'resn CYS', show: 'sticks' });
    await act('set_structure', { select: '(chain A and resi 122) or (chain B and resi 132)', label: true });
    await act('set_structure', { select: 'resn CYS' });
    await js(`(() => { const i = document.querySelector('.structure-query-input'); if (i) i.value = 'resn CYS'; })()`);
    await sleep(1200);
  },
  // An AlphaFold DB model: GRB2's, colored by its confidence, the SH3 domain the example measures
  // (UniProt 159–214) selected.
  async 'structure-alphafold'() {
    await example('grb2-sh3');
    await act('open_structure', { alphafold: 'target' });
    await act('set_structure', { select: 'resi 159-214' });
    await js(`(() => { const i = document.querySelector('.structure-query-input'); if (i) i.value = 'resi 159-214'; })()`);
    await sleep(1200);
  },
  // The target on the structure (wave 5, slice 2): factor IX mapped onto 1RFN's light chain, where
  // the entry's own record numbers it five earlier than SIFTS and the alignment; the target's
  // residues selected.
  async 'structure-mapping'() {
    await example('factor9');
    await act('open_structure', { pdb: '1RFN', chain: 'B' });
    await act('set_structure', { select: 'pos 132-188' });
    await js(`(() => { const i = document.querySelector('.structure-query-input'); if (i) i.value = 'pos 132-188'; })()`);
    await sleep(1200);
  },
  // Scores on the structure (wave 5, slice 3): GRB2's SH3 domain on 2VWF colored by the median
  // score, the residues that touch the Gab2 peptide selected in the words of the example's guide and
  // drawn as sticks (their substitutions selected on the map), the strip of positions below.
  async 'structure-scores'() {
    await example('grb2-sh3');
    await act('open_structure', { pdb: '2VWF' });
    await act('set_structure', { color: 'median', select: 'byres (chain A and protein and within 4 of (chain B and protein))', show: 'sticks' });
    await js(`(() => { const i = document.querySelector('.structure-query-input'); if (i) i.value = 'byres (chain A and protein and within 4 of (chain B and protein))'; })()`);
    await scrollTo('.structure-scores', 'start');
    await sleep(1200);
  },
  // Structure as evidence (wave 5, slice 4): PTEN's phosphatase and C2 domains (1D5R) colored by
  // structural class, the compact group of least tolerant positions that joins the two domains
  // selected, the pane with the scores by class and the cluster test.
  async 'structure-evidence'() {
    await example('pten-mavedb');
    await act('open_structure', { pdb: '1D5R' });
    await act('structure_evidence', {});
    await act('set_structure', { color: 'class', select: 'pos 98,170,174,177,274,276' });
    await js(`(() => { const i = document.querySelector('.structure-query-input'); if (i) i.value = 'pos 98,170,174,177,274,276'; })()`);
    await scrollTo('.structure-evidence', 'start');
    await sleep(1200);
  },
  // Structures in the record (wave 5, slice 5): a view of 2VWF colored by GRB2's median scores,
  // residues drawn and labeled, saved as Core: in the pane, the dataset tree and the inspector.
  async 'structure-views'() {
    await example('grb2-sh3');
    await act('open_structure', { pdb: '2VWF' });
    await act('set_structure', { color: 'median', select: 'pos 20-26', show: 'sticks' });
    await act('set_structure', { select: 'pos 21+25', label: true });
    await act('save_structure_view', { name: 'Core' });
    await act('focus', { kind: 'structure view', name: 'Core' });
    await scrollTo('.structure-views', 'start');
    await sleep(1200);
  },
  // Open in Proteoscope (wave 5, slice 6): 2VWF colored by GRB2's median scores, residues drawn and
  // labeled, handed to Proteoscope (started for the scene, its downloads cached in
  // validation/cache/proteoscope): its window, as it opened the link.
  async 'structure-proteoscope'() {
    const proteoscope = spawn(PROTEOSCOPE, ['--no-open', '--port', String(PROTEOSCOPE_PORT), '--cache-dir', join(ROOT, 'validation/cache/proteoscope')], { stdio: ['ignore', 'pipe', 'inherit'] });
    afterScene.push(async () => {
      const exited = new Promise((done) => proteoscope.once('exit', done));
      proteoscope.kill();
      await Promise.race([exited, sleep(3000)]);
    });
    let banner = '';
    proteoscope.stdout.on('data', (chunk) => { banner += chunk; });
    for (let i = 0; i < 100 && !/running at/.test(banner); i += 1) await sleep(100);
    await example('grb2-sh3');
    await act('open_structure', { pdb: '2VWF' });
    await act('set_structure', { color: 'median', select: 'pos 20-26', show: 'sticks' });
    await act('set_structure', { select: 'pos 21+25', label: true });
    await sleep(1500);
    const handed = await act('proteoscope_link');
    await b.goto(handed.data.link, 1000);
    await waitFor('Boolean(globalThis.proteoscope?.state?.active?.proteomics?.data)', 90000);
    await sleep(3000);
  },
  // Figures (wave 6): a figure as a paper's would be, on a page two columns wide: GRB2's map with
  // its sequence, UniProt's secondary structure, AlphaMissense and each position's effect below it;
  // the domain on 2VWF colored by the median score; the measured scores in each of AlphaMissense's
  // classes; and two replicates' agreement. Nothing selected, so the page is seen as printed; and
  // the figure exported (docs/images/figure-export.png).
  async figures() {
    await example('grb2-sh3');
    for (const provider of ['uniprot-features', 'alphamissense']) await act('add_track', { provider });
    // 2VWF colored by the median score, the residues that touch the Gab2 peptide drawn as sticks,
    // the camera closer, saved as the view a panel shows.
    await act('open_structure', { pdb: '2VWF' });
    await act('set_structure', { color: 'median', select: 'byres (chain A and protein and within 4 of (chain B and protein))', show: 'sticks' });
    await act('set_structure', { select: '' });
    await js(`import('/ui/mode-structure.js').then((m) => { const v = m.structureState(window.mavescape).viewer; const c = v.camera; c.distance *= 0.72; v.setCamera(c); return true; })`);
    await sleep(1500);
    await act('save_structure_view', { name: 'Core' });
    await act('create_figure', { name: 'Figure 1', height_mm: 178 });
    await act('add_figure_panel', { figure: 'Figure 1', run: 'Run 1', tracks: ['reference', 'uniprot-features:structure', 'alphamissense:alphamissense', 'effect'], x_mm: 3, y_mm: 3, width_mm: 168, height_mm: 100 });
    await act('add_figure_panel', { figure: 'Figure 1', kind: 'structure', view: 'Core', x_mm: 3, y_mm: 106, width_mm: 56, height_mm: 69 });
    await act('add_figure_panel', { figure: 'Figure 1', kind: 'compare', a: 'Run 1', b: 'AlphaMissense', plot: 'classes', x_mm: 62, y_mm: 106, width_mm: 60, height_mm: 69 });
    await act('add_figure_panel', { figure: 'Figure 1', kind: 'qc', subject: 'Run 1', finding: 'agreement', x_mm: 125, y_mm: 106, width_mm: 46, height_mm: 69 });
    await act('set_figure', { figure: 'Figure 1', panels: [{ panel: 'C', title: 'Scores by AlphaMissense class' }, { panel: 'D', title: 'Replicates 1 and 2' }] });
    console.log(JSON.stringify((await act('figures', { figure: 'Figure 1' })).data.figures[0].panels.map((p) => [p.letter, p.notes])));
    // The figure as MaveScape exports it, for the site (the same white page in either theme): a PNG
    // at 200 dpi, its manifest in it, so that the file the site shows can be dropped on MaveScape.
    if (shots) await act('export_figure', { figure: 'Figure 1', format: 'png', dpi: 200, path: join(IMAGES, 'figure-export.png'), overwrite: true });
    await js(`(() => { window.mavescape.figuresView = { figure: window.mavescape.store.ws.figures[0].id, panel: null }; window.mavescape.store.notify(['ws']); })()`);
    await act('set_mode', { mode: 'figures' });
    await sleep(1500);
  },
  // The report (wave 6, slice 4): GRB2's run and its Enrich2 rescoring, their comparison added to
  // the report; the Report view at the end of its scoring, the parameters of both runs side by side.
  async report() {
    await example('grb2-sh3');
    await act('score', { preset: 'Enrich2' });
    await act('compare', { a: 'Run 1', b: 'Run 2', report: true });
    await act('report');
    await sleep(1500);
    await js(`document.querySelector('.report-doc .report-table')?.scrollIntoView({ block: 'end' })`);
    await sleep(500);
  },
  // Checkpoints (wave 6, slice 5): GRB2's run kept as a checkpoint, then scored again with a
  // pseudocount of 1 and a minimum input count of 10; the Report view with the changes since.
  async 'report-changes'() {
    await example('grb2-sh3');
    await act('checkpoint', { name: 'Before the rescoring' });
    await act('score', { parameters: { pseudocount: 1, filters: { minInputCount: 10 } } });
    await act('diff');
    await sleep(1500);
  },
  // Certificates (wave 6, slice 6): GRB2's run and its Enrich2 rescoring certified, the certificate
  // verified; the Report view with its Certificate pane and the verification's details.
  async certificate() {
    await example('grb2-sh3');
    await act('score', { preset: 'Enrich2' });
    const path = join(temp, 'grb2.certificate.msz');
    await act('certify', { path, overwrite: true });
    await act('verify_certificate', { paths: [path] });
    await sleep(1000);
    await clearToasts();
    await click('Details');
    await sleep(600);
  },
  // The review report (wave 6, slice 7): GRB2's run, its Enrich2 rescoring and their comparison,
  // written as a review report and opened from its file; a run's numbers, a variant looked up and a
  // number traced.
  async review() {
    await example('grb2-sh3');
    await act('score', { preset: 'Enrich2' });
    await act('compare', { a: 'Run 1', b: 'Run 2', report: true });
    const path = join(temp, 'grb2.review.html');
    await act('review_report', { path, overwrite: true });
    await js('window.mavescape.saveNow()');
    await b.goto(`file://${path}`, 1200);
    await js(`(() => {
      document.documentElement.style.scrollBehavior = 'auto';
      document.getElementById('lookup-variant').value = 'p.Trp36Ala';
      document.getElementById('lookup-go').click();
      window.scrollTo(0, document.getElementById('runs').getBoundingClientRect().top + window.scrollY - 12);
      document.querySelector('#lookup-result button.n').click();
    })()`);
    await sleep(500);
  },
  // The wave's lessons on the examples (wave 6, slice 8). GRB2's figure: the variance beyond
  // counting acknowledged, then Run 1's map, the view Core of 2VWF and the finding on one page.
  async 'grb2-figure'() {
    await example('grb2-sh3');
    await act('acknowledge_finding', { finding: 'excess-variance', run: 'Run 1', reason: 'The input bottleneck the Domainome\'s own analysis found (DiMSum\'s error model puts it at the input)' });
    await act('open_structure', { pdb: '2VWF' });
    await act('set_structure', { color: 'median', select: 'byres (chain A and protein and within 4 of (chain B and protein))', show: 'sticks' });
    await act('set_structure', { select: '' });
    await sleep(1500);
    await act('save_structure_view', { name: 'Core' });
    // The page and panels as validation/example-lessons.mjs lays them out (GRB2_FIGURE).
    await act('create_figure', { name: 'GRB2 SH3', size: 'double', height_mm: 186 });
    await act('add_figure_panel', { figure: 'GRB2 SH3', run: 'Run 1', tracks: ['reference', 'effect'], x_mm: 3, y_mm: 3, width_mm: 168, height_mm: 92 });
    await act('add_figure_panel', { figure: 'GRB2 SH3', kind: 'structure', view: 'Core', x_mm: 3, y_mm: 98, width_mm: 62, height_mm: 85 });
    await act('add_figure_panel', { figure: 'GRB2 SH3', kind: 'qc', subject: 'Run 1', finding: 'excess-variance', x_mm: 68, y_mm: 98, width_mm: 103, height_mm: 85 });
    await js(`(() => { window.mavescape.figuresView = { figure: window.mavescape.store.ws.figures[0].id, panel: 'panel-3' }; window.mavescape.store.notify(['ws']); })()`);
    await sleep(1500);
  },
  // Hsp90's checkpoint: Run 2 over the whole time course, a checkpoint, the columns of generations
  // 9 to 21 "Not used" and scored again; the Report view with what changed and its map.
  async 'hsp90-checkpoint'() {
    await example('hsp90');
    await act('score', { parameters: { timeScale: 'course' } });
    await act('checkpoint', { name: 'All eight samples' });
    let design = JSON.parse(await js('JSON.stringify(window.mavescape.store.ws.design)'));
    for (const column of ['Gen_9', 'Gen_12', 'Gen_15', 'Gen_18', 'Gen_21']) design = assignColumn(design, column, { kind: 'ignored', reason: 'not used: the first three samples fitted, as the authors fit null-like variants' }).design;
    await act('set_design', { design });
    await act('score', { parameters: { timeScale: 'course' } });
    await act('diff');
    await sleep(1500);
  },
  // The BRCA1 RING domain certified without its tables, then verified with MaveDB's two files
  // beside it, as a reviewer would; the Certificate pane and the verification's details.
  async 'brca1-ring-certificate'() {
    await example('brca1-ring');
    await act('score', { preset: 'enrich2' });
    const path = join(temp, 'brca1-ring.certificate.msz');
    await act('certify', { path, tables: false, overwrite: true });
    const [, dir] = MAVEDB_TABLES.find(([urn]) => urn === 'urn:mavedb:00000003-a-2');
    await act('verify_certificate', { paths: [path, join(dir, 'scores.csv'), join(dir, 'counts.csv')], library: false });
    await sleep(1000);
    await clearToasts();
    await click('Details');
    await sleep(600);
  },
  // An AI agent's proposal, reviewed (wave 7, slice 5): the strip above the view opened on what
  // Claude Code made (a run and a selection, marked proposed in the dataset tree) and what waits
  // for the person (the acknowledgement, which the QC view also shows).
  async 'agent-proposal'() {
    await agentOnGRB2();
    await click('Review', '.proposal-strip button');
    await sleep(600);
  },
  // The guide's session on Hsp90: the design the agent proposed, in Experiment beside the person's,
  // and the strip reviewed.
  async 'agent-hsp90'() {
    await agentOnHsp90();
    await click('Review', '.proposal-strip button');
    await sleep(600);
  },
  // The same proposal accepted: the history, newest first, with the person's decision, the
  // acknowledgement applied under the agent's name, and what the agent did before it.
  async 'agent-accepted'() {
    await agentOnGRB2();
    await click('Accept all', '.proposal-strip button');
    await js(`window.mavescape.toggleDrawer(true, 'history')`);
    await sleep(800);
  },
  // The record: a run's exports, from the workflow strip.
  async record() {
    await example('grb2-sh3');
    await act('set_mode', { mode: 'score' });
    await click('Export…');
    await sleep(500);
  },
};

// --- Run ------------------------------------------------------------------------------------------

// axe-core in the page: violations of the WCAG 2.1 A and AA rules, with up to five elements each.
async function runAxe() {
  await js(`if (!window.axe) (0, eval)(${JSON.stringify(readFileSync(AXE, 'utf8'))});`);
  return js(`(async () => {
    const result = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] });
    return result.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 5).map((n) => ({ target: n.target.join(' '), summary: n.failureSummary?.split('\\n').slice(0, 3).join(' ') })), count: v.nodes.length }));
  })()`);
}
const audits = [];
const AUDIT_FILE = join(ROOT, 'docs/capture/audit.json');

// Scene names, from the definitions in this file: in an object literal a repeated name silently
// replaces the scene before it, and its pictures overwrite the other's.
{
  const source = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const block = source.slice(source.indexOf('const scenes = {'), source.indexOf('\n};\n', source.indexOf('const scenes = {')));
  const defined = [...block.matchAll(/^ {2}async '?([\w-]+)'?\(\) \{/gm)].map((m) => m[1]);
  const repeated = defined.filter((name, i) => defined.indexOf(name) !== i);
  if (repeated.length) throw new Error(`Scenes defined twice: ${[...new Set(repeated)].join(', ')}. Rename one: a scene's name is the name of its pictures.`);
  if (defined.length !== Object.keys(scenes).length) throw new Error(`Found ${defined.length} scene definitions but ${Object.keys(scenes).length} scenes; keep each scene as "  async name() {" so they can be checked.`);
}

const names = wanted.length ? wanted : Object.keys(scenes);
for (const name of names) if (!scenes[name]) throw new Error(`Unknown scene ${name}. Scenes: ${Object.keys(scenes).join(', ')}`);
mkdirSync(IMAGES, { recursive: true });
await new Promise((done, fail) => spawn('go', ['build', '-o', binary, '.'], { cwd: ROOT, stdio: 'inherit' }).on('exit', (code) => (code ? fail(new Error('go build failed (is Go installed?)')) : done())));
try {
  for (const theme of themes) {
    for (const name of names) {
      let maveScape = null;
      b = null;
      try {
        maveScape = await startMaveScape({ agent: AGENT_SCENES.has(name) });
        // A Chrome that does not start (its debugging connection not opened) is started again
        // once; a scene that cannot start fails alone, not the scenes after it.
        b = await launch().catch(async () => {
          await sleep(2000);
          return launch();
        });
        await b.theme(theme === 'dark');
        await b.goto(URL, 800);
        await waitFor('Boolean(window.mavescape?.remote)', 30000);
        // The default library location rather than this run's temporary one, and no commit.
        await js(`(() => { const app = window.mavescape; app.library.location = ${JSON.stringify(LIBRARY_SHOWN)}; app.commit = ''; app.store.notify(['library']); })()`);
        await scenes[name]();
        await clearToasts();
        await sleep(600);
        if (shots) await b.capture(join(IMAGES, `${name}-${theme}.webp`), { format: 'webp', quality: 86 });
        if (audit && !(await js('Boolean(window.mavescape)'))) console.log(`${name} (${theme}): not MaveScape's page, not audited`);
        else if (audit) {
          const found = await runAxe();
          audits.push({ scene: name, theme, violations: found });
          console.log(`${name} (${theme}): ${found.length ? found.map((v) => `${v.id} ×${v.count} (${v.impact})`).join(', ') : 'no violations'}`);
        } else console.log(`${name} (${theme})`);
      } catch (error) {
        console.error(`${name} (${theme}) failed: ${error.message}`);
        process.exitCode = 1;
      } finally {
        await b?.close();
        await maveScape?.stop();
        for (const after of afterScene.splice(0)) await after();
      }
    }
  }
} finally {
  rmSync(temp, { recursive: true, force: true });
  if (audit) {
    // Merged with the audits of the scenes not run now; scenes that no longer exist are dropped.
    let previous = [];
    try {
      previous = JSON.parse(readFileSync(AUDIT_FILE, 'utf8'));
    } catch { /* none yet */ }
    const key = (a) => `${a.scene}|${a.theme}`;
    const fresh = new Map(audits.map((a) => [key(a), a]));
    const order = Object.keys(scenes);
    const merged = [...previous.filter((a) => !fresh.has(key(a)) && scenes[a.scene]), ...audits]
      .sort((a, c) => order.indexOf(a.scene) - order.indexOf(c.scene) || a.theme.localeCompare(c.theme));
    writeFileSync(AUDIT_FILE, `${JSON.stringify(merged, null, 1)}\n`);
    const failing = merged.filter((a) => a.violations.length);
    console.log(`\naxe-core: ${audits.length} scene captures; docs/capture/audit.json: ${merged.length} captures of ${order.length} scenes, ${failing.length} with violations${failing.length ? ` (${failing.slice(0, 6).map((a) => `${a.scene} ${a.theme}`).join(', ')})` : ''}.`);
  }
}
