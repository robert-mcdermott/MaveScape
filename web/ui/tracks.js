// Sequence tracks in the window (wave 3, slice 5; requirements V5, I3, I4): a run's tracks, its own
// (reference, coverage, position effect, uncertainty), the structure's shown (wave 5, slice 4) and
// the workspace's annotations' (lib/
// providers), read from the files the library keeps; adding an annotation from public data (through
// the fetcher) or a file; the Tracks panel of the Map view (show, hide, reorder, filter, remove,
// each with its source); the tracks as CSV; and the inspector's annotations of a variant.

import { h, icon, clear, downloadBlob } from './dom.js';
import { confirmDialog, progressToast, promptDialog, showMenu, toast } from './overlays.js';
import { fetchPublic, publicDataState } from './public-data.js';
import { storeBytes } from './import.js';
import { ensureResults, runEntry } from './run-results.js';
import { PROVIDERS, annotationTracks, providerById, providerForFile } from '../lib/providers/index.js';
import { annotationsOf, arrangeTracks, arrangement, builtinTracks, describeTrack, sourceText, trackFilters, trackTarget, tracksCSV } from '../lib/tracks.js';
import { buildMapModel } from '../lib/map-model.js';
import { proteinView } from '../lib/collapse.js';
import { readsVariants, trackContext } from '../lib/run-tracks.js';
import { addAnnotation, removeAnnotation, setTrackLayout } from '../lib/workspace.js';
import { normalizeUrn } from '../lib/mavedb.js';
import { scoreSetResults } from '../lib/scoreset.js';
import { now as clockNow } from '../lib/clock.js';
import { possessive } from '../lib/words.js';
import { evidenceTracks } from './structure-evidence.js';

const decoder = new TextDecoder();
// An annotation's kept text, by SHA-256; and each annotation's tracks, by what they were read for.
const texts = new Map();
const reads = new Map();

// An annotation's kept text (also a MaveDB score set's, or a predictor's, compared: mode-compare.js).
export async function annotationText(app, annotation) {
  const sha = annotation.file?.sha256;
  if (!sha) throw new Error(`${annotation.name} has no file.`);
  if (!texts.has(sha)) {
    texts.set(sha, (async () => {
      const bytes = await app.library.getFile(sha);
      if (!bytes) throw new Error(`${annotation.file.fileName} is not in the library: add the annotation again.`);
      return decoder.decode(bytes instanceof Uint8Array ? bytes : new Uint8Array(await new Response(bytes).arrayBuffer()));
    })());
    texts.get(sha).catch(() => texts.delete(sha));
  }
  return texts.get(sha);
}

// What a run gives the providers (lib/run-tracks.js): its scores and its table read first when a
// MaveDB record's variants are named by accession.
async function contextOf(app, run, model) {
  const ws = app.store.ws;
  let results = null;
  let table = null;
  if (readsVariants(ws, run)) {
    results = (runEntry(app, run) ?? await ensureResults(app, run))?.results ?? null;
    const source = ws.sources.find((s) => s.sha256 === run.inputs.source.sha256);
    try {
      table = results && source ? await app.sourceTable(source) : null;
    } catch {
      table = null;
    }
  }
  return trackContext(ws, run, model, { results, table });
}

// A run's tracks for a map model: { tracks (every one, unarranged), problems: [{ annotation,
// message }], notes: Map(annotation id → [notes]) }. The structure shown gives its own (wave 5,
// slice 4: ui/structure-evidence.js) when the target is mapped onto it.
export async function runTracks(app, run, model) {
  const tracks = [...builtinTracks(model), ...evidenceTracks(app, model)];
  const problems = [];
  const notes = new Map();
  const annotations = app.store.ws.annotations ?? [];
  if (!annotations.length) return { tracks, problems, notes };
  let context = null;
  for (const a of annotations) {
    const key = `${run.id}|${a.id}|${a.file?.sha256}|${model.length}|${model.target.offset}|${model.protein}`;
    if (!reads.has(key)) {
      reads.set(key, (async () => {
        context ??= await contextOf(app, run, model);
        return annotationTracks(a, await annotationText(app, a), context);
      })().catch((error) => ({ tracks: [], notes: [], problem: error.message })));
    }
    const read = await reads.get(key);
    tracks.push(...read.tracks);
    notes.set(a.id, read.notes);
    if (read.problem) problems.push({ annotation: a, message: read.problem });
  }
  return { tracks, problems, notes };
}

