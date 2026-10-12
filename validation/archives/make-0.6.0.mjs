// Writes workspace archives and a certificate with MaveScape 0.6.0 itself (run from a v0.6.0
// checkout), so that later versions must reopen them, reproduce their runs, draw their figures
// again, find their checkpoints as kept and verify the certificate (roadmap, "In every wave"). 0.6
// brought figures and a provable record: figures kept with the workspace, analyses kept in its
// report, checkpoints, and certificates. The program is built from the checkout, its page opened in
// a headless browser with a fixed clock, and driven through its remote control as any script
// drives it, offline, on the public data the validation keeps (the fetcher's cached answers,
// validation/fixtures/public-data):
//   - release-0.6.0-grb2-figure.msz: GRB2's SH3 domain (the bundled example): a QC threshold
//     changed and the variance beyond counting acknowledged; Run 2 with the Enrich2-compatible
//     preset; the comparison of Run 1 and Run 2 and Run 1's robustness check kept in the report; a
//     selection by query; UniProt's features and AlphaMissense beside the map; a saved view of 2VWF;
//     a checkpoint before the figure; and a figure of every kind of panel (the map with its tracks,
//     the structure view, a predictor's classes, the replicates' agreement, a variant's evidence and
//     a caption);
//   - release-0.6.0-grb2-figure.certificate.msz: that workspace certified (its tables in it);
//   - release-0.6.0-hsp90-checkpoint.msz: Hsp90 per generation and over its whole time course, a
//     checkpoint, then the columns of generations 9 to 21 set aside and scored again: a design with
//     columns set aside, and a checkpoint whose state differs from now.
// Each archive is then reopened in Node, each of its runs recomputed from its own files to its
// recorded output hash, each checkpoint's state its own SHA-256, every number it reports computed
// again (its figures drawn, its kept analyses as kept); and the certificate verified.
//
// Usage: node make-0.6.0.mjs <v0.6.0 checkout> <out folder> [commit]
// Without a commit, the program records the one it was built from, as Go stamps it ("-dirty" when
// the checkout had changes not yet committed: 0.6.0's are saved before its release commit, as
// 0.5.0's were). Needs Go and Chrome, Chromium, Edge or Brave (CHROME=path).
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [rootArg, outArg, commit = ''] = process.argv.slice(2);
if (!rootArg || !outArg) throw new Error('Usage: node make-0.6.0.mjs <v0.6.0 checkout> <out folder> [commit]');
const root = resolve(rootArg);
const outDir = resolve(outArg);
const lib = (p) => import(pathToFileURL(join(root, p)).href);
const { launch, sleep } = await lib('docs/capture/cdp.mjs');
const { readArchive } = await lib('web/lib/archive.js');
const { outputDigest, reproduction } = await lib('web/lib/runs.js');
const { stateDigest } = await lib('web/lib/diff.js');
const { assignColumn } = await lib('web/lib/design-edit.js');
const { computeNumbers, readCertificate, verifyCertificate } = await lib('web/lib/certificate.js');
const { recompute } = await lib('validation/roundtrip-cases.mjs');

const CLOCK = '2026-10-12T23:00:00.000Z';
const PORT = 8851;
mkdirSync(outDir, { recursive: true });
const temp = mkdtempSync(join(tmpdir(), 'mavescape-release-'));
const library = join(temp, 'library');
const cache = join(temp, 'cache');

// The fetcher's cache: its answers as the validation keeps them (UniProt's features and
// AlphaMissense for GRB2's entry, 2VWF among them).
cpSync(join(root, 'validation/fixtures/public-data'), cache, { recursive: true });

// MaveScape 0.6.0, built from the checkout, offline on that cache, not looking for Proteoscope.
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
  const response = await fetch(`${URL}api/remote/action`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-MaveScape-Token': token }, body: JSON.stringify({ action, args, client: 'make-0.6.0' }) });
  const result = await response.json();
  if (!result.ok) throw new Error(`${action} ${JSON.stringify(args).slice(0, 200)}: ${result.message ?? result.error}`);
  console.log(`  ${action}: ${String(result.message).slice(0, 160)}`);
  return result;
}

