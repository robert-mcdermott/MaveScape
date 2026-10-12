// Figures (wave 6, slice 1; requirement R5): a figure is a page of panels kept in the workspace
// (ws.figures). Each panel says what it shows (a map panel: the run, its condition or contrast,
// what colors it, the positions and tracks shown), never a copy of the numbers, so a figure is
// drawn again from the workspace whenever it is shown and follows a rescoring until it is exported.
// Sizes are in points (1/72 inch); pages are a journal's column widths or a slide. The page is
// drawn as marks (lib/draw.js), written as SVG or PDF here and painted by the Figures view.
// After CytoWeave 0.8.0's figures (web/lib/figures.js, web/ui/mode-figures.js); the panels are
// MaveScape's.

import { FONT, marksToSVG, pdfPage, textMarks, textWidth } from './draw.js';
import { writePDF } from './pdf.js';
import { mapPanel, mapTitle, MIN_TEXT } from './figure-map.js';
import { newId } from './clock.js';

export const FIGURE_FORMAT = 'mavescape-figure';
export const mm = (v) => (v * 72) / 25.4;
const toMM = (pt) => Math.round(((pt * 25.4) / 72) * 10) / 10;

// Page sizes: the widths most journals set figures at (one, one and a half and two columns), and a
// 16:9 slide. Heights are where a page starts; any can be changed.
export const FIGURE_SIZES = [
  { id: 'single', label: 'One column', width: mm(85), height: mm(70) },
  { id: 'onehalf', label: 'One and a half columns', width: mm(114), height: mm(90) },
  { id: 'double', label: 'Two columns', width: mm(174), height: mm(120) },
  { id: 'slide', label: 'Slide (16:9)', width: 960, height: 540 },
];

export const PANEL_KINDS = {
  map: 'Variant-effect map',
  text: 'Text',
};

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const INK = '#171b26';
const MUTED = '#4b5468';

export function figureSize(id) {
  return FIGURE_SIZES.find((s) => s.id === id) ?? null;
}

// A new figure: { id, name, size, width, height, text (pt), letters, panels, created }.
export function createFigure(name, sizeId = 'double', options = {}) {
  const size = figureSize(sizeId) ?? FIGURE_SIZES[2];
  return {
    id: options.id ?? `figure-${newId()}`,
    name: String(name || 'Figure').trim(),
    size: size.id,
    width: round(options.width ?? size.width),
    height: round(options.height ?? size.height),
    text: options.text ?? (size.id === 'slide' ? 14 : 7),
    letters: options.letters !== false,
    panels: [],
  };
}

const round = (v) => Math.round(v * 100) / 100;

// A panel's own fields, checked: a figure from remote control or an archive is drawn only when
// every field is what a figure holds. Throws with what is wrong.
function checkPanel(p, fig) {
  if (!p || typeof p !== 'object') throw new Error('A panel is not an object.');
  if (typeof p.id !== 'string' || !p.id) throw new Error('A panel has no id.');
  if (!PANEL_KINDS[p.kind]) throw new Error(`Panel ${p.id}: "${p.kind}" is not a kind of panel (${Object.keys(PANEL_KINDS).join(', ')}).`);
  for (const k of ['x', 'y', 'w', 'h']) if (!Number.isFinite(p[k])) throw new Error(`Panel ${p.id}: ${k} is not a number.`);
  if (p.w < 10 || p.h < 10) throw new Error(`Panel ${p.id} is smaller than 10 pt.`);
  if (p.x < -1 || p.y < -1 || p.x + p.w > fig.width + 1 || p.y + p.h > fig.height + 1) throw new Error(`Panel ${p.id} is not on the page (${fig.width} × ${fig.height} pt).`);
  if (p.kind === 'map') {
    if (typeof p.run !== 'string') throw new Error(`Panel ${p.id}: a map names its run.`);
    for (const k of ['from', 'to', 'condition', 'contrast']) if (p[k] !== undefined && p[k] !== null && !Number.isInteger(p[k])) throw new Error(`Panel ${p.id}: ${k} is not a whole number.`);
    if (p.tracks !== undefined && (!Array.isArray(p.tracks) || p.tracks.some((t) => typeof t !== 'string'))) throw new Error(`Panel ${p.id}: tracks is a list of track ids.`);
  }
  if (p.kind === 'text' && typeof p.text !== 'string') throw new Error(`Panel ${p.id}: a text panel has its text.`);
}

