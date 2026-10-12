// Copied from Proteoscope 0.10.0 (web/lib/coloring.js, Apache-2.0, the same author), unchanged
// but for the color schemes of data MaveScape does not read (validation reports, density maps,
// superposition, proteomics, prediction sets): MaveScape's structure viewer
// (mavescape-spec/design.md, "The Structure view"). Fixes are carried across.

import {
  BACKGROUNDS,
  COLORMAPS,
  MOLECULE_KIND_COLORS,
  NUCLEOBASE_COLORS,
  PLDDT_BANDS,
  RESIDUE_CLASS_COLORS,
  SECONDARY_COLORS,
  chainPaletteColor,
  hexColor,
  plddtColor,
  sampleColormap,
} from './colors.js';
import { elementInfo } from './elements.js';
import { HYDROPHOBIC, KYTE_DOOLITTLE, NEGATIVE, POLAR, POSITIVE } from './residues.js';

export const COLOR_SCHEMES = [
  { id: 'chain', label: 'Chain', group: 'Structure' },
  { id: 'entity', label: 'Molecule (entity)', group: 'Structure' },
  { id: 'rainbow', label: 'Rainbow (N → C)', group: 'Structure' },
  { id: 'secondary', label: 'Secondary structure', group: 'Structure' },
  { id: 'moltype', label: 'Molecule type', group: 'Structure' },
  { id: 'element', label: 'Element', group: 'Chemistry' },
  { id: 'residue', label: 'Residue class', group: 'Chemistry' },
  { id: 'hydrophobicity', label: 'Hydrophobicity (Kyte-Doolittle)', group: 'Chemistry' },
  { id: 'nucleotide', label: 'Nucleotide', group: 'Chemistry' },
  { id: 'bfactor', label: 'B-factor', group: 'Quality' },
  { id: 'plddt', label: 'AlphaFold confidence (pLDDT)', group: 'Quality' },
  { id: 'uniform', label: 'Uniform', group: 'Other' },
];

const STRUCTURAL_SCHEMES = new Set(['chain', 'entity', 'rainbow', 'secondary', 'moltype', 'residue', 'hydrophobicity', 'nucleotide', 'uniform']);
const NEUTRAL = [0.5, 0.53, 0.57];
const LIGAND_CARBON = [0.36, 0.86, 0.5];

export function computeAtomColors(model, structure, settings, extras = {}) {
  const atoms = model.atoms;
  const colors = new Float32Array(Math.max(1, atoms.length) * 4);
  const scheme = settings.scheme ?? 'chain';
  const palette = settings.palette ?? 'vivid';
  const chainIndex = new Map(structure.chains.map((chain, index) => [chain.id, index]));
  const entityIndex = new Map(structure.entities.map((entity, index) => [entity.id, index]));
  const heteroByElement = settings.heteroByElement !== false;
  const overrides = extras.overrides ?? null;
  const range = resolveRange(scheme, model, settings);
  const rainbowPositions = scheme === 'rainbow' ? rainbowFractions(model) : null;
  const uniform = settings.uniformColor ? hexColor(settings.uniformColor) : [0.72, 0.76, 0.8];

  for (let index = 0; index < atoms.length; index += 1) {
    const atom = atoms[index];
    const residue = model.residues[model.atomResidue[index]];
    let color;
    const polymer = atom.kind === 'protein' || atom.kind === 'nucleic';
    if (!polymer && STRUCTURAL_SCHEMES.has(scheme)) {
      color = atom.kind === 'ligand' && atom.element === 'C' ? [...LIGAND_CARBON] : [...elementInfo(atom.element).color];
    } else {
      color = schemeColor(scheme, atom, residue, {
        palette,
        chainIndex,
        entityIndex,
        range,
        rainbowPositions,
        colormap: settings.colormap,
        model,
        uniform,
      });
      if (heteroByElement && STRUCTURAL_SCHEMES.has(scheme) && atom.element !== 'C' && polymer && !isBackboneForCartoon(atom)) {
        color = [...elementInfo(atom.element).color];
      }
    }
    const override = overrides?.get(residue?.key);
    if (override) color = !heteroByElement || atom.element === 'C' || atom.name === 'P' ? override : [...elementInfo(atom.element).color];
    const offset = index * 4;
    colors[offset] = color[0];
    colors[offset + 1] = color[1];
    colors[offset + 2] = color[2];
    colors[offset + 3] = 1;
  }
  return { colors, legend: buildLegend(scheme, structure, settings, range) };
}

