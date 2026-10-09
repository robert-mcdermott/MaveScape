// The score worker's input from a parsed table: the variant names (and a table of barcodes' barcodes)
// and copies of the design's count columns (the table keeps its own). A column with no values at
// all (every cell missing) is passed as missing counts, for QC to report; a column of text is
// refused.

import { columnText } from '../lib/csv.js';

// Scores in the score worker: { promise, cancel }. A table of barcodes' identifiers, which the
// worker does not send back (the window has them: a million strings copied for nothing), are put
// back on the results.
export function runScore(app, payload, options = {}) {
  const job = app.worker('score').run('score', payload, options);
  const promise = job.promise.then((result) => {
    if (result.ok && result.results.barcodes) result.results.barcodes.ids = payload.barcodes;
    return result;
  });
  return { promise, cancel: job.cancel };
}

export function workerInput(table, design) {
  const byName = new Map(table.columns.map((c) => [c.name, c]));
  const variantColumn = byName.get(design.variants.column);
  const names = variantColumn ? columnText(variantColumn) : null;
  if (!names) throw new Error(`The table has no column "${design.variants.column}" of variant names.`);
  const columns = {};
  for (const sample of design.samples) {
    for (const name of sample.columns) {
      const column = byName.get(name);
      if (!column) throw new Error(`The table has no column "${name}".`);
      if (column.numeric) columns[name] = column.numeric.slice();
      else if (column.type === 'empty') columns[name] = new Float64Array(table.rows).fill(Number.NaN);
      else throw new Error(`Column "${name}" is not all numbers.`);
    }
  }
  let barcodes = null;
  if (design.library?.level === 'barcode') {
    const column = byName.get(design.library.barcodeColumn);
    if (!column) throw new Error(`The table has no column "${design.library.barcodeColumn}" of barcodes.`);
    barcodes = columnText(column);
  }
  return { names, barcodes, columns, transfer: Object.values(columns).map((c) => c.buffer) };
}
