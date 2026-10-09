// The score worker's input from a parsed table: the variant names and copies of the design's
// count columns (the table keeps its own). A column with no values at all (every cell missing) is
// passed as missing counts, for QC to report; a column of text is refused.

export function workerInput(table, design) {
  const byName = new Map(table.columns.map((c) => [c.name, c]));
  const names = byName.get(design.variants.column)?.values;
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
  return { names, columns, transfer: Object.values(columns).map((c) => c.buffer) };
}
