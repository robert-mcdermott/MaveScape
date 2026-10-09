// The variant-effect map's model (requirement V2): a score run's single substitutions as a matrix
// of target positions × the 20 amino acids and stop, each cell with a value and a state. Pure; the
// map component (ui/variant-map.js), its renderer (map-render.js) and the SVG export (map-svg.js)
// draw from it.
//
// States are a channel of their own, never a color of the score scale (mavescape-spec/design.md,
// "The variant-effect map"): scored; low confidence (scored, with a flag); filtered (measured, its
// score NA with a reason); missing (designed but not measured); not designed (outside the tiles:
// no cell); the reference residue (outlined; it holds the synonymous variant's score when there is
// one). Multi-variants, insertions and deletions are not on the map; the model counts them.

import { log10 } from './dmath.js';
import { KIND, STATUS } from './variants.js';
import { targetLength } from './design.js';
import { median, quantileSorted, sorted } from './stats.js';
import { STAGE_BY_ID } from './filters.js';

export const STATE = { NOT_DESIGNED: 0, MISSING: 1, FILTERED: 2, LOW: 3, SCORED: 4, REFERENCE: 5 };
export const STATE_NAMES = ['not designed', 'missing', 'filtered', 'low confidence', 'scored', 'reference residue'];

// Amino-acid codes as variants.js numbers them (AA_CODE: 1 + index here).
const CODES = 'ARNDCQEGHILKMFPSTWYV*';

export const ROW_ORDERS = {
  biochemical: { label: 'Biochemical', rows: 'HKRDECMNQSTAILVFWYGP*', groups: [[0, 3, 'positive'], [3, 5, 'negative'], [5, 11, 'polar'], [11, 15, 'aliphatic'], [15, 18, 'aromatic'], [18, 20, 'special'], [20, 21, 'stop']] },
  hydrophobicity: { label: 'Hydrophobicity', rows: 'IVLFCMAGTSWYPHEQDNKR*' },
  alphabetical: { label: 'Alphabetical', rows: 'ACDEFGHIKLMNPQRSTVWY*' },
};

export const COLOR_BY = {
  score: { label: 'Score', kind: 'diverging' },
  se: { label: 'Standard error', kind: 'sequential' },
  replicates: { label: 'Replicates used', kind: 'sequential' },
  input: { label: 'Input count (log)', kind: 'sequential' },
};

function proteinOf(target) {
  if (target.sequenceType === 'protein') return target.sequence.toUpperCase();
  const order = 'TCAG';
  const aas = 'FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG';
  const codons = {};
  let k = 0;
  for (const a of order) for (const b of order) for (const c of order) codons[a + b + c] = aas[k++];
  const dna = target.sequence.toUpperCase().slice((target.codingStart ?? 1) - 1);
  let out = '';
  for (let i = 0; i + 3 <= dna.length; i += 3) out += codons[dna.slice(i, i + 3)] ?? 'X';
  return out;
}

