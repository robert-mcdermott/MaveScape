// Inputs and expectations for the validation suite `scoring` (wave 1, slice 5): the scoring
// engine (web/lib/score.js) run as the Score view runs it, on tables read by web/lib/csv.js.

import { readFileSync } from 'node:fs';
import { columnText, parseTable } from '../web/lib/csv.js';
import { scoreExperiment } from '../web/lib/score.js';
import { REPLICATE_STATE, FLAG, STAGE_BY_ID } from '../web/lib/filters.js';

export const fixtureTable = () => parseTable(new Uint8Array(readFileSync(new URL('./fixtures/two-population.csv', import.meta.url))));
export const fixtureDesign = () => JSON.parse(readFileSync(new URL('./fixtures/two-population.design.json', import.meta.url), 'utf8'));

// The engine's input from a parsed table: variant names, the design's count columns, and a
// barcode table's barcodes.
export function engineInput(table, design) {
  const byName = new Map(table.columns.map((c) => [c.name, c]));
  const columns = {};
  for (const sample of design.samples) for (const name of sample.columns) columns[name] = byName.get(name).numeric.slice();
  const barcodes = design.library?.level === 'barcode' ? columnText(byName.get(design.library.barcodeColumn)) : null;
  return { names: columnText(byName.get(design.variants.column)), barcodes, columns, design };
}

export function score(table, design, parameters, extra = {}) {
  const out = scoreExperiment({ ...engineInput(table, design), parameters, ...extra });
  if (!out.ok) throw new Error(`refused: ${out.errors.join(' ')}`);
  return out.results;
}

const R = REPLICATE_STATE;
// The PRD's two-population edge cases as planted in the fixture (make-two-population.mjs), and
// what MaveScape does with each under its default parameters: [variant, what, the replicates'
// states, replicates used, the stage that leaves it out (or null), flags].
export const EDGE_EXPECTATIONS = [
  ['p.Lys3Arg', 'zero in both samples (replicate 1)', [R.INPUT_COUNT, R.USED, R.USED], 2, null, FLAG.FEWER_REPLICATES],
  ['p.Gly4Asp', 'zero only in the input (replicate 1)', [R.INPUT_COUNT, R.USED, R.USED], 2, null, FLAG.FEWER_REPLICATES],
  ['p.Glu5Ter', 'zero only in the output (every replicate)', [R.USED, R.USED, R.USED], 3, null, FLAG.OUTPUT_ZERO],
  ['p.Glu6Lys', 'missing replicate measurement (no output count in replicate 2)', [R.USED, R.NOT_COUNTED, R.USED], 2, null, FLAG.FEWER_REPLICATES],
  ['p.Leu7Pro', 'absent from one replicate (replicate 3)', [R.USED, R.USED, R.NOT_COUNTED], 2, null, FLAG.FEWER_REPLICATES],
  ['p.Phe8Ser', 'very low depth (2 and 1 reads)', [R.USED, R.USED, R.USED], 3, null, 0],
  ['p.Gly10Ala', 'not counted anywhere', [R.NOT_COUNTED, R.NOT_COUNTED, R.NOT_COUNTED], 0, STAGE_BY_ID.get('measured').code, 0],
];

// The fixture's table with some rows dropped, or its counts divided (very low depth).
export function variantTable(table, { drop = [], divide = 1 } = {}) {
  const names = table.columns[0].values;
  const keep = names.map((n, i) => (drop.includes(n) ? -1 : i)).filter((i) => i >= 0);
  return {
    ...table,
    rows: keep.length,
    lineOfRow: null,
    columns: table.columns.map((c) => ({
      ...c,
      values: c.values ? keep.map((i) => c.values[i]) : null,
      numeric: c.numeric ? Float64Array.from(keep, (i) => (divide === 1 ? c.numeric[i] : Math.floor(c.numeric[i] / divide))) : null,
    })),
  };
}

// The rows of a table in another order, and its columns too.
export function shuffledTable(table, random) {
  const order = [...Array(table.rows).keys()];
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = random.int(i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  const columns = table.columns.map((c) => ({ ...c, values: c.values ? order.map((i) => c.values[i]) : null, numeric: c.numeric ? Float64Array.from(order, (i) => c.numeric[i]) : null }));
  for (let i = columns.length - 1; i > 0; i -= 1) {
    const j = random.int(i + 1);
    [columns[i], columns[j]] = [columns[j], columns[i]];
  }
  return { ...table, columns, lineOfRow: null };
}

// Each variant's combined score and SE (by key) and replicate scores, as text with every bit.
export function byKey(results) {
  const out = new Map();
  const c = results.conditions[0];
  results.variants.key.forEach((key, i) => {
    out.set(key || results.variants.original[i], [c.score[i], c.se[i], c.reason[i], ...results.replicates.map((r) => `${r.id}:${r.score[i]}:${r.se[i]}:${r.state[i]}`)].join('|'));
  });
  return out;
}
