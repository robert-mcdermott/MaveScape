// Edits of a design (mavescape-design v1), for the Experiment view: each takes a design and
// returns a new one (nothing is mutated), so every edit can be undone and logged (requirements
// E2, E6). The editor shows a design as two tables:
//   columns → samples: each count column is a sample's (technical replicates are several columns
//     of one sample), a copy of another column (a shared sample written once per replicate), or set
//     aside with a reason;
//   replicates × slots: each replicate's sample in each slot — input and output (two populations),
//     each time (time series) or each bin (bins).

const slug = (text) => String(text).replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'x';

function uniqueId(base, taken) {
  const clean = slug(base);
  if (!taken.has(clean)) return clean;
  let n = 2;
  while (taken.has(`${clean}-${n}`)) n += 1;
  return `${clean}-${n}`;
}

export function emptyDesign({ name = 'Experiment design', model = 'two-population', variants, targets = [] } = {}) {
  const design = { format: 'mavescape-design', version: 1, name, model, variants: variants ?? { column: 'hgvs_pro', level: 'protein' }, targets, library: { level: 'variant' }, samples: [], replicates: [], controls: { wildType: 'auto', synonymous: 'auto', nonsense: 'auto' } };
  if (model === 'time-series') design.time = { unit: 'generation' };
  if (model === 'bins') design.bins = { weight: 'rank' };
  return design;
}

// --- Slots -------------------------------------------------------------------------------------

// The slots of the design's model: [{ key, label, time?, order?, value? }].
export function slotsOf(design, extra = []) {
  if (design.model === 'two-population') return [{ key: 'input', label: 'Input' }, { key: 'output', label: 'Output' }];
  if (design.model === 'time-series') {
    const times = new Set([...design.replicates.flatMap((r) => (r.timepoints ?? []).map((t) => t.time)), ...extra.filter((x) => x.time !== undefined).map((x) => x.time)]);
    const unit = design.time?.unit && design.time.unit !== 'other' ? ` ${design.time.unit}s` : '';
    return [...times].sort((a, b) => a - b).map((time) => ({ key: `t:${time}`, time, label: time === 0 ? `Time 0 (input)` : `Time ${time}${unit}` }));
  }
  if (design.model === 'bins') {
    const orders = new Map();
    for (const r of design.replicates) for (const b of r.bins ?? []) if (!orders.has(b.order)) orders.set(b.order, b.value);
    for (const x of extra) if (x.order !== undefined && !orders.has(x.order)) orders.set(x.order, x.value ?? x.order);
    return [...orders].sort((a, b) => a[0] - b[0]).map(([order, value]) => ({ key: `b:${order}`, order, value, label: `Bin ${order}` }));
  }
  return [];
}

// The sample in a replicate's slot, or null.
export function slotSample(replicate, slot) {
  if (slot.key === 'input') return replicate.input ?? null;
  if (slot.key === 'output') return replicate.output ?? null;
  if (slot.time !== undefined) return (replicate.timepoints ?? []).find((t) => t.time === slot.time)?.sample ?? null;
  if (slot.order !== undefined) return (replicate.bins ?? []).find((b) => b.order === slot.order)?.sample ?? null;
  return null;
}

function withSlot(replicate, slot, sample) {
  const r = { ...replicate };
  if (slot.key === 'input' || slot.key === 'output') {
    if (sample) r[slot.key] = sample;
    else delete r[slot.key];
  } else if (slot.time !== undefined) {
    const points = (r.timepoints ?? []).filter((t) => t.time !== slot.time);
    if (sample) points.push({ sample, time: slot.time });
    r.timepoints = points.sort((a, b) => a.time - b.time);
  } else if (slot.order !== undefined) {
    const bins = (r.bins ?? []).filter((b) => b.order !== slot.order);
    if (sample) bins.push({ sample, order: slot.order, value: slot.value ?? slot.order });
    r.bins = bins.sort((a, b) => a.order - b.order);
  }
  return r;
}

export function setSlot(design, replicateId, slot, sample) {
  return { ...design, replicates: design.replicates.map((r) => (r.id === replicateId ? withSlot(r, slot, sample || null) : r)) };
}

// A time renamed in every replicate (the time of a column of the matrix). Refused when the new
// time is already a column (two samples would share it).
export function setTime(design, from, to) {
  if (from === to) return design;
  if (!Number.isFinite(to) || to < 0) throw new Error('A time is a number of zero or more.');
  if (design.replicates.some((r) => (r.timepoints ?? []).some((t) => t.time === to))) throw new Error(`Time ${to} is already a column.`);
  return { ...design, replicates: design.replicates.map((r) => ({ ...r, timepoints: (r.timepoints ?? []).map((t) => (t.time === from ? { ...t, time: to } : t)).sort((a, b) => a.time - b.time) })) };
}

