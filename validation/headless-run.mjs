// Headless runs (wave 2, slice 7): mavescape run and mavescape validate, as a pipeline runs them.
//
//   node validation/headless-run.mjs [--verbose]
//
// Builds MaveScape and runs it as a command (headless Chrome: CHROME, else one installed): the GRB2
// example twice with a fixed time (every file the same bytes), with SOURCE_DATE_EPOCH, and without
// a fixed time (the results the same, the records differing only in their times and identifiers);
// the run's archive recomputed in Node (the same output hash and files); the same analysis through
// remote control in a window (the same files); the archive rerun with --from-workspace (the same
// bytes again) and a tampered one refused; two conditions and a table of barcodes (their
// differential and barcode files as Node writes them); the failures, each with its exit status
// and its reasons in run.json (a design that does not fit, parameters that cannot score, a
// blocking QC finding, --strict, a wrong command line); the JSON log; and mavescape validate.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, sleep } from '../docs/capture/cdp.mjs';
import { readArchive, writeArchive } from '../web/lib/archive.js';
import { computeQC } from '../web/lib/qc.js';
import { findingsFrom, measuresOf, withDefaultThresholds } from '../web/lib/findings.js';
import { barcodesCSV, countsCSV, differentialCSV, qcFindingsCSV, qcSamplesCSV, qcVariantsCSV, scoresCSV } from '../web/lib/exports.js';
import { writeMethods } from '../web/lib/methods.js';
import { buildMapModel } from '../web/lib/map-model.js';
import { mapSVG } from '../web/lib/map-svg.js';
import { outputDigest } from '../web/lib/runs.js';
import { inputFor, recompute } from './roundtrip-cases.mjs';
import { readZip } from '../web/lib/zip.js';
import { parseTable } from '../web/lib/csv.js';
import { readiness } from '../web/lib/readiness.js';
import { workspaceOf } from './readiness-cases.mjs';
import { openExampleInNode } from './example-cases.mjs';
import { exampleById } from '../web/lib/examples.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const verbose = process.argv.includes('--verbose');
const results = [];
function check(name, value, ok, required = '') {
  results.push({ name, ok });
  if (verbose || !ok) console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} — ${value}${required ? ` (required ${required})` : ''}`);
}

const temp = mkdtempSync(join(tmpdir(), 'mavescape-headless-'));
const binary = join(temp, process.platform === 'win32' ? 'mavescape.exe' : 'mavescape');
await new Promise((done, fail) => spawn('go', ['build', '-o', binary, '.'], { cwd: ROOT, stdio: 'inherit' }).on('exit', (code) => (code ? fail(new Error('go build failed (is Go installed?)')) : done())));

// mavescape with arguments: { code, stdout, stderr, seconds }.
function mavescape(args, env = {}) {
  return new Promise((done) => {
    const began = Date.now();
    const child = spawn(binary, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('exit', (code) => done({ code, stdout, stderr, seconds: (Date.now() - began) / 1000 }));
  });
}
const out = (name) => join(temp, name);
const files = (dir) => readdirSync(dir).filter((f) => f !== 'run.json').sort();
const record = (dir) => JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8'));
const same = (a, b) => {
  const names = files(a);
  const differ = names.filter((f) => !existsSync(join(b, f)) || Buffer.compare(readFileSync(join(a, f)), readFileSync(join(b, f))) !== 0);
  return { names, differ, ok: !differ.length && names.join() === files(b).join() };
};
const TIME = '2026-10-09T12:00:00Z';
const EPOCH = String(Date.parse(TIME) / 1000);
const grb2 = ['--design', 'web/examples/grb2-sh3/design.json', 'web/examples/grb2-sh3/counts.csv'];

// The files of a run made again in Node from its archive: the run's own recorded inputs.
function nodeFiles(dir) {
  const archive = readArchiveSync(join(dir, 'workspace.msz'));
  const { ws, sources } = archive;
  const run = ws.runs[0];
  const { table, scored } = recompute(ws, sources);
  const r = scored.results;
  const thresholds = withDefaultThresholds(ws.qc?.thresholds);
  const qc = computeQC({ ...inputFor(table, run.inputs.design), design: run.inputs.design, results: r, measures: measuresOf(thresholds) });
  const findings = findingsFrom(qc, thresholds, { acknowledged: ws.qc?.acknowledged });
  const methods = writeMethods(ws, run, { findings, thresholds, results: r });
  const out = {
    'counts.csv': countsCSV(table, run.inputs.design),
    'qc_samples.csv': qcSamplesCSV(qc),
    'qc_variants.csv': qcVariantsCSV(r, run),
    'qc_findings.csv': qcFindingsCSV(findings),
    'methods.md': methods.markdown,
    'references.bib': methods.bibtex,
  };
  if (r.conditions.length > 1) r.conditions.forEach((c, i) => { out[`scores_${c.name.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[_.]+|[_.]+$/g, '')}.csv`] = scoresCSV(r, run, i); });
  else out['scores.csv'] = scoresCSV(r, run);
  if (run.inputs.design.variants.level === 'protein') out['map.svg'] = mapSVG(buildMapModel(r, run.inputs.design), { results: r });
  if (r.barcodes) out['barcodes.csv'] = barcodesCSV(r, run);
  if (r.differential) out['differential.csv'] = differentialCSV(r, run);
  return { files: out, digest: outputDigest(r), recorded: run.output.sha256, ws, sources, run };
}
let archiveReader = null;
function readArchiveSync(path) {
  return archiveReader.get(path);
}

try {
  // --- The GRB2 example, as a pipeline runs it ------------------------------------------------
  const a = await mavescape(['run', ...grb2, '--out', out('a'), '--time', TIME]);
  const b = await mavescape(['run', ...grb2, '--out', out('b'), '--time', TIME]);
  const recA = record(out('a'));
  check('mavescape run: the GRB2 example scored without a window, its files written', `exit ${a.code} in ${a.seconds.toFixed(1)} s; ${files(out('a')).join(', ')}`, a.code === 0 && ['scores.csv', 'counts.csv', 'qc_samples.csv', 'qc_variants.csv', 'map.svg', 'provenance.json', 'methods.md', 'references.bib', 'workspace.msz'].every((f) => files(out('a')).includes(f)));
  const ab = same(out('a'), out('b'));
  check('run twice with --time: every file the same bytes, the provenance and the workspace archive too', `${ab.names.length} files; ${ab.differ.length ? `differ: ${ab.differ.join(', ')}` : 'all identical'}`, b.code === 0 && ab.ok);
  const listed = recA.outputs.every((o) => existsSync(o.path)) && recA.outputs.length === files(out('a')).length;
  check('run.json: the inputs and every output with their SHA-256, each step, the run and its QC', `format ${recA.format} ${recA.version}, exit ${recA.exit}, clock ${recA.clock}; ${recA.inputs.map((i) => `${i.role} ${i.sha256.slice(0, 8)}`).join(', ')}; ${recA.steps.length} steps, all ok: ${recA.steps.every((s) => s.ok)}; ${recA.outputs.length} outputs listed; run ${recA.run?.name} ${recA.run?.outputSha256?.slice(0, 12)}…; QC ${recA.qc?.overall?.status}`,
    recA.format === 'mavescape-run' && recA.exit === 0 && recA.ok && recA.clock === TIME && recA.inputs.length === 2 && recA.steps.every((s) => s.ok) && listed && /^[0-9a-f]{64}$/.test(recA.run?.outputSha256 ?? '') && recA.qc?.overall);

  // SOURCE_DATE_EPOCH, and no fixed time.
  const c = await mavescape(['run', ...grb2, '--out', out('c')], { SOURCE_DATE_EPOCH: EPOCH });
  const ac = same(out('a'), out('c'));
  check('SOURCE_DATE_EPOCH fixes the time as --time does: the same bytes', `exit ${c.code}; ${ac.differ.length ? `differ: ${ac.differ.join(', ')}` : 'all identical'}`, c.code === 0 && ac.ok && record(out('c')).clock === TIME);
  const d = await mavescape(['run', ...grb2, '--out', out('d')], { SOURCE_DATE_EPOCH: '' });
  const ad = same(out('a'), out('d'));
  const strip = (text) => JSON.stringify(JSON.parse(text), (k, v) => (/^(created|imported|modified|time|id|historyHead|exported)$/.test(k) && typeof v === 'string' ? '·' : v));
  const provenanceSame = strip(readFileSync(join(out('a'), 'provenance.json'), 'utf8')) === strip(readFileSync(join(out('d'), 'provenance.json'), 'utf8'));
  check('without a fixed time: the results the same bytes; the provenance differs only in its times and identifiers, the archive in its record', `exit ${d.code}; differ: ${ad.differ.join(', ') || 'none'}; provenance otherwise ${provenanceSame ? 'the same' : 'different'}`, d.code === 0 && ad.differ.every((f) => f === 'provenance.json' || f === 'workspace.msz') && provenanceSame && !record(out('d')).clock);

  // Node, from the run's own archive.
  archiveReader = new Map();
  for (const dir of ['a']) archiveReader.set(join(out(dir), 'workspace.msz'), await readArchive(readFileSync(join(out(dir), 'workspace.msz'))));
  const node = nodeFiles(out('a'));
  const nodeDiffer = Object.entries(node.files).filter(([f, text]) => readFileSync(join(out('a'), f), 'utf8') !== text).map(([f]) => f);
  check('the run\'s archive recomputed in Node: the output hash recorded, and the scores, counts, QC, map, methods and references as Node writes them', `output SHA-256 ${node.digest === node.recorded ? 'as recorded' : 'different'}; ${Object.keys(node.files).length} files, ${nodeDiffer.length ? `differ: ${nodeDiffer.join(', ')}` : 'all identical'}`, node.digest === node.recorded && node.recorded === recA.run.outputSha256 && !nodeDiffer.length);

  // The same analysis through remote control in a window.
  {
    const library = join(temp, 'window-library');
    const server = spawn(binary, ['--remote-control', '--window', 'none', '--port', '8837', '--data-dir', library], { stdio: ['ignore', 'pipe', 'inherit'] });
    let banner = '';
    server.stdout.on('data', (chunk) => { banner += chunk; });
    for (let i = 0; i < 150 && !(/running at/.test(banner) && existsSync(join(library, 'remote.json'))); i += 1) await sleep(100);
    const { url, token } = JSON.parse(readFileSync(join(library, 'remote.json'), 'utf8'));
    const browser = await launch({ width: 1400, height: 900, scale: 1 });
    try {
      await browser.goto(`${url}/`, 1500);
      for (let i = 0; i < 100 && !(await browser.eval('Boolean(window.mavescape?.remote)')); i += 1) await sleep(100);
      const act = async (action, args = {}) => {
        const r = await (await fetch(`${url}/api/remote/action`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-MaveScape-Token': token }, body: JSON.stringify({ action, args, client: 'headless-run' }) })).json();
        if (!r.ok) throw new Error(`${action}: ${r.message ?? r.error}`);
        return r;
      };
      const design = JSON.parse(readFileSync(join(ROOT, 'web/examples/grb2-sh3/design.json'), 'utf8'));
      await act('new_workspace', { name: design.name });
      await act('open_files', { paths: [join(ROOT, 'web/examples/grb2-sh3/counts.csv')] });
      await act('set_design', { design });
      const scored = await act('score');
      const dir = out('window');
      mkdirSync(dir);
      const names = { scores: 'scores.csv', counts: 'counts.csv', 'qc-samples': 'qc_samples.csv', 'qc-variants': 'qc_variants.csv', map: 'map.svg', methods: 'methods.md', references: 'references.bib' };
      for (const [what, file] of Object.entries(names)) await act('export', { what, path: join(dir, file) });
      const differ = Object.values(names).filter((f) => Buffer.compare(readFileSync(join(dir, f)), readFileSync(join(out('a'), f))) !== 0);
      check('the same analysis through remote control in a window: the same scores, counts, QC, map, methods and references', differ.length ? `differ: ${differ.join(', ')}` : `${Object.keys(names).length} files identical`, !differ.length);
      // The analysis package (wave 2, slice 10), written by the window: unpacked, mavescape run
      // with its own files, as its README says, scores the window's run again.
      await act('export', { what: 'package', path: join(dir, 'package.zip') });
      const unpacked = await readZip(new Uint8Array(readFileSync(join(dir, 'package.zip'))));
      const packageDir = out('package');
      for (const [name, data] of unpacked) {
        mkdirSync(dirname(join(packageDir, name)), { recursive: true });
        writeFileSync(join(packageDir, name), data);
      }
      const readme = new TextDecoder().decode(unpacked.get('README.md'));
      const counts = [...unpacked.keys()].filter((n) => n.startsWith('counts/'));
      const rerun = await mavescape(['run', '--design', join(packageDir, 'design.json'), '--parameters', join(packageDir, 'parameters.json'), '--out', out('from-package'), ...counts.map((n) => join(packageDir, n))]);
      const rerunHash = rerun.code === 0 ? record(out('from-package')).run?.outputSha256 : null;
      check('the analysis package written by the window: mavescape run with its files alone, as its README says, scores the window\'s run again', `${[...unpacked.keys()].join(', ')}; exit ${rerun.code}; output SHA-256 ${rerunHash === scored.data.outputSha256 ? 'the window run\'s' : `${rerunHash} against ${scored.data.outputSha256}`}`, rerun.code === 0 && rerunHash === scored.data.outputSha256 && readme.includes('mavescape run --design design.json --parameters parameters.json') && unpacked.has('samples.csv') && unpacked.has('readiness.json'));
    } finally {
      await browser.close();
      server.kill();
    }
  }

  // --- Reruns from a workspace --------------------------------------------------------------
  const e = await mavescape(['run', '--from-workspace', join(out('a'), 'workspace.msz'), '--out', out('e'), '--time', TIME]);
  const ae = same(out('a'), out('e'));
  const recE = record(out('e'));
  check('--from-workspace: the run reproduced from its recorded inputs, every file the same bytes', `exit ${e.code}; ${recE.steps.find((s) => s.action === 'reproduce_run')?.message}; ${ae.differ.length ? `differ: ${ae.differ.join(', ')}` : 'all identical'}`, e.code === 0 && ae.ok && recE.run?.status === 'reproduced');
  {
    // A workspace whose run records another output hash (as if its scores had been edited).
    const { ws, sources } = await readArchive(readFileSync(join(out('a'), 'workspace.msz')));
    const tampered = { ...ws, runs: ws.runs.map((r) => ({ ...r, output: { ...r.output, sha256: 'f'.repeat(64) } })) };
    const written = await writeArchive(tampered, { software: { version: '0.2.0', commit: '' }, sources, results: new Map(), methods: null });
    writeFileSync(out('tampered.msz'), written.bytes);
    const t = await mavescape(['run', '--from-workspace', out('tampered.msz'), '--out', out('t')]);
    const recT = record(out('t'));
    check('--from-workspace with a run that does not reproduce: exit 1, nothing exported, run.json says why', `exit ${t.code}; ${recT.problems.join(' ').slice(0, 160)}`, t.code === 1 && /did not reproduce/.test(recT.problems.join(' ')) && !existsSync(join(out('t'), 'scores.csv')));
  }

  // --- Two conditions, and a table of barcodes ------------------------------------------------
  const two = await mavescape(['run', '--design', 'validation/fixtures/two-condition.design.json', '--out', out('two'), '--time', TIME, 'validation/fixtures/two-condition.csv']);
  archiveReader.set(join(out('two'), 'workspace.msz'), await readArchive(readFileSync(join(out('two'), 'workspace.msz'))));
  const twoNode = nodeFiles(out('two'));
  const twoDiffer = Object.entries(twoNode.files).filter(([f, text]) => !existsSync(join(out('two'), f)) || readFileSync(join(out('two'), f), 'utf8') !== text).map(([f]) => f);
  check('two conditions: a scores file per condition and the differential scores, as Node writes them', `exit ${two.code}; ${files(out('two')).filter((f) => /scores|differential/.test(f)).join(', ')}; ${twoDiffer.length ? `differ: ${twoDiffer.join(', ')}` : 'identical'}`, two.code === 0 && ['scores_Without_ligand.csv', 'scores_With_ligand.csv', 'differential.csv'].every((f) => files(out('two')).includes(f)) && !twoDiffer.length && twoNode.digest === twoNode.recorded);
  const bc = await mavescape(['run', '--design', 'validation/fixtures/barcodes.design.json', '--out', out('bc'), '--time', TIME, 'validation/fixtures/barcodes.csv', 'validation/fixtures/barcodes.map.csv']);
  archiveReader.set(join(out('bc'), 'workspace.msz'), await readArchive(readFileSync(join(out('bc'), 'workspace.msz'))));
  const bcNode = nodeFiles(out('bc'));
  const bcDiffer = Object.entries(bcNode.files).filter(([f, text]) => !existsSync(join(out('bc'), f)) || readFileSync(join(out('bc'), f), 'utf8') !== text).map(([f]) => f);
  check('a table of barcodes with its barcode-to-variant map: assembled, scored, its barcodes exported as Node writes them', `exit ${bc.code}; ${bcDiffer.length ? `differ: ${bcDiffer.join(', ')}` : `${Object.keys(bcNode.files).length} files identical`}`, bc.code === 0 && files(out('bc')).includes('barcodes.csv') && !bcDiffer.length && bcNode.digest === bcNode.recorded);

  // --- Failures -------------------------------------------------------------------------------
  const misfit = await mavescape(['run', '--design', 'web/examples/grb2-sh3/design.json', '--out', out('misfit'), 'validation/fixtures/time-series.csv']);
  const recM = record(out('misfit'));
  check('a design that does not fit the table: exit 1, nothing scored, the reasons in run.json and on stderr', `exit ${misfit.code}; ${recM.problems[0]?.slice(0, 120)}`, misfit.code === 1 && /does not fit/.test(recM.problems.join(' ')) && /run\.json says why/.test(misfit.stderr) && !existsSync(join(out('misfit'), 'scores.csv')));
  writeFileSync(out('params.json'), JSON.stringify({ pseudocount: 0 }));
  const unscorable = await mavescape(['run', ...grb2, '--parameters', out('params.json'), '--out', out('unscorable')]);
  const recU = record(out('unscorable'));
  check('parameters that cannot score: checked before scoring, exit 1, the reason in run.json', `exit ${unscorable.code}; ${recU.problems.join(' ').slice(0, 140)}`, unscorable.code === 1 && /pseudocount/i.test(recU.problems.join(' ')) && !recU.steps.some((s) => s.action === 'score'));
  {
    // An output sample with no counts: QC's blocking finding.
    const lines = readFileSync(join(ROOT, 'web/examples/grb2-sh3/counts.csv'), 'utf8').trim().split(/\r?\n/);
    const head = lines[0].split(',');
    const j = head.indexOf('output_count_rep3');
    writeFileSync(out('empty-sample.csv'), `${[lines[0], ...lines.slice(1).map((l) => l.split(',').map((x, k) => (k === j ? 'NA' : x)).join(','))].join('\n')}\n`);
    // Complete-case normalization, so that the replicate without its output still scores (the wild
    // type's normalization needs the wild type counted in every sample).
    writeFileSync(out('complete.json'), JSON.stringify({ normalization: 'complete' }));
    const blocked = await mavescape(['run', '--design', 'web/examples/grb2-sh3/design.json', '--parameters', out('complete.json'), '--out', out('blocked'), out('empty-sample.csv')]);
    const recB = record(out('blocked'));
    check('a blocking QC finding (an output with no counts): exit 1, the outputs written, run.json names it', `exit ${blocked.code}; ${recB.problems.join(' ').slice(0, 120)}; scores ${existsSync(join(out('blocked'), 'scores.csv')) ? 'written' : 'missing'}`, blocked.code === 1 && recB.qc?.overall?.blocking?.length > 0 && existsSync(join(out('blocked'), 'scores.csv')));
  }
  const strict = await mavescape(['run', ...grb2, '--strict', '--out', out('strict')]);
  check('--strict: any failing QC finding exits 1 (GRB2\'s variance beyond counting)', `exit ${strict.code}; ${record(out('strict')).problems.join(' ')}`, strict.code === 1 && /--strict/.test(record(out('strict')).problems.join(' ')));
  // An acknowledged finding (wave 2, slice 8): --strict reports it, and does not fail on it.
  const reason = 'The input bottleneck the Domainome\'s analysis reported, as expected';
  const acknowledged = await mavescape(['run', ...grb2, '--strict', '--acknowledge', `excess-variance=${reason}`, '--acknowledge', 'depth=Deep enough, so nothing to acknowledge', '--out', out('acknowledged')]);
  const ackRecord = record(out('acknowledged'));
  const ackCsv = existsSync(join(out('acknowledged'), 'qc_findings.csv')) ? readFileSync(join(out('acknowledged'), 'qc_findings.csv'), 'utf8') : '';
  check('--strict --acknowledge excess-variance=…: the finding still fails but is acknowledged, so the run exits 0; the reason is in run.json, the QC findings and the methods', `exit ${acknowledged.code}; acknowledged ${JSON.stringify(ackRecord.qc?.overall?.acknowledged)}; ${ackRecord.problems.join(' ') || 'no problems'}`,
    acknowledged.code === 0 && ackRecord.qc?.overall?.status === 'fail' && ackRecord.qc.overall.acknowledged.includes('excess-variance') && ackCsv.includes(reason) && readFileSync(join(out('acknowledged'), 'methods.md'), 'utf8').includes(reason));
  const badAck = await mavescape(['run', ...grb2, '--acknowledge', 'excess-variance', '--out', out('bad-ack')]);
  check('--acknowledge without a reason is a wrong command line (exit 2)', `exit ${badAck.code}: ${badAck.stderr.trim().split('\n')[0]}`, badAck.code === 2 && /id=reason/.test(badAck.stderr));
  const usage = await Promise.all([
    mavescape(['run', ...grb2]),
    mavescape(['run', ...grb2, '--out', out('a')]),
    mavescape(['run', '--design', 'web/examples/grb2-sh3/design.json', '--out', out('x'), 'no-such-file.csv']),
    mavescape(['run', '--from-workspace', join(out('a'), 'workspace.msz'), '--design', 'web/examples/grb2-sh3/design.json', '--out', out('y')]),
  ]);
  check('a wrong command line, an output folder in use, a missing input, conflicting options: exit 2 with the reason, nothing run', usage.map((u) => `${u.code}: ${u.stderr.trim().split('\n')[0].slice(0, 70)}`).join(' | '), usage.every((u) => u.code === 2 && u.stderr.trim()) && !existsSync(out('x')) && !existsSync(out('y')));

  // --- The JSON log ---------------------------------------------------------------------------
  const logged = await mavescape(['run', ...grb2, '--out', out('json'), '--log', 'json', '--time', TIME]);
  let parsed = [];
  try {
    parsed = logged.stdout.trim().split('\n').map((l) => JSON.parse(l));
  } catch { parsed = []; }
  check('--log json: one JSON object per line, from start to done, each step with its action and outcome', `${parsed.length} lines: ${[...new Set(parsed.map((p) => p.event))].join(', ')}; last ${JSON.stringify(parsed.at(-1) ?? {}).slice(0, 100)}`, logged.code === 0 && parsed.length > 5 && parsed[0].event === 'start' && parsed.at(-1).event === 'done' && parsed.at(-1).exit === 0 && parsed.filter((p) => p.event === 'step').every((p) => p.action && p.ok === true && typeof p.seconds === 'number'));

  // A table of codon variants (wave 2, slice 11): Hsp90's design names the protein variants derived
  // from MaveDB's nucleotide names, and mavescape run reads the table's codons for it.
  {
    writeFileSync(out('per-generation.json'), JSON.stringify({ timeScale: 'unit' }));
    const hsp = await mavescape(['run', '--design', 'web/examples/hsp90/design.json', '--parameters', out('per-generation.json'), '--out', out('hsp90'), '--time', TIME, 'web/examples/hsp90/counts.csv']);
    const node = openExampleInNode(exampleById('hsp90'));
    const recorded = hsp.code === 0 ? record(out('hsp90')).run?.outputSha256 : null;
    check('mavescape run on Hsp90\'s design and MaveDB\'s counts as they are: the codon variants read at the protein level for the design, scored per generation as Node scores the example', `exit ${hsp.code}; output SHA-256 ${recorded === outputDigest(node.scored.results) ? 'Node\'s' : `${recorded} against ${outputDigest(node.scored.results)}`}`, hsp.code === 0 && recorded === outputDigest(node.scored.results));
  }

  // --- mavescape validate ---------------------------------------------------------------------
  const valid = await mavescape(['validate', ...grb2]);
  const invalid = await mavescape(['validate', '--json', '--design', 'web/examples/grb2-sh3/design.json', 'validation/fixtures/time-series.csv']);
  const report = JSON.parse(invalid.stdout || '{}');
  const designOnly = await mavescape(['validate', '--design', 'validation/fixtures/two-condition.design.json']);
  const badParameters = await mavescape(['validate', ...grb2, '--parameters', out('params.json')]);
  const noInput = await mavescape(['validate']);
  // The readiness (wave 2, slice 10): the same in validate --json as in Node, for GRB2 with what
  // the assay measures taken away; and in words without --json.
  {
    const design = JSON.parse(readFileSync(join(ROOT, 'web/examples/grb2-sh3/design.json'), 'utf8'));
    delete design.readout;
    writeFileSync(out('grb2-no-readout.design.json'), JSON.stringify(design));
    const asJson = await mavescape(['validate', '--json', '--design', out('grb2-no-readout.design.json'), 'web/examples/grb2-sh3/counts.csv']);
    const asText = await mavescape(['validate', '--design', out('grb2-no-readout.design.json'), 'web/examples/grb2-sh3/counts.csv']);
    const window = JSON.parse(asJson.stdout || '{}').readiness;
    const node = readiness(workspaceOf(parseTable(new Uint8Array(readFileSync(join(ROOT, 'web/examples/grb2-sh3/counts.csv')))), design));
    check('mavescape validate: the readiness, what each analysis can do and what is missing, the same in validate --json as in Node, and in words without --json', `${window ? `${window.analyses.length} analyses, missing ${window.gaps.map((g) => g.id).join(', ')}` : 'none'}; ${JSON.stringify(window) === JSON.stringify(node) ? 'the same as Node' : 'not as Node'}; text ${/What is missing:/.test(asText.stdout) && /What the assay measures/.test(asText.stdout) ? 'names it' : 'does not'}`, asJson.code === 0 && JSON.stringify(window) === JSON.stringify(node) && window.gaps.some((g) => g.id === 'readout') && /What is missing:/.test(asText.stdout));
  }
  check('mavescape validate: 0 when valid, 1 with what blocks scoring (as JSON with --json), a design alone, parameters checked, 2 for a wrong command line',
    `valid ${valid.code} (${valid.stdout.trim().slice(0, 60)}…); invalid ${invalid.code}, ${report.blocking?.length} problems, table ${report.table?.name}; design alone ${designOnly.code}; parameters ${badParameters.code}; nothing named ${noInput.code}`,
    valid.code === 0 && /^Valid/.test(valid.stdout) && invalid.code === 1 && report.valid === false && report.blocking.some((p) => /does not|no column/.test(p)) && report.inputs.length === 2 && designOnly.code === 0 && badParameters.code === 1 && /pseudocount/i.test(badParameters.stdout) && noInput.code === 2);
} catch (error) {
  check('the headless runs ran to the end', error.stack ?? error.message, false);
} finally {
  if (process.env.KEEP_HEADLESS) console.log(`Kept ${temp}`);
  else rmSync(temp, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`headless-run: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
