// The variant-effect map as SVG (requirement R3): the whole target at a fixed cell size, every
// state drawn its own way (the same encoding as the window's), the position and row summaries,
// target and reference numbering, a color bar and a key to the states, with the map's text
// description as the SVG's <desc>. Deterministic text for the same model (the validation suite
// `map` compares it with a golden file), on a light background for figures.

import { STATE, STATE_NAMES, colorPosition, describeMap } from './map-model.js';
import { mapPalette } from './map-render.js';

// The light theme's map colors (web/styles.css, --map-*), for figures.
export const EXPORT_THEME = {
  background: '#ffffff', empty: '#c8c6c2', hatch: '#6e6c68', dot: '#6e6c68', mark: '#171b26', text: '#171b26', muted: '#4b5468', line: '#d0d6e2', accent: '#5b4ce6', gray: [110, 110, 110],
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (x) => (Number.isInteger(x) ? String(x) : x.toFixed(2).replace(/\.?0+$/, ''));

function tickStep(cellW) {
  const want = 40 / cellW;
  for (const s of [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000]) if (s >= want) return s;
  return 10000;
}

// options: { cellW, cellH, palette, title, results (for the description) }.
export function mapSVG(model, options = {}) {
  const cellW = options.cellW ?? 8;
  const cellH = options.cellH ?? 10;
  const theme = EXPORT_THEME;
  const { color, paler } = mapPalette(model, options.palette ?? 'rdbu', theme.gray);
  const R = model.rows.length;
  const left = 34;
  const titleH = 22;
  const track = 12;
  const axis = 14;
  const top = titleH + track + axis + 4;
  const gridW = model.length * cellW;
  const gridH = R * cellH;
  const refAxis = model.target.offset ? 14 : 0;
  const legendTop = top + gridH + refAxis + 12;
  const width = left + gridW + 30;
  const height = legendTop + 44;
  const w = cellW - 1;
  const h = cellH - 1;
  const out = [];
  const title = options.title ?? `${model.target.name}${model.condition.name && model.condition.id !== 'all' ? ` · ${model.condition.name}` : ''}`;
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Helvetica, Arial, sans-serif" role="img">`);
  out.push(`<title>${esc(`Variant-effect map: ${title}`)}</title>`);
  if (options.results) out.push(`<desc>${esc(describeMap(model, options.results).join(' '))}</desc>`);
  out.push(`<defs><pattern id="hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4" height="4" fill="${theme.empty}"/><line x1="0" y1="0" x2="0" y2="4" stroke="${theme.hatch}" stroke-width="1.2"/></pattern></defs>`);
  out.push(`<rect width="${width}" height="${height}" fill="${theme.background}"/>`);
  out.push(`<text x="${left}" y="15" font-size="12" font-weight="bold" fill="${theme.text}">${esc(title)}</text>`);
  // Position medians.
  out.push('<g>');
  for (let p = 1; p <= model.length; p += 1) {
    const t = colorPosition(model, model.columnMedian[p - 1]);
    if (Number.isFinite(t) && model.domain.kind === 'diverging') out.push(`<rect x="${left + (p - 1) * cellW}" y="${titleH}" width="${w}" height="${track - 2}" fill="${color(t)}"/>`);
  }
  out.push('</g>');
  // Axes.
  const step = tickStep(cellW);
  out.push(`<g font-size="9" fill="${theme.muted}" text-anchor="middle">`);
  for (let p = step; p <= model.length; p += step) {
    out.push(`<text x="${n(left + (p - 1) * cellW + w / 2)}" y="${titleH + track + axis - 2}">${p}</text>`);
    if (model.target.offset) out.push(`<text x="${n(left + (p - 1) * cellW + w / 2)}" y="${top + gridH + refAxis - 3}">${p + model.target.offset}</text>`);
  }
  out.push('</g>');
  out.push(`<g font-size="${Math.min(10, cellH - 1)}" font-family="Menlo, monospace" fill="${theme.muted}" text-anchor="middle">`);
  for (let r = 0; r < R; r += 1) out.push(`<text x="${left / 2}" y="${n(top + r * cellH + h / 2 + 3)}">${esc(model.rows[r])}</text>`);
  out.push('</g>');
  // Cells.
  out.push('<g>');
  for (let p = 1; p <= model.length; p += 1) {
    const x = left + (p - 1) * cellW;
    for (let r = 0; r < R; r += 1) {
      const k = (p - 1) * R + r;
      const s = model.state[k];
      if (s === STATE.NOT_DESIGNED) continue;
      const y = top + r * cellH;
      const t = colorPosition(model, model.value[k]);
      const id = `${model.protein[p - 1]}${p}${model.rows[r]}`;
      if (s === STATE.SCORED && Number.isFinite(t)) out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${color(t)}"><title>${id}</title></rect>`);
      else if (s === STATE.LOW && Number.isFinite(t)) out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${paler(t)}"><title>${id} (low confidence)</title></rect><path d="M${n(x + w - Math.min(4, w / 2))} ${y}H${x + w}V${n(y + Math.min(4, h / 2))}Z" fill="${theme.mark}"/>`);
      else if (s === STATE.FILTERED) out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#hatch)"><title>${id} (filtered)</title></rect>`);
      else if (s === STATE.REFERENCE) out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${model.domain.kind === 'diverging' ? color(0.5) : theme.empty}"><title>${id} (reference)</title></rect>`);
      else out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${theme.empty}"><title>${id} (missing)</title></rect><rect x="${n(x + w / 2 - 1)}" y="${n(y + h / 2 - 1)}" width="2" height="2" fill="${theme.dot}"/>`);
      if (model.reference[k]) out.push(`<rect x="${n(x + 0.5)}" y="${n(y + 0.5)}" width="${w - 1}" height="${h - 1}" fill="none" stroke="${theme.text}" stroke-width="1"/>`);
    }
  }
  out.push('</g>');
  // Row medians.
  out.push('<g>');
  for (let r = 0; r < R; r += 1) {
    const t = colorPosition(model, model.rowMedian[r]);
    if (Number.isFinite(t) && model.domain.kind === 'diverging') out.push(`<rect x="${left + gridW + 8}" y="${top + r * cellH}" width="10" height="${h}" fill="${color(t)}"/>`);
  }
  out.push('</g>');
  // Legend: the color bar, then the states.
  const barW = 160;
  out.push(`<g font-size="9" fill="${theme.muted}">`);
  for (let i = 0; i < 32; i += 1) out.push(`<rect x="${n(left + (i * barW) / 32)}" y="${legendTop}" width="${n(barW / 32 + 0.3)}" height="10" fill="${color(i / 31)}"/>`);
  const d = model.domain;
  const label = model.contrast ? `differential score, ${model.contrast.name}` : model.domain.kind === 'diverging' ? (model.scale?.stated ? `score: lower, ${model.scale.low}; higher, ${model.scale.high}` : 'score') : model.colorBy === 'se' ? 'SE' : model.colorBy === 'replicates' ? 'replicates used' : 'log10 input count';
  out.push(`<text x="${left}" y="${legendTop + 22}">${n(Number(d.min.toFixed(2)))}</text>`);
  if (d.kind === 'diverging') out.push(`<text x="${left + barW / 2}" y="${legendTop + 22}" text-anchor="middle">${n(Number(d.center.toFixed(2)))} (${model.contrast ? 'no difference' : 'wild type'})</text>`);
  out.push(`<text x="${left + barW}" y="${legendTop + 22}" text-anchor="end">${n(Number(d.max.toFixed(2)))}</text>`);
  out.push(`<text x="${left}" y="${legendTop + 34}">${esc(label)}</text>`);
  let x = left + barW + 24;
  for (const s of [STATE.LOW, STATE.FILTERED, STATE.MISSING, STATE.REFERENCE]) {
    if (s === STATE.LOW) out.push(`<rect x="${x}" y="${legendTop}" width="${w}" height="${h}" fill="${paler(0.2)}"/><path d="M${n(x + w - 4)} ${legendTop}H${x + w}V${legendTop + 4}Z" fill="${theme.mark}"/>`);
    if (s === STATE.FILTERED) out.push(`<rect x="${x}" y="${legendTop}" width="${w}" height="${h}" fill="url(#hatch)"/>`);
    if (s === STATE.MISSING) out.push(`<rect x="${x}" y="${legendTop}" width="${w}" height="${h}" fill="${theme.empty}"/><rect x="${n(x + w / 2 - 1)}" y="${n(legendTop + h / 2 - 1)}" width="2" height="2" fill="${theme.dot}"/>`);
    if (s === STATE.REFERENCE) out.push(`<rect x="${n(x + 0.5)}" y="${legendTop + 0.5}" width="${w - 1}" height="${h - 1}" fill="${model.domain.kind === 'diverging' ? color(0.5) : theme.empty}" stroke="${theme.text}"/>`);
    out.push(`<text x="${x + w + 4}" y="${legendTop + 8}">${esc(STATE_NAMES[s])}</text>`);
    x += w + 10 + STATE_NAMES[s].length * 5;
  }
  out.push('</g>');
  out.push('</svg>');
  return `${out.join('\n')}\n`;
}
