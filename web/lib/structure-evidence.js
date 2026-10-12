// Structure as evidence (wave 5, slice 4; requirement X4): what the structure says of each target
// position, as tracks beside the map and as groups to read the scores by. Pure; the Structure view
// (ui/structure-evidence.js) computes the solvent accessibility in the surface worker, fetches a
// predicted model's aligned error, and draws what this gives.
//
// For each residue of the chain the target is mapped onto:
//   secondary structure  DSSP's eight states (Proteoscope's dssp.js, as structure.js assigns them;
//                        Kabsch & Sander 1983)
//   accessibility        the water-accessible area (Å²) of the residue's heavy atoms, by
//                        Shrake–Rupley with DSSP's radii and a 1.4 Å probe, in the chain alone and
//                        among every protein chain of the structure (DSSP's own); relative to the
//                        residue's largest (Tien et al. 2013, theoretical)
//   exposure, disorder   StructureMap's part-sphere exposure (pPSE: Cα within 12 Å in a 70° cone of
//                        the side chain) and its smoothed full sphere, 34.27 or less a disordered
//                        region; with a predicted model's aligned error (Bludau et al. 2022;
//                        Proteoscope's exposure.js)
//   confidence           a predicted model's pLDDT
//   partners             the nearest heavy atom of another chain or a ligand (ions included, water
//                        not); within 4 Å, the residue is at that partner's interface, and its
//                        contacts are typed by Proteoscope's interactions.js (PLIP's rules)
// Each position then has one structural class: disordered (a predicted model's disordered region),
// interface, buried (relative accessibility in its chain alone below 0.25) or exposed.
//
// Effects by class compare the positions' scores of each class with the rest (Mann–Whitney, with
// the probability that a position of the class scores lower, BH-adjusted across classes). The
// cluster test asks whether the positions least tolerant of substitution lie closer together than
// positions of the same burial do: their pairs within 8 Å (Cβ, Cα for glycine), against the same
// count drawn at random within strata of relative accessibility, seeded.

import { partSphereExposure } from './structure/exposure.js';
import { findInteractions, findInterfaceInteractions, INTERACTION_TYPES } from './structure/interactions.js';
import { createRandom, sampleIndices } from './random.js';
import { normalUpper } from './dmath.js';
import { quantileSorted, sorted } from './stats.js';
import { displayColor } from './colormaps.js';

// Tien, Meyer, Sydykova, Spielman & Wilke 2013 (PLoS ONE 8:e80635), theoretical maxima (Å²).
export const MAX_ASA = { ALA: 129, ARG: 274, ASN: 195, ASP: 193, CYS: 167, GLN: 225, GLU: 223, GLY: 104, HIS: 224, ILE: 197, LEU: 201, LYS: 236, MET: 224, PHE: 240, PRO: 159, SER: 155, THR: 172, TRP: 285, TYR: 263, VAL: 174 };
// DSSP's atom radii (Kabsch & Sander 1983): the backbone's own, 1.8 Å for every other atom.
export const DSSP_RADII = { N: 1.65, CA: 1.87, C: 1.76, O: 1.4 };
export const SIDE_CHAIN_RADIUS = 1.8;
export const SASA_POINTS = 1000;
export const BURIED_RSA = 0.25;
export const CONTACT_DISTANCE = 4;
export const CLUSTER_DISTANCE = 8;
// A group of the least tolerant: every two of its positions within this (Cβ), by complete linkage.
export const GROUP_DIAMETER = 12;
export const CLUSTER_PERMUTATIONS = 1000;
// Strata of relative accessibility: about twelve positions each, from 4 to 16. Calibrated on maps
// simulated with scores that depend on burial alone (validation suite `structures`).
export const clusterStrata = (n) => Math.max(4, Math.min(16, Math.round(n / 12)));

export const CLASSES = [
  { id: 'buried', label: 'buried', words: 'relative accessibility in its chain below 0.25', color: '#5c6bc0' },
  { id: 'exposed', label: 'exposed', words: 'relative accessibility in its chain 0.25 or more', color: '#26a69a' },
  { id: 'interface', label: 'interface', words: 'a heavy atom within 4 Å of another chain or a ligand', color: '#ef6c00' },
  { id: 'disordered', label: 'disordered', words: 'in a predicted model\'s disordered region (pPSE\'s smoothed sphere)', color: '#ad1457' },
];
export const CLASS_BY_ID = new Map(CLASSES.map((c) => [c.id, c]));

