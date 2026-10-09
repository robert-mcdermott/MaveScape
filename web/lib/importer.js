// Import: from a parsed table (csv.js) to what the import wizard shows and the workspace keeps
// (requirements D2, D4, D6, D12, E4). It recognizes the layouts in common use (MaveDB's score and
// count tables, DiMSum's variant count table, a generic table of variants and samples), suggests
// each column's role from its name (shown as suggestions; nothing is applied until accepted),
// drafts a design from accepted roles, and lists every problem that blocks scoring, by line.
//
// Import templates (JSON, saved in the library as records of kind "import-template") keep a
// mapping to reuse on the next table of the same layout.

import { buildCountSet, identicalColumns } from './counts.js';
import { buildVariants, duplicateKeys, summarizeVariants, STATUS } from './variants.js';
import { parseHgvs } from './hgvs.js';
import { translate } from './target.js';
import { IDENTIFIER_COLUMNS } from './design.js';

export const TEMPLATE_FORMAT = 'mavescape-import';
export const TEMPLATE_VERSION = 1;

const SCORE_NAMES = /^(score|scores|fitness|effect|log_?ratio|lfc|log2fc|enrichment|abundance_score|raw_score|nor_fitness)$/i;
const SE_NAMES = /^(se|sem|std_?err(or)?|sigma|raw_sigma|score_?se|se_score|sd|nor_fitness_sigma|error)$/i;

function column(table, name) {
  return table.columns.find((c) => c.name === name) ?? null;
}

// The share of a sample of a column's values that read as variants, and the level they are at.
function variantColumnScore(values) {
  const sample = [];
  const step = Math.max(1, Math.floor(values.length / 200));
  for (let i = 0; i < values.length && sample.length < 200; i += step) if (values[i] && values[i] !== 'NA') sample.push(values[i]);
  if (!sample.length) return { share: 0, level: null };
  let protein = 0;
  let nucleotide = 0;
  for (const v of sample) {
    const parsed = parseHgvs(v, { mode: 'lenient' });
    if (!parsed.ok) continue;
    if (parsed.prefix === 'p') protein += 1;
    else nucleotide += 1;
  }
  return { share: (protein + nucleotide) / sample.length, level: protein >= nucleotide ? 'protein' : 'nucleotide' };
}

// The layout of a table: { layout, variantColumn, level, countColumns, scoreColumns, notes }.
// layout: 'mavedb-counts' | 'mavedb-scores' | 'dimsum' | 'generic' | 'unknown'.
export function detectLayout(table) {
  const names = table.columns.map((c) => c.name);
  // Columns of numbers, and columns of numbers with a few cells that are not (they stay, so that
  // the count set lists those cells by line rather than the column being left out silently).
  const numeric = table.columns.filter((c) => c.type === 'number' || c.type === 'empty' || c.type === 'mixed').map((c) => c.name);
  const notes = [];
  if (names.includes('nt_seq')) {
    return { layout: 'dimsum', variantColumn: 'nt_seq', level: 'nucleotide-sequence', countColumns: numeric, scoreColumns: {}, notes: ['DiMSum\'s variant count table: each row is a whole nucleotide sequence, named by comparing it with the wild type.'] };
  }
  if (names.includes('accession') && (names.includes('hgvs_pro') || names.includes('hgvs_nt'))) {
    // MaveDB indexes a table by hgvs_nt when it is given (several nucleotide variants may share
    // one protein name), else by hgvs_pro.
    const filled = (name) => (column(table, name)?.values ?? []).filter((v) => v && v !== 'NA').length;
    const level = filled('hgvs_nt') === table.rows ? 'nucleotide' : 'protein';
    const variantColumn = level === 'protein' ? 'hgvs_pro' : 'hgvs_nt';
    const data = numeric.filter((n) => !IDENTIFIER_COLUMNS.includes(n));
    if (names.includes('score')) {
      notes.push('MaveDB score table: scores and their columns of uncertainty, with variants in MAVE-HGVS.');
      return { layout: 'mavedb-scores', variantColumn, level, countColumns: [], scoreColumns: scoreColumnsOf(data), notes };
    }
    notes.push('MaveDB count table: one column per sample, with variants in MAVE-HGVS.');
    return { layout: 'mavedb-counts', variantColumn, level, countColumns: data, scoreColumns: {}, notes };
  }
  let best = null;
  for (const c of table.columns) {
    if (c.type === 'number' || c.type === 'empty') continue;
    const score = variantColumnScore(c.values);
    if (score.share >= 0.8 && (!best || score.share > best.share)) best = { name: c.name, ...score };
  }
  if (!best) return { layout: 'unknown', variantColumn: null, level: null, countColumns: numeric, scoreColumns: {}, notes: ['No column reads as variant names (MAVE-HGVS, or forms like A12V). Choose the column of variants.'] };
  const scores = scoreColumnsOf(numeric);
  const countColumns = numeric.filter((n) => n !== scores.score && n !== scores.se);
  notes.push(`A table of variants (column "${best.name}", ${Math.round(best.share * 100)}% of names read) and ${countColumns.length} numeric column${countColumns.length === 1 ? '' : 's'}.`);
  return { layout: 'generic', variantColumn: best.name, level: best.level, countColumns, scoreColumns: scores, notes };
}

