// The scoring engine's input from a parsed table (moved from web/ui/score-input.js in wave 6,
// slice 6, so that the window's workers and the certificate, lib/certificate.js, read a table
// alike): the variant names (and a table of barcodes' barcodes) and copies of the design's count
// columns, or a design of published scores' columns of scores (the table keeps its own). A column
// with no values at all (every cell missing) is passed as missing counts, for QC to report; a
// column of text is refused.

import { columnText } from './csv.js';
import { engineColumns } from './design.js';

export function engineInput(table, design) {
  const byName = new Map(table.columns.map((c) => [c.name, c]));
  const variantColumn = byName.get(design.variants.column);
  const names = variantColumn ? columnText(variantColumn) : null;
  if (!names) throw new Error(`The table has no column "${design.variants.column}" of variant names.`);
  const columns = {};
  for (const name of engineColumns(design)) {
    const column = byName.get(name);
    if (!column) throw new Error(`The table has no column "${name}".`);
    if (column.numeric) columns[name] = column.numeric.slice();
    else if (column.type === 'empty') columns[name] = new Float64Array(table.rows).fill(Number.NaN);
    else throw new Error(`Column "${name}" is not all numbers.`);
  }
  let barcodes = null;
  if (design.library?.level === 'barcode') {
    const column = byName.get(design.library.barcodeColumn);
    if (!column) throw new Error(`The table has no column "${design.library.barcodeColumn}" of barcodes.`);
    barcodes = columnText(column);
  }
  return { names, barcodes, columns, transfer: Object.values(columns).map((c) => c.buffer) };
}
