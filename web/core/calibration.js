// Scale and crank position from the video itself. The pedal axle is the only
// point of the foot that moves on a perfect circle around the bottom bracket,
// and the radius of that circle is the crank length. So we look for the point,
// in the frame of the foot (heel and toe landmarks), whose path is the most
// circular: its centre is the bottom bracket, its radius in pixels against the
// known crank length gives millimetres per pixel.

/**
 * Least-squares circle through points (algebraic fit of x^2 + y^2 + Dx + Ey + F,
 * Kasa), refined with a few Gauss-Newton steps on the geometric distance.
 * Optional weights. Returns {cx, cy, r, rms} or null.
 */
export function fitCircle(xs, ys, ws = null) {
  const n = xs.length;
  let sw = 0, sx = 0, sy = 0;
  for (let i = 0; i < n; i++) {
    const w = ws ? ws[i] : 1;
    sw += w; sx += w * xs[i]; sy += w * ys[i];
  }
  if (n < 3 || sw <= 0) return null;
  const mx = sx / sw, my = sy / sw;
  // Normal equations for u^2 + v^2 + D u + E v + F = 0, centred coordinates.
  let suu = 0, svv = 0, suv = 0, su = 0, sv = 0, suz = 0, svz = 0, sz = 0;
  for (let i = 0; i < n; i++) {
    const w = ws ? ws[i] : 1;
    const u = xs[i] - mx, v = ys[i] - my, z = u * u + v * v;
    suu += w * u * u; svv += w * v * v; suv += w * u * v;
    su += w * u; sv += w * v; suz += w * u * z; svz += w * v * z; sz += w * z;
  }
  const sol = solve3(
    [[suu, suv, su], [suv, svv, sv], [su, sv, sw]],
    [-suz, -svz, -sz],
  );
  if (!sol) return null;
  let cx = -sol[0] / 2, cy = -sol[1] / 2;
  let r = Math.sqrt(Math.max(0, cx * cx + cy * cy - sol[2]));
  cx += mx; cy += my;
  // Geometric refinement.
  for (let it = 0; it < 10; it++) {
    let a11 = 0, a12 = 0, a13 = 0, a22 = 0, a23 = 0, a33 = 0, b1 = 0, b2 = 0, b3 = 0;
    for (let i = 0; i < n; i++) {
      const w = ws ? ws[i] : 1;
      const dx = xs[i] - cx, dy = ys[i] - cy, d = Math.hypot(dx, dy);
      if (d === 0) continue;
      const res = d - r, jx = -dx / d, jy = -dy / d, jr = -1;
      a11 += w * jx * jx; a12 += w * jx * jy; a13 += w * jx * jr;
      a22 += w * jy * jy; a23 += w * jy * jr; a33 += w * jr * jr;
      b1 -= w * jx * res; b2 -= w * jy * res; b3 -= w * jr * res;
    }
    const step = solve3([[a11, a12, a13], [a12, a22, a23], [a13, a23, a33]], [b1, b2, b3]);
    if (!step) break;
    cx += step[0]; cy += step[1]; r += step[2];
    if (Math.abs(step[0]) + Math.abs(step[1]) + Math.abs(step[2]) < 1e-6) break;
  }
  let ss = 0;
  for (let i = 0; i < n; i++) {
    const w = ws ? ws[i] : 1;
    const res = Math.hypot(xs[i] - cx, ys[i] - cy) - r;
    ss += w * res * res;
  }
  return { cx, cy, r, rms: Math.sqrt(ss / sw) };
}

/**
 * Circle fit that ignores outliers (frames where the foot is off the pedal, or
 * a landmark glitch): the best of many circles through three points by least
 * median of squares, then Tukey biweight on the radial residuals, re-fitted a
 * few times. Deterministic.
 */
