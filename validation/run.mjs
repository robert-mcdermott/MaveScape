// MaveScape's validation suite. Unit tests (web/lib/*.test.mjs) check functions in isolation; this
// suite runs whole pipelines on fixtures and published data whose answers are known (committed
// outputs of the reference tools, validation/reference/), and reports how closely MaveScape
// agrees, against stated tolerances (mavescape-spec/requirements.md, T1–T2).
//
//   node validation/run.mjs [suite …] [--verbose] [--require-data]
//
// Suites: accessibility, designs (external data), enrich2 (external data), hgvs, import (external
// data), experiment (external data), scoring, qc, map and roundtrip (their last checks need
// external data); all by default. UPDATE_GOLDEN=1 rewrites the golden files (validation/golden/) instead of
// comparing with them.
// Exits with status 1 when a check fails.
//
// Suites marked "external data" need files that node validation/fetch.mjs downloads into
// validation/cache/ (wave 1, slice 2); without them the suite is skipped, and fails with
// --require-data, as in CI. The harness follows CytoWeave 0.8.0's validation/run.mjs.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { textPairs, themeTokens } from './accessibility-cases.mjs';
import { DESIGN_CASES, dataChecks, readDesign, readTable } from './design-cases.mjs';
import { checkSchema } from './json-schema.mjs';
import { enrich2Combination, normalizers, ratioScores, regressionScores, replicateCounts } from './enrich2-formulas.mjs';
import { summarizeDesign, validateDesign } from '../web/lib/design.js';
import { parseHgvs, formatPosition } from '../web/lib/hgvs.js';
import { createTableParser, parseTable } from '../web/lib/csv.js';
import { detectLayout, draftDesign, namesFromSequences, reviewImport, suggestRoles } from '../web/lib/importer.js';
import { buildCountSet, joinCountTables } from '../web/lib/counts.js';
import { KIND_NAMES } from '../web/lib/variants.js';
import { parseFasta, targetFromSequence } from '../web/lib/target.js';
import { createRandom, shuffle } from '../web/lib/random.js';
import { meaning, modelRoundTrip, rebuild } from './experiment-cases.mjs';
import { designFromSampleSheet } from '../web/lib/samplesheet.js';
import { addSource, addTarget, createWorkspace, parseWorkspace, serializeWorkspace, setDesign, updateTarget, verifyHistory } from '../web/lib/workspace.js';
const formatCount = (n) => n.toLocaleString('en-US');
import { VISIONS, lab as labOf, paletteReport, simulate } from '../web/lib/colorvision.js';
import { CATEGORICAL, CATEGORICAL_CVD, colormapColor } from '../web/lib/colormaps.js';
import { EDGE_EXPECTATIONS, byKey, engineInput, fixtureDesign, fixtureTable, score, shuffledTable, variantTable } from './scoring-cases.mjs';
import { scoreExperiment, PRESETS, DEFAULT_PARAMETERS } from '../web/lib/score.js';
import { combineFixed, combineREML, heterogeneity } from '../web/lib/replicates.js';
import { STAGE_BY_CODE, STAGE_BY_ID, REPLICATE_STATE } from '../web/lib/filters.js';
import { makeRun, outputDigest, runId, runInputs, addRun, recordedInputs } from '../web/lib/runs.js';
import { median } from '../web/lib/score-ratio.js';
import { QC_FIXTURES, QC_SEEDS, matches, raised, runFixture } from './qc-cases.mjs';
import { computeQC } from '../web/lib/qc.js';
import { checkThresholds, defaultThresholds, findingsFrom, overall } from '../web/lib/findings.js';
import { simulateExperiment } from '../web/lib/simulate.js';
import { setQcThresholds } from '../web/lib/workspace.js';
import { buildMapModel, cellAt, cellName, colorPosition, describeMap, ROW_ORDERS, STATE, STATE_NAMES } from '../web/lib/map-model.js';
import { mapPalette } from '../web/lib/map-render.js';
import { EXPORT_THEME, mapSVG } from '../web/lib/map-svg.js';
import { lab as labColor, deltaE2000 } from '../web/lib/colorvision.js';
import { hexToRgb, rgbToHex } from '../web/lib/colormaps.js';
import { writeFileSync } from 'node:fs';
import { SOFTWARE, allExports, buildWorkspace, recompute, scoreTable } from './roundtrip-cases.mjs';
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
      const naInFile = table.columns.filter((col) => layout.countColumns.includes(col.name)).reduce((a, col) => a + col.values.filter((v) => v === 'NA').length, 0);
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
    const lines = [order.map((j) => grb2.columns[j].name).join(','), ...rows.map((r) => order.map((j) => grb2.columns[j].values[r]).join(','))];
    const shuffled = byVariant(parseTable(`${lines.join('\n')}\n`));
    const original = byVariant(grb2);
    const differing = [...original].filter(([k, v]) => shuffled.get(k) !== v);
    check('import', 'GRB2 with rows and columns shuffled imports the same counts for every variant', `${original.size - differing.length} of ${original.size} variants the same`, !differing.length && shuffled.size === original.size, 'all');
    const parser = createTableParser();
    const text = dataset('mavedb-grb2-sh3').text('counts.csv');
    for (let i = 0; i < text.length; i += 997) parser.push(text.slice(i, i + 997));
    const parts = parser.finish();
    check('import', 'GRB2 read in parts of 997 characters (a quote or CRLF across parts) equals GRB2 read at once', `${parts.rows} rows`, JSON.stringify(parts.columns.map((x) => x.values)) === JSON.stringify(grb2.columns.map((x) => x.values)), 'identical');

    // Per-sample files: GRB2 split into one file per sample (each listing only the variants it
    // counts) and joined again.
    const files = ['input_count_rep1', 'output_count_rep1', 'input_count_rep2'].map((name) => {
      const variant = grb2.columns.find((x) => x.name === 'hgvs_pro').values;
      const values = grb2.columns.find((x) => x.name === name).values;
      const body = variant.map((v, i) => (values[i] === 'NA' ? null : `${v}\t${values[i]}`)).filter(Boolean);
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
        if (scoring !== 'ratios') continue;
        const t0 = performance.now();
        const results = score(table, caseDesign, { ...PRESETS.enrich2.parameters, normalization });
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
    for (const c of DESIGN_CASES.filter((x) => ['grb2-sh3', 'brca1-ring-e2'].includes(x.name))) {
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
      check('scoring', `BRCA1 E2 (${formatCount(results.rows)} rows × 6 replicates, MaveScape defaults, ${ms.toFixed(0)} ms): rows and columns shuffled give the same scores; warned that inputs are shared and the time series is scored by its ends`, `${differing} differences; warnings: ${codes.join(', ')}`, differing === 0 && codes.includes('shared-samples') && codes.includes('time-series-ratio'), '0; both warnings');
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
      const f9 = scoreExperiment({ ...engineInput(parseTable(dataset('mavedb-factor9').bytes('counts.csv')), readDesign('factor9.design.json')), parameters: DEFAULT_PARAMETERS });
      check('scoring', 'factor IX (FACS bins): refused, saying bins are scored from 0.2.0 (not scored some other way)', f9.ok ? 'scored' : f9.errors[0], !f9.ok && /0\.2\.0/.test(f9.errors[0]), 'refused');
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

    // The feasibility data (external): findings as found, with MaveScape's default scoring.
    const expectations = [
      ['grb2-sh3', 'mavedb-grb2-sh3', 'counts.csv', { 'excess-variance': 'fail' }, 'replicate differences vary about 11× more than counting predicts: the input bottleneck DiMSum\'s error model found in these data'],
      ['brca1-ring-e2', 'mavedb-brca1-ring', 'aa/counts.csv', { dropout: 'review', coverage: 'review', agreement: 'review', 'excess-variance': 'fail' }, 'an error-prone-PCR library (76% of single substitutions), replicates of a time series scored by its ends, and variants that dropped out in the last round written as missing (no 0 in the table)'],
      ['brca1-ring-y2h', 'mavedb-brca1-ring', 'aa/counts.csv', { coverage: 'review', agreement: 'review', 'excess-variance': 'fail', 'outlier-replicate': 'review', separation: 'fail', resolution: 'review' }, 'nonsense variants are not separated from the wild type in the Y2H assay: those before residue 61 score about −3.7, those after residue 110 about +0.5 (truncations that keep the RING domain keep binding BARD1), so most are not loss-of-function controls here'],
      ['factor9', 'mavedb-factor9', 'counts.csv', {}, 'FACS bins: counts-level findings only until bins are scored (wave 2)'],
    ];
    for (const [name, data, path, expected, note] of expectations) {
      const design = readDesign(`${name}.design.json`);
      const table = parseTable(dataset(data).bytes(path));
      const names = table.columns.find((c) => c.name === design.variants.column).values;
      const columns = {};
      for (const s of design.samples) for (const c of s.columns) columns[c] = table.columns.find((x) => x.name === c).numeric;
      const t0 = performance.now();
      const scored = scoreExperiment({ names, columns, design, parameters: DEFAULT_PARAMETERS });
      const qc = computeQC({ names, columns, design, results: scored.ok ? scored.results : null });
      const ms = performance.now() - t0;
      const got = raised(findingsFrom(qc, defaultThresholds()));
      check('qc', `${name} (scored and checked in ${ms.toFixed(0)} ms): ${note}`, show(got), matches(got, expected), show(expected));
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
      check('roundtrip', `${label}: every export again after reopening, byte for byte (${Object.keys(exports).length - 1} files: scores, counts, QC per sample and per variant, provenance, methods, references, selection, map)`, differing.length ? `differ: ${differing.join(', ')}` : 'all identical', !differing.length, 'identical');
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
      m.markdown.includes(built.ws.sources[0].sha256) && m.markdown.includes('pseudocount of 0.5') && m.markdown.includes('restricted maximum likelihood') && m.markdown.includes(built.run.output.sha256) && JSON.stringify(firstUse) === JSON.stringify(firstUse.slice().sort((a, b) => a - b)) && (m.bibtex.match(/^@/gm) ?? []).length === m.references.length, 'all');

    // The examples.
    const bundled = sources.datasets['mavedb-grb2-sh3'].files.find((f) => f.path === 'counts.csv');
    const grb2Table = parseTable(grb2Bytes);
    const grb2Result = validateDesign(grb2Design, { columns: grb2Table.columns.map((c) => c.name) });
    check('roundtrip', 'the GRB2 SH3 example: its counts are MaveDB\'s, unchanged (SHA-256 as fetched for validation), and its design fits them', `${sha256(grb2Bytes).slice(0, 16)}… against ${bundled.sha256.slice(0, 16)}…; design ${grb2Result.ok ? 'valid' : grb2Result.errors[0].message}`, sha256(grb2Bytes) === bundled.sha256 && grb2Result.ok, 'the same; valid');
    const sim = simulatedExample();
    const simAgain = simulatedExample();
    const simTable = parseTable(sim.csv);
    const simScored = scoreTable(simTable, sim.design, DEFAULT_PARAMETERS);
    const simC = simScored.results.conditions[0];
    const a = [];
    const b = [];
    simScored.results.variants.key.forEach((k, i) => { if (!simC.reason[i] && k in sim.truth && k !== 'p.=') { a.push(simC.score[i]); b.push(sim.truth[k]); } });
    const simQc = findingsFrom(computeQC({ names: simTable.columns[0].values, columns: Object.fromEntries(simTable.columns.slice(1).map((c) => [c.name, c.numeric])), design: sim.design, results: simScored.results }), defaultThresholds());
    const raisedSim = simQc.filter((f) => f.status === 'review' || f.status === 'fail').map((f) => f.id);
    check('roundtrip', 'the simulated example: the same data from its seed, labeled simulated, its scores close to the true effects, and every QC finding passes', `${sim.csv === simAgain.csv ? 'deterministic' : 'not deterministic'}; Pearson r ${pearson(a, b).toFixed(3)} over ${a.length} variants; QC ${raisedSim.length ? raisedSim.join(', ') : 'all pass'}`, sim.csv === simAgain.csv && /simulated/i.test(sim.design.name) && /not real data/.test(sim.design.description) && pearson(a, b) > 0.98 && !raisedSim.length, 'r > 0.98; all pass');
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
