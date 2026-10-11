import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BUILTIN_TRACKS, CLINVAR_CLASSES, REVIEW_STARS, annotationsOf, applyFilter, arrangeTracks, arrangement, builtinTracks, clinvarClass, describeTrack, describeTrackAt,
  placeResidues, readSubstitution, substitutionKey, trackFilters, trackTarget, tracksCSV, variantsTrack,
} from './tracks.js';
import { layoutTracks, shapesSVG, trackPosition, trackShapes, tracksHeight } from './track-render.js';
import { geometry, hitTest } from './map-render.js';
import { STATE } from './map-model.js';

test('substitutions as annotations write them, read as one form', () => {
  const r86q = { ref: 'R', position: 86, alt: 'Q' };
  for (const text of ['p.Arg86Gln', 'p.(Arg86Gln)', 'NP_002077.1:p.Arg86Gln', 'R86Q', 'p.R86Q']) assert.deepEqual(readSubstitution(text), r86q, text);
  assert.deepEqual(readSubstitution('p.Glu171Ter'), { ref: 'E', position: 171, alt: '*' });
  assert.deepEqual(readSubstitution('E171*'), { ref: 'E', position: 171, alt: '*' });
  assert.deepEqual(readSubstitution('p.His79='), { ref: 'H', position: 79, alt: 'H' });
  assert.deepEqual(readSubstitution('p.His79His'), { ref: 'H', position: 79, alt: 'H' });
  for (const text of ['p.Arg86fs', 'p.Arg86_Gln87del', 'c.257G>A', 'p.Ter218LeufsTer32', '', null]) assert.equal(readSubstitution(text), null, text);
  assert.equal(substitutionKey('R', 86, 'Q'), 'p.Arg86Gln');
  assert.equal(substitutionKey('E', 171, '*'), 'p.Glu171Ter');
  assert.equal(substitutionKey('H', 79, 'H'), 'p.His79=');
});

test('residues placed by the offset where the target agrees; a wrong offset said', () => {
  const protein = 'TYVQALFDFD';
  const items = [{ refPosition: 159, ref: 'T' }, { refPosition: 160, ref: 'Y' }, { refPosition: 161, ref: 'A' }, { refPosition: 300, ref: 'W' }, { refPosition: 162, ref: null }];
  const place = placeResidues(items, protein, 158);
  assert.deepEqual(place.placed.map((x) => x.position), [1, 2, 4]);
  assert.equal(place.outside, 1);
  assert.deepEqual(place.disagree, [{ refPosition: 161, ref: 'A', target: 'V' }]);
  assert.equal(place.problem, null);
  const wrong = placeResidues(protein.split('').map((ref, i) => ({ refPosition: i + 1, ref })), protein, 158);
  assert.equal(wrong.placed.length, 0);
  const shifted = placeResidues(protein.split('').map((ref, i) => ({ refPosition: i + 160, ref })), protein, 158);
  assert.match(shifted.problem, /disagree with the target's at the target's offset \(158\)/);
});

test('ClinVar\'s classifications in five classes, its review status as stars', () => {
  assert.equal(clinvarClass('Pathogenic'), 'pathogenic');
  assert.equal(clinvarClass('Likely pathogenic'), 'pathogenic');
  assert.equal(clinvarClass('Pathogenic/Likely pathogenic'), 'pathogenic');
  assert.equal(clinvarClass('Conflicting classifications of pathogenicity'), 'conflicting');
  assert.equal(clinvarClass('Uncertain significance'), 'uncertain');
  assert.equal(clinvarClass('Benign/Likely benign'), 'benign');
  assert.equal(clinvarClass('risk factor'), 'other');
  assert.equal(clinvarClass('-'), null);
  assert.equal(REVIEW_STARS['reviewed by expert panel'], 3);
  assert.equal(REVIEW_STARS['criteria provided, single submitter'], 1);
  assert.deepEqual(CLINVAR_CLASSES.map((k) => k.id), ['pathogenic', 'conflicting', 'uncertain', 'benign', 'other']);
});

// A model of 3 positions × 21 rows: position 1 fully scored, 2 half, 3 not designed.
function smallModel() {
  const R = 21;
  const L = 3;
  const state = new Uint8Array(L * R);
  const reference = new Uint8Array(L * R);
  const cells = new Int32Array(L * R).fill(-1);
  const se = [];
  for (let p = 1; p <= L; p += 1) {
    for (let r = 0; r < R; r += 1) {
      const k = (p - 1) * R + r;
      if (r === 0) reference[k] = 1;
      if (p === 3) state[k] = STATE.NOT_DESIGNED;
      else if (r === 0) state[k] = STATE.REFERENCE;
      else if (p === 1 || r <= 10) {
        state[k] = STATE.SCORED;
        cells[k] = se.length;
        se.push(p === 1 ? 0.1 : 0.3);
      } else state[k] = STATE.MISSING;
    }
  }
  return { length: L, rows: Array.from({ length: R }, () => 'A'), state, reference, cells, source: { se: Float64Array.from(se) }, columnMedian: Float64Array.of(-1, 0.5, Number.NaN), scoreCenter: 0, protein: 'MKV', target: { name: 'T', offset: 10 }, contrast: null };
}

