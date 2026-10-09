// Filters: ordered, visible stages with reason codes (requirement S3; PRD "Filtering"). A
// filtered variant keeps its measurements (counts, replicate scores) and says at which stage and
// why it was left out; its score is NA, never 0. Count filters act per replicate (a replicate
// whose input is too low does not count for that variant); the variant is left out when no
// replicate remains, or fewer than the minimum.

import { KIND, KIND_NAMES } from './variants.js';

// The stages in the order they apply. `rule`: always on (not a parameter).
export const STAGES = [
  { id: 'measured', code: 1, label: 'Counted in a replicate', rule: true, reason: 'not counted in every sample of any replicate' },
  { id: 'identifier', code: 2, label: 'Valid identifier', rule: true, reason: 'the identifier is not valid or does not agree with the target' },
  { id: 'class', code: 3, label: 'Variant class', reason: 'its class is not scored' },
  { id: 'excluded', code: 4, label: 'Exclusion list', reason: 'excluded by the user' },
  { id: 'input-count', code: 5, label: 'Minimum input count', reason: 'too few input reads in every replicate' },
  { id: 'total-count', code: 6, label: 'Minimum total count', reason: 'too few reads in every replicate' },
  { id: 'replicates', code: 7, label: 'Minimum usable replicates', reason: 'too few usable replicates' },
  { id: 'se', code: 8, label: 'Maximum SE', reason: 'the standard error is too large' },
];
export const STAGE_BY_CODE = new Map(STAGES.map((s) => [s.code, s]));
export const STAGE_BY_ID = new Map(STAGES.map((s) => [s.id, s]));

// Why a replicate's measurement of a variant is not used (per replicate, per variant).
export const REPLICATE_STATE = { USED: 0, NOT_COUNTED: 1, INPUT_COUNT: 2, TOTAL_COUNT: 3 };
export const REPLICATE_STATE_NAMES = ['used', 'not counted in every sample', 'input count below the minimum', 'total count below the minimum'];

// Flags on a scored variant (bits): measurements to read with care, shown as low confidence.
export const FLAG = { OUTPUT_ZERO: 1, INPUT_ZERO: 2, FEWER_REPLICATES: 4 };
export const FLAG_NAMES = [
  [FLAG.OUTPUT_ZERO, 'no reads after selection in a replicate: the score rests on the pseudocount'],
  [FLAG.INPUT_ZERO, 'no reads before selection in a replicate'],
  [FLAG.FEWER_REPLICATES, 'scored in fewer replicates than the design has'],
];
export const flagNames = (flags) => FLAG_NAMES.filter(([bit]) => flags & bit).map(([, name]) => name);

// MaveScape's defaults: a variant with no input reads is not measured (it was not in the
// library), and nothing else is left out.
export const DEFAULT_FILTERS = {
  excludeKinds: [],
  exclude: [],
  minInputCount: 1,
  minTotalCount: 0,
  minReplicates: 1,
  maxSE: null,
};

// Checks filter parameters: a list of problems (empty when valid).
export function checkFilters(filters) {
  const problems = [];
  const f = { ...DEFAULT_FILTERS, ...filters };
  const count = (name, label) => {
    if (!(Number.isFinite(f[name]) && f[name] >= 0)) problems.push(`${label} must be a number of 0 or more.`);
  };
  count('minInputCount', 'The minimum input count');
  count('minTotalCount', 'The minimum total count');
  if (!(f.minReplicates === 'all' || (Number.isInteger(f.minReplicates) && f.minReplicates >= 1))) problems.push('The minimum number of replicates must be a whole number of 1 or more, or "all".');
  if (!(f.maxSE === null || (Number.isFinite(f.maxSE) && f.maxSE > 0))) problems.push('The maximum SE must be a positive number, or none.');
  if (!Array.isArray(f.excludeKinds) || f.excludeKinds.some((k) => !KIND_NAMES.includes(k))) problems.push('Excluded classes must be variant classes.');
  if (!Array.isArray(f.exclude) || f.exclude.some((x) => typeof x !== 'string')) problems.push('The exclusion list must be a list of variant identifiers.');
  return problems;
}

// One line per active stage, in order, for the filter bar and the methods.
export function describeFilters(filters, replicates = null) {
  const f = { ...DEFAULT_FILTERS, ...filters };
  const minReplicates = f.minReplicates === 'all' ? `all of the variant's${replicates ? ` (${replicates})` : ''}` : String(f.minReplicates);
  return [
    { stage: 'measured', text: 'Counted in every sample of a replicate' },
    { stage: 'identifier', text: 'Identifier valid against the target' },
    { stage: 'class', text: f.excludeKinds.length ? `Classes left out: ${f.excludeKinds.join(', ')}` : 'Every variant class', active: f.excludeKinds.length > 0 },
    { stage: 'excluded', text: f.exclude.length ? `${f.exclude.length} variant${f.exclude.length > 1 ? 's' : ''} excluded by name` : 'No exclusion list', active: f.exclude.length > 0 },
    { stage: 'input-count', text: `Input count ≥ ${f.minInputCount} per replicate`, active: f.minInputCount > 0 },
    { stage: 'total-count', text: `Total count ≥ ${f.minTotalCount} per replicate`, active: f.minTotalCount > 0 },
    { stage: 'replicates', text: `Usable replicates ≥ ${minReplicates}`, active: f.minReplicates !== 1 },
    { stage: 'se', text: f.maxSE === null ? 'No maximum SE' : `SE ≤ ${f.maxSE}`, active: f.maxSE !== null },
  ];
}

// The state of one replicate's measurement of a variant, from its counts: c0 (the first sample),
// total (every sample of the replicate), counted (finite in every sample).
export function replicateState(counted, c0, total, filters) {
  if (!counted) return REPLICATE_STATE.NOT_COUNTED;
  if (c0 < filters.minInputCount) return REPLICATE_STATE.INPUT_COUNT;
  if (total < filters.minTotalCount) return REPLICATE_STATE.TOTAL_COUNT;
  return REPLICATE_STATE.USED;
}

// The variant-level stage before scoring that leaves a variant out, or 0: its identifier, class
// or the exclusion list. `kind` and `invalid` from variants.js; `excluded` a Set of identifiers.
export function variantStage(row, variants, excludeKinds, excluded) {
  if (variants.status[row] === 3) return STAGE_BY_ID.get('identifier').code;
  if (excludeKinds.has(variants.kind[row])) return STAGE_BY_ID.get('class').code;
  if (excluded.size && (excluded.has(variants.key[row]) || excluded.has(variants.original[row]))) return STAGE_BY_ID.get('excluded').code;
  return 0;
}

export const kindCodes = (names) => new Set(names.map((name) => KIND_NAMES.indexOf(name)).filter((k) => k > 0 && k !== KIND.NONE));

// The filter flow: how many variants each stage leaves out, and how many remain after it.
// reasons: per variant the code of the stage that left it out (0: scored).
export function filterFlow(reasons) {
  const removed = new Map(STAGES.map((s) => [s.code, 0]));
  for (const r of reasons) if (r) removed.set(r, removed.get(r) + 1);
  let remaining = reasons.length;
  return STAGES.map((s) => {
    remaining -= removed.get(s.code);
    return { stage: s.id, label: s.label, removed: removed.get(s.code), remaining };
  });
}
