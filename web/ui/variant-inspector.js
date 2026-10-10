// The inspector's account of one variant (requirement V4): its identifiers (as written and
// canonical), its score with SE and 95% interval or why it has none, its flags, the counts of
// every sample, each replicate's score and whether it was used (for a regression on time, its time
// course in each replicate with the fitted line), the sequence around it, where it falls among the
// substitutions at its position, and the run it comes from; for a table of barcodes, each of its
// barcodes in each replicate (counts, score, departure from the others, outliers); with conditions
// compared, its score in each and each difference (with the pairs of replicates behind it). Focus:
// { kind: 'variant', id: MAVE-HGVS key, run, condition }.

import { h, icon } from './dom.js';
import { KIND_NAMES } from '../lib/variants.js';
import { flagNames, REPLICATE_STATE_NAMES, STAGE_BY_CODE } from '../lib/filters.js';
import { describeParameters, isBarcodeRun, unitOf } from '../lib/runs.js';
import { DIFFERENTIAL_REASON_NAMES, pairDifference, transformOf } from '../lib/differential.js';
import { withDefaults } from '../lib/score.js';
import { intervalOf } from '../lib/exports.js';
import { anchorUncertainty } from '../lib/anchors.js';
import { timeCourse } from '../lib/score-regression.js';
import { categoricalColor } from '../lib/colormaps.js';
import { ensureResults, runEntry } from './run-results.js';
import { cssVar, legend, lineChart } from './plots.js';

const fmt = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : '—');
const ONE = { Ala: 'A', Arg: 'R', Asn: 'N', Asp: 'D', Cys: 'C', Gln: 'Q', Glu: 'E', Gly: 'G', His: 'H', Ile: 'I', Leu: 'L', Lys: 'K', Met: 'M', Phe: 'F', Pro: 'P', Ser: 'S', Thr: 'T', Trp: 'W', Tyr: 'Y', Val: 'V', Ter: '*' };

function proteinOf(target) {
  if (target.sequenceType === 'protein') return target.sequence.toUpperCase();
  const order = 'TCAG';
  const aas = 'FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG';
  const codons = {};
  let k = 0;
  for (const a of order) for (const b of order) for (const c of order) codons[a + b + c] = aas[k++];
  const dna = target.sequence.toUpperCase().slice((target.codingStart ?? 1) - 1);
  let out = '';
  for (let i = 0; i + 3 <= dna.length; i += 3) out += codons[dna.slice(i, i + 3)] ?? 'X';
  return out;
}

