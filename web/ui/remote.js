// Remote control (wave 2, slice 1): actions sent by programs on this computer (scripts, the
// documentation's screenshot capture, later AI agents through the MCP server) are performed here,
// in the open window, where the user sees them, they go into the history like any edit, and can be
// undone. Each action returns { ok, message, data }. The program lists the same actions with
// their arguments (actions.go, GET /api/remote/tools); a Go test checks the two lists agree.
// The connection and the export upload follow CytoWeave 0.8.0's web/ui/remote.js.

import { toast } from './overlays.js';
import { EXAMPLES } from '../lib/examples.js';
import { validateDesign, summarizeDesign } from '../lib/design.js';
import { checkParameters, defaultParameters, PRESETS, withDefaults } from '../lib/score.js';
import { addRun, makeRun, runId, runInputs } from '../lib/runs.js';
import { addSelection, createWorkspace, rename, setDesign } from '../lib/workspace.js';
import { currentRun, currentSource, focusStep, workflowSteps } from '../lib/workflow.js';
import { findingsFrom, overall, withDefaultThresholds } from '../lib/findings.js';
import { buildMapModel, cellAt, cellName, COLOR_BY, describeMap, ROW_ORDERS, STATE, STATE_NAMES } from '../lib/map-model.js';
import { mapSVG } from '../lib/map-svg.js';
import { flagNames, REPLICATE_STATE_NAMES, STAGE_BY_CODE } from '../lib/filters.js';
import { KIND_NAMES } from '../lib/variants.js';
import { openExample } from './examples.js';
import { draftFromColumns } from './design-draft.js';
import { ensureResults } from './run-results.js';
import { workerInput } from './score-input.js';
import { computeQc, markQcSeen, qcInputsOf, qcSubjects } from './mode-qc.js';
import { archiveFile, RUN_FILES, runFile, selectionFile } from './record.js';

export class ActionError extends Error {}

const round = (v, digits = 4) => (Number.isFinite(v) ? +v.toPrecision(digits) : null);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const ONE_TO_THREE = { A: 'Ala', R: 'Arg', N: 'Asn', D: 'Asp', C: 'Cys', Q: 'Gln', E: 'Glu', G: 'Gly', H: 'His', I: 'Ile', L: 'Leu', K: 'Lys', M: 'Met', F: 'Phe', P: 'Pro', S: 'Ser', T: 'Thr', W: 'Trp', Y: 'Tyr', V: 'Val', '*': 'Ter', X: 'Ter' };

