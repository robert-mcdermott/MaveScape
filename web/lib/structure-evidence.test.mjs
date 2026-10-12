import assert from 'node:assert/strict';
import test from 'node:test';
import { accessibilityInput, bhAdjust, chosenPartners, clusterTest, compactGroups, DSSP_RADII, effectsByClass, evidenceCSV, mannWhitney, MAX_ASA, partnerDistances, partnersOf, relative, structureEvidence, structureTracks } from './structure-evidence.js';

// A model of atoms: [chain, resSeq, resName, atom name, element, kind, x, y, z]; residues keyed
// "chain:resSeq:resName".
function model(atoms) {
  const out = { atoms: [], residues: [], residueMap: new Map() };
  for (const [chain, resSeq, resName, name, element, kind, x, y, z] of atoms) {
    const key = `${chain}:${resSeq}:${resName}`;
    let residue = out.residueMap.get(key);
    if (!residue) {
      residue = { key, chain, resSeq, resName, parent: resName, kind, atoms: [], dssp: '' };
      out.residueMap.set(key, residue);
      out.residues.push(residue);
    }
    const atom = { id: out.atoms.length, chain, resSeq, resName, name, element, kind, x, y, z, residueKey: key, isHydrogen: element === 'H' };
    residue.atoms.push(atom);
    out.atoms.push(atom);
  }
  return out;
}

test('accessibility is computed as DSSP computes it: protein heavy atoms, its radii, grouped by chain; relative to Tien et al.\'s maxima', () => {
  const m = model([
    ['A', 1, 'GLY', 'N', 'N', 'protein', 0, 0, 0], ['A', 1, 'GLY', 'CA', 'C', 'protein', 1.5, 0, 0], ['A', 1, 'GLY', 'H', 'H', 'protein', 0, 1, 0],
    ['A', 2, 'SER', 'OG', 'O', 'protein', 3, 1, 0], ['B', 1, 'ALA', 'O', 'O', 'protein', 9, 0, 0], ['A', 101, 'HOH', 'O', 'O', 'water', 5, 5, 5],
  ]);
  const input = accessibilityInput(m);
  assert.deepEqual([...input.radii], [DSSP_RADII.N, DSSP_RADII.CA, 1.8, DSSP_RADII.O].map(Math.fround));
  assert.deepEqual([...input.groups], [0, 0, 0, 1]);
  assert.deepEqual(input.residues, ['A:1:GLY', 'A:1:GLY', 'A:2:SER', 'B:1:ALA']);
  assert.equal(relative(64.5, 'ALA'), 0.5);
  assert.equal(MAX_ASA.TRP, 285);
  assert.ok(Number.isNaN(relative(10, 'HOH')));
});

test('partners: other chains, ligands and ions; common additives left out unless chosen; the nearest heavy atom of each residue', () => {
  const m = model([
    ['A', 1, 'ALA', 'CA', 'C', 'protein', 0, 0, 0], ['A', 2, 'ALA', 'CA', 'C', 'protein', 10, 0, 0],
    ['B', 1, 'GLY', 'CA', 'C', 'protein', 0, 3, 0], ['A', 401, 'SO4', 'S', 'S', 'ligand', 10, 3.5, 0],
    ['A', 402, 'ZN', 'ZN', 'ZN', 'ion', 30, 0, 0], ['A', 501, 'HOH', 'O', 'O', 'water', 0, 1, 0],
  ]);
  const structure = { chains: [{ id: 'B', description: 'PARTNER PROTEIN' }] };
  const partners = partnersOf(m, structure, 'A');
  assert.deepEqual(partners.map((p) => [p.id, p.additive]), [['chain:B', false], ['ligand:A:401:SO4', true], ['ligand:A:402:ZN', false]]);
  assert.equal(partners[0].label, 'chain B · Partner protein');
  const all = chosenPartners(partners);
  assert.deepEqual(all.map((p) => p.id), ['chain:B', 'ligand:A:402:ZN']);
  const d = partnerDistances(m, 'A', all);
  assert.deepEqual([d.get('A:1:ALA').distance, d.get('A:1:ALA').partner], [3, 'chain:B']);
  assert.equal(d.get('A:2:ALA').partner, 'chain:B');
  assert.ok(Math.abs(d.get('A:2:ALA').distance - Math.hypot(10, 3)) < 1e-12);
  const sulfate = partnerDistances(m, 'A', chosenPartners(partners, 'ligand:A:401:SO4'));
  assert.equal(sulfate.get('A:2:ALA').distance, 3.5);
});

// A mapping of positions 1..n onto residues A:1..n (n given), every one identical.
function line(n, code = 'A') {
  const atoms = [];
  for (let i = 1; i <= n; i += 1) atoms.push(['A', i, 'ALA', 'CA', 'C', 'protein', 3.8 * i, 0, 0], ['A', i, 'ALA', 'CB', 'C', 'protein', 3.8 * i, 1.5, 0]);
  const m = model(atoms);
  const positions = Array.from({ length: n }, (_, i) => ({ position: i + 1, reference: i + 101, code, state: 'identical', residue: `A:${i + 1}:ALA` }));
  return { m, mapping: { chain: 'A', target: { name: 'T', length: n, offset: 100 }, positions } };
}