function isBackboneForCartoon(atom) {
  return atom.name === 'CA' || atom.name === 'P' || atom.name === "C4'" || atom.name === 'N1' || atom.name === 'N9';
}

function schemeColor(scheme, atom, residue, context) {
  switch (scheme) {
    case 'element':
      return [...elementInfo(atom.element).color];
    case 'entity': {
      const index = context.entityIndex.get(residue?.entityId || atom.entityId);
      return chainPaletteColor(index ?? context.chainIndex.get(atom.chain) ?? 0, context.palette);
    }
    case 'rainbow': {
      const t = context.rainbowPositions.get(residue?.key);
      return t === undefined ? [...NEUTRAL] : sampleColormap('rainbow', t);
    }
    case 'secondary':
      if (atom.kind === 'nucleic') return [...MOLECULE_KIND_COLORS.nucleic];
      return [...(SECONDARY_COLORS[residue?.ss] ?? SECONDARY_COLORS.coil)];
    case 'moltype':
      return [...(MOLECULE_KIND_COLORS[atom.kind] ?? NEUTRAL)];
    case 'residue':
      return residueClassColor(atom, residue);
    case 'hydrophobicity': {
      const value = KYTE_DOOLITTLE[residue?.parent];
      return value === undefined ? [...NEUTRAL] : sampleColormap('hydrophobicity', (value + 4.5) / 9);
    }
    case 'nucleotide':
      if (atom.kind === 'nucleic') return [...(NUCLEOBASE_COLORS[residue?.code] ?? NEUTRAL)];
      return [...MOLECULE_KIND_COLORS.protein];
    case 'bfactor':
      return sampleColormap(context.colormap || 'bwr', normalize(atom.bFactor, context.range));
    case 'plddt': {
      // Ligands and modified residues in AlphaFold 3, Boltz and Chai-1 models carry per-atom pLDDT.
      const perAtom = atom.kind !== 'protein' && atom.kind !== 'nucleic';
      const value = !perAtom && Number.isFinite(residue?.confidence) ? residue.confidence : confidenceScale(atom.bFactor, context.model);
      return plddtColor(value);
    }
    case 'uniform':
      return [...context.uniform];
    default:
      return chainPaletteColor(context.chainIndex.get(atom.chain) ?? 0, context.palette);
  }
}

// Some predictors write pLDDT on a 0–1 scale; the model's B-factor range tells them apart.
function confidenceScale(value, model) {
  const max = model?.bFactorRange?.max;
  return Number.isFinite(max) && max <= 1.0001 ? value * 100 : value;
}

function residueClassColor(atom, residue) {
  const name = residue?.parent ?? atom.resName;
  if (atom.kind === 'water') return [...RESIDUE_CLASS_COLORS.water];
  if (atom.kind === 'ion') return [...RESIDUE_CLASS_COLORS.ion];
  if (atom.kind === 'ligand') return [...RESIDUE_CLASS_COLORS.ligand];
  if (atom.kind === 'nucleic') return [...RESIDUE_CLASS_COLORS.nucleic];
  if (NEGATIVE.has(name)) return [...RESIDUE_CLASS_COLORS.negative];
  if (POSITIVE.has(name)) return [...RESIDUE_CLASS_COLORS.positive];
  if (POLAR.has(name)) return [...RESIDUE_CLASS_COLORS.polar];
  if (HYDROPHOBIC.has(name)) return [...RESIDUE_CLASS_COLORS.hydrophobic];
  return [...RESIDUE_CLASS_COLORS.other];
}

function rainbowFractions(model) {
  const fractions = new Map();
  const byChain = new Map();
  for (const residue of model.residues) {
    if (residue.kind !== 'protein' && residue.kind !== 'nucleic') continue;
    if (!byChain.has(residue.chain)) byChain.set(residue.chain, []);
    byChain.get(residue.chain).push(residue);
  }
  for (const residues of byChain.values()) {
    const span = Math.max(1, residues.length - 1);
    residues.forEach((residue, index) => fractions.set(residue.key, index / span));
  }
  return fractions;
}

