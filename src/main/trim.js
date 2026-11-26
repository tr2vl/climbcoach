// Cuts a recording to the match without re-encoding (the Windows counterpart of RecordingTrimmer, which
// uses AVFoundation on the Mac). ClimbCoach records fragmented MP4: a header (ftyp + moov), then one
// fragment (moof + mdat) about every 2 seconds, each starting on a video keyframe. Cutting keeps the header
// and the fragments that cover the match, moves their timestamps so the video starts at 0, and renumbers
// them. Nothing is decoded, so it takes as long as copying the file. Anything unexpected leaves the file
// as it was.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'mvex', 'moof', 'traf', 'edts', 'dinf']);

/** The boxes in buf[start, end): { type, at, size, body }. */
function boxesIn(buf, start, end) {
  const list = [];
  let at = start;
  while (at + 8 <= end) {
    let size = buf.readUInt32BE(at);
    const type = buf.toString('latin1', at + 4, at + 8);
    let header = 8;
    if (size === 1) { size = Number(buf.readBigUInt64BE(at + 8)); header = 16; } else if (size === 0) size = end - at;
    if (size < header || at + size > end) break;
    list.push({ type, at, size, body: at + header });
    at += size;
  }
  return list;
}

const child = (buf, box, type) => boxesIn(buf, box.body, box.at + box.size).find((b) => b.type === type) ?? null;
const childrenOf = (buf, box, type) => boxesIn(buf, box.body, box.at + box.size).filter((b) => b.type === type);

/** Track id → { timescale, kind, defaultDuration, defaultFlags } from the moov box. */
export function readTracks(moov) {
  const root = { at: 0, size: moov.length, body: 8 };
  const tracks = new Map();
  for (const trak of childrenOf(moov, root, 'trak')) {
    const tkhd = child(moov, trak, 'tkhd');
    const mdia = child(moov, trak, 'mdia');
    const mdhd = mdia && child(moov, mdia, 'mdhd');
    const hdlr = mdia && child(moov, mdia, 'hdlr');
    if (!tkhd || !mdhd || !hdlr) continue;
    const id = moov.readUInt32BE(tkhd.body + (moov[tkhd.body] === 1 ? 20 : 12));
    const timescale = moov.readUInt32BE(mdhd.body + (moov[mdhd.body] === 1 ? 20 : 12));
    tracks.set(id, { id, timescale, kind: moov.toString('latin1', hdlr.body + 8, hdlr.body + 12), defaultDuration: 0, defaultFlags: 0 });
  }
  const mvex = child(moov, root, 'mvex');
  for (const trex of mvex ? childrenOf(moov, mvex, 'trex') : []) {
    const track = tracks.get(moov.readUInt32BE(trex.body + 4));
    if (track) Object.assign(track, { defaultDuration: moov.readUInt32BE(trex.body + 12), defaultFlags: moov.readUInt32BE(trex.body + 20) });
  }
  return tracks;
}

/**
 * One fragment's facts from its moof box: per track the decode time (and where it is stored), the length
 * of its samples, and whether the first sample is a keyframe. Null when the fragment uses absolute data
 * offsets, which a cut would break.
 */
export function readFragment(moof, tracks) {
  const root = { at: 0, size: moof.length, body: 8 };
  const mfhd = child(moof, root, 'mfhd');
  const result = { sequenceAt: mfhd ? mfhd.body + 4 : null, tracks: new Map() };
  for (const traf of childrenOf(moof, root, 'traf')) {
    const tfhd = child(moof, traf, 'tfhd');
    const tfdt = child(moof, traf, 'tfdt');
    if (!tfhd || !tfdt) return null;
    const flags = moof.readUInt32BE(tfhd.body) & 0xffffff;
    if (flags & 0x1) return null; // base-data-offset-present: offsets point into the old file
    const track = tracks.get(moof.readUInt32BE(tfhd.body + 4));
    if (!track) continue;
    let p = tfhd.body + 8;
    if (flags & 0x2) p += 4;
    const defaultDuration = flags & 0x8 ? moof.readUInt32BE(p) : track.defaultDuration;
    if (flags & 0x8) p += 4;
    if (flags & 0x10) p += 4;
    const defaultFlags = flags & 0x20 ? moof.readUInt32BE(p) : track.defaultFlags;
    const version = moof[tfdt.body];
    const base = version === 1 ? Number(moof.readBigUInt64BE(tfdt.body + 4)) : moof.readUInt32BE(tfdt.body + 4);
    let duration = 0;
    let firstFlags = null;
    for (const trun of childrenOf(moof, traf, 'trun')) {
      const runFlags = moof.readUInt32BE(trun.body) & 0xffffff;
      const count = moof.readUInt32BE(trun.body + 4);
      let q = trun.body + 8;
      if (runFlags & 0x1) q += 4;
      let runFirst = null;
      if (runFlags & 0x4) { runFirst = moof.readUInt32BE(q); q += 4; }
      const fields = [0x100, 0x200, 0x400, 0x800].filter((bit) => runFlags & bit).length;
      for (let i = 0; i < count; i += 1) {
        const sampleAt = q + i * fields * 4;
        duration += runFlags & 0x100 ? moof.readUInt32BE(sampleAt) : defaultDuration;
        if (firstFlags == null && i === 0) {
          const offset = (runFlags & 0x100 ? 4 : 0) + (runFlags & 0x200 ? 4 : 0);
          firstFlags = runFirst ?? (runFlags & 0x400 ? moof.readUInt32BE(sampleAt + offset) : defaultFlags);
        }
      }
    }
    result.tracks.set(track.id, {
      base, version, baseAt: tfdt.body + 4, duration,
      keyframe: firstFlags == null ? false : ((firstFlags >>> 16) & 1) === 0,
    });
  }
  return result;
}

