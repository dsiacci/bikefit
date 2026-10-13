// The presentation time of every video frame, read from the MP4 / QuickTime
// boxes of the file (moov > trak > mdia > minf > stbl: stts, ctts; edts > elst).
// Phones write .mp4 and .mov files with the same box structure. With exact frame
// times the page can seek to each frame once, instead of stepping blindly.
// Pure data parsing: no DOM, so it runs in Node for the tests.

function readU32(v, o) { return v.getUint32(o); }
function readU64(v, o) { return v.getUint32(o) * 2 ** 32 + v.getUint32(o + 4); }
function type(v, o) { return String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3)); }

/** Iterate the child boxes of [start, end) in a DataView: yields {type, start (payload), end}. */
function* boxes(v, start, end) {
  let o = start;
  while (o + 8 <= end) {
    let size = readU32(v, o);
    const t = type(v, o + 4);
    let header = 8;
    if (size === 1) { size = readU64(v, o + 8); header = 16; } else if (size === 0) size = end - o;
    if (size < header || o + size > end) return;
    yield { type: t, start: o + header, end: o + size };
    o += size;
  }
}

function child(v, box, name) {
  for (const b of boxes(v, box.start, box.end)) if (b.type === name) return b;
  return null;
}

/** Parse a moov box (as a DataView over its bytes, header included) into frame times in seconds. */
export function frameTimesFromMoov(v) {
  const moov = boxes(v, 0, v.byteLength).next().value;
  if (!moov || moov.type !== 'moov') return null;
  for (const trak of boxes(v, moov.start, moov.end)) {
    if (trak.type !== 'trak') continue;
    const mdia = child(v, trak, 'mdia');
    if (!mdia) continue;
    const hdlr = child(v, mdia, 'hdlr');
    if (!hdlr || type(v, hdlr.start + 8) !== 'vide') continue;
    const mdhd = child(v, mdia, 'mdhd');
    const version = v.getUint8(mdhd.start);
    const timescale = version === 1 ? readU32(v, mdhd.start + 20) : readU32(v, mdhd.start + 12);
    const minf = child(v, mdia, 'minf');
    const stbl = minf && child(v, minf, 'stbl');
    if (!mdhd || !stbl) continue;
    const stts = child(v, stbl, 'stts');
    if (!stts || !timescale) continue;
    // Decode times.
    const dts = [];
    let t = 0;
    const n = readU32(v, stts.start + 4);
    for (let i = 0; i < n; i++) {
      const count = readU32(v, stts.start + 8 + i * 8), delta = readU32(v, stts.start + 12 + i * 8);
      for (let k = 0; k < count; k++) { dts.push(t); t += delta; }
    }
    // Composition offsets (frames stored out of display order).
    const pts = dts.slice();
    const ctts = child(v, stbl, 'ctts');
    if (ctts) {
      const cv = v.getUint8(ctts.start);
      const m = readU32(v, ctts.start + 4);
      let s = 0;
      for (let i = 0; i < m; i++) {
        const count = readU32(v, ctts.start + 8 + i * 8);
        const off = cv === 1 ? v.getInt32(ctts.start + 12 + i * 8) : readU32(v, ctts.start + 12 + i * 8);
        for (let k = 0; k < count && s < pts.length; k++, s++) pts[s] += off;
      }
    }
    // Edit list: where presentation starts in the media timeline.
    let mediaStart = 0;
    const edts = child(v, trak, 'edts');
    const elst = edts && child(v, edts, 'elst');
    if (elst && readU32(v, elst.start + 4) > 0) {
      const ev = v.getUint8(elst.start);
      // Skip an empty first edit (media_time -1), take the first real one.
      const count = readU32(v, elst.start + 4);
      for (let i = 0; i < count; i++) {
        const base = elst.start + 8 + i * (ev === 1 ? 20 : 12);
        const mediaTime = ev === 1 ? readU64(v, base + 8) : v.getInt32(base + 4);
        if (mediaTime >= 0 && mediaTime < 2 ** 52) { mediaStart = mediaTime; break; }
      }
    }
    const times = pts.map((p) => (p - mediaStart) / timescale).filter((x) => x >= 0).sort((a, b) => a - b);
    return times.length ? times : null;
  }
  return null;
}

/** Find the moov box of a File/Blob and return the frame times, or null. Reads only box headers and the moov box. */
export async function frameTimes(file) {
  const size = file.size;
  let o = 0;
  for (let guard = 0; guard < 64 && o + 8 <= size; guard++) {
    const head = new DataView(await file.slice(o, Math.min(size, o + 16)).arrayBuffer());
    let boxSize = readU32(head, 0);
    const t = type(head, 4);
    if (boxSize === 1) boxSize = readU64(head, 8);
    else if (boxSize === 0) boxSize = size - o;
    if (boxSize < 8) return null;
    if (t === 'moov') {
      if (boxSize > 64 * 1024 * 1024) return null;
      const v = new DataView(await file.slice(o, o + boxSize).arrayBuffer());
      try { return frameTimesFromMoov(v); } catch { return null; }
    }
    o += boxSize;
  }
  return null;
}
