// Writes workspace archives with MaveScape 0.5.0 itself (run from a v0.5.0 checkout), so that later
// versions must reopen them, reproduce their runs and draw their saved views again (roadmap, "In
// every wave"). 0.5 brought protein structure: a view of a structure saved with the workspace, its
// structure's file kept in the archive or named by its ID and SHA-256 only. The program is built
// from the checkout, its page opened in a headless browser with a fixed clock, and driven through
// its remote control as any script drives it, offline, on the public data the validation keeps (the
// fetcher's cached answers, validation/fixtures/public-data, and MaveDB's tables, validation/cache):
//   - release-0.5.0-grb2-structures.msz: GRB2's SH3 domain (the bundled example), Run 1; three saved
//     views, their structures' files in the archive: 2VWF colored by the median score, residues
//     drawn as sticks and labeled ("Core"); 2VWF by structural class, the peptide's first residues
//     hidden ("Classes"); GRB2's AlphaFold DB model by the median, with its aligned error ("Model");
//   - release-0.5.0-pten-structures.msz: PTEN's VAMP-seq scores from MaveDB (urn:mavedb:00000013-a-1);
//     two views of 1D5R, by the fraction abnormal-like of its published ExCALIBR calibration
//     ("Abnormal-like") and by structural class ("Burial"), the structure named by its ID and
//     SHA-256 only, so that a later version fetches it again.
// Each archive is then reopened in Node, each of its runs recomputed from its own files to its
// recorded output hash, and each saved view's structure read again and its target mapped again as
// the view was saved.
//
// Usage: node make-0.5.0.mjs <v0.5.0 checkout> <out folder> [commit]
// Without a commit, the program records the one it was built from, as Go stamps it ("-dirty" when
// the checkout had changes not yet committed: 0.5.0's are saved before its release commit, as
// 0.4.0's were). Needs Go, Chrome, Chromium, Edge or Brave (CHROME=path), and MaveDB's table in the
// checkout's validation/cache (node validation/fetch.mjs mavedb-pten-vampseq).
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [rootArg, outArg, commit = ''] = process.argv.slice(2);
if (!rootArg || !outArg) throw new Error('Usage: node make-0.5.0.mjs <v0.5.0 checkout> <out folder> [commit]');
const root = resolve(rootArg);
const outDir = resolve(outArg);
const lib = (p) => import(pathToFileURL(join(root, p)).href);
const { launch, sleep } = await lib('docs/capture/cdp.mjs');
const { readArchive } = await lib('web/lib/archive.js');
const { outputDigest, reproduction } = await lib('web/lib/runs.js');
const { recompute } = await lib('validation/roundtrip-cases.mjs');
const { replayStructureViews } = await lib('validation/structure-cases.mjs');

const CLOCK = '2026-10-12T22:00:00.000Z';
const PORT = 8850;
// MaveDB's tables the archives' score sets come from, as the validation keeps them.
const TABLES = [['urn:mavedb:00000013-a-1', 'mavedb-pten-vampseq/scores.csv', '2026-10-11T02:24:52Z']];
mkdirSync(outDir, { recursive: true });
const temp = mkdtempSync(join(tmpdir(), 'mavescape-release-'));
const library = join(temp, 'library');
const cache = join(temp, 'cache');

// The fetcher's cache: its answers as the validation keeps them (GRB2's record and its scores are
// among them), and MaveDB's tables with the retrieval record the fetcher writes.
cpSync(join(root, 'validation/fixtures/public-data'), cache, { recursive: true });
for (const [urn, file, retrieved] of TABLES) {
  const from = join(root, 'validation/cache', file);
  if (!existsSync(from)) throw new Error(`${from} is missing: node validation/fetch.mjs ${file.split('/')[0]}`);
  const name = `${urn.replaceAll(':', '_')}.scores.csv`;
  cpSync(from, join(cache, 'mavedb', name));
  writeFileSync(join(cache, 'mavedb', `${name}.meta.json`), `${JSON.stringify({ contentType: 'text/csv; charset=utf-8', service: 'MaveDB', source: `https://api.mavedb.org/api/v1/score-sets/${urn}/scores`, retrieved }, null, 2)}\n`);
}

// MaveScape 0.5.0, built from the checkout, offline on that cache, not looking for Proteoscope.
const binary = join(temp, process.platform === 'win32' ? 'mavescape.exe' : 'mavescape');
await new Promise((done, fail) => spawn('go', ['build', ...(commit ? ['-ldflags', `-X main.commit=${commit}`] : []), '-o', binary, '.'], { cwd: root, stdio: 'inherit' }).on('exit', (code) => (code ? fail(new Error('go build failed')) : done())));
const server = spawn(binary, ['--remote-control', '--window', 'none', '--port', String(PORT), '--data-dir', library, '--offline', '--cache-dir', cache, '--proteoscope', 'off'], { cwd: temp, stdio: ['ignore', 'pipe', 'inherit'] });
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
  const response = await fetch(`${URL}api/remote/action`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-MaveScape-Token': token }, body: JSON.stringify({ action, args, client: 'make-0.5.0' }) });
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
  const save = async (file, args = {}) => {
    const path = join(outDir, file);
    await act('export', { what: 'archive', path, overwrite: true, ...args });
    written.push(path);
  };

  console.log('GRB2 SH3, three views of its structures');
  await act('open_example', { id: 'grb2-sh3' });
  await act('open_structure', { pdb: '2VWF' });
  await act('set_structure', { color: 'median', select: 'pos 20-26', show: 'sticks' });
  await act('set_structure', { select: 'pos 21+25', label: true });
  await act('save_structure_view', { name: 'Core' });
  await act('structure_evidence');
  await act('set_structure', { color: 'class', select: 'chain B and resi 1-3', show: 'hide' });
  await act('save_structure_view', { name: 'Classes' });
  await act('open_structure', { alphafold: 'target' });
  await act('set_structure', { color: 'median' });
  await act('save_structure_view', { name: 'Model' });
  await save('release-0.5.0-grb2-structures.msz');

  console.log('PTEN, its structure named by checksum');
  await act('open_example', { id: 'pten-mavedb' });
  await act('open_structure', { pdb: '1D5R' });
  await act('set_structure', { color: 'fraction', calibration: 'ExCALIBR calibration' });
  await act('save_structure_view', { name: 'Abnormal-like' });
  await act('structure_evidence');
  await act('set_structure', { color: 'class' });
  await act('save_structure_view', { name: 'Burial' });
  await save('release-0.5.0-pten-structures.msz', { include_structures: false });
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
    const verdict = scored.ok ? reproduction(run, outputDigest(scored.results), '0.5.0') : { status: scored.errors[0] };
    if (verdict.status !== 'reproduced') failed += 1;
    lines.push(`${run.name} ${run.output.sha256.slice(0, 12)} ${verdict.status}`);
  }
  const views = await replayStructureViews(opened.ws, opened.sources);
  failed += views.filter((x) => !x.ok).length;
  console.log(`${path}: ${readFileSync(path).length} bytes; structures ${opened.manifest.structures}; ${opened.problems.length ? opened.problems.join(' ') : 'no problems'}; ${opened.ws.sources.length} tables, ${(opened.ws.structures ?? []).length} structures, views ${views.map((x) => `${x.view} (${x.structure} ${x.from}${x.ok ? '' : `: ${x.why}`})`).join(', ')}; ${lines.join(', ')}`);
}
if (failed) throw new Error(`${failed} runs not reproduced or views not drawn again`);
