// The target mapped onto a structure (wave 5, slice 2; requirement X2). The target's protein is
// aligned to each chain's sequence (the entry's own, SEQRES, where it gives one, with the residues
// observed marked; otherwise the residues observed, a break in their numbering kept as unknown
// residues) by Proteoscope's overlap alignment (structure/align.js: BLOSUM62, affine gaps, free end
// gaps), so a structure numbered its own way (chymotrypsin's, a construct's) or covering part of the
// target maps all the same. Each target position is then:
//   identical    on a residue with coordinates, the same amino acid;
//   different    on a residue with coordinates, another amino acid (with the entry's reason when it
//                records one: an engineered mutation, a conflict, a variant…);
//   unobserved   in the entry's sequence, without coordinates;
//   deleted      inside the stretch the chain holds, but not in its sequence (a loop removed);
//   outside      before or after the stretch the chain holds.
// A position is ambiguous when an alignment as good places it otherwise: a gap that could slide
// along residues that score the same. The entry's own record of the UniProt residues each chain covers is
// compared, residue by residue, with the alignment. Structures that cover a UniProt entry are
// ranked from PDBe's SIFTS (best_structures). Pure.

import { alignSequences, blosum62 } from './structure/align.js';

export const STATES = ['identical', 'different', 'unobserved', 'deleted', 'outside'];
export const STATE_WORDS = {
  identical: 'on the structure, identical',
  different: 'on the structure, another residue',
  unobserved: 'in the structure\'s sequence, not observed',
  deleted: 'missing from the structure\'s sequence',
  outside: 'outside the stretch the structure holds',
};

const baseAccession = (accession) => String(accession ?? '').toUpperCase().split('-')[0];

// A chain's sequence as the alignment reads it: one item per residue of the entry's sequence (with
// its residue when observed), a break in the numbering of a chain without one as unknown residues.
export function chainItems(structure, chainId) {
  const info = structure.sequences.get(chainId);
  if (!info || info.kind !== 'protein') return [];
  const items = [];
  for (const item of info.items) {
    if (item.gap) {
      for (let k = 0; k < Math.min(item.gap, 1000); k += 1) items.push({ code: 'X', residue: null, unknown: true });
    } else items.push({ code: item.code || 'X', residue: item.residue ?? null });
  }
  return items;
}

// Where an alignment as good would place a position otherwise: each gap slid along residues that
// score the same (BLOSUM62) on either side. pairs: [targetIndex, itemIndex], in order.
function ambiguousPositions(pairs, target, items) {
  const out = new Set();
  const score = (i, j) => blosum62(target[i], items[j].code);
  for (let k = 0; k + 1 < pairs.length; k += 1) {
    const [i0, j0] = pairs[k];
    const [i1, j1] = pairs[k + 1];
    if (i1 - i0 > 1) {
      // Target residues i0+1 … i1-1 have no partner (missing from the structure's sequence): the
      // gap slides left when i1-1-s would pair with j0-s as well as i0-s does, right when i0+1+s
      // would pair with j1+s as well as i1+s does.
      for (let s = 0; i0 - s >= 0 && j0 - s >= 0 && i1 - 1 - s > i0 - s && score(i0 - s, j0 - s) === score(i1 - 1 - s, j0 - s); s += 1) {
        out.add(i0 - s);
        out.add(i1 - 1 - s);
      }
      for (let s = 0; i1 + s < target.length && j1 + s < items.length && i0 + 1 + s < i1 + s && score(i1 + s, j1 + s) === score(i0 + 1 + s, j1 + s); s += 1) {
        out.add(i0 + 1 + s);
        out.add(i1 + s);
      }
    }
    if (j1 - j0 > 1) {
      // Structure residues j0+1 … j1-1 have no partner: i0 could pair with j1-1, or i1 with j0+1.
      if (score(i0, j0) === score(i0, j1 - 1)) out.add(i0);
      if (score(i1, j1) === score(i1, j0 + 1)) out.add(i1);
    }
  }
  return out;
}

