// Draws the variant-effect map (map-model.js) on a 2D canvas context: the cells of the visible
// positions, each state its own way (missing: an empty cell with a dot; filtered: a diagonal
// hatch; low confidence: a paler color and a corner mark; not designed: no cell; the reference
// residue: outlined), the median of each position above and of each row at the right, position
// axes (target and reference numbering), the sequence tracks shown below the grid (track-render.js;
// wave 3, slice 5), an overview strip of the whole target with the visible window, and the
// selection, hover and keyboard focus. Pure apart from the context it is given, so the benchmark
// (validation/bench.mjs) runs it in Node on a stand-in context.

import { STATE, colorPosition } from './map-model.js';
import { colormapLUT } from './colormaps.js';
import { layoutTracks, paintShapes, TRACK_GAP, trackShapes, tracksHeight } from './track-render.js';

// leftTracks: the left margin when tracks are shown, for their names.
export const LAYOUT = { left: 30, leftTracks: 132, right: 22, track: 14, axis: 16, refAxis: 14, gap: 6, overview: 18 };

// The geometry of a view: { width, cellW, cellH, x0 (first visible position, may be fractional),
// tracks (the tracks shown, or none) }. Returns the regions in canvas pixels.
export function geometry(model, view) {
  const L = LAYOUT;
  const tracks = view.tracks ?? [];
  const left = tracks.length ? L.leftTracks : L.left;
  const top = L.track + L.axis;
  const gridH = model.rows.length * view.cellH;
  const refAxis = model.target.offset ? L.refAxis : 0;
  const tracksTop = top + gridH + refAxis;
  const tracksH = tracksHeight(tracks);
  const overviewTop = tracksTop + tracksH + L.gap;
  return {
    left,
    top,
    gridW: Math.max(10, view.width - left - L.right),
    gridH,
    trackTop: 0,
    refAxisTop: top + gridH,
    tracksTop,
    tracksHeight: tracksH,
    overviewTop,
    height: overviewTop + L.overview + 2,
    visible: Math.max(1, (view.width - left - L.right) / view.cellW),
  };
}

// Ticks for positions: a step that keeps labels about 40 px apart.
function tickStep(cellW) {
  const want = 40 / cellW;
  for (const s of [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000]) if (s >= want) return s;
  return 10000;
}

