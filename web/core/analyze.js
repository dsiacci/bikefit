// The measurement, start to finish: landmarks per frame in, angles per pedal
// stroke, medians, the comparison with published ranges and the saddle change
// in millimetres out. The page and the experiment scripts both call analyze();
// there is no second implementation.

import { nearSeries } from './landmarks.js';
import { despike, resample, fillGaps, lowpass, median, summarize, at } from './signal.js';
import { findPedalAxle, axlePath, axisEllipse, robustCircle } from './calibration.js';
import { steadyStretch, crankAngle, strokes } from './cycles.js';
import {
  includedAngle, inclination, dist, saddleProjection, saddleChangeForKneeAngle, predictKneeChange,
} from './geometry.js';
import { RANGES, compareToRange } from './ranges.js';

export const VERSION = '0.1.0';

export const DEFAULTS = {
  minVisibility: 0.5, // landmarks the model is less sure of are dropped
  maxGapS: 0.12, // gaps up to this long are interpolated
  cutoffHz: 6, // zero-lag low-pass on landmark positions
  seatAngleDeg: 73, // seat post angle above horizontal, for the saddle projection
  crankMm: null, // crank length, gives the scale
  notchMm: null, // size of one saddle mark on the bike, if any
  maxCircleError: 0.08, // above this residual (share of the radius), the pedal axle is not trusted
  ranges: null, // published ranges to compare with; null means the list in ranges.js
};

// What the page shows, in the conventions of the published ranges: the knee and
// the elbow as a bend (0° is a straight limb), the other angles as defined in
// the README. `internal` values (included angles, 180° straight) feed the
// geometry and the experiments.
export const METRICS = [
  { key: 'kneeFlexBdc', label: 'Knee bend at the bottom of the stroke', unit: '°' },
  { key: 'kneeFlexMin', label: 'Knee bend, leg most extended', unit: '°' },
  { key: 'kneeFlexMax', label: 'Knee bend, leg most bent', unit: '°' },
  { key: 'hipClosed', label: 'Hip angle, most closed (trunk to thigh)', unit: '°' },
  { key: 'ankleRom', label: 'Ankle range of motion', unit: '°' },
  { key: 'trunk', label: 'Trunk angle above horizontal', unit: '°' },
  { key: 'shoulder', label: 'Shoulder angle (trunk to upper arm)', unit: '°' },
  { key: 'elbowFlex', label: 'Elbow bend', unit: '°' },
  { key: 'cadence', label: 'Cadence', unit: 'rpm' },
];

const INTERNAL = ['kneeBdc', 'kneeMaxExt', 'kneeMin', 'ankleBdc', 'hipMin', 'elbow'];

const JOINTS = ['ear', 'shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle', 'heel', 'toe'];

/** Frame rate of a track: the median interval between frames, rounded. */
export function frameRate(t) {
  const d = [];
  for (let i = 1; i < t.length; i++) if (t[i] > t[i - 1]) d.push(t[i] - t[i - 1]);
  return d.length ? 1 / median(d) : NaN;
}

/**
 * Clean the near-side landmark series and put them on a regular time grid:
 * low-confidence points out, spikes out, short gaps filled, zero-lag low-pass.
 */
export function cleanSeries(track, opts) {
  const fsNative = frameRate(track.t);
  const fs = Math.round(fsNative);
  const near = nearSeries(track, { fps: fs });
  let tFirst = NaN, tLast = NaN;
  for (let f = 0; f < track.t.length; f++) if (Number.isFinite(near.series.hip.x[f])) { tFirst = track.t[f]; break; }
  for (let f = track.t.length - 1; f >= 0; f--) if (Number.isFinite(near.series.hip.x[f])) { tLast = track.t[f]; break; }
  if (!Number.isFinite(tFirst) || !(tLast > tFirst)) return null;
  const count = Math.floor((tLast - tFirst) * fs) + 1;
  const maxGap = Math.round(opts.maxGapS * fs);
  const grid = {};
  for (const j of JOINTS) {
    grid[j] = {};
    for (const c of ['x', 'y']) {
      const raw = Float64Array.from(near.series[j][c], (v, f) => (near.series[j].v[f] >= opts.minVisibility ? v : NaN));
      const clean = despike(raw);
      const reg = fillGaps(resample(track.t, clean, tFirst, 1 / fs, count, 3 / fs), maxGap);
      grid[j][c] = lowpass(reg, Math.min(opts.cutoffHz, 0.4 * fs), fs);
    }
  }
  return { fs, fsNative, t0: tFirst, count, grid, nearLeg: near.nearLeg, labelSwitches: near.swaps };
}

