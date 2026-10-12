// Selections by query (wave 4, slice 5; requirement V3): a small language over the cells of a
// variant-effect map, PyMOL-like keywords with Boolean logic, so that a selection can be said in
// words and made again on another run:
//
//   missense at 40-80 with se < 0.2          nonsense or synonymous
//   from C in feature "disulfide bond"       to P and score < -1
//   lower and not robust                     variants whose class depends on the pseudocount
//   in "Core" and not in "Surface"           selected and low
//
// Juxtaposition means AND ("missense at 40-80"), as do "with", "whose", "that" and "which";
// "or", "not" and parentheses as usual. The tokenizer and the parser are adapted from
// Proteoscope's web/lib/select.js (Apache-2.0, the same author), whose residue selections wave 5
// copies; the keywords are MaveScape's. parseQuery() turns text into an AST; evaluateQuery()
// applies it to a map model and a context (queryContext) and returns the cells it selects. Pure.

import { KIND } from './variants.js';
import { cellAt, cellName, STATE } from './map-model.js';
import { STAGE_BY_ID } from './filters.js';
import { callsOf, CLASS, VERDICT } from './robustness.js';

export class QueryError extends Error {
  // need: what the query needs that the context lacks ('robustness', 'features'), so that a caller
  // can offer it (check the run's robustness; add a features track).
  constructor(message, position = -1, need = null) {
    super(message);
    this.name = 'QueryError';
    this.position = position;
    this.need = need;
  }
}

// --- Keywords ------------------------------------------------------------------------------------

const KIND_WORDS = {
  missense: 'missense', nonsense: 'nonsense', stop: 'nonsense', stops: 'nonsense', synonymous: 'synonymous', silent: 'synonymous',
  'start-lost': 'start-lost', startlost: 'start-lost',
};
const STATE_WORDS = {
  scored: 'scored', low: 'low', 'low-confidence': 'low', confident: 'confident', filtered: 'filtered', missing: 'missing', unscored: 'unscored',
};
const CLASS_WORDS = { lower: 'lower', higher: 'higher', neutral: 'neutral', 'like-wt': 'neutral', unchanged: 'neutral' };
const VERDICT_WORDS = {
  robust: 'robust', fragile: 'fragile', uncertain: 'uncertain', borderline: 'borderline',
  'size-dependent': 'size', sized: 'size', 'sometimes-scored': 'inclusion', 'not-always-scored': 'inclusion',
};
const NUMERIC_WORDS = { score: 'score', se: 'se', q: 'q', replicates: 'replicates', reps: 'replicates', k: 'replicates', input: 'input' };
const POSITION_WORDS = { at: 'pos', pos: 'pos', position: 'pos', positions: 'pos', refpos: 'refpos' };
// Words that join two terms as AND, and words that say nothing ("missense variants").
const AND_WORDS = new Set(['and', 'with', 'whose', 'that', 'which', 'where']);
const FILLER_WORDS = new Set(['variants', 'variant', 'substitutions', 'the']);
// The robustness choices a variant's conclusion can depend on (robustness.js choice ids).
export const CHOICE_WORDS = {
  pseudocount: ['pseudocount'], normalization: ['normalization'], normalisation: ['normalization'], model: ['model'], regression: ['regressionSE'],
  combination: ['combination'], filters: ['minInputCount', 'minReplicates', 'minTimePoints'], filter: ['minInputCount', 'minReplicates', 'minTimePoints'],
  'leave-out': ['leaveOut'], leaveout: ['leaveOut'], replicate: ['leaveOut'], replicates: ['leaveOut'],
};

// Amino acids as variants.js numbers them, and the map's biochemical groups (map-model.js).
const CODES = 'ARNDCQEGHILKMFPSTWYV*';
const THREE = { ala: 'A', arg: 'R', asn: 'N', asp: 'D', cys: 'C', gln: 'Q', glu: 'E', gly: 'G', his: 'H', ile: 'I', leu: 'L', lys: 'K', met: 'M', phe: 'F', pro: 'P', ser: 'S', thr: 'T', trp: 'W', tyr: 'Y', val: 'V', ter: '*' };
const GROUPS = { positive: 'HKR', negative: 'DE', polar: 'CMNQST', aliphatic: 'AILV', aromatic: 'FWY', special: 'GP', stop: '*' };

