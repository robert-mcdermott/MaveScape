// The diff's validation cases (wave 6, slice 5): GRB2's example and a checkpoint of it, then one
// planted change at a time (a pseudocount, a filter, a replicate left out, a QC threshold, a
// design edit), each with what the diff must say and nothing else; and the variants a change moved,
// computed apart from lib/diff.js (from the scores and SEs, as the robustness suite computes the
// classes).

import { exampleRun } from './compare-cases.mjs';
import { inputFor, scoreTable } from './roundtrip-cases.mjs';
import { addRun, makeRun, runInputs } from '../web/lib/runs.js';
import { addCheckpoint, setDesign, setQcThresholds } from '../web/lib/workspace.js';
import { analysisState, makeCheckpoint, runPairs } from '../web/lib/diff.js';
import { computeQC } from '../web/lib/qc.js';
import { findingsFrom, measuresOf, withDefaultThresholds } from '../web/lib/findings.js';
import { adjustBH, tTwoSided } from '../web/lib/distributions.js';
import { normalUpper } from '../web/lib/dmath.js';

// The QC findings of a run read with a state's thresholds and acknowledgements.
export function findingsOf(state, table, run, results) {
  const thresholds = withDefaultThresholds(state.qc?.thresholds);
  const qc = computeQC({ ...inputFor(table, run.inputs.design), design: run.inputs.design, results, measures: measuresOf(thresholds) });
  return findingsFrom(qc, thresholds, { acknowledged: state.qc?.acknowledged });
}

// The pairs of runPairs with their scores and QC, for diffStates.
export function pairsFor(before, after, table, scored) {
  return runPairs(before, after).map((p) => ({
    ...p,
    resultsA: scored.get(p.a.id),
    resultsB: scored.get(p.b.id),
    findingsA: findingsOf(before, table, p.a, scored.get(p.a.id)),
    findingsB: findingsOf(after, table, p.b, scored.get(p.b.id)),
  }));
}

// GRB2's Run 1 with a checkpoint kept, and the planted changes: [{ id, what, ws (after), expect: {
// changes: [text], parameters, design, findings: [[id, from, to]] (the QC verdicts the change
// moved: two replicates have no outlier to test), moved (true: variants compared) } }].
export function plantedChanges() {
  const g = exampleRun('grb2-sh3');
  const table = g.o.table;
  const scored = new Map([[g.run.id, g.results]]);
  let base = addRun(g.ws, g.run).ws;
  base = addCheckpoint(base, makeCheckpoint(base, 'Before', '2026-10-12T12:00:00.000Z'), '2026-10-12T12:00:00.000Z').ws;
  const design = g.run.inputs.design;
  const rescore = (ws, parameters, runDesign = design, name = 'Run 2') => {
    const s = scoreTable(table, runDesign, parameters);
    const run = makeRun({ inputs: runInputs({ source: ws.sources[0], design: runDesign, parameters }), source: ws.sources[0], results: s.results, software: g.run.software, name, created: '2026-10-12T12:10:00.000Z' });
    scored.set(run.id, s.results);
    return { ws: addRun(ws, run).ws, run };
  };
  const p = g.run.inputs.parameters;
  const out = [];
  {
    const { ws, run } = rescore(base, { ...p, pseudocount: 1 });
    out.push({ id: 'pseudocount', what: 'the pseudocount 0.5 → 1, scored again', ws, expect: { changes: [`Run 2 was scored: log ratio, wild-type normalization, pseudocount 1, moderated, input ≥ 1 (output SHA-256 ${run.output.sha256.slice(0, 12)}…).`], parameters: ['the pseudocount 0.5 → 1'], design: [], findings: [], moved: true } });
  }
  {
    const { ws, run } = rescore(base, { ...p, filters: { ...p.filters, minInputCount: 10 } });
    out.push({ id: 'filter', what: 'the minimum input count 1 → 10, scored again', ws, expect: { changes: [`Run 2 was scored: log ratio, wild-type normalization, pseudocount 0.5, moderated, input ≥ 10 (output SHA-256 ${run.output.sha256.slice(0, 12)}…).`], parameters: ['the minimum input count 1 → 10'], design: [], findings: [], moved: true } });
  }
  {
    const without = { ...design, replicates: design.replicates.filter((r) => r.id !== 'rep3') };
    const edited = setDesign(base, without, 'Left out Replicate 3');
    const { ws, run } = rescore(edited, p, without);
    out.push({ id: 'replicate', what: 'Replicate 3 left out of the design, scored again', ws, expect: { changes: ['The design: replicate Replicate 3 left out.', `Run 2 was scored: log ratio, wild-type normalization, pseudocount 0.5, moderated, input ≥ 1 (output SHA-256 ${run.output.sha256.slice(0, 12)}…).`], parameters: [], design: ['replicate Replicate 3 left out'], findings: [['outlier-replicate', 'pass', 'na']], moved: true } });
  }
  {
    const ws = setQcThresholds(base, { agreement: { review: 0.9, fail: 0.5 } }, 'Replicate agreement: review below 0.9');
    out.push({ id: 'threshold', what: 'the replicate agreement threshold to review 0.8 → 0.9', ws, expect: { changes: ['The QC threshold "Replicate agreement (Pearson r)": review below 0.8, fail below 0.5 → review below 0.9, fail below 0.5.'], parameters: null, design: null, findings: [['agreement', 'pass', 'review']] } });
  }
  {
    const ws = setDesign(base, { ...design, readout: { ...design.readout, mechanism: 'Gain of function' } }, 'The readout: gain of function');
    out.push({ id: 'design', what: 'the readout\'s mechanism edited (not scored again)', ws, expect: { changes: ['The design: the readout changed (mechanism).'], parameters: null, design: null } });
  }
  return { g, table, base, before: base.checkpoints[0].state, scored, planted: out, analysisState };
}

