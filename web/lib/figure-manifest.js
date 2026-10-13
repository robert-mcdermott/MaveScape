// What an exported figure carries (wave 6, slice 3; requirement R5): its manifest, the figure's
// document and, panel by panel, what it shows, what it was drawn from (each run by its output's
// SHA-256 and its table's, the QC thresholds, the sides of a comparison, the files of the tracks,
// a structure view's image) and a digest of what it drew; the workspace, MaveScape's version and
// commit, when; and a fingerprint, the SHA-256 of all that, so that a manifest changed after it
// was written is caught. It is embedded as SVG <metadata>, a PNG iTXt chunk or a PDF attachment
// (and written as JSON by mavescape export). A figure dropped on the window is compared with the
// workspace, panel by panel, and rebuilt from its inputs: each panel drawn again and its digest
// compared with the one recorded. After CytoWeave 0.8.0's web/lib/figure-provenance.js (embedding
// and reading, the same author); the record and the comparison are MaveScape's.

import { sha256 } from './sha256.js';
import { canonicalJSON } from './workspace.js';
import { marksToSVGSync } from './draw.js';
import { crc32 } from './zip.js';
import { panelLetters, panelSummary } from './figures.js';

export const MANIFEST_FORMAT = 'mavescape-figure-manifest';
export const MANIFEST_VERSION = 1;
export const PNG_KEYWORD = 'mavescape-figure';
export const PDF_ATTACHMENT = 'mavescape-figure.json';
const SVG_ID = 'mavescape-figure';
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const digest = (value) => sha256(encoder.encode(canonicalJSON(value)));
const short = (hash) => (hash ? `${hash.slice(0, 12)}…` : '—');

// --- What a panel was drawn from ----------------------------------------------------------------------

// A run by its output's SHA-256 and its table's, with the other runs of that table then (so that a
// run made since is told from one already there: a clock fixed by mavescape run cannot tell them).
function runRef(ws, id) {
  const run = ws.runs.find((r) => r.id === id);
  if (!run) return { id, missing: true };
  const others = ws.runs.filter((r) => r.id !== run.id && r.inputs.source.sha256 === run.inputs.source.sha256).map((r) => r.id);
  return { id: run.id, name: run.name, output: run.output.sha256, table: run.inputs.source.sha256, tableName: run.inputs.source.name, others };
}

function annotationRef(ws, id) {
  const a = (ws.annotations ?? []).find((x) => x.id === id);
  return a ? { id: a.id, name: a.name, sha256: a.file?.sha256 ?? null } : { id, missing: true };
}

const sideRef = (ws, spec) => (spec?.annotation ? { annotation: annotationRef(ws, spec.annotation) } : { run: runRef(ws, spec?.run), ...(spec?.replicate ? { replicate: spec.replicate } : { condition: spec?.condition ?? 0 }) });

// The inputs a panel is drawn from, as the workspace holds them now.
export function panelInputs(ws, panel) {
  switch (panel.kind) {
    case 'map': {
      const tracks = (panel.tracks ?? []).map((id) => {
        // An annotation's tracks are named <annotation id>:<part> (lib/providers/index.js).
        const a = (ws.annotations ?? []).find((x) => id.startsWith(`${x.id}:`));
        return a ? { id, annotation: annotationRef(ws, a.id) } : { id };
      });
      return { run: runRef(ws, panel.run), ...(tracks.length ? { tracks } : {}), ...(Number.isInteger(panel.contrast) ? { contrast: panel.contrast } : { condition: panel.condition ?? 0 }) };
    }
    case 'qc': {
      const subject = panel.subject === 'counts' ? { counts: { table: ws.sources.find((s) => s.id === (ws.designSource ?? ws.sources[0]?.id))?.sha256 ?? null, design: digest(ws.design ?? null) } } : { run: runRef(ws, panel.subject) };
      return { ...subject, finding: panel.finding, thresholds: digest(ws.qc?.thresholds ?? null), acknowledged: ws.qc?.acknowledged?.[panel.finding]?.reason ?? null };
    }
    case 'scores':
    case 'variant':
      return { run: runRef(ws, panel.run) };
    case 'compare':
      return { a: sideRef(ws, panel.a), b: sideRef(ws, panel.b), scale: panel.scale ?? 'scored', filters: panel.filters ?? null };
    case 'calibration': {
      // Wave 8, slice 5: the calibration as kept (without an agent's mark), its control set's labels
      // and its run.
      const cal = (ws.calibrations ?? []).find((c) => c.id === panel.calibration);
      if (!cal) return { calibration: { id: panel.calibration, missing: true } };
      const { proposed, ...kept } = cal;
      const set = (ws.controlSets ?? []).find((c) => c.id === cal.controlSet);
      return { calibration: { id: cal.id, name: cal.name, made: digest(kept) }, controlSet: set ? { id: set.id, name: set.name, labels: digest(set.labels) } : { id: cal.controlSet, missing: true }, run: runRef(ws, cal.run) };
    }
    case 'structure': {
      const view = (ws.structureViews ?? []).find((v) => v.id === panel.view);
      const structure = view ? (ws.structures ?? []).find((s) => s.id === view.structure) : null;
      return { view: view ? { id: view.id, name: view.name, created: view.created } : { id: panel.view, missing: true }, image: panel.image.sha256, ...(structure ? { structure: { name: structure.name, sha256: structure.file.sha256 } } : {}) };
    }
    default:
      return {};
  }
}

