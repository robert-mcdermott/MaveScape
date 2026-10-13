// Proposals (wave 7, slice 2): the changes an AI agent makes through "mavescape mcp" wait for the
// person at the window, who accepts or rejects them, all at once, in the strip above the view
// (ui/proposals.js). Scripts are not agents: their changes apply as the person's do, under the
// name they give (mavescape-spec/roadmap.md, wave 7). After CytoWeave 0.8.0's web/lib/proposals.js;
// what waits, and how, is MaveScape's.
//
// The workspace keeps the proposals still open (ws.proposals, absent when none is), one per agent:
// { id, author, opened, changes: [...] }. How each change waits:
//   - Made at once and marked proposed, so that the agent and the person can use it at once (draw
//     a run, compare it, select its variants): a table or a target opened, a run scored, a
//     selection saved, an annotation kept beside the map, a structure view saved, a figure made, an
//     analysis kept in the report, a checkpoint. The item carries proposed: { by, proposal }.
//     Rejecting removes it, with what was built on it since (a figure panel showing a run).
//       { kind: 'add', collection, id, name }
//   - Made at once, the person's item kept as it was: a change of the person's figure (a panel
//     added, moved, restyled) or of what a higher score of a score set means. Rejecting puts the
//     item back as it was.
//       { kind: 'edit', collection, id, name, before }
//   - Held, the workspace unchanged until the person accepts:
//       { kind: 'design', design, source, detail }        the design, set or drafted
//       { kind: 'qc-thresholds', thresholds, detail }      the QC thresholds (null: the defaults)
//       { kind: 'acknowledge', finding, entry, detail }   a finding acknowledged (entry null: withdrawn)
//       { kind: 'target', id, name, patch, detail }        a target changed (its check applied)
//       { kind: 'deposit', patch, detail }                 the MaveDB details
//       { kind: 'remove', collection, id, name, detail }   a removal of the person's
//       { kind: 'remove-panel', collection: 'figures', id, panel, name, detail }
// Changing or removing what the agent itself proposed applies at once: it is part of its proposal.
//
// While an agent's action runs, every change the window commits is the agent's (ui/remote.js
// passes each through absorb): what it adds is marked, the person's items it changes are kept as
// they were, the changes that wait are taken back out of the workspace into the proposal, and its
// history entries carry the agent's name, those of the changes that wait made "propose" entries.
// Removals are proposed by the actions themselves (proposeRemoval), so that accepting one removes
// the item as the person's removal would, with what goes with it; absorb refuses a removal of the
// person's that was not proposed, so that none happens unseen. Accepting applies what was held
// (in the history under the agent's name) and stamps what was made proposed: { by, accepted };
// rejecting removes and restores. Either decision is one "proposal" entry, the person's.

import { newId, now as clockNow } from './clock.js';
import { appendHistory, canonicalJSON, change, recordTargetCheck, removeAnalysis, removeAnnotation, removeCheckpoint, removeControlSet, removeFigure, removeSelection, removeSource, removeStructureView, saveFigure, setAcknowledgement, setDeposit, setDesign, setQcThresholds, updateTarget, withHistoryActor } from './workspace.js';
import { removeRun } from './runs.js';
import { panelSummary, removePanel } from './figures.js';
import { possessive } from './words.js';

const same = (a, b) => canonicalJSON(a ?? null) === canonicalJSON(b ?? null);
const capital = (text) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export class ProposalError extends Error {}

const analysisWords = (a) => (a.kind === 'comparison' ? `the comparison of ${a.a?.label ?? 'two sides'} and ${a.b?.label ?? ''}` : `${possessive(a.run?.name ?? 'a run')} robustness check`);

