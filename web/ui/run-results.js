// A score run's results in this session (app.runResults: run id → { status, results?, message? }).
// Runs keep their inputs and output hash, not their scores (lib/runs.js): a run's scores are
// recomputed in the score worker from its recorded inputs the first time a view needs them, and
// checked against the recorded output hash ('reproduced', 'differs' or 'failed'). Views and the
// inspector are told with the store topic 'results'.

import { outputDigest, recordedInputs, reproduction } from '../lib/runs.js';
import { runScore, workerInput } from './score-input.js';

export function runEntry(app, run) {
  app.runResults ??= new Map();
  return app.runResults.get(run.id) ?? null;
}

export async function ensureResults(app, run) {
  app.runResults ??= new Map();
  const existing = app.runResults.get(run.id);
  if (existing) return existing.pending ?? existing;
  const entry = { status: 'checking' };
  app.runResults.set(run.id, entry);
  entry.pending = (async () => {
    const recorded = recordedInputs(run);
    const source = app.store.ws.sources.find((x) => x.sha256 === recorded.source.sha256);
    let next;
    if (!source) {
      next = { status: 'failed', message: `The table it scored (SHA-256 ${recorded.source.sha256.slice(0, 12)}…) is not in this workspace.` };
    } else {
      try {
        const table = await app.sourceTable(source);
        const { names, barcodes, columns, transfer } = workerInput(table, recorded.design);
        const result = await runScore(app, { names, barcodes, columns, design: recorded.design, parameters: recorded.parameters, mode: recorded.mapping.mode }, { transfer }).promise;
        if (!result.ok) throw new Error(result.errors.join(' '));
        const digest = outputDigest(result.results);
        const verdict = reproduction(run, digest, app.version);
        next = { results: result.results, ...verdict };
        if (verdict.status !== 'reproduced') app.log(`${run.name}: recomputed scores differ from the recorded ones (output SHA-256 ${digest} for ${run.output.sha256}).`);
      } catch (error) {
        next = { status: 'failed', message: error.message };
      }
    }
    app.runResults.set(run.id, next);
    app.store.notify(['results']);
    return next;
  })();
  return entry.pending;
}

// Forgets a run's results, so that they are computed again.
export function forgetResults(app, run) {
  app.runResults?.delete(run.id);
  app.store.notify(['results']);
}
