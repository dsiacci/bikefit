// Record a short tour of the page with the synthetic rider, for the demo video:
// no video file and no real person, so no one's picture or proportions appear.
// The recording is a WebM file in the output folder (convert it with ffmpeg).
//
// Usage: node tools/demo.mjs --out private/demo [--port 8190] [--dark] [--width 1280 --height 800]

import { mkdir, readdir, rename } from 'node:fs/promises';
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
if (!opt.out) {
  console.error('Usage: node tools/demo.mjs --out <folder> [--port 8190] [--dark]');
  process.exit(2);
}
const out = resolve(opt.out);
await mkdir(out, { recursive: true });
const size = { width: Number(opt.width ?? 1280), height: Number(opt.height ?? 800) };
const port = Number(opt.port ?? 8190);
const server = await startServer(port);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: size, deviceScaleFactor: 1, colorScheme: opt.dark ? 'dark' : 'light', recordVideo: { dir: out, size },
});
const page = await context.newPage();
const pause = (ms) => page.waitForTimeout(ms);
try {
  await page.goto(`http://127.0.0.1:${port}/?delegate=CPU`);
  await page.waitForFunction(() => ['ready', 'failed'].includes(window.bikefit?.state.phase), null, { timeout: 180_000 });
  await pause(2500); // the network lock message in the header
  await page.hover('#sample');
  await pause(900);
  await page.click('#sample');
  await page.waitForFunction(() => window.bikefit.state.phase === 'done');
  await pause(4000); // headline, saddle sentence, the stroke loop
  // Along the knee curve, with the hover read-out.
  await page.locator('#chart-knee').scrollIntoViewIfNeeded();
  await pause(800);
  const box = await page.locator('#chart-knee svg').boundingBox();
  if (box) {
    for (let k = 0; k <= 24; k++) {
      await page.mouse.move(box.x + box.width * (0.08 + (0.84 * k) / 24), box.y + box.height * 0.5);
      await pause(140);
    }
  }
  await pause(800);
  // The rest of the results, slowly.
  for (let k = 0; k < 14; k++) {
    await page.mouse.wheel(0, 260);
    await pause(650);
  }
  await pause(2000);
} finally {
  await context.close(); // writes the recording
  await browser.close();
  server.close();
}
const webm = (await readdir(out)).filter((f) => f.endsWith('.webm') && f !== 'demo.webm');
if (webm.length) await rename(join(out, webm[webm.length - 1]), join(out, 'demo.webm'));
console.log(`recorded ${join(out, 'demo.webm')}`);
