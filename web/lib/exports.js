// Exports (requirement R1): a run's scores and the counts it scored, as CSV in MaveDB's column
// conventions (hgvs_nt, hgvs_splice, hgvs_pro first, NA for a missing value); QC per sample and
// per variant; the selected variants; the run's provenance as JSON. Numbers are written in
// JavaScript's shortest form that reads back to the same double, so an exported table imports
// again without loss (validation suite `roundtrip`). Lines end in LF; the same inputs always
// give the same bytes.

import { KIND_NAMES, STATUS_NAMES } from './variants.js';
import { STAGE_BY_CODE, flagNames, REPLICATE_STATE_NAMES } from './filters.js';
import { describeParameters, isBarcodeRun } from './runs.js';
import { DIFFERENTIAL_REASON_NAMES } from './differential.js';
import { canonicalJSON } from './workspace.js';
import { sha256 } from './sha256.js';
import { columnText } from './csv.js';

export const EXPORT_VERSION = 1;
const Z = 1.959963984540054;

export const num = (x) => (Number.isFinite(x) ? String(x) : 'NA');
const cell = (value) => {
  const s = String(value ?? 'NA');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const csv = (header, rows) => `${[header, ...rows].map((r) => r.map(cell).join(',')).join('\n')}\n`;

// The MaveDB identifier columns for a design's variants: the name in its own column, NA in the
// others.
function hgvsColumns(level, key) {
  if (level === 'protein') return ['NA', 'NA', key || 'NA'];
  if (level === 'splice') return ['NA', key || 'NA', 'NA'];
  return [key || 'NA', 'NA', 'NA'];
}

const safe = (id) => String(id).replace(/[^A-Za-z0-9_.-]+/g, '_');

// A variant's state in words: scored, low confidence, filtered (stage), not measured.
export function statusOf(c, i) {
  if (c.reason[i]) {
    const stage = STAGE_BY_CODE.get(c.reason[i]);
    return stage.id === 'measured' ? 'not measured' : `filtered: ${stage.id}`;
  }
  return c.flags[i] ? 'low confidence' : 'scored';
}

// The scores of one condition of a run, one row per variant of the table, in table order.
export function scoresCSV(results, run, condition = 0) {
  const c = results.conditions[condition];
  const level = run.inputs.design.variants.level;
  const v = results.variants;
  const reps = results.replicates.filter((r) => c.replicates.includes(r.id));
  const header = ['hgvs_nt', 'hgvs_splice', 'hgvs_pro', 'score', 'SE', 'ci95_lower', 'ci95_upper', 'replicates', 'replicates_expected', 'status', 'flags', 'tau2', 'I2', 'leave_one_out', 'variant_as_written', 'variant_class',
    ...reps.flatMap((r) => [`score_${safe(r.id)}`, `SE_${safe(r.id)}`])];
  const rows = [];
  for (let i = 0; i < results.rows; i += 1) {
    const scored = !c.reason[i];
    rows.push([
      ...hgvsColumns(level, v.key[i]),
      num(scored ? c.score[i] : Number.NaN), num(scored ? c.se[i] : Number.NaN),
      num(scored ? c.score[i] - Z * c.se[i] : Number.NaN), num(scored ? c.score[i] + Z * c.se[i] : Number.NaN),
      String(c.k[i]), String(c.expected[i]), statusOf(c, i), c.flags[i] ? flagNames(c.flags[i]).join('; ') : '',
      num(c.tau2[i]), num(c.i2[i]), num(c.loo[i]), v.original[i], v.status[i] === 3 ? 'invalid' : KIND_NAMES[v.kind[i]],
      ...reps.flatMap((r) => [num(r.score[i]), num(r.se[i])]),
    ]);
  }
  return csv(header, rows);
}

// The counts the run scored: the design's variant column (and a table of barcodes' barcodes) and
// every count column it uses (copies of shared samples too), as the table has them, NA where a
// count is missing.
export function countsCSV(table, design) {
  const byName = new Map(table.columns.map((col) => [col.name, col]));
  const names = columnText(byName.get(design.variants.column));
  const barcodeColumn = design.library?.level === 'barcode' ? design.library.barcodeColumn : null;
  const barcodes = barcodeColumn ? columnText(byName.get(barcodeColumn)) : null;
  const columns = [...design.samples.flatMap((s) => s.columns), ...(design.ignoredColumns ?? []).filter((x) => x.copyOf).map((x) => x.column)];
  const level = design.variants.level;
  const header = [...(barcodeColumn ? [barcodeColumn] : []), ...['hgvs_nt', 'hgvs_splice', 'hgvs_pro'].filter((h) => h !== design.variants.column), design.variants.column, ...columns];
  const rows = names.map((name, i) => {
    const ids = hgvsColumns(level, name);
    const identity = ['hgvs_nt', 'hgvs_splice', 'hgvs_pro'].map((h, k) => [h, ids[k]]).filter(([h]) => h !== design.variants.column).map(([, x]) => x);
    return [...(barcodes ? [barcodes[i]] : []), ...identity, name, ...columns.map((c) => num(byName.get(c).numeric ? byName.get(c).numeric[i] : Number.NaN))];
  });
  return csv(header, rows);
}

// A table of barcodes, barcode by barcode: its variant (MAVE-HGVS, and as written), and in each
// replicate its counts (before and after; for sorted bins, in each bin), its score and SE, its
// departure from its variant's other barcodes (z over √φ), whether it is an outlier, and whether
// it was used. NA where a replicate does not count it.
export function barcodesCSV(results, run) {
  const b = results.barcodes;
  if (!b) throw new Error(`${run.name} scored a table of variants, not of barcodes.`);
  const counts = new Map((results.samples ?? []).map((x) => [x.id, x.barcodeCounts]));
  const reps = results.replicates;
  const level = run.inputs.design.variants.level;
  const header = ['barcode', level === 'protein' ? 'hgvs_pro' : 'hgvs_nt', 'variant_as_written', ...reps.flatMap((r) => (r.bins
    ? r.samples.map((_, k) => `bin${k + 1}_${safe(r.id)}`)
    : ['before', 'after', 'score', 'SE', 'z', 'outlier', 'used'].map((x) => `${x}_${safe(r.id)}`)))];
  const v = results.variants;
  const rows = [];
  for (let m = 0; m < b.rows; m += 1) {
    const i = b.variantOf[m];
    const cells = [b.ids[m], i >= 0 ? v.key[i] || 'NA' : 'NA', i >= 0 ? v.original[i] : 'NA'];
    for (const r of reps) {
      const here = r.samples.map((id) => counts.get(id)?.[m] ?? Number.NaN);
      if (r.bins) {
        cells.push(...here.map(num));
        continue;
      }
      const rb = r.barcodes;
      const counted = here.every(Number.isFinite);
      const used = !counted || i < 0 ? 'no' : rb.outlier[m] && rb.excluded ? 'no (outlier)' : rb.state[m] ? REPLICATE_STATE_NAMES[rb.state[m]] : 'yes';
      cells.push(num(here[0]), num(here[here.length - 1]), num(rb.score[m]), num(rb.se[m]), num(rb.z[m]), counted ? (rb.outlier[m] ? 'yes' : 'no') : 'NA', used);
    }
    rows.push(cells);
  }
  return csv(header, rows);
}

// Differential scores between conditions, one row per variant of the table: for each contrast
// (each condition against the reference) the difference, its SE, 95% interval, p and BH-adjusted
// q, the method, the pairs or replicates behind it (limma: t), and why there is none. NA where
// there is none.
export function differentialCSV(results, run) {
  const ds = results.differential;
  if (!ds?.length) throw new Error(`${run.name} compares no conditions.`);
  const level = run.inputs.design.variants.level;
  const v = results.variants;
  const header = ['hgvs_nt', 'hgvs_splice', 'hgvs_pro', 'variant_as_written', ...ds.flatMap((d) => ['difference', 'SE', 'ci95_lower', 'ci95_upper', d.method === 'limma' ? 't' : 'z', 'p', 'q', d.method === 'limma' ? 'replicates' : 'pairs', 'status'].map((x) => `${x}_${safe(d.id)}`))];
  const rows = [];
  for (let i = 0; i < results.rows; i += 1) {
    rows.push([...hgvsColumns(level, v.key[i]), v.original[i], ...ds.flatMap((d) => {
      const ok = !d.reason[i];
      const x = (a) => num(ok ? a[i] : Number.NaN);
      return [x(d.delta), x(d.se), x(d.ciLow), x(d.ciHigh), x(d.z), x(d.p), x(d.q), ok ? String(d.k[i]) : 'NA', DIFFERENTIAL_REASON_NAMES[d.reason[i]]];
    })]);
  }
  return csv(header, rows);
}

// QC per sample (qc.js samples).
export function qcSamplesCSV(qc) {
  const header = ['sample', 'columns', 'roles', 'counted', 'missing', 'missing_fraction', 'total_reads', 'reads_per_variant', 'zeros', 'zero_fraction', `below_${qc.measures.lowCount}`, 'low_fraction', 'q05', 'q25', 'median', 'q75', 'q95'];
  return csv(header, qc.samples.map((s) => [s.id, s.columns.join('+'), s.roles.map((r) => `${r.replicate}:${r.role}${r.time !== undefined ? `@${r.time}` : ''}`).join(' '), String(s.counted), String(s.missing), num(s.missingFraction), num(s.total), num(s.readsPerVariant), String(s.zeros), num(s.zeroFraction), String(s.low), num(s.lowFraction), ...s.quantiles.map(num)]));
}

// The QC findings (wave 2, slice 8): each with its status, what it found, its threshold, the
// causes that fit it and what to do next, and its acknowledgement (reason, the status it was
// acknowledged at), if one holds.
export function qcFindingsCSV(findings) {
  const header = ['finding', 'title', 'status', 'blocking', 'from', 'value', 'threshold', 'acknowledged', 'acknowledged_status', 'reason', 'causes', 'next'];
  const join = (list) => (list?.length ? list.map((x) => `${x.kind}: ${x.text}`).join(' | ') : 'NA');
  return csv(header, findings.map((f) => [f.id, f.title, f.status === 'na' ? 'not assessed' : f.status, f.blocking ? 'yes' : 'no', f.level ?? 'counts', f.value, f.threshold, f.acknowledged?.current ? 'yes' : 'no', f.acknowledged?.current ? f.acknowledged.status : 'NA', f.acknowledged?.current ? f.acknowledged.reason : 'NA', join(f.advice?.causes), join(f.advice?.next)]));
}

// QC per variant: how each replicate measured it, and the flags of its score.
export function qcVariantsCSV(results, run, condition = 0) {
  const c = results.conditions[condition];
  const level = run.inputs.design.variants.level;
  const reps = results.replicates.filter((r) => c.replicates.includes(r.id));
  const header = ['hgvs_nt', 'hgvs_splice', 'hgvs_pro', 'name_status', 'status', 'flags', ...reps.flatMap((r) => [`before_${safe(r.id)}`, `after_${safe(r.id)}`, `used_${safe(r.id)}`])];
  const v = results.variants;
  const rows = [];
  for (let i = 0; i < results.rows; i += 1) {
    rows.push([...hgvsColumns(level, v.key[i] || v.original[i]), STATUS_NAMES[v.status[i]], statusOf(c, i), c.flags[i] ? flagNames(c.flags[i]).join('; ') : '',
      ...reps.flatMap((r) => [num(r.first[i]), num(r.last[i]), r.state[i] ? REPLICATE_STATE_NAMES[r.state[i]] : 'yes'])]);
  }
  return csv(header, rows);
}

// The selected variants (MAVE-HGVS keys) with their scores in a run, as CSV and JSON.
export function selectionCSV(keys, results, run, condition = 0) {
  const c = results.conditions[condition];
  const index = new Map(results.variants.key.map((k, i) => [k, i]));
  return csv(['hgvs_pro', 'score', 'SE', 'status'], keys.map((k) => {
    const i = index.get(k);
    return i === undefined ? [k, 'NA', 'NA', 'not in the table'] : [k, num(c.reason[i] ? Number.NaN : c.score[i]), num(c.reason[i] ? Number.NaN : c.se[i]), statusOf(c, i)];
  }));
}

export function selectionJSON(selection, run) {
  return `${JSON.stringify({ format: 'mavescape-selection', version: EXPORT_VERSION, name: selection.name, run: run?.id ?? selection.run, condition: selection.condition ?? 0, created: selection.created, keys: selection.keys }, null, 2)}\n`;
}

// The run's provenance: what was scored, how, by which software, what came out, and the QC.
// files: [{ path, sha256 }] of what is exported with it.
export function provenanceJSON(run, ws, { qc = null, findings = null, thresholds = null, files = [] } = {}) {
  const source = ws.sources.find((s) => s.sha256 === run.inputs.source.sha256);
  const doc = {
    format: 'mavescape-provenance',
    version: EXPORT_VERSION,
    run: {
      id: run.id,
      name: run.name,
      created: run.created,
      software: run.software,
      parameters: run.inputs.parameters,
      description: describeParameters(run.inputs.parameters, isBarcodeRun(run)),
      output: run.output,
      warnings: run.warnings,
    },
    inputs: {
      table: { name: run.inputs.source.name, sha256: run.inputs.source.sha256, rows: run.inputs.source.rows, encoding: source?.encoding ?? null, delimiter: source?.delimiter ?? null, imported: source?.imported ?? null },
      mapping: run.inputs.mapping,
      design: run.inputs.design,
      designSha256: null,
    },
    qc: findings ? { thresholds, findings: findings.map((f) => ({ id: f.id, status: f.status, blocking: f.blocking, value: f.value, threshold: f.threshold, ...(f.acknowledged?.current ? { acknowledged: { reason: f.acknowledged.reason, status: f.acknowledged.status, time: f.acknowledged.time } } : {}) })), measures: qc?.measures ?? null } : null,
    workspace: { id: ws.id, name: ws.name, historyHead: ws.history.at(-1)?.hash ?? null, historyEntries: ws.history.length },
    files,
    researchUse: 'Experimental functional effects for research. Not a clinical classification: no variant is called pathogenic or benign.',
  };
  return doc;
}

// The provenance as text, with the design's SHA-256 filled in (of its canonical JSON).
export function provenanceText(doc) {
  const encoder = new TextEncoder();
  const out = { ...doc, inputs: { ...doc.inputs, designSha256: sha256(encoder.encode(canonicalJSON(doc.inputs.design))) } };
  return `${JSON.stringify(out, null, 2)}\n`;
}
