// The certificate's validation cases (wave 6, slice 6): GRB2's workspace of every operation the
// report describes, with a figure of every kind of panel MaveScape draws from a run (a map, a QC
// finding, scores by class, a comparison, a variant's evidence, text) and a checkpoint; the files
// it reads; an archive taken apart and put together again with a file changed (its manifest
// listing the change, so that only what the certificate checks can catch it); and the
// tamperings, each with what verifying must say.

import { sha256 } from '../web/lib/sha256.js';
import { createZip } from '../web/lib/zip.js';
import { readArchive } from '../web/lib/archive.js';
import { certificateFingerprint, certificateText, numberItems } from '../web/lib/certificate.js';
import { tracedValues, workspaceValue } from '../web/lib/review.js';
import { canonicalJSON, serializeWorkspace } from '../web/lib/workspace.js';
import { addCheckpoint, saveFigure } from '../web/lib/workspace.js';
import { makeCheckpoint } from '../web/lib/diff.js';
import { addPanel, updatePanel } from '../web/lib/figures.js';
import { reportWorkspace } from './report-cases.mjs';
import { exampleById } from './compare-cases.mjs';
import { openExampleInNode } from './example-cases.mjs';
import { SOFTWARE } from './roundtrip-cases.mjs';
import { addSource, addTarget, createWorkspace, setDesign } from '../web/lib/workspace.js';
import { addRun, makeRun, runInputs } from '../web/lib/runs.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// GRB2's workspace of every operation (report-cases.mjs), its figure given a panel of every kind
// drawn from a run, and a checkpoint kept before the figure was finished. Returns reportWorkspace's
// with { ws, files: Map(sha256 → bytes) (the table, the annotation's file, the structure's) }.
export async function certifiedWorkspace() {
  const r = await reportWorkspace();
  let ws = r.ws;
  ws = addCheckpoint(ws, makeCheckpoint(ws, 'Before the figure', '2026-10-12T12:40:00.000Z'), '2026-10-12T12:40:00.000Z').ws;
  // The map on top (in points: the page two columns wide), the other panels below it.
  let fig = updatePanel(ws.figures[0], ws.figures[0].panels[0].id, { x: 8, y: 8, w: 477, h: 150 });
  const run1 = r.g.run.id;
  for (const panel of [
    { kind: 'qc', subject: run1, finding: 'excess-variance', findingTitle: 'Variance beyond counting', x: 8, y: 166, w: 155, h: 120 },
    { kind: 'scores', run: run1, plot: 'distribution', condition: 0, x: 169, y: 166, w: 155, h: 120 },
    { kind: 'compare', a: { run: run1, condition: 0 }, b: { run: r.run2.id, condition: 0 }, scale: 'scored', filters: { lowConfidence: false, maxSE: null, minReads: null }, plot: 'agreement', x: 330, y: 166, w: 155, h: 120 },
    { kind: 'variant', run: run1, condition: 0, variant: 'p.Trp36Ala', plot: 'evidence', x: 8, y: 294, w: 155, h: 100 },
    { kind: 'text', text: 'GRB2 SH3: abundance (aPCA).', x: 169, y: 294, w: 155, h: 30 },
  ]) ({ figure: fig } = addPanel(fig, panel));
  fig = { ...fig, height: 402 };
  ws = saveFigure(ws, fig, 'Finished the figure "Figure 1": a QC finding, the scores, the comparison, a variant\'s evidence and its caption', '2026-10-12T12:45:00.000Z');
  const files = new Map();
  for (const p of r.g.o.parts) files.set(sha256(p.bytes), p.bytes);
  for (const [k, v] of r.files.annotations) files.set(k, v);
  for (const [k, v] of r.files.structures) files.set(k, v);
  return { ...r, ws, files };
}

