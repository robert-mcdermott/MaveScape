// The strip above the view (wave 7, slice 2): each AI agent's proposal, who proposes how many
// changes, the list (what it made, marked proposed; what waits for the person), Accept all and
// Reject all; while an agent's action runs, that it is working. After CytoWeave 0.8.0's proposal
// strip (web/ui/sidebar.js). A decision is the person's commit: undoable, one entry of the history
// (lib/proposals.js).

import { h, icon, clear } from './dom.js';
import { confirmDialog, toast } from './overlays.js';
import { acceptProposal, dependentsOf, describeProposal, openProposals, proposalById, rejectProposal } from '../lib/proposals.js';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function mountProposals(app, host) {
  const { store } = app;
  // The proposals whose list is shown.
  const shown = new Set();

  function accept(id) {
    const proposal = proposalById(store.ws, id);
    if (!proposal) return;
    store.commit(acceptProposal(store.ws, id), `Accept the proposal of ${proposal.author}`, ['ws', 'proposals'], { decision: true });
    toast(`Accepted the proposal of ${proposal.author}.`, { kind: 'ok' });
  }

  async function reject(id) {
    const proposal = proposalById(store.ws, id);
    if (!proposal) return;
    const built = dependentsOf(store.ws, id);
    if (built.length && !(await confirmDialog({ title: 'Reject the proposal?', message: `Rejecting removes what ${proposal.author} made, and with it what was built on it since: ${built.map((d) => d.text.replace(/ \(removed\)$/, '')).join('; ')}.`, confirm: 'Reject', danger: true }))) return;
    // Decided meanwhile (undone, or another window): nothing to do.
    if (!proposalById(store.ws, id)) return;
    store.commit(rejectProposal(store.ws, id), `Reject the proposal of ${proposal.author}`, ['ws', 'proposals'], { decision: true });
    // What the views showed of what went (a run focused, its variants selected) is let go.
    const ws = store.ws;
    const { focus, selection } = store.ui;
    const lists = { source: ws.sources, target: ws.targets, run: ws.runs, selection: ws.selections, structureView: ws.structureViews ?? [] };
    if (focus && ((lists[focus.kind] && !lists[focus.kind].some((x) => x.id === focus.id)) || (focus.run && !ws.runs.some((r) => r.id === focus.run)))) app.focusItem(null);
    if (selection && !ws.runs.some((r) => r.id === selection.run)) store.setUI({ selection: null }, ['selection']);
    toast(`Rejected the proposal of ${proposal.author}.`);
  }

  function render() {
    clear(host);
    const ws = store.ws;
    const working = app.agentAction;
    const list = openProposals(ws);
    host.hidden = !working && !list.length;
    if (working) host.append(h('div.agent-working', { role: 'status' }, icon('robot'), h('span', h('strong', working.author), ` is working: ${working.action.replace(/_/g, ' ')}…`)));
    for (const proposal of list) {
      const items = describeProposal(ws, proposal);
      const made = items.filter((i) => !i.held);
      const waiting = items.filter((i) => i.held);
      const open = shown.has(proposal.id);
      const parts = [made.length ? `${made.length} made` : '', waiting.length ? `${waiting.length} waiting for you` : ''].filter(Boolean).join(', ');
      host.append(h('section.proposal-strip', { 'aria-label': `The proposal of ${proposal.author}` },
        h('div.proposal-head',
          icon('sparkles'),
          h('span.proposal-title', h('strong', proposal.author), ` proposes ${plural(items.length, 'change')}`, parts ? h('span.muted', ` (${parts})`) : null),
          h('span.spacer'),
          h('button.btn.small.ghost', { type: 'button', 'aria-expanded': open ? 'true' : 'false', onclick: () => { if (open) shown.delete(proposal.id); else shown.add(proposal.id); render(); } }, open ? 'Hide' : 'Review'),
          h('button.btn.small.primary', { type: 'button', onclick: () => accept(proposal.id) }, 'Accept all'),
          h('button.btn.small', { type: 'button', onclick: () => reject(proposal.id) }, 'Reject all')),
        open ? h('div.proposal-body',
          made.length ? [h('h4', 'Made, marked proposed: in use now, removed if you reject them'), h('ul.proposal-items', ...made.map((i) => h('li', i.text)))] : null,
          waiting.length ? [h('h4', 'Waiting for you: applied only if you accept'), h('ul.proposal-items.held', ...waiting.map((i) => h('li', i.text)))] : null,
          h('p.muted', `Proposed by ${proposal.author} from ${new Date(proposal.opened).toLocaleString()}. Accepting or rejecting goes into the history, and can be undone.`)) : null));
    }
  }

  store.subscribe((topics) => {
    if (topics.has('ws') || topics.has('agent') || topics.has('workspace-loaded')) render();
  });
  render();
  return { render };
}
