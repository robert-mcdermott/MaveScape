// Comparisons for the validation suite `compare` (wave 4, slice 1): the published examples as runs
// a comparison reads (each table with its own SHA-256 and where it came from, as the window keeps
// them), and simulated pairs of known agreement for the intervals' coverage.

import { parseTable } from '../web/lib/csv.js';
import { countsDesign, scoresDesign } from '../web/lib/mavedb.js';
import { detectLayout } from '../web/lib/importer.js';
import { defaultParameters, withDefaults } from '../web/lib/score.js';
import { makeRun, runInputs } from '../web/lib/runs.js';
import { sha256 } from '../web/lib/sha256.js';
import { EXAMPLES } from '../web/lib/examples.js';
import { createRandom } from '../web/lib/random.js';
import { agreementOf } from '../web/lib/agreement.js';
import { KIND } from '../web/lib/variants.js';
import { cachedRecord, openExampleInNode, recordTable, recordTarget } from './example-cases.mjs';
import { workspaceOf } from './readiness-cases.mjs';
import { scoreTable } from './roundtrip-cases.mjs';

const SOFTWARE = { version: 'validation', commit: '' };
export const exampleById = (id) => EXAMPLES.find((e) => e.id === id);

// An example opened as the window opens it and scored (its Run 1): { ws, run, results, o }. The
// table is named by the SHA-256 of its (first) file, as the window names a joined table.
export function exampleRun(id, { name = 'Run 1', parameters = {} } = {}) {
  const o = openExampleInNode(exampleById(id), { parameters });
  if (!o.scored.ok) throw new Error(`${id}: ${o.scored.errors.join(' ')}`);
  const source = { ...o.ws.sources[0], sha256: sha256(o.parts[0].bytes) };
  const ws = { ...o.ws, sources: [source] };
  const run = makeRun({ inputs: runInputs({ source, design: o.design, parameters: o.parameters }), source, results: o.scored.results, software: SOFTWARE, name });
  return { ws, run, results: o.scored.results, o };
}

// A MaveDB record's published scores read as published (the run "Published scores"), from the
// table the validation keeps: { ws, run, results }.
export function publishedRun(exampleId, urn, { name = 'Published scores' } = {}) {
  const example = exampleById(exampleId);
  const record = cachedRecord(urn);
  const { bytes } = recordTable(example, urn, 'scores');
  const table = parseTable(bytes, { fileName: 'scores.csv' });
  const design = scoresDesign(record, { table, layout: detectLayout(table), target: recordTarget(record) });
  if (example.readout) design.readout = { ...(design.readout ?? {}), ...example.readout };
  const ws = workspaceOf(table, design, { layout: 'mavedb-scores', sha256: sha256(bytes), origin: { database: 'MaveDB', urn, file: 'scores' } });
  const parameters = withDefaults(defaultParameters(design, ws.sources[0]));
  const scored = scoreTable(table, design, parameters);
  const run = makeRun({ inputs: runInputs({ source: ws.sources[0], design, parameters }), source: ws.sources[0], results: scored.results, software: SOFTWARE, name });
  return { ws, run, results: scored.results };
}

// A MaveDB record's counts with the design drafted from their names (and the example's readout,
// as the window gives them), scored with the defaults: { ws, run, results }.
export function countsRun(exampleId, urn, { name = 'Run 1' } = {}) {
  const example = exampleById(exampleId);
  const record = cachedRecord(urn);
  const { bytes } = recordTable(example, urn, 'counts');
  const table = parseTable(bytes, { fileName: 'counts.csv' });
  const { design } = countsDesign(record, { table, layout: detectLayout(table), target: recordTarget(record) });
  if (example.readout) design.readout = { ...(design.readout ?? {}), ...example.readout };
  const ws = workspaceOf(table, design, { layout: 'mavedb-counts', sha256: sha256(bytes), origin: { database: 'MaveDB', urn, file: 'counts' } });
  const parameters = withDefaults(defaultParameters(design, ws.sources[0]));
  const scored = scoreTable(table, design, parameters);
  if (!scored.ok) throw new Error(`${urn}'s counts: ${scored.errors.join(' ')}`);
  const run = makeRun({ inputs: runInputs({ source: ws.sources[0], design, parameters }), source: ws.sources[0], results: scored.results, software: SOFTWARE, name });
  return { ws, run, results: scored.results };
}

