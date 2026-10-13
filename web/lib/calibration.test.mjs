import assert from 'node:assert/strict';
import test from 'node:test';
import { bootstrapMetrics, calibrationMetrics, classOf, prAuc, prPoints, rocPoints, ruleThresholds, scaleSide, sensitivityAt, stepsOf, thresholdWords, wilson } from './calibration.js';
import { addCalibration, addControlSet, createWorkspace, removeControlSet, verifyHistory } from './workspace.js';
import { removeRun } from './runs.js';
import { analysisState, diffStates } from './diff.js';
import { absorb, acceptProposal, rejectProposal } from './proposals.js';

// Five controls, by hand: P at 1, 2, 3 and B at 0 and 1.5, abnormal-like above the others.
const P = [1, 2, 3];
const B = [0, 1.5];
const close = (a, b, eps = 1e-12) => Math.abs(a - b) <= eps;

test('the ROC curve\'s points as pROC keeps them, its AUC, and the precision–recall area by Keilwagen\'s interpolation, by hand', () => {
  const s = stepsOf(P, B);
  assert.deepEqual([...s.u], [3, 2, 1.5, 1, 0]);
  assert.deepEqual([...s.tp], [1, 2, 2, 3, 3]);
  assert.deepEqual([...s.fp], [0, 0, 1, 1, 2]);
  const roc = rocPoints(s);
  assert.deepEqual([...roc.threshold], [-Infinity, 0.5, 1.25, 1.75, 2.5, Infinity]);
  assert.deepEqual([...roc.sensitivity], [1, 1, 2 / 3, 2 / 3, 1 / 3, 0]);
  assert.deepEqual([...roc.specificity], [0, 0.5, 0.5, 1, 1, 1]);
  // Five of the six pairs have the P control higher.
  assert.ok(close(calibrationMetrics(P, B, { side: 'above', samples: 0 }).auc.auc, 5 / 6));
  // Two steps of precision 1 (a third of the recall each), then from 2/3 to 1 precision 3r/(3r + 1):
  // 1/3 + 1/3 + [r − ln(3r + 1)/3] from 2/3 to 1.
  assert.ok(close(prAuc(s), 1 - Math.log(4 / 3) / 3));
  const pts = prPoints(s);
  assert.deepEqual(pts.map((p) => [p.recall, p.precision]), [[0, 1], [1 / 3, 1], [2 / 3, 1], [2 / 3, 2 / 3], [1, 3 / 4], [1, 3 / 5], [1, 3 / 5]]);
  // pROC's sensitivity at a specificity: a point's own, else between the two around it.
  assert.equal(sensitivityAt(roc, 0.5), 1, 'two points at 0.5: the first, of the lower threshold');
  assert.equal(sensitivityAt(roc, 0.75), 2 / 3);
  assert.equal(sensitivityAt({ specificity: [0, 0.5, 1], sensitivity: [1, 0.5, 0] }, 0.25), 0.75, 'between two points, linearly');
});