export const SS_WORDS = { H: 'α-helix', G: '3₁₀-helix', I: 'π-helix', E: 'strand', B: 'bridge', T: 'turn', S: 'bend', '': 'coil' };
// The secondary structure track's features: helices, strands, turns, typed as UniProt's features
// are (so they are drawn as its are, and "in feature helix" selects them).
const SS_FEATURE = { H: ['Helix', 'helix'], G: ['Helix', 'helix'], I: ['Helix', 'helix'], E: ['Beta strand', 'strand'], B: ['Beta strand', 'strand'], T: ['Turn', 'turn'] };

const plural = (n, word, many = `${word}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? word : many}`;
// A distance by a correctly rounded square root (Math.hypot's last bits depend on the engine).
const distance3 = (dx, dy, dz) => Math.sqrt(dx * dx + dy * dy + dz * dz);
const fmt = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '—');

// --- Accessibility ---------------------------------------------------------------------------------

// The protein atoms of a model as computeGroupedSASA takes them (heavy atoms; DSSP's radii), grouped
// by chain: { positions, radii, groups, residues (each atom's residue key) }.
export function accessibilityInput(model) {
  const atoms = model.atoms.filter((a) => a.kind === 'protein' && !a.isHydrogen);
  const chains = new Map();
  const positions = new Float32Array(atoms.length * 3);
  const radii = new Float32Array(atoms.length);
  const groups = new Int32Array(atoms.length);
  atoms.forEach((a, i) => {
    positions[i * 3] = a.x;
    positions[i * 3 + 1] = a.y;
    positions[i * 3 + 2] = a.z;
    radii[i] = DSSP_RADII[a.name] ?? SIDE_CHAIN_RADIUS;
    if (!chains.has(a.chain)) chains.set(a.chain, chains.size);
    groups[i] = chains.get(a.chain);
  });
  return { positions, radii, groups, residues: atoms.map((a) => a.residueKey) };
}

// Each residue's accessible area from the atoms' (computeGroupedSASA's { complex, isolated }):
// Map(residue key → { complex, alone }), Å².
export function residueAccessibility(input, areas) {
  const out = new Map();
  input.residues.forEach((key, i) => {
    const r = out.get(key) ?? { complex: 0, alone: 0 };
    r.complex += areas.complex[i];
    r.alone += areas.isolated[i];
    out.set(key, r);
  });
  return out;
}

export const relative = (area, resName) => (MAX_ASA[resName] ? area / MAX_ASA[resName] : Number.NaN);

// --- Exposure and disorder --------------------------------------------------------------------------

// A predicted model's aligned error as exposure.js takes it, from AlphaFold DB's JSON: the matrix
// over the model's residues in order (one chain, numbered from 1).
export function paeOf(json, model) {
  const entry = Array.isArray(json) ? json[0] : json;
  const matrix = entry?.predicted_aligned_error ?? entry?.pae;
  if (!Array.isArray(matrix) || !matrix.length) return null;
  const size = matrix.length;
  const residues = model.residues.filter((r) => r.kind === 'protein');
  if (residues.length !== size) return null;
  return { size, matrix: Float32Array.from(matrix.flat()), index: new Map(residues.map((r, i) => [r.key, i])) };
}

const atomOf = (residue, name) => residue.atoms.find((a) => a.name === name) ?? null;

// pPSE and disorder of every protein residue (Map(key → { ppse, sphere, smooth, idr, exposed })).
export function exposureOf(model, pae = null) {
  const residues = model.residues.filter((r) => r.kind === 'protein').map((r) => ({ key: r.key, chain: r.chain, ca: atomOf(r, 'CA'), cb: atomOf(r, 'CB'), n: atomOf(r, 'N'), c: atomOf(r, 'C') }));
  return partSphereExposure(residues, pae ? { pae } : {});
}

// --- Partners ----------------------------------------------------------------------------------------