// --- The manifest -----------------------------------------------------------------------------------------

// Each panel's drawing as a digest: the SHA-256 of its marks written as SVG (rounded as the file
// is), so that two drawings of a panel compare whatever the format. drawn: figureMarks's return
// (its marks hold the page's background, then a group per panel in the figure's order).
export function panelDigests(fig, drawn) {
  const out = new Map();
  fig.panels.forEach((p, i) => {
    const group = drawn.marks[i + 1];
    out.set(p.id, sha256(encoder.encode(marksToSVGSync([group], 1, 1, { sized: false }))));
  });
  return out;
}

// The manifest of a figure drawn from a workspace. context: { software: { version, commit },
// created }.
export function buildManifest(ws, fig, drawn, context = {}) {
  const digests = panelDigests(fig, drawn);
  const letters = fig.letters ? panelLetters(fig) : new Map();
  const record = {
    format: MANIFEST_FORMAT,
    version: MANIFEST_VERSION,
    created: context.created ?? null,
    software: { name: 'MaveScape', version: context.software?.version ?? null, commit: context.software?.commit || null },
    workspace: { id: ws.id, name: ws.name },
    figure: fig,
    description: drawn.description,
    panels: fig.panels.map((p) => ({ id: p.id, letter: letters.get(p.id) ?? null, kind: p.kind, shows: panelSummary(p, ws), drawing: digests.get(p.id), inputs: panelInputs(ws, p) })),
  };
  record.drawing = digest(record.panels.map((p) => p.drawing));
  return { ...record, fingerprint: digest(record) };
}

// Whether a manifest is as it was written: { ok, problem? }.
export function checkManifest(record) {
  if (!record || record.format !== MANIFEST_FORMAT) return { ok: false, problem: 'It is not a MaveScape figure manifest.' };
  if (record.version > MANIFEST_VERSION) return { ok: false, problem: `It was written by a newer MaveScape (manifest version ${record.version}).` };
  const { fingerprint, ...rest } = record;
  if (fingerprint !== digest(rest)) return { ok: false, problem: 'The manifest was changed after it was written: its fingerprint does not follow from what it holds.' };
  return { ok: true };
}

// --- Embedded in the files ------------------------------------------------------------------------------

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const u32 = (b, at) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;

function parse(json) {
  try {
    const record = JSON.parse(json);
    return record?.format === MANIFEST_FORMAT ? record : null;
  } catch {
    return null;
  }
}

// SVG: a <metadata> element first in the document, the JSON in CDATA.
export function embedSVG(svg, record) {
  const json = JSON.stringify(record).replace(/]]>/g, ']]]]><![CDATA[>');
  const open = svg.indexOf('<svg');
  const end = open < 0 ? -1 : svg.indexOf('>', open);
  if (end < 0) throw new Error('Not an SVG document.');
  return `${svg.slice(0, end + 1)}\n<metadata id="${SVG_ID}"><![CDATA[${json}]]></metadata>${svg.slice(end + 1)}`;
}

export function readSVG(text) {
  const match = new RegExp(`<metadata[^>]*id="${SVG_ID}"[^>]*>([\\s\\S]*?)</metadata>`).exec(text);
  return match ? parse(match[1].replace(/<!\[CDATA\[|\]\]>/g, '')) : null;
}

