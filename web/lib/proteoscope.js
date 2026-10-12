// Proteoscope sessions (wave 5, slice 6; requirement X6): the structure shown, its scores and the
// view, written as Proteoscope 0.10's session (format "proteoscope-session", version 1) for a
// Proteoscope running on this computer to open. A PDB entry or an AlphaFold DB model, which
// Proteoscope fetches by its ID, travels in a link (#session=: the session deflated, in URL-safe
// base64, as Proteoscope's codec.js writes it); a file of the person's is embedded in a
// .proteoscope.json file to open there. Only what Proteoscope already accepts; nothing else in
// MaveScape depends on it. Pure: ui/proteoscope.js gathers the view and hands it over.
//
// MaveScape's residue keys ("A:21:ARG") are Proteoscope's: its reader (lib/structure/parse.js)
// is Proteoscope 0.10.0's.

import { POSITION } from './structure-scores.js';

export const SESSION_FORMAT = 'proteoscope-session';
export const SESSION_VERSION = 1;
export const SESSION_EXTENSION = '.proteoscope.json';

// --- The scores as Proteoscope's residue data --------------------------------------------------------

// Proteoscope's colormap nearest the map's: its blue–white–red for a diverging scale (low blue, as
// MaveScape's rdbu; it has no purple–orange), viridis for the rest, as the map draws them.
export function proteoscopeColormap(domain) {
  return domain?.kind === 'diverging' ? 'bwr' : 'viridis';
}

// The range Proteoscope scales the values to: the map's, a diverging one centered on the wild
// type (as structure-scores.js's scalePosition places a value).
export function dataRange(domain) {
  if (!domain) return null;
  if (domain.kind === 'diverging') {
    const half = Math.abs(domain.max - domain.center) || 1;
    return { min: domain.center - half, max: domain.center + half };
  }
  return { min: domain.min, max: domain.max === domain.min ? domain.min + 1 : domain.max };
}

// The scores on residues: [residue key, value] for each target position on a residue of every chain
// mapped, with a value (scored, or from scores of low confidence only). Positions missing, filtered
// or not designed have none: Proteoscope draws them gray.
export function residueData(values, maps) {
  const out = [];
  for (const m of maps ?? []) {
    for (const p of m.positions) {
      if (!p.residue) continue;
      const i = p.position - 1;
      const state = values.state[i];
      const v = values.value[i];
      if ((state === POSITION.VALUE || state === POSITION.LOW) && Number.isFinite(v)) out.push([p.residue, +v.toPrecision(6)]);
    }
  }
  return out;
}

// --- Sources -------------------------------------------------------------------------------------------

