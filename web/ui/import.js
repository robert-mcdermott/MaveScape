// The import wizard (wave 1, slice 3): a table of counts or scores, with what MaveScape found in
// it, the mapping (variant column, level, count columns, target), the roles it suggests, and every
// problem that blocks scoring, by line. Also reads FASTA files as targets. Requirements D1–D7, D12,
// E3, E4.

import { h, icon, clear, formatBytes, formatCount, debounce } from './dom.js';
import { showDialog, toast, progressToast } from './overlays.js';
import { sha256Hex } from './storage.js';
import { applyTemplate, detectLayout, makeTemplate, reviewImport, suggestRoles } from '../lib/importer.js';
import { assembleTable, looksLikeMap } from '../lib/assemble.js';
import { headerlessMap } from '../lib/barcodes.js';
import { cellText } from '../lib/csv.js';
import { STATUS, KIND_NAMES } from '../lib/variants.js';
import { parseFasta, targetFromSequence } from '../lib/target.js';
import { addSource, addTarget, setDesign } from '../lib/workspace.js';
import { now } from '../lib/clock.js';
import { IDENTIFIER_COLUMNS, validateDesign, summarizeDesign } from '../lib/design.js';

const LINE_ENDS = { crlf: 'CRLF (Windows) line ends', lf: 'LF line ends', cr: 'CR (old Mac) line ends' };
const DELIMITER_NAMES = { ',': 'comma-separated', '\t': 'tab-separated', ';': 'semicolon-separated', '|': 'bar-separated' };

export function installImport(app) {
  // Parsed tables of this session, by source id.
  app.tables = new Map();
  app.importers.set('table', (items, options) => openImportWizard(app, items, options));
  app.importers.set('sequence', (items) => importSequences(app, items));
  app.importers.set('design', (items) => importDesigns(app, items));
  app.importers.set('json', (items) => importDesigns(app, items));
  app.parseTableFile = (item) => parseTableFile(app, item);
  // A source's table, read again from the library (each file by its SHA-256) when this session has
  // not read it, and assembled as at import (joined, named, its barcode map applied).
  app.sourceTable = async (source) => {
    if (app.tables.has(source.id)) return app.tables.get(source.id).table;
    const files = source.files?.length ? source.files : [{ fileName: source.fileName, sha256: source.sha256 }];
    const parsed = [];
    for (const f of files) {
      const bytes = await app.library.getFile(f.sha256);
      if (!bytes) throw new Error(`${f.fileName} (SHA-256 ${f.sha256.slice(0, 12)}…) is not in the library.`);
      parsed.push({ name: f.fileName, table: await parseTableFile(app, { name: f.fileName, file: new Blob([bytes]) }), role: f.role ?? 'counts' });
    }
    const m = source.mapping ?? {};
    const target = app.store.ws.targets.find((t) => t.id === source.target);
    const assembled = assembleTable(parsed, { absentMeans: m.absentMeans ?? 'missing', level: m.level, target, barcodeColumn: m.barcodeColumn ?? undefined, map: m.assembly?.map ?? undefined });
    if (!assembled.table) throw new Error(`${source.name} could not be assembled again: ${assembled.problems.map((p) => p.message).join(' ')}`);
    app.tables.set(source.id, { table: assembled.table, review: null });
    return assembled.table;
  };
}

async function parseTableFile(app, item) {
  const file = item.file instanceof Blob ? item.file : new Blob([item.bytes ?? new Uint8Array()]);
  const job = app.worker('csv').run('parse', { file, name: item.name });
  return job.promise;
}

// FASTA files: each record a target.
async function importSequences(app, items) {
  let ws = app.store.ws;
  const added = [];
  for (const item of items) {
    const text = new TextDecoder().decode(await app.readBytes(item));
    const records = parseFasta(text);
    if (!records.length) {
      toast(`${item.name}: no sequence found.`, { kind: 'error' });
      continue;
    }
    for (const record of records) {
      const { target, messages } = targetFromSequence(record);
      const result = addTarget(ws, target);
      ws = result.ws;
      if (!result.existing) added.push(target.name);
      for (const m of messages) {
        toast(`${target.name}: ${m.message}`, { kind: m.level === 'error' ? 'error' : undefined });
        app.log(`${item.name}, ${target.name}: ${m.message}`);
      }
    }
  }
  if (added.length) {
    app.store.commit(ws, `Add target${added.length > 1 ? 's' : ''} ${added.join(', ')}`);
    toast(`Added ${added.length === 1 ? `the target ${added[0]}` : `${added.length} targets`}.`, { kind: 'ok' });
  }
}