function jointAt(grid, j, i) {
  return [at(grid[j].x, i), at(grid[j].y, i)];
}

function angleSeries(grid, count, facing) {
  const knee = new Float64Array(count), hip = new Float64Array(count), ankle = new Float64Array(count);
  const trunk = new Float64Array(count), shoulder = new Float64Array(count), elbow = new Float64Array(count);
  const thigh = new Float64Array(count), shank = new Float64Array(count), hipAnkle = new Float64Array(count);
  const g = grid;
  for (let i = 0; i < count; i++) {
    const H = [g.hip.x[i], g.hip.y[i]], K = [g.knee.x[i], g.knee.y[i]], A = [g.ankle.x[i], g.ankle.y[i]];
    const T = [g.toe.x[i], g.toe.y[i]], S = [g.shoulder.x[i], g.shoulder.y[i]];
    const E = [g.elbow.x[i], g.elbow.y[i]], W = [g.wrist.x[i], g.wrist.y[i]];
    knee[i] = includedAngle(...H, ...K, ...A);
    hip[i] = includedAngle(...S, ...H, ...K);
    ankle[i] = includedAngle(...K, ...A, ...T);
    trunk[i] = inclination(...H, ...S, facing);
    shoulder[i] = includedAngle(...H, ...S, ...E);
    elbow[i] = includedAngle(...S, ...E, ...W);
    thigh[i] = dist(...H, ...K);
    shank[i] = dist(...K, ...A);
    hipAnkle[i] = dist(...H, ...A);
  }
  return { knee, hip, ankle, trunk, shoulder, elbow, thigh, shank, hipAnkle };
}

function segmentValues(series, i0, i1) {
  const out = [];
  for (let i = Math.ceil(i0); i <= Math.floor(i1); i++) out.push(series[i]);
  return out;
}

function allFinite(list) {
  return list.length > 0 && list.every(Number.isFinite);
}

/** Fractional indices where phi reaches base + p * 2pi / (n - 1), p = 0..n-1, inside one stroke. */
function phaseIndices(phi, i0, i1, base, n) {
  const out = new Float64Array(n).fill(NaN);
  let i = Math.floor(i0);
  for (let p = 0; p < n; p++) {
    const level = base + (p * 2 * Math.PI) / (n - 1);
    while (i < Math.ceil(i1) && !(phi[i] <= level && phi[i + 1] >= level)) i++;
    if (i >= Math.ceil(i1)) break;
    const a = phi[i], b = phi[i + 1];
    out[p] = b > a ? i + (level - a) / (b - a) : i;
  }
  return out;
}

/**
 * Measure a pedalling video. `track` is a PoseTrack (see landmarks.js).
 * Throws an Error with a user-facing message when the video cannot be measured.
 */
