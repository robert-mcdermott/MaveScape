import assert from 'node:assert/strict';
import test from 'node:test';
import { assayYear, beforeWords, circularity, clinvarControls, composition, controlSetWords, labelSide, matchControls, readDate, tableControls, variantKind } from './controls.js';
import { clinvarCSV } from './providers/clinvar.js';
import { addControlSet, createWorkspace, removeControlSet, verifyHistory } from './workspace.js';
import { analysisState, diffStates } from './diff.js';
import { absorb, acceptProposal, rejectProposal } from './proposals.js';

// A protein target numbered from 11 on its reference (offset 10): MSKGEELFTGVVPILVELDGDVNGH.
const target = { id: 't', name: 'Toy', sequenceType: 'protein', sequence: 'MSKGEELFTGVVPILVELDGDVNGH', offset: 10 };
const record = (accession, hgvsP, classification, reviewStatus, { transcript = 'NM_000001.1', evaluated = '2020-05-01' } = {}) => ({
  accession, variation_id: accession.slice(3), title: `${transcript}(TOY):c.1A>G (${hgvsP})`, transcript, hgvs_c: 'c.1A>G', hgvs_p: hgvsP,
  classification, review_status: reviewStatus, last_evaluated: evaluated, consequence: 'missense variant',
});
const ONE = 'criteria provided, single submitter';
const TWO = 'criteria provided, multiple submitters, no conflicts';
const NONE = 'no assertion criteria provided';
const clinvar = clinvarCSV([
  record('VCV000000001', 'p.Ser12Ala', 'Pathogenic', TWO),
  record('VCV000000002', 'p.Lys13Arg', 'Likely pathogenic', ONE, { evaluated: '2024-03-01' }),
  record('VCV000000003', 'p.Gly14Asp', 'Benign', ONE),
  record('VCV000000004', 'p.Glu15Lys', 'Likely benign', NONE), // no star: left out by default
  record('VCV000000005', 'p.Glu16Gly', 'Uncertain significance', ONE),
  record('VCV000000006', 'p.Leu17Pro', 'Conflicting classifications of pathogenicity', ONE),
  record('VCV000000007', 'p.Phe18Ter', 'Pathogenic', ONE), // nonsense: not chosen by default
  record('VCV000000008', 'p.Thr19=', 'Benign', ONE), // synonymous: not chosen by default
  record('VCV000000009', 'p.Gly20Ser', 'Pathogenic', ONE),
  record('VCV000000010', 'p.Gly20Ser', 'Likely pathogenic', TWO, { evaluated: '2025-01-02' }), // the same change: merged
  record('VCV000000011', 'p.Val21Ile', 'Pathogenic', ONE),
  record('VCV000000012', 'p.Val21Ile', 'Benign', ONE), // the same change on the other side: left out
  record('VCV000000013', 'p.Ala99Val', 'Pathogenic', ONE), // outside the target
  record('VCV000000014', 'p.Trp22Ala', 'Pathogenic', ONE), // the target has V at 22 (12 on the target)
  record('VCV000000015', 'p.Ser12Ala', 'Benign', ONE, { transcript: 'NM_000002.1' }), // another transcript
]);

test('a label\'s side in a table\'s words: P, B, or not read', () => {
  for (const w of ['Pathogenic', 'likely pathogenic', 'P', 'LP', 'P/LP', 'Pathogenic/Likely pathogenic', 'abnormal', 'functionally_abnormal']) assert.equal(labelSide(w), 'P', w);
  for (const w of ['Benign', 'likely benign', 'B', 'LB', 'B/LB', 'normal', 'Functionally normal']) assert.equal(labelSide(w), 'B', w);
  for (const w of ['VUS', 'Uncertain significance', 'conflicting', '', null, 'pathogenic?', 'Uncertain significance; risk factor', 'Conflicting classifications of pathogenicity; other']) assert.equal(labelSide(w), null, String(w));
  // ClinVar's words in a table (its tabular download), by their first term.
  assert.deepEqual(['Benign; association', 'Likely pathogenic, low penetrance', 'Pathogenic/Likely pathogenic; drug response'].map(labelSide), ['B', 'P', 'P']);
  assert.deepEqual([variantKind('S', 'A'), variantKind('S', '*'), variantKind('S', 'S')], ['missense', 'nonsense', 'synonymous']);
});

