// Score-level likelihood ratios against R (wave 8, slice 4): lib/rcompat.js against R's numerics as
// a black box, and lib/likelihood.js against acmgscaler itself, on reference/likelihood.json
// (generate_likelihood.R). The suite `likelihood` (run.mjs) checks these.

import { readFileSync } from 'node:fs';
import { rRandom, linspace, gaussianDensity, bandwidthBCV, isotonic, brentMinimize, approx, mad, binomialQuantile, spearman } from '../web/lib/rcompat.js';
import { calibrateScores, findPvst, thresholdsFromPvst } from '../web/lib/likelihood.js';

export const LIKELIHOOD_REFERENCE = new URL('./reference/likelihood.json', import.meta.url);
export const readLikelihoodReference = () => JSON.parse(readFileSync(LIKELIHOOD_REFERENCE, 'utf8'));

const rel = (a, b) => (a === b ? 0 : Math.abs(a - b) / Math.max(Math.abs(b), 1e-300));
const worstOf = (a, b) => Math.max(0, ...Array.from(a, (v, i) => rel(v, b[i])));

// R's numerics: the largest relative difference of each, and what differs outright.
export function numericsAgreement(ref) {
  const out = { differ: [] };
  out.seeds = ref.seeds.map((s) => {
    const r = rRandom(s.seed);
    const state = r.state().map((v) => v | 0);
    const unif = Array.from({ length: 5 }, () => r.unif());
    const r2 = rRandom(s.seed);
    const samples = s.n.map((n) => Array.from({ length: 20 }, () => r2.index(n) + 1));
    const same = state.every((v, i) => v === s.state[i]) && unif.every((v, i) => v === s.unif[i]) && samples.every((a, k) => a.join() === s.sample[k].join());
    if (!same) out.differ.push(`seed ${s.seed}`);
    return same;
  });
  out.seq = linspace(0, 1, 1024).every((v, i) => v === ref.seq[i]);
  out.density = 0;
  out.bandwidth = 0;
  for (const set of ref.sets) {
    out.bandwidth = Math.max(out.bandwidth, rel(bandwidthBCV(set.x, 1024), set.bw), rel(bandwidthBCV(set.x), set.bw1000));
    const d = gaussianDensity(set.x, set.bw, 1024);
    const peak = Math.max(...set.dy);
    set.at.forEach((i, k) => {
      out.density = Math.max(out.density, Math.abs(d.y[i - 1] - set.dy[k]) / peak, Math.abs(d.x[i - 1] - set.dx[k]) / Math.max(1, Math.abs(set.dx[k])));
    });
  }
  out.isoreg = Math.max(worstOf(isotonic(ref.isoreg.y), ref.isoreg.yf), worstOf(isotonic(ref.isoreg.ytie), ref.isoreg.yftie));
  const functions = { '(x - 1)^2 + sin(3 x)': (x) => (x - 1) ** 2 + Math.sin(3 * x), '|x - 0.3| + x^4': (x) => Math.abs(x - 0.3) + x ** 4 };
  out.optimize = Math.max(...ref.optimize.map((o) => rel(brentMinimize(functions[o.f], o.lower, o.upper, o.tol), o.minimum)));
  const ap = (rule) => Array.from(approx(ref.approx.x, ref.approx.y, ref.approx.xout, { rule }), (v) => (Number.isNaN(v) ? null : v));
  out.approx = JSON.stringify(ap(1)) === JSON.stringify(ref.approx.rule1) && JSON.stringify(ap(2)) === JSON.stringify(ref.approx.rule2);
  out.mad = rel(mad(ref.mad.x), ref.mad.mad);
  out.qbinom = ref.qbinom.n.every((n, k) => binomialQuantile(0.025, n, 0.5) === ref.qbinom.q[k]);
  out.spearman = rel(spearman(ref.spearman.a, ref.spearman.b), ref.spearman.rho);
  return out;
}

