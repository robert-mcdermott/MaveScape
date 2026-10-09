// The variant-effect map component (requirements V2, V3, T6): the renderer of lib/map-render.js on
// a canvas, with the overview strip, pan (drag, or the wheel sideways), zoom (⌘ or Ctrl and the
// wheel, a pinch, + and −), hover, click to select (⌘ or Ctrl to add), Shift-drag to select a
// rectangle, and the keyboard: arrows move a focus cell, Enter or Space selects it, Escape clears
// the selection, Home and End jump to the ends, Page Up and Page Down move a screen. Each focused
// cell is announced in words.

import { h } from './dom.js';
import { cellAt } from '../lib/map-model.js';
import { drawMap, geometry, hitTest, mapPalette } from '../lib/map-render.js';
import { cssVar } from './plots.js';

const MIN_CELL = 2;
const MAX_CELL = 40;

export function themeFromPage() {
  return {
    background: cssVar('--panel'), empty: cssVar('--map-empty'), hatch: cssVar('--map-hatch'), dot: cssVar('--map-hatch'), mark: cssVar('--text'),
    text: cssVar('--text'), muted: cssVar('--text-3'), line: cssVar('--line-strong'), accent: cssVar('--accent'),
    gray: cssVar('--map-low').split(',').map(Number),
  };
}

