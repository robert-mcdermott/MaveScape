// Open in Proteoscope, with Proteoscope itself (wave 5, slice 6; requirement X6). Not in CI:
// Proteoscope is another program, which MaveScape does not need; where it is not installed this
// says so and stops (--require makes that a failure). The remote session checks the handoff against
// a fake Proteoscope; this checks that Proteoscope opens what MaveScape hands it.
//
//   node validation/proteoscope-handoff.mjs [--verbose] [--require]
//
// The installed Proteoscope (PROTEOSCOPE names its program, else "proteoscope" on the PATH) is
// started on a port of its own, its downloads cached in validation/cache/proteoscope/ (it fetches
// 2VWF and GRB2's AlphaFold DB model the first time); MaveScape with remote control, offline, looking
// for it there. GRB2's example: 2VWF colored by the median score, residues drawn, hidden, focused on,
// selected and labeled; handed over by the link, opened in a browser, read back from Proteoscope's
// own session; the same for GRB2's AlphaFold DB model; RCSB's PDB-format 2VWF as a file of the
// person's, its session file opened by Proteoscope as files named to it are.

import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, sleep } from '../docs/capture/cdp.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8846;
const PROTEOSCOPE_PORT = 8848;
const TESTED = '0.10';
const verbose = process.argv.includes('--verbose');
const mustRun = process.argv.includes('--require');

