// The validation suite `consequences` (wave 3, slice 3): MaveScape's protein change of each
// nucleotide variant (web/lib/consequence.js) against biocommons hgvs's (reference/consequences.json,
// generate_consequences.py), on the transcripts the reference used, read from MaveScape's cached
// answers (the RefSeq records with web/lib/genbank.js, the Ensembl transcript from its capitals).
//
// biocommons writes HGVS; MaveScape MAVE-HGVS, which has fewer forms. What each of biocommons'
// becomes (consequence.js says why):
//   p.(Ala2Ser) → p.Ala2Ser (a predicted change's parentheses dropped);
//   p.(Gly5AlafsTer12), p.(Gly5AlafsTer?) → p.Gly5fs;
//   p.(Ter7LysextTer12) → p.Ter7Lys, a lost stop;
//   p.Met1? → start lost, unnamed but for a substitution;
//   p.(Ter7Ter) → p.Ter7=;
//   p.? → no protein change (a UTR, an intron, a splice site);
//   p.(Gly5_Pro7delinsAlaValThr), as long as what it replaces → the substitutions it holds,
//     p.[Gly5Ala;Pro7Thr] (one alone: p.Gly5Ala), up to a stop it makes;
//   residues an insertion holds after its stop are not named: p.(Lys1171delinsGluTerGlu) →
//     p.Lys1171delinsGluTer.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { codingFrame, consequenceOf } from '../web/lib/consequence.js';
import { formatHgvs, parseHgvs, ONE_TO_THREE } from '../web/lib/hgvs.js';
import { parseGenBank, codingFeatures, featureSequence, targetFromGenBank } from '../web/lib/genbank.js';
import { buildVariants, KIND } from '../web/lib/variants.js';
import { proteinView } from '../web/lib/collapse.js';
import { columnText } from '../web/lib/csv.js';

const sha256Hex = (text) => createHash('sha256').update(text).digest('hex');

const fixture = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

// A transcript as the reference read it: { target, frame }.
export function transcriptOf(entry) {
  if (entry.source.endsWith('.gb')) {
    const { records } = parseGenBank(fixture(entry.source));
    const coding = codingFeatures(records[0]);
    return targetFromGenBank(records[0], coding[0]).target;
  }
  const seq = JSON.parse(fixture(entry.source)).seq;
  const first = seq.search(/[A-Z]/);
  return { id: 't', name: entry.transcript, sequenceType: 'dna', sequence: seq.toUpperCase(), codingStart: first + 1 };
}

const aas = (text) => (text.match(/[A-Z][a-z]{2}/g) ?? []);

// biocommons' p. name as MaveScape writes it: { protein } or { protein: null, classes }.
export function expected(p, protein) {
  if (p === 'p.?') return { protein: null, classes: ['5\' UTR', '3\' UTR', 'intronic', 'splice site', 'start lost'] };
  if (p === 'p.Met1?') return { protein: undefined, classes: ['start lost'] };
  let s = p.replace(/^p\.\((.*)\)$/, 'p.$1');
  let m = /^p\.([A-Z][a-z]{2}\d+)[A-Z][a-z]{2}fs/.exec(s);
  if (m) return { protein: `p.${m[1]}fs` };
  m = /^p\.Ter(\d+)([A-Z][a-z]{2})ext/.exec(s);
  if (m) return { protein: `p.Ter${m[1]}${m[2]}` };
  m = /^p\.Ter(\d+)Ter$/.exec(s);
  if (m) return { protein: `p.Ter${m[1]}=` };
  m = /^p\.([A-Z][a-z]{2})(\d+)(?:_([A-Z][a-z]{2})(\d+))?delins((?:[A-Z][a-z]{2})+)$/.exec(s);
  if (m) {
    const start = Number(m[2]);
    const end = m[4] ? Number(m[4]) : start;
    const inserted = aas(m[5]);
    if (inserted.length === end - start + 1) {
      const subs = [];
      for (let k = start; k <= end; k += 1) {
        const ref = ONE_TO_THREE[protein[k - 1]];
        if (ref !== inserted[k - start]) subs.push(`${ref}${k}${inserted[k - start]}`);
        if (inserted[k - start] === 'Ter') break;
      }
      return { protein: subs.length === 1 ? `p.${subs[0]}` : `p.[${subs.join(';')}]` };
    }
  }
  m = /^(p\..*(?:ins|delins))((?:[A-Z][a-z]{2})+)$/.exec(s);
  if (m && aas(m[2]).indexOf('Ter') >= 0) s = m[1] + aas(m[2]).slice(0, aas(m[2]).indexOf('Ter') + 1).join('');
  return { protein: s };
}

