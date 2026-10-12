// The Structure view (wave 5, slice 1; requirement X1): a protein's structure in MaveScape, needing
// no other program. Open a local file (PDB, mmCIF or BinaryCIF, gzipped or not), a PDB entry by its
// ID or an AlphaFold DB model by its UniProt accession (through the program's fetcher, so cached
// and then available offline); choose a biological assembly; draw it as a cartoon, sticks,
// spheres or a trace, with a surface; color it; select residues in Proteoscope's selection
// language ("chain A and resi 40-80", "resn CYS", "within 5 of ligand"), draw them as sticks,
// label them, and focus on a neighborhood. The structure is kept for the session; the map's
// positions on it come with the mapping (roadmap, wave 5).

import { h, icon, clear, downloadBlob } from './dom.js';
import { toast } from './overlays.js';
import { fetchPublic } from './public-data.js';
import { createStructureViewer, STYLES, SURFACES } from './structure-viewer.js';
import { COLOR_SCHEMES } from '../lib/structure/coloring.js';
import { colorToHex, colormapGradientCSS } from '../lib/structure/colors.js';
import { countMask, residueKeysFromMask, SelectionError, selectAtoms } from '../lib/structure/select.js';
import { alphafoldEntry, applyAlphafoldEntry, ASYMMETRIC_UNIT_ID, assemblyChoices, chainSummaries, describeStructure, openStructureText, readStructureBytes, residueLabel, residueRuns, structureRequest } from '../lib/structures.js';
import { now } from '../lib/clock.js';

// Residue styles for a selection, as the selection pane offers them.
export const RESIDUE_STYLES = { sticks: 'Sticks', 'ball-stick': 'Ball and stick', spacefill: 'Spacefill', hide: 'Hide', none: 'As the rest' };

// The session's structure: the viewer (kept between visits to the view), where the structure
// came from, and the last selection typed.
export function structureState(app) {
  app.structureState ??= { viewer: null, origin: null, query: '', message: null, busy: '' };
  return app.structureState;
}

function viewerOf(app) {
  const state = structureState(app);
  state.viewer ??= createStructureViewer({
    onPick: (residue, how) => state.handlers?.onPick?.(residue, how),
    onFocus: (residues) => state.handlers?.onFocus?.(residues),
    onChange: () => state.handlers?.onChange?.(),
  });
  return state.viewer;
}

// The target's UniProt accession, for its AlphaFold DB model: the design's target, else the first.
export function targetAccession(ws) {
  const target = ws.targets.find((t) => t.id === ws.design?.targets?.[0]?.id) ?? ws.targets[0];
  return target?.identifiers?.uniprot ?? '';
}

// Opens a structure: { pdb }, { alphafold } (an accession), or { file: { name, bytes } }. Returns
// { ok, message, structure, origin }; the structure is shown, replacing any other.
export async function openStructure(app, what) {
  const state = structureState(app);
  const viewer = viewerOf(app);
  let bytes;
  let name;
  let origin;
  let entry = null;
  try {
    if (what.file) {
      bytes = what.file.bytes;
      name = what.file.name;
      origin = { kind: 'file', name, opened: now() };
    } else {
      const request = structureRequest(what.pdb ?? what.alphafold ?? '', what.pdb ? 'pdb' : 'alphafold');
      if (!request) return { ok: false, message: what.pdb ? `"${what.pdb}" is not a PDB ID (such as 2VWF).` : `"${what.alphafold}" is not a UniProt accession (such as P62993).` };
      state.busy = `Fetching ${request.label}…`;
      state.handlers?.onChange?.();
      if (request.kind === 'pdb') {
        const got = await fetchPublic(app, `pdb/${encodeURIComponent(request.id)}`, { as: 'bytes', refresh: what.refresh });
        if (!got.ok) return { ok: false, message: got.message };
        bytes = got.bytes;
        name = `${request.id}.cif.gz`;
        origin = { kind: 'pdb', id: request.id, retrieval: got.retrieval };
      } else {
        const listed = await fetchPublic(app, `alphafold/${encodeURIComponent(request.id)}/prediction`, { refresh: what.refresh });
        if (!listed.ok) return { ok: false, message: listed.message };
        entry = alphafoldEntry(listed.json, request.id);
        if (!entry) return { ok: false, message: `AlphaFold DB lists no model of ${request.id}.` };
        const got = await fetchPublic(app, `alphafold/${encodeURIComponent(request.id)}/model/${entry.latestVersion}`, { as: 'bytes', refresh: what.refresh });
        if (!got.ok) return { ok: false, message: got.message };
        bytes = got.bytes;
        name = `AF-${request.id}-F1-model_v${entry.latestVersion}.cif`;
        origin = { kind: 'alphafold', id: request.id, version: entry.latestVersion, retrieval: got.retrieval };
      }
    }
    state.busy = `Reading ${name}…`;
    state.handlers?.onChange?.();
    const { text, name: textName } = await readStructureBytes(bytes, name);
    const structure = openStructureText(text, textName);
    if (entry) applyAlphafoldEntry(structure, entry);
    state.origin = origin;
    state.query = '';
    state.message = null;
    await viewer.show(structure);
    app.store.notify(['structure']);
    return { ok: true, structure, origin, message: `${originText(origin, structure)}: ${describeStructure(structure).slice(1).join(' ')}` };
  } catch (error) {
    return { ok: false, message: `${name ?? 'The structure'} could not be read: ${error.message}` };
  } finally {
    state.busy = '';
    state.handlers?.onChange?.();
  }
}

