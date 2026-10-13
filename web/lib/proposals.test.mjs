import assert from 'node:assert/strict';
import test from 'node:test';
import { acknowledgeFinding, addCheckpoint, addSelection, addTarget, change, createWorkspace, recordTargetCheck, rename, saveFigure, setDeposit, setDesign, setQcThresholds, verifyHistory } from './workspace.js';
import { absorb, acceptProposal, decisions, dependentsOf, describeProposal, heldRemoval, openProposals, proposalOf, ProposalError, proposeChange, proposeRemoval, rejectProposal } from './proposals.js';
import { addPanel, createFigure, removePanel } from './figures.js';

const AGENT = 'Claude Code';
const TIME = '2026-10-12T09:00:00.000Z';

function runOf(id, name, sha = 'a'.repeat(64)) {
  return { id, name, created: TIME, inputs: { source: { name: 'counts.csv', sha256: sha }, design: { format: 'mavescape-design', model: 'ratio', targets: [] }, parameters: {} }, output: { sha256: id.repeat(8), variants: 1, conditions: [{ name: 'c', scored: 1 }] }, software: { version: '0.7.0' } };
}

const design = (name) => ({ format: 'mavescape-design', name, model: 'ratio', targets: [{ id: 'grb2', name: 'GRB2', sequence: 'MEAIAKYDFKATADDELSFKRGDILKV', sequenceType: 'protein' }], samples: [], replicates: [] });

// A workspace of the person's: a table, its target, a design and a first run.
function base() {
  let ws = createWorkspace('GRB2', { now: TIME });
  ws = addTarget(ws, design('x').targets[0]).ws;
  ws = change(ws, { sources: [{ id: 'counts', name: 'counts.csv', sha256: 'a'.repeat(64), rows: 10, columns: [] }] }, 'import', 'Imported counts.csv');
  ws = setDesign(ws, design('the person\'s'), 'The person\'s design', 'counts');
  ws = change(ws, { runs: [runOf('r1', 'Run 1')] }, 'score', 'Scored Run 1');
  return ws;
}

// An agent's change: what the window commits while its action runs.
const agent = (before, after, author = AGENT) => absorb(before, after, author, TIME);

test('what an agent adds is made at once, marked proposed, its history entries under its name', () => {
  const ws = base();
  let fig = createFigure('Figure 2', 'double');
  fig = addPanel(fig, { kind: 'map', run: 'r2' }).figure;
  const after = saveFigure(change(ws, { runs: [...ws.runs, runOf('r2', 'Run 2')] }, 'score', 'Scored Run 2'), fig, 'Made the figure "Figure 2"');
  const { ws: next, made, held } = agent(ws, after);
  assert.deepEqual(made.map((c) => `${c.collection}:${c.id}`), ['runs:r2', `figures:${fig.id}`]);
  assert.equal(held.length, 0);
  const proposal = proposalOf(next, AGENT);
  assert.equal(next.runs[1].proposed.by, AGENT);
  assert.equal(next.runs[1].proposed.proposal, proposal.id);
  assert.equal(next.figures[0].proposed.proposal, proposal.id);
  assert.equal(next.runs[0].proposed, undefined, 'the person\'s run is not marked');
  assert.deepEqual(next.history.slice(-2).map((e) => [e.action, e.by]), [['score', AGENT], ['figure', AGENT]]);
  assert.ok(verifyHistory(next).ok);
  assert.deepEqual(describeProposal(next, proposal).map((i) => i.text), ['Run 2 scored', 'The figure "Figure 2" made']);
});

