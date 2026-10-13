// OddsPath, for research (wave 8, slice 3; requirement K3): the odds of pathogenicity a functional
// class gives, as Brnich et al. define it (Genome Medicine 2020;12:3, published 31 December 2019,
// doi:10.1186/s13073-019-0690-2), and the evidence strength their Table 3 makes of it. Checked
// against the paper's own spreadsheet (validation suite `calibration`, reference/brnich-oddspath.json).
//
// P1 is the P controls' share of all the controls scored (those intermediate too: the paper's
// Table S2 counts its indeterminate control in the total). P2 is the P controls' share in the class,
// with one control of the other side added, as Brnich et al. add "exactly one misclassified variant
// to each set" so that P2 is never 0 or 1 and the next control may be discordant: the abnormal-like
// class gains a B control, P2 = P / (P + B + 1); the WT-like class a P control, P2 = (P + 1) /
// (P + B + 1). OddsPath = [P2 × (1 − P1)] / [(1 − P2) × P1], in the paper's order of operations. A
// class holding no control has none.
//
// The words are evidence strength for research use (mavescape-spec/conventions.md, Terminology):
// what a class would contribute as functional evidence (PS3 for the abnormal-like class, BS3 for the
// WT-like), never a variant's classification.

const PATHOGENIC = [[350, 'PS3_very_strong', 'very strong'], [18.7, 'PS3', 'strong'], [4.3, 'PS3_moderate', 'moderate'], [2.1, 'PS3_supporting', 'supporting']];
// No benign code beyond strong: Table 3 stops at BS3 (the spreadsheet's "very strong" benign row is
// "for modeling purposes only").
const BENIGN = [[0.053, 'BS3', 'strong'], [0.23, 'BS3_moderate', 'moderate'], [0.48, 'BS3_supporting', 'supporting']];

// Table 3: the evidence strength of an OddsPath, { code, level, side ('PS3' | 'BS3' | null) }:
// beyond each threshold strictly (2.1 itself is indeterminate), between 0.48 and 2.1 indeterminate.
export function evidenceStrength(oddsPath) {
  if (!Number.isFinite(oddsPath)) return oddsPath === Infinity ? { code: 'PS3_very_strong', level: 'very strong', side: 'PS3' } : null;
  for (const [above, code, level] of PATHOGENIC) if (oddsPath > above) return { code, level, side: 'PS3' };
  for (const [below, code, level] of BENIGN) if (oddsPath < below) return { code, level, side: 'BS3' };
  return { code: 'Indeterminate', level: 'indeterminate', side: null };
}

// Brnich et al.'s OddsPath of a class: inP and inB its P and B controls, nP and nB all the controls
// scored, which 'abnormal' (the abnormal-like class, toward PS3) or 'normal' (WT-like, toward BS3).
// Returns { P, B, prior (P1), posterior (P2), oddsPath, observed (without the added control; null
// where it is 0 or infinite), strength (Table 3, only toward the class's own side: a class pointing
// the other way is indeterminate, and contrary), contrary } or, for a class without controls,
// { P: 0, B: 0, oddsPath: null, strength: null }.
export function classOddsPath(inP, inB, nP, nB, which) {
  if (!(nP > 0) || !(nB > 0)) throw new Error('OddsPath needs controls on both sides.');
  if (!(inP + inB > 0)) return { P: 0, B: 0, prior: nP / (nP + nB), posterior: null, oddsPath: null, observed: null, strength: null, contrary: false };
  const p1 = nP / (nP + nB);
  const p2 = which === 'abnormal' ? inP / (inP + inB + 1) : (inP + 1) / (inP + inB + 1);
  const oddsPath = (p2 * (1 - p1)) / ((1 - p2) * p1);
  const share = inP / (inP + inB);
  const observed = share > 0 && share < 1 ? (share * (1 - p1)) / ((1 - share) * p1) : null;
  const toward = evidenceStrength(oddsPath);
  const own = which === 'abnormal' ? 'PS3' : 'BS3';
  const contrary = which === 'abnormal' ? oddsPath < 1 : oddsPath > 1;
  const strength = toward?.side === own ? toward : { code: 'Indeterminate', level: 'indeterminate', side: null };
  return { P: inP, B: inB, prior: p1, posterior: p2, oddsPath, observed, strength, contrary };
}

// The strength codes in order, for tallies: the pathogenic side from the strongest, indeterminate,
// the benign side to the strongest.
export const STRENGTH_CODES = [...PATHOGENIC.map((x) => x[1]), 'Indeterminate', ...BENIGN.map((x) => x[1]).reverse()];

// A strength in words: "PS3_moderate (moderate)", or "indeterminate".
export const strengthWords = (s) => (!s ? 'none' : s.code === 'Indeterminate' ? 'indeterminate' : `${s.code} (${s.level})`);