export function analyze(track, settings = {}) {
  const opts = { ...DEFAULTS, ...settings };
  const clean = cleanSeries(track, opts);
  if (!clean) throw new Error('No rider was found in this video. Is the whole body in the frame, head included?');
  const { fs, grid, count } = clean;

  const stretch = steadyStretch(grid.ankle.y, fs);
  if (!stretch) throw new Error('No steady pedalling was found. The video needs at least 20 seconds of pedalling seen from the side.');

  // Pedal axle and crank circle, fitted on the steady stretch only.
  const foot = { heelX: [], heelY: [], toeX: [], toeY: [], ankleX: [], ankleY: [] };
  for (let i = stretch.start; i < stretch.end; i++) {
    const v = [grid.heel.x[i], grid.heel.y[i], grid.toe.x[i], grid.toe.y[i], grid.ankle.x[i], grid.ankle.y[i]];
    if (!v.every(Number.isFinite)) continue;
    foot.heelX.push(v[0]); foot.heelY.push(v[1]); foot.toeX.push(v[2]); foot.toeY.push(v[3]); foot.ankleX.push(v[4]); foot.ankleY.push(v[5]);
  }
  if (foot.heelX.length < 3 * fs) throw new Error('The feet are not seen well enough to find the pedals. Check the lighting and that both shoes are in the frame.');
  // The pedal axle is found when the shoe is fixed to the pedal (cleats). When
  // no point of the foot draws a circle (flat pedals, a foot that slides, blur),
  // the strokes are cut on the loop of the ankle instead and no millimetres are
  // given: a scale read from that loop would be a guess.
  let axle = findPedalAxle(foot);
  let method = 'pedal-axle';
  let path;
  if (axle && axle.score <= opts.maxCircleError && axle.u > -0.3 && axle.u < 0.8 && axle.s > -0.1 && axle.s < 1.1) {
    path = axlePath({
      heelX: grid.heel.x, heelY: grid.heel.y, toeX: grid.toe.x, toeY: grid.toe.y, ankleX: grid.ankle.x, ankleY: grid.ankle.y,
    }, axle.s, axle.u, axle.footLength);
  } else {
    const loop = robustCircle(foot.ankleX, foot.ankleY);
    if (!loop) throw new Error('The pedal stroke could not be followed from the feet. Check that the near foot is visible all the way round.');
    axle = { s: null, u: null, cx: loop.cx, cy: loop.cy, r: loop.r, score: loop.rms / loop.r, footLength: null };
    path = { x: grid.ankle.x, y: grid.ankle.y };
    method = 'ankle-loop';
  }
  const { phi, facing } = crankAngle(path.x, path.y, axle.cx, axle.cy);
  const steadyAxle = { x: [], y: [] };
  for (let i = stretch.start; i < stretch.end; i++) {
    if (Number.isFinite(path.x[i]) && Number.isFinite(path.y[i])) { steadyAxle.x.push(path.x[i]); steadyAxle.y.push(path.y[i]); }
  }
  const ellipse = axisEllipse(steadyAxle.x, steadyAxle.y);
  const all = strokes(phi, fs, stretch.start, stretch.end);
  const ang = angleSeries(grid, count, facing);

  // Per-stroke values.
  const perStroke = [];
  for (const s of all) {
    const knee = segmentValues(ang.knee, s.i0, s.i1);
    const hip = segmentValues(ang.hip, s.i0, s.i1);
    const ankle = segmentValues(ang.ankle, s.i0, s.i1);
    const upper = [segmentValues(ang.trunk, s.i0, s.i1), segmentValues(ang.shoulder, s.i0, s.i1), segmentValues(ang.elbow, s.i0, s.i1)];
    const radii = segmentValues(path.x, s.i0, s.i1).map((x, k) => Math.hypot(x - axle.cx, path.y[Math.ceil(s.i0) + k] - axle.cy) / axle.r);
    const band = method === 'pedal-axle' ? [0.8, 1.2] : [0.4, 1.8];
    const onCircle = radii.filter((r) => r > band[0] && r < band[1]).length / Math.max(1, radii.length);
    const valid = s.regular && allFinite(knee) && allFinite(hip) && allFinite(ankle) && knee.length >= 12 && onCircle >= 0.9;
    const row = {
      t0: clean.t0 + s.i0 / fs, t1: clean.t0 + s.i1 / fs, cadence: s.cadence, valid,
      kneeBdc: at(ang.knee, s.bdc),
      kneeMaxExt: Math.max(...knee),
      kneeMin: Math.min(...knee),
      ankleRom: Math.max(...ankle) - Math.min(...ankle),
      ankleBdc: at(ang.ankle, s.bdc),
      hipMin: Math.min(...hip),
      trunk: median(upper[0]),
      shoulder: median(upper[1]),
      elbow: median(upper[2]),
      kneeFlexBdc: 180 - at(ang.knee, s.bdc),
      kneeFlexMin: 180 - Math.max(...knee),
      kneeFlexMax: 180 - Math.min(...knee),
      hipClosed: Math.min(...hip),
      elbowFlex: 180 - median(upper[2]),
      thighPx: median(segmentValues(ang.thigh, s.i0, s.i1)),
      shankPx: median(segmentValues(ang.shank, s.i0, s.i1)),
      hipAnklePxBdc: at(ang.hipAnkle, s.bdc),
      hipAnkleTiltBdc: lineTiltFromVertical(grid, s.bdc, facing),
      hipBdc: jointAt(grid, 'hip', s.bdc),
    };
    perStroke.push(row);
  }
  const valid = perStroke.filter((r) => r.valid);
  if (valid.length < 10) throw new Error(`Only ${valid.length} clean pedal strokes were found; at least 10 are needed. Pedal steadily for a full minute, seen from the side.`);

  const summary = {};
  for (const key of [...METRICS.map((m) => m.key), ...INTERNAL]) summary[key] = summarize(valid.map((r) => r[key]));

  // Scale and leg geometry, from the medians over clean strokes.
  const mmPerPx = opts.crankMm && method === 'pedal-axle' ? opts.crankMm / axle.r : null;
  const T = median(valid.map((r) => r.thighPx));
  const S = median(valid.map((r) => r.shankPx));
  const tilt = median(valid.map((r) => r.hipAnkleTiltBdc));
  const projection = saddleProjection(opts.seatAngleDeg, tilt);

  const ranges = opts.ranges ?? RANGES;
  const comparisons = ranges.map((range) => compareToRange(range, summary[range.metric])).filter(Boolean);
  // The saddle range is a knee bend; the leg triangle works on the included
  // angle (180 minus the bend).
  const kneeRange = ranges.find((r) => r.metric === 'kneeFlexBdc' && r.useForSaddle);
  let saddle = null;
  if (kneeRange && mmPerPx) {
    const current = summary.kneeBdc.median;
    const change = (bend) => saddleChangeForKneeAngle({ T, S, currentDeg: current, targetDeg: 180 - bend, projection }) * mmPerPx;
    saddle = {
      range: [kneeRange.low, kneeRange.high],
      toLow: change(kneeRange.low),
      toHigh: change(kneeRange.high),
      toMiddle: change((kneeRange.low + kneeRange.high) / 2),
      notchMm: opts.notchMm || null,
      perDegreeMm: -change(180 - current + 1),
      source: kneeRange.source,
    };
    if (opts.notchMm) saddle.toMiddleNotches = saddle.toMiddle / opts.notchMm;
  }

  return {
    version: VERSION,
    video: { width: track.width, height: track.height, frames: track.t.length, fps: clean.fsNative, duration: track.t[track.t.length - 1] - track.t[0] },
    settings: opts,
    side: {
      facing: facing > 0 ? 'right' : 'left',
      toesPoint: median(Array.from({ length: count }, (_, i) => grid.toe.x[i] - grid.heel.x[i])) > 0 ? 'right' : 'left',
      nearLeg: clean.nearLeg,
      labelSwitches: clean.labelSwitches,
    },
    calibration: {
      method, bottomBracket: [axle.cx, axle.cy], crankPx: method === 'pedal-axle' ? axle.r : null, circleFit: axle.score, axleOffset: [axle.s, axle.u], mmPerPx,
      axisRatio: ellipse ? ellipse.ratio : null, cameraTurnDeg: ellipse ? ellipse.angleDeg : null,
    },
    warnings: [
      ...(method === 'ankle-loop' ? ['The pedal axle could not be located from the feet (no point of the shoe turns in a clean circle: flat pedals, a sliding foot or motion blur), so the strokes were cut on the ankle and no millimetres are given.'] : []),
      ...(method === 'pedal-axle' && axle.score > 0.04 ? ['The crank circle was found only roughly: millimetres are approximate.'] : []),
      ...(method === 'pedal-axle' && ellipse && ellipse.ratio < 0.94 ? [`The pedal path looks squeezed sideways: the camera may be turned about ${Math.round(ellipse.angleDeg)}° away from square, which distorts angles.`] : []),
      ...(clean.fsNative < 45 ? [`The video has ${Math.round(clean.fsNative)} frames per second; 60 gives finer measures at the bottom of the stroke.`] : []),
    ],
    steady: { start: clean.t0 + stretch.start / fs, end: clean.t0 + stretch.end / fs },
    strokes: { total: all.length, valid: valid.length },
    summary,
    perStroke,
    geometry: { thighToCrank: method === 'pedal-axle' ? T / axle.r : null, shankToCrank: method === 'pedal-axle' ? S / axle.r : null, hipAnkleTiltDeg: tilt, projection },
    comparisons,
    saddle,
    curves: phaseCurves(ang, phi, all, perStroke),
    loop: { ...representativeLoop(grid, phi, all, perStroke, axle, facing, ang, fs), method },
  };
}

