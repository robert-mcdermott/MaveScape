// A MaveDB score set kept beside the workspace without opening it (providers/mavedb-scores.js), read
// as published (wave 4, slice 3; requirement C1): its scores table parsed and its layout found as
// opening the record finds them (importer.js), the design of its published scores (mavedb.js,
// scoresDesign) with the target kept and the direction a person stated, and the scores read by the
// engine's model 'published' (score.js). The same results as opening the record would give its
// run "Published scores". Pure: the window, remote control and the validation share it.

import { columnText, parseTable } from './csv.js';
import { engineColumns } from './design.js';
import { detectLayout } from './importer.js';
import { scoresDesign } from './mavedb.js';
import { defaultParameters, scoreExperiment } from './score.js';

// text: the scores CSV as MaveDB sent it; scoreSet: the record kept (annotation.record.scoreSet).
// Returns { design, parameters, results } or { error }.
export function scoreSetResults(text, scoreSet) {
  if (!scoreSet?.target) return { error: 'The score set\'s record names no target.' };
  const table = parseTable(text, { fileName: 'scores.csv' });
  const layout = detectLayout(table);
  if (!layout.variantColumn) return { error: `${scoreSet.urn}'s scores have no column of variant names.` };
  const design = scoresDesign(scoreSet, { table, layout, target: scoreSet.target });
  if (scoreSet.readout?.direction) design.readout = { ...(design.readout ?? {}), direction: scoreSet.readout.direction };
  const byName = new Map(table.columns.map((c) => [c.name, c]));
  const names = columnText(byName.get(design.variants.column));
  const columns = {};
  for (const name of engineColumns(design)) {
    const column = byName.get(name);
    if (!column) return { error: `${scoreSet.urn}'s scores have no column "${name}".` };
    if (column.numeric) columns[name] = column.numeric.slice();
    else if (column.type === 'empty') columns[name] = new Float64Array(table.rows).fill(Number.NaN);
    else return { error: `${scoreSet.urn}'s column "${name}" is not all numbers.` };
  }
  const parameters = defaultParameters(design);
  const scored = scoreExperiment({ names, columns, design, parameters, mode: 'lenient' });
  if (!scored.ok) return { error: `${scoreSet.urn}'s scores could not be read: ${scored.errors.join(' ')}` };
  return { design, parameters, results: scored.results };
}
