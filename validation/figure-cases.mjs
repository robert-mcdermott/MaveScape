// Figures for the validation suite `figures` (wave 6, slice 1): what a figure's SVG and PDF draw,
// read back without MaveScape's drawing code. The SVG's rectangles with their fills and its text,
// each cell's fill by its title; the PDF's content streams inflated and read operator by operator
// (rectangles filled, with their color; text shown), so that the two can be compared mark for mark.

import { inflateSync } from 'node:zlib';
import { winAnsi } from '../web/lib/pdf.js';

const unescapeXML = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const attr = (tag, name) => tag.match(new RegExp(` ${name}="([^"]*)"`))?.[1] ?? null;

// The SVG's filled rectangles in drawing order ({ x, y, w, h, fill }; a hatch as its base color;
// outlines, clip paths and patterns' own rectangles left out), its text in order, and each titled
// cell's fill (Map title → fill).
export function readSVG(svg) {
  const patterns = new Map([...svg.matchAll(/<pattern id="([^"]+)"[^>]*><rect [^>]*fill="([^"]+)"/g)].map((m) => [m[1], m[2]]));
  const body = svg.replace(/<defs>[\s\S]*?<\/defs>/g, '');
  const rects = [];
  const cells = new Map();
  for (const m of body.matchAll(/<rect ([^>]*?)\/?>(?:<title>([^<]*)<\/title><\/rect>)?/g)) {
    const tag = ` ${m[1]}`;
    let fill = attr(tag, 'fill');
    const url = fill?.match(/^url\(#(.+)\)$/);
    if (url) fill = patterns.get(url[1]) ?? null;
    // A rounded rectangle is a path in the PDF, not a rectangle.
    if (!fill || fill === 'none' || attr(tag, 'rx')) continue;
    const rect = { x: Number(attr(tag, 'x') ?? 0), y: Number(attr(tag, 'y') ?? 0), w: Number(attr(tag, 'width')), h: Number(attr(tag, 'height')), fill: fill.toLowerCase() };
    rects.push(rect);
    if (m[2] !== undefined) cells.set(unescapeXML(m[2]), url ? 'hatch' : rect.fill);
  }
  // Empty text draws nothing, and the PDF writes none.
  const texts = [...body.matchAll(/<text [^>]*>([^<]*)/g)].map((m) => unescapeXML(m[1])).filter(Boolean);
  return { rects, texts, cells };
}

const hex = (r, g, b) => `#${[r, g, b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`;

function pdfString(s) {
  // A literal string's bytes: escapes \( \) \\ and octal \ddd.
  const bytes = [];
  for (let i = 1; i < s.length - 1; i += 1) {
    const c = s[i];
    if (c !== '\\') {
      bytes.push(c.charCodeAt(0));
      continue;
    }
    const next = s[i + 1];
    if (/[0-7]/.test(next)) {
      const oct = s.slice(i + 1, i + 4).match(/^[0-7]{1,3}/)[0];
      bytes.push(Number.parseInt(oct, 8));
      i += oct.length;
    } else {
      bytes.push(next.charCodeAt(0));
      i += 1;
    }
  }
  return bytes;
}

// The PDF's page size (points), its filled rectangles in drawing order ({ x, y, w, h, fill }, y
// from the top as the SVG's) and its text (each string's WinAnsi bytes), from its content streams.
export function readPDF(bytes) {
  const text = Buffer.from(bytes).toString('latin1');
  const box = text.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/);
  const height = Number(box[2]);
  const rects = [];
  const strings = [];
  for (const m of text.matchAll(/<< \/Filter \/FlateDecode \/Length (\d+) >>\nstream\n/g)) {
    const start = m.index + m[0].length;
    const ops = inflateSync(Buffer.from(bytes.subarray(start, start + Number(m[1])))).toString('latin1');
    const tokens = ops.match(/\((?:\\.|[^\\)])*\)|\[[^\]]*\]|\/?[^\s()[\]]+/g) ?? [];
    const stack = [];
    let fill = null;
    let pending = [];
    for (const t of tokens) {
      if (/^-?[\d.]+$/.test(t)) {
        stack.push(Number(t));
        continue;
      }
      if (t === 'rg') fill = hex(...stack.slice(-3));
      else if (t === 're') {
        const [x, y, w, h] = stack.slice(-4);
        pending.push({ x, y: height - y - h, w, h });
      } else if (t === 'f' || t === 'B') {
        for (const r of pending) rects.push({ ...r, fill });
        pending = [];
      } else if (t === 'S' || t === 'n' || t === 'W') {
        if (t !== 'W') pending = [];
      } else if (t === 'm' || t === 'c' || t === 'l') {
        // A path of lines and curves (a hatch's lines, a triangle) is not a rectangle.
        if (t === 'm') pending = [];
      } else if (t === 'Tj') {
        const last = strings.length && strings.at(-1).open ? strings.at(-1) : null;
        const s = pdfString(stack.literal);
        if (last) last.bytes.push(...s);
        else strings.push({ bytes: s, open: true });
      } else if (t === 'ET') {
        if (strings.length) strings.at(-1).open = false;
      }
      if (t.startsWith('(')) stack.literal = t;
      else if (!/^-?[\d.]+$/.test(t)) stack.length = 0;
    }
  }
  return { width: Number(box[1]), height, rects, texts: strings.map((s) => s.bytes) };
}

