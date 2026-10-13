// The Calibrate view (wave 8; requirements K1–K4), for research. Slice 1: control sets, variants of
// known effect with each label as its source gives it (lib/controls.js). Made here from the ClinVar
// annotation beside the map or from a table of labels; for the run shown, a set's composition, what
// of it the run measured, what may make it circular, and its labels. Slice 2: calibrations, a run's
// scores against a set when asked (lib/calibration.js): the scores of each side against the run's,
// the ROC and precision–recall curves with their intervals, thresholds and the classes they make,
// sensitivity and specificity, and how far a bootstrap moves the thresholds. Nothing here runs by
// itself, and MaveScape reports functional evidence, never a variant's clinical classification
// (mavescape-spec/conventions.md).

import { h, icon, clear } from './dom.js';
import { toast, confirmDialog } from './overlays.js';
import { activeRun } from './selections.js';
import { addPublicTrack } from './tracks.js';
import { attributed, clinvarAnnotation, controlsForRun, deleteControlSet, makeClinVarControls, makeTableControls } from './controls.js';
import { calibrationReport, deleteCalibration, makeCalibration, variantClasses } from './calibration.js';
import { cssVar, legend, plotSVG, viewTheme } from './plots.js';
import { controlStrips, prChart, rocChart } from '../lib/plots.js';
import { KINDS, SIDES, controlSetWords } from '../lib/controls.js';
import { CALIBRATION_DEFAULTS, CLASSES, MAX_SAMPLES, calibrationWords, percentText, ruleWords, threeFigures, thresholdWords } from '../lib/calibration.js';
import { lossSide, readoutOf } from '../lib/readout.js';
import { heldRemoval, proposalOfItem } from '../lib/proposals.js';

const LABEL_ROWS = 300;
const SIDE_WORDS = { P: 'P: pathogenic or likely pathogenic, or abnormal, as their source says', B: 'B: benign or likely benign, or normal, as their source says' };
const g3 = threeFigures;
const count = (n) => n.toLocaleString('en-US');

