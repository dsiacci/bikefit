// Drawing the rider as a skeleton on a plain background. The video picture is
// never drawn unless the user asks for it.

const CONNECTIONS = [
  [11, 12], [11, 23], [12, 24], [23, 24], // trunk
  [11, 13], [13, 15], [12, 14], [14, 16], // arms
  [23, 25], [25, 27], [27, 29], [29, 31], [27, 31], // left leg and foot
  [24, 26], [26, 28], [28, 30], [30, 32], [28, 32], // right leg and foot
];

function palette(canvas) {
  const css = getComputedStyle(canvas);
  const v = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
  return {
    ground: v('--canvas', '#f4f6f6'),
    bone: v('--bone', '#1d2b33'),
    faint: v('--bone-faint', 'rgba(29,43,51,0.35)'),
    accent: v('--accent', '#2a78d6'),
    arc: v('--arc', '#c26a00'),
    grid: v('--grid', '#d6dddf'),
    ink: v('--ink', '#14212a'),
  };
}

function fit(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

/** Live view while measuring: all 33 landmarks of the current frame, normalized coordinates. */
export function drawPreview(canvas, landmarks, { video = null, showFrame = false, aspect = 16 / 9 } = {}) {
  const { ctx, w, h } = fit(canvas);
  const c = palette(canvas);
  ctx.fillStyle = c.ground;
  ctx.fillRect(0, 0, w, h);
  // Letterbox the video's aspect ratio inside the canvas.
  let bw = w, bh = w / aspect;
  if (bh > h) { bh = h; bw = h * aspect; }
  const ox = (w - bw) / 2, oy = (h - bh) / 2;
  if (showFrame && video) ctx.drawImage(video, ox, oy, bw, bh);
  if (!landmarks) return;
  ctx.lineCap = 'round';
  ctx.lineWidth = 3;
  for (const [a, b] of CONNECTIONS) {
    const p = landmarks[a], q = landmarks[b];
    const vis = Math.min(p.visibility ?? 1, q.visibility ?? 1);
    ctx.strokeStyle = vis > 0.6 ? c.bone : c.faint;
    ctx.beginPath();
    ctx.moveTo(ox + p.x * bw, oy + p.y * bh);
    ctx.lineTo(ox + q.x * bw, oy + q.y * bh);
    ctx.stroke();
  }
  const head = landmarks[0];
  ctx.fillStyle = c.bone;
  ctx.beginPath();
  ctx.arc(ox + head.x * bw, oy + head.y * bh, 6, 0, 2 * Math.PI);
  ctx.fill();
}

/**
 * One pedal stroke on a loop. `loop.frames[i]` holds near-side joints in crank
 * lengths around the bottom bracket (rider facing right) and the crank angle.
 */
export function drawLoopFrame(canvas, loop, i, { showArc = true } = {}) {
  const { ctx, w, h } = fit(canvas);
  const c = palette(canvas);
  const frames = loop.frames;
  const fr = frames[i % frames.length];
  // Bounds over the whole loop, crank circle included, so the drawing stays still.
  if (!loop.bounds) {
    let x0 = -1.2, x1 = 1.2, y0 = -1.2, y1 = 1.2;
    for (const f of frames) for (const k of ['ear', 'shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle', 'heel', 'toe']) {
      const p = f[k];
      if (!p) continue;
      x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
    }
    loop.bounds = { x0: x0 - 0.8, x1: x1 + 0.8, y0: y0 - 0.9, y1: y1 + 0.5 };
  }
  const b = loop.bounds;
  const s = Math.min(w / (b.x1 - b.x0), h / (b.y1 - b.y0));
  const ox = (w - s * (b.x1 - b.x0)) / 2 - s * b.x0, oy = (h - s * (b.y1 - b.y0)) / 2 - s * b.y0;
  const P = (p) => [ox + s * p[0], oy + s * p[1]];

  ctx.fillStyle = c.ground;
  ctx.fillRect(0, 0, w, h);
  // Crank circle and crank arm, when the pedal axle was found.
  ctx.lineCap = 'round';
  if (loop.method !== 'ankle-loop') {
    const [bx, by] = P([0, 0]);
    ctx.strokeStyle = c.grid;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(bx, by, s, 0, 2 * Math.PI); ctx.stroke();
    const a = (fr.crankDeg * Math.PI) / 180;
    const axle = P([Math.sin(a), -Math.cos(a)]);
    ctx.strokeStyle = c.faint;
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(...axle); ctx.stroke();
  }

  const line = (...keys) => {
    const pts = keys.map((k) => fr[k]).filter(Boolean).map(P);
    if (pts.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(...pts[0]);
    for (const p of pts.slice(1)) ctx.lineTo(...p);
    ctx.stroke();
  };
  ctx.strokeStyle = c.bone;
  ctx.lineWidth = 5;
  ctx.lineJoin = 'round';
  line('shoulder', 'hip');
  line('shoulder', 'elbow', 'wrist');
  line('hip', 'knee', 'ankle');
  line('ankle', 'heel', 'toe', 'ankle');
  if (fr.ear) {
    const [ex, ey] = P(fr.ear);
    ctx.fillStyle = c.bone;
    ctx.beginPath(); ctx.arc(ex, ey, 0.32 * s, 0, 2 * Math.PI); ctx.fill();
  }
  for (const k of ['shoulder', 'elbow', 'hip', 'knee', 'ankle']) {
    if (!fr[k]) continue;
    const [x, y] = P(fr[k]);
    ctx.fillStyle = c.ground;
    ctx.beginPath(); ctx.arc(x, y, 5, 0, 2 * Math.PI); ctx.fill();
    ctx.strokeStyle = c.bone; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, 5, 0, 2 * Math.PI); ctx.stroke();
  }
  if (showArc && fr.hip && fr.knee && fr.ankle) drawKneeArc(ctx, P(fr.hip), P(fr.knee), P(fr.ankle), fr.kneeAngle, c, s);
}

// The knee bend: the angle between the thigh carried on past the knee and the
// shank, the number the page reports (0° is a straight leg).
function drawKneeArc(ctx, H, K, A, angleDeg, c, s) {
  const a1 = Math.atan2(K[1] - H[1], K[0] - H[0]);
  const a2 = Math.atan2(A[1] - K[1], A[0] - K[0]);
  let d = a2 - a1;
  while (d <= -Math.PI) d += 2 * Math.PI;
  while (d > Math.PI) d -= 2 * Math.PI;
  const r = 0.75 * s;
  ctx.save();
  ctx.strokeStyle = c.faint;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(K[0], K[1]);
  ctx.lineTo(K[0] + Math.cos(a1) * r * 1.25, K[1] + Math.sin(a1) * r * 1.25);
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = c.arc;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(K[0], K[1], r, a1, a1 + d, d < 0);
  ctx.stroke();
  const mid = a1 + d / 2;
  ctx.fillStyle = c.ink;
  ctx.font = '600 15px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${Math.round(180 - angleDeg)}°`, K[0] + Math.cos(mid) * (r + 20), K[1] + Math.sin(mid) * (r + 20));
}
