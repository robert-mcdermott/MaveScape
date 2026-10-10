// Captures the documentation screenshots from the bundled examples, in the light and dark themes,
// as docs/images/<scene>-<theme>.webp: the README shows the one matching the reader's theme, and
// the website (docs/site/build.mjs copies them) the one matching the page's. Each scene drives a
// MaveScape built from source through its remote control (actions.go), as any script can, on a
// fresh, empty library, so every run gives the same pictures. Follows CytoWeave 0.8.0's
// docs/capture/capture.mjs.
//
//   node docs/capture/capture.mjs [scene …] [--theme light|dark|both] [--audit [--no-shots]]
//
// --audit runs axe-core (node validation/fetch.mjs axe-core fetches it) in every scene with the
// WCAG 2.1 A and AA rules, and writes the violations to docs/capture/audit.json (one entry per scene
// and theme; a run of some scenes replaces only theirs) and a summary to the console; with
// --no-shots, no picture is written.
//
// A scene's name is the name of its pictures, so two scenes may not share one: the run stops
// before it starts if they do.
//
// Needs Go (to build MaveScape) and Chrome, Chromium, Edge or Brave (CHROME=path).

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, sleep } from './cdp.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const IMAGES = join(ROOT, 'docs/images');
const PORT = 8830;
// What the status bar and start page show as the library's place (not this run's temporary one).
const LIBRARY_SHOWN = '~/Library/Application Support/MaveScape';

const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
};
const themes = { light: ['light'], dark: ['dark'], both: ['light', 'dark'] }[option('theme') ?? 'both'];
if (!themes) throw new Error('--theme is light, dark or both');
const wanted = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--theme');
const audit = args.includes('--audit');
const shots = !args.includes('--no-shots');
const AXE = join(ROOT, 'validation/cache/axe-core/axe.min.js');
if (audit && !existsSync(AXE)) throw new Error('axe-core is missing: run node validation/fetch.mjs axe-core');

// --- MaveScape ------------------------------------------------------------------------------------

const temp = mkdtempSync(join(tmpdir(), 'mavescape-capture-'));
const binary = join(temp, process.platform === 'win32' ? 'mavescape.exe' : 'mavescape');
let URL = '';
let token = '';

// Started per scene on an empty library, so that no scene sees another's workspaces.
async function startMaveScape() {
  const library = mkdtempSync(join(temp, 'library-'));
  const server = spawn(binary, ['--remote-control', '--window', 'none', '--port', String(PORT), '--data-dir', library], { cwd: temp, stdio: ['ignore', 'pipe', 'inherit'] });
  let output = '';
  server.stdout.on('data', (chunk) => { output += chunk; });
  const stop = async () => {
    const exited = new Promise((done) => server.once('exit', done));
    server.kill();
    await Promise.race([exited, sleep(3000)]);
  };
  for (let i = 0; i < 150; i += 1) {
    const address = /running at (http:\/\/[\d.]+:\d+)/.exec(output)?.[1];
    if (address && existsSync(join(library, 'remote.json'))) {
      URL = `${address}/`;
      token = JSON.parse(readFileSync(join(library, 'remote.json'), 'utf8')).token;
      return { stop };
    }
    await sleep(100);
  }
  await stop();
  throw new Error(`MaveScape did not start:\n${output}`);
}

// An action through remote control, as any script sends it.
async function act(action, actionArgs = {}) {
  const response = await fetch(`${URL}api/remote/action`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-MaveScape-Token': token }, body: JSON.stringify({ action, args: actionArgs, client: 'docs/capture' }) });
  const result = await response.json();
  if (!result.ok) throw new Error(`${action}: ${result.message ?? result.error}`);
  return result;
}

// --- Page helpers ---------------------------------------------------------------------------------

let b;
const js = (expression) => b.eval(expression);

async function waitFor(expression, timeout = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await js(expression)) return true;
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${expression}`);
}

async function click(text, scope = 'button') {
  const ok = await js(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(scope)})].find((e) => e.offsetParent !== null && e.textContent.trim().includes(${JSON.stringify(text)})); if (!el) return false; el.click(); return true; })()`);
  if (!ok) throw new Error(`No ${scope} "${text}"`);
  await sleep(400);
}

