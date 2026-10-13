// MediaPipe Pose Landmarker in the browser: the model and its WebAssembly
// runtime are served by this site (see tools/build.mjs), the video is read from
// the user's disk through an object URL, and every frame is drawn into the
// model and forgotten. Only the landmarks are kept.

import { FilesetResolver, PoseLandmarker } from './vendor/tasks-vision/vision_bundle.mjs';
import { frameTimes } from './mp4.js';
import { videoSamples } from './demux.js';

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

/** Draw a decoded frame upright: the track's rotation, as a <video> element would apply it. */
function drawRotated(ctx, frame, w, h, rotation) {
  if (!rotation) { ctx.drawImage(frame, 0, 0, w, h); return; }
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  const sideways = rotation === 90 || rotation === 270;
  const dw = sideways ? h : w, dh = sideways ? w : h;
  ctx.drawImage(frame, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
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
 * Decode the frames in order with WebCodecs and hand each to `handle(frame, t)`
 * in presentation order. Returns false when this browser or this file cannot be
 * decoded that way (the caller then seeks a <video> element instead).
 */
async function decodeInOrder(file, handle, { signal, onDemux } = {}) {
  if (typeof VideoDecoder === 'undefined' || typeof EncodedVideoChunk === 'undefined') return false;
  const demux = await videoSamples(file).catch(() => null);
  if (!demux || !demux.samples.length || !demux.samples[0].key) return false;
  const config = { codec: demux.codec, description: demux.description, codedWidth: demux.width, codedHeight: demux.height };
  const support = await VideoDecoder.isConfigSupported(config).catch(() => ({ supported: false }));
  if (!support.supported) return false;
  onDemux?.(demux);
  const ready = [];
  let failure = null;
  const decoder = new VideoDecoder({ output: (f) => ready.push(f), error: (e) => { failure = e; } });
  decoder.configure(config);
  const drain = async () => {
    while (ready.length) {
      const f = ready.shift();
      try { await handle(f, f.timestamp / 1e6); } finally { f.close(); }
    }
  };
  try {
    for (const s of demux.samples) {
      if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
      if (failure) throw failure;
      const data = new Uint8Array(await file.slice(s.offset, s.offset + s.size).arrayBuffer());
      decoder.decode(new EncodedVideoChunk({ type: s.key ? 'key' : 'delta', timestamp: Math.round(s.time * 1e6), data }));
      await drain();
      while (decoder.decodeQueueSize > 3 && !failure) { await new Promise((r) => setTimeout(r, 1)); await drain(); }
    }
    await decoder.flush();
    await drain();
    if (failure) throw failure;
  } finally {
    for (const f of ready) f.close();
    if (decoder.state !== 'closed') decoder.close();
  }
  return true;
}

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
    const frames = [];
    const timing = { seekMs: 0, drawMs: 0, detectMs: 0, decoder: 'webcodecs' };
    let stamp = stampBase;
    const detect = (t) => {
      stamp = Math.max(stamp + 1, stampBase + Math.round(t * 1000));
      const t0 = performance.now();
      const res = landmarker.detectForVideo(canvas, stamp);
      timing.detectMs += performance.now() - t0;
      const landmarks = res.landmarks && res.landmarks[0]
        ? res.landmarks[0].map((p) => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility }))
        : null;
      frames.push({ t, landmarks });
      return landmarks;
    };

    // First choice: decode every frame once, in order.
    let total = 0, last = -Infinity, rotation = 0;
    const decoded = await decodeInOrder(file, async (frame, t) => {
      if (t < 0 || t - last < 1 / 60 - 1e-4) return;
      last = t;
      const t1 = performance.now();
      drawRotated(ctx, frame, canvas.width, canvas.height, rotation);
      timing.drawMs += performance.now() - t1;
      const landmarks = detect(t);
      onFrame?.({ index: frames.length - 1, t, duration, landmarks, video: v, total });
      if (frames.length % 20 === 0) await new Promise((r) => setTimeout(r, 0)); // let the page repaint
    }, { signal, onDemux: (d) => { total = d.samples.length; rotation = d.rotation; } }).catch((err) => {
      if (err?.name === 'AbortError') throw err;
      frames.length = 0; // a decoding error: start again by seeking
      return false;
    });
    if (decoded && frames.length) {
      stampBase = stamp + 1000;
      return { width, height, duration, exactTimes: true, frames, timing };
    }

    // Otherwise: seek the <video> element frame by frame.
    timing.decoder = 'seek';
    const { plan, exact } = await visitPlan(file, duration);
    for (const step of plan) {
      if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
      let t0 = performance.now();
      await seekTo(v, step.seek);
      let t1 = performance.now();
      timing.seekMs += t1 - t0;
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      t0 = performance.now();
      timing.drawMs += t0 - t1;
      const landmarks = detect(step.t);
      onFrame?.({ index: frames.length - 1, t: step.t, duration, landmarks, video: v, total: plan.length });
    }
    stampBase = stamp + 1000;
    return { width, height, duration, exactTimes: exact, frames, timing };
  } finally {
    v.removeAttribute('src');
    v.load();
    URL.revokeObjectURL(url);
  }
}
