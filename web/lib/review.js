// Review reports (wave 6, slice 7; requirement R7; after CytoWeave 0.8.0's review-report.js): a
// certified analysis as one self-contained HTML file that a reviewer, a collaborator or a PI opens
// in any browser, without MaveScape: the experiment and design, the inputs with their checksums,
// each run's parameters, classes and maps, the QC findings with their plots, the comparisons and
// robustness checks kept in the report, the selections, structure views and figures, the methods
// and the decision log, and the certificate's fingerprint with what it proves and does not.
//
// Every number in it is traced: clicked (or Enter on it), it says where it comes from. Each
// carries data-k, its key, and data-v, its exact value: a number the certificate certifies has the
// certificate's key (lib/certificate.js, numberItems) and value; one the workspace records (a
// parameter, an output's recorded SHA-256) has the key ws|<its path in workspace.json>; one
// counted from the certificate's classes has the key count|<run>|<condition>|<class>. The whole
// certificate is in the file (the JSON block mavescape-review), so the file's numbers can be
// checked against its fingerprint in the file itself.
//
// The file loads nothing: its styles and script are inline, its maps, plots and figures inline SVG
// (a structure's image as a data: URI), and links (DOIs) are only followed when clicked. It has no
// time of its own: the same certificate gives the same bytes.

import { CLASS_NAMES, CONTRAST_CLASS_NAMES } from './robustness.js';
import { buildMapModel } from './map-model.js';
import { mapSVG } from './map-svg.js';
import { proteinView } from './collapse.js';
import { qcPanelData } from './qc-plots.js';
import { comparisonCharts } from './view-plots.js';
import { chartsPanel } from './figure-plots.js';
import { marksToSVGSync } from './draw.js';
import { panelSummary, toMM } from './figures.js';
import { panelInputs } from './figure-manifest.js';
import { describeMethod, describeParameters, isBarcodeRun } from './runs.js';
import { withDefaults } from './score.js';
import { replicateSamples } from './design.js';
import { describeReadout } from './readout.js';
import { analysisName } from './report.js';
import { sha256 } from './sha256.js';
import { serializeWorkspace, verifyHistory } from './workspace.js';

export const REVIEW_FORMAT = 'mavescape-review';
export const REVIEW_VERSION = 1;
const encoder = new TextEncoder();

const esc = (text) => String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[c]);
const count = (n) => (typeof n === 'number' ? n.toLocaleString('en-US') : '—');
const plural = (n, word, many = `${word}s`) => `${count(n)} ${n === 1 ? word : many}`;
const asNumber = (v) => (typeof v === 'number' ? v : v === 'NaN' ? Number.NaN : v === 'Infinity' ? Infinity : v === '-Infinity' ? -Infinity : null);
const shortFingerprint = (fingerprint) => (fingerprint ? fingerprint.slice(0, 16).replace(/(.{4})(?!$)/g, '$1-') : '');
const STATUS = { pass: ['pass', 'ok'], review: ['review', 'warn'], fail: ['fail', 'danger'], na: ['not assessed', 'muted'] };

// A number as the report shows it: integers whole, others to `digits` significant digits.
export function formatNumber(x, digits = 4) {
  if (typeof x !== 'number') return String(x ?? '—');
  if (!Number.isFinite(x)) return x === Infinity ? '∞' : x === -Infinity ? '−∞' : '—';
  if (Number.isInteger(x)) return x.toLocaleString('en-US');
  if (x !== 0 && Math.abs(x) < 1e-3) return x.toExponential(digits - 1).replaceAll('-', '−');
  return String(Number(x.toPrecision(digits))).replace('-', '−');
}

// A traced value: a button (reachable from the keyboard) whose text is the value as shown.
export function traced(key, value, text = null) {
  const shown = text ?? (typeof value === 'number' ? formatNumber(value) : asNumber(value) !== null ? formatNumber(asNumber(value)) : String(value ?? '—'));
  return `<button type="button" class="n" data-k="${esc(key)}" data-v="${esc(JSON.stringify(value ?? null))}">${esc(shown)}</button>`;
}

// A value the workspace records, traced to its path in workspace.json (segments joined by dots).
const recorded = (path, value, text = null) => traced(`ws|${path}`, value, text);

// A value at a path of the workspace document ("runs.0.inputs.parameters.pseudocount"; a list's
// length as "length"), for checking a ws| key.
export function workspaceValue(ws, path) {
  return path.split('.').reduce((v, k) => (v === null || v === undefined ? undefined : v[/^\d+$/.test(k) ? Number(k) : k]), ws);
}