// Designs (*.design.json): set as the workspace's design, for the table whose columns it fits.
async function importDesigns(app, items) {
  for (const item of items) {
    let design;
    try {
      design = JSON.parse(new TextDecoder().decode(await app.readBytes(item)));
    } catch {
      toast(`${item.name} is not JSON.`, { kind: 'error' });
      continue;
    }
    if (design?.format !== 'mavescape-design') {
      toast(`${item.name} is not a MaveScape design (its format is not "mavescape-design").`, { kind: 'error' });
      continue;
    }
    const sources = app.store.ws.sources;
    const fits = sources.map((s) => ({ s, r: validateDesign(design, { columns: s.columns.map((c) => c.name) }) }));
    const best = fits.find((x) => x.r.ok) ?? fits.sort((a, b) => a.r.errors.length - b.r.errors.length)[0];
    if (!best) {
      toast('Open the count table first: a design describes its columns.', { kind: 'error' });
      continue;
    }
    // The workspace's own target (with the same sequence) stands in for the design's copy.
    const own = app.store.ws.targets.find((t) => t.sequence === design.targets?.[0]?.sequence);
    const next = own ? { ...design, targets: [own, ...design.targets.slice(1)] } : design;
    app.store.commit(setDesign(app.store.ws, next, `Opened the design ${item.name}`, best.s.id), `Open the design ${item.name}`);
    const r = best.r;
    toast(r.ok ? `Opened the design ${item.name} for ${best.s.name}: ${summarizeDesign(next).lines.slice(-2, -1)[0] ?? ''}` : `Opened the design ${item.name}; ${r.errors.length} problem${r.errors.length > 1 ? 's' : ''} with ${best.s.name} to fix in the Experiment view.`, { kind: r.ok ? 'ok' : 'error' });
    app.setMode('experiment');
  }
}

// Text for a pasted sequence: a small dialog with a text area.
function pasteSequence() {
  return new Promise((resolve) => {
    const area = h('textarea.input', { rows: 7, placeholder: '>name description\nMSKGEELFTG…', 'aria-label': 'Sequence', style: { width: '100%', fontFamily: 'var(--mono)' } });
    showDialog({
      title: 'Paste a sequence',
      content: [h('p.muted', 'A DNA or protein sequence, with or without a FASTA header line.'), area],
      buttons: [{ label: 'Cancel', onClick: () => resolve(null) }, { label: 'Add', primary: true, onClick: () => resolve(area.value) }],
      onClose: () => resolve(null),
    });
    setTimeout(() => area.focus(), 0);
  });
}