// The tracks of a run outside the Map view (remote control, exports): its first condition's map.
export async function runTrackState(app, run, { condition = 0 } = {}) {
  const entry = runEntry(app, run) ?? await ensureResults(app, run);
  if (!entry?.results) throw new Error(entry?.message ?? `${possessive(run.name)} scores could not be recomputed.`);
  const results = proteinView(entry.results) ?? entry.results;
  const model = buildMapModel(results, run.inputs.design, { condition });
  const state = await runTracks(app, run, model);
  return { model, results, ...state, arranged: arrangeTracks(state.tracks, app.store.ws.tracks) };
}

// --- Adding ----------------------------------------------------------------------------------------

const subject = (provider, target, context) => {
  if (provider.id === 'mavedb-annotations') return context.origin?.urn ?? '';
  if (provider.id === 'mavedb-scores') return context.urn ?? '';
  if (provider.id === 'clinvar' || provider.id === 'gnomad') return target?.identifiers?.gene?.toUpperCase() ?? '';
  return target?.identifiers?.uniprot?.toUpperCase() ?? '';
};

// Keeps an annotation's text in the library and the annotation in the workspace, once it reads
// onto the run's target. A MaveDB score set (wave 4, slice 3) is kept once its scores can be read as
// published, with a track or none (a score set of nucleotide variants is still compared). Returns
// { ok, id, name, tracks, notes, message }.
async function keepAnnotation(app, run, model, { provider, name, text, fileName, record }) {
  const context = await contextOf(app, run, model);
  const trial = annotationTracks({ id: 'new', provider: provider.id, name, record, file: { fileName } }, text, context);
  const scoreSet = provider.id === 'mavedb-scores' ? scoreSetResults(text, record.scoreSet) : null;
  if (scoreSet?.error) return { ok: false, message: `${name}: ${scoreSet.error}` };
  if (!trial.tracks.length && !scoreSet) return { ok: false, message: trial.problem ?? `${name} gives no track for ${context.target?.name ?? 'the target'}.` };
  const stored = await storeBytes(app, new TextEncoder().encode(text));
  const { ws, id } = addAnnotation(app.store.ws, { provider: provider.id, name, file: { fileName, sha256: stored.sha256, size: stored.size }, record, added: clockNow() });
  app.store.commit(ws, `Add the ${scoreSet ? 'score set' : 'track'} ${name}`);
  const tracks = trial.tracks.map((t) => describeTrack(t).replace(/\.$/, '')).join('; ');
  const message = scoreSet
    ? `Added ${name}: "${record.scoreSet.title}" (${record.scoreSet.license?.short ?? 'license not given'}), ${scoreSet.results.conditions[0].scored.toLocaleString('en-US')} of ${scoreSet.results.rows.toLocaleString('en-US')} variants scored as published, kept beside the workspace (not opened): compare it in Compare.${tracks ? ` Beside the map: ${tracks}.` : ''}${trial.notes.length ? ` ${trial.notes.join(' ')}` : ''}`
    : `Added ${name}: ${tracks}.${trial.notes.length ? ` ${trial.notes.join(' ')}` : ''}`;
  app.log(message);
  return { ok: true, id, name, tracks: trial.tracks, notes: trial.notes, message, ...(scoreSet ? { scoreSet: { urn: record.scoreSet.urn, title: record.scoreSet.title, scored: scoreSet.results.conditions[0].scored, variants: scoreSet.results.rows } } : {}) };
}

// Adds a public annotation (a provider of kind 'public') for a run's target. A MaveDB score set
// (provider mavedb-scores; wave 4, slice 3) needs its URN (urn), and may be given what a higher
// score means (direction, which MaveDB does not record) and, of a score set of several targets, the
// one to compare (scoreSetTarget).
export async function addPublicTrack(app, run, providerId, { quiet = false, urn = null, direction = null, scoreSetTarget = null } = {}) {
  const provider = providerById(providerId);
  if (!provider || provider.kind !== 'public') return { ok: false, message: `There is no public annotation "${providerId}": ${PROVIDERS.filter((p) => p.kind === 'public').map((p) => p.id).join(', ')}.` };
  const { model } = await runTrackState(app, run);
  const own = await contextOf(app, run, model);
  let context = own;
  if (provider.id === 'mavedb-scores') {
    const asked = normalizeUrn(urn ?? '');
    if (!asked) return { ok: false, message: urn ? `"${urn}" is not the URN of a published MaveDB score set (such as urn:mavedb:00000054-a-1).` : 'Give the score set\'s URN (urn:mavedb:…).' };
    context = { ...own, urn: asked, scoreSetTarget };
  }
  const why = provider.needs(context.target, context);
  if (why) return { ok: false, message: why };
  const name = `${provider.name}: ${subject(provider, context.target, context)}`;
  if ((app.store.ws.annotations ?? []).some((a) => a.name === name)) return { ok: false, message: `${name} is already ${provider.id === 'mavedb-scores' ? 'kept beside the workspace' : 'among the tracks'}.` };
  const busy = quiet ? null : progressToast(`Asking ${provider.service} for ${name}…`);
  try {
    const got = await provider.fetch(context.target, context, (path, options) => fetchPublic(app, path, options), (fraction, note) => busy?.update(fraction, note));
    if (direction && got.record?.scoreSet) got.record.scoreSet.readout = { direction };
    const kept = await keepAnnotation(app, run, model, { provider, name, text: got.text, fileName: got.fileName, record: got.record });
    if (busy) {
      if (kept.ok) busy.done(kept.message);
      else busy.fail(kept.message);
    }
    return kept;
  } catch (error) {
    busy?.fail(`${name}: ${error.message}`);
    return { ok: false, message: `${name}: ${error.message}` };
  }
}

