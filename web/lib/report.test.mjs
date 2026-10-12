import assert from 'node:assert/strict';
import test from 'node:test';
import { analysisName, comparisonRecord, keptWords, reportMarkdown, writeReport } from './report.js';
import { writeMethods } from './methods.js';
import { addRun, makeRun, removeRun, runInputs } from './runs.js';
import { scoreExperiment, PRESETS } from './score.js';
import { addSelection, createWorkspace, keepAnalysis } from './workspace.js';
import { compareSides, describeSide } from './compare.js';

const target = { id: 't', name: 'Toy', sequenceType: 'protein', sequence: 'MSKGEELFTG', offset: 0 };
const design = {
  format: 'mavescape-design', version: 1, name: 'toy', model: 'two-population',
  variants: { column: 'v', level: 'protein' }, targets: [target], library: { level: 'variant' },
  samples: ['in1', 'out1', 'in2', 'out2'].map((id) => ({ id, name: id, columns: [id] })),
  replicates: [{ id: 'r1', biological: 1, input: 'in1', output: 'out1' }, { id: 'r2', biological: 2, input: 'in2', output: 'out2' }],
  controls: { wildType: 'auto', synonymous: 'auto', nonsense: 'auto' },
};
// Twelve variants of a toy protein, two replicates.
const names = ['p.=', ...Array.from({ length: 11 }, (_, i) => `p.${['Ser2Ala', 'Lys3Arg', 'Gly4Asp', 'Glu5Lys', 'Glu6Gly', 'Leu7Pro', 'Phe8Leu', 'Thr9Ala', 'Gly10Ser', 'Ser2Thr', 'Lys3Glu'][i]}`)];
const col = (base, k) => Float64Array.from(names, (_, i) => (i ? base + ((i * k) % 37) : 2000));
const columns = { in1: col(80, 7), out1: col(40, 11), in2: col(85, 5), out2: col(42, 13) };
const source = { id: 's', name: 'counts.csv', sha256: 'b'.repeat(64), rows: names.length };
const score = (parameters, name, created) => {
  const results = scoreExperiment({ names, columns, design, parameters }).results;
  return { results, run: makeRun({ inputs: runInputs({ source, design, parameters }), source, results, software: { version: '0.6.0', commit: 'abc1234' }, name, created }) };
};
const one = score({}, 'Run 1', '2026-10-12T10:00:00.000Z');
const base = addRun({ ...createWorkspace('Toy', { now: '2026-10-12T09:00:00.000Z', id: 'ws-toy' }), sources: [source], targets: [target], design, designSource: 's' }, one.run).ws;
const context = { software: { version: '0.6.0', commit: 'abc1234' }, runs: new Map([[one.run.id, { results: one.results }]]) };

