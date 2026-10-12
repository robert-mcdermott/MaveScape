// The variant-effect map as a figure panel (wave 6, slice 1; requirement R5): the map of a run, a
// condition or a difference between conditions, fitted to the panel's box at the figure's text
// size, as marks (lib/draw.js). The same encoding as the window and map-svg.js: every state drawn
// its own way (missing: an empty cell with a dot; filtered: a hatch; low confidence: a paler color
// and a corner mark; not designed: no cell; the reference residue: outlined), the median of each
// position above and of each substitution at the right, target and reference numbering, the tracks
// below, a color bar and a key to the states. Pure: the Figures view and Node draw it alike.

import { STATE, STATE_NAMES, colorPosition, describeMap } from './map-model.js';
import { mapPalette } from './map-render.js';
import { EXPORT_THEME } from './map-svg.js';
import { trackShapes, tracksHeight } from './track-render.js';
import { describeTrack } from './tracks.js';
import { placeMarks, textWidth } from './draw.js';

// The smallest text a panel should use, in points (journals ask for 5–7 pt at the printed size).
export const MIN_TEXT = 6;

const fmt = (x) => String(Number(x.toFixed(2)));

function tickStep(cellW, size, last) {
  const room = textWidth(String(last), size) * 1.8;
  for (const s of [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000]) if (s * cellW >= room) return s;
  return 10000;
}

// The map's title, as map-svg.js gives it.
export function mapTitle(model) {
  if (model.contrast) return `${model.target.name} · ${model.contrast.name}`;
  return `${model.target.name}${model.condition.name && model.condition.id !== 'all' ? ` · ${model.condition.name}` : ''}`;
}

// What the legend's color bar measures.
export function legendLabel(model) {
  if (model.contrast?.method === 'comparison') return `difference, ${model.contrast.name.replace(' vs ', ' − ')}`;
  if (model.contrast) return `differential score, ${model.contrast.name}`;
  if (model.domain.kind === 'diverging') return model.scale?.stated ? `score: lower, ${model.scale.low}; higher, ${model.scale.high}` : 'score';
  return model.colorBy === 'se' ? 'SE' : model.colorBy === 'replicates' ? 'replicates used' : 'log10 input count';
}

// Where the legend's parts go: the color bar with its ends and what it measures (three lines), and
// the states' key to its right, wrapping onto more lines, or below it when there is no room beside
// it. width: from the grid's left edge to the panel's right. Positions are from the legend's top
// left. { height, barW, swatch,
// items: [{ state, name, dx, dy }] }.
function legendLayout(model, width, t) {
  const barW = Math.min(110, width * 0.45);
  const block = Math.max(barW, textWidth(legendLabel(model), t), textWidth(`${fmt(model.domain.center)} (wild type)`, t) + barW / 2);
  const swatch = Math.max(4, 0.9 * t);
  const states = [STATE.LOW, STATE.FILTERED, STATE.MISSING, STATE.REFERENCE].map((s) => ({ state: s, name: STATE_NAMES[s], need: swatch + 3 + textWidth(STATE_NAMES[s], t) + t }));
  const widest = Math.max(...states.map((s) => s.need));
  const room = width - 6;
  const beside = room - block - 2 * t >= widest;
  const x0 = beside ? block + 2 * t : 0;
  const y0 = beside ? 0 : 3 * t + 6;
  const items = [];
  let x = x0;
  let y = y0;
  for (const s of states) {
    if (x + s.need > room && x > x0) {
      x = x0;
      y += t + 3;
    }
    items.push({ state: s.state, name: s.name, dx: x, dy: y });
    x += s.need;
  }
  const keyBottom = y + swatch;
  const height = Math.max(3.1 * t + 2, keyBottom) + 8;
  return { height, barW, swatch, items };
}

