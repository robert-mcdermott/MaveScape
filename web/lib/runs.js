// Score runs (requirement S4): immutable records of what was scored, how, by what, and what came
// out. A run's id is the SHA-256 of its canonical inputs (the table's SHA-256, the mapping, the
// design, the parameters, the scoring version), so the same inputs always make the same id and a
// run is never edited, only added or removed. Its output is hashed too: the scores are not stored
// in the workspace but recomputed from the inputs when needed, and the recomputed output must
// have the recorded hash (reproduced, or the run says it was not).

import { canonicalJSON, change } from './workspace.js';
import { sha256 } from './sha256.js';
import { SCORING_VERSION, withDefaults, RESCALINGS } from './score.js';
import { NORMALIZATIONS } from './score-ratio.js';
import { COMBINATIONS } from './replicates.js';
import { describeFilters } from './filters.js';

const encoder = new TextEncoder();
const hash = (value) => sha256(encoder.encode(canonicalJSON(value)));

// The canonical inputs of a run. source: the workspace source (its sha256, rows, mapping).
export function runInputs({ source, design, parameters }) {
  const m = source.mapping ?? {};
  return {
    source: { sha256: source.sha256, rows: source.rows ?? null, files: (source.files ?? []).map((f) => f.sha256) },
    mapping: { variantColumn: design.variants.column, level: design.variants.level, mode: m.mode ?? 'lenient', absentMeans: m.absentMeans ?? null, derivedNames: m.derivedNames ?? null },
    design,
    parameters: withDefaults(parameters),
    scoring: SCORING_VERSION,
  };
}

export function runId(inputs) {
  return `run-${hash(inputs).slice(0, 16)}`;
}

const list = (typed) => Array.from(typed, (x) => (Number.isFinite(x) ? x : null));

// What a run's output is, for its hash: every variant's key, each replicate's scores, SEs and
// states, and each condition's scores, SEs, replicates used, reasons and flags. Numbers in
// JavaScript's shortest round-trip form; NaN as null.
export function outputDigest(results) {
  return hash({
    format: results.format,
    version: results.version,
    keys: results.variants.key,
    replicates: results.replicates.map((r) => ({ id: r.id, normalizers: r.normalizers, score: list(r.score), se: list(r.se), state: Array.from(r.state) })),
    conditions: results.conditions.map((c) => ({ id: c.id, score: list(c.score), se: list(c.se), k: Array.from(c.k), reason: Array.from(c.reason), flags: Array.from(c.flags), rescale: c.rescale })),
  });
}

// The record kept in the workspace. software: { version, commit }.
export function makeRun({ inputs, source, results, software, name, created = new Date().toISOString() }) {
  return {
    id: runId(inputs),
    name,
    created,
    software: { name: 'MaveScape', version: software.version, commit: software.commit || null, scoring: SCORING_VERSION },
    inputs: { ...inputs, source: { ...inputs.source, id: source.id, name: source.name, fileName: source.fileName ?? source.name } },
    seed: null,
    output: {
      sha256: outputDigest(results),
      variants: results.rows,
      replicates: results.replicates.map((r) => ({ id: r.id, normalizers: r.normalizers, synonymousMedian: r.synonymousMedian ?? null })),
      conditions: results.conditions.map((c) => ({ id: c.id, name: c.name, replicates: c.replicates, scored: c.scored, flow: c.flow, rescale: c.rescale, combinedFromAll: c.combinedFromAll })),
    },
    warnings: results.warnings,
    info: results.info,
  };
}

// The inputs of a run as they were recorded (for running it again): without the source's
// workspace fields.
export function recordedInputs(run) {
  const { id, name, fileName, ...source } = run.inputs.source;
  return { ...run.inputs, source };
}

export function addRun(ws, run) {
  if (ws.runs.some((r) => r.id === run.id)) return { ws, existing: true };
  const conditions = run.output.conditions.map((c) => `${run.output.conditions.length > 1 ? `${c.name}: ` : ''}${c.scored} of ${run.output.variants} scored`).join('; ');
  const detail = `Scored ${run.inputs.source.name} (${run.id}): ${describeParameters(run.inputs.parameters)}; ${conditions}; output SHA-256 ${run.output.sha256.slice(0, 12)}…`;
  return { ws: change(ws, { runs: [...ws.runs, run] }, 'score', detail), existing: false };
}

