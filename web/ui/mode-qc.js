// The QC view (wave 1, slice 6): whether the experiment supports reliable scores. Findings, each
// pass, review or fail (or not assessed, saying why), with what was found in numbers, the
// threshold, the rationale, the samples or replicates concerned and the plot behind it; the
// overall status beside the list, never instead of it (requirements Q1–Q9). QC is of a score
// run (its table, design and parameters) or of the counts and the current design alone; it is
// computed in the score worker. Thresholds are kept in the workspace, each change in its history.

import { h, icon, clear, formatCount } from './dom.js';
import { promptDialog, toast } from './overlays.js';
import { designSource, qcInputsOf, qcSubjects } from '../lib/qc-subjects.js';
import { checkThresholds, findingsFrom, measuresOf, overall, THRESHOLDS, withDefaultThresholds } from '../lib/findings.js';
import { acknowledgeFinding, canonicalJSON, setQcThresholds } from '../lib/workspace.js';
import { CAUSE_KINDS, NEXT_KINDS } from '../lib/advice.js';
import { STAGE_BY_ID } from '../lib/filters.js';
import { barChart, classHistogram, coverageGrid, flowBars, legend, lineChart, scatter, viewTheme } from './plots.js';
import { qcCharts } from '../lib/qc-plots.js';
import { figureButton } from './figure-data.js';
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

