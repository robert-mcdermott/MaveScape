// Reproducibility certificates (wave 6, slice 6; requirement R7; after CytoWeave 0.8.0's
// certificate.js): a workspace archive (lib/archive.js) that also holds every number the
// workspace reports and what it was computed from, so that anyone can compute them again and
// confirm them.
//
// certificate.json records MaveScape's version and commit, the workspace by its SHA-256, every
// file it reads by its SHA-256 (the tables, annotations' files, figures' images, structures' files),
// the head of the hash-chained history, the checkpoints by their states' SHA-256, and the numbers:
//   - each run's scores, SEs and classes (against the wild type, as the robustness check and the
//     diff call them: lib/robustness.js, callsOf), each difference between conditions' estimate,
//     SE, q and class, and the SHA-256 of its whole output;
//   - each run's QC findings (status, value, acknowledgement) and the SHA-256 of its whole QC;
//   - each comparison and robustness check kept in the report, computed again;
//   - each figure panel's drawing by its SHA-256, as the figure's manifest records it;
//   - the report and its references by their SHA-256.
// Its fingerprint, the SHA-256 of its canonical JSON, names exactly what was certified: quoted in
// a paper, it is what a reader checks against.
//
// Every number is computed from the files with the code the window uses (lib/, in a worker there:
// web/workers/certificate-worker.js), and MaveScape's results do not depend on the JavaScript
// engine (lib/dmath.js), so verifying compares them bit for bit: Node and every browser give the
// same bytes. Numbers are kept in JSON as their shortest round-trip text; NaN and infinities as
// text.
//
// What it proves: that these inputs, analyzed as the workspace records, give these numbers. Not
// that the scores are right: that rests on the experiment's design and the model's assumptions.

import { annotationFiles, archivePath, figureFiles, readArchive, sourceFiles, structureFiles, writeArchive } from './archive.js';
import { sha256 } from './sha256.js';
import { canonicalJSON, serializeWorkspace, verifyHistory } from './workspace.js';
import { readSourceTable } from './source-table.js';
import { engineInput } from './score-input.js';
import { scoreExperiment } from './score.js';
import { outputDigest, recordedInputs, reproduction, runId } from './runs.js';
import { callsOf, robustnessChoices, runRobustness, specifications, summarizeRobustness } from './robustness.js';
import { computeQC } from './qc.js';
import { findingsFrom, measuresOf, withDefaultThresholds } from './findings.js';
import { analysisName, comparisonRecord, robustnessRecord, writeReport } from './report.js';
import { writeMethods } from './methods.js';
import { annotationOf, comparePair, pairCaches, runOf } from './compare-pair.js';
import { NO_FILTERS } from './compare.js';
import { pngImage, resolveFigure } from './figure-data.js';
import { figureMarks } from './figures.js';
import { panelDigests, panelInputs } from './figure-manifest.js';
import { readsVariants, runTrackList, trackContext } from './run-tracks.js';
import { designSource } from './qc-subjects.js';
import { stateDigest } from './diff.js';
import { now as clockNow } from './clock.js';
import { possessive } from './words.js';

export const CERTIFICATE_FORMAT = 'mavescape-certificate';
export const CERTIFICATE_VERSION = 1;
export const CERTIFICATE_NAME = 'certificate.json';
export const README_NAME = 'README.txt';
export const EXIT = { verified: 0, differs: 1, incomplete: 2 };
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const count = (n) => n.toLocaleString('en-US');
const plural = (n, word, many = `${word}s`) => `${count(n)} ${n === 1 ? word : many}`;
const list = (items) => (items.length > 2 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : items.join(' and '));
const short = (hash) => (hash ? `${hash.slice(0, 12)}…` : '—');

// --- Numbers -------------------------------------------------------------------------------------

// A number as certificate.json keeps it: finite numbers as themselves (JSON writes the shortest
// text that reads back to the same double; -0 as 0), NaN and infinities as text, a missing value as
// null.
export function encodeNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number') return value;
  if (Number.isNaN(value)) return 'NaN';
  if (value === Infinity) return 'Infinity';
  if (value === -Infinity) return '-Infinity';
  return value === 0 ? 0 : value;
}

const numbersOf = (values) => Array.from(values ?? [], encodeNumber);

// Every number in a value encoded, typed arrays as lists (for a digest of a whole result).
export function encodeAll(value) {
  if (typeof value === 'number') return encodeNumber(value);
  if (ArrayBuffer.isView(value)) return Array.from(value, encodeNumber);
  if (Array.isArray(value)) return value.map(encodeAll);
  if (value instanceof Map) return encodeAll(Object.fromEntries(value));
  if (value instanceof Set) return encodeAll([...value]);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined && typeof v !== 'function').map(([k, v]) => [k, encodeAll(v)]));
  return value ?? null;
}

const digestOf = (value) => sha256(encoder.encode(canonicalJSON(encodeAll(value))));
const textDigest = (text) => sha256(encoder.encode(text));

// --- What a certificate reads and checks ------------------------------------------------------------

// The tables the numbers are computed from: each run's, and the design's when a figure draws a QC
// panel of the counts. A Set of SHA-256.
function neededTables(ws) {
  const out = new Set();
  const add = (source) => {
    if (source) for (const f of sourceFiles(source).slice(0, source.files?.length || 1)) out.add(f.sha256);
  };
  for (const run of ws.runs) add(ws.sources.find((s) => s.sha256 === run.inputs.source.sha256));
  if ((ws.figures ?? []).some((f) => f.panels.some((p) => p.kind === 'qc' && p.subject === 'counts'))) add(designSource(ws));
  return out;
}

