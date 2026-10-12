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
