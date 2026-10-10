import assert from 'node:assert/strict';
import test from 'node:test';
import { designFromSampleSheet, designStructure, sampleSheetCSV } from './samplesheet.js';
import { parseTable } from './csv.js';

const sheet = (text) => parseTable(new TextEncoder().encode(text));
const design = {
  format: 'mavescape-design', version: 1, model: 'two-population', variants: { column: 'hgvs_pro', level: 'protein' }, targets: [],
  conditions: [{ id: 'a', name: 'Without ligand', reference: true }, { id: 'b', name: 'With ligand' }],
  samples: [
    { id: 'in1', columns: ['in1', 'in1b'], cells: 50000 },
    { id: 'a1', columns: ['a1'] }, { id: 'b1', columns: ['b1'] },
    { id: 'in2', columns: ['in2'], batch: 'lane 2' }, { id: 'a2', columns: ['a2'] }, { id: 'b2', columns: ['b2'] },
  ],
  replicates: [
    { id: 'a-1', biological: 1, condition: 'a', input: 'in1', output: 'a1' }, { id: 'b-1', biological: 1, condition: 'b', input: 'in1', output: 'b1' },
    { id: 'a-2', biological: 2, condition: 'a', input: 'in2', output: 'a2' }, { id: 'b-2', biological: 2, condition: 'b', input: 'in2', output: 'b2' },
  ],
};

test('a design written as a sample sheet reads back as the same design: inputs under two conditions, technical replicates, cells, batches', () => {
  const { csv, complete } = sampleSheetCSV(design);
  assert.ok(complete);
  assert.ok(csv.split('\n').includes('in1,input,1,1,Without ligand;With ligand,,,50000'));
  assert.ok(csv.split('\n').includes('in1b,input,1,2,Without ligand;With ligand,,,'), 'a technical replicate, its cells on the first column only');
  const back = designFromSampleSheet(sheet(csv)).design;
  assert.deepEqual(designStructure(back), designStructure(design));
});

test('a sample in two roles cannot be said by one sheet: not complete', () => {
  const twoRoles = { ...design, conditions: undefined, replicates: [{ id: 'r1', biological: 1, input: 'in1', output: 'a1' }, { id: 'r2', biological: 2, input: 'a1', output: 'b1' }] };
  assert.equal(sampleSheetCSV(twoRoles).complete, false);
});

test('a time series names its unit in the time column, and a unit the sheet has no name for is not complete', () => {
  const ts = {
    format: 'mavescape-design', version: 1, model: 'time-series', time: { unit: 'generation' }, variants: { column: 'hgvs_pro', level: 'protein' }, targets: [],
    samples: [0, 4, 8].map((t) => ({ id: `t${t}`, columns: [`t${t}`] })),
    replicates: [{ id: 'r1', biological: 1, timepoints: [0, 4, 8].map((t) => ({ sample: `t${t}`, time: t })) }],
  };
  const { csv, complete } = sampleSheetCSV(ts);
  assert.ok(complete);
  assert.equal(csv.split('\n')[0], 'column,role,replicate,technical_replicate,condition,tile,generation,batch,cells');
  assert.equal(sampleSheetCSV({ ...ts, time: { unit: 'minute' } }).complete, false);
});
