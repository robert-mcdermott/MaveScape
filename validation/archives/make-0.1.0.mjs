// Writes a workspace archive with MaveScape 0.1.0's own code (run from a v0.1.0 checkout):
// the GRB2 SH3 example, scored twice (defaults and Enrich2-compatible), a selection and a
// changed QC threshold. Usage: node make.mjs <v0.1.0 checkout> <out.msz>
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [root, out] = process.argv.slice(2);
const lib = (p) => import(pathToFileURL(join(root, p)).href);
const { buildWorkspace, allExports, scoreTable, SOFTWARE } = await lib('validation/roundtrip-cases.mjs');
const { writeArchive } = await lib('web/lib/archive.js');
const { PRESETS } = await lib('web/lib/score.js');
const { addRun, makeRun, runInputs } = await lib('web/lib/runs.js');

const bytes = new Uint8Array(readFileSync(join(root, 'web/examples/grb2-sh3/counts.csv')));
const design = JSON.parse(readFileSync(join(root, 'web/examples/grb2-sh3/design.json'), 'utf8'));
const built = buildWorkspace({ bytes, design, fileName: 'counts.csv', name: 'GRB2 SH3 (saved by MaveScape 0.1.0)' });
let ws = built.ws;
const exports = allExports(ws, built.table, built.results);
// A second run, with the Enrich2-compatible preset.
const second = scoreTable(built.table, design, PRESETS.enrich2.parameters);
if (!second.ok) throw new Error(second.errors.join(' '));
const run2 = makeRun({ inputs: runInputs({ source: ws.sources[0], design, parameters: PRESETS.enrich2.parameters }), source: ws.sources[0], results: second.results, software: SOFTWARE, name: 'Enrich2-compatible', created: '2026-10-09T12:07:00.000Z' });
ws = addRun(ws, run2).ws;
const sources = new Map([[ws.sources[0].sha256, bytes]]);
const archive = await writeArchive(ws, { software: SOFTWARE, sources, results: new Map([[built.run.id, built.results]]), methods: exports.methods });
writeFileSync(out, archive.bytes);
console.log(`${out}: ${archive.bytes.length} bytes; runs ${ws.runs.map((r) => `${r.name} ${r.output.sha256.slice(0, 12)}`).join(', ')}`);
