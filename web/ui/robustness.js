// Robustness to analysis choices in the window (wave 4, slice 4; requirement C4): a run repeated
// across other reasonable analysis choices in the score worker (lib/robustness.js), and what it
// says of each variant, difference and position: in the Score view (the run's Robustness pane),
// the inspector (a variant's block) and remote control's `check_robustness`. A check is the
// session's, not the workspace's (as a comparison is): its specifications are seeded, so it is the
// same each time the run is checked, and its record (JSON) names every one.

import { h, icon, downloadBlob, formatCount } from './dom.js';
import { CLASS_NAMES, CONTRAST_CLASS_NAMES, DEFAULT_MAX_SPECIFICATIONS, leastTolerantSentence, methodsSentence, robustnessChoices, robustnessCSV, robustnessJSON, robustnessPositionsCSV, ROBUSTNESS_Q, ROBUSTNESS_SEED, specifications, summarizeRobustness, VERDICT, VERDICT_NAMES } from '../lib/robustness.js';
import { recordedInputs } from '../lib/runs.js';
import { workerInput } from './score-input.js';
import { ensureResults, runEntry } from './run-results.js';
import { selectOnMap } from './selections.js';
import { toast } from './overlays.js';
import { possessive } from '../lib/words.js';

const fmt = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : '—');
const pct = (x) => (Number.isFinite(x) ? `${Math.round(100 * x)}%` : '—');

// A run's check: { status: 'idle' | 'running' | 'done' | 'failed', choices, notes, specs, results,
// summary, progress: [fraction, message], error, job, output (the run's output hash it checked) }.
export function robustnessOf(app, run) {
  app.robustness ??= new Map();
  const kept = app.robustness.get(run.id);
  if (kept && kept.output === run.output.sha256) return kept;
  const fresh = { status: 'idle', output: run.output.sha256, progress: [0, ''], listeners: new Set() };
  app.robustness.set(run.id, fresh);
  return fresh;
}

// What a check of the run would vary: { choices, notes, specs } (its results needed for the
// controls and the replicates' dispersion).
export function plannedChecks(run, results, { max = DEFAULT_MAX_SPECIFICATIONS } = {}) {
  const recorded = recordedInputs(run);
  const { choices, notes } = robustnessChoices(recorded.design, recorded.parameters, results);
  return { choices, notes, specs: choices.length ? specifications(choices, { max, seed: ROBUSTNESS_SEED }) : [] };
}

// Checks a run: recomputes its scores if needed, scores every specification in the score worker,
// and summarizes. Resolves with the state (done, or failed with its error). A run already checked
// (of the size asked, when one is) keeps its check.
export async function checkRobustness(app, run, { max = null } = {}) {
  const state = robustnessOf(app, run);
  if (state.status === 'running') return state.pending;
  if (state.status === 'done' && (max === null || state.max === max)) return state;
  max ??= DEFAULT_MAX_SPECIFICATIONS;
  state.pending = (async () => {
    const entry = runEntry(app, run) ?? await ensureResults(app, run);
    if (!entry?.results) return fail(state, app, entry?.message ?? `${possessive(run.name)} scores could not be recomputed.`);
    const { choices, notes, specs } = plannedChecks(run, entry.results, { max });
    if (!choices.length) return fail(state, app, notes.join(' ') || 'There is nothing to vary in this run\'s analysis.');
    const source = app.store.ws.sources.find((s) => s.sha256 === run.inputs.source.sha256);
    if (!source) return fail(state, app, 'The table the run scored is not in this workspace.');
    Object.assign(state, { status: 'running', choices, notes, specs, max, progress: [0, `Analysis 1 of ${specs.length}`], error: null });
    app.store.notify(['robustness']);
    try {
      const table = await app.sourceTable(source);
      const recorded = recordedInputs(run);
      const { names, barcodes, columns, transfer } = workerInput(table, recorded.design);
      const job = app.worker('score').run('robustness', { names, barcodes, columns, design: recorded.design, parameters: recorded.parameters, mode: recorded.mapping?.mode ?? 'lenient', choices, specs }, {
        transfer,
        onProgress: (fraction, message) => {
          state.progress = [fraction, message];
          for (const f of state.listeners) f();
        },
      });
      state.job = job;
      const results = await job.promise;
      state.job = null;
      const summary = summarizeRobustness(results, choices, entry.results, recorded.design);
      if (summary.error) return fail(state, app, summary.error);
      Object.assign(state, { status: 'done', results, summary, checked: new Date().toISOString() });
      app.log(`${run.name}: robustness checked against ${summary.total - 1} alternative analyses. ${summary.targets.map((t) => `${t.name}: ${t.counts.robust} of ${t.n} robust, ${t.counts.fragile} fragile`).join('; ')}.`);
      app.store.notify(['robustness']);
      return state;
    } catch (error) {
      state.job = null;
      return fail(state, app, error.canceled ? 'Canceled.' : error.message);
    }
  })();
  return state.pending;
}

