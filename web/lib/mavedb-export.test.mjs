import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_LICENSE, MAVEDB_LICENSES, depositDetails, depositKeywords, depositZip, keywordProblems, mavedbDeposit, readDeposit } from './mavedb-export.js';
import { MAVEDB_KEYWORDS } from './readout.js';
import { columnText, parseTable } from './csv.js';
import { DEFAULT_PARAMETERS, scoreExperiment } from './score.js';
import { addSource, addTarget, createWorkspace, setDesign } from './workspace.js';
import { makeRun, runInputs } from './runs.js';
import { listZip } from './zip.js';

const NOW = '2026-10-10T12:00:00.000Z';
const base = (target, level, column) => ({
  format: 'mavescape-design', version: 1, name: 'Toy', model: 'two-population',
  variants: { column, level }, targets: [target], library: { level: 'variant' },
  samples: [{ id: 'in', name: 'Input', columns: ['in'] }, { id: 'out', name: 'Selected', columns: ['out'] }],
  replicates: [{ id: 'r1', name: 'Replicate 1', biological: 1, input: 'in', output: 'out' }],
  controls: { wildType: 'auto', synonymous: 'auto', nonsense: 'auto' },
});

// A workspace with one table scored, as the window keeps it.
function scored(text, design, { origin = null, deposit = null, targetOrigin = null, record = null } = {}) {
  const table = parseTable(text);
  let ws = createWorkspace('Toy', { now: NOW, id: 'ws-test' });
  const t = addTarget(ws, targetOrigin ? { ...design.targets[0], origin: targetOrigin } : design.targets[0]);
  ws = t.ws;
  const source = { name: 'counts.csv', sha256: 'a'.repeat(64), rows: table.rows, mapping: { variantColumn: design.variants.column, level: design.variants.level, mode: 'lenient' }, ...(origin ? { origin } : {}) };
  const added = addSource(ws, source);
  ws = setDesign(added.ws, design, 'design', added.id);
  if (deposit) ws = { ...ws, deposit };
  if (record) ws = { ...ws, records: [record] };
  const columns = Object.fromEntries(table.columns.filter((c) => c.numeric).map((c) => [c.name, c.numeric]));
  const out = scoreExperiment({ names: columnText(table.columns.find((c) => c.name === design.variants.column)), columns, design, parameters: { ...DEFAULT_PARAMETERS, ...(design.model === 'scores' ? { model: 'published' } : {}) } });
  assert.ok(out.ok, out.errors?.join(' '));
  const run = makeRun({ inputs: runInputs({ source: ws.sources[0], design, parameters: DEFAULT_PARAMETERS }), source: ws.sources[0], results: out.results, software: { version: 'test' }, name: 'Run 1', created: NOW });
  return { ws: { ...ws, runs: [run] }, run, results: out.results, table };
}

const file = (d, name) => d.files.find((f) => f.name === name)?.text ?? null;
const methods = { paragraphs: ['Scores are log ratios [1].'], references: [{ n: 1, text: 'Rubin AF, et al. Genome Biology. 2017.' }] };

const protein = { id: 't', name: 'Toy', sequenceType: 'protein', sequence: 'MSKG', organism: 'Homo sapiens', identifiers: { uniprot: 'P62993' }, offset: 10 };
const proteinTable = 'v,in,out\np.=,100,90\np.Ser2Ala,10,3\np.Lys3Arg,NA,4\nS2G,7,0.5\np.Gly9Ala,5,5\n';

