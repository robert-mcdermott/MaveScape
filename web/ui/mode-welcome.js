// The start page: open data, or a saved workspace. Adapted from CytoWeave 0.8.0
// web/ui/mode-welcome.js.

import { h, icon, clear, relativeTime, formatBytes } from './dom.js';
import { prefs } from './storage.js';
import { EXAMPLES, LAYOUTS, downloadLayout, openExample } from './examples.js';

// What a researcher brings: the files MaveScape reads (mavescape-spec/requirements.md, D12–D13).
const INPUTS = [
  ['table', 'Variant counts', 'A table with one row per variant and one column per sample (CSV, TSV or Excel), as Enrich2, DiMSum, dms_variants or a lab\'s own scripts write them; or one file per sample.'],
  ['sequence', 'The target sequence', 'The reference the variants are named against: a FASTA file (DNA or protein), or pasted.'],
  ['experiment', 'The design', 'Which column is which sample: its role (input, output, time point or bin), condition and replicate. A sample sheet fills it in.'],
  ['score', 'Or published scores', 'Score tables with variants in HGVS (MaveDB\'s CSV layout and others) open for exploration and comparison.'],
];

export function mountWelcome(app, container) {
  const { library } = app;
  const recent = h('div.welcome-grid');
  const root = h('div.workbench-scroll', h('div.welcome',
    h('div.welcome-hero',
      h('div', { style: { flex: 1 } },
        h('h1', 'Variant effects, from counts ', h('span.brand-text', 'to understanding.')),
        h('p', 'MaveScape turns the counts of a deep mutational scan into checked, uncertainty-aware variant-effect maps you can explore by sequence and structure, on your own computer, with every step recorded.'),
        h('div.btn-row',
          h('button.btn.primary', { type: 'button', onclick: () => app.pickFiles() }, icon('table'), 'Open files'),
          h('button.btn', { type: 'button', onclick: () => app.pickFolder() }, icon('folder'), 'Open a folder'),
          h('button.btn', { type: 'button', onclick: () => app.openLibrary() }, icon('library'), 'Open a saved workspace'),
          h('span.muted', { style: { marginLeft: '6px' } }, 'or drop files anywhere'))),
      h('img', { src: 'favicon.svg', width: 132, height: 132, alt: '', style: { filter: 'drop-shadow(0 18px 40px rgba(42, 111, 219, 0.35))', borderRadius: '28px' } })),
    h('div.section-title', 'Recent workspaces'),
    recent,
    h('div.section-title', { style: { marginTop: '22px' } }, 'Examples'),
    h('div.welcome-grid', ...EXAMPLES.map((x) => h('div.card.clickable', { role: 'button', tabIndex: 0, onclick: () => openExample(app, x.id), onkeydown: (event) => { if (event.key === 'Enter') openExample(app, x.id); } },
      h('h4', icon(x.simulated ? 'flask' : 'library'), x.title, x.simulated ? h('span.badge.warn', { style: { marginLeft: '6px' } }, 'simulated') : h('span.badge.accent', { style: { marginLeft: '6px' } }, x.license)),
      h('p', x.summary),
      h('p.muted', { style: { fontSize: '11.5px' } }, x.question)))),
    h('div.section-title', { style: { marginTop: '22px' } }, 'What to bring'),
    h('div.feature-list', ...INPUTS.map(([glyph, title, text]) => h('div.feature', h('span.glyph', icon(glyph)), h('div', h('b', title), h('span', text))))),
    h('div.section-title', { style: { marginTop: '22px' } }, 'Blank layouts'),
    h('p.muted', { style: { margin: '0 0 8px', fontSize: '12.5px' } }, 'Annotated files to fill in with your own data; docs/FORMATS.md describes every file MaveScape reads and writes.'),
    h('div.welcome-grid', ...LAYOUTS.map(([path, title, text]) => h('div.card.clickable', { role: 'button', tabIndex: 0, onclick: () => downloadLayout(path), onkeydown: (event) => { if (event.key === 'Enter') downloadLayout(path); } },
      h('h4', icon('download'), title), h('p', text)))),
    h('p.muted', { style: { marginTop: '22px', fontSize: '12px' } },
      'Files are read on this computer and never uploaded. MaveScape reports experimental functional effects for research use; it does not classify variants as pathogenic or benign.')));
  container.append(root);

  async function loadRecent() {
    clear(recent);
    let list = [];
    try {
      list = await library.listWorkspaces();
    } catch { /* none */ }
    if (!list.length) {
      recent.append(h('div.card', h('p.muted', `No saved workspaces yet. Workspaces save automatically to ${library.kind === 'desktop' ? `the library folder (${library.location})` : 'this browser'}.`)));
      return;
    }
    const last = prefs.get('lastWorkspace', null);
    for (const item of list.slice(0, 8)) {
      recent.append(h('div.card.clickable', { role: 'button', tabIndex: 0, onclick: () => app.openWorkspace(item.id), onkeydown: (event) => { if (event.key === 'Enter') app.openWorkspace(item.id); } },
        h('h4', icon('library'), item.name || 'Untitled workspace', item.id === last ? h('span.badge.accent', { style: { marginLeft: '6px' } }, 'Last opened') : null),
        h('p', `${item.sources ?? 0} table${item.sources === 1 ? '' : 's'} · ${relativeTime(item.modified)}${item.size ? ` · ${formatBytes(item.size)}` : ''}`)));
    }
  }

  loadRecent();
  return {
    update(topics) {
      if (topics.has('library')) loadRecent();
    },
    destroy() {
      root.remove();
    },
  };
}
