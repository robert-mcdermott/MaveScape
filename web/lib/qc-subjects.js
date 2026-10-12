// What quality control can be computed for (moved from web/ui/mode-qc.js in wave 6, slice 6, so
// that the certificate draws a figure's QC panels as the QC view computes them): each run (its
// recorded table, design and parameters), and the counts with the current design (no scores).

import { validateDesign } from './design.js';

export const designSource = (ws) => ws.sources.find((s) => s.id === (ws.designSource ?? ws.sources[0]?.id)) ?? null;

// What QC can be of: each run (by id), and 'counts' (the current design, no scores).
export function qcSubjects(ws) {
  const options = ws.runs.slice().reverse().map((r) => ({ id: `run:${r.id}`, label: `${r.name} (${r.inputs.source.name})`, run: r }));
  // Published scores (wave 3, slice 2) have no counts of their own to check.
  if (ws.design && ws.design.model !== 'scores' && designSource(ws)) options.push({ id: 'counts', label: 'The counts, with the current design (no scores)' });
  return options;
}

// The inputs of QC for a subject: { source, design, parameters, mode } or { problem }.
export function qcInputsOf(ws, sub) {
  if (sub.run) {
    const s = ws.sources.find((x) => x.sha256 === sub.run.inputs.source.sha256);
    if (!s) return { problem: `The table ${sub.run.name} scored (SHA-256 ${sub.run.inputs.source.sha256.slice(0, 12)}…) is not in this workspace.` };
    return { source: s, design: sub.run.inputs.design, parameters: sub.run.inputs.parameters, mode: sub.run.inputs.mapping.mode };
  }
  const s = designSource(ws);
  const design = ws.design;
  const result = validateDesign(design, { columns: s.columns.map((c) => c.name) });
  if (!result.ok) return { problem: `The design has problems to fix first: ${result.errors.slice(0, 3).map((e) => e.message).join(' ')}`, experiment: true };
  return { source: s, design, parameters: null, mode: s.mapping?.mode ?? 'lenient' };
}