test('ClinVar\'s records: placed on the target, at least one star, P/LP against B/LB, missense; the same change merged, a change on both sides left out', () => {
  const read = clinvarControls(clinvar, target);
  assert.equal(read.problem, null);
  assert.equal(read.transcript, 'NM_000001.1');
  assert.deepEqual(read.labels.map((l) => [l.key, l.side, l.label, l.stars]), [
    ['p.Ser2Ala', 'P', 'Pathogenic', 2],
    ['p.Lys3Arg', 'P', 'Likely pathogenic', 1],
    ['p.Gly4Asp', 'B', 'Benign', 1],
    ['p.Gly10Ser', 'P', 'Likely pathogenic', 2],
  ]);
  const merged = read.labels.find((l) => l.key === 'p.Gly10Ser');
  assert.deepEqual(merged.ids, ['VCV000000009', 'VCV000000010']);
  assert.equal(merged.evaluated, '2025-01-02');
  assert.deepEqual(read.excluded, {
    'on another transcript': 1,
    'outside the target': 1,
    'another residue on the target': 1,
    'fewer than 1 review star': 1,
    'uncertain significance': 1,
    'conflicting classifications': 1,
    'nonsense (not chosen)': 1,
    'synonymous (not chosen)': 1,
    'records disagree': 1,
  });
  // Every kind, no minimum: the nonsense and synonymous records and the starless one come in.
  const all = clinvarControls(clinvar, target, { minStars: 0, kinds: ['missense', 'nonsense', 'synonymous'] });
  assert.deepEqual(all.labels.map((l) => `${l.key} ${l.side} ${l.kind}`), ['p.Ser2Ala P missense', 'p.Lys3Arg P missense', 'p.Gly4Asp B missense', 'p.Glu5Lys B missense', 'p.Phe8Ter P nonsense', 'p.Thr9= B synonymous', 'p.Gly10Ser P missense']);
});

test('a table of labels: its columns found, numbered on the reference or the target as its residues agree, its unread labels counted', () => {
  const onReference = 'variant,label\np.Ser12Ala,pathogenic\nK13R,LP\nNM_000001.1(TOY):c.40G>A (p.Gly14Asp),benign\np.Glu15Lys,VUS\np.Glu16Gly,VUS\np.Leu17Pro,normal\nnot a variant,benign\n';
  const a = tableControls(onReference, target);
  assert.equal(a.problem, null);
  assert.equal(a.numbering, 'reference');
  assert.deepEqual(a.labels.map((l) => `${l.key} ${l.side} ${l.label} ${l.ids[0]}`), ['p.Ser2Ala P pathogenic row 2', 'p.Lys3Arg P LP row 3', 'p.Gly4Asp B benign row 4', 'p.Leu7Pro B normal row 7']);
  assert.deepEqual(a.excluded, { 'label not read: "VUS"': 2, 'not a single protein substitution': 1 });
  // The same changes numbered on the target, tab-separated, with other column names.
  const onTarget = 'hgvs_pro\tclinical_significance\np.Ser2Ala\tPathogenic\np.Lys3Arg\tLikely pathogenic\np.Gly4Asp\tBenign\n';
  const b = tableControls(onTarget, target);
  assert.equal(b.numbering, 'target');
  assert.deepEqual(b.labels.map((l) => l.key), ['p.Ser2Ala', 'p.Lys3Arg', 'p.Gly4Asp']);
  assert.match(tableControls('name,score\nx,1\n', target).problem, /column of variants .* one of labels/);
});

test('matched to a run at the protein level: scored, not scored, not in the run', () => {
  const set = { labels: clinvarControls(clinvar, target).labels };
  const results = {
    rows: 3,
    variants: { key: ['p.Ser2Ala', 'p.Lys3Arg', 'p.Gly4Asp'] },
    conditions: [{ score: Float64Array.of(-1.2, Number.NaN, 0.1) }],
  };
  const m = matchControls(set, results);
  assert.deepEqual([...m.rows], [0, 1, 2, -1]);
  assert.deepEqual(m.states, ['scored', 'not scored', 'scored', 'not in the run']);
  assert.deepEqual(m.counts, { P: { scored: 1, 'not scored': 1, 'not in the run': 1 }, B: { scored: 1, 'not scored': 0, 'not in the run': 0 } });
  const c = composition(set);
  assert.equal(c.P.total, 3);
  assert.deepEqual(c.P.labels, { Pathogenic: 1, 'Likely pathogenic': 2 });
  assert.deepEqual(c.P.stars, [0, 1, 2, 0, 0]);
  assert.deepEqual(c.B.kinds, { missense: 1 });
});