// Common crystallization additives and buffer ions, as Proteoscope leaves them out of its ligand
// lists (search.go), with tartrate: not a partner unless chosen.
export const ADDITIVES = new Set(['SO4', 'PO4', 'GOL', 'EDO', 'PEG', 'PG4', 'PGE', '1PE', 'CL', 'NA', 'K', 'ACT', 'FMT', 'DMS', 'MPD', 'TRS', 'EPE', 'MES', 'IMD', 'BME', 'NO3', 'IOD', 'BR', 'CIT', 'ACY', 'MLI', 'SCN', 'NH4', 'AZI', 'IPA', 'EOH', 'MOH', 'PEU', 'P6G', 'UNX', 'TLA', 'TAR']);

// What a chain may touch: the other polymer chains and every ligand and ion (water left out), each
// { id, kind, label, atoms (indices), additive }. The partners by default are those not additives.
export function partnersOf(model, structure, chain) {
  const out = [];
  const byChain = new Map();
  const ligands = new Map();
  for (const a of model.atoms) {
    if (a.isHydrogen || a.kind === 'water') continue;
    if (a.kind === 'protein' || a.kind === 'nucleic') {
      if (a.chain === chain) continue;
      if (!byChain.has(a.chain)) byChain.set(a.chain, { kind: a.kind, atoms: [] });
      byChain.get(a.chain).atoms.push(a.id);
    } else {
      const key = a.residueKey;
      if (!ligands.has(key)) ligands.set(key, { kind: a.kind === 'ion' ? 'ion' : 'ligand', resName: a.resName, chain: a.chain, resSeq: a.resSeq, atoms: [], additive: ADDITIVES.has(String(a.resName).toUpperCase()) });
      ligands.get(key).atoms.push(a.id);
    }
  }
  const describe = (id) => structure.chains.find((c) => c.id === id)?.description ?? '';
  for (const [id, c] of byChain) {
    const description = describe(id);
    out.push({ id: `chain:${id}`, kind: c.kind, label: `chain ${id}${description ? ` · ${titled(description)}` : c.kind === 'nucleic' ? ' · nucleic acid' : ''}`, atoms: c.atoms, additive: false });
  }
  for (const [key, l] of ligands) out.push({ id: `ligand:${key}`, kind: l.kind, label: `${l.resName} ${l.resSeq} · ${l.chain}${l.additive ? ' (an additive)' : l.kind === 'ion' ? ' (ion)' : ''}`, atoms: l.atoms, additive: l.additive });
  return out;
}

// The partners chosen: 'all' (every one but the additives) or one by its id.
export function chosenPartners(partners, choice = 'all') {
  if (!choice || choice === 'all') return partners.filter((p) => !p.additive);
  return partners.filter((p) => p.id === choice);
}

function titled(text) {
  const value = String(text || '');
  if (value !== value.toUpperCase()) return value;
  return value.toLowerCase().replace(/^./, (c) => c.toUpperCase());
}

// Each residue of the chain's nearest partner heavy atom: Map(key → { distance, partner }), for
// the partners given (a cell grid of their atoms).
export function partnerDistances(model, chain, partners, reach = 30) {
  const cell = 6;
  const grid = new Map();
  const cellKey = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  for (const p of partners) {
    for (const i of p.atoms) {
      const a = model.atoms[i];
      const key = cellKey(a.x, a.y, a.z);
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push([a, p.id]);
    }
  }
  const out = new Map();
  const steps = Math.ceil(reach / cell);
  for (const residue of model.residues) {
    if (residue.chain !== chain || residue.kind !== 'protein') continue;
    let best = Infinity;
    let partner = null;
    for (const a of residue.atoms) {
      if (a.isHydrogen) continue;
      const cx = Math.floor(a.x / cell);
      const cy = Math.floor(a.y / cell);
      const cz = Math.floor(a.z / cell);
      // Rings of cells outward until the nearest found cannot be beaten.
      for (let ring = 0; ring <= steps; ring += 1) {
        if ((ring - 1) * cell > best) break;
        for (let dx = -ring; dx <= ring; dx += 1) {
          for (let dy = -ring; dy <= ring; dy += 1) {
            for (let dz = -ring; dz <= ring; dz += 1) {
              if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== ring) continue;
              for (const [b, id] of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
                const d = distance3(a.x - b.x, a.y - b.y, a.z - b.z);
                if (d < best) {
                  best = d;
                  partner = id;
                }
              }
            }
          }
        }
      }
    }
    if (partner) out.set(residue.key, { distance: best, partner });
  }
  return out;
}

