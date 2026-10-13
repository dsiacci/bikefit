// A synthetic rider seen from the side: a planar leg on a crank, a foot that
// tilts through the stroke, a still trunk and arm. It produces landmarks in the
// MediaPipe layout, with the true angles alongside, so the measurement can be
// checked against known answers. Lengths in millimetres, angles in degrees.

import { COUNT, STRIDE, SIDES } from '../web/core/landmarks.js';
import { includedAngle, inclination } from '../web/core/geometry.js';
import { rng } from '../web/core/signal.js';

export const BASE = {
  fps: 60,
  seconds: 70,
  cadence: 88, // rpm
  crank: 170,
  thigh: 440,
  shank: 430,
  hipFromBb: 780, // bottom bracket to hip joint, along the seat post
  seatAngle: 73,
  trunk: 520, // hip to shoulder
  trunkAngle: 45, // above horizontal
  upperArm: 300,
  forearm: 280,
  shoulderAngle: 85,
  elbowAngle: 155,
  footPitch: -12, // mean foot angle above horizontal, degrees
  footSwing: 8, // amplitude of the foot angle through the stroke
  // Foot frame: origin at the pedal axle, x from heel to toe, y up from the sole.
  ankleLocal: [-85, 85],
  heelLocal: [-180, 15],
  toeLocal: [90, 15],
  scale: 0.6, // pixels per millimetre
  width: 1920,
  height: 1080,
  bb: [900, 860], // bottom bracket in pixels
  facing: 1,
  noise: 0, // pixels, standard deviation
  swapRate: 0, // chance per frame of starting a run of swapped leg labels
  dropRate: 0, // chance per frame of no pose at all
  lead: 0, // seconds standing still before pedalling
  tail: 0, // seconds standing still after
  phase0: 0, // crank angle at the start, degrees
  seed: 1,
};

const rad = (d) => (d * Math.PI) / 180;

function rot([x, y], a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [c * x - s * y, s * x + c * y];
}

/** Positions (mm, x forward, y up, origin at the bottom bracket) for crank angle phi (deg, 0 at the top). */
export function pose(p, phiDeg) {
  const phi = rad(phiDeg);
  const axle = [p.crank * Math.sin(phi), p.crank * Math.cos(phi)];
  const psi = rad(p.footPitch + p.footSwing * Math.cos(phi - Math.PI / 2));
  const place = (local) => { const [x, y] = rot(local, psi); return [axle[0] + x, axle[1] + y]; };
  const ankle = place(p.ankleLocal), heel = place(p.heelLocal), toe = place(p.toeLocal);
  const hip = [-p.hipFromBb * Math.cos(rad(p.seatAngle)), p.hipFromBb * Math.sin(rad(p.seatAngle))];
  const dx = ankle[0] - hip[0], dy = ankle[1] - hip[1], d = Math.hypot(dx, dy);
  const c = Math.max(-1, Math.min(1, (p.thigh ** 2 + d * d - p.shank ** 2) / (2 * p.thigh * d)));
  const dir = Math.atan2(dy, dx) + Math.acos(c); // knee in front of the hip-ankle line
  const knee = [hip[0] + p.thigh * Math.cos(dir), hip[1] + p.thigh * Math.sin(dir)];
  const shoulder = [hip[0] + p.trunk * Math.cos(rad(p.trunkAngle)), hip[1] + p.trunk * Math.sin(rad(p.trunkAngle))];
  // Upper arm: from the shoulder-to-hip direction, turned forward by the shoulder angle.
  const down = Math.atan2(hip[1] - shoulder[1], hip[0] - shoulder[0]);
  const armDir = down + rad(p.shoulderAngle);
  const elbow = [shoulder[0] + p.upperArm * Math.cos(armDir), shoulder[1] + p.upperArm * Math.sin(armDir)];
  // The forearm continues the upper arm, turned up by (180 - elbow angle).
  const fd = armDir + (Math.PI - rad(p.elbowAngle));
  const wrist = [elbow[0] + p.forearm * Math.cos(fd), elbow[1] + p.forearm * Math.sin(fd)];
  const ear = [shoulder[0] + 120, shoulder[1] + 180];
  return { axle, ankle, heel, toe, hip, knee, shoulder, elbow, wrist, ear };
}

