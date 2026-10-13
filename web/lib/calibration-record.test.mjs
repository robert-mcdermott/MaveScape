import assert from 'node:assert/strict';
import test from 'node:test';
import { calibrationParagraphs, strengthsSentence } from './calibration-record.js';
import { calibrationRanges, mavedbOddsPathStrength } from './mavedb-export.js';
import { classOf } from './calibration.js';
import { evidenceStrength } from './oddspath.js';
import { inPublishedRange } from './calibration.js';
import { checkFigure, createFigure, addPanel, panelSummary } from './figures.js';

test('a calibration\'s classes as MaveDB\'s ranges: a score at a threshold on its abnormal-like side, as classOf puts it, either side; empty classes left out', () => {
  const read = (side, t) => calibrationRanges(side, t).map((r) => ({ class: r.class, range: r.range, inclusive: r.inclusive }));
  for (const [side, t] of [['below', { abnormal: -1, normal: 0.5 }], ['above', { abnormal: 2, normal: 1 }], ['below', { abnormal: 0, normal: 0 }], ['below', { abnormal: null, normal: 1 }], ['above', { abnormal: 3, normal: null }]]) {
    const ranges = calibrationRanges(side, t);
    for (const x of [-2, -1, -0.5, 0, 0.5, 1, 1.5, 2, 3, 4]) {
      const holding = ranges.filter((r) => inPublishedRange({ range: r.range, inclusive: r.inclusive }, x)).map((r) => r.class);
      assert.deepEqual(holding, [classOf(x, side, t)], `${side} ${JSON.stringify(t)} at ${x}`);
    }
  }
  assert.deepEqual(read('below', { abnormal: 0, normal: 0 }).map((r) => r.class), ['abnormal-like', 'WT-like'], 'one threshold: no intermediate zone');
  assert.deepEqual(read('below', { abnormal: -1, normal: 0.5 })[0], { class: 'abnormal-like', range: [null, -1], inclusive: [false, true] }, 'no bound includes infinity');
});

test('MaveDB reads an OddsPath as Brnich et al.\'s Table 3 does, but for PS3 strong beyond 18.6, where the paper prints 18.7', () => {
  const codes = { PS3_very_strong: 'PS3 VERY_STRONG', PS3: 'PS3 STRONG', PS3_moderate: 'PS3 MODERATE', PS3_supporting: 'PS3 SUPPORTING', BS3: 'BS3 STRONG', BS3_moderate: 'BS3 MODERATE', BS3_supporting: 'BS3 SUPPORTING', Indeterminate: 'none' };
  const differ = [];
  for (const x of [0.01, 0.053, 0.0531, 0.2, 0.23, 0.3, 0.48, 0.5, 1, 2.1, 2.2, 4.3, 4.4, 18.6, 18.65, 18.7, 18.8, 350, 351]) {
    const ours = codes[evidenceStrength(x).code];
    const theirs = mavedbOddsPathStrength(x)?.join(' ') ?? 'none';
    if (ours !== theirs) differ.push(`${x}: ${ours} / ${theirs}`);
  }
  assert.deepEqual(differ, ['18.65: PS3 MODERATE / PS3 STRONG', '18.7: PS3 MODERATE / PS3 STRONG']);
});

test('where each strength the likelihood ratios reach begins, in words: pathogenic toward the pathogenic end, benign toward the other', () => {
  const t = (boundary, score, lower = null, upper = null) => ({ boundary, score, lower, upper });
  const res = {
    curve: { inverse: true },
    thresholds: [t('Benign-VeryStrong|Benign-Strong', null), t('Benign-Strong|Benign-Moderate', null), t('Benign-Moderate|Benign-Supporting', 2.5), t('Benign-Supporting|Indeterminate', 2, 1.9, 2.1),
      t('Indeterminate|Pathogenic-Supporting', 0.637, 0.64, 0.634), t('Pathogenic-Supporting|Pathogenic-Moderate', 0.585), t('Pathogenic-Moderate|Pathogenic-Strong', null), t('Pathogenic-Strong|Pathogenic-VeryStrong', null)],
  };
  assert.equal(strengthsSentence(res), 'Pathogenic-Supporting below 0.637 (0.634 to 0.64), Pathogenic-Moderate below 0.585; Benign-Supporting above 2 (1.9 to 2.1), Benign-Moderate above 2.5');
  assert.equal(strengthsSentence({ curve: { inverse: false }, thresholds: res.thresholds.map((x) => ({ ...x, score: null })) }), 'no pathogenic strength reached; no benign strength reached');
});

test('a calibration that cannot be computed again: the report says what it keeps, and why', () => {
  const cal = { name: 'Run 1 · Controls', run: 'run-1', controlSet: 'set', side: 'below', rule: 'error', error: 0.05, thresholds: { abnormal: 0.78, normal: 1.58 }, n: { P: 164, B: 22 } };
  const [text] = calibrationParagraphs({ cal, set: { name: 'Controls' }, run: { name: 'Run 1' }, problem: 'Run 1\'s table is not in the workspace.' }, () => '[1]');
  assert.equal(text, 'Run 1\'s scores were calibrated against the control set "Controls", for research: 164 P controls and 22 B controls scored; abnormal-like scores below the others; thresholds set by the controls, at most 5% of either side\'s controls on the other side\'s class: abnormal-like ≤ 0.78; intermediate 0.78 to 1.58; WT-like > 1.58. Its metrics could not be computed again here: Run 1\'s table is not in the workspace.');
});

test('a calibration panel names its calibration and its plot; said in words', () => {
  const fig = createFigure('Figure 1', 'double');
  const { figure, panel } = addPanel(fig, { kind: 'calibration', calibration: 'cal-1', plot: 'roc', w: 240, h: 220 });
  assert.doesNotThrow(() => checkFigure(figure));
  assert.throws(() => checkFigure({ ...figure, panels: [{ ...panel, calibration: undefined }] }), /names its calibration/);
  assert.throws(() => checkFigure({ ...figure, panels: [{ ...panel, plot: 'volcano' }] }), /distribution, roc, pr, likelihood/);
  assert.equal(panelSummary(panel, { calibrations: [{ id: 'cal-1', name: 'Run 1 · ClinVar' }] }), 'the ROC curve of the calibration "Run 1 · ClinVar"');
  assert.equal(panelSummary({ ...panel, plot: 'distribution' }, {}), 'each side\'s scores against the run\'s of the calibration "cal-1"');
});