// The UniProt position the entry records for a residue (struct_ref_seq read on its own sequence's
// numbering, DBREF on the authors'), when the record names `accession` (any, when none is given):
// { position, accession }, or null.
export function recordedPosition(structure, residue, accession) {
  const want = baseAccession(accession);
  for (const segment of structure.sequences.get(residue.chain)?.uniprot ?? []) {
    if (want && baseAccession(segment.accession) !== want) continue;
    const label = Number(residue.labelSeq);
    if (Number.isFinite(segment.labelBegin) && Number.isFinite(label) && segment.labelBegin > 0) {
      if (label >= segment.labelBegin && label <= segment.labelEnd) return { position: segment.dbBegin + (label - segment.labelBegin), accession: segment.accession };
      continue;
    }
    if (!residue.iCode && residue.resSeq >= segment.authBegin && residue.resSeq <= segment.authEnd) return { position: segment.dbBegin + (residue.resSeq - segment.authBegin), accession: segment.accession };
  }
  return null;
}

// The entry's own record of a residue's difference from the database sequence (struct_ref_seq_dif,
// SEQADV), when it has one.
function differenceOf(structure, residue) {
  for (const d of structure.sequenceDifferences ?? []) {
    if (d.chain !== residue.chain) continue;
    if (d.label != null && residue.labelSeq != null && Number(residue.labelSeq) === d.label) return d;
    if (d.label == null && d.auth === residue.resSeq && (d.iCode || '') === (residue.iCode || '')) return d;
  }
  return null;
}

// target: { sequence (protein, one letter), offset, accession, name }. Returns the mapping of the
// target onto one chain, or null when the chain holds no protein.
export function mapTargetOnChain(structure, chainId, target) {
  const items = chainItems(structure, chainId);
  if (!items.length) return null;
  const sequence = String(target.sequence ?? '').toUpperCase();
  const alignment = alignSequences(sequence, items.map((x) => x.code).join(''));
  const partner = new Int32Array(sequence.length).fill(-1);
  for (const [i, j] of alignment.pairs) partner[i] = j;
  const first = alignment.pairs[0]?.[0] ?? -1;
  const last = alignment.pairs.at(-1)?.[0] ?? -1;
  const ambiguous = ambiguousPositions(alignment.pairs, sequence, items);
  const offset = target.offset ?? 0;
  const positions = [];
  const residuePosition = new Map();
  let recordAccession = '';
  for (let i = 0; i < sequence.length; i += 1) {
    const j = partner[i];
    const item = j >= 0 ? items[j] : null;
    const residue = item?.residue ?? null;
    let state;
    if (residue) state = residue.code === sequence[i] ? 'identical' : 'different';
    else if (item) state = 'unobserved';
    else state = i > first && i < last ? 'deleted' : 'outside';
    const entry = { position: i + 1, reference: i + 1 + offset, code: sequence[i], state, residue: residue?.key ?? null, structureCode: item && !item.unknown ? item.code : null };
    if (ambiguous.has(i) && state !== 'outside') entry.ambiguous = true;
    if (residue) {
      residuePosition.set(residue.key, i + 1);
      const recorded = recordedPosition(structure, residue, target.accession);
      if (recorded != null) {
        entry.recorded = recorded.position;
        recordAccession ||= recorded.accession;
      }
      const difference = differenceOf(structure, residue);
      if (difference && state === 'different') entry.reason = difference.details;
    }
    positions.push(entry);
  }
  const counts = Object.fromEntries(STATES.map((s) => [s, 0]));
  for (const p of positions) counts[p.state] += 1;
  counts.ambiguous = positions.filter((p) => p.ambiguous).length;
  const onStructure = counts.identical + counts.different;
  const aligned = alignment.pairs.length;
  const recorded = positions.filter((p) => p.recorded != null);
  return {
    chain: chainId,
    target: { name: target.name ?? '', length: sequence.length, offset, accession: target.accession ?? '' },
    positions,
    counts,
    onStructure,
    coverage: sequence.length ? onStructure / sequence.length : 0,
    identity: aligned ? alignment.identical / aligned : 0,
    aligned,
    score: alignment.score,
    residuePosition,
    record: { accession: recordAccession, compared: recorded.length, agree: recorded.filter((p) => p.recorded === p.reference).length, differ: recorded.filter((p) => p.recorded !== p.reference).map((p) => p.position) },
  };
}