// An example opened as the window opens it (web/ui/examples.js): its files kept by their SHA-256
// (a barcode map among them), its source's mapping saying how they were assembled (a barcode map
// applied, codon variants read at the protein level), its design's target the workspace's, scored
// with MaveScape's defaults (and what the example sets) as Run 1. Returns { ws, files }.
export function windowExample(id) {
  const example = exampleById(id);
  const o = openExampleInNode(example);
  const { design, table, assembled } = o;
  const stored = o.parts.map((p) => ({ fileName: p.name, sha256: sha256(p.bytes), size: p.bytes.length, ...(p.role === 'map' ? { role: 'map' } : {}) }));
  const countColumns = design.samples.flatMap((s) => s.columns);
  const barcodeColumn = design.library?.level === 'barcode' ? design.library.barcodeColumn : null;
  let ws = createWorkspace(example.title, { now: '2026-10-12T12:00:00.000Z', id: `ws-${id}` });
  const target = addTarget(ws, design.targets[0]);
  ws = target.ws;
  const source = {
    name: `${example.title}: counts`, fileName: stored[0].fileName, sha256: stored[0].sha256, size: stored[0].size, files: stored, rows: table.rows,
    columns: table.columns.map((c) => ({ name: c.name, type: c.type, missing: c.missing })),
    mapping: {
      variantColumn: design.variants.column, level: design.variants.level, mode: 'lenient', countColumns, scoreColumns: {},
      ...(barcodeColumn ? { barcodeColumn } : {}),
      ...(assembled.map ? { assembly: { kind: assembled.kind, map: { barcodeColumn: assembled.map.mapBarcodeColumn, variantColumn: assembled.map.mapVariantColumn } } } : {}),
      ...(assembled.kind === 'codons' ? { assembly: { kind: 'codons', codons: example.assembly.codons } } : {}),
    },
    target: target.id, imported: '2026-10-12T12:00:00.000Z',
  };
  const added = addSource(ws, source);
  ws = setDesign(added.ws, { ...design, targets: [{ ...design.targets[0], id: target.id }] }, `The design of the example "${example.title}"`, added.id);
  const run = makeRun({ inputs: runInputs({ source: ws.sources[0], design: ws.design, parameters: o.parameters }), source: ws.sources[0], results: o.scored.results, software: SOFTWARE, name: 'Run 1', created: '2026-10-12T12:00:00.000Z' });
  ws = addRun(ws, run).ws;
  return { ws, files: new Map(o.parts.map((p) => [sha256(p.bytes), p.bytes])) };
}

// An archive taken apart, edited (edit(files: Map(path → bytes)) changes, adds or deletes files),
// and put together again with its manifest listing what it now holds, in the order written.
export async function repack(bytes, edit) {
  const read = await readArchive(bytes);
  const files = new Map(read.files);
  await edit(files);
  const manifest = JSON.parse(decoder.decode(files.get('manifest.json')));
  files.delete('manifest.json');
  manifest.contents = [...files].map(([path, data]) => ({ path, sha256: sha256(data), bytes: data.length }));
  const all = [{ name: 'manifest.json', data: encoder.encode(`${JSON.stringify(manifest, null, 2)}\n`) }, ...[...files].map(([name, data]) => ({ name, data }))];
  return createZip(all, { date: new Date(read.ws.modified), utc: true });
}

const json = (files, name) => JSON.parse(decoder.decode(files.get(name)));

// certificate.json edited; with refingerprint, its fingerprint made again to match.
export function editCertificate(files, change, { refingerprint = false } = {}) {
  const c = json(files, 'certificate.json');
  change(c);
  if (refingerprint) c.fingerprint = certificateFingerprint(c);
  files.set('certificate.json', encoder.encode(certificateText(c)));
}

// workspace.json edited, and certificate.json made to agree (its SHA-256 of the workspace, its
// fingerprint): a forger's consistent edit.
export function editWorkspace(files, change) {
  const ws = json(files, 'workspace.json');
  change(ws);
  const text = serializeWorkspace(ws);
  files.set('workspace.json', encoder.encode(text));
  editCertificate(files, (c) => {
    c.workspace.sha256 = sha256(encoder.encode(text));
  }, { refingerprint: true });
}

// A number changed in its last bit (the next double): the smallest edit there is.
export function nudge(x) {
  const f = new Float64Array([x]);
  new BigInt64Array(f.buffer)[0] += 1n;
  return f[0];
}

