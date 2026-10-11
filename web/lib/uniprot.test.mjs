import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { normalizeAccession, speciesOf, placeTarget, placementPatch, readUniProtEntry, referenceOf, retrievalOf, retrievalText, uniparcEntries } from './uniprot.js';

// UniProt's own answers, as MaveScape's fetcher cached them (validation/fixtures/public-data).
const fixture = (path) => JSON.parse(readFileSync(new URL(`../../validation/fixtures/public-data/${path}`, import.meta.url), 'utf8'));
const entry = (accession) => readUniProtEntry(fixture(`uniprot/${accession}.json`));
const exampleTarget = (id) => JSON.parse(readFileSync(new URL(`../examples/${id}/design.json`, import.meta.url), 'utf8')).targets[0];

test('accessions as UniProt writes them; anything else is not one', () => {
  assert.equal(normalizeAccession(' p62993 '), 'P62993');
  assert.equal(normalizeAccession('P62993-2'), 'P62993-2');
  assert.equal(normalizeAccession('A0A024R161'), 'A0A024R161');
  for (const text of ['GRB2', 'GRB2_HUMAN', 'P6299', '', null, 'NM_002086.5']) assert.equal(normalizeAccession(text), null, text);
});

test('an entry: its names, organism and sequence; an inactive accession says where it went', () => {
  const grb2 = entry('P62993');
  assert.equal(grb2.accession, 'P62993');
  assert.equal(grb2.entryName, 'GRB2_HUMAN');
  assert.equal(grb2.reviewed, true);
  assert.equal(grb2.name, 'Growth factor receptor-bound protein 2');
  assert.equal(grb2.gene, 'GRB2');
  assert.equal(grb2.organism, 'Homo sapiens');
  assert.equal(grb2.length, 217);
  assert.equal(entry('P02829').gene, 'HSP82');
  assert.equal(entry('P02829').organism, 'Saccharomyces cerevisiae (strain ATCC 204508 / S288c)');
  assert.equal(speciesOf(entry('P02829').organism), 'Saccharomyces cerevisiae');
  const split = readUniProtEntry({ entryType: 'Inactive', primaryAccession: 'P29354', inactiveReason: { inactiveReasonType: 'DEMERGED', mergeDemergeTo: ['P62993', 'P62994'] } });
  assert.match(split.problem, /P29354 is no longer a UniProt entry: split into P62993 and P62994/);
  assert.deepEqual(split.replacedBy, ['P62993', 'P62994']);
  assert.match(readUniProtEntry({ error: 'x' }).problem, /not an entry/);
});

test('each published example\'s target sits at its stated offset in its UniProt entry, identical', () => {
  for (const [id, accession] of [['grb2-sh3', 'P62993'], ['hsp90', 'P02829'], ['factor9', 'P00740']]) {
    const target = exampleTarget(id);
    const placement = placeTarget(target, entry(accession));
    assert.equal(placement.offset, target.offset, id);
    assert.equal(placement.identical, true, id);
    assert.equal(placement.places, 1, id);
    assert.deepEqual(placement.differences, [], id);
    assert.deepEqual(placementPatch(target, entry(accession), placement), {}, `${id}: nothing to change`);
  }
  const grb2 = placeTarget(exampleTarget('grb2-sh3'), entry('P62993'));
  assert.equal(grb2.start, 159);
  assert.equal(grb2.end, 214);
});

test('a construct: a substitution is a difference, a tag hangs over the end, another protein is not placed', () => {
  const reference = entry('P62993');
  const domain = exampleTarget('grb2-sh3').sequence;
  const changed = placeTarget({ sequenceType: 'protein', sequence: `${domain.slice(0, 9)}A${domain.slice(10)}` }, reference);
  assert.equal(changed.offset, 158);
  assert.equal(changed.identical, false);
  assert.deepEqual(changed.differences, [{ position: 10, target: 'A', reference: 'D' }]);
  const tagged = placeTarget({ sequenceType: 'protein', sequence: `HHHHHH${domain}` }, { ...reference, sequence: reference.sequence.slice(158) });
  assert.equal(tagged.offset, -6);
  assert.deepEqual(tagged.outside, [1, 2, 3, 4, 5, 6]);
  assert.match(placeTarget({ sequenceType: 'protein', sequence: 'WWWWWWWWWWWWWWWWWWWW' }, reference).problem, /fewer than 80%/);
  // A short repeat: more than one place agrees as well.
  const repeat = placeTarget({ sequenceType: 'protein', sequence: 'GKDG' }, { accession: 'X', sequence: 'MGKDGAAGKDGM' });
  assert.equal(repeat.places, 2);
  assert.deepEqual(repeat.alternatives, [2, 8]);
});

