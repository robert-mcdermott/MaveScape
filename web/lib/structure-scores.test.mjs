import assert from 'node:assert/strict';
import test from 'node:test';
import { calibrationClasses, cellsAtPositions, coloringCSV, coloringLegend, coloringPalette, describeColoring, placeOnTarget, POSITION, positionColor, positionRanges, positionsOfKeys, positionValues, residueColors, STATE_COLORS, substitutionCode, thresholdClasses } from './structure-scores.js';
import { buildMapModel, cellAt, cellName, STATE } from './map-model.js';
import { evaluateQuery, parseQuery, queryContext } from './query.js';
import { hexToRgb } from './colormaps.js';
import { scoreExperiment, DEFAULT_PARAMETERS } from './score.js';

const ROWS = 'HKRDECMNQSTAILVFWYGP*';

// A map model of a protein, its cells given as { 'position:alt': [state, score, se] }; every other
// cell missing (not designed at positions in `undesigned`).
function toyModel(protein, cells, { undesigned = [], center = 0, contrast = null } = {}) {
  const R = ROWS.length;
  const L = protein.length;
  const state = new Uint8Array(L * R);
  const reference = new Uint8Array(L * R);
  const index = new Int32Array(L * R).fill(-1);
  const score = [];
  const se = [];
  for (let p = 1; p <= L; p += 1) {
    for (let r = 0; r < R; r += 1) {
      const k = (p - 1) * R + r;
      if (ROWS[r] === protein[p - 1]) reference[k] = 1;
      const given = cells[`${p}:${ROWS[r]}`];
      if (undesigned.includes(p)) state[k] = STATE.NOT_DESIGNED;
      else if (given) {
        state[k] = given[0];
        index[k] = score.length;
        score.push(given[1]);
        se.push(given[2] ?? 0.1);
      } else state[k] = reference[k] ? STATE.REFERENCE : STATE.MISSING;
    }
  }
  return {
    target: { id: 't', name: 'Toy', offset: 100 }, protein, length: L, rows: ROWS, state, reference, cells: index,
    source: { score: Float64Array.from(score), se: Float64Array.from(se) },
    domain: { kind: 'diverging', center, min: center - 4, max: center + 4 }, scoreCenter: center,
    condition: { id: 'c', name: 'Selection' }, contrast, scale: { low: 'less function', high: 'more function', stated: true },
  };
}

const S = STATE.SCORED;
const LOW = STATE.LOW;
const F = STATE.FILTERED;
// MKTAYG: position 2 (K) has three missense scored, a stop and a synonymous; 3 (T) only filtered;
// 4 (A) nothing measured; 5 (Y) two of low confidence only; 6 not designed.
const cells = {
  '2:A': [S, -2], '2:D': [S, -1], '2:E': [S, 0.5, 0.3], '2:*': [S, -6], '2:K': [S, 0.1],
  '3:A': [F, Number.NaN], '3:G': [F, Number.NaN],
  '5:A': [LOW, -3], '5:H': [LOW, -1],
};
const model = toyModel('MKTAYG', cells, { undesigned: [6] });

test('a position\'s summaries are of its missense substitutions scored: the stop and the synonymous left out', () => {
  const at = (how, p) => positionValues(model, how).value[p - 1];
  assert.equal(at('median', 2), -1);
  assert.ok(Math.abs(at('mean', 2) - (-2.5 / 3)) < 1e-12);
  assert.equal(at('minimum', 2), -2);
  assert.equal(at('maximum', 2), 0.5);
  assert.equal(at('count', 2), 3);
  assert.equal(at('uncertainty', 2), 0.1);
  const v = positionValues(model, 'median');
  assert.deepEqual([...v.state], [POSITION.MISSING, POSITION.VALUE, POSITION.FILTERED, POSITION.MISSING, POSITION.LOW, POSITION.NOT_DESIGNED]);
  assert.deepEqual([v.scored[1], v.designed[1]], [3, 19]);
  assert.equal(v.domain, model.domain, 'the map\'s scale: a residue\'s color is the score a cell of that color has');
});

