// MaveScape's validation suite. Unit tests (web/lib/*.test.mjs) check functions in isolation; this
// suite runs whole pipelines on fixtures and published data whose answers are known (committed
// outputs of the reference tools, validation/reference/), and reports how closely MaveScape
// agrees, against stated tolerances (mavescape-spec/requirements.md, T1–T2).
//
//   node validation/run.mjs [suite …] [--verbose] [--require-data]
//
// Suites: accessibility, designs (external data), enrich2 (external data); all by default. Exits
// with status 1 when a check fails.
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
import { VISIONS, lab as labOf, paletteReport, simulate } from '../web/lib/colorvision.js';
import { CATEGORICAL, CATEGORICAL_CVD, colormapColor } from '../web/lib/colormaps.js';

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
  return { text: (path) => readFileSync(join(root, path), 'utf8') };
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