// The tamperings: [{ id, what, edit(files, certificate), expect(report) → true when verifying
// catches it as it should }]. certificate: the one written, read.
export function tamperings() {
  const firstScore = (c) => {
    const s = c.numbers.runs[0].conditions[0].score;
    return s.findIndex((x) => typeof x === 'number' && x !== 0);
  };
  return [
    {
      id: 'table',
      what: 'a count changed in the table the archive holds',
      edit: (files, c) => {
        const input = c.inputs.find((i) => i.role === 'table');
        const text = decoder.decode(files.get(input.path));
        const at = text.search(/,\d+(\r?\n|,)/);
        files.set(input.path, encoder.encode(`${text.slice(0, at + 1)}9${text.slice(at + 1)}`));
      },
      expect: (r) => r.verdict === 'differs' && r.inputs.find((i) => i.role === 'table').status === 'changed' && /no longer has its SHA-256|no longer have their SHA-256/.test(r.summary),
    },
    {
      id: 'number',
      what: 'a score in certificate.json changed in its last bit',
      edit: (files) => editCertificate(files, (c) => {
        const i = firstScore(c);
        c.numbers.runs[0].conditions[0].score[i] = nudge(c.numbers.runs[0].conditions[0].score[i]);
      }),
      expect: (r) => r.verdict === 'differs' && !r.fingerprint.ok && r.numbers.differs === 1 && /: the score of p\./.test(r.numbers.differ[0].label),
    },
    {
      id: 'number-refingerprinted',
      what: 'the same, its fingerprint made again to match',
      edit: (files) => editCertificate(files, (c) => {
        const i = firstScore(c);
        c.numbers.runs[0].conditions[0].score[i] = nudge(c.numbers.runs[0].conditions[0].score[i]);
      }, { refingerprint: true }),
      expect: (r) => r.verdict === 'differs' && r.fingerprint.ok && r.numbers.differs === 1 && /: the score of p\./.test(r.numbers.differ[0].label),
    },
    {
      id: 'parameters',
      what: 'Run 1\'s pseudocount edited in workspace.json, certificate.json made to agree',
      edit: (files) => editWorkspace(files, (ws) => {
        ws.runs[0].inputs.parameters.pseudocount = 1;
      }),
      expect: (r) => r.verdict === 'differs' && r.fingerprint.ok && r.workspace.ok && r.runs.find((x) => x.name === 'Run 1')?.ok === false && r.numbers.differs > 100,
    },
    {
      id: 'history',
      what: 'a history entry\'s words edited, certificate.json made to agree',
      edit: (files) => editWorkspace(files, (ws) => {
        const e = ws.history.find((x) => x.action === 'qc');
        e.detail = `${e.detail} (approved)`;
      }),
      expect: (r) => r.verdict === 'differs' && r.fingerprint.ok && !r.history.ok && r.history.broken.length > 0 && /the history was altered/.test(r.summary),
    },
    {
      id: 'checkpoint',
      what: 'a checkpoint\'s state edited (a QC threshold), certificate.json made to agree',
      edit: (files) => editWorkspace(files, (ws) => {
        ws.checkpoints[0].state.qc = { ...(ws.checkpoints[0].state.qc ?? {}), thresholds: { agreement: { review: 0.5, fail: 0.2 } } };
      }),
      expect: (r) => r.verdict === 'differs' && r.fingerprint.ok && r.checkpoints.some((c) => !c.ok) && /a checkpoint is not the one certified/.test(r.summary),
    },
  ];
}

// --- The review report (wave 6, slice 7) -------------------------------------------------------------

// Each traced value of a review report checked: a certified number against the certificate (its key
// and exact value), a recorded one against the workspace at its path, a count against the
// certificate's classes. Returns { total, kinds: { kind: n }, bad: [{ key, value, expected }] }.
export function checkTraced(html, certificate, ws) {
  const items = new Map([...numberItems(certificate.numbers)].map(([, k, v]) => [k, v]));
  const out = { total: 0, kinds: {}, bad: [] };
  for (const { key, value } of tracedValues(html)) {
    out.total += 1;
    const [kind, ...rest] = key.split('|');
    out.kinds[kind] = (out.kinds[kind] ?? 0) + 1;
    let expected;
    if (kind === 'ws') expected = workspaceValue(ws, rest[0]) ?? null;
    else if (kind === 'count') {
      const run = certificate.numbers.runs.find((r) => r.id === rest[0]);
      const contrast = rest[1].startsWith('contrast');
      const target = run && (contrast ? run.contrasts : run.conditions)[Number(rest[1].replace('contrast', ''))];
      expected = !target ? undefined : rest[2] === 'scored' ? target.class.filter((c) => c !== 0).length : target.class.filter((c) => c === Number(rest[2])).length;
    } else expected = items.has(key) ? items.get(key) : undefined;
    if (expected === undefined || canonicalJSON(expected) !== canonicalJSON(value)) out.bad.push({ key, value, expected });
  }
  return out;
}

// What in a review report's HTML would load something from outside the file: elements that load
// (scripts, styles, frames, images, media), references in CSS, and addresses outside <a> links (the
// SVGs' xmlns names a namespace, loads nothing). [] when it loads nothing.
export function externalReferences(html) {
  const found = [];
  for (const m of html.matchAll(/<(script|link|iframe|object|embed|img|video|audio|source|track|frame)\b[^>]*>/gi)) {
    if (m[1].toLowerCase() === 'script' && !/\ssrc=/i.test(m[0])) continue;
    found.push(m[0].slice(0, 80));
  }
  for (const m of html.matchAll(/@import|url\((?!#)[^)]*\)|srcset=/gi)) found.push(m[0].slice(0, 80));
  for (const m of html.matchAll(/<(\w+)\b[^>]*\s(?:src|href|xlink:href|action|poster|data)="([^"#][^"]*)"/gi)) {
    if (m[1].toLowerCase() === 'a' || /^data:image\/png;base64,/.test(m[2])) continue;
    found.push(`${m[1]} ${m[2].slice(0, 60)}`);
  }
  const script = html.slice(html.lastIndexOf('<script>'));
  for (const m of script.matchAll(/\b(fetch|XMLHttpRequest|import\(|WebSocket|EventSource|sendBeacon|navigator\.serviceWorker)\b/g)) found.push(`script: ${m[0]}`);
  return found;
}
