// MaveScape's validation suite. Unit tests (web/lib/*.test.mjs) check functions in isolation; this
// suite runs whole pipelines on fixtures and published data whose answers are known (committed
// outputs of the reference tools, validation/reference/), and reports how closely MaveScape
// agrees, against stated tolerances (mavescape-spec/requirements.md, T1–T2).
//
//   node validation/run.mjs [suite …] [--verbose] [--require-data]
//
// Suites: accessibility, designs (external data), enrich2 (external data), hgvs, consequences
// (external data), import (external data), experiment (external data), scoring, qc, map and
// roundtrip (their last checks need external data), readiness, examples (its last checks need
// external data), public-data, mavedb-export, annotations, compare and robustness (their last checks
// need external data), selections, structures; all by default. UPDATE_GOLDEN=1 rewrites the golden files (validation/golden/) instead of
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
import { multiTileSamples, sharedSamples, summarizeDesign, validateDesign } from '../web/lib/design.js';
import { parseHgvs, formatPosition, targetMismatches } from '../web/lib/hgvs.js';
import { codingFrame, consequenceOf, nucleotideMismatches } from '../web/lib/consequence.js';
import { compareConsequences, compareDimsumAggregate, compareGenBank, sameProtein, transcriptOf } from './consequence-cases.mjs';

