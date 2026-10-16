// Record the demo video: the page itself, driven as a visitor would drive it,
// with titles, highlights and a cursor drawn over it (tools/demo/overlay.*), each
// scene paced on its voice-over clip (tools/demo/scenes.json). The synthetic
// rider stands in for a real video, so no one's picture or proportions appear.
//
// Usage: node tools/demo.mjs --out private/demo [--voice private/demo/voice] [--tempo 1.1] [--url https://…] [--port 8190]
// Needs ffmpeg and ffprobe. Writes saddle-check-demo.mp4 (1920×1080) and, with
// a voice, saddle-check-demo.srt (captions for the video host).

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
  console.error('Usage: node tools/demo.mjs --out <folder> [--voice <folder of <scene>.mp3>] [--tempo 1.1] [--url <page address>]');
  process.exit(2);
}
const out = resolve(opt.out);
const framesDir = join(out, 'frames');
await rm(framesDir, { recursive: true, force: true });
await mkdir(framesDir, { recursive: true });
const voice = opt.voice ? resolve(opt.voice) : null;
const tempo = Number(opt.tempo ?? 1.1);
const port = Number(opt.port ?? 8190);
const LEAD = 0.25; // seconds from the start of a scene to its voice

const run = (cmd, list) => {
  const r = spawnSync(cmd, list, { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`${cmd} failed: ${(r.stderr || '').slice(-2000)}`);
  return r.stdout;
};
const probe = (file) => Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).trim());
const { scenes } = JSON.parse(await readFile(new URL('./demo/scenes.json', import.meta.url), 'utf8'));
const say = Object.fromEntries(scenes.map((s) => [s.id, s.say]));
const length = Object.fromEntries(scenes.map((s) => [s.id, voice ? probe(join(voice, `${s.id}.mp3`)) / tempo : s.say.length / 15]));

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const INTRO = `<div class="d-center">
  <img class="d-logo" src="icon.svg" alt="">
  <div class="d-brand">Saddle Check</div>
  <div class="d-sub">Is your saddle at the right height? <em>A phone video answers</em>, in your browser.</div>
  <div class="d-meta">Open source · nothing uploaded</div>
</div>`;
const PROOF = `<div class="d-center">
  <div class="d-eyebrow d-step" data-step="1">Tested on a home trainer</div>
  <div class="d-row">
    <span class="d-big d-step" data-step="2">42.7°</span>
    <svg class="d-arrow d-step" data-step="3" viewBox="0 0 90 50" aria-hidden="true"><path d="M6 25H80 M60 8 82 25 60 42"/></svg>
    <span class="d-big hl d-step" data-step="3">37.9°</span>
  </div>
  <div class="d-note d-step" data-step="3">Knee bend at the bottom of the stroke: at the start height, then one saddle letter (10 mm) higher</div>
  <div class="d-chips">
    <div class="d-chip d-step" data-step="4"><b>−4.8°</b> for 10 mm</div>
    <div class="d-chip d-step" data-step="5"><b>0.7°</b> between three takes at the same height</div>
  </div>
</div>`;
const OUTRO = `<div class="d-center">
  <img class="d-logo d-step" data-step="1" src="icon.svg" alt="">
  <div class="d-brand d-step" data-step="1">Saddle Check</div>
  <div class="d-sub d-step" data-step="2">Free and open source, Apache 2.0</div>
  ${opt.url ? `<div class="d-url d-step" data-step="2">${esc(String(opt.url).replace(/^https?:\/\//, ''))}</div>` : ''}
  <div class="d-url d-step" data-step="3">github.com/dsiacci/bikefit</div>
  <div class="d-credits d-step" data-step="3">Demo with a synthetic rider: no real person on screen. Voice: ElevenLabs.</div>
</div>`;

const server = await startServer(port, '127.0.0.1', { '/__demo/': fileURLToPath(new URL('./demo/', import.meta.url)) });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5, colorScheme: 'light' });
const page = await context.newPage();
page.on('pageerror', (e) => console.error('page error:', e.message));
const demo = (fn, arg) => page.evaluate(fn, arg);
const pause = (ms) => page.waitForTimeout(ms);

/** Glide the drawn cursor to an element, then click there with the real mouse. */
async function clickOn(selector, ms = 800) {
  const [x, y] = await page.evaluate(([s, m]) => window.demo.cursorTo(s, m), [selector, ms]);
  await page.mouse.move(x, y);
  await demo(() => window.demo.click());
  await page.mouse.down();
  await page.mouse.up();
}

const marks = [];
async function scene(id, actions, { hold = 0.6 } = {}) {
  const start = Date.now();
  marks.push({ id, at: start / 1000 });
  const at = (s) => pause(Math.max(0, start + s * 1000 - Date.now()));
  const cue = (s) => at(LEAD + s / tempo); // s: seconds into the voice clip, before the tempo change
  await Promise.all([actions({ at, cue }), pause((LEAD + length[id] + hold) * 1000)]);
}

const frames = [];
let endAt = 0;
try {
  await page.goto(`http://127.0.0.1:${port}/?delegate=CPU`);
  await page.waitForFunction(() => window.bikefit?.state.phase === 'ready', null, { timeout: 180_000 });
  await page.addStyleTag({ url: '/__demo/overlay.css' });
  await page.addScriptTag({ url: '/__demo/overlay.js', type: 'module' });
  await page.waitForFunction(() => window.demo);
  await page.evaluate(() => document.fonts.ready);
  await demo((html) => window.demo.card(html, { instant: true }), INTRO);
  await pause(400);

  const cdp = await context.newCDPSession(page);
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    const file = join(framesDir, `${String(frames.length).padStart(6, '0')}.jpg`);
    writeFileSync(file, Buffer.from(data, 'base64'));
    frames.push({ file, t: metadata.timestamp });
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  await pause(300);

  await scene('intro', async ({ cue }) => {
    await cue(2.2);
    await demo(() => window.demo.hideCard());
  });

  await scene('film', async ({ cue }) => {
    await demo(() => { window.demo.showCursor(); return window.demo.lower({ n: '01', k: 'Film', c: 'From the side, about a minute' }); });
    await clickOn('#step-film [data-howto]', 900);
    await demo(() => window.demo.hideLower()); // the dialog has its own title
    await pause(350);
    await demo(() => window.demo.raise());
    await cue(2.7); await demo(() => window.demo.ring('#howto .checklist li:nth-child(1)', 6));
    await cue(4.15); await demo(() => window.demo.ring('#howto .checklist li:nth-child(3)', 6));
    await cue(5.8); await demo(() => window.demo.ring('#howto .checklist li:nth-child(4)', 6));
    await cue(7.1); await demo(() => window.demo.ring('#howto .checklist li:nth-child(6)', 6));
    await cue(9.2); await demo(() => window.demo.hideRing());
    await clickOn('#howto .modal-foot [data-close]', 700);
  });

  await scene('drop', async ({ cue }) => {
    await demo(() => window.demo.lower({ n: '02', k: 'Drop', c: 'Opened on your device' }));
    await demo(() => window.demo.scrollToEl('#input-panel', 64, 900));
    await demo(() => { document.getElementById('drop').classList.add('over'); window.demo.ring('#drop', 6); });
    await page.evaluate(() => window.demo.cursorTo('#drop', 700, 0, 34));
    await cue(4.4);
    await demo(() => { document.getElementById('drop').classList.remove('over'); window.demo.hideRing(); window.demo.hideCursor(); });
    await demo(() => window.demo.scrollTo(0, 800));
    await demo(() => window.demo.zoom('#lock', 1.55, 900));
    await demo(() => { window.demo.ring('#lock', 6); return window.demo.lower({ n: '02', k: 'Drop', c: 'Network locked: nothing is uploaded' }); });
    await cue(9.9);
    await demo(() => window.demo.hideRing());
    await demo(() => window.demo.unzoom(800));
  });

  await scene('sample', async ({ cue }) => {
    await demo(() => window.demo.lower({ n: '03', k: 'Read', c: 'Demo: a synthetic rider, no real person' }));
    await demo(() => window.demo.scrollToEl('#input-panel', 64, 800));
    await demo(() => { window.demo.showCursor(); window.demo.ring('#sample', 6); });
    await page.evaluate(() => window.demo.cursorTo('#sample', 800));
    await cue(5.2);
    await demo(() => window.demo.hideRing());
    await clickOn('#sample', 150);
    const clicked = Date.now();
    await pause(250);
    await demo(() => window.demo.ring('#preview', 6));
    await cue(5.6);
    await demo(() => window.demo.lower({ n: '03', k: 'Read', c: 'With your video, an open pose model finds the joints' }));
    await pause(Math.max(0, clicked + 3700 - Date.now()));
    await demo(() => window.demo.hideRing());
    await page.waitForFunction(() => window.bikefit.state.phase === 'done', null, { timeout: 20_000 });
  });

  await scene('knee', async ({ cue }) => {
    await pause(250);
    await demo(() => window.demo.hideCursor());
    await demo(() => window.demo.scrollToEl('.result-top', 24, 600));
    await demo(() => { window.demo.ring(['.headline .kicker', '#knee-big'], 10); return window.demo.lower({ k: 'Result', c: 'Knee bend at the bottom of each stroke' }); });
    await cue(3.0);
    await demo(() => { window.demo.ring('#knee-meter', 12); return window.demo.lower({ k: 'Result', c: 'Against the published range, 33 to 43°' }); });
  }, { hold: 0.1 }); // the next sentence follows on

  await scene('saddle', async () => {
    await demo(() => { window.demo.ring('#saddle-text', 6); return window.demo.lower({ k: 'Result', c: 'The saddle change, in millimetres' }); });
  });

  await scene('details', async ({ cue }) => {
    await demo(() => { window.demo.hideRing(); return window.demo.lower({ k: 'Details', c: 'Every angle, through the stroke' }); });
    await demo(() => window.demo.scrollToEl('.charts', 24, 700));
    const box = await page.locator('#chart-knee svg').boundingBox();
    await demo(() => window.demo.showCursor());
    if (box) {
      for (let k = 0; k <= 16; k++) {
        const x = box.x + box.width * (0.1 + (0.8 * k) / 16), y = box.y + box.height * 0.45;
        await page.evaluate(([px, py]) => window.demo.jump(px, py, 50), [x, y]);
        await page.mouse.move(x, y);
      }
    }
    await cue(2.0);
    await page.mouse.move(4, 4);
    await demo(() => window.demo.hideCursor());
    await demo(() => window.demo.scrollToEl('#table', 64, 700));
    await demo(() => { window.demo.ring('#table tbody tr:nth-child(4)', 2); return window.demo.lower({ k: 'Details', c: 'Next to book or manufacturer guidelines' }); });
    await cue(4.9);
    await demo(() => window.demo.hideRing());
    await demo(() => window.demo.scrollToEl('.downloads', 300, 700));
    await demo(() => { window.demo.showCursor(); window.demo.ring('#dl-report', 6); return window.demo.lower({ k: 'Details', c: 'A report to download and keep' }); });
    const [x, y] = await page.evaluate(() => window.demo.cursorTo('#dl-report', 600));
    await page.mouse.move(x, y);
  });

  await scene('proof', async ({ cue }) => {
    await page.mouse.move(4, 4);
    await demo(() => { window.demo.hideRing(); window.demo.hideCursor(); window.demo.hideLower(); });
    await demo((html) => window.demo.card(html), PROOF);
    await pause(300); await demo(() => window.demo.reveal(1));
    await cue(1.6); await demo(() => window.demo.reveal(2));
    await cue(2.1); await demo(() => window.demo.reveal(3));
    await cue(4.0); await demo(() => window.demo.reveal(4));
    await cue(6.9); await demo(() => window.demo.reveal(5));
  });

  await scene('outro', async () => {
    await demo((html) => window.demo.card(html), OUTRO);
    await pause(150); await demo(() => window.demo.reveal(1));
    await pause(500); await demo(() => window.demo.reveal(2));
    await pause(500); await demo(() => window.demo.reveal(3));
  }, { hold: 2.4 });

  endAt = Date.now() / 1000;
  await cdp.send('Page.stopScreencast');
  await pause(200);
} finally {
  await context.close();
  await browser.close();
  server.close();
}

// The frames come when the page repaints: each one lasts until the next.
const list = ['ffconcat version 1.0'];
frames.forEach((f, i) => {
  const next = i + 1 < frames.length ? frames[i + 1].t : endAt;
  list.push(`file '${f.file}'`, `duration ${Math.max(0.001, next - f.t).toFixed(4)}`);
});
list.push(`file '${frames.at(-1).file}'`);
await writeFile(join(out, 'frames.ffconcat'), `${list.join('\n')}\n`);
const silent = join(out, 'video.mp4');
run('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', join(out, 'frames.ffconcat'),
  '-vf', 'scale=1920:1080:flags=lanczos,fps=30,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-an', silent]);

const t0 = frames[0].t;
const total = endAt - t0;
const placed = marks.map((m) => ({ id: m.id, start: m.at - t0 + LEAD, dur: length[m.id] }));
const final = join(out, 'saddle-check-demo.mp4');
if (voice) {
  const inputs = placed.flatMap((p) => ['-i', join(voice, `${p.id}.mp3`)]);
  const chains = placed.map((p, i) => `[${i + 1}:a]atempo=${tempo},adelay=${Math.round(p.start * 1000)}:all=1[a${i}]`);
  const mix = `${placed.map((_, i) => `[a${i}]`).join('')}amix=inputs=${placed.length}:normalize=0:dropout_transition=0,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[aout]`;
  run('ffmpeg', ['-y', '-v', 'error', '-i', silent, ...inputs, '-filter_complex', [...chains, mix].join(';'),
    '-map', '0:v', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-t', total.toFixed(3), '-movflags', '+faststart', final]);
  const stamp = (s) => {
    const ms = Math.round(s * 1000);
    const p = (n, w = 2) => String(n).padStart(w, '0');
    return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
  };
  await writeFile(join(out, 'saddle-check-demo.srt'), placed.map((p, i) => `${i + 1}\n${stamp(p.start)} --> ${stamp(p.start + p.dur)}\n${say[p.id]}\n`).join('\n'));
} else {
  run('ffmpeg', ['-y', '-v', 'error', '-i', silent, '-c', 'copy', '-movflags', '+faststart', final]);
}
await rm(framesDir, { recursive: true, force: true });
const fps = frames.length / total;
console.log(`recorded ${final}: ${total.toFixed(1)} s, ${frames.length} frames (${fps.toFixed(1)} per second captured)`);
console.log(placed.map((p) => `${p.id} ${p.start.toFixed(2)}–${(p.start + p.dur).toFixed(2)} s`).join('\n'));