function fail(state, app, message) {
  Object.assign(state, { status: 'failed', error: message, job: null });
  app.store.notify(['robustness']);
  return state;
}

export function cancelRobustness(app, run) {
  robustnessOf(app, run).job?.cancel();
}

// The check's files: { csv, positions, json } named after the run.
export function robustnessFiles(app, run, state) {
  const base = `${run.name.replace(/[^\w.-]+/g, '_')}_robustness`;
  const results = runEntry(app, run).results;
  return {
    csv: { name: `${base}.csv`, text: robustnessCSV(state.summary, results) },
    positions: { name: `${base}_positions.csv`, text: robustnessPositionsCSV(state.summary) },
    json: { name: `${base}.json`, text: robustnessJSON(state.summary, run, state.results.map(({ kind, picks, label, ok, error }) => ({ kind, picks, label, ok, error })), { name: 'MaveScape', version: app.version, commit: app.commit || null }) },
  };
}

// What each verdict means.
// Each verdict as a query's word (lib/query.js), for the selection it makes on the map.
const VERDICT_QUERY = { [VERDICT.ROBUST]: 'robust', [VERDICT.FRAGILE]: 'fragile', [VERDICT.UNCERTAIN]: 'uncertain', [VERDICT.BORDERLINE]: 'borderline', [VERDICT.SIZE]: 'size-dependent', [VERDICT.INCLUSION]: 'sometimes-scored' };

const VERDICT_HELP = {
  [VERDICT.ROBUST]: 'The same class in every analysis, and scored in every one.',
  [VERDICT.FRAGILE]: 'An analysis moves its effect beyond its 95% interval (and beyond what that choice does to variants in general) and changes its class: its estimate depends on a choice.',
  [VERDICT.UNCERTAIN]: 'Its class changes where its effect stays within its interval but its SE changes by more than half: another account of its uncertainty.',
  [VERDICT.BORDERLINE]: 'Its class changes while its effect and SE barely move: near the threshold.',
  [VERDICT.SIZE]: 'Its class holds, but one choice alone moves its effect beyond its interval.',
  [VERDICT.INCLUSION]: 'The same class wherever it is scored, but not scored under some choices.',
};

const VERDICT_BADGES = [
  [VERDICT.FRAGILE, '.danger'], [VERDICT.UNCERTAIN, '.warn'], [VERDICT.BORDERLINE, ''], [VERDICT.SIZE, '.warn'], [VERDICT.INCLUSION, ''], [VERDICT.ROBUST, '.ok'],
];

