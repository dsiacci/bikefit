// MediaPipe Pose Landmarker in the browser: the model and its WebAssembly
// runtime are served by this site (see tools/build.mjs), the video is read from
// the user's disk through an object URL, and every frame is drawn into the
// model and forgotten. Only the landmarks are kept.

import { FilesetResolver, PoseLandmarker } from './vendor/tasks-vision/vision_bundle.mjs';
import { frameTimes } from './mp4.js';

export const MODELS = {
  lite: './models/pose_landmarker_lite.task',
  full: './models/pose_landmarker_full.task',
  heavy: './models/pose_landmarker_heavy.task',
};

/** Load the runtime and one model variant. Tries the GPU, falls back to the CPU. */
export async function loadLandmarker({ variant = 'full', delegate = 'GPU' } = {}) {
  const fileset = await FilesetResolver.forVisionTasks(new URL('./vendor/tasks-vision/wasm', import.meta.url).href);
  const options = (d) => ({
    baseOptions: { modelAssetPath: MODELS[variant], delegate: d },
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    outputSegmentationMasks: false,
  });
  try {
    const landmarker = await PoseLandmarker.createFromOptions(fileset, options(delegate));
    return { landmarker, variant, delegate };
  } catch (err) {
    if (delegate !== 'GPU') throw err;
    const landmarker = await PoseLandmarker.createFromOptions(fileset, options('CPU'));
    return { landmarker, variant, delegate: 'CPU' };
  }
}

function once(target, event) {
  return new Promise((resolve, reject) => {
    const ok = () => { cleanup(); resolve(); };
    const ko = () => { cleanup(); reject(new Error('This video cannot be read by your browser. On an iPhone, set Camera, Formats to Most Compatible and film again.')); };
    const cleanup = () => { target.removeEventListener(event, ok); target.removeEventListener('error', ko); };
    target.addEventListener(event, ok, { once: true });
    target.addEventListener('error', ko, { once: true });
  });
}

/** Seek and wait until the frame at that time is ready. */
async function seekTo(video, t) {
  const seeked = once(video, 'seeked');
  video.currentTime = t;
  await seeked;
}

/**
 * The times to visit: every frame of the file when its boxes can be read (at
 * most 60 per second), otherwise a regular 30 per second. Each time is paired
 * with a seek target in the middle of the frame, safe from rounding.
 */
async function visitPlan(file, duration) {
  const times = await frameTimes(file).catch(() => null);
  const plan = [];
  if (times && times.length > 1) {
    let last = -Infinity;
    for (let i = 0; i < times.length; i++) {
      const t = times[i];
      if (t > duration + 1e-3) break;
      if (t - last < 1 / 60 - 1e-4) continue;
      const next = times[i + 1] ?? t + (times[i] - times[i - 1]);
      plan.push({ t, seek: Math.min(duration, (t + next) / 2) });
      last = t;
    }
    return { plan, exact: true };
  }
  for (let t = 0; t < duration; t += 1 / 30) plan.push({ t, seek: Math.min(duration, t + 1 / 60) });
  return { plan, exact: false };
}

// VIDEO mode wants increasing timestamps for the life of the landmarker, so a
// second video continues where the first one stopped.
let stampBase = 0;

/**
 * Run the landmarker on every frame of `file`. Each frame is drawn into a
 * canvas no larger than `maxSide` pixels (the model works on a 256-pixel crop
 * of the person anyway), handed to the model, and overwritten by the next.
 * Calls onFrame({index, t, duration, landmarks, video}) after each frame.
 * Returns {width, height, duration, exactTimes, frames: [{t, landmarks|null}]}
 * with landmarks normalized to the picture.
 */
export async function extractPoses(file, landmarker, { video, maxSide = 1280, onFrame, signal } = {}) {
  const url = URL.createObjectURL(file);
  const v = video ?? document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  const loaded = once(v, 'loadeddata');
  v.src = url;
  try {
    await loaded;
    const width = v.videoWidth, height = v.videoHeight, duration = v.duration;
    if (!width || !height || !Number.isFinite(duration)) throw new Error('This video has no readable picture.');
    const scale = Math.min(1, maxSide / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: false });
    const { plan, exact } = await visitPlan(file, duration);
    const frames = [];
    let stamp = stampBase;
    for (const step of plan) {
      if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
      await seekTo(v, step.seek);
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      stamp = Math.max(stamp + 1, stampBase + Math.round(step.t * 1000));
      const res = landmarker.detectForVideo(canvas, stamp);
      const landmarks = res.landmarks && res.landmarks[0]
        ? res.landmarks[0].map((p) => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility }))
        : null;
      frames.push({ t: step.t, landmarks });
      onFrame?.({ index: frames.length - 1, t: step.t, duration, landmarks, video: v, total: plan.length });
    }
    stampBase = stamp + 1000;
    return { width, height, duration, exactTimes: exact, frames };
  } finally {
    v.removeAttribute('src');
    v.load();
    URL.revokeObjectURL(url);
  }
}
