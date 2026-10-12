import assert from 'node:assert/strict';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { parseTableBytes, readSourceTable } from './source-table.js';
import { sha256 } from './sha256.js';

const text = 'hgvs_pro,input,output\np.=,100,90\np.Ala2Val,40,12\n';
const plain = new TextEncoder().encode(text);
const gz = new Uint8Array(gzipSync(plain));

test('a table\'s bytes parsed as the CSV worker parses them, gzip read through', async () => {
  const a = await parseTableBytes(plain, 'counts.csv');
  const b = await parseTableBytes(gz, 'counts.csv.gz');
  assert.deepEqual(a.columns.map((c) => c.name), ['hgvs_pro', 'input', 'output']);
  assert.deepEqual(Array.from(b.columns[1].numeric), [100, 40]);
  assert.deepEqual(b.columns.map((c) => c.name), a.columns.map((c) => c.name));
});

test('a source read from its files by their SHA-256; a file not at hand named', async () => {
  const source = { id: 's', name: 'counts', fileName: 'counts.csv.gz', sha256: sha256(gz), files: [{ fileName: 'counts.csv.gz', sha256: sha256(gz) }], mapping: { level: 'protein' } };
  const table = await readSourceTable(source, { file: async (sha) => (sha === sha256(gz) ? gz : null) });
  assert.equal(table.rows, 2);
  await assert.rejects(readSourceTable(source, { file: async () => null }), (error) => error.missing?.sha256 === sha256(gz) && /counts\.csv\.gz \(SHA-256 [0-9a-f]{12}…\) is not at hand/.test(error.message));
});
