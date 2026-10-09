import assert from 'node:assert/strict';
import test from 'node:test';
import { createTableParser, decodeBytes, parseNumber, parseTable, sniff } from './csv.js';

const codes = (table) => table.diagnostics.map((d) => d.code);
const column = (table, name) => table.columns.find((c) => c.name === name);

test('a MaveDB table: CRLF line ends, NA as missing, counts written as decimals', () => {
  const t = parseTable('accession,hgvs_pro,input,output\r\nurn:1,p.Thr1Ala,66.0,37.0\r\nurn:2,p.=,NA,0.0\r\n');
  assert.equal(t.lineEnd, 'crlf');
  assert.equal(t.delimiter, ',');
  assert.equal(t.rows, 2);
  assert.deepEqual(column(t, 'hgvs_pro').values, ['p.Thr1Ala', 'p.=']);
  const input = column(t, 'input');
  assert.equal(input.type, 'number');
  assert.equal(input.integer, true);
  assert.equal(input.missing, 1);
  assert.deepEqual(input.missingTokens, ['NA']);
  assert.ok(Number.isNaN(input.numeric[1]), 'missing is NaN, not 0');
  assert.equal(column(t, 'output').numeric[1], 0, 'an explicit 0 stays 0');
  assert.deepEqual(t.diagnostics, []);
});

test('old Mac line ends (CR alone), as DiMSum\'s demo design has them, and LF', () => {
  const cr = parseTable('sample_name\texperiment_replicate\rinput1\t1\routput1A\t1\r');
  assert.equal(cr.lineEnd, 'cr');
  assert.equal(cr.delimiter, '\t');
  assert.deepEqual(column(cr, 'sample_name').values, ['input1', 'output1A']);
  const lf = parseTable('a\tb\n1\t2\n');
  assert.equal(lf.lineEnd, 'lf');
  assert.equal(lf.rows, 1);
});

test('quoted fields: delimiters, line breaks and doubled quotes inside', () => {
  const t = parseTable('name,note,n\n"p.[Ala1Val;Gly2Asp]","a, b",1\n"x","line one\nline two",2\n"say ""hi""",,3\n');
  assert.deepEqual(column(t, 'name').values, ['p.[Ala1Val;Gly2Asp]', 'x', 'say "hi"']);
  assert.deepEqual(column(t, 'note').values, ['a, b', 'line one\nline two', '']);
  assert.deepEqual([...column(t, 'n').numeric], [1, 2, 3]);
  assert.equal(t.lineOfRow[2], 5, 'line numbers count the line break inside the quoted field');
});

test('the same table whether it arrives at once or one character at a time', () => {
  const text = 'v,"a ""q""",b\r\n"p.=",1,2\r\n"x,y","1\r\n2",3\r\n';
  const whole = parseTable(text);
  const parser = createTableParser();
  for (const ch of text) parser.push(ch);
  const piecewise = parser.finish();
  assert.deepEqual(piecewise.columns.map((c) => c.values), whole.columns.map((c) => c.values));
  assert.deepEqual(piecewise.columns.map((c) => c.name), ['v', 'a "q"', 'b']);
});

test('the delimiter is the one that splits lines consistently; semicolons may come with decimal commas', () => {
  assert.equal(sniff('a;b;c\n1;2;3\n4;5;6\n').delimiter, ';');
  assert.equal(sniff('a|b\n1|2\n').delimiter, '|');
  assert.equal(sniff('only\n1\n').delimiter, ',');
  assert.equal(sniff('x\ty\n1\t2\n', { fileName: 'counts.tsv' }).delimiter, '\t');
  const t = parseTable('variant;score\np.Ala1Val;0,25\np.Ala1Gly;-1,5\n');
  assert.deepEqual([...column(t, 'score').numeric], [0.25, -1.5]);
  assert.ok(codes(t).includes('decimal-comma'));
  // With a comma delimiter, "1,5" cannot be a decimal: a quoted one stays text, and says so.
  const comma = parseTable('v,score\na,"1,5"\nb,2\n');
  assert.equal(column(comma, 'score').type, 'mixed');
  assert.deepEqual(column(comma, 'score').nonNumeric, [{ line: 2, value: '1,5' }]);
});

test('numbers are read strictly; anything else is listed with its line, never coerced', () => {
  assert.equal(parseNumber('3232.0'), 3232);
  assert.equal(parseNumber('-1.5e-3'), -0.0015);
  for (const s of ['0x10', 'Infinity', '1,000', '12 ', '', '1.2.3', '−5']) assert.ok(Number.isNaN(parseNumber(s)), s);
  const t = parseTable('v,count\na,10\nb,ten\nc,\nd,12.5\n');
  const count = column(t, 'count');
  assert.equal(count.type, 'mixed');
  assert.equal(count.numeric, null, 'no numeric view while a value is not a number');
  assert.equal(count.nonNumericCount, 1);
  assert.deepEqual(count.nonNumeric, [{ line: 3, value: 'ten' }]);
  assert.equal(count.missing, 1);
});

test('rows of the wrong width, unnamed and repeated columns are diagnosed with their lines', () => {
  const t = parseTable('v,a,a,\n1,2,3,4\n5,6\n7,8,9,10\n');
  assert.deepEqual(t.columns.map((c) => c.name), ['v', 'a', 'a (2)', 'Column 4']);
  assert.ok(codes(t).includes('duplicate-column'));
  assert.ok(codes(t).includes('unnamed-column'));
  const ragged = t.diagnostics.find((d) => d.code === 'ragged-rows');
  assert.equal(ragged.level, 'error');
  assert.match(ragged.message, /line 3 \(2\)/);
});

test('comment lines before the table, blank lines and a table without a header', () => {
  const t = parseTable('# MaveDB export\n# license CC0\nhgvs_pro,score\n\np.Ala1Val,0.5\n');
  assert.equal(t.rows, 1);
  assert.ok(codes(t).includes('comments'));
  const bare = parseTable('1,2\n3,4\n');
  assert.equal(bare.header, false);
  assert.deepEqual(bare.columns.map((c) => c.name), ['Column 1', 'Column 2']);
  assert.ok(codes(bare).includes('no-header'));
});

test('encodings: BOMs are removed; text that is not UTF-8 is read as Windows-1252, and said', () => {
  const bom = decodeBytes(new Uint8Array([0xef, 0xbb, 0xbf, 0x61, 0x2c, 0x62]));
  assert.equal(bom.text, 'a,b');
  assert.equal(bom.bom, true);
  const latin = decodeBytes(new Uint8Array([0x6e, 0x61, 0x6d, 0x65, 0x0a, 0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72]));
  assert.equal(latin.text, 'name\nMüller');
  assert.equal(latin.encoding, 'windows-1252');
  assert.equal(latin.diagnostics[0].code, 'encoding');
  const utf16 = decodeBytes(new Uint8Array([0xff, 0xfe, 0x61, 0x00, 0x2c, 0x00, 0x62, 0x00]));
  assert.equal(utf16.text, 'a,b');
  const table = parseTable(new TextEncoder().encode('﻿v,n\nx,1\n'));
  assert.deepEqual(table.columns.map((c) => c.name), ['v', 'n']);
});

test('an unclosed quote and an empty file are errors', () => {
  assert.ok(parseTable('v,n\n"x,1\n').diagnostics.some((d) => d.code === 'unclosed-quote' && d.level === 'error'));
  assert.ok(parseTable('').diagnostics.some((d) => d.code === 'empty'));
});
