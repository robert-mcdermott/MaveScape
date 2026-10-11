import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { accessionKind, accessionTarget, countsDesign, licenseOf, mappedCSV, mappedVariants, normalizeUrn, readMapped, readoutOf, readScoreSet, scoresDesign, searchHits, targetsOf } from './mavedb.js';
import { parseTable } from './csv.js';
import { detectLayout } from './importer.js';
import { validateDesign } from './design.js';

// MaveDB's answers as MaveScape's fetcher cached them (validation/fixtures/public-data).
const fixture = (path) => readFileSync(new URL(`../../validation/fixtures/public-data/${path}`, import.meta.url));
const record = (urn) => readScoreSet(JSON.parse(fixture(`mavedb/${urn.replaceAll(':', '_')}.json`)));
const table = (urn, which) => parseTable(fixture(`mavedb/${urn.replaceAll(':', '_')}.${which}.csv`), { fileName: `${which}.csv` });
const GRB2 = 'urn:mavedb:00000835-a-1';

test('a score set\'s URN, as written or in a MaveDB address; nothing else', () => {
  assert.equal(normalizeUrn(' URN:MAVEDB:00000835-a-1 '), GRB2);
  assert.equal(normalizeUrn('https://www.mavedb.org/score-sets/urn:mavedb:00000003-a-2?tab=x'), 'urn:mavedb:00000003-a-2');
  assert.equal(normalizeUrn('urn:mavedb:00001236-0-1'), 'urn:mavedb:00001236-0-1', 'a meta-analysis');
  for (const text of ['urn:mavedb:00000835', 'urn:mavedb:00000835-a', 'tmp:6d1c4e0e-5e1b', 'GRB2', '', null]) assert.equal(normalizeUrn(text), null, text);
});

test('a record: its title, license and terms, citation, columns, target, keywords and calibrations', () => {
  const grb2 = record(GRB2);
  assert.equal(grb2.title, 'GRB2 SH3 domain domainome 1.0');
  assert.equal(grb2.license.short, 'CC0');
  assert.equal(grb2.license.open, true);
  assert.match(grb2.license.terms, /Public domain/);
  // MaveDB's reference for this preprint holds placeholders: it is written again from its fields.
  assert.equal(grb2.citation, 'Beltran T, et al. Site saturation mutagenesis of 500 human protein domains reveals the contribution of protein destabilization to genetic disease. bioRxiv 2024. doi:10.1101/2024.04.26.591310');
  assert.deepEqual(grb2.countColumns, ['input_count_rep1', 'input_count_rep2', 'input_count_rep3', 'output_count_rep1', 'output_count_rep2', 'output_count_rep3']);
  assert.equal(grb2.hasCounts, true);
  assert.deepEqual(grb2.keywords, []);
  const pten = record('urn:mavedb:00000013-a-1');
  assert.equal(pten.hasCounts, false);
  assert.match(pten.citation, /^Matreyek KA, et al\. Multiplex assessment of protein variant abundance by massively parallel sequencing\. Nat\. Genet\. 2018; 50:874-882\. doi:10\.1038\/s41588-018-0122-z$/);
  assert.deepEqual(pten.experiment.rawReads.map((r) => r.id), ['PRJNA428380']);
  // Six calibrations, among them the investigators' classes, by a class column, and ExCALIBR's,
  // research use only, with ranges and the evidence strength each assigns; one is primary.
  assert.equal(pten.calibrations.length, 6);
  assert.deepEqual(pten.calibrations.filter((c) => c.primary).map((c) => c.title), ['IGVF Coding Variant Focus Group -- Controls: All Variants']);
  const [classes, excalibr] = pten.calibrations;
  assert.equal(classes.investigatorProvided, true);
  assert.deepEqual(classes.classes.map((c) => [c.label, c.className, c.byClassColumn]), [['wt-like', 'WT-like (normal)', true], ['possibly_wt-like', 'WT-like (normal)', true], ['possibly_low', 'abnormal-like (abnormal)', true], ['low', 'abnormal-like (abnormal)', true]]);
  assert.equal(excalibr.researchUseOnly, true);
  const moderate = excalibr.classes.find((c) => c.label === 'PS3 Moderate (2)');
  assert.deepEqual(moderate.evidence, { criterion: 'PS3', strength: 'moderate', points: 2 });
  assert.equal(moderate.range[0], 0.4573227064747745);
  // CC BY: free use with credit.
  const bap1 = record('urn:mavedb:00000662-a-2');
  assert.equal(bap1.license.short, 'CC BY 4.0');
  assert.match(bap1.license.terms, /crediting the authors/);
  // Its target is a transcript, fetched when it is opened (wave 3, slice 3).
  assert.deepEqual(targetsOf(bap1).pending.map((p) => [p.kind, p.accession, p.gene]), [['ensembl', 'ENST00000460680.5', 'BAP1']]);
  assert.deepEqual(targetsOf(bap1).problems, []);
  assert.match(licenseOf({ shortName: 'CC BY-NC-SA 4.0', longName: 'CC BY-NC-SA 4.0 (Attribution-NonCommercial-ShareAlike)' }).terms, /Non-commercial use only/);
  assert.equal(licenseOf({ shortName: 'CC BY-NC-SA 4.0' }).open, false);
  assert.match(licenseOf({ shortName: 'Other', longName: 'Custom terms', link: 'https://example.org/terms' }).terms, /read its terms before using the data \(https:\/\/example\.org\/terms\)/);
});

