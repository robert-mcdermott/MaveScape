import assert from 'node:assert/strict';
import test from 'node:test';
import { classOddsPath, evidenceStrength, STRENGTH_CODES, strengthWords } from './oddspath.js';
import { oddsPathEvidence } from './calibration.js';

const close = (a, b, eps = 1e-12) => Math.abs(a - b) <= eps;

test('Table 3: each strength beyond its threshold, strictly; between 0.48 and 2.1 indeterminate; no benign code beyond BS3', () => {
  assert.deepEqual([400, 350, 20, 18.7, 5, 4.3, 3, 2.1, 1, 0.48, 0.3, 0.23, 0.1, 0.053, 0.001].map((x) => evidenceStrength(x).code),
    ['PS3_very_strong', 'PS3', 'PS3', 'PS3_moderate', 'PS3_moderate', 'PS3_supporting', 'PS3_supporting', 'Indeterminate', 'Indeterminate', 'Indeterminate', 'BS3_supporting', 'BS3_supporting', 'BS3_moderate', 'BS3_moderate', 'BS3']);
  assert.equal(evidenceStrength(Number.NaN), null);
  assert.equal(STRENGTH_CODES.join(), 'PS3_very_strong,PS3,PS3_moderate,PS3_supporting,Indeterminate,BS3_supporting,BS3_moderate,BS3');
  assert.equal(strengthWords(evidenceStrength(5)), 'PS3_moderate (moderate)');
});

test('Brnich et al.\'s OddsPath of a class, by hand: one control of the other side added; P1 of every control scored', () => {
  // Figure 1's example: 5 P controls abnormal, 6 B of which 5 normal and one indeterminate. P1 =
  // 5/11; abnormal P2 = 5/6, odds 5 against prior odds 5/6: 6. Normal P2 = 1/6, odds 1/5: 0.24.
  const a = classOddsPath(5, 0, 5, 6, 'abnormal');
  assert.ok(close(a.prior, 5 / 11) && close(a.posterior, 5 / 6) && close(a.oddsPath, 6));
  assert.equal(a.strength.code, 'PS3_moderate');
  const n = classOddsPath(0, 5, 5, 6, 'normal');
  assert.ok(close(n.posterior, 1 / 6) && close(n.oddsPath, 0.24));
  assert.equal(n.strength.code, 'BS3_supporting', 'Table 3: 0.24 is not below 0.23');
  // Observed (no control added) where the class's share is neither 0 nor 1.
  const mixed = classOddsPath(8, 2, 10, 10, 'abnormal');
  assert.ok(close(mixed.oddsPath, (8 / 11) / (3 / 11)) && close(mixed.observed, 4));
  assert.equal(n.observed, null);
  // A class pointing the other way gives no evidence for its side; an empty class none at all.
  const contrary = classOddsPath(1, 9, 10, 10, 'abnormal');
  assert.ok(contrary.contrary && contrary.oddsPath < 0.48);
  assert.equal(contrary.strength.code, 'Indeterminate');
  assert.deepEqual([classOddsPath(0, 0, 10, 10, 'normal').oddsPath, classOddsPath(0, 0, 10, 10, 'normal').strength], [null, null]);
  assert.throws(() => classOddsPath(1, 0, 1, 0, 'abnormal'), /both sides/);
});

test('a calibration\'s evidence: the classes the thresholds make, and the bootstrap with the thresholds kept (seeded, its strengths\' shares)', () => {
  const P = [-3, -2.5, -2, -1.8, -1.5, -1.2, -0.4, 0.2];
  const B = [-0.6, 0.1, 0.3, 0.5, 0.8, 1, 1.2];
  const thresholds = { abnormal: -1, normal: 0 };
  const e = oddsPathEvidence(P, B, 'below', thresholds, { samples: 400, seed: 3 });
  // Abnormal-like (≤ −1): 6 P, 0 B, P2 = 6/7, odds 6 against prior odds 8/7. WT-like (> 0): 1 P,
  // 6 B, P2 = (1 + 1)/(1 + 6 + 1) = 1/4, odds 1/3.
  assert.deepEqual([e.abnormal.P, e.abnormal.B, e.normal.P, e.normal.B], [6, 0, 1, 6]);
  assert.ok(close(e.abnormal.oddsPath, 6 * (7 / 8)));
  assert.ok(close(e.normal.oddsPath, (1 / 3) * (7 / 8)));
  const shares = (x) => Object.values(x.boot.strengths).reduce((a, b) => a + b, 0) + x.boot.empty / x.boot.samples;
  assert.ok(close(shares(e.abnormal), 1) && close(shares(e.normal), 1));
  assert.deepEqual(oddsPathEvidence(P, B, 'below', thresholds, { samples: 400, seed: 3 }), e);
  assert.equal(oddsPathEvidence(P, B, 'below', thresholds).abnormal.boot, null, 'no samples, no bootstrap');
});
