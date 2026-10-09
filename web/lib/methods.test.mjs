import assert from 'node:assert/strict';
import test from 'node:test';
import { referenceText, REFERENCES, toBibTeX, writeMethods } from './methods.js';
import { makeRun, runInputs } from './runs.js';
import { scoreExperiment, PRESETS } from './score.js';
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
