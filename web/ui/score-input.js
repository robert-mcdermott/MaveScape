// Scoring in the score worker, and its input from a parsed table (lib/score-input.js).

import { engineInput } from '../lib/score-input.js';

// Scores in the score worker: { promise, cancel }. A table of barcodes' identifiers, which the
// worker does not send back (the window has them: a million strings copied for nothing), are put
// back on the results.
export function runScore(app, payload, options = {}) {
  const job = app.worker('score').run('score', payload, options);
  const promise = job.promise.then((result) => {
    if (result.ok && result.results.barcodes) result.results.barcodes.ids = payload.barcodes;
    return result;
  });
  return { promise, cancel: job.cancel };
}

// The score worker's input (lib/score-input.js: the certificate computes with it too).
export const workerInput = engineInput;