// The interactions of the chain's residues with a partner, typed by interactions.js:
// Map(residue key → [{ type, label, with }]).
export function partnerInteractions(model, chain, partner) {
  const out = new Map();
  let found;
  try {
    if (partner.id.startsWith('chain:')) found = findInterfaceInteractions(model, chain, partner.id.slice(6));
    else found = findInteractions(model, partner.atoms);
  } catch {
    return out;
  }
  const label = new Map(INTERACTION_TYPES.map((t) => [t.id, t.label]));
  for (const x of found ?? []) {
    const atoms = [x.atomA, x.atomB].map((i) => model.atoms[i]).filter(Boolean);
    const mine = atoms.find((a) => a.chain === chain && a.kind === 'protein');
    const other = atoms.find((a) => a !== mine);
    if (!mine || !other) continue;
    const list = out.get(mine.residueKey) ?? [];
    list.push({ type: x.type, label: label.get(x.type) ?? x.type, with: `${other.resName} ${other.resSeq}${other.chain === chain ? '' : ` · ${other.chain}`}` });
    out.set(mine.residueKey, list);
  }
  return out;
}

// --- Per target position ------------------------------------------------------------------------------

// What the structure says of each target position on the mapping's chain. inputs: { model,
// mapping, accessibility (residueAccessibility), exposure (exposureOf), distances
// (partnerDistances), interactions (partnerInteractions, optional), predicted, pae (whether the
// aligned error was used) }. Returns { chain, positions: [{ position, reference, code, residue,
// ss, rsa, rsaComplex, area, areaComplex, ppse, idr, plddt, distance, partner, interface,
// interactions, cb, class }] }: a position on no residue has residue null and no class.
export function structureEvidence({ model, mapping, accessibility, exposure, distances, interactions = null, predicted = false }) {
  const positions = mapping.positions.map((p) => {
    const out = { position: p.position, reference: p.reference, code: p.code, residue: p.residue ?? null, state: p.state, class: null };
    if (!p.residue) return out;
    const r = model.residueMap.get(p.residue);
    if (!r) return { ...out, residue: null };
    const area = accessibility?.get(r.key);
    const ex = exposure?.get(r.key);
    const near = distances?.get(r.key);
    const cb = atomOf(r, 'CB') ?? atomOf(r, 'CA');
    Object.assign(out, {
      ss: r.dssp ?? '',
      area: area?.alone ?? Number.NaN,
      areaComplex: area?.complex ?? Number.NaN,
      rsa: area ? relative(area.alone, r.parent ?? r.resName) : Number.NaN,
      rsaComplex: area ? relative(area.complex, r.parent ?? r.resName) : Number.NaN,
      ppse: ex?.ppse ?? Number.NaN,
      smooth: ex?.smooth ?? Number.NaN,
      idr: Boolean(predicted && ex?.idr),
      plddt: predicted && Number.isFinite(r.confidence) ? r.confidence : Number.NaN,
      distance: near?.distance ?? Number.NaN,
      partner: near?.partner ?? null,
      interface: Boolean(near && near.distance <= CONTACT_DISTANCE),
      interactions: interactions?.get(r.key) ?? [],
      cb: cb ? [cb.x, cb.y, cb.z] : null,
    });
    out.class = out.idr ? 'disordered' : out.interface ? 'interface' : Number.isFinite(out.rsa) ? (out.rsa < BURIED_RSA ? 'buried' : 'exposed') : null;
    return out;
  });
  return { chain: mapping.chain, target: mapping.target, predicted, positions };
}

// --- Tracks beside the map ----------------------------------------------------------------------------

