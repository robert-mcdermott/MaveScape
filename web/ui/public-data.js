// Public data in the page (wave 3, slice 1). The page asks the MaveScape program's fetcher
// (fetch.go) and nothing else: its Content-Security-Policy allows no other origin, and the program
// asks only the listed services (docs/NETWORK.md), caches what they send with its retrieval
// record, and serves cached copies only when started with --offline. Served as a plain web site,
// without the program, the page has no public data. A request that sends a sequence is made only
// after the person has seen exactly what it sends (the program refuses it until then).
//
// Here: the target checked against its UniProt entry (where it sits, the offset, the differences;
// recorded with the workspace), a target found in UniProt by its exact sequence, and the Network
// dialog (the status bar's "Public data").

import { h, icon } from './dom.js';
import { showDialog, toast } from './overlays.js';
import { normalizeAccession, placeTarget, placementPatch, readUniProtEntry, referenceOf, retrievalOf, retrievalText, speciesOf, uniparcEntries } from '../lib/uniprot.js';
import { recordTargetCheck } from '../lib/workspace.js';
import { targetProtein } from '../lib/target.js';

// on, offline (cached copies only), off (--no-fetch), or web (no MaveScape program).
export function publicDataState(app) {
  return app.info ? (app.info.fetch ?? 'off') : 'web';
}

const UNAVAILABLE = {
  web: 'Public data need the MaveScape program: this page, served on its own, cannot fetch them.',
  off: 'Public data are switched off (MaveScape was started with --no-fetch).',
};

// A request to the fetcher: { ok, json, retrieval } (or bytes for as: 'bytes', a table) or
// { ok: false, status, message, confirm }. confirm, on a refusal, is what the request would send,
// for the person to see (HTTP 428).
export async function fetchPublic(app, path, { confirmed = false, refresh = false, as = 'json' } = {}) {
  const state = publicDataState(app);
  if (UNAVAILABLE[state]) return { ok: false, status: 0, message: UNAVAILABLE[state] };
  const url = `api/fetch/${path}${refresh ? `${path.includes('?') ? '&' : '?'}refresh=1` : ''}`;
  let response;
  try {
    response = await fetch(url, { cache: 'no-store', headers: confirmed ? { 'X-MaveScape-Confirm': 'send-sequence' } : {} });
  } catch {
    return { ok: false, status: 0, message: 'The MaveScape program did not answer: is it still running?' };
  }
  const retrieval = retrievalOf((name) => response.headers.get(name));
  if (response.ok && as === 'bytes') return { ok: true, bytes: new Uint8Array(await response.arrayBuffer()), retrieval };
  if (response.ok && as === 'text') return { ok: true, text: await response.text(), retrieval };
  const json = await response.json().catch(() => null);
  if (!response.ok) return { ok: false, status: response.status, message: json?.error ?? `HTTP ${response.status}`, confirm: json?.confirm ?? null };
  return { ok: true, json, retrieval };
}

// The target checked against a UniProt entry (its own accession unless another is given): the
// entry, where the target sits, the design's fields that would change, and the record to keep.
export async function checkTarget(app, target, accession = null) {
  const wanted = accession ?? target.identifiers?.uniprot;
  const normalized = normalizeAccession(wanted);
  if (!normalized) return { ok: false, message: wanted ? `"${wanted}" is not a UniProt accession (such as P62993).` : `The target ${target.name} has no UniProt accession: give it in Experiment, Target, or find it by its sequence.` };
  const got = await fetchPublic(app, `uniprot/${normalized}`);
  if (!got.ok) return got;
  const entry = readUniProtEntry(got.json);
  if (entry.problem) return { ok: false, message: entry.problem, entry, retrieval: got.retrieval };
  const placement = placeTarget(target, entry);
  if (placement.problem) return { ok: false, message: placement.problem, entry, retrieval: got.retrieval };
  const patch = placementPatch(target, entry, placement);
  if (placement.places > 1) {
    // Where it sits is not the entry's to say: the offset and differences stay as they are.
    delete patch.offset;
    delete patch.differences;
  }
  return { ok: true, entry, placement, retrieval: got.retrieval, patch, reference: referenceOf(entry, got.retrieval, placement) };
}

const positions = (p) => `${p.start}–${p.end}`;

