// Selections for the validation suite `selections` (wave 4, slice 5): an independent account of a
// run's map, cell by cell, from the run's own arrays (not the map model, not the query engine), for
// checking queries against; and the cells a circle or a rectangle drawn on the map holds.

import { STAGE_BY_ID } from '../web/lib/filters.js';
import { targetProtein } from '../web/lib/target.js';

const THREE = { A: 'Ala', R: 'Arg', N: 'Asn', D: 'Asp', C: 'Cys', Q: 'Gln', E: 'Glu', G: 'Gly', H: 'His', I: 'Ile', L: 'Leu', K: 'Lys', M: 'Met', F: 'Phe', P: 'Pro', S: 'Ser', T: 'Thr', W: 'Trp', Y: 'Tyr', V: 'Val', '*': 'Ter' };
// In variants.js's order, the order a query lists its variants in at each position.
const ORDER = 'ARNDCQEGHILKMFPSTWYV*';

// Every substitution of a run's (protein) target with what a query can say of it: [{ name, p, ref,
// aa, kind, row, state, score, se, k, input }], position by position, in ORDER. A target without
// tiles: every position designed.
export function mapCells(results, design, condition = 0) {
  const target = design.targets[0];
  const protein = targetProtein(target);
  const rowOf = new Map(results.variants.key.map((k, i) => [k, i]));
  const c = results.conditions[condition];
  const measured = STAGE_BY_ID.get('measured').code;
  const cells = [];
  for (let p = 1; p <= protein.length; p += 1) {
    const ref = protein[p - 1];
    if (ref === '*') continue;
    for (const aa of ORDER) {
      const name = aa === ref ? `p.${THREE[ref]}${p}=` : `p.${THREE[ref]}${p}${THREE[aa]}`;
      const row = rowOf.get(name) ?? -1;
      const kind = aa === ref ? 'synonymous' : aa === '*' ? 'nonsense' : p === 1 && ref === 'M' ? 'start-lost' : 'missense';
      let state = 'scored';
      if (row < 0 || c.reason[row] === measured) state = 'missing';
      else if (c.reason[row]) state = 'filtered';
      else if (c.flags[row]) state = 'low';
      const scored = state === 'scored' || state === 'low';
      let input = Number.NaN;
      if (row >= 0) {
        let sum = 0;
        let n = 0;
        for (const rep of results.replicates) {
          if (!c.replicates.includes(rep.id) || rep.state[row] !== 0) continue;
          sum += rep.first[row];
          n += 1;
        }
        if (n) input = sum / n;
      }
      cells.push({ name, p, ref, aa, kind, row, state, scored, score: scored ? c.score[row] : Number.NaN, se: scored ? c.se[row] : Number.NaN, k: scored ? c.k[row] : Number.NaN, input });
    }
  }
  return cells;
}

// The cells whose centers lie within r of (x, y), and those clearly beyond it, on a map's geometry
// (map-render.js's geometry: cell p's center at left + (p − x0 + ½)·cellW, row r's at top + (r + ½)·
// cellH): { inside: [cell index], outside: Set, ambiguous } with a margin of half a pixel.
export function circleCells(model, view, g, cx, cy, radius) {
  const R = model.rows.length;
  const inside = [];
  const outside = new Set();
  let ambiguous = 0;
  for (let p = 1; p <= model.length; p += 1) {
    const x = g.left + (p - view.x0 + 0.5) * view.cellW;
    if (x < g.left || x > g.left + g.gridW) continue;
    for (let r = 0; r < R; r += 1) {
      const k = (p - 1) * R + r;
      if (model.state[k] === 0) continue;
      const y = g.top + (r + 0.5) * view.cellH;
      const d = Math.hypot(x - cx, y - cy);
      if (d < radius - 0.5) inside.push(k);
      else if (d > radius + 0.5) outside.add(k);
      else ambiguous += 1;
    }
  }
  return { inside, outside, ambiguous };
}

// A regular polygon of n corners on a circle.
export function circle(cx, cy, radius, n = 96) {
  return Array.from({ length: n }, (_, i) => [cx + radius * Math.cos((2 * Math.PI * i) / n), cy + radius * Math.sin((2 * Math.PI * i) / n)]);
}
