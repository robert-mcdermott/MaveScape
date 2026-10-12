// The inspector's account of one position of a run's target (wave 5, slice 3; requirement X3), as a
// residue picked on the structure, or a position of the strip below it, puts it in focus: its
// substitutions' scores (each one, their spread, how many were scored, filtered or missing, their
// median, mean, lowest, highest and median SE), and where it is on the structure shown (its residue
// on each chain that holds the target, or why none; an AlphaFold DB model's confidence). Focus:
// { kind: 'position', run, condition, position }.

import { h, icon, formatCount } from './dom.js';
import { positionStrip } from './variant-inspector.js';
import { ensureResults, runEntry } from './run-results.js';
import { proteinView } from '../lib/collapse.js';
import { buildMapModel, cellAt, cellName, STATE, STATE_NAMES } from '../lib/map-model.js';
import { median } from '../lib/stats.js';
import { residueLabel } from '../lib/structures.js';
import { STATE_WORDS } from '../lib/mapping.js';
import { possessive } from '../lib/words.js';

const fmt = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '—');
const THREE = { A: 'Ala', R: 'Arg', N: 'Asn', D: 'Asp', C: 'Cys', Q: 'Gln', E: 'Glu', G: 'Gly', H: 'His', I: 'Ile', L: 'Leu', K: 'Lys', M: 'Met', F: 'Phe', P: 'Pro', S: 'Ser', T: 'Thr', W: 'Trp', Y: 'Tyr', V: 'Val', '*': 'Ter' };

// The position's cells on the run's map: [{ alt, name, state, score, se, k }], the reference cell
// first, then the substitutions in the map's order.
function cellsOf(model, position) {
  const R = model.rows.length;
  const out = [];
  for (let r = 0; r < R; r += 1) {
    const cell = cellAt(model, position, r);
    if (cell.state === STATE.NOT_DESIGNED) continue;
    const i = cell.index;
    const scored = cell.state === STATE.SCORED || cell.state === STATE.LOW || (cell.reference && i >= 0 && !model.source.reason[i]);
    out.push({ alt: cell.alt, reference: cell.reference, name: cellName(model, cell), state: cell.state, score: scored ? model.source.score[i] : Number.NaN, se: scored ? model.source.se?.[i] : Number.NaN });
  }
  return out.sort((a, b) => b.reference - a.reference);
}

