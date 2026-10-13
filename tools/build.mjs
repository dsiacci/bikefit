// Puts the pose model and its runtime next to the page, so the site serves
// everything itself and the browser never calls another host:
// - the MediaPipe Tasks Vision bundle and WebAssembly files, copied from the
//   pinned npm package (Apache License 2.0);
// - the Pose Landmarker model files, downloaded from Google's model storage
//   and checked against the SHA-256 recorded in tools/assets.json.
// Usage: npm ci && node tools/build.mjs

import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const assets = JSON.parse(await readFile(join(ROOT, 'tools/assets.json'), 'utf8'));

const pkg = join(ROOT, 'node_modules/@mediapipe/tasks-vision');
const installed = JSON.parse(await readFile(join(pkg, 'package.json'), 'utf8')).version;
if (installed !== assets.tasksVision.version) {
  throw new Error(`@mediapipe/tasks-vision ${installed} is installed, tools/assets.json pins ${assets.tasksVision.version}`);
}
const vendor = join(ROOT, 'web/vendor/tasks-vision');
await mkdir(join(vendor, 'wasm'), { recursive: true });
for (const file of assets.tasksVision.files) await cp(join(pkg, file), join(vendor, file), { recursive: true });
// The npm package ships no license file; Apache 2.0 section 4(a) asks for a copy.
await cp(join(ROOT, 'LICENSE'), join(vendor, 'LICENSE'));
console.log(`tasks-vision ${installed}: ${assets.tasksVision.files.join(', ')}`);

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
await mkdir(join(ROOT, 'web/models'), { recursive: true });
for (const [name, m] of Object.entries(assets.models)) {
  const target = join(ROOT, 'web/models', name);
  try {
    await access(target);
    if (sha256(await readFile(target)) === m.sha256) { console.log(`${name}: already here, checksum ok`); continue; }
  } catch { /* not downloaded yet */ }
  const res = await fetch(m.url);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status} from ${m.url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const got = sha256(buf);
  if (got !== m.sha256) throw new Error(`${name}: checksum ${got} does not match ${m.sha256}`);
  await writeFile(target, buf);
  console.log(`${name}: ${(buf.length / 1e6).toFixed(1)} MB, checksum ok`);
}
