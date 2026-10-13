import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { analyze } from '../web/core/analyze.js';
import { makeTrack, trueAngles, pose, BASE } from './synth.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

function saveRun(dir, overrides) {
  const { track } = makeTrack(overrides);
  mkdirSync(dir, { recursive: true });
  const raw = { width: track.width, height: track.height, t: Array.from(track.t), data: Array.from(track.data, (v) => (Number.isFinite(v) ? v : null)) };
  writeFileSync(join(dir, 'track.keypoints.json'), JSON.stringify(raw));
  try { writeFileSync(join(dir, 'result.json'), JSON.stringify(analyze(track, { crankMm: 170 }))); } catch { /* the still pose has no strokes */ }
}

test('experiment script: repeatability, sensitivity against prediction, reference against an inclinometer', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bikefit-exp-'));
  try {
    saveRun(join(dir, 'V1'), { seconds: 40, noise: 1.5, seed: 21 });
    saveRun(join(dir, 'V2'), { seconds: 40, noise: 1.5, seed: 22 });
    saveRun(join(dir, 'V3'), { seconds: 40, noise: 1.5, seed: 23, hipFromBb: BASE.hipFromBb + 9 });
    saveRun(join(dir, 'V4'), { seconds: 40, noise: 1.5, seed: 24 });
    saveRun(join(dir, 'S'), { seconds: 0.001, lead: 0, tail: 12, phase0: 180, noise: 1, seed: 25 });
    // A perfect inclinometer, from the synthetic rider at the bottom of the stroke.
    const q = pose(BASE, 180);
    const thighDeg = (Math.atan2(q.hip[1] - q.knee[1], q.knee[0] - q.hip[0]) * 180) / Math.PI;
    const shankFront = (Math.atan2(q.knee[1] - q.ankle[1], q.knee[0] - q.ankle[0]) * 180) / Math.PI;
    const cfg = {
      crankMm: 170,
      runs: Object.fromEntries(['V1', 'V2', 'V3', 'V4', 'S'].map((n) => [n, join(dir, n)])),
      baseline: ['V1', 'V2', 'V4'],
      raised: { V3: 9 },
      inclinometer: { thighDeg: [thighDeg], shankDeg: [shankFront <= 90 ? shankFront : 180 - shankFront], ankle: shankFront <= 90 ? 'behind' : 'ahead' },
    };
    const cfgPath = join(dir, 'experiment.json');
    writeFileSync(cfgPath, JSON.stringify(cfg));
    execFileSync(process.execPath, ['tools/experiment.mjs', cfgPath], { stdio: 'pipe' });
    const out = JSON.parse(readFileSync(cfgPath.replace(/\.json$/, '.results.json'), 'utf8'));
    for (const n of ['V1', 'V2', 'V3', 'V4']) assert.equal(out.runs[n].rerunIdentical, true, `${n} re-run identical`);
    assert.ok(out.repeatability.kneeBdc.spread < 0.6, `spread ${out.repeatability.kneeBdc.spread}`);
    close(out.sensitivity.V3.knee.diff, out.sensitivity.V3.predicted, 0.5, 'knee change vs prediction');
    close(out.sensitivity.V3.hipMovedMm, 9, 1.5, 'hip moved in the picture');
    close(out.reference.differenceKnee, 0, 1, 'still knee vs inclinometer');
    close(out.reference.model.knee, trueAngles(BASE, 180).knee, 1, 'still knee vs truth');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