// Where the structure shown came from, in words.
export function originText(origin, structure) {
  if (!origin) return '';
  const day = /^\d{4}-\d{2}-\d{2}/.exec(origin.retrieval?.retrieved ?? '')?.[0];
  const when = day ? `, retrieved ${day}` : '';
  if (origin.kind === 'pdb') return `PDB ${origin.id} (RCSB PDB${when})`;
  if (origin.kind === 'alphafold') return `AlphaFold DB model of ${origin.id}, version ${origin.version}${when}`;
  return `${origin.name}${structure?.meta.code ? ` (${structure.meta.code})` : ''}, a file`;
}

// Residues chosen in Proteoscope's selection language → { keys, atoms } (residue keys of the
// structure shown). Throws SelectionError with where the text is wrong.
export function selectResidues(app, text) {
  const viewer = viewerOf(app);
  const model = viewer.model;
  if (!model) throw new SelectionError('Open a structure first.');
  // UniProt's positions are placed on a structure by aligning the target to it, not by the entry's
  // own record of what it covers (roadmap, wave 5: mapping).
  const uniprot = /\b(uniprot|unp)\b/i.exec(text);
  if (uniprot) throw new SelectionError('MaveScape does not place UniProt\'s positions on a structure yet: select by the entry\'s own numbering (resi).', uniprot.index);
  const target = { id: 1, index: 1, name: viewer.structure.meta.code || 'structure', model, structure: viewer.structure, context: { selected: viewer.selection, focus: viewer.focused.length ? new Set(viewer.focused) : null, values: {} } };
  const mask = selectAtoms(text, [target]).get(target.id);
  return { keys: [...residueKeysFromMask(model, mask)], atoms: countMask(mask) };
}

// Files dropped or opened: the first structure is shown (one at a time).
export async function openStructureFiles(app, items) {
  const [first, ...rest] = items;
  app.setMode('structure');
  const result = await openStructure(app, { file: { name: first.name, bytes: await app.readBytes(first) } });
  if (!result.ok) throw new Error(result.message);
  app.log(`Opened the structure ${result.message}`);
  if (rest.length) toast(`One structure is shown at a time: ${first.name} is open, ${rest.length === 1 ? rest[0].name : `${rest.length} others`} not.`);
}

const fmtCount = (n) => n.toLocaleString('en-US');