// Adds an annotation from a file (an alignment, a predictor's table, a custom track).
export async function addFileTrack(app, run, { name: fileName, text }) {
  const provider = providerForFile(fileName, text);
  if (!provider) return { ok: false, message: `${fileName}: MaveScape reads alignments (A3M, FASTA, Stockholm, Clustal), predictors' tables (AlphaMissense, EVE, ESM1b, or variants with scores) and custom tracks (GFF3, or a table with position or start and end).` };
  const { model } = await runTrackState(app, run);
  const name = `${provider.name}: ${fileName}`;
  return keepAnnotation(app, run, model, { provider, name, text, fileName, record: { service: 'a file', file: fileName, bytes: text.length } });
}

// The importer for alignments and GFF3 files dropped on the window: tracks of the latest run.
export async function importTrackFiles(app, items) {
  const run = app.store.ws.runs.at(-1);
  if (!run) throw new Error('Tracks go beside a run\'s map: score the counts first, then add the alignment or GFF3 file.');
  for (const item of items) {
    const result = await addFileTrack(app, run, { name: item.name, text: decoder.decode(await app.readBytes(item)) });
    if (result.ok) toast(result.message, { kind: 'ok' });
    else throw new Error(result.message);
  }
}

export function removeTrack(app, annotationId) {
  const a = (app.store.ws.annotations ?? []).find((x) => x.id === annotationId);
  if (!a) return false;
  app.store.commit(removeAnnotation(app.store.ws, annotationId), `Remove the track ${a.name}`);
  return true;
}

// Shows, hides, moves or filters a track (the arrangement is a view: not in the history).
export function arrangeTrack(app, tracks, change) {
  const layout = arrangement(app.store.ws.tracks, tracks, change);
  app.store.commit(setTrackLayout(app.store.ws, layout), change.shown === false ? 'Hide a track' : change.shown ? 'Show a track' : Number.isInteger(change.to) ? 'Move a track' : 'Filter a track');
}

export function exportTracks(app, run, model, tracks) {
  const name = `${(model.target.name || 'target').replace(/[^\w.-]+/g, '_')}_tracks_${run.name.replace(/\s+/g, '')}.csv`;
  downloadBlob(new Blob([tracksCSV(tracks, model)], { type: 'text/csv' }), name);
}

// Asks for a MaveDB score set's URN and keeps it beside the workspace (wave 4, slice 3). Returns
// addPublicTrack's answer, or null when cancelled.
export async function addScoreSetDialog(app, run) {
  const urn = await promptDialog({ title: 'A MaveDB score set', label: 'Its URN', placeholder: 'urn:mavedb:00000054-a-1', confirm: 'Add', hint: 'Its record and published scores are fetched and kept beside the workspace (not opened as one): compared with the runs in Compare, and drawn as a track beside the map. MaveDB does not say what a higher score means: state it in Compare.' });
  if (!urn) return null;
  const result = await addPublicTrack(app, run, 'mavedb-scores', { urn });
  if (!result.ok) toast(result.message, { kind: 'error' });
  return result;
}

// --- The panel -------------------------------------------------------------------------------------

function pickFile(accept) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, hidden: true, onchange: () => resolve(input.files[0] ?? null) });
    document.body.append(input);
    input.click();
    setTimeout(() => input.remove(), 60000);
  });
}