// The structure's tracks on a map's target (lib/tracks.js): placed by reference numbering where the
// residues agree. base: { structure (its name), source }. [] when the map's target is another protein.
export function structureTracks(evidence, map, base) {
  const L = map.length;
  const shift = (evidence.target.offset ?? 0) - (map.offset ?? 0);
  const at = new Array(L).fill(null);
  let agree = 0;
  let overlap = 0;
  for (const p of evidence.positions) {
    const q = p.position + shift;
    if (q < 1 || q > L) continue;
    overlap += 1;
    if (map.protein[q - 1] !== p.code) continue;
    agree += 1;
    at[q - 1] = p;
  }
  if (!overlap || agree < 0.9 * overlap) return [];
  const name = `${base.structure} ${evidence.chain}`;
  const common = { annotation: null, provider: 'structure', source: base.source, length: L, notes: [], structure: base.structure };
  const values = (key) => Float64Array.from(at, (p) => (p && Number.isFinite(p[key]) ? p[key] : Number.NaN));
  // Runs of positions with one label: [type, label, fill] of a position, or null.
  const segments = (of) => {
    const features = [];
    for (let q = 1; q <= L; q += 1) {
      const got = at[q - 1] ? of(at[q - 1]) : null;
      if (!got) continue;
      const [type, label, fill] = got;
      const last = features.at(-1);
      if (last && last.label === label && last.end === q - 1) last.end = q;
      else features.push({ type, label, start: q, end: q, ...(fill ? { fill } : {}) });
    }
    return features;
  };
  const tracks = [
    { ...common, id: 'structure:class', label: `Structural class (${name})`, kind: 'features', what: 'each position\'s class on the structure: buried, exposed, interface or disordered', features: segments((p) => (p.class ? ['structural class', p.class, displayColor(CLASS_BY_ID.get(p.class).color)] : null)) },
    { ...common, id: 'structure:ss', label: `Secondary structure (${name})`, kind: 'features', what: 'DSSP\'s secondary structure on the structure', features: segments((p) => SS_FEATURE[p.ss] ?? null) },
    { ...common, id: 'structure:rsa', label: `Relative accessibility (${name})`, kind: 'values', what: 'the residue\'s water-accessible area in its chain, relative to its largest', values: values('rsa'), domain: { kind: 'sequential', min: 0, max: 1 }, unit: 'RSA', format: (x) => x.toFixed(2) },
    { ...common, id: 'structure:ppse', label: `Exposure, pPSE (${name})`, kind: 'values', what: 'the Cα atoms within 12 Å in a 70° cone of the side chain (fewer: more exposed)', values: values('ppse'), domain: { kind: 'sequential', min: 0, max: 40 }, unit: 'neighbors', format: (x) => String(Math.round(x)) },
    { ...common, id: 'structure:distance', label: `Distance to a partner (${name})`, kind: 'values', what: 'the nearest heavy atom of another chain or a ligand', values: values('distance'), domain: { kind: 'sequential', min: 0, max: 30 }, unit: 'Å', format: (x) => x.toFixed(1) },
  ];
  if (evidence.predicted) tracks.push({ ...common, id: 'structure:plddt', label: `Confidence, pLDDT (${name})`, kind: 'values', what: 'the predicted model\'s confidence in each residue', values: values('plddt'), domain: { kind: 'sequential', min: 0, max: 100 }, unit: 'pLDDT', format: (x) => x.toFixed(1) });
  return tracks;
}


// --- Effects by class -----------------------------------------------------------------------------------

// Mann–Whitney's test of a against b, two-sided, by the normal approximation with the ties' and the
// continuity's corrections (as scipy.stats.mannwhitneyu computes it, method 'asymptotic'):
// { u (a's), z, p, below (the probability that a value of a is below one of b, ties half) }.
export function mannWhitney(a, b) {
  const n1 = a.length;
  const n2 = b.length;
  if (!n1 || !n2) return { u: Number.NaN, z: Number.NaN, p: Number.NaN, below: Number.NaN };
  const all = [...a.map((x) => [x, 0]), ...b.map((x) => [x, 1])].sort((x, y) => x[0] - y[0]);
  const n = all.length;
  let rankA = 0;
  let ties = 0;
  for (let i = 0; i < n;) {
    let j = i;
    while (j + 1 < n && all[j + 1][0] === all[i][0]) j += 1;
    const rank = (i + j) / 2 + 1;
    const t = j - i + 1;
    ties += t * t * t - t;
    for (let k = i; k <= j; k += 1) if (all[k][1] === 0) rankA += rank;
    i = j + 1;
  }
  const u = rankA - (n1 * (n1 + 1)) / 2;
  const mu = (n1 * n2) / 2;
  const sigma = Math.sqrt(((n1 * n2) / 12) * ((n + 1) - ties / (n * (n - 1))));
  const big = Math.max(u, n1 * n2 - u);
  const z = sigma > 0 ? (big - mu - 0.5) / sigma : Number.NaN;
  const p = Number.isFinite(z) ? Math.min(1, 2 * normalUpper(z)) : Number.NaN;
  return { u, z, p, below: (n1 * n2 - u) / (n1 * n2) };
}

