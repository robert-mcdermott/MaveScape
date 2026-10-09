// A score run's results in this session (app.runResults: run id → { status, results?, message? }).
// Runs keep their inputs and output hash, not their scores (lib/runs.js): a run's scores are
// recomputed in the score worker from its recorded inputs the first time a view needs them, and
// checked against the recorded output hash ('reproduced', 'differs' or 'failed'). Views and the
// inspector are told with the store topic 'results'.

import { outputDigest, recordedInputs } from '../lib/runs.js';
import { SCORING_VERSION } from '../lib/score.js';
import { workerInput } from './score-input.js';

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
        const { names, columns, transfer } = workerInput(table, recorded.design);
        const result = await app.worker('score').run('score', { names, columns, design: recorded.design, parameters: recorded.parameters, mode: recorded.mapping.mode }, { transfer }).promise;
        if (!result.ok) throw new Error(result.errors.join(' '));
        const digest = outputDigest(result.results);
        const same = digest === run.output.sha256;
        const older = recorded.scoring !== SCORING_VERSION;
        const why = older
          ? `MaveScape ${run.software.version} scored it with scoring engine ${recorded.scoring}, which took its logarithms from the browser (their last digit varies between browsers and their versions); this is engine ${SCORING_VERSION}, the same in every browser. The scores differ only in their last digits.`
          : `MaveScape ${run.software.version} made it; this is ${app.version}.`;
        next = { results: result.results, status: same ? 'reproduced' : 'differs', message: same ? '' : `The recomputed scores have output SHA-256 ${digest.slice(0, 12)}…, not ${run.output.sha256.slice(0, 12)}… as recorded. ${why}` };
        if (!same) app.log(`${run.name}: recomputed scores differ from the recorded ones (output SHA-256 ${digest} for ${run.output.sha256}).`);
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
