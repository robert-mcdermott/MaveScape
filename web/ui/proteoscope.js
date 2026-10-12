// Open in Proteoscope (wave 5, slice 6; requirement X6): the structure shown, its scores and the
// view, handed to a Proteoscope running on this computer, in what it already accepts
// (lib/proteoscope.js). The program finds it (handoff.go, GET /api/proteoscope); when it is not
// running the Structure view offers nothing, and nothing else depends on it.
//   - A PDB entry or an AlphaFold DB model, to a Proteoscope MaveScape was tested with: a link to
//     the session (the structure fetched by its ID, the scores as its custom residue data, the
//     style, residues drawn, hidden, selected, labeled and focused on, the camera).
//   - To a version not tested: a link to the structure alone (#fetch=), and the session as a file
//     to try.
//   - A file of the person's: the session as a file (.proteoscope.json), the file embedded, to open
//     in Proteoscope.

import { downloadBlob } from './dom.js';
import { structureState } from './mode-structure.js';
import { STYLES } from './structure-viewer.js';
import { scoresSettings } from './structure-coloring.js';
import { colorToHex } from '../lib/structure/colors.js';
import { readStructureBytes, ASYMMETRIC_UNIT_ID } from '../lib/structures.js';
import { STATE_COLORS } from '../lib/structure-scores.js';
import { fetchLink, fetchSource, fileSource, linkPayload, residueData, sessionDocument, sessionFileName, sessionLink } from '../lib/proteoscope.js';
import { now } from '../lib/clock.js';

const NOT_FOUND = { found: false, tested: false, looked: '127.0.0.1:8765–8814' };

// Is Proteoscope running on this computer? { found, url, version, tested, remoteControl, looked,
// off, reason }. A page without MaveScape's program behind it (a static copy) finds none.
export async function findProteoscope(app, { again = false } = {}) {
  const state = structureState(app);
  const before = `${state.proteoscope?.found}|${state.proteoscope?.url}|${state.proteoscope?.version}`;
  try {
    const response = await fetch(`/api/proteoscope${again ? '?again=1' : ''}`, { cache: 'no-store' });
    state.proteoscope = response.ok ? await response.json() : { ...NOT_FOUND };
  } catch {
    state.proteoscope = { ...NOT_FOUND };
  }
  state.proteoscopeAt = Date.now();
  // The Structure view's button comes and goes with it.
  const found = state.proteoscope;
  if (`${found.found}|${found.url}|${found.version}` !== before) app.store?.notify?.(['structure']);
  return state.proteoscope;
}

