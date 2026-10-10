import assert from 'node:assert/strict';
import test from 'node:test';
import { addCondition, addReplicate, addTile, assignColumn, columnAssignments, emptyDesign, removeCondition, removeReplicate, removeTile, setBinValue, setControlPositions, setControlWhy, setLibraryMethod, setModel, setReadout, setSlot, setTime, slotSample, slotsOf, updateCondition, updateReplicate, updateSample } from './design-edit.js';
import { designFromSampleSheet } from './samplesheet.js';
import { parseTable } from './csv.js';
import { summarizeDesign, validateDesign } from './design.js';

const target = { id: 't', name: 'Toy', sequenceType: 'protein', sequence: 'MSKGEELFTG' };
const columns = ['hgvs_pro', 'in1', 'out1', 'in2', 'out2', 'in2b'];
const ok = (design) => {
  const r = validateDesign(design, { columns });
  return r.ok ? 'ok' : r.errors.map((e) => e.message).join(' | ');
};

// A two-population design built by edits, as the editor makes it.
function built() {
  let d = emptyDesign({ targets: [target] });
  for (const c of ['in1', 'out1', 'in2', 'out2']) d = assignColumn(d, c, { kind: 'new-sample' }).design;
  d = assignColumn(d, 'in2b', { kind: 'sample', sample: 'in2' }).design;
  d = addReplicate(d).design;
  d = addReplicate(d).design;
  const [input, output] = slotsOf(d);
  d = setSlot(d, 'rep1', input, 'in1');
  d = setSlot(d, 'rep1', output, 'out1');
  d = setSlot(d, 'rep2', input, 'in2');
  d = setSlot(d, 'rep2', output, 'out2');
  return d;
}

test('a design built by edits: samples from columns (one with a technical replicate), replicates, slots', () => {
  const d = built();
  assert.equal(ok(d), 'ok');
  assert.deepEqual(d.samples.find((s) => s.id === 'in2').columns, ['in2', 'in2b']);
  assert.deepEqual(d.replicates.map((r) => [r.id, r.biological, r.input, r.output]), [['rep1', 1, 'in1', 'out1'], ['rep2', 2, 'in2', 'out2']]);
  const assigned = columnAssignments(d, columns);
  assert.deepEqual(assigned.get('in2b'), { kind: 'sample', sample: 'in2' });
  assert.deepEqual(assigned.get('hgvs_pro'), { kind: 'unassigned' });
});

test('moving a column away empties and drops its sample, and the slots that used it', () => {
  let d = built();
  d = assignColumn(d, 'out1', { kind: 'ignored', reason: 'failed library' }).design;
  assert.equal(d.samples.some((s) => s.id === 'out1'), false);
  assert.equal(d.replicates[0].output, undefined);
  assert.deepEqual(d.ignoredColumns, [{ column: 'out1', reason: 'failed library' }]);
  assert.match(ok(d), /needs an input and an output/);
  d = assignColumn(d, 'out1', { kind: 'new-sample' }).design;
  assert.equal(d.ignoredColumns, undefined, 'no empty list is left');
});

test('a shared input: one sample in two replicates, its repeated column a copy', () => {
  let d = built();
  d = assignColumn(d, 'in2', { kind: 'copy', copyOf: 'in1' }).design;
  d = setSlot(d, 'rep2', slotsOf(d)[0], 'in1');
  assert.deepEqual(d.ignoredColumns, [{ column: 'in2', reason: 'repeats a sample its replicates share', copyOf: 'in1' }]);
  assert.deepEqual(d.samples.find((s) => s.id === 'in2b')?.columns ?? d.samples.find((s) => s.columns.includes('in2b')).columns, ['in2b']);
  assert.match(summarizeDesign(d).lines.join(' '), /1 sample is shared between replicates/);
  // Removing the copied column's sample turns the copy into a column set aside.
  d = assignColumn(d, 'in1', { kind: 'unassigned' }).design;
  assert.deepEqual(d.ignoredColumns, [{ column: 'in2', reason: 'was a copy of in1' }]);
});