test('a design, QC thresholds, an acknowledgement and the MaveDB details wait for the person', () => {
  const ws = base();
  let after = setDesign(ws, design('the agent\'s'), `The design set by ${AGENT}`, 'counts');
  let { ws: next, held } = agent(ws, after);
  assert.deepEqual(held.map((c) => c.kind), ['design']);
  assert.equal(next.design.name, 'the person\'s', 'the workspace keeps the person\'s design');
  assert.equal(next.history.at(-1).action, 'propose');
  assert.equal(next.history.at(-1).detail, `Proposed: The design set by ${AGENT}`);
  assert.equal(next.history.at(-1).by, AGENT);

  const ack = { id: 'agreement', title: 'Replicate agreement', status: 'review', value: 0.7 };
  for (const make of [
    (w) => setQcThresholds(w, { agreement: { review: 0.7, fail: 0.4 } }, 'QC: agreement review level 0.8 → 0.7'),
    (w) => acknowledgeFinding(w, ack, 'two replicates of one library', TIME),
    (w) => setDeposit(w, { title: 'GRB2 SH3' }, 'MaveDB details: title'),
    (w) => setDeposit(w, { license: 'CC0' }, 'MaveDB details: license'),
  ]) ({ ws: next } = agent(next, make(next)));
  assert.equal(next.qc, null);
  assert.equal(next.deposit, undefined);
  const proposal = proposalOf(next, AGENT);
  assert.deepEqual(proposal.changes.map((c) => c.kind), ['design', 'qc-thresholds', 'acknowledge', 'deposit']);
  assert.deepEqual(proposal.changes.find((c) => c.kind === 'deposit').patch, { title: 'GRB2 SH3', license: 'CC0' }, 'the details merge');
  assert.ok(verifyHistory(next).ok);

  // Accepted: applied in the history under the agent's name, the decision the person's.
  const accepted = acceptProposal(next, proposal.id, TIME);
  assert.equal(accepted.design.name, 'the agent\'s');
  assert.deepEqual(accepted.qc.thresholds, { agreement: { review: 0.7, fail: 0.4 } });
  assert.equal(accepted.qc.acknowledged.agreement.reason, 'two replicates of one library');
  assert.deepEqual(accepted.deposit, { title: 'GRB2 SH3', license: 'CC0' });
  assert.equal(accepted.proposals, undefined);
  const tail = accepted.history.slice(-5);
  assert.deepEqual(tail.map((e) => [e.action, e.by ?? null]), [['design', AGENT], ['qc', AGENT], ['qc', AGENT], ['deposit', AGENT], ['proposal', null]]);
  assert.match(tail.at(-1).detail, /^Accepted the proposal of Claude Code: The design set by Claude Code; /);
  assert.ok(verifyHistory(accepted).ok);
  assert.equal(decisions(accepted)[0], tail.at(-1));

  // Rejected: nothing of it applies.
  const rejected = rejectProposal(next, proposal.id, TIME);
  assert.equal(rejected.design.name, 'the person\'s');
  assert.equal(rejected.qc, null);
  assert.equal(rejected.proposals, undefined);
  assert.match(rejected.history.at(-1).detail, /^Rejected the proposal of Claude Code/);
  assert.equal(rejected.history.at(-1).by, undefined);
  assert.ok(verifyHistory(rejected).ok);
});

test('a change the agent takes back leaves nothing waiting', () => {
  const ws = base();
  const { ws: one } = agent(ws, setQcThresholds(ws, { agreement: { review: 0.7, fail: 0.5 } }, 'QC: a'));
  assert.equal(openProposals(one).length, 1);
  const two = proposeChange(one, AGENT, { kind: 'qc-thresholds', thresholds: null, detail: 'QC thresholds as they are' }, TIME);
  assert.equal(two.proposals, undefined);
  assert.equal(two.history.at(-1).detail, 'Took back the proposal: QC: a');
  assert.ok(verifyHistory(two).ok);
  assert.equal(proposeChange(two, AGENT, { kind: 'qc-thresholds', thresholds: null, detail: 'again' }, TIME), two, 'nothing to propose or take back');
});

test('a target\'s check waits as one change, the design\'s copy kept in step when it is accepted', () => {
  const ws = base();
  const reference = { accession: 'P62993', release: '2026_03' };
  const after = recordTargetCheck(ws, 'grb2', { offset: 156, uniprot: 'P62993' }, reference, 'Checked GRB2 against UniProt P62993: offset 156');
  const { ws: next, held } = agent(ws, after);
  assert.deepEqual(held.map((c) => c.kind), ['target']);
  assert.equal(next.targets[0].offset, undefined);
  assert.equal(next.design.targets[0].offset, undefined);
  const accepted = acceptProposal(next, proposalOf(next, AGENT).id, TIME);
  assert.equal(accepted.targets[0].offset, 156);
  assert.deepEqual(accepted.targets[0].reference, reference);
  assert.equal(accepted.design.targets[0].offset, 156, 'the design\'s copy follows');
  assert.equal(accepted.design.targets[0].reference, undefined, 'the check stays with the workspace\'s target');
  assert.ok(verifyHistory(accepted).ok);
});

