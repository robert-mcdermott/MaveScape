// Certificates in the window (wave 6, slice 6; requirement R7; lib/certificate.js): the open
// workspace certified in the certificate worker from the files the library keeps (every number
// computed again from them, not taken from the session), and a certificate verified, its tables
// from the archive, the library or files given beside it. And the review report (slice 7,
// lib/review.js): the certificate's numbers as one self-contained HTML file, made with the
// certificate or from one verified. The Report view's Certificate pane and remote control's
// certify, review_report and verify_certificate use it; opening a certificate offers to verify it.

import { certificateInputs, readCertificate, shortFingerprint } from '../lib/certificate.js';
import { sha256 } from '../lib/sha256.js';
import { h, icon, downloadBlob } from './dom.js';
import { progressToast, showDialog, toast } from './overlays.js';

const safe = (s) => String(s).replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'workspace';
const count = (n) => n.toLocaleString('en-US');
const plural = (n, word, many = `${word}s`) => `${count(n)} ${n === 1 ? word : many}`;

async function libraryBytes(app, sha) {
  const bytes = await app.library.getFile(sha);
  if (!bytes) return null;
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(await new Response(bytes).arrayBuffer());
}

// What this session knows of certificates: { made: { name, fingerprint, total, notes, tables },
// opened: { name, bytes, fingerprint } (a certificate opened as the workspace), verified: { name,
// report, review } }.
export function certificateState(app) {
  app.certificate ??= { made: null, opened: null, verified: null };
  return app.certificate;
}

// Certifies the open workspace: { name, bytes, certificate, notes, review }. options: { tables
// (include the count tables; otherwise each is named by its SHA-256 only), review (its review
// report too), onProgress }.
export async function makeCertificate(app, { tables = true, review = false, onProgress } = {}) {
  const ws = app.store.ws;
  const files = [];
  for (const input of certificateInputs(ws)) {
    const bytes = await libraryBytes(app, input.sha256);
    if (bytes) files.push([input.sha256, bytes]);
  }
  const result = await app.worker('certificate').run('certify', { ws, files, software: { version: app.version, commit: app.commit }, tables, review }, { onProgress }).promise;
  const name = `${safe(ws.name)}.certificate.msz`;
  const c = result.certificate;
  certificateState(app).made = { name, fingerprint: c.fingerprint, total: c.total, notes: result.notes, tables };
  app.log(`Certified "${ws.name}": ${plural(c.total, 'number')} computed again from its files, fingerprint ${c.fingerprint}${tables ? '' : ' (the tables named by their SHA-256 only)'}.${result.notes.length ? ` ${result.notes.join(' ')}` : ''}`);
  app.store.notify(['certificate']);
  return { name, ...result };
}

// Verifies a certificate's bytes: its files from the archive, `beside` (files given with it: [{
// name, bytes }], each found by its SHA-256) and the library (unless library is false: as someone
// without this library verifies it). Returns { report, certificate, review (its review report, when
// it is verified) }.
export async function verifyBytes(app, bytes, { name = 'certificate.msz', beside = [], library = true, onProgress } = {}) {
  const read = await readCertificate(bytes);
  const files = [];
  const fromLibrary = new Set();
  const given = new Map(beside.map((f) => [sha256(f.bytes), f.bytes]));
  for (const input of read.certificate.inputs ?? []) {
    if (read.archive.sources.has(input.sha256)) continue;
    let found = given.get(input.sha256) ?? null;
    if (!found && library) {
      found = await libraryBytes(app, input.sha256);
      if (found) fromLibrary.add(input.sha256);
    }
    if (found) files.push([input.sha256, found]);
  }
  const result = await app.worker('certificate').run('verify', { bytes, files, software: { version: app.version, commit: app.commit }, review: true }, { onProgress }).promise;
  for (const input of result.report.inputs) if (input.from === 'supplied' && fromLibrary.has(input.sha256)) input.from = 'library';
  certificateState(app).verified = { name, report: result.report, review: result.review, certificate: { fingerprint: read.certificate.fingerprint, workspace: read.certificate.workspace } };
  app.log(`${name}: ${result.report.summary}`);
  app.store.notify(['certificate']);
  return { report: result.report, certificate: read.certificate, review: result.review };
}

// --- In the window ---------------------------------------------------------------------------------

export async function certifyAndDownload(app, { tables = true } = {}) {
  const busy = progressToast('Certifying: every number computed again from the files…');
  try {
    const made = await makeCertificate(app, { tables, onProgress: (f, text) => busy.update(f, text) });
    downloadBlob(new Blob([made.bytes], { type: 'application/zip' }), made.name);
    busy.done(`Wrote ${made.name}: ${plural(made.certificate.total, 'number')}, fingerprint ${shortFingerprint(made.certificate.fingerprint)}.`);
    if (made.notes.length) showDialog({ title: 'Certified, with notes', content: [h('p', `${made.name} records what the files give now. Note:`), h('ul', ...made.notes.map((n) => h('li', n)))] });
  } catch (error) {
    busy.fail(`The certificate could not be made: ${error.message}`);
  }
}

