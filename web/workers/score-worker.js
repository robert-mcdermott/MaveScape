// Scores an experiment in a worker (requirements S1–S5, V7), so the page stays responsive and a
// run can be canceled (canceling terminates the worker, web/ui/workers.js). Protocol: { id, type:
// 'score', payload: { names, columns: { name: Float64Array }, design, mode, parameters } } →
// progress … → { id, result: { ok, results | errors } } (web/lib/score.js), its arrays transferred.

import { scoreExperiment } from '../lib/score.js';

function buffers(results) {
  const out = [];
  const add = (x) => {
    if (ArrayBuffer.isView(x) && !out.includes(x.buffer)) out.push(x.buffer);
  };
  for (const r of results.replicates) [r.first, r.last, r.score, r.se, r.state].forEach(add);
  for (const c of results.conditions) [c.score, c.se, c.tau2, c.i2, c.q, c.loo, c.looReplicate, c.epsilon, c.k, c.expected, c.reason, c.flags].forEach(add);
  for (const x of [results.variants.kind, results.variants.position, results.variants.status]) add(x);
  return out;
}

self.onmessage = (event) => {
  const { id, type, payload } = event.data;
  if (type !== 'score') return;
  const onProgress = (fraction, message) => self.postMessage({ id, progress: [fraction, message] });
  try {
    const result = scoreExperiment({ ...payload, onProgress });
    self.postMessage({ id, result }, result.ok ? buffers(result.results) : []);
  } catch (error) {
    self.postMessage({ id, error: error.message });
  }
};