test('the run\'s own tracks: reference, coverage, position effect and uncertainty', () => {
  const tracks = builtinTracks(smallModel());
  assert.deepEqual(tracks.map((t) => t.id), BUILTIN_TRACKS.map((t) => t.id));
  const [reference, coverage, effect, uncertainty] = tracks;
  assert.equal(reference.residues, 'MKV');
  assert.deepEqual([...coverage.values].slice(0, 2), [1, 0.5]);
  assert.ok(Number.isNaN(coverage.values[2]));
  assert.equal(effect.domain.kind, 'diverging');
  assert.equal(effect.domain.center, 0);
  assert.deepEqual([...uncertainty.values].slice(0, 2), [0.1, 0.3]);
  assert.equal(describeTrackAt(coverage, 2, 10), 'Coverage at 2 (reference 12): 50% (share scored)');
  assert.equal(describeTrackAt(reference, 1, 10), 'Reference 1 (reference 11): M');
});

function clinvarTrack() {
  const entries = [
    { key: 'p.Met1Lys', position: 1, ref: 'M', alt: 'K', value: 3, stars: 3, cls: 'pathogenic', label: 'Pathogenic ★★★☆' },
    { key: 'p.Met1Val', position: 1, ref: 'M', alt: 'V', value: 1, stars: 1, cls: 'uncertain', label: 'Uncertain significance ★☆☆☆' },
    { key: 'p.Lys2Arg', position: 2, ref: 'K', alt: 'R', value: 0, stars: 0, cls: 'benign', label: 'Benign ☆☆☆☆' },
  ];
  return variantsTrack({ id: 'a:clinvar', label: 'ClinVar', length: 3 }, entries, { summary: 'count', classes: CLINVAR_CLASSES });
}

test('a variants track: by position, by class, by variant; filtered by class and review status', () => {
  const t = clinvarTrack();
  assert.deepEqual([...t.values].slice(0, 2), [2, 1]);
  assert.deepEqual(t.stacks[0], [{ cls: 'pathogenic', n: 1 }, { cls: 'uncertain', n: 1 }]);
  assert.equal(t.byKey.get('p.Lys2Arg')[0].label, 'Benign ☆☆☆☆');
  assert.deepEqual(trackFilters(t).map((f) => f.id), ['classes', 'stars']);
  const pathogenic = applyFilter(t, { classes: ['pathogenic'] });
  assert.equal(pathogenic.entries.length, 1);
  assert.equal(pathogenic.hiddenEntries, 2);
  assert.ok(Number.isNaN(pathogenic.values[1]));
  const reviewed = applyFilter(t, { stars: 2 });
  assert.deepEqual(reviewed.entries.map((e) => e.key), ['p.Met1Lys']);
  assert.match(reviewed.filtered, /2★ and up/);
  assert.match(describeTrack(t), /3 variants at 2 positions \(1 pathogenic or likely pathogenic, 1 uncertain significance, 1 benign or likely benign\)/);
  assert.match(describeTrackAt(t, 1), /ClinVar at 1: 2 variants: Met1Lys Pathogenic/);
  assert.deepEqual(annotationsOf([t], 'p.Met1Lys', 1).map((x) => x.text), ['Pathogenic ★★★☆']);
});

test('the arrangement: built-in tracks first and hidden until shown, an annotation\'s shown; moved, filtered', () => {
  const tracks = [...builtinTracks(smallModel()), clinvarTrack()];
  const first = arrangeTracks(tracks, null);
  assert.deepEqual(first.filter((t) => t.shown).map((t) => t.id), ['a:clinvar']);
  let layout = arrangement(null, tracks, { id: 'a:clinvar', to: 0 });
  for (const id of ['reference', 'coverage', 'effect']) layout = arrangement(layout, tracks, { id, shown: true });
  layout = arrangement(layout, tracks, { id: 'a:clinvar', filter: { classes: ['benign'] } });
  const arranged = arrangeTracks(tracks, layout);
  assert.deepEqual(arranged.map((t) => t.id), ['a:clinvar', 'reference', 'coverage', 'effect', 'uncertainty']);
  assert.deepEqual(arranged.filter((t) => t.shown).map((t) => t.id), ['a:clinvar', 'reference', 'coverage', 'effect']);
  assert.equal(arranged[0].entries.length, 1);
  layout = arrangement(layout, tracks, { id: 'a:clinvar', filter: {} });
  assert.deepEqual(layout.filters, {});
});

