// Performance (requirements D9, S12). The map (wave 1, slice 7): a simulated 5,000-residue target
// (105,000 single substitutions, three replicates: six samples) scored, built into the map's
// model, drawn while panning on a stand-in 2D context (the JavaScript cost of a frame; the
// browser's own raster time is measured in the window, validation/README.md), and exported as SVG.
// Import at scale (wave 2, slice 4): a simulated table of a million barcodes in two libraries and
// its million-line barcode-to-variant map, written to files and read back as the csv worker reads
// them (16 MB parts, decoded as they come), assembled (the map applied), reviewed as the import
// wizard reviews them, and scored both ways (summed, and by barcode).
//
//   node validation/bench.mjs [--json]
//
// Exits with status 1 when a budget is exceeded: scoring 100,000 variants × 6 samples 10 s, the
// model 1 s, a frame's JavaScript 16 ms at the median (half of a 30-frames-per-second budget,
// leaving the rest to the raster); importing the million rows 15 s, the memory the import's process
// holds at its peak 1 GB; scoring the million barcodes 15 s each way.

import { simulateExperiment } from '../web/lib/simulate.js';
import { parseTable } from '../web/lib/csv.js';
import { scoreExperiment, DEFAULT_PARAMETERS } from '../web/lib/score.js';
import { buildMapModel } from '../web/lib/map-model.js';
import { drawMap, mapPalette } from '../web/lib/map-render.js';
import { mapSVG, EXPORT_THEME } from '../web/lib/map-svg.js';
import { createRandom } from '../web/lib/random.js';
import { closeSync, fstatSync, mkdtempSync, openSync, readFileSync, readSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { columnText, createTableParser } from '../web/lib/csv.js';
import { assembleTable } from '../web/lib/assemble.js';
import { detectLayout, reviewImport } from '../web/lib/importer.js';

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

// A file read as the csv worker reads it: 16 MB parts, decoded as they come.
function readInParts(path) {
  const fd = openSync(path, 'r');
  const size = fstatSync(fd).size;
  const parser = createTableParser({ fileName: path });
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const part = new Uint8Array(16 * 1024 * 1024);
  for (let offset = 0; offset < size; offset += part.length) {
    const n = readSync(fd, part, 0, part.length, offset);
    parser.push(decoder.decode(part.subarray(0, n), { stream: true }));
  }
  closeSync(fd);
  parser.push(decoder.decode());
  return { table: parser.finish(), bytes: size };
}

// The million barcodes, simulated and written to files; then imported and scored in a process of
// their own (importBarcodes), so that its memory is the import's alone.
export function benchBarcodes() {
  const random = createRandom(4000);
  const aa = 'ACDEFGHIKLMNPQRSTVWY';
  const protein = `M${Array.from({ length: 1599 }, () => aa[random.int(20)]).join('')}`;
  const t0 = performance.now();
  const dir = mkdtempSync(join(tmpdir(), 'mavescape-bench-'));
  try {
    const sim = simulateExperiment({ seed: 4000, protein, replicates: 2, barcodes: { perVariant: 15, wildType: 200, readsPerBarcode: 40 } });
    writeFileSync(join(dir, 'counts.csv'), sim.csv);
    writeFileSync(join(dir, 'map.csv'), sim.map);
    writeFileSync(join(dir, 'design.json'), JSON.stringify(sim.design));
    const simulateMs = performance.now() - t0;
    const child = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url), '--import', dir], { encoding: 'utf8', maxBuffer: 1 << 20 });
    if (child.status !== 0) throw new Error(`the import's process failed: ${child.stderr}`);
    return { rows: sim.barcodes.length, simulateMs, ...JSON.parse(child.stdout) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function importBarcodes(dir) {
  const gc = globalThis.gc;
  const design = JSON.parse(readFileSync(join(dir, 'design.json'), 'utf8'));
  gc();
  let peak = process.memoryUsage().rss;
  const sample = () => {
    peak = Math.max(peak, process.memoryUsage().rss);
  };
  let t0 = performance.now();
  let counts = readInParts(join(dir, 'counts.csv'));
  sample();
  let map = readInParts(join(dir, 'map.csv'));
  sample();
  const countsMB = counts.bytes / 1e6;
  const mapMB = map.bytes / 1e6;
  const assembled = assembleTable([{ name: 'counts.csv', table: counts.table, role: 'counts' }, { name: 'map.csv', table: map.table, role: 'map' }]);
  sample();
  const layout = detectLayout(assembled.table);
  const review = reviewImport(assembled.table, { variantColumn: layout.variantColumn, barcodeColumn: layout.barcodeColumn, level: layout.level, countColumns: layout.countColumns, target: design.targets[0] });
  sample();
  const importMs = performance.now() - t0;
  // What the workspace keeps: the assembled table and its review, not the files read.
  counts = null;
  map = null;
  gc();
  sample();
  const importPeak = peak;
  const held = process.memoryUsage();
  if (review.blocking.length) throw new Error(review.blocking.map((b) => b.message).join(' '));
  const table = assembled.table;
  const byName = new Map(table.columns.map((c) => [c.name, c]));
  const input = { names: columnText(byName.get(design.variants.column)), barcodes: columnText(byName.get(design.library.barcodeColumn)), columns: Object.fromEntries(design.samples.map((s) => [s.columns[0], byName.get(s.columns[0]).numeric])), design };
  t0 = performance.now();
  const summed = scoreExperiment({ ...input, parameters: DEFAULT_PARAMETERS });
  const sumMs = performance.now() - t0;
  sample();
  t0 = performance.now();
  const byBarcode = scoreExperiment({ ...input, parameters: { ...DEFAULT_PARAMETERS, aggregation: 'barcode' } });
  const barcodeMs = performance.now() - t0;
  sample();
  if (!summed.ok || !byBarcode.ok) throw new Error((summed.errors ?? byBarcode.errors).join(' '));
  return {
    variants: summed.results.rows,
    countsMB,
    mapMB,
    importMs,
    heldMB: (held.heapUsed + held.arrayBuffers) / 1e6,
    importPeakMB: importPeak / 1e6,
    peakMB: peak / 1e6,
    sumMs,
    barcodeMs,
  };
}

if (import.meta.url === `file://${process.argv[1]}` && process.argv[2] === '--import') {
  console.log(JSON.stringify(importBarcodes(process.argv[3])));
} else if (import.meta.url === `file://${process.argv[1]}`) {
  const r = bench();
  const b = benchBarcodes();
  if (process.argv.includes('--json')) console.log(JSON.stringify({ ...r, barcodes: b }));
  else {
    console.log(`${r.positions} positions, ${r.variants} variants (simulated in ${r.simulateMs.toFixed(0)} ms)`);
    console.log(`scored (6 samples) in ${r.scoreMs.toFixed(0)} ms (budget 10000)`);
    console.log(`map model in ${r.modelMs.toFixed(0)} ms (budget 1000)`);
    console.log(`a frame while panning: median ${r.frameMedianMs.toFixed(2)} ms, longest ${r.frameMaxMs.toFixed(2)} ms of JavaScript, up to ${r.callsPerFrame} drawing calls (budget 16 ms at the median)`);
    console.log(`SVG export in ${r.svgMs.toFixed(0)} ms, ${r.svgMB.toFixed(1)} MB`);
    console.log(`${b.rows} barcodes of ${b.variants} variants: counts ${b.countsMB.toFixed(0)} MB and map ${b.mapMB.toFixed(0)} MB (simulated in ${b.simulateMs.toFixed(0)} ms)`);
    console.log(`imported (read, map applied, reviewed) in ${b.importMs.toFixed(0)} ms (budget 15000); the process at most ${b.importPeakMB.toFixed(0)} MB (budget 1000), the table and its review then holding ${b.heldMB.toFixed(0)} MB`);
    console.log(`scored summed in ${b.sumMs.toFixed(0)} ms, by barcode in ${b.barcodeMs.toFixed(0)} ms (budget 15000 each); the process at most ${b.peakMB.toFixed(0)} MB`);
  }
  const over = r.scoreMs > 10000 || r.modelMs > 1000 || r.frameMedianMs > 16 || b.importMs > 15000 || b.importPeakMB > 1000 || b.sumMs > 15000 || b.barcodeMs > 15000;
  if (over) console.log('Over budget.');
  process.exit(over ? 1 : 0);
}