// The model of one condition of a run. options: { condition (index), rowOrder, colorBy }.
export function buildMapModel(results, design, options = {}) {
  const target = design.targets?.length === 1 ? design.targets[0] : null;
  if (!target) throw new Error('The map needs the design\'s target: the sequence its positions are numbered on.');
  if (design.variants.level !== 'protein') throw new Error('The map shows protein-level variants; this run names nucleotide variants (their mapping to the protein comes in wave 3).');
  const c = results.conditions[options.condition ?? 0];
  const order = ROW_ORDERS[options.rowOrder ?? 'biochemical'] ?? ROW_ORDERS.biochemical;
  const colorBy = COLOR_BY[options.colorBy] ? options.colorBy : 'score';
  const protein = proteinOf(target);
  const length = targetLength(target, 'protein');
  const tiles = design.library?.tiles ?? [];
  const designed = (p) => !tiles.length || tiles.some((t) => p >= t.start && p <= t.end);
  const R = 21;
  const rowOfCode = new Int8Array(22).fill(-1);
  for (let r = 0; r < R; r += 1) rowOfCode[CODES.indexOf(order.rows[r]) + 1] = r;
  const v = results.variants;
  // Cells, positions major: cell = (position − 1) × 21 + row.
  const cells = new Int32Array(length * R).fill(-1);
  const state = new Uint8Array(length * R);
  const reference = new Uint8Array(length * R);
  let offMap = 0;
  const offMapKinds = {};
  for (let i = 0; i < results.rows; i += 1) {
    const kind = v.kind[i];
    const p = v.position[i];
    const single = kind === KIND.MISSENSE || kind === KIND.NONSENSE || kind === KIND.START_LOST || kind === KIND.SYNONYMOUS;
    if (!single || v.status[i] === STATUS.INVALID || p < 1 || p > length) {
      if (kind !== KIND.WT) {
        offMap += 1;
        offMapKinds[kind] = (offMapKinds[kind] ?? 0) + 1;
      }
      continue;
    }
    const code = kind === KIND.SYNONYMOUS ? v.ref[i] || CODES.indexOf(protein[p - 1]) + 1 : v.alt[i];
    const r = rowOfCode[code];
    if (r < 0) continue;
    cells[(p - 1) * R + r] = i;
  }
  const measured = STAGE_BY_ID.get('measured').code;
  const counts = { [STATE.NOT_DESIGNED]: 0, [STATE.MISSING]: 0, [STATE.FILTERED]: 0, [STATE.LOW]: 0, [STATE.SCORED]: 0, [STATE.REFERENCE]: 0 };
  for (let p = 1; p <= length; p += 1) {
    const refRow = rowOfCode[CODES.indexOf(protein[p - 1]) + 1];
    for (let r = 0; r < R; r += 1) {
      const k = (p - 1) * R + r;
      const i = cells[k];
      if (r === refRow) reference[k] = 1;
      let s;
      if (!designed(p)) s = STATE.NOT_DESIGNED;
      else if (i < 0) s = r === refRow ? STATE.REFERENCE : STATE.MISSING;
      else if (c.reason[i] === measured) s = r === refRow ? STATE.REFERENCE : STATE.MISSING;
      else if (c.reason[i]) s = STATE.FILTERED;
      else s = c.flags[i] ? STATE.LOW : STATE.SCORED;
      state[k] = s;
      counts[s] += 1;
    }
  }
  // Values to color by.
  const inputOf = (i) => {
    let sum = 0;
    let n = 0;
    for (const rep of results.replicates) {
      if (!c.replicates.includes(rep.id) || rep.state[i] !== 0) continue;
      sum += rep.first[i];
      n += 1;
    }
    return n ? sum / n : Number.NaN;
  };
  const value = new Float64Array(length * R).fill(Number.NaN);
  for (let k = 0; k < cells.length; k += 1) {
    const i = cells[k];
    if (i < 0 || (state[k] !== STATE.SCORED && state[k] !== STATE.LOW && !(state[k] === STATE.REFERENCE && !c.reason[i]))) continue;
    value[k] = colorBy === 'score' ? c.score[i] : colorBy === 'se' ? c.se[i] : colorBy === 'replicates' ? c.k[i] : log10(inputOf(i) + 1);
  }
  // The color domain: scores diverge from the wild type's score, symmetrically (the same color
  // distance is the same score distance on both sides); the others run from their low to high end.
  const finite = sorted([...value].filter(Number.isFinite));
  const wt = results.controls.wt >= 0 && !c.reason[results.controls.wt] ? c.score[results.controls.wt] : Number.NaN;
  let domain;
  if (colorBy === 'score') {
    const center = Number.isFinite(wt) ? wt : (c.rescale?.anchors.find((a) => a.what === 'wild type')?.to ?? 0);
    const lo = quantileSorted(finite, 0.02);
    const hi = quantileSorted(finite, 0.98);
    const span = Math.max(center - lo, hi - center, 1e-9);
    domain = { kind: 'diverging', center, min: center - span, max: center + span };
  } else if (colorBy === 'replicates') {
    domain = { kind: 'sequential', min: 0, max: Math.max(1, c.replicates.length) };
  } else {
    domain = { kind: 'sequential', min: colorBy === 'input' ? 0 : 0, max: Math.max(1e-9, quantileSorted(finite, 0.98)) };
  }
  // Summaries: the median score of each position's scored substitutions (not synonymous), and of
  // each row's.
  const columnMedian = new Float64Array(length).fill(Number.NaN);
  const columnCount = new Uint8Array(length);
  const rowValues = Array.from({ length: R }, () => []);
  for (let p = 1; p <= length; p += 1) {
    const vals = [];
    for (let r = 0; r < R; r += 1) {
      const k = (p - 1) * R + r;
      if ((state[k] === STATE.SCORED || state[k] === STATE.LOW) && !reference[k]) {
        vals.push(c.score[cells[k]]);
        rowValues[r].push(c.score[cells[k]]);
      }
    }
    columnCount[p - 1] = vals.length;
    if (vals.length) columnMedian[p - 1] = median(vals);
  }
  const rowMedian = Float64Array.from(rowValues, (vals) => (vals.length ? median(vals) : Number.NaN));
  return {
    target: { id: target.id, name: target.name, offset: target.offset ?? 0 },
    protein,
    length,
    rows: order.rows,
    rowOrder: options.rowOrder ?? 'biochemical',
    groups: order.groups ?? null,
    condition: { id: c.id, name: c.name },
    colorBy,
    domain,
    cells,
    state,
    reference,
    value,
    columnMedian,
    columnCount,
    rowMedian,
    counts,
    offMap,
    offMapKinds,
    designedRange: tiles.length ? [Math.min(...tiles.map((t) => t.start)), Math.max(...tiles.map((t) => t.end))] : [1, length],
  };
}

