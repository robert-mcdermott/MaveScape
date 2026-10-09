// The design drafted from a table's column names (lib/importer.js, draftDesign): the roles
// MaveScape suggested at import, shared samples found in the counts, the columns not used set
// aside with the reason. Used by the Experiment view and the workflow strip.

import { toast } from './overlays.js';
import { IDENTIFIER_COLUMNS } from '../lib/design.js';
import { setAsideOtherColumns } from '../lib/design-edit.js';
import { draftDesign } from '../lib/importer.js';
import { setDesign } from '../lib/workspace.js';

export const countColumnsOf = (s) => (s?.mapping?.countColumns ?? []).filter((c) => !IDENTIFIER_COLUMNS.includes(c));

export async function draftFromColumns(app, s) {
  const { store } = app;
  let table;
  try {
    table = await app.sourceTable(s);
  } catch (error) {
    toast(`${error.message} The draft cannot find shared samples without the counts.`, { kind: 'error' });
    table = { columns: s.columns.map((c) => ({ ...c, values: [] })), rows: 0 };
  }
  const target = store.ws.targets.find((t) => t.id === s.target);
  const columns = countColumnsOf(s);
  const roles = s.roleSuggestions?.length ? [...s.roleSuggestions, ...columns.filter((c) => !s.roleSuggestions.some((r) => r.column === c)).map((column) => ({ column, role: null, group: column }))] : columns.map((column) => ({ column, role: null, group: column }));
  const { design, notes } = draftDesign(table, roles, { variantColumn: s.mapping.variantColumn, level: s.mapping.level, target, name: s.name.replace(/\.[^.]+$/, '') });
  if (!target) design.targets = [];
  const complete = setAsideOtherColumns(design, s.columns.map((c) => c.name), IDENTIFIER_COLUMNS);
  store.commit(setDesign(store.ws, complete, `Drafted the design of ${s.name} from its column names`, s.id), 'Draft the design from the column names');
  for (const note of notes) toast(note);
}
