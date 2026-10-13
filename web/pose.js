// MediaPipe Pose Landmarker in the browser: the model and its WebAssembly
// runtime are served by this site (see tools/build.mjs), the video is read from
// the user's disk through an object URL, and every frame is drawn into the
// model and forgotten. Only the landmarks are kept.

import { FilesetResolver, PoseLandmarker } from './vendor/tasks-vision/vision_bundle.mjs';

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

/** Seek and resolve with the presentation time of the frame now shown. */
async function seekTo(video, t) {
  const seeked = once(video, 'seeked');
  video.currentTime = t;
  await seeked;
  if (!('requestVideoFrameCallback' in HTMLVideoElement.prototype)) return video.currentTime;
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; resolve(video.currentTime); } }, 250);
    video.requestVideoFrameCallback((now, meta) => {
      if (done) return;
      done = true; clearTimeout(timer); resolve(meta.mediaTime);
    });
  });
}

// VIDEO mode wants increasing timestamps for the life of the landmarker, so a
// second video continues where the first one stopped.
let stampBase = 0;

/**
 * Run the landmarker on every frame of `file`, stepping `step` seconds (1/60 by
 * default; frames repeated in slower videos are skipped). Calls
 * onFrame({index, t, duration, landmarks, video}) after each frame. Returns
 * {width, height, frames: [{t, landmarks|null}]} with normalized landmarks.
 */
export async function extractPoses(file, landmarker, { video, step = 1 / 60, onFrame, signal } = {}) {
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
    const frames = [];
    let lastTime = -1, stamp = stampBase;
    for (let k = 0; k * step < duration - step / 2; k++) {
      if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
      const t = await seekTo(v, Math.min(duration, k * step + step / 2));
      if (t === lastTime) continue;
      lastTime = t;
      stamp = Math.max(stamp + 1, stampBase + Math.round(t * 1000));
      const res = landmarker.detectForVideo(v, stamp);
      const landmarks = res.landmarks && res.landmarks[0]
        ? res.landmarks[0].map((p) => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility }))
        : null;
      frames.push({ t, landmarks });
      onFrame?.({ index: frames.length - 1, t, duration, landmarks, video: v });
    }
    stampBase = stamp + 1000;
    return { width, height, duration, frames };
  } finally {
    v.removeAttribute('src');
    v.load();
    URL.revokeObjectURL(url);
  }
}