// The scores of every substitution at a position, as dots on a line, this one ringed.
function positionStrip(results, c, row, position, key) {
  const v = results.variants;
  const points = [];
  for (let i = 0; i < results.rows; i += 1) {
    if (v.position[i] !== position || c.reason[i] || !Number.isFinite(c.score[i]) || v.key[i].includes('[')) continue;
    points.push([c.score[i], v.key[i], i === row]);
  }
  const all = [];
  for (let i = 0; i < results.rows; i += 1) if (!c.reason[i] && Number.isFinite(c.score[i])) all.push(c.score[i]);
  if (!points.length || all.length < 2) return null;
  all.sort((a, b) => a - b);
  const lo = all[Math.floor(all.length * 0.01)];
  const hi = all[Math.ceil(all.length * 0.99) - 1];
  const W = 280;
  const H = 46;
  const X = (s) => 8 + ((Math.max(lo, Math.min(hi, s)) - lo) / (hi - lo || 1)) * (W - 16);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'position-strip');
  svg.setAttribute('role', 'img');
  const mine = points.find((p) => p[2]);
  svg.setAttribute('aria-label', `The ${points.length} scored variants at position ${position}, from ${fmt(Math.min(...points.map((p) => p[0])), 2)} to ${fmt(Math.max(...points.map((p) => p[0])), 2)}${mine ? `; this one ${fmt(mine[0], 2)}` : ''}.`);
  const add = (name, attrs, text) => {
    const el = document.createElementNS(ns, name);
    for (const [k, val] of Object.entries(attrs)) el.setAttribute(k, val);
    if (text) el.textContent = text;
    svg.append(el);
    return el;
  };
  add('line', { x1: 8, x2: W - 8, y1: 22, y2: 22, class: 'axis' });
  const wt = results.controls.wt >= 0 && !c.reason[results.controls.wt] ? c.score[results.controls.wt] : null;
  if (wt !== null) add('line', { x1: X(wt), x2: X(wt), y1: 12, y2: 32, class: 'wt-mark' });
  for (const [s, k, me] of points) {
    const dot = add('circle', { cx: X(s), cy: 22, r: me ? 5 : 3, class: me ? 'me' : 'other' });
    const title = document.createElementNS(ns, 'title');
    title.textContent = `${k}: ${fmt(s, 2)}`;
    dot.append(title);
  }
  add('text', { x: 8, y: 44, class: 'tick' }, fmt(lo, 1));
  add('text', { x: W - 8, y: 44, class: 'tick', 'text-anchor': 'end' }, fmt(hi, 1));
  return h('div', svg, h('p.muted', { style: { fontSize: '11px', margin: '2px 0 0' } }, `${points.length} scored at position ${position} (dots), on the run's 1st–99th percentile range${wt !== null ? '; the line is the wild type' : ''}.`));
}

// A table of barcodes: the variant's barcodes in each replicate that counts them, with their counts
// (before and after; in each bin), score ± SE, departure from the variant's other barcodes (z/√φ)
// and whether each is an outlier or left out.
// Between conditions: the variant's score in each condition, and each contrast's difference with
// its interval and adjusted p; paired, each pair's difference (the shared input cancelled).
function differentialBlock(results, row, run) {
  const p = withDefaults(run.inputs.parameters);
  const design = run.inputs.design;
  const reference = (design.conditions ?? []).find((c) => c.reference)?.id ?? design.conditions?.[0]?.id;
  const q = (x) => (x < 0.001 ? x.toExponential(1) : x.toFixed(3));
  const out = [h('h4.inspector-sub', 'Between conditions'),
    h('table.data.compact', h('thead', h('tr', h('th', 'Condition'), h('th.r', 'Score'), h('th.r', 'Replicates'))),
      h('tbody', ...results.conditions.map((c) => h('tr', h('td', c.id === reference ? `${c.name} (reference)` : c.name), h('td.r', c.reason[row] ? 'not scored' : `${fmt(c.score[row], 2)} ± ${fmt(c.se[row], 2)}`), h('td.r', String(c.k[row]))))))];
  for (const d of results.differential) {
    if (d.reason[row]) {
      out.push(h('p.muted', { style: { fontSize: '12px', margin: '6px 0' } }, `${d.name}: no difference estimated (${DIFFERENTIAL_REASON_NAMES[d.reason[row]]}).`));
      continue;
    }
    out.push(h('div.variant-score', { style: { marginTop: '8px' } }, h('span.variant-score-value', fmt(d.delta[row])), h('span.muted', ` ± ${fmt(d.se[row])} SE · 95% CI ${fmt(d.ciLow[row], 2)} to ${fmt(d.ciHigh[row], 2)} · q ${q(d.q[row])}`)),
      h('p.muted', { style: { fontSize: '11.5px', margin: '0 0 6px' } }, `${d.name}: ${d.method === 'limma' ? `limma's moderated t = ${fmt(d.z[row], 2)} on ${fmt(d.df, 1)} degrees of freedom, from every sample's counts relative to the ${p.normalization === 'wt' ? 'wild type' : 'synonymous variants'}` : d.method === 'paired' ? `the differences of ${d.k[row]} pair${d.k[row] === 1 ? '' : 's'} of replicates sharing an input, combined` : 'the two conditions\' scores as independent (Enrich2\'s z)'}.`));
    if (d.method === 'paired') {
      const A = results.conditions.find((c) => c.id === d.reference);
      const B = results.conditions.find((c) => c.id === d.condition);
      const terms = { tA: transformOf(A), tB: transformOf(B), pseudocount: p.pseudocount, normalization: p.normalization };
      const byId = new Map(results.replicates.map((r) => [r.id, r]));
      out.push(h('table.data.compact', h('thead', h('tr', h('th', 'Pair'), h('th.r', 'Difference'))),
        h('tbody', ...d.pairs.map(([a, b]) => {
          const t = pairDifference(byId.get(a), byId.get(b), row, terms);
          return h('tr', h('td', `${byId.get(b).name} · ${byId.get(a).name}`), h('td.r', t ? `${fmt(t.d, 2)} ± ${fmt(Math.sqrt(t.v), 2)}` : 'not measured in both'));
        }))));
    }
  }
  return out;
}