// Benjamini–Hochberg's adjusted p-values (NaN kept).
export function bhAdjust(ps) {
  const order = ps.map((p, i) => [p, i]).filter(([p]) => Number.isFinite(p)).sort((x, y) => x[0] - y[0]);
  const q = new Array(ps.length).fill(Number.NaN);
  let running = 1;
  for (let k = order.length - 1; k >= 0; k -= 1) {
    running = Math.min(running, (order[k][0] * order.length) / (k + 1));
    q[order[k][1]] = running;
  }
  return q;
}

// The positions' values (position → value; a position summary of the scores) by structural class:
// each class's count, median and quartiles, and its test against the rest. lossBelow: whether a lower
// value is the loss side (the readout's direction), for the words.
export function effectsByClass(evidence, valueAt, { lossBelow = true } = {}) {
  const rows = evidence.positions.filter((p) => p.class && Number.isFinite(valueAt(p.position)));
  const classes = CLASSES.map((c) => {
    const values = rows.filter((p) => p.class === c.id).map((p) => valueAt(p.position));
    const rest = rows.filter((p) => p.class !== c.id).map((p) => valueAt(p.position));
    const s = sorted(values);
    return { id: c.id, label: c.label, n: values.length, median: s.length ? quantileSorted(s, 0.5) : Number.NaN, q1: s.length ? quantileSorted(s, 0.25) : Number.NaN, q3: s.length ? quantileSorted(s, 0.75) : Number.NaN, values, test: values.length >= 3 && rest.length >= 3 ? mannWhitney(values, rest) : null };
  });
  const q = bhAdjust(classes.map((c) => c.test?.p ?? Number.NaN));
  classes.forEach((c, i) => {
    if (c.test) c.test.q = q[i];
  });
  return { positions: rows.length, classes: classes.filter((c) => c.n), lossBelow };
}

export function describeEffects(effects, structureName) {
  const lines = [];
  const shown = effects.classes;
  if (!shown.length) return ['No position on the structure has both a class and a value.'];
  lines.push(`By structural class, on ${structureName}: ${shown.map((c) => `${c.label} ${plural(c.n, 'position')}, median ${fmt(c.median)}`).join('; ')}.`);
  const tested = shown.filter((c) => c.test);
  if (tested.length) {
    lines.push(`Against the other positions: ${tested.map((c) => `${c.label} ${effects.lossBelow ? 'lower' : 'higher'} ${fmt(100 * (effects.lossBelow ? c.test.below : 1 - c.test.below), 0)}% of the time (Mann–Whitney, q ${c.test.q < 0.001 ? c.test.q.toExponential(1) : fmt(c.test.q, 3)})`).join('; ')}. The positions are the units: their substitutions are not counted apart.`);
  }
  return lines;
}

// --- Spatial clusters -------------------------------------------------------------------------------------

