// Scores on the structure (wave 5, slice 3; requirement X3): each target position's value for a
// coloring of a variant-effect map (map-model.js), placed on the residues the target is mapped to
// (mapping.js), with the map's visual grammar: the map's palettes and scale (a residue's color means
// the score a cell of that color means), a position whose substitutions were not measured drawn
// missing and one whose were all filtered drawn filtered, each in a gray the palettes do not hold,
// never in the wild type's color; a value from scores of low confidence only drawn paler, as the map
// draws such a cell. Pure: the Structure view (ui/mode-structure.js), its legend, words and file,
// and remote control use it.
//
// A position's summaries are of its missense substitutions (the first methionine's, start-lost, as
// the map's column holds them), scored (with low confidence or not):
// their median, mean, lowest and highest score, the share abnormal-like (by a threshold or a
// published calibration's classes), how many are scored, the median of their standard errors. A
// stop truncates the protein wherever it is, so a residue's tolerance is read from its missense
// substitutions alone; one substitution (a stop included) can be chosen instead. The QC state says
// how much of a position was measured.

import { STATE } from './map-model.js';
import { median, quantileSorted, sorted } from './stats.js';
import { colormapLUT, displayColor, hexToRgb, rgbToHex } from './colormaps.js';

export const SCORE_COLORINGS = {
  median: { label: 'Median score', words: 'the median score of its missense substitutions', kind: 'score' },
  mean: { label: 'Mean score', words: 'the mean score of its missense substitutions', kind: 'score' },
  minimum: { label: 'Lowest score', words: 'the lowest score of its missense substitutions', kind: 'score' },
  maximum: { label: 'Highest score', words: 'the highest score of its missense substitutions', kind: 'score' },
  fraction: { label: 'Fraction abnormal-like', words: 'the share of its scored missense substitutions that are abnormal-like', kind: 'fraction' },
  count: { label: 'Substitutions scored', words: 'how many of its missense substitutions are scored', kind: 'count' },
  substitution: { label: 'One substitution', words: 'the score of one substitution', kind: 'score' },
  uncertainty: { label: 'Uncertainty (median SE)', words: 'the median standard error of its missense substitutions\' scores', kind: 'uncertainty' },
  disagreement: { label: 'Disagreement (Compare)', words: 'the median difference of its missense substitutions between the comparison\'s two sides', kind: 'score' },
  qc: { label: 'QC state', words: 'how much of it was measured', kind: 'qc' },
};

// A position's state for a coloring: not designed (outside the tiles, or not on the run's target),
// missing (none of its substitutions measured), filtered (measured, none scored), low (a value from
// scores of low confidence only), a value, the residue itself (one substitution: the wild type's).
export const POSITION = { NOT_DESIGNED: 0, MISSING: 1, FILTERED: 2, LOW: 3, VALUE: 4, REFERENCE: 5 };
export const POSITION_NAMES = ['not designed', 'missing', 'filtered', 'low confidence', 'scored', 'the residue itself'];

// Grays no palette holds (rdbu and puor are white at the wild type, viridis has no gray): missing,
// filtered, and the residues that are not the target's (or not designed).
export const STATE_COLORS = { missing: '#8c8c8c', filtered: '#4f5357', context: '#cfcfcf' };

// The QC state of a position with something scored, by what is missing among its designed missense
// substitutions (colors of the categorical palette, shown as their color-vision-friendly
// counterparts with that setting on).
export const QC_CLASSES = [
  { id: 'complete', label: 'every substitution scored', color: '#3fb27f' },
  { id: 'low', label: 'some with low confidence', color: '#c99a2e' },
  { id: 'partial', label: 'some filtered or missing', color: '#f0803c' },
  { id: 'sparse', label: 'fewer than half scored', color: '#e45563' },
];

const AMINO = 'ARNDCQEGHILKMFPSTWYV*';
const ONE_TO_THREE = { A: 'Ala', R: 'Arg', N: 'Asn', D: 'Asp', C: 'Cys', Q: 'Gln', E: 'Glu', G: 'Gly', H: 'His', I: 'Ile', L: 'Leu', K: 'Lys', M: 'Met', F: 'Phe', P: 'Pro', S: 'Ser', T: 'Thr', W: 'Trp', Y: 'Tyr', V: 'Val', '*': 'Ter' };
const plural = (n, word, many = `${word}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? word : many}`;
const fmt = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '—');

