import assert from 'node:assert/strict';
import test from 'node:test';
import { checkFilters, DEFAULT_FILTERS, describeFilters, filterFlow, kindCodes, REPLICATE_STATE, replicateState, STAGES, variantStage } from './filters.js';
import { buildVariants, KIND } from './variants.js';

test('a replicate\'s measurement: not counted, too few input reads, too few reads, or used', () => {
  const f = { ...DEFAULT_FILTERS, minInputCount: 5, minTotalCount: 20 };
  assert.equal(replicateState(0, 100, 200, f), REPLICATE_STATE.NOT_COUNTED);
  assert.equal(replicateState(1, 4, 200, f), REPLICATE_STATE.INPUT_COUNT);
  assert.equal(replicateState(1, 5, 19, f), REPLICATE_STATE.TOTAL_COUNT);
  assert.equal(replicateState(1, 5, 20, f), REPLICATE_STATE.USED);
});

test('variant stages in order: identifier, class, exclusion list (by key or as written)', () => {
  const v = buildVariants(['p.Ala2Val', 'hello', 'p.Ala2Ter', 'A2G'], { target: { sequenceType: 'protein', sequence: 'MAK' } });
  const kinds = kindCodes(['nonsense']);
  assert.ok(kinds.has(KIND.NONSENSE));
  const excluded = new Set(['A2G']);
  assert.deepEqual([0, 1, 2, 3].map((i) => variantStage(i, v, kinds, excluded)), [0, 2, 3, 4]);
});

test('the flow counts each stage\'s removals and what remains', () => {
  const flow = filterFlow([0, 1, 5, 5, 0, 8]);
  assert.equal(flow.length, STAGES.length - 1, 'the barcode stage only for a barcode table');
  assert.deepEqual(flow.filter((x) => x.removed).map((x) => [x.stage, x.removed, x.remaining]), [['measured', 1, 5], ['input-count', 2, 3], ['se', 1, 2]]);
  const barcodes = filterFlow([0, 9, 5, 7], true);
  assert.deepEqual(barcodes.map((x) => x.stage).slice(4, 8), ['input-count', 'total-count', 'barcodes', 'replicates']);
  assert.deepEqual(barcodes.filter((x) => x.removed).map((x) => [x.stage, x.removed, x.remaining]), [['input-count', 1, 3], ['barcodes', 1, 2], ['replicates', 1, 1]]);
});

test('filter parameters are checked and described', () => {
  assert.deepEqual(checkFilters(DEFAULT_FILTERS), []);
  assert.equal(checkFilters({ minInputCount: -1, minReplicates: 0, maxSE: 0, excludeKinds: ['purple'] }).length, 4);
  assert.deepEqual(checkFilters({ minReplicates: 'all' }), []);
  assert.equal(checkFilters({ minBarcodes: 0, maxBarcodeZ: 1 }).length, 2);
  assert.equal(describeFilters({}).find((x) => x.stage === 'barcodes'), undefined);
  assert.match(describeFilters({ minBarcodes: 2, maxBarcodeZ: 4 }, null, false, true).find((x) => x.stage === 'barcodes').text, /≥ 2 per replicate; barcodes departing by more than 4/);
  assert.match(describeFilters({ minReplicates: 'all' }, 3).find((x) => x.stage === 'replicates').text, /all of the variant's \(3\)/);
});