// What the workspace lists, by its field: each item's name in words, what making it is called, and
// its removal (the workspace's own function, with what goes with it).
export const COLLECTIONS = {
  sources: { noun: (s) => `the table ${s.name}`, made: 'opened', remove: (ws, id) => removeSource(ws, id) },
  targets: { noun: (t) => `the target ${t.name}`, made: 'added', remove: (ws, id) => change(ws, { targets: ws.targets.filter((t) => t.id !== id) }, 'target', `Removed the target ${ws.targets.find((t) => t.id === id)?.name ?? id}`) },
  runs: { noun: (r) => r.name, made: 'scored', remove: (ws, id) => removeRun(ws, id) },
  selections: { noun: (s) => `the selection "${s.name}"`, made: 'saved', remove: (ws, id) => removeSelection(ws, id) },
  annotations: { noun: (a) => `the annotation "${a.name}"`, made: 'added beside the map', remove: (ws, id) => removeAnnotation(ws, id) },
  structureViews: { noun: (v) => `the structure view "${v.name}"`, made: 'saved', remove: (ws, id) => removeStructureView(ws, id) },
  figures: { noun: (f) => `the figure "${f.name}"`, made: 'made', remove: (ws, id) => removeFigure(ws, id) },
  analyses: { noun: analysisWords, made: 'kept in the report', remove: (ws, id) => removeAnalysis(ws, id, `Took ${analysisWords(ws.analyses.find((a) => a.id === id))} out of the report`) },
  checkpoints: { noun: (c) => `the checkpoint "${c.name}"`, made: 'kept', remove: (ws, id) => removeCheckpoint(ws, id) },
  controlSets: { noun: (c) => `the control set "${c.name}"`, made: 'made', remove: (ws, id) => removeControlSet(ws, id) },
};

// Fields an agent's change may alter freely: the record of the change itself, the tracks'
// arrangement (a view of the analysis, not in the history) and the structures, which follow their
// saved views.
const FREE = new Set(['modified', 'history', 'historyAnchor', 'proposals', 'tracks', 'structures']);
const HELD = new Set(['design', 'designSource', 'qc', 'deposit']);

// --- Reading --------------------------------------------------------------------------------------------

export const openProposals = (ws) => ws.proposals ?? [];
export const proposalById = (ws, id) => openProposals(ws).find((p) => p.id === id) ?? null;
export const proposalOf = (ws, author) => openProposals(ws).find((p) => p.author === author) ?? null;

// The open proposal an item was made by (it is marked proposed), or null.
export function proposalOfItem(ws, item) {
  const id = item?.proposed?.proposal;
  return id ? proposalById(ws, id) : null;
}

const itemOf = (ws, collection, id) => (ws[collection] ?? []).find((x) => x.id === id) ?? null;

// A change waiting in an open proposal: { proposal, change } of the first that test accepts.
export function findChange(ws, test) {
  for (const proposal of openProposals(ws)) {
    const found = proposal.changes.find(test);
    if (found) return { proposal, change: found };
  }
  return null;
}

// A removal of an item waiting for the person, or null.
export const heldRemoval = (ws, collection, id) => findChange(ws, (c) => c.kind === 'remove' && c.collection === collection && c.id === id);
// Panels of a figure an agent proposes to remove: [{ proposal, change }].
export const heldPanelRemovals = (ws, figureId) => openProposals(ws).flatMap((proposal) => proposal.changes.filter((c) => c.kind === 'remove-panel' && c.id === figureId).map((change) => ({ proposal, change })));
// A change of the person's item made at once (its earlier state kept), or null.
export const editOf = (ws, collection, id) => findChange(ws, (c) => c.kind === 'edit' && c.collection === collection && c.id === id);
// The changes of a kind waiting: [{ proposal, change }].
export const heldOfKind = (ws, kind) => openProposals(ws).flatMap((proposal) => proposal.changes.filter((c) => c.kind === kind).map((change) => ({ proposal, change })));

// --- Recording ----------------------------------------------------------------------------------------

const changeKey = (c) => ({
  add: `add:${c.collection}:${c.id}`, edit: `edit:${c.collection}:${c.id}`, design: 'design', 'qc-thresholds': 'qc-thresholds', acknowledge: `acknowledge:${c.finding}`,
  target: `target:${c.id}`, deposit: 'deposit', remove: `remove:${c.collection}:${c.id}`, 'remove-panel': `remove-panel:${c.id}:${c.panel}`,
})[c.kind];