// One acmgscaler case: { rows (the scores and classes as acmgscaler had them), random }. Returns
// { lr (largest relative difference of the ratios and their intervals), thresholds (of the
// scores), evidence (rows whose evidence differs), counts (the evidence counted differs) }.
function caseAgreement(c, rows, random, prior) {
  const r = calibrateScores(rows, { prior, random });
  let lr = 0;
  let evidence = 0;
  c.rows.forEach((row, k) => {
    const x = r.rows[row - 1];
    lr = Math.max(lr, rel(x.lrLower, c.lrLower[k]), rel(x.lr, c.lr[k]), rel(x.lrUpper, c.lrUpper[k]));
    if (x.evidence !== c.evidence[k]) evidence += 1;
  });
  let thresholds = 0;
  r.thresholds.forEach((t, k) => {
    for (const [v, w] of [[t.lower, c.thresholds.lower[k]], [t.score, c.thresholds.score[k]], [t.upper, c.thresholds.upper[k]]]) {
      if (v === null || w === null) thresholds = v === w ? thresholds : Infinity;
      else thresholds = Math.max(thresholds, rel(v, w));
    }
  });
  const counted = {};
  for (const x of r.rows) if (x) counted[x.evidence] = (counted[x.evidence] ?? 0) + 1;
  const counts = Object.keys({ ...counted, ...c.evidenceCounts }).every((k) => counted[k] === c.evidenceCounts[k]);
  return { lr, thresholds, evidence, counts, pvst: r.pvst, result: r };
}

// Every acmgscaler case of the reference: [{ name, lr, thresholds, evidence, counts }].
export function acmgscalerAgreement(ref, factor9Rows) {
  const out = [];
  for (const c of ref.cases) {
    if (c.grouped) {
      // One generator for the groups in turn, as calibrate(group = ) seeds it once.
      const random = rRandom(c.seed);
      for (const g of c.groups) out.push({ name: `${c.name}: ${g.name}`, ...caseAgreement(g, g.score.map((s, i) => ({ score: s, class: g.class[i] })), random, c.prior) });
    } else if (c.fixture) {
      out.push({ name: c.name, ...caseAgreement(c, factor9Rows, rRandom(c.seed), c.prior) });
    } else {
      out.push({ name: c.name, ...caseAgreement(c, c.score.map((s, i) => ({ score: s, class: c.class[i] })), rRandom(c.seed), c.prior) });
    }
  }
  return out;
}

// c from the prior as acmgscaler finds it, and Pejaver et al.'s Table 1 at 4 significant digits.
export function thresholdAgreement(ref) {
  const pvst = ref.pvst.prior.map((p) => findPvst(p));
  const thresholds = ref.pvst.prior.map((p, k) => worstOf(thresholdsFromPvst(pvst[k]), ref.pvst.thresholds[k]));
  const t = ref.pejaver2022;
  const lr = thresholdsFromPvst(t.c);
  // As the table prints them: the pathogenic ratios to four significant digits, the benign ones
  // and every posterior to four decimals.
  const sig4 = (x) => Number(x.toPrecision(4));
  const dec4 = (x) => Number(x.toFixed(4));
  const posterior = (x) => (x * t.prior) / ((x - 1) * t.prior + 1);
  const pathogenic = [lr[4], lr[5], lr[6], lr[7]];
  const benign = [lr[3], lr[2], lr[1], lr[0]];
  const table = {
    lr: pathogenic.every((v, k) => sig4(v) === t.pathogenic.lr[k]) && benign.every((v, k) => dec4(v) === t.benign.lr[k]),
    posterior: pathogenic.every((v, k) => dec4(posterior(v)) === t.pathogenic.posterior[k]) && benign.every((v, k) => dec4(1 - posterior(v)) === t.benign.posterior[k]),
  };
  return { pvst, expected: ref.pvst.pvst, thresholds, table, computed: { pathogenic, benign } };
}

// --- Published calibrations (MaveDB) and Fayer et al. 2021 ------------------------------------------

import { parseTable, columnText } from '../web/lib/csv.js';
import { readScoreSet } from '../web/lib/mavedb.js';
import { classCounts, publishedClassCounts, publishedEvidence, publishedThresholds } from '../web/lib/calibration.js';
import { classOddsPath, evidenceStrength } from '../web/lib/oddspath.js';

// A CSV's columns by name, as text.
export function csvColumns(text) {
  const table = parseTable(text);
  return Object.fromEntries(table.columns.map((c) => [c.name, columnText(c)]));
}

