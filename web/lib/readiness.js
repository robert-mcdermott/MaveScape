// Readiness (wave 2, slice 10; requirement E8): for the open workspace, what each analysis can do
// with what is there, and what would unlock more. The hardest part of an analysis is often
// gathering what the experiment was: which sample is which, what the assay selects for, and
// numbers kept at the bench that never reach the count table. Pure, computed from the workspace
// (the table's import summary, the target, the design) and never stored; the workflow strip, the
// Start page, the Experiment view, the methods and `mavescape validate` show it.
//
//   readiness(ws) → {
//     version, model,
//     base: { counts, target, design },          what every analysis needs
//     analyses: [{ id, group, label, status, needs, improves, note }],
//       status: 'ready' (everything it reads is there), 'partial' (it runs; what `improves` lists
//       would make it more complete), 'unavailable' (it cannot: `needs` lists what it lacks, or
//       `note` says why when nothing given here would change it)
//     gaps: [{ id, label, kind, why, where, how, place, unlocks, improves }],
//       what is missing, why it matters, where it is usually found and how to give it; unlocks
//       and improves name the analyses it would change
//     counts: { ready, partial, unavailable },
//   }
//
// Nothing is filled in by guessing: a gap stays visible until it is given, and the methods name
// it. Each analysis's verdict follows the scoring engine's and QC's own conditions (score.js,
// qc.js, findings.js); the validation suite `readiness` checks each against what the engine does.

import { validateDesign, replicateSamples } from './design.js';
import { readoutOf } from './readout.js';

export const READINESS_VERSION = 1;

