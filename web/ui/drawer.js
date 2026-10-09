// The bottom drawer, under the view: the history of the analysis, the session's log, and (as views
// are built) tables and evidence too long for the inspector. ⌘J or the status bar opens it.

import { h, clear, iconButton } from './dom.js';
import { prefs } from './storage.js';
import { verifyHistory } from '../lib/workspace.js';

export function mountDrawer(app) {
  const root = document.getElementById('drawer');
  // Tabs views add: id → { label, render(app) → Node }.
  const tabs = new Map([
    ['history', { label: 'History', render: renderHistory }],
    ['log', { label: 'Log', render: renderLog }],
  ]);
  const log = [];
  let height = prefs.get('drawerHeight', 240);

  // The workspace's hash-chained history (workspace.js), newest first, with the chain checked.
  function renderHistory() {
    const { ws, state } = app.store;
    const history = ws.history ?? [];
    const check = verifyHistory(ws);
    const undone = state.labels.future.length;
    const status = check.ok
      ? h('p.muted', { style: { margin: '4px 0 6px', fontSize: '12px' } }, `${history.length} change${history.length === 1 ? '' : 's'}, each chained to the one before (SHA-256; the latest ${check.head ? `${check.head.slice(0, 12)}…` : '—'}): a change altered or removed later breaks the chain.${undone ? ` ${undone} undone change${undone > 1 ? 's' : ''} can be redone (⇧⌘Z).` : ''}`)
      : h('div.callout.danger', { style: { margin: '4px 0 6px' } }, `The history's chain is broken at entry ${check.broken[0].index + 1}: ${check.broken[0].reason}.`);
    if (!history.length) return h('p.muted', 'Changes to the analysis are listed here as you make them.');
    return h('div', status, h('ol.history-list', ...history.slice().reverse().map((entry) => h('li',
      h('time', { title: entry.time }, new Date(entry.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })),
      h('span', entry.detail || entry.action)))));
  }

  function renderLog() {
    if (!log.length) return h('p.muted', 'Messages of this session (imports, warnings, errors) are kept here.');
    return h('ol.history-list', ...log.slice().reverse().map((entry) => h('li', h('time', entry.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })), h('span', entry.message))));
  }

  function render() {
    const { drawer } = app.store.ui;
    root.hidden = !drawer.open;
    document.documentElement.style.setProperty('--drawer', `${height}px`);
    clear(root);
    if (!drawer.open) return;
    const active = tabs.has(drawer.tab) ? drawer.tab : 'history';
    const resize = h('div.drawer-resize', { role: 'separator', 'aria-orientation': 'horizontal', 'aria-label': 'Resize the drawer' });
    resize.addEventListener('pointerdown', (event) => {
      const startY = event.clientY;
      const startHeight = height;
      resize.setPointerCapture(event.pointerId);
      const move = (e) => {
        height = Math.max(120, Math.min(window.innerHeight * 0.7, startHeight + startY - e.clientY));
        document.documentElement.style.setProperty('--drawer', `${height}px`);
      };
      const up = () => {
        resize.removeEventListener('pointermove', move);
        prefs.set('drawerHeight', Math.round(height));
      };
      resize.addEventListener('pointermove', move);
      resize.addEventListener('pointerup', up, { once: true });
    });
    const head = h('div.drawer-head', { role: 'tablist', 'aria-label': 'Drawer' },
      ...[...tabs].map(([id, tab]) => h(`button.drawer-tab${id === active ? '.active' : ''}`, {
        type: 'button', role: 'tab', 'aria-selected': id === active ? 'true' : 'false',
        onclick: () => app.store.setUI({ drawer: { open: true, tab: id } }, ['drawer']),
      }, tab.label)),
      h('span.spacer'),
      iconButton('close', 'Close the drawer (⌘J)', () => app.toggleDrawer(false), { class: 'small' }));
    root.append(resize, head, h('div.drawer-body', { role: 'tabpanel' }, tabs.get(active).render(app)));
  }

  return {
    render,
    // Adds a message to the session log.
    log(message) {
      log.push({ time: new Date(), message });
      if (log.length > 500) log.shift();
      if (app.store.ui.drawer.open && app.store.ui.drawer.tab === 'log') render();
    },
    addTab(id, tab) {
      tabs.set(id, tab);
      render();
    },
    update(topics) {
      if (topics.has('drawer') || topics.has('history') || topics.has('ws') || topics.has('workspace-loaded')) render();
    },
  };
}