// SVG made unique on the page: its ids (patterns, clip paths) prefixed, and named for assistive
// technology when it is not.
function placed(svg, prefix, label) {
  const ids = [...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  let out = svg;
  for (const id of ids) out = out.replaceAll(`id="${id}"`, `id="${prefix}-${id}"`).replaceAll(`url(#${id})`, `url(#${prefix}-${id})`);
  if (!/<svg[^>]*\saria-label=/.test(out) && !/<svg[^>]*>\s*<title>/.test(out)) out = out.replace('<svg ', `<svg aria-label="${esc(label)}" `);
  return out.trim();
}

// A panel of charts (lib/figure-plots.js) as SVG, w × h points.
function chartsSVG(data, { w = 380, h = 240, title, prefix }) {
  const drawn = chartsPanel({ x: 8, y: 6, w: w - 16, h: h - 12 }, data, { text: 9, title: '' });
  return placed(marksToSVGSync(drawn.marks, w, h, { title, desc: drawn.description, background: '#ffffff', sized: false }), prefix, title);
}

function section(id, title, body) {
  return { id, title, html: `<section id="${id}" aria-labelledby="${id}-h"><h2 id="${id}-h">${esc(title)}</h2>${body}</section>` };
}

const scroll = (label, inner) => `<div class="scroll" tabindex="0" role="region" aria-label="${esc(label)}">${inner}</div>`;
const table = (label, head, rows) => scroll(label, `<table><thead><tr>${head.map((h) => `<th${h.r ? ' class="r"' : ''} scope="col">${esc(h.text ?? h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`);
const row = (cells) => `<tr>${cells.map((c) => `<td${c.r ? ' class="r"' : ''}>${c.html ?? esc(c)}</td>`).join('')}</tr>`;

// --- The sections ---------------------------------------------------------------------------------

function overview(ws, certificate, history) {
  const runs = ws.runs ?? [];
  const tables = new Set(runs.map((r) => r.inputs.source.sha256)).size;
  const c = certificate;
  return section('overview', 'Overview', [
    '<dl class="kv">',
    `<dt>Workspace</dt><dd>${esc(ws.name)}</dd>`,
    `<dt>As of</dt><dd>${esc(String(ws.modified).replace('T', ' ').slice(0, 16))} UTC (its last change)</dd>`,
    `<dt>Certified by</dt><dd>MaveScape ${esc(c.software.version ?? '?')}${c.software.commit ? ` (commit <span class="mono">${esc(c.software.commit.slice(0, 12))}</span>)` : ''}</dd>`,
    `<dt>Certificate</dt><dd><span class="mono wrap">${esc(c.fingerprint)}</span> <span class="muted">(${esc(shortFingerprint(c.fingerprint))})</span></dd>`,
    `<dt>Numbers certified</dt><dd>${count(c.total)}</dd>`,
    `<dt>Score runs</dt><dd>${plural(runs.length, 'run')} of ${plural(tables, 'table')}</dd>`,
    (ws.analyses ?? []).length ? `<dt>Kept in the report</dt><dd>${esc((ws.analyses ?? []).map((a) => analysisName(a)).join('; '))}</dd>` : '',
    (ws.figures ?? []).length ? `<dt>Figures</dt><dd>${esc(ws.figures.map((f) => f.name).join('; '))}</dd>` : '',
    `<dt>History</dt><dd>${plural(history.entries, 'entry', 'entries')}, ${history.ok ? 'its chain of hashes intact' : '<strong>its chain of hashes broken</strong>'}</dd>`,
    '</dl>',
    '<p class="muted">Every underlined number is traced: click it, or press Enter on it, to see where it comes from, its key and its exact value. The numbers are the certificate\'s: computed by MaveScape from the files named below, with the code its window uses.</p>',
  ].join(''));
}

function certificateSection(certificate) {
  const c = certificate;
  return section('certificate', 'The certificate', [
    `<p>This report shows the numbers of the reproducibility certificate whose fingerprint is <span class="mono wrap">${esc(c.fingerprint)}</span>. The certificate is the workspace archive with the files it reads and every number it reports; its fingerprint, the SHA-256 of what it records, names exactly what was certified.</p>`,
    '<h3>What it proves</h3>',
    '<p>That these inputs, analyzed as the workspace records, give these numbers: the analysis is reproducible, and the record is the one certified. It does not prove that the scores are right: that rests on the experiment\'s design and the model\'s assumptions, which the methods below state, and on the quality control, whose findings are below with their acknowledgements.</p>',
    '<h3>To verify it</h3>',
    `<p>With the certificate (<span class="mono">.certificate.msz</span>): <span class="mono">mavescape verify &lt;certificate&gt;</span>${c.inputs.some((i) => i.role === 'table' && !i.path) ? ' <span class="mono">--data &lt;the folder with the tables&gt;</span>' : ''}, or open it in MaveScape ${esc(c.software.version ?? '')} or later. Every number is computed again from the files and compared bit for bit.</p>`,
    '<p><button type="button" id="check-fingerprint" class="action">Check this file\'s numbers against the fingerprint</button> <span id="fingerprint-result" role="status" aria-live="polite"></span></p>',
    c.notChecked.length ? `<h3>Not computed again</h3><ul>${c.notChecked.map((x) => `<li>${esc(x.what)}: ${esc(x.reason)}.</li>`).join('')}</ul>` : '',
    c.notes.length ? `<h3>Notes made when it was certified</h3><ul>${c.notes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '',
  ].join(''));
}

function experiment(ws) {
  const parts = [];
  parts.push('<h3>Targets</h3>');
  parts.push(table('Targets', ['Target', 'Sequence', { text: 'Length', r: true }, 'Reference'], (ws.targets ?? []).map((t, i) => row([
    t.name,
    t.sequenceType === 'dna' ? 'DNA' : 'protein',
    { r: true, html: recorded(`targets.${i}.sequence.length`, t.sequence?.length ?? null) },
    t.reference ? `${t.reference.database} ${t.reference.accession} (release ${t.reference.release ?? '?'}, retrieved ${String(t.reference.retrieved ?? '').slice(0, 10)}): positions ${t.reference.start}–${t.reference.end}, ${t.reference.identical ? 'identical' : `${t.reference.differences} differences`}` : (t.identifiers?.uniprot ? `UniProt ${t.identifiers.uniprot}` : '—'),
  ]))));
  const d = ws.design;
  if (d) {
    parts.push('<h3>Design</h3>');
    parts.push(`<p>${esc(d.name ?? '')}${d.name ? ': ' : ''}${esc(d.model)} design${d.conditions?.length ? `, ${plural(d.conditions.length, 'condition')}` : ''}. ${esc(describeReadout(d))}</p>`);
    parts.push(table('Samples', ['Sample', 'Columns'], d.samples.map((s) => row([s.name ?? s.id, s.columns.join(', ')]))));
    parts.push(table('Replicates', ['Replicate', 'Biological', 'Samples'], d.replicates.map((r, i) => row([
      r.name ?? r.id,
      { html: recorded(`design.replicates.${i}.biological`, r.biological ?? null) },
      replicateSamples(r).map((x) => `${x.sample} (${x.role}${x.time !== undefined ? ` at ${x.time}` : ''})`).join(', '),
    ]))));
    parts.push('<p class="muted">Each run records the design it was scored with (below), so a run made before a change of the design keeps its own.</p>');
  }
  return section('experiment', 'Experiment and design', parts.join(''));
}

const ROLES = { table: 'Table', annotation: 'Annotation', image: 'Figure image', structure: 'Structure' };

function inputs(certificate, wsSha) {
  return section('inputs', 'Inputs', [
    `<p>The workspace (<span class="mono">workspace.json</span>, SHA-256 <span class="mono wrap">${esc(wsSha)}</span>) and every file it reads, each by its SHA-256.</p>`,
    table('Inputs', ['File', 'Role', { text: 'Bytes', r: true }, 'SHA-256', 'In the certificate'], certificate.inputs.map((i) => row([
      i.fileName ?? i.name,
      `${ROLES[i.role] ?? i.role}${i.needed ? '' : ' (no number read from it)'}`,
      { r: true, html: i.bytes === null ? '—' : esc(count(i.bytes)) },
      { html: `<span class="mono wrap">${esc(i.sha256)}</span>` },
      i.path ? 'included' : 'by its SHA-256 only',
    ]))),
  ].join(''));
}

// The leaves of a run's parameters as [path, value] (filters nested).
function leaves(value, path = []) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return Object.entries(value).flatMap(([k, v]) => leaves(v, [...path, k]));
  return [[path, value]];
}

function runsSection(ws, certificate, computed) {
  const parts = [];
  const runs = ws.runs ?? [];
  if (runs.length) {
    parts.push(`<div class="lookup"><label for="lookup-variant">Look up a variant</label> <input id="lookup-variant" type="search" placeholder="p.Trp36Ala" autocomplete="off"> <label for="lookup-run">in</label> <select id="lookup-run">${runs.map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}</select> <button type="button" id="lookup-go" class="action">Show</button><div id="lookup-result" role="status" aria-live="polite"></div></div>`);
  }
  runs.forEach((run, i) => {
    const n = certificate.numbers.runs.find((x) => x.id === run.id);
    const results = computed.results.get(run.id) ?? null;
    parts.push(`<div class="run" id="run-${esc(run.id)}"><h3>${esc(run.name)}</h3>`);
    parts.push('<dl class="kv">');
    parts.push(`<dt>Run</dt><dd><span class="mono">${esc(run.id)}</span>, scored ${esc(String(run.created ?? '').slice(0, 10))} by MaveScape ${esc(run.software?.version ?? '?')} (scoring version ${esc(run.software?.scoring ?? run.inputs.scoring)})</dd>`);
    parts.push(`<dt>Table</dt><dd>${esc(run.inputs.source.name)}, SHA-256 <span class="mono wrap">${esc(run.inputs.source.sha256)}</span></dd>`);
    parts.push(`<dt>Output SHA-256</dt><dd>recorded ${recorded(`runs.${i}.output.sha256`, run.output.sha256, `${run.output.sha256.slice(0, 16)}…`)}; computed ${n?.output ? traced(`run|${run.id}|output`, n.output, `${n.output.slice(0, 16)}…`) : '—'} ${n?.output === run.output.sha256 ? '<span class="badge ok">the same</span>' : '<span class="badge warn">different</span>'}</dd>`);
    parts.push('</dl>');
    parts.push(`<p>${esc(describeMethod(run).slice(0, -1).join(' '))}</p>`);
    const p = withDefaults(run.inputs.parameters);
    parts.push(`<details><summary>Every parameter (${esc(describeParameters(p, isBarcodeRun(run)))})</summary>${table(`Parameters of ${run.name}`, ['Parameter', 'Value'], leaves(run.inputs.parameters).map(([path, v]) => row([path.join(' › '), { html: recorded(`runs.${i}.inputs.parameters.${path.join('.')}`, v ?? null) }])))}</details>`);
    if (!n || n.error) {
      parts.push(`<p class="callout warn">${esc(n?.error ?? 'It could not be scored again.')}</p></div>`);
      return;
    }
    // Each condition's classes, counted from the certificate's.
    const tally = (classes) => [0, 1, 2, 3].map((k) => classes.filter((x) => x === k).length);
    parts.push(table(`Conditions of ${run.name}`, ['Condition', { text: 'Scored', r: true }, { text: 'Lower than the wild type', r: true }, { text: 'Like it', r: true }, { text: 'Higher', r: true }], n.conditions.map((c, j) => {
      const t = tally(c.class);
      return row([c.name, { r: true, html: traced(`count|${run.id}|${j}|scored`, t[1] + t[2] + t[3]) }, { r: true, html: traced(`count|${run.id}|${j}|2`, t[2]) }, { r: true, html: traced(`count|${run.id}|${j}|1`, t[1]) }, { r: true, html: traced(`count|${run.id}|${j}|3`, t[3]) }]);
    })));
    if (n.contrasts.length) {
      parts.push(table(`Differences between conditions of ${run.name}`, ['Difference', { text: 'Compared', r: true }, { text: 'Lower', r: true }, { text: 'No difference', r: true }, { text: 'Higher', r: true }], n.contrasts.map((c, j) => {
        const t = tally(c.class);
        return row([c.name, { r: true, html: traced(`count|${run.id}|contrast${j}|scored`, t[1] + t[2] + t[3]) }, { r: true, html: traced(`count|${run.id}|contrast${j}|2`, t[2]) }, { r: true, html: traced(`count|${run.id}|contrast${j}|1`, t[1]) }, { r: true, html: traced(`count|${run.id}|contrast${j}|3`, t[3]) }]);
      })));
    }
    parts.push(`<p class="muted">A variant's class is against the wild type (or the synonymous variants' median without one): lower or higher where its q &lt; 0.05 (Benjamini–Hochberg), as the robustness check and the diff call it. Look up a variant above for its score, SE and class.</p>`);
    // The maps: each condition, each difference.
    if (results) {
      const view = proteinView(results) ?? results;
      const maps = [
        ...results.conditions.map((c, j) => ({ label: c.name, options: { condition: j } })),
        ...(results.differential ?? []).map((d, k) => ({ label: d.name, options: { contrast: k, colorBy: 'differential' } })),
      ];
      for (const [k, m] of maps.entries()) {
        try {
          const model = buildMapModel(view, run.inputs.design, m.options);
          const label = `The variant-effect map of ${run.name}${maps.length > 1 ? `, ${m.label}` : ''}`;
          parts.push(`<figure class="map">${scroll(label, placed(mapSVG(model, { results: view }), `map-${i}-${k}`, label))}<figcaption>${esc(label)}.</figcaption></figure>`);
        } catch (error) {
          parts.push(`<p class="muted">No map of ${esc(m.label)}: ${esc(error.message)}</p>`);
        }
      }
    }
    parts.push('</div>');
  });
  return section('runs', 'Score runs', parts.join('') || '<p class="muted">No run.</p>');
}

function qcSection(ws, certificate, computed) {
  const parts = [];
  for (const q of certificate.numbers.qc) {
    const run = ws.runs.find((r) => r.id === q.run);
    const d = computed.detail.qc.get(q.run);
    parts.push(`<h3>${esc(q.name)}</h3>`);
    if (!d) {
      parts.push(`<p class="muted">${esc(q.error ?? 'Not computed.')}</p>`);
      continue;
    }
    const byId = new Map(d.findings.map((f) => [f.id, f]));
    parts.push(table(`QC findings of ${q.name}`, ['Finding', 'Status', 'What it found', 'Threshold', 'Acknowledged'], q.findings.map((f) => {
      const finding = byId.get(f.id);
      const [word, kind] = STATUS[f.status] ?? [f.status, 'muted'];
      const ack = ws.qc?.acknowledged?.[f.id];
      return row([
        finding?.title ?? f.id,
        { html: `<span class="badge ${kind}">${traced(`qc|${q.run}|${f.id}|status`, f.status, word)}</span>` },
        { html: traced(`qc|${q.run}|${f.id}|value`, f.value, typeof f.value === 'string' ? f.value : null) },
        finding?.threshold ?? '',
        { html: f.acknowledged ? `${traced(`qc|${q.run}|${f.id}|acknowledged`, f.acknowledged, `at ${f.acknowledged}`)}: ${esc(ack?.reason ?? '')}` : traced(`qc|${q.run}|${f.id}|acknowledged`, null, 'no') },
      ]);
    })));
    const plots = [];
    for (const f of d.findings) {
      if (!f.plot || f.status === 'na') continue;
      let data;
      try {
        data = qcPanelData(f, d.qc, d.thresholds, { pair: 0 });
      } catch {
        continue;
      }
      if (!data?.charts?.length) continue;
      const title = `${f.title} (${run?.name ?? q.name})`;
      plots.push(`<figure class="plot">${chartsSVG(data, { w: 380, h: 70 + 150 * data.charts.length, title, prefix: `qc-${q.run}-${f.id}` })}<figcaption>${esc(f.title)}</figcaption></figure>`);
    }
    if (plots.length) parts.push(`<div class="plots">${plots.join('')}</div>`);
    parts.push(`<p class="muted">Every number this QC computed, as its SHA-256: ${traced(`qc|${q.run}|digest`, q.digest, `${String(q.digest).slice(0, 16)}…`)}</p>`);
  }
  return section('qc', 'Quality control', parts.join('') || '<p class="muted">No run to check.</p>');
}

const STATISTICS = [
  ['Variants compared', 'n', 0],
  ['Pearson\'s r', 'pearson.r', 4, 'pearson.low', 'pearson.high'],
  ['Spearman\'s ρ', 'spearman.rho', 4, 'spearman.low', 'spearman.high'],
  ['Lin\'s concordance ρc', 'concordance.ccc', 4, 'concordance.low', 'concordance.high'],
  ['Bland–Altman bias', 'blandAltman.bias', 4, 'blandAltman.biasLow', 'blandAltman.biasHigh'],
  ['Lower limit of agreement', 'blandAltman.lower', 4, 'blandAltman.lowerLow', 'blandAltman.lowerHigh'],
  ['Upper limit of agreement', 'blandAltman.upper', 4, 'blandAltman.upperLow', 'blandAltman.upperHigh'],
];

function analysesSection(ws, certificate, computed) {
  const out = [];
  const comparisons = [];
  const robustness = [];
  for (const n of certificate.numbers.analyses) {
    const a = (ws.analyses ?? []).find((x) => x.id === n.id);
    const v = n.values;
    const at = (path) => path.split('.').reduce((x, k) => x?.[k], v);
    const key = (path) => `analysis|${n.id}|values.${path}`;
    if (n.kind === 'comparison') {
      const s = v.statistics ?? {};
      const stat = (path, digits) => {
        const value = path.split('.').reduce((x, k) => x?.[k], s);
        return value === undefined || value === null ? '—' : traced(key(`statistics.${path}`), value, formatNumber(asNumber(value) ?? value, digits));
      };
      const parts = [`<h3>${esc(n.name.replace(/^./, (c) => c.toUpperCase()))}</h3>`];
      if (a) parts.push(`<p>${esc(a.a.label)} against ${esc(a.b.label)}; scale: ${esc(a.scale?.mode ?? 'scored')}${a.scale?.applied ? ' (rescaled)' : ''}.</p>`);
      if (v.error) parts.push(`<p class="callout warn">${esc(v.error)}</p>`);
      else {
        parts.push(table(`Statistics of ${n.name}`, ['Statistic', { text: 'Value', r: true }, { text: '95% interval', r: true }], STATISTICS.filter(([, path]) => path.split('.').reduce((x, k) => x?.[k], s) !== undefined).map(([label, path, digits, low, high]) => row([label, { r: true, html: stat(path, digits) }, { r: true, html: low ? `${stat(low, digits)} to ${stat(high, digits)}` : '' }]))));
        if (v.discordance) parts.push(`<p>Variants that differ beyond their uncertainty: ${v.discordance.valid ? `${traced(key('discordance.discordant'), at('discordance.discordant'))} of ${traced(key('discordance.tested'), at('discordance.tested'))} tested (q &lt; ${esc(v.discordance.q)})` : esc(`not tested: ${v.discordance.reason ?? ''}`)}.</p>`);
        const c = computed.detail.analyses.get(n.id)?.comparison;
        if (c) {
          try {
            const label = `${n.name}: one against the other`;
            parts.push(`<figure class="plot">${chartsSVG(comparisonCharts(c, 'agreement'), { w: 380, h: 300, title: label, prefix: `cmp-${n.id}` })}<figcaption>${esc(label)}</figcaption></figure>`);
          } catch { /* no plot */ }
        }
      }
      comparisons.push(parts.join(''));
    } else if (n.kind === 'robustness') {
      const parts = [`<h3>${esc(n.name.replace(/^./, (c) => c.toUpperCase()))}</h3>`];
      if (v.error) parts.push(`<p class="callout warn">${esc(v.error)}</p>`);
      else {
        parts.push(`<p>Checked against ${traced(key('total'), v.total, count(v.total - 1))} alternative analyses${a ? `, varying ${esc(a.choices.map((c) => c.label.toLowerCase()).join(', '))}` : ''}${v.skipped ? `; ${traced(key('skipped'), v.skipped)} could not be scored` : ''}.</p>`);
        const verdicts = ['robust', 'fragile', 'uncertain', 'borderline', 'size', 'inclusion'];
        parts.push(table(`Verdicts of ${n.name}`, ['Scored as', { text: 'Variants', r: true }, ...verdicts.map((x) => ({ text: x === 'size' ? 'size depends' : x === 'inclusion' ? 'not always scored' : x, r: true }))], v.targets.map((t, k) => row([
          a?.targets?.[k]?.name ?? t.id,
          { r: true, html: traced(key(`targets[${k}].n`), t.n) },
          ...verdicts.map((x) => ({ r: true, html: traced(key(`targets[${k}].counts.${x}`), t.counts[x]) })),
        ]))));
        if (a?.targets?.[0]?.text) parts.push(`<p class="muted">${esc(a.targets[0].text)}</p>`);
      }
      robustness.push(parts.join(''));
    }
  }
  return [
    comparisons.length ? section('comparisons', 'Comparisons', comparisons.join('')) : null,
    robustness.length ? section('robustness', 'Robustness to analysis choices', robustness.join('')) : null,
  ].filter(Boolean);
}

function selectionsSection(ws) {
  const list = ws.selections ?? [];
  if (!list.length) return null;
  return section('selections', 'Selections', [
    table('Selections', ['Selection', 'Run', { text: 'Variants', r: true }, 'Query'], list.map((s, i) => row([
      s.name,
      ws.runs.find((r) => r.id === s.run)?.name ?? s.run,
      { r: true, html: recorded(`selections.${i}.keys.length`, s.keys?.length ?? 0) },
      s.query ?? '(chosen on the map)',
    ]))),
    '<p class="muted">A selection\'s variants are recorded as chosen; a query is not run again.</p>',
  ].join(''));
}

function structuresSection(ws) {
  const views = ws.structureViews ?? [];
  if (!views.length) return null;
  return section('structures', 'Structure views', [
    table('Structure views', ['View', 'Structure', 'File SHA-256', 'Chain', 'Colored by'], views.map((v) => {
      const s = (ws.structures ?? []).find((x) => x.id === v.structure);
      const origin = s?.origin?.kind === 'pdb' ? `PDB entry ${s.origin.id}` : s?.origin?.kind === 'alphafold' ? `AlphaFold DB model ${s.origin.id}` : 'a file';
      return row([v.name, `${s?.name ?? v.structure} (${origin})`, { html: `<span class="mono wrap">${esc(s?.file?.sha256 ?? '')}</span>` }, v.chain ?? '', v.color?.scheme ?? '']);
    })),
    '<p class="muted">Each structure\'s file is checked by its SHA-256; what a view computes from it (its evidence, contacts and colors) is not computed again.</p>',
  ].join(''));
}

function figuresSection(ws, certificate, computed) {
  const figures = ws.figures ?? [];
  if (!figures.length) return null;
  const parts = [];
  figures.forEach((fig, i) => {
    const n = certificate.numbers.figures.find((x) => x.id === fig.id);
    const d = computed.detail.figures.get(fig.id);
    parts.push(`<h3>${esc(fig.name)}</h3><p class="muted">${toMM(fig.width)} × ${toMM(fig.height)} mm, text ${esc(fig.text)} pt.</p>`);
    if (d) {
      const label = `The figure "${fig.name}"`;
      parts.push(`<figure class="page">${scroll(label, placed(marksToSVGSync(d.drawn.marks, fig.width, fig.height, { title: fig.name, desc: d.drawn.description, sized: false }), `fig-${i}`, label))}</figure>`);
    }
    parts.push(table(`Panels of ${fig.name}`, ['Panel', 'What it shows', 'Drawing (SHA-256)'], (n?.panels ?? []).map((p) => {
      const panel = fig.panels.find((x) => x.id === p.id);
      return row([p.letter ?? '—', `${panel ? panelSummary(panel, ws) : p.kind}${p.missing ? ` (not drawn: ${p.missing})` : ''}`, { html: traced(`figure|${fig.id}|${p.id}`, p.drawing, `${String(p.drawing).slice(0, 16)}…`) }]);
    })));
  });
  parts.push('<p class="muted">Each panel\'s drawing is the SHA-256 of its marks written as SVG, as the manifest of an exported figure records it: a figure file whose panel has this digest was drawn from these numbers.</p>');
  return section('figures', 'Figures', parts.join(''));
}

// The report's text: citations as links to the references, `code` as code.
function cited(text) {
  return esc(text).replace(/\[(\d+)\]/g, '<a href="#ref-$1">[$1]</a>').replace(/`([^`]+)`/g, '<code>$1</code>');
}

function methodsSection(certificate, computed) {
  const report = computed.report;
  if (!report) return section('methods', 'Methods', '<p class="muted">The report could not be written: a file is missing.</p>');
  const parts = [];
  for (const s of report.sections) {
    if (s.title) parts.push(`<h3>${esc(s.title)}</h3>`);
    for (const b of s.blocks) {
      if (b.kind === 'p') parts.push(`<p>${b.label ? `<strong>${esc(b.label)}.</strong> ` : ''}${cited(b.text)}</p>`);
      else if (b.kind === 'list') parts.push(`<ul>${b.items.map((x) => `<li>${cited(x)}</li>`).join('')}</ul>`);
      else parts.push(`${b.caption ? `<p class="muted">${esc(b.caption)}</p>` : ''}${scroll(b.caption ?? s.title ?? 'Table', `<table><thead><tr>${b.columns.map((c) => `<th scope="col">${esc(c)}</th>`).join('')}</tr></thead><tbody>${b.rows.map((r) => `<tr>${r.map((c) => `<td>${cited(String(c))}</td>`).join('')}</tr>`).join('')}</tbody></table>`)}`);
    }
  }
  // A reference's DOI as a link (followed only when clicked).
  const linked = (text) => esc(text).replace(/doi:(10\.\d{4,9}\/[^\s<]+?)(\.?)(?=\s|$)/g, (m, doi, dot) => `<a href="https://doi.org/${doi}" rel="noopener noreferrer">doi:${doi}</a>${dot}`);
  if (report.references.length) parts.push(`<h3>References</h3><ol class="refs">${report.references.map((r) => `<li id="ref-${r.n}">${linked(r.text)}</li>`).join('')}</ol>`);
  const n = certificate.numbers.report;
  if (n) parts.push(`<p class="muted">The report's text and references as their SHA-256: ${traced('report|markdown', n.markdown, `${n.markdown.slice(0, 16)}…`)} and ${traced('report|bibtex', n.bibtex, `${n.bibtex.slice(0, 16)}…`)}.</p>`);
  return section('methods', 'Methods', parts.join(''));
}