// The check in words: where the target sits, how it differs, what is in doubt.
export function placementText(target, check) {
  const { entry, placement: p } = check;
  const n = target.sequenceType === 'dna' ? `${p.length} residues the target encodes` : `target's ${p.length} residues`;
  if (p.places > 1) return `The ${n} agree as well at ${p.places} places in ${entry.accession} (from positions ${p.alternatives.join(', ')}${p.places > p.alternatives.length ? ', …' : ''}): where it sits is not the entry's to say, so the offset is left as it is.`;
  const parts = [`The ${n} are positions ${positions(p)} of ${entry.accession}${p.identical ? ', identical' : ''}.`];
  if (p.differences.length) parts.push(`${p.differences.length} difference${p.differences.length > 1 ? 's' : ''}: ${p.differences.slice(0, 6).map((d) => `${d.reference}${d.position + p.offset}${d.target} (target position ${d.position})`).join(', ')}${p.differences.length > 6 ? ', …' : ''}.`);
  if (p.outside.length) parts.push(`Residues ${p.outside[0]}–${p.outside.at(-1)} of the target are not in ${entry.accession} (a tag or a linker?).`);
  return parts.join(' ');
}

const SOURCES = { hit: 'from MaveScape\'s cache', miss: 'just now', revalidated: 'confirmed unchanged just now', stale: 'an older copy from the cache: UniProt could not be reached, or MaveScape is offline' };

function retrievalLine(retrieval) {
  const host = retrieval?.source ? new URL(retrieval.source).host : 'UniProt';
  const when = retrievalText(retrieval);
  return `From ${host}${when ? `, ${when}` : ''} (${SOURCES[retrieval?.cache] ?? 'from MaveScape'}).`;
}

// The history's words for a check.
function checkDetail(target, check) {
  const changed = Object.keys(check.patch);
  const what = { offset: `the offset ${check.patch.offset}`, identifiers: 'its identifiers', organism: `the organism ${check.patch.organism}`, differences: 'its known differences' };
  return `Checked the target ${target.name} against UniProt ${check.entry.accession}${check.reference.release ? ` (release ${check.reference.release})` : ''}: ${check.placement.places > 1 ? 'placed ambiguously' : `positions ${positions(check.placement)}${check.placement.identical ? ', identical' : `, ${check.placement.differences.length} differences`}`}${changed.length ? `; set ${changed.map((k) => what[k]).join(', ')}` : ''}`;
}

export function applyCheck(app, target, check) {
  const ws = recordTargetCheck(app.store.ws, target.id, check.patch, check.reference, checkDetail(target, check));
  app.store.commit(ws, checkDetail(target, check));
}

// The check, shown before anything changes: the entry, where the target sits, each field the entry
// would change, and the choice to use them.
export async function openTargetCheck(app, targetId, accession = null) {
  const target = app.store.ws.targets.find((t) => t.id === targetId);
  if (!target) return;
  const busy = toast(`Asking UniProt for ${accession ?? target.identifiers?.uniprot ?? 'the entry'}…`, { timeout: 0 });
  const check = await checkTarget(app, target, accession);
  busy.remove();
  if (!check.ok) {
    showDialog({ title: 'UniProt', content: [h('div.callout.danger', icon('warning'), h('span', check.message)), check.retrieval ? h('p.muted.small', retrievalLine(check.retrieval)) : null] });
    return;
  }
  const { entry, patch } = check;
  const ids = target.identifiers ?? {};
  const row = (label, now, then) => h('tr', h('td', label), h('td', now ?? h('span.muted', 'none')), h('td', then === undefined ? h('span.muted', 'same') : then ?? h('span.muted', 'none')));
  const rows = [
    row('Offset', String(target.offset ?? 0), 'offset' in patch ? `${patch.offset} (position 1 is ${entry.accession} ${patch.offset + 1})` : undefined),
    row('UniProt', ids.uniprot, patch.identifiers && patch.identifiers.uniprot !== ids.uniprot ? patch.identifiers.uniprot : undefined),
    row('Gene', ids.gene, patch.identifiers && patch.identifiers.gene !== ids.gene ? patch.identifiers.gene : undefined),
    row('Organism', target.organism, 'organism' in patch ? patch.organism : undefined),
    row('Known differences', String(target.differences?.length ?? 0), 'differences' in patch ? String(patch.differences?.length ?? 0) : undefined),
  ];
  const changes = Object.keys(patch).length;
  const p = check.placement;
  showDialog({
    title: `UniProt ${entry.accession}`,
    content: [
      h('div.entry-card',
        h('div', h('b', entry.name ?? entry.accession), entry.reviewed ? h('span.badge', 'reviewed (Swiss-Prot)') : h('span.badge.muted', 'unreviewed (TrEMBL)')),
        h('div.muted', [entry.entryName, entry.gene ? `gene ${entry.gene}` : null, speciesOf(entry.organism), `${entry.length} residues`].filter(Boolean).join(' · '))),
      h('p.muted.small', retrievalLine(check.retrieval)),
      h(`div.callout.${p.places > 1 || p.outside.length || p.differences.length ? 'warn' : 'ok'}`, icon(p.places > 1 ? 'warning' : 'check'), h('span', placementText(target, check))),
      h('div.table-scroll', { style: { marginTop: '10px' } }, h('table.data.compact', h('thead', h('tr', h('th', ''), h('th', 'The target now'), h('th', `From ${entry.accession}`))), h('tbody', ...rows))),
      h('p.muted.small', changes
        ? 'Using these changes the design: its runs are kept, and the next score uses the new values. The check is recorded with the workspace (its history, the methods).'
        : 'Nothing to change: the check is recorded with the workspace (its history, the methods), and the design stays as it is.'),
    ],
    buttons: [
      { label: 'Cancel', ghost: true },
      { label: changes ? 'Use these' : 'Record the check', primary: true, onClick: () => applyCheck(app, target, check) },
    ],
  });
}