test('removing the person\'s item is proposed, never made unseen', () => {
  const ws = addSelection(base(), { name: 'hydrophobic core', run: 'r1', condition: 0, keys: ['p.Trp36Ala'] }).ws;
  const id = ws.selections[0].id;
  assert.throws(() => agent(ws, { ...ws, selections: [] }), ProposalError);
  const next = proposeRemoval(ws, AGENT, { collection: 'selections', id, name: 'the selection "hydrophobic core"', detail: 'Removed the selection "hydrophobic core"' }, TIME);
  assert.equal(next.selections.length, 1, 'kept until accepted');
  assert.ok(heldRemoval(next, 'selections', id));
  assert.equal(next.history.at(-1).action, 'propose');
  assert.deepEqual(describeProposal(next, openProposals(next)[0]).map((i) => [i.text, i.held]), [['Remove the selection "hydrophobic core"', true]]);
  const accepted = acceptProposal(next, openProposals(next)[0].id, TIME);
  assert.equal(accepted.selections.length, 0);
  assert.equal(accepted.history.at(-2).action, 'remove-selection');
  assert.equal(accepted.history.at(-2).by, AGENT);
  assert.equal(rejectProposal(next, openProposals(next)[0].id, TIME).selections.length, 1);
});

test('the agent changes and removes what it proposed at once; a proposal left empty closes', () => {
  const ws = base();
  const fig = createFigure('Draft', 'single');
  const { ws: one } = agent(ws, saveFigure(ws, fig, 'Made the figure "Draft"'));
  const mine = one.figures[0];
  const { ws: two } = agent(one, saveFigure(one, { ...mine, name: 'Draft 2' }, 'Renamed'));
  assert.equal(two.figures[0].name, 'Draft 2');
  assert.equal(two.figures[0].proposed.proposal, mine.proposed.proposal, 'still part of the proposal');
  assert.equal(proposalOf(two, AGENT).changes.length, 1);
  const { ws: three } = agent(two, { ...two, figures: undefined, history: two.history });
  assert.equal(three.proposals, undefined);
});

test('a change of the person\'s figure is made at once, and rejecting puts the figure back', () => {
  let ws = base();
  ws = saveFigure(ws, addPanel(createFigure('Figure 1', 'double'), { kind: 'map', run: 'r1' }).figure, 'Made the figure "Figure 1"');
  const fig = ws.figures[0];
  const after = saveFigure(ws, addPanel(fig, { kind: 'scores', run: 'r1', plot: 'distribution' }).figure, 'Added a panel');
  const { ws: next, made } = agent(ws, after);
  assert.deepEqual(made.map((c) => c.kind), ['edit']);
  assert.equal(next.figures[0].panels.length, 2, 'made at once');
  assert.equal(next.figures[0].proposed, undefined, 'the figure stays the person\'s');
  assert.match(describeProposal(next, openProposals(next)[0])[0].text, /^The figure "Figure 1" changed: 1 panel added/);
  assert.equal(rejectProposal(next, openProposals(next)[0].id, TIME).figures[0].panels.length, 1);
  assert.equal(acceptProposal(next, openProposals(next)[0].id, TIME).figures[0].panels.length, 2);
  // A panel of the person's, removed: waits.
  const held = proposeRemoval(ws, AGENT, { collection: 'figures', id: fig.id, panel: fig.panels[0].id, name: 'the map of Run 1', detail: 'Removed panel A' }, TIME);
  assert.equal(held.figures[0].panels.length, 1);
  assert.equal(acceptProposal(held, openProposals(held)[0].id, TIME).figures[0].panels.length, 0);
  assert.throws(() => agent(ws, saveFigure(ws, removePanel(fig, fig.panels[0].id))), ProposalError, 'not a removal of an item, but a change of the person\'s figure');
});