test('circularity: scale anchors, the design\'s controls, ClinVar evaluated since the assay, its own publication, few controls, a predictor set with ClinVar', () => {
  const all = clinvarControls(clinvar, target, { minStars: 0, kinds: ['missense', 'nonsense', 'synonymous'] });
  const set = { name: 'All', source: { kind: 'clinvar' }, labels: all.labels };
  const design = { source: { citation: 'Someone A, et al. A toy assay. Journal 2024. doi:10.1000/toy.1' }, controls: { synonymous: ['p.Thr9='], nonsense: 'auto' } };
  const run = { inputs: { design, parameters: { normalization: 'synonymous', rescale: 'nonsense-wt' } } };
  const ws = { records: [], annotations: [{ provider: 'alphamissense' }] };
  const ids = circularity(set, { ws, run }).map((w) => `${w.id} ${w.n}`);
  assert.deepEqual(ids, ['anchor-nonsense 1', 'anchor-synonymous 1', 'design-controls 1', 'evaluated-since 2', 'few-P 4', 'few-B 3', 'predictor null']);
  assert.equal(assayYear(ws, design), 2024);
  assert.equal(assayYear({ records: [{ publication: { year: 2019 } }] }, design), 2019, 'a MaveDB record\'s year first');
  // The default scale anchors nothing; a table citing the assay's own DOI is circular (without
  // dates, nothing says when its labels were made).
  const table = { name: 'Paper', source: { kind: 'table', citation: 'doi:10.1000/toy.1' }, labels: all.labels.map(({ evaluated, ...l }) => l) };
  const plain = { inputs: { design: { source: { citation: design.source.citation } }, parameters: { normalization: 'wt', rescale: 'none' } } };
  assert.deepEqual(circularity(table, { ws: {}, run: plain }).map((w) => w.id), ['same-publication', 'few-P', 'few-B']);
  // Unknown publication: ClinVar's sets say so.
  assert.equal(circularity(set, { ws: {}, run: { inputs: { design: {}, parameters: {} } } }).find((w) => w.id === 'evaluated-since').n, null);
});

test('kept with the workspace: in the history, in a checkpoint\'s diff, proposed by an agent and accepted or rejected', () => {
  const read = clinvarControls(clinvar, target);
  let ws = createWorkspace('Toy', { now: '2026-10-13T00:00:00.000Z' });
  const before = analysisState(ws);
  const made = addControlSet(ws, { name: 'ClinVar', source: { kind: 'clinvar', transcript: read.transcript }, rules: { minStars: 1, kinds: ['missense'] }, labels: read.labels, excluded: read.excluded, notes: [] }, '2026-10-13T00:01:00.000Z');
  ws = made.ws;
  assert.equal(made.id, 'ClinVar');
  assert.match(ws.history.at(-1).detail, /^Made the control set "ClinVar" from ClinVar: 3 P and 1 B controls$/);
  assert.ok(verifyHistory(ws).ok);
  const diff = diffStates(before, analysisState(ws));
  assert.deepEqual(diff.changes.map((c) => c.text), ['The control set "ClinVar" was made (3 P and 1 B controls, from ClinVar).']);
  const gone = removeControlSet(ws, 'ClinVar');
  assert.equal(gone.controlSets, undefined);
  assert.match(gone.history.at(-1).detail, /^Deleted the control set "ClinVar"$/);
  // An agent's: made at once and marked proposed; rejecting removes it, accepting keeps it.
  const start = createWorkspace('Toy', { now: '2026-10-13T00:00:00.000Z' });
  const agent = addControlSet(start, { name: 'Agent', source: { kind: 'clinvar' }, labels: read.labels, excluded: {}, notes: [] }).ws;
  const absorbed = absorb(start, agent, 'An agent', '2026-10-13T00:02:00.000Z').ws;
  assert.equal(absorbed.controlSets[0].proposed.by, 'An agent');
  const id = absorbed.proposals[0].id;
  assert.equal(rejectProposal(absorbed, id).controlSets, undefined);
  assert.ok(acceptProposal(absorbed, id).controlSets[0].proposed.accepted, 'accepted: stamped with its time');
});