const scrollTo = async (selector, block = 'start') => {
  await js(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: ${JSON.stringify(block)} })`);
  await sleep(500);
};
const clearToasts = () => js(`document.querySelectorAll('.toast').forEach((t) => t.remove())`);
const example = (id) => act('open_example', { id });

// --- Scenes ---------------------------------------------------------------------------------------

const scenes = {
  // The start page: the examples, what to bring, the blank layouts.
  async start() {
    await act('set_mode', { mode: 'start' });
  },
  // A count table and its target opened, the import wizard showing what MaveScape found.
  async import() {
    await act('open_files', { paths: [join(ROOT, 'web/examples/grb2-sh3/target.fasta')] });
    await act('open_files', { paths: [join(ROOT, 'web/examples/grb2-sh3/counts.csv')], review: true });
    await waitFor(`Boolean(document.querySelector('.import-wizard'))`);
    await sleep(800);
  },
  // GRB2's design in the Experiment view, with the workflow strip above it.
  async experiment() {
    await example('grb2-sh3');
    await act('set_mode', { mode: 'experiment' });
    await act('focus', { kind: 'table', name: 'GRB2' });
  },
  // A design drafted from the column names of a table opened by path.
  async 'draft-design'() {
    await act('open_files', { paths: [join(ROOT, 'web/examples/grb2-sh3/counts.csv'), join(ROOT, 'web/examples/grb2-sh3/target.fasta')] });
    await act('draft_design');
    await act('set_mode', { mode: 'experiment' });
  },
  // What the assay measures (wave 2, slice 8): GRB2's readout in MaveDB's terms, and its controls.
  async readout() {
    await example('grb2-sh3');
    await act('set_mode', { mode: 'experiment' });
    await scrollTo('.readout-pane', 'center');
  },
  // Scores with their evidence: the filter flow, the classes, the variants.
  async score() {
    await example('grb2-sh3');
    await act('score', { preset: 'enrich2' });
    await act('focus', { kind: 'run', name: 'Run 1' });
  },
  // GRB2 scored by DiMSum's model: each replicate's scale, shift and error terms.
  async 'dimsum-score'() {
    await example('grb2-sh3');
    await act('score', { preset: 'dimsum' });
    await scrollTo('.replicates-pane', 'center');
  },
  // QC of GRB2: everything passes but the variance beyond counting (a bottleneck).
  async qc() {
    await example('grb2-sh3');
    await act('qc_findings', { finding: 'excess-variance' });
    await sleep(600);
  },
  // A finding in context (wave 2, slice 8): what could cause GRB2's bottleneck, what to do, and the
  // finding acknowledged with a reason, its status unchanged.
  async 'qc-advice'() {
    await example('grb2-sh3');
    await act('acknowledge_finding', { finding: 'excess-variance', reason: 'The input bottleneck the Domainome\'s own analysis reported' });
    await act('qc_findings', { finding: 'excess-variance' });
    await sleep(600);
    await scrollTo('.finding-context', 'center');
  },
  // The same finding's plots: DiMSum's terms put the bottleneck at the inputs.
  async 'dimsum-qc'() {
    await example('grb2-sh3');
    await act('qc_findings', { finding: 'excess-variance' });
    await sleep(600);
    await scrollTo('svg.plot[aria-label^="DiMSum"]', 'center');
  },
  // The map of GRB2, a variant in the inspector.
  async map() {
    await example('grb2-sh3');
    await act('render_map', { color_by: 'score', rows: 'biochemical' });
    await act('inspect_variant', { variant: 'p.Trp36Ala' });
    await sleep(600);
  },
  // A position selected and saved, on the map zoomed in.
  async 'map-selection'() {
    await example('grb2-sh3');
    await act('select_variants', { positions: [35, 36, 37], save_as: 'WW motif' });
    await act('render_map', { zoom: 2 });
  },
  // The simulated example's map colored by standard error: the uncertain cells.
  async 'map-se'() {
    await example('simulated');
    await act('render_map', { color_by: 'se' });
    await act('inspect_variant', { variant: 'p.Gly10Trp' });
  },
  // A time series: a nonsense variant's time course in each replicate, with its fitted lines.
  async 'time-course'() {
    await example('simulated-time-series');
    await act('select_variants', { variants: ['p.Ser2Ter'] });
    await act('inspect_variant', { variant: 'p.Ser2Ter' });
    await sleep(600);
  },
  // A time series in the Score view: scored by weighted regression on every time point.
  async 'time-series-score'() {
    await example('simulated-time-series');
    await act('set_mode', { mode: 'score' });
    await act('focus', { kind: 'run', name: 'Run 1' });
  },
  // A time series' quality control: the fit of the time courses.
  async 'time-series-qc'() {
    await example('simulated-time-series');
    await act('qc_findings', { finding: 'time-fit' });
    await sleep(600);
  },
  // The design of a time series: samples at each time, "Missing = 0" per sample.
  async 'time-series-design'() {
    await example('simulated-time-series');
    await act('set_mode', { mode: 'experiment' });
  },
  // Sorted bins: a nonsense variant's distribution over the bins in each replicate, beside the
  // wild type's.
  async 'sort-seq'() {
    await example('simulated-sort-seq');
    await act('select_variants', { variants: ['p.Ser2Ter'] });
    await act('inspect_variant', { variant: 'p.Ser2Ter' });
    await sleep(600);
  },
  // Sorted bins in the Score view, scored by maximum likelihood.
  async 'sort-seq-score'() {
    await example('simulated-sort-seq');
    await act('score', { parameters: { model: 'bins-mle' } });
  },
  // Sorted bins' quality control: the cells sorted per variant.
  async 'sort-seq-qc'() {
    await example('simulated-sort-seq');
    await act('qc_findings', { finding: 'cells-per-bin' });
    await sleep(600);
  },
  // The design of sorted bins: each bin's value and gates, the cells sorted into it.
  async 'sort-seq-design'() {
    await example('simulated-sort-seq');
    await act('set_mode', { mode: 'experiment' });
    await scrollTo('.experiment-split > div:last-child .pane:nth-child(2)');
  },
  // A table of barcode counts and its barcode-to-variant map opened together: the map applied, the
  // barcodes it gives two variants and those it misses listed.
  async 'barcode-import'() {
    await act('open_files', { paths: [join(ROOT, 'validation/fixtures/barcodes.fasta')] });
    await act('open_files', { paths: [join(ROOT, 'validation/fixtures/barcodes.csv'), join(ROOT, 'validation/fixtures/barcodes.map.csv')], review: true });
    await waitFor(`Boolean(document.querySelector('.import-wizard'))`);
    await sleep(800);
  },
  // A barcoded library scored barcode by barcode: a variant's barcodes in each replicate, one an
  // outlier.
  async barcodes() {
    await example('simulated-barcodes');
    await act('score', { parameters: { aggregation: 'barcode' } });
    await act('render_map', { color_by: 'score', rows: 'biochemical' });
    await act('inspect_variant', { variant: 'p.Glu6Gln' });
    await sleep(600);
    await scrollTo('.barcode-block');
  },
  // A barcoded library's quality control: how a variant's barcodes agree, and the outliers.
  async 'barcode-qc'() {
    await example('simulated-barcodes');
    await act('qc_findings', { finding: 'outlier-barcodes' });
    await sleep(600);
  },
  // Two conditions from shared inputs: the map of their difference, a binding-site variant in the
  // inspector with its score in each condition and the difference.
  async 'differential-map'() {
    await example('simulated-conditions');
    await act('render_map', { color_by: 'differential' });
    await act('inspect_variant', { variant: 'p.Pro13Ala' });
    await sleep(600);
    await scrollTo('#inspector h4.inspector-sub:nth-of-type(2)', 'start');
  },
  // The Score view's comparison of the conditions: how, how many differ, the volcano plot.
  async 'differential-score'() {
    await example('simulated-conditions');
    await act('set_mode', { mode: 'score' });
    await act('focus', { kind: 'run', name: 'Run 1' });
    await scrollTo('.differential-pane', 'center');
  },
  // The record: a run's exports, from the workflow strip.
  async record() {
    await example('grb2-sh3');
    await act('set_mode', { mode: 'score' });
    await click('Export…');
    await sleep(500);
  },
};

// --- Run ------------------------------------------------------------------------------------------

// axe-core in the page: violations of the WCAG 2.1 A and AA rules, with up to five elements each.
async function runAxe() {
  await js(`if (!window.axe) (0, eval)(${JSON.stringify(readFileSync(AXE, 'utf8'))});`);
  return js(`(async () => {
    const result = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] });
    return result.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 5).map((n) => ({ target: n.target.join(' '), summary: n.failureSummary?.split('\\n').slice(0, 3).join(' ') })), count: v.nodes.length }));
  })()`);
}
const audits = [];
const AUDIT_FILE = join(ROOT, 'docs/capture/audit.json');

// Scene names, from the definitions in this file: in an object literal a repeated name silently
// replaces the scene before it, and its pictures overwrite the other's.
{
  const source = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const block = source.slice(source.indexOf('const scenes = {'), source.indexOf('\n};\n', source.indexOf('const scenes = {')));
  const defined = [...block.matchAll(/^ {2}async '?([\w-]+)'?\(\) \{/gm)].map((m) => m[1]);
  const repeated = defined.filter((name, i) => defined.indexOf(name) !== i);
  if (repeated.length) throw new Error(`Scenes defined twice: ${[...new Set(repeated)].join(', ')}. Rename one: a scene's name is the name of its pictures.`);
  if (defined.length !== Object.keys(scenes).length) throw new Error(`Found ${defined.length} scene definitions but ${Object.keys(scenes).length} scenes; keep each scene as "  async name() {" so they can be checked.`);
}

