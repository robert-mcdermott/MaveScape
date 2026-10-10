// The analysis as steps (the workflow strip above the views): what a workspace has, what it lacks,
// and the one next action. Pure: from the workspace and what the session has seen (QC computed
// for a run, its map opened), so that it is tested in Node.
//
//   counts → target → design → score → QC → map → record
//
// Each step: { id, label, state, detail, action }. state: 'done', 'next' (the first step to do),
// 'attention' (something blocks it, said in detail), 'todo' (after the next one), 'optional'.
// action: { kind: 'open' | 'open-fasta' | 'draft' | 'mode' | 'focus' | 'export', mode?, label }.

import { validateDesign } from './design.js';
import { canonicalJSON } from './workspace.js';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// The table the design describes (or the first one), and the runs made from it with the current
// design.
export function currentSource(ws) {
  return ws.sources.find((s) => s.id === ws.designSource) ?? ws.sources[0] ?? null;
}

export function currentRun(ws) {
  const source = currentSource(ws);
  if (!source || !ws.design) return null;
  const design = canonicalJSON(ws.design);
  return ws.runs.filter((r) => r.inputs.source.sha256 === source.sha256 && canonicalJSON(r.inputs.design) === design).at(-1) ?? null;
}

// seen: { qc: Map(run id → overall { status, counts }), map: Set(run id) }.
export function workflowSteps(ws, seen = {}) {
  const qcSeen = seen.qc ?? new Map();
  const mapSeen = seen.map ?? new Set();
  const source = currentSource(ws);
  const steps = [];
  const add = (step) => steps.push({ state: 'todo', action: null, ...step });

  // 1. The counts.
  const countColumns = source?.mapping?.countColumns?.length ?? 0;
  const blocking = source?.problems?.blocking ?? [];
  if (!source) {
    const target = ws.targets[0];
    add({ id: 'counts', label: 'Counts', state: 'next', detail: target ? `Now open the count table whose variants are named on ${target.name}: one row per variant, one column per sequenced sample.` : 'Open a count table: one row per variant, one column per sequenced sample (the Start page has a blank layout and two examples).', action: { kind: 'open', label: 'Open the counts' } });
  } else if (!countColumns) {
    add({ id: 'counts', label: 'Counts', state: 'attention', detail: source.layout === 'mavedb-scores' ? `${source.name} holds scores, not counts. MaveScape scores from counts; showing imported scores on the map comes in 0.3. If the counts were published (MaveDB offers them beside the scores when the authors provided them), open those.` : `${source.name} has no columns of counts. MaveScape scores from counts: one column per sequenced sample, with the variants' names in another.`, action: { kind: 'open', label: 'Open a count table' } });
  } else if (blocking.length) {
    add({ id: 'counts', label: 'Counts', state: 'attention', detail: `${plural(blocking.length, 'problem')} in ${source.name} block scoring: ${blocking[0]}`, action: { kind: 'focus', label: 'See the problems' } });
  } else {
    add({ id: 'counts', label: 'Counts', state: 'done', detail: `${source.name}: ${source.summary?.total ?? source.rows} variants, ${plural(countColumns, 'count column')}` });
  }

  // 2. The target.
  const target = ws.targets.find((t) => t.id === (ws.design?.targets?.[0]?.id ?? source?.target)) ?? (source ? null : ws.targets[0]);
  if (target) add({ id: 'target', label: 'Target', state: 'done', detail: `${target.name}, ${target.sequence.length} ${target.sequenceType === 'dna' ? 'nt' : 'residues'}` });
  else add({ id: 'target', label: 'Target', state: source ? 'attention' : 'todo', detail: 'Open the target\'s sequence (FASTA): variant names are checked against it, and the map is drawn on it.', action: { kind: 'open-fasta', label: 'Open the FASTA' } });

  // 3. The design.
  const countsReady = source && countColumns && !blocking.length;
  if (!countsReady) {
    add({ id: 'design', label: 'Design', detail: 'Which column is which sample: after the counts.' });
  } else if (!ws.design) {
    add({ id: 'design', label: 'Design', state: 'next', detail: `Say which column is which sample. MaveScape drafts the design from the column names${source.roleSuggestions?.length ? ` (it suggested roles for ${plural(source.roleSuggestions.length, 'column')})` : ''}; check it in the Experiment view.`, action: { kind: 'draft', label: 'Draft the design' } });
  } else {
    const result = validateDesign(ws.design, { columns: (source.columns ?? []).map((c) => c.name) });
    if (!result.ok) add({ id: 'design', label: 'Design', state: 'attention', detail: `${plural(result.errors.length, 'problem')} in the design: ${result.errors[0].message}`, action: { kind: 'mode', mode: 'experiment', label: 'Fix it in Experiment' } });
    else add({ id: 'design', label: 'Design', state: 'done', detail: `${ws.design.model.replace('-', ' ')}, ${plural(ws.design.replicates.length, 'replicate')}` });
  }

  // 4. The score.
  const designReady = steps.at(-1).state === 'done';
  const run = currentRun(ws);
  if (!designReady) {
    add({ id: 'score', label: 'Score', detail: 'Scores with standard errors: after the design.' });
  } else if (ws.design.model === 'scores') {
    add({ id: 'score', label: 'Score', state: 'attention', detail: 'This design holds precomputed scores: there is nothing to score.', action: { kind: 'mode', mode: 'qc', label: 'Open QC' } });
  } else if (!run) {
    const stale = ws.runs.length > 0;
    add({ id: 'score', label: 'Score', state: stale ? 'attention' : 'next', detail: stale ? 'The design or the table changed since the last run: score again (earlier runs are kept).' : 'Score the counts with MaveScape\'s defaults, or choose the normalization, filters and replicate combination first.', action: { kind: 'mode', mode: 'score', label: stale ? 'Score again' : 'Score' } });
  } else {
    const scored = run.output.conditions.map((c) => c.scored).join(' / ');
    add({ id: 'score', label: 'Score', state: 'done', detail: `${run.name}: ${scored} of ${run.output.variants} variants scored` });
  }

  // 5. Quality control, 6. the map, 7. the record: once scored.
  if (!run) {
    add({ id: 'qc', label: 'QC', detail: 'Whether the experiment supports the scores: after scoring (QC reads the counts as soon as the design is set).', action: designReady ? { kind: 'mode', mode: 'qc', label: 'Open QC' } : null });
    add({ id: 'map', label: 'Map', detail: 'The variant-effect map: after scoring.' });
    add({ id: 'record', label: 'Record', state: 'optional', detail: 'Exports and the workspace archive: after scoring.' });
  } else {
    const overall = qcSeen.get(run.id);
    if (overall) add({ id: 'qc', label: 'QC', state: 'done', detail: overall.status === 'pass' ? 'Every finding passes' : `${overall.counts.fail} fail, ${overall.counts.review} to review: read why before trusting the scores`, verdict: overall.status, action: { kind: 'mode', mode: 'qc', label: 'Open QC' } });
    else add({ id: 'qc', label: 'QC', state: 'next', detail: 'Read the quality-control findings: depth, coverage, replicate agreement, bottlenecks, the controls.', action: { kind: 'mode', mode: 'qc', label: 'Read the findings' } });
    if (mapSeen.has(run.id)) add({ id: 'map', label: 'Map', state: 'done', detail: 'Explored; click a cell for its evidence', action: { kind: 'mode', mode: 'map', label: 'Open the map' } });
    else add({ id: 'map', label: 'Map', detail: 'Explore the scores by position and substitution; click a variant for its evidence.', action: { kind: 'mode', mode: 'map', label: 'Open the map' } });
    add({ id: 'record', label: 'Record', state: 'optional', detail: 'Export the scores (MaveDB columns), the methods and references, or the whole workspace as one archive.', action: { kind: 'export', label: 'Export…' } });
  }

  // The next step: the first that is not done (an attention step counts; optional ones do not).
  const first = steps.find((s) => s.state !== 'done' && s.state !== 'optional');
  if (first && first.state === 'todo') first.state = 'next';
  return steps;
}

// The step to show in full: the first needing attention, else the next one, else the record.
export function focusStep(steps) {
  return steps.find((s) => s.state === 'attention') ?? steps.find((s) => s.state === 'next') ?? steps.find((s) => s.id === 'record');
}