/** Angle of the ankle-to-hip line from the vertical at fractional index i, positive when the hip is behind the ankle. */
function lineTiltFromVertical(grid, i, facing) {
  const [hx, hy] = jointAt(grid, 'hip', i), [ax, ay] = jointAt(grid, 'ankle', i);
  return (Math.atan2(-facing * (hx - ax), ay - hy) * 180) / Math.PI;
}

const CURVE_POINTS = 73; // every 5 degrees of crank angle

/** Median and quartiles of knee, hip and ankle angles against crank angle, over clean strokes. */
function phaseCurves(ang, phi, all, perStroke) {
  const rows = { knee: [], hip: [], ankle: [] };
  all.forEach((s, k) => {
    if (!perStroke[k].valid) return;
    const base = Math.floor(phi[Math.ceil(s.i0)] / (2 * Math.PI)) * 2 * Math.PI;
    const idx = phaseIndices(phi, s.i0, s.i1, base, CURVE_POINTS);
    for (const key of Object.keys(rows)) rows[key].push(Array.from(idx, (f) => at(ang[key], f)));
  });
  const out = { crankDeg: Array.from({ length: CURVE_POINTS }, (_, p) => (p * 360) / (CURVE_POINTS - 1)) };
  for (const key of Object.keys(rows)) {
    out[key] = { median: [], q1: [], q3: [] };
    for (let p = 0; p < CURVE_POINTS; p++) {
      const col = rows[key].map((r) => r[p]).filter(Number.isFinite);
      const s = summarize(col, { boot: 0 });
      out[key].median.push(s.median); out[key].q1.push(s.q1); out[key].q3.push(s.q3);
    }
  }
  // The knee as a bend (0° straight), the convention of the published ranges.
  out.kneeBend = { median: out.knee.median.map((v) => 180 - v), q1: out.knee.q3.map((v) => 180 - v), q3: out.knee.q1.map((v) => 180 - v) };
  return out;
}

