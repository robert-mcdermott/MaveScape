// Inputs for the sorted-bin checks of the suite `scoring` (wave 2, slice 3): the synthetic
// sort-seq fixture (fixtures/make-sort-seq.mjs) and its truth, and factor IX's published scores
// (MaveDB urn:mavedb:00001200-a-1), whose replicate scores MultiSTEP computed as: bin frequencies
// over the variants kept, the weighted average with rank weights 0.25–1, then wild type 1 and the
// median of the lowest 5% of the kept variants 0; combined by their mean, SE = SD/√k.

import { readFileSync } from 'node:fs';
import { parseTable } from '../web/lib/csv.js';

export const sortSeqTable = () => parseTable(new Uint8Array(readFileSync(new URL('./fixtures/sort-seq.csv', import.meta.url))));
export const sortSeqDesign = () => JSON.parse(readFileSync(new URL('./fixtures/sort-seq.design.json', import.meta.url), 'utf8'));
export function sortSeqTruth() {
  const lines = readFileSync(new URL('./fixtures/sort-seq.truth.csv', import.meta.url), 'utf8').trim().split('\n').slice(1);
  return new Map(lines.map((line) => {
    const [name, shift] = line.split(',');
    return [name, Number(shift)];
  }));
}

// A replicate's bins in order, as columns of the table, with gates in log fluorescence.
export function replicateBins(table, design, replicate) {
  const bins = [...replicate.bins].sort((a, b) => a.order - b.order);
  const column = (sample) => table.columns.find((c) => c.name === design.samples.find((s) => s.id === sample).columns[0]).numeric;
  return {
    counts: bins.map((b) => column(b.sample)),
    values: bins.map((b) => b.value),
    lo: bins.map((b) => (b.lower ? Math.log(b.lower) : -Infinity)),
    hi: bins.map((b) => (b.upper ? Math.log(b.upper) : Infinity)),
  };
}

// Factor IX's published replicate score columns, by the design's replicate ids (t1-r1 …).
export const factor9Column = (replicateId) => {
  const [, tile, rep] = /t(\d)-r(\d)/.exec(replicateId);
  return `Score_Tile${tile}_BioReplicate${rep}`;
};