export function robustCircle(xs, ys, { trials = 300, seed = 1 } = {}) {
  const n = xs.length;
  if (n < 3) return null;
  let a = seed >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let fit = null, bestMed = Infinity;
  const res2 = new Float64Array(n);
  for (let k = 0; k < trials; k++) {
    const i = Math.floor(rand() * n), j = Math.floor(rand() * n), l = Math.floor(rand() * n);
    const c = circleThrough(xs[i], ys[i], xs[j], ys[j], xs[l], ys[l]);
    if (!c) continue;
    for (let m = 0; m < n; m++) res2[m] = (Math.hypot(xs[m] - c.cx, ys[m] - c.cy) - c.r) ** 2;
    const med = median(Array.from(res2));
    if (med < bestMed) { bestMed = med; fit = c; }
  }
  if (!fit) return fitCircle(xs, ys);
  const w = new Float64Array(n);
  for (let it = 0; it < 8; it++) {
    const res = Array.from(xs, (x, i) => Math.hypot(x - fit.cx, ys[i] - fit.cy) - fit.r);
    const s = 1.4826 * medianAbs(res) || 1e-9;
    const c = 4.685 * s;
    for (let i = 0; i < n; i++) {
      const u = res[i] / c;
      w[i] = Math.abs(u) < 1 ? (1 - u * u) ** 2 : 0;
    }
    const next = fitCircle(xs, ys, w);
    if (!next) break;
    fit = next;
  }
  const inliers = w.reduce((acc, b) => acc + (b > 0 ? 1 : 0), 0);
  return { ...fit, inliers: inliers / n };
}

function circleThrough(x1, y1, x2, y2, x3, y3) {
  const d = 2 * (x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2));
  if (Math.abs(d) < 1e-9) return null;
  const s1 = x1 * x1 + y1 * y1, s2 = x2 * x2 + y2 * y2, s3 = x3 * x3 + y3 * y3;
  const cx = (s1 * (y2 - y3) + s2 * (y3 - y1) + s3 * (y1 - y2)) / d;
  const cy = (s1 * (x3 - x2) + s2 * (x1 - x3) + s3 * (x2 - x1)) / d;
  return { cx, cy, r: Math.hypot(x1 - cx, y1 - cy) };
}

/**
 * Find the pedal axle in the frame of the foot. `foot` holds arrays heelX,
 * heelY, toeX, toeY, ankleX, ankleY (same length, finite). The candidate point
 * is heel + s * L * a + u * L * n, where a is the heel-to-toe direction, n its
 * normal pointing away from the ankle (towards the sole) and L the median foot
 * length in pixels. Returns the circle of the most circular candidate.
 */
export function findPedalAxle(foot, { maxPoints = 1500 } = {}) {
  const idx = subsample(foot.heelX.length, maxPoints);
  const m = idx.length;
  const ax = new Float64Array(m), ay = new Float64Array(m), nx = new Float64Array(m), ny = new Float64Array(m);
  const hx = new Float64Array(m), hy = new Float64Array(m);
  const lengths = [];
  idx.forEach((i, k) => {
    const dx = foot.toeX[i] - foot.heelX[i], dy = foot.toeY[i] - foot.heelY[i];
    const len = Math.hypot(dx, dy) || 1;
    lengths.push(len);
    ax[k] = dx / len; ay[k] = dy / len;
    let px = -ay[k], py = ax[k];
    // The normal points away from the ankle.
    if ((foot.ankleX[i] - foot.heelX[i]) * px + (foot.ankleY[i] - foot.heelY[i]) * py > 0) { px = -px; py = -py; }
    nx[k] = px; ny[k] = py;
    hx[k] = foot.heelX[i]; hy[k] = foot.heelY[i];
  });
  const L = median(lengths);
  const px = new Float64Array(m), py = new Float64Array(m);
  const score = (s, u) => {
    for (let k = 0; k < m; k++) {
      px[k] = hx[k] + L * (s * ax[k] + u * nx[k]);
      py[k] = hy[k] + L * (s * ay[k] + u * ny[k]);
    }
    const c = fitCircle(px, py);
    return c && c.r > 0 ? { ...c, score: c.rms / c.r } : null;
  };
  let best = null;
  const consider = (s, u) => {
    const c = score(s, u);
    if (c && (!best || c.score < best.score)) best = { s, u, ...c };
  };
  for (let s = -0.2; s <= 1.2001; s += 0.05) for (let u = -0.5; u <= 0.5001; u += 0.05) consider(s, u);
  if (!best) return null;
  const s0 = best.s, u0 = best.u;
  for (let s = s0 - 0.05; s <= s0 + 0.0501; s += 0.01) for (let u = u0 - 0.05; u <= u0 + 0.0501; u += 0.01) consider(s, u);
  return { ...best, footLength: L };
}

/**
 * The pedal path averaged per crank angle: samples binned by their angle around
 * (cx, cy) in 36 bins of 10°, the mean of each bin, and the circle through the
 * means. Random landmark scatter averages out; a path that is really not a
 * circle (a foot sliding on the pedal) keeps its shape. Returns the circle and
 * its residual as a share of the radius, or null when fewer than 34 bins have
 * at least 5 samples (the pedal was not seen all the way round).
 */