test('time series: times as matrix columns, renamed together; collisions refused', () => {
  let d = setModel(built(), 'time-series');
  assert.deepEqual(d.replicates[0].timepoints, [{ sample: 'in1', time: 0 }, { sample: 'out1', time: 1 }]);
  assert.deepEqual(slotsOf(d).map((s) => s.label), ['Time 0 (input)', 'Time 1 generations']);
  d = setTime(d, 1, 21);
  assert.deepEqual(d.replicates.map((r) => r.timepoints.map((t) => t.time)), [[0, 21], [0, 21]]);
  assert.throws(() => setTime(d, 21, 0), /already a column/);
  assert.deepEqual(slotsOf(d, [{ time: 10 }]).map((s) => s.time), [0, 10, 21], 'a time added before any sample is placed');
  const back = setModel(d, 'two-population');
  assert.deepEqual([back.replicates[0].input, back.replicates[0].output], ['in1', 'out1']);
});

test('bins: values edited for every replicate at once', () => {
  let d = setModel(built(), 'bins');
  const slot = { key: 'b:1', order: 1, value: 0.25 };
  d = setSlot(d, 'rep1', slot, 'in1');
  d = setSlot(d, 'rep1', { key: 'b:2', order: 2, value: 0.5 }, 'out1');
  d = setSlot(d, 'rep2', slot, 'in2');
  d = setBinValue(d, 1, 0.3);
  assert.deepEqual(d.replicates.map((r) => r.bins.map((b) => b.value)), [[0.3, 0.5], [0.3]]);
  assert.equal(slotSample(d.replicates[0], { order: 2 }), 'out1');
});

test('conditions and tiles: the first takes every replicate; removing reassigns', () => {
  let d = built();
  d = addCondition(d, 'No drug').design;
  assert.deepEqual(d.replicates.map((r) => r.condition), ['No-drug', 'No-drug']);
  const second = addCondition(d, 'Drug');
  d = updateReplicate(second.design, 'rep2', { condition: 'Drug', biological: 1 });
  d = updateCondition(d, 'No-drug', { reference: true });
  assert.equal(ok(d), 'ok');
  assert.deepEqual(d.conditions, [{ id: 'No-drug', name: 'No drug', reference: true }, { id: 'Drug', name: 'Drug' }]);
  d = removeCondition(d, 'No-drug');
  assert.deepEqual(d.replicates.map((r) => r.condition), ['Drug', 'Drug']);
  assert.match(ok(d), /both biological replicate 1/);
  d = removeCondition(d, 'Drug');
  assert.equal(d.conditions, undefined);
  d = addTile(built(), 1, 5).design;
  assert.deepEqual(d.replicates.map((r) => r.tile), ['tile1', 'tile1']);
  d = removeTile(d, 'tile1');
  assert.equal(d.library.tiles, undefined);
  assert.equal(removeReplicate(d, 'rep1').replicates.length, 1);
  assert.equal(updateSample(d, 'in1', { batch: 'run 3', name: '' }).samples[0].batch, 'run 3');
});

test('a sample sheet: technical replicates, conditions, a shared input', () => {
  const sheet = parseTable('sample,role,replicate,technical_replicate,condition,batch\nin1,input,,,DMSO,A\nout1,output,1,1,DMSO,A\nout1b,output,1,2,DMSO,B\nout2,output,2,,DMSO,A\n');
  const { design, problems } = designFromSampleSheet(sheet, { countColumns: ['in1', 'out1', 'out1b', 'out2', 'extra'], targets: [target], variants: { column: 'hgvs_pro', level: 'protein' } });
  assert.deepEqual(problems, []);
  assert.equal(design.model, 'two-population');
  assert.deepEqual(design.samples.map((s) => [s.id, s.columns]), [['in1', ['in1']], ['out1', ['out1', 'out1b']], ['out2', ['out2']]]);
  assert.deepEqual(design.replicates.map((r) => [r.id, r.condition, r.input, r.output]), [['DMSO-rep1', 'DMSO', 'in1', 'out1'], ['DMSO-rep2', 'DMSO', 'in1', 'out2']]);
  assert.deepEqual(design.ignoredColumns, [{ column: 'extra', reason: 'not in the sample sheet' }]);
  assert.equal(validateDesign(design, { columns: ['hgvs_pro', 'in1', 'out1', 'out1b', 'out2', 'extra'] }).ok, true);
});

