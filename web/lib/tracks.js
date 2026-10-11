// Sequence tracks beside the variant-effect map (wave 3, slice 5; requirement V5): one row each,
// on the map's positions, drawn and read with it. Pure; the providers (providers/*.js) make the
// tracks of annotations, the map draws them (map-render.js, map-svg.js), the Map view arranges them.
//
// A track is one of four kinds:
//   sequence  the target's residues (the reference track)
//   values    a number per position (coverage, position effect, uncertainty, conservation)
//   features  stretches of the target (domains, regions, sites, secondary structure)
//   variants  values or classes of single substitutions (ClinVar, gnomAD, AlphaMissense, a
//             predictor), drawn by position and given to each variant in the inspector
// Every track of an annotation keeps its source: the service, its release, when it was retrieved,
// the address asked, the license and how to cite it. Positions are the target's (1 to its length);
// an annotation numbered on a reference (UniProt, a transcript's protein) is placed by the target's
// offset, and only where the residues agree (placeResidues).

import { STATE } from './map-model.js';
import { median } from './stats.js';

export const TRACK_KINDS = ['sequence', 'values', 'features', 'variants'];

// Heights in CSS pixels, in the window and the SVG.
export const TRACK_HEIGHT = { sequence: 14, values: 22, features: 14, variants: 18 };

// The classes a variant's ClinVar classification is drawn in, worst first; the token names its
// color (styles.css, --track-*).
export const CLINVAR_CLASSES = [
  { id: 'pathogenic', label: 'pathogenic or likely pathogenic', token: 'pathogenic' },
  { id: 'conflicting', label: 'conflicting classifications', token: 'conflicting' },
  { id: 'uncertain', label: 'uncertain significance', token: 'uncertain' },
  { id: 'benign', label: 'benign or likely benign', token: 'benign' },
  { id: 'other', label: 'other (risk factor, drug response, not provided)', token: 'other' },
];

// ClinVar's review status as gold stars (ClinVar's "review status" page): 0 to 4.
export const REVIEW_STARS = {
  'practice guideline': 4,
  'reviewed by expert panel': 3,
  'criteria provided, multiple submitters, no conflicts': 2,
  'criteria provided, conflicting classifications': 1,
  'criteria provided, conflicting interpretations': 1,
  'criteria provided, single submitter': 1,
  'no assertion criteria provided': 0,
  'no assertion provided': 0,
  'no classification provided': 0,
  'no classification for the single variant': 0,
  'no classifications from unflagged records': 0,
  'no interpretation for the single variant': 0,
};

// A ClinVar classification's class (CLINVAR_CLASSES).
export function clinvarClass(text) {
  const t = String(text ?? '').toLowerCase().trim();
  if (!t || t === '-') return null;
  if (t.startsWith('conflicting')) return 'conflicting';
  if (/^(pathogenic|likely pathogenic|pathogenic\/likely pathogenic)(,|;|$)/.test(t) || t === 'pathogenic, low penetrance' || t === 'likely pathogenic, low penetrance') return 'pathogenic';
  if (/^(benign|likely benign|benign\/likely benign)(,|;|$)/.test(t)) return 'benign';
  if (t.startsWith('uncertain significance')) return 'uncertain';
  return 'other';
}

// AlphaMissense's classes (am_class: LPath, Amb, LBen), with the authors' thresholds on the score.
export const MISSENSE_CLASSES = [
  { id: 'pathogenic', label: 'likely pathogenic (> 0.564)', token: 'pathogenic', code: 'LPath' },
  { id: 'ambiguous', label: 'ambiguous', token: 'other', code: 'Amb' },
  { id: 'benign', label: 'likely benign (< 0.34)', token: 'benign', code: 'LBen' },
];

// Feature colors by kind of feature.
export const FEATURE_TOKENS = { helix: 'helix', strand: 'strand', turn: 'turn' };

