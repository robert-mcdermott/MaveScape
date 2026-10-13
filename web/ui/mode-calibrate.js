// The Calibrate view (wave 8; requirements K1–K4), for research. Slice 1: control sets, variants of
// known effect with each label as its source gives it (lib/controls.js). Made here from the ClinVar
// annotation beside the map or from a table of labels; for the run shown, a set's composition, what
// of it the run measured, what may make it circular, and its labels. Nothing here runs by itself:
// a set is made when asked, and MaveScape reports functional evidence, never a variant's clinical
// classification (mavescape-spec/conventions.md).

import { h, icon, clear } from './dom.js';
import { toast, confirmDialog } from './overlays.js';
import { activeRun } from './selections.js';
import { addPublicTrack } from './tracks.js';
import { attributed, clinvarAnnotation, controlsForRun, deleteControlSet, makeClinVarControls, makeTableControls } from './controls.js';
import { KINDS, SIDES, controlSetWords } from '../lib/controls.js';
import { heldRemoval, proposalOfItem } from '../lib/proposals.js';

const LABEL_ROWS = 300;
const SIDE_WORDS = { P: 'P: pathogenic or likely pathogenic, or abnormal, as their source says', B: 'B: benign or likely benign, or normal, as their source says' };

export function mountCalibrateMode(app, container) {
  const { store } = app;
  let token = 0;
  const title = h('span.muted');
  const body = h('div.view-body');
  const root = h('div.view', h('div.workbench-head', h('h1', icon('calibrate'), 'Calibrate'), title), body);
  container.append(root);
  // The form's choices, kept while the view is open.
  const form = { minStars: 1, kinds: new Set(['missense']), citation: '' };

  const selectedSet = () => {
    const list = store.ws.controlSets ?? [];
    const focus = store.ui.focus;
    return (focus?.kind === 'controls' && list.find((c) => c.id === focus.id)) || list.at(-1) || null;
  };

  function mark(item) {
    const proposal = proposalOfItem(store.ws, item);
    if (proposal) return h('span.badge.accent', { title: `Proposed by ${proposal.author}: accept or reject it above the view` }, 'proposed');
    const removal = heldRemoval(store.ws, 'controlSets', item.id);
    return removal ? h('span.badge.danger', { title: `${removal.proposal.author} proposes deleting it` }, 'remove?') : null;
  }

  function setsPane(selected) {
    const list = store.ws.controlSets ?? [];
    return h('div.pane', h('h3', icon('calibrate'), 'Control sets'),
      list.length
        ? h('div', { role: 'list' }, ...list.map((c) => h(`button.dataset-row${c === selected ? '.selected' : ''}`, { type: 'button', role: 'listitem', 'aria-current': c === selected ? 'true' : null, onclick: () => app.focusItem({ kind: 'controls', id: c.id }) },
          icon('calibrate'), h('span.label', c.name), mark(c), h('span.meta', `${c.labels.filter((l) => l.side === 'P').length} P · ${c.labels.filter((l) => l.side === 'B').length} B`))))
        : h('p.muted.small', 'None yet. A control set holds variants whose effect is known, each label as its source gives it: make one from ClinVar\'s records of the gene, or from a table of labels.'));
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
    return h('div.pane', h('h3', icon('calibrate'), set.name, mark(set), h('span.spacer'),
      h('button.btn.small', { type: 'button', onclick: async () => {
        if (!(await confirmDialog({ title: `Delete the control set "${set.name}"?`, message: 'It goes from the workspace; the history keeps that it was made and deleted.', confirm: 'Delete', danger: true }))) return;
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
    const run = activeRun(app);
    const set = selectedSet();
    title.textContent = run ? ` · ${run.name}` : '';
    const left = h('div', setsPane(set), newSetPane(run));
    const right = h('div');
    // The labels below both columns, at their full width.
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
      right.append(compositionPane(set, run, report), warningsPane(run, report));
      below.append(labelsPane(set, run, report));
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
