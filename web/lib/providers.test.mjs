import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PROVIDERS, annotationTracks, providerById, providerForFile } from './providers/index.js';
import { readUniProtFeatures } from './providers/uniprot-features.js';
import { readGFF3 } from './providers/custom.js';
import { readPredictorTable } from './providers/predictors.js';
import { placeQuery } from './providers/alignment.js';
import { readProfile } from './providers/pdbe.js';
import { clinvarRow, readClinVarTable } from './providers/clinvar.js';
import { gnomadSubstitutions, readGnomadTable } from './providers/gnomad.js';
import { latestClinVar } from './providers/mavedb.js';
import { builtinTracks, tracksCSV } from './tracks.js';
import { cachedGet } from '../../validation/cached-fetch.mjs';
import { addAnnotation, createWorkspace, removeAnnotation, setTrackLayout } from './workspace.js';
import { readArchive, writeArchive } from './archive.js';
import { targetProtein } from './target.js';

// The fetcher's answers as MaveScape caches them, and the annotation fixtures (validation/fixtures).
const fixture = (path) => readFileSync(new URL(`../../validation/fixtures/${path}`, import.meta.url), 'utf8');
const design = (id) => JSON.parse(readFileSync(new URL(`../examples/${id}/design.json`, import.meta.url), 'utf8'));
const grb2 = design('grb2-sh3').targets[0];
const context = (target = grb2) => {
  const protein = targetProtein(target).replace(/\*$/, '');
  return { target, protein, offset: target.offset ?? 0, length: protein.length };
};

test('one interface: every provider says what it is; public ones what they need', () => {
  for (const p of PROVIDERS) {
    assert.ok(p.id && p.name && p.what && ['public', 'file'].includes(p.kind), p.id);
    assert.equal(typeof p.read, 'function', p.id);
    if (p.kind === 'public') assert.ok(typeof p.needs === 'function' && typeof p.fetch === 'function', p.id);
    else assert.equal(typeof p.accepts, 'function', p.id);
  }
  assert.equal(providerById('clinvar').needs({ identifiers: {} }), 'The target names no gene: give its symbol in Experiment, Target (as UniProt\'s check does).');
  assert.match(providerById('alphamissense').needs({ identifiers: { uniprot: 'P02829' }, organism: 'Saccharomyces cerevisiae' }), /human proteins/);
  assert.match(providerById('mavedb-annotations').needs(grb2, {}), /not of a MaveDB record/);
  assert.equal(providerById('uniprot-features').needs(grb2), null);
});

test('UniProt\'s features from its JSON and its GFF3: the same tracks, placed by the offset', () => {
  for (const [id, accession] of [['grb2-sh3', 'P62993'], ['factor9', 'P00740'], ['hsp90', 'P02829']]) {
    const target = design(id).targets[0];
    const fromJSON = providerById('uniprot-features').read(fixture(`public-data/uniprot/${accession}.features.json`), context(target));
    const fromGFF = providerById('custom').read(fixture(`annotations/${accession}.gff`), context(target));
    assert.equal(fromJSON.problem, undefined, id);
    const shape = (tracks) => tracks.map((t) => [t.part, t.features.map((f) => `${f.type} ${f.start}-${f.end}`).sort()]);
    assert.deepEqual(shape(fromGFF.tracks), shape(fromJSON.tracks), id);
  }
  const g = providerById('uniprot-features').read(fixture('public-data/uniprot/P62993.features.json'), context());
  assert.deepEqual(g.tracks[0].features, [{ type: 'Domain', start: 1, end: 56, label: 'SH3 2', clipped: true }]);
  assert.match(g.notes[0], /28 features of the entry lie beyond the target \(it covers positions 159–214\)/);
  // The entry's residues against the target's: a wrong offset is refused, not drawn.
  const wrong = providerById('uniprot-features').read(fixture('public-data/uniprot/P62993.features.json'), { ...context(), offset: 0 });
  assert.match(wrong.problem, /would be misplaced/);
  assert.equal(readUniProtFeatures(JSON.parse(fixture('public-data/uniprot/P00740.features.json'))).filter((f) => f.type === 'Binding site')[0].label, 'Ca(2+)');
});

test('PDBe-KB\'s profile: each position\'s divergence from the background, on the target', () => {
  const profile = readProfile(JSON.parse(fixture('public-data/pdbe/P62993.conservation.json')));
  assert.equal(profile.length, 216);
  assert.ok(profile.every((x) => x.divergence >= 0 && x.divergence < 1));
  const read = providerById('pdbe-conservation').read(fixture('public-data/pdbe/P62993.conservation.json'), context());
  const [track] = read.tracks;
  assert.equal(track.kind, 'values');
  assert.equal([...track.values].filter(Number.isFinite).length, 56);
  assert.equal(track.values[0], profile.find((x) => x.refPosition === 159).divergence);
});