const browser = await launch({ width: 1440, height: 900, scale: 1 });
const errors = [];
browser.on('Runtime.exceptionThrown', (e) => errors.push(e.exceptionDetails?.exception?.description ?? e.exceptionDetails?.text));
const written = [];
let certificate = null;
try {
  await browser.goto(`${URL}?clock=${CLOCK}`, 1500);
  for (let i = 0; i < 100 && !(await browser.eval('Boolean(window.mavescape?.remote)')); i += 1) await sleep(100);
  await sleep(500);
  const save = async (file, args = {}) => {
    const path = join(outDir, file);
    await act('export', { what: 'archive', path, overwrite: true, ...args });
    written.push(path);
  };

  console.log('GRB2 SH3: its record, report, checkpoint and a figure of every kind of panel');
  await act('open_example', { id: 'grb2-sh3' });
  // A QC threshold changed as the QC view changes it (remote control has no action for it).
  await browser.eval(`import('/lib/workspace.js').then(({ setQcThresholds }) => { const app = window.mavescape; app.store.commit(setQcThresholds(app.store.ws, { agreement: { review: 0.85, fail: 0.5 } }, 'Replicate agreement: review below 0.85'), 'QC thresholds'); return true; })`);
  await act('acknowledge_finding', { finding: 'excess-variance', run: 'Run 1', reason: 'The input bottleneck the Domainome\'s own analysis found (DiMSum\'s error model puts it at the input)' });
  await act('score', { preset: 'enrich2' });
  await act('compare', { a: 'Run 1', b: 'Run 2', report: true });
  await act('check_robustness', { run: 'Run 1', report: true });
  await act('select_variants', { query: 'lower and position 30-40', run: 'Run 1', save_as: 'Core lower' });
  for (const provider of ['uniprot-features', 'alphamissense']) await act('add_track', { provider });
  await act('open_structure', { pdb: '2VWF' });
  await act('set_structure', { color: 'median', select: 'byres (chain A and protein and within 4 of (chain B and protein))', show: 'sticks' });
  await act('set_structure', { select: '' });
  await sleep(1000);
  await act('save_structure_view', { name: 'Core' });
  await act('checkpoint', { name: 'Before the figure' });
  await act('create_figure', { name: 'Figure 1', height_mm: 210 });
  await act('add_figure_panel', { figure: 'Figure 1', run: 'Run 1', tracks: ['reference', 'uniprot-features:structure', 'alphamissense:alphamissense', 'effect'], x_mm: 3, y_mm: 3, width_mm: 168, height_mm: 100 });
  await act('add_figure_panel', { figure: 'Figure 1', kind: 'structure', view: 'Core', x_mm: 3, y_mm: 106, width_mm: 56, height_mm: 69 });
  await act('add_figure_panel', { figure: 'Figure 1', kind: 'compare', a: 'Run 1', b: 'AlphaMissense', plot: 'classes', x_mm: 62, y_mm: 106, width_mm: 60, height_mm: 69 });
  await act('add_figure_panel', { figure: 'Figure 1', kind: 'qc', subject: 'Run 1', finding: 'agreement', x_mm: 125, y_mm: 106, width_mm: 46, height_mm: 69 });
  await act('add_figure_panel', { figure: 'Figure 1', kind: 'variant', run: 'Run 1', variant: 'p.Trp36Ala', x_mm: 3, y_mm: 178, width_mm: 84, height_mm: 29 });
  await act('add_figure_panel', { figure: 'Figure 1', kind: 'text', text: 'GRB2 SH3 domain: abundance of every substitution (Human Domainome; MaveDB urn:mavedb:00000835-a-1).', x_mm: 90, y_mm: 178, width_mm: 81, height_mm: 29 });
  await act('set_figure', { figure: 'Figure 1', panels: [{ panel: 'C', title: 'Scores by AlphaMissense class' }, { panel: 'D', title: 'Replicates 1 and 2' }] });
  await save('release-0.6.0-grb2-figure.msz');
  const certPath = join(outDir, 'release-0.6.0-grb2-figure.certificate.msz');
  await act('certify', { path: certPath, overwrite: true });
  certificate = certPath;

  console.log('Hsp90: a checkpoint, then its first three samples fitted');
  await act('open_example', { id: 'hsp90' });
  await act('score', { parameters: { timeScale: 'course' } });
  await act('checkpoint', { name: 'All eight samples' });
  let design = JSON.parse(await browser.eval('JSON.stringify(window.mavescape.store.ws.design)'));
  for (const column of ['Gen_9', 'Gen_12', 'Gen_15', 'Gen_18', 'Gen_21']) design = assignColumn(design, column, { kind: 'ignored', reason: 'not used: the first three samples fitted, as the authors fit null-like variants' }).design;
  await act('set_design', { design });
  await act('score', { parameters: { timeScale: 'course' } });
  await save('release-0.6.0-hsp90-checkpoint.msz');
  if (errors.length) throw new Error(`The page threw: ${errors[0]}`);
} finally {
  await browser.close();
  server.kill();
  await sleep(500);
  rmSync(temp, { recursive: true, force: true });
}

// Each archive reopened in Node: each run recomputed from the archive's files, each checkpoint's
// state its own SHA-256, every number computed again (each figure drawn, each kept analysis).
let failed = 0;
for (const path of written) {
  const opened = await readArchive(new Uint8Array(readFileSync(path)));
  const lines = [];
  for (const [index, run] of opened.ws.runs.entries()) {
    const { scored } = recompute(opened.ws, opened.sources, index);
    const verdict = scored.ok ? reproduction(run, outputDigest(scored.results), '0.6.0') : { status: scored.errors[0] };
    if (verdict.status !== 'reproduced') failed += 1;
    lines.push(`${run.name} ${run.output.sha256.slice(0, 12)} ${verdict.status}`);
  }
  const checkpoints = (opened.ws.checkpoints ?? []).map((c) => `${c.name} ${stateDigest(c.state) === c.sha256 ? 'as kept' : 'changed'}`);
  failed += checkpoints.filter((c) => c.endsWith('changed')).length;
  const computed = await computeNumbers(opened.ws, async (sha) => opened.sources.get(sha) ?? null, { software: { version: '0.6.0', commit: '' } });
  failed += computed.notes.length + computed.blocked.size;
  console.log(`${path}: ${readFileSync(path).length} bytes; ${opened.problems.length ? opened.problems.join(' ') : 'no problems'}; ${lines.join(', ')}; checkpoints ${checkpoints.join(', ') || 'none'}; figures ${(opened.ws.figures ?? []).map((f) => `${f.name} (${f.panels.length} panels)`).join(', ') || 'none'}; ${(opened.ws.analyses ?? []).length} analyses kept; ${computed.notes.length} notes, ${computed.blocked.size} not computed`);
}
const read = await readCertificate(new Uint8Array(readFileSync(certificate)));
const verified = await verifyCertificate(read, { software: { version: '0.6.0', commit: read.certificate.software?.commit ?? '' } });
if (verified.verdict !== 'verified') failed += 1;
console.log(`${certificate}: ${readFileSync(certificate).length} bytes; ${verified.summary}`);
if (failed) throw new Error(`${failed} runs not reproduced, checkpoints changed, numbers not computed or the certificate not verified`);
