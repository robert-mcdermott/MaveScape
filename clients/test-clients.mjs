// Tests the R and Python clients against a running MaveScape (wave 7, slice 4): builds MaveScape
// from source, starts it with remote control (its connection file in a temporary data folder,
// offline on the fetcher's cached answers), opens its page in headless Chrome, writes the GRB2
// example's scores as Node computes them, then runs each client's tests: GRB2 opened and scored
// through the client, its scores table every number of Node's, a figure and the map written as
// files, an error carrying MaveScape's reason, and results equal to the HTTP API's for the same
// actions. After CytoWeave 0.8.0's clients/test-clients.mjs.
//
//   node clients/test-clients.mjs [--python] [--r]     (both when neither is named)
//
// Needs Go, Chrome (CHROME=path), Python 3 for the Python client (pandas for its data frames, else
// those tests are skipped) and R with curl, jsonlite and testthat for the R client. Exits with
// status 1 when a test fails.

import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, sleep } from '../docs/capture/cdp.mjs';
import { exampleById } from '../web/lib/examples.js';
import { scoresCSV } from '../web/lib/exports.js';
import { openExampleInNode } from '../validation/example-cases.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8857;
const only = ['--python', '--r'].filter((flag) => process.argv.includes(flag));
const run = (name) => !only.length || only.includes(`--${name}`);
const temp = mkdtempSync(join(tmpdir(), 'mavescape-clients-'));
const library = join(temp, 'library');
const cache = join(temp, 'cache');
const out = join(temp, 'out');
mkdirSync(out);
cpSync(join(ROOT, 'validation/fixtures/public-data'), cache, { recursive: true });

const exec = (command, args, options = {}) => new Promise((done) => {
  const child = spawn(command, args, { cwd: ROOT, stdio: 'inherit', ...options });
  child.on('exit', (code) => done(code ?? 1));
  child.on('error', (error) => { console.error(`${command}: ${error.message}`); done(1); });
});

async function startMaveScape() {
  const binary = join(temp, process.platform === 'win32' ? 'mavescape.exe' : 'mavescape');
  if (await exec('go', ['build', '-o', binary, '.'])) throw new Error('go build failed (is Go installed?)');
  const server = spawn(binary, ['--remote-control', '--window', 'none', '--port', String(PORT), '--data-dir', library, '--offline', '--cache-dir', cache, '--proteoscope', 'off'], { cwd: temp, stdio: ['ignore', 'pipe', 'inherit'] });
  let output = '';
  server.stdout.on('data', (chunk) => { output += chunk; });
  for (let i = 0; i < 300; i += 1) {
    const url = /running at (http:\/\/[\d.]+:\d+)/.exec(output)?.[1];
    const token = /X-MaveScape-Token: (\S+)/.exec(output)?.[1];
    if (url && token && existsSync(join(library, 'remote.json'))) {
      try {
        if ((await fetch(`${url}/api/info`)).ok) return { url, token, stop: () => server.kill() };
      } catch { /* starting */ }
    }
    await sleep(200);
  }
  server.kill();
  throw new Error(`MaveScape did not start:\n${output}`);
}

let failed = 0;
const server = await startMaveScape();
let browser;
try {
  browser = await launch({ width: 1400, height: 900, scale: 1 });
  await browser.goto(`${server.url}/`);
  for (let i = 0; i < 100 && !(await browser.eval('Boolean(window.mavescape?.remote)')); i += 1) await sleep(200);
  if (!(await browser.eval('Boolean(window.mavescape?.remote)'))) throw new Error('The page did not start remote control.');
  // The GRB2 example's Run 1 as Node scores it: the table the clients' scores must hold.
  const node = openExampleInNode(exampleById('grb2-sh3'));
  const expected = join(out, 'grb2-run1-scores.csv');
  writeFileSync(expected, scoresCSV(node.scored.results, { inputs: { design: node.design } }, 0));
  const env = { ...process.env, MAVESCAPE_TEST_URL: server.url, MAVESCAPE_TEST_TOKEN: server.token, MAVESCAPE_TEST_DIR: out, MAVESCAPE_TEST_EXPECTED: expected, MAVESCAPE_DATA_DIR: library };
  for (const key of ['MAVESCAPE_URL', 'MAVESCAPE_TOKEN']) delete env[key];
  if (run('python')) {
    console.log('\n--- Python client ---');
    const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
    const code = await exec(python, ['-m', 'unittest', 'discover', '-s', 'clients/python/tests', '-v'], { env: { ...env, PYTHONPATH: join(ROOT, 'clients/python/src') } });
    if (code) failed += 1;
  }
  if (run('r')) {
    console.log('\n--- R client ---');
    const rlib = join(temp, 'rlib');
    mkdirSync(rlib);
    let code = await exec('R', ['CMD', 'INSTALL', '--no-test-load', `--library=${rlib}`, 'clients/r'], { env });
    if (!code) {
      const script = `.libPaths(c(${JSON.stringify(rlib)}, .libPaths())); library(testthat); results <- as.data.frame(test_dir("clients/r/tests/testthat", package = "mavescape", load_package = "installed", reporter = "summary", stop_on_failure = FALSE)); if (sum(results$failed) + sum(results$error) > 0) quit(status = 1)`;
      code = await exec('Rscript', ['-e', script], { env });
    }
    if (code) failed += 1;
  }
} catch (error) {
  console.error(error);
  failed += 1;
} finally {
  await browser?.close?.();
  server.stop();
  rmSync(temp, { recursive: true, force: true });
}
console.log(failed ? `\n${failed} client test suite(s) failed.` : '\nThe clients\' tests passed.');
process.exit(failed ? 1 : 0);
