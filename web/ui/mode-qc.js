// The QC view (wave 1, slice 6): whether the experiment supports reliable scores. Findings, each
// pass, review or fail (or not assessed, saying why), with what was found in numbers, the
// threshold, the rationale, the samples or replicates concerned and the plot behind it; the
// overall status beside the list, never instead of it (requirements Q1–Q9). QC is of a score
// run (its table, design and parameters) or of the counts and the current design alone; it is
// computed in the score worker. Thresholds are kept in the workspace, each change in its history.

import { h, icon, clear, formatCount } from './dom.js';
import { toast } from './overlays.js';
import { validateDesign } from '../lib/design.js';
import { checkThresholds, findingsFrom, measuresOf, overall, THRESHOLDS, withDefaultThresholds } from '../lib/findings.js';
import { canonicalJSON, setQcThresholds } from '../lib/workspace.js';
import { categoricalColor } from '../lib/colormaps.js';
import { KIND } from '../lib/variants.js';
import { STAGE_BY_ID } from '../lib/filters.js';
import { barChart, classHistogram, coverageGrid, cssVar, flowBars, legend, lineChart, scatter } from './plots.js';
import { workerInput } from './score-input.js';

const fmt = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '—');
const pct = (x) => (Number.isFinite(x) ? `${(100 * x).toFixed(x < 0.1 ? 1 : 0)}%` : '—');
const STATUS = {
  pass: { label: 'pass', badge: '.ok', icon: 'check' },
  review: { label: 'review', badge: '.warn', icon: 'warning' },
  fail: { label: 'fail', badge: '.danger', icon: 'warning' },
  na: { label: 'not assessed', badge: '', icon: 'info' },
};

// --- QC outside the view (also the remote control's qc_findings) ---------------------------------

const sourceOf = (ws) => ws.sources.find((s) => s.id === (ws.designSource ?? ws.sources[0]?.id)) ?? null;

// What QC can be of: each run (by id), and 'counts' (the current design, no scores).
export function qcSubjects(ws) {
  const options = ws.runs.slice().reverse().map((r) => ({ id: `run:${r.id}`, label: `${r.name} (${r.inputs.source.name})`, run: r }));
  if (ws.design && sourceOf(ws)) options.push({ id: 'counts', label: 'The counts, with the current design (no scores)' });
  return options;
}

// The inputs of QC for a subject: { source, design, parameters, mode } or { problem }.
export function qcInputsOf(ws, sub) {
  if (sub.run) {
    const s = ws.sources.find((x) => x.sha256 === sub.run.inputs.source.sha256);
    if (!s) return { problem: `The table ${sub.run.name} scored (SHA-256 ${sub.run.inputs.source.sha256.slice(0, 12)}…) is not in this workspace.` };
    return { source: s, design: sub.run.inputs.design, parameters: sub.run.inputs.parameters, mode: sub.run.inputs.mapping.mode };
  }
  const s = sourceOf(ws);
  const design = ws.design;
  const result = validateDesign(design, { columns: s.columns.map((c) => c.name) });
  if (!result.ok) return { problem: `The design has problems to fix first: ${result.errors.slice(0, 3).map((e) => e.message).join(' ')}`, experiment: true };
  return { source: s, design, parameters: null, mode: s.mapping?.mode ?? 'lenient' };
}

export const qcKeyOf = (ws, inputs) => canonicalJSON({ sha256: inputs.source.sha256, design: inputs.design, parameters: inputs.parameters, measures: measuresOf(ws.qc?.thresholds) });

