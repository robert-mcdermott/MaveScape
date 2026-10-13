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
import { calibrationReport, deleteCalibration, likelihoodReport, makeCalibration, publishedCalibrationsOf, variantClasses } from './calibration.js';
import { cssVar, legend, plotSVG, viewTheme } from './plots.js';
import { controlStrips, likelihoodChart, prChart, rocChart } from '../lib/plots.js';
import { EVIDENCE, likelihoodSettings, likelihoodWords } from '../lib/likelihood.js';
import { KINDS, SIDES, assayYear, beforeWords, composition, controlSetWords } from '../lib/controls.js';
import { CALIBRATION_DEFAULTS, CLASSES, MAX_SAMPLES, calibrationWords, evidenceLimitations, percentText, publishedEvidence, ruleWords, threeFigures, thresholdWords } from '../lib/calibration.js';
import { STRENGTH_CODES, strengthWords } from '../lib/oddspath.js';
import { lossSide, readoutOf } from '../lib/readout.js';
import { heldRemoval, proposalOfItem } from '../lib/proposals.js';
import { figureButton } from './figure-data.js';
import { thresholdPoints } from '../lib/calibration-record.js';

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
  const form = { minStars: 1, kinds: new Set(['missense']), citation: '', before: '' };
  const calibrate = { side: 'auto', rule: CALIBRATION_DEFAULTS.rule, error: String(CALIBRATION_DEFAULTS.error), abnormal: '', normal: '', samples: String(CALIBRATION_DEFAULTS.samples), seed: String(CALIBRATION_DEFAULTS.seed), condition: 0, likelihood: 'prior', prior: '0.1' };

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
            const made = await makeClinVarControls(app, { minStars: form.minStars, kinds: KINDS.filter((k) => form.kinds.has(k)), evaluatedBefore: form.before.trim() || null, run });
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
        const made = makeTableControls(app, { fileName: chosen.name, text: await chosen.text(), citation: form.citation.trim() || null, evaluatedBefore: form.before.trim() || null, run });
        app.focusItem({ kind: 'controls', id: made.id });
        toast(`Made ${controlSetWords(made.set)}.`, { kind: 'ok' });
      } catch (error) {
        toast(error.message, { kind: 'error' });
      }
    } });
    // Classifications made before the assay cannot rest on it (wave 8, slice 6).
    const year = assayYear(store.ws, run?.inputs.design ?? store.ws.design);
    const before = h('input.input', { type: 'text', inputMode: 'numeric', placeholder: year ? String(year) : 'such as 2018', value: form.before, 'aria-label': 'Only classifications last evaluated before this year', style: { maxWidth: '220px' }, oninput: (e) => { form.before = e.target.value; } });
    return h('div.pane', h('h3', icon('plus'), 'New control set'),
      h('label.field', h('span', 'Last evaluated before'), before),
      h('p.muted.small', { style: { marginTop: 0 } }, `Optional: only classifications last evaluated before this year (ClinVar's dates, or a table's last_evaluated column). Those made before the assay was published${year ? ` (${year})` : ''} cannot rest on it; those left out are counted.`),
      h('div.section-title', 'From ClinVar'), clinvar,
      h('div.section-title', { style: { marginTop: '14px' } }, 'From a table'),
      h('p.muted.small', 'A column of variants (p.Trp36Ala, W36A, or ClinVar\'s names) and one of labels (pathogenic, likely pathogenic, benign, likely benign; or abnormal and normal from another assay), numbered on the reference or the target; optionally the date each was last evaluated (last_evaluated).'),
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
      h('p.muted.small', { style: { marginTop: 0 } }, `From ${set.source.kind === 'clinvar' ? `ClinVar's records on ${set.source.transcript}${set.source.retrieved ? `, retrieved ${set.source.retrieved.slice(0, 10)}` : ''}; at least ${set.rules.minStars} review star${set.rules.minStars === 1 ? '' : 's'}` : `${set.source.file.fileName} (SHA-256 ${set.source.file.sha256.slice(0, 12)}…)${set.source.citation ? `, ${set.source.citation}` : ''}; numbered on the ${set.source.numbering}`}; ${set.rules.kinds.join(', ')}${beforeWords(set) ? `; ${beforeWords(set)}` : ''}. Made ${set.created.slice(0, 10)}.`),
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
      h('div.calibration-fields',
        field('Likelihood ratios\' thresholds', h('select.select', { 'aria-label': 'The likelihood ratios\' evidence thresholds', onchange: (e) => { calibrate.likelihood = e.target.value; render(); } },
          h('option', { value: 'prior', selected: calibrate.likelihood === 'prior' }, 'from a prior (acmgscaler)'),
          h('option', { value: 'pejaver', selected: calibrate.likelihood === 'pejaver' }, 'Pejaver et al. 2022 (prior 0.0441)'))),
        calibrate.likelihood === 'prior' ? field('Prior of pathogenicity', input('prior', { type: 'number', min: '0.001', max: '0.97', step: 'any', 'aria-label': 'Prior of pathogenicity' })) : h('div')),
      h('button.btn.primary', { type: 'button', disabled: !ready, title: ready ? null : 'Both sides need scored controls', onclick: async () => {
        try {
          const made = await makeCalibration(app, { set, run, side: calibrate.side, rule: calibrate.rule, error: calibrate.error, abnormal: calibrate.abnormal, normal: calibrate.normal, samples: calibrate.samples, seed: calibrate.seed, condition: calibrate.condition, ...(calibrate.likelihood === 'pejaver' ? { pejaver: true } : { prior: calibrate.prior }) });
          app.focusItem({ kind: 'calibration', id: made.id });
          toast(`Calibrated ${calibrationWords(made.calibration, { set, run, metrics: made.metrics })}.`, { kind: 'ok' });
        } catch (error) {
          toast(error.message, { kind: 'error' });
        }
      } }, icon('gauge'), 'Calibrate'),
      ready ? null : h('p.muted.small', 'Both sides need controls the run scores.'));
  }

  // The published calibrations of the run's record (slice 4): each one's classes and what it says of
  // them, and, for a run of the record's own scores, a calibration with its thresholds, so that
  // MaveScape's OddsPath on these controls stands beside its.
  function publishedPane(set, run, report) {
    const list = publishedCalibrationsOf(store.ws, run);
    if (!list.length) return null;
    const range = (k) => `${k.range[0] === null ? '' : `${k.inclusive[0] ? '≥' : '>'} ${g3(k.range[0])}`}${k.range[0] !== null && k.range[1] !== null ? ' and ' : ''}${k.range[1] === null ? '' : `${k.inclusive[1] ? '≤' : '<'} ${g3(k.range[1])}`}`;
    const ready = report.match.counts.P.scored > 0 && report.match.counts.B.scored > 0;
    return h('div.pane', h('h3', icon('library'), `Published calibrations (${list[0].record.urn})`),
      h('p.muted.small', { style: { marginTop: 0 } }, list[0].applies
        ? `Calibrations of these scores as MaveDB publishes them, each class as its source gives it. Calibrating with one's thresholds puts MaveScape's OddsPath on "${set.name}" beside its own.`
        : `Calibrations of the record's scores as published. ${run.name} scored the counts again, on a scale of its own, so their ranges do not apply to its scores.`),
      ...list.map(({ calibration: c, thresholds }) => h('div', { style: { borderTop: '1px solid var(--line)', padding: '6px 0' } },
        h('div.small', h('b', c.title), c.researchUseOnly ? h('span.badge', { style: { marginLeft: '6px' } }, 'research use') : null, c.investigatorProvided ? h('span.muted', ' · the investigators\'') : null),
        h('div.muted.small', c.classes.filter((k) => Array.isArray(k.range)).map((k) => `${k.label} (${k.className}) ${range(k)}${k.oddsPath !== null ? `, OddsPath ${g3(k.oddsPath)}` : ''}${k.evidence?.strength ? `, ${k.evidence.criterion ?? ''} ${k.evidence.strength}` : ''}`).join('; ') || 'Its classes are given by a column of the scores, not by ranges.'),
        list[0].applies && thresholds ? h('button.btn.small', { type: 'button', disabled: !ready, style: { marginTop: '4px' }, onclick: async () => {
          try {
            const made = await makeCalibration(app, { set, run, published: c.title, samples: calibrate.samples, seed: calibrate.seed, condition: calibrate.condition, ...(calibrate.likelihood === 'pejaver' ? { pejaver: true } : { prior: calibrate.prior }) });
            app.focusItem({ kind: 'calibration', id: made.id });
            toast(`Calibrated with the thresholds of "${c.title}": ${calibrationWords(made.calibration, { set, run, metrics: made.metrics })}.`, { kind: 'ok' });
          } catch (error) {
            toast(error.message, { kind: 'error' });
          }
        } }, icon('gauge'), 'Calibrate with its thresholds') : null)));
  }

  // A calibration's plot as a figure panel (slice 5), drawn again from the calibration.
  const calibrationFigure = (cal, plot, what, size) => figureButton(app, () => ({ kind: 'calibration', calibration: cal.id, plot, ...size }), `${what} of "${cal.name}"`);

  // A calibration's metrics (slice 2): what it was made with, the scores of each side against the
  // run's, the curves, the classes and how far the bootstrap moves the thresholds.
  function calibrationPanes(cal, r, warnings = []) {
    const { metrics: m, scored, set, run } = r;
    const theme = { ...viewTheme(), P: cssVar('--track-pathogenic'), B: cssVar('--track-benign') };
    const frame = (width, height) => ({ width, height, text: 10, theme });
    const t = m.thresholds;
    const classes = variantClasses(scored.view, cal.condition ?? 0, cal.side, cal.thresholds);
    const sideFrom = cal.sideFrom === 'readout' ? 'as the readout says' : cal.sideFrom === 'controls' ? 'where the P controls\' median is, the readout not saying' : 'as chosen';
    // The points of the curves at the thresholds.
    const marks = thresholdPoints(m);
    const head = h('div.pane', h('h3', icon('gauge'), cal.name, mark(cal, 'calibrations'), h('span.spacer'),
      h('button.btn.small', { type: 'button', onclick: async () => {
        if (!(await confirmDialog({ title: `Delete the calibration "${cal.name}"?`, message: 'It goes from the workspace; the history keeps that it was made and deleted.', confirm: 'Delete', danger: true }))) return;
        deleteCalibration(app, cal.id);
      } }, icon('trash'), 'Delete')),
      h('p.small', { style: { marginTop: 0 } }, `${run.name}${scored.condition ? ` (${scored.condition})` : ''} against "${set.name}": ${m.n.P} P and ${m.n.B} B controls scored. Abnormal-like scores are ${cal.side} the others, ${sideFrom}. Thresholds: ${cal.published ? `those of "${cal.published.title}", published with ${cal.published.urn}` : ruleWords(cal.rule, cal.error)}. ${m.bootstrap ? `Intervals from ${count(m.bootstrap.samples)} stratified bootstrap samples (seed ${m.bootstrap.seed}).` : 'No bootstrap.'} Made ${cal.created.slice(0, 10)}.`),
      r.where.against ? h('div.callout.warn', { style: { margin: '0 0 8px' } }, icon('warning'), h('span', `The P controls' median (${g3(r.where.against.P)}) is ${cal.side === 'below' ? 'above' : 'below'} the B controls' (${g3(r.where.against.B)}), though abnormal-like scores are taken to be ${cal.side} the others: the P variants may change function the other way, or the scale may run the other way. Calibrate again with the side chosen if so.`)) : null,
      r.differs ? h('div.callout.danger', { style: { margin: '0 0 8px' } }, icon('warning'), h('span', `Computed again, the thresholds are ${thresholdWords(cal.side, t)}, not the ${thresholdWords(cal.side, cal.thresholds)} kept: MaveScape's computation changed since it was made.`)) : null,
      m.n.P < 10 || m.n.B < 10 ? h('div.callout.warn', { style: { margin: '0 0 8px' } }, icon('warning'), h('span', `With ${Math.min(m.n.P, m.n.B)} controls on a side, every number here is too uncertain to rely on: see the intervals.`)) : null);
    const strips = controlStrips({ all: classes.all.values, P: scored.P, B: scored.B, side: cal.side, thresholds: cal.thresholds, label: `${run.name}'s scores: the P and B controls against the run's ${count(classes.all.total)} scored variants, with the classes the thresholds make` }, frame(900, 210));
    const distributions = h('div.pane#calibration-scores', h('h3', icon('score'), 'Scores of each side', h('span.spacer'), calibrationFigure(cal, 'distribution', 'the scores of each side', { h: 150 })),
      legend(strips.legend), plotSVG(strips, strips.description),
      h('p.muted.small', `${thresholdWords(cal.side, cal.thresholds)}. Medians: P ${g3(m.distributions.P.median)} (quartiles ${g3(m.distributions.P.q1)} to ${g3(m.distributions.P.q3)}), B ${g3(m.distributions.B.median)} (${g3(m.distributions.B.q1)} to ${g3(m.distributions.B.q3)}).`));
    const roc = rocChart({ points: m.roc.points, band: m.roc.band, marks, label: `ROC curve: AUC ${g3(m.auc.auc)}` }, frame(320, 300));
    const pr = prChart({ points: m.pr.points, band: m.pr.band, baseline: m.pr.baseline, marks, label: `Precision–recall curve: area ${g3(m.pr.auc)}` }, frame(320, 300));
    const ab = m.auc.boot;
    const curves = h('div.calibration-grid',
      h('div.pane', h('h3', icon('gauge'), 'ROC curve', h('span.spacer'), calibrationFigure(cal, 'roc', 'the ROC curve', { w: 240, h: 220 })), plotSVG(roc, roc.description, 'plot calibration-curve'),
        h('p.small', `AUC ${g3(m.auc.auc)}: the chance that a P control scores more abnormal-like than a B control (½ for a tie). DeLong's 95% interval ${g3(m.auc.low)} to ${g3(m.auc.high)}${ab ? `; the bootstrap's ${g3(ab.low)} to ${g3(ab.high)}` : ''}.`),
        h('p.muted.small', `The band: the bootstrap's 95% interval of the sensitivity at each specificity (as pROC's ci.se). The circles: the thresholds.`)),
      h('div.pane', h('h3', icon('gauge'), 'Precision–recall curve', h('span.spacer'), calibrationFigure(cal, 'pr', 'the precision–recall curve', { w: 240, h: 220 })), plotSVG(pr, pr.description, 'plot calibration-curve'),
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
    return h('div', head, distributions, curves, h('div.calibration-grid', classesPane, stabilityPane), evidencePanes(cal, r, range, warnings), likelihoodPane(cal, r));
  }

  // Score-level likelihood ratios, for research (slice 4): acmgscaler's method, computed apart (a
  // second), the pane filled when done.
  function likelihoodPane(cal, r) {
    const settings = likelihoodSettings(cal.likelihood ?? {});
    const pane = h('div.pane#calibration-likelihood', { style: { marginTop: '14px' } }, h('h3', icon('gauge'), 'Score-level likelihood ratios, for research (acmgscaler)'),
      h('p.muted', `Computing the likelihood ratios (${likelihoodWords(settings)}, seed ${cal.bootstrap.seed})…`));
    const mine = token;
    likelihoodReport(app, cal).then((lr) => {
      if (mine !== token) return;
      pane.replaceChildren(...likelihoodContent(cal, r, lr));
    }).catch((error) => {
      if (mine !== token) return;
      pane.replaceChildren(h('h3', icon('gauge'), 'Score-level likelihood ratios'), h('div.callout.danger', icon('warning'), h('span', error.message)));
    });
    return pane;
  }

  function likelihoodContent(cal, r, lr) {
    const head = h('h3', icon('gauge'), 'Score-level likelihood ratios, for research (acmgscaler)', ...(lr.problem ? [] : [h('span.spacer'), calibrationFigure(cal, 'likelihood', 'the likelihood ratio of a score', { h: 170 })]));
    const note = h('div.callout.accent', { style: { margin: '0 0 10px' } }, icon('info'), h('span', 'For research use only: how much more likely each score is among the P controls than among the B controls, and the evidence strength that would make for a variant with that score. It is not a classification of any variant.'));
    if (lr.problem) return [head, note, h('p.callout.warn', icon('warning'), h('span', lr.problem))];
    const theme = { ...viewTheme(), P: cssVar('--track-pathogenic'), B: cssVar('--track-benign') };
    const res = lr.result;
    const chart = likelihoodChart({ grid: res.curve.grid, llr: res.curve.llr, lo: res.curve.lo, hi: res.curve.hi, thresholds: res.thresholds.map((t) => t.lr), P: r.scored.P, B: r.scored.B, label: `The likelihood ratio of a score (P : B), on a log scale, with the interval of its bootstrap's median and the evidence thresholds` }, { width: 900, height: 280, text: 10, theme });
    const fmtLr = (v) => (v >= 1 ? g3(v) : `1/${g3(1 / v)}`);
    // Each strength from its boundary on: the pathogenic ones beyond their score, the benign below.
    const rows = [7, 6, 5, 4, 3, 2, 1, 0].map((k) => {
      const t = res.thresholds[k];
      const reached = k >= 4 ? EVIDENCE[k + 1] : EVIDENCE[k];
      return h('tr', h('td', reached), h('td.r', fmtLr(t.lr)), h('td.r', t.score === null ? 'not reached' : g3(t.score)), h('td.r', t.lower === null || t.upper === null ? '—' : `${g3(t.lower)} to ${g3(t.upper)}`));
    });
    const counts = EVIDENCE.slice().reverse().map((e) => h('tr', h('td', e), h('td.r', String(lr.counts.P[e])), h('td.r', String(lr.counts.B[e])), h('td.r', lr.counts.missense[e].toLocaleString('en-US'))));
    const unreached = res.thresholds.filter((t) => t.score === null);
    return [head, note,
      legend(chart.legend), plotSVG(chart, chart.description),
      h('div.calibration-grid',
        h('div', h('div.section-title', 'Where each strength begins'),
          h('div.table-scroll', h('table.data.compact', h('thead', h('tr', h('th', 'Strength'), h('th.r', 'Ratio'), h('th.r', 'Score'), h('th.r', 'Interval'))), h('tbody', ...rows))),
          h('p.muted.small', `The score where the curve crosses each ratio, and where its interval's ends do; "not reached": no score gives that strength. ${unreached.length ? `${unreached.length} of the 8 are not reached.` : ''}`)),
        h('div', h('div.section-title', 'Variants at each strength'),
          h('div.table-scroll', h('table.data.compact', h('thead', h('tr', h('th', 'Strength'), h('th.r', 'P controls'), h('th.r', 'B controls'), h('th.r', `${r.run.name}'s missense`))), h('tbody', ...counts))),
          h('p.muted.small', 'A variant\'s strength is read from the conservative end of its ratio\'s interval, as acmgscaler reads it. The controls\' own strengths rest on themselves: they estimated the ratios.'))),
      h('p.muted.small', `acmgscaler's method (Badonyi, Bioinformatics 2025; ported from its R package 1.0.0, MIT, and equal to it): each side's density, a Gaussian kernel of its biased cross-validation bandwidth, in 1,000 bootstrap samples (seed ${cal.bootstrap.seed}); their log ratio, regularized and made monotone, the samples' median with an order-statistic interval. Thresholds: ${likelihoodWords(lr.settings)}; a single line of very strong evidence a ratio of c, strong √c, moderate c^¼, supporting c^⅛ (Tavtigian et al. 2018), benign the reciprocals. ${res.curve.inverse ? 'Lower scores are the more pathogenic here.' : 'Higher scores are the more pathogenic here.'}`)];
  }

  // Evidence strength, for research (slice 3): each class's OddsPath (Brnich et al. 2019) and its
  // strength by their Table 3, how the bootstrap moves it, and beside it what it rests on: the
  // controls' composition and the calibration's limitations. Assay validity, a variant's functional
  // class and clinical classification are said apart (K3).
  function evidencePanes(cal, r, range, warnings) {
    const { metrics: m, set, run } = r;
    const ev = m.evidence;
    const bootText = (x) => {
      if (!x.boot) return '—';
      const shares = STRENGTH_CODES.filter((code) => x.boot.strengths[code]).map((code) => `${code === 'Indeterminate' ? 'indeterminate' : code} ${percentText(x.boot.strengths[code])}`);
      if (x.boot.empty) shares.push(`no control ${percentText(x.boot.empty / x.boot.samples)}`);
      return `${x.boot.n ? `${g3(x.boot.low)} to ${g3(x.boot.high)}; ` : ''}${shares.join(', ')}`;
    };
    // The published calibration whose thresholds these are, and what it states of each class.
    const pub = cal.published ? publishedCalibrationsOf(store.ws, run).find((x) => x.calibration.title === cal.published.title) : null;
    const pubEvidence = pub ? publishedEvidence(pub.calibration) : null;
    const row = (which) => {
      const x = ev[which];
      const stated = pubEvidence?.[which];
      return h('tr', h('td', `${x.class} (${range[x.class]})`), h('td.r', String(x.P)), h('td.r', String(x.B)),
        h('td.r', x.oddsPath === null ? '—' : g3(x.oddsPath)),
        h('td', x.strength ? h('b', strengthWords(x.strength)) : 'no control'),
        h('td.small', bootText(x)),
        pub ? h('td.small', stated ? `${g3(stated.oddsPath)}${stated.strength ? ` (${stated.criterion ?? ''} ${stated.strength})` : ''}; as observed here ${x.observed === null ? '—' : g3(x.observed)}` : '—') : null);
    };
    const c = composition(set);
    const words = (counts) => Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([w, n]) => `${w} ${n}`).join(', ');
    const limits = evidenceLimitations({ rule: cal.rule, metrics: m, warnings, where: r.where });
    const strength = h('div.pane#calibration-evidence', h('h3', icon('gauge'), 'Evidence strength, for research (OddsPath)'),
      h('div.callout.accent', { style: { margin: '0 0 10px' } }, icon('info'), h('span', 'For research use only: what each class would contribute as functional evidence (PS3 for the abnormal-like class, BS3 for the WT-like), by Brnich et al. (2019)\'s OddsPath and their Table 3. It is not a classification of any variant.')),
      h('div.table-scroll', h('table.data.compact',
        h('thead', h('tr', h('th', 'Class (scores)'), h('th.r', 'P'), h('th.r', 'B'), h('th.r', 'OddsPath'), h('th', 'Evidence strength'), h('th', `${m.bootstrap ? `Bootstrap (${m.bootstrap.samples.toLocaleString('en-US')}, thresholds kept)` : 'Bootstrap'}`), pub ? h('th', `"${pub.calibration.title}" states`) : null)),
        h('tbody', row('abnormal'), row('normal')))),
      h('p.muted.small', `P1, the P controls' share, is ${m.n.P} of ${m.n.P + m.n.B} (${g3(ev.abnormal.prior)}); P2 is the P share in the class with one control of the other side added, as Brnich et al. add "exactly one misclassified variant to each set"; OddsPath = P2 (1 − P1) / ((1 − P2) P1). Strengths: beyond 2.1 PS3_supporting, 4.3 moderate, 18.7 strong (PS3), 350 very strong; below 0.48 BS3_supporting, 0.23 moderate, 0.053 strong (BS3); between, indeterminate.`));
    // Four things said apart (K3).
    const apart = h('div.pane', h('h3', icon('info'), 'Four things kept apart'),
      h('p.small', { style: { marginTop: 0 } }, h('b', 'The assay: '), `how far its scores separate these controls, AUC ${g3(m.auc.auc)} (${g3(m.auc.low)} to ${g3(m.auc.high)}).`),
      h('p.small', h('b', 'A variant\'s functional class: '), 'abnormal-like, intermediate or WT-like, by its score and these thresholds, in this assay.'),
      h('p.small', h('b', 'Evidence strength: '), 'what a class would contribute as functional evidence (PS3 or BS3), for research.'),
      h('p.small', h('b', 'Clinical classification: '), 'not made by MaveScape. Functional evidence is one input among many to a classification made elsewhere, by those qualified to make it.'));
    const rests = h('div.pane', h('h3', icon('warning'), 'What it rests on'),
      h('p.small', { style: { marginTop: 0 } }, `${m.n.P} P and ${m.n.B} B controls of "${set.name}" scored in ${run.name}${set.source.kind === 'clinvar' ? `: ClinVar's records on ${set.source.transcript}, at least ${set.rules.minStars} review star${set.rules.minStars === 1 ? '' : 's'}` : `: ${set.source.file.fileName}${set.source.citation ? `, ${set.source.citation}` : ''}`}; ${set.rules.kinds.join(', ')}${beforeWords(set) ? `; ${beforeWords(set)}` : ''}.`),
      h('p.small', h('b', 'P'), ` in the set (${c.P.total}): `, words(c.P.labels)), h('p.small', h('b', 'B'), ` in the set (${c.B.total}): `, words(c.B.labels)),
      limits.length
        ? h('div', ...limits.map((l) => h('div.callout.warn', { style: { margin: '0 0 6px' } }, icon('warning'), h('span', l.text))))
        : h('p.callout.ok', icon('check'), h('span', 'Nothing MaveScape checks for limits it.')));
    return h('div', { style: { marginTop: '14px' } }, strength, h('div.calibration-grid', apart, rests));
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
      right.append(compositionPane(set, run, report), warningsPane(run, report), calibratePane(set, run, report), publishedPane(set, run, report));
      if (cal) {
        const waiting = h('p.muted', `Computing "${cal.name}"…`);
        below.append(waiting);
        try {
          const r = await calibrationReport(app, cal);
          if (mine !== token) return;
          waiting.replaceWith(calibrationPanes(cal, r, report.warnings));
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
