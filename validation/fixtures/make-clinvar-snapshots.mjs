// ClinVar's records of BRCA1, TP53 and PTEN as the ClinVar track keeps them (wave 8, slice 6), for
// the calibration examples (web/lib/examples.js): MaveScape built and started online with a cache
// of its own (validation/cache/clinvar-snapshots/, not part of the repository), each gene's records
// asked of NCBI through its fetcher as the page asks (/api/fetch/clinvar/search, then the
// summaries 500 at a time), and the table providers/clinvar.js makes of them written gzipped into
// web/examples/clinvar/, with its SHA-256 and retrieval record in snapshots.json. ClinVar changes
// every week, so the snapshot is not made again by the validation: it is the examples' data, as an
// example's counts are. Sends NCBI the gene symbols and record numbers only.
//
//   node validation/fixtures/make-clinvar-snapshots.mjs [--port 8838]

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { CLINVAR } from '../../web/lib/providers/clinvar.js';
import { retrievalOf } from '../../web/lib/uniprot.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const GENES = ['BRCA1', 'TP53', 'PTEN'];
const OUT = join(ROOT, 'web/examples/clinvar');
const CACHE = join(ROOT, 'validation/cache/clinvar-snapshots');
const port = process.argv.includes('--port') ? Number(process.argv[process.argv.indexOf('--port') + 1]) : 8838;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const temp = mkdtempSync(join(tmpdir(), 'mavescape-clinvar-'));
const binary = join(temp, 'mavescape');
await new Promise((done, fail) => spawn('go', ['build', '-o', binary, '.'], { cwd: ROOT, stdio: 'inherit' }).on('exit', (code) => (code ? fail(new Error('go build failed')) : done())));
mkdirSync(CACHE, { recursive: true });
const server = spawn(binary, ['--window', 'none', '--port', String(port), '--data-dir', join(temp, 'library'), '--cache-dir', CACHE], { cwd: temp, stdio: ['ignore', 'pipe', 'inherit'] });
let output = '';
server.stdout.on('data', (chunk) => { output += chunk; });
let base = null;
for (let i = 0; i < 300 && !base; i += 1) {
  const address = /running at (http:\/\/[\d.]+:\d+)/.exec(output)?.[1];
  if (address) {
    try {
      if ((await fetch(`${address}/api/info`)).ok) base = `${address}/`;
    } catch { /* starting */ }
  }
  if (!base) await sleep(200);
}
if (!base) {
  server.kill();
  throw new Error(`MaveScape did not start:\n${output}`);
}

// The page's fetchPublic, from Node: { ok, json | text, retrieval } or { ok: false, message }.
async function get(path, { as = 'json' } = {}) {
  const response = await fetch(`${base}api/fetch/${path}`, { cache: 'no-store' });
  const retrieval = retrievalOf((name) => response.headers.get(name));
  if (!response.ok) return { ok: false, status: response.status, message: (await response.json().catch(() => null))?.error ?? `HTTP ${response.status}` };
  return as === 'text' ? { ok: true, text: await response.text(), retrieval } : { ok: true, json: await response.json(), retrieval };
}

try {
  mkdirSync(OUT, { recursive: true });
  const snapshots = existsSync(join(OUT, 'snapshots.json')) ? JSON.parse(readFileSync(join(OUT, 'snapshots.json'), 'utf8')) : {};
  for (const gene of GENES) {
    const got = await CLINVAR.fetch({ identifiers: { gene } }, {}, get, (fraction, note) => process.stdout.write(`\r${gene}: ${note}            `));
    const bytes = new TextEncoder().encode(got.text);
    writeFileSync(join(OUT, `${gene}.csv.gz`), gzipSync(bytes, { level: 9 }));
    snapshots[gene] = { fileName: got.fileName, sha256: sha256(bytes), size: bytes.length, record: got.record };
    console.log(`\r${gene}: ${got.record.records} records, ${got.record.kept} kept; ${bytes.length} bytes (${got.record.retrieved})`);
  }
  writeFileSync(join(OUT, 'snapshots.json'), `${JSON.stringify(snapshots, null, 2)}\n`);
} finally {
  server.kill();
  rmSync(temp, { recursive: true, force: true });
}