// Every variant of the reference: { compared, agree, disagree: [{ transcript, c, theirs, ours }] }.
export function compareConsequences(reference) {
  const out = { compared: 0, agree: 0, disagree: [], byForm: {} };
  for (const entry of reference.transcripts) {
    const target = transcriptOf(entry);
    const frame = codingFrame(target);
    for (const [c, theirs] of entry.variants) {
      if (theirs === null) continue;
      const parsed = parseHgvs(c, { mode: 'lenient' });
      const ours = parsed.ok ? consequenceOf(parsed, frame) : { problem: parsed.error };
      const want = expected(theirs, frame.protein);
      out.compared += 1;
      const ok = !ours.problem && (want.protein === undefined || ours.protein === want.protein) && (!want.classes || want.classes.includes(ours.class));
      const form = theirs === 'p.?' ? 'none' : theirs.includes('Met1?') ? 'start' : /fs/.test(theirs) ? 'frameshift' : /ext/.test(theirs) ? 'stop lost' : /=\)?$/.test(theirs) ? 'synonymous' : /delins/.test(theirs) ? 'delins' : /dup/.test(theirs) ? 'dup' : /del/.test(theirs) ? 'del' : /ins/.test(theirs) ? 'ins' : /Ter\)$/.test(theirs) ? 'nonsense' : 'missense';
      out.byForm[form] = (out.byForm[form] ?? 0) + 1;
      if (ok) out.agree += 1;
      else out.disagree.push({ transcript: entry.transcript, c, theirs, ours: ours.problem ?? `${ours.protein} (${ours.class})` });
    }
  }
  return out;
}

// --- GenBank, against Biopython (reference/genbank.json, generate_genbank.py) -----------------------

// Each record's fields, each feature's location parts, each coding feature's bases, translation
// and the check against the record's own: [{ record, field, ours, theirs }] where they differ.
export function compareGenBank(reference) {
  const differ = [];
  let features = 0;
  let coding = 0;
  for (const ref of reference.records) {
    const { records, problems } = parseGenBank(fixture(ref.file));
    const r = records[0];
    const field = (name, ours, theirs) => {
      if (JSON.stringify(ours) !== JSON.stringify(theirs)) differ.push({ record: ref.version, field: name, ours, theirs });
    };
    if (problems.length || !r) {
      differ.push({ record: ref.version, field: 'read', ours: problems.join(' '), theirs: 'read' });
      continue;
    }
    field('length', r.sequence.length, ref.length);
    field('molecule', r.molecule, ref.molecule);
    field('topology', r.topology, ref.topology);
    field('version', r.version, ref.version);
    field('organism', r.organism, ref.organism);
    field('definition', r.definition, ref.definition.replace(/\.$/, ''));
    field('sequence', sha256Hex(r.sequence), ref.sha256);
    field('features', r.features.map((f) => f.type), ref.features.map((f) => f.type));
    const ours = codingFeatures(r);
    let k = 0;
    r.features.forEach((f, i) => {
      const theirs = ref.features[i];
      if (!theirs) return;
      features += 1;
      field(`${f.type} ${f.location} parts`, (f.parts ?? []).map((p) => [p.start, p.end, p.strand]), theirs.parts);
      if (f.type !== 'CDS') return;
      coding += 1;
      const c = ours[k];
      k += 1;
      const bases = featureSequence(r, f);
      field(`${f.location} bases`, sha256Hex(bases), theirs.sha256);
      field(`${f.location} translation`, c.protein, theirs.translation);
      field(`${f.location} check`, c.check.status, theirs.given && theirs.translation.replace(/\*$/, '') === theirs.given ? 'identical' : 'differs');
    });
  }
  return { records: reference.records.length, features, coding, differ };
}

// --- DiMSum's merge (reference/dimsum-aggregate.json, generate_dimsum_aggregate.R) -----------------

