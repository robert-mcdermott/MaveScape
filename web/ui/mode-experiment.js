// The Experiment view (wave 1, slice 4): what each column of the counts is. The design is edited
// as two tables (columns → samples; replicates × slots), starts from the draft MaveScape makes
// from the column names or from a sample sheet, and is checked and described as it changes
// (requirements E2–E6, V6). Every edit is undoable and goes into the workspace's history.

import { h, icon, clear, downloadBlob, formatCount } from './dom.js';
import { confirmDialog, showDialog, toast } from './overlays.js';
import { summarizeDesign, validateDesign, IDENTIFIER_COLUMNS } from '../lib/design.js';
import {
  addCondition, addReplicate, addTile, assignColumn, columnAssignments, removeCondition, removeReplicate, removeTile,
  setAsideOtherColumns, setBarcodeColumn, setBinGates, setBinValue, setControlPositions, setControls, setControlWhy, setField, setLibraryMethod, setModel, setReadout, setSlot, setTime, slotSample, slotsOf, updateCondition, updateReplicate, updateSample, updateTile,
} from '../lib/design-edit.js';
import { ASSAY_MECHANISMS, ASSAY_METHODS, DIRECTIONS, LIBRARY_METHODS, MODEL_SYSTEMS } from '../lib/readout.js';
import { designFromSampleSheet } from '../lib/samplesheet.js';
import { parseTable } from '../lib/csv.js';
import { setDesign, updateTarget } from '../lib/workspace.js';
import { draftFromColumns } from './design-draft.js';

const MODELS = [['two-population', 'Two populations'], ['time-series', 'Time series'], ['bins', 'FACS bins']];
const TIME_UNITS = ['round', 'generation', 'hour', 'day', 'minute', 'other'];