test('the map\'s grammar: missing and filtered drawn gray, never in the wild type\'s color; low confidence paler', () => {
  const v = positionValues(model, 'median');
  for (const name of ['rdbu', 'puor']) {
    const pal = coloringPalette(v, name);
    const wild = hexToRgb(pal.color(0.5));
    for (const p of [3, 4]) {
      const color = positionColor(v, p, pal);
      assert.equal(color, p === 3 ? STATE_COLORS.filtered : STATE_COLORS.missing);
      const distance = Math.hypot(...hexToRgb(color).map((c, i) => c - wild[i]));
      assert.ok(distance > 100, `${name}: position ${p} is ${color}, the wild type ${pal.color(0.5)}`);
    }
    assert.equal(positionColor(v, 5, pal), pal.paler(0.5 + (-2 - 0) / 8), 'a value from low-confidence scores alone is drawn paler');
    assert.equal(positionColor(v, 6, pal), STATE_COLORS.context);
  }
  const qc = positionValues(model, 'qc');
  assert.equal(qc.category[1], 3, 'position 2: 3 of 19 scored, fewer than half');
  assert.equal(qc.state[4], POSITION.VALUE, 'the QC state of a position of low confidence is a value');
});

test('one substitution: named by one letter or three, a stop; the residue itself is the wild type', () => {
  assert.deepEqual(['a', 'Ala', 'TER', '*', 'stop', 'Xyz', 'AB'].map(substitutionCode), ['A', 'A', '*', '*', '*', null, null]);
  const v = positionValues(model, 'substitution', { substitution: 'Ala' });
  assert.deepEqual([...v.state], [POSITION.MISSING, POSITION.VALUE, POSITION.FILTERED, POSITION.REFERENCE, POSITION.LOW, POSITION.NOT_DESIGNED]);
  assert.equal(v.value[1], -2);
  assert.equal(positionColor(v, 4, coloringPalette(v)), coloringPalette(v).color(0.5));
  assert.equal(positionValues(model, 'substitution', { substitution: '*' }).value[1], -6);
  assert.throws(() => positionValues(model, 'substitution', { substitution: 'B' }), /amino acid/);
});

test('fraction abnormal-like: by a threshold set by hand, or a calibration\'s abnormal classes as published', () => {
  assert.throws(() => positionValues(model, 'fraction'), /threshold/);
  assert.throws(() => positionValues({ ...model, contrast: { name: 'B vs A' } }, 'fraction', { abnormal: thresholdClasses(0) }), /contrast/);
  assert.ok(Math.abs(positionValues(model, 'fraction', { abnormal: thresholdClasses(-0.5, 'below') }).value[1] - 2 / 3) < 1e-12);
  assert.ok(Math.abs(positionValues(model, 'fraction', { abnormal: thresholdClasses(0, 'above') }).value[1] - 1 / 3) < 1e-12);
  const calibration = { title: 'Investigators', classes: [
    { class: 'abnormal', range: [null, -1], inclusive: [false, false] },
    { class: 'normal', range: [-1, null], inclusive: [true, false] },
  ] };
  const classes = calibrationClasses(calibration);
  assert.deepEqual([-3, -1, -0.99].map(classes.test), [true, false, false], 'the upper bound excluded, as published');
  assert.match(classes.words, /"Investigators" \(−∞ to -1\), as published/);
  assert.equal(positionValues(model, 'fraction', { abnormal: classes }).value[1], 1 / 3);
  assert.throws(() => calibrationClasses({ title: 'None', classes: [{ class: 'normal', range: [0, 1] }] }), /no abnormal class/);
});

test('placed on another target by reference numbering, where the residues agree; another protein refused', () => {
  const v = positionValues(model, 'median');
  // The mapped target begins three residues earlier (offset 97): MKTAYG at its positions 4–9.
  const mapped = { name: 'Longer', sequence: 'GSHMKTAYGW', offset: 97, length: 10 };
  const placed = placeOnTarget(v, mapped);
  assert.equal(placed.length, 10);
  assert.equal(placed.value[4], -1, 'position 2 is the mapped target\'s 5');
  assert.equal(placed.state[0], POSITION.NOT_DESIGNED, 'a position the scores do not cover');
  assert.deepEqual([...placed.from], [0, 0, 0, 1, 2, 3, 4, 5, 6, 0]);
  assert.equal(placeOnTarget(v, { name: 'Other', sequence: 'MWWWWG', offset: 100, length: 6 }), null);
});