// Computes QC in the score worker into app.qcCache (key → { status: 'computing' | 'done' |
// 'failed', qc?, message? }), once per key; returns the finished entry.
export function computeQc(app, inputs, onProgress) {
  app.qcCache ??= new Map();
  const ws = app.store.ws;
  const key = qcKeyOf(ws, inputs);
  const cached = app.qcCache.get(key);
  if (cached?.pending) return cached.pending;
  if (cached && cached.status !== 'computing') return Promise.resolve(cached);
  const entry = { status: 'computing' };
  app.qcCache.set(key, entry);
  entry.pending = (async () => {
    let next;
    try {
      const table = await app.sourceTable(inputs.source);
      const { names, columns, transfer } = workerInput(table, inputs.design);
      const job = app.worker('score').run('qc', { names, columns, design: inputs.design, mode: inputs.mode, parameters: inputs.parameters, measures: measuresOf(ws.qc?.thresholds) }, { transfer, onProgress });
      next = { status: 'done', ...(await job.promise) };
    } catch (error) {
      next = { status: 'failed', message: error.message };
    }
    app.qcCache.set(key, next);
    app.store.notify(['qc']);
    return next;
  })();
  return entry.pending;
}

// Records that a run's QC was read, for the workflow strip.
export function markQcSeen(app, run, o) {
  app.seen ??= { qc: new Map(), map: new Set() };
  const was = app.seen.qc.get(run.id);
  if (was?.status !== o.status || was?.counts.fail !== o.counts.fail || was?.counts.review !== o.counts.review) {
    app.seen.qc.set(run.id, o);
    queueMicrotask(() => app.store.notify(['workflow']));
  }
}

