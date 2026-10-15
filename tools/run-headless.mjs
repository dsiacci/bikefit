// Run the page itself in headless Chromium on a video file: the numbers in the
// README and the article come from here, so they come from the same code as the
// page people use. Saves the page's result, and the landmarks if asked, in a
// private folder that git ignores.
//
// Usage:
//   node tools/run-headless.mjs --video private/videos/V1.mov --out private/runs/V1
//     [--crank 170] [--notch 9] [--model full] [--delegate CPU] [--keypoints]
//     [--record private/demo] [--show-frames] [--channel chrome]
//     [--screenshot private/runs/V1/page.png] [--report]  (saves the report the page offers)
//   node tools/run-headless.mjs --sample --out private/demo [--record private/demo]  (the synthetic rider, no video)

import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { startServer } from './serve.mjs';

function args(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

const opt = args(process.argv);
if ((!opt.video && !opt.sample) || !opt.out) {
  console.error('Usage: node tools/run-headless.mjs --video <file> --out <folder> [--crank 170] [--notch 9] [--model full] [--keypoints]');
  process.exit(2);
}
const out = resolve(opt.out);
await mkdir(out, { recursive: true });
const port = Number(opt.port ?? 8181);
const server = await startServer(port);
const browser = await chromium.launch({ headless: true, channel: opt.channel || undefined });
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 1,
  colorScheme: opt.dark ? 'dark' : 'light',
  recordVideo: opt.record ? { dir: resolve(opt.record), size: { width: 1280, height: 900 } } : undefined,
});
const page = await context.newPage();
const consoleLines = [];
page.on('console', (m) => consoleLines.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => consoleLines.push(`pageerror: ${e.message}`));
const t0 = Date.now();
try {
  const params = new URLSearchParams({ model: opt.model ?? 'full', ...(opt.delegate ? { delegate: opt.delegate } : {}) });
  await page.goto(`http://127.0.0.1:${port}/?${params}`);
  await page.waitForFunction(() => ['ready', 'failed'].includes(window.bikefit?.state.phase), null, { timeout: 180_000 });
  const ready = await page.evaluate(() => ({ ...window.bikefit.state }));
  if (ready.phase !== 'ready') throw new Error(`model did not load: ${ready.error}`);
  if (opt.crank !== undefined) await page.selectOption('#crank', String(opt.crank));
  if (opt.notch) await page.fill('#notch', String(opt.notch));
  if (opt['show-frames']) await page.check('#show-frames');
  if (opt.sample) await page.click('#sample');
  else {
    await page.setInputFiles('#file', resolve(opt.video));
    await page.click('#run');
  }
  let last = -1;
  for (;;) {
    const s = await page.evaluate(() => ({ phase: window.bikefit.state.phase, progress: window.bikefit.state.progress, frames: window.bikefit.state.frames }));
    if (s.phase === 'done' || s.phase === 'error') break;
    const pct = Math.floor(100 * s.progress);
    if (pct >= last + 10) { console.log(`${pct}% (${s.frames} frames, ${Math.round((Date.now() - t0) / 1000)} s)`); last = pct; }
    await page.waitForTimeout(2000);
  }
  if (opt.record) await page.waitForTimeout(4000); // let the results show on the recording
  // The data first: a screenshot or a download that fails must not lose a run of several minutes.
  const state = await page.evaluate(() => ({ ...window.bikefit.state }));
  await writeFile(join(out, 'run.json'), JSON.stringify({
    video: opt.video, finished: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000),
    phase: state.phase, error: state.error, model: state.model, delegate: state.delegate, locked: state.locked, timings: state.timings,
  }, null, 1));
  if (state.result) await writeFile(join(out, 'result.json'), JSON.stringify(state.result));
  if (opt.keypoints) {
    const track = await page.evaluate(() => window.bikefit.track());
    if (track) await writeFile(join(out, 'track.keypoints.json'), JSON.stringify(track));
  }
  if (opt.screenshot) {
    await page.waitForTimeout(1500);
    await page.screenshot({ path: resolve(opt.screenshot), fullPage: true }).catch((e) => console.error(`screenshot failed: ${e.message}`));
  }
  if (opt.report && state.phase === 'done' && (await page.isVisible('#dl-report'))) {
    try {
      const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), page.click('#dl-report')]);
      await download.saveAs(join(out, 'report.html'));
    } catch (e) { console.error(`report download failed: ${e.message.split('\n')[0]}`); }
  }
  console.log(`${state.phase}${state.error ? `: ${state.error}` : ''} in ${Math.round((Date.now() - t0) / 1000)} s, network locked: ${state.locked}`);
} finally {
  await writeFile(join(out, 'console.log'), consoleLines.join('\n'));
  await context.close();
  await browser.close();
  server.close();
}