test('rejecting removes what was made, with what the person built on it since', () => {
  const ws = base();
  const { ws: proposed } = agent(ws, change(ws, { runs: [...ws.runs, runOf('r2', 'Run 2')] }, 'score', 'Scored Run 2'));
  // The person keeps working with the agent's run: a selection, and a panel in their own figure.
  let person = addSelection(proposed, { name: 'stops', run: 'r2', condition: 0, keys: ['p.Trp36Ter'] }).ws;
  person = saveFigure(person, addPanel(addPanel(createFigure('Figure 1', 'double'), { kind: 'map', run: 'r1' }).figure, { kind: 'map', run: 'r2' }).figure, 'Made the figure "Figure 1"');
  const { id } = openProposals(person)[0];
  assert.deepEqual(dependentsOf(person, id).map((d) => d.text), ['the selection "stops" (removed)', 'the figure "Figure 1": the panel of the map of Run 2 (removed)']);
  const rejected = rejectProposal(person, id, TIME);
  assert.deepEqual(rejected.runs.map((r) => r.id), ['r1']);
  assert.equal(rejected.selections.length, 0);
  assert.equal(rejected.figures[0].panels.length, 1);
  assert.equal(rejected.history.length, person.history.length + 1, 'one entry: the decision');
  assert.match(rejected.history.at(-1).detail, /Run 2 scored; with it, what was built on it since: the selection "stops"; the figure "Figure 1"/);
  assert.ok(verifyHistory(rejected).ok);
  // Accepted, the run is stamped: who proposed it, when it was accepted.
  const accepted = acceptProposal(person, id, TIME);
  assert.deepEqual(accepted.runs[1].proposed, { by: AGENT, accepted: TIME });
});

test('each agent has its own proposal; a checkpoint it keeps is proposed too', () => {
  const ws = base();
  const { ws: one } = agent(ws, addCheckpoint(ws, { name: 'before', sha256: 'c'.repeat(64), head: ws.history.at(-1).hash, state: {} }, TIME).ws, 'Agent A');
  const { ws: two } = agent(one, change(one, { runs: [...one.runs, runOf('r9', 'Run 9')] }, 'score', 'Scored Run 9'), 'Agent B');
  assert.deepEqual(openProposals(two).map((p) => [p.author, p.changes.map((c) => c.collection)]), [['Agent A', ['checkpoints']], ['Agent B', ['runs']]]);
});

test('a change no proposal can hold is refused', () => {
  const ws = base();
  assert.throws(() => agent(ws, rename(ws, 'Something else')), /cannot hold a change of the workspace's name/);
});

test('a checkpoint\'s diff names who proposed what was added, and the person\'s decision', async () => {
  const { analysisState, diffStates } = await import('./diff.js');
  const ws = base();
  const { ws: proposed } = agent(ws, change(ws, { runs: [...ws.runs, runOf('r2', 'Run 2')] }, 'score', 'Scored Run 2'));
  const waiting = proposeRemoval(proposed, AGENT, { collection: 'runs', id: 'r1', name: 'Run 1', detail: 'Removed the score run Run 1' }, TIME);
  const texts = diffStates(analysisState(ws), analysisState(waiting)).changes.map((c) => c.text);
  assert.ok(texts.some((t) => /^Run 2 was scored \(proposed by Claude Code\): /.test(t)), texts.join('\n'));
  assert.ok(texts.includes('Proposed by Claude Code, waiting for the person: Removed the score run Run 1.'), texts.join('\n'));
  const accepted = acceptProposal(waiting, openProposals(waiting)[0].id, TIME);
  const later = diffStates(analysisState(waiting), analysisState(accepted)).changes.map((c) => c.text);
  assert.ok(later.includes('Run 2, proposed by Claude Code, was accepted.'), later.join('\n'));
  assert.ok(later.includes('Run 1 was removed.'), later.join('\n'));
});