// Every file the workspace names by its SHA-256, once: [{ role ('table', 'annotation', 'image',
// 'structure'), name, fileName, sha256, needed (the numbers are computed from it) }].
export function certificateInputs(ws) {
  const out = [];
  const seen = new Set();
  const tables = neededTables(ws);
  const add = (role, f, name, needed) => {
    if (!f.sha256 || seen.has(f.sha256)) return;
    seen.add(f.sha256);
    out.push({ role, name, fileName: f.fileName ?? null, sha256: f.sha256, needed });
  };
  for (const s of ws.sources) for (const f of sourceFiles(s)) add('table', { ...f, fileName: f.fileName ?? s.fileName }, s.name, tables.has(f.sha256));
  for (const f of annotationFiles(ws)) add('annotation', f, f.name, true);
  for (const f of figureFiles(ws)) add('image', f, f.name, true);
  for (const f of structureFiles(ws)) add('structure', f, f.name, false);
  return out;
}

// What a certificate does not compute again, and why: [{ what, reason }].
export function notChecked(ws) {
  const out = [];
  for (const s of ws.selections ?? []) {
    out.push({ what: `the selection "${s.name}" (${plural(s.keys?.length ?? 0, 'variant')}${s.query ? `, by the query "${s.query}"` : ''})`, reason: 'its variants are recorded as chosen; a query is not run again' });
  }
  if ((ws.structureViews ?? []).length) {
    const views = ws.structureViews;
    out.push({ what: views.length === 1 ? `the saved structure view "${views[0].name}"` : `the ${count(views.length)} saved structure views`, reason: `${views.length === 1 ? 'its structure\'s file is' : 'their structures\' files are'} checked by ${views.length === 1 ? 'its' : 'their'} SHA-256; what a view computes from a structure (its evidence, contacts and colors) is not computed again` });
  }
  for (const fig of ws.figures ?? []) {
    fig.panels.forEach((p) => {
      const named = (p.tracks ?? []).filter((id) => id.startsWith('structure:'));
      if (p.kind === 'map' && named.length) out.push({ what: `a map panel of the figure "${fig.name}" (${named.length === 1 ? 'a track' : `${named.length} tracks`} of the structure shown)`, reason: 'the structure\'s tracks need the structure open in the window: the panel is drawn and certified without them' });
      if (p.kind === 'structure') out.push({ what: `a structure panel of the figure "${fig.name}"`, reason: 'its image, drawn from the saved view, is an input checked by its SHA-256; its placing on the page is certified' });
    });
  }
  return out;
}

// --- Computing every number ------------------------------------------------------------------------

