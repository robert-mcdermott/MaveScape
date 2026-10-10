import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTable } from './csv.js';
import { applyTemplate, detectLayout, draftDesign, makeTemplate, namesFromSequences, reviewImport, suggestRoles } from './importer.js';
import { validateDesign } from './design.js';

const target = { id: 't', name: 'Toy', sequenceType: 'protein', sequence: 'MSKGEELFTG' };

test('layouts in common use are recognized', () => {
  const mavedb = parseTable('accession,hgvs_nt,hgvs_splice,hgvs_pro,input_count_rep1,output_count_rep1\r\nurn:1,NA,NA,p.Ser2Ala,5.0,1.0\r\n');
  assert.deepEqual(detectLayout(mavedb), { layout: 'mavedb-counts', variantColumn: 'hgvs_pro', level: 'protein', countColumns: ['input_count_rep1', 'output_count_rep1'], scoreColumns: {}, notes: ['MaveDB count table: one column per sample, with variants in MAVE-HGVS.'] });
  const scores = detectLayout(parseTable('accession,hgvs_nt,hgvs_pro,score,SE\nurn:1,c.4A>G,p.Ser2Gly,0.1,0.02\n'));
  assert.equal(scores.layout, 'mavedb-scores');
  assert.equal(scores.variantColumn, 'hgvs_nt', 'MaveDB indexes by hgvs_nt when it is given');
  assert.deepEqual(scores.scoreColumns, { score: 'score', se: 'SE' });
  assert.equal(detectLayout(parseTable('nt_seq\tinput1\toutput1A\nacgt\t1\t0\n')).layout, 'dimsum');
  const generic = detectLayout(parseTable('mutation,pre,post,fitness\nA12V,10,3,0.2\nG13D,8,8,0\nWT,100,90,0\n'));
  assert.equal(generic.layout, 'generic');
  assert.equal(generic.variantColumn, 'mutation');
  assert.deepEqual(generic.countColumns, ['pre', 'post']);
  assert.deepEqual(generic.scoreColumns, { score: 'fitness' });
  assert.equal(detectLayout(parseTable('a,b\nx,1\n')).layout, 'unknown');
});

test('roles suggested from column names, and the replicate each column belongs to', () => {
  const roles = suggestRoles(['input_count_rep1', 'output_count_rep1', 'PlusE2NewRep3_c_0', 'PlusE2NewRep3_c_5', 'Count_Tile_2_Bin_3_BioReplicate_1', 'input1', 'output1A', 'gen_0', 'gen_21', 'notes']);
  const view = roles.map((r) => [r.column, r.role, r.time ?? r.bin, r.tile, r.replicate, r.group]);
  assert.deepEqual(view, [
    ['input_count_rep1', 'input', 0, null, 1, 'count_rep1'],
    ['output_count_rep1', 'output', null, null, 1, 'count_rep1'],
    ['PlusE2NewRep3_c_0', 'timepoint', 0, null, 3, 'PlusE2NewRep3'],
    ['PlusE2NewRep3_c_5', 'timepoint', 5, null, 3, 'PlusE2NewRep3'],
    ['Count_Tile_2_Bin_3_BioReplicate_1', 'bin', 3, 2, 1, 'Count_Tile_2_BioReplicate_1'],
    ['input1', 'input', 0, null, null, '1'],
    ['output1A', 'output', null, null, null, '1'],
    ['gen_0', 'timepoint', 0, null, null, 'all'],
    ['gen_21', 'timepoint', 21, null, null, 'all'],
    ['notes', null, null, null, null, 'notes'],
  ]);
});

test('a two-population design drafted from suggestions validates', () => {
  const table = parseTable('hgvs_pro,input_rep1,output_rep1,input_rep2,output_rep2\np.=,100,90,80,70\np.Ser2Ala,10,2,12,3\n');
  const { design } = draftDesign(table, suggestRoles(['input_rep1', 'output_rep1', 'input_rep2', 'output_rep2']), { variantColumn: 'hgvs_pro', level: 'protein', target });
  assert.equal(design.model, 'two-population');
  assert.deepEqual(design.replicates.map((r) => [r.id, r.biological, r.input, r.output]), [['rep1', 1, 'input_rep1', 'output_rep1'], ['rep2', 2, 'input_rep2', 'output_rep2']]);
  const result = validateDesign(design, { columns: table.columns.map((c) => c.name) });
  assert.equal(result.ok, true, result.errors.map((e) => e.message).join('; '));
});

test('shared inputs in a time series become one sample, with the copies set aside', () => {
  const table = parseTable('hgvs_pro,A_c_0,A_c_1,A_c_2,B_c_0,B_c_1,B_c_2\np.=,100,90,80,100,70,60\np.Ser2Ala,10,2,1,10,3,1\n');
  const { design } = draftDesign(table, suggestRoles(['A_c_0', 'A_c_1', 'A_c_2', 'B_c_0', 'B_c_1', 'B_c_2']), { variantColumn: 'hgvs_pro', level: 'protein', target });
  assert.equal(design.model, 'time-series');
  assert.deepEqual(design.ignoredColumns, [{ column: 'B_c_0', reason: 'repeats a sample its replicates share', copyOf: 'A_c_0' }]);
  assert.deepEqual(design.replicates[1].timepoints, [{ sample: 'A_c_0', time: 0 }, { sample: 'B_c_1', time: 1 }, { sample: 'B_c_2', time: 2 }]);
  assert.equal(validateDesign(design, { columns: table.columns.map((c) => c.name) }).ok, true);
});

test('whole sequences (DiMSum\'s, Enrich2\'s maps) are named against the wild type, synonymous ones by codon', () => {
  const wt = 'ATGGCCAAA'; // Met Ala Lys
  const { nt, pro, problems } = namesFromSequences(['atggccaaa', 'ATGGCGAAA', 'ATGGTCAAA', 'TTGGCCTAA', 'ATGG', 'ATGGCGAAG'], wt);
  assert.deepEqual(nt.slice(0, 4), ['c.=', 'c.6C>G', 'c.5C>T', 'c.[1A>T;7A>T]']);
  assert.deepEqual(pro.slice(0, 4), ['p.=', 'p.Ala2=', 'p.Ala2Val', 'p.[Met1Leu;Lys3Ter]']);
  assert.equal(pro[5], 'p.[Ala2=;Lys3=]');
  assert.equal(problems[0].row, 4);
});

test('the review blocks on duplicates and on counts that are not numbers; templates fit tables', () => {
  const table = parseTable('variant,input,output\np.Ser2Ala,10,2\nS2A,11,3\np.Lys3Arg,x,1\np.Ala2Val,1,1\n');
  const review = reviewImport(table, { variantColumn: 'variant', level: 'protein', countColumns: ['input', 'output'], target });
  assert.deepEqual(review.blocking.map((b) => b.code).sort(), ['duplicate-variants', 'not-numeric']);
  assert.match(review.blocking.find((b) => b.code === 'duplicate-variants').message, /p\.Ser2Ala \(lines 2, 3\)/);
  assert.match(review.warnings.find((w) => w.code === 'invalid-variants').message, /"p\.Ala2Val" \(line 5: the target has Ser at 2, not Ala\)/);
  const template = makeTemplate('My lab', table, { variantColumn: 'variant', level: 'protein', countColumns: ['input', 'output'] });
  assert.equal(applyTemplate(template, table).variantColumn, 'variant');
  assert.equal(applyTemplate(template, parseTable('variant,input\nx,1\n')), null);
});