const THREE = { Ala: 'A', Arg: 'R', Asn: 'N', Asp: 'D', Cys: 'C', Gln: 'Q', Glu: 'E', Gly: 'G', His: 'H', Ile: 'I', Leu: 'L', Lys: 'K', Met: 'M', Phe: 'F', Pro: 'P', Ser: 'S', Thr: 'T', Trp: 'W', Tyr: 'Y', Val: 'V', Ter: '*', Sec: 'U' };
const ONE = Object.fromEntries(Object.entries(THREE).map(([k, v]) => [v, k]));
export const threeLetter = (aa) => ONE[aa] ?? null;
export const oneLetter = (aaa) => THREE[aaa] ?? null;

// A single substitution of a protein, in any of the forms annotations write it: MAVE-HGVS or HGVS
// (p.Arg86Gln, p.(Arg86Gln), p.Arg86Ter, p.Arg86*, p.Arg86=, p.Arg86Arg), one-letter (R86Q, R86*,
// p.R86Q). { ref, position, alt } in one-letter code ('*' for a stop), or null.
export function readSubstitution(text) {
  const s = String(text ?? '').trim().replace(/^[A-Za-z0-9_.]+:(?=p\.)/, '').replace(/^p\.\((.*)\)$/, 'p.$1');
  let m = /^p\.([A-Z][a-z]{2})(\d+)([A-Z][a-z]{2}|=|\*)$/.exec(s);
  if (m) {
    const ref = oneLetter(m[1]);
    const alt = m[3] === '=' ? ref : m[3] === '*' ? '*' : oneLetter(m[3]);
    return ref && alt ? { ref, position: Number(m[2]), alt } : null;
  }
  m = /^(?:p\.)?([ACDEFGHIKLMNPQRSTVWY])(\d+)([ACDEFGHIKLMNPQRSTVWY*X]|=)$/.exec(s);
  if (m) {
    const alt = m[3] === '=' ? m[1] : m[3] === 'X' ? '*' : m[3];
    return { ref: m[1], position: Number(m[2]), alt };
  }
  return null;
}

// The MAVE-HGVS key of a substitution at a target position (the map's cell names: p.Arg86Gln,
// p.Arg86Ter, p.Arg86=).
export function substitutionKey(ref, position, alt) {
  if (alt === ref) return `p.${threeLetter(ref)}${position}=`;
  return `p.${threeLetter(ref)}${position}${alt === '*' ? 'Ter' : threeLetter(alt)}`;
}

// Places residues numbered on a reference on the target: position = reference position − offset,
// kept where the target has the same residue there. items: [{ refPosition, ref }, …] (ref: one
// letter, or null when the item names no residue). Returns { placed: [{ …item, position }],
// outside, disagree: [{ refPosition, ref, target }], compared, agree, problem }; problem says the
// offset looks wrong (over a tenth of five or more residues compared disagree).
export function placeResidues(items, protein, offset = 0) {
  const placed = [];
  const disagree = [];
  let outside = 0;
  let compared = 0;
  const L = protein.replace(/\*$/, '').length;
  for (const item of items) {
    const position = item.refPosition - offset;
    if (!(position >= 1 && position <= L)) {
      outside += 1;
      continue;
    }
    if (item.ref) {
      compared += 1;
      const here = protein[position - 1];
      if (here !== item.ref) {
        disagree.push({ refPosition: item.refPosition, ref: item.ref, target: here });
        continue;
      }
    }
    placed.push({ ...item, position });
  }
  const agree = compared - disagree.length;
  const problem = compared >= 5 && disagree.length > compared / 10
    ? `${disagree.length} of the ${compared} residues it names disagree with the target's at the target's offset (${offset}): it is numbered on another sequence, or the offset is wrong (Experiment, Target).`
    : null;
  return { placed, outside, disagree, compared, agree, problem };
}

// --- The tracks every run has --------------------------------------------------------------------

export const BUILTIN_TRACKS = [
  { id: 'reference', label: 'Reference', kind: 'sequence', what: 'the target\'s residues' },
  { id: 'coverage', label: 'Coverage', kind: 'values', what: 'the share of each position\'s designed substitutions with a score' },
  { id: 'effect', label: 'Position effect', kind: 'values', what: 'the median score of each position\'s substitutions (not synonymous), from the wild type\'s' },
  { id: 'uncertainty', label: 'Uncertainty', kind: 'values', what: 'the median standard error of each position\'s scored substitutions' },
];