test('AlphaMissense: every substitution of the target, its score and class as AlphaFold DB gives them', () => {
  const text = fixture('public-data/alphafold/P62993.aa-substitutions.csv');
  const read = providerById('alphamissense').read(text, context());
  const [track] = read.tracks;
  assert.equal(track.entries.length, 56 * 19);
  const lines = new Map(text.trim().split(/\r?\n/).slice(1).map((l) => l.split(',')).map(([v, x, c]) => [v, [Number(x), c]]));
  for (const e of track.entries) {
    const [x, c] = lines.get(`${e.ref}${e.position + 158}${e.alt}`);
    assert.equal(e.value, x);
    assert.equal({ LPath: 'pathogenic', Amb: 'ambiguous', LBen: 'benign' }[c], e.cls);
  }
  assert.deepEqual(track.byKey.get('p.Trp36Ala').map((e) => e.label), [`${lines.get('W194A')[0]} likely pathogenic`]);
});

test('ClinVar: the gene\'s records asked page by page, kept as one table, placed on the target', async () => {
  const get = cachedGet();
  const got = await providerById('clinvar').fetch(grb2, context(), get);
  assert.deepEqual(get.asked.map((p) => p.split('?')[0]), ['clinvar/search', 'clinvar/summary']);
  const rows = readClinVarTable(got.text);
  assert.equal(rows.length, 10);
  assert.deepEqual(rows.find((r) => r.hgvs_p === 'p.Asp168Tyr'), { accession: 'VCV004426949', variation_id: '4426949', title: 'NM_002086.5(GRB2):c.502G>T (p.Asp168Tyr)', transcript: 'NM_002086.5', hgvs_c: 'c.502G>T', hgvs_p: 'p.Asp168Tyr', classification: '', review_status: '', last_evaluated: '', consequence: 'missense variant' });
  assert.equal(got.record.gene, 'GRB2');
  assert.equal(got.record.records, 10);
  assert.match(got.record.retrieved, /^2026-10-11T/);
  const read = providerById('clinvar').read(got.text, { ...context(), record: got.record });
  const [track] = read.tracks;
  // On the target's numbering (Arg207 of GRB2 is the target's Arg49).
  assert.deepEqual(track.entries.map((e) => `${e.key} ${e.cls}`).sort(), ['p.Arg49Cys uncertain', 'p.Asp10Tyr other', 'p.Glu13Ter other']);
  assert.equal(track.entries.find((e) => e.key === 'p.Arg49Cys').stars, 1);
  // Factor IX: 553 records in two pages of summaries.
  const f9 = design('factor9').targets[0];
  const many = await providerById('clinvar').fetch({ ...f9, identifiers: { ...f9.identifiers, gene: 'F9' } }, context(f9), cachedGet());
  assert.equal(many.record.records, 553);
  assert.equal(many.record.requests, 3);
  assert.equal(clinvarRow({ title: 'NM_000133.4(F9):c.1A>G (p.Met1Val)', germline_classification: { description: 'Pathogenic', last_evaluated: '2024/01/02 00:00', review_status: 'reviewed by expert panel' } }, 'BRCA1'), null);
});

test('gnomAD: the MANE Select transcript\'s variants, frequencies from exomes and genomes joined', async () => {
  const get = cachedGet();
  const got = await providerById('gnomad').fetch(grb2, context(), get);
  assert.deepEqual(get.asked, ['gnomad/gene/GRB2', 'gnomad/transcript/ENST00000316804']);
  assert.equal(got.record.transcript, 'ENST00000316804.10');
  assert.equal(got.record.mane, 'NM_002086.5');
  const rows = readGnomadTable(got.text);
  const { items } = gnomadSubstitutions(rows);
  const answer = JSON.parse(fixture('public-data/gnomad/ENST00000316804.variants.json')).data.transcript.variants;
  for (const item of items) {
    const expected = answer.filter((v) => item.ids.includes(v.variant_id)).reduce((a, v) => a + v.joint.ac / v.joint.an, 0);
    assert.ok(Math.abs(item.value - expected) < 1e-18, item.ids.join());
  }
  const read = providerById('gnomad').read(got.text, { ...context(), record: got.record });
  assert.equal(read.tracks[0].entries.length, 54);
  assert.ok(read.tracks[0].entries.every((e) => grb2.sequence[e.position - 1] === e.ref));
});

