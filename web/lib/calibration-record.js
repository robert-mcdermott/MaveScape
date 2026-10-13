// A calibration in the record (wave 8, slice 5; requirement K4). A calibration keeps what makes it
// again (lib/calibration.js); this computes it again from the workspace and its run's scores, the
// same in the window, the report and a run's methods, figures, the certificate, the diff and a
// MaveDB deposit: the controls the run scores, the metrics and evidence strength, what limits them,
// the run's variants in each class, and the score-level likelihood ratios. And what the record says
// of a control set and a calibration: the report's paragraphs, a figure's charts.
//
// For research: functional classes in this assay and the evidence they would give, never a
// classification of any variant (mavescape-spec/conventions.md, Terminology).

import { calibrationMetrics, CLASSES, classCounts, controlScores, evidenceLimitations, ruleWords, scaleSide, thresholdWords } from './calibration.js';
import { circularity, composition, matchControls } from './controls.js';
import { calibrateScores, EVIDENCE, likelihoodSettings, likelihoodWords, MIN_CONTROLS } from './likelihood.js';
import { strengthWords } from './oddspath.js';
import { KIND } from './variants.js';
import { possessive } from './words.js';

const count = (n) => n.toLocaleString('en-US');
const plural = (n, word, many = `${word}s`) => `${count(n)} ${n === 1 ? word : many}`;
const list = (items) => (items.length > 2 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : items.join(' and '));
const g3 = (x) => (Number.isFinite(x) ? Number(x.toPrecision(3)).toString() : '—');
const pct = (x) => (Number.isFinite(x) ? `${(100 * x).toFixed(Math.abs(100 * x - Math.round(100 * x)) < 0.05 ? 0 : 1)}%` : '—');
const short = (hash) => (hash ? `${hash.slice(0, 12)}…` : '—');

// --- Computed again ------------------------------------------------------------------------------------

// The control set and the run a calibration reads: { set, run, problem (null, or why it cannot be
// computed) }.
export function calibrationSubjects(ws, cal) {
  const set = (ws.controlSets ?? []).find((c) => c.id === cal.controlSet) ?? null;
  const run = (ws.runs ?? []).find((r) => r.id === cal.run) ?? null;
  const problem = !set || !run ? `The calibration "${cal.name}" reads ${!set ? 'a control set' : 'a run'} the workspace no longer has.` : null;
  return { set, run, problem };
}

// The scored controls of a set in a run's condition (results: the run's own): { P, B (their
// scores), keys: { P, B }, match, view (the results the match indexes: a nucleotide run's protein
// view), condition (its name, when the run has more than one) }.
export function scoredControls(set, run, results, condition = 0) {
  if (!results?.conditions?.[condition]) throw new Error(`${run.name} has no condition ${condition + 1}.`);
  const match = matchControls(set, results, condition);
  const s = controlScores(set, match, condition);
  return { P: s.P.scores, B: s.B.scores, keys: { P: s.P.keys, B: s.B.keys }, match, view: match.view, condition: results.conditions.length > 1 ? results.conditions[condition].name : null };
}

// The run's scored variants (its protein view) by kind and class: { missense, nonsense, synonymous,
// all } each classCounts's with its values.
export function variantClasses(view, condition, side, thresholds) {
  const score = view.conditions[condition]?.score;
  const kinds = { missense: KIND.MISSENSE, nonsense: KIND.NONSENSE, synonymous: KIND.SYNONYMOUS };
  const values = { missense: [], nonsense: [], synonymous: [], all: [] };
  for (let i = 0; i < view.rows; i += 1) {
    if (!Number.isFinite(score?.[i])) continue;
    const k = view.variants.kind[i];
    if (k === KIND.WT) continue;
    values.all.push(score[i]);
    for (const [name, kind] of Object.entries(kinds)) if (k === kind) values[name].push(score[i]);
  }
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { ...classCounts(v, side, thresholds), values: v }]));
}