// The Score view's pane for a run: what a check would vary and a button; its progress; its
// summary, each single choice's effect, the variants by verdict, the least tolerant positions and
// the files.
export function robustnessPane(app, run, results, view) {
  const state = robustnessOf(app, run);
  const pane = h('div.pane.robustness-pane', h('h3', icon('branch'), 'Robustness to analysis choices'));
  if (run.inputs.parameters?.model === 'published') {
    pane.append(h('p.muted', { style: { margin: 0 } }, 'Published scores are read as published: there is no analysis of theirs to vary.'));
    return pane;
  }
  const planned = plannedChecks(run, results);
  const button = (label) => h('button.btn', { type: 'button', onclick: () => checkRobustness(app, run) }, icon('play'), label);
  if (state.status === 'idle' || state.status === 'failed') {
    pane.append(
      h('p', { style: { margin: '0 0 6px' } }, `Does each variant's conclusion survive other reasonable analysis choices? ${run.name} is scored again ${planned.specs.length - 1} ways: each alternative alone, then ${Math.max(0, planned.specs.length - 1 - planned.specs.filter((s) => s.kind === 'single').length)} combinations of them. For each variant, what changes: its effect, rank, uncertainty, whether it is scored, and its class (lower than, like or higher than the wild type, q < ${ROBUSTNESS_Q}).`),
      h('ul.robustness-choices', ...planned.choices.map((c) => h('li', h('b', c.label), `: ${c.options[0].label} (as run); ${c.options.slice(1).map((o) => o.label).join('; ')}`))),
      ...planned.notes.map((n) => h('p.muted', { style: { fontSize: '11.5px', margin: '2px 0' } }, n)),
      state.status === 'failed' ? h('div.callout.danger', { style: { margin: '6px 0' } }, icon('warning'), h('span', state.error)) : null,
      h('div.btn-row', { style: { marginTop: '8px' } }, planned.choices.length ? button(`Check robustness (${planned.specs.length} analyses)`) : h('span.muted', 'Nothing to vary.')));
    return pane;
  }
  if (state.status === 'running') {
    const bar = h('div', { style: { width: '0%' } });
    const message = h('span.muted', { style: { fontSize: '12px' } });
    const update = () => {
      if (!pane.isConnected && pane.dataset.mounted) {
        state.listeners.delete(update);
        return;
      }
      pane.dataset.mounted = '1';
      bar.style.width = `${Math.round(state.progress[0] * 100)}%`;
      message.textContent = state.progress[1];
    };
    state.listeners.add(update);
    update();
    pane.append(h('div.score-progress', h('div.progress', bar), h('div.btn-row', message, h('span.spacer'), h('button.btn.small', { type: 'button', onclick: () => cancelRobustness(app, run) }, 'Cancel'))));
    return pane;
  }
  // Done.
  const { summary } = state;
  view.robustTarget = Math.min(view.robustTarget ?? 0, summary.targets.length - 1);
  const t = summary.targets[view.robustTarget];
  const names = t.kind === 'contrast' ? CONTRAST_CLASS_NAMES : CLASS_NAMES;
  const singles = state.results.filter((s) => s.kind === 'single').length;
  const rerender = () => app.store.notify(['robustness']);
  const tabs = summary.targets.length > 1 ? h('div.segmented', { style: { margin: '0 0 8px' } }, ...summary.targets.map((x, k) => h(`button${k === view.robustTarget ? '.active' : ''}`, { type: 'button', onclick: () => { view.robustTarget = k; view.robustVerdict = null; rerender(); } }, x.kind === 'contrast' ? x.name : `${x.name}`))) : null;
  const order = VERDICT_BADGES.filter(([v]) => countOf(t, v));
  view.robustVerdict ??= order.find(([v]) => v !== VERDICT.ROBUST)?.[0] ?? VERDICT.ROBUST;
  const badges = h('div.robustness-verdicts', ...order.map(([v, cls]) => h(`button.badge${cls}${view.robustVerdict === v ? '.active' : ''}`, { type: 'button', title: `${VERDICT_HELP[v]} Click to list them below.`, 'aria-pressed': view.robustVerdict === v ? 'true' : 'false', onclick: () => { view.robustVerdict = v; rerender(); } }, `${VERDICT_NAMES[v]}: ${formatCount(countOf(t, v))}`)));
  const files = robustnessFiles(app, run, state);
  const callWord = t.kind === 'contrast' ? 'differences called beyond their uncertainty' : `variants called ${t.classified ? 'lower or higher than the wild type' : ''}`;
  pane.append(
    h('p.muted', { style: { fontSize: '11.5px', margin: '0 0 6px' } }, `${summary.total} analyses: the run as declared, ${singles} alternatives alone, ${summary.total - 1 - singles} combinations${summary.skipped.length ? `; ${summary.skipped.length} could not be scored (${summary.skipped.slice(0, 2).map((s) => s.label).join('; ')}${summary.skipped.length > 2 ? '; …' : ''})` : ''}.`),
    ...(state.notes ?? []).map((n) => h('p.muted', { style: { fontSize: '11.5px', margin: '0 0 4px' } }, n)),
    tabs,
    h('p', { style: { margin: '0 0 4px' } }, `Of ${formatCount(t.n)} ${t.kind === 'contrast' ? 'differences' : 'variants'} the declared analysis ${t.kind === 'contrast' ? 'estimates' : 'scores'}:`),
    badges,
    t.calls.declared ? h('p', { style: { margin: '0 0 4px', fontSize: '12.5px' } }, `Of the ${formatCount(t.calls.declared)} ${callWord}, ${formatCount(t.calls.every)} are called so in every analysis and ${formatCount(t.calls.most)} in 90% of them or more.`) : null,
    t.kind === 'condition' && t.leastTolerant?.size ? h('p', { style: { margin: '0 0 4px', fontSize: '12.5px' } }, leastTolerantSentence(t.leastTolerant)) : null,
    h('details', { style: { margin: '4px 0' } }, h('summary', 'In words'), h('p', { style: { fontSize: '12.5px' } }, t.text)),
    choicesTable(t),
    variantsTable(app, run, results, t, names, view.robustVerdict, summary.total),
    t.kind === 'condition' && t.positions.length ? positionsTable(t, summary.total) : null,
    h('details', { style: { marginTop: '8px' } }, h('summary', 'As the methods would say it'), h('p', { style: { fontSize: '12.5px' } }, methodsSentence(summary))),
    h('div.btn-row', { style: { marginTop: '10px' } },
      h('button.btn', { type: 'button', onclick: () => downloadBlob(new Blob([files.csv.text], { type: 'text/csv' }), files.csv.name) }, icon('download'), 'Variants (CSV)'),
      h('button.btn', { type: 'button', onclick: () => downloadBlob(new Blob([files.positions.text], { type: 'text/csv' }), files.positions.name) }, icon('download'), 'Positions (CSV)'),
      h('button.btn', { type: 'button', onclick: () => downloadBlob(new Blob([files.json.text], { type: 'application/json' }), files.json.name) }, icon('download'), 'Record (JSON)'),
      h('span.spacer'),
      h('button.btn.small', { type: 'button', onclick: () => { app.robustness.delete(run.id); checkRobustness(app, run); } }, 'Check again')));
  return pane;
}

