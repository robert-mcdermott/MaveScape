// A workspace source's table read from its files' bytes and assembled as at import (joined, named,
// its barcode map applied), as the window reads it again from the library (web/ui/import.js,
// app.sourceTable, whose files the CSV worker parses with the same parser). The certificate
// (lib/certificate.js; wave 6, slice 6) reads tables with it, in Node and in a worker alike.

import { parseTable } from './csv.js';
import { assembleTable } from './assemble.js';

// A file's bytes, decompressed when its name ends in .gz.
export async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// A table file's bytes parsed as the CSV worker parses them (web/workers/csv-worker.js): gzip
// read through, a byte-order mark deciding the encoding, text that is not UTF-8 read as
// Windows-1252.
export async function parseTableBytes(bytes, name = '') {
  const gzip = /\.gz$/i.test(name);
  return parseTable(gzip ? await gunzip(bytes) : bytes, { fileName: name.replace(/\.gz$/i, '') });
}

// The source's table. options: { target (the source's target), file(sha256) → bytes or null }.
// Throws when a file is missing (error.missing: its { sha256, fileName }) or the table cannot be
// assembled.
export async function readSourceTable(source, { target = null, file }) {
  const files = source.files?.length ? source.files : [{ fileName: source.fileName, sha256: source.sha256 }];
  const parsed = [];
  for (const f of files) {
    const bytes = await file(f.sha256);
    if (!bytes) {
      const error = new Error(`${f.fileName ?? source.name} (SHA-256 ${f.sha256.slice(0, 12)}…) is not at hand.`);
      error.missing = { sha256: f.sha256, fileName: f.fileName ?? source.name };
      throw error;
    }
    parsed.push({ name: f.fileName, table: await parseTableBytes(bytes, f.fileName ?? ''), role: f.role ?? 'counts' });
  }
  const m = source.mapping ?? {};
  const assembled = assembleTable(parsed, { absentMeans: m.absentMeans ?? 'missing', level: m.level, target, barcodeColumn: m.barcodeColumn ?? undefined, map: m.assembly?.map ?? undefined, codons: m.assembly?.codons ?? undefined });
  if (!assembled.table) throw new Error(`${source.name} could not be assembled again: ${assembled.problems.map((p) => p.message).join(' ')}`);
  return assembled.table;
}
