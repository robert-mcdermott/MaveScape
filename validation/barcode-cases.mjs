// Inputs for the barcode checks of the suite `scoring` (wave 2, slice 4): the synthetic barcode
// fixture (fixtures/make-barcodes.mjs) with its map applied, as the import wizard applies it; the
// same counts in dms_variants' own layout (fixtures/barcodes.variant_counts.csv.gz, written by
// dms_variants itself), turned into a table of barcodes as the import wizard does; and the
// fixture's truth.

import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { parseTable } from '../web/lib/csv.js';
import { applyBarcodeMap, pivotDmsVariants } from '../web/lib/barcodes.js';

const fixture = (name) => new URL(`./fixtures/${name}`, import.meta.url);

export const barcodeDesign = () => JSON.parse(readFileSync(fixture('barcodes.design.json'), 'utf8'));

// The counts with the map applied: { table, applied (applyBarcodeMap's report) }.
export function barcodeTable() {
  const counts = parseTable(new Uint8Array(readFileSync(fixture('barcodes.csv'))));
  const map = parseTable(new Uint8Array(readFileSync(fixture('barcodes.map.csv'))));
  const applied = applyBarcodeMap(counts, 'barcode', map, 'barcode', 'hgvs_pro');
  return { table: applied.table, applied };
}

// dms_variants' variant_counts as a table of barcodes, and a design for it: each library a
// replicate, its "pre" sample the input and "post" the output.
export function dmsVariantsTable() {
  const long = parseTable(new Uint8Array(gunzipSync(readFileSync(fixture('barcodes.variant_counts.csv.gz')))));
  const pivot = pivotDmsVariants(long);
  const design = barcodeDesign();
  const libraries = [...new Set(pivot.samples.map((s) => s.library))];
  const id = (s) => `${s.sample}_${s.library}`.replace(/[^A-Za-z0-9_.-]+/g, '_');
  const sampleId = (library, sample) => id(pivot.samples.find((s) => s.library === library && s.sample === sample));
  return {
    long,
    pivot,
    design: {
      ...design,
      variants: { column: pivot.variantColumn, level: 'protein' },
      samples: pivot.samples.map((s) => ({ id: id(s), name: s.column, columns: [s.column] })),
      replicates: libraries.map((library, k) => ({ id: library, name: library, biological: k + 1, input: sampleId(library, 'pre'), output: sampleId(library, 'post') })),
      ignoredColumns: ['library', 'aa_substitutions', 'codon_substitutions'].map((c) => ({ column: c, reason: 'dms_variants\' description of the barcode, named in MAVE-HGVS beside it' })),
    },
  };
}

// Each variant's true effect, and each barcode's planted shift and place in the map.
export function barcodeTruth() {
  const rows = (name) => readFileSync(fixture(name), 'utf8').trim().split('\n').slice(1).map((line) => line.split(','));
  return {
    effects: new Map(rows('barcodes.truth.csv').map(([name, effect]) => [name, Number(effect)])),
    barcodes: new Map(rows('barcodes.barcode-truth.csv').map(([id, replicate, variant, shift, map]) => [id, { replicate: Number(replicate), variant, shift: Number(shift), map }])),
  };
}

// The fixture in Enrich2's layout: one counts file per sample (a tab-separated table of the
// barcodes it counts, its column of elements unnamed, and "count"), and a barcode map of whole
// variant sequences with no header (the fixture's codon substitutions applied to the target), as
// Enrich2's BarcodeMap reads it. [{ name, text, role }].
export function enrich2Files() {
  const design = barcodeDesign();
  const dna = design.targets[0].sequence;
  const lines = (name) => readFileSync(fixture(name), 'utf8').trim().split('\n');
  const [header, ...rows] = lines('barcodes.csv').map((line) => line.split(','));
  const files = header.slice(1).map((sample, k) => ({
    name: `${sample}.tsv`,
    text: `\tcount\n${rows.filter((r) => r[k + 1] !== 'NA').map((r) => `${r[0]}\t${r[k + 1]}`).join('\n')}\n`,
    role: 'counts',
  }));
  const sequence = (codons) => {
    const out = dna.split('');
    for (const token of codons.split(' ').filter(Boolean)) {
      const [, , site, mut] = /^([ACGT]{3})(\d+)([ACGT]{3})$/.exec(token);
      out.splice((Number(site) - 1) * 3, 3, ...mut);
    }
    return out.join('');
  };
  const map = lines('barcodes.map.csv').slice(1).map((line) => line.split(',')).map(([barcode, , codons]) => `${barcode}\t${sequence(codons ?? '')}`);
  files.push({ name: 'barcodes.map.txt', text: `${map.join('\n')}\n`, role: 'map' });
  return files;
}