function countOf(t, v) {
  const key = { [VERDICT.ROBUST]: 'robust', [VERDICT.FRAGILE]: 'fragile', [VERDICT.UNCERTAIN]: 'uncertain', [VERDICT.BORDERLINE]: 'borderline', [VERDICT.SIZE]: 'size', [VERDICT.INCLUSION]: 'inclusion' }[v];
  return t.counts[key] ?? 0;
}

// Each alternative alone: the classes it changes (by what changed), the effects it moves while
// their class holds, the variants it drops, how it moves the effects in general (the median |z|)
// and their rank correlation with the declared.
function choicesTable(t) {
  return h('div', { style: { maxHeight: '300px', overflow: 'auto', margin: '8px 0' } }, h('table.data.compact.robustness-choices-table',
    h('thead', h('tr', h('th', 'Alone'), h('th.r', { title: 'Classes changed: its effect moved beyond its interval / its SE changed by more than half / neither' }, 'Classes changed'), h('th.r', { title: 'Effects moved beyond their interval while their class holds' }, 'Sizes'), h('th.r', 'Dropped'), h('th.r', { title: 'The median shift of the effects, in declared SEs' }, 'Typical move'), h('th.r', 'Spearman ρ'))),
    h('tbody', ...t.byChoice.map((x) => h('tr',
      h('td', x.phrase),
      h('td.r', { title: `${x.fragile} moved, ${x.uncertain} by their SE, ${x.borderline} at the threshold` }, x.changed ? `${formatCount(x.changed)} (${x.fragile} · ${x.uncertain} · ${x.borderline})` : '0'),
      h('td.r', formatCount(x.size)),
      h('td.r', formatCount(x.dropped)),
      h('td.r', Number.isFinite(x.typicalMove) ? `${fmt(x.typicalMove, 2)} SE` : '—'),
      h('td.r', fmt(x.rho, 3)))))));
}

// The variants of one verdict (the first 100), each with what it depends on.
function variantsTable(app, run, results, t, names, verdict, total) {
  const rows = [];
  for (let i = 0; i < results.rows; i += 1) if (t.verdict[i] === verdict) rows.push(i);
  rows.sort((a, b) => t.agree[a] - t.agree[b] || Math.abs(t.effect[b] / t.se[b]) - Math.abs(t.effect[a] / t.se[a]));
  const condition = t.kind === 'condition' ? Math.max(0, results.conditions.findIndex((c) => `condition:${c.id}` === t.id)) : 0;
  if (!rows.length) return h('p.muted', { style: { margin: '4px 0' } }, `No variant is ${VERDICT_NAMES[verdict]}.`);
  // On the map (wave 4, slice 5): the condition's, or the contrast's differential map, selected by
  // the verdict's query word.
  const contrast = t.kind === 'contrast' ? results.differential.findIndex((d) => `contrast:${d.id ?? d.name}` === t.id) : null;
  const toMap = async () => {
    const { offMap } = await selectOnMap(app, run, { rows, condition, contrast, query: VERDICT_QUERY[verdict] });
    if (offMap) toast(`${formatCount(offMap)} of them are not on the map (not single substitutions).`);
  };
  return h('div',
    h('div.btn-row', { style: { margin: '10px 0 4px' } }, h('h4', { style: { margin: 0 } }, `${VERDICT_NAMES[verdict][0].toUpperCase()}${VERDICT_NAMES[verdict].slice(1)} (${formatCount(rows.length)})`), h('span.spacer'),
      h('button.btn.small', { type: 'button', title: `Select them on the map: the query "${VERDICT_QUERY[verdict]}"`, onclick: toMap }, icon('heatmap'), 'Select on the map')),
    h('div', { style: { maxHeight: '280px', overflow: 'auto' } }, h('table.data.compact', h('thead', h('tr', h('th', 'Variant'), h('th', 'Class'), h('th.r', 'Effect'), h('th.r', 'Across analyses'), h('th.r', 'Class kept'), h('th', verdict === VERDICT.INCLUSION ? 'Left out by' : 'Depends on'))),
      h('tbody', ...rows.slice(0, 100).map((i) => h('tr', { style: { cursor: 'pointer' }, onclick: () => app.focusItem({ kind: 'variant', id: results.variants.key[i], run: run.id, condition }) },
        h('td.mono', results.variants.original[i]),
        h('td', names[t.cls[i]]),
        h('td.r', `${fmt(t.effect[i], 2)} ± ${fmt(t.se[i], 2)}`),
        h('td.r', `${fmt(t.effectMin[i], 2)} to ${fmt(t.effectMax[i], 2)}`),
        h('td.r', `${t.agree[i]} of ${total}`),
        h('td', { style: { fontSize: '11.5px' } }, (t.dependsOn[i] ?? t.droppedBy[i] ?? []).slice(0, 3).join('; '))))))),
    rows.length > 100 ? h('p.muted', { style: { fontSize: '11.5px' } }, `The first 100 shown; all ${formatCount(rows.length)} are in the variants exported (CSV).`) : null);
}

