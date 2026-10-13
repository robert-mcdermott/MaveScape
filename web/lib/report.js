// The report (wave 6, slice 4; requirement R4): the methods of the workspace, not only of a run,
// written from its record whenever it is shown. Each run's data, design, scoring (with a table of
// its parameters) and quality control, as its own methods say them (lib/methods.js); the
// comparisons and robustness checks kept in the report; the control sets and calibrations (wave 8,
// slice 5: for research); the saved selections, the annotations, the structures and the figures; every input's SHA-256; the software; the decision log (the history,
// in words); the limitations (what the counts did not record, the models' assumptions, findings
// not acknowledged); the research-use statement; numbered references and their BibTeX.
//
// It says only what the record holds: an operation not performed has no sentence, and a reference
// no sentence cites is not listed. Runs whose paragraphs read the same are named together. The same
// workspace and context give the same text, in Node as in the window.

import { annotationSentence, mavescapeReference, referenceText, REFERENCES, RESEARCH_USE, runParagraphs, structureParagraphs, toBibTeX } from './methods.js';
import { withDefaults } from './score.js';
import { NORMALIZATIONS } from './score-ratio.js';
import { THRESHOLDS, defaultThresholds } from './findings.js';
import { verifyHistory } from './workspace.js';
import { FIGURE_SIZES, panelLetters, panelSummary } from './figures.js';
import { annotationFiles, figureFiles, sourceFiles, structureFiles } from './archive.js';
import { comparisonJSON, DISCORDANT_Q, filtersApplied, SCALES } from './compare.js';
import { ROBUSTNESS_Q } from './robustness.js';
import { possessive } from './words.js';
import { decisions, describeProposal, openProposals } from './proposals.js';
import { calibrationParagraphs, calibrationSubjects, controlSetParagraph } from './calibration-record.js';

export const REPORT_FORMAT = 'mavescape-report';
export const REPORT_VERSION = 1;

const list = (items) => (items.length > 2 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : items.join(' and '));
const count = (n) => n.toLocaleString('en-US');
const plural = (n, word, many = `${word}s`) => `${count(n)} ${n === 1 ? word : many}`;
const f3 = (x) => (Number.isFinite(x) ? x.toFixed(3) : 'NA');
const g3 = (x) => (Number.isFinite(x) ? String(Number(x.toPrecision(3))) : 'NA');
const short = (hash) => (hash ? `${hash.slice(0, 12)}…` : '—');
const toMM = (pt) => Math.round((pt * 25.4) / 72);

// --- What the report keeps of a comparison or a robustness check ---------------------------------------

// A comparison as kept in the report (ws.analyses; lib/workspace.js, keepAnalysis): its two sides
// (as the Compare view names them, with each run's output SHA-256), the scale and filters, the
// compatibility report, what was matched and the statistics, as compareSides gave them. c: its
// result; pair: { a, b } (the sides' specs).
export function comparisonRecord(c, pair) {
  const j = JSON.parse(comparisonJSON(c));
  const d = j.discordance;
  const k = j.classes;
  return {
    kind: 'comparison',
    a: { spec: pair.a, ...j.a },
    b: { spec: pair.b, ...j.b },
    level: j.level,
    coordinates: j.coordinates,
    bNegated: j.bNegated,
    sameScale: j.sameScale,
    scale: { mode: j.scale?.mode ?? 'scored', applied: Boolean(j.scale?.applied), reason: j.scale?.reason ?? null },
    filters: j.filters,
    report: j.report,
    matched: j.matched,
    statistics: j.statistics,
    discordance: d ? { valid: d.valid, reason: d.reason, tested: d.tested, discordant: d.discordant, dispersion: d.dispersion, q: d.q } : null,
    classes: k ? { valid: k.valid, reason: k.reason, predictor: k.predictor, measured: k.measured, auc: k.auc, list: k.list } : null,
    withheld: j.withheld,
  };
}

// A run's robustness check as kept in the report: the run (by its output's SHA-256), the choices
// varied, how many analyses, and what each target's verdicts were (lib/robustness.js's summary).
export function robustnessRecord(run, summary, { max, seed }) {
  return {
    kind: 'robustness',
    run: { id: run.id, name: run.name, output: run.output.sha256 },
    total: summary.total,
    skipped: summary.skipped?.length ?? 0,
    max,
    seed,
    choices: summary.choices.map((c) => ({ id: c.id, label: c.label, options: c.options.map((o) => ({ id: o.id, label: o.label })) })),
    targets: summary.targets.map((t) => ({ id: t.id, name: t.name, kind: t.kind, n: t.n, counts: t.counts, text: t.text })),
  };
}

