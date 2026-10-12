// Draws sequence tracks (tracks.js) under the variant-effect map (wave 3, slice 5): the same shapes
// for the window's canvas (map-render.js) and the SVG export (map-svg.js), so a figure shows what
// the window does. Pure: trackShapes lays out rectangles, paths and text; paintShapes draws them on
// a 2D context, shapesSVG writes them as SVG.
//
// Each kind its own way: the reference's letters (where a cell is wide enough for one); values as
// bars from a baseline (a diverging track, the position effect, up or down from its center in the
// map's colors); features as boxes in lanes (a helix, a strand's arrow, a turn); variants as each
// position's classes stacked (ClinVar's, AlphaMissense's), or its value as a bar (on a log scale for
// an allele frequency). Every track's name is in the gutter at the left.

import { TRACK_HEIGHT } from './tracks.js';

export const TRACK_GAP = 4;

// The vertical layout of the shown tracks from top: [{ track, y, height }] and the bottom.
export function layoutTracks(tracks, top) {
  let y = top + TRACK_GAP;
  const rows = [];
  for (const track of tracks) {
    const height = TRACK_HEIGHT[track.kind] ?? 16;
    rows.push({ track, y, height });
    y += height + TRACK_GAP;
  }
  return { rows, bottom: y };
}

// The tracks' total height (0 without any).
export function tracksHeight(tracks) {
  return tracks.length ? layoutTracks(tracks, 0).bottom : 0;
}

const clamp01 = (t) => Math.max(0, Math.min(1, t));

// A value's place from 0 to 1 on a track's scale (NaN without one).
export function trackPosition(track, x) {
  if (!Number.isFinite(x)) return Number.NaN;
  const d = track.domain ?? { min: 0, max: 1 };
  if (track.scale === 'log') {
    const lo = Math.log10(d.min);
    const hi = Math.log10(d.max);
    return x > 0 ? clamp01((Math.log10(x) - lo) / (hi - lo)) : 0;
  }
  if (d.kind === 'diverging') return clamp01(0.5 + (x - d.center) / (2 * Math.max(1e-12, d.max - d.center)));
  return clamp01((x - d.min) / Math.max(1e-12, d.max - d.min));
}

// Features in lanes: none overlapping another in its lane; at most three lanes.
function lanesOf(features) {
  const ends = [];
  const out = [];
  for (const f of features.slice().sort((a, b) => a.start - b.start || b.end - a.end)) {
    let lane = ends.findIndex((end) => end < f.start);
    if (lane < 0) lane = ends.length < 3 ? ends.length : 2;
    ends[lane] = Math.max(ends[lane] ?? 0, f.end);
    out.push([f, lane]);
  }
  return { placed: out, lanes: Math.max(1, ends.length) };
}

const STRUCTURE = { Helix: 'helix', 'Beta strand': 'strand', Turn: 'turn' };

