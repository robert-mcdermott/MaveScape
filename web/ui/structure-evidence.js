// Structure as evidence, the Structure view's part (wave 5, slice 4; requirement X4): what the
// structure shown says of each target position (lib/structure-evidence.js), computed once the target
// is mapped: the accessibility in the surface worker, a predicted model's aligned error through the
// fetcher; then the tracks it gives the map, the scores by structural class and the cluster test,
// for the pane *Structure as evidence*, the inspector, remote control and the files.

import { WorkerClient } from './workers.js';
import { fetchPublic } from './public-data.js';
import { accessibilityInput, chosenPartners, clusterTest, effectsByClass, exposureOf, paeOf, partnerDistances, partnerInteractions, partnersOf, residueAccessibility, SASA_POINTS, structureEvidence, structureTracks } from '../lib/structure-evidence.js';
import { placeOnTarget, POSITION, positionValues } from '../lib/structure-scores.js';
import { lossSide } from '../lib/readout.js';
import { originText } from '../lib/structures.js';

let worker = null;

// The evidence's state, in the view's (structureState): what it was computed for, how far, and the
// partners chosen and the cluster test's settings, kept for the session.
export function evidenceState(state) {
  state.evidence ??= { key: '', status: 'idle', message: '', result: null, partners: [], choice: 'all', fraction: 0.2, seed: 1, base: null, pae: null };
  return state.evidence;
}

// What the structure is for the evidence: its serial, assembly and the chain mapped.
const structureKey = (state) => `${state.serial}|${state.viewer?.structure?.activeAssemblyId ?? ''}`;

// Computes the evidence for the structure shown and its mapping (again only when either changed, or
// the partners chosen): resolves to the evidence state. notify() is called as it goes.
export async function computeEvidence(app, state, { notify = () => {} } = {}) {
  const ev = evidenceState(state);
  const viewer = state.viewer;
  const structure = viewer?.structure;
  const mapping = state.mapping;
  if (!structure || !mapping) {
    Object.assign(ev, { key: '', status: 'idle', result: null, message: '' });
    return ev;
  }
  const key = `${structureKey(state)}|${mapping.chain}|${state.mapKey}|${ev.choice}`;
  if (ev.key === key && (ev.status === 'ready' || ev.status === 'computing')) return ev.pending ?? ev;
  ev.key = key;
  ev.status = 'computing';
  ev.message = 'Reading what the structure says of each position: accessibility, exposure, partners…';
  notify();
  ev.pending = (async () => {
    try {
      const model = viewer.model;
      // The accessibility and exposure belong to the structure (and assembly); the partners to the
      // chain and the choice.
      if (ev.base?.key !== structureKey(state)) {
        const input = accessibilityInput(model);
        worker ??= new WorkerClient('../workers/surface-worker.js', { max: 1 });
        const areas = await worker.call('sasa-groups', { positions: input.positions, radii: input.radii, groups: input.groups, options: { points: SASA_POINTS } }, { transfer: [input.positions.buffer, input.radii.buffer, input.groups.buffer] });
        // A predicted model's aligned error, through the fetcher (AlphaFold DB's models).
        let pae = null;
        let paeNote = '';
        const origin = state.origin;
        if (structure.meta.isPredicted && origin?.kind === 'alphafold') {
          const got = await fetchPublic(app, `alphafold/${encodeURIComponent(origin.id)}/pae/${origin.version}`);
          if (got.ok) {
            pae = paeOf(got.json, model);
            paeNote = pae ? '' : 'its aligned error does not cover the model\'s residues';
          } else paeNote = got.message;
        } else if (structure.meta.isPredicted) paeNote = 'no aligned error was given with it';
        ev.base = { key: structureKey(state), accessibility: residueAccessibility(input, areas), exposure: exposureOf(model, pae), pae: Boolean(pae), paeNote, paeRetrieval: null };
      }
      if (ev.key !== key) return ev;
      const partners = partnersOf(model, structure, mapping.chain);
      if (ev.choice !== 'all' && !partners.some((p) => p.id === ev.choice)) ev.choice = 'all';
      const chosen = chosenPartners(partners, ev.choice);
      const distances = partnerDistances(model, mapping.chain, chosen);
      const interactions = new Map();
      for (const p of chosen) {
        // Typed only where the partner touches the chain.
        if (![...distances.values()].some((d) => d.partner === p.id && d.distance <= 4)) continue;
        for (const [k, list] of partnerInteractions(model, mapping.chain, p)) interactions.set(k, [...(interactions.get(k) ?? []), ...list]);
      }
      const result = structureEvidence({ model, mapping, accessibility: ev.base.accessibility, exposure: ev.base.exposure, distances, interactions, predicted: Boolean(structure.meta.isPredicted) });
      if (ev.key !== key) return ev;
      Object.assign(ev, { status: 'ready', message: '', result, partners, chosen: chosen.map((p) => p.id), pae: ev.base.pae, paeNote: ev.base.paeNote });
    } catch (error) {
      if (ev.key === key) Object.assign(ev, { status: 'failed', message: `What the structure says could not be read: ${error.message}`, result: null });
    } finally {
      if (ev.key === key) ev.pending = null;
      notify();
    }
    return ev;
  })();
  return ev.pending;
}

// The positions' values the evidence is read by: each position's median score (the map's run and
// condition), on the mapped target; and whether lower is the loss side.
export function evidenceValues(state, from) {
  if (!from?.ok || !state.mapTarget) return null;
  let values;
  try {
    values = placeOnTarget(positionValues(from.model, 'median'), state.mapTarget);
  } catch {
    return null;
  }
  if (!values) return null;
  const valueAt = (q) => (values.state[q - 1] === POSITION.VALUE || values.state[q - 1] === POSITION.LOW ? values.value[q - 1] : Number.NaN);
  const side = from.model.contrast ? 'below' : lossSide(from.run.inputs.design).side;
  return { valueAt, lossBelow: side !== 'above', words: from.words, contrast: Boolean(from.model.contrast) };
}

// The scores by structural class and the cluster test, for the evidence and the values.
export function evidenceStatistics(ev, values) {
  if (ev.status !== 'ready' || !ev.result || !values) return null;
  return {
    effects: effectsByClass(ev.result, values.valueAt, { lossBelow: values.lossBelow }),
    clusters: clusterTest(ev.result, values.valueAt, { fraction: ev.fraction, seed: ev.seed, lossBelow: values.lossBelow }),
  };
}

// The structure's tracks for a map model, when the evidence is ready and the map's target is the
// protein mapped (lib/tracks.js shapes; the Map view and remote control add them to a run's).
export function evidenceTracks(app, model) {
  const state = app.structureState;
  const ev = state?.evidence;
  if (ev?.status !== 'ready' || !ev.result || !state.viewer?.structure) return [];
  const structure = state.viewer.structure;
  const code = structure.meta.code || structure.label;
  const source = { service: originText(state.origin ? { ...state.origin, retrieval: null } : null, structure), retrieved: state.origin?.retrieval?.retrieved ?? null };
  return structureTracks(ev.result, { length: model.length, offset: model.target.offset ?? 0, protein: model.protein }, { structure: code, source });
}