// An analysis kept in the report, in a few words (the history's, the Report view's).
export function analysisName(a) {
  if (a.kind === 'comparison') return `the comparison of ${a.a.label} and ${a.b.label}`;
  if (a.kind === 'robustness') return `${possessive(a.run.name)} robustness to analysis choices`;
  return a.kind;
}

// The history's words for keeping one.
export function keptWords(a) {
  if (a.kind === 'comparison') {
    const s = a.statistics;
    const r = s?.pearson?.r;
    return `Added to the report ${analysisName(a)}: ${plural(s?.n ?? 0, 'variant')} compared${Number.isFinite(r) ? `, Pearson's r ${f3(r)}` : ''}${a.discordance?.valid ? `, ${count(a.discordance.discordant)} discordant` : ''}`;
  }
  const t = a.targets[0];
  return `Added to the report ${analysisName(a)}: ${a.total - 1} alternative analyses${t ? `; ${count(t.counts.robust)} of ${count(t.n)} variants robust` : ''}`;
}

// --- The paragraphs -------------------------------------------------------------------------------------

function comparisonParagraph(a, cite) {
  const s = a.statistics ?? {};
  const scale = a.scale.mode === 'stated' ? ', stated to be on one scale,' : a.scale.mode !== 'scored' ? `, each rescaled by its own anchors (${(SCALES[a.scale.mode]?.label ?? a.scale.mode).replace(/^rescaled by their anchors: /, '')}),` : '';
  const f = a.filters ?? {};
  const kept = filtersApplied(f) ? ` and kept by the filters (${[f.lowConfidence ? 'of low confidence on neither side' : null, Number.isFinite(f.maxSE) ? `SE at most ${f.maxSE} on both` : null, Number.isFinite(f.minReads) ? `at least ${f.minReads} input reads on both` : null].filter(Boolean).join('; ')})` : '';
  const parts = [`${a.a.label} and ${a.b.label} were compared${scale} on ${plural(s.n ?? 0, 'variant')} scored on both${kept}${a.level === 'protein' ? ', at the protein level' : ''}.`];
  if (a.bNegated) parts.push(`${possessive(a.b.label)} scores were negated, a higher score meaning the opposite there.`);
  const stats = [];
  if (Number.isFinite(s.pearson?.r)) stats.push(`Pearson's r = ${f3(s.pearson.r)} (95% interval ${f3(s.pearson.low)} to ${f3(s.pearson.high)}, by Fisher's z)`);
  if (Number.isFinite(s.spearman?.rho)) stats.push(`Spearman's ρ = ${f3(s.spearman.rho)} (${f3(s.spearman.low)} to ${f3(s.spearman.high)}, with Bonett and Wright's SE ${cite('bonett2000')})`);
  if (Number.isFinite(s.concordance?.ccc)) stats.push(`Lin's concordance correlation ρc = ${f3(s.concordance.ccc)} (${f3(s.concordance.low)} to ${f3(s.concordance.high)}) ${cite('lin1989')} ${cite('lin2000')}`);
  if (Number.isFinite(s.blandAltman?.bias)) stats.push(`a mean difference (${a.a.label} − ${a.b.label}) of ${f3(s.blandAltman.bias)} with 95% limits of agreement ${f3(s.blandAltman.lower)} to ${f3(s.blandAltman.upper)} ${cite('blandAltman1986')} ${cite('blandAltman1999')}`);
  if (stats.length) parts.push(`${stats.join('; ').replace(/^./, (x) => x.toUpperCase())}.`);
  const withheld = (a.withheld ?? []).filter((w) => w === 'concordance' || w === 'blandAltman');
  if (withheld.length) parts.push(`${withheld.length === 2 ? 'Lin\'s concordance and the limits of agreement were' : withheld[0] === 'concordance' ? 'Lin\'s concordance was' : 'The limits of agreement were'} withheld: they measure agreement on one scale, ${a.classes ? 'and one side is a prediction' : 'and the two are not on one'}.`);
  const d = a.discordance;
  if (d?.valid) parts.push(`${plural(d.discordant, 'variant')} of ${count(d.tested)} differed beyond their uncertainty: the difference over √(SE₁² + SE₂²) tested against the normal distribution, q < ${d.q ?? DISCORDANT_Q} by Benjamini and Hochberg's method ${cite('bh')}; the median z² was ${g3(d.dispersion)} times χ²₁'s.`);
  else if (d && !a.classes) parts.push(`Their differences were not tested beyond their uncertainty: ${/^Not independent/.test(d.reason) ? 'the SE of a difference assumes the two independent, and they are not' : /^Not on one scale/.test(d.reason) ? 'a difference has no meaning until the two are on one scale' : d.reason.replace(/^./, (x) => x.toLowerCase()).replace(/\.$/, '')}.`);
  const k = a.classes;
  if (k?.valid && k.auc) parts.push(`${possessive(k.measured)} scores in ${possessive(k.predictor)} classes: ${k.list.map((x) => `${x.label} ${plural(x.n, 'variant')}, median ${g3(x.median)}`).join('; ')}; the chance that a tolerated substitution scores more of the function than a damaging one (AUC) ${f3(k.auc.auc)} (${f3(k.auc.low)} to ${f3(k.auc.high)}, DeLong's interval ${cite('delong1988')}).`);
  const care = (a.report?.items ?? []).filter((x) => x.status === 'qualified');
  if (care.length) parts.push(`To read with care: ${care.map((x) => `${x.label.toLowerCase()}: ${x.text.replace(/^./, (c) => c.toLowerCase())}`).join(' ')}`);
  return parts.join(' ');
}