// Whether a change that waits would change nothing in ws (the agent took it back).
function idle(ws, c) {
  if (c.kind === 'design') return same(c.design, ws.design) && (c.source ?? null) === (ws.designSource ?? null);
  if (c.kind === 'qc-thresholds') return same(c.thresholds, ws.qc?.thresholds);
  if (c.kind === 'acknowledge') return same(c.entry, ws.qc?.acknowledged?.[c.finding]);
  if (c.kind === 'deposit') return Object.entries(c.patch).every(([k, v]) => same(v === '' ? null : v, ws.deposit?.[k]));
  if (c.kind === 'target') {
    const t = itemOf(ws, 'targets', c.id);
    return !t || Object.entries(c.patch).every(([k, v]) => same(v, t[k]));
  }
  return false;
}

// A proposal's changes with one more: one of each kind and item, the latest (a deposit's and a
// target's fields merged; an edit keeps the item as it was first).
function withChange(changes, c, ws) {
  const key = changeKey(c);
  const at = changes.findIndex((x) => changeKey(x) === key);
  let next = c;
  if (at >= 0) {
    const old = changes[at];
    if (c.kind === 'edit' || c.kind === 'add') return changes;
    if (c.kind === 'deposit') next = { ...c, patch: { ...old.patch, ...c.patch }, detail: `The MaveDB details: ${Object.keys({ ...old.patch, ...c.patch }).join(', ')}` };
    if (c.kind === 'target') next = { ...c, patch: { ...old.patch, ...c.patch } };
  }
  const rest = at >= 0 ? changes.filter((_, i) => i !== at) : changes;
  return idle(ws, next) ? rest : at >= 0 ? changes.map((x, i) => (i === at ? next : x)) : [...changes, next];
}

// ws with the author's proposal holding changes (opened if needed, dropped when left empty).
function recordChanges(ws, author, id, changes, time, forget = () => false) {
  const others = openProposals(ws).filter((p) => p.author !== author);
  const proposal = proposalOf(ws, author) ?? { id, author, opened: time, changes: [] };
  let list = proposal.changes.filter((c) => !forget(c));
  for (const c of changes) list = withChange(list, c, ws);
  const proposals = list.length ? [...others, { ...proposal, changes: list }] : others;
  return { ...ws, proposals: proposals.length ? proposals : undefined };
}

// The history entries of after made since before (after continues before's history).
function entriesSince(before, after) {
  const history = after.history ?? [];
  const head = (before.history ?? []).at(-1)?.hash ?? before.historyAnchor ?? null;
  if (!head) return history;
  const at = history.findIndex((e) => e.hash === head);
  return at < 0 ? [] : history.slice(at + 1);
}

