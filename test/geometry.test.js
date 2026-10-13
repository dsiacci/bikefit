import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  includedAngle, inclination, kneeAngleFromDistance, distanceFromKneeAngle, saddleProjection,
  predictKneeChange, saddleChangeForKneeAngle,
} from '../web/core/geometry.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b}`);

test('included angle of a right angle and a straight line', () => {
  close(includedAngle(0, 0, 1, 0, 1, 1), 90, 1e-9);
  close(includedAngle(0, 0, 1, 1, 2, 2), 180, 1e-6);
  assert.ok(Number.isNaN(includedAngle(1, 1, 1, 1, 2, 2)));
});

test('inclination is measured towards the front, in image coordinates', () => {
  // Shoulder up and to the right of the hip, rider facing right: 45 degrees.
  close(inclination(0, 100, 100, 0, 1), 45, 1e-9);
  // Same pixels, rider facing left: the shoulder is behind the hip.
  close(inclination(0, 100, 100, 0, -1), 135, 1e-9);
});

test('law of cosines round trip', () => {
  const T = 440, S = 430;
  for (const a of [60, 100, 140, 150, 170]) close(kneeAngleFromDistance(T, S, distanceFromKneeAngle(T, S, a)), a, 1e-9);
});

test('saddle projection is sin(seat + line)', () => {
  close(saddleProjection(73, 17), 1, 1e-12);
  close(saddleProjection(73, 0), Math.sin((73 * Math.PI) / 180), 1e-12);
});

test('raising the saddle opens the knee by a few degrees per centimetre', () => {
  const T = 440, S = 430, d = distanceFromKneeAngle(T, S, 145);
  const change = predictKneeChange({ T, S, d, deltaSaddle: 10 });
  assert.ok(change > 3 && change < 6, `got ${change}`);
  // And the inverse gives back the same 10 mm.
  close(saddleChangeForKneeAngle({ T, S, currentDeg: 145, targetDeg: 145 + change }), 10, 1e-9);
});