function robustnessParagraph(a, cite) {
  const varied = a.choices.map((c) => (c.id === 'leaveOut' ? `each of ${c.options.length - 1} replicates left out in turn` : `${c.label.toLowerCase()}: ${list(c.options.slice(1).map((o) => o.label))}`));
  const verdicts = a.targets.map((t) => `${a.targets.length > 1 ? `${t.name}: ` : ''}${t.text}`).join(' ');
  const combined = a.total - 1 - a.choices.reduce((n, c) => n + c.options.length - 1, 0);
  return `${possessive(a.run.name)} scores (output SHA-256 ${short(a.run.output)}) were checked against ${plural(a.total - 1, 'alternative analysis', 'alternative analyses')}${a.skipped ? ` (${a.skipped} more could not be scored)` : ''}, a multiverse or specification-curve analysis ${cite('steegen2016')} ${cite('simonsohn2020')}: each alternative alone${combined > 0 ? `, then ${plural(combined, 'combination')} of them drawn with seed ${a.seed}` : ''}. It varied ${varied.join('; ')}. A variant's class (lower than, like or higher than the wild type, q < ${ROBUSTNESS_Q}) is robust when every analysis gives it. ${verdicts}`.trim();
}

// What a run's model assumes, in words (the limitations).
function assumptions(run) {
  const p = withDefaults(run.inputs.parameters);
  const normalizer = `the normalizer (the ${NORMALIZATIONS[p.normalization] ?? p.normalization}) stands for no effect`;
  const out = [];
  if (p.model === 'published') return 'its scores and SEs are the publication\'s, read as published: how they were computed is not MaveScape\'s to check';
  if (p.model === 'ratio') out.push(`a variant's reads before and after selection are proportional to its share of the cells sampled, and ${normalizer}`);
  else if (p.model === 'wls' || p.model === 'ols') out.push(`each variant's log frequency changes at a constant rate over the time course, and ${normalizer}`);
  else if (p.model === 'bins') out.push('the bins\' values stand for the readout, and a variant\'s cells are spread over the bins as its reads are');
  else if (p.model === 'bins-mle') out.push('each variant\'s readout is log-normal, censored by the bins\' gates as recorded');
  else if (p.model === 'dimsum') out.push('DiMSum\'s fitness takes no pseudocount, so a variant not counted after selection has no score');
  out.push(p.model === 'dimsum' && p.dimsumErrorModel ? 'a replicate\'s SE is DiMSum\'s error model, its terms shared by every variant of the replicate' : 'a replicate\'s SE is the counting of reads (Poisson), so any other variance shows as disagreement between replicates');
  out.push({
    moderated: 'the replicates\' variance follows one error model for every variant (a·s² + b), and each variant\'s dispersion is moderated toward a prior shared by all',
    reml: 'the replicates scatter normally about each variant\'s effect (random effects)',
    fixed: 'the replicates measure one effect, differing by their SEs alone (fixed effects)',
    mean: 'the replicates weigh equally',
    enrich2: 'the replicates scatter about each variant\'s effect as Enrich2\'s random-effects estimator models them',
  }[p.combination] ?? `replicates combined by ${p.combination}`);
  out.push(`95% intervals are ${p.combination === 'moderated' ? 't with the moderated degrees of freedom' : 'normal, ±1.96 SE'}`);
  return out.join('; ');
}

