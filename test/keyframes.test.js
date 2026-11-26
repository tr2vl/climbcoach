// Where the HUD scan looks: keyframes from the MP4's sample tables, with gaps filled.
import assert from 'node:assert/strict';
import test from 'node:test';
import { keyframesFromMoov, sampleTimes } from '../src/main/keyframes.js';

const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const box = (type, ...parts) => { const body = Buffer.concat(parts); return Buffer.concat([u32(body.length + 8), Buffer.from(type, 'latin1'), body]); };
const full = (type, ...parts) => box(type, u32(0), ...parts);

test('keyframe times come from stss and stts (60 fps, a keyframe every 250 frames)', () => {
  const stts = full('stts', u32(2), u32(500), u32(256), u32(100), u32(512)); // 500 frames of 1/60 s, then 100 of 2/60 s
  const stss = full('stss', u32(3), u32(1), u32(251), u32(551));
  const moov = box('moov', box('trak', box('mdia', full('mdhd', u32(0), u32(0), u32(15360), u32(0)), full('hdlr', u32(0), Buffer.from('vide'), Buffer.alloc(12)),
    box('minf', box('stbl', stts, stss)))));
  const times = keyframesFromMoov(moov);
  assert.deepEqual(times.map((t) => Math.round(t * 1000) / 1000), [0, 4.167, 10]);
});

test('looks go to keyframes at least ~1 s apart, with fills where they are far apart', () => {
  assert.deepEqual(sampleTimes([0, 4.17, 8.33], 12), [0, 4.17, 8.33]);
  assert.deepEqual(sampleTimes([0, 10, 20], 26), [0, 3, 6, 10, 13, 16, 20, 23]);
  assert.deepEqual(sampleTimes([0, 0.5, 1, 1.5, 2.1], 3), [0, 1, 2.1]);
  assert.deepEqual(sampleTimes(null, 7), [0, 2, 4, 6]); // no keyframe table (MKV, WebM): every 2 s
  assert.deepEqual(sampleTimes([], 3), [0, 1, 2]); // every frame is a keyframe
  assert.deepEqual(sampleTimes([0, 4], 0), []);
});