// Every number the certificate reports, computed from the files. file(sha256) → bytes or null (a
// promise). options: { software: { version, commit } (the report says them: the certificate's
// when verifying), onProgress(fraction, text) }. Returns { numbers, blocked: Map(group → why),
// missing: [{ sha256, fileName }], notes, results: Map(run id → results), report, methods }.
// A group is what a number belongs to: 'run:<id>', 'qc:<id>', 'analysis:<id>',
// 'figure:<id>:<panel>', 'report'; a group is blocked when a file it reads is missing.
export async function computeNumbers(ws, file, options = {}) {
  const progress = async (fraction, text) => options.onProgress?.(fraction, text);
  const notes = [];
  const blocked = new Map();
  const missing = new Map();
  const block = (groups, why) => {
    for (const g of groups) if (!blocked.has(g)) blocked.set(g, why);
  };
  const bytesOf = new Map();
  const fileOf = async (sha) => {
    if (!bytesOf.has(sha)) {
      const bytes = (await file(sha)) ?? null;
      bytesOf.set(sha, bytes && sha256(bytes) === sha ? bytes : null);
    }
    return bytesOf.get(sha);
  };

  // The tables, each read once.
  const tables = new Map();
  const tableOf = async (source) => {
    if (!tables.has(source.id)) {
      try {
        const target = ws.targets.find((t) => t.id === source.target) ?? null;
        tables.set(source.id, { table: await readSourceTable(source, { target, file: fileOf }) });
      } catch (error) {
        if (error.missing) missing.set(error.missing.sha256, error.missing);
        tables.set(source.id, { error: error.missing ? `the table ${error.missing.fileName} (SHA-256 ${short(error.missing.sha256)}) is missing` : error.message, absent: Boolean(error.missing) });
      }
    }
    return tables.get(source.id);
  };

  // The annotations' texts.
  const texts = new Map();
  for (const a of ws.annotations ?? []) {
    const bytes = a.file?.sha256 ? await fileOf(a.file.sha256) : null;
    if (bytes) texts.set(a.id, decoder.decode(bytes));
    else if (a.file?.sha256) missing.set(a.file.sha256, { sha256: a.file.sha256, fileName: a.file.fileName });
  }

  // QC as the window computes it (its thresholds' measures), each once.
  const thresholds = withDefaultThresholds(ws.qc?.thresholds);
  const measures = measuresOf(thresholds);
  const qcs = new Map();
  const qcOf = async (inputs, results = null) => {
    const key = canonicalJSON({ sha256: inputs.source.sha256, design: inputs.design, parameters: inputs.parameters, measures });
    if (!qcs.has(key)) {
      const t = await tableOf(inputs.source);
      if (t.error) qcs.set(key, { message: t.error, absent: t.absent });
      else {
        try {
          let scored = results;
          if (!scored && inputs.parameters) {
            const s = scoreExperiment({ ...engineInput(t.table, inputs.design), design: inputs.design, parameters: inputs.parameters, mode: inputs.mode });
            scored = s.ok ? s.results : null;
          }
          qcs.set(key, { qc: computeQC({ ...engineInput(t.table, inputs.design), design: inputs.design, mode: inputs.mode, results: scored, measures }) });
        } catch (error) {
          qcs.set(key, { message: error.message });
        }
      }
    }
    return qcs.get(key);
  };

  const numbers = { runs: [], qc: [], analyses: [], figures: [], report: null };
  const runs = new Map();
  const findings = new Map();
  const steps = ws.runs.length * 2 + (ws.analyses ?? []).length + (ws.figures ?? []).length + 1;
  let step = 0;

  // Each run, scored again from its recorded inputs, and its QC.
  for (const run of ws.runs) {
    await progress(step++ / steps, `Scoring ${run.name} again`);
    const groups = [`run:${run.id}`, `qc:${run.id}`];
    const source = ws.sources.find((s) => s.sha256 === run.inputs.source.sha256);
    const t = source ? await tableOf(source) : { error: `its table (SHA-256 ${short(run.inputs.source.sha256)}) is not in the workspace` };
    if (t.error) {
      block(groups, t.error);
      runs.set(run.id, { message: t.error, absent: true });
      step += 1;
      continue;
    }
    const recorded = recordedInputs(run);
    let scored;
    try {
      scored = scoreExperiment({ ...engineInput(t.table, recorded.design), design: recorded.design, parameters: recorded.parameters, mode: recorded.mapping.mode });
    } catch (error) {
      scored = { ok: false, errors: [error.message] };
    }
    if (!scored.ok) {
      const message = scored.errors.join(' ');
      runs.set(run.id, { message });
      numbers.runs.push({ id: run.id, name: run.name, recorded: run.output.sha256, output: null, error: message, variants: [], conditions: [], contrasts: [] });
      step += 1;
      continue;
    }
    const results = scored.results;
    runs.set(run.id, { results });
    const digest = outputDigest(results);
    if (digest !== run.output.sha256) notes.push(`${possessive(run.name)} scores computed now are not the ones recorded when it was scored: ${reproduction(run, digest, 'this version').message} The certificate records the scores computed now.`);
    const calls = callsOf(results, recorded.design);
    const nc = results.conditions.length;
    numbers.runs.push({
      id: run.id,
      name: run.name,
      recorded: run.output.sha256,
      output: digest,
      variants: Array.from(results.variants.key),
      conditions: results.conditions.map((c, j) => ({ id: c.id, name: c.name, score: numbersOf(c.score), se: numbersOf(c.se), class: Array.from(calls[j].cls) })),
      contrasts: (results.differential ?? []).map((d, j) => ({ id: d.id ?? d.name, name: d.name, delta: numbersOf(d.delta), se: numbersOf(d.se), q: numbersOf(d.q), class: Array.from(calls[nc + j].cls) })),
    });
    await progress(step++ / steps, `The QC of ${run.name}`);
    const q = await qcOf({ source, design: recorded.design, parameters: recorded.parameters, mode: recorded.mapping.mode }, results);
    if (!q.qc) {
      numbers.qc.push({ run: run.id, name: run.name, digest: null, error: q.message, findings: [] });
      continue;
    }
    const f = findingsFrom(q.qc, thresholds, { acknowledged: ws.qc?.acknowledged });
    findings.set(run.id, f);
    numbers.qc.push({ run: run.id, name: run.name, digest: digestOf(q.qc), findings: f.map((x) => ({ id: x.id, status: x.status, value: encodeAll(x.value ?? null), acknowledged: x.acknowledged?.current ? x.acknowledged.status : null })) });
  }

  // What comparisons read: the runs' scores and the annotations' texts.
  const get = { results: (run) => runs.get(run?.id)?.results ?? null, text: (a) => texts.get(a.id) ?? null };
  const caches = pairCaches();
  const sideBlocked = (spec) => {
    const a = annotationOf(ws, spec);
    if (a) return a.file?.sha256 && !texts.has(a.id) ? `${a.name}'s file is missing` : null;
    const run = runOf(ws, spec);
    return run && runs.get(run.id)?.absent ? runs.get(run.id).message : null;
  };

  // The analyses kept in the report, computed again.
  for (const a of ws.analyses ?? []) {
    await progress(step++ / steps, `Computing ${analysisName(a)} again`);
    const group = `analysis:${a.id}`;
    if (a.kind === 'comparison') {
      const why = sideBlocked(a.a.spec) ?? sideBlocked(a.b.spec);
      if (why) {
        block([group], why);
        continue;
      }
      const pair = { a: a.a.spec, b: a.b.spec };
      const c = comparePair(ws, pair, get, { filters: a.filters ?? NO_FILTERS, scale: a.scale?.mode ?? 'scored', caches });
      const values = c.error ? { error: c.error } : (({ matched, statistics, discordance, classes }) => ({ matched, statistics, discordance, classes }))(comparisonRecord(c, pair));
      numbers.analyses.push({ id: a.id, kind: a.kind, name: analysisName(a), values: encodeAll(values) });
      if (canonicalJSON(encodeAll(values)) !== canonicalJSON(encodeAll({ matched: a.matched, statistics: a.statistics, discordance: a.discordance, classes: a.classes }))) notes.push(`${analysisName(a).replace(/^./, (x) => x.toUpperCase())}, kept in the report, is not what it computes now; the certificate records what it computes now (add it to the report again to update it).`);
    } else if (a.kind === 'robustness') {
      const run = ws.runs.find((r) => r.id === a.run.id);
      const got = run ? runs.get(run.id) : null;
      if (!run || got?.absent) {
        block([group], got?.message ?? `its run ${a.run.name} is not in the workspace`);
        continue;
      }
      let values;
      if (!got.results) values = { error: got.message };
      else {
        const recorded = recordedInputs(run);
        const source = ws.sources.find((s) => s.sha256 === run.inputs.source.sha256);
        const t = await tableOf(source);
        const { choices } = robustnessChoices(recorded.design, recorded.parameters, got.results);
        const specs = choices.length ? specifications(choices, { max: a.max, seed: a.seed }) : [];
        const out = runRobustness({ ...engineInput(t.table, recorded.design), design: recorded.design, parameters: recorded.parameters, mode: recorded.mapping?.mode ?? 'lenient', choices, specs });
        const summary = summarizeRobustness(out, choices, got.results, recorded.design);
        if (summary.error) values = { error: summary.error };
        else {
          const r = robustnessRecord(run, summary, { max: a.max, seed: a.seed });
          values = { total: r.total, skipped: r.skipped, targets: r.targets.map((x) => ({ id: x.id, n: x.n, counts: x.counts })) };
        }
      }
      numbers.analyses.push({ id: a.id, kind: a.kind, name: analysisName(a), values: encodeAll(values) });
      const kept = { total: a.total, skipped: a.skipped, targets: a.targets.map((x) => ({ id: x.id, n: x.n, counts: x.counts })) };
      if (canonicalJSON(encodeAll(values)) !== canonicalJSON(encodeAll(kept))) notes.push(`${analysisName(a).replace(/^./, (x) => x.toUpperCase())}, kept in the report, is not what it computes now; the certificate records what it computes now (check it again and add it to the report to update it).`);
    }
  }

  // The figures, each panel drawn as the window draws it.
  const ctx = {
    ws,
    results: async (run) => runs.get(run.id) ?? { message: 'it was not scored' },
    // A run's QC is computed above under the same key (its table, design, parameters, measures).
    qc: (inputs) => qcOf(inputs),
    comparison: async (pair, filters, level, scale) => comparePair(ws, pair, get, { filters, level, scale, caches }),
    tracks: async (run, model) => {
      let table = null;
      const own = runs.get(run.id)?.results ?? null;
      if (readsVariants(ws, run)) {
        const source = ws.sources.find((s) => s.sha256 === run.inputs.source.sha256);
        table = own && source ? (await tableOf(source)).table ?? null : null;
      }
      return runTrackList(ws, model, trackContext(ws, run, model, { results: own, table }), (a) => texts.get(a.id) ?? null).tracks;
    },
    image: async (sha) => {
      const bytes = await fileOf(sha);
      return bytes ? pngImage(bytes) : null;
    },
  };
  for (const fig of ws.figures ?? []) {
    await progress(step++ / steps, `Drawing the figure "${fig.name}" again`);
    const resolved = await resolveFigure(ctx, fig);
    const drawn = figureMarks(fig, resolved);
    const digests = panelDigests(fig, drawn);
    const panels = [];
    for (const p of drawn.panels) {
      const panel = fig.panels.find((x) => x.id === p.id);
      const why = panelBlocked(ws, panel, { runs, texts, missing: (sha) => !bytesOf.get(sha), designTable: () => tables.get(designSource(ws)?.id) });
      if (why) {
        block([`figure:${fig.id}:${p.id}`], why);
        continue;
      }
      const data = resolved.get(p.id);
      panels.push({ id: p.id, letter: p.letter, kind: p.kind, drawing: digests.get(p.id), ...(data?.missing ? { missing: data.missing } : {}) });
      if (data?.missing) notes.push(`${p.letter ? `Panel ${p.letter}` : 'A panel'} of the figure "${fig.name}" cannot be drawn: ${data.missing} The certificate records it as drawn so.`);
    }
    numbers.figures.push({ id: fig.id, name: fig.name, panels });
  }
  for (const f of figureFiles(ws)) if (!(await fileOf(f.sha256))) missing.set(f.sha256, { sha256: f.sha256, fileName: f.fileName });

  // The report, written from what was computed (the certified MaveScape's version and commit in it).
  await progress(step++ / steps, 'Writing the report again');
  const absentRuns = ws.runs.filter((r) => runs.get(r.id)?.absent);
  let report = null;
  let methods = null;
  const results = new Map([...runs].filter(([, v]) => v.results).map(([k, v]) => [k, v.results]));
  if (absentRuns.length) block(['report'], `${list(absentRuns.map((r) => r.name))} could not be scored again (${runs.get(absentRuns[0].id).message})`);
  else {
    const info = new Map(ws.runs.map((r) => [r.id, { findings: findings.get(r.id) ?? null, results: runs.get(r.id)?.results ?? null }]));
    report = writeReport(ws, { software: options.software ?? {}, runs: info });
    numbers.report = { markdown: textDigest(report.markdown), bibtex: textDigest(report.bibtex) };
    const last = ws.runs.at(-1);
    if (last) methods = writeMethods(ws, last, { findings: findings.get(last.id) ?? null, thresholds, results: runs.get(last.id)?.results ?? null });
  }
  await progress(1, 'Every number computed');
  return { numbers, blocked, missing: [...missing.values()], notes, results, report, methods };
}

