// The experiment design (mavescape-design, version 1): what each column of a count table is.
// docs/schemas/design.v1.json describes its structure; validateDesign checks that structure and
// the rules that depend on the model and on the table, and summarizeDesign describes a design in
// plain language before anything is scored (requirements E1, E5).
//
// The design is capability-based: one schema represents two-population, time-series, bin and
// score-only experiments, tiled libraries and samples shared between replicates, without code for
// any particular data set. Checked on three public data sets of different designs (validation
// suite `designs`, wave 1 slice 2).

export const DESIGN_FORMAT = 'mavescape-design';
export const DESIGN_VERSION = 1;
export const MODELS = ['two-population', 'time-series', 'bins', 'scores'];
export const TIME_UNITS = ['round', 'generation', 'hour', 'day', 'minute', 'other'];
export const BIN_WEIGHTS = ['rank', 'fluorescence', 'other'];

// Columns MaveDB writes beside the data; they name variants and are never counts.
export const IDENTIFIER_COLUMNS = ['accession', 'hgvs_nt', 'hgvs_splice', 'hgvs_pro'];

const ID = /^[A-Za-z0-9_.-]{1,64}$/;
const DNA = /^[ACGT]+$/;
const PROTEIN = /^[ACDEFGHIKLMNPQRSTVWY]+\*?$/;

const MODEL_NAMES = {
  'two-population': 'Two-population selection',
  'time-series': 'Time series',
  bins: 'FACS bins',
  scores: 'Precomputed scores',
};

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// The length of a target in the positions variants are numbered by: residues for a protein, or
// for a DNA target named at the protein level, codons from its reading frame.
export function targetLength(target, level = 'protein') {
  const sequence = String(target?.sequence ?? '');
  if (target?.sequenceType === 'dna' && level === 'protein') return Math.floor((sequence.length - ((target.codingStart ?? 1) - 1)) / 3);
  return sequence.length;
}

// The samples each replicate uses, with their roles: [{ sample, role, time?, order?, value? }].
export function replicateSamples(replicate) {
  const out = [];
  if (replicate.input) out.push({ sample: replicate.input, role: 'input' });
  if (replicate.output) out.push({ sample: replicate.output, role: 'output' });
  for (const t of replicate.timepoints ?? []) out.push({ sample: t.sample, role: 'timepoint', time: t.time });
  for (const b of replicate.bins ?? []) out.push({ sample: b.sample, role: 'bin', order: b.order, value: b.value });
  return out;
}

// Samples used by more than one replicate (an input library selected several times), id → [replicate ids].
export function sharedSamples(design) {
  const users = new Map();
  for (const replicate of design.replicates ?? []) {
    for (const { sample } of replicateSamples(replicate)) {
      if (!users.has(sample)) users.set(sample, new Set());
      users.get(sample).add(replicate.id);
    }
  }
  return new Map([...users].filter(([, ids]) => ids.size > 1).map(([id, ids]) => [id, [...ids]]));
}

