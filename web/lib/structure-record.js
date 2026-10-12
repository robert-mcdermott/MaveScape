// Structures in the record (wave 5, slice 5; requirement X5): what the workspace keeps of a structure
// and of a view of it, and what a figure panel of it carries. Pure; the Structure view
// (ui/mode-structure.js) saves and reopens views, the archive (lib/archive.js) carries the
// structures' files, the methods (lib/methods.js) describe them.
//
// A structure kept (ws.structures): { id, name, title, method, origin: { kind: 'pdb' | 'alphafold' |
// 'file', id, version, name, entry (AlphaFold DB's), retrieval }, file: { fileName, sha256, size }
// (the bytes as they came: RCSB's gzipped mmCIF, AlphaFold DB's file, the person's file), pae (a
// model's aligned error, kept the same way), added }. It stays while a saved view shows it.
//
// A saved view (ws.structureViews): { id, name, structure (its id), created, assembly, chain,
// mapping (mappingSummary's), camera, style, color: { scheme, scores, palette, run, condition,
// contrast }, surface, selection, labels, styles, hidden (residues hidden; MaveScape 0.5, slice 6),
// focus, evidence: { choice, fraction, seed } }:
// enough to draw the view again as it was, and to check that the mapping is the one it was saved
// with.

import { crc32 } from './zip.js';
import { stretches } from './mapping.js';
import { ASYMMETRIC_UNIT_ID } from './structure/parse.js';

export const PANEL_FORMAT = 'mavescape-figure-panel';
export const PANEL_VERSION = 1;
export const PANEL_KEYWORD = 'mavescape-figure-panel';

// --- The mapping a view was saved with ------------------------------------------------------------

// A mapping in brief, to keep with a view and compare when it is drawn again: the target and the
// chain, the counts, the identity and the target positions on residues.
export function mappingSummary(mapping) {
  if (!mapping) return null;
  return {
    target: { name: mapping.target.name, length: mapping.target.length, offset: mapping.target.offset ?? 0, accession: mapping.target.accession ?? '' },
    chain: mapping.chain,
    onStructure: mapping.onStructure,
    identical: mapping.counts.identical,
    aligned: mapping.aligned,
    identity: +mapping.identity.toFixed(6),
    // Target positions on residues, and the same in the reference's numbering.
    positions: stretches(mapping.positions.filter((p) => p.residue).map((p) => p.position)),
    reference: stretches(mapping.positions.filter((p) => p.residue).map((p) => p.reference)),
    differences: mapping.positions.filter((p) => p.state === 'different').map((p) => `${p.code}${p.position}${p.structureCode}`),
  };
}

// What differs between the mapping a view was saved with and the one made now: [words].
export function mappingChanges(saved, now) {
  if (!saved) return [];
  if (!now) return [`the target is on no chain of the structure now (it was on chain ${saved.chain})`];
  const out = [];
  for (const key of ['chain', 'onStructure', 'identical', 'aligned']) if (saved[key] !== now[key]) out.push(`${key} ${saved[key]} then, ${now[key]} now`);
  if (saved.positions.join() !== now.positions.join()) out.push(`positions ${saved.positions.join(', ')} then, ${now.positions.join(', ')} now`);
  if (saved.differences.join() !== now.differences.join()) out.push(`differences ${saved.differences.join(', ') || 'none'} then, ${now.differences.join(', ') || 'none'} now`);
  return out;
}

// --- Words ------------------------------------------------------------------------------------------

const day = (text) => /^\d{4}-\d{2}-\d{2}/.exec(text ?? '')?.[0] ?? '';

// A kept structure in words: "PDB 2VWF (RCSB PDB, retrieved 2026-10-12; SHA-256 …)".
export function structureWords(entry, { sha = true } = {}) {
  const o = entry.origin ?? {};
  const when = day(o.retrieval?.retrieved);
  const where = o.kind === 'pdb' ? `PDB ${o.id} (RCSB PDB${when ? `, retrieved ${when}` : ''}` : o.kind === 'alphafold' ? `the AlphaFold DB model of ${o.id}, version ${o.version} (${when ? `retrieved ${when}` : 'AlphaFold DB'}` : `${o.name ?? entry.file.fileName} (a file`;
  return `${where}${sha ? `; SHA-256 ${entry.file.sha256}` : ''})`;
}

const SCORE_WORDS = { median: 'the median score', mean: 'the mean score', minimum: 'the lowest score', maximum: 'the highest score', fraction: 'the fraction abnormal-like', count: 'the substitutions scored', substitution: 'one substitution\'s score', uncertainty: 'the median SE', disagreement: 'the disagreement of a comparison', qc: 'the QC state', class: 'the structural class' };

