// The analysis package (wave 2, slice 10; requirement E8): what an experiment's analysis needs,
// written out as the files `mavescape run` reads and the MAVE minimum information asks for, so that
// the package that analyzes an experiment is the one that deposits it (wave 3). A ZIP of
//
//   README.md           what each file is, the command that runs it, and the readiness: what each
//                       analysis can do with these files, and what is missing and where it is
//                       usually found
//   counts/<file>       the count table as imported, byte for byte (each part of a table joined
//                       from several files; a table of barcodes' map after it)
//   target.fasta        the target sequence
//   design.json         the design: which column is which sample, the controls, the bins' gates,
//                       the cells recorded, what the assay measures
//   samples.csv         the design as a sample sheet, one row per column of counts
//   parameters.json     the parameters (a run's, or MaveScape's defaults for the design)
//   readiness.json      the readiness as data (readiness.js)
//
// Written deterministically, dated with the workspace's modification time in UTC. Nothing is filled
// in: a gap is named in the README, not guessed.

import { createZip } from './zip.js';
import { sha256 } from './sha256.js';
import { readiness, readinessText } from './readiness.js';
import { defaultParameters, withDefaults } from './score.js';
import { sampleSheetCSV } from './samplesheet.js';

const encoder = new TextEncoder();
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const shellQuote = (text) => `'${String(text).replace(/'/g, "'\\''")}'`;
const safe = (name) => String(name).replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'file';

// A target as FASTA, 60 to a line.
export function targetFASTA(target) {
  const lines = [];
  for (let i = 0; i < target.sequence.length; i += 60) lines.push(target.sequence.slice(i, i + 60));
  return `>${target.id} ${target.name}\n${lines.join('\n')}\n`;
}

// What the package holds, without the tables' bytes: { source, design, parameters, run, counts:
// [{ path, fileName, sha256, role }], readiness }. run: a run of the workspace (its design and
// parameters), else the workspace's design with MaveScape's defaults.
export function packageContents(ws, { run = null } = {}) {
  const source = run ? ws.sources.find((s) => s.sha256 === run.inputs.source.sha256) : ws.sources.find((s) => s.id === ws.designSource) ?? ws.sources[0];
  const design = run ? run.inputs.design : ws.design;
  if (!source) throw new Error('There is no count table to package: open one first.');
  if (!design) throw new Error('There is no design to package: say which column is which sample first (Experiment).');
  const parameters = run ? withDefaults(run.inputs.parameters) : defaultParameters(design, source);
  const used = new Set();
  const counts = (source.files?.length ? source.files : [{ fileName: source.fileName ?? source.name, sha256: source.sha256 }]).map((f) => {
    let name = safe(f.fileName ?? 'counts.csv');
    for (let n = 2; used.has(name); n += 1) name = `${n}_${safe(f.fileName ?? 'counts.csv')}`;
    used.add(name);
    return { path: `counts/${name}`, fileName: f.fileName ?? name, sha256: f.sha256, role: f.role ?? 'counts' };
  });
  return { source, design, parameters, run, counts, readiness: readiness({ ...ws, design, designSource: source.id }) };
}

// The README: the files, the command, the readiness.
function readme(ws, contents, sheet, software) {
  const { design, run, counts, parameters } = contents;
  const target = design.targets?.[0];
  const acknowledged = Object.entries(ws.qc?.acknowledged ?? {});
  const command = ['mavescape run --design design.json --parameters parameters.json', ...acknowledged.map(([id, a]) => `--acknowledge ${shellQuote(`${id}=${a.reason}`)}`), '--out results', ...counts.map((c) => c.path)].join(' \\\n        ');
  return `# ${design.name ?? ws.name}: analysis package

Written by MaveScape ${software?.version ?? ''} from the workspace "${ws.name}"${run ? `, ${run.name} (${run.id})` : ''}, ${ws.modified}.

These are the files \`mavescape run\` reads, and what the MAVE minimum information asks for of an
experiment: the counts, the target, the design (with what the assay measures) and the parameters.

| File | What it is |
| --- | --- |
${counts.map((c) => `| \`${c.path}\` | ${c.role === 'map' ? 'the barcode-to-variant map' : counts.length > 1 ? 'a part of the count table' : 'the count table'}, as imported (SHA-256 ${c.sha256}) |`).join('\n')}
| \`target.fasta\` | ${target ? `the target, ${target.name} (${target.sequence.length} ${target.sequenceType === 'dna' ? 'nt' : 'residues'})` : 'the target'} |
| \`design.json\` | the design: which column is which sample, the controls, the gates and cells recorded, what the assay measures (docs/FORMATS.md) |
| \`samples.csv\` | the design as a sample sheet, one row per column of counts${sheet.complete ? '' : '. It cannot say all of this design (a sample in two roles, or a unit of time or bin measure a sheet has no name for): design.json is the design'}; the gates, the readout and the controls are design.json's alone |
| \`parameters.json\` | ${run ? `the parameters of ${run.name}` : 'MaveScape\'s default parameters for this design'} (${parameters.model}${parameters.model === 'wls' || parameters.model === 'ols' ? ' regression' : ''}, ${parameters.combination} combination) |
| \`readiness.json\` | what each analysis can do with these files, and what is missing, as data |

## Run it

    ${command}

${run ? `With these files it scores as ${run.name} did: output SHA-256 ${run.output.sha256}.` : 'Score it in MaveScape, or with the command above.'}

## What the analysis can do, and what is missing

${readinessText(contents.readiness)}
`;
}

// The package's files: [{ name, data }], and the ZIP. options: { run, sources: Map(sha256 → bytes),
// software: { version } }.
export async function writePackage(ws, options = {}) {
  const contents = packageContents(ws, options);
  const sheet = sampleSheetCSV(contents.design);
  const files = [];
  files.push({ name: 'README.md', data: encoder.encode(readme(ws, contents, sheet, options.software)) });
  for (const c of contents.counts) {
    const bytes = options.sources?.get(c.sha256);
    if (!bytes) throw new Error(`The table ${c.fileName} (SHA-256 ${c.sha256.slice(0, 12)}…) is not in the library: open it again.`);
    if (sha256(bytes) !== c.sha256) throw new Error(`The table ${c.fileName} in the library is not the one imported (its SHA-256 differs).`);
    files.push({ name: c.path, data: bytes });
  }
  if (contents.design.targets?.[0]) files.push({ name: 'target.fasta', data: encoder.encode(contents.design.targets.map(targetFASTA).join('')) });
  files.push({ name: 'design.json', data: encoder.encode(json(contents.design)) });
  files.push({ name: 'samples.csv', data: encoder.encode(sheet.csv) });
  files.push({ name: 'parameters.json', data: encoder.encode(json(contents.parameters)) });
  files.push({ name: 'readiness.json', data: encoder.encode(json(contents.readiness)) });
  const bytes = await createZip(files, { date: new Date(ws.modified), utc: true });
  return { bytes, files, contents, sheet };
}