export function setBinValue(design, order, value) {
  if (!Number.isFinite(value)) return design;
  return { ...design, replicates: design.replicates.map((r) => ({ ...r, bins: (r.bins ?? []).map((b) => (b.order === order ? { ...b, value } : b)) })) };
}

// A bin's gates on the reporter (fluorescence; null leaves that side open), in every replicate.
export function setBinGates(design, order, { lower, upper }) {
  const clean = (x) => (x === null || x === '' || !(Number(x) > 0) ? undefined : Number(x));
  return { ...design, replicates: design.replicates.map((r) => ({ ...r, bins: (r.bins ?? []).map((b) => {
    if (b.order !== order) return b;
    const { lower: oldLower, upper: oldUpper, ...rest } = b;
    const next = { ...rest };
    const lo = lower === undefined ? oldLower : clean(lower);
    const hi = upper === undefined ? oldUpper : clean(upper);
    if (lo !== undefined) next.lower = lo;
    if (hi !== undefined) next.upper = hi;
    return next;
  }) })) };
}

// --- Columns and samples -----------------------------------------------------------------------

// How each column of a table is used: Map(column → { kind: 'sample', sample } | { kind: 'copy',
// copyOf, reason } | { kind: 'ignored', reason } | { kind: 'unassigned' }).
export function columnAssignments(design, columns) {
  const out = new Map(columns.map((c) => [c, { kind: 'unassigned' }]));
  for (const s of design.samples) for (const c of s.columns) out.set(c, { kind: 'sample', sample: s.id });
  for (const x of design.ignoredColumns ?? []) out.set(x.column, x.copyOf ? { kind: 'copy', copyOf: x.copyOf, reason: x.reason } : { kind: 'ignored', reason: x.reason });
  return out;
}

// Removes a column from wherever it is; drops a sample left with no column (and its uses).
function detach(design, column) {
  let samples = design.samples.map((s) => ({ ...s, columns: s.columns.filter((c) => c !== column) }));
  const gone = new Set(samples.filter((s) => !s.columns.length).map((s) => s.id));
  samples = samples.filter((s) => s.columns.length);
  const ignoredColumns = (design.ignoredColumns ?? []).filter((x) => x.column !== column);
  let next = { ...design, samples, ignoredColumns };
  if (gone.size) next = { ...next, replicates: next.replicates.map((r) => clearSamples(r, gone)) };
  // A copy of a column that is no longer a sample's has nothing to copy: set aside instead.
  next.ignoredColumns = next.ignoredColumns.map((x) => (x.copyOf && !samples.some((s) => s.columns.includes(x.copyOf)) ? { column: x.column, reason: `was a copy of ${x.copyOf}` } : x));
  if (!next.ignoredColumns.length) delete next.ignoredColumns;
  return next;
}

function clearSamples(replicate, ids) {
  const r = { ...replicate };
  if (ids.has(r.input)) delete r.input;
  if (ids.has(r.output)) delete r.output;
  if (r.timepoints) r.timepoints = r.timepoints.filter((t) => !ids.has(t.sample));
  if (r.bins) r.bins = r.bins.filter((b) => !ids.has(b.sample));
  return r;
}

// Assigns a column: { kind: 'new-sample', name? } | { kind: 'sample', sample } (a technical
// replicate of that sample) | { kind: 'copy', copyOf } | { kind: 'ignored', reason } |
// { kind: 'unassigned' }. Returns { design, sample? (the new sample's id) }.
export function assignColumn(design, column, to) {
  let next = detach(design, column);
  if (to.kind === 'new-sample') {
    const id = uniqueId(to.id ?? column, new Set(next.samples.map((s) => s.id)));
    next = { ...next, samples: [...next.samples, { id, name: to.name ?? column, columns: [column] }] };
    return { design: next, sample: id };
  }
  if (to.kind === 'sample') {
    if (!next.samples.some((s) => s.id === to.sample)) throw new Error(`No sample "${to.sample}".`);
    next = { ...next, samples: next.samples.map((s) => (s.id === to.sample ? { ...s, columns: [...s.columns, column] } : s)) };
    return { design: next, sample: to.sample };
  }
  if (to.kind === 'copy' || to.kind === 'ignored') {
    const entry = to.kind === 'copy' ? { column, reason: to.reason ?? 'repeats a sample its replicates share', copyOf: to.copyOf } : { column, reason: to.reason || 'not used' };
    next = { ...next, ignoredColumns: [...(next.ignoredColumns ?? []), entry] };
  }
  return { design: next };
}

