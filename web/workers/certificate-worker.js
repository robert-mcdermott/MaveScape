// Certificates in a worker (wave 6, slice 6; requirement R7; lib/certificate.js), so that the page
// stays responsive while every number is computed again. Protocol (web/ui/workers.js):
//   { type: 'certify', payload: { ws, files: [[sha256, bytes]], software, created, tables,
//     structures } } → progress … → { id, result: { bytes, certificate, notes } };
//   { type: 'verify', payload: { bytes (the certificate), files: [[sha256, bytes]] (supplied beside
//     it), software } } → progress … → { id, result: the verification's report }.

import { readCertificate, verifyCertificate, writeCertificate } from '../lib/certificate.js';

self.onmessage = async (event) => {
  const { id, type, payload } = event.data;
  const onProgress = (fraction, message) => self.postMessage({ id, progress: [fraction, message] });
  const files = new Map(payload.files ?? []);
  const file = async (sha) => files.get(sha) ?? null;
  try {
    if (type === 'certify') {
      const made = await writeCertificate(payload.ws, file, { software: payload.software, created: payload.created, tables: payload.tables, structures: payload.structures, onProgress });
      self.postMessage({ id, result: { bytes: made.bytes, certificate: made.certificate, notes: made.notes } }, [made.bytes.buffer]);
      return;
    }
    if (type === 'verify') {
      const read = await readCertificate(payload.bytes);
      const report = await verifyCertificate(read, { file, software: payload.software, onProgress });
      self.postMessage({ id, result: { report, certificate: read.certificate, workspace: { id: read.archive.ws.id, name: read.archive.ws.name } } });
      return;
    }
    self.postMessage({ id, error: `The certificate worker does not do "${type}".` });
  } catch (error) {
    self.postMessage({ id, error: error.message });
  }
};