test('each position\'s class: disordered, interface, buried or exposed; nothing for a position on no residue', () => {
  const { m, mapping } = line(5);
  mapping.positions[4] = { ...mapping.positions[4], residue: null, state: 'unobserved' };
  const accessibility = new Map([['A:1:ALA', { alone: 10, complex: 5 }], ['A:2:ALA', { alone: 100, complex: 100 }], ['A:3:ALA', { alone: 100, complex: 20 }], ['A:4:ALA', { alone: 100, complex: 100 }]]);
  const exposure = new Map([['A:4:ALA', { ppse: 3, idr: true }]]);
  const distances = new Map([['A:3:ALA', { distance: 3.2, partner: 'chain:B' }], ['A:2:ALA', { distance: 6, partner: 'chain:B' }]]);
  const ev = structureEvidence({ model: m, mapping, accessibility, exposure, distances, predicted: true });
  assert.deepEqual(ev.positions.map((p) => p.class), ['buried', 'exposed', 'interface', 'disordered', null]);
  assert.ok(Math.abs(ev.positions[0].rsa - 10 / 129) < 1e-12);
  assert.equal(ev.positions[2].interface, true);
  assert.equal(ev.positions[1].interface, false);
  // An experimental structure has no disordered class: the region read is a prediction's.
  assert.equal(structureEvidence({ model: m, mapping, accessibility, exposure, distances, predicted: false }).positions[3].class, 'exposed');
});

test('the tracks beside a map: features of the classes (with their colors) and secondary structure, values of the rest; placed by reference numbering, another protein refused', () => {
  const { m, mapping } = line(4);
  m.residues[0].dssp = 'H';
  m.residues[1].dssp = 'H';
  m.residues[3].dssp = 'E';
  const accessibility = new Map(m.residues.map((r, i) => [r.key, { alone: i < 2 ? 5 : 100, complex: 5 }]));
  const ev = structureEvidence({ model: m, mapping, accessibility, exposure: new Map(), distances: new Map(), predicted: false });
  // The map's target begins one residue earlier (offset 99): position 1 is its 2.
  const tracks = structureTracks(ev, { length: 6, offset: 99, protein: 'MAAAAG' }, { structure: '1ABC', source: { service: 'PDB 1ABC' } });
  const byId = Object.fromEntries(tracks.map((t) => [t.id, t]));
  assert.deepEqual(tracks.map((t) => t.id), ['structure:class', 'structure:ss', 'structure:rsa', 'structure:ppse', 'structure:distance']);
  assert.deepEqual(byId['structure:class'].features.map((f) => [f.label, f.start, f.end, Boolean(f.fill)]), [['buried', 2, 3, true], ['exposed', 4, 5, true]]);
  assert.deepEqual(byId['structure:ss'].features.map((f) => [f.type, f.label, f.start, f.end]), [['Helix', 'helix', 2, 3], ['Beta strand', 'strand', 5, 5]]);
  assert.ok(Number.isNaN(byId['structure:rsa'].values[0]));
  assert.equal(byId['structure:rsa'].values[1], 5 / 129);
  assert.deepEqual(structureTracks(ev, { length: 4, offset: 100, protein: 'WWWW' }, { structure: '1ABC' }), []);
});

test('Mann–Whitney\'s test, two-sided, with the corrections for ties and continuity; Benjamini–Hochberg', () => {
  const r = mannWhitney([1, 2, 3], [4, 5, 6]);
  assert.equal(r.u, 0);
  assert.equal(r.below, 1);
  assert.ok(Math.abs(r.p - 0.0808556) < 1e-6, String(r.p));
  const tied = mannWhitney([1, 1, 2], [1, 2, 2]);
  assert.equal(tied.u, 3);
  assert.equal(tied.below, 2 / 3);
  assert.ok(Number.isNaN(mannWhitney([], [1]).p));
  const q = bhAdjust([0.01, 0.04, 0.03, Number.NaN]);
  assert.deepEqual(q.slice(0, 3).map((x) => +x.toFixed(10)), [0.03, 0.04, 0.04]);
  assert.ok(Number.isNaN(q[3]));
});

test('the scores by class: each class\'s positions and median, and its test against the rest', () => {
  const { m, mapping } = line(12);
  const accessibility = new Map(m.residues.map((r, i) => [r.key, { alone: i < 6 ? 5 : 100, complex: 5 }]));
  const ev = structureEvidence({ model: m, mapping, accessibility, exposure: new Map(), distances: new Map(), predicted: false });
  const value = (q) => (q <= 6 ? -2 - q / 10 : 0.5 + q / 10);
  const effects = effectsByClass(ev, value);
  const buried = effects.classes.find((c) => c.id === 'buried');
  assert.deepEqual([buried.n, +buried.median.toFixed(2)], [6, -2.35]);
  assert.equal(buried.test.below, 1);
  assert.ok(buried.test.q < 0.01);
  assert.deepEqual(effects.classes.map((c) => c.id), ['buried', 'exposed']);
});