export function updateSample(design, id, patch) {
  const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  return { ...design, samples: design.samples.map((s) => {
    if (s.id !== id) return s;
    const next = { ...s, ...clean };
    for (const key of ['batch', 'notes', 'name']) if (next[key] === '') delete next[key];
    if (next.cells === null || Number.isNaN(next.cells)) delete next.cells;
    if (next.missingMeansZero === false) delete next.missingMeansZero;
    return next;
  }) };
}

// --- Replicates, conditions, tiles ---------------------------------------------------------------

export function addReplicate(design) {
  const ids = new Set(design.replicates.map((r) => r.id));
  const condition = design.conditions?.[0]?.id;
  const tile = design.library?.tiles?.[0]?.id;
  const sameGroup = design.replicates.filter((r) => r.condition === condition && r.tile === tile);
  const biological = Math.max(0, ...sameGroup.map((r) => r.biological)) + 1;
  const replicate = { id: uniqueId(`rep${biological}`, ids), name: `Replicate ${biological}`, biological };
  if (condition) replicate.condition = condition;
  if (tile) replicate.tile = tile;
  if (design.model === 'time-series') replicate.timepoints = [];
  if (design.model === 'bins') replicate.bins = [];
  return { design: { ...design, replicates: [...design.replicates, replicate] }, replicate: replicate.id };
}

export function removeReplicate(design, id) {
  return { ...design, replicates: design.replicates.filter((r) => r.id !== id) };
}

export function updateReplicate(design, id, patch) {
  return { ...design, replicates: design.replicates.map((r) => {
    if (r.id !== id) return r;
    const next = { ...r, ...patch };
    for (const key of ['condition', 'tile', 'name']) if (next[key] === '' || next[key] === null) delete next[key];
    return next;
  }) };
}

export function addCondition(design, name) {
  const conditions = design.conditions ?? [];
  const id = uniqueId(name, new Set(conditions.map((c) => c.id)));
  const next = { ...design, conditions: [...conditions, { id, name }] };
  // The first condition: every replicate belongs to it.
  if (!conditions.length) next.replicates = design.replicates.map((r) => ({ ...r, condition: id }));
  return { design: next, condition: id };
}

export function updateCondition(design, id, patch) {
  let conditions = (design.conditions ?? []).map((c) => (c.id === id ? { ...c, ...patch } : c));
  if (patch.reference) conditions = conditions.map((c) => (c.id === id ? c : { ...c, reference: false }));
  conditions = conditions.map((c) => {
    const x = { ...c };
    if (!x.reference) delete x.reference;
    return x;
  });
  return { ...design, conditions };
}

export function removeCondition(design, id) {
  const conditions = (design.conditions ?? []).filter((c) => c.id !== id);
  const fallback = conditions[0]?.id;
  const replicates = design.replicates.map((r) => {
    if (r.condition !== id) return r;
    const x = { ...r };
    if (fallback) x.condition = fallback;
    else delete x.condition;
    return x;
  });
  const next = { ...design, conditions, replicates };
  if (!conditions.length) delete next.conditions;
  return next;
}

export function addTile(design, start, end) {
  const tiles = design.library?.tiles ?? [];
  const id = uniqueId(`tile${tiles.length + 1}`, new Set(tiles.map((t) => t.id)));
  const next = { ...design, library: { ...(design.library ?? { level: 'variant' }), tiles: [...tiles, { id, name: `Tile ${tiles.length + 1}`, start, end }] } };
  if (!tiles.length) next.replicates = design.replicates.map((r) => ({ ...r, tile: id }));
  return { design: next, tile: id };
}

export function updateTile(design, id, patch) {
  return { ...design, library: { ...design.library, tiles: design.library.tiles.map((t) => (t.id === id ? { ...t, ...patch } : t)) } };
}

export function removeTile(design, id) {
  const tiles = design.library.tiles.filter((t) => t.id !== id);
  const fallback = tiles[0]?.id;
  const replicates = design.replicates.map((r) => {
    if (r.tile !== id) return r;
    const x = { ...r };
    if (fallback) x.tile = fallback;
    else delete x.tile;
    return x;
  });
  const library = { ...design.library, tiles };
  if (!tiles.length) delete library.tiles;
  return { ...design, library, replicates };
}

// --- The model -----------------------------------------------------------------------------------