// Why a figure panel cannot be drawn for want of a file: null, or the words.
function panelBlocked(ws, panel, { runs, texts, missing, designTable }) {
  const inputs = panelInputs(ws, panel);
  const runBlocked = (ref) => (ref?.id && runs.get(ref.id)?.absent ? runs.get(ref.id).message : null);
  const annotationBlocked = (ref) => (ref?.id && ref.sha256 && !texts.has(ref.id) ? `${ref.name}'s file is missing` : null);
  const side = (s) => (s?.annotation ? annotationBlocked(s.annotation) : runBlocked(s?.run));
  if (panel.kind === 'qc' && inputs.counts) return designTable()?.absent ? designTable().error : null;
  if (panel.kind === 'compare') return side(inputs.a) ?? side(inputs.b);
  if (panel.kind === 'structure') return inputs.image && missing(inputs.image) ? 'the structure panel\'s image is missing' : null;
  return runBlocked(inputs.run) ?? (inputs.tracks ?? []).map((t) => annotationBlocked(t.annotation)).find(Boolean) ?? null;
}

// --- The numbers one by one --------------------------------------------------------------------------

const RUN_FIELDS = { score: 'score', se: 'SE', class: 'class' };
const CONTRAST_FIELDS = { delta: 'difference', se: 'SE of the difference', q: 'q of the difference', class: 'class of the difference' };