test('a workspace with one run: what it holds, and only that; its paragraphs its run\'s methods', () => {
  const r = writeReport(base, context);
  assert.deepEqual(r.sections.map((s) => s.id), ['summary', 'data', 'design', 'scoring', 'inputs', 'software', 'log', 'limitations', 'use']);
  const m = writeMethods(base, one.run, { results: one.results });
  assert.equal(r.sections.find((s) => s.id === 'data').blocks[0].text, m.paragraphs[0]);
  assert.equal(r.sections.find((s) => s.id === 'scoring').blocks[0].text, m.paragraphs[2]);
  assert.deepEqual(r.references.map((x) => x.key), m.references.map((x) => x.key));
  assert.ok(!r.sections.find((s) => s.id === 'data').blocks[0].label, 'one run: no label');
  assert.match(r.markdown, /^# Methods: Toy\n/);
  assert.equal(writeReport(base, context).markdown, r.markdown, 'the same text again');
});

test('two runs: named together where they read the same, a parameters table, references in the order cited', () => {
  const two = score({ ...PRESETS.enrich2.parameters }, 'Run 2', '2026-10-12T11:00:00.000Z');
  const ws = addRun(base, two.run).ws;
  const r = writeReport(ws, { ...context, runs: new Map([...context.runs, [two.run.id, { results: two.results }]]) });
  const data = r.sections.find((s) => s.id === 'data').blocks;
  assert.equal(data.length, 1);
  assert.equal(data[0].label, 'Run 1 and Run 2');
  const scoring = r.sections.find((s) => s.id === 'scoring').blocks;
  assert.deepEqual(scoring.filter((b) => b.kind === 'p').map((b) => b.label), ['Run 1', 'Run 2']);
  const table = scoring.find((b) => b.kind === 'table');
  assert.deepEqual(table.columns, ['Parameter', 'Run 1', 'Run 2']);
  assert.deepEqual(table.rows.find((row) => row[0] === '`combination`'), ['`combination`', 'moderated', 'enrich2']);
  const firsts = [...r.markdown.slice(0, r.markdown.indexOf('## References')).matchAll(/\[(\d+)\]/g)].map((x) => Number(x[1]));
  assert.deepEqual(firsts.filter((n, i) => firsts.indexOf(n) === i), r.references.map((x) => x.n));
  const keys = [...r.bibtex.matchAll(/^@\w+\{([^,]+),/gm)].map((x) => x[1]);
  assert.equal(new Set(keys).size, r.references.length);
});

test('a comparison kept in the report: said with its statistics and methods; taken out with the run it read', () => {
  const two = score({ ...PRESETS.enrich2.parameters }, 'Run 2', '2026-10-12T11:00:00.000Z');
  let ws = addRun(base, two.run).ws;
  const pair = { a: { run: one.run.id, condition: 0 }, b: { run: two.run.id, condition: 0 } };
  const c = compareSides(describeSide(ws, one.run, one.results, pair.a), describeSide(ws, two.run, two.results, pair.b));
  const record = comparisonRecord(c, pair);
  assert.equal(analysisName(record), 'the comparison of Run 1 and Run 2');
  assert.match(keptWords(record), /^Added to the report the comparison of Run 1 and Run 2: \d+ variants compared, Pearson's r/);
  ws = keepAnalysis(ws, record, keptWords(record), '2026-10-12T12:00:00.000Z').ws;
  ws = addSelection(ws, { name: 'Low', run: one.run.id, condition: 0, keys: ['p.Leu7Pro'], query: 'lower', created: '2026-10-12T12:30:00.000Z' }).ws;
  const runs = new Map([...context.runs, [two.run.id, { results: two.results }]]);
  const r = writeReport(ws, { ...context, runs });
  const said = r.sections.find((s) => s.id === 'comparisons').blocks[0].text;
  assert.match(said, /^Run 1 and Run 2 were compared on \d+ variants scored on both/);
  assert.match(said, /Pearson's r = [-\d.]+ \(95% interval/);
  assert.ok(r.references.some((x) => x.key === 'lin1989'));
  assert.deepEqual(r.sections.find((s) => s.id === 'selections').blocks[0].items, ['"Low": 1 variant of Run 1, selected by the query "lower".']);
  assert.deepEqual(r.sections.find((s) => s.id === 'log').blocks[1].items.slice(-2).map((x) => x.slice(18)), [keptWords(record), 'Saved the selection "Low": 1 variant']);
  const gone = removeRun(ws, two.run.id);
  assert.equal(gone.analyses, undefined);
  assert.match(gone.history.at(-1).detail, /and from the report the analysis reading it$/);
  assert.ok(!writeReport(gone, { ...context, runs }).sections.some((s) => s.id === 'comparisons'));
});

test('Markdown: titles, labels in bold, lists, tables with their pipes escaped', () => {
  const md = reportMarkdown('Methods: X', [
    { id: 'summary', title: null, blocks: [{ kind: 'p', text: 'Intro.' }] },
    { id: 'a', title: 'A', blocks: [{ kind: 'p', label: 'Run 1', text: 'Text [1].' }, { kind: 'list', items: ['one', 'two'] }, { kind: 'table', columns: ['x', 'y'], rows: [['a|b', 'c']] }] },
  ], [{ n: 1, key: 'k', text: 'A reference.' }]);
  assert.equal(md, '# Methods: X\n\nIntro.\n\n## A\n\n**Run 1.** Text [1].\n\n- one\n- two\n\n| x | y |\n| --- | --- |\n| a\\|b | c |\n\n## References\n\n1. A reference.\n');
});