export function removeRun(ws, id) {
  const run = ws.runs.find((r) => r.id === id);
  if (!run) return ws;
  return change(ws, { runs: ws.runs.filter((r) => r.id !== id) }, 'remove-run', `Removed the score run ${run.name} (${run.id})`);
}

// One line of parameters, for lists and the history.
export function describeParameters(parameters) {
  const p = withDefaults(parameters);
  const f = p.filters;
  const regression = p.model !== 'ratio';
  const parts = [
    `${regression ? `${p.model.toUpperCase()} on time` : 'log ratio'}, ${p.normalization === 'wt' ? 'wild-type' : p.normalization === 'synonymous' ? 'synonymous-median' : `${p.normalization}-library`} normalization`,
    `pseudocount ${p.pseudocount}`,
    p.combination === 'reml' ? 'REML' : p.combination === 'fixed' ? 'fixed effects' : 'Enrich2\'s estimator',
  ];
  if (regression) {
    parts.push(p.regressionSE === 'residual' ? 'residual-scaled SE' : 'SE at least counting\'s');
    parts.push(f.minTimePoints === 'all' ? 'every time point' : `time points ≥ ${f.minTimePoints}`);
  }
  if (f.minInputCount) parts.push(`input ≥ ${f.minInputCount}`);
  if (f.minTotalCount) parts.push(`total ≥ ${f.minTotalCount}`);
  if (f.minReplicates !== 1) parts.push(f.minReplicates === 'all' ? 'scored in every replicate' : `replicates ≥ ${f.minReplicates}`);
  if (f.maxSE !== null) parts.push(`SE ≤ ${f.maxSE}`);
  if (f.excludeKinds.length) parts.push(`without ${f.excludeKinds.join(', ')}`);
  if (f.exclude.length) parts.push(`${f.exclude.length} excluded`);
  if (p.rescale !== 'none') parts.push(`rescaled: ${RESCALINGS[p.rescale].label}`);
  return parts.join(', ');
}

// A regression's method in one sentence (also the methods paragraph's).
export function regressionSentence(p, citation) {
  const f = p.filters;
  return `Scores are the slopes of ${p.model === 'wls' ? 'a weighted' : 'an ordinary'} least-squares regression of each variant's natural-log count, normalized by the ${NORMALIZATIONS[p.normalization]}, on time scaled to 0–1 (${citation}), with a pseudocount of ${p.pseudocount}${p.model === 'wls' ? ' and weights 1/(1/(c + p) + 1/r) for a count c, the pseudocount p and the sample\'s normalizer r' : ''}; a variant was fitted on the time points where it was counted, ${f.minTimePoints === 'all' ? 'all of them required' : `its first and at least ${f.minTimePoints} in all`}; each replicate's SE is the slope's standard error scaled by the residuals${p.regressionSE === 'residual' ? '' : ', and never below what counting alone predicts'}.`;
}

// The run's method in sentences (the methods paragraph of slice 8 builds on it).
export function describeMethod(run) {
  const p = withDefaults(run.inputs.parameters);
  const design = run.inputs.design;
  const lines = [];
  if (p.model === 'ratio') lines.push(`Scores are natural-log ratios of each variant's frequency after selection to before${design.model === 'time-series' ? ' (the first and last time points)' : ''}, normalized by the ${NORMALIZATIONS[p.normalization]}, with a pseudocount of ${p.pseudocount}; each replicate's SE is the square root of the sum of the reciprocal counts${p.normalization === 'synonymous' ? '' : ' and normalizers'} (Rubin et al. 2017).`);
  else lines.push(regressionSentence(p, 'Rubin et al. 2017'));
  lines.push(`Biological replicates were scored separately and combined by ${COMBINATIONS[p.combination]}${p.combination === 'enrich2' ? ' (Enrich2 2.0.2\'s random-effects estimator, 50 iterations)' : p.combination === 'reml' ? ' (Fisher scoring as metafor\'s REML)' : ''}; technical replicates were summed before scoring.`);
  lines.push(`Filters, in order: ${describeFilters(p.filters, null, p.model !== 'ratio').filter((x) => x.active !== false).map((x) => x.text.toLowerCase()).join('; ')}.`);
  if (p.rescale !== 'none') lines.push(`Scores were rescaled so that ${RESCALINGS[p.rescale].label}.`);
  lines.push(`MaveScape ${run.software.version}${run.software.commit ? ` (${run.software.commit.slice(0, 7)})` : ''}, scoring version ${run.software.scoring}; run ${run.id}, output SHA-256 ${run.output.sha256}.`);
  return lines;
}
