// A target placed in its UniProt entry (wave 3, slice 1). The entry comes through MaveScape's
// fetcher (fetch.go: GET /api/fetch/uniprot/{accession}, from the listed services only, cached
// with its retrieval record); this module reads it, finds where the target's protein sits in it,
// and writes the record the workspace keeps of the check (target.reference), so that an offset
// says where it came from. A target with no accession can be looked up by its exact sequence
// (UniParc, GET /api/fetch/uniparc), which sends the sequence, so the page asks first.
//
//   readUniProtEntry(json) → { accession, entryName, reviewed, name, gene, organism, sequence } | { problem }
//   placeTarget(target, entry) → { offset, start, end, identical, differences, outside, places } | { problem }
//   placementPatch(target, entry, placement) → the design's target fields the entry changes
//   referenceOf(entry, retrieval, placement) → target.reference
//   uniparcEntries(json) → { uniparc, entries: [{ accession, reviewed, isoform, gene, name, organism }] }
//   retrievalOf, retrievalText (retrieval.js)

import { targetProtein } from './target.js';

export const ACCESSION = /^([OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2})(-[0-9]+)?$/;

// An accession as UniProt writes it, or null.
export function normalizeAccession(text) {
  const accession = String(text ?? '').trim().toUpperCase();
  return ACCESSION.test(accession) ? accession : null;
}

const INACTIVE = { MERGED: 'merged into', DEMERGED: 'split into', DELETED: 'deleted' };

// The parts of a UniProtKB entry (its JSON) a target uses. An inactive accession (merged, split or
// deleted) is a problem naming where it went.
export function readUniProtEntry(json) {
  if (!json || typeof json !== 'object' || !json.primaryAccession) return { problem: 'UniProt sent something that is not an entry.' };
  if (json.entryType === 'Inactive') {
    const reason = json.inactiveReason ?? {};
    const to = reason.mergeDemergeTo ?? [];
    return { accession: json.primaryAccession, replacedBy: to, problem: `${json.primaryAccession} is no longer a UniProt entry: ${INACTIVE[reason.inactiveReasonType] ?? 'withdrawn'}${to.length ? ` ${to.join(' and ')}` : ''}.` };
  }
  const sequence = String(json.sequence?.value ?? '').toUpperCase();
  if (!sequence) return { accession: json.primaryAccession, problem: `UniProt's entry ${json.primaryAccession} came without its sequence.` };
  const description = json.proteinDescription ?? {};
  const gene = json.genes?.[0];
  return {
    accession: json.primaryAccession,
    entryName: json.uniProtkbId ?? null,
    reviewed: /Swiss-Prot/.test(json.entryType ?? ''),
    name: description.recommendedName?.fullName?.value ?? description.submissionNames?.[0]?.fullName?.value ?? null,
    gene: gene?.geneName?.value ?? gene?.orderedLocusNames?.[0]?.value ?? null,
    organism: json.organism?.scientificName ?? null,
    taxonId: json.organism?.taxonId ?? null,
    sequence,
    length: sequence.length,
  };
}

// The most work a placement may take (residues compared); beyond it, the offset is set by hand.
const MAX_WORK = 2e8;

// Where the target's protein (a DNA target's translation) sits in the entry's sequence: the
// ungapped placement where most residues agree, allowing a few residues to hang over either end
// (a tag or a linker of the construct). At least 80% of the target's residues must agree.
// places > 1 when several placements agree as well (a short or repetitive target): then the
// offset is not the entry's to say.
export function placeTarget(target, entry) {
  const protein = targetProtein(target).replace(/\*$/, '');
  const reference = entry.sequence;
  const n = protein.length;
  const m = reference.length;
  if (!n) return { problem: 'The target encodes no protein to place.' };
  let best = -1;
  let offsets = [];
  const exact = reference.indexOf(protein);
  if (exact >= 0) {
    best = n;
    for (let at = exact; at >= 0; at = reference.indexOf(protein, at + 1)) offsets.push(at);
  } else {
    if (n * (n + m) > MAX_WORK) return { problem: `The target (${n} residues) and ${entry.accession} (${m}) are too long to compare here: set the offset by hand.` };
    for (let offset = -(n - 1); offset < m; offset += 1) {
      let same = 0;
      for (let i = Math.max(0, -offset); i < n && offset + i < m; i += 1) if (protein[i] === reference[offset + i]) same += 1;
      if (same > best) {
        best = same;
        offsets = [offset];
      } else if (same === best) offsets.push(offset);
    }
  }
  if (best < 0.8 * n) return { problem: `Wherever the target is placed in ${entry.accession}, fewer than 80% of its residues agree (at most ${best} of ${n}): it is not this protein, or not this isoform.` };
  const offset = offsets[0];
  const differences = [];
  const outside = [];
  for (let i = 0; i < n; i += 1) {
    const at = offset + i;
    if (at < 0 || at >= m) outside.push(i + 1);
    else if (protein[i] !== reference[at]) differences.push({ position: i + 1, target: protein[i], reference: reference[at] });
  }
  return { offset, start: offset + 1, end: offset + n, length: n, matched: best, identical: best === n, differences, outside, places: offsets.length, alternatives: offsets.slice(0, 5).map((o) => o + 1) };
}