// Text blocks with the same words, named together: [[text, [names]]].
function together(items) {
  const groups = new Map();
  for (const [text, name] of items) {
    if (!text) continue;
    if (!groups.has(text)) groups.set(text, []);
    groups.get(text).push(name);
  }
  return [...groups];
}

const PARAMETER_ORDER = ['model', 'normalization', 'pseudocount', 'regressionSE', 'timeScale', 'binScale', 'binSE', 'binSigma', 'dimsumNormalise', 'dimsumErrorModel', 'dimsumDropout', 'bootstrapSamples', 'seed', 'aggregation', 'barcodeCombination', 'combination', 'rescale', 'differential',
  'filters.minInputCount', 'filters.minTotalCount', 'filters.minTimePoints', 'filters.minFrequency', 'filters.minBarcodes', 'filters.maxBarcodeZ', 'filters.minReplicates', 'filters.maxSE', 'filters.excludeKinds', 'filters.exclude'];

// The parameters a run's model reads, as parameters.json names them.
function parameterKeys(run) {
  const p = withDefaults(run.inputs.parameters);
  const design = run.inputs.design;
  if (p.model === 'published') return ['model', 'filters.maxSE', 'filters.excludeKinds', 'filters.exclude'];
  const keys = new Set(['model', 'combination', 'rescale', 'filters.minInputCount', 'filters.minTotalCount', 'filters.minReplicates', 'filters.maxSE', 'filters.excludeKinds', 'filters.exclude']);
  const add = (...k) => k.forEach((x) => keys.add(x));
  if (['ratio', 'wls', 'ols'].includes(p.model)) add('normalization', 'pseudocount');
  if (p.model === 'wls' || p.model === 'ols') add('regressionSE', 'filters.minTimePoints');
  if (design.model === 'time-series') add('timeScale');
  if (p.model === 'bins') add('pseudocount', 'binScale', 'binSE', ...(p.binSE === 'bootstrap' ? ['bootstrapSamples', 'seed'] : []));
  if (p.model === 'bins-mle') add('binScale', 'binSigma');
  if (p.model === 'bins' || p.model === 'bins-mle') add('filters.minFrequency');
  if (p.model === 'dimsum') add('dimsumNormalise', 'dimsumErrorModel', 'dimsumDropout', ...(p.dimsumErrorModel ? ['bootstrapSamples', 'seed'] : []));
  if (design.library?.level === 'barcode') add('aggregation', ...(p.aggregation === 'sum' ? [] : ['barcodeCombination']), 'filters.minBarcodes', 'filters.maxBarcodeZ');
  if ((design.conditions?.length ?? 0) >= 2) add('differential');
  return [...keys];
}

function parameterValue(p, key) {
  const value = key.startsWith('filters.') ? p.filters[key.slice(8)] : p[key];
  if (value === null || value === undefined) return '—';
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
}

// The QC thresholds changed from MaveScape's defaults, in words; empty when none was.
function thresholdChanges(thresholds) {
  if (!thresholds) return [];
  const d = defaultThresholds();
  const out = [];
  for (const t of THRESHOLDS) {
    if (!(t.key in thresholds)) continue;
    const now = thresholds[t.key];
    if (t.measure) {
      if (now !== d[t.key]) out.push(`${t.label.charAt(0).toLowerCase()}${t.label.slice(1)} ${now} ${t.unit} (MaveScape's ${d[t.key]})`);
    } else if (now?.review !== d[t.key].review || now?.fail !== d[t.key].fail) {
      out.push(`${t.label.charAt(0).toLowerCase()}${t.label.slice(1)}: to review ${t.bad} ${now.review ?? d[t.key].review}, failing ${t.bad} ${now.fail ?? d[t.key].fail} (MaveScape's ${d[t.key].review} and ${d[t.key].fail})`);
    }
  }
  return out;
}

// --- The report -------------------------------------------------------------------------------------------

