import assert from 'node:assert/strict';
import test from 'node:test';
import { replicateSamples, sharedSamples, summarizeDesign, targetLength, validateDesign } from './design.js';

// A small two-population design: 2 replicates, input and output each.
function twoPopulation(overrides = {}) {
  return {
    format: 'mavescape-design',
    version: 1,
    model: 'two-population',
    variants: { column: 'hgvs_pro', level: 'protein' },
    targets: [{ id: 't', name: 'Toy', sequenceType: 'protein', sequence: 'MSKGEELFTG', offset: 10, identifiers: { uniprot: 'P00000' } }],
    samples: [
      { id: 'in1', columns: ['in_1'] }, { id: 'out1', columns: ['out_1'] },
      { id: 'in2', columns: ['in_2a', 'in_2b'] }, { id: 'out2', columns: ['out_2'] },
    ],
    replicates: [
      { id: 'r1', biological: 1, input: 'in1', output: 'out1' },
      { id: 'r2', biological: 2, input: 'in2', output: 'out2' },
    ],
    ...overrides,
  };
}
const columns = ['hgvs_pro', 'in_1', 'out_1', 'in_2a', 'in_2b', 'out_2'];
const messages = (result) => result.errors.map((e) => e.message).join(' | ');

test('a complete two-population design validates against its table', () => {
  const result = validateDesign(twoPopulation(), { columns });
  assert.equal(result.ok, true, messages(result));
  assert.deepEqual(result.warnings, []);
});