// The words, for the help beside the query field and the guide.
export const QUERY_HELP = [
  ['missense, nonsense, synonymous, start-lost', 'The variant\'s class.', 'nonsense or synonymous'],
  ['scored, low, confident, filtered, missing, unscored', 'Its state: scored (low confidence or not), scored with low confidence, scored without it, filtered, not measured, either of the last two.', 'missense and low'],
  ['at, pos, refpos', 'Positions on the target (refpos: on the reference\'s numbering), a range or a list; or compared, pos > 100.', 'at 40-80,95'],
  ['from, to', 'The wild-type residue and the substituted one: one or three letters, or a group (positive, negative, polar, aliphatic, aromatic, special, stop).', 'from C to aromatic'],
  ['score, se, q, replicates, input', 'Compared with a number (<, <=, >, >=, =, !=): the score (a contrast\'s difference), its SE, the q of its class, the replicates behind it, its mean input count. An unscored variant never passes.', 'se < 0.2'],
  ['lower, higher, neutral', 'Its class against the wild type, beyond its uncertainty (q < 0.05; a contrast\'s difference, from its own q).', 'lower and at 1-30'],
  ['robust, fragile, uncertain, borderline, size-dependent, sometimes-scored', 'Its verdict when the run\'s robustness is checked (Score, Check robustness).', 'lower and not robust'],
  ['depends on, class depends on, size depends on', 'A verdict that names a choice: pseudocount, normalization, model, regression, combination, filters or leave-out.', 'class depends on the pseudocount'],
  ['feature', 'Positions under a feature beside the map (its name or type, in part; * and ? as wildcards): UniProt\'s, or a GFF3 file\'s.', 'in feature "disulfide bond"'],
  ['in, selected, all', 'A saved selection, by its name; the selection now; every designed cell.', 'in "Core" and not in "Surface"'],
  ['and, or, not, ( )', 'Logic. Terms side by side are joined by and, as are with, whose and that.', 'missense at 40-80 with se < 0.2'],
];

// --- Parsing -------------------------------------------------------------------------------------

