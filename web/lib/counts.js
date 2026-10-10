// Count sets: the counts of a table's sample columns as numbers, checked (requirements D2, D4).
// A count that the table does not give is missing (NaN), never 0; an explicit 0 is 0. Columns
// that are not all numbers, negative counts and rows of the same variant block scoring and are
// listed by line. Tables of one sample each (as many pipelines write them) are joined on their
// variant column first, and what a variant absent from a file means is the user's choice.

import { cellText, isMissing, parseNumber } from './csv.js';

// The count columns of a parsed table (csv.js) as samples, with their problems.
// mapping: { variantColumn, countColumns: [names] }.
// Returns { rows, samples: [{ column, counts: Float64Array, total, observed, missing, zeros,
//   nonInteger }], problems: [{ level, code, message, column?, lines? }] }.
export function buildCountSet(table, mapping) {
  const problems = [];
  const byName = new Map(table.columns.map((c) => [c.name, c]));
  const lineOf = (row) => table.lineOfRow?.[row] ?? row + 2;
  if (!byName.has(mapping.variantColumn)) problems.push({ level: 'error', code: 'no-variant-column', message: `The table has no column "${mapping.variantColumn}".` });
  const samples = [];
  for (const name of mapping.countColumns) {
    const column = byName.get(name);
    if (!column) {
      problems.push({ level: 'error', code: 'no-column', message: `The table has no column "${name}".`, column: name });
      continue;
    }
    if (column.type === 'text' || column.type === 'mixed') {
      const shown = column.nonNumeric.slice(0, 3).map((x) => `"${x.value}" (line ${x.line})`).join(', ');
      problems.push({ level: 'error', code: 'not-numeric', message: `Column "${name}" holds ${column.type === 'text' ? 'no numbers' : `${column.nonNumericCount} value${column.nonNumericCount > 1 ? 's' : ''} that ${column.nonNumericCount > 1 ? 'are' : 'is'} not a number: ${shown}`}.`, column: name, lines: column.nonNumeric.map((x) => x.line) });
      continue;
    }
    const counts = column.numeric ?? new Float64Array(table.rows).fill(Number.NaN);
    let total = 0;
    let observed = 0;
    let zeros = 0;
    let missing = 0;
    let nonInteger = 0;
    const negative = [];
    for (let r = 0; r < counts.length; r += 1) {
      const x = counts[r];
      if (Number.isNaN(x)) {
        missing += 1;
        continue;
      }
      if (x < 0) negative.push(lineOf(r));
      if (!Number.isInteger(x)) nonInteger += 1;
      if (x === 0) zeros += 1;
      else observed += 1;
      total += x;
    }
    if (negative.length) problems.push({ level: 'error', code: 'negative', message: `Column "${name}" has ${negative.length} negative count${negative.length > 1 ? 's' : ''} (line ${negative.slice(0, 5).join(', ')}${negative.length > 5 ? ', …' : ''}).`, column: name, lines: negative.slice(0, 100) });
    if (nonInteger) problems.push({ level: 'warning', code: 'non-integer', message: `Column "${name}" has ${nonInteger} count${nonInteger > 1 ? 's' : ''} with a fraction: counts of reads are whole numbers. Are these normalized values?`, column: name });
    if (!observed) problems.push({ level: 'warning', code: 'empty-sample', message: `Column "${name}" counts no variant.`, column: name });
    samples.push({ column: name, counts, total, observed, missing, zeros, nonInteger });
  }
  return { rows: table.rows, samples, problems };
}

