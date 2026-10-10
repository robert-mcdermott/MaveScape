// The rescaling anchors' uncertainty (wave 2, slice 9; requirement S11). A run rescaled so that two
// anchors land on fixed values (the wild type 1 and the nonsense median 0, or the synonymous median
// 0 and the nonsense median −1) carries the anchors' own error: the wild type's SE, a median's
// sampling error. It moves every score together, by the delta method
//
//   SE_scale(s′)² = (1 − t)² u₀² + t² u₁²,   t = (s′ − to₀) / (to₁ − to₀),
//
// t being the score's place between the anchors (0 at the first, 1 at the second) and u₀, u₁ the
// anchors' SEs on the rescaled scale. It is reported apart from each variant's SE, which comparisons
// between variants of one run need without it; a score compared with another assay's, or with the
// anchors' true values, needs both. The scale is defined by the controls measured, so a median of
// n control scores is uncertain by their measurement error alone: about π/2 times the mean of their
// squared SEs, over n.
//
// Pure: from the run's results and its design; not part of the run's output hash (it follows from
// what is).

import { controlRows } from './score.js';
import { square } from './dmath.js';

// For one condition: null without rescaling; else { anchors: [{ what, to, se }], at(score) → SE_scale }.
export function anchorUncertainty(results, design, condition = 0) {
  const c = results.conditions[condition];
  const r = c?.rescale;
  if (!r) return null;
  const rows = controlRows(design, { ...results.variants, n: results.rows });
  const anchors = r.anchors.map((a) => {
    let se = Number.NaN;
    if (a.what === 'wild type') {
      se = rows.wt >= 0 ? c.se[rows.wt] : Number.NaN;
    } else {
      // The class's scored members: their median's error, from their SEs (the scale is these
      // controls' median, so their own spread is not error), about π/2 × the mean squared SE / n.
      const members = (a.what === 'nonsense' ? rows.nonsense : rows.synonymous).filter((i) => !c.reason[i] && Number.isFinite(c.se[i]));
      if (members.length >= 2) {
        let ss = 0;
        for (const i of members) ss += square(c.se[i]);
        se = Math.sqrt(((Math.PI / 2) * ss) / members.length / members.length);
      }
    }
    return { what: a.what, to: a.to, from: a.from, se };
  });
  const [a0, a1] = anchors;
  const span = a1.to - a0.to;
  return {
    anchors,
    at: (score) => {
      if (!Number.isFinite(score)) return Number.NaN;
      const t = (score - a0.to) / span;
      return Math.sqrt(square(1 - t) * square(a0.se) + square(t) * square(a1.se));
    },
  };
}

