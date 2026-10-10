// The bundled examples opened as the window opens them (web/ui/examples.js), for the validation
// suite `examples` (wave 2, slice 11): the files read (a published example's from web/examples/,
// a simulated one's from its seed), assembled (Hsp90's codon variants read at the protein level),
// the design set, scored with MaveScape's defaults and what the example sets, its QC and its
// readiness.

import { readFileSync } from 'node:fs';
import { parseTable } from '../web/lib/csv.js';
import { assembleTable } from '../web/lib/assemble.js';
import { defaultParameters, withDefaults } from '../web/lib/score.js';
import { computeQC } from '../web/lib/qc.js';
import { defaultThresholds, findingsFrom } from '../web/lib/findings.js';
import { readiness } from '../web/lib/readiness.js';
import { simulatedExample } from '../web/lib/examples.js';
import { inputFor, scoreTable } from './roundtrip-cases.mjs';
import { workspaceOf } from './readiness-cases.mjs';

const web = (path) => new URL(`../web/${path}`, import.meta.url);
const encoder = new TextEncoder();

// The data set of validation/sources.json each published example's counts come from.
export const EXAMPLE_DATASETS = { 'grb2-sh3': 'mavedb-grb2-sh3', hsp90: 'mavedb-hsp90', factor9: 'mavedb-factor9' };

export function openExampleInNode(example, extra = {}) {
  let parts;
  let design;
  let sim = null;
  if (example.simulated) {
    sim = simulatedExample(example);
    parts = sim.files.map((f) => ({ name: f.name, bytes: encoder.encode(f.text), role: f.role }));
    design = sim.design;
  } else {
    parts = [{ name: 'counts.csv', bytes: new Uint8Array(readFileSync(web(example.files.counts))), role: 'counts' }];
    design = JSON.parse(readFileSync(web(example.files.design), 'utf8'));
  }
  if (extra.design) design = extra.design(design);
  const assembled = assembleTable(parts.map((p) => ({ name: p.name, table: parseTable(p.bytes, { fileName: p.name }), role: p.role })), { level: design.variants.level, target: design.targets[0], ...(example.assembly ?? {}) });
  const table = assembled.table;
  const ws = workspaceOf(table, design);
  const parameters = withDefaults({ ...defaultParameters(design, ws.sources[0]), ...(example.parameters ?? {}), ...(extra.parameters ?? {}) });
  const scored = scoreTable(table, design, parameters);
  const qc = computeQC({ ...inputFor(table, design), design, results: scored.ok ? scored.results : null });
  const findings = findingsFrom(qc, defaultThresholds());
  return { parts, design, assembled, table, ws, parameters, scored, findings, readiness: readiness(ws), sim };
}

// The findings that do not pass, as { id: status }.
export const raisedOf = (findings) => Object.fromEntries(findings.filter((f) => f.status === 'review' || f.status === 'fail').map((f) => [f.id, f.status]));
