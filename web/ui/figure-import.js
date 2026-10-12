// A figure MaveScape exported, dropped on the window (wave 6, slice 3; requirement R5): what it
// shows and where it came from (its manifest, lib/figure-manifest.js), whether the manifest is as
// it was written, and panel by panel what changed in this workspace since; then, on request, the
// figure rebuilt here from its inputs and each panel's drawing compared with the one recorded
// (ui/figure-data.js). A figure from another workspace can open that workspace when the library
// holds it.

import { h, icon } from './dom.js';
import { showDialog, toast } from './overlays.js';
import { readFigureFile, rebuildFigure, rebuildWords } from './figure-data.js';
import { PANEL_KEYWORD, pngTexts } from '../lib/structure-record.js';

const STATUS = { unchanged: ['ok', 'as then'], changed: ['warn', 'changed since'], missing: ['danger', 'not here'] };

function panelsTable(rows) {
  return h('table.data.compact', h('thead', h('tr', h('th', 'Panel'), h('th', 'Shows'), h('th', 'Here'))),
    h('tbody', ...rows.map((p) => h('tr',
      h('td', p.letter ?? '—'),
      h('td', p.shows),
      h('td', h(`span.badge.${STATUS[p.status][0]}`, STATUS[p.status][1]), p.changes.length ? h('div.muted', { style: { fontSize: '11.5px', marginTop: '2px' } }, p.changes.join('; ')) : null)))));
}

export function figureFileDialog(app, name, read) {
  const { manifest: m, comparison: c } = read;
  const from = `${m.workspace?.name ?? 'a workspace'}${c.sameWorkspace ? ' (this one)' : ''}`;
  const software = `MaveScape ${m.software?.version ?? '?'}${m.software?.commit ? ` (${String(m.software.commit).slice(0, 7)})` : ''}`;
  const content = h('div',
    h('p', { style: { marginTop: 0 } }, `${name}: the figure "${m.figure.name}", ${m.panels.length} panel${m.panels.length === 1 ? '' : 's'}, exported by ${software}${m.created ? ` on ${m.created.slice(0, 10)}` : ''} from the workspace "${from}".`),
    c.intact ? h('p.muted', { style: { fontSize: '12px' } }, `Its manifest is as it was written (fingerprint ${m.fingerprint.slice(0, 12)}…).`) : h('div.callout.danger', icon('warning'), h('span', c.problem)),
    panelsTable(c.panels),
    h('p.muted', { style: { fontSize: '11.5px' } }, 'Rebuild it here: the figure is added to this workspace and each panel drawn again from its inputs, then compared with the drawing the file records.'));
  const buttons = [{ label: 'Close', ghost: true }];
  if (!c.sameWorkspace) {
    buttons.unshift({
      label: `Open "${m.workspace?.name ?? 'its workspace'}"`,
      onClick: async () => {
        const list = await app.library.listWorkspaces?.().catch(() => []) ?? [];
        if (!list.some((w) => w.id === m.workspace?.id)) {
          toast(`The library does not hold the workspace "${m.workspace?.name}": open its archive (.msz), then the figure again.`, { kind: 'error' });
          return false;
        }
        await app.openWorkspace(m.workspace.id);
        return undefined;
      },
    });
  }
  buttons.push({
    label: 'Rebuild here',
    primary: true,
    onClick: async () => {
      const report = await rebuildFigure(app, m);
      const words = rebuildWords(report);
      for (const line of words) app.log(line);
      const same = report.drawings.filter((d) => d.same).length;
      toast(`Rebuilt "${report.figure.name}": ${same} of ${report.drawings.length} panels the same drawing.`, { kind: same === report.drawings.length ? 'ok' : 'error', timeout: 6000 });
      app.figuresView = { figure: report.figure.id, panel: null, report: words };
      await app.setMode('figures');
      return undefined;
    },
  });
  return showDialog({ title: 'A figure from MaveScape', content, buttons, width: 'medium' });
}

export async function openFigureFiles(app, items) {
  for (const item of items) {
    const bytes = await app.readBytes(item);
    const read = readFigureFile(app, bytes);
    if (read) {
      figureFileDialog(app, item.name, read);
      continue;
    }
    // A structure view's figure panel (wave 5) is not a figure, but says what it shows.
    let panel = null;
    try {
      panel = JSON.parse(pngTexts(bytes).get(PANEL_KEYWORD) ?? 'null');
    } catch {
      panel = null;
    }
    if (panel) {
      toast(`${item.name}: a figure panel of ${panel.structure?.name ?? 'a structure'} (its view, colors and legend recorded), not a figure. Add a saved view to a figure from the Structure view.`, { timeout: 7000 });
      continue;
    }
    throw new Error(`${item.name} carries no MaveScape figure manifest: it is not a figure MaveScape exported, or its metadata was removed.`);
  }
}
