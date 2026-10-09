// The workflow strip above the views: the analysis as steps (lib/workflow.js), each done, next,
// needing attention or still to do, and the one step to take next said in words with its button.
// Clicking a step opens its view.

import { h, icon, clear } from './dom.js';
import { showMenu } from './overlays.js';
import { currentRun, currentSource, focusStep, workflowSteps } from '../lib/workflow.js';
import { draftFromColumns } from './design-draft.js';
import { chooseArchiveExport, runExportItems } from './record.js';

const VIEW = { counts: 'experiment', target: 'experiment', design: 'experiment', score: 'score', qc: 'qc', map: 'map', record: 'score' };
const FASTA = '.fasta,.fa,.faa,.fna,.fas,.seq';

export function mountWorkflow(app, el) {
  const { store } = app;
  app.seen ??= { qc: new Map(), map: new Set() };

  async function act(step, event) {
    const action = step.action;
    if (!action) return;
    if (action.kind === 'open') app.pickFiles();
    else if (action.kind === 'open-fasta') app.pickFiles(FASTA);
    else if (action.kind === 'mode') app.setMode(action.mode);
    else if (action.kind === 'focus') {
      const s = currentSource(store.ws);
      if (s) app.focusItem({ kind: 'source', id: s.id });
    } else if (action.kind === 'draft') {
      const s = currentSource(store.ws);
      if (!s) return;
      await draftFromColumns(app, s);
      app.setMode('experiment');
    } else if (action.kind === 'export') {
      const run = currentRun(store.ws) ?? store.ws.runs.at(-1);
      showMenu(event.currentTarget, [...(run ? runExportItems(app, run) : []), '-', { label: 'Workspace archive (.msz)…', icon: 'download', onSelect: () => chooseArchiveExport(app) }]);
    }
  }

  function render() {
    clear(el);
    const ws = store.ws;
    const empty = !ws.sources.length && !ws.targets.length && !ws.runs.length;
    el.hidden = empty && store.ui.mode === 'welcome';
    if (el.hidden) return;
    const steps = workflowSteps(ws, app.seen);
    const focus = focusStep(steps);
    const list = h('ol.workflow-steps', { 'aria-label': 'Analysis steps' }, ...steps.map((s, i) => {
      const mark = s.state === 'done' ? icon(s.verdict === 'fail' || s.verdict === 'review' ? 'warning' : 'check') : s.state === 'attention' ? icon('warning') : h('span.workflow-number', String(i + 1));
      const status = s.state === 'done' ? 'done' : s.state === 'next' ? 'the next step' : s.state === 'attention' ? 'needs attention' : s.state === 'optional' ? 'optional' : 'to do';
      return h(`li.workflow-step.${s.state}${s.verdict ? `.verdict-${s.verdict}` : ''}${store.ui.mode === VIEW[s.id] && (s.id !== 'record') ? '.here' : ''}`,
        h('button', { type: 'button', title: s.detail, 'aria-label': `${s.label}: ${status}. ${s.detail}`, onclick: () => app.setMode(VIEW[s.id]) }, mark, h('span', s.label)));
    }));
    const next = focus ? h(`div.workflow-next.${focus.state}`, h('span.workflow-next-text', h('b', `${focus.state === 'attention' ? 'Needs attention' : focus.state === 'optional' ? 'All done' : 'Next'}: `), focus.detail),
      focus.action ? h(`button.btn.small${focus.state === 'next' ? '.primary' : ''}`, { type: 'button', onclick: (event) => act(focus, event) }, focus.action.label) : null) : null;
    el.append(list, next);
  }

  render();
  return {
    render,
    update(topics) {
      if (topics.has('ws') || topics.has('mode') || topics.has('workflow') || topics.has('workspace-loaded')) render();
    },
  };
}
