// A MaveDB score set kept beside a workspace without opening it (wave 4, slice 3; requirement C1):
// its record and its published scores, fetched by URN (/api/fetch/mavedb/score-sets/{urn} and its
// /scores, kept as MaveDB sends them), and its target (the record's sequence, or the transcript it
// names, fetched as opening a record fetches it). It is compared with the workspace's runs in the
// Compare view (lib/scoreset.js reads its scores as published), and drawn beside the map as a track:
// its single substitutions' scores, placed on the run's target by UniProt's numbering (the score
// set's target offset, then the run's), or by the target's where the residues agree there.
//
// The record kept (annotation.record.scoreSet) is what reading the scores needs: the URN, title,
// description, citation, license and keywords (the readout in MaveDB's terms), the target, and the
// direction a person states (MaveDB records none).

import { accessionTarget, readScoreSet, targetsOf } from '../mavedb.js';
import { recordOf } from './common.js';
import { predictorTrack, readPredictorTable } from './predictors.js';

// What MaveScape keeps of a score set's record: { urn, title, shortDescription, citation, license,
// keywords, variants, target, targetOrigin, others }.
export function scoreSetRecord(record, target, targetOrigin = null, others = []) {
  return {
    urn: record.urn,
    title: record.title,
    shortDescription: record.shortDescription ?? '',
    citation: record.citation ?? '',
    license: { short: record.license.short, open: record.license.open },
    keywords: record.keywords ?? [],
    variants: record.variants ?? null,
    target,
    ...(targetOrigin ? { targetOrigin } : {}),
    ...(others.length ? { others } : {}),
  };
}

export const MAVEDB_SCORES = {
  id: 'mavedb-scores',
  name: 'MaveDB score set',
  kind: 'public',
  service: 'MaveDB',
  what: 'another score set of the target\'s protein, by its URN: compared with the runs, and its scores beside the map',
  license: 'the score set\'s own (most are CC0)',
  cite: ['mavedb'],
  needs(target, context) {
    return context?.urn ? null : 'Give the score set\'s URN (urn:mavedb:…).';
  },
  // context: { urn, target (of a score set of several targets, the one to keep: its label or name) }.
  async fetch(target, context, get) {
    const urn = context.urn;
    const got = await get(`mavedb/score-sets/${encodeURIComponent(urn)}`);
    if (!got.ok) throw new Error(got.message);
    const record = readScoreSet(got.json);
    if (record.problem) throw new Error(record.problem);
    const found = targetsOf(record, { target: context.scoreSetTarget ?? null });
    const retrievals = [got.retrieval];
    let scoreSetTarget = found.targets[0] ?? null;
    let targetOrigin = null;
    if (!scoreSetTarget && found.pending.length) {
      const p = found.pending[0];
      const answer = p.kind === 'refseq' ? await get(`ncbi/nuccore/${p.accession}`, { as: 'text' }) : await get(`ensembl/transcript/${p.accession}`);
      if (!answer.ok) throw new Error(`The score set's target, the transcript ${p.accession}: ${answer.message}`);
      const made = accessionTarget(p, p.kind === 'refseq' ? answer.text : answer.json, { retrieval: answer.retrieval });
      if (made.problem) throw new Error(made.problem);
      scoreSetTarget = made.target;
      targetOrigin = made.origin;
      retrievals.push(answer.retrieval);
    }
    if (!scoreSetTarget) {
      throw new Error(found.choices.length && !context.scoreSetTarget
        ? `${urn} has ${found.choices.length} targets (${found.choices.slice(0, 6).map((c) => c.label).join(', ')}): name the one to compare.`
        : found.problems.join(' ') || `${urn} names no target MaveScape can read.`);
    }
    const scores = await get(`mavedb/score-sets/${encodeURIComponent(urn)}/scores`, { as: 'text' });
    if (!scores.ok) throw new Error(`${urn}'s scores: ${scores.message}`);
    retrievals.push(scores.retrieval);
    return {
      text: scores.text,
      fileName: `${urn.replace(/:/g, '_')}.scores.csv`,
      record: recordOf(retrievals, { urn, license: record.license.short, citation: record.citation || null, scoreSet: scoreSetRecord(record, scoreSetTarget, targetOrigin, found.others) }),
    };
  },
  // The track: each single substitution's published score, numbered on the score set's target, then
  // placed on the run's. A score set of nucleotide variants with no protein names has none (it is
  // still compared).
  read(text, context) {
    const set = context.record?.scoreSet;
    const read = readPredictorTable(text);
    const label = set ? `${set.title} (${set.urn})` : 'MaveDB score set';
    if (read.problem || !read.entries.length) return { tracks: [], notes: [`${label}: no single substitutions named at the protein level to draw beside the map; it is compared in Compare.`] };
    const offset = set?.target?.offset ?? 0;
    const shifted = { ...read, name: label, column: 'score', classes: null, entries: read.entries.map((e) => ({ ...e, refPosition: e.refPosition + offset, cls: null })) };
    const made = predictorTrack(shifted, context, { part: 'scores', label });
    if (made.problem) return { tracks: [], notes: [`${made.problem} It is still compared in Compare, on UniProt's numbering where both give it.`] };
    return { tracks: made.tracks.map((t) => ({ ...t, unit: 'mean score (as published)' })), notes: made.notes };
  },
};