// CBS's low-B6 codon variants given the fitness and sigma DiMSum was given, read at the protein
// level by MaveScape (collapse.js): each amino-acid variant DiMSum merges against MaveScape's,
// fitness and sigma by their relative difference; DiMSum's synonymous rows (kept apart) each
// one of the nucleotide variants of MaveScape's synonymous codon. Returns { merged, unscored (no
// fitness on either side), worst, missing, extra, synonymous, misplaced }.
export function compareDimsumAggregate(reference, table, target) {
  const names = ['c.=', ...columnText(table.columns.find((c) => c.name === 'hgvs_nt'))];
  const input = [1000, ...table.columns.find((c) => c.name === 'nonselect1').numeric];
  const output = [1000, ...table.columns.find((c) => c.name === 'select1').numeric];
  const variants = buildVariants(names, { level: 'nucleotide', target });
  const n = names.length;
  const score = Float64Array.from(input, (x, i) => Math.log((output[i] + 0.5) / (x + 0.5)));
  const se = Float64Array.from(input, (x, i) => Math.sqrt(1 / (output[i] + 0.5) + 1 / (x + 0.5)));
  const zeros = () => new Uint8Array(n);
  const results = {
    rows: n,
    variants,
    controls: { wt: 0 },
    replicates: [],
    samples: [],
    conditions: [{ id: 'c', name: 'c', replicates: [], score, se, k: zeros().fill(1), expected: zeros().fill(1), reason: zeros(), flags: zeros(), tau2: score.map(() => Number.NaN), i2: score.map(() => Number.NaN), loo: score.map(() => Number.NaN) }],
  };
  const view = proteinView(results);
  const c = view.conditions[0];
  const index = new Map(view.variants.key.map((k, i) => [k, i]));
  const name = (changes) => {
    const parts = [].concat(changes).map((x) => { const m = /^(.)(\d+)(.)$/.exec(x); return `${ONE_TO_THREE[m[1]]}${m[2]}${ONE_TO_THREE[m[3]]}`; });
    return parts.length === 1 ? `p.${parts[0]}` : `p.[${parts.join(';')}]`;
  };
  const rel = (a, b) => (a === b ? 0 : Math.abs(a - b) / Math.max(Math.abs(b), 1e-300));
  let worst = 0;
  let merged = 0;
  let unscored = 0;
  const missing = [];
  const seen = new Set();
  let synonymous = 0;
  const misplaced = [];
  for (const row of reference.rows) {
    if (row.nham_aa > 0) {
      const key = name(row.changes);
      const i = index.get(key);
      if (i === undefined) {
        missing.push(key);
        continue;
      }
      seen.add(key);
      merged += 1;
      // No fitness on either side: none of its variants was counted (NA in the table).
      if (row.fitness === null || !Number.isFinite(c.score[i])) {
        if (row.fitness !== null || Number.isFinite(c.score[i])) missing.push(`${key} (fitness ${row.fitness} and ${c.score[i]})`);
        else unscored += 1;
        continue;
      }
      worst = Math.max(worst, rel(c.score[i], row.fitness), rel(c.se[i], row.sigma));
    } else if ([].concat(row.bases).length) {
      // A synonymous variant: one of its codon's members in MaveScape's view, its own score kept.
      synonymous += 1;
      const changed = [].concat(row.bases).map((b) => /^(\d+)([ACGT])>([ACGT])$/.exec(b));
      const first = Number(changed[0][1]);
      const codon = Math.ceil(first / 3);
      const key = `p.${ONE_TO_THREE[codingFrame(target).protein[codon - 1]]}${codon}=`;
      const i = index.get(key);
      const rows = i === undefined ? [] : Array.from(view.variants.members[i]);
      const own = rows.find((r) => (row.fitness === null ? !Number.isFinite(score[r]) : Math.abs(score[r] - row.fitness) <= 1e-12 * Math.max(1, Math.abs(row.fitness))));
      if (own === undefined) misplaced.push(`${[].concat(row.bases).join(';')} (not in ${key})`);
    }
  }
  const extra = view.variants.key.filter((k, i) => k !== 'p.=' && view.variants.kind[i] !== KIND.SYNONYMOUS && !seen.has(k));
  return { merged, unscored, worst, missing, extra, synonymous, misplaced, view };
}

// --- Published protein names --------------------------------------------------------------------

// The protein a name describes: its amino-acid changes up to and including the first stop (those
// after it are not made), and the positions it names as unchanged. A name prefixed by its protein's
// accession (ENSP00000269305.4:p.…) is read without it.
function proteinOf(name) {
  const p = parseHgvs(String(name).replace(/^[^:]+:(?=p\.)/, ''), { mode: 'lenient' });
  if (!p.ok) return null;
  const changes = [];
  const same = new Set();
  const sorted = p.components.slice().sort((a, b) => (a.start?.position ?? 0) - (b.start?.position ?? 0));
  for (const c of sorted) {
    if (c.type === 'equal' || (c.type === 'sub' && c.ref === c.alt)) {
      if (c.start) same.add(c.start.position);
      continue;
    }
    changes.push(formatHgvs({ prefix: 'p', components: [c] }));
    if (c.type === 'sub' && c.alt === 'Ter') break;
  }
  return { changes: changes.join('|'), same: [...same].sort((a, b) => a - b).join(',') };
}

// Whether MaveScape's protein change (and class) describes the protein a published name does: the
// same changes up to a stop; for a change of no amino acid, the same codons named unchanged (or
// either names none); a change at the start codon (start lost, which MaveScape names only as a
// substitution) where the published name changes Met1.
export function sameProtein(published, ours, cls) {
  const theirs = proteinOf(published);
  if (!theirs) return false;
  if (cls === 'start lost' && !ours) return /^Met1/.test(theirs.changes.replace(/^p\./, ''));
  const mine = ours ? proteinOf(ours) : null;
  if (!mine) return false;
  if (theirs.changes !== mine.changes) return false;
  return Boolean(theirs.changes) || theirs.same === mine.same || !theirs.same || !mine.same;
}
