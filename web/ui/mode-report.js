// The Report view (wave 6, slice 4; requirement R4): the workspace's methods, written again from its
// record on every change (lib/report.js): each run's data, design, scoring with its parameters and
// QC; the comparisons and robustness checks kept in the report; selections, annotations,
// structures, figures; every input's SHA-256; the software; the decision log; the limitations;
// references. Copied as Markdown or downloaded with its BibTeX. Beside it, the analyses kept in the
// report (each can be taken out) and the robustness checks of this session not yet in it; and the
// checkpoints (wave 6, slice 5): kept here, each compared with now or with another, the changes
// shown above the report (ui/diff.js); and the certificate (wave 6, slice 6: ui/certificate.js),
// made and verified here.

import { h, icon, clear, downloadBlob } from './dom.js';
import { toast } from './overlays.js';
import { analysisName } from '../lib/report.js';
import { possessive } from '../lib/words.js';
import { keepInReport, keptLike, removeFromReport, reportOf, robustnessForReport } from './report.js';
import { askCheckpoint, deleteCheckpoint, diffWith, stateOf } from './diff.js';
import { pairWords } from '../lib/diff.js';
import { mapSVG } from '../lib/map-svg.js';
import { confirmDialog } from './overlays.js';
import { certificatePane } from './certificate.js';

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
  const changesEl = h('div');
  let changesToken = 0;
  const side = h('div.report-side');
  const headActions = h('div.btn-row');
  const root = h('div.view',
    h('div.workbench-head', h('h1', icon('report'), 'Report'), h('span.spacer'), headActions),
    h('div.report-layout', h('div.report-main', changesEl, doc), side));
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
    side.append(certificatePane(app));
    // Checkpoints: each compared with now, or deleted.
    const checkpoints = ws.checkpoints ?? [];
    const shown = app.reportView?.from ?? null;
    side.append(h('div.pane', h('h3', icon('branch'), 'Checkpoints', h('span.spacer'), h('button.btn.small', { type: 'button', title: 'Keep the analysis as it stands, to see later what changed since', onclick: () => askCheckpoint(app) }, icon('plus'), 'Keep')),
      checkpoints.length
        ? h('ul.report-kept', ...checkpoints.slice().reverse().map((c) => h(`li${c.id === shown ? '.selected' : ''}`,
          h('span', c.name, h('span.muted', { title: c.created }, ` · ${new Date(c.created).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`)),
          h('span.btn-row',
            h('button.btn.small', { type: 'button', title: `What changed since "${c.name}"`, onclick: () => showChanges(c.id, 'now') }, 'Changes'),
            h('button.icon-button', { type: 'button', title: 'Delete the checkpoint', 'aria-label': `Delete the checkpoint "${c.name}"`, onclick: async () => {
              if (await confirmDialog({ title: 'Delete the checkpoint?', message: `"${c.name}" will no longer be kept with the workspace (its deletion is in the history; undo brings it back).`, confirm: 'Delete', danger: true })) deleteCheckpoint(app, c.id);
            } }, icon('trash'))))))
        : h('p.muted', { style: { margin: 0 } }, 'Keep a checkpoint before changing the analysis (a parameter, a filter, the design, a threshold): the report then says what changed since and what it did to the scores.')));
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

  // The changes from one state to another, above the report.
  function showChanges(from, to) {
    app.reportView = from ? { from, to } : null;
    renderSide();
    renderChanges();
    if (from) root.querySelector('.report-main')?.scrollTo({ top: 0 });
  }

  async function renderChanges() {
    const mine = ++changesToken;
    const view = app.reportView;
    const from = view?.from ? stateOf(app, view.from) : null;
    const to = view?.from ? stateOf(app, view.to ?? 'now') : null;
    if (!from || !to) {
      clear(changesEl);
      return;
    }
    if (!changesEl.firstChild) changesEl.append(h('article.report-doc.report-changes', h('p.muted', `Comparing ${from.label} with ${to.label}: the runs' scores and QC are read first…`)));
    const result = await diffWith(app, from, to).catch((error) => ({ error }));
    if (mine !== changesToken) return;
    clear(changesEl);
    const others = (store.ws.checkpoints ?? []).filter((c) => c.id !== from.id);
    const toSelect = h('select.input', { 'aria-label': 'Compare with', onchange: (event) => showChanges(from.id, event.target.value) },
      h('option', { value: 'now', selected: to.id === 'now' }, 'now'), ...others.map((c) => h('option', { value: c.id, selected: to.id === c.id }, `"${c.name}"`)));
    const art = h('article.report-doc.report-changes',
      h('div.report-changes-head', h('h2.report-title', `Changes since ${from.label}`), h('span.muted', 'to'), toSelect, h('span.spacer'),
        h('button.icon-button', { type: 'button', title: 'Close the changes', 'aria-label': 'Close the changes', onclick: () => showChanges(null) }, icon('close'))));
    if (result.error) {
      art.append(h('div.callout.danger', icon('warning'), h('span', `The changes could not be worked out: ${result.error.message}`)));
      changesEl.append(art);
      return;
    }
    const { diff, maps } = result;
    art.append(h('p', diff.summary));
    if (diff.changes.length) art.append(h('ul', ...diff.changes.map((c) => h('li', c.text))));
    diff.pairs.forEach((p, i) => {
      art.append(h('h3', p.a.id === p.b.id ? `${p.b.name}: its QC` : `${p.a.name} → ${p.b.name}`));
      for (const line of pairWords(p)) art.append(h('p', line));
      const t = p.targets.find((x) => x.variants.length);
      if (t) {
        const f = (x) => (Number.isFinite(x) ? x.toFixed(3) : '—');
        art.append(h('div.report-table', h('p.muted', `The variants that moved most${p.targets.length > 1 ? ` (${t.name})` : ''}: each effect (its score less the wild type's) before and after${t.units?.factor ? `, after in ${possessive(p.a.name)} units` : ''}, and the move over its earlier SE.`),
          h('div.table-scroll', h('table.data.compact', h('thead', h('tr', h('th', 'Variant'), h('th.r', 'Before'), h('th.r', 'After'), h('th.r', 'z'), h('th', 'Class'))),
            h('tbody', ...t.variants.slice(0, 12).map((v) => h('tr', h('td', v.variant), h('td.r', f(v.before)), h('td.r', f(v.after)), h('td.r', f(v.z)), h('td', v.from === v.to ? v.to : `${v.from} → ${v.to}`))))))));
      }
      const map = maps[i];
      if (map) {
        const box = h('div.report-change-map', { role: 'img', 'aria-label': `The map of the change, ${p.b.name} − ${p.a.name}: each variant's effect after less before` });
        box.innerHTML = mapSVG(map.model, { cellW: 7, cellH: 8, results: map.results, title: `${p.b.name} − ${p.a.name}` });
        art.append(h('p.muted', 'The map of the change: each variant\'s effect after less before (blue lower, red higher); gray where either did not score it.'), box);
      }
    });
    changesEl.append(art);
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
  renderChanges();
  return {
    update(topics) {
      if (topics.has('ws') || topics.has('workspace-loaded') || topics.has('results')) {
        refresh();
        if (topics.has('workspace-loaded')) app.reportView = null;
        renderChanges();
      } else if (topics.has('robustness') || topics.has('certificate')) renderSide();
      else if (topics.has('report-view')) {
        renderSide();
        renderChanges();
      }
    },
    destroy() {
      clearTimeout(timer);
      token += 1;
      root.remove();
    },
  };
}