// The target a run's tracks are found and read for: the run's own, which numbers its map, with the
// identifiers the workspace's target has now (a UniProt check sets the accession and gene, often
// after a run). Only while that target has the run's sequence and offset, so the positions are the
// same; otherwise the run's alone.
export function trackTarget(target, targets = []) {
  if (!target) return null;
  const now = targets.find((t) => t.sequence === target.sequence && (t.sequenceType ?? null) === (target.sequenceType ?? null) && (t.offset ?? 0) === (target.offset ?? 0));
  if (!now?.identifiers) return target;
  return { ...target, identifiers: { ...(target.identifiers ?? {}), ...now.identifiers } };
}

// The built-in tracks of a map model (map-model.js).
export function builtinTracks(model) {
  const L = model.length;
  const R = model.rows.length;
  const c = model.source;
  const coverage = new Float64Array(L).fill(Number.NaN);
  const uncertainty = new Float64Array(L).fill(Number.NaN);
  for (let p = 1; p <= L; p += 1) {
    let designed = 0;
    let scored = 0;
    const se = [];
    for (let r = 0; r < R; r += 1) {
      const k = (p - 1) * R + r;
      const s = model.state[k];
      if (s === STATE.NOT_DESIGNED || model.reference[k]) continue;
      designed += 1;
      if (s === STATE.SCORED || s === STATE.LOW) {
        scored += 1;
        const e = c.se[model.cells[k]];
        if (Number.isFinite(e)) se.push(e);
      }
    }
    if (designed) coverage[p - 1] = scored / designed;
    if (se.length) uncertainty[p - 1] = median(se);
  }
  const center = model.scoreCenter ?? 0;
  const effect = Float64Array.from(model.columnMedian);
  let span = 0;
  for (const x of effect) if (Number.isFinite(x)) span = Math.max(span, Math.abs(x - center));
  let seMax = 0;
  for (const x of uncertainty) if (Number.isFinite(x)) seMax = Math.max(seMax, x);
  const base = (id) => ({ ...BUILTIN_TRACKS.find((t) => t.id === id), annotation: null, provider: 'run', source: null, length: L, notes: [] });
  return [
    { ...base('reference'), residues: model.protein.slice(0, L) },
    { ...base('coverage'), values: coverage, domain: { kind: 'sequential', min: 0, max: 1 }, unit: 'share scored', format: (x) => `${Math.round(x * 100)}%` },
    { ...base('effect'), label: model.contrast ? 'Position difference' : 'Position effect', values: effect, domain: { kind: 'diverging', center, min: center - (span || 1), max: center + (span || 1) }, unit: model.contrast ? 'median difference' : 'median score', format: (x) => x.toFixed(2) },
    { ...base('uncertainty'), values: uncertainty, domain: { kind: 'sequential', min: 0, max: seMax || 1 }, unit: 'median SE', format: (x) => x.toFixed(3) },
  ];
}

// --- Variants tracks -----------------------------------------------------------------------------

// A variants track from its entries ([{ key, position, ref, alt, value, cls, label, detail }]):
// each position's summary (values: the mean, the largest, or the count of entries) and, with
// classes, the count of each class at each position (stacks). options: { summary: 'mean' | 'max' |
// 'count', classes, scale: 'linear' | 'log', domain }.
export function variantsTrack(base, entries, options = {}) {
  const L = base.length;
  const byPosition = Array.from({ length: L }, () => []);
  for (const e of entries) if (e.position >= 1 && e.position <= L) byPosition[e.position - 1].push(e);
  const track = { ...base, kind: 'variants', entries, summary: options.summary ?? 'mean', scale: options.scale ?? 'linear', classes: options.classes ?? null, byKey: new Map() };
  for (const e of entries) {
    const list = track.byKey.get(e.key);
    if (list) list.push(e);
    else track.byKey.set(e.key, [e]);
  }
  track.values = Float64Array.from(byPosition, (list) => {
    const xs = list.map((e) => e.value).filter(Number.isFinite);
    if (track.summary === 'count') return list.length || Number.NaN;
    if (!xs.length) return Number.NaN;
    return track.summary === 'max' ? Math.max(...xs) : xs.reduce((a, x) => a + x, 0) / xs.length;
  });
  if (track.classes) {
    track.stacks = byPosition.map((list) => {
      if (!list.length) return null;
      const counts = track.classes.map((k) => ({ cls: k.id, n: list.filter((e) => e.cls === k.id).length })).filter((x) => x.n);
      return counts.length ? counts : null;
    });
  }
  if (!track.domain) {
    let max = 0;
    for (const x of track.values) if (Number.isFinite(x)) max = Math.max(max, x);
    track.domain = options.domain ?? { kind: 'sequential', min: 0, max: max || 1 };
  }
  return track;
}

