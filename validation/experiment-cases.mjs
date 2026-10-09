// The Experiment view's model, checked on the feasibility designs (validation suite `experiment`):
// each hand-written design rebuilt with the editor's operations alone (web/lib/design-edit.js),
// and designs read from sample sheets, compared by what they say rather than by their ids.

import {
  addCondition, addReplicate, addTile, assignColumn, emptyDesign, setControls, setField, setModel, setSlot, slotsOf, updateCondition, updateReplicate, updateTile,
} from '../web/lib/design-edit.js';

// What a design says, independent of ids: for each replicate (by condition name, tile range and
// biological number) the columns of the sample in each slot; the columns of each sample; the
// columns set aside (copies with what they copy).
export function meaning(design) {
  const samples = new Map(design.samples.map((s) => [s.id, s.columns.join('+')]));
  const conditions = new Map((design.conditions ?? []).map((c) => [c.id, c.name]));
  const tiles = new Map((design.library?.tiles ?? []).map((t, i) => [t.id, `tile${i + 1}`]));
  const slots = [];
  for (const r of design.replicates) {
    const who = `${conditions.get(r.condition) ?? ''}|${tiles.get(r.tile) ?? ''}|${r.biological}`;
    if (r.input) slots.push(`${who}|input=${samples.get(r.input)}`);
    if (r.output) slots.push(`${who}|output=${samples.get(r.output)}`);
    for (const t of r.timepoints ?? []) slots.push(`${who}|t${t.time}=${samples.get(t.sample)}`);
    for (const b of r.bins ?? []) slots.push(`${who}|b${b.order}:${b.value}=${samples.get(b.sample)}`);
  }
  return {
    model: design.model,
    slots: slots.sort(),
    samples: [...samples.values()].sort(),
    copies: (design.ignoredColumns ?? []).filter((x) => x.copyOf).map((x) => `${x.column}=${x.copyOf}`).sort(),
  };
}

// The design rebuilt by the editor's operations, as a person would click it together.
export function rebuild(design) {
  let d = emptyDesign({ name: design.name, model: design.model, variants: design.variants, targets: design.targets });
  if (design.time) d = setField(d, { time: design.time });
  if (design.bins) d = setField(d, { bins: design.bins });
  // Columns: each sample's first column a sample of its own, the others technical replicates.
  const sampleIds = new Map();
  for (const s of design.samples) {
    const made = assignColumn(d, s.columns[0], { kind: 'new-sample', name: s.name });
    d = made.design;
    sampleIds.set(s.id, made.sample);
    for (const c of s.columns.slice(1)) d = assignColumn(d, c, { kind: 'sample', sample: made.sample }).design;
  }
  for (const x of design.ignoredColumns ?? []) d = assignColumn(d, x.column, x.copyOf ? { kind: 'copy', copyOf: x.copyOf } : { kind: 'ignored', reason: x.reason }).design;
  // Conditions and tiles.
  const conditionIds = new Map();
  for (const c of design.conditions ?? []) {
    const made = addCondition(d, c.name);
    d = made.design;
    conditionIds.set(c.id, made.condition);
    if (c.reference) d = updateCondition(d, made.condition, { reference: true });
  }
  const tileIds = new Map();
  for (const t of design.library?.tiles ?? []) {
    const made = addTile(d, t.start, t.end);
    d = made.design;
    tileIds.set(t.id, made.tile);
    if (t.name) d = updateTile(d, made.tile, { name: t.name });
  }
  // Replicates and their slots.
  for (const r of design.replicates) {
    const made = addReplicate(d);
    d = updateReplicate(made.design, made.replicate, { name: r.name, biological: r.biological, condition: conditionIds.get(r.condition), tile: tileIds.get(r.tile) });
    const slots = [
      ...(r.input ? [[{ key: 'input' }, r.input]] : []),
      ...(r.output ? [[{ key: 'output' }, r.output]] : []),
      ...(r.timepoints ?? []).map((t) => [{ key: `t:${t.time}`, time: t.time }, t.sample]),
      ...(r.bins ?? []).map((b) => [{ key: `b:${b.order}`, order: b.order, value: b.value }, b.sample]),
    ];
    for (const [slot, sample] of slots) d = setSlot(d, made.replicate, slot, sampleIds.get(sample));
  }
  if (design.controls) d = setControls(d, design.controls);
  return d;
}

// Two populations to a time series and back: nothing lost.
export function modelRoundTrip(design) {
  return setModel(setModel(design, 'time-series'), 'two-population');
}

export { slotsOf };