function logSection(ws, history) {
  const entries = ws.history ?? [];
  return section('log', 'Decision log', [
    `<p class="callout ${history.ok ? 'ok' : 'danger'}">${history.ok ? `Hash-chained and intact: ${plural(history.entries, 'entry', 'entries')}, each covering the one before it; the last <span class="mono wrap">${esc(history.head ?? '')}</span>.` : `The chain is broken at ${plural(history.broken.length, 'entry', 'entries')}: the history was changed outside MaveScape.`}</p>`,
    table('Decision log', ['When (UTC)', 'Action', 'What was done'], entries.map((e) => row([{ html: `<span class="mono">${esc(String(e.time).replace('T', ' ').slice(0, 16))}</span>` }, e.action, e.detail ?? '']))),
  ].join(''));
}

// --- The model the trace script reads -------------------------------------------------------------

function reviewModel(ws, certificate, computed, wsSha) {
  return {
    format: REVIEW_FORMAT,
    version: REVIEW_VERSION,
    workspace: { id: ws.id, name: ws.name, sha256: wsSha },
    runs: (ws.runs ?? []).map((r, i) => ({ id: r.id, name: r.name, index: i, table: { name: r.inputs.source.name, sha256: r.inputs.source.sha256 }, method: describeParameters(withDefaults(r.inputs.parameters), isBarcodeRun(r)) })),
    classNames: CLASS_NAMES,
    contrastClassNames: CONTRAST_CLASS_NAMES,
    qc: [...computed.detail.qc].map(([run, d]) => ({ run, findings: d.findings.map((f) => ({ id: f.id, title: f.title, threshold: f.threshold ?? '', rationale: f.rationale ?? '' })) })),
    analyses: (ws.analyses ?? []).map((a) => ({ id: a.id, kind: a.kind, name: analysisName(a), ...(a.kind === 'comparison' ? { a: a.a.label, b: a.b.label, scale: a.scale?.mode ?? 'scored' } : { run: a.run.name, max: a.max, seed: a.seed }) })),
    figures: (ws.figures ?? []).map((f) => ({ id: f.id, name: f.name, panels: f.panels.map((p) => ({ id: p.id, shows: panelSummary(p, ws), inputs: panelInputs(ws, p) })) })),
    certificate,
  };
}