// An amino acid named by one letter or three (or a stop: *, Ter, stop) → its letter; null otherwise.
export function substitutionCode(text) {
  const t = String(text ?? '').trim();
  if (t.length === 1 && AMINO.includes(t.toUpperCase())) return t.toUpperCase();
  const lower = t.toLowerCase();
  if (lower === 'stop' || lower === 'nonsense') return '*';
  return Object.entries(ONE_TO_THREE).find(([, three]) => three.toLowerCase() === lower)?.[0] ?? null;
}

// What abnormal-like means for "fraction": below or above a threshold set by hand (research use), or
// a published calibration's abnormal classes. { test(score), words }.
export function thresholdClasses(value, side = 'below') {
  if (!Number.isFinite(value)) throw new Error('A threshold is a number: the score beyond which a substitution is abnormal-like.');
  if (side !== 'below' && side !== 'above') throw new Error('The side of the threshold is "below" or "above".');
  return { test: side === 'below' ? (x) => x < value : (x) => x > value, words: `scores ${side} ${value}, a threshold set here`, threshold: { value, side } };
}

export function calibrationClasses(calibration) {
  const ranges = calibration.classes.filter((k) => k.class === 'abnormal' && Array.isArray(k.range));
  if (!ranges.length) throw new Error(`${calibration.title} gives no abnormal class with a range of scores.`);
  const inRange = (k, x) => {
    const [lo, hi] = k.range;
    const [li, ui] = k.inclusive ?? [true, true];
    return (lo === null || (li ? x >= lo : x > lo)) && (hi === null || (ui ? x <= hi : x < hi));
  };
  const span = (k) => `${k.range[0] === null ? '−∞' : k.range[0]} to ${k.range[1] === null ? '∞' : k.range[1]}`;
  return { test: (x) => ranges.some((k) => inRange(k, x)), words: `the abnormal ${ranges.length === 1 ? 'class' : 'classes'} of "${calibration.title}" (${ranges.map(span).join('; ')}), as published`, calibration: calibration.title };
}

