// Cases for the validation suite `readiness` (wave 2, slice 10; requirement E8): every example and
// fixture, whole and with one part taken away (the wild-type row, a replicate, the gates, the
// cells, the times in generations, time points, the readout, the controls, how the library was
// made). The readiness model (web/lib/readiness.js) must name exactly what was taken away, and its
// verdict on each analysis must agree with what the engine does: an analysis it calls possible is
// scored (or assessed, for a QC finding), one it calls not possible is refused (or not assessed).

import { readFileSync } from 'node:fs';
import { cellText, columnText, parseTable } from '../web/lib/csv.js';
import { applyBarcodeMap } from '../web/lib/barcodes.js';
import { reviewImport } from '../web/lib/importer.js';
import { buildVariants, KIND } from '../web/lib/variants.js';
import { addSource, addTarget, createWorkspace, setDesign } from '../web/lib/workspace.js';
import { defaultParameters, scoreExperiment, withDefaults } from '../web/lib/score.js';
import { computeQC } from '../web/lib/qc.js';
import { defaultThresholds, findingsFrom } from '../web/lib/findings.js';
import { readiness } from '../web/lib/readiness.js';
import { EXAMPLES, simulatedExample } from '../web/lib/examples.js';
import { simulateExperiment } from '../web/lib/simulate.js';
import { replicateSamples } from '../web/lib/design.js';

const here = (path) => new URL(path, import.meta.url);
const json = (path) => JSON.parse(readFileSync(here(path), 'utf8'));
const tableOf = (path) => parseTable(new Uint8Array(readFileSync(here(path))));
const clone = (x) => JSON.parse(JSON.stringify(x));

// A simulated table as the app reads it: a barcoded one with its map applied.
function simulatedTable(sim) {
  const files = sim.files ?? [{ text: sim.csv, role: 'counts' }, ...(sim.map ? [{ text: sim.map, role: 'map' }] : [])];
  let table = parseTable(new TextEncoder().encode(files[0].text));
  const map = files.find((f) => f.role === 'map');
  if (map) table = applyBarcodeMap(table, 'barcode', parseTable(new TextEncoder().encode(map.text)), 'barcode', 'hgvs_pro').table;
  return table;
}

// The data sets: { name, table, design }.
export function readinessDatasets() {
  const examples = EXAMPLES.filter((e) => e.simulated).map((e) => {
    const sim = simulatedExample(e);
    return { name: `${e.title} (example)`, table: simulatedTable(sim), design: sim.design };
  });
  const bottleneck = simulateExperiment({ seed: 20261009, inputCells: 50, recordCells: true });
  return [
    { name: 'GRB2 SH3 domain (example)', table: tableOf('../web/examples/grb2-sh3/counts.csv'), design: json('../web/examples/grb2-sh3/design.json') },
    ...examples,
    { name: 'the two-population fixture', table: tableOf('./fixtures/two-population.csv'), design: json('./fixtures/two-population.design.json') },
    { name: 'the time-series fixture', table: tableOf('./fixtures/time-series.csv'), design: json('./fixtures/time-series.design.json') },
    { name: 'the sort-seq fixture', table: tableOf('./fixtures/sort-seq.csv'), design: json('./fixtures/sort-seq.design.json') },
    { name: 'the barcode fixture', table: applyBarcodeMap(tableOf('./fixtures/barcodes.csv'), 'barcode', tableOf('./fixtures/barcodes.map.csv'), 'barcode', 'hgvs_pro').table, design: json('./fixtures/barcodes.design.json') },
    { name: 'the two-condition fixture', table: tableOf('./fixtures/two-condition.csv'), design: json('./fixtures/two-condition.design.json') },
    { name: 'a simulated bottleneck with the cells recorded', table: simulatedTable(bottleneck), design: bottleneck.design },
  ];
}

// The workspace the window builds for a table and its design (import as the wizard does).
export function workspaceOf(table, design) {
  const countColumns = design.samples.flatMap((s) => s.columns);
  const barcodeColumn = design.library?.level === 'barcode' ? design.library.barcodeColumn : undefined;
  const review = reviewImport(table, { variantColumn: design.variants.column, level: design.variants.level, countColumns, target: design.targets[0], barcodeColumn });
  let ws = createWorkspace(design.name ?? 'readiness', { now: '2026-10-10T12:00:00.000Z', id: 'ws-readiness' });
  const target = addTarget(ws, design.targets[0]);
  ws = target.ws;
  const source = {
    name: 'counts.csv', fileName: 'counts.csv', sha256: '0'.repeat(64), rows: table.rows,
    columns: table.columns.map((c) => ({ name: c.name, type: c.type, missing: c.missing })),
    mapping: { variantColumn: design.variants.column, level: design.variants.level, mode: 'lenient', countColumns, ...(barcodeColumn ? { barcodeColumn } : {}) },
    target: target.id, summary: review.summary,
    problems: { blocking: review.blocking.map((p) => p.message), warnings: review.warnings.map((p) => p.message) },
  };
  const added = addSource(ws, source);
  return setDesign(added.ws, design, 'The design', added.id);
}