// Changes the model, keeping what carries over: two populations become a time series of 0 and 1
// and back (the first and last times); bins start empty from either.
export function setModel(design, model) {
  if (model === design.model) return design;
  const next = { ...design, model };
  delete next.time;
  delete next.bins;
  if (model === 'time-series') next.time = design.time ?? { unit: 'generation' };
  if (model === 'bins') next.bins = design.bins ?? { weight: 'rank' };
  next.replicates = design.replicates.map((r) => {
    const x = { id: r.id, name: r.name, biological: r.biological };
    if (r.condition) x.condition = r.condition;
    if (r.tile) x.tile = r.tile;
    if (model === 'time-series') {
      x.timepoints = design.model === 'two-population' ? [r.input && { sample: r.input, time: 0 }, r.output && { sample: r.output, time: 1 }].filter(Boolean) : [];
    } else if (model === 'two-population' && design.model === 'time-series') {
      const points = [...(r.timepoints ?? [])].sort((a, b) => a.time - b.time);
      if (points.length) x.input = points[0].sample;
      if (points.length > 1) x.output = points[points.length - 1].sample;
    } else if (model === 'bins') {
      x.bins = [];
    }
    return x;
  });
  return next;
}

export function setControls(design, patch) {
  return { ...design, controls: { ...(design.controls ?? {}), ...patch } };
}

// The readout (wave 2, slice 8): fields set, an empty one removed, and no readout left when nothing
// is said.
export function setReadout(design, patch) {
  const readout = { ...(design.readout ?? {}), ...patch };
  for (const [k, v] of Object.entries(readout)) if (v === '' || v === null || v === undefined) delete readout[k];
  const next = { ...design, readout };
  if (!Object.keys(readout).length) delete next.readout;
  return next;
}

// How the library was made (MaveDB's term), or nothing.
export function setLibraryMethod(design, method) {
  const library = { ...(design.library ?? { level: 'variant' }) };
  if (method) library.method = method;
  else delete library.method;
  return { ...design, library };
}

// Where a control class serves (start, end: positions, or null for open), and why it is a control.
export function setControlPositions(design, key, range) {
  const controls = { ...(design.controls ?? {}) };
  const positions = { ...(controls.positions ?? {}) };
  const r = Object.fromEntries(Object.entries(range ?? {}).filter(([, v]) => Number.isInteger(v)));
  if (Object.keys(r).length) positions[key] = r;
  else delete positions[key];
  if (Object.keys(positions).length) controls.positions = positions;
  else delete controls.positions;
  return { ...design, controls };
}

export function setControlWhy(design, key, text) {
  const controls = { ...(design.controls ?? {}) };
  const why = { ...(controls.why ?? {}) };
  if (String(text ?? '').trim()) why[key] = String(text).trim();
  else delete why[key];
  if (Object.keys(why).length) controls.why = why;
  else delete controls.why;
  return { ...design, controls };
}

export function setField(design, patch) {
  const next = { ...design, ...patch };
  for (const key of ['name', 'description']) if (next[key] === '') delete next[key];
  return next;
}

// Columns of the table the design neither uses nor sets aside (columns left out of the count
// columns at import, text columns), set aside with a reason, so that every column is accounted for
// without any being dropped silently. identifiers: columns that name variants.
// A table of barcodes (column: its column of barcodes, out of the columns set aside) or of variants
// (null: the column of barcodes set aside, with the reason).
export function setBarcodeColumn(design, column) {
  const library = { ...(design.library ?? {}) };
  let ignored = design.ignoredColumns ?? [];
  const previous = library.barcodeColumn;
  if (column) {
    library.level = 'barcode';
    library.barcodeColumn = column;
    ignored = ignored.filter((x) => x.column !== column);
  } else {
    library.level = 'variant';
    delete library.barcodeColumn;
  }
  if (previous && previous !== column) ignored = [...ignored, { column: previous, reason: 'barcodes (not used: the rows are scored as they are)' }];
  const next = { ...design, library };
  if (ignored.length) next.ignoredColumns = ignored;
  else delete next.ignoredColumns;
  return next;
}

export function setAsideOtherColumns(design, columns, identifiers = []) {
  const accounted = new Set([design.variants?.column, design.library?.barcodeColumn, ...identifiers, ...design.samples.flatMap((s) => s.columns), ...(design.ignoredColumns ?? []).map((x) => x.column)]);
  const others = columns.filter((c) => !accounted.has(c));
  if (!others.length) return design;
  return { ...design, ignoredColumns: [...(design.ignoredColumns ?? []), ...others.map((column) => ({ column, reason: 'not a count column (left out at import)' }))] };
}
