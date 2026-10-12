import assert from 'node:assert/strict';
import test from 'node:test';
import { formatNumber, traced, tracedValues, workspaceValue } from './review.js';
import { numberItems, writeCertificate } from './certificate.js';
import { canonicalJSON, createWorkspace } from './workspace.js';
import { scoreExperiment } from './score.js';
import { addRun, makeRun, runInputs } from './runs.js';
import { sha256 } from './sha256.js';

test('numbers as the report shows them', () => {
  assert.deepEqual([1234, 0.123456, -1.97299, 0.0000123, Number.NaN, Infinity].map((x) => formatNumber(x)), ['1,234', '0.1235', '−1.973', '1.230e−5', '—', '∞']);
});

test('a traced value: a button with its key and exact value, read back as written', () => {
  const html = `${traced('run|r|0|score|3', -1.9729909782555688)} ${traced('ws|runs.0.name', 'Run "1" <a>')} ${traced('qc|r|depth|acknowledged', null, 'no')}<script>'<button type="button" class="n" data-k="' + k + '" data-v="' + v + '">'</script>`;
  assert.match(html, /^<button type="button" class="n" data-k="run\|r\|0\|score\|3" data-v="-1.9729909782555688">−1.973<\/button>/);
  assert.deepEqual(tracedValues(html), [{ key: 'run|r|0|score|3', value: -1.9729909782555688 }, { key: 'ws|runs.0.name', value: 'Run "1" <a>' }, { key: 'qc|r|depth|acknowledged', value: null }]);
  assert.equal(workspaceValue({ runs: [{ inputs: { parameters: { filters: { minInputCount: 10 } } } }], selections: [{ keys: ['a', 'b'] }] }, 'runs.0.inputs.parameters.filters.minInputCount'), 10);
  assert.equal(workspaceValue({ selections: [{ keys: ['a', 'b'] }] }, 'selections.0.keys.length'), 2);
});

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
const bytes = new TextEncoder().encode(`v,in1,out1,in2,out2\n${names.map((n, i) => [n, columns.in1[i], columns.out1[i], columns.in2[i], columns.out2[i]].join(',')).join('\n')}\n`);
const sha = sha256(bytes);
const source = { id: 's', name: 'counts.csv', fileName: 'counts.csv', sha256: sha, rows: names.length, files: [{ fileName: 'counts.csv', sha256: sha }], mapping: { variantColumn: 'v', level: 'protein', mode: 'lenient' }, target: 't' };
const results = scoreExperiment({ names, columns: Object.fromEntries(Object.entries(columns).map(([k, v]) => [k, Float64Array.from(v)])), design, parameters: {} }).results;
const run = makeRun({ inputs: runInputs({ source, design, parameters: {} }), source, results, software: { version: '0.6.0', commit: '' }, name: 'Run 1', created: '2026-10-12T10:00:00.000Z' });
const ws = addRun({ ...createWorkspace('Toy', { now: '2026-10-12T09:00:00.000Z', id: 'ws-toy' }), sources: [source], targets: [target], design, designSource: 's' }, run).ws;

test('a review report: self-contained, every traced number the certificate\'s or the workspace\'s, the certificate whole in it', async () => {
  const made = await writeCertificate(ws, async (s) => (s === sha ? bytes : null), { software: { version: '0.6.0', commit: 'abc' }, review: true });
  const html = made.review;
  assert.match(html, /^<!doctype html>\n<html lang="en">/);
  assert.ok(!/<(link|img|iframe)\b|\ssrc=|@import/.test(html), 'it loads nothing');
  const items = new Map([...numberItems(made.certificate.numbers)].map(([, k, v]) => [k, v]));
  const values = tracedValues(html);
  assert.ok(values.length > 20);
  for (const { key, value } of values) {
    if (key.startsWith('ws|')) assert.deepEqual(workspaceValue(ws, key.slice(3)) ?? null, value, key);
    else if (!key.startsWith('count|')) assert.equal(canonicalJSON(items.get(key)), canonicalJSON(value), key);
  }
  const block = html.slice(html.indexOf('id="mavescape-review">') + 22, html.indexOf('</script>', html.indexOf('id="mavescape-review">')));
  assert.equal(JSON.parse(block).certificate.fingerprint, made.certificate.fingerprint);
  const again = await writeCertificate(ws, async (s) => (s === sha ? bytes : null), { software: { version: '0.6.0', commit: 'abc' }, review: true });
  assert.equal(again.review, html, 'the same bytes again');
});
