// What a figure's panels show, gathered from the workspace (moved from web/ui/figure-data.js in
// wave 6, slice 6, so that the window and the certificate, lib/certificate.js, draw a panel from
// the same code): a map panel's run, its map model and the tracks it names; a QC finding's charts;
// a run's scores, a comparison's or a variant's plots; a saved structure view's image. Each panel's
// data comes from a context that has the runs' scores, QC, comparisons, tracks and images: the
// window's (computed in its workers, kept for the session) or the certificate's (computed from
// the files).
//
// ctx: {
//   ws,
//   results(run) → { results, message? } (the run's own scores, or none and why),
//   qc(inputs) → { qc } or { message } (inputs: lib/qc-subjects.js's qcInputsOf),
//   comparison(pair, filters, level, scale) → compareSides's result with its sides, or { error },
//   tracks(run, model) → the run's tracks (unarranged),
//   image(sha256) → { image: { width, height, rgba?, png }, metadata } or null,
// }

import { buildMapModel } from './map-model.js';
import { proteinView } from './collapse.js';
import { arrangeTracks } from './tracks.js';
import { findingsFrom, withDefaultThresholds } from './findings.js';
import { qcPanelData } from './qc-plots.js';
import { comparisonCharts, scoreCharts, variantCharts } from './view-plots.js';
import { comparisonMapModels } from './compare-pair.js';
import { NO_FILTERS } from './compare.js';
import { qcInputsOf, qcSubjects } from './qc-subjects.js';
import { PANEL_KEYWORD, pngTexts } from './structure-record.js';
import { possessive } from './words.js';

const notRecomputed = (run, got) => ({ missing: `${possessive(run.name)} scores could not be recomputed${got?.message ? `: ${got.message}` : '.'}` });

// A map panel's data: { model, results, tracks, run } or { missing: why it cannot be drawn }.
async function mapData(ctx, panel) {
  const run = ctx.ws.runs.find((r) => r.id === panel.run);
  if (!run) return { missing: `The run ${panel.run} is no longer in the workspace.` };
  const got = await ctx.results(run);
  if (!got?.results) return notRecomputed(run, got);
  const results = proteinView(got.results) ?? got.results;
  const contrast = Number.isInteger(panel.contrast) ? panel.contrast : null;
  if (contrast !== null && !(results.differential?.length > contrast)) return { missing: `${run.name} has no difference between conditions to draw.` };
  let model;
  try {
    model = buildMapModel(results, run.inputs.design, contrast !== null ? { contrast, colorBy: 'differential', rowOrder: panel.rowOrder } : { condition: Math.min(panel.condition ?? 0, results.conditions.length - 1), colorBy: panel.colorBy, rowOrder: panel.rowOrder });
  } catch (error) {
    return { missing: error.message };
  }
  let tracks = [];
  if (panel.tracks?.length) {
    const byId = new Map(arrangeTracks(await ctx.tracks(run, model), ctx.ws.tracks).map((t) => [t.id, t]));
    tracks = panel.tracks.map((id) => byId.get(id)).filter(Boolean);
  }
  return { run, model, results, tracks };
}

// A run's results by its id: { run, own (its results), results (a nucleotide run's protein view
// where it has one) } or { missing }.
async function runResults(ctx, id) {
  const run = ctx.ws.runs.find((r) => r.id === id);
  if (!run) return { missing: `The run ${id} is no longer in the workspace.` };
  const got = await ctx.results(run);
  if (!got?.results) return notRecomputed(run, got);
  return { run, own: got.results, results: proteinView(got.results) ?? got.results };
}

// A QC panel's charts: the finding's, as the QC view draws them (lib/qc-plots.js), of a run or of
// the counts with the current design.
async function qcData(ctx, panel) {
  const ws = ctx.ws;
  const sub = qcSubjects(ws).find((o) => o.id === (panel.subject === 'counts' ? 'counts' : `run:${panel.subject}`));
  if (!sub) return { missing: panel.subject === 'counts' ? 'The counts have no design to check now.' : `The run ${panel.subject} is no longer in the workspace.` };
  const inputs = qcInputsOf(ws, sub);
  if (inputs.problem) return { missing: inputs.problem };
  const got = await ctx.qc(inputs);
  if (!got?.qc) return { missing: `Quality control could not be computed: ${got?.message ?? 'unknown'}` };
  const t = withDefaultThresholds(ws.qc?.thresholds);
  const finding = findingsFrom(got.qc, t, { acknowledged: ws.qc?.acknowledged }).find((f) => f.id === panel.finding);
  if (!finding) return { missing: `The finding "${panel.findingTitle ?? panel.finding}" is not raised for ${sub.label} now.` };
  return qcPanelData(finding, got.qc, t, { pair: panel.pair ?? 0 });
}

