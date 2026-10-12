// Structures in MaveScape (wave 5, slice 1; requirement X1): reading a structure file however it
// comes (mmCIF or PDB text, gzipped, or BinaryCIF), what a person asks to open (a PDB ID, an
// AlphaFold DB model by its UniProt accession), and a structure described in words. The parsing,
// residues, assemblies and drawing are Proteoscope's (structure/, copied); this module is
// MaveScape's, and pure.

import { binaryCIFToText, isBinaryCIF } from './structure/bcif.js';
import { ASYMMETRIC_UNIT_ID, parseStructure } from './structure/parse.js';
import { MAX_ASSEMBLY_ATOMS, deriveStructure, prepareAssemblyEstimates } from './structure/structure.js';
import { titleCase } from './structure/coloring.js';

export { ASYMMETRIC_UNIT_ID, MAX_ASSEMBLY_ATOMS };

// The file names MaveScape opens as structures (app.js, fileKind; local.go, fileKind).
export const STRUCTURE_FILE = /\.(pdb|ent|cif|mmcif|bcif)(\.gz)?$/i;

const PDB_ID = /^([0-9][A-Za-z0-9]{3}|pdb_[0-9]{4}[0-9a-z]{4})$/i;
const ACCESSION = /^([OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2})(-[0-9]+)?$/;

// What a person typed to open: a PDB ID (2VWF, pdb_00002vwf), an AlphaFold DB model by its UniProt
// accession (P62993, AF-P62993-F1), or null. The kind may be forced ('pdb' or 'alphafold').
export function structureRequest(text, kind = '') {
  const clean = String(text ?? '').trim();
  const af = /^AF-([A-Z0-9-]+?)-F\d+(-model_v\d+)?$/i.exec(clean);
  if (kind !== 'alphafold' && !af && PDB_ID.test(clean)) {
    const id = /^pdb_/i.test(clean) ? clean.toLowerCase() : clean.toUpperCase();
    return { kind: 'pdb', id, label: `PDB ${id}` };
  }
  const accession = (af ? af[1] : clean).toUpperCase();
  if (kind !== 'pdb' && ACCESSION.test(accession)) return { kind: 'alphafold', id: accession, label: `AlphaFold DB ${accession}` };
  return null;
}

// AlphaFold DB's entries for an accession → its own model (AF-<accession>-F1), or null.
export function alphafoldEntry(entries, accession) {
  if (!Array.isArray(entries)) return null;
  return entries.find((e) => e?.entryId === `AF-${accession}-F1`) ?? entries.find((e) => e?.uniprotAccession === accession) ?? null;
}

const isGzip = (bytes) => bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;

async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// A structure file's bytes → { text, name } with the name of the text read (gzip and BinaryCIF
// undone: "2VWF.cif.gz" → "2VWF.cif", "x.bcif" → "x.cif").
export async function readStructureBytes(bytes, name) {
  let data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let label = String(name ?? 'structure');
  if (isGzip(data)) {
    data = await gunzip(data);
    label = label.replace(/\.gz$/i, '');
  }
  if (/\.bcif$/i.test(label) || isBinaryCIF(data)) return { text: binaryCIFToText(data), name: label.replace(/\.bcif$/i, '.cif') };
  return { text: new TextDecoder().decode(data), name: label };
}

// Text → a structure ready to draw: its residues, bonds, secondary structure (the file's, else
// DSSP's) and the sizes of its assemblies. Throws when nothing in it is a structure.
export function openStructureText(text, name) {
  const structure = parseStructure(text, name);
  if (!structure.models.length || !structure.models[0].atoms.length) throw new Error(`${name} holds no atoms: is it a PDB or mmCIF file?`);
  structure.baseModels = structure.models;
  prepareAssemblyEstimates(structure);
  deriveStructure(structure, { secondaryMode: 'auto' });
  return structure;
}

