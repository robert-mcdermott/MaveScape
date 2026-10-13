// Control sets (wave 8, slice 1; requirement K1): variants whose effect is known, for calibration
// (research use). Each label is kept as its source gives it and attributed ("ClinVar: Likely
// pathogenic ★★"), never in MaveScape's own words: a control set's two sides are P (pathogenic or
// likely pathogenic, or abnormal in another assay) and B (benign or likely benign, or normal)
// (mavescape-spec/conventions.md, Terminology). A set is made once, from ClinVar's records of the
// gene (the ClinVar annotation's table) or from a table of labels, and keeps its labels and where
// they came from, so that it reads the same later: ws.controlSets (lib/workspace.js).
//
//   { id, name, created, source: { kind: 'clinvar', annotation, file: { sha256 }, retrieved,
//       transcript } | { kind: 'table', file: { fileName, sha256, size }, citation, numbering },
//     rules: { minStars, kinds: ['missense', …], evaluatedBefore (a year: only classifications
//       last evaluated before it; wave 8, slice 6) }, labels: [label], excluded: { reason: n },
//     notes: [text] }
//   label: { key (the protein change on the target: p.Trp36Ala), side ('P' | 'B'), label (the
//     source's words), kind ('missense' | 'nonsense' | 'synonymous'), variant (as the source
//     writes it), ids ([ClinVar accession, …] or [the table's row]), stars (ClinVar: 0–4),
//     evaluated (the latest last-evaluated date, YYYY-MM-DD: ClinVar's, or a table's own column) }
//
// A set is matched to a run's variants at the protein level (matchControls), and says what may make
// it circular (circularity): labels that anchor the run's scale, labels that are the design's own
// controls, ClinVar classifications that may rest on this assay, too few controls, a predictor
// whose classes were set with the same labels.

import { parseTable, columnText } from './csv.js';
import { clinvarClass, placeResidues, readSubstitution, REVIEW_STARS, substitutionKey } from './tracks.js';
import { readClinVarTable } from './providers/clinvar.js';
import { targetProtein } from './target.js';
import { proteinView } from './collapse.js';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export const SIDES = ['P', 'B'];
export const KINDS = ['missense', 'nonsense', 'synonymous'];
// Fewer than this many controls on a side measured in the run: every metric's interval is wide.
export const FEW_CONTROLS = 10;

// The side of a label in a table's words: P, B, or null (uncertain, conflicting, or not read).
// ClinVar's own classification goes through tracks.js's clinvarClass; a table of ClinVar's words
// ("Benign; association", "Likely pathogenic, low penetrance") is read by its first term.
export function labelSide(text) {
  const t = String(text ?? '').trim().toLowerCase().replace(/[_\s]+/g, ' ').split(/[;,]/)[0].trim();
  if (!t) return null;
  if (/^(pathogenic|likely pathogenic|pathogenic\/likely pathogenic|p|lp|p\/lp|plp|abnormal|functionally abnormal)$/.test(t)) return 'P';
  if (/^(benign|likely benign|benign\/likely benign|b|lb|b\/lb|blb|normal|functionally normal)$/.test(t)) return 'B';
  return null;
}

export function variantKind(ref, alt) {
  if (alt === ref) return 'synonymous';
  if (alt === '*') return 'nonsense';
  return 'missense';
}

// A protein change as a table or ClinVar writes it: p.Trp36Ala, p.(Trp36Ala), W36A, NP_…:p.Trp36Ala,
// or ClinVar's title, NM_002086.5(GRB2):c.643C>T (p.Arg215Trp).
function readChange(text) {
  const s = String(text ?? '').trim();
  const inTitle = /\((p\.[^)]+)\)\s*$/.exec(s);
  return readSubstitution(inTitle ? inTitle[1] : s);
}

// Places changes numbered on a reference on the target (tracks.js's placeResidues), each keeping
// what it carries.
function place(items, target, offset) {
  return placeResidues(items, targetProtein(target), offset);
}