export function mountStructureMode(app, container) {
  const { store } = app;
  const state = structureState(app);
  const viewer = viewerOf(app);
  const root = h('div.view');
  container.append(root);
  const sideEl = h('div.structure-side');
  const toolbarEl = h('div.structure-toolbar');
  const legendEl = h('div.structure-legend');
  const statusEl = h('div.structure-status', { role: 'status' });

  viewer.setTheme(document.documentElement.dataset.theme === 'dark');

  const notice = (message, kind = 'ok') => {
    state.message = message ? { kind, text: message } : null;
    renderSide();
  };

  state.handlers = {
    onPick(residue, { additive }) {
      if (!residue) {
        if (!additive) viewer.select([]);
        return;
      }
      viewer.select([residue.key], { additive });
      state.query = '';
      renderSide();
    },
    onFocus(residues) {
      state.query = '';
      notice(`Focused on ${residues.map(residueLabel).join(', ')}: the residues within 5 Å are drawn with their side chains.`);
    },
    onChange() {
      renderToolbar();
      renderStatus();
      renderLegend();
      if (viewer.structure && root.querySelector('.structure-body')) renderSide();
    },
  };

  async function open(what) {
    const result = await openStructure(app, what);
    if (!result.ok) {
      notice(result.message, 'warn');
      return;
    }
    app.log(`Opened the structure ${result.message}`);
  }

  // --- Toolbar, legend and status ----------------------------------------------------------------

  const select = (label, value, options, onChange, extra = {}) => {
    const el = h('select.input.small', { 'aria-label': label, title: label, onchange: () => onChange(el.value), ...extra }, ...options.map(([v, text, disabled]) => h('option', { value: v, selected: v === value, disabled: Boolean(disabled) }, text)));
    return el;
  };

  function renderToolbar() {
    clear(toolbarEl);
    const structure = viewer.structure;
    if (!structure) return;
    const assemblies = assemblyChoices(structure);
    const schemes = COLOR_SCHEMES.filter((s) => s.id !== 'plddt' || structure.meta.isPredicted).filter((s) => s.id !== 'nucleotide' || structure.chains.some((c) => c.polymerKind === 'nucleic'));
    toolbarEl.append(
      select('Style', viewer.style, Object.entries(STYLES).map(([k, v]) => [k, v.label]), (v) => viewer.setStyle(v)),
      select('Color by', viewer.colorScheme, schemes.map((s) => [s.id, s.label]), (v) => viewer.setColor(v)),
      select('Surface', viewer.surface.kind, Object.entries(SURFACES).map(([k, v]) => [k, v.label, viewer.kind !== 'webgpu' && k !== 'off']), (v) => viewer.setSurface(v)),
      assemblies.length ? select('Assembly', structure.activeAssemblyId ?? ASYMMETRIC_UNIT_ID, assemblies.map((a) => [a.id, `${a.label} · ${fmtCount(a.atoms)} atoms${a.tooLarge ? ' (too large)' : ''}`, a.tooLarge]), (v) => setAssembly(v)) : null,
      h('span.spacer'),
      h(`span.renderer-badge${viewer.kind === 'canvas' ? '.fallback' : ''}`, { title: viewer.kind === 'canvas' ? `Drawn by the Canvas renderer: ${viewer.failure}. It draws without surfaces or ambient occlusion; Chrome, Edge and Brave offer WebGPU.` : 'Drawn with WebGPU' }, viewer.kind === 'canvas' ? 'Canvas' : 'WebGPU'),
      h('button.btn.small', { type: 'button', title: 'Fit the structure in the view (F)', onclick: () => viewer.fit() }, 'Fit'),
      h('button.btn.small', { type: 'button', title: 'Save an image of the view (PNG, twice its size)', onclick: saveImage }, icon('download'), 'Image'));
  }

  function setAssembly(id) {
    try {
      viewer.setAssembly(id);
      state.query = '';
      render();
    } catch (error) {
      notice(error.message, 'warn');
    }
  }

  async function saveImage() {
    try {
      const blob = await viewer.capturePNG(2);
      const code = (viewer.structure.meta.code || 'structure').toLowerCase();
      downloadBlob(blob, `${code}.png`);
    } catch (error) {
      toast(error.message, { kind: 'error' });
    }
  }

  function renderLegend() {
    clear(legendEl);
    const legend = viewer.legend;
    if (!legend || !viewer.structure) return;
    if (legend.type === 'categorical') {
      // Chains named as the words name them (chainSummaries), not as the entry writes them.
      const chains = legend.title === 'Chains' ? chainSummaries(viewer.structure) : null;
      const label = (item, i) => (chains?.[i] ? `${chains[i].id} · ${chains[i].description || chains[i].kind}` : item.label);
      legendEl.append(h('span.legend-title', legend.title), ...legend.items.map((item, i) => h('span.legend-item', h('i', { style: { background: colorToHex(item.color) } }), label(item, i))));
    } else if (legend.type === 'gradient') {
      legendEl.append(h('span.legend-title', legend.title), h('span.legend-item', legend.minLabel), h('i.legend-ramp', { style: { background: colormapGradientCSS(legend.colormap) } }), h('span.legend-item', legend.maxLabel));
    }
  }

  function renderStatus() {
    const surface = viewer.surface;
    const parts = [];
    if (state.busy) parts.push(state.busy);
    if (surface.status) parts.push(surface.status);
    statusEl.textContent = parts.join(' ');
    statusEl.hidden = !parts.length;
  }

  // --- The side ----------------------------------------------------------------------------------

  function openPane(compact) {
    const pdbInput = h('input.input', { type: 'text', placeholder: 'PDB ID, such as 2VWF', 'aria-label': 'PDB ID', spellcheck: 'false', onkeydown: (e) => { if (e.key === 'Enter') openPDB(); } });
    const accession = targetAccession(store.ws);
    const afInput = h('input.input', { type: 'text', placeholder: 'UniProt accession, such as P62993', value: accession, 'aria-label': 'UniProt accession of an AlphaFold DB model', spellcheck: 'false', onkeydown: (e) => { if (e.key === 'Enter') openAF(); } });
    function openPDB() {
      open({ pdb: pdbInput.value });
    }
    function openAF() {
      open({ alphafold: afInput.value });
    }
    const body = [
      h('div.structure-open-row', h('label', 'PDB entry'), pdbInput, h('button.btn.small.primary', { type: 'button', onclick: openPDB }, 'Open')),
      h('div.structure-open-row', h('label', 'AlphaFold DB model'), afInput, h('button.btn.small', { type: 'button', onclick: openAF }, 'Open')),
      h('div.btn-row', h('button.btn.small', { type: 'button', onclick: () => app.pickFiles('.pdb,.ent,.cif,.mmcif,.bcif,.gz') }, icon('folder'), 'Open a file…'), h('span.muted', 'PDB, mmCIF or BinaryCIF, gzipped or not')),
      h('p.muted.small', accession ? `The AlphaFold DB model is asked for by the target's accession (${accession}). Only the ID or accession is sent; each structure is cached, and then opens offline.` : 'Only the ID or accession is sent; each structure is cached, and then opens offline.'),
    ];
    if (compact) return h('details.pane.structure-open', h('summary', icon('structure'), 'Open another structure'), ...body);
    return h('div.pane.structure-open', h('h3', icon('structure'), 'Open a structure'), ...body);
  }

  function selectionPane() {
    const structure = viewer.structure;
    const model = viewer.model;
    const selected = [...viewer.selection].map((key) => model.residueMap.get(key)).filter(Boolean);
    const input = h('input.input.structure-query-input', { type: 'text', value: state.query, placeholder: 'resn CYS · chain A and resi 40-80 · within 5 of ligand', 'aria-label': 'Select residues', spellcheck: 'false', onkeydown: (e) => { if (e.key === 'Enter') run(); }, oninput: () => { state.query = input.value; } });
    function run() {
      state.query = input.value.trim();
      if (!state.query) {
        viewer.select([]);
        renderSide();
        return;
      }
      try {
        const { keys } = selectResidues(app, state.query);
        viewer.select(keys);
        notice(keys.length ? null : `"${state.query}" selects no residue of ${structure.meta.code || 'this structure'}.`, 'warn');
      } catch (error) {
        // The field's text from where it goes wrong is selected, as the map's query field does.
        state.errorAt = error instanceof SelectionError && error.position >= 0 ? error.position : null;
        notice(error.message, 'warn');
      }
    }
    const keys = selected.map((r) => r.key);
    const action = (label, fn, title) => h('button.btn.small', { type: 'button', title, disabled: !keys.length, onclick: fn }, label);
    return h('div.pane.structure-selection',
      h('h3', icon('target'), 'Residues', h('span.spacer'), selected.length ? h('span.muted', `${fmtCount(selected.length)} selected`) : null),
      h('div.structure-query', input, h('button.btn.small', { type: 'button', onclick: run }, 'Select')),
      h('p.muted.small', 'Click a residue to select it (⌘, Ctrl or Shift adds it); double-click to focus on its neighborhood. Selections in words: chain, resi, resn, name, helix, sheet, ligand, within 5 of …, and, or, not.'),
      h('div.btn-row',
        h('select.input.small', { 'aria-label': 'Draw the selected residues as', disabled: !keys.length, onchange: (e) => { viewer.styleResidues(keys, e.target.value); e.target.value = ''; renderSide(); } },
          h('option', { value: '', selected: true, disabled: true }, 'Draw as…'), ...Object.entries(RESIDUE_STYLES).map(([k, v]) => h('option', { value: k }, v))),
        action('Label', () => { viewer.label(keys, !keys.every((k) => viewer.labels.has(k))); renderSide(); }, 'Label the selected residues (again: remove their labels)'),
        action('Focus', () => { viewer.focus(keys); renderSide(); }, 'Focus on the selected residues and their neighbors within 5 Å'),
        viewer.focused.length ? h('button.btn.small', { type: 'button', onclick: () => { viewer.clearFocus(); viewer.fit(); renderSide(); } }, 'Whole structure') : null,
        action('Clear', () => { viewer.select([]); state.query = ''; renderSide(); }, 'Clear the selection')),
      selected.length ? h('p.structure-residues', ...(() => {
        const runs = residueRuns(selected);
        return [runs.slice(0, 24).join(', '), runs.length > 24 ? ` and ${fmtCount(runs.length - 24)} more` : ''];
      })()) : null);
  }

  function renderSide() {
    // Typing in the query field survives a redraw.
    const typing = document.activeElement?.classList.contains('structure-query-input') ? document.activeElement.selectionStart : null;
    clear(sideEl);
    const structure = viewer.structure;
    if (state.message) sideEl.append(h(`div.callout.${state.message.kind === 'warn' ? 'warn' : 'ok'}`, icon(state.message.kind === 'warn' ? 'warning' : 'info'), h('span', state.message.text)));
    if (!structure) {
      sideEl.append(openPane(false));
      return;
    }
    const lines = describeStructure(structure);
    sideEl.append(
      h('div.pane.structure-words', h('h3', icon('info'), 'In words'), h('p.structure-origin', originText(state.origin, structure)), ...lines.map((line) => h('p', line))),
      selectionPane(),
      openPane(true));
    const input = sideEl.querySelector('.structure-query-input');
    if (input && Number.isInteger(state.errorAt)) {
      input.focus();
      input.setSelectionRange(Math.min(state.errorAt, input.value.length), input.value.length);
      state.errorAt = null;
    } else if (input && typing !== null) {
      input.focus();
      input.setSelectionRange(typing, typing);
    }
  }

  // --- The view ----------------------------------------------------------------------------------

  function render() {
    clear(root);
    const structure = viewer.structure;
    root.append(h('div.workbench-head', h('h1', icon('structure'), 'Structure', structure ? h('span.crumbs', ` · ${structure.meta.code || structure.label}`) : null), h('span.spacer')));
    if (!structure) {
      viewer.detach();
      root.append(h('div.view-body', h('div.structure-empty',
        h('div.planned', h('div.empty', icon('structure'), h('h3', 'A structure of the protein'),
          h('p', 'Open a PDB entry, an AlphaFold DB model or a file of your own: cartoon, sticks or a surface, biological assemblies, residues selected in words, labeled and focused on. Drawn with WebGPU, or the Canvas renderer where the browser offers none.'))),
        sideEl)));
      renderSide();
      return;
    }
    root.append(h('div.view-body.structure-body',
      h('div.pane.structure-pane', toolbarEl, viewer.el, legendEl, statusEl),
      sideEl));
    viewer.attach();
    renderToolbar();
    renderLegend();
    renderStatus();
    renderSide();
  }

  render();
  return {
    update(topics) {
      if (topics.has('theme')) viewer.setTheme(document.documentElement.dataset.theme === 'dark');
      if (topics.has('structure')) render();
    },
    destroy() {
      viewer.detach();
      state.handlers = null;
      root.remove();
    },
  };
}