// The review report's file name, after the certificate's.
export const reviewName = (name) => `${String(name).replace(/\.certificate\.msz$|\.msz$/i, '')}.review.html`;

const downloadReview = (html, name) => downloadBlob(new Blob([html], { type: 'text/html' }), name);

export async function reviewAndDownload(app, { tables = true } = {}) {
  const busy = progressToast('Writing the review report: every number computed again from the files…');
  try {
    const made = await makeCertificate(app, { tables, review: true, onProgress: (f, text) => busy.update(f, text) });
    const name = reviewName(made.name);
    downloadReview(made.review, name);
    busy.done(`Wrote ${name}: the numbers of the certificate ${shortFingerprint(made.certificate.fingerprint)}, each traced. Certify writes that certificate (the same workspace, the same fingerprint).`);
  } catch (error) {
    busy.fail(`The review report could not be made: ${error.message}`);
  }
}

export function chooseReview(app) {
  const tables = h('input', { type: 'checkbox', checked: true });
  showDialog({
    title: 'Review report',
    content: [
      h('p', 'One HTML file a reviewer opens in any browser, without MaveScape: the experiment and design, the inputs with their checksums, each run\'s parameters, classes and maps, the QC findings with their plots, the comparisons, robustness checks, selections, structure views and figures, the methods and the decision log. Every number is traced: clicked, it says where it comes from. They are the certificate\'s numbers, and the report names its fingerprint; the file loads nothing.'),
      h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, tables, 'For the certificate with the count tables (otherwise, the one that names them by their SHA-256 only)'),
    ],
    buttons: [{ label: 'Cancel' }, { label: 'Write the report', primary: true, onClick: () => reviewAndDownload(app, { tables: tables.checked }) }],
  });
}

export function chooseCertify(app) {
  const tables = h('input', { type: 'checkbox', checked: true });
  showDialog({
    title: 'Certify the workspace',
    content: [
      h('p', 'A certificate is the workspace archive (.msz) with every number the workspace reports computed again from its files: each run\'s scores, SEs and classes, its QC findings, the analyses kept in the report, the figures\' drawings and the report. Verifying it computes them once more and compares them bit for bit. Its fingerprint, the SHA-256 of what was certified, is what to quote with the analysis.'),
      h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, tables, 'Include the count tables (otherwise each is named by its SHA-256 only, and must be given to verify it)'),
    ],
    buttons: [{ label: 'Cancel' }, { label: 'Certify', primary: true, onClick: () => certifyAndDownload(app, { tables: tables.checked }) }],
  });
}

const STATUS = { ok: 'as certified', missing: 'missing', changed: 'changed', absent: 'not needed, named by its SHA-256' };
const ROLES = { table: 'Table', annotation: 'Annotation', image: 'Figure image', structure: 'Structure' };

// What verifying found, as the dialog and the pane show it.
export function reportContent(report) {
  const kind = report.verdict === 'verified' ? 'ok' : report.verdict === 'incomplete' ? 'warn' : 'danger';
  const n = report.numbers;
  return [
    h(`div.callout.${kind}`, icon(report.verdict === 'verified' ? 'seal' : 'warning'), h('span', report.summary)),
    h('p.muted', { style: { margin: '10px 0' } }, `${count(n.checked)} numbers: ${count(n.same)} identical${n.differs ? `, ${count(n.differs)} different` : ''}${n.missing ? `, ${count(n.missing)} not computed` : ''}. History: ${report.history.entries} entries, ${report.history.ok ? 'its chain unbroken and its head the one certified' : 'not the one certified'}.${report.checkpoints.length ? ` Checkpoints: ${report.checkpoints.filter((c) => c.ok).length} of ${report.checkpoints.length} as certified.` : ''}`),
    h('div.table-scroll', h('table.data.compact',
      h('thead', h('tr', h('th', 'File'), h('th', 'SHA-256'), h('th', 'Status'))),
      h('tbody', ...report.inputs.map((i) => h('tr', h('td', `${ROLES[i.role] ?? i.role}: ${i.fileName ?? i.name}`), h('td', h('code', `${i.sha256.slice(0, 12)}…`)), h('td', `${STATUS[i.status] ?? i.status}${i.from === 'supplied' ? ' (given beside it)' : i.from === 'library' ? ' (from this library)' : ''}`)))))),
    n.differ.length ? h('details', { open: true }, h('summary', `The numbers that differ${n.differs > n.differ.length ? ` (the first ${n.differ.length} of ${count(n.differs)})` : ''}`),
      h('ul', ...n.differ.slice(0, 50).map((d) => h('li', `${d.label}: ${JSON.stringify(d.recorded)} certified, ${JSON.stringify(d.computed)} now`)))) : null,
    report.archive.problems.length ? h('details', h('summary', 'The archive'), h('ul', ...report.archive.problems.map((p) => h('li', p)))) : null,
    report.notChecked.length ? h('details', h('summary', 'Not computed again'), h('ul', ...report.notChecked.map((x) => h('li', `${x.what}: ${x.reason}.`)))) : null,
    report.notes.length ? h('details', h('summary', 'Notes made when it was certified'), h('ul', ...report.notes.map((x) => h('li', x)))) : null,
  ];
}