test('targets: the sequence, organism (with its taxonomy id) and identifiers, the UniProt offset as the target\'s', () => {
  assert.deepEqual(targetsOf(record(GRB2)).targets, [{ id: 'GRB2-SH3-domain', name: 'GRB2 SH3 domain', sequenceType: 'protein', sequence: 'TYVQALFDFDPQEDGELGFRRGDFIHVMDNSDPNWWKGACHGQTGMFPRNYVTPVN', offset: 158, organism: 'Homo sapiens', taxonomyId: 9606, identifiers: { uniprot: 'P62993' } }]);
  const hsp90 = targetsOf(record('urn:mavedb:00000011-a-1')).targets[0];
  assert.equal(hsp90.sequenceType, 'dna');
  assert.equal(hsp90.codingStart, 1);
  assert.equal(hsp90.offset, 581, 'UniProt\'s offset is in residues, for a DNA target too');
  assert.equal(targetsOf(record('urn:mavedb:00000003-a-1')).targets[0].sequence.length, 909);
});

test('the readout and library method from the experiment\'s keywords; none from a record without', () => {
  assert.deepEqual(readoutOf(record('urn:mavedb:00001200-a-1')), { readout: { method: 'Reporter', mechanism: 'Loss of function', modelSystem: 'Immortalized human cells' }, libraryMethod: 'Microarray synthesis', unknown: [] });
  const pten = readoutOf(record('urn:mavedb:00000013-a-1'));
  assert.equal(pten.libraryMethod, 'Oligo-directed mutagenic PCR');
  assert.equal(pten.readout.phenotype, 'Regulation of protein stability');
  assert.deepEqual(readoutOf(record(GRB2)), { readout: {}, libraryMethod: null, unknown: [] });
  // "Other", described: the description is the term (wave 3, slice 4).
  const other = readoutOf({ keywords: [{ key: 'Phenotypic Assay Method', label: 'Other', description: 'Yeast two-hybrid' }] });
  assert.deepEqual(other, { readout: { method: 'Yeast two-hybrid' }, libraryMethod: null, unknown: ['Phenotypic Assay Method: Yeast two-hybrid'] });
});

test('what a deposit of a record says again: its texts, publications, contributors and columns', () => {
  const grb2 = record(GRB2);
  assert.match(grb2.experiment.method, /^Oligonucleotide libraries encoding the domains/);
  assert.equal(grb2.experiment.urn, 'urn:mavedb:00000835-a');
  assert.ok(grb2.abstract.length > 100);
  assert.deepEqual(grb2.columns, { scores: {}, counts: {} });
  assert.ok(grb2.publications.length >= 1 && grb2.publications.every((p) => p.db && p.id));
  assert.ok(Array.isArray(grb2.contributors) && Array.isArray(grb2.dois));
});

test('the published scores\' design and the counts\' draft, each valid for its table', () => {
  const grb2 = record(GRB2);
  const target = targetsOf(grb2).targets[0];
  const scores = table(GRB2, 'scores');
  const layout = detectLayout(scores);
  const published = scoresDesign(grb2, { table: scores, layout, target });
  assert.equal(published.model, 'scores');
  assert.deepEqual(published.scores, { score: 'score', se: 'sigma' });
  assert.deepEqual(published.source, { mavedb: GRB2, citation: grb2.citation, license: 'CC0' });
  assert.deepEqual(published.ignoredColumns.map((c) => c.column), ['raw_score', 'raw_sigma']);
  assert.ok(validateDesign(published, { columns: scores.columns.map((c) => c.name) }).ok);
  const counts = table(GRB2, 'counts');
  const { design } = countsDesign(grb2, { table: counts, layout: detectLayout(counts), target });
  assert.equal(design.model, 'two-population');
  assert.equal(design.replicates.length, 3);
  assert.equal(design.name, 'GRB2 SH3 domain domainome 1.0');
  assert.deepEqual(design.targets, [target]);
  assert.ok(validateDesign(design, { columns: counts.columns.map((c) => c.name) }).ok);
});

test('search results: each score set\'s URN, title, targets, license and size', () => {
  const file = readFileSync(new URL('../../validation/fixtures/public-data/mavedb-search/', import.meta.url).pathname + '2f0e48c8d6af5cfef56fd7af7678956d19de5e3c24ad4336e466a0a75ca41cd3.json');
  const { total, hits } = searchHits(JSON.parse(file));
  assert.equal(total, 1);
  assert.deepEqual({ ...hits[0], publication: hits[0].publication.slice(0, 7) }, { urn: GRB2, title: 'GRB2 SH3 domain domainome 1.0', shortDescription: 'Stability measurements of the GRB2 SH3 domain from domainome 1.0.', targets: ['GRB2 SH3 domain'], organism: 'Homo sapiens', accessionTarget: false, license: 'CC0', variants: 1121, published: '2024-05-17', publication: 'Beltran' });
  assert.deepEqual(searchHits({}), { total: 0, hits: [] });
});