const names = wanted.length ? wanted : Object.keys(scenes);
for (const name of names) if (!scenes[name]) throw new Error(`Unknown scene ${name}. Scenes: ${Object.keys(scenes).join(', ')}`);
mkdirSync(IMAGES, { recursive: true });
await new Promise((done, fail) => spawn('go', ['build', '-o', binary, '.'], { cwd: ROOT, stdio: 'inherit' }).on('exit', (code) => (code ? fail(new Error('go build failed (is Go installed?)')) : done())));
try {
  for (const theme of themes) {
    for (const name of names) {
      const maveScape = await startMaveScape();
      b = await launch();
      try {
        await b.theme(theme === 'dark');
        await b.goto(URL, 800);
        await waitFor('Boolean(window.mavescape?.remote)', 30000);
        // The default library location rather than this run's temporary one, and no commit.
        await js(`(() => { const app = window.mavescape; app.library.location = ${JSON.stringify(LIBRARY_SHOWN)}; app.commit = ''; app.store.notify(['library']); })()`);
        await scenes[name]();
        await clearToasts();
        await sleep(600);
        if (shots) await b.capture(join(IMAGES, `${name}-${theme}.webp`), { format: 'webp', quality: 86 });
        if (audit) {
          const found = await runAxe();
          audits.push({ scene: name, theme, violations: found });
          console.log(`${name} (${theme}): ${found.length ? found.map((v) => `${v.id} ×${v.count} (${v.impact})`).join(', ') : 'no violations'}`);
        } else console.log(`${name} (${theme})`);
      } catch (error) {
        console.error(`${name} (${theme}) failed: ${error.message}`);
        process.exitCode = 1;
      } finally {
        await b.close();
        await maveScape.stop();
      }
    }
  }
} finally {
  rmSync(temp, { recursive: true, force: true });
  if (audit) {
    // Merged with the audits of the scenes not run now; scenes that no longer exist are dropped.
    let previous = [];
    try {
      previous = JSON.parse(readFileSync(AUDIT_FILE, 'utf8'));
    } catch { /* none yet */ }
    const key = (a) => `${a.scene}|${a.theme}`;
    const fresh = new Map(audits.map((a) => [key(a), a]));
    const order = Object.keys(scenes);
    const merged = [...previous.filter((a) => !fresh.has(key(a)) && scenes[a.scene]), ...audits]
      .sort((a, c) => order.indexOf(a.scene) - order.indexOf(c.scene) || a.theme.localeCompare(c.theme));
    writeFileSync(AUDIT_FILE, `${JSON.stringify(merged, null, 1)}\n`);
    const failing = merged.filter((a) => a.violations.length);
    console.log(`\naxe-core: ${audits.length} scene captures; docs/capture/audit.json: ${merged.length} captures of ${order.length} scenes, ${failing.length} with violations${failing.length ? ` (${failing.slice(0, 6).map((a) => `${a.scene} ${a.theme}`).join(', ')})` : ''}.`);
  }
}