// The design's target fields that placing it in the entry sets: the offset, the accession and gene,
// the organism, and the differences found (a note the target already had on one is kept). Fields
// that would not change are left out.
export function placementPatch(target, entry, placement) {
  const patch = {};
  if ((target.offset ?? 0) !== placement.offset) patch.offset = placement.offset;
  const identifiers = { ...(target.identifiers ?? {}), uniprot: entry.accession, ...(entry.gene ? { gene: entry.gene } : {}) };
  if (JSON.stringify(identifiers) !== JSON.stringify(target.identifiers ?? {})) patch.identifiers = identifiers;
  // The species: UniProt names the strain of its reference proteome ("Saccharomyces cerevisiae
  // (strain ATCC 204508 / S288c)"), which need not be the experiment's.
  const species = speciesOf(entry.organism);
  if (species && species !== speciesOf(target.organism)) patch.organism = species;
  const notes = new Map((target.differences ?? []).map((d) => [d.position, d.note]));
  const differences = placement.differences.map((d) => ({ ...d, ...(notes.get(d.position) ? { note: notes.get(d.position) } : {}) }));
  const before = target.differences ?? [];
  if (JSON.stringify(differences) !== JSON.stringify(before)) patch.differences = differences.length ? differences : undefined;
  return patch;
}

export const speciesOf = (organism) => (organism ? String(organism).replace(/\s*\([^)]*\)\s*$/, '').trim() || null : null);

// The record the workspace keeps of a target's check against its entry: which entry and release,
// retrieved when and from where, and where the target sat in it.
export function referenceOf(entry, retrieval, placement) {
  return {
    database: 'UniProtKB',
    accession: entry.accession,
    ...(entry.entryName ? { entryName: entry.entryName } : {}),
    ...(retrieval?.version ? { release: retrieval.version } : {}),
    ...(retrieval?.retrieved ? { retrieved: retrieval.retrieved } : {}),
    ...(retrieval?.source ? { url: retrieval.source } : {}),
    length: entry.length,
    offset: placement.offset,
    start: placement.start,
    end: placement.end,
    identical: placement.identical,
    differences: placement.differences.length,
  };
}

// The UniProtKB entries with exactly a sequence, from UniParc's answer: active ones only, the
// reviewed (Swiss-Prot) first; an isoform's accession only when its entry's is not there already.
export function uniparcEntries(json) {
  const seen = new Set();
  const entries = [];
  const references = json?.uniParcCrossReferences ?? [];
  const isoform = (r) => /isoforms/i.test(r.database ?? '');
  for (const r of [...references.filter((x) => !isoform(x)), ...references.filter(isoform)]) {
    if (!r.active || !/^UniProtKB/.test(r.database ?? '') || !r.id) continue;
    if (seen.has(r.id) || (isoform(r) && seen.has(r.id.replace(/-\d+$/, '')))) continue;
    seen.add(r.id);
    entries.push({ accession: r.id, reviewed: /Swiss-Prot/.test(r.database), isoform: isoform(r), gene: r.geneName ?? null, name: r.proteinName ?? null, organism: r.organism?.scientificName ?? null, taxonId: r.organism?.taxonId ?? null });
  }
  const rank = (e) => (e.reviewed ? (e.isoform ? 1 : 0) : 2);
  return { uniparc: json?.uniParcId ?? null, entries: entries.map((e, i) => [e, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([e]) => e) };
}

export { retrievalOf, retrievalText } from './retrieval.js';