// options: { model, palette, selected (Set of cell indices), describe(cell) → text,
// onHover(cell | null), onSelect(cells: Set, primary cell), cellH }.
export function mountVariantMap(options) {
  let model = options.model;
  let palette = options.palette ?? 'rdbu';
  let selected = new Set(options.selected ?? []);
  const cellH = options.cellH ?? 14;
  const canvas = h('canvas.variant-map-canvas');
  const tip = h('div.map-tip', { hidden: true });
  const live = h('div.sr-only', { 'aria-live': 'polite' });
  const band = h('div.map-band', { hidden: true });
  const el = h('div.variant-map', { tabindex: 0, role: 'application', 'aria-label': 'Variant-effect map. Arrow keys move between cells, Enter selects, plus and minus zoom.', 'aria-roledescription': 'map' }, canvas, band, tip, live);
  const view = { width: 800, cellW: 10, cellH, x0: 1, hover: -1, focus: -1, selected: new Set() };
  let fitted = false;
  let frame = 0;
  let colors = null;

  const theme = () => themeFromPage();
  function refreshColors() {
    const t = theme();
    colors = { theme: t, ...mapPalette(model, palette, t.gray) };
  }
  function cellsOfSelection() {
    view.selected = selected;
  }
  function clampView() {
    const g = geometry(model, view);
    view.cellW = Math.max(MIN_CELL, Math.min(MAX_CELL, view.cellW));
    const maxX0 = Math.max(1, model.length - g.visible + 1);
    view.x0 = Math.max(1, Math.min(maxX0, view.x0));
  }
  function fit() {
    const g = geometry(model, { ...view, cellW: 1 });
    view.cellW = Math.max(MIN_CELL, Math.min(16, g.gridW / model.length));
    view.x0 = 1;
    clampView();
    draw();
  }
  function draw() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(paint);
  }
  function paint() {
    const ratio = window.devicePixelRatio || 1;
    const g = geometry(model, view);
    canvas.width = Math.round(view.width * ratio);
    canvas.height = Math.round(g.height * ratio);
    canvas.style.width = `${view.width}px`;
    canvas.style.height = `${g.height}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    cellsOfSelection();
    drawMap(ctx, model, view, colors.theme, colors.color, colors.paler);
  }
  function cellOf(k) {
    if (k < 0) return null;
    const R = model.rows.length;
    return cellAt(model, Math.floor(k / R) + 1, k % R);
  }
  function announce(cell) {
    live.textContent = cell ? options.describe(cell) : '';
  }
  // Keeps a position in view.
  function reveal(position) {
    const g = geometry(model, view);
    if (position < view.x0) view.x0 = position;
    else if (position >= view.x0 + g.visible - 1) view.x0 = position - g.visible + 2;
    clampView();
  }
  function zoomAround(factor, x) {
    const g = geometry(model, view);
    const at = view.x0 + (x - g.left) / view.cellW;
    view.cellW *= factor;
    clampView();
    view.x0 = at - (x - g.left) / view.cellW;
    clampView();
    draw();
  }
  function select(cells, primary, add) {
    if (!add) selected = new Set();
    for (const k of cells) {
      if (add && selected.has(k) && cells.length === 1) selected.delete(k);
      else selected.add(k);
    }
    options.onSelect?.(new Set(selected), primary);
    draw();
  }

  // --- Pointer -----------------------------------------------------------------------------------
  let drag = null;
  canvas.addEventListener('pointerdown', (event) => {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const hit = hitTest(model, view, x, y);
    canvas.setPointerCapture(event.pointerId);
    if (hit?.region === 'overview') {
      drag = { kind: 'overview' };
      view.x0 = hit.position - geometry(model, view).visible / 2;
      clampView();
      draw();
      return;
    }
    drag = { kind: event.shiftKey ? 'band' : 'pan', x, y, x0: view.x0, moved: false, add: event.metaKey || event.ctrlKey || event.shiftKey };
  });
  canvas.addEventListener('pointermove', (event) => {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (drag?.kind === 'overview') {
      const hit = hitTest(model, view, x, geometry(model, view).overviewTop + 4);
      if (hit) {
        view.x0 = hit.position - geometry(model, view).visible / 2;
        clampView();
        draw();
      }
      return;
    }
    if (drag) {
      if (Math.abs(x - drag.x) + Math.abs(y - drag.y) > 3) drag.moved = true;
      if (drag.kind === 'pan' && drag.moved) {
        view.x0 = drag.x0 - (x - drag.x) / view.cellW;
        clampView();
        draw();
      } else if (drag.kind === 'band' && drag.moved) {
        Object.assign(band.style, { left: `${Math.min(x, drag.x)}px`, top: `${Math.min(y, drag.y)}px`, width: `${Math.abs(x - drag.x)}px`, height: `${Math.abs(y - drag.y)}px` });
        band.hidden = false;
      }
      return;
    }
    const hit = hitTest(model, view, x, y);
    const cell = hit?.region === 'cell' ? cellAt(model, hit.position, hit.row) : null;
    const k = cell ? cell.k : -1;
    if (k !== view.hover) {
      view.hover = k;
      draw();
      options.onHover?.(cell);
    }
    if (cell) {
      tip.textContent = options.describe(cell);
      tip.hidden = false;
      const left = Math.min(x + 14, view.width - 260);
      Object.assign(tip.style, { left: `${Math.max(0, left)}px`, top: `${y + 16}px` });
    } else {
      tip.hidden = true;
    }
  });
  const finish = (event) => {
    if (!drag) return;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const d = drag;
    drag = null;
    band.hidden = true;
    if (d.kind === 'band' && d.moved) {
      const a = hitTest(model, view, Math.max(geometry(model, view).left, Math.min(x, d.x)), Math.min(y, d.y)) ?? { position: Math.ceil(view.x0), row: 0 };
      const b = hitTest(model, view, Math.max(x, d.x), Math.max(y, d.y)) ?? { position: Math.floor(view.x0 + geometry(model, view).visible), row: model.rows.length - 1 };
      const cells = [];
      for (let p = Math.max(1, a.position); p <= Math.min(model.length, b.position); p += 1) {
        for (let r = Math.max(0, a.row); r <= Math.min(model.rows.length - 1, b.row); r += 1) {
          const cell = cellAt(model, p, r);
          if (cell && cell.state !== 0) cells.push(cell.k);
        }
      }
      select(cells, cells.length ? cellOf(cells[0]) : null, true);
      return;
    }
    if (d.kind !== 'overview' && !d.moved) {
      const hit = hitTest(model, view, x, y);
      if (hit?.region === 'cell') {
        const cell = cellAt(model, hit.position, hit.row);
        if (cell && cell.state !== 0) {
          view.focus = cell.k;
          select([cell.k], cell, d.add);
          announce(cell);
        }
      }
    }
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', () => { drag = null; band.hidden = true; });
  canvas.addEventListener('pointerleave', () => {
    tip.hidden = true;
    if (view.hover >= 0) {
      view.hover = -1;
      draw();
      options.onHover?.(null);
    }
  });
  canvas.addEventListener('wheel', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      zoomAround(Math.exp(-event.deltaY * 0.01), event.clientX - rect.left);
    } else if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      event.preventDefault();
      view.x0 += event.deltaX / view.cellW;
      clampView();
      draw();
    }
  }, { passive: false });

  // --- Keyboard ----------------------------------------------------------------------------------
  el.addEventListener('keydown', (event) => {
    const R = model.rows.length;
    let k = view.focus >= 0 ? view.focus : (Math.max(1, Math.ceil(view.x0)) - 1) * R;
    let p = Math.floor(k / R) + 1;
    let r = k % R;
    const g = geometry(model, view);
    switch (event.key) {
      case 'ArrowRight': p = Math.min(model.length, p + 1); break;
      case 'ArrowLeft': p = Math.max(1, p - 1); break;
      case 'ArrowDown': r = Math.min(R - 1, r + 1); break;
      case 'ArrowUp': r = Math.max(0, r - 1); break;
      case 'PageDown': p = Math.min(model.length, p + Math.floor(g.visible)); break;
      case 'PageUp': p = Math.max(1, p - Math.floor(g.visible)); break;
      case 'Home': p = 1; break;
      case 'End': p = model.length; break;
      case '+': case '=': zoomAround(1.4, g.left + (p - view.x0) * view.cellW); event.preventDefault(); return;
      case '-': case '_': zoomAround(1 / 1.4, g.left + (p - view.x0) * view.cellW); event.preventDefault(); return;
      case 'Escape': select([], null, false); return;
      case 'Enter': case ' ': {
        event.preventDefault();
        const cell = cellOf(k);
        if (cell && cell.state !== 0) select([cell.k], cell, event.metaKey || event.ctrlKey || event.shiftKey);
        return;
      }
      default: return;
    }
    event.preventDefault();
    k = (p - 1) * R + r;
    view.focus = k;
    reveal(p);
    draw();
    announce(cellOf(k));
  });
  el.addEventListener('focus', () => {
    if (view.focus < 0) {
      view.focus = (Math.max(1, Math.ceil(view.x0)) - 1) * model.rows.length;
      announce(cellOf(view.focus));
      draw();
    }
  });

  const resize = new ResizeObserver(() => {
    const width = Math.max(200, Math.floor(el.clientWidth));
    if (width === view.width && fitted) return;
    view.width = width;
    if (!fitted) {
      fitted = true;
      fit();
    } else {
      clampView();
      draw();
    }
  });
  resize.observe(el);
  refreshColors();

  return {
    el,
    setModel(next, keepView = true) {
      model = next;
      refreshColors();
      if (!keepView) fitted = false;
      clampView();
      draw();
    },
    setPalette(name) {
      palette = name;
      refreshColors();
      draw();
    },
    setSelection(cells) {
      selected = new Set(cells);
      draw();
    },
    refreshTheme() {
      refreshColors();
      draw();
    },
    zoom(factor) {
      zoomAround(factor, geometry(model, view).left + geometry(model, view).gridW / 2);
    },
    fit,
    focusCell(k) {
      view.focus = k;
      reveal(Math.floor(k / model.rows.length) + 1);
      draw();
    },
    colors: () => colors,
    destroy() {
      resize.disconnect();
      cancelAnimationFrame(frame);
    },
  };
}
