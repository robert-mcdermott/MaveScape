// The Score view (wave 1, slice 5): functional scores with standard errors from the counts and the
// design. Parameters and the ordered filters are in plain view; each run is immutable, kept with
// everything needed to repeat it (lib/runs.js), and checked when reopened: its scores are
// recomputed in the score worker and must have the output hash the run recorded (requirements
// S1–S5, S11, V7). Results: the filter flow, the scores by variant class, each replicate, and
// every variant with its evidence.

import { h, icon, clear, formatCount } from './dom.js';
import { confirmDialog, toast } from './overlays.js';
import { validateDesign } from '../lib/design.js';
import { checkParameters, DEFAULT_PARAMETERS, PRESETS, RESCALINGS, withDefaults } from '../lib/score.js';
import { NORMALIZATIONS, median } from '../lib/score-ratio.js';
import { COMBINATIONS } from '../lib/replicates.js';
import { flagNames, REPLICATE_STATE_NAMES, STAGE_BY_CODE, STAGE_BY_ID } from '../lib/filters.js';
import { addRun, describeMethod, describeParameters, makeRun, outputDigest, recordedInputs, removeRun, runId, runInputs } from '../lib/runs.js';
import { canonicalJSON } from '../lib/workspace.js';
import { KIND_NAMES } from '../lib/variants.js';
import { classHistogram, flowBars, scoreGroups } from './plots.js';
import { workerInput } from './score-input.js';

const PAGE = 50;
const fmt = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : '—');

