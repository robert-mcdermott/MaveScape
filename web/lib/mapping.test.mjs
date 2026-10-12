import assert from 'node:assert/strict';
import test from 'node:test';
import { describeMapping, mapTarget, mapTargetOnChain, mappingCSV, rankStructures, stretches } from './mapping.js';
import { openStructureText } from './structures.js';

const THREE = { A: 'ALA', R: 'ARG', N: 'ASN', D: 'ASP', C: 'CYS', Q: 'GLN', E: 'GLU', G: 'GLY', H: 'HIS', I: 'ILE', L: 'LEU', K: 'LYS', M: 'MET', F: 'PHE', P: 'PRO', S: 'SER', T: 'THR', W: 'TRP', Y: 'TYR', V: 'VAL' };
const TARGET = 'MKTAYIAKQRQISFVKSHFSRQLEERLGLIEVQAPILSRVGDGTQDNLSGAEKAVQVKVKALPDAQ';

// A PDB file of CA atoms: chains { id, sequence (SEQRES; omitted: none), observed: [[number, letter]],
// dbref: [authBegin, authEnd, dbBegin, dbEnd, accession], seqadv: [[number, resName, dbResName,
// dbNumber, details]] }.
function pdb(chains) {
  const lines = [];
  for (const c of chains) {
    if (c.sequence) {
      const names = [...c.sequence].map((x) => THREE[x]);
      for (let i = 0; i < names.length; i += 13) lines.push(`SEQRES ${String(i / 13 + 1).padStart(3)} ${c.id} ${String(names.length).padStart(4)}  ${names.slice(i, i + 13).join(' ')}`);
    }
    if (c.dbref) {
      const [ab, ae, db, de, acc] = c.dbref;
      lines.push(`DBREF  1ABC ${c.id} ${String(ab).padStart(4)}  ${String(ae).padStart(4)}  UNP    ${acc.padEnd(8)} ${'XXXX_HUMAN'.padEnd(12)} ${String(db).padStart(5)}  ${String(de).padStart(5)}`);
    }
    for (const [num, resName, dbResName, dbNum, details] of c.seqadv ?? []) {
      lines.push(`SEQADV 1ABC ${resName} ${c.id} ${String(num).padStart(4)}  UNP  ${(c.dbref?.[4] ?? 'P00000').padEnd(9)} ${dbResName} ${String(dbNum).padStart(5)} ${details.toUpperCase()}`);
    }
  }
  let serial = 1;
  for (const c of chains) {
    for (const [num, letter] of c.observed) {
      const x = (num * 3.8).toFixed(3).padStart(8);
      lines.push(`ATOM  ${String(serial).padStart(5)}  CA  ${THREE[letter]} ${c.id}${String(num).padStart(4)}    ${x}   0.000   0.000  1.00 20.00           C`);
      serial += 1;
    }
  }
  lines.push('END');
  return openStructureText(`${lines.join('\n')}\n`, 'test.pdb');
}

const observedFrom = (sequence, first = 1, skip = new Set()) => [...sequence].map((x, i) => [first + i, x]).filter(([n]) => !skip.has(n));

test('a target placed in a longer chain: its positions on residues, the rest outside', () => {
  const s = pdb([{ id: 'A', sequence: TARGET, observed: observedFrom(TARGET), dbref: [1, TARGET.length, 101, 100 + TARGET.length, 'P12345'] }]);
  const target = { sequence: TARGET.slice(10, 40), offset: 110, accession: 'P12345', name: 'Domain' };
  const m = mapTargetOnChain(s, 'A', target);
  assert.equal(m.onStructure, 30);
  assert.equal(m.counts.identical, 30);
  assert.equal(m.positions[0].residue, 'A:11:GLN');
  assert.equal(m.positions[0].reference, 111);
  assert.deepEqual(m.record, { accession: 'P12345', compared: 30, agree: 30, differ: [] });
  // The other way round: a long target, a short chain.
  const short = pdb([{ id: 'B', sequence: TARGET.slice(20, 50), observed: observedFrom(TARGET.slice(20, 50), 5) }]);
  const n = mapTargetOnChain(short, 'B', { sequence: TARGET, offset: 0, name: 'Whole' });
  assert.equal(n.onStructure, 30);
  assert.deepEqual(stretches(n.positions.filter((p) => p.state === 'outside').map((p) => p.position)), ['1–20', '51–66']);
  assert.equal(n.positions[20].residue, 'B:5:ARG');
});