// --- The page ---------------------------------------------------------------------------------------

const CSS = `
:root{--bg:#f3f5f9;--panel:#fff;--text:#171b26;--text2:#3a4254;--text3:#4f586a;--line:#d6dce6;--accent:#4c3fd1;--accent-soft:#ecebff;--ok:#0b6a3c;--ok-soft:#e3f4ea;--warn:#7a4f00;--warn-soft:#fdf1d8;--danger:#a51e2b;--danger-soft:#fde6e8;--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
@media (prefers-color-scheme:dark){:root{--bg:#11131a;--panel:#1a1d26;--text:#eceef3;--text2:#c9cedb;--text3:#a9b1c2;--line:#2f3542;--accent:#b2a6ff;--accent-soft:#2a2652;--ok:#6ad9a2;--ok-soft:#163224;--warn:#f2c66d;--warn-soft:#382d12;--danger:#ff98a1;--danger-soft:#3c1b21}}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.55 Inter,system-ui,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif}
a{color:var(--accent)}code,.mono{font-family:var(--mono);font-size:12px}.wrap{word-break:break-all}
header.top{background:var(--panel);border-bottom:1px solid var(--line);padding:18px 24px}
header.top h1{margin:0 0 4px;font-size:22px;letter-spacing:-.01em}header.top p{margin:0;color:var(--text3)}
.layout{display:grid;grid-template-columns:210px minmax(0,1fr);gap:24px;max-width:1500px;margin:0 auto;padding:20px 24px 80px}
nav.toc{position:sticky;top:16px;align-self:start;font-size:13px}
nav.toc a{display:block;padding:4px 8px;border-radius:6px;color:var(--text2);text-decoration:none}
nav.toc a:hover,nav.toc a:focus{background:var(--accent-soft);color:var(--text)}
main section{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:18px 20px;margin-bottom:18px}
main h2{margin:0 0 10px;font-size:18px}main h3{margin:18px 0 8px;font-size:15px}
.muted{color:var(--text3)}
.callout{border-radius:8px;padding:8px 12px;margin:10px 0;border:1px solid var(--line)}
.callout.ok{background:var(--ok-soft)}.callout.warn{background:var(--warn-soft)}.callout.danger{background:var(--danger-soft)}
.kv{display:grid;grid-template-columns:max-content 1fr;gap:4px 16px;margin:0}.kv dt{color:var(--text3)}.kv dd{margin:0}
.scroll{overflow-x:auto;margin:6px 0 10px}.scroll:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
table{border-collapse:collapse;width:100%;font-size:12.5px;font-variant-numeric:tabular-nums}
th,td{padding:5px 8px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
th{color:var(--text3);font-weight:650;font-size:11.5px}td.r,th.r{text-align:right}
.badge{display:inline-block;padding:1px 7px;border-radius:999px;font-size:11px;font-weight:650}
.badge.ok{background:var(--ok-soft);color:var(--ok)}.badge.warn{background:var(--warn-soft);color:var(--warn)}.badge.danger{background:var(--danger-soft);color:var(--danger)}.badge.muted{background:var(--bg);color:var(--text3)}
button.n{font:inherit;color:inherit;background:none;border:0;padding:0;margin:0;cursor:pointer;border-bottom:1px dotted currentColor;font-variant-numeric:tabular-nums;text-align:inherit}
button.n:hover,button.n:focus-visible{color:var(--accent);border-bottom-color:var(--accent);outline:none}
button.n.on{background:var(--accent-soft);color:var(--text);border-radius:3px}
button.action{font:inherit;font-size:13px;padding:4px 10px;border-radius:6px;border:1px solid var(--line);background:var(--panel);color:var(--text);cursor:pointer}
button.action:hover,button.action:focus-visible{border-color:var(--accent);outline:none}
input,select{font:inherit;font-size:13px;padding:3px 6px;border-radius:6px;border:1px solid var(--line);background:var(--panel);color:var(--text)}
.lookup{margin:0 0 12px}.lookup table{margin-top:8px}
.run{border-top:1px solid var(--line);padding-top:6px;margin-top:14px}.run:first-of-type{border-top:0}
details{margin:8px 0}summary{cursor:pointer;color:var(--text2)}
.plots{display:flex;flex-wrap:wrap;gap:12px}
figure{margin:8px 0}figure.plot{background:#fff;border:1px solid var(--line);border-radius:8px;padding:4px;width:392px;max-width:100%}
figure.plot svg{display:block;width:100%;height:auto}figure.plot figcaption{font-size:12px;padding:4px 4px 2px;color:#171b26}
figure.map .scroll,figure.page .scroll{background:#fff;border:1px solid var(--line);border-radius:8px;padding:6px}
figure.map svg{display:block}figure.page svg{display:block;max-width:100%;height:auto}
figure figcaption{font-size:12px;color:var(--text3)}
ol.refs li{margin-bottom:4px}
#trace{position:fixed;right:16px;bottom:16px;width:min(460px,calc(100vw - 32px));max-height:60vh;overflow:auto;background:var(--panel);border:1px solid var(--line);border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.2);padding:14px 16px;display:none;font-size:13px;z-index:10}
#trace.open{display:block}#trace h2{font-size:14px;margin:0 28px 6px 0}#trace ul{margin:6px 0 0;padding-left:18px}#trace li{margin:2px 0;word-break:break-word}
#trace .close{position:absolute;top:8px;right:8px;border:0;background:none;color:var(--text3);font-size:18px;cursor:pointer;line-height:1}
@media (max-width:860px){.layout{grid-template-columns:1fr;padding:16px}nav.toc{position:static}}
@media print{nav.toc,#trace,.lookup,#check-fingerprint{display:none!important}.layout{display:block;padding:0}main section{break-inside:avoid-page;border:0}button.n{border:0}body{background:#fff}}
`;