// The values of each position of a map model for a coloring (a key of SCORE_COLORINGS).
// options: { substitution (one letter, or '*'), abnormal (thresholdClasses or calibrationClasses) }.
export function positionValues(model, how, options = {}) {
  const coloring = SCORE_COLORINGS[how];
  if (!coloring) throw new Error(`No coloring "${how}": ${Object.keys(SCORE_COLORINGS).join(', ')}.`);
  const c = model.source;
  const R = model.rows.length;
  const L = model.length;
  const value = new Float64Array(L).fill(Number.NaN);
  const state = new Uint8Array(L);
  const scored = new Uint16Array(L);
  const designed = new Uint16Array(L);
  const lowOnly = new Uint8Array(L);
  const category = new Uint8Array(L);
  let substitution = null;
  if (how === 'substitution') {
    substitution = substitutionCode(options.substitution);
    if (!substitution) throw new Error('One substitution is named by its amino acid (A, Ala) or a stop (*, Ter).');
  }
  if (how === 'fraction') {
    if (model.contrast) throw new Error('Abnormal-like is said of scores, not of a contrast\'s differences: show a condition.');
    if (!options.abnormal) throw new Error('Fraction abnormal-like needs what abnormal-like is: a threshold, or a published calibration\'s classes.');
  }
  for (let p = 1; p <= L; p += 1) {
    if (substitution) {
      const r = model.rows.indexOf(substitution);
      const k = (p - 1) * R + r;
      const s = model.state[k];
      const i = model.cells[k];
      if (s === STATE.NOT_DESIGNED) state[p - 1] = POSITION.NOT_DESIGNED;
      else if (model.reference[k]) state[p - 1] = POSITION.REFERENCE;
      else if (s === STATE.SCORED || s === STATE.LOW) {
        value[p - 1] = c.score[i];
        scored[p - 1] = 1;
        state[p - 1] = s === STATE.LOW ? POSITION.LOW : POSITION.VALUE;
      } else state[p - 1] = s === STATE.FILTERED ? POSITION.FILTERED : POSITION.MISSING;
      designed[p - 1] = s === STATE.NOT_DESIGNED || model.reference[k] ? 0 : 1;
      continue;
    }
    const scores = [];
    const ses = [];
    let low = 0;
    let filtered = 0;
    let any = 0;
    for (let r = 0; r < R; r += 1) {
      const k = (p - 1) * R + r;
      const s = model.state[k];
      if (s === STATE.NOT_DESIGNED || model.reference[k] || model.rows[r] === '*') continue;
      any += 1;
      if (s === STATE.SCORED || s === STATE.LOW) {
        const i = model.cells[k];
        scores.push(c.score[i]);
        ses.push(c.se?.[i]);
        if (s === STATE.LOW) low += 1;
      } else if (s === STATE.FILTERED) filtered += 1;
    }
    designed[p - 1] = any;
    scored[p - 1] = scores.length;
    if (!any) {
      state[p - 1] = POSITION.NOT_DESIGNED;
      continue;
    }
    if (!scores.length) {
      state[p - 1] = filtered ? POSITION.FILTERED : POSITION.MISSING;
      continue;
    }
    lowOnly[p - 1] = low === scores.length ? 1 : 0;
    state[p - 1] = lowOnly[p - 1] && how !== 'qc' && how !== 'count' ? POSITION.LOW : POSITION.VALUE;
    let v;
    if (how === 'median' || how === 'disagreement') v = median(scores);
    else if (how === 'mean') v = scores.reduce((a, b) => a + b, 0) / scores.length;
    else if (how === 'minimum') v = Math.min(...scores);
    else if (how === 'maximum') v = Math.max(...scores);
    else if (how === 'fraction') v = scores.filter((x) => options.abnormal.test(x)).length / scores.length;
    else if (how === 'count') v = scores.length;
    else if (how === 'uncertainty') {
      const finite = ses.filter(Number.isFinite);
      v = finite.length ? median(finite) : Number.NaN;
    } else {
      // QC: what is missing among the designed missense substitutions.
      v = scores.length / any;
      category[p - 1] = scores.length * 2 < any ? 3 : scores.length < any ? 2 : low ? 1 : 0;
    }
    value[p - 1] = v;
  }
  if (how === 'uncertainty' && !value.some(Number.isFinite)) throw new Error('These scores have no standard errors: their uncertainty cannot be shown.');
  // The color scale: the map's for scores (a residue's color is the score a cell of that color has);
  // 0 to the 98th percentile for the uncertainty; 0–1 for the share; 0 to the most designed for the
  // count; none for the QC state.
  const finite = sorted([...value].filter(Number.isFinite));
  let domain;
  if (coloring.kind === 'score') domain = model.domain.kind === 'diverging' ? model.domain : { kind: 'diverging', center: model.scoreCenter, min: model.scoreCenter - 1, max: model.scoreCenter + 1 };
  else if (coloring.kind === 'uncertainty') domain = { kind: 'sequential', min: 0, max: Math.max(1e-9, finite.length ? quantileSorted(finite, 0.98) : 1) };
  else if (coloring.kind === 'fraction') domain = { kind: 'sequential', min: 0, max: 1 };
  else if (coloring.kind === 'count') domain = { kind: 'sequential', min: 0, max: Math.max(1, ...designed) };
  else domain = { kind: 'categorical' };
  const label = how === 'substitution' ? `Substitution to ${substitution === '*' ? 'a stop' : ONE_TO_THREE[substitution]}` : coloring.label;
  const words = how === 'substitution' ? `the score of its substitution to ${substitution === '*' ? 'a stop' : ONE_TO_THREE[substitution]}` : coloring.words;
  return {
    how, label, words, kind: coloring.kind, substitution,
    abnormal: how === 'fraction' ? options.abnormal.words : null,
    target: { ...model.target },
    protein: model.protein,
    length: L,
    offset: model.target.offset ?? 0,
    condition: model.condition?.name ?? null,
    contrast: model.contrast?.name ?? null,
    scale: model.scale,
    value, state, scored, designed, lowOnly, category, domain,
  };
}

// The values placed on another target (the mapping's): by reference numbering, where the residues
// agree (a run of the mapped protein numbered otherwise, a score set of part of it). null when fewer
// than nine in ten positions they share agree: another protein. The arrays are then the mapped
// target's, a position the values do not cover not designed; `from` gives each one's own position.
export function placeOnTarget(values, target) {
  const shift = values.offset - (target.offset ?? 0);
  let overlap = 0;
  let agree = 0;
  for (let p = 1; p <= values.length; p += 1) {
    const q = p + shift;
    if (q < 1 || q > target.length) continue;
    overlap += 1;
    if (values.protein[p - 1] === target.sequence[q - 1]) agree += 1;
  }
  if (!overlap || agree < 0.9 * overlap) return null;
  const L = target.length;
  const out = {
    ...values,
    length: L, offset: target.offset ?? 0, protein: target.sequence, target: { ...values.target, mapped: target.name },
    value: new Float64Array(L).fill(Number.NaN), state: new Uint8Array(L), scored: new Uint16Array(L), designed: new Uint16Array(L),
    lowOnly: new Uint8Array(L), category: new Uint8Array(L), from: new Int32Array(L),
    agreement: { overlap, agree },
  };
  for (let p = 1; p <= values.length; p += 1) {
    const q = p + shift;
    if (q < 1 || q > L || values.protein[p - 1] !== target.sequence[q - 1]) continue;
    for (const key of ['value', 'state', 'scored', 'designed', 'lowOnly', 'category']) out[key][q - 1] = values[key][p - 1];
    out.from[q - 1] = p;
  }
  return out;
}