// A saved view in words: what it shows and how it is colored.
export function viewWords(view, ws) {
  const entry = (ws.structures ?? []).find((s) => s.id === view.structure);
  const run = view.color?.run ? ws.runs.find((r) => r.id === view.color.run) : null;
  const scores = view.color?.scores;
  const coloring = scores ? `${SCORE_WORDS[scores.how] ?? scores.how}${scores.how === 'substitution' ? ` (to ${scores.substitution})` : ''}${run ? ` of ${run.name}` : ''}` : `its ${view.color?.scheme ?? 'own'} colors`;
  const parts = [`${entry?.name ?? 'a structure'}${view.assembly && view.assembly !== ASYMMETRIC_UNIT_ID ? `, assembly ${view.assembly}` : ''}, chain ${view.chain ?? '—'}`, `colored by ${coloring}`];
  if (view.selection?.length) parts.push(`${view.selection.length} residue${view.selection.length === 1 ? '' : 's'} selected`);
  if (view.labels?.length) parts.push(`${view.labels.length} labeled`);
  return parts.join('; ');
}

// --- Figure panels -----------------------------------------------------------------------------------

// What a figure panel of a structure carries (for wave 6's figure builder, and anyone reading the
// image): the structure, the view, the coloring and its legend, the image, the software.
export function panelMetadata({ ws, entry = null, structure, origin, view, coloring, legend, image, software, created }) {
  return {
    format: PANEL_FORMAT,
    version: PANEL_VERSION,
    kind: 'structure',
    created,
    software: { name: 'MaveScape', version: software?.version ?? null, commit: software?.commit || null },
    workspace: ws ? { id: ws.id, name: ws.name } : null,
    structure: { name: structure.meta.code || structure.label, title: structure.meta.title ?? '', origin: origin ? { kind: origin.kind, id: origin.id ?? null, version: origin.version ?? null, file: origin.name ?? null, retrieved: origin.retrieval?.retrieved ?? null } : null, sha256: entry?.file.sha256 ?? null, kept: entry?.id ?? null },
    view,
    coloring,
    legend,
    image,
  };
}

// --- PNG text ------------------------------------------------------------------------------------------

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

const isPNG = (bytes) => bytes.length > 8 && PNG_SIGNATURE.every((b, i) => bytes[i] === b);
const uint32 = (bytes, at) => ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;

// The PNG with an international text chunk (iTXt, UTF-8, uncompressed) of a keyword before its
// image end: how the panel's metadata travels inside its image.
export function pngWithText(png, keyword, text) {
  const bytes = png instanceof Uint8Array ? png : new Uint8Array(png);
  if (!isPNG(bytes)) throw new Error('Not a PNG image.');
  if (!/^[\x20-\x7e]{1,79}$/.test(keyword)) throw new Error('A PNG keyword is 1 to 79 Latin characters.');
  // Find IEND.
  let at = 8;
  let end = -1;
  while (at + 12 <= bytes.length) {
    const length = uint32(bytes, at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    if (type === 'IEND') {
      end = at;
      break;
    }
    at += 12 + length;
  }
  if (end < 0) throw new Error('The PNG has no end.');
  const body = [...encoder.encode(keyword), 0, 0, 0, 0, 0, ...encoder.encode(text)];
  const chunk = new Uint8Array(12 + body.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, body.length);
  chunk.set(encoder.encode('iTXt'), 4);
  chunk.set(body, 8);
  view.setUint32(8 + body.length, crc32(chunk.subarray(4, 8 + body.length)));
  const out = new Uint8Array(bytes.length + chunk.length);
  out.set(bytes.subarray(0, end), 0);
  out.set(chunk, end);
  out.set(bytes.subarray(end), end + chunk.length);
  return out;
}

// The PNG's text chunks (tEXt and uncompressed iTXt): Map(keyword → text). Checks each chunk's CRC.
export function pngTexts(png) {
  const bytes = png instanceof Uint8Array ? png : new Uint8Array(png);
  if (!isPNG(bytes)) throw new Error('Not a PNG image.');
  const out = new Map();
  let at = 8;
  while (at + 12 <= bytes.length) {
    const length = uint32(bytes, at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const data = bytes.subarray(at + 8, at + 8 + length);
    if (uint32(bytes, at + 8 + length) !== crc32(bytes.subarray(at + 4, at + 8 + length))) throw new Error(`The PNG's ${type} chunk is damaged.`);
    if (type === 'tEXt' || type === 'iTXt') {
      const zero = data.indexOf(0);
      const keyword = decoder.decode(data.subarray(0, zero));
      if (type === 'tEXt') out.set(keyword, String.fromCharCode(...data.subarray(zero + 1)));
      else if (data[zero + 1] === 0) {
        // Skip the compression flag and method, the language tag and the translated keyword.
        let p = zero + 3;
        p = data.indexOf(0, p) + 1;
        p = data.indexOf(0, p) + 1;
        out.set(keyword, decoder.decode(data.subarray(p)));
      }
    }
    if (type === 'IEND') break;
    at += 12 + length;
  }
  return out;
}