// What an analysis can lack. kind: 'required' (no analysis without it), 'counts' (what the table
// holds), 'experiment' (another experiment, or more of one), 'bench' (records kept at the bench),
// 'description' (what the assay and its target are). place: where it is given in the window.
export const GAPS = {
  counts: {
    label: 'The counts', kind: 'required', place: 'open',
    why: 'MaveScape scores from counts: one row per variant (or barcode) and one column per sequenced sample.',
    where: 'The pipeline that counted the reads (Enrich2, DiMSum, dms_variants, mutscan or the laboratory\'s own scripts), or the count tables MaveDB keeps beside the scores.',
    how: 'Open the table (Open files, or drop it on the window).',
  },
  target: {
    label: 'The target sequence', kind: 'required', place: 'open-fasta',
    why: 'Variant names are checked against it, positions are mapped on it and coverage is judged by it.',
    where: 'The construct\'s sequence as cloned (a FASTA file); the reference protein\'s in UniProt.',
    how: 'Open its FASTA, or paste it when importing.',
  },
  design: {
    label: 'The design', kind: 'required', place: 'experiment',
    why: 'Which column is which sample: its role (input, output, time point or bin), replicate and condition.',
    where: 'The sample sheet kept with the sequencing run; the samples\' names often say most of it.',
    how: 'Draft it from the column names, or read a sample sheet (Experiment).',
  },
  'wild-type': {
    label: 'The wild type, counted', kind: 'counts', place: 'controls',
    why: 'Scores relative to the wild type, DiMSum\'s fitness, scales with the wild type at 1, and QC\'s placing of a bottleneck before or after selection read its reads.',
    where: 'Reads with no change from the target: most counting pipelines write them on a row of their own (p.=, _wt or WT) when asked.',
    how: 'Count them and add the row, or name the row (Experiment, Controls).',
  },
  synonymous: {
    label: 'Synonymous variants', kind: 'counts', place: 'controls',
    why: 'Normalization to the synonymous median, the scale from synonymous 0 to nonsense −1, and QC\'s check of the variance beyond counting with one replicate.',
    where: 'A library of codon variants carries them. Counted at the codon or nucleotide level they stay apart; named at the protein level they are often folded into the wild type.',
    how: 'Count at the codon level, or name them (Experiment, Controls).',
  },
  nonsense: {
    label: 'Nonsense variants', kind: 'counts', place: 'controls',
    why: 'Loss-of-function controls: scales that put nonsense at 0 or −1, the separation of the controls and the resolution of the scores.',
    where: 'Libraries made with NNK or NNN codons include stops; libraries designed without them have none.',
    how: 'Name other loss-of-function controls, or the positions where stops serve (Experiment, Controls).',
  },
  replicates: {
    label: 'A second replicate', kind: 'experiment', place: 'replicates',
    why: 'With one replicate, SEs are counting error alone: the noise between replicates, their agreement and the variance beyond counting cannot be measured.',
    where: 'Another biological replicate: the selection repeated from its own culture or transformation.',
    how: 'Add its columns to the table and a replicate to the design.',
  },
  'third-replicate': {
    label: 'A third replicate', kind: 'experiment', place: 'replicates',
    why: 'A replicate that disagrees can be told apart only against two others.',
    where: 'Another biological replicate of the selection.',
    how: 'Add its columns to the table and a replicate to the design.',
  },
  'time-points': {
    label: 'Three time points in every replicate', kind: 'experiment', place: 'replicates',
    why: 'A regression on time, and QC\'s fit of the time courses, need three or more points; with two, a score is the log ratio of the first and last.',
    where: 'Samples taken at more times during selection.',
    how: 'Add the samples\' columns and their times (Experiment, Replicates).',
  },
  conditions: {
    label: 'Two or more conditions', kind: 'experiment', place: 'conditions',
    why: 'Differential scores compare a condition with a reference: selection with and without a drug or ligand, or at two levels of a nutrient.',
    where: 'The same library selected under each condition.',
    how: 'Add the conditions and put each replicate in one (Experiment).',
  },
  readout: {
    label: 'What the assay measures', kind: 'description', place: 'readout',
    why: 'Until the direction is stated, MaveScape takes a higher score to mean more of the function; the map\'s legend, the separation of the controls and a deposit read it.',
    where: 'The assay\'s protocol: what the selection or sort reads out, and whether losing the function raises or lowers a score.',
    how: 'Experiment, What the assay measures: the phenotype and the direction.',
    consequence: 'a higher score was taken to mean more of the function',
  },
  'readout-terms': {
    label: 'The assay in MaveDB\'s terms', kind: 'description', place: 'readout',
    why: 'MaveDB records every assay\'s method, mechanism and model system; a deposit (MaveScape 0.3) needs them.',
    where: 'The assay\'s protocol: its method (a reporter, cell fitness, binding), what it detects (loss or gain of function) and the cells or organism it was done in.',
    how: 'Experiment, What the assay measures.',
  },
  'library-method': {
    label: 'How the library was made', kind: 'bench', place: 'readout',
    why: 'Coverage is judged against what the library can make: error-prone PCR and doped oligos reach mostly the substitutions one base change makes. A deposit records it too.',
    where: 'The cloning protocol or the oligo order (NNK codons, a site-saturation pool, error-prone PCR).',
    how: 'Experiment, What the assay measures, Library made by.',
    consequence: 'coverage was judged against every substitution',
  },
  gates: {
    label: 'The bins\' gates', kind: 'bench', place: 'gates',
    why: 'Sorted bins can be scored by maximum likelihood (Peterman and Levine 2016) only with the gates each bin was sorted between.',
    where: 'The sorter\'s gate settings: its sort report, or the gates drawn on the .fcs files.',
    how: 'Experiment, Bins and gates.',
    consequence: 'the bins could not be scored by maximum likelihood',
  },
  'bin-cells': {
    label: 'Cells sorted into each bin', kind: 'bench', place: 'columns',
    why: 'The maximum-likelihood fit reweights each bin\'s reads by its cells; QC reads the cells per variant in each bin, and the bins\' shares of cells rather than of reads.',
    where: 'The sorter\'s report: the events sorted into each gate.',
    how: 'Experiment, Columns, Cells.',
    consequence: 'reads were not reweighted by cells, and the cells per variant were not assessed',
  },
  'selection-cells': {
    label: 'Cells carried into selection', kind: 'bench', place: 'columns',
    why: 'QC infers a bottleneck from how much replicates disagree; with the cells carried into selection (and recovered after it) recorded, it checks that inference against them.',
    where: 'The transformation\'s titer (colonies from a plated dilution), and the cells plated, passaged or recovered at each step.',
    how: 'Experiment, Columns, Cells, on each input sample (and each output, for the cells recovered).',
    consequence: 'the bottleneck QC infers was not checked against them',
  },
  generations: {
    label: 'Times in generations', kind: 'bench', place: 'time',
    why: 'Scores per generation (selection coefficients) can be compared between experiments of different lengths; a slope over the whole time course cannot.',
    where: 'Cell counts or optical densities at each passage: the generations are log₂ of the growth between dilutions, summed.',
    how: 'Experiment, Unit of time: generation, with the times in generations.',
    consequence: 'scores could not be given per generation',
  },
  'target-identifiers': {
    label: 'The target\'s reference identifier', kind: 'description', place: 'target',
    why: 'A deposit to MaveDB maps the target to UniProt or RefSeq, and comparisons with other assays (MaveScape 0.4) align by it.',
    where: 'UniProt or RefSeq, for the protein or transcript the construct encodes.',
    how: 'Experiment, Target.',
  },
};