// The table without some rows (rebuilt as text and read again, as a table without them would be).
function withoutRows(table, drop) {
  const quote = (s) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = [table.columns.map((c) => quote(c.name)).join(',')];
  for (let r = 0; r < table.rows; r += 1) if (!drop[r]) lines.push(table.columns.map((c) => quote(cellText(c, r) ?? '')).join(','));
  return parseTable(new TextEncoder().encode(`${lines.join('\n')}\n`));
}

// A design without some samples: their columns set aside, so that every column stays accounted for.
function withoutSamples(design, ids, reason) {
  const used = new Set(design.replicates.flatMap((r) => replicateSamples(r).map((x) => x.sample)));
  const gone = design.samples.filter((s) => ids.includes(s.id) && !used.has(s.id));
  design.samples = design.samples.filter((s) => !gone.includes(s));
  design.ignoredColumns = [...(design.ignoredColumns ?? []), ...gone.flatMap((s) => s.columns.map((column) => ({ column, reason })))];
  return design;
}

// Replicates by condition and tile (as readiness.js and QC group them).
const groupSizes = (design) => {
  const groups = new Map();
  for (const r of design.replicates) groups.set(`${r.condition ?? ''}|${r.tile ?? ''}`, [...(groups.get(`${r.condition ?? ''}|${r.tile ?? ''}`) ?? []), r]);
  return groups;
};

// The parts that can be taken away: { id, what, applies(case), apply(case) → { table, design },
// gaps(before, after) → the gaps that must appear }.
export const REMOVALS = [
  {
    id: 'wild-type', what: 'the wild-type row',
    applies: (c) => (c.ws.sources[0].summary.byKind['wild type'] ?? 0) > 0,
    apply: (c) => {
      const variants = buildVariants(columnText(c.table.columns.find((x) => x.name === c.design.variants.column)), { level: c.design.variants.level, target: c.design.targets[0] });
      const drop = Uint8Array.from(variants.kind, (k) => (k === KIND.WT ? 1 : 0));
      return { table: withoutRows(c.table, drop), design: clone(c.design) };
    },
    gaps: () => ['wild-type'],
  },
  {
    id: 'replicate', what: 'a replicate (the last of the largest group)',
    applies: (c) => c.design.replicates.length >= 2,
    apply: (c) => {
      const design = clone(c.design);
      const largest = [...groupSizes(design).values()].sort((a, b) => b.length - a.length)[0];
      const gone = largest.at(-1);
      design.replicates = design.replicates.filter((r) => r.id !== gone.id);
      return { table: c.table, design: withoutSamples(design, replicateSamples(gone).map((x) => x.sample), 'taken away (validation)') };
    },
    gaps: (before, after) => {
      const sizes = (d) => [...groupSizes(d).values()].map((g) => g.length);
      const [b, a] = [sizes(before), sizes(after)];
      const out = [];
      if ((Math.max(...a) < 2 && Math.max(...b) >= 2) || (Math.min(...a) < 2 && Math.min(...b) >= 2)) out.push('replicates');
      if (Math.max(...a) < 3 && Math.max(...b) >= 3) out.push('third-replicate');
      return out;
    },
  },
  {
    id: 'gates', what: 'the bins\' gates',
    applies: (c) => c.design.model === 'bins' && c.design.replicates.some((r) => (r.bins ?? []).some((b) => b.lower || b.upper)),
    apply: (c) => {
      const design = clone(c.design);
      for (const r of design.replicates) for (const b of r.bins ?? []) {
        delete b.lower;
        delete b.upper;
      }
      return { table: c.table, design };
    },
    gaps: () => ['gates'],
  },
  {
    id: 'cells', what: 'the cells recorded',
    applies: (c) => c.design.samples.some((s) => s.cells > 0) && (c.design.model === 'bins' || c.design.model === 'two-population'),
    apply: (c) => {
      const design = clone(c.design);
      for (const s of design.samples) delete s.cells;
      return { table: c.table, design };
    },
    gaps: (before) => [before.model === 'bins' ? 'bin-cells' : 'selection-cells'],
  },
  {
    id: 'generations', what: 'the times in generations (the unit unknown)',
    applies: (c) => c.design.model === 'time-series' && c.design.time?.unit === 'generation',
    apply: (c) => {
      const design = clone(c.design);
      design.time = { unit: 'other' };
      return { table: c.table, design };
    },
    gaps: () => ['generations'],
  },
  {
    id: 'time-points', what: 'the middle time points (the first and last kept)',
    applies: (c) => c.design.model === 'time-series' && c.design.replicates.every((r) => (r.timepoints ?? []).length >= 3),
    apply: (c) => {
      const design = clone(c.design);
      const middle = [];
      for (const r of design.replicates) {
        const points = [...r.timepoints].sort((a, b) => a.time - b.time);
        middle.push(...points.slice(1, -1).map((p) => p.sample));
        r.timepoints = [points[0], points.at(-1)];
      }
      return { table: c.table, design: withoutSamples(design, middle, 'taken away (validation)') };
    },
    gaps: () => ['time-points'],
  },
  {
    id: 'readout', what: 'what the assay measures',
    applies: (c) => Boolean(c.design.readout),
    apply: (c) => {
      const design = clone(c.design);
      delete design.readout;
      return { table: c.table, design };
    },
    gaps: (before) => ['readout', ...(before.readout?.method && before.readout?.mechanism && before.readout?.modelSystem ? ['readout-terms'] : [])],
  },
  {
    id: 'nonsense', what: 'the nonsense controls (named none)',
    applies: (c) => c.design.controls?.nonsense !== 'none' && (c.ws.sources[0].summary.byKind.nonsense ?? 0) > 0,
    apply: (c) => {
      const design = clone(c.design);
      design.controls = { ...design.controls, nonsense: 'none' };
      return { table: c.table, design };
    },
    gaps: () => ['nonsense'],
  },
  {
    id: 'synonymous', what: 'the synonymous controls (named none)',
    applies: (c) => c.design.controls?.synonymous !== 'none' && (c.ws.sources[0].summary.byKind.synonymous ?? 0) > 0,
    apply: (c) => {
      const design = clone(c.design);
      design.controls = { ...design.controls, synonymous: 'none' };
      return { table: c.table, design };
    },
    gaps: () => ['synonymous'],
  },
  {
    id: 'library-method', what: 'how the library was made',
    applies: (c) => Boolean(c.design.library?.method),
    apply: (c) => {
      const design = clone(c.design);
      delete design.library.method;
      return { table: c.table, design };
    },
    gaps: () => ['library-method'],
  },
];