test('MaveDB\'s annotations: joined to the run\'s variants by accession or name', () => {
  assert.equal(latestClinVar([{ namespace: 'clinvar.2025_01' }, { namespace: 'clinvar.2026_01' }, { namespace: 'gnomad' }]), '2026_01');
  const csv = 'accession,hgvs_nt,hgvs_splice,hgvs_pro,gnomad.gnomad_af,gnomad.gnomad_ac,gnomad.gnomad_an,gnomad.gnomad_id,gnomad.gnomad_version,clinvar.2026_01.clinical_significance,clinvar.2026_01.clinical_review_status\n'
    + 'urn:mavedb:1-a-1#1,c.1A>G,NA,NA,0.001,2,2000,17-1-A-G,v4.1,Pathogenic,reviewed by expert panel\n'
    + 'urn:mavedb:1-a-1#2,c.4T>C,NA,NA,NA,NA,NA,NA,NA,-,-\n'
    + 'urn:mavedb:1-a-1#3,c.99+1G>A,NA,NA,NA,NA,NA,NA,NA,Benign,criteria provided\n';
  const variants = new Map([['urn:mavedb:1-a-1#1', { key: 'p.Met1Val', position: 1 }], ['c.99+1G>A', { key: null, position: 0 }]]);
  const read = providerById('mavedb-annotations').read(csv, { ...context(), variants });
  assert.deepEqual(read.tracks.map((t) => t.label), ['ClinVar (MaveDB)', 'gnomAD (MaveDB)']);
  assert.deepEqual(read.tracks[0].entries.map((e) => [e.key, e.cls, e.stars]), [['p.Met1Val', 'pathogenic', 3]]);
  assert.equal(read.tracks[1].entries[0].value, 0.001);
  assert.deepEqual(read.notes, ['1 annotated variant not on the map (no protein position) left out.']);
});