// The cluster test. evidence: structureEvidence's; valueAt(position) → the position's value; options:
// { fraction (the share of positions called least tolerant, 0.2), lossBelow, permutations, seed,
// strata (bins of relative accessibility, of equal size; clusterStrata's by default), distance }.
// Returns { n, sensitive (the positions), observed (their pairs within the distance), expected,
// ratio, p, exceeded (draws with as many), permutations, seed, strata, any: { expected, p } (drawn
// from every position, burial ignored), clusters: [[positions]] (compact groups of three or more,
// every two within GROUP_DIAMETER, by complete linkage; the largest first) }, or null with fewer
// than 10 positions.
export function clusterTest(evidence, valueAt, options = {}) {
  const fraction = options.fraction ?? 0.2;
  const distance = options.distance ?? CLUSTER_DISTANCE;
  const permutations = options.permutations ?? CLUSTER_PERMUTATIONS;
  const seed = options.seed ?? 1;
  const lossBelow = options.lossBelow ?? true;
  const rows = evidence.positions.filter((p) => p.cb && Number.isFinite(p.rsa) && Number.isFinite(valueAt(p.position)));
  const n = rows.length;
  if (n < 10) return null;
  const strataCount = options.strata ?? clusterStrata(n);
  const k = Math.max(2, Math.round(fraction * n));
  // The least tolerant: the k positions furthest on the loss side (ties broken by position).
  const order = rows.map((p, i) => [lossBelow ? valueAt(p.position) : -valueAt(p.position), p.position, i]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const sensitive = order.slice(0, k).map((x) => x[2]);
  // Neighbors within the distance.
  const near = Array.from({ length: n }, () => new Uint8Array(n));
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const [a, b] = [rows[i].cb, rows[j].cb];
      if (distance3(a[0] - b[0], a[1] - b[1], a[2] - b[2]) <= distance) near[i][j] = near[j][i] = 1;
    }
  }
  const pairs = (set) => {
    let count = 0;
    for (let x = 0; x < set.length; x += 1) for (let y = x + 1; y < set.length; y += 1) count += near[set[x]][set[y]];
    return count;
  };
  // Strata of relative accessibility (equal sizes, ties kept together by order).
  const byRsa = rows.map((p, i) => [p.rsa, i]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const stratum = new Int32Array(n);
  byRsa.forEach(([, i], rank) => {
    stratum[i] = Math.min(strataCount - 1, Math.floor((rank * strataCount) / n));
  });
  const members = Array.from({ length: strataCount }, () => []);
  for (let i = 0; i < n; i += 1) members[stratum[i]].push(i);
  const drawn = new Array(strataCount).fill(0);
  for (const i of sensitive) drawn[stratum[i]] += 1;
  const observed = pairs(sensitive);
  const random = createRandom(seed);
  let atLeast = 0;
  let total = 0;
  for (let t = 0; t < permutations; t += 1) {
    const set = [];
    for (let s = 0; s < strataCount; s += 1) {
      if (!drawn[s]) continue;
      for (const j of sampleIndices(members[s].length, drawn[s], random)) set.push(members[s][j]);
    }
    const count = pairs(set);
    total += count;
    if (count >= observed) atLeast += 1;
  }
  const expected = total / permutations;
  // The same, drawn from every position: what burial alone would explain.
  let anyAtLeast = 0;
  let anyTotal = 0;
  for (let t = 0; t < permutations; t += 1) {
    const count = pairs(Array.from(sampleIndices(n, k, random)));
    anyTotal += count;
    if (count >= observed) anyAtLeast += 1;
  }
  const clusters = compactGroups(sensitive.map((i) => rows[i]), options.diameter ?? GROUP_DIAMETER);
  return {
    n, k, fraction, distance, permutations, seed, strata: strataCount,
    sensitive: sensitive.map((i) => rows[i].position).sort((a, b) => a - b),
    observed, expected, ratio: expected > 0 ? observed / expected : Number.NaN,
    p: (1 + atLeast) / (permutations + 1),
    exceeded: atLeast,
    any: { expected: anyTotal / permutations, p: (1 + anyAtLeast) / (permutations + 1), exceeded: anyAtLeast },
    clusters,
  };
}

// Complete-linkage groups of positions ({ position, cb }): the two groups whose farthest members are
// nearest merged first, while every two members stay within the diameter. Groups of three or more,
// their positions in order, the largest first.
export function compactGroups(rows, diameter = GROUP_DIAMETER) {
  const d = (a, b) => distance3(a.cb[0] - b.cb[0], a.cb[1] - b.cb[1], a.cb[2] - b.cb[2]);
  let groups = rows.map((r) => [r]);
  for (;;) {
    let best = null;
    for (let i = 0; i < groups.length; i += 1) {
      for (let j = i + 1; j < groups.length; j += 1) {
        let far = 0;
        for (const a of groups[i]) for (const b of groups[j]) far = Math.max(far, d(a, b));
        if (far <= diameter && (!best || far < best.far || (far === best.far && i < best.i))) best = { i, j, far };
      }
    }
    if (!best) break;
    groups[best.i] = [...groups[best.i], ...groups[best.j]];
    groups = groups.filter((_, k) => k !== best.j);
  }
  return groups.filter((g) => g.length >= 3).map((g) => g.map((r) => r.position).sort((a, b) => a - b)).sort((a, b) => b.length - a.length || a[0] - b[0]);
}