test('unobserved, deleted and different positions, with the entry\'s reason', () => {
  // The chain's sequence lacks target residues 31–35 (a loop removed), residues 13–15 have no
  // coordinates, and 20 is an engineered mutation (S → W).
  const sequence = TARGET.slice(0, 30) + TARGET.slice(35);
  const mutated = `${sequence.slice(0, 19)}W${sequence.slice(20)}`;
  const s = pdb([{ id: 'A', sequence: mutated, observed: observedFrom(mutated, 1, new Set([13, 14, 15])), seqadv: [[20, 'TRP', 'SER', 20, 'engineered mutation']] }]);
  const m = mapTargetOnChain(s, 'A', { sequence: TARGET, offset: 0, name: 'T' });
  const of = (state) => m.positions.filter((p) => p.state === state).map((p) => p.position);
  assert.deepEqual(of('unobserved'), [13, 14, 15]);
  assert.deepEqual(of('deleted'), [31, 32, 33, 34, 35]);
  assert.deepEqual(of('different'), [20]);
  assert.equal(m.positions[19].reason, 'engineered mutation');
  assert.equal(m.positions[19].structureCode, 'W');
  assert.equal(m.counts.outside, 0);
  const words = describeMapping(m, '1ABC').join(' ');
  assert.match(words, /Another residue at 1 position: S20W \(engineered mutation\)/);
  assert.match(words, /not observed: 13–15/);
  assert.match(words, /Missing from the structure's sequence: 31–35/);
});

test('a chain without its sequence: a break in the numbering is unobserved residues', () => {
  const s = pdb([{ id: 'A', observed: observedFrom(TARGET, 1, new Set([25, 26, 27])) }]);
  const m = mapTargetOnChain(s, 'A', { sequence: TARGET, offset: 0, name: 'T' });
  assert.deepEqual(m.positions.filter((p) => p.state === 'unobserved').map((p) => p.position), [25, 26, 27]);
  assert.equal(m.counts.identical, TARGET.length - 3);
});

test('a gap that could slide along identical residues makes its neighbors ambiguous', () => {
  // The target has KKKK where the chain has KKK: which K is missing cannot be told.
  const target = 'MSTAYIDGEKKKKLPWQRHSFEV';
  const chain = 'MSTAYIDGEKKKLPWQRHSFEV';
  const s = pdb([{ id: 'A', sequence: chain, observed: observedFrom(chain) }]);
  const m = mapTargetOnChain(s, 'A', { sequence: target, offset: 0, name: 'T' });
  assert.equal(m.counts.deleted, 1);
  assert.deepEqual(m.positions.filter((p) => p.ambiguous).map((p) => p.position), [10, 11, 12, 13]);
  // Where the neighbors differ, the gap has one place.
  const plain = pdb([{ id: 'A', sequence: 'MSTAYIDGEKLPWQRHSFEV', observed: observedFrom('MSTAYIDGEKLPWQRHSFEV') }]);
  assert.equal(mapTargetOnChain(plain, 'A', { sequence: 'MSTAYIDGEKWLPWQRHSFEV', offset: 0, name: 'T' }).counts.ambiguous, 0);
});

test('the entry\'s own record compared residue by residue, and the shift said', () => {
  const s = pdb([{ id: 'A', sequence: TARGET, observed: observedFrom(TARGET), dbref: [1, TARGET.length, 96, 95 + TARGET.length, 'P12345'] }]);
  const m = mapTargetOnChain(s, 'A', { sequence: TARGET, offset: 100, accession: 'P12345', name: 'T' });
  assert.equal(m.record.compared, TARGET.length);
  assert.equal(m.record.differ.length, TARGET.length);
  assert.match(describeMapping(m, '1ABC').at(-1), /differs at 66 positions of 66: it numbers them 5 earlier than the alignment does/);
  // A record of another protein is not compared.
  const other = mapTargetOnChain(s, 'A', { sequence: TARGET, offset: 100, accession: 'Q99999', name: 'T' });
  assert.equal(other.record.compared, 0);
});

test('every chain that holds the target, the most of it first; a chain of another protein left out', () => {
  const unrelated = 'GPLGSWWEEHHRRDDNNQQCCPPGGTTSSWW';
  const s = pdb([
    { id: 'A', sequence: TARGET.slice(0, 40), observed: observedFrom(TARGET.slice(0, 40)) },
    { id: 'B', sequence: unrelated, observed: observedFrom(unrelated) },
    { id: 'C', sequence: TARGET, observed: observedFrom(TARGET) },
  ]);
  const maps = mapTarget(s, { sequence: TARGET, offset: 0, name: 'T' });
  assert.deepEqual(maps.map((m) => m.chain), ['C', 'A']);
});

test('the mapping as a table, one row per position', () => {
  const s = pdb([{ id: 'A', sequence: TARGET, observed: observedFrom(TARGET, 1, new Set([3])) }]);
  const m = mapTargetOnChain(s, 'A', { sequence: TARGET.slice(0, 5), offset: 10, name: 'T' });
  const rows = mappingCSV(m, '1ABC').trim().split('\n');
  assert.equal(rows[0], 'target_position,reference_position,target_residue,structure,chain,residue_number,insertion_code,structure_residue,state,ambiguous,entry_record_position,difference');
  assert.equal(rows[1], '1,11,Met,1ABC,A,1,,Met,identical,,,');
  assert.equal(rows[3], '3,13,Thr,1ABC,A,,,Thr,unobserved,,,');
  assert.equal(rows.length, 6);
});

test('structures ranked for the target: the most of it covered, then the resolution', () => {
  const answer = {
    P12345: [
      { pdb_id: '1aaa', chain_id: 'A', experimental_method: 'X-ray diffraction', resolution: 2.5, unp_start: 1, unp_end: 300 },
      { pdb_id: '2bbb', chain_id: 'B', experimental_method: 'X-ray diffraction', resolution: 1.5, unp_start: 120, unp_end: 180 },
      { pdb_id: '3ccc', chain_id: 'A', experimental_method: 'Solution NMR', resolution: null, unp_start: 100, unp_end: 200 },
      { pdb_id: '4ddd', chain_id: 'A', experimental_method: 'X-ray diffraction', resolution: 1.8, unp_start: 100, unp_end: 200 },
      { pdb_id: '4ddd', chain_id: 'C', experimental_method: 'X-ray diffraction', resolution: 1.8, unp_start: 100, unp_end: 200 },
      { pdb_id: '5eee', chain_id: 'A', experimental_method: 'X-ray diffraction', resolution: 1.0, unp_start: 400, unp_end: 500 },
    ],
  };
  const rows = rankStructures(answer, { accession: 'P12345', offset: 110, length: 80 });
  // 1AAA and 4DDD cover all of it: 4DDD's resolution is the better.
  assert.deepEqual(rows.map((r) => r.id), ['4DDD', '1AAA', '3CCC', '2BBB']);
  assert.deepEqual([rows[0].from, rows[0].to, rows[0].covered], [1, 80, 80]);
  assert.deepEqual(rows[0].chains.map((c) => c.id), ['A', 'C']);
  assert.deepEqual([rows[3].from, rows[3].to], [10, 70]);
  assert.deepEqual(rankStructures({}, { accession: 'P12345', offset: 0, length: 10 }), []);
});