// One label per protein change: records of the same change on one side merge (their ids, the most
// stars, the latest evaluation); on both sides, the change is left out.
function merged(labels, excluded) {
  const byKey = new Map();
  for (const l of labels) {
    const had = byKey.get(l.key);
    if (!had) byKey.set(l.key, { ...l, ids: [...l.ids] });
    else if (had.side !== l.side) had.conflict = true;
    else {
      had.ids.push(...l.ids);
      if ((l.stars ?? -1) > (had.stars ?? -1)) {
        had.stars = l.stars;
        had.label = l.label;
      }
      if (l.evaluated && (!had.evaluated || l.evaluated > had.evaluated)) had.evaluated = l.evaluated;
    }
  }
  const out = [];
  for (const l of byKey.values()) {
    if (l.conflict) excluded['records disagree'] = (excluded['records disagree'] ?? 0) + 1;
    else out.push(l);
  }
  return out.sort((a, b) => a.position - b.position || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)).map(({ position, conflict, ...l }) => l);
}

const count = (excluded, reason, n = 1) => {
  if (n) excluded[reason] = (excluded[reason] ?? 0) + n;
};

// A classification's date as YYYY-MM-DD, from the ways tables write it: 2024-03-01, 2024/03/01,
// "Mar 1, 2024" (ClinVar's tabular download), "1 Mar 2024"; null when it reads none.
const NO_DATE = /^(|-|—|na|n\/a|none|not provided)$/i;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
export function readDate(text) {
  const s = String(text ?? '').trim();
  if (NO_DATE.test(s)) return null;
  const two = (n) => String(n).padStart(2, '0');
  const valid = (y, m, d) => (y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${two(m)}-${two(d)}` : null);
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?!\d)/.exec(s);
  if (m) return valid(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^([A-Za-z]{3})[a-z]*\.? (\d{1,2}),? (\d{4})$/.exec(s);
  if (m && MONTHS.includes(m[1].toLowerCase())) return valid(Number(m[3]), MONTHS.indexOf(m[1].toLowerCase()) + 1, Number(m[2]));
  m = /^(\d{1,2}) ([A-Za-z]{3})[a-z]*\.? (\d{4})$/.exec(s);
  if (m && MONTHS.includes(m[2].toLowerCase())) return valid(Number(m[3]), MONTHS.indexOf(m[2].toLowerCase()) + 1, Number(m[1]));
  return null;
}

// Whether a classification is kept by rules.evaluatedBefore (a year): last evaluated before its
// first day; one with no date is left out, since it may be of any year. Counts what it leaves out.
function evaluatedInTime(evaluated, rules, excluded) {
  const year = rules.evaluatedBefore;
  if (!Number.isInteger(year)) return true;
  if (!evaluated) {
    count(excluded, 'no date last evaluated');
    return false;
  }
  if (evaluated >= `${year}-01-01`) {
    count(excluded, `last evaluated in or after ${year}`);
    return false;
  }
  return true;
}

// Controls from ClinVar's records of the gene (the ClinVar annotation's table: providers/clinvar.js),
// placed on the target as ClinVar's track places them (the transcript most records name, numbered
// by the target's offset where the residues agree). rules: { minStars (1: criteria provided),
// kinds (['missense']), evaluatedBefore (a year; none if not given) }. Pathogenic and likely
// pathogenic records are P, benign and likely benign B; conflicting, uncertain and other
// classifications are left out. Returns { labels, excluded: { reason: n }, transcript, records,
// notes, problem }.
export function clinvarControls(text, target, rules = {}) {
  const minStars = rules.minStars ?? 1;
  const kinds = rules.kinds ?? ['missense'];
  const rows = readClinVarTable(text);
  const excluded = {};
  const tally = new Map();
  for (const r of rows) tally.set(r.transcript, (tally.get(r.transcript) ?? 0) + 1);
  const transcript = [...tally].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? null;
  const items = [];
  for (const r of rows) {
    if (r.transcript !== transcript) {
      count(excluded, 'on another transcript');
      continue;
    }
    const s = readSubstitution(r.hgvs_p);
    if (!s) {
      count(excluded, 'not a single substitution');
      continue;
    }
    items.push({ refPosition: s.position, ref: s.ref, alt: s.alt, row: r });
  }
  const placed = place(items, target, target.offset ?? 0);
  if (placed.problem) return { labels: [], excluded, transcript, records: rows.length, notes: [], problem: `ClinVar on ${transcript}: ${placed.problem}` };
  count(excluded, 'outside the target', placed.outside);
  count(excluded, 'another residue on the target', placed.disagree.length);
  const labels = [];
  for (const { position, ref, alt, row } of placed.placed) {
    const cls = clinvarClass(row.classification);
    const side = cls === 'pathogenic' ? 'P' : cls === 'benign' ? 'B' : null;
    if (!side) {
      count(excluded, cls === 'conflicting' ? 'conflicting classifications' : cls === 'uncertain' ? 'uncertain significance' : 'other or no classification');
      continue;
    }
    const stars = REVIEW_STARS[row.review_status.toLowerCase()] ?? 0;
    if (stars < minStars) {
      count(excluded, `fewer than ${minStars} review star${minStars === 1 ? '' : 's'}`);
      continue;
    }
    const kind = variantKind(ref, alt);
    if (!kinds.includes(kind)) {
      count(excluded, `${kind} (not chosen)`);
      continue;
    }
    if (!evaluatedInTime(row.last_evaluated, rules, excluded)) continue;
    labels.push({ key: substitutionKey(ref, position, alt), position, side, label: row.classification, kind, variant: row.hgvs_p, ids: [row.accession], stars, ...(row.last_evaluated ? { evaluated: row.last_evaluated } : {}) });
  }
  return { labels: merged(labels, excluded), excluded, transcript, records: rows.length, notes: [], problem: null };
}

const VARIANT_COLUMNS = ['variant', 'hgvs_pro', 'hgvs_p', 'protein_change', 'hgvs', 'name', 'title'];
const LABEL_COLUMNS = ['label', 'class', 'classification', 'clinical_significance', 'germline_classification', 'significance', 'side'];
// When each label was last evaluated (optional; ClinVar's tabular download calls it "Germline date
// last evaluated"), read as the ClinVar annotation's dates are (wave 8, slice 6).
const DATE_COLUMNS = ['last_evaluated', 'date_last_evaluated', 'germline_date_last_evaluated', 'evaluated', 'date_evaluated', 'last_reviewed', 'date'];
const columnKey = (name) => name.trim().toLowerCase().replace(/[\s()]+/g, '_').replace(/_+$/, '');

// Controls from a table of labels: a column of variants (MAVE-HGVS protein changes, one-letter
// changes such as W36A, or ClinVar's titles), a column of labels (pathogenic, likely pathogenic,
// benign, likely benign, abnormal, normal, or P, LP, B, LB) and, optionally, one of the date each
// was last evaluated. Numbered on the reference (the target's offset) or on the target, whichever
// the residues agree with (rules.numbering: 'reference' or 'target' to say). rules.kinds: all three
// if not given; rules.evaluatedBefore as ClinVar's. Returns { labels, excluded, numbering, rows,
// dated (whether it has a column of dates), notes, problem }.
export function tableControls(text, target, rules = {}) {
  const kinds = rules.kinds ?? KINDS;
  const table = parseTable(String(text), {});
  const find = (names) => table.columns.find((c) => names.includes(columnKey(c.name))) ?? null;
  const variantCol = find(VARIANT_COLUMNS);
  const labelCol = find(LABEL_COLUMNS);
  const dateCol = find(DATE_COLUMNS);
  if (!variantCol || !labelCol) {
    return { labels: [], excluded: {}, numbering: null, rows: table.rows, notes: [], problem: `The table needs a column of variants (${VARIANT_COLUMNS.slice(0, 4).join(', ')}) and one of labels (${LABEL_COLUMNS.slice(0, 4).join(', ')}); it has ${table.columns.map((c) => `"${c.name}"`).join(', ') || 'none'}.` };
  }
  const variants = columnText(variantCol);
  const words = columnText(labelCol);
  const dates = dateCol ? columnText(dateCol) : [];
  const excluded = {};
  const unread = new Map();
  const items = [];
  for (let r = 0; r < table.rows; r += 1) {
    const side = labelSide(words[r]);
    if (!side) {
      const w = String(words[r] ?? '').trim() || '(empty)';
      unread.set(w, (unread.get(w) ?? 0) + 1);
      continue;
    }
    const s = readChange(variants[r]);
    if (!s) {
      count(excluded, 'not a single protein substitution');
      continue;
    }
    items.push({ refPosition: s.position, ref: s.ref, alt: s.alt, side, label: String(words[r]).trim(), variant: String(variants[r]).trim(), row: r + 2, evaluated: dateCol ? readDate(dates[r]) : null });
  }
  for (const [w, n] of unread) count(excluded, `label not read: "${w}"`, n);
  const offset = target.offset ?? 0;
  const tries = rules.numbering === 'target' ? [['target', 0]] : rules.numbering === 'reference' || !offset ? [['reference', offset]] : [['reference', offset], ['target', 0]];
  let best = null;
  for (const [numbering, by] of tries) {
    const placed = place(items, target, by);
    const score = placed.placed.length - placed.disagree.length;
    if (!placed.problem && (!best || score > best.score)) best = { numbering, placed, score };
  }
  if (!best) return { labels: [], excluded, numbering: null, rows: table.rows, dated: Boolean(dateCol), notes: [], problem: `Over a tenth of the table's residues disagree with the target, numbered on the reference or on the target: its variants are of another protein, or another numbering.` };
  count(excluded, 'outside the target', best.placed.outside);
  count(excluded, 'another residue on the target', best.placed.disagree.length);
  const labels = [];
  for (const { position, ref, alt, side, label, variant, row, evaluated } of best.placed.placed) {
    const kind = variantKind(ref, alt);
    if (!kinds.includes(kind)) {
      count(excluded, `${kind} (not chosen)`);
      continue;
    }
    if (!evaluatedInTime(evaluated, rules, excluded)) continue;
    labels.push({ key: substitutionKey(ref, position, alt), position, side, label, kind, variant, ids: [`row ${row}`], ...(evaluated ? { evaluated } : {}) });
  }
  const notes = offset && tries.length > 1 ? [`Numbered on the ${best.numbering === 'reference' ? `reference (the target's offset, ${offset})` : 'target itself'}: its residues agree there.`] : [];
  if (dateCol) {
    const unreadDates = best.placed.placed.filter((x) => !x.evaluated && !NO_DATE.test(String(dates[x.row - 2] ?? '').trim())).length;
    if (unreadDates) notes.push(`${plural(unreadDates, 'date')} in "${dateCol.name}" not read (written as 2024-03-01, 2024/03/01 or Mar 1, 2024).`);
  }
  return { labels: merged(labels, excluded), excluded, numbering: best.numbering, rows: table.rows, dated: Boolean(dateCol), notes, problem: null };
}

// A control set from what clinvarControls or tableControls read: { name, source, rules, labels,
// excluded, notes }, its id and creation time given by the workspace (addControlSet).
export function makeControlSet({ name, source, rules, read }) {
  return { name, source, rules, labels: read.labels, excluded: read.excluded, notes: read.notes ?? [] };
}

// A set's labels counted: { P: { total, labels: { words: n }, stars: [n0…n4], kinds: { kind: n } },
// B: … }.
export function composition(set) {
  const out = {};
  for (const side of SIDES) out[side] = { total: 0, labels: {}, stars: [0, 0, 0, 0, 0], kinds: {} };
  for (const l of set.labels) {
    const c = out[l.side];
    c.total += 1;
    c.labels[l.label] = (c.labels[l.label] ?? 0) + 1;
    if (Number.isInteger(l.stars)) c.stars[l.stars] += 1;
    c.kinds[l.kind] = (c.kinds[l.kind] ?? 0) + 1;
  }
  return out;
}

// A set matched to a run's results at the protein level (a nucleotide run's protein view): for each
// label (in the set's order), its row in those results and its state: 'scored' (a finite score in
// the condition), 'not scored' (in the run, filtered or missing) or 'not in the run'. Returns
// { rows: Int32Array (-1 when not in the run), states: [state], counts: { P: { scored, 'not
// scored', 'not in the run' }, B: … }, view (the results the rows index) }.
export function matchControls(set, results, condition = 0) {
  const view = proteinView(results) ?? results;
  const index = new Map();
  for (let i = 0; i < view.rows; i += 1) index.set(view.variants.key[i], i);
  const score = view.conditions[condition]?.score;
  const rows = new Int32Array(set.labels.length).fill(-1);
  const states = [];
  const counts = { P: { scored: 0, 'not scored': 0, 'not in the run': 0 }, B: { scored: 0, 'not scored': 0, 'not in the run': 0 } };
  set.labels.forEach((l, k) => {
    const i = index.get(l.key);
    const state = i === undefined ? 'not in the run' : Number.isFinite(score?.[i]) ? 'scored' : 'not scored';
    if (i !== undefined) rows[k] = i;
    states.push(state);
    counts[l.side][state] += 1;
  });
  return { rows, states, counts, view };
}

// The year an assay was published: its MaveDB record's publication, else the year in its design's
// citation; null when neither says.
export function assayYear(ws, design) {
  for (const r of ws?.records ?? []) if (Number.isInteger(r.publication?.year)) return r.publication.year;
  const m = /\b(19|20)\d{2}\b/.exec(String(design?.source?.citation ?? ''));
  return m ? Number(m[0]) : null;
}

// What may make a set's labels circular for a run: [{ id, text, n }]. matched: matchControls's
// result for the run (the counts of controls measured).
export function circularity(set, { ws, run, matched }) {
  const out = [];
  const p = run?.inputs?.parameters ?? {};
  const design = run?.inputs?.design ?? ws?.design ?? null;
  const ofKind = (kind) => set.labels.filter((l) => l.kind === kind);
  // Labels that anchor the run's own scale.
  const nonsense = ofKind('nonsense');
  const nonsenseAnchor = /nonsense/.test(p.rescale ?? '') || (p.model === 'bins' && /nonsense/.test(p.binScale ?? ''));
  if (nonsense.length && nonsenseAnchor) out.push({ id: 'anchor-nonsense', n: nonsense.length, text: `${plural(nonsense.length, 'nonsense control')}: the run's scale is set by the nonsense variants (${p.model === 'bins' ? 'its bins\' scale' : 'its rescaling'}), so they score where the scale puts them, not as evidence.` });
  const synonymous = ofKind('synonymous');
  const synonymousAnchor = p.normalization === 'synonymous' || /synonymous/.test(p.rescale ?? '');
  if (synonymous.length && synonymousAnchor) out.push({ id: 'anchor-synonymous', n: synonymous.length, text: `${plural(synonymous.length, 'synonymous control')}: the run's scores are set relative to the synonymous variants (${p.normalization === 'synonymous' ? 'its normalization' : 'its rescaling'}), so they score where the scale puts them, not as evidence.` });
  // Published scores: how their scale was set is the authors' (wave 8, slice 6).
  if (p.model === 'published' && (nonsense.length || synonymous.length)) {
    const n = nonsense.length + synonymous.length;
    const which = [nonsense.length ? plural(nonsense.length, 'nonsense control') : null, synonymous.length ? plural(synonymous.length, 'synonymous control') : null].filter(Boolean).join(' and ');
    out.push({ id: 'anchor-published', n, text: `${which} on published scores: how their scale was set is not recorded here. Where the authors normalized or rescaled them by such variants, as most do, ${n === 1 ? 'it scores' : 'they score'} where the scale puts ${n === 1 ? 'it' : 'them'}, not as evidence.` });
  }
  // Labels that are the design's own controls, named.
  const named = new Set([...(Array.isArray(design?.controls?.synonymous) ? design.controls.synonymous : []), ...(Array.isArray(design?.controls?.nonsense) ? design.controls.nonsense : [])]);
  const own = set.labels.filter((l) => named.has(l.key) || named.has(l.variant));
  if (own.length) out.push({ id: 'design-controls', n: own.length, text: `${plural(own.length, 'control')} ${own.length === 1 ? 'is' : 'are'} among the design's own named controls.` });
  // Classifications that may rest on this assay (ACMG/AMP's functional evidence, PS3/BS3): ClinVar's,
  // or a table's whose dates it gives (wave 8, slice 6). A set made of those evaluated before the
  // assay (rules.evaluatedBefore) has none.
  const clinvar = set.source?.kind === 'clinvar';
  if (clinvar || set.labels.some((l) => l.evaluated)) {
    const year = assayYear(ws, design);
    const whose = clinvar ? 'by ClinVar\'s submitters ' : '';
    if (year) {
      const since = set.labels.filter((l) => l.evaluated && l.evaluated >= `${year}-01-01`);
      if (since.length) out.push({ id: 'evaluated-since', n: since.length, text: `${plural(since.length, 'control')} ${since.length === 1 ? 'was' : 'were'} last evaluated ${whose}in or after ${year}, when this assay was published: ${since.length === 1 ? 'its classification' : 'their classifications'} may rest on it (functional evidence, PS3 or BS3).` });
    } else if (!Number.isInteger(set.rules?.evaluatedBefore)) out.push({ id: 'evaluated-since', n: null, text: `When this assay was published is not recorded: ${clinvar ? 'ClinVar\'s classifications' : 'classifications'} evaluated since then may rest on it (functional evidence, PS3 or BS3).` });
  }
  // The same publication as the assay's.
  const doi = (text) => /\b10\.\d{4,9}\/\S+?(?=[\s;,]|\.?$)/i.exec(String(text ?? ''))?.[0]?.toLowerCase() ?? null;
  const assayDoi = doi(design?.source?.citation) ?? (ws?.records ?? []).map((r) => doi(r.citation)).find(Boolean) ?? null;
  if (set.source?.kind === 'table' && assayDoi && doi(set.source.citation) === assayDoi) out.push({ id: 'same-publication', n: set.labels.length, text: `The labels come from this assay's own publication (${assayDoi}): they may rest on its scores.` });
  // Few controls measured.
  for (const side of SIDES) {
    const n = matched ? matched.counts[side].scored : set.labels.filter((l) => l.side === side).length;
    if (n < FEW_CONTROLS) out.push({ id: `few-${side}`, n, text: `${n === 0 ? 'No' : `Only ${n}`} ${side} control${n === 1 ? '' : 's'} ${matched ? 'scored in the run' : 'in the set'}: with fewer than ${FEW_CONTROLS}, every measure of how the scores separate the sides is too uncertain to rely on.` });
  }
  // A predictor whose classes were set with ClinVar's classifications.
  if (set.source?.kind === 'clinvar' && (ws?.annotations ?? []).some((a) => a.provider === 'alphamissense')) out.push({ id: 'predictor', n: null, text: 'AlphaMissense\'s classes beside the map were set with ClinVar\'s classifications (Cheng et al. 2023): judged against these controls, they are not independent of them.' });
  return out;
}

// A set in a sentence: its name, source and sides.
export function controlSetWords(set) {
  const c = composition(set);
  const before = beforeWords(set);
  const from = set.source?.kind === 'clinvar' ? `ClinVar (${set.source.transcript ?? 'its records'}, at least ${plural(set.rules?.minStars ?? 1, 'review star')}; ${(set.rules?.kinds ?? ['missense']).join(', ')}${before ? `; ${before}` : ''})` : `the table ${set.source?.file?.fileName ?? ''}${set.source?.citation ? ` (${set.source.citation})` : ''}${before ? `, ${before}` : ''}`;
  return `"${set.name}", from ${from}: ${plural(c.P.total, 'P control')} and ${plural(c.B.total, 'B control')}`;
}

// A set's date rule in words ("last evaluated before 2018"), or '' without one.
export const beforeWords = (set) => (Number.isInteger(set?.rules?.evaluatedBefore) ? `last evaluated before ${set.rules.evaluatedBefore}` : '');