// The shapes of the shown tracks. frame: { left (the grid's left edge), gridW, cellW, x0 (the
// first position shown, may be fractional), first, last (whole positions shown), top, gutter (the
// width of the names' gutter) }. theme: colors by name, with theme.track: { bar, feature, onFeature,
// helix, strand, turn, pathogenic, conflicting, uncertain, benign, other }. color(t): the map's
// colors, for a diverging track. Returns [{ type: 'rect' | 'path' | 'text', … }].
export function trackShapes(tracks, frame, theme, color) {
  const shapes = [];
  const { left, cellW, first, last } = frame;
  const xOf = (p) => left + (p - frame.x0) * cellW;
  const inset = cellW >= 5 ? 1 : 0;
  const w = Math.max(1, cellW - inset);
  const T = theme.track;
  const { rows } = layoutTracks(tracks, frame.top);
  const chars = Math.max(4, Math.floor((frame.gutter - 10) / 5.4));
  for (const { track, y, height } of rows) {
    const name = track.label.length > chars ? `${track.label.slice(0, chars - 1)}…` : track.label;
    shapes.push({ type: 'text', x: left - 6, y: y + height / 2 + 3.5, text: name, fill: theme.muted, size: 10, anchor: 'end', title: track.label });
    shapes.push({ type: 'rect', x: left, y: y + height - 0.5, w: frame.gridW, h: 0.5, fill: theme.line, clip: true });
    if (track.kind === 'sequence') {
      if (cellW >= 7) {
        for (let p = first; p <= last; p += 1) shapes.push({ type: 'text', x: xOf(p) + w / 2, y: y + height / 2 + 4, text: track.residues[p - 1] ?? '', fill: theme.text, size: Math.min(11, cellW), anchor: 'middle', mono: true, clip: true });
      } else {
        shapes.push({ type: 'rect', x: left, y: y + height / 2, w: frame.gridW, h: 1, fill: theme.line, clip: true });
      }
    } else if (track.kind === 'values' || (track.kind === 'variants' && !track.stacks)) {
      const diverging = track.domain?.kind === 'diverging' && track.kind === 'values';
      const mid = y + height / 2;
      if (diverging) shapes.push({ type: 'rect', x: left, y: mid, w: frame.gridW, h: 0.5, fill: theme.line, clip: true });
      for (let p = first; p <= last; p += 1) {
        const t = trackPosition(track, track.values[p - 1]);
        if (!Number.isFinite(t)) continue;
        if (diverging) {
          const h = Math.abs(t - 0.5) * (height - 2);
          shapes.push({ type: 'rect', x: xOf(p), y: t >= 0.5 ? mid - h : mid, w, h: Math.max(0.5, h), fill: color(t), clip: true });
        } else {
          const h = Math.max(1, t * (height - 2));
          shapes.push({ type: 'rect', x: xOf(p), y: y + height - 1 - h, w, h, fill: T.bar, clip: true });
        }
      }
    } else if (track.kind === 'variants') {
      let most = 0;
      for (const s of track.stacks) if (s) most = Math.max(most, s.reduce((a, x) => a + x.n, 0));
      const token = Object.fromEntries((track.classes ?? []).map((k) => [k.id, k.token]));
      for (let p = first; p <= last; p += 1) {
        const stack = track.stacks[p - 1];
        if (!stack) continue;
        let base = y + height - 1;
        for (const { cls, n } of stack) {
          const h = Math.max(1.5, (n / most) * (height - 2));
          shapes.push({ type: 'rect', x: xOf(p), y: base - h, w, h, fill: T[token[cls]] ?? T.other, clip: true });
          base -= h;
        }
      }
    } else if (track.kind === 'features') {
      const { placed, lanes } = lanesOf(track.features.filter((f) => f.end >= first && f.start <= last));
      const laneH = (height - 2) / lanes;
      for (const [f, lane] of placed) {
        const x = xOf(f.start);
        const width = (f.end - f.start + 1) * cellW - inset;
        const top = y + 1 + lane * laneH;
        const kind = STRUCTURE[f.type];
        if (kind === 'strand' && width > 6) {
          const tip = Math.min(6, width / 3);
          const a = top + laneH * 0.2;
          const b = top + laneH * 0.8;
          shapes.push({ type: 'path', d: `M${x} ${a}H${x + width - tip}V${top}L${x + width} ${top + laneH / 2}L${x + width - tip} ${top + laneH}V${b}H${x}Z`, fill: T.strand, clip: true, title: `${f.label} ${f.start}–${f.end}` });
        } else if (kind === 'turn') {
          shapes.push({ type: 'rect', x, y: top + laneH * 0.35, w: Math.max(1, width), h: laneH * 0.3, fill: T.turn, clip: true, title: `${f.label} ${f.start}–${f.end}` });
        } else {
          // A feature may carry its own color (a structural class: wave 5, slice 4).
          const fill = f.fill ?? (kind ? T[kind] : T.feature);
          shapes.push({ type: 'rect', x, y: top + 0.5, w: Math.max(1, width), h: Math.max(1, laneH - 1), fill, radius: kind === 'helix' ? Math.min(3, laneH / 2) : 1.5, clip: true, title: `${f.label}${f.label === f.type ? '' : ` (${f.type})`} ${f.start}–${f.end}` });
          const room = Math.floor((Math.min(xOf(f.end + 1), left + frame.gridW) - Math.max(x, left) - 4) / 5.6);
          if (!kind && room >= 3 && laneH >= 9) {
            const text = f.label.length > room ? `${f.label.slice(0, room - 1)}…` : f.label;
            shapes.push({ type: 'text', x: Math.max(x, left) + 3, y: top + laneH / 2 + 3, text, fill: T.onFeature, size: Math.min(9, laneH - 2), anchor: 'start', clip: true });
          }
        }
      }
    }
  }
  return shapes;
}

// Draws shapes on a 2D context: those marked clip within the grid's columns (clip: { x, y, w, h }),
// in one clipped pass.
export function paintShapes(ctx, shapes, clip) {
  const paint = (s) => {
    ctx.fillStyle = s.fill;
    if (s.type === 'rect') {
      if (s.radius && ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(s.x, s.y, s.w, s.h, s.radius);
        ctx.fill();
      } else {
        ctx.fillRect(s.x, s.y, s.w, s.h);
      }
    } else if (s.type === 'path') {
      if (typeof Path2D === 'function') ctx.fill(new Path2D(s.d));
    } else if (s.type === 'text') {
      ctx.font = `${s.size}px ${s.mono ? 'ui-monospace, monospace' : 'system-ui, sans-serif'}`;
      ctx.textAlign = s.anchor === 'end' ? 'right' : s.anchor === 'middle' ? 'center' : 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(s.text, s.x, s.y);
    }
  };
  for (const s of shapes) if (!s.clip || !clip) paint(s);
  if (!clip) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(clip.x, clip.y, clip.w, clip.h);
  ctx.clip();
  for (const s of shapes) if (s.clip) paint(s);
  ctx.restore();
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (x) => (Number.isInteger(x) ? String(x) : x.toFixed(2).replace(/\.?0+$/, ''));

// The shapes as SVG elements (clipped ones inside a clip path the caller defines as clipId).
export function shapesSVG(shapes, clipId = null) {
  const inside = [];
  const outside = [];
  for (const s of shapes) {
    let el = '';
    const title = s.title ? `<title>${esc(s.title)}</title>` : '';
    if (s.type === 'rect') el = `<rect x="${num(s.x)}" y="${num(s.y)}" width="${num(s.w)}" height="${num(s.h)}"${s.radius ? ` rx="${num(s.radius)}"` : ''} fill="${s.fill}">${title}</rect>`;
    else if (s.type === 'path') el = `<path d="${s.d.replace(/-?\d+\.\d+/g, (m) => num(Number(m)))}" fill="${s.fill}">${title}</path>`;
    else el = `<text x="${num(s.x)}" y="${num(s.y)}" font-size="${s.size}"${s.mono ? ' font-family="Menlo, monospace"' : ''} text-anchor="${s.anchor}" fill="${s.fill}">${esc(s.text)}${title}</text>`;
    (s.clip && clipId ? inside : outside).push(el);
  }
  return [...outside, ...(inside.length ? [`<g clip-path="url(#${clipId})">`, ...inside, '</g>'] : [])].join('\n');
}