// Columns that are identical value for value: a sample written once per replicate (as MaveDB does
// for shared inputs), suggested as one sample. [[name, name, …], …].
export function identicalColumns(table, names) {
  // Columns with no values (a table not read yet) are not evidence of anything.
  if (!table.rows) return [];
  const groups = new Map();
  for (const name of names) {
    const column = table.columns.find((c) => c.name === name);
    if (!column) continue;
    const key = column.numeric ? column.numeric.join(',') : column.values.join('\u0001');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(name);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

// Joins tables of one or more samples each (per-sample count files) on their variant columns, into
// one table of the csv.js shape. absentMeans: 'missing' (default; NaN) or 'zero' — what a variant
// counted in another file but absent from this one means. A variant written twice in one file is
// an error. Returns { table, problems }.
export function joinCountTables(parts, options = {}) {
  const absentMeans = options.absentMeans ?? 'missing';
  const problems = [];
  const order = [];
  const index = new Map();
  const variantName = options.variantColumn ?? parts[0]?.variantColumn ?? 'variant';
  for (const part of parts) {
    const variants = part.table.columns.find((c) => c.name === part.variantColumn);
    if (!variants) {
      problems.push({ level: 'error', code: 'no-variant-column', message: `${part.name}: no column "${part.variantColumn}".` });
      continue;
    }
    for (const v of variants.values) {
      if (!index.has(v)) {
        index.set(v, order.length);
        order.push(v);
      }
    }
  }
  const n = order.length;
  const columns = [{ name: variantName, index: 0, values: order.slice(), numeric: null, type: 'text', missing: 0, missingTokens: [], nonNumeric: [], nonNumericCount: 0, integer: false }];
  const taken = new Set([variantName]);
  for (const part of parts) {
    const variants = part.table.columns.find((c) => c.name === part.variantColumn);
    if (!variants) continue;
    const seen = new Map();
    for (const [row, v] of variants.values.entries()) {
      if (seen.has(v)) problems.push({ level: 'error', code: 'duplicate-in-file', message: `${part.name}: "${v}" is written twice (lines ${part.table.lineOfRow?.[seen.get(v)] ?? seen.get(v) + 2} and ${part.table.lineOfRow?.[row] ?? row + 2}).` });
      else seen.set(v, row);
    }
    for (const name of part.countColumns) {
      const source = part.table.columns.find((c) => c.name === name);
      if (!source) continue;
      let joined = parts.length > 1 ? `${part.name}` : name;
      if (part.countColumns.length > 1 && parts.length > 1) joined = `${part.name}:${name}`;
      while (taken.has(joined)) joined += "'";
      taken.add(joined);
      if (source.numeric) {
        // A column of numbers is joined as numbers.
        const numeric = new Float64Array(n).fill(absentMeans === 'zero' ? 0 : Number.NaN);
        for (const [v, row] of seen) numeric[index.get(v)] = source.numeric[row];
        let missing = 0;
        let integer = true;
        for (let i = 0; i < n; i += 1) {
          if (Number.isNaN(numeric[i])) missing += 1;
          else if (!Number.isInteger(numeric[i])) integer = false;
        }
        columns.push({ name: joined, index: columns.length, values: null, numeric, type: 'number', missing, missingTokens: missing ? [''] : [], nonNumeric: [], nonNumericCount: 0, integer, source: { file: part.name, column: name } });
        continue;
      }
      const values = new Array(n).fill(absentMeans === 'zero' ? '0' : '');
      for (const [v, row] of seen) values[index.get(v)] = cellText(source, row);
      const numeric = new Float64Array(n);
      let missing = 0;
      let nonNumericCount = 0;
      const nonNumeric = [];
      for (let i = 0; i < n; i += 1) {
        const cell = values[i].trim();
        if (isMissing(cell)) {
          numeric[i] = Number.NaN;
          missing += 1;
        } else {
          numeric[i] = parseNumber(cell);
          if (Number.isNaN(numeric[i])) {
            nonNumericCount += 1;
            if (nonNumeric.length < 10) nonNumeric.push({ line: null, value: values[i] });
          }
        }
      }
      columns.push({ name: joined, index: columns.length, values, numeric: nonNumericCount ? null : numeric, type: nonNumericCount ? 'mixed' : 'number', missing, missingTokens: missing ? [''] : [], nonNumeric, nonNumericCount, integer: !nonNumericCount && numeric.every((x) => Number.isNaN(x) || Number.isInteger(x)), source: { file: part.name, column: name } });
    }
  }
  if (parts.length > 1) problems.push({ level: 'info', code: 'absent-means', message: `${parts.length} files joined on their variants (${n} in all); a variant absent from a file is read as ${absentMeans === 'zero' ? 'a count of 0' : 'missing (not 0)'}.` });
  return { table: { columns, rows: n, delimiter: null, lineEnd: null, header: true, diagnostics: [] }, problems };
}
