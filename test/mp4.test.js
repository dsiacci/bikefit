import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frameTimesFromMoov, frameTimes } from '../web/mp4.js';

// Build boxes by hand: size (u32) + type + payload.
function box(t, ...parts) {
  const body = Buffer.concat(parts.map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p))));
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + body.length, 0);
  head.write(t, 4, 'latin1');
  return Buffer.concat([head, body]);
}
const u32 = (...xs) => { const b = Buffer.alloc(4 * xs.length); xs.forEach((x, i) => b.writeUInt32BE(x >>> 0, 4 * i)); return b; };
const i32 = (x) => { const b = Buffer.alloc(4); b.writeInt32BE(x, 0); return b; };

function moov({ timescale = 600, deltas, ctts = null, mediaTime = null }) {
  const stts = box('stts', u32(0, deltas.length), ...deltas.map(([count, delta]) => u32(count, delta)));
  const parts = [stts];
  if (ctts) parts.push(box('ctts', u32(0, ctts.length), ...ctts.map(([count, off]) => u32(count, off))));
  const stbl = box('stbl', ...parts);
  const minf = box('minf', box('vmhd', u32(0, 0, 0)), stbl);
  const hdlr = box('hdlr', u32(0, 0), Buffer.from('vide'), u32(0, 0, 0));
  const mdhd = box('mdhd', u32(0, 0, 0, timescale, 6000), u32(0));
  const mdia = box('mdia', mdhd, hdlr, minf);
  const trakParts = [box('tkhd', u32(0, 0, 0, 1))];
  if (mediaTime !== null) trakParts.push(box('edts', box('elst', u32(0, 1), u32(6000), i32(mediaTime), u32(65536))));
  trakParts.push(mdia);
  // An audio track first, to check that the video track is the one read.
  const audio = box('trak', box('mdia', box('mdhd', u32(0, 0, 0, 44100, 0), u32(0)), box('hdlr', u32(0, 0), Buffer.from('soun'), u32(0, 0, 0))));
  return box('moov', box('mvhd', u32(0, 0, 0, 600, 6000)), audio, box('trak', ...trakParts));
}

const view = (buf) => new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

test('constant frame rate: 60 frames per second', () => {
  const times = frameTimesFromMoov(view(moov({ timescale: 600, deltas: [[120, 10]] })));
  assert.equal(times.length, 120);
  assert.ok(Math.abs(times[1] - 1 / 60) < 1e-12);
  assert.ok(Math.abs(times[119] - 119 / 60) < 1e-12);
});

test('composition offsets reorder frames, the edit list shifts the start', () => {
  // 4 frames stored I P B B with offsets, then a 20-unit edit.
  const times = frameTimesFromMoov(view(moov({ timescale: 600, deltas: [[4, 20]], ctts: [[1, 20], [1, 60], [2, 0]], mediaTime: 20 })));
  // dts 0,20,40,60 ; pts 20,80,40,60 ; minus 20 -> 0,60,20,40 sorted -> 0,20,40,60 units
  assert.deepEqual(times.map((t) => Math.round(t * 600)), [0, 20, 40, 60]);
});

test('reads the moov box from a file, after the media data', async () => {
  const mdat = box('mdat', Buffer.alloc(5000));
  const ftyp = box('ftyp', Buffer.from('qt  '), u32(0));
  const file = new Blob([ftyp, mdat, moov({ timescale: 30000, deltas: [[90, 1001]] })]);
  const times = await frameTimes(file);
  assert.equal(times.length, 90);
  assert.ok(Math.abs(1 / (times[1] - times[0]) - 29.97) < 0.01);
});

test('a file without moov gives null', async () => {
  assert.equal(await frameTimes(new Blob([box('ftyp', Buffer.from('isom'))])), null);
});
