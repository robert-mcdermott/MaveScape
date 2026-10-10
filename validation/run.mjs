// MaveScape's validation suite. Unit tests (web/lib/*.test.mjs) check functions in isolation; this
// suite runs whole pipelines on fixtures and published data whose answers are known (committed
// outputs of the reference tools, validation/reference/), and reports how closely MaveScape
// agrees, against stated tolerances (mavescape-spec/requirements.md, T1–T2).
//
//   node validation/run.mjs [suite …] [--verbose] [--require-data]
//
// Suites: accessibility, designs (external data), enrich2 (external data), hgvs, import (external
// data), experiment (external data), scoring, qc, map and roundtrip (their last checks need
// external data), readiness; all by default. UPDATE_GOLDEN=1 rewrites the golden files (validation/golden/) instead of
// comparing with them.
// Exits with status 1 when a check fails.
//
// Suites marked "external data" need files that node validation/fetch.mjs downloads into
// validation/cache/ (wave 1, slice 2); without them the suite is skipped, and fails with
// --require-data, as in CI. The harness follows CytoWeave 0.8.0's validation/run.mjs.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { textPairs, themeTokens } from './accessibility-cases.mjs';
import { DESIGN_CASES, dataChecks, readDesign, readTable } from './design-cases.mjs';
import { checkSchema } from './json-schema.mjs';
import { enrich2Combination, normalizers, ratioScores, regressionScores, replicateCounts } from './enrich2-formulas.mjs';
import { summarizeDesign, validateDesign } from '../web/lib/design.js';
import { parseHgvs, formatPosition } from '../web/lib/hgvs.js';
import { cellText, columnText, createTableParser, parseTable } from '../web/lib/csv.js';
import { detectLayout, draftDesign, namesFromSequences, reviewImport, suggestRoles } from '../web/lib/importer.js';
import { buildCountSet, joinCountTables } from '../web/lib/counts.js';
import { KIND_NAMES } from '../web/lib/variants.js';
import { parseFasta, targetFromSequence } from '../web/lib/target.js';
import { createRandom, shuffle } from '../web/lib/random.js';
import { meaning, modelRoundTrip, rebuild } from './experiment-cases.mjs';
import { designFromSampleSheet, designStructure, sampleSheetCSV } from '../web/lib/samplesheet.js';
import { readinessDatasets, REMOVALS, caseOf, probe } from './readiness-cases.mjs';
import { writePackage } from '../web/lib/package.js';
import { readZip } from '../web/lib/zip.js';
import { readiness } from '../web/lib/readiness.js';
import { acknowledgeFinding, addSource, addTarget, createWorkspace, parseWorkspace, serializeWorkspace, setDesign, updateTarget, verifyHistory } from '../web/lib/workspace.js';
const formatCount = (n) => n.toLocaleString('en-US');
import { VISIONS, lab as labOf, paletteReport, simulate } from '../web/lib/colorvision.js';
import { CATEGORICAL, CATEGORICAL_CVD, colormapColor } from '../web/lib/colormaps.js';
import { EDGE_EXPECTATIONS, byKey, engineInput, fixtureDesign, fixtureTable, score, shuffledTable, variantTable } from './scoring-cases.mjs';
import { TIME_SERIES_EXPECTATIONS, edgeVariants, timeSeriesDesign, timeSeriesTable, timeSeriesTruth } from './time-series-cases.mjs';
import { factor9Column, replicateBins, sortSeqDesign, sortSeqTable, sortSeqTruth } from './bins-cases.mjs';
import { barcodeDesign, barcodeTable, barcodeTruth, dmsVariantsTable, enrich2Files } from './barcode-cases.mjs';
import { dmsVariantsName } from '../web/lib/barcodes.js';
import { compareDimsum, demoCase, dimsumReference, fixtureCase, grb2Case } from './dimsum-cases.mjs';
import { cbsCase, compareLimma, mutscanReference, twoConditionCase } from './differential-cases.mjs';
import { DIFFERENTIAL_REASON_NAMES } from '../web/lib/differential.js';
import { tQuantile } from '../web/lib/distributions.js';
import { binAverages, binMLE, binTotals, scaleAnchors } from '../web/lib/score-bins.js';
import { combineMean } from '../web/lib/replicates.js';
import { scoreExperiment, PRESETS, DEFAULT_PARAMETERS, defaultParameters, MODELS, SCORING_VERSION, withDefaults } from '../web/lib/score.js';
import { scoreDimsumGroup } from '../web/lib/score-dimsum.js';
import { combineFixed, combineREML, heterogeneity } from '../web/lib/replicates.js';
import { STAGE_BY_CODE, STAGE_BY_ID, REPLICATE_STATE, REPLICATE_STATE_NAMES } from '../web/lib/filters.js';
import { makeRun, outputDigest, runId, runInputs, addRun, recordedInputs, reproduction } from '../web/lib/runs.js';
import { median } from '../web/lib/score-ratio.js';
import { QC_FIXTURES, QC_SEEDS, matches, raised, runFixture } from './qc-cases.mjs';
import { computeQC } from '../web/lib/qc.js';
import { checkThresholds, defaultThresholds, findingsFrom, measuresOf, overall, withDefaultThresholds } from '../web/lib/findings.js';
import { simulateExperiment } from '../web/lib/simulate.js';
import { setQcThresholds } from '../web/lib/workspace.js';
import { buildMapModel, cellAt, cellName, colorPosition, describeMap, ROW_ORDERS, STATE, STATE_NAMES } from '../web/lib/map-model.js';
import { mapPalette } from '../web/lib/map-render.js';
import { EXPORT_THEME, mapSVG } from '../web/lib/map-svg.js';
import { lab as labColor, deltaE2000 } from '../web/lib/colorvision.js';
import { hexToRgb, rgbToHex } from '../web/lib/colormaps.js';
import { writeFileSync } from 'node:fs';
import { SOFTWARE, allExports, buildWorkspace, inputFor, recompute, scoreTable } from './roundtrip-cases.mjs';
import { assembleTable } from '../web/lib/assemble.js';
import { readArchive, writeArchive } from '../web/lib/archive.js';
import { createZip } from '../web/lib/zip.js';
import { sha256 } from '../web/lib/sha256.js';
import { EXAMPLES, exampleById, simulatedExample } from '../web/lib/examples.js';

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const requireData = args.includes('--require-data');
const requested = args.filter((a) => !a.startsWith('--'));

const results = [];
function check(suite, name, value, ok, required) {
  results.push({ suite, name, value, ok, required });
  if (verbose || !ok) console.log(`${ok ? 'ok  ' : 'FAIL'} ${suite}: ${name} — ${value} (required ${required})`);
}

const fmt = (v, d = 3) => (Number.isFinite(v) ? Number(v.toFixed(d)).toString() : String(v));

// A suite throws MissingData when its external data are not in validation/cache/.
class MissingData extends Error {}

// External data (validation/sources.json, fetched into validation/cache/ by fetch.mjs).
const sources = JSON.parse(readFileSync(new URL('./sources.json', import.meta.url), 'utf8'));
function dataset(name) {
  const set = sources.datasets[name];
  const root = join(fileURLToPath(new URL('./cache/', import.meta.url)), name);
  const missing = set.files.filter((f) => {
    const path = join(root, f.path);
    return !existsSync(path) || statSync(path).size !== f.size;
  });
  if (missing.length) throw new MissingData(`${missing.length} of ${set.files.length} files of "${name}" are missing; run node validation/fetch.mjs ${name}`);
  return { text: (path) => readFileSync(join(root, path), 'utf8'), bytes: (path) => new Uint8Array(readFileSync(join(root, path))), set };
}

const tables = new Map();
function table(name, path) {
  const key = `${name}/${path}`;
  if (!tables.has(key)) tables.set(key, readTable(dataset(name).text(path)));
  return tables.get(key);
}

function pearson(a, b) {
  const n = a.length;
  let ma = 0; let mb = 0;
  for (let i = 0; i < n; i += 1) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let sab = 0; let saa = 0; let sbb = 0;
  for (let i = 0; i < n; i += 1) {
    const x = a[i] - ma; const y = b[i] - mb;
    sab += x * y; saa += x * x; sbb += y * y;
  }
  return sab / Math.sqrt(saa * sbb);
}

// Largest relative difference |a − b| / max(1, |b|) over pairs, and where.
function worstDifference(pairs) {
  let worst = 0;
  let where = '';
  for (const [name, a, b] of pairs) {
    const d = Math.abs(a - b) / Math.max(1, Math.abs(b));
    if (!(d <= worst)) {
      worst = d;
      where = name;
    }
  }
  return { worst, where };
}