test('the tracks as a table, position by position', () => {
  const model = smallModel();
  const csv = tracksCSV([...builtinTracks(model).slice(0, 2), clinvarTrack(), { id: 'f', label: 'Domains', kind: 'features', length: 3, features: [{ type: 'Domain', start: 1, end: 2, label: 'SH3' }] }], model);
  assert.equal(csv, 'position,reference_position,residue,Coverage,ClinVar,ClinVar: variants,Domains\n1,11,M,1,2,p.Met1Lys Pathogenic ★★★☆; p.Met1Val Uncertain significance ★☆☆☆,SH3\n2,12,K,0.5,1,p.Lys2Arg Benign ☆☆☆☆,SH3\n3,13,V,,,,\n');
});

test('drawn: each kind in its place, below the grid; hits name the track and position', () => {
  const model = smallModel();
  const tracks = [...builtinTracks(model).slice(0, 2), clinvarTrack(), { id: 'f', label: 'Secondary structure', kind: 'features', length: 3, features: [{ type: 'Helix', start: 1, end: 1, label: 'Helix' }, { type: 'Beta strand', start: 2, end: 3, label: 'Beta strand' }] }];
  const { rows, bottom } = layoutTracks(tracks, 100);
  assert.deepEqual(rows.map((r) => r.y), [104, 122, 148, 170]);
  assert.equal(bottom - 100, tracksHeight(tracks));
  const theme = { muted: '#777', line: '#ccc', text: '#000', track: { bar: '#00f', feature: '#0a0', onFeature: '#fff', helix: '#f0f', strand: '#fa0', turn: '#0af', pathogenic: '#d55e00', conflicting: '#a05ba8', uncertain: '#e0b000', benign: '#0072b2', other: '#999' } };
  const shapes = trackShapes(tracks, { left: 132, gridW: 300, cellW: 20, x0: 1, first: 1, last: 3, top: 100, gutter: 132 }, theme, () => '#888');
  const names = shapes.filter((s) => s.type === 'text' && s.anchor === 'end').map((s) => s.text);
  assert.deepEqual(names, ['Reference', 'Coverage', 'ClinVar', 'Secondary structure']);
  assert.deepEqual(shapes.filter((s) => s.type === 'text' && s.mono).map((s) => s.text), ['M', 'K', 'V']);
  assert.equal(shapes.filter((s) => s.fill === '#d55e00').length, 1);
  assert.equal(shapes.filter((s) => s.type === 'path' && s.fill === '#fa0').length, 1);
  assert.ok(shapesSVG(shapes, 'clip').includes('clip-path="url(#clip)"'));
  assert.equal(trackPosition({ scale: 'log', domain: { min: 1e-6, max: 1 } }, 1e-3), 0.5);
  const view = { width: 600, cellW: 20, cellH: 10, x0: 1, tracks };
  const g = geometry(model, view);
  assert.equal(g.left, 132);
  assert.equal(g.tracksHeight, tracksHeight(tracks));
  assert.equal(geometry(model, { ...view, tracks: [] }).left, 30);
  assert.deepEqual(hitTest(model, view, 132 + 25, g.tracksTop + 4 + 3), { region: 'track', track: 0, position: 2 });
  assert.deepEqual(hitTest(model, view, 20, g.tracksTop + 30), { region: 'track', track: 1, position: null });
});

test('a run\'s tracks use the identifiers its target has gained since, while the sequence and offset are the same', () => {
  const scored = { name: 'GRB2', sequence: 'TYVQALFDFDPQEDGELGFRRGDFIHVMDNSDPNWWKGACHGQTGMFPRNYVTPVN', sequenceType: 'protein', offset: 158, identifiers: { uniprot: 'P62993' } };
  const checked = { ...scored, id: 't1', identifiers: { uniprot: 'P62993', gene: 'GRB2' } };
  assert.deepEqual(trackTarget(scored, [checked]).identifiers, { uniprot: 'P62993', gene: 'GRB2' });
  assert.equal(trackTarget(scored, [checked]).offset, 158);
  // Placed elsewhere since, or another sequence: the run's own.
  assert.equal(trackTarget(scored, [{ ...checked, offset: 0 }]), scored);
  assert.equal(trackTarget(scored, [{ ...checked, sequence: `${scored.sequence}A` }]), scored);
  assert.equal(trackTarget(null, [checked]), null);
});
