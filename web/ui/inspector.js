// The inspector: what is in focus (a variant, a table, a score run), described in full. Views add
// their own sections through app.inspector.setSections(id, builder) as they are built; until
// something is in focus it describes the workspace and says how to begin.

import { h, icon, clear, relativeTime } from './dom.js';

export function mountInspector(app) {
  const root = document.getElementById('inspector');
  // Sections contributed by views: id → (app) => Node | null.
  const contributed = new Map();

  function workspaceSection() {
    const { ws } = app.store;
    const kv = h('dl.kv',
      h('dt', 'Name'), h('dd', ws.name),
      h('dt', 'Tables'), h('dd', String(ws.sources.length)),
      h('dt', 'Targets'), h('dd', String(ws.targets.length)),
      h('dt', 'Score runs'), h('dd', String(ws.runs.length)),
      h('dt', 'Modified'), h('dd', relativeTime(ws.modified)));
    return h('section.inspector-section', h('h3', icon('library'), 'Workspace'), kv);
  }

  function focusSection() {
    const focus = app.store.ui.focus;
    if (!focus) {
      return h('section.inspector-section',
        h('h3', icon('info'), 'Nothing selected'),
        h('p.muted', { style: { margin: 0, fontSize: '12.5px' } }, 'Select an item in the dataset tree, or a variant on the map, to see everything known about it here: identifiers, counts, scores with their uncertainty, filters and where each number came from.'));
    }
    return null;
  }

  function render() {
    clear(root);
    root.append(focusSection());
    for (const build of contributed.values()) {
      try {
        root.append(build(app));
      } catch (error) {
        root.append(h('section.inspector-section', h('p.muted', `This section could not be shown: ${error.message}`)));
      }
    }
    root.append(workspaceSection());
    root.append(h('section.inspector-section', h('p.muted', { style: { margin: 0, fontSize: '11.5px' } },
      'MaveScape reports experimental functional effects for research. It does not classify variants as pathogenic or benign.')));
  }

  return {
    render,
    setSection(id, build) {
      if (build) contributed.set(id, build);
      else contributed.delete(id);
      render();
    },
    update(topics) {
      if (topics.has('ws') || topics.has('focus') || topics.has('selection') || topics.has('workspace-loaded')) render();
    },
  };
}