// The trace panel, the variant lookup and the fingerprint's check: what a number is, from the model
// (the certificate among it) and the number's key.
const SCRIPT = `
(() => {
  const model = JSON.parse(document.getElementById('mavescape-review').textContent);
  const cert = model.certificate;
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const exact = (v) => JSON.stringify(v);
  const short = (s) => (typeof s === 'string' && s.length === 64 ? s.slice(0, 16) + '…' : s);
  const runOf = (id) => model.runs.find((r) => r.id === id);
  const numbersOf = (id) => cert.numbers.runs.find((r) => r.id === id);
  const runLine = (r) => r ? 'Run: ' + esc(r.name) + ', its table ' + esc(r.table.name) + ' (SHA-256 <span class="mono">' + esc(r.table.sha256) + '</span>), scored again with its recorded design and parameters (' + esc(r.method) + ')' : '';
  const FIELDS = { score: 'score', se: 'SE', class: 'class', delta: 'difference', q: 'q' };
  function explain(key, value) {
    const parts = key.split('|');
    const kind = parts[0];
    if (kind === 'run') {
      const r = runOf(parts[1]);
      const n = numbersOf(parts[1]);
      if (parts[2] === 'output') return { title: (r ? r.name : 'A run') + ': its output', lines: ['The SHA-256 of its whole output: every variant\\'s key, each replicate\\'s and condition\\'s scores, SEs, states and filters.', runLine(r)] };
      const contrast = parts[2].startsWith('contrast');
      const j = Number(parts[2].replace('contrast', ''));
      const i = Number(parts[4]);
      const c = n && (contrast ? n.contrasts[j] : n.conditions[j]);
      const variant = n ? n.variants[i] : '';
      const names = contrast ? model.contrastClassNames : model.classNames;
      const lines = [esc(variant) + (c ? ' in ' + esc(c.name) : '') + ': its ' + (FIELDS[parts[3]] || parts[3]) + (parts[3] === 'class' ? ' (' + esc(names[value] || value) + ')' : '')];
      if (c) lines.push(contrast ? 'Difference ' + exact(c.delta[i]) + ', SE ' + exact(c.se[i]) + ', q ' + exact(c.q[i]) + ', class ' + esc(names[c.class[i]]) : 'Score ' + exact(c.score[i]) + ', SE ' + exact(c.se[i]) + ', class ' + esc(names[c.class[i]]));
      lines.push(runLine(r));
      return { title: (r ? r.name + ': ' : '') + esc(variant), lines };
    }
    if (kind === 'count') {
      const r = runOf(parts[1]);
      const n = numbersOf(parts[1]);
      const contrast = parts[2].startsWith('contrast');
      const j = Number(parts[2].replace('contrast', ''));
      const c = n && (contrast ? n.contrasts[j] : n.conditions[j]);
      const names = contrast ? model.contrastClassNames : model.classNames;
      const what = parts[3] === 'scored' ? (contrast ? 'compared' : 'scored') : '"' + names[Number(parts[3])] + '"';
      return { title: 'A count of variants', lines: ['The variants of ' + (c ? esc(c.name) : 'this condition') + ' ' + what + ', counted from the certificate\\'s classes (' + (n ? n.variants.length.toLocaleString('en-US') : '?') + ' variants).', runLine(r)] };
    }
    if (kind === 'qc') {
      const r = runOf(parts[1]);
      if (parts[2] === 'digest') return { title: (r ? r.name : 'A run') + ': its quality control', lines: ['The SHA-256 of every number its QC computed (each sample\\'s depth and coverage, the replicates\\' agreement, the controls, each finding\\'s measure), with the workspace\\'s thresholds.', runLine(r)] };
      const q = model.qc.find((x) => x.run === parts[1]);
      const f = q && q.findings.find((x) => x.id === parts[2]);
      const lines = ['The finding\\'s ' + (parts[3] === 'value' ? 'measure, in words' : parts[3] === 'status' ? 'verdict' : 'acknowledgement (the verdict acknowledged at)') + '.'];
      if (f && f.threshold) lines.push('Threshold: ' + esc(f.threshold));
      if (f && f.rationale) lines.push(esc(f.rationale));
      lines.push(runLine(r));
      return { title: (f ? f.title : parts[2]) + (r ? ' (' + r.name + ')' : ''), lines };
    }
    if (kind === 'analysis') {
      const a = model.analyses.find((x) => x.id === parts[1]);
      const path = parts[2].replace(/^values\\./, '').replace(/\\[(\\d+)\\]/g, ' $1').split('.').join(' › ');
      const lines = ['Computed again from the runs\\' scores' + (a && a.kind === 'robustness' ? ', each alternative analysis scored again (at most ' + a.max + ', seed ' + a.seed + ')' : '') + ': ' + esc(path) + '.'];
      if (a && a.kind === 'comparison') lines.push(esc(a.a) + ' against ' + esc(a.b) + ' (scale: ' + esc(a.scale) + ')');
      return { title: a ? a.name.charAt(0).toUpperCase() + a.name.slice(1) : 'An analysis', lines };
    }
    if (kind === 'figure') {
      const f = model.figures.find((x) => x.id === parts[1]);
      const p = f && f.panels.find((x) => x.id === parts[2]);
      const lines = ['The SHA-256 of the panel\\'s drawing (its marks written as SVG), as an exported figure\\'s manifest records it.'];
      if (p) lines.push('It shows ' + esc(p.shows) + '.', 'Drawn from: ' + esc(JSON.stringify(p.inputs)));
      return { title: f ? 'The figure "' + f.name + '"' : 'A figure', lines };
    }
    if (kind === 'report') return { title: 'The report', lines: ['The SHA-256 of the report\\'s ' + (parts[1] === 'markdown' ? 'text (report.md)' : 'references (report.bib)') + ', written from the workspace\\'s record by MaveScape ' + esc(cert.software.version) + '.'] };
    if (kind === 'ws') return { title: 'Recorded in the workspace', lines: ['An input, not computed: the workspace records it at ' + esc(parts[1].split('.').join(' › ')) + '.', 'workspace.json, SHA-256 <span class="mono">' + esc(model.workspace.sha256) + '</span>'] };
    return { title: 'A number', lines: [] };
  }
  const panel = document.getElementById('trace');
  let current = null;
  const close = () => { panel.classList.remove('open'); if (current) { current.classList.remove('on'); current.focus(); } };
  function show(button) {
    if (current) current.classList.remove('on');
    current = button;
    button.classList.add('on');
    const key = button.dataset.k;
    const value = JSON.parse(button.dataset.v);
    const { title, lines } = explain(key, value);
    const certified = !key.startsWith('ws|') && !key.startsWith('count|');
    panel.innerHTML = '<button type="button" class="close" aria-label="Close">×</button><h2>' + esc(title) + '</h2><ul>' + lines.filter(Boolean).map((l) => '<li>' + l + '</li>').join('') + '<li>Key: <span class="mono">' + esc(key) + '</span></li><li>Exact value: <span class="mono">' + esc(exact(value)) + '</span></li>' + (certified ? '<li>Certified: the certificate (' + esc(cert.fingerprint.slice(0, 16)) + '…) records this value under this key.</li>' : '') + '</ul>';
    panel.classList.add('open');
  }
  document.addEventListener('click', (event) => {
    if (event.target.closest('#trace .close')) { close(); return; }
    const button = event.target.closest('button.n');
    if (button) show(button);
  });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && panel.classList.contains('open')) close(); });
  // A variant looked up: its numbers in each condition and difference, traced.
  const n = (key, value, text) => '<button type="button" class="n" data-k="' + esc(key) + '" data-v="' + esc(exact(value)) + '">' + esc(text) + '</button>';
  const fmt = (v) => (typeof v === 'number' ? String(Number(v.toPrecision(4))).replace('-', '\u2212') : String(v));
  const lookup = () => {
    const out = document.getElementById('lookup-result');
    const id = document.getElementById('lookup-run').value;
    const r = numbersOf(id);
    let text = document.getElementById('lookup-variant').value.trim();
    if (!r || !text) { out.textContent = ''; return; }
    let i = r.variants.indexOf(text);
    if (i < 0 && !/^[a-z]\\./.test(text)) i = r.variants.indexOf('p.' + text);
    if (i < 0) { const lower = text.toLowerCase(); i = r.variants.findIndex((v) => v.toLowerCase() === lower || v.toLowerCase() === 'p.' + lower); }
    if (i < 0) { out.textContent = text + ' is not among the ' + r.variants.length.toLocaleString('en-US') + ' variants of ' + runOf(id).name + '.'; return; }
    const rows = r.conditions.map((c, j) => '<tr><td>' + esc(c.name) + '</td><td class="r">' + n('run|' + id + '|' + j + '|score|' + i, c.score[i], fmt(c.score[i])) + '</td><td class="r">' + n('run|' + id + '|' + j + '|se|' + i, c.se[i], fmt(c.se[i])) + '</td><td>' + n('run|' + id + '|' + j + '|class|' + i, c.class[i], model.classNames[c.class[i]]) + '</td></tr>');
    const contrasts = r.contrasts.map((c, j) => '<tr><td>' + esc(c.name) + ' (difference)</td><td class="r">' + n('run|' + id + '|contrast' + j + '|delta|' + i, c.delta[i], fmt(c.delta[i])) + '</td><td class="r">' + n('run|' + id + '|contrast' + j + '|se|' + i, c.se[i], fmt(c.se[i])) + '</td><td>' + n('run|' + id + '|contrast' + j + '|class|' + i, c.class[i], model.contrastClassNames[c.class[i]]) + '</td></tr>');
    out.innerHTML = '<table><caption class="muted">' + esc(r.variants[i]) + ' in ' + esc(runOf(id).name) + '</caption><thead><tr><th scope="col">Condition</th><th scope="col" class="r">Score</th><th scope="col" class="r">SE</th><th scope="col">Class</th></tr></thead><tbody>' + rows.join('') + contrasts.join('') + '</tbody></table>';
  };
  const go = document.getElementById('lookup-go');
  if (go) {
    go.addEventListener('click', lookup);
    document.getElementById('lookup-variant').addEventListener('keydown', (event) => { if (event.key === 'Enter') lookup(); });
  }
  // The file's numbers against the fingerprint: the SHA-256 of the certificate's canonical JSON
  // (keys sorted), as MaveScape computes it.
  const canonical = (v) => Array.isArray(v) ? '[' + v.map((x) => canonical(x === undefined ? null : x)).join(',') + ']' : v && typeof v === 'object' ? '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}' : JSON.stringify(v === undefined ? null : v);
  const check = document.getElementById('check-fingerprint');
  if (check) check.addEventListener('click', async () => {
    const out = document.getElementById('fingerprint-result');
    if (!globalThis.crypto || !crypto.subtle) { out.textContent = 'This browser cannot compute SHA-256 here.'; return; }
    const { fingerprint, ...rest } = cert;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(rest)));
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    out.textContent = hex === fingerprint ? 'The same: this file holds the numbers the fingerprint names (' + hex.slice(0, 16) + '…).' : 'Not the same: this file\\'s numbers give ' + hex.slice(0, 16) + '…, not ' + fingerprint.slice(0, 16) + '…';
  });
})();
`;

