// The certificate's validation cases (wave 6, slice 6): GRB2's workspace of every operation the
// report describes, with a figure of every kind of panel MaveScape draws from a run (a map, a QC
// finding, scores by class, a comparison, a variant's evidence, text) and a checkpoint; the files
// it reads; an archive taken apart and put together again with a file changed (its manifest
// listing the change, so that only what the certificate checks can catch it); and the
// tamperings, each with what verifying must say.

import { sha256 } from '../web/lib/sha256.js';
import { createZip } from '../web/lib/zip.js';
import { readArchive } from '../web/lib/archive.js';
import { certificateFingerprint, certificateText } from '../web/lib/certificate.js';
import { serializeWorkspace } from '../web/lib/workspace.js';
import { addCheckpoint, saveFigure } from '../web/lib/workspace.js';
import { makeCheckpoint } from '../web/lib/diff.js';
import { addPanel } from '../web/lib/figures.js';
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
  let fig = ws.figures[0];
  const run1 = r.g.run.id;
  for (const panel of [
    { kind: 'qc', subject: run1, finding: 'excess-variance', findingTitle: 'Variance beyond counting', w: 160, h: 120, x: 8, y: 130 },
    { kind: 'scores', run: run1, plot: 'distribution', condition: 0, w: 160, h: 120, x: 176, y: 130 },
    { kind: 'compare', a: { run: run1, condition: 0 }, b: { run: r.run2.id, condition: 0 }, scale: 'scored', filters: { lowConfidence: false, maxSE: null, minReads: null }, plot: 'agreement', w: 160, h: 120, x: 344, y: 130 },
    { kind: 'variant', run: run1, condition: 0, variant: 'p.Trp36Ala', plot: 'evidence', w: 160, h: 100, x: 8, y: 258 },
    { kind: 'text', text: 'GRB2 SH3: abundance (aPCA).', w: 160, h: 30, x: 176, y: 258 },
  ]) ({ figure: fig } = addPanel(fig, panel));
  fig = { ...fig, height: Math.max(fig.height, 370) };
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