// The variants a change of a run moved, computed apart: for GRB2 (normalized by the wild type, so
// that a score less the wild type's carries its own error), each variant's effect, p from t on its
// degrees of freedom (normal without), q by Benjamini and Hochberg, its class where q < 0.05; then,
// matched by name, those beyond the earlier 95% interval, of another class, no longer or newly
// scored.
export function movedApart(resultsA, resultsB) {
  const calls = (r) => {
    const c = r.conditions[0];
    const wt = r.controls.wt;
    const n = r.rows;
    const effect = Float64Array.from(c.score, (x) => x - c.score[wt]);
    const p = new Float64Array(n).fill(Number.NaN);
    const scored = Uint8Array.from(c.score, (x, i) => (!c.reason[i] && Number.isFinite(x) ? 1 : 0));
    for (let i = 0; i < n; i += 1) {
      if (!scored[i] || i === wt || !(c.se[i] > 0)) continue;
      const z = effect[i] / c.se[i];
      p[i] = Number.isFinite(c.df?.[i]) ? tTwoSided(z, c.df[i]) : 2 * normalUpper(Math.abs(z));
    }
    const q = adjustBH(p);
    const cls = Array.from(scored, (s, i) => (!s ? 0 : q[i] < 0.05 ? (effect[i] < 0 ? 2 : 3) : 1));
    return { key: r.variants.key, effect, se: c.se, cls };
  };
  const a = calls(resultsA);
  const b = calls(resultsB);
  const row = new Map(b.key.map((k, j) => [k, j]));
  const out = { both: 0, moved: new Set(), crossed: new Set(), filtered: 0, scored: 0 };
  a.key.forEach((k, i) => {
    const j = row.get(k);
    const ca = a.cls[i];
    const cb = j === undefined ? 0 : b.cls[j];
    if (ca && !cb) out.filtered += 1;
    if (!ca && cb) out.scored += 1;
    if (!ca || !cb) return;
    out.both += 1;
    if (Math.abs((b.effect[j] - a.effect[i]) / a.se[i]) > 1.959963984540054) out.moved.add(k);
    if (ca !== cb) out.crossed.add(k);
  });
  return out;
}