test('DiMSum\'s experiment design file (CR line ends) as a sample sheet', () => {
  const text = 'sample_name\texperiment_replicate\tselection_id\tselection_replicate\ttechnical_replicate\tpair1\tpair2\rinput1\t1\t0\t\t\ta.fastq.gz\tb.fastq.gz\routput1A\t1\t1\t1\t\tc.fastq.gz\td.fastq.gz\rinput2\t2\t0\t\t\te\tf\routput2A\t2\t1\t1\t\tg\th\r';
  const { design, problems, found } = designFromSampleSheet(parseTable(text), { countColumns: ['input1', 'output1A', 'input2', 'output2A'] });
  assert.deepEqual(problems, []);
  assert.deepEqual(found, { column: 'sample_name', role: 'selection_id', replicate: 'experiment_replicate', technical: 'technical_replicate' });
  assert.deepEqual(design.replicates.map((r) => [r.biological, r.input, r.output]), [[1, 'input1', 'output1A'], [2, 'input2', 'output2A']]);
});

test('a time series from times, and the problems of a sheet said by line', () => {
  const sheet = parseTable('column,generation,replicate\nA_c_0,0,1\nA_c_1,7,1\nB_c_1,7,2\nnope,3,2\nmystery,,2\n');
  const { design, problems } = designFromSampleSheet(sheet, { countColumns: ['A_c_0', 'A_c_1', 'B_c_1', 'mystery'] });
  assert.equal(design.model, 'time-series');
  assert.equal(design.time.unit, 'generation');
  assert.deepEqual(problems.map((p) => p.line), [5, 6]);
  assert.match(problems[0].message, /"nope" is not a column of the count table/);
  assert.match(problems[1].message, /say whether "mystery" is an input/);
});

test('columns the design neither uses nor sets aside are set aside with a reason', async () => {
  const { setAsideOtherColumns } = await import('./design-edit.js');
  const d = setAsideOtherColumns(built(), ['hgvs_pro', 'accession', 'in1', 'out1', 'in2', 'out2', 'in2b', 'y2h_c_0', 'notes'], ['accession']);
  assert.deepEqual(d.ignoredColumns, [{ column: 'y2h_c_0', reason: 'not a count column (left out at import)' }, { column: 'notes', reason: 'not a count column (left out at import)' }]);
  const complete = built();
  assert.equal(setAsideOtherColumns(complete, ['hgvs_pro', 'in1', 'out1', 'in2', 'out2', 'in2b']), complete, 'nothing to set aside: the same design');
});

test('the readout, the library\'s method and where controls serve: set, and removed when emptied', () => {
  const base = { model: 'two-population', library: { level: 'variant' }, controls: { nonsense: 'auto' } };
  let d = setReadout(base, { direction: 'higher-less', phenotype: 'Toxicity' });
  assert.deepEqual(d.readout, { direction: 'higher-less', phenotype: 'Toxicity' });
  d = setReadout(setReadout(d, { phenotype: '' }), { direction: '' });
  assert.equal(d.readout, undefined);
  assert.deepEqual(setLibraryMethod(base, 'Error-prone PCR').library, { level: 'variant', method: 'Error-prone PCR' });
  assert.deepEqual(setLibraryMethod(setLibraryMethod(base, 'Error-prone PCR'), '').library, { level: 'variant' });
  d = setControlPositions(base, 'nonsense', { start: null, end: 93 });
  assert.deepEqual(d.controls.positions, { nonsense: { end: 93 } });
  assert.equal(setControlPositions(d, 'nonsense', {}).controls.positions, undefined);
  d = setControlWhy(base, 'nonsense', ' Late stops keep binding ');
  assert.deepEqual(d.controls.why, { nonsense: 'Late stops keep binding' });
  assert.equal(setControlWhy(d, 'nonsense', '').controls.why, undefined);
});
