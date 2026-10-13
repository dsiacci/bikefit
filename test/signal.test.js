import { test } from 'node:test';
import assert from 'node:assert/strict';
import { median, quantile, mad, fillGaps, resample, despike, lowpass, summarize, rng } from '../web/core/signal.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b}`);

test('median and quantiles ignore NaN', () => {
  assert.equal(median([3, NaN, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(quantile([1, 2, 3, 4, 5], 0.25), 2);
  close(mad([1, 1, 1, 1, 100]), 0, 1e-12);
});

test('short gaps are filled, long gaps and edges are not', () => {
  const out = fillGaps([NaN, 1, NaN, 3, NaN, NaN, NaN, 7, NaN], 2);
  assert.ok(Number.isNaN(out[0]));
  assert.equal(out[2], 2);
  assert.ok(Number.isNaN(out[4]) && Number.isNaN(out[6]));
  assert.ok(Number.isNaN(out[8]));
});

test('resampling interpolates and refuses to bridge long holes', () => {
  const t = [0, 0.1, 0.2, 1.0, 1.1];
  const v = [0, 1, 2, 10, 11];
  const out = resample(t, v, 0, 0.05, 23, 0.15);
  close(out[1], 0.5, 1e-12);
  close(out[4], 2, 1e-12);
  assert.ok(Number.isNaN(out[10]));
  close(out[21], 10.5, 1e-9);
});

test('a single spike is removed, a smooth curve is kept', () => {
  const v = Array.from({ length: 200 }, (_, i) => 100 * Math.sin(i / 10));
  v[50] += 80;
  const out = despike(v);
  assert.ok(Number.isNaN(out[50]));
  assert.equal(out.filter(Number.isNaN).length, 1);
});

test('zero-lag low-pass keeps a slow wave in phase and removes fast noise', () => {
  const fs = 60, n = 600;
  const slow = Array.from({ length: n }, (_, i) => Math.sin(2 * Math.PI * 1.5 * (i / fs)));
  const noisy = slow.map((s, i) => s + 0.3 * Math.sin(2 * Math.PI * 20 * (i / fs)));
  const out = lowpass(noisy, 6, fs);
  let err = 0;
  for (let i = 60; i < n - 60; i++) err = Math.max(err, Math.abs(out[i] - slow[i]));
  assert.ok(err < 0.03, `max error ${err}`);
});

test('the low-pass filters each finite run separately', () => {
  const v = [...Array(50).fill(1), NaN, ...Array(50).fill(5)];
  const out = lowpass(v, 6, 60);
  close(out[10], 1, 1e-9);
  assert.ok(Number.isNaN(out[50]));
  close(out[90], 5, 1e-9);
});

test('summaries are deterministic', () => {
  const rand = rng(3);
  const v = Array.from({ length: 80 }, () => 140 + 5 * rand());
  const a = summarize(v), b = summarize(v);
  assert.deepEqual(a, b);
  assert.ok(a.ci95[0] <= a.median && a.median <= a.ci95[1]);
});
