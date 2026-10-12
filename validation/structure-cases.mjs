// The structures of the examples' proteins (wave 5, slice 1), for the validation suite `structures`
// and the remote session: each example's PDB entry and AlphaFold DB model, as the fetcher keeps
// them (validation/fixtures/public-data: pdb/, alphafold/), read as the page reads them; and one
// entry in each other format (validation/fixtures/structures: RCSB's PDB-format file and BinaryCIF
// of 2VWF, AlphaFold DB's BinaryCIF of GRB2's model), to check that a structure reads the same
// however it comes.

import { readFileSync } from 'node:fs';
import { readStructureBytes, openStructureText } from '../web/lib/structures.js';
import { exampleById } from '../web/lib/examples.js';
import { targetProtein } from '../web/lib/target.js';
import { cachedRecord, recordTarget } from './example-cases.mjs';
import { KIND, STATUS } from '../web/lib/variants.js';
import { STAGE_BY_ID } from '../web/lib/filters.js';
import { computeGroupedSASA } from '../web/lib/structure/surface.js';
import { accessibilityInput, chosenPartners, exposureOf, paeOf, partnerDistances, partnerInteractions, partnersOf, residueAccessibility, SASA_POINTS, structureEvidence } from '../web/lib/structure-evidence.js';
import { mapTarget } from '../web/lib/mapping.js';
import { mappingChanges, mappingSummary } from '../web/lib/structure-record.js';
import { sha256 } from '../web/lib/sha256.js';
import { deriveStructure, materializeAssemblyModels } from '../web/lib/structure/structure.js';
import { ASYMMETRIC_UNIT_ID } from '../web/lib/structure/parse.js';

const FIXTURES = new URL('./fixtures/', import.meta.url);

// Each example's protein: its UniProt accession, the PDB entry its guide or the roadmap names (the
// chain that holds the target and the UniProt residues it covers, as the entry says), and its
// AlphaFold DB model's version.
export const EXAMPLE_STRUCTURES = [
  { protein: 'GRB2', examples: ['grb2-sh3'], accession: 'P62993', pdb: '2VWF', chain: 'A', covers: [159, 214], model: 6 },
  { protein: 'BRCA1', examples: ['brca1-ring', 'brca1-sge'], accession: 'P38398', pdb: '1JM7', chain: 'A', covers: [1, 110], model: 6 },
  { protein: 'Hsp90 (Hsp82)', examples: ['hsp90'], accession: 'P02829', pdb: '2CG9', chain: 'A', covers: [1, 677], model: 6 },
  { protein: 'DHFR (E. coli)', examples: ['dhfr-lon'], accession: 'P0ABQ4', pdb: '1RX2', chain: 'A', covers: [1, 159], model: 6 },
  { protein: 'Coagulation factor IX', examples: ['factor9'], accession: 'P00740', pdb: '1RFN', chain: 'A', covers: [227, 461], model: 6 },
  { protein: 'TP53', examples: ['tp53-screens'], accession: 'P04637', pdb: '1TUP', chain: 'B', covers: [94, 312], model: 6 },
  { protein: 'PTEN', examples: ['pten-mavedb'], accession: 'P60484', pdb: '1D5R', chain: 'A', covers: [7, 353], model: 6 },
];

// An example's target as its workspace holds it (wave 5, slice 2): its design's, or its MaveDB
// record's (the transcript a record names read from the fetcher's cached answer), as the mapping
// reads it.
export function exampleTarget(id) {
  const example = exampleById(id);
  const target = example.files?.design
    ? JSON.parse(readFileSync(new URL(`../web/${example.files.design}`, import.meta.url), 'utf8')).targets[0]
    : recordTarget(cachedRecord(example.mavedb.urn));
  const sequence = targetProtein(target).replace(/\*+$/, '');
  return { id: target.id, name: target.name, sequence, offset: target.offset ?? 0, accession: target.identifiers?.uniprot ?? '', length: sequence.length };
}

