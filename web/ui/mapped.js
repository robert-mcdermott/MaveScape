// MaveDB's mapped variants in the window (wave 3, slice 3; requirement D10): the table kept beside a
// score set's tables when it was opened with them (source.origin.mapped, lib/mavedb.js mappedCSV),
// read once from the library, and a variant's mapping found by its accession (its MaveDB variant
// URN, in the table's accession column): its GA4GH VRS identifier, the HGVS on the human reference
// MaveDB maps it to, and its ClinGen allele.

import { h } from './dom.js';
import { readMapped } from '../lib/mavedb.js';
import { cellText } from '../lib/csv.js';

const loaded = new Map();

async function mappedTable(app, mapped) {
  if (!loaded.has(mapped.sha256)) {
    loaded.set(mapped.sha256, (async () => {
      const bytes = await app.library.getFile(mapped.sha256);
      if (!bytes) throw new Error(`${mapped.fileName} is not in the library.`);
      const table = await app.parseTableFile({ name: mapped.fileName, file: new Blob([bytes]) });
      return readMapped(table);
    })());
  }
  return loaded.get(mapped.sha256);
}

// A run's variant's mapping (row of its own results): { accession, vrs, hgvs, clingen, level },
// null when it has none, or undefined when its table was not opened with MaveDB's mapping.
export async function mappedFor(app, run, row) {
  const source = app.store.ws.sources.find((s) => s.sha256 === run.inputs.source.sha256);
  const mapped = source?.origin?.mapped;
  if (!mapped) return undefined;
  const [map, table] = await Promise.all([mappedTable(app, mapped), app.sourceTable(source)]);
  const column = table.columns.find((c) => c.name === 'accession');
  const accession = column ? cellText(column, row) : null;
  const m = accession ? map.get(accession) : null;
  return m ? { accession, ...m } : null;
}

// The inspector's block for a run's variant (row of its own results), or null when its table was
// not opened with MaveDB's mapping. Filled in when the mapping has been read.
export function mappedBlock(app, run, row) {
  const source = app.store.ws.sources.find((s) => s.sha256 === run.inputs.source.sha256);
  const mapped = source?.origin?.mapped;
  if (!mapped) return null;
  const box = h('div.mapped-box', h('p.muted', { style: { fontSize: '12px', margin: 0 } }, 'Reading MaveDB\'s mapping…'));
  (async () => {
    try {
      const [map, table] = await Promise.all([mappedTable(app, mapped), app.sourceTable(source)]);
      const column = table.columns.find((c) => c.name === 'accession');
      const accession = column ? cellText(column, row) : null;
      const m = accession ? map.get(accession) : null;
      if (!m) {
        box.replaceChildren(h('p.muted', { style: { fontSize: '12px', margin: 0 } }, `MaveDB has not mapped ${accession ?? 'this variant'} to the human reference.`));
        return;
      }
      box.replaceChildren(h('dl.kv',
        h('dt', 'Reference'), h('dd.mono', { title: m.hgvs ?? '' }, m.hgvs ?? '—'),
        h('dt', 'VRS'), h('dd.mono', { title: m.vrs ?? '' }, m.vrs ?? '—'),
        h('dt', 'ClinGen'), h('dd.mono', m.clingen ?? '—'),
        h('dt', 'Aligned'), h('dd', m.level ?? '—')),
      h('p.muted', { style: { fontSize: '11px', margin: '2px 0 0' } }, `${accession}, as MaveDB mapped it (retrieved ${String(mapped.retrieved ?? '').slice(0, 10) || 'with the record'}).`));
    } catch (error) {
      box.replaceChildren(h('p.muted', { style: { fontSize: '12px', margin: 0 } }, error.message));
    }
  })();
  return [h('h4.inspector-sub', 'Mapped by MaveDB'), box];
}