// The Tracks panel: { el, update(state) }. state: { run, model, all (the tracks), tracks (arranged),
// problems, notes }.
export function tracksPanel(app) {
  const el = h('details.tracks-panel', { open: app.tracksOpen ?? true, ontoggle: (e) => { app.tracksOpen = e.target.open; } });
  let state = null;
  const addMenu = (anchor) => {
    const { run, model } = state;
    const target = trackTarget(run.inputs.design.targets?.[0], app.store.ws.targets);
    const off = publicDataState(app);
    const fromMaveDB = app.store.ws.sources.find((s) => s.sha256 === run.inputs.source.sha256)?.origin?.database === 'MaveDB';
    const items = PROVIDERS.filter((p) => p.kind === 'public').map((p) => {
      // A MaveDB score set is asked for by its URN (wave 4, slice 3).
      const byUrn = p.id === 'mavedb-scores';
      const why = off !== 'on' && off !== 'offline' ? 'Public data are off.' : p.needs(target, { origin: fromMaveDB ? { urn: 'yes' } : null, urn: byUrn ? 'asked' : null });
      return { label: byUrn ? `${p.name} (by URN)…` : p.name, hint: why ? 'unavailable' : p.service, icon: 'globe', disabled: Boolean(why), title: why ?? `${p.what}.`, onSelect: () => (byUrn ? addScoreSetDialog(app, run) : addPublicTrack(app, run, p.id)) };
    });
    const files = [
      { label: 'Alignment, for conservation (A3M, FASTA, Stockholm, Clustal)…', icon: 'table', accept: '.a3m,.a2m,.fasta,.fa,.afa,.sto,.stk,.aln,.clustal,.txt' },
      { label: 'Predictor\'s scores (AlphaMissense, EVE, ESM1b, CSV or TSV)…', icon: 'table', accept: '.csv,.tsv,.txt' },
      { label: 'Custom track (GFF3, or CSV of positions or stretches)…', icon: 'table', accept: '.gff,.gff3,.csv,.tsv,.txt' },
    ].map((f) => ({ label: f.label, icon: f.icon, onSelect: async () => {
      const file = await pickFile(f.accept);
      if (!file) return;
      const result = await addFileTrack(app, run, { name: file.name, text: await file.text() });
      toast(result.message, { kind: result.ok ? 'ok' : 'error' });
    } }));
    showMenu(anchor, [{ section: 'Public data' }, ...items, '-', { section: 'From a file' }, ...files, '-', { label: 'Export the tracks shown (CSV)', icon: 'download', onSelect: () => exportTracks(app, run, model, state.tracks.filter((t) => t.shown)) }]);
  };
  function row(track, index) {
    const filters = trackFilters(track);
    const current = app.store.ws.tracks?.filters?.[track.id] ?? {};
    const controls = filters.map((f) => {
      if (f.id === 'stars') {
        const sel = h('select.input.small', { 'aria-label': `${track.label}: ${f.label}`, onchange: () => arrangeTrack(app, state.all, { id: track.id, filter: { ...current, stars: Number(sel.value) || undefined } }) },
          ...f.options.map((n) => h('option', { value: n, selected: (current.stars ?? 0) === n }, n ? `${'★'.repeat(n)} and up` : 'any review status')));
        return sel;
      }
      if (f.id === 'min') {
        const sel = h('select.input.small', { 'aria-label': `${track.label}: ${f.label}`, onchange: () => arrangeTrack(app, state.all, { id: track.id, filter: { ...current, min: sel.value ? Number(sel.value) : undefined } }) },
          h('option', { value: '', selected: current.min === undefined }, 'any frequency'), ...f.options.map((x) => h('option', { value: x, selected: current.min === x }, `AF ≥ ${track.minimum?.format?.(x) ?? x}`)));
        return sel;
      }
      // Classes or kinds: a checkbox each.
      const chosen = new Set(current[f.id] ?? f.options);
      return h('span.track-checks', ...f.options.map((o) => h('label', h('input', { type: 'checkbox', checked: chosen.has(o), onchange: (e) => {
        if (e.target.checked) chosen.add(o);
        else chosen.delete(o);
        const next = { ...current, [f.id]: chosen.size === f.options.length ? undefined : f.options.filter((x) => chosen.has(x)) };
        arrangeTrack(app, state.all, { id: track.id, filter: next });
      } }), f.labels?.[o] ?? o)));
    });
    const notes = track.annotation ? state.notes.get(track.annotation) ?? [] : [];
    return h('li.track-row',
      h('label.track-name', h('input', { type: 'checkbox', checked: track.shown, onchange: (e) => arrangeTrack(app, state.all, { id: track.id, shown: e.target.checked }) }), h('span', track.label)),
      h('span.track-actions',
        h('button.icon-button', { type: 'button', title: 'Move up', 'aria-label': `Move ${track.label} up`, disabled: index === 0, onclick: () => arrangeTrack(app, state.all, { id: track.id, to: index - 1 }) }, '↑'),
        h('button.icon-button', { type: 'button', title: 'Move down', 'aria-label': `Move ${track.label} down`, disabled: index === state.tracks.length - 1, onclick: () => arrangeTrack(app, state.all, { id: track.id, to: index + 1 }) }, '↓'),
        track.annotation ? h('button.icon-button', { type: 'button', title: 'Remove this annotation', 'aria-label': `Remove ${track.label}`, onclick: async () => {
          const a = (app.store.ws.annotations ?? []).find((x) => x.id === track.annotation);
          if (await confirmDialog({ title: 'Remove the annotation', message: `Remove ${a?.name ?? track.label} and its tracks? (Undo brings it back.)`, confirm: 'Remove', danger: true })) removeTrack(app, track.annotation);
        } }, icon('trash')) : null),
      h('p.track-source', track.source ? sourceText(track.source) : BUILTIN_WHAT[track.id] ?? '', track.filtered ? ` · filtered: ${track.filtered}${track.hiddenEntries ? ` (${track.hiddenEntries} hidden)` : ''}` : ''),
      controls.length ? h('div.track-filters', ...controls) : null,
      notes.length ? h('details.track-notes', h('summary', `${notes.length} note${notes.length > 1 ? 's' : ''}`), h('ul', ...notes.map((n) => h('li', n)))) : null);
  }
  function render() {
    clear(el);
    if (!state) return;
    const shown = state.tracks.filter((t) => t.shown).length;
    el.append(
      h('summary', icon('layers'), `Tracks (${shown} of ${state.tracks.length} shown)`),
      h('div.btn-row', { style: { margin: '6px 0' } },
        h('span.muted', { style: { fontSize: '12px' } }, 'Below the map, on its positions: hover for what each holds, click to select that position\'s variants.'), h('span.spacer'),
        h('button.btn.small', { type: 'button', onclick: (e) => addMenu(e.currentTarget) }, icon('plus'), 'Add a track')),
      state.problems.length ? h('div.callout.warn', { style: { fontSize: '12px', margin: '6px 0' } }, icon('warning'), h('span', state.problems.map((p) => `${p.annotation.name}: ${p.message}`).join(' '))) : null,
      h('ul.track-list', ...state.tracks.map(row)));
  }
  return {
    el,
    update(next) {
      state = next;
      render();
    },
  };
}