export function mountCalibrateMode(app, container) {
  const { store } = app;
  let token = 0;
  const title = h('span.muted');
  const body = h('div.view-body');
  const root = h('div.view', h('div.workbench-head', h('h1', icon('calibrate'), 'Calibrate'), title), body);
  container.append(root);
  // The forms' choices, kept while the view is open.
  const form = { minStars: 1, kinds: new Set(['missense']), citation: '' };
  const calibrate = { side: 'auto', rule: CALIBRATION_DEFAULTS.rule, error: String(CALIBRATION_DEFAULTS.error), abnormal: '', normal: '', samples: String(CALIBRATION_DEFAULTS.samples), seed: String(CALIBRATION_DEFAULTS.seed), condition: 0 };

  const calibrations = () => store.ws.calibrations ?? [];
  // The calibration shown: the one focused, else the latest of the set and run shown.
  const selectedCalibration = (set, run) => {
    const focus = store.ui.focus;
    if (focus?.kind === 'calibration') return calibrations().find((c) => c.id === focus.id) ?? null;
    if (!set || !run) return null;
    return calibrations().filter((c) => c.controlSet === set.id && c.run === run.id).at(-1) ?? null;
  };
  const selectedSet = () => {
    const list = store.ws.controlSets ?? [];
    const focus = store.ui.focus;
    if (focus?.kind === 'calibration') {
      const cal = calibrations().find((c) => c.id === focus.id);
      if (cal) return list.find((c) => c.id === cal.controlSet) ?? null;
    }
    return (focus?.kind === 'controls' && list.find((c) => c.id === focus.id)) || list.at(-1) || null;
  };
  // The run shown: a focused calibration's, else the view's.
  const shownRun = () => {
    const focus = store.ui.focus;
    if (focus?.kind === 'calibration') {
      const cal = calibrations().find((c) => c.id === focus.id);
      const run = cal && store.ws.runs.find((r) => r.id === cal.run);
      if (run) return run;
    }
    return activeRun(app);
  };

  function mark(item, collection) {
    const proposal = proposalOfItem(store.ws, item);
    if (proposal) return h('span.badge.accent', { title: `Proposed by ${proposal.author}: accept or reject it above the view` }, 'proposed');
    const removal = heldRemoval(store.ws, collection, item.id);
    return removal ? h('span.badge.danger', { title: `${removal.proposal.author} proposes deleting it` }, 'remove?') : null;
  }

  function setsPane(selected) {
    const list = store.ws.controlSets ?? [];
    return h('div.pane', h('h3', icon('calibrate'), 'Control sets'),
      list.length
        ? h('div', { role: 'list' }, ...list.map((c) => h(`button.dataset-row${c === selected ? '.selected' : ''}`, { type: 'button', role: 'listitem', 'aria-current': c === selected ? 'true' : null, onclick: () => app.focusItem({ kind: 'controls', id: c.id }) },
          icon('calibrate'), h('span.label', c.name), mark(c, 'controlSets'), h('span.meta', `${c.labels.filter((l) => l.side === 'P').length} P · ${c.labels.filter((l) => l.side === 'B').length} B`))))
        : h('p.muted.small', 'None yet. A control set holds variants whose effect is known, each label as its source gives it: make one from ClinVar\'s records of the gene, or from a table of labels.'));
  }

  function calibrationsPane(shown) {
    const list = calibrations();
    if (!list.length) return null;
    return h('div.pane', h('h3', icon('gauge'), 'Calibrations'),
      h('div', { role: 'list' }, ...list.map((c) => h(`button.dataset-row${c === shown ? '.selected' : ''}`, { type: 'button', role: 'listitem', 'aria-current': c === shown ? 'true' : null, onclick: () => app.focusItem({ kind: 'calibration', id: c.id }) },
        icon('gauge'), h('span.label', c.name), mark(c, 'calibrations'), h('span.meta', `${c.n.P} P · ${c.n.B} B`)))));
  }

  function newSetPane(run) {
    const annotation = clinvarAnnotation(store.ws);
    const kinds = h('div', { role: 'group', 'aria-label': 'Kinds of variant' }, ...KINDS.map((k) => h('label.check', h('input', { type: 'checkbox', checked: form.kinds.has(k), onchange: (e) => (e.target.checked ? form.kinds.add(k) : form.kinds.delete(k)) }), k)));
    const stars = h('select.select', { 'aria-label': 'Minimum review stars', onchange: (e) => { form.minStars = Number(e.target.value); } },
      ...[0, 1, 2, 3, 4].map((n) => h('option', { value: String(n), selected: n === form.minStars }, n === 0 ? 'any review status' : `${'★'.repeat(n)} or more`)));
    const clinvar = annotation
      ? h('div',
        h('label.field', h('span', 'ClinVar\'s review status'), stars),
        h('div.field', h('span', 'Kinds of variant'), kinds),
        h('p.muted.small', 'Pathogenic and likely pathogenic records are P, benign and likely benign B; conflicting and uncertain ones are left out. Nonsense and synonymous variants anchor most runs\' scales: include them knowingly.'),
        h('button.btn.primary', { type: 'button', onclick: async () => {
          try {
            const made = await makeClinVarControls(app, { minStars: form.minStars, kinds: KINDS.filter((k) => form.kinds.has(k)), run });
            app.focusItem({ kind: 'controls', id: made.id });
            toast(`Made ${controlSetWords(made.set)}.`, { kind: 'ok' });
          } catch (error) {
            toast(error.message, { kind: 'error' });
          }
        } }, icon('plus'), 'Make from ClinVar'))
      : h('div',
        h('p.muted.small', 'ClinVar\'s records of the gene are not beside the map yet.'),
        h('button.btn', { type: 'button', disabled: !run, onclick: async () => {
          const result = await addPublicTrack(app, run, 'clinvar');
          toast(result.message, { kind: result.ok ? 'ok' : 'error' });
        } }, icon('plus'), 'Add ClinVar\'s records'));
    const citation = h('input.input', { type: 'text', placeholder: 'Its citation or DOI, if published', value: form.citation, 'aria-label': 'Citation of the table', oninput: (e) => { form.citation = e.target.value; } });
    const file = h('input', { type: 'file', accept: '.csv,.tsv,.txt', 'aria-label': 'A table of labels', style: { display: 'none' }, onchange: async (e) => {
      const chosen = e.target.files?.[0];
      if (!chosen) return;
      try {
        const made = makeTableControls(app, { fileName: chosen.name, text: await chosen.text(), citation: form.citation.trim() || null, run });
        app.focusItem({ kind: 'controls', id: made.id });
        toast(`Made ${controlSetWords(made.set)}.`, { kind: 'ok' });
      } catch (error) {
        toast(error.message, { kind: 'error' });
      }
    } });
    return h('div.pane', h('h3', icon('plus'), 'New control set'),
      h('div.section-title', 'From ClinVar'), clinvar,
      h('div.section-title', { style: { marginTop: '14px' } }, 'From a table'),
      h('p.muted.small', 'A column of variants (p.Trp36Ala, W36A, or ClinVar\'s names) and one of labels (pathogenic, likely pathogenic, benign, likely benign; or abnormal and normal from another assay), numbered on the reference or the target.'),
      h('label.field', h('span', 'Citation'), citation),
      file,
      h('button.btn', { type: 'button', onclick: () => file.click() }, icon('upload'), 'Open a table…'));
  }

  function compositionPane(set, run, report) {
    const { composition: c, match } = report;
    const words = (counts) => Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([w, n]) => `${w} ${n}`).join(', ') || '—';
    const stars = (s) => s.map((n, k) => (n ? `${k ? '★'.repeat(k) : 'no star'} ${n}` : null)).filter(Boolean).join(', ');
    return h('div.pane', h('h3', icon('calibrate'), set.name, mark(set, 'controlSets'), h('span.spacer'),
      h('button.btn.small', { type: 'button', onclick: async () => {
        const made = calibrations().filter((x) => x.controlSet === set.id).length;
        if (!(await confirmDialog({ title: `Delete the control set "${set.name}"?`, message: `It goes from the workspace${made ? `, with the ${made === 1 ? 'calibration' : `${made} calibrations`} made with it` : ''}; the history keeps that it was made and deleted.`, confirm: 'Delete', danger: true }))) return;
        deleteControlSet(app, set.id);
      } }, icon('trash'), 'Delete')),
      h('p.muted.small', { style: { marginTop: 0 } }, `From ${set.source.kind === 'clinvar' ? `ClinVar's records on ${set.source.transcript}${set.source.retrieved ? `, retrieved ${set.source.retrieved.slice(0, 10)}` : ''}; at least ${set.rules.minStars} review star${set.rules.minStars === 1 ? '' : 's'}` : `${set.source.file.fileName} (SHA-256 ${set.source.file.sha256.slice(0, 12)}…)${set.source.citation ? `, ${set.source.citation}` : ''}; numbered on the ${set.source.numbering}`}; ${set.rules.kinds.join(', ')}. Made ${set.created.slice(0, 10)}.`),
      h('div.table-scroll', h('table.data.compact',
        h('thead', h('tr', h('th', 'Side'), h('th.r', 'Controls'), h('th.r', `Scored in ${run.name}`), h('th.r', 'Not scored'), h('th.r', 'Not in the run'))),
        h('tbody', ...SIDES.map((side) => h('tr', { title: SIDE_WORDS[side] }, h('td', h('b', side)), h('td.r', String(c[side].total)), h('td.r', String(match.counts[side].scored)), h('td.r', String(match.counts[side]['not scored'])), h('td.r', String(match.counts[side]['not in the run']))))))),
      ...SIDES.map((side) => h('p.small', { style: { margin: '8px 0 0' } }, h('b', `${side}: `), words(c[side].labels), set.source.kind === 'clinvar' ? ` · ${stars(c[side].stars)}` : '', ` · ${words(c[side].kinds)}`)),
      h('p.muted.small', 'P: pathogenic or likely pathogenic (or abnormal) as the source says; B: benign or likely benign (or normal). These are the source\'s labels, not MaveScape\'s: MaveScape reports functional evidence and does not classify variants.'),
      Object.keys(set.excluded ?? {}).length ? h('p.muted.small', `Left out when it was made: ${Object.entries(set.excluded).sort((a, b) => b[1] - a[1]).map(([why, n]) => `${n} ${why}`).join('; ')}.`) : null,
      ...(set.notes ?? []).map((n) => h('p.muted.small', n)));
  }

  function warningsPane(run, report) {
    return h('div.pane', h('h3', icon('warning'), 'What may make these labels circular'),
      report.warnings.length
        ? h('div', ...report.warnings.map((w) => h('div.callout.warn', { style: { margin: '0 0 6px' } }, icon('warning'), h('span', w.text))))
        : h('p.callout.ok', icon('check'), h('span', `None of the circularities MaveScape checks for was found for ${run.name}: labels anchoring its scale, the design's own controls, ClinVar classifications evaluated since the assay, its own publication, too few controls, a predictor set with the same labels.`)));
  }

  // The form that calibrates the run shown against the set shown (slice 2).
  function calibratePane(set, run, report) {
    const scored = { P: report.match.counts.P.scored, B: report.match.counts.B.scored };
    const design = run.inputs.design;
    const loss = lossSide(design);
    const readout = readoutOf(design);
    const conditions = report.match.view.conditions;
    const field = (label, control) => h('label.field', h('span', label), control);
    const input = (key, attrs) => h('input.input', { ...attrs, value: calibrate[key], oninput: (e) => { calibrate[key] = e.target.value; } });
    const sideSelect = h('select.select', { 'aria-label': 'Where abnormal-like scores are', onchange: (e) => { calibrate.side = e.target.value; } },
      h('option', { value: 'auto', selected: calibrate.side === 'auto' }, loss.stated && loss.side !== 'either' ? `${loss.side} the others (the readout's)` : 'the P controls\' side (their median)'),
      h('option', { value: 'below', selected: calibrate.side === 'below' }, 'below the others'),
      h('option', { value: 'above', selected: calibrate.side === 'above' }, 'above the others'));
    const ruleFields = h('div');
    const showRule = () => {
      clear(ruleFields);
      if (calibrate.rule === 'error') ruleFields.append(field('Misclassified at most (each side)', input('error', { type: 'number', min: '0.01', max: '0.49', step: '0.01', 'aria-label': 'The share of either side\'s controls allowed on the other side\'s class' })));
      if (calibrate.rule === 'given') ruleFields.append(h('div.calibration-fields', field('Abnormal threshold', input('abnormal', { type: 'number', step: 'any', 'aria-label': 'Abnormal threshold' })), field('Normal threshold', input('normal', { type: 'number', step: 'any', 'aria-label': 'Normal threshold' }))));
    };
    const ruleSelect = h('select.select', { 'aria-label': 'How the thresholds are set', onchange: (e) => { calibrate.rule = e.target.value; showRule(); } },
      h('option', { value: 'error', selected: calibrate.rule === 'error' }, 'by the controls: few misclassified on each side'),
      h('option', { value: 'youden', selected: calibrate.rule === 'youden' }, 'one threshold: Youden\'s J'),
      h('option', { value: 'given', selected: calibrate.rule === 'given' }, 'given (published, or chosen)'));
    showRule();
    const ready = scored.P > 0 && scored.B > 0;
    return h('div.pane', h('h3', icon('gauge'), 'Calibrate'),
      h('p.muted.small', { style: { marginTop: 0 } }, `${run.name} against "${set.name}": ${scored.P} P and ${scored.B} B controls scored. ${readout.stated ? '' : 'The readout\'s direction is not stated, so the side of abnormal-like scores comes from the controls unless you choose it. '}Made when you ask, kept with the workspace.`),
      conditions.length > 1 ? field('Condition', h('select.select', { 'aria-label': 'Condition', onchange: (e) => { calibrate.condition = Number(e.target.value); } }, ...conditions.map((c, i) => h('option', { value: String(i), selected: i === calibrate.condition }, c.name)))) : null,
      field('Abnormal-like scores are', sideSelect),
      field('Thresholds', ruleSelect),
      ruleFields,
      h('div.calibration-fields',
        field('Bootstrap samples', input('samples', { type: 'number', min: '0', max: String(MAX_SAMPLES), step: '1', 'aria-label': 'Bootstrap samples' })),
        field('Seed', input('seed', { type: 'number', step: '1', 'aria-label': 'Bootstrap seed' }))),
      h('button.btn.primary', { type: 'button', disabled: !ready, title: ready ? null : 'Both sides need scored controls', onclick: async () => {
        try {
          const made = await makeCalibration(app, { set, run, side: calibrate.side, rule: calibrate.rule, error: calibrate.error, abnormal: calibrate.abnormal, normal: calibrate.normal, samples: calibrate.samples, seed: calibrate.seed, condition: calibrate.condition });
          app.focusItem({ kind: 'calibration', id: made.id });
          toast(`Calibrated ${calibrationWords(made.calibration, { set, run, metrics: made.metrics })}.`, { kind: 'ok' });
        } catch (error) {
          toast(error.message, { kind: 'error' });
        }
      } }, icon('gauge'), 'Calibrate'),
      ready ? null : h('p.muted.small', 'Both sides need controls the run scores.'));
  }

  // A calibration's metrics (slice 2): what it was made with, the scores of each side against the
  // run's, the curves, the classes and how far the bootstrap moves the thresholds.
  function calibrationPanes(cal, r) {
    const { metrics: m, scored, set, run } = r;
    const theme = { ...viewTheme(), P: cssVar('--track-pathogenic'), B: cssVar('--track-benign') };
    const frame = (width, height) => ({ width, height, text: 10, theme });
    const t = m.thresholds;
    const classes = variantClasses(scored.view, cal.condition ?? 0, cal.side, cal.thresholds);
    const sideFrom = cal.sideFrom === 'readout' ? 'as the readout says' : cal.sideFrom === 'controls' ? 'where the P controls\' median is, the readout not saying' : 'as chosen';
    // The points of the curves at the thresholds.
    const at = (sideClass) => {
      const P = m.classes.P;
      const B = m.classes.B;
      const called = (c) => (sideClass === 'abnormal' ? c['abnormal-like'] : c['abnormal-like'] + c.intermediate);
      return { sensitivity: called(P) / m.n.P, specificity: 1 - called(B) / m.n.B, recall: called(P) / m.n.P, precision: called(P) / Math.max(1, called(P) + called(B)) };
    };
    const marks = t.abnormal === t.normal ? [{ ...at('abnormal'), label: 'threshold' }] : [...(t.abnormal === null ? [] : [{ ...at('abnormal'), label: 'abnormal' }]), ...(t.normal === null ? [] : [{ ...at('normal'), label: 'normal', below: true }])];
    const head = h('div.pane', h('h3', icon('gauge'), cal.name, mark(cal, 'calibrations'), h('span.spacer'),
      h('button.btn.small', { type: 'button', onclick: async () => {
        if (!(await confirmDialog({ title: `Delete the calibration "${cal.name}"?`, message: 'It goes from the workspace; the history keeps that it was made and deleted.', confirm: 'Delete', danger: true }))) return;
        deleteCalibration(app, cal.id);
      } }, icon('trash'), 'Delete')),
      h('p.small', { style: { marginTop: 0 } }, `${run.name}${scored.condition ? ` (${scored.condition})` : ''} against "${set.name}": ${m.n.P} P and ${m.n.B} B controls scored. Abnormal-like scores are ${cal.side} the others, ${sideFrom}. Thresholds: ${ruleWords(cal.rule, cal.error)}. ${m.bootstrap ? `Intervals from ${count(m.bootstrap.samples)} stratified bootstrap samples (seed ${m.bootstrap.seed}).` : 'No bootstrap.'} Made ${cal.created.slice(0, 10)}.`),
      r.where.against ? h('div.callout.warn', { style: { margin: '0 0 8px' } }, icon('warning'), h('span', `The P controls' median (${g3(r.where.against.P)}) is ${cal.side === 'below' ? 'above' : 'below'} the B controls' (${g3(r.where.against.B)}), though abnormal-like scores are taken to be ${cal.side} the others: the P variants may change function the other way, or the scale may run the other way. Calibrate again with the side chosen if so.`)) : null,
      r.differs ? h('div.callout.danger', { style: { margin: '0 0 8px' } }, icon('warning'), h('span', `Computed again, the thresholds are ${thresholdWords(cal.side, t)}, not the ${thresholdWords(cal.side, cal.thresholds)} kept: MaveScape's computation changed since it was made.`)) : null,
      m.n.P < 10 || m.n.B < 10 ? h('div.callout.warn', { style: { margin: '0 0 8px' } }, icon('warning'), h('span', `With ${Math.min(m.n.P, m.n.B)} controls on a side, every number here is too uncertain to rely on: see the intervals.`)) : null);
    const strips = controlStrips({ all: classes.all.values, P: scored.P, B: scored.B, side: cal.side, thresholds: cal.thresholds, label: `${run.name}'s scores: the P and B controls against the run's ${count(classes.all.total)} scored variants, with the classes the thresholds make` }, frame(900, 210));
    const distributions = h('div.pane#calibration-scores', h('h3', icon('score'), 'Scores of each side'),
      legend(strips.legend), plotSVG(strips, strips.description),
      h('p.muted.small', `${thresholdWords(cal.side, cal.thresholds)}. Medians: P ${g3(m.distributions.P.median)} (quartiles ${g3(m.distributions.P.q1)} to ${g3(m.distributions.P.q3)}), B ${g3(m.distributions.B.median)} (${g3(m.distributions.B.q1)} to ${g3(m.distributions.B.q3)}).`));
    const roc = rocChart({ points: m.roc.points, band: m.roc.band, marks, label: `ROC curve: AUC ${g3(m.auc.auc)}` }, frame(320, 300));
    const pr = prChart({ points: m.pr.points, band: m.pr.band, baseline: m.pr.baseline, marks, label: `Precision–recall curve: area ${g3(m.pr.auc)}` }, frame(320, 300));
    const ab = m.auc.boot;
    const curves = h('div.calibration-grid',
      h('div.pane', h('h3', icon('gauge'), 'ROC curve'), plotSVG(roc, roc.description, 'plot calibration-curve'),
        h('p.small', `AUC ${g3(m.auc.auc)}: the chance that a P control scores more abnormal-like than a B control (½ for a tie). DeLong's 95% interval ${g3(m.auc.low)} to ${g3(m.auc.high)}${ab ? `; the bootstrap's ${g3(ab.low)} to ${g3(ab.high)}` : ''}.`),
        h('p.muted.small', `The band: the bootstrap's 95% interval of the sensitivity at each specificity (as pROC's ci.se). The circles: the thresholds.`)),
      h('div.pane', h('h3', icon('gauge'), 'Precision–recall curve'), plotSVG(pr, pr.description, 'plot calibration-curve'),
        h('p.small', `Area ${g3(m.pr.auc)}${m.pr.boot ? ` (the bootstrap's 95% interval ${g3(m.pr.boot.low)} to ${g3(m.pr.boot.high)})` : ''}; by chance ${g3(m.pr.baseline)}, the P controls' share (the dashed line).`),
        h('p.muted.small', `Precision here is among these controls, ${m.n.P} P to ${m.n.B} B: not the share of P among variants of unknown effect, which no control set gives. Between its points the curve follows Keilwagen et al. (2014)'s interpolation, as PRROC's.`)));
    const pctOf = (x, n) => (n ? `${count(x)} (${percentText(x / n)})` : '—');
    // Each class's scores.
    const lo = cal.side === 'below';
    const { abnormal: a, normal: n } = cal.thresholds;
    const range = {
      'abnormal-like': a === null ? 'none' : `${lo ? '≤' : '≥'} ${g3(a)}`,
      intermediate: a === null || n === null ? '—' : a === n ? 'none' : lo ? `${g3(a)} to ${g3(n)}` : `${g3(n)} to ${g3(a)}`,
      'WT-like': n === null ? 'none' : `${lo ? '>' : '<'} ${g3(n)}`,
    };
    const ci = (w) => `${percentText(w.p)} (${percentText(w.low)} to ${percentText(w.high)})`;
    const classesPane = h('div.pane', h('h3', icon('table'), 'Classes'),
      h('div.table-scroll', h('table.data.compact',
        h('thead', h('tr', h('th', 'Class (research use)'), h('th', 'Scores'), h('th.r', 'P controls'), h('th.r', 'B controls'), h('th.r', `${run.name}'s missense`))),
        h('tbody', ...CLASSES.map((k) => h('tr', h('td', k), h('td', range[k]), h('td.r', pctOf(m.classes.P[k], m.n.P)), h('td.r', pctOf(m.classes.B[k], m.n.B)), h('td.r', pctOf(classes.missense[k], classes.missense.total))))))),
      h('dl.kv', { style: { marginTop: '10px' } },
        h('dt', 'Sensitivity'), h('dd', `${ci(m.sensitivity)}: P controls abnormal-like`),
        h('dt', 'Specificity'), h('dd', `${ci(m.specificity)}: B controls WT-like`),
        h('dt', 'P called WT-like'), h('dd', ci(m.misses.P)),
        h('dt', 'B called abnormal-like'), h('dd', ci(m.misses.B))),
      h('p.muted.small', 'Wilson\'s 95% intervals. Abnormal-like, intermediate and WT-like are functional classes in this assay, for research: not a classification of any variant. A score equal to a threshold is on its abnormal-like side.'));
    const s = t.stability;
    const stabilityRow = (label, value, band, empty) => h('tr', h('td', label), h('td.r', value === null ? 'none' : g3(value)), h('td.r', band ? g3(band.median) : '—'), h('td.r', band ? `${g3(band.low)} to ${g3(band.high)}` : '—'), h('td.r', empty ? `${count(empty)}` : '0'));
    const stabilityPane = h('div.pane', h('h3', icon('gauge'), 'How far the bootstrap moves the thresholds'),
      cal.rule === 'given'
        ? h('p.small', 'Given thresholds are fixed: no sample moves them. The intervals of sensitivity and specificity say how certain the classes\' share of each side is.')
        : !s
          ? h('p.small', 'No bootstrap (0 samples, or a side with fewer than two controls).')
          : h('div',
            h('div.table-scroll', h('table.data.compact',
              h('thead', h('tr', h('th', 'Threshold'), h('th.r', 'Here'), h('th.r', 'Samples\' median'), h('th.r', '95% of samples'), h('th.r', 'Samples with the class empty'))),
              h('tbody', ...(cal.rule === 'youden' ? [stabilityRow('the threshold', t.abnormal, s.abnormal, s.empty.abnormal)] : [stabilityRow('abnormal', t.abnormal, s.abnormal, s.empty.abnormal), stabilityRow('normal', t.normal, s.normal, s.empty.normal)])))),
            cal.rule === 'error' ? h('p.small', `In ${percentText(s.withoutZone)} of the ${count(m.bootstrap.samples)} samples the sides met with no intermediate zone${t.crossed ? ', as they do here' : ''}.`) : null,
            h('p.muted.small', `Each sample draws each side's controls again with replacement (seed ${m.bootstrap.seed}) and sets the thresholds by the same rule. A class some samples leave empty (no control far enough) is counted apart; the interval is of the others.`)));
    return h('div', head, distributions, curves, h('div.calibration-grid', classesPane, stabilityPane));
  }

  function labelsPane(set, run, report) {
    const score = report.match.view.conditions[0]?.score;
    const rows = set.labels.slice(0, LABEL_ROWS).map((l, k) => {
      const i = report.match.rows[k];
      const s = i >= 0 && score ? score[i] : Number.NaN;
      return h('tr', h('td.mono', l.key), h('td', l.side), h('td', attributed(set, l)), h('td', report.match.states[k]), h('td.r', Number.isFinite(s) ? s.toFixed(3) : '—'), h('td.mono', l.ids.join(', ')), set.source.kind === 'clinvar' ? h('td', l.evaluated ?? '—') : null);
    });
    return h('div.pane', h('h3', icon('table'), `Labels (${set.labels.length})`),
      // A region of its own, focusable, so that the keyboard scrolls it (axe-core's
      // scrollable-region-focusable).
      h('div.table-scroll', { style: { maxHeight: '420px' }, tabIndex: 0, role: 'region', 'aria-label': `The labels of ${set.name}` }, h('table.data.compact',
        h('thead', h('tr', h('th', 'Variant'), h('th', 'Side'), h('th', 'Label, as its source gives it'), h('th', `In ${run.name}`), h('th.r', 'Score'), h('th', set.source.kind === 'clinvar' ? 'ClinVar' : 'Row'), set.source.kind === 'clinvar' ? h('th', 'Last evaluated') : null)),
        h('tbody', ...rows))),
      set.labels.length > LABEL_ROWS ? h('p.muted.small', `The first ${LABEL_ROWS} of ${set.labels.length}.`) : null);
  }

  async function render() {
    const mine = ++token;
    const run = shownRun();
    const set = selectedSet();
    const cal = selectedCalibration(set, run);
    title.textContent = run ? ` · ${run.name}` : '';
    const left = h('div', setsPane(set), calibrationsPane(cal), newSetPane(run));
    const right = h('div');
    // The calibration and the labels below both columns, at their full width.
    const below = h('div', { style: { marginTop: '14px' } });
    clear(body);
    body.append(h('div.callout.accent', { style: { marginBottom: '14px' } }, icon('info'), h('span', 'For research. Calibration says how far the functional scores separate variants of known effect; it never runs by itself, and MaveScape does not classify variants. Start with a control set.')),
      h('div.split', left, right), below);
    if (!run) {
      right.append(h('div.empty', icon('score'), h('h3', 'No score run yet'), h('p', 'A control set is matched to a run\'s scores: score the counts first.'), h('button.btn.primary', { type: 'button', onclick: () => app.setMode('score') }, icon('score'), 'Open Score')));
      return;
    }
    if (!set) {
      right.append(h('div.empty', icon('calibrate'), h('h3', 'No control set yet'), h('p', 'Make one from ClinVar\'s records of the gene or from a table of labels: its composition, what of it the run measured, and what may make it circular appear here.')));
      return;
    }
    right.append(h('p.muted', 'Matching the controls to the run…'));
    try {
      const report = await controlsForRun(app, set, run);
      if (mine !== token) return;
      clear(right);
      right.append(compositionPane(set, run, report), warningsPane(run, report), calibratePane(set, run, report));
      if (cal) {
        const waiting = h('p.muted', `Computing "${cal.name}"…`);
        below.append(waiting);
        try {
          const r = await calibrationReport(app, cal);
          if (mine !== token) return;
          waiting.replaceWith(calibrationPanes(cal, r));
        } catch (error) {
          if (mine !== token) return;
          waiting.replaceWith(h('div.callout.danger', icon('warning'), h('span', error.message)));
        }
        below.append(h('div', { style: { marginTop: '14px' } }, labelsPane(set, run, report)));
      } else below.append(labelsPane(set, run, report));
    } catch (error) {
      if (mine !== token) return;
      clear(right);
      right.append(h('div.callout.danger', icon('warning'), h('span', error.message)));
    }
  }

  render();
  return {
    update(topics) {
      if (topics.has('ws') || topics.has('focus') || topics.has('workspace-loaded') || topics.has('results')) render();
    },
    destroy() {
      token += 1;
      root.remove();
    },
  };
}