// --- Filters -------------------------------------------------------------------------------------

// The filters a track offers: features by type; variants by class, by review stars (ClinVar), by
// a smallest value (gnomAD's frequency).
export function trackFilters(track) {
  if (track.kind === 'features') {
    const types = [...new Set(track.features.map((f) => f.type))];
    return types.length > 1 ? [{ id: 'types', label: 'Kinds shown', options: types }] : [];
  }
  if (track.kind !== 'variants') return [];
  const filters = [];
  if (track.classes) filters.push({ id: 'classes', label: 'Classes shown', options: track.classes.map((k) => k.id), labels: Object.fromEntries(track.classes.map((k) => [k.id, k.label])) });
  if (track.entries.some((e) => Number.isInteger(e.stars))) filters.push({ id: 'stars', label: 'Review status, at least', options: [0, 1, 2, 3, 4] });
  if (track.minimum) filters.push({ id: 'min', label: track.minimum.label, options: track.minimum.options });
  return filters;
}

// The track as a filter leaves it: { types: [...] }, { classes: [...], stars: n }, { min: x }.
// The filter is said in track.filtered (words), and the entries it leaves out counted.
export function applyFilter(track, filter) {
  if (!filter || !Object.keys(filter).length) return track;
  if (track.kind === 'features' && Array.isArray(filter.types)) {
    const types = new Set(filter.types);
    const features = track.features.filter((f) => types.has(f.type));
    return { ...track, features, filtered: `${filter.types.join(', ') || 'no kind'} shown` };
  }
  if (track.kind !== 'variants') return track;
  const classes = Array.isArray(filter.classes) ? new Set(filter.classes) : null;
  const stars = Number.isInteger(filter.stars) ? filter.stars : null;
  const min = Number.isFinite(filter.min) ? filter.min : null;
  const keep = track.entries.filter((e) => (!classes || classes.has(e.cls)) && (stars === null || (e.stars ?? 0) >= stars) && (min === null || e.value >= min));
  const words = [];
  if (classes) words.push(`${[...classes].map((id) => track.classes?.find((k) => k.id === id)?.label ?? id).join(', ') || 'no class'}`);
  if (stars) words.push(`${stars}★ and up`);
  if (min !== null) words.push(`${track.minimum?.format?.(min) ?? min} and up`);
  const next = variantsTrack({ ...track, domain: track.domain }, keep, { summary: track.summary, scale: track.scale, classes: track.classes });
  return { ...next, filtered: words.join('; '), hiddenEntries: track.entries.length - keep.length };
}

// --- Arrangement ---------------------------------------------------------------------------------

// The workspace's arrangement of tracks (ws.tracks: { order, hidden, filters }, absent until
// changed): which are shown, in which order, filtered how. Built-in tracks first, hidden until
// shown (a map without tracks is drawn and exported as before them); an annotation's tracks shown
// once it is added.
export const DEFAULT_HIDDEN = BUILTIN_TRACKS.map((t) => t.id);

export function arrangeTracks(tracks, layout = null) {
  const order = layout?.order ?? [];
  const hidden = new Set(layout?.hidden ?? DEFAULT_HIDDEN);
  const rank = (t) => {
    const i = order.indexOf(t.id);
    return i >= 0 ? i : order.length + tracks.indexOf(t);
  };
  return tracks.slice().sort((a, b) => rank(a) - rank(b)).map((t) => {
    const filtered = applyFilter(t, layout?.filters?.[t.id]);
    return { ...filtered, shown: !hidden.has(t.id) };
  });
}