async function readAt(handle, position, length) {
  const buf = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buf, 0, length, position);
  return bytesRead === length ? buf : null;
}

/** The top-level boxes of a file, stopping at a cut-off box at the end (a recording that didn't finish). */
async function topLevel(handle, size) {
  const list = [];
  let at = 0;
  while (at + 8 <= size) {
    const head = await readAt(handle, at, Math.min(16, size - at));
    if (!head) break;
    let boxSize = head.readUInt32BE(0);
    const type = head.toString('latin1', 4, 8);
    if (boxSize === 1 && head.length >= 16) boxSize = Number(head.readBigUInt64BE(8)); else if (boxSize === 0) boxSize = size - at;
    if (boxSize < 8 || at + boxSize > size) break;
    list.push({ type, at, size: boxSize });
    at += boxSize;
  }
  return list;
}

/**
 * Cuts `file` to about [start, end] seconds, in place. The cut starts at the keyframe at or before `start`,
 * so it can begin up to one fragment (~2 s) early. Returns { offset, duration }: the seconds removed from
 * the front (subtract it from every time measured in the old file) and the new length. Returns null and
 * leaves the file alone when it isn't a fragmented MP4 or there's nothing to cut.
 */
export async function trimRecording(file, start, end, { onProgress = () => {} } = {}) {
  const handle = await fsp.open(file, 'r');
  let temporary = null;
  try {
    const { size } = await handle.stat();
    const boxes = await topLevel(handle, size);
    const moovBox = boxes.find((b) => b.type === 'moov');
    const firstMoof = boxes.findIndex((b) => b.type === 'moof');
    if (!moovBox || firstMoof < 0) return null;
    const tracks = readTracks(await readAt(handle, moovBox.at, moovBox.size));
    const video = [...tracks.values()].find((t) => t.kind === 'vide');
    if (!video) return null;

    // Fragments: a moof and everything after it up to the next moof (its mdat).
    const fragments = [];
    for (let i = firstMoof; i < boxes.length; i += 1) {
      if (boxes[i].type !== 'moof') continue;
      let next = i + 1;
      while (next < boxes.length && boxes[next].type !== 'moof') next += 1;
      if (next === i + 1) continue; // a fragment whose data was never written (the recording was cut off)
      const moof = await readAt(handle, boxes[i].at, boxes[i].size);
      const facts = moof && readFragment(moof, tracks);
      if (!facts) return null;
      const v = facts.tracks.get(video.id);
      if (!v) continue;
      fragments.push({ moof, facts, dataStart: boxes[i].at + boxes[i].size, dataEnd: next < boxes.length ? boxes[next].at : boxes[boxes.length - 1].at + boxes[boxes.length - 1].size,
        videoStart: v.base / video.timescale, keyframe: v.keyframe,
        end: Math.max(...[...facts.tracks].map(([id, t]) => (t.base + t.duration) / tracks.get(id).timescale)) });
    }
    if (!fragments.length) return null;
    let first = 0;
    fragments.forEach((f, index) => { if (f.keyframe && f.videoStart <= start + 0.001) first = index; });
    let last = fragments.length - 1;
    while (last > first && fragments[last].videoStart >= end) last -= 1;
    if (first === 0 && last === fragments.length - 1) return null;
    const kept = fragments.slice(first, last + 1);

    // The same shift for every track keeps sound and picture in sync; the earliest track starts at 0.
    const offset = Math.min(...[...kept[0].facts.tracks].map(([id, t]) => t.base / tracks.get(id).timescale));
    temporary = path.join(path.dirname(file), `.cut-${path.basename(file)}`);
    const out = await fsp.open(temporary, 'w');
    try {
      const headerEnd = boxes[firstMoof].at;
      await out.write(await readAt(handle, 0, headerEnd));
      const total = kept.reduce((sum, f) => sum + f.moof.length + f.dataEnd - f.dataStart, 0);
      let written = 0;
      const chunk = Buffer.alloc(8 * 1024 * 1024);
      for (const [index, fragment] of kept.entries()) {
        const moof = Buffer.from(fragment.moof);
        if (fragment.facts.sequenceAt != null) moof.writeUInt32BE(index + 1, fragment.facts.sequenceAt);
        for (const [id, t] of fragment.facts.tracks) {
          const shifted = Math.max(0, t.base - Math.round(offset * tracks.get(id).timescale));
          if (t.version === 1) moof.writeBigUInt64BE(BigInt(shifted), t.baseAt); else moof.writeUInt32BE(shifted, t.baseAt);
        }
        await out.write(moof);
        for (let at = fragment.dataStart; at < fragment.dataEnd; at += chunk.length) {
          const length = Math.min(chunk.length, fragment.dataEnd - at);
          const { bytesRead } = await handle.read(chunk, 0, length, at);
          await out.write(chunk, 0, bytesRead);
        }
        written += moof.length + fragment.dataEnd - fragment.dataStart;
        onProgress(written / total);
      }
    } finally {
      await out.close();
    }
    await handle.close();
    // Windows' virus scanner can hold a file it just saw being written; try again for a few seconds.
    for (let attempt = 0; ; attempt += 1) {
      try {
        await fsp.rename(temporary, file);
        break;
      } catch (error) {
        if (attempt >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) throw error;
        await new Promise((resolve) => setTimeout(resolve, 600));
      }
    }
    temporary = null;
    return { offset, duration: kept.at(-1).end - offset };
  } catch {
    return null;
  } finally {
    await handle.close().catch(() => {});
    if (temporary) fs.rmSync(temporary, { force: true });
  }
}
