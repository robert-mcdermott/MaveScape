// MaveScape: application bootstrap, views, shortcuts, file import and autosave. The shell follows
// CytoWeave 0.8.0's web/app.js (mavescape-spec/design.md, "What is copied").

import { h, icon, clear, debounce, isTyping, downloadBlob, modKey } from './ui/dom.js';
import { showMenu, showDialog, promptDialog, confirmDialog, toast, closeMenu } from './ui/overlays.js';
import { createStore } from './ui/store.js';
import { createLibrary, detectBackend, prefs } from './ui/storage.js';
import { mountSidebar } from './ui/sidebar.js';
import { mountInspector } from './ui/inspector.js';
import { mountDrawer } from './ui/drawer.js';
import { openPalette } from './ui/palette.js';
import { WorkerClient } from './ui/workers.js';
import { colorVisionFriendly, setColorVisionFriendly } from './lib/colormaps.js';
import { createWorkspace, isEmptyWorkspace, parseWorkspace, rename, serializeWorkspace } from './lib/workspace.js';
import { installImport } from './ui/import.js';
import { chooseArchiveExport, openArchives } from './ui/record.js';
import { exampleGuide } from './ui/examples.js';
import { mountWorkflow } from './ui/workflow.js';

const VERSION = '0.1.0';

// The views, in the PRD's order. Each loads its module when first shown. Views still to be built
// show what they are for (mode-planned.js); Compare, Structure, Calibrate, Figures and Report join
// the list in the waves that build them (roadmap.md).
const MODES = [
  { id: 'welcome', label: 'Start', icon: 'grid', hidden: true, load: () => import('./ui/mode-welcome.js').then((m) => m.mountWelcome) },
  { id: 'experiment', label: 'Experiment', icon: 'experiment', load: () => import('./ui/mode-experiment.js').then((m) => m.mountExperimentMode) },
  { id: 'qc', label: 'QC', icon: 'qc', load: () => import('./ui/mode-qc.js').then((m) => m.mountQcMode) },
  { id: 'score', label: 'Score', icon: 'score', load: () => import('./ui/mode-score.js').then((m) => m.mountScoreMode) },
  'sep',
  { id: 'map', label: 'Map', icon: 'heatmap', load: () => import('./ui/mode-map.js').then((m) => m.mountMapMode) },
];

// --- Theme ---------------------------------------------------------------------------------------

