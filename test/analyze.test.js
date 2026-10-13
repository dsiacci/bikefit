import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, predictKneeChange } from '../web/core/analyze.js';
import { makeTrack, truth, BASE } from './synth.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''}: ${a} vs ${b}`);

// Test fixture only, not a published range: lets the saddle arithmetic run.
const FIXTURE_RANGE = { metric: 'kneeFlexBdc', low: 30, high: 40, kind: 'dynamic', evidence: 'peer-reviewed', useForSaddle: true, source: { short: 'test fixture' } };

test('clean synthetic rider: every angle within half a degree of the truth', () => {
  const { track, params } = makeTrack({ seconds: 50 });
  const r = analyze(track, { crankMm: 170 });
  const want = truth(params);
  for (const key of ['kneeBdc', 'kneeMaxExt', 'kneeMin', 'ankleRom', 'ankleBdc', 'hipMin', 'trunk', 'shoulder', 'elbow']) {
    close(r.summary[key].median, want[key], 0.5, key);
  }
  close(r.summary.cadence.median, params.cadence, 0.5, 'cadence');
  close(r.calibration.crankPx, params.crank * params.scale, 1, 'crank in pixels');
  close(r.calibration.mmPerPx, 1 / params.scale, 0.02, 'mm per pixel');
  close(r.summary.kneeFlexBdc.median, 180 - want.kneeBdc, 0.5, 'knee bend at BDC');
  close(r.summary.elbowFlex.median, 180 - want.elbow, 0.5, 'elbow bend');
  assert.equal(r.side.facing, 'right');
  assert.equal(r.side.toesPoint, 'right');
});

test('noise, label swaps, dropouts and getting on and off the bike', () => {
  const { track, params } = makeTrack({ seconds: 60, noise: 2.5, swapRate: 0.02, dropRate: 0.02, lead: 6, tail: 5, seed: 4 });
  const r = analyze(track, { crankMm: 170 });
  const want = truth(params);
  close(r.summary.kneeBdc.median, want.kneeBdc, 1, 'knee at BDC');
  close(r.summary.kneeMin.median, want.kneeMin, 1.5, 'knee most bent');
  close(r.summary.hipMin.median, want.hipMin, 1.5, 'hip most closed');
  close(r.summary.trunk.median, want.trunk, 1, 'trunk');
  close(r.calibration.crankPx, params.crank * params.scale, 3, 'crank in pixels');
  assert.ok(r.strokes.valid >= 60, `valid strokes ${r.strokes.valid}`);
  assert.ok(r.steady.start >= 5 && r.steady.end <= 67, `steady stretch ${r.steady.start}-${r.steady.end}`);
});

test('a rider facing left gives the same angles', () => {
  const right = analyze(makeTrack({ seconds: 40 }).track, { crankMm: 170 });
  const left = analyze(makeTrack({ seconds: 40, facing: -1, bb: [1000, 860] }).track, { crankMm: 170 });
  assert.equal(left.side.facing, 'left');
  for (const key of ['kneeBdc', 'hipMin', 'trunk', 'elbow']) close(left.summary[key].median, right.summary[key].median, 0.3, key);
});

test('raising the saddle by 10 mm: measured change matches the leg-triangle prediction', () => {
  const before = analyze(makeTrack({ seconds: 40, noise: 1.5, seed: 8 }).track, { crankMm: 170 });
  const after = analyze(makeTrack({ seconds: 40, noise: 1.5, seed: 9, hipFromBb: BASE.hipFromBb + 10 }).track, { crankMm: 170 });
  const measured = after.summary.kneeBdc.median - before.summary.kneeBdc.median;
  const mm = before.calibration.mmPerPx;
  const T = before.geometry.thighToCrank * 170, S = before.geometry.shankToCrank * 170;
  const d = before.perStroke.filter((s) => s.valid).map((s) => s.hipAnklePxBdc * mm).sort((a, b) => a - b);
  const predicted = predictKneeChange({ T, S, d: d[d.length >> 1], deltaSaddle: 10, projection: before.geometry.projection });
  assert.ok(measured > 2, `measured ${measured}`);
  close(measured, predicted, 0.4, 'measured vs predicted');
});

test('the suggested saddle change brings the knee to the middle of the range', () => {
  const low = analyze(makeTrack({ seconds: 40, hipFromBb: BASE.hipFromBb - 25 }).track, { crankMm: 170, ranges: [FIXTURE_RANGE] });
  assert.ok(low.saddle.toMiddle > 0, 'saddle too low: raise it');
  const fixed = analyze(makeTrack({ seconds: 40, hipFromBb: BASE.hipFromBb - 25 + low.saddle.toMiddle }).track, { crankMm: 170, ranges: [FIXTURE_RANGE] });
  close(fixed.summary.kneeBdc.median, 145, 0.6, 'knee after the suggested change');
  assert.equal(low.comparisons[0].verdict, 'above'); // saddle low: the knee stays more bent
});

test('a foot sliding on a flat pedal: strokes from the ankle loop, no millimetres', () => {
  const { track, params } = makeTrack({ seconds: 40, noise: 1.5, slide: 70, seed: 12 });
  const r = analyze(track, { crankMm: 170, ranges: [FIXTURE_RANGE] });
  assert.equal(r.calibration.method, 'ankle-loop');
  assert.equal(r.calibration.mmPerPx, null);
  assert.equal(r.saddle, null);
  assert.ok(r.warnings.some((w) => w.includes('no millimetres')));
  const want = truth(params);
  close(r.summary.kneeFlexMin.median, 180 - want.kneeMaxExt, 1.5, 'knee most extended');
  close(r.summary.kneeFlexMax.median, 180 - want.kneeMin, 1.5, 'knee most bent');
  close(r.summary.kneeFlexBdc.median, 180 - want.kneeBdc, 3, 'knee at the bottom (phase from the ankle)');
});