// --- Colors ----------------------------------------------------------------------------------------

// The colors of a coloring: color(t), paler(t) (halfway to gray, as the map draws low confidence),
// from the map's diverging palette ('rdbu', 'puor') for scores and viridis for the rest.
export function coloringPalette(values, palette = 'rdbu') {
  const name = values.domain.kind === 'diverging' ? palette : 'viridis';
  const lut = colormapLUT(name);
  const at = (t, pale) => {
    const i = Math.max(0, Math.min(255, Math.round(t * 255)));
    const rgb = [lut[i * 3], lut[i * 3 + 1], lut[i * 3 + 2]];
    return rgbToHex(pale ? rgb.map((v) => (v + 110) / 2) : rgb);
  };
  return { name, color: (t) => at(t, false), paler: (t) => at(t, true) };
}

// A value's place on the scale, 0–1 (NaN: none), as map-model.js's colorPosition.
export function scalePosition(domain, x) {
  if (!Number.isFinite(x)) return Number.NaN;
  if (domain.kind === 'diverging') return Math.max(0, Math.min(1, 0.5 + (x - domain.center) / (2 * (domain.max - domain.center || 1))));
  return Math.max(0, Math.min(1, (x - domain.min) / (domain.max - domain.min || 1)));
}

// A position's color (hex), with the state grammar.
export function positionColor(values, position, pal) {
  const i = position - 1;
  const s = values.state[i];
  if (s === POSITION.NOT_DESIGNED) return STATE_COLORS.context;
  if (s === POSITION.MISSING) return STATE_COLORS.missing;
  if (s === POSITION.FILTERED) return STATE_COLORS.filtered;
  if (s === POSITION.REFERENCE) return values.domain.kind === 'diverging' ? pal.color(0.5) : STATE_COLORS.context;
  if (values.kind === 'qc') return displayColor(QC_CLASSES[values.category[i]].color);
  const t = scalePosition(values.domain, values.value[i]);
  if (!Number.isFinite(t)) return STATE_COLORS.missing;
  return s === POSITION.LOW ? pal.paler(t) : pal.color(t);
}

// The colors of the residues of every chain the target is mapped onto: residue key → [r, g, b]
// (0–1). Residues not on a target position keep the context color (the viewer's base).
export function residueColors(values, maps, pal) {
  const out = new Map();
  const cache = new Map();
  for (const m of maps) {
    for (const p of m.positions) {
      if (!p.residue) continue;
      let rgb = cache.get(p.position);
      if (!rgb) {
        rgb = hexToRgb(positionColor(values, p.position, pal)).map((v) => v / 255);
        cache.set(p.position, rgb);
      }
      out.set(p.residue, rgb);
    }
  }
  return out;
}

// The positions of the mapping that are on residues, by state (for the legend and the words).
export function stateCounts(values, mapping) {
  const counts = { onStructure: 0, byState: new Array(POSITION_NAMES.length).fill(0), byCategory: new Array(QC_CLASSES.length).fill(0), offStructure: 0 };
  for (const p of mapping.positions) {
    const s = values.state[p.position - 1];
    if (!p.residue) {
      if (s === POSITION.VALUE || s === POSITION.LOW) counts.offStructure += 1;
      continue;
    }
    counts.onStructure += 1;
    counts.byState[s] += 1;
    if (values.kind === 'qc' && s === POSITION.VALUE) counts.byCategory[values.category[p.position - 1]] += 1;
  }
  return counts;
}

