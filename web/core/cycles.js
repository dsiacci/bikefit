// From a regular-grid signal to pedal strokes: where the rider pedals steadily,
// which way the crank turns, and the time of every top and bottom dead centre.

import { median } from './signal.js';

/**
 * The longest stretch of steady pedalling, found on the vertical position of the
 * ankle: windows of `windowS` seconds whose autocorrelation has a clear peak at
 * a lag between 0.4 s and 1.5 s (40 to 150 rpm). Returns sample indices
 * {start, end} (end exclusive) and the cadence estimate, or null.
 */
export function steadyStretch(values, fs, { windowS = 4, hopS = 0.5, minPeak = 0.5 } = {}) {
  const win = Math.round(windowS * fs), hop = Math.max(1, Math.round(hopS * fs));
  const minLag = Math.round(0.4 * fs), maxLag = Math.round(1.5 * fs);
  const windows = [];
  for (let s = 0; s + win <= values.length; s += hop) {
    const seg = values.slice(s, s + win);
    const finite = seg.filter(Number.isFinite);
    if (finite.length < 0.8 * win) { windows.push(null); continue; }
    const mean = finite.reduce((a, b) => a + b, 0) / finite.length;
    let var0 = 0;
    for (const v of finite) var0 += (v - mean) ** 2;
    if (var0 <= 0) { windows.push(null); continue; }
    let bestLag = 0, bestR = -Infinity, prevR = Infinity, rising = false;
    for (let lag = minLag; lag <= Math.min(maxLag, win - 1); lag++) {
      let num = 0, cnt = 0;
      for (let i = 0; i + lag < win; i++) {
        const a = seg[i], b = seg[i + lag];
        if (Number.isFinite(a) && Number.isFinite(b)) { num += (a - mean) * (b - mean); cnt++; }
      }
      const r = cnt ? (num / cnt) / (var0 / finite.length) : -Infinity;
      // First local maximum above the threshold is the period.
      if (r > prevR) rising = true;
      if (rising && r < prevR && prevR >= minPeak && bestLag === 0) { bestLag = lag - 1; bestR = prevR; }
      prevR = r;
    }
    windows.push(bestLag ? { start: s, lag: bestLag, r: bestR, std: Math.sqrt(var0 / finite.length) } : null);
  }
  // Steady windows also need a real movement: at least a third of the typical amplitude.
  const typical = median(windows.filter(Boolean).map((w) => w.std));
  let best = null, cur = null;
  windows.forEach((w, k) => {
    const ok = w && w.std >= typical / 3;
    if (ok) {
      if (!cur) cur = { first: k, last: k };
      else cur.last = k;
      if (!best || cur.last - cur.first > best.last - best.first) best = { ...cur };
    } else cur = null;
  });
  if (!best) return null;
  // A window looks periodic as soon as most of it is pedalling, so keep the
  // span between the centres of the first and last periodic windows.
  const lags = windows.slice(best.first, best.last + 1).map((w) => w.lag);
  return {
    start: windows[best.first].start + Math.floor(win / 2),
    end: Math.min(values.length, windows[best.last].start + Math.ceil(win / 2) + 1),
    cadenceRpm: 60 / (median(lags) / fs),
  };
}

/**
 * Unwrapped crank angle in radians, 0 at top dead centre, growing as the rider
 * pedals forward, from pedal-axle positions around the bottom bracket (cx, cy).
 * The forward direction is read from the motion itself: the foot moves forward
 * over the top. `facing` is +1 when the rider faces the right of the image.
 */
export function crankAngle(px, py, cx, cy) {
  const n = px.length;
  const raw = new Float64Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(px[i]) && Number.isFinite(py[i])) raw[i] = Math.atan2(px[i] - cx, -(py[i] - cy));
  }
  // Net rotation with the "faces right" convention decides the facing.
  let net = 0, last = NaN;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(raw[i])) continue;
    if (Number.isFinite(last)) net += wrap(raw[i] - last);
    last = raw[i];
  }
  const facing = net >= 0 ? 1 : -1;
  const phi = new Float64Array(n).fill(NaN);
  let acc = NaN, prev = NaN;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(raw[i])) { prev = NaN; continue; }
    const a = facing * raw[i];
    if (!Number.isFinite(prev)) {
      // Restart after a gap: keep the turn count consistent with the last value.
      acc = Number.isFinite(acc) ? acc + wrap(a - wrapPositive(acc)) : a;
    } else acc += wrap(a - prev);
    phi[i] = acc;
    prev = a;
  }
  return { phi, facing };
}

function wrap(a) {
  return a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
}

function wrapPositive(a) {
  return a - 2 * Math.PI * Math.floor(a / (2 * Math.PI));
}

/** Fractional sample index where the increasing series `phi` crosses `level`, searching from `from`. */
function crossing(phi, level, from, to) {
  for (let i = Math.max(from, 0); i < to - 1; i++) {
    const a = phi[i], b = phi[i + 1];
    if (Number.isFinite(a) && Number.isFinite(b) && a < level && b >= level) return i + (level - a) / (b - a);
  }
  return NaN;
}

/**
 * Pedal strokes between consecutive top dead centres inside [start, end).
 * Each stroke: {i0, i1 (fractional indices of the two TDCs), bdc (fractional
 * index of the bottom dead centre), duration (s), cadence (rpm)}. Strokes whose
 * duration is more than `tolerance` away from the median are flagged.
 */
export function strokes(phi, fs, start, end, { tolerance = 0.2 } = {}) {
  const TAU = 2 * Math.PI;
  let first = NaN;
  for (let i = start; i < end; i++) if (Number.isFinite(phi[i])) { first = phi[i]; break; }
  if (!Number.isFinite(first)) return [];
  const out = [];
  let k = Math.ceil(first / TAU);
  let i0 = crossing(phi, k * TAU, start, end);
  while (Number.isFinite(i0)) {
    const iB = crossing(phi, k * TAU + Math.PI, Math.floor(i0), end);
    const i1 = crossing(phi, (k + 1) * TAU, Math.floor(i0) + 1, end);
    if (!Number.isFinite(i1)) break;
    const duration = (i1 - i0) / fs;
    out.push({ i0, i1, bdc: iB, duration, cadence: 60 / duration });
    i0 = i1;
    k++;
  }
  const typical = median(out.map((s) => s.duration));
  for (const s of out) s.regular = Math.abs(s.duration - typical) <= tolerance * typical && Number.isFinite(s.bdc);
  return out;
}