// Checks a design, and its columns against a table's header when `table` ({ columns }) is given.
// Returns { ok, errors: [{ path, message }], warnings: [{ path, message }] }: errors block
// scoring, warnings are shown in the design summary.
export function validateDesign(design, table = null) {
  const errors = [];
  const warnings = [];
  const error = (path, message) => errors.push({ path, message });
  const warn = (path, message) => warnings.push({ path, message });

  if (!isObject(design)) {
    error('', 'A design is a JSON object.');
    return { ok: false, errors, warnings };
  }
  if (design.format !== DESIGN_FORMAT) error('format', `The format must be "${DESIGN_FORMAT}".`);
  if (design.version !== DESIGN_VERSION) error('version', `This MaveScape reads design version ${DESIGN_VERSION}, not ${JSON.stringify(design.version)}.`);
  if (!MODELS.includes(design.model)) error('model', `The model must be one of ${MODELS.join(', ')}.`);
  const model = design.model;
  const columns = table?.columns ? new Set(table.columns) : null;
  const level = design.variants?.level ?? 'protein';

  // --- Variants ---
  if (!isObject(design.variants) || typeof design.variants.column !== 'string' || !design.variants.column) {
    error('variants', 'Name the column that holds the variants (variants.column).');
  } else {
    if (!['nucleotide', 'splice', 'protein'].includes(design.variants.level)) error('variants.level', 'The level of the variant names must be nucleotide, splice or protein.');
    if (columns && !columns.has(design.variants.column)) error('variants.column', `The table has no column "${design.variants.column}".`);
  }

  // --- Targets ---
  const targets = Array.isArray(design.targets) ? design.targets : [];
  if (!targets.length) error('targets', 'Give the target sequence the variants are named against.');
  const targetIds = new Set();
  targets.forEach((target, i) => {
    const path = `targets[${i}]`;
    if (!isObject(target)) return error(path, 'A target is an object.');
    if (!ID.test(target.id ?? '')) error(`${path}.id`, 'A target needs an id of letters, digits, ".", "_" or "-".');
    else if (targetIds.has(target.id)) error(`${path}.id`, `Two targets have the id "${target.id}".`);
    targetIds.add(target.id);
    if (!target.name) error(`${path}.name`, 'A target needs a name.');
    const sequence = String(target.sequence ?? '');
    if (target.sequenceType === 'dna') {
      if (!DNA.test(sequence.toUpperCase())) error(`${path}.sequence`, 'A DNA target may hold only A, C, G and T.');
      else if (sequence !== sequence.toUpperCase()) warn(`${path}.sequence`, 'The DNA sequence is in lower case; it is read as upper case.');
      const start = target.codingStart ?? 1;
      if (!Number.isInteger(start) || start < 1 || start > sequence.length) error(`${path}.codingStart`, 'The reading frame must start inside the sequence.');
      else if (level === 'protein' && (sequence.length - start + 1) % 3 !== 0) warn(`${path}.sequence`, `From base ${start}, the sequence is not a whole number of codons (${sequence.length - start + 1} bases).`);
    } else if (target.sequenceType === 'protein') {
      if (!PROTEIN.test(sequence.toUpperCase())) error(`${path}.sequence`, 'A protein target may hold only the 20 amino acids in one-letter code (and a final *).');
      if (level !== 'protein') error(`${path}.sequenceType`, `Variants named at the ${level} level need a DNA target.`);
    } else {
      error(`${path}.sequenceType`, 'The sequence type must be dna or protein.');
    }
    if (target.offset !== undefined && !Number.isInteger(target.offset)) error(`${path}.offset`, 'The offset is a whole number.');
    for (const [j, d] of (target.differences ?? []).entries()) {
      if (!Number.isInteger(d.position) || d.position < 1 || d.position > targetLength(target, level)) error(`${path}.differences[${j}]`, 'A known difference must name a position in the target.');
    }
  });

  // --- Tiles ---
  const tiles = design.library?.tiles ?? [];
  const tileIds = new Set();
  if (design.library?.level && !['variant', 'barcode'].includes(design.library.level)) error('library.level', 'The library level must be variant or barcode.');
  tiles.forEach((tile, i) => {
    const path = `library.tiles[${i}]`;
    if (!ID.test(tile.id ?? '')) error(`${path}.id`, 'A tile needs an id.');
    else if (tileIds.has(tile.id)) error(`${path}.id`, `Two tiles have the id "${tile.id}".`);
    tileIds.add(tile.id);
    if (!Number.isInteger(tile.start) || !Number.isInteger(tile.end) || tile.start < 1 || tile.end < tile.start) error(path, 'A tile covers positions start…end, with 1 ≤ start ≤ end.');
    else if (targets.length === 1 && tile.end > targetLength(targets[0], level)) error(`${path}.end`, `The tile ends at ${tile.end}, beyond the target (${targetLength(targets[0], level)} positions).`);
  });
  if (tiles.length > 1 && targets.length === 1) {
    const sorted = [...tiles].filter((t) => Number.isInteger(t.start) && Number.isInteger(t.end)).sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i].start > sorted[i - 1].end + 1) warn('library.tiles', `Positions ${sorted[i - 1].end + 1}–${sorted[i].start - 1} are in no tile.`);
    }
  }

  // --- Conditions ---
  const conditions = Array.isArray(design.conditions) ? design.conditions : [];
  const conditionIds = new Set();
  conditions.forEach((condition, i) => {
    if (!ID.test(condition.id ?? '')) error(`conditions[${i}].id`, 'A condition needs an id.');
    else if (conditionIds.has(condition.id)) error(`conditions[${i}].id`, `Two conditions have the id "${condition.id}".`);
    conditionIds.add(condition.id);
    if (!condition.name) error(`conditions[${i}].name`, 'A condition needs a name.');
  });
  if (conditions.filter((c) => c.reference).length > 1) error('conditions', 'At most one condition is the reference.');

  // --- Samples ---
  const samples = Array.isArray(design.samples) ? design.samples : [];
  const sampleIds = new Set();
  const columnOwner = new Map();
  samples.forEach((sample, i) => {
    const path = `samples[${i}]`;
    if (!ID.test(sample.id ?? '')) error(`${path}.id`, 'A sample needs an id of letters, digits, ".", "_" or "-".');
    else if (sampleIds.has(sample.id)) error(`${path}.id`, `Two samples have the id "${sample.id}".`);
    sampleIds.add(sample.id);
    if (!Array.isArray(sample.columns) || !sample.columns.length) error(`${path}.columns`, `Sample "${sample.id}" names no column of counts.`);
    for (const column of sample.columns ?? []) {
      if (columnOwner.has(column)) error(`${path}.columns`, `Column "${column}" belongs to both "${columnOwner.get(column)}" and "${sample.id}".`);
      columnOwner.set(column, sample.id);
      if (columns && !columns.has(column)) error(`${path}.columns`, `The table has no column "${column}" (sample "${sample.id}").`);
    }
    if (sample.missingMeansZero !== undefined && typeof sample.missingMeansZero !== 'boolean') error(`${path}.missingMeansZero`, 'missingMeansZero is true or false.');
  });
  if (model === 'scores' && samples.length) warn('samples', 'A score-only design does not use samples.');

  // --- Replicates ---
  const replicates = Array.isArray(design.replicates) ? design.replicates : [];
  if (model !== 'scores' && !replicates.length) error('replicates', 'Name at least one replicate: which samples were selected, and how.');
  if (model === 'time-series' && !TIME_UNITS.includes(design.time?.unit)) error('time.unit', `Give the unit of the times (${TIME_UNITS.join(', ')}).`);
  if (model === 'bins' && !BIN_WEIGHTS.includes(design.bins?.weight)) error('bins.weight', `Say what the bin values are (${BIN_WEIGHTS.join(', ')}).`);
  const replicateIds = new Set();
  const biologicalKeys = new Map();
  const used = new Set();
  replicates.forEach((replicate, i) => {
    const path = `replicates[${i}]`;
    if (!ID.test(replicate.id ?? '')) error(`${path}.id`, 'A replicate needs an id.');
    else if (replicateIds.has(replicate.id)) error(`${path}.id`, `Two replicates have the id "${replicate.id}".`);
    replicateIds.add(replicate.id);
    if (!Number.isInteger(replicate.biological) || replicate.biological < 1) error(`${path}.biological`, 'Number the biological replicate (1, 2, 3…).');
    if (conditions.length) {
      if (!conditionIds.has(replicate.condition)) error(`${path}.condition`, `Replicate "${replicate.id}" must name one of the conditions (${[...conditionIds].join(', ')}).`);
    } else if (replicate.condition !== undefined) {
      error(`${path}.condition`, `Replicate "${replicate.id}" names a condition, but the design defines none.`);
    }
    if (tiles.length) {
      if (!tileIds.has(replicate.tile)) error(`${path}.tile`, `Replicate "${replicate.id}" must name its tile (${[...tileIds].join(', ')}).`);
    } else if (replicate.tile !== undefined) {
      error(`${path}.tile`, `Replicate "${replicate.id}" names a tile, but the library has none.`);
    }
    const key = `${replicate.condition ?? ''}\u0000${replicate.tile ?? ''}\u0000${replicate.biological}`;
    if (biologicalKeys.has(key)) error(`${path}.biological`, `Replicates "${biologicalKeys.get(key)}" and "${replicate.id}" are both biological replicate ${replicate.biological}${replicate.condition ? ` of ${replicate.condition}` : ''}${replicate.tile ? ` in tile ${replicate.tile}` : ''}. Technical replicates are columns of one sample.`);
    biologicalKeys.set(key, replicate.id);

    const parts = replicateSamples(replicate);
    for (const { sample } of parts) {
      used.add(sample);
      if (!sampleIds.has(sample)) error(path, `Replicate "${replicate.id}" uses sample "${sample}", which is not defined.`);
    }
    const has = { pair: replicate.input !== undefined || replicate.output !== undefined, timepoints: replicate.timepoints !== undefined, bins: replicate.bins !== undefined };
    if (model === 'two-population') {
      if (!replicate.input || !replicate.output) error(path, `Replicate "${replicate.id}" needs an input and an output sample.`);
      else if (replicate.input === replicate.output) error(path, `Replicate "${replicate.id}" uses one sample as both input and output.`);
      if (has.timepoints || has.bins) error(path, 'A two-population replicate has an input and an output, not time points or bins.');
    } else if (model === 'time-series') {
      const points = replicate.timepoints ?? [];
      if (has.pair || has.bins) error(path, 'A time-series replicate lists its time points, not an input and output or bins.');
      if (points.length < 2) error(`${path}.timepoints`, `Replicate "${replicate.id}" needs two or more time points.`);
      const times = points.map((t) => t.time);
      if (times.some((t) => !Number.isFinite(t) || t < 0)) error(`${path}.timepoints`, 'Times are numbers of zero or more.');
      if (new Set(times).size !== times.length) error(`${path}.timepoints`, `Replicate "${replicate.id}" has two samples at the same time.`);
      if (new Set(points.map((t) => t.sample)).size !== points.length) error(`${path}.timepoints`, `Replicate "${replicate.id}" uses one sample at two times.`);
      if (times.length && Math.min(...times) !== 0) warn(`${path}.timepoints`, `Replicate "${replicate.id}" has no time 0; its earliest sample is taken as the input.`);
      if (points.length === 2) warn(`${path}.timepoints`, `Replicate "${replicate.id}" has two time points: its score is a ratio; a regression needs three or more.`);
    } else if (model === 'bins') {
      const bins = replicate.bins ?? [];
      if (has.pair || has.timepoints) error(path, 'A bin replicate lists its bins, not an input and output or time points.');
      if (bins.length < 2) error(`${path}.bins`, `Replicate "${replicate.id}" needs two or more bins.`);
      const orders = bins.map((b) => b.order);
      if (new Set(orders).size !== orders.length) error(`${path}.bins`, `Replicate "${replicate.id}" has two bins with the same order.`);
      if (bins.some((b) => !Number.isFinite(b.value))) error(`${path}.bins`, 'Every bin needs a numeric value (its weight, rank or fluorescence).');
      // Gates, for the maximum-likelihood estimate: positive, each bin's below its upper, and the
      // bins in order without overlap (the outer bins open).
      const gated = [...bins].sort((x, y) => x.order - y.order);
      if (gated.some((b) => b.lower !== undefined || b.upper !== undefined)) {
        if (gated.some((b) => (b.lower !== undefined && !(b.lower > 0)) || (b.upper !== undefined && !(b.upper > 0)))) error(`${path}.bins`, 'Gates are positive fluorescence values.');
        else if (gated.some((b) => b.lower !== undefined && b.upper !== undefined && !(b.lower < b.upper))) error(`${path}.bins`, `A bin of replicate "${replicate.id}" has its lower gate at or above its upper.`);
        else if (gated.some((b, k) => k > 0 && (gated[k - 1].upper === undefined || b.lower === undefined || b.lower < gated[k - 1].upper))) warn(`${path}.bins`, `The gates of replicate "${replicate.id}" leave gaps or overlaps, or an inner bin open: the maximum-likelihood estimate needs each bin's lower gate at or above the bin below's upper.`);
      }
      const byOrder = [...bins].sort((a, b) => a.order - b.order);
      for (let j = 1; j < byOrder.length; j += 1) {
        if (byOrder[j].value <= byOrder[j - 1].value) {
          warn(`${path}.bins`, `In replicate "${replicate.id}", bin ${byOrder[j].order}'s value is not above bin ${byOrder[j - 1].order}'s.`);
          break;
        }
      }
      if (new Set(bins.map((b) => b.sample)).size !== bins.length) error(`${path}.bins`, `Replicate "${replicate.id}" uses one sample for two bins.`);
    } else if (model === 'scores') {
      error(path, 'A score-only design has no replicates of counts.');
    }
  });
  for (const id of sampleIds) {
    if (!used.has(id) && model !== 'scores') warn('samples', `Sample "${id}" is in no replicate and is not scored.`);
  }
  // Missing read as 0 is for samples after selection: in a replicate's first sample it would
  // count a variant that was never in the library as present with no reads.
  for (const replicate of replicates) {
    const first = replicateSamples(replicate).filter((p) => p.role !== 'bin').map((p) => ({ ...p, time: p.role === 'input' ? 0 : p.role === 'output' ? 1 : p.time })).sort((a, b) => a.time - b.time)[0];
    const sample = first && samples.find((x) => x.id === first.sample);
    if (sample?.missingMeansZero) warn(`samples`, `Sample "${sample.id}" is the first of replicate "${replicate.id}" and its missing counts are read as 0: a variant that was never in the library would count as present with no reads. Read missing as 0 only in samples after selection.`);
  }
  // Replicates of one condition and tile should use the same kind of experiment: the same times
  // or the same bins, so that their scores can be combined.
  if (model === 'time-series' || model === 'bins') {
    const groups = new Map();
    for (const replicate of replicates) {
      const key = `${replicate.condition ?? ''}\u0000${replicate.tile ?? ''}`;
      const shape = model === 'time-series' ? (replicate.timepoints ?? []).map((t) => t.time).sort((a, b) => a - b).join(',') : (replicate.bins ?? []).map((b) => `${b.order}:${b.value}`).sort().join(',');
      if (!groups.has(key)) groups.set(key, new Map());
      groups.get(key).set(shape, replicate.id);
    }
    for (const shapes of groups.values()) {
      if (shapes.size > 1) warn('replicates', `Replicates ${[...shapes.values()].join(', ')} of one condition differ in their ${model === 'time-series' ? 'times' : 'bins'}: combining their scores treats them as one experiment, on one scale.`);
    }
  }

  // --- Scores (model 'scores') ---
  if (model === 'scores') {
    if (!design.scores?.score) error('scores.score', 'Name the column of scores.');
    for (const key of ['score', 'se', 'ciLow', 'ciHigh']) {
      const column = design.scores?.[key];
      if (column && columns && !columns.has(column)) error(`scores.${key}`, `The table has no column "${column}".`);
    }
  }

  // --- Ignored columns, and every column accounted for ---
  const ignored = new Map();
  for (const [i, entry] of (design.ignoredColumns ?? []).entries()) {
    if (ignored.has(entry.column)) error(`ignoredColumns[${i}]`, `Column "${entry.column}" is ignored twice.`);
    ignored.set(entry.column, entry);
    if (!entry.reason) error(`ignoredColumns[${i}].reason`, `Say why column "${entry.column}" is not used.`);
    if (columnOwner.has(entry.column)) error(`ignoredColumns[${i}]`, `Column "${entry.column}" is both ignored and a sample's.`);
    if (columns && !columns.has(entry.column)) warn(`ignoredColumns[${i}]`, `The table has no column "${entry.column}".`);
    if (entry.copyOf !== undefined && !columnOwner.has(entry.copyOf)) error(`ignoredColumns[${i}].copyOf`, `Column "${entry.column}" is a copy of "${entry.copyOf}", which no sample uses.`);
  }
  if (columns) {
    const accounted = new Set([design.variants?.column, ...IDENTIFIER_COLUMNS, ...columnOwner.keys(), ...ignored.keys(), ...Object.values(model === 'scores' ? design.scores ?? {} : {})]);
    const unaccounted = table.columns.filter((c) => !accounted.has(c));
    if (unaccounted.length) {
      const shown = unaccounted.slice(0, 6).map((c) => `"${c}"`).join(', ');
      error('ignoredColumns', `${unaccounted.length} column${unaccounted.length === 1 ? ' is' : 's are'} neither a sample's nor ignored with a reason: ${shown}${unaccounted.length > 6 ? ', …' : ''}. No column is dropped silently.`);
    }
  }

  // --- Controls ---
  const controls = design.controls ?? {};
  if (controls.wildType !== undefined && (typeof controls.wildType !== 'string' || !controls.wildType)) error('controls.wildType', 'The wild type is "auto" or the identifier of its row.');
  for (const key of ['synonymous', 'nonsense']) {
    const value = controls[key];
    if (value !== undefined && value !== 'auto' && value !== 'none' && !(Array.isArray(value) && value.every((v) => typeof v === 'string'))) error(`controls.${key}`, `${key} controls are "auto", "none" or a list of variants.`);
  }

  return { ok: errors.length === 0, errors, warnings };
}

