// A design from a sample sheet: one row per sequenced sample, with the count column (or file) it
// is, its role, replicate, condition, time or bin, tile and batch (requirement D13: "designs from
// a sample sheet"). Column names are matched loosely (sample, sample_name, column…); DiMSum's
// experiment design file (sample_name, experiment_replicate, selection_id, technical_replicate)
// is one such sheet. A sample shared by several replicates (one input library selected several
// times) is listed once, with the replicates that share it ("1;2;3"), or with no replicate, when
// every replicate of its condition and tile shares it; one selected under several conditions lists
// them too ("Without ligand;With ligand", wave 2 slice 10).
//
// sampleSheetCSV writes a design back as a sheet (wave 2, slice 10: the analysis package), one row
// per column of counts, and says whether reading it gives the same design (designStructure): the
// sheet leaves out the gates, the readout, the controls and the target, which design.json keeps.

import { cellText, parseTable } from './csv.js';
import { replicateSamples } from './design.js';

const ALIASES = {
  column: ['column', 'count_column', 'counts_column', 'sample_name', 'sample', 'name', 'file'],
  role: ['role', 'type', 'sample_type', 'selection_id', 'selection'],
  replicate: ['replicate', 'rep', 'biological_replicate', 'bio_replicate', 'experiment_replicate', 'selection_replicate'],
  technical: ['technical_replicate', 'technical', 'tech_replicate', 'tech_rep'],
  condition: ['condition', 'treatment', 'group'],
  time: ['time', 'timepoint', 'time_point', 'generation', 'generations', 'round', 'day', 'hours'],
  bin: ['bin', 'bin_order', 'gate'],
  value: ['value', 'bin_value', 'weight', 'fluorescence', 'mean_fluorescence'],
  tile: ['tile', 'region'],
  batch: ['batch', 'run', 'lane', 'library', 'library_prep'],
  cells: ['cells', 'cell_count', 'sorted_cells'],
};

const ROLE_WORDS = {
  input: ['input', 'in', 'pre', 'before', 'unselected', 'library', 'lib', '0', 'naive', 'plasmid'],
  output: ['output', 'out', 'post', 'after', 'selected', 'sel', '1', 'sorted'],
  timepoint: ['timepoint', 'time', 'tp', 'time point'],
  bin: ['bin', 'gate'],
};

function findColumns(table) {
  const found = {};
  const names = table.columns.map((c) => c.name);
  for (const [field, aliases] of Object.entries(ALIASES)) {
    const name = names.find((n) => aliases.includes(n.trim().toLowerCase().replace(/[\s-]+/g, '_')));
    if (name && !Object.values(found).includes(name)) found[field] = name;
  }
  return found;
}

function roleOf(text) {
  const word = String(text ?? '').trim().toLowerCase();
  for (const [role, words] of Object.entries(ROLE_WORDS)) if (words.includes(word)) return role;
  return null;
}

const slug = (text) => String(text).replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'x';
const number = (text) => (text === undefined || String(text).trim() === '' ? null : Number(String(text).trim()));
// "1", "1;2;3", "1, 2, 3" or "1 2 3": the replicate numbers (empty: none given).
const numbers = (text) => String(text ?? '').split(/[;,\s]+/).filter(Boolean).map(Number);

