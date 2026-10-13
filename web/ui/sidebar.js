// The dataset tree: what the workspace holds, by kind (tables, targets, the design, score runs,
// structure views, selections, control sets). Selecting an item focuses it (store.ui.focus): the
// inspector describes it, and the views that use it open on it.

import { h, icon, clear, formatCount } from './dom.js';
import { heldOfKind, heldRemoval, proposalOfItem } from '../lib/proposals.js';

const SECTIONS = [
  {
    kind: 'source', collection: 'sources', title: 'Tables', icon: 'table',
    items: (ws) => ws.sources,
    label: (s) => s.name ?? s.fileName ?? 'Table',
    meta: (s) => (Number.isFinite(s.rows) ? `${formatCount(s.rows)} rows` : ''),
    empty: 'Count or score tables (CSV, TSV, Excel) you import appear here.',
    action: { label: 'Open a table', run: (app) => app.pickFiles() },
  },
  {
    kind: 'target', collection: 'targets', title: 'Targets', icon: 'sequence',
    items: (ws) => ws.targets,
    label: (t) => t.name ?? 'Target',
    meta: (t) => (t.sequence ? `${formatCount(t.sequence.length)} ${t.sequenceType === 'dna' ? 'nt' : 'aa'}` : ''),
    empty: 'The reference sequence the variants are named against (FASTA, or pasted).',
  },
  {
    kind: 'design', title: 'Design', icon: 'experiment',
    items: (ws) => (ws.design ? [{ id: 'design', ...ws.design }] : []),
    label: (d) => d.name ?? 'Experiment design',
    meta: (d) => (d.model === 'scores' ? 'published scores' : d.samples ? `${d.samples.length} samples` : ''),
    empty: 'Samples, roles, conditions and replicates, set in the Experiment view.',
  },
  {
    kind: 'run', collection: 'runs', title: 'Score runs', icon: 'score',
    items: (ws) => ws.runs,
    label: (r) => r.name ?? r.model ?? 'Score run',
    meta: (r) => (r.output ? `${formatCount(r.output.conditions[0]?.scored ?? 0)} scored` : ''),
    empty: 'Each scoring of the counts, with its parameters, kept unchanged.',
  },
  {
    // Views of structures saved in Structure (wave 5, slice 5).
    kind: 'structureView', collection: 'structureViews', title: 'Structure views', icon: 'structure',
    items: (ws) => ws.structureViews ?? [],
    label: (v) => v.name ?? 'View',
    meta: (v) => v.chain ?? '',
    empty: 'Views saved in Structure: the structure, its camera, colors and selection.',
  },
  {
    kind: 'selection', collection: 'selections', title: 'Selections', icon: 'target',
    items: (ws) => ws.selections,
    label: (s) => s.name ?? 'Selection',
    meta: (s) => (s.keys ? `${formatCount(s.keys.length)}` : ''),
    empty: 'Named sets of variants or positions, made on the map.',
  },
  {
    // Variants of known effect, for calibration (wave 8, slice 1): made and read in Calibrate.
    kind: 'controls', collection: 'controlSets', title: 'Control sets', icon: 'calibrate',
    items: (ws) => ws.controlSets ?? [],
    label: (c) => c.name ?? 'Control set',
    meta: (c) => `${c.labels.filter((l) => l.side === 'P').length} P · ${c.labels.filter((l) => l.side === 'B').length} B`,
    empty: 'Variants of known effect, from ClinVar or a table, made in Calibrate.',
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
      // A list only when it has items: an empty one says what goes in it (axe-core's
      // aria-required-children).
      const list = h('div', { role: items.length ? 'list' : null });
      for (const item of items) {
        const selected = ui.focus?.kind === section.kind && ui.focus?.id === item.id;
        // An AI agent's: made and marked proposed, or proposed to be removed (wave 7, slice 2).
        const proposal = section.collection ? proposalOfItem(ws, item) : null;
        const removal = section.collection ? heldRemoval(ws, section.collection, item.id) : null;
        const mark = proposal ? h('span.badge.accent', { title: `Proposed by ${proposal.author}: accept or reject it above the view` }, 'proposed')
          : removal ? h('span.badge.danger', { title: `${removal.proposal.author} proposes removing it` }, 'remove?') : null;
        list.append(h(`button.dataset-row${selected ? '.selected' : ''}${removal ? '.held-removal' : ''}`, {
          type: 'button',
          role: 'listitem',
          'aria-current': selected ? 'true' : null,
          title: section.label(item),
          onclick: () => app.focusItem({ kind: section.kind, id: item.id }),
        }, icon(section.icon), h('span.label', section.label(item)), mark, h('span.meta', section.meta(item))));
      }
      // A design an agent proposed, waiting for the person.
      const held = section.kind === 'design' ? heldOfKind(ws, 'design')[0] : null;
      if (held) {
        list.setAttribute('role', 'list');
        list.append(h('button.dataset-row', { type: 'button', role: 'listitem', title: `The design ${held.proposal.author} proposes`, onclick: () => app.setMode('experiment') },
          icon(section.icon), h('span.label', held.change.design?.name ?? 'A design'), h('span.badge.warn', { title: `${held.proposal.author} proposes it: it applies if you accept` }, 'proposed'), h('span.meta', '')));
      }
      if (!items.length && !held) {
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