// The rows acmgscaler is given for a calibration (slice 4): every variant the run scores in the
// condition (its protein view; not the wild type), in the run's order, each control with its side,
// the others unlabeled: [{ key, score, class, kind }].
export function likelihoodRows(set, match, condition = 0) {
  const view = match.view;
  const score = view.conditions[condition]?.score;
  const side = new Map();
  set.labels.forEach((l, k) => { if (match.rows[k] >= 0) side.set(match.rows[k], l.side); });
  const rows = [];
  for (let i = 0; i < view.rows; i += 1) {
    if (!Number.isFinite(score?.[i]) || view.variants.kind[i] === KIND.WT) continue;
    rows.push({ key: view.variants.key[i], score: score[i], class: side.get(i) ?? 'U', kind: view.variants.kind[i] });
  }
  return rows;
}

// Counts of rows by evidence: { evidence: n }, in EVIDENCE's order.
function evidenceCounts(rows, result, test) {
  const out = Object.fromEntries(EVIDENCE.map((e) => [e, 0]));
  rows.forEach((r, i) => { if (test(r) && result.rows[i]) out[result.rows[i].evidence] += 1; });
  return out;
}

// A calibration's score-level likelihood ratios (slice 4), as acmgscaler computes them with the
// calibration's seed and its likelihood settings: { result (calibrateScores's), rows, settings,
// counts: { P, B, missense, all } } or { problem, settings } (fewer than 10 controls a side, or too
// few scores for a curve).
export function calibrationLikelihood(cal, set, scored) {
  const settings = likelihoodSettings(cal.likelihood ?? {});
  if (scored.P.length < MIN_CONTROLS || scored.B.length < MIN_CONTROLS) return { problem: `Score-level likelihood ratios need at least ${MIN_CONTROLS} P and ${MIN_CONTROLS} B controls scored (acmgscaler's minimum): ${scored.P.length} P and ${scored.B.length} B of "${set.name}" are.`, settings };
  const rows = likelihoodRows(set, scored.match, cal.condition ?? 0);
  const result = calibrateScores(rows, { prior: settings.prior, pvst: settings.c, seed: cal.bootstrap.seed });
  if (result.problem) return { problem: result.problem, settings };
  if (!result.curve) return { problem: 'Score-level likelihood ratios need at least 20 scores (acmgscaler\'s minimum).', settings };
  return {
    result, rows, settings,
    counts: {
      P: evidenceCounts(rows, result, (r) => r.class === 'P'),
      B: evidenceCounts(rows, result, (r) => r.class === 'B'),
      missense: evidenceCounts(rows, result, (r) => r.kind === KIND.MISSENSE),
      all: evidenceCounts(rows, result, () => true),
    },
  };
}

// A kept calibration's metrics, computed again from its scored controls (seeded: the same).
// options: { samples } to draw another number of bootstrap samples (0: none; the diff's).
export function metricsOf(cal, scored, { samples = cal.bootstrap.samples } = {}) {
  return calibrationMetrics(scored.P, scored.B, { side: cal.side, rule: cal.rule, error: cal.error, abnormal: cal.thresholds.abnormal, normal: cal.thresholds.normal, samples, seed: cal.bootstrap.seed });
}

const sameThreshold = (a, b) => (a === null && b === null) || (a !== null && b !== null && Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(b)));

// Whether thresholds computed again differ from those kept (never, unless MaveScape's computation
// changed since the calibration was made).
export const thresholdsDiffer = (computed, kept) => !sameThreshold(computed.abnormal, kept.abnormal) || !sameThreshold(computed.normal, kept.normal);