export { qcInputsOf, qcSubjects };
const sourceOf = designSource;

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
      const { names, barcodes, columns, transfer } = workerInput(table, inputs.design);
      const job = app.worker('score').run('qc', { names, barcodes, columns, design: inputs.design, mode: inputs.mode, parameters: inputs.parameters, measures: measuresOf(ws.qc?.thresholds) }, { transfer, onProgress });
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
  // The charts come from lib/qc-plots.js (wave 6, slice 2), which a figure's QC panel draws too;
  // the tables and notes beside them are the view's.
  const describeFlow = (x) => `${x.removed} left out: ${STAGE_BY_ID.get(x.stage).reason}`;
  function chartEls(chart) {
    if (!chart) return [];
    const el = chart.kind === 'bar' ? barChart(chart.spec)
      : chart.kind === 'line' ? lineChart(chart.spec)
        : chart.kind === 'scatter' ? scatter(chart.spec)
          : chart.kind === 'histogram' ? classHistogram(chart.spec)
            : chart.kind === 'flow' ? flowBars(chart.spec, describeFlow)
              : coverageGrid(chart.spec);
    return [chart.heading ? h('h4', chart.heading) : null, el, chart.legend ? legend(chart.legend) : null];
  }
  function plotFor(finding, qc, t) {
    const { charts, reason } = qcCharts(finding.plot, qc, t, { theme: viewTheme(), pair: view.pair });
    const nothing = () => [h('p.muted', reason)];
    switch (finding.plot) {
      case 'missingness':
        return [
          ...chartEls(charts[0]),
          h('h4', 'Rows by their pattern of missing samples'),
          h('table.data', h('thead', h('tr', h('th', 'Samples missing'), h('th.r', 'Rows'))), h('tbody', ...qc.missingness.patterns.map((p) => h('tr', h('td', [...p.pattern].map((x, i) => (x === '1' ? qc.missingness.samples[i] : null)).filter(Boolean).join(', ') || 'none'), h('td.r', formatCount(p.count)))))),
        ];
      case 'depth':
        return [...chartEls(charts[0]), h('p.muted.plot-note', `Total reads: ${qc.samples.map((s) => `${s.name} ${formatCount(s.total)}`).join(' · ')}`)];
      case 'counts':
        return [...chartEls(charts[0]), ...chartEls(charts[1])];
      case 'bin-occupancy': {
        if (!charts.length) return nothing();
        const bins = qc.bins;
        return [...chartEls(charts[0]), h('p.muted.plot-note', `Shares of the ${bins[0].shareOf}${bins[0].shareOf === 'reads' ? ' (record the cells sorted into each bin, in the Experiment view, to see the cells)' : ''}.`)];
      }
      case 'cells-per-bin': {
        if (!charts.length) return nothing();
        const bins = (qc.bins ?? []).filter((r) => r.bins.every((b) => b.cellsPerVariant !== null));
        return [...chartEls(charts[0]), h('p.muted.plot-note', bins.map((r) => `${r.name}: ${r.bins.map((b) => fmt(b.readsPerCell, 1)).join(', ')} reads per cell`).join(' · '))];
      }
      case 'barcodes-per-variant': {
        if (!charts.length) return nothing();
        const bq = qc.barcodes;
        return [...chartEls(charts[0]), h('p.muted.plot-note', `${formatCount(bq.rows)} barcodes in the table; ${formatCount(bq.unmapped)} name no variant (${pct(bq.unmappedReadShare)} of the reads). A barcode counts for a variant here when it has reads before selection (in any bin, for sorted bins).`)];
      }
      case 'barcode-agreement': {
        if (!charts.length) return nothing();
        const reps = qc.barcodes.replicates.filter((r) => Number.isFinite(r.phi));
        return [
          ...chartEls(charts[0]),
          h('table.data', h('thead', h('tr', h('th', 'Replicate'), h('th.r', 'Barcodes compared'), h('th.r', 'φ'), h('th.r', 'Split-half r'), h('th.r', 'Outliers'))),
            h('tbody', ...reps.map((r) => h('tr', h('td', r.name), h('td.r', formatCount(r.compared)), h('td.r', `${fmt(r.phi, 2)}×`), h('td.r', r.splitHalf ? `${fmt(r.splitHalf.r, 3)} (${formatCount(r.splitHalf.n)})` : '—'), h('td.r', h(`span${r.outlierShare > t.outlierBarcodes.review ? '.warn-text' : ''}`, `${formatCount(r.outliers)} (${pct(r.outlierShare)})`)))))),
          h('p.muted.plot-note', 'Each barcode against its variant\'s other barcodes: raw log ratios (each sample\'s reads as its normalizer), in units of their counting error together. φ is the median square of these over its value under counting alone; an outlier departs by more than 4 in z/√φ, found one at a time. Split-half r: each variant\'s barcodes in two alternating halves, summed and scored apart, correlated over variants. Open a variant on the map to see its barcodes.'),
        ];
      }
      case 'time-points': {
        if (!charts.length) return nothing();
        const ts = qc.timeSeries;
        return [...chartEls(charts[0]), h('p.muted.plot-note', ts.map((r) => `${r.name}: ${formatCount(r.fewer)} of ${formatCount(r.fits)} fits on fewer than ${r.times} points; ${formatCount(r.excluded)} measurements with too few`).join(' · '))];
      }
      case 'time-fit': {
        if (!charts.length) return nothing();
        const ts = qc.timeSeries.filter((r) => r.assessed);
        return [...chartEls(charts[0]), h('p.muted.plot-note', `Fits far from a line (beyond the 99.9th percentile of counting noise): ${ts.map((r) => `${r.name} ${pct(r.beyond)}`).join(' · ')}. Open a variant on the map to see its time course.`)];
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
        if (!charts.length) return nothing();
        return [...chartEls(charts[0]), h('p.muted.plot-note', `Missense ${qc.coverage.byClass.missense[0]} of ${qc.coverage.byClass.missense[1]}, nonsense ${qc.coverage.byClass.nonsense[0]} of ${qc.coverage.byClass.nonsense[1]} observed; ${qc.coverage.designed - qc.coverage.inTable} designed substitutions not in the table.`)];
      case 'agreement': {
        if (!charts.length) return nothing();
        const pairs = qc.conditions.flatMap((c) => c.pairs.map((p) => ({ ...p, condition: c.name })));
        view.pair = Math.min(view.pair, pairs.length - 1);
        const p = pairs[view.pair];
        return [
          h('table.data.qc-pairs', h('thead', h('tr', qc.conditions.length > 1 ? h('th', 'Condition') : null, h('th', 'Replicates'), h('th.r', 'Variants'), h('th.r', 'Pearson'), h('th.r', 'Spearman'))),
            h('tbody', ...pairs.map((x, i) => h(`tr${i === view.pair ? '.selected' : ''}`, { style: { cursor: 'pointer' }, onclick: () => { view.pair = i; render(); } }, qc.conditions.length > 1 ? h('td', x.condition) : null, h('td', `${x.a} · ${x.b}`), h('td.r', formatCount(x.n)), h('td.r', h(`span${x.pearson < t.agreement.review ? '.warn-text' : ''}`, fmt(x.pearson))), h('td.r', fmt(x.spearman)))))),
          ...chartEls(charts[0]),
          h('p.muted.plot-note', `Raw log ratios (before normalization, which shifts a replicate as a whole), on variants with at least ${qc.measures.agreementInput} input reads in both; ${Math.ceil(p.n / 2500) > 1 ? `every ${Math.ceil(p.n / 2500)}th variant drawn` : 'every variant drawn'}.`),
        ];
      }
      case 'variance': {
        if (!charts.length) return nothing();
        const pairs = qc.conditions.flatMap((c) => c.pairs).filter((p) => p.bins.length);
        const syn = qc.conditions.flatMap((c) => c.synonymous).filter((x) => x.n >= 2);
        const models = qc.conditions.flatMap((c) => c.errorModel ?? []);
        const terms = models.flatMap((g) => g.terms ?? []);
        const out = [];
        let i = 0;
        if (pairs.length) {
          out.push(...chartEls(charts[i]));
          i += 1;
          out.push(h('p.muted.plot-note', 'Each point is a bin of variants by their expected counting variance (the reciprocal counts of both replicates). Points on the dashed line: counting noise alone. Points parallel above it: a bottleneck (variance a× counting). Points bending up where counting variance is small: noise between replicates (e).'));
        }
        if (terms.length) {
          out.push(...chartEls(charts[i]),
            h('p.muted.plot-note', `Fitted from the counts alone on ${models.map((g) => `${formatCount(g.variants)} variants`).join(', ')} counted in every sample (Faure et al. 2020). A term m means about m − 1 reads per molecule beyond counting at that step: before selection (transformation, the cells carried into it) or after it (the cells recovered, the DNA extracted). Additive SDs: ${terms.map((x) => `${x.name} ${fmt(Math.sqrt(x.reperror), 3)}`).join(', ')}. Score with DiMSum's error model (Score, Scored by) to carry them into each variant's SE.`));
        } else if (models.some((g) => g.reason)) out.push(h('p.muted.plot-note', `DiMSum's error model: not fitted (${models.find((g) => g.reason).reason})`));
        if (syn.length) out.push(h('table.data', h('thead', h('tr', h('th', 'Replicate'), h('th.r', 'Synonymous variants'), h('th.r', 'Observed variance'), h('th.r', 'Counting'), h('th.r', 'Ratio'))), h('tbody', ...syn.map((x) => h('tr', h('td', x.id), h('td.r', String(x.n)), h('td.r', fmt(x.observed, 4)), h('td.r', fmt(x.expected, 4)), h('td.r', `${fmt(x.ratio, 1)}×`))))));
        return out;
      }
      case 'leave-one-out': {
        if (!charts.length) return nothing();
        const loo = qc.conditions.flatMap((c) => c.leaveOneOut ?? []);
        return [...chartEls(charts[0]),
          h('table.data', h('thead', h('tr', h('th', 'Replicate'), h('th.r', 'Variants'), h('th.r', 'Variance of z'), h('th.r', 'Median z'), h('th.r', 'Relative'))), h('tbody', ...loo.map((x) => h('tr', h('td', x.id), h('td.r', formatCount(x.n)), h('td.r', fmt(x.dispersion, 2)), h('td.r', fmt(x.bias, 2)), h('td.r', `${fmt(x.ratio, 1)}×`)))))];
      }
      case 'controls':
        if (!charts.length) return nothing();
        return qc.scores.flatMap((c, i) => [
          ...chartEls(charts[i]),
          c.separation ? h('p.muted.plot-note', `AUC ${fmt(c.separation.auc, 3)}; standardized median difference ${fmt(c.separation.standardized, 1)}; ${c.separation.reference} median ${fmt(c.separation.referenceMedian)}, nonsense median ${fmt(c.separation.nonsenseMedian)}${Number.isFinite(c.separation.nonsenseAbove) ? `; ${pct(c.separation.nonsenseAbove)} of nonsense above the synonymous 5th percentile` : ''}.`) : h('p.muted', 'Not enough controls scored.'),
        ]);
      case 'uncertainty':
        if (!charts.length) return nothing();
        return qc.scores.flatMap((c, i) => [
          ...chartEls(charts[i]),
          c.byInput.length ? h('table.data', h('thead', h('tr', h('th', 'Input count (median of fifth)'), h('th.r', 'Variants'), h('th.r', 'Median SE'), h('th.r', 'Median leave-one-out shift'))), h('tbody', ...c.byInput.map((b) => h('tr', h('td', formatCount(Math.round(b.input))), h('td.r', formatCount(b.n)), h('td.r', fmt(b.se, 3)), h('td.r', fmt(b.loo, 3)))))) : null,
        ]);
      case 'flow':
        if (!charts.length) return nothing();
        return charts.flatMap((chart) => chartEls(chart));
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
        h('span.finding-text', h('span.finding-title', f.title, f.blocking && f.status === 'fail' ? h('span.badge.danger', { style: { marginLeft: '6px' } }, 'blocking') : null, f.acknowledged?.current ? h('span.badge', { style: { marginLeft: '6px' }, title: f.acknowledged.reason }, 'acknowledged') : null, f.level === 'scores' ? h('span.muted', { style: { fontWeight: 400, marginLeft: '6px', fontSize: '11px' } }, 'from scores') : null), h('span.finding-value', f.value)))))));
  }

  // Acknowledging a finding (wave 2, slice 8): a reason, kept on the record; the status stays.
  async function acknowledge(f) {
    const reason = await promptDialog({
      title: `Acknowledge "${f.title}"`,
      label: 'Why it is expected here',
      value: f.acknowledged?.reason ?? '',
      placeholder: f.id === 'coverage' ? 'The library was made by error-prone PCR' : f.id === 'separation' ? 'Stops after the RING domain keep binding in this construct' : 'What makes it expected in this experiment',
      confirm: 'Acknowledge',
      hint: 'The finding keeps its status. The reason goes into the history, the methods and the QC exports, and holds while the finding is no worse than now.',
    });
    if (!reason) return;
    try {
      store.commit(acknowledgeFinding(store.ws, f, reason), `Acknowledge "${f.title}"`);
    } catch (error) {
      toast(error.message, { kind: 'error' });
    }
  }

  // What could cause a finding and what to do next, and its acknowledgement.
  function contextBlock(f) {
    const { causes, next } = f.advice ?? { causes: [], next: [] };
    const ack = f.acknowledged;
    const canAcknowledge = (f.status === 'review' || f.status === 'fail') && !f.blocking;
    return h('div.finding-context',
      causes.length ? [h('h4', 'What could cause it'), h('ul.advice', ...causes.map((c) => h('li', h(`span.advice-kind.${c.kind}`, CAUSE_KINDS[c.kind]), h('span', c.text))))] : null,
      next.length ? [h('h4', f.status === 'na' ? 'To assess it' : 'What to do'), h('ul.advice', ...next.map((x) => h('li', h(`span.advice-kind.${x.kind}`, NEXT_KINDS[x.kind]), h('span', x.text))))] : null,
      ack?.current ? h('div.callout.ok.acknowledged', icon('check'), h('span', h('b', 'Acknowledged: '), ack.reason, h('span.muted', ` (when it was ${ack.status}; the status stays ${f.status})`)),
        h('span.spacer'), h('button.btn.small', { type: 'button', onclick: () => acknowledge(f) }, 'Edit'), h('button.btn.small', { type: 'button', onclick: () => store.commit(acknowledgeFinding(store.ws, f, ''), `Withdraw the acknowledgement of "${f.title}"`) }, 'Withdraw')) : null,
      ack && !ack.current ? h('div.callout.warn.acknowledged', icon('warning'), h('span', h('b', 'No longer acknowledged: '), `acknowledged when it was ${ack.status} ("${ack.reason}"); it is now ${f.status === 'na' ? 'not assessed' : f.status}.`),
        h('span.spacer'), canAcknowledge ? h('button.btn.small', { type: 'button', onclick: () => acknowledge(f) }, 'Acknowledge again') : null, h('button.btn.small', { type: 'button', onclick: () => store.commit(acknowledgeFinding(store.ws, f, ''), `Withdraw the acknowledgement of "${f.title}"`) }, 'Withdraw')) : null,
      canAcknowledge && !ack ? h('div.btn-row', { style: { marginTop: '8px' } }, h('button.btn.small', { type: 'button', onclick: () => acknowledge(f), title: 'Say why this finding is expected here; its status stays' }, icon('check'), 'Acknowledge…'), h('span.muted', { style: { fontSize: '11.5px' } }, 'When it is expected here: the reason goes on the record.')) : null);
  }

  function detailPane(f, qc, t, sub) {
    // The finding's charts on a figure (wave 6, slice 2): its subject, the finding and the pair shown.
    const charted = qcCharts(f.plot, qc, t).charts.length > 0;
    const panel = () => ({ kind: 'qc', subject: sub.run ? sub.run.id : 'counts', finding: f.id, findingTitle: f.title, ...(f.plot === 'agreement' ? { pair: view.pair } : {}), h: 170 });
    return h('div.pane.finding-detail',
      charted ? h('div.btn-row.figure-add-row', figureButton(app, panel, `the QC finding "${f.title}"`)) : null,
      h('h3', h(`span.badge${STATUS[f.status].badge}`, STATUS[f.status].label), f.title, f.blocking ? h('span.badge.danger', 'blocks the analysis') : h('span.muted', { style: { fontWeight: 400, fontSize: '11.5px' } }, 'advisory')),
      h('p', f.explanation),
      h('dl.kv.finding-kv', h('dt', 'Found'), h('dd', f.value), h('dt', 'Threshold'), h('dd', f.threshold), h('dt', 'Why'), h('dd', f.rationale),
        f.affected.samples.length ? [h('dt', 'Samples'), h('dd', f.affected.samples.join(', '))] : null,
        f.affected.replicates.length ? [h('dt', 'Replicates'), h('dd', f.affected.replicates.join(', '))] : null),
      contextBlock(f),
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
      const findings = findingsFrom(cached.qc, t, { acknowledged: store.ws.qc?.acknowledged });
      const o = overall(findings);
      // The workflow strip: this run's QC has been read.
      if (sub.run) markQcSeen(app, sub.run, o);
      head.append(h(`span.badge${STATUS[o.status].badge}.qc-overall`, { title: 'The worst finding; acknowledged findings keep their status' }, `${o.status === 'pass' ? 'All pass' : `${o.counts.fail} fail · ${o.counts.review} review`} · ${o.counts.pass} pass${o.counts.na ? ` · ${o.counts.na} not assessed` : ''}${o.acknowledged.length ? ` · ${o.acknowledged.length} acknowledged` : ''}`),
        o.blocking.length ? h('span.badge.danger', { style: { marginLeft: '6px' } }, 'blocking') : null);
      if (!view.finding || !findings.some((f) => f.id === view.finding)) view.finding = (findings.find((f) => f.status === 'fail') ?? findings.find((f) => f.status === 'review') ?? findings[0]).id;
      left.append(findingsPane(findings));
      right.append(detailPane(findings.find((f) => f.id === view.finding), cached.qc, t, sub));
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