// The review report of a certified workspace. computed: computeNumbers's (lib/certificate.js) for
// it; certificate: the certificate it gave (or one read and verified). Returns the HTML.
export function composeReview(ws, computed, certificate) {
  const wsSha = sha256(encoder.encode(serializeWorkspace(ws)));
  const history = verifyHistory(ws);
  const sections = [
    overview(ws, certificate, history),
    certificateSection(certificate),
    experiment(ws),
    inputs(certificate, wsSha),
    runsSection(ws, certificate, computed),
    qcSection(ws, certificate, computed),
    ...analysesSection(ws, certificate, computed),
    selectionsSection(ws),
    structuresSection(ws),
    figuresSection(ws, certificate, computed),
    methodsSection(certificate, computed),
    logSection(ws, history),
    section('about', 'About this report', `<p>Made by MaveScape ${esc(certificate.software.version ?? '?')} from the workspace and the ${plural(certificate.inputs.length, 'file')} named above, each by its SHA-256. It has no time of its own: the same certificate gives the same file.</p><p class="muted">This file is self-contained: it loads nothing from the network, and its links are followed only when clicked. Its data, the whole certificate among them, are in the JSON block <code>mavescape-review</code> inside it.</p>`),
  ].filter(Boolean);
  const modelJSON = JSON.stringify(reviewModel(ws, certificate, computed, wsSha)).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="MaveScape ${esc(certificate.software.version ?? '')}">
<title>${esc(ws.name)}: review report</title>
<style>${CSS}</style>
</head>
<body>
<header class="top"><h1>${esc(ws.name)}</h1><p>Review report · MaveScape ${esc(certificate.software.version ?? '')} · certificate ${esc(shortFingerprint(certificate.fingerprint))}</p></header>
<div class="layout">
<nav class="toc" aria-label="Sections">${sections.map((s) => `<a href="#${s.id}">${esc(s.title)}</a>`).join('')}</nav>
<main>
${sections.map((s) => s.html).join('\n')}
</main>
</div>
<aside id="trace" aria-label="Where this number comes from"></aside>
<script type="application/json" id="mavescape-review">${modelJSON}</script>
<script>${SCRIPT}</script>
</body>
</html>
`;
}

// Each traced value of a review report: [{ key, value }], read from its HTML (the page, not its
// script, which makes those of a variant looked up).
export function tracedValues(html) {
  const page = html.slice(0, html.indexOf('<script'));
  const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, '\'').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  return [...page.matchAll(/<button type="button" class="n" data-k="([^"]*)" data-v="([^"]*)">/g)].map((m) => ({ key: unescape(m[1]), value: JSON.parse(unescape(m[2])) }));
}