// The target mapped onto every protein chain that holds it (at least half of the residues aligned
// identical, and 5 of them), the best first: the most target positions on residues, then the
// most identical, then the chain's order.
export function mapTarget(structure, target) {
  const maps = [];
  for (const chain of structure.chains.filter((c) => c.polymerKind === 'protein')) {
    const m = mapTargetOnChain(structure, chain.id, target);
    if (!m || m.aligned === 0) continue;
    const identical = m.counts.identical;
    if (identical < Math.min(5, m.target.length) || m.identity < 0.5) continue;
    maps.push(m);
  }
  return maps.sort((a, b) => b.onStructure - a.onStructure || b.counts.identical - a.counts.identical);
}

// Positions as stretches in words: "1–6, 9, 12–14", each with its reference numbers when the
// target has an offset ("1–6 (159–164)").
export function stretches(positions, offset = 0) {
  const sorted = [...new Set(positions)].sort((a, b) => a - b);
  const runs = [];
  for (const p of sorted) {
    const run = runs.at(-1);
    if (run && p === run[1] + 1) run[1] = p;
    else runs.push([p, p]);
  }
  const span = ([a, b]) => (a === b ? `${a}` : `${a}–${b}`);
  return runs.map(([a, b]) => (offset ? `${span([a, b])} (${span([a + offset, b + offset])})` : span([a, b])));
}

const plural = (n, word, many = `${word}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? word : many}`;
const ONE_TO_THREE = { A: 'Ala', R: 'Arg', N: 'Asn', D: 'Asp', C: 'Cys', Q: 'Gln', E: 'Glu', G: 'Gly', H: 'His', I: 'Ile', L: 'Leu', K: 'Lys', M: 'Met', F: 'Phe', P: 'Pro', S: 'Ser', T: 'Thr', W: 'Trp', Y: 'Tyr', V: 'Val', U: 'Sec', X: 'Xaa' };

// The mapping in words, for the view, remote control and the methods.
export function describeMapping(mapping, structureName = 'the structure') {
  const { target, counts, positions } = mapping;
  const offset = target.offset;
  const of = (state) => positions.filter((p) => p.state === state).map((p) => p.position);
  const lines = [];
  const on = positions.filter((p) => p.residue);
  const range = (a, b) => (a === b ? `${a}` : `${a}–${b}`);
  const span = on.length ? `positions ${range(on[0].position, on.at(-1).position)}${offset ? ` (${range(on[0].reference, on.at(-1).reference)})` : ''}` : 'no position';
  lines.push(`${target.name || 'The target'} (${plural(target.length, 'position')}) on chain ${mapping.chain} of ${structureName}: ${plural(mapping.onStructure, 'position')} on residues with coordinates (${span}), ${counts.identical === mapping.onStructure ? 'all identical' : `${counts.identical.toLocaleString('en-US')} identical`}; ${(100 * mapping.identity).toFixed(0)}% identity over the ${plural(mapping.aligned, 'position')} aligned.`);
  const different = positions.filter((p) => p.state === 'different');
  if (different.length) lines.push(`Another residue at ${plural(different.length, 'position')}: ${different.slice(0, 12).map((p) => `${p.code}${p.position}${p.structureCode}${p.reason ? ` (${p.reason})` : ''}`).join(', ')}${different.length > 12 ? ', …' : ''}.`);
  if (counts.unobserved) lines.push(`In the structure's sequence but not observed: ${stretches(of('unobserved'), offset).join(', ')}.`);
  if (counts.deleted) lines.push(`Missing from the structure's sequence: ${stretches(of('deleted'), offset).join(', ')}.`);
  if (counts.outside) lines.push(`Outside the stretch the structure holds: ${stretches(of('outside'), offset).join(', ')}.`);
  if (counts.ambiguous) lines.push(`Ambiguous: ${stretches(positions.filter((p) => p.ambiguous).map((p) => p.position), offset).join(', ')}, where an alignment as good places them otherwise.`);
  const { record } = mapping;
  if (record.compared) {
    const named = record.accession ? ` (UniProt ${record.accession})` : '';
    if (!record.differ.length) lines.push(`The entry's own record of the UniProt residues the chain covers${named} agrees at all ${plural(record.compared, 'position')}.`);
    else {
      const shifts = new Map();
      for (const p of positions.filter((x) => record.differ.includes(x.position))) shifts.set(p.recorded - p.reference, (shifts.get(p.recorded - p.reference) ?? 0) + 1);
      const [shift] = [...shifts].sort((a, b) => b[1] - a[1])[0];
      lines.push(`The entry's own record of the UniProt residues the chain covers${named} differs at ${plural(record.differ.length, 'position')} of ${record.compared}: it numbers ${record.differ.length === record.compared ? 'them' : 'most of them'} ${Math.abs(shift)} ${shift > 0 ? 'later' : 'earlier'} than the alignment does.`);
    }
  }
  return lines;
}

// A residue's name with its target position: "Cys 182 · A, target position 24".
export function mappedLabel(mapping, residueKey) {
  const position = mapping?.residuePosition.get(residueKey);
  if (!position) return '';
  const p = mapping.positions[position - 1];
  return mapping.target.offset ? `target position ${position} (reference ${p.reference})` : `target position ${position}`;
}

// The mapping as a table: one row per target position.
export function mappingCSV(mapping, structureName) {
  const rows = ['target_position,reference_position,target_residue,structure,chain,residue_number,insertion_code,structure_residue,state,ambiguous,entry_record_position,difference'];
  for (const p of mapping.positions) {
    const [chain, number, resName] = p.residue ? p.residue.split(':') : ['', '', ''];
    const num = /^(-?\d+)([A-Za-z]?)$/.exec(number ?? '') ?? [];
    const csv = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replaceAll('"', '""')}"` : String(v));
    const named = resName ? resName[0] + resName.slice(1).toLowerCase() : p.structureCode ? ONE_TO_THREE[p.structureCode] ?? '' : '';
    rows.push([p.position, p.reference, ONE_TO_THREE[p.code] ?? p.code, structureName, p.residue ? chain : mapping.chain, num[1] ?? '', num[2] ?? '', named, p.state, p.ambiguous ? 'yes' : '', p.recorded ?? '', p.reason ?? ''].map(csv).join(','));
  }
  return `${rows.join('\n')}\n`;
}