// A target with no accession found in UniProt by its exact sequence (UniParc). The request sends
// the sequence: the program says exactly what it would send, and the person decides.
export async function openSequenceLookup(app, targetId) {
  const target = app.store.ws.targets.find((t) => t.id === targetId);
  if (!target) return;
  const protein = targetProtein(target).replace(/\*$/, '');
  if (!/^[ACDEFGHIKLMNPQRSTVWY]+$/.test(protein)) {
    toast('The target\'s protein holds stops or unknown residues: UniProt looks up whole protein sequences only.', { kind: 'error' });
    return;
  }
  const path = `uniparc?sequence=${protein}`;
  const first = await fetchPublic(app, path);
  if (first.ok) {
    showMatches(app, target, first);
    return;
  }
  if (first.status !== 428 || !first.confirm) {
    showDialog({ title: 'Find in UniProt', content: h(`div.callout.${first.status === 404 ? 'warn' : 'danger'}`, icon('warning'), h('span', first.message)) });
    return;
  }
  const sent = first.confirm;
  showDialog({
    title: 'Send the sequence to UniProt?',
    width: 'wide',
    content: [
      h('p', `To find its entry, MaveScape would send the target's protein sequence (${protein.length} residues) to ${sent.service} (${sent.host}), in this request:`),
      h('div.sent-preview.mono', { tabindex: '0', 'aria-label': 'The request MaveScape would send' }, sent.url),
      h('p.muted.small', 'Nothing else is sent: not the target\'s name, not your counts or design. UniProt finds only entries with exactly this sequence; a domain or a construct with changes is found by its protein\'s accession instead. The answer is cached, so the same lookup is not sent twice.'),
    ],
    buttons: [
      { label: 'Cancel', ghost: true },
      { label: 'Send it', primary: true, onClick: async () => {
        const got = await fetchPublic(app, path, { confirmed: true });
        if (got.ok) showMatches(app, target, got);
        else showDialog({ title: 'Find in UniProt', content: h(`div.callout.${got.status === 404 ? 'warn' : 'danger'}`, icon('warning'), h('span', got.message)) });
      } },
    ],
  });
}

function showMatches(app, target, got) {
  const { entries } = uniparcEntries(got.json);
  const shown = entries.slice(0, 20);
  const dialog = showDialog({
    title: 'UniProt entries with this sequence',
    width: 'wide',
    content: [
      h('p.muted.small', `${entries.length} active entr${entries.length === 1 ? 'y has' : 'ies have'} exactly the target's sequence${entries.length > shown.length ? ` (the first ${shown.length} shown, reviewed first)` : ''}. ${retrievalLine(got.retrieval)}`),
      entries.length ? h('div.table-scroll', h('table.data.compact.matches', h('thead', h('tr', h('th', 'Entry'), h('th', 'Protein'), h('th', 'Organism'), h('th', ''))),
        h('tbody', ...shown.map((e) => h('tr',
          h('td', h('span.mono', e.accession), e.reviewed ? h('span.badge', { title: 'Reviewed (Swiss-Prot)' }, 'reviewed') : null),
          h('td', e.name ?? '', e.gene ? h('span.muted', ` · ${e.gene}`) : null), h('td', e.organism ?? ''),
          h('td.r', h('button.btn.small', { type: 'button', title: `Check the target against ${e.accession}`, onclick: () => {
            dialog.close();
            openTargetCheck(app, target.id, e.accession);
          } }, 'Check'))))))) : h('div.callout.warn', icon('warning'), h('span', 'No UniProt entry has exactly this sequence.')),
    ],
  });
}

