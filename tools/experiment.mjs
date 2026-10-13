// The three checks of the README, computed from runs of the page
// (tools/run-headless.mjs): repeatability (same position filmed again),
// sensitivity (saddle raised by a measured amount, against the leg-triangle
// prediction) and reference (still pose against an inclinometer).
//
// Usage: node tools/experiment.mjs private/experiment.json [--out docs/results.md]
//
// private/experiment.json (never committed):
// {
//   "crankMm": 170,
//   "runs": { "V1": "private/runs/V1", "V2": "private/runs/V2", "V3": "private/runs/V3", "V4": "private/runs/V4", "S": "private/runs/S" },
//   "baseline": ["V1", "V2", "V4"],
//   "raised": { "V3": 9.5 },                // saddle change in mm along the seat post, measured with a tape
//   "inclinometer": { "thighDeg": [55, 56, 55], "shankDeg": [88, 87, 88], "ankle": "behind" }
// }

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { analyze, analyzeStill, predictKneeChange } from '../web/core/analyze.js';
import { median, quantile, rng } from '../web/core/signal.js';

const KEYS = ['kneeBdc', 'kneeMaxExt', 'kneeMin', 'ankleRom', 'ankleBdc', 'hipMin', 'trunk', 'shoulder', 'elbow', 'cadence'];

async function load(dir, crankMm) {
  const result = JSON.parse(await readFile(join(dir, 'result.json'), 'utf8'));
  let rerun = null;
  try {
    const raw = JSON.parse(await readFile(join(dir, 'track.keypoints.json'), 'utf8'));
    const track = { width: raw.width, height: raw.height, t: Float64Array.from(raw.t), data: Float32Array.from(raw.data, (v) => (v === null ? NaN : v)) };
    rerun = analyze(track, { crankMm });
  } catch { /* no landmarks saved for this run */ }
  return { result, rerun };
}

/** Bootstrap 95% interval of median(b) - median(a), resampling strokes in each run. */
function diffOfMedians(a, b, { boot = 4000, seed = 11 } = {}) {
  const rand = rng(seed);
  const pick = (arr) => { const s = new Float64Array(arr.length); for (let i = 0; i < arr.length; i++) s[i] = arr[Math.floor(rand() * arr.length)]; return median(s); };
  const d = new Float64Array(boot);
  for (let k = 0; k < boot; k++) d[k] = pick(b) - pick(a);
  return { diff: median(b) - median(a), ci95: [quantile(d, 0.025), quantile(d, 0.975)] };
}

const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : '–');
const strokesOf = (r, key) => r.perStroke.filter((s) => s.valid).map((s) => s[key]);

const cfgPath = process.argv[2];
if (!cfgPath) { console.error('Usage: node tools/experiment.mjs private/experiment.json [--out docs/results.md]'); process.exit(2); }
const outIdx = process.argv.indexOf('--out');
const cfg = JSON.parse(await readFile(cfgPath, 'utf8'));
const runs = {};
for (const [name, dir] of Object.entries(cfg.runs)) {
  if (name === 'S') continue;
  runs[name] = await load(dir, cfg.crankMm);
}
const lines = [];
const out = { generated: new Date().toISOString(), runs: {}, repeatability: {}, sensitivity: {}, reference: null };

// 0. One code: the page's numbers and a re-run of the same module on the saved landmarks.
lines.push('## Same code, same numbers', '');
for (const [name, { result, rerun }] of Object.entries(runs)) {
  const same = rerun ? KEYS.every((k) => Math.abs(rerun.summary[k].median - result.summary[k].median) < 1e-9) : null;
  out.runs[name] = { strokes: result.strokes, video: result.video, summary: Object.fromEntries(KEYS.map((k) => [k, result.summary[k]])), rerunIdentical: same };
  lines.push(`- ${name}: ${result.strokes.valid} clean strokes of ${result.strokes.total}, ${f1(result.video.fps)} frames/s; page result and Node re-run on the saved landmarks ${same === null ? 'not compared (no landmarks saved)' : same ? 'identical' : 'DIFFERENT'}.`);
}

// 1. Repeatability: the baseline videos, same saddle.
lines.push('', '## Repeatability (same position)', '', `| Measure | ${cfg.baseline.join(' | ')} | spread |`, `|---|${cfg.baseline.map(() => '---|').join('')}---|`);
for (const k of KEYS) {
  const meds = cfg.baseline.map((n) => runs[n].result.summary[k].median);
  const spread = Math.max(...meds) - Math.min(...meds);
  out.repeatability[k] = { medians: Object.fromEntries(cfg.baseline.map((n, i) => [n, meds[i]])), spread };
  lines.push(`| ${k} | ${cfg.baseline.map((n) => `${f1(runs[n].result.summary[k].median)} [${f1(runs[n].result.summary[k].ci95[0])}, ${f1(runs[n].result.summary[k].ci95[1])}]`).join(' | ')} | ${f1(spread)} |`);
}
for (let i = 1; i < cfg.baseline.length; i++) {
  const a = cfg.baseline[0], b = cfg.baseline[i];
  const d = diffOfMedians(strokesOf(runs[a].result, 'kneeBdc'), strokesOf(runs[b].result, 'kneeBdc'));
  out.repeatability[`kneeBdc_${b}_minus_${a}`] = d;
  lines.push('', `Knee at the bottom, ${b} − ${a}: ${f1(d.diff)}° (95% interval ${f1(d.ci95[0])} to ${f1(d.ci95[1])}).`);
}

