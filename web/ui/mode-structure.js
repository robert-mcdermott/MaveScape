// The Structure view (wave 5, slice 1; requirement X1): a protein's structure in MaveScape, needing
// no other program. Open a local file (PDB, mmCIF or BinaryCIF, gzipped or not), a PDB entry by its
// ID or an AlphaFold DB model by its UniProt accession (through the program's fetcher, so cached
// and then available offline); choose a biological assembly; draw it as a cartoon, sticks,
// spheres or a trace, with a surface; color it; select residues in Proteoscope's selection
// language ("chain A and resi 40-80", "resn CYS", "within 5 of ligand"), draw them as sticks,
// label them, and focus on a neighborhood. The structure is kept for the session. Wave 5, slice 2
// (X2): the workspace's target is mapped onto it (lib/mapping.js: every chain that holds it, each
// position's state, the entry's own record compared), the structures that cover the target are
// listed from PDBe's SIFTS, residues are selected by target position (`pos`) or reference
// (`uniprot`), and a selection is kept, position by position, from one structure to the next.

import { h, icon, clear, downloadBlob } from './dom.js';
import { toast } from './overlays.js';
import { fetchPublic } from './public-data.js';
import { createStructureViewer, STYLES, SURFACES } from './structure-viewer.js';
import { COLOR_SCHEMES } from '../lib/structure/coloring.js';
import { colorToHex, colormapGradientCSS } from '../lib/structure/colors.js';
import { countMask, residueKeysFromMask, SelectionError, selectAtoms } from '../lib/structure/select.js';
import { alphafoldEntry, applyAlphafoldEntry, ASYMMETRIC_UNIT_ID, assemblyChoices, chainSummaries, describeStructure, openStructureText, readStructureBytes, residueLabel, residueRuns, structureRequest } from '../lib/structures.js';
import { describeMapping, mapTarget, mappedLabel, mappingCSV, rankStructures, stretches } from '../lib/mapping.js';
import { targetProtein } from '../lib/target.js';
import { now } from '../lib/clock.js';

// Residue styles for a selection, as the selection pane offers them.
export const RESIDUE_STYLES = { sticks: 'Sticks', 'ball-stick': 'Ball and stick', spacefill: 'Spacefill', hide: 'Hide', none: 'As the rest' };

// The session's structure: the viewer (kept between visits to the view), where the structure
// came from, and the last selection typed.
export function structureState(app) {
  // mapping: the target on the chosen chain; maps: on every chain that holds it; mapTarget: the
  // target mapped; structures: the PDB entries that cover it, ranked; serial: the structure's.
  app.structureState ??= { viewer: null, origin: null, query: '', message: null, busy: '', mapping: null, maps: [], mapTarget: null, mapKey: '', structures: null, serial: 0 };
  return app.structureState;
}

function viewerOf(app) {
  const state = structureState(app);
  state.viewer ??= createStructureViewer({
    onPick: (residue, how) => state.handlers?.onPick?.(residue, how),
    onFocus: (residues) => state.handlers?.onFocus?.(residues),
    onChange: () => state.handlers?.onChange?.(),
    describe: (residue) => mappedLabel(state.mapping, residue.key),
  });
  return state.viewer;
}

// The workspace's target as the mapping reads it (the design's target, else the first): its protein,
// offset and UniProt accession; null without one.
export function workspaceTarget(ws) {
  const target = ws.targets.find((t) => t.id === ws.design?.targets?.[0]?.id) ?? ws.targets[0];
  if (!target?.sequence) return null;
  let sequence;
  try {
    sequence = targetProtein(target).replace(/\*+$/, '');
  } catch {
    return null;
  }
  return { id: target.id, name: target.name || 'The target', sequence, offset: target.offset ?? 0, accession: target.identifiers?.uniprot ?? '', length: sequence.length };
}

const targetKey = (t) => (t ? `${t.id}|${t.offset}|${t.accession}|${t.sequence}` : '');

// Maps the workspace's target onto the structure shown: every chain that holds it, the chain asked
// for current (else the best). Returns the current mapping, or null (no target, or on no chain).
export function mapStructure(app, chain = null) {
  const state = structureState(app);
  const structure = state.viewer?.structure;
  const target = workspaceTarget(app.store.ws);
  state.mapTarget = target;
  state.mapKey = `${state.serial}|${structure?.activeAssemblyId ?? ''}|${targetKey(target)}`;
  state.maps = structure && target ? mapTarget(structure, target) : [];
  state.mapping = state.maps.find((m) => m.chain === chain) ?? state.maps[0] ?? null;
  return state.mapping;
}

