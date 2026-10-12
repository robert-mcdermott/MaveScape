// The workspace archive, `.msz` (requirement R2; conventions.md, "Workspace"): a ZIP of
//
//   manifest.json          format 'mavescape-archive', version, created, software, and every
//                          other file with its SHA-256 and size
//   workspace.json         the workspace document (targets, design, runs, selections, QC
//                          thresholds, the hash-chained history)
//   sources/<sha256>.<ext> the imported tables, byte for byte (left out when exported with
//                          checksums only: the workspace names each by its SHA-256), the files
//                          of the annotations beside the map (always: wave 3, slice 5), and the
//                          files of the structures saved views show, as they came (wave 5, slice
//                          5; left out when exported with checksums only: a PDB entry or
//                          AlphaFold DB model is then fetched again by its ID, its SHA-256
//                          checked), and the images of figures' structure panels (always:
//                          wave 6, slice 2)
//   results/<run>.csv      each run's scores (one file per condition beyond the first)
//   methods.md, references.bib   the latest run's methods and references
//
// Written deterministically: the same workspace gives the same bytes in any time zone (the
// entries are dated with the workspace's modification time, in UTC). Read defensively: only these names, nothing outside the
// archive's folders, sizes limited and checked while decompressing, every file's SHA-256 against
// the manifest, every table's against its name, the history's chain verified. Problems are
// reported, not hidden.

import { createZip, listZip, crc32 } from './zip.js';
import { sha256 } from './sha256.js';
import { parseWorkspace, serializeWorkspace, verifyHistory } from './workspace.js';
import { scoresCSV } from './exports.js';
import { possessive } from './words.js';

export const ARCHIVE_FORMAT = 'mavescape-archive';
export const ARCHIVE_VERSION = 1;
export const LIMITS = { entry: 2 ** 31, total: 2 ** 33, entries: 10000 };
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const NAME = /^(manifest\.json|workspace\.json|methods\.md|references\.bib|sources\/[0-9a-f]{64}(\.[A-Za-z0-9]{1,8}){0,2}|results\/[A-Za-z0-9_.-]{1,120}\.csv)$/;

const extension = (fileName) => {
  const m = /(\.[A-Za-z0-9]{1,8}(\.gz)?)$/i.exec(fileName ?? '');
  return m ? m[1].toLowerCase() : '';
};

// Writes the archive. options: { software: { version, commit }, sources: Map(sha256 → bytes) or
// null for checksums only, annotations: Map(sha256 → bytes) of the annotations' files, figures:
// Map(sha256 → bytes) of the figures' images, structures:
// Map(sha256 → bytes) of the structures' files or null for checksums only, results:
// Map(run id → results) (runs without results are left out of results/), methods: { markdown,
// bibtex } }. Returns { bytes, manifest }.
// The files of a source the library keeps: its tables, and MaveDB's mapped variants beside them
// (wave 3, slice 3).
export function sourceFiles(source) {
  const tables = source.files?.length ? source.files : [{ sha256: source.sha256, fileName: source.fileName }];
  const mapped = source.origin?.mapped ? [{ sha256: source.origin.mapped.sha256, fileName: source.origin.mapped.fileName }] : [];
  return [...tables, ...mapped];
}

// The files of the workspace's annotations (ws.annotations: public data as kept, or the person's
// files; wave 3, slice 5).
export function annotationFiles(ws) {
  return (ws.annotations ?? []).filter((a) => a.file?.sha256).map((a) => ({ sha256: a.file.sha256, fileName: a.file.fileName, name: a.name }));
}

// The files of the structures the workspace's saved views show (ws.structures; wave 5, slice 5): each
// structure's file and a model's aligned error.
export function structureFiles(ws) {
  return (ws.structures ?? []).flatMap((s) => [
    { sha256: s.file.sha256, fileName: s.file.fileName, name: s.name },
    ...(s.pae?.sha256 ? [{ sha256: s.pae.sha256, fileName: s.pae.fileName, name: `${s.name}'s aligned error` }] : []),
  ]);
}

// The images of the figures' structure panels (wave 6, slice 2): each saved view's figure panel as
// drawn for the figure, kept in the library by its SHA-256.
export function figureFiles(ws) {
  return (ws.figures ?? []).flatMap((f) => f.panels.filter((p) => p.kind === 'structure' && p.image?.sha256).map((p) => ({ sha256: p.image.sha256, fileName: 'panel.png', name: `the structure panel of "${f.name}"` })));
}

