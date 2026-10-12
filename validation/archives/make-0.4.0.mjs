// Writes workspace archives with MaveScape 0.4.0 itself (run from a v0.4.0 checkout), so that later
// versions must reopen them, reproduce their runs, read again what they keep beside them and make
// their selections again (roadmap, "In every wave"). 0.4 brought comparison: a comparison is the
// session's, but what it rests on is the workspace's, and these archives keep it. The program is
// built from the checkout, its page opened in a headless browser with a fixed clock, and driven
// through its remote control as any script drives it, offline, on the public data the validation
// keeps (the fetcher's cached answers, validation/fixtures/public-data, and MaveDB's tables,
// validation/cache):
//   - release-0.4.0-tp53-screens.msz: the TP53 example (urn:mavedb:00000068-c-1, its published
//     scores), its target checked against UniProt P04637 (P72R); Kotler et al.'s screen of the
//     DNA-binding domain and Giacomelli et al.'s nutlin-3 screen kept beside it by URN, each with
//     the direction stated (Kotler et al.'s protein variants on several rows merged as read); a
//     selection by query, another made from it by a set operation; an acknowledged finding;
//   - release-0.4.0-grb2-compare.msz: GRB2's SH3 domain (the bundled example), Run 1 and Run 2
//     (the Enrich2-compatible preset); its record's published scores kept beside by URN,
//     AlphaMissense and UniProt's features beside the map; selections by query (a feature's
//     positions, an operation on a saved selection, the robustness verdicts of Run 1's check); an
//     acknowledged finding.
// Each archive is then reopened in Node, and each of its runs recomputed from its own files to its
// recorded output hash.
//
// Usage: node make-0.4.0.mjs <v0.4.0 checkout> <out folder> [commit]
// Without a commit, the program records the one it was built from, as Go stamps it ("-dirty" when
// the checkout had changes not yet committed: 0.4.0's are saved before its release commit, as
// 0.3.0's were). Needs Go, Chrome, Chromium, Edge or Brave (CHROME=path), and MaveDB's tables in
// the checkout's validation/cache (node validation/fetch.mjs mavedb-tp53-screens).
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [rootArg, outArg, commit = ''] = process.argv.slice(2);
if (!rootArg || !outArg) throw new Error('Usage: node make-0.4.0.mjs <v0.4.0 checkout> <out folder> [commit]');
const root = resolve(rootArg);
const outDir = resolve(outArg);
const lib = (p) => import(pathToFileURL(join(root, p)).href);
const { launch, sleep } = await lib('docs/capture/cdp.mjs');
const { readArchive } = await lib('web/lib/archive.js');
const { outputDigest, reproduction } = await lib('web/lib/runs.js');
const { recompute } = await lib('validation/roundtrip-cases.mjs');

const CLOCK = '2026-10-11T22:00:00.000Z';
const PORT = 8840;
// MaveDB's tables the archives' score sets come from, as the validation keeps them.
const TABLES = [
  ['urn:mavedb:00000068-c-1', 'mavedb-tp53-screens/scores.csv'],
  ['urn:mavedb:00000068-b-1', 'mavedb-tp53-screens/nutlin.csv'],
  ['urn:mavedb:00000059-a-1', 'mavedb-tp53-screens/kotler.csv'],
];
mkdirSync(outDir, { recursive: true });
const temp = mkdtempSync(join(tmpdir(), 'mavescape-release-'));
const library = join(temp, 'library');
const cache = join(temp, 'cache');