// A calibration computed again, from its parts (the window computes the metrics and the likelihood
// ratios apart and keeps them): { cal, set, run, scored, metrics, where (scaleSide's), differs,
// warnings (the set's circularity for the run), limitations (evidenceLimitations's), classes (the
// run's scored variants by kind and class), likelihood (calibrationLikelihood's, or null) }.
export function calibrationOutcome(ws, cal, { set, run, scored, metrics, likelihood = null }) {
  const where = scaleSide(cal.side, run.inputs.design, scored.P, scored.B);
  const warnings = circularity(set, { ws, run, matched: scored.match });
  return {
    cal, set, run, scored, metrics, where,
    differs: thresholdsDiffer(metrics.thresholds, cal.thresholds),
    warnings,
    limitations: evidenceLimitations({ rule: cal.rule, metrics, warnings, where }),
    classes: variantClasses(scored.view, cal.condition ?? 0, cal.side, cal.thresholds),
    likelihood,
  };
}

// A calibration computed again from its run's results (the run's own: lib/score.js's). options:
// { likelihood (default true): its score-level likelihood ratios too }. Throws when it reads a set
// or a run the workspace no longer has, or a condition the run does not have.
export function computeCalibration(ws, cal, results, { likelihood = true } = {}) {
  const { set, run, problem } = calibrationSubjects(ws, cal);
  if (problem) throw new Error(problem);
  const scored = scoredControls(set, run, results, cal.condition ?? 0);
  if (!scored.P.length || !scored.B.length) throw new Error(`${run.name} scores ${plural(scored.P.length, 'P control')} and ${plural(scored.B.length, 'B control')} of "${set.name}" now: the calibration needs both sides scored.`);
  const metrics = metricsOf(cal, scored);
  return calibrationOutcome(ws, cal, { set, run, scored, metrics, likelihood: likelihood ? calibrationLikelihood(cal, set, scored) : null });
}

// The points of the ROC and precision–recall curves at a calibration's thresholds: [{ sensitivity,
// specificity, recall, precision, label, below? }] (the curves' marks).
export function thresholdPoints(metrics) {
  const t = metrics.thresholds;
  const at = (which) => {
    const P = metrics.classes.P;
    const B = metrics.classes.B;
    const called = (c) => (which === 'abnormal' ? c['abnormal-like'] : c['abnormal-like'] + c.intermediate);
    return { sensitivity: called(P) / metrics.n.P, specificity: 1 - called(B) / metrics.n.B, recall: called(P) / metrics.n.P, precision: called(P) / Math.max(1, called(P) + called(B)) };
  };
  if (t.abnormal === t.normal) return t.abnormal === null ? [] : [{ ...at('abnormal'), label: 'threshold' }];
  return [...(t.abnormal === null ? [] : [{ ...at('abnormal'), label: 'abnormal' }]), ...(t.normal === null ? [] : [{ ...at('normal'), label: 'normal', below: true }])];
}

// --- A figure's charts ---------------------------------------------------------------------------------

// A calibration panel's charts (lib/figure-plots.js draws them; the plots are lib/figures.js's
// PANEL_PLOTS.calibration): { title, charts, description } or { missing } when there is nothing to
// draw (the likelihood ratios' problem).
export function calibrationCharts(o, plot) {
  const { cal, run, set, metrics: m, scored } = o;
  const named = `${run.name}${scored.condition ? ` (${scored.condition})` : ''} against "${set.name}"`;
  if (plot === 'distribution') {
    const label = `${possessive(run.name)} scores: the P and B controls of "${set.name}" against the run's ${count(o.classes.all.total)} scored variants, with the classes the thresholds make (${thresholdWords(cal.side, cal.thresholds)})`;
    return { title: `${cal.name}: scores of each side`, description: `${label}.`, charts: [{ kind: 'strips', spec: { all: o.classes.all.values, P: scored.P, B: scored.B, side: cal.side, thresholds: cal.thresholds, label } }] };
  }
  if (plot === 'roc') {
    const label = `The ROC curve of ${named}: AUC ${g3(m.auc.auc)} (DeLong's 95% interval ${g3(m.auc.low)} to ${g3(m.auc.high)})${m.roc.band ? ', the bootstrap\'s 95% band' : ''}, the thresholds circled`;
    return { title: `${cal.name}: ROC curve`, description: `${label}.`, charts: [{ kind: 'roc', spec: { points: m.roc.points, band: m.roc.band, marks: thresholdPoints(m), label } }] };
  }
  if (plot === 'pr') {
    const label = `The precision–recall curve of ${named}: area ${g3(m.pr.auc)}, by chance ${g3(m.pr.baseline)} (the dashed line)${m.pr.band ? ', the bootstrap\'s 95% band' : ''}, the thresholds circled`;
    return { title: `${cal.name}: precision–recall curve`, description: `${label}.`, charts: [{ kind: 'pr', spec: { points: m.pr.points, band: m.pr.band, baseline: m.pr.baseline, marks: thresholdPoints(m), label } }] };
  }
  if (plot === 'likelihood') {
    const lr = o.likelihood;
    if (!lr) return { missing: 'The likelihood ratios were not computed.' };
    if (lr.problem) return { missing: lr.problem };
    const res = lr.result;
    const label = `The likelihood ratio of a score (P : B) of ${named}, by acmgscaler's method (${likelihoodWords(lr.settings)}): the bootstrap's median with its interval, on a log scale, and the evidence thresholds`;
    return { title: `${cal.name}: likelihood ratio of a score`, description: `${label}. ${strengthsSentence(res)}.`, charts: [{ kind: 'likelihood', spec: { grid: res.curve.grid, llr: res.curve.llr, lo: res.curve.lo, hi: res.curve.hi, thresholds: res.thresholds.map((t) => t.lr), P: scored.P, B: scored.B, label } }] };
  }
  return { missing: `A calibration panel shows distribution, roc, pr or likelihood, not "${plot}".` };
}