// The target positions of the residues selected, on the current mapping.
function selectedPositions(state) {
  const mapping = state.mapping;
  if (!mapping || !state.viewer) return [];
  return [...state.viewer.selection].map((key) => mapping.residuePosition.get(key)).filter(Boolean).sort((a, b) => a - b);
}

// Selects the residues of target positions on the current mapping; returns how many were placed.
export function selectPositions(app, positions) {
  const state = structureState(app);
  const keys = positions.map((p) => state.mapping?.positions[p - 1]?.residue).filter(Boolean);
  state.viewer.select(keys);
  return keys.length;
}

// The PDB entries that cover the target, ranked (PDBe's best_structures, through the program).
export async function findStructures(app) {
  const state = structureState(app);
  const target = workspaceTarget(app.store.ws);
  if (!target) return { ok: false, message: 'This workspace has no target: the structures listed are those that cover it.' };
  if (!target.accession) return { ok: false, message: `${target.name} has no UniProt accession: give it in Experiment, Target, and the PDB entries that cover it are listed.` };
  const key = `${target.accession}|${target.offset}|${target.length}`;
  if (state.structures?.key === key && state.structures.ok) return state.structures;
  const got = await fetchPublic(app, `pdbe/best-structures/${encodeURIComponent(target.accession)}`);
  state.structures = got.ok
    ? { ok: true, key, target, rows: rankStructures(got.json, target), retrieval: got.retrieval }
    : { ok: false, key, target, message: got.status === 404 ? `PDBe knows no structure of ${target.accession}.` : got.message };
  return state.structures;
}

// The target's UniProt accession, for its AlphaFold DB model: the design's target, else the first.
export function targetAccession(ws) {
  const target = ws.targets.find((t) => t.id === ws.design?.targets?.[0]?.id) ?? ws.targets[0];
  return target?.identifiers?.uniprot ?? '';
}