test('thresholds by rule: the error rule\'s two, Youden\'s one, the two meeting midway where they cross; classes with a threshold on the abnormal-like side', () => {
  const roc = rocPoints(stepsOf(P, B));
  // At most ⌊0.05 · 2⌋ = 0 B abnormal-like and ⌊0.05 · 3⌋ = 0 P WT-like.
  assert.deepEqual(ruleThresholds(roc, 'error', 0.05), { abnormal: 1.75, normal: 0.5, crossed: false });
  assert.deepEqual(ruleThresholds(roc, 'youden'), { abnormal: 1.75, normal: 1.75, crossed: false });
  // Crossing: P at 6–10 and a B at 6.5 among them, a fifth of each side allowed across. The most P
  // with one B is everything above 4.5; the fewest B with four P everything above 6.75: both hold
  // over 4.5–6.75, and the classes meet in its middle.
  const crossed = ruleThresholds(rocPoints(stepsOf([6, 7, 8, 9, 10], [0, 1, 2, 3, 6.5])), 'error', 0.2);
  assert.deepEqual(crossed, { abnormal: 5.625, normal: 5.625, crossed: true });
  // Classes: a score at a threshold on its abnormal-like side; below mirrors above.
  const t = { abnormal: 1.75, normal: 0.5 };
  assert.deepEqual([3, 1.75, 1, 0.5, 0].map((x) => classOf(x, 'above', t)), ['abnormal-like', 'abnormal-like', 'intermediate', 'intermediate', 'WT-like']);
  assert.deepEqual([-3, -1.75, -1, -0.5, 0].map((x) => classOf(x, 'below', { abnormal: -1.75, normal: -0.5 })), ['abnormal-like', 'abnormal-like', 'intermediate', 'intermediate', 'WT-like']);
  assert.equal(classOf(5, 'above', { abnormal: null, normal: 0.5 }), 'intermediate', 'a class no threshold makes is empty');
  // The same controls mirrored: the same classes, thresholds negated.
  const up = calibrationMetrics(P, B, { side: 'above', rule: 'error', samples: 0 });
  const down = calibrationMetrics(P.map((x) => -x), B.map((x) => -x), { side: 'below', rule: 'error', samples: 0 });
  assert.deepEqual([down.thresholds.abnormal, down.thresholds.normal], [-1.75, -0.5]);
  assert.deepEqual(down.classes, up.classes);
  assert.deepEqual(up.classes.P, { 'abnormal-like': 2, intermediate: 1, 'WT-like': 0, total: 3 });
  assert.deepEqual(up.classes.B, { 'abnormal-like': 0, intermediate: 1, 'WT-like': 1, total: 2 });
  assert.equal(thresholdWords('below', { abnormal: -1.75, normal: -0.5 }), 'abnormal-like ≤ -1.75; intermediate -1.75 to -0.5; WT-like > -0.5');
});

test('Wilson\'s interval as binom computes it; given thresholds checked; the metrics refuse what they cannot do', () => {
  const w = wilson(8, 10);
  assert.ok(close(w.low, 0.4901625, 1e-6) && close(w.high, 0.9433178, 1e-6), `${w.low} ${w.high}`);
  assert.deepEqual([wilson(0, 10).low, wilson(10, 10).high].map((x) => Number(x.toFixed(12))), [0, 1]);
  const given = calibrationMetrics(P, B, { side: 'above', rule: 'given', abnormal: 2.5, normal: 1, samples: 0 });
  assert.deepEqual([given.classes.P['abnormal-like'], given.classes.B['WT-like']], [1, 1]);
  assert.throws(() => calibrationMetrics(P, B, { side: 'above', rule: 'given', abnormal: 1, normal: 2.5, samples: 0 }), /the abnormal threshold is at or above the normal one: 1 is below 2\.5/);
  assert.throws(() => calibrationMetrics(P, B, { side: 'above', rule: 'given', abnormal: null, normal: 2, samples: 0 }), /two numbers/);
  assert.throws(() => calibrationMetrics(P, [], { side: 'above' }), /both sides/);
  assert.throws(() => calibrationMetrics(P, B, { side: 'left' }), /below or above/);
  assert.throws(() => calibrationMetrics(P, B, { side: 'above', error: 0.5 }), /below 0\.5/);
});

test('the side of abnormal-like scores: chosen, the readout\'s, else the P controls\' median; the controls running the other way said', () => {
  const stated = { readout: { direction: 'higher-more' } };
  assert.deepEqual(scaleSide('auto', stated, [-2, -1], [0, 1]), { side: 'below', from: 'readout', against: null });
  assert.deepEqual(scaleSide('auto', stated, [2, 3], [0, 1]), { side: 'below', from: 'readout', against: { P: 2.5, B: 0.5 } });
  assert.deepEqual(scaleSide('auto', {}, [2, 3], [0, 1]), { side: 'above', from: 'controls', against: null });
  assert.deepEqual(scaleSide('above', stated, [2, 3], [0, 1]), { side: 'above', from: 'chosen', against: null });
});