/** True angles at crank angle phi, from the noise-free positions. */
export function trueAngles(p, phiDeg) {
  const q = pose(p, phiDeg);
  return {
    knee: includedAngle(...q.hip, ...q.knee, ...q.ankle),
    hip: includedAngle(...q.shoulder, ...q.hip, ...q.knee),
    ankle: includedAngle(...q.knee, ...q.ankle, ...q.toe),
    trunk: inclination(q.hip[0], -q.hip[1], q.shoulder[0], -q.shoulder[1], 1),
    shoulder: includedAngle(...q.hip, ...q.shoulder, ...q.elbow),
    elbow: includedAngle(...q.shoulder, ...q.elbow, ...q.wrist),
  };
}

/** Ground truth for the stroke metrics, sampled every 0.1 degree of crank angle. */
export function truth(p) {
  const knee = [], ankle = [], hip = [];
  for (let a = 0; a < 360; a += 0.1) {
    const t = trueAngles(p, a);
    knee.push(t.knee); ankle.push(t.ankle); hip.push(t.hip);
  }
  const bdc = trueAngles(p, 180);
  return {
    kneeBdc: bdc.knee,
    kneeMaxExt: Math.max(...knee),
    kneeMin: Math.min(...knee),
    ankleRom: Math.max(...ankle) - Math.min(...ankle),
    ankleBdc: bdc.ankle,
    hipMin: Math.min(...hip),
    trunk: bdc.trunk,
    shoulder: bdc.shoulder,
    elbow: bdc.elbow,
  };
}

function gauss(rand) {
  const u = Math.max(rand(), 1e-12), v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * A PoseTrack of the synthetic rider. The near leg carries the labels of the
 * side facing the camera; the far leg is half a turn behind, slightly smaller
 * (further away) and less visible. Optional noise, label swaps and dropouts.
 */
export function makeTrack(overrides = {}) {
  const p = { ...BASE, ...overrides };
  const rand = rng(p.seed);
  const total = p.lead + p.seconds + p.tail;
  const n = Math.round(total * p.fps);
  const t = new Float64Array(n);
  const data = new Float32Array(n * COUNT * STRIDE).fill(NaN);
  const near = p.facing > 0 ? SIDES[1] : SIDES[0];
  const far = p.facing > 0 ? SIDES[0] : SIDES[1];
  const toPx = ([x, y], shrink = 1) => [
    p.bb[0] + p.facing * x * p.scale * shrink,
    p.bb[1] - y * p.scale * shrink,
  ];
  let swapLeft = 0;
  for (let f = 0; f < n; f++) {
    const time = f / p.fps;
    t[f] = time;
    if (rand() < p.dropRate) continue;
    const pedalTime = Math.min(Math.max(time - p.lead, 0), p.seconds);
    const phi = (p.phase0 + pedalTime * p.cadence * 6) % 360; // degrees; stands still before and after
    const qn = pose(p, phi), qf = pose(p, (phi + 180) % 360);
    if (swapLeft > 0) swapLeft--;
    else if (rand() < p.swapRate) swapLeft = 1 + Math.floor(rand() * 6);
    const [legNear, legFar] = swapLeft > 0 ? [far, near] : [near, far];
    const put = (idx, xy, z, vis) => {
      const o = (f * COUNT + idx) * STRIDE;
      data[o] = xy[0] + p.noise * gauss(rand);
      data[o + 1] = xy[1] + p.noise * gauss(rand);
      data[o + 2] = z;
      data[o + 3] = vis;
    };
    // Every landmark gets a value so frames look like MediaPipe output.
    for (let i = 0; i < COUNT; i++) put(i, toPx(qn.ear), 0, 0.9);
    for (const j of ['ear', 'shoulder', 'elbow', 'wrist']) {
      put(near[j], toPx(qn[j]), -0.05 * p.width, 0.95);
      put(far[j], toPx(qn[j], 0.98), 0.05 * p.width, 0.5);
    }
    for (const j of ['hip', 'knee', 'ankle', 'heel', 'toe']) {
      put(legNear[j], toPx(qn[j]), -0.05 * p.width, 0.95);
      put(legFar[j], toPx(qf[j], 0.98), 0.05 * p.width, 0.6);
    }
    put(0, toPx([qn.ear[0] + 60, qn.ear[1] - 20]), -0.05 * p.width, 0.95); // nose
  }
  return { track: { width: p.width, height: p.height, t, data }, params: p };
}