// The marks of a map panel in a box { x, y, w, h } (points). data: { model, results, tracks (the
// tracks to show, arranged) }. options: { text (pt), palette, from, to (positions shown; the whole
// target by default), title (text, '' for none, null for the map's own), medians, legend }.
// Returns { marks, description, notes, range: [from, to] }.
export function mapPanel(box, data, options = {}) {
  const { model, results } = data;
  const tracks = data.tracks ?? [];
  const t = Math.max(4, options.text ?? 7);
  const theme = EXPORT_THEME;
  const { color, paler } = mapPalette(model, options.palette ?? 'rdbu', theme.gray);
  const from = Math.max(1, Math.min(model.length, Math.round(options.from ?? 1)));
  const to = Math.max(from, Math.min(model.length, Math.round(options.to ?? model.length)));
  const shown = to - from + 1;
  const R = model.rows.length;
  const medians = options.medians !== false && model.domain.kind === 'diverging';
  const legend = options.legend !== false;
  const title = options.title === null || options.title === undefined ? mapTitle(model) : options.title;
  const notes = [];
  const marks = [];

  // The vertical layout: title, the positions' medians, the axis, the grid, the reference axis, the
  // tracks, the legend.
  const titleH = title ? t + 4 : 0;
  const strip = medians ? 0.8 * t : 0;
  const axisH = t + 3;
  const refAxisH = model.target.offset ? t + 3 : 0;
  // The tracks are drawn at a tenth of the text size per unit, as the window draws them at 10 px;
  // track-render.js shortens a name to (gutter − 10) / 5.4 characters at 10 units.
  const k = t / 10;
  const tracksH = tracks.length ? tracksHeight(tracks) * k : 0;
  const tracksW = tracks.length ? Math.min(box.w * 0.25, Math.max(...tracks.map((tr) => Math.max(textWidth(tr.label, t) + 6, (tr.label.length * 5.4 + 12) * k)))) : 0;
  const key = legend ? legendLayout(model, box.w - Math.max(textWidth('W', t) + 4, tracksW), t) : null;
  const legendH = key ? key.height : 0;
  const top = box.y + titleH + strip + (strip ? 1 : 0) + axisH;
  const gridH = box.h - (top - box.y) - refAxisH - tracksH - legendH;
  const cellH = gridH / R;
  // The horizontal layout: the rows' (or tracks') names, the grid, the rows' medians.
  const rowLabel = Math.min(t, cellH * 1.05);
  const labelsW = textWidth('W', rowLabel) + 4;
  const left = box.x + Math.max(labelsW, tracksW);
  const right = medians ? 0.8 * t + 3 : 2;
  const gridW = box.w - (left - box.x) - right;
  const cellW = gridW / shown;
  if (!(cellH > 0.3) || !(cellW > 0.3)) {
    marks.push({ type: 'text', x: box.x + box.w / 2, y: box.y + box.h / 2, text: 'Too small for the map: make the panel larger.', size: t, fill: theme.muted, anchor: 'middle', baseline: 'middle' });
    return { marks, description: 'The map does not fit its panel.', notes: ['The panel is too small to draw the map.'], range: [from, to] };
  }
  if (cellW < 0.6) notes.push(`Each position is ${cellW.toFixed(2)} pt wide: show fewer positions, or make the panel wider.`);
  if (rowLabel < MIN_TEXT) notes.push(`The substitutions' names are ${rowLabel.toFixed(1)} pt: make the panel taller.`);
  const gapW = cellW >= 3 ? 0.4 : 0;
  const gapH = cellH >= 3 ? 0.4 : 0;
  const w = cellW - gapW;
  const h = cellH - gapH;
  const xOf = (p) => left + (p - from) * cellW;

  if (title) marks.push({ type: 'text', x: left, y: box.y, text: title, size: t + 1, bold: true, fill: theme.text, baseline: 'top' });
  // The positions' medians.
  if (medians) {
    for (let p = from; p <= to; p += 1) {
      const v = colorPosition(model, model.columnMedian[p - 1]);
      if (Number.isFinite(v)) marks.push({ type: 'rect', x: xOf(p), y: box.y + titleH, w, h: strip, fill: color(v) });
    }
  }
  // The axes: target numbering above, the reference's below.
  const step = tickStep(cellW, t, to);
  const axisY = box.y + titleH + strip + (strip ? 1 : 0) + axisH - 2;
  for (let p = Math.ceil(from / step) * step; p <= to; p += step) {
    if (p < from) continue;
    marks.push({ type: 'text', x: xOf(p) + w / 2, y: axisY, text: String(p), size: t, fill: theme.muted, anchor: 'middle' });
    if (model.target.offset) marks.push({ type: 'text', x: xOf(p) + w / 2, y: top + gridH + refAxisH - 1, text: String(p + model.target.offset), size: t, fill: theme.muted, anchor: 'middle' });
  }
  for (let r = 0; r < R; r += 1) marks.push({ type: 'text', x: left - 2, y: top + r * cellH + h / 2, text: model.rows[r], size: rowLabel, fill: theme.muted, anchor: 'end', baseline: 'middle' });
  // The cells.
  const cells = [];
  const corner = Math.min(w, h) * 0.45;
  for (let p = from; p <= to; p += 1) {
    const x = xOf(p);
    for (let r = 0; r < R; r += 1) {
      const kk = (p - 1) * R + r;
      const s = model.state[kk];
      if (s === STATE.NOT_DESIGNED) continue;
      const y = top + r * cellH;
      const v = colorPosition(model, model.value[kk]);
      // Each cell named as map-svg.js names it (G203A), so a figure's cells can be told apart.
      const id = `${model.protein[p - 1]}${p}${model.rows[r]}`;
      if (s === STATE.SCORED && Number.isFinite(v)) cells.push({ type: 'rect', x, y, w, h, fill: color(v), title: id });
      else if (s === STATE.LOW && Number.isFinite(v)) cells.push({ type: 'rect', x, y, w, h, fill: paler(v), title: `${id} (low confidence)` }, { type: 'path', d: `M${x + w - corner} ${y}L${x + w} ${y}L${x + w} ${y + corner}Z`, fill: theme.mark });
      else if (s === STATE.FILTERED) cells.push({ type: 'hatch', x, y, w, h, fill: theme.empty, stroke: theme.hatch, spacing: Math.max(1.2, Math.min(3, Math.min(w, h) / 2)), width: Math.min(0.6, Math.min(w, h) / 6), title: `${id} (filtered)` });
      else if (s === STATE.REFERENCE) cells.push({ type: 'rect', x, y, w, h, fill: model.domain.kind === 'diverging' ? color(0.5) : theme.empty, title: `${id} (reference)` });
      else {
        cells.push({ type: 'rect', x, y, w, h, fill: theme.empty, title: `${id} (missing)` });
        if (w >= 2 && h >= 2) cells.push({ type: 'rect', x: x + w / 2 - 0.4, y: y + h / 2 - 0.4, w: 0.8, h: 0.8, fill: theme.dot });
      }
      if (model.reference[kk] && w >= 1.5) cells.push({ type: 'rect', x: x + 0.25, y: y + 0.25, w: w - 0.5, h: h - 0.5, fill: 'none', stroke: theme.text, width: Math.min(0.5, w / 4) });
    }
  }
  marks.push({ type: 'group', label: 'cells', marks: cells });
  // The substitutions' medians.
  if (medians) {
    for (let r = 0; r < R; r += 1) {
      const v = colorPosition(model, model.rowMedian[r]);
      if (Number.isFinite(v)) marks.push({ type: 'rect', x: left + gridW + 3, y: top + r * cellH, w: 0.8 * t, h, fill: color(v) });
    }
  }
  // The tracks.
  if (tracks.length) {
    const tracksTop = top + gridH + refAxisH;
    const frame = { left: left / k, gridW: gridW / k, cellW: cellW / k, x0: from, first: from, last: to, top: tracksTop / k, gutter: (left - box.x) / k };
    const shapes = trackShapes(tracks, frame, theme, color).map((s) => (s.type === 'text' ? { type: 'text', x: s.x, y: s.y, text: s.text, size: s.size, fill: s.fill, anchor: s.anchor, clip: s.clip, title: s.title } : s));
    const placed = placeMarks(shapes.map(({ clip, ...s }) => s), { k });
    const clipped = placed.filter((_, i) => shapes[i].clip);
    marks.push(...placed.filter((_, i) => !shapes[i].clip));
    marks.push({ type: 'group', clip: { x: left, y: tracksTop, w: gridW, h: tracksH }, label: 'tracks', marks: clipped });
  }
  // The legend: the color bar and its ends, what it measures, then the states.
  if (legend) {
    const ly = box.y + box.h - legendH + 6;
    const { barW, items } = key;
    const bx = box.x + (left - box.x);
    for (let i = 0; i < 32; i += 1) marks.push({ type: 'rect', x: bx + (i * barW) / 32, y: ly, w: barW / 32 + 0.05, h: 0.8 * t, fill: color(i / 31) });
    const d = model.domain;
    const labelY = ly + 0.8 * t + 1;
    marks.push({ type: 'text', x: bx, y: labelY, text: fmt(d.min), size: t, fill: theme.muted, baseline: 'top' });
    if (d.kind === 'diverging') marks.push({ type: 'text', x: bx + barW / 2, y: labelY, text: `${fmt(d.center)} (${model.contrast ? 'no difference' : 'wild type'})`, size: t, fill: theme.muted, anchor: 'middle', baseline: 'top' });
    marks.push({ type: 'text', x: bx + barW, y: labelY, text: fmt(d.max), size: t, fill: theme.muted, anchor: 'end', baseline: 'top' });
    marks.push({ type: 'text', x: bx, y: labelY + t + 1, text: legendLabel(model), size: t, fill: theme.muted, baseline: 'top' });
    const sw = key.swatch;
    for (const { state: s, name, dx, dy } of items) {
      const x = bx + dx;
      const y = ly + dy;
      if (s === STATE.LOW) marks.push({ type: 'rect', x, y, w: sw, h: sw, fill: paler(0.2) }, { type: 'path', d: `M${x + sw * 0.55} ${y}L${x + sw} ${y}L${x + sw} ${y + sw * 0.45}Z`, fill: theme.mark });
      if (s === STATE.FILTERED) marks.push({ type: 'hatch', x, y, w: sw, h: sw, fill: theme.empty, stroke: theme.hatch, spacing: 2, width: 0.5 });
      if (s === STATE.MISSING) marks.push({ type: 'rect', x, y, w: sw, h: sw, fill: theme.empty }, { type: 'rect', x: x + sw / 2 - 0.5, y: y + sw / 2 - 0.5, w: 1, h: 1, fill: theme.dot });
      if (s === STATE.REFERENCE) marks.push({ type: 'rect', x: x + 0.25, y: y + 0.25, w: sw - 0.5, h: sw - 0.5, fill: d.kind === 'diverging' ? color(0.5) : theme.empty, stroke: theme.text, width: 0.5 });
      marks.push({ type: 'text', x: x + sw + 3, y: y + sw / 2, text: name, size: t, fill: theme.muted, baseline: 'middle' });
    }
  }
  const range = from === 1 && to === model.length ? '' : ` Positions ${from}–${to}${model.target.offset ? ` (${from + model.target.offset}–${to + model.target.offset} in the reference)` : ''} shown.`;
  const description = `${[...describeMap(model, results), ...tracks.map(describeTrack)].join(' ')}${range}`;
  return { marks, description, notes, range: [from, to] };
}
