// One-dimensional signal tools for landmark time series. Missing samples are NaN
// everywhere; nothing here touches the DOM, so the same code runs in the page and
// in Node for the tests and experiments.

export function median(values) {
  const a = Array.from(values).filter(Number.isFinite).sort((p, q) => p - q);
  if (a.length === 0) return NaN;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** Quantile with linear interpolation between order statistics (type 7). */
export function quantile(values, q) {
  const a = Array.from(values).filter(Number.isFinite).sort((p, q2) => p - q2);
  if (a.length === 0) return NaN;
  const h = (a.length - 1) * q;
  const lo = Math.floor(h), hi = Math.ceil(h);
  return a[lo] + (a[hi] - a[lo]) * (h - lo);
}

/** Median absolute deviation, scaled to match a standard deviation for normal data. */
export function mad(values) {
  const m = median(values);
  return 1.4826 * median(Array.from(values, (v) => Math.abs(v - m)));
}

/**
 * Fill runs of NaN no longer than `maxGap` samples by linear interpolation.
 * Leading and trailing NaN and longer gaps stay NaN.
 */
export function fillGaps(values, maxGap) {
  const out = Float64Array.from(values);
  const n = out.length;
  let i = 0;
  while (i < n) {
    if (Number.isFinite(out[i])) { i++; continue; }
    let j = i;
    while (j < n && !Number.isFinite(out[j])) j++;
    const len = j - i;
    if (i > 0 && j < n && len <= maxGap) {
      const a = out[i - 1], b = out[j];
      for (let k = i; k < j; k++) out[k] = a + ((b - a) * (k - i + 1)) / (len + 1);
    }
    i = j;
  }
  return out;
}

/**
 * Sample (t, values) on the regular grid t0, t0 + dt, ... by linear
 * interpolation. A grid point between two samples further apart than
 * `maxSpan` seconds is NaN, as is any point next to a NaN sample.
 */
export function resample(t, values, t0, dt, count, maxSpan = Infinity) {
  const out = new Float64Array(count).fill(NaN);
  let j = 0;
  for (let k = 0; k < count; k++) {
    const tk = t0 + k * dt;
    while (j < t.length - 2 && t[j + 1] < tk) j++;
    if (tk < t[0] || tk > t[t.length - 1]) continue;
    const t1 = t[j], t2 = t[j + 1] ?? t1;
    const v1 = values[j], v2 = values[j + 1] ?? v1;
    if (tk === t1) { out[k] = v1; continue; }
    if (t2 - t1 > maxSpan || !Number.isFinite(v1) || !Number.isFinite(v2)) continue;
    out[k] = t2 === t1 ? v1 : v1 + ((v2 - v1) * (tk - t1)) / (t2 - t1);
  }
  return out;
}

/**
 * Mark isolated spikes as NaN: a sample further than max(k * sigma, floor)
 * from the median of its neighbours (up to `half` on each side, the same
 * number on both sides so that a steady slope leaves no residual), where sigma
 * is the robust spread of those residuals over the whole series. Two passes:
 * the second ignores neighbours flagged by the first, so that a spike does not
 * get its neighbours flagged too. The first and last samples are never flagged.
 */
export function despike(values, { half = 2, k = 6, floor = 8 } = {}) {
  const n = values.length;
  const residuals = (skip) => {
    const resid = new Float64Array(n).fill(NaN);
    const win = [];
    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(values[i])) continue;
      const h = Math.min(half, i, n - 1 - i);
      win.length = 0;
      for (let j = i - h; j <= i + h; j++) {
        if (j !== i && Number.isFinite(values[j]) && !(skip && skip[j])) win.push(values[j]);
      }
      if (win.length >= 2) resid[i] = values[i] - median(win);
    }
    return resid;
  };
  const first = residuals(null);
  const sigma = mad(first);
  const limit = Math.max(k * (Number.isFinite(sigma) ? sigma : 0), floor);
  const flagged = Uint8Array.from(first, (r) => (Math.abs(r) > limit ? 1 : 0));
  const second = residuals(flagged);
  const out = Float64Array.from(values);
  for (let i = 0; i < n; i++) if (flagged[i] && Math.abs(second[i]) > limit) out[i] = NaN;
  return out;
}

