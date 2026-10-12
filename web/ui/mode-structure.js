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
// (`uniprot`), and a selection is kept, position by position, from one structure to the next. Wave 5,
// slice 3 (X3): residues colored by their positions' scores (ui/structure-coloring.js,
// lib/structure-scores.js) in the map's grammar, the run and condition the map shows; the selection
// shared with the map both ways, a picked residue's position shown in the inspector. Wave 5, slice 4
// (X4): what the structure says of each position (ui/structure-evidence.js): tracks beside the map,
// the scores by structural class, and the cluster test.

import { h, icon, clear, downloadBlob } from './dom.js';
import { promptDialog, showMenu, toast } from './overlays.js';
import { fetchPublic } from './public-data.js';
import { createStructureViewer, STYLES, SURFACES } from './structure-viewer.js';
import { COLOR_SCHEMES } from '../lib/structure/coloring.js';
import { colorToHex, colormapGradientCSS } from '../lib/structure/colors.js';
import { countMask, residueKeysFromMask, SelectionError, selectAtoms } from '../lib/structure/select.js';
import { alphafoldEntry, applyAlphafoldEntry, ASYMMETRIC_UNIT_ID, assemblyChoices, chainSummaries, describeStructure, openStructureText, originText, readStructureBytes, residueLabel, residueRuns, structureRequest } from '../lib/structures.js';
import { describeMapping, mapTarget, mappedLabel, mappingCSV, rankStructures, stretches } from '../lib/mapping.js';
import { targetProtein } from '../lib/target.js';
import { now } from '../lib/clock.js';
import { cellAt, cellName } from '../lib/map-model.js';
import { cellsAtPositions, positionRanges, positionsOfKeys, SCORE_COLORINGS } from '../lib/structure-scores.js';
import { activeRun } from './selections.js';
import { colorStructure, coloringControls, createPositionStrip, positionWords, scoresLegend, scoresSettings, scoreSource, sourceControls, stripRows } from './structure-coloring.js';
import { coloringCSV } from '../lib/structure-scores.js';
import { computeEvidence, evidenceState, evidenceStatistics, evidenceValues } from './structure-evidence.js';
import { CLASSES, CLASS_BY_ID, describeClusters, describeEffects, evidenceCSV, SS_WORDS } from '../lib/structure-evidence.js';
import { figurePanel, openView, removeView, saveView } from './structure-views.js';
import { structureWords, viewWords } from '../lib/structure-record.js';

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
    describe: (residue) => {
      const at = positionOfResidue(state, residue.key);
      if (!at) return '';
      const words = positionWords(state.colored, at.position);
      return `${mappedLabel(at.map, residue.key)}${words ? ` · ${words}` : ''}${evidenceWords(state, residue.key)}`;
    },
  });
  return state.viewer;
}

// What the structure says of a residue of the chain the evidence was read for (wave 5, slice 4):
// " · buried, RSA 0.03, α-helix".
function evidenceWords(state, key) {
  const r = state.evidence?.status === 'ready' ? state.evidence.result : null;
  const p = r?.positions.find((x) => x.residue === key);
  if (!p?.class) return '';
  return ` · ${p.class}, RSA ${p.rsa.toFixed(2)}, ${SS_WORDS[p.ss] ?? 'coil'}${p.interface && p.distance ? `, ${p.distance.toFixed(1)} Å from a partner` : ''}`;
}

// A residue's target position on any chain the target is mapped onto: { map, position } or null.
export function positionOfResidue(state, key) {
  for (const map of [state.mapping, ...state.maps]) {
    const position = map?.residuePosition.get(key);
    if (position) return { map, position };
  }
  return null;
}