// The verification's dialog: what was found, and the review report of a certificate verified.
function verificationDialog(name, report, review) {
  showDialog({
    title: `${name}: ${report.verdict === 'verified' ? 'verified' : report.verdict === 'incomplete' ? 'not checkable' : 'not verified'}`,
    width: 'medium',
    content: reportContent(report),
    buttons: [...(review ? [{ label: 'Review report', onClick: () => downloadReview(review, reviewName(name)) }] : []), { label: 'Close', primary: true }],
  });
}

export async function verifyAndShow(app, bytes, { name, beside = [] } = {}) {
  const busy = progressToast(`Verifying ${name}: every number computed again…`);
  try {
    const { report, review } = await verifyBytes(app, bytes, { name, beside, onProgress: (f, text) => busy.update(f, text) });
    busy.done(null);
    verificationDialog(name, report, review);
    return report;
  } catch (error) {
    busy.fail(`${name} could not be verified: ${error.message}`);
    return null;
  }
}

// A certificate (and the tables it names) chosen to verify, without opening it as the workspace.
export function pickAndVerify(app) {
  const input = h('input', { type: 'file', multiple: true, accept: '.msz,.csv,.tsv,.txt,.gz,.gff,.gff3,.png,.cif,.pdb', style: { display: 'none' } });
  input.addEventListener('change', async () => {
    const chosen = [];
    for (const f of input.files) chosen.push({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
    input.remove();
    const certificates = chosen.filter((f) => /\.msz$/i.test(f.name));
    if (certificates.length !== 1) {
      toast('Choose one certificate (.msz), and the tables it names if it was made without them.', { kind: 'error' });
      return;
    }
    await verifyAndShow(app, certificates[0].bytes, { name: certificates[0].name, beside: chosen.filter((f) => f !== certificates[0]) });
  });
  document.body.append(input);
  input.click();
}

// An archive opened as the workspace was a certificate: offered to verify.
export function openedCertificate(app, name, bytes, certificate) {
  certificateState(app).opened = { name, bytes, fingerprint: certificate.fingerprint, workspace: app.store.ws.id };
  app.store.notify(['certificate']);
  toast(`${name} is a certificate (fingerprint ${shortFingerprint(certificate.fingerprint)}): verify it to compute its ${plural(certificate.total ?? 0, 'number')} again.`, { action: { label: 'Verify', onClick: () => verifyAndShow(app, bytes, { name }) }, timeout: 12000 });
}

// The Report view's Certificate pane.
export function certificatePane(app) {
  const state = certificateState(app);
  const ws = app.store.ws;
  const opened = state.opened?.workspace === ws.id ? state.opened : null;
  const verified = state.verified;
  const made = state.made;
  return h('div.pane.certificate-pane', h('h3', icon('seal'), 'Certificate'),
    h('p.muted', { style: { margin: '0 0 8px' } }, 'Every number the workspace reports, computed again from its files and kept with them, so that anyone can check them bit for bit.'),
    h('div.btn-row',
      h('button.btn.small', { type: 'button', disabled: !ws.runs.length, title: ws.runs.length ? 'Make a certificate of the workspace (.msz)' : 'Score a run first', onclick: () => chooseCertify(app) }, icon('seal'), 'Certify…'),
      h('button.btn.small', { type: 'button', disabled: !ws.runs.length, title: ws.runs.length ? 'Write the review report (.html): the certificate\'s numbers, each traced, in one file a reviewer opens in any browser' : 'Score a run first', onclick: () => chooseReview(app) }, icon('report'), 'Review report…'),
      h('button.btn.small', { type: 'button', title: 'Verify a certificate (.msz), with the tables it names if it was made without them', onclick: () => pickAndVerify(app) }, icon('check'), 'Verify…'),
      opened ? h('button.btn.small', { type: 'button', title: `Verify ${opened.name}, which this workspace was opened from`, onclick: () => verifyAndShow(app, opened.bytes, { name: opened.name }) }, 'Verify this one') : null),
    made ? h('p.certificate-line', h('b', 'Made: '), `${made.name}, ${plural(made.total, 'number')}, fingerprint `, h('code', shortFingerprint(made.fingerprint)), made.notes.length ? h('span.muted', ` (${plural(made.notes.length, 'note')})`) : null) : null,
    verified ? h('p.certificate-line', h('b', 'Verified: '), `${verified.name}: `, h(`span.${verified.report.verdict === 'verified' ? 'ok-text' : 'danger-text'}`, verified.report.verdict === 'verified' ? 'verified' : verified.report.verdict === 'incomplete' ? 'not checkable' : 'not verified'),
      ' ', h('button.btn.small', { type: 'button', onclick: () => verificationDialog(verified.name, verified.report, verified.review) }, 'Details')) : null);
}