// Opens a structure: { pdb }, { alphafold } (an accession), or { file: { name, bytes } }, and the
// chain to map the target on (`chain`; the best otherwise). Returns { ok, message, structure,
// origin, mapping }; the structure is shown, replacing any other, the selection kept by position.
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
    // The selection's target positions, to select them again on the new structure.
    const kept = selectedPositions(state);
    state.origin = origin;
    state.query = '';
    state.message = null;
    state.serial += 1;
    await viewer.show(structure);
    const mapping = mapStructure(app, what.chain);
    if (kept.length && mapping) {
      const placed = selectPositions(app, kept);
      state.message = { kind: 'ok', text: `The selection is kept by target position: ${placed} of its ${kept.length} positions are on this structure${placed < kept.length ? ` (${stretches(kept.filter((p) => !mapping.positions[p - 1]?.residue), mapping.target.offset).join(', ')} not)` : ''}.` };
    }
    app.store.notify(['structure']);
    const words = describeStructure(structure).slice(1).join(' ');
    const mapped = mapping ? ` ${describeMapping(mapping, structure.meta.code || name)[0]}` : '';
    return { ok: true, structure, origin, mapping, message: `${originText(origin, structure)}: ${words}${mapped}` };
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
  // Target positions (`pos`) and the reference's (`uniprot`) are placed by the mapping, the target
  // aligned to the chain, not by the entry's own numbering or record.
  const state = structureState(app);
  const mapping = state.mapping;
  const numbering = /\b(pos|uniprot|unp)\b/i.exec(text);
  if (numbering && !mapping) {
    throw new SelectionError(state.mapTarget ? `${state.mapTarget.name} is on no chain of this structure: positions on it cannot be selected.` : 'This workspace has no target: positions are the target\'s, placed on the structure by mapping it.', numbering.index);
  }
  const shift = (list) => list.split(/([+,])/).map((item) => item.replace(/^(\d+)(?:-(\d+))?$/, (m, a, b) => (b ? `${Number(a) + mapping.target.offset}-${Number(b) + mapping.target.offset}` : `${Number(a) + mapping.target.offset}`))).join('');
  const read = mapping ? text.replace(/\bpos\s+([0-9][0-9,+-]*)/gi, (m, list) => `uniprot ${shift(list)}`) : text;
  const uniprot = mapping ? (residue) => {
    const position = mapping.residuePosition.get(residue.key);
    return position ? position + mapping.target.offset : null;
  } : undefined;
  const target = { id: 1, index: 1, name: viewer.structure.meta.code || 'structure', model, structure: viewer.structure, context: { selected: viewer.selection, focus: viewer.focused.length ? new Set(viewer.focused) : null, values: {}, uniprot } };
  let mask;
  try {
    mask = selectAtoms(read, [target]).get(target.id);
  } catch (error) {
    // Where the text the person typed goes wrong, when `pos` was read as `uniprot`.
    if (error instanceof SelectionError && read !== text) throw new SelectionError(error.message, -1);
    throw error;
  }
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
      mapStructure(app, state.mapping?.chain);
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

  // The target on the structure: the chain chosen, its positions' states in words, and ways to
  // select them and to write the mapping out.
  function mappingPane() {
    const structure = viewer.structure;
    const code = structure.meta.code || structure.label;
    const target = state.mapTarget;
    const head = h('h3', icon('target'), 'The target on the structure');
    if (!target) return h('div.pane.structure-mapping', head, h('p.muted', 'This workspace has no target. With one (a table and its target, or an example), each of its positions is placed on a residue of the structure, whatever the entry\'s numbering.'));
    if (!state.maps.length) return h('div.pane.structure-mapping', head, h('p', `${target.name} is on no chain of ${code}: no chain holds five of its residues aligned identical, and half of those aligned.`));
    const m = state.mapping;
    const [first, ...rest] = describeMapping(m, code);
    const positionsOf = (test) => m.positions.filter(test).map((p) => p.position);
    const on = positionsOf((p) => p.residue);
    const different = positionsOf((p) => p.state === 'different');
    const ambiguous = positionsOf((p) => p.ambiguous && p.residue);
    const pick = (label, positions, title) => (positions.length ? h('button.btn.small', { type: 'button', title, onclick: () => { selectPositions(app, positions); state.query = ''; renderSide(); } }, label) : null);
    const exportCSV = () => downloadBlob(new Blob([mappingCSV(m, code)], { type: 'text/csv' }), `${code.toLowerCase()}_chain-${m.chain}_mapping.csv`);
    return h('div.pane.structure-mapping', head,
      state.maps.length > 1 ? h('div.structure-chain', h('label', 'Chain'), select('Chain the target is mapped on', m.chain, state.maps.map((x) => [x.chain, `${x.chain} · ${fmtCount(x.onStructure)} positions, ${fmtCount(x.counts.identical)} identical`]), (chain) => { mapStructure(app, chain); renderSide(); })) : null,
      h('p.structure-mapping-lead', first),
      ...rest.map((line) => h('p', line)),
      h('div.btn-row',
        pick('Select the target', on, 'Select the residues the target\'s positions are on'),
        pick(`Select the ${different.length === 1 ? 'difference' : 'differences'}`, different, 'Select the residues where the structure has another residue than the target'),
        pick('Select the ambiguous', ambiguous, 'Select the residues an alignment as good would place otherwise'),
        h('button.btn.small', { type: 'button', title: 'The mapping, position by position (CSV)', onclick: exportCSV }, icon('download'), 'Mapping')),
      h('p.muted.small', 'Positions can be selected under Residues: "pos 30-40" (the target\'s), "uniprot 188-198" (the reference\'s). A selection is kept, position by position, when another structure is opened.'));
  }

  const METHOD_WORDS = { 'X-ray diffraction': 'X-ray', 'Electron Microscopy': 'cryo-EM', 'Solution NMR': 'NMR', 'Solid-state NMR': 'solid-state NMR', 'Electron Crystallography': 'electron crystallography', 'Neutron Diffraction': 'neutron' };

  // The structures that cover the target: its AlphaFold DB model, then the PDB entries SIFTS places
  // it on, ranked.
  function structuresPane(compact) {
    const target = workspaceTarget(store.ws);
    if (!target) return null;
    const head = h('h3', icon('layers'), 'Structures of the target');
    if (!target.accession) return h('div.pane.structure-list', head, h('p.muted', `Give ${target.name} its UniProt accession (Experiment, Target), and the PDB entries that cover it are listed here, from PDBe's SIFTS.`));
    const listed = state.structures?.key === `${target.accession}|${target.offset}|${target.length}` ? state.structures : null;
    if (!listed) {
      // One request at a time for the target's list; the side is drawn again when it comes.
      const key = `${target.accession}|${target.offset}|${target.length}`;
      if (state.structuresAsked !== key) {
        state.structuresAsked = key;
        findStructures(app).then(() => { if (state.handlers) renderSide(); });
      }
      return h('div.pane.structure-list', head, h('p.muted', `Asking PDBe for the structures of ${target.accession}…`));
    }
    const range = (a, b) => (a === b ? `${a}` : `${a}–${b}`);
    const row = (label, detail, onOpen, current) => h(`li${current ? '.current' : ''}`, h('div', h('strong', label), h('span.muted', detail)), h('button.btn.small', { type: 'button', onclick: onOpen, disabled: Boolean(current) }, current ? 'Shown' : 'Open'));
    const shown = state.origin;
    const items = [row('AlphaFold DB model', `predicted · all ${fmtCount(target.length)} positions`, () => open({ alphafold: target.accession }), shown?.kind === 'alphafold' && shown.id === target.accession)];
    if (listed.ok) {
      const rows = state.allStructures ? listed.rows : listed.rows.slice(0, compact ? 6 : 10);
      for (const r of rows) {
        const method = METHOD_WORDS[r.method] ?? r.method;
        const detail = `${method}${r.resolution ? ` ${r.resolution} Å` : ''} · chain${r.chains.length > 1 ? 's' : ''} ${r.chains.map((c) => c.id).slice(0, 6).join(', ')}${r.chains.length > 6 ? '…' : ''} · positions ${range(r.from, r.to)}`;
        items.push(row(r.id, detail, () => open({ pdb: r.id, chain: r.chains[0].id }), shown?.kind === 'pdb' && shown.id === r.id));
      }
    }
    return h('div.pane.structure-list', head,
      listed.ok ? h('p.muted.small', `${fmtCount(listed.rows.length)} PDB ${listed.rows.length === 1 ? 'entry covers' : 'entries cover'} ${target.name} (${target.accession}${target.offset ? `, from ${target.offset + 1}` : ''}), by SIFTS: the most of it first, then the best resolution. The positions are those the entry's sequence covers, observed or not.`) : h('p.muted.small', listed.message),
      h('ul.structure-rows', ...items),
      listed.ok && listed.rows.length > (compact ? 6 : 10) ? h('button.btn.small', { type: 'button', onclick: () => { state.allStructures = !state.allStructures; renderSide(); } }, state.allStructures ? 'Fewer' : `All ${fmtCount(listed.rows.length)}`) : null);
  }

  function renderSide() {
    // Typing in the query field survives a redraw.
    const typing = document.activeElement?.classList.contains('structure-query-input') ? document.activeElement.selectionStart : null;
    clear(sideEl);
    const structure = viewer.structure;
    if (state.message) sideEl.append(h(`div.callout.${state.message.kind === 'warn' ? 'warn' : 'ok'}`, icon(state.message.kind === 'warn' ? 'warning' : 'info'), h('span', state.message.text)));
    if (!structure) {
      sideEl.append(openPane(false));
      const list = structuresPane(false);
      if (list) sideEl.append(list);
      return;
    }
    const lines = describeStructure(structure);
    sideEl.append(
      h('div.pane.structure-words', h('h3', icon('info'), 'In words'), h('p.structure-origin', originText(state.origin, structure)), ...lines.map((line) => h('p', line))),
      mappingPane(),
      selectionPane());
    const list = structuresPane(true);
    if (list) sideEl.append(list);
    sideEl.append(openPane(true));
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

  if (viewer.structure && state.mapKey !== `${state.serial}|${viewer.structure.activeAssemblyId ?? ''}|${targetKey(workspaceTarget(store.ws))}`) mapStructure(app, state.mapping?.chain);
  render();
  return {
    update(topics) {
      if (topics.has('theme')) viewer.setTheme(document.documentElement.dataset.theme === 'dark');
      if (topics.has('structure')) {
        render();
        return;
      }
      // Another target (the workspace changed): mapped again.
      if (topics.has('ws') && viewer.structure) {
        const target = workspaceTarget(store.ws);
        if (state.mapKey !== `${state.serial}|${viewer.structure.activeAssemblyId ?? ''}|${targetKey(target)}`) {
          mapStructure(app, state.mapping?.chain);
          renderSide();
        }
      } else if (topics.has('ws') && !viewer.structure) renderSide();
    },
    destroy() {
      viewer.detach();
      state.handlers = null;
      root.remove();
    },
  };
}
