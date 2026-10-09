// Inputs and expectations for the time-series checks of the suite `scoring` (wave 2, slice 2):
// the synthetic fixture (fixtures/make-time-series.mjs), its true effects, and its edge cases.

import { readFileSync } from 'node:fs';
import { parseTable } from '../web/lib/csv.js';
import { FLAG, REPLICATE_STATE } from '../web/lib/filters.js';

export const timeSeriesTable = () => parseTable(new Uint8Array(readFileSync(new URL('./fixtures/time-series.csv', import.meta.url))));
export const timeSeriesDesign = () => JSON.parse(readFileSync(new URL('./fixtures/time-series.design.json', import.meta.url), 'utf8'));

// The true slopes on time scaled to 0–1: ten generations of each variant's effect per generation.
export function timeSeriesTruth() {
  const lines = readFileSync(new URL('./fixtures/time-series.truth.csv', import.meta.url), 'utf8').trim().split('\n').slice(1);
  return new Map(lines.map((line) => {
    const [name, effect] = line.split(',');
    return [name, 10 * Number(effect)];
  }));
}

// The planted variants, by what was planted (their names are in the design's description, in
// this order).
export function edgeVariants(design) {
  const names = [...design.description.matchAll(/(p\.[A-Z][a-z]{2}\d+(?:[A-Z][a-z]{2}|Ter)),/g)].map((m) => m[1]);
  const [laterMissing, middleMissing, dropout, firstMissing, fewPoints, notALine, zeros] = names;
  return { laterMissing, middleMissing, dropout, firstMissing, fewPoints, notALine, zeros };
}

const R = REPLICATE_STATE;
// Under MaveScape's defaults (WLS, at least 3 time points, the first among them): [edge, what,
// each replicate's state, time points used per replicate (0 when not used), flags of the combined
// score].
export const TIME_SERIES_EXPECTATIONS = [
  ['laterMissing', 'missing at one later time in replicate 1: fitted on its other 4 points there', [R.USED, R.USED, R.USED], [4, 5, 5], FLAG.FEWER_POINTS],
  ['middleMissing', 'missing at two middle times in replicate 2: fitted on 3 points there', [R.USED, R.USED, R.USED], [5, 3, 5], FLAG.FEWER_POINTS],
  ['dropout', 'dropped out, written as missing at the last two times: fitted on the first three', [R.USED, R.USED, R.USED], [3, 3, 3], FLAG.FEWER_POINTS],
  ['firstMissing', 'missing at time 0 in replicate 3: not measured there (the input is required)', [R.USED, R.USED, R.NOT_COUNTED], [5, 5, 0], FLAG.FEWER_REPLICATES],
  ['fewPoints', 'counted at two times in replicate 1: too few for a line there', [R.FEW_POINTS, R.USED, R.USED], [0, 5, 5], FLAG.FEWER_REPLICATES],
  ['zeros', 'counted 0 at the last two times: zeros are counts, every point used', [R.USED, R.USED, R.USED], [5, 5, 5], FLAG.OUTPUT_ZERO],
];