// What to bring (the Start page): the required files first, then what improves an analysis.
export const BRING = ['counts', 'target', 'design', 'readout', 'library-method', 'selection-cells', 'gates', 'bin-cells', 'generations', 'target-identifiers'];

const GROUPS = ['Scoring', 'Normalization and scales', 'Replicates', 'Conditions', 'Quality control', 'Record'];

// The facts every verdict reads, from the workspace alone.
function factsOf(ws, design) {
  const source = (ws.sources ?? []).find((s) => s.id === ws.designSource) ?? ws.sources?.[0] ?? null;
  const byKind = source?.summary?.byKind ?? {};
  const counts = Boolean(source && (source.mapping?.countColumns?.length ?? 0) > 0 && !(source.problems?.blocking ?? []).length && source.layout !== 'mavedb-scores');
  const target = design?.targets?.[0] ?? (ws.targets ?? []).find((t) => t.id === source?.target) ?? null;
  const validation = design ? validateDesign(design, source ? { columns: (source.columns ?? []).map((c) => c.name) } : null) : null;
  const controls = design?.controls ?? {};
  // A control class: named rows, none, or found by kind (the import summary counts the kinds).
  const present = (value, kind) => (value === 'none' ? false : Array.isArray(value) ? value.length > 0 : (byKind[kind] ?? 0) > 0);
  const wtNamed = controls.wildType && controls.wildType !== 'auto';
  const wildType = controls.wildType === 'none' ? false : wtNamed && !/^(p\.=|c\.=|n\.=|_wt)$/i.test(controls.wildType) ? true : (byKind['wild type'] ?? 0) > 0;
  const replicates = design?.replicates ?? [];
  // Replicates by condition and tile (QC compares replicates within these; a variant's replicates
  // are combined within its condition).
  const groups = new Map();
  for (const r of replicates) {
    const key = `${r.condition ?? ''}\u0001${r.tile ?? ''}`;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  const sizes = [...groups.values()];
  const sample = (id) => (design?.samples ?? []).find((s) => s.id === id);
  const slots = (r) => replicateSamples(r);
  const binsOf = (r) => [...(r.bins ?? [])].sort((a, b) => a.order - b.order);
  const readout = readoutOf(design);
  return {
    source, counts, target, design,
    designOk: Boolean(design && validation?.ok),
    designErrors: validation?.errors ?? [],
    model: design?.model ?? null,
    barcodes: design?.library?.level === 'barcode',
    level: design?.variants?.level ?? null,
    wildType,
    synonymous: present(controls.synonymous ?? 'auto', 'synonymous'),
    synonymousCount: controls.synonymous === 'none' ? 0 : Array.isArray(controls.synonymous) ? controls.synonymous.length : byKind.synonymous ?? 0,
    nonsense: present(controls.nonsense ?? 'auto', 'nonsense'),
    minGroup: sizes.length ? Math.min(...sizes) : 0,
    maxGroup: sizes.length ? Math.max(...sizes) : 0,
    conditions: design?.conditions?.length ?? 0,
    timePoints: design?.model === 'time-series' && replicates.length > 0 && replicates.every((r) => slots(r).length >= 3),
    generations: design?.time?.unit === 'generation',
    timeUnit: design?.time?.unit ?? null,
    gates: design?.model === 'bins' && replicates.length > 0 && replicates.every((r) => binsOf(r).every((b, k, all) => (k === 0 || b.lower > 0) && (k === all.length - 1 || b.upper > 0))),
    binCells: design?.model === 'bins' && replicates.length > 0 && replicates.every((r) => binsOf(r).every((b) => sample(b.sample)?.cells > 0)),
    selectionCells: design?.model === 'two-population' && replicates.length > 0 && replicates.every((r) => sample(r.input)?.cells > 0),
    readout: readout.stated && Boolean(readout.phenotype),
    readoutTerms: Boolean(readout.method && readout.mechanism && readout.modelSystem),
    libraryMethod: Boolean(design?.library?.method),
    identifiers: Boolean(target?.identifiers?.uniprot || target?.identifiers?.refseq || target?.identifiers?.ensembl),
  };
}

// An analysis: ready unless it needs something missing; partial when only what improves it is
// missing. needs/improves: [[gap id, missing?]].
function analysis(group, id, label, { needs = [], improves = [], note = null, unavailable = false } = {}) {
  const lacking = needs.filter(([, missing]) => missing).map(([gap]) => gap);
  const better = improves.filter(([, missing]) => missing).map(([gap]) => gap);
  const status = unavailable || lacking.length ? 'unavailable' : better.length ? 'partial' : 'ready';
  return { id, group, label, status, needs: lacking, improves: status === 'unavailable' ? [] : better, note };
}

// The analyses a design allows, each with its verdict.
function analysesOf(f) {
  const out = [];
  const add = (...args) => out.push(analysis(...args));
  const twoPop = f.model === 'two-population';
  const time = f.model === 'time-series';
  const bins = f.model === 'bins';
  // One replicate in every group (condition and tile): nothing to compare.
  const single = f.maxGroup < 2;

  // Scoring.
  if (twoPop) {
    add('Scoring', 'score.log-ratio', 'Log ratios of output to input (Enrich2)');
    add('Scoring', 'score.dimsum', 'DiMSum\'s fitness and error model', { needs: [['wild-type', !f.wildType]] });
  }
  if (time) {
    add('Scoring', 'score.regression', 'Weighted regression on every time point', { needs: [['time-points', !f.timePoints]] });
    add('Scoring', 'score.ratio-of-ends', 'Log ratio of the first and last samples');
    // Rounds of selection are not generations: their scores can be per round, and no record of
    // growth would make them per generation.
    if (f.timeUnit !== 'round') {
      add('Scoring', 'score.per-generation', 'Scores per generation (selection coefficients)', {
        needs: [['generations', !f.generations]],
        note: f.generations ? null : `Scores can be given per ${f.timeUnit && f.timeUnit !== 'other' ? f.timeUnit : 'unit of time'} now (Score, A score is the change); per generation needs the times in generations.`,
      });
    }
  }
  if (bins) {
    add('Scoring', 'score.bin-average', 'The weighted average of the bins\' values (VAMP-seq)');
    // σ is the wild type's by default; without it, each variant's own (reads in three bins).
    add('Scoring', 'score.bin-mle', 'Maximum likelihood from the gates (Peterman and Levine)', { needs: [['gates', !f.gates]], improves: [['bin-cells', !f.binCells], ['wild-type', !f.wildType]] });
  }
  if (f.barcodes && !bins) add('Scoring', 'score.barcodes-each', 'Each barcode scored, then combined');

  // Normalization and scales.
  if (bins) {
    add('Normalization and scales', 'scale.bins-nonsense-wt', 'Each replicate scaled to nonsense 0, wild type 1 (VAMP-seq)', { needs: [['nonsense', !f.nonsense], ['wild-type', !f.wildType]] });
    add('Normalization and scales', 'scale.bins-low5-wt', 'Each replicate scaled to its lowest 5% 0, wild type 1 (MultiSTEP)', { needs: [['wild-type', !f.wildType]] });
  } else {
    add('Normalization and scales', 'normalize.wild-type', 'Scores relative to the wild type', { needs: [['wild-type', !f.wildType]] });
    add('Normalization and scales', 'normalize.synonymous', 'Scores relative to the synonymous median', { needs: [['synonymous', !f.synonymous]] });
  }
  add('Normalization and scales', 'rescale.nonsense-wt', 'Rescaled: nonsense 0, wild type 1', { needs: [['nonsense', !f.nonsense], ['wild-type', !f.wildType]] });
  add('Normalization and scales', 'rescale.synonymous-nonsense', 'Rescaled: synonymous 0, nonsense −1', { needs: [['synonymous', !f.synonymous], ['nonsense', !f.nonsense]] });

  // Replicates.
  add('Replicates', 'replicates.combine', 'Replicates combined with the noise between them', { needs: [['replicates', single]], improves: [['replicates', !single && f.minGroup < 2]] });
  add('Replicates', 'replicates.leave-one-out', 'How far a score moves with one replicate left out', { needs: [['replicates', single]] });

  // Conditions.
  add('Conditions', 'conditions.differential', 'Differential scores between conditions', { needs: [['conditions', f.conditions < 2]], improves: [['replicates', f.conditions >= 2 && f.minGroup < 2]] });

  // Quality control: each finding (findings.js), as qc.<finding id>.
  const qc = (id, label, options) => add('Quality control', `qc.${id}`, label, options);
  qc('missing-sample', 'Every sample has counts');
  qc('depth', 'Sequencing depth');
  if (!bins) qc('low-count', 'Low counts before selection');
  qc('missingness', 'Missing counts');
  if (!bins) qc('dropout', 'Missing after selection');
  qc('coverage', 'Coverage of designed substitutions', {
    improves: [['library-method', !f.libraryMethod]],
    unavailable: f.level !== 'protein' || (f.design?.targets?.length ?? 0) !== 1,
    note: f.level !== 'protein' ? 'Coverage by position is computed for protein-level variants; nucleotide coverage comes with MaveScape 0.3.' : (f.design?.targets?.length ?? 0) !== 1 ? 'Coverage is computed for a design with a single target.' : null,
  });
  qc('agreement', 'Replicate agreement', { needs: [['replicates', single]] });
  qc('excess-variance', 'Variance beyond counting (bottleneck)', {
    // With one replicate, synonymous variants (ten or more) still show it.
    needs: [['replicates', single && (bins || f.synonymousCount < 10)]],
    improves: [['selection-cells', twoPop && !f.selectionCells], ['wild-type', twoPop && !f.wildType]],
  });
  qc('outlier-replicate', 'Outlier replicates', { needs: [['third-replicate', f.maxGroup < 3]] });
  qc('separation', 'Separation of controls', { needs: [['nonsense', !f.nonsense], [f.wildType ? 'synonymous' : 'wild-type', !f.synonymous && !f.wildType]], improves: [['readout', !f.readout]] });
  qc('resolution', 'Resolution of scores', { needs: [['nonsense', !f.nonsense], [f.wildType ? 'synonymous' : 'wild-type', !f.synonymous && !f.wildType]] });
  qc('scored-fraction', 'Variants scored');
  if (bins) {
    qc('bin-occupancy', 'Occupancy of the bins', { improves: [['bin-cells', !f.binCells]] });
    qc('cells-per-bin', 'Cells sorted per variant', { needs: [['bin-cells', !f.binCells]] });
  }
  if (f.barcodes) {
    qc('barcode-map', 'Barcodes the map names');
    qc('barcodes-per-variant', 'Barcodes per variant');
    if (!bins) {
      qc('barcode-agreement', 'Agreement of a variant\'s barcodes');
      qc('outlier-barcodes', 'Outlier barcodes');
    }
  }
  if (time) {
    qc('time-points', 'Time points used', { needs: [['time-points', !f.timePoints]] });
    qc('time-fit', 'Fit of the time courses', { needs: [['time-points', !f.timePoints]] });
  }

  // The record.
  add('Record', 'record.scores', 'Scores in MaveDB\'s columns, with their SEs and intervals');
  add('Record', 'record.methods', 'The methods paragraph and its references', { improves: [['readout', !f.readout]] });
  add('Record', 'record.package', 'The analysis package: counts, target, design, sample sheet and parameters');
  add('Record', 'record.deposit', 'Everything a MaveDB deposit asks for (deposits come with MaveScape 0.3)', {
    needs: [['readout', !f.readout], ['readout-terms', !f.readoutTerms], ['library-method', !f.libraryMethod], ['target-identifiers', !f.identifiers]],
  });
  return out;
}

// The readiness of a workspace. options.design: a design to judge in place of the workspace's
// (mavescape validate checks a design file before it is set).
export function readiness(ws, options = {}) {
  const design = options.design ?? ws.design ?? null;
  const f = factsOf(ws, design);
  const base = { counts: f.counts, target: Boolean(f.target), design: f.designOk };
  let analyses = [];
  const missingBase = Object.entries(base).filter(([, ok]) => !ok).map(([id]) => id);
  if (!missingBase.length && f.model !== 'scores') analyses = analysesOf(f);
  else if (!missingBase.length) {
    analyses = [
      analysis('Record', 'record.scores', 'The imported scores on the map, explored and exported'),
      analysis('Record', 'record.deposit', 'Everything a MaveDB deposit asks for (deposits come with MaveScape 0.3)', { needs: [['readout', !f.readout], ['readout-terms', !f.readoutTerms], ['target-identifiers', !f.identifiers]] }),
    ];
  }
  // The gaps: the missing base, then each gap an analysis needs or would be improved by, in the
  // order of GAPS.
  const unlocks = new Map(missingBase.map((id) => [id, []]));
  const improves = new Map();
  for (const a of analyses) {
    for (const g of a.needs) unlocks.set(g, [...(unlocks.get(g) ?? []), a.id]);
    for (const g of a.improves) improves.set(g, [...(improves.get(g) ?? []), a.id]);
  }
  const gaps = Object.keys(GAPS).filter((id) => unlocks.has(id) || improves.has(id)).map((id) => ({
    id, ...GAPS[id],
    ...(id === 'design' && design && f.designErrors.length ? { detail: f.designErrors[0].message } : {}),
    unlocks: unlocks.get(id) ?? [], improves: improves.get(id) ?? [],
  }));
  const tally = (status) => analyses.filter((a) => a.status === status).length;
  return {
    version: READINESS_VERSION,
    model: f.model,
    base,
    analyses: analyses.sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group)),
    gaps,
    counts: { ready: tally('ready'), partial: tally('partial'), unavailable: tally('unavailable') },
  };
}