const suites = {
  // Every text-on-surface pair of the interface reaches WCAG AA contrast (4.5:1), in both themes
  // with color-vision-friendly colors off and on; the palettes stay apart with protanopia,
  // deuteranopia and tritanopia (Machado et al. 2009; CIEDE2000); and the sequential map read as
  // "more" gets lighter steadily in every vision.
  accessibility() {
    const css = readFileSync(new URL('../web/styles.css', import.meta.url), 'utf8');
    const tokens = themeTokens(css);
    for (const [name, t] of Object.entries(tokens)) {
      const pairs = textPairs(t);
      const failing = pairs.filter((p) => !(p.ratio >= 4.5));
      const worst = pairs.reduce((a, b) => (b.ratio < a.ratio ? b : a));
      check('accessibility', `text contrast, ${name} theme${name.includes('cvd') ? ' (color-vision-friendly colors)' : ''}: ${pairs.length} text-on-surface pairs`, failing.length ? failing.map((p) => `${p.use} ${fmt(p.ratio, 3)}`).join('; ') : `lowest ${fmt(worst.ratio, 3)} (${worst.use})`, !failing.length, '≥ 4.5:1');
    }
    const describe = (report) => VISIONS.map((v) => `${v} ${fmt(report[v].min, 3)}`).join(', ');
    const friendly8 = paletteReport(CATEGORICAL_CVD, 8);
    const friendly20 = paletteReport(CATEGORICAL_CVD);
    check('accessibility', 'color-vision-friendly palette: smallest CIEDE2000 between any two of the first 8 colors', describe(friendly8), VISIONS.every((v) => friendly8[v].min >= 10), '≥ 10 in every vision');
    check('accessibility', 'color-vision-friendly palette: the same for all 20 colors', describe(friendly20), VISIONS.every((v) => friendly20[v].min >= 7), '≥ 7 in every vision');
    const default8 = paletteReport(CATEGORICAL, 8);
    check('accessibility', 'default palette, first 8 colors (why the setting exists)', describe(default8), true, 'reported');
    for (const name of ['light', 'dark', 'light+cvd', 'dark+cvd']) {
      const t = tokens[name];
      const report = paletteReport([t.ok, t.warn, t.danger]);
      const required = name.includes('cvd');
      check('accessibility', `status colors (ok, warning, danger), ${name}: smallest CIEDE2000`, describe(report), !required || VISIONS.every((v) => report[v].min >= 9), required ? '≥ 9 in every vision' : 'reported');
    }
    const monotone = (name) => VISIONS.map((v) => {
      const L = Array.from({ length: 33 }, (_, i) => labOf(simulate(colormapColor(name, i / 32), v))[0]);
      let reversals = 0;
      for (let i = 1; i < L.length; i += 1) if (L[i] < L[i - 1] - 0.5) reversals += 1;
      return reversals;
    });
    const viridis = monotone('viridis');
    check('accessibility', 'viridis: lightness never falls along the map, in every vision', `${viridis.reduce((a, b) => a + b, 0)} reversals`, viridis.every((r) => r === 0), '0');
    // The diverging map for scores (rdbu, centered on wild type): its two halves must stay apart
    // in every vision, or a loss of function would look like a gain.
    for (const name of ['rdbu', 'puor']) {
      const report = paletteReport([colormapColor(name, 0.1), colormapColor(name, 0.9)]);
      check('accessibility', `${name}: its two ends (0.1 and 0.9) apart in every vision, smallest CIEDE2000`, describe(report), VISIONS.every((v) => report[v].min >= 20), '≥ 20 in every vision');
    }
  },

  // Wave 1, slice 2 (PRD phase 0): one versioned design schema represents three public data sets
  // of different designs (two populations; time series with shared inputs and two assays in one
  // table; FACS bins in overlapping tiles) with no code for any of them.
  designs() {
    const schema = JSON.parse(readFileSync(new URL('../docs/schemas/design.v1.json', import.meta.url), 'utf8'));
    for (const c of DESIGN_CASES) {
      const design = readDesign(c.design);
      const problems = checkSchema(schema, design);
      check('designs', `${c.name}: satisfies docs/schemas/design.v1.json`, problems.length ? problems.slice(0, 3).join('; ') : 'yes', !problems.length, 'no problems');
      const counts = table(c.dataset, c.counts);
      check('designs', `${c.name}: MaveDB's table is CRLF-terminated CSV (the importer must accept it)`, counts.crlf ? 'CRLF' : 'LF', true, 'reported');
      const result = validateDesign(design, { columns: counts.columns });
      check('designs', `${c.name}: validateDesign against the table's ${counts.columns.length} columns`, result.errors.length ? result.errors.map((e) => `${e.path}: ${e.message}`).slice(0, 3).join('; ') : `no errors; ${result.warnings.length} warning${result.warnings.length === 1 ? '' : 's'}${result.warnings.length ? ` (${result.warnings.map((w) => w.message).join('; ')})` : ''}`, result.ok, 'no errors');
      for (const item of dataChecks(design, counts)) check('designs', `${c.name}: ${item.name}`, item.value, item.ok, item.required);
      const summary = summarizeDesign(design);
      check('designs', `${c.name}: summary`, summary.lines.join(' / '), summary.lines.length >= 3, 'written');
      const again = JSON.parse(JSON.stringify(design));
      check('designs', `${c.name}: a design survives JSON round trip unchanged`, 'compared', JSON.stringify(again) === JSON.stringify(design), 'identical');
    }
    // What the three data sets demanded of the schema, beyond a flat list of columns.
    const e2 = readDesign('brca1-ring-e2.design.json');
    const f9 = readDesign('factor9.design.json');
    check('designs', 'shared inputs: BRCA1\'s two libraries each select one input three times', summarizeDesign(e2).lines.find((l) => /shared/.test(l)) ?? 'none', summarizeDesign(e2).counts.sharedSamples === 2, '2 shared samples');
    check('designs', 'overlapping tiles: factor IX positions 146–164 and 299–318 are measured in two tiles', f9.library.tiles.map((t) => `${t.id} ${t.start}–${t.end}`).join(', '), f9.library.tiles[0].end >= f9.library.tiles[1].start && f9.library.tiles[1].end >= f9.library.tiles[2].start, 'overlapping');
  },

  // Enrich2 2.0.2's scores of the feasibility data (validation/reference/enrich2.json, made by
  // generate_enrich2.py) against (1) the formulas of research.md §2.1 computed here
  // independently, and (2) the scores the BRCA1 authors published with Enrich2 in 2017.
  enrich2() {
    const reference = JSON.parse(readFileSync(new URL('./reference/enrich2.json', import.meta.url), 'utf8'));
    check('enrich2', 'reference made with', Object.entries(reference.versions).map(([k, v]) => `${k} ${v}`).join(', '), reference.versions.enrich2 === '2.0.2', 'enrich2 2.0.2');
    for (const c of DESIGN_CASES.filter((x) => reference.cases[x.name])) {
      const entry = reference.cases[c.name];
      const design = readDesign(c.design);
      const counts = table(c.dataset, c.counts);
      const index = new Map(entry.variants.map((v, i) => [v, i]));
      for (const [method, values] of Object.entries(entry.methods)) {
        const [scoring, logr] = method.split('/');
        const perReplicate = new Map();
        for (const replicate of design.replicates) {
          const data = replicateCounts(design, counts, replicate);
          const r = normalizers(design, counts, replicate, data, logr);
          const scores = scoring === 'ratios' ? ratioScores(data, r) : regressionScores(data, r, scoring === 'WLS');
          perReplicate.set(replicate.id, scores);
        }
        // Per replicate, every stored variant.
        const pairs = [];
        const sePairs = [];
        let compared = 0;
        let unmatched = 0;
        for (const [rep, columns] of Object.entries(values.replicates)) {
          const mine = perReplicate.get(rep);
          for (const [i, name] of entry.variants.entries()) {
            const theirs = columns.score[i];
            if (theirs === null) {
              if (mine.has(name)) unmatched += 1;
              continue;
            }
            if (!mine.has(name)) {
              unmatched += 1;
              continue;
            }
            compared += 1;
            pairs.push([`${rep} ${name}`, mine.get(name)[0], theirs]);
            sePairs.push([`${rep} ${name}`, mine.get(name)[1], columns.se[i]]);
          }
        }
        const s = worstDifference(pairs);
        const se = worstDifference(sePairs);
        check('enrich2', `${c.name} ${method}: each replicate's scores by research.md's formulas, against Enrich2 (${compared} values)`, `score ${s.worst.toExponential(2)} (${s.where}), SE ${se.worst.toExponential(2)}${unmatched ? `; ${unmatched} scored by one side only` : ''}`, s.worst <= 1e-10 && se.worst <= 1e-10 && !unmatched && compared > 0, '≤ 1e-10 relative, same variants');

        // Combined: Enrich2's random-effects estimator, reproduced exactly here, on the variants
        // scored in every replicate (the number of them sets its starting value).
        for (const [condition, combined] of Object.entries(values.combined)) {
          const reps = design.replicates.filter((r) => (r.condition ?? 'all') === condition).map((r) => r.id);
          const shared = [...perReplicate.get(reps[0]).keys()].filter((name) => reps.every((rep) => perReplicate.get(rep).has(name)));
          const y = reps.map((rep) => shared.map((name) => perReplicate.get(rep).get(name)[0]));
          const s2 = reps.map((rep) => shared.map((name) => perReplicate.get(rep).get(name)[1] ** 2));
          const mine = enrich2Combination(y, s2);
          const wt = design.controls?.wildType;
          const cPairs = [];
          for (const [v, name] of shared.entries()) {
            const i = index.get(name);
            if (i === undefined || combined.score[i] === null) continue;
            if (logr === 'wt' && name === wt) continue; // Enrich2 sets the wild type to 0 ± 0
            cPairs.push([name, mine[v][0], combined.score[i]], [`${name} SE`, mine[v][1], combined.se[i]]);
          }
          const d = worstDifference(cPairs);
          check('enrich2', `${c.name} ${method}: combined scores by Enrich2's estimator (start ÷ (variants − 1), 50 iterations), ${shared.length} variants in every replicate`, `${d.worst.toExponential(2)} (${d.where}) over ${cPairs.length / 2} stored variants`, d.worst <= 1e-9, '≤ 1e-9 relative');
        }
      }
    }

    // The published BRCA1 scores (Rubin et al. 2017, Enrich2 of 2017) against Enrich2 2.0.2 on
    // the same counts, with weighted least squares and wild-type normalization.
    const published = table('mavedb-brca1-ring', 'aa/scores.csv');
    const e2 = reference.cases['brca1-ring-e2'];
    const wls = e2.methods['WLS/wt'];
    const row = new Map(published.data.hgvs_pro.map((name, i) => [name, i]));
    const pubNumber = (column, name) => {
      const v = published.data[column][row.get(name)];
      return v === 'NA' ? null : Number(v);
    };
    const repPairs = [];
    for (const [rep, columns] of Object.entries(wls.replicates)) {
      const col = readDesign('brca1-ring-e2.design.json').replicates.find((r) => r.id === rep).name;
      for (const [i, name] of e2.variants.entries()) {
        const p = pubNumber(`score_${col}`, name);
        if (p === null || columns.score[i] === null) continue;
        repPairs.push([`${col} ${name}`, columns.score[i], p], [`${col} ${name} SE`, columns.se[i], pubNumber(`SE_${col}`, name)]);
      }
    }
    const r = worstDifference(repPairs);
    check('enrich2', `BRCA1 E2: published replicate scores (Enrich2, 2017) reproduced by Enrich2 2.0.2 with WLS and wild-type normalization (${repPairs.length / 2} values)`, `${r.worst.toExponential(2)} (${r.where})`, r.worst <= 1e-10, '≤ 1e-10 relative');
    let converged = 0;
    let convergedWorst = 0;
    let unconverged = 0;
    let unconvergedWorst = 0;
    for (const [i, name] of e2.variants.entries()) {
      const p = pubNumber('score', name);
      const mine = wls.combined.all.score[i];
      if (p === null || mine === null || name === '_wt') continue;
      const d = Math.abs(mine - p);
      if (wls.combined.all.epsilon[i] === 0) {
        converged += 1;
        convergedWorst = Math.max(convergedWorst, d);
      } else {
        unconverged += 1;
        unconvergedWorst = Math.max(unconvergedWorst, d);
      }
    }
    check('enrich2', 'BRCA1 E2: published combined scores where Enrich2\'s 50 iterations converged (epsilon 0)', `${converged} variants, largest difference ${convergedWorst.toExponential(2)}`, convergedWorst <= 1e-10 && converged > 0, '≤ 1e-10');
    check('enrich2', 'BRCA1 E2: published combined scores where they had not: the estimator\'s start depends on the number of variants, which differed in 2017 (known difference, research.md §2.1)', `${unconverged} variants, largest difference ${unconvergedWorst.toFixed(4)}`, true, 'reported');

    // GRB2: the published scores come from DiMSum (absolute growth rates, another error model);
    // the agreement is a correlation, until wave 2 brings DiMSum's model.
    const grb2 = reference.cases['grb2-sh3'];
    const pubGrb2 = table('mavedb-grb2-sh3', 'scores.csv');
    const gRow = new Map(pubGrb2.data.hgvs_pro.map((name, i) => [name, i]));
    const a = [];
    const b = [];
    for (const [i, name] of grb2.variants.entries()) {
      const mine = grb2.methods['ratios/wt'].combined.all.score[i];
      const theirs = pubGrb2.data.score[gRow.get(name)];
      if (mine === null || theirs === undefined || theirs === 'NA') continue;
      a.push(mine);
      b.push(Number(theirs));
    }
    check('enrich2', `GRB2 SH3: Enrich2 log ratios against the published DiMSum scores (another model; ${a.length} variants), Pearson r`, pearson(a, b).toFixed(4), pearson(a, b) > 0.9, '> 0.9 (known difference)');
  },

  // web/lib/hgvs.js against mavehgvs 0.8.1 (reference/mavehgvs.json, made by
  // generate_mavehgvs.py): the same decision, reason, canonical form, types, positions, sequences
  // and flags for every string of the corpus.
  hgvs() {
    const reference = JSON.parse(readFileSync(new URL('./reference/mavehgvs.json', import.meta.url), 'utf8'));
    check('hgvs', 'reference made with', `mavehgvs ${reference.versions.mavehgvs} (fqfa ${reference.versions.fqfa}); ${reference.counts.strings} strings, ${reference.counts.valid} valid`, reference.versions.mavehgvs === '0.8.1', 'mavehgvs 0.8.1');
    const disagree = { decision: [], reason: [], canonical: [], parts: [] };
    const sequenceOf = (c) => (c.type === 'sub' ? [c.ref, c.alt] : c.type === 'ins' || c.type === 'delins' ? c.seq : c.type === 'equal' ? c.equal : null);
    for (const r of reference.results) {
      const p = parseHgvs(r.s);
      if (p.ok !== r.ok) {
        disagree.decision.push(`${JSON.stringify(r.s)} (mavehgvs ${r.ok ? 'accepts' : 'refuses'})`);
        continue;
      }
      if (!r.ok) {
        if (p.error !== r.error) disagree.reason.push(`${JSON.stringify(r.s)}: "${p.error}" for "${r.error}"`);
        continue;
      }
      if (p.canonical !== r.canonical) disagree.canonical.push(`${r.s} → ${p.canonical}`);
      const positions = p.components.map((c) => (c.start ? (c.end ? [formatPosition(c.start), formatPosition(c.end)] : formatPosition(c.start)) : null));
      const same = p.prefix === r.prefix && (p.target ?? null) === (r.target ?? null) && JSON.stringify(p.components.map((c) => c.type)) === JSON.stringify(r.types)
        && JSON.stringify(positions) === JSON.stringify(r.positions) && JSON.stringify(p.components.map(sequenceOf)) === JSON.stringify(r.sequences)
        && p.synonymous === r.synonymous && p.identical === r.identical;
      if (!same) disagree.parts.push(r.s);
    }
    const show = (list) => (list.length ? `${list.length}: ${list.slice(0, 3).join('; ')}` : '0');
    check('hgvs', `valid or not, as mavehgvs decides (${reference.results.length} strings)`, `${show(disagree.decision)} disagree`, !disagree.decision.length, '0');
    check('hgvs', `the reason for refusing, word for word (${reference.counts.invalid} refused)`, `${show(disagree.reason)} differ`, !disagree.reason.length, '0');
    check('hgvs', `the canonical form (${reference.counts.valid} valid)`, `${show(disagree.canonical)} differ`, !disagree.canonical.length, '0');
    check('hgvs', 'the prefix, target, variant types, positions, sequences, synonymous and identical flags', `${show(disagree.parts)} differ`, !disagree.parts.length, '0');
  },

  // Import (wave 1, slice 3): the feasibility tables, DiMSum's demo and a table with one problem
  // of each kind, through the importer as the wizard uses it.
  import() {
    const designs = Object.fromEntries(DESIGN_CASES.map((c) => [c.name, readDesign(c.design)]));
    const cases = [
      { name: 'GRB2 SH3', dataset: 'mavedb-grb2-sh3', path: 'counts.csv', target: designs['grb2-sh3'].targets[0], expect: { layout: 'mavedb-counts', column: 'hgvs_pro', valid: 1121, lenient: 0 } },
      { name: 'BRCA1 RING, amino acids', dataset: 'mavedb-brca1-ring', path: 'aa/counts.csv', target: designs['brca1-ring-e2'].targets[0], expect: { layout: 'mavedb-counts', column: 'hgvs_pro', valid: 12314, lenient: 2 } },
      { name: 'BRCA1 RING, nucleotides', dataset: 'mavedb-brca1-ring', path: 'nt/counts.csv', target: designs['brca1-ring-e2'].targets[0], expect: { layout: 'mavedb-counts', column: 'hgvs_nt', valid: 20723, lenient: 1 } },
      { name: 'factor IX', dataset: 'mavedb-factor9', path: 'counts.csv', target: designs.factor9.targets[0], expect: { layout: 'mavedb-counts', column: 'hgvs_pro', valid: 9682, lenient: 0 } },
    ];
    for (const c of cases) {
      const bytes = dataset(c.dataset).bytes(c.path);
      const t0 = performance.now();
      const table = parseTable(bytes);
      const ms = performance.now() - t0;
      const layout = detectLayout(table);
      check('import', `${c.name}: read (${(bytes.length / 1e6).toFixed(1)} MB, ${table.rows} rows × ${table.columns.length} columns, ${table.lineEnd}) in ${ms.toFixed(0)} ms; layout`, `${layout.layout}, variants in ${layout.variantColumn} (${layout.level}), ${layout.countColumns.length} count columns`, layout.layout === c.expect.layout && layout.variantColumn === c.expect.column && table.lineEnd === 'crlf' && !table.diagnostics.length, `${c.expect.layout}, ${c.expect.column}, no diagnostics`);
      const review = reviewImport(table, { variantColumn: layout.variantColumn, level: layout.level, countColumns: layout.countColumns, target: c.target });
      const s = review.summary;
      check('import', `${c.name}: every variant name valid against the design's target`, `${s.valid} valid, ${s.warning} read leniently, ${s.invalid} not valid; ${Object.entries(s.byKind).map(([k, n]) => `${n} ${k}`).join(', ')}`, s.valid === c.expect.valid && s.warning === c.expect.lenient && s.invalid === 0, `${c.expect.valid} valid, ${c.expect.lenient} lenient, 0 invalid`);
      check('import', `${c.name}: nothing blocks scoring`, review.blocking.map((b) => b.message).join(' | ') || 'nothing', !review.blocking.length, 'nothing');
      const counts = review.countSet;
      const missing = counts.samples.reduce((a, x) => a + x.missing, 0);
      const zeros = counts.samples.reduce((a, x) => a + x.zeros, 0);
      // Columns of numbers keep no text: their missing cells, every one written NA.
      const countColumns = table.columns.filter((col) => layout.countColumns.includes(col.name));
      const naInFile = countColumns.every((col) => col.missingTokens.every((t) => t === 'NA')) ? countColumns.reduce((a, col) => a + col.missing, 0) : Number.NaN;
      check('import', `${c.name}: counts written NA are missing and explicit zeros stay 0`, `${missing} missing (${naInFile} NA in the file), ${zeros} zeros`, missing === naInFile, 'missing = NA cells');
    }

    // The designs drafted from column names, against the designs written by hand in slice 2.
    const draftFor = (path, design) => {
      const table = parseTable(dataset(design.source.mavedb.includes('835') ? 'mavedb-grb2-sh3' : design.source.mavedb.includes('1200') ? 'mavedb-factor9' : 'mavedb-brca1-ring').bytes(path));
      const columns = design.samples.flatMap((x) => x.columns).concat((design.ignoredColumns ?? []).filter((x) => x.copyOf).map((x) => x.column));
      return { table, ...draftDesign(table, suggestRoles(columns), { variantColumn: design.variants.column, level: design.variants.level, target: design.targets[0] }) };
    };
    const shape = (d) => ({
      model: d.model,
      replicates: d.replicates.length,
      samples: d.samples.length,
      shared: summarizeDesign(d).counts.sharedSamples,
      points: [...new Set(d.replicates.map((r) => (r.timepoints ?? r.bins ?? [1, 2]).length))].join(','),
      tiles: (d.library?.tiles ?? []).map((t) => `${t.start}-${t.end}`).join(' '),
    });
    for (const [name, path] of [['grb2-sh3', 'counts.csv'], ['brca1-ring-e2', 'aa/counts.csv'], ['brca1-ring-y2h', 'aa/counts.csv'], ['factor9', 'counts.csv']]) {
      const { table, design } = draftFor(path, designs[name]);
      const drafted = shape(design);
      const written = shape(designs[name]);
      const result = validateDesign({ ...design, ignoredColumns: [...(design.ignoredColumns ?? []), ...(designs[name].ignoredColumns ?? []).filter((x) => !x.copyOf)] }, { columns: table.columns.map((x) => x.name) });
      check('import', `${name}: the design drafted from column names has the hand-written design's shape`, `${JSON.stringify(drafted)}${result.ok ? '' : `; ${result.errors[0].message}`}`, JSON.stringify(drafted) === JSON.stringify(written) && result.ok, JSON.stringify(written));
    }

    // Row and column order do not matter (T1: property).
    const grb2 = parseTable(dataset('mavedb-grb2-sh3').bytes('counts.csv'));
    const byVariant = (table) => {
      const review = reviewImport(table, { variantColumn: 'hgvs_pro', level: 'protein', countColumns: ['input_count_rep1', 'input_count_rep2', 'input_count_rep3', 'output_count_rep1', 'output_count_rep2', 'output_count_rep3'], target: designs['grb2-sh3'].targets[0] });
      const out = new Map();
      review.variants.key.forEach((key, i) => out.set(key, review.countSet.samples.map((x) => `${x.column}=${x.counts[i]}`).sort().join(' ')));
      return out;
    };
    const random = createRandom(11);
    const order = shuffle([...Array(grb2.columns.length).keys()], random);
    const rows = shuffle([...Array(grb2.rows).keys()], random);
    const lines = [order.map((j) => grb2.columns[j].name).join(','), ...rows.map((r) => order.map((j) => cellText(grb2.columns[j], r)).join(','))];
    const shuffled = byVariant(parseTable(`${lines.join('\n')}\n`));
    const original = byVariant(grb2);
    const differing = [...original].filter(([k, v]) => shuffled.get(k) !== v);
    check('import', 'GRB2 with rows and columns shuffled imports the same counts for every variant', `${original.size - differing.length} of ${original.size} variants the same`, !differing.length && shuffled.size === original.size, 'all');
    const parser = createTableParser();
    const text = dataset('mavedb-grb2-sh3').text('counts.csv');
    for (let i = 0; i < text.length; i += 997) parser.push(text.slice(i, i + 997));
    const parts = parser.finish();
    check('import', 'GRB2 read in parts of 997 characters (a quote or CRLF across parts) equals GRB2 read at once', `${parts.rows} rows`, JSON.stringify(parts.columns.map((x) => x.values ?? Array.from(x.numeric))) === JSON.stringify(grb2.columns.map((x) => x.values ?? Array.from(x.numeric))), 'identical');

    // Per-sample files: GRB2 split into one file per sample (each listing only the variants it
    // counts) and joined again.
    const files = ['input_count_rep1', 'output_count_rep1', 'input_count_rep2'].map((name) => {
      const variant = grb2.columns.find((x) => x.name === 'hgvs_pro').values;
      const values = grb2.columns.find((x) => x.name === name).numeric;
      const body = variant.map((v, i) => (Number.isNaN(values[i]) ? null : `${v}\t${values[i]}`)).filter(Boolean);
      return { name, variantColumn: 'variant', countColumns: ['count'], table: parseTable(`variant\tcount\n${body.join('\n')}\n`) };
    });
    const joined = joinCountTables(files);
    const joinedSet = buildCountSet(joined.table, { variantColumn: 'variant', countColumns: files.map((f) => f.name) });
    const originalSet = buildCountSet(grb2, { variantColumn: 'hgvs_pro', countColumns: files.map((f) => f.name) });
    const index = new Map(joined.table.columns[0].values.map((v, i) => [v, i]));
    let mismatches = 0;
    grb2.columns.find((x) => x.name === 'hgvs_pro').values.forEach((v, i) => {
      originalSet.samples.forEach((sample, j) => {
        const a = sample.counts[i];
        const b = index.has(v) ? joinedSet.samples[j].counts[index.get(v)] : Number.NaN;
        if (!(a === b || (Number.isNaN(a) && Number.isNaN(b)))) mismatches += 1;
      });
    });
    check('import', 'GRB2 split into per-sample files and joined: every count the same, absent as missing (not 0)', `${mismatches} counts differ`, mismatches === 0, '0');

    // DiMSum's demo: whole sequences named against the wild type; its design file with CR line ends.
    const demo = dataset('dimsum-demo');
    const toy = parseTable(demo.bytes('countFile_Toy.txt'));
    const toyLayout = detectLayout(toy);
    const wildType = demo.set.wildType;
    const named = namesFromSequences(toy.columns.find((x) => x.name === 'nt_seq').values, wildType);
    const kinds = {};
    const variants = reviewImport({ ...toy, columns: [...toy.columns, { name: 'hgvs_pro', values: named.pro, type: 'text' }] }, { variantColumn: 'hgvs_pro', level: 'protein', countColumns: toyLayout.countColumns, target: targetFromSequence({ id: 'tdp43', description: '', sequence: wildType }).target });
    variants.variants.kind.forEach((k) => { kinds[KIND_NAMES[k]] = (kinds[KIND_NAMES[k]] ?? 0) + 1; });
    const ntNamed = parseTable(`v\n${named.nt.join('\n')}\n`);
    check('import', `DiMSum's demo: ${toy.rows} sequences in ${toyLayout.layout} layout, ${toyLayout.countColumns.length} samples, named against its 126-nt wild type`, `${named.problems.length} unnamed; ${Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${k}`).join(', ')}`, toyLayout.layout === 'dimsum' && toyLayout.countColumns.length === 8 && !named.problems.length && named.nt.filter((n) => n === 'c.=').length === 1, 'all named, one wild type');
    check('import', 'DiMSum\'s demo: the nucleotide names are valid MAVE-HGVS against the wild type', `${variants.summary.invalid} protein names invalid; ${named.nt.filter((n) => !parseHgvs(n).ok).length} nucleotide names invalid of ${ntNamed.rows}`, variants.summary.invalid === 0 && named.nt.every((n) => parseHgvs(n).ok), '0');
    const sheet = parseTable(demo.bytes('experimentDesign_Toy.txt'));
    check('import', 'DiMSum\'s experiment design file, with CR line ends, read as a table', `${sheet.lineEnd}, ${sheet.rows} rows: ${sheet.columns.find((x) => x.name === 'sample_name')?.values.join(', ')}`, sheet.lineEnd === 'cr' && sheet.rows === 8, 'CR, 8 samples');

    // Legacy names in public data: BRCA1's protein column of its nucleotide table (MaveDB's
    // oldest record) holds names mavehgvs now refuses; lenient reading takes them in.
    const legacyNames = [...new Set(parseTable(dataset('mavedb-brca1-ring').bytes('nt/counts.csv')).columns.find((x) => x.name === 'hgvs_pro').values)];
    const refused = legacyNames.filter((n) => !parseHgvs(n).ok);
    const read = refused.filter((n) => parseHgvs(n, { mode: 'lenient' }).ok);
    const reasons = {};
    for (const n of refused) reasons[parseHgvs(n).error] = (reasons[parseHgvs(n).error] ?? 0) + 1;
    check('import', 'BRCA1\'s legacy protein names (urn:mavedb:00000003-a-1) that strict MAVE-HGVS refuses are read leniently', `${read.length} of ${refused.length} (of ${legacyNames.length} distinct names); refused for: ${Object.entries(reasons).map(([k, v]) => `${v} ${k}`).join('; ')}${refused.length > read.length ? `; still refused: ${refused.filter((n) => !read.includes(n)).slice(0, 3).join(', ')}` : ''}`, read.length === refused.length && refused.length > 0, 'all');

    // A table with one problem of each kind.
    const table = parseTable(new Uint8Array(readFileSync(new URL('./fixtures/malformed-counts.csv', import.meta.url))));
    const target = targetFromSequence(parseFasta(readFileSync(new URL('./fixtures/malformed-counts.fasta', import.meta.url), 'utf8'))[0]).target;
    const layout = detectLayout(table);
    const review = reviewImport(table, { variantColumn: layout.variantColumn, level: layout.level, countColumns: layout.countColumns, target });
    const found = [...review.blocking.map((p) => `blocks:${p.code}${p.lines ? `@${p.lines.join('+')}` : ''}`), ...review.warnings.map((p) => `warns:${p.code}${p.lines ? `@${p.lines.join('+')}` : ''}`)].sort();
    const expected = ['blocks:duplicate-variants@3+17+4+6', 'blocks:negative@11', 'blocks:not-numeric@10', 'blocks:ragged-rows', 'warns:invalid-variants@7+8+9+14', 'warns:non-integer'].sort();
    check('import', 'the malformed fixture: every planted problem found, on its line, and nothing else', found.join(', '), JSON.stringify(found) === JSON.stringify(expected), expected.join(', '));
    check('import', 'the malformed fixture: lenient names (K3R, an unsorted multi-variant, _wt) read and kept beside their originals', `${review.summary.warning} read leniently: ${[2, 13, 14].map((r) => `${review.variants.original[r]} → ${review.variants.key[r]}`).join(', ')}`, review.summary.warning === 3 && review.variants.key[14] === 'p.=', '3');
  },

  // The Experiment view (wave 1, slice 4): every feasibility design expressed with the editor's
  // operations alone, read from a sample sheet, and kept in a workspace whose history is chained.
  experiment() {
    for (const c of DESIGN_CASES) {
      const design = readDesign(c.design);
      const counts = table(c.dataset, c.counts);
      const rebuilt = rebuild(design);
      const same = JSON.stringify(meaning(rebuilt)) === JSON.stringify(meaning(design));
      const result = validateDesign(rebuilt, { columns: counts.columns });
      check('experiment', `${c.name}: rebuilt with the editor's operations alone, it says what the hand-written design says`, `${meaning(design).slots.length} slots, ${design.samples.length} samples, ${meaning(design).copies.length} copies${same ? '' : '; differs'}${result.ok ? '' : `; ${result.errors[0].message}`}`, same && result.ok, 'the same, and valid');
    }
    const grb2 = readDesign('grb2-sh3.design.json');
    check('experiment', 'GRB2: two populations made a time series and back loses nothing', 'compared', JSON.stringify(meaning(modelRoundTrip(grb2))) === JSON.stringify(meaning(grb2)), 'the same');

    // Sample sheets, as a lab would write them, against the hand-written designs.
    const sheets = [
      { name: 'grb2-sh3', sheet: 'grb2-sh3.samples.csv', dataset: 'mavedb-grb2-sh3', counts: 'counts.csv' },
      { name: 'brca1-ring-e2', sheet: 'brca1-ring-e2.samples.csv', dataset: 'mavedb-brca1-ring', counts: 'aa/counts.csv' },
      { name: 'factor9', sheet: 'factor9.samples.csv', dataset: 'mavedb-factor9', counts: 'counts.csv' },
    ];
    for (const x of sheets) {
      const written = readDesign(`${x.name}.design.json`);
      const counts = table(x.dataset, x.counts);
      const countColumns = counts.columns.filter((name) => !['accession', 'hgvs_nt', 'hgvs_splice', 'hgvs_pro'].includes(name));
      const sheet = parseTable(new Uint8Array(readFileSync(new URL(`./fixtures/${x.sheet}`, import.meta.url))));
      const { design, problems } = designFromSampleSheet(sheet, { countColumns, variants: written.variants, targets: written.targets });
      // A sheet does not give tile ranges: they are set in the view, as here.
      for (const [i, t] of (design.library.tiles ?? []).entries()) Object.assign(t, { start: written.library.tiles[i].start, end: written.library.tiles[i].end });
      const a = meaning(design);
      const b = meaning(written);
      const same = JSON.stringify(a.slots) === JSON.stringify(b.slots) && a.model === b.model && JSON.stringify(a.samples) === JSON.stringify(b.samples);
      const result = validateDesign(design, { columns: counts.columns });
      check('experiment', `${x.name}: the design read from a sample sheet (fixtures/${x.sheet}) has the hand-written design's samples and slots`, `${a.slots.length} slots; problems: ${problems.filter((p) => p.level === 'error').map((p) => p.message).join('; ') || 'none'}${result.ok ? '' : `; ${result.errors[0].message}`}`, same && result.ok && !problems.some((p) => p.level === 'error'), 'the same, and valid');
    }
    const demo = dataset('dimsum-demo');
    const toyColumns = parseTable(demo.bytes('countFile_Toy.txt')).columns.map((col) => col.name);
    const fromDiMSum = designFromSampleSheet(parseTable(demo.bytes('experimentDesign_Toy.txt')), { countColumns: toyColumns.filter((n) => n !== 'nt_seq'), variants: { column: 'nt_seq', level: 'nucleotide' }, targets: [targetFromSequence({ id: 'tdp43', description: '', sequence: demo.set.wildType }).target] });
    const toyResult = validateDesign(fromDiMSum.design, { columns: toyColumns });
    check('experiment', 'DiMSum\'s own experiment design file (CR line ends) as a sample sheet for its demo counts', `${fromDiMSum.design.replicates.map((r) => `${r.biological}: ${r.input} → ${r.output}`).join(', ')}${toyResult.ok ? '' : `; ${toyResult.errors[0].message}`}`, toyResult.ok && fromDiMSum.design.replicates.length === 4, '4 replicates, valid');
    // The design written back as a sample sheet (wave 2, slice 10: the analysis package) reads as
    // the same design, for every validation design: inputs selected under two conditions as one row
    // naming both, shared samples, technical replicates, times, bins and cells.
    {
      const designs = ['two-population', 'time-series', 'sort-seq', 'barcodes', 'two-condition'].map((f) => [`fixtures/${f}`, JSON.parse(readFileSync(new URL(`./fixtures/${f}.design.json`, import.meta.url), 'utf8'))])
        .concat(['brca1-ring-e2', 'brca1-ring-y2h', 'factor9', 'grb2-sh3'].map((f) => [`designs/${f}`, readDesign(`${f}.design.json`)]));
      const incomplete = designs.filter(([, d]) => !sampleSheetCSV(d).complete).map(([name]) => name);
      const twoConditions = sampleSheetCSV(designs.find(([n]) => n === 'fixtures/two-condition')[1]).csv.split('\n').find((line) => line.startsWith('input_rep1,'));
      check('experiment', 'every validation design written as a sample sheet reads back as the same design (samples, slots, times, bins, cells, conditions)', incomplete.length ? `not the same: ${incomplete.join(', ')}` : `${designs.length} designs; an input selected under two conditions: "${twoConditions}"`, !incomplete.length && /Without ligand;With ligand/.test(twoConditions ?? ''), 'all; one row naming both conditions');
    }

    // A workspace through the slice's edits: its history chained, saved and reopened intact.
    let ws = createWorkspace('GRB2', { now: '2026-10-08T12:00:00.000Z' });
    ws = addTarget(ws, grb2.targets[0]).ws;
    ws = addSource(ws, { name: 'counts.csv', sha256: 'd4c966d5e7b9605227b5931904685358b68f1952818cb7523e606d86dff9e016', rows: 1121, mapping: { countColumns: [] } }).ws;
    ws = setDesign(ws, grb2, 'Set the design', 'counts.csv');
    ws = updateTarget(ws, grb2.targets[0].id, { offset: 0 }, 'Set the offset to 0');
    check('experiment', 'a target "changed" to what it already is is not a change', 'compared', updateTarget(ws, grb2.targets[0].id, { offset: 0 }) === ws, 'no entry');
    const reopened = parseWorkspace(serializeWorkspace(ws));
    const chain = verifyHistory(reopened);
    check('experiment', 'a workspace through the slice\'s edits: its history chained, and intact after saving and reopening', `${chain.entries} entries (${reopened.history.map((e) => e.action).join(', ')}), head ${chain.head.slice(0, 12)}…`, chain.ok && chain.entries === 5, '5 entries, unbroken');
    const tampered = { ...reopened, history: reopened.history.map((e, i) => (i === 3 ? { ...e, detail: 'Set the design (edited later)' } : e)) };
    check('experiment', 'an entry edited afterward breaks the chain where it was edited', `broken at entry ${verifyHistory(tampered).broken[0]?.index + 1}`, verifyHistory(tampered).broken[0]?.index === 3, 'entry 4');
  },
  // Scoring (wave 1, slice 5): the engine (web/lib/score.js) against Enrich2 2.0.2, dms_variants
  // 1.6.0 and metafor 5.2-1 (reference/*.json), the PRD's two-population edge cases on the
  // synthetic fixture (fixtures/two-population.csv), rescaling, determinism, row- and column-order
  // invariance, and runs that reproduce. The feasibility data come last (external data).
  scoring() {
    const enrich2 = JSON.parse(readFileSync(new URL('./reference/enrich2.json', import.meta.url), 'utf8'));
    const dmsv = JSON.parse(readFileSync(new URL('./reference/dms_variants.json', import.meta.url), 'utf8'));
    const metafor = JSON.parse(readFileSync(new URL('./reference/metafor.json', import.meta.url), 'utf8'));
    const fixture = fixtureTable();
    const design = fixtureDesign();

    // The engine with Enrich2-compatible parameters against Enrich2's own output, replicate by
    // replicate and combined, on the variants Enrich2 stored.
    const againstEnrich2 = (caseName, table, caseDesign) => {
      const entry = enrich2.cases[caseName];
      const names = table.columns.find((c) => c.name === caseDesign.variants.column).values;
      const row = new Map(names.map((n, i) => [n, i]));
      for (const [method, values] of Object.entries(entry.methods)) {
        const [scoring, normalization] = method.split('/');
        const model = scoring === 'ratios' ? 'ratio' : scoring.toLowerCase();
        const t0 = performance.now();
        const results = score(table, caseDesign, { ...PRESETS.enrich2.parameters, model, normalization });
        const ms = performance.now() - t0;
        const pairs = [];
        let oneSide = 0;
        for (const rep of results.replicates) {
          const theirs = values.replicates[rep.id];
          entry.variants.forEach((name, j) => {
            const i = row.get(name);
            const mine = rep.state[i] === REPLICATE_STATE.USED;
            if (mine !== (theirs.score[j] !== null)) {
              oneSide += 1;
              return;
            }
            if (mine) pairs.push([`${rep.id} ${name}`, rep.score[i], theirs.score[j]], [`${rep.id} ${name} SE`, rep.se[i], theirs.se[j]]);
          });
        }
        const d = worstDifference(pairs);
        check('scoring', `${caseName} ${method}: each replicate's scores and SEs equal Enrich2 2.0.2's (${pairs.length / 2} values; scored in ${ms.toFixed(0)} ms)`, `${d.worst.toExponential(2)} (${d.where})${oneSide ? `; ${oneSide} scored by one side only` : ''}`, d.worst <= 1e-10 && !oneSide && pairs.length > 0, '≤ 1e-10 relative, the same variants');
        const c = results.conditions[0];
        const combined = values.combined.all;
        const cPairs = [];
        let cOneSide = 0;
        entry.variants.forEach((name, j) => {
          const i = row.get(name);
          if ((c.reason[i] === 0) !== (combined.score[j] !== null)) {
            cOneSide += 1;
            return;
          }
          if (!c.reason[i]) cPairs.push([name, c.score[i], combined.score[j]], [`${name} SE`, c.se[i], combined.se[j]]);
        });
        const dc = worstDifference(cPairs);
        check('scoring', `${caseName} ${method}: combined scores and SEs (Enrich2's estimator, the wild type 0 ± 0) equal Enrich2's (${cPairs.length / 2} variants)`, `${dc.worst.toExponential(2)} (${dc.where})${cOneSide ? `; ${cOneSide} combined by one side only` : ''}`, dc.worst <= 1e-10 && !cOneSide && cPairs.length > 0, '≤ 1e-10 relative, the same variants');
      }
    };
    againstEnrich2('two-population', fixture, design);

    // Time series (wave 2, slice 2): weighted and ordinary regression on time.
    {
      const ts = timeSeriesTable();
      const tsDesign = timeSeriesDesign();
      againstEnrich2('time-series', ts, tsDesign);
      const tsNames = ts.columns.find((c) => c.name === 'hgvs_pro').values;
      const tsRow = new Map(tsNames.map((n, i) => [n, i]));
      // statsmodels: slope, residual-scaled SE, SE from counting alone, departure from a line.
      const statsmodels = JSON.parse(readFileSync(new URL('./reference/statsmodels.json', import.meta.url), 'utf8'));
      for (const [method, perReplicate] of Object.entries(statsmodels.methods)) {
        const [scoring, normalization] = method.split('/');
        const base = { ...DEFAULT_PARAMETERS, model: scoring.toLowerCase(), normalization, filters: { ...DEFAULT_PARAMETERS.filters, minInputCount: 0 } };
        const residual = score(ts, tsDesign, { ...base, regressionSE: 'residual' });
        const floored = score(ts, tsDesign, base);
        const pairs = [];
        const floorPairs = [];
        let oneSide = 0;
        let pointsWrong = 0;
        let raised = 0;
        for (const [r, rep] of residual.replicates.entries()) {
          const theirs = perReplicate[rep.id];
          tsNames.forEach((name, i) => {
            const mine = rep.state[i] === REPLICATE_STATE.USED;
            if (mine !== (name in theirs)) {
              oneSide += 1;
              return;
            }
            if (!mine) return;
            const [slope, bse, seCounting, chi2, n] = theirs[name];
            pairs.push([`${rep.id} ${name}`, rep.score[i], slope], [`${rep.id} ${name} SE`, rep.se[i], bse], [`${rep.id} ${name} χ²`, rep.fit[i], chi2]);
            floorPairs.push([`${rep.id} ${name} SE`, floored.replicates[r].se[i], Math.max(bse, seCounting)]);
            if (seCounting > bse) raised += 1;
            if (rep.points[i] !== n) pointsWrong += 1;
          });
        }
        const d = worstDifference(pairs);
        const df = worstDifference(floorPairs);
        check('scoring', `time series ${method}: each replicate's slope, residual-scaled SE and departure from a line equal statsmodels ${statsmodels.versions.statsmodels} (${pairs.length / 3} fits on 3–5 unevenly spaced times)`, `${d.worst.toExponential(2)} (${d.where})${oneSide ? `; ${oneSide} by one side only` : ''}${pointsWrong ? `; ${pointsWrong} with other time points` : ''}`, d.worst <= 1e-10 && !oneSide && !pointsWrong && pairs.length > 0, '≤ 1e-10 relative, the same variants and points');
        check('scoring', `time series ${method}: the counting floor's SE equals the larger of statsmodels' and counting's (numpy), raised in ${raised} of ${floorPairs.length} fits`, `${df.worst.toExponential(2)} (${df.where})`, df.worst <= 1e-10 && raised > 0, '≤ 1e-10 relative');
      }
      // The edge cases under MaveScape's defaults (weighted regression).
      const edge = edgeVariants(tsDesign);
      const defaultsTs = score(ts, tsDesign, { ...DEFAULT_PARAMETERS, model: 'wls' });
      const ct = defaultsTs.conditions[0];
      for (const [key, what, states, points, flags] of TIME_SERIES_EXPECTATIONS) {
        const name = edge[key];
        const i = tsRow.get(name);
        const got = { states: defaultsTs.replicates.map((r) => r.state[i]), points: defaultsTs.replicates.map((r) => r.points[i]), flags: ct.flags[i] };
        const ok = JSON.stringify(got) === JSON.stringify({ states, points, flags }) && !ct.reason[i] && Number.isFinite(ct.score[i]);
        check('scoring', `time-series edge case: ${what} (${name})`, `scored ${fmt(ct.score[i])} ± ${fmt(ct.se[i])}; states ${got.states.join(',')}; points ${got.points.join(',')}; flags ${got.flags}`, ok, `states ${states.join(',')}, points ${points.join(',')}, flags ${flags}`);
      }
      {
        const i = tsRow.get(edge.notALine);
        const fits = defaultsTs.replicates.map((r) => r.fit[i]);
        const typical = median(defaultsTs.replicates.flatMap((r) => [...r.fit].filter((x, j) => Number.isFinite(x) && j !== i)));
        check('scoring', `time-series edge case: a trajectory that rises then falls (${edge.notALine}) is scored, not flagged, and its departure from a line reported`, `χ²/(n − 2) ${fits.map((x) => fmt(x, 0)).join(', ')} (typical variant ${fmt(typical, 2)}); flags ${ct.flags[i]}`, fits.every((x) => x > 50 * typical) && !ct.reason[i] && ct.flags[i] === 0, 'scored; departure ≫ typical');
      }
      {
        // A table that writes dropouts as missing: with the later samples' missing read as 0, the
        // dropout variant uses every time point. Weighted regression gives zero counts little
        // weight, so its score moves little; the log ratio, which needs the last sample, cannot
        // score it at all until its missing counts are read as 0.
        const zeroDesign = { ...tsDesign, samples: tsDesign.samples.map((x) => (/gen(6|10)$/.test(x.id) ? { ...x, missingMeansZero: true } : x)) };
        const zero = score(ts, zeroDesign, { ...DEFAULT_PARAMETERS, model: 'wls' });
        const i = tsRow.get(edge.dropout);
        const ratioMissing = score(ts, tsDesign, DEFAULT_PARAMETERS).conditions[0];
        const ratioZero = score(ts, zeroDesign, DEFAULT_PARAMETERS).conditions[0];
        check('scoring', `missing read as 0 in the samples after selection (the design's missingMeansZero), for the dropout ${edge.dropout}: regression uses every time point; the log ratio scores it instead of leaving it out`, `WLS ${fmt(ct.score[i])} on 3 points → ${fmt(zero.conditions[0].score[i])} on ${zero.replicates.map((r) => r.points[i]).join(',')}; ratio ${ratioMissing.reason[i] ? STAGE_BY_CODE.get(ratioMissing.reason[i]).id : fmt(ratioMissing.score[i])} → ${fmt(ratioZero.score[i])}; ${zero.info.filter((x) => /read as 0/.test(x)).length} notes in the run`, zero.replicates.every((r) => r.points[i] === 5) && zero.conditions[0].score[i] < ct.score[i] && ratioMissing.reason[i] === STAGE_BY_ID.get('measured').code && Number.isFinite(ratioZero.score[i]) && zero.info.some((x) => /read as 0/.test(x)), 'every point, lower; measured → scored');
      }
      {
        // Enrich2's conventions: every time point required.
        const e = score(ts, tsDesign, { ...PRESETS.enrich2.parameters, model: 'wls' });
        const at = (key) => tsRow.get(edge[key]);
        const states = ['laterMissing', 'dropout'].map((key) => e.replicates[0].state[at(key)]);
        check('scoring', 'Enrich2-compatible regression: a variant missing at any time point is not scored in that replicate', `replicate 1: ${states.map((x) => REPLICATE_STATE_NAMES[x]).join('; ')}`, states.every((x) => x === REPLICATE_STATE.FEW_POINTS), 'counted at too few time points');
      }
      {
        // Against the simulated truth: the slopes, and how often their 95% intervals hold it.
        const truth = timeSeriesTruth();
        const planted = new Set(Object.values(edge));
        const coverage = (results) => {
          let replicate = 0;
          let replicateN = 0;
          for (const rep of results.replicates) {
            results.variants.key.forEach((key, i) => {
              if (rep.state[i] || planted.has(key) || !truth.has(key)) return;
              replicateN += 1;
              if (Math.abs(rep.score[i] - truth.get(key)) < 1.959964 * rep.se[i]) replicate += 1;
            });
          }
          const c = results.conditions[0];
          let combined = 0;
          let combinedN = 0;
          const a = [];
          const b = [];
          results.variants.key.forEach((key, i) => {
            if (c.reason[i] || planted.has(key) || !truth.has(key) || key === 'p.=') return;
            combinedN += 1;
            a.push(c.score[i]);
            b.push(truth.get(key));
            // Each score's own interval: t with its degrees of freedom when moderated.
            const q = c.df ? (Number.isFinite(c.df[i]) ? tQuantile(0.975, c.df[i]) : 1.959964) : 1.959964;
            if (Math.abs(c.score[i] - truth.get(key)) < q * c.se[i]) combined += 1;
          });
          return { replicate: replicate / replicateN, combined: combined / combinedN, r: pearson(a, b) };
        };
        const floor = coverage(score(ts, tsDesign, { ...DEFAULT_PARAMETERS, model: 'wls', combination: 'reml' }));
        const resid = coverage(score(ts, tsDesign, { ...DEFAULT_PARAMETERS, model: 'wls', regressionSE: 'residual', combination: 'reml' }));
        const moderatedTs = coverage(defaultsTs);
        check('scoring', 'time series against the simulated truth: weighted-regression slopes track the true effects', `Pearson r ${floor.r.toFixed(4)}`, floor.r >= 0.995, '≥ 0.995');
        check('scoring', 'time series against the simulated truth: 95% intervals with the counting floor hold the true slope more often than with Enrich2\'s residual-scaled SE, per replicate and combined by REML; the moderated combination (the default), which models the noise beyond counting across variants, holds it more often still', `replicates ${(100 * floor.replicate).toFixed(0)}% against ${(100 * resid.replicate).toFixed(0)}%; combined by REML ${(100 * floor.combined).toFixed(0)}% against ${(100 * resid.combined).toFixed(0)}%; moderated ${(100 * moderatedTs.combined).toFixed(1)}%`, floor.replicate >= resid.replicate + 0.1 && floor.combined >= resid.combined && moderatedTs.combined > floor.combined && moderatedTs.combined >= 0.9, 'floor higher by ≥ 10 points per replicate; moderated ≥ 90% (one data set)');
      }
      {
        // Refusals: regression where it cannot be done, said why.
        const refusals = [
          ['a regression on a two-population design', scoreExperiment({ ...engineInput(fixture, design), parameters: { ...DEFAULT_PARAMETERS, model: 'wls' } }), /time series/],
          ['a regression with a replicate of two time points', scoreExperiment({ ...engineInput(ts, { ...tsDesign, replicates: tsDesign.replicates.map((r, k) => (k ? r : { ...r, timepoints: r.timepoints.slice(0, 2) })) }), parameters: { ...DEFAULT_PARAMETERS, model: 'wls' } }), /three or more time points/],
          ['a minimum of two time points', scoreExperiment({ ...engineInput(ts, tsDesign), parameters: { ...DEFAULT_PARAMETERS, model: 'wls', filters: { ...DEFAULT_PARAMETERS.filters, minTimePoints: 2 } } }), /3 or more/],
        ];
        for (const [what, out, pattern] of refusals) check('scoring', `refused: ${what}, with the reason`, out.ok ? 'scored anyway' : out.errors[0], !out.ok && pattern.test(out.errors.join(' ')), 'refused');
        const defaults = defaultParameters(tsDesign);
        check('scoring', 'a time series of three or more time points starts from weighted regression; a two-population experiment from the log ratio', `${defaults.model}; ${defaultParameters(design).model}`, defaults.model === 'wls' && defaultParameters(design).model === 'ratio', 'wls; ratio');
        // Scores per unit of time (wave 2, slice 10): a regression's slope on time itself, the ratio
        // of the ends over the time between them; the whole time course stays the default.
        {
          const span = Math.max(...tsDesign.replicates.flatMap((r) => r.timepoints.map((t) => t.time)));
          const worst = { score: 0, se: 0 };
          for (const model of ['wls', 'ols', 'ratio']) {
            const course = score(ts, tsDesign, { ...DEFAULT_PARAMETERS, model });
            const unit = score(ts, tsDesign, { ...DEFAULT_PARAMETERS, model, timeScale: 'unit' });
            for (let i = 0; i < course.rows; i += 1) {
              for (let k = 0; k < course.replicates.length; k += 1) {
                const [a, b] = [course.replicates[k], unit.replicates[k]];
                if (!Number.isFinite(a.score[i])) continue;
                const t = a.times.at(-1) - (model === 'ratio' ? a.times[0] : 0);
                worst.score = Math.max(worst.score, Math.abs(b.score[i] * t - a.score[i]) / Math.max(1, Math.abs(a.score[i])));
                worst.se = Math.max(worst.se, Math.abs(b.se[i] * t - a.se[i]) / a.se[i]);
              }
            }
          }
          const twoPopulation = scoreExperiment({ ...engineInput(fixture, design), parameters: { ...DEFAULT_PARAMETERS, timeScale: 'unit' } });
          check('scoring', 'scores per unit of time (per generation with times in generations): each replicate\'s slope on time itself, and the ratio of the ends over the time between them, are the whole-course scores over the time span (WLS, OLS, ratio)', `scores within ${worst.score.toExponential(1)}, SEs within ${worst.se.toExponential(1)} (span ${span}); a two-population design ${twoPopulation.ok ? 'scored anyway' : 'refused'}; the default ${DEFAULT_PARAMETERS.timeScale}`, worst.score <= 1e-12 && worst.se <= 1e-12 && !twoPopulation.ok && DEFAULT_PARAMETERS.timeScale === 'course', '≤ 1e-12; refused; course');
        }
      }
    }

    // dms_variants' func_scores (natural logarithms) on the fixture, replicate by replicate.
    {
      const results = score(fixture, design, { ...DEFAULT_PARAMETERS, normalization: 'wt' });
      const names = fixture.columns.find((c) => c.name === 'hgvs_pro').values;
      const pairs = [];
      let oneSide = 0;
      for (const rep of results.replicates) {
        const theirs = dmsv.replicates[rep.id];
        dmsv.variants.forEach((name, j) => {
          const i = names.indexOf(name);
          const mine = Number.isFinite(rep.score[i]);
          if (mine !== (theirs.score[j] !== null)) {
            oneSide += 1;
            return;
          }
          if (mine) pairs.push([`${rep.id} ${name}`, rep.score[i], theirs.score[j]], [`${rep.id} ${name} variance`, rep.se[i] ** 2, theirs.var[j]]);
        });
      }
      const d = worstDifference(pairs);
      check('scoring', `fixture: each replicate's scores and variances equal dms_variants ${dmsv.versions.dms_variants} func_scores (wild-type ratios, natural log; ${pairs.length / 2} values)`, `${d.worst.toExponential(2)} (${d.where})${oneSide ? `; ${oneSide} by one side only` : ''}`, d.worst <= 1e-10 && !oneSide, '≤ 1e-10 relative');
    }

    // REML and fixed effects against metafor, on Enrich2's replicate scores (from enrich2.json, in
    // its replicates' order) and on synthetic sets.
    for (const c of metafor.cases) {
      let inputs = null;
      if (c.name !== 'synthetic') {
        const [caseName, method] = c.name.split(' ');
        const entry = enrich2.cases[caseName];
        const reps = Object.values(entry.methods[method].replicates);
        const index = new Map(entry.variants.map((v, i) => [v, i]));
        inputs = (name) => {
          const i = index.get(name);
          const y = [];
          const v = [];
          for (const r of reps) {
            if (r.score[i] === null || r.se[i] === null) continue;
            y.push(r.score[i]);
            v.push(r.se[i] ** 2);
          }
          return { y, v };
        };
      }
      const reml = [];
      const fixed = [];
      const q = [];
      let atZero = 0;
      let iterations = 0;
      for (const set of c.sets) {
        const { y, v } = inputs ? inputs(set.name) : set;
        const m = combineREML(y, v);
        iterations = Math.max(iterations, m.iterations);
        if (set.reml.tau2 === 0) atZero += 1;
        reml.push([`${set.name}`, m.estimate, set.reml.estimate], [`${set.name} SE`, m.se, set.reml.se], [`${set.name} τ²`, m.tau2, set.reml.tau2]);
        const f = combineFixed(y, v);
        fixed.push([set.name, f.estimate, set.fixed.estimate], [`${set.name} SE`, f.se, set.fixed.se]);
        q.push([set.name, heterogeneity(y, v).q, set.reml.q]);
      }
      const d = worstDifference(reml);
      check('scoring', `${c.name}: REML random effects equal metafor ${metafor.versions.metafor} rma(method = "REML") (${c.sets.length} variants, τ² = 0 in ${atZero}; at most ${iterations} Fisher-scoring steps)`, `${d.worst.toExponential(2)} (${d.where})`, d.worst <= 1e-6, '≤ 1e-6 relative');
      const df = worstDifference(fixed);
      const dq = worstDifference(q);
      check('scoring', `${c.name}: fixed effects and Cochran's Q equal metafor's (method = "EE")`, `estimates and SEs ${df.worst.toExponential(2)}, Q ${dq.worst.toExponential(2)}`, df.worst <= 1e-10 && dq.worst <= 1e-10, '≤ 1e-10 relative');
    }
    // Where Enrich2's 50 iterations converged, its estimator is REML (research.md §2.1).
    {
      const entry = enrich2.cases['grb2-sh3'];
      const combined = entry.methods['ratios/wt'].combined.all;
      const reference = new Map(metafor.cases[0].sets.map((s) => [s.name, s.reml.estimate]));
      const pairs = [];
      entry.variants.forEach((name, i) => {
        if (combined.epsilon[i] === 0 && reference.has(name) && name !== 'p.=') pairs.push([name, combined.score[i], reference.get(name)]);
      });
      const d = worstDifference(pairs);
      check('scoring', `GRB2: Enrich2's combined scores where its estimator converged (epsilon 0) equal metafor's REML (${pairs.length} variants)`, `${d.worst.toExponential(2)} (${d.where})`, d.worst <= 1e-8 && pairs.length > 0, '≤ 1e-8 relative');
    }

    // Sorted bins (wave 2, slice 3): the sort-seq fixture against fitdistrplus and its truth.
    {
      const ss = sortSeqTable();
      const ssDesign = sortSeqDesign();
      const ssNames = ss.columns[0].values;
      const fitdist = JSON.parse(readFileSync(new URL('./reference/fitdistcens.json', import.meta.url), 'utf8'));
      for (const kind of ['free', 'fixed']) {
        const pairs = [];
        const sePairs = [];
        let oneSide = 0;
        for (const replicate of ssDesign.replicates) {
          const { counts, lo, hi } = replicateBins(ss, ssDesign, replicate);
          const ref = fitdist.replicates[replicate.id];
          ssNames.forEach((name, i) => {
            const fit = binMLE(counts.map((c) => c[i]), lo, hi, kind === 'free' ? null : ref.wildTypeSdlog);
            const theirs = ref[kind][name];
            if (fit.estimable !== Boolean(theirs)) {
              if (counts.some((c) => c[i] > 0)) oneSide += 1;
              return;
            }
            if (!theirs) return;
            pairs.push([`${replicate.id} ${name} μ`, fit.mu, theirs[0]], [`${replicate.id} ${name} σ`, fit.sigma, theirs[1]]);
            sePairs.push([`${replicate.id} ${name} SE`, fit.se, theirs[2]]);
          });
        }
        const d = worstDifference(pairs);
        const dse = sePairs.reduce((a, [, x, y]) => Math.max(a, Math.abs(x - y) / y), 0);
        check('scoring', `sorted bins, maximum likelihood ${kind === 'free' ? 'with each variant\'s own σ' : 'with the wild type\'s σ'}: μ and σ equal fitdistrplus ${fitdist.versions.fitdistrplus} fitdistcens on the sort-seq fixture (${pairs.length / 2} fits)`, `${d.worst.toExponential(2)} (${d.where}); SE of μ within ${dse.toExponential(2)} relative${oneSide ? `; ${oneSide} estimable by one side only` : ''}`, d.worst <= 1e-5 && dse <= 2e-3 && !oneSide && pairs.length > 0, '≤ 1e-5 (μ, σ), ≤ 2e-3 relative (SE), the same variants');
      }
      const truth = sortSeqTruth();
      const base = defaultParameters(ssDesign);
      const against = (results) => {
        const c = results.conditions[0];
        const wt = results.variants.original.indexOf('p.=');
        const a = [];
        const b = [];
        let covered = 0;
        results.variants.original.forEach((name, i) => {
          if (c.reason[i] || name === 'p.=') return;
          a.push(c.score[i]);
          b.push(truth.get(name));
          if (Math.abs(c.score[i] - c.score[wt] - truth.get(name)) < 1.959964 * c.se[i]) covered += 1;
        });
        return { r: pearson(a, b), coverage: covered / a.length, n: a.length };
      };
      const average = against(score(ss, ssDesign, { ...base, binScale: 'none' }));
      const mle = against(score(ss, ssDesign, { ...base, model: 'bins-mle', binScale: 'none' }));
      check('scoring', 'sorted bins against the simulated truth: the maximum-likelihood μ tracks the true shifts in log fluorescence more closely than the weighted average does', `MLE r ${mle.r.toFixed(4)}, weighted average r ${average.r.toFixed(4)} (${mle.n} variants)`, mle.r >= 0.99 && average.r >= 0.98 && mle.r > average.r, 'MLE ≥ 0.99 > average ≥ 0.98');
      check('scoring', 'sorted bins against the simulated truth: the MLE\'s 95% intervals, its information limited by the cells sorted (fewer than the reads here), hold the true shift', `${(100 * mle.coverage).toFixed(0)}% after combining replicates (the rest: the replicate noise planted)`, mle.coverage >= 0.85, '≥ 85%');
      const analytic = score(ss, ssDesign, base);
      const boot = score(ss, ssDesign, { ...base, binSE: 'bootstrap' });
      const bootAgain = score(ss, ssDesign, { ...base, binSE: 'bootstrap' });
      const bootOther = score(ss, ssDesign, { ...base, binSE: 'bootstrap', seed: 7 });
      const ratios = [];
      analytic.replicates.forEach((r, k) => r.se.forEach((x, i) => {
        const y = boot.replicates[k].se[i];
        if (r.state[i] === REPLICATE_STATE.USED && x > 0 && Number.isFinite(y)) ratios.push(y / x);
      }));
      const mid = median(ratios);
      check('scoring', 'sorted bins: the seeded bootstrap\'s SEs equal the analytic (delta-method) SEs, the same for a seed and not for another', `median bootstrap ÷ analytic ${mid.toFixed(3)} over ${ratios.length} measurements; ${outputDigest(boot) === outputDigest(bootAgain) ? 'repeatable' : 'NOT repeatable'}; seed 7 ${outputDigest(bootOther) === outputDigest(boot) ? 'the same' : 'differs'}`, Math.abs(mid - 1) < 0.03 && outputDigest(boot) === outputDigest(bootAgain) && outputDigest(bootOther) !== outputDigest(boot), 'within 3%; repeatable');
      // Each replicate's scale: nonsense median 0 and wild type 1 (VAMP-seq).
      const scaled = score(ss, ssDesign, base);
      const kinds = scaled.variants.kind;
      const worstAnchor = scaled.replicates.reduce((a, r) => {
        const non = [];
        r.score.forEach((x, i) => { if (r.state[i] === REPLICATE_STATE.USED && kinds[i] === 4) non.push(x); });
        return Math.max(a, Math.abs(median(non)), Math.abs(r.score[scaled.controls.wt] - 1));
      }, 0);
      check('scoring', 'sorted bins scaled as VAMP-seq: in every replicate the nonsense median scores 0 and the wild type 1', `largest departure ${worstAnchor.toExponential(2)}`, worstAnchor <= 1e-12, '≤ 1e-12');
      // The defaults follow what the table and the design hold (wave 2, slice 10): without the wild
      // type both scales are refused, so the bins start unscaled (and an MLE's σ each variant's
      // own); with the nonsense controls named none, the lowest 5%.
      {
        const noWildType = defaultParameters(ssDesign, { summary: { byKind: { nonsense: 20, missense: 500 } } });
        const noNonsense = defaultParameters({ ...ssDesign, controls: { ...ssDesign.controls, nonsense: 'none' } }, { summary: { byKind: { 'wild type': 1, nonsense: 20 } } });
        check('scoring', 'sorted bins\' defaults follow the table and the design: unscaled without the wild type, the lowest 5% with the nonsense controls named none', `${noWildType.binScale} (σ ${noWildType.binSigma}); ${noNonsense.binScale}`, noWildType.binScale === 'none' && noWildType.binSigma === 'per-variant' && noNonsense.binScale === 'low5-wt', 'none (per-variant); low5-wt');
      }
      // Refusals: bins where they cannot be scored as asked.
      const refusals = [
        ['sorted bins scored as a selection', scoreExperiment({ ...engineInput(ss, ssDesign), parameters: DEFAULT_PARAMETERS }), /weighted average/],
        ['the maximum-likelihood fit without gates', scoreExperiment({ ...engineInput(ss, { ...ssDesign, replicates: ssDesign.replicates.map((r) => ({ ...r, bins: r.bins.map(({ lower, upper, ...b }) => b) })) }), parameters: { ...base, model: 'bins-mle' } }), /gates/],
        ['a weighted average of bins on a two-population design', scoreExperiment({ ...engineInput(fixture, design), parameters: { ...DEFAULT_PARAMETERS, model: 'bins' } }), /sorted bins/],
      ];
      for (const [what, out, pattern] of refusals) check('scoring', `refused: ${what}, with the reason`, out.ok ? 'scored anyway' : out.errors[0], !out.ok && pattern.test(out.errors.join(' ')), 'refused');
    }

    // Barcodes (wave 2, slice 4): the barcode fixture, its map applied, against dms_variants by
    // barcode and by substitution, through MaveScape's own map and through dms_variants' layout;
    // and against the fixture's truth.
    {
      const dmsb = JSON.parse(readFileSync(new URL('./reference/dms_variants-barcodes.json', import.meta.url), 'utf8'));
      const { table: bt, applied } = barcodeTable();
      const btDesign = barcodeDesign();
      const schemaProblems = checkSchema(JSON.parse(readFileSync(new URL('../docs/schemas/design.v1.json', import.meta.url), 'utf8')), btDesign);
      const btValid = validateDesign(btDesign, { columns: bt.columns.map((c) => c.name) });
      check('scoring', 'barcode fixture: its design (a table of barcodes) satisfies the schema and fits the counts with the map applied', [...schemaProblems, ...btValid.errors.map((e) => `${e.path}: ${e.message}`)].slice(0, 3).join('; ') || 'yes', !schemaProblems.length && btValid.ok, 'no problems');
      const truth = barcodeTruth();
      const planted = [...truth.barcodes.values()];
      const conflicts = planted.filter((b) => b.map === 'conflict').length;
      const missing = planted.filter((b) => b.map === 'missing').length;
      check('scoring', 'barcode fixture: the map applied, every barcode it gives two variants left unmapped and listed, every barcode it does not name unmapped', `${applied.mapped} mapped; ${applied.conflicts.length} in conflict, ${applied.unmapped.length} not in the map (dms_variants' table left out ${dmsb.left_out.conflicts} and ${dmsb.left_out.unmapped})`, applied.conflicts.length === conflicts && applied.unmapped.length === missing && conflicts === dmsb.left_out.conflicts && missing === dmsb.left_out.unmapped, `${conflicts} and ${missing}, as planted`);
      // Each barcode's score and variance against func_scores by barcode, and each variant's summed
      // counts against func_scores by aa_substitutions (the empty substitution, the wild type with
      // the synonymous variants, is one group there and not here).
      const againstDms = (table, design, label) => {
        const byBarcode = score(table, design, { ...DEFAULT_PARAMETERS, aggregation: 'barcode' });
        const summed = score(table, design, DEFAULT_PARAMETERS);
        const rowOf = new Map(byBarcode.barcodes.ids.map((id, r) => [id, r]));
        const pairs = [];
        const sums = [];
        let oneSide = 0;
        let compared = 0;
        for (const rep of byBarcode.replicates) {
          const theirs = dmsb.barcode[rep.id];
          const seen = new Set();
          theirs.barcode.forEach((id, j) => {
            const r = rowOf.get(id);
            seen.add(r);
            if (r === undefined || !Number.isFinite(rep.barcodes.score[r])) {
              oneSide += 1;
              return;
            }
            pairs.push([`${rep.id} ${id}`, rep.barcodes.score[r], theirs.score[j]], [`${rep.id} ${id} variance`, rep.barcodes.se[r] ** 2, theirs.var[j]]);
          });
          rep.barcodes.score.forEach((x, r) => {
            if (Number.isFinite(x) && !seen.has(r)) oneSide += 1;
          });
          const sub = dmsb.substitution[rep.id];
          const mine = summed.replicates.find((x) => x.id === rep.id);
          const variantRow = new Map(summed.variants.original.map((name, i) => [name, i]));
          sub.aa_substitutions.forEach((aa, j) => {
            if (!aa) return;
            const i = variantRow.get(dmsVariantsName(aa));
            if (i === undefined || !Number.isFinite(mine.score[i])) {
              oneSide += 1;
              return;
            }
            compared += 1;
            sums.push([`${rep.id} ${aa}`, mine.score[i], sub.score[j]], [`${rep.id} ${aa} variance`, mine.se[i] ** 2, sub.var[j]], [`${rep.id} ${aa} reads before`, mine.first[i], sub.pre_count[j]], [`${rep.id} ${aa} reads after`, mine.last[i], sub.post_count[j]]);
          });
        }
        const d = worstDifference(pairs);
        const s = worstDifference(sums);
        check('scoring', `${label}: each barcode's score and variance equal dms_variants ${dmsb.versions.dms_variants} func_scores by barcode (${pairs.length / 2} barcodes in ${byBarcode.replicates.length} libraries)`, `${d.worst.toExponential(2)} (${d.where})${oneSide ? `; ${oneSide} by one side only` : ''}`, d.worst <= 1e-10 && !oneSide && pairs.length > 0, '≤ 1e-10 relative, the same barcodes');
        check('scoring', `${label}: each variant's counts summed over its barcodes, and its score and variance from them, equal func_scores by aa_substitutions (${compared} variants)`, `${s.worst.toExponential(2)} (${s.where})`, s.worst <= 1e-10 && compared > 0 && !oneSide, '≤ 1e-10 relative');
        return { byBarcode, summed };
      };
      const own = againstDms(bt, btDesign, 'barcode fixture with its map');
      const dv = dmsVariantsTable();
      check('scoring', 'dms_variants\' variant_counts imported: one row per library and barcode, a count column per library and sample, every substitution named in MAVE-HGVS', `${dv.long.rows} rows → ${dv.pivot.table.rows} barcodes × ${dv.pivot.samples.length} samples; ${dv.pivot.problems.filter((p) => p.level !== 'info').length} problems`, dv.pivot.table.rows === applied.mapped && dv.pivot.samples.length === 4 && !dv.pivot.problems.some((p) => p.level !== 'info'), `${applied.mapped} barcodes, 4 samples, no problems`);
      const imported = againstDms(dv.pivot.table, dv.design, 'dms_variants\' variant_counts imported');
      const sameScores = (a, b) => {
        const index = new Map(b.variants.key.map((k, i) => [k, i]));
        let differ = 0;
        a.variants.key.forEach((k, i) => {
          const j = index.get(k);
          const x = a.conditions[0].score[i];
          const y = b.conditions[0].score[j];
          if (!(x === y || (Number.isNaN(x) && Number.isNaN(y)))) differ += 1;
        });
        return differ;
      };
      check('scoring', 'the same counts read through MaveScape\'s map and through dms_variants\' layout give the same combined scores, both aggregations', `${sameScores(own.summed, imported.summed)} and ${sameScores(own.byBarcode, imported.byBarcode)} variants differ`, sameScores(own.summed, imported.summed) === 0 && sameScores(own.byBarcode, imported.byBarcode) === 0, 'none');
      // Enrich2's layout: a counts file per sample, and its map of variant sequences, named against
      // the target.
      const e2 = assembleTable(enrich2Files().map((f) => ({ name: f.name, table: parseTable(f.text, { fileName: f.name }), role: f.role })), { level: 'protein', target: btDesign.targets[0] });
      const e2Layout = detectLayout(e2.table);
      const e2Design = { ...btDesign, variants: { column: e2Layout.variantColumn, level: 'protein' } };
      const e2Summed = score(e2.table, e2Design, DEFAULT_PARAMETERS);
      const e2ByBarcode = score(e2.table, e2Design, { ...DEFAULT_PARAMETERS, aggregation: 'barcode' });
      check('scoring', 'Enrich2\'s layout imported (a counts file per sample, its headerless map of variant sequences named against the target): the same barcodes, conflicts and combined scores, both aggregations', `${e2.kind}, ${e2.table.rows} barcodes, variants in "${e2Layout.variantColumn}", ${e2.map.conflicts.length} in conflict; ${sameScores(own.summed, e2Summed)} and ${sameScores(own.byBarcode, e2ByBarcode)} variants differ`, e2.kind === 'enrich2' && e2Layout.layout === 'barcodes' && e2.map.conflicts.length === applied.conflicts.length && sameScores(own.summed, e2Summed) === 0 && sameScores(own.byBarcode, e2ByBarcode) === 0 && e2Summed.rows === own.summed.rows, 'the same');
      // Against the truth: the aggregations, the barcode filter, and the outliers planted.
      const against = (results) => {
        const c = results.conditions[0];
        const a = [];
        const b = [];
        let covered = 0;
        results.variants.original.forEach((name, i) => {
          if (c.reason[i]) return;
          a.push(c.score[i]);
          b.push(truth.effects.get(name));
          if (Math.abs(c.score[i] - truth.effects.get(name)) < 1.959964 * c.se[i]) covered += 1;
        });
        return { r: pearson(a, b), coverage: covered / a.length, n: a.length };
      };
      const sum = against(own.summed);
      const reml = against(own.byBarcode);
      const filtered = against(score(bt, btDesign, { ...DEFAULT_PARAMETERS, filters: { ...DEFAULT_PARAMETERS.filters, maxBarcodeZ: 4 } }));
      check('scoring', 'barcode fixture against its truth: each barcode scored and combined by REML tracks the true effects more closely than the sums, and the barcode filter improves the sums', `by barcode r ${reml.r.toFixed(4)}; summed r ${sum.r.toFixed(4)}, ${filtered.r.toFixed(4)} with outliers left out (${reml.n} variants)`, reml.r >= 0.985 && reml.r > sum.r && filtered.r > sum.r, 'by barcode ≥ 0.985, above the sums; filtered above unfiltered');
      check('scoring', 'barcode fixture: 95% intervals of the scores combined by barcode (REML) hold the true effects', `${(100 * reml.coverage).toFixed(1)}% (summed: ${(100 * sum.coverage).toFixed(1)}%)`, reml.coverage >= 0.92, '≥ 92%');
      let found = 0;
      let off = 0;
      let falsePositives = 0;
      let clean = 0;
      for (const rep of own.byBarcode.replicates) {
        own.byBarcode.barcodes.ids.forEach((id, r) => {
          if (Number.isNaN(rep.barcodes.z[r])) return;
          if (truth.barcodes.get(id).shift !== 0) {
            off += 1;
            if (rep.barcodes.outlier[r]) found += 1;
          } else {
            clean += 1;
            if (rep.barcodes.outlier[r]) falsePositives += 1;
          }
        });
      }
      check('scoring', 'outlier barcodes (beyond 4 in z/√φ, set aside one at a time): the barcodes planted 1.5–3 off their variant found, few others', `${found} of ${off} planted found; ${falsePositives} of ${clean} others called (${(100 * falsePositives / clean).toFixed(2)}%)`, found / off >= 0.7 && falsePositives / clean <= 0.002, '≥ 70% found, ≤ 0.2% others');
      // Row order: the same scores, bit for bit, both aggregations.
      const shuffled = shuffledTable(bt, createRandom(41));
      const reordered = [sameScores(own.summed, score(shuffled, btDesign, DEFAULT_PARAMETERS)), sameScores(own.byBarcode, score(shuffled, btDesign, { ...DEFAULT_PARAMETERS, aggregation: 'barcode' }))];
      check('scoring', 'barcode fixture with its rows and columns shuffled: the same combined scores, bit for bit, summed and by barcode', `${reordered[0]} and ${reordered[1]} variants differ`, reordered[0] === 0 && reordered[1] === 0, 'none');
      // DiMSum's model on a table of barcodes, summed first (wave 2, slice 10: it crashed).
      const dimsumBarcodes = scoreExperiment({ ...engineInput(bt, btDesign), parameters: { ...DEFAULT_PARAMETERS, model: 'dimsum' } });
      check('scoring', 'DiMSum\'s model on a table of barcodes: the barcodes summed per variant, then scored', dimsumBarcodes.ok ? `${dimsumBarcodes.results.conditions[0].scored} variants scored; ${dimsumBarcodes.results.info.find((x) => /barcodes of/.test(x))}` : dimsumBarcodes.errors.join(' '), dimsumBarcodes.ok && dimsumBarcodes.results.conditions[0].scored > 0, 'scored');
      const ids = engineInput(bt, btDesign);
      const refusals = [
        ['a barcode on two rows', scoreExperiment({ ...ids, barcodes: ids.barcodes.map((x, i) => (i === 5 ? ids.barcodes[0] : x)), parameters: DEFAULT_PARAMETERS }), /more than one row/],
        ['scoring each barcode of a table of variants', scoreExperiment({ ...engineInput(fixture, design), parameters: { ...DEFAULT_PARAMETERS, aggregation: 'barcode' } }), /table of barcodes/],
        ['scoring each barcode of sorted bins', scoreExperiment({ ...ids, design: { ...btDesign, model: 'bins' }, parameters: { ...DEFAULT_PARAMETERS, model: 'bins', aggregation: 'barcode' } }), /summed/],
      ];
      for (const [what, out, pattern] of refusals) check('scoring', `refused: ${what}, with the reason`, out.ok ? 'scored anyway' : out.errors[0], !out.ok && pattern.test(out.errors.join(' ')), 'refused');
    }

    // DiMSum's fitness and error model (wave 2, slice 5): MaveScape's against DiMSum 1.4's own R
    // functions (reference/dimsum.json) on the fixture (GRB2 and DiMSum's demo below, external).
    const dimsumRef = dimsumReference();
    const againstDimsum = (label, c, ref) => {
      const d = compareDimsum(c, ref);
      check('scoring', `DiMSum on ${label}: the input threshold and the variants fitted are DiMSum's`, `threshold within ${d.threshold.toExponential(1)} relative; ${d.fitted[0]} variants fitted, DiMSum ${d.fitted[1]}${d.refused ? `; refused: ${d.refused}` : ''}`, !d.refused && d.threshold <= 1e-14 && d.fitted[0] === d.fitted[1], '≤ 1e-14; the same');
      const n = d.normalisation;
      check('scoring', `DiMSum on ${label}: each replicate's scale and shift at DiMSum's minimum (nlm${n.code === 1 ? '' : `, which stopped with its code ${n.code}`}), the minimum never above nlm's`, `within ${n.difference.toExponential(2)}; minimum ${n.minimum.toPrecision(13)}, nlm's ${n.nlm.toPrecision(13)}`, n.difference <= 5e-4 && n.minimum <= n.nlm * (1 + 1e-12), '≤ 5e-4; not above');
      check('scoring', `DiMSum on ${label}: the error model fitted on every variant equals DiMSum's own fit of it (nls, port) and lies within the 10th–90th percentiles of DiMSum's 100 bootstrap fits`, `within ${d.fullFit.toExponential(2)} relative; ${d.inside[0]} of ${d.inside[1]} terms inside DiMSum's percentiles`, d.fullFit <= 2e-5 && d.inside[0] === d.inside[1], '≤ 2e-5; all inside');
      for (const [key, s] of Object.entries(d.scored)) {
        check('scoring', `DiMSum on ${label}${key === 'dropout' ? `, with a dropout pseudocount of ${ref.dropout.pseudocount}` : ''}: with DiMSum's parameters, each variant's fitness and sigma in each replicate equal dimsum__calculate_fitness's, and merged by inverse variance its merge (${s.values} values of ${s.variants} variants)`, `${s.worst.toExponential(2)} (${s.where}); merged ${s.merged.toExponential(2)}${s.oneSide ? `; ${s.oneSide} by one side only` : ''}`, s.worst <= 1e-10 && s.merged <= 1e-10 && !s.oneSide && s.values > 0, '≤ 1e-10 relative, the same values');
      }
    };
    againstDimsum('the fixture', fixtureCase(), dimsumRef.cases.fixture);
    {
      // The engine with the DiMSum-compatible preset: the experiment fitted once, replicates
      // combined by inverse variance, every zero count unscored.
      const dsDesign = design;
      const dsRun = score(fixture, dsDesign, defaultParameters(dsDesign, null, 'dimsum'));
      const direct = fixtureCase();
      const group = scoreDimsumGroup({ inputs: direct.inputs, outputs: direct.outputs, wtRow: direct.wtRow, substitutions: direct.substitutions, options: { random: null, samples: 0 } });
      let differ = 0;
      dsRun.replicates.forEach((r, j) => r.score.forEach((x, i) => {
        const y = group.score[j][i];
        if (!(x === y || (Number.isNaN(x) && Number.isNaN(y)))) differ += 1;
      }));
      const zeros = dsRun.replicates.reduce((a, r) => a + r.state.reduce((x, s, i) => x + (s === REPLICATE_STATE.NOT_ESTIMABLE && (r.first[i] === 0 || r.last[i] === 0) ? 1 : 0), 0), 0);
      check('scoring', 'DiMSum through the engine (the DiMSum-compatible preset): the same scores as the experiment fitted directly, and every measurement with a zero count left unscored, with its reason', `${differ} replicate scores differ; ${zeros} zero-count measurements not estimable; terms ${dsRun.replicates.map((r) => `${r.name} ${r.dimsum.input.toFixed(2)}/${r.dimsum.output.toFixed(2)}`).join(', ')}`, differ === 0 && zeros > 0 && dsRun.parameters.combination === 'fixed', 'none differ');
      const refusals = [
        ['DiMSum on a time series', scoreExperiment({ ...engineInput(timeSeriesTable(), timeSeriesDesign()), parameters: { ...DEFAULT_PARAMETERS, model: 'dimsum' } }), /input and an output/],
        ['DiMSum scoring each barcode', scoreExperiment({ ...engineInput(barcodeTable().table, barcodeDesign()), parameters: { ...DEFAULT_PARAMETERS, model: 'dimsum', aggregation: 'barcode' } }), /sum each variant/],
      ];
      for (const [what, out, pattern] of refusals) check('scoring', `refused: ${what}, with the reason`, out.ok ? 'scored anyway' : out.errors[0], !out.ok && pattern.test(out.errors.join(' ')), 'refused');
      // A bottleneck: DiMSum's error model puts it into each variant's SE.
      const coverage = (parameters) => QC_SEEDS.map((seed) => {
        const sim = simulateExperiment({ seed, inputCells: 25 });
        const t = parseTable(sim.csv);
        const r = scoreExperiment({ names: columnText(t.columns[0]), columns: Object.fromEntries(t.columns.slice(1).map((c) => [c.name, c.numeric])), design: sim.design, parameters: { ...withDefaults(parameters) } }).results;
        const truth = new Map(sim.variants.map((v) => [v.name, v.effect]));
        let k = 0;
        let total = 0;
        r.variants.original.forEach((name, i) => {
          if (r.conditions[0].reason[i] || name === 'p.=') return;
          total += 1;
          const df = r.conditions[0].df?.[i];
          if (Math.abs(r.conditions[0].score[i] - truth.get(name)) < (Number.isFinite(df) ? tQuantile(0.975, df) : 1.959964) * r.conditions[0].se[i]) k += 1;
        });
        return k / total;
      });
      const ds = coverage(PRESETS.dimsum.parameters);
      const counting = coverage({ ...DEFAULT_PARAMETERS, combination: 'fixed' });
      const reml = coverage({ ...DEFAULT_PARAMETERS, combination: 'reml' });
      const moderatedDs = coverage(DEFAULT_PARAMETERS);
      check('scoring', 'a simulated bottleneck (25 cells per variant before selection, three seeds): DiMSum\'s error model puts it into each variant\'s SE, and its 95% intervals hold the true effects; so does the moderated combination (MaveScape\'s default), whose shared model finds the bottleneck too', `DiMSum ${ds.map((x) => `${(100 * x).toFixed(0)}%`).join(', ')}; counting alone (fixed effects) ${counting.map((x) => `${(100 * x).toFixed(0)}%`).join(', ')}; counting with REML ${reml.map((x) => `${(100 * x).toFixed(0)}%`).join(', ')}; moderated ${moderatedDs.map((x) => `${(100 * x).toFixed(0)}%`).join(', ')}`, ds.every((x, i) => x >= 0.9 && x > counting[i] && x > reml[i]) && moderatedDs.every((x) => x >= 0.92), 'DiMSum ≥ 90%, above counting\'s and REML\'s; moderated ≥ 92%');
    }

    // Differential scores (wave 2, slice 6): the two-condition fixture (one input per replicate
    // selected without and with a ligand) against mutscan's limma contrasts and Enrich2's comparison
    // of conditions; the paired differential from first principles; the edge cases; the truth.
    {
      const tc = twoConditionCase();
      const run = (parameters) => scoreExperiment({ names: tc.names, columns: tc.columns, design: tc.design, parameters: withDefaults(parameters) });
      const at = (name) => tc.names.indexOf(name);
      const mutscan = mutscanReference();
      const lm = run({ ...defaultParameters(tc.design), differential: 'limma' });
      const cmp = compareLimma(lm.results.differential[0], tc.ids, mutscan.cases.fixture);
      const w = cmp.worst;
      check('scoring', 'limma differential on the two-condition fixture: the rows mutscan fits, and every log fold change, SE, t, p, adjusted p and interval equal to mutscan\'s calculateRelativeFC (limma, relative to the wild type)', `${cmp.fitted} rows fitted, mutscan ${cmp.rows}; log2 FC within ${w.logFC.toExponential(1)}, t ${w.t.toExponential(1)}, SE ${w.se.toExponential(1)}, p ${w.p.toExponential(1)}, adjusted p ${w.q.toExponential(1)}, interval ${w.ci.toExponential(1)} SE; df.prior ${cmp.dfPrior.map((x) => x.toFixed(6)).join(' and ')}`,
        cmp.fitted === cmp.rows && cmp.missing === 0 && w.logFC <= 1e-8 && w.t <= 1e-8 && Math.max(w.se, w.p, w.q, w.ci, w.dfTotal) <= 1e-10 && Math.abs(cmp.dfPrior[0] - cmp.dfPrior[1]) <= 1e-9 * cmp.dfPrior[1], '≤ 1e-8 relative (fold changes near 0 absolutely); the same rows');
      // Enrich2: each condition's combined scores and its z between conditions (the Enrich2-compatible preset).
      const e2 = enrich2.cases['two-condition'];
      const e2m = e2.methods['ratios/wt'];
      const ind = run({ ...defaultParameters(tc.design, null, 'enrich2') }).results;
      const d = ind.differential[0];
      let worstScore = 0;
      let worstZ = 0;
      let worstP = 0;
      let agree = 0;
      let differ = 0;
      e2.variants.forEach((name, k) => {
        const i = at(name);
        for (const id of ['a', 'b']) {
          const c = ind.conditions.find((x) => x.id === id);
          const ref = e2m.combined[id].score[k];
          if ((ref === null) !== (c.reason[i] !== 0)) differ += 1;
          else if (ref !== null) worstScore = Math.max(worstScore, Math.abs(c.score[i] - ref) / Math.max(1, Math.abs(ref)));
        }
        const z = e2m.pairwise['a|b'].z[k];
        const estimated = !d.reason[i] && Number.isFinite(d.z[i]);
        if ((z === null) !== !estimated) differ += 1;
        else if (z !== null) {
          agree += 1;
          worstZ = Math.max(worstZ, Math.abs(Math.abs(d.z[i]) - z) / Math.max(1, z));
          worstP = Math.max(worstP, Math.abs(d.p[i] - e2m.pairwise['a|b'].p[k]) / e2m.pairwise['a|b'].p[k]);
        }
      });
      check('scoring', 'independent differential with the Enrich2-compatible preset: each condition\'s combined scores and the z and p between conditions equal Enrich2 2.0.2\'s (calc_pvalues_pairwise, |z| = |s₁ − s₂|/√(SE₁² + SE₂²), which its command never calls)', `${agree} variants compared; combined scores within ${worstScore.toExponential(1)}, |z| within ${worstZ.toExponential(1)}, p within ${worstP.toExponential(1)}; ${differ} scored by one and not the other`, differ === 0 && worstScore <= 5e-13 && worstZ <= 1e-12 && worstP <= 1e-10, '≤ 5e-13 (scores), 1e-12 (z); the same variants');
      // Paired, from first principles: within a pair the input cancels; d and its variance from the
      // outputs and the wild type's alone, combined by fixed effects.
      const paired = run({ ...defaultParameters(tc.design), differential: 'paired', combination: 'fixed' }).results;
      const pd = paired.differential[0];
      const col = (id) => tc.columns[id];
      const wt = at('p.=');
      let worstPair = 0;
      tc.names.forEach((name, i) => {
        if (pd.reason[i]) return;
        let sw = 0;
        let swy = 0;
        for (const r of [1, 2, 3]) {
          const inp = col(`input_rep${r}`)[i];
          if (!(inp >= 1) || Number.isNaN(col(`a_rep${r}`)[i]) || Number.isNaN(col(`b_rep${r}`)[i])) continue;
          const [oa, ob, wa, wb] = [col(`a_rep${r}`)[i], col(`b_rep${r}`)[i], col(`a_rep${r}`)[wt], col(`b_rep${r}`)[wt]].map((x) => x + 0.5);
          const y = Math.log(ob / wb) - Math.log(oa / wa);
          const v = 1 / oa + 1 / ob + 1 / wa + 1 / wb;
          sw += 1 / v;
          swy += y / v;
        }
        worstPair = Math.max(worstPair, Math.abs(pd.delta[i] - swy / sw) / Math.max(1, Math.abs(swy / sw)), Math.abs(pd.se[i] - Math.sqrt(1 / sw)) / Math.sqrt(1 / sw));
      });
      check('scoring', 'paired differential from first principles: each pair\'s difference is the log ratio of its two outputs (relative to the wild type\'s), the shared input cancelling, with the variance of the outputs\' counts alone', `${pd.estimated} variants within ${worstPair.toExponential(1)}; pairs ${pd.pairs.map((x) => x.join('·')).join(', ')}; ${pd.note}`, worstPair <= 1e-12 && pd.pairs.length === 3 && pd.unpaired.join() === 'a-rep4', '≤ 1e-12; replicate 4 unpaired');
      // The per-condition scores do not depend on the differential.
      const none = run({ ...defaultParameters(tc.design), differential: null }).results;
      const same = none.conditions.every((c, j) => c.score.every((x, i) => Object.is(x, paired.conditions[j].score[i]) || x === paired.conditions[j].score[i]) || true) && outputDigest(none) !== outputDigest(run(defaultParameters(tc.design)).results);
      const condSame = none.conditions.every((c, j) => { const other = run(defaultParameters(tc.design)).results.conditions[j]; return c.score.every((x, i) => (Number.isNaN(x) ? Number.isNaN(other.score[i]) : x === other.score[i])); });
      check('scoring', 'the differential leaves each condition\'s scores as they are, and enters the run\'s output hash only when asked for', `conditions ${condSame ? 'identical' : 'differ'}; hash ${same ? 'changes with the differential' : 'unchanged'}; no differential: ${none.differential}`, condSame && same && none.differential === null, 'identical; hashed');
      // The edge cases, paired (limma, the default here, fits the rows counted in every sample).
      const defaults = [defaultParameters(tc.design), defaultParameters(tc.design, null, 'enrich2'), defaultParameters({ ...tc.design, replicates: tc.design.replicates.filter((r) => r.biological === 1) })].map((x) => x.differential);
      check('scoring', 'the differential by default: limma for two populations with residual degrees of freedom, Enrich2\'s z with its preset, paired with one replicate per condition', defaults.join(', '), defaults.join() === 'limma,independent,paired', 'limma, independent, paired');
      const def = run({ ...defaultParameters(tc.design), differential: 'paired' }).results.differential[0];
      const DIFF_EDGE = [
        ['p.Glu5Lys', 'missing from the ligand\'s output of replicate 2', 2, 0],
        ['p.Gly4Asp', 'missing from replicate 1\'s shared input', 2, 0],
        ['p.Lys3Arg', 'missing from every output with the ligand', 0, 2],
        ['p.Leu7Pro', '0 reads with the ligand in replicate 3', 3, 0],
        ['p.Thr9Ile', 'no input reads in replicate 2 (minimum input count 1)', 2, 0],
      ];
      for (const [name, what, k, reason] of DIFF_EDGE) {
        const i = at(name);
        check('scoring', `differential edge case: ${what} (${name})`, reason ? `no differential: ${DIFFERENTIAL_REASON_NAMES[def.reason[i]]}` : `${fmt(def.delta[i])} ± ${fmt(def.se[i])} from ${def.k[i]} pair${def.k[i] === 1 ? '' : 's'}`, def.reason[i] === reason && def.k[i] === k && (reason ? Number.isNaN(def.delta[i]) : Number.isFinite(def.delta[i])), reason ? DIFFERENTIAL_REASON_NAMES[reason] : `${k} pairs`);
      }
      // Against the truth: three simulated experiments (one input per replicate selected two ways, a
      // bottleneck of 25 cells, counting noise only), and with noise between replicates too.
      const truthRun = (noise) => QC_SEEDS.map((seed) => {
        const sim = simulateExperiment({ seed, replicates: 3, readsPerVariant: 150, inputCells: 25, replicateNoise: noise, conditions: { names: ['A', 'B'], site: [12, 13, 14, 15, 16], shift: -1.5 } });
        const t = parseTable(sim.csv);
        const names = columnText(t.columns[0]);
        const columns = Object.fromEntries(t.columns.slice(1).map((c) => [c.name, c.numeric]));
        return Object.fromEntries(['paired', 'independent', 'limma'].map((method) => {
          const out = scoreExperiment({ names, columns, design: sim.design, parameters: { ...defaultParameters(sim.design), differential: method } }).results.differential[0];
          let inside = 0;
          let total = 0;
          let falseCalls = 0;
          let nulls = 0;
          let found = 0;
          let site = 0;
          sim.variants.forEach((v, i) => {
            if (out.reason[i] || v.kind === 'wild type') return;
            total += 1;
            // Each method's own 95% interval (t, with moderated pairs' or limma's degrees of freedom).
            if (v.differential >= out.ciLow[i] && v.differential <= out.ciHigh[i]) inside += 1;
            if (v.differential === 0) { nulls += 1; if (out.q[i] < 0.05) falseCalls += 1; } else { site += 1; if (out.q[i] < 0.05) found += 1; }
          });
          return [method, { coverage: inside / total, falseCalls: falseCalls / nulls, found: found / site, foundCount: found, se: [...out.se].filter(Number.isFinite).sort((a, b) => a - b)[Math.floor(total / 2)] }];
        }));
      });
      const summary = (rows) => ['paired', 'independent', 'limma'].map((m) => `${m} ${rows.map((r) => `${(100 * r[m].coverage).toFixed(0)}%`).join('/')} (site found ${rows.map((r) => `${(100 * r[m].found).toFixed(0)}%`).join('/')}, nulls called ${rows.map((r) => `${(100 * r[m].falseCalls).toFixed(1)}%`).join('/')})`).join('; ');
      const counting = truthRun(0);
      const total = (rows, m) => rows.reduce((a, r) => a + r[m].foundCount, 0);
      check('scoring', 'differential against the truth, counting noise and a shared bottleneck (25 cells), three seeds: the paired 95% intervals hold the true differential; treated as independent, the input counted twice, they are too wide (and over the three seeds find no more of the site\'s variants)', `${summary(counting)}; median SE paired ${counting.map((r) => r.paired.se.toFixed(3)).join('/')}, independent ${counting.map((r) => r.independent.se.toFixed(3)).join('/')}; site variants found in all: paired ${total(counting, 'paired')}, independent ${total(counting, 'independent')}`,
        counting.every((r) => r.paired.coverage >= 0.93 && r.paired.coverage <= 0.985 && r.independent.coverage > r.paired.coverage + 0.015 && r.independent.se > 1.5 * r.paired.se && r.limma.coverage >= 0.93 && r.paired.falseCalls <= 0.01 && r.limma.falseCalls <= 0.01) && total(counting, 'independent') <= total(counting, 'paired'), 'paired 93–98.5%; independent wider (SE > 1.5×); limma ≥ 93%; ≤ 1% of nulls called');
      const noisy = truthRun(0.1);
      const average = (rows, m) => rows.reduce((a, r) => a + r[m].coverage, 0) / rows.length;
      check('scoring', 'differential against the truth with selection noise between replicates (SD 0.1 per condition), three seeds: the moderated pairs and limma, each borrowing their variance across variants, hold the truth (one seed\'s coverage moves with the wild type\'s own shift, which every variant shares)', `${summary(noisy)}; mean coverage paired ${(100 * average(noisy, 'paired')).toFixed(1)}%, limma ${(100 * average(noisy, 'limma')).toFixed(1)}%`,
        average(noisy, 'paired') >= 0.92 && average(noisy, 'limma') >= 0.93 && noisy.reduce((a, r) => a + r.paired.falseCalls, 0) / noisy.length <= 0.02 && noisy.every((r) => r.limma.falseCalls <= 0.02), 'mean ≥ 92% paired, ≥ 93% limma; nulls called ≤ 2% on average');
    }

    // The PRD's edge cases, as planted in the fixture, under MaveScape's defaults.
    const defaults = score(fixture, design, DEFAULT_PARAMETERS);
    const names = fixture.columns.find((c) => c.name === 'hgvs_pro').values;
    const c0 = defaults.conditions[0];
    for (const [name, what, states, used, stage, flags] of EDGE_EXPECTATIONS) {
      const i = names.indexOf(name);
      const got = { states: defaults.replicates.map((r) => r.state[i]), used: c0.k[i], stage: c0.reason[i] || null, flags: c0.flags[i] };
      const scored = !got.stage && Number.isFinite(c0.score[i]) && Number.isFinite(c0.se[i]);
      const ok = JSON.stringify(got) === JSON.stringify({ states, used, stage, flags }) && (stage ? Number.isNaN(c0.score[i]) : scored);
      check('scoring', `edge case: ${what} (${name})`, `${stage ? `not scored: ${STAGE_BY_CODE.get(got.stage)?.reason}` : `scored ${fmt(c0.score[i])} ± ${fmt(c0.se[i])} from ${got.used} replicate${got.used === 1 ? '' : 's'}`}; replicate states ${got.states.join(',')}${got.flags ? `; flags ${got.flags}` : ''}`, ok, `states ${states.join(',')}, ${used} used${stage ? `, stage ${STAGE_BY_CODE.get(stage).id}` : ''}${flags ? `, flags ${flags}` : ''}`);
    }
    {
      const results = score(fixture, design, { ...DEFAULT_PARAMETERS, filters: { ...DEFAULT_PARAMETERS.filters, minInputCount: 10 } });
      const i = names.indexOf('p.Thr9Ala');
      const c = results.conditions[0];
      const kept = results.replicates.every((r) => Number.isFinite(r.score[i]) && r.first[i] === 3);
      check('scoring', 'edge case: observed but filtered (p.Thr9Ala, 3 input reads; minimum input count 10): NA with its stage, its counts and replicate scores kept', `stage ${STAGE_BY_CODE.get(c.reason[i])?.id}; score ${c.score[i]}; replicate scores ${results.replicates.map((r) => fmt(r.score[i])).join(', ')}`, c.reason[i] === STAGE_BY_ID.get('input-count').code && Number.isNaN(c.score[i]) && kept, 'input-count; NaN; kept');
      const flow = c.flow;
      const total = flow.reduce((a, x) => a + x.removed, 0) + c.scored;
      check('scoring', 'the filter flow accounts for every variant', flow.filter((x) => x.removed).map((x) => `${x.stage} −${x.removed}`).join(', ') + `; ${c.scored} scored of ${results.rows}`, total === results.rows && flow.at(-1).remaining === c.scored, 'removed + scored = rows');
    }
    {
      // Enrich2's conventions on the same edge cases: zero inputs scored, partial variants not combined.
      const results = score(fixture, design, PRESETS.enrich2.parameters);
      const c = results.conditions[0];
      const at = (n) => names.indexOf(n);
      const ok = c.k[at('p.Lys3Arg')] === 3 && c.k[at('p.Gly4Asp')] === 3 && c.reason[at('p.Glu6Lys')] === STAGE_BY_ID.get('replicates').code && c.reason[at('p.Leu7Pro')] === STAGE_BY_ID.get('replicates').code && Number.isFinite(results.replicates[0].score[at('p.Glu6Lys')]);
      check('scoring', 'Enrich2-compatible: zero inputs scored with the pseudocount, variants missing from a replicate not combined (their replicate scores kept)', `Lys3Arg ${c.k[at('p.Lys3Arg')]} replicates, Gly4Asp ${c.k[at('p.Gly4Asp')]}; Glu6Lys and Leu7Pro: ${STAGE_BY_CODE.get(c.reason[at('p.Glu6Lys')])?.id}`, ok, 'as Enrich2');
    }
    {
      // Reference class unavailable: refused, saying why.
      const noWt = variantTable(fixture, { drop: ['p.='] });
      const refusals = [
        ['no wild-type row, wild-type normalization', scoreExperiment({ ...engineInput(noWt, design), parameters: DEFAULT_PARAMETERS }), /wild type/i],
        ['no synonymous controls, synonymous normalization', scoreExperiment({ ...engineInput(fixture, { ...design, controls: { ...design.controls, synonymous: 'none' } }), parameters: { ...DEFAULT_PARAMETERS, normalization: 'synonymous' } }), /synonymous/i],
        ['no nonsense controls, rescaled to the nonsense median', scoreExperiment({ ...engineInput(fixture, { ...design, controls: { ...design.controls, nonsense: 'none' } }), parameters: { ...DEFAULT_PARAMETERS, rescale: 'nonsense-wt' } }), /nonsense/i],
      ];
      for (const [what, out, pattern] of refusals) check('scoring', `edge case: reference class unavailable (${what}): the run is refused, with the reason`, out.ok ? 'scored anyway' : out.errors[0], !out.ok && pattern.test(out.errors.join(' ')), 'refused');
      const shallow = score(variantTable(fixture, { divide: 2000 }), design, { ...DEFAULT_PARAMETERS, normalization: 'complete' });
      const low = shallow.warnings.filter((w) => w.code === 'low-depth');
      check('scoring', 'edge case: very low sequencing depth (the fixture\'s counts ÷ 2000) is warned about, sample by sample', `${low.length} samples: ${low[0]?.message ?? 'none'}`, low.length >= 6, 'every sample');
    }
    // Rescaling (S11): the anchors land where they are sent.
    for (const [rescale, check1, check2] of [['nonsense-wt', ['nonsense median', 0], ['wild type', 1]], ['synonymous-nonsense', ['synonymous median', 0], ['nonsense median', -1]]]) {
      const results = score(fixture, design, { ...DEFAULT_PARAMETERS, rescale });
      const c = results.conditions[0];
      const kinds = results.variants.kind;
      const med = (k) => median([...c.score].filter((x, i) => kinds[i] === k && !c.reason[i]));
      const value = (what) => (what === 'wild type' ? c.score[results.controls.wt] : med(what.startsWith('nonsense') ? 4 : 2));
      const a = value(check1[0]);
      const b = value(check2[0]);
      check('scoring', `rescaling "${rescale}": ${check1[0]} → ${check1[1]}, ${check2[0]} → ${check2[1]}`, `${fmt(a, 12)}, ${fmt(b, 12)}`, Math.abs(a - check1[1]) < 1e-12 && Math.abs(b - check2[1]) < 1e-12, 'exact (≤ 1e-12)');
    }

    // Determinism, order invariance and symmetry.
    {
      const once = outputDigest(score(fixture, design, DEFAULT_PARAMETERS));
      const twice = outputDigest(score(fixture, design, DEFAULT_PARAMETERS));
      check('scoring', 'determinism: the same inputs give the same output hash', `${once.slice(0, 16)}… twice`, once === twice, 'identical');
      const random = createRandom(5);
      let differing = 0;
      for (let k = 0; k < 5; k += 1) {
        const shuffled = byKey(score(shuffledTable(fixture, random), design, DEFAULT_PARAMETERS));
        const original = byKey(score(fixture, design, DEFAULT_PARAMETERS));
        differing += [...original].filter(([key, value]) => shuffled.get(key) !== value).length;
      }
      check('scoring', 'row and column order: the fixture shuffled five times gives every variant the same scores, bit for bit', `${differing} differences`, differing === 0, '0');
      const swapped = { ...design, replicates: design.replicates.map((r) => ({ ...r, input: r.output, output: r.input })) };
      const forward = score(fixture, design, { ...DEFAULT_PARAMETERS, filters: { ...DEFAULT_PARAMETERS.filters, minInputCount: 0 } });
      const backward = score(fixture, swapped, { ...DEFAULT_PARAMETERS, filters: { ...DEFAULT_PARAMETERS.filters, minInputCount: 0 } });
      const pairs = [];
      for (let i = 0; i < forward.rows; i += 1) if (!forward.conditions[0].reason[i]) pairs.push([names[i], -backward.conditions[0].score[i], forward.conditions[0].score[i]], [`${names[i]} SE`, backward.conditions[0].se[i], forward.conditions[0].se[i]]);
      const d = worstDifference(pairs);
      check('scoring', 'symmetry: input and output swapped negate every score and keep every SE (REML)', `${d.worst.toExponential(2)} (${d.where || 'none'})`, d.worst <= 1e-12, '≤ 1e-12');
    }

    // Runs: ids from inputs, outputs reproduced from a saved workspace.
    {
      const source = { id: 'counts', name: 'two-population.csv', sha256: 'f'.repeat(64), rows: fixture.rows, mapping: { mode: 'lenient' } };
      const inputs = runInputs({ source, design, parameters: DEFAULT_PARAMETERS });
      const results = score(fixture, design, DEFAULT_PARAMETERS);
      const run = makeRun({ inputs, source, results, software: { version: '0.1.0', commit: '' }, name: 'Run 1', created: '2026-10-08T12:00:00.000Z' });
      const other = runId(runInputs({ source, design, parameters: { ...DEFAULT_PARAMETERS, pseudocount: 0.25 } }));
      check('scoring', 'run ids: the same inputs make the same id, another pseudocount another', `${run.id}, ${other}`, run.id === runId(runInputs({ source, design: JSON.parse(JSON.stringify(design)), parameters: { ...DEFAULT_PARAMETERS } })) && other !== run.id, 'same; different');
      let ws = createWorkspace('Scoring', { now: '2026-10-08T12:00:00.000Z' });
      ws = addRun(ws, run).ws;
      const again = addRun(ws, run);
      const reopened = parseWorkspace(serializeWorkspace(ws));
      const recorded = recordedInputs(reopened.runs[0]);
      const recomputed = scoreExperiment({ ...engineInput(fixture, recorded.design), parameters: recorded.parameters, mode: recorded.mapping.mode });
      check('scoring', 'a run saved in a workspace, reopened and recomputed from its recorded inputs has its recorded output hash; adding it again adds nothing', `${run.output.sha256.slice(0, 16)}…; ${verifyHistory(reopened).entries} history entries`, recomputed.ok && outputDigest(recomputed.results) === run.output.sha256 && again.existing && again.ws === ws && verifyHistory(reopened).ok, 'reproduced');
    }

    // The feasibility data (external).
    for (const c of DESIGN_CASES.filter((x) => ['grb2-sh3', 'brca1-ring-e2', 'brca1-ring-y2h'].includes(x.name))) {
      const table = parseTable(dataset(c.dataset).bytes(c.counts));
      againstEnrich2(c.name, table, readDesign(c.design));
    }
    {
      // Row order on real data with shared inputs and a time series: BRCA1, rows shuffled.
      const e2 = readDesign('brca1-ring-e2.design.json');
      const table = parseTable(dataset('mavedb-brca1-ring').bytes('aa/counts.csv'));
      const t0 = performance.now();
      const results = score(table, e2, DEFAULT_PARAMETERS);
      const ms = performance.now() - t0;
      const shuffled = byKey(score(shuffledTable(table, createRandom(9)), e2, DEFAULT_PARAMETERS));
      const differing = [...byKey(results)].filter(([key, value]) => shuffled.get(key) !== value).length;
      const codes = results.warnings.map((w) => w.code);
      // Its shared inputs: combined with their covariance by the moderated combination (wave 2, slice
      // 9), and only warned about by REML, which treats replicates as independent.
      const remlCodes = score(table, e2, { ...DEFAULT_PARAMETERS, combination: 'reml' }).warnings.map((w) => w.code);
      const said = results.info.some((x) => /shared between replicates.*covariance/.test(x));
      check('scoring', `BRCA1 E2 (${formatCount(results.rows)} rows × 6 replicates, MaveScape defaults, ${ms.toFixed(0)} ms): rows and columns shuffled give the same scores; its shared inputs combined with their covariance (REML warns instead), and the time series scored by its ends warned about`, `${differing} differences; warnings: ${codes.join(', ')}; covariance ${said ? 'said' : 'not said'}; REML's warnings: ${remlCodes.join(', ')}`, differing === 0 && said && !codes.includes('shared-samples') && remlCodes.includes('shared-samples') && codes.includes('time-series-ratio'), '0; covariance; the warnings');
      // The whole table drafted from its column names: two assays, two conditions, scored apart;
      // the E2 condition scores as the hand-written E2 design does.
      const layout = detectLayout(table);
      const drafted = draftDesign(table, suggestRoles(layout.countColumns), { variantColumn: layout.variantColumn, level: layout.level, target: e2.targets[0] }).design;
      const both = score(table, drafted, DEFAULT_PARAMETERS);
      const e2Condition = both.conditions.find((c) => c.replicates.length === 6 && c.replicates.every((id) => /PlusE2/.test(id)));
      const pairs = [];
      if (e2Condition) {
        const c = results.conditions[0];
        for (let i = 0; i < results.rows; i += 1) if (!c.reason[i]) pairs.push([results.variants.key[i], e2Condition.score[i], c.score[i]], [`${results.variants.key[i]} SE`, e2Condition.se[i], c.se[i]]);
      }
      const dd = worstDifference(pairs);
      check('scoring', 'BRCA1, the whole table drafted from its column names: E2 binding (6 time points) and Y2H (4) become two conditions, scored apart; the E2 condition scores as the hand-written E2 design does', `${both.conditions.map((c) => `${c.name}: ${c.replicates.length} replicates, ${formatCount(c.scored)} scored`).join('; ')}; E2 against the hand-written design ${dd.worst.toExponential(2)} over ${pairs.length / 2} variants`, both.conditions.length === 2 && !!e2Condition && dd.worst <= 1e-12 && pairs.length > 0, 'two conditions; ≤ 1e-12');
      // Factor IX (MultiSTEP): its published replicate and combined scores from its counts.
      const f9Table = parseTable(dataset('mavedb-factor9').bytes('counts.csv'));
      const f9Design = readDesign('factor9.design.json');
      const published = parseTable(dataset('mavedb-factor9').bytes('scores.csv'));
      const pubColumn = (name) => published.columns.find((c) => c.name === name).numeric;
      const pubRow = new Map(published.columns.find((c) => c.name === 'hgvs_pro').values.map((x, i) => [x, i]));
      const f9Names = f9Table.columns.find((c) => c.name === 'hgvs_pro').values;
      const wtRow = f9Names.indexOf('p.=');
      const exact = [];
      for (const replicate of f9Design.replicates) {
        const { counts, values } = replicateBins(f9Table, f9Design, replicate);
        const pub = pubColumn(factor9Column(replicate.id));
        const kept = Uint8Array.from(f9Names, (x) => (Number.isFinite(pub[pubRow.get(x)]) ? 1 : 0));
        // Frequencies over the variants the authors kept, as they computed them.
        const totals = binTotals(counts.map((c) => c.map((x, i) => (kept[i] ? x : Number.NaN))));
        const avg = binAverages(counts, values, kept, { totals });
        const { zero, one } = scaleAnchors('low5-wt', avg.score, kept, { wt: wtRow });
        f9Names.forEach((x, i) => { if (kept[i]) exact.push([`${replicate.id} ${x}`, (avg.score[i] - zero) / (one - zero), pub[pubRow.get(x)]]); });
      }
      const de = worstDifference(exact);
      check('scoring', `factor IX (MultiSTEP): every published replicate score reproduced from the counts, on the variants the authors kept: rank-weighted bin average, wild type 1, the lowest 5% median 0 (${exact.length} scores in 9 replicates)`, `${de.worst.toExponential(2)} (${de.where})`, de.worst <= 1e-12, '≤ 1e-12');
      const reps = f9Design.replicates.map((r) => pubColumn(factor9Column(r.id)));
      const pubScore = pubColumn('score');
      const pubSE = pubColumn('SE_score');
      const combined = [];
      pubScore.forEach((x, i) => {
        const y = reps.map((r) => r[i]).filter(Number.isFinite);
        if (!y.length || !Number.isFinite(x)) return;
        const c = combineMean(y, y.map(() => 0));
        combined.push([`${i} score`, c.estimate, x]);
        if (y.length > 1) combined.push([`${i} SE`, c.se, pubSE[i]]);
      });
      const dc = worstDifference(combined);
      check('scoring', 'factor IX: the published combined scores and SEs are the mean of the replicate scores and their SD over √k, as MaveScape\'s "mean" combination computes them', `${dc.worst.toExponential(2)} over ${combined.length} values`, dc.worst <= 1e-12, '≤ 1e-12');
      const multistep = { ...defaultParameters(f9Design), binScale: 'low5-wt', combination: 'mean', filters: { ...DEFAULT_PARAMETERS.filters, minInputCount: 0 } };
      const f9Start = performance.now();
      const engine = score(f9Table, f9Design, multistep);
      const f9Ms = performance.now() - f9Start;
      let worstRep = 0;
      let extra = 0;
      let missingThere = 0;
      engine.replicates.forEach((r) => {
        const pub = pubColumn(factor9Column(r.id));
        f9Names.forEach((x, i) => {
          const theirs = pub[pubRow.get(x)];
          const mine = r.state[i] === REPLICATE_STATE.USED;
          if (mine && Number.isFinite(theirs)) worstRep = Math.max(worstRep, Math.abs(r.score[i] - theirs));
          else if (mine) extra += 1;
          else if (Number.isFinite(theirs)) missingThere += 1;
        });
      });
      const a = [];
      const b = [];
      f9Names.forEach((x, i) => { const p = pubScore[pubRow.get(x)]; if (!engine.conditions[0].reason[i] && Number.isFinite(p)) { a.push(engine.conditions[0].score[i]); b.push(p); } });
      check('scoring', `factor IX through the engine with MultiSTEP's settings (weighted average, lowest-5% scale, mean; ${f9Ms.toFixed(0)} ms): replicate scores within 2e-3 of the published where both score; the few more variants scored are those the authors' filter (on data not in the table) left out, which move the lowest-5% anchor`, `replicate scores within ${worstRep.toExponential(2)}; ${extra} more measurements scored here (of ${engine.replicates.length * 3000}+), ${missingThere} fewer; combined Pearson r ${pearson(a, b).toFixed(5)} over ${a.length}`, worstRep <= 2e-3 && missingThere === 0 && extra <= 100 && pearson(a, b) >= 0.999, '≤ 2e-3; none missing; r ≥ 0.999');
      const ungated = scoreExperiment({ ...engineInput(f9Table, f9Design), parameters: { ...defaultParameters(f9Design), model: 'bins-mle' } });
      check('scoring', 'factor IX: the maximum-likelihood fit is refused, as MaveDB records no gates for its bins', ungated.ok ? 'scored' : ungated.errors[0], !ungated.ok && /gates/.test(ungated.errors[0]), 'refused');
    }
    // DiMSum on GRB2 SH3 (the data DiMSum scored for MaveDB) and on DiMSum's own demo.
    {
      const grb2Data = dataset('mavedb-grb2-sh3');
      againstDimsum('GRB2 SH3', grb2Case(grb2Data), dimsumRef.cases.grb2);
      againstDimsum('DiMSum\'s demo (TDP-43, four replicates, nucleotide variants)', demoCase(dataset('dimsum-demo')), dimsumRef.cases.demo);
      // GRB2's published scores are DiMSum's merged fitness through a line (its growth rates),
      // from the Domainome's own run, which fitted many domains' libraries together.
      const gDesign = readDesign('grb2-sh3.design.json');
      const gt = parseTable(grb2Data.bytes('counts.csv'));
      const run = score(gt, gDesign, defaultParameters(gDesign, null, 'dimsum'));
      const pub = parseTable(grb2Data.bytes('scores.csv'));
      const pubRow = new Map(columnText(pub.columns.find((c) => c.name === 'hgvs_pro')).map((x, i) => [x, i]));
      const raw = pub.columns.find((c) => c.name === 'raw_score').numeric;
      const a = [];
      const b = [];
      run.variants.original.forEach((x, i) => { const j = pubRow.get(x); if (j !== undefined && !run.conditions[0].reason[i] && Number.isFinite(raw[j])) { a.push(run.conditions[0].score[i]); b.push(raw[j]); } });
      check('scoring', 'GRB2 SH3 scored by DiMSum\'s model follows its published scores (DiMSum\'s, from the Domainome\'s run of many domains together, through a line)', `Pearson r ${pearson(a, b).toFixed(4)} over ${a.length} variants`, pearson(a, b) >= 0.99, 'r ≥ 0.99');
    }
    // CBS at two vitamin B6 levels from shared inputs (MaveDB urn:mavedb:00000005-a-5 and -a-6):
    // limma against mutscan on real data, and how much counting the inputs twice overstates.
    {
      const cbs = cbsCase(dataset('mavedb-cbs'));
      const run = (differential) => {
        const t0 = performance.now();
        const out = scoreExperiment({ names: cbs.names, columns: cbs.columns, design: cbs.design, parameters: { ...defaultParameters(cbs.design), normalization: 'synonymous', differential } });
        if (!out.ok) throw new Error(out.errors.join(' '));
        return { results: out.results, ms: performance.now() - t0 };
      };
      const lm = run('limma');
      const cmp = compareLimma(lm.results.differential[0], cbs.ids, mutscanReference().cases.cbs);
      const w = cmp.worst;
      check('scoring', `CBS, low against high vitamin B6 from the same four inputs (scored in ${lm.ms.toFixed(0)} ms): limma's differential relative to the synonymous variants equals mutscan's calculateRelativeFC on the same rows`, `${cmp.fitted} rows fitted, mutscan ${cmp.rows} (${cmp.compared} compared); log2 FC within ${w.logFC.toExponential(1)}, t ${w.t.toExponential(1)}, SE ${w.se.toExponential(1)}, p ${w.p.toExponential(1)}, adjusted p ${w.q.toExponential(1)}; df.prior ${cmp.dfPrior.map((x) => x.toFixed(6)).join(' and ')}`,
        cmp.fitted === cmp.rows && cmp.missing === 0 && w.logFC <= 1e-8 && w.t <= 1e-8 && Math.max(w.se, w.p, w.q, w.ci, w.dfTotal) <= 1e-10 && Math.abs(cmp.dfPrior[0] - cmp.dfPrior[1]) <= 1e-9 * cmp.dfPrior[1], '≤ 1e-8; the same rows');
      const paired = run('paired').results.differential[0];
      const ind = run('independent').results.differential[0];
      const ratios = [];
      const shares = [];
      const pairs = run('paired').results;
      paired.reason.forEach((r, i) => {
        if (r || ind.reason[i]) return;
        ratios.push(ind.se[i] / paired.se[i]);
      });
      // The input's share of a replicate's counting variance, over the replicates scored.
      for (const rep of pairs.replicates) rep.state.forEach((st, i) => { if (!st) shares.push((1 / (rep.first[i] + 0.5)) / (rep.se[i] * rep.se[i])); });
      const med = (x) => Float64Array.from(x).sort()[x.length >> 1];
      const both = (d) => d.reason.reduce((a, r, i) => a + (!r && d.q[i] < 0.05 ? 1 : 0), 0);
      check('scoring', 'CBS: compared as independent, the two conditions count their shared inputs twice; the paired differential takes the inputs\' counting error out', `inputs ${(100 * med(shares)).toFixed(0)}% of a replicate's counting variance (median); independent SEs a median ${med(ratios).toFixed(2)}× the paired over ${ratios.length} variants; q < 0.05: paired ${both(paired)}, independent ${both(ind)}, limma ${both(lm.results.differential[0])}`, med(ratios) > 1.05, 'independent wider');
    }
  },
  // Quality control (wave 1, slice 6): simulated experiments with one problem each raise exactly
  // the findings for it (the clean one none); the variance ratio follows a simulated bottleneck;
  // QC does not depend on row order or on whether a run is given; thresholds act and are recorded;
  // the feasibility data's findings, as found.
  qc() {
    const show = (r) => (Object.keys(r).length ? Object.entries(r).map(([k, v]) => `${k}:${v}`).join(', ') : 'none');
    for (const [name, options, expected] of QC_FIXTURES) {
      const got = QC_SEEDS.map((seed) => raised(runFixture(options, seed).findings));
      const ok = got.every((g) => matches(g, expected));
      check('qc', `${name}: raises exactly its findings (3 seeds)`, got.map(show).join(' | '), ok, show(Object.fromEntries(Object.entries(expected).map(([k, v]) => [k, Array.isArray(v) ? v.join('/') : v]))));
    }
    {
      const missing = runFixture(QC_FIXTURES[5][1], QC_SEEDS[0]);
      const o = overall(missing.findings);
      check('qc', 'a missing sample: scoring is refused, QC still runs from the counts, and the finding blocks the analysis', `${missing.scored.ok ? 'scored' : `refused (${missing.scored.errors[0]})`}; overall ${o.status}, blocking ${o.blocking.join(', ')}`, !missing.scored.ok && o.blocking.includes('missing-sample'), 'refused; blocking');
    }

    // The variance ratio against a simulated bottleneck: about 1 + D/(2N) for N cells per variant
    // and D reads per variant before and after selection.
    {
      const rows = [];
      let ok = true;
      let previous = 0;
      for (const cells of [Infinity, 400, 100, 40, 20]) {
        const ratios = QC_SEEDS.map((seed) => {
          const sim = simulateExperiment({ seed, inputCells: cells, replicateNoise: 0 });
          const table = parseTable(sim.csv);
          const q = computeQC({ names: table.columns[0].values, columns: Object.fromEntries(table.columns.slice(1).map((c) => [c.name, c.numeric])), design: sim.design });
          return median(q.conditions[0].pairs.map((p) => p.ratio));
        });
        const measured = median(ratios);
        const predicted = 1 + 200 / (2 * cells);
        rows.push(`${Number.isFinite(cells) ? cells : 'no bottleneck'}: ${measured.toFixed(2)} (predicted ${predicted.toFixed(2)})`);
        if (!(measured > previous) || Math.abs(measured - predicted) / predicted > 0.3) ok = false;
        previous = measured;
      }
      check('qc', 'variance beyond counting follows a simulated bottleneck (cells per variant into selection): measured ratio against 1 + D/(2N)', rows.join('; '), ok, 'increasing, within 30%');
    }

    // The cells recorded against the bottleneck the replicates imply (wave 2, slice 10): recorded as
    // they were carried (and recovered), they account for it; with noise between replicates beyond
    // counting the replicates show more than they explain; recorded ten times too few, less.
    {
      const rows = [];
      let ok = true;
      for (const [label, options, expected, alter] of [
        ['20 cells per variant into selection', { inputCells: 20 }, 'explained'],
        ['100 cells per variant', { inputCells: 100 }, 'explained'],
        ['20 into selection, 50 recovered after it', { inputCells: 20, outputCells: 50 }, 'explained'],
        ['20 cells and noise between replicates (SD 0.3)', { inputCells: 20, replicateNoise: 0.3 }, 'more'],
        ['100 cells, recorded as a tenth of them', { inputCells: 100 }, 'less', (design) => design.samples.forEach((x) => { if (x.cells) x.cells /= 10; })],
      ]) {
        const verdicts = QC_SEEDS.flatMap((seed) => {
          const sim = simulateExperiment({ seed, ...options, recordCells: true });
          alter?.(sim.design);
          const t = parseTable(sim.csv);
          const q = computeQC({ names: columnText(t.columns[0]), columns: Object.fromEntries(t.columns.slice(1).map((c) => [c.name, c.numeric])), design: sim.design });
          return (findingsFrom(q, defaultThresholds()).find((f) => f.id === 'excess-variance').cells ?? []).map((c) => c.verdict);
        });
        const share = verdicts.filter((v) => v === expected).length / Math.max(1, verdicts.length);
        rows.push(`${label}: ${verdicts.filter((v) => v === expected).length} of ${verdicts.length} pairs "${expected}"`);
        if (!(verdicts.length === 9 && share >= 0.75)) ok = false;
      }
      const unrecorded = runFixture({ inputCells: 20 }, QC_SEEDS[0]).findings.find((f) => f.id === 'excess-variance');
      const advises = unrecorded.cells === null && unrecorded.advice.next.some((x) => /Record the cells carried into selection/.test(x.text));
      rows.push(`not recorded: ${advises ? 'no check, and the advice says to record them' : 'not as expected'}`);
      check('qc', 'the cells recorded against the bottleneck the replicates imply: 1 + Σ(1/N)/Σ(1/R_in + 1/R_out) for N cells and R reads (three seeds, three pairs each)', rows.join('; '), ok && advises, 'each verdict in ≥ 75% of pairs; advice to record them when not');
    }

    // DiMSum's error model, fitted from the counts alone, says where a bottleneck is: N cells per
    // variant before selection raise its input terms to about 1 + D/N (D reads per variant), after
    // selection its output terms.
    {
      const rows = [];
      let ok = true;
      const med = (x) => median(Float64Array.from(x));
      for (const [where, cells] of [['none', Infinity], ['before', 200], ['before', 50], ['before', 20], ['after', 50], ['after', 20]]) {
        const ins = [];
        const outs = [];
        for (const seed of QC_SEEDS) {
          const sim = simulateExperiment({ seed, replicateNoise: 0, ...(where === 'before' ? { inputCells: cells } : where === 'after' ? { outputCells: cells } : {}) });
          const t = parseTable(sim.csv);
          const q = computeQC({ names: columnText(t.columns[0]), columns: Object.fromEntries(t.columns.slice(1).map((c) => [c.name, c.numeric])), design: sim.design });
          for (const g of q.conditions[0].errorModel) for (const x of g.terms ?? []) {
            ins.push(x.input);
            outs.push(x.output);
          }
        }
        const predicted = 1 + 200 / cells;
        const [mi, mo] = [med(ins), med(outs)];
        rows.push(`${where === 'none' ? 'no bottleneck' : `${cells} cells ${where}`}: input ${mi.toFixed(2)}, output ${mo.toFixed(2)}${where === 'none' ? '' : ` (1 + D/N = ${predicted.toFixed(1)})`}`);
        if (where === 'none' && !(mi < 1.2 && mo < 1.2)) ok = false;
        if (where === 'before' && !(Math.abs(mi / predicted - 1) <= 0.25 && mo < 2)) ok = false;
        if (where === 'after' && !(mo >= 0.6 * predicted && mo >= 2 * mi)) ok = false;
      }
      check('qc', 'DiMSum\'s error model, from the counts alone, locates a simulated bottleneck: before selection its input terms rise to about 1 + D/N, after it its output terms (three seeds, medians)', rows.join('; '), ok, 'within 25% before, the output ≥ 2× the input after');
    }

    // Invariance and independence.
    {
      const base = runFixture(QC_FIXTURES[2][1], QC_SEEDS[0]);
      const shuffled = shuffledTable(base.table, createRandom(3));
      const names = shuffled.columns.find((c) => c.name === 'hgvs_pro').values;
      const columns = Object.fromEntries(shuffled.columns.filter((c) => c.name !== 'hgvs_pro').map((c) => [c.name, c.numeric]));
      const again = findingsFrom(computeQC({ names, columns, design: base.sim.design }), defaultThresholds());
      const countsOnly = findingsFrom(computeQC({ names: base.names, columns: base.columns, design: base.sim.design }), defaultThresholds());
      const same = (a, b) => JSON.stringify(a.filter((f) => f.level === 'counts').map((f) => [f.id, f.status, f.value])) === JSON.stringify(b.filter((f) => f.level === 'counts').map((f) => [f.id, f.status, f.value]));
      check('qc', 'rows and columns shuffled give the same count-level findings, value for value; and they are the same with or without a score run', `${base.findings.filter((f) => f.level === 'counts').length} findings compared`, same(again, base.findings) && same(countsOnly, base.findings), 'identical');
    }

    // Thresholds: they act, are checked and are recorded.
    {
      const clean = runFixture({}, QC_SEEDS[0]);
      const r = clean.qc.conditions[0].pairs.reduce((a, p) => Math.min(a, p.pearson), 1);
      const stricter = { ...defaultThresholds(), agreement: { review: Math.ceil(r * 100) / 100 + 0.01, fail: 0.5 } };
      const flipped = raised(findingsFrom(clean.qc, stricter));
      let ws = createWorkspace('QC', { now: '2026-10-09T12:00:00.000Z' });
      ws = setQcThresholds(ws, stricter, `QC: replicate agreement review level 0.8 → ${stricter.agreement.review}`);
      const unchanged = setQcThresholds(ws, stricter, 'again');
      const reopened = parseWorkspace(serializeWorkspace(ws));
      check('qc', 'a threshold raised above the clean experiment\'s agreement turns that finding to review; the change is in the history, and setting it again changes nothing', `r = ${r.toFixed(3)}, review below ${stricter.agreement.review}: ${show(flipped)}; history: ${reopened.history.at(-1).detail}`, flipped.agreement === 'review' && Object.keys(flipped).length === 1 && unchanged === ws && verifyHistory(reopened).ok && reopened.qc.thresholds.agreement.review === stricter.agreement.review, 'agreement: review; recorded');
      const bad = checkThresholds({ agreement: { review: 0.5, fail: 0.8 } });
      check('qc', 'thresholds whose fail level is on the wrong side of the review level are refused', bad[0] ?? 'accepted', bad.length === 1, 'refused');
    }

    // Findings in context (wave 2, slice 8). Every finding a planted problem raises says which
    // causes fit it and what to do next.
    {
      const missingAdvice = [];
      let raisedCount = 0;
      for (const [name, options] of QC_FIXTURES) {
        for (const f of runFixture(options, QC_SEEDS[0]).findings) {
          if (f.status !== 'review' && f.status !== 'fail') continue;
          raisedCount += 1;
          if (!f.advice?.causes.length || !f.advice?.next.length) missingAdvice.push(`${name}: ${f.id}`);
        }
      }
      check('qc', 'every finding the planted problems raise names the causes that fit it and what to do next (look, change the analysis, or the experiment)', `${raisedCount - missingAdvice.length} of ${raisedCount}${missingAdvice.length ? `; without: ${missingAdvice.join(', ')}` : ''}`, raisedCount > 0 && !missingAdvice.length, 'all');
    }
    // A selection that enriches loss of function: the clean experiment with each replicate's input
    // and output swapped, so that a variant that loses the function now scores high.
    {
      const rows = QC_SEEDS.map((seed) => {
        const base = runFixture(QC_FIXTURES[0][1], seed);
        const swapped = { ...base.sim.design, replicates: base.sim.design.replicates.map((r) => ({ ...r, input: r.output, output: r.input })) };
        const separationOf = (design) => {
          const scored = scoreExperiment({ names: base.names, columns: base.columns, design, parameters: defaultParameters(design) });
          return findingsFrom(computeQC({ names: base.names, columns: base.columns, design, results: scored.results }), defaultThresholds()).find((f) => f.id === 'separation');
        };
        return { clean: base.findings.find((f) => f.id === 'separation'), stated: separationOf({ ...swapped, readout: { direction: 'higher-less' } }), assumed: separationOf(swapped) };
      });
      const auc = (f) => Number(/AUC ([0-9.]+)/.exec(f.value)?.[1]);
      check('qc', 'a selection that enriches loss of function (inputs and outputs swapped), 3 seeds: with the readout\'s direction stated, the controls separate as in the clean experiment; not stated, separation fails, says the direction may be the other way round, and asks for it', rows.map((r) => `stated ${r.stated.status} (AUC ${auc(r.stated)}), not stated ${r.assumed.status} (AUC ${auc(r.assumed)})`).join(' | '),
        rows.every((r) => r.stated.status === 'pass' && auc(r.stated) >= 0.9 && r.clean.status === 'pass' && r.assumed.status === 'fail' && /higher score may mean less of the function/.test(r.assumed.explanation) && r.assumed.advice.next.some((x) => x.kind === 'analysis' && /direction/.test(x.text))), 'stated: pass; not stated: fail, saying so');
      // No late-stop warning where the stops all lose the function.
      check('qc', 'a clean experiment (3 seeds): no warning that late stops keep the function', rows.map((r) => (/score like the reference/.test(r.clean.explanation) ? 'warned' : 'none')).join(', '), rows.every((r) => !/score like the reference/.test(r.clean.explanation)), 'none');
    }
    // A library of single-base changes (error-prone PCR) on the two-population fixture's DNA target:
    // a table of exactly the substitutions one base away from each wild-type codon, counted here
    // independently. Coverage is low against all substitutions; against what the library can make
    // it is whole.
    {
      const code = {};
      const bases = 'TCAG';
      const aa = 'FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG';
      let k = 0;
      for (const a of bases) for (const b of bases) for (const c of bases) code[a + b + c] = aa[k++];
      const design = fixtureDesign();
      const dna = design.targets[0].sequence.slice((design.targets[0].codingStart ?? 1) - 1);
      const three = { A: 'Ala', R: 'Arg', N: 'Asn', D: 'Asp', C: 'Cys', Q: 'Gln', E: 'Glu', G: 'Gly', H: 'His', I: 'Ile', L: 'Leu', K: 'Lys', M: 'Met', F: 'Phe', P: 'Pro', S: 'Ser', T: 'Thr', W: 'Trp', Y: 'Tyr', V: 'Val', '*': 'Ter' };
      const reachable = new Set();
      for (let p = 1; 3 * p <= dna.length; p += 1) {
        const codon = dna.slice(3 * p - 3, 3 * p);
        for (let j = 0; j < 3; j += 1) for (const b of 'ACGT') {
          const alt = code[codon.slice(0, j) + b + codon.slice(j + 1)];
          if (b !== codon[j] && alt !== code[codon]) reachable.add(`p.${three[code[codon]]}${p}${three[alt]}`);
        }
      }
      // A table of every such substitution and the wild type, each counted in every sample.
      const columnNames = design.samples.flatMap((x) => x.columns);
      const rowsOut = ['p.=', ...reachable].map((n) => [n, ...columnNames.map(() => (n === 'p.=' ? 10000 : 100))].join(','));
      const single = parseTable(new TextEncoder().encode(`${[[design.variants.column, ...columnNames].join(','), ...rowsOut].join('\n')}\n`));
      const coverageOf = (d) => {
        const input = engineInput(single, d);
        return findingsFrom(computeQC({ ...input, design: d }), defaultThresholds()).find((f) => f.id === 'coverage');
      };
      const without = coverageOf(design);
      const withMethod = coverageOf({ ...design, library: { ...(design.library ?? { level: 'variant' }), method: 'Error-prone PCR' } });
      check('qc', `a library of single-base changes (the fixture's 20 codons: ${reachable.size} substitutions one base away, counted independently): judged against all substitutions coverage fails; with the library made by error-prone PCR, it is judged against what that can make, and passes`, `without: ${without.status} (${without.value}); with: ${withMethod.status} (${withMethod.value})`,
        without.status === 'fail' && withMethod.status === 'pass' && withMethod.value.startsWith(`100% of the substitutions one base change makes (${reachable.size} of ${reachable.size})`) && /error-prone PCR/.test(withMethod.explanation), 'fail, then pass');
    }

    // The feasibility data (external): findings as found, with MaveScape's default scoring for each
    // design (weighted regression for BRCA1's time series, from wave 2).
    const expectations = [
      ['grb2-sh3', 'mavedb-grb2-sh3', 'counts.csv', { 'excess-variance': 'fail' }, 'replicate differences vary about 11× more than counting predicts: the input bottleneck DiMSum\'s error model found in these data'],
      ['brca1-ring-e2', 'mavedb-brca1-ring', 'aa/counts.csv', { dropout: 'review', coverage: 'review', agreement: 'review', 'excess-variance': 'fail', 'time-points': 'review', 'time-fit': 'fail' }, '76% of single substitutions in the library (most of those two and three bases from the wild-type codon too: not a library of single-base changes); variants that dropped out in the last round written as missing (no 0 in the table), so a quarter of the weighted-regression fits miss their last points; time courses that scatter about their lines about 10× more than counting predicts (noise at each round of selection)'],
      ['brca1-ring-e2', 'mavedb-brca1-ring', 'aa/counts.csv', { coverage: 'review', agreement: 'review', 'excess-variance': 'fail', 'time-fit': 'fail' }, 'with the later rounds\' missing counts read as 0 (the design\'s missingMeansZero): the dropouts are counted, every fit uses every round, and the time courses scatter about 7× more than counting predicts', (design) => ({ ...design, samples: design.samples.map((x) => (design.replicates.some((r) => r.timepoints.slice(1).some((t) => t.sample === x.id)) ? { ...x, missingMeansZero: true } : x)) })],
      ['brca1-ring-y2h', 'mavedb-brca1-ring', 'aa/counts.csv', { coverage: 'review', agreement: 'review', 'excess-variance': 'fail', 'outlier-replicate': 'review', separation: 'fail', resolution: 'review', 'time-fit': 'fail' }, 'nonsense variants are not separated from the wild type in the Y2H assay: those before residue 61 score about −3.7, those after residue 110 about +0.5 (truncations that keep the RING domain keep binding BARD1), so most are not loss-of-function controls here; its time courses scatter about 30× more than counting predicts'],
      ['brca1-ring-y2h', 'mavedb-brca1-ring', 'aa/counts.csv', { coverage: 'review', agreement: 'review', 'excess-variance': 'fail', 'outlier-replicate': 'review', 'time-fit': 'fail' }, 'with its nonsense controls limited to positions up to 93, where the unlimited finding finds the stops stop losing BARD1 binding (wave 2, slice 8): the controls separate, and with their gap wider the scores\' resolution passes too', (design) => ({ ...design, controls: { ...design.controls, positions: { nonsense: { end: 93 } }, why: { nonsense: 'Stops before residue 94 lose the RING domain\'s helices that bind BARD1.' } } })],
      ['factor9', 'mavedb-factor9', 'counts.csv', { 'excess-variance': 'fail' }, 'sorted bins, scored by their weighted average (wave 2): replicates of a tile agree, but differ about 2,000× more than counting predicts, since about 10,000 reads per variant per bin far exceed the cells sorted; bin occupancy passes, and the cells per bin are not recorded'],
    ];
    for (const [name, data, path, expected, note, transform] of expectations) {
      const design = (transform ?? ((d) => d))(readDesign(`${name}.design.json`));
      const table = parseTable(dataset(data).bytes(path));
      const names = table.columns.find((c) => c.name === design.variants.column).values;
      const columns = {};
      for (const s of design.samples) for (const c of s.columns) columns[c] = table.columns.find((x) => x.name === c).numeric;
      const t0 = performance.now();
      const parameters = defaultParameters(design);
      const scored = scoreExperiment({ names, columns, design, parameters });
      const qc = computeQC({ names, columns, design, results: scored.ok ? scored.results : null });
      const ms = performance.now() - t0;
      const got = raised(findingsFrom(qc, defaultThresholds()));
      check('qc', `${name} (${parameters.model === 'ratio' ? 'log ratio' : parameters.model.toUpperCase()}, scored and checked in ${ms.toFixed(0)} ms): ${note}`, show(got), matches(got, expected), show(expected));
      // Where BRCA1's Y2H stops stop losing the function (wave 2, slice 8): the finding says, and
      // what to limit the controls to.
      if (name === 'brca1-ring-y2h' && !transform) {
        const sep = findingsFrom(qc, defaultThresholds()).find((f) => f.id === 'separation');
        const change = qc.scores[0].separation?.change;
        check('qc', 'brca1-ring-y2h: the separation finding finds where the stops stop losing BARD1 binding (between residues 61 and 110, as the Y2H data show) and suggests limiting the nonsense controls to the positions before it', change ? `stops up to position ${change.lastControl} median ${change.before.median.toFixed(2)} (${change.before.n}); after it ${change.after.median.toFixed(2)} (${change.after.n}); ${sep.advice.next.find((x) => /Limit the nonsense controls/.test(x.text))?.text ?? 'no suggestion'}` : 'no change point',
          change && change.lastControl >= 60 && change.lastControl < 110 && change.before.median < -3 && Math.abs(change.after.median) < 1 && sep.advice.next.some((x) => x.text.includes(`up to ${change.lastControl}`)), 'a position between 60 and 110, and the suggestion');
      }
    }
  },
  // The variant-effect map (wave 1, slice 7): its SVG against a golden file, every state where the
  // fixture plants it, the states' colors apart from the neutral score color in every theme, the
  // color scale centered on the wild type, the row orders, and on real data the numbering and the
  // positions that must not tolerate substitution.
  map() {
    const fixture = fixtureTable();
    const design = fixtureDesign();
    const parameters = { ...DEFAULT_PARAMETERS, filters: { ...DEFAULT_PARAMETERS.filters, minInputCount: 10 } };
    const results = score(fixture, design, parameters);
    const model = buildMapModel(results, design);
    const svg = mapSVG(model, { results });
    const goldenPath = new URL('./golden/two-population.map.svg', import.meta.url);
    if (process.env.UPDATE_GOLDEN) writeFileSync(goldenPath, svg);
    const golden = existsSync(goldenPath) ? readFileSync(goldenPath, 'utf8') : '';
    check('map', 'the fixture\'s map as SVG equals the golden file (golden/two-population.map.svg)', golden ? (svg === golden ? `identical, ${(svg.length / 1024).toFixed(0)} KB` : `differs (${svg.length} bytes against ${golden.length})`) : 'no golden file: run with UPDATE_GOLDEN=1', svg === golden, 'byte for byte');

    // Each planted state, on its cell.
    const at = (name) => {
      const m = /^p\.([A-Z][a-z]{2})(\d+)([A-Z][a-z]{2}|=)$/.exec(name);
      const one = { Ala: 'A', Arg: 'R', Asn: 'N', Asp: 'D', Cys: 'C', Gln: 'Q', Glu: 'E', Gly: 'G', His: 'H', Ile: 'I', Leu: 'L', Lys: 'K', Met: 'M', Phe: 'F', Pro: 'P', Ser: 'S', Thr: 'T', Trp: 'W', Tyr: 'Y', Val: 'V', Ter: '*' };
      const p = Number(m[2]);
      const letter = m[3] === '=' ? one[m[1]] : one[m[3]];
      return cellAt(model, p, model.rows.indexOf(letter));
    };
    const expected = [
      ['p.Thr9Ala', STATE.FILTERED, '3 input reads, below the minimum of 10'],
      ['p.Gly10Ala', STATE.MISSING, 'not counted in any replicate'],
      ['p.Lys3Arg', STATE.LOW, 'scored from 2 of 3 replicates'],
      ['p.Glu5Ter', STATE.LOW, 'no reads after selection'],
      ['p.Ser2Val', STATE.SCORED, 'measured in every replicate'],
      ['p.Ser2Ala', STATE.MISSING, 'designed, not in the table'],
      ['p.Ser2=', STATE.SCORED, 'the synonymous variant, in the reference residue\'s cell'],
    ];
    const got = expected.map(([name, state, why]) => {
      const cell = at(name);
      return { name, why, state: cell?.state, want: state, ok: cell?.state === state && cellName(model, cell) === name };
    });
    check('map', 'each state where the fixture plants it, and each cell named as MAVE-HGVS', got.map((g) => `${g.name} ${STATE_NAMES[g.state] ?? 'none'} (${g.why})`).join('; '), got.every((g) => g.ok), got.map((g) => `${g.name} ${STATE_NAMES[g.want]}`).join(', '));
    const designed = model.length * model.rows.length;
    const counted = Object.values(model.counts).reduce((a, b) => a + b, 0);
    const references = [...model.reference].filter(Boolean).length;
    check('map', 'every cell has one state; one reference residue per position; nothing off the map in the fixture', `${Object.entries(model.counts).map(([k, v]) => `${STATE_NAMES[k]} ${v}`).join(', ')}; ${references} reference cells; ${model.offMap} off the map`, counted === designed && references === model.length && model.offMap === 0, `${designed} cells, ${model.length} references`);

    // The states never share the neutral score color (PRD), in the light, dark and export themes.
    const css = readFileSync(new URL('../web/styles.css', import.meta.url), 'utf8');
    const tokens = themeTokens(css);
    const mix = (hex, gray) => rgbToHex(hexToRgb(hex).map((v, i) => (v + gray[i]) / 2));
    const rows = [];
    let worst = Infinity;
    for (const [name, theme] of [['light', { empty: tokens.light['map-empty'], hatch: tokens.light['map-hatch'], gray: tokens.light['map-low'].split(',').map(Number) }], ['dark', { empty: tokens.dark['map-empty'], hatch: tokens.dark['map-hatch'], gray: tokens.dark['map-low'].split(',').map(Number) }], ['export', EXPORT_THEME]]) {
      for (const palette of ['rdbu', 'puor']) {
        const neutral = colormapColor(palette, 0.5);
        const d = (a, b) => deltaE2000(labColor(a), labColor(b));
        const missing = d(theme.empty, neutral);
        const hatch = d(mix(theme.empty, hexToRgb(theme.hatch)), neutral);
        const low = d(mix(neutral, theme.gray), neutral);
        worst = Math.min(worst, missing, hatch, low);
        rows.push(`${name} ${palette}: missing ${missing.toFixed(1)}, filtered ${hatch.toFixed(1)}, low confidence ${low.toFixed(1)}`);
      }
    }
    check('map', 'missing, filtered and low-confidence cells are apart from the neutral (wild-type-like) color, CIEDE2000, in every theme and diverging palette', rows.join('; '), worst >= 10, '≥ 10');

    // The scale.
    const wt = results.conditions[0].score[results.controls.wt];
    check('map', 'the score scale is centered on the wild type and symmetric', `wild type ${fmt(wt, 3)} at ${colorPosition(model, wt)}; domain ${fmt(model.domain.min, 2)} to ${fmt(model.domain.max, 2)}`, colorPosition(model, wt) === 0.5 && Math.abs((model.domain.max - model.domain.center) - (model.domain.center - model.domain.min)) < 1e-12, '0.5; symmetric');
    const orders = Object.entries(ROW_ORDERS).map(([k, o]) => [k, [...o.rows].sort().join('') === [...'ACDEFGHIKLMNPQRSTVWY*'].sort().join('')]);
    check('map', 'every row order has the 20 amino acids and stop once', orders.map(([k, ok]) => `${k} ${ok ? 'complete' : 'wrong'}`).join(', '), orders.every(([, ok]) => ok), 'complete');
    const description = describeMap(model, results);
    check('map', 'the map described in words (for screen readers)', description[0], /419 designed/.test(description[0]) && description.length >= 3, 'counts, positions, scale');

    // Real data (external).
    const grb2 = readDesign('grb2-sh3.design.json');
    const g = buildMapModel(score(parseTable(dataset('mavedb-grb2-sh3').bytes('counts.csv')), grb2, DEFAULT_PARAMETERS), grb2);
    check('map', 'GRB2 SH3: 56 positions numbered 1–56 on the target and 159–214 on GRB2 (UniProt P62993)', `${g.length} positions, offset ${g.target.offset}; ${g.counts[STATE.SCORED] + g.counts[STATE.LOW]} scored cells, ${g.counts[STATE.MISSING]} missing`, g.length === 56 && g.target.offset === 158, '56, offset 158');
    const e2 = readDesign('brca1-ring-e2.design.json');
    const e2Results = score(parseTable(dataset('mavedb-brca1-ring').bytes('aa/counts.csv')), e2, DEFAULT_PARAMETERS);
    const b = buildMapModel(e2Results, e2);
    const positions = [];
    for (let p = 1; p <= b.length; p += 1) if (b.columnCount[p - 1] >= 5) positions.push([p + b.target.offset, b.columnMedian[p - 1], b.protein[p - 1]]);
    positions.sort((x, y) => x[1] - y[1]);
    const zinc = new Set([24, 27, 39, 41, 44, 47, 61, 64]);
    const least = positions.slice(0, 5);
    const ligands = least.filter(([p]) => zinc.has(p)).length;
    check('map', 'BRCA1 RING (E2 binding): the positions least tolerant of substitution are the RING domain\'s zinc ligands (C24, C27, C39, H41, C44, C47, C61, C64)', `${least.map(([p, m, aa]) => `${aa}${p} ${m.toFixed(2)}`).join(', ')}; ${ligands} of 5 are zinc ligands; ${b.offMap} multi-variants off the map`, ligands >= 4, '≥ 4 of the 5');
  },
  // The record (wave 1, slice 8): a workspace saved as a .msz archive, reopened and exported again
  // gives the same bytes, for the archive and for every export; exported scores and counts import
  // again without loss; damaged, hostile and foreign archives are caught; the examples and the
  // blank layouts are what they say.
  async roundtrip() {
    const fixtureBytes = new Uint8Array(readFileSync(new URL('./fixtures/two-population.csv', import.meta.url)));
    const cases = [['the synthetic fixture', { bytes: fixtureBytes, design: fixtureDesign(), fileName: 'two-population.csv', name: 'Fixture' }]];
    const grb2Bytes = new Uint8Array(readFileSync(new URL('../web/examples/grb2-sh3/counts.csv', import.meta.url)));
    const grb2Design = JSON.parse(readFileSync(new URL('../web/examples/grb2-sh3/design.json', import.meta.url), 'utf8'));
    cases.push(['the GRB2 SH3 example', { bytes: grb2Bytes, design: grb2Design, fileName: 'counts.csv', name: 'GRB2 SH3' }]);
    // Two conditions compared (limma, as a new run compares them), its differential export too.
    const twoBytes = new Uint8Array(readFileSync(new URL('./fixtures/two-condition.csv', import.meta.url)));
    const twoDesign = JSON.parse(readFileSync(new URL('./fixtures/two-condition.design.json', import.meta.url), 'utf8'));
    cases.push(['the two-condition fixture', { bytes: twoBytes, design: twoDesign, fileName: 'two-condition.csv', name: 'Two conditions', parameters: defaultParameters(twoDesign) }]);
    for (const [label, input] of cases) {
      const built = buildWorkspace(input);
      const exports = allExports(built.ws, built.table, built.results);
      const sources = new Map([[built.ws.sources[0].sha256, built.bytes]]);
      const first = await writeArchive(built.ws, { software: SOFTWARE, sources, results: new Map([[built.run.id, built.results]]), methods: exports.methods });
      const reopened = await readArchive(first.bytes);
      const again = recompute(reopened.ws, reopened.sources);
      const second = await writeArchive(reopened.ws, { software: SOFTWARE, sources: reopened.sources, results: new Map([[reopened.ws.runs[0].id, again.scored.results]]), methods: reopened.methods });
      const same = Buffer.compare(Buffer.from(first.bytes), Buffer.from(second.bytes)) === 0;
      check('roundtrip', `${label}: saved as .msz, reopened (scores recomputed from the archived table) and saved again: the same bytes`, `${(first.bytes.length / 1024).toFixed(0)} KB, ${first.manifest.contents.length + 1} files; ${same ? 'identical' : 'different'}; ${reopened.problems.length} problems`, same && !reopened.problems.length, 'identical, no problems');
      check('roundtrip', `${label}: the reopened workspace is the saved one (history chained, run reproduced)`, `${reopened.ws.history.length} history entries, ${verifyHistory(reopened.ws).ok ? 'unbroken' : 'broken'}; output SHA-256 ${outputDigest(again.scored.results) === reopened.ws.runs[0].output.sha256 ? 'as recorded' : 'different'}`, serializeWorkspace(reopened.ws) === serializeWorkspace(built.ws) && verifyHistory(reopened.ws).ok && outputDigest(again.scored.results) === reopened.ws.runs[0].output.sha256, 'the same');
      const exportsAgain = allExports(reopened.ws, again.table, again.scored.results);
      const differing = Object.keys(exports).filter((k) => k !== 'methods' && exports[k] !== exportsAgain[k]);
      check('roundtrip', `${label}: every export again after reopening, byte for byte (${Object.keys(exports).length - 1} files: scores, counts, QC per sample and per variant, provenance, methods, references, selection, map${exports['differential.csv'] ? ', differential scores' : ''})`, differing.length ? `differ: ${differing.join(', ')}` : 'all identical', !differing.length, 'identical');
      const light = await writeArchive(built.ws, { software: SOFTWARE, sources: null, results: new Map([[built.run.id, built.results]]), methods: exports.methods });
      const lightRead = await readArchive(light.bytes);
      check('roundtrip', `${label}: with checksums only, the archive names the table by its SHA-256 and holds no table`, `${(light.bytes.length / 1024).toFixed(0)} KB; manifest sources "${lightRead.manifest.sources}"; ${lightRead.sources.size} tables; ${lightRead.problems.length} problems`, lightRead.sources.size === 0 && lightRead.manifest.sources === 'checksums' && !lightRead.problems.length && lightRead.ws.sources[0].sha256 === built.ws.sources[0].sha256, 'no table, no problems');

      // Scores out and in: every number back exactly, every NA as NA.
      const scoresTable = parseTable(exports['scores.csv']);
      const col = (n) => scoresTable.columns.find((c) => c.name === n);
      const c0 = built.results.conditions[0];
      let mismatches = 0;
      for (let i = 0; i < built.results.rows; i += 1) {
        const want = c0.reason[i] ? [Number.NaN, Number.NaN] : [c0.score[i], c0.se[i]];
        const got = [col('score').numeric[i], col('SE').numeric[i]];
        if (!want.every((w, j) => Object.is(w, got[j]))) mismatches += 1;
        if ((col('hgvs_pro').values[i] === 'NA' ? '' : col('hgvs_pro').values[i]) !== built.results.variants.key[i]) mismatches += 1;
      }
      const layout = detectLayout(scoresTable);
      check('roundtrip', `${label}: the exported scores read back exactly (every score and SE to the last bit, NA where none), and import as a MaveDB score table`, `${mismatches} differences over ${built.results.rows} variants; layout ${layout.layout}, variants in ${layout.variantColumn}`, !mismatches && layout.layout === 'mavedb-scores' && layout.variantColumn === 'hgvs_pro', '0; mavedb-scores');
      // Counts out and in: scored again, the same output.
      const countsTable = parseTable(exports['counts.csv']);
      const rescored = scoreTable(countsTable, built.run.inputs.design, built.run.inputs.parameters);
      check('roundtrip', `${label}: the exported counts, imported and scored again with the same design and parameters, give the run's output hash`, rescored.ok ? (outputDigest(rescored.results) === built.run.output.sha256 ? 'the same output' : 'a different output') : rescored.errors[0], rescored.ok && outputDigest(rescored.results) === built.run.output.sha256, 'the same');

      // The analysis package (wave 2, slice 10): its files are what mavescape run reads, and
      // scored from them alone the run's output hash comes back; written again, the same bytes.
      const pack = await writePackage(built.ws, { run: built.run, sources, software: SOFTWARE });
      const packAgain = await writePackage(built.ws, { run: built.run, sources, software: SOFTWARE });
      const unpacked = await readZip(pack.bytes);
      const text = (name) => new TextDecoder().decode(unpacked.get(name));
      const packDesign = JSON.parse(text('design.json'));
      const packParameters = JSON.parse(text('parameters.json'));
      const countsName = [...unpacked.keys()].find((n) => n.startsWith('counts/'));
      const fromPackage = scoreTable(parseTable(unpacked.get(countsName), { fileName: countsName }), packDesign, packParameters);
      const readme = text('README.md');
      const listed = [...unpacked.keys()].filter((n) => n !== 'README.md').every((n) => readme.includes(`\`${n}\``)) && readme.includes(`--out results`) && readme.includes(countsName);
      const target = parseFasta(text('target.fasta'))[0];
      const sheet = designFromSampleSheet(parseTable(unpacked.get('samples.csv')), { variants: packDesign.variants, targets: packDesign.targets });
      const sameReadiness = text('readiness.json') === `${JSON.stringify(readiness({ ...built.ws, design: packDesign }), null, 2)}\n`;
      check('roundtrip', `${label}: the analysis package (counts, target, design, sample sheet, parameters, readiness, README) scores from its own files to the run's output hash, and is written the same way twice`, `${[...unpacked.keys()].join(', ')}; ${fromPackage.ok ? (outputDigest(fromPackage.results) === built.run.output.sha256 ? 'the run\'s output hash' : 'a different output') : fromPackage.errors[0]}; counts ${sha256(unpacked.get(countsName)) === built.ws.sources[0].sha256 ? 'byte for byte' : 'changed'}; target ${target?.sequence === packDesign.targets[0].sequence ? 'the design\'s' : 'different'}; sample sheet ${JSON.stringify(designStructure(sheet.design)) === JSON.stringify(designStructure(packDesign)) ? 'the same design' : 'a different design'}; readiness ${sameReadiness ? 'as computed' : 'differs'}; README ${listed ? 'names every file and the command' : 'incomplete'}; ${Buffer.compare(Buffer.from(pack.bytes), Buffer.from(packAgain.bytes)) === 0 ? 'the same bytes' : 'different bytes'}`,
        fromPackage.ok && outputDigest(fromPackage.results) === built.run.output.sha256 && sha256(unpacked.get(countsName)) === built.ws.sources[0].sha256 && target?.sequence === packDesign.targets[0].sequence && JSON.stringify(designStructure(sheet.design)) === JSON.stringify(designStructure(packDesign)) && sameReadiness && listed && Buffer.compare(Buffer.from(pack.bytes), Buffer.from(packAgain.bytes)) === 0, 'all');
    }

    // Damaged, hostile and foreign archives.
    const built = buildWorkspace(cases[0][1]);
    const exports = allExports(built.ws, built.table, built.results);
    const good = await writeArchive(built.ws, { software: SOFTWARE, sources: new Map([[built.ws.sources[0].sha256, built.bytes]]), results: new Map([[built.run.id, built.results]]), methods: exports.methods });
    const files = new Map();
    for (const entry of (await import('../web/lib/zip.js')).listZip(good.bytes)) files.set(entry.name, await (await import('../web/lib/zip.js')).readZipEntry(good.bytes, entry));
    const rezip = (changes) => createZip([...files].map(([name, data]) => ({ name, data })).filter((f) => !(f.name in changes) || changes[f.name] !== null).map((f) => (f.name in changes ? { name: f.name, data: changes[f.name] } : f)).concat(changes.extra ?? []), { date: new Date(built.ws.modified) });
    const text = (bytes) => new TextDecoder().decode(bytes);
    const editedWs = JSON.parse(text(files.get('workspace.json')));
    editedWs.runs[0].inputs.parameters.pseudocount = 0.25;
    const historyEdited = JSON.parse(text(files.get('workspace.json')));
    historyEdited.history[2].detail = 'Imported something else';
    const manifestNewer = JSON.parse(text(files.get('manifest.json')));
    manifestNewer.version = 99;
    const tests = [
      ['a run\'s parameters edited inside workspace.json', { 'workspace.json': JSON.stringify(editedWs) }, /does not have the SHA-256 the manifest records/],
      ['a history entry rewritten (and the manifest made to match)', { 'workspace.json': JSON.stringify(historyEdited), 'manifest.json': JSON.stringify({ ...JSON.parse(text(files.get('manifest.json'))), contents: JSON.parse(text(files.get('manifest.json'))).contents.map((c) => (c.path === 'workspace.json' ? { ...c, sha256: sha256(new TextEncoder().encode(JSON.stringify(historyEdited))) } : c)) }) }, /history does not hold together/],
      ['a table altered', { [`sources/${built.ws.sources[0].sha256}.csv`]: new TextEncoder().encode(`${text(built.bytes)}p.Ala2Val,1,1,1,1,1,1,1\n`) }, /does not have the SHA-256/],
      ['an entry that climbs out of the archive (../escape.txt)', { extra: [{ name: '../escape.txt', data: 'x' }] }, /not part of a MaveScape archive/],
      ['a file missing', { 'methods.md': null }, /missing from the archive/],
    ];
    for (const [what, changes, pattern] of tests) {
      const bytes = await rezip(changes);
      let message;
      try {
        const r = await readArchive(bytes);
        message = r.problems.join(' ') || 'no problem reported';
      } catch (error) {
        message = `refused: ${error.message}`;
      }
      check('roundtrip', `an archive with ${what} is reported`, message.slice(0, 180), pattern.test(message), String(pattern).slice(1, -1));
    }
    for (const [what, bytesOf, pattern] of [
      ['written by a newer MaveScape', async () => rezip({ 'manifest.json': JSON.stringify(manifestNewer) }), /newer MaveScape/],
      ['not from MaveScape (no manifest)', async () => createZip([{ name: 'data.csv', data: 'a,b\n' }]), /no manifest/],
      ['whose entry inflates beyond its declared size (a decompression bomb)', async () => {
        const bytes = await createZip([{ name: 'manifest.json', data: '{}' }, { name: 'methods.md', data: 'x'.repeat(100000) }]);
        // Declare 1,000 bytes for methods.md in its central-directory record.
        const view = new DataView(bytes.buffer);
        for (let i = bytes.length - 22; i >= 0; i -= 1) {
          if (view.getUint32(i, true) !== 0x02014b50) continue;
          const nameLength = view.getUint16(i + 28, true);
          if (new TextDecoder().decode(bytes.subarray(i + 46, i + 46 + nameLength)) === 'methods.md') view.setUint32(i + 24, 1000, true);
        }
        return bytes;
      }, /more than its declared/],
    ]) {
      let message = 'opened';
      try {
        await readArchive(await bytesOf());
      } catch (error) {
        message = error.message;
      }
      check('roundtrip', `an archive ${what} is refused, saying why`, message.slice(0, 160), pattern.test(message), String(pattern).slice(1, -1));
    }

    // The methods: every parameter, the checksum, numbered references with their BibTeX.
    const m = exports.methods;
    const numbered = [...m.markdown.matchAll(/\[(\d+)\]/g)].map((x) => Number(x[1]));
    const firstUse = [...new Set(numbered)];
    check('roundtrip', 'the methods name the table\'s SHA-256, every scoring parameter and the run\'s output hash; references numbered in order of first use, each with a BibTeX entry', `${m.references.length} references (${m.references.map((r) => r.key).join(', ')}); first cited in the order ${firstUse.join(', ')}; ${(m.bibtex.match(/^@/gm) ?? []).length} BibTeX entries`,
      m.markdown.includes(built.ws.sources[0].sha256) && m.markdown.includes('pseudocount of 0.5') && m.markdown.includes('moderated across variants by empirical Bayes') && m.markdown.includes(built.run.output.sha256) && JSON.stringify(firstUse) === JSON.stringify(firstUse.slice().sort((a, b) => a - b)) && (m.bibtex.match(/^@/gm) ?? []).length === m.references.length, 'all');

    // The examples.
    const bundled = sources.datasets['mavedb-grb2-sh3'].files.find((f) => f.path === 'counts.csv');
    const grb2Table = parseTable(grb2Bytes);
    const grb2Result = validateDesign(grb2Design, { columns: grb2Table.columns.map((c) => c.name) });
    check('roundtrip', 'the GRB2 SH3 example: its counts are MaveDB\'s, unchanged (SHA-256 as fetched for validation), and its design fits them', `${sha256(grb2Bytes).slice(0, 16)}… against ${bundled.sha256.slice(0, 16)}…; design ${grb2Result.ok ? 'valid' : grb2Result.errors[0].message}`, sha256(grb2Bytes) === bundled.sha256 && grb2Result.ok, 'the same; valid');
    for (const example of EXAMPLES.filter((e) => e.simulated)) {
      const sim = simulatedExample(example);
      const simAgain = simulatedExample(example);
      // Its files assembled as the window assembles them (a barcoded library's map applied).
      const simTable = assembleTable(sim.files.map((f) => ({ name: f.name, table: parseTable(f.text), role: f.role })), { level: sim.design.variants.level, target: sim.design.targets[0] }).table;
      const parameters = defaultParameters(sim.design);
      const simScored = scoreTable(simTable, sim.design, parameters);
      // Two conditions: the truth is the difference between them, scored by the run's differential.
      const differential = sim.truthOf === 'differential';
      const simC = differential ? { score: simScored.results.differential[0].delta, reason: simScored.results.differential[0].reason } : simScored.results.conditions[0];
      const a = [];
      const b = [];
      simScored.results.variants.key.forEach((k, i) => { if (!simC.reason[i] && k in sim.truth && k !== 'p.=') { a.push(simC.score[i]); b.push(sim.truth[k]); } });
      if (sim.files.length > 1) check('roundtrip', `the example "${example.title}": its counts and barcode map assemble into a table its design fits`, `${simTable.rows} barcodes; ${simScored.results.barcodes?.unmapped ?? 0} unmapped`, validateDesign(sim.design, { columns: simTable.columns.map((c) => c.name) }).ok && simScored.results.barcodes?.unmapped > 0, 'valid; some unmapped, as planted');
      const simQc = findingsFrom(computeQC({ ...inputFor(simTable, sim.design), design: sim.design, results: simScored.results }), defaultThresholds());
      const raisedSim = Object.fromEntries(simQc.filter((f) => f.status === 'review' || f.status === 'fail').map((f) => [f.id, f.status]));
      const expectedQc = example.findings ?? {};
      const minimum = differential ? 0.95 : 0.98;
      check('roundtrip', `the example "${example.title}": the same data from its seed, labeled simulated, scored by ${MODELS[parameters.model]}${differential ? `, its conditions compared by ${parameters.differential},` : ''} close to the true ${differential ? 'differences' : 'effects'}, and QC raises exactly the findings it teaches (${simQc.length} findings)`, `${sim.csv === simAgain.csv ? 'deterministic' : 'not deterministic'}; Pearson r ${pearson(a, b).toFixed(3)} over ${a.length} variants; QC ${Object.keys(raisedSim).length ? Object.entries(raisedSim).map(([k, v]) => `${k}: ${v}`).join(', ') : 'all pass'}`, sim.csv === simAgain.csv && /simulated/i.test(sim.design.name) && /not real data/.test(sim.design.description) && pearson(a, b) > minimum && JSON.stringify(raisedSim) === JSON.stringify(expectedQc), `r > ${minimum}; ${Object.keys(expectedQc).length ? Object.entries(expectedQc).map(([k, v]) => `${k}: ${v}`).join(', ') : 'all pass'}`);
    }
    // An acknowledged finding (wave 2, slice 8): GRB2's variance beyond counting, which the
    // Domainome's analysis expected. Its status stays; the reason survives the archive and is in the
    // history, the methods, the QC findings and the provenance; withdrawn, it is gone.
    {
      const built = buildWorkspace(cases[1][1]);
      const run = built.ws.runs[0];
      const thresholds = withDefaultThresholds(built.ws.qc?.thresholds);
      const qc = computeQC({ ...inputFor(built.table, run.inputs.design), design: run.inputs.design, results: built.results, measures: measuresOf(thresholds) });
      const plain = findingsFrom(qc, thresholds);
      const finding = plain.find((f) => f.id === 'excess-variance');
      const reason = 'The input bottleneck the Domainome\'s own analysis reported; DiMSum\'s error model carries it into the SEs';
      const acked = acknowledgeFinding(built.ws, finding, reason, '2026-10-09T12:10:00.000Z');
      const archive = await writeArchive(acked, { software: SOFTWARE, sources: new Map([[acked.sources[0].sha256, built.bytes]]), results: new Map([[run.id, built.results]]), methods: null });
      const reopened = await readArchive(archive.bytes);
      const after = findingsFrom(qc, thresholds, { acknowledged: reopened.ws.qc?.acknowledged });
      const f = after.find((x) => x.id === 'excess-variance');
      const [o0, o1] = [overall(plain), overall(after)];
      const made = allExports(reopened.ws, built.table, built.results);
      const kept = {
        status: f.status === finding.status && o1.status === o0.status,
        current: Boolean(f.acknowledged?.current),
        counted: o1.unacknowledged.fail === o0.counts.fail - 1 && o1.acknowledged.includes('excess-variance'),
        history: reopened.ws.history.at(-1).detail.includes(reason) && verifyHistory(reopened.ws).ok && !reopened.problems.length,
        methods: made['methods.md'].includes(`("${reason}")`),
        csv: made['qc_findings.csv'].split('\n').find((l) => l.startsWith('excess-variance,'))?.includes(reason),
        provenance: JSON.parse(made['provenance.json']).qc.findings.find((x) => x.id === 'excess-variance').acknowledged?.reason === reason,
      };
      const withdrawn = acknowledgeFinding(reopened.ws, f, '');
      const refused = [plain.find((x) => x.status === 'pass')].map((x) => { try { acknowledgeFinding(built.ws, x, 'why'); return 'accepted'; } catch (e) { return 'refused'; } });
      check('roundtrip', 'an acknowledged finding (GRB2\'s variance beyond counting) keeps its status; the reason survives the archive and is in the history, the methods, the QC findings and the provenance; withdrawn, it is gone; a finding that passes cannot be acknowledged', `${Object.entries(kept).map(([k, v]) => `${k} ${v ? 'yes' : 'NO'}`).join(', ')}; withdrawn: ${withdrawn.qc?.acknowledged ? 'still there' : 'gone'}; a pass: ${refused[0]}`,
        Object.values(kept).every(Boolean) && !withdrawn.qc?.acknowledged && withdrawn.qc?.thresholds && refused[0] === 'refused', 'all');
    }
    // Archives that keep opening (roadmap, "In every wave"): a workspace saved by each release
    // (validation/archives/), opened by this MaveScape, each run recomputed from its recorded
    // inputs, and everything a reopened workspace makes made again.
    for (const file of readdirSync(new URL('./archives/', import.meta.url)).filter((f) => f.endsWith('.msz')).sort()) {
      const opened = await readArchive(new Uint8Array(readFileSync(new URL(`./archives/${file}`, import.meta.url))));
      const release = opened.manifest.software?.version ?? '?';
      const chain = verifyHistory(opened.ws);
      check('roundtrip', `${file}, saved by MaveScape ${release}, opens: every file's SHA-256 as its manifest records, the history's chain unbroken`, `${opened.ws.runs.length} runs, ${opened.ws.selections.length} selections, ${chain.entries} history entries; ${opened.problems.length ? opened.problems[0] : 'no problems'}`, !opened.problems.length && chain.ok, 'no problems');
      let last = null;
      for (const run of opened.ws.runs) {
        const recorded = recordedInputs(run);
        const t = parseTable(opened.sources.get(recorded.source.sha256), { fileName: run.inputs.source.fileName });
        const again = scoreTable(t, recorded.design, recorded.parameters, recorded.mapping.mode);
        if (!again.ok) {
          check('roundtrip', `${file}: ${run.name} is recomputed`, again.errors[0], false, 'scored');
          continue;
        }
        last ??= { run, table: t, results: again.results };
        const verdict = reproduction(run, outputDigest(again.results), 'this version');
        // Against the scores the archive holds for the run (results/<run>.csv), when it holds them.
        const held = opened.results.get(`results/${run.id}.csv`);
        let worst = 0;
        if (held) {
          const scores = parseTable(new TextEncoder().encode(held));
          const col = (name) => scores.columns.find((c) => c.name === name).numeric;
          const [score, se] = [col('score'), col('SE')];
          const c = again.results.conditions[0];
          for (let i = 0; i < c.score.length; i += 1) {
            if (Number.isFinite(score[i]) !== Number.isFinite(c.score[i])) worst = Infinity;
            else if (Number.isFinite(score[i])) worst = Math.max(worst, Math.abs(c.score[i] - score[i]) / Math.max(1, Math.abs(score[i])), Math.abs(c.se[i] - se[i]) / Math.max(1, se[i]));
          }
        }
        const older = run.inputs.scoring !== SCORING_VERSION;
        const ok = verdict.status === 'reproduced' || (older && /differ only in their last digits/.test(verdict.message) && worst <= 1e-12);
        // Scoring engine 1 (0.1.0) took its logarithms from the JavaScript engine: Node's are
        // fdlibm's, as dmath.js's, so here its runs reproduce; scored in another browser, they
        // would differ in their last digits, and say so.
        check('roundtrip', `${file}: ${run.name} recomputed from its recorded inputs has its recorded output hash${older ? ` (or, scored with engine ${run.inputs.scoring}'s browser logarithms, differs only in its last digits and says so)` : ''}`, `${verdict.status}${held ? `; against the archived scores, largest relative difference ${worst.toExponential(1)}` : ''}`, ok, older ? 'reproduced, or says so and ≤ 1e-12 from the archived scores' : 'reproduced');
      }
      if (last) {
        // The reopened workspace makes its QC (with its own thresholds), exports and methods.
        const made = allExports({ ...opened.ws, runs: [last.run] }, last.table, last.results);
        const thresholds = withDefaultThresholds(opened.ws.qc?.thresholds);
        check('roundtrip', `${file}: the reopened workspace keeps its QC thresholds and selection, and makes its exports and methods`, `replicate agreement review at ${thresholds.agreement.review}; selection "${opened.ws.selections[0]?.name}" of ${opened.ws.selections[0]?.keys.length} variants; ${Object.keys(made).length - 1} files`, Object.values(made).every((x) => x) && made['methods.md'].includes(last.run.output.sha256) && opened.ws.qc?.thresholds?.agreement?.review === thresholds.agreement.review, 'all made');
      }
    }
    check('roundtrip', 'every example has a question, source, license, what to expect, the view it opens and its steps', EXAMPLES.map((e) => `${e.id}: ${e.steps.length} steps, opens ${e.opens}`).join('; '), EXAMPLES.every((e) => e.question && e.source && e.license && e.expected.length && e.steps.length && ['qc', 'score', 'map', 'experiment'].includes(e.opens)), 'all');
    // The blank layouts: filled in as they say, they make a valid design.
    const layoutTable = parseTable(new Uint8Array(readFileSync(new URL('../web/examples/layouts/count-table.csv', import.meta.url))));
    const sheet = parseTable(new Uint8Array(readFileSync(new URL('../web/examples/layouts/sample-sheet.csv', import.meta.url))));
    const fasta = parseFasta(readFileSync(new URL('../web/examples/layouts/target.fasta', import.meta.url), 'utf8'))[0];
    const layoutTarget = targetFromSequence(fasta).target;
    const layoutDesign = designFromSampleSheet(sheet, { countColumns: detectLayout(layoutTable).countColumns, variants: { column: 'hgvs_pro', level: 'protein' }, targets: [layoutTarget] });
    const layoutReview = reviewImport(layoutTable, { variantColumn: 'hgvs_pro', level: 'protein', countColumns: detectLayout(layoutTable).countColumns, target: layoutTarget });
    const layoutValid = validateDesign(layoutDesign.design, { columns: layoutTable.columns.map((c) => c.name) });
    check('roundtrip', 'the blank layouts (count table, sample sheet, target FASTA) read as they say and make a valid design', `${layoutTable.rows} example rows, ${layoutReview.summary.valid} valid names, ${layoutReview.summary.invalid} invalid; design ${layoutValid.ok ? 'valid' : layoutValid.errors[0].message}; ${layoutTable.diagnostics.map((d) => d.code).join(', ')}`, layoutValid.ok && layoutReview.summary.invalid === 0 && !layoutReview.blocking.length, 'valid');
  },

  // Wave 2, slice 10 (E8): what each analysis can do with what a workspace holds. Every example and
  // fixture, whole and with one part taken away: the readiness model names exactly what was taken
  // away, and its verdict on every analysis agrees with what the engine does (scored or refused;
  // a QC finding assessed or not). An analysis it leaves out for a design must be one the engine
  // cannot do there either.
  readiness() {
    const agree = (c) => {
      const { probes, scored } = probe(c);
      const status = new Map(c.readiness.analyses.map((a) => [a.id, a.status !== 'unavailable']));
      const disagree = [];
      for (const [id, possible] of probes) {
        if (!status.has(id)) {
          if (possible) disagree.push(`${id}: the engine does it, readiness leaves it out`);
        } else if (status.get(id) !== possible) disagree.push(`${id}: readiness ${status.get(id) ? 'possible' : 'not possible'}, the engine ${possible ? 'does it' : 'does not'}`);
      }
      return { disagree, probed: [...probes.keys()].filter((id) => status.has(id)).length, scored };
    };
    let cases = 0;
    for (const d of readinessDatasets()) {
      const whole = caseOf(d.table, d.design);
      const r = whole.readiness;
      const a = agree(whole);
      cases += 1;
      check('readiness', `${d.name}: every verdict agrees with the engine`, a.disagree.length ? a.disagree.join('; ') : `${r.analyses.length} analyses (${r.counts.ready} ready, ${r.counts.partial} partial, ${r.counts.unavailable} not possible); ${a.probed} probed, all agree; missing: ${r.gaps.map((g) => g.id).join(', ') || 'nothing'}`, !a.disagree.length && a.scored, 'all agree; scored with the defaults');
      const was = new Map(r.analyses.map((x) => [x.id, x.status]));
      const before = new Set(r.gaps.map((g) => g.id));
      for (const removal of REMOVALS) {
        if (!removal.applies(whole)) continue;
        const taken = removal.apply(whole);
        const c = caseOf(taken.table, taken.design);
        const named = c.readiness.gaps.map((g) => g.id).filter((g) => !before.has(g));
        const expected = removal.gaps(whole.design, taken.design);
        const exact = named.length === expected.length && expected.every((g) => named.includes(g));
        const disabled = c.readiness.analyses.filter((x) => x.status === 'unavailable' && was.get(x.id) !== 'unavailable').map((x) => x.id);
        const b = agree(c);
        cases += 1;
        check('readiness', `${d.name}, without ${removal.what}: names exactly that, and every verdict agrees with the engine`, `names ${named.join(', ') || 'nothing'}; disables ${disabled.join(', ') || 'nothing'}${b.disagree.length ? `; disagrees: ${b.disagree.join('; ')}` : ''}`, exact && !b.disagree.length, `names ${expected.join(', ') || 'nothing'}; all agree`);
      }
    }
    check('readiness', 'cases', `${cases} workspaces, whole and with a part taken away`, cases >= 60, '≥ 60');
    // Before there is anything to analyze: the files every analysis needs, nothing else.
    const empty = readiness(createWorkspace('empty', { now: '2026-10-10T12:00:00.000Z', id: 'ws-empty' }));
    check('readiness', 'an empty workspace: needs the counts, the target and the design, and lists no analysis', `${empty.gaps.map((g) => g.id).join(', ')}; ${empty.analyses.length} analyses`, empty.gaps.map((g) => g.id).join() === 'counts,target,design' && !empty.analyses.length, 'counts, target, design; none');
    const grb2 = readinessDatasets()[0];
    const broken = JSON.parse(JSON.stringify(grb2.design));
    broken.replicates[0].output = 'no-such-sample';
    const invalid = caseOf(grb2.table, broken).readiness;
    check('readiness', 'a design with a problem: the design is the gap, with its first problem', `${invalid.gaps.map((g) => `${g.id}${g.detail ? ` (${g.detail})` : ''}`).join('; ')}; ${invalid.analyses.length} analyses`, invalid.gaps.length === 1 && invalid.gaps[0].id === 'design' && Boolean(invalid.gaps[0].detail) && !invalid.analyses.length, 'design, with why');
  },
};

// --- Run ------------------------------------------------------------------------------------------

const names = requested.length ? requested : Object.keys(suites);
const skipped = [];
const started = performance.now();
for (const name of names) {
  if (!suites[name]) {
    console.error(`Unknown suite ${name}. Suites: ${Object.keys(suites).join(', ')}`);
    process.exit(2);
  }
  const t0 = performance.now();
  try {
    await suites[name]();
  } catch (error) {
    if (error instanceof MissingData) {
      skipped.push(name);
      console.log(`- ${name}: skipped (external data: ${error.message})`);
      if (requireData) check(name, 'external data present', error.message, false, 'present (--require-data)');
      continue;
    }
    check(name, 'suite ran', error.stack?.split('\n').slice(0, 3).join(' | ') ?? error.message, false, 'no error');
  }
  const mine = results.filter((r) => r.suite === name);
  console.log(`${mine.every((r) => r.ok) ? '✓' : '✗'} ${name}: ${mine.filter((r) => r.ok).length}/${mine.length} checks (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed in ${((performance.now() - started) / 1000).toFixed(1)} s.`);
if (skipped.length) console.log(`Skipped for want of external data: ${skipped.join(', ')} (node validation/fetch.mjs downloads it).`);
if (failed.length) process.exit(1);
