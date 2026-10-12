import assert from 'node:assert/strict';
import test from 'node:test';
import { certificateFingerprint, certificateInputs, certificateText, compareNumbers, countNumbers, encodeAll, encodeNumber, numberItems, readCertificate, shortFingerprint, verifyCertificate, writeCertificate } from './certificate.js';
import { createWorkspace } from './workspace.js';
import { scoreExperiment } from './score.js';
import { addRun, makeRun, runInputs } from './runs.js';
import { sha256 } from './sha256.js';
import { writeArchive } from './archive.js';

const target = { id: 't', name: 'Toy', sequenceType: 'protein', sequence: 'MSKGEELFTG', offset: 0 };
const design = {
  format: 'mavescape-design', version: 1, name: 'toy', model: 'two-population',
  variants: { column: 'v', level: 'protein' }, targets: [target], library: { level: 'variant' },
  samples: ['in1', 'out1', 'in2', 'out2'].map((id) => ({ id, name: id, columns: [id] })),
  replicates: [{ id: 'r1', name: 'Replicate 1', biological: 1, input: 'in1', output: 'out1' }, { id: 'r2', name: 'Replicate 2', biological: 2, input: 'in2', output: 'out2' }],
  controls: { wildType: 'auto', synonymous: 'auto', nonsense: 'auto' },
};
const names = ['p.=', 'p.Ser2Ala', 'p.Lys3Arg', 'p.Gly4Asp', 'p.Glu5Lys', 'p.Glu6Gly', 'p.Leu7Pro', 'p.Phe8Leu', 'p.Thr9Ala', 'p.Gly10Ser'];
const counts = (base, k) => names.map((_, i) => (i ? base + ((i * k) % 37) : 2000));
const columns = { in1: counts(80, 7), out1: counts(30, 11), in2: counts(85, 5), out2: counts(32, 13) };
const csv = `v,in1,out1,in2,out2\n${names.map((n, i) => [n, columns.in1[i], columns.out1[i], columns.in2[i], columns.out2[i]].join(',')).join('\n')}\n`;
const bytes = new TextEncoder().encode(csv);
const sha = sha256(bytes);
const source = { id: 's', name: 'counts.csv', fileName: 'counts.csv', sha256: sha, rows: names.length, files: [{ fileName: 'counts.csv', sha256: sha }], mapping: { variantColumn: 'v', level: 'protein', mode: 'lenient' }, target: 't' };
const results = scoreExperiment({ names, columns: Object.fromEntries(Object.entries(columns).map(([k, v]) => [k, Float64Array.from(v)])), design, parameters: {} }).results;
const run = makeRun({ inputs: runInputs({ source, design, parameters: {} }), source, results, software: { version: '0.6.0', commit: '' }, name: 'Run 1', created: '2026-10-12T10:00:00.000Z' });
const ws = addRun({ ...createWorkspace('Toy', { now: '2026-10-12T09:00:00.000Z', id: 'ws-toy' }), sources: [source], targets: [target], design, designSource: 's' }, run).ws;
const file = async (s) => (s === sha ? bytes : null);
const SW = { version: '0.6.0', commit: 'abc' };

test('numbers as certificate.json keeps them: NaN and infinities as text, -0 as 0, typed arrays as lists', () => {
  assert.deepEqual([NaN, Infinity, -Infinity, -0, 1.5, null, undefined].map(encodeNumber), ['NaN', 'Infinity', '-Infinity', 0, 1.5, null, null]);
  assert.deepEqual(encodeAll({ a: Float64Array.of(1, NaN), b: new Map([['x', 2]]), c: undefined }), { a: [1, 'NaN'], b: { x: 2 } });
  assert.equal(shortFingerprint('0123456789abcdef0123'), '0123-4567-89ab-cdef');
});

test('its text: one-space indentation, lists of numbers on one line, the same JSON', () => {
  const value = { a: [1, 2, 'NaN'], b: { c: [{ d: 1 }] } };
  assert.equal(certificateText(value), '{\n "a": [1,2,"NaN"],\n "b": {\n  "c": [\n   {\n    "d": 1\n   }\n  ]\n }\n}\n');
  assert.deepEqual(JSON.parse(certificateText(value)), value);
});

