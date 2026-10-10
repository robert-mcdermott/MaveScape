// Inputs for the DiMSum checks of the suite `scoring` (wave 2, slice 5): each data set of
// reference/dimsum.json as MaveScape reads it (its variant names, their substitutions, the wild
// type's row, each replicate's input and output counts with technical replicates summed), and the
// comparisons with DiMSum 1.4's own outputs.

import { readFileSync } from 'node:fs';
import { columnText, parseTable } from '../web/lib/csv.js';
import { namesFromSequences } from '../web/lib/importer.js';
import { sampleCounts, combineFixed } from '../web/lib/replicates.js';
import { STATUS, buildVariants } from '../web/lib/variants.js';
import { scoreDimsumGroup, substitutionsOf } from '../web/lib/score-dimsum.js';

export const dimsumReference = () => JSON.parse(readFileSync(new URL('./reference/dimsum.json', import.meta.url), 'utf8'));

function prepare(names, level, inputs, outputs) {
  const v = buildVariants(names, { level });
  const substitutions = v.key.map((k, i) => (v.status[i] === STATUS.INVALID ? -1 : substitutionsOf(k)));
  return { names, inputs, outputs, substitutions, wtRow: v.key.findIndex((k) => k === 'p.=' || k === 'c.=') };
}

// The fixture: its design's samples (output 3 is two lanes, summed).
export function fixtureCase() {
  const t = parseTable(new Uint8Array(readFileSync(new URL('./fixtures/two-population.csv', import.meta.url))));
  const d = JSON.parse(readFileSync(new URL('./fixtures/two-population.design.json', import.meta.url), 'utf8'));
  const byName = new Map(t.columns.map((c) => [c.name, c]));
  const counts = (id) => {
    const s = d.samples.find((x) => x.id === id);
    return sampleCounts(s, s.columns.map((c) => byName.get(c).numeric));
  };
  return prepare(columnText(byName.get('hgvs_pro')), 'protein', d.replicates.map((r) => counts(r.input)), d.replicates.map((r) => counts(r.output)));
}

// GRB2 SH3's MaveDB counts (dataset: validation/run.mjs's dataset('mavedb-grb2-sh3')).
export function grb2Case(data) {
  const t = parseTable(data.bytes('counts.csv'));
  const col = (n) => t.columns.find((c) => c.name === n).numeric;
  return prepare(columnText(t.columns.find((c) => c.name === 'hgvs_pro')), 'protein', [1, 2, 3].map((r) => col(`input_count_rep${r}`)), [1, 2, 3].map((r) => col(`output_count_rep${r}`)));
}

// DiMSum's demo: whole sequences named against its wild type at the nucleotide level.
export function demoCase(data) {
  const t = parseTable(data.bytes('countFile_Toy.txt'));
  const col = (n) => t.columns.find((c) => c.name === n).numeric;
  const named = namesFromSequences(columnText(t.columns.find((c) => c.name === 'nt_seq')), data.set.wildType);
  return prepare(named.nt, 'nucleotide', [1, 2, 3, 4].map((r) => col(`input${r}`)), [1, 2, 3, 4].map((r) => col(`output${r}A`)));
}

const rel = (a, b) => Math.abs(a - b) / Math.max(1, Math.abs(b));

// MaveScape's DiMSum on a data set against DiMSum's: its own fit (threshold, variants, scales and
// shifts, the error model on every variant and against DiMSum's bootstrap), and with DiMSum's
// parameters the fitness and sigma of every variant in each replicate, and merged.
export function compareDimsum(c, ref) {
  const R = c.inputs.length;
  const own = scoreDimsumGroup({ inputs: c.inputs, outputs: c.outputs, wtRow: c.wtRow, substitutions: c.substitutions, options: {} });
  const m = own.model;
  const out = { refused: own.refused ?? null, threshold: rel(m.threshold, Number(ref.threshold)), fitted: [m.variants, ref.fitted] };
  let norm = 0;
  m.scale.forEach((x, j) => { norm = Math.max(norm, Math.abs(x - ref.normalisation.scale[j]), Math.abs(m.shift[j] - ref.normalisation.shift[j])); });
  out.normalisation = { difference: norm, minimum: m.value ?? null, nlm: ref.normalisation.nlm.minimum, code: ref.normalisation.nlm.code };
  let full = 0;
  let inside = 0;
  for (const t of ['input', 'output', 'reperror']) {
    m[t].forEach((x, j) => {
      full = Math.max(full, rel(x, ref.full_fit[t][j]));
      if (x >= ref.error_model.lower[t][j] * (1 - 1e-9) && x <= ref.error_model.upper[t][j] * (1 + 1e-9)) inside += 1;
    });
  }
  out.fullFit = full;
  out.inside = [inside, 3 * R];
  // With DiMSum's own parameters.
  const fixed = { scale: ref.normalisation.scale, shift: ref.normalisation.shift, input: ref.error_model.input, output: ref.error_model.output, reperror: ref.error_model.reperror };
  out.scored = {};
  for (const [key, pseudocount] of [['scored', 0], ['dropout', ref.dropout?.pseudocount ?? 0]]) {
    const theirs = ref[key];
    if (!theirs) continue;
    const mine = scoreDimsumGroup({ inputs: c.inputs, outputs: c.outputs, wtRow: c.wtRow, substitutions: c.substitutions, options: { fixed, dropoutPseudocount: pseudocount } });
    let worst = 0;
    let where = '';
    let oneSide = 0;
    let merged = 0;
    let values = 0;
    theirs.rows.forEach((row, k) => {
      const i = row - 1;
      const y = [];
      const v = [];
      for (let j = 0; j < R; j += 1) {
        const a = mine.score[j][i];
        const b = theirs.fitness[j][k];
        if ((b === null) !== Number.isNaN(a)) {
          oneSide += 1;
          continue;
        }
        if (b === null) continue;
        values += 1;
        const e = Math.max(rel(a, b), rel(mine.se[j][i], theirs.sigma[j][k]));
        if (e > worst) {
          worst = e;
          where = `row ${row}, replicate ${j + 1}`;
        }
        y.push(a);
        v.push(mine.se[j][i] * mine.se[j][i]);
      }
      const cf = combineFixed(y, v);
      merged = Math.max(merged, rel(cf.estimate, theirs.merged.fitness[k]), rel(cf.se, theirs.merged.sigma[k]));
    });
    out.scored[key] = { worst, where, oneSide, merged, values, variants: theirs.rows.length };
  }
  return out;
}
