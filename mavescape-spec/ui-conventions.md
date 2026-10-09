# MaveScape UI conventions (for building views)

Read `conventions.md` first. This document describes how the browser UI is put together so a new
view fits in. It follows CytoWeave's `ui-conventions.md`; the shell, store, overlays and CSS
classes are CytoWeave's. Study these files before writing a view:

- `web/app.js`: bootstrap, the `MODES` list (each view is lazily imported), shortcuts, file import
  (`app.importers`), autosave.
- `web/ui/mode-planned.js`: the placeholder each view replaces; `web/ui/mode-welcome.js`: a
  complete small view.
- `web/ui/sidebar.js` (the dataset tree), `web/ui/inspector.js`, `web/ui/drawer.js`.
- `web/ui/dom.js`, `web/ui/overlays.js`, `web/ui/icons.js`: helpers you must use.
- `web/styles.css`: the design system; reuse its classes, add new rules sparingly at the end of the
  file under a comment naming your view (light and dark both come from the CSS variables).

## The view contract

`web/ui/mode-<name>.js` exports `mount<Name>Mode(app, container)`, which appends its root element
to `container` and returns `{ update(topics), destroy() }`. To build a view, replace its
`plannedMode(...)` entry in `MODES` (app.js) with
`load: () => import('./ui/mode-<name>.js').then((m) => m.mount<Name>Mode)`. Views not yet in
`MODES` (Compare, Structure, Calibrate, Figures, Report) are added in the waves that build them.

`update` receives a `Set` of change topics after any state change; re-render only what they
affect:

| Topic | Meaning |
| --- | --- |
| `ws` | the workspace changed (any edit, undo, redo) |
| `history` | the undo history changed |
| `workspace-loaded` | another workspace was opened (views start afresh) |
| `focus` | the item in focus changed (`store.ui.focus = { kind, id }`) |
| `selection` | the selected variants changed (`store.ui.selection`) |
| `theme` | light/dark or the color-vision setting changed: redraw canvases |
| `drawer`, `mode`, `layout`, `library` | the drawer, the view, the side panels, the saved workspaces |

`destroy` must remove the root element and stop timers, observers and pending worker jobs.

Typical layout:

```js
const root = h('div.view',
  h('div.workbench-head', h('h1', icon('qc'), 'Quality control'), h('span.spacer'), ...actions),
  h('div.view-body', h('div.split', leftPanes, rightPanes)));
container.append(root);
```

Panes are `h('div.pane', h('h3', 'Title'), content)`. Use `.btn`, `.btn.primary`, `.btn.small`,
`.icon-button`, `.input`, `select.input`, `.field`, `.check`, `.segmented`,
`.badge(.ok|.warn|.danger|.accent)`, `.callout(.warn|.danger|.ok|.accent)`, `table.data`, `.kv`,
`.stat-grid/.stat-tile`, `.empty`, `.section-title`, `.welcome-grid` + `.card`, `.progress`,
`.sr-only`.

## The app object

- `app.store`: `store.ws` (the immutable workspace, `web/lib/workspace.js`), `store.ui`,
  `store.commit(nextWs, label, topics)` records an undoable edit (its label is what the drawer's
  History and the undo button show); `store.replace(nextWs)` changes without undo;
  `store.setUI(patch, topics)`; `store.notify(topics)`; `store.subscribe`; `store.sameWorkspace()`
  for work that may finish after another workspace was opened.
- `app.focusItem({ kind, id })`: puts an item in focus (the dataset tree and the inspector follow).
- `app.importers.set(kind, async (item) => …)`: reads opened files of a kind (`fileKind` in
  app.js, the same table as `local.go`). `item` is `{ file, name, folder, order }`;
  `await app.readBytes(item)` gives its bytes.
- `app.inspector.setSection(id, (app) => Node)`: adds a section to the inspector (`null` removes
  it). `app.drawer.addTab(id, { label, render(app) })`: adds a drawer tab. `app.log(message)`:
  the session log.
- Workers: `app.worker('<name>')` returns a client for `web/workers/<name>-worker.js`;
  `client.run(type, payload, { transfer, onProgress })` → `{ promise, cancel }`. Wrap long jobs
  in `progressToast(message, onCancel)` from overlays.js.
- `app.library`: the workspace library (`listWorkspaces`, `loadWorkspace`, `saveWorkspace`,
  `putFile`, `getFile`, `addFile`, `listRecords`, `putRecord`, …); `app.info` is the program's
  `/api/info`, or `null` on a static web server.
- Navigation: `app.setMode(id)`. Overlays: `showMenu`, `showDialog`, `confirmDialog`,
  `promptDialog`, `toast`.

## Principles

- Analysis runs in workers; the page stays responsive. Show progress and allow canceling.
- Nothing is destructive or silent: suggestions (sample roles, thresholds) are shown as
  suggestions until accepted. Explain each result in plain language next to it.
- Analysis-changing actions (`store.commit`) look different from view-only actions (zoom,
  palette, which are `setUI`).
- Missing, filtered, low-confidence and not-designed measurements are never drawn in the neutral
  color (`conventions.md`, Terminology).
- Every chart has a tabular alternative and a text description; every control works from the
  keyboard.
- Empty states teach: say what the view does and what to do first.
- Keep text plain and specific; no marketing language; never "pathogenic" or "benign".
