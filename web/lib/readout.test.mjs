import assert from 'node:assert/strict';
import test from 'node:test';
import { ASSAY_METHODS, checkReadout, describeReadout, inText, lossSide, readoutOf, scaleWords } from './readout.js';

const check = (design) => {
  const errors = [];
  const warnings = [];
  checkReadout(design, (path, message) => errors.push({ path, message }), (path, message) => warnings.push({ path, message }));
  return { errors, warnings };
};

test('an unstated direction is assumed, and said to be', () => {
  assert.deepEqual(readoutOf({}), { phenotype: null, method: null, mechanism: null, modelSystem: null, direction: 'higher-more', stated: false });
  assert.deepEqual(scaleWords({}), { low: 'lower', high: 'higher', stated: false });
  assert.deepEqual(lossSide({}), { side: 'below', stated: false });
  assert.match(describeReadout({}), /not stated, so a higher score is taken to mean more of the function/);
});

test('the direction sets the scale\'s words and where loss of function scores', () => {
  assert.deepEqual(scaleWords({ readout: { direction: 'higher-more' } }), { low: 'less function', high: 'more function', stated: true });
  assert.deepEqual(scaleWords({ readout: { direction: 'higher-less' } }), { low: 'more function', high: 'less function', stated: true });
  assert.deepEqual(lossSide({ readout: { direction: 'higher-less' } }), { side: 'above', stated: true });
  assert.deepEqual(lossSide({ readout: { direction: 'unsigned' } }), { side: 'either', stated: true });
});

test('the readout in a sentence, with MaveDB\'s terms in running text', () => {
  const design = { readout: { phenotype: 'Cellular abundance.', method: 'Reporter', mechanism: 'Loss of function', modelSystem: 'Yeast', direction: 'higher-more' } };
  assert.equal(describeReadout(design), 'Readout: Cellular abundance. Assay: Reporter, in yeast, detecting loss of function. A higher score means more of the function measured.');
  assert.equal(describeReadout({ readout: { phenotype: 'Toxicity' } }), 'Readout: Toxicity. Its direction is not stated, so a higher score is taken to mean more of the function measured.');
  assert.equal(inText('Error-prone PCR'), 'error-prone PCR');
  assert.equal(inText('SELEX'), 'SELEX');
});

test('the readout and the library\'s method are checked; terms outside MaveDB\'s lists are kept, with a warning', () => {
  assert.deepEqual(check({ readout: { method: ASSAY_METHODS[0], direction: 'higher-less' } }), { errors: [], warnings: [] });
  const bad = check({ readout: { direction: 'up', colour: 'red', phenotype: 3 } });
  assert.deepEqual(bad.errors.map((e) => e.path).sort(), ['readout.colour', 'readout.direction', 'readout.phenotype']);
  const odd = check({ readout: { method: 'Phage display' }, library: { method: 'Gibson assembly' } });
  assert.deepEqual(odd.warnings.map((w) => w.path), ['readout.method', 'library.method']);
  assert.deepEqual(check({ library: { method: '' } }).errors.map((e) => e.path), ['library.method']);
});
