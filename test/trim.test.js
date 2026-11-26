// Cutting a recording to the match: a small fragmented MP4 built here, shaped like Chromium's recordings.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readFragment, readTracks, trimRecording } from '../src/main/trim.js';

const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; };
const box = (type, ...parts) => { const body = Buffer.concat(parts); return Buffer.concat([u32(body.length + 8), Buffer.from(type, 'latin1'), body]); };
const full = (type, version, flags, ...parts) => box(type, u32((version << 24) | flags), ...parts);

function trak(id, timescale, handler) {
  return box('trak', full('tkhd', 0, 3, u32(0), u32(0), u32(id), Buffer.alloc(80)),
    box('mdia', full('mdhd', 0, 0, u32(0), u32(0), u32(timescale), u32(0), Buffer.alloc(4)), full('hdlr', 0, 0, u32(0), Buffer.from(handler, 'latin1'), Buffer.alloc(13))));
}

/** Video (1000/s) fragments every 2 s, audio (48000/s) starting 0.1 s later in each; `nonKey` fragments don't start on a keyframe. */
function recording(count, { nonKey = [] } = {}) {
  const moov = box('moov', full('mvhd', 0, 0, Buffer.alloc(96)), trak(1, 1000, 'vide'), trak(2, 48000, 'soun'),
    box('mvex', full('trex', 0, 0, u32(1), u32(1), u32(0), u32(0), u32(0)), full('trex', 0, 0, u32(2), u32(1), u32(0), u32(0), u32(0))));
  const parts = [box('ftyp', Buffer.from('isom', 'latin1'), u32(512)), moov];
  for (let i = 0; i < count; i += 1) {
    const traf = (id, base, durations, flags) => box('traf', full('tfhd', 0, 0x20020, u32(id), u32(0x1010000)), full('tfdt', 1, 0, u64(base)),
      full('trun', 0, 0x305, u32(durations.length), u32(0), u32(flags), ...durations.flatMap((d) => [u32(d), u32(50)])));
    const audioBase = i === 0 ? 0 : (20 * i + 1) * 4800;
    parts.push(box('moof', full('mfhd', 0, 0, u32(i + 1)), traf(1, i * 2000, [1000, 1000], nonKey.includes(i) ? 0x1010000 : 0x2000000), traf(2, audioBase, [48000, 48000], 0x2000000)));
    parts.push(box('mdat', Buffer.alloc(200, i + 1)));
  }
  return Buffer.concat(parts);
}

/** [tfdt per track, mdat marker byte] for each fragment of a file. */
function fragments(file) {
  const buf = fs.readFileSync(file);
  const top = [];
  for (let at = 0; at < buf.length; at += buf.readUInt32BE(at)) top.push({ type: buf.toString('latin1', at + 4, at + 8), at, size: buf.readUInt32BE(at) });
  const tracks = readTracks(buf.subarray(top.find((b) => b.type === 'moov').at));
  const moofs = top.filter((b) => b.type === 'moof');
  return moofs.map((m) => {
    const moof = buf.subarray(m.at, m.at + m.size);
    const facts = readFragment(moof, tracks);
    return { seq: moof.readUInt32BE(facts.sequenceAt), video: facts.tracks.get(1).base, audio: facts.tracks.get(2).base, data: buf[m.at + m.size + 8] };
  });
}

const temp = (name, data) => { const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'climb-trim-')), name); fs.writeFileSync(file, data); return file; };

test('the cut keeps the fragments of the match, starting at 0 and in sync', async () => {
  const file = temp('match.mp4', recording(6));
  const cut = await trimRecording(file, 5, 8);
  assert.equal(cut.offset, 4); // the keyframe at or before 5 s
  assert.ok(Math.abs(cut.duration - 4.1) < 1e-9);
  assert.deepEqual(fragments(file), [
    { seq: 1, video: 0, audio: 4800, data: 3 },
    { seq: 2, video: 2000, audio: 21 * 4800, data: 4 },
  ]);
});

test('the cut starts at the keyframe before, and leaves files alone when there is nothing to cut', async () => {
  const file = temp('match.mp4', recording(6, { nonKey: [2] }));
  assert.equal((await trimRecording(file, 5, 20)).offset, 2);
  assert.deepEqual(fragments(file).map((f) => f.data), [2, 3, 4, 5, 6]);
  const whole = temp('whole.mp4', recording(3));
  const before = fs.readFileSync(whole);
  assert.equal(await trimRecording(whole, 0, 100), null);
  assert.deepEqual(fs.readFileSync(whole), before);
  const webm = temp('other.mp4', Buffer.from('not an mp4 at all'));
  assert.equal(await trimRecording(webm, 1, 2), null);
});

test('a recording cut off mid-fragment (the app closed) still cuts cleanly', async () => {
  const data = recording(6);
  const file = temp('crash.mp4', data.subarray(0, data.length - 120));
  const cut = await trimRecording(file, 3, 100);
  assert.equal(cut.offset, 2);
  assert.deepEqual(fragments(file).map((f) => f.data), [2, 3, 4, 5]);
});