// The assemblies a person can choose: the asymmetric unit and each the file defines, unless a PDB
// file's one assembly is the deposited coordinates. Each { id, label, atoms, tooLarge }.
export function assemblyChoices(structure) {
  const list = structure.assemblies ?? [];
  const only = list.length === 1 && list[0].estimatedAtoms === structure.baseModels?.[0]?.atoms.length && structure.format === 'pdb';
  if (!list.length || only) return [];
  return [
    { id: ASYMMETRIC_UNIT_ID, label: 'Asymmetric unit', atoms: structure.baseModels[0].atoms.length, tooLarge: false },
    ...list.map((a) => ({ id: a.id, label: assemblyLabel(a), atoms: a.estimatedAtoms ?? 0, tooLarge: (a.estimatedAtoms ?? 0) > MAX_ASSEMBLY_ATOMS })),
  ];
}

function assemblyLabel(assembly) {
  const what = assembly.oligomericDetails || (assembly.details ?? '').replace(/_/g, ' ') || 'assembly';
  return `Assembly ${assembly.id}: ${what}`;
}

const sentence = (text) => String(text ?? '').replace(/\s+\)/g, ')').replace(/\s+/g, ' ').trim();

// A chain's or entity's description as a name: Proteoscope's title case for names written in
// capitals, and a nucleic acid's sequence ("DNA (5'-D(*TP*TP*TP*...)-3')") as its kind.
export function moleculeName(text) {
  const value = sentence(text);
  if (/^(DNA|RNA)\s*\(5'/i.test(value)) return value.slice(0, 3).toUpperCase();
  // Old entries wrap the name: "PROTEIN (COAGULATION FACTOR IX)".
  const wrapped = /^protein\s*\((.+)\)$/i.exec(value);
  if (wrapped) return moleculeName(wrapped[1]);
  return sentence(titleCase(value)).replace(/\bNmr\b/g, 'NMR').replace(/\b(Ix|Viii|Vii|Xi|Xii|Xiii)(a?)\b/g, (m, numeral, active) => numeral.toUpperCase() + active);
}

// "HOMO SAPIENS" → "Homo sapiens".
const organismName = (text) => {
  const value = sentence(text);
  return value === value.toUpperCase() ? value.charAt(0) + value.slice(1).toLowerCase() : value;
};

const methodName = (text) => {
  const value = sentence(text).toLowerCase();
  return value.charAt(0).toUpperCase() + value.slice(1).replace(/\bnmr\b/g, 'NMR').replace(/\bx-ray\b/g, 'X-ray');
};

const plural = (n, word, many = `${word}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? word : many}`;

// A residue's name as a label: "Cys 182 · A".
export function residueLabel(residue) {
  if (!residue) return '';
  const name = residue.resName.length === 3 ? residue.resName[0] + residue.resName.slice(1).toLowerCase() : residue.resName;
  return `${name} ${residue.resSeq}${residue.iCode || ''} · ${residue.chain}`;
}

// Residues in words: runs of three or more in a chain as ranges ("Thr 159–Asn 214 · A"), the
// others one by one ("Cys 42 · A"), in the order given.
export function residueRuns(residues) {
  const out = [];
  let run = [];
  const flush = () => {
    if (run.length >= 3) out.push(`${residueLabel(run[0]).split(' · ')[0]}–${residueLabel(run.at(-1))}`);
    else out.push(...run.map(residueLabel));
    run = [];
  };
  for (const residue of residues) {
    const last = run.at(-1);
    if (last && (residue.chain !== last.chain || residue.resSeq !== last.resSeq + 1 || residue.iCode || last.iCode)) flush();
    run.push(residue);
  }
  flush();
  return out;
}

// Each polymer chain: its kind, description, the residues observed (first and last, by the file's
// numbering) and the UniProt entry it names, if any.
export function chainSummaries(structure) {
  const model = structure.models[0];
  return structure.chains.filter((c) => c.polymerKind).map((chain) => {
    const residues = model.residues.filter((r) => r.chain === chain.id && (r.kind === 'protein' || r.kind === 'nucleic'));
    const uniprot = structure.sequences.get(chain.id)?.uniprot ?? [];
    return {
      id: chain.id,
      kind: chain.polymerKind,
      description: moleculeName(chain.description),
      residues: residues.length,
      first: residues[0] ? `${residues[0].resSeq}${residues[0].iCode || ''}` : '',
      last: residues.at(-1) ? `${residues.at(-1).resSeq}${residues.at(-1).iCode || ''}` : '',
      uniprot: uniprot.map((u) => ({ accession: u.accession, from: u.dbBegin, to: u.dbEnd })),
    };
  });
}

// The structure in words: what it is, how it was determined, its chains and what else it holds.
export function describeStructure(structure) {
  const meta = structure.meta ?? {};
  const model = structure.models[0];
  const lines = [];
  const [, code, rest] = /^([^:]+): (.*)$/.exec(sentence(meta.title)) ?? [];
  const title = code ? `${code}: ${moleculeName(rest)}` : sentence(meta.title) || structure.label;
  lines.push(`${title}.`);
  const resolution = Number.parseFloat(meta.resolution);
  const organism = meta.organism ? `; ${organismName(meta.organism)}` : '';
  if (meta.isPredicted) lines.push(`A predicted model, not an experimental structure${meta.confidenceSource ? `: each residue carries its confidence, ${meta.confidenceSource}` : ''}${organism}.`);
  else if (meta.method) lines.push(`${methodName(meta.method)}${Number.isFinite(resolution) ? `, ${resolution} Å` : ''}${organism}.`);
  const chains = chainSummaries(structure);
  const proteins = chains.filter((c) => c.kind === 'protein');
  const nucleic = chains.filter((c) => c.kind === 'nucleic');
  const parts = [];
  if (proteins.length) parts.push(plural(proteins.length, 'protein chain'));
  if (nucleic.length) parts.push(plural(nucleic.length, 'nucleic-acid chain'));
  const ligands = new Set(model.residues.filter((r) => r.kind === 'ligand').map((r) => r.resName));
  const ions = new Set(model.residues.filter((r) => r.kind === 'ion').map((r) => r.resName));
  if (ligands.size) parts.push(`${plural(ligands.size, 'ligand')} (${[...ligands].join(', ')})`);
  if (ions.size) parts.push(`${ions.size === 1 ? 'an ion' : `${ions.size} ions`} (${[...ions].join(', ')})`);
  if (parts.length) lines.push(`${capitalize(parts.join(', '))}; ${plural(model.atoms.length, 'atom')}${structure.models.length > 1 ? ` in each of ${structure.models.length} models` : ''}.`);
  for (const c of chains) {
    const where = c.uniprot.map((u) => `UniProt ${u.accession} ${u.from}–${u.to}`).join(', ');
    lines.push(`Chain ${c.id}: ${c.description || c.kind}, ${plural(c.residues, 'residue')} observed${c.first ? ` (${c.first}–${c.last})` : ''}${where ? `, ${where}` : ''}.`);
  }
  return lines;
}

const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

// An AlphaFold DB model named as its entry names it: the protein, its gene and organism, the
// model's version and when it was made (meta.title, meta.organism, meta.version).
export function applyAlphafoldEntry(structure, entry) {
  if (!entry) return structure;
  const meta = structure.meta;
  const gene = entry.gene ? ` (${entry.gene})` : '';
  if (entry.uniprotDescription) meta.title = `${entry.entryId ?? meta.code}: ${entry.uniprotDescription}${gene}`;
  if (entry.organismScientificName) meta.organism = entry.organismScientificName;
  meta.method = `AlphaFold DB model, version ${entry.latestVersion}`;
  meta.version = entry.latestVersion;
  if (entry.modelCreatedDate) meta.depositionDate = String(entry.modelCreatedDate).slice(0, 10);
  return structure;
}
