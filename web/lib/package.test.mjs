import assert from 'node:assert/strict';
import test from 'node:test';
import { packageContents, targetFASTA, writePackage } from './package.js';
import { readZip } from './zip.js';
import { sha256 } from './sha256.js';
import { createWorkspace } from './workspace.js';

const target = { id: 'grb2', name: 'GRB2 SH3', sequenceType: 'protein', sequence: 'M'.repeat(130) };
const bytes = new TextEncoder().encode('hgvs_pro,in1,out1\np.=,10,12\n');
const design = {
  format: 'mavescape-design', version: 1, name: 'A design', model: 'two-population', variants: { column: 'hgvs_pro', level: 'protein' }, targets: [target],
  samples: [{ id: 'in1', columns: ['in1'] }, { id: 'out1', columns: ['out1'] }], replicates: [{ id: 'r1', biological: 1, input: 'in1', output: 'out1' }],
  controls: { wildType: 'auto', synonymous: 'auto', nonsense: 'auto' },
};
const ws = {
  ...createWorkspace('W', { now: '2026-10-10T00:00:00.000Z', id: 'w' }),
  targets: [target],
  sources: [{ id: 's', name: 'counts.csv', fileName: 'counts.csv', sha256: sha256(bytes), columns: [{ name: 'hgvs_pro' }, { name: 'in1' }, { name: 'out1' }], mapping: { countColumns: ['in1', 'out1'] }, summary: { byKind: { 'wild type': 1 } }, problems: { blocking: [] } }],
  designSource: 's',
  design,
  qc: { acknowledged: { coverage: { reason: 'a library of single-base changes, it\'s expected' } } },
};

test('a target as FASTA, sixty to a line', () => {
  assert.equal(targetFASTA(target), `>grb2 GRB2 SH3\n${'M'.repeat(60)}\n${'M'.repeat(60)}\n${'M'.repeat(10)}\n`);
});

test('the package: the counts byte for byte, the design and default parameters, a sheet, and a README with the command', async () => {
  const pack = await writePackage(ws, { sources: new Map([[sha256(bytes), bytes]]), software: { version: '0.2.0' } });
  const files = await readZip(pack.bytes);
  assert.deepEqual([...files.keys()], ['README.md', 'counts/counts.csv', 'target.fasta', 'design.json', 'samples.csv', 'parameters.json', 'readiness.json']);
  assert.deepEqual(files.get('counts/counts.csv'), bytes);
  const readme = new TextDecoder().decode(files.get('README.md'));
  assert.match(readme, /mavescape run --design design\.json --parameters parameters\.json \\\n {8}--acknowledge 'coverage=a library of single-base changes, it'\\''s expected' \\\n {8}--out results \\\n {8}counts\/counts\.csv/);
  assert.match(readme, /MaveScape's default parameters for this design/);
  assert.equal(JSON.parse(new TextDecoder().decode(files.get('parameters.json'))).combination, 'moderated');
});

test('a table not in the library, or not the one imported, is said, not packaged', async () => {
  await assert.rejects(writePackage(ws, { sources: new Map() }), /not in the library/);
  await assert.rejects(writePackage(ws, { sources: new Map([[sha256(bytes), new TextEncoder().encode('other')]]) }), /SHA-256 differs/);
  assert.throws(() => packageContents({ ...ws, design: null }), /no design to package/);
});
