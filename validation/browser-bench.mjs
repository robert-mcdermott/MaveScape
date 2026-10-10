// The million-row import in the window (requirement D9): MaveScape built from source and driven by
// remote control in headless Chrome, as validation/bench.mjs's import in Node but end to end: a
// simulated table of a million barcodes in two libraries and its million-line barcode-to-variant
// map opened together (the hub serves the files, the csv worker reads them in 16 MB parts, the
// window assembles and reviews them and keeps them in the library), then scored summed and by
// barcode. The memory is the browser's, all its processes together (the page, its workers, the
// GPU and the browser itself), sampled every 100 ms, over what it held before the import.
//
//   node validation/browser-bench.mjs
//
// Needs Go and Chrome, Chromium, Edge or Brave (CHROME=path). Exits with status 1 when the import
// takes more than 15 s or raises the browser's memory by more than 1 GB.

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, sleep } from '../docs/capture/cdp.mjs';
import { simulateExperiment } from '../web/lib/simulate.js';
import { createRandom } from '../web/lib/random.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8837;
const temp = mkdtempSync(join(tmpdir(), 'mavescape-browser-bench-'));
const library = join(temp, 'library');

// The files: the same simulation as bench.mjs's.
const random = createRandom(4000);
const aa = 'ACDEFGHIKLMNPQRSTVWY';
const protein = `M${Array.from({ length: 1599 }, () => aa[random.int(20)]).join('')}`;
let rows;
{
  const sim = simulateExperiment({ seed: 4000, protein, replicates: 2, barcodes: { perVariant: 15, wildType: 200, readsPerBarcode: 40 } });
  writeFileSync(join(temp, 'counts.csv'), sim.csv);
  writeFileSync(join(temp, 'map.csv'), sim.map);
  writeFileSync(join(temp, 'gene.fasta'), `>gene Simulated gene\n${sim.design.targets[0].sequence}\n`);
  rows = sim.barcodes.length;
}

const binary = join(temp, 'mavescape');
await new Promise((done, fail) => spawn('go', ['build', '-o', binary, '.'], { cwd: ROOT, stdio: 'inherit' }).on('exit', (code) => (code ? fail(new Error('go build failed')) : done())));
const server = spawn(binary, ['--remote-control', '--window', 'none', '--port', String(PORT), '--data-dir', library], { cwd: temp, stdio: ['ignore', 'pipe', 'inherit'] });
let output = '';
server.stdout.on('data', (chunk) => { output += chunk; });
let URL = '';
for (let i = 0; i < 300 && !URL; i += 1) {
  const address = /running at (http:\/\/[\d.]+:\d+)/.exec(output)?.[1];
  if (address && existsSync(join(library, 'remote.json'))) URL = `${address}/`;
  else await sleep(100);
}
const token = JSON.parse(readFileSync(join(library, 'remote.json'), 'utf8')).token;
async function act(action, args = {}) {
  const response = await fetch(`${URL}api/remote/action`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-MaveScape-Token': token }, body: JSON.stringify({ action, args, client: 'browser-bench' }) });
  const result = await response.json();
  if (!result.ok) throw new Error(`${action}: ${result.message ?? result.error}`);
  return result;
}

// The browser's resident memory, every process of the headless Chrome this run started (its
// profile folder is in each one's command line). collect(): the page's garbage collected first.
function browserMB() {
  try {
    const lines = execFileSync('ps', ['-eo', 'rss=,args='], { encoding: 'utf8', maxBuffer: 1 << 26 }).split('\n');
    return lines.filter((l) => l.includes('mavescape-capture-')).reduce((a, l) => a + Number(l.trim().split(/\s+/)[0]), 0) / 1024;
  } catch {
    return Number.NaN;
  }
}

let over = true;
const b = await launch();
const collect = async () => {
  await b.send('HeapProfiler.collectGarbage').catch(() => {});
  await sleep(1000);
};
try {
  await b.goto(URL, 4000);
  await act('open_files', { paths: [join(temp, 'gene.fasta')] });
  await sleep(2000);
  await collect();
  const base = browserMB();
  let peak = base;
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      peak = Math.max(peak, browserMB());
      await sleep(100);
    }
  })();
  let t0 = performance.now();
  await act('open_files', { paths: [join(temp, 'counts.csv'), join(temp, 'map.csv')] });
  const importMs = performance.now() - t0;
  const importPeak = peak;
  await collect();
  const after = browserMB();
  await act('draft_design');
  t0 = performance.now();
  await act('score');
  const sumMs = performance.now() - t0;
  t0 = performance.now();
  await act('score', { parameters: { aggregation: 'barcode' } });
  const barcodeMs = performance.now() - t0;
  sampling = false;
  await sampler;
  console.log(`${rows} barcodes, counts ${(readFileSync(join(temp, 'counts.csv')).length / 1e6).toFixed(0)} MB and map ${(readFileSync(join(temp, 'map.csv')).length / 1e6).toFixed(0)} MB`);
  console.log(`imported in the window (served, read in a worker, assembled, reviewed, kept in the library) in ${(importMs / 1000).toFixed(1)} s`);
  await collect();
  const afterScoring = browserMB();
  console.log(`the browser: ${base.toFixed(0)} MB before; during the import at most ${importPeak.toFixed(0)} MB (+${(importPeak - base).toFixed(0)} MB), after it ${after.toFixed(0)} MB (+${(after - base).toFixed(0)} MB, the table, its review and the files kept); while scoring at most ${peak.toFixed(0)} MB, after both runs ${afterScoring.toFixed(0)} MB (+${(afterScoring - base).toFixed(0)} MB)`);
  console.log(`scored summed in ${(sumMs / 1000).toFixed(1)} s and by barcode in ${(barcodeMs / 1000).toFixed(1)} s (from the action to its result, the worker's transfer included)`);
  over = importMs > 15000 || !(importPeak - base <= 1024);
  if (over) console.log('Over budget (15 s, 1 GB for the import).');
} finally {
  await b.close();
  server.kill();
  rmSync(temp, { recursive: true, force: true });
}
process.exit(over ? 1 : 0);