export function mountExperimentMode(app, container) {
  const { store } = app;
  const root = h('div.view');
  container.append(root);
  // Times and bins added before any sample is placed in them (the matrix's empty columns).
  let pendingSlots = [];
  let pendingFor = null;

  const source = () => store.ws.sources.find((s) => s.id === (store.ws.designSource ?? store.ws.sources[0]?.id)) ?? null;
  const countColumns = (s) => (s?.mapping?.countColumns ?? []).filter((c) => !IDENTIFIER_COLUMNS.includes(c));

  function commit(design, label) {
    store.commit(setDesign(store.ws, design, label, store.ws.designSource ?? source()?.id ?? null), label);
  }
  function edit(fn, label) {
    try {
      const next = fn(store.ws.design);
      if (next && next !== store.ws.design) commit(next, label);
    } catch (error) {
      toast(error.message, { kind: 'error' });
    }
  }

  async function sampleSheet() {
    const s = source();
    if (!s) return;
    const input = h('input', { type: 'file', accept: '.csv,.tsv,.txt,.tab' });
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;
      const sheet = parseTable(new Uint8Array(await file.arrayBuffer()), { fileName: file.name });
      const target = store.ws.targets.find((t) => t.id === s.target);
      const { design, problems } = designFromSampleSheet(sheet, { countColumns: countColumns(s), variants: { column: s.mapping.variantColumn, level: s.mapping.level === 'nucleotide' ? 'nucleotide' : 'protein' }, barcodeColumn: s.mapping.barcodeColumn, targets: target ? [target] : [], name: store.ws.design?.name ?? s.name.replace(/\.[^.]+$/, '') });
      const errors = problems.filter((p) => p.level === 'error');
      const apply = () => store.commit(setDesign(store.ws, setAsideOtherColumns(design, s.columns.map((c) => c.name), IDENTIFIER_COLUMNS), `Set the design from the sample sheet ${file.name}`, s.id), `Design from ${file.name}`);
      if (!problems.length && design) {
        apply();
        toast(`Design set from ${file.name}.`, { kind: 'ok' });
        return;
      }
      showDialog({
        title: `Sample sheet ${file.name}`,
        content: [
          h('p', design ? `A ${design.model} design of ${design.replicates.length} replicates and ${design.samples.length} samples, with these problems:` : 'The sheet could not be read as a design:'),
          ...problems.map((p) => h(`div.callout.${p.level === 'error' ? 'danger' : 'warn'}`, { style: { marginTop: '6px' } }, p.message)),
        ],
        buttons: design ? [{ label: 'Cancel' }, { label: errors.length ? 'Use it anyway, and fix it here' : 'Use it', primary: true, onClick: apply }] : [{ label: 'Close' }],
      });
    });
    input.click();
  }

  function exportDesign() {
    const design = store.ws.design;
    if (!design) return;
    const name = (design.name ?? 'design').replace(/[^\w.-]+/g, '_');
    downloadBlob(new Blob([`${JSON.stringify(design, null, 2)}\n`], { type: 'application/json' }), `${name}.design.json`);
  }

  // --- Panes ----------------------------------------------------------------------------------

  function sourcePane(s) {
    const select = h('select.input', { 'aria-label': 'The table this design describes', onchange: () => store.commit({ ...store.ws, designSource: select.value }, 'Choose the table of the design') },
      ...store.ws.sources.map((x) => h('option', { value: x.id, selected: x.id === s.id }, `${x.name} (${formatCount(x.rows)} rows)`)));
    return h('div.pane', h('h3', icon('table'), 'Table'), store.ws.sources.length > 1 ? h('label.field', h('span', 'The table this design describes'), select) : h('p', { style: { margin: '0 0 6px' } }, h('b', s.name), ` · ${formatCount(s.rows)} rows · ${countColumns(s).length} count columns`),
      s.problems?.blocking?.length ? h('div.callout.danger', icon('warning'), h('span', `${s.problems.blocking.length} problem${s.problems.blocking.length > 1 ? 's' : ''} in the table block scoring (see the table in the inspector).`)) : null);
  }

  function targetPane(s) {
    const target = store.ws.targets.find((t) => t.id === (store.ws.design?.targets?.[0]?.id ?? s.target));
    if (!target) {
      return h('div.pane', h('h3', icon('sequence'), 'Target'), h('div.callout.warn', icon('warning'), h('span', 'No target: open the target\'s FASTA (or paste it when importing) so that variant names can be checked and positions mapped.')));
    }
    const field = (label, value, onCommit, attrs = {}) => {
      const input = h('input.input', { value: value ?? '', ...attrs, onchange: () => onCommit(input.value.trim()) });
      return h('label.field', h('span', label), input);
    };
    const patch = (p, detail) => {
      let ws = updateTarget(store.ws, target.id, p, detail);
      if (store.ws.design && !store.ws.design.targets.some((t) => t.id === target.id)) ws = setDesign(ws, { ...ws.design, targets: [ws.targets.find((t) => t.id === target.id)] }, `Target ${target.name}`);
      if (ws !== store.ws) store.commit(ws, detail);
    };
    const ids = target.identifiers ?? {};
    const setId = (key) => (v) => patch({ identifiers: Object.fromEntries(Object.entries({ ...ids, [key]: v }).filter(([, x]) => x)) }, `Set the target's ${key} identifier to ${v || 'none'}`);
    const toInt = (v, label, apply) => {
      const n = Number(v);
      if (!Number.isInteger(n)) toast(`${label} is a whole number.`, { kind: 'error' });
      else apply(n);
    };
    return h('div.pane', h('h3', icon('sequence'), 'Target'),
      h('p.muted', { style: { margin: '0 0 8px', fontSize: '12px' } }, `${target.sequenceType === 'dna' ? 'DNA' : 'Protein'}, ${formatCount(target.sequence.length)} ${target.sequenceType === 'dna' ? 'nt' : 'aa'}. Variants are numbered from the target's first ${target.sequenceType === 'dna' ? 'base' : 'residue'}; the offset gives positions in the reference protein.`),
      h('div.form-grid',
        field('Name', target.name, (v) => v && patch({ name: v }, `Renamed the target ${v}`)),
        field('Offset (reference position − target position)', target.offset ?? 0, (v) => toInt(v, 'The offset', (n) => patch({ offset: n }, `Set the target's offset to ${n}`)), { inputmode: 'numeric' }),
        target.sequenceType === 'dna' ? field('Coding start (base)', target.codingStart ?? 1, (v) => toInt(v, 'The coding start', (n) => patch({ codingStart: n }, `Set the target's coding start to ${n}`)), { inputmode: 'numeric' }) : null,
        field('UniProt', ids.uniprot, setId('uniprot'), { placeholder: 'P62993' }),
        field('Gene', ids.gene, setId('gene'), { placeholder: 'GRB2' }),
        field('RefSeq', ids.refseq, setId('refseq'), { placeholder: 'NM_002086.5' }),
        field('Ensembl', ids.ensembl, setId('ensembl'), { placeholder: 'ENST…' }),
        field('Organism', target.organism, (v) => patch({ organism: v || undefined }, `Set the target's organism to ${v || 'none'}`), { placeholder: 'Homo sapiens' })));
  }

  function summaryPane(design, s) {
    const result = validateDesign(design, { columns: s.columns.map((c) => c.name) });
    const summary = summarizeDesign(design);
    return h('div.pane', h('h3', icon('experiment'), 'Summary'),
      h('ul.summary-lines', ...summary.lines.map((line) => h('li', line))),
      result.ok ? h('div.callout.ok', icon('check'), h('span', 'The design is complete: every column is accounted for, every replicate has its samples.')) : null,
      ...result.errors.map((e) => h('div.callout.danger', { style: { marginTop: '6px' } }, icon('warning'), h('span', e.message))),
      ...result.warnings.map((w) => h('div.callout.warn', { style: { marginTop: '6px' } }, icon('info'), h('span', w.message))));
  }

  function settingsPane(design, s) {
    const model = h('div.segmented', { role: 'group', 'aria-label': 'Kind of experiment' },
      ...MODELS.map(([id, label]) => h(`button${design.model === id ? '.active' : ''}`, { type: 'button', 'aria-pressed': design.model === id ? 'true' : 'false', onclick: () => edit((d) => setModel(d, id), `Made the design ${label.toLowerCase()}`) }, label)));
    const extra = [];
    if (design.model === 'time-series') {
      extra.push(h('label.field', h('span', 'Unit of time'), h('select.input', { onchange: (e) => edit((d) => setField(d, { time: { unit: e.target.value } }), `Set the unit of time to ${e.target.value}`) }, ...TIME_UNITS.map((u) => h('option', { value: u, selected: design.time?.unit === u }, u)))));
    }
    if (design.model === 'bins') {
      extra.push(h('label.field', h('span', 'Bin values are'), h('select.input', { onchange: (e) => edit((d) => setField(d, { bins: { weight: e.target.value } }), `Bin values are ${e.target.value}`) },
        ...[['rank', 'ranks or weights (VAMP-seq 0.25–1)'], ['fluorescence', 'fluorescence'], ['other', 'another measure']].map(([v, l]) => h('option', { value: v, selected: design.bins?.weight === v }, l)))));
    }
    return h('div.pane', h('h3', icon('settings'), 'Experiment'),
      h('label.field', h('span', 'Name'), h('input.input', { value: design.name ?? '', onchange: (e) => edit((d) => setField(d, { name: e.target.value.trim() }), 'Renamed the design') })),
      h('div.field', h('span', 'Kind of experiment'), model),
      ...extra,
      barcodesBlock(design, s), conditionsBlock(design), tilesBlock(design));
  }

  // What the assay measures (wave 2, slice 8): the readout in MaveDB's terms, how the library was
  // made, and the controls, each with where it serves and why. Nothing is guessed: until the
  // direction is stated, the map and QC say what they assume.
  function readoutPane(design) {
    const r = design.readout ?? {};
    const select = (label, value, options, onPick, empty = 'not stated') => h('label.field', h('span', label), h('select.input', { 'aria-label': label, onchange: (e) => onPick(e.target.value) },
      h('option', { value: '', selected: !value }, empty),
      ...options.map(([v, text]) => h('option', { value: v, selected: v === value }, text)),
      value && !options.some(([v]) => v === value) ? h('option', { value, selected: true }, `${value} (not one of MaveDB's terms)`) : null));
    const terms = (list) => list.map((x) => [x, x]);
    const phenotype = h('input.input', { value: r.phenotype ?? '', placeholder: 'Cellular abundance of the domain', 'aria-label': 'What was measured', onchange: () => edit((d) => setReadout(d, { phenotype: phenotype.value.trim() }), `Readout: measured ${phenotype.value.trim() || 'not stated'}`) });
    const controls = design.controls ?? {};
    const wild = h('input.input', { value: controls.wildType ?? 'auto', 'aria-label': 'Wild type', onchange: () => edit((d) => setControls(d, { wildType: wild.value.trim() || 'auto' }), `Set the wild type to ${wild.value.trim() || 'auto'}`) });
    const choice = (key, label) => h('label.field', h('span', label), h('select.input', { onchange: (e) => edit((d) => setControls(d, { [key]: e.target.value }), `${label}: ${e.target.value}`) },
      h('option', { value: 'auto', selected: (controls[key] ?? 'auto') === 'auto' }, 'from the names'),
      h('option', { value: 'none', selected: controls[key] === 'none' }, 'none'),
      Array.isArray(controls[key]) ? h('option', { value: '__list', selected: true, disabled: true }, controls[key].join(', ')) : null));
    const position = (key, end, label) => {
      const range = controls.positions?.[key] ?? {};
      const input = h('input.input', { value: range[end] ?? '', inputmode: 'numeric', placeholder: end === 'start' ? 'first' : 'last', 'aria-label': label, onchange: () => {
        const text = input.value.trim();
        const n = Number(text);
        if (text && !Number.isInteger(n)) {
          toast(`${label} is a whole number.`, { kind: 'error' });
          return;
        }
        edit((d) => setControlPositions(d, key, { ...(d.controls?.positions?.[key] ?? {}), [end]: text ? n : null }), `${label}: ${text || 'open'}`);
      } });
      return input;
    };
    const why = (key, label, placeholder) => {
      const input = h('input.input', { value: controls.why?.[key] ?? '', placeholder, 'aria-label': label, onchange: () => edit((d) => setControlWhy(d, key, input.value), `${label}: ${input.value.trim() || 'none'}`) });
      return h('label.field', h('span', label), input);
    };
    const range = (key, label) => h('div.field', h('span', label), h('div.range-inputs', position(key, 'start', `${label}, from`), h('span.muted', '–'), position(key, 'end', `${label}, to`)));
    return h('div.pane.readout-pane', h('h3', icon('target'), 'What the assay measures'),
      h('p.muted', { style: { margin: '0 0 8px', fontSize: '12px' } }, 'A score\'s sign means nothing without the selection. The map\'s legend, the separation of the controls, the methods and the exports read the direction from here; until it is stated, MaveScape takes a higher score to mean more of the function, and says so. The terms are MaveDB\'s.'),
      h('label.field', h('span', 'What was measured'), phenotype),
      h('div.form-grid',
        select('A higher score means', design.readout?.direction ?? '', [['higher-more', 'more of the function'], ['higher-less', 'less of the function'], ['unsigned', 'a larger change, either way (no sign)']], (v) => edit((d) => setReadout(d, { direction: v }), v ? `Readout: ${DIRECTIONS[v]}` : 'Readout: direction not stated'), 'not stated (taken as more)'),
        select('Assay method', r.method, terms(ASSAY_METHODS), (v) => edit((d) => setReadout(d, { method: v }), `Readout: method ${v || 'not stated'}`)),
        select('It detects', r.mechanism, terms(ASSAY_MECHANISMS), (v) => edit((d) => setReadout(d, { mechanism: v }), `Readout: detects ${v || 'not stated'}`)),
        select('Model system', r.modelSystem, terms(MODEL_SYSTEMS), (v) => edit((d) => setReadout(d, { modelSystem: v }), `Readout: model system ${v || 'not stated'}`)),
        select('The library was made by', design.library?.method, terms(LIBRARY_METHODS), (v) => edit((d) => setLibraryMethod(d, v), `Library made by ${v || 'not stated'}`))),
      h('div.section-title', { style: { marginTop: '10px' } }, 'Controls'),
      h('div.form-grid', h('label.field', h('span', 'Wild-type row ("auto": p.=, c.= or _wt)'), wild), choice('synonymous', 'Synonymous controls'), choice('nonsense', 'Nonsense controls'),
        range('nonsense', 'Nonsense controls at positions'), range('synonymous', 'Synonymous controls at positions')),
      why('nonsense', 'Why the nonsense variants are loss-of-function controls', 'Stops before the last domain lose the function'),
      why('synonymous', 'Why the synonymous variants are wild-type-like controls', 'Codon changes outside splice regions'));
  }

  // Whether each row is a variant or a barcode (wave 2, slice 4): a barcode table's column of
  // barcodes, its variants summed or scored per barcode in the Score view.
  function barcodesBlock(design, s) {
    const text = (s?.columns ?? []).filter((c) => c.type === 'text' && c.name !== design.variants?.column);
    const current = design.library?.level === 'barcode' ? design.library.barcodeColumn : '';
    if (!text.length && !current) return null;
    const select = h('select.input', { 'aria-label': 'Each row is', onchange: () => edit((d) => setBarcodeColumn(d, select.value || null), select.value ? `Made the rows barcodes (column ${select.value})` : 'Made the rows variants') },
      h('option', { value: '', selected: !current }, 'a variant'),
      ...text.map((c) => h('option', { value: c.name, selected: c.name === current }, `a barcode, in "${c.name}"`)));
    return h('div',
      h('div.section-title', { style: { marginTop: '10px' } }, 'Rows'),
      h('label.field', h('span', 'Each row of the table is'), select),
      current ? h('p.muted', { style: { fontSize: '12px', margin: '0 0 6px' } }, `Barcodes carrying the variant in "${design.variants?.column}": summed per variant, or scored one by one and combined, as the Score view says.`) : null);
  }

  function conditionsBlock(design) {
    const conditions = design.conditions ?? [];
    return h('div',
      h('div.section-title', { style: { marginTop: '10px' } }, 'Conditions'),
      conditions.length ? h('table.data', h('tbody', ...conditions.map((c) => h('tr',
        h('td', h('input.input', { value: c.name, 'aria-label': 'Condition name', onchange: (e) => edit((d) => updateCondition(d, c.id, { name: e.target.value.trim() || c.name }), `Renamed condition ${c.name}`) })),
        h('td', h('label.check', h('input', { type: 'radio', name: 'reference-condition', checked: Boolean(c.reference), onchange: () => edit((d) => updateCondition(d, c.id, { reference: true }), `Made ${c.name} the reference condition`) }), 'reference')),
        h('td.r', h('button.icon-button.small', { type: 'button', title: `Remove ${c.name}`, 'aria-label': `Remove ${c.name}`, onclick: () => edit((d) => removeCondition(d, c.id), `Removed condition ${c.name}`) }, icon('trash'))))))) : h('p.muted', { style: { fontSize: '12px', margin: '0 0 6px' } }, 'One condition. Add conditions to compare treatments (wave 2 scores them against each other).'),
      h('button.btn.small', { type: 'button', onclick: () => edit((d) => addCondition(d, conditions.length ? `Condition ${conditions.length + 1}` : 'Condition 1').design, 'Added a condition') }, icon('plus'), 'Add a condition'));
  }

  function tilesBlock(design) {
    const tiles = design.library?.tiles ?? [];
    const num = (t, key) => h('input.input', { value: t[key], inputmode: 'numeric', 'aria-label': `${t.name ?? t.id} ${key}`, style: { width: '80px' }, onchange: (e) => {
      const n = Number(e.target.value);
      if (Number.isInteger(n) && n > 0) edit((d) => updateTile(d, t.id, { [key]: n }), `Set ${t.name ?? t.id} ${key} to ${n}`);
    } });
    return h('div',
      h('div.section-title', { style: { marginTop: '10px' } }, 'Tiles'),
      tiles.length ? h('table.data', h('thead', h('tr', h('th', 'Tile'), h('th', 'From'), h('th', 'To'), h('th'))), h('tbody', ...tiles.map((t) => h('tr', h('td', t.name ?? t.id), h('td', num(t, 'start')), h('td', num(t, 'end')),
        h('td.r', h('button.icon-button.small', { type: 'button', title: `Remove ${t.name ?? t.id}`, 'aria-label': `Remove ${t.name ?? t.id}`, onclick: () => edit((d) => removeTile(d, t.id), `Removed ${t.name ?? t.id}`) }, icon('trash'))))))) : h('p.muted', { style: { fontSize: '12px', margin: '0 0 6px' } }, 'The whole target in one library. Add tiles when parts of it were made and selected apart.'),
      h('button.btn.small', { type: 'button', onclick: () => edit((d) => addTile(d, 1, Math.max(1, d.targets[0] ? (d.targets[0].sequenceType === 'dna' ? Math.floor(d.targets[0].sequence.length / 3) : d.targets[0].sequence.length) : 1)).design, 'Added a tile') }, icon('plus'), 'Add a tile'));
  }

  function columnsPane(design, s) {
    const columns = countColumns(s);
    const assignments = columnAssignments(design, columns);
    const sampleColumns = design.samples.flatMap((x) => x.columns);
    const rows = columns.map((column) => {
      const a = assignments.get(column);
      const sample = a.kind === 'sample' ? design.samples.find((x) => x.id === a.sample) : null;
      const first = sample && sample.columns[0] === column;
      const value = first ? 'own' : a.kind === 'sample' ? `sample:${a.sample}` : a.kind === 'copy' ? `copy:${a.copyOf}` : a.kind;
      const select = h('select.input', { 'aria-label': `Use of column ${column}`, onchange: () => {
        const v = select.value;
        const to = v === 'own' ? { kind: 'new-sample' } : v.startsWith('sample:') ? { kind: 'sample', sample: v.slice(7) } : v.startsWith('copy:') ? { kind: 'copy', copyOf: v.slice(5) } : v === 'ignored' ? { kind: 'ignored', reason: 'not used' } : { kind: 'unassigned' };
        edit((d) => assignColumn(d, column, to).design, `Column ${column}: ${select.selectedOptions[0].textContent}`);
      } },
        h('option', { value: 'unassigned', selected: value === 'unassigned' }, '— not set'),
        h('option', { value: 'own', selected: value === 'own' }, 'A sample of its own'),
        h('optgroup', { label: 'A technical replicate of' }, ...design.samples.filter((x) => x.columns[0] !== column).map((x) => h('option', { value: `sample:${x.id}`, selected: value === `sample:${x.id}` }, x.name ?? x.id))),
        h('optgroup', { label: 'A copy (same values) of' }, ...sampleColumns.filter((c) => c !== column).map((c) => h('option', { value: `copy:${c}`, selected: value === `copy:${c}` }, c))),
        h('option', { value: 'ignored', selected: value === 'ignored' }, 'Not used'));
      const detail = first
        ? h('input.input', { value: sample.name ?? '', 'aria-label': `Name of sample ${sample.id}`, onchange: (e) => edit((d) => updateSample(d, sample.id, { name: e.target.value.trim() }), `Renamed sample ${sample.id}`) })
        : a.kind === 'ignored' ? h('input.input', { value: a.reason ?? '', 'aria-label': `Why ${column} is not used`, placeholder: 'why', onchange: (e) => edit((d) => assignColumn(d, column, { kind: 'ignored', reason: e.target.value.trim() || 'not used' }).design, `Column ${column} not used: ${e.target.value.trim()}`) })
          : a.kind === 'copy' ? h('span.muted', `copy of ${a.copyOf}`) : sample ? h('span.muted', `with ${sample.columns[0]}`) : null;
      const batch = first ? h('input.input', { value: sample.batch ?? '', placeholder: '—', 'aria-label': `Batch of sample ${sample.id}`, style: { width: '90px' }, onchange: (e) => edit((d) => updateSample(d, sample.id, { batch: e.target.value.trim() }), `Set the batch of ${sample.id}`) }) : null;
      // Missing read as 0: for tables that write variants that dropped out during selection as
      // missing (the QC finding "Missing after selection" says when).
      const cellsInput = first && design.model === 'bins' ? h('input.input', { value: sample.cells ?? '', inputmode: 'numeric', placeholder: '—', style: { width: '90px' }, 'aria-label': `Cells sorted into ${sample.name ?? sample.id}`, onchange: (e) => edit((d) => updateSample(d, sample.id, { cells: e.target.value.trim() === '' ? null : Number(e.target.value) }), `Set the cells sorted into ${sample.name ?? sample.id}`) }) : null;
      const zero = first ? h('input', { type: 'checkbox', checked: Boolean(sample.missingMeansZero), 'aria-label': `Read missing counts as 0 in ${sample.name ?? sample.id}`, title: 'Read this sample\'s missing counts as 0: for tables that write variants that dropped out during selection as missing. Not for a replicate\'s first sample.', onchange: (e) => edit((d) => updateSample(d, sample.id, { missingMeansZero: e.target.checked }), `${e.target.checked ? 'Read' : 'Stopped reading'} missing counts as 0 in ${sample.name ?? sample.id}`) }) : null;
      return h(`tr${a.kind === 'unassigned' ? '.unset' : ''}`, h('td.mono', column), h('td', select), h('td', detail), h('td', batch), design.model === 'bins' ? h('td', cellsInput) : null, h('td.c', zero));
    });
    return h('div.pane', h('h3', icon('table'), 'Columns', h('span.spacer'), h('span.muted', { style: { fontWeight: 400, fontSize: '12px' } }, `${columns.length} count columns, ${design.samples.length} samples`)),
      h('p.muted', { style: { fontSize: '12px', margin: '0 0 8px' } }, 'Each column of counts is a sample, a technical replicate of one (its counts are summed), a copy of another column (a sample shared by replicates, written once per replicate), or not used. "Missing = 0" reads a sample\'s missing counts as 0, for tables that write variants that dropped out during selection as missing.'),
      h('div', { style: { maxHeight: '420px', overflow: 'auto' } }, h('table.data.design-columns', h('thead', h('tr', h('th', 'Column'), h('th', 'Is'), h('th', 'Sample name or note'), h('th', 'Batch'), design.model === 'bins' ? h('th', { title: 'Cells sorted into the bin, when known: the maximum-likelihood fit reweights reads by them, and QC reads the cells per variant' }, 'Cells') : null, h('th.c', { title: 'Read this sample\'s missing counts as 0 (variants that dropped out, written as missing)' }, 'Missing = 0'))), h('tbody', ...rows))));
  }

  // Sorted bins: each bin's value and gates (the same in every replicate; a design file can give
  // each replicate its own), for the maximum-likelihood fit.
  function gatesPane(design) {
    const orders = [...new Set(design.replicates.flatMap((r) => (r.bins ?? []).map((b) => b.order)))].sort((a, b) => a - b);
    if (!orders.length) return null;
    const of = (order, key) => {
      const values = new Set(design.replicates.map((r) => (r.bins ?? []).find((b) => b.order === order)?.[key]).filter((x) => x !== undefined));
      return values.size > 1 ? 'varies' : [...values][0] ?? '';
    };
    const gate = (order, key, label) => {
      const value = of(order, key);
      const input = h('input.input', { value, inputmode: 'decimal', placeholder: 'open', style: { width: '96px' }, disabled: value === 'varies', 'aria-label': `${label} gate of bin ${order}`, onchange: () => edit((d) => setBinGates(d, order, { [key]: input.value.trim() === '' ? null : Number(input.value) }), `Set bin ${order}'s ${label.toLowerCase()} gate to ${input.value.trim() || 'open'}`) });
      return h('td', input);
    };
    return h('div.pane', h('h3', icon('filter'), 'Bins and gates'),
      h('p.muted', { style: { fontSize: '12px', margin: '0 0 8px' } }, 'Each bin\'s value (its weight in the weighted average) and the gates it was sorted between, on the reporter\'s fluorescence; leave the lowest bin\'s lower gate and the highest bin\'s upper gate open. With the gates, sorted bins can also be scored by maximum likelihood; with the cells sorted into each bin (in the columns below), its reads are reweighted by them.'),
      h('table.data', h('thead', h('tr', h('th', 'Bin'), h('th.r', 'Value'), h('th', 'Lower gate'), h('th', 'Upper gate'))),
        h('tbody', ...orders.map((order) => h('tr', h('td', `Bin ${order}`), h('td.r', String(of(order, 'value'))), gate(order, 'lower', 'Lower'), gate(order, 'upper', 'Upper'))))));
  }

  function replicatesPane(design) {
    if (pendingFor !== design.model) {
      pendingSlots = [];
      pendingFor = design.model;
    }
    const slots = slotsOf(design, pendingSlots);
    const sampleOptions = (current) => [h('option', { value: '', selected: !current }, '—'), ...design.samples.map((x) => h('option', { value: x.id, selected: x.id === current }, x.name ?? x.id))];
    const conditions = design.conditions ?? [];
    const tiles = design.library?.tiles ?? [];
    const headSlot = (slot) => {
      if (slot.time !== undefined) {
        const input = h('input.input.slot-head', { value: slot.time, inputmode: 'decimal', 'aria-label': `Time of column ${slot.label}`, onchange: () => {
          const to = Number(input.value);
          const used = design.replicates.some((r) => (r.timepoints ?? []).some((t) => t.time === slot.time));
          if (!used) {
            pendingSlots = pendingSlots.map((p) => (p.time === slot.time ? { time: to } : p));
            render();
          } else edit((d) => setTime(d, slot.time, to), `Changed time ${slot.time} to ${to}`);
        } });
        return h('th', h('span.sr-only', 'Time '), input);
      }
      if (slot.order !== undefined) {
        const input = h('input.input.slot-head', { value: slot.value, inputmode: 'decimal', 'aria-label': `Value of bin ${slot.order}`, title: `Bin ${slot.order}: its value`, onchange: () => {
          const v = Number(input.value);
          if (design.replicates.some((r) => (r.bins ?? []).some((b) => b.order === slot.order))) edit((d) => setBinValue(d, slot.order, v), `Set bin ${slot.order}'s value to ${v}`);
          else {
            pendingSlots = pendingSlots.map((p) => (p.order === slot.order ? { order: p.order, value: v } : p));
            render();
          }
        } });
        return h('th', `Bin ${slot.order}`, input);
      }
      return h('th', slot.label);
    };
    const rows = design.replicates.map((r) => h('tr',
      h('td', h('input.input', { value: r.name ?? r.id, 'aria-label': `Name of replicate ${r.id}`, onchange: (e) => edit((d) => updateReplicate(d, r.id, { name: e.target.value.trim() }), `Renamed replicate ${r.id}`) })),
      h('td', h('input.input', { value: r.biological, inputmode: 'numeric', style: { width: '54px' }, 'aria-label': `Biological replicate number of ${r.id}`, onchange: (e) => {
        const n = Number(e.target.value);
        if (Number.isInteger(n) && n > 0) edit((d) => updateReplicate(d, r.id, { biological: n }), `Made ${r.id} biological replicate ${n}`);
      } })),
      conditions.length ? h('td', h('select.input', { 'aria-label': `Condition of ${r.id}`, onchange: (e) => edit((d) => updateReplicate(d, r.id, { condition: e.target.value }), `Put ${r.id} in condition ${e.target.value}`) }, ...conditions.map((c) => h('option', { value: c.id, selected: c.id === r.condition }, c.name)))) : null,
      tiles.length ? h('td', h('select.input', { 'aria-label': `Tile of ${r.id}`, onchange: (e) => edit((d) => updateReplicate(d, r.id, { tile: e.target.value }), `Put ${r.id} in ${e.target.value}`) }, ...tiles.map((t) => h('option', { value: t.id, selected: t.id === r.tile }, t.name ?? t.id)))) : null,
      ...slots.map((slot) => h('td', h('select.input', { 'aria-label': `${r.name ?? r.id}, ${slot.label}`, onchange: (e) => {
        pendingSlots = pendingSlots.filter((p) => !(p.time === slot.time && slot.time !== undefined) && !(p.order === slot.order && slot.order !== undefined));
        edit((d) => setSlot(d, r.id, slot, e.target.value), `${r.name ?? r.id}, ${slot.label}: ${e.target.value || 'none'}`);
      } }, ...sampleOptions(slotSample(r, slot))))),
      h('td.r', h('button.icon-button.small', { type: 'button', title: `Remove ${r.name ?? r.id}`, 'aria-label': `Remove ${r.name ?? r.id}`, onclick: () => edit((d) => removeReplicate(d, r.id), `Removed replicate ${r.name ?? r.id}`) }, icon('trash')))));
    const addSlot = design.model === 'time-series'
      ? h('button.btn.small', { type: 'button', onclick: () => {
        const times = slots.map((x) => x.time);
        pendingSlots = [...pendingSlots, { time: times.length ? Math.max(...times) + 1 : 0 }];
        render();
      } }, icon('plus'), 'Add a time')
      : design.model === 'bins'
        ? h('button.btn.small', { type: 'button', onclick: () => {
          const orders = slots.map((x) => x.order);
          const order = orders.length ? Math.max(...orders) + 1 : 1;
          pendingSlots = [...pendingSlots, { order, value: order }];
          render();
        } }, icon('plus'), 'Add a bin')
        : null;
    return h('div.pane', h('h3', icon('experiment'), 'Replicates', h('span.spacer'), addSlot,
      h('button.btn.small', { type: 'button', onclick: () => edit((d) => addReplicate(d).design, 'Added a replicate') }, icon('plus'), 'Add a replicate')),
      h('p.muted', { style: { fontSize: '12px', margin: '0 0 8px' } }, design.model === 'two-population' ? 'Each biological replicate: the sample before selection and the sample after.' : design.model === 'time-series' ? 'Each biological replicate: its sample at each time (time 0 is the input). Times are edited in the column heads.' : 'Each biological replicate: its sample in each bin. Bin values (weights, or fluorescence) are edited in the column heads.'),
      h('div', { style: { overflow: 'auto' } }, h('table.data.design-matrix',
        h('thead', h('tr', h('th', 'Replicate'), h('th', 'Biological'), conditions.length ? h('th', 'Condition') : null, tiles.length ? h('th', 'Tile') : null, ...slots.map(headSlot), h('th', h('span.sr-only', 'Remove')))),
        h('tbody', ...rows))),
      !design.replicates.length ? h('p.muted', 'No replicate yet.') : null);
  }

  // --- The view -------------------------------------------------------------------------------

  function render() {
    clear(root);
    const s = source();
    const design = store.ws.design;
    const actions = [];
    if (s) {
      actions.push(h('button.btn', { type: 'button', onclick: () => sampleSheet(), title: 'A CSV with one row per sample: column, role, replicate, condition, time or bin…' }, icon('upload'), 'Sample sheet…'));
      if (design) actions.push(h('button.btn', { type: 'button', onclick: exportDesign }, icon('download'), 'Export the design'));
      actions.push(h('button.btn', { type: 'button', onclick: () => app.pickFiles('.json') }, icon('upload'), 'Open a design…'));
    }
    root.append(h('div.workbench-head', h('h1', icon('experiment'), 'Experiment', design ? h('span.crumbs', ` · ${design.name ?? ''}`) : null), h('span.spacer'), ...actions));
    if (!s) {
      root.append(h('div.view-body', h('div.planned', h('div.empty', icon('experiment'), h('h3', 'Experiment'),
        h('p', 'Say what each column of the counts is: the sample, its role (input, output, time point or bin), condition, biological and technical replicate, and the control variants. Open a count table first.'),
        h('div.btn-row', { style: { marginTop: '12px' } }, h('button.btn.primary', { type: 'button', onclick: () => app.pickFiles() }, icon('table'), 'Open files'))))));
      return;
    }
    if (!design) {
      const suggested = s.roleSuggestions?.length ?? 0;
      root.append(h('div.view-body', h('div.split', h('div', sourcePane(s), targetPane(s)), h('div', h('div.pane', h('h3', icon('experiment'), 'Design'),
        h('p', suggested ? `MaveScape suggested roles for ${suggested} of ${countColumns(s).length} columns from their names. Start from that draft, then check and correct it here; or fill the design from a sample sheet.` : 'Start a design from the columns, or fill it from a sample sheet.'),
        h('div.btn-row', h('button.btn.primary', { type: 'button', onclick: () => draftFromColumns(app, s) }, icon('sparkles'), suggested ? 'Start from the suggested design' : 'Start a design'),
          h('button.btn', { type: 'button', onclick: () => sampleSheet() }, icon('upload'), 'Sample sheet…')))))));
      return;
    }
    root.append(h('div.view-body', h('div.split.experiment-split',
      h('div', sourcePane(s), summaryPane(design, s), settingsPane(design, s), readoutPane(design), targetPane(s)),
      h('div', replicatesPane(design), design.model === 'bins' ? gatesPane(design) : null, columnsPane(design, s),
        h('div.btn-row', { style: { marginTop: '12px' } }, h('button.btn', { type: 'button', onclick: async () => { if (await confirmDialog({ title: 'Draft the design again?', message: 'The design is replaced by the draft from the column names. Undo (⌘Z) brings this one back.', confirm: 'Draft again' })) draftFromColumns(app, s); } }, icon('sparkles'), 'Draft again from the column names'))))));
  }

  render();
  return {
    update(topics) {
      if (topics.has('ws') || topics.has('workspace-loaded')) render();
    },
    destroy() {
      root.remove();
    },
  };
}
