import assert from 'node:assert/strict';
import test from 'node:test';
import { adviceFor, CAUSE_KINDS, NEXT_KINDS } from './advice.js';
import { THRESHOLDS } from './findings.js';

const context = (over = {}) => ({ readout: { stated: false }, controls: {}, libraryMethod: null, tiles: 0, cellsRecorded: false, ...over });
const IDS = ['missing-sample', 'depth', 'low-count', 'missingness', 'dropout', 'coverage', 'agreement', 'excess-variance', 'outlier-replicate', 'separation', 'resolution', 'scored-fraction', 'time-points', 'time-fit', 'bin-occupancy', 'cells-per-bin', 'barcode-map', 'barcodes-per-variant', 'barcode-agreement', 'outlier-barcodes'];

test('every finding to review or failing says what could cause it and what to do, in known kinds', () => {
  assert.ok(THRESHOLDS.length);
  for (const id of IDS) {
    for (const status of ['review', 'fail']) {
      const a = adviceFor({ id, status }, { context: context(), scores: [] });
      assert.ok(a.causes.length && a.next.length, id);
      for (const c of a.causes) assert.ok(c.kind in CAUSE_KINDS && c.text.endsWith('.'), `${id}: ${c.text}`);
      for (const x of a.next) assert.ok(x.kind in NEXT_KINDS && x.text.endsWith('.'), `${id}: ${x.text}`);
    }
  }
  assert.deepEqual(adviceFor({ id: 'depth', status: 'pass' }, { context: context() }), { causes: [], next: [] });
});

test('the causes read the context: the library\'s method, the direction, where stops stop losing the function', () => {
  const coverage = adviceFor({ id: 'coverage', status: 'fail' }, { context: context({ libraryMethod: 'Error-prone PCR' }), coverage: { reach: { known: true } } });
  assert.equal(coverage.causes[0].kind, 'expected');
  assert.ok(!coverage.next.some((x) => /Say how the library was made/.test(x.text)));
  assert.ok(adviceFor({ id: 'coverage', status: 'fail' }, { context: context() }).next.some((x) => /Say how the library was made/.test(x.text)));
  const reversed = adviceFor({ id: 'separation', status: 'fail' }, { context: context(), scores: [{ separation: { reversed: true, change: null } }] });
  assert.equal(reversed.causes[0].kind, 'model');
  assert.ok(reversed.next.some((x) => /State the readout's direction/.test(x.text)));
  const late = (end) => adviceFor({ id: 'separation', status: 'fail' }, { context: context({ controls: { positions: end ? { nonsense: { end } } : undefined } }), scores: [{ separation: { reversed: false, change: { lastControl: 93 } } }] });
  assert.ok(late().next.some((x) => x.text.startsWith('Limit the nonsense controls to positions up to 93')));
  assert.ok(!late(93).next.some((x) => /Limit the nonsense controls/.test(x.text)), 'already limited');
});

test('a finding not assessed says what it needs', () => {
  assert.equal(adviceFor({ id: 'cells-per-bin', status: 'na' }, { context: context() }).next[0].kind, 'analysis');
  assert.deepEqual(adviceFor({ id: 'depth', status: 'na' }, { context: context() }), { causes: [], next: [] });
  assert.match(adviceFor({ id: 'separation', status: 'na', level: 'scores', value: 'not assessed: no score run (score the counts to see it)' }, { context: context() }).next[0].text, /^Score the counts/);
});