// The tables of several runs, as one workspace's (what describeSide reads of it).
export const together = (...parts) => ({ sources: parts.flatMap((p) => p.ws.sources) });

// Simulated pairs of known agreement: x ~ N(0, 1) and y = a + b·x + e, e ~ N(0, s²), n pairs, reps
// times. The truth: Pearson's ρ = b/√(b² + s²); Spearman's ρ_s = (6/π) asin(ρ/2) (Pearson 1907, for
// the bivariate normal); Lin's ρc = 2b/(1 + b² + s² + a²); the bias E(x − y) = −a and the limits
// −a ± 1.96 √((1 − b)² + s²). Returns each interval's share of replicates holding its truth.
export function coverage({ seed, n, reps, a = 0, b = 1, s = 0.5 }) {
  const random = createRandom(seed);
  const rho = b / Math.sqrt(b * b + s * s);
  const truth = {
    pearson: rho,
    spearman: (6 / Math.PI) * Math.asin(rho / 2),
    concordance: (2 * b) / (1 + b * b + s * s + a * a),
    bias: -a,
    lower: -a - 1.96 * Math.sqrt((1 - b) ** 2 + s * s),
    upper: -a + 1.96 * Math.sqrt((1 - b) ** 2 + s * s),
  };
  const hits = { pearson: 0, spearman: 0, concordance: 0, bias: 0, lower: 0, upper: 0 };
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  for (let r = 0; r < reps; r += 1) {
    for (let i = 0; i < n; i += 1) {
      x[i] = random.gaussian();
      y[i] = a + b * x[i] + s * random.gaussian();
    }
    const st = agreementOf(x, y);
    const ba = st.blandAltman;
    if (st.pearson.low <= truth.pearson && truth.pearson <= st.pearson.high) hits.pearson += 1;
    if (st.spearman.low <= truth.spearman && truth.spearman <= st.spearman.high) hits.spearman += 1;
    if (st.concordance.low <= truth.concordance && truth.concordance <= st.concordance.high) hits.concordance += 1;
    if (ba.biasLow <= truth.bias && truth.bias <= ba.biasHigh) hits.bias += 1;
    if (ba.lowerLow <= truth.lower && truth.lower <= ba.lowerHigh) hits.lower += 1;
    if (ba.upperLow <= truth.upper && truth.upper <= ba.upperHigh) hits.upper += 1;
  }
  return { truth, share: Object.fromEntries(Object.entries(hits).map(([k, v]) => [k, v / reps])) };
}

// A run's scores as another table would give them: its single substitutions renumbered `shift`
// residues earlier (those before the new first residue left out) on another target, and, with
// direction, its readout stating that direction and its scores negated (negate). The wild type
// stays. A table of its own (its own SHA-256), one condition, no replicates: { run, results }.
export function movedRun(base, target, shift, { direction = null, negate = false } = {}) {
  const r = base.results;
  const c = r.conditions[0];
  const single = /^p\.([A-Z][a-z]{2})(\d+)([A-Z][a-z]{2}|=)$/;
  const keep = [];
  r.variants.key.forEach((k, i) => {
    const m = single.exec(k ?? '');
    if (r.variants.kind[i] === KIND.WT || (m && Number(m[2]) - shift >= 1)) keep.push(i);
  });
  const rename = (k) => (single.test(k ?? '') ? k.replace(/\d+/, (p) => String(Number(p) - shift)) : k);
  const take = (array, Kind, f = (x) => x) => Kind.from(keep, (i) => f(array[i]));
  const results = {
    rows: keep.length,
    variants: { key: keep.map((i) => rename(r.variants.key[i])), original: keep.map((i) => rename(r.variants.original[i])), kind: take(r.variants.kind, Uint8Array), position: take(r.variants.position, Int32Array, (p) => Math.max(0, p - shift)), status: take(r.variants.status, Uint8Array) },
    replicates: [],
    conditions: [{ ...c, replicates: [], score: take(c.score, Float64Array, (x) => (negate ? -x : x)), se: take(c.se, Float64Array), reason: take(c.reason, Uint8Array), flags: take(c.flags, Uint8Array) }],
  };
  const design = { ...base.run.inputs.design, targets: [target], replicates: [], ...(direction ? { readout: { ...(base.run.inputs.design.readout ?? {}), direction } } : {}) };
  const table = sha256(new TextEncoder().encode(`${target.sequence}|${shift}|${direction}|${negate}`));
  const run = { id: `run-moved-${table.slice(0, 8)}`, name: direction ? 'Stated the other way' : 'Moved', inputs: { ...base.run.inputs, design, source: { ...base.run.inputs.source, sha256: table } }, output: { sha256: `moved-${table.slice(0, 12)}`, conditions: [{ id: c.id, name: c.name, replicates: [] }], replicates: [] } };
  return { run, results };
}

