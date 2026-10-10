import assert from 'node:assert/strict';
import test from 'node:test';
import { anchorUncertainty } from './anchors.js';
import { simulateExperiment } from './simulate.js';
import { parseTable, columnText } from './csv.js';
import { scoreExperiment, withDefaults } from './score.js';

const scored = (parameters) => {
  const sim = simulateExperiment({ seed: 4, replicateNoise: 0.1 });
  const t = parseTable(sim.csv);
  const out = scoreExperiment({ names: columnText(t.columns[0]), columns: Object.fromEntries(t.columns.slice(1).map((c) => [c.name, c.numeric])), design: sim.design, parameters: withDefaults(parameters) });
  return { results: out.results, design: sim.design };
};

test('the rescaling anchors\' uncertainty: each anchor\'s own SE at it, both in between, none without rescaling', () => {
  const { results, design } = scored({ rescale: 'nonsense-wt' });
  const scale = anchorUncertainty(results, design, 0);
  const [nonsense, wt] = scale.anchors;
  assert.deepEqual([nonsense.what, nonsense.to, wt.what, wt.to], ['nonsense', 0, 'wild type', 1]);
  assert.ok(nonsense.se > 0 && wt.se > 0);
  assert.ok(Math.abs(scale.at(0) - nonsense.se) < 1e-15 && Math.abs(scale.at(1) - wt.se) < 1e-15);
  assert.ok(Math.abs(scale.at(0.5) - Math.hypot(nonsense.se, wt.se) / 2) < 1e-15);
  assert.equal(anchorUncertainty(scored({}).results, design, 0), null);
});

test('rescaled to a median of controls, the moderated SEs leave out the replicates\' shared shift (it cancels)', () => {
  const plain = scored({});
  const rescaled = scored({ rescale: 'nonsense-wt' });
  const c = plain.results.conditions[0];
  const r = rescaled.results.conditions[0];
  const slope = Math.abs(r.rescale.slope);
  const i = plain.results.variants.original.indexOf('p.Ser2Ala');
  assert.ok(plain.results.conditions[0].errorModel.bReference > 0);
  assert.ok(r.se[i] < c.se[i] * slope, `${r.se[i]} against ${c.se[i] * slope}`);
});
