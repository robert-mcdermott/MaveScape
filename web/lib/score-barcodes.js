// Barcodes (requirements D8, S8, Q8). A barcode table has one row per barcode, each naming the
// variant it carries (from a barcode-to-variant map applied at import, barcodes.js); many barcodes
// carry one variant. A run scores it in either of two ways:
//
// - sum, then score ('sum'): each sample's counts of a variant's barcodes summed, and the variant
//   scored from the sums as in a table of variants (Enrich2's barcode-variant libraries;
//   dms_variants' func_scores by substitution);
// - score each barcode, then combine ('barcode'): each barcode scored on its own against its
//   replicate's normalizers, which come from the summed counts (the wild type's barcodes summed,
//   as dms_variants' func_scores by barcode), and a variant's barcodes combined within the
//   replicate by REML, fixed effects or their mean.
//
// Either way every barcode is scored, for quality control: how far it departs from the variant's
// other barcodes (z: leave-one-out, against their fixed-effect mean, in units of its SE and theirs
// together), and how much more the barcodes of one variant disagree than counting explains (φ, the
// median z² over the median of χ²₁: robust to the outliers it is used to find). z/√φ beyond 4 (or
// the barcode filter's maximum) marks an outlier, left out of the sum or the combination when the
// filter is on.

import { buildVariants, sameVariantKey, selectVariants } from './variants.js';
import { combine } from './replicates.js';
import { median } from './score-ratio.js';
import { MEDIAN_CHI2_1 } from './stats.js';

export const AGGREGATIONS = {
  sum: 'sum each variant\'s barcodes, then score',
  barcode: 'score each barcode, then combine',
};
export const BARCODE_COMBINATIONS = {
  reml: 'REML random effects',
  fixed: 'fixed effects (inverse variance)',
  mean: 'their mean, SE their SD over √k',
};

// The departure (z/√φ) beyond which a barcode is an outlier, unless the barcode filter sets another.
export const OUTLIER_Z = 4;
const BLANK = new Set(['', 'NA', 'N/A', 'NaN', 'null', 'None']);

// Groups a barcode table's rows by variant. names: each row's variant as written. Names are the
// same variant when their MAVE-HGVS keys are (A12V and p.Ala12Val), else when written alike; a
// blank name is an unmapped barcode. options: buildVariants's. ids: the barcodes, by which each
// variant's are ordered (so that a combination adds them in the same order however the table's
// rows are). Returns { variants (one row per variant, named as first written), variantOf
// (Int32Array: row → variant, −1 unmapped), offsets (Int32Array, nv + 1) and members (Int32Array:
// each variant's rows), unmapped (rows), rewritten (variants written more than one way) }.
export function groupBarcodes(names, options = {}, ids = null) {
  const n = names.length;
  const written = [];
  const writtenIndex = new Map();
  const writtenOf = new Int32Array(n);
  let unmapped = 0;
  for (let r = 0; r < n; r += 1) {
    const name = names[r];
    if (BLANK.has(String(name ?? '').trim())) {
      writtenOf[r] = -1;
      unmapped += 1;
      continue;
    }
    let w = writtenIndex.get(name);
    if (w === undefined) {
      w = written.length;
      writtenIndex.set(name, w);
      written.push(name);
    }
    writtenOf[r] = w;
  }
  const parsed = buildVariants(written, options);
  const groupOf = new Int32Array(written.length);
  const byKey = new Map();
  const firsts = [];
  const forms = [];
  for (let w = 0; w < written.length; w += 1) {
    const key = parsed.key[w] ? sameVariantKey(parsed.key[w]) : `\u0000${written[w]}`;
    let g = byKey.get(key);
    if (g === undefined) {
      g = firsts.length;
      byKey.set(key, g);
      firsts.push(w);
      forms.push(1);
    } else forms[g] += 1;
    groupOf[w] = g;
  }
  const nv = firsts.length;
  const variantOf = new Int32Array(n);
  const offsets = new Int32Array(nv + 1);
  for (let r = 0; r < n; r += 1) {
    variantOf[r] = writtenOf[r] < 0 ? -1 : groupOf[writtenOf[r]];
    if (variantOf[r] >= 0) offsets[variantOf[r] + 1] += 1;
  }
  for (let g = 0; g < nv; g += 1) offsets[g + 1] += offsets[g];
  const members = new Int32Array(n - unmapped);
  const next = offsets.slice(0, nv);
  for (let r = 0; r < n; r += 1) if (variantOf[r] >= 0) members[next[variantOf[r]]++] = r;
  if (ids) {
    for (let g = 0; g < nv; g += 1) {
      if (offsets[g + 1] - offsets[g] < 2) continue;
      const segment = Array.from(members.subarray(offsets[g], offsets[g + 1])).sort((a, b) => (ids[a] < ids[b] ? -1 : ids[a] > ids[b] ? 1 : 0));
      members.set(segment, offsets[g]);
    }
  }
  return { variants: selectVariants(parsed, firsts), variantOf, offsets, members, rows: n, unmapped, rewritten: forms.filter((x) => x > 1).length };
}