// A new arrangement with a track shown or hidden, moved, or filtered (the others as they were).
export function arrangement(layout, tracks, change) {
  const ids = arrangeTracks(tracks, layout).map((t) => t.id);
  const hidden = new Set(layout?.hidden ?? DEFAULT_HIDDEN);
  const filters = { ...(layout?.filters ?? {}) };
  if (change.shown !== undefined) {
    if (change.shown) hidden.delete(change.id);
    else hidden.add(change.id);
  }
  if (Number.isInteger(change.to)) {
    const from = ids.indexOf(change.id);
    if (from >= 0) {
      ids.splice(from, 1);
      ids.splice(Math.max(0, Math.min(ids.length, change.to)), 0, change.id);
    }
  }
  if (change.filter !== undefined) {
    if (change.filter && Object.keys(change.filter).length) filters[change.id] = change.filter;
    else delete filters[change.id];
  }
  return { order: ids, hidden: [...hidden].sort(), filters };
}

// --- Words and tables ----------------------------------------------------------------------------

const fmt = (x, d = 3) => (Number.isFinite(x) ? Number(x.toPrecision(d)).toString() : '—');
const n = (x) => x.toLocaleString('en-US');
const span = (f) => (f.start === f.end ? String(f.start) : `${f.start}–${f.end}`);

// What a track holds at a position, in words (the tooltip and screen readers).
export function describeTrackAt(track, position, offset = 0) {
  const where = `${position}${offset ? ` (reference ${position + offset})` : ''}`;
  if (track.kind === 'sequence') return `${track.label} ${where}: ${track.residues[position - 1] ?? '—'}`;
  if (track.kind === 'values') {
    const x = track.values[position - 1];
    return `${track.label} at ${where}: ${Number.isFinite(x) ? `${track.format ? track.format(x) : fmt(x)}${track.unit ? ` (${track.unit})` : ''}` : 'none'}`;
  }
  if (track.kind === 'features') {
    const here = track.features.filter((f) => position >= f.start && position <= f.end);
    return `${track.label} at ${where}: ${here.length ? here.map((f) => `${f.label}${f.label === f.type ? '' : ` (${f.type.toLowerCase()})`}, ${span(f)}${f.clipped ? ' within the target' : ''}`).join('; ') : 'none'}`;
  }
  const here = track.entries.filter((e) => e.position === position);
  if (!here.length) return `${track.label} at ${where}: none`;
  if (here.length > 6 && track.classes) {
    // Many: counted by class, with the mean.
    const mean = here.reduce((a, e) => a + e.value, 0) / here.length;
    const byClass = track.classes.map((k) => [k, here.filter((e) => e.cls === k.id).length]).filter(([, n]) => n).map(([k, n]) => `${n} ${k.label.replace(/ \(.*\)$/, '')}`).join(', ');
    return `${track.label} at ${where}: ${here.length} variants, ${byClass}; ${track.summary === 'mean' ? `mean ${track.format ? track.format(mean) : fmt(mean)}` : ''}`.replace(/; $/, '');
  }
  const shown = here.slice(0, 6).map((e) => `${e.key.replace(/^p\./, '')} ${e.label}`).join('; ');
  return `${track.label} at ${where}: ${here.length} variant${here.length > 1 ? 's' : ''}: ${shown}${here.length > 6 ? '; …' : ''}`;
}

// A variant's entries in the variants tracks, and the features and values at its position: for the
// inspector. [{ track, text }].
export function annotationsOf(tracks, key, position) {
  const out = [];
  for (const t of tracks) {
    if (t.kind === 'variants') {
      const list = t.byKey.get(key);
      if (list?.length) out.push({ track: t, text: list.map((e) => e.label + (e.detail ? ` (${e.detail})` : '')).join('; ') });
    } else if (t.kind === 'features' && position > 0) {
      const here = t.features.filter((f) => position >= f.start && position <= f.end);
      if (here.length) out.push({ track: t, text: here.map((f) => (f.label === f.type ? f.label : `${f.label} (${f.type.toLowerCase()})`)).join('; ') });
    } else if (t.kind === 'values' && t.annotation && position > 0) {
      const x = t.values[position - 1];
      if (Number.isFinite(x)) out.push({ track: t, text: `${t.format ? t.format(x) : fmt(x)}${t.unit ? ` ${t.unit}` : ''}` });
    }
  }
  return out;
}