function applyTheme(preference) {
  const dark = preference === 'dark' || (preference === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

// Color-vision-friendly colors (a setting): the palettes (colormaps.js) and status colors.
function applyColorVision(on) {
  setColorVisionFriendly(on);
  if (on) document.documentElement.dataset.cvd = '';
  else delete document.documentElement.dataset.cvd;
}

// The kind of an opened file, by name: the same table as the program's (local.go, fileKind).
export function fileKind(name) {
  const lower = name.toLowerCase();
  const has = (...suffixes) => suffixes.some((s) => lower.endsWith(s));
  if (has('.msz')) return 'workspace';
  if (has('.design.json')) return 'design';
  if (has('.import.json')) return 'template';
  if (has('.csv', '.tsv', '.tab', '.txt', '.csv.gz', '.tsv.gz', '.xlsx')) return 'table';
  if (has('.fasta', '.fa', '.fna', '.faa', '.fas', '.seq')) return 'sequence';
  if (has('.gb', '.gbk', '.genbank')) return 'genbank';
  if (has('.a3m', '.aln', '.sto', '.stockholm')) return 'alignment';
  if (has('.gff', '.gff3')) return 'annotation';
  if (has('.pdb', '.ent', '.cif', '.mmcif', '.bcif')) return 'structure';
  if (has('.zip')) return 'archive';
  if (has('.json')) return 'json';
  return '';
}

const KIND_NAMES = {
  workspace: 'workspace archives (.msz)', design: 'designs', template: 'import templates', table: 'tables', sequence: 'sequences',
  genbank: 'GenBank files', alignment: 'alignments', annotation: 'annotations', structure: 'structures', archive: 'archives', json: 'JSON files',
};

async function start() {
  const themePref = prefs.get('theme', 'system');
  applyTheme(themePref);
  applyColorVision(prefs.get('colorVision', false));
  const info = await detectBackend();
  const library = createLibrary(info);

  // MaveScape starts on the start page with a new, empty workspace: the last one is a click away
  // in its recent workspaces, and files named on the command line go into a workspace of their
  // own rather than the last one.
  const store = createStore(createWorkspace());
  store.state.ui.theme = themePref;
  store.state.ui.drawer = { open: prefs.get('drawerOpen', false), tab: prefs.get('drawerTab', 'history') };
  const app = { store, library, info, version: VERSION, commit: info?.commit ?? '' };
  app.workers = {};
  app.worker = (name) => {
    app.workers[name] ??= new WorkerClient(`../workers/${name}-worker.js`, { max: 1 });
    return app.workers[name];
  };
  // Readers of opened files by kind, registered by the slices that build them: kind → async
  // (items), with all the files of that kind opened together (per-sample tables are joined).
  app.importers = new Map();

  app.sidebar = mountSidebar(app);
  app.inspector = mountInspector(app);
  app.drawer = mountDrawer(app);
  app.log = (message) => app.drawer.log(message);
  installImport(app);
  app.importers.set('workspace', (items) => openArchives(app, items));
  app.inspector.setSection('example', exampleGuide);

  // --- Views -------------------------------------------------------------------------------------

  // The workflow strip (ui/workflow.js) stays above the views; each view mounts into the host.
  const workflowEl = h('nav.workflow', { 'aria-label': 'Analysis steps' });
  const workbench = h('div.view-host');
  document.getElementById('workbench').append(workflowEl, workbench);
  const switcher = document.getElementById('mode-switcher');
  let current = null;
  let currentId = null;
  let mounting = 0;

  function renderSwitcher() {
    clear(switcher);
    for (const mode of MODES) {
      if (mode === 'sep') {
        switcher.append(h('span.mode-sep'));
        continue;
      }
      if (mode.hidden) continue;
      const active = store.ui.mode === mode.id;
      switcher.append(h(`button.mode-tab${active ? '.active' : ''}`, { type: 'button', role: 'tab', 'aria-selected': active ? 'true' : 'false', title: mode.label, onclick: () => app.setMode(mode.id) }, icon(mode.icon), h('span', mode.label)));
    }
  }

  app.setMode = async (id) => {
    if (id === currentId && current) return;
    const mode = MODES.find((m) => m !== 'sep' && m.id === id) ?? MODES[0];
    const token = ++mounting;
    store.setUI({ mode: mode.id }, ['mode']);
    document.getElementById('app').dataset.mode = mode.id;
    renderSwitcher();
    current?.destroy();
    current = null;
    currentId = mode.id;
    clear(workbench);
    let mount;
    try {
      mount = await mode.load();
    } catch (error) {
      if (token !== mounting) return;
      workbench.append(h('div.workbench-scroll', h('div.empty', icon(mode.icon), h('h3', `${mode.label} is not available in this build`), h('p', error.message))));
      return;
    }
    if (token !== mounting) return;
    current = mount(app, workbench);
    current.update?.(new Set(['ws', 'focus', 'selection', 'mode']));
  };

  app.focusItem = (focus) => store.setUI({ focus }, ['focus']);

  app.toggleDrawer = (open = !store.ui.drawer.open, tab = store.ui.drawer.tab) => {
    store.setUI({ drawer: { open, tab } }, ['drawer']);
    prefs.set('drawerOpen', open);
    prefs.set('drawerTab', tab);
  };

  // --- Files -------------------------------------------------------------------------------------

  const fileInput = document.getElementById('file-input');
  const folderInput = document.getElementById('folder-input');
  app.pickFiles = (accept) => {
    fileInput.accept = accept ?? '';
    fileInput.value = '';
    fileInput.click();
  };
  app.pickFolder = () => {
    folderInput.value = '';
    folderInput.click();
  };
  fileInput.addEventListener('change', () => app.importFiles([...fileInput.files]));
  folderInput.addEventListener('change', () => app.importFiles([...folderInput.files]));

  // Opens dropped or picked files by kind. Entries: File objects or { name, bytes, folder }.
  app.importFiles = async (files) => {
    const items = files.map((file, order) => ({ file, name: file.name, folder: file.webkitRelativePath ? file.webkitRelativePath.split('/').slice(-2, -1)[0] : file.folder ?? null, order }));
    const unread = new Map();
    const unknown = [];
    const byKind = new Map();
    for (const item of items) {
      const kind = fileKind(item.name);
      if (!kind) {
        unknown.push(item.name);
        continue;
      }
      if (!app.importers.has(kind)) {
        unread.set(kind, (unread.get(kind) ?? 0) + 1);
        continue;
      }
      if (!byKind.has(kind)) byKind.set(kind, []);
      byKind.get(kind).push(item);
    }
    // Sequences first, so a table opened with its target's FASTA finds the target.
    for (const kind of [...byKind.keys()].sort((a, b) => (a === 'sequence' ? -1 : b === 'sequence' ? 1 : 0))) {
      try {
        await app.importers.get(kind)(byKind.get(kind));
      } catch (error) {
        toast(error.message, { kind: 'error' });
        app.log(error.message);
      }
    }
    const messages = [];
    if (unread.size) messages.push(`This build of MaveScape cannot read ${[...unread.keys()].map((k) => KIND_NAMES[k] ?? k).join(', ')} yet.`);
    if (unknown.length) messages.push(`${unknown.length === 1 ? unknown[0] : `${unknown.length} files`}: MaveScape opens count and score tables (.csv, .tsv, .xlsx), sequences (.fasta, .gb), structures (.pdb, .cif) and workspaces (.msz).`);
    for (const message of messages) {
      toast(message, { kind: 'error' });
      app.log(message);
    }
  };

  app.readBytes = async (item) => {
    if (item.bytes) return item.bytes;
    return new Uint8Array(await item.file.arrayBuffer());
  };

  // --- Workspaces --------------------------------------------------------------------------------

  async function loadWorkspace(doc) {
    store.reset(doc);
    prefs.set('lastWorkspace', doc.id);
    store.setUI({ focus: null, selection: null }, ['focus', 'selection']);
    app.setMode(isEmptyWorkspace(doc) ? 'welcome' : 'experiment');
    updateTitle();
  }
  app.loadWorkspace = loadWorkspace;

  app.openWorkspace = async (id) => {
    try {
      await saveNow();
      await loadWorkspace(parseWorkspace(await library.loadWorkspace(id)));
    } catch (error) {
      toast(error.message, { kind: 'error' });
    }
  };

  const saveState = document.getElementById('save-state');
  // The save under way, if any. A save asked for meanwhile (opening another workspace) waits for
  // it, then saves what changed since: returning at once would lose those edits.
  let saving = null;
  async function writeWorkspace(ws) {
    saveState.className = 'save-state saving';
    saveState.setAttribute('aria-label', 'Saving');
    try {
      await library.saveWorkspace(ws.id, serializeWorkspace(ws));
      prefs.set('lastWorkspace', ws.id);
      // Another workspace may have been opened while this one was written.
      if (store.ws.id === ws.id) store.markSaved(ws);
      saveState.className = 'save-state';
      saveState.title = `Saved to ${library.kind === 'desktop' ? library.location : 'this browser'}`;
      saveState.setAttribute('aria-label', 'Saved');
    } catch (error) {
      saveState.className = 'save-state error';
      saveState.title = `Not saved: ${error.message}`;
      saveState.setAttribute('aria-label', 'Not saved');
    }
  }
  async function saveNow() {
    while (saving) await saving;
    const ws = store.ws;
    if (!store.isDirty() || isEmptyWorkspace(ws)) return;
    saving = writeWorkspace(ws);
    try {
      await saving;
    } finally {
      saving = null;
    }
    if (store.isDirty()) autosave();
  }
  app.saveNow = saveNow;
  const autosave = debounce(saveNow, 1200);

  app.newWorkspace = async () => {
    await saveNow();
    await loadWorkspace(createWorkspace());
  };

  async function openLibraryDialog() {
    let list = [];
    try {
      list = await library.listWorkspaces();
    } catch (error) {
      toast(error.message, { kind: 'error' });
      return;
    }
    const body = h('tbody');
    const dialog = showDialog({
      title: 'Open a workspace',
      width: 'wide',
      content: [h('p', `Workspaces in ${library.kind === 'desktop' ? library.location : 'this browser'}.`), h('div', { style: { maxHeight: '60vh', overflow: 'auto' } }, h('table.data', h('thead', h('tr', h('th', 'Name'), h('th.r', 'Tables'), h('th', 'Modified'), h('th', h('span.sr-only', 'Delete')))), body))],
    });
    for (const item of list) {
      body.append(h(`tr${item.id === store.ws.id ? '.selected' : ''}`, { style: { cursor: 'pointer' }, onclick: () => { dialog.close(); app.openWorkspace(item.id); } },
        h('td', item.name || 'Untitled'), h('td.r', String(item.sources ?? '')), h('td', new Date(item.modified).toLocaleString()),
        h('td.r', h('button.icon-button.small', {
          type: 'button',
          title: 'Delete',
          'aria-label': `Delete ${item.name || 'Untitled'}`,
          onclick: async (event) => {
            event.stopPropagation();
            if (!(await confirmDialog({ title: 'Delete workspace?', message: `Delete "${item.name}"? ${library.kind === 'desktop' ? 'It is moved to the library\'s trash folder.' : 'This cannot be undone.'}`, confirm: 'Delete', danger: true }))) return;
            await library.deleteWorkspace(item.id);
            event.target.closest('tr').remove();
            store.notify(['library']);
          },
        }, icon('trash')))));
    }
    if (!list.length) body.append(h('tr', h('td', { colSpan: 4 }, h('span.muted', 'No saved workspaces yet.'))));
  }
  app.openLibrary = openLibraryDialog;

  // The workspace document as JSON (the .msz archive with its tables arrives with the record,
  // roadmap wave 1, slice 8).
  function exportWorkspaceJSON() {
    downloadBlob(new Blob([serializeWorkspace(store.ws)], { type: 'application/json' }), `${store.ws.name.replace(/[^\w.-]+/g, '_') || 'workspace'}.mavescape.json`);
  }

  document.getElementById('workspace-menu').addEventListener('click', (event) => {
    showMenu(event.currentTarget, [
      { label: 'New workspace', icon: 'plus', onSelect: () => app.newWorkspace() },
      { label: 'Open…', icon: 'library', hint: `${modKey}⇧O`, onSelect: openLibraryDialog },
      { label: 'Rename…', icon: 'edit', onSelect: async () => {
        const name = await promptDialog({ title: 'Rename workspace', label: 'Name', value: store.ws.name });
        if (name) store.commit(rename(store.ws, name), 'Rename workspace');
      } },
      { label: 'Save now', icon: 'save', hint: `${modKey}S`, onSelect: async () => { await saveNow(); toast('Saved.', { kind: 'ok' }); } },
      '-',
      { section: 'Import' },
      { label: 'Files…', icon: 'table', hint: `${modKey}O`, onSelect: () => app.pickFiles() },
      { label: 'A folder…', icon: 'folder', onSelect: () => app.pickFolder() },
      '-',
      { section: 'Export' },
      { label: 'Workspace archive (.msz)…', icon: 'download', onSelect: () => chooseArchiveExport(app) },
      { label: 'Workspace document (JSON)', icon: 'download', onSelect: exportWorkspaceJSON },
      '-',
      { label: 'Start page', icon: 'grid', onSelect: () => app.setMode('welcome') },
    ]);
  });

  // --- Commands (palette) ------------------------------------------------------------------------

  app.commands = () => [
    ...MODES.filter((m) => m !== 'sep').map((m) => ({ label: `Go to ${m.label}`, icon: m.icon, run: () => app.setMode(m.id), keywords: m.id })),
    { label: 'Open files', icon: 'table', hint: `${modKey}O`, run: () => app.pickFiles(), keywords: 'import counts scores csv tsv fasta' },
    { label: 'Open a folder', icon: 'folder', run: () => app.pickFolder() },
    { label: 'New workspace', icon: 'plus', run: () => app.newWorkspace() },
    { label: 'Open a saved workspace', icon: 'library', hint: `${modKey}⇧O`, run: openLibraryDialog },
    { label: 'Save workspace now', icon: 'save', hint: `${modKey}S`, run: saveNow },
    { label: 'Export the workspace archive (.msz)', icon: 'download', run: () => chooseArchiveExport(app), keywords: 'save zip record share' },
    { label: 'Export the workspace document', icon: 'download', run: exportWorkspaceJSON },
    { label: 'Show or hide the drawer (history, log)', icon: 'drawer', hint: `${modKey}J`, run: () => app.toggleDrawer(), keywords: 'history log undo' },
    { label: 'Toggle dark theme', icon: 'moon', run: () => toggleTheme() },
    { label: 'Color-vision-friendly colors (on or off)', icon: 'eye', run: () => toggleColorVision(), keywords: 'color blind accessibility deuteranopia protanopia palette' },
    { label: 'Keyboard shortcuts', icon: 'keyboard', hint: '?', run: showHelp },
  ];

  // --- Top bar -----------------------------------------------------------------------------------

  const undoButton = document.getElementById('undo-button');
  const redoButton = document.getElementById('redo-button');
  const themeButton = document.getElementById('theme-button');
  undoButton.append(icon('undo'));
  redoButton.append(icon('redo'));
  document.getElementById('help-button').append(icon('help'));
  document.getElementById('help-button').addEventListener('click', showHelp);
  document.getElementById('command-button').addEventListener('click', () => openPalette(app));
  undoButton.addEventListener('click', () => doUndo());
  redoButton.addEventListener('click', () => doRedo());
  themeButton.addEventListener('click', () => showMenu(themeButton, [
    { section: 'Appearance' },
    ...[['light', 'Light', 'sun'], ['dark', 'Dark', 'moon'], ['system', 'Match the system', 'settings']].map(([id, label, glyph]) => ({ label, icon: glyph, checked: prefs.get('theme', 'system') === id, onSelect: () => setTheme(id) })),
    '-',
    { label: 'Color-vision-friendly colors', icon: 'eye', checked: colorVisionFriendly(), onSelect: () => toggleColorVision() },
  ]));

  function doUndo() {
    const label = store.undo();
    if (label) toast(`Undid: ${label}`, { timeout: 1800 });
  }
  function doRedo() {
    const label = store.redo();
    if (label) toast(`Redid: ${label}`, { timeout: 1800 });
  }

  function toggleTheme() {
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  }
  function toggleColorVision() {
    const next = !colorVisionFriendly();
    prefs.set('colorVision', next);
    applyColorVision(next);
    store.notify(['theme', 'colors']);
    toast(next ? 'Color-vision-friendly colors: maps, categories and status colors stay distinguishable with red–green and blue–yellow color blindness.' : 'Default colors.', { timeout: 3500 });
  }
  function setTheme(next) {
    prefs.set('theme', next);
    store.state.ui.theme = next;
    applyTheme(next);
    renderTheme();
    store.notify(['theme']);
  }
  function renderTheme() {
    clear(themeButton).append(icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon'));
  }
  renderTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (prefs.get('theme', 'system') === 'system') {
      applyTheme('system');
      renderTheme();
      store.notify(['theme']);
    }
  });

  function updateTitle() {
    document.getElementById('workspace-name').textContent = store.ws.name;
    document.title = `${store.ws.name} · MaveScape`;
    undoButton.disabled = !store.canUndo();
    redoButton.disabled = !store.canRedo();
    undoButton.title = store.canUndo() ? `Undo ${store.undoLabel()} (${modKey}Z)` : 'Nothing to undo';
    redoButton.title = store.canRedo() ? `Redo ${store.redoLabel()} (⇧${modKey}Z)` : 'Nothing to redo';
    if (!saveState.classList.contains('error') && !saveState.classList.contains('saving')) {
      saveState.className = `save-state${store.isDirty() && !isEmptyWorkspace(store.ws) ? ' dirty' : ''}`;
      saveState.setAttribute('aria-label', store.isDirty() && !isEmptyWorkspace(store.ws) ? 'Unsaved changes' : 'Saved');
    }
  }

  // --- Status bar --------------------------------------------------------------------------------

  const statusbar = document.getElementById('statusbar');
  function renderStatus() {
    clear(statusbar);
    const busy = [...store.state.busy.values()];
    const version = `MaveScape ${VERSION}${app.commit ? ` (${app.commit.slice(0, 7)})` : ''}${info ? '' : ' · web'}`;
    statusbar.append(
      h('span.item', h(`span.dot${busy.length ? '.busy' : ''}`), busy.length ? busy[0] : 'Ready'),
      h('span.item', icon('library'), library.kind === 'desktop' ? `Library: ${library.location}` : 'Library: this browser'),
      h('span.item', `${store.ws.sources.length} table${store.ws.sources.length === 1 ? '' : 's'} · ${store.ws.runs.length} score run${store.ws.runs.length === 1 ? '' : 's'}`),
      h('button.item.statusbar-link', { type: 'button', title: `History and log (${modKey}J)`, onclick: () => app.toggleDrawer() }, icon('drawer'), store.ui.drawer.open ? 'Hide the drawer' : 'History and log'),
      h('span.spacer'),
      h('span.item', version),
      h('span.item.muted', 'Research use only'));
  }

  function showHelp() {
    const rows = [
      ['Search and commands', `${modKey}K`],
      ['Undo / redo', `${modKey}Z / ⇧${modKey}Z`],
      ['Open files', `${modKey}O`],
      ['Open a saved workspace', `⇧${modKey}O`],
      ['Save now', `${modKey}S`],
      ['Go to a view', `${modKey}1 … ${modKey}9`],
      ['Toggle sidebar / inspector', `${modKey}\\ / ${modKey}⇧\\`],
      ['Drawer (history, log)', `${modKey}J`],
      ['Close a menu or dialog', 'Esc'],
    ];
    showDialog({
      title: 'Keyboard shortcuts',
      content: h('table.data', h('tbody', ...rows.map(([action, keys]) => h('tr', h('td', action), h('td.r', h('kbd', keys)))))),
    });
  }

  // --- Keyboard ----------------------------------------------------------------------------------

  document.addEventListener('keydown', (event) => {
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (mod && key === 'k') {
      event.preventDefault();
      openPalette(app);
      return;
    }
    if (isTyping(event)) return;
    if (mod && key === 'z') {
      event.preventDefault();
      if (event.shiftKey) doRedo();
      else doUndo();
      return;
    }
    if (mod && key === 'y') {
      event.preventDefault();
      doRedo();
      return;
    }
    if (mod && key === 's') {
      event.preventDefault();
      saveNow().then(() => toast('Saved.', { kind: 'ok', timeout: 1500 }));
      return;
    }
    if (mod && key === 'o') {
      event.preventDefault();
      if (event.shiftKey) openLibraryDialog();
      else app.pickFiles();
      return;
    }
    if (mod && key === 'j') {
      event.preventDefault();
      app.toggleDrawer();
      return;
    }
    if (mod && event.key === '\\') {
      event.preventDefault();
      document.getElementById('app').classList.toggle(event.shiftKey ? 'inspector-closed' : 'sidebar-closed');
      store.notify(['layout']);
      return;
    }
    if (mod && /^[1-9]$/.test(event.key)) {
      const modes = MODES.filter((m) => m !== 'sep' && !m.hidden);
      const mode = modes[Number(event.key) - 1];
      if (mode) {
        event.preventDefault();
        app.setMode(mode.id);
      }
      return;
    }
    if (mod || event.altKey) return;
    if (event.key === '?') {
      showHelp();
      return;
    }
    if (event.key === 'Escape') closeMenu();
  });

  // --- Drag and drop -----------------------------------------------------------------------------

  const dropOverlay = document.getElementById('drop-overlay');
  let dragDepth = 0;
  const hasFiles = (event) => [...(event.dataTransfer?.types ?? [])].includes('Files');
  window.addEventListener('dragenter', (event) => {
    if (!hasFiles(event)) return;
    dragDepth += 1;
    dropOverlay.hidden = false;
  });
  window.addEventListener('dragleave', (event) => {
    if (!hasFiles(event)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) dropOverlay.hidden = true;
  });
  window.addEventListener('dragover', (event) => {
    if (hasFiles(event)) event.preventDefault();
  });
  window.addEventListener('drop', async (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth = 0;
    dropOverlay.hidden = true;
    app.importFiles(await collectDropped(event.dataTransfer));
  });

  // Walks dropped folders (Chromium and Safari support webkitGetAsEntry).
  async function collectDropped(transfer) {
    const entries = [...transfer.items].map((item) => item.webkitGetAsEntry?.()).filter(Boolean);
    if (!entries.length) return [...transfer.files];
    const out = [];
    const walk = async (entry, folder) => {
      if (entry.isFile) {
        const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
        if (folder) Object.defineProperty(file, 'folder', { value: folder });
        out.push(file);
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        let batch;
        do {
          batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
          for (const child of batch) if (!child.name.startsWith('.')) await walk(child, entry.name);
        } while (batch.length);
      }
    };
    for (const entry of entries) await walk(entry, null);
    return out;
  }

  // --- Store subscription ------------------------------------------------------------------------

  app.workflow = mountWorkflow(app, workflowEl);
  store.subscribe((topics) => {
    if (topics.has('ws') || topics.has('history') || topics.has('saved')) updateTitle();
    app.workflow.update(topics);
    if (topics.has('ws')) autosave();
    app.sidebar.update(topics);
    app.inspector.update(topics);
    app.drawer.update(topics);
    current?.update?.(topics);
    renderStatus();
  });

  window.addEventListener('beforeunload', (event) => {
    if (store.isDirty() && !isEmptyWorkspace(store.ws)) {
      saveNow();
      event.preventDefault();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveNow();
  });

  // --- Start -------------------------------------------------------------------------------------

  renderSwitcher();
  updateTitle();
  renderStatus();
  app.sidebar.render();
  app.inspector.render();
  app.drawer.render();
  await app.setMode('welcome');

  // Files named on the command line of the desktop program (or by a later launch), opened once
  // per program run.
  app.openStartupFiles = async (files) => {
    const opened = new Set(prefs.get(`opened:${info.session}`, []));
    const pending = files.filter((file) => !opened.has(file.url));
    for (const file of files) opened.add(file.url);
    prefs.set(`opened:${info.session}`, [...opened]);
    if (!pending.length) return;
    const items = [];
    for (const file of pending) {
      const response = await fetch(file.url);
      if (!response.ok) continue;
      items.push(Object.assign(new File([await response.arrayBuffer()], file.name), { folder: file.folder ?? null }));
    }
    await app.importFiles(items);
  };
  if (info?.files?.length) await app.openStartupFiles(info.files);
  // A second "mavescape <files>" launch hands its files to this window.
  if (info) {
    // The second launch also brings this window forward, so checking on focus is enough.
    let checking = false;
    const check = async () => {
      if (checking || document.visibilityState !== 'visible') return;
      checking = true;
      const fresh = await detectBackend();
      if (fresh?.files?.length) await app.openStartupFiles(fresh.files);
      checking = false;
    };
    window.addEventListener('focus', check);
    setInterval(check, 30000);
  }
  window.mavescape = app;
}

start().catch((error) => {
  console.error(error);
  document.getElementById('workbench').append(h('div.empty', h('h3', 'MaveScape could not start'), h('p', error.message)));
});