// Each number as [group, key, value, label()] (label made only when asked: a run has thousands).
export function* numberItems(numbers) {
  for (const r of numbers.runs ?? []) {
    const g = `run:${r.id}`;
    yield [g, `run|${r.id}|output`, r.output, () => `${r.name}: the SHA-256 of its whole output`];
    yield [g, `run|${r.id}|variants`, r.variants, () => `${r.name}: its variants, in order`];
    const many = r.conditions.length > 1;
    for (const [j, c] of r.conditions.entries()) {
      for (const [field, word] of Object.entries(RUN_FIELDS)) {
        const values = c[field] ?? [];
        for (let i = 0; i < values.length; i += 1) yield [g, `run|${r.id}|${j}|${field}|${i}`, values[i], () => `${r.name}${many ? `, ${c.name}` : ''}: the ${word} of ${r.variants[i] || `row ${i + 1}`}`];
      }
    }
    for (const [j, c] of (r.contrasts ?? []).entries()) {
      for (const [field, word] of Object.entries(CONTRAST_FIELDS)) {
        const values = c[field] ?? [];
        for (let i = 0; i < values.length; i += 1) yield [g, `run|${r.id}|contrast${j}|${field}|${i}`, values[i], () => `${r.name}, ${c.name}: the ${word} of ${r.variants[i] || `row ${i + 1}`}`];
      }
    }
  }
  for (const q of numbers.qc ?? []) {
    const g = `qc:${q.run}`;
    yield [g, `qc|${q.run}|digest`, q.digest, () => `${possessive(q.name)} QC: the SHA-256 of every number it computed`];
    for (const f of q.findings) {
      yield [g, `qc|${q.run}|${f.id}|status`, f.status, () => `${possessive(q.name)} QC finding "${f.id}": its status`];
      yield [g, `qc|${q.run}|${f.id}|value`, f.value, () => `${possessive(q.name)} QC finding "${f.id}": what it found`];
      yield [g, `qc|${q.run}|${f.id}|acknowledged`, f.acknowledged, () => `${possessive(q.name)} QC finding "${f.id}": its acknowledgement`];
    }
  }
  for (const a of numbers.analyses ?? []) {
    const g = `analysis:${a.id}`;
    function* walk(value, path, label) {
      if (Array.isArray(value)) for (const [i, v] of value.entries()) yield* walk(v, `${path}[${i}]`, `${label} ${i + 1}`);
      else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) yield* walk(v, `${path}.${k}`, `${label} ${k}`);
      else yield [g, `analysis|${a.id}|${path}`, value, () => `${a.name.replace(/^./, (x) => x.toUpperCase())}:${label}`];
    }
    yield* walk(a.values, 'values', '');
  }
  for (const f of numbers.figures ?? []) {
    for (const p of f.panels) yield [`figure:${f.id}:${p.id}`, `figure|${f.id}|${p.id}`, p.drawing, () => `The figure "${f.name}", ${p.letter ? `panel ${p.letter}` : `its ${p.kind} panel`}: the SHA-256 of its drawing`];
  }
  if (numbers.report) {
    yield ['report', 'report|markdown', numbers.report.markdown, () => 'The report: the SHA-256 of its text (report.md)'];
    yield ['report', 'report|bibtex', numbers.report.bibtex, () => 'The report: the SHA-256 of its references (report.bib)'];
  }
}

export function countNumbers(numbers) {
  let n = 0;
  for (const _ of numberItems(numbers)) n += 1;
  return n;
}

const same = (a, b) => (a !== null && typeof a === 'object') || (b !== null && typeof b === 'object') ? canonicalJSON(a ?? null) === canonicalJSON(b ?? null) : (a ?? null) === (b ?? null);

// The recorded numbers against those computed: { checked, same, differ: [{ key, label, recorded,
// computed }] (the first `limit`), differs (how many), missing (could not be computed for want of a
// file), missingGroups: [{ group, why }] }.
export function compareNumbers(recorded, computed, blocked = new Map(), { limit = 200 } = {}) {
  const now = new Map();
  for (const [, key, value] of numberItems(computed)) now.set(key, value);
  const out = { checked: 0, same: 0, differ: [], differs: 0, missing: 0, missingGroups: [] };
  const seen = new Set();
  for (const [group, key, value, label] of numberItems(recorded)) {
    out.checked += 1;
    if (blocked.has(group)) {
      out.missing += 1;
      if (!seen.has(group)) {
        seen.add(group);
        out.missingGroups.push({ group, why: blocked.get(group) });
      }
      continue;
    }
    const has = now.has(key);
    const value2 = has ? now.get(key) : undefined;
    if (has && same(value, value2)) out.same += 1;
    else {
      out.differs += 1;
      if (out.differ.length < limit) out.differ.push({ key, label: label(), recorded: value ?? null, computed: has ? value2 ?? null : 'not computed' });
    }
  }
  return out;
}

// --- Writing ---------------------------------------------------------------------------------------

export function certificateFingerprint(certificate) {
  const { fingerprint, ...rest } = certificate;
  return sha256(encoder.encode(canonicalJSON(rest)));
}

export const shortFingerprint = (fingerprint) => (fingerprint ? fingerprint.slice(0, 16).replace(/(.{4})(?!$)/g, '$1-') : '');

// JSON indented by one space, its lists of numbers or text on one line (a run's are thousands long).
export function certificateText(value) {
  const flat = (v) => Array.isArray(v) && v.every((x) => x === null || typeof x !== 'object');
  const write = (v, indent) => {
    if (v === null || typeof v !== 'object' || flat(v)) return JSON.stringify(v);
    const inner = `${indent} `;
    if (Array.isArray(v)) return v.length ? `[\n${v.map((x) => `${inner}${write(x, inner)}`).join(',\n')}\n${indent}]` : '[]';
    const entries = Object.entries(v).filter(([, x]) => x !== undefined);
    return entries.length ? `{\n${entries.map(([k, x]) => `${inner}${JSON.stringify(k)}: ${write(x, inner)}`).join(',\n')}\n${indent}}` : '{}';
  };
  return `${write(value, '')}\n`;
}