export function checkFigure(fig) {
  if (!fig || typeof fig !== 'object') throw new Error('A figure is not an object.');
  if (typeof fig.id !== 'string' || !fig.id) throw new Error('A figure has no id.');
  if (typeof fig.name !== 'string') throw new Error(`Figure ${fig.id} has no name.`);
  if (!(fig.width >= 72 && fig.width <= 2000 && fig.height >= 72 && fig.height <= 2000)) throw new Error(`Figure "${fig.name}": its page is 1 to 70 cm a side.`);
  if (!(fig.text >= 4 && fig.text <= 36)) throw new Error(`Figure "${fig.name}": its text is 4 to 36 pt.`);
  if (!Array.isArray(fig.panels)) throw new Error(`Figure "${fig.name}" has no panels list.`);
  const ids = new Set();
  for (const p of fig.panels) {
    checkPanel(p, fig);
    if (ids.has(p.id)) throw new Error(`Figure "${fig.name}" has two panels ${p.id}.`);
    ids.add(p.id);
  }
  return fig;
}

// --- Panels on the page --------------------------------------------------------------------------

// A new panel's id in a figure.
export function panelId(fig) {
  let n = fig.panels.length + 1;
  while (fig.panels.some((p) => p.id === `panel-${n}`)) n += 1;
  return `panel-${n}`;
}

// The figure with a panel added where it fits: below the panels already there, the page's width
// (or the size asked for). Returns { figure, panel }.
export function addPanel(fig, panel) {
  const gap = 8;
  const bottom = fig.panels.reduce((y, p) => Math.max(y, p.y + p.h), 0);
  const w = Math.min(panel.w ?? fig.width - 2 * gap, fig.width - 2 * gap);
  const room = fig.height - (bottom ? bottom + gap : gap) - gap;
  const h = Math.min(panel.h ?? Math.max(60, room), fig.height - 2 * gap);
  const y = room >= Math.min(h, 60) ? (bottom ? bottom + gap : gap) : gap;
  const placed = { id: panel.id ?? panelId(fig), ...panel, x: round(panel.x ?? gap), y: round(panel.y ?? y), w: round(w), h: round(Math.min(h, fig.height - y - gap) > 20 ? Math.min(h, fig.height - y - gap) : h) };
  return { figure: { ...fig, panels: [...fig.panels, placed] }, panel: placed };
}

export function updatePanel(fig, id, patch) {
  return { ...fig, panels: fig.panels.map((p) => (p.id === id ? { ...p, ...patch } : p)) };
}

export function removePanel(fig, id) {
  return { ...fig, panels: fig.panels.filter((p) => p.id !== id) };
}

// The panels' letters, A, B, C… in reading order: rows from the top (a panel starting above the
// middle of a row's first panel joins it), each row from the left. Panels with letter: false get
// none. Map(panel id → letter).
export function panelLetters(fig) {
  const lettered = fig.panels.filter((p) => p.letter !== false).slice().sort((a, b) => a.y - b.y || a.x - b.x);
  const rows = [];
  for (const p of lettered) {
    const row = rows.at(-1);
    if (row && p.y < row.top + row.height / 2) row.panels.push(p);
    else rows.push({ top: p.y, height: p.h, panels: [p] });
  }
  const out = new Map();
  let i = 0;
  for (const row of rows) {
    for (const p of row.panels.sort((a, b) => a.x - b.x)) {
      out.set(p.id, LETTERS[i % 26].repeat(Math.floor(i / 26) + 1));
      i += 1;
    }
  }
  return out;
}

// --- Drawing --------------------------------------------------------------------------------------