// 2. Sensitivity: saddle raised by a measured amount.
const base = cfg.baseline.map((n) => runs[n].result);
const pooled = (key) => base.flatMap((r) => strokesOf(r, key));
const mm = median(base.map((r) => r.calibration.mmPerPx));
const T = median(base.map((r) => r.geometry.thighToCrank)) * cfg.crankMm;
const S = median(base.map((r) => r.geometry.shankToCrank)) * cfg.crankMm;
const dMm = median(pooled('hipAnklePxBdc')) * mm;
const projection = median(base.map((r) => r.geometry.projection));
lines.push('', '## Sensitivity (saddle raised)', '', '| Video | Saddle change (tape) | Knee change, measured | Knee change, predicted | Ankle change at the bottom | Hip moved (video) |', '|---|---|---|---|---|---|');
for (const [name, deltaMm] of Object.entries(cfg.raised ?? {})) {
  const r = runs[name].result;
  const knee = diffOfMedians(pooled('kneeBdc'), strokesOf(r, 'kneeBdc'));
  const ankle = diffOfMedians(pooled('ankleBdc'), strokesOf(r, 'ankleBdc'));
  const predicted = predictKneeChange({ T, S, d: dMm, deltaSaddle: deltaMm, projection });
  // With the tripod untouched, the hip itself moves in the picture.
  const hipBase = [median(base.flatMap((b) => b.perStroke.filter((s) => s.valid).map((s) => s.hipBdc[0]))), median(base.flatMap((b) => b.perStroke.filter((s) => s.valid).map((s) => s.hipBdc[1])))];
  const hipNow = [median(r.perStroke.filter((s) => s.valid).map((s) => s.hipBdc[0])), median(r.perStroke.filter((s) => s.valid).map((s) => s.hipBdc[1]))];
  const hipMovedMm = Math.hypot(hipNow[0] - hipBase[0], hipNow[1] - hipBase[1]) * mm;
  out.sensitivity[name] = { saddleMm: deltaMm, knee, predicted, ankle, hipMovedMm };
  lines.push(`| ${name} | ${f1(deltaMm)} mm | ${f1(knee.diff)}° [${f1(knee.ci95[0])}, ${f1(knee.ci95[1])}] | ${f1(predicted)}° | ${f1(ankle.diff)}° [${f1(ankle.ci95[0])}, ${f1(ankle.ci95[1])}] | ${f1(hipMovedMm)} mm |`);
}

// 3. Reference: the still pose against the inclinometer.
if (cfg.runs.S && cfg.inclinometer) {
  const raw = JSON.parse(await readFile(join(cfg.runs.S, 'track.keypoints.json'), 'utf8'));
  const track = { width: raw.width, height: raw.height, t: Float64Array.from(raw.t), data: Float32Array.from(raw.data, (v) => (v === null ? NaN : v)) };
  const still = analyzeStill(track, {});
  const thigh = median(cfg.inclinometer.thighDeg);
  // Inclinometer readings are angles from the horizontal (0 to 90). The shank
  // angle measured from the front (ankle to knee) is the reading itself when the
  // ankle is behind the knee, 180 minus the reading when the ankle is ahead of it.
  const reading = median(cfg.inclinometer.shankDeg);
  const shank = cfg.inclinometer.ankle === 'behind' ? reading : cfg.inclinometer.ankle === 'ahead' ? 180 - reading : 90;
  const kneeIncl = thigh + shank;
  out.reference = {
    model: { knee: still.knee.median, thigh: still.thighBelowHorizontal.median, shank: still.shankAboveHorizontalFront.median },
    inclinometer: { knee: kneeIncl, thigh, shank },
    differenceKnee: still.knee.median - kneeIncl,
    dynamicMinusStatic: median(pooled('kneeBdc')) - still.knee.median,
  };
  lines.push('', '## Reference (still pose, crank down)', '', '| | Model | Inclinometer | Difference |', '|---|---|---|---|',
    `| Thigh below horizontal | ${f1(still.thighBelowHorizontal.median)}° | ${f1(thigh)}° | ${f1(still.thighBelowHorizontal.median - thigh)}° |`,
    `| Shank (from the front) | ${f1(still.shankAboveHorizontalFront.median)}° | ${f1(shank)}° | ${f1(still.shankAboveHorizontalFront.median - shank)}° |`,
    `| Knee angle | ${f1(still.knee.median)}° | ${f1(kneeIncl)}° | ${f1(still.knee.median - kneeIncl)}° |`,
    '', `Pedalling (median of the baseline strokes) minus still pose, knee at the bottom: ${f1(out.reference.dynamicMinusStatic)}°.`);
}

const text = lines.join('\n');
console.log(text);
await writeFile(cfgPath.replace(/\.json$/, '.results.json'), JSON.stringify(out, null, 1));
if (outIdx > 0) await writeFile(process.argv[outIdx + 1], `# Results\n\nComputed by tools/experiment.mjs from runs of the page in headless Chromium.\n\n${text}\n`);