// The design a sample sheet describes. sheet: a parsed table (csv.js). options: { countColumns
// (the count table's columns, to match the sheet's names against), variants, targets, name,
// barcodeColumn (a table of barcodes) }.
// Returns { design, problems: [{ level, message, line? }], found (the sheet's column for each field) }.
export function designFromSampleSheet(sheet, options = {}) {
  const problems = [];
  const found = findColumns(sheet);
  const value = (field, row) => (found[field] ? cellText(sheet.columns.find((c) => c.name === found[field]), row) : undefined);
  const lineOf = (row) => sheet.lineOfRow?.[row] ?? row + 2;
  if (!found.column) {
    return { design: null, found, problems: [{ level: 'error', message: `The sheet names no column of counts: give a column called one of ${ALIASES.column.join(', ')}.` }] };
  }
  const countColumns = options.countColumns ? new Set(options.countColumns) : null;
  const rows = [];
  for (let r = 0; r < sheet.rows; r += 1) {
    const column = String(value('column', r) ?? '').trim();
    if (!column) continue;
    if (countColumns && !countColumns.has(column)) {
      problems.push({ level: 'error', message: `Line ${lineOf(r)}: "${column}" is not a column of the count table.`, line: lineOf(r) });
      continue;
    }
    const time = number(value('time', r));
    const bin = number(value('bin', r));
    let role = roleOf(value('role', r));
    if (!role && bin !== null) role = 'bin';
    if (!role && time !== null) role = time === 0 ? 'input' : 'timepoint';
    if (!role) {
      problems.push({ level: 'error', message: `Line ${lineOf(r)}: say whether "${column}" is an input, an output, a time point or a bin.`, line: lineOf(r) });
      continue;
    }
    const replicates = numbers(value('replicate', r));
    if (replicates.some((n) => !Number.isInteger(n) || n < 1)) {
      problems.push({ level: 'error', message: `Line ${lineOf(r)}: the replicate of "${column}" must be a number (or numbers, for a shared sample), not "${value('replicate', r)}".`, line: lineOf(r) });
      continue;
    }
    rows.push({
      line: lineOf(r), column, role, time: role === 'input' && time === null ? 0 : time, bin, value: number(value('value', r)),
      replicates: numbers(value('replicate', r)), technical: number(value('technical', r)) ?? 1,
      conditions: String(value('condition', r) ?? '').split(';').map((x) => x.trim()).filter(Boolean), tile: String(value('tile', r) ?? '').trim() || null,
      batch: String(value('batch', r) ?? '').trim() || null, cells: number(value('cells', r)),
    });
  }
  const hasBins = rows.some((r) => r.role === 'bin');
  const hasTimes = rows.some((r) => r.role === 'timepoint');
  const model = hasBins ? 'bins' : hasTimes ? 'time-series' : 'two-population';
  if (model === 'time-series') for (const r of rows) if (r.role === 'output') problems.push({ level: 'warning', message: `Line ${r.line}: "${r.column}" is an output in a time series; give it a time instead.`, line: r.line });

  // Conditions and tiles, in the order the sheet names them.
  const conditionIds = new Map();
  for (const r of rows) for (const c of r.conditions) if (!conditionIds.has(c)) conditionIds.set(c, slug(c));
  const tileIds = new Map();
  for (const r of rows) if (r.tile && !tileIds.has(r.tile)) tileIds.set(r.tile, `tile${tileIds.size + 1}`);

  // Samples: rows of one role, replicate, condition, tile and time or bin are technical
  // replicates of one sample (their columns summed).
  const samples = new Map();
  const sampleOfRow = new Map();
  for (const r of rows) {
    const key = [r.role, r.replicates.join(';') || '*', r.conditions.join(';'), r.tile ?? '', r.time ?? '', r.bin ?? ''].join('\u0001');
    if (!samples.has(key)) samples.set(key, { id: slug(r.column), name: r.column, columns: [], rows: [] });
    const sample = samples.get(key);
    sample.columns.push(r.column);
    sample.rows.push(r);
    sampleOfRow.set(r, sample);
    if (r.batch) sample.batch = r.batch;
    if (r.cells !== null) sample.cells = (sample.cells ?? 0) + r.cells;
  }
  for (const s of samples.values()) {
    s.rows.sort((a, b) => a.technical - b.technical);
    s.columns = s.rows.map((r) => r.column);
  }

  // Replicates: by condition, tile and replicate number. A row naming several replicates belongs
  // to each; a row naming none is shared by every replicate of its condition and tile.
  const groups = new Map();
  for (const r of rows) {
    for (const condition of r.conditions.length ? r.conditions : [null]) {
      for (const n of r.replicates) {
        const key = [condition ?? '', r.tile ?? '', n].join('\u0001');
        if (!groups.has(key)) groups.set(key, { condition, tile: r.tile, biological: n, rows: [] });
        groups.get(key).rows.push(r);
      }
    }
  }
  const shared = rows.filter((r) => !r.replicates.length);
  const replicates = [];
  for (const g of groups.values()) {
    const id = slug([g.condition, g.tile, `rep${g.biological}`].filter(Boolean).join('-'));
    const replicate = { id, name: [g.condition, g.tile, `replicate ${g.biological}`].filter(Boolean).join(', '), biological: g.biological };
    if (g.condition) replicate.condition = conditionIds.get(g.condition);
    if (g.tile) replicate.tile = tileIds.get(g.tile);
    const own = g.rows;
    const common = shared.filter((r) => (r.conditions.length ? r.conditions.includes(g.condition) : g.condition === null) && (r.tile ?? null) === (g.tile ?? null));
    const all = [...own, ...common.filter((c) => !own.some((o) => o.role === c.role && o.time === c.time && o.bin === c.bin))];
    const sampleId = (r) => sampleOfRow.get(r).id;
    if (model === 'two-population') {
      const input = all.find((r) => r.role === 'input');
      const output = all.find((r) => r.role === 'output');
      if (input) replicate.input = sampleId(input);
      if (output) replicate.output = sampleId(output);
    } else if (model === 'time-series') {
      const points = new Map();
      for (const r of all.filter((x) => x.role === 'input' || x.role === 'timepoint')) if (!points.has(r.time ?? 0)) points.set(r.time ?? 0, sampleId(r));
      replicate.timepoints = [...points].sort((a, b) => a[0] - b[0]).map(([time, sample]) => ({ sample, time }));
    } else {
      const bins = new Map();
      for (const r of all.filter((x) => x.role === 'bin')) if (!bins.has(r.bin)) bins.set(r.bin, { sample: sampleId(r), order: r.bin, value: r.value ?? r.bin });
      replicate.bins = [...bins.values()].sort((a, b) => a.order - b.order);
    }
    replicates.push(replicate);
  }
  if (!replicates.length && rows.length) problems.push({ level: 'error', message: 'No row gives a replicate number: say which biological replicate each sample belongs to.' });

  // Sample ids unique.
  const taken = new Set();
  const renamed = new Map();
  for (const s of samples.values()) {
    let id = s.id;
    let n = 2;
    while (taken.has(id)) id = `${s.id}-${n++}`;
    taken.add(id);
    if (id !== s.id) renamed.set(s.id, id);
    s.id = id;
  }
  const design = {
    format: 'mavescape-design',
    version: 1,
    name: options.name ?? 'Design from a sample sheet',
    model,
    variants: options.variants ?? { column: 'hgvs_pro', level: 'protein' },
    targets: options.targets ?? [],
    library: options.barcodeColumn ? { level: 'barcode', barcodeColumn: options.barcodeColumn } : { level: 'variant' },
    samples: [...samples.values()].map((s) => {
      const out = { id: s.id, name: s.name, columns: s.columns };
      if (s.batch) out.batch = s.batch;
      if (s.cells !== undefined) out.cells = s.cells;
      return out;
    }),
    replicates,
    controls: { wildType: 'auto', synonymous: 'auto', nonsense: 'auto' },
  };
  if (conditionIds.size) design.conditions = [...conditionIds].map(([name, id]) => ({ id, name }));
  if (tileIds.size) design.library.tiles = [...tileIds].map(([name, id]) => ({ id, name, start: 1, end: 1 }));
  if (model === 'time-series') design.time = { unit: found.time && /gen/i.test(found.time) ? 'generation' : found.time && /round/i.test(found.time) ? 'round' : found.time && /day/i.test(found.time) ? 'day' : found.time && /hour/i.test(found.time) ? 'hour' : 'other' };
  if (model === 'bins') design.bins = { weight: found.value && /fluor/i.test(found.value) ? 'fluorescence' : 'rank' };
  if (tileIds.size) problems.push({ level: 'warning', message: 'Give each tile the positions it covers in the Experiment view (a sheet does not say).' });
  if (countColumns) {
    const listed = new Set(rows.map((r) => r.column));
    const unlisted = [...countColumns].filter((c) => !listed.has(c));
    if (unlisted.length) design.ignoredColumns = unlisted.map((column) => ({ column, reason: 'not in the sample sheet' }));
  }
  return { design, problems, found };
}