export function positionSection(app, focus) {
  const run = app.store.ws.runs.find((r) => r.id === focus.run);
  if (!run) return null;
  const entry = runEntry(app, run);
  if (!entry?.results) {
    if (!entry) ensureResults(app, run);
    return h('section.inspector-section', h('h3', icon('target'), `Position ${focus.position}`), h('p.muted', entry?.status === 'failed' ? `${possessive(run.name)} scores could not be recomputed: ${entry.message}` : `Recomputing ${possessive(run.name)} scores…`));
  }
  const own = entry.results;
  const results = proteinView(own) ?? own;
  const condition = Math.min(focus.condition ?? 0, results.conditions.length - 1);
  let model;
  try {
    model = buildMapModel(results, run.inputs.design, { condition });
  } catch {
    return null;
  }
  const p = focus.position;
  if (!(p >= 1 && p <= model.length)) return null;
  const offset = model.target.offset ?? 0;
  const residue = model.protein[p - 1];
  const cells = cellsOf(model, p);
  const missense = cells.filter((x) => !x.reference && x.alt !== '*');
  const scored = missense.filter((x) => x.state === STATE.SCORED || x.state === STATE.LOW);
  const scores = scored.map((x) => x.score);
  const ses = scored.map((x) => x.se).filter(Number.isFinite);
  const count = (state) => missense.filter((x) => x.state === state).length;
  const stop = cells.find((x) => x.alt === '*' && !x.reference);
  const synonymous = cells.find((x) => x.reference);
  const c = results.conditions[condition];
  const kv = h('dl.kv',
    h('dt', 'Run'), h('dd', `${run.name}${results.conditions.length > 1 ? ` (${c.name})` : ''}`),
    h('dt', 'Missense'), h('dd', missense.length ? `${formatCount(scored.length)} of ${formatCount(missense.length)} scored${count(STATE.LOW) ? `, ${formatCount(count(STATE.LOW))} with low confidence` : ''}${count(STATE.FILTERED) ? `; ${formatCount(count(STATE.FILTERED))} filtered` : ''}${count(STATE.MISSING) ? `; ${formatCount(count(STATE.MISSING))} missing` : ''}` : 'none designed'),
    scores.length ? [h('dt', 'Median'), h('dd', `${fmt(median(scores))} (mean ${fmt(scores.reduce((a, b) => a + b, 0) / scores.length)}; ${fmt(Math.min(...scores))} to ${fmt(Math.max(...scores))})`)] : null,
    ses.length ? [h('dt', 'Median SE'), h('dd', fmt(median(ses)))] : null,
    stop ? [h('dt', 'Stop'), h('dd', Number.isFinite(stop.score) ? `${fmt(stop.score)} ± ${fmt(stop.se)}` : STATE_NAMES[stop.state])] : null,
    synonymous && Number.isFinite(synonymous.score) ? [h('dt', 'Synonymous'), h('dd', `${fmt(synonymous.score)} ± ${fmt(synonymous.se)}`)] : null);
  // Where it is on the structure shown.
  const structure = app.structureState;
  const onStructure = [];
  if (structure?.viewer?.structure && structure.mapping && structure.mapTarget) {
    const target = structure.mapTarget;
    const q = p + offset - (target.offset ?? 0);
    const code = structure.viewer.structure.meta.code || structure.viewer.structure.label;
    if (q >= 1 && q <= target.length && target.sequence[q - 1] === residue) {
      for (const m of structure.maps) {
        const at = m.positions[q - 1];
        const r = at?.residue ? structure.viewer.model.residueMap.get(at.residue) : null;
        const confidence = r && structure.viewer.structure.meta.isPredicted && Number.isFinite(r.confidence) ? `, pLDDT ${r.confidence.toFixed(1)}` : '';
        onStructure.push(r ? `${code} ${residueLabel(r)}${at.state === 'different' ? ` (another residue${at.reason ? `: ${at.reason}` : ''})` : ''}${confidence}` : `${code} chain ${m.chain}: ${STATE_WORDS[at?.state] ?? 'not on it'}`);
      }
    } else onStructure.push(`${code}: not this position (the structure maps another target)`);
  }
  const table = h('table.data.compact', h('thead', h('tr', h('th', 'Variant'), h('th.r', 'Score'), h('th.r', 'SE'), h('th', 'State'))),
    h('tbody', ...cells.map((x) => h('tr', { style: { cursor: 'pointer' }, title: 'Inspect this variant', onclick: () => app.focusItem({ kind: 'variant', id: x.name, run: run.id, condition }) },
      h('td.mono', x.name), h('td.r', fmt(x.score)), h('td.r', fmt(x.se)), h('td', x.reference ? 'synonymous' : STATE_NAMES[x.state])))));
  const keys = cells.map((x) => x.name);
  return h('section.inspector-section',
    h('h3', icon('target'), `Position ${p} · ${THREE[residue] ?? residue}`, offset ? h('span.muted', ` (${p + offset} in the reference)`) : null),
    kv,
    positionStrip(results, c, -1, p, null),
    onStructure.length ? h('div', h('h4.inspector-sub', 'On the structure'), ...onStructure.map((line) => h('p.muted', { style: { fontSize: '12px', margin: '2px 0' } }, line))) : null,
    h('details.inspector-details', h('summary', `Its ${formatCount(cells.length)} variants`), table),
    h('div.btn-row', { style: { marginTop: '8px' } },
      h('button.btn.small', { type: 'button', onclick: () => { app.store.setUI({ selection: keys.length ? { run: run.id, condition, keys, query: `at ${p}` } : null }, ['selection']); app.setMode('map'); } }, icon('heatmap'), 'Select on the map'),
      structure?.viewer?.structure ? h('button.btn.small', { type: 'button', onclick: () => app.setMode('structure') }, icon('structure'), 'Show on the structure') : null));
}