// Barcode identifiers on more than one row, or missing: [{ id, rows }] and the rows with none.
export function barcodeProblems(ids) {
  const seen = new Map();
  const repeated = new Map();
  const blank = [];
  for (let r = 0; r < ids.length; r += 1) {
    const id = String(ids[r] ?? '').trim();
    if (!id || BLANK.has(id)) {
      blank.push(r);
      continue;
    }
    const first = seen.get(id);
    if (first === undefined) seen.set(id, r);
    else {
      if (!repeated.has(id)) repeated.set(id, [first]);
      repeated.get(id).push(r);
    }
  }
  return { repeated: [...repeated].map(([id, rows]) => ({ id, rows })), blank };
}

// A sample's counts summed over each variant's barcodes: NaN for a variant none of whose barcodes
// is counted in it (missing is never read as 0), the barcodes `skip` marks left out.
export function sumByVariant(counts, groups, skip = null) {
  const nv = groups.offsets.length - 1;
  const out = new Float64Array(nv);
  for (let g = 0; g < nv; g += 1) {
    let sum = 0;
    let any = false;
    for (let m = groups.offsets[g]; m < groups.offsets[g + 1]; m += 1) {
      const r = groups.members[m];
      const c = counts[r];
      if (Number.isNaN(c) || (skip && skip[r])) continue;
      sum += c;
      any = true;
    }
    out[g] = any ? sum : Number.NaN;
  }
  return out;
}

// How far each barcode departs from its variant's other barcodes, in one replicate. score, se: the
// barcodes' (by row); use: 1 where a barcode is scored; limit: the departure (z/√φ) beyond which a
// barcode is an outlier. φ comes first, from every barcode of a variant of two or more against the
// others; then in each variant of three or more the barcode departing most, when beyond the limit,
// is an outlier, set aside, and the rest compared again without it (one at a time, so that one
// outlier does not make its variant's other barcodes look off). Returns { z (Float64Array by row,
// over √φ: NaN where its variant has fewer than three barcodes scored), outlier (Uint8Array),
// outliers, phi (at least 1; NaN with nothing to compare), compared }.
export function barcodeDisagreement(score, se, use, groups, limit = OUTLIER_Z) {
  const nb = score.length;
  const z = new Float64Array(nb).fill(Number.NaN);
  const outlier = new Uint8Array(nb);
  const squares = [];
  const nv = groups.offsets.length - 1;
  const rows = [];
  // Leave-one-out departures of `rows` (those not set aside), into `into` (as given, not over √φ).
  const departures = (into) => {
    let sw = 0;
    let swy = 0;
    for (const r of rows) {
      const w = 1 / (se[r] * se[r]);
      sw += w;
      swy += w * score[r];
    }
    for (const r of rows) {
      const w = 1 / (se[r] * se[r]);
      into(r, (score[r] - (swy - w * score[r]) / (sw - w)) / Math.sqrt(se[r] * se[r] + 1 / (sw - w)));
    }
  };
  const membersOf = (g) => {
    rows.length = 0;
    for (let m = groups.offsets[g]; m < groups.offsets[g + 1]; m += 1) if (use[groups.members[m]]) rows.push(groups.members[m]);
  };
  for (let g = 0; g < nv; g += 1) {
    membersOf(g);
    if (rows.length >= 2) departures((r, value) => squares.push(value * value));
  }
  const phi = squares.length ? Math.max(1, median(squares) / MEDIAN_CHI2_1) : Number.NaN;
  const scale = Number.isFinite(phi) ? Math.sqrt(phi) : 1;
  let outliers = 0;
  for (let g = 0; g < nv; g += 1) {
    membersOf(g);
    while (rows.length >= 3) {
      let worst = -1;
      departures((r, value) => {
        z[r] = value / scale;
        if (worst < 0 || Math.abs(z[r]) > Math.abs(z[worst])) worst = r;
      });
      if (!(Math.abs(z[worst]) > limit)) break;
      outlier[worst] = 1;
      outliers += 1;
      rows.splice(rows.indexOf(worst), 1);
      // Two left: compared with each other alone, neither is the one off.
      if (rows.length < 3) for (const r of rows) z[r] = Number.NaN;
    }
  }
  return { z, outlier, outliers, phi, compared: squares.length };
}

// Each variant's barcodes combined within a replicate (method: 'reml', 'fixed' or 'mean'), those
// `use` marks. Returns { score, se, tau2, k (barcodes combined) } by variant; NaN with none.
export function combineBarcodes(method, score, se, use, groups) {
  const nv = groups.offsets.length - 1;
  const out = { score: new Float64Array(nv).fill(Number.NaN), se: new Float64Array(nv).fill(Number.NaN), tau2: new Float64Array(nv).fill(Number.NaN), k: new Int32Array(nv) };
  const y = [];
  const v = [];
  for (let g = 0; g < nv; g += 1) {
    y.length = 0;
    v.length = 0;
    for (let m = groups.offsets[g]; m < groups.offsets[g + 1]; m += 1) {
      const r = groups.members[m];
      if (!use[r]) continue;
      y.push(score[r]);
      v.push(se[r] * se[r]);
    }
    out.k[g] = y.length;
    if (!y.length) continue;
    const c = combine(method, y, v);
    out.score[g] = c.estimate;
    out.se[g] = c.se;
    out.tau2[g] = c.tau2;
  }
  return out;
}