// --- In words ------------------------------------------------------------------------------------------

// Where each strength the likelihood ratios reach begins: "Pathogenic-Supporting below 0.637
// (0.62 to 0.65), …; no benign strength reached".
export function strengthsSentence(res) {
  const inverse = res.curve?.inverse;
  const parts = [];
  for (const benign of [false, true]) {
    const reached = res.thresholds.filter((t) => t.boundary.startsWith('Benign') === benign && t.score !== null);
    if (!reached.length) {
      parts.push(`no ${benign ? 'benign' : 'pathogenic'} strength reached`);
      continue;
    }
    // A pathogenic strength holds beyond its score toward the pathogenic end, a benign one toward
    // the other; the weakest first.
    const ordered = benign ? reached.slice().reverse() : reached;
    parts.push(ordered.map((t) => `${t.boundary.split('|')[benign ? 0 : 1]} ${benign === inverse ? 'above' : 'below'} ${g3(t.score)}${t.lower !== null && t.upper !== null ? ` (${g3(Math.min(t.lower, t.upper))} to ${g3(Math.max(t.lower, t.upper))})` : ''}`).join(', '));
  }
  return parts.join('; ');
}

const SIDE_FROM = { readout: 'as the design\'s readout says', controls: 'where the P controls\' median is, the readout not saying', chosen: 'as chosen' };