// options.accept: import with the mapping MaveScape detected, without the dialog (remote control);
// returns whether the table was imported.
async function openImportWizard(app, items, options = {}) {
  const progress = progressToast(`Reading ${items.length === 1 ? items[0].name : `${items.length} tables`}…`);
  const files = [];
  try {
    for (const [i, item] of items.entries()) {
      progress.update(i / items.length, `Reading ${item.name}`);
      files.push({ item, name: item.name, size: item.file?.size ?? item.bytes?.length ?? 0, table: await parseTableFile(app, item) });
    }
    progress.done();
  } catch (error) {
    progress.fail(`The table could not be read: ${error.message}`);
    if (options.accept) throw new Error(`The table could not be read: ${error.message}`);
    return false;
  }
  const opened = app.store.sameWorkspace();
  let templates = [];
  try {
    templates = await Promise.all((await app.library.listRecords('import-template')).map((r) => app.library.getRecord('import-template', r.id)));
  } catch { /* none */ }
  // Each file's part: counts, or the barcode-to-variant map (guessed from what it holds).
  for (const f of files) f.role = files.length > 1 && looksLikeMap(f.table) ? 'map' : 'counts';

  // --- State --------------------------------------------------------------------------------
  const state = { absentMeans: 'missing', mode: 'lenient', targetId: app.store.ws.targets[0]?.id ?? '', pendingTargets: [], template: null, mapColumns: null };
  let assembled; // assembleTable's result: the table the mapping applies to, with names derived
  let table;
  let layout;
  let mapping;
  let roles = [];

  // The files assembled (joined, pivoted, named, the map applied) with the current choices.
  function assemble() {
    assembled = assembleTable(files.map((f) => ({ name: f.name, table: f.table, role: f.role })), { absentMeans: state.absentMeans, level: mapping?.level === 'nucleotide' ? 'nucleotide' : 'protein', target: currentTarget() ?? undefined, barcodeColumn: mapping?.barcodeColumn ?? undefined, map: state.mapColumns ?? undefined });
    table = assembled.table ?? { columns: [], rows: 0, diagnostics: [] };
  }

  function setup() {
    mapping = null;
    assemble();
    layout = detectLayout(table);
    const fitting = templates.map((t) => ({ t, m: applyTemplate(t, table) })).find((x) => x.m);
    if (fitting) {
      state.template = fitting.t.name;
      mapping = { ...fitting.m };
      state.mode = fitting.m.mode ?? 'lenient';
    } else {
      state.template = null;
      mapping = { variantColumn: layout.variantColumn, level: layout.level, countColumns: layout.countColumns.slice(), scoreColumns: { ...layout.scoreColumns }, barcodeColumn: layout.barcodeColumn ?? null };
    }
    roles = suggestRoles(mapping.countColumns);
    derivedNames();
  }

  function currentTarget() {
    return [...app.store.ws.targets, ...state.pendingTargets].find((t) => t.id === state.targetId) ?? null;
  }

  // Names MaveScape derived (DiMSum's sequences, Enrich2's elements, the map's): used when the
  // table's own column is not of names.
  function derivedNames() {
    // A column of derived names that another level renamed: the derived one at this level.
    if (mapping.variantColumn && !table.columns.some((c) => c.name === mapping.variantColumn)) mapping.variantColumn = detectLayout(table).variantColumn;
    if (layout.layout === 'dimsum') {
      if (mapping.level === 'nucleotide-sequence') mapping.level = 'nucleotide';
      const named = table.columns.find((c) => c.name === (mapping.level === 'protein' ? 'hgvs_pro (from nt_seq)' : 'hgvs_nt (from nt_seq)'));
      if (named && (!mapping.variantColumn || mapping.variantColumn === 'nt_seq' || /\(from nt_seq\)$/.test(mapping.variantColumn))) mapping.variantColumn = named.name;
    }
  }

  // A problem with the target that naming needs (DiMSum's sequences, a map of sequences).
  const targetProblem = () => assembled.problems.find((p) => p.code === 'dimsum-target' || p.code === 'map-target')?.message ?? null;

  setup();

  // --- Rendering ------------------------------------------------------------------------------
  const summaryEl = h('div');
  const mappingEl = h('div.pane');
  const targetEl = h('div.pane');
  const checksEl = h('div.pane');
  const previewEl = h('div.pane');
  const content = h('div.import-wizard', summaryEl, h('div.import-grid', h('div', mappingEl, targetEl), h('div', checksEl, previewEl)));
  let review = null;

  function renderSummary() {
    clear(summaryEl);
    const first = files[0].table;
    const countFiles = files.filter((f) => f.role !== 'map');
    const facts = files.length === 1
      ? [`${formatCount(first.rows)} rows`, `${first.columns.length} columns`, DELIMITER_NAMES[first.delimiter] ?? 'delimited', LINE_ENDS[first.lineEnd] ?? '', first.encoding?.toUpperCase?.() ?? '', formatBytes(files[0].size)].filter(Boolean)
      : [countFiles.length > 1 ? `${countFiles.length} files joined on their ${mapping.barcodeColumn ? 'barcodes' : 'variants'}` : `${formatCount(countFiles[0]?.table.rows ?? 0)} rows of counts`, files.length > countFiles.length ? 'a barcode map' : null, `${formatCount(table.rows)} ${mapping.barcodeColumn ? 'barcodes' : 'rows'}`].filter(Boolean);
    summaryEl.append(
      h('p.import-facts', h('b', files.map((f) => f.name).join(', ')), ' · ', facts.join(' · ')),
      ...[...assembled.notes, ...layout.notes].map((note) => h('div.callout.accent', icon('info'), h('span', note))),
      state.template ? h('div.callout.ok', icon('check'), h('span', `The import template "${state.template}" fits this table; its mapping is used.`)) : null,
    );
  }

  function renderMapping() {
    clear(mappingEl);
    mappingEl.append(h('h3', icon('table'), 'Mapping'));
    const variantSelect = h('select.input', { 'aria-label': 'Column of variant names', onchange: () => { mapping.variantColumn = variantSelect.value; update(); } },
      ...table.columns.map((c) => h('option', { value: c.name, selected: c.name === mapping.variantColumn }, c.name)));
    const level = h('div.segmented', { role: 'group', 'aria-label': 'Level of the variant names' },
      ...[['protein', 'Protein'], ['nucleotide', 'Nucleotide']].map(([value, label]) => h(`button${mapping.level === value ? '.active' : ''}`, { type: 'button', 'aria-pressed': mapping.level === value ? 'true' : 'false', onclick: () => { mapping.level = value; update(); } }, label)));
    const lenient = h('input', { type: 'checkbox', checked: state.mode === 'lenient', onchange: () => { state.mode = lenient.checked ? 'lenient' : 'strict'; update(); } });
    if (files.length > 1) {
      // Each file's part: counts, or the barcode-to-variant map.
      mappingEl.append(h('div.field', h('span', 'Files'), h('div', ...files.map((f) => {
        const part = h('select.input', { 'aria-label': `What ${f.name} holds`, onchange: () => { f.role = part.value; state.mapColumns = null; setup(); render(); } },
          h('option', { value: 'counts', selected: f.role !== 'map' }, 'counts'),
          h('option', { value: 'map', selected: f.role === 'map' }, 'the barcode-to-variant map'));
        return h('div.file-part', h('span.mono', f.name), part);
      }))));
    }
    // A table of barcodes: its column of barcodes (rows are barcodes, many to a variant).
    const textColumns = table.columns.filter((c) => c.values && c.type === 'text');
    const rowsAre = h('div.segmented', { role: 'group', 'aria-label': 'Each row is' },
      ...[['variants', 'A variant'], ['barcodes', 'A barcode']].map(([value, label]) => {
        const active = (value === 'barcodes') === Boolean(mapping.barcodeColumn);
        return h(`button${active ? '.active' : ''}`, { type: 'button', 'aria-pressed': active ? 'true' : 'false', disabled: value === 'barcodes' && !textColumns.length, onclick: () => {
          mapping.barcodeColumn = value === 'barcodes' ? (layout.barcodeColumn ?? textColumns.find((c) => c.name !== mapping.variantColumn)?.name ?? null) : null;
          update();
        } }, label);
      }));
    mappingEl.append(h('div.field', h('span', 'Each row is'), rowsAre));
    if (mapping.barcodeColumn) {
      const barcodeSelect = h('select.input', { 'aria-label': 'Column of barcodes', onchange: () => { mapping.barcodeColumn = barcodeSelect.value; update(); } },
        ...textColumns.map((c) => h('option', { value: c.name, selected: c.name === mapping.barcodeColumn }, c.name)));
      mappingEl.append(h('label.field', h('span', 'Barcodes'), barcodeSelect));
    }
    mappingEl.append(
      h('label.field', h('span', mapping.barcodeColumn ? 'The variant each barcode carries' : 'Variant names'), variantSelect),
      h('div.field', h('span', 'Named at the level of'), level),
      h('label.check', lenient, 'Read lab and legacy forms (A12V, _wt, p.Ala12*) leniently, keeping the originals'),
    );
    // The map's columns: its barcodes and their variants.
    const mapFile = files.find((f) => f.role === 'map');
    if (mapFile && assembled.map) {
      const mt = headerlessMap(mapFile.table);
      const choose = (label, key, current) => {
        const select = h('select.input', { 'aria-label': label, onchange: () => {
          state.mapColumns = { barcodeColumn: assembled.map.mapBarcodeColumn, variantColumn: assembled.map.mapVariantColumn, [key]: select.value };
          update();
        } }, ...mt.columns.map((c) => h('option', { value: c.name, selected: c.name === current }, c.name)));
        return h('label.field', h('span', label), select);
      };
      mappingEl.append(h('div.field', { style: { marginTop: '10px' } }, h('span', `The map (${mapFile.name})`),
        h('div.map-columns', choose('Its barcodes', 'barcodeColumn', assembled.map.mapBarcodeColumn), choose('Their variants', 'variantColumn', assembled.map.mapVariantColumn)),
        h('p.muted', { style: { fontSize: '11.5px', margin: '4px 0 0' } }, `${formatCount(assembled.map.mapped)} of ${formatCount(table.rows)} counted barcodes named; ${formatCount(assembled.map.conflicts.length)} given two variants (left unmapped); ${formatCount(assembled.map.unmapped.length)} not in the map.`)));
    }
    if (files.filter((f) => f.role !== 'map').length > 1) {
      const absent = h('select.input', { 'aria-label': 'A variant absent from a file', onchange: () => { state.absentMeans = absent.value; setup(); render(); } },
        h('option', { value: 'missing', selected: state.absentMeans === 'missing' }, 'is missing in that sample (not counted)'),
        h('option', { value: 'zero', selected: state.absentMeans === 'zero' }, 'was counted 0 times in that sample'));
      mappingEl.append(h('label.field', h('span', `A ${mapping.barcodeColumn ? 'barcode' : 'variant'} absent from one file`), absent));
    }
    // Identifier columns (MaveDB's accession and hgvs_*) and the variant names are not counts.
    const numeric = table.columns.filter((c) => c.name !== mapping.variantColumn && c.type !== 'text' && !IDENTIFIER_COLUMNS.includes(c.name) && !c.derived && !/\(from nt_seq\)$/.test(c.name));
    const rows = numeric.map((c) => {
      const role = roles.find((r) => r.column === c.name);
      const box = h('input', { type: 'checkbox', checked: mapping.countColumns.includes(c.name), 'aria-label': `Count column ${c.name}`, onchange: () => {
        mapping.countColumns = box.checked ? [...mapping.countColumns, c.name] : mapping.countColumns.filter((x) => x !== c.name);
        roles = suggestRoles(mapping.countColumns);
        update();
      } });
      const describe = role?.role ? [role.role === 'timepoint' ? `time ${role.time}` : role.role === 'bin' ? `bin ${role.bin}` : role.role, role.replicate !== null ? `rep ${role.replicate}` : null, role.tile !== null ? `tile ${role.tile}` : null].filter(Boolean).join(', ') : null;
      return h('tr', h('td', box), h('td', c.name), h('td', c.type === 'number' ? (c.integer ? 'whole numbers' : 'numbers') : h('span.badge.danger', c.type)),
        h('td.r', c.missing ? formatCount(c.missing) : '—'),
        h('td', describe ? h('span.badge', { title: `Suggested: ${role.reason}. Set roles in the Experiment view.` }, `suggested: ${describe}`) : h('span.muted', '—')));
    });
    mappingEl.append(h('div.field', h('span', `Columns of counts (${mapping.countColumns.length} of ${numeric.length})`),
      h('div', { style: { maxHeight: '260px', overflow: 'auto' } }, h('table.data', h('thead', h('tr', h('th', h('span.sr-only', 'Use')), h('th', 'Column'), h('th', 'Values'), h('th.r', 'Missing'), h('th', 'Role'))), h('tbody', ...rows)))),
      h('p.muted', { style: { fontSize: '11.5px', margin: '4px 0 0' } }, 'Roles are suggestions from the column names; nothing is applied until you accept a design in the Experiment view.'));
  }

  function renderTarget(problem) {
    clear(targetEl);
    const targets = [...app.store.ws.targets, ...state.pendingTargets];
    const select = h('select.input', { 'aria-label': 'Target', onchange: () => { state.targetId = select.value; update(); } },
      h('option', { value: '' }, 'No target (names are not checked)'),
      ...targets.map((t) => h('option', { value: t.id, selected: t.id === state.targetId }, `${t.name} (${t.sequenceType === 'dna' ? `${t.sequence.length} nt` : `${t.sequence.length} aa`})`)));
    const addRecords = (text, source) => {
      const records = parseFasta(text);
      if (!records.length) {
        toast(`${source}: no sequence found.`, { kind: 'error' });
        return;
      }
      for (const record of records) {
        const { target, messages } = targetFromSequence(record);
        target.id = `${target.id}-${state.pendingTargets.length + app.store.ws.targets.length + 1}`;
        state.pendingTargets.push(target);
        state.targetId = target.id;
        for (const m of messages) toast(`${target.name}: ${m.message}`, { kind: m.level === 'error' ? 'error' : undefined });
      }
      update();
    };
    const fasta = h('input', { type: 'file', accept: '.fasta,.fa,.fna,.faa,.fas,.seq,.txt', hidden: true, onchange: async () => {
      const file = fasta.files[0];
      if (file) addRecords(await file.text(), file.name);
    } });
    targetEl.append(h('h3', icon('sequence'), 'Target'),
      h('label.field', h('span', 'The sequence the variants are named against'), select),
      h('div.btn-row', fasta,
        h('button.btn.small', { type: 'button', onclick: () => fasta.click() }, icon('file'), 'From a FASTA file…'),
        h('button.btn.small', { type: 'button', onclick: async () => { const text = await pasteSequence(); if (text) addRecords(text, 'The pasted sequence'); } }, icon('edit'), 'Paste a sequence…')),
      problem ? h('div.callout.warn', { style: { marginTop: '10px' } }, icon('warning'), h('span', problem)) : null,
      !problem && !state.targetId ? h('p.muted', { style: { fontSize: '11.5px', margin: '8px 0 0' } }, 'With a target, every variant\'s position and reference residue is checked against it. Scoring needs one.') : null);
  }

  function renderChecks() {
    clear(checksEl);
    checksEl.append(h('h3', icon('qc'), 'Checks'));
    const s = review.summary;
    if (s) {
      checksEl.append(h('div.stat-grid',
        s.barcodes ? h('div.stat-tile', h('div.k', 'Barcodes'), h('div.v', formatCount(s.barcodes.rows - s.barcodes.unmapped))) : null,
        h('div.stat-tile', h('div.k', 'Variants'), h('div.v', formatCount(s.total))),
        h('div.stat-tile', h('div.k', 'Read leniently'), h('div.v', formatCount(s.warning))),
        h('div.stat-tile', h('div.k', 'Not valid'), h('div.v', formatCount(s.invalid)))),
        h('p.muted', { style: { fontSize: '12px' } }, Object.entries(s.byKind).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${formatCount(n)} ${k}`).join(' · ') || 'No valid variant.', s.positions ? ` · positions ${s.positions[0]}–${s.positions[1]}` : '', s.barcodes ? ` · ${s.barcodes.perVariant.toFixed(1)} barcodes per variant` : ''));
    }
    const list = (items, kind, glyph) => items.map((p) => h(`div.callout.${kind}`, { style: { marginTop: '6px' } }, icon(glyph), h('span', p.message)));
    if (!review.blocking.length && !review.warnings.length) checksEl.append(h('div.callout.ok', { style: { marginTop: '6px' } }, icon('check'), h('span', 'Nothing blocks scoring.')));
    checksEl.append(...list(review.blocking, 'danger', 'warning'), ...list(review.warnings, 'warn', 'warning'), ...list(review.info, 'accent', 'info'));
    if (review.blocking.length) checksEl.append(h('p.muted', { style: { fontSize: '11.5px', margin: '8px 0 0' } }, 'You can import the table to look at it; scoring stays blocked until these are fixed in the file.'));
  }

  function renderPreview() {
    clear(previewEl);
    previewEl.append(h('h3', icon('table'), 'First rows'));
    const v = review.variants;
    const counts = mapping.countColumns.slice(0, 4).map((name) => table.columns.find((c) => c.name === name)).filter(Boolean);
    const barcodes = mapping.barcodeColumn ? table.columns.find((c) => c.name === mapping.barcodeColumn) : null;
    const n = Math.min(8, table.rows);
    const rows = [];
    for (let row = 0; row < n; row += 1) {
      // A table of barcodes: the variant the row's barcode carries (none: unmapped).
      const i = review.variantOfRow ? review.variantOfRow[row] : row;
      const status = i >= 0 ? v?.status[i] : undefined;
      rows.push(h('tr', barcodes ? h('td.mono', cellText(barcodes, row)) : null, h('td.mono', i >= 0 ? v?.original[i] ?? '' : h('span.muted', 'no variant')), h('td.mono', (i >= 0 && v?.key[i]) || '—'),
        h('td', i < 0 ? h('span.badge.warn', 'unmapped') : status === STATUS.VALID ? h('span.badge.ok', 'valid') : status === STATUS.WARNING ? h('span.badge.warn', { title: v.messages.get(i)?.join('; ') }, 'read leniently') : h('span.badge.danger', { title: v?.messages.get(i)?.join('; ') }, 'not valid')),
        h('td', v && i >= 0 ? KIND_NAMES[v.kind[i]] : ''),
        ...counts.map((c) => h('td.r', cellText(c, row) === '' ? h('span.muted', 'missing') : cellText(c, row)))));
    }
    previewEl.append(h('div', { style: { overflow: 'auto' } }, h('table.data', h('thead', h('tr', barcodes ? h('th', 'Barcode') : null, h('th', 'As written'), h('th', 'MAVE-HGVS'), h('th', 'Status'), h('th', 'Kind'), ...counts.map((c) => h('th.r', c.name)))), h('tbody', ...rows))));
  }

  function render() {
    review = reviewImport(table, { ...mapping, mode: state.mode, target: currentTarget() ?? undefined });
    // What assembling the files found: the map's conflicts, Enrich2's names, dms_variants' layout
    // (which say why barcodes are unmapped, better than the review's count of them).
    if (assembled.map) review.info = review.info.filter((p) => p.code !== 'barcodes-unmapped');
    for (const p of assembled.problems) {
      if (p.code === 'dimsum-target' || p.code === 'map-target') continue;
      (p.level === 'error' ? review.blocking : p.level === 'warning' ? review.warnings : review.info).push(p);
    }
    renderSummary();
    renderMapping();
    renderTarget(targetProblem());
    renderChecks();
    renderPreview();
  }

  // A change of target, level or barcode column can change the names derived: assemble again.
  const update = debounce(() => {
    assemble();
    derivedNames();
    render();
  }, 60);
  render();
  if (options.accept) {
    if (targetProblem()) throw new Error(targetProblem());
    return (await importNow()) === true;
  }

  // --- Import ---------------------------------------------------------------------------------
  async function storeFile(file) {
    if (app.library.kind === 'desktop' && app.library.addFile) {
      const stored = await app.library.addFile(file);
      return { sha256: stored.sha256, size: stored.size };
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const sha256 = await sha256Hex(bytes);
    await app.library.putFile(sha256, bytes);
    return { sha256, size: bytes.length };
  }

  async function importNow() {
    if (!opened()) {
      toast('Another workspace was opened; the table was not added to it. Open it again.', { kind: 'error' });
      return;
    }
    if (!mapping.variantColumn) {
      if (options.accept) throw new Error(`${files[0].name}: MaveScape found no column of variant names; open it in the window to choose one.`);
      toast('Choose the column of variant names.', { kind: 'error' });
      return false;
    }
    const busy = progressToast('Adding the table to the library…');
    try {
      const stored = [];
      for (const f of files) stored.push({ fileName: f.name, ...(await storeFile(f.item.file instanceof Blob ? f.item.file : new Blob([f.item.bytes]))), ...(f.role === 'map' ? { role: 'map' } : {}) });
      // The source is known by its (first) file of counts; a map is one of its files.
      const lead = stored.find((x) => x.role !== 'map') ?? stored[0];
      const countFiles = files.filter((f) => f.role !== 'map');
      const mapFile = files.find((f) => f.role === 'map');
      let ws = app.store.ws;
      let targetId = '';
      const target = currentTarget();
      if (target) {
        const added = addTarget(ws, state.pendingTargets.includes(target) ? { ...target, id: target.id.replace(/-\d+$/, '') } : target);
        ws = added.ws;
        targetId = added.id;
      }
      const first = countFiles[0]?.table ?? files[0].table;
      const source = {
        name: files.length === 1 ? files[0].name : mapFile && countFiles.length === 1 ? `${countFiles[0].name} with ${mapFile.name}` : `${countFiles.length} tables${mapFile ? ' with a barcode map' : ''}`,
        fileName: lead.fileName,
        sha256: lead.sha256,
        size: lead.size,
        files: stored,
        rows: table.rows,
        columns: table.columns.map((c) => ({ name: c.name, type: c.type, missing: c.missing })),
        encoding: first.encoding,
        delimiter: first.delimiter,
        lineEnd: first.lineEnd,
        layout: layout.layout,
        mapping: {
          variantColumn: mapping.variantColumn, level: mapping.level, mode: state.mode, countColumns: mapping.countColumns.slice(), scoreColumns: { ...mapping.scoreColumns },
          absentMeans: countFiles.length > 1 ? state.absentMeans : undefined, derivedNames: layout.layout === 'dimsum' ? 'nt_seq' : undefined, template: state.template ?? undefined,
          // A table of barcodes, and how the files were assembled (dms_variants' layout, Enrich2's
          // counts, a barcode map and its columns), to assemble them again the same way.
          barcodeColumn: mapping.barcodeColumn ?? undefined,
          assembly: assembled.kind !== 'table' || assembled.map ? { kind: assembled.kind, ...(assembled.map ? { map: { barcodeColumn: assembled.map.mapBarcodeColumn, variantColumn: assembled.map.mapVariantColumn } } : {}) } : undefined,
        },
        target: targetId || undefined,
        roleSuggestions: roles.filter((r) => r.role),
        summary: review.summary,
        problems: { blocking: review.blocking.map((p) => p.message), warnings: review.warnings.map((p) => p.message) },
        imported: now(),
      };
      // An untitled workspace takes the name of its first table.
      if (!ws.sources.length && ws.name === 'Untitled workspace') ws = { ...ws, name: source.name.replace(/\.(csv|tsv|tab|txt|xlsx)(\.gz)?$/i, '') };
      const added = addSource(ws, source);
      app.store.commit(added.ws, `Import ${source.name}`);
      app.tables.set(added.id, { table, review });
      app.focusItem({ kind: 'source', id: added.id });
      busy.done(`Imported ${source.name}: ${review.summary?.barcodes ? `${formatCount(review.summary.barcodes.rows - review.summary.barcodes.unmapped)} barcodes of ` : ''}${formatCount(review.summary?.total ?? table.rows)} variants${review.blocking.length ? `; ${review.blocking.length} problem${review.blocking.length > 1 ? 's' : ''} block scoring` : ''}.`);
      app.log(`Imported ${source.name} (${source.sha256.slice(0, 12)}…): ${review.summary?.valid ?? 0} valid, ${review.summary?.warning ?? 0} read leniently, ${review.summary?.invalid ?? 0} not valid.`);
      if (app.store.ui.mode === 'welcome') app.setMode('experiment');
      return true;
    } catch (error) {
      busy.fail(`The table could not be added: ${error.message}`);
      if (options.accept) throw error;
      return false;
    }
  }

  async function saveTemplate() {
    const field = h('input.input', { value: files[0].name.replace(/\.[^.]+$/, ''), 'aria-label': 'Template name' });
    showDialog({
      title: 'Save the mapping as a template',
      content: [h('p.muted', 'The next table with these columns opens with this mapping.'), field],
      buttons: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: async () => {
        const template = makeTemplate(field.value.trim() || 'Import template', table, { ...mapping, mode: state.mode, absentMeans: state.absentMeans, roles: roles.filter((r) => r.role) });
        const id = `t${Date.now().toString(36)}`;
        try {
          await app.library.putRecord('import-template', id, template);
          toast(`Saved the template "${template.name}".`, { kind: 'ok' });
        } catch (error) {
          toast(`The template could not be saved: ${error.message}`, { kind: 'error' });
          return false;
        }
        return undefined;
      } }],
    });
  }

  showDialog({
    title: `Import ${files.length === 1 ? files[0].name : files.length === 2 ? `${files[0].name} and ${files[1].name}` : `${files.length} files`}`,
    width: 'xwide',
    content,
    buttons: [
      { label: 'Save as template…', ghost: true, onClick: () => { saveTemplate(); return false; } },
      { label: 'Cancel' },
      { label: 'Import', primary: true, onClick: importNow },
    ],
  });
  return false;
}