// Positions on a 6 × 6 grid of 5 Å (Cβ), half buried: { ev, valueAt } with the least tolerant at
// the given positions.
function grid(lowAt) {
  const atoms = [];
  for (let i = 0; i < 36; i += 1) atoms.push(['A', i + 1, 'ALA', 'CA', 'C', 'protein', 5 * (i % 6), 5 * Math.floor(i / 6), 0], ['A', i + 1, 'ALA', 'CB', 'C', 'protein', 5 * (i % 6), 5 * Math.floor(i / 6), 1]);
  const m = model(atoms);
  const positions = Array.from({ length: 36 }, (_, i) => ({ position: i + 1, reference: i + 1, code: 'A', state: 'identical', residue: `A:${i + 1}:ALA` }));
  const accessibility = new Map(m.residues.map((r, i) => [r.key, { alone: (i % 2 ? 0.1 : 0.6) * 129, complex: 1 }]));
  const ev = structureEvidence({ model: m, mapping: { chain: 'A', target: { name: 'T', length: 36, offset: 0 }, positions }, accessibility, exposure: new Map(), distances: new Map(), predicted: false });
  const low = new Set(lowAt);
  return { ev, valueAt: (q) => (low.has(q) ? -3 - q / 100 : q / 100) };
}

test('the cluster test: the least tolerant together beyond their burial, against seeded draws within strata; compact groups', () => {
  // A 3 × 3 block of the grid, buried and exposed alike.
  const block = [1, 2, 3, 7, 8, 9, 13, 14, 15];
  const { ev, valueAt } = grid(block);
  const t = clusterTest(ev, valueAt, { fraction: 0.25, permutations: 400, seed: 3, strata: 2 });
  assert.deepEqual(t.sensitive, block);
  assert.equal(t.observed, 20, 'the block\'s pairs within 8 Å: 12 sides and 8 diagonals');
  assert.ok(t.p < 0.01 && t.ratio > 2);
  assert.deepEqual(clusterTest(ev, valueAt, { fraction: 0.25, permutations: 400, seed: 3, strata: 2 }).expected, t.expected, 'seeded: the same draws');
  // Its corners are 14.1 Å apart, beyond 12 Å: complete linkage makes groups within the block.
  assert.ok(t.clusters.length >= 1 && t.clusters.every((g) => g.length >= 3 && g.every((q) => block.includes(q))));
  // Spread over the grid, they are not.
  const spread = grid([1, 6, 16, 21, 26, 31, 34, 11, 36]);
  assert.ok(clusterTest(spread.ev, spread.valueAt, { fraction: 0.25, permutations: 400, seed: 3, strata: 2 }).p > 0.2);
  assert.equal(clusterTest(grid([]).ev, () => Number.NaN), null);
});

test('compact groups by complete linkage: every two within the diameter', () => {
  const at = (position, x) => ({ position, cb: [x, 0, 0] });
  // A chain of positions 5 Å apart: single linkage would join them all; complete linkage within
  // 12 Å makes groups of at most three.
  const groups = compactGroups([at(1, 0), at(2, 5), at(3, 10), at(4, 15), at(5, 20), at(6, 25), at(7, 60)], 12);
  assert.ok(groups.every((g) => g.length <= 3));
  assert.equal(groups.flat().includes(7), false, 'a position alone is in no group');
});

test('the evidence as a table, one row per position', () => {
  const { m, mapping } = line(2);
  m.residues[0].dssp = 'H';
  const ev = structureEvidence({ model: m, mapping, accessibility: new Map([['A:1:ALA', { alone: 12.9, complex: 6.45 }]]), exposure: new Map([['A:1:ALA', { ppse: 12, idr: false }]]), distances: new Map([['A:1:ALA', { distance: 3.25, partner: 'chain:B' }]]), interactions: new Map([['A:1:ALA', [{ type: 'hydrogen-bond', label: 'Hydrogen bond', with: 'GLY 5 · B' }]]]), predicted: false });
  const rows = evidenceCSV(ev, '1ABC', (q) => (q === 1 ? -1.5 : Number.NaN), 'median_score').trim().split('\n');
  assert.equal(rows[0], 'target_position,reference_position,target_residue,structure,chain,residue_number,insertion_code,secondary_structure,accessible_area,relative_accessibility,relative_accessibility_in_structure,ppse,disordered,plddt,partner_distance,partner,interface,interactions,structural_class,median_score');
  assert.equal(rows[1], '1,101,Ala,1ABC,A,1,,H,12.9,0.1,0.05,12,,,3.25,chain:B,yes,Hydrogen bond GLY 5 · B,interface,-1.5');
  assert.equal(rows.length, 3);
});