function barcodesBlock(results, reps, row, binned) {
  const b = results.barcodes;
  const members = Array.from(b.members.subarray(b.offsets[row], b.offsets[row + 1]));
  const counts = new Map((results.samples ?? []).map((x) => [x.id, x.barcodeCounts]));
  const blocks = [];
  const LIMIT = 40;
  for (const r of reps) {
    const rb = r.barcodes;
    const here = members.filter((m) => r.samples.some((id) => Number.isFinite(counts.get(id)?.[m])));
    if (!here.length) continue;
    const shown = here.slice(0, LIMIT);
    const status = (m) => (!rb.state ? '' : rb.outlier?.[m] ? (rb.excluded ? 'left out' : 'outlier') : rb.state[m] ? 'no' : 'yes');
    const why = (m) => (!rb.state ? '' : rb.outlier?.[m] ? `An outlier: departs from the variant's other barcodes by more than ${rb.limit} (z/√φ)${rb.excluded ? '; left out by the barcode filter' : ''}` : rb.state[m] ? REPLICATE_STATE_NAMES[rb.state[m]] : 'used');
    const id = (m) => h('td.mono.barcode-id', { title: results.barcodes.ids[m] }, results.barcodes.ids[m]);
    const head = binned ? [h('th', 'Barcode'), h('th.r', 'Reads by bin')] : [h('th', 'Barcode'), h('th.r', { title: 'Reads before → after selection' }, 'Reads'), h('th.r', 'Score ± SE'), h('th.r', h('abbr', { title: 'Departure from the variant\'s other barcodes, z/√φ' }, 'z')), h('th', 'Used')];
    const line = (m) => (binned
      ? [id(m), h('td.r.mono', r.samples.map((x) => fmt(counts.get(x)?.[m], 0)).join(' · '))]
      : [id(m), h('td.r', `${fmt(counts.get(r.samples[0])?.[m], 0)} → ${fmt(counts.get(r.samples.at(-1))?.[m], 0)}`), h('td.r', Number.isFinite(rb.score?.[m]) ? `${fmt(rb.score[m], 2)} ± ${fmt(rb.se[m], 2)}` : '—'), h('td.r', fmt(rb.z?.[m], 1)), h('td', { title: why(m) }, rb.outlier?.[m] ? h('span.badge.warn', status(m)) : status(m))]);
    blocks.push(h('div.barcode-block',
      h('div.muted', { style: { fontSize: '11.5px', margin: '6px 0 2px' } }, `${r.name}: ${here.length} barcode${here.length > 1 ? 's' : ''}${rb.measured ? `, ${rb.measured[row]} measured` : ''}${Number.isFinite(rb.phi) ? `; the replicate's barcodes disagree ${fmt(rb.phi, 2)}× as counting explains (φ)` : ''}${Number.isFinite(rb.tau2?.[row]) ? `; τ² between them ${fmt(rb.tau2[row], 4)}` : ''}`),
      h('table.data.compact.barcode-table', h('thead', h('tr', ...head)), h('tbody', ...shown.map((m) => h('tr', ...line(m))))),
      here.length > LIMIT ? h('p.muted', { style: { fontSize: '11px', margin: '2px 0 0' } }, `…and ${here.length - LIMIT} more (all are in the barcode export).`) : null));
  }
  if (!blocks.length) return null;
  return h('details.inspector-details', { open: members.length <= 30 }, h('summary', `Barcodes (${members.length})`), ...blocks);
}

export function variantSection(app, focus) {
  const run = app.store.ws.runs.find((r) => r.id === focus.run);
  if (!run) return null;
  const entry = runEntry(app, run);
  if (!entry?.results) {
    if (!entry) ensureResults(app, run);
    return h('section.inspector-section', h('h3', icon('score'), focus.id), h('p.muted', entry?.status === 'failed' ? entry.message : 'Recomputing the run\'s scores…'));
  }
  const results = entry.results;
  const c = results.conditions[focus.condition ?? 0];
  const v = results.variants;
  const row = v.key.indexOf(focus.id);
  const design = run.inputs.design;
  const target = design.targets?.[0];
  const offset = target?.offset ?? 0;
  const match = /^p\.([A-Z][a-z]{2})(\d+)/.exec(focus.id);
  const position = row >= 0 ? v.position[row] : match ? Number(match[2]) : -1;
  const parts = [];
  parts.push(h('h3', icon('target'), h('span.mono', focus.id)));
  if (row < 0) {
    parts.push(h('p', { style: { margin: '0 0 8px', fontSize: '12.5px' } }, 'Not in the table: this substitution was not measured (missing on the map, not "no effect").'));
  } else {
    const kv = [
      ['As written', v.original[row]],
      ['Class', KIND_NAMES[v.kind[row]]],
      ['Position', position > 0 ? `${position}${offset ? ` (reference ${position + offset})` : ''}` : '—'],
    ];
    if (results.conditions.length > 1) kv.push(['Condition', c.name]);
    parts.push(h('dl.kv', ...kv.flatMap(([k, val]) => [h('dt', k), h('dd', { title: String(val) }, String(val))])));
    if (c.reason[row]) {
      const stage = STAGE_BY_CODE.get(c.reason[row]);
      parts.push(h(`div.callout.${stage.id === 'measured' ? 'accent' : 'warn'}`, { style: { margin: '8px 0', fontSize: '12px' } }, stage.id === 'measured' ? `Not measured: ${stage.reason}. Its score is NA.` : `Filtered at "${stage.label}": ${stage.reason}. Its score is NA; its measurements are below.`));
    } else {
      const [lo, hi] = intervalOf(c, row);
      const scale = anchorUncertainty(results, run.inputs.design, focus.condition ?? 0);
      parts.push(h('div.variant-score', h('span.variant-score-value', fmt(c.score[row])), h('span.muted', ` ± ${fmt(c.se[row])} SE · 95% CI ${fmt(lo, 2)} to ${fmt(hi, 2)}${c.df && Number.isFinite(c.df[row]) ? ` (t, ${Number(c.df[row].toFixed(1))} df)` : ''}`)),
        scale ? h('p.muted', { style: { fontSize: '11.5px', margin: '0 0 4px' } }, `The rescaling anchors add ±${fmt(scale.at(c.score[row]), 3)} shared by every score (SE_scale): needed against another assay or the anchors' true values, not between variants of this run.`) : null,
        h('p.muted', { style: { fontSize: '11.5px', margin: '0 0 6px' } }, `From ${c.k[row]} of ${c.expected[row]} replicates${Number.isFinite(c.tau2[row]) ? `; τ² ${fmt(c.tau2[row], 4)}, I² ${Math.round(c.i2[row] * 100)}%` : ''}${Number.isFinite(c.loo[row]) ? `; leaving one replicate out moves it by up to ${fmt(c.loo[row])}` : ''}.`));
      if (c.flags[row]) parts.push(h('div.callout.accent', { style: { margin: '0 0 8px', fontSize: '12px' } }, `Low confidence: ${flagNames(c.flags[row]).join('; ')}.`));
    }
    // Replicates.
    const reps = results.replicates.filter((r) => c.replicates.includes(r.id));
    const sampleCounts = new Map((results.samples ?? []).map((x) => [x.id, x.counts]));
    if (reps.some((r) => r.bins)) {
      // Sorted bins: each replicate's reads in each bin, and the variant's distribution over the bins
      // (its frequency in each bin over its summed frequency) beside the wild type's.
      parts.push(h('h4.inspector-sub', 'Replicates'), h('table.data.compact', h('thead', h('tr', h('th', 'Replicate'), h('th.r', 'Reads by bin'), h('th.r', 'Score'), h('th', 'Used'))),
        h('tbody', ...reps.map((r) => h('tr', h('td', r.name), h('td.r.mono', r.samples.map((id) => fmt(sampleCounts.get(id)?.[row], 0)).join(' · ')), h('td.r', Number.isFinite(r.score[row]) ? `${fmt(r.score[row], 2)} ± ${fmt(r.se[row], 2)}` : '—'), h('td', r.state[row] ? REPLICATE_STATE_NAMES[r.state[row]] : 'yes'))))));
      const share = (r, i) => {
        const f = r.samples.map((id, b) => (sampleCounts.get(id)?.[i] ?? Number.NaN) / r.normalizers[b]);
        const total = f.reduce((a, x) => a + x, 0);
        return f.map((x, b) => [b + 1, total > 0 ? x / total : Number.NaN]);
      };
      const series = [];
      const items = [];
      reps.forEach((r, k) => {
        const color = categoricalColor(k);
        series.push({ points: share(r, row), color, markers: true, width: 1.5 });
        items.push({ color, label: r.name });
      });
      const wt = results.controls?.wt ?? -1;
      if (wt >= 0 && wt !== row) {
        series.push({ points: share(reps[0], wt), color: cssVar('--text-3'), dash: true, width: 1.5 });
        items.push({ color: cssVar('--text-3'), label: `the wild type (${reps[0].name})`, dash: true });
      }
      parts.push(h('h4.inspector-sub', 'Distribution over the bins'),
        lineChart({ series, xLabel: 'bin', yLabel: 'share of the variant', label: `${focus.id}: its share in each bin, by replicate, with the wild type's`, width: 300, height: 160 }),
        legend(items),
        h('p.muted', { style: { fontSize: '11px', margin: '4px 0 0' } }, `Each bin's share of the variant: its reads there over the bin's reads, as a fraction of their sum.${reps[0].bins?.sigma ? ` The maximum-likelihood fit shares the wild type's spread σ = ${fmt(reps[0].bins.sigma, 2)} (log fluorescence).` : ''}`));
    } else {
      parts.push(h('h4.inspector-sub', 'Replicates'), h('table.data.compact', h('thead', h('tr', h('th', 'Replicate'), h('th.r', 'Before'), h('th.r', 'After'), h('th.r', 'Score'), h('th', 'Used'))),
        h('tbody', ...reps.map((r) => h('tr', h('td', r.name), h('td.r', fmt(r.first[row], 0)), h('td.r', fmt(r.last[row], 0)), h('td.r', Number.isFinite(r.score[row]) ? `${fmt(r.score[row], 2)} ± ${fmt(r.se[row], 2)}` : '—'), h('td', r.state[row] ? REPLICATE_STATE_NAMES[r.state[row]] : 'yes'))))));
    }
    if (results.barcodes) {
      const block = barcodesBlock(results, reps, row, reps.some((r) => r.bins));
      if (block) parts.push(block);
    }
    // A regression's time courses: the normalized log counts at each time, and the fitted lines.
    const p = run.inputs.parameters;
    if (p.model === 'wls' || p.model === 'ols') {
      const counts = new Map((results.samples ?? []).map((x) => [x.id, x.counts]));
      const series = [];
      const items = [];
      reps.forEach((r, k) => {
        const color = categoricalColor(k);
        const course = timeCourse(r.samples.map((id) => counts.get(id)?.[row] ?? Number.NaN), r.times, r.normalizers, { weighted: p.model === 'wls', pseudocount: p.pseudocount, method: p.normalization, perUnit: p.timeScale === 'unit' });
        series.push({ points: course.points, color, markers: true, width: 0 });
        if (course.line.length && !r.state[row]) series.push({ points: course.line, color, dash: true, width: 1.5 });
        items.push([color, `${r.name}: ${r.state[row] ? REPLICATE_STATE_NAMES[r.state[row]] : `slope ${fmt(course.slope, 2)}, ${r.points?.[row] ?? '—'} points, departure ${fmt(course.fit, 1)}×`}`]);
      });
      const unit = run.inputs.design.time?.unit;
      parts.push(h('h4.inspector-sub', 'Time course'),
        lineChart({ series, xLabel: `time${unit && unit !== 'other' ? ` (${unit}s)` : ''}`, yLabel: 'normalized ln count', label: `${focus.id}: its normalized log count at each time in each replicate, with the fitted lines`, width: 300, height: 170 }),
        legend(items.map(([color, label]) => ({ color, label }))),
        h('p.muted', { style: { fontSize: '11px', margin: '4px 0 0' } }, `Points: ln(count + pseudocount) − ln(normalizer) at each time; dashed: the fitted line, whose slope ${p.timeScale === 'unit' ? `per ${unitOf(run.inputs.design)}` : 'on time scaled to 0–1'} is the replicate's score. Departure: scatter about the line over what counting predicts (1 is typical).`));
    }
    if (results.differential?.length) parts.push(...differentialBlock(results, row, run));
    // Every sample's counts.
    if (results.samples?.length) {
      parts.push(h('details.inspector-details', h('summary', `Counts in all ${results.samples.length} samples`),
        h('table.data.compact', h('tbody', ...results.samples.map((s) => h('tr', h('td', s.name), h('td.r', Number.isFinite(s.counts[row]) ? String(s.counts[row]) : 'missing')))))));
    }
    const strip = position > 0 ? positionStrip(results, c, row, position, focus.id) : null;
    if (strip) parts.push(h('h4.inspector-sub', `Position ${position}`), strip);
  }
  // Sequence context.
  if (target && position > 0) {
    const protein = proteinOf(target);
    const from = Math.max(1, position - 8);
    const to = Math.min(protein.length, position + 8);
    parts.push(h('h4.inspector-sub', 'Sequence'), h('p.mono.sequence-context', { 'aria-label': `Residues ${from} to ${to} of ${target.name}; position ${position} is ${protein[position - 1]}` },
      h('span.muted', `${from + offset} `), protein.slice(from - 1, position - 1), h('b.here', protein[position - 1]), protein.slice(position, to), h('span.muted', ` ${to + offset}`)));
    if (match && ONE[match[1]] && ONE[match[1]] !== protein[position - 1]) parts.push(h('div.callout.warn', { style: { fontSize: '12px' } }, `The name says ${match[1]} at ${position}; the target has ${protein[position - 1]}.`));
  }
  // The run.
  parts.push(h('h4.inspector-sub', 'From'), h('p', { style: { fontSize: '12px', margin: 0 } }, `${run.name} (${run.id}): ${describeParameters(run.inputs.parameters, isBarcodeRun(run))}. Output SHA-256 ${run.output.sha256.slice(0, 12)}…; ${entry.status === 'reproduced' ? 'reproduced from its inputs' : entry.status === 'computed' ? 'computed in this session' : entry.status}.`));
  return h('section.inspector-section.variant-inspector', ...parts);
}

