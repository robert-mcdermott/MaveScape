// The inspector's account of one variant (requirement V4): its identifiers (as written and
// canonical), its score with SE and 95% interval or why it has none, its flags, the counts of
// every sample, each replicate's score and whether it was used, the sequence around it, where it
// falls among the substitutions at its position, and the run it comes from. Focus:
// { kind: 'variant', id: MAVE-HGVS key, run, condition }.

import { h, icon } from './dom.js';
import { KIND_NAMES } from '../lib/variants.js';
import { flagNames, REPLICATE_STATE_NAMES, STAGE_BY_CODE } from '../lib/filters.js';
import { describeParameters } from '../lib/runs.js';
import { ensureResults, runEntry } from './run-results.js';

const fmt = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : '—');
const Z = 1.959963984540054;
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
      parts.push(h(`div.callout.${stage.id === 'measured' ? 'accent' : 'warn'}`, { style: { margin: '8px 0', fontSize: '12px' } }, stage.id === 'measured' ? 'Not measured: not counted in every sample of any replicate. Its score is NA.' : `Filtered at "${stage.label}": ${stage.reason}. Its score is NA; its measurements are below.`));
    } else {
      const lo = c.score[row] - Z * c.se[row];
      const hi = c.score[row] + Z * c.se[row];
      parts.push(h('div.variant-score', h('span.variant-score-value', fmt(c.score[row])), h('span.muted', ` ± ${fmt(c.se[row])} SE · 95% CI ${fmt(lo, 2)} to ${fmt(hi, 2)}`)),
        h('p.muted', { style: { fontSize: '11.5px', margin: '0 0 6px' } }, `From ${c.k[row]} of ${c.expected[row]} replicates${Number.isFinite(c.tau2[row]) ? `; τ² ${fmt(c.tau2[row], 4)}, I² ${Math.round(c.i2[row] * 100)}%` : ''}${Number.isFinite(c.loo[row]) ? `; leaving one replicate out moves it by up to ${fmt(c.loo[row])}` : ''}.`));
      if (c.flags[row]) parts.push(h('div.callout.accent', { style: { margin: '0 0 8px', fontSize: '12px' } }, `Low confidence: ${flagNames(c.flags[row]).join('; ')}.`));
    }
    // Replicates.
    const reps = results.replicates.filter((r) => c.replicates.includes(r.id));
    parts.push(h('h4.inspector-sub', 'Replicates'), h('table.data.compact', h('thead', h('tr', h('th', 'Replicate'), h('th.r', 'Before'), h('th.r', 'After'), h('th.r', 'Score'), h('th', 'Used'))),
      h('tbody', ...reps.map((r) => h('tr', h('td', r.name), h('td.r', fmt(r.first[row], 0)), h('td.r', fmt(r.last[row], 0)), h('td.r', Number.isFinite(r.score[row]) ? `${fmt(r.score[row], 2)} ± ${fmt(r.se[row], 2)}` : '—'), h('td', r.state[row] ? REPLICATE_STATE_NAMES[r.state[row]] : 'yes'))))));
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
  parts.push(h('h4.inspector-sub', 'From'), h('p', { style: { fontSize: '12px', margin: 0 } }, `${run.name} (${run.id}): ${describeParameters(run.inputs.parameters)}. Output SHA-256 ${run.output.sha256.slice(0, 12)}…; ${entry.status === 'reproduced' ? 'reproduced from its inputs' : entry.status === 'computed' ? 'computed in this session' : entry.status}.`));
  return h('section.inspector-section.variant-inspector', ...parts);
}

