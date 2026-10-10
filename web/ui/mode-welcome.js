// The start page: open data, or a saved workspace. Adapted from CytoWeave 0.8.0
// web/ui/mode-welcome.js.

import { h, icon, clear, relativeTime, formatBytes } from './dom.js';
import { prefs } from './storage.js';
import { EXAMPLES, LAYOUTS, downloadLayout, openExample } from './examples.js';
import { BRING, GAPS, fillable, readiness, readinessLine } from '../lib/readiness.js';

// What a researcher brings (requirements D12–D13, E8): the files MaveScape reads, then the records
// that unlock or improve an analysis, from the readiness model's catalog (lib/readiness.js).
const GLYPHS = { counts: 'table', target: 'sequence', design: 'experiment', readout: 'target', 'library-method': 'dna', 'selection-cells': 'cell', gates: 'gate', 'bin-cells': 'cell', generations: 'history', 'target-identifiers': 'tag' };
const NEEDED = BRING.filter((id) => GAPS[id].kind === 'required');
const WORTH = BRING.filter((id) => GAPS[id].kind !== 'required');

export function mountWelcome(app, container) {
  const { library } = app;
  // The open workspace's readiness, when it has a design: what is missing, and where to see it.
  function openWorkspace() {
    const ws = app.store.ws;
    if (!ws.design) return null;
    const r = readiness(ws);
    const missing = fillable(r);
    return h('div.callout.accent', { style: { margin: '0 0 10px' } }, icon('lightbulb'),
      h('span', { style: { flex: 1 } }, `${ws.name}: ${readinessLine(r)}${missing.length ? `; ${missing.length} missing that the bench or the protocol could give (${missing.map((g) => `${g.label.charAt(0).toLowerCase()}${g.label.slice(1)}`).join(', ')})` : ''}.`),
      h('button.btn.small', { type: 'button', onclick: () => app.setMode('experiment') }, 'See what each analysis can do'));
  }
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
    openWorkspace(),
    h('div.feature-list', ...NEEDED.map((id) => h('div.feature', h('span.glyph', icon(GLYPHS[id])), h('div', h('b', GAPS[id].label), h('span', `${GAPS[id].why} ${GAPS[id].where}`)))),
      h('div.feature', h('span.glyph', icon('score')), h('div', h('b', 'Or published scores'), h('span', 'Score tables with variants in HGVS (MaveDB\'s CSV layout and others) open for exploration and comparison.')))),
    h('p.muted', { style: { margin: '14px 0 6px', fontSize: '12.5px' } }, 'Worth bringing if you have them: records kept at the bench or in the protocol that unlock or improve an analysis. Nothing is guessed in their place; a gap stays visible, and the methods name it.'),
    h('div.feature-list', ...WORTH.map((id) => h('div.feature', h('span.glyph', icon(GLYPHS[id])), h('div', h('b', GAPS[id].label), h('span', `${GAPS[id].why} Usually found: ${GAPS[id].where.charAt(0).toLowerCase()}${GAPS[id].where.slice(1)}`))))),
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