/**
 * The clean stroke closest to the median knee curve, as a loop of near-side
 * joint positions in crank lengths around the bottom bracket, mirrored so that
 * the rider always faces right. Proportions only: no pixels, no millimetres.
 */
function representativeLoop(grid, phi, all, perStroke, axle, facing, ang, fs) {
  let best = null;
  const medKnee = median(perStroke.filter((r) => r.valid).map((r) => r.kneeBdc));
  all.forEach((s, k) => {
    if (!perStroke[k].valid) return;
    const d = Math.abs(perStroke[k].kneeBdc - medKnee);
    if (!best || d < best.d) best = { s, d };
  });
  if (!best) return null;
  const frames = [];
  const joints = ['ear', 'shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle', 'heel', 'toe'];
  for (let i = Math.ceil(best.s.i0); i <= Math.floor(best.s.i1); i++) {
    const fr = {};
    for (const j of joints) {
      const x = grid[j].x[i], y = grid[j].y[i];
      fr[j] = Number.isFinite(x) && Number.isFinite(y)
        ? [round3((facing * (x - axle.cx)) / axle.r), round3((y - axle.cy) / axle.r)]
        : null;
    }
    fr.crankDeg = round3((((phi[i] % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) * 180 / Math.PI);
    fr.kneeAngle = round3(ang.knee[i]);
    frames.push(fr);
  }
  return { frames, fps: fs };
}

function round3(v) {
  return Math.round(v * 1000) / 1000;
}

/**
 * The still pose of the reference measurement: the rider holds the crank at the
 * bottom without moving. Returns the median knee angle and the inclinations of
 * thigh and shank above the horizontal over the stillest stretch.
 */
export function analyzeStill(track, settings = {}) {
  const opts = { ...DEFAULTS, ...settings };
  const clean = cleanSeries(track, opts);
  if (!clean) throw new Error('No rider was found in this video.');
  const { fs, grid, count } = clean;
  // Stillness: over one second around each sample, knee and ankle stay within
  // 5% of the thigh length (landmark jitter is a pixel or two; pedalling moves
  // the ankle by a whole crank circle).
  const thigh = median(Array.from({ length: count }, (_, i) => dist(grid.hip.x[i], grid.hip.y[i], grid.knee.x[i], grid.knee.y[i])));
  const still = new Uint8Array(count);
  const half = Math.round(fs / 2);
  for (let i = half; i < count - half; i++) {
    let ok = true;
    for (const j of ['knee', 'ankle']) {
      for (const c of ['x', 'y']) {
        let lo = Infinity, hi = -Infinity;
        for (let k = i - half; k <= i + half; k++) {
          const v = grid[j][c][k];
          if (!Number.isFinite(v)) { lo = -Infinity; break; }
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
        if (!(hi - lo < 0.05 * thigh)) ok = false;
      }
    }
    still[i] = ok ? 1 : 0;
  }
  let best = null, start = -1;
  for (let i = 0; i <= count; i++) {
    if (i < count && still[i]) { if (start < 0) start = i; continue; }
    if (start >= 0 && (!best || i - start > best.end - best.start)) best = { start, end: i };
    start = -1;
  }
  if (!best || best.end - best.start < 2 * fs) throw new Error('No still stretch of at least 2 seconds was found.');
  const facingGuess = Math.sign(median(Array.from({ length: count }, (_, i) => grid.toe.x[i] - grid.heel.x[i]))) || 1;
  // Knee angle = thigh below the horizontal (towards the front) + shank angle
  // (ankle to knee) above the horizontal, measured from the front. A vertical
  // shank is 90; above 90 the knee is behind the ankle.
  const knee = [], thighInc = [], shankInc = [];
  for (let i = best.start; i < best.end; i++) {
    const H = [grid.hip.x[i], grid.hip.y[i]], K = [grid.knee.x[i], grid.knee.y[i]], A = [grid.ankle.x[i], grid.ankle.y[i]];
    knee.push(includedAngle(...H, ...K, ...A));
    thighInc.push(-inclination(...H, ...K, facingGuess));
    shankInc.push(inclination(...A, ...K, facingGuess));
  }
  return {
    version: VERSION,
    still: { start: clean.t0 + best.start / fs, end: clean.t0 + best.end / fs },
    knee: summarize(knee, { boot: 0 }),
    kneeBend: summarize(knee.map((v) => 180 - v), { boot: 0 }),
    thighBelowHorizontal: summarize(thighInc, { boot: 0 }),
    shankAboveHorizontalFront: summarize(shankInc, { boot: 0 }),
    facing: facingGuess > 0 ? 'right' : 'left',
  };
}

export { predictKneeChange };