// A case: the workspace and its readiness.
export function caseOf(table, design) {
  const ws = workspaceOf(table, design);
  return { table, design, ws, readiness: readiness(ws) };
}

// What the engine does with each analysis that has a probe: id → possible (true/false). Scoring
// analyses are scored with the parameters that use them (on MaveScape's defaults for the design);
// QC findings are assessed (not 'na') on the counts and a run with the defaults.
export function probe(c) {
  const { table, design } = c;
  const names = columnText(table.columns.find((x) => x.name === design.variants.column));
  const barcodes = design.library?.level === 'barcode' ? columnText(table.columns.find((x) => x.name === design.library.barcodeColumn)) : null;
  const columns = {};
  for (const s of design.samples) for (const name of s.columns) columns[name] = table.columns.find((x) => x.name === name)?.numeric ?? new Float64Array(table.rows).fill(Number.NaN);
  const base = defaultParameters(design, c.ws.sources[0]);
  const run = (extra) => scoreExperiment({ names, barcodes, columns, design, parameters: withDefaults({ ...base, ...extra, filters: { ...base.filters, ...(extra.filters ?? {}) } }) });
  const ok = (extra) => run(extra).ok;
  const out = new Map();
  const model = design.model;
  if (model === 'two-population') {
    out.set('score.log-ratio', ok({ model: 'ratio' }));
    out.set('score.dimsum', ok({ model: 'dimsum' }));
  }
  if (model === 'time-series') {
    out.set('score.regression', ok({ model: 'wls' }));
    out.set('score.ratio-of-ends', ok({ model: 'ratio' }));
  }
  if (model === 'bins') {
    out.set('score.bin-average', ok({ model: 'bins', binScale: 'none' }));
    out.set('score.bin-mle', ok({ model: 'bins-mle', binScale: 'none' }) || ok({ model: 'bins-mle', binScale: 'none', binSigma: 'per-variant' }));
    out.set('scale.bins-nonsense-wt', ok({ model: 'bins', binScale: 'nonsense-wt' }));
    out.set('scale.bins-low5-wt', ok({ model: 'bins', binScale: 'low5-wt' }));
  } else {
    out.set('normalize.wild-type', ok({ normalization: 'wt' }));
    out.set('normalize.synonymous', ok({ normalization: 'synonymous' }));
  }
  if (design.library?.level === 'barcode' && model !== 'bins') out.set('score.barcodes-each', ok({ aggregation: 'barcode' }));
  out.set('rescale.nonsense-wt', ok({ rescale: 'nonsense-wt' }));
  out.set('rescale.synonymous-nonsense', ok({ rescale: 'synonymous-nonsense' }));
  const scored = run({});
  if (scored.ok) {
    const r = scored.results;
    const conditions = r.conditions.length;
    const single = r.warnings.filter((w) => w.code === 'one-replicate').length;
    out.set('replicates.combine', single < conditions);
    out.set('replicates.leave-one-out', r.conditions.some((x) => x.loo.some(Number.isFinite)));
    out.set('conditions.differential', Boolean(r.differential?.length));
  }
  const qc = computeQC({ names, barcodes, columns, design, results: scored.ok ? scored.results : null });
  for (const f of findingsFrom(qc, defaultThresholds())) out.set(`qc.${f.id}`, f.status !== 'na');
  return { probes: out, scored: scored.ok, refused: scored.ok ? null : scored.errors };
}