// Two lists of rectangles the same, mark for mark: the same color, places within tol points.
export function sameRects(a, b, tol = 0.006) {
  if (a.length !== b.length) return { ok: false, why: `${a.length} rectangles against ${b.length}` };
  for (let i = 0; i < a.length; i += 1) {
    const p = a[i];
    const q = b[i];
    if (p.fill !== q.fill || ['x', 'y', 'w', 'h'].some((k) => Math.abs(p[k] - q[k]) > tol)) return { ok: false, why: `rectangle ${i}: ${JSON.stringify(p)} against ${JSON.stringify(q)}` };
  }
  return { ok: true, why: `${a.length} rectangles` };
}

// The SVG's text as the PDF writes it (WinAnsi; characters outside it as their nearest ASCII), to
// compare with readPDF's.
export function asPDFText(texts) {
  return texts.map((t) => winAnsi(t));
}

// A PNG's pixels (8-bit RGBA or RGB, not interlaced, as browsers and lib/png.js write them):
// { width, height, rgba }. Its IDAT inflated with zlib and each row unfiltered (PNG's five filters).
export function decodePNG(bytes) {
  const b = Buffer.from(bytes);
  if (b.toString('latin1', 1, 4) !== 'PNG') throw new Error('Not a PNG.');
  let at = 8;
  let width = 0;
  let height = 0;
  let channels = 4;
  const idat = [];
  while (at < b.length) {
    const length = b.readUInt32BE(at);
    const type = b.toString('latin1', at + 4, at + 8);
    const data = b.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) throw new Error('Only 8-bit, non-interlaced PNGs.');
      channels = data[9] === 6 ? 4 : data[9] === 2 ? 3 : 0;
      if (!channels) throw new Error('Only RGB and RGBA PNGs.');
    } else if (type === 'IDAT') idat.push(data);
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(height * stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? out[y * stride + x - channels] : 0;
      const up = y ? out[(y - 1) * stride + x] : 0;
      const c = y && x >= channels ? out[(y - 1) * stride + x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += up;
      else if (filter === 3) v += Math.floor((a + up) / 2);
      else if (filter === 4) {
        const p = a + up - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c;
      }
      out[y * stride + x] = v & 255;
    }
  }
  if (channels === 4) return { width, height, rgba: out };
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    rgba[i * 4] = out[i * 3];
    rgba[i * 4 + 1] = out[i * 3 + 1];
    rgba[i * 4 + 2] = out[i * 3 + 2];
    rgba[i * 4 + 3] = 255;
  }
  return { width, height, rgba };
}