/**
 * Second-order Butterworth low-pass section (bilinear transform with
 * pre-warping), as coefficients for y[n] = b0 x[n] + b1 x[n-1] + b2 x[n-2]
 * - a1 y[n-1] - a2 y[n-2].
 */
export function butter2(cutoffHz, sampleHz) {
  const K = Math.tan((Math.PI * cutoffHz) / sampleHz);
  const norm = 1 / (1 + Math.SQRT2 * K + K * K);
  const b0 = K * K * norm;
  return { b0, b1: 2 * b0, b2: b0, a1: 2 * (K * K - 1) * norm, a2: (1 - Math.SQRT2 * K + K * K) * norm };
}

function biquad(c, x) {
  const y = new Float64Array(x.length);
  // Start from the steady state of a constant input equal to x[0].
  const g = (c.b0 + c.b1 + c.b2) / (1 + c.a1 + c.a2);
  let z2 = (c.b2 - c.a2 * g) * x[0];
  let z1 = (c.b1 - c.a1 * g) * x[0] + z2;
  for (let n = 0; n < x.length; n++) {
    const yn = c.b0 * x[n] + z1;
    z1 = c.b1 * x[n] - c.a1 * yn + z2;
    z2 = c.b2 * x[n] - c.a2 * yn;
    y[n] = yn;
  }
  return y;
}

/**
 * Zero-lag low-pass filter: a second-order Butterworth run forwards then
 * backwards (fourth order overall), with the cutoff corrected for the double
 * pass so that the -3 dB point stays at `cutoffHz` (Winter's correction,
 * factor 0.802). The ends are padded with an odd reflection. NaN runs split
 * the series: each finite run is filtered on its own.
 */
export function lowpass(values, cutoffHz, sampleHz) {
  const out = new Float64Array(values.length).fill(NaN);
  const design = Math.min(cutoffHz / 0.802, 0.45 * sampleHz);
  const c = butter2(design, sampleHz);
  let i = 0;
  while (i < values.length) {
    if (!Number.isFinite(values[i])) { i++; continue; }
    let j = i;
    while (j < values.length && Number.isFinite(values[j])) j++;
    const run = values.slice(i, j);
    const filtered = run.length >= 4 ? filterRun(run, c, sampleHz / cutoffHz) : run;
    out.set(filtered, i);
    i = j;
  }
  return out;
}

function filterRun(run, c, samplesPerCutoffPeriod) {
  const n = run.length;
  const pad = Math.min(n - 1, Math.ceil(3 * samplesPerCutoffPeriod));
  const ext = new Float64Array(n + 2 * pad);
  for (let k = 0; k < pad; k++) {
    ext[k] = 2 * run[0] - run[pad - k];
    ext[n + pad + k] = 2 * run[n - 1] - run[n - 2 - k];
  }
  ext.set(run, pad);
  const forward = biquad(c, ext);
  forward.reverse();
  const back = biquad(c, forward);
  back.reverse();
  return back.subarray(pad, pad + n);
}

/** Linear interpolation of a series sampled on a regular grid at fractional index `f`. */
export function at(values, f) {
  if (!(f >= 0 && f <= values.length - 1)) return NaN;
  const i = Math.floor(f), w = f - i;
  if (w === 0) return values[i];
  return values[i] * (1 - w) + values[i + 1] * w;
}

/** Deterministic pseudo-random numbers in [0, 1) (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Median, quartiles and a percentile bootstrap 95% interval of the median.
 * The bootstrap uses a fixed seed so that the same input always gives the
 * same interval.
 */
export function summarize(values, { boot = 2000, seed = 7 } = {}) {
  const a = Array.from(values).filter(Number.isFinite);
  const n = a.length;
  if (n === 0) return { n: 0, median: NaN, q1: NaN, q3: NaN, ci95: [NaN, NaN] };
  const rand = rng(seed);
  const meds = new Float64Array(boot);
  const sample = new Float64Array(n);
  for (let b = 0; b < boot; b++) {
    for (let k = 0; k < n; k++) sample[k] = a[Math.floor(rand() * n)];
    meds[b] = median(sample);
  }
  return {
    n,
    median: median(a),
    q1: quantile(a, 0.25),
    q3: quantile(a, 0.75),
    ci95: [quantile(meds, 0.025), quantile(meds, 0.975)],
  };
}
