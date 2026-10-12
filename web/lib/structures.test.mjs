import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { alphafoldEntry, applyAlphafoldEntry, assemblyChoices, chainSummaries, describeStructure, moleculeName, openStructureText, readStructureBytes, residueLabel, residueRuns, structureRequest } from './structures.js';

const fixture = (path) => new Uint8Array(readFileSync(new URL(`../../validation/fixtures/${path}`, import.meta.url)));
const open = async (path, name) => {
  const { text, name: read } = await readStructureBytes(fixture(path), name);
  return openStructureText(text, read);
};

test('what a person asks to open: a PDB ID, or an AlphaFold DB model by its accession', () => {
  assert.deepEqual(structureRequest(' 2vwf '), { kind: 'pdb', id: '2VWF', label: 'PDB 2VWF' });
  assert.deepEqual(structureRequest('PDB_00002VWF'), { kind: 'pdb', id: 'pdb_00002vwf', label: 'PDB pdb_00002vwf' });
  assert.equal(structureRequest('P62993').kind, 'alphafold');
  assert.equal(structureRequest('AF-P62993-F1-model_v6').id, 'P62993');
  assert.equal(structureRequest('P62993-2').id, 'P62993-2');
  assert.equal(structureRequest('GRB2'), null);
  assert.equal(structureRequest('2VWF', 'alphafold'), null);
  assert.equal(structureRequest('P62993', 'pdb'), null);
});

test('AlphaFold DB\'s entries: the accession\'s own model, not an isoform\'s', () => {
  const entries = [{ entryId: 'AF-P62993-2-F1', uniprotAccession: 'P62993-2' }, { entryId: 'AF-P62993-F1', uniprotAccession: 'P62993', latestVersion: 6 }];
  assert.equal(alphafoldEntry(entries, 'P62993').entryId, 'AF-P62993-F1');
  assert.equal(alphafoldEntry(entries, 'P62993-2').entryId, 'AF-P62993-2-F1');
  assert.equal(alphafoldEntry([], 'P62993'), null);
  assert.equal(alphafoldEntry({ error: 'x' }, 'P62993'), null);
});

test('a structure file is read however it comes: plain, gzipped or BinaryCIF', async () => {
  const text = 'data_TEST\nloop_\n_atom_site.group_PDB\n_atom_site.id\n_atom_site.type_symbol\n_atom_site.label_atom_id\n_atom_site.label_comp_id\n_atom_site.label_asym_id\n_atom_site.auth_seq_id\n_atom_site.Cartn_x\n_atom_site.Cartn_y\n_atom_site.Cartn_z\nATOM 1 C CA ALA A 1 0.0 0.0 0.0\n';
  const plain = await readStructureBytes(new TextEncoder().encode(text), 'test.cif');
  const gzipped = await readStructureBytes(new Uint8Array(gzipSync(text)), 'test.cif.gz');
  assert.deepEqual(plain, { text, name: 'test.cif' });
  assert.deepEqual(gzipped, { text, name: 'test.cif' });
  const binary = await readStructureBytes(fixture('structures/AF-P62993-F1-model_v6.bcif'), 'AF-P62993-F1-model_v6.bcif');
  assert.equal(binary.name, 'AF-P62993-F1-model_v6.cif');
  assert.match(binary.text, /^data_/);
  assert.throws(() => openStructureText('nothing here\n', 'notes.pdb'), /No ATOM or HETATM records|holds no atoms/);
});

test('a structure in words: its title, method, chains, the UniProt residues each covers, what else it holds', async () => {
  const factor9 = await open('public-data/pdb/1RFN.cif.gz', '1RFN.cif.gz');
  assert.deepEqual(describeStructure(factor9), [
    '1RFN: Human Coagulation Factor IXa In Complex With P-Amino Benzamidine.',
    'X-ray diffraction, 2.8 Å; Homo sapiens.',
    '2 protein chains, 2 ligands (PBZ, TBU), an ion (CA); 2,306 atoms.',
    'Chain A: Coagulation Factor IX, 235 residues observed (16–245); the entry gives UniProt P00740 227–461.',
    'Chain B: Coagulation Factor IX, 57 residues observed (86–142); the entry gives UniProt P00740 128–183.',
  ]);
  const p53 = await open('public-data/pdb/1TUP.cif.gz', '1TUP.cif.gz');
  assert.deepEqual(chainSummaries(p53).map((c) => `${c.id} ${c.kind} ${c.description}`), ['A protein P53 Tumor Suppressor', 'B protein P53 Tumor Suppressor', 'C protein P53 Tumor Suppressor', 'E nucleic DNA', 'F nucleic DNA']);
  assert.deepEqual(assemblyChoices(p53).map((a) => [a.id, a.label, a.atoms]), [['asym', 'Asymmetric unit', 5828], ['1', 'Assembly 1: pentameric', 5828]]);
});

test('an AlphaFold DB model named as its entry names it', async () => {
  const model = await open('public-data/alphafold/AF-P62993-F1-model_v6.cif', 'AF-P62993-F1-model_v6.cif');
  applyAlphafoldEntry(model, { entryId: 'AF-P62993-F1', uniprotDescription: 'Growth factor receptor-bound protein 2', gene: 'GRB2', organismScientificName: 'Homo sapiens', latestVersion: 6, modelCreatedDate: '2025-08-01T00:00:00Z' });
  const words = describeStructure(model);
  assert.equal(words[0], 'AF-P62993-F1: Growth factor receptor-bound protein 2 (GRB2).');
  assert.match(words[1], /^A predicted model, not an experimental structure: each residue carries its confidence, pLDDT/);
  assert.deepEqual(assemblyChoices(model), []);
});

test('names and residues in words', () => {
  assert.equal(moleculeName('PROTEIN (COAGULATION FACTOR IX)'), 'Coagulation Factor IX');
  assert.equal(moleculeName("DNA (5'-D(*TP*TP*TP*CP*CP*TP*AP*GP*AP*C)-3')"), 'DNA');
  assert.equal(moleculeName('Breast cancer type 1 susceptibility protein'), 'Breast cancer type 1 susceptibility protein');
  const residue = (chain, resSeq, resName = 'ALA', iCode = '') => ({ chain, resSeq, resName, iCode });
  assert.equal(residueLabel(residue('A', 42, 'CYS')), 'Cys 42 · A');
  assert.equal(residueLabel(residue('B', 100, 'GLY', 'A')), 'Gly 100A · B');
  assert.deepEqual(residueRuns([residue('A', 1), residue('A', 2), residue('A', 3), residue('A', 5), residue('B', 6), residue('B', 7)]), ['Ala 1–Ala 3 · A', 'Ala 5 · A', 'Ala 6 · B', 'Ala 7 · B']);
});
