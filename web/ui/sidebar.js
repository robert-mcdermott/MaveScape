// The dataset tree: what the workspace holds, by kind (tables, targets, the design, score runs,
// selections). Selecting an item focuses it (store.ui.focus): the inspector describes it, and the
// views that use it open on it.

import { h, icon, clear, formatCount } from './dom.js';

const SECTIONS = [
  {
    kind: 'source', title: 'Tables', icon: 'table',
    items: (ws) => ws.sources,
    label: (s) => s.name ?? s.fileName ?? 'Table',
    meta: (s) => (Number.isFinite(s.rows) ? `${formatCount(s.rows)} rows` : ''),
    empty: 'Count or score tables (CSV, TSV, Excel) you import appear here.',
    action: { label: 'Open a table', run: (app) => app.pickFiles() },
  },
  {
    kind: 'target', title: 'Targets', icon: 'sequence',
    items: (ws) => ws.targets,
    label: (t) => t.name ?? 'Target',
    meta: (t) => (t.sequence ? `${formatCount(t.sequence.length)} ${t.sequenceType === 'dna' ? 'nt' : 'aa'}` : ''),
    empty: 'The reference sequence the variants are named against (FASTA, or pasted).',
  },
  {
    kind: 'design', title: 'Design', icon: 'experiment',
    items: (ws) => (ws.design ? [{ id: 'design', ...ws.design }] : []),
    label: (d) => d.name ?? 'Experiment design',
    meta: (d) => (d.samples ? `${d.samples.length} samples` : ''),
    empty: 'Samples, roles, conditions and replicates, set in the Experiment view.',
  },
  {
    kind: 'run', title: 'Score runs', icon: 'score',
    items: (ws) => ws.runs,
    label: (r) => r.name ?? r.model ?? 'Score run',
    meta: (r) => r.created?.slice(0, 10) ?? '',
    empty: 'Each scoring of the counts, with its parameters, kept unchanged.',
  },
  {
    kind: 'selection', title: 'Selections', icon: 'target',
    items: (ws) => ws.selections,
    label: (s) => s.name ?? 'Selection',
    meta: (s) => (s.keys ? `${formatCount(s.keys.length)}` : ''),
    empty: 'Named sets of variants or positions, made on the map.',
  },
];

export function mountSidebar(app) {
  const root = document.getElementById('sidebar');

  function render() {
    const { ws, ui } = app.store;
    clear(root);
    const body = h('div.panel-body', { style: { paddingTop: '4px' } });
    for (const section of SECTIONS) {
      const items = section.items(ws);
      const list = h('div', { role: 'list' });
      for (const item of items) {
        const selected = ui.focus?.kind === section.kind && ui.focus?.id === item.id;
        list.append(h(`button.dataset-row${selected ? '.selected' : ''}`, {
          type: 'button',
          role: 'listitem',
          'aria-current': selected ? 'true' : null,
          title: section.label(item),
          onclick: () => app.focusItem({ kind: section.kind, id: item.id }),
        }, icon(section.icon), h('span.label', section.label(item)), h('span.meta', section.meta(item))));
      }
      if (!items.length) {
        list.append(h('p.tree-empty', section.empty));
        if (section.action) list.append(h('button.drop-hint', { type: 'button', style: { width: 'calc(100% - 12px)' }, onclick: () => section.action.run(app) }, `${section.action.label}, or drop files here`));
      }
      body.append(h('section.tree-section', { 'aria-label': section.title },
        h('div.panel-head', h('h2', section.title, items.length ? h('span.muted', `· ${items.length}`) : null)),
        list));
    }
    root.append(h('div.panel', { style: { flex: '1' } }, body));
  }

  return {
    render,
    update(topics) {
      if (topics.has('ws') || topics.has('focus') || topics.has('workspace-loaded')) render();
    },
  };
}