test('dates as tables write them; only classifications last evaluated before a year, from ClinVar or a table (wave 8, slice 6)', () => {
  assert.deepEqual(['2015-03-01', '2016/4/2', 'Mar 1, 2024', 'September 30, 2019', '1 Feb 2020', '2024-03-01T10:00', '', '-', 'soon', '2024-13-01'].map(readDate), ['2015-03-01', '2016-04-02', '2024-03-01', '2019-09-30', '2020-02-01', '2024-03-01', null, null, null, null]);
  // ClinVar: each record by its own date, before the records of a change merge.
  const before = clinvarControls(clinvar, target, { evaluatedBefore: 2021 });
  assert.deepEqual(before.labels.map((l) => [l.key, l.side, l.ids.join(' '), l.evaluated]), [
    ['p.Ser2Ala', 'P', 'VCV000000001', '2020-05-01'],
    ['p.Gly4Asp', 'B', 'VCV000000003', '2020-05-01'],
    ['p.Gly10Ser', 'P', 'VCV000000009', '2020-05-01'],
  ]);
  assert.equal(before.excluded['last evaluated in or after 2021'], 2);
  // A table's column of dates (ClinVar's tabular download names it so).
  const text = ['Name,Germline classification,Germline date last evaluated', 'p.Ser12Ala,Pathogenic,"Mar 1, 2015"', 'p.Lys13Arg,Likely pathogenic,2024-05-02', 'p.Gly14Asp,Benign,-', 'p.Glu15Lys,Likely benign,soon', 'p.Glu16Gly,Benign,2016/01/31'].join('\n');
  const all = tableControls(text, target);
  assert.equal(all.dated, true);
  assert.deepEqual(all.labels.map((l) => [l.key, l.evaluated ?? null]), [['p.Ser2Ala', '2015-03-01'], ['p.Lys3Arg', '2024-05-02'], ['p.Gly4Asp', null], ['p.Glu5Lys', null], ['p.Glu6Gly', '2016-01-31']]);
  assert.match(all.notes.join(' '), /1 date in "Germline date last evaluated" not read/);
  const early = tableControls(text, target, { evaluatedBefore: 2024 });
  assert.deepEqual(early.labels.map((l) => l.key), ['p.Ser2Ala', 'p.Glu6Gly']);
  assert.deepEqual(early.excluded, { 'last evaluated in or after 2024': 1, 'no date last evaluated': 2 });
  assert.equal(tableControls('variant,label\np.Ser12Ala,P\n', target).dated, false);
  // The table's dates against the assay's year, and none once the set is of those before it.
  const design = { source: { citation: 'Someone A, et al. A toy assay. Journal 2024. doi:10.1000/toy.1' } };
  const run = { inputs: { design, parameters: { normalization: 'wt', rescale: 'none' } } };
  const dated = { name: 'Dated', source: { kind: 'table' }, rules: {}, labels: all.labels };
  assert.deepEqual(circularity(dated, { ws: {}, run }).filter((w) => w.id === 'evaluated-since').map((w) => [w.n, w.text]), [[1, '1 control was last evaluated in or after 2024, when this assay was published: its classification may rest on it (functional evidence, PS3 or BS3).']]);
  const kept = { name: 'Dated, before 2024', source: { kind: 'table', file: { fileName: 'labels.csv' } }, rules: { evaluatedBefore: 2024 }, labels: early.labels };
  assert.deepEqual(circularity(kept, { ws: {}, run }).map((w) => w.id), ['few-P', 'few-B']);
  assert.deepEqual(circularity(kept, { ws: {}, run: { inputs: { design: {}, parameters: {} } } }).map((w) => w.id), ['few-P', 'few-B'], 'the year unknown: a set made of those before a year says nothing of it');
  assert.equal(beforeWords(kept), 'last evaluated before 2024');
  assert.equal(controlSetWords(kept), '"Dated, before 2024", from the table labels.csv, last evaluated before 2024: 1 P control and 1 B control');
});

test('nonsense and synonymous controls on published scores: their scale is the authors\' (wave 8, slice 6)', () => {
  const all = clinvarControls(clinvar, target, { minStars: 0, kinds: ['missense', 'nonsense', 'synonymous'] });
  const set = { name: 'All', source: { kind: 'clinvar' }, rules: {}, labels: all.labels };
  const published = { inputs: { design: { source: { citation: 'Journal 2024' } }, parameters: { model: 'published' } } };
  const w = circularity(set, { ws: {}, run: published }).find((x) => x.id === 'anchor-published');
  assert.deepEqual([w.n, w.text], [2, '1 nonsense control and 1 synonymous control on published scores: how their scale was set is not recorded here. Where the authors normalized or rescaled them by such variants, as most do, they score where the scale puts them, not as evidence.']);
  const missense = { ...set, labels: all.labels.filter((l) => l.kind === 'missense') };
  assert.equal(circularity(missense, { ws: {}, run: published }).some((x) => x.id === 'anchor-published'), false);
  assert.equal(circularity(set, { ws: {}, run: { inputs: { design: {}, parameters: { model: 'ratio' } } } }).some((x) => x.id === 'anchor-published'), false, 'a run of counts says its own anchors');
});