// PNG: an uncompressed iTXt chunk (keyword mavescape-figure, UTF-8 JSON) before IEND.
export function embedPNG(bytes, record) {
  if (!PNG_SIGNATURE.every((b, i) => bytes[i] === b)) throw new Error('Not a PNG image.');
  const keyword = encoder.encode(PNG_KEYWORD);
  const text = encoder.encode(JSON.stringify(record));
  const data = new Uint8Array(keyword.length + 5 + text.length);
  data.set(keyword, 0);
  data.set(text, keyword.length + 5);
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(encoder.encode('iTXt'), 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  let at = 8;
  while (at + 8 <= bytes.length) {
    if (String.fromCharCode(...bytes.subarray(at + 4, at + 8)) === 'IEND') break;
    at += 12 + u32(bytes, at);
  }
  if (at + 8 > bytes.length) throw new Error('The PNG image has no IEND chunk.');
  const out = new Uint8Array(bytes.length + chunk.length);
  out.set(bytes.subarray(0, at), 0);
  out.set(chunk, at);
  out.set(bytes.subarray(at), at + chunk.length);
  return out;
}

export function readPNG(bytes) {
  if (!PNG_SIGNATURE.every((b, i) => bytes[i] === b)) return null;
  let at = 8;
  while (at + 8 <= bytes.length) {
    const length = u32(bytes, at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    if (type === 'iTXt') {
      const data = bytes.subarray(at + 8, at + 8 + length);
      const nul = data.indexOf(0);
      if (decoder.decode(data.subarray(0, nul)) === PNG_KEYWORD && data[nul + 1] === 0) {
        let p = nul + 3;
        p = data.indexOf(0, p) + 1;
        p = data.indexOf(0, p) + 1;
        return parse(decoder.decode(data.subarray(p)));
      }
    }
    if (type === 'IEND') break;
    at += 12 + length;
  }
  return null;
}

// PDF: an attachment (lib/pdf.js writes it uncompressed).
export function pdfAttachment(record) {
  return { name: PDF_ATTACHMENT, mime: 'application/json', description: 'What this MaveScape figure shows and was drawn from (its manifest)', data: encoder.encode(JSON.stringify(record)) };
}

export function readPDF(bytes) {
  if (String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') return null;
  const text = new TextDecoder('latin1').decode(bytes);
  const re = /\/Type\s*\/EmbeddedFile\b[\s\S]{0,400}?\/Length\s+(\d+)[\s\S]{0,400}?>>\s*stream\r?\n/g;
  let match;
  while ((match = re.exec(text))) {
    const start = match.index + match[0].length;
    const record = parse(decoder.decode(bytes.subarray(start, start + Number(match[1]))));
    if (record) return record;
  }
  return null;
}

// The manifest of an exported figure (SVG text, or SVG, PNG, PDF or JSON bytes), or null.
export function readFigureManifest(input) {
  if (typeof input === 'string') return readSVG(input) ?? parse(input);
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  return readPNG(bytes) ?? readPDF(bytes) ?? (() => {
    const text = decoder.decode(bytes.subarray(0, Math.min(bytes.length, 64 * 1024 * 1024)));
    return readSVG(text) ?? parse(text);
  })();
}

// --- Compared with a workspace ---------------------------------------------------------------------------

// A run of the record in the workspace: the same id, or the same output (a copy of the workspace).
function findRun(ws, ref) {
  if (!ref || ref.missing) return null;
  return ws.runs.find((r) => r.id === ref.id && r.output.sha256 === ref.output) ?? ws.runs.find((r) => r.output.sha256 === ref.output) ?? null;
}

// What changed since the figure, panel by panel: { sameWorkspace, intact, problem, panels: [{ id,
// letter, shows, status: 'unchanged' | 'changed' | 'missing', changes: [text], runs: Map(record run
// id → workspace run id) }] }. Changes are said in words: a run not in the workspace, a run scored
// again since on the same table, QC thresholds or a finding's acknowledgement changed, an
// annotation's file changed, a structure view saved again, removed.
export function compareManifest(record, ws) {
  const check = checkManifest(record);
  const panels = record.panels.map((p) => {
    const changes = [];
    const missing = [];
    const runs = new Map();
    const run = (ref, what = '') => {
      if (!ref) return;
      const found = findRun(ws, ref);
      if (!found) {
        missing.push(`${ref.name ?? ref.id}${what} (output ${short(ref.output)}) is not in this workspace`);
        return;
      }
      runs.set(ref.id, found.id);
      const known = new Set([...(ref.others ?? []), ref.id]);
      const later = ws.runs.filter((r) => r.id !== found.id && r.inputs.source.sha256 === ref.table && !known.has(r.id));
      if (later.length) changes.push(`${found.name}'s table was scored again since (${later.map((r) => r.name).join(', ')})`);
    };
    const annotation = (ref) => {
      if (!ref) return;
      const now = (ws.annotations ?? []).find((a) => a.id === ref.id);
      if (!now) missing.push(`the annotation ${ref.name ?? ref.id} is not in this workspace`);
      else if (now.file?.sha256 !== ref.sha256) changes.push(`the annotation ${ref.name}'s file changed (SHA-256 ${short(ref.sha256)} then, ${short(now.file?.sha256)} now)`);
    };
    const inputs = p.inputs ?? {};
    if (inputs.run) run(inputs.run);
    for (const t of inputs.tracks ?? []) annotation(t.annotation);
    for (const side of [inputs.a, inputs.b]) {
      if (side?.run) run(side.run);
      if (side?.annotation) annotation(side.annotation);
    }
    if (p.kind === 'qc') {
      if (inputs.counts) {
        const table = ws.sources.find((s) => s.sha256 === inputs.counts.table);
        if (!table) missing.push(`the counts it checked (SHA-256 ${short(inputs.counts.table)}) are not in this workspace`);
        else if (digest(ws.design ?? null) !== inputs.counts.design) changes.push('the design changed since');
      }
      if (digest(ws.qc?.thresholds ?? null) !== inputs.thresholds) changes.push('the QC thresholds changed since');
      const acknowledged = ws.qc?.acknowledged?.[inputs.finding]?.reason ?? null;
      if (acknowledged !== (inputs.acknowledged ?? null)) changes.push(acknowledged ? (inputs.acknowledged ? 'the finding\'s acknowledgement changed since' : 'the finding was acknowledged since') : 'the finding\'s acknowledgement was withdrawn since');
    }
    if (p.kind === 'calibration') {
      const cal = (ws.calibrations ?? []).find((c) => c.id === inputs.calibration?.id);
      if (!cal) missing.push(`the calibration "${inputs.calibration?.name ?? inputs.calibration?.id}" is not in this workspace`);
      else {
        const { proposed, ...kept } = cal;
        if (digest(kept) !== inputs.calibration.made) changes.push(`the calibration "${cal.name}" is not the one drawn (made otherwise since)`);
      }
      const set = (ws.controlSets ?? []).find((c) => c.id === inputs.controlSet?.id);
      if (!set) missing.push(`the control set "${inputs.controlSet?.name ?? inputs.controlSet?.id}" is not in this workspace`);
      else if (digest(set.labels) !== inputs.controlSet.labels) changes.push(`the control set "${set.name}"'s labels are not those drawn`);
    }
    if (p.kind === 'structure') {
      const view = (ws.structureViews ?? []).find((v) => v.id === inputs.view?.id);
      if (!view) changes.push(`the saved view "${inputs.view?.name ?? inputs.view?.id}" is not in this workspace (the figure keeps its image)`);
      else if (view.created !== inputs.view.created) changes.push(`the view "${view.name}" was saved again since`);
    }
    const status = missing.length ? 'missing' : changes.length ? 'changed' : 'unchanged';
    return { id: p.id, letter: p.letter, kind: p.kind, shows: p.shows, status, changes: [...missing, ...changes], runs };
  });
  return { sameWorkspace: record.workspace?.id === ws.id, intact: check.ok, problem: check.problem ?? null, panels };
}

// The figure as the workspace can draw it: its panels' runs by the workspace's ids (a copy of the
// workspace names them alike), a new id and name. Panels whose runs are not here keep theirs (and
// are drawn as missing).
export function figureForWorkspace(record, comparison, { id, name } = {}) {
  const byPanel = new Map(comparison.panels.map((p) => [p.id, p.runs]));
  const fig = record.figure;
  return {
    ...fig,
    id: id ?? fig.id,
    name: name ?? fig.name,
    panels: fig.panels.map((p) => {
      const runs = byPanel.get(p.id) ?? new Map();
      const map = (rid) => runs.get(rid) ?? rid;
      const side = (s) => (s?.run ? { ...s, run: map(s.run) } : s);
      return {
        ...p,
        ...(p.run ? { run: map(p.run) } : {}),
        ...(p.kind === 'qc' && p.subject !== 'counts' ? { subject: map(p.subject) } : {}),
        ...(p.kind === 'compare' ? { a: side(p.a), b: side(p.b) } : {}),
      };
    }),
  };
}

// The figure rebuilt and drawn again, against what its manifest recorded: [{ id, letter, shows,
// same (the same drawing), recorded, now }].
export function compareDrawings(record, fig, drawn) {
  const now = panelDigests(fig, drawn);
  return record.panels.map((p) => ({ id: p.id, letter: p.letter, shows: p.shows, same: now.get(p.id) === p.drawing, recorded: p.drawing, now: now.get(p.id) ?? null }));
}