const BUILTIN_WHAT = {
  reference: 'The target\'s residues (letters where a cell is wide enough).',
  coverage: 'The share of each position\'s designed substitutions with a score.',
  effect: 'The median score of each position\'s substitutions, up or down from the wild type\'s.',
  uncertainty: 'The median standard error of each position\'s scored substitutions.',
};

// --- The inspector ---------------------------------------------------------------------------------

// The annotations of a variant (and its position) from its run's tracks, unfiltered (a filter
// is a view of a track; the inspector says all it knows). Read when the Map view has not yet.
const reading = new Set();
// Which annotations a run's tracks were read from (stale when they change).
export const annotationsSignature = (ws) => (ws.annotations ?? []).map((a) => `${a.id}:${a.file?.sha256}`).join(',');
export function annotationBlock(app, run, keys, position) {
  const found = app.trackStates?.get(run.id);
  const state = found && found.signature === annotationsSignature(app.store.ws) ? found : null;
  if (!state) {
    if ((app.store.ws.annotations ?? []).length && !reading.has(run.id)) {
      reading.add(run.id);
      runTrackState(app, run).then((s) => {
        app.trackStates ??= new Map();
        app.trackStates.set(run.id, { run, model: s.model, all: s.tracks, tracks: s.arranged, problems: s.problems, notes: s.notes, signature: annotationsSignature(app.store.ws) });
        app.store.notify(['tracks']);
      }).catch(() => {}).finally(() => reading.delete(run.id));
    }
    return null;
  }
  const seen = new Set();
  const lines = [];
  for (const key of keys.filter(Boolean)) {
    for (const item of annotationsOf((state.all ?? state.tracks).filter((t) => t.annotation), key, position)) {
      if (seen.has(item.track.id)) continue;
      seen.add(item.track.id);
      lines.push(item);
    }
  }
  if (!lines.length) return null;
  return [h('h4.inspector-sub', 'Annotations'), h('dl.kv.annotations', ...lines.flatMap(({ track, text }) => [h('dt', { title: track.source ? sourceText(track.source) : '' }, track.label), h('dd', { title: text }, text)]))];
}