function resolveRange(scheme, model, settings) {
  if (scheme === 'bfactor') {
    const range = settings.range ?? model.bFactorRange;
    return { min: range.min, max: range.max };
  }
  return { min: 0, max: 1 };
}

function normalize(value, range) {
  const span = range.max - range.min;
  if (!Number.isFinite(value) || Math.abs(span) < 1e-9) return 0.5;
  return Math.min(1, Math.max(0, (value - range.min) / span));
}

function buildLegend(scheme, structure, settings, range) {
  const palette = settings.palette ?? 'vivid';
  switch (scheme) {
    case 'chain': {
      const chains = structure.chains.filter((chain) => chain.polymerKind);
      if (chains.length < 2 || chains.length > 16) return null;
      return {
        type: 'categorical',
        title: 'Chains',
        items: chains.map((chain) => ({
          label: `${chain.id}${chain.description ? ` · ${truncate(titleCase(chain.description), 28)}` : ''}`,
          color: chainPaletteColor(structure.chains.indexOf(chain), palette),
        })),
      };
    }
    case 'entity':
      if (!structure.entities.length || structure.entities.length > 16) return null;
      return {
        type: 'categorical',
        title: 'Molecules',
        items: structure.entities
          .filter((entity) => entity.type !== 'water')
          .map((entity, index) => ({ label: truncate(titleCase(entity.description) || `Entity ${entity.id}`, 34), color: chainPaletteColor(index, palette) })),
      };
    case 'rainbow':
      return { type: 'gradient', title: 'Sequence position', colormap: 'rainbow', minLabel: 'N-term', maxLabel: 'C-term' };
    case 'secondary':
      return {
        type: 'categorical',
        title: 'Secondary structure',
        items: [
          { label: 'Helix', color: SECONDARY_COLORS.helix },
          { label: 'Strand', color: SECONDARY_COLORS.sheet },
          { label: 'Turn', color: SECONDARY_COLORS.turn },
          { label: 'Coil', color: SECONDARY_COLORS.coil },
        ],
      };
    case 'moltype':
      return {
        type: 'categorical',
        title: 'Molecule type',
        items: Object.entries(MOLECULE_KIND_COLORS).map(([label, color]) => ({ label: capitalize(label), color })),
      };
    case 'residue':
      return {
        type: 'categorical',
        title: 'Residue class',
        items: [
          { label: 'Hydrophobic', color: RESIDUE_CLASS_COLORS.hydrophobic },
          { label: 'Polar', color: RESIDUE_CLASS_COLORS.polar },
          { label: 'Positive', color: RESIDUE_CLASS_COLORS.positive },
          { label: 'Negative', color: RESIDUE_CLASS_COLORS.negative },
          { label: 'Nucleic acid', color: RESIDUE_CLASS_COLORS.nucleic },
          { label: 'Ligand', color: RESIDUE_CLASS_COLORS.ligand },
        ],
      };
    case 'hydrophobicity':
      return { type: 'gradient', title: 'Kyte-Doolittle hydropathy', colormap: 'hydrophobicity', minLabel: '-4.5 hydrophilic', maxLabel: '+4.5 hydrophobic' };
    case 'nucleotide':
      return {
        type: 'categorical',
        title: 'Nucleotide',
        items: ['A', 'C', 'G', 'U'].map((code) => ({ label: code === 'U' ? 'U / T' : code, color: NUCLEOBASE_COLORS[code] })),
      };
    case 'bfactor':
      return { type: 'gradient', title: 'B-factor (Å²)', colormap: settings.colormap || 'bwr', minLabel: range.min.toFixed(1), maxLabel: range.max.toFixed(1) };
    case 'plddt':
      return { type: 'categorical', title: 'pLDDT', items: PLDDT_BANDS.map((band) => ({ label: band.label, color: band.color })) };
    default:
      return null;
  }
}

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function titleCase(text) {
  const value = String(text || '');
  if (value !== value.toUpperCase()) return value;
  return value.toLowerCase().replace(/\b([a-z])/g, (match) => match.toUpperCase()).replace(/\b(Dna|Rna|Atp|Adp|Gtp|Nadh?|Ii|Iii|Iv|Hla|Mhc|Brca1|Bard1|Em|Nmr|Egfr|Her2|Kras|Pd-1|Pd-L1|Mdm2)\b/g, (match) => match.toUpperCase());
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export { BACKGROUNDS, COLORMAPS };