// The fetcher's cache: its answers as the validation keeps them (GRB2's record and its scores are
// among them), and MaveDB's tables with the retrieval record the fetcher writes.
cpSync(join(root, 'validation/fixtures/public-data'), cache, { recursive: true });
for (const [urn, file] of TABLES) {
  const from = join(root, 'validation/cache', file);
  if (!existsSync(from)) throw new Error(`${from} is missing: node validation/fetch.mjs ${file.split('/')[0]}`);
  const name = `${urn.replaceAll(':', '_')}.scores.csv`;
  cpSync(from, join(cache, 'mavedb', name));
  writeFileSync(join(cache, 'mavedb', `${name}.meta.json`), `${JSON.stringify({ contentType: 'text/csv; charset=utf-8', service: 'MaveDB', source: `https://api.mavedb.org/api/v1/score-sets/${urn}/scores`, retrieved: '2026-10-12T01:15:25Z' }, null, 2)}\n`);
}

// MaveScape 0.4.0, built from the checkout, offline on that cache.
const binary = join(temp, process.platform === 'win32' ? 'mavescape.exe' : 'mavescape');
await new Promise((done, fail) => spawn('go', ['build', ...(commit ? ['-ldflags', `-X main.commit=${commit}`] : []), '-o', binary, '.'], { cwd: root, stdio: 'inherit' }).on('exit', (code) => (code ? fail(new Error('go build failed')) : done())));
const server = spawn(binary, ['--remote-control', '--window', 'none', '--port', String(PORT), '--data-dir', library, '--offline', '--cache-dir', cache], { cwd: temp, stdio: ['ignore', 'pipe', 'inherit'] });
let banner = '';
server.stdout.on('data', (chunk) => { banner += chunk; });
let URL = '';
for (let i = 0; i < 300 && !URL; i += 1) {
  const address = /running at (http:\/\/[\d.]+:\d+)/.exec(banner)?.[1];
  if (address && existsSync(join(library, 'remote.json'))) URL = `${address}/`;
  else await sleep(200);
}
if (!URL) throw new Error(`MaveScape did not start:\n${banner}`);
const token = JSON.parse(readFileSync(join(library, 'remote.json'), 'utf8')).token;

async function act(action, args = {}) {
  const response = await fetch(`${URL}api/remote/action`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-MaveScape-Token': token }, body: JSON.stringify({ action, args, client: 'make-0.4.0' }) });
  const result = await response.json();
  if (!result.ok) throw new Error(`${action} ${JSON.stringify(args).slice(0, 200)}: ${result.message ?? result.error}`);
  console.log(`  ${action}: ${String(result.message).slice(0, 160)}`);
  return result;
}

const browser = await launch({ width: 1440, height: 900, scale: 1 });
const errors = [];
browser.on('Runtime.exceptionThrown', (e) => errors.push(e.exceptionDetails?.exception?.description ?? e.exceptionDetails?.text));
const written = [];
try {
  await browser.goto(`${URL}?clock=${CLOCK}`, 1500);
  for (let i = 0; i < 100 && !(await browser.eval('Boolean(window.mavescape?.remote)')); i += 1) await sleep(100);
  await sleep(500);
  const save = async (file) => {
    const path = join(outDir, file);
    await act('export', { what: 'archive', path, overwrite: true });
    written.push(path);
  };

  console.log('TP53, two screens on two scales');
  await act('open_example', { id: 'tp53-screens' });
  await act('check_target', { accession: 'P04637', apply: true });
  await act('compare', { a: 'Published scores', b: 'urn:mavedb:00000059-a-1', direction: 'higher-less', scale: 'synonymous-nonsense' });
  await act('compare', { a: 'Published scores', b: 'urn:mavedb:00000068-b-1', direction: 'higher-less', scale: 'synonymous-nonsense' });
  await act('select_variants', { query: 'missense from R at 175,248,249,273,282 with score < -1', save_as: 'Hotspot arginines, lost', run: 'Published scores' });
  await act('select_variants', { query: 'to H', operation: 'intersect', save_as: 'Hotspot arginines to histidine, lost', run: 'Published scores' });
  await act('acknowledge_finding', { finding: 'separation', reason: 'Z-scores of growth under etoposide, as published: no standard errors to separate the controls by', run: 'Published scores' });
  await save('release-0.4.0-tp53-screens.msz');

  console.log('GRB2 SH3, compared');
  await act('open_example', { id: 'grb2-sh3' });
  await act('score', { preset: 'enrich2' });
  await act('compare', { a: 'Run 1', b: 'urn:mavedb:00000835-a-1', direction: 'higher-more', scale: 'nonsense-wt' });
  for (const provider of ['alphamissense', 'uniprot-features']) await act('add_track', { provider, run: 'Run 1' });
  await act('select_variants', { query: 'missense in feature strand with se < 0.2', save_as: 'Strands, well measured', run: 'Run 1' });
  await act('select_variants', { query: 'in "Strands, well measured" and not lower', save_as: 'Strands, not lower', run: 'Run 1' });
  await act('check_robustness', { run: 'Run 1' });
  await act('select_variants', { query: 'lower and not robust', save_as: 'Lower, depending on the analysis', run: 'Run 1' });
  await act('acknowledge_finding', { finding: 'excess-variance', reason: 'The input bottleneck the Domainome\'s own analysis reported', run: 'Run 1' });
  await save('release-0.4.0-grb2-compare.msz');
  if (errors.length) throw new Error(`The page threw: ${errors[0]}`);
} finally {
  await browser.close();
  server.kill();
  await sleep(500);
  rmSync(temp, { recursive: true, force: true });
}

// Each archive reopened in Node, each run recomputed from the archive's files.
let failed = 0;
for (const path of written) {
  const opened = await readArchive(new Uint8Array(readFileSync(path)));
  const lines = [];
  for (const [index, run] of opened.ws.runs.entries()) {
    const { scored } = recompute(opened.ws, opened.sources, index);
    const verdict = scored.ok ? reproduction(run, outputDigest(scored.results), '0.4.0') : { status: scored.errors[0] };
    if (verdict.status !== 'reproduced') failed += 1;
    lines.push(`${run.name} ${run.output.sha256.slice(0, 12)} ${verdict.status}`);
  }
  console.log(`${path}: ${readFileSync(path).length} bytes; ${opened.problems.length ? opened.problems.join(' ') : 'no problems'}; ${opened.ws.sources.length} tables, ${(opened.ws.annotations ?? []).length} annotations, ${opened.ws.selections.length} selections (${opened.ws.selections.map((s) => `${s.name}: ${s.keys.length}${s.query ? ` by "${s.query}"` : ''}`).join('; ')}); ${lines.join(', ')}`);
}
if (failed) throw new Error(`${failed} runs not reproduced`);