// SIFTS's residue-level mapping of an entry (reference/sifts.json): label chain → label sequence
// number → { accession, position, residue, observed }.
const SIFTS = JSON.parse(readFileSync(new URL('./reference/sifts.json', import.meta.url), 'utf8'));
export const siftsRetrieved = SIFTS.retrieved;
export function siftsOf(entry) {
  const chains = SIFTS.entries[entry]?.chains ?? {};
  return new Map(Object.entries(chains).map(([asym, c]) => [asym, new Map(c.residues.map(([seq, accession, position, residue, observed]) => [seq, { accession, position, residue, observed, author: c.author }]))]));
}

// A file of the fetcher's cache, as the page receives it (the bytes kept: gzipped).
export function cachedBytes(kind, name) {
  return new Uint8Array(readFileSync(new URL(`public-data/${kind}/${name}`, FIXTURES)));
}

export function cachedJSON(kind, name) {
  return JSON.parse(readFileSync(new URL(`public-data/${kind}/${name}`, FIXTURES), 'utf8'));
}

// A structure read and opened as the page does (lib/structures.js).
export async function openCached(kind, name) {
  const { text, name: textName } = await readStructureBytes(cachedBytes(kind, name), name);
  return openStructureText(text, textName);
}

export async function openFixture(name) {
  const bytes = new Uint8Array(readFileSync(new URL(`structures/${name}`, FIXTURES)));
  const { text, name: textName } = await readStructureBytes(bytes, name);
  return openStructureText(text, textName);
}

export const pdbFile = (id) => `${id}.cif.gz`;
export const modelFile = (accession, version) => `AF-${accession}-F1-model_v${version}.cif`;

// Each atom of a model as a line (chain, residue, name, element, coordinates to 10⁻³ Å): the same
// structure read from two formats gives the same lines.
export function atomLines(model) {
  return model.atoms.map((a) => `${a.chain} ${a.resName} ${a.resSeq}${a.iCode || ''} ${a.name} ${a.element} ${a.x.toFixed(3)} ${a.y.toFixed(3)} ${a.z.toFixed(3)}`);
}

// Each position's missense substitutions read straight from a run's results (wave 5, slice 3), for
// checking the scores drawn on a structure without the map's model (the first methionine's
// substitutions, start-lost, among them, as its column of the map holds them): position → { scored: Map(alt
// code → { score, se, low }), filtered: Set(alt code) }. A substitution written twice is the last
// row's, as the map takes it.
export function positionScores(results, condition = 0) {
  const v = results.variants;
  const c = results.conditions[condition];
  const measured = STAGE_BY_ID.get('measured').code;
  const out = new Map();
  for (let i = 0; i < results.rows; i += 1) {
    if ((v.kind[i] !== KIND.MISSENSE && v.kind[i] !== KIND.START_LOST) || v.status[i] === STATUS.INVALID) continue;
    const p = v.position[i];
    if (!out.has(p)) out.set(p, { scored: new Map(), filtered: new Set() });
    const at = out.get(p);
    at.scored.delete(v.alt[i]);
    at.filtered.delete(v.alt[i]);
    if (!c.reason[i] && Number.isFinite(c.score[i])) at.scored.set(v.alt[i], { score: c.score[i], se: c.se?.[i], low: c.flags[i] !== 0 });
    else if (c.reason[i] && c.reason[i] !== measured) at.filtered.add(v.alt[i]);
  }
  return out;
}