function scoreColumnsOf(names) {
  const out = {};
  const score = names.find((n) => SCORE_NAMES.test(n));
  const se = names.find((n) => SE_NAMES.test(n));
  if (score) out.score = score;
  if (se) out.se = se;
  return out;
}

// --- Role suggestions --------------------------------------------------------------------------

const INPUT = /(?:^|[_\s.-])(input|in|pre|before|unselected|library|lib|naive|plasmid)(?=$|[_\s.\d-])|^input/i;
const OUTPUT = /(?:^|[_\s.-])(output|out|post|after|selected|sel|sorted)(?=$|[_\s.\d-])|^output/i;
const PATTERNS = {
  time: [/_c_(\d+(?:\.\d+)?)$/, /(?:^|[_\s.-])(?:t|time|tp)_?(\d+(?:\.\d+)?)(?=$|[_\s.-])/i, /(?:^|[_\s.-])gen(?:eration)?s?_?(\d+(?:\.\d+)?)(?=$|[_\s.-])/i, /(?:^|[_\s.-])(?:day|d)_?(\d+(?:\.\d+)?)(?=$|[_\s.-])/i, /(?:^|[_\s.-])(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hours)(?=$|[_\s.-])/i],
  bin: [/(?:^|[_\s.-])bin_?(\d+)(?=$|[_\s.-])/i],
  tile: [/(?:^|[_\s.-])tile_?(\d+)(?=$|[_\s.-])/i],
  replicate: [/(?:bio)?rep(?:licate)?_?(\d+)/i, /(?:^|[_\s.-])r(\d+)(?=$|[_\s.-])/i],
};

function first(patterns, name) {
  for (const p of patterns) {
    const m = p.exec(name);
    if (m) return { value: Number(m[1]), text: m[0] };
  }
  return null;
}

// Suggests each count column's role from its name: [{ column, role ('input' | 'output' |
// 'timepoint' | 'bin' | null), time, bin, tile, replicate, group, reason }]. `group` gathers the
// columns of one replicate (the name with the role, time and bin taken out). Suggestions only.
export function suggestRoles(columns) {
  return columns.map((name) => {
    const time = first(PATTERNS.time, name);
    const bin = first(PATTERNS.bin, name);
    const tile = first(PATTERNS.tile, name);
    const replicate = first(PATTERNS.replicate, name);
    let role = null;
    let reason = '';
    let group = name;
    if (bin) {
      role = 'bin';
      reason = `"${bin.text.replace(/^[_\s.-]/, '')}" names a sorting bin`;
      group = group.replace(bin.text, '');
    } else if (time) {
      role = 'timepoint';
      reason = `"${time.text.replace(/^[_\s.-]/, '')}" names time ${time.value}`;
      group = group.replace(time.text, '');
    } else if (INPUT.test(name)) {
      role = 'input';
      reason = `"${INPUT.exec(name)[0].replace(/^[_\s.-]/, '')}" names an input`;
      group = group.replace(INPUT, '');
    } else if (OUTPUT.test(name)) {
      role = 'output';
      reason = `"${OUTPUT.exec(name)[0].replace(/^[_\s.-]/, '')}" names an output`;
      group = group.replace(OUTPUT, '');
    }
    // DiMSum's "output1A": the letter after the replicate number is a technical replicate.
    group = group.replace(/(\d)[A-Z]$/, '$1').replace(/^[_\s.-]+|[_\s.-]+$/g, '') || 'all';
    return { column: name, role, time: time?.value ?? (role === 'input' ? 0 : null), bin: bin?.value ?? null, tile: tile?.value ?? null, replicate: replicate?.value ?? null, group, reason };
  });
}