// An agent's change (before → after, a commit made while its action runs) as part of its
// proposal: { ws, made, held } (the changes recorded; see the top of this file). Throws a
// ProposalError when after removes an item of the person's (removals are proposed with
// proposeRemoval) or changes a field no proposal can hold.
export function absorb(before, after, author, time = clockNow()) {
  if (!after || after === before) return { ws: after, made: [], held: [] };
  const id = proposalOf(before, author)?.id ?? proposalOf(after, author)?.id ?? `p-${newId()}`;
  const own = (item) => item?.proposed?.proposal === id;
  const made = [];
  const held = [];
  const forgotten = new Set();
  let ws = after;

  for (const [key, spec] of Object.entries(COLLECTIONS)) {
    const was = new Map((before[key] ?? []).map((x) => [x.id, x]));
    const list = after[key] ?? [];
    const now = new Set(list.map((x) => x.id));
    let altered = false;
    const next = list.map((item) => {
      const old = was.get(item.id);
      if (!old) {
        if (own(item)) return item;
        made.push({ kind: 'add', collection: key, id: item.id, name: spec.noun(item) });
        altered = true;
        return { ...item, proposed: { by: author, proposal: id } };
      }
      if (same(old, item)) return item;
      // The agent's own, changed again: still its proposal.
      if (own(old)) {
        if (own(item)) return item;
        altered = true;
        return { ...item, proposed: old.proposed };
      }
      // The same table read again (its codons at the protein level): no change of the analysis.
      if (key === 'sources') return item;
      // A change of the person's target (its check applied) waits.
      if (key === 'targets') {
        const patch = {};
        for (const k of new Set([...Object.keys(old), ...Object.keys(item)])) if (!same(old[k], item[k])) patch[k] = item[k] ?? null;
        held.push({ kind: 'target', id: item.id, name: spec.noun(old), patch });
        altered = true;
        return old;
      }
      // A panel of the person's figure removed: removals wait (proposeRemoval), those of the
      // panels the agent added excepted.
      if (key === 'figures') {
        const original = proposalOf(before, author)?.changes.find((c) => c.kind === 'edit' && c.collection === key && c.id === item.id)?.before ?? old;
        const kept = new Set(item.panels.map((p) => p.id));
        if (original.panels.some((p) => !kept.has(p.id))) throw new ProposalError(`A panel of ${spec.noun(old)} would be removed without the person's accepting it, so MaveScape changed nothing.`);
      }
      made.push({ kind: 'edit', collection: key, id: item.id, name: spec.noun(old), before: old });
      return item;
    });
    for (const [itemId, old] of was) {
      if (now.has(itemId)) continue;
      if (!own(old)) throw new ProposalError(`${capital(spec.noun(old))} would be removed without the person's accepting it, so MaveScape changed nothing.`);
      forgotten.add(`${key}:${itemId}`);
    }
    if (altered) ws = { ...ws, [key]: next };
  }

  // The design, unless it changed only as its copy of a target kept in step with a change of the
  // target that waits (accepting that change keeps it in step again).
  if (!same(before.design, after.design) || (before.designSource ?? null) !== (after.designSource ?? null)) {
    const targets = held.filter((c) => c.kind === 'target');
    const inStep = targets.length && (before.designSource ?? null) === (after.designSource ?? null) && before.design && same(after.design, {
      ...before.design,
      targets: before.design.targets.map((t) => {
        const c = targets.find((x) => x.id === t.id);
        if (!c) return t;
        const { reference, ...fields } = c.patch;
        return { ...t, ...fields, id: t.id };
      }),
    });
    if (!inStep) held.push({ kind: 'design', design: after.design ?? null, source: after.designSource ?? null });
    ws = { ...ws, design: before.design ?? null, designSource: before.designSource ?? null };
  }
  if (!same(before.qc, after.qc)) {
    if (!same(before.qc?.thresholds, after.qc?.thresholds)) held.push({ kind: 'qc-thresholds', thresholds: after.qc?.thresholds ?? null });
    const a = before.qc?.acknowledged ?? {};
    const b = after.qc?.acknowledged ?? {};
    for (const finding of new Set([...Object.keys(a), ...Object.keys(b)])) if (!same(a[finding], b[finding])) held.push({ kind: 'acknowledge', finding, entry: b[finding] ?? null });
    ws = { ...ws, qc: before.qc ?? null };
  }
  if (!same(before.deposit, after.deposit)) {
    const a = before.deposit ?? {};
    const b = after.deposit ?? {};
    const patch = {};
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (!same(a[k], b[k])) patch[k] = b[k] ?? null;
    held.push({ kind: 'deposit', patch });
    ws = { ...ws, deposit: before.deposit };
  }
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (FREE.has(key) || HELD.has(key) || Object.hasOwn(COLLECTIONS, key)) continue;
    if (!same(before[key], after[key])) throw new ProposalError(`MaveScape cannot hold a change of the workspace's ${key} for the person to accept, so it changed nothing.`);
  }

  // The history: the change's entries under the agent's name; those of what waits made "propose"
  // entries, their words kept with the change to be written when it is accepted.
  const entries = entriesSince(before, after);
  const heldBy = { design: 'design', 'qc-thresholds': 'qc', acknowledge: 'qc', deposit: 'deposit', target: 'target' };
  const holds = new Set();
  for (const c of held) {
    const e = entries.find((x) => !holds.has(x) && x.action === heldBy[c.kind] && !(x.action === 'target' && /^Added the target/.test(x.detail)));
    if (e) holds.add(e);
    c.detail = e?.detail ?? defaultDetail(c, author);
  }
  let history = { history: before.history ?? [], historyAnchor: before.historyAnchor };
  for (const e of entries) history = { ...history, ...(holds.has(e) ? appendHistory(history, 'propose', `Proposed: ${e.detail}`, e.time, author) : appendHistory(history, e.action, e.detail, e.time, author)) };
  ws = { ...ws, history: history.history, historyAnchor: history.historyAnchor };

  if (made.length || held.length || forgotten.size) {
    const forget = (c) => (c.kind === 'add' || c.kind === 'edit') && forgotten.has(`${c.collection}:${c.id}`);
    ws = recordChanges(ws, author, id, [...made, ...held], time, forget);
  }
  return { ws, made, held };
}