async function scoresData(ctx, panel) {
  const got = await runResults(ctx, panel.run);
  if (got.missing) return got;
  return scoreCharts(got.own, got.run, { condition: panel.condition ?? 0, contrast: panel.contrast ?? 0, plot: panel.plot });
}

// A comparison panel: its charts (lib/view-plots.js) or one of its maps.
async function compareData(ctx, panel) {
  const map = panel.plot.startsWith('map-');
  const c = await ctx.comparison({ a: panel.a, b: panel.b }, panel.filters ?? { ...NO_FILTERS }, map ? 'protein' : null, panel.scale ?? 'scored');
  if (c.error) return { missing: c.error };
  if (!c.statistics) return { missing: `${c.a.label} and ${c.b.label} cannot be compared: ${c.report.items.filter((i) => i.status === 'blocked').map((i) => i.text).join(' ')}` };
  if (map) {
    const which = panel.plot.slice(4);
    const m = comparisonMapModels(c)[which];
    if (!m) return { missing: which === 'difference' ? 'No map of the difference: the two are not on one scale at the protein level.' : `No map of the ${which} side.` };
    return { ...m, tracks: [] };
  }
  return comparisonCharts(c, panel.plot);
}

async function variantData(ctx, panel) {
  const got = await runResults(ctx, panel.run);
  if (got.missing) return got;
  // A protein variant of a nucleotide run is in its protein view.
  const results = got.own.variants.key.includes(panel.variant) ? got.own : got.results;
  return variantCharts(results, got.run, panel.variant, { condition: panel.condition ?? 0, plot: panel.plot });
}

// A structure panel's image (wave 5's figure panel of the saved view, kept by its SHA-256) and what
// it shows.
async function structureData(ctx, panel) {
  const got = await ctx.image(panel.image.sha256);
  if (!got) return { missing: 'The structure image is not in the library: draw it again from its saved view.' };
  const view = (ctx.ws.structureViews ?? []).find((v) => v.id === panel.view);
  const notes = [];
  if (!view) notes.push('Its saved view was removed: the image is the one drawn from it then.');
  else if (view.created !== panel.image.drawn) notes.push(`The view "${view.name}" was saved again since its image was drawn: draw it again.`);
  const meta = got.metadata;
  const what = meta?.coloring?.label ? `, colored by ${meta.coloring.label}${meta.coloring.source ? ` (${meta.coloring.source})` : ''}` : '';
  return { image: got.image, title: view?.name ?? meta?.view?.name ?? null, description: `The structure ${meta?.structure?.name ?? ''}${view ? ` as the view "${view.name}" shows it` : ''}${what}.`.replace(/ {2,}/g, ' '), notes };
}

const RESOLVERS = { map: mapData, qc: qcData, scores: scoresData, compare: compareData, variant: variantData, structure: structureData };

// Map(panel id → data) for every panel that needs data.
export async function resolveFigure(ctx, fig) {
  const out = new Map();
  for (const panel of fig.panels) {
    const resolve = RESOLVERS[panel.kind];
    if (!resolve) continue;
    try {
      out.set(panel.id, await resolve(ctx, panel));
    } catch (error) {
      out.set(panel.id, { missing: error.message });
    }
  }
  return out;
}

// A structure panel's image from its PNG's bytes, without decoding its pixels: its size (IHDR) and
// the panel's metadata (its iTXt chunk), which is all its SVG drawing needs. null when it is not a
// PNG.
export function pngImage(png) {
  if (!(png?.length > 24) || png[0] !== 0x89 || png[1] !== 0x50 || png[2] !== 0x4e || png[3] !== 0x47) return null;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let metadata = null;
  try {
    metadata = JSON.parse(pngTexts(png).get(PANEL_KEYWORD) ?? 'null');
  } catch {
    metadata = null;
  }
  return { image: { width: view.getUint32(16), height: view.getUint32(20), rgba: null, png }, metadata };
}