import { cellText, columnText, createTableParser, parseTable } from '../web/lib/csv.js';
import { detectLayout, draftDesign, namesFromSequences, reviewImport, suggestRoles } from '../web/lib/importer.js';
import { buildCountSet, joinCountTables } from '../web/lib/counts.js';
import { buildVariants, KIND, KIND_NAMES, summarizeVariants } from '../web/lib/variants.js';
import { parseFasta, targetFromSequence, targetProtein } from '../web/lib/target.js';
import { createRandom, shuffle } from '../web/lib/random.js';
import { meaning, modelRoundTrip, rebuild } from './experiment-cases.mjs';
import { designFromSampleSheet, designStructure, sampleSheetCSV } from '../web/lib/samplesheet.js';
import { readinessDatasets, REMOVALS, caseOf, probe, workspaceOf } from './readiness-cases.mjs';
import { writePackage } from '../web/lib/package.js';
import { cachedRecord, EXAMPLE_DATASETS, exampleRecords, MissingExampleData, openExampleInNode, raisedOf, recordTable, recordTarget } from './example-cases.mjs';
import { proteinChange } from '../web/lib/codons.js';
import { placeTarget, placementPatch, readUniProtEntry, referenceOf, uniparcEntries } from '../web/lib/uniprot.js';
import { countsDesign, mappedCSV, mappedVariants, readMapped, readoutOf, readScoreSet, scoresDesign, targetsOf } from '../web/lib/mavedb.js';
import { writeMethods } from '../web/lib/methods.js';
import { intervalOf } from '../web/lib/exports.js';
import { readZip } from '../web/lib/zip.js';
import { readiness } from '../web/lib/readiness.js';
import { acknowledgeFinding, addSource, addTarget, createWorkspace, parseWorkspace, recordTargetCheck, serializeWorkspace, setDesign, updateTarget, verifyHistory } from '../web/lib/workspace.js';
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
import { exampleContext, fixture as annotationFixture, nodeTracks, publicAnnotations, reference as annotationReference } from './annotation-cases.mjs';
import { annotationTracks, providerById as annotationProvider } from '../web/lib/providers/index.js';
import { readProfile } from '../web/lib/providers/pdbe.js';
import { readClinVarTable } from '../web/lib/providers/clinvar.js';
import { gnomadRows } from '../web/lib/providers/gnomad.js';
import { clinvarClass, REVIEW_STARS, tracksCSV } from '../web/lib/tracks.js';
import { addAnnotation } from '../web/lib/workspace.js';
import { createHash } from 'node:crypto';
import { proteinView } from '../web/lib/collapse.js';
import { spearman } from '../web/lib/stats.js';
import { adjustBH, tQuantile, tTwoSided } from '../web/lib/distributions.js';
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
import { colormapLUT, hexToRgb, rgbToHex } from '../web/lib/colormaps.js';
import { writeFileSync } from 'node:fs';
import { SOFTWARE, allExports, buildWorkspace, inputFor, recompute, scoreTable } from './roundtrip-cases.mjs';
import { assembleTable } from '../web/lib/assemble.js';
import { readArchive, writeArchive } from '../web/lib/archive.js';
import { createZip } from '../web/lib/zip.js';
import { sha256 } from '../web/lib/sha256.js';
import { EXAMPLES, exampleById, simulatedExample } from '../web/lib/examples.js';
import { depositPackages, exampleRoundTrip, mavedbHashes, roundTrip } from './mavedb-export-cases.mjs';
import { agreementOf, aucAgreement } from '../web/lib/agreement.js';
import { classesCSV, compareSides, comparisonCSV, comparisonJSON, describeScoreSet, describeSide, differenceMap } from '../web/lib/compare.js';
import { countsRun, coverage, exampleRun, movedRun, plantedPair, predictorSide, publishedRun, scoreSetSide, syntheticPair, together, twoAssays } from './compare-cases.mjs';
import { scoreSetResults } from '../web/lib/scoreset.js';
import { callsOf, CLASS, replicateDispersion, robustnessCSV, robustnessJSON, robustnessPositionsCSV, ROBUSTNESS_SEED, specificationInputs, specifications, VERDICT } from '../web/lib/robustness.js';
import { checkPlanted, checkTable } from './robustness-cases.mjs';
import { combineKeys, evaluateQuery, featuresOf, parseQuery, queryContext, QueryError, queryUses, selectByQuery } from '../web/lib/query.js';
import { cellsInPolygon, geometry, hitTest } from '../web/lib/map-render.js';
import { readUniProtFeatures, uniprotTracks } from '../web/lib/providers/uniprot-features.js';
import { selectionCSV, selectionJSON } from '../web/lib/exports.js';
import { addSelection } from '../web/lib/workspace.js';
import { circle, circleCells, mapCells } from './selections-cases.mjs';
import { normalCdf, normalUpper } from '../web/lib/dmath.js';
import { MAVEDB_KEYWORDS } from '../web/lib/readout.js';
import { EXAMPLE_STRUCTURES, atomLines, cachedBytes, cachedJSON, exampleTarget, middle, modelFile, openCached, openFixture, pdbFile, positionScores, siftsOf, siftsRetrieved } from './structure-cases.mjs';
import { calibrationClasses, cellsAtPositions, coloringPalette, placeOnTarget, POSITION, POSITION_NAMES, positionRanges, positionsOfKeys, positionValues, QC_CLASSES, residueColors, STATE_COLORS, thresholdClasses } from '../web/lib/structure-scores.js';
import { describeMapping, mapTarget, mapTargetOnChain, rankStructures } from '../web/lib/mapping.js';
import { assemblyChoices, chainSummaries, readStructureBytes } from '../web/lib/structures.js';
import { deriveStructure, materializeAssemblyModels } from '../web/lib/structure/structure.js';
import { buildCartoon } from '../web/lib/structure/cartoon.js';
import { buildScene } from '../web/lib/structure/scene.js';
import { cifTable, parseCIFDocument } from '../web/lib/structure/parse.js';
import { residueKeysFromMask, selectAtoms } from '../web/lib/structure/select.js';

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
// A file of an external data set (validation/cache), or MissingExampleData naming its data set.
const cachePath = (relative) => {
  const url = new URL(`./cache/${relative}`, import.meta.url);
  if (!existsSync(url)) throw new MissingExampleData(`needs ${relative}: node validation/fetch.mjs ${relative.split('/')[0]}`);
  return url;
};

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
    // mavehgvs's own tests against a target sequence (wave 3, slice 3): protein variants by
    // hgvs.js's check, nucleotide variants by consequence.js's (the target read from its first base).
    const against = reference.targets.map((t) => {
      const p = parseHgvs(t.s);
      const ok = p.ok && !(p.prefix === 'p' ? targetMismatches(p, t.target) : nucleotideMismatches(p, codingFrame({ sequenceType: 'dna', sequence: t.target, codingStart: 1 }))).length;
      return { ...t, ours: ok };
    });
    const differ = against.filter((t) => t.ours !== t.ok);
    check('hgvs', `against a target sequence, valid or not as mavehgvs decides: its own tests (${against.length} pairs, ${against.filter((t) => t.ok).length} valid)`, `${differ.length ? `${differ.length}: ${differ.slice(0, 3).map((t) => `${t.s} on ${t.target}`).join('; ')}` : 0} disagree`, against.length >= 50 && !differ.length, '0');
  },

  // Full MAVE-HGVS (wave 3, slice 3): each nucleotide variant's protein change against biocommons
  // hgvs's (reference/consequences.json), the targets from GenBank against Biopython's reading
  // (reference/genbank.json), the merge at the protein level against DiMSum's own code
  // (reference/dimsum-aggregate.json), the protein names published beside nucleotide names, and
  // every variant of the imported records read against its target.
  consequences() {
    const reference = JSON.parse(readFileSync(new URL('./reference/consequences.json', import.meta.url), 'utf8'));
    const counted = reference.transcripts.map((t) => `${t.transcript} ${t.published} published + ${t.generated} generated`).join('; ');
    check('consequences', 'reference made with', `biocommons hgvs ${reference.versions.hgvs}, Biopython ${reference.versions.biopython}: ${counted}`, reference.versions.hgvs === '1.5.7', 'hgvs 1.5.7');
    const compared = compareConsequences(reference);
    check('consequences', `each nucleotide variant's protein change as biocommons hgvs's, in MAVE-HGVS's forms (${compared.compared} variants on three transcripts: substitutions, nonsense, frameshifts, start and stop lost, deletions, insertions, duplications, deletion-insertions, UTR and splice)`, `${compared.agree} agree (${Object.entries(compared.byForm).map(([k, v]) => `${k} ${v}`).join(', ')}); ${compared.disagree.length ? `${compared.disagree.length} differ: ${compared.disagree.slice(0, 3).map((d) => `${d.c} ${d.theirs} → ${d.ours}`).join('; ')}` : 'none differs'}`, compared.compared >= 16000 && !compared.disagree.length, 'all');

    // GenBank: four records as Biopython reads them.
    const genbank = compareGenBank(JSON.parse(readFileSync(new URL('./reference/genbank.json', import.meta.url), 'utf8')));
    check('consequences', 'GenBank records read as Biopython reads them (two RefSeq mRNAs, a plasmid of three coding features, one on the reverse strand, and a gene joined from three exons): each record\'s fields and sequence, every feature\'s location, each coding feature\'s bases, translation and check against the record\'s own', `${genbank.records} records, ${genbank.features} features, ${genbank.coding} coding; ${genbank.differ.length ? `${genbank.differ.length} differ: ${genbank.differ.slice(0, 3).map((d) => `${d.record} ${d.field}`).join('; ')}` : 'none differs'}`, genbank.records === 4 && genbank.coding === 6 && !genbank.differ.length, 'all');

    // Every variant of the imported records, against its target: the feasibility tables, the
    // examples' and the records with a transcript for their target.
    const rec = (urn) => readScoreSet(JSON.parse(readFileSync(new URL(`fixtures/public-data/mavedb/${urn.replaceAll(':', '_')}.json`, import.meta.url), 'utf8')));
    const designs = Object.fromEntries(DESIGN_CASES.map((c) => [c.name, readDesign(c.design)]));
    const example = (id) => JSON.parse(readFileSync(new URL(`../web/${exampleById(id).files.design}`, import.meta.url), 'utf8'));
    const cbs = cbsCase(dataset('mavedb-cbs')).design.targets[0];
    const tables = [
      ['GRB2 SH3 (counts)', 'mavedb-grb2-sh3', 'counts.csv', 'protein', example('grb2-sh3').targets[0]],
      ['BRCA1 RING, amino acids', 'mavedb-brca1-ring', 'aa/counts.csv', 'protein', designs['brca1-ring-e2'].targets[0]],
      ['BRCA1 RING, nucleotides', 'mavedb-brca1-ring', 'nt/counts.csv', 'nucleotide', designs['brca1-ring-e2'].targets[0]],
      ['factor IX', 'mavedb-factor9', 'counts.csv', 'protein', designs.factor9.targets[0]],
      ['Hsp90 (codons)', 'mavedb-hsp90', 'counts.csv', 'nucleotide', example('hsp90').targets[0]],
      ['CBS, low B6', 'mavedb-cbs', 'low-b6-counts.csv', 'nucleotide', cbs],
      ['CBS, high B6', 'mavedb-cbs', 'high-b6-counts.csv', 'nucleotide', cbs],
      ['PTEN (scores)', 'mavedb-pten-vampseq', 'scores.csv', 'protein', recordTarget(rec('urn:mavedb:00000013-a-1'))],
      ['BRCA1 SGE (scores; NM_007294.3)', 'mavedb-brca1-sge', 'scores.csv', 'nucleotide', recordTarget(rec('urn:mavedb:00000097-0-2'))],
      ['BRCA1 SGE (counts)', 'mavedb-brca1-sge', 'counts.csv', 'nucleotide', recordTarget(rec('urn:mavedb:00000097-0-2'))],
      ['TP53 DNA-binding domain (NM_000546.6)', 'mavedb-tp53-dbd', 'scores.csv', 'nucleotide', recordTarget(rec('urn:mavedb:00001277-a-1'))],
      ['BAP1 exon 1 (ENST00000460680.5, read on .6)', 'mavedb-bap1-sge', 'scores.csv', 'nucleotide', recordTarget(rec('urn:mavedb:00000662-a-2'))],
      ['TP53 base editing (ENST00000269305.9)', 'mavedb-tp53-base-editing', 'scores.csv', 'nucleotide', recordTarget(rec('urn:mavedb:00001245-a-1'))],
    ];
    const lines = [];
    let all = true;
    let names = 0;
    let badNames = [];
    const kinds = {};
    const readTables = new Map();
    for (const [label, set, path, level, target] of tables) {
      const table = parseTable(dataset(set).bytes(path));
      readTables.set(label, { table, target });
      const column = level === 'protein' ? 'hgvs_pro' : 'hgvs_nt';
      const v = buildVariants(columnText(table.columns.find((c) => c.name === column)), { level, target });
      const s = summarizeVariants(v);
      if (v.proKey) {
        for (let i = 0; i < v.n; i += 1) {
          if (!v.proKey[i]) continue;
          names += 1;
          if (!parseHgvs(v.proKey[i]).ok) badNames.push(v.proKey[i]);
          kinds[KIND_NAMES[v.kind[i]]] = (kinds[KIND_NAMES[v.kind[i]]] ?? 0) + 1;
        }
      }
      lines.push(`${label}: ${s.valid + s.warning} of ${s.total}${s.warning ? ` (${s.warning} leniently)` : ''}`);
      all &&= s.invalid === 0 && s.total > 0;
    }
    check('consequences', 'every variant of the imported records parses and agrees with its target: the feasibility tables, the examples\' and the records whose target is a transcript (fetched as NCBI and Ensembl send them)', lines.join('; '), all, 'every one');
    // Their protein changes, and the reference's, are MAVE-HGVS as mavehgvs reads it (strict).
    for (const entry of reference.transcripts) {
      const frame = codingFrame(transcriptOf(entry));
      for (const [c] of entry.variants) {
        const parsed = parseHgvs(c, { mode: 'lenient' });
        const out = parsed.ok ? consequenceOf(parsed, frame) : null;
        if (out?.protein) {
          names += 1;
          if (!parseHgvs(out.protein).ok) badNames.push(out.protein);
        }
      }
    }
    badNames = [...new Set(badNames)];
    check('consequences', 'every protein change MaveScape names is MAVE-HGVS, strict (as mavehgvs reads it)', `${names} names (of the records: ${Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${k}`).join(', ')}); ${badNames.length ? `${badNames.length} not: ${badNames.slice(0, 3).join(', ')}` : 'all are'}`, names > 20000 && !badNames.length, 'all');

    // The protein names the records publish beside their nucleotide names: the same protein.
    const published = [['TP53 base editing (ENST00000269305.9)', 465], ['CBS, low B6', 11478], ['CBS, high B6', 10802], ['BRCA1 RING, nucleotides', 20724], ['Hsp90 (codons)', 568]];
    const pubLines = [];
    let pubAll = true;
    for (const [label, rows] of published) {
      const { table, target } = readTables.get(label);
      const nt = columnText(table.columns.find((c) => c.name === 'hgvs_nt'));
      const pro = columnText(table.columns.find((c) => c.name === 'hgvs_pro'));
      const v = buildVariants(nt, { level: 'nucleotide', target });
      let exact = 0;
      let same = 0;
      const differ = [];
      pro.forEach((p, i) => {
        const theirs = p.replace(/^[^:]+:(?=p\.)/, '');
        if (v.proKey[i] === theirs) exact += 1;
        if (sameProtein(theirs, v.proKey[i], KIND_NAMES[v.kind[i]])) same += 1;
        else differ.push(`${nt[i]}: ${theirs}, not ${v.proKey[i]}`);
      });
      pubLines.push(`${label}: ${same} of ${table.rows} (${exact} written alike)${differ.length ? `; ${differ.slice(0, 2).join('; ')}` : ''}`);
      pubAll &&= table.rows === rows && same === rows;
    }
    check('consequences', 'the protein names the records publish beside their nucleotide names describe the protein MaveScape\'s translation makes (written alike, or as MaveScape writes them: p.Asp41= for p.Asp41Asp, a substitution\'s codon left synonymous unnamed, nothing after a stop, a change of the start codon start lost)', pubLines.join('; '), pubAll, 'every one');

    // Several targets: VarChAMP's 28 genes, each opened on its own, the others' variants set aside.
    {
      const record = rec('urn:mavedb:00001237-a-1');
      const table = parseTable(dataset('mavedb-varchamp').bytes('scores.csv'));
      const names = columnText(table.columns.find((c) => c.name === 'hgvs_nt'));
      const choices = targetsOf(record).choices;
      let read = 0;
      let elsewhere = true;
      for (const choice of choices) {
        const { targets, others } = targetsOf(record, { target: choice.label });
        const v = buildVariants(names, { level: 'nucleotide', target: targets[0] });
        const s = summarizeVariants(v);
        read += s.valid + s.warning;
        elsewhere &&= s.invalid === 0 && s.otherTarget + s.valid + s.warning === names.length && others.length === choices.length - 1;
      }
      const genome = targetsOf(rec('urn:mavedb:00001228-a-1'));
      check('consequences', 'a score set of several targets (VarChAMP, 28 genes) opened one target at a time: each one\'s variants valid on it, the others\' set aside; a genome named as the target (DDX3X\'s saturation genome editing, NC_000023.11) is not fetched, and says so', `${choices.length} targets; ${read} of ${names.length} variants read on their own target${elsewhere ? ', the rest set aside each time' : ''}; the genome: ${genome.problems[0]?.slice(0, 80)}…`, choices.length === 28 && read === names.length && elsewhere && !genome.targets.length && !genome.pending.length && /does not fetch a genome/.test(genome.problems[0]), '28; all; refused');
    }

    // DiMSum's merge: CBS's codon variants with the fitness and sigma DiMSum was given.
    {
      const aggregate = JSON.parse(readFileSync(new URL('./reference/dimsum-aggregate.json', import.meta.url), 'utf8'));
      const d = compareDimsumAggregate(aggregate, readTables.get('CBS, low B6').table, cbs);
      check('consequences', 'nucleotide variants merged at the protein level as DiMSum 1.4 merges them (its dimsum__aggregate_AA_variants_fitness, mixedSubstitutions = FALSE): CBS\'s 11,478 codon variants, each amino-acid variant\'s fitness the inverse-variance mean of its codons\', its sigma √(1/Σ 1/σ²); synonymous codons, which DiMSum keeps apart, each a member of MaveScape\'s synonymous cell', `${d.merged} amino-acid variants (${d.view.collapse.merged} merged from ${d.view.collapse.mergedFrom} codon variants; ${d.unscored} with no fitness either side), largest relative difference ${d.worst.toExponential(1)}; ${d.missing.length} missing, ${d.extra.length} extra; ${d.synonymous - d.misplaced.length} of ${d.synonymous} synonymous in place`, d.merged === 7561 && d.worst <= 1e-12 && !d.missing.length && !d.extra.length && !d.misplaced.length, '≤ 1e-12; none');
    }
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
      check('scoring', 'BRCA1, the whole table drafted from its column names: the phage assay of E3 ligase activity ("PlusE2", 6 time points) and Y2H (4) become two conditions, scored apart; the phage condition scores as the hand-written design does', `${both.conditions.map((c) => `${c.name}: ${c.replicates.length} replicates, ${formatCount(c.scored)} scored`).join('; ')}; E2 against the hand-written design ${dd.worst.toExponential(2)} over ${pairs.length / 2} variants`, both.conditions.length === 2 && !!e2Condition && dd.worst <= 1e-12 && pairs.length > 0, 'two conditions; ≤ 1e-12');
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
    check('map', 'BRCA1 RING (E3 ligase activity, phage autoubiquitination): the positions least tolerant of substitution are the RING domain\'s zinc ligands (C24, C27, C39, H41, C44, C47, C61, C64)', `${least.map(([p, m, aa]) => `${aa}${p} ${m.toFixed(2)}`).join(', ')}; ${ligands} of 5 are zinc ligands; ${b.offMap} multi-variants off the map`, ligands >= 4, '≥ 4 of the 5');
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
      const minimum = example.minimumR ?? (differential ? 0.95 : 0.98);
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
      const byRun = new Map();
      for (const [index, run] of opened.ws.runs.entries()) {
        // Its table assembled from the archive's files as the window assembles it (a barcode map
        // applied, codon variants read at the protein level: 0.2's sources).
        const { table: t, scored: again } = recompute(opened.ws, opened.sources, index);
        if (!again.ok) {
          check('roundtrip', `${file}: ${run.name} is recomputed`, again.errors[0], false, 'scored');
          continue;
        }
        // The run its first selection is of (or its first run): the one whose exports are made again.
        if (!last || run.id === opened.ws.selections[0]?.run) last = { run, table: t, results: again.results };
        byRun.set(run.id, { run, table: t, results: again.results });
        const verdict = reproduction(run, outputDigest(again.results), 'this version');
        // Against the scores the archive holds for the run (results/<run>.csv), when it holds them.
        const held = opened.results.get(`results/${run.id}.csv`);
        let worst = 0;
        if (held) {
          const scores = parseTable(new TextEncoder().encode(held));
          // Published scores may have no SE (0.3's): an SE is in both, or in neither.
          const col = (name) => scores.columns.find((c) => c.name === name)?.numeric ?? null;
          const [score, se] = [col('score'), col('SE')];
          const c = again.results.conditions[0];
          for (let i = 0; i < c.score.length; i += 1) {
            const [heldSE, againSE] = [se?.[i] ?? NaN, c.se?.[i] ?? NaN];
            if (Number.isFinite(score[i]) !== Number.isFinite(c.score[i]) || Number.isFinite(heldSE) !== Number.isFinite(againSE)) worst = Infinity;
            else if (Number.isFinite(score[i])) worst = Math.max(worst, Math.abs(c.score[i] - score[i]) / Math.max(1, Math.abs(score[i])), Number.isFinite(heldSE) ? Math.abs(againSE - heldSE) / Math.max(1, heldSE) : 0);
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
        check('roundtrip', `${file}: the reopened workspace keeps its QC thresholds (where changed) and selection, and makes its exports and methods`, `replicate agreement review at ${thresholds.agreement.review}; selection "${opened.ws.selections[0]?.name}" of ${opened.ws.selections[0]?.keys.length} variants; ${Object.keys(made).length - 1} files`, Object.values(made).every((x) => x) && made['methods.md'].includes(last.run.output.sha256) && (!opened.ws.qc?.thresholds || opened.ws.qc.thresholds.agreement?.review === thresholds.agreement.review), 'all made');
        // The annotations beside the map (0.3's) read again from the archive's own files, arranged as
        // the workspace keeps them.
        if (opened.ws.annotations?.length) {
          const tracks = nodeTracks(opened.ws, last.run, buildMapModel(proteinView(last.results) ?? last.results, last.run.inputs.design), opened.sources, { results: last.results, table: last.table });
          const per = opened.ws.annotations.map((a) => [a.name, tracks.filter((t) => t.id.startsWith(`${a.id}:`)).length]);
          const order = opened.ws.tracks?.order ?? [];
          check('roundtrip', `${file}: its annotations' tracks read again from the archive's own files, in the order the workspace keeps`, `${per.map(([n, k]) => `${n} ${k}`).join(', ')}; first ${tracks[0]?.label}`, per.every(([, k]) => k > 0) && (!order.length || tracks[0]?.id === order[0]), 'each a track or more, in order');
        }
      }
      // What a comparison rests on (0.4's): each MaveDB score set kept beside the workspace read again
      // from the archive's own file, as published, with the direction stated.
      const keptSets = (opened.ws.annotations ?? []).filter((a) => a.provider === 'mavedb-scores');
      if (keptSets.length) {
        const read = keptSets.map((a) => {
          const r = scoreSetResults(new TextDecoder().decode(opened.sources.get(a.file.sha256)), a.record.scoreSet);
          return { name: a.record.scoreSet.urn, scored: r.error ? null : r.results.conditions[0].scored, error: r.error, direction: a.record.scoreSet.readout?.direction ?? 'not stated' };
        });
        check('roundtrip', `${file}: each MaveDB score set kept beside the workspace read again from the archive's own file, as published, with the direction stated`, read.map((x) => `${x.name} ${x.error ?? `${x.scored} scored`} (${x.direction})`).join('; '), read.every((x) => !x.error && x.scored > 0), 'each read');
      }
      // Each selection made by a query (0.4's), its query run again on its run's map: the same
      // variants. A query of the robustness verdicts, which a later version's check may vary, keeps
      // its variants on the map.
      const byQuery = opened.ws.selections.filter((x) => x.query);
      if (byQuery.length) {
        const again = byQuery.map((x) => {
          const r = byRun.get(x.run);
          if (!r) return { name: x.name, ok: false, why: 'its run not recomputed' };
          const results = proteinView(r.results) ?? r.results;
          const model = buildMapModel(results, r.run.inputs.design, { condition: x.condition ?? 0 });
          const ast = parseQuery(x.query);
          if (queryUses(ast, 'verdict')) {
            const onMap = new Set(selectByQuery('all', queryContext({ model, results, design: r.run.inputs.design })).keys);
            return { name: x.name, ok: x.keys.every((k) => onMap.has(k)), why: `${x.keys.length} on the map (a query of the verdicts)` };
          }
          const features = queryUses(ast, 'feature') ? featuresOf(nodeTracks(opened.ws, r.run, model, opened.sources, { results: r.results, table: r.table })) : null;
          const sets = opened.ws.selections.map((y) => ({ name: y.name, keys: y.keys }));
          const keys = evaluateQuery(ast, queryContext({ model, results, own: r.results, design: r.run.inputs.design, features, sets })).keys;
          return { name: x.name, ok: JSON.stringify(keys) === JSON.stringify(x.keys), why: `${keys.length} of ${x.keys.length}` };
        });
        check('roundtrip', `${file}: each selection made by a query, its query run again on its run's map, selects its variants again (one of the robustness verdicts keeps them on the map)`, again.map((x) => `${x.name}: ${x.why}`).join('; '), again.every((x) => x.ok), 'the same');
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

  // Wave 2, slice 11 (T4): every example opened as the window opens it. Its files (a published
  // example's MaveDB's, unchanged), its design fitting them, its first run, the QC findings it
  // teaches and no others, what its readiness says is missing, its guide; then each new example's
  // own lesson, checked: Hsp90's codon variants and its per-generation scores against the
  // published fitness, factor IX against MultiSTEP's scores, and the simulated problems against
  // their truth.
  examples() {
    const pct = (x) => `${(100 * x).toFixed(1)}%`;
    const opened = new Map();
    for (const example of EXAMPLES) {
      let o;
      try {
        o = openExampleInNode(example);
      } catch (error) {
        // An example opened from MaveDB needs its table (external data).
        if (!(error instanceof MissingExampleData)) throw error;
        console.log(`  ${example.title}: skipped (${error.message})`);
        if (requireData) check('examples', `${example.title}: its table present`, error.message, false, 'present (--require-data)');
        continue;
      }
      opened.set(example.id, o);
      const valid = validateDesign(o.design, { columns: o.table.columns.map((c) => c.name) });
      const raised = raisedOf(o.findings);
      const expected = example.findings ?? {};
      const gaps = o.readiness.gaps.map((g) => g.id);
      const missing = (example.teaches ?? []).filter((g) => !gaps.includes(g));
      check('examples', `${example.title}: opens as the window opens it, its design fitting its ${o.assembled.kind === 'codons' ? 'codon variants read at the protein level' : 'table'}, scored with its parameters; QC raises exactly the findings it teaches`, `${o.table.rows} rows; ${o.scored.ok ? `${o.scored.results.conditions[0].scored} scored (${o.parameters.model === 'ratio' && o.design.model !== 'time-series' ? 'log ratio' : MODELS[o.parameters.model]}${o.parameters.timeScale === 'unit' ? ', per generation' : ''})` : o.scored.errors[0]}; QC ${Object.entries(raised).map(([k, v]) => `${k}: ${v}`).join(', ') || 'all pass'}`, valid.ok && o.scored.ok && JSON.stringify(raised) === JSON.stringify(expected), `valid; scored; ${Object.entries(expected).map(([k, v]) => `${k}: ${v}`).join(', ') || 'all pass'}`);
      check('examples', `${example.title}: its readout and direction stated, its readiness naming what its guide points to, and a guided workflow of at most six steps`, `${o.design.readout?.direction ?? 'no direction'}; ${o.readiness.counts.ready + o.readiness.counts.partial} of ${o.readiness.analyses.length} analyses possible; missing ${gaps.join(', ') || 'nothing'}; ${example.steps.length} steps`, Boolean(o.design.readout?.direction && o.design.readout?.phenotype) && !missing.length && example.steps.length <= 6 && example.steps.every(([mode]) => ['qc', 'score', 'map', 'experiment', 'compare', 'structure'].includes(mode)) && Boolean(example.question && example.source && example.license && example.expected.length), `stated; ${(example.teaches ?? []).join(', ') || 'nothing in particular'} named; ≤ 6`);
      if (example.mavedb) {
        // Opened from MaveDB: its tables the ones the example was made with (and the validation
        // pins), each record's license the example's (several records, wave 3 slice 6).
        const set = sources.datasets[EXAMPLE_DATASETS[example.id]];
        const tables = exampleRecords(example).flatMap((r) => ['scores', 'counts'].filter((f) => r[f]).map((f) => {
          const t = recordTable(example, r.urn, f);
          const pin = set?.files.find((x) => x.path === t.relative);
          return { urn: r.urn, file: f, ok: sha256(t.bytes) === r[f].sha256 && pin?.sha256 === r[f].sha256 && t.bytes.length === r[f].size, license: cachedRecord(r.urn).license.short };
        }));
        check('examples', `${example.title}: MaveDB's tables are the ones the example was made with, and its records name the license and citation the example gives`, tables.map((t) => `${t.urn.replace('urn:mavedb:', '')} ${t.file} ${t.ok ? 'the same' : 'changed'} (${t.license})`).join('; '), tables.length > 0 && tables.every((t) => t.ok && example.license.startsWith(t.license)), 'the same; CC0');
      } else if (!example.simulated) {
        const bytes = o.parts[0].bytes;
        const file = sources.datasets[EXAMPLE_DATASETS[example.id]]?.files.find((f) => f.path === 'counts.csv');
        const notice = readFileSync(new URL(`../web/${example.files.notice}`, import.meta.url), 'utf8');
        check('examples', `${example.title}: its counts are MaveDB's, unchanged, and its notice says so, with the license and the citation`, `${sha256(bytes).slice(0, 16)}… against ${file?.sha256.slice(0, 16)}…`, Boolean(file) && sha256(bytes) === file.sha256 && notice.includes(file.sha256) && notice.includes('CC0') && notice.includes(example.source.match(/urn:mavedb:[\d-a-z]+/)[0]), 'the same; said');
      }
    }

    // Hsp90: MaveDB's 568 codon rows read as 188 protein variants, the wild type's nine copies once,
    // MaveDB's own protein names agreeing with the translation but for those copies.
    {
      const o = opened.get('hsp90');
      const raw = parseTable(o.parts[0].bytes);
      const nt = columnText(raw.columns.find((c) => c.name === 'hgvs_nt'));
      const pro = columnText(raw.columns.find((c) => c.name === 'hgvs_pro'));
      const differ = nt.map((n, i) => [n, pro[i], proteinChange(n, o.design.targets[0]).protein]).filter(([, a, b]) => a !== b);
      const copies = o.assembled.problems.filter((p) => p.code === 'codons-copies');
      check('examples', 'Hsp90: its 568 codon rows read at the protein level, each substitution\'s codons combined, the wild type (written once per position, with the same counts) read once; MaveDB\'s own protein names agree with the translation but for those nine copies, which it names as synonymous changes', `${raw.rows} rows → ${o.table.rows} protein variants; ${copies.map((p) => p.message.slice(0, 60)).join('; ')}…; ${differ.length} rows named otherwise by MaveDB (${[...new Set(differ.map(([, , b]) => b))].join(', ')})`, raw.rows === 568 && o.table.rows === 188 && copies.length === 1 && /c\.= is written on 9 rows/.test(copies[0].message) && differ.length === 9 && differ.every(([, , b]) => b === 'p.='), '188; read once; 9, all the wild type');
      // One replicate: each score's SE is its own slope's (residual-scaled), as with REML.
      const c = o.scored.results.conditions[0];
      const rep = o.scored.results.replicates[0];
      let worst = 0;
      c.se.forEach((x, i) => { if (Number.isFinite(x) && rep.state[i] === REPLICATE_STATE.USED) worst = Math.max(worst, Math.abs(x - rep.se[i]) / rep.se[i]); });
      check('examples', 'Hsp90: with one replicate there is no shared error model to fit, so each score keeps its own slope\'s SE, scaled by its residuals (the time courses scatter far beyond counting)', `largest relative difference from the replicate's SE ${worst.toExponential(1)}`, worst <= 1e-12, '≤ 1e-12');
    }

    // The simulated problems: the cells account for replicates 1 and 2, not 3; without replicate 3
    // the scores come closer to the truth and the intervals stop being too wide.
    {
      const example = exampleById('simulated-problems');
      const o = opened.get('simulated-problems');
      const truth = o.sim.truth;
      const against = (results) => {
        const c = results.conditions[0];
        const a = [];
        const b = [];
        let held = 0;
        results.variants.key.forEach((k, i) => {
          if (c.reason[i] || !(k in truth) || k === 'p.=') return;
          a.push(c.score[i]);
          b.push(truth[k]);
          const [low, high] = intervalOf(c, i);
          if (low <= truth[k] && truth[k] <= high) held += 1;
        });
        return { r: pearson(a, b), held: held / a.length };
      };
      const without = openExampleInNode(example, { design: (d) => ({ ...d, replicates: d.replicates.filter((r) => r.id !== 'rep3') }) });
      const [all, two] = [against(o.scored.results), against(without.scored.results)];
      const cells = o.findings.find((f) => f.id === 'excess-variance').cells ?? [];
      const verdict = (a, b) => cells.find((x) => x.a === a && x.b === b)?.verdict;
      // Where DiMSum's terms put the excess, with and without the failing replicate.
      const placed = (x) => /The excess is at the input/.test(x.findings.find((f) => f.id === 'excess-variance').explanation) ? 'input' : /The excess is at the output/.test(x.findings.find((f) => f.id === 'excess-variance').explanation) ? 'output' : 'neither';
      check('examples', 'the simulated problems: the recorded cells account for the excess between replicates 1 and 2, not with replicate 3; with replicate 3 the intervals are too wide and DiMSum\'s terms misplace the bottleneck after selection; without it the scores come closer to the truth, the intervals hold it about 95% of the time, and the bottleneck is placed before selection, where it was planted', `cells: rep1–rep2 ${verdict('rep1', 'rep2')}, rep1–rep3 ${verdict('rep1', 'rep3')}, rep2–rep3 ${verdict('rep2', 'rep3')}; all three r ${all.r.toFixed(3)}, intervals ${pct(all.held)}, DiMSum's terms at the ${placed(o)}; without replicate 3 r ${two.r.toFixed(3)}, ${pct(two.held)}, at the ${placed(without)}`, verdict('rep1', 'rep2') === 'explained' && verdict('rep1', 'rep3') === 'more' && verdict('rep2', 'rep3') === 'more' && all.held > 0.98 && two.held >= 0.93 && two.held <= 0.97 && two.r > all.r && placed(o) === 'output' && placed(without) === 'input', 'explained, more, more; > 98%, output; 93–97%, closer, input');
    }

    // BRCA1's saturation genome editing (wave 3, slice 3): its counts, drafted from their names into
    // two replicates of day 5 and day 11, scored, against the published scores (normalized exon by
    // exon and for position within each, which the counts do not record).
    if (opened.has('brca1-sge')) {
      const o = opened.get('brca1-sge');
      const record = readScoreSet(JSON.parse(readFileSync(new URL('fixtures/public-data/mavedb/urn_mavedb_00000097-0-2.json', import.meta.url), 'utf8')));
      const counts = parseTable(dataset('mavedb-brca1-sge').bytes('counts.csv'));
      const countsSha = sha256(dataset('mavedb-brca1-sge').bytes('counts.csv'));
      const { design } = countsDesign(record, { table: counts, layout: detectLayout(counts), target: o.design.targets[0] });
      const ws = workspaceOf(counts, design, { layout: 'mavedb-counts' });
      const scored = scoreTable(counts, design, defaultParameters(design, ws.sources[0]));
      const c = scored.results.conditions[0];
      const published = new Map(columnText(o.table.columns.find((x) => x.name === 'hgvs_nt')).map((k, i) => [k, o.table.columns.find((x) => x.name === 'score').numeric[i]]));
      const a = [];
      const b = [];
      scored.results.variants.original.forEach((k, i) => { if (!c.reason[i] && Number.isFinite(published.get(k))) { a.push(c.score[i]); b.push(published.get(k)); } });
      const r = pearson(a, b);
      const example = exampleById('brca1-sge');
      check('examples', 'BRCA1\'s saturation genome editing: its counts (the example\'s table) drafted from their names into two replicates of day 5 and day 11, the library and RNA counts set aside, and scored with the defaults, agree with the published scores as the guide says (r ≈ 0.76): the published scores were normalized exon by exon and for position within each', `counts ${countsSha.slice(0, 12)}…; ${design.model}, ${design.replicates.map((x) => `${x.name}: ${x.timepoints.map((t) => t.time).join('→')}`).join(', ')}; set aside ${(design.ignoredColumns ?? []).map((x) => x.column).join(', ')}; ${c.scored} scored, r ${r.toFixed(3)} with ${a.length} published`, countsSha === example.mavedb.counts.sha256 && design.model === 'time-series' && design.replicates.length === 2 && design.replicates.every((x) => x.timepoints.length === 2) && r > 0.74 && r < 0.78, 'the example\'s; two replicates, 5→11; r 0.74–0.78');
    }

    // DHFR without and with Lon (wave 3, slice 6): two score sets opened together, their counts
    // joined with the paper's design; the scores against the published ones, and the conditions
    // against each other, as the paper found them.
    if (opened.has('dhfr-lon')) {
      const o = opened.get('dhfr-lon');
      const example = exampleById('dhfr-lon');
      const R = o.scored.results;
      const tiles = new Map(o.design.library.tiles.map((t) => [t.id, t]));
      let outside = 0;
      let marked = 0;
      for (const r of R.replicates) {
        const t = tiles.get(o.design.replicates.find((x) => x.id === r.id).tile);
        R.variants.position.forEach((p, i) => {
          if (p < 1 || (p >= t.start && p <= t.end)) return;
          if (r.state[i] === REPLICATE_STATE.USED) outside += 1;
          if (r.state[i] === REPLICATE_STATE.OUTSIDE_TILE) marked += 1;
        });
      }
      // The wild type, at no position, is every replicate's.
      const kMax = Math.max(...R.conditions.map((c) => Math.max(...[...c.k].filter((k, i) => R.variants.position[i] >= 1))));
      const prefixes = [...new Set(o.table.columns.slice(1).map((c) => c.name.split(':')[0]))];
      const multi = multiTileSamples(o.design);
      const summary = summarizeDesign(o.design).lines.join(' ');
      check('examples', 'DHFR: the two score sets\' counts joined, each record\'s columns named by its URN; 24 time series under two conditions, four sub-libraries of 40 positions each grown three times, two in each repeat: each replicate measures only its own sub-library\'s positions (the other\'s, counted by the same samples, marked outside its tile), no variant combined from more than its three replicates, and the summary says so', `${o.table.rows} variants, columns of ${prefixes.join(' and ')}; ${o.design.replicates.length} replicates in ${o.design.conditions.map((c) => c.name).join(' and ')}; ${multi.size} samples holding two tiles; ${outside} measurements used outside their tile, ${marked} marked; at most ${kMax} replicates combined`, o.assembled.kind === 'joined' && prefixes.join() === '00000063-b-1,00000063-a-1' && o.design.replicates.length === 24 && multi.size === 96 && !outside && marked > 0 && kMax === 3 && /hold 2 tiles grown together: each replicate measures only its own tile's positions/.test(summary) && !/shared between replicates/.test(summary), 'joined; 24; 96; 0 used outside; ≤ 3; said');
      // The published scores, condition by condition (−Lon is 00000063-b-1, +Lon -a-1).
      const publishedOf = (urn) => {
        const t = parseTable(recordTable(example, urn, 'scores').bytes);
        const names = columnText(t.columns.find((c) => c.name === 'hgvs_pro'));
        const score = t.columns.find((c) => c.name === 'score').numeric;
        return new Map(names.map((k, i) => [k, score[i]]));
      };
      const pub = { 'minus-lon': publishedOf('urn:mavedb:00000063-b-1'), 'plus-lon': publishedOf('urn:mavedb:00000063-a-1') };
      const against = (results) => results.conditions.map((c) => {
        const a = [];
        const b = [];
        results.variants.original.forEach((k, i) => { const x = pub[c.id].get(k); if (!c.reason[i] && Number.isFinite(x) && k !== '_wt') { a.push(c.score[i]); b.push(x); } });
        const ratios = a.map((x, i) => x / b[i]).filter((x) => Number.isFinite(x) && x > 0).sort((x, y) => x - y);
        return { id: c.id, name: c.name, n: a.length, r: pearson(a, b), ratio: ratios[ratios.length >> 1] };
      });
      const ols = scoreTable(o.table, o.design, withDefaults({ ...o.parameters, model: 'ols' }));
      const wls = against(R);
      const olsAgainst = against(ols.results);
      const line = (x) => x.map((c) => `${c.name} r ${c.r.toFixed(3)} (median ratio ${c.ratio.toFixed(2)}, ${c.n})`).join(', ');
      check('examples', 'DHFR against the published scores, as the guide says: with MaveScape\'s defaults (weighted regression) r ≈ 0.90 without Lon and 0.96 with it; with the authors\' unweighted regression (ordinary least squares) r ≈ 0.96 and 0.98, on the same scale (Enrich2\'s slopes over the whole 18 hours: median ratio near 1)', `defaults ${line(wls)}; ordinary least squares ${line(olsAgainst)}`, wls[0].r > 0.88 && wls[0].r < 0.92 && wls[1].r > 0.94 && wls[1].r < 0.98 && olsAgainst[0].r >= 0.95 && olsAgainst[1].r >= 0.97 && olsAgainst.every((c) => Math.abs(c.ratio - 1) <= 0.05), 'defaults 0.88–0.92 and 0.94–0.98; OLS ≥ 0.95 and ≥ 0.97, ratio within 5% of 1');
      // Lon's effect: advantageous substitutions (score ≥ 0.2, the paper's threshold) in each
      // condition, published and here; the difference +Lon − −Lon where called, and by the native
      // residue (the paper: most negative at hydrophobic residues and in the buried core).
      const advantageous = (scores, keys, reason) => keys.filter((k, i) => !reason?.[i] && k !== '_wt' && !k.includes('[') && scores[i] >= 0.2).length;
      const publishedAdvantageous = Object.fromEntries(Object.entries(pub).map(([id, m]) => [id, [...m].filter(([k, x]) => k !== '_wt' && x >= 0.2).length]));
      const here = Object.fromEntries(R.conditions.map((c) => [c.id, advantageous(c.score, R.variants.original, c.reason)]));
      const d = R.differential[0];
      const protein = targetProtein(o.design.targets[0]);
      let called = 0;
      let negative = 0;
      const byPosition = new Map();
      R.variants.key.forEach((k, i) => {
        if (d.reason[i] || R.variants.kind[i] !== KIND.MISSENSE) return;
        if (d.q[i] < 0.05) {
          called += 1;
          if (d.delta[i] < 0) negative += 1;
        }
        const p = R.variants.position[i];
        if (!byPosition.has(p)) byPosition.set(p, []);
        byPosition.get(p).push(d.delta[i]);
      });
      const meanOf = (x) => x.reduce((s, y) => s + y, 0) / x.length;
      const hydrophobic = [];
      const others = [];
      for (const [p, xs] of byPosition) (/[VILMFWY]/.test(protein[p - 1]) ? hydrophobic : others).push(meanOf(xs));
      check('examples', 'DHFR, Lon\'s effect as the paper found it: without Lon about twice as many substitutions grow faster than the wild type (≥ 0.2) as with it (the published scores: the paper\'s 736 and 384); the difference +Lon − −Lon negative for most of the substitutions it calls (q < 0.05), and most negative, position by position, at native hydrophobic residues (V, I, L, M, F, W, Y)', `published ${publishedAdvantageous['minus-lon']} and ${publishedAdvantageous['plus-lon']}; here ${here['minus-lon']} and ${here['plus-lon']} (${(here['minus-lon'] / here['plus-lon']).toFixed(2)}×); ${d.name} (${d.method}): ${called} called, ${negative} negative; mean difference ${meanOf(hydrophobic).toFixed(2)} at ${hydrophobic.length} hydrophobic positions, ${meanOf(others).toFixed(2)} at ${others.length} others`, publishedAdvantageous['minus-lon'] === 736 && publishedAdvantageous['plus-lon'] === 384 && here['minus-lon'] / here['plus-lon'] > 1.8 && here['minus-lon'] / here['plus-lon'] < 2.6 && negative / called >= 0.85 && meanOf(hydrophobic) < meanOf(others) - 0.15, '736 and 384; 1.8–2.6×; ≥ 85% negative; hydrophobic lower by > 0.15');
    }

    // BRCA1 RING from MaveDB and back (wave 3, slice 6): its counts with the paper's design, scored,
    // against the published scores (Enrich2's), then deposited and read back.
    if (opened.has('brca1-ring')) {
      const o = opened.get('brca1-ring');
      const example = exampleById('brca1-ring');
      const R = o.scored.results;
      const pub = parseTable(recordTable(example, 'urn:mavedb:00000003-a-2', 'scores').bytes);
      const row = new Map(columnText(pub.columns.find((c) => c.name === 'hgvs_pro')).map((k, i) => [k, i]));
      const pubScore = pub.columns.find((c) => c.name === 'score').numeric;
      const set = (o.design.ignoredColumns ?? []).filter((x) => /^Y2H_/.test(x.column)).length;
      check('examples', 'BRCA1 RING: MaveDB\'s counts read as 12,316 amino-acid variants with Enrich2\'s _wt and _sy rows; the design gives two library preparations of three replicates, rounds 0–5, the replicates of a preparation sharing its input, and sets the yeast two-hybrid columns aside', `${o.table.rows} variants; ${o.design.replicates.length} replicates of ${[...new Set(o.design.replicates.map((r) => r.timepoints.length))].join(', ')} time points (${o.design.time.unit}s); ${sharedSamples(o.design).size} shared inputs; ${set} two-hybrid columns set aside`, o.table.rows === 12316 && o.design.replicates.length === 6 && o.design.replicates.every((r) => r.timepoints.map((t) => t.time).join() === '0,1,2,3,4,5') && sharedSamples(o.design).size === 2 && set === 24, '12,316; 6 of 6 rounds; 2 shared; 24 aside');
      let worst = 0;
      let compared = 0;
      for (const r of R.replicates) {
        const name = o.design.replicates.find((x) => x.id === r.id).name;
        const theirs = pub.columns.find((c) => c.name === `score_${name}`).numeric;
        R.variants.original.forEach((k, i) => {
          const j = row.get(k);
          if (j === undefined || !Number.isFinite(theirs[j]) || !Number.isFinite(r.score[i])) return;
          compared += 1;
          worst = Math.max(worst, Math.abs(r.score[i] - theirs[j]) / Math.max(1, Math.abs(theirs[j])));
        });
      }
      const combinedR = (results) => {
        const c = results.conditions[0];
        const a = [];
        const b = [];
        results.variants.original.forEach((k, i) => { const j = row.get(k); if (j !== undefined && !c.reason[i] && Number.isFinite(pubScore[j])) { a.push(c.score[i]); b.push(pubScore[j]); } });
        return { r: pearson(a, b), n: a.length };
      };
      const mine = combinedR(R);
      const enrich2 = scoreTable(o.table, o.design, defaultParameters(o.design, o.ws.sources[0], 'enrich2'));
      const theirsCombined = combinedR(enrich2.results);
      const publishedScored = [...pubScore].filter(Number.isFinite).length;
      check('examples', 'BRCA1 RING against the published scores, as the guide says: with MaveScape\'s defaults every replicate score equals the published one (Enrich2\'s weighted regression with wild-type normalization), the combined scores close (the moderated combination against Enrich2\'s random effects); with the Enrich2-compatible preset the combined scores follow them exactly, as many variants scored as MaveDB\'s', `${compared} replicate scores, largest relative difference ${worst.toExponential(1)}; defaults combined r ${mine.r.toFixed(4)} over ${mine.n}; Enrich2-compatible r ${theirsCombined.r.toFixed(5)}, ${enrich2.results.conditions[0].scored} scored against MaveDB's ${publishedScored}`, compared > 45000 && worst <= 1e-10 && mine.r > 0.98 && mine.r < 0.999 && theirsCombined.r >= 0.9999 && enrich2.results.conditions[0].scored === publishedScored, '> 45,000 within 1e-10; 0.98–0.999; ≥ 0.9999, the same count');
      // The zinc ligands, on BRCA1's numbering (the target's offset of 1, as the example states it).
      const model = buildMapModel(R, o.design);
      const zinc = [24, 27, 39, 41, 44, 47, 61, 64];
      const ranked = [];
      for (let p = 1; p <= model.length; p += 1) if (model.columnCount[p - 1] >= 5) ranked.push([p + model.target.offset, model.columnMedian[p - 1]]);
      ranked.sort((x, y) => x[1] - y[1]);
      const ranks = zinc.map((z) => ranked.findIndex(([p]) => p === z) + 1);
      const typical = median(ranked.filter(([p]) => !zinc.includes(p)).map(([, m]) => m));
      check('examples', 'BRCA1 RING, Run 1 on the map as the guide says: the RING\'s eight zinc ligands (C24, C27, C39, H41, C44, C47, C61, C64) among its twelve least tolerant positions (median score, positions with five or more scored)', `ranks ${zinc.map((z, k) => `${z}: ${ranks[k]}`).join(', ')} of ${ranked.length}; their medians ${zinc.map((z) => ranked.find(([p]) => p === z)[1].toFixed(2)).join(' ')}, a typical position's ${typical.toFixed(2)}`, ranks.every((r) => r >= 1 && r <= 12) && model.target.offset === 1, 'all within the 12 lowest; offset 1');
      const { built, first, trip } = exampleRoundTrip('brca1-ring');
      const experimentTitle = JSON.parse(first.files.find((f) => f.name === 'experiment.json').text).title;
      const back = trip.back.results;
      const backScore = new Map(back.variants.key.map((k, i) => [k, back.conditions[0].score[i]]));
      const c = built.results.conditions[0];
      let exact = 0;
      let differ = 0;
      built.results.variants.key.forEach((k, i) => {
        if (c.reason[i]) return;
        if (Object.is(backScore.get(k), c.score[i])) exact += 1;
        else differ += 1;
      });
      check('examples', 'BRCA1 RING\'s round trip: Run 1 deposited in MaveDB\'s format (its experiment described as the record\'s), read back as MaveScape opens a package, its scores the run\'s exactly, and the deposit written again the same bytes', `${first.report.variants.exported} variants deposited (${first.report.mode}; its experiment "${experimentTitle}", ${JSON.parse(first.files.find((f) => f.name === 'score_set.json').text).experimentUrn ?? 'new'}); ${exact} scores back exactly, ${differ} not; written again: ${trip.same ? 'the same bytes' : `differs in ${trip.differ.join(', ')}`}`, exact === c.scored && !differ && trip.same && experimentTitle === cachedRecord('urn:mavedb:00000003-a-2').experiment.title, 'all exactly; the same');
    }

    // With external data: Hsp90 against the published fitness; factor IX against MultiSTEP's scores.
    {
      const o = opened.get('hsp90');
      const published = parseTable(dataset('mavedb-hsp90').bytes('scores.csv'));
      const nt = columnText(published.columns.find((c) => c.name === 'hgvs_nt'));
      const scores = published.columns.find((c) => c.name === 'score').numeric;
      // The authors' null-like variants: within 3 SD of the stops' mean (they fit those on the first
      // three time points).
      const stops = nt.map((n, i) => (/Ter$/.test(proteinChange(n, o.design.targets[0]).protein) ? scores[i] : null)).filter((x) => x !== null);
      const mean = stops.reduce((a, b) => a + b, 0) / stops.length;
      const sd = Math.sqrt(stops.reduce((a, b) => a + (b - mean) ** 2, 0) / (stops.length - 1));
      const byProtein = new Map();
      nt.forEach((n, i) => { const p = proteinChange(n, o.design.targets[0]).protein; byProtein.set(p, [...(byProtein.get(p) ?? []), scores[i]]); });
      const c = o.scored.results.conditions[0];
      const pairs = [];
      o.scored.results.variants.key.forEach((k, i) => {
        if (c.reason[i] || !byProtein.has(k)) return;
        const theirs = byProtein.get(k).reduce((a, b) => a + b, 0) / byProtein.get(k).length;
        pairs.push([k, c.score[i], theirs]);
      });
      const fitted = pairs.filter(([, , theirs]) => theirs > mean + 3 * sd);
      const nulls = pairs.filter(([k]) => /Ter$/.test(k));
      const median = (xs) => { const t = [...xs].sort((a, b) => a - b); return t[t.length >> 1]; };
      const r = pearson(fitted.map((x) => x[1]), fitted.map((x) => x[2]));
      const gap = median(fitted.map(([, mine, theirs]) => Math.abs(mine - theirs)));
      const ratio = median(fitted.filter(([, , theirs]) => Math.abs(theirs) > 0.05).map(([, mine, theirs]) => mine / theirs));
      check('examples', 'Hsp90 against the published fitness per generation (the mean of each substitution\'s codons): MaveScape\'s per-generation slopes by weighted regression follow it where the authors fit every time point, in natural logarithms (the record says log₂: in log₂ MaveScape\'s would be 1/ln 2 ≈ 1.44× the published); stops score less negative, as a slope over all 21 generations of a course that reaches the floor must', `r ${r.toFixed(4)} over ${fitted.length} variants, median difference ${gap.toFixed(4)}, median ratio ${ratio.toFixed(3)}; stops median ${median(nulls.map((x) => x[1])).toFixed(3)} here against ${median(nulls.map((x) => x[2])).toFixed(3)} published (first three time points)`, r >= 0.95 && gap <= 0.01 && Math.abs(ratio - 1) <= 0.07 && median(nulls.map((x) => x[1])) > median(nulls.map((x) => x[2])), 'r ≥ 0.95; ≤ 0.01; ratio within 7% of 1; less negative');
    }
    {
      const o = opened.get('factor9');
      const published = parseTable(dataset('mavedb-factor9').bytes('scores.csv'));
      const theirs = new Map(columnText(published.columns.find((c) => c.name === 'hgvs_pro')).map((n, i) => [n, published.columns.find((c) => c.name === 'score').numeric[i]]));
      const rOf = (results) => {
        const c = results.conditions[0];
        const a = [];
        const b = [];
        results.variants.key.forEach((k, i) => { if (!c.reason[i] && Number.isFinite(theirs.get(k))) { a.push(c.score[i]); b.push(theirs.get(k)); } });
        return pearson(a, b);
      };
      const multistep = openExampleInNode(exampleById('factor9'), { parameters: { binScale: 'low5-wt', combination: 'mean' } });
      check('examples', 'factor IX against MultiSTEP\'s published scores: with MaveScape\'s defaults (nonsense 0, wild type 1, the moderated combination) and with MultiSTEP\'s own settings set in the Score view (the lowest 5% at 0, the replicates\' mean), as the guide says', `defaults r ${rOf(o.scored.results).toFixed(4)}; MultiSTEP's settings r ${rOf(multistep.scored.results).toFixed(4)}`, rOf(o.scored.results) >= 0.99 && rOf(multistep.scored.results) >= 0.999, '≥ 0.99; ≥ 0.999');
    }
    // Wave 4, slice 6: the examples' published comparisons, as their guides say. The run "Published
    // scores" (or Run 1) as a side, and each score set kept beside the workspace as the window keeps it.
    const sideOfExample = (o, name, ws = o.ws) => {
      const source = { ...ws.sources[0], sha256: sha256(o.parts[0].bytes) };
      const workspace = { ...ws, sources: [source] };
      const run = makeRun({ inputs: runInputs({ source, design: o.design, parameters: o.parameters }), source, results: o.scored.results, software: { version: 'validation', commit: '' }, name });
      return describeSide(workspace, run, o.scored.results, { run: run.id, condition: 0 });
    };
    const said = (example, ...texts) => texts.every((t) => exampleById(example).expected.join(' ').includes(t) || exampleById(example).steps.map((x) => x[1]).join(' ').includes(t));
    // Hsp90 against its record's own published scores, kept beside (external data, its table).
    if (existsSync(new URL('./cache/mavedb-hsp90/scores.csv', import.meta.url))) {
      const o = opened.get('hsp90');
      const record = scoreSetSide('urn:mavedb:00000011-a-1', cachePath('mavedb-hsp90/scores.csv'), { direction: 'higher-more' });
      const a = sideOfExample(o, 'Run 1');
      const scored = compareSides(a, record.side);
      const stated = compareSides(a, record.side, { scale: 'stated' });
      const ba = stated.statistics.blandAltman;
      const at = (p) => stated.positions.list.find((x) => x.reference === p);
      const core = [585, 586, 587].map((p) => at(p).mean);
      const independent = stated.report.items.find((x) => x.id === 'independence');
      check('examples', 'Hsp90 against its record\'s own published scores kept beside (urn:mavedb:00000011-a-1), as the guide says: r 0.95; stated on one scale, Lin\'s concordance 0.48 and a bias of 0.22, the difference growing with the effect (Bland–Altman\'s trend), most at 585–587 (where the authors fit null-like variants on their first three time points); one experiment analysed twice, so no difference is tested', `${scored.matched.n} variants, r ${fmt(scored.statistics.pearson.r, 3)}, Lin's concordance ${scored.statistics.concordance ? 'given' : 'withheld'} as scored; stated: ${fmt(stated.statistics.concordance.ccc, 3)}, bias ${fmt(ba.bias, 3)}, trend ${fmt(ba.trend.slope, 3)} (${fmt(ba.trend.low, 3)} to ${fmt(ba.trend.high, 3)}); 585–587 ${core.map((x) => fmt(x, 2)).join(', ')}, Q582 ${fmt(at(582).mean, 2)}; independence ${independent?.status}; discordance ${stated.discordance.valid ? 'tested' : 'not tested'}`, scored.matched.n === 187 && !scored.statistics.concordance && fmt(scored.statistics.pearson.r, 2) === '0.95' && fmt(stated.statistics.concordance.ccc, 2) === '0.48' && fmt(ba.bias, 2) === '0.22' && fmt(ba.trend.slope, 2) === '-0.91' && core.every((x) => x >= 0.34 && x <= 0.4) && Math.abs(at(582).mean) < 0.05 && !stated.discordance.valid && said('hsp90', 'r 0.95', 'only 0.48', 'the bias 0.22', 'slope of −0.91', '0.34 to 0.39'), '187; 0.95; 0.48; 0.22; −0.91; said so');
    }
    if (opened.has('tp53-screens') && existsSync(new URL('./cache/mavedb-tp53-screens/kotler.csv', import.meta.url))) {
      // TP53: the target checked against UniProt (the record names no entry), then the two other
      // screens kept beside and compared as the guide says.
      const o = opened.get('tp53-screens');
      const entry = readUniProtEntry(JSON.parse(readFileSync(new URL('./fixtures/public-data/uniprot/P04637.json', import.meta.url), 'utf8')));
      const target = o.ws.targets[0];
      const placement = placeTarget(target, entry);
      const patch = placementPatch(target, entry, placement);
      const ws = recordTargetCheck(o.ws, target.id, patch, referenceOf(entry, { service: 'UniProt', version: '2026_03' }, placement), 'Checked against UniProt P04637');
      const a = sideOfExample(o, 'Published scores', ws);
      const kotlerFile = cachePath('mavedb-tp53-screens/kotler.csv');
      const unstated = scoreSetSide('urn:mavedb:00000059-a-1', kotlerFile);
      const kotler = scoreSetSide('urn:mavedb:00000059-a-1', kotlerFile, { direction: 'higher-less' });
      const nutlin = scoreSetSide('urn:mavedb:00000068-b-1', cachePath('mavedb-tp53-screens/nutlin.csv'), { direction: 'higher-less' });
      const asPublished = compareSides(a, unstated.side);
      const negated = compareSides(a, kotler.side);
      const rescaled = compareSides(a, kotler.side, { scale: 'synonymous-nonsense' });
      const merged = kotler.side.results.merged;
      const largest = [...rescaled.positions.list].sort((x, y) => Math.abs(y.mean) - Math.abs(x.mean)).slice(0, 8);
      const helix = largest.filter((x) => x.reference >= 180 && x.reference <= 184);
      const ba = rescaled.statistics.blandAltman;
      check('examples', 'TP53: the etoposide screen\'s published scores on TP53 with arginine at 72, checked against UniProt P04637 (positions 1–393, one difference, P72R); Kotler et al.\'s record kept beside, its protein variants on several rows merged as DiMSum merges codons and its frameshifts written alike left out, the report saying so', `${o.scored.results.conditions[0].scored} of ${o.scored.results.rows} scored; P04637 ${placement.start}–${placement.end}, ${placement.differences.map((d) => `${d.reference}${d.position}${d.target}`).join(', ')}; identifiers ${JSON.stringify(ws.targets[0].identifiers)}; Kotler: ${merged.variants} merged (${merged.rows} rows), ${merged.alike} frameshifts left out`, o.scored.results.conditions[0].scored === 8258 && placement.start === 1 && placement.end === 393 && placement.differences.length === 1 && placement.differences[0].position === 72 && ws.targets[0].identifiers.uniprot === 'P04637' && merged.variants === 936 && merged.rows === 2908 && merged.alike === 191 && /936 protein variants on several rows/.test(rescaled.report.items.find((x) => x.id === 'variants').text) && said('tp53-screens', '936 protein variants', '2,908 rows', '191 frameshifts'), '8,258; P72R; 936, 2,908, 191; said so');
      check('examples', 'TP53, two screens on two scales, as the guide says: matched on P04637\'s numbering, r −0.78 as published; with Kotler et al.\'s direction stated, r 0.78 and ρ 0.72, Lin\'s concordance withheld; rescaled by their anchors, Lin\'s concordance 0.78 and a bias of −0.04; four of the eight positions that differ most at 180–184, lower under etoposide; Giacomelli et al.\'s nutlin-3 screen against etoposide r 0.75 and 0.72 rescaled', `${asPublished.matched.n} matched, r ${fmt(asPublished.statistics.pearson.r, 3)}; stated r ${fmt(negated.statistics.pearson.r, 3)}, ρ ${fmt(negated.statistics.spearman.rho, 3)}, Lin's ${negated.statistics.concordance ? 'given' : 'withheld'}; rescaled Lin's ${fmt(rescaled.statistics.concordance.ccc, 3)}, bias ${fmt(ba.bias, 3)} (${fmt(ba.lower, 2)} to ${fmt(ba.upper, 2)}); largest ${largest.map((x) => `${x.residue}${x.reference} ${fmt(x.mean, 2)}`).join(', ')}; nutlin ${compareSides(a, nutlin.side).matched.n}, r ${fmt(compareSides(a, nutlin.side).statistics.pearson.r, 3)}, rescaled ${fmt(compareSides(a, nutlin.side, { scale: 'synonymous-nonsense' }).statistics.concordance.ccc, 3)}`,
        asPublished.matched.n === 3341 && fmt(asPublished.statistics.pearson.r, 2) === '-0.78' && fmt(negated.statistics.pearson.r, 2) === '0.78' && fmt(negated.statistics.spearman.rho, 2) === '0.72' && !negated.statistics.concordance && fmt(rescaled.statistics.concordance.ccc, 2) === '0.78' && fmt(ba.bias, 2) === '-0.04' && fmt(ba.lower, 2) === '-0.71' && fmt(ba.upper, 2) === '0.63' && helix.length === 4 && helix.every((x) => x.mean < 0) && fmt(compareSides(a, nutlin.side).statistics.pearson.r, 2) === '0.75' && fmt(compareSides(a, nutlin.side, { scale: 'synonymous-nonsense' }).statistics.concordance.ccc, 2) === '0.72' && !rescaled.discordance.valid
        && said('tp53-screens', '3,341 variants', 'r −0.78', 'r 0.78', 'ρ 0.72', 'concordance is 0.78', 'bias −0.04', '−0.71 to 0.63', 'D184, E180, R181, C182', 'r 0.75', '0.72 rescaled'), 'as the guide says');
    }
  },

  // Public data (wave 3, slice 1): UniProt's answers as MaveScape's fetcher cached them
  // (validation/fixtures/public-data, release 2026_03), read as the page reads them.
  async 'public-data'() {
    const root = new URL('fixtures/public-data/', import.meta.url);
    const cached = (kind, name) => JSON.parse(readFileSync(new URL(`${kind}/${name}`, root), 'utf8'));
    const records = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).flatMap((kind) => readdirSync(new URL(`${kind}/`, root)).filter((f) => f.endsWith('.meta.json')).map((f) => ({ kind, name: f.replace(/\.meta\.json$/, ''), meta: cached(kind, f) })));
    // UniProt names its release; MaveDB none. A search records its words (the POST's body). NCBI's
    // records are GenBank text (wave 3, slice 3).
    // The tracks' answers (wave 3, slice 5): ClinVar's search and summaries, PDBe-KB's profiles,
    // AlphaFold DB's AlphaMissense tables, gnomAD's GraphQL answers (each with its query) and
    // MaveDB's annotations.
    const hosts = {
      UniProt: /^https:\/\/rest\.uniprot\.org\//, MaveDB: /^https:\/\/api\.mavedb\.org\/api\/v1\//,
      'NCBI E-utilities': /^https:\/\/eutils\.ncbi\.nlm\.nih\.gov\/entrez\/eutils\/(efetch\.fcgi\?db=nuccore&id=(?:[A-Z]{2}_\d+|[A-Z]{1,2}\d{5,8})\.\d+&rettype=gb|esearch\.fcgi\?db=clinvar&term=[^&]+&retmax=10000&retstart=\d+&retmode=json|esummary\.fcgi\?db=clinvar&id=\d+(,\d+)*&retmode=json)/,
      Ensembl: /^https:\/\/rest\.ensembl\.org\/sequence\/id\/ENST\d{11}\?type=cdna&mask_feature=1$/,
      'PDBe-KB': /^https:\/\/www\.ebi\.ac\.uk\/pdbe\/graph-api\/uniprot\/sequence_conservation\/[A-Z0-9]+$/,
      'AlphaFold DB': /^https:\/\/alphafold\.ebi\.ac\.uk\/(files\/AF-[A-Z0-9]+-F1-(aa-substitutions\.csv|model_v\d+\.cif)|api\/prediction\/[A-Z0-9]+)$/,
      gnomAD: /^https:\/\/gnomad\.broadinstitute\.org\/api$/,
      // Structures (wave 5, slice 1), kept compressed as they came.
      'RCSB PDB': /^https:\/\/files\.rcsb\.org\/download\/[0-9][A-Z0-9]{3}\.cif\.gz$/,
      PDBe: /^https:\/\/www\.ebi\.ac\.uk\/pdbe\/graph-api\/mappings\/best_structures\/[A-Z0-9]+$/,
    };
    const typeOf = (meta) => (/efetch\.fcgi/.test(meta.source) ? 'text/plain; charset=utf-8' : /\.cif(\.gz)?$/.test(meta.source) ? 'application/gzip' : /\.csv$/.test(meta.source) || /\/(scores|counts)$/.test(meta.source) || /\/variants\/data\?/.test(meta.source) ? 'text/csv; charset=utf-8' : 'application/json');
    const complete = records.filter(({ kind, meta }) => hosts[meta.service]?.test(meta.source) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(meta.retrieved) && (meta.service !== 'UniProt' || meta.version) && (kind !== 'mavedb-search' || (meta.method === 'POST' && JSON.parse(meta.request).text)) && (kind !== 'gnomad' || (meta.method === 'POST' && JSON.parse(meta.request).query)) && meta.contentType === typeOf(meta));
    check('public-data', 'each cached response carries its retrieval record: the service, the URL on a listed host, when it was retrieved, UniProt\'s release, a search\'s words, a GraphQL query', `${complete.length} of ${records.length} records complete (${[...new Set(records.map((r) => r.kind))].map((k) => `${k} ${records.filter((r) => r.kind === k).length}`).join(', ')})`, records.length >= 14 && complete.length === records.length, 'all');
    for (const [id, accession] of Object.entries({ 'grb2-sh3': 'P62993', hsp90: 'P02829', factor9: 'P00740' })) {
      const example = exampleById(id);
      const design = JSON.parse(readFileSync(new URL(`../web/${example.files.design}`, import.meta.url), 'utf8'));
      const target = design.targets[0];
      const entry = readUniProtEntry(cached('uniprot', `${accession}.json`));
      const placement = placeTarget(target, entry);
      const patch = placementPatch(target, entry, placement);
      check('public-data', `${example.title}: its target sits where its design says in UniProt ${accession}, identical, at one place, and the entry changes nothing in the design`, `positions ${placement.start}–${placement.end} (offset ${placement.offset}; the design's ${target.offset}), ${placement.identical ? 'identical' : `${placement.differences.length} differences`}, ${placement.places} place${placement.places > 1 ? 's' : ''}; would change ${Object.keys(patch).join(', ') || 'nothing'}`, placement.offset === target.offset && placement.identical && placement.places === 1 && !Object.keys(patch).length, 'the design\'s offset; identical; nothing');
    }
    {
      const lookup = readdirSync(new URL('uniparc/', root)).find((f) => !f.endsWith('.meta.json'));
      const { entries } = uniparcEntries(cached('uniparc', lookup));
      const grb2 = readUniProtEntry(cached('uniprot', 'P62993.json'));
      const reviewed = entries.filter((e) => e.reviewed);
      check('public-data', 'GRB2\'s whole sequence, looked up in UniProt: P62993 first among the reviewed entries with exactly that sequence, and its SHA-256 names the cached lookup', `${entries.length} active entries, ${reviewed.length} reviewed (${reviewed.slice(0, 3).map((e) => `${e.accession} ${e.organism}`).join(', ')}); cached as ${lookup.slice(0, 12)}…, the sequence's ${sha256(new TextEncoder().encode(grb2.sequence)).slice(0, 12)}…`, entries[0]?.accession === 'P62993' && lookup === `${sha256(new TextEncoder().encode(grb2.sequence))}.json`, 'P62993; the same');
    }
    {
      // The GRB2 example checked as its guide says, then scored: the check in the workspace, not
      // in the design (its runs stay current), and in the methods.
      const o = openExampleInNode(exampleById('grb2-sh3'));
      const target = o.ws.targets[0];
      const entry = readUniProtEntry(cached('uniprot', 'P62993.json'));
      const placement = placeTarget(target, entry);
      const meta = cached('uniprot', 'P62993.json.meta.json');
      const ws = recordTargetCheck(o.ws, target.id, placementPatch(target, entry, placement), referenceOf(entry, { source: meta.source, retrieved: meta.retrieved, version: meta.version }, placement), 'Checked the target against UniProt P62993');
      const source = ws.sources[0];
      const run = makeRun({ inputs: runInputs({ source, design: ws.design, parameters: o.parameters }), source, results: o.scored.results, software: { version: '0.3.0', commit: '' }, name: 'Run 1', created: '2026-10-10T12:00:00.000Z' });
      const methods = writeMethods(ws, run, { results: o.scored.results });
      const sentence = /Its position in the reference was checked against UniProt P62993 \[\d+\], release 2026_03, retrieved 2026-10-10: residues 159–214, identical\./.exec(methods.markdown)?.[0];
      check('public-data', 'the GRB2 example checked against UniProt as its guide says: the design unchanged, the check kept with the workspace and written in the methods, with UniProt cited', sentence ?? 'no sentence', ws.design === o.ws.design && ws.targets[0].reference?.release === '2026_03' && Boolean(sentence) && methods.references.some((r) => r.key === 'uniprot'), 'unchanged; kept; written; cited');
    }

    // MaveDB (wave 3, slice 2): the three feasibility records (four score sets), read with no code
    // for any of them; their published scores read as published equal MaveDB's columns.
    const FEASIBILITY = [
      ['urn:mavedb:00000835-a-1', 'mavedb-grb2-sh3', '', 'grb2-sh3'],
      ['urn:mavedb:00000003-a-1', 'mavedb-brca1-ring', 'nt/', null],
      ['urn:mavedb:00000003-a-2', 'mavedb-brca1-ring', 'aa/', null],
      ['urn:mavedb:00001200-a-1', 'mavedb-factor9', '', 'factor9'],
    ];
    for (const [urn] of FEASIBILITY) {
      const record = readScoreSet(cached('mavedb', `${urn.replaceAll(':', '_')}.json`));
      const { targets, problems } = targetsOf(record);
      check('public-data', `MaveDB ${urn}: the record read (title, license and terms, citation, target, columns)`, `"${record.title}", ${record.license.short}, ${targets.map((t) => `${t.name} ${t.sequenceType} ${t.sequence.length}${t.offset ? ` (offset ${t.offset})` : ''}`).join('; ')}; ${record.scoreColumns.length} score and ${record.countColumns.length} count columns; ${record.calibrations.length} calibrations; ${record.citation?.slice(0, 50)}…`, targets.length === 1 && !problems.length && record.license.open && Boolean(record.citation) && record.hasCounts, 'one target; open license; cited; counts');
    }
    const fx = readoutOf(readScoreSet(cached('mavedb', 'urn_mavedb_00001200-a-1.json')));
    check('public-data', 'MaveDB urn:mavedb:00001200-a-1: the experiment\'s keywords give the design\'s readout and library method, in MaveDB\'s terms', JSON.stringify(fx), fx.readout.method === 'Reporter' && fx.readout.mechanism === 'Loss of function' && fx.readout.modelSystem === 'Immortalized human cells' && fx.libraryMethod === 'Microarray synthesis', 'Reporter; Loss of function; Immortalized human cells; Microarray synthesis');
    const bap1 = readScoreSet(cached('mavedb', 'urn_mavedb_00000662-a-2.json'));
    check('public-data', 'a record whose target is named by an accession (BAP1, CC BY 4.0): shown with its terms, its target said not readable yet', `${bap1.license.short}: ${bap1.license.terms} ${targetsOf(bap1).problems[0]?.slice(0, 90)}…`, !bap1.license.open === false && /crediting the authors/.test(bap1.license.terms) && targetsOf(bap1).targets.length === 0, 'terms shown; not read');
    {
      // The published scores read as published: every row's score, SE and the variants left out,
      // against MaveDB's own columns (external data).
      const lines = [];
      let exact = true;
      for (const [urn, set, dir, exampleId] of FEASIBILITY) {
        const record = readScoreSet(cached('mavedb', `${urn.replaceAll(':', '_')}.json`));
        const target = targetsOf(record).targets[0];
        const scores = parseTable(dataset(set).bytes(`${dir}scores.csv`), { fileName: 'scores.csv' });
        const layout = detectLayout(scores);
        const design = scoresDesign(record, { table: scores, layout, target });
        const read = scoreTable(scores, design, defaultParameters(design));
        const given = scores.columns.find((c) => c.name === design.scores.score).numeric;
        const se = scores.columns.find((c) => c.name === design.scores.se).numeric;
        const c = read.results.conditions[0];
        let same = 0;
        for (let i = 0; i < scores.rows; i += 1) if (Object.is(c.score[i], given[i]) && Object.is(c.se[i], se[i])) same += 1;
        const na = given.reduce((a, x) => a + (Number.isNaN(x) ? 1 : 0), 0);
        exact &&= read.ok && same === scores.rows && c.scored === scores.rows - na;
        // The counts' design, drafted from their column names: against the documented design where
        // one describes the same table.
        const counts = parseTable(dataset(set).bytes(`${dir}counts.csv`), { fileName: 'counts.csv' });
        const { design: drafted } = countsDesign(record, { table: counts, layout: detectLayout(counts), target });
        const valid = validateDesign(drafted, { columns: counts.columns.map((x) => x.name) }).ok;
        const reference = exampleId ? JSON.parse(readFileSync(new URL(`designs/${exampleId}.design.json`, import.meta.url), 'utf8')) : null;
        // Bins compared by their order: MaveDB records no bin values, so the draft numbers them 1, 2, 3, 4
        // (the same scores, scaled per replicate, as the documented weights 0.25–1).
        const structure = (d) => meaning(d).slots.map((x) => x.replace(/\|b(\d+):[^=]+=/, '|b$1='));
        const agree = reference ? JSON.stringify(structure(drafted)) === JSON.stringify(structure(reference)) : null;
        const values = reference && drafted.model === 'bins' && JSON.stringify(meaning(drafted).slots) !== JSON.stringify(meaning(reference).slots);
        lines.push(`${urn}: ${c.scored} of ${scores.rows} as published (${na} NA), ${same} rows identical; counts drafted ${drafted.model}${valid ? ', valid' : ', NOT valid'}${agree === null ? '' : agree ? `, as the documented design${values ? ' but for the bins\' values (ranks 1–4; documented 0.25–1)' : ''}` : ', unlike the documented design'}`);
        exact &&= valid && agree !== false;
      }
      check('public-data', 'each feasibility record\'s published scores read as published equal MaveDB\'s columns, row for row (score and SE, NA left out); its counts get a valid design drafted from their names, as the documented design where one describes the same table', lines.join('; '), exact, 'identical; valid; as documented');
    }
    {
      // A workspace of published scores, opened from MaveDB, saved as an archive and reopened: its
      // record and the table's origin kept, its run recomputed to its recorded hash.
      const record = readScoreSet(cached('mavedb', 'urn_mavedb_00000835-a-1.json'));
      const target = targetsOf(record).targets[0];
      const bytes = new Uint8Array(readFileSync(new URL('fixtures/public-data/mavedb/urn_mavedb_00000835-a-1.scores.csv', import.meta.url)));
      const scores = parseTable(bytes, { fileName: 'scores.csv' });
      const design = scoresDesign(record, { table: scores, layout: detectLayout(scores), target });
      let ws = workspaceOf(scores, design, { layout: 'mavedb-scores', sha256: sha256(bytes), size: bytes.length, files: [{ fileName: 'scores.csv', sha256: sha256(bytes), size: bytes.length }], origin: { database: 'MaveDB', urn: record.urn, file: 'scores', license: 'CC0', retrieved: '2026-10-11T02:08:41Z' } });
      ws = { ...ws, records: [{ database: 'MaveDB', ...record }] };
      const parameters = defaultParameters(design);
      const read = scoreTable(scores, design, parameters);
      const run = makeRun({ inputs: runInputs({ source: ws.sources[0], design: ws.design, parameters }), source: ws.sources[0], results: read.results, software: SOFTWARE, name: 'Published scores', created: '2026-10-11T02:10:00.000Z' });
      ws = addRun(ws, run).ws;
      const archive = await writeArchive(ws, { software: SOFTWARE, sources: new Map([[sha256(bytes), bytes]]), results: new Map([[run.id, read.results]]) });
      const reopened = await readArchive(archive.bytes);
      const again = recompute(reopened.ws, reopened.sources);
      check('public-data', 'a workspace of published scores from MaveDB saved as an archive reopens: its record and the table\'s origin kept, its run (read as published) recomputed to its recorded hash', `${reopened.problems.length} problems; record ${reopened.ws.records?.[0]?.urn}; origin ${reopened.ws.sources[0].origin?.urn}; output ${outputDigest(again.scored.results).slice(0, 12)}… against ${run.output.sha256.slice(0, 12)}…`, !reopened.problems.length && reopened.ws.records?.[0]?.urn === record.urn && reopened.ws.sources[0].origin?.file === 'scores' && outputDigest(again.scored.results) === run.output.sha256, 'kept; the same');
    }
    {
      // MaveDB's mapped variants (wave 3, slice 3): GRB2's, joined to its scores by each variant's
      // accession; each mapped protein name on NP_002077.1 the table's own at the target's position
      // plus the UniProt offset (158), with the same amino acids.
      const mapped = mappedVariants(cached('mavedb', 'urn_mavedb_00000835-a-1.mapped.json'));
      const back = readMapped(parseTable(mappedCSV(mapped)));
      const scores = parseTable(readFileSync(new URL('fixtures/public-data/mavedb/urn_mavedb_00000835-a-1.scores.csv', import.meta.url)), { fileName: 'scores.csv' });
      const accession = columnText(scores.columns.find((c) => c.name === 'accession'));
      const pro = columnText(scores.columns.find((c) => c.name === 'hgvs_pro'));
      let joined = 0;
      let agree = 0;
      const differ = [];
      accession.forEach((a, i) => {
        const m = back.get(a);
        if (!m) return;
        joined += 1;
        const ours = /^p\.([A-Z][a-z]{2})(\d+)([A-Z][a-z]{2}|=)$/.exec(pro[i]);
        const theirs = /^NP_002077\.1:p\.([A-Z][a-z]{2})(\d+)([A-Z][a-z]{2}|=)$/.exec(m.hgvs ?? '');
        if (ours && theirs && ours[1] === theirs[1] && Number(ours[2]) + 158 === Number(theirs[2]) && (ours[3] === theirs[3] || (ours[3] === '=' && theirs[3] === ours[1]))) agree += 1;
        else differ.push(`${pro[i]} ↦ ${m.hgvs}`);
      });
      const wellFormed = mapped.every((m) => /^ga4gh:VA\.[A-Za-z0-9_-]{32}$/.test(m.vrs ?? ''));
      check('public-data', 'MaveDB\'s mapped variants of GRB2 (VRS 2.0): each current mapping joined to its row of scores by the variant\'s accession, its VRS identifier well formed, its protein on NP_002077.1 the table\'s at the target\'s position plus the UniProt offset (158), the same amino acids', `${mapped.length} mapped; ${joined} of ${scores.rows} rows joined; ${agree} agree${differ.length ? `; ${differ.length} differ: ${differ.slice(0, 3).join('; ')}` : ''}; identifiers ${wellFormed ? 'well formed' : 'not all well formed'}`, joined === mapped.length && joined >= 1100 && agree === joined && wellFormed, 'joined; agree; well formed');
    }
    {
      // A score set of scores alone (PTEN, the example): what the readiness names, and where.
      const record = readScoreSet(cached('mavedb', 'urn_mavedb_00000013-a-1.json'));
      const target = targetsOf(record).targets[0];
      const scores = parseTable(dataset('mavedb-pten-vampseq').bytes('scores.csv'), { fileName: 'scores.csv' });
      const design = scoresDesign(record, { table: scores, layout: detectLayout(scores), target });
      const ws = workspaceOf(scores, design, { layout: 'mavedb-scores', origin: { database: 'MaveDB', urn: record.urn, file: 'scores', hasCounts: false, rawReads: record.experiment.rawReads.map((r) => r.id) } });
      const r = readiness(ws);
      const counts = r.gaps.find((g) => g.id === 'counts');
      const status = Object.fromEntries(r.analyses.map((a) => [a.id, a.status]));
      check('public-data', 'a record of scores alone: the map, QC of what scores show and comparison possible; rescoring and QC of the counts not, the counts named with where they may be (the record names its raw reads)', `${JSON.stringify(r.base)}; rescore ${status['score.rescore']}, map ${status['record.scores']}, compare ${status['record.compare']}; counts: ${counts?.where}`, r.base.scores && status['score.rescore'] === 'unavailable' && status['qc.counts'] === 'unavailable' && status['record.scores'] === 'ready' && status['record.compare'] === 'ready' && /MaveDB has no counts for urn:mavedb:00000013-a-1/.test(counts?.where) && /PRJNA428380/.test(counts?.where), 'as said');
    }
  },

  // Wave 3, slice 4: MaveDB deposits, as MaveDB's own validators take them (the mavedb package,
  // AGPL-3.0, as an external reference: reference/generate_mavedb_export.py), and read back.
  'mavedb-export'() {
    const reference = JSON.parse(readFileSync(new URL('./reference/mavedb-export.json', import.meta.url), 'utf8'));
    const { packages, missing } = depositPackages();
    if (missing.length) throw new MissingData(missing.join('; '));
    const t = reference.tools;
    check('mavedb-export', 'reference made with', `mavedb ${t.mavedb}, mavehgvs ${t.mavehgvs}, biocommons hgvs ${t.hgvs}, pandas ${t.pandas}, pydantic ${t.pydantic}; transcripts ${reference.transcripts.join(', ')}`, t.mavedb === '2026.2.7.4' && t.mavehgvs === '0.8.1' && t.hgvs === '1.5.7', 'mavedb 2026.2.7.4, mavehgvs 0.8.1, hgvs 1.5.7');
    // The files written now are the ones the validators checked.
    const same = (a, b) => b && Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([k, v]) => b[k] === v);
    const stale = packages.filter((p) => !same(mavedbHashes(p.deposit), reference.packages[p.id]?.files));
    const files = packages.reduce((n, p) => n + Object.keys(mavedbHashes(p.deposit)).length, 0);
    check('mavedb-export', 'every deposit written now is the one MaveDB\'s validators checked: each file\'s SHA-256 as in reference/mavedb-export.json', `${packages.length} deposits, ${files} files${stale.length ? `; changed: ${stale.map((p) => p.id).join(', ')} (regenerate the reference)` : ''}`, !stale.length && packages.length === Object.keys(reference.packages).length, 'all the same');
    // The tables, as MaveDB's upload reads them and its variant-creation job checks them.
    const of = (p) => reference.packages[p.id];
    const tablesBad = packages.filter((p) => !of(p)?.tables.ok || of(p).tables.scores.rows !== p.deposit.report.variants.exported);
    const rows = packages.reduce((n, p) => n + p.deposit.report.variants.exported, 0);
    check('mavedb-export', 'the scores and counts pass MaveDB\'s validate_and_standardize_dataframe_pair with their column descriptions and target (mavehgvs against a target\'s sequence, biocommons hgvs against a transcript), every row read', `${packages.length - tablesBad.length} of ${packages.length} (${rows.toLocaleString('en-US')} rows; ${packages.filter((p) => p.deposit.files.some((f) => f.name === 'counts.csv')).length} with counts)${tablesBad.length ? `; refused: ${tablesBad.map((p) => `${p.id} ${of(p)?.tables.error ?? 'not checked'}`).join('; ')}` : ''}`, !tablesBad.length, 'all');
    const names = packages.reduce((n, p) => n + (of(p)?.names.checked ?? 0), 0);
    const namesBad = packages.filter((p) => !of(p)?.names.ok);
    check('mavedb-export', 'every name in the tables valid MAVE-HGVS by mavehgvs 0.8.1 in strict mode', `${names.toLocaleString('en-US')} names${namesBad.length ? `; invalid in ${namesBad.map((p) => `${p.id}: ${of(p).names.invalid.slice(0, 2).join(', ')}`).join('; ')}` : ''}`, !namesBad.length && names >= rows, 'all');
    // The experiment and the score set: MaveDB's models take them when MaveScape says nothing is
    // missing, and refuse them, for what MaveScape names, when it says something is.
    const metadata = packages.map((p) => {
      const r = of(p);
      const ok = r?.experiment.ok && r?.scoreSet.ok;
      const expected = p.expect === 'ok';
      const said = p.deposit.report.missing.map((m) => m.field);
      const agrees = expected ? ok && !said.length : !ok && said.includes(p.expect) && new RegExp(`${p.expect}Text|${p.expect}`).test(`${r?.experiment.error ?? ''} ${r?.scoreSet.error ?? ''}`);
      return { p, ok, agrees };
    });
    const disagree = metadata.filter((m) => !m.agrees);
    check('mavedb-export', 'experiment.json as MaveDB\'s ExperimentCreate (keywords by its validate_keyword_list and in its vocabulary), score_set.json as its ScoreSetCreate: taken when MaveScape reports nothing missing, refused for what it names when it does (a deposit without an abstract)', `${metadata.filter((m) => m.ok).length} taken, ${metadata.filter((m) => !m.ok).length} refused as said${disagree.length ? `; disagree: ${disagree.map((m) => m.p.id).join(', ')}` : ''}`, !disagree.length && metadata.filter((m) => !m.ok).length === 1, 'all as said');
    // Every kind of run and target MaveDB takes.
    const modes = Object.fromEntries(['protein', 'coding', 'noncoding', 'accession'].map((m) => [m, packages.filter((p) => p.deposit.report.mode === m).length]));
    const passed = packages.filter((p) => JSON.parse(p.deposit.files.find((f) => f.name === 'mavescape.json').text).run.published).length;
    check('mavedb-export', 'the kinds of deposit: protein variants; c. names with their protein changes on the coding sequence; n. names on the whole sequence; names prefixed by a RefSeq or Ensembl transcript; runs scored from counts (two populations, a time series, sorted bins, barcodes, two conditions) and published scores passed through', `${Object.entries(modes).map(([k, v]) => `${k} ${v}`).join(', ')}; ${packages.length - passed} scored, ${passed} published`, Object.values(modes).every((n) => n > 0) && passed >= 4 && packages.length - passed >= 10, 'each');
    // Export → import → export: the files MaveDB reads, the same bytes.
    const trips = packages.map((p) => ({ p, ...roundTrip(p.deposit) }));
    const differ = trips.filter((x) => !x.same);
    check('mavedb-export', 'export → import → export: each deposit read back as MaveScape opens a MaveDB package (its published scores read as published, its counts beside them, its MaveDB details kept) and written again, the files MaveDB reads the same bytes', `${trips.length - differ.length} of ${trips.length} the same${differ.length ? `; differ: ${differ.map((x) => `${x.p.id} (${x.differ.join(', ')})`).join('; ')}` : ''}`, !differ.length, 'all');
    // MaveDB's controlled vocabulary, as MaveScape writes the experiment's keywords.
    const vocabulary = JSON.parse(readFileSync(new URL('./fixtures/public-data/mavedb-keywords.json', import.meta.url), 'utf8'));
    const keys = Object.keys(vocabulary.keywords);
    const vocabDiffer = keys.filter((k) => JSON.stringify([...(MAVEDB_KEYWORDS[k] ?? [])].sort()) !== JSON.stringify(vocabulary.keywords[k].map((x) => x.label).sort()));
    check('mavedb-export', `MaveScape's keyword vocabulary (readout.js, MAVEDB_KEYWORDS) is MaveDB's: every key and label of /api/v1/controlled-keywords (retrieved ${vocabulary.retrieved})`, `${keys.length} keys, ${keys.reduce((n, k) => n + vocabulary.keywords[k].length, 0)} labels${vocabDiffer.length ? `; differ: ${vocabDiffer.join(', ')}` : ''}`, !vocabDiffer.length && keys.length === Object.keys(MAVEDB_KEYWORDS).length, 'the same');
  },

  // Sequence tracks and annotations (wave 3, slice 5): the published examples' targets annotated
  // from public data as the fetcher cached them (fixtures/public-data, offline), and the files a
  // person may add (fixtures/annotations), each against an outside reference: Capra & Singh's
  // score_conservation.py (reference/annotations.json, generate_annotations.py), UniProt's GFF3
  // beside its JSON, AlphaFold DB's and ClinVar's own fields, MaveDB's join of gnomAD to BRCA1's
  // variants.
  async annotations() {
    const ref = annotationReference();
    const grb2 = exampleContext('grb2-sh3');
    const f9 = exampleContext('factor9');
    const hsp90 = exampleContext('hsp90');
    const sha = (path) => createHash('sha256').update(readFileSync(new URL(`./fixtures/${path}`, import.meta.url))).digest('hex');
    const stale = [ref.alignment, ...ref.profiles].filter((x) => sha(x.file) !== x.sha256);
    check('annotations', 'reference made with', `score_conservation.py (SHA-256 ${ref.tool.sha256.slice(0, 12)}…) under Python ${ref.tool.python}; the fixtures it read unchanged${stale.length ? `; changed: ${stale.map((x) => x.file).join(', ')}` : ''}`, !stale.length, 'the same files');

    // Conservation from an alignment, as the tool scores it.
    {
      const sto = annotationProvider('alignment').read(annotationFixture('annotations/grb2-sh3.sto'), { ...grb2, record: { file: 'grb2-sh3.sto' } });
      const fasta = annotationProvider('alignment').read(annotationFixture('annotations/grb2-sh3.fasta'), { ...grb2, record: { file: 'grb2-sh3.fasta' } });
      const t = fasta.tracks[0];
      const { first, last } = t.alignment;
      let worst = 0;
      let unscored = 0;
      ref.alignment.scores.forEach((x, j) => {
        const mine = t.values[first - 1 + j];
        if (x === null) unscored += Number.isNaN(mine) ? 0 : 1;
        else worst = Math.max(worst, Math.abs(mine - x));
      });
      const same = [...sto.tracks[0].values].every((x, i) => Object.is(x, t.values[i]));
      check('annotations', `conservation from an alignment (Pfam's SH3 seed with the human GRB2 SH3 first, ${ref.alignment.sequences} sequences) as Capra & Singh's score_conservation.py scores it by default, each of the query's residues on the GRB2 example's target; read the same from Stockholm and FASTA`, `${ref.alignment.scores.length} residues at positions ${first}–${last}, largest difference ${worst.toExponential(1)}${unscored ? `, ${unscored} scored where the tool scores none` : ''}; Stockholm and FASTA ${same ? 'the same' : 'differ'}`, worst <= 1e-9 && !unscored && same && first === 4 && last === 49, '≤ 10⁻⁹ (the tool prints 12 decimals); positions 4–49');
    }
    // PDBe-KB's profiles.
    {
      let positions = 0;
      let worst = 0;
      for (const p of ref.profiles) {
        const mine = readProfile(JSON.parse(annotationFixture(p.file)));
        positions += mine.length;
        p.divergence.forEach((x, i) => { worst = Math.max(worst, Math.abs(mine[i].divergence - x)); });
      }
      const placed = [['GRB2', grb2, 'P62993'], ['factor IX', f9, 'P00740'], ['Hsp90', hsp90, 'P02829']].map(([name, c, a]) => {
        const read = annotationProvider('pdbe-conservation').read(annotationFixture(`public-data/pdbe/${a}.conservation.json`), c);
        return `${name} ${[...read.tracks[0].values].filter(Number.isFinite).length} of ${c.length}`;
      });
      check('annotations', 'conservation from PDBe-KB\'s profiles (GRB2, factor IX, Hsp90): each position\'s divergence as the tool\'s js_divergence gives it for the profile\'s probabilities; placed on each example\'s target by its offset', `${positions} positions, largest difference ${worst.toExponential(1)}; on the targets: ${placed.join(', ')}`, worst <= 1e-12 && placed[0] === 'GRB2 56 of 56', '≤ 10⁻¹²');
    }
    // UniProt's features, from its JSON and its GFF3.
    {
      const rows = [['GRB2', grb2, 'P62993'], ['factor IX', f9, 'P00740'], ['Hsp90', hsp90, 'P02829']].map(([name, c, a]) => {
        const json = annotationProvider('uniprot-features').read(annotationFixture(`public-data/uniprot/${a}.features.json`), c);
        const gff = annotationProvider('custom').read(annotationFixture(`annotations/${a}.gff`), c);
        const shape = (tracks) => JSON.stringify(tracks.map((t) => [t.part, t.features.map((f) => `${f.type} ${f.start}-${f.end}`).sort()]));
        return { name, same: shape(json.tracks) === shape(gff.tracks), count: json.tracks.reduce((n, t) => n + t.features.length, 0), json };
      });
      const domain = rows[0].json.tracks[0].features[0];
      const wrong = annotationProvider('uniprot-features').read(annotationFixture('public-data/uniprot/P62993.features.json'), { ...grb2, offset: 0 });
      check('annotations', 'UniProt\'s features as MaveScape reads its JSON and its GFF3 (release 2026_03): the same tracks of the same features on each example\'s target; GRB2\'s SH3 2 domain (156–215) over the whole target (159–214); a wrong offset refused, not drawn', `${rows.map((r) => `${r.name} ${r.count} features, ${r.same ? 'the same' : 'differ'}`).join('; ')}; GRB2: ${domain.label} ${domain.start}–${domain.end}${domain.clipped ? ' (clipped)' : ''}; offset 0: ${wrong.problem ? 'refused' : 'drawn'}`, rows.every((r) => r.same) && domain.start === 1 && domain.end === 56 && Boolean(wrong.problem), 'the same; refused');
    }
    // AlphaMissense.
    {
      const counts = [];
      let differ = 0;
      let classed = 0;
      for (const [name, c, a] of [['GRB2', grb2, 'P62993'], ['factor IX', f9, 'P00740']]) {
        const text = annotationFixture(`public-data/alphafold/${a}.aa-substitutions.csv`);
        const table = new Map(text.trim().split(/\r?\n/).slice(1).map((l) => l.split(',')).map(([v, x, k]) => [v, { x: Number(x), k }]));
        const t = annotationProvider('alphamissense').read(text, c).tracks[0];
        for (const e of t.entries) {
          const row = table.get(`${e.ref}${e.position + c.offset}${e.alt}`);
          if (!row || row.x !== e.value || { LPath: 'pathogenic', Amb: 'ambiguous', LBen: 'benign' }[row.k] !== e.cls) differ += 1;
        }
        // AlphaMissense's classes are its thresholds on the score (Cheng et al. 2023).
        for (const { x, k } of table.values()) if ((k === 'LPath') === (x > 0.564) && (k === 'LBen') === (x < 0.34)) classed += 1; else classed -= 1e9;
        counts.push(`${name} ${t.entries.length.toLocaleString('en-US')} of ${(c.length * 19).toLocaleString('en-US')}`);
      }
      check('annotations', 'AlphaMissense as AlphaFold DB publishes it: every substitution of GRB2\'s and factor IX\'s targets with the table\'s score and class; each class the authors\' threshold on the score (likely pathogenic > 0.564, likely benign < 0.34)', `${counts.join(', ')} placed; ${differ} differ from the table; ${classed.toLocaleString('en-US')} rows classed by the thresholds`, differ === 0 && classed > 0, 'none differ; every row');
    }
    // ClinVar.
    {
      const [g] = await publicAnnotations(grb2, ['clinvar']);
      const [f] = await publicAnnotations(f9, ['clinvar'], { gene: 'F9' });
      const raw = (gene) => {
        const out = [];
        for (const file of readdirSync(new URL('./fixtures/public-data/clinvar/', import.meta.url)).filter((x) => x.endsWith('.summary.json'))) {
          const result = JSON.parse(annotationFixture(`public-data/clinvar/${file}`)).result;
          for (const uid of result.uids) if (result[uid].title.includes(`(${gene}):`)) out.push(result[uid]);
        }
        return out;
      };
      const agree = (got, gene) => {
        const byAccession = new Map(raw(gene).map((r) => [r.accession, r]));
        const entries = got.read.tracks[0].entries;
        const rows = new Map(readClinVarTable(got.got.text).map((r) => [r.hgvs_c, r]));
        let bad = 0;
        for (const e of entries) {
          const r = byAccession.get(rows.get(e.name)?.accession);
          const c = r?.germline_classification ?? {};
          if (!r || (clinvarClass(c.description) ?? 'other') !== e.cls || (REVIEW_STARS[String(c.review_status).toLowerCase()] ?? 0) !== e.stars) bad += 1;
        }
        return { records: byAccession.size, kept: got.got.record.kept, placed: entries.length, bad, residues: entries.every((e) => (gene === 'GRB2' ? grb2 : f9).protein[e.position - 1] === e.ref) };
      };
      const a = agree(g, 'GRB2');
      const b = agree(f, 'F9');
      check('annotations', 'ClinVar\'s records of GRB2 and F9 (NCBI E-utilities: the search, then the summaries 500 at a time): every record read; those on the GRB2 SH3 and the whole factor IX placed where their residues agree, each with ClinVar\'s own classification and review status (as stars)', `GRB2 ${a.kept} of ${a.records} read, ${a.placed} on the target; F9 ${b.kept} of ${b.records} read, ${b.placed} on the target; ${a.bad + b.bad} differ from ClinVar's fields; residues ${a.residues && b.residues ? 'all agree' : 'disagree'}`, a.kept === a.records && b.kept === b.records && b.records === 553 && !a.bad && !b.bad && a.residues && b.residues && b.placed > 400, 'all');
    }
    // gnomAD against MaveDB's own join of gnomAD to BRCA1's variants.
    {
      const answer = JSON.parse(annotationFixture('public-data/gnomad/ENST00000357654.variants.json'));
      const ours = new Map(answer.data.transcript.variants.map((v) => [v.variant_id, v.joint]));
      const csv = parseTable(readFileSync(new URL('./fixtures/public-data/mavedb/urn_mavedb_00000097-0-2.annotations.clinvar_2026_01.csv', import.meta.url)), { fileName: 'annotations.csv' });
      const col = (n) => columnText(csv.columns.find((c) => c.name === n));
      const [ids, afs, acs, ans] = ['gnomad.gnomad_id', 'gnomad.gnomad_af', 'gnomad.gnomad_ac', 'gnomad.gnomad_an'].map(col);
      let compared = 0;
      let worst = 0;
      let missing = 0;
      ids.forEach((id, r) => {
        if (!id || id === 'NA') return;
        const j = ours.get(id);
        if (!j) {
          missing += 1;
          return;
        }
        compared += 1;
        worst = Math.max(worst, Math.abs(j.ac / j.an - Number(afs[r])) / Number(afs[r]), j.ac === Number(acs[r]) && j.an === Number(ans[r]) ? 0 : 1);
      });
      const rows = gnomadRows(answer);
      check('annotations', 'gnomAD v4\'s frequencies as MaveScape reads them (BRCA1\'s MANE Select transcript, exomes and genomes joined) equal MaveDB\'s own join of gnomAD v4.1 to BRCA1\'s saturation genome editing variants, variant by variant (by gnomAD\'s identifier)', `${compared} of ${compared + missing} of MaveDB's variants found, largest relative difference ${worst.toExponential(1)}; ${rows.length.toLocaleString('en-US')} variants of ENST00000357654 with a protein change`, compared >= 40 && !missing && worst <= 1e-12, 'all, ≤ 10⁻¹²');
    }
    // MaveDB's annotations joined to the BRCA1 example's run.
    try {
      const o = openExampleInNode(EXAMPLES.find((e) => e.id === 'brca1-sge'));
      const results = proteinView(o.scored.results) ?? o.scored.results;
      const own = o.scored.results;
      const v = own.variants;
      const accession = columnText(o.table.columns.find((c) => c.name === 'accession'));
      const variants = new Map();
      for (let i = 0; i < own.rows; i += 1) {
        const key = v.proKey ? v.proKey[i] : v.key[i];
        const item = { key: /^p\.[A-Z][a-z]{2}\d+([A-Z][a-z]{2}|=)$/.test(key ?? '') ? key : null, position: v.proPosition ? v.proPosition[i] : v.position[i] };
        variants.set(accession[i], item);
        variants.set(v.original[i], item);
      }
      const target = o.design.targets[0];
      const protein = targetProtein(target).replace(/\*$/, '');
      const text = readFileSync(new URL('./fixtures/public-data/mavedb/urn_mavedb_00000097-0-2.annotations.clinvar_2026_01.csv', import.meta.url), 'utf8');
      const read = annotationProvider('mavedb-annotations').read(text, { target, protein, offset: 0, length: protein.length, variants });
      const csv = parseTable(new TextEncoder().encode(text), { fileName: 'a.csv' });
      const sig = columnText(csv.columns.find((c) => c.name === 'clinvar.2026_01.clinical_significance'));
      const af = columnText(csv.columns.find((c) => c.name === 'gnomad.gnomad_af'));
      const annotated = sig.filter((x, r) => (x && x !== 'NA' && x !== '-') || (af[r] && af[r] !== 'NA')).length;
      const unmatched = read.notes.find((n) => /not in the run/.test(n));
      const [clinvar, gnomad] = read.tracks;
      const theirs = new Map();
      sig.forEach((x) => { if (x && x !== 'NA' && x !== '-') theirs.set(x, (theirs.get(x) ?? 0) + 1); });
      check('annotations', 'MaveDB\'s annotations of BRCA1\'s saturation genome editing score set (ClinVar 2026_01, gnomAD v4.1), joined to the example\'s run by MaveDB accession: every annotated variant found; those that change one residue on the map, the rest said', `${annotated.toLocaleString('en-US')} annotated variants${unmatched ? `; ${unmatched}` : ', all in the run'}; on the map: ClinVar ${clinvar?.entries.length ?? 0}, gnomAD ${gnomad?.entries.length ?? 0}; ${read.notes.join(' ')} MaveDB's classes: ${[...theirs].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k, n]) => `${n} ${k}`).join(', ')}`, !unmatched && clinvar?.entries.length > 0 && gnomad?.entries.length > 0 && results.rows > 0, 'all found');
    } catch (error) {
      if (!(error instanceof MissingExampleData)) throw error;
      throw new MissingData(error.message);
    }
    // The GRB2 example's tracks kept with a workspace, in its archive and back; each with its source.
    {
      const fetched = await publicAnnotations(grb2, ['uniprot-features', 'pdbe-conservation', 'alphamissense', 'clinvar', 'gnomad']);
      const files = [['alignment', 'grb2-sh3.sto'], ['custom', 'P62993.gff']].map(([provider, name]) => ({ provider, name, text: annotationFixture(`annotations/${name}`), record: { service: 'a file', file: name } }));
      let ws = createWorkspace('GRB2 tracks', { id: 'ws-tracks', now: '2026-10-11T00:00:00Z' });
      const bytes = new Map();
      for (const x of [...fetched.map((f) => ({ provider: f.provider, name: f.annotation.name, text: f.got.text, fileName: f.got.fileName, record: f.got.record })), ...files.map((f) => ({ ...f, fileName: f.name }))]) {
        const data = new TextEncoder().encode(x.text);
        const hash = sha256(data);
        bytes.set(hash, data);
        ws = addAnnotation(ws, { provider: x.provider, name: x.name, file: { fileName: x.fileName, sha256: hash, size: data.length }, record: x.record }).ws;
      }
      const tracksOf = (w, files) => w.annotations.flatMap((a) => annotationTracks(a, new TextDecoder().decode(files.get(a.file.sha256)), grb2).tracks);
      const before = tracksOf(ws, bytes);
      const archive = await writeArchive(ws, { annotations: bytes });
      const back = await readArchive(archive.bytes);
      const after = tracksOf(back.ws, back.sources);
      const valuesOf = (t) => JSON.stringify(t.kind === 'values' ? [...t.values].map((x) => (Number.isNaN(x) ? null : x)) : t.kind === 'features' ? t.features : t.entries.map((e) => [e.key, e.value, e.cls]));
      const same = before.length === after.length && before.every((t, i) => t.id === after[i].id && valuesOf(t) === valuesOf(after[i]));
      const sourced = before.filter((t) => t.source?.service && (t.source.file || /^\d{4}-\d{2}-\d{2}T/.test(t.source.retrieved ?? '')));
      const released = before.filter((t) => t.source?.service === 'UniProt').every((t) => t.source.release === '2026_03');
      check('annotations', 'the GRB2 example\'s annotations (UniProt features, PDBe-KB conservation, AlphaMissense, ClinVar, gnomAD, an alignment, a GFF3 file) kept with a workspace, written to its archive and read back: the same tracks with the same values; every track naming its source (the service and when it was retrieved, UniProt\'s release; or its file)', `${ws.annotations.length} annotations, ${before.length} tracks; after the archive ${same ? 'the same' : 'different'}${back.problems.length ? `; problems: ${back.problems.join(' ')}` : ''}; ${sourced.length} of ${before.length} with their source${released ? ', UniProt\'s release 2026_03' : ''}`, same && !back.problems.length && sourced.length === before.length && released && before.length >= 9, 'the same; all');
      // The tracks as a table, read back as custom tracks.
      const values = before.filter((t) => t.kind === 'values');
      const model = { length: grb2.length, protein: grb2.protein, target: { offset: grb2.offset } };
      const reread = annotationProvider('custom').read(tracksCSV(values, model), grb2).tracks;
      const round6 = (x) => (Number.isFinite(x) ? Number(x.toPrecision(6)) : null);
      const roundTrip = values.every((t, i) => reread[i] && [...t.values].every((x, p) => Object.is(round6(x), round6(reread[i].values[p]))));
      check('annotations', 'the tracks exported as a table (CSV, position by position) read back as custom tracks: every value as written (6 significant digits)', `${values.length} tracks of values, ${roundTrip ? 'the same' : 'different'}`, roundTrip && values.length >= 2, 'the same');
      // What the GRB2 example's guide says of its tracks (lib/examples.js, expected).
      try {
        const o = openExampleInNode(EXAMPLES.find((e) => e.id === 'grb2-sh3'));
        const model = buildMapModel(o.scored.results, o.design, {});
        const am = before.find((t) => t.id === 'alphamissense:alphamissense').values;
        const pdbe = before.find((t) => t.id === 'pdbe-conservation:conservation').values;
        const least = [...model.columnMedian].map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]).slice(0, 8);
        const pairs = [...model.columnMedian].map((x, i) => [x, pdbe[i]]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
        const rho = spearman(pairs.map((p) => p[0]), pairs.map((p) => p[1]));
        check('annotations', 'the GRB2 example as its guide says: AlphaMissense calls the eight least tolerant positions likely pathogenic (each a mean above 0.9); conservation (PDBe-KB) follows the position effects only in part', `least tolerant ${least.map(([, i]) => `${grb2.protein[i]}${i + 159} ${am[i].toFixed(2)}`).join(', ')}; Spearman ρ of the position effect and conservation ${rho.toFixed(2)}`, least.every(([, i]) => am[i] > 0.9) && rho < -0.3 && rho > -0.6, 'all > 0.9; ρ from −0.6 to −0.3');
      } catch (error) {
        if (!(error instanceof MissingExampleData)) throw error;
      }
      // Offline, each provider asks only for what it needs, by public identifier.
      const asked = fetched.map((f) => `${f.provider}: ${f.asked.map((p) => p.replace(/ids=[\d,]+/, 'ids=…')).join(', ')}`);
      const expected = ['uniprot-features: uniprot/P62993/features', 'pdbe-conservation: pdbe/conservation/P62993', 'alphamissense: alphafold/P62993/missense', 'clinvar: clinvar/search?gene=GRB2&page=1, clinvar/summary?ids=…', 'gnomad: gnomad/gene/GRB2, gnomad/transcript/ENST00000316804'];
      check('annotations', 'what each provider asks the fetcher (docs/NETWORK.md): an accession, a gene\'s symbol, ClinVar\'s record numbers, a transcript; never a sequence', asked.join('; '), JSON.stringify(asked) === JSON.stringify(expected), expected.join('; '));
    }
  },

  // Wave 4, slice 1 (C1–C3): comparisons within a workspace. The agreement statistics against R;
  // their intervals' coverage in simulated pairs of known agreement; the compatibility report's
  // rules on the GRB2 example (bundled) and on pairs made from it; then the published examples
  // compared as their guides say (external data).
  async compare() {
    const reference = JSON.parse(readFileSync(new URL('./reference/compare.json', import.meta.url), 'utf8'));
    const pairs = [];
    for (const c of reference.cases) {
      const st = agreementOf(Float64Array.from(c.x), Float64Array.from(c.y));
      const add = (group, ours, theirs, keys) => { for (const k of keys) pairs.push([`${c.name}: ${group}.${k}`, ours[k], theirs[k]]); };
      add('pearson', st.pearson, c.pearson, ['r', 'low', 'high']);
      add('spearman', st.spearman, c.spearman, ['rho', 'low', 'high']);
      add('concordance', st.concordance, c.concordance, ['ccc', 'low', 'high', 'scaleShift', 'locationShift', 'accuracy']);
      add('blandAltman', st.blandAltman, c.blandAltman, Object.keys(c.blandAltman));
      add('trend', st.blandAltman.trend, c.trend, ['slope', 'low', 'high', 'p']);
    }
    const r = worstDifference(pairs);
    check('compare', `the agreement statistics of ${reference.cases.length} pairs (${reference.cases.map((c) => c.name).join('; ')}) equal R's: Pearson's r and its interval (cor.test), Spearman's ρ with Bonett and Wright's interval, Lin's concordance with its z-transform interval, scale and location shifts and accuracy (DescTools' CCC), Bland–Altman's bias and limits with their intervals (BlandAltmanLeh), the trend of the differences (lm)`, `${pairs.length} numbers; largest relative difference ${r.worst.toExponential(1)} (${r.where}); ${reference.generator}`, r.worst <= 1e-10, '≤ 1e-10');

    // Coverage: 2,000 simulated pairs of each kind, the share of 95% intervals holding the truth.
    const kinds = [
      ['30 variants, r 0.89 on one scale', { seed: 41, n: 30, b: 1, s: 0.5 }],
      ['200 variants, a weak r 0.29', { seed: 42, n: 200, b: 0.3, s: 1 }],
      ['200 variants, twice the scale and shifted (r 0.99)', { seed: 43, n: 200, a: 0.5, b: 2, s: 0.3 }],
      ['1,000 variants, r 0.89 at 0.8 the scale, shifted', { seed: 44, n: 1000, a: 0.2, b: 0.8, s: 0.4 }],
      ['30 variants, twice the scale and shifted (r 0.99)', { seed: 45, n: 30, a: 0.5, b: 2, s: 0.3 }],
    ];
    // Where the asymptotic intervals are known to hold less, they are reported apart, as they are:
    // Spearman's ρ is biased below the truth near ±1 (Kendall and Gibbons, Rank Correlation
    // Methods, 1990), and Lin's interval needs more variants when the scales differ.
    const apart = [];
    for (const [label, config] of kinds) {
      const c = coverage({ ...config, reps: 2000 });
      const shares = Object.entries(c.share);
      const near = Math.abs(c.truth.pearson) > 0.97;
      const set = near ? (config.n < 100 ? ['spearman', 'concordance'] : ['spearman']) : [];
      for (const k of set) apart.push([`${label}: ${k === 'spearman' ? 'Spearman' : 'Lin'}`, c.share[k], k]);
      const judged = shares.filter(([k]) => !set.includes(k));
      check('compare', `95% intervals in simulated pairs (${label}; 2,000 pairs): each holds the truth about 95% of the time${set.length ? ` (${set.map((k) => (k === 'spearman' ? 'Spearman\'s' : 'Lin\'s')).join(' and ')} apart, below)` : ''}`, shares.map(([k, v]) => `${k} ${v.toFixed(3)}`).join(', '), judged.every(([, v]) => v >= 0.93 && v <= 0.97), '0.93–0.97');
    }
    check('compare', 'near r = 1 (0.99, a twofold scale): Spearman\'s interval holds the truth less often, its ρ biased below the truth there, the more so with few variants; and with 30 variants Lin\'s too. Reported as they are', apart.map(([l, v]) => `${l} ${v.toFixed(3)}`).join('; '), apart.length === 3 && apart.every(([, v, k]) => v >= (k === 'spearman' ? 0.85 : 0.9)), 'Spearman\'s ≥ 0.85, Lin\'s ≥ 0.90');

    // The report's rules, on the GRB2 example (bundled) and on pairs made from it.
    const g = exampleRun('grb2-sh3');
    const side = (ws, p, spec) => describeSide(ws, p.run, p.results, { run: p.run.id, ...spec });
    const status = (c, id) => c.report.items.find((i) => i.id === id)?.status;
    const reps = g.results.replicates.map((x) => x.id);
    const two = compareSides(side(g.ws, g, { replicate: reps[0] }), side(g.ws, g, { replicate: reps[1] }));
    const own = pearson(two.x, two.y);
    check('compare', 'GRB2\'s replicates 1 and 2: one target, protein variants, one scale, no sample in common, so every item ok and every statistic given; Pearson\'s r as this suite computes it on the same pairs', `${two.report.status}; ${two.matched.n} variants; r ${fmt(two.statistics.pearson.r, 4)} (${fmt(own, 4)} here), ρc ${fmt(two.statistics.concordance.ccc, 4)}, bias ${fmt(two.statistics.blandAltman.bias, 4)}`, two.report.status === 'ok' && two.matched.n > 1000 && Math.abs(own - two.statistics.pearson.r) < 1e-12 && two.statistics.concordance && two.statistics.blandAltman, 'ok; the same r');
    const inside = compareSides(side(g.ws, g, { condition: 0 }), side(g.ws, g, { replicate: reps[0] }));
    check('compare', 'GRB2\'s Run 1 against its replicate 1: qualified, the replicate being one of those combined into the run', inside.report.items.find((i) => i.id === 'independence').text, status(inside, 'independence') === 'qualified' && /one of the replicates combined into/.test(inside.report.items.find((i) => i.id === 'independence').text), 'qualified');
    const enrich2 = exampleRun('grb2-sh3', { name: 'Run 2', parameters: PRESETS.enrich2.parameters });
    const twice = compareSides(side(g.ws, g, { condition: 0 }), side(g.ws, enrich2, { condition: 0 }));
    check('compare', 'GRB2 scored with the defaults and with the Enrich2-compatible preset: one table scored twice (qualified: the agreement measures the analyses), on one scale', `${twice.report.items.find((i) => i.id === 'independence').text} ${twice.report.items.find((i) => i.id === 'scale').text} r ${fmt(twice.statistics.pearson.r, 4)}, ρc ${fmt(twice.statistics.concordance?.ccc, 4)}`, status(twice, 'independence') === 'qualified' && /One table scored twice/.test(twice.report.items.find((i) => i.id === 'independence').text) && twice.sameScale, 'qualified; one scale');
    // GRB2's run moved onto another stretch of UniProt P62993: five residues later, renumbered.
    const target = g.run.inputs.design.targets[0];
    const moved = movedRun(g, { ...target, sequence: target.sequence.slice(5), offset: (target.offset ?? 0) + 5, identifiers: { ...target.identifiers, uniprot: 'P62993' } }, 5);
    const ws2 = { sources: [...g.ws.sources, { sha256: moved.run.inputs.source.sha256 }] };
    const onRef = compareSides(side(ws2, g, { condition: 0 }), side(ws2, moved, { condition: 0 }));
    const singles = (() => {
      const c = g.results.conditions[0];
      let k = 0;
      g.results.variants.key.forEach((key, i) => { if (/^p\.[A-Z][a-z]{2}(\d+)([A-Z][a-z]{2}|=)$/.test(key) && Number(/\d+/.exec(key)[0]) > 5 && !c.reason[i] && Number.isFinite(c.score[i])) k += 1; });
      return k;
    })();
    check('compare', 'GRB2 against itself moved five residues along UniProt P62993 (another target, renumbered): matched on the entry\'s coordinates, every single substitution after the fifth residue, r 1', `${onRef.coordinates}; ${onRef.report.items.find((i) => i.id === 'target').text} ${onRef.matched.n} matched (${singles} expected); r ${fmt(onRef.statistics?.pearson.r, 6)}`, onRef.coordinates === 'reference' && status(onRef, 'target') === 'qualified' && onRef.matched.n === singles && Math.abs(onRef.statistics.pearson.r - 1) < 1e-12, `${singles}; r 1`);
    const noRef = movedRun(g, { ...target, sequence: target.sequence.slice(5), offset: 0, identifiers: {} }, 5);
    const blocked = compareSides(side(ws2, g, { condition: 0 }), side({ sources: [...g.ws.sources, { sha256: noRef.run.inputs.source.sha256 }] }, noRef, { condition: 0 }));
    check('compare', 'the same without the UniProt accession: blocked (no common reference), no statistics, saying what to give', blocked.report.items.at(-1).text, blocked.report.status === 'blocked' && blocked.statistics === null && /UniProt accession and offset/.test(blocked.report.items.at(-1).text), 'blocked');
    // The direction stated the other way, the scores negated: compared negated.
    const flipped = movedRun(g, target, 0, { direction: 'higher-less', negate: true });
    const opposite = compareSides(side(ws2, g, { condition: 0 }), side({ sources: [...g.ws.sources, { sha256: flipped.run.inputs.source.sha256 }] }, flipped, { condition: 0 }));
    check('compare', 'a run whose readout says a higher score means less of the function, its scores negated: compared negated (r 1); Lin\'s concordance, Bland–Altman, discordance and disagreement by position withheld (not on one scale), saying why', `${opposite.report.items.find((i) => i.id === 'direction').text} r ${fmt(opposite.statistics?.pearson.r, 6)}; withheld ${opposite.withheld.join(', ')}`, opposite.flipped && Math.abs(opposite.statistics.pearson.r - 1) < 1e-12 && opposite.withheld.join() === 'concordance,blandAltman,discordance,positions', 'negated; r 1; withheld');
    // The files.
    const csv = comparisonCSV(two).trim().split('\n');
    const json = JSON.parse(comparisonJSON(two, { version: 'validation' }));
    const rowsOK = csv.slice(1).every((line, k) => {
      const f = line.split(',');
      return Math.abs(Number(f[10]) - (two.x[k] - two.y[k])) < 1e-12 && Math.abs(Number(f[4]) - two.x[k]) < 1e-12 && Math.abs(Number(f[8]) - two.x[k]) < 1e-12;
    });
    check('compare', 'comparison.csv: a row per variant compared, each side\'s score and SE as scored and as compared, the difference and mean, and the difference\'s z, p and q; comparison.json: the two runs\' output hashes, the report, the counts and the statistics', `${csv.length - 1} rows; ${json.a.output.slice(0, 12)}… and ${json.b.output.slice(0, 12)}…; ${json.report.items.length} items; r ${fmt(json.statistics.pearson.r, 4)}`, csv[0] === 'variant,variant_a,variant_b,class,score_a,SE_a,score_b,SE_b,compared_a,compared_b,difference,mean,z,p,q' && csv.length - 1 === two.matched.n && rowsOK && json.format === 'mavescape-comparison' && json.a.output === g.run.output.sha256 && json.statistics.pearson.r === two.statistics.pearson.r, 'all');

    // Discordance and disagreement by position (wave 4, slice 2): against R on the reference's pair,
    // then simulated pairs with planted differences.
    const dref = reference.discordance;
    const sideOf = (pair, which) => describeSide(pair.ws, pair[which].run, pair[which].results, { run: pair[which].run.id, condition: 0 });
    const synth = syntheticPair({ x: dref.x, y: dref.y, sx: dref.sx, sy: dref.sy, position: dref.position });
    const ds = compareSides(sideOf(synth, 'a'), sideOf(synth, 'b'));
    const dpairs = [];
    ds.rows.forEach(([i], k) => { for (const f of ['z', 'p', 'q']) dpairs.push([`variant ${i + 1} ${f}`, ds.discordance[f][k], dref[f][i]]); });
    const refPositions = new Map(dref.positions.position.map((pos, k) => [pos, k]));
    for (const x of ds.positions.list) for (const f of ['z', 'p', 'q', 'mean']) dpairs.push([`position ${x.position} ${f}`, x[f], dref.positions[f][refPositions.get(x.position)]]);
    const dw = worstDifference(dpairs);
    check('compare', `discordance (each difference's z from both SEs, its p and Benjamini–Hochberg's q) and disagreement by position (a position's z from the sum of its differences) of ${dref.x.length} variants at ${dref.positions.position.length} positions equal R's (pnorm, p.adjust)`, `${dpairs.length} numbers; largest relative difference ${dw.worst.toExponential(1)} (${dw.where}); ${ds.discordance.discordant} discordant (R: ${dref.q.filter((q) => q < 0.05).length}); positions ${ds.positions.list.filter((x) => x.q < 0.05).map((x) => x.position).join(', ')} (planted ${dref.plantedPositions.join(', ')})`, dw.worst <= 1e-10 && ds.positions.list.length === dref.positions.position.length, '≤ 1e-10');
    let power = 0;
    let plantedN = 0;
    let fdp = 0;
    let positionsFound = 0;
    let falsePositions = 0;
    let positionCalls = 0;
    const repsPlanted = 20;
    for (let r = 0; r < repsPlanted; r += 1) {
      const data = plantedPair({ seed: 100 + r });
      const pair = syntheticPair(data);
      const c = compareSides(sideOf(pair, 'a'), sideOf(pair, 'b'));
      const differing = new Set([...data.planted, ...Array.from(data.position, (pos, i) => (data.plantedPositions.includes(pos) ? i : -1)).filter((i) => i >= 0)]);
      const calls = c.rows.filter((_, k) => c.discordance.q[k] < 0.05).map(([i]) => i);
      power += data.planted.filter((i) => calls.includes(i)).length;
      plantedN += data.planted.length;
      fdp += calls.length ? calls.filter((i) => !differing.has(i)).length / calls.length : 0;
      const strong = c.positions.list.filter((x) => x.q < 0.05).map((x) => x.position);
      const truePositions = new Set([...data.plantedPositions, ...data.planted.map((i) => data.position[i])]);
      positionsFound += data.plantedPositions.filter((pos) => strong.includes(pos)).length;
      falsePositions += strong.filter((pos) => !truePositions.has(pos)).length;
      positionCalls += strong.length;
    }
    const nulls = Array.from({ length: 10 }, (_, r) => {
      const pair = syntheticPair(plantedPair({ seed: 500 + r, planted: 0, positions: [] }));
      return compareSides(sideOf(pair, 'a'), sideOf(pair, 'b')).discordance;
    });
    check('compare', `discordant variants in ${repsPlanted} simulated pairs of 600 variants, 30 planted to differ by ±1.5 and 3 positions by 0.5: the planted found, the false discoveries about the 5% Benjamini–Hochberg allows, the planted positions found; and in 10 pairs with nothing planted, the differences as variable as the SEs say (dispersion about 1) and none discordant`, `${(power / plantedN * 100).toFixed(1)}% of planted variants found; mean false discovery proportion ${(fdp / repsPlanted * 100).toFixed(1)}%; ${positionsFound} of ${3 * repsPlanted} planted positions found, ${falsePositions} of ${positionCalls} positions called with no difference planted; with nothing planted, dispersion ${nulls.map((d) => d.dispersion.toFixed(2)).join(', ')}, ${nulls.reduce((a, d) => a + d.discordant, 0)} discordant`, power / plantedN >= 0.9 && fdp / repsPlanted <= 0.07 && positionsFound >= 55 && falsePositions / positionCalls <= 0.1 && nulls.every((d) => d.dispersion > 0.8 && d.dispersion < 1.25) && nulls.reduce((a, d) => a + d.discordant, 0) <= 2, 'power ≥ 90%; FDP ≤ 7%; ≥ 55 of 60; ≤ 10%; 0.8–1.25; ≤ 2');
    // GRB2's replicates: their differences much wider than their counting SEs, as QC finds.
    const excess = g.o.findings.find((f) => f.id === 'excess-variance');
    check('compare', 'GRB2\'s replicates 1 and 2: their differences many times as variable as their SEs say (the dispersion), as QC\'s "variance beyond counting" finds (the Domainome\'s input bottleneck), so the view warns that more test as discordant than truly differ', `dispersion ${fmt(two.discordance.dispersion, 2)}; ${two.discordance.discordant} of ${two.discordance.tested} discordant; QC's variance beyond counting: ${excess?.status}`, two.discordance.dispersion > 4 && excess?.status === 'fail', 'dispersion > 4; QC fails');

    // Other sources and scales (wave 4, slice 3). Two assays on two scales, each rescaled by its own
    // anchors, against R.
    const rref = reference.rescaling;
    const assays = syntheticPair({ x: rref.x, y: rref.y, sx: rref.sx, sy: rref.sy, position: rref.position, kinds: rref.kind, parameters: { b: { model: 'published' } } });
    const asScored = compareSides(sideOf(assays, 'a'), sideOf(assays, 'b'));
    const rpairs = [];
    const rescaledModes = rref.modes.map((m) => {
      const c = compareSides(sideOf(assays, 'a'), sideOf(assays, 'b'), { scale: m.mode });
      for (const w of ['a', 'b']) {
        c.scale.anchors[w].forEach((x, k) => {
          rpairs.push([`${m.mode}: ${w}'s ${x.what} anchor`, x.from, m[w].anchors[k].from]);
          rpairs.push([`${m.mode}: ${w}'s ${x.what} anchor's SE`, x.se, m[w].anchors[k].se]);
        });
        rpairs.push([`${m.mode}: ${w}'s slope`, c.scale.slope[w], m[w].slope]);
      }
      c.x.forEach((v, k) => {
        rpairs.push([`${m.mode}: x ${k}`, v, m.x[k]]);
        rpairs.push([`${m.mode}: y ${k}`, c.y[k], m.y[k]]);
      });
      for (const k of ['ccc', 'low', 'high', 'scaleShift', 'locationShift', 'accuracy']) rpairs.push([`${m.mode}: concordance.${k}`, c.statistics.concordance[k], m.concordance[k]]);
      for (const k of Object.keys(m.blandAltman)) rpairs.push([`${m.mode}: blandAltman.${k}`, c.statistics.blandAltman[k], m.blandAltman[k]]);
      c.rows.forEach((_, k) => { for (const f of ['z', 'p', 'q']) rpairs.push([`${m.mode}: variant ${k} ${f}`, c.discordance[f][k], m[f][k]]); });
      const refPos = new Map(m.positions.position.map((pos, k) => [pos, k]));
      for (const x of c.positions.list) for (const f of ['z', 'p', 'q']) rpairs.push([`${m.mode}: position ${x.position} ${f}`, x[f], m.positions[f][refPos.get(x.position)]]);
      return c;
    });
    const rw = worstDifference(rpairs);
    check('compare', `two assays of one protein on two scales (${rref.x.length} variants: the wild type, synonymous, nonsense and missense): as scored, Lin's concordance and Bland–Altman withheld; each rescaled by its own anchors (nonsense median 0 and wild type 1; synonymous median 0 and nonsense median −1): the anchors and their SEs, the rescaled scores, Lin's concordance and Bland–Altman, and each difference's and position's z, p and q with the anchors' share of their uncertainty, equal R's`, `as scored: withheld ${asScored.withheld.slice(0, 2).join(', ')}; rescaled: ρc ${rescaledModes.map((c) => fmt(c.statistics.concordance.ccc, 4)).join(' and ')}, bias ${rescaledModes.map((c) => fmt(c.statistics.blandAltman.bias, 4)).join(' and ')}; ${rpairs.length} numbers; largest relative difference ${rw.worst.toExponential(1)} (${rw.where})`, asScored.withheld.includes('concordance') && rescaledModes.every((c) => c.scale.applied && c.sameScale && c.statistics.concordance && c.discordance.valid) && rw.worst <= 1e-10, '≤ 1e-10');

    // The anchors' uncertainty, carried into the tests: simulated pairs of two assays differing only
    // in scale, rescaled by their anchors, with nothing planted (any variant called is a false call),
    // as the wild type and nonsense median are more or less certain; then with differences planted.
    const sideOfPair = (pair) => [sideOf(pair, 'a'), sideOf(pair, 'b')];
    const settings = [[0.06, 20], [0.2, 20], [0.3, 6]];
    const nullRuns = settings.map(([wtSE, nonsense]) => {
      let withAnchors = 0;
      let without = 0;
      for (let r = 0; r < 200; r += 1) {
        const pair = syntheticPair({ ...twoAssays({ seed: 9000 + r, wtSE, nonsense }), parameters: { b: { model: 'published' } } });
        const c = compareSides(...sideOfPair(pair), { scale: 'nonsense-wt' });
        if (c.discordance.discordant) withAnchors += 1;
        const p = Float64Array.from(c.x, (x, k) => 2 * normalUpper(Math.abs((x - c.y[k]) / Math.sqrt(c.seX[k] * c.seX[k] + c.seY[k] * c.seY[k]))));
        if (adjustBH(p).some((q) => q < 0.05)) without += 1;
      }
      return { wtSE, nonsense, withAnchors: withAnchors / 200, without: without / 200 };
    });
    let found = 0;
    let plantedTotal = 0;
    let falseShare = 0;
    for (let r = 0; r < 20; r += 1) {
      const data = twoAssays({ seed: 9500 + r, planted: 20, shift: 0.5 });
      const c = compareSides(...sideOfPair(syntheticPair({ ...data, parameters: { b: { model: 'published' } } })), { scale: 'nonsense-wt' });
      const calls = c.rows.filter((_, k) => c.discordance.q[k] < 0.05).map(([i]) => i);
      found += data.planted.filter((i) => calls.includes(i)).length;
      plantedTotal += data.planted.length;
      falseShare += calls.length ? calls.filter((i) => !data.planted.includes(i)).length / calls.length : 0;
    }
    check('compare', 'two assays differing only in scale, rescaled by their anchors (200 simulated pairs in each of three settings, nothing planted): with the anchors\' uncertainty in each difference\'s SE, any variant called in about 5% of the pairs at most, as Benjamini–Hochberg allows; left out, far more often, the more so the less certain the anchors; with 20 differences of 0.5 planted (20 pairs), most found', `${nullRuns.map((x) => `wild type SE ${x.wtSE}, ${x.nonsense} nonsense: ${(100 * x.withAnchors).toFixed(1)}% with, ${(100 * x.without).toFixed(1)}% without`).join('; ')}; planted: ${(100 * found / plantedTotal).toFixed(1)}% found, mean false discovery proportion ${(100 * falseShare / 20).toFixed(1)}%`, nullRuns.every((x) => x.withAnchors <= 0.07 && x.without > x.withAnchors) && nullRuns.at(-1).without >= 0.3 && found / plantedTotal >= 0.8 && falseShare / 20 <= 0.07, 'with ≤ 7%; without more; ≥ 80% found; FDP ≤ 7%');

    // A predictor by its classes: GRB2's published scores (urn:mavedb:00000835-a-1, kept beside the
    // workspace) against AlphaMissense (P62993), as R computes them (pROC's DeLong interval).
    const cref = reference.classes;
    const grb2Set = scoreSetSide('urn:mavedb:00000835-a-1', new URL('./fixtures/public-data/mavedb/urn_mavedb_00000835-a-1.scores.csv', import.meta.url));
    const amText = readFileSync(new URL('./fixtures/public-data/alphafold/P62993.aa-substitutions.csv', import.meta.url), 'utf8');
    const amOnSet = predictorSide('alphamissense', amText, grb2Set.side, { name: 'AlphaMissense: P62993' });
    const byClass = compareSides(grb2Set.side, amOnSet.side);
    const kpairs = [['spearman.rho', byClass.statistics.spearman.rho, cref.spearman.rho], ['spearman.low', byClass.statistics.spearman.low, cref.spearman.low], ['spearman.high', byClass.statistics.spearman.high, cref.spearman.high]];
    const codes = { pathogenic: 'LPath', ambiguous: 'Amb', benign: 'LBen' };
    for (const x of byClass.classes.list) {
      const theirs = cref.classes.find((k) => k.code === codes[x.id]);
      for (const f of ['n', 'median', 'low', 'high']) kpairs.push([`${x.id} ${f}`, x[f], theirs[f]]);
    }
    for (const f of ['auc', 'low', 'high', 'se']) kpairs.push([`AUC ${f}`, byClass.classes.auc[f], cref.auc[f]]);
    const kw = worstDifference(kpairs);
    check('compare', 'a predictor by rank and by its classes: GRB2\'s published scores (a MaveDB score set kept beside the workspace, not opened) against AlphaMissense (P62993), placed on UniProt\'s numbering: the variants matched, Spearman\'s ρ with its interval, the scores\' median and quartiles in each class, and the AUC of telling its likely benign from its likely pathogenic substitutions with DeLong\'s interval and SE, equal R\'s (pROC); Pearson\'s r, Lin\'s concordance, Bland–Altman and the tests of disagreement withheld', `${byClass.matched.n} matched (R: ${cref.n}); ρ ${fmt(byClass.statistics.spearman.rho, 4)}; AUC ${fmt(byClass.classes.auc.auc, 4)} (${fmt(byClass.classes.auc.low, 4)} to ${fmt(byClass.classes.auc.high, 4)}); withheld ${byClass.withheld.join(', ')}; largest relative difference ${kw.worst.toExponential(1)} (${kw.where})`, byClass.matched.n === cref.n && kw.worst <= 1e-10 && byClass.withheld.join() === 'pearson,concordance,blandAltman,discordance,positions' && byClass.flipped, '≤ 1e-10; withheld');
    const ties = reference.aucTies;
    const tied = aucAgreement(Float64Array.from(ties.cases), Float64Array.from(ties.controls));
    const tw = worstDifference([['auc', tied.auc, ties.auc], ['low', tied.low, ties.low], ['high', tied.high, ties.high], ['se', tied.se, ties.se]]);
    // DeLong's interval in simulated classes of known AUC (two normal groups δ apart: Φ(δ/√2)).
    const random = createRandom(20261015);
    const aucCover = [[60, 200, 1], [30, 30, 0.5], [200, 600, 1.5]].map(([m, n, delta]) => {
      const truth = normalCdf(delta / Math.SQRT2);
      let held = 0;
      for (let r = 0; r < 2000; r += 1) {
        const tolerated = Float64Array.from({ length: m }, () => delta + random.gaussian());
        const damaging = Float64Array.from({ length: n }, () => random.gaussian());
        const a = aucAgreement(tolerated, damaging);
        if (a.low <= truth && truth <= a.high) held += 1;
      }
      return { m, n, truth, share: held / 2000 };
    });
    check('compare', `the AUC and DeLong's interval with tied scores equal R's (pROC: ${ties.name}); and in simulated classes of known AUC (2,000 pairs each), the interval holds the truth about 95% of the time`, `largest relative difference ${tw.worst.toExponential(1)}; ${aucCover.map((x) => `${x.m} against ${x.n}, AUC ${fmt(x.truth, 3)}: ${fmt(x.share, 3)}`).join('; ')}`, tw.worst <= 1e-10 && aucCover.every((x) => x.share >= 0.93 && x.share <= 0.97), '≤ 1e-10; 0.93–0.97');

    // The GRB2 example's guide (wave 4, slice 3): Run 1 against the published scores kept beside the
    // workspace (urn:mavedb:00000835-a-1, not opened), as scored and rescaled by their anchors; and
    // against AlphaMissense.
    const gRun = side(g.ws, g, { condition: 0 });
    const kept = compareSides(gRun, grb2Set.side);
    const keptRescaled = compareSides(gRun, grb2Set.side, { scale: 'nonsense-wt' });
    check('compare', 'the GRB2 example\'s Run 1 against its record\'s published scores, kept beside the workspace without opening it: one experiment analysed twice (the record\'s URN on both), on two scales (correlations only); each rescaled by its anchors (nonsense median 0, wild type 1), one scale: Lin\'s concordance near 1 and a bias near 0, the tests of disagreement withheld (not independent)', `${kept.matched.n} matched; r ${fmt(kept.statistics.pearson.r, 4)}, withheld ${kept.withheld.slice(0, 2).join(', ')}; rescaled: ${keptRescaled.report.items.find((i) => i.id === 'scale').text.slice(0, 160)}… ρc ${fmt(keptRescaled.statistics.concordance?.ccc, 4)}, bias ${fmt(keptRescaled.statistics.blandAltman?.bias, 4)} (${fmt(keptRescaled.statistics.blandAltman?.lower, 3)} to ${fmt(keptRescaled.statistics.blandAltman?.upper, 3)}); ${keptRescaled.discordance.reason.slice(0, 60)}…`, status(kept, 'independence') === 'qualified' && !kept.statistics.concordance && kept.statistics.pearson.r > 0.99 && keptRescaled.statistics.concordance.ccc > 0.99 && Math.abs(keptRescaled.statistics.blandAltman.bias) < 0.02 && !keptRescaled.discordance.valid, 'qualified; ρc > 0.99; |bias| < 0.02');
    const amOnRun = predictorSide('alphamissense', amText, gRun, { name: 'AlphaMissense: P62993' });
    const amRun = compareSides(gRun, amOnRun.side);
    const classesFile = classesCSV(amRun).trim().split('\n');
    check('compare', 'the GRB2 example\'s Run 1 against AlphaMissense: its substitutions placed on the domain by UniProt\'s numbering (those beyond it left out, said), compared negated (a higher pathogenicity is less of the function); by rank ρ about 0.55, and its classes told apart (AUC about 0.78); comparison_classes.csv a row per class', `${amRun.report.items.find((i) => i.id === 'target').text} ρ ${fmt(amRun.statistics.spearman.rho, 3)}; AUC ${fmt(amRun.classes.auc.auc, 3)} (${fmt(amRun.classes.auc.low, 3)} to ${fmt(amRun.classes.auc.high, 3)}); ${classesFile.length - 1} classes`, amRun.flipped && amRun.statistics.spearman.rho > 0.5 && amRun.statistics.spearman.rho < 0.6 && amRun.classes.auc.auc > 0.75 && classesFile[0] === 'class,variants,median,lower_quartile,upper_quartile' && classesFile.length === 4 && /beyond the target's ends left out/.test(amRun.report.items.find((i) => i.id === 'target').text), 'negated; 0.5–0.6; > 0.75; 3 classes');

    // A score set and a predictor kept with the workspace: written to its archive and read back, the
    // same comparisons.
    {
      let wsKept = g.ws;
      const files = new Map();
      for (const [annotation, text] of [[grb2Set.annotation, grb2Set.text], [amOnRun.annotation, amText]]) {
        const data = new TextEncoder().encode(text);
        files.set(annotation.file.sha256, data);
        wsKept = addAnnotation(wsKept, { provider: annotation.provider, name: annotation.name, file: annotation.file, record: annotation.record }).ws;
      }
      const archive = await writeArchive(wsKept, { annotations: files });
      const back = await readArchive(archive.bytes);
      const textOf = (a) => new TextDecoder().decode(back.sources.get(a.file.sha256));
      const setBack = back.ws.annotations.find((a) => a.provider === 'mavedb-scores');
      const amBack = back.ws.annotations.find((a) => a.provider === 'alphamissense');
      const setSide = describeScoreSet(setBack, scoreSetResults(textOf(setBack), setBack.record.scoreSet));
      const again = compareSides(gRun, setSide, { scale: 'nonsense-wt' });
      const amAgain = compareSides(gRun, predictorSide('alphamissense', textOf(amBack), gRun, { name: amBack.name }).side);
      const same = (x, y) => JSON.stringify(JSON.parse(comparisonJSON(x)).statistics) === JSON.stringify(JSON.parse(comparisonJSON(y)).statistics) && JSON.stringify(x.classes) === JSON.stringify(y.classes);
      check('compare', 'a MaveDB score set and AlphaMissense kept beside the GRB2 example, written to its archive and read back: the same comparisons (the score set read as published again, AlphaMissense placed again)', `${back.ws.annotations.length} kept; ${back.problems.length ? `problems: ${back.problems.join(' ')}` : 'no problem'}; ${same(keptRescaled, again) && same(amRun, amAgain) ? 'the same' : 'different'}`, !back.problems.length && same(keptRescaled, again) && same(amRun, amAgain), 'the same');
    }

    // The published examples, compared as their guides say (MaveDB's tables, external data).
    try {
      const pub = publishedRun('brca1-sge', 'urn:mavedb:00000097-0-2');
      const cnt = countsRun('brca1-sge', 'urn:mavedb:00000097-0-2');
      const w = together(cnt, pub);
      const sge = compareSides(side(w, cnt, { condition: 0 }), side(w, pub, { condition: 0 }));
      check('compare', 'BRCA1\'s saturation genome editing, its counts scored against its published scores (the example\'s guide): every variant matched at the nucleotide level, r ≈ 0.76, Lin\'s concordance and Bland–Altman withheld (the record\'s own scale), one experiment analysed twice, the direction the example states on both', `${sge.level}; ${sge.matched.n} matched; r ${fmt(sge.statistics.pearson.r, 3)}; withheld ${sge.withheld.join(', ')}; ${sge.report.items.filter((i) => i.status !== 'ok').map((i) => i.label).join(', ')} qualified`, sge.level === 'nucleotide' && sge.matched.n === 3893 && sge.statistics.pearson.r > 0.74 && sge.statistics.pearson.r < 0.78 && !sge.statistics.concordance && status(sge, 'scale') === 'qualified' && status(sge, 'independence') === 'qualified' && status(sge, 'direction') === 'ok', '3,893; 0.74–0.78');
      const d = exampleRun('dhfr-lon');
      const minus = publishedRun('dhfr-lon', 'urn:mavedb:00000063-b-1', { name: 'Published scores (deficient Lon)' });
      const plus = publishedRun('dhfr-lon', 'urn:mavedb:00000063-a-1', { name: 'Published scores (functioning Lon)' });
      const wd = together(d, minus, plus);
      const lessLon = compareSides(side(wd, d, { condition: 0 }), side(wd, minus, { condition: 0 }));
      const moreLon = compareSides(side(wd, d, { condition: 1 }), side(wd, plus, { condition: 0 }));
      check('compare', 'DHFR\'s Run 1 (the paper\'s design, the defaults) against each record\'s published scores: r 0.90 without Lon and 0.96 with it, as the examples suite finds them (wave 3, slice 6), each record\'s own experiment', `−Lon: ${lessLon.matched.n} matched, r ${fmt(lessLon.statistics.pearson.r, 3)}; +Lon: ${moreLon.matched.n}, r ${fmt(moreLon.statistics.pearson.r, 3)}`, Math.abs(lessLon.statistics.pearson.r - 0.898) < 0.002 && Math.abs(moreLon.statistics.pearson.r - 0.959) < 0.002 && status(lessLon, 'independence') === 'qualified', '0.898 and 0.959');
      const published = compareSides(side(wd, minus, { condition: 0 }), side(wd, plus, { condition: 0 }));
      const dhfrRef = reference.cases.find((c) => c.keys);
      const sameKeys = published.keys.length === dhfrRef.keys.length && [...published.keys].sort().join() === [...dhfrRef.keys].sort().join();
      check('compare', 'DHFR\'s two published score sets matched as R\'s merge matches them (the reference\'s DHFR pair): the same variants, the same r', `${published.matched.n} matched (${dhfrRef.n} in R); r ${fmt(published.statistics.pearson.r, 6)} (${fmt(dhfrRef.pearson.r, 6)})`, sameKeys && Math.abs(published.statistics.pearson.r - dhfrRef.pearson.r) < 1e-10, 'the same');
      const conditions = compareSides(side(wd, d, { condition: 0 }), side(wd, d, { condition: 1 }));
      const inPublished = new Set(published.keys);
      const on = conditions.keys.map((k, i) => (inPublished.has(k) ? i : -1)).filter((i) => i >= 0);
      const rOn = pearson(on.map((i) => conditions.x[i]), on.map((i) => conditions.y[i]));
      check('compare', 'DHFR\'s Run 1, −Lon against +Lon: no sample in common, one scale, every statistic; weaker than the published pair (r 0.81) because Run 1 also scores 626 variants of few reads, which agree little; on the published pair\'s variants alone, near it', `${conditions.report.status}; ${conditions.matched.n} matched, r ${fmt(conditions.statistics.pearson.r, 3)}, ρc ${fmt(conditions.statistics.concordance?.ccc, 3)}; on the ${on.length} the published scores share, r ${fmt(rOn, 3)}`, conditions.report.status === 'ok' && conditions.statistics.concordance && conditions.matched.n - on.length === 626 && rOn > conditions.statistics.pearson.r + 0.15, 'ok; 626 more');
      // DHFR's two conditions (wave 4, slice 2): the comparison's z the run's own differential z
      // (Enrich2's, independent), the filters, and the difference map.
      const differential = d.results.differential[0];
      let zWorst = 0;
      conditions.rows.forEach(([i], k) => { zWorst = Math.max(zWorst, Math.abs(conditions.discordance.z[k] + differential.z[i])); });
      const qOwn = adjustBH(Float64Array.from(conditions.rows, ([i]) => differential.p[i]));
      let qWorst = 0;
      conditions.rows.forEach((_, k) => { qWorst = Math.max(qWorst, Math.abs(qOwn[k] - conditions.discordance.q[k])); });
      check('compare', 'DHFR\'s Run 1, −Lon against +Lon: each difference\'s z is the run\'s own differential z (the conditions as independent, Enrich2\'s), its sign the other way (first − second), and q its Benjamini–Hochberg over the variants compared', `${conditions.discordance.tested} variants; largest |z + z_run| ${zWorst.toExponential(1)}, |q − q_run| ${qWorst.toExponential(1)}; ${conditions.discordance.discordant} discordant`, zWorst <= 1e-12 && qWorst <= 1e-12 && conditions.discordance.discordant > 300, '≤ 1e-12');
      const lessSure = conditions.rows.filter(([i, j]) => conditions.values.a.flags[i] || conditions.values.b.flags[j]).length;
      const confident = compareSides(side(wd, d, { condition: 0 }), side(wd, d, { condition: 1 }), { filters: { lowConfidence: true } });
      const deep = compareSides(side(wd, d, { condition: 0 }), side(wd, minus, { condition: 0 }), { filters: { minReads: 20 } });
      check('compare', 'the filters: DHFR\'s −Lon against +Lon with low confidence left out on either side (as this suite counts it), r rising from 0.52 to above 0.75; a minimum of reads against published scores, which have no counts, applied to the run only, saying so', `${confident.matched.compared} compared (${conditions.matched.compared} − ${lessSure}), r ${fmt(confident.statistics.pearson.r, 3)}, ${confident.discordance.discordant} discordant; ${deep.report.items.find((i) => i.id === 'filters').text}`, confident.matched.compared === conditions.matched.compared - lessSure && confident.statistics.pearson.r > 0.75 && /has no counts: the filter applies to the other side only/.test(deep.report.items.find((i) => i.id === 'filters').text), 'as counted; > 0.75; said');
      const dm = differenceMap(confident, side(wd, d, { condition: 0 }));
      const model = buildMapModel(dm.results, dm.design, { colorBy: 'differential', contrast: 0 });
      const compared = new Map(confident.rows.map(([i], k) => [i, confident.x[k] - confident.y[k]]));
      let cellsOK = 0;
      let cellsBad = 0;
      let filteredOut = 0;
      for (let k = 0; k < model.cells.length; k += 1) {
        const i = model.cells[k];
        if (i < 0) continue;
        if (compared.has(i)) {
          if ((model.state[k] === STATE.SCORED || model.state[k] === STATE.LOW || model.state[k] === STATE.REFERENCE) && Math.abs(model.value[k] - compared.get(i)) < 1e-12) cellsOK += 1;
          else cellsBad += 1;
        } else if (model.state[k] === STATE.FILTERED) filteredOut += 1;
      }
      check('compare', 'DHFR\'s difference map (low confidence left out): every variant compared drawn with its difference, those scored on one side only or left out by the filter drawn filtered, colored by the difference centered on 0', `${cellsOK} cells with their difference, ${cellsBad} not; ${filteredOut} filtered; colored by ${model.colorBy}, ${model.contrast.name}, domain ${fmt(model.domain.min, 2)} to ${fmt(model.domain.max, 2)}`, cellsBad === 0 && cellsOK > 1500 && filteredOut > 1000 && model.domain.center === 0, 'every one');
      const ring = exampleRun('brca1-ring');
      const rr = ring.results.replicates;
      const sharing = compareSides(side(ring.ws, ring, { replicate: rr[0].id }), side(ring.ws, ring, { replicate: rr[1].id }));
      check('compare', 'BRCA1 RING\'s first two phage replicates, which share their input library: qualified, naming the sample', sharing.report.items.find((i) => i.id === 'independence').text, status(sharing, 'independence') === 'qualified' && /share the sample/.test(sharing.report.items.find((i) => i.id === 'independence').text), 'qualified');

      // Wave 4, slice 3. DHFR's −Lon record kept beside the workspace, not opened: the same comparison
      // with Run 1 as the record opened gives.
      // The direction stated as the example states it for the record it opens.
      const minusSet = scoreSetSide('urn:mavedb:00000063-b-1', cachePath('mavedb-dhfr/minus-lon/scores.csv'), { direction: EXAMPLES.find((e) => e.id === 'dhfr-lon').readout.direction });
      const viaSet = compareSides(side(wd, d, { condition: 0 }), minusSet.side);
      const pick = (c) => JSON.stringify({ n: c.matched, s: c.statistics, items: c.report.items.map((i) => [i.id, i.status]) });
      check('compare', 'DHFR\'s −Lon record kept beside the workspace (a MaveDB score set, not opened; the direction stated as the example states it) against Run 1: the same variants, statistics and report as the record opened (its run "Published scores")', `${viaSet.matched.n} matched, r ${fmt(viaSet.statistics.pearson.r, 6)} (opened: ${fmt(lessLon.statistics.pearson.r, 6)}); ${viaSet.report.items.map((i) => `${i.id} ${i.status}`).join(', ')}`, pick(viaSet) === pick(lessLon), 'the same');
      // DHFR's published pair, one study and one pipeline: stated to be on one scale.
      const stated = compareSides(side(wd, minus, { condition: 0 }), side(wd, plus, { condition: 0 }), { scale: 'stated' });
      check('compare', 'DHFR\'s two published score sets (one study, one pipeline) stated to be on one scale: Lin\'s concordance and Bland–Altman given, the scale qualified as stated, and their differences tested with the SEs the records give (their column "standard error", read since this slice): two records, two tables, independent', `${stated.report.items.find((i) => i.id === 'scale').text.slice(0, 120)}… ρc ${fmt(stated.statistics.concordance?.ccc, 3)}, bias ${fmt(stated.statistics.blandAltman?.bias, 3)} (${fmt(stated.statistics.blandAltman?.lower, 3)} to ${fmt(stated.statistics.blandAltman?.upper, 3)}); ${stated.discordance.discordant} of ${stated.discordance.tested} discordant, dispersion ${fmt(stated.discordance.dispersion, 2)}`, stated.sameScale && status(stated, 'scale') === 'qualified' && stated.statistics.concordance && stated.discordance.valid && stated.discordance.tested > 2000, 'one scale, stated; tested');

      // PTEN: its abundance (the example's record) against its lipid phosphatase activity
      // (urn:mavedb:00000054-a-1, kept beside the workspace): another assay of the same protein.
      const abundance = publishedRun('pten-mavedb', 'urn:mavedb:00000013-a-1');
      const activity = scoreSetSide('urn:mavedb:00000054-a-1', cachePath('mavedb-pten-phosphatase/scores.csv'), { direction: 'higher-more' });
      const abundanceSide = side(abundance.ws, abundance, { condition: 0 });
      const assay2 = compareSides(abundanceSide, activity.side);
      const assay2Rescaled = compareSides(abundanceSide, activity.side, { scale: 'nonsense-wt' });
      const wtAnchor = assay2Rescaled.scale.anchors.b.find((x) => x.what === 'wild type');
      check('compare', 'PTEN\'s abundance (VAMP-seq) against its lipid phosphatase activity, another MaveDB score set kept beside the workspace: one target sequence, the activity\'s codon variants read at the protein level, two assays (qualified), correlations only as scored; rescaled by their anchors, the report naming each: the activity record\'s wild type is its row, 1 with an SE of 0, though its methods put the wild type-like variants from −1.11 to 0.89', `${assay2.matched.n} matched; r ${fmt(assay2.statistics.pearson.r, 3)}, ρ ${fmt(assay2.statistics.spearman.rho, 3)}; assays ${status(assay2, 'assay')}; rescaled: ρc ${fmt(assay2Rescaled.statistics.concordance?.ccc, 3)}, the activity's wild type ${wtAnchor?.from} (SE ${wtAnchor?.se}), ${assay2Rescaled.discordance.discordant} of ${assay2Rescaled.discordance.tested} discordant, dispersion ${fmt(assay2Rescaled.discordance.dispersion, 1)}`, assay2.matched.n > 4000 && assay2.statistics.spearman.rho > 0.3 && assay2.statistics.spearman.rho < 0.45 && status(assay2, 'assay') === 'qualified' && wtAnchor?.from === 1 && wtAnchor?.se === 0, 'ρ 0.30–0.45; qualified; the row, 1');
      const amPten = predictorSide('alphamissense', readFileSync(new URL('./fixtures/public-data/alphafold/P60484.aa-substitutions.csv', import.meta.url), 'utf8'), abundanceSide, { name: 'AlphaMissense: P60484' });
      const ptenAM = compareSides(abundanceSide, amPten.side);
      const activityAM = compareSides(activity.side, predictorSide('alphamissense', readFileSync(new URL('./fixtures/public-data/alphafold/P60484.aa-substitutions.csv', import.meta.url), 'utf8'), activity.side, { name: 'AlphaMissense: P60484' }).side);
      check('compare', 'PTEN against AlphaMissense (P60484), by rank and by its classes: its abundance and its phosphatase activity each tell AlphaMissense\'s likely benign substitutions from its likely pathogenic ones', `abundance: ${ptenAM.matched.n} matched, ρ ${fmt(ptenAM.statistics.spearman.rho, 3)}, AUC ${fmt(ptenAM.classes.auc.auc, 3)} (${fmt(ptenAM.classes.auc.low, 3)} to ${fmt(ptenAM.classes.auc.high, 3)}); activity: ${activityAM.matched.n} matched, ρ ${fmt(activityAM.statistics.spearman.rho, 3)}, AUC ${fmt(activityAM.classes.auc.auc, 3)} (${fmt(activityAM.classes.auc.low, 3)} to ${fmt(activityAM.classes.auc.high, 3)})`, ptenAM.classes.auc.low > 0.7 && activityAM.classes.auc.low > 0.65, 'both above chance');
    } catch (error) {
      if (!(error instanceof MissingExampleData)) throw error;
      throw new MissingData(error.message);
    }
  },

  // Wave 4, slice 4 (C4): robustness to analysis choices. The specifications; the declared analysis
  // the run itself; the calls against an independent computation; simulated experiments with planted
  // fragile results (one replicate driving an effect, an effect whose size appears at one
  // pseudocount); then the examples (GRB2 bundled; DHFR, external data).
  async robustness() {
    const g = exampleRun('grb2-sh3');
    const design = g.run.inputs.design;
    const parameters = g.run.inputs.parameters;
    const grb2 = checkTable(g.o.table, design, parameters);
    const { choices, specs } = grb2;
    // The specifications.
    const singles = specs.filter((s) => s.kind === 'single');
    const combined = specs.filter((s) => s.kind === 'combined');
    const alternatives = choices.reduce((a, c) => a + c.options.length - 1, 0);
    const unique = new Set(specs.map((s) => s.picks.join(','))).size === specs.length;
    const again = specifications(choices, { max: 48, seed: ROBUSTNESS_SEED });
    const leftOut = specificationInputs(design, parameters, choices, choices.map((c) => (c.id === 'leaveOut' ? 1 : 0)));
    check('robustness', 'the specifications of a run (GRB2\'s): the declared analysis first, each alternative alone once, then combinations of two or more changes, none twice, the same for the same seed; a replicate left out leaves the design without it', `${choices.length} choices (${choices.map((c) => c.label).join(', ')}); ${specs.length} specifications: 1 declared, ${singles.length} alone (${alternatives} alternatives), ${combined.length} combined (${Math.min(...combined.map((s) => s.changed))}–${Math.max(...combined.map((s) => s.changed))} changes each); ${unique ? 'none twice' : 'repeated'}; the seed's ${JSON.stringify(again) === JSON.stringify(specs) ? 'the same' : 'different'}; left out: ${leftOut.design.replicates.length} of ${design.replicates.length} replicates`, specs[0].kind === 'declared' && singles.length === alternatives && combined.every((s) => s.changed >= 2) && unique && JSON.stringify(again) === JSON.stringify(specs) && leftOut.design.replicates.length === design.replicates.length - 1 && specs.length === 48, 'all');
    // The declared analysis is the run.
    const declared = grb2.out[0];
    const own = callsOf(g.results, design)[0];
    const same = ['effect', 'se', 'q', 'cls'].every((k) => own[k].length === declared.targets[0][k].length && own[k].every((x, i) => Object.is(x, declared.targets[0][k][i])));
    check('robustness', 'the declared analysis is the run itself: scored again in the check, its calls (effect, SE, q, class) equal the run\'s to the last bit', `${g.results.rows} variants; ${same ? 'the same' : 'different'}`, same, 'the same');
    // The calls, computed apart: z = (score − the wild type's) / SE, p from t on the moderated
    // degrees of freedom, q by Benjamini–Hochberg; lower or higher where q < 0.05.
    const c0 = g.results.conditions[0];
    const wt = g.results.controls.wt;
    const pApart = Float64Array.from(c0.score, (x, i) => (i === wt || c0.reason[i] || !Number.isFinite(x) || !(c0.se[i] > 0) ? Number.NaN : tTwoSided((x - c0.score[wt]) / c0.se[i], c0.df[i])));
    const qApart = adjustBH(pApart);
    let callsDiffer = 0;
    let called = 0;
    for (let i = 0; i < g.results.rows; i += 1) {
      const expected = c0.reason[i] || !Number.isFinite(c0.score[i]) ? CLASS.UNSCORED : qApart[i] < 0.05 ? (c0.score[i] < c0.score[wt] ? CLASS.LOWER : CLASS.HIGHER) : CLASS.NEUTRAL;
      if (expected !== own.cls[i]) callsDiffer += 1;
      if (expected === CLASS.LOWER || expected === CLASS.HIGHER) called += 1;
    }
    const complete = callsOf(scoreTable(g.o.table, design, { ...parameters, normalization: 'complete' }).results, design)[0];
    check('robustness', 'the classes against an independent computation: each variant\'s z against the wild type (its score less the wild type\'s, over its SE), p from t on its moderated degrees of freedom, q by Benjamini–Hochberg, lower or higher where q < 0.05; normalized otherwise than to the wild type, the effect is still against the wild type\'s score, with its SE added', `${called} called, ${callsDiffer} differ; complete cases: effects against the wild type (${complete.reference})`, callsDiffer === 0 && called > 500 && complete.reference === 'the wild type', '0 differ');

    // Planted fragile results: ten simulated experiments, declared by fixed effects.
    const planted = [];
    for (const seed of [41, 42, 43, 44, 45, 46, 47, 48, 49, 50]) {
      const c = checkPlanted(seed, 'fixed');
      const t = c.summary.targets[0];
      const key = c.results.variants.key;
      const named = (verdict) => key.filter((_, i) => t.verdict[i] === verdict);
      const fragile = named(VERDICT.FRAGILE);
      const pcSize = named(VERDICT.SIZE).filter((k) => (t.dependsOn[key.indexOf(k)] ?? []).some((d) => /^pseudocount/.test(d)));
      const otherSize = named(VERDICT.SIZE).filter((k) => !c.planted.zero.includes(k));
      const replicateLeft = `${c.replicateName} left out`;
      planted.push({
        seed,
        replicate: c.planted.replicate.length,
        zero: c.planted.zero.length,
        fragileExact: fragile.length === c.planted.replicate.length && fragile.every((k) => c.planted.replicate.includes(k)),
        byReplicate: c.planted.replicate.filter((k) => (t.dependsOn[key.indexOf(k)] ?? []).includes(replicateLeft)).length,
        byReplicateOrCombination: c.planted.replicate.every((k) => (t.dependsOn[key.indexOf(k)] ?? []).some((d) => d === replicateLeft || ['REML random effects', 'the mean (SD/√k)', 'moderated (MaveScape\'s)'].includes(d))),
        zeroExact: pcSize.length === c.planted.zero.length && pcSize.every((k) => c.planted.zero.includes(k)) && c.planted.zero.every((k) => (t.dependsOn[key.indexOf(k)] ?? []).join() === 'pseudocount 0.1'),
        otherSize: otherSize.length,
        otherSizeNotPseudocount: otherSize.every((k) => (t.dependsOn[key.indexOf(k)] ?? []).every((d) => !/^pseudocount/.test(d))),
        robustLosses: (() => {
          const lost = [];
          c.design && c.results.variants.key.forEach((k, i) => { if (/^p\.[A-Z][a-z]{2}\d+[A-Z][a-z]{2}$/.test(k) && !k.endsWith('Ter') && t.cls[i] === CLASS.LOWER && t.effect[i] < -2) lost.push(i); });
          return [lost.filter((i) => t.verdict[i] === VERDICT.ROBUST || t.verdict[i] === VERDICT.SIZE).length, lost.length];
        })(),
        ms: c.ms,
      });
    }
    const all = (f) => planted.every(f);
    const sum = (f) => planted.reduce((a, x) => a + f(x), 0);
    check('robustness', `simulated experiments with planted fragile results (${planted.length} seeds, 4 replicates, declared by fixed effects): the variants reported fragile are exactly the ones one replicate drives (replicate 1's output cut to a quarter), each depending on that replicate left out or on a combination that weighs it as the others; the variants whose effect's size depends on the pseudocount are exactly the ones with no reads after selection, each on pseudocount 0.1 alone`, `${sum((x) => x.replicate)} replicate-driven planted: fragile exactly ${sum((x) => (x.fragileExact ? 1 : 0))} of ${planted.length} times, ${sum((x) => x.byReplicate)} naming the replicate left out; ${sum((x) => x.zero)} zero-count planted: exactly ${sum((x) => (x.zeroExact ? 1 : 0))} of ${planted.length} times`, all((x) => x.fragileExact && x.byReplicateOrCombination && x.zeroExact) && sum((x) => x.byReplicate) >= 0.9 * sum((x) => x.replicate), `exactly, every time; ≥ 90% naming the replicate`);
    check('robustness', 'and a robust result reported as robust: the clearly lost variants (lower than the wild type, effect below −2) keep their class in every analysis; besides the planted, a few strongly lost variants\' effects move beyond their interval (a replicate left out, or their unequal replicates averaged unweighted), none by the pseudocount', `${sum((x) => x.robustLosses[0])} of ${sum((x) => x.robustLosses[1])} clearly lost robust (or only their size depends); ${sum((x) => x.otherSize)} unplanted size flags over ${planted.length} experiments, ${all((x) => x.otherSizeNotPseudocount) ? 'none' : 'some'} by the pseudocount; ${Math.round(sum((x) => x.ms) / planted.length)} ms each`, sum((x) => x.robustLosses[0]) === sum((x) => x.robustLosses[1]) && sum((x) => x.otherSize) <= 3 && all((x) => x.otherSizeNotPseudocount), 'all; ≤ 3, none by the pseudocount');
    // The same, under MaveScape's defaults (moderated): the replicate-driven effect is not called at
    // all, so no conclusion rests on it.
    const defaults = [41, 42, 43].map((seed) => {
      const c = checkPlanted(seed, 'moderated');
      const t = c.summary.targets[0];
      const at = (k) => c.results.variants.key.indexOf(k);
      return { notCalled: c.planted.replicate.filter((k) => t.cls[at(k)] === CLASS.NEUTRAL).length, n: c.planted.replicate.length, fragile: t.counts.fragile, zero: c.planted.zero.every((k) => (t.dependsOn[at(k)] ?? []).join() === 'pseudocount 0.1') };
    });
    check('robustness', 'under MaveScape\'s defaults (the moderated combination) the replicate-driven effect is not called (its SE carries the replicates\' disagreement), so nothing is fragile; the zero counts\' effects still depend on pseudocount 0.1', defaults.map((x) => `${x.notCalled} of ${x.n} not called, ${x.fragile} fragile`).join('; '), defaults.every((x) => x.notCalled === x.n && x.fragile === 0 && x.zero), 'none called; 0 fragile');

    // GRB2: fixed effects left out (its replicates differ far more than counting says), and what its
    // check finds.
    const t = grb2.summary.targets[0];
    const spread = replicateDispersion(g.results);
    const excess = g.o.findings.find((f) => f.id === 'excess-variance');
    const rhoMin = Math.min(...t.byChoice.map((x) => x.rho));
    const declaredLeast = t.positions.filter((x) => t.leastTolerant.positions.includes(x.position)).map((x) => `${x.residue}${x.reference}`);
    check('robustness', 'the GRB2 example: fixed effects not tried, its replicates differing many times what their SEs say (QC\'s variance beyond counting fails), and its check: the classes held, the calls held in every analysis, each alternative\'s rank correlation, the least tolerant positions', `dispersion ${fmt(spread, 1)} (QC: ${excess?.status}); ${grb2.notes.join(' ').slice(0, 60)}…; ${t.counts.robust} of ${t.n} robust, ${t.counts.fragile} fragile, ${t.counts.uncertain} by their uncertainty, ${t.counts.borderline} borderline; ${t.calls.every} of ${t.calls.declared} calls in every analysis, ${t.calls.most} in 90%; ρ at least ${fmt(rhoMin, 3)}; least tolerant ${declaredLeast.join(', ')} (${t.leastTolerant.every} in every analysis, ${t.leastTolerant.wide} in the fifth); ${Math.round(grb2.ms)} ms`, spread > 5 && excess?.status === 'fail' && !grb2.choices.find((c) => c.id === 'combination').options.some((o) => o.id === 'fixed') && rhoMin > 0.95 && t.leastTolerant.wide === t.leastTolerant.size, 'fixed effects not tried; ρ > 0.95; every least tolerant in the fifth');
    // The files: the same bytes from the same check.
    const json = robustnessJSON(grb2.summary, g.run, grb2.out.map(({ kind, picks, label, ok, error }) => ({ kind, picks, label, ok, error })));
    const twice = checkTable(g.o.table, design, parameters);
    const csv = robustnessCSV(grb2.summary, g.results).trim().split('\n');
    const positionsFile = robustnessPositionsCSV(grb2.summary).trim().split('\n');
    const record = JSON.parse(json);
    check('robustness', 'the files: robustness.csv a row per variant scored (its class, effect, SE, q, analyses scoring and keeping it, verdict and what it depends on, effect and rank ranges), robustness_positions.csv a row per position, robustness.json the run\'s output hash, every specification and each target\'s counts; a second check, the same bytes', `${csv.length - 1} variants, ${positionsFile.length - 1} positions; ${record.specifications.length} specifications, ${record.run.output.slice(0, 12)}…; ${json === robustnessJSON(twice.summary, g.run, twice.out.map(({ kind, picks, label, ok, error }) => ({ kind, picks, label, ok, error }))) ? 'the same bytes' : 'different'}`, csv[0] === 'target,variant,class,effect,SE,q,analyses,scored_in,class_kept_in,verdict,depends_on,effect_min,effect_max,rank,rank_min,rank_max' && csv.length - 1 >= t.n && positionsFile.length - 1 === 56 && record.format === 'mavescape-robustness' && record.run.output === g.run.output.sha256 && record.specifications.length === 48 && json === robustnessJSON(twice.summary, g.run, twice.out.map(({ kind, picks, label, ok, error }) => ({ kind, picks, label, ok, error }))), 'the same');

    // DHFR (external data): how many of Run 1's differences between the conditions hold.
    try {
      const d = exampleRun('dhfr-lon');
      const dhfr = checkTable(d.o.table, d.run.inputs.design, d.run.inputs.parameters);
      const contrast = dhfr.summary.targets.find((x) => x.kind === 'contrast');
      const top = (kind) => contrast.attribution[kind].slice(0, 2).map(([label, n]) => `${label} ${n}`).join(', ');
      check('robustness', 'the DHFR example\'s Run 1, its 377 differences between −Lon and +Lon (wave 3, slice 6): how many are called in every analysis and in 90% of them, and what the others depend on (the model of the time course and the combination of replicates most)', `${contrast.calls.every} of ${contrast.calls.declared} in every analysis, ${contrast.calls.most} in 90% or more; fragile ${contrast.counts.fragile} (${top('fragile')}), by their uncertainty ${contrast.counts.uncertain} (${top('uncertain')}); ${dhfr.notes.join(' ').slice(0, 70)}…; ${Math.round(dhfr.ms)} ms`, contrast.calls.declared === 377 && contrast.calls.every < 100 && contrast.calls.most > contrast.calls.every && /ordinary least squares|first and last/.test(top('fragile')), '377; fewer than 100 in every one');
    } catch (error) {
      if (!(error instanceof MissingExampleData)) throw error;
      throw new MissingData(error.message);
    }
  },

  // Wave 4, slice 5 (V3): selections. The query language against an independent account of each cell
  // of GRB2's map, from the run's own arrays; set operations and their laws; a saved selection on
  // another run of the protein; the robustness verdicts as queries (GRB2's check, planted fragile
  // results); features beside the map (factor IX's disulfide bonds, from UniProt's entry); freeform
  // shapes; a selection's files and the archive.
  async selections() {
    const g = exampleRun('grb2-sh3');
    const design = g.run.inputs.design;
    const model = buildMapModel(g.results, design);
    const context = (extra = {}) => queryContext({ model, results: g.results, design, ...extra });
    const keysOf = (text, extra) => selectByQuery(text, context(extra)).keys;
    const offset = design.targets[0].offset ?? 0;
    // The language.
    const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
    const plain = same(keysOf('missense at 40–80 with SE < 0.2'), keysOf('missense and pos 40-80 and se < 0.2')) && JSON.stringify(parseQuery('variants whose class depends on the pseudocount').right) === JSON.stringify(parseQuery('class depends on pseudocount'));
    const mistakes = [['missense bananas', 9], ['se <', -1], ['from Q9', 5], ['in "Core', 3], ['(missense at 1-5', -1]].map(([text, at]) => {
      try {
        parseQuery(text);
        return false;
      } catch (error) {
        return error instanceof QueryError && (at < 0 || error.position === at);
      }
    });
    check('selections', 'the query language: the roadmap\'s phrases parse as written ("missense at 40–80 with SE < 0.2" is "missense and pos 40-80 and se < 0.2"); a mistake is named with where it is', `${plain ? 'the same variants' : 'different'}; ${mistakes.filter(Boolean).length} of ${mistakes.length} mistakes named in place`, plain && mistakes.every(Boolean), 'all');
    // Against an independent account of each cell.
    const cells = mapCells(g.results, design);
    const calls = callsOf(g.results, design)[0];
    const cls = (c) => (c.row >= 0 ? calls.cls[c.row] : 0);
    const battery = [
      ['missense at 10-30 with se < 0.2', (c) => c.kind === 'missense' && c.p >= 10 && c.p <= 30 && c.se < 0.2],
      ['nonsense or synonymous', (c) => c.kind === 'nonsense' || c.kind === 'synonymous'],
      ['to P and score < -1', (c) => c.aa === 'P' && c.score < -1],
      ['from aromatic and not missense', (c) => 'FWY'.includes(c.ref) && c.kind !== 'missense'],
      ['low or filtered', (c) => c.state === 'low' || c.state === 'filtered'],
      ['missing', (c) => c.state === 'missing'],
      ['confident', (c) => c.state === 'scored'],
      ['replicates >= 3 and input > 100', (c) => c.k >= 3 && c.input > 100],
      [`refpos ${offset + 12}-${offset + 20} and missense`, (c) => c.p >= 12 && c.p <= 20 && c.kind === 'missense'],
      ['not scored', (c) => !c.scored],
      ['from G,P to polar', (c) => 'GP'.includes(c.ref) && 'CMNQST'.includes(c.aa)],
      ['lower and missense', (c) => cls(c) === CLASS.LOWER && c.kind === 'missense'],
      ['higher or q >= 0.5', (c) => cls(c) === CLASS.HIGHER || (c.row >= 0 && calls.q[c.row] >= 0.5)],
      ['pos > 50 and stop', (c) => c.p > 50 && c.kind === 'nonsense'],
    ];
    const outcomes = battery.map(([text, test]) => {
      const got = keysOf(text);
      const want = cells.filter(test).map((c) => c.name);
      return { text, n: got.length, ok: same(got, want) };
    });
    check('selections', `queries on GRB2's Run 1 against an independent account of each cell of its map (${cells.length} substitutions: names, states, scores, SEs, replicates and mean input counts read from the run's own arrays, classes from callsOf): the same variants in the same order, every one`, outcomes.map((x) => `${x.text}: ${x.n}${x.ok ? '' : ' (differs)'}`).join('; '), outcomes.every((x) => x.ok) && outcomes.every((x) => x.n > 0), 'all the same, none empty');
    // Set operations, and their laws.
    const A = keysOf('missense at 1-30');
    const B = keysOf('lower');
    const sets = [{ name: 'A', keys: A }, { name: 'B', keys: B }];
    const asSet = (keys) => [...keys].sort().join();
    const union = asSet(keysOf('in A or in B', { sets }));
    const inter = asSet(keysOf('in A and in B', { sets }));
    const diff = asSet(keysOf('in A and not in B', { sets }));
    const laws = [
      union === asSet(new Set([...A, ...B])) && union === asSet(combineKeys(A, B, 'add')),
      inter === asSet(A.filter((k) => B.includes(k))) && inter === asSet(combineKeys(A, B, 'intersect')),
      diff === asSet(A.filter((k) => !B.includes(k))) && diff === asSet(combineKeys(A, B, 'subtract')),
      same(keysOf('not (in A or in B)', { sets }), keysOf('not in A and not in B', { sets })),
      same(keysOf('not not missense'), keysOf('missense')),
      keysOf('scored or unscored').length === model.length * 21,
      same(keysOf('lower or higher or neutral'), keysOf('scored')),
      same(keysOf('selected and lower', { selected: A }), keysOf('in A and lower', { sets })),
    ];
    // A saved selection is a list of names: on another run of GRB2 (scored as Enrich2 does), the same.
    const g2 = exampleRun('grb2-sh3', { name: 'Run 2', parameters: PRESETS.enrich2.parameters });
    const model2 = buildMapModel(g2.results, g2.run.inputs.design);
    const across = selectByQuery('in A', queryContext({ model: model2, results: g2.results, design: g2.run.inputs.design, sets })).keys;
    check('selections', 'set operations: union, intersection and difference of two saved selections ("missense at 1-30", "lower") by query equal the sets\' own, and the operations on a selection; De Morgan\'s laws, double negation, a state and its complement covering the map, the classes covering the scored; a saved selection on another run of the protein (scored as Enrich2 does) holds the same variants', `A ${A.length}, B ${B.length}: union ${union.split(',').length}, intersection ${inter.split(',').length}, difference ${diff.split(',').length}; ${laws.filter(Boolean).length} of ${laws.length} laws hold; on Run 2: ${across.length} of ${A.length}`, laws.every(Boolean) && same(across, A), 'all');

    // The robustness verdicts as queries: GRB2's check.
    const grb2 = checkTable(g.o.table, design, g.run.inputs.parameters);
    const t = grb2.summary.targets[0];
    const robust = context({ robustness: grb2.summary });
    const onMap = new Set(cells.map((c) => c.name));
    const verdicts = [['robust', VERDICT.ROBUST, 'robust'], ['fragile', VERDICT.FRAGILE, 'fragile'], ['uncertain', VERDICT.UNCERTAIN, 'uncertain'], ['borderline', VERDICT.BORDERLINE, 'borderline'], ['size-dependent', VERDICT.SIZE, 'size'], ['sometimes-scored', VERDICT.INCLUSION, 'inclusion']].map(([word, v, count]) => {
      const got = evaluateQuery(parseQuery(word), robust).keys;
      const want = [];
      for (let i = 0; i < g.results.rows; i += 1) if (t.verdict[i] === v && onMap.has(g.results.variants.key[i])) want.push(g.results.variants.key[i]);
      const wt = t.verdict[g.results.controls.wt] === v ? 1 : 0;
      return { word, n: got.length, ok: asSet(got) === asSet(want) && got.length === t.counts[count] - wt };
    });
    let consistent = 0;
    let inconsistent = 0;
    for (let i = 0; i < g.results.rows; i += 1) {
      if (!t.verdict[i]) continue;
      const ids = t.dependsOnIds[i];
      const names = t.dependsOn[i] ?? t.droppedBy[i] ?? [];
      const together = names.length === 1 && / \(together\)$/.test(names[0]);
      const ok = t.verdict[i] === VERDICT.ROBUST ? ids === null : Array.isArray(ids) && (together ? ids.length === 0 : ids.length >= 1 && ids.length <= names.length) && ids.every((id) => grb2.choices.some((c) => c.id === id));
      if (ok) consistent += 1;
      else inconsistent += 1;
    }
    const byPseudocount = evaluateQuery(parseQuery('variants whose class depends on the pseudocount'), robust).count;
    const byCombination = evaluateQuery(parseQuery('class depends on the combination'), robust).count;
    check('selections', 'the robustness verdicts as queries (GRB2\'s check): each verdict\'s variants on the map are exactly those the check gives it, as many as it counts; every verdict but robust names the choices that alone account for it (none where only choices together do); the roadmap\'s "variants whose class depends on the pseudocount"', `${verdicts.map((x) => `${x.word} ${x.n}${x.ok ? '' : ' (differs)'}`).join(', ')}; ${consistent} named consistently, ${inconsistent} not; class depends on the pseudocount ${byPseudocount}, on the combination ${byCombination}`, verdicts.every((x) => x.ok) && inconsistent === 0, 'all');
    // Planted fragile results (robustness-cases.mjs), as queries.
    const planted = [41, 42, 43].map((seed) => {
      const x = checkPlanted(seed);
      const m = buildMapModel(x.results, x.design);
      const ctx = queryContext({ model: m, results: x.results, design: x.design, robustness: x.summary });
      const of = (text) => asSet(evaluateQuery(parseQuery(text), ctx).keys);
      const byPseudocount = evaluateQuery(parseQuery('class depends on the pseudocount'), ctx).keys;
      return {
        fragile: of('fragile') === asSet(x.planted.replicate),
        zero: of('size depends on the pseudocount') === asSet(x.planted.zero),
        classByPseudocount: byPseudocount.length,
        atThreshold: byPseudocount.every((k) => !x.planted.zero.includes(k)) && of('class depends on the pseudocount') === of('class depends on the pseudocount and (borderline or uncertain)'),
      };
    });
    check('selections', 'planted fragile results selected by query (three of the robustness suite\'s simulated experiments): "fragile" is exactly the replicate-driven variants; "size depends on the pseudocount" exactly the zero counts, and no zero count\'s class depends on it (it moves their size, not their class): the few whose class it alone changes are unplanted variants at the threshold', planted.map((x, i) => `seed ${41 + i}: fragile ${x.fragile ? 'exact' : 'differs'}, zero counts ${x.zero ? 'exact' : 'differ'}, class by the pseudocount ${x.classByPseudocount}${x.atThreshold ? ' (at the threshold)' : ' (not all at the threshold)'}`).join('; '), planted.every((x) => x.fragile && x.zero && x.atThreshold && x.classByPseudocount <= 3), 'exact; at the threshold');

    // Features beside the map: factor IX's disulfide bonds, from UniProt's entry (P00740).
    const f9 = exampleRun('factor9');
    const d9 = f9.run.inputs.design;
    const m9 = buildMapModel(f9.results, d9);
    const entry = JSON.parse(readFileSync(new URL('./fixtures/public-data/uniprot/P00740.features.json', import.meta.url), 'utf8'));
    const features = featuresOf(uniprotTracks(readUniProtFeatures(entry), { offset: d9.targets[0].offset ?? 0, length: m9.length }).tracks);
    const c9 = queryContext({ model: m9, results: f9.results, design: d9, features });
    const count9 = (text) => evaluateQuery(parseQuery(text), c9).count;
    const bonded = new Set(entry.features.filter((f) => f.type === 'Disulfide bond').flatMap((f) => [f.location.start.value, f.location.end.value]));
    const positions = new Set(evaluateQuery(parseQuery('feature disulfide and synonymous'), c9).keys.map((k) => Number(k.match(/\d+/)[0])));
    const gla = evaluateQuery(parseQuery('feature Gla and synonymous'), c9).keys.map((k) => Number(k.match(/\d+/)[0]));
    const cysteines = count9('from C in feature disulfide') === 21 * bonded.size;
    const nums = { scored: count9('missense from C in feature disulfide and scored'), lower: count9('missense from C in feature disulfide and lower'), all: count9('missense and scored'), allLower: count9('missense and lower') };
    const bullet = exampleById('factor9').expected.join(' ');
    const stated = bullet.includes(`${nums.lower} of the ${nums.scored}`) && bullet.includes(`${nums.allLower.toLocaleString('en-US')} of the ${nums.all.toLocaleString('en-US')}`);
    check('selections', 'features beside the map (factor IX, UniProt P00740): "feature disulfide" is the positions of the entry\'s disulfide bonds (each of its two cysteines), "feature Gla" the Gla domain\'s 47–92; the example\'s numbers: the bonded cysteines\' substitutions lower than the wild type, against all missense variants', `${positions.size} positions (the entry's ${bonded.size}), all cysteines ${cysteines ? 'yes' : 'no'}; Gla ${Math.min(...gla)}–${Math.max(...gla)}; bonded cysteines: ${nums.lower} of ${nums.scored} scored lower; all missense: ${nums.allLower} of ${nums.all}; the example ${stated ? 'says so' : 'says otherwise'}`, asSet(positions) === asSet(bonded) && cysteines && Math.min(...gla) === 47 && Math.max(...gla) === 92 && gla.length === 46 && nums.lower / nums.scored > 0.8 && nums.allLower / nums.all < 0.3 && stated, 'the same; > 80% against < 30%; stated');

    // Freeform shapes: a rectangle drawn as a shape selects what the rectangle does; a circle the
    // cells whose centers it holds.
    const view = { width: 900, cellW: 12, cellH: 14, x0: 5.5, tracks: [] };
    const geo = geometry(model, view);
    const [pa, pb, ra, rb] = [10, 24, 2, 9];
    const x1 = geo.left + (pa - view.x0 + 0.25) * view.cellW;
    const x2 = geo.left + (pb - view.x0 + 0.75) * view.cellW;
    const y1 = geo.top + (ra + 0.25) * view.cellH;
    const y2 = geo.top + (rb + 0.75) * view.cellH;
    const a = hitTest(model, view, x1, y1);
    const b = hitTest(model, view, x2, y2);
    const band = [];
    for (let p = a.position; p <= b.position; p += 1) for (let r = a.row; r <= b.row; r += 1) if (model.state[(p - 1) * 21 + r] !== STATE.NOT_DESIGNED) band.push((p - 1) * 21 + r);
    const shape = cellsInPolygon(model, view, [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]);
    const round = circleCells(model, view, geo, geo.left + 200.3, geo.top + 140.7, 61);
    const drawn = new Set(cellsInPolygon(model, view, circle(geo.left + 200.3, geo.top + 140.7, 61)));
    const inside = round.inside.every((k) => drawn.has(k));
    const outside = [...drawn].every((k) => !round.outside.has(k));
    check('selections', 'freeform shapes on the map: a rectangle drawn as a shape selects the cells the rectangle tool does (by its corners\' hit tests); a circle (96 corners), every cell whose center lies inside it and none beyond it', `rectangle: ${shape.length} cells, the tool's ${band.length}, ${same(shape, band) ? 'the same' : 'different'}; circle: ${round.inside.length} inside ${inside ? 'all selected' : 'not all'}, ${outside ? 'none' : 'some'} beyond, ${round.ambiguous} within half a pixel of its edge`, same(shape, band) && band.length === (pb - pa + 1) * (rb - ra + 1) && inside && outside && round.inside.length > 50, 'the same; all, none');

    // A selection's files, and the archive.
    const query = 'missense at 1-30';
    const json = JSON.parse(selectionJSON({ name: 'Core', run: g.run.id, condition: 0, created: '2026-10-11T00:00:00.000Z', query, keys: A }, g.run));
    const csvLines = selectionCSV(A, g.results, g.run, 0).trim().split('\n');
    const saved = addSelection(g.ws, { name: 'Core', run: g.run.id, condition: 0, keys: A, query }).ws;
    const back = (await readArchive((await writeArchive(saved)).bytes)).ws.selections.find((x) => x.name === 'Core');
    check('selections', 'a selection\'s files and the archive: the JSON keeps its query and names (format mavescape-selection), the CSV a row per variant with its score; a selection saved by query comes back from the archive with its query and its variants', `JSON: ${json.format}, query "${json.query}", ${json.keys.length} variants; CSV: ${csvLines.length - 1} rows (${csvLines[0]}); archive: ${back ? `"${back.query}", ${back.keys.length} variants` : 'missing'}`, json.format === 'mavescape-selection' && json.query === query && same(json.keys, A) && csvLines.length - 1 === A.length && csvLines[0] === 'hgvs_pro,score,SE,status' && back?.query === query && same(back.keys, A), 'kept');
  },
  // Wave 5, slice 1 (X1): structures. The examples' proteins' PDB entries and AlphaFold DB models,
  // read as the page reads them from the fetcher's cache, against what the entries say of
  // themselves; one structure in three formats; assemblies; and what the example's guide shows
  // (disulfide bonds, the residues that touch DNA) against an independent account of the atoms.
  async structures() {
    const opened = [];
    for (const e of EXAMPLE_STRUCTURES) {
      const structure = await openCached('pdb', pdbFile(e.pdb));
      const chain = chainSummaries(structure).find((c) => c.id === e.chain);
      const segments = (chain?.uniprot ?? []).filter((u) => u.accession === e.accession);
      const from = Math.min(...segments.map((u) => u.from));
      const to = Math.max(...segments.map((u) => u.to));
      const model = structure.models[0];
      const protein = model.residues.filter((r) => r.chain === e.chain && r.kind === 'protein');
      const cartoon = buildCartoon(model, { quality: 3 });
      const drawn = protein.filter((r) => cartoon.covered.has(r.key)).length;
      // Ball and stick: every atom drawn but water and hydrogens.
      const sticks = buildScene(model, structure, { polymer: 'ball-stick', ligand: 'ball-stick', sidechains: 'focus', atomScale: 1, bondScale: 1, cartoonWidth: 1, cartoonQuality: 3 }, {});
      const heavy = model.atoms.filter((a) => a.kind !== 'water' && !a.isHydrogen).length;
      opened.push({ e, ok: segments.length > 0 && from === e.covers[0] && to === e.covers[1] && drawn / protein.length >= 0.95 && cartoon.indices.length > 0 && sticks.spheres.count === heavy, text: `${e.pdb} ${e.chain}: ${e.accession} ${from}–${to}, ${drawn} of ${protein.length} residues in the cartoon, ${sticks.spheres.count} of ${heavy} atoms in ball and stick` });
    }
    const covered = new Set(EXAMPLE_STRUCTURES.flatMap((x) => x.examples));
    const withProtein = EXAMPLES.filter((x) => !x.simulated).map((x) => x.id);
    check('structures', 'each example\'s PDB entry, read as the page reads it from the fetcher\'s cache (gzipped mmCIF): the chain the guide names holds the target, on the UniProt residues the entry gives; its cartoon draws at least 95% of the chain\'s residues observed, and ball and stick every atom but water and hydrogens; every published example has its protein\'s entry', `${opened.map((x) => x.text).join('; ')}; examples without one: ${withProtein.filter((id) => !covered.has(id)).join(', ') || 'none'}`, opened.every((x) => x.ok) && withProtein.every((id) => covered.has(id)), 'all');

    const models = [];
    for (const e of EXAMPLE_STRUCTURES) {
      const structure = await openCached('alphafold', modelFile(e.accession, e.model));
      const entry = cachedJSON('alphafold', `${e.accession}.prediction.json`).find((x) => x.entryId === `AF-${e.accession}-F1`);
      const residues = structure.models[0].residues.filter((r) => r.kind === 'protein');
      const values = residues.map((r) => r.confidence);
      const mean = values.reduce((t, v) => t + v, 0) / values.length;
      const share = (test) => values.filter(test).length / values.length;
      const bands = [share((v) => v > 90), share((v) => v > 70 && v <= 90), share((v) => v > 50 && v <= 70), share((v) => v <= 50)];
      const stated = [entry.fractionPlddtVeryHigh, entry.fractionPlddtConfident, entry.fractionPlddtLow, entry.fractionPlddtVeryLow];
      const worst = Math.max(...bands.map((b, i) => Math.abs(b - stated[i])));
      models.push({ e, ok: structure.meta.isPredicted && values.every((v) => Number.isFinite(v) && v >= 0 && v <= 100) && residues.length === entry.uniprotEnd - entry.uniprotStart + 1 && Math.abs(mean - entry.globalMetricValue) <= 0.05 && worst <= 0.01, text: `${e.accession}: ${residues.length} residues, mean pLDDT ${fmt(mean, 2)} (AlphaFold DB ${entry.globalMetricValue}), bands within ${fmt(worst, 3)}` });
    }
    check('structures', 'each example protein\'s AlphaFold DB model, from the cache: a predicted model, every residue\'s confidence (pLDDT, 0–100) read; the whole sequence; the mean pLDDT within 0.05 of the entry\'s own, and the share of residues in each of its four confidence bands within 0.01 of the entry\'s', models.map((x) => x.text).join('; '), models.every((x) => x.ok), 'all');

    // One structure, three formats: RCSB's mmCIF (gzipped), PDB-format file and BinaryCIF of 2VWF;
    // AlphaFold DB's mmCIF and BinaryCIF of GRB2's model.
    const cif = await openCached('pdb', '2VWF.cif.gz');
    const pdb = await openFixture('2VWF.pdb.gz');
    const bcif = await openFixture('2VWF.bcif.gz');
    const ssOf = (structure) => structure.models[0].residues.map((r) => r.ss).join('');
    const sameAtoms = (a, b) => atomLines(a.models[0]).join('\n') === atomLines(b.models[0]).join('\n');
    const afCif = await openCached('alphafold', modelFile('P62993', 6));
    const afBcif = await openFixture('AF-P62993-F1-model_v6.bcif');
    const sameConfidence = afCif.models[0].residues.every((r, i) => r.confidence === afBcif.models[0].residues[i]?.confidence);
    check('structures', 'a structure reads the same however it comes: 2VWF as RCSB\'s gzipped mmCIF, its PDB-format file and its BinaryCIF gives the same atoms (chain, residue, name, element, coordinates to 0.001 Å), residues and secondary structure; GRB2\'s AlphaFold DB model as mmCIF and BinaryCIF, the same atoms and pLDDT', `2VWF: ${cif.models[0].atoms.length}, ${pdb.models[0].atoms.length} and ${bcif.models[0].atoms.length} atoms, ${sameAtoms(cif, pdb) && sameAtoms(cif, bcif) ? 'the same' : 'different'}; secondary structure ${ssOf(cif) === ssOf(pdb) && ssOf(cif) === ssOf(bcif) ? 'the same' : 'different'}; AF-P62993-F1: ${sameAtoms(afCif, afBcif) ? 'the same atoms' : 'different atoms'}, pLDDT ${sameConfidence ? 'the same' : 'different'}`, sameAtoms(cif, pdb) && sameAtoms(cif, bcif) && ssOf(cif) === ssOf(pdb) && ssOf(cif) === ssOf(bcif) && sameAtoms(afCif, afBcif) && sameConfidence, 'the same');

    // Assemblies: each built with the atoms it was estimated at; 3OG7's two are its two chains;
    // 1HHO's, built by symmetry from hemoglobin's αβ dimer, the tetramer.
    const built = [];
    for (const id of [...EXAMPLE_STRUCTURES.map((x) => x.pdb), '3OG7', '1HHO']) {
      const structure = await openCached('pdb', pdbFile(id));
      for (const choice of assemblyChoices(structure).filter((c) => c.id !== 'asym')) {
        structure.activeAssemblyId = choice.id;
        structure.models = materializeAssemblyModels(structure, choice.id);
        deriveStructure(structure, { secondaryMode: 'auto' });
        built.push({ id, assembly: choice.id, atoms: structure.models[0].atoms.length, estimated: choice.atoms, chains: [...new Set(structure.models[0].atoms.map((a) => a.chain))], structure });
      }
    }
    const hemoglobin = built.find((b) => b.id === '1HHO');
    const original = (await openCached('pdb', pdbFile('1HHO'))).models[0];
    // The copy keeps the dimer's shape: every distance between two of its CA atoms is the original's.
    const ca = (atoms) => atoms.filter((a) => a.name === 'CA' && a.kind === 'protein');
    const first = ca(original.atoms);
    const copy = ca(hemoglobin.structure.models[0].atoms).slice(first.length);
    let shape = 0;
    for (let i = 0; i < first.length; i += 7) for (let j = i + 3; j < first.length; j += 11) shape = Math.max(shape, Math.abs(Math.hypot(first[i].x - first[j].x, first[i].y - first[j].y, first[i].z - first[j].z) - Math.hypot(copy[i].x - copy[j].x, copy[i].y - copy[j].y, copy[i].z - copy[j].z)));
    const moved = Math.hypot(first[0].x - copy[0].x, first[0].y - copy[0].y, first[0].z - copy[0].z);
    const og7 = built.filter((b) => b.id === '3OG7');
    check('structures', 'biological assemblies: each the examples\' entries define, built with the atoms it was estimated at; 3OG7\'s two, each one of its chains; hemoglobin\'s (1HHO) built by symmetry from the αβ dimer of its asymmetric unit, the tetramer: twice the atoms, the copy the dimer moved whole (every distance within it the original\'s, to 0.001 Å)', `${built.map((b) => `${b.id} ${b.assembly}: ${b.atoms} atoms${b.atoms === b.estimated ? '' : ` (estimated ${b.estimated})`}`).join('; ')}; 3OG7: chains ${og7.map((b) => b.chains.join('')).join(' and ')}; 1HHO: ${hemoglobin.atoms} of ${original.atoms.length} atoms, the copy ${fmt(moved, 1)} Å away, distances within ${shape.toExponential(1)} Å`, built.every((b) => b.atoms === b.estimated) && og7.length === 2 && og7.every((b) => b.chains.length === 1) && og7[0].chains[0] !== og7[1].chains[0] && hemoglobin.atoms === 2 * original.atoms.length && shape < 1e-3 && moved > 5, 'all');

    // What factor IX's guide shows: the cysteines drawn as sticks, their bonds the entry's.
    const factor9 = await openCached('pdb', pdbFile('1RFN'));
    const fm = factor9.models[0];
    const pair = (a, b) => [`${a.chain}:${a.resSeq}`, `${b.chain}:${b.resSeq}`].sort().join('–');
    const drawnBonds = fm.bonds.filter((b) => fm.atoms[b.a].name === 'SG' && fm.atoms[b.b].name === 'SG' && fm.atoms[b.a].resName === 'CYS' && fm.atoms[b.b].resName === 'CYS').map((b) => pair(fm.atoms[b.a], fm.atoms[b.b])).sort();
    const { text: rfnText } = await readStructureBytes(cachedBytes('pdb', pdbFile('1RFN')), '1RFN.cif.gz');
    const conn = cifTable(parseCIFDocument(rfnText), 'struct_conn');
    const recorded = [];
    for (let row = 0; row < conn.rowCount; row += 1) {
      if (conn.column('conn_type_id')(row) !== 'disulf') continue;
      recorded.push(pair({ chain: conn.column('ptnr1_auth_asym_id')(row), resSeq: conn.column('ptnr1_auth_seq_id')(row) }, { chain: conn.column('ptnr2_auth_asym_id')(row), resSeq: conn.column('ptnr2_auth_seq_id')(row) }));
    }
    recorded.sort();
    const target = (structure) => ({ id: 1, index: 1, name: structure.meta.code, model: structure.models[0], structure, context: {} });
    const selected = (structure, text) => [...residueKeysFromMask(structure.models[0], selectAtoms(text, [target(structure)]).get(1))].sort();
    const cysteines = selected(factor9, 'resn CYS');
    const allCys = fm.residues.filter((r) => r.resName === 'CYS').map((r) => r.key).sort();
    const bonded = new Set(drawnBonds.flatMap((p) => p.split('–')));
    const guide = exampleById('factor9');
    const stated = guide.expected.some((t) => t.includes(`${allCys.length} of the cysteines, in seven of the disulfide bonds, one of them joining the two chains`)) && guide.steps.some(([mode, t]) => mode === 'structure' && t.includes('1RFN'));
    check('structures', 'factor IX\'s guide (1RFN): "resn CYS" selects every cysteine of the entry; the bonds drawn between their sulfur atoms are the entry\'s own disulfide records (struct_conn), the one between the light and heavy chains among them; the guide says so', `${cysteines.length} cysteines selected (${allCys.length} in the entry), ${bonded.size} of them bonded; bonds drawn: ${drawnBonds.join(', ')}; recorded: ${recorded.length}; the guide ${stated ? 'says so' : 'says otherwise'}`, cysteines.join() === allCys.join() && drawnBonds.join() === recorded.join() && drawnBonds.length === 7 && drawnBonds.some((p) => p.includes('A:') && p.includes('B:')) && stated, 'the same; stated');

    // TP53 (1TUP): the residues of chain B within 4 Å of DNA, by the selection language and by
    // every distance between their atoms and the DNA's.
    const p53 = await openCached('pdb', pdbFile('1TUP'));
    const pm = p53.models[0];
    const byLanguage = selected(p53, 'byres (chain B and protein and within 4 of nucleic)');
    const dna = pm.atoms.filter((a) => a.kind === 'nucleic');
    const byDistance = pm.residues.filter((r) => r.chain === 'B' && r.kind === 'protein' && r.atoms.some((a) => dna.some((n) => Math.hypot(a.x - n.x, a.y - n.y, a.z - n.z) <= 4))).map((r) => r.key).sort();
    const named = (keys) => keys.map((k) => k.split(':').slice(1).reverse().join('')).join(', ');
    check('structures', 'TP53 bound to DNA (1TUP): the residues of chain B within 4 Å of the DNA, selected in words ("byres (chain B and protein and within 4 of nucleic)"), are those every distance between atoms finds; the hotspot arginines R248 and R273 among them', `${byLanguage.length} by the selection, ${byDistance.length} by distance: ${named(byDistance)}`, byLanguage.join() === byDistance.join() && byDistance.includes('B:248:ARG') && byDistance.includes('B:273:ARG'), 'the same; R248 and R273');

    // Wave 5, slice 2 (X2): the target mapped onto structures. Each example's target is aligned to
    // its entry's chains; SIFTS (PDBe's residue-level mapping, reference/sifts.json, read from its
    // updated mmCIF with gemmi) says independently which UniProt residue each residue is.
    const base = (accession) => String(accession ?? '').split('-')[0];
    const toSifts = [];
    for (const e of EXAMPLE_STRUCTURES) {
      const structure = await openCached('pdb', pdbFile(e.pdb));
      const residueMap = structure.models[0].residueMap;
      const sifts = siftsOf(e.pdb);
      for (const id of e.examples) {
        const target = exampleTarget(id);
        const maps = mapTarget(structure, target);
        let agree = 0;
        const differ = [];
        const missed = [];
        // Where SIFTS takes the other of two alignments as good: a position the mapping calls
        // ambiguous (an equal score either way), SIFTS's position too.
        const tied = new Set();
        const states = { unobserved: 0, unobservedSifts: 0 };
        for (const m of maps) {
          const residues = m.positions.filter((p) => p.residue).map((p) => [p, residueMap.get(p.residue)]);
          const labelChain = residues[0]?.[1].labelChain;
          const chain = sifts.get(labelChain) ?? new Map();
          const ambiguous = new Set(m.positions.filter((p) => p.ambiguous).map((p) => p.reference));
          for (const [p, residue] of residues) {
            const row = chain.get(Number(residue.labelSeq));
            if (row && base(row.accession) === e.accession && row.position === p.reference) agree += 1;
            else if (row && ambiguous.has(p.reference) && ambiguous.has(row.position)) tied.add(`${p.reference}/${row.position}`);
            else differ.push(`${p.residue} at ${p.reference}, SIFTS ${row ? `${row.accession} ${row.position}` : 'none'}`);
          }
          // What SIFTS places on the chain within the target, observed and not, the alignment too.
          const placed = new Set(m.positions.filter((p) => p.residue).map((p) => p.reference));
          const unobserved = new Set(m.positions.filter((p) => p.state === 'unobserved').map((p) => p.reference));
          for (const row of chain.values()) {
            if (base(row.accession) !== e.accession || row.position < target.offset + 1 || row.position > target.offset + target.length) continue;
            if (row.observed && !placed.has(row.position)) missed.push(`${m.chain} ${row.position}`);
            if (!row.observed) {
              states.unobservedSifts += 1;
              if (unobserved.has(row.position)) states.unobserved += 1;
              else if (ambiguous.has(row.position)) tied.add(`${row.position} (unobserved)`);
              else missed.push(`${m.chain} ${row.position} (unobserved)`);
            }
          }
        }
        toSifts.push({ id, entry: e.pdb, chains: maps.map((m) => m.chain).join(''), agree, differ, missed, tied: [...tied], states, ok: maps.length > 0 && agree > 0 && !differ.length && !missed.length });
      }
    }
    check('structures', `each example's target mapped onto its PDB entry (aligned to every chain that holds it) places every residue where SIFTS does (PDBe, retrieved ${siftsRetrieved}, read with gemmi), and on the residues SIFTS says are not observed, says so; nothing SIFTS places in the target missed, but where two alignments score the same, which the mapping calls ambiguous and SIFTS takes the other`, toSifts.map((x) => `${x.id} on ${x.entry} (chains ${x.chains}): ${x.agree} residues as SIFTS, ${x.states.unobserved} of SIFTS's ${x.states.unobservedSifts} unobserved${x.tied.length ? `, ambiguous ${x.tied.join(', ')}` : ''}${x.differ.length ? `; differ: ${x.differ.slice(0, 3).join(', ')}` : ''}${x.missed.length ? `; missed: ${x.missed.slice(0, 3).join(', ')}` : ''}`).join('; '), toSifts.length === 8 && toSifts.every((x) => x.ok), 'all as SIFTS, but the ambiguous');

    // AlphaFold DB's models number their residues as UniProt: each target on its protein's model is
    // checked against the model's own numbering, and its differences against the model's sequence
    // read at the target's place.
    const onModels = [];
    for (const e of EXAMPLE_STRUCTURES) {
      const model = await openCached('alphafold', modelFile(e.accession, e.model));
      const residues = model.models[0].residues.filter((r) => r.kind === 'protein');
      for (const id of e.examples) {
        const target = exampleTarget(id);
        const [m] = mapTarget(model, target);
        const numbered = m.positions.filter((p) => p.residue).every((p) => model.models[0].residueMap.get(p.residue).resSeq === p.reference);
        const read = target.sequence.split('').map((code, i) => [i + 1, code, residues[i + target.offset]?.code]).filter(([, code, there]) => code !== there).map(([position, code, there]) => `${code}${position}${there}`);
        const different = m.positions.filter((p) => p.state === 'different').map((p) => `${p.code}${p.position}${p.structureCode}`);
        onModels.push({ id, model: `AF-${e.accession}`, on: m.onStructure, length: target.length, numbered, different, read, ok: m.onStructure === target.length && numbered && different.join() === read.join() });
      }
    }
    check('structures', 'each example\'s target on its protein\'s AlphaFold DB model: every position on the residue the model numbers as its reference position; another residue exactly where the target differs from the model\'s sequence read at the target\'s place (BRCA1 RING\'s R175K and TP53\'s R72P, the targets\' own)', onModels.map((x) => `${x.id} on ${x.model}: ${x.on} of ${x.length}${x.numbered ? '' : ', numbered otherwise'}${x.different.length ? `, different ${x.different.join(', ')}` : ''}`).join('; '), onModels.every((x) => x.ok), 'all');

    // What the mapping reports, against what the entries record and SIFTS: 2VWF's engineered
    // mutation; 1RFN's light chain, which its own record numbers five earlier than SIFTS; PTEN's
    // loop missing from 1D5R's sequence, where SIFTS places nothing; the PDB-format 2VWF mapped as
    // its mmCIF.
    const grb2 = exampleTarget('grb2-sh3');
    const [onVWF] = mapTarget(await openCached('pdb', pdbFile('2VWF')), grb2);
    const mutation = onVWF.positions.find((p) => p.state === 'different');
    const [onPDBFormat] = mapTarget(await openFixture('2VWF.pdb.gz'), grb2);
    const sameAsMMCIF = onPDBFormat.positions.every((p, i) => p.state === onVWF.positions[i].state && p.residue === onVWF.positions[i].residue && (p.reason ?? '') === (onVWF.positions[i].reason ?? ''));
    const f9 = exampleTarget('factor9');
    const factorIX = await openCached('pdb', pdbFile('1RFN'));
    const light = mapTargetOnChain(factorIX, 'B', f9);
    const lightRecord = light.positions.filter((p) => p.recorded != null).every((p) => p.recorded === p.reference - 5);
    const lightSifts = siftsOf('1RFN').get('B');
    const lightAsSifts = light.positions.filter((p) => p.residue).every((p) => lightSifts.get(Number(factorIX.models[0].residueMap.get(p.residue).labelSeq))?.position === p.reference);
    const pten = exampleTarget('pten-mavedb');
    const [onD5R] = mapTarget(await openCached('pdb', pdbFile('1D5R')), pten);
    const deleted = onD5R.positions.filter((p) => p.state === 'deleted' && !p.ambiguous).map((p) => p.reference);
    const siftsPTEN = new Set([...siftsOf('1D5R').get('A').values()].map((r) => r.position));
    // At the join, the construct's valine scores the same against T286 and A309: ambiguous. SIFTS
    // takes 286, the entry's own record (struct_ref_seq_dif) 309. Around the loop and its join,
    // SIFTS places the residues on either side.
    const join = onD5R.positions.filter((p) => p.ambiguous).map((p) => p.reference);
    const span = [...deleted, ...join];
    const loopAbsent = deleted.length > 0 && deleted.every((position) => !siftsPTEN.has(position)) && siftsPTEN.has(Math.min(...span) - 1) && siftsPTEN.has(Math.max(...span) + 1);
    const recordedJoin = (await openCached('pdb', pdbFile('1D5R'))).sequenceDifferences.find((d) => d.resName === 'VAL' && d.label === 280)?.dbPosition;
    const siftsJoin = siftsOf('1D5R').get('A').get(280)?.position;
    const words = describeMapping(light, '1RFN').join(' ');
    const f9Listed = rankStructures(cachedJSON('pdbe', 'P00740.best-structures.json'), { ...f9, accession: 'P00740' }).length;
    const guideSays = exampleById('factor9').expected.some((t) => t.includes('on chain B at 132–188') && t.includes('five earlier')) && exampleById('factor9').steps.some(([mode, t]) => mode === 'structure' && t.includes('chain B, at 132–188') && t.includes(`lists the ${f9Listed} PDB entries`));
    check('structures', 'the mapping reports what the entries record and SIFTS says: 2VWF\'s engineered mutation of GRB2\'s P212 (target position 54) to alanine, the same from its PDB-format file; 1RFN\'s light chain (chain B) at factor IX\'s 132–188 as SIFTS places it, the entry\'s own record numbering it five earlier, said so; PTEN\'s loop missing from 1D5R\'s sequence, where SIFTS places nothing between its neighbors, and at its join a valine an alignment places as well at T286 (SIFTS\'s choice) as at A309 (the entry\'s own record): ambiguous', `2VWF: ${mutation ? `${mutation.code}${mutation.position}${mutation.structureCode} (${mutation.reason}, reference ${mutation.reference})` : 'none'}; PDB format ${sameAsMMCIF ? 'the same' : 'different'}; 1RFN B: ${light.positions.find((p) => p.residue)?.reference}–${light.positions.filter((p) => p.residue).at(-1)?.reference}, ${lightAsSifts ? 'as SIFTS' : 'not as SIFTS'}, record ${lightRecord ? 'five earlier' : 'otherwise'} ("${/it numbers them \d+ earlier/.exec(words)?.[0] ?? 'not said'}"), the guide ${guideSays ? 'says so' : 'says otherwise'}; 1D5R: missing ${deleted.length ? `${Math.min(...deleted)}–${Math.max(...deleted)}` : 'nothing'}, ${loopAbsent ? 'absent from SIFTS' : 'in SIFTS'}; ambiguous ${join.join(' and ')} (SIFTS ${siftsJoin}, the record ${recordedJoin})`, mutation?.position === 54 && mutation.reference === 212 && mutation.structureCode === 'A' && mutation.reason === 'engineered mutation' && sameAsMMCIF && lightAsSifts && lightRecord && light.record.compared === 56 && /numbers them 5 earlier/.test(words) && loopAbsent && join.join() === '286,309' && siftsJoin === 286 && recordedJoin === 309 && guideSays, 'as recorded; the guide saying so');

    // The structures that cover each example's target, ranked from PDBe's best_structures (the
    // fetcher's cached answers): the most of the target first, then the best resolution; the
    // entry the example's guide or the roadmap names among them.
    const ranked = [];
    for (const e of EXAMPLE_STRUCTURES) {
      const target = exampleTarget(e.examples[0]);
      const rows = rankStructures(cachedJSON('pdbe', `${e.accession}.best-structures.json`), { ...target, accession: e.accession });
      const ordered = rows.every((r, i) => i === 0 || rows[i - 1].covered > r.covered || (rows[i - 1].covered === r.covered && (rows[i - 1].resolution ?? Infinity) <= (r.resolution ?? Infinity)));
      const within = rows.every((r) => r.from >= 1 && r.to <= target.length && r.covered === r.to - r.from + 1);
      const named = rows.find((r) => r.id === e.pdb);
      ranked.push({ e, n: rows.length, first: rows[0], named, ok: rows.length > 0 && ordered && within && named?.chains.some((c) => c.id === e.chain) });
    }
    check('structures', 'the PDB entries that cover each example\'s target, ranked from PDBe\'s SIFTS (best_structures, from the cache): the most of the target first, then the best resolution, each within the target; the entry the guide names among them, with its chain', ranked.map((x) => `${x.e.accession}: ${x.n} entries, first ${x.first?.id} (${x.first?.covered} positions), ${x.e.pdb} ${x.named ? `${x.named.covered} positions, rank ${ranked.length && x.n ? 1 + rankStructures(cachedJSON('pdbe', `${x.e.accession}.best-structures.json`), { ...exampleTarget(x.e.examples[0]), accession: x.e.accession }).findIndex((r) => r.id === x.e.pdb) : '?'}` : 'missing'}`).join('; '), ranked.every((x) => x.ok), 'all');

    // Wave 5, slice 3 (X3): scores on the structure. Each example's run, scored in Node, colored on
    // its entry by every coloring; each residue's value and color checked against the run's results
    // read without the map's model (structure-cases.mjs, positionScores), and the map's grammar:
    // a position with nothing scored drawn gray, never in the wild type's color.
    const lut = colormapLUT('rdbu');
    const hexAt = (t, pale) => {
      const k = Math.max(0, Math.min(255, Math.round(t * 255)));
      return `#${[lut[k * 3], lut[k * 3 + 1], lut[k * 3 + 2]].map((x) => Math.round(pale ? (x + 110) / 2 : x).toString(16).padStart(2, '0')).join('')}`;
    };
    const rgbDistance = (a, b) => Math.hypot(...[1, 3, 5].map((k) => parseInt(a.slice(k, k + 2), 16) - parseInt(b.slice(k, k + 2), 16)));
    const colorings = [];
    const scoredRuns = new Map();
    for (const e of EXAMPLE_STRUCTURES) {
      const structure = await openCached('pdb', pdbFile(e.pdb));
      for (const id of e.examples) {
        const o = openExampleInNode(exampleById(id));
        const results = proteinView(o.scored.results) ?? o.scored.results;
        const model = buildMapModel(results, o.design, {});
        const target = exampleTarget(id);
        const maps = mapTarget(structure, target);
        const own = positionScores(results);
        scoredRuns.set(id, { o, results, model, target, maps, own, structure });
        const shift = target.offset - (o.design.targets[0].offset ?? 0);
        const wild = hexAt(0.5);
        const problems = [];
        let compared = 0;
        let gray = 0;
        let nearest = Infinity;
        const tried = [];
        for (const how of ['median', 'mean', 'minimum', 'maximum', 'count', 'uncertainty', 'substitution', 'qc']) {
          let values;
          try {
            values = placeOnTarget(positionValues(model, how, { substitution: 'P' }), target);
          } catch (error) {
            tried.push(`${how}: ${/no standard errors/.test(error.message) ? 'no SEs' : error.message}`);
            continue;
          }
          tried.push(how);
          const pal = coloringPalette(values, 'rdbu');
          const colors = residueColors(values, maps, pal);
          for (const m of maps) {
            for (const p of m.positions) {
              if (!p.residue) continue;
              const at = own.get(p.position - shift) ?? { scored: new Map(), filtered: new Set() };
              const reference = target.sequence[p.position - 1];
              let expected;
              let state;
              let low = false;
              if (how === 'substitution') {
                const one = at.scored.get('ARNDCQEGHILKMFPSTWYV*'.indexOf('P') + 1);
                if (reference === 'P') state = POSITION.REFERENCE;
                else if (one) {
                  expected = one.score;
                  low = one.low;
                  state = POSITION.VALUE;
                } else state = at.filtered.has(15) ? POSITION.FILTERED : POSITION.MISSING;
              } else {
                const list = [...at.scored.values()];
                if (!list.length) state = at.filtered.size ? POSITION.FILTERED : POSITION.MISSING;
                else {
                  state = POSITION.VALUE;
                  low = list.every((x) => x.low) && how !== 'qc' && how !== 'count';
                  const xs = list.map((x) => x.score);
                  expected = how === 'median' ? middle(xs) : how === 'mean' ? xs.reduce((a, b) => a + b, 0) / xs.length : how === 'minimum' ? Math.min(...xs) : how === 'maximum' ? Math.max(...xs) : how === 'count' ? xs.length : how === 'uncertainty' ? middle(list.map((x) => x.se).filter(Number.isFinite)) : (list.length * 2 < 19 ? 3 : list.length < 19 ? 2 : list.some((x) => x.low) ? 1 : 0);
                }
              }
              const got = colors.get(p.residue).map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
              let want;
              if (state === POSITION.FILTERED) want = STATE_COLORS.filtered;
              else if (state === POSITION.MISSING) want = STATE_COLORS.missing;
              else if (state === POSITION.REFERENCE) want = wild;
              else if (how === 'qc') want = QC_CLASSES[expected].color;
              else if (values.domain.kind === 'diverging') want = hexAt(Math.max(0, Math.min(1, 0.5 + (expected - model.domain.center) / (2 * (model.domain.max - model.domain.center)))), low);
              else want = null;
              const value = values.value[p.position - 1];
              const valueOk = state !== POSITION.VALUE || (how === 'qc' ? values.category[p.position - 1] === expected : Math.abs(value - expected) <= 1e-12 * Math.max(1, Math.abs(expected)));
              const stateOk = values.state[p.position - 1] === (low ? POSITION.LOW : state);
              if (state === POSITION.FILTERED || state === POSITION.MISSING) {
                gray += 1;
                nearest = Math.min(nearest, rgbDistance(`#${got}`, wild));
              }
              if (!valueOk || !stateOk || (want && `#${got}` !== want)) problems.push(`${how} ${p.residue}: ${fmt(value, 3)} ${POSITION_NAMES[values.state[p.position - 1]]} ${'#' + got}, expected ${fmt(expected, 3)} ${POSITION_NAMES[low ? POSITION.LOW : state]} ${want ?? ''}`);
              compared += 1;
            }
          }
        }
        colorings.push({ id, entry: e.pdb, compared, gray, nearest, tried, problems, ok: compared > 0 && !problems.length && (!gray || nearest > 100) });
      }
    }
    check('structures', 'scores on each example\'s PDB entry: its run (scored in Node) colored by every coloring (median, mean, lowest, highest, count, uncertainty, the substitution to proline, QC state), every residue of every chain that holds the target given the value its position\'s missense substitutions have in the run\'s results (read without the map\'s model) and the map\'s color for it (rdbu, the map\'s scale; paler where all are of low confidence); a position with nothing scored gray (filtered or missing), at least 100 (RGB) from the wild type\'s color', colorings.map((x) => `${x.id} on ${x.entry}: ${x.compared} residue colorings (${x.tried.join(', ')})${x.gray ? `, ${x.gray} gray, nearest ${x.nearest.toFixed(0)} from the wild type's` : ''}${x.problems.length ? `; ${x.problems.slice(0, 3).join('; ')}` : ''}`).join('; '), colorings.length === 8 && colorings.every((x) => x.ok), 'all; gray ≥ 100 away');

    // Selections both ways: a map selection's positions drawn on the residues SIFTS places them on,
    // and a residue picked selecting what "at" selects on the map.
    const shared = [];
    for (const e of EXAMPLE_STRUCTURES) {
      const sifts = siftsOf(e.pdb);
      for (const id of e.examples) {
        const { model, target, maps, own, structure, o } = scoredRuns.get(id);
        const shift = target.offset - (o.design.targets[0].offset ?? 0);
        // The ten least tolerant positions on the structure, by their median.
        const m = maps[0];
        const on = m.positions.filter((p) => p.residue && own.get(p.position - shift)?.scored.size).map((p) => [p.position - shift, middle([...own.get(p.position - shift).scored.values()].map((x) => x.score))]).sort((a, b) => a[1] - b[1]).slice(0, 10).map(([p]) => p);
        const keys = cellsAtPositions(model, on, cellName, cellAt);
        const query = evaluateQuery(parseQuery(`at ${positionRanges(on)}`), queryContext({ model, results: scoredRuns.get(id).results, design: o.design }));
        const sameAsQuery = keys.length === query.keys.length && keys.every((k) => query.keys.includes(k));
        const back = positionsOfKeys(keys);
        const residues = maps.flatMap((x) => back.map((p) => x.positions[p + shift - 1]?.residue).filter(Boolean));
        const residueMap = structure.models[0].residueMap;
        const siftsAt = residues.map((key) => {
          const r = residueMap.get(key);
          return sifts.get(r.labelChain)?.get(Number(r.labelSeq))?.position;
        });
        const expected = residues.map((key) => maps.find((x) => x.residuePosition.has(key)).residuePosition.get(key) + target.offset);
        const asSifts = siftsAt.every((x, k) => x === expected[k]);
        const picked = residues.map((key) => maps.find((x) => x.residuePosition.has(key)).residuePosition.get(key) - shift);
        const roundTrip = JSON.stringify([...new Set(picked)].sort((a, b) => a - b)) === JSON.stringify([...on].sort((a, b) => a - b));
        const available = m.positions.filter((p) => p.residue && own.get(p.position - shift)?.scored.size).length;
        shared.push({ id, entry: e.pdb, positions: on.length, keys: keys.length, residues: residues.length, ok: on.length === Math.min(10, available) && sameAsQuery && JSON.stringify(back) === JSON.stringify([...on].sort((a, b) => a - b)) && asSifts && roundTrip && residues.length >= 10, sameAsQuery, asSifts, roundTrip });
      }
    }
    check('structures', 'selections shared both ways: each example\'s ten least tolerant positions on its entry (Hsp90\'s nine), selected on the map (what "at" selects there), drawn on the residues SIFTS places those positions on (on every chain that holds the target); those residues picked select the same positions again', shared.map((x) => `${x.id} on ${x.entry}: ${x.positions} positions, ${x.keys} variants, ${x.residues} residues${x.sameAsQuery ? '' : ', not as "at" selects'}${x.asSifts ? '' : ', not where SIFTS places them'}${x.roundTrip ? '' : ', picked otherwise'}`).join('; '), shared.every((x) => x.ok), 'all');

    // The GRB2 example's guide: on 2VWF its least tolerant residues pack the core, and those that
    // touch the Gab2 peptide (selected in words) are tolerant: the assay measured abundance.
    {
      const { target, maps, own, structure } = scoredRuns.get('grb2-sh3');
      const model = structure.models[0];
      const m = maps.find((x) => x.chain === 'A');
      const ca = (key) => model.residueMap.get(key).atoms.find((a) => a.name === 'CA');
      const cas = model.residues.filter((r) => r.chain === 'A' && r.kind === 'protein').map((r) => r.atoms.find((a) => a.name === 'CA')).filter(Boolean);
      const near = (a, b, d) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) <= d;
      const rows = m.positions.filter((p) => p.residue && own.get(p.position)?.scored.size).map((p) => ({ p, median: middle([...own.get(p.position).scored.values()].map((x) => x.score)), neighbors: cas.filter((b) => b !== ca(p.residue) && near(ca(p.residue), b, 10)).length }));
      rows.sort((a, b) => a.median - b.median);
      const core = middle(rows.slice(0, 10).map((r) => r.neighbors));
      const surface = middle(rows.slice(-10).map((r) => r.neighbors));
      const peptide = model.atoms.filter((a) => a.chain === 'B' && a.kind === 'protein');
      const touching = rows.filter((r) => model.residueMap.get(r.p.residue).atoms.some((a) => peptide.some((b) => near(a, b, 4))));
      const words = 'byres (chain A and protein and within 4 of (chain B and protein))';
      const t = { id: 1, index: 1, name: '2VWF', model, structure, context: { selected: new Set(), focus: null, values: {} } };
      const byWords = [...residueKeysFromMask(model, selectAtoms(words, [t]).get(1))].sort();
      const sameResidues = byWords.join() === touching.map((r) => r.p.residue).sort().join();
      const contact = middle(touching.map((r) => r.median));
      const rest = middle(rows.filter((r) => !touching.includes(r)).map((r) => r.median));
      const example = exampleById('grb2-sh3');
      const bullet = example.expected.at(-1);
      const said = bullet.includes(`a median of ${core.toFixed(1)} Cα atoms within 10 Å, the ten highest ${surface.toFixed(1)}`) && bullet.includes(`the ten that touch the Gab2 peptide are tolerant (a median of ${contact.toFixed(2).replace('-', '−')}, against ${rest.toFixed(2).replace('-', '−')} for the rest)`) && touching.length === 10 && example.steps.some(([, text]) => text.includes(`"${words}"`));
      check('structures', 'the GRB2 example\'s guide, on 2VWF colored by the median score: its ten least tolerant residues have more Cα atoms within 10 Å (the core) than its ten most tolerant, and the residues that touch the Gab2 peptide (chain B), selected in the words its guide gives as every distance finds them, score nearer the wild type than the rest; the guide says so, with these numbers', `${rows.length} positions; neighbors within 10 Å: ten least tolerant ${core}, ten most ${surface}; touching the peptide ${touching.length} (${touching.map((r) => `${r.p.code}${r.p.reference}`).join(' ')}), ${sameResidues ? 'as the words select them' : `the words select ${byWords.length}`}: median ${fmt(contact, 2)}, the rest ${fmt(rest, 2)}; the guide ${said ? 'says so' : 'says otherwise'}`, core > surface && contact > rest && sameResidues && said && target.offset === 158, 'core packed; the binding surface tolerant; said');
    }

    // Fraction abnormal-like, by PTEN's published calibrations (read from the record's own JSON,
    // not through MaveScape's reading of it), on 1D5R; and by a threshold.
    {
      const { model, target, maps, own } = scoredRuns.get('pten-mavedb');
      const raw = cachedJSON('mavedb', 'urn_mavedb_00000013-a-1.json').scoreCalibrations;
      const record = cachedRecord('urn:mavedb:00000013-a-1');
      const results = [];
      for (const title of ['Calibration by Gaussian mixture model', 'ExCALIBR calibration']) {
        const published = raw.find((c) => c.title === title).functionalClassifications.filter((k) => k.functionalClassification === 'abnormal' && Array.isArray(k.range));
        const abnormal = (x) => published.some((k) => (k.range[0] === null || (k.inclusiveLowerBound ? x >= k.range[0] : x > k.range[0])) && (k.range[1] === null || (k.inclusiveUpperBound ? x <= k.range[1] : x < k.range[1])));
        const values = placeOnTarget(positionValues(model, 'fraction', { abnormal: calibrationClasses(record.calibrations.find((c) => c.title === title)) }), target);
        let compared = 0;
        let differ = 0;
        for (const p of maps[0].positions) {
          const list = [...(own.get(p.position)?.scored.values() ?? [])].map((x) => x.score);
          if (!p.residue || !list.length) continue;
          compared += 1;
          if (Math.abs(values.value[p.position - 1] - list.filter(abnormal).length / list.length) > 1e-12) differ += 1;
        }
        results.push({ title, ranges: published.length, compared, differ });
      }
      const below = placeOnTarget(positionValues(model, 'fraction', { abnormal: thresholdClasses(0.5, 'below') }), target);
      const p = maps[0].positions.find((x) => x.residue && (own.get(x.position)?.scored.size ?? 0) >= 10);
      const list = [...own.get(p.position).scored.values()].map((x) => x.score);
      const thresholdOk = Math.abs(below.value[p.position - 1] - list.filter((x) => x < 0.5).length / list.length) < 1e-12;
      check('structures', 'fraction abnormal-like by PTEN\'s published calibrations on 1D5R: the share of each position\'s scored missense substitutions in the calibration\'s abnormal ranges as the record\'s own JSON gives them (bounds included or not as published; ExCALIBR\'s five abnormal ranges, the Gaussian mixture\'s one), and by a threshold set by hand', `${results.map((x) => `${x.title}: ${x.ranges} abnormal ${x.ranges === 1 ? 'range' : 'ranges'}, ${x.compared} positions, ${x.differ} differ`).join('; ')}; threshold 0.5 at position ${p.position}: ${thresholdOk ? 'the same' : 'different'}`, results.every((x) => x.compared > 0 && !x.differ) && thresholdOk, 'the same');
    }
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