const slug = (text) => String(text).replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'x';

// A design drafted from role suggestions (or accepted roles) and a table: the model each
// replicate's roles imply, samples (one per column, columns identical value for value made one
// shared sample with the copies set aside), replicates, tiles from the variants counted in each.
// Returns { design, notes }; the design is a draft for the Experiment view (validateDesign
// checks it there).
export function draftDesign(table, roles, options = {}) {
  const notes = [];
  const used = roles.filter((r) => r.role);
  const groups = new Map();
  for (const r of used) {
    if (!groups.has(r.group)) groups.set(r.group, []);
    groups.get(r.group).push(r);
  }
  const hasBins = used.some((r) => r.role === 'bin');
  const timed = [...groups.values()].some((g) => g.filter((r) => r.role === 'timepoint' || r.role === 'input').length > 2 || g.some((r) => r.role === 'timepoint'));
  const model = hasBins ? 'bins' : timed ? 'time-series' : 'two-population';
  // Identical columns: one sample, the rest copies.
  const copyOf = new Map();
  for (const group of identicalColumns(table, used.map((r) => r.column))) for (const c of group.slice(1)) copyOf.set(c, group[0]);
  const samples = [];
  const ignoredColumns = [];
  const sampleOf = new Map();
  for (const r of used) {
    if (copyOf.has(r.column)) {
      ignoredColumns.push({ column: r.column, reason: 'repeats a sample its replicates share', copyOf: copyOf.get(r.column) });
      continue;
    }
    const id = slug(r.column);
    sampleOf.set(r.column, id);
    samples.push({ id, name: r.column, columns: [r.column] });
  }
  const sampleFor = (column) => sampleOf.get(copyOf.get(column) ?? column);
  const replicates = [];
  const groupOf = new Map();
  const tiles = new Map();
  const biological = new Map();
  for (const [group, members] of groups) {
    const tile = members.find((m) => m.tile !== null)?.tile ?? null;
    const tileId = tile === null ? undefined : `tile${tile}`;
    const key = tileId ?? '';
    const numbered = members.find((m) => m.replicate !== null)?.replicate;
    const count = (biological.get(key) ?? 0) + 1;
    biological.set(key, count);
    // "count_rep1" says no more than its number: "Replicate 1". "PlusE2NewRep3" names a library too.
    const generic = /^(?:counts?|reads?)?[_\s.-]*(?:bio)?rep(?:licate)?[_\s.-]*\d+$/i.test(group);
    const replicate = { id: slug(group), name: generic && numbered !== undefined ? `Replicate ${numbered}` : group, biological: count };
    if (numbered !== undefined) replicate.biological = numbered;
    if (tileId) {
      replicate.tile = tileId;
      tiles.set(tileId, tile);
    }
    if (model === 'two-population') {
      const input = members.find((m) => m.role === 'input');
      const output = members.find((m) => m.role === 'output');
      if (input) replicate.input = sampleFor(input.column);
      if (output) replicate.output = sampleFor(output.column);
    } else if (model === 'time-series') {
      replicate.timepoints = members.filter((m) => m.role === 'timepoint' || m.role === 'input').map((m) => ({ sample: sampleFor(m.column), time: m.time ?? 0 })).sort((a, b) => a.time - b.time);
    } else {
      replicate.bins = members.filter((m) => m.role === 'bin').map((m) => ({ sample: sampleFor(m.column), order: m.bin, value: m.bin })).sort((a, b) => a.order - b.order);
    }
    replicates.push(replicate);
    groupOf.set(replicate, group);
  }
  // Replicates with different numbers of time points or bins look like different experiments
  // (BRCA1's table holds an E2-binding assay of six times and a yeast two-hybrid assay of four):
  // each kind becomes a condition, named by what its replicates' names share, so that they are not
  // combined unless the user says they are one experiment. (Different times alone are not enough:
  // BRCA1's two Y2H libraries were sampled on different schedules.)
  const shapeOf = (r) => (r.timepoints ? `${r.timepoints.length} time points` : r.bins ? `${r.bins.length} bins` : 'two populations');
  const shapes = new Map();
  for (const r of replicates) {
    if (!shapes.has(shapeOf(r))) shapes.set(shapeOf(r), []);
    shapes.get(shapeOf(r)).push(r);
  }
  const conditions = [];
  if (shapes.size > 1) {
    for (const [shape, members] of shapes) {
      let name = commonStem(members.map((r) => groupOf.get(r))) || shape[0].toUpperCase() + shape.slice(1);
      if (conditions.some((c) => c.name === name)) name = `${name} (${shape})`;
      const id = slug(name);
      conditions.push({ id, name });
      for (const r of members) r.condition = id;
    }
    notes.push(`Replicates differ in their number of ${model === 'bins' ? 'bins' : 'time points'} (${[...shapes.keys()].join('; ')}): they look like different experiments, so each is a condition (${conditions.map((c) => c.name).join(', ')}), scored apart. If they are one experiment, give them one condition in the Experiment view.`);
  }
  // Biological numbers repeated within a condition and tile (PlusE2Rep3 and PlusE2NewRep3 both
  // "3") are renumbered.
  let renumbered = false;
  for (const key of new Set(replicates.map((r) => `${r.condition ?? ''}|${r.tile ?? ''}`))) {
    const inTile = replicates.filter((r) => `${r.condition ?? ''}|${r.tile ?? ''}` === key);
    if (new Set(inTile.map((r) => r.biological)).size < inTile.length) {
      inTile.forEach((r, i) => { r.biological = i + 1; });
      renumbered = true;
    }
  }
  if (renumbered) notes.push('Replicate numbers in the column names repeat; replicates are numbered in order.');
  const design = {
    format: 'mavescape-design',
    version: 1,
    name: options.name ?? 'Draft design',
    model,
    variants: { column: options.variantColumn, level: options.level === 'nucleotide' ? 'nucleotide' : 'protein' },
    targets: options.target ? [options.target] : [],
    library: { level: 'variant' },
    samples,
    replicates,
    controls: { wildType: 'auto', synonymous: 'auto', nonsense: 'auto' },
  };
  if (conditions.length) design.conditions = conditions;
  if (tiles.size) design.library.tiles = [...tiles].sort((a, b) => a[1] - b[1]).map(([id, n]) => ({ id, name: `Tile ${n}`, ...tileRange(table, options, used.filter((r) => r.tile === n).map((r) => r.column)) }));
  if (model === 'time-series') design.time = { unit: 'other' };
  if (model === 'bins') {
    design.bins = { weight: 'rank' };
    notes.push('Bins are given their order as their value; set the values (VAMP-seq weights, or fluorescence) in the Experiment view.');
  }
  if (ignoredColumns.length) design.ignoredColumns = ignoredColumns;
  const unused = roles.filter((r) => !r.role).map((r) => r.column);
  if (unused.length) {
    design.ignoredColumns = [...(design.ignoredColumns ?? []), ...unused.map((c) => ({ column: c, reason: 'no role suggested' }))];
    notes.push(`${unused.length} column${unused.length > 1 ? 's have' : ' has'} no suggested role: ${unused.slice(0, 4).join(', ')}${unused.length > 4 ? ', …' : ''}.`);
  }
  return { design, notes };
}