test('residue colors on every chain that holds the target, the legend, the words and the file', () => {
  const v = positionValues(model, 'median');
  const pal = coloringPalette(v);
  const positions = [...'MKTAYG'].map((code, i) => ({ position: i + 1, reference: i + 101, code, state: i === 0 ? 'unobserved' : 'identical', residue: i === 0 ? null : `A:${i + 1}:${['MET', 'LYS', 'THR', 'ALA', 'TYR', 'GLY'][i]}` }));
  const mapping = { chain: 'A', target: { name: 'Toy', length: 6, offset: 100 }, positions, residuePosition: new Map(positions.filter((p) => p.residue).map((p) => [p.residue, p.position])) };
  const other = { ...mapping, chain: 'B', positions: positions.map((p) => ({ ...p, residue: p.residue?.replace(/^A/, 'B') ?? null })) };
  const colors = residueColors(v, [mapping, other], pal);
  assert.equal(colors.size, 10);
  assert.deepEqual(colors.get('B:3:THR'), hexToRgb(STATE_COLORS.filtered).map((c) => c / 255));
  const legend = coloringLegend(v, mapping, pal, 'Run 1');
  assert.equal(legend.title, 'Median score, Run 1');
  assert.deepEqual(legend.items.map((i) => [i.label, i.count]), [['low confidence only', 1], ['filtered', 1], ['missing', 1], ['not designed, or not the target', null]]);
  assert.equal(legend.gradient.meaning, 'blue is less function, red more function');
  const words = describeColoring(v, mapping, '1ABC', 'Run 1').join(' ');
  assert.match(words, /Of the 5 target positions on 1ABC chain A, 2 have a value, 1 from scores of low confidence only, drawn paler, 1 filtered, 1 missing, 1 not designed\. Filtered and missing positions are drawn gray, never in the wild type's color\./);
  const rows = coloringCSV(v, mapping, '1ABC', pal).trim().split('\n');
  assert.equal(rows[0], 'target_position,reference_position,target_residue,structure,chain,residue_number,insertion_code,structure_residue,coloring,value,state,substitutions_scored,substitutions_designed,color');
  assert.equal(rows[1], '1,101,Met,1ABC,A,,,,median,NA,missing,0,19,');
  assert.equal(rows[2], `2,102,Lys,1ABC,A,2,,Lys,median,-1,scored,3,19,${pal.color(0.5 - 1 / 8)}`);
  assert.equal(rows[3].split(',').slice(9, 11).join(','), 'NA,filtered');
});

// The toy of map-model.test.mjs, scored: MSKG, offset 100.
const target = { id: 't', name: 'Toy', sequenceType: 'protein', sequence: 'MSKG', offset: 100 };
const design = {
  format: 'mavescape-design', version: 1, name: 'toy', model: 'two-population',
  variants: { column: 'v', level: 'protein' }, targets: [target], library: { level: 'variant' },
  samples: ['in1', 'out1', 'in2', 'out2'].map((id) => ({ id, name: id, columns: [id] })),
  replicates: [{ id: 'r1', biological: 1, input: 'in1', output: 'out1' }, { id: 'r2', biological: 2, input: 'in2', output: 'out2' }],
  controls: { wildType: 'auto', synonymous: 'auto', nonsense: 'auto' },
};
const names = ['p.=', 'p.Ser2Ala', 'p.Ser2Ter', 'p.Lys3Arg', 'p.Lys3=', 'p.Gly4Asp'];
const col = (...x) => Float64Array.from(x);
const columns = { in1: col(1000, 50, 40, 3, 60, Number.NaN), out1: col(1000, 30, 0, 9, 55, Number.NaN), in2: col(900, 45, 35, 2, 50, Number.NaN), out2: col(950, 25, 0, 8, 52, Number.NaN) };
const results = scoreExperiment({ names, columns, design, parameters: { ...DEFAULT_PARAMETERS, filters: { ...DEFAULT_PARAMETERS.filters, minInputCount: 5 } } }).results;

test('a structure\'s selection sent to the map is what "at" selects there, and comes back as its positions', () => {
  const m = buildMapModel(results, design);
  const keys = cellsAtPositions(m, [2, 3], cellName, cellAt);
  const query = evaluateQuery(parseQuery(`at ${positionRanges([3, 2])}`), queryContext({ model: m, results, design }));
  assert.deepEqual([...keys].sort(), [...query.keys].sort());
  assert.equal(keys.length, 42);
  assert.deepEqual(positionsOfKeys(keys), [2, 3]);
  assert.deepEqual(positionsOfKeys(['p.Lys3=', 'p.Ser2Ter', 'c.4A>G']), [2, 3]);
  assert.equal(positionRanges([5, 1, 2, 3, 9, 10]), '1-3,5,9-10');
  // The real model's states read as positions: Ser2 scored (Ala), Lys3 filtered (Arg), Gly4 missing.
  const v = positionValues(m, 'median');
  assert.deepEqual([...v.state], [POSITION.MISSING, POSITION.VALUE, POSITION.FILTERED, POSITION.MISSING]);
});
