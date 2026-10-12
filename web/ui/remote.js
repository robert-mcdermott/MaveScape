// Remote control (wave 2, slice 1): actions sent by programs on this computer (scripts, the
// documentation's screenshot capture, later AI agents through the MCP server) are performed here,
// in the open window, where the user sees them, they go into the history like any edit, and can be
// undone. Each action returns { ok, message, data }. The program lists the same actions with
// their arguments (actions.go, GET /api/remote/tools); a Go test checks the two lists agree.
// The connection and the export upload follow CytoWeave 0.8.0's web/ui/remote.js.

import { toast } from './overlays.js';
import { EXAMPLES } from '../lib/examples.js';
import { coversPosition, validateDesign, summarizeDesign } from '../lib/design.js';
import { checkParameters, defaultParameters, PRESETS, withDefaults } from '../lib/score.js';
import { addRun, makeRun, nextRunName, outputDigest, runId, runInputs } from '../lib/runs.js';
import { reviewImport } from '../lib/importer.js';
import { acknowledgeFinding, addSelection, addTarget, createWorkspace, rename, setDeposit, setDesign } from '../lib/workspace.js';
import { now } from '../lib/clock.js';
import { currentRun, currentSource, focusStep, workflowSteps } from '../lib/workflow.js';
import { findingsFrom, overall, withDefaultThresholds } from '../lib/findings.js';
import { buildMapModel, cellAt, cellName, COLOR_BY, describeMap, ROW_ORDERS, STATE, STATE_NAMES } from '../lib/map-model.js';
import { proteinView } from '../lib/collapse.js';
import { mappedFor } from './mapped.js';
import { mapSVG } from '../lib/map-svg.js';
import { flagNames, REPLICATE_STATE_NAMES, STAGE_BY_CODE } from '../lib/filters.js';
import { DIFFERENTIAL_REASON_NAMES } from '../lib/differential.js';
import { KIND_NAMES } from '../lib/variants.js';
import { openExample } from './examples.js';
import { readCodonsFor } from './import.js';
import { draftFromColumns } from './design-draft.js';
import { ensureResults, forgetResults } from './run-results.js';
import { runScore, workerInput } from './score-input.js';
import { computeQc, markQcSeen, qcInputsOf, qcSubjects } from './mode-qc.js';
import { archiveFile, packageFile, RUN_FILES, runFile, selectionFile } from './record.js';
import { intervalOf } from '../lib/exports.js';
import { anchorUncertainty } from '../lib/anchors.js';
import { readiness, readinessText } from '../lib/readiness.js';
import { applyCheck, checkTarget, fetchPublic, placementText } from './public-data.js';
import { importMaveDB } from './mavedb.js';
import { depositFile, runDeposit } from './mavedb-export.js';
import { DEPOSIT_FIELDS, depositDetails, readPublication } from '../lib/mavedb-export.js';
import { searchHits } from '../lib/mavedb.js';
import { retrievalText } from '../lib/uniprot.js';
import { addFileTrack, addPublicTrack, arrangeTrack, removeTrack, runTrackState } from './tracks.js';
import { annotationsOf, describeTrack, sourceText, trackFilters, trackTarget, tracksCSV } from '../lib/tracks.js';
import { comparableAnnotations, comparisonJSON, SCALES } from '../lib/compare.js';
import { DEFAULT_MAX_SPECIFICATIONS, robustnessJSON } from '../lib/robustness.js';
import { checkRobustness, robustnessFiles } from './robustness.js';
import { combineSelections, OPERATIONS, QueryError } from '../lib/query.js';
import { runQuery } from './selections.js';
import { normalizeUrn } from '../lib/mavedb.js';
import { setScoreSetDirection } from '../lib/workspace.js';
import { addCompared, compareOptions, comparisonFiles, comparisonMapSVG, computeComparison, currentFilters, currentPair, currentScale, setFilters, setPair, setScale } from './mode-compare.js';
import { PROVIDERS } from '../lib/providers/index.js';
import { possessive } from '../lib/words.js';
import { findStructures, mapStructure, openStructure, originText, RESIDUE_STYLES, selectResidues, structureState, targetAccession, workspaceTarget } from './mode-structure.js';
import { describeMapping, mappingCSV, stretches } from '../lib/mapping.js';
import { STYLES, SURFACES } from './structure-viewer.js';
import { COLOR_SCHEMES } from '../lib/structure/coloring.js';
import { SelectionError } from '../lib/structure/select.js';
import { ASYMMETRIC_UNIT_ID, assemblyChoices, chainSummaries, describeStructure, residueLabel, residueRuns } from '../lib/structures.js';

export class ActionError extends Error {}

const round = (v, digits = 4) => (Number.isFinite(v) ? +v.toPrecision(digits) : null);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const ONE_TO_THREE = { A: 'Ala', R: 'Arg', N: 'Asn', D: 'Asp', C: 'Cys', Q: 'Gln', E: 'Glu', G: 'Gly', H: 'His', I: 'Ile', L: 'Leu', K: 'Lys', M: 'Met', F: 'Phe', P: 'Pro', S: 'Ser', T: 'Thr', W: 'Trp', Y: 'Tyr', V: 'Val', '*': 'Ter', X: 'Ter' };

// The views by the names scripts use.
const MODES = { start: 'welcome', welcome: 'welcome', experiment: 'experiment', design: 'experiment', qc: 'qc', 'quality control': 'qc', score: 'score', scores: 'score', map: 'map', compare: 'compare', comparison: 'compare', structure: 'structure', structures: 'structure' };

// One of `options` (strings) by a forgiving name: exact, then ignoring case, then the one that
// starts with or contains it. Errors list the choices.
function choose(value, options, what) {
  const text = String(value ?? '').trim();
  const lower = text.toLowerCase();
  const found = options.find((o) => o === text) ?? options.find((o) => o.toLowerCase() === lower);
  if (found) return found;
  const near = options.filter((o) => o.toLowerCase().startsWith(lower));
  if (lower && near.length === 1) return near[0];
  const inside = options.filter((o) => o.toLowerCase().includes(lower));
  if (lower && inside.length === 1) return inside[0];
  throw new ActionError(`${text ? `No ${what} "${text}"` : `Give the ${what}`}. ${what[0].toUpperCase()}${what.slice(1)}s: ${options.join(', ') || 'none'}.`);
}

// A variant's name as MAVE-HGVS, from forgiving forms: p.Trp36Ala, W36A, p.W36A, Trp36Ala.
export function variantName(text) {
  const t = String(text ?? '').trim();
  const one = /^(?:p\.)?([A-Z*])(\d+)([A-Z*=])$/.exec(t);
  if (one) return `p.${ONE_TO_THREE[one[1]]}${one[2]}${one[3] === '=' ? '=' : ONE_TO_THREE[one[3]]}`;
  const three = /^(?:p\.)?([A-Z][a-z]{2})(\d+)([A-Z][a-z]{2}|=|\*)$/.exec(t);
  if (three) return `p.${three[1]}${three[2]}${three[3] === '*' ? 'Ter' : three[3]}`;
  return t;
}

// A design's shape in a few words: its kind and replicates, or its column of published scores.
const shapeOf = (d) => (d.model === 'scores' ? `published scores in "${d.scoreColumn ?? 'score'}"` : `${d.model}, ${plural(d.replicates, 'replicate')} of ${plural(d.samples, 'sample')}`);