const RECORD = (urn) => new URL(`./fixtures/public-data/mavedb/urn_mavedb_${urn}.json`, import.meta.url);
// The records with published calibrations whose scores the validation cache holds (sources.json).
export const PUBLISHED = [['00000097-0-2', 'mavedb-brca1-sge', 'scores.csv'], ['00000013-a-1', 'mavedb-pten-vampseq', 'scores.csv'], ['00000054-a-1', 'mavedb-pten-phosphatase', 'scores.csv'], ['00000068-b-1', 'mavedb-tp53-screens', 'nutlin.csv'], ['00001277-a-1', 'mavedb-tp53-dbd', 'scores.csv'], ['00001200-a-1', 'mavedb-factor9', 'scores.csv']];

// Each record's published calibrations read as MaveDB means them: every class with a range counts
// the record's scores as MaveDB counts its variants; each stated OddsPath has the strength the
// paper's Table 3 gives it; and where a calibration has an abnormal and a normal class on two sides,
// the two thresholds MaveScape takes from it class the scores as the published classes do (a score
// at a boundary on MaveScape's abnormal-like side). scoresOf(dataset, file) returns the text.
export function publishedAgreement(scoresOf) {
  const out = [];
  for (const [urn, dataset, file] of PUBLISHED) {
    const record = readScoreSet(JSON.parse(readFileSync(RECORD(urn), 'utf8')));
    const columns = csvColumns(scoresOf(dataset, file));
    const scores = columns.score.map((v) => (v === '' || v === 'NA' ? Number.NaN : Number(v))).filter(Number.isFinite);
    for (const c of record.calibrations) {
      const counts = publishedClassCounts(c, scores);
      const stated = c.classes.filter((k) => k.oddsPath !== null && k.evidence?.strength);
      // Table 3's code, as MaveDB writes a strength (PS3 "strong" is Table 3's PS3).
      const table3 = stated.map((k) => {
        const s = evidenceStrength(k.oddsPath);
        const level = s.code === 'PS3' || s.code === 'BS3' ? 'strong' : s.level;
        return { stated: `${k.evidence.criterion} ${k.evidence.strength}`, table3: `${s.side} ${level}`, same: s.side === k.evidence.criterion && level === k.evidence.strength };
      });
      const t = publishedThresholds(c);
      let mapped = null;
      if (t) {
        const ours = classCounts(scores, t.side, { abnormal: t.abnormal, normal: t.normal });
        const theirs = (cls) => c.classes.filter((k) => k.class === cls && Array.isArray(k.range)).reduce((n, k) => n + (k.variants ?? 0), 0);
        const ties = scores.filter((x) => x === t.abnormal || x === t.normal).length;
        mapped = { abnormal: ours['abnormal-like'], normal: ours['WT-like'], published: { abnormal: theirs('abnormal'), normal: theirs('normal') }, ties };
      }
      out.push({ urn, title: c.title, ranged: counts.length, differ: counts.filter((x) => x.published !== null && x.n !== x.published), table3, mapped });
    }
  }
  return out;
}

// Fayer et al.'s BRCA1 OddsPath from their published data: Findlay's classes (LOF abnormal, FUNC
// normal, INT intermediate) against their ClinVar labels. Returns { counts, observed, brnich }.
export function fayerOddsPath(text) {
  const cols = csvColumns(text);
  const side = (s) => (['Pathogenic', 'Likely pathogenic', 'Pathogenic/Likely pathogenic'].includes(s) ? 'P' : ['Benign', 'Likely benign'].includes(s) ? 'B' : null);
  const counts = { P: { LOF: 0, INT: 0, FUNC: 0 }, B: { LOF: 0, INT: 0, FUNC: 0 } };
  cols.clinvar.forEach((s, i) => {
    const sd = side(s);
    if (sd && counts[sd][cols['func.class'][i]] !== undefined) counts[sd][cols['func.class'][i]] += 1;
  });
  const nP = counts.P.LOF + counts.P.INT + counts.P.FUNC;
  const nB = counts.B.LOF + counts.B.INT + counts.B.FUNC;
  const abnormal = classOddsPath(counts.P.LOF, counts.B.LOF, nP, nB, 'abnormal');
  const normal = classOddsPath(counts.P.FUNC, counts.B.FUNC, nP, nB, 'normal');
  return { counts, nP, nB, observed: { abnormal: abnormal.observed, normal: normal.observed }, brnich: { abnormal: abnormal.oddsPath, normal: normal.oddsPath } };
}
