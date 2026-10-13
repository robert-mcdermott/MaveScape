// Control sets, apart from web/lib/controls.js (wave 8, slice 1): ClinVar's controls of a gene read
// straight from NCBI's answers as the fetcher cached them (fixtures/public-data/clinvar/*.summary.json),
// with a reader of their own (not providers/clinvar.js, not tracks.js): the title's transcript and
// protein change, the germline classification, the review status as ClinVar's stars, the kind, the
// residue checked on the target, one label per change (merged on one side, left out on both). The
// suite `controls` (run.mjs) compares the module's sets with these.

import { readdirSync, readFileSync } from 'node:fs';
import { targetProtein } from '../web/lib/target.js';

const CLINVAR = new URL('./fixtures/public-data/clinvar/', import.meta.url);
const THREE = { Ala: 'A', Arg: 'R', Asn: 'N', Asp: 'D', Cys: 'C', Gln: 'Q', Glu: 'E', Gly: 'G', His: 'H', Ile: 'I', Leu: 'L', Lys: 'K', Met: 'M', Phe: 'F', Pro: 'P', Ser: 'S', Thr: 'T', Trp: 'W', Tyr: 'Y', Val: 'V' };
// ClinVar's review status as stars (ClinVar's "Review status in ClinVar" page).
const STARS = new Map([
  ['practice guideline', 4], ['reviewed by expert panel', 3], ['criteria provided, multiple submitters, no conflicts', 2],
  ['criteria provided, single submitter', 1], ['criteria provided, conflicting classifications', 1], ['criteria provided, conflicting interpretations', 1],
]);

// Every record of a gene in the cached answers: { accession, transcript, ref, position, alt (one
// letter; '*' a stop; ref for '='), classification, review, evaluated }, or null for a title that
// is no single protein substitution.
export function clinvarRecords(gene) {
  const out = [];
  for (const file of readdirSync(CLINVAR).filter((f) => f.endsWith('.summary.json'))) {
    const result = JSON.parse(readFileSync(new URL(file, CLINVAR), 'utf8')).result;
    for (const uid of result.uids) {
      const r = result[uid];
      const m = /^(N[MR]_\d+\.\d+)\(([^)]+)\):c\.\S+(?: \(p\.([A-Z][a-z]{2})(\d+)([A-Z][a-z]{2}|=)\))?$/.exec(r.title ?? '');
      if (!m || m[2] !== gene) continue;
      const g = r.germline_classification ?? {};
      const date = /^\d{4}\/\d{2}\/\d{2}/.test(g.last_evaluated ?? '') ? g.last_evaluated.slice(0, 10).replaceAll('/', '-') : null;
      if (!m[3]) {
        out.push({ accession: r.accession, transcript: m[1], single: false });
        continue;
      }
      const ref = THREE[m[3]];
      const alt = m[5] === '=' ? ref : m[5] === 'Ter' ? '*' : THREE[m[5]];
      out.push({ accession: r.accession, transcript: m[1], single: Boolean(ref && alt), ref, position: Number(m[4]), alt, classification: String(g.description ?? ''), review: String(g.review_status ?? '').toLowerCase(), evaluated: date });
    }
  }
  return out;
}

// The controls those records make on a target: the most named transcript; P for pathogenic or likely
// pathogenic (alone, or as "Pathogenic/Likely pathogenic"), B for benign or likely benign; at least
// minStars; of the kinds given; the residue the target's at position − offset. Returns a Map(key →
// { side, ids, stars, evaluated, kind }), keys as MAVE-HGVS on the target (p.Arg3Cys).
export function clinvarAccount(gene, target, { minStars = 1, kinds = ['missense'] } = {}) {
  const records = clinvarRecords(gene);
  const tally = new Map();
  for (const r of records) tally.set(r.transcript, (tally.get(r.transcript) ?? 0) + 1);
  const transcript = [...tally].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
  const protein = targetProtein(target);
  const name = { ...Object.fromEntries(Object.entries(THREE).map(([k, v]) => [v, k])), '*': 'Ter' };
  const out = new Map();
  const both = new Set();
  for (const r of records) {
    if (r.transcript !== transcript || !r.single) continue;
    const at = r.position - (target.offset ?? 0);
    if (at < 1 || at > protein.replace(/\*$/, '').length || protein[at - 1] !== r.ref) continue;
    const c = r.classification.toLowerCase();
    const side = /^(pathogenic|likely pathogenic|pathogenic\/likely pathogenic)(,|;|$)/.test(c) || /^(likely )?pathogenic, low penetrance$/.test(c) ? 'P'
      : /^(benign|likely benign|benign\/likely benign)(,|;|$)/.test(c) ? 'B' : null;
    if (!side) continue;
    const stars = STARS.get(r.review) ?? 0;
    const kind = r.alt === r.ref ? 'synonymous' : r.alt === '*' ? 'nonsense' : 'missense';
    if (stars < minStars || !kinds.includes(kind)) continue;
    const key = `p.${name[r.ref]}${at}${r.alt === r.ref ? '=' : name[r.alt]}`;
    const had = out.get(key);
    if (!had) out.set(key, { side, ids: [r.accession], stars, evaluated: r.evaluated, kind });
    else if (had.side !== side) both.add(key);
    else {
      had.ids.push(r.accession);
      had.stars = Math.max(had.stars, stars);
      if (r.evaluated && (!had.evaluated || r.evaluated > had.evaluated)) had.evaluated = r.evaluated;
    }
  }
  for (const key of both) out.delete(key);
  return { transcript, controls: out, records: records.length };
}