export async function writeArchive(ws, options = {}) {
  const files = [];
  files.push({ name: 'workspace.json', data: encoder.encode(serializeWorkspace(ws)) });
  if (options.sources) {
    const seen = new Set();
    for (const source of ws.sources) {
      for (const f of sourceFiles(source)) {
        if (seen.has(f.sha256)) continue;
        seen.add(f.sha256);
        const bytes = options.sources.get(f.sha256);
        if (!bytes) throw new Error(`The table ${f.fileName ?? source.name} (SHA-256 ${f.sha256.slice(0, 12)}…) is not in the library: export with checksums only, or open it again.`);
        files.push({ name: `sources/${f.sha256}${extension(f.fileName ?? source.fileName)}`, data: bytes });
      }
    }
  }
  {
    const seen = new Set(files.map((f) => f.name.slice(8, 72)));
    for (const f of annotationFiles(ws)) {
      if (seen.has(f.sha256)) continue;
      seen.add(f.sha256);
      const bytes = options.annotations?.get(f.sha256) ?? options.sources?.get(f.sha256);
      if (!bytes) throw new Error(`The annotation ${f.name} (${f.fileName}) is not in the library: remove it, or add it again.`);
      files.push({ name: `sources/${f.sha256}${extension(f.fileName)}`, data: bytes });
    }
    // The figures' images (wave 6, slice 2), always: a figure is drawn from them.
    for (const f of figureFiles(ws)) {
      if (seen.has(f.sha256)) continue;
      seen.add(f.sha256);
      const bytes = options.figures?.get(f.sha256);
      if (!bytes) throw new Error(`The image of ${f.name} is not in the library: draw it again from its saved view.`);
      files.push({ name: `sources/${f.sha256}.png`, data: bytes });
    }
    // The structures' files (wave 5, slice 5), unless named by their checksums only.
    if (options.structures) {
      for (const f of structureFiles(ws)) {
        if (seen.has(f.sha256)) continue;
        seen.add(f.sha256);
        const bytes = options.structures.get(f.sha256);
        if (!bytes) throw new Error(`The structure file of ${f.name} (${f.fileName}) is not in the library: export with checksums only, or open the view again.`);
        files.push({ name: `sources/${f.sha256}${extension(f.fileName)}`, data: bytes });
      }
    }
  }
  for (const run of ws.runs) {
    const results = options.results?.get(run.id);
    if (!results) continue;
    results.conditions.forEach((c, i) => {
      files.push({ name: `results/${run.id}${i ? `.${String(c.id).replace(/[^A-Za-z0-9_-]+/g, '_')}` : ''}.csv`, data: encoder.encode(scoresCSV(results, run, i)) });
    });
  }
  if (options.methods) {
    files.push({ name: 'methods.md', data: encoder.encode(options.methods.markdown) });
    files.push({ name: 'references.bib', data: encoder.encode(options.methods.bibtex) });
  }
  const manifest = {
    format: ARCHIVE_FORMAT,
    version: ARCHIVE_VERSION,
    created: ws.modified,
    software: { name: 'MaveScape', version: options.software?.version ?? null, commit: options.software?.commit || null },
    workspace: { id: ws.id, name: ws.name, format: ws.format, version: ws.version },
    sources: options.sources ? 'included' : 'checksums',
    ...((ws.structures ?? []).length ? { structures: options.structures ? 'included' : 'checksums' } : {}),
    contents: files.map((f) => ({ path: f.name, sha256: sha256(f.data), bytes: f.data.length })),
  };
  const all = [{ name: 'manifest.json', data: encoder.encode(`${JSON.stringify(manifest, null, 2)}\n`) }, ...files];
  const bytes = await createZip(all, { date: new Date(ws.modified), utc: true });
  return { bytes, manifest };
}

// One entry's bytes, decompressed with its declared size as a hard limit.
async function readLimited(archive, entry) {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  if (entry.encrypted) throw new Error(`${entry.name} is encrypted.`);
  if (entry.localOffset + 30 > view.byteLength || view.getUint32(entry.localOffset, true) !== 0x04034b50) throw new Error(`The archive's entry ${entry.name} is damaged.`);
  const start = entry.localOffset + 30 + view.getUint16(entry.localOffset + 26, true) + view.getUint16(entry.localOffset + 28, true);
  if (start + entry.compressedSize > view.byteLength) throw new Error(`The archive's entry ${entry.name} is truncated.`);
  const raw = archive.subarray(start, start + entry.compressedSize);
  let data;
  if (entry.method === 0) {
    data = raw;
  } else if (entry.method === 8) {
    const reader = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
    data = new Uint8Array(entry.size);
    let at = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (at + value.length > entry.size) {
        await reader.cancel();
        throw new Error(`${entry.name} decompresses to more than its declared ${entry.size} bytes; the archive is damaged or hostile.`);
      }
      data.set(value, at);
      at += value.length;
    }
    if (at !== entry.size) throw new Error(`${entry.name} decompresses to ${at} bytes, not the ${entry.size} declared.`);
  } else {
    throw new Error(`${entry.name} uses an unsupported compression method (${entry.method}).`);
  }
  if (crc32(data) !== entry.crc) throw new Error(`CRC mismatch for ${entry.name}; the archive is damaged.`);
  return data;
}

