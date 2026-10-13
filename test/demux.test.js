import { test } from 'node:test';
import assert from 'node:assert/strict';
import { videoSamplesFromMoov } from '../web/demux.js';

function box(t, ...parts) {
  const body = Buffer.concat(parts.map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p))));
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + body.length, 0);
  head.write(t, 4, 'latin1');
  return Buffer.concat([head, body]);
}
const u32 = (...xs) => { const b = Buffer.alloc(4 * xs.length); xs.forEach((x, i) => b.writeUInt32BE(x >>> 0, 4 * i)); return b; };
const i32s = (...xs) => { const b = Buffer.alloc(4 * xs.length); xs.forEach((x, i) => b.writeInt32BE(x, 4 * i)); return b; };
const u16 = (...xs) => { const b = Buffer.alloc(2 * xs.length); xs.forEach((x, i) => b.writeUInt16BE(x, 2 * i)); return b; };

function avc1(width, height) {
  const visual = Buffer.concat([Buffer.alloc(6), u16(1), Buffer.alloc(16), u16(width, height), u32(0x00480000, 0x00480000), u32(0), u16(1), Buffer.alloc(32), u16(0x18), u16(0xffff)]);
  const avcC = box('avcC', Buffer.from([1, 0x64, 0x00, 0x28, 0xff, 0xe1]));
  return box('avc1', visual, avcC);
}

function moov({ rotation = 0 } = {}) {
  // 5 samples in 2 chunks (3 + 2), sizes 100..104, key frames 1 and 4, 30 fps at timescale 3000.
  const stsd = box('stsd', u32(0, 1), avc1(1920, 1080));
  const stsz = box('stsz', u32(0, 0, 5, 100, 101, 102, 103, 104));
  const stco = box('stco', u32(0, 2, 5000, 9000));
  const stsc = box('stsc', u32(0, 2, 1, 3, 1, 2, 2, 1));
  const stss = box('stss', u32(0, 2, 1, 4));
  const stts = box('stts', u32(0, 1, 5, 100));
  const ctts = box('ctts', u32(0, 2, 1, 100), i32s(), u32(4, 0));
  const stbl = box('stbl', stsd, stts, ctts, stss, stsz, stsc, stco);
  const hdlr = box('hdlr', u32(0, 0), Buffer.from('vide'), u32(0, 0, 0));
  const mdhd = box('mdhd', u32(0, 0, 0, 3000, 500), u32(0));
  const mdia = box('mdia', mdhd, hdlr, box('minf', stbl));
  const fixed = (x) => Math.round(x * 65536);
  const rad = (rotation * Math.PI) / 180;
  const matrix = i32s(fixed(Math.cos(rad)), fixed(Math.sin(rad)), 0, fixed(-Math.sin(rad)), fixed(Math.cos(rad)), 0, 0, 0, 1 << 30);
  const tkhd = box('tkhd', u32(0, 0, 0, 1, 0, 500), Buffer.alloc(8), u16(0, 0, 0, 0), matrix, u32(1920 << 16, 1080 << 16));
  return box('moov', box('mvhd', u32(0)), box('trak', tkhd, mdia));
}
const view = (buf) => new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

test('samples: offsets across chunks, key frames, presentation times, codec string', () => {
  const d = videoSamplesFromMoov(view(moov()));
  assert.equal(d.codec, 'avc1.640028');
  assert.equal(d.width, 1920);
  assert.equal(d.height, 1080);
  assert.equal(d.rotation, 0);
  assert.deepEqual(d.samples.map((s) => s.offset), [5000, 5100, 5201, 9000, 9103]);
  assert.deepEqual(d.samples.map((s) => s.key), [true, false, false, true, false]);
  // dts 0,100,200,300,400 ; ctts +100 for the first sample only
  assert.deepEqual(d.samples.map((s) => Math.round(s.time * 3000)), [100, 100, 200, 300, 400]);
  assert.deepEqual(Array.from(d.description), [1, 0x64, 0x00, 0x28, 0xff, 0xe1]);
});

test('rotation read from the track header', () => {
  assert.equal(videoSamplesFromMoov(view(moov({ rotation: 180 }))).rotation, 180);
  assert.equal(videoSamplesFromMoov(view(moov({ rotation: 90 }))).rotation, 90);
});