export function notFoundWords(found) {
  if (found?.off) return 'MaveScape was started with --proteoscope off: it does not look for Proteoscope.';
  if (found?.reason) return found.reason;
  return `Proteoscope is not running on this computer (looked at ${found?.looked ?? NOT_FOUND.looked}): start it, then try again. It is a separate program (Proteoscope 0.10 was tested); MaveScape needs nothing from it.`;
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// The view shown as a Proteoscope session: { ok, doc, source, name, fetchable, words } or { ok:
// false, message }.
export async function sessionOfView(app) {
  const state = structureState(app);
  const viewer = state.viewer;
  const structure = viewer?.structure;
  if (!structure) return { ok: false, message: 'No structure is open.' };
  const code = structure.meta.code || structure.label;
  // The camera where it comes to rest, not on its way (a focus moves it for 450 ms).
  for (let i = 0; i < 40 && viewer.moving; i += 1) await new Promise((resolve) => setTimeout(resolve, 50));
  let source = fetchSource(state.origin);
  if (!source) {
    if (!state.file?.bytes) return { ok: false, message: `${code} is a file whose bytes are not at hand: open it again, then hand it to Proteoscope.` };
    const read = await readStructureBytes(state.file.bytes, state.file.name);
    source = await fileSource(read.name, read.text);
  }
  // The colors: the scores as residue data, categories as colors, or the structure's own scheme.
  const words = [];
  let data = null;
  let overrides = null;
  let color = null;
  const settings = scoresSettings(state);
  const colored = viewer.colorScheme === 'scores' ? state.colored : null;
  if (colored?.ok && colored.values && colored.values.kind !== 'qc') {
    const values = residueData(colored.values, state.maps);
    data = { label: colored.legend?.title ?? colored.values.label ?? 'Scores', values, domain: colored.values.domain };
    words.push(`${colored.legend?.title ?? 'the scores'} on ${plural(values.length, 'residue')} as its custom residue data`);
  } else if (colored?.ok) {
    overrides = [...colored.colors].map(([key, rgb]) => [key, colorToHex(rgb)]);
    words.push(`${colored.legend?.title ?? (settings.how === 'class' ? 'the structural classes' : 'the QC state')} as residue colors (${plural(overrides.length, 'residue')})`);
  } else {
    color = { scheme: viewer.colorScheme === 'scores' ? 'chain' : viewer.colorScheme };
    words.push(`colored by its ${color.scheme} scheme`);
  }
  const style = STYLES[viewer.style] ?? STYLES.cartoon;
  const residueStyles = [...viewer.styled];
  const hidden = viewer.hidden;
  const selection = [...viewer.selection];
  const labels = [...viewer.labels];
  const focus = viewer.focused;
  if (residueStyles.length) words.push(`${plural(residueStyles.length, 'residue')} drawn their own way`);
  if (hidden.length) words.push(`${plural(hidden.length, 'residue')} hidden`);
  if (selection.length) words.push(`${plural(selection.length, 'residue')} selected`);
  if (labels.length) words.push(`${labels.length} labeled`);
  if (focus.length) words.push(`${focus.length} focused on`);
  words.push('the camera');
  const assembly = structure.activeAssemblyId && structure.activeAssemblyId !== ASYMMETRIC_UNIT_ID ? structure.activeAssemblyId : null;
  if (assembly) words.unshift(`assembly ${assembly}`);
  const doc = sessionDocument({
    name: code, title: structure.meta.title ?? '', source, assembly,
    display: { polymer: style.polymer, ligand: style.ligand }, residueStyles, hidden,
    surface: viewer.surface.kind, color, data, overrides, uniformColor: STATE_COLORS.context,
    selection, labels, focus, camera: viewer.camera,
    software: { version: app.version }, created: now(),
  });
  return { ok: true, doc, source, name: code, fetchable: source.type === 'fetch', words: words.join(', ') };
}

// The session as a file: { name, bytes }.
export async function sessionFile(app) {
  const s = await sessionOfView(app);
  if (!s.ok) throw new Error(s.message);
  return { name: sessionFileName(s.name), bytes: new TextEncoder().encode(`${JSON.stringify(s.doc)}\n`), session: s };
}

// Hands the view to Proteoscope: { ok, how: 'session' | 'structure' | 'file', link, file, found,
// message }. open: open the link in a new tab (a click's), and save the file.
export async function handOff(app, { open = true } = {}) {
  const found = await findProteoscope(app, { again: true });
  if (!found.found) return { ok: false, found, message: notFoundWords(found) };
  const s = await sessionOfView(app);
  if (!s.ok) return { ok: false, found, message: s.message };
  const where = `Proteoscope ${found.version}`;
  if (s.fetchable && found.tested) {
    const link = sessionLink(found.url, await linkPayload(s.doc));
    const opened = open ? openLink(link) : null;
    const offline = found.offline ? ` Proteoscope was started offline: it opens ${s.name} only from its own cache.` : '';
    const message = `${opened === false ? 'The link to' : 'Opened'} ${s.name} in ${where}: ${s.words}${opened === false ? ' (the browser blocked the new tab: open the link from the message)' : ''}.${offline}`;
    app.log(message);
    return { ok: true, how: 'session', link, found, session: s.doc, message };
  }
  const file = { name: sessionFileName(s.name), bytes: new TextEncoder().encode(`${JSON.stringify(s.doc)}\n`) };
  if (open) downloadBlob(new Blob([file.bytes], { type: 'application/json' }), file.name);
  if (s.fetchable) {
    const link = fetchLink(found.url, s.source.id);
    if (open) openLink(link);
    const message = `Opened ${s.name} in ${where}, the structure alone: MaveScape was tested with Proteoscope 0.10, so the scores and the view went into a session file instead (${file.name}; open it in Proteoscope to try).`;
    app.log(message);
    return { ok: true, how: 'structure', link, file, found, session: s.doc, message };
  }
  const message = `${s.name} is a file of yours, which travels in a session file, not a link: open ${file.name} in ${where} (Open, or drop it on its window). It holds ${s.words}.`;
  app.log(message);
  return { ok: true, how: 'file', link: null, file, found, session: s.doc, message };
}

// Opens a link in a new tab; false when the browser blocked it.
function openLink(link) {
  const tab = window.open(link, '_blank');
  if (!tab) return false;
  try {
    tab.opener = null;
  } catch {
    // A tab of another origin: nothing to clear.
  }
  return true;
}