// The views by the names scripts use.
const MODES = { start: 'welcome', welcome: 'welcome', experiment: 'experiment', design: 'experiment', qc: 'qc', 'quality control': 'qc', score: 'score', scores: 'score', map: 'map' };

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
    if (!entry?.results) throw new ActionError(`${run.name}'s scores could not be recomputed: ${entry?.message ?? 'unknown'}`);
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

  function modelOf(run, results, condition, view = app.mapView ?? {}) {
    return buildMapModel(results, run.inputs.design, { condition, rowOrder: view.rowOrder ?? 'biochemical', colorBy: view.colorBy ?? 'score' });
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
    };
  }

  function findingSummary(f) {
    return { id: f.id, title: f.title, status: f.status, blocking: Boolean(f.blocking), value: f.value, threshold: f.threshold, explanation: f.explanation, rationale: f.rationale };
  }

  // --- Actions --------------------------------------------------------------------------------

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
        tables: w.sources.map((s) => ({ name: s.name, rows: s.rows, layout: s.layout, countColumns: s.mapping?.countColumns ?? [], problems: s.problems?.blocking ?? [], current: s === source })),
        targets: w.targets.map((t) => ({ name: t.name, sequenceType: t.sequenceType, length: t.sequence.length, offset: t.offset ?? 0 })),
        design: w.design ? designSummary(w.design, source) : null,
        runs: w.runs.map(runSummary),
        selections: w.selections.map((s) => ({ name: s.name, run: w.runs.find((r) => r.id === s.run)?.name ?? s.run, variants: s.keys.length })),
        focus: store.ui.focus ?? null,
        selection: sel ? { run: w.runs.find((r) => r.id === sel.run)?.name ?? sel.run, condition: sel.condition, count: sel.keys.length, variants: sel.keys.slice(0, 100) } : null,
        steps: steps.map((s) => ({ id: s.id, label: s.label, state: s.state, detail: s.detail })),
        next: next ? { step: next.id, state: next.state, detail: next.detail, action: next.action?.label ?? null } : null,
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
      const before = { sources: ws().sources.length, targets: ws().targets.length };
      const { problems } = await app.importFiles(items, { accept: !args.review });
      await settle();
      const w = ws();
      const added = { tables: w.sources.slice(before.sources).map((s) => s.name), targets: w.targets.slice(before.targets).map((t) => t.name) };
      if (problems.length && !added.tables.length && !added.targets.length && !args.review) throw new ActionError(problems.join(' '));
      const parts = [];
      if (added.tables.length) parts.push(`the table${added.tables.length > 1 ? 's' : ''} ${added.tables.join(', ')}`);
      if (added.targets.length) parts.push(`the target${added.targets.length > 1 ? 's' : ''} ${added.targets.join(', ')}`);
      const message = `${parts.length ? `Opened ${parts.join(' and ')}` : `Read ${plural(files.length, 'file')}`}${args.review ? '; the import wizard is open for review' : ''}.${problems.length ? ` Problems: ${problems.join(' ')}` : ''}`;
      return { message, data: { ...added, problems } };
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
      return { message: `Drafted the design of ${source.name}: ${summary.model}, ${plural(summary.replicates, 'replicate')} of ${plural(summary.samples, 'sample')}. ${summary.valid ? 'It is valid.' : `${plural(summary.problems.length, 'problem')}: ${summary.problems.join(' ')}`}`, data: { design, ...summary } };
    },

    async set_design(args) {
      const design = args.design;
      if (!design || typeof design !== 'object') throw new ActionError('Give "design": a mavescape-design document (docs/FORMATS.md).');
      if (design.format !== 'mavescape-design') throw new ActionError('The design\'s format must be "mavescape-design".');
      const source = resolveSource(args.table);
      const result = validateDesign(design, { columns: source.columns.map((c) => c.name) });
      if (!result.ok) throw new ActionError(`The design does not fit ${source.name}: ${result.errors.map((e) => e.message).join(' ')}`);
      // The workspace's own target (with the same sequence) stands in for the design's copy.
      const own = ws().targets.find((t) => t.sequence === design.targets?.[0]?.sequence);
      const next = own ? { ...design, targets: [own, ...design.targets.slice(1)] } : design;
      store.commit(setDesign(ws(), next, `The design set by ${author}`, source.id), `Set the design (${author})`);
      await settle();
      const summary = designSummary(next, source);
      return { message: `Set the design of ${source.name}: ${summary.model}, ${plural(summary.replicates, 'replicate')}.${summary.warnings.length ? ` Warnings: ${summary.warnings.join(' ')}` : ''}`, data: summary };
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
        const { names, columns, transfer } = workerInput(table, design);
        result = await app.worker('score').run('score', { names, columns, design, parameters, mode: source.mapping?.mode ?? 'lenient' }, { transfer }).promise;
      } finally {
        store.setBusy?.('score', null);
      }
      if (ws().id !== wsId) throw new ActionError('Another workspace was opened while scoring; the run was not added.');
      if (!result.ok) throw new ActionError(`Scoring is refused: ${result.errors.join(' ')}`);
      const run = makeRun({ inputs, source, results: result.results, software: { version: app.version, commit: app.commit }, name: `Run ${ws().runs.length + 1}` });
      app.runResults ??= new Map();
      app.runResults.set(run.id, { results: result.results, status: 'computed' });
      store.commit(addRun(ws(), run).ws, `Score: ${run.name} (${author})`);
      app.focusItem({ kind: 'run', id: run.id });
      app.log(`${run.name} (${run.id}), scored for ${author}: output SHA-256 ${run.output.sha256.slice(0, 12)}…`);
      await show('score');
      const c = result.results.conditions;
      return { message: `${run.name}: ${c.map((x) => `${x.scored} of ${result.results.rows} variants scored${c.length > 1 ? ` in ${x.name}` : ''}`).join('; ')} (${PRESETS[presetId].label}).`, data: runSummary(run) };
    },

    async qc_findings(args) {
      const w = ws();
      const subjects = qcSubjects(w);
      if (!subjects.length) throw new ActionError('Quality control needs a count table and its design first.');
      let sub;
      if (/^counts$/i.test(String(args.run ?? ''))) {
        sub = subjects.find((s) => s.id === 'counts');
        if (!sub) throw new ActionError('There is no current design to check the counts with.');
      } else if (args.run || w.runs.length) {
        const run = resolveRun(args.run);
        sub = subjects.find((s) => s.id === `run:${run.id}`);
      } else {
        sub = subjects.find((s) => s.id === 'counts');
      }
      const inputs = qcInputsOf(w, sub);
      if (inputs.problem) throw new ActionError(inputs.problem);
      const entry = await computeQc(app, inputs);
      if (entry.status !== 'done') throw new ActionError(`Quality control failed: ${entry.message}`);
      const findings = findingsFrom(entry.qc, withDefaultThresholds(w.qc?.thresholds));
      const o = overall(findings);
      if (sub.run) markQcSeen(app, sub.run, o);
      app.qcView ??= { subject: null, finding: null, pair: 0 };
      app.qcView.subject = sub.id;
      if (args.finding) {
        const titles = findings.map((f) => f.title);
        const byId = findings.find((f) => f.id === args.finding);
        app.qcView.finding = byId?.id ?? findings.find((f) => f.title === choose(args.finding, titles, 'finding'))?.id;
      }
      await show('qc');
      const of = sub.run ? sub.run.name : 'the counts';
      return {
        message: `Quality control of ${of}: ${o.status === 'pass' ? 'every finding passes' : `${o.counts.fail} fail, ${o.counts.review} to review`}, ${o.counts.pass} pass${o.counts.na ? `, ${o.counts.na} not assessed` : ''}.${o.blocking.length ? ` Blocking: ${o.blocking.join(', ')}.` : ''}`,
        data: { of, overall: o, findings: findings.map(findingSummary) },
      };
    },

    async select_variants(args) {
      const run = resolveRun(args.run);
      const { results } = await resultsOf(run);
      const condition = resolveCondition(results, args.condition);
      const model = modelOf(run, results, condition);
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
      if (unknown.length) throw new ActionError(`Not on ${run.name}'s map: ${unknown.slice(0, 10).join(', ')}${unknown.length > 10 ? '…' : ''}. Variants are named as MAVE-HGVS single substitutions (p.Trp36Ala) on positions 1–${model.length}.`);
      const states = { scored: [STATE.SCORED], low: [STATE.LOW], filtered: [STATE.FILTERED], missing: [STATE.MISSING] };
      const keep = args.filter ? states[choose(args.filter, Object.keys(states), 'filter')] : null;
      const keys = [...new Set(cells.filter((c) => !keep || keep.includes(c.state)).map((c) => cellName(model, c)))];
      if (!keys.length) throw new ActionError('No variants match: give "variants" or "positions" (and a "filter" that some of them pass).');
      app.mapView ??= { colorBy: 'score', rowOrder: 'biochemical', palette: 'rdbu', condition: 0, show: 'all', page: 0 };
      app.mapView.run = run.id;
      app.mapView.condition = condition;
      store.setUI({ selection: { run: run.id, condition, keys } }, ['selection']);
      let saved = null;
      if (args.save_as) {
        const added = addSelection(ws(), { name: String(args.save_as), run: run.id, condition, keys });
        store.commit(added.ws, `Save the selection "${args.save_as}" (${author})`);
        saved = String(args.save_as);
      }
      app.focusItem({ kind: 'run', id: run.id });
      await show('map');
      return { message: `Selected ${plural(keys.length, 'variant')} on ${run.name}'s map${saved ? `, saved as "${saved}"` : ''}.`, data: { run: run.name, condition: results.conditions[condition].name, variants: keys, saved } };
    },

    async inspect_variant(args) {
      const run = resolveRun(args.run);
      const entry = await resultsOf(run);
      const { results } = entry;
      const condition = resolveCondition(results, args.condition);
      const c = results.conditions[condition];
      const v = results.variants;
      const name = variantName(args.variant);
      const row = v.key.indexOf(name) >= 0 ? v.key.indexOf(name) : v.original.indexOf(String(args.variant));
      app.focusItem({ kind: 'variant', id: row >= 0 ? v.key[row] : name, run: run.id, condition });
      await settle();
      if (row < 0) return { message: `${name} is not in ${run.name}'s table: it was not measured (missing on the map, not "no effect").`, data: { variant: name, measured: false } };
      const reasons = c.reason[row] ? STAGE_BY_CODE.get(c.reason[row]) : null;
      const replicates = results.replicates.filter((r) => c.replicates.includes(r.id)).map((r) => ({
        name: r.name, before: round(r.first[row]), after: round(r.last[row]), score: round(r.score[row]), se: round(r.se[row]), used: !r.state[row], state: r.state[row] ? REPLICATE_STATE_NAMES[r.state[row]] : 'used',
        // A regression's time points used and departure from a line (χ²/df against counting).
        ...(r.points ? { timePoints: r.points[row], departure: round(r.fit[row]) } : {}),
        // Sorted bins: the reads in each bin.
        ...(r.bins ? { readsByBin: r.samples.map((id) => { const x = (results.samples ?? []).find((sm) => sm.id === id)?.counts[row]; return Number.isFinite(x) ? x : null; }) } : {}),
      }));
      const data = {
        variant: v.key[row],
        asWritten: v.original[row],
        class: KIND_NAMES[v.kind[row]],
        position: v.position[row] > 0 ? v.position[row] : null,
        condition: c.name,
        score: reasons ? null : round(c.score[row]),
        se: reasons ? null : round(c.se[row]),
        ci95: reasons ? null : [round(c.score[row] - 1.959964 * c.se[row]), round(c.score[row] + 1.959964 * c.se[row])],
        replicatesUsed: c.k[row],
        replicatesExpected: c.expected[row],
        tau2: round(c.tau2[row]),
        i2: round(c.i2[row]),
        lowConfidence: c.flags[row] ? flagNames(c.flags[row]) : [],
        notScored: reasons ? { stage: reasons.label, reason: reasons.reason } : null,
        replicates,
        counts: Object.fromEntries((results.samples ?? []).map((s) => [s.name, Number.isFinite(s.counts[row]) ? s.counts[row] : null])),
        run: run.name,
        reproduced: entry.status,
      };
      const message = reasons
        ? `${data.variant} (${data.class}) is not scored: ${reasons.id === 'measured' ? 'not counted in every sample of any replicate' : `filtered at "${reasons.label}": ${reasons.reason}`}.`
        : `${data.variant} (${data.class}): score ${data.score} ± ${data.se} (95% CI ${data.ci95[0]} to ${data.ci95[1]}) from ${data.replicatesUsed} of ${data.replicatesExpected} replicates${data.lowConfidence.length ? `; low confidence: ${data.lowConfidence.join('; ')}` : ''}.`;
      return { message, data };
    },

    async render_map(args) {
      const run = resolveRun(args.run);
      const { results } = await resultsOf(run);
      const condition = resolveCondition(results, args.condition);
      app.mapView ??= { colorBy: 'score', rowOrder: 'biochemical', palette: 'rdbu', condition: 0, show: 'all', page: 0 };
      const view = app.mapView;
      if (args.color_by) view.colorBy = choose(args.color_by, Object.keys(COLOR_BY), 'coloring');
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
      const lines = describeMap(model, results);
      return { message: lines.join(' '), data: { run: run.name, condition: results.conditions[condition].name, colorBy: view.colorBy, rows: view.rowOrder, palette: view.palette, counts, description: lines } };
    },

    async export(args) {
      const kinds = [...RUN_FILES, 'map', 'selection', 'archive'];
      const what = choose(args.what, kinds, 'export');
      let file;
      if (what === 'archive') {
        file = await archiveFile(app, { includeTables: args.include_tables !== false });
        return { file: file.bytes, message: `The workspace archive of "${ws().name}" (${plural(ws().runs.length, 'run')}${args.include_tables === false ? ', tables by checksum only' : ', with its tables'}).` };
      }
      if (what === 'selection') {
        const saved = args.selection ? ws().selections.find((s) => s.name === choose(args.selection, ws().selections.map((x) => x.name), 'saved selection')) : null;
        const sel = saved ?? (store.ui.selection ? { name: 'selection', ...store.ui.selection, created: new Date().toISOString() } : null);
        if (!sel) throw new ActionError('There is no selection: select variants first (select_variants), or name a saved selection.');
        file = await selectionFile(app, sel, /\.json$/i.test(args.path ?? '') ? 'json' : 'csv');
        return { file: file.text, message: `${plural(sel.keys.length, 'selected variant')}${saved ? ` of "${saved.name}"` : ''}.` };
      }
      const run = resolveRun(args.run);
      const { results } = await resultsOf(run);
      const condition = resolveCondition(results, args.condition);
      if (what === 'map') {
        const model = modelOf(run, results, condition);
        return { file: mapSVG(model, { palette: app.mapView?.palette ?? 'rdbu', results }), message: `${run.name}'s map (SVG).` };
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
