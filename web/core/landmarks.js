// MediaPipe Pose Landmarker returns 33 landmarks per person (BlazePose GHUM
// topology). In a side view the model sometimes swaps the left and right labels
// of the legs, so the leg nearest to the camera is tracked frame by frame
// instead of trusting the labels.

export const COUNT = 33;
export const STRIDE = 4; // x px, y px, z (same scale as x), visibility

export const NAMES = [
  'nose', 'left_eye_inner', 'left_eye', 'left_eye_outer', 'right_eye_inner', 'right_eye',
  'right_eye_outer', 'left_ear', 'right_ear', 'mouth_left', 'mouth_right', 'left_shoulder',
  'right_shoulder', 'left_elbow', 'right_elbow', 'left_wrist', 'right_wrist', 'left_pinky',
  'right_pinky', 'left_index', 'right_index', 'left_thumb', 'right_thumb', 'left_hip',
  'right_hip', 'left_knee', 'right_knee', 'left_ankle', 'right_ankle', 'left_heel',
  'right_heel', 'left_foot_index', 'right_foot_index',
];

export const SIDES = [
  { name: 'left', ear: 7, shoulder: 11, elbow: 13, wrist: 15, hip: 23, knee: 25, ankle: 27, heel: 29, toe: 31 },
  { name: 'right', ear: 8, shoulder: 12, elbow: 14, wrist: 16, hip: 24, knee: 26, ankle: 28, heel: 30, toe: 32 },
];

export const JOINTS = ['ear', 'shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle', 'heel', 'toe'];

/**
 * A pose track: per frame, 33 landmarks as (x px, y px, z, visibility).
 * Frames without a detected pose hold NaN.
 * @typedef {{width:number, height:number, t:Float64Array, data:Float32Array}} PoseTrack
 */

/** Build a track from MediaPipe results (normalized coordinates). */
export function trackFromResults(width, height, frames) {
  const n = frames.length;
  const t = new Float64Array(n);
  const data = new Float32Array(n * COUNT * STRIDE).fill(NaN);
  frames.forEach((fr, f) => {
    t[f] = fr.t;
    if (!fr.landmarks) return;
    fr.landmarks.forEach((p, i) => {
      const o = (f * COUNT + i) * STRIDE;
      data[o] = p.x * width;
      data[o + 1] = p.y * height;
      data[o + 2] = p.z * width;
      data[o + 3] = p.visibility ?? 1;
    });
  });
  return { width, height, t, data };
}

export function get(track, f, i, k) {
  return track.data[(f * COUNT + i) * STRIDE + k];
}

export function hasPose(track, f) {
  return Number.isFinite(track.data[f * COUNT * STRIDE]);
}