test('the bootstrap: seeded (the same twice), stratified (each side as many as it has), its intervals around the estimate', () => {
  const p = Array.from({ length: 40 }, (_, i) => -0.3 + Math.sin(i * 1.7) * 0.8);
  const b = Array.from({ length: 25 }, (_, i) => 0.4 + Math.cos(i * 2.3) * 0.6);
  const settings = { rule: 'error', error: 0.05, samples: 300, seed: 7, level: 0.95 };
  const once = bootstrapMetrics(p.map((x) => -x), b.map((x) => -x), settings);
  const twice = bootstrapMetrics(p.map((x) => -x), b.map((x) => -x), settings);
  assert.deepEqual(once, twice);
  const m = calibrationMetrics(p, b, { side: 'below', ...settings });
  assert.ok(m.auc.boot.low <= m.auc.auc && m.auc.auc <= m.auc.boot.high);
  assert.ok(m.pr.boot.low <= m.pr.auc && m.pr.auc <= m.pr.boot.high);
  assert.ok(m.thresholds.stability.abnormal.low <= m.thresholds.abnormal && m.thresholds.abnormal <= m.thresholds.stability.abnormal.high);
  assert.equal(m.roc.band.length, 21);
  assert.equal(m.pr.band.length, 20);
  const drawn = (seed) => bootstrapMetrics(p.map((x) => -x), b.map((x) => -x), { ...settings, seed, keep: true }).drawn.auc;
  assert.notDeepEqual(drawn(8), drawn(7), 'another seed, other samples');
});

test('kept with the workspace: in the history and a checkpoint\'s diff, gone with its run or control set, proposed by an agent', () => {
  let ws = createWorkspace('Toy', { now: '2026-10-13T00:00:00.000Z' });
  ws = { ...ws, runs: [{ id: 'run-1', name: 'Run 1', inputs: {} }] };
  ws = addControlSet(ws, { name: 'Set', source: { kind: 'table', file: { fileName: 'labels.csv' } }, rules: { kinds: ['missense'] }, labels: [], excluded: {}, notes: [] }, '2026-10-13T00:01:00.000Z').ws;
  const before = analysisState(ws);
  const cal = { name: 'Run 1 · Set', controlSet: 'Set', run: 'run-1', condition: 0, side: 'below', sideFrom: 'readout', rule: 'error', error: 0.05, thresholds: { abnormal: -1, normal: 0.5 }, bootstrap: { samples: 2000, seed: 20261009 }, n: { P: 12, B: 11 } };
  const made = addCalibration(ws, cal, 'Run 1 against "Set": 12 P and 11 B controls scored, AUC 0.9', '2026-10-13T00:02:00.000Z');
  assert.equal(made.id, 'Run-1-Set');
  assert.equal(made.ws.history.at(-1).detail, 'Calibrated: "Run 1 · Set", Run 1 against "Set": 12 P and 11 B controls scored, AUC 0.9');
  assert.ok(verifyHistory(made.ws).ok);
  assert.deepEqual(diffStates(before, analysisState(made.ws)).changes.map((c) => c.text), ['The calibration "Run 1 · Set" was made (Run 1 against "Set", 12 P and 11 B controls scored; abnormal-like ≤ -1; intermediate -1 to 0.5; WT-like > 0.5).']);
  // Its control set or its run removed, it goes too, and the history says so.
  const noSet = removeControlSet(made.ws, 'Set');
  assert.equal(noSet.calibrations, undefined);
  assert.equal(noSet.history.at(-1).detail, 'Deleted the control set "Set", and the calibration "Run 1 · Set" made with it');
  const noRun = removeRun(made.ws, 'run-1');
  assert.equal(noRun.calibrations, undefined);
  assert.match(noRun.history.at(-1).detail, /, and the calibration "Run 1 · Set" made with it$/);
  // An agent's: made at once and marked proposed; rejecting removes it, accepting keeps it.
  const agent = addCalibration(ws, cal, null).ws;
  const absorbed = absorb(ws, agent, 'An agent', '2026-10-13T00:03:00.000Z').ws;
  assert.equal(absorbed.calibrations[0].proposed.by, 'An agent');
  const id = absorbed.proposals[0].id;
  assert.equal(rejectProposal(absorbed, id).calibrations, undefined);
  assert.ok(acceptProposal(absorbed, id).calibrations[0].proposed.accepted);
});
