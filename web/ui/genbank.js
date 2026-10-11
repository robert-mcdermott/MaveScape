// Targets from GenBank files in the window (wave 3, slice 3; requirement D13): a plasmid or
// construct map (SnapGene, Benchling, ApE and Geneious export GenBank) or a RefSeq record. The
// coding feature (CDS) the target is numbered by is chosen when the record has several, and its
// translation checked against the record's (lib/genbank.js). The target keeps where it came from
// (the file, the feature) in the workspace.

import { h, formatCount } from './dom.js';
import { showDialog, toast } from './overlays.js';
import { codingFeatures, parseGenBank, preferredFeature, targetFromGenBank } from '../lib/genbank.js';
import { addTarget } from '../lib/workspace.js';

// Asks which coding feature to use, when there are several: resolves to one, or null.
export function chooseCodingFeature(record, coding, fileName) {
  const preferred = preferredFeature(coding);
  return new Promise((resolve) => {
    let chosen = preferred;
    const rows = coding.map((c) => {
      const input = h('input', { type: 'radio', name: 'cds', checked: c === preferred, disabled: Boolean(c.problem), onchange: () => { chosen = c; } });
      return h('label.cds-choice', input,
        h('span', h('b', c.label), h('span.muted.small', ` ${c.location}${c.length ? ` · ${formatCount(c.length)} nt, ${formatCount(Math.floor(c.length / 3))} codons` : ''}`),
          h('div.small', { class: c.problem || c.check?.status === 'differs' ? 'warn-text' : 'muted' }, c.problem ?? c.check.message)));
    });
    showDialog({
      title: 'Choose the coding sequence',
      content: [
        h('p.small', `${fileName} (${record.definition || record.name}) has ${coding.length} coding features. The target is numbered by the one the variants are named on.`),
        h('div.cds-list', ...rows),
      ],
      buttons: [{ label: 'Cancel', value: null }, { label: 'Use it', primary: true, onClick: () => chosen }],
      onClose: (result) => resolve(result ?? null),
    });
  });
}

// A GenBank file's targets: one per record, from the coding feature chosen. Returns
// [{ target, origin, messages }] (an empty list when nothing was read; each problem shown).
export async function targetsFromGenBank(text, fileName) {
  const { records, problems } = parseGenBank(text);
  for (const p of problems) toast(`${fileName}: ${p}`, { kind: 'error' });
  const out = [];
  for (const record of records) {
    const coding = codingFeatures(record);
    if (!coding.length) {
      toast(`${fileName}: ${record.name} has no coding feature (CDS) to number a target by. Mark the coding sequence as a CDS in your map, or give it as FASTA.`, { kind: 'error' });
      continue;
    }
    const chosen = coding.length === 1 ? coding[0] : await chooseCodingFeature(record, coding, fileName);
    if (!chosen) continue;
    if (chosen.problem) {
      toast(`${fileName}: ${chosen.label}: ${chosen.problem}`, { kind: 'error' });
      continue;
    }
    out.push(targetFromGenBank(record, chosen, { file: fileName }));
  }
  return out;
}

// The importer of GenBank files: each record's target added to the workspace.
export async function importGenBank(app, items) {
  let ws = app.store.ws;
  const added = [];
  for (const item of items) {
    const text = new TextDecoder().decode(await app.readBytes(item));
    for (const { target, origin, messages } of await targetsFromGenBank(text, item.name)) {
      const result = addTarget(ws, { ...target, origin });
      ws = result.ws;
      if (!result.existing) added.push(target.name);
      const said = [origin.whole ? `the whole record, coding from base ${target.codingStart}` : `its coding sequence (${origin.feature})`, origin.check.message];
      app.log(`${item.name}, ${target.name}: ${said.join('; ')}`);
      for (const m of messages) toast(`${target.name}: ${m.message}`, { kind: m.level === 'error' ? 'error' : undefined });
    }
  }
  if (added.length) {
    app.store.commit(ws, `Add target${added.length > 1 ? 's' : ''} ${added.join(', ')} from GenBank`);
    toast(`Added ${added.length === 1 ? `the target ${added[0]}` : `${added.length} targets`} from GenBank.`, { kind: 'ok' });
  }
}