test('a DNA target is placed by the protein it encodes, without its stop', () => {
  const placement = placeTarget({ sequenceType: 'dna', codingStart: 1, sequence: 'ACATATGTGCAAGCTCTTTTCTAA' }, entry('P62993'));
  assert.equal(placement.length, 7);
  assert.equal(placement.identical, true);
  assert.equal(placement.start, 159);
});

test('what placing a target changes: the offset, identifiers and organism it lacked; notes on differences kept', () => {
  const reference = entry('P62993');
  const bare = { id: 't', name: 'SH3', sequenceType: 'protein', sequence: exampleTarget('grb2-sh3').sequence, offset: 0, differences: [{ position: 3, target: 'V', reference: 'V', note: 'cloning' }] };
  const patch = placementPatch(bare, reference, placeTarget(bare, reference));
  assert.equal(patch.offset, 158);
  assert.deepEqual(patch.identifiers, { uniprot: 'P62993', gene: 'GRB2' });
  assert.equal(patch.organism, 'Homo sapiens');
  assert.ok('differences' in patch && patch.differences === undefined, 'no differences left: the field is cleared');
  const changed = { ...bare, sequence: `${bare.sequence.slice(0, 2)}A${bare.sequence.slice(3)}` };
  assert.deepEqual(placementPatch(changed, reference, placeTarget(changed, reference)).differences, [{ position: 3, target: 'A', reference: 'V', note: 'cloning' }]);
});

test('the record a check leaves: the entry, its release and retrieval, where the target sat', () => {
  const header = { 'X-MaveScape-Service': 'UniProt', 'X-MaveScape-Source': 'https://rest.uniprot.org/uniprotkb/P62993.json', 'X-MaveScape-Retrieved': '2026-10-10T17:35:33Z', 'X-MaveScape-Version': '2026_03', 'X-MaveScape-Cache': 'hit' };
  const retrieval = retrievalOf((name) => header[name] ?? null);
  assert.deepEqual(retrieval, { service: 'UniProt', source: 'https://rest.uniprot.org/uniprotkb/P62993.json', retrieved: '2026-10-10T17:35:33Z', checked: null, version: '2026_03', etag: null, cache: 'hit' });
  const reference = entry('P62993');
  const record = referenceOf(reference, retrieval, placeTarget(exampleTarget('grb2-sh3'), reference));
  assert.deepEqual(record, { database: 'UniProtKB', accession: 'P62993', entryName: 'GRB2_HUMAN', release: '2026_03', retrieved: '2026-10-10T17:35:33Z', url: 'https://rest.uniprot.org/uniprotkb/P62993.json', length: 217, offset: 158, start: 159, end: 214, identical: true, differences: 0 });
  assert.equal(retrievalText(record), 'release 2026_03, retrieved 2026-10-10');
  assert.equal(retrievalText({}), '');
});

test('a sequence\'s UniProt entries: active, reviewed first, an isoform only when its entry is not there', () => {
  const file = readdirSync(new URL('../../validation/fixtures/public-data/uniparc/', import.meta.url)).find((f) => !f.endsWith('.meta.json'));
  const { uniparc, entries } = uniparcEntries(fixture(`uniparc/${file}`));
  assert.equal(uniparc, 'UPI000004EF93');
  assert.equal(entries[0].accession, 'P62993');
  assert.equal(entries[0].reviewed, true);
  assert.equal(entries[0].organism, 'Homo sapiens');
  assert.ok(!entries.some((e) => e.accession === 'P62993-1'), 'the canonical isoform is the entry itself');
  const firstUnreviewed = entries.findIndex((e) => !e.reviewed);
  assert.ok(firstUnreviewed > 0 && entries.slice(firstUnreviewed).every((e) => !e.reviewed), 'reviewed entries first');
  assert.deepEqual(uniparcEntries({}).entries, []);
  const isoform = uniparcEntries({ uniParcCrossReferences: [{ database: 'UniProtKB/Swiss-Prot protein isoforms', id: 'P04637-2', active: true }, { database: 'UniProtKB/TrEMBL', id: 'Q1', active: false }] });
  assert.deepEqual(isoform.entries.map((e) => [e.accession, e.isoform]), [['P04637-2', true]]);
});
