// The video samples of an MP4 / QuickTime file, read from its boxes, for
// decoding frame after frame with WebCodecs: where each compressed frame sits in
// the file, whether it is a key frame, its presentation time, and the decoder
// configuration. Seeking a <video> element decodes again from the last key frame
// for every frame; reading the samples in order decodes each frame once.
// Pure data parsing: no DOM, so it runs in Node for the tests.

const u8 = (v, o) => v.getUint8(o);
const u16 = (v, o) => v.getUint16(o);
const u32 = (v, o) => v.getUint32(o);
const u64 = (v, o) => v.getUint32(o) * 2 ** 32 + v.getUint32(o + 4);
const fourcc = (v, o) => String.fromCharCode(u8(v, o), u8(v, o + 1), u8(v, o + 2), u8(v, o + 3));

function* boxes(v, start, end) {
  let o = start;
  while (o + 8 <= end) {
    let size = u32(v, o);
    const type = fourcc(v, o + 4);
    let header = 8;
    if (size === 1) { size = u64(v, o + 8); header = 16; } else if (size === 0) size = end - o;
    if (size < header || o + size > end) return;
    yield { type, start: o + header, end: o + size, boxStart: o };
    o += size;
  }
}
const child = (v, box, name) => {
  if (!box) return null;
  for (const b of boxes(v, box.start, box.end)) if (b.type === name) return b;
  return null;
};
const hex2 = (n) => n.toString(16).padStart(2, '0');

/** Codec string for an avcC box: avc1.PPCCLL. */
function avcCodec(entry, v, avcC) {
  return `${entry}.${hex2(u8(v, avcC.start + 1))}${hex2(u8(v, avcC.start + 2))}${hex2(u8(v, avcC.start + 3))}`;
}

/** Codec string for an hvcC box (ISO/IEC 14496-15, annex E). */
function hevcCodec(entry, v, hvcC) {
  const o = hvcC.start;
  const b1 = u8(v, o + 1);
  const space = ['', 'A', 'B', 'C'][b1 >> 6];
  const tier = (b1 >> 5) & 1 ? 'H' : 'L';
  const profile = b1 & 0x1f;
  let compat = u32(v, o + 2);
  let reversed = 0;
  for (let i = 0; i < 32; i++) { reversed = (reversed << 1) | (compat & 1); compat >>>= 1; }
  const level = u8(v, o + 12);
  const constraints = [];
  for (let i = 0; i < 6; i++) constraints.push(u8(v, o + 6 + i));
  while (constraints.length && constraints[constraints.length - 1] === 0) constraints.pop();
  return [`${entry}`, `${space}${profile}`, (reversed >>> 0).toString(16), `${tier}${level}`, ...constraints.map((c) => c.toString(16))].join('.');
}

/**
 * Parse a moov box (DataView over its bytes, header included). Returns
 * {codec, description, width, height, rotation, samples: [{offset, size, key, time}]}
 * for the first video track, times in seconds from the start of presentation,
 * in decoding order; or null.
 */
