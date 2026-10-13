// Figures for the README, drawn from the synthetic rider (no real person).
// Usage: node tools/figures.mjs   -> docs/crank-from-feet.svg

import { writeFile, mkdir } from 'node:fs/promises';
import { pose, BASE } from '../test/synth.js';
import { findPedalAxle, axlePath, fitCircle } from '../web/core/calibration.js';

const W = 780, H = 430;
const p = { ...BASE };
const heel = [], toe = [], ankle = [];
for (let a = 0; a < 360; a += 2) {
  const q = pose(p, a);
  heel.push(q.heel); toe.push(q.toe); ankle.push(q.ankle);
}
// Image coordinates (y down) for the search, as the page does it.
const img = (pts) => pts.map(([x, y]) => [x, -y]);
const foot = {
  heelX: img(heel).map((v) => v[0]), heelY: img(heel).map((v) => v[1]),
  toeX: img(toe).map((v) => v[0]), toeY: img(toe).map((v) => v[1]),
  ankleX: img(ankle).map((v) => v[0]), ankleY: img(ankle).map((v) => v[1]),
};
const found = findPedalAxle(foot);
const axle = axlePath(foot, found.s, found.u, found.footLength);

// Left: the paths. Right: distance to the bottom bracket through the stroke.
const all = [...img(heel), ...img(toe), ...img(ankle)];
const x0 = Math.min(...all.map((v) => v[0])) - 30, x1 = Math.max(...all.map((v) => v[0])) + 30;
const y0 = Math.min(...all.map((v) => v[1])) - 30, y1 = Math.max(...all.map((v) => v[1])) + 30;
const s = Math.min(330 / (x1 - x0), 330 / (y1 - y0));
const X = (x) => 16 + (x - x0) * s, Y = (y) => 60 + (y - y0) * s;
const loopPath = (pts) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join('') + 'Z';
const axlePts = Array.from(axle.x, (x, i) => [x, axle.y[i]]);
const qa = pose(p, 100);
const shoe = img([qa.heel, qa.toe, qa.ankle]);
const ax = [axle.x[50], axle.y[50]];

// Each point against the centre of its own best circle: the foot mostly
// travels without turning, so every point draws a loop the size of the crank;
// only the pedal axle draws an exact one.
const radius = (pts) => {
  const c = fitCircle(pts.map((v) => v[0]), pts.map((v) => v[1]));
  return pts.map(([x, y]) => Math.hypot(x - c.cx, y - c.cy));
};
const series = [
  { name: 'heel', color: '#b9b7ad', r: radius(img(heel)) },
  { name: 'toe', color: '#8a887f', r: radius(img(toe)) },
  { name: 'ankle', color: '#52514e', r: radius(img(ankle)) },
  { name: 'pedal axle', color: '#2a78d6', r: radius(axlePts), width: 2.5 },
];
const rAll = series.flatMap((d) => d.r);
const r0 = Math.floor(Math.min(...rAll) / 10) * 10, r1 = Math.ceil(Math.max(...rAll) / 10) * 10;
const CX0 = 430, CX1 = 760, CY0 = 80, CY1 = 360;
const cx = (deg) => CX0 + ((CX1 - CX0) * deg) / 360;
const cy = (r) => CY1 - ((CY1 - CY0) * (r - r0)) / (r1 - r0);
let grid = '';
for (let r = r0; r <= r1; r += 10) grid += `<line x1="${CX0}" x2="${CX1}" y1="${cy(r)}" y2="${cy(r)}" stroke="#e1e0d9"/><text x="${CX0 - 8}" y="${cy(r) + 4}" text-anchor="end" fill="#6f6d67" font-size="12">${r}</text>`;
for (const [deg, label] of [[0, 'top'], [180, 'bottom'], [360, 'top']]) grid += `<text x="${cx(deg)}" y="${CY1 + 20}" text-anchor="middle" fill="#6f6d67" font-size="12">${label}</text>`;
const lines = series.map((d) => `<path d="${d.r.map((r, i) => `${i ? 'L' : 'M'}${cx(i * 2).toFixed(1)},${cy(r).toFixed(1)}`).join('')}" fill="none" stroke="${d.color}" stroke-width="${d.width ?? 2}"/>`).join('');
// A legend, not end labels: the lines all meet at the top of the stroke.
const labels = series.map((d, k) => `<line x1="${CX0 + k * 72}" x2="${CX0 + k * 72 + 18}" y1="52" y2="52" stroke="${d.color}" stroke-width="${d.width ?? 2}"/><text x="${CX0 + k * 72 + 24}" y="56" fill="#52514e" font-size="12">${d.name}</text>`).join('');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="13">
<rect width="${W}" height="${H}" fill="#fcfcfb"/>
<text x="16" y="30" font-weight="600" fill="#0b0b0b">Paths of foot points over one stroke</text>
<path d="${loopPath(img(heel))}" fill="none" stroke="#b9b7ad" stroke-width="2"/>
<path d="${loopPath(img(toe))}" fill="none" stroke="#8a887f" stroke-width="2"/>
<path d="${loopPath(img(ankle))}" fill="none" stroke="#52514e" stroke-width="2"/>
<path d="${loopPath(axlePts)}" fill="none" stroke="#2a78d6" stroke-width="2.5"/>
<line x1="${X(found.cx)}" y1="${Y(found.cy)}" x2="${X(ax[0])}" y2="${Y(ax[1])}" stroke="#2a78d6" stroke-width="2"/>
<path d="M${X(shoe[0][0])},${Y(shoe[0][1])}L${X(shoe[1][0])},${Y(shoe[1][1])}L${X(shoe[2][0])},${Y(shoe[2][1])}Z" fill="none" stroke="#0b0b0b" stroke-width="2" stroke-linejoin="round"/>
<circle cx="${X(found.cx)}" cy="${Y(found.cy)}" r="4" fill="#2a78d6" stroke="#fcfcfb" stroke-width="2"/>
<circle cx="${X(ax[0])}" cy="${Y(ax[1])}" r="5" fill="#2a78d6" stroke="#fcfcfb" stroke-width="2"/>
<text x="${X(found.cx) - 8}" y="${Y(found.cy) + 4}" text-anchor="end" fill="#52514e" font-size="12">bottom bracket</text>
<text x="${CX0 - 40}" y="30" font-weight="600" fill="#0b0b0b">Distance to the centre of its own circle (mm)</text>
${grid}
<line x1="${CX0}" x2="${CX1}" y1="${CY1}" y2="${CY1}" stroke="#c3c2b7"/>
${lines}
${labels}
<text x="${CX0 - 40}" y="${H - 30}" fill="#52514e" font-size="12">Every point of the foot draws a loop the size of the crank.</text>
<text x="${CX0 - 40}" y="${H - 12}" fill="#52514e" font-size="12">Only the pedal axle draws an exact circle: ${found.r.toFixed(0)} mm here.</text>
</svg>`;
await mkdir(new URL('../docs/', import.meta.url), { recursive: true });
await writeFile(new URL('../docs/crank-from-feet.svg', import.meta.url), svg);
console.log(`axle offset s=${found.s.toFixed(2)} u=${found.u.toFixed(2)}, radius ${found.r.toFixed(1)} mm, fit ${(found.score * 100).toFixed(3)} %`);