export function installRemote(app) {
  const { store } = app;
  const ws = () => store.ws;
  // Who sent the action being performed (what the script calls itself).
  let author = 'a program on this computer';

  // --- Resolution of names --------------------------------------------------------------------

  function resolveSource(ref) {
    const sources = ws().sources;
    if (!sources.length) throw new ActionError('The workspace has no table yet: open a count table first (open_files or open_example).');
    if (!ref) return currentSource(ws());
    const name = choose(ref, sources.map((s) => s.name), 'table');
    return sources.find((s) => s.name === name);
  }

  // A run by name or id, or 'latest'; by default the current design's latest run, else the last.
  function resolveRun(ref) {
    const runs = ws().runs;
    if (!runs.length) throw new ActionError('No score run yet: score the counts first (the score action).');
    if (!ref || /^(latest|last|current)$/i.test(String(ref))) return currentRun(ws()) ?? runs.at(-1);
    const byId = runs.find((r) => r.id === ref);
    if (byId) return byId;
    const text = /^\d+$/.test(String(ref)) ? `Run ${ref}` : String(ref);
    const name = choose(text, runs.map((r) => r.name), 'score run');
    return runs.find((r) => r.name === name);
  }

  async function resultsOf(run) {
    const entry = await ensureResults(app, run);
    if (!entry?.results) throw new ActionError(`${possessive(run.name)} scores could not be recomputed: ${entry?.message ?? 'unknown'}`);
    return entry;
  }

  // A condition by name or number (from 1): its index.
  function resolveCondition(results, ref) {
    const conditions = results.conditions;
    if (ref === undefined || ref === null || ref === '') return 0;
    if (/^\d+$/.test(String(ref))) {
      const i = Number(ref) - 1;
      if (i < 0 || i >= conditions.length) throw new ActionError(`There ${conditions.length === 1 ? 'is 1 condition' : `are ${conditions.length} conditions`}: ${conditions.map((c) => c.name).join(', ')}.`);
      return i;
    }
    const name = choose(ref, conditions.map((c) => c.name), 'condition');
    return conditions.findIndex((c) => c.name === name);
  }

  // A run's map: a nucleotide run's drawn from its protein view (collapse.js).
  function modelOf(run, results, condition, view = app.mapView ?? {}) {
    return buildMapModel(proteinView(results) ?? results, run.inputs.design, { condition, contrast: view.contrast ?? 0, rowOrder: view.rowOrder ?? 'biochemical', colorBy: view.colorBy ?? 'score' });
  }

  // A track as remote control describes it.
  function trackData(t, notes = new Map()) {
    const filters = trackFilters(t).map((f) => ({ filter: f.id, label: f.label, options: f.options }));
    return {
      id: t.id, label: t.label, kind: t.kind, shown: t.shown, annotation: t.annotation ?? null, source: t.source ?? null, summary: describeTrack(t),
      filter: ws().tracks?.filters?.[t.id] ?? null, ...(t.filtered ? { filtered: t.filtered } : {}), filters,
      ...(t.kind === 'variants' ? { variants: t.entries.length } : {}), ...(t.kind === 'features' ? { features: t.features.map((f) => ({ type: f.type, label: f.label, start: f.start, end: f.end })) } : {}),
      ...(t.annotation ? { notes: notes.get(t.annotation) ?? [] } : {}),
    };
  }

  // A run's differential scores in brief: per contrast, how they were made and how many differ.
  function differentialSummary(results) {
    return (results.differential ?? []).map((d) => {
      let compared = 0;
      let lower = 0;
      let higher = 0;
      d.reason.forEach((r, i) => {
        if (r) return;
        compared += 1;
        if (d.q[i] < 0.05) {
          if (d.delta[i] < 0) lower += 1;
          else higher += 1;
        }
      });
      return { contrast: d.name, method: d.method, compared, lowerAtQ05: lower, higherAtQ05: higher, ...(d.note ? { note: d.note } : {}) };
    });
  }

  // Waits for the views to draw what an action changed (the store notifies them synchronously;
  // canvases draw on the next frame).
  const settle = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  async function show(mode) {
    if (store.ui.mode === mode) store.notify(['focus']);
    else await app.setMode(mode);
    await settle();
  }

  function designSummary(design, source) {
    const result = validateDesign(design, source ? { columns: source.columns.map((c) => c.name) } : null);
    return {
      name: design.name ?? null,
      model: design.model,
      samples: design.samples?.length ?? 0,
      replicates: design.replicates?.length ?? 0,
      ...(design.model === 'scores' ? { scoreColumn: design.scores?.score ?? null } : {}),
      valid: result.ok,
      problems: result.errors.map((e) => e.message),
      warnings: result.warnings.map((w) => w.message),
      summary: summarizeDesign(design).lines,
    };
  }

  function runSummary(run) {
    return {
      id: run.id,
      name: run.name,
      table: run.inputs.source.name,
      created: run.created,
      variants: run.output.variants,
      scored: Object.fromEntries(run.output.conditions.map((c) => [c.name, c.scored])),
      outputSha256: run.output.sha256,
      // What the run's files are (mavescape run writes them): its conditions, whether it compares
      // them, whether its table is of barcodes, whether it has a map (protein-level variants).
      conditions: run.output.conditions.map((c) => c.name),
      comparesConditions: Boolean(run.inputs.parameters?.differential) && run.output.conditions.length > 1,
      barcodes: run.inputs.design.library?.level === 'barcode',
      map: (run.inputs.design.targets?.length ?? 0) === 1 && (run.inputs.design.variants?.level === 'protein' || run.inputs.design.targets[0].sequenceType === 'dna'),
      // Nucleotide variants of a DNA target, read at the protein level too (wave 3, slice 3).
      proteinLevel: run.inputs.design.variants?.level !== 'protein' && run.inputs.design.targets?.[0]?.sequenceType === 'dna',
      // Published scores (wave 3, slice 2): read as published, with no counts or samples.
      published: run.inputs.design.model === 'scores',
    };
  }

  function findingSummary(f) {
    return {
      id: f.id, title: f.title, status: f.status, blocking: Boolean(f.blocking), value: f.value, threshold: f.threshold, explanation: f.explanation, rationale: f.rationale,
      // What could cause it and what to do next (wave 2, slice 8), and its acknowledgement.
      causes: f.advice?.causes ?? [], next: f.advice?.next ?? [],
      ...(f.acknowledged ? { acknowledged: { reason: f.acknowledged.reason, status: f.acknowledged.status, current: f.acknowledged.current } } : {}),
    };
  }

  // The QC of a run (by name or id), or of the counts ("counts"), with the workspace's thresholds
  // and acknowledgements: { sub, findings, overall, of }.
  async function qcOfSubject(runName) {
    const w = ws();
    const subjects = qcSubjects(w);
    if (!subjects.length) throw new ActionError('Quality control needs a count table and its design first.');
    let sub;
    if (/^counts$/i.test(String(runName ?? ''))) {
      sub = subjects.find((s) => s.id === 'counts');
      if (!sub) throw new ActionError('There is no current design to check the counts with.');
    } else if (runName || w.runs.length) {
      const run = resolveRun(runName);
      sub = subjects.find((s) => s.id === `run:${run.id}`);
    } else {
      sub = subjects.find((s) => s.id === 'counts');
    }
    const inputs = qcInputsOf(w, sub);
    if (inputs.problem) throw new ActionError(inputs.problem);
    const entry = await computeQc(app, inputs);
    if (entry.status !== 'done') throw new ActionError(`Quality control failed: ${entry.message}`);
    const now = ws();
    const findings = findingsFrom(entry.qc, withDefaultThresholds(now.qc?.thresholds), { acknowledged: now.qc?.acknowledged });
    return { sub, findings, overall: overall(findings), of: sub.run ? sub.run.name : 'the counts' };
  }

  // --- Actions --------------------------------------------------------------------------------

  // The structure shown, for get_state and the structure actions (wave 5, slice 1).
  function structureSummary(full = true) {
    const state = structureState(app);
    const viewer = state.viewer;
    const structure = viewer?.structure;
    if (!structure) return null;
    const model = viewer.model;
    const selected = [...viewer.selection].map((key) => model.residueMap.get(key)).filter(Boolean);
    const origin = state.origin ? { kind: state.origin.kind, id: state.origin.id ?? null, version: state.origin.version ?? null, file: state.origin.name ?? null, retrieved: state.origin.retrieval?.retrieved ?? null, cache: state.origin.retrieval?.cache ?? null } : null;
    const summary = {
      name: structure.meta.code || structure.label,
      title: structure.meta.title,
      origin,
      predicted: Boolean(structure.meta.isPredicted),
      assembly: structure.activeAssemblyId ?? ASYMMETRIC_UNIT_ID,
      atoms: model.atoms.length,
      residues: model.residues.length,
      renderer: viewer.kind,
      style: viewer.style,
      color: viewer.colorScheme,
      surface: viewer.surface,
      selected: { count: selected.length, query: state.query || null, residues: selected.slice(0, 100).map(residueLabel), runs: residueRuns(selected).slice(0, 50) },
      styled: Object.fromEntries([...viewer.styled].map(([key, how]) => [key, how])),
      labels: viewer.labels.size,
      focused: viewer.focused.length,
    };
    if (state.mapping) summary.mapping = mappingSummary(state);
    if (!full) return summary;
    return { ...summary, chains: chainSummaries(structure), assemblies: assemblyChoices(structure), words: describeStructure(structure) };
  }

  // The target on the structure (wave 5, slice 2): the chain, the counts by state, the stretches,
  // the entry's own record compared, and every chain that holds it.
  function mappingSummary(state) {
    const m = state.mapping;
    const of = (test) => m.positions.filter(test).map((p) => p.position);
    return {
      target: m.target.name,
      chain: m.chain,
      onStructure: m.onStructure,
      identity: +m.identity.toFixed(4),
      counts: m.counts,
      positions: { onStructure: stretches(of((p) => p.residue)), different: m.positions.filter((p) => p.state === 'different').map((p) => ({ position: p.position, reference: p.reference, target: p.code, structure: p.structureCode, residue: p.residue, reason: p.reason ?? null })), unobserved: stretches(of((p) => p.state === 'unobserved')), deleted: stretches(of((p) => p.state === 'deleted')), outside: stretches(of((p) => p.state === 'outside')), ambiguous: stretches(of((p) => p.ambiguous)) },
      record: m.record,
      chains: state.maps.map((x) => ({ chain: x.chain, onStructure: x.onStructure, identical: x.counts.identical })),
      words: describeMapping(m, state.viewer.structure.meta.code || state.viewer.structure.label),
    };
  }

  function setAssembly(id) {
    const state = structureState(app);
    const viewer = state.viewer;
    const choices = assemblyChoices(viewer.structure);
    if (!choices.length) throw new ActionError(`${viewer.structure.meta.code || 'The structure'} defines no assembly other than its coordinates as deposited.`);
    const chosen = choose(String(id) === 'au' ? ASYMMETRIC_UNIT_ID : String(id), choices.map((c) => c.id), 'assembly');
    const choice = choices.find((c) => c.id === chosen);
    if (choice.tooLarge) throw new ActionError(`${choice.label} would have ${choice.atoms.toLocaleString('en-US')} atoms, more than MaveScape draws.`);
    viewer.setAssembly(chosen);
    mapStructure(app, state.mapping?.chain);
    state.query = '';
  }

  // Waits for the surface asked for (WebGPU), at most 30 seconds.
  async function surfaceReady(viewer) {
    for (let i = 0; i < 300 && viewer.surface.kind !== 'off' && viewer.kind === 'webgpu' && !viewer.surface.ready && !/could not/.test(viewer.surface.status); i += 1) await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const actions = {
    async get_state() {
      const w = ws();
      const source = currentSource(w);
      const steps = workflowSteps(w, app.seen);
      const next = focusStep(steps);
      const sel = store.ui.selection;
      const data = {
        workspace: { id: w.id, name: w.name, example: w.example?.id ?? null },
        mode: store.ui.mode === 'welcome' ? 'start' : store.ui.mode,
        tables: w.sources.map((s) => ({ name: s.name, rows: s.rows, layout: s.layout, sha256: s.sha256, countColumns: s.mapping?.countColumns ?? [], problems: s.problems?.blocking ?? [], current: s === source, ...(s.origin ? { origin: { database: s.origin.database, urn: s.origin.urn, ...(s.origin.urns ? { urns: s.origin.urns } : {}), ...(s.origin.package ? { package: s.origin.package } : {}), file: s.origin.file, retrieved: s.origin.retrieved, license: s.origin.license } } : {}) })),
        targets: w.targets.map((t) => ({ name: t.name, sequenceType: t.sequenceType, length: t.sequence.length, offset: t.offset ?? 0, ...(t.sequenceType === 'dna' ? { codingStart: t.codingStart ?? 1 } : {}), ...(t.origin ? { from: t.origin.service ?? t.origin.format, accession: t.origin.accession } : {}) })),
        design: w.design ? designSummary(w.design, source) : null,
        runs: w.runs.map(runSummary),
        selections: w.selections.map((s) => ({ name: s.name, run: w.runs.find((r) => r.id === s.run)?.name ?? s.run, variants: s.keys.length, query: s.query ?? null })),
        focus: store.ui.focus ?? null,
        selection: sel ? { run: w.runs.find((r) => r.id === sel.run)?.name ?? sel.run, condition: sel.condition, count: sel.keys.length, query: sel.query ?? null, variants: sel.keys.slice(0, 100) } : null,
        steps: steps.map((s) => ({ id: s.id, label: s.label, state: s.state, detail: s.detail })),
        next: next ? { step: next.id, state: next.state, detail: next.detail, action: next.action?.label ?? null } : null,
        structure: structureSummary(false),
      };
      const message = `${w.name}: ${plural(w.sources.length, 'table')}, ${plural(w.runs.length, 'score run')}${w.design ? `, a ${w.design.model} design` : ', no design'}; showing ${data.mode}.${next ? ` ${next.state === 'optional' ? 'All done' : 'Next'}: ${next.detail}` : ''}`;
      return { message, data };
    },

    async new_workspace(args) {
      await app.newWorkspace();
      if (args.name) store.commit(rename(store.ws, String(args.name)), 'Rename workspace');
      return { message: `Started a new workspace, "${store.ws.name}".`, data: { id: store.ws.id, name: store.ws.name } };
    },

    async open_example(args) {
      const ids = EXAMPLES.map((e) => e.id);
      let id;
      try {
        id = choose(args.id, ids, 'example');
      } catch (error) {
        const byTitle = EXAMPLES.filter((e) => e.title.toLowerCase().includes(String(args.id ?? '').toLowerCase()));
        if (args.id && byTitle.length === 1) id = byTitle[0].id;
        else throw new ActionError(`${error.message} ${EXAMPLES.map((e) => `${e.id}: ${e.title}`).join('; ')}.`);
      }
      const result = await openExample(app, id);
      if (!result.ok) throw new ActionError(result.message);
      await settle();
      const example = EXAMPLES.find((e) => e.id === id);
      return { message: `${result.message} Showing ${example.opens}. ${example.question}`, data: { id, title: example.title, simulated: example.simulated, opens: example.opens, runs: ws().runs.map(runSummary), steps: example.steps.map(([mode, text]) => ({ mode, text })) } };
    },

    async open_files(args, event) {
      const files = event.files ?? [];
      if (!files.length) throw new ActionError('No files came with the action.');
      if (args.new_workspace) await app.loadWorkspace(createWorkspace());
      const items = [];
      for (const file of files) {
        const response = await fetch(file.url);
        if (!response.ok) throw new ActionError(`${file.name} could not be read (HTTP ${response.status}).`);
        items.push(Object.assign(new File([await response.arrayBuffer()], file.name), { folder: file.folder ?? null }));
      }
      const before = { id: ws().id, sources: ws().sources.length, targets: ws().targets.length, structure: structureState(app).origin };
      const { problems } = await app.importFiles(items, { accept: !args.review });
      await settle();
      const w = ws();
      // A MaveDB package opens as a workspace of its own (wave 3, slice 4).
      const fresh = w.id !== before.id;
      const added = { tables: w.sources.slice(fresh ? 0 : before.sources).map((s) => s.name), targets: w.targets.slice(fresh ? 0 : before.targets).map((t) => t.name) };
      // A structure is shown in the Structure view (wave 5, slice 1).
      const structure = structureState(app).origin !== before.structure ? structureSummary(false) : null;
      if (structure) added.structure = structure.name;
      if (problems.length && !added.tables.length && !added.targets.length && !structure && !args.review) throw new ActionError(problems.join(' '));
      const parts = [];
      if (added.tables.length) parts.push(`the table${added.tables.length > 1 ? 's' : ''} ${added.tables.join(', ')}`);
      if (added.targets.length) parts.push(`the target${added.targets.length > 1 ? 's' : ''} ${added.targets.join(', ')}`);
      if (structure) parts.push(`the structure ${originText(structureState(app).origin, structureState(app).viewer.structure)}, in the Structure view`);
      const message = `${parts.length ? `Opened ${parts.join(' and ')}` : `Read ${plural(files.length, 'file')}`}${args.review ? '; the import wizard is open for review' : ''}.${problems.length ? ` Problems: ${problems.join(' ')}` : ''}`;
      return { message, data: { ...added, problems } };
    },

    async open_structure(args) {
      const given = [args.pdb, args.alphafold].filter((x) => x !== undefined && x !== null && String(x).trim() !== '');
      if (given.length !== 1) throw new ActionError('Give a PDB ID (pdb: "2VWF") or a UniProt accession for its AlphaFold DB model (alphafold: "P62993", or "target" for the target\'s), one of the two.');
      let what = args.pdb ? { pdb: String(args.pdb) } : { alphafold: String(args.alphafold) };
      if (what.alphafold?.toLowerCase() === 'target') {
        const accession = targetAccession(ws());
        if (!accession) throw new ActionError('The target has no UniProt accession: give it in Experiment, Target, or name the accession.');
        what = { alphafold: accession };
      }
      if (store.ui.mode !== 'structure') await app.setMode('structure');
      if (args.chain) what.chain = String(args.chain);
      const result = await openStructure(app, what);
      if (!result.ok) throw new ActionError(result.message);
      if (args.assembly) setAssembly(args.assembly);
      await surfaceReady(structureState(app).viewer);
      await settle();
      return { message: result.message, data: structureSummary() };
    },

    async find_structures() {
      const found = await findStructures(app);
      if (!found.ok) throw new ActionError(found.message);
      const { target, rows } = found;
      const range = (r) => (r.from === r.to ? `${r.from}` : `${r.from}–${r.to}`);
      const top = rows.slice(0, 5).map((r) => `${r.id} (${r.method}${r.resolution ? ` ${r.resolution} Å` : ''}, chain ${r.chains[0].id}, positions ${range(r)})`).join('; ');
      return {
        message: `${rows.length.toLocaleString('en-US')} PDB ${rows.length === 1 ? 'entry covers' : 'entries cover'} ${target.name} (${target.accession}), by SIFTS, the most of it first: ${top}${rows.length > 5 ? '; …' : ''}. Its AlphaFold DB model covers all ${target.length} positions.`,
        data: { target: { name: target.name, accession: target.accession, offset: target.offset, length: target.length }, retrieval: found.retrieval ?? null, structures: rows.slice(0, 100).map((r) => ({ id: r.id, method: r.method, resolution: r.resolution, from: r.from, to: r.to, covered: r.covered, coverage: +r.coverage.toFixed(4), chains: r.chains.map((c) => ({ id: c.id, from: c.from, to: c.to })) })), total: rows.length },
      };
    },

    async map_structure(args) {
      const state = structureState(app);
      if (!state.viewer?.structure) throw new ActionError('No structure is open: open one with open_structure (a PDB ID or an AlphaFold DB model), or a file with open_files.');
      if (store.ui.mode !== 'structure') await app.setMode('structure');
      if (!workspaceTarget(ws())) throw new ActionError('This workspace has no target to map onto the structure: open a table and its target, or an example.');
      const mapping = mapStructure(app, args.chain ? String(args.chain) : state.mapping?.chain);
      if (!mapping) throw new ActionError(`${state.mapTarget.name} is on no chain of ${state.viewer.structure.meta.code || 'the structure'}: no chain holds five of its residues aligned identical, and half of those aligned.`);
      if (args.chain && mapping.chain !== String(args.chain)) throw new ActionError(`${state.mapTarget.name} is not on chain ${args.chain}. Chains that hold it: ${state.maps.map((m) => m.chain).join(', ')}.`);
      store.notify(['structure']);
      await settle();
      const summary = mappingSummary(state);
      return { message: summary.words.join(' '), data: summary };
    },

    async set_structure(args) {
      const state = structureState(app);
      const viewer = state.viewer;
      if (!viewer?.structure) throw new ActionError('No structure is open: open one with open_structure (a PDB ID or an AlphaFold DB model), or a file with open_files.');
      if (store.ui.mode !== 'structure') await app.setMode('structure');
      if (args.assembly) setAssembly(args.assembly);
      if (args.style) viewer.setStyle(choose(args.style, Object.keys(STYLES), 'style'));
      if (args.color) {
        const schemes = COLOR_SCHEMES.map((c) => c.id).filter((id) => id !== 'plddt' || viewer.structure.meta.isPredicted);
        viewer.setColor(choose(args.color, schemes, 'color scheme'));
      }
      if (args.surface) viewer.setSurface(choose(args.surface, Object.keys(SURFACES), 'surface'));
      if (args.select !== undefined && args.select !== null) {
        const text = String(args.select).trim();
        state.query = text;
        if (!text) viewer.select([]);
        else {
          let found;
          try {
            found = selectResidues(app, text);
          } catch (error) {
            throw new ActionError(error instanceof SelectionError ? `"${text}": ${error.message}` : error.message);
          }
          if (!found.keys.length) throw new ActionError(`"${text}" selects no residue of ${viewer.structure.meta.code || 'the structure'}.`);
          viewer.select(found.keys);
        }
      }
      const keys = [...viewer.selection];
      const needs = (what) => {
        if (!keys.length) throw new ActionError(`Select residues first (select: "resn CYS") to ${what} them.`);
      };
      if (args.show) {
        needs('draw');
        viewer.styleResidues(keys, choose(args.show, Object.keys(RESIDUE_STYLES), 'residue style'));
      }
      if (args.label !== undefined && args.label !== null) {
        needs('label');
        viewer.label(keys, Boolean(args.label));
      }
      if (args.focus === true) {
        needs('focus on');
        viewer.focus(keys);
      } else if (args.focus === false) {
        viewer.clearFocus();
        viewer.fit();
      }
      if (args.fit) viewer.fit();
      await surfaceReady(viewer);
      await settle();
      const summary = structureSummary();
      const parts = [`${summary.name}: ${STYLES[summary.style].label.toLowerCase()}, colored by ${COLOR_SCHEMES.find((c) => c.id === summary.color)?.label.toLowerCase() ?? summary.color}`];
      if (summary.surface.kind !== 'off') parts.push(summary.surface.ready ? `the ${SURFACES[summary.surface.kind].words}` : summary.surface.status);
      if (summary.selected.count) parts.push(`${plural(summary.selected.count, 'residue')} selected (${summary.selected.runs.slice(0, 8).join(', ')}${summary.selected.runs.length > 8 ? ', …' : ''})`);
      if (summary.labels) parts.push(`${plural(summary.labels, 'label')}`);
      if (summary.focused) parts.push(`focused on ${plural(summary.focused, 'residue')}`);
      return { message: `${parts.join('; ')}. Drawn with ${viewer.kind === 'webgpu' ? 'WebGPU' : 'the Canvas renderer'}.`, data: summary };
    },

    async set_mode(args) {
      const mode = MODES[choose(args.mode, Object.keys(MODES), 'view')];
      await app.setMode(mode);
      await settle();
      return { message: `Showing ${mode === 'welcome' ? 'the start page' : mode}.`, data: { mode: mode === 'welcome' ? 'start' : mode } };
    },

    async focus(args) {
      const w = ws();
      if (!args.name) {
        app.focusItem(null);
        return { message: 'Cleared the focus.' };
      }
      const kinds = { table: 'source', target: 'target', run: 'run', selection: 'selection', variant: 'variant' };
      const kind = args.kind ? kinds[choose(args.kind, Object.keys(kinds), 'kind')] : null;
      const lists = { source: w.sources, target: w.targets, run: w.runs, selection: w.selections };
      const candidates = Object.entries(lists).filter(([k]) => !kind || k === kind).flatMap(([k, items]) => items.map((item) => ({ kind: k, id: item.id, name: item.name })));
      // A variant by its name, when nothing else is called that.
      const looksLikeVariant = /^p\.[A-Z][a-z]{2}\d+/.test(variantName(args.name)) && !candidates.some((c) => c.name === args.name);
      if (kind === 'variant' || (!kind && looksLikeVariant)) return actions.inspect_variant({ variant: args.name, run: args.run });
      const name = choose(args.name, candidates.map((c) => c.name), kind === 'source' ? 'table' : kind ?? 'item');
      const item = candidates.find((c) => c.name === name);
      app.focusItem({ kind: item.kind, id: item.id });
      await settle();
      return { message: `Showing ${name} in the inspector.`, data: { kind: item.kind === 'source' ? 'table' : item.kind, name } };
    },

    async draft_design(args) {
      const source = resolveSource(args.table);
      if (!(source.mapping?.countColumns?.length)) throw new ActionError(`${source.name} has no columns of counts to draft a design from.`);
      await draftFromColumns(app, source);
      await settle();
      const design = ws().design;
      const summary = designSummary(design, source);
      return { message: `Drafted the design of ${source.name}: ${shapeOf(summary)}. ${summary.valid ? 'It is valid.' : `${plural(summary.problems.length, 'problem')}: ${summary.problems.join(' ')}`}`, data: { design, ...summary } };
    },

    async set_design(args) {
      const design = args.design;
      if (!design || typeof design !== 'object') throw new ActionError('Give "design": a mavescape-design document (docs/FORMATS.md).');
      if (design.format !== 'mavescape-design') throw new ActionError('The design\'s format must be "mavescape-design".');
      // A design naming protein names derived from codons reads the table's codons (wave 2, slice 11).
      const source = await readCodonsFor(app, resolveSource(args.table), design).catch((error) => { throw new ActionError(error.message); });
      const result = validateDesign(design, { columns: source.columns.map((c) => c.name) });
      if (!result.ok) throw new ActionError(`The design does not fit ${source.name}: ${result.errors.map((e) => e.message).join(' ')}`);
      // The workspace's own target (with the same sequence) stands in for the design's copy; a
      // workspace without it gets the design's (a table opened without its FASTA).
      let w = ws();
      const own = w.targets.find((t) => t.sequence === design.targets?.[0]?.sequence);
      let next = design;
      if (own) next = { ...design, targets: [own, ...design.targets.slice(1)] };
      else if (design.targets?.[0]) {
        const added = addTarget(w, design.targets[0]);
        w = added.ws;
        next = { ...design, targets: [{ ...design.targets[0], id: added.id }, ...design.targets.slice(1)] };
      }
      store.commit(setDesign(w, next, `The design set by ${author}`, source.id), `Set the design (${author})`);
      await settle();
      const summary = designSummary(next, source);
      return { message: `Set the design of ${source.name}: ${summary.model}, ${plural(summary.replicates, 'replicate')}.${summary.warnings.length ? ` Warnings: ${summary.warnings.join(' ')}` : ''}`, data: summary };
    },

    // MaveDB (wave 3, slice 2): a search, and a score set opened as a workspace.
    async search_mavedb(args) {
      const text = String(args.text ?? '').trim();
      if (!text) throw new ActionError('Give the words to search MaveDB for.');
      const page = Number.isInteger(args.page) && args.page > 0 ? args.page : 1;
      const got = await fetchPublic(app, `mavedb/search?text=${encodeURIComponent(text)}&page=${page}`);
      if (!got.ok) throw new ActionError(got.message);
      const { total, hits } = searchHits(got.json);
      const listed = hits.map((x) => `${x.urn} "${x.title}" (${[x.targets.join(', '), x.organism, x.variants !== null ? `${x.variants} variants` : null, x.license].filter(Boolean).join('; ')})`);
      return { message: `${total} published score set${total === 1 ? ' matches' : 's match'} "${text}"${total > hits.length ? ` (page ${page}: ${hits.length} shown)` : ''}${listed.length ? `: ${listed.slice(0, 10).join('; ')}${listed.length > 10 ? '; …' : ''}` : ''}.`, data: { total, page, hits, retrieval: got.retrieval } };
    },

    async open_mavedb(args) {
      const opened = await importMaveDB(app, String(args.urn ?? ''), { counts: args.counts !== false, target: args.target ?? null, mapped: args.mapped === true });
      if (!opened.ok) throw new ActionError(opened.message);
      await settle();
      return { message: opened.message, data: opened.data };
    },

    // The target checked against its UniProt entry (wave 3, slice 1), through the program's fetcher:
    // only the accession is sent. A lookup by sequence is not offered here: it sends the sequence,
    // and only the person at the window may decide that.
    // A MaveDB deposit (wave 3, slice 4): what one of a run would hold and what MaveDB requires
    // that the workspace lacks. Read-only.
    async mavedb_deposit(args) {
      const run = resolveRun(args.run);
      const { results } = await resultsOf(run);
      const condition = resolveCondition(results, args.condition);
      let made;
      try {
        made = await runDeposit(app, run, condition);
      } catch (error) {
        throw new ActionError(error.message);
      }
      const r = made.report;
      const left = r.variants.leftOut.reduce((a, x) => a + x.count, 0);
      const message = [
        `A MaveDB deposit of ${run.name}${results.conditions.length > 1 ? ` (${r.condition})` : ''}: ${r.variants.exported} of ${r.variants.of} variants${left ? ` (${left} left out)` : ''}, the target ${r.target.targetAccession ? `named by ${r.target.targetAccession.accession}` : 'given by its sequence'}.`,
        r.missing.length ? `MaveDB requires what the workspace lacks: ${r.missing.map((m) => m.text).join(' ')}` : 'Nothing MaveDB requires is missing.',
      ].join(' ');
      return { message, data: { run: run.name, condition: r.condition, conditions: results.conditions.map((c) => c.name), mode: r.mode, target: r.target, variants: r.variants, scored: r.scored, columns: r.columns, keywords: r.keywords, missing: r.missing, defaulted: r.defaulted, notes: r.notes, ready: r.ready, details: depositDetails(ws(), run).details } };
    },

    // Sets the MaveDB details (ws.deposit): the fields given replace the workspace's (an empty one
    // removes it), undoable and in the history.
    async set_mavedb_details(args) {
      const given = typeof args.details === 'object' && args.details ? args.details : null;
      if (!given) throw new ActionError(`Give "details": an object of ${DEPOSIT_FIELDS.filter((k) => k !== 'columns').join(', ')}.`);
      const unknown = Object.keys(given).filter((k) => !DEPOSIT_FIELDS.includes(k) || k === 'columns');
      if (unknown.length) throw new ActionError(`No MaveDB detail ${unknown.map((k) => `"${k}"`).join(', ')}; the details are ${DEPOSIT_FIELDS.filter((k) => k !== 'columns').join(', ')}.`);
      const patch = { ...given };
      // Publications as written ("PubMed 29785012", a DOI) or as { db, id }.
      if (Array.isArray(patch.publications)) patch.publications = patch.publications.map((p) => (typeof p === 'string' ? readPublication(p) : { db: p.db ?? null, id: String(p.id ?? '') }));
      for (const key of ['rawReads', 'contributors', 'dois']) if (typeof patch[key] === 'string') patch[key] = patch[key].split(/[;,\s]+/).filter(Boolean);
      if (patch.taxonomyId !== undefined && patch.taxonomyId !== null && patch.taxonomyId !== '') patch.taxonomyId = Number(patch.taxonomyId);
      const next = setDeposit(ws(), patch, `MaveDB details set by ${author}: ${Object.keys(patch).join(', ')}`);
      const changed = next !== ws();
      if (changed) store.commit(next, 'Change the MaveDB details');
      return { message: changed ? `Set the MaveDB details: ${Object.keys(patch).join(', ')}.` : 'The MaveDB details are as they were.', data: { details: ws().deposit ?? {} } };
    },

    async check_target(args) {
      const w = ws();
      const designTarget = w.design?.targets?.[0]?.id;
      const name = args.target ? choose(args.target, w.targets.map((t) => t.name), 'target') : null;
      const target = name ? w.targets.find((t) => t.name === name) : w.targets.find((t) => t.id === designTarget) ?? w.targets[0];
      if (!target) throw new ActionError('There is no target: open its FASTA first.');
      const check = await checkTarget(app, target, args.accession ?? null);
      if (!check.ok) throw new ActionError(check.message);
      const changes = Object.keys(check.patch);
      if (args.apply) applyCheck(app, target, check);
      const p = check.placement;
      const data = {
        target: target.name,
        entry: { accession: check.entry.accession, name: check.entry.name, gene: check.entry.gene, organism: check.entry.organism, length: check.entry.length, reviewed: check.entry.reviewed },
        retrieval: check.retrieval,
        placement: { offset: p.offset, start: p.start, end: p.end, identical: p.identical, differences: p.differences, outside: p.outside, places: p.places },
        changes: check.patch,
        applied: Boolean(args.apply),
      };
      const what = changes.length ? (args.apply ? ` Set ${changes.join(', ')}, and recorded the check.` : ` It would change ${changes.join(', ')} (apply: true to use them).`) : (args.apply ? ' Nothing to change; recorded the check.' : ' Nothing to change.');
      return { message: `${placementText(target, check)}${what} (UniProt ${retrievalText(check.retrieval) || 'entry'}.)`, data };
    },

    // Checks a table as scoring would, without scoring (mavescape validate; mavescape run checks
    // first): its names against the design's target, its problems, the design against its
    // columns, and the parameters against the design. design: one to check (else the
    // workspace's, if any). valid: nothing blocks scoring.
    async check(args) {
      const design = args.design ?? ws().design ?? null;
      if (design && (typeof design !== 'object' || design.format !== 'mavescape-design')) throw new ActionError('The design must be a mavescape-design document (docs/FORMATS.md).');
      // A design alone: its structure, without a table to check its columns against.
      if (!ws().sources.length) {
        if (!design) throw new ActionError('Give a table to check, a design, or both.');
        const d = designSummary(design, null);
        const blocking = d.problems.map((m) => `The design: ${m}`);
        const ready = readiness(ws(), { design });
        return {
          message: blocking.length ? `Not valid: ${plural(blocking.length, 'problem')} in the design. ${blocking.join(' ')}` : `Valid: the design (${shapeOf(d)}), checked without its table.${d.warnings.length ? ` ${plural(d.warnings.length, 'warning')}: ${d.warnings.join(' ')}` : ''}`,
          data: { valid: !blocking.length, table: null, design: d, blocking, warnings: d.warnings, readiness: ready, readinessText: readinessText(ready, { all: false }) },
        };
      }
      const source = design ? await readCodonsFor(app, resolveSource(args.table), design).catch((error) => { throw new ActionError(error.message); }) : resolveSource(args.table);
      const table = await app.sourceTable(source);
      const mapping = source.mapping ?? {};
      const target = design?.targets?.[0] ?? ws().targets.find((t) => t.id === source.target) ?? null;
      const barcodeColumn = design ? (design.library?.level === 'barcode' ? design.library.barcodeColumn : undefined) : mapping.barcodeColumn;
      const review = reviewImport(table, {
        variantColumn: design?.variants?.column ?? mapping.variantColumn,
        level: design?.variants?.level ?? mapping.level,
        countColumns: design ? (design.samples ?? []).flatMap((x) => x.columns ?? []) : mapping.countColumns ?? [],
        target,
        barcodeColumn,
      });
      const d = design ? designSummary(design, source) : null;
      let parameterErrors = [];
      if (design && d.valid && design.model !== 'scores') {
        const presetId = choose(args.preset ?? 'mavescape', Object.keys(PRESETS), 'preset');
        const base = defaultParameters(design, source, presetId);
        const extra = args.parameters ?? {};
        parameterErrors = checkParameters(withDefaults({ ...base, ...extra, filters: { ...base.filters, ...(extra.filters ?? {}) } }), design).errors;
      }
      // A column the design names and the table lacks is said once, by the design.
      const designText = d ? d.problems.join(' ') : '';
      const missing = (message) => /has no column "([^"]+)"/.exec(message)?.[1];
      const blocking = [
        ...review.blocking.filter((x) => !(missing(x.message) && designText.includes(`"${missing(x.message)}"`))).map((x) => `The table: ${x.message}`),
        ...(d ? d.problems.map((m) => `The design: ${m}`) : []),
        ...parameterErrors.map((m) => `The parameters: ${m}`),
        ...(target ? [] : ['There is no target to check the variant names against: give its sequence (a FASTA file) or a design with its target.']),
      ];
      const warnings = [...review.warnings.map((x) => x.message), ...(d ? d.warnings : [])];
      const sum = review.summary ?? {};
      // What each analysis can do with these files, and what is missing (wave 2, slice 10).
      const ready = design ? readiness({ ...ws(), designSource: source.id }, { design }) : readiness({ ...ws(), designSource: source.id });
      const data = {
        valid: !blocking.length,
        readiness: ready,
        readinessText: readinessText(ready, { all: false }),
        table: { name: source.name, rows: table.rows, layout: source.layout ?? null, variantColumn: design?.variants?.column ?? mapping.variantColumn ?? null, level: design?.variants?.level ?? mapping.level ?? null, target: target?.name ?? null, names: { valid: sum.valid ?? 0, readLeniently: sum.warning ?? 0, invalid: sum.invalid ?? 0, byKind: sum.byKind ?? {} } },
        design: d,
        blocking,
        warnings,
      };
      const message = blocking.length
        ? `Not valid: ${plural(blocking.length, 'problem')} ${blocking.length > 1 ? 'block' : 'blocks'} scoring. ${blocking.join(' ')}`
        : `Valid: ${source.name}, ${plural(table.rows, 'row')} (${data.table.names.valid} names valid${data.table.names.readLeniently ? `, ${data.table.names.readLeniently} read leniently` : ''})${d ? `, with the design (${shapeOf(d)})` : ''}.${warnings.length ? ` ${plural(warnings.length, 'warning')}: ${warnings.join(' ')}` : ''}`;
      return { message, data };
    },

    // Recomputes a saved run from its recorded inputs and checks its output hash (mavescape run
    // --from-workspace): refused, saying why, when it does not reproduce.
    async reproduce_run(args) {
      const run = resolveRun(args.run);
      forgetResults(app, run);
      const entry = await ensureResults(app, run);
      const recomputed = entry.results ? outputDigest(entry.results) : null;
      const data = { run: run.name, id: run.id, status: entry.status, recorded: run.output.sha256, recomputed };
      if (entry.status !== 'reproduced') throw new ActionError(`${run.name} (${run.id}) did not reproduce: ${entry.status === 'differs' ? entry.message : `its scores could not be recomputed: ${entry.message}`}`);
      app.focusItem({ kind: 'run', id: run.id });
      return { message: `${run.name} (${run.id}) reproduced from its recorded inputs: output SHA-256 ${recomputed.slice(0, 16)}…, as recorded.`, data: { ...runSummary(run), ...data } };
    },

    async score(args) {
      const source = resolveSource();
      const design = ws().design;
      if (!design) throw new ActionError('There is no design yet: draft it (draft_design) or set it (set_design) first.');
      const presetId = choose(args.preset ?? 'mavescape', Object.keys(PRESETS), 'preset');
      const base = defaultParameters(design, source, presetId);
      const extra = args.parameters ?? {};
      const parameters = withDefaults({ ...base, ...extra, filters: { ...base.filters, ...(extra.filters ?? {}) } });
      const problems = [];
      problems.push(...validateDesign(design, { columns: source.columns.map((c) => c.name) }).errors.map((e) => `The design: ${e.message}`));
      problems.push(...(source.problems?.blocking ?? []).map((m) => `The table: ${m}`));
      problems.push(...checkParameters(parameters, design).errors);
      if (problems.length) throw new ActionError(`Scoring is refused: ${problems.join(' ')}`);
      const inputs = runInputs({ source, design, parameters });
      const existing = ws().runs.find((r) => r.id === runId(inputs));
      if (existing) {
        app.focusItem({ kind: 'run', id: existing.id });
        await show('score');
        return { message: `${existing.name} has the same table, design and parameters: it is shown (a run is never computed twice).`, data: { ...runSummary(existing), existing: true } };
      }
      const wsId = ws().id;
      store.setBusy?.('score', 'Scoring…');
      let result;
      try {
        const table = await app.sourceTable(source);
        const { names, barcodes, columns, transfer } = workerInput(table, design);
        result = await runScore(app, { names, barcodes, columns, design, parameters, mode: source.mapping?.mode ?? 'lenient' }, { transfer }).promise;
      } finally {
        store.setBusy?.('score', null);
      }
      if (ws().id !== wsId) throw new ActionError('Another workspace was opened while scoring; the run was not added.');
      if (!result.ok) throw new ActionError(`Scoring is refused: ${result.errors.join(' ')}`);
      const run = makeRun({ inputs, source, results: result.results, software: { version: app.version, commit: app.commit }, name: nextRunName(ws()) });
      app.runResults ??= new Map();
      app.runResults.set(run.id, { results: result.results, status: 'computed' });
      store.commit(addRun(ws(), run).ws, `Score: ${run.name} (${author})`);
      app.focusItem({ kind: 'run', id: run.id });
      app.log(`${run.name} (${run.id}), scored for ${author}: output SHA-256 ${run.output.sha256.slice(0, 12)}…`);
      await show('score');
      const c = result.results.conditions;
      // DiMSum's fitted model, per replicate: its scale and shift, and its error terms with the 10th–90th
      // percentiles of their bootstrap.
      const dimsum = result.results.dimsum ? result.results.replicates.filter((r) => r.dimsum).map((r) => ({
        replicate: r.name, scale: round(r.dimsum.scale), shift: round(r.dimsum.shift),
        ...(r.dimsum.input === null ? {} : { input: round(r.dimsum.input), output: round(r.dimsum.output), reperror: round(r.dimsum.reperror), intervals: r.dimsum.intervals && Object.fromEntries(Object.entries(r.dimsum.intervals).map(([k, v]) => [k, v.map((x) => round(x))])) }),
      })) : null;
      const differential = result.results.differential ? differentialSummary(result.results) : null;
      return { message: `${run.name}: ${c.map((x) => `${x.scored} of ${result.results.rows} variants scored${c.length > 1 ? ` in ${x.name}` : ''}`).join('; ')} (${PRESETS[presetId].label}).${dimsum?.[0]?.input !== undefined ? ` DiMSum's multiplicative terms: ${dimsum.map((x) => `${x.replicate} input ${x.input}, output ${x.output}`).join('; ')}.` : ''}${differential ? ` ${differential.map((x) => `${x.contrast} (${x.method}): ${x.lowerAtQ05 + x.higherAtQ05} of ${x.compared} differ at q < 0.05`).join('; ')}.` : ''}`, data: { ...runSummary(run), ...(dimsum ? { dimsum } : {}), ...(differential ? { differential } : {}) } };
    },

    async qc_findings(args) {
      const { sub, findings, overall: o, of } = await qcOfSubject(args.run);
      if (sub.run) markQcSeen(app, sub.run, o);
      app.qcView ??= { subject: null, finding: null, pair: 0 };
      app.qcView.subject = sub.id;
      if (args.finding) {
        const titles = findings.map((f) => f.title);
        const byId = findings.find((f) => f.id === args.finding);
        app.qcView.finding = byId?.id ?? findings.find((f) => f.title === choose(args.finding, titles, 'finding'))?.id;
      }
      await show('qc');
      return {
        message: `Quality control of ${of}: ${o.status === 'pass' ? 'every finding passes' : `${o.counts.fail} fail, ${o.counts.review} to review`}, ${o.counts.pass} pass${o.counts.na ? `, ${o.counts.na} not assessed` : ''}.${o.acknowledged.length ? ` Acknowledged: ${o.acknowledged.join(', ')}.` : ''}${o.blocking.length ? ` Blocking: ${o.blocking.join(', ')}.` : ''}`,
        data: { of, overall: o, findings: findings.map(findingSummary) },
      };
    },

    // Acknowledges a finding to review or failing with a reason (an empty reason withdraws it):
    // its status does not change; the reason goes into the history, the methods and the exports.
    async acknowledge_finding(args) {
      const { findings, of } = await qcOfSubject(args.run);
      const id = String(args.finding ?? '').trim();
      if (!id) throw new ActionError(`Name the finding to acknowledge: ${findings.filter((f) => f.status === 'review' || f.status === 'fail').map((f) => f.id).join(', ') || 'none is to review or failing'}.`);
      const finding = findings.find((f) => f.id === id) ?? findings.find((f) => f.title === choose(id, findings.map((x) => x.title), 'finding'));
      const reason = String(args.reason ?? '').trim();
      // A finding that passes (or is not assessed) needs no acknowledgement: said, not refused, so
      // that a script can acknowledge what it expects on every data set.
      if (reason && (finding.status === 'pass' || finding.status === 'na') && !finding.blocking) return { message: `"${finding.title}" ${finding.status === 'pass' ? 'passes' : 'is not assessed'} in the QC of ${of}: nothing to acknowledge.`, data: findingSummary(finding) };
      let next;
      try {
        next = acknowledgeFinding(ws(), finding, reason);
      } catch (error) {
        throw new ActionError(error.message);
      }
      if (next === ws()) return { message: `"${finding.title}" was not acknowledged; nothing to withdraw.`, data: findingSummary(finding) };
      app.store.commit(next, reason ? `Acknowledge "${finding.title}"` : `Withdraw the acknowledgement of "${finding.title}"`);
      const again = (await qcOfSubject(args.run)).findings.find((f) => f.id === finding.id);
      return { message: reason ? `Acknowledged "${finding.title}" (${finding.status}): ${reason}. Its status is unchanged; the reason goes into the history, the methods and the QC exports.` : `Withdrew the acknowledgement of "${finding.title}".`, data: findingSummary(again) };
    },

    async select_variants(args) {
      const run = resolveRun(args.run);
      const { results: own } = await resultsOf(run);
      const results = proteinView(own) ?? own;
      // A contrast's differential map, or a condition's (wave 4, slice 5).
      let contrast = null;
      if (args.contrast !== undefined && args.contrast !== null && args.contrast !== '') {
        const names = (own.differential ?? []).map((d) => d.name);
        if (!names.length) throw new ActionError(`${run.name} compares no conditions: score it with two conditions and a contrast first.`);
        contrast = /^\d+$/.test(String(args.contrast)) ? Number(args.contrast) - 1 : names.indexOf(choose(args.contrast, names, 'contrast'));
        if (contrast < 0 || contrast >= names.length) throw new ActionError(`There ${names.length === 1 ? 'is 1 contrast' : `are ${names.length} contrasts`}: ${names.join(', ')}.`);
      }
      const condition = contrast === null ? resolveCondition(own, args.condition) : own.conditions.findIndex((c) => c.id === own.differential[contrast].condition);
      const model = buildMapModel(results, run.inputs.design, contrast === null ? { condition } : { contrast, colorBy: 'differential' });
      const byName = new Map();
      const atPosition = new Map();
      for (let p = 1; p <= model.length; p += 1) {
        for (let r = 0; r < model.rows.length; r += 1) {
          const cell = cellAt(model, p, r);
          if (cell.state === STATE.NOT_DESIGNED) continue;
          byName.set(cellName(model, cell), cell);
          if (!atPosition.has(p)) atPosition.set(p, []);
          if (!cell.reference) atPosition.get(p).push(cell);
        }
      }
      if (!args.query && !args.variants?.length && !args.positions?.length) throw new ActionError('Give "query" (missense at 40-80 with se < 0.2), "variants" or "positions".');
      const cells = [];
      const unknown = [];
      for (const name of args.variants ?? []) {
        const cell = byName.get(variantName(name));
        if (cell) cells.push(cell);
        else unknown.push(name);
      }
      for (const p of args.positions ?? []) {
        const at = atPosition.get(Number(p));
        if (at) cells.push(...at);
        else unknown.push(`position ${p}`);
      }
      if (unknown.length) throw new ActionError(`Not on ${possessive(run.name)} map: ${unknown.slice(0, 10).join(', ')}${unknown.length > 10 ? '…' : ''}. Variants are named as MAVE-HGVS single substitutions (p.Trp36Ala) on positions 1–${model.length}.`);
      // A query; one that needs the run's robustness checks it first (seeded: the same each time).
      let query = null;
      if (args.query) {
        const map = { model, results, own };
        let found;
        try {
          found = await runQuery(app, run, String(args.query), map).catch(async (error) => {
            if (!(error instanceof QueryError) || error.need !== 'robustness') throw error;
            const state = await checkRobustness(app, run);
            if (state.status !== 'done') throw new ActionError(`The query needs ${possessive(run.name)} robustness checked, and it could not be: ${state.error}`);
            return runQuery(app, run, String(args.query), map);
          });
        } catch (error) {
          if (error instanceof QueryError) throw new ActionError(`${error.message}${error.position >= 0 ? ` (at character ${error.position + 1} of the query)` : ''}`);
          throw error;
        }
        cells.push(...found.keys.map((k) => byName.get(k)));
        query = found.query;
      }
      const states = { scored: [STATE.SCORED], low: [STATE.LOW], filtered: [STATE.FILTERED], missing: [STATE.MISSING] };
      const filter = args.filter ? choose(args.filter, Object.keys(states), 'filter') : null;
      const keep = filter ? states[filter] : null;
      const keys = [...new Set(cells.filter((c) => !keep || keep.includes(c.state)).map((c) => cellName(model, c)))];
      if (!keys.length && !args.query) throw new ActionError('No variants match: give "variants" or "positions" (and a "filter" that some of them pass).');
      // The selection's query, when a query alone made it ("scored" as the filter: scored without
      // low confidence, the query's "confident").
      const made = query && !args.variants?.length && !args.positions?.length ? (filter ? `(${query}) and ${{ scored: 'confident', low: 'low', filtered: 'filtered', missing: 'missing' }[filter]}` : query) : null;
      const operation = args.operation ? choose(args.operation, OPERATIONS, 'operation') : 'replace';
      const sel = store.ui.selection;
      const current = sel && sel.run === run.id && sel.condition === condition ? sel : null;
      const next = combineSelections(current, { keys, query: made }, operation);
      app.mapView ??= { colorBy: 'score', rowOrder: 'biochemical', palette: 'rdbu', condition: 0, page: 0 };
      app.mapView.run = run.id;
      if (contrast === null) {
        app.mapView.condition = condition;
        if (app.mapView.colorBy === 'differential') app.mapView.colorBy = 'score';
      } else {
        app.mapView.colorBy = 'differential';
        app.mapView.contrast = contrast;
      }
      store.setUI({ selection: next.keys.length ? { run: run.id, condition, keys: next.keys, ...(next.query ? { query: next.query } : {}) } : null }, ['selection']);
      let saved = null;
      if (args.save_as) {
        if (!next.keys.length) throw new ActionError('Nothing is selected to save.');
        const added = addSelection(ws(), { name: String(args.save_as), run: run.id, condition, keys: next.keys, ...(next.query ? { query: next.query } : {}) });
        store.commit(added.ws, `Save the selection "${args.save_as}" (${author})`);
        saved = String(args.save_as);
      }
      app.focusItem({ kind: 'run', id: run.id });
      await show('map');
      const where = `on ${possessive(run.name)} ${contrast === null ? '' : `${own.differential[contrast].name} `}map`;
      const what = operation === 'replace' ? '' : ` (${plural(keys.length, 'variant')} matched: ${{ add: 'added to the selection', intersect: 'the selection kept where they are', subtract: 'taken from the selection' }[operation]})`;
      return { message: next.keys.length ? `Selected ${plural(next.keys.length, 'variant')} ${where}${what}${saved ? `, saved as "${saved}"` : ''}.` : `No variant ${where} matches${args.query ? ` "${args.query}"` : ''}${operation === 'replace' ? '' : ` once ${operation === 'intersect' ? 'intersected with' : 'taken from'} the selection`}; nothing is selected.`, data: { run: run.name, condition: own.conditions[condition].name, ...(contrast === null ? {} : { contrast: own.differential[contrast].name }), operation, matched: keys.length, count: next.keys.length, query: next.query, variants: next.keys, saved } };
    },

    async inspect_variant(args) {
      const run = resolveRun(args.run);
      const entry = await resultsOf(run);
      const own = entry.results;
      const condition = resolveCondition(own, args.condition);
      const name = variantName(args.variant);
      // A protein variant of a nucleotide run: its row in the run's protein view (wave 3, slice 3).
      const view = proteinView(own);
      const inView = view && own.variants.key.indexOf(name) < 0 && own.variants.original.indexOf(String(args.variant)) < 0 && view.variants.key.includes(name);
      const results = inView ? view : own;
      const c = results.conditions[condition];
      const v = results.variants;
      const row = v.key.indexOf(name) >= 0 ? v.key.indexOf(name) : v.original.indexOf(String(args.variant));
      app.focusItem({ kind: 'variant', id: row >= 0 ? v.key[row] : name, run: run.id, condition });
      await settle();
      if (row < 0) return { message: `${name} is not in ${possessive(run.name)} table: it was not measured (missing on the map, not "no effect").`, data: { variant: name, measured: false } };
      const reasons = c.reason[row] ? STAGE_BY_CODE.get(c.reason[row]) : null;
      // The replicates of the variant's tile (wave 3, slice 6): another tile's do not measure it.
      const tiles = new Map((run.inputs.design.library?.tiles ?? []).map((t) => [t.id, t]));
      const replicates = results.replicates.filter((r) => c.replicates.includes(r.id) && coversPosition(r, tiles, v.position[row])).map((r) => ({
        name: r.name, before: round(r.first[row]), after: round(r.last[row]), score: round(r.score[row]), se: round(r.se[row]), used: !r.state[row], state: r.state[row] ? REPLICATE_STATE_NAMES[r.state[row]] : 'used',
        // A regression's time points used and departure from a line (χ²/df against counting).
        ...(r.points ? { timePoints: r.points[row], departure: round(r.fit[row]) } : {}),
        // Sorted bins: the reads in each bin.
        ...(r.bins ? { readsByBin: r.samples.map((id) => { const x = (results.samples ?? []).find((sm) => sm.id === id)?.counts[row]; return Number.isFinite(x) ? x : null; }) } : {}),
        // A table of barcodes: the variant's barcodes measured in the replicate, and its outliers.
        ...(r.barcodes ? { barcodesMeasured: r.barcodes.measured[row], outlierBarcodes: r.barcodes.outlier ? Array.from(results.barcodes.members.subarray(results.barcodes.offsets[row], results.barcodes.offsets[row + 1])).filter((m) => r.barcodes.outlier[m]).map((m) => results.barcodes.ids[m]) : [] } : {}),
      }));
      const data = {
        variant: v.key[row],
        asWritten: v.original[row],
        class: KIND_NAMES[v.kind[row]],
        position: v.position[row] > 0 ? v.position[row] : null,
        // A nucleotide variant's protein change; a protein variant's nucleotide variants, each scored.
        ...(v.proKey ? { protein: v.proKey[row] || null, proteinPosition: v.proPosition[row] > 0 ? v.proPosition[row] : null } : {}),
        ...(inView ? { nucleotideVariants: Array.from(v.members[row], (r) => ({ variant: own.variants.key[r], score: own.conditions[condition].reason[r] ? null : round(own.conditions[condition].score[r]), se: own.conditions[condition].reason[r] ? null : round(own.conditions[condition].se[r]) })), merged: v.members[row].length > 1 ? (Array.from(v.members[row]).every((r) => own.conditions[condition].reason[r] || own.conditions[condition].se[r] > 0) ? 'inverse-variance mean, as DiMSum merges them' : 'mean (not every one has an SE)') : null } : {}),
        condition: c.name,
        score: reasons ? null : round(c.score[row]),
        se: reasons ? null : round(c.se[row]),
        ci95: reasons ? null : intervalOf(c, row).map((x) => round(x)),
        ...(c.df && !reasons ? { df: Number.isFinite(c.df[row]) ? round(c.df[row]) : null } : {}),
        // Rescaled: the anchors' uncertainty at this score, shared by every score (SE_scale).
        ...(c.rescale && !reasons ? { seScale: round(anchorUncertainty(results, run.inputs.design, condition).at(c.score[row])) } : {}),
        replicatesUsed: c.k[row],
        replicatesExpected: c.expected[row],
        tau2: round(c.tau2[row]),
        i2: round(c.i2[row]),
        lowConfidence: c.flags[row] ? flagNames(c.flags[row]) : [],
        notScored: reasons ? { stage: reasons.label, reason: reasons.reason } : null,
        replicates,
        // Each contrast's difference for the variant (null where there is none, with why).
        ...(results.differential ? { differential: results.differential.map((d) => (d.reason[row]
          ? { contrast: d.name, method: d.method, notEstimated: DIFFERENTIAL_REASON_NAMES[d.reason[row]] }
          : { contrast: d.name, method: d.method, difference: round(d.delta[row]), se: round(d.se[row]), ci95: [round(d.ciLow[row]), round(d.ciHigh[row])], p: round(d.p[row]), q: round(d.q[row]), ...(d.method === 'limma' ? { t: round(d.z[row]) } : { pairs: d.k[row] }) })) } : {}),
        counts: Object.fromEntries((results.samples ?? []).map((s) => [s.name, Number.isFinite(s.counts[row]) ? s.counts[row] : null])),
        run: run.name,
        reproduced: entry.status,
      };
      // MaveDB's mapping of the variant to the human reference, when its table was opened with it.
      if (!inView) {
        const mapped = await mappedFor(app, run, row);
        if (mapped !== undefined) data.mapped = mapped;
      }
      // Its annotations, from the tracks of the workspace's annotations (wave 3, slice 5).
      if (ws().annotations?.length) {
        const state = await runTrackState(app, run, { condition });
        const position = v.proPosition ? v.proPosition[row] : v.position[row];
        const seen = new Set();
        data.annotations = [];
        for (const key of [v.key[row], v.proKey?.[row]].filter(Boolean)) {
          for (const item of annotationsOf(state.tracks.filter((t) => t.annotation), key, position)) {
            if (seen.has(item.track.id)) continue;
            seen.add(item.track.id);
            data.annotations.push({ track: item.track.label, source: sourceText(item.track.source), text: item.text });
          }
        }
      }
      const message = reasons
        ? `${data.variant} (${data.class}) is not scored: ${reasons.id === 'measured' ? 'not counted in every sample of any replicate' : `filtered at "${reasons.label}": ${reasons.reason}`}.`
        : `${data.variant} (${data.class}${data.protein ? `, ${data.protein}` : ''}): score ${data.score}${data.se === null ? '' : ` ± ${data.se} (95% CI ${data.ci95[0]} to ${data.ci95[1]})`}${c.published ? ' as published' : ` from ${data.replicatesUsed} of ${data.replicatesExpected} replicates`}${data.nucleotideVariants ? `, from ${data.nucleotideVariants.length} nucleotide variant${data.nucleotideVariants.length > 1 ? `s (${data.merged})` : ''}` : ''}${data.lowConfidence.length ? `; low confidence: ${data.lowConfidence.join('; ')}` : ''}.`;
      return { message, data };
    },

    async render_map(args) {
      const run = resolveRun(args.run);
      const { results } = await resultsOf(run);
      const condition = resolveCondition(results, args.condition);
      app.mapView ??= { colorBy: 'score', rowOrder: 'biochemical', palette: 'rdbu', condition: 0, show: 'all', page: 0 };
      const view = app.mapView;
      if (args.color_by) view.colorBy = choose(args.color_by, Object.keys(COLOR_BY).filter((k) => k !== 'differential' || results.differential?.length), 'coloring');
      if (args.contrast !== undefined) {
        const names = (results.differential ?? []).map((d) => d.name);
        view.contrast = names.indexOf(choose(args.contrast, names, 'contrast'));
        view.colorBy = 'differential';
      }
      if (args.rows) view.rowOrder = choose(args.rows, Object.keys(ROW_ORDERS), 'row order');
      if (args.palette) view.palette = choose(args.palette, ['rdbu', 'puor'], 'palette');
      view.run = run.id;
      view.condition = condition;
      app.focusItem({ kind: 'run', id: run.id });
      await show('map');
      if (args.zoom !== undefined) {
        const zoom = Number(args.zoom);
        if (!(zoom > 0)) throw new ActionError('zoom is a positive number (above 1 zooms in).');
        app.mapControl?.fit();
        if (zoom !== 1) app.mapControl?.zoom(zoom);
        await settle();
      }
      const model = modelOf(run, results, condition, view);
      const counts = Object.fromEntries(STATE_NAMES.map((name, i) => [name, model.counts[i]]));
      const lines = describeMap(model, proteinView(results) ?? results);
      return { message: lines.join(' '), data: { run: run.name, condition: model.contrast ? null : results.conditions[condition].name, ...(model.contrast ? { contrast: model.contrast.name } : {}), colorBy: model.colorBy, rows: view.rowOrder, palette: view.palette, counts, description: lines } };
    },

    // --- Tracks (wave 3, slice 5) -------------------------------------------------------------------

    // The tracks beside a run's map, in order: each one's id, kind, source, whether shown, its
    // filter and what it holds; the annotations that could not be read; what can be added.
    async list_tracks(args) {
      const run = resolveRun(args.run);
      const { results } = await resultsOf(run);
      const state = await runTrackState(app, run, { condition: resolveCondition(proteinView(results) ?? results, args.condition) });
      const target = trackTarget(run.inputs.design.targets?.[0], ws().targets);
      const source = ws().sources.find((x) => x.sha256 === run.inputs.source.sha256);
      const origin = source?.origin?.database === 'MaveDB' ? { urn: source.origin.urn } : null;
      const available = PROVIDERS.map((p) => ({ provider: p.id, name: p.name, kind: p.kind, what: p.what, ...(p.kind === 'public' ? { unavailable: p.needs(target, { origin, urn: p.id === 'mavedb-scores' ? 'given' : null }) } : {}), ...(p.id === 'mavedb-scores' ? { needs: 'urn' } : {}) }));
      const tracks = state.arranged.map((t) => trackData(t, state.notes));
      const shown = tracks.filter((t) => t.shown).length;
      return { message: `${run.name}: ${plural(tracks.length, 'track')}, ${shown} shown (${tracks.filter((t) => t.shown).map((t) => t.label).join(', ') || 'none'}).${state.problems.length ? ` Not read: ${state.problems.map((p) => `${p.annotation.name}: ${p.message}`).join(' ')}` : ''}`, data: { run: run.name, tracks, problems: state.problems.map((p) => ({ annotation: p.annotation.id, name: p.annotation.name, problem: p.message })), available } };
    },

    // Adds an annotation's tracks: from public data (provider: uniprot-features, pdbe-conservation,
    // alphamissense, clinvar, gnomad, mavedb-annotations), or a file given as name and text (an
    // alignment, a predictor's table, a custom track).
    async add_track(args) {
      const run = resolveRun(args.run);
      await resultsOf(run);
      let result;
      if (args.text !== undefined) {
        if (!args.name) throw new ActionError('Give the file\'s name with its text (name: "grb2-sh3.sto").');
        result = await addFileTrack(app, run, { name: String(args.name), text: String(args.text) });
      } else {
        const id = choose(args.provider, PROVIDERS.filter((p) => p.kind === 'public').map((p) => p.id), 'provider');
        // A MaveDB score set by its URN (wave 4, slice 3), with what a higher score means.
        const direction = args.direction ? choose(args.direction, ['higher-more', 'higher-less', 'unsigned'], 'direction') : null;
        result = await addPublicTrack(app, run, id, { quiet: true, urn: args.urn ?? null, direction });
      }
      if (!result.ok) throw new ActionError(result.message);
      await settle();
      return { message: result.message, data: { annotation: result.id, name: result.name, tracks: result.tracks.map((t) => ({ label: t.label, kind: t.kind, summary: describeTrack(t) })), notes: result.notes, ...(result.scoreSet ? { scoreSet: result.scoreSet } : {}) } };
    },

    // Shows or hides a track, moves it (position from 1), or filters it: { types }, { classes,
    // stars }, { min } (list_tracks names each track's filters and their options).
    async set_track(args) {
      const run = resolveRun(args.run);
      await resultsOf(run);
      const state = await runTrackState(app, run);
      const ids = state.arranged.map((t) => t.id);
      const labels = state.arranged.map((t) => t.label);
      const ref = String(args.track ?? '');
      const track = state.arranged.find((t) => t.id === ref) ?? state.arranged[labels.indexOf(choose(ref, labels, 'track'))];
      const change = { id: track.id };
      if (args.shown !== undefined) change.shown = Boolean(args.shown);
      if (args.position !== undefined) {
        const to = Number(args.position);
        if (!Number.isInteger(to) || to < 1 || to > ids.length) throw new ActionError(`position is from 1 to ${ids.length}.`);
        change.to = to - 1;
      }
      if (args.filter !== undefined) {
        const offered = trackFilters(track);
        const filter = {};
        for (const [key, value] of Object.entries(args.filter ?? {})) {
          const f = offered.find((x) => x.id === key);
          if (!f) throw new ActionError(`${track.label} has ${offered.length ? `the filters ${offered.map((x) => x.id).join(', ')}` : 'no filter'}; not "${key}".`);
          if (key === 'types' || key === 'classes') {
            const list = (Array.isArray(value) ? value : [value]).map((v) => choose(v, f.options.map(String), key === 'types' ? 'kind of feature' : 'class'));
            filter[key] = f.options.filter((o) => list.includes(String(o)));
          } else if (key === 'stars') {
            if (!f.options.includes(Number(value))) throw new ActionError('stars is from 0 to 4.');
            filter.stars = Number(value);
          } else if (key === 'min') {
            if (!(Number(value) > 0)) throw new ActionError('min is a positive number.');
            filter.min = Number(value);
          }
        }
        change.filter = filter;
      }
      if (Object.keys(change).length === 1) throw new ActionError('Say what to change: shown, position or filter.');
      arrangeTrack(app, state.tracks, change);
      await settle();
      const after = await runTrackState(app, run);
      const now = after.arranged.find((t) => t.id === track.id);
      return { message: `${now.label}: ${now.shown ? 'shown' : 'hidden'}, ${after.arranged.indexOf(now) + 1} of ${after.arranged.length}${now.filtered ? `, filtered: ${now.filtered}` : ''}.`, data: { track: trackData(now, after.notes), order: after.arranged.map((t) => t.id) } };
    },

    // Removes an annotation and its tracks (by its id or name).
    async remove_track(args) {
      const list = ws().annotations ?? [];
      if (!list.length) throw new ActionError('The workspace has no annotation to remove.');
      const ref = String(args.annotation ?? args.track ?? '').replace(/:.*$/, '');
      const a = list.find((x) => x.id === ref) ?? list.find((x) => x.name === choose(ref, list.map((y) => y.name), 'annotation'));
      removeTrack(app, a.id);
      await settle();
      return { message: `Removed ${a.name} and its tracks.`, data: { removed: a.id } };
    },

    // Checks a run's robustness to other analysis choices (wave 4, slice 4): scored again across
    // the alternatives (each alone, then seeded combinations; max: how many analyses in all), and
    // what each variant's class, effect and inclusion do. Shows the run in Score.
    async check_robustness(args) {
      const run = resolveRun(args.run);
      if (run.inputs.parameters?.model === 'published') throw new ActionError('Published scores are read as published: there is no analysis of theirs to vary.');
      await resultsOf(run);
      const max = args.max === undefined ? DEFAULT_MAX_SPECIFICATIONS : Number(args.max);
      if (!Number.isInteger(max) || max < 2 || max > 256) throw new ActionError('max is a whole number of analyses from 2 to 256.');
      // A check of another size is made again.
      const kept = app.robustness?.get(run.id);
      if (kept && kept.status !== 'running' && kept.max !== max) app.robustness.delete(run.id);
      app.focusItem({ kind: 'run', id: run.id });
      await app.setMode('score');
      const state = await checkRobustness(app, run, { max });
      if (state.status !== 'done') throw new ActionError(`${possessive(run.name)} robustness could not be checked: ${state.error}`);
      await settle();
      const { summary } = state;
      const data = JSON.parse(robustnessJSON(summary, run, state.results.map(({ kind, picks, label, ok, error }) => ({ kind, picks, label, ok, error }))));
      return { message: `${run.name}, checked against ${summary.total - 1} alternative analyses. ${summary.targets.map((t) => `${t.name}: ${t.text}`).join(' ')}${state.notes?.length ? ` ${state.notes.join(' ')}` : ''}`, data: { ...data, notes: state.notes ?? [] } };
    },

    // Compares two sets of scores (wave 4, slices 1–3): each side a run's condition or replicate by
    // name ("Run 1", "Run 1: Replicate 2", "Published scores"), or a score set or predictor kept
    // beside the workspace (its name, "AlphaMissense: P62993", or a score set's URN; a URN not yet
    // kept is fetched and kept first, placed by the first side's run); the pair shown (or the
    // default) when not given. scale: scored, stated, nonsense-wt or synonymous-nonsense. direction:
    // what a higher score of the score set compared means. Shows the Compare view.
    async compare(args) {
      const w = ws();
      if (!w.runs.length) throw new ActionError('There is no score run to compare: score a run first.');
      const kept = currentPair(app);
      // A score set named by its URN, kept first when it is not yet.
      const placeBy = () => (kept?.a?.run ? w.runs.find((r) => r.id === kept.a.run) : null) ?? w.runs.at(-1);
      for (const key of ['a', 'b']) {
        const urn = args[key] ? normalizeUrn(String(args[key])) : null;
        if (!urn || comparableAnnotations(ws()).some((a) => a.record?.scoreSet?.urn === urn)) continue;
        const added = await addCompared(app, placeBy(), { urn, direction: args.direction ?? null, quiet: true });
        if (!added.ok) throw new ActionError(added.message);
      }
      const options = compareOptions(ws());
      const labels = options.map((o) => o.label);
      const side = (text) => {
        const urn = normalizeUrn(String(text));
        const byUrn = urn ? comparableAnnotations(ws()).find((a) => a.record?.scoreSet?.urn === urn) : null;
        if (byUrn) return { annotation: byUrn.id };
        const byName = comparableAnnotations(ws()).find((a) => a.name === text || a.id === text);
        if (byName) return { annotation: byName.id };
        return options.find((o) => o.label === choose(text, labels, 'side')).spec;
      };
      const now = currentPair(app);
      const pair = { a: args.a ? side(args.a) : now?.a, b: args.b ? side(args.b) : now?.b };
      if (!pair.a || !pair.b) throw new ActionError(`Give the two sides, a and b: ${labels.join(', ')}.`);
      // What a higher score of a score set compared means (MaveDB records none).
      if (args.direction !== undefined) {
        const direction = args.direction === null || args.direction === '' || args.direction === 'not stated' ? null : choose(args.direction, ['higher-more', 'higher-less', 'unsigned'], 'direction');
        const set = [pair.b, pair.a].map((spec) => (spec.annotation ? comparableAnnotations(ws()).find((a) => a.id === spec.annotation && a.record?.scoreSet) : null)).find(Boolean);
        if (!set) throw new ActionError('direction is what a higher score of a MaveDB score set means: neither side is one.');
        app.store.commit(setScoreSetDirection(ws(), set.id, direction), `${set.name}: what a higher score means`);
      }
      if (args.scale !== undefined) setScale(app, choose(args.scale, Object.keys(SCALES), 'scale'));
      // Filters by confidence and depth (wave 4, slice 2): those given replace the comparison's; none
      // given keeps them.
      const given = ['low_confidence', 'max_se', 'min_reads'].some((k) => args[k] !== undefined);
      const number = (x, what) => {
        if (x === null || x === undefined || x === '') return null;
        if (!Number.isFinite(Number(x)) || Number(x) < 0) throw new ActionError(`${what} is a number of 0 or more.`);
        return Number(x);
      };
      const filters = given ? { lowConfidence: args.low_confidence === true, maxSE: number(args.max_se, 'max_se'), minReads: number(args.min_reads, 'min_reads') } : currentFilters(app);
      if (given) setFilters(app, filters);
      if (args.show !== undefined) app.compareTab = choose(args.show, ['agreement', 'maps', 'disagreement', 'classes'], 'tab');
      setPair(app, pair);
      await app.setMode('compare');
      const c = await computeComparison(app, pair, filters, null, currentScale(app));
      if (c.error) throw new ActionError(c.error);
      await settle();
      const s = c.statistics;
      const f = (x) => (Number.isFinite(x) ? x.toFixed(3) : '—');
      const iv = (e, lo, hi) => `${f(e)} (${f(lo)} to ${f(hi)})`;
      const flagged = c.report.items.filter((i) => i.status !== 'ok');
      const d = c.discordance;
      const discordance = d?.valid ? ` ${d.discordant} of ${d.tested} differ beyond their uncertainty (q < 0.05); the differences are ${f(d.dispersion)} times as variable as the SEs say.` : '';
      const k = c.classes;
      const classes = k?.valid ? ` By ${k.predictor}'s classes: ${k.list.map((x) => `${x.label} ${x.n} (median ${f(x.median)})`).join(', ')}${Number.isFinite(k.auc?.auc) ? `; AUC ${iv(k.auc.auc, k.auc.low, k.auc.high)}` : ''}.` : '';
      const agreement = s
        ? `${s.pearson ? `Pearson's r ${iv(s.pearson.r, s.pearson.low, s.pearson.high)}, ` : ''}Spearman's ρ ${iv(s.spearman.rho, s.spearman.low, s.spearman.high)}${s.concordance ? `, Lin's concordance ${iv(s.concordance.ccc, s.concordance.low, s.concordance.high)}, bias ${f(s.blandAltman.bias)} with limits of agreement ${f(s.blandAltman.lower)} to ${f(s.blandAltman.upper)}` : k ? ' (a prediction, compared by rank)' : '; Lin\'s concordance and Bland–Altman withheld (not on one scale)'}`
        : '';
      const message = s
        ? `${c.a.label} and ${c.b.label}: ${c.matched.compared} variants compared${c.matched.compared !== c.matched.n ? ` of ${c.matched.n} scored on both sides` : ''}${c.scale?.applied ? ` (${c.scale.anchors ? 'rescaled by their anchors' : 'stated to be on one scale'})` : ''}. ${agreement}.${discordance}${classes}${flagged.length ? ` ${flagged.map((i) => `${i.label}: ${i.text}`).join(' ')}` : ''}`
        : `${c.a.label} and ${c.b.label} cannot be compared: ${flagged.filter((i) => i.status === 'blocked').map((i) => i.text).join(' ')}`;
      const { software, ...data } = JSON.parse(comparisonJSON(c));
      return { message, data };
    },

    async export(args) {
      const kinds = [...RUN_FILES, 'map', 'selection', 'archive', 'package', 'mavedb', 'tracks', 'comparison', 'comparison-positions', 'comparison-map', 'comparison-classes', 'robustness', 'robustness-positions', 'structure-mapping'];
      const what = choose(args.what, kinds, 'export');
      let file;
      // The target on the structure shown (wave 5, slice 2), position by position.
      if (what === 'structure-mapping') {
        const state = structureState(app);
        if (!state.mapping) throw new ActionError(state.viewer?.structure ? 'The target is not mapped onto the structure shown (map_structure says why).' : 'No structure is open: open one with open_structure.');
        const name = state.viewer.structure.meta.code || state.viewer.structure.label;
        return { file: mappingCSV(state.mapping, name), message: `The mapping of ${state.mapping.target.name} onto chain ${state.mapping.chain} of ${name}: ${state.mapping.target.length} positions.` };
      }
      // A run's robustness to analysis choices (wave 4, slice 4): its variants (CSV, or its record to
      // a path ending in .json) and its positions, checked first when it has not been.
      if (what.startsWith('robustness')) {
        const run = resolveRun(args.run);
        await resultsOf(run);
        const state = await checkRobustness(app, run);
        if (state.status !== 'done') throw new ActionError(`${possessive(run.name)} robustness could not be checked: ${state.error}`);
        const files = robustnessFiles(app, run, state);
        if (what === 'robustness-positions') return { file: files.positions.text, message: `${possessive(run.name)} positions across ${state.summary.total} analyses.` };
        const json = /\.json$/i.test(args.path ?? '');
        return { file: json ? files.json.text : files.csv.text, message: json ? `${possessive(run.name)} robustness: its record.` : `${possessive(run.name)} variants across ${state.summary.total} analyses.` };
      }
      // The comparison shown (wave 4, slices 1–3): its variants compared (CSV), or its report and
      // statistics (a path ending in .json); its disagreement by position (CSV); a map of it (SVG:
      // map first, second or difference, the default); a predictor by its classes (CSV).
      if (what.startsWith('comparison')) {
        const pair = currentPair(app);
        if (!pair) throw new ActionError('There is nothing to compare: score a run first, then compare (the action compare).');
        const c = await computeComparison(app, pair, currentFilters(app), null, currentScale(app));
        if (c.error) throw new ActionError(c.error);
        if (!c.statistics) throw new ActionError(`${c.a.label} and ${c.b.label} cannot be compared: ${c.report.items.filter((i) => i.status === 'blocked').map((i) => i.text).join(' ')}`);
        const files = comparisonFiles(app, c);
        if (what === 'comparison-positions') {
          if (!c.positions?.valid) throw new ActionError(`No disagreement by position: ${c.positions?.reason}`);
          return { file: files.positions.text, message: `The disagreement by position of ${c.a.label} and ${c.b.label}: ${c.positions.list.length} positions.` };
        }
        if (what === 'comparison-classes') {
          if (!c.classes?.valid) throw new ActionError(`No classes: ${c.classes?.reason ?? 'neither side is a predictor that classes its substitutions (AlphaMissense, EVE).'}`);
          return { file: files.classes.text, message: `${c.classes.measured}'s scores by ${c.classes.predictor}'s classes: ${c.classes.list.map((x) => `${x.label} ${x.n}`).join(', ')}.` };
        }
        if (what === 'comparison-map') {
          const which = choose(args.map ?? 'difference', ['first', 'second', 'difference'], 'map');
          const cm = c.level === 'protein' ? c : await computeComparison(app, pair, currentFilters(app), 'protein', currentScale(app));
          const svg = cm.statistics ? comparisonMapSVG(app, cm, which) : null;
          if (!svg) throw new ActionError(which === 'difference' ? `No difference map: ${c.sameScale ? 'the two cannot be drawn at the protein level' : 'the two are not on one scale'}.` : `No map of the ${which} side (nucleotide variants with no protein change to draw).`);
          return { file: svg, message: `The ${which} map of the comparison of ${c.a.label} and ${c.b.label} (SVG).` };
        }
        const json = /\.json$/i.test(args.path ?? '');
        return { file: json ? files.json.text : files.csv.text, message: json ? `The comparison of ${c.a.label} and ${c.b.label}: its report and statistics.` : `The comparison of ${c.a.label} and ${c.b.label}: ${c.matched.compared} variants compared.` };
      }
      // The analysis package (wave 2, slice 10): of a run when named, else of the current run, else
      // of the design with the default parameters.
      if (what === 'package') {
        const run = args.run ? resolveRun(args.run) : currentRun(ws());
        file = await packageFile(app, run);
        return { file: file.bytes, message: `The analysis package of "${ws().name}"${run ? `, ${run.name}` : ' (the design, with the default parameters)'}: counts, target, design, sample sheet, parameters and what is missing.` };
      }
      // A MaveDB deposit (wave 3, slice 4): one ZIP of the files MaveDB reads.
      if (what === 'mavedb') {
        const run = resolveRun(args.run);
        const { results } = await resultsOf(run);
        const condition = resolveCondition(results, args.condition);
        let made;
        try {
          made = await depositFile(app, run, condition);
        } catch (error) {
          throw new ActionError(error.message);
        }
        const r = made.deposit.report;
        return { file: made.bytes, message: `${possessive(run.name)} MaveDB deposit: ${r.variants.exported} variants${r.missing.length ? `; MaveDB requires what the workspace lacks: ${r.missing.map((m) => m.field).join(', ')}` : ', ready for MaveDB'}.`, data: { mode: r.mode, variants: r.variants, missing: r.missing, ready: r.ready, files: made.deposit.files.map((f) => f.name) } };
      }
      if (what === 'archive') {
        file = await archiveFile(app, { includeTables: args.include_tables !== false });
        return { file: file.bytes, message: `The workspace archive of "${ws().name}" (${plural(ws().runs.length, 'run')}${args.include_tables === false ? ', tables by checksum only' : ', with its tables'}).` };
      }
      if (what === 'selection') {
        const saved = args.selection ? ws().selections.find((s) => s.name === choose(args.selection, ws().selections.map((x) => x.name), 'saved selection')) : null;
        const sel = saved ?? (store.ui.selection ? { name: 'selection', ...store.ui.selection, created: now() } : null);
        if (!sel) throw new ActionError('There is no selection: select variants first (select_variants), or name a saved selection.');
        file = await selectionFile(app, sel, /\.json$/i.test(args.path ?? '') ? 'json' : 'csv');
        return { file: file.text, message: `${plural(sel.keys.length, 'selected variant')}${saved ? ` of "${saved.name}"` : ''}.` };
      }
      const run = resolveRun(args.run);
      const { results } = await resultsOf(run);
      const condition = resolveCondition(results, args.condition);
      if (what === 'map') {
        const model = modelOf(run, results, condition);
        const shown = (await runTrackState(app, run, { condition })).arranged.filter((t) => t.shown);
        const tracks = shown.length && shown.every((t) => t.length === model.length) ? shown : [];
        return { file: mapSVG(model, { palette: app.mapView?.palette ?? 'rdbu', results: proteinView(results) ?? results, tracks }), message: `${possessive(run.name)} map (SVG)${tracks.length ? `, with ${plural(tracks.length, 'track')}` : ''}.` };
      }
      if (what === 'tracks') {
        const state = await runTrackState(app, run, { condition });
        const shown = state.arranged.filter((t) => t.shown);
        return { file: tracksCSV(shown, state.model), message: `${possessive(run.name)} tracks shown, position by position (CSV): ${shown.map((t) => t.label).join(', ') || 'none'}.` };
      }
      file = await runFile(app, run, what, condition);
      return { file: file.text, message: `${run.name}: ${what}.` };
    },
  };

  // --- Connection -----------------------------------------------------------------------------

  async function perform(event) {
    let outcome;
    try {
      const handler = Object.hasOwn(actions, event.action) ? actions[event.action] : null;
      if (!handler) throw new ActionError(`Unknown action "${event.action}". Actions: ${Object.keys(actions).join(', ')}.`);
      const args = typeof event.args === 'object' && event.args ? event.args : {};
      author = event.client || 'a program on this computer';
      app.log(`${author}: ${event.action}${Object.keys(args).length ? ` ${JSON.stringify(args).slice(0, 200)}` : ''}`);
      const result = await handler(args, event);
      let message = result.message ?? 'Done.';
      // An export: the file goes to the program, which writes it where the caller asked.
      if (result.file !== undefined) {
        if (!event.output) throw new ActionError('Writing files needs the MaveScape program.');
        const response = await fetch(event.output, { method: 'POST', body: result.file, headers: { 'Content-Type': 'application/octet-stream' } });
        const written = await response.json().catch(() => ({}));
        if (!response.ok) throw new ActionError(`The file could not be written: ${written.error ?? `HTTP ${response.status}`}`);
        message = `Wrote ${written.path} (${written.bytes} bytes). ${message}`;
      }
      outcome = { ok: true, message, data: result.data ?? null };
    } catch (error) {
      outcome = { ok: false, message: error.message ?? String(error) };
      if (!(error instanceof ActionError)) console.error(error);
    }
    await fetch(`api/remote/result/${encodeURIComponent(event.id)}`, { method: 'POST', body: JSON.stringify(outcome), headers: { 'Content-Type': 'application/json' } }).catch(() => {});
  }

  let source = null;
  let announced = false;
  const connect = () => {
    source = new EventSource('api/remote/events');
    source.addEventListener('open', () => {
      if (!announced) app.log('Remote control is on: programs on this computer can drive this window (mavescape --remote-control).');
      announced = true;
    });
    source.addEventListener('action', (message) => {
      let event;
      try {
        event = JSON.parse(message.data);
      } catch {
        return;
      }
      perform(event);
    });
    source.onerror = () => {
      source.close();
      setTimeout(connect, 2000);
    };
  };
  connect();
  app.remoteActions = actions;
  toast('Remote control is on: programs on this computer can drive this window.', { timeout: 3000 });
  return { disconnect: () => source?.close() };
}