// A control set in the report: where its labels came from, how they were chosen, its composition
// and what was left out. ws: the workspace (a ClinVar set's annotation names the gene).
export function controlSetParagraph(set, ws, cite) {
  const c = composition(set);
  const src = set.source ?? {};
  const rules = set.rules ?? {};
  const kinds = rules.kinds?.length ? list(rules.kinds) : 'missense';
  const words = (side) => `${plural(c[side].total, `${side} control`)}${c[side].total ? ` (${Object.entries(c[side].labels).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([w, n]) => `${w} ${count(n)}`).join(', ')})` : ''}`;
  const parts = [];
  if (src.kind === 'clinvar') {
    const a = (ws.annotations ?? []).find((x) => x.id === src.annotation);
    const day = String(src.retrieved ?? a?.record?.retrieved ?? '').slice(0, 10);
    parts.push(`The control set "${set.name}" was made from ClinVar's records${a?.record?.gene ? ` of ${a.record.gene}` : ''} ${cite('clinvar')}${src.transcript ? ` on ${src.transcript}` : ''} (the ClinVar annotation's file, SHA-256 ${short(src.file?.sha256)}${day ? `, retrieved ${day}` : ''}), placed on the target as the ClinVar track places them: records classified pathogenic or likely pathogenic (P) against benign or likely benign (B), with at least ${plural(rules.minStars ?? 1, 'review star')}, ${kinds}${Number.isInteger(rules.evaluatedBefore) ? `, last evaluated before ${rules.evaluatedBefore}` : ''}; conflicting and uncertain classifications left out. Each label is ClinVar's submitters', kept in their words.`);
  } else {
    parts.push(`The control set "${set.name}" was read from the table ${src.file?.fileName ?? ''} (SHA-256 ${short(src.file?.sha256)})${src.citation ? `, from ${src.citation}` : ''}: each label in the table's words, P (pathogenic, likely pathogenic or abnormal) against B (benign, likely benign or normal), ${kinds}${Number.isInteger(rules.evaluatedBefore) ? `, last evaluated before ${rules.evaluatedBefore} (the table's dates)` : ''}${src.numbering ? `, numbered on the ${src.numbering}` : ''}.`);
  }
  parts.push(`It holds ${words('P')} and ${words('B')}.`);
  const left = Object.entries(set.excluded ?? {}).filter(([, n]) => n > 0).sort((x, y) => y[1] - x[1]);
  if (left.length) parts.push(`Left out: ${left.slice(0, 6).map(([why, n]) => `${count(n)} ${why}`).join('; ')}${left.length > 6 ? `; and ${count(left.slice(6).reduce((s, [, n]) => s + n, 0))} more` : ''}.`);
  return parts.join(' ');
}

// What the report says of a calibration: [paragraph] (its metrics; its evidence strength; its
// likelihood ratios). o: calibrationOutcome's, or { cal, set, run, problem } when it could not be
// computed again (then what it keeps). cite: the report's.
export function calibrationParagraphs(o, cite) {
  const { cal, set, run } = o;
  const of = `${possessive(run?.name ?? cal.run)} scores${o.scored?.condition ? ` (${o.scored.condition})` : ''}`;
  const thresholds = cal.published ? `those of "${cal.published.title}", published with ${cal.published.urn}` : cal.rule === 'given' ? 'given' : `set by the controls, ${ruleWords(cal.rule, cal.error)}`;
  if (o.problem || !o.metrics) {
    return [`${of} were calibrated against the control set "${set?.name ?? cal.controlSet}", for research: ${plural(cal.n.P, 'P control')} and ${plural(cal.n.B, 'B control')} scored; abnormal-like scores ${cal.side} the others; thresholds ${thresholds}: ${thresholdWords(cal.side, cal.thresholds)}. Its metrics could not be computed again here: ${String(o.problem ?? 'its run\'s scores are not at hand').replace(/\.$/, '')}.`];
  }
  const m = o.metrics;
  const out = [];
  // The metrics.
  const s = [`${of} were calibrated against the control set "${set.name}", for research: ${plural(m.n.P, 'P control')} and ${plural(m.n.B, 'B control')} scored. Abnormal-like scores were taken to be ${cal.side} the others, ${SIDE_FROM[cal.sideFrom] ?? 'as chosen'}${o.where?.against ? `, though the P controls' median (${g3(o.where.against.P)}) is on the WT-like side of the B controls' (${g3(o.where.against.B)})` : ''}.`];
  s.push(`The ROC curve, as pROC draws it ${cite('robin2011')}, has an area (AUC) of ${g3(m.auc.auc)}, DeLong's 95% interval ${g3(m.auc.low)} to ${g3(m.auc.high)} ${cite('delong1988')}; the precision–recall curve, interpolated between its points as Keilwagen et al. describe ${cite('keilwagen2014')} and PRROC computes it ${cite('grau2015')}, an area of ${g3(m.pr.auc)} (by chance ${g3(m.pr.baseline)}, the P controls' share).`);
  s.push(`The thresholds were ${thresholds}: ${thresholdWords(cal.side, cal.thresholds)} (a score at a threshold on its abnormal-like side).`);
  const shares = (k) => CLASSES.map((c) => `${count(k[c])} ${c}`).join(', ');
  const w = (x) => `${pct(x.p)} (${pct(x.low)} to ${pct(x.high)})`;
  s.push(`Of the P controls ${shares(m.classes.P)}; of the B controls ${shares(m.classes.B)}: sensitivity ${w(m.sensitivity)} and specificity ${w(m.specificity)}, with Wilson's 95% intervals ${cite('wilson1927')}.`);
  if (m.bootstrap) {
    const st = m.thresholds.stability;
    const band = (b, name) => (b ? `the ${name} threshold's ${g3(b.low)} to ${g3(b.high)}` : null);
    const moved = cal.rule === 'given' ? [] : [band(st?.abnormal, cal.rule === 'youden' ? 'one' : 'abnormal'), cal.rule === 'youden' ? null : band(st?.normal, 'normal')].filter(Boolean);
    s.push(`In ${count(m.bootstrap.samples)} stratified bootstrap samples (seed ${m.bootstrap.seed}), the AUC's 95% interval was ${g3(m.auc.boot?.low)} to ${g3(m.auc.boot?.high)} and the precision–recall area's ${g3(m.pr.boot?.low)} to ${g3(m.pr.boot?.high)}${moved.length ? `; ${list(moved)}` : ''}.`);
  }
  const mis = o.classes?.missense;
  if (mis?.total) s.push(`Of ${possessive(run.name)} ${count(mis.total)} missense variants scored, ${shares(mis)}.`);
  out.push(s.join(' '));
  // Evidence strength (OddsPath).
  const ev = m.evidence;
  const evidence = ['abnormal', 'normal'].map((which) => {
    const x = ev[which];
    if (x.oddsPath === null) return `the ${x.class} class no control, so no OddsPath`;
    const own = x.boot?.strengths?.[x.strength?.code];
    return `the ${x.class} class (${x.P} P, ${x.B} B) an OddsPath of ${g3(x.oddsPath)}${x.observed !== null ? ` (${g3(x.observed)} as observed)` : ''}, ${strengthWords(x.strength)}${x.contrary ? ', pointing the other way' : ''}${x.boot && own !== undefined ? ` in ${pct(own)} of the bootstrap's samples` : ''}`;
  });
  out.push(`Evidence strength, for research: each class's OddsPath as Brnich et al. define it ${cite('brnich2020')}, P1 the P controls' share (${g3(ev.abnormal.prior)}) and P2 their share in the class with one control of the other side added, and the strength their Table 3 makes of it, strictly: ${evidence.join('; ')}. It is what a class would contribute as functional evidence (PS3 or BS3), not a classification of any variant.`);
  // Score-level likelihood ratios.
  const lr = o.likelihood;
  if (lr && !lr.problem) {
    const st = lr.settings;
    const counts = lr.counts.missense;
    const at = EVIDENCE.filter((e) => counts[e]).map((e) => `${count(counts[e])} ${e}`);
    out.push(`Score-level likelihood ratios, for research, by acmgscaler's method ${cite('badonyi2025')} (MaveScape's port of its version 1.0.0, equal to it): each side's kernel density in 1,000 bootstrap samples (seed ${cal.bootstrap.seed}), their log ratio regularized and made monotone, a variant's strength read from the conservative end of its interval; the evidence thresholds ${st.from === 'pejaver2022' ? `of Pejaver et al.'s Table 1 ${cite('pejaver2022')} (prior ${st.prior}, c = ${count(st.c)})` : `from a prior of ${st.prior} (c = ${count(st.c)})`}, as Tavtigian et al. scale them ${cite('tavtigian2018')}. ${strengthsSentence(lr.result).replace(/^./, (x) => x.toUpperCase())}.${at.length ? ` Of the run's missense variants, ${list(at)}.` : ''}`);
  } else if (lr?.problem) out.push(`No score-level likelihood ratios: ${lr.problem.replace(/^./, (x) => x.toLowerCase())}`);
  return out;
}
