// Reads a table file in a worker, in 16 MB parts, so a large table never freezes the page
// (requirement D1). Protocol (web/ui/workers.js): { id, type: 'parse', payload: { file (a Blob),
// name, delimiter?, header? } } → progress … → { id, result: table } (web/lib/csv.js's table, with
// encoding and size). Gzip files (.gz) are decompressed as they are read. Text that is not UTF-8
// is read again as Windows-1252, and said.

import { createTableParser } from '../lib/csv.js';

const PART = 16 * 1024 * 1024;

async function* parts(file, gzip) {
  if (gzip) {
    const reader = file.stream().pipeThrough(new DecompressionStream('gzip')).getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      yield value;
    }
  }
  for (let offset = 0; offset < file.size; offset += PART) {
    yield new Uint8Array(await file.slice(offset, offset + PART).arrayBuffer());
  }
}

async function read(file, options, encoding, onProgress) {
  const gzip = /\.gz$/i.test(options.name ?? '');
  const parser = createTableParser({ delimiter: options.delimiter, header: options.header, fileName: (options.name ?? '').replace(/\.gz$/i, '') });
  let decoder = null;
  let read = 0;
  let bom = false;
  for await (const bytes of parts(file, gzip)) {
    let chunk = bytes;
    if (!decoder) {
      // The byte-order mark decides the encoding; otherwise the one asked for.
      if (chunk[0] === 0xff && chunk[1] === 0xfe) {
        decoder = new TextDecoder('utf-16le');
        chunk = chunk.subarray(2);
        bom = true;
      } else if (chunk[0] === 0xfe && chunk[1] === 0xff) {
        decoder = new TextDecoder('utf-16be');
        chunk = chunk.subarray(2);
        bom = true;
      } else {
        if (chunk[0] === 0xef && chunk[1] === 0xbb && chunk[2] === 0xbf) {
          chunk = chunk.subarray(3);
          bom = true;
          encoding = 'utf-8';
        }
        decoder = new TextDecoder(encoding, { fatal: encoding === 'utf-8' });
      }
    }
    parser.push(decoder.decode(chunk, { stream: true }));
    read += bytes.length;
    if (!gzip) onProgress(Math.min(0.95, read / file.size), `Reading ${options.name}`);
  }
  parser.push(decoder?.decode() ?? '');
  const table = parser.finish();
  return { ...table, encoding: decoder?.encoding ?? encoding, bom, size: file.size };
}

self.onmessage = async (event) => {
  const { id, type, payload } = event.data;
  if (type !== 'parse') return;
  const onProgress = (fraction, message) => self.postMessage({ id, progress: [fraction, message] });
  try {
    let table;
    try {
      table = await read(payload.file, payload, 'utf-8', onProgress);
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      // Not UTF-8: read again as Windows-1252.
      table = await read(payload.file, payload, 'windows-1252', onProgress);
      table.diagnostics.unshift({ level: 'warning', code: 'encoding', message: 'The file is not UTF-8; it was read as Windows-1252 (Latin-1). Check accented names.' });
    }
    const transfer = table.columns.map((c) => c.numeric?.buffer).filter(Boolean);
    if (table.lineOfRow) transfer.push(table.lineOfRow.buffer);
    self.postMessage({ id, result: table }, transfer);
  } catch (error) {
    self.postMessage({ id, error: error.message });
  }
};