// Wave 3, slice 3: targets named by a transcript, several targets, mapped variants.
test('a target named by a transcript: NCBI\'s GenBank record or Ensembl\'s sequence, read as the target', () => {
  const pending = { kind: 'refseq', accession: 'NM_000001.1', name: 'GENE', gene: 'GENE', identifiers: {}, offset: 0 };
  const genbank = 'LOCUS       NM_000001                 27 bp    mRNA    linear   PRI 01-JAN-2026\nDEFINITION  A gene, mRNA.\nACCESSION   NM_000001\nVERSION     NM_000001.1\nFEATURES             Location/Qualifiers\n     CDS             4..24\n                     /gene="GENE"\n                     /protein_id="NP_000001.1"\n                     /translation="MAKKGW"\nORIGIN\n        1 gggatggcta aaaaaggctg gtaaccc\n//\n';
  const made = accessionTarget(pending, genbank, { retrieval: { retrieved: '2026-10-11T00:00:00Z' } });
  assert.deepEqual([made.target.codingStart, made.target.sequence.length, made.target.identifiers], [4, 27, { gene: 'GENE', refseq: 'NM_000001.1', protein: 'NP_000001.1' }]);
  assert.deepEqual([made.origin.service, made.origin.accession, made.origin.check.status], ['NCBI', 'NM_000001.1', 'identical']);
  const ensembl = accessionTarget({ ...pending, kind: 'ensembl', accession: 'ENST00000000001.5' }, { id: 'ENST00000000001', version: 6, seq: 'gggATGGCTAAATAAccc' });
  assert.deepEqual([ensembl.target.codingStart, ensembl.target.identifiers.ensembl, ensembl.origin.accession, ensembl.origin.versionDiffers], [4, 'ENST00000000001.5', 'ENST00000000001.6', true]);
  assert.match(ensembl.messages[0].message, /Ensembl's current release has ENST00000000001\.6/);
  assert.match(accessionTarget(pending, 'nothing').problem, /could not be read/);
  assert.equal(accessionKind('NC_000017.11'), 'genome');
  assert.equal(accessionKind('ENSP00000269305.4'), 'protein');
});

test('several targets: one opened at a time; a transcript named beside its protein is one target', () => {
  const record = (targets) => readScoreSet({ urn: 'urn:mavedb:00000001-a-1', title: 'T', license: { shortName: 'CC0' }, targetGenes: targets, datasetColumns: {}, experiment: {} });
  const seq = (name) => ({ name, category: 'protein_coding', targetSequence: { sequence: 'ATGAAATAA', sequenceType: 'dna', label: name } });
  const two = record([seq('LMNA'), seq('CCM2')]);
  assert.deepEqual(targetsOf(two).choices.map((c) => c.label), ['LMNA', 'CCM2']);
  assert.deepEqual(targetsOf(two).targets, []);
  const one = targetsOf(two, { target: 'CCM2' });
  assert.deepEqual([one.targets.map((t) => t.name), one.others], [['CCM2'], ['LMNA']]);
  const pair = targetsOf(record([{ name: 'TP53', targetAccession: { accession: 'ENST00000269305.9' } }, { name: 'TP53', targetAccession: { accession: 'ENSP00000269305.4' } }]));
  assert.deepEqual([pair.choices.length, pair.pending[0].accession, pair.pending[0].protein], [0, 'ENST00000269305.9', 'ENSP00000269305.4']);
});

test('MaveDB\'s mapped variants: the current mappings, kept as a table and read back', () => {
  const rows = mappedVariants([
    { variantUrn: 'urn:mavedb:00000835-a-1#1', current: true, clingenAlleleId: null, alignmentLevel: 'protein', postMapped: { id: 'ga4gh:VA.abc', expressions: [{ syntax: 'hgvs.p', value: 'NP_002077.1:p.Thr159Ter' }] } },
    { variantUrn: 'urn:mavedb:00000835-a-1#1', current: false, postMapped: { id: 'ga4gh:VA.old' } },
  ]);
  assert.deepEqual(rows, [{ urn: 'urn:mavedb:00000835-a-1#1', vrs: 'ga4gh:VA.abc', hgvs: 'NP_002077.1:p.Thr159Ter', clingen: null, level: 'protein' }]);
  const back = readMapped(parseTable(mappedCSV(rows)));
  assert.deepEqual(back.get('urn:mavedb:00000835-a-1#1'), { vrs: 'ga4gh:VA.abc', hgvs: 'NP_002077.1:p.Thr159Ter', clingen: null, level: 'protein' });
});
