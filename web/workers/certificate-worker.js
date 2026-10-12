// Certificates in a worker (wave 6, slice 6; requirement R7; lib/certificate.js), so that the page
// stays responsive while every number is computed again. Protocol (web/ui/workers.js):
//   { type: 'certify', payload: { ws, files: [[sha256, bytes]], software, tables, structures,
//     review } } → progress … → { id, result: { bytes, certificate, notes, review (the review
//     report's HTML, lib/review.js, when asked) } };
//   { type: 'verify', payload: { bytes (the certificate), files: [[sha256, bytes]] (supplied beside
//     it), software, review } } → progress … → { id, result: { report (the verification's),
//     certificate, workspace, review (when asked and verified) } }.

import { readCertificate, verifyCertificate, writeCertificate } from '../lib/certificate.js';

self.onmessage = async (event) => {
  const { id, type, payload } = event.data;
  const onProgress = (fraction, message) => self.postMessage({ id, progress: [fraction, message] });
  const files = new Map(payload.files ?? []);
  const file = async (sha) => files.get(sha) ?? null;
  try {
    if (type === 'certify') {
      const made = await writeCertificate(payload.ws, file, { software: payload.software, tables: payload.tables, structures: payload.structures, review: payload.review, onProgress });
      self.postMessage({ id, result: { bytes: made.bytes, certificate: made.certificate, notes: made.notes, review: made.review } }, [made.bytes.buffer]);
      return;
    }
    if (type === 'verify') {
      const read = await readCertificate(payload.bytes);
      const report = await verifyCertificate(read, { file, software: payload.software, review: payload.review, onProgress });
      self.postMessage({ id, result: { report, certificate: read.certificate, workspace: { id: read.archive.ws.id, name: read.archive.ws.name }, review: report.review ?? null } });
      return;
    }
    self.postMessage({ id, error: `The certificate worker does not do "${type}".` });
  } catch (error) {
    self.postMessage({ id, error: error.message });
  }
};