// Reads an archive: { manifest, ws, sources: Map(sha256 → bytes), results: Map(path → text),
// methods, problems: [messages] }. Throws when it is not a MaveScape archive or breaks a limit.
export async function readArchive(bytes, limits = LIMITS) {
  const entries = listZip(bytes);
  if (entries.length > limits.entries) throw new Error(`The archive holds ${entries.length} files; a MaveScape archive holds at most ${limits.entries}.`);
  const problems = [];
  const accepted = [];
  let total = 0;
  for (const entry of entries) {
    if (!NAME.test(entry.name)) {
      problems.push(`${JSON.stringify(entry.name)} is not part of a MaveScape archive and was not read.`);
      continue;
    }
    if (entry.size > limits.entry) throw new Error(`${entry.name} would be ${entry.size} bytes, beyond the ${limits.entry}-byte limit for one file.`);
    total += entry.size;
    if (total > limits.total) throw new Error(`The archive would decompress to more than ${limits.total} bytes.`);
    accepted.push(entry);
  }
  const files = new Map();
  for (const entry of accepted) files.set(entry.name, await readLimited(bytes, entry));
  if (!files.has('manifest.json')) throw new Error('This ZIP is not a MaveScape archive: it has no manifest.json.');
  let manifest;
  try {
    manifest = JSON.parse(decoder.decode(files.get('manifest.json')));
  } catch {
    throw new Error('The archive\'s manifest.json is not valid JSON.');
  }
  if (manifest.format !== ARCHIVE_FORMAT) throw new Error('This ZIP is not a MaveScape archive (its manifest\'s format is not "mavescape-archive").');
  if (!(manifest.version >= 1) || manifest.version > ARCHIVE_VERSION) throw new Error(`The archive was written by a newer MaveScape (archive version ${manifest.version}; this program reads up to ${ARCHIVE_VERSION}). Update MaveScape to open it.`);
  // Every listed file is there with its SHA-256; nothing unlisted.
  const listed = new Set();
  for (const item of manifest.contents ?? []) {
    listed.add(item.path);
    const data = files.get(item.path);
    if (!data) problems.push(`${item.path} is listed in the manifest but missing from the archive.`);
    else if (sha256(data) !== item.sha256) problems.push(`${item.path} does not have the SHA-256 the manifest records: it was changed after the archive was written.`);
  }
  for (const name of files.keys()) if (name !== 'manifest.json' && !listed.has(name)) problems.push(`${name} is in the archive but not in its manifest.`);
  if (!files.has('workspace.json')) throw new Error('The archive has no workspace.json.');
  const ws = parseWorkspace(decoder.decode(files.get('workspace.json')));
  const chain = verifyHistory(ws);
  if (!chain.ok) problems.push(`The workspace's history does not hold together: entry ${chain.broken[0].index + 1} (${chain.broken[0].entry.action}) ${chain.broken[0].reason}.`);
  const sources = new Map();
  for (const [name, data] of files) {
    const m = /^sources\/([0-9a-f]{64})/.exec(name);
    if (!m) continue;
    if (sha256(data) !== m[1]) problems.push(`${name} does not have the SHA-256 its name says.`);
    else sources.set(m[1], data);
  }
  if (manifest.sources === 'included') {
    for (const s of ws.sources) for (const f of sourceFiles(s)) if (!sources.has(f.sha256)) problems.push(`The table ${f.fileName ?? s.name} is not in the archive.`);
  }
  for (const f of figureFiles(ws)) if (!sources.has(f.sha256)) problems.push(`The image of ${f.name} is not in the archive: draw it again from its saved view.`);
  for (const f of annotationFiles(ws)) if (!sources.has(f.sha256)) problems.push(`The annotation ${possessive(f.name)} file (${f.fileName}) is not in the archive: its tracks will not show.`);
  if (manifest.structures === 'included') for (const f of structureFiles(ws)) if (!sources.has(f.sha256)) problems.push(`The structure file of ${f.name} (${f.fileName}) is not in the archive: its saved views will fetch it again or ask for it.`);
  const results = new Map([...files].filter(([n]) => n.startsWith('results/')).map(([n, d]) => [n, decoder.decode(d)]));
  const methods = files.has('methods.md') ? { markdown: decoder.decode(files.get('methods.md')), bibtex: files.has('references.bib') ? decoder.decode(files.get('references.bib')) : '' } : null;
  return { manifest, ws, sources, results, methods, problems };
}