function readme(certificate, { tables }) {
  const n = certificate.inputs.reduce((acc, i) => ({ ...acc, [i.role]: (acc[i.role] ?? 0) + 1 }), {});
  const files = [n.table ? plural(n.table, 'table') : '', n.annotation ? plural(n.annotation, 'annotation file') : '', n.image ? plural(n.image, 'figure image') : '', n.structure ? plural(n.structure, 'structure file') : ''].filter(Boolean);
  const v = certificate.software.version ?? '?';
  const row = (name, text) => `  ${name.padEnd(26)} ${text}`;
  const lines = [
    'MaveScape reproducibility certificate',
    '=====================================',
    '',
    `Workspace:    ${certificate.workspace.name}`,
    `Certified:    ${certificate.created} with MaveScape ${v}${certificate.software.commit ? ` (commit ${certificate.software.commit.slice(0, 12)})` : ''}`,
    `Fingerprint:  ${certificate.fingerprint}`,
    `              (short form ${shortFingerprint(certificate.fingerprint)}; cite it with the analysis)`,
    '',
    `This archive holds the workspace, the files it reads (${list(files) || 'none'}) and the ${count(certificate.total)}`,
    'numbers it reports: each run\'s scores, standard errors and classes, its QC findings, the',
    'analyses kept in its report, its figures\' drawings and the report. Verifying it computes every',
    'number again from the files with MaveScape\'s own code and compares them bit for bit.',
    '',
    'What it proves',
    '--------------',
    'That these inputs, analyzed as the workspace records, give these numbers: the analysis is',
    'reproducible, and the record is the one certified (its fingerprint). It does not prove that',
    'the scores are right: that rests on the experiment\'s design and the model\'s assumptions, which',
    'the report (report.md) states.',
    '',
    'To verify it',
    '------------',
    `Install MaveScape ${v} or later (https://github.com/robert-mcdermott/mavescape/releases), then either`,
    '  - open this file in MaveScape, which opens the workspace, verifies it and shows the result, or',
    `  - run:  mavescape verify <this file>${tables ? '' : ' --data <the folder with the tables>'}`,
    '    Exit status: 0 verified, 1 something differs (listed), 2 it could not be checked (a file missing).',
    'Another version of MaveScape can verify it too, and says so: a number may then differ where the',
    'version changed how it is computed.',
    '',
    'Contents',
    '--------',
    row(CERTIFICATE_NAME, 'what was certified: the inputs by SHA-256, the history\'s head, every number'),
    row('workspace.json', 'the workspace (targets, design, runs, QC, selections, analyses, figures, history)'),
    tables ? row('sources/', 'the tables and the other files the workspace reads, named by their SHA-256') : row('sources/', 'the files the workspace reads, but for the tables'),
    row('results/', 'each run\'s scores (CSV)'),
    row('report.md, report.bib', 'the workspace\'s report and its references'),
    row('methods.md, references.bib', 'the latest run\'s methods'),
    row('manifest.json', 'every file of the archive with its SHA-256'),
    ...(tables ? [] : [`  The tables are not included: ${plural(n.table ?? 0, 'table')}, named by ${n.table === 1 ? 'its' : 'their'} SHA-256 in ${CERTIFICATE_NAME}.`]),
    '',
    'Not computed again',
    '------------------',
    ...(certificate.notChecked.length ? certificate.notChecked.map((x) => `  - ${x.what}: ${x.reason}.`) : ['  (nothing)']),
    ...(certificate.notes.length ? ['', 'Notes', '-----', ...certificate.notes.map((x) => `  - ${x}`)] : []),
  ];
  return `${lines.join('\n')}\n`;
}

// Writes a certificate of the workspace: the archive with every file it reads (the tables only
// when options.tables is not false), every number computed again, certificate.json and README.txt.
// file(sha256) → bytes or null. options: { software: { version, commit }, created, tables (default
// true), structures (default: when at hand), onProgress }. Returns { bytes, certificate, notes,
// computed }. Throws when a file the numbers need is missing or a run cannot be scored again.
export async function writeCertificate(ws, file, options = {}) {
  const software = { version: options.software?.version ?? null, commit: options.software?.commit || null };
  const computed = await computeNumbers(ws, file, { software, onProgress: options.onProgress });
  const needed = new Set(certificateInputs(ws).filter((i) => i.needed).map((i) => i.sha256));
  const lacking = computed.missing.filter((m) => needed.has(m.sha256));
  if (lacking.length) throw new Error(`The certificate needs ${lacking.length === 1 ? 'a file' : `${lacking.length} files`} the library does not hold: ${lacking.slice(0, 3).map((m) => `${m.fileName} (SHA-256 ${short(m.sha256)})`).join(', ')}${lacking.length > 3 ? ` and ${lacking.length - 3} more` : ''}. Open ${lacking.length === 1 ? 'it' : 'them'} again first.`);
  const failed = computed.numbers.runs.filter((r) => r.error);
  if (failed.length) throw new Error(`${failed[0].name} cannot be scored again from its recorded inputs: ${failed[0].error}`);
  const includeTables = options.tables !== false;
  const sources = includeTables ? new Map() : null;
  const annotations = new Map();
  const figures = new Map();
  let structures = options.structures === false ? null : new Map();
  const inputs = [];
  for (const input of certificateInputs(ws)) {
    const bytes = (await file(input.sha256)) ?? null;
    if (bytes && sha256(bytes) !== input.sha256) throw new Error(`${input.fileName ?? input.name} no longer has the SHA-256 the workspace records.`);
    let path = null;
    if (bytes) {
      if (input.role === 'table' && sources) sources.set(input.sha256, bytes);
      if (input.role === 'annotation') annotations.set(input.sha256, bytes);
      if (input.role === 'image') figures.set(input.sha256, bytes);
      if (input.role === 'structure' && structures) structures.set(input.sha256, bytes);
      if (input.role !== 'table' || sources) path = input.role === 'structure' && !structures ? null : archivePath(input.sha256, input.fileName);
    }
    inputs.push({ ...input, bytes: bytes ? bytes.length : null, path });
  }
  // Structures go only when every one is at hand (otherwise all are named by their SHA-256).
  if (structures && inputs.some((i) => i.role === 'structure' && i.bytes === null)) {
    structures = null;
    for (const i of inputs) if (i.role === 'structure') i.path = null;
  }
  const workspaceText = serializeWorkspace(ws);
  const history = verifyHistory(ws);
  const certificate = {
    format: CERTIFICATE_FORMAT,
    version: CERTIFICATE_VERSION,
    created: options.created ?? clockNow(),
    software: { name: 'MaveScape', ...software },
    workspace: { id: ws.id, name: ws.name, path: 'workspace.json', sha256: textDigest(workspaceText), modified: ws.modified },
    inputs,
    history: { entries: history.entries, head: history.head, ok: history.ok },
    checkpoints: (ws.checkpoints ?? []).map((c) => ({ id: c.id, name: c.name, created: c.created, sha256: c.sha256 })),
    numbers: computed.numbers,
    total: countNumbers(computed.numbers),
    notChecked: notChecked(ws),
    notes: computed.notes,
  };
  certificate.fingerprint = certificateFingerprint(certificate);
  const { bytes } = await writeArchive(ws, {
    software,
    sources,
    annotations,
    figures,
    structures,
    results: computed.results,
    methods: computed.methods,
    report: computed.report,
    certificate: { json: certificateText(certificate), readme: readme(certificate, { tables: includeTables }) },
  });
  return { bytes, certificate, notes: computed.notes, computed };
}