// The middle of numbers (the mean of the two middle ones for an even count).
export function middle(values) {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  if (!n) return Number.NaN;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

// What a structure says of a mapping's positions (wave 5, slice 4), computed in Node as the page
// computes it (ui/structure-evidence.js), the accessibility in one pass rather than in the worker.
// options: { pae (AlphaFold DB's JSON, parsed), choice ('all' or a partner's id) }.
export function nodeEvidence(structure, mapping, { pae = null, choice = 'all' } = {}) {
  const model = structure.models[0];
  const input = accessibilityInput(model);
  const accessibility = residueAccessibility(input, computeGroupedSASA(input.positions, input.radii, input.groups, { points: SASA_POINTS }));
  const matrix = pae ? paeOf(pae, model) : null;
  const exposure = exposureOf(model, matrix);
  const partners = partnersOf(model, structure, mapping.chain);
  const chosen = chosenPartners(partners, choice);
  const distances = partnerDistances(model, mapping.chain, chosen);
  const interactions = new Map();
  for (const p of chosen) {
    if (![...distances.values()].some((d) => d.partner === p.id && d.distance <= 4)) continue;
    for (const [k, list] of partnerInteractions(model, mapping.chain, p)) interactions.set(k, [...(interactions.get(k) ?? []), ...list]);
  }
  return { evidence: structureEvidence({ model, mapping, accessibility, exposure, distances, interactions, predicted: Boolean(structure.meta.isPredicted) }), accessibility, partners, chosen, pae: Boolean(matrix) };
}

export const paeFixture = (accession, version = 6) => {
  try {
    return JSON.parse(readFileSync(new URL(`public-data/alphafold/AF-${accession}-F1-predicted_aligned_error_v${version}.json`, FIXTURES), 'utf8'));
  } catch {
    return null;
  }
};

// The workspace's target as the Structure view maps it (ui/mode-structure.js, workspaceTarget): the
// run's, when the view is of a run; else the design's; its protein, offset and accession.
export function workspaceTargetOf(ws, run = null) {
  const own = run?.inputs?.design?.targets?.length === 1 ? run.inputs.design.targets[0] : null;
  const target = (own && (ws.targets.find((t) => t.id === own.id) ?? own)) ?? ws.targets.find((t) => t.id === ws.design?.targets?.[0]?.id) ?? ws.targets[0];
  if (!target?.sequence) return null;
  const sequence = targetProtein(target).replace(/\*+$/, '');
  return { id: target.id, name: target.name || 'The target', sequence, offset: target.offset ?? 0, accession: target.identifiers?.uniprot ?? '', length: sequence.length };
}

// A workspace's saved views reopened as the Structure view reopens them (MaveScape 0.5): each view's
// structure from the archive's own file or, named by checksum only, fetched again by its ID (the
// fetcher's answer, here the cache), its SHA-256 the one recorded; its assembly built; the target
// mapped again onto the view's chain and compared with the mapping the view was saved with.
// [{ view, structure, from, sameFile, changes, ok, why }]
export async function replayStructureViews(ws, sources) {
  const out = [];
  for (const view of ws.structureViews ?? []) {
    const entry = (ws.structures ?? []).find((s) => s.id === view.structure);
    if (!entry) {
      out.push({ view: view.name, ok: false, why: 'its structure is not in the workspace' });
      continue;
    }
    let bytes = sources.get(entry.file.sha256) ?? null;
    let from = 'from the archive';
    if (!bytes) {
      const o = entry.origin ?? {};
      const cached = o.kind === 'pdb' ? ['pdb', pdbFile(o.id)] : o.kind === 'alphafold' ? ['alphafold', modelFile(o.id, o.version)] : null;
      try {
        if (cached) bytes = cachedBytes(...cached);
        from = 'fetched again by its ID';
      } catch {
        bytes = null;
      }
    }
    if (!bytes) {
      out.push({ view: view.name, structure: entry.name, ok: false, why: `${entry.file.fileName} is not at hand` });
      continue;
    }
    const sameFile = sha256(bytes) === entry.file.sha256;
    const { text, name } = await readStructureBytes(bytes, entry.file.fileName);
    const structure = openStructureText(text, name);
    if (view.assembly && view.assembly !== ASYMMETRIC_UNIT_ID) {
      structure.activeAssemblyId = view.assembly;
      structure.models = materializeAssemblyModels(structure, view.assembly);
      deriveStructure(structure, { secondaryMode: 'auto' });
    }
    const run = view.color?.run ? ws.runs.find((r) => r.id === view.color.run) : null;
    const target = workspaceTargetOf(ws, run);
    const mapping = (target ? mapTarget(structure, target) : []).find((m) => m.chain === view.chain) ?? null;
    const changes = mappingChanges(view.mapping, mappingSummary(mapping));
    out.push({ view: view.name, structure: entry.name, from, sameFile, changes, ok: sameFile && !changes.length, why: !sameFile ? 'not the file recorded' : changes.join('; ') });
  }
  return out;
}