// Writes the report of a workspace. context: { software: { version, commit } (the MaveScape
// writing it), runs: Map(run id → { findings (its QC findings), results (its scores, for the
// rescaling anchors' SEs) }), calibrations: Map(calibration id → lib/calibration-record.js's
// calibrationOutcome, or { problem }), each optional }. Returns { format, version, title, sections: [{ id,
// title, blocks: [{ kind: 'p', label?, text } | { kind: 'table', columns, rows } | { kind: 'list',
// items }] }], references: [{ n, key, text }], markdown, bibtex }.
export function writeReport(ws, context = {}) {
  // References are cited while the text is written and numbered in the order the text cites them
  // (several runs' paragraphs are written before they are placed): a placeholder [9nnnnn] for each,
  // shaped as a number so that the run's sentences read it as they read a citation.
  // A run's data cite their publication as 'data': another run's other publication is another
  // reference.
  const cited = new Map();
  const cite = (key, ref = REFERENCES[key]) => {
    const id = key === 'data' ? `data:${ref?.text ?? ''}` : key;
    if (!cited.has(id)) {
      const same = [...cited.values()].filter((c) => c.key === key || c.key.startsWith(`${key}-`)).length;
      cited.set(id, { key: same ? `${key}-${same + 1}` : key, ref, token: 900001 + cited.size });
    }
    return `[${cited.get(id).token}]`;
  };
  const software = context.software ?? {};
  const info = context.runs ?? new Map();
  const runs = ws.runs ?? [];
  const many = runs.length > 1;
  const sections = [];
  const section = (id, title, blocks) => {
    if (blocks.length) sections.push({ id, title, blocks });
  };
  const paragraph = (text, label = null) => ({ kind: 'p', ...(label ? { label } : {}), text });
  const named = (groups) => groups.map(([text, names]) => paragraph(text, many ? list(names) : null));

  const own = runs.map((run) => ({ run, ...runParagraphs(ws, run, { findings: info.get(run.id)?.findings ?? null, results: info.get(run.id)?.results ?? null, missingApart: true }, cite) }));

  // What the workspace holds, in a sentence.
  const intro = [paragraph(`The methods of the workspace "${ws.name}", written by MaveScape ${software.version ?? '?'} from its record as it stood on ${String(ws.modified ?? ws.created).slice(0, 10)}: ${runs.length ? `${plural(runs.length, 'score run')} of ${plural(new Set(runs.map((r) => r.inputs.source.sha256)).size, 'table')}` : 'no score run yet'}${(ws.analyses ?? []).length ? `, ${plural(ws.analyses.length, 'analysis', 'analyses')} kept in the report` : ''}${(ws.calibrations ?? []).length ? `, ${plural(ws.calibrations.length, 'calibration')}` : ''}${(ws.figures ?? []).length ? `, ${plural(ws.figures.length, 'figure')}` : ''}. It says only what was done.`)];
  section('summary', null, intro);

  // The data, the design and the scoring, run by run.
  const unscored = ws.sources.filter((s) => !runs.some((r) => r.inputs.source.sha256 === s.sha256));
  section('data', 'Data', [
    ...named(together(own.map((o) => [o.data, o.run.name]))),
    ...(unscored.length ? [paragraph(`Also in the workspace, not scored: ${list(unscored.map((s) => `${s.name} (SHA-256 ${s.sha256}${s.rows ? `; ${count(s.rows)} rows` : ''})`))}.`)] : []),
  ]);
  section('design', 'Design', named(together(own.map((o) => [o.design.replace(/^Design: /, ''), o.run.name]))));
  if (runs.length) {
    const keys = PARAMETER_ORDER.filter((k) => runs.some((r) => parameterKeys(r).includes(k)));
    const rows = keys.map((k) => [`\`${k}\``, ...runs.map((r) => (parameterKeys(r).includes(k) ? parameterValue(withDefaults(r.inputs.parameters), k) : ''))]);
    section('scoring', 'Scoring', [
      ...named(together(own.map((o) => [o.scoring, o.run.name]))),
      { kind: 'table', caption: 'The parameters of each run, as parameters.json names them (MaveScape\'s defaults where the run set none).', columns: ['Parameter', ...runs.map((r) => r.name)], rows },
    ]);
  }

  // Quality control: each run's findings and acknowledgements, and the thresholds when changed.
  const changed = thresholdChanges(ws.qc?.thresholds);
  section('qc', 'Quality control', [
    ...named(together(own.map((o) => [o.qc?.replace(/^Quality control: (.)/, (_, c) => c.toUpperCase()), o.run.name]))),
    ...(changed.length && runs.length ? [paragraph(`The QC thresholds were changed from MaveScape's defaults: ${changed.join('; ')}.`)] : []),
  ]);

  // The analyses kept in the report.
  const analyses = ws.analyses ?? [];
  section('comparisons', 'Comparisons', analyses.filter((a) => a.kind === 'comparison').map((a) => paragraph(comparisonParagraph(a, cite))));
  section('robustness', 'Robustness to analysis choices', analyses.filter((a) => a.kind === 'robustness').map((a) => paragraph(robustnessParagraph(a, cite))));

  // Calibration, for research (wave 8, slice 5): each control set (where its labels came from, its
  // composition, what was left out) and each calibration computed again (its metrics, evidence
  // strength and likelihood ratios); what limits them is said with the limitations.
  const sets = ws.controlSets ?? [];
  const calibrations = ws.calibrations ?? [];
  const given = context.calibrations ?? new Map();
  const outcomes = calibrations.map((cal) => {
    const o = given.get(cal.id);
    if (o?.metrics) return o;
    const subjects = calibrationSubjects(ws, cal);
    return { cal, ...subjects, problem: o?.problem ?? subjects.problem };
  });
  section('calibration', 'Calibration, for research', sets.length || calibrations.length ? [
    ...sets.map((set) => paragraph(controlSetParagraph(set, ws, cite))),
    ...outcomes.flatMap((o) => calibrationParagraphs(o, cite).map((text, i) => paragraph(text, i === 0 ? o.cal.name : null))),
    ...(calibrations.length ? [paragraph('Calibration says how far the scores separate variants whose effect is known, the functional classes thresholds on them make in this assay, and the evidence strength those classes would give: for research. MaveScape classifies no variant; a clinical classification rests on more than one assay and is made elsewhere.')] : []),
  ] : []);

  // Saved selections.
  const runName = (id) => runs.find((r) => r.id === id)?.name ?? `a run no longer in the workspace (${id})`;
  section('selections', 'Selections', ws.selections.length ? [{
    kind: 'list',
    items: ws.selections.map((s) => {
      const run = runs.find((r) => r.id === s.run);
      const condition = run && run.output.conditions.length > 1 ? `, ${run.output.conditions[s.condition ?? 0]?.name}` : '';
      return `"${s.name}": ${plural(s.keys.length, 'variant')} of ${runName(s.run)}${condition}, ${s.query ? `selected by the query "${s.query}"` : 'selected on the map'}.`;
    }),
  }] : []);

  // Annotations and structures, as each run's methods say them.
  const annotations = (ws.annotations ?? []).map((a) => annotationSentence(a, cite)).filter(Boolean);
  section('annotations', 'Annotations', annotations.length ? [paragraph(`Shown beside the map: ${annotations.join(' ')}`)] : []);
  section('structures', 'Structures', (ws.structures ?? []).length ? structureParagraphs(ws, cite).map((t) => paragraph(t.replace(/^Structures: /, ''))) : []);

  // Figures: each panel by its letter and what it shows.
  section('figures', 'Figures', (ws.figures ?? []).length ? [{
    kind: 'list',
    items: ws.figures.map((fig) => {
      const size = FIGURE_SIZES.find((x) => x.id === fig.size);
      const letters = fig.letters ? panelLetters(fig) : new Map();
      const panels = fig.panels.map((p) => `${letters.get(p.id) ? `${letters.get(p.id)}, ` : ''}${panelSummary(p, ws)}`);
      return `${fig.name} (${size ? `${size.label.toLowerCase()}, ` : ''}${toMM(fig.width)} × ${toMM(fig.height)} mm, text ${fig.text} pt): ${panels.length ? panels.join('; ') : 'no panels'}.`;
    }),
  }] : []);

  // Every input, by its SHA-256.
  const inputs = [];
  for (const s of ws.sources) {
    const users = runs.filter((r) => r.inputs.source.sha256 === s.sha256).map((r) => r.name);
    for (const f of sourceFiles(s)) inputs.push([f.fileName ?? s.name, f.sha256 === s.origin?.mapped?.sha256 ? `MaveDB's mapped variants of ${s.name}` : `table${users.length ? `, scored by ${list(users)}` : ', not scored'}`, f.sha256]);
  }
  for (const f of annotationFiles(ws)) inputs.push([f.fileName ?? f.name, `annotation "${f.name}"`, f.sha256]);
  for (const f of structureFiles(ws)) inputs.push([f.fileName ?? f.name, `structure ${f.name}`, f.sha256]);
  for (const f of figureFiles(ws)) inputs.push([f.fileName, f.name, f.sha256]);
  // The files control sets were read from (their labels are kept with the workspace).
  for (const set of sets) {
    const file = set.source?.file;
    if (!file?.sha256) continue;
    const row = inputs.find((r) => r[2] === file.sha256);
    if (row) row[1] = `${row[1]}; the control set "${set.name}"`;
    else inputs.push([file.fileName ?? (set.source.kind === 'clinvar' ? 'ClinVar\'s records' : set.name), `the control set "${set.name}"`, file.sha256]);
  }
  section('inputs', 'Inputs', inputs.length ? [{ kind: 'table', caption: 'Every file the analysis read, by its SHA-256.', columns: ['File', 'What', 'SHA-256'], rows: inputs }] : []);

  // The software, and each run's output.
  section('software', 'Software', [
    paragraph(`This report was written by MaveScape ${software.version ?? '?'}${software.commit ? ` (commit ${String(software.commit).slice(0, 12)})` : ''} ${cite('mavescape', mavescapeReference(software.version ?? '?', ws.modified ?? ws.created))}.${runs.length ? ' Each run\'s scores can be recomputed from its recorded inputs (its table by SHA-256, its design and parameters) and checked against its output\'s SHA-256, in the window or with mavescape run --from-workspace.' : ''}`),
    ...(runs.length ? [{ kind: 'table', columns: ['Run', 'Made (UTC)', 'MaveScape', 'Scoring version', 'Output SHA-256'], rows: runs.map((r) => [r.name, String(r.created ?? '').slice(0, 16).replace('T', ' '), `${r.software.version}${r.software.commit ? ` (${String(r.software.commit).slice(0, 7)})` : ''}`, String(r.software.scoring ?? '—'), r.output.sha256]) }] : []),
  ]);

  // AI agents (wave 7, slice 2): the work an agent proposed through MaveScape's MCP server, with the
  // person's decisions on it, and what is still proposed.
  const decided = decisions(ws, Infinity).reverse();
  const open = openProposals(ws);
  const madeBy = new Map();
  for (const [what, items] of [['the table', ws.sources], ['the target', ws.targets], ['', runs], ['the selection', ws.selections], ['the annotation', ws.annotations ?? []], ['the structure view', ws.structureViews ?? []], ['the figure', ws.figures ?? []], ['the checkpoint', ws.checkpoints ?? []], ['the control set', sets], ['the calibration', calibrations]]) {
    for (const x of items) {
      if (!x.proposed?.accepted) continue;
      if (!madeBy.has(x.proposed.by)) madeBy.set(x.proposed.by, []);
      madeBy.get(x.proposed.by).push(what ? `${what} ${what === 'the table' || what === 'the target' ? x.name : `"${x.name}"`}` : x.name);
    }
  }
  section('agents', 'AI agents', decided.length || open.length ? [
    paragraph(`AI agents worked in this workspace through MaveScape's MCP server, in the window the person used. Their changes were proposals: what they made was marked proposed until the person accepted or rejected it, and their other changes (the design, QC thresholds and acknowledgements, a target's check, the MaveDB details, removals) applied only once accepted.${madeBy.size ? ` Proposed and accepted: ${[...madeBy].map(([by, items]) => `by ${by}, ${list(items)}`).join('; ')}.` : ''}`),
    ...(decided.length ? [{ kind: 'list', items: decided.map((e) => `${String(e.time).slice(0, 10)} ${String(e.time).slice(11, 16)}: ${e.detail}.`) }] : []),
    ...open.map((p) => paragraph(`Still proposed by ${p.author}, not yet accepted: ${describeProposal(ws, p).map((i) => i.text).join('; ') || 'nothing'}.`)),
  ] : []);

  // The decision log: the history, in words.
  const history = ws.history ?? [];
  const chain = verifyHistory(ws);
  section('log', 'Decision log', history.length ? [
    paragraph(`The workspace's history: ${history.length === 1 ? `1 entry (its SHA-256 ${short(history[0].hash)})` : `${plural(history.length, 'entry', 'entries')}, each chained to the one before by SHA-256 (the last ${short(history.at(-1)?.hash)})`}, ${chain.ok ? 'intact' : `broken at entry ${chain.broken[0].index + 1}`}. Times are UTC.`),
    { kind: 'list', items: history.map((e) => `${String(e.time).slice(0, 10)} ${String(e.time).slice(11, 16)}: ${e.detail}${e.by ? ` (by ${e.by})` : ''}`) },
    // Checkpoints (wave 6, slice 5): named states of the analysis, each by its state's SHA-256.
    ...((ws.checkpoints ?? []).length ? [paragraph(`Checkpoints kept with the workspace, each the analysis as it stood: ${list(ws.checkpoints.map((c) => `"${c.name}" (${String(c.created).slice(0, 10)}, state SHA-256 ${short(c.sha256)})`))}.`)] : []),
  ] : []);

  // Limitations: what the counts did not record, what each model assumes, what QC raised and was
  // not acknowledged, and a predicted structure standing in for one.
  const limits = [];
  for (const [text, names] of together(own.map((o) => [o.missing.length ? `not recorded with the counts: ${o.missing.join('; ')}` : '', o.run.name]))) limits.push(`${many ? `${list(names)}: ` : ''}${text.replace(/^./, (c) => (many ? c : c.toUpperCase()))}.`);
  for (const [text, names] of together(runs.map((r) => [assumptions(r), r.name]))) limits.push(`${list(names)} ${names.length > 1 ? 'assume' : 'assumes'} that ${text}.`);
  for (const o of own) {
    const findings = info.get(o.run.id)?.findings;
    const open = (findings ?? []).filter((x) => (x.status === 'fail' || x.status === 'review') && !x.acknowledged?.current);
    if (open.length) limits.push(`${o.run.name}: ${list(open.map((x) => `${x.title.charAt(0).toLowerCase()}${x.title.slice(1)} (${x.status === 'fail' ? 'failed' : 'to review'})`))}, not acknowledged.`);
  }
  // What limits each calibration; the same words for several named together.
  const limited = new Map();
  for (const o of outcomes) {
    for (const l of o.limitations ?? []) {
      if (!limited.has(l.text)) limited.set(l.text, []);
      limited.get(l.text).push(`"${o.cal.name}"`);
    }
  }
  for (const [text, names] of limited) limits.push(`${names.length > 1 ? `The calibrations ${list(names)}` : `The calibration ${names[0]}`}: ${text.replace(/^(The|No|Only|A|An) /, (w) => w.toLowerCase())}`);
  const predicted = (ws.structures ?? []).filter((s) => s.origin?.kind === 'alphafold');
  if (predicted.length) limits.push(`${list(predicted.map((s) => s.name))} ${predicted.length > 1 ? 'are predicted models' : 'is a predicted model'}: what ${predicted.length > 1 ? 'they say' : 'it says'} of each position rests on the prediction, whose confidence and aligned error say where it holds.`);
  section('limitations', 'Limitations', limits.length ? [{ kind: 'list', items: limits }] : []);

  section('use', 'Use', [paragraph(RESEARCH_USE)]);

  // Number the references in the order the text cites them.
  const order = [];
  const tokens = new Map([...cited.values()].map((c) => [c.token, c]));
  const number = (text) => String(text).replace(/\[(9\d{5})\]/g, (whole, t) => {
    const c = tokens.get(Number(t));
    if (!c) return whole;
    let n = order.indexOf(c) + 1;
    if (!n) {
      order.push(c);
      n = order.length;
    }
    return `[${n}]`;
  });
  for (const s of sections) {
    for (const b of s.blocks) {
      if (b.kind === 'p') b.text = number(b.text);
      else if (b.kind === 'list') b.items = b.items.map(number);
      else if (b.kind === 'table') b.rows = b.rows.map((r) => r.map(number));
    }
  }
  const refs = order.map((c) => ({ key: c.key, ref: c.ref }));
  const references = refs.map(({ key, ref }, i) => ({ n: i + 1, key, text: referenceText(ref) }));
  const title = `Methods: ${ws.name}`;
  return { format: REPORT_FORMAT, version: REPORT_VERSION, title, sections, references, markdown: reportMarkdown(title, sections, references), bibtex: toBibTeX(refs) };
}

// --- As Markdown ----------------------------------------------------------------------------------------------

const cell = (text) => String(text).replace(/\|/g, '\\|');
// Markdown's bold, as a string (the determinism test reads ** in code as a power).
const BOLD = '**';

function blockMarkdown(b) {
  if (b.kind === 'p') return `${b.label ? `${BOLD}${b.label}.${BOLD} ` : ''}${b.text}`;
  if (b.kind === 'list') return b.items.map((x) => `- ${x}`).join('\n');
  const head = `| ${b.columns.map(cell).join(' | ')} |\n| ${b.columns.map(() => '---').join(' | ')} |`;
  return `${b.caption ? `${b.caption}\n\n` : ''}${head}\n${b.rows.map((r) => `| ${r.map(cell).join(' | ')} |`).join('\n')}`;
}

export function reportMarkdown(title, sections, references) {
  const parts = [`# ${title}`];
  for (const s of sections) {
    if (s.title) parts.push(`## ${s.title}`);
    for (const b of s.blocks) parts.push(blockMarkdown(b));
  }
  if (references.length) parts.push('## References', references.map((r) => `${r.n}. ${r.text}`).join('\n'));
  return `${parts.join('\n\n')}\n`;
}