// --- Reading and verifying ---------------------------------------------------------------------------

// Reads a certificate: { certificate, archive (lib/archive.js's readArchive) }. Throws when the
// file is not a MaveScape archive, or is one without a certificate.
export async function readCertificate(bytes) {
  const archive = await readArchive(bytes);
  if (archive.certificate === null) {
    const error = new Error('This workspace archive is not a certificate (it has no certificate.json): make one from the Report view, or with mavescape\'s certify.');
    error.notCertificate = true;
    throw error;
  }
  let certificate;
  try {
    certificate = JSON.parse(archive.certificate);
  } catch (error) {
    throw new Error(`certificate.json cannot be read: ${error.message}`);
  }
  if (certificate?.format !== CERTIFICATE_FORMAT) throw new Error('certificate.json is not a MaveScape certificate.');
  if (!(certificate.version >= 1) || certificate.version > CERTIFICATE_VERSION) throw new Error(`The certificate was written by a newer MaveScape (format ${certificate.version}); verify it with MaveScape ${certificate.software?.version ?? 'of that version'} or later.`);
  return { certificate, archive };
}

export const isCertificate = (archive) => archive?.certificate !== null && archive?.certificate !== undefined;

// Verifies a certificate (readCertificate's). options: { file(sha256) → bytes or null (files
// supplied beside it: the library's, a folder's), software: this MaveScape's { version, commit },
// onProgress }. Returns a report: { verdict ('verified', 'differs' or 'incomplete'), exit,
// fingerprint, software, workspace, archive, history, checkpoints, inputs, numbers, notChecked,
// notes, summary }.
export async function verifyCertificate(read, options = {}) {
  const { certificate, archive } = read;
  const ws = archive.ws;
  const fingerprint = certificateFingerprint(certificate);
  const report = {
    fingerprint: { recorded: certificate.fingerprint ?? null, computed: fingerprint, ok: fingerprint === certificate.fingerprint },
    software: { certificate: { version: certificate.software?.version ?? null, commit: certificate.software?.commit ?? null }, verifier: { version: options.software?.version ?? null, commit: options.software?.commit || null } },
    workspace: { id: ws.id, name: ws.name, ok: archive.files.has('workspace.json') && sha256(archive.files.get('workspace.json')) === certificate.workspace?.sha256 },
    // The history's own problem is said with the history.
    archive: { problems: archive.problems.filter((x) => !/^The workspace's history/.test(x)) },
  };
  report.software.same = report.software.certificate.version === report.software.verifier.version;
  // The history: its chain, and its head against the one certified.
  const chain = verifyHistory(ws);
  report.history = { ok: chain.ok && chain.head === certificate.history?.head, entries: chain.entries, head: chain.head, recordedHead: certificate.history?.head ?? null, broken: chain.broken.map((b) => ({ index: b.index, time: b.entry.time, action: b.entry.action, reason: b.reason })) };
  // The checkpoints, each state against its SHA-256 and the one certified.
  const recordedCheckpoints = new Map((certificate.checkpoints ?? []).map((c) => [c.id, c.sha256]));
  report.checkpoints = (ws.checkpoints ?? []).map((c) => ({ id: c.id, name: c.name, ok: stateDigest(c.state) === c.sha256 && recordedCheckpoints.get(c.id) === c.sha256 }));
  report.checkpointsMatch = report.checkpoints.length === recordedCheckpoints.size;
  // The inputs: each from the archive or supplied, against its SHA-256.
  const supplied = options.file ?? (async () => null);
  const at = new Map();
  report.inputs = [];
  for (const input of certificate.inputs ?? []) {
    let bytes = archive.sources.get(input.sha256) ?? null;
    let from = bytes ? 'archive' : null;
    let status = bytes ? 'ok' : 'missing';
    if (!bytes && input.path && archive.files.has(input.path)) status = 'changed';
    if (!bytes) {
      const other = (await supplied(input.sha256)) ?? null;
      if (other && sha256(other) === input.sha256) {
        bytes = other;
        from = 'supplied';
        status = 'ok';
      }
    }
    if (bytes) at.set(input.sha256, bytes);
    report.inputs.push({ role: input.role, name: input.name, fileName: input.fileName, sha256: input.sha256, needed: input.needed, status: status === 'missing' && !input.needed ? 'absent' : status, from });
  }
  // Each run's id follows from its recorded inputs (lib/runs.js): one edited after it was scored has
  // another.
  report.runs = ws.runs.map((r) => ({ id: r.id, name: r.name, ok: runId(recordedInputs(r)) === r.id }));
  // The workspace's files must be the inputs certified.
  const named = new Set(certificateInputs(ws).map((i) => i.sha256));
  report.inputsMatch = named.size === (certificate.inputs ?? []).length && (certificate.inputs ?? []).every((i) => named.has(i.sha256));
  // Every number, computed again.
  const computed = await computeNumbers(ws, async (sha) => at.get(sha) ?? null, { software: certificate.software, onProgress: options.onProgress });
  report.numbers = compareNumbers(certificate.numbers ?? {}, computed.numbers, computed.blocked);
  report.notChecked = certificate.notChecked ?? [];
  report.notes = certificate.notes ?? [];
  const differs = !report.fingerprint.ok || !report.workspace.ok || !report.history.ok || !report.inputsMatch || !report.checkpointsMatch || report.runs.some((r) => !r.ok)
    || report.archive.problems.length > 0 || report.checkpoints.some((c) => !c.ok) || report.inputs.some((i) => i.status === 'changed') || report.numbers.differs > 0;
  const incomplete = report.inputs.some((i) => i.status === 'missing') || report.numbers.missing > 0;
  report.verdict = differs ? 'differs' : incomplete ? 'incomplete' : 'verified';
  report.exit = EXIT[report.verdict];
  report.summary = verificationSummary(certificate, report);
  return report;
}

const ROLE_WORDS = { table: ['table', 'tables'], annotation: ['annotation file', 'annotation files'], image: ['figure image', 'figure images'], structure: ['structure file', 'structure files'] };
const files = (items) => {
  const by = new Map();
  for (const i of items) by.set(i.role, (by.get(i.role) ?? 0) + 1);
  return list([...by].map(([role, n]) => plural(n, ...ROLE_WORDS[role])));
};

// What verifying found, in a paragraph.
export function verificationSummary(certificate, report) {
  const name = certificate.workspace?.name ?? report.workspace.name;
  const used = report.inputs.filter((i) => i.status === 'ok');
  const { numbers } = report;
  const parts = [];
  if (report.verdict === 'verified') {
    parts.push(`Verified: all ${plural(numbers.checked, 'number')} of "${name}" were computed again from its ${files(used.filter((i) => i.needed)) || 'record'} and are identical, bit for bit; its files, workspace and history are the ones certified.`);
  } else if (report.verdict === 'incomplete') {
    const absent = report.inputs.filter((i) => i.status === 'missing');
    parts.push(`Not checkable: ${files(absent)} ${absent.length === 1 ? 'is' : 'are'} missing (${absent.slice(0, 3).map((i) => `${i.fileName ?? i.name}, SHA-256 ${short(i.sha256)}`).join('; ')}): supply ${absent.length === 1 ? 'it' : 'them'} beside the certificate (mavescape verify --data). ${count(numbers.same)} of ${plural(numbers.checked, 'number')} ${numbers.same === 1 ? 'was' : 'were'} confirmed; ${count(numbers.missing)} could not be computed.`);
  } else {
    const reasons = [];
    if (!report.fingerprint.ok) reasons.push('certificate.json was changed after it was written (its fingerprint does not match)');
    if (!report.workspace.ok) reasons.push('the workspace was changed after the certificate was written');
    if (report.archive.problems.length) reasons.push(`the archive's files are not those it lists (${report.archive.problems[0].replace(/\.$/, '')})`);
    if (!report.history.ok) reasons.push(report.history.broken.length ? `the history was altered (first at entry ${report.history.broken[0].index + 1}, ${report.history.broken[0].action})` : 'the history is not the one certified');
    if (!report.inputsMatch) reasons.push('the workspace\'s files are not the ones certified');
    const edited = report.runs.filter((r) => !r.ok);
    if (edited.length) reasons.push(`${list(edited.map((r) => r.name))} ${edited.length === 1 ? 'was' : 'were'} edited after ${edited.length === 1 ? 'it was' : 'they were'} scored (${edited.length === 1 ? 'its id does' : 'their ids do'} not follow from ${edited.length === 1 ? 'its' : 'their'} recorded inputs)`);
    if (report.checkpoints.some((c) => !c.ok) || !report.checkpointsMatch) reasons.push('a checkpoint is not the one certified');
    const changed = report.inputs.filter((i) => i.status === 'changed');
    if (changed.length) reasons.push(`${files(changed)} no longer ${changed.length === 1 ? 'has its' : 'have their'} SHA-256 (${changed.slice(0, 3).map((i) => i.fileName ?? i.name).join(', ')})`);
    if (numbers.differs) {
      const d = numbers.differ[0];
      reasons.push(`${plural(numbers.differs, 'number')} ${numbers.differs === 1 ? 'differs' : 'differ'} (first: ${d.label}: ${JSON.stringify(d.recorded)} certified, ${JSON.stringify(d.computed)} now)`);
    }
    parts.push(`Not verified: ${reasons.join('; ')}.${numbers.same ? ` ${count(numbers.same)} of ${plural(numbers.checked, 'number')} ${numbers.same === 1 ? 'is' : 'are'} identical.` : ''}`);
  }
  const v = report.software;
  if (!v.same && v.certificate.version) parts.push(`Certified with MaveScape ${v.certificate.version} and verified with ${v.verifier.version ?? 'another version'}${numbers.differs ? ': a number can differ where the version changed how it is computed' : ''}.`);
  parts.push(`Fingerprint ${shortFingerprint(certificate.fingerprint)}.`);
  return parts.join(' ');
}