const results = [];
function check(name, value, ok) {
  results.push({ name, ok });
  if (verbose || !ok) console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} — ${value}`);
}

// --- Proteoscope -----------------------------------------------------------------------------------

function findProteoscope() {
  if (process.env.PROTEOSCOPE) return existsSync(process.env.PROTEOSCOPE) ? process.env.PROTEOSCOPE : null;
  const names = process.platform === 'win32' ? ['proteoscope.exe'] : ['proteoscope'];
  for (const dir of (process.env.PATH ?? '').split(delimiter)) for (const name of names) if (dir && existsSync(join(dir, name))) return join(dir, name);
  return null;
}

const program = findProteoscope();
if (!program) {
  console.log(`proteoscope-handoff: skipped — Proteoscope is not installed (set PROTEOSCOPE to its program).${mustRun ? ' --require: a failure.' : ''}`);
  process.exit(mustRun ? 1 : 0);
}
const version = /proteoscope (\S+)/.exec(execFileSync(program, ['--version'], { encoding: 'utf8' }))?.[1] ?? '';
if (!version.startsWith(`${TESTED}.`)) console.log(`proteoscope-handoff: Proteoscope ${version}, not ${TESTED}: MaveScape hands it the structure alone; the checks below expect ${TESTED}.`);

const temp = mkdtempSync(join(tmpdir(), 'mavescape-proteoscope-'));
const library = join(temp, 'library');
const out = join(temp, 'out');
mkdirSync(out);
const psCache = join(ROOT, 'validation/cache/proteoscope');
mkdirSync(psCache, { recursive: true });

// A program started, and the address its banner gives.
async function started(command, args, pattern, what) {
  const child = spawn(command, args, { cwd: temp, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  for (let i = 0; i < 300; i += 1) {
    const address = pattern.exec(output)?.[1];
    if (address) return { child, url: `${address}/`, output: () => output };
    if (child.exitCode !== null) break;
    await sleep(100);
  }
  child.kill();
  throw new Error(`${what} did not start:\n${output}`);
}

const stopped = async (child) => {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((done) => child.once('exit', done));
  child.kill();
  await Promise.race([exited, sleep(3000)]);
};

// --- MaveScape ----------------------------------------------------------------------------------------

const binary = join(temp, process.platform === 'win32' ? 'mavescape.exe' : 'mavescape');
await new Promise((done, fail) => spawn('go', ['build', '-o', binary, '.'], { cwd: ROOT, stdio: 'inherit' }).on('exit', (code) => (code ? fail(new Error('go build failed (is Go installed?)')) : done())));
const cache = join(temp, 'cache');
cpSync(join(ROOT, 'validation/fixtures/public-data'), cache, { recursive: true });

let proteoscope = null;
let maveScape = null;
let page = null;
let psPage = null;
try {
  proteoscope = await started(program, ['--no-open', '--port', String(PROTEOSCOPE_PORT), '--cache-dir', psCache], /running at (http:\/\/[\d.]+:\d+)/, 'Proteoscope');
  const psPort = Number(/:(\d+)\/$/.exec(proteoscope.url)[1]);
  maveScape = await started(binary, ['--remote-control', '--window', 'none', '--port', String(PORT), '--data-dir', library, '--offline', '--cache-dir', cache, '--proteoscope', String(psPort)], /running at (http:\/\/[\d.]+:\d+)/, 'MaveScape');
  for (let i = 0; i < 100 && !existsSync(join(library, 'remote.json')); i += 1) await sleep(100);
  const token = JSON.parse(readFileSync(join(library, 'remote.json'), 'utf8')).token;
  const act = async (action, args = {}) => {
    const r = await (await fetch(`${maveScape.url}api/remote/action`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-MaveScape-Token': token }, body: JSON.stringify({ action, args, client: 'proteoscope-handoff' }) })).json();
    if (!r.ok) throw new Error(`${action} ${JSON.stringify(args)}: ${r.message ?? r.error}`);
    return r;
  };
  page = await launch({ width: 1400, height: 900, scale: 1 });
  psPage = await launch({ width: 1400, height: 900, scale: 1 });
  await page.goto(maveScape.url, 1500);
  for (let i = 0; i < 100 && !(await page.eval('Boolean(window.mavescape?.remote)')); i += 1) await sleep(100);

  // The view as MaveScape has it, and the camera once still.
  const viewOf = () => page.eval(`import('/ui/mode-structure.js').then((m) => { const v = m.structureState(window.mavescape).viewer; return JSON.stringify({ camera: v.camera, styled: [...v.styled], hidden: v.hidden, focus: v.focused, selection: [...v.selection], labels: [...v.labels] }); })`);
  const still = async () => {
    let last = '';
    for (let i = 0; i < 50; i += 1) {
      const now = await viewOf();
      if (now === last) return JSON.parse(now);
      last = now;
      await sleep(200);
    }
    return JSON.parse(last);
  };
  // What Proteoscope opened: its own session of it, the residues its own reader keys, its legend.
  const opened = async (expectName) => {
    for (let i = 0; i < 300; i += 1) {
      const ready = await psPage.eval(`Boolean(globalThis.proteoscope && proteoscope.structures().length && proteoscope.state.active && !document.querySelector('.loading:not(.hidden)'))`).catch(() => false);
      if (ready) break;
      await sleep(200);
    }
    await sleep(1500);
    return psPage.eval(`(async () => {
      const s = await proteoscope.session();
      const e = proteoscope.state.active;
      const model = e.structure.models[e.activeModel ?? 0];
      const keys = new Set(model.residues.map((r) => r.key));
      const one = s.structures[0];
      const data = one.proteomics.data ?? [];
      return { version: proteoscope.state.startup?.version, structures: s.structures.length, name: one.name, source: one.source, color: one.color, data, dataLabel: one.proteomics.dataLabel, unknown: data.filter(([k]) => !keys.has(k)).map(([k]) => k), selection: one.selection, labels: one.labels, focus: one.focus, styles: one.display.residueStyles, hidden: one.display.hiddenResidues, camera: s.view.camera, legend: document.querySelector('.legend, #legend')?.textContent ?? '', expect: ${JSON.stringify(expectName)} };
    })()`);
  };
  const sameNumbers = (a, b, tol = 1e-9) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) <= tol * Math.max(1, Math.abs(x)));

  // 1. A PDB entry, by the link.
  await act('open_example', { id: 'grb2' });
  await act('open_structure', { pdb: '2VWF' });
  await act('set_structure', { color: 'median', select: 'pos 20-26', show: 'sticks' });
  await act('set_structure', { select: 'chain B and resi 1-3', show: 'hide' });
  await act('set_structure', { select: 'pos 25', focus: true });
  await act('set_structure', { select: 'pos 21+25', label: true });
  const view = await still();
  const handed = await act('proteoscope_link');
  const sent = handed.data.session.structures[0];
  await psPage.goto(handed.data.link, 1000);
  const back = await opened('2VWF');
  const sameData = JSON.stringify(back.data) === JSON.stringify(sent.proteomics.data);
  check(`Proteoscope ${back.version} opens the link MaveScape makes of 2VWF colored by GRB2's median scores: the entry fetched by its ID, the scores as its custom residue data on the residues its own reader reads (none it does not know), titled as MaveScape titles them, on blue–white–red over the map's range centered on the wild type`, `${handed.data.how}; ${back.name} from ${JSON.stringify(back.source)}; ${back.data.length} values (${sent.proteomics.data.length} sent), ${back.unknown.length} on residues it does not know; "${back.dataLabel}"; ${back.color.scheme} ${back.color.colormap} ${back.color.range?.min?.toFixed(3)} to ${back.color.range?.max?.toFixed(3)}; legend "${back.legend.replace(/\s+/g, ' ').slice(0, 80)}"`,
    handed.data.how === 'session' && back.structures === 1 && back.source?.type === 'fetch' && back.source.id === '2VWF' && sameData && back.data.length === 56 && !back.unknown.length && back.dataLabel === 'Median score, Run 1' && back.color.scheme === 'data' && back.color.colormap === 'bwr' && back.color.range.min === sent.color.range.min && back.color.range.max === sent.color.range.max && /Median score, Run 1/i.test(back.legend));
  check('…with the residues drawn as sticks, hidden, focused on, selected and labeled as MaveScape drew them, and its camera', `styles ${back.styles?.length}, hidden ${back.hidden?.length}, focus ${back.focus?.join(', ')}, selection ${back.selection.join(', ')}, labels ${back.labels.join(', ')}; camera distance ${back.camera.distance.toFixed(3)} (MaveScape ${view.camera.distance.toFixed(3)})`,
    JSON.stringify(back.styles) === JSON.stringify(view.styled) && view.styled.length === 7 && JSON.stringify(back.hidden) === JSON.stringify(view.hidden) && view.hidden.length === 3 && JSON.stringify(back.focus) === JSON.stringify(view.focus) && back.selection.join() === view.selection.join() && back.labels.join() === view.labels.join() && view.labels.length === 2
      && sameNumbers(back.camera.target, view.camera.target) && sameNumbers(back.camera.rotation, view.camera.rotation) && sameNumbers([back.camera.distance, back.camera.fov], [view.camera.distance, view.camera.fov]) && back.camera.orthographic === view.camera.orthographic);

  // 2. An AlphaFold DB model, by the link.
  await act('open_structure', { alphafold: 'target' });
  await act('set_structure', { color: 'median', select: 'pos 21+25', label: true });
  await still();
  const model = await act('proteoscope_link');
  await psPage.goto('about:blank', 300);
  await psPage.goto(model.data.link, 1000);
  const modelBack = await opened('P62993');
  check('Proteoscope opens the link of GRB2\'s AlphaFold DB model colored by the median: the model fetched by its accession, the 56 values on residues its own reader reads, the selection and labels kept', `${model.data.how}; ${JSON.stringify(modelBack.source)}; ${modelBack.data.length} values, ${modelBack.unknown.length} on residues it does not know; selection ${modelBack.selection.join(', ')}`,
    model.data.how === 'session' && modelBack.source?.type === 'fetch' && modelBack.source.id === 'P62993' && JSON.stringify(modelBack.data) === JSON.stringify(model.data.session.structures[0].proteomics.data) && modelBack.data.length === 56 && !modelBack.unknown.length && modelBack.selection.join() === 'A:179:ARG,A:183:ILE' && modelBack.labels.length === 2);

  // 3. A file of the person's: the session file, opened by Proteoscope as a file named to it.
  await act('open_files', { paths: [join(ROOT, 'validation/fixtures/structures/2VWF.pdb.gz')] });
  await act('set_structure', { color: 'median', select: 'pos 21+25', label: true });
  await still();
  const fromFile = await act('proteoscope_link');
  const sessionPath = join(out, '2VWF.proteoscope.json');
  await act('export', { what: 'proteoscope-session', path: sessionPath });
  const second = await started(program, ['--no-open', '--port', String(PROTEOSCOPE_PORT + 10), '--offline', '--no-cache', sessionPath], /running at (http:\/\/[\d.]+:\d+)/, 'Proteoscope (a second)');
  try {
    await psPage.goto('about:blank', 300);
    await psPage.goto(second.url, 1000);
    const fileBack = await opened('2VWF.pdb');
    check('Proteoscope opens the session file MaveScape writes of a file of the person\'s (RCSB\'s PDB-format 2VWF), named to it as a file, offline: the file embedded in it read, the scores on the same 56 residues, the selection and labels kept', `${fromFile.data.how}; ${fileBack.name} (${fileBack.source?.type}); ${fileBack.data.length} values, ${fileBack.unknown.length} on residues it does not know; labels ${fileBack.labels.join(', ')}`,
      fromFile.data.how === 'file' && fileBack.source?.type === 'file' && fileBack.data.length === 56 && !fileBack.unknown.length && JSON.stringify(fileBack.data) === JSON.stringify(sent.proteomics.data) && fileBack.labels.join() === 'A:21:ARG,A:25:ILE');
  } finally {
    await stopped(second.child);
  }
} catch (error) {
  check('the handoff ran to the end', error.stack ?? error.message, false);
} finally {
  await page?.close();
  await psPage?.close();
  await stopped(maveScape?.child);
  await stopped(proteoscope?.child);
  rmSync(temp, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`proteoscope-handoff: ${results.length - failed.length}/${results.length} checks passed (Proteoscope ${version})`);
if (failed.length) process.exitCode = 1;
