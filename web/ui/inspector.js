// The inspector: what is in focus (a variant, a table, a score run), described in full. Views add
// their own sections through app.inspector.setSections(id, builder) as they are built; until
// something is in focus it describes the workspace and says how to begin.

import { h, icon, clear, relativeTime, formatBytes, formatCount } from './dom.js';
import { variantSection } from './variant-inspector.js';

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

  function sourceSection(source) {
    const s = source.summary;
    const kv = h('dl.kv',
      h('dt', 'File'), h('dd', { title: source.fileName }, source.files?.length > 1 ? `${source.files.length} files` : source.fileName),
      h('dt', 'SHA-256'), h('dd.mono', { title: source.sha256 }, `${source.sha256.slice(0, 12)}…`),
      h('dt', 'Size'), h('dd', formatBytes(source.size)),
      h('dt', 'Rows'), h('dd', formatCount(source.rows)),
      h('dt', 'Layout'), h('dd', source.layout),
      h('dt', 'Variant names'), h('dd', `${source.mapping.variantColumn} (${source.mapping.level})`),
      h('dt', 'Count columns'), h('dd', String(source.mapping.countColumns.length)),
      h('dt', 'Target'), h('dd', app.store.ws.targets.find((t) => t.id === source.target)?.name ?? 'none'));
    const problems = [...(source.problems?.blocking ?? []).map((m) => h('div.callout.danger', { style: { marginTop: '6px', fontSize: '12px' } }, m)), ...(source.problems?.warnings ?? []).map((m) => h('div.callout.warn', { style: { marginTop: '6px', fontSize: '12px' } }, m))];
    return h('section.inspector-section', h('h3', icon('table'), source.name), kv,
      s ? h('p.muted', { style: { fontSize: '12px', margin: '8px 0 0' } }, `${formatCount(s.total)} variants: ${formatCount(s.valid)} valid, ${formatCount(s.warning)} read leniently, ${formatCount(s.invalid)} not valid.`) : null,
      ...problems);
  }

  function targetSection(target) {
    const ids = target.identifiers ?? {};
    return h('section.inspector-section', h('h3', icon('sequence'), target.name),
      h('dl.kv',
        h('dt', 'Type'), h('dd', target.sequenceType === 'dna' ? 'DNA' : 'protein'),
        h('dt', 'Length'), h('dd', `${formatCount(target.sequence.length)} ${target.sequenceType === 'dna' ? 'nt' : 'aa'}`),
        target.sequenceType === 'dna' ? [h('dt', 'Coding start'), h('dd', String(target.codingStart ?? 1))] : null,
        h('dt', 'Offset'), h('dd', String(target.offset ?? 0)),
        ids.uniprot ? [h('dt', 'UniProt'), h('dd', ids.uniprot)] : null,
        ids.gene ? [h('dt', 'Gene'), h('dd', ids.gene)] : null),
      h('p.mono', { style: { fontSize: '11px', wordBreak: 'break-all', margin: '8px 0 0', color: 'var(--text-2)' } }, target.sequence.length > 240 ? `${target.sequence.slice(0, 240)}…` : target.sequence));
  }

  function runSection(run) {
    const checked = app.runResults?.get(run.id);
    const c = run.output.conditions;
    return h('section.inspector-section', h('h3', icon('score'), run.name),
      h('dl.kv',
        h('dt', 'Id'), h('dd.mono', run.id),
        h('dt', 'Made'), h('dd', relativeTime(run.created)),
        h('dt', 'Table'), h('dd', { title: run.inputs.source.sha256 }, run.inputs.source.name),
        h('dt', 'Design'), h('dd', run.inputs.design.name ?? 'design'),
        h('dt', 'Scored'), h('dd', c.map((x) => `${formatCount(x.scored)} of ${formatCount(run.output.variants)}${c.length > 1 ? ` (${x.name})` : ''}`).join('; ')),
        h('dt', 'Output'), h('dd.mono', { title: run.output.sha256 }, `${run.output.sha256.slice(0, 12)}…`),
        h('dt', 'Checked'), h('dd', !checked ? 'not yet' : checked.status === 'reproduced' ? 'reproduced from its inputs' : checked.status === 'computed' ? 'computed in this session' : checked.status === 'checking' ? 'recomputing…' : checked.status === 'differs' ? 'differs from the record' : 'could not be recomputed'),
        h('dt', 'Software'), h('dd', `MaveScape ${run.software.version}${run.software.commit ? ` (${run.software.commit.slice(0, 7)})` : ''}`)),
      ...run.warnings.map((w) => h('div.callout.warn', { style: { marginTop: '6px', fontSize: '12px' } }, w.message)),
      h('div.btn-row', { style: { marginTop: '8px' } }, h('button.btn.small', { type: 'button', onclick: () => app.setMode('score') }, icon('score'), 'Open in Score')));
  }

  function selectionSection(selection) {
    const run = app.store.ws.runs.find((r) => r.id === selection.run);
    return h('section.inspector-section', h('h3', icon('target'), selection.name),
      h('dl.kv', h('dt', 'Variants'), h('dd', formatCount(selection.keys.length)), h('dt', 'On the map of'), h('dd', run ? run.name : 'a run no longer here'), h('dt', 'Saved'), h('dd', relativeTime(selection.created))),
      h('p.mono', { style: { fontSize: '11px', margin: '8px 0 0', wordBreak: 'break-word', color: 'var(--text-2)' } }, selection.keys.slice(0, 40).join(', '), selection.keys.length > 40 ? ', …' : ''),
      h('div.btn-row', { style: { marginTop: '8px' } }, h('button.btn.small', { type: 'button', onclick: () => app.setMode('map') }, icon('heatmap'), 'Show on the map')));
  }

  function focusSection() {
    const focus = app.store.ui.focus;
    if (focus?.kind === 'source') {
      const source = app.store.ws.sources.find((x) => x.id === focus.id);
      if (source) return sourceSection(source);
    }
    if (focus?.kind === 'target') {
      const target = app.store.ws.targets.find((x) => x.id === focus.id);
      if (target) return targetSection(target);
    }
    if (focus?.kind === 'selection') {
      const selection = app.store.ws.selections.find((x) => x.id === focus.id);
      if (selection) return selectionSection(selection);
    }
    if (focus?.kind === 'variant') {
      const section = variantSection(app, focus);
      if (section) return section;
    }
    if (focus?.kind === 'run') {
      const run = app.store.ws.runs.find((x) => x.id === focus.id);
      if (run) return runSection(run);
    }
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
        const section = build(app);
        if (section) root.append(section);
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
      if (topics.has('ws') || topics.has('focus') || topics.has('selection') || topics.has('results') || topics.has('workspace-loaded')) render();
    },
  };
}