// The gaps a researcher can fill now (not another experiment), for the strip.
export const fillable = (r) => r.gaps.filter((g) => g.kind !== 'experiment');
const lower = (label) => `${label.charAt(0).toLowerCase()}${label.slice(1)}`;

// What was not recorded and what that meant, for the methods: the gaps with a consequence that
// change an analysis of the run, each "the cells carried into selection (the bottleneck QC infers
// was not checked against them)". Empty when nothing is missing.
export function notRecorded(r) {
  return r.gaps.filter((g) => g.consequence && [...g.unlocks, ...g.improves].some((id) => id !== 'record.deposit'))
    .map((g) => `${g.label.charAt(0).toLowerCase()}${g.label.slice(1)} (${g.consequence})`);
}

// One line for the strip and the command line.
export function readinessLine(r) {
  if (!r.analyses.length) return r.gaps.length ? `Needs ${r.gaps.map((g) => lower(g.label)).join(', ')}` : 'Nothing to analyze yet';
  const { ready, partial, unavailable } = r.counts;
  return `${ready} of ${r.analyses.length} analyses ready${partial ? `, ${partial} partial` : ''}${unavailable ? `, ${unavailable} not possible` : ''}`;
}

// The readiness in plain text (Markdown), for the package's README (every analysis) and
// `mavescape validate` (all: false: those not ready).
export function readinessText(r, { all = true } = {}) {
  const label = new Map(r.analyses.map((a) => [a.id, a.label]));
  const names = (ids) => ids.map((id) => label.get(id) ?? id).join('; ');
  const lines = [readinessLine(r)];
  if (r.analyses.length) {
    lines.push('');
    for (const group of GROUPS) {
      const these = r.analyses.filter((a) => a.group === group && (all || a.status !== 'ready'));
      if (!these.length) continue;
      lines.push(`${group}:`);
      for (const a of these) lines.push(`- ${a.status === 'ready' ? 'ready' : a.status === 'partial' ? 'partial' : 'not possible'}: ${a.label}${a.needs.length ? ` (needs ${a.needs.map((g) => lower(GAPS[g].label)).join(', ')})` : ''}${a.improves.length ? ` (better with ${a.improves.map((g) => lower(GAPS[g].label)).join(', ')})` : ''}${a.note && a.status !== 'ready' ? `. ${a.note}` : ''}`);
    }
  }
  const now = r.gaps.filter((g) => g.kind !== 'experiment');
  const later = r.gaps.filter((g) => g.kind === 'experiment');
  for (const [title, gaps] of [['What is missing:', now], ['What another experiment would add:', later]]) {
    if (!gaps.length) continue;
    lines.push('', title);
    for (const g of gaps) {
      const changes = [g.unlocks.length ? `unlocks ${names(g.unlocks)}` : null, g.improves.length ? `improves ${names(g.improves)}` : null].filter(Boolean).join('; ');
      lines.push(`- ${g.label}${g.detail ? ` (${g.detail})` : ''}: ${g.why} Usually found: ${g.where} In MaveScape: ${g.how}${changes ? ` (${changes})` : ''}`);
    }
  }
  return lines.join('\n');
}