test('the files it reads: each once, the tables a run reads needed', () => {
  assert.deepEqual(certificateInputs(ws), [{ role: 'table', name: 'counts.csv', fileName: 'counts.csv', sha256: sha, needed: true }]);
});

test('made, read back and verified bit for bit; the fingerprint the SHA-256 of the rest; the same bytes again', async () => {
  const made = await writeCertificate(ws, file, { software: SW, created: '2026-10-12T12:00:00.000Z' });
  const c = made.certificate;
  assert.equal(c.fingerprint, certificateFingerprint(c));
  assert.equal(c.total, countNumbers(c.numbers));
  assert.equal(c.numbers.runs[0].output, run.output.sha256);
  assert.deepEqual(c.numbers.runs[0].variants, names);
  assert.equal(c.numbers.qc[0].run, run.id);
  assert.ok(c.numbers.report.markdown.length === 64);
  const again = await writeCertificate(ws, file, { software: SW, created: '2026-10-12T12:00:00.000Z' });
  assert.deepEqual(again.bytes, made.bytes);
  const read = await readCertificate(made.bytes);
  const report = await verifyCertificate(read, { software: SW });
  assert.equal(report.verdict, 'verified');
  assert.equal(report.exit, 0);
  assert.equal(report.numbers.same, c.total);
  assert.match(report.summary, /^Verified: all [\d,]+ numbers of "Toy" were computed again from its 1 table and are identical, bit for bit/);
});

test('without its tables: not checkable, then verified with them; a missing file needed refused when making one', async () => {
  const made = await writeCertificate(ws, file, { software: SW, created: '2026-10-12T12:00:00.000Z', tables: false });
  assert.equal(made.certificate.inputs[0].path, null);
  const without = await verifyCertificate(await readCertificate(made.bytes), { software: SW });
  assert.equal(without.verdict, 'incomplete');
  assert.equal(without.exit, 2);
  assert.equal(without.numbers.differs, 0);
  assert.match(without.summary, /^Not checkable: 1 table is missing \(counts\.csv/);
  const given = await verifyCertificate(await readCertificate(made.bytes), { software: SW, file });
  assert.equal(given.verdict, 'verified');
  await assert.rejects(writeCertificate(ws, async () => null, { software: SW }), /needs a file the library does not hold: counts\.csv/);
});

test('the numbers compared: the same, a difference labeled by its variant, a group blocked counted missing', () => {
  const recorded = { runs: [{ id: 'r', name: 'Run 1', output: 'x', variants: ['p.Ala1Val'], conditions: [{ id: 'c', name: 'c', score: [1.5], se: [0.1], class: [1] }], contrasts: [] }], qc: [], analyses: [], figures: [], report: null };
  assert.deepEqual([...numberItems(recorded)].map((i) => i[1]), ['run|r|output', 'run|r|variants', 'run|r|0|score|0', 'run|r|0|se|0', 'run|r|0|class|0']);
  const changed = structuredClone(recorded);
  changed.runs[0].conditions[0].score[0] = 1.25;
  const d = compareNumbers(recorded, changed);
  assert.deepEqual([d.checked, d.same, d.differs], [5, 4, 1]);
  assert.deepEqual(d.differ[0], { key: 'run|r|0|score|0', label: 'Run 1: the score of p.Ala1Val', recorded: 1.5, computed: 1.25 });
  const blocked = compareNumbers(recorded, { runs: [] }, new Map([['run:r', 'its table is missing']]));
  assert.deepEqual([blocked.same, blocked.differs, blocked.missing], [0, 0, 5]);
  assert.deepEqual(blocked.missingGroups, [{ group: 'run:r', why: 'its table is missing' }]);
});

test('a workspace archive that is not a certificate is refused, saying so', async () => {
  const { bytes: archive } = await writeArchive(ws, { software: SW, sources: new Map([[sha, bytes]]) });
  await assert.rejects(readCertificate(archive), /not a certificate \(it has no certificate\.json\)/);
});