function wrap(text, width, size, bold) {
  const lines = [];
  for (const paragraph of String(text).split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && textWidth(next, size, bold) > width) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

function textPanel(box, panel, fig) {
  const size = panel.size ?? fig.text;
  const bold = Boolean(panel.bold);
  const lines = wrap(panel.text, box.w, size, bold);
  const lineH = size * 1.25;
  const marks = [];
  const x = panel.align === 'center' ? box.x + box.w / 2 : panel.align === 'right' ? box.x + box.w : box.x;
  const anchor = panel.align === 'center' ? 'middle' : panel.align === 'right' ? 'end' : 'start';
  lines.forEach((line, i) => {
    if (line && (i + 1) * lineH <= box.h + 0.5) marks.push({ type: 'text', x, y: box.y + i * lineH, text: line, size, bold, fill: INK, anchor, baseline: 'top' });
  });
  const shown = Math.floor((box.h + 0.5) / lineH);
  const notes = lines.length > shown ? [`${lines.length - shown} line${lines.length - shown > 1 ? 's' : ''} of text do not fit: make the panel taller.`] : [];
  return { marks, description: String(panel.text).replace(/\s+/g, ' ').trim(), notes };
}

function missingPanel(box, message, fig) {
  return {
    marks: [
      { type: 'rect', x: box.x + 0.5, y: box.y + 0.5, w: box.w - 1, h: box.h - 1, fill: 'none', stroke: '#c3c9d4', width: 0.75, dash: [3, 3] },
      { type: 'text', x: box.x + box.w / 2, y: box.y + box.h / 2, text: message, size: Math.max(MIN_TEXT, fig.text), fill: MUTED, anchor: 'middle', baseline: 'middle' },
    ],
    description: message,
    notes: [message],
  };
}

// What a panel shows, in a few words (the view's list, the history).
export function panelSummary(panel, ws = null) {
  if (panel.kind === 'text') return `text "${panel.text.length > 40 ? `${panel.text.slice(0, 39)}…` : panel.text}"`;
  if (panel.kind === 'map') {
    const run = ws?.runs?.find((r) => r.id === panel.run);
    const what = panel.contrast !== null && panel.contrast !== undefined ? 'the differential map' : 'the map';
    const range = panel.from || panel.to ? `, positions ${panel.from ?? 1}–${panel.to ?? 'the end'}` : '';
    return `${what} of ${run?.name ?? panel.run}${range}`;
  }
  return panel.kind;
}

// The page as marks. resolved: Map(panel id → the panel's data: a map's { model, results, tracks },
// or { missing: message } when it cannot be drawn). Returns { marks, panels: [{ id, letter, kind,
// description, notes }], description, notes, smallest (the smallest text, pt) }.
export function figureMarks(fig, resolved) {
  const letters = fig.letters ? panelLetters(fig) : new Map();
  const letterSize = fig.text + 2;
  const marks = [{ type: 'rect', x: 0, y: 0, w: fig.width, h: fig.height, fill: '#ffffff' }];
  const panels = [];
  for (const panel of fig.panels) {
    const letter = letters.get(panel.id) ?? null;
    const head = letter ? letterSize + 2 : 0;
    const box = { x: panel.x, y: panel.y + head, w: panel.w, h: panel.h - head };
    const data = resolved?.get(panel.id);
    let drawn;
    if (panel.kind === 'text') drawn = textPanel(box, panel, fig);
    else if (!data || data.missing) drawn = missingPanel(box, data?.missing ?? 'Not drawn yet', fig);
    else if (panel.kind === 'map') drawn = mapPanel(box, data, { ...panel, text: fig.text });
    else drawn = missingPanel(box, `MaveScape does not draw "${panel.kind}" panels.`, fig);
    const children = [...drawn.marks];
    if (letter) children.unshift({ type: 'text', x: panel.x, y: panel.y, text: letter, size: letterSize, bold: true, fill: INK, baseline: 'top' });
    marks.push({ type: 'group', clip: { x: panel.x, y: panel.y, w: panel.w, h: panel.h }, label: letter ? `Panel ${letter}` : panel.id, marks: children });
    panels.push({ id: panel.id, letter, kind: panel.kind, description: drawn.description, notes: drawn.notes ?? [] });
  }
  const sizes = textMarks(marks).map((m) => m.size);
  const smallest = sizes.length ? Math.min(...sizes) : null;
  const notes = panels.flatMap((p) => p.notes.map((n) => `${p.letter ? `Panel ${p.letter}` : 'A panel'}: ${n}`));
  return { marks, panels, description: describeFigure(fig, panels), notes, smallest };
}

export function describeFigure(fig, panels) {
  const parts = panels.map((p) => `${p.letter ? `Panel ${p.letter}` : 'A panel'}: ${p.description}`);
  return `${fig.name}, ${toMM(fig.width)} × ${toMM(fig.height)} mm, ${panels.length} panel${panels.length === 1 ? '' : 's'}.${parts.length ? ` ${parts.join(' ')}` : ''}`;
}

// The figure as SVG text (its description in <desc>). options: { metadata }.
export async function figureSVG(fig, resolved, options = {}) {
  const drawn = figureMarks(fig, resolved);
  return marksToSVG(drawn.marks, fig.width, fig.height, { title: fig.name, desc: drawn.description, metadata: options.metadata });
}

// The figure as a one-page PDF (vector; text in Helvetica). options: { date (required: the same
// figure, the same bytes), attachments }.
export async function figurePDF(fig, resolved, options = {}) {
  const drawn = figureMarks(fig, resolved);
  return writePDF([pdfPage(drawn.marks, fig.width, fig.height)], { title: fig.name, subject: drawn.description, date: options.date, attachments: options.attachments ?? [] });
}

// The pixel size of a figure's PNG at a resolution (dots per inch of its printed size).
export function pngSize(fig, dpi = 300) {
  return { width: Math.round((fig.width / 72) * dpi), height: Math.round((fig.height / 72) * dpi), scale: dpi / 72 };
}

export { FONT, mapTitle, toMM };