// The legend: { title, gradient: { stops (CSS), low, center, high } | null, items: [{ label,
// color, count, hatch }] } for the positions on the structure.
export function coloringLegend(values, mapping, pal, source = '') {
  const counts = stateCounts(values, mapping);
  const d = values.domain;
  const items = [];
  let gradient = null;
  const { scale } = values;
  const [lowColor, highColor] = pal.name === 'puor' ? ['purple', 'orange'] : pal.name === 'rdbu' ? ['blue', 'red'] : ['dark', 'yellow'];
  if (values.kind === 'qc') {
    QC_CLASSES.forEach((k, i) => items.push({ label: k.label, color: displayColor(k.color), count: counts.byCategory[i] }));
  } else {
    const stops = Array.from({ length: 13 }, (_, i) => `${pal.color(i / 12)} ${((100 * i) / 12).toFixed(1)}%`).join(', ');
    const decimals = values.kind === 'count' ? 0 : 2;
    gradient = { stops: `linear-gradient(90deg, ${stops})`, low: fmt(d.min, decimals), high: fmt(d.max, decimals), center: d.kind === 'diverging' ? (values.contrast || values.how === 'disagreement' ? '0 no difference' : `${fmt(d.center)} wild type`) : null };
    if (d.kind === 'diverging') gradient.meaning = values.how === 'disagreement' ? `${lowColor} where the first side is lower, ${highColor} higher` : values.contrast ? `${lowColor} lower, ${highColor} higher` : scale?.stated ? `${lowColor} is ${scale.low}, ${highColor} ${scale.high}` : `${lowColor} lower, ${highColor} higher`;
    if (counts.byState[POSITION.LOW]) items.push({ label: `${POSITION_NAMES[POSITION.LOW]} only`, color: pal.paler(0.2), count: counts.byState[POSITION.LOW] });
  }
  items.push({ label: POSITION_NAMES[POSITION.FILTERED], color: STATE_COLORS.filtered, count: counts.byState[POSITION.FILTERED], pattern: 'hatch' });
  items.push({ label: POSITION_NAMES[POSITION.MISSING], color: STATE_COLORS.missing, count: counts.byState[POSITION.MISSING], pattern: 'dot' });
  if (counts.byState[POSITION.REFERENCE]) items.push({ label: 'the residue itself', color: d.kind === 'diverging' ? pal.color(0.5) : STATE_COLORS.context, count: counts.byState[POSITION.REFERENCE] });
  items.push({ label: counts.byState[POSITION.NOT_DESIGNED] ? 'not designed, or not the target' : 'not the target', color: STATE_COLORS.context, count: null });
  const title = values.how === 'disagreement' ? `Median difference, ${values.contrast}` : `${values.label}${values.contrast ? `, ${values.contrast}` : source ? `, ${source}` : ''}`;
  return { title, gradient, items, counts };
}

// --- Words and the file ----------------------------------------------------------------------------

const residueName = (values, position) => `${values.protein[position - 1]}${position}${values.offset ? ` (${position + values.offset})` : ''}`;

// The coloring in words. source: the run (and condition) the values are of, in words.
export function describeColoring(values, mapping, structureName, source) {
  const counts = stateCounts(values, mapping);
  const on = mapping.positions.filter((p) => p.residue);
  const n = counts.byState;
  const valued = n[POSITION.VALUE] + n[POSITION.LOW];
  const lines = [];
  const what = values.kind === 'qc' ? 'by its QC state' : `by ${values.words}`;
  const parts = [`${plural(valued, 'has', 'have')} a value`];
  if (values.kind !== 'qc' && n[POSITION.LOW]) parts.push(`${n[POSITION.LOW].toLocaleString('en-US')} from scores of low confidence only, drawn paler`);
  if (n[POSITION.FILTERED]) parts.push(`${n[POSITION.FILTERED].toLocaleString('en-US')} filtered`);
  if (n[POSITION.MISSING]) parts.push(`${n[POSITION.MISSING].toLocaleString('en-US')} missing`);
  if (n[POSITION.NOT_DESIGNED]) parts.push(`${n[POSITION.NOT_DESIGNED].toLocaleString('en-US')} not designed`);
  if (n[POSITION.REFERENCE]) parts.push(`${n[POSITION.REFERENCE].toLocaleString('en-US')} ${n[POSITION.REFERENCE] === 1 ? 'is' : 'are'} the residue itself`);
  lines.push(`Each residue of the target is colored ${what} (${source}). Of the ${plural(on.length, 'target position')} on ${structureName} chain ${mapping.chain}, ${parts.join(', ')}.${n[POSITION.FILTERED] || n[POSITION.MISSING] ? ' Filtered and missing positions are drawn gray, never in the wild type\'s color.' : ''}`);
  if (values.how === 'fraction') lines.push(`Abnormal-like: ${values.abnormal}. For research: MaveScape classifies no variant.`);
  const ranked = on.filter((p) => values.state[p.position - 1] === POSITION.VALUE || values.state[p.position - 1] === POSITION.LOW).map((p) => [p.position, values.value[p.position - 1]]).filter(([, v]) => Number.isFinite(v));
  if (values.kind === 'qc') {
    const k = counts.byCategory;
    lines.push(`QC state: ${QC_CLASSES.map((c, i) => `${c.label} ${k[i].toLocaleString('en-US')}`).join(', ')}.`);
  } else if (ranked.length >= 6) {
    ranked.sort((a, b) => a[1] - b[1]);
    const d = values.kind === 'count' ? 0 : 2;
    const list = (xs) => xs.map(([p, v]) => `${residueName(values, p)} ${fmt(v, d)}`).join(', ');
    const lowWord = values.kind === 'score' && !values.contrast && values.how !== 'disagreement' && values.scale?.stated ? ` (${values.scale.low})` : '';
    const highWord = values.kind === 'score' && !values.contrast && values.how !== 'disagreement' && values.scale?.stated ? ` (${values.scale.high})` : '';
    lines.push(`Lowest on the structure${lowWord}: ${list(ranked.slice(0, 5))}. Highest${highWord}: ${list(ranked.slice(-5).reverse())}.`);
  }
  if (counts.offStructure) lines.push(`${plural(counts.offStructure, 'position')} with a value ${counts.offStructure === 1 ? 'is' : 'are'} not on a residue of the structure (not observed, or outside it).`);
  return lines;
}