// --- Structures that cover the target -----------------------------------------------------------

// PDBe's best_structures answer for a UniProt entry → its entries ranked for the target: the target
// positions each covers (from SIFTS's span, intersected with the target's place in the entry), the
// most first, then the best resolution (structures without one last), then PDBe's order. One row
// per entry, with its chains.
export function rankStructures(answer, target) {
  const accession = baseAccession(target.accession);
  const list = Object.entries(answer ?? {}).find(([key]) => baseAccession(key) === accession)?.[1] ?? [];
  const first = (target.offset ?? 0) + 1;
  const lastRef = (target.offset ?? 0) + target.length;
  const byEntry = new Map();
  list.forEach((s, order) => {
    const from = Math.max(first, s.unp_start);
    const to = Math.min(lastRef, s.unp_end);
    const covered = Math.max(0, to - from + 1);
    const id = String(s.pdb_id).toUpperCase();
    const row = byEntry.get(id);
    const chain = { id: s.chain_id, from: covered ? from - (target.offset ?? 0) : null, to: covered ? to - (target.offset ?? 0) : null, covered };
    if (!row) byEntry.set(id, { id, method: s.experimental_method ?? '', resolution: Number.isFinite(s.resolution) ? s.resolution : null, chains: [chain], covered, from: chain.from, to: chain.to, order, unp: [s.unp_start, s.unp_end] });
    else {
      row.chains.push(chain);
      if (covered > row.covered) Object.assign(row, { covered, from: chain.from, to: chain.to, unp: [s.unp_start, s.unp_end] });
    }
  });
  const rows = [...byEntry.values()].filter((r) => r.covered > 0);
  for (const r of rows) {
    r.coverage = r.covered / target.length;
    r.chains.sort((a, b) => b.covered - a.covered || a.id.localeCompare(b.id));
  }
  return rows.sort((a, b) => b.covered - a.covered || (a.resolution ?? Infinity) - (b.resolution ?? Infinity) || a.order - b.order);
}