// The least tolerant positions of the declared analysis, and how they rank in the others.
function positionsTable(t, total) {
  const least = t.positions.filter((x) => t.leastTolerant.positions.includes(x.position)).sort((a, b) => a.rank - b.rank);
  return h('div',
    h('h4', { style: { margin: '10px 0 4px' } }, 'The least tolerant positions'),
    h('table.data.compact', h('thead', h('tr', h('th', 'Position'), h('th.r', 'Median effect'), h('th.r', 'Across analyses'), h('th.r', 'Rank (0: least function)'), h('th.r', 'Among the least tolerant tenth'))),
      h('tbody', ...least.map((x) => h('tr', h('td', `${x.residue}${x.position}${x.reference !== x.position ? ` (${x.reference})` : ''}`), h('td.r', fmt(x.effect, 2)), h('td.r', `${fmt(x.effectMin, 2)} to ${fmt(x.effectMax, 2)}`), h('td.r', `${fmt(x.rank, 2)} (${fmt(x.rankMin, 2)}–${fmt(x.rankMax, 2)})`), h('td.r', `${x.leastTolerantIn} of ${x.analyses}`))))),
    h('p.muted', { style: { fontSize: '11.5px', margin: '4px 0 0' } }, `A position's effect is the median of its substitutions' (as the map's position effect), ranked among the ${t.positions.length} positions in each analysis. Every position is in the positions exported (CSV).`));
}

// A variant's block in the inspector, when its run has been checked: its class across the
// analyses, its effect's range, and its verdict with what it depends on. condition: the
// condition shown (its target), with any contrast's.
export function robustnessBlock(app, run, row, condition = 0) {
  const state = app.robustness?.get(run.id);
  if (state?.status !== 'done' || state.output !== run.output.sha256) return null;
  const results = runEntry(app, run)?.results;
  if (!results) return null;
  const targets = state.summary.targets.filter((t) => t.kind === 'contrast' || t.id === `condition:${results.conditions[condition]?.id}`);
  const lines = targets.filter((t) => t.cls[row] || t.scoredIn[row]).map((t) => {
    const names = t.kind === 'contrast' ? CONTRAST_CLASS_NAMES : CLASS_NAMES;
    const why = t.dependsOn[row] ?? t.droppedBy[row];
    return h('li', h('b', `${t.kind === 'contrast' ? t.name : 'Its class'}: `), `${names[t.cls[row]]} in ${t.agree[row]} of ${state.summary.total} analyses; scored in ${t.scoredIn[row]}; effect ${fmt(t.effectMin[row], 2)} to ${fmt(t.effectMax[row], 2)} across them (rank ${pct(t.rankMin[row])}–${pct(t.rankMax[row])}). ${VERDICT_NAMES[t.verdict[row]][0].toUpperCase()}${VERDICT_NAMES[t.verdict[row]].slice(1)}${why?.length ? `: ${why.slice(0, 3).join('; ')}` : ''}.`);
  });
  if (!lines.length) return null;
  return [h('h4.inspector-sub', 'Robustness'), h('ul.summary-lines', { style: { fontSize: '12px' } }, ...lines)];
}