function defaultDetail(c, author) {
  if (c.kind === 'design') return c.design ? `The design set by ${author}` : `The design cleared by ${author}`;
  if (c.kind === 'qc-thresholds') return c.thresholds ? `QC thresholds set by ${author}` : `QC thresholds reset to MaveScape's defaults by ${author}`;
  if (c.kind === 'acknowledge') return c.entry ? `Acknowledged the QC finding ${c.finding} (${c.entry.status}): ${c.entry.reason}` : `Withdrew the acknowledgement of the QC finding ${c.finding}`;
  if (c.kind === 'deposit') return `The MaveDB details: ${Object.keys(c.patch).join(', ')}`;
  if (c.kind === 'target') return `Changed ${c.name}: ${Object.keys(c.patch).join(', ')}`;
  return `Changed by ${author}`;
}

// A change that waits, proposed by an action itself (a removal; QC thresholds built on those the
// agent proposed before). One that would change nothing takes back the agent's earlier change of
// the same thing. The history says which.
export function proposeChange(ws, author, c, time = clockNow()) {
  const id = proposalOf(ws, author)?.id ?? `p-${newId()}`;
  const earlier = proposalOf(ws, author)?.changes.find((x) => changeKey(x) === changeKey(c)) ?? null;
  const next = recordChanges(ws, author, id, [c], time);
  const kept = proposalOf(next, author)?.changes.some((x) => changeKey(x) === changeKey(c));
  if (!kept && !earlier) return ws;
  const detail = kept ? `Proposed: ${c.detail}` : `Took back the proposal: ${describeChange(ws, earlier)}`;
  return { ...next, modified: time, ...appendHistory(next, 'propose', detail, time, author) };
}

// A removal of the person's item, proposed: { collection, id, name, detail } of an item, or with
// panel, a panel of a figure. The workspace keeps it until the person accepts.
export function proposeRemoval(ws, author, removal, time = clockNow()) {
  const c = removal.panel
    ? { kind: 'remove-panel', collection: 'figures', id: removal.id, panel: removal.panel, name: removal.name, detail: removal.detail }
    : { kind: 'remove', collection: removal.collection, id: removal.id, name: removal.name, detail: removal.detail };
  return proposeChange(ws, author, c, time);
}

// --- In words --------------------------------------------------------------------------------------------

// What a change does, in a sentence (start: false, as a clause that follows another).
export function describeChange(ws, c, { start = true } = {}) {
  const capital = start ? (text) => `${text.charAt(0).toUpperCase()}${text.slice(1)}` : (text) => text;
  const spec = COLLECTIONS[c.collection];
  const item = spec ? itemOf(ws, c.collection, c.id) : null;
  const name = item && spec ? spec.noun(item) : c.name ?? '';
  switch (c.kind) {
    case 'add':
      return capital(`${name} ${spec.made}`);
    case 'edit': {
      if (c.collection === 'figures' && item) {
        const before = new Set(c.before.panels.map((p) => p.id));
        const added = item.panels.filter((p) => !before.has(p.id)).map((p) => panelSummary(p, ws));
        return `${capital(name)} changed${added.length ? `: ${plural(added.length, 'panel')} added (${added.join('; ')})` : ''}`;
      }
      return `${capital(name)} changed`;
    }
    case 'remove':
      return capital(`remove ${name}`);
    case 'remove-panel': {
      const fig = itemOf(ws, 'figures', c.id);
      const panel = fig?.panels.find((p) => p.id === c.panel);
      return capital(`remove from ${fig ? COLLECTIONS.figures.noun(fig) : 'a figure'} the panel of ${panel ? panelSummary(panel, ws) : c.name}`);
    }
    default:
      return c.detail ?? defaultDetail(c, 'an agent');
  }
}

// A proposal, item by item: [{ kind, held, collection, id, text, clause }] (what it made that is no
// longer in the workspace, removed by the person, is left out).
export function describeProposal(ws, proposal) {
  return proposal.changes
    .filter((c) => !((c.kind === 'add' || c.kind === 'edit') && !itemOf(ws, c.collection, c.id)))
    .map((c) => ({ kind: c.kind, held: !(c.kind === 'add' || c.kind === 'edit'), collection: c.collection ?? null, id: c.id ?? null, text: describeChange(ws, c), clause: describeChange(ws, c, { start: false }) }));
}