// Draws the map. theme: colors by name (background, empty, hatch, dot, mark, text, muted, line,
// accent); color(t): the CSS color of a place on the color scale; paler(t): the same, desaturated.
export function drawMap(ctx, model, view, theme, color, paler) {
  const g = geometry(model, view);
  const R = model.rows.length;
  const { cellW, cellH } = view;
  const first = Math.max(1, Math.floor(view.x0));
  const last = Math.min(model.length, Math.ceil(view.x0 + g.visible));
  const xOf = (p) => g.left + (p - view.x0) * cellW;
  const inset = cellW >= 5 ? 1 : 0;
  const w = Math.max(1, cellW - inset);
  const h = Math.max(1, cellH - (cellH >= 6 ? 1 : 0));

  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, view.width, g.height);
  ctx.save();
  ctx.beginPath();
  ctx.rect(g.left, 0, g.gridW, g.overviewTop);
  ctx.clip();

  // The median of each position's substitutions, above the grid.
  for (let p = first; p <= last; p += 1) {
    const t = colorPosition(model, model.columnMedian[p - 1]);
    if (!Number.isFinite(t) || model.colorBy !== 'score') continue;
    ctx.fillStyle = color(t);
    ctx.fillRect(xOf(p), g.trackTop + 1, w, LAYOUT.track - 3);
  }

  // Cells.
  for (let p = first; p <= last; p += 1) {
    const x = xOf(p);
    for (let r = 0; r < R; r += 1) {
      const k = (p - 1) * R + r;
      const s = model.state[k];
      if (s === STATE.NOT_DESIGNED) continue;
      const y = g.top + r * cellH;
      const t = colorPosition(model, model.value[k]);
      if (s === STATE.SCORED && Number.isFinite(t)) {
        ctx.fillStyle = color(t);
        ctx.fillRect(x, y, w, h);
      } else if (s === STATE.LOW && Number.isFinite(t)) {
        ctx.fillStyle = paler(t);
        ctx.fillRect(x, y, w, h);
        if (cellW >= 6) {
          ctx.fillStyle = theme.mark;
          ctx.beginPath();
          ctx.moveTo(x + w - Math.min(5, w / 2), y);
          ctx.lineTo(x + w, y);
          ctx.lineTo(x + w, y + Math.min(5, h / 2));
          ctx.closePath();
          ctx.fill();
        }
      } else if (s === STATE.FILTERED) {
        ctx.fillStyle = theme.empty;
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = theme.hatch;
        ctx.lineWidth = 1;
        ctx.beginPath();
        if (cellW >= 3) {
          ctx.moveTo(x, y + h);
          ctx.lineTo(x + w, y);
          if (cellW >= 8) {
            ctx.moveTo(x, y + h / 2);
            ctx.lineTo(x + w / 2, y);
            ctx.moveTo(x + w / 2, y + h);
            ctx.lineTo(x + w, y + h / 2);
          }
        } else {
          ctx.rect(x, y + h / 2, w, 0.5);
        }
        ctx.stroke();
      } else if (s === STATE.REFERENCE) {
        ctx.fillStyle = model.domain.kind === 'diverging' ? color(0.5) : theme.empty;
        ctx.fillRect(x, y, w, h);
      } else {
        // Missing (or a value it cannot be colored by): an empty cell with a dot.
        ctx.fillStyle = theme.empty;
        ctx.fillRect(x, y, w, h);
        if (cellW >= 4) {
          ctx.fillStyle = theme.dot;
          const d = Math.max(1, Math.min(cellW, cellH) * 0.18);
          ctx.fillRect(x + w / 2 - d / 2, y + h / 2 - d / 2, d, d);
        }
      }
      if (model.reference[k] && cellW >= 4) {
        ctx.strokeStyle = theme.text;
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      }
    }
  }
  // Selection, hover and keyboard focus.
  const outline = (k, style, width, dash = null) => {
    const p = Math.floor(k / R) + 1;
    if (p < first || p > last) return;
    const r = k % R;
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    if (dash) ctx.setLineDash(dash);
    ctx.strokeRect(xOf(p) - width / 2 + 0.5, g.top + r * cellH - width / 2 + 0.5, w + width - 1, h + width - 1);
    if (dash) ctx.setLineDash([]);
  };
  if (view.selected) for (const k of view.selected) outline(k, theme.accent, 2);
  if (view.hover >= 0) outline(view.hover, theme.text, 1.5);
  if (view.focus >= 0) outline(view.focus, theme.accent, 2, [3, 2]);
  ctx.restore();

  // Row labels and group lines; the row medians at the right.
  ctx.font = `${Math.min(11, Math.max(8, cellH - 3))}px ui-monospace, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let r = 0; r < R; r += 1) {
    const y = g.top + r * cellH + h / 2;
    ctx.fillStyle = theme.muted;
    if (cellH >= 8) ctx.fillText(model.rows[r] === '*' ? '*' : model.rows[r], g.left - LAYOUT.left / 2, y);
    const t = colorPosition(model, model.rowMedian[r]);
    if (Number.isFinite(t) && model.domain.kind === 'diverging') {
      ctx.fillStyle = color(t);
      ctx.fillRect(view.width - LAYOUT.right + 6, g.top + r * cellH, LAYOUT.right - 8, h);
    }
  }
  if (model.groups) {
    ctx.strokeStyle = theme.line;
    ctx.lineWidth = 1;
    for (const [start] of model.groups.slice(1)) {
      const y = g.top + start * cellH - 0.5;
      ctx.beginPath();
      ctx.moveTo(g.left - LAYOUT.left + 4, y);
      ctx.lineTo(g.left - 4, y);
      ctx.stroke();
    }
  }
  // Position axes: target numbering above, reference numbering below when they differ.
  const step = tickStep(cellW);
  ctx.font = '10px system-ui, sans-serif';
  ctx.fillStyle = theme.muted;
  ctx.textBaseline = 'alphabetic';
  for (let p = Math.ceil(first / step) * step || step; p <= last; p += step) {
    const x = xOf(p) + w / 2;
    if (x < g.left || x > g.left + g.gridW) continue;
    ctx.fillText(String(p), x, LAYOUT.track + LAYOUT.axis - 4);
    if (model.target.offset) ctx.fillText(String(p + model.target.offset), x, g.refAxisTop + LAYOUT.refAxis - 3);
  }
  if (step > 1 && cellW >= 9) {
    // Reference residues under the axis when there is room for a letter per position.
    ctx.font = '9px ui-monospace, monospace';
    for (let p = first; p <= last; p += 1) if (p % step) ctx.fillText(model.protein[p - 1], xOf(p) + w / 2, LAYOUT.track + LAYOUT.axis - 4);
  }
  // The tracks, on the grid's columns, with their names in the margin.
  if (view.tracks?.length) {
    const shapes = trackShapes(view.tracks, { left: g.left, gridW: g.gridW, cellW, x0: view.x0, first, last, top: g.tracksTop, gutter: g.left }, theme, color);
    paintShapes(ctx, shapes, { x: g.left, y: g.tracksTop, w: g.gridW, h: g.tracksHeight });
  }
  // The position under the pointer, down the grid and the tracks.
  const column = view.hover >= 0 ? Math.floor(view.hover / R) + 1 : view.hoverPosition ?? -1;
  if (column >= first && column <= last && (view.tracks?.length || view.hover < 0)) {
    ctx.save();
    ctx.globalAlpha = 0.14;
    ctx.fillStyle = theme.accent;
    ctx.fillRect(xOf(column), g.top, w, g.tracksTop + g.tracksHeight - g.top);
    ctx.restore();
  }
  drawOverview(ctx, model, view, theme, color, g);
  return g;
}

// The whole target in one strip (each position's median, or its share of measured cells), with
// the visible window outlined.
export function drawOverview(ctx, model, view, theme, color, g = geometry(model, view)) {
  const width = g.gridW;
  const per = width / model.length;
  const y = g.overviewTop;
  ctx.fillStyle = theme.empty;
  ctx.fillRect(g.left, y, width, LAYOUT.overview);
  for (let p = 1; p <= model.length; p += 1) {
    const t = colorPosition(model, model.columnMedian[p - 1]);
    if (!Number.isFinite(t)) continue;
    ctx.fillStyle = color(t);
    ctx.fillRect(g.left + (p - 1) * per, y + 2, Math.max(1, per), LAYOUT.overview - 4);
  }
  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = 1.5;
  const x = g.left + (view.x0 - 1) * per;
  ctx.strokeRect(Math.max(g.left, x) + 0.5, y + 0.5, Math.min(width, g.visible * per) - 1, LAYOUT.overview - 1);
}

// What is at (x, y): { region: 'cell', position, row } | { region: 'overview', position } |
// { region: 'track', track (its index among the tracks shown), position (null in the names'
// margin) } | null.
export function hitTest(model, view, x, y) {
  const g = geometry(model, view);
  if (y >= g.overviewTop && y <= g.overviewTop + LAYOUT.overview && x >= g.left && x <= g.left + g.gridW) {
    return { region: 'overview', position: 1 + ((x - g.left) / g.gridW) * model.length };
  }
  if (view.tracks?.length && y >= g.tracksTop && y < g.tracksTop + g.tracksHeight && x <= g.left + g.gridW) {
    const { rows } = layoutTracks(view.tracks, g.tracksTop);
    const track = rows.findIndex((r) => y >= r.y - TRACK_GAP / 2 && y < r.y + r.height + TRACK_GAP / 2);
    if (track < 0) return null;
    if (x < g.left) return { region: 'track', track, position: null };
    const position = Math.floor(view.x0 + (x - g.left) / view.cellW);
    return position >= 1 && position <= model.length ? { region: 'track', track, position } : null;
  }
  if (x < g.left || x > g.left + g.gridW || y < g.top || y >= g.top + g.gridH) return null;
  const position = Math.floor(view.x0 + (x - g.left) / view.cellW);
  const row = Math.floor((y - g.top) / view.cellH);
  if (position < 1 || position > model.length) return null;
  return { region: 'cell', position, row };
}

// The designed cells a freeform shape encloses (wave 4, slice 5): those whose centers lie inside
// the polygon of canvas points [[x, y], …] (closed, by the even-odd rule), among the positions
// visible. [cell index], positions major.
export function cellsInPolygon(model, view, points) {
  if (!points || points.length < 3) return [];
  const g = geometry(model, view);
  const R = model.rows.length;
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const first = Math.max(1, Math.floor(view.x0), Math.floor(view.x0 + (Math.max(minX, g.left) - g.left) / view.cellW));
  const last = Math.min(model.length, Math.ceil(view.x0 + g.visible), Math.ceil(view.x0 + (Math.min(maxX, g.left + g.gridW) - g.left) / view.cellW));
  const cells = [];
  for (let p = first; p <= last; p += 1) {
    const cx = g.left + (p - view.x0 + 0.5) * view.cellW;
    if (cx < g.left || cx > g.left + g.gridW || cx < minX || cx > maxX) continue;
    for (let r = 0; r < R; r += 1) {
      const cy = g.top + (r + 0.5) * view.cellH;
      if (cy < minY || cy > maxY) continue;
      const k = (p - 1) * R + r;
      if (model.state[k] !== STATE.NOT_DESIGNED && insidePolygon(points, cx, cy)) cells.push(k);
    }
  }
  return cells;
}

// Even-odd ray casting.
export function insidePolygon(points, x, y) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// The colors of a map: color(t) and paler(t) (for low confidence: halfway to gray), from a
// diverging palette ('rdbu', 'puor') for scores or viridis for the rest, 256 steps.
export function mapPalette(model, palette = 'rdbu', gray = [110, 110, 110]) {
  const name = model.domain.kind === 'diverging' ? palette : 'viridis';
  const lut = colormapLUT(name);
  const hex = (r, g, b) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
  const full = [];
  const pale = [];
  for (let i = 0; i < 256; i += 1) {
    const [r, g, b] = [lut[i * 3], lut[i * 3 + 1], lut[i * 3 + 2]];
    full.push(hex(r, g, b));
    pale.push(hex((r + gray[0]) / 2, (g + gray[1]) / 2, (b + gray[2]) / 2));
  }
  const at = (list) => (t) => list[Math.max(0, Math.min(255, Math.round(t * 255)))];
  return { name, color: at(full), paler: at(pale) };
}