test('the person\'s alignment: scored as an alignment, placed by its query, Stockholm and FASTA alike', () => {
  const sto = providerById('alignment').read(fixture('annotations/grb2-sh3.sto'), { ...context(), record: { file: 'grb2-sh3.sto' } });
  const fasta = providerById('alignment').read(fixture('annotations/grb2-sh3.fasta'), { ...context(), record: { file: 'grb2-sh3.fasta' } });
  assert.deepEqual([...sto.tracks[0].values], [...fasta.tracks[0].values]);
  assert.deepEqual([sto.tracks[0].alignment.first, sto.tracks[0].alignment.last], [4, 49]);
  assert.deepEqual(placeQuery('QALFDFDPQE', 'TYVQALFDFDPQEDG'), { shift: 3, overlap: 10, same: 10 });
  assert.equal(placeQuery('WWWWWWWWWWWW', 'TYVQALFDFDPQEDG'), null);
  assert.equal(providerForFile('grb2-sh3.sto', '').id, 'alignment');
  assert.equal(providerForFile('aligned.fasta', '>a\nMK-V\n>b\nMKAV\n').id, 'alignment');
  assert.equal(providerForFile('target.fasta', '>a\nMKAV\n'), null);
  assert.match(providerById('alignment').read('>x\nWWWWWWWWWWWWWW\n>y\nWWWWWWWWWWWWWW\n', context()).problem, /does not agree with the target's residues/);
});

test('predictors\' tables as they are written: AlphaMissense, EVE, a matrix, any variants with scores', () => {
  const am = readPredictorTable('uniprot_id\tprotein_variant\tam_pathogenicity\tam_class\nP62993\tT159A\t0.9\tLPath\nP00740\tM1A\t0.1\tLBen\n', { accession: 'P62993' });
  assert.deepEqual([am.layout, am.entries.length, am.entries[0].cls, am.others], ['alphamissense', 1, 'pathogenic', 1]);
  const eve = readPredictorTable('wt_aa,position,mt_aa,EVE_scores_ASM,EVE_classes_75_pct_retained_ASM\nT,159,A,0.8,Pathogenic\nY,160,W,0.2,Benign\n');
  assert.deepEqual([eve.layout, eve.entries.map((e) => `${e.ref}${e.refPosition}${e.alt}=${e.value}`)], ['eve', ['T159A=0.8', 'Y160W=0.2']]);
  const matrix = readPredictorTable(',T159,Y160,V161\nA,-1.5,-2,-0.5\nW,-3,0,-4\n');
  assert.deepEqual([matrix.layout, matrix.entries.length, matrix.entries.find((e) => e.ref === 'Y' && e.alt === 'W').value], ['matrix', 6, 0]);
  const generic = readPredictorTable('variant,my_score\np.Thr159Ala,1.5\nY160*,2\nnot a variant,3\n');
  assert.deepEqual([generic.name, generic.entries.length, generic.unread], ['my_score', 2, 1]);
  // Numbered as the reference is, or as the target is, whichever its residues agree with.
  const asTarget = providerById('predictor').read('variant,score\nT1A,0.5\nY2W,0.7\nV3K,0.1\nQ4E,0.3\nA5V,0.9\n', { ...context(), record: { file: 'mine.csv' } });
  assert.deepEqual(asTarget.tracks[0].entries.map((e) => e.key), ['p.Thr1Ala', 'p.Tyr2Trp', 'p.Val3Lys', 'p.Gln4Glu', 'p.Ala5Val']);
  assert.match(asTarget.notes.join(' '), /Numbered as the target is/);
  assert.equal(providerForFile('scores.tsv', 'protein_variant\tam_pathogenicity\nM1A\t0.5\n').id, 'predictor');
});

test('custom tracks: a table of values or stretches, GFF3 of any features; the tracks\' own table reads back', () => {
  const values = providerById('custom').read('position,stability,note\n1,0.5,a\n2,-1.25,b\n99,3,c\n', { ...context(), record: { file: 'ddg.csv' } });
  assert.deepEqual([values.tracks.length, values.tracks[0].label, values.tracks[0].values[1], values.tracks[0].domain.kind], [1, 'stability (ddg.csv)', -1.25, 'diverging']);
  assert.match(values.notes.join(' '), /1 row beyond the target left out/);
  const byReference = providerById('custom').read('reference_position,x\n159,7\n', context());
  assert.equal(byReference.tracks[0].values[0], 7);
  const stretches = providerById('custom').read('start,end,label,type\n2,10,loop,region\n', context());
  assert.deepEqual(stretches.tracks[0].features, [{ type: 'region', start: 2, end: 10, label: 'loop' }]);
  const gff = readGFF3('##gff-version 3\nmyseq\tlab\tinterface\t3\t5\t.\t.\t.\tName=binds%20peptide\n');
  assert.deepEqual(gff.map((f) => [f.type, f.label]), [['interface', 'binds peptide']]);
  const model = { length: 56, protein: grb2.sequence, target: { offset: 158 } };
  const builtin = { id: 'x', label: 'Conservation', kind: 'values', length: 56, values: Float64Array.from({ length: 56 }, (_, i) => (i % 7) / 10) };
  const back = providerById('custom').read(tracksCSV([builtin], model), context());
  assert.deepEqual([...back.tracks[0].values], [...builtin.values]);
});

test('an annotation kept with the workspace: its tracks named by it, with its source; in the archive and back', async () => {
  const text = fixture('public-data/pdbe/P62993.conservation.json');
  const annotation = { id: 'pdbe', provider: 'pdbe-conservation', name: 'Conservation (PDBe-KB): P62993', file: { fileName: 'P62993.conservation.json', sha256: 'f'.repeat(64), size: text.length }, record: { service: 'PDBe-KB', retrieved: '2026-10-11T15:00:00Z', accession: 'P62993' } };
  const read = annotationTracks(annotation, text, context());
  assert.deepEqual(read.tracks.map((t) => [t.id, t.annotation, t.source.service, t.source.retrieved]), [['pdbe:conservation', 'pdbe', 'PDBe-KB', '2026-10-11T15:00:00Z']]);
  let ws = createWorkspace('Tracks', { id: 'ws-tracks', now: '2026-10-11T00:00:00Z' });
  const bytes = new TextEncoder().encode(text);
  const { sha256 } = await import('./sha256.js');
  const hash = sha256(bytes);
  const added = addAnnotation(ws, { ...annotation, file: { ...annotation.file, sha256: hash } });
  ws = added.ws;
  assert.equal(ws.history.at(-1).action, 'annotation');
  const arranged = setTrackLayout(ws, { order: ['pdbe:conservation'], hidden: [], filters: {} });
  assert.equal(arranged.history.length, ws.history.length, 'the arrangement is a view, not in the history');
  const archive = await writeArchive(arranged, { annotations: new Map([[hash, bytes]]) });
  const back = await readArchive(archive.bytes);
  assert.deepEqual(back.problems, []);
  assert.deepEqual([...back.sources.keys()], [hash]);
  assert.deepEqual(back.ws.annotations, arranged.annotations);
  assert.deepEqual(back.ws.tracks, arranged.tracks);
  await assert.rejects(writeArchive(arranged, {}), /not in the library/);
  const removed = removeAnnotation(arranged, 'pdbe');
  assert.equal(removed.annotations, undefined);
  assert.deepEqual(removed.tracks.order, []);
  assert.equal(builtinTracks({ length: 1, rows: ['A'], state: new Uint8Array(1), reference: new Uint8Array(1), cells: Int32Array.of(-1), source: { se: [] }, columnMedian: Float64Array.of(Number.NaN), protein: 'M', target: { offset: 0 } }).length, 4);
});
