// Pictures as data (wave 7, slice 3): an SVG drawn as a PNG, and a file's bytes as a data URL, for
// the actions that give an agent or a script a picture (render_map, render_structure, figures). The
// MCP server sends a data URL to an agent as an image (mcp.go); a script reads it as text.

import { h } from './dom.js';

// The SVG drawn at scale times its size: { blob, width, height } (a PNG).
export async function svgToPNG(svg, scale = 3) {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('The picture could not be drawn.'));
      img.src = url;
    });
    const width = Math.round(img.width * scale);
    const height = Math.round(img.height * scale);
    const canvas = h('canvas', { width, height });
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    return { blob, width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Bytes (a Uint8Array or a Blob) as a data URL of their type.
export async function dataURL(bytes, type = 'image/png') {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(await bytes.arrayBuffer());
  let text = '';
  for (let at = 0; at < data.length; at += 0x8000) text += String.fromCharCode(...data.subarray(at, at + 0x8000));
  return `data:${type};base64,${btoa(text)}`;
}