// The items as one sentence's list, for the history.
const summary = (items) => (items.length ? items.map((i, n) => (n ? i.clause : i.text)).join('; ') : 'nothing');

// A proposal as an agent reads it: { id, author, opened, made, waiting } (in words).
export function proposalSummary(ws, proposal) {
  if (!proposal) return null;
  const items = describeProposal(ws, proposal);
  return { id: proposal.id, author: proposal.author, opened: proposal.opened, made: items.filter((i) => !i.held).map((i) => i.text), waiting: items.filter((i) => i.held).map((i) => i.text) };
}

// The decisions recorded (the history's "proposal" entries), the latest first.
export function decisions(ws, limit = 20) {
  return (ws.history ?? []).filter((e) => e.action === 'proposal').slice(-limit).reverse();
}

// --- Deciding ---------------------------------------------------------------------------------------------

function applyHeld(ws, c) {
  switch (c.kind) {
    case 'design':
      return setDesign(ws, c.design, c.detail, c.source);
    case 'qc-thresholds':
      return setQcThresholds(ws, c.thresholds, c.detail);
    case 'acknowledge':
      return setAcknowledgement(ws, c.finding, c.entry, c.detail);
    case 'deposit':
      return setDeposit(ws, c.patch, c.detail);
    case 'target': {
      if (!itemOf(ws, 'targets', c.id)) return ws;
      const { reference, ...fields } = c.patch;
      return Object.hasOwn(c.patch, 'reference') ? recordTargetCheck(ws, c.id, fields, reference, c.detail) : updateTarget(ws, c.id, fields, c.detail);
    }
    case 'remove':
      return itemOf(ws, c.collection, c.id) ? COLLECTIONS[c.collection].remove(ws, c.id) : ws;
    case 'remove-panel': {
      const fig = itemOf(ws, 'figures', c.id);
      return fig?.panels.some((p) => p.id === c.panel) ? saveFigure(ws, removePanel(fig, c.panel), c.detail) : ws;
    }
    default:
      return ws;
  }
}

const withoutProposal = (ws, id) => {
  const rest = openProposals(ws).filter((p) => p.id !== id);
  return { ...ws, proposals: rest.length ? rest : undefined };
};

// Accepts a proposal: what waits is applied, in the history under the agent's name; what was made
// stays, stamped proposed: { by, accepted }. The decision is the person's history entry.
export function acceptProposal(ws, id, time = clockNow()) {
  const proposal = proposalById(ws, id);
  if (!proposal) return ws;
  const items = describeProposal(ws, proposal);
  // The design first, so that a target's check accepted with it keeps its copy of the target in step.
  const order = (c) => (c.kind === 'design' ? 0 : c.kind === 'target' ? 1 : 2);
  const held = [...proposal.changes].sort((a, b) => order(a) - order(b));
  let next = withHistoryActor(proposal.author, () => held.reduce(applyHeld, withoutProposal(ws, id)));
  for (const c of proposal.changes) {
    if (c.kind !== 'add' || !itemOf(next, c.collection, c.id)) continue;
    next = { ...next, [c.collection]: next[c.collection].map((x) => (x.id === c.id ? { ...x, proposed: { by: proposal.author, accepted: time } } : x)) };
  }
  return withHistoryActor(null, () => change(next, {}, 'proposal', `Accepted the proposal of ${proposal.author}: ${summary(items)}`, time));
}

// A panel's runs, annotations and saved view: whether it shows what test accepts.
const panelUses = (p, { run, annotation, view }) => (run && (p.run === run || (p.kind === 'qc' && p.subject === run) || [p.a, p.b].some((s) => s?.run === run)))
  || (annotation && [p.a, p.b].some((s) => s?.annotation === annotation))
  || (view && p.kind === 'structure' && p.view === view);