const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

function range(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? (sorted[0] === sorted[sorted.length - 1] ? `${sorted[0]}` : `${sorted[0]}–${sorted[sorted.length - 1]}`) : '';
}

// A design described for people (requirement E5): { model, counts, lines: [text] }.
export function summarizeDesign(design) {
  const replicates = design.replicates ?? [];
  const conditions = design.conditions ?? [];
  const tiles = design.library?.tiles ?? [];
  const level = design.variants?.level ?? 'protein';
  const lines = [];
  const shared = sharedSamples(design);
  const counts = {
    targets: (design.targets ?? []).length,
    samples: (design.samples ?? []).length,
    replicates: replicates.length,
    conditions: conditions.length,
    tiles: tiles.length,
    sharedSamples: shared.size,
    ignoredColumns: (design.ignoredColumns ?? []).length,
  };

  for (const target of design.targets ?? []) {
    const length = targetLength(target, level);
    const ids = target.identifiers ?? {};
    const reference = ids.uniprot ? `UniProt ${ids.uniprot}${Number.isInteger(target.offset) ? `, positions ${1 + target.offset}–${length + target.offset}` : ''}` : ids.refseq ?? ids.gene ?? null;
    const kind = target.sequenceType === 'dna' ? `${target.sequence.length} nt${level === 'protein' ? `, ${length} codons` : ''}` : `${length} aa`;
    lines.push(`Target ${target.name} (${kind}${reference ? `; ${reference}` : ''}).`);
    if (target.differences?.length) lines.push(`  ${plural(target.differences.length, 'known difference')} from the reference: ${target.differences.map((d) => `${d.target}${d.position} (reference ${d.reference})`).join(', ')}.`);
  }

  const perCondition = conditions.length ? ` in ${plural(conditions.length, 'condition')} (${conditions.map((c) => c.name + (c.reference ? ', reference' : '')).join('; ')})` : '';
  const perTile = tiles.length ? ` across ${plural(tiles.length, 'tile')} (${tiles.map((t) => `${t.name ?? t.id} ${t.start}–${t.end}`).join(', ')})` : '';
  const biological = new Set(replicates.map((r) => r.biological)).size;
  if (design.model === 'two-population') {
    lines.push(`${MODEL_NAMES[design.model]}: ${plural(replicates.length, 'replicate')} (${plural(biological, 'biological replicate')})${perTile}${perCondition}, each an input and an output.`);
  } else if (design.model === 'time-series') {
    const times = new Set(replicates.flatMap((r) => (r.timepoints ?? []).map((t) => t.time)));
    const points = new Set(replicates.map((r) => (r.timepoints ?? []).length));
    const unit = design.time?.unit && design.time.unit !== 'other' ? ` ${design.time.unit}s` : '';
    lines.push(`${MODEL_NAMES[design.model]}: ${plural(replicates.length, 'replicate')}${perTile}${perCondition}, each with ${[...points].join(' or ')} time points (${range(times)}${unit}).`);
  } else if (design.model === 'bins') {
    const values = [...new Map(replicates.flatMap((r) => (r.bins ?? []).map((b) => [b.order, b.value]))).entries()].sort((a, b) => a[0] - b[0]);
    lines.push(`${MODEL_NAMES[design.model]}: ${plural(replicates.length, 'replicate')}${perTile}${perCondition}, each sorted into ${plural(values.length, 'bin')} (${design.bins?.weight ?? 'value'} ${values.map(([, v]) => v).join(', ')}).`);
  } else if (design.model === 'scores') {
    lines.push(`${MODEL_NAMES[design.model]}: column "${design.scores?.score}"${design.scores?.se ? ` with standard errors in "${design.scores.se}"` : ''}.`);
  }
  if (shared.size) {
    const sizes = new Set([...shared.values()].map((ids) => ids.length));
    lines.push(`${plural(shared.size, 'sample is', 'samples are')} shared between replicates (${[...sizes].join(' or ')} each): replicates that share an input are not independent there.`);
  }
  const technical = (design.samples ?? []).filter((s) => s.columns.length > 1);
  if (technical.length) lines.push(`${plural(technical.length, 'sample has', 'samples have')} technical replicates (several columns), summed before scoring.`);
  const zero = (design.samples ?? []).filter((s) => s.missingMeansZero);
  if (zero.length) lines.push(`Missing counts are read as 0 in ${zero.length > 3 ? plural(zero.length, 'sample') : zero.map((s) => s.name ?? s.id).join(', ')} (variants that dropped out during selection, written as missing).`);
  if (counts.ignoredColumns) {
    const reasons = new Map();
    for (const entry of design.ignoredColumns) {
      const reason = entry.copyOf ? 'copies of a shared sample' : entry.reason;
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    }
    lines.push(`${plural(counts.ignoredColumns, 'column')} not used: ${[...reasons].map(([reason, n]) => `${n} ${reason}`).join('; ')}.`);
  }
  const controls = design.controls ?? {};
  const named = (value) => (value === undefined || value === 'auto' ? 'found automatically' : value === 'none' ? 'none' : plural(value.length, 'variant'));
  lines.push(`Controls: wild type ${controls.wildType && controls.wildType !== 'auto' ? `"${controls.wildType}"` : 'found automatically'}; synonymous ${named(controls.synonymous)}; nonsense ${named(controls.nonsense)}.`);
  return { model: design.model, counts, lines };
}