export function mountQcMode(app, container) {
  const { store } = app;
  const root = h('div.view');
  container.append(root);
  app.qcCache ??= new Map();
  // The view's state is the app's, so that remote control can show a subject and a finding.
  app.qcView ??= { subject: null, finding: null, pair: 0 };
  const view = app.qcView;
  view.progress = [0, ''];

  const source = () => sourceOf(store.ws);
  const thresholds = () => withDefaultThresholds(store.ws.qc?.thresholds);

  function subjectOptions() {
    return qcSubjects(store.ws);
  }
  function subject() {
    const options = subjectOptions();
    if (view.subject && options.some((o) => o.id === view.subject)) return options.find((o) => o.id === view.subject);
    const focus = store.ui.focus;
    if (focus?.kind === 'run') {
      const o = options.find((x) => x.id === `run:${focus.id}`);
      if (o) return o;
    }
    const s = source();
    const current = options.find((o) => o.run && o.run.inputs.source.sha256 === s?.sha256 && canonicalJSON(o.run.inputs.design) === canonicalJSON(store.ws.design));
    return current ?? options.find((o) => o.id === 'counts') ?? options[0] ?? null;
  }

  const inputsOf = (sub) => qcInputsOf(store.ws, sub);
  const keyOf = (inputs) => qcKeyOf(store.ws, inputs);

  async function compute(key, inputs) {
    const pending = computeQc(app, inputs, (f, m) => { view.progress = [f, m]; renderProgress(); });
    render();
    await pending;
    render();
  }

  // --- Plots, by finding ------------------------------------------------------------------------
  const statusClass = (s) => (s === 'fail' ? 'fail' : s === 'review' ? 'review' : '');
  function plotFor(finding, qc, t) {
    const lines = (key) => [{ value: t[key].review, kind: 'review' }, { value: t[key].fail, kind: 'fail' }];
    const sampleLabel = (s) => s.name;
    switch (finding.plot) {
      case 'missingness':
        return [
          barChart({ items: qc.samples.map((s) => ({ label: sampleLabel(s), value: s.missingFraction, status: s.counted === 0 ? 'fail' : '' })), label: 'Fraction of variants missing, by sample', format: pct }),
          h('h4', 'Rows by their pattern of missing samples'),
          h('table.data', h('thead', h('tr', h('th', 'Samples missing'), h('th.r', 'Rows'))), h('tbody', ...qc.missingness.patterns.map((p) => h('tr', h('td', [...p.pattern].map((x, i) => (x === '1' ? qc.missingness.samples[i] : null)).filter(Boolean).join(', ') || 'none'), h('td.r', formatCount(p.count)))))),
        ];
      case 'depth':
        return [barChart({ items: qc.samples.map((s) => ({ label: sampleLabel(s), value: s.readsPerVariant, status: s.readsPerVariant < t.readsPerVariant.fail ? 'fail' : s.readsPerVariant < t.readsPerVariant.review ? 'review' : '' })), log: true, lines: lines('readsPerVariant'), label: 'Reads per counted variant, by sample (log scale), with the review and fail thresholds', format: (v) => formatCount(Math.round(v)) }),
          h('p.muted.plot-note', `Total reads: ${qc.samples.map((s) => `${s.name} ${formatCount(s.total)}`).join(' · ')}`)];
      case 'counts': {
        const inputs = qc.samples.filter((s) => s.input && s.counted);
        const shown = (inputs.length ? inputs : qc.samples.filter((s) => s.counted)).slice(0, 12);
        return [
          h('h4', 'Count distributions'),
          lineChart({ series: shown.map((s, i) => ({ label: s.name, color: categoricalColor(i), points: s.histogram.map((f, b) => [b / 4, f]) })), xLabel: 'log₁₀(count + 1)', yLabel: 'fraction', label: 'Distribution of counts per variant in the samples before selection', extra: (el, sx) => { const x = sx(Math.log10(t.lowCount + 1)); el.add('line', { x1: x, x2: x, y1: 8, y2: 186, class: 'threshold review' }); } }),
          legend(shown.map((s, i) => ({ label: `${s.name}: ${pct(s.lowFraction)} below ${t.lowCount}`, color: categoricalColor(i) }))),
          h('h4', 'Rank abundance'),
          lineChart({ series: shown.map((s, i) => ({ label: s.name, color: categoricalColor(i), points: s.rankAbundance.filter((p) => p[1] > 0) })), xLog: true, yLog: true, xLabel: 'rank', yLabel: 'count', label: 'Counts from the most to the least abundant variant' }),
        ];
      }
      case 'time-points': {
        const ts = qc.timeSeries ?? [];
        if (!ts.length) return [h('p.muted', 'Needs a run scored by regression on time.')];
        return [barChart({ items: ts.map((r) => ({ label: r.name, value: r.fits ? r.fewer / r.fits : 0, status: r.fits && r.fewer / r.fits > t.fewerPoints.fail ? 'fail' : r.fits && r.fewer / r.fits > t.fewerPoints.review ? 'review' : '' })), lines: lines('fewerPoints'), label: 'Fits on fewer time points than the replicate has, by replicate', format: pct }),
          h('p.muted.plot-note', ts.map((r) => `${r.name}: ${formatCount(r.fewer)} of ${formatCount(r.fits)} fits on fewer than ${r.times} points; ${formatCount(r.excluded)} measurements with too few`).join(' · '))];
      }
      case 'time-fit': {
        const ts = (qc.timeSeries ?? []).filter((r) => r.assessed);
        if (!ts.length) return [h('p.muted', 'Needs fits of three or more time points.')];
        return [barChart({ items: ts.map((r) => ({ label: r.name, value: r.departure, status: r.departure > t.timeFit.fail ? 'fail' : r.departure > t.timeFit.review ? 'review' : '' })), log: true, lines: [{ value: 1, kind: 'reference' }, ...lines('timeFit')], label: 'Median departure of the time courses from their lines, over what counting predicts, by replicate (log scale; 1 is counting alone)', format: (v) => `${fmt(v, 1)}×` }),
          h('p.muted.plot-note', `Fits far from a line (beyond the 99.9th percentile of counting noise): ${ts.map((r) => `${r.name} ${pct(r.beyond)}`).join(' · ')}. Open a variant on the map to see its time course.`)];
      }
      case 'dropout': {
        const drops = qc.conditions.flatMap((c) => c.dropout ?? []);
        if (!drops.length) return [h('p.muted', 'Needs replicates with samples before and after selection.')];
        return [h('table.data', h('thead', h('tr', h('th', 'Sample after selection'), h('th.r', 'Counted before'), h('th.r', 'Missing after'), h('th.r', 'Zeros'), h('th.r', 'Missing: depletion'), h('th.r', 'Others'))),
          h('tbody', ...drops.map((d) => h('tr', h('td', d.sample), h('td.r', formatCount(d.counted)), h('td.r', `${formatCount(d.missing)} (${pct(d.missing / d.counted)})`), h('td.r', formatCount(d.zeros)),
            h('td.r', d.by === 'trend' ? pct(d.missingTrend) : `${fmt(d.missingTrend, 0)} reads`), h('td.r', d.by === 'trend' ? pct(d.countedTrend) : `${fmt(d.countedTrend, 0)} reads`))))),
        h('p.muted.plot-note', drops[0].by === 'trend' ? '"Depletion": the median count at the time point before the last, as a fraction of the input, for the variants missing at the last time point and for the others.' : '"Depletion": the median input count of the variants missing after selection, and of the others.')];
      }
      case 'coverage':
        if (!qc.coverage.assessed) return [h('p.muted', `Not assessed: ${qc.coverage.reason}.`)];
        return [coverageGrid(qc.coverage), h('p.muted.plot-note', `Missense ${qc.coverage.byClass.missense[0]} of ${qc.coverage.byClass.missense[1]}, nonsense ${qc.coverage.byClass.nonsense[0]} of ${qc.coverage.byClass.nonsense[1]} observed; ${qc.coverage.designed - qc.coverage.inTable} designed substitutions not in the table.`)];
      case 'agreement': {
        const pairs = qc.conditions.flatMap((c) => c.pairs.map((p) => ({ ...p, condition: c.name })));
        if (!pairs.length) return [h('p.muted', 'Agreement needs two replicates.')];
        view.pair = Math.min(view.pair, pairs.length - 1);
        const p = pairs[view.pair];
        return [
          h('table.data.qc-pairs', h('thead', h('tr', qc.conditions.length > 1 ? h('th', 'Condition') : null, h('th', 'Replicates'), h('th.r', 'Variants'), h('th.r', 'Pearson'), h('th.r', 'Spearman'))),
            h('tbody', ...pairs.map((x, i) => h(`tr${i === view.pair ? '.selected' : ''}`, { style: { cursor: 'pointer' }, onclick: () => { view.pair = i; render(); } }, qc.conditions.length > 1 ? h('td', x.condition) : null, h('td', `${x.a} · ${x.b}`), h('td.r', formatCount(x.n)), h('td.r', h(`span${x.pearson < t.agreement.review ? '.warn-text' : ''}`, fmt(x.pearson))), h('td.r', fmt(x.spearman)))))),
          scatter({ points: p.points, xLabel: `${p.a}: log ratio`, yLabel: `${p.b}: log ratio`, diagonal: true, label: `Log ratios of ${p.a} against ${p.b}, ${p.n} variants with at least ${qc.measures.agreementInput} input reads in both: Pearson ${fmt(p.pearson)}` }),
          h('p.muted.plot-note', `Raw log ratios (before normalization, which shifts a replicate as a whole), on variants with at least ${qc.measures.agreementInput} input reads in both; ${Math.ceil(p.n / 2500) > 1 ? `every ${Math.ceil(p.n / 2500)}th variant drawn` : 'every variant drawn'}.`),
        ];
      }
      case 'variance': {
        const pairs = qc.conditions.flatMap((c) => c.pairs).filter((p) => p.bins.length);
        const syn = qc.conditions.flatMap((c) => c.synonymous).filter((s) => s.n >= 2);
        const out = [];
        if (pairs.length) {
          const top = pairs.reduce((a, b) => (b.ratio > a.ratio ? b : a));
          const xs = pairs.flatMap((p) => p.bins.map((b) => b.counting));
          const lo = Math.min(...xs);
          const hi = Math.max(...xs);
          out.push(lineChart({
            series: [
              ...pairs.map((p, i) => ({ label: `${p.a} · ${p.b}`, color: categoricalColor(i), markers: true, points: p.bins.map((b) => [b.counting, b.observed]) })),
              { label: 'counting alone', color: cssVar('--text-3'), dash: true, width: 1.5, points: [[lo, lo], [hi, hi]] },
              { label: `fit for ${top.a} · ${top.b}`, color: cssVar('--danger'), width: 1, points: Array.from({ length: 20 }, (_, k) => { const x = lo * (hi / lo) ** (k / 19); return [x, top.multiplier * x + top.additive]; }) },
            ],
            xLog: true, yLog: true, xLabel: 'variance from counting', yLabel: 'observed variance', label: 'The variance of replicate differences against what counting predicts, in bins of variants; the dashed line is counting alone',
          }));
          out.push(legend([...pairs.map((p, i) => ({ label: `${p.a} · ${p.b}: ${fmt(p.ratio, 1)}× (a ${fmt(p.multiplier, 1)}, e ${fmt(p.additive, 3)})`, color: categoricalColor(i) })), { label: 'counting alone', color: cssVar('--text-3'), dash: true }]));
          out.push(h('p.muted.plot-note', 'Each point is a bin of variants by their expected counting variance (the reciprocal counts of both replicates). Points on the dashed line: counting noise alone. Points parallel above it: a bottleneck (variance a× counting). Points bending up where counting variance is small: noise between replicates (e).'));
        }
        if (syn.length) out.push(h('table.data', h('thead', h('tr', h('th', 'Replicate'), h('th.r', 'Synonymous variants'), h('th.r', 'Observed variance'), h('th.r', 'Counting'), h('th.r', 'Ratio'))), h('tbody', ...syn.map((x) => h('tr', h('td', x.id), h('td.r', String(x.n)), h('td.r', fmt(x.observed, 4)), h('td.r', fmt(x.expected, 4)), h('td.r', `${fmt(x.ratio, 1)}×`))))));
        return out.length ? out : [h('p.muted', 'Needs two replicates or synonymous variants.')];
      }
      case 'leave-one-out': {
        const loo = qc.conditions.flatMap((c) => c.leaveOneOut ?? []);
        if (!loo.length) return [h('p.muted', 'Needs three replicates measuring the same variants.')];
        return [barChart({ items: loo.map((x) => ({ label: x.id, value: x.ratio, status: x.ratio > t.outlierReplicate.fail ? 'fail' : x.ratio > t.outlierReplicate.review ? 'review' : '' })), lines: lines('outlierReplicate'), label: 'Each replicate\'s leave-one-out variance relative to the other replicates\'', format: (v) => `${fmt(v, 1)}×` }),
          h('table.data', h('thead', h('tr', h('th', 'Replicate'), h('th.r', 'Variants'), h('th.r', 'Variance of z'), h('th.r', 'Median z'), h('th.r', 'Relative'))), h('tbody', ...loo.map((x) => h('tr', h('td', x.id), h('td.r', formatCount(x.n)), h('td.r', fmt(x.dispersion, 2)), h('td.r', fmt(x.bias, 2)), h('td.r', `${fmt(x.ratio, 1)}×`)))))];
      }
      case 'controls': {
        if (!qc.scores) return [h('p.muted', 'Needs a score run.')];
        return qc.scores.flatMap((c) => [
          qc.scores.length > 1 ? h('h4', c.name) : null,
          classHistogram({ groups: [['Synonymous', c.scores.synonymous, 0], ['Nonsense', c.scores.nonsense, 1], ['Missense', c.scores.missense, 2]].map(([label, values, color]) => ({ label, values, color: categoricalColor(color) })), marks: Number.isFinite(c.scores.wt) ? [{ value: c.scores.wt, label: 'wild type' }] : [], label: 'Scores of the control classes' }),
          c.separation ? h('p.muted.plot-note', `AUC ${fmt(c.separation.auc, 3)}; standardized median difference ${fmt(c.separation.standardized, 1)}; ${c.separation.reference} median ${fmt(c.separation.referenceMedian)}, nonsense median ${fmt(c.separation.nonsenseMedian)}${Number.isFinite(c.separation.nonsenseAbove) ? `; ${pct(c.separation.nonsenseAbove)} of nonsense above the synonymous 5th percentile` : ''}.`) : h('p.muted', 'Not enough controls scored.'),
        ]);
      }
      case 'uncertainty': {
        if (!qc.scores) return [h('p.muted', 'Needs a score run.')];
        const colorOf = (k) => categoricalColor(k === KIND.SYNONYMOUS ? 0 : k === KIND.NONSENSE ? 1 : k === KIND.MISSENSE ? 2 : 3);
        return qc.scores.flatMap((c) => [
          qc.scores.length > 1 ? h('h4', c.name) : null,
          scatter({ points: c.points, colorOf, xLabel: 'score', yLabel: 'SE', label: `Score against its SE for ${c.points.length} scored variants${qc.scores.length > 1 ? ` of ${c.name}` : ''}` }),
          legend([['synonymous', 0], ['nonsense', 1], ['missense', 2], ['other', 3]].map(([label, i]) => ({ label, color: categoricalColor(i) }))),
          c.byInput.length ? h('table.data', h('thead', h('tr', h('th', 'Input count (median of fifth)'), h('th.r', 'Variants'), h('th.r', 'Median SE'), h('th.r', 'Median leave-one-out shift'))), h('tbody', ...c.byInput.map((b) => h('tr', h('td', formatCount(Math.round(b.input))), h('td.r', formatCount(b.n)), h('td.r', fmt(b.se, 3)), h('td.r', fmt(b.loo, 3)))))) : null,
        ]);
      }
      case 'flow':
        if (!qc.scores) return [h('p.muted', 'Needs a score run.')];
        return qc.scores.flatMap((c) => [qc.scores.length > 1 ? h('h4', c.name) : null, flowBars(c.flow, (x) => `${x.removed} left out: ${STAGE_BY_ID.get(x.stage).reason}`)]);
      default:
        return [];
    }
  }

  // --- Panes ------------------------------------------------------------------------------------
  const progressEl = h('div');
  function renderProgress() {
    clear(progressEl);
    const [f, m] = view.progress;
    progressEl.append(h('div.score-progress', h('div.progress', h('div', { style: { width: `${Math.round(f * 100)}%` } })), h('span.muted', { style: { fontSize: '12px' } }, m || 'Computing…')));
  }

  function subjectPane(sub, cached, inputs) {
    const options = subjectOptions();
    const select = h('select.input', { 'aria-label': 'Quality control of', onchange: () => { view.subject = select.value; render(); } }, ...options.map((o) => h('option', { value: o.id, selected: o.id === sub.id }, o.label)));
    const notes = [];
    if (!sub.run) notes.push(h('p.muted', { style: { fontSize: '12px', margin: '6px 0 0' } }, 'From the counts alone: control separation, resolution and the filter flow need a score run.'));
    if (sub.run && cached?.scoring && !cached.scoring.ok) notes.push(h('div.callout.warn', { style: { marginTop: '6px' } }, icon('warning'), h('span', `The run could not be recomputed (${cached.scoring.errors?.join(' ')}); findings from the counts only.`)));
    if (!sub.run && cached?.status === 'done' && store.ws.runs.length === 0) notes.push(h('div.btn-row', { style: { marginTop: '6px' } }, h('button.btn.small', { type: 'button', onclick: () => app.setMode('score') }, icon('score'), 'Score the counts')));
    if (inputs.problem) notes.push(h('div.callout.danger', { style: { marginTop: '6px' } }, icon('warning'), h('span', inputs.problem)), inputs.experiment ? h('button.btn.small', { type: 'button', style: { marginTop: '6px' }, onclick: () => app.setMode('experiment') }, icon('experiment'), 'Open Experiment') : null);
    return h('div.pane', h('h3', icon('qc'), 'Quality control of'), select, ...notes);
  }

  function findingsPane(findings) {
    const order = { fail: 0, review: 1, pass: 2, na: 3 };
    const list = findings.slice().sort((a, b) => order[a.status] - order[b.status] || findings.indexOf(a) - findings.indexOf(b));
    return h('div.pane', h('h3', icon('stethoscope'), 'Findings'),
      h('ul.findings', ...list.map((f) => h('li', h(`button.finding${view.finding === f.id ? '.selected' : ''}.${f.status}`, { type: 'button', 'aria-pressed': view.finding === f.id ? 'true' : 'false', onclick: () => { view.finding = f.id; render(); } },
        h(`span.badge${STATUS[f.status].badge}`, STATUS[f.status].label),
        h('span.finding-text', h('span.finding-title', f.title, f.blocking && f.status === 'fail' ? h('span.badge.danger', { style: { marginLeft: '6px' } }, 'blocking') : null, f.level === 'scores' ? h('span.muted', { style: { fontWeight: 400, marginLeft: '6px', fontSize: '11px' } }, 'from scores') : null), h('span.finding-value', f.value)))))));
  }

  function detailPane(f, qc, t) {
    return h('div.pane.finding-detail',
      h('h3', h(`span.badge${STATUS[f.status].badge}`, STATUS[f.status].label), f.title, f.blocking ? h('span.badge.danger', 'blocks the analysis') : h('span.muted', { style: { fontWeight: 400, fontSize: '11.5px' } }, 'advisory')),
      h('p', f.explanation),
      h('dl.kv.finding-kv', h('dt', 'Found'), h('dd', f.value), h('dt', 'Threshold'), h('dd', f.threshold), h('dt', 'Why'), h('dd', f.rationale),
        f.affected.samples.length ? [h('dt', 'Samples'), h('dd', f.affected.samples.join(', '))] : null,
        f.affected.replicates.length ? [h('dt', 'Replicates'), h('dd', f.affected.replicates.join(', '))] : null),
      h('div.finding-plot', ...plotFor(f, qc, t).filter(Boolean)));
  }

  function thresholdsPane() {
    const t = thresholds();
    const custom = !!store.ws.qc?.thresholds;
    const commit = (key, patch, label) => {
      const next = { ...t, [key]: typeof t[key] === 'object' ? { ...t[key], ...patch } : patch };
      const problems = checkThresholds(next);
      if (problems.length) {
        toast(problems[0], { kind: 'error' });
        render();
        return;
      }
      store.commit(setQcThresholds(store.ws, next, label), 'Change a QC threshold');
    };
    const input = (value, onCommit, aria) => {
      const el = h('input.input.qc-threshold', { type: 'number', value, step: 'any', 'aria-label': aria, onchange: () => onCommit(Number(el.value)) });
      return el;
    };
    return h('details.pane.qc-thresholds', { open: custom || undefined }, h('summary', h('h3', { style: { display: 'inline-flex', margin: 0 } }, icon('settings'), 'Thresholds', custom ? h('span.badge.accent', 'changed') : null)),
      h('table.data', h('thead', h('tr', h('th', 'Threshold'), h('th.r', 'Review'), h('th.r', 'Fail'))),
        h('tbody', ...THRESHOLDS.map((d) => h('tr', h('td', d.label, d.unit && d.unit !== 'fraction' ? h('span.muted', ` (${d.unit})`) : null),
          d.measure
            ? h('td.r', { colSpan: 2 }, input(t[d.key], (v) => commit(d.key, v, `QC: "${d.label}" set to ${v}`), d.label))
            : [h('td.r', input(t[d.key].review, (v) => commit(d.key, { review: v }, `QC: "${d.label}" review level ${t[d.key].review} → ${v}`), `${d.label}, review`)),
              h('td.r', input(t[d.key].fail, (v) => commit(d.key, { fail: v }, `QC: "${d.label}" fail level ${t[d.key].fail} → ${v}`), `${d.label}, fail`))])))),
      h('div.btn-row', { style: { marginTop: '8px' } }, h('button.btn.small', { type: 'button', disabled: !custom, onclick: () => store.commit(setQcThresholds(store.ws, null, 'QC thresholds reset to MaveScape\'s defaults'), 'Reset QC thresholds') }, 'Reset to the defaults'),
        h('span.muted', { style: { fontSize: '11.5px' } }, 'Fractions as 0–1. Each change goes into the history.')));
  }

  // --- The view ---------------------------------------------------------------------------------
  function render() {
    clear(root);
    const s = source();
    const sub = s ? subject() : null;
    const head = h('div.workbench-head', h('h1', icon('qc'), 'Quality control', sub ? h('span.crumbs', ` · ${sub.run ? sub.run.name : 'counts'}`) : null), h('span.spacer'));
    root.append(head);
    if (!s || !sub) {
      root.append(h('div.view-body', h('div.planned', h('div.empty', icon('qc'), h('h3', 'Quality control'),
        h('p', 'Whether the experiment supports reliable scores: depth and coverage, replicate agreement, bottlenecks, the separation of the controls. Each finding says pass, review or fail, with its threshold, what it concerns and why it matters. Open a count table and set its design first.'),
        h('div.btn-row', { style: { marginTop: '12px' } }, h('button.btn.primary', { type: 'button', onclick: () => (s ? app.setMode('experiment') : app.pickFiles()) }, icon(s ? 'experiment' : 'table'), s ? 'Open Experiment' : 'Open files'))))));
      return;
    }
    const inputs = inputsOf(sub);
    const key = inputs.problem ? null : keyOf(inputs);
    const cached = key ? app.qcCache.get(key) : null;
    if (key && !cached) {
      compute(key, inputs);
      return;
    }
    const left = h('div', subjectPane(sub, cached, inputs));
    const right = h('div');
    if (cached?.status === 'computing') right.append(h('div.pane', h('p', { style: { margin: '0 0 8px' } }, 'Computing quality control in the worker…'), progressEl));
    if (cached?.status === 'failed') right.append(h('div.pane', h('div.callout.danger', icon('warning'), h('span', `Quality control failed: ${cached.message}`))));
    if (cached?.status === 'done') {
      const t = thresholds();
      const findings = findingsFrom(cached.qc, t);
      const o = overall(findings);
      // The workflow strip: this run's QC has been read.
      if (sub.run) markQcSeen(app, sub.run, o);
      head.append(h(`span.badge${STATUS[o.status].badge}.qc-overall`, { title: 'The worst finding' }, `${o.status === 'pass' ? 'All pass' : `${o.counts.fail} fail · ${o.counts.review} review`} · ${o.counts.pass} pass${o.counts.na ? ` · ${o.counts.na} not assessed` : ''}`),
        o.blocking.length ? h('span.badge.danger', { style: { marginLeft: '6px' } }, 'blocking') : null);
      if (!view.finding || !findings.some((f) => f.id === view.finding)) view.finding = (findings.find((f) => f.status === 'fail') ?? findings.find((f) => f.status === 'review') ?? findings[0]).id;
      left.append(findingsPane(findings));
      right.append(detailPane(findings.find((f) => f.id === view.finding), cached.qc, t));
    }
    left.append(thresholdsPane());
    root.append(h('div.view-body', h('div.split.qc-split', left, right)));
    renderProgress();
  }

  render();
  return {
    update(topics) {
      if (topics.has('ws') || topics.has('focus') || topics.has('workspace-loaded') || topics.has('colors') || topics.has('theme') || topics.has('qc')) render();
    },
    destroy() {
      root.remove();
    },
  };
}

