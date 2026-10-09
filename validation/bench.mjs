// Performance of the map (wave 1, slice 7; requirement S12's companion for views): a simulated
// 5,000-residue target (105,000 single substitutions, three replicates) scored, built into the
// map's model, drawn while panning on a stand-in 2D context (the JavaScript cost of a frame; the
// browser's own raster time is measured in the window, validation/README.md), and exported as SVG.
//
//   node validation/bench.mjs [--json]
//
// Exits with status 1 when a budget is exceeded: scoring 10 s, the model 1 s, a frame's
// JavaScript 16 ms at the median (half of a 30-frames-per-second budget, leaving the rest to the
// raster).

import { simulateExperiment } from '../web/lib/simulate.js';
import { parseTable } from '../web/lib/csv.js';
import { scoreExperiment, DEFAULT_PARAMETERS } from '../web/lib/score.js';
import { buildMapModel } from '../web/lib/map-model.js';
import { drawMap, mapPalette } from '../web/lib/map-render.js';
import { mapSVG, EXPORT_THEME } from '../web/lib/map-svg.js';
import { createRandom } from '../web/lib/random.js';

// A 2D context that does nothing but count its calls.
export function countingContext() {
  const calls = { total: 0 };
  const count = (name) => () => { calls.total += 1; calls[name] = (calls[name] ?? 0) + 1; };
  const ctx = {};
  for (const name of ['fillRect', 'strokeRect', 'beginPath', 'moveTo', 'lineTo', 'closePath', 'fill', 'stroke', 'rect', 'clip', 'save', 'restore', 'fillText', 'setLineDash', 'setTransform']) ctx[name] = count(name);
  ctx.calls = calls;
  return ctx;
}

const median = (x) => [...x].sort((a, b) => a - b)[Math.floor(x.length / 2)];

export function bench() {
  const random = createRandom(5000);
  const aa = 'ACDEFGHIKLMNPQRSTVWY';
  const protein = `M${Array.from({ length: 4999 }, () => aa[random.int(20)]).join('')}`;
  let t0 = performance.now();
  const sim = simulateExperiment({ seed: 5000, protein, readsPerVariant: 100 });
  const simulateMs = performance.now() - t0;
  const table = parseTable(sim.csv);
  const names = table.columns[0].values;
  const columns = Object.fromEntries(table.columns.slice(1).map((c) => [c.name, c.numeric]));
  t0 = performance.now();
  const scored = scoreExperiment({ names, columns, design: sim.design, parameters: DEFAULT_PARAMETERS });
  const scoreMs = performance.now() - t0;
  if (!scored.ok) throw new Error(scored.errors.join(' '));
  t0 = performance.now();
  const model = buildMapModel(scored.results, sim.design);
  const modelMs = performance.now() - t0;
  const { color, paler } = mapPalette(model, 'rdbu', EXPORT_THEME.gray);
  const frames = [];
  let calls = 0;
  for (const cellW of [2, 6, 14]) {
    const view = { width: 1600, cellW, cellH: 14, x0: 1, hover: -1, focus: -1, selected: new Set() };
    for (let f = 0; f < 60; f += 1) {
      const ctx = countingContext();
      view.x0 = 1 + f * 37;
      t0 = performance.now();
      drawMap(ctx, model, view, EXPORT_THEME, color, paler);
      frames.push(performance.now() - t0);
      calls = Math.max(calls, ctx.calls.total);
    }
  }
  t0 = performance.now();
  const svg = mapSVG(model, { results: scored.results });
  const svgMs = performance.now() - t0;
  return {
    variants: names.length,
    positions: model.length,
    simulateMs,
    scoreMs,
    modelMs,
    frameMedianMs: median(frames),
    frameMaxMs: Math.max(...frames),
    callsPerFrame: calls,
    svgMs,
    svgMB: svg.length / 1e6,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = bench();
  if (process.argv.includes('--json')) console.log(JSON.stringify(r));
  else {
    console.log(`${r.positions} positions, ${r.variants} variants (simulated in ${r.simulateMs.toFixed(0)} ms)`);
    console.log(`scored in ${r.scoreMs.toFixed(0)} ms (budget 10000)`);
    console.log(`map model in ${r.modelMs.toFixed(0)} ms (budget 1000)`);
    console.log(`a frame while panning: median ${r.frameMedianMs.toFixed(2)} ms, longest ${r.frameMaxMs.toFixed(2)} ms of JavaScript, up to ${r.callsPerFrame} drawing calls (budget 16 ms at the median)`);
    console.log(`SVG export in ${r.svgMs.toFixed(0)} ms, ${r.svgMB.toFixed(1)} MB`);
  }
  const over = r.scoreMs > 10000 || r.modelMs > 1000 || r.frameMedianMs > 16;
  if (over) console.log('Over budget.');
  process.exit(over ? 1 : 0);
}