export function mountScoreMode(app, container) {
  const { store } = app;
  const root = h('div.view');
  container.append(root);
  app.scoreDrafts ??= new Map();
  app.runResults ??= new Map();
  // The view's own state (not the analysis): the run shown, its condition, the variant table.
  const view = { condition: 0, search: '', show: 'all', sort: { key: 'row', dir: 1 }, page: 0, open: -1, refused: null, job: null, progress: [0, ''] };

  const source = () => store.ws.sources.find((s) => s.id === (store.ws.designSource ?? store.ws.sources[0]?.id)) ?? null;

  // --- Parameters (a draft per workspace, until it is run) ----------------------------------
  function draft() {
    const ws = store.ws;
    if (!app.scoreDrafts.has(ws.id)) {
      const last = ws.runs.at(-1)?.inputs.parameters;
      const hasWildType = (source()?.summary?.byKind?.['wild type'] ?? 0) > 0;
      app.scoreDrafts.set(ws.id, withDefaults(last ?? { ...DEFAULT_PARAMETERS, normalization: hasWildType ? 'wt' : 'complete' }));
    }
    return app.scoreDrafts.get(ws.id);
  }
  function setDraft(patch, filters = null) {
    const current = draft();
    replaceDraft({ ...current, ...patch, filters: { ...current.filters, ...(filters ?? {}) } });
  }
  function replaceDraft(parameters) {
    app.scoreDrafts.set(store.ws.id, withDefaults(parameters));
    view.refused = null;
    render();
  }
  // The preset parameters match, whatever the normalization (each preset keeps the one chosen).
  const presetOf = (p) => Object.entries(PRESETS).find(([, preset]) => canonicalJSON(withDefaults({ ...preset.parameters, normalization: p.normalization })) === canonicalJSON(withDefaults(p)))?.[0] ?? null;

  // --- Readiness ------------------------------------------------------------------------------
  function readiness() {
    const s = source();
    const design = store.ws.design;
    if (!s) return { ok: false, problems: ['Open a count table first.'] };
    if (!design) return { ok: false, problems: ['Set the design in the Experiment view: which columns are inputs and outputs, of which replicates.'], experiment: true };
    const problems = [];
    const result = validateDesign(design, { columns: s.columns.map((c) => c.name) });
    for (const e of result.errors.slice(0, 4)) problems.push(`The design: ${e.message}`);
    if (result.errors.length > 4) problems.push(`…and ${result.errors.length - 4} more problems in the design.`);
    for (const m of s.problems?.blocking ?? []) problems.push(`The table: ${m}`);
    problems.push(...checkParameters(draft(), design).errors);
    return { ok: !problems.length, problems, warnings: result.warnings.map((w) => w.message), experiment: result.errors.length > 0 };
  }

  // --- Running ----------------------------------------------------------------------------------
  async function compute(table, design, parameters, mode) {
    const { names, columns, transfer } = workerInput(table, design);
    const job = app.worker('score').run('score', { names, columns, design, parameters, mode }, { transfer, onProgress: (fraction, message) => { view.progress = [fraction, message]; renderProgress(); } });
    view.job = job;
    renderProgress();
    try {
      return await job.promise;
    } finally {
      view.job = null;
    }
  }

  async function runScoring() {
    const s = source();
    const design = store.ws.design;
    const parameters = draft();
    const inputs = runInputs({ source: s, design, parameters });
    const id = runId(inputs);
    const existing = store.ws.runs.find((r) => r.id === id);
    if (existing) {
      app.focusItem({ kind: 'run', id });
      toast(`${existing.name} has the same table, design and parameters: it is shown (a run is never computed twice).`);
      return;
    }
    view.refused = null;
    const wsId = store.ws.id;
    store.setBusy?.('score', 'Scoring…');
    let result;
    try {
      const table = await app.sourceTable(s);
      result = await compute(table, design, parameters, s.mapping?.mode ?? 'lenient');
    } catch (error) {
      if (!/cancel/i.test(error.message)) {
        view.refused = [error.message];
        app.log(`Scoring failed: ${error.message}`);
      }
      render();
      return;
    } finally {
      store.setBusy?.('score', null);
    }
    if (store.ws.id !== wsId) return;
    if (!result.ok) {
      view.refused = result.errors;
      app.log(`Scoring refused: ${result.errors.join(' ')}`);
      render();
      return;
    }
    const n = store.ws.runs.length + 1;
    const run = makeRun({ inputs, source: s, results: result.results, software: { version: app.version, commit: app.commit }, name: `Run ${n}` });
    app.runResults.set(run.id, { results: result.results, status: 'computed' });
    const added = addRun(store.ws, run);
    store.commit(added.ws, `Score: ${run.name}`);
    view.condition = 0;
    view.page = 0;
    view.open = -1;
    app.focusItem({ kind: 'run', id: run.id });
    const c = result.results.conditions;
    app.log(`${run.name} (${run.id}): ${c.map((x) => `${x.scored} of ${result.results.rows} scored${c.length > 1 ? ` in ${x.name}` : ''}`).join('; ')}; output SHA-256 ${run.output.sha256.slice(0, 12)}…`);
    toast(`${run.name}: ${formatCount(c[0].scored)} of ${formatCount(result.results.rows)} variants scored.`, { kind: 'ok' });
  }

  // A saved run's scores, recomputed from its own recorded inputs, and checked against its output
  // hash.
  async function reproduce(run) {
    if (app.runResults.has(run.id)) return;
    app.runResults.set(run.id, { status: 'checking' });
    render();
    const recorded = recordedInputs(run);
    const s = store.ws.sources.find((x) => x.sha256 === recorded.source.sha256);
    if (!s) {
      app.runResults.set(run.id, { status: 'failed', message: `The table it scored (SHA-256 ${recorded.source.sha256.slice(0, 12)}…) is not in this workspace.` });
      render();
      return;
    }
    try {
      const table = await app.sourceTable(s);
      const result = await compute(table, recorded.design, recorded.parameters, recorded.mapping.mode);
      if (!result.ok) throw new Error(result.errors.join(' '));
      const digest = outputDigest(result.results);
      const same = digest === run.output.sha256;
      app.runResults.set(run.id, { results: result.results, status: same ? 'reproduced' : 'differs', message: same ? '' : `The recomputed scores have output SHA-256 ${digest.slice(0, 12)}…, not ${run.output.sha256.slice(0, 12)}… as recorded (MaveScape ${run.software.version} made it; this is ${app.version}).` });
      if (!same) app.log(`${run.name}: recomputed scores differ from the recorded ones (output SHA-256 ${digest} for ${run.output.sha256}).`);
    } catch (error) {
      app.runResults.set(run.id, { status: 'failed', message: error.message });
    }
    if (store.ws.runs.some((r) => r.id === run.id)) render();
  }

  // --- Panes ------------------------------------------------------------------------------------
  function select(label, value, options, onChange) {
    const el = h('select.input', { 'aria-label': label, onchange: () => onChange(el.value) }, ...options.map(([v, text]) => h('option', { value: v, selected: v === value }, text)));
    return h('label.field', h('span', label), el);
  }
  function number(label, value, onChange, attrs = {}) {
    const el = h('input.input', { type: 'number', value: value ?? '', ...attrs, 'aria-label': label, onchange: () => onChange(el.value.trim() === '' ? null : Number(el.value)) });
    return h('label.field', h('span', label), el);
  }

  function parametersPane() {
    const p = draft();
    const preset = presetOf(p);
    return h('div.pane', h('h3', icon('settings'), 'Parameters'),
      h('div.field', h('span', 'Start from'), h('div.segmented', { role: 'group', 'aria-label': 'Preset' },
        ...Object.entries(PRESETS).map(([id, x]) => h(`button${preset === id ? '.active' : ''}`, { type: 'button', 'aria-pressed': preset === id ? 'true' : 'false', title: id === 'enrich2' ? 'Enrich2 2.0.2\'s "ratios": no count filter, variants combined only when scored in every replicate, its random-effects estimator (50 iterations)' : 'Variants with no input reads left out; REML random effects to convergence', onclick: () => replaceDraft({ ...x.parameters, normalization: p.normalization }) }, x.label))),
        preset ? null : h('span.muted', { style: { fontSize: '11.5px' } }, 'Custom parameters')),
      select('Normalization', p.normalization, Object.entries(NORMALIZATIONS).map(([k, v]) => [k, v[0].toUpperCase() + v.slice(1)]), (v) => setDraft({ normalization: v })),
      h('div.form-grid',
        number('Pseudocount', p.pseudocount, (v) => setDraft({ pseudocount: v ?? 0.5 }), { min: 0, step: 0.1 }),
        select('Replicates combined by', p.combination, Object.entries(COMBINATIONS).map(([k, v]) => [k, v[0].toUpperCase() + v.slice(1)]), (v) => setDraft({ combination: v }, v === 'enrich2' ? { minReplicates: 'all' } : null))),
      select('Rescaling', p.rescale, Object.entries(RESCALINGS).map(([k, v]) => [k, v.label[0].toUpperCase() + v.label.slice(1)]), (v) => setDraft({ rescale: v })),
      h('p.muted', { style: { fontSize: '11.5px', margin: '2px 0 0' } }, 'Scores are natural-log ratios of frequencies after and before selection; technical replicates are summed first, biological replicates scored separately and then combined.'));
  }

  function filtersPane() {
    const p = draft();
    const f = p.filters;
    const s = source();
    const kinds = Object.keys(s?.summary?.byKind ?? {}).filter((k) => k !== 'none');
    const exclude = h('textarea.input', { rows: 2, placeholder: 'One identifier per line', 'aria-label': 'Variants excluded by name', onchange: () => setDraft({}, { exclude: exclude.value.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean) }) }, f.exclude.join('\n'));
    const all = f.minReplicates === 'all';
    const stage = (n, title, control, rule = false) => h('li.filter-stage', h('span.filter-step', String(n)), h('div', h('div.filter-title', title, rule ? h('span.badge', { style: { marginLeft: '6px' } }, 'always') : null), control));
    return h('div.pane', h('h3', icon('filter'), 'Filters, in order'),
      h('ol.filter-bar',
        stage(1, 'Counted in every sample of a replicate', null, true),
        stage(2, 'Identifier valid against the target', null, true),
        stage(3, 'Variant classes scored', h('div.btn-row', { style: { marginTop: '4px' } }, ...kinds.map((k) => {
          const out = f.excludeKinds.includes(k);
          return h(`button.chip${out ? '' : '.active'}`, { type: 'button', 'aria-pressed': out ? 'false' : 'true', title: out ? `${k}: left out` : `${k}: scored`, onclick: () => setDraft({}, { excludeKinds: out ? f.excludeKinds.filter((x) => x !== k) : [...f.excludeKinds, k] }) }, k);
        }))),
        stage(4, 'Exclusion list', exclude),
        stage(5, 'Minimum input count, per replicate', number('Minimum input count', f.minInputCount, (v) => setDraft({}, { minInputCount: v ?? 0 }), { min: 0, step: 1 })),
        stage(6, 'Minimum total count, per replicate', number('Minimum total count', f.minTotalCount, (v) => setDraft({}, { minTotalCount: v ?? 0 }), { min: 0, step: 1 })),
        stage(7, 'Minimum usable replicates', h('div.btn-row',
          all ? h('span', 'All the variant\'s replicates') : number('Minimum usable replicates', f.minReplicates, (v) => setDraft({}, { minReplicates: Math.max(1, Math.round(v ?? 1)) }), { min: 1, step: 1 }),
          h('label', { style: { fontSize: '12px' } }, h('input', { type: 'checkbox', checked: all, onchange: (e) => setDraft({}, { minReplicates: e.target.checked ? 'all' : 1 }) }), ' all'))),
        stage(8, 'Maximum SE', number('Maximum SE (blank: none)', f.maxSE, (v) => setDraft({}, { maxSE: v }), { min: 0, step: 0.05, placeholder: 'none' }))),
      h('p.muted', { style: { fontSize: '11.5px', margin: '6px 0 0' } }, 'A filtered variant keeps its counts and replicate scores; its score is NA with the stage that left it out. Count filters act per replicate.'));
  }

  const progressEl = h('div');
  function renderProgress() {
    clear(progressEl);
    if (!view.job) return;
    const [fraction, message] = view.progress;
    progressEl.append(h('div.score-progress', h('div.progress', h('div', { style: { width: `${Math.round(fraction * 100)}%` } })),
      h('div.btn-row', h('span.muted', { style: { fontSize: '12px' } }, message || 'Scoring…'), h('span.spacer'), h('button.btn.small', { type: 'button', onclick: () => view.job?.cancel() }, 'Cancel'))));
  }

  function runPane(ready) {
    return h('div.pane', h('h3', icon('score'), 'Run'),
      ready.ok ? h('p', { style: { margin: '0 0 8px' } }, describeParameters(draft())) : h('div', ...ready.problems.map((m) => h('div.callout.danger', { style: { marginBottom: '6px' } }, icon('warning'), h('span', m)))),
      ready.ok && ready.warnings?.length ? h('div', ...ready.warnings.map((m) => h('div.callout.warn', { style: { marginBottom: '6px' } }, icon('warning'), h('span', `The design: ${m}`)))) : null,
      view.refused ? h('div', ...view.refused.map((m) => h('div.callout.danger', { style: { marginBottom: '6px' } }, icon('warning'), h('span', m)))) : null,
      h('div.btn-row', h('button.btn.primary', { type: 'button', disabled: !ready.ok || !!view.job, onclick: runScoring }, icon('play'), 'Score'),
        ready.experiment ? h('button.btn', { type: 'button', onclick: () => app.setMode('experiment') }, icon('experiment'), 'Open Experiment') : null),
      progressEl);
  }

  function runsPane(selected) {
    const runs = store.ws.runs;
    const body = h('tbody', ...runs.slice().reverse().map((run) => {
      const r = app.runResults.get(run.id);
      const status = !r ? h('span.badge', 'not checked') : r.status === 'reproduced' ? h('span.badge.ok', { title: 'Recomputed from its inputs: the same output hash' }, 'reproduced') : r.status === 'computed' ? h('span.badge.ok', 'computed') : r.status === 'checking' ? h('span.badge', 'checking…') : h('span.badge.danger', { title: r.message }, r.status === 'differs' ? 'differs' : 'not checked');
      return h(`tr${run.id === selected?.id ? '.selected' : ''}`, { style: { cursor: 'pointer' }, onclick: () => app.focusItem({ kind: 'run', id: run.id }) },
        h('td', h('b', run.name), h('div.muted.mono', { style: { fontSize: '10.5px' } }, run.id)),
        h('td', { style: { fontSize: '11.5px' } }, describeParameters(run.inputs.parameters)),
        h('td.r', run.output.conditions.map((c) => formatCount(c.scored)).join(' / ')),
        h('td', run.warnings.length ? h('span.badge.warn', `${run.warnings.length} warning${run.warnings.length > 1 ? 's' : ''}`) : null, ' ', status),
        h('td.r', h('button.icon-button.small', { type: 'button', title: 'Remove the run', 'aria-label': `Remove ${run.name}`, onclick: async (event) => {
          event.stopPropagation();
          if (!(await confirmDialog({ title: `Remove ${run.name}?`, message: 'The run and its record leave the workspace (undo brings them back).', confirm: 'Remove', danger: true }))) return;
          store.commit(removeRun(store.ws, run.id), `Remove ${run.name}`);
        } }, icon('trash'))));
    }));
    return h('div.pane', h('h3', icon('history'), 'Runs'),
      runs.length ? h('div', { style: { maxHeight: '220px', overflow: 'auto' } }, h('table.data', h('thead', h('tr', h('th', 'Run'), h('th', 'Parameters'), h('th.r', 'Scored'), h('th', 'Status'), h('th', h('span.sr-only', 'Remove')))), body))
        : h('p.muted', { style: { margin: 0 } }, 'No run yet. Each run is kept unchanged with its inputs and parameters; the same inputs and parameters always make the same run.'));
  }

  function histogram(c, results) {
    const wt = results.controls.wt;
    return classHistogram({ groups: scoreGroups(c, results.variants.kind, results.rows), marks: wt >= 0 && !c.reason[wt] ? [{ value: c.score[wt], label: 'wild type' }] : [], label: 'Score distributions by class' });
  }

  function flowView(c) {
    return flowBars(c.flow, (x) => `${x.removed} left out: ${STAGE_BY_ID.get(x.stage).reason}`);
  }

  function replicatesTable(results, c, p) {
    const reps = results.replicates.filter((r) => c.replicates.includes(r.id));
    return h('table.data', h('thead', h('tr', h('th', 'Replicate'), h('th', 'Samples'), h('th.r', p.normalization === 'synonymous' ? 'Synonymous median' : 'Normalizers (first, last)'), h('th.r', 'Used'), h('th.r', 'Median SE'))),
      h('tbody', ...reps.map((r) => {
        let used = 0;
        const ses = [];
        for (let i = 0; i < results.rows; i += 1) {
          if (r.state[i] !== 0) continue;
          used += 1;
          ses.push(r.se[i]);
        }
        return h('tr', h('td', r.name), h('td.mono', { style: { fontSize: '11px' } }, r.samples.join(' → ')),
          h('td.r', p.normalization === 'synonymous' ? fmt(r.synonymousMedian) : `${formatCount(Math.round(r.normalizers[0]))}, ${formatCount(Math.round(r.normalizers[1]))}`),
          h('td.r', formatCount(used)), h('td.r', fmt(median(ses))));
      })));
  }

  function status(c, i) {
    if (c.reason[i]) {
      const stage = STAGE_BY_CODE.get(c.reason[i]);
      return h(`span.badge${stage.id === 'measured' ? '' : '.warn'}`, { title: stage.reason }, stage.id === 'measured' ? 'not measured' : `filtered: ${stage.label.toLowerCase()}`);
    }
    if (c.flags[i]) return h('span.badge.accent', { title: flagNames(c.flags[i]).join('; ') }, 'low confidence');
    return h('span.badge.ok', 'scored');
  }

  function variantsTable(results, c) {
    const v = results.variants;
    const search = view.search.trim().toLowerCase();
    let rows = [];
    for (let i = 0; i < results.rows; i += 1) {
      if (view.show === 'scored' && c.reason[i]) continue;
      if (view.show === 'filtered' && !c.reason[i]) continue;
      if (view.show === 'low' && (c.reason[i] || !c.flags[i])) continue;
      if (search && !v.key[i].toLowerCase().includes(search) && !String(v.original[i]).toLowerCase().includes(search)) continue;
      rows.push(i);
    }
    const key = view.sort.key;
    const value = (i) => (key === 'score' ? c.score[i] : key === 'se' ? c.se[i] : key === 'position' ? v.position[i] : key === 'loo' ? c.loo[i] : i);
    rows.sort((a, b) => {
      const x = value(a);
      const y = value(b);
      const nx = !Number.isFinite(x);
      const ny = !Number.isFinite(y);
      if (nx || ny) return nx === ny ? a - b : nx ? 1 : -1;
      return (x - y) * view.sort.dir || a - b;
    });
    const pages = Math.max(1, Math.ceil(rows.length / PAGE));
    view.page = Math.min(view.page, pages - 1);
    const shown = rows.slice(view.page * PAGE, (view.page + 1) * PAGE);
    const head = (label, sortKey, right = true) => h(`th${right ? '.r' : ''}`, sortKey ? h('button.th-sort', { type: 'button', onclick: () => { view.sort = { key: sortKey, dir: view.sort.key === sortKey ? -view.sort.dir : 1 }; render(); }, 'aria-label': `Sort by ${label}` }, label, view.sort.key === sortKey ? (view.sort.dir > 0 ? ' ↑' : ' ↓') : '') : label);
    const reps = results.replicates.filter((r) => c.replicates.includes(r.id));
    const body = h('tbody');
    for (const i of shown) {
      const z = 1.959963984540054;
      body.append(h(`tr${view.open === i ? '.selected' : ''}`, { style: { cursor: 'pointer' }, onclick: () => { view.open = view.open === i ? -1 : i; render(); } },
        h('td', h('span.mono', v.key[i] || v.original[i]), v.original[i] !== v.key[i] && v.key[i] ? h('div.muted', { style: { fontSize: '10.5px' } }, `as written: ${v.original[i]}`) : null),
        h('td', KIND_NAMES[v.kind[i]] ?? ''),
        h('td.r', fmt(c.score[i])), h('td.r', fmt(c.se[i])),
        h('td.r', Number.isFinite(c.se[i]) && !c.reason[i] ? `${fmt(c.score[i] - z * c.se[i], 2)} to ${fmt(c.score[i] + z * c.se[i], 2)}` : '—'),
        h('td.r', `${c.k[i]}/${c.expected[i]}`), h('td.r', Number.isFinite(c.i2[i]) ? `${Math.round(c.i2[i] * 100)}%` : '—'), h('td.r', fmt(c.loo[i])),
        h('td', status(c, i))));
      if (view.open === i) {
        body.append(h('tr.evidence', h('td', { colSpan: 9 },
          h('table.data.evidence-table', h('thead', h('tr', h('th', 'Replicate'), h('th.r', 'Before'), h('th.r', 'After'), h('th.r', 'Score'), h('th.r', 'SE'), h('th', 'Used'))),
            h('tbody', ...reps.map((r) => h('tr', h('td', r.name), h('td.r', fmt(r.first[i], 0)), h('td.r', fmt(r.last[i], 0)), h('td.r', fmt(r.score[i])), h('td.r', fmt(r.se[i])), h('td', r.state[i] ? REPLICATE_STATE_NAMES[r.state[i]] : 'yes'))))),
          c.flags[i] ? h('p.muted', { style: { fontSize: '11.5px', margin: '6px 0 0' } }, flagNames(c.flags[i]).join('; '), '.') : null,
          Number.isFinite(c.tau2[i]) ? h('p.muted', { style: { fontSize: '11.5px', margin: '4px 0 0' } }, `Between-replicate variance τ² ${fmt(c.tau2[i], 4)}; Cochran's Q ${fmt(c.q[i], 2)}; leaving out ${reps[c.looReplicate[i]]?.name ?? '—'} moves the score most (${fmt(c.loo[i])}).`) : null)));
      }
    }
    const searchEl = h('input.input', { type: 'search', value: view.search, placeholder: 'Find a variant', 'aria-label': 'Find a variant', oninput: () => { view.search = searchEl.value; view.page = 0; renderSoon(); } });
    const showEl = h('select.input', { 'aria-label': 'Variants shown', onchange: () => { view.show = showEl.value; view.page = 0; render(); } },
      ...[['all', 'All variants'], ['scored', 'Scored'], ['low', 'Low confidence'], ['filtered', 'Filtered or not measured']].map(([k, label]) => h('option', { value: k, selected: view.show === k }, label)));
    return h('div',
      h('div.btn-row', { style: { marginBottom: '8px' } }, searchEl, showEl, h('span.spacer'), h('span.muted', { style: { fontSize: '12px' } }, `${formatCount(rows.length)} variant${rows.length === 1 ? '' : 's'}`),
        h('button.btn.small', { type: 'button', disabled: view.page === 0, onclick: () => { view.page -= 1; render(); }, 'aria-label': 'Previous page' }, '‹'),
        h('span.muted', { style: { fontSize: '12px' } }, `${view.page + 1} / ${pages}`),
        h('button.btn.small', { type: 'button', disabled: view.page >= pages - 1, onclick: () => { view.page += 1; render(); }, 'aria-label': 'Next page' }, '›')),
      h('div', { style: { overflow: 'auto' } }, h('table.data.score-table',
        h('thead', h('tr', head('Variant', 'row', false), h('th', 'Class'), head('Score', 'score'), head('SE', 'se'), h('th.r', '95% CI'), h('th.r', 'Replicates'), h('th.r', 'I²'), head('Leave-one-out', 'loo'), h('th', 'Status'))),
        body)));
  }

  function runDetail(run) {
    const r = app.runResults.get(run.id);
    if (!r) reproduce(run);
    const head = h('div.pane', h('h3', icon('score'), run.name, h('span.muted.mono', { style: { fontSize: '11px', fontWeight: 400 } }, run.id), h('span.spacer'),
      h('span.muted', { style: { fontSize: '11.5px', fontWeight: 400 } }, `${new Date(run.created).toLocaleString()} · MaveScape ${run.software.version}`)),
      h('p', { style: { margin: '0 0 6px' } }, `${run.inputs.source.name} · ${run.inputs.design.name ?? 'design'} · ${describeParameters(run.inputs.parameters)}`),
      h('p.muted.mono', { style: { fontSize: '11px', margin: 0 } }, `Table SHA-256 ${run.inputs.source.sha256.slice(0, 16)}… · output SHA-256 ${run.output.sha256.slice(0, 16)}…`),
      r?.status === 'reproduced' ? h('div.callout.ok', { style: { marginTop: '8px' } }, icon('check'), h('span', 'Reproduced: the scores were recomputed from the run\'s recorded inputs and have its output hash.')) : null,
      r?.status === 'differs' || r?.status === 'failed' ? h('div.callout.danger', { style: { marginTop: '8px' } }, icon('warning'), h('span', r.status === 'differs' ? `Not reproduced. ${r.message}` : `Not checked: ${r.message}`),
        h('span.spacer'), h('button.btn.small', { type: 'button', onclick: () => { app.runResults.delete(run.id); render(); } }, 'Check again')) : null,
      ...run.warnings.map((w) => h('div.callout.warn', { style: { marginTop: '6px' } }, icon('warning'), h('span', w.message))),
      run.info?.length ? h('ul.summary-lines', { style: { marginTop: '8px', fontSize: '12px' } }, ...run.info.map((x) => h('li', x))) : null,
      h('details', { style: { marginTop: '8px' } }, h('summary', 'Method, as it would be written'), h('p', { style: { fontSize: '12.5px' } }, describeMethod(run).join(' '))),
      h('div.btn-row', { style: { marginTop: '8px' } }, h('button.btn.small', { type: 'button', onclick: () => { app.focusItem({ kind: 'run', id: run.id }); app.setMode('qc'); } }, icon('qc'), 'Quality control of this run')));
    if (!r?.results) return [head, h('div.pane', h('p.muted', { style: { margin: 0 } }, r?.status === 'checking' ? 'Recomputing the scores from the run\'s inputs…' : 'The scores are recomputed from the run\'s inputs when it is shown.'), progressEl)];
    const results = r.results;
    view.condition = Math.min(view.condition, results.conditions.length - 1);
    const c = results.conditions[view.condition];
    const p = withDefaults(run.inputs.parameters);
    const tabs = results.conditions.length > 1 ? h('div.segmented', { style: { marginBottom: '10px' } }, ...results.conditions.map((x, i) => h(`button${i === view.condition ? '.active' : ''}`, { type: 'button', onclick: () => { view.condition = i; view.page = 0; render(); } }, x.name))) : null;
    const lowConfidence = c.flags.reduce((a, x, i) => a + (x && !c.reason[i] ? 1 : 0), 0);
    return [head,
      h('div.score-grid',
        h('div.pane', h('h3', icon('filter'), 'Filter flow'), tabs, flowView(c),
          h('p.muted', { style: { fontSize: '11.5px', margin: '8px 0 0' } }, `${formatCount(c.scored)} scored${lowConfidence ? `, ${formatCount(lowConfidence)} with low confidence` : ''}; NA for the rest, each with its stage.${c.rescale ? ` Rescaled: ${c.rescale.anchors.map((a) => `${a.what} ${fmt(a.from)} → ${a.to}`).join(', ')}.` : ''}`)),
        h('div.pane', h('h3', icon('histogram'), 'Scores by class'), histogram(c, results))),
      h('div.pane', h('h3', icon('experiment'), 'Replicates'), replicatesTable(results, c, p)),
      h('div.pane', h('h3', icon('table'), 'Variants'), variantsTable(results, c))];
  }

  // --- The view ---------------------------------------------------------------------------------
  let renderTimer = null;
  function renderSoon() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      const focused = document.activeElement?.getAttribute('aria-label');
      render();
      if (focused) root.querySelector(`[aria-label="${focused}"]`)?.focus();
    }, 150);
  }

  function render() {
    clear(root);
    const ws = store.ws;
    const focus = store.ui.focus;
    const selected = (focus?.kind === 'run' ? ws.runs.find((r) => r.id === focus.id) : null) ?? ws.runs.at(-1) ?? null;
    root.append(h('div.workbench-head', h('h1', icon('score'), 'Score', selected ? h('span.crumbs', ` · ${selected.name}`) : null), h('span.spacer')));
    const s = source();
    if (!s) {
      root.append(h('div.view-body', h('div.planned', h('div.empty', icon('score'), h('h3', 'Score'),
        h('p', 'Functional scores with standard errors from the counts: the normalization, pseudocount, filters and replicate combination in plain view, each run kept unchanged with everything needed to repeat it. Open a count table and set its design first.'),
        h('div.btn-row', { style: { marginTop: '12px' } }, h('button.btn.primary', { type: 'button', onclick: () => app.pickFiles() }, icon('table'), 'Open files'))))));
      return;
    }
    const ready = readiness();
    root.append(h('div.view-body', h('div.split.score-split',
      h('div', runPane(ready), parametersPane(), filtersPane()),
      h('div', runsPane(selected), ...(selected ? runDetail(selected) : [])))));
    renderProgress();
  }

  render();
  return {
    update(topics) {
      if (topics.has('ws') || topics.has('focus') || topics.has('workspace-loaded') || topics.has('colors') || topics.has('theme')) render();
    },
    destroy() {
      clearTimeout(renderTimer);
      root.remove();
    },
  };
}