// A structure Proteoscope fetches itself: a PDB entry by its ID, an AlphaFold DB model by its UniProt
// accession (Proteoscope fetches AlphaFold DB's current model of it). null for a file of the person's.
export function fetchSource(origin) {
  if (origin?.kind === 'pdb' && origin.id) return { type: 'fetch', id: String(origin.id).toUpperCase() };
  if (origin?.kind === 'alphafold' && origin.id) return { type: 'fetch', id: String(origin.id).toUpperCase() };
  return null;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function compress(bytes, format) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function decompress(bytes, format) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function toBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// A file of the person's, its text embedded as Proteoscope's session embeds a local file (gzip,
// base64). `text` is mmCIF or PDB (BinaryCIF read to mmCIF first: lib/structures.js).
export async function fileSource(name, text) {
  return { type: 'file', name, encoding: 'gzip-base64', data: toBase64(await compress(encoder.encode(text), 'gzip')) };
}

// The text of an embedded file again (for the tests and the validation).
export async function fileSourceText(source) {
  return decoder.decode(await decompress(fromBase64(source.data), 'gzip'));
}

// --- The session ---------------------------------------------------------------------------------------

// A session of one structure, as Proteoscope 0.10's sessionDocument writes it, with what MaveScape
// can say of it:
//   source: fetchSource or fileSource; name, title;
//   assembly; display: { polymer, ligand } (the style), residueStyles: [[key, style]],
//   hidden: [keys]; surface: 'off' | 'ses' | 'sas' | 'vdw' | 'gaussian';
//   color: { scheme } (one of the structure's own colorings, named as Proteoscope names them), or
//   data: { label, values: [[key, value]], domain } (the scores, colored by Proteoscope's custom
//   residue data), or overrides: [[key, '#rrggbb']] (categories: QC state, structural class);
//   selection, labels, focus: [keys]; camera: { target, distance, rotation, fov, orthographic };
//   software: { version }, created.
export function sessionDocument(o) {
  const color = o.data
    ? { scheme: 'data', colormap: proteoscopeColormap(o.data.domain), range: dataRange(o.data.domain) }
    : o.overrides
      ? { scheme: 'uniform', uniformColor: o.uniformColor ?? '#cfcfcf' }
      : { scheme: o.color?.scheme ?? 'chain' };
  const camera = o.camera ? { target: [...o.camera.target], distance: o.camera.distance, rotation: [...o.camera.rotation], fov: o.camera.fov, orthographic: Boolean(o.camera.orthographic) } : null;
  return {
    format: SESSION_FORMAT,
    version: SESSION_VERSION,
    created: o.created ?? null,
    application: 'MaveScape',
    applicationVersion: o.software?.version ?? '',
    title: o.title ?? '',
    view: camera ? { camera } : {},
    active: 0,
    structures: [{
      name: o.name,
      source: o.source,
      visible: true,
      assembly: o.assembly ?? null,
      activeModel: 0,
      display: {
        polymer: o.display?.polymer ?? 'cartoon',
        ligand: o.display?.ligand ?? 'ball-stick',
        residueStyles: o.residueStyles?.length ? o.residueStyles.map(([k, v]) => [k, v]) : null,
        hiddenResidues: o.hidden?.length ? [...o.hidden] : null,
      },
      color,
      colorOverrides: o.overrides?.length ? o.overrides.map(([k, hex]) => [k, hex]) : null,
      surface: { kind: o.surface ?? 'off', color: 'scheme', opacity: 1, keys: null },
      selection: [...(o.selection ?? [])],
      focus: o.focus?.length ? [...o.focus] : null,
      labels: [...(o.labels ?? [])],
      proteomics: { coverage: null, data: o.data ? o.data.values.map(([k, v]) => [k, v]) : null, dataLabel: o.data?.label ?? '', sites: [], crosslinks: [] },
    }],
    measurements: [],
  };
}

// --- Links ------------------------------------------------------------------------------------------------

const toBase64Url = (base64) => base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromBase64Url = (text) => {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  return base64 + '='.repeat((4 - (base64.length % 4)) % 4);
};

// A session in a link's #session=: deflated (raw), in URL-safe base64 without padding.
export async function linkPayload(doc) {
  return toBase64Url(toBase64(await compress(encoder.encode(JSON.stringify(doc)), 'deflate-raw')));
}

export async function readLinkPayload(payload) {
  return JSON.parse(decoder.decode(await decompress(fromBase64(fromBase64Url(payload)), 'deflate-raw')));
}

// The link that opens the session in the Proteoscope at `base` ("http://127.0.0.1:8765/"), or,
// with a session of no use to it (a version not tested), the structure alone: #fetch=<ID>.
export function sessionLink(base, payload) {
  return `${base.replace(/\/?$/, '/')}#session=${payload}`;
}

export function fetchLink(base, id) {
  return `${base.replace(/\/?$/, '/')}#fetch=${encodeURIComponent(id)}`;
}

// The session as a file: "<name>.proteoscope.json".
export function sessionFileName(name) {
  return `${String(name || 'structure').replace(/\.(cif|mmcif|pdb|ent|bcif)(\.gz)?$/i, '').replace(/[^A-Za-z0-9_.-]+/g, '_')}${SESSION_EXTENSION}`;
}
