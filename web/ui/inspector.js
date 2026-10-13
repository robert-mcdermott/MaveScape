// The inspector: what is in focus (a variant, a table, a score run), described in full. Views add
// their own sections through app.inspector.setSections(id, builder) as they are built; until
// something is in focus it describes the workspace and says how to begin.

import { h, icon, clear, relativeTime, formatBytes, formatCount } from './dom.js';
import { variantSection } from './variant-inspector.js';
import { positionSection } from './position-inspector.js';
import { structureWords, viewWords } from '../lib/structure-record.js';
import { toast } from './overlays.js';
import { targetOriginText } from '../lib/genbank.js';
import { retrievalText } from '../lib/uniprot.js';
import { recordView } from './mavedb.js';
import { setsFor } from './selections.js';
import { exportSelection } from './record.js';
import { composition } from '../lib/controls.js';
import { ruleWords, thresholdWords } from '../lib/calibration.js';

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
      h('dt', 'Target'), h('dd', app.store.ws.targets.find((t) => t.id === source.target)?.name ?? 'none'),
      // A table from MaveDB (wave 3, slice 2): which record and file, its license, when retrieved.
      source.origin?.database === 'MaveDB' ? [
        // The counts of several score sets opened together (wave 3, slice 6), joined.
        h('dt', 'From'), h('dd', source.origin.urns ? `MaveDB ${source.origin.urns.join(' and ')} (counts, joined: a condition each)` : `MaveDB ${source.origin.urn} (${source.origin.file})`),
        h('dt', 'License'), h('dd', source.origin.license ?? ''),
        h('dt', 'Retrieved'), h('dd', String(source.origin.retrieved ?? '').slice(0, 10)),
      ] : null);
    const record = source.origin?.database === 'MaveDB' ? (app.store.ws.records ?? []).find((r) => r.urn === source.origin.urn) : null;
    const problems = [...(source.problems?.blocking ?? []).map((m) => h('div.callout.danger', { style: { marginTop: '6px', fontSize: '12px' } }, m)), ...(source.problems?.warnings ?? []).map((m) => h('div.callout.warn', { style: { marginTop: '6px', fontSize: '12px' } }, m))];
    return h('section.inspector-section', h('h3', icon('table'), source.name), kv,
      s ? h('p.muted', { style: { fontSize: '12px', margin: '8px 0 0' } }, `${formatCount(s.total)} variants: ${formatCount(s.valid)} valid, ${formatCount(s.warning)} read leniently, ${formatCount(s.invalid)} not valid.`) : null,
      ...problems,
      record ? h('details.inspector-details', { open: true }, h('summary', 'The MaveDB record'), recordView(record)) : null);
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
        ids.gene ? [h('dt', 'Gene'), h('dd', ids.gene)] : null,
        target.reference ? [h('dt', 'Checked'), h('dd', `against UniProt ${target.reference.accession} (${retrievalText(target.reference)}): positions ${target.reference.start}–${target.reference.end}${target.reference.identical ? ', identical' : ''}`)] : null,
        // Where its sequence came from (wave 3, slice 3): a GenBank file, NCBI, Ensembl.
        target.origin ? [h('dt', 'From'), h('dd', targetOriginText(target.origin))] : null),
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
    // Its variants by class, read from their names (p.Ala12Val, p.Ala12Ter, p.Ala12=).
    const kinds = { missense: 0, nonsense: 0, synonymous: 0 };
    for (const k of selection.keys) kinds[/=$/.test(k) ? 'synonymous' : /(Ter|\*)$/.test(k) ? 'nonsense' : 'missense'] += 1;
    const others = app.store.ws.runs.filter((r) => r.id !== selection.run && setsFor(app.store.ws, r).some((s) => s.id === selection.id));
    return h('section.inspector-section', h('h3', icon('target'), selection.name),
      h('dl.kv', h('dt', 'Variants'), h('dd', `${formatCount(selection.keys.length)} (${Object.entries(kinds).filter(([, n]) => n).map(([k, n]) => `${formatCount(n)} ${k}`).join(', ')})`),
        h('dt', 'On the map of'), h('dd', run ? run.name : 'a run no longer here'),
        selection.query ? h('dt', 'By the query') : null, selection.query ? h('dd.mono', { style: { fontSize: '11.5px' } }, selection.query) : null,
        others.length ? h('dt', 'Also applies to') : null, others.length ? h('dd', `${others.map((r) => r.name).join(', ')} (the same protein)`) : null,
        h('dt', 'Saved'), h('dd', relativeTime(selection.created))),
      h('p.mono', { style: { fontSize: '11px', margin: '8px 0 0', wordBreak: 'break-word', color: 'var(--text-2)' } }, selection.keys.slice(0, 40).join(', '), selection.keys.length > 40 ? ', …' : ''),
      h('div.btn-row', { style: { marginTop: '8px' } }, h('button.btn.small', { type: 'button', onclick: () => app.setMode('map') }, icon('heatmap'), 'Show on the map'),
        run ? h('button.btn.small', { type: 'button', onclick: () => exportSelection(app, selection, 'csv') }, icon('download'), 'CSV') : null,
        h('button.btn.small', { type: 'button', onclick: () => exportSelection(app, selection, 'json') }, icon('download'), 'JSON')));
  }

  // A saved view of a structure (wave 5, slice 5): what it shows, its structure's file and origin.
  function structureViewSection(view) {
    const ws = app.store.ws;
    const entry = (ws.structures ?? []).find((s) => s.id === view.structure);
    return h('section.inspector-section', h('h3', icon('structure'), view.name),
      h('dl.kv',
        h('dt', 'Shows'), h('dd', viewWords(view, ws)),
        entry ? [h('dt', 'Structure'), h('dd', structureWords(entry, { sha: false }))] : null,
        entry ? [h('dt', 'File'), h('dd', { title: entry.file.sha256 }, `${entry.file.fileName}, SHA-256 ${entry.file.sha256.slice(0, 12)}…`)] : null,
        view.mapping ? [h('dt', 'Mapping'), h('dd', `${view.mapping.target.name} on chain ${view.mapping.chain}: ${view.mapping.onStructure} positions, ${view.mapping.identical} identical`)] : null,
        h('dt', 'Saved'), h('dd', relativeTime(view.created))),
      h('div.btn-row', { style: { marginTop: '8px' } }, h('button.btn.small', { type: 'button', onclick: async () => {
        await app.setMode('structure');
        const { openView } = await import('./structure-views.js');
        const opened = await openView(app, view.id);
        if (!opened.ok) toast(opened.message, { kind: 'error' });
      } }, icon('structure'), 'Open the view')));
  }

  // A control set (wave 8, slice 1): where its labels came from, and how many on each side.
  function controlSetSection(set) {
    const c = composition(set);
    return h('section.inspector-section', h('h3', icon('calibrate'), set.name),
      h('dl.kv',
        h('dt', 'From'), h('dd', set.source.kind === 'clinvar' ? `ClinVar, ${set.source.transcript}` : set.source.file.fileName),
        set.source.citation ? [h('dt', 'Citation'), h('dd', set.source.citation)] : null,
        set.source.kind === 'clinvar' ? [h('dt', 'Review status'), h('dd', `at least ${set.rules.minStars} star${set.rules.minStars === 1 ? '' : 's'}`)] : null,
        h('dt', 'Kinds'), h('dd', set.rules.kinds.join(', ')),
        h('dt', 'P controls'), h('dd', formatCount(c.P.total)),
        h('dt', 'B controls'), h('dd', formatCount(c.B.total)),
        h('dt', 'Made'), h('dd', relativeTime(set.created))),
      h('p.muted', { style: { fontSize: '11.5px', margin: '8px 0 0' } }, 'Labels as their source gives them, for research: MaveScape does not classify variants.'),
      h('div.btn-row', { style: { marginTop: '8px' } }, h('button.btn.small', { type: 'button', onclick: () => app.setMode('calibrate') }, icon('calibrate'), 'Open in Calibrate')));
  }

  // A calibration (wave 8, slice 2): what it was made with; its metrics are in Calibrate.
  function calibrationSection(cal) {
    const ws = app.store.ws;
    const run = ws.runs.find((r) => r.id === cal.run);
    const set = (ws.controlSets ?? []).find((c) => c.id === cal.controlSet);
    return h('section.inspector-section', h('h3', icon('calibrate'), cal.name),
      h('dl.kv',
        h('dt', 'Run'), h('dd', run?.name ?? cal.run),
        h('dt', 'Control set'), h('dd', set?.name ?? cal.controlSet),
        h('dt', 'Controls scored'), h('dd', `${formatCount(cal.n.P)} P, ${formatCount(cal.n.B)} B`),
        h('dt', 'Abnormal-like'), h('dd', `${cal.side} the others (${cal.sideFrom === 'readout' ? 'the readout' : cal.sideFrom === 'controls' ? 'the controls\' medians' : 'chosen'})`),
        h('dt', 'Thresholds'), h('dd', `${ruleWords(cal.rule, cal.error)}: ${thresholdWords(cal.side, cal.thresholds)}`),
        h('dt', 'Bootstrap'), h('dd', `${formatCount(cal.bootstrap.samples)} samples, seed ${cal.bootstrap.seed}`),
        h('dt', 'Made'), h('dd', relativeTime(cal.created))),
      h('p.muted', { style: { fontSize: '11.5px', margin: '8px 0 0' } }, 'For research: how far the scores separate variants of known effect. MaveScape does not classify variants.'),
      h('div.btn-row', { style: { marginTop: '8px' } }, h('button.btn.small', { type: 'button', onclick: () => app.setMode('calibrate') }, icon('calibrate'), 'Open in Calibrate')));
  }

  function focusSection() {
    const focus = app.store.ui.focus;
    if (focus?.kind === 'controls') {
      const set = (app.store.ws.controlSets ?? []).find((x) => x.id === focus.id);
      if (set) return controlSetSection(set);
    }
    if (focus?.kind === 'calibration') {
      const cal = (app.store.ws.calibrations ?? []).find((x) => x.id === focus.id);
      if (cal) return calibrationSection(cal);
    }
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
    // A position of a run's target (wave 5, slice 3): a residue picked on the structure.
    if (focus?.kind === 'position') {
      const section = positionSection(app, focus);
      if (section) return section;
    }
    if (focus?.kind === 'structureView') {
      const view = (app.store.ws.structureViews ?? []).find((x) => x.id === focus.id);
      if (view) return structureViewSection(view);
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
      if (topics.has('ws') || topics.has('focus') || topics.has('selection') || topics.has('results') || topics.has('workspace-loaded') || topics.has('tracks') || topics.has('robustness')) render();
    },
  };
}
