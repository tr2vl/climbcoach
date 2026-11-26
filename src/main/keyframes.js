// When to look at a video while reading its HUD. Seeking to a keyframe decodes one frame; seeking
// anywhere else decodes everything since the keyframe before it (OBS puts one every ~4 s at 60 fps, so a
// second-by-second scan decodes about 2 s of video per look). So the scan looks at the keyframes, about one
// per second when there are many, and adds looks only where they are far apart. Death screens stay up
// ~10 s and kill-feed lines ~5 s, so looks at most ~4 s apart still see each of them.
import fsp from 'node:fs/promises';
import { readFragment, readTracks } from './trim.js';

const MAX_GAP = 4.5;
const FILL = 3;

async function readAt(handle, position, length) {
  const buf = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buf, 0, length, position);
  return buf.subarray(0, bytesRead);
}

function boxesIn(buf, start, end) {
  const list = [];
  for (let at = start; at + 8 <= end;) {
    const size = buf.readUInt32BE(at);
    if (size < 8 || at + size > end) break;
    list.push({ type: buf.toString('latin1', at + 4, at + 8), at, size, body: at + 8 });
    at += size;
  }
  return list;
}
const child = (buf, box, type) => boxesIn(buf, box.body, box.at + box.size).find((b) => b.type === type) ?? null;

/** Keyframe times in seconds from a regular MP4's sample tables (stss + stts), or null. */
export function keyframesFromMoov(moov) {
  for (const trak of boxesIn(moov, 8, moov.length).filter((b) => b.type === 'trak')) {
    const mdia = child(moov, trak, 'mdia');
    const hdlr = mdia && child(moov, mdia, 'hdlr');
    if (!hdlr || moov.toString('latin1', hdlr.body + 8, hdlr.body + 12) !== 'vide') continue;
    const mdhd = child(moov, mdia, 'mdhd');
    const timescale = moov.readUInt32BE(mdhd.body + (moov[mdhd.body] === 1 ? 20 : 12));
    const minf = child(moov, mdia, 'minf');
    const stbl = minf && child(moov, minf, 'stbl');
    const stts = stbl && child(moov, stbl, 'stts');
    const stss = stbl && child(moov, stbl, 'stss');
    if (!stts || !timescale) return null;
    if (!stss) return []; // every sample is a keyframe: any time is cheap
    const wanted = [];
    for (let i = 0, count = moov.readUInt32BE(stss.body + 4); i < count; i += 1) wanted.push(moov.readUInt32BE(stss.body + 8 + i * 4));
    const times = [];
    let sample = 1;
    let time = 0;
    let next = 0;
    for (let i = 0, entries = moov.readUInt32BE(stts.body + 4); i < entries && next < wanted.length; i += 1) {
      const count = moov.readUInt32BE(stts.body + 8 + i * 8);
      const delta = moov.readUInt32BE(stts.body + 12 + i * 8);
      while (next < wanted.length && wanted[next] < sample + count) {
        times.push((time + (wanted[next] - sample) * delta) / timescale);
        next += 1;
      }
      sample += count;
      time += count * delta;
    }
    return times;
  }
  return null;
}

/** Keyframe times of an MP4 or MOV file (regular or fragmented), or null when they can't be read. */
export async function keyframeTimes(file) {
  let handle;
  try {
    handle = await fsp.open(file, 'r');
    const { size } = await handle.stat();
    const top = [];
    for (let at = 0; at + 8 <= size;) {
      const head = await readAt(handle, at, 16);
      if (head.length < 8) break;
      let boxSize = head.readUInt32BE(0);
      if (boxSize === 1 && head.length >= 16) boxSize = Number(head.readBigUInt64BE(8)); else if (boxSize === 0) boxSize = size - at;
      if (boxSize < 8) break;
      top.push({ type: head.toString('latin1', 4, 8), at, size: boxSize });
      at += boxSize;
    }
    const moovBox = top.find((b) => b.type === 'moov');
    if (!moovBox || moovBox.size > 64 * 1024 * 1024) return null;
    const moov = await readAt(handle, moovBox.at, moovBox.size);
    const moofs = top.filter((b) => b.type === 'moof');
    if (!moofs.length) return keyframesFromMoov(moov);
    // Fragmented (like ClimbCoach's own recordings): the fragments that start on a keyframe.
    const tracks = readTracks(moov);
    const video = [...tracks.values()].find((t) => t.kind === 'vide');
    if (!video) return null;
    const times = [];
    for (const box of moofs) {
      const facts = readFragment(await readAt(handle, box.at, box.size), tracks);
      const v = facts?.tracks.get(video.id);
      if (v?.keyframe) times.push(v.base / video.timescale);
    }
    return times;
  } catch {
    return null;
  } finally {
    await handle?.close();
  }
}

/**
 * The times to look at: keyframes at least ~1 s apart, plus extra looks every 3 s where keyframes are more
 * than 4.5 s apart (and at the start and end). Without keyframe times (other formats), every 2 s.
 */
export function sampleTimes(keyframes, duration) {
  if (!(duration > 0)) return [];
  if (!keyframes) return Array.from({ length: Math.ceil(duration / 2) }, (_, i) => i * 2);
  if (!keyframes.length) return Array.from({ length: Math.ceil(duration) }, (_, i) => i);
  const picks = [];
  const add = (t) => { if (t >= 0 && t < duration && (!picks.length || t - picks.at(-1) >= 0.9)) picks.push(t); };
  let last = 0;
  add(0);
  for (const key of [...keyframes.filter((k) => k < duration), duration].sort((a, b) => a - b)) {
    if (key - last > MAX_GAP) for (let t = last + FILL; t < key - 1; t += FILL) add(t);
    if (key < duration) add(key);
    last = picks.at(-1) ?? key;
  }
  return picks;
}