// The workspace's target as the mapping reads it (a run's, when one is given: the run the map shows,
// wave 5, slice 3; else the design's target, else the first): its protein, offset and UniProt
// accession; null without one.
export function workspaceTarget(ws, run = null) {
  const own = run?.inputs?.design?.targets?.length === 1 ? run.inputs.design.targets[0] : null;
  const target = (own && (ws.targets.find((t) => t.id === own.id) ?? own)) ?? ws.targets.find((t) => t.id === ws.design?.targets?.[0]?.id) ?? ws.targets[0];
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
  const target = workspaceTarget(app.store.ws, activeRun(app));
  state.mapTarget = target;
  state.mapKey = `${state.serial}|${structure?.activeAssemblyId ?? ''}|${targetKey(target)}`;
  state.maps = structure && target ? mapTarget(structure, target) : [];
  state.mapping = state.maps.find((m) => m.chain === chain) ?? state.maps[0] ?? null;
  // What the structure says of the positions, read again for the new mapping (in the background).
  computeEvidence(app, state, { notify: () => state.handlers?.onChange?.() });
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

// Positions of the mapped target as positions of a scores' target ({ protein, offset }: a map
// model's, a run's), by reference numbering where their residues agree; and back.
function toModelPositions(model, target, positions) {
  const shift = (target.offset ?? 0) - (model.target?.offset ?? model.offset ?? 0);
  const protein = model.protein;
  return positions.map((q) => q + shift).filter((p, k) => p >= 1 && p <= protein.length && protein[p - 1] === target.sequence[positions[k] - 1]);
}

function fromModelPositions(model, target, positions) {
  const shift = (model.offset ?? 0) - (target.offset ?? 0);
  return positions.map((p) => p + shift).filter((q, k) => q >= 1 && q <= target.length && target.sequence[q - 1] === model.protein[positions[k] - 1]);
}

// The structure's selection shared with the map (wave 5, slice 3): the target positions of the
// residues selected, on any chain that holds the target → their designed cells on the map of the run
// and condition (or contrast) it shows, as "at …" selects them; nothing selected there when no
// position is. With focus, a residue picked puts its position in the inspector.
export function shareSelection(app, { focusKey = null } = {}) {
  const state = structureState(app);
  const viewer = state.viewer;
  if (!viewer?.structure || !state.mapping) return null;
  const from = scoreSource(app);
  if (!from.ok) return null;
  const positions = [...new Set([...viewer.selection].map((key) => positionOfResidue(state, key)?.position).filter(Boolean))].sort((a, b) => a - b);
  const onModel = toModelPositions(from.model, state.mapTarget, positions);
  const keys = cellsAtPositions(from.model, onModel, cellName, cellAt);
  const selection = keys.length ? { run: from.run.id, condition: from.condition, keys, query: `at ${positionRanges(onModel)}` } : null;
  state.syncedSelection = selection;
  app.store.setUI({ selection }, ['selection']);
  const picked = focusKey && viewer.selection.has(focusKey) ? positionOfResidue(state, focusKey) : null;
  const position = picked ? toModelPositions(from.model, state.mapTarget, [picked.position])[0] : null;
  if (position) app.focusItem({ kind: 'position', run: from.run.id, condition: from.condition, position });
  return { positions: onModel, keys, position };
}

// The map's selection drawn on the structure: the residues of its variants' positions, on every
// chain that holds the target (a selection of another run of the same protein too). Nothing
// selected on the map, nothing here. Returns whether the structure's selection was set.
export function applyMapSelection(app) {
  const state = structureState(app);
  const viewer = state.viewer;
  const sel = app.store.ui.selection;
  state.syncedSelection = sel;
  if (!viewer?.structure) return false;
  if (!sel) {
    if (!viewer.selection.size) return false;
    viewer.select([]);
    return true;
  }
  const run = app.store.ws.runs.find((r) => r.id === sel.run);
  const own = run?.inputs.design.targets?.length === 1 ? run.inputs.design.targets[0] : null;
  if (!own || !state.mapping) return false;
  let protein;
  try {
    protein = targetProtein(own).replace(/\*+$/, '');
  } catch {
    return false;
  }
  const positions = fromModelPositions({ protein, offset: own.offset ?? 0 }, state.mapTarget, positionsOfKeys(sel.keys));
  viewer.select(state.maps.flatMap((m) => positions.map((q) => m.positions[q - 1]?.residue).filter(Boolean)));
  state.query = '';
  return true;
}

// A residue picked (a click, or remote control): selected (with additive, added or taken away), the
// selection shared with the map, its position in the inspector.
export function pickResidue(app, key, { additive = false } = {}) {
  const viewer = structureState(app).viewer;
  if (!key) {
    if (!additive) viewer.select([]);
  } else viewer.select([key], { additive });
  structureState(app).query = '';
  return shareSelection(app, { focusKey: key });
}

// The PDB entries that cover the target, ranked (PDBe's best_structures, through the program).
export async function findStructures(app) {
  const state = structureState(app);
  const target = workspaceTarget(app.store.ws, activeRun(app));
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

// Opens a structure: { pdb }, { alphafold } (an accession), or { file: { name, bytes }, origin }
// (origin: a kept structure's, wave 5 slice 5; a file of the person's otherwise), and the chain to
// map the target on (`chain`; the best otherwise). keep: false not to keep the selection. Returns {
// ok, message, structure, origin, mapping }; the structure is shown, replacing any other, the
// selection kept by position. The bytes read are kept for the session (state.file), so a view of
// it can be saved.
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
      origin = what.origin ?? { kind: 'file', name, opened: now() };
      if (origin.kind === 'alphafold' && origin.entry) entry = origin.entry;
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
        // The entry's words, kept with the origin so a saved view reopens offline as it was.
        const kept = Object.fromEntries(['entryId', 'uniprotAccession', 'uniprotDescription', 'gene', 'organismScientificName', 'latestVersion', 'modelCreatedDate'].filter((k) => entry[k] !== undefined).map((k) => [k, entry[k]]));
        origin = { kind: 'alphafold', id: request.id, version: entry.latestVersion, entry: kept, retrieval: got.retrieval };
      }
    }
    state.busy = `Reading ${name}…`;
    state.handlers?.onChange?.();
    const { text, name: textName } = await readStructureBytes(bytes, name);
    const structure = openStructureText(text, textName);
    if (entry) applyAlphafoldEntry(structure, entry);
    // The selection's target positions, to select them again on the new structure.
    const kept = what.keep === false ? [] : selectedPositions(state);
    state.origin = origin;
    state.file = { name, bytes };
    state.view = null;
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

