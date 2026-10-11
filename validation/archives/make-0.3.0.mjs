// Writes workspace archives with MaveScape 0.3.0 itself (run from a v0.3.0 checkout), so that later
// versions must reopen them and reproduce their runs (roadmap, "In every wave"). 0.3 brought public
// data in and out, which the window opens and keeps: the program is built from the checkout, its
// page opened in a headless browser with a fixed clock, and driven through its remote control as
// any script drives it, offline, on the public data the validation keeps (the fetcher's cached
// answers, validation/fixtures/public-data, and MaveDB's tables, validation/cache). Each workspace
// opened from MaveDB is a workspace of its own, so 0.3 leaves three archives:
//   - release-0.3.0-grb2-mavedb.msz: GRB2's SH3 domain opened from MaveDB (urn:mavedb:00000835-a-1):
//     the record, its published scores read as published, MaveDB's mapped variants kept, its
//     counts with the design drafted from their names, scored; the target checked against UniProt
//     P62993; every public annotation (UniProt's features, PDBe-KB's conservation, AlphaMissense,
//     ClinVar, gnomAD) and two files (an alignment, a GFF3) beside the map, arranged and filtered;
//     a selection and an acknowledged finding;
//   - release-0.3.0-dhfr-together.msz: DHFR without and with Lon, two score sets opened together
//     (the dhfr-lon example): both records, each one's published scores a run, their counts
//     joined, the paper's design (two tiles grown in each sample, time in hours), Run 1 comparing
//     the conditions (independent); a selection and an acknowledged finding;
//   - release-0.3.0-brca1-sge.msz: BRCA1's saturation genome editing (the brca1-sge example): a
//     target from NCBI's RefSeq transcript, nucleotide variants read at the protein level, its
//     counts scored with the design drafted from their names, MaveDB's own annotations and gnomAD
//     beside the map; a selection and an acknowledged finding.
// Each archive is then reopened in Node, and each of its runs recomputed from its own files to its
// recorded output hash.
//
// Usage: node make-0.3.0.mjs <v0.3.0 checkout> <out folder> [commit]
// Without a commit, the program records the one it was built from, as Go stamps it ("-dirty" when
// the checkout had changes not yet committed: 0.3.0's were saved before its release commit).
// Needs Go, Chrome, Chromium, Edge or Brave (CHROME=path), and MaveDB's tables in the checkout's
// validation/cache (node validation/fetch.mjs mavedb-dhfr mavedb-brca1-sge).
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [rootArg, outArg, commit = ''] = process.argv.slice(2);
if (!rootArg || !outArg) throw new Error('Usage: node make-0.3.0.mjs <v0.3.0 checkout> <out folder> [commit]');
const root = resolve(rootArg);
const outDir = resolve(outArg);
const lib = (p) => import(pathToFileURL(join(root, p)).href);
const { launch, sleep } = await lib('docs/capture/cdp.mjs');
const { readArchive } = await lib('web/lib/archive.js');
const { outputDigest, reproduction } = await lib('web/lib/runs.js');
const { recompute } = await lib('validation/roundtrip-cases.mjs');

const CLOCK = '2026-10-11T18:00:00.000Z';
const PORT = 8838;
const TABLES = [
  ['urn:mavedb:00000063-b-1', 'mavedb-dhfr/minus-lon'],
  ['urn:mavedb:00000063-a-1', 'mavedb-dhfr/plus-lon'],
  ['urn:mavedb:00000097-0-2', 'mavedb-brca1-sge'],
];
mkdirSync(outDir, { recursive: true });
const temp = mkdtempSync(join(tmpdir(), 'mavescape-release-'));
const library = join(temp, 'library');
const cache = join(temp, 'cache');

// The fetcher's cache: its answers as the validation keeps them, and MaveDB's tables with the
// retrieval record the fetcher writes.
cpSync(join(root, 'validation/fixtures/public-data'), cache, { recursive: true });
for (const [urn, dir] of TABLES) {
  for (const table of ['scores', 'counts']) {
    const from = join(root, 'validation/cache', dir, `${table}.csv`);
    if (!existsSync(from)) throw new Error(`${from} is missing: node validation/fetch.mjs ${dir.split('/')[0]}`);
    const name = `${urn.replaceAll(':', '_')}.${table}.csv`;
    cpSync(from, join(cache, 'mavedb', name));
    writeFileSync(join(cache, 'mavedb', `${name}.meta.json`), `${JSON.stringify({ contentType: 'text/csv; charset=utf-8', service: 'MaveDB', source: `https://api.mavedb.org/api/v1/score-sets/${urn}/${table}`, retrieved: '2026-10-11T16:30:00Z' }, null, 2)}\n`);
  }
}

// MaveScape 0.3.0, built from the checkout, offline on that cache.
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
  const response = await fetch(`${URL}api/remote/action`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-MaveScape-Token': token }, body: JSON.stringify({ action, args, client: 'make-0.3.0' }) });
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

  console.log('GRB2 SH3, from MaveDB');
  await act('open_mavedb', { urn: 'urn:mavedb:00000835-a-1', mapped: true });
  // The published scores are the first run: this one is named after it.
  let run = (await act('score', {})).data.name;
  await act('check_target', { apply: true });
  for (const provider of ['uniprot-features', 'pdbe-conservation', 'alphamissense', 'clinvar', 'gnomad']) await act('add_track', { provider, run });
  for (const file of ['grb2-sh3.sto', 'P62993.gff']) await act('add_track', { name: file, text: readFileSync(join(root, 'validation/fixtures/annotations', file), 'utf8'), run });
  await act('set_track', { track: 'ClinVar', position: 1, run });
  await act('set_track', { track: 'gnomAD', filter: { min: 1e-5 }, run });
  await act('select_variants', { positions: [36], filter: 'scored', save_as: 'Position 36', run });
  await act('acknowledge_finding', { finding: 'excess-variance', reason: 'The input bottleneck the Domainome\'s own analysis reported', run });
  await save('release-0.3.0-grb2-mavedb.msz');

  console.log('DHFR without and with Lon, opened together');
  await act('open_example', { id: 'dhfr-lon' });
  await act('select_variants', { positions: [20], filter: 'scored', save_as: 'The Met20 loop\'s Met20', run: 'Run 1', condition: '+Lon' });
  await act('acknowledge_finding', { finding: 'excess-variance', reason: 'Each repeat grown and sequenced apart, over 18 hours', run: 'Run 1' });
  await save('release-0.3.0-dhfr-together.msz');

  console.log('BRCA1 saturation genome editing');
  await act('open_example', { id: 'brca1-sge' });
  run = (await act('score', {})).data.name;
  for (const provider of ['mavedb-annotations', 'gnomad']) await act('add_track', { provider, run });
  await act('select_variants', { positions: [1853], save_as: 'Tyr1853', run });
  await act('acknowledge_finding', { finding: 'coverage', reason: 'Only 13 exons were edited', run });
  await save('release-0.3.0-brca1-sge.msz');
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
    const verdict = scored.ok ? reproduction(run, outputDigest(scored.results), '0.3.0') : { status: scored.errors[0] };
    if (verdict.status !== 'reproduced') failed += 1;
    lines.push(`${run.name} ${run.output.sha256.slice(0, 12)} ${verdict.status}`);
  }
  console.log(`${path}: ${readFileSync(path).length} bytes; ${opened.problems.length ? opened.problems.join(' ') : 'no problems'}; ${opened.ws.sources.length} tables, ${(opened.ws.annotations ?? []).length} annotations; ${lines.join(', ')}`);
}
if (failed) throw new Error(`${failed} runs not reproduced`);
