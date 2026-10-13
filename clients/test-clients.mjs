// Tests the R and Python clients against a running MaveScape (wave 7, slice 4): builds MaveScape
// from source, starts it with remote control (its connection file in a temporary data folder,
// offline on the fetcher's cached answers), opens its page in headless Chrome, writes the GRB2
// example's scores as Node computes them, then runs each client's tests: GRB2 opened and scored
// through the client, its scores table every number of Node's, a figure and the map written as
// files, an error carrying MaveScape's reason, and results equal to the HTTP API's for the same
// actions. After CytoWeave 0.8.0's clients/test-clients.mjs.
//
// Then the examples (wave 7, slice 6), each in a folder of its own: the Python notebook
// clients/examples/grb2-sh3.ipynb executed (nbclient), and the R script clients/examples/dhfr-lon.R
// run on DHFR's two score sets, its MaveDB tables as node validation/fetch.mjs mavedb-dhfr keeps
// them. Each fails when one of its checks does.
//
//   node clients/test-clients.mjs [--python] [--r] [--require] [--update]
//
// --python, --r: that client alone (both when neither is named). --require: fail, rather than skip
// an example, when what it needs is missing (as CI runs it). --update: write the executed notebook,
// with its outputs, over clients/examples/grb2-sh3.ipynb.
//
// Needs Go, Chrome (CHROME=path), Python 3 for the Python client (pandas for its data frames, else
// those tests are skipped; nbclient, ipykernel and matplotlib too for the notebook) and R with curl,
// jsonlite and testthat for the R client. Exits with status 1 when a test or an example fails.

import { spawn } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
const strict = process.argv.includes('--require');
const update = process.argv.includes('--update');
const NOTEBOOK = join(ROOT, 'clients/examples/grb2-sh3.ipynb');
// DHFR's MaveDB tables (wave 3, slice 6), copied into the fetcher's cache so that the R example
// opens them offline.
const DHFR = join(ROOT, 'validation/cache/mavedb-dhfr');
const DHFR_TABLES = [['urn:mavedb:00000063-b-1', 'minus-lon'], ['urn:mavedb:00000063-a-1', 'plus-lon']];
const temp = mkdtempSync(join(tmpdir(), 'mavescape-clients-'));
const library = join(temp, 'library');
const cache = join(temp, 'cache');
const out = join(temp, 'out');
mkdirSync(out);
cpSync(join(ROOT, 'validation/fixtures/public-data'), cache, { recursive: true });
const dhfr = existsSync(join(DHFR, 'plus-lon', 'counts.csv'));
if (dhfr) {
  for (const [urn, dir] of DHFR_TABLES) {
    for (const table of ['scores', 'counts']) {
      const name = `${urn.replaceAll(':', '_')}.${table}.csv`;
      cpSync(join(DHFR, dir, `${table}.csv`), join(cache, 'mavedb', name));
      writeFileSync(join(cache, 'mavedb', `${name}.meta.json`), `${JSON.stringify({ contentType: 'text/csv; charset=utf-8', service: 'MaveDB', source: `https://api.mavedb.org/api/v1/score-sets/${urn}/${table}`, retrieved: '2026-10-11T16:30:00Z' }, null, 2)}\n`);
    }
  }
}

// Executes a notebook with nbclient in a folder, then writes it with its outputs (each cell's
// timings and the kernel's details left out, so that it changes only when its outputs do). Exits
// with status 3 when nbclient, ipykernel, pandas or matplotlib is missing.
const EXECUTE = `
import sys
try:
    import ipykernel, matplotlib, nbformat, pandas
    from nbclient import NotebookClient
except ImportError as error:
    print(f"The notebook needs nbclient, ipykernel, pandas and matplotlib: {error}.")
    sys.exit(3)
source, folder, executed = sys.argv[1:4]
nb = nbformat.read(source, as_version=4)
NotebookClient(nb, timeout=900, kernel_name="python3", resources={"metadata": {"path": folder}}).execute()
for cell in nb.cells:
    cell.metadata.pop("execution", None)
nb.metadata["language_info"] = {"name": "python"}
nbformat.write(nb, executed)
`;
// An example that cannot run here: skipped, or a failure with --require.
function cannot(what, why) {
  console.log(`${strict ? 'FAIL' : 'Skipped'}: ${what}: ${why}`);
  return strict ? 1 : 0;
}

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
    const pythonEnv = { ...env, PYTHONPATH: join(ROOT, 'clients/python/src') };
    const code = await exec(python, ['-m', 'unittest', 'discover', '-s', 'clients/python/tests', '-v'], { env: pythonEnv });
    if (code) failed += 1;
    console.log('\n--- The Python notebook (clients/examples/grb2-sh3.ipynb) ---');
    const folder = join(out, 'notebook');
    mkdirSync(folder);
    const executed = join(folder, 'grb2-sh3.ipynb');
    let notebook = await exec(python, ['-c', EXECUTE, NOTEBOOK, folder, executed], { env: pythonEnv });
    if (notebook === 3) notebook = cannot('the notebook', 'install nbclient, ipykernel, pandas and matplotlib');
    else if (!notebook) {
      console.log('The notebook ran to its end, every check passing.');
      if (update) {
        copyFileSync(executed, NOTEBOOK);
        console.log('Wrote it, with its outputs, to clients/examples/grb2-sh3.ipynb.');
      }
    }
    if (notebook) failed += 1;
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
    console.log('\n--- The R script (clients/examples/dhfr-lon.R) ---');
    let example;
    if (!dhfr) example = cannot('the R script', 'DHFR\'s MaveDB tables are not in validation/cache (node validation/fetch.mjs mavedb-dhfr)');
    else if (!existsSync(join(rlib, 'mavescape'))) example = cannot('the R script', 'the R client did not install');
    else {
      const folder = join(out, 'r-example');
      mkdirSync(folder);
      example = await exec('Rscript', [join(ROOT, 'clients/examples/dhfr-lon.R')], { cwd: folder, env: { ...env, R_LIBS: rlib } });
      if (!example) console.log('The R script ran to its end, every check passing.');
    }
    if (example) failed += 1;
  }
} catch (error) {
  console.error(error);
  failed += 1;
} finally {
  await browser?.close?.();
  server.stop();
  rmSync(temp, { recursive: true, force: true });
}
console.log(failed ? `\n${failed} of the clients' test suites and examples failed.` : '\nThe clients\' tests and examples passed.');
process.exit(failed ? 1 : 0);