// What the target pane shows of public data: the buttons, and the last check.
export function targetPublicData(app, target) {
  const state = publicDataState(app);
  const ids = target.identifiers ?? {};
  const ref = target.reference;
  const recorded = ref ? h('p.muted.small.reference-line', `Checked against UniProt ${ref.accession} (${retrievalText(ref)}): positions ${ref.start}–${ref.end}${ref.identical ? ', identical' : `, ${ref.differences} difference${ref.differences === 1 ? '' : 's'}`}.`) : null;
  const moved = ref && (ref.accession !== ids.uniprot || ref.offset !== (target.offset ?? 0)) ? h('div.callout.warn', icon('warning'), h('span', `The target's ${ref.accession !== ids.uniprot ? 'accession' : 'offset'} has changed since it was checked: check it again.`)) : null;
  if (UNAVAILABLE[state]) return h('div.reference-row', recorded, h('p.muted.small', UNAVAILABLE[state]));
  return h('div.reference-row',
    h('div.btn-row',
      h('button.btn.small', { type: 'button', disabled: !normalizeAccession(ids.uniprot), title: normalizeAccession(ids.uniprot) ? `Fetch ${ids.uniprot} from UniProt and find where the target sits in it` : 'Give the UniProt accession first', onclick: () => openTargetCheck(app, target.id) }, icon('globe'), 'Check against UniProt'),
      ids.uniprot ? null : h('button.btn.small.ghost', { type: 'button', onclick: () => openSequenceLookup(app, target.id), title: 'Find the UniProt entries with exactly the target\'s protein sequence (asks before sending it)' }, icon('search'), 'Find in UniProt by sequence…'),
      state === 'offline' ? h('span.muted.small', 'Offline: copies already in the cache only') : null),
    recorded, moved);
}

// The Network dialog: what MaveScape may contact, and what it has fetched (the cache).
export async function showNetwork(app) {
  const state = publicDataState(app);
  const status = UNAVAILABLE[state] ? null : await fetch('api/fetch', { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
  const cache = state === 'on' || state === 'offline' ? await fetch('api/fetch/cache', { cache: 'no-store' }).then((r) => r.json()).catch(() => null) : null;
  const intro = {
    on: 'MaveScape fetches public data from the services below, and nothing else. Requests carry public identifiers (accessions, URNs); one that would send a sequence is made only after you confirm it. Your files never leave this computer.',
    offline: 'MaveScape was started with --offline: it makes no network request, and serves public data only from copies already in its cache.',
    ...UNAVAILABLE,
  }[state];
  const entries = cache?.entries ?? [];
  showDialog({
    title: 'Public data',
    width: 'wide',
    content: [
      h('p', intro),
      status?.cache ? h('p.muted.small', 'The cache: ', h('span.mono', status.cache), ' (mavescape --cache-dir to move it).') : null,
      status ? h('div.section-title', 'The services MaveScape may contact') : null,
      status ? h('table.data.compact', h('tbody', ...status.hosts.map((x) => h('tr', h('td', x.service), h('td.mono', `${x.host}${x.path === '/' ? '' : x.path}`))))) : null,
      status ? h('div.section-title', { style: { marginTop: '10px' } }, 'What it asks them') : null,
      status ? h('ul.summary-lines', ...status.requests.map((r) => h('li', `${r.service}: ${r.sends}, for ${r.why}${r.sequence ? ' (only once you confirm)' : ''}.`))) : null,
      cache ? h('div.section-title', { style: { marginTop: '10px' } }, `In the cache (${entries.length})`) : null,
      cache ? (entries.length ? h('table.data.compact', h('thead', h('tr', h('th', 'Service'), h('th', 'What'), h('th', 'Release'), h('th', 'Retrieved'))),
        h('tbody', ...entries.slice(0, 30).map((e) => h('tr', h('td', e.record.service), h('td.mono', e.kind === 'uniparc' ? 'a sequence\'s lookup' : e.name.replace(/\.json$/, '')), h('td', e.record.version ?? ''), h('td', (e.record.retrieved ?? '').slice(0, 10)))))) : h('p.muted.small', 'Nothing yet.')) : null,
    ],
  });
}