test('every column of the table is a sample\'s, an identifier or ignored with a reason', () => {
  const result = validateDesign(twoPopulation(), { columns: [...columns, 'notes', 'accession'] });
  assert.equal(result.ok, false);
  assert.match(messages(result), /1 column is neither a sample's nor ignored with a reason: "notes"/);
  const ignored = validateDesign(twoPopulation({ ignoredColumns: [{ column: 'notes', reason: 'free text' }] }), { columns: [...columns, 'notes', 'accession'] });
  assert.equal(ignored.ok, true, messages(ignored));
});

test('missing columns, unknown samples and reused columns are errors that name them', () => {
  const design = twoPopulation();
  design.samples[1].columns = ['out_1', 'in_1'];
  design.replicates[1].output = 'out9';
  const result = validateDesign(design, { columns });
  assert.match(messages(result), /Column "in_1" belongs to both "in1" and "out1"/);
  assert.match(messages(result), /uses sample "out9", which is not defined/);
  assert.match(validateDesign(twoPopulation(), { columns: ['hgvs_pro', 'in_1'] }).errors[0].message, /no column "out_1"/);
});

test('technical replicates are columns of one sample; two replicates cannot both be biological replicate 1', () => {
  const design = twoPopulation();
  design.replicates[1].biological = 1;
  assert.match(messages(validateDesign(design)), /both biological replicate 1\. Technical replicates are columns of one sample/);
  assert.match(summarizeDesign(twoPopulation()).lines.join('\n'), /1 sample has technical replicates \(several columns\), summed before scoring/);
});

test('each model checks its own replicates', () => {
  const noOutput = twoPopulation();
  delete noOutput.replicates[0].output;
  assert.match(messages(validateDesign(noOutput)), /needs an input and an output/);

  const series = {
    ...twoPopulation(), model: 'time-series', time: { unit: 'generation' },
    samples: [{ id: 'a', columns: ['a'] }, { id: 'b', columns: ['b'] }, { id: 'c', columns: ['c'] }],
    replicates: [{ id: 'r1', biological: 1, timepoints: [{ sample: 'a', time: 0 }, { sample: 'b', time: 2 }, { sample: 'c', time: 2 }] }],
  };
  assert.match(messages(validateDesign(series)), /two samples at the same time/);
  series.replicates[0].timepoints[2].time = 5;
  assert.equal(validateDesign(series).ok, true, messages(validateDesign(series)));
  series.replicates[0].timepoints = series.replicates[0].timepoints.slice(1);
  const late = validateDesign(series);
  assert.ok(late.warnings.some((w) => /no time 0/.test(w.message)));
  assert.ok(late.warnings.some((w) => /a regression needs three or more/.test(w.message)));
  delete series.time;
  assert.match(messages(validateDesign(series)), /unit of the times/);

  const bins = {
    ...twoPopulation(), model: 'bins', bins: { weight: 'rank' },
    samples: [{ id: 'b1', columns: ['b1'] }, { id: 'b2', columns: ['b2'] }, { id: 'b3', columns: ['b3'] }],
    replicates: [{ id: 'r1', biological: 1, bins: [{ sample: 'b1', order: 1, value: 0.5 }, { sample: 'b2', order: 2, value: 0.25 }, { sample: 'b3', order: 3, value: 1 }] }],
  };
  const swapped = validateDesign(bins);
  assert.equal(swapped.ok, true);
  assert.ok(swapped.warnings.some((w) => /bin 2's value is not above bin 1's/.test(w.message)));
  bins.replicates[0].input = 'b1';
  assert.match(messages(validateDesign(bins)), /lists its bins, not an input and output/);
});

test('samples shared between replicates are found and said', () => {
  const design = twoPopulation();
  design.samples = design.samples.filter((s) => s.id !== 'in2');
  design.replicates[1].input = 'in1';
  assert.deepEqual([...sharedSamples(design)], [['in1', ['r1', 'r2']]]);
  assert.match(summarizeDesign(design).lines.join('\n'), /1 sample is shared between replicates \(2 each\): replicates that share an input are not independent there/);
  assert.deepEqual(replicateSamples(design.replicates[0]).map((s) => s.role), ['input', 'output']);
});

test('a copy of a column must copy a column a sample uses', () => {
  const design = twoPopulation({ ignoredColumns: [{ column: 'in_1_again', reason: 'repeats the shared input', copyOf: 'nowhere' }] });
  assert.match(messages(validateDesign(design)), /is a copy of "nowhere", which no sample uses/);
  design.ignoredColumns[0].copyOf = 'in_1';
  assert.equal(validateDesign(design).ok, true);
});

test('tiles and conditions are named by the replicates that use them; gaps between tiles are warned', () => {
  const design = twoPopulation({
    library: { level: 'variant', tiles: [{ id: 'a', start: 1, end: 4 }, { id: 'b', start: 7, end: 10 }] },
    conditions: [{ id: 'drug', name: 'Drug' }, { id: 'none', name: 'No drug', reference: true }],
  });
  const result = validateDesign(design);
  assert.match(messages(result), /must name its tile \(a, b\)/);
  assert.match(messages(result), /must name one of the conditions \(drug, none\)/);
  design.replicates.forEach((r, i) => Object.assign(r, { tile: i ? 'b' : 'a', condition: 'drug' }));
  const fixed = validateDesign(design);
  assert.equal(fixed.ok, true, messages(fixed));
  assert.ok(fixed.warnings.some((w) => /Positions 5–6 are in no tile/.test(w.message)));
  design.library.tiles[1].end = 12;
  assert.match(messages(validateDesign(design)), /beyond the target \(10 positions\)/);
});

test('targets are checked for their alphabet and reading frame', () => {
  const dna = { id: 'd', name: 'DNA', sequenceType: 'dna', sequence: 'ATGGCCAAGTA' };
  const result = validateDesign(twoPopulation({ targets: [dna] }));
  assert.ok(result.warnings.some((w) => /not a whole number of codons \(11 bases\)/.test(w.message)));
  assert.equal(targetLength(dna, 'protein'), 3);
  assert.equal(targetLength(dna, 'nucleotide'), 11);
  assert.match(messages(validateDesign(twoPopulation({ targets: [{ ...dna, sequence: 'ATGNNN' }] }))), /only A, C, G and T/);
  assert.match(messages(validateDesign(twoPopulation({ targets: [{ id: 'p', name: 'P', sequenceType: 'protein', sequence: 'MSXK' }] }))), /only the 20 amino acids/);
  const nucleotideNamesOnProtein = twoPopulation({ variants: { column: 'hgvs_nt', level: 'nucleotide' } });
  assert.match(messages(validateDesign(nucleotideNamesOnProtein)), /need a DNA target/);
});

test('other documents are refused plainly', () => {
  assert.equal(validateDesign(null).ok, false);
  const wrong = validateDesign({ format: 'cytoweave-workspace', version: 2, model: 'gating' });
  assert.match(messages(wrong), /format must be "mavescape-design"/);
  assert.match(messages(wrong), /reads design version 1, not 2/);
  assert.match(messages(wrong), /model must be one of two-population, time-series, bins, scores/);
});

test('a score-only design names its score columns', () => {
  const design = { ...twoPopulation(), model: 'scores', samples: [], replicates: [], scores: { score: 'score', se: 'SE' } };
  assert.equal(validateDesign(design, { columns: ['hgvs_pro', 'score', 'SE'] }).ok, true);
  assert.match(messages(validateDesign(design, { columns: ['hgvs_pro', 'score'] })), /no column "SE"/);
  assert.match(summarizeDesign(design).lines.join('\n'), /Precomputed scores: column "score" with standard errors in "SE"/);
});

test('the summary describes the design in plain language', () => {
  const { lines, counts } = summarizeDesign(twoPopulation());
  assert.equal(lines[0], 'Target Toy (10 aa; UniProt P00000, positions 11–20).');
  assert.equal(lines[1], 'Two-population selection: 2 replicates (2 biological replicates), each an input and an output.');
  assert.deepEqual(counts, { targets: 1, samples: 4, replicates: 2, conditions: 0, tiles: 0, sharedSamples: 0, ignoredColumns: 0 });
});

test('controls serve at positions within the target, with reasons; the readout is checked and summarized', () => {
  const ok = validateDesign(twoPopulation({ controls: { nonsense: 'auto', positions: { nonsense: { start: 1, end: 8 } }, why: { nonsense: 'Stops before the last two residues lose it.' } }, readout: { phenotype: 'Abundance', direction: 'higher-less' }, library: { level: 'variant', method: 'Error-prone PCR' } }), { columns });
  assert.equal(ok.ok, true, messages(ok));
  const bad = validateDesign(twoPopulation({ controls: { positions: { nonsense: { start: 9, end: 4 }, missense: {} }, why: { stops: 'x' } }, readout: { direction: 'sideways' } }), { columns });
  assert.deepEqual(bad.errors.map((e) => e.path).sort(), ['controls.positions.missense', 'controls.positions.nonsense', 'controls.why.stops', 'readout.direction']);
  assert.match(messages(validateDesign(twoPopulation({ controls: { positions: { nonsense: { end: 11 } } } }), { columns })), /within the target \(1–10\)/);
  const lines = summarizeDesign(twoPopulation({ controls: { nonsense: 'auto', positions: { nonsense: { end: 8 } }, why: { nonsense: 'Late stops keep the function' } }, readout: { direction: 'higher-more' }, library: { method: 'Error-prone PCR' } })).lines;
  assert.ok(lines.includes('The library was made by error-prone PCR.'));
  assert.ok(lines.includes('Readout: a higher score means more of the function measured.'));
  assert.ok(lines.some((l) => /nonsense found automatically up to position 8/.test(l)));
  assert.ok(lines.includes('  Nonsense controls: Late stops keep the function.'));
});