export function videoSamplesFromMoov(v) {
  const moov = boxes(v, 0, v.byteLength).next().value;
  if (!moov || moov.type !== 'moov') return null;
  for (const trak of boxes(v, moov.start, moov.end)) {
    if (trak.type !== 'trak') continue;
    const mdia = child(v, trak, 'mdia');
    const hdlr = child(v, mdia, 'hdlr');
    if (!hdlr || fourcc(v, hdlr.start + 8) !== 'vide') continue;
    const mdhd = child(v, mdia, 'mdhd');
    const timescale = u8(v, mdhd.start) === 1 ? u32(v, mdhd.start + 20) : u32(v, mdhd.start + 12);
    const stbl = child(v, child(v, mdia, 'minf'), 'stbl');
    const stsd = child(v, stbl, 'stsd');
    if (!stsd || !timescale) return null;
    // Sample entry: 8 bytes after the full-box header and entry count.
    const entry = boxes(v, stsd.start + 8, stsd.end).next().value;
    if (!entry) return null;
    const width = u16(v, entry.start + 24), height = u16(v, entry.start + 26);
    // Visual sample entry fields take 78 bytes before the child boxes.
    const cfgBox = child(v, { start: entry.start + 78, end: entry.end }, 'avcC') ?? child(v, { start: entry.start + 78, end: entry.end }, 'hvcC');
    if (!cfgBox) return null;
    const codec = cfgBox.type === 'avcC' ? avcCodec(entry.type, v, cfgBox) : hevcCodec(entry.type, v, cfgBox);
    const description = new Uint8Array(v.buffer, v.byteOffset + cfgBox.start, cfgBox.end - cfgBox.start).slice();

    // Sizes.
    const stsz = child(v, stbl, 'stsz');
    const fixed = u32(v, stsz.start + 4), count = u32(v, stsz.start + 8);
    const sizes = new Array(count);
    for (let i = 0; i < count; i++) sizes[i] = fixed || u32(v, stsz.start + 12 + 4 * i);
    // Chunk offsets.
    const stco = child(v, stbl, 'stco'), co64 = child(v, stbl, 'co64');
    const chunkOffsets = [];
    if (stco) for (let i = 0, n = u32(v, stco.start + 4); i < n; i++) chunkOffsets.push(u32(v, stco.start + 8 + 4 * i));
    else if (co64) for (let i = 0, n = u32(v, co64.start + 4); i < n; i++) chunkOffsets.push(u64(v, co64.start + 8 + 8 * i));
    else return null;
    // Samples per chunk.
    const stsc = child(v, stbl, 'stsc');
    const runs = [];
    for (let i = 0, n = u32(v, stsc.start + 4); i < n; i++) {
      runs.push({ first: u32(v, stsc.start + 8 + 12 * i), perChunk: u32(v, stsc.start + 12 + 12 * i) });
    }
    const offsets = new Array(count);
    let s = 0;
    for (let c = 0; c < chunkOffsets.length && s < count; c++) {
      let r = runs.length - 1;
      while (r > 0 && runs[r].first > c + 1) r--;
      let o = chunkOffsets[c];
      for (let k = 0; k < runs[r].perChunk && s < count; k++, s++) { offsets[s] = o; o += sizes[s]; }
    }
    // Key frames (no stss: every sample is a key frame).
    const stss = child(v, stbl, 'stss');
    let keys = null;
    if (stss) {
      keys = new Set();
      for (let i = 0, n = u32(v, stss.start + 4); i < n; i++) keys.add(u32(v, stss.start + 8 + 4 * i) - 1);
    }
    // Times: decoding times, composition offsets, edit list.
    const stts = child(v, stbl, 'stts');
    const dts = [];
    let t = 0;
    for (let i = 0, n = u32(v, stts.start + 4); i < n; i++) {
      const c = u32(v, stts.start + 8 + 8 * i), d = u32(v, stts.start + 12 + 8 * i);
      for (let k = 0; k < c; k++) { dts.push(t); t += d; }
    }
    const pts = dts.slice();
    const ctts = child(v, stbl, 'ctts');
    if (ctts) {
      let k = 0;
      for (let i = 0, n = u32(v, ctts.start + 4); i < n; i++) {
        const c = u32(v, ctts.start + 8 + 8 * i), off = v.getInt32(ctts.start + 12 + 8 * i);
        for (let j = 0; j < c && k < pts.length; j++, k++) pts[k] += off;
      }
    }
    let mediaStart = 0;
    const elst = child(v, child(v, trak, 'edts'), 'elst');
    if (elst) {
      const ver = u8(v, elst.start);
      for (let i = 0, n = u32(v, elst.start + 4); i < n; i++) {
        const base = elst.start + 8 + i * (ver === 1 ? 20 : 12);
        const mt = ver === 1 ? u64(v, base + 8) : v.getInt32(base + 4);
        if (mt >= 0 && mt < 2 ** 52) { mediaStart = mt; break; }
      }
    }
    // Display rotation from the track header matrix (phones filming upside down
    // or in portrait store it there; a <video> element applies it, WebCodecs does not).
    let rotation = 0;
    const tkhd = child(v, trak, 'tkhd');
    if (tkhd) {
      const m = tkhd.start + (u8(v, tkhd.start) === 1 ? 52 : 40);
      const a = v.getInt32(m), b = v.getInt32(m + 4);
      rotation = Math.round((Math.atan2(b, a) * 180) / Math.PI);
      rotation = ((rotation % 360) + 360) % 360;
    }
    const samples = [];
    for (let i = 0; i < count; i++) {
      if (offsets[i] === undefined) break;
      samples.push({ offset: offsets[i], size: sizes[i], key: keys ? keys.has(i) : true, time: (pts[i] - mediaStart) / timescale });
    }
    return { codec, description, width, height, rotation, samples };
  }
  return null;
}

/** Find the moov box of a File/Blob and return its video samples, or null. */
export async function videoSamples(file) {
  const size = file.size;
  let o = 0;
  for (let guard = 0; guard < 64 && o + 8 <= size; guard++) {
    const head = new DataView(await file.slice(o, Math.min(size, o + 16)).arrayBuffer());
    let boxSize = u32(head, 0);
    const type = fourcc(head, 4);
    if (boxSize === 1) boxSize = u64(head, 8);
    else if (boxSize === 0) boxSize = size - o;
    if (boxSize < 8) return null;
    if (type === 'moov') {
      if (boxSize > 64 * 1024 * 1024) return null;
      try { return videoSamplesFromMoov(new DataView(await file.slice(o, o + boxSize).arrayBuffer())); } catch { return null; }
    }
    o += boxSize;
  }
  return null;
}
