// MaveDB, live (wave 3, slices 2 and 3): the three feasibility records (four score sets) opened from MaveDB
// in the real program and a headless browser, by the remote action every script and agent uses, with
// no code for any of them; the tables MaveDB sends equal the ones the validation pins
// (sources.json); the published scores, read as published, equal MaveDB's column for column; and the
// PRD's phase-0 exit, score agreement within documented tolerances, checked again from the live
// import: each record's counts scored with its documented design and the parameters its authors
// used, against its published scores, at the tolerances the suites `scoring` and `enrich2` hold.
// And two records whose target is a transcript (wave 3, slice 3), fetched live from NCBI and
// Ensembl, every variant read on it and at the protein level.
//
//   node validation/mavedb-live.mjs [--offline] [--verbose]
//
// The fetcher's cache is validation/cache/mavedb-live/ (not in the repository): --offline checks
// again from it, sending nothing. Needs Go, Chrome (CHROME=path) and, without --offline, the network.
// Exits with status 1 when a check fails.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, sleep } from '../docs/capture/cdp.mjs';
import { columnText, parseTable } from '../web/lib/csv.js';
import { pearson } from '../web/lib/stats.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8834;
const offline = process.argv.includes('--offline');
const verbose = process.argv.includes('--verbose');
const CACHE = join(ROOT, 'validation/cache/mavedb-live');
const sources = JSON.parse(readFileSync(join(ROOT, 'validation/sources.json'), 'utf8'));
const design = (name) => JSON.parse(readFileSync(join(ROOT, 'validation/designs', name), 'utf8'));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const results = [];
function check(name, value, ok, required = '') {
  results.push({ name, ok });
  if (verbose || !ok) console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} — ${value}${required ? ` (required ${required})` : ''}`);
}

// The records, each with the data set that pins its files (sources.json).
const RECORDS = [
  { urn: 'urn:mavedb:00000835-a-1', set: 'mavedb-grb2-sh3', dir: '' },
  { urn: 'urn:mavedb:00000003-a-1', set: 'mavedb-brca1-ring', dir: 'nt/' },
  { urn: 'urn:mavedb:00000003-a-2', set: 'mavedb-brca1-ring', dir: 'aa/' },
  { urn: 'urn:mavedb:00001200-a-1', set: 'mavedb-factor9', dir: '' },
];

const temp = mkdtempSync(join(tmpdir(), 'mavescape-mavedb-'));
const out = join(temp, 'out');
mkdirSync(out);
mkdirSync(CACHE, { recursive: true });
let URL = '';
let token = '';

async function startMaveScape() {
  const binary = join(temp, process.platform === 'win32' ? 'mavescape.exe' : 'mavescape');
  await new Promise((done, fail) => spawn('go', ['build', '-o', binary, '.'], { cwd: ROOT, stdio: 'inherit' }).on('exit', (code) => (code ? fail(new Error('go build failed')) : done())));
  const library = join(temp, 'library');
  const server = spawn(binary, ['--remote-control', '--window', 'none', '--port', String(PORT), '--data-dir', library, '--cache-dir', CACHE, ...(offline ? ['--offline'] : [])], { cwd: temp, stdio: ['ignore', 'pipe', 'inherit'] });
  let output = '';
  server.stdout.on('data', (chunk) => { output += chunk; });
  for (let i = 0; i < 300; i += 1) {
    const address = /running at (http:\/\/[\d.]+:\d+)/.exec(output)?.[1];
    if (address && existsSync(join(library, 'remote.json'))) {
      URL = `${address}/`;
      token = JSON.parse(readFileSync(join(library, 'remote.json'), 'utf8')).token;
      return { stop: () => server.kill() };
    }
    await sleep(200);
  }
  server.kill();
  throw new Error(`MaveScape did not start:\n${output}`);
}

async function act(action, args = {}) {
  const response = await fetch(`${URL}api/remote/action`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-MaveScape-Token': token }, body: JSON.stringify({ action, args, client: 'mavedb-live' }) });
  const body = await response.json().catch(() => ({}));
  if (!body.ok) throw new Error(`${action} ${JSON.stringify(args).slice(0, 120)}: ${body.message ?? body.error}`);
  return body;
}

// A run's scores, exported by the window (MaveDB columns), as a table.
let exports = 0;
async function exported(run) {
  exports += 1;
  const path = join(out, `scores-${exports}.csv`);
  await act('export', { what: 'scores', run, path });
  return parseTable(readFileSync(path));
}
const numbers = (table, name) => table.columns.find((c) => c.name === name)?.numeric;
const keysOf = (table, name) => columnText(table.columns.find((c) => c.name === name));

const maveScape = await startMaveScape();
let browser = null;
try {
  browser = await launch({ width: 1440, height: 900, scale: 1 });
  await browser.goto(URL, 1500);
  for (let i = 0; i < 100 && !(await browser.eval('Boolean(window.mavescape?.remote)')); i += 1) await sleep(100);

  const opened = new Map();
  for (const record of RECORDS) {
    const t0 = performance.now();
    const result = await act('open_mavedb', { urn: record.urn });
    const state = await act('get_state');
    const tables = state.data.tables;
    const files = sources.datasets[record.set].files;
    const pinned = (which) => files.find((f) => f.path === `${record.dir}${which}.csv`)?.sha256;
    const scores = tables.find((t) => t.origin?.file === 'scores');
    const counts = tables.find((t) => t.origin?.file === 'counts');
    check(`${record.urn}: opened from MaveDB by its URN alone (${((performance.now() - t0) / 1000).toFixed(1)} s)`, result.message.slice(0, 200), Boolean(scores && counts) && result.data.published?.scored > 0, 'scores and counts');
    check(`${record.urn}: the tables MaveDB sent are the ones the validation pins, byte for byte`, `scores ${scores?.sha256.slice(0, 12)}…, counts ${counts?.sha256.slice(0, 12)}…`, scores?.sha256 === pinned('scores') && counts?.sha256 === pinned('counts'), 'sources.json\'s SHA-256');
    // The published scores, read as published, against MaveDB's own columns.
    const theirs = parseTable(readFileSync(join(CACHE, 'mavedb', `${record.urn.replaceAll(':', '_')}.scores.csv`)));
    const mine = await exported('Published scores');
    const column = theirs.columns.find((c) => /^(se|sigma|SE_score|SE)$/i.test(c.name))?.name;
    const a = numbers(mine, 'score');
    const b = numbers(theirs, 'score');
    const sa = numbers(mine, 'SE');
    const sb = column ? numbers(theirs, column) : null;
    let differ = 0;
    for (let i = 0; i < theirs.rows; i += 1) if (!Object.is(a[i], b[i]) || (sb && !Object.is(sa[i], sb[i]))) differ += 1;
    check(`${record.urn}: every published score and SE read as published equals MaveDB's (${theirs.rows} rows)`, `${differ} rows differ`, mine.rows === theirs.rows && differ === 0, '0');
    opened.set(record.urn, state.data.workspace.name);
  }

  // Phase 0, again from the live import. GRB2: the drafted design is the documented one; DiMSum's
  // model, as the Domainome scored it, against its published scores.
  await act('open_mavedb', { urn: 'urn:mavedb:00000835-a-1' });
  const grb2 = await act('score', { preset: 'dimsum' });
  const grb2Scores = await exported(grb2.data.name);
  const grb2Published = parseTable(readFileSync(join(CACHE, 'mavedb', 'urn_mavedb_00000835-a-1.scores.csv')));
  {
    const row = new Map(keysOf(grb2Published, 'hgvs_pro').map((k, i) => [k, i]));
    const raw = numbers(grb2Published, 'raw_score');
    const mine = numbers(grb2Scores, 'score');
    const x = [];
    const y = [];
    keysOf(grb2Scores, 'hgvs_pro').forEach((k, i) => { const j = row.get(k); if (j !== undefined && Number.isFinite(mine[i]) && Number.isFinite(raw[j])) { x.push(mine[i]); y.push(raw[j]); } });
    check('GRB2, from the live import: its counts scored by DiMSum\'s model on the drafted design follow the published scores (the scoring suite\'s tolerance)', `r ${pearson(x, y).toFixed(4)} over ${x.length} variants`, pearson(x, y) >= 0.99, 'r ≥ 0.99');
  }
  // BRCA1 E2: the documented design on the live counts, Enrich2's weighted least squares with
  // wild-type normalization: the published replicate scores (Enrich2 of 2017) reproduced.
  await act('open_mavedb', { urn: 'urn:mavedb:00000003-a-2' });
  const e2Design = design('brca1-ring-e2.design.json');
  await act('set_design', { design: e2Design, table: 'counts' });
  const e2 = await act('score', { preset: 'enrich2', parameters: { model: 'wls', normalization: 'wt' } });
  const e2Scores = await exported(e2.data.name);
  const e2Published = parseTable(readFileSync(join(CACHE, 'mavedb', 'urn_mavedb_00000003-a-2.scores.csv')));
  {
    const row = new Map(keysOf(e2Published, 'hgvs_pro').map((k, i) => [k, i]));
    // Relative to the larger of 1 and the published value, as the enrich2 suite measures it.
    let worst = 0;
    let where = '';
    let compared = 0;
    for (const r of e2Design.replicates) {
      const mine = numbers(e2Scores, `score_${r.id}`);
      const theirs = numbers(e2Published, `score_${r.name}`);
      keysOf(e2Scores, 'hgvs_pro').forEach((k, i) => {
        const j = row.get(k);
        if (j === undefined || !Number.isFinite(mine[i]) || !Number.isFinite(theirs[j])) return;
        compared += 1;
        const d = Math.abs(mine[i] - theirs[j]) / Math.max(1, Math.abs(theirs[j]));
        if (d > worst) {
          worst = d;
          where = `${r.name} ${k}`;
        }
      });
    }
    check('BRCA1 E2, from the live import: the documented design and Enrich2\'s weighted least squares reproduce the published replicate scores (the enrich2 suite\'s tolerance)', `${compared} replicate scores, largest difference ${worst.toExponential(2)} (${where})`, compared > 9000 && worst <= 1e-10, '≤ 1e-10 relative');
  }
  // Factor IX: the documented design on the live counts, with MultiSTEP's own settings (the
  // weighted bin average, the lowest 5% at 0, the replicates' mean).
  await act('open_mavedb', { urn: 'urn:mavedb:00001200-a-1' });
  await act('set_design', { design: design('factor9.design.json'), table: 'counts' });
  const f9 = await act('score', { parameters: { binScale: 'low5-wt', combination: 'mean', filters: { minInputCount: 0 } } });
  const f9Scores = await exported(f9.data.name);
  const f9Published = parseTable(readFileSync(join(CACHE, 'mavedb', 'urn_mavedb_00001200-a-1.scores.csv')));
  {
    const row = new Map(keysOf(f9Published, 'hgvs_pro').map((k, i) => [k, i]));
    const theirs = numbers(f9Published, 'score');
    const mine = numbers(f9Scores, 'score');
    const x = [];
    const y = [];
    keysOf(f9Scores, 'hgvs_pro').forEach((k, i) => { const j = row.get(k); if (j !== undefined && Number.isFinite(mine[i]) && Number.isFinite(theirs[j])) { x.push(mine[i]); y.push(theirs[j]); } });
    check('Factor IX, from the live import: the documented design with MultiSTEP\'s settings follows the published scores (the scoring suite\'s tolerance)', `r ${pearson(x, y).toFixed(5)} over ${x.length} variants`, pearson(x, y) >= 0.999, 'r ≥ 0.999');
  }

  // Wave 3, slice 3: records whose target is a transcript, fetched live as MaveDB names it (BRCA1's
  // RefSeq NM_007294.3 from NCBI as GenBank; BAP1's Ensembl ENST00000460680), every variant read on
  // it and at the protein level.
  {
    const brca1 = await act('open_mavedb', { urn: 'urn:mavedb:00000097-0-2' });
    const state = await act('get_state');
    const files = sources.datasets['mavedb-brca1-sge'].files;
    const pin = (which) => files.find((f) => f.path === `${which}.csv`)?.sha256;
    const scores = state.data.tables.find((t) => t.origin?.file === 'scores');
    const counts = state.data.tables.find((t) => t.origin?.file === 'counts');
    check('BRCA1 saturation genome editing (urn:mavedb:00000097-0-2): opened live, its target the RefSeq transcript NCBI sends (NM_007294.3), every one of its 3,893 variants valid on it, its tables the ones the validation pins', `${brca1.message.slice(0, 220)}; scores ${scores?.sha256.slice(0, 12)}…, counts ${counts?.sha256.slice(0, 12)}…`, brca1.data.target?.accession === 'NM_007294.3' && state.data.targets[0]?.from === 'NCBI' && brca1.data.published?.scored === 3893 && scores?.sha256 === pin('scores') && counts?.sha256 === pin('counts'));
    const map = await act('render_map', {});
    check('BRCA1 saturation genome editing, from the live import: drawn at the protein level, 2,251 protein variants from 3,893 nucleotide variants, the rest beside the map', map.data.description.find((l) => /Read at the protein level/.test(l)) ?? 'not read at the protein level', map.data.description.some((l) => /3893 nucleotide variants make 2251 protein variants; 391 of them are made by more than one \(943 nucleotide variants\), merged as DiMSum merges them \(averaged: the scores have no SE/.test(l)));
    const bap1 = await act('open_mavedb', { urn: 'urn:mavedb:00000662-a-2' });
    check('BAP1 exon 1 (urn:mavedb:00000662-a-2): opened live, its target the transcript Ensembl serves (its current version, said where MaveDB names another), every one of its 620 variants\' reference bases agreeing with it', bap1.message.slice(0, 260), /^ENST00000460680\.\d+$/.test(bap1.data.target?.accession ?? '') && bap1.data.published?.scored === 620);
  }
} catch (error) {
  check('the session ran to the end', error.stack ?? error.message, false);
} finally {
  await browser?.close();
  maveScape.stop();
  rmSync(temp, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`mavedb-live${offline ? ' (offline, from the cache)' : ''}: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
