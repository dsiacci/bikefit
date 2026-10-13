import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitCircle, robustCircle, findPedalAxle } from '../web/core/calibration.js';
import { rng } from '../web/core/signal.js';
import { pose, BASE } from './synth.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b}`);

test('circle fit recovers centre and radius from noisy points', () => {
  const rand = rng(11);
  const xs = [], ys = [];
  for (let i = 0; i < 500; i++) {
    const a = rand() * 2 * Math.PI;
    xs.push(300 + 100 * Math.cos(a) + 2 * (rand() - 0.5));
    ys.push(200 + 100 * Math.sin(a) + 2 * (rand() - 0.5));
  }
  const c = fitCircle(xs, ys);
  close(c.cx, 300, 0.3); close(c.cy, 200, 0.3); close(c.r, 100, 0.3);
});

test('robust circle fit ignores frames off the pedals', () => {
  const rand = rng(5);
  const xs = [], ys = [];
  for (let i = 0; i < 400; i++) {
    const a = rand() * 2 * Math.PI;
    xs.push(300 + 100 * Math.cos(a)); ys.push(200 + 100 * Math.sin(a));
  }
  for (let i = 0; i < 80; i++) { xs.push(600 + 50 * rand()); ys.push(500 + 50 * rand()); }
  const c = robustCircle(xs, ys);
  close(c.cx, 300, 0.5); close(c.cy, 200, 0.5); close(c.r, 100, 0.5);
});

test('the most circular point of the foot is the pedal axle, its radius the crank', () => {
  const p = { ...BASE };
  const foot = { heelX: [], heelY: [], toeX: [], toeY: [], ankleX: [], ankleY: [] };
  const rand = rng(2);
  const noise = () => 1.5 * (rand() - 0.5) * 2;
  for (let a = 0; a < 360 * 20; a += 3) {
    const q = pose(p, a % 360);
    // Image coordinates: x right, y down, 0.6 px per mm.
    const px = ([x, y]) => [900 + 0.6 * x + noise(), 860 - 0.6 * y + noise()];
    const h = px(q.heel), t = px(q.toe), k = px(q.ankle);
    foot.heelX.push(h[0]); foot.heelY.push(h[1]); foot.toeX.push(t[0]); foot.toeY.push(t[1]); foot.ankleX.push(k[0]); foot.ankleY.push(k[1]);
  }
  const axle = findPedalAxle(foot);
  close(axle.cx, 900, 2, 'centre x');
  close(axle.cy, 860, 2, 'centre y');
  close(axle.r, 0.6 * 170, 2, 'radius');
});