// Where the structure shown came from, in words (lib/structures.js).
export { originText };

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
      if (!residue && additive) return;
      pickResidue(app, residue?.key ?? null, { additive });
      renderSide();
      renderStrip();
    },
    onFocus(residues) {
      state.query = '';
      notice(`Focused on ${residues.map(residueLabel).join(', ')}: the residues within 5 Å are drawn with their side chains.`);
    },
    onChange() {
      renderToolbar();
      renderStatus();
      renderLegend();
      renderStrip();
      if (viewer.structure && root.querySelector('.structure-body')) renderSide();
    },
  };
  const settings = scoresSettings(state);

  // Colors the residues by scores again (the settings, the run, the mapping or the palette changed).
  async function refreshScores() {
    await colorStructure(app, state);
    if (!state.handlers) return;
    renderToolbar();
    renderLegend();
    renderStrip();
    if (viewer.structure) renderSide();
  }

  // A selection made here, shared with the map.
  function shared() {
    shareSelection(app);
    renderStrip();
  }

  // The strip of target positions below the view: a click selects a position's residues (on every
  // chain that holds it), a drag a stretch.
  const strip = createPositionStrip({
    onSelect(positions, additive) {
      const keys = state.maps.flatMap((m) => positions.map((q) => m.positions[q - 1]?.residue).filter(Boolean));
      if (!keys.length) {
        notice(`${positions.length === 1 ? `Position ${positions[0]} is` : 'These positions are'} on no residue of ${viewer.structure.meta.code || 'the structure'}.`, 'warn');
        return;
      }
      const next = additive ? [...new Set([...viewer.selection, ...keys])] : keys;
      viewer.select(next);
      state.query = '';
      shareSelection(app, { focusKey: positions.length === 1 ? keys[0] : null });
      renderSide();
      renderStrip();
    },
    describe(q) {
      const m = state.mapping;
      const p = m?.positions[q - 1];
      if (!p) return '';
      const three = { A: 'Ala', R: 'Arg', N: 'Asn', D: 'Asp', C: 'Cys', Q: 'Gln', E: 'Glu', G: 'Gly', H: 'His', I: 'Ile', L: 'Leu', K: 'Lys', M: 'Met', F: 'Phe', P: 'Pro', S: 'Ser', T: 'Thr', W: 'Trp', Y: 'Tyr', V: 'Val' }[p.code] ?? p.code;
      const residue = p.residue ? viewer.model.residueMap.get(p.residue) : null;
      const where = residue ? residueLabel(residue) : p.state === 'unobserved' ? 'not observed in the structure' : p.state === 'deleted' ? 'missing from the structure\'s sequence' : 'outside the structure';
      const confidence = residue && viewer.structure.meta.isPredicted && Number.isFinite(residue.confidence) ? ` · pLDDT ${residue.confidence.toFixed(1)}` : '';
      const words = positionWords(state.colored, q);
      return `Position ${q} · ${three}${m.target.offset ? ` (${p.reference})` : ''}: ${where}${confidence}${words ? ` · ${words}` : ''}${p.residue ? evidenceWords(state, p.residue) : ''}`;
    },
  });

  function renderStrip() {
    const m = state.mapping;
    if (!viewer.structure || !m) {
      strip.update({ length: 0, rows: [] });
      return;
    }
    const selected = new Set();
    for (const key of viewer.selection) {
      const at = positionOfResidue(state, key);
      if (at) selected.add(at.position);
    }
    const ev = evidenceState(state);
    strip.update({ length: m.positions.length, offset: m.target.offset, rows: stripRows(viewer.colorScheme === 'scores' ? state.colored : null, m, viewer.model, viewer.structure.meta.code || 'the structure', ev.status === 'ready' ? ev.result : null), selected });
  }

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
    // The scores' colorings first (wave 5, slice 3), when the target is on the structure.
    const colorSelect = h('select.input.small', { 'aria-label': 'Color by', title: 'Color by', onchange: () => chooseColoring(colorSelect.value) },
      state.mapping ? h('optgroup', { label: 'Scores' }, ...Object.entries(SCORE_COLORINGS).map(([k, v]) => h('option', { value: `scores:${k}`, selected: viewer.colorScheme === 'scores' && settings.how === k }, v.label))) : null,
      h('optgroup', { label: 'The structure' }, state.mapping ? h('option', { value: 'scores:class', selected: viewer.colorScheme === 'scores' && settings.how === 'class' }, 'Structural class') : null, ...schemes.map((s) => h('option', { value: s.id, selected: viewer.colorScheme === s.id }, s.label))));
    toolbarEl.append(
      select('Style', viewer.style, Object.entries(STYLES).map(([k, v]) => [k, v.label]), (v) => viewer.setStyle(v)),
      colorSelect,
      select('Surface', viewer.surface.kind, Object.entries(SURFACES).map(([k, v]) => [k, v.label, viewer.kind !== 'webgpu' && k !== 'off']), (v) => viewer.setSurface(v)),
      assemblies.length ? select('Assembly', structure.activeAssemblyId ?? ASYMMETRIC_UNIT_ID, assemblies.map((a) => [a.id, `${a.label} · ${fmtCount(a.atoms)} atoms${a.tooLarge ? ' (too large)' : ''}`, a.tooLarge]), (v) => setAssembly(v)) : null,
      h('span.spacer'),
      h(`span.renderer-badge${viewer.kind === 'canvas' ? '.fallback' : ''}`, { title: viewer.kind === 'canvas' ? `Drawn by the Canvas renderer: ${viewer.failure}. It draws without surfaces or ambient occlusion; Chrome, Edge and Brave offer WebGPU.` : 'Drawn with WebGPU' }, viewer.kind === 'canvas' ? 'Canvas' : 'WebGPU'),
      h('button.btn.small', { type: 'button', title: 'Fit the structure in the view (F)', onclick: () => viewer.fit() }, 'Fit'),
      h('button.btn.small', { type: 'button', title: 'An image of the view, or a figure panel with its legend', onclick: (event) => showMenu(event.currentTarget, [
        { label: 'Image (PNG, twice the view\'s size)', icon: 'download', onSelect: saveImage },
        { label: 'Figure panel (PNG, 4×, with its legend and what it shows)', icon: 'download', onSelect: savePanel },
      ]) }, icon('download'), 'Image'));
  }

  // A coloring chosen: "scores:<how>", or one of the structure's own schemes.
  function chooseColoring(value) {
    if (value.startsWith('scores:')) {
      settings.how = value.slice(7);
      refreshScores();
      return;
    }
    settings.how = null;
    state.colored = null;
    viewer.setColor(value);
    renderSide();
  }

  function setAssembly(id) {
    try {
      viewer.setAssembly(id);
      mapStructure(app, state.mapping?.chain);
      state.query = '';
      render();
      if (settings.how) refreshScores();
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

  // A figure panel (wave 5, slice 5): 4× the view, its legend below, what it shows written into it.
  async function savePanel() {
    try {
      const panel = await figurePanel(app, { scale: 4, legend: true });
      downloadBlob(new Blob([panel.bytes], { type: 'image/png' }), panel.name);
      app.log(`Wrote the figure panel ${panel.name} (${panel.metadata.image.width} × ${panel.metadata.image.height}).`);
    } catch (error) {
      toast(error.message, { kind: 'error' });
    }
  }

  function renderLegend() {
    clear(legendEl);
    if (viewer.colorScheme === 'scores' && viewer.structure) {
      const legend = scoresLegend(state.colored);
      if (legend) legendEl.append(legend);
      return;
    }
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
        shared();
        renderSide();
        return;
      }
      try {
        const { keys } = selectResidues(app, state.query);
        viewer.select(keys);
        shared();
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
        action('Clear', () => { viewer.select([]); state.query = ''; shared(); renderSide(); }, 'Clear the selection')),
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
    const pick = (label, positions, title) => (positions.length ? h('button.btn.small', { type: 'button', title, onclick: () => { selectPositions(app, positions); state.query = ''; shared(); renderSide(); } }, label) : null);
    const exportCSV = () => downloadBlob(new Blob([mappingCSV(m, code)], { type: 'text/csv' }), `${code.toLowerCase()}_chain-${m.chain}_mapping.csv`);
    return h('div.pane.structure-mapping', head,
      state.maps.length > 1 ? h('div.structure-chain', h('label', 'Chain'), select('Chain the target is mapped on', m.chain, state.maps.map((x) => [x.chain, `${x.chain} · ${fmtCount(x.onStructure)} positions, ${fmtCount(x.counts.identical)} identical`]), (chain) => { mapStructure(app, chain); if (settings.how) refreshScores(); else { renderSide(); renderStrip(); } })) : null,
      h('p.structure-mapping-lead', first),
      ...rest.map((line) => h('p', line)),
      h('div.btn-row',
        pick('Select the target', on, 'Select the residues the target\'s positions are on'),
        pick(`Select the ${different.length === 1 ? 'difference' : 'differences'}`, different, 'Select the residues where the structure has another residue than the target'),
        pick('Select the ambiguous', ambiguous, 'Select the residues an alignment as good would place otherwise'),
        h('button.btn.small', { type: 'button', title: 'The mapping, position by position (CSV)', onclick: exportCSV }, icon('download'), 'Mapping')),
      h('p.muted.small', 'Positions can be selected under Residues: "pos 30-40" (the target\'s), "uniprot 188-198" (the reference\'s). A selection is kept, position by position, when another structure is opened.'));
  }

  // Scores on the structure (wave 5, slice 3): the coloring, the run and condition the map shows (or
  // the comparison's sides), the coloring's own choices, its words, its file.
  function scoresPane() {
    if (!state.mapping) return null;
    const head = h('h3', icon('heatmap'), 'Scores on the structure');
    const from = settings.how === 'disagreement' ? null : scoreSource(app);
    const choose = h('select.input.small', { 'aria-label': 'Color the residues by', onchange: () => chooseColoring(choose.value ? `scores:${choose.value}` : (viewer.structure.meta.isPredicted ? 'plddt' : 'chain')) },
      h('option', { value: '', selected: !settings.how || settings.how === 'class' }, 'The structure\'s own colors'),
      ...Object.entries(SCORE_COLORINGS).map(([k, v]) => h('option', { value: k, selected: settings.how === k }, v.label)));
    const colored = viewer.colorScheme === 'scores' && settings.how !== 'class' ? state.colored : null;
    const code = viewer.structure.meta.code || viewer.structure.label;
    const exportCSV = () => downloadBlob(new Blob([coloringCSV(colored.values, state.mapping, code, colored.palette)], { type: 'text/csv' }), `${code.toLowerCase()}_chain-${state.mapping.chain}_${colored.values.how === 'substitution' ? `to-${colored.values.substitution === '*' ? 'stop' : colored.values.substitution}` : colored.values.how}.csv`);
    const palette = colored?.ok && colored.values.domain.kind === 'diverging'
      ? select('Colors', app.mapView?.palette ?? 'rdbu', [['rdbu', 'Blue (lower) – red (higher)'], ['puor', 'Purple (lower) – orange (higher)']], (v) => { app.mapView ??= { colorBy: 'score', rowOrder: 'biochemical', palette: 'rdbu', condition: 0, contrast: 0, show: 'all', page: 0 }; app.mapView.palette = v; refreshScores(); })
      : null;
    return h('div.pane.structure-scores', head,
      h('div.structure-chain', h('label', 'Color by'), choose, palette),
      settings.how && settings.how !== 'disagreement' ? sourceControls(app, from, () => { mapStructure(app, state.mapping?.chain); refreshScores(); }) : null,
      coloringControls(app, settings, from?.run ?? null, () => refreshScores()),
      colored ? (colored.ok ? colored.words.map((line) => h('p', line)) : h(`div.callout.${colored.pending ? 'ok' : 'warn'}`, icon(colored.pending ? 'info' : 'warning'), h('span', colored.message)))
        : h('p.muted', from?.ok ? `Each residue of the target can take its position's scores (${from.words}), in the map's colors: positions whose substitutions were not measured drawn gray, never in the wild type's color.` : from?.message ?? ''),
      h('div.btn-row',
        !colored && from?.ok ? h('button.btn.small.primary', { type: 'button', onclick: () => chooseColoring('scores:median') }, 'Color by the median score') : null,
        colored?.ok ? h('button.btn.small', { type: 'button', title: 'Each target position\'s value, state and color, with its residue (CSV)', onclick: exportCSV }, icon('download'), 'Colors') : null,
        app.store.ui.selection?.keys.length ? h('button.btn.small', { type: 'button', title: 'The Map view, with the selection', onclick: () => app.setMode('map') }, icon('heatmap'), `${fmtCount(app.store.ui.selection.keys.length)} selected on the map`) : null),
      h('p.muted.small', 'A click on a residue (or a position in the strip below the view) selects its substitutions on the map and shows the position in the inspector; a selection made on the map is drawn here. The view follows the run and condition the map shows.'));
  }

  // Saved views (wave 5, slice 5): the workspace's, each reopened as it was saved; the view shown
  // saved under a name.
  function viewsPane(compact) {
    const views = store.ws.structureViews ?? [];
    if (!views.length && !viewer.structure) return null;
    const save = async () => {
      const name = await promptDialog({ title: 'Save the view', label: 'Name', value: views.find((v) => v.id === state.view)?.name ?? `${viewer.structure.meta.code || 'Structure'} ${views.length + 1}`, hint: 'The structure, its chain and mapping, the camera, style, colors (and the run they are of), the residues selected, drawn and labeled. A view saved under a name already used is saved again.' });
      if (!name) return;
      const saved = await saveView(app, name);
      notice(saved.message, saved.ok ? 'ok' : 'warn');
    };
    const openIt = async (id) => {
      const opened = await openView(app, id);
      if (!opened.ok) notice(opened.message, 'warn');
    };
    const rows = views.map((v) => {
      const entry = (store.ws.structures ?? []).find((x) => x.id === v.structure);
      return h(`li${v.id === state.view ? '.current' : ''}`,
        h('div', h('strong', v.name), h('span.muted', { title: entry ? structureWords(entry) : '' }, viewWords(v, store.ws))),
        h('span.btn-row', h('button.btn.small', { type: 'button', onclick: () => openIt(v.id) }, v.id === state.view ? 'Again' : 'Open'),
          h('button.icon-button', { type: 'button', title: `Remove the view "${v.name}"`, 'aria-label': `Remove the view ${v.name}`, onclick: () => { const r = removeView(app, v.id); notice(r.message, r.ok ? 'ok' : 'warn'); } }, icon('trash'))));
    });
    return h(`div.pane.structure-views${compact ? '.compact' : ''}`,
      h('h3', icon('save'), 'Saved views', h('span.spacer'), views.length ? h('span.muted', String(views.length)) : null),
      views.length ? h('ul.structure-rows', ...rows) : h('p.muted', 'A view saved here keeps the structure with the workspace (in the library, by its SHA-256, and in its archive) and reopens as it was: chain, camera, style, colors and the run they are of, residues selected, drawn and labeled.'),
      viewer.structure ? h('div.btn-row', h('button.btn.small.primary', { type: 'button', onclick: save }, icon('save'), 'Save the view…')) : null);
  }

  // Structure as evidence (wave 5, slice 4): the structural classes and the partners they are read
  // with, the scores by class, the cluster test, the file; the tracks beside the map.
  function evidencePane() {
    if (!state.mapping) return null;
    const ev = evidenceState(state);
    const head = h('h3', icon('layers'), 'Structure as evidence');
    if (ev.status !== 'ready' || !ev.result) {
      return h('div.pane.structure-evidence', head, ev.status === 'failed' ? h('div.callout.warn', icon('warning'), h('span', ev.message)) : h('p.muted', ev.message || 'Reading what the structure says of each position…'));
    }
    const r = ev.result;
    const code = viewer.structure.meta.code || viewer.structure.label;
    const offset = state.mapTarget?.offset ?? 0;
    const nameOf = (q) => `${state.mapTarget.sequence[q - 1]}${q + offset}`;
    const counts = CLASSES.map((c) => [c, r.positions.filter((p) => p.class === c.id).length]).filter(([, n]) => n);
    const chosen = ev.partners.filter((p) => ev.chosen?.includes(p.id));
    const additives = ev.partners.filter((p) => p.additive);
    const partnerSelect = select('Partners the interface is read with', ev.choice, [['all', `Every partner${additives.length ? ', no additive' : ''} (${ev.partners.filter((p) => !p.additive).length})`], ...ev.partners.map((p) => [p.id, p.label])], (v) => { ev.choice = v; computeEvidence(app, state, { notify: () => state.handlers?.onChange?.() }); });
    const selectClass = (id) => {
      viewer.select(r.positions.filter((p) => p.class === id).map((p) => p.residue));
      state.query = '';
      shared();
      renderSide();
    };
    const from = scoreSource(app);
    const values = evidenceValues(state, from);
    const stats = evidenceStatistics(ev, values);
    const exportCSV = () => downloadBlob(new Blob([evidenceCSV(r, code, values?.valueAt ?? null, 'median_score')], { type: 'text/csv' }), `${code.toLowerCase()}_chain-${r.chain}_evidence.csv`);
    const lowWord = values?.lossBelow === false ? 'Higher' : 'Lower';
    const body = [
      h('p', `On ${code} chain ${r.chain}: ${counts.map(([c, n]) => `${fmtCount(n)} ${c.label}`).join(', ')} of the target's positions on residues. Interface: within 4 Å of ${chosen.length ? chosen.map((p) => p.label).join(', ') : 'no partner'}${additives.length && ev.choice === 'all' ? ` (additives left out: ${additives.map((p) => p.label.replace(/ \(an additive\)$/, '')).join(', ')})` : ''}.${r.predicted ? (ev.pae ? ' Exposure and disorder are read with the model\'s aligned error (PAE).' : ` Exposure and disorder are read without the model's aligned error (${ev.paeNote || 'none'}).`) : ''}`),
      h('div.structure-chain', h('label', 'Partners'), partnerSelect),
    ];
    if (!stats) body.push(h('p.muted', from?.ok ? 'The scores could not be read by class.' : 'With a score run, each class\'s scores are compared with the rest, and the least tolerant positions tested for clusters.'));
    else {
      const { effects, clusters } = stats;
      body.push(h('table.data.compact.structure-classes',
        h('thead', h('tr', h('th', 'Class'), h('th.r', 'Positions'), h('th.r', 'Median'), h('th.r', { title: `How often a position of the class scores ${lowWord.toLowerCase()} than one of the rest (Mann–Whitney)` }, lowWord), h('th.r', { title: 'Benjamini–Hochberg\'s adjusted p' }, 'q'), h('th', ''))),
        h('tbody', ...effects.classes.map((c) => h('tr',
          h('td', h('i.score-swatch', { style: { background: CLASS_BY_ID.get(c.id).color } }), ` ${c.label}`),
          h('td.r', fmtCount(c.n)), h('td.r', Number.isFinite(c.median) ? c.median.toFixed(2) : '—'),
          h('td.r', c.test ? `${Math.round(100 * (values.lossBelow ? c.test.below : 1 - c.test.below))}%` : '—'),
          h('td.r', c.test ? (c.test.q < 0.001 ? c.test.q.toExponential(1) : c.test.q.toFixed(3)) : '—'),
          h('td', h('button.btn.small', { type: 'button', onclick: () => selectClass(c.id) }, 'Select')))))));
      body.push(h('p.muted.small', `Each position's median score (${values.words}); the positions are the units. ${lowWord}: how often a position of the class scores ${lowWord.toLowerCase()} than one of the rest (Mann–Whitney); q, its BH-adjusted p.`));
      const fraction = select('The share of positions called least tolerant', String(ev.fraction), [['0.1', '10%'], ['0.2', '20%'], ['0.3', '30%']], (v) => { ev.fraction = Number(v); renderSide(); });
      const seed = h('input.input.small', { type: 'number', min: '1', step: '1', value: String(ev.seed), 'aria-label': 'Seed of the draws', style: { width: '70px' }, onchange: () => { ev.seed = Math.max(1, Math.round(Number(seed.value) || 1)); renderSide(); } });
      body.push(h('h4.structure-sub', 'Are the least tolerant clustered?'), h('div.structure-chain', h('label', 'Least tolerant'), fraction, h('label', 'Seed'), seed));
      body.push(...describeClusters(clusters, nameOf).map((line) => h('p', line)));
      if (clusters?.clusters.length) {
        body.push(h('div.btn-row', ...clusters.clusters.slice(0, 4).map((c, i) => h('button.btn.small', { type: 'button', title: c.map(nameOf).join(', '), onclick: () => { selectPositions(app, c); state.query = ''; shared(); renderSide(); } }, `Select group ${i + 1} (${c.length})`)),
          h('button.btn.small', { type: 'button', onclick: () => { selectPositions(app, clusters.sensitive); state.query = ''; shared(); renderSide(); } }, `Select the ${fmtCount(clusters.k)} least tolerant`)));
      }
      body.push(h('p.muted.small', describeEffects(effects, code)[0]));
    }
    body.push(h('div.btn-row', h('button.btn.small', { type: 'button', title: 'Each target position: its secondary structure, accessibility, exposure, partner and class (CSV)', onclick: exportCSV }, icon('download'), 'Evidence')),
      h('p.muted.small', 'Beside the map (Tracks): the structural class and the secondary structure, shown; the relative accessibility, the exposure (pPSE), the distance to a partner and a model\'s pLDDT, to show. In the map\'s query field, "in feature buried" selects the variants of buried positions.'));
    return h('div.pane.structure-evidence', head, ...body);
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
      const views = viewsPane(false);
      if (views) sideEl.append(views);
      sideEl.append(openPane(false));
      const list = structuresPane(false);
      if (list) sideEl.append(list);
      return;
    }
    const lines = describeStructure(structure);
    sideEl.append(h('div.pane.structure-words', h('h3', icon('info'), 'In words'), h('p.structure-origin', originText(state.origin, structure)), ...lines.map((line) => h('p', line))));
    sideEl.append(viewsPane(true), mappingPane());
    const scores = scoresPane();
    if (scores) sideEl.append(scores);
    const evidence = evidencePane();
    if (evidence) sideEl.append(evidence);
    sideEl.append(selectionPane());
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
      h('div.pane.structure-pane', toolbarEl, viewer.el, legendEl, strip.el, statusEl),
      sideEl));
    viewer.attach();
    renderToolbar();
    renderLegend();
    renderStrip();
    renderStatus();
    renderSide();
  }

  // What the mapping was made for: the structure, its assembly, the target (the run the map shows).
  const mapKeyNow = () => `${state.serial}|${viewer.structure?.activeAssemblyId ?? ''}|${targetKey(workspaceTarget(store.ws, activeRun(app)))}`;

  if (viewer.structure && state.mapKey !== mapKeyNow()) mapStructure(app, state.mapping?.chain);
  // A selection made on the map since the view was last shown is drawn here.
  if (viewer.structure && store.ui.selection !== state.syncedSelection) applyMapSelection(app);
  render();
  if (viewer.structure && settings.how) refreshScores();
  return {
    update(topics) {
      if (topics.has('theme')) viewer.setTheme(document.documentElement.dataset.theme === 'dark');
      if (topics.has('structure')) {
        render();
        return;
      }
      // Another target (the workspace changed, or the run the map shows): mapped again.
      let changed = false;
      if ((topics.has('ws') || topics.has('focus')) && viewer.structure && state.mapKey !== mapKeyNow()) {
        mapStructure(app, state.mapping?.chain);
        changed = true;
      } else if (topics.has('ws')) renderSide();
      // A selection made on the map (or elsewhere: Score, Compare, remote control) drawn here.
      if (topics.has('selection') && viewer.structure && store.ui.selection !== state.syncedSelection && applyMapSelection(app)) changed = true;
      // The scores colored by: their run's results, the comparison, the colors' setting, the run.
      const runChanged = topics.has('focus') && settings.how !== 'disagreement' && activeRun(app)?.id !== state.colored?.run?.id;
      if (viewer.structure && settings.how && (changed || runChanged || ['ws', 'results', 'compare', 'colors', 'workspace-loaded'].some((t) => topics.has(t)))) refreshScores();
      else if (changed) {
        renderSide();
        renderStrip();
      } else if (viewer.structure && (topics.has('selection') || topics.has('results'))) renderSide();
    },
    destroy() {
      viewer.detach();
      state.handlers = null;
      root.remove();
    },
  };
}