// What names share at their start, without a trailing replicate number or separator:
// PlusE2Rep3, PlusE2NewRep4 → "PlusE2"; Y2H_1_Rep1, Y2H_2_Rep2 → "Y2H".
function commonStem(names) {
  if (!names.length) return '';
  let prefix = names[0];
  for (const n of names) while (!n.startsWith(prefix)) prefix = prefix.slice(0, -1);
  return prefix.replace(/(?:[_\s.-]*(?:bio)?rep(?:licate)?[_\s.-]*\d*|[_\s.-]+\d*)$/i, '');
}

// The positions counted in a tile's columns (from the variants' first positions).
function tileRange(table, options, columns) {
  const names = table.columns.find((c) => c.name === options.variantColumn)?.values ?? [];
  let start = Infinity;
  let end = -Infinity;
  const cols = columns.map((c) => table.columns.find((x) => x.name === c)).filter(Boolean);
  for (let i = 0; i < names.length; i += 1) {
    if (!cols.some((c) => Number.isFinite(c.numeric?.[i]))) continue;
    const parsed = parseHgvs(names[i], { mode: 'lenient' });
    if (!parsed.ok) continue;
    for (const comp of parsed.components) {
      const p = comp.start?.position;
      if (p > 0) {
        start = Math.min(start, p);
        end = Math.max(end, comp.end?.position ?? p);
      }
    }
  }
  return Number.isFinite(start) ? { start, end } : { start: 1, end: 1 };
}