test('a run scored from counts: MaveDB\'s tables, column descriptions, experiment and score set', () => {
  const design = { ...base(protein, 'protein', 'v'), readout: { method: 'Reporter', mechanism: 'Loss of function', modelSystem: 'Yeast in a dish', phenotype: 'Regulation of protein stability' }, library: { level: 'variant', method: 'Error-prone PCR' } };
  const { ws, run, results } = scored(proteinTable, design);
  const d = mavedbDeposit({ ws, run, results, methods, software: { version: 'test' } });
  assert.equal(d.report.mode, 'protein');
  assert.deepEqual(d.files.map((f) => f.name), ['README.md', 'scores.csv', 'counts.csv', 'score_columns.json', 'count_columns.json', 'experiment.json', 'score_set.json', 'mavescape.json']);
  const scores = file(d, 'scores.csv').trim().split('\n');
  // Strict names; the one not on the target left out; no column without a value; no quoting.
  assert.equal(scores[0], 'hgvs_pro,score,SE,ci95_lower,ci95_upper,replicates,score_r1,SE_r1,status');
  assert.deepEqual(scores.slice(1).map((l) => l.split(',')[0]), ['p.=', 'p.Ser2Ala', 'p.Lys3Arg', 'p.Ser2Gly']);
  assert.equal(scores[3].split(',').at(-1), 'not measured');
  assert.ok(!/[“"']/.test(file(d, 'scores.csv')));
  assert.deepEqual(d.report.variants.leftOut, [{ reason: 'not a valid name on the target', count: 1, examples: ['p.Gly9Ala'] }]);
  assert.equal(file(d, 'counts.csv').split('\n')[0], 'hgvs_pro,in,out');
  assert.equal(JSON.parse(file(d, 'count_columns.json')).in.description, 'Reads of the variant in Input, input of Replicate 1');
  assert.equal(JSON.parse(file(d, 'score_columns.json')).score_r1.description, 'Score in Replicate 1');
  // The experiment's keywords from the readout: as MaveDB writes them, "Other" with the term.
  const experiment = JSON.parse(file(d, 'experiment.json'));
  assert.deepEqual(experiment.keywords, [
    { keyword: { key: 'In Vitro Construct Library Method System', label: 'Error-prone PCR' } },
    { keyword: { key: 'Phenotypic Assay Method', label: 'Reporter' } },
    { keyword: { key: 'Phenotypic Assay Mechanism', label: 'Loss of function' } },
    { keyword: { key: 'Phenotypic Assay Model System', label: 'Other' }, description: 'Yeast in a dish' },
    { keyword: { key: 'Molecular Mechanism Assessed', label: 'Regulation of protein stability' } },
  ]);
  const set = JSON.parse(file(d, 'score_set.json'));
  assert.equal(set.methodText, 'Scores are log ratios [1].\n\n**References**\n\n1. Rubin AF, et al. Genome Biology. 2017.');
  assert.equal(set.licenseId, MAVEDB_LICENSES.find((l) => l.short === DEFAULT_LICENSE).id);
  assert.equal(set.experimentUrn, null);
  assert.deepEqual(set.targetGenes, [{ name: 'Toy', category: 'protein_coding', externalIdentifiers: [{ identifier: { dbName: 'UniProt', identifier: 'P62993' }, offset: 10 }], targetSequence: { sequence: 'MSKG', sequenceType: 'protein', taxonomy: { code: 9606 } } }]);
  // What MaveDB requires that the workspace lacks; what was chosen.
  assert.deepEqual(d.report.missing.map((m) => m.field), ['abstract']);
  assert.deepEqual(d.report.defaulted.map((m) => m.field), ['title', 'license', 'shortDescription']);
  const manifest = JSON.parse(file(d, 'mavescape.json'));
  assert.equal(manifest.format, 'mavescape-mavedb');
  assert.equal(manifest.files.length, 6);
  assert.match(file(d, 'README.md'), /## Still to give\n\nMaveDB requires these/);
});

test('the MaveDB details stated replace the defaults; a missing taxonomy is said', () => {
  const design = base({ ...protein, organism: undefined }, 'protein', 'v');
  const deposit = { title: 'A title', shortDescription: 'Short.', abstract: 'Abstract.', method: 'Our note.', license: 'CC BY 4.0', publications: [{ db: 'PubMed', id: '29785012' }, { db: 'Crossref', id: '10.1038/x' }], rawReads: ['SRP123456'], contributors: ['0000-0002-1825-0097'], experimentUrn: 'urn:mavedb:00000001-a', keywords: [{ key: 'Delivery Method', label: 'electroporation' }, { key: 'Bogus', label: 'x' }] };
  const { ws, run, results } = scored(proteinTable, design, { deposit });
  const d = mavedbDeposit({ ws, run, results, methods });
  assert.deepEqual(d.report.missing.map((m) => m.field), ['taxonomyId']);
  const set = JSON.parse(file(d, 'score_set.json'));
  assert.equal(set.title, 'A title');
  assert.equal(set.licenseId, 3);
  assert.equal(set.experimentUrn, 'urn:mavedb:00000001-a');
  assert.ok(set.methodText.startsWith('Our note.\n\nScores are log ratios'));
  assert.deepEqual(set.primaryPublicationIdentifiers, [{ identifier: '29785012', dbName: 'PubMed' }]);
  assert.deepEqual(set.secondaryPublicationIdentifiers, [{ identifier: '10.1038/x', dbName: 'Crossref' }]);
  const experiment = JSON.parse(file(d, 'experiment.json'));
  assert.deepEqual(experiment.keywords, [{ keyword: { key: 'Delivery Method', label: 'Electroporation' } }]);
  assert.deepEqual(experiment.rawReadIdentifiers, [{ identifier: 'SRP123456' }]);
  assert.deepEqual(experiment.contributors, [{ orcidId: '0000-0002-1825-0097' }]);
  assert.equal(depositDetails(ws, run).details.title, 'A title');
});

const dna = { id: 'g', name: 'Gene', sequenceType: 'dna', sequence: 'CCCATGGCTAAAGGCTGGTAAGGG', codingStart: 4, organism: 'Homo sapiens' };

test('c. names beside their protein change, on the coding sequence; a variant with none left out', () => {
  const design = base(dna, 'nucleotide', 'hgvs_nt');
  const { ws, run, results } = scored('hgvs_nt,in,out\n_wt,100,100\nc.4G>T,100,50\nc.-2C>T,50,50\nc.6T>C,80,90\nc.*2G>A,20,20\n', design);
  const d = mavedbDeposit({ ws, run, results, methods });
  assert.equal(d.report.mode, 'coding');
  const lines = file(d, 'scores.csv').trim().split('\n').map((l) => l.split(',').slice(0, 2).join(','));
  assert.deepEqual(lines, ['hgvs_nt,hgvs_pro', 'c.=,p.=', 'c.4G>T,p.Ala2Ser', 'c.6T>C,p.Ala2=']);
  assert.equal(d.report.variants.leftOut[0].count, 2);
  assert.match(d.report.variants.leftOut[0].reason, /^no protein change/);
  assert.equal(JSON.parse(file(d, 'score_set.json')).targetGenes[0].targetSequence.sequence, 'ATGGCTAAAGGCTGGTAA');
  assert.ok(d.report.notes.some((n) => /from its coding start to its stop codon \(bases 4–21 of 24\)/.test(n)));
});

test('nucleotide names alone are written n. on the whole sequence; MaveDB\'s category is said to be chosen', () => {
  const design = base(dna, 'nucleotide', 'hgvs_nt');
  const { ws, run, results } = scored('hgvs_nt,in,out\n_wt,90,90\ng.7G>T,100,50\ng.9T>C,80,90\nc.4G>T,9,9\n', design);
  const d = mavedbDeposit({ ws, run, results, methods });
  assert.equal(d.report.mode, 'noncoding');
  assert.deepEqual(file(d, 'scores.csv').trim().split('\n').map((l) => l.split(',')[0]), ['hgvs_nt', 'n.=', 'n.7G>T', 'n.9T>C']);
  assert.match(d.report.variants.leftOut[0].reason, /a c\. name among g\. names/);
  assert.equal(JSON.parse(file(d, 'score_set.json')).targetGenes[0].targetSequence.sequence, dna.sequence);
  assert.ok(d.report.defaulted.some((x) => x.field === 'category'));
  const regulatory = scored('hgvs_nt,in,out\n_wt,90,90\nn.7G>T,100,50\nn.9T>C,80,90\n', design, { deposit: { category: 'regulatory' } });
  assert.equal(JSON.parse(file(mavedbDeposit({ ...regulatory, methods }), 'score_set.json')).targetGenes[0].category, 'regulatory');
});

test('a target fetched as a transcript is named by its accession, its variants prefixed', () => {
  const target = { ...dna, identifiers: { gene: 'GENE', refseq: 'NM_000001.1' } };
  const design = base(target, 'nucleotide', 'hgvs_nt');
  const { ws, run, results } = scored('hgvs_nt,in,out\n_wt,90,90\nNM_000001.1:c.4G>T,100,50\nc.-2C>T,50,50\n', design, { targetOrigin: { service: 'NCBI', accession: 'NM_000001.1' } });
  const d = mavedbDeposit({ ws, run, results, methods });
  assert.equal(d.report.mode, 'accession');
  assert.deepEqual(file(d, 'scores.csv').trim().split('\n').map((l) => l.split(',')[0]), ['hgvs_nt', 'NM_000001.1:c.=', 'NM_000001.1:c.4G>T', 'NM_000001.1:c.-2C>T']);
  assert.deepEqual(JSON.parse(file(d, 'score_set.json')).targetGenes[0].targetAccession, { accession: 'NM_000001.1', assembly: null, gene: 'GENE', isBaseEditor: false });
  assert.deepEqual(d.report.missing, [{ field: 'abstract', text: d.report.missing[0].text }]);
});

test('what MaveDB cannot take is refused with the reason', () => {
  const { ws, run, results } = scored(proteinTable, base(protein, 'protein', 'v'));
  const twoTargets = { ...run, inputs: { ...run.inputs, design: { ...run.inputs.design, targets: [protein, { ...protein, id: 'u' }] } } };
  assert.match(mavedbDeposit({ ws, run: twoTargets, results }).problem, /2 targets/);
  const splice = { ...run, inputs: { ...run.inputs, design: { ...run.inputs.design, variants: { column: 'v', level: 'splice' } } } };
  assert.match(mavedbDeposit({ ws, run: splice, results }).problem, /splice/);
});

test('published scores pass through: the score column renamed, columns MaveDB would refuse left out', () => {
  const text = 'name,fitness,se,note,odd,empty\np.Ser2Ala,-1.5,0.2,fine,1,NA\np.Lys3Arg,0.25,0.1,"a, b",x,NA\n';
  const design = { ...base(protein, 'protein', 'name'), model: 'scores', samples: [], replicates: [], scores: { score: 'fitness', se: 'se' }, ignoredColumns: [{ column: 'note', reason: 'r' }, { column: 'odd', reason: 'r' }, { column: 'empty', reason: 'r' }] };
  const { ws, run, results, table } = scored(text, design);
  const counts = parseTable('hgvs_pro,c1\np.Lys3Arg,5\np.Ser2Ala,7\n');
  const d = mavedbDeposit({ ws, run, results, tables: { scores: table, counts }, methods: null });
  assert.equal(file(d, 'scores.csv'), 'hgvs_pro,score,se\np.Ser2Ala,-1.5,0.2\np.Lys3Arg,0.25,0.1\n');
  assert.equal(file(d, 'counts.csv'), 'hgvs_pro,c1\np.Ser2Ala,7\np.Lys3Arg,5\n');
  assert.ok(d.report.notes.some((n) => /"note" holds text with commas/.test(n)));
  assert.ok(d.report.notes.some((n) => /"odd" mixes numbers and text/.test(n)));
  assert.deepEqual(d.report.missing.map((m) => m.field), ['abstract', 'method']);
  const other = mavedbDeposit({ ws, run, results, tables: { scores: table, counts: parseTable('hgvs_pro,c1\np.Ser2Ala,7\n') } });
  assert.equal(file(other, 'counts.csv'), null);
  assert.ok(other.report.notes.some((n) => /counts name other variants/.test(n)));
});

test('a package reads back as a MaveDB record, with the MaveDB details it states', () => {
  const design = { ...base(protein, 'protein', 'v'), readout: { method: 'Reporter' } };
  const first = scored(proteinTable, design, { deposit: { abstract: 'Abstract.', keywords: [{ key: 'Delivery Method', label: 'Other', description: 'Gene gun' }] } });
  const d = mavedbDeposit({ ...first, methods });
  const files = new Map(d.files.map((f) => [f.name, f.text]));
  const { record, details, problems } = readDeposit(files, { name: 'toy.zip' });
  assert.deepEqual(problems, []);
  assert.equal(record.package, 'toy.zip');
  assert.equal(record.targets[0].taxonomyId, 9606);
  assert.equal(record.targets[0].identifiers[0].offset, 10);
  assert.equal(record.license.short, 'CC0');
  assert.equal(record.method, JSON.parse(files.get('score_set.json')).methodText);
  assert.deepEqual(details.keywords, [{ key: 'Delivery Method', label: 'Other', description: 'Gene gun' }]);
  assert.deepEqual(record.keywords.map((k) => k.key), ['Delivery Method', 'Phenotypic Assay Method']);
  assert.match(readDeposit(new Map([['scores.csv', 'x']])).problems[0], /no score_set\.json/);
});

test('keywords: MaveDB\'s rules for a library method, and "Other" described', () => {
  const k = (key, label, description) => ({ keyword: { key, label }, ...(description ? { description } : {}) });
  assert.deepEqual(keywordProblems([k('Variant Library Creation Method', 'In vitro construct library method'), k('In Vitro Construct Library Method System', 'Error-prone PCR')]), ['"Variant Library Creation Method" is "In vitro construct library method", so MaveDB needs "In Vitro Construct Library Method Mechanism" too.']);
  assert.match(keywordProblems([k('Delivery Method', 'Other')])[0], /without a description/);
  assert.match(keywordProblems([k('Variant Library Creation Method', 'Other'), k('Endogenous Locus Library Method System', 'SpCas9')])[0], /takes no "Endogenous Locus Library Method System"/);
  // The design's terms first in MaveDB's order of keys; the details' only for the other keys.
  const notes = [];
  const out = depositKeywords({ readout: { phenotype: 'Binding to a peptide' }, library: { method: 'oligo pool synthesis' } }, [{ key: 'In Vitro Construct Library Method System', label: 'Error-prone PCR' }, { key: 'Variant Library Creation Method', label: 'In vitro construct library method' }], notes);
  assert.deepEqual(out, [k('Variant Library Creation Method', 'In vitro construct library method'), k('In Vitro Construct Library Method System', 'Oligo pool synthesis')]);
  assert.match(notes[0], /"Binding to a peptide" is not one of MaveDB's terms for "Molecular Mechanism Assessed"/);
  assert.equal(Object.keys(MAVEDB_KEYWORDS).length, 13);
});

test('the ZIP is the same bytes for the same deposit', async () => {
  const { ws, run, results } = scored(proteinTable, base(protein, 'protein', 'v'));
  const d = mavedbDeposit({ ws, run, results, methods });
  const a = await depositZip(d, { date: new Date(NOW) });
  const b = await depositZip(d, { date: new Date(NOW) });
  assert.deepEqual(a, b);
  assert.deepEqual(listZip(a).map((e) => e.name), d.files.map((f) => f.name));
});