// The coloring as a table: one row per target position, with its residue on the chain (if any).
export function coloringCSV(values, mapping, structureName, pal) {
  const rows = ['target_position,reference_position,target_residue,structure,chain,residue_number,insertion_code,structure_residue,coloring,value,state,substitutions_scored,substitutions_designed,color'];
  const csv = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replaceAll('"', '""')}"` : String(v));
  for (const p of mapping.positions) {
    const i = p.position - 1;
    const [chain, number, resName] = p.residue ? p.residue.split(':') : ['', '', ''];
    const num = /^(-?\d+)([A-Za-z]?)$/.exec(number ?? '') ?? [];
    const s = values.state[i];
    const v = values.value[i];
    const shown = values.kind === 'qc' && (s === POSITION.VALUE || s === POSITION.LOW) ? QC_CLASSES[values.category[i]].id : Number.isFinite(v) && (s === POSITION.VALUE || s === POSITION.LOW) ? String(+v.toPrecision(6)) : 'NA';
    rows.push([p.position, p.reference, ONE_TO_THREE[p.code] ?? p.code, structureName, p.residue ? chain : mapping.chain, num[1] ?? '', num[2] ?? '', resName ? resName[0] + resName.slice(1).toLowerCase() : '', values.how === 'substitution' ? `substitution:${values.substitution}` : values.how, shown, POSITION_NAMES[s], values.scored[i], values.designed[i], p.residue ? positionColor(values, p.position, pal) : ''].map(csv).join(','));
  }
  return `${rows.join('\n')}\n`;
}

// --- Selections ------------------------------------------------------------------------------------

// The map's names of the designed cells at positions (as "at …" selects them, the reference cell
// included), for a structure's selection sent to the map.
export function cellsAtPositions(model, positions, cellName, cellAt) {
  const keys = [];
  const R = model.rows.length;
  for (const p of positions) {
    if (p < 1 || p > model.length) continue;
    for (let r = 0; r < R; r += 1) {
      if (model.state[(p - 1) * R + r] === STATE.NOT_DESIGNED) continue;
      keys.push(cellName(model, cellAt(model, p, r)));
    }
  }
  return keys;
}

// The positions of a map selection's names (p.Ala12Val, p.Ala12=, p.Ala12Ter), in order.
export function positionsOfKeys(keys) {
  const out = new Set();
  for (const key of keys) {
    const m = /^p\.[A-Z][a-z]{2}(\d+)/.exec(key);
    if (m) out.add(Number(m[1]));
  }
  return [...out].sort((a, b) => a - b);
}

// Positions as the query language's ranges: "12-15,40".
export function positionRanges(positions) {
  const list = [...new Set(positions)].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < list.length; i += 1) {
    let j = i;
    while (j + 1 < list.length && list[j + 1] === list[j] + 1) j += 1;
    out.push(j > i ? `${list[i]}-${list[j]}` : `${list[i]}`);
    i = j;
  }
  return out.join(',');
}