// --- DiMSum's sequences --------------------------------------------------------------------------

// Names DiMSum's whole sequences by comparing each with the wild type (same length, substitutions
// only): c.[…] at the nucleotide level and the protein change it makes. Returns { nt: [], pro: [],
// problems }.
export function namesFromSequences(sequences, wildType) {
  const wt = wildType.toUpperCase();
  const wtProtein = translate(wt).protein;
  const nt = [];
  const pro = [];
  const problems = [];
  for (const [row, raw] of sequences.entries()) {
    const s = raw.toUpperCase();
    if (s.length !== wt.length || !/^[ACGT]+$/.test(s)) {
      nt.push('');
      pro.push('');
      if (problems.length < 20) problems.push({ row, message: s.length !== wt.length ? `the sequence is ${s.length} bases, the wild type ${wt.length}` : 'the sequence holds letters other than A, C, G, T' });
      continue;
    }
    const changes = [];
    for (let i = 0; i < s.length; i += 1) if (s[i] !== wt[i]) changes.push(`${i + 1}${wt[i]}>${s[i]}`);
    nt.push(changes.length === 0 ? 'c.=' : changes.length === 1 ? `c.${changes[0]}` : `c.[${changes.join(';')}]`);
    const protein = translate(s).protein;
    const aa = [];
    for (let i = 0; i < protein.length; i += 1) {
      if (protein[i] !== wtProtein[i]) aa.push(`${THREE[wtProtein[i]]}${i + 1}${THREE[protein[i]]}`);
    }
    pro.push(changes.length === 0 ? 'p.=' : aa.length === 0 ? 'p.(=)' : aa.length === 1 ? `p.${aa[0]}` : `p.[${aa.join(';')}]`);
  }
  return { nt, pro, problems };
}

const THREE = { A: 'Ala', R: 'Arg', N: 'Asn', D: 'Asp', C: 'Cys', Q: 'Gln', E: 'Glu', G: 'Gly', H: 'His', I: 'Ile', L: 'Leu', K: 'Lys', M: 'Met', F: 'Phe', P: 'Pro', S: 'Ser', T: 'Thr', W: 'Trp', Y: 'Tyr', V: 'Val', '*': 'Ter' };

// --- The review the wizard shows -------------------------------------------------------------