export function tokenizeQuery(text) {
  const tokens = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    const start = index;
    if (char === '(' || char === ')') {
      tokens.push({ type: char, value: char, start, end: index + 1 });
      index += 1;
      continue;
    }
    if (char === '&' || char === '|') {
      const doubled = text[index + 1] === char ? 2 : 1;
      tokens.push({ type: 'op', value: char === '&' ? 'and' : 'or', start, end: index + doubled });
      index += doubled;
      continue;
    }
    const comparison = text.slice(index).match(/^(<=|>=|==|!=|<|>|=|≤|≥|≠)/);
    if (comparison) {
      const value = { '==': '=', '≤': '<=', '≥': '>=', '≠': '!=' }[comparison[1]] ?? comparison[1];
      tokens.push({ type: 'cmp', value, start, end: index + comparison[1].length });
      index += comparison[1].length;
      continue;
    }
    if (char === '!') {
      tokens.push({ type: 'op', value: 'not', start, end: index + 1 });
      index += 1;
      continue;
    }
    if (char === '"' || char === '“' || char === '”') {
      const close = text.slice(index + 1).search(/["“”]/);
      if (close < 0) throw new QueryError('Unclosed quote.', index);
      tokens.push({ type: 'word', value: text.slice(index + 1, index + 1 + close), quoted: true, start, end: index + close + 2 });
      index += close + 2;
      continue;
    }
    let end = index;
    while (end < text.length && !/[\s()<>=!&|≤≥≠"“”]/.test(text[end])) end += 1;
    tokens.push({ type: 'word', value: text.slice(index, end), start, end });
    index = end;
  }
  return tokens;
}

export function parseQuery(text) {
  const source = String(text ?? '').trim();
  if (!source) throw new QueryError('The query is empty.', 0);
  const tokens = tokenizeQuery(source);
  let position = 0;
  const peek = () => tokens[position];
  const next = () => tokens[position++];
  const lower = (token) => (token?.type === 'word' && !token.quoted ? token.value.toLowerCase() : null);
  const isWord = (token, ...values) => values.includes(lower(token));
  const at = (token) => token?.start ?? source.length;
  const isOr = (token) => isWord(token, 'or') || (token?.type === 'op' && token.value === 'or');

  function parseOr() {
    let left = parseAnd();
    while (isOr(peek())) {
      next();
      left = { type: 'or', left, right: parseAnd() };
    }
    return left;
  }

  function parseAnd() {
    let left = parseNot();
    for (;;) {
      const token = peek();
      if (!token || token.type === ')' || isOr(token)) break;
      if (AND_WORDS.has(lower(token)) || (token.type === 'op' && token.value === 'and')) next();
      left = { type: 'and', left, right: parseNot() };
    }
    return left;
  }

  function parseNot() {
    const token = peek();
    if (isWord(token, 'not') || (token?.type === 'op' && token.value === 'not')) {
      next();
      return { type: 'not', operand: parseNot() };
    }
    return parsePrimary();
  }

  function numberAfter(word) {
    const operator = next();
    if (operator?.type !== 'cmp') throw new QueryError(`"${word}" needs a comparison, for example "${word} ${word === 'se' ? '< 0.2' : word === 'q' ? '< 0.05' : word === 'replicates' ? '>= 2' : word === 'input' ? '>= 50' : '< -1'}".`, at(operator));
    const valueToken = next();
    const value = Number(valueToken?.value);
    if (valueToken?.type !== 'word' || !Number.isFinite(value)) throw new QueryError(`"${word} ${operator.value}" needs a number.`, at(valueToken));
    return { operator: operator.value, value };
  }

  // "depends on the pseudocount": the choice's words, after an optional "on" and "the".
  function choiceAfter(scope, token) {
    const keyword = next();
    if (!isWord(keyword, 'depends', 'depend')) throw new QueryError(`"${token.value}" is followed by "depends on", for example "${scope} depends on the pseudocount".`, at(keyword));
    if (isWord(peek(), 'on')) next();
    if (isWord(peek(), 'the', 'a')) next();
    const what = next();
    const ids = CHOICE_WORDS[lower(what)];
    if (!ids) throw new QueryError(`"depends on" names a choice: ${Object.keys(CHOICE_WORDS).filter((w, i, all) => all.findIndex((x) => CHOICE_WORDS[x] === CHOICE_WORDS[w]) === i).join(', ')}.`, at(what));
    return { type: 'depends', scope, choices: ids, word: lower(what) };
  }

  function parsePrimary() {
    const token = next();
    if (!token) throw new QueryError('The query ends too early.', source.length);
    if (token.type === '(') {
      const inner = parseOr();
      const close = next();
      if (close?.type !== ')') throw new QueryError('Missing ")".', at(close));
      return inner;
    }
    if (token.type !== 'word' || token.quoted) throw new QueryError(`Unexpected "${token.value}".`, token.start);
    const word = token.value.toLowerCase();
    if (FILLER_WORDS.has(word)) return { type: 'all' };
    if (word === 'all' || word === 'everything') return { type: 'all' };
    if (word === 'selected' || word === 'selection') return { type: 'selected' };
    if (KIND_WORDS[word]) return { type: 'kind', name: KIND_WORDS[word] };
    if (STATE_WORDS[word]) return { type: 'state', name: STATE_WORDS[word] };
    if (CLASS_WORDS[word]) return { type: 'class', name: CLASS_WORDS[word] };
    if (word === 'class' || word === 'size') return choiceAfter(word, token);
    if (word === 'depends' || word === 'depend') {
      position -= 1;
      return choiceAfter('any', token);
    }
    if (VERDICT_WORDS[word]) return { type: 'verdict', name: VERDICT_WORDS[word] };
    if (NUMERIC_WORDS[word]) return { type: 'compare', key: NUMERIC_WORDS[word], ...numberAfter(NUMERIC_WORDS[word]) };
    if (POSITION_WORDS[word]) {
      const key = POSITION_WORDS[word];
      if (peek()?.type === 'cmp') return { type: 'compare', key, ...numberAfter(word) };
      const valueToken = next();
      if (valueToken?.type !== 'word') throw new QueryError(`"${word}" needs positions, for example "${word} 40-80".`, at(valueToken));
      return { type: 'positions', key, ranges: parseRanges(valueToken) };
    }
    if (word === 'from' || word === 'to') {
      const valueToken = next();
      if (valueToken?.type !== 'word') throw new QueryError(`"${word}" needs residues, for example "${word} ${word === 'from' ? 'C' : 'P'}" or "${word} aromatic".`, at(valueToken));
      return { type: 'residue', which: word === 'from' ? 'ref' : 'alt', residues: parseResidues(valueToken) };
    }
    if (word === 'feature' || word === 'features') return featureAfter(token);
    if (word === 'in' || word === 'set') {
      if (isWord(peek(), 'feature', 'features')) return featureAfter(next());
      if (word === 'in' && isWord(peek(), 'set')) next();
      const name = next();
      if (name?.type !== 'word') throw new QueryError(`"${word}" names a saved selection, for example ${word} "Core".`, at(name));
      return { type: 'set', name: name.value, start: name.start };
    }
    throw new QueryError(`Unknown word "${token.value}". Try missense, at 40-80, se < 0.2, from C, lower, fragile, feature, in "a saved selection", and, or, not.`, token.start);
  }

  function featureAfter(token) {
    const valueToken = next();
    if (valueToken?.type !== 'word') throw new QueryError(`"${token.value}" needs a feature's name or type, for example feature "disulfide bond".`, at(valueToken));
    return { type: 'feature', pattern: valueToken.value, start: valueToken.start };
  }

  const ast = parseOr();
  if (position < tokens.length) throw new QueryError(`Unexpected "${tokens[position].value}".`, tokens[position].start);
  return ast;
}

// Positions: "40-80", "40–80", "40..80", "95", lists with "," or "+".
function parseRanges(token) {
  const items = token.value.split(/[,+]/).map((x) => x.trim()).filter(Boolean);
  if (!items.length) throw new QueryError('Positions are missing.', token.start);
  return items.map((item) => {
    const m = item.match(/^(-?\d+)(?:\s*(?:-|–|—|:|\.\.)\s*(-?\d+))?$/);
    if (!m) throw new QueryError(`"${item}" is not a position or a range of them.`, token.start);
    const a = Number(m[1]);
    const b = m[2] === undefined ? a : Number(m[2]);
    return [Math.min(a, b), Math.max(a, b)];
  });
}

// Residues: one letter, three letters (Cys, Ter), or a group; lists with "," or "+".
function parseResidues(token) {
  const items = token.value.split(/[,+]/).map((x) => x.trim()).filter(Boolean);
  let set = '';
  for (const item of items) {
    const word = item.toLowerCase();
    if (GROUPS[word]) set += GROUPS[word];
    else if (THREE[word]) set += THREE[word];
    else if (item.length === 1 && CODES.includes(item.toUpperCase())) set += item.toUpperCase();
    else throw new QueryError(`"${item}" is not a residue: give one letter (C), three (Cys), or a group (${Object.keys(GROUPS).join(', ')}).`, token.start);
  }
  return [...new Set(set)].join('');
}

// --- Evaluation ----------------------------------------------------------------------------------

// What a query is evaluated against, for a map model: { model, results (the map's: a nucleotide
// run's protein view), own (the run's results, whose rows the robustness summary has), design,
// robustness (the run's summary, or null: not checked), features ([{ type, label, start, end }],
// or null: no features track), sets ([{ name, keys }]), selected ([keys]) }. The calls (each
// variant's class) are made here, from the map's results.
export function queryContext({ model, results, own = null, design = {}, robustness = null, features = null, sets = [], selected = [] }) {
  const targetId = model.contrast ? `contrast:${model.contrast.id ?? model.contrast.name}` : `condition:${model.condition.id}`;
  let calls;
  return {
    model,
    results,
    own: own ?? results,
    design,
    targetId,
    get calls() {
      if (calls === undefined) {
        try {
          calls = callsOf(results, design).find((t) => t.id === targetId) ?? null;
        } catch {
          calls = null;
        }
      }
      return calls;
    },
    robustness: robustness?.targets?.find((t) => t.id === targetId) ?? null,
    robustnessChecked: Boolean(robustness),
    features,
    sets,
    selected,
  };
}

// The cells a query selects: { mask (Uint8Array over the model's cells), keys (in order along the
// target, then by amino acid), count }.
export function evaluateQuery(ast, context) {
  const mask = evaluateNode(ast, context, cellData(context));
  return { mask, keys: keysOf(context.model, mask), count: mask.reduce((a, b) => a + b, 0) };
}

export function selectByQuery(text, context) {
  return { query: String(text).trim(), ...evaluateQuery(parseQuery(text), context) };
}

// The keys of a mask's cells, in order along the target, then by amino acid (the order of
// variants.js), whatever the map's row order.
export function keysOf(model, mask) {
  const R = model.rows.length;
  const rank = Array.from(model.rows, (aa) => CODES.indexOf(aa));
  const rows = Array.from({ length: R }, (_, r) => r).sort((a, b) => rank[a] - rank[b]);
  const keys = [];
  for (let p = 1; p <= model.length; p += 1) {
    for (const r of rows) {
      const k = (p - 1) * R + r;
      if (mask[k]) keys.push(cellName(model, cellAt(model, p, r)));
    }
  }
  return keys;
}

// Each cell's facts, computed once per evaluation.
function cellData(context) {
  const { model, results } = context;
  const N = model.cells.length;
  const R = model.rows.length;
  const c = model.source;
  const measured = STAGE_BY_ID.get('measured').code;
  const designed = new Uint8Array(N);
  const state = new Array(N).fill(null);
  const kind = new Uint8Array(N);
  for (let k = 0; k < N; k += 1) {
    if (model.state[k] === STATE.NOT_DESIGNED) continue;
    designed[k] = 1;
    const i = model.cells[k];
    const p = Math.floor(k / R) + 1;
    const alt = model.rows[k % R];
    const ref = model.protein[p - 1];
    if (i >= 0) kind[k] = results.variants.kind[i];
    else kind[k] = model.reference[k] ? KIND.SYNONYMOUS : alt === '*' ? KIND.NONSENSE : p === 1 && ref === 'M' ? KIND.START_LOST : KIND.MISSENSE;
    if (i < 0 || c.reason[i] === measured) state[k] = 'missing';
    else if (c.reason[i]) state[k] = 'filtered';
    else state[k] = c.flags[i] ? 'low' : 'scored';
  }
  return { N, R, designed, state, kind };
}

function evaluateNode(node, context, data) {
  const { N, designed } = data;
  const out = new Uint8Array(N);
  const each = (test) => {
    for (let k = 0; k < N; k += 1) if (designed[k] && test(k)) out[k] = 1;
    return out;
  };
  const { model } = context;
  const R = data.R;
  const row = (k) => model.cells[k];
  switch (node.type) {
    case 'and': {
      const a = evaluateNode(node.left, context, data);
      const b = evaluateNode(node.right, context, data);
      for (let k = 0; k < N; k += 1) out[k] = a[k] & b[k];
      return out;
    }
    case 'or': {
      const a = evaluateNode(node.left, context, data);
      const b = evaluateNode(node.right, context, data);
      for (let k = 0; k < N; k += 1) out[k] = a[k] | b[k];
      return out;
    }
    case 'not': {
      const a = evaluateNode(node.operand, context, data);
      for (let k = 0; k < N; k += 1) out[k] = designed[k] & (a[k] ^ 1);
      return out;
    }
    case 'all':
      return each(() => true);
    case 'kind': {
      const want = { missense: KIND.MISSENSE, nonsense: KIND.NONSENSE, synonymous: KIND.SYNONYMOUS, 'start-lost': KIND.START_LOST }[node.name];
      return each((k) => data.kind[k] === want);
    }
    case 'state': {
      const s = node.name;
      return each((k) => {
        const x = data.state[k];
        if (s === 'scored') return x === 'scored' || x === 'low';
        if (s === 'confident') return x === 'scored';
        if (s === 'unscored') return x === 'filtered' || x === 'missing';
        return x === s;
      });
    }
    case 'positions': {
      const offset = node.key === 'refpos' ? model.target.offset ?? 0 : 0;
      return each((k) => {
        const p = Math.floor(k / R) + 1 + offset;
        return node.ranges.some(([a, b]) => p >= a && p <= b);
      });
    }
    case 'residue': {
      return each((k) => {
        const p = Math.floor(k / R) + 1;
        const aa = node.which === 'ref' ? model.protein[p - 1] : model.reference[k] ? model.protein[p - 1] : model.rows[k % R];
        return node.residues.includes(aa);
      });
    }
    case 'compare': {
      const value = valueOf(node.key, context, data);
      const test = COMPARE[node.operator];
      return each((k) => {
        const x = value(k);
        return Number.isFinite(x) && test(x, node.value);
      });
    }
    case 'class': {
      const calls = context.calls;
      if (!calls) throw new QueryError('This map\'s variants have no class: their scores have no reference (the wild type, or synonymous variants) to be compared with.', -1);
      const want = { lower: CLASS.LOWER, higher: CLASS.HIGHER, neutral: CLASS.NEUTRAL }[node.name];
      return each((k) => row(k) >= 0 && calls.cls[row(k)] === want);
    }
    case 'verdict':
    case 'depends': {
      const t = robustnessOf(context);
      const members = membersOf(context);
      const verdicts = node.type === 'verdict'
        ? [{ robust: VERDICT.ROBUST, fragile: VERDICT.FRAGILE, uncertain: VERDICT.UNCERTAIN, borderline: VERDICT.BORDERLINE, size: VERDICT.SIZE, inclusion: VERDICT.INCLUSION }[node.name]]
        : { any: [VERDICT.FRAGILE, VERDICT.UNCERTAIN, VERDICT.BORDERLINE, VERDICT.SIZE, VERDICT.INCLUSION], class: [VERDICT.FRAGILE, VERDICT.UNCERTAIN, VERDICT.BORDERLINE], size: [VERDICT.SIZE] }[node.scope];
      const ids = t.dependsOnIds ?? [];
      // A protein variant of a nucleotide run passes when one of its nucleotide variants does.
      return each((k) => row(k) >= 0 && members(row(k)).some((j) => verdicts.includes(t.verdict[j]) && (node.type === 'verdict' || (ids[j] ?? []).some((id) => node.choices.includes(id)))));
    }
    case 'feature': {
      const features = context.features;
      if (!features?.length) throw new QueryError('There are no features beside this map: add UniProt\'s features (Map, Tracks, Add a track) or a GFF3 file of them.', node.start, 'features');
      const matching = features.filter(featureMatcher(node.pattern));
      if (!matching.length) {
        const names = [...new Set(features.map((f) => f.label))];
        throw new QueryError(`No feature is named "${node.pattern}". Beside this map: ${names.slice(0, 12).join(', ')}${names.length > 12 ? ', …' : ''}.`, node.start);
      }
      const covered = new Uint8Array(model.length + 1);
      for (const f of matching) for (let p = Math.max(1, f.start); p <= Math.min(model.length, f.end); p += 1) covered[p] = 1;
      return each((k) => covered[Math.floor(k / R) + 1] === 1);
    }
    case 'set': {
      const set = (context.sets ?? []).find((s) => s.name.toLowerCase() === node.name.toLowerCase());
      if (!set) {
        const names = (context.sets ?? []).map((s) => `"${s.name}"`);
        throw new QueryError(`There is no saved selection "${node.name}"${names.length ? `: ${names.join(', ')}` : ': save one first (Save as…)'}.`, node.start);
      }
      return byKeys(set.keys, context, data, out);
    }
    case 'selected':
      return byKeys(context.selected ?? [], context, data, out);
    default:
      throw new QueryError(`Cannot evaluate "${node.type}".`);
  }
}

const COMPARE = {
  '<': (x, v) => x < v, '<=': (x, v) => x <= v, '>': (x, v) => x > v, '>=': (x, v) => x >= v, '=': (x, v) => x === v, '!=': (x, v) => x !== v,
};

// A cell's number for "score", "se", "q", "replicates", "input", "pos", "refpos" (NaN: none).
function valueOf(key, context, data) {
  const { model, results } = context;
  const c = model.source;
  const R = data.R;
  const scored = (k) => data.state[k] === 'scored' || data.state[k] === 'low';
  if (key === 'pos' || key === 'refpos') {
    const offset = key === 'refpos' ? model.target.offset ?? 0 : 0;
    return (k) => Math.floor(k / R) + 1 + offset;
  }
  if (key === 'score') return (k) => (scored(k) ? c.score[model.cells[k]] : Number.NaN);
  if (key === 'se') return (k) => (scored(k) ? c.se[model.cells[k]] : Number.NaN);
  if (key === 'replicates') return (k) => (scored(k) && c.k ? c.k[model.cells[k]] : Number.NaN);
  if (key === 'q') {
    const calls = context.calls;
    if (!calls) throw new QueryError('"q" is the q of a variant\'s class, and this map\'s variants have none: their scores have no reference to be compared with.');
    return (k) => (model.cells[k] >= 0 ? calls.q[model.cells[k]] : Number.NaN);
  }
  // The mean input count of the replicates behind the score, as the map colors by it.
  return (k) => {
    const i = model.cells[k];
    if (i < 0) return Number.NaN;
    let sum = 0;
    let n = 0;
    for (const rep of results.replicates ?? []) {
      if (!c.replicates?.includes(rep.id) || rep.state[i] !== 0) continue;
      sum += rep.first[i];
      n += 1;
    }
    return n ? sum / n : Number.NaN;
  };
}

function robustnessOf(context) {
  if (!context.robustnessChecked) throw new QueryError('Verdicts need the run\'s robustness checked first (Score, Check robustness).', -1, 'robustness');
  if (!context.robustness) throw new QueryError('The robustness check has no verdicts for what this map shows.', -1);
  return context.robustness;
}

// The run's own rows behind a row of the map's results (a protein variant's nucleotide variants).
function membersOf(context) {
  const { results, own } = context;
  if (own === results || !results.variants.members) return (i) => [i];
  return (i) => Array.from(results.variants.members[i]);
}

function featureMatcher(pattern) {
  const text = pattern.toLowerCase();
  if (/[*?]/.test(text)) {
    const re = new RegExp(`^${text.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i');
    return (f) => re.test(f.label ?? '') || re.test(f.type ?? '');
  }
  return (f) => String(f.label ?? '').toLowerCase().includes(text) || String(f.type ?? '').toLowerCase().includes(text);
}

function byKeys(keys, context, data, out) {
  const want = new Set(keys);
  const { model } = context;
  for (let k = 0; k < data.N; k += 1) {
    if (!data.designed[k]) continue;
    const p = Math.floor(k / data.R) + 1;
    if (want.has(cellName(model, cellAt(model, p, k % data.R)))) out[k] = 1;
  }
  return out;
}

// The features of a run's tracks, for queryContext: [{ type, label, start, end, track }].
export function featuresOf(tracks) {
  const out = [];
  for (const t of tracks ?? []) if (t.kind === 'features') for (const f of t.features ?? []) out.push({ type: f.type, label: f.label ?? f.type, start: f.start, end: f.end, track: t.label });
  return out.length ? out : null;
}

// Whether a query uses a kind of term ('feature', 'verdict', 'set', …).
export function queryUses(ast, type) {
  if (!ast) return false;
  if (ast.type === type || (type === 'verdict' && ast.type === 'depends')) return true;
  return queryUses(ast.left, type) || queryUses(ast.right, type) || queryUses(ast.operand, type);
}

// A selection changed by another: 'replace', 'add', 'intersect' or 'subtract'. Keys of the result,
// those of the current selection first.
export const OPERATIONS = ['replace', 'add', 'intersect', 'subtract'];
export function combineKeys(current, keys, operation = 'replace') {
  if (operation === 'replace') return [...keys];
  const set = new Set(keys);
  if (operation === 'add') return [...new Set([...current, ...keys])];
  if (operation === 'intersect') return current.filter((k) => set.has(k));
  if (operation === 'subtract') return current.filter((k) => !set.has(k));
  throw new QueryError(`"${operation}" is not an operation: ${OPERATIONS.join(', ')}.`);
}

// The selection { keys, query } that an operation makes of the current one ({ keys, query } or
// null) and another: its query too, when both have one (so that it can be made again), else null.
export function combineSelections(current, other, operation = 'replace') {
  const keys = combineKeys(current?.keys ?? [], other.keys, operation);
  if (operation === 'replace') return { keys, query: other.query ?? null };
  if (!current?.keys?.length) return { keys, query: operation === 'add' ? other.query ?? null : null };
  if (!current.query || !other.query) return { keys, query: null };
  const join = { add: 'or', intersect: 'and', subtract: 'and not' }[operation];
  return { keys, query: `(${current.query}) ${join} (${other.query})` };
}
