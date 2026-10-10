import assert from 'node:assert/strict';
import test from 'node:test';
import { referenceText, REFERENCES, toBibTeX, writeMethods } from './methods.js';
import { makeRun, runInputs } from './runs.js';
import { defaultParameters, scoreExperiment, PRESETS } from './score.js';
import { parseTable } from './csv.js';
import { simulateExperiment } from './simulate.js';
import { createWorkspace } from './workspace.js';

const design = {
  format: 'mavescape-design', version: 1, name: 'toy', model: 'two-population',
  variants: { column: 'v', level: 'protein' }, targets: [{ id: 't', name: 'Toy', sequenceType: 'protein', sequence: 'MSKG' }], library: { level: 'variant' },
  samples: [{ id: 'in', name: 'in', columns: ['in'] }, { id: 'out', name: 'out', columns: ['out'] }],
  replicates: [{ id: 'r1', biological: 1, input: 'in', output: 'out' }],
  controls: { wildType: 'auto', synonymous: 'auto', nonsense: 'auto' },
  source: { citation: 'Someone et al., A Journal 2024', mavedb: 'urn:mavedb:00000001-a-1', license: 'CC0' },
};

test('references as text and BibTeX', () => {
  assert.match(referenceText(REFERENCES.enrich2), /^Rubin AF, Gelman H, Lucas N, Bajjalieh SM, Papenfuss AT, Speed TP, et al\. A statistical framework/);
  assert.match(referenceText(REFERENCES.higgins), /Statistics in Medicine\. 2002;21\(11\):1539–1558\. doi:10\.1002\/sim\.1186$/);
  assert.match(toBibTeX([{ key: 'higgins', ref: REFERENCES.higgins }]), /^@article\{higgins2002,\n {2}author = \{Higgins, Julian P T and Thompson, Simon G\}/);
});

test('the methods say what the run did, cite in order, and change with the parameters', () => {
  const source = { id: 's', name: 'c.csv', sha256: 'f'.repeat(64), rows: 2, mapping: { mode: 'lenient' } };
  const results = scoreExperiment({ names: ['p.=', 'p.Ser2Ala'], columns: { in: Float64Array.of(10, 10), out: Float64Array.of(10, 5) }, design, parameters: PRESETS.enrich2.parameters }).results;
  const run = makeRun({ inputs: runInputs({ source, design, parameters: PRESETS.enrich2.parameters }), source, results, software: { version: '0.1.0', commit: '' }, name: 'Run 1', created: '2026-10-09T00:00:00.000Z' });
  const ws = { ...createWorkspace('m'), sources: [source] };
  const m = writeMethods(ws, run);
  assert.match(m.markdown, /Enrich2's random-effects estimator \[\d\]/);
  assert.match(m.markdown, /The data are from Someone et al\., A Journal 2024 \[1\], MaveDB urn:mavedb:00000001-a-1/);
  assert.deepEqual(m.references.map((r) => r.n), m.references.map((_, i) => i + 1));
  assert.equal(writeMethods(ws, run).markdown, m.markdown, 'deterministic');
  assert.match(m.markdown, /does not classify variants as pathogenic or benign/);
});

test('a run scored by DiMSum\'s model: the methods give its fitted scales, shifts and error terms', () => {
  const sim = simulateExperiment({ seed: 5, inputCells: 25 });
  const table = parseTable(sim.csv);
  const source = { id: 's', name: 'sim.csv', sha256: 'e'.repeat(64), rows: table.rows, mapping: { mode: 'lenient' } };
  const parameters = defaultParameters(sim.design, null, 'dimsum');
  const results = scoreExperiment({ names: table.columns[0].values, columns: Object.fromEntries(table.columns.slice(1).map((c) => [c.name, c.numeric])), design: sim.design, parameters }).results;
  const run = makeRun({ inputs: runInputs({ source, design: sim.design, parameters }), source, results, software: { version: '0.2.0', commit: '' }, name: 'Run 1', created: '2026-10-09T00:00:00.000Z' });
  const m = writeMethods({ ...createWorkspace('m'), sources: [source] }, run).markdown;
  assert.match(m, /Scores are DiMSum's fitness \[\d\]/);
  const fit = run.output.replicates.map((r) => r.dimsum);
  assert.ok(fit.every((d) => d.input > d.output) && fit.every((d) => d.input > 4), 'the bottleneck before selection: input terms above the outputs\'');
  const g = (x) => String(Number(x.toPrecision(3)));
  assert.ok(m.includes(`For Replicate 1, Replicate 2, Replicate 3 in turn, the scales were ${fit.map((d) => g(d.scale)).join(', ')}`), m);
  assert.ok(m.includes(`the multiplicative error terms ${fit.map((d) => g(d.input)).join(', ')} at the input`));
});
