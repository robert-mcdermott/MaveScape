import assert from 'node:assert/strict';
import test from 'node:test';
import { notRecorded, readiness, readinessText } from './readiness.js';
import { createWorkspace } from './workspace.js';

const target = { id: 't', name: 'T', sequenceType: 'protein', sequence: 'MKVLA' };
// A workspace with one table (its import summary) and a design.
function workspace(design, byKind = { 'wild type': 1, synonymous: 12, nonsense: 5, missense: 90 }) {
  const columns = design.samples.flatMap((s) => s.columns);
  return {
    ...createWorkspace('w', { now: '2026-10-10T00:00:00.000Z', id: 'w' }),
    targets: [target],
    sources: [{ id: 's', name: 'counts.csv', columns: [{ name: 'hgvs_pro' }, ...columns.map((name) => ({ name }))], mapping: { countColumns: columns }, summary: { byKind }, problems: { blocking: [] }, target: 't' }],
    designSource: 's',
    design,
  };
}
const base = { format: 'mavescape-design', version: 1, variants: { column: 'hgvs_pro', level: 'protein' }, targets: [target], controls: { wildType: 'auto', synonymous: 'auto', nonsense: 'auto' } };
const bins = (gates, cells) => ({
  ...base, model: 'bins', bins: { weight: 'rank' },
  samples: [1, 2, 3].flatMap((r) => [1, 2, 3].map((b) => ({ id: `r${r}b${b}`, columns: [`r${r}b${b}`], ...(cells ? { cells: 1000 } : {}) }))),
  replicates: [1, 2, 3].map((r) => ({ id: `r${r}`, biological: r, bins: [1, 2, 3].map((b) => ({ sample: `r${r}b${b}`, order: b, value: b, ...(gates && b > 1 ? { lower: 10 * b } : {}), ...(gates && b < 3 ? { upper: 10 * (b + 1) } : {}) })) })),
});
const timeSeries = (unit) => ({
  ...base, model: 'time-series', time: { unit },
  samples: [1, 2].flatMap((r) => [0, 2, 4].map((t) => ({ id: `r${r}t${t}`, columns: [`r${r}t${t}`] }))),
  replicates: [1, 2].map((r) => ({ id: `r${r}`, biological: r, timepoints: [0, 2, 4].map((t) => ({ sample: `r${r}t${t}`, time: t })) })),
});
const status = (r, id) => r.analyses.find((a) => a.id === id)?.status;

test('before there is anything to analyze: the counts, the target and the design, and no analysis', () => {
  const r = readiness(createWorkspace('empty', { now: '2026-10-10T00:00:00.000Z', id: 'e' }));
  assert.deepEqual(r.gaps.map((g) => g.id), ['counts', 'target', 'design']);
  assert.equal(r.analyses.length, 0);
  assert.match(readinessText(r), /^Needs the counts, the target sequence, the design/);
});

test('sorted bins: the gates unlock maximum likelihood, the cells improve it and assess the cells per variant', () => {
  const none = readiness(workspace(bins(false, false)));
  assert.equal(status(none, 'score.bin-mle'), 'unavailable');
  assert.deepEqual(none.analyses.find((a) => a.id === 'score.bin-mle').needs, ['gates']);
  assert.equal(status(none, 'qc.cells-per-bin'), 'unavailable');
  const gated = readiness(workspace(bins(true, false)));
  assert.equal(status(gated, 'score.bin-mle'), 'partial');
  assert.deepEqual(gated.gaps.find((g) => g.id === 'bin-cells').improves, ['score.bin-mle', 'qc.bin-occupancy']);
  const all = readiness(workspace(bins(true, true)));
  assert.equal(status(all, 'score.bin-mle'), 'ready');
  assert.equal(status(all, 'qc.cells-per-bin'), 'ready');
  assert.ok(!all.gaps.some((g) => g.id === 'gates' || g.id === 'bin-cells'));
});

test('a time series: per generation with times in generations; not for rounds of selection; three points for a regression', () => {
  assert.equal(status(readiness(workspace(timeSeries('generation'))), 'score.per-generation'), 'ready');
  const hours = readiness(workspace(timeSeries('hour')));
  assert.equal(status(hours, 'score.per-generation'), 'unavailable');
  assert.match(hours.analyses.find((a) => a.id === 'score.per-generation').note, /per hour now/);
  assert.equal(status(readiness(workspace(timeSeries('round'))), 'score.per-generation'), undefined);
  const two = timeSeries('generation');
  for (const r of two.replicates) r.timepoints = r.timepoints.filter((t) => t.time !== 2);
  two.ignoredColumns = two.samples.filter((s) => s.id.endsWith('t2')).map((s) => ({ column: s.columns[0], reason: 'gone' }));
  two.samples = two.samples.filter((s) => !s.id.endsWith('t2'));
  const short = readiness(workspace(two));
  assert.equal(status(short, 'score.regression'), 'unavailable');
  assert.equal(status(short, 'qc.time-fit'), 'unavailable');
  assert.equal(status(short, 'score.ratio-of-ends'), 'ready');
});

test('controls: without the wild type, scores relative to it and scales with it are not possible; another experiment\'s gaps are listed apart', () => {
  const r = readiness(workspace(timeSeries('generation'), { synonymous: 12, nonsense: 5, missense: 90 }));
  assert.equal(status(r, 'normalize.wild-type'), 'unavailable');
  assert.equal(status(r, 'rescale.nonsense-wt'), 'unavailable');
  assert.equal(status(r, 'normalize.synonymous'), 'ready');
  const text = readinessText(r);
  assert.ok(text.indexOf('What is missing:') < text.indexOf('- The wild type, counted'));
  assert.ok(text.indexOf('What another experiment would add:') < text.indexOf('- Two or more conditions'));
});

test('the methods name what was not recorded and what that meant, and nothing for a deposit alone', () => {
  const design = { ...timeSeries('hour'), readout: { phenotype: 'growth', direction: 'higher-more' }, library: { level: 'variant' } };
  const missing = notRecorded(readiness(workspace(design)));
  assert.deepEqual(missing, [
    'how the library was made (coverage was judged against every substitution)',
    'times in generations (scores could not be given per generation)',
  ]);
  const deposit = readiness(workspace({ ...design, time: { unit: 'generation' }, library: { level: 'variant', method: 'Oligo pool synthesis' } }));
  assert.deepEqual(notRecorded(deposit), []);
  assert.ok(deposit.gaps.some((g) => g.id === 'readout-terms'));
});