export function describeClusters(test, names) {
  if (!test) return ['Fewer than ten positions on the structure have a value and an accessibility: the cluster test needs more.'];
  const named = (positions) => positions.map(names).join(', ');
  const pText = (p, exceeded) => (exceeded === 0 ? `p ≤ ${fmt(p, 4).replace(/0+$/, '')}, no draw as many` : `p ${fmt(p, 3)}`);
  const lines = [`The ${plural(test.k, 'least tolerant position')} of the ${test.n} on the structure (${Math.round(test.fraction * 100)}%) make ${plural(test.observed, 'pair')} within ${test.distance} Å of each other (Cβ), against ${fmt(test.expected, 1)} expected among positions of the same burial (${test.permutations.toLocaleString('en-US')} draws within ${test.strata} strata of relative accessibility, seed ${test.seed}): ${fmt(test.ratio, 2)} times as many, ${pText(test.p, test.exceeded)}. Drawn from every position, burial ignored, ${fmt(test.any.expected, 1)} would be expected (${pText(test.any.p, test.any.exceeded)}).`];
  if (test.clusters.length) lines.push(`Compact groups of them (three or more, every two within ${GROUP_DIAMETER} Å): ${test.clusters.slice(0, 4).map((c) => `${named(c)}`).join('; ')}${test.clusters.length > 4 ? `; and ${test.clusters.length - 4} more` : ''}.`);
  return lines;
}

// --- The file --------------------------------------------------------------------------------------------

const THREE = { A: 'Ala', R: 'Arg', N: 'Asn', D: 'Asp', C: 'Cys', Q: 'Gln', E: 'Glu', G: 'Gly', H: 'His', I: 'Ile', L: 'Leu', K: 'Lys', M: 'Met', F: 'Phe', P: 'Pro', S: 'Ser', T: 'Thr', W: 'Trp', Y: 'Tyr', V: 'Val' };

// The evidence position by position (CSV), with the value the positions were read by.
export function evidenceCSV(evidence, structureName, valueAt = null, valueName = 'value') {
  const head = ['target_position', 'reference_position', 'target_residue', 'structure', 'chain', 'residue_number', 'insertion_code', 'secondary_structure', 'accessible_area', 'relative_accessibility', 'relative_accessibility_in_structure', 'ppse', 'disordered', 'plddt', 'partner_distance', 'partner', 'interface', 'interactions', 'structural_class', ...(valueAt ? [valueName] : [])];
  const csv = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replaceAll('"', '""')}"` : String(v));
  const num = (x, d) => (Number.isFinite(x) ? String(+x.toFixed(d)) : '');
  const rows = [head.join(',')];
  for (const p of evidence.positions) {
    const [, number] = p.residue ? p.residue.split(':') : ['', ''];
    const m = /^(-?\d+)([A-Za-z]?)$/.exec(number ?? '') ?? [];
    const v = valueAt ? valueAt(p.position) : Number.NaN;
    rows.push([p.position, p.reference, THREE[p.code] ?? p.code, structureName, evidence.chain, m[1] ?? '', m[2] ?? '', p.residue ? (p.ss || '-') : '', num(p.area, 1), num(p.rsa, 3), num(p.rsaComplex, 3), num(p.ppse, 0), p.residue ? (p.idr ? 'yes' : '') : '', num(p.plddt, 2), num(p.distance, 2), p.partner ?? '', p.interface ? 'yes' : '', (p.interactions ?? []).map((x) => `${x.label} ${x.with}`).join('; '), p.class ?? '', ...(valueAt ? [num(v, 6)] : [])].map(csv).join(','));
  }
  return `${rows.join('\n')}\n`;
}