// --- Writing a sheet (wave 2, slice 10) -------------------------------------------------------------

// The time column's name, which says the unit to the reader above.
const TIME_HEADERS = { generation: 'generation', round: 'round', day: 'day', hour: 'hours' };
const quote = (value) => {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

// A design's structure, the same for any two designs of one experiment however their ids were made:
// each replicate by its condition's and tile's names and biological number, with each slot's
// columns; each sample's columns, batch and cells; the unit of time and the bins' measure.
export function designStructure(design) {
  const samples = new Map((design.samples ?? []).map((x) => [x.id, x]));
  const columnsOf = (id) => (samples.get(id)?.columns ?? [`?${id}`]).join('+');
  const conditionName = (id) => (design.conditions ?? []).find((c) => c.id === id)?.name ?? '';
  const tileName = (id) => {
    const tile = (design.library?.tiles ?? []).find((t) => t.id === id);
    return tile ? tile.name ?? tile.id : '';
  };
  const slot = (x) => `${x.role === 'input' && design.model === 'time-series' ? 'timepoint@0' : x.role}${x.time !== undefined ? `@${x.time}` : ''}${x.order !== undefined ? `#${x.order}=${x.value}` : ''}:${columnsOf(x.sample)}`;
  return {
    model: design.model,
    time: design.model === 'time-series' ? design.time?.unit ?? null : null,
    bins: design.model === 'bins' ? design.bins?.weight ?? 'rank' : null,
    replicates: (design.replicates ?? []).map((r) => `${conditionName(r.condition)}|${tileName(r.tile)}|${r.biological}|${replicateSamples(r).map(slot).sort().join(',')}`).sort(),
    samples: (design.samples ?? []).map((x) => `${x.columns.join('+')}|${x.batch ?? ''}|${x.cells ?? ''}`).sort(),
  };
}

// The design as a sample sheet: { csv, complete }, one row per column of counts in use. complete:
// whether the reader gives back a design of the same structure (a sample used in two roles, or a
// unit of time or bin measure the sheet cannot name, is not). The gates, the readout, the controls
// and the target are design.json's alone.
export function sampleSheetCSV(design) {
  const model = design.model;
  const conditionName = (id) => (design.conditions ?? []).find((c) => c.id === id)?.name ?? null;
  const tileName = (id) => {
    const tile = (design.library?.tiles ?? []).find((t) => t.id === id);
    return tile ? tile.name ?? tile.id : null;
  };
  const timeHeader = TIME_HEADERS[design.time?.unit] ?? 'time';
  const valueHeader = design.bins?.weight === 'fluorescence' ? 'fluorescence' : 'value';
  const header = ['column', 'role', 'replicate', 'technical_replicate', 'condition', 'tile', ...(model === 'time-series' ? [timeHeader] : []), ...(model === 'bins' ? ['bin', valueHeader] : []), 'batch', 'cells'];
  // Each sample's uses: by role, time or bin, and tile (one row each).
  const uses = new Map();
  for (const r of design.replicates ?? []) {
    for (const x of replicateSamples(r)) {
      const role = model === 'time-series' ? 'timepoint' : x.role;
      const key = `${x.sample}\u0001${role}\u0001${x.time ?? ''}\u0001${x.order ?? ''}\u0001${x.value ?? ''}\u0001${r.tile ?? ''}`;
      if (!uses.has(key)) uses.set(key, { sample: x.sample, role, time: x.time, order: x.order, value: x.value, tile: r.tile ?? null, replicates: new Set(), conditions: new Set() });
      const use = uses.get(key);
      use.replicates.add(r.biological);
      if (r.condition) use.conditions.add(conditionName(r.condition));
    }
  }
  const rows = [];
  for (const sample of design.samples ?? []) {
    for (const use of [...uses.values()].filter((u) => u.sample === sample.id)) {
      sample.columns.forEach((column, k) => {
        rows.push([column, use.role, [...use.replicates].sort((a, b) => a - b).join(';'), k + 1, [...use.conditions].join(';'), tileName(use.tile),
          ...(model === 'time-series' ? [use.time] : []), ...(model === 'bins' ? [use.order, use.value] : []), sample.batch ?? null, k === 0 ? sample.cells ?? null : null]);
      });
    }
  }
  const text = `${[header, ...rows].map((row) => row.map(quote).join(',')).join('\n')}\n`;
  // Read back, the same structure?
  const back = designFromSampleSheet(parseTable(text), { variants: design.variants, targets: design.targets });
  const same = back.design && !back.problems.some((x) => x.level === 'error') && JSON.stringify(designStructure(back.design)) === JSON.stringify(designStructure(design));
  return { csv: text, complete: Boolean(same) };
}