// Two runs of independent tables on one protein target, on one scale, from scores and SEs given
// per variant, each a substitution at its position (up to 20 at a position): { ws, a, b } with each
// side as describeSide reads it. For the discordance tests (wave 4, slice 2).
const ALTS = ['Arg', 'Asn', 'Asp', 'Cys', 'Gln', 'Glu', 'Gly', 'His', 'Ile', 'Leu', 'Lys', 'Met', 'Phe', 'Pro', 'Ser', 'Thr', 'Trp', 'Tyr', 'Val', 'Ter'];
export function syntheticPair({ x, y, sx, sy, position }) {
  const seen = new Map();
  const keys = Array.from(position, (p) => {
    const k = seen.get(p) ?? 0;
    seen.set(p, k + 1);
    return `p.Ala${p}${ALTS[k]}`;
  });
  const length = Math.max(...position);
  const design = { model: 'two-population', targets: [{ id: 't', name: 'Simulated', sequence: 'A'.repeat(length), sequenceType: 'protein', offset: 0, identifiers: {} }], variants: { level: 'protein', column: 'hgvs_pro' }, readout: { direction: 'higher-more' }, replicates: [] };
  const run = (id, score, se) => {
    const n = keys.length;
    const results = {
      rows: n,
      variants: { key: keys, original: keys, kind: Uint8Array.from(keys, (k) => (k.endsWith('Ter') ? KIND.NONSENSE : KIND.MISSENSE)), position: Int32Array.from(position), status: new Uint8Array(n) },
      replicates: [],
      conditions: [{ id: 'all', name: 'All replicates', replicates: [], score: Float64Array.from(score), se: Float64Array.from(se), reason: new Uint8Array(n), flags: new Uint8Array(n) }],
    };
    const table = sha256(new TextEncoder().encode(`${id}|${score.length}|${score[0]}`));
    return { run: { id, name: id === 'run-a' ? 'First' : 'Second', inputs: { design, parameters: { model: 'ratio', normalization: 'wt', rescale: 'none' }, source: { sha256: table } }, output: { sha256: `${id}-out`, conditions: [{ id: 'all', name: 'All replicates', replicates: [] }], replicates: [] } }, results };
  };
  const a = run('run-a', x, sx);
  const b = run('run-b', y, sy);
  const ws = { sources: [] };
  return { ws, a, b };
}

// Simulated pairs with planted discordance: n variants at n/10 positions, truth ~ N(0, 1), each side
// the truth with its own counting error (SEs from 0.1 to 0.3); `planted` variants differ by ±shift
// and `positions` positions by positionShift. Returns { x, y, sx, sy, position, planted (indices),
// plantedPositions }.
export function plantedPair({ seed, n = 600, planted = 30, shift = 1.5, positions = [12, 31, 47], positionShift = 0.5 }) {
  const random = createRandom(seed);
  const position = Int32Array.from({ length: n }, (_, i) => Math.floor(i / 10) + 1);
  const sx = Float64Array.from({ length: n }, () => 0.1 + 0.2 * random());
  const sy = Float64Array.from({ length: n }, () => 0.1 + 0.2 * random());
  const delta = new Float64Array(n);
  const chosen = new Set();
  while (chosen.size < planted) chosen.add(random.int(n));
  for (const i of chosen) delta[i] = random() < 0.5 ? -shift : shift;
  for (let i = 0; i < n; i += 1) if (positions.includes(position[i])) delta[i] += positionShift;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    const t = random.gaussian();
    x[i] = t + sx[i] * random.gaussian();
    y[i] = t + delta[i] + sy[i] * random.gaussian();
  }
  return { x, y, sx, sy, position, planted: [...chosen].sort((p, q) => p - q), plantedPositions: positions };
}