// A value's place on the color scale, 0–1 (NaN when it has none).
export function colorPosition(model, x) {
  if (!Number.isFinite(x)) return Number.NaN;
  const d = model.domain;
  if (d.kind === 'diverging') return Math.max(0, Math.min(1, 0.5 + (x - d.center) / (2 * (d.max - d.center))));
  return Math.max(0, Math.min(1, (x - d.min) / (d.max - d.min || 1)));
}

// The cell under (position, row), or null.
export function cellAt(model, position, row) {
  if (position < 1 || position > model.length || row < 0 || row >= model.rows.length) return null;
  const k = (position - 1) * model.rows.length + row;
  return { k, position, row, alt: model.rows[row], ref: model.protein[position - 1], index: model.cells[k], state: model.state[k], reference: model.reference[k] === 1, value: model.value[k] };
}

const name3 = { A: 'Ala', R: 'Arg', N: 'Asn', D: 'Asp', C: 'Cys', Q: 'Gln', E: 'Glu', G: 'Gly', H: 'His', I: 'Ile', L: 'Leu', K: 'Lys', M: 'Met', F: 'Phe', P: 'Pro', S: 'Ser', T: 'Thr', W: 'Trp', Y: 'Tyr', V: 'Val', '*': 'Ter' };
// A cell's variant as MAVE-HGVS (p.Ala12Val; p.Ala12= for the reference cell).
export function cellName(model, cell) {
  const ref = name3[cell.ref] ?? cell.ref;
  return cell.reference ? `p.${ref}${cell.position}=` : `p.${ref}${cell.position}${name3[cell.alt]}`;
}

// The map in sentences, for screen readers and the page.
export function describeMap(model, results) {
  const c = model.counts;
  const total = c[STATE.SCORED] + c[STATE.LOW] + c[STATE.FILTERED] + c[STATE.MISSING];
  const lines = [];
  const pos = (p) => `${p}${model.target.offset ? ` (${p + model.target.offset} in the reference)` : ''}`;
  lines.push(`Variant-effect map of ${model.target.name}${results.conditions.length > 1 ? `, ${model.condition.name}` : ''}: ${model.length} positions by ${model.rows.length} substitutions (the 20 amino acids and stop), ${total} designed. ${c[STATE.SCORED]} scored, ${c[STATE.LOW]} scored with low confidence, ${c[STATE.FILTERED]} filtered, ${c[STATE.MISSING]} missing${c[STATE.NOT_DESIGNED] ? `, ${c[STATE.NOT_DESIGNED]} outside the designed tiles` : ''}.`);
  const positions = [];
  for (let p = 1; p <= model.length; p += 1) if (model.columnCount[p - 1] >= 5) positions.push([p, model.columnMedian[p - 1]]);
  if (positions.length >= 10) {
    positions.sort((a, b) => a[1] - b[1]);
    lines.push(`Positions least tolerant of substitution (lowest median score): ${positions.slice(0, 5).map(([p, m]) => `${model.protein[p - 1]}${pos(p)} ${m.toFixed(2)}`).join(', ')}.`);
    lines.push(`Most tolerant: ${positions.slice(-5).reverse().map(([p, m]) => `${model.protein[p - 1]}${pos(p)} ${m.toFixed(2)}`).join(', ')}.`);
  }
  if (model.colorBy === 'score') lines.push(`Colors run from ${model.domain.min.toFixed(2)} to ${model.domain.max.toFixed(2)}, centered on the wild type (${model.domain.center.toFixed(2)}).`);
  if (model.offMap) lines.push(`${model.offMap} variants are not single substitutions (multi-variants, insertions, deletions) and are not on the map.`);
  return lines;
}
