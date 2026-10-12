// The Report view (wave 6, slice 4; requirement R4): the workspace's methods, written again from its
// record on every change (lib/report.js): each run's data, design, scoring with its parameters and
// QC; the comparisons and robustness checks kept in the report; selections, annotations,
// structures, figures; every input's SHA-256; the software; the decision log; the limitations;
// references. Copied as Markdown or downloaded with its BibTeX. Beside it, the analyses kept in the
// report (each can be taken out) and the robustness checks of this session not yet in it.

import { h, icon, clear, downloadBlob } from './dom.js';
import { toast } from './overlays.js';
import { analysisName } from '../lib/report.js';
import { possessive } from '../lib/words.js';
import { keepInReport, keptLike, removeFromReport, reportOf, robustnessForReport } from './report.js';

const safe = (s) => String(s).replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'report';

// Text with its citations ([3], [1] [2]) as links to the references, and its Markdown code spans
// (`model`) as code.
function cited(text) {
  const out = [];
  let at = 0;
  text = String(text);
  for (const m of text.matchAll(/\[(\d+)\]|`([^`]+)`/g)) {
    if (m.index > at) out.push(text.slice(at, m.index));
    out.push(m[2] !== undefined ? h('code', m[2]) : h('a.report-cite', { href: `#report-ref-${m[1]}` }, m[0]));
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

function blockEl(b) {
  if (b.kind === 'p') return h('p', b.label ? h('b', `${b.label}. `) : null, ...cited(b.text));
  if (b.kind === 'list') return h('ul', ...b.items.map((x) => h('li', ...cited(x))));
  return h('div.report-table',
    b.caption ? h('p.muted', b.caption) : null,
    h('div.table-scroll', h('table.data.compact', h('thead', h('tr', ...b.columns.map((c) => h('th', c)))), h('tbody', ...b.rows.map((r) => h('tr', ...r.map((c) => h('td', ...cited(String(c))))))))));
}

export function mountReportMode(app, container) {
  const { store } = app;
  let report = null;
  let token = 0;
  let timer = null;
  const doc = h('article.report-doc', h('p.muted', 'Writing the report: each run\'s QC and scores are read first…'));
  const side = h('div.report-side');
  const headActions = h('div.btn-row');
  const root = h('div.view',
    h('div.workbench-head', h('h1', icon('report'), 'Report'), h('span.spacer'), headActions),
    h('div.report-layout', h('div.report-main', doc), side));
  container.append(root);

  function renderHead() {
    clear(headActions);
    const ready = Boolean(report);
    headActions.append(
      h('button.btn', { type: 'button', disabled: !ready, title: 'Copy the report as Markdown', onclick: async () => {
        try {
          await navigator.clipboard.writeText(report.markdown);
          toast('The report is on the clipboard (Markdown).', { kind: 'ok' });
        } catch (error) {
          toast(`The clipboard refused it: ${error.message}`, { kind: 'error' });
        }
      } }, icon('copy'), 'Copy'),
      h('button.btn', { type: 'button', disabled: !ready, onclick: () => downloadBlob(new Blob([report.markdown], { type: 'text/markdown' }), `${safe(store.ws.name)}_report.md`) }, icon('download'), 'Markdown'),
      h('button.btn', { type: 'button', disabled: !ready, onclick: () => downloadBlob(new Blob([report.bibtex], { type: 'application/x-bibtex' }), `${safe(store.ws.name)}_report.bib`) }, icon('download'), 'BibTeX'));
  }

  function renderDoc() {
    clear(doc);
    doc.append(h('h2.report-title', report.title));
    for (const s of report.sections) {
      if (s.title) doc.append(h('h3', { id: `report-${s.id}` }, s.title));
      for (const b of s.blocks) doc.append(blockEl(b));
    }
    if (report.references.length) {
      doc.append(h('h3', { id: 'report-references' }, 'References'),
        h('ol.report-references', ...report.references.map((r) => h('li', { id: `report-ref-${r.n}` }, r.text))));
    }
  }

  function renderSide() {
    clear(side);
    const ws = store.ws;
    if (report) {
      side.append(h('div.pane', h('h3', icon('menu'), 'Contents'),
        h('ul.report-contents', ...report.sections.filter((s) => s.title).map((s) => h('li', h('a', { href: `#report-${s.id}`, onclick: (event) => {
          event.preventDefault();
          doc.querySelector(`#report-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } }, s.title))), report.references.length ? h('li', h('a', { href: '#report-references', onclick: (event) => {
          event.preventDefault();
          doc.querySelector('#report-references')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } }, 'References')) : null)));
    }
    const kept = ws.analyses ?? [];
    side.append(h('div.pane', h('h3', icon('report'), 'Kept in the report'),
      kept.length
        ? h('ul.report-kept', ...kept.map((a) => h('li', h('span', analysisName(a).replace(/^./, (c) => c.toUpperCase()), h('span.muted', ` · ${String(a.created ?? '').slice(0, 10)}`)),
          h('button.icon-button', { type: 'button', title: 'Take it out of the report', 'aria-label': `Take ${analysisName(a)} out of the report`, onclick: () => removeFromReport(app, a.id) }, icon('close')))))
        : h('p.muted', { style: { margin: 0 } }, 'Nothing yet. A comparison (Compare view) or a run\'s robustness check (Score view) is the session\'s until you add it to the report: then the workspace keeps what it found.')));
    // Robustness checks of this session not yet in the report.
    const checks = [...(app.robustness ?? new Map())].map(([id, state]) => ({ run: ws.runs.find((r) => r.id === id), state }))
      .filter((x) => x.run && x.state.status === 'done' && x.state.output === x.run.output.sha256 && !keptLike(ws, robustnessForReport(x.run, x.state)));
    if (checks.length) {
      side.append(h('div.pane', h('h3', icon('gauge'), 'Checked in this session'),
        h('ul.report-kept', ...checks.map(({ run, state }) => h('li', h('span', `${possessive(run.name)} robustness (${state.summary.total - 1} alternative analyses)`),
          h('button.btn.small', { type: 'button', onclick: () => keepInReport(app, robustnessForReport(run, state)) }, icon('plus'), 'Add'))))));
    }
  }

  function refresh() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const mine = ++token;
      try {
        const next = await reportOf(app);
        if (mine !== token) return;
        report = next;
        renderDoc();
      } catch (error) {
        if (mine !== token) return;
        clear(doc);
        doc.append(h('div.callout.danger', icon('warning'), h('span', `The report could not be written: ${error.message}`)));
      }
      renderHead();
      renderSide();
    }, 60);
  }

  renderHead();
  renderSide();
  refresh();
  return {
    update(topics) {
      if (topics.has('ws') || topics.has('workspace-loaded') || topics.has('results')) refresh();
      else if (topics.has('robustness')) renderSide();
    },
    destroy() {
      clearTimeout(timer);
      token += 1;
      root.remove();
    },
  };
}
