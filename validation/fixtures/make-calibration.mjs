// Writes factor IX's scored ClinVar controls (validation suite `calibration`, wave 8 slice 2), so
// that R computes calibration's metrics on real scores as MaveScape does:
//
//   node validation/fixtures/make-calibration.mjs
//
// controls/factor9-run1-controls.csv: the factor IX example's Run 1 (scored in Node with its
// defaults) and its ClinVar controls by default (at least one review star, missense; from the
// fetcher's cached answers, fixtures/public-data/clinvar/), each scored control's protein change,
// side and score, in the set's order. The suite checks that the file is still what the example
// and the module make, then gives the same scores to MaveScape's metrics and compares them with
// reference/calibration.json (generate_calibration.R).
//
// controls/factor9-run1-scores.csv (wave 8, slice 4): every variant Run 1 scores, in the run's
// order, the controls' sides marked, for the likelihood ratios of every score as acmgscaler
// computes them (suite `likelihood`, generate_likelihood.R).

import { writeFileSync } from 'node:fs';
import { openExampleInNode } from '../example-cases.mjs';
import { exampleById } from '../../web/lib/examples.js';
import { cachedGet } from '../cached-fetch.mjs';
import { CLINVAR } from '../../web/lib/providers/clinvar.js';
import { clinvarControls, matchControls } from '../../web/lib/controls.js';
import { KIND } from '../../web/lib/variants.js';

// The rows: [key, side, score] of each control Run 1 scores.
export async function factor9Controls() {
  const f9 = openExampleInNode(exampleById('factor9'));
  const target = { ...f9.design.targets[0], identifiers: { ...(f9.design.targets[0].identifiers ?? {}), gene: 'F9' } };
  const text = (await CLINVAR.fetch(target, {}, cachedGet())).text;
  const set = { labels: clinvarControls(text, target).labels };
  const m = matchControls(set, f9.scored.results);
  const score = m.view.conditions[0].score;
  return set.labels.map((l, k) => [l.key, l.side, m.rows[k] >= 0 ? score[m.rows[k]] : Number.NaN]).filter((r) => Number.isFinite(r[2]));
}

export const FACTOR9_CONTROLS = new URL('./controls/factor9-run1-controls.csv', import.meta.url);

// Every variant Run 1 scores, in the run's order, with its side where it is a control (wave 8, slice
// 4: the likelihood ratios of every score, as acmgscaler computes them with the others unlabeled):
// rows [key, score, side ('P', 'B' or '')].
export async function factor9Scores() {
  const f9 = openExampleInNode(exampleById('factor9'));
  const target = { ...f9.design.targets[0], identifiers: { ...(f9.design.targets[0].identifiers ?? {}), gene: 'F9' } };
  const text = (await CLINVAR.fetch(target, {}, cachedGet())).text;
  const set = { labels: clinvarControls(text, target).labels };
  const m = matchControls(set, f9.scored.results);
  const view = m.view;
  const side = new Map();
  set.labels.forEach((l, k) => { if (m.rows[k] >= 0) side.set(m.rows[k], l.side); });
  const score = view.conditions[0].score;
  const out = [];
  for (let i = 0; i < view.rows; i += 1) if (Number.isFinite(score[i]) && view.variants.kind[i] !== KIND.WT) out.push([view.variants.key[i], score[i], side.get(i) ?? '']);
  return out;
}

export const FACTOR9_SCORES = new URL('./controls/factor9-run1-scores.csv', import.meta.url);

if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = await factor9Controls();
  writeFileSync(FACTOR9_CONTROLS, `variant,side,score\n${rows.map(([k, s, x]) => `${k},${s},${x}`).join('\n')}\n`);
  console.log(`Wrote ${rows.length} controls (${rows.filter((r) => r[1] === 'P').length} P, ${rows.filter((r) => r[1] === 'B').length} B).`);
  const scores = await factor9Scores();
  writeFileSync(FACTOR9_SCORES, `variant,score,side\n${scores.map(([k, x, s]) => `${k},${x},${s}`).join('\n')}\n`);
  console.log(`Wrote ${scores.length} scored variants.`);
}