// ws with the figures' panels that show what is going removed, and an annotation's tracks taken
// out of the maps that show them.
function withoutPanels(ws, uses) {
  if (!(ws.figures ?? []).length) return ws;
  let next = ws;
  for (const fig of ws.figures) {
    let f = fig;
    for (const p of fig.panels) if (panelUses(p, uses)) f = removePanel(f, p.id);
    if (uses.annotation) f = { ...f, panels: f.panels.map((p) => (p.kind === 'map' && p.tracks?.some((t) => t.startsWith(`${uses.annotation}:`)) ? { ...p, tracks: p.tracks.filter((t) => !t.startsWith(`${uses.annotation}:`)) } : p)) };
    if (!same(f, fig)) next = saveFigure(next, f);
  }
  return next;
}

// An item removed with what was built on it: a run's selections, the structure views colored by
// it, the panels showing it (and the analyses reading it, as removeRun does); a table's runs,
// unless another table holds the same file; an annotation's and a view's panels.
function removeBuilt(ws, collection, id) {
  const item = itemOf(ws, collection, id);
  if (!item) return ws;
  let next = ws;
  if (collection === 'runs') {
    for (const s of next.selections.filter((x) => x.run === id)) next = removeSelection(next, s.id);
    for (const v of (next.structureViews ?? []).filter((x) => x.color?.run === id)) next = removeStructureView(next, v.id);
    next = withoutPanels(next, { run: id });
  }
  if (collection === 'annotations') next = withoutPanels(next, { annotation: id });
  if (collection === 'structureViews') next = withoutPanels(next, { view: id });
  if (collection === 'sources' && !next.sources.some((s) => s.id !== id && s.sha256 === item.sha256)) {
    for (const r of next.runs.filter((x) => x.inputs.source.sha256 === item.sha256)) next = removeBuilt(next, 'runs', r.id);
  }
  return COLLECTIONS[collection].remove(next, id);
}

function rejected(ws, proposal) {
  let next = withoutProposal(ws, proposal.id);
  for (const c of proposal.changes) {
    if (c.kind !== 'edit' || !itemOf(next, c.collection, c.id)) continue;
    next = { ...next, [c.collection]: next[c.collection].map((x) => (x.id === c.id ? c.before : x)) };
  }
  for (const c of [...proposal.changes].reverse()) if (c.kind === 'add') next = removeBuilt(next, c.collection, c.id);
  return next;
}

// What rejecting a proposal would also remove or change of the person's (built on what the agent
// made since): [{ collection, id, text }].
export function dependentsOf(ws, id) {
  const proposal = proposalById(ws, id);
  if (!proposal) return [];
  const after = rejected(ws, proposal);
  const own = new Set(proposal.changes.filter((c) => c.kind === 'add' || c.kind === 'edit').map((c) => `${c.collection}:${c.id}`));
  const out = [];
  for (const [key, spec] of Object.entries(COLLECTIONS)) {
    const is = new Map((after[key] ?? []).map((x) => [x.id, x]));
    for (const item of ws[key] ?? []) {
      if (own.has(`${key}:${item.id}`)) continue;
      if (!is.has(item.id)) out.push({ collection: key, id: item.id, text: `${spec.noun(item)} (removed)` });
      else if (key === 'figures' && !same(item, is.get(item.id))) {
        const left = new Set(is.get(item.id).panels.map((p) => p.id));
        const gone = item.panels.filter((p) => !left.has(p.id)).map((p) => panelSummary(p, ws));
        out.push({ collection: key, id: item.id, text: `${spec.noun(item)}: ${gone.length ? `the panel${gone.length === 1 ? '' : 's'} of ${gone.join('; ')}` : 'its maps\' tracks'} (removed)` });
      }
    }
  }
  return out;
}

// Rejects a proposal: what it made goes, with what was built on it since; the person's items it
// changed are put back; what waits is dropped. One history entry, the person's.
export function rejectProposal(ws, id, time = clockNow()) {
  const proposal = proposalById(ws, id);
  if (!proposal) return ws;
  const items = describeProposal(ws, proposal);
  const built = dependentsOf(ws, id);
  const next = { ...rejected(ws, proposal), history: ws.history, historyAnchor: ws.historyAnchor };
  return withHistoryActor(null, () => change(next, {}, 'proposal', `Rejected the proposal of ${proposal.author}: ${summary(items)}${built.length ? `; with it, what was built on it since: ${built.map((d) => d.text.replace(/ \(removed\)$/, '')).join('; ')}` : ''}`, time));
}