// One line per track for the map's words: what it is and where from.
export function sourceText(source) {
  if (!source) return '';
  const parts = [source.service];
  if (source.release) parts.push(`release ${source.release}`);
  if (source.retrieved) parts.push(`retrieved ${String(source.retrieved).slice(0, 10)}`);
  if (source.file) parts.push(`from ${source.file}`);
  return parts.filter(Boolean).join(', ');
}

export function describeTrack(track) {
  const from = track.source ? ` (${sourceText(track.source)})` : '';
  if (track.kind === 'sequence') return `${track.label}: the target's ${n(track.length)} residues.`;
  if (track.kind === 'values') {
    const xs = [...track.values].filter(Number.isFinite);
    if (!xs.length) return `${track.label}${from}: no position has a value.`;
    return `${track.label}${from}: ${n(xs.length)} of ${n(track.length)} positions, from ${track.format ? track.format(Math.min(...xs)) : fmt(Math.min(...xs))} to ${track.format ? track.format(Math.max(...xs)) : fmt(Math.max(...xs))}${track.unit ? ` (${track.unit})` : ''}.`;
  }
  if (track.kind === 'features') {
    if (!track.features.length) return `${track.label}${from}: none on the target.`;
    return `${track.label}${from}: ${track.features.slice(0, 8).map((f) => `${f.label} ${span(f)}`).join(', ')}${track.features.length > 8 ? `, and ${track.features.length - 8} more` : ''}.`;
  }
  const positions = new Set(track.entries.map((e) => e.position)).size;
  const byClass = track.classes ? track.classes.map((k) => [k.label, track.entries.filter((e) => e.cls === k.id).length]).filter(([, k]) => k).map(([label, k]) => `${n(k)} ${label}`).join(', ') : '';
  return `${track.label}${from}: ${n(track.entries.length)} variant${track.entries.length === 1 ? '' : 's'} at ${n(positions)} position${positions === 1 ? '' : 's'}${byClass ? ` (${byClass})` : ''}.`;
}

const csvCell = (s) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

// The tracks as a table, position by position: position, reference position (with an offset), the
// residue, then each track's value (a features track: the features there; a variants track: its
// summary, and each variant there with its label).
export function tracksCSV(tracks, model) {
  const offset = model.target.offset ?? 0;
  const head = ['position', ...(offset ? ['reference_position'] : []), 'residue'];
  const cols = [];
  for (const t of tracks) {
    if (t.kind === 'sequence') continue;
    if (t.kind === 'variants') {
      cols.push({ name: t.label, cell: (p) => (Number.isFinite(t.values[p - 1]) ? fmt(t.values[p - 1], 6) : '') });
      cols.push({ name: `${t.label}: variants`, cell: (p) => t.entries.filter((e) => e.position === p).map((e) => `${e.key} ${e.label}`).join('; ') });
    } else if (t.kind === 'features') {
      cols.push({ name: t.label, cell: (p) => t.features.filter((f) => p >= f.start && p <= f.end).map((f) => f.label).join('; ') });
    } else {
      cols.push({ name: t.label, cell: (p) => (Number.isFinite(t.values[p - 1]) ? fmt(t.values[p - 1], 6) : '') });
    }
  }
  const lines = [[...head, ...cols.map((c) => c.name)].map(csvCell).join(',')];
  for (let p = 1; p <= model.length; p += 1) {
    lines.push([String(p), ...(offset ? [String(p + offset)] : []), model.protein[p - 1] ?? '', ...cols.map((c) => c.cell(p))].map(csvCell).join(','));
  }
  return `${lines.join('\n')}\n`;
}