function medianOf(arr) {
  const a = arr.filter(Number.isFinite).sort((p, q) => p - q);
  if (!a.length) return NaN;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/**
 * Decide, frame by frame, which label set (0 = left, 1 = right) holds the leg
 * nearest to the camera. The model rarely swaps labels, but when it does the
 * near leg jumps to where the far leg was. So: the near label is the one the
 * model sees better and puts closer to the camera over the whole video; a frame
 * switches to the other label only when the usual one jumped away from the
 * previous near-leg position while the other one sits close to it. A frame where
 * both are far is a glitch. Returns Int8Array: 0 or 1, or -1 (no pose, glitch).
 */
export function nearLegLabels(track, { fps = 60 } = {}) {
  const n = track.t.length;
  const out = new Int8Array(n).fill(-1);
  const legJoints = ['knee', 'ankle', 'heel', 'toe'];
  const weights = { knee: 0.5, ankle: 1, heel: 1, toe: 1 };

  // Which label is the near leg overall: higher visibility, smaller depth.
  let vis = [0, 0], z = [0, 0], m = 0;
  for (let f = 0; f < n; f++) {
    if (!hasPose(track, f)) continue;
    for (const s of [0, 1]) for (const j of legJoints) {
      vis[s] += get(track, f, SIDES[s][j], 3) || 0;
      z[s] += get(track, f, SIDES[s][j], 2) || 0;
    }
    m++;
  }
  if (!m) return out;
  const votes = (vis[1] > vis[0] ? 1 : -1) + (z[1] < z[0] ? 1 : -1);
  const usual = votes > 0 ? 1 : votes < 0 ? 0 : (vis[1] > vis[0] ? 1 : 0);

  // Body scale: the median thigh length of the usual label. A foot moves a few
  // pixels per frame; the other foot is a whole crank diameter away.
  const thighs = [];
  for (let f = 0; f < n; f++) {
    if (!hasPose(track, f)) continue;
    const s = SIDES[usual];
    thighs.push(Math.hypot(get(track, f, s.hip, 0) - get(track, f, s.knee, 0), get(track, f, s.hip, 1) - get(track, f, s.knee, 1)));
  }
  const thigh = Number.isFinite(medianOf(thighs)) ? medianOf(thighs) : 200;
  const perFrame = thigh * 0.12 * Math.max(1, 60 / fps);

  const pos = (f, s) => legJoints.map((j) => [get(track, f, SIDES[s][j], 0), get(track, f, SIDES[s][j], 1)]);
  const quality = (f, s) => legJoints.reduce((acc, j) => acc + (get(track, f, SIDES[s][j], 3) || 0), 0);
  const depth = (f, s) => legJoints.reduce((acc, j) => acc + (get(track, f, SIDES[s][j], 2) || 0), 0);
  const cost = (a, b) => {
    let c = 0, w = 0;
    legJoints.forEach((j, k) => {
      const d = Math.hypot(a[k][0] - b[k][0], a[k][1] - b[k][1]);
      if (Number.isFinite(d)) { c += weights[j] * d; w += weights[j]; }
    });
    return w ? c / w : Infinity;
  };
  const segment = new Int32Array(n).fill(-1);
  let prev = null, prevFrame = -Infinity, seg = -1, suspicious = 0;
  for (let f = 0; f < n; f++) {
    if (!hasPose(track, f)) continue;
    const a = pos(f, usual), b = pos(f, 1 - usual);
    let label = usual;
    const gap = f - prevFrame;
    if (!prev || gap > Math.round(0.25 * fps)) {
      seg++;
    } else {
      const limit = perFrame * Math.min(gap, 6) + 0.05 * thigh;
      const ca = cost(a, prev), cb = cost(b, prev);
      if (ca <= limit) label = usual;
      else if (cb <= limit && cb < ca) label = 1 - usual; // the labels swapped for this frame
      else continue; // neither leg is where the near leg was: a glitch
    }
    // Following a leg that the model sees worse and places further away, for
    // several frames in a row, means we followed the wrong one: start again.
    const worse = quality(f, label) < quality(f, 1 - label) && depth(f, label) > depth(f, 1 - label);
    suspicious = worse ? suspicious + 1 : 0;
    if (suspicious > 5) { prev = null; suspicious = 0; continue; }
    out[f] = label;
    segment[f] = seg;
    prev = label === usual ? a : b;
    prevFrame = f;
  }

  // Each stretch must, on the whole, follow the better-seen, nearer leg.
  const stats = new Map();
  for (let f = 0; f < n; f++) {
    if (out[f] < 0) continue;
    const st = stats.get(segment[f]) ?? { better: 0, worse: 0 };
    if (quality(f, out[f]) >= quality(f, 1 - out[f]) || depth(f, out[f]) <= depth(f, 1 - out[f])) st.better++;
    else st.worse++;
    stats.set(segment[f], st);
  }
  for (let f = 0; f < n; f++) {
    if (out[f] < 0) continue;
    const st = stats.get(segment[f]);
    if (st.worse > st.better) out[f] = 1 - out[f];
  }
  return out;
}

/** Label set (0 or 1) of the arm nearest to the camera: the better-seen one overall. */
export function nearArmLabel(track) {
  const n = track.t.length;
  const score = [0, 1].map((s) => medianOf(range(n).flatMap((f) => ['elbow', 'wrist', 'shoulder'].map((j) => get(track, f, SIDES[s][j], 3)))));
  return score[1] > score[0] ? 1 : 0;
}

/**
 * Near-side joint series: for each joint, Float64Arrays x, y and visibility,
 * NaN where the frame has no usable near leg (legs and hip) or no pose.
 */
export function nearSeries(track, { fps = 60 } = {}) {
  const n = track.t.length;
  const legs = nearLegLabels(track, { fps });
  const arm = nearArmLabel(track);
  const series = {};
  for (const j of JOINTS) series[j] = { x: new Float64Array(n).fill(NaN), y: new Float64Array(n).fill(NaN), v: new Float64Array(n).fill(NaN) };
  const legSide = new Set(['hip', 'knee', 'ankle', 'heel', 'toe']);
  for (let f = 0; f < n; f++) {
    if (!hasPose(track, f)) continue;
    for (const j of JOINTS) {
      const s = legSide.has(j) ? legs[f] : arm;
      if (s < 0) continue;
      const i = SIDES[s][j];
      series[j].x[f] = get(track, f, i, 0);
      series[j].y[f] = get(track, f, i, 1);
      series[j].v[f] = get(track, f, i, 3);
    }
  }
  const nearLeg = countLabels(legs);
  return { series, legs, arm, nearLeg: nearLeg[1] > nearLeg[0] ? 'right' : 'left', swaps: countSwitches(legs) };
}

function countLabels(labels) {
  const c = [0, 0];
  for (const l of labels) if (l >= 0) c[l]++;
  return c;
}

function countSwitches(labels) {
  let last = -1, s = 0;
  for (const l of labels) {
    if (l < 0) continue;
    if (last >= 0 && l !== last) s++;
    last = l;
  }
  return s;
}

function range(n) {
  return Array.from({ length: n }, (_, i) => i);
}