// Everything the import wizard shows for a table and a mapping, and what blocks scoring:
// { variants, summary, duplicates, countSet, blocking: [problem], warnings: [problem], info }.
// mapping: { variantColumn, level, countColumns, mode, target }.
export function reviewImport(table, mapping) {
  const blocking = [];
  const warnings = [];
  const info = [];
  for (const d of table.diagnostics ?? []) (d.level === 'error' ? blocking : d.level === 'warning' ? warnings : info).push(d);
  const names = column(table, mapping.variantColumn)?.values;
  if (!names) {
    blocking.push({ level: 'error', code: 'no-variant-column', message: 'Choose the column of variant names.' });
    return { variants: null, summary: null, duplicates: [], countSet: null, blocking, warnings, info };
  }
  const variants = buildVariants(names, { level: mapping.level ?? 'protein', mode: mapping.mode ?? 'lenient', target: mapping.target });
  const summary = summarizeVariants(variants);
  const lineOf = (row) => table.lineOfRow?.[row] ?? row + 2;
  const invalidRows = [];
  for (let i = 0; i < variants.n; i += 1) if (variants.status[i] === STATUS.INVALID) invalidRows.push(i);
  if (invalidRows.length) {
    const shown = invalidRows.slice(0, 4).map((r) => `"${variants.original[r]}" (line ${lineOf(r)}: ${variants.messages.get(r)?.[0] ?? 'invalid'})`).join('; ');
    warnings.push({ level: 'warning', code: 'invalid-variants', message: `${invalidRows.length} variant name${invalidRows.length > 1 ? 's are' : ' is'} not valid or do${invalidRows.length > 1 ? '' : 'es'} not agree with the target, and will not be scored: ${shown}${invalidRows.length > 4 ? '; …' : ''}.`, lines: invalidRows.slice(0, 100).map(lineOf) });
  }
  if (summary.warning) info.push({ level: 'info', code: 'lenient', message: `${summary.warning} variant name${summary.warning > 1 ? 's were' : ' was'} read leniently (written in MAVE-HGVS, the originals kept).` });
  const duplicates = duplicateKeys(variants);
  if (duplicates.length) {
    const shown = duplicates.slice(0, 3).map((d) => `${d.key} (lines ${d.rows.map(lineOf).join(', ')})`).join('; ');
    blocking.push({ level: 'error', code: 'duplicate-variants', message: `${duplicates.length} variant${duplicates.length > 1 ? 's appear' : ' appears'} on more than one row: ${shown}${duplicates.length > 3 ? '; …' : ''}. Which row's counts are right is not for MaveScape to guess.`, lines: duplicates.slice(0, 50).flatMap((d) => d.rows.map(lineOf)) });
  }
  let countSet = null;
  if (mapping.countColumns?.length) {
    countSet = buildCountSet(table, { variantColumn: mapping.variantColumn, countColumns: mapping.countColumns });
    for (const p of countSet.problems) (p.level === 'error' ? blocking : p.level === 'warning' ? warnings : info).push(p);
    const copies = identicalColumns(table, mapping.countColumns);
    for (const group of copies) info.push({ level: 'info', code: 'identical-columns', message: `Columns ${group.map((c) => `"${c}"`).join(', ')} are identical, value for value: one sample written once per replicate (a shared input)?`, columns: group });
  }
  return { variants, summary, duplicates, countSet, blocking, warnings, info };
}

// --- Templates -------------------------------------------------------------------------------

export function makeTemplate(name, table, mapping) {
  return {
    format: TEMPLATE_FORMAT,
    version: TEMPLATE_VERSION,
    name,
    modified: new Date().toISOString(),
    columns: table.columns.map((c) => c.name),
    variantColumn: mapping.variantColumn,
    level: mapping.level,
    countColumns: mapping.countColumns,
    scoreColumns: mapping.scoreColumns ?? {},
    mode: mapping.mode ?? 'lenient',
    absentMeans: mapping.absentMeans ?? 'missing',
    roles: mapping.roles ?? null,
  };
}

// Whether a template fits a table: its variant and count columns are all there. Returns the
// mapping to use, or null.
export function applyTemplate(template, table) {
  if (template?.format !== TEMPLATE_FORMAT) return null;
  const names = new Set(table.columns.map((c) => c.name));
  if (!names.has(template.variantColumn) || !template.countColumns.every((c) => names.has(c))) return null;
  return { variantColumn: template.variantColumn, level: template.level, countColumns: template.countColumns.slice(), scoreColumns: { ...template.scoreColumns }, mode: template.mode, absentMeans: template.absentMeans, roles: template.roles, template: template.name };
}
