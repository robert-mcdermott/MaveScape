// AlphaMissense (Cheng et al., Science 2023) as AlphaFold DB publishes it for a human UniProt
// entry (/api/fetch/alphafold/{accession}/missense): the pathogenicity of every substitution, 0 to
// 1, and its class (likely benign below 0.34, likely pathogenic above 0.564), as a variants track
// (wave 3, slice 5; requirement I4). The predictions are CC BY 4.0; not for clinical use.

import { recordOf } from './common.js';
import { predictorTrack, readPredictorTable } from './predictors.js';

export const ALPHAMISSENSE = {
  id: 'alphamissense',
  name: 'AlphaMissense',
  kind: 'public',
  service: 'AlphaFold DB',
  what: 'AlphaMissense\'s pathogenicity of every substitution of a human protein',
  license: 'CC BY 4.0',
  cite: ['alphamissense', 'alphafolddb'],
  needs(target) {
    if (!target?.identifiers?.uniprot) return 'The target has no UniProt accession: give it in Experiment, Target.';
    if (target.organism && !/^homo sapiens$/i.test(target.organism.trim())) return `AlphaMissense covers human proteins; the target is of ${target.organism}.`;
    return null;
  },
  async fetch(target, context, get) {
    const accession = target.identifiers.uniprot.toUpperCase().replace(/-1$/, '');
    const got = await get(`alphafold/${encodeURIComponent(accession)}/missense`, { as: 'text' });
    if (!got.ok) throw new Error(got.message);
    return { text: got.text, fileName: `AF-${accession}-F1-aa-substitutions.csv`, record: recordOf([got.retrieval], { accession, license: 'CC BY 4.0', citation: 'Cheng J, et al. Science 2023;381:eadg7492' }) };
  },
  read(text, context) {
    const read = readPredictorTable(text);
    if (read.problem) return { tracks: [], notes: [], problem: `AlphaFold DB's table: ${read.problem}` };
    return predictorTrack(read, context, { part: 'alphamissense', label: 'AlphaMissense' });
  },
};