export function phaseLoop(xs, ys, cx, cy, { bins = 36, minPerBin = 5 } = {}) {
  const sx = new Float64Array(bins), sy = new Float64Array(bins), n = new Float64Array(bins);
  for (let i = 0; i < xs.length; i++) {
    if (!Number.isFinite(xs[i]) || !Number.isFinite(ys[i])) continue;
    const a = (Math.atan2(ys[i] - cy, xs[i] - cx) + 2 * Math.PI) % (2 * Math.PI);
    const b = Math.min(bins - 1, Math.floor((a / (2 * Math.PI)) * bins));
    sx[b] += xs[i]; sy[b] += ys[i]; n[b]++;
  }
  const mx = [], my = [];
  for (let b = 0; b < bins; b++) if (n[b] >= minPerBin) { mx.push(sx[b] / n[b]); my.push(sy[b] / n[b]); }
  if (mx.length < bins - 2) return null;
  const c = fitCircle(Float64Array.from(mx), Float64Array.from(my));
  return c && c.r > 0 ? { cx: c.cx, cy: c.cy, r: c.r, score: c.rms / c.r, bins: mx.length } : null;
}

/** Pedal axle positions for every sample, given the offsets found by findPedalAxle. */
export function axlePath(foot, s, u, footLength) {
  const n = foot.heelX.length;
  const x = new Float64Array(n).fill(NaN), y = new Float64Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    const dx = foot.toeX[i] - foot.heelX[i], dy = foot.toeY[i] - foot.heelY[i];
    const len = Math.hypot(dx, dy);
    if (!(len > 0)) continue;
    const ax = dx / len, ay = dy / len;
    let nx = -ay, ny = ax;
    if ((foot.ankleX[i] - foot.heelX[i]) * nx + (foot.ankleY[i] - foot.heelY[i]) * ny > 0) { nx = -nx; ny = -ny; }
    x[i] = foot.heelX[i] + footLength * (s * ax + u * nx);
    y[i] = foot.heelY[i] + footLength * (s * ay + u * ny);
  }
  return { x, y };
}

/**
 * Axis-aligned ellipse through points (least squares on A x^2 + C y^2 + D x +
 * E y = 1 in centred coordinates). Seen square on, the pedal axle draws a
 * circle; a camera turned away from the bike squeezes it horizontally, so the
 * ratio of horizontal to vertical axes hints at the camera angle:
 * cos(angle) = ratio. Returns {rx, ry, ratio, angleDeg} or null.
 */
export function axisEllipse(xs, ys) {
  const n = xs.length;
  if (n < 5) return null;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
  mx /= n; my /= n;
  // Normal equations for [A, C, D, E].
  const M = Array.from({ length: 4 }, () => new Float64Array(4));
  const b = new Float64Array(4);
  for (let i = 0; i < n; i++) {
    const u = xs[i] - mx, v = ys[i] - my;
    const row = [u * u, v * v, u, v];
    for (let r = 0; r < 4; r++) {
      b[r] += row[r];
      for (let c = 0; c < 4; c++) M[r][c] += row[r] * row[c];
    }
  }
  const sol = solve(M.map((r) => Array.from(r)), Array.from(b));
  if (!sol) return null;
  const [A, C, D, E] = sol;
  if (!(A > 0 && C > 0)) return null;
  const G = 1 + (D * D) / (4 * A) + (E * E) / (4 * C);
  const rx = Math.sqrt(G / A), ry = Math.sqrt(G / C);
  const ratio = rx / ry;
  const cx = mx - D / (2 * A), cy = my - E / (2 * C);
  // Residual: distance of each point to the ellipse along its ray from the
  // centre, as a share of the mean radius.
  let ss = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - cx, dy = ys[i] - cy;
    const rho = Math.hypot(dx / rx, dy / ry);
    if (rho > 0) ss += (Math.hypot(dx, dy) * (1 - 1 / rho)) ** 2;
  }
  const score = Math.sqrt(ss / n) / ((rx + ry) / 2);
  return { cx, cy, rx, ry, ratio, angleDeg: ratio < 1 ? (Math.acos(ratio) * 180) / Math.PI : 0, score };
}

function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

function subsample(n, max) {
  if (n <= max) return Array.from({ length: n }, (_, i) => i);
  const step = n / max;
  return Array.from({ length: max }, (_, k) => Math.floor(k * step));
}

function median(a) {
  const s = a.filter(Number.isFinite).sort((p, q) => p - q);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function medianAbs(a) {
  return median(a.map(Math.abs));
}

function solve3(A, b) {
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k < 4; k++) M[r][k] -= f * M[c][k];
    }
  }
  return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
}
