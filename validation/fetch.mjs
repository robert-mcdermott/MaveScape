// Downloads the external data of the validation suites into validation/cache/ and checks every
// file against the size and SHA-256 recorded in validation/sources.json. Files already present
// and intact are not downloaded again.
//
//   node validation/fetch.mjs [data set …] [--list]
//
// The data are not part of the repository or of the MaveScape program; sources.json records where
// each data set comes from and its license. Adapted from CytoWeave 0.8.0 validation/fetch.mjs.

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(await readFile(`${here}/sources.json`, 'utf8'));
const args = process.argv.slice(2);
const names = args.filter((a) => !a.startsWith('--'));

if (args.includes('--list')) {
  for (const [name, set] of Object.entries(manifest.datasets)) {
    const bytes = set.files.reduce((sum, f) => sum + f.size, 0);
    console.log(`${name}: ${set.title}, ${set.files.length} files, ${(bytes / 1e6).toFixed(1)} MB\n  ${set.source}\n  ${set.license}`);
  }
  process.exit(0);
}

for (const name of names) {
  if (!manifest.datasets[name]) {
    console.error(`Unknown data set ${name}. Data sets: ${Object.keys(manifest.datasets).join(', ')}`);
    process.exit(2);
  }
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function intact(path, file) {
  try {
    const bytes = await readFile(path);
    return bytes.length === file.size && sha256(bytes) === file.sha256;
  } catch {
    return false;
  }
}

// MaveDB's API sometimes answers 504 (its load balancer's timeout) and then succeeds: retry with
// a growing delay before giving up.
async function download(url, file, path) {
  let lastError;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'MaveScape-validation (+https://github.com/robert-mcdermott/mavescape)' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const digest = sha256(bytes);
      if (bytes.length !== file.size || digest !== file.sha256) throw Object.assign(new Error(`checksum mismatch (got ${bytes.length} bytes, SHA-256 ${digest}): the source has changed this file`), { final: true });
      await mkdir(dirname(path), { recursive: true });
      await writeFile(`${path}.part`, bytes);
      await rename(`${path}.part`, path);
      return;
    } catch (error) {
      lastError = error;
      if (error.final) break;
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    }
  }
  throw new Error(`${url}: ${lastError.message}`);
}

let failures = 0;
for (const [name, set] of Object.entries(manifest.datasets)) {
  if (names.length && !names.includes(name)) continue;
  const root = `${here}/cache/${name}`;
  const queue = [...set.files];
  let fetched = 0;
  let present = 0;
  let failed = 0;
  const worker = async () => {
    for (let file = queue.shift(); file; file = queue.shift()) {
      const path = `${root}/${file.path}`;
      if (await intact(path, file)) {
        present += 1;
        continue;
      }
      try {
        // A file's own url, or the data set's base followed by its path.
        await download(file.url ?? set.base + file.path.split('/').map(encodeURIComponent).join('/'), file, path);
        fetched += 1;
      } catch (error) {
        failed += 1;
        console.error(`✗ ${name}: ${error.message}`);
      }
    }
  };
  // Few at a time: MaveDB is a public service without published rate limits.
  await Promise.all(Array.from({ length: 2 }, worker));
  failures += failed;
  console.log(`${failed ? '✗' : '✓'} ${name}: ${fetched} downloaded, ${present} already present (${set.title})`);
}
if (failures) process.exit(1);
