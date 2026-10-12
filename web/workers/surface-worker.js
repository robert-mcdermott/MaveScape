// Molecular surfaces and solvent-accessible areas of a structure, off the page (wave 5, slice 1).
// Protocol (web/ui/workers.js): { id, type: 'surface', payload: { positions, radii, options } } →
// { id, result: { positions, normals, indices, atoms, spacing, timings } }; type 'sasa' → the area
// of each atom; type 'sasa-groups' → each atom's area in the whole and in its group alone.
// Adapted from Proteoscope 0.10.0 (web/lib/surface-worker.js, Apache-2.0, the same author): the
// same requests, without the Coulombic potential and structural alignment MaveScape does not use.

import { buildSurface, computeGroupedSASA, computeSASA } from '../lib/structure/surface.js';

self.onmessage = (event) => {
  const { id, type, payload = {} } = event.data ?? {};
  try {
    if (type === 'surface') {
      const surface = buildSurface(payload.positions, payload.radii, payload.options ?? {});
      self.postMessage({ id, result: surface }, [surface.positions.buffer, surface.normals.buffer, surface.indices.buffer, surface.atoms.buffer]);
      return;
    }
    if (type === 'sasa') {
      const sasa = computeSASA(payload.positions, payload.radii, payload.options ?? {});
      self.postMessage({ id, result: sasa }, [sasa.buffer]);
      return;
    }
    if (type === 'sasa-groups') {
      const { complex, isolated } = computeGroupedSASA(payload.positions, payload.radii, payload.groups, payload.options ?? {});
      self.postMessage({ id, result: { complex, isolated } }, [complex.buffer, isolated.buffer]);
      return;
    }
    throw new Error(`Unknown surface worker request "${type}"`);
  } catch (error) {
    self.postMessage({ id, error: String(error?.message ?? error) });
  }
};
