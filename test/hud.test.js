// The HUD readers, fed with text as Windows' OCR returns it (normalised boxes, origin top-left).
import assert from 'node:assert/strict';
import test from 'node:test';
import { deathScreen, endResult, EndScreenTracker, HudTracker, matchTime, resultWord, scoreboard } from '../src/shared/hud.js';

const t = (text, x = 0.4, y = 0.4, w = 0.2, h = 0.03) => ({ text, x, y, w, h });

test('the end banner is read in several languages, with one misread letter', () => {
  assert.equal(resultWord('DEFEHT'), 'loss');
  assert.equal(resultWord('VICTORY'), 'win');
  assert.equal(resultWord('NIEDERLAGE'), 'loss');
  assert.equal(resultWord('Victoire'), 'win');
  assert.equal(resultWord('DRAW'), 'draw');
  assert.equal(resultWord('DEFENSE'), null);
  // Large and centred counts; small text elsewhere only with the results screen.
  assert.equal(endResult([t('DEFEAT', 0.4, 0.35, 0.2, 0.08)]), 'loss');
  assert.equal(endResult([t('DEFEAT', 0.02, 0.02, 0.1, 0.02)]), null);
  assert.equal(endResult([t('DEFEAT', 0.02, 0.02, 0.1, 0.02), t('LEAVING GAME IN 10')]), 'loss');
});

test('the end screen counts once it is read twice within 10 seconds', () => {
  const tracker = new EndScreenTracker();
  assert.equal(tracker.record('loss', 100), null);
  assert.equal(tracker.record(null, 101), null);
  assert.equal(tracker.record('loss', 104), 'loss');
  assert.equal(tracker.firstSeen, 100);
});

test('death screens in the top band, with the killer', () => {
  assert.deepEqual(deathScreen([t('ELIMINATED BY REAPER', 0.4, 0.05)]), { killer: 'REAPER' });
  assert.deepEqual(deathScreen([t('RESPAWN IN 5', 0.4, 0.1)]), { killer: null });
  assert.equal(deathScreen([t('ELIMINATED BY REAPER', 0.4, 0.8)]), null);
});

test('the Tab scoreboard gives map, queue, hero and the game clock', () => {
  const board = scoreboard([
    t('SCOREBOARD', 0.05, 0.05), t('PAYLOAD - COMPETITIVE | ROUTE 66', 0.2, 0.1, 0.4, 0.02), t('TIME: 6:25', 0.7, 0.1, 0.1, 0.02),
    t('CASSIDY', 0.8, 0.4, 0.1, 0.03), t('WEAPON ACCURACY', 0.8, 0.48, 0.12, 0.02),
  ], 500);
  assert.equal(board.mapKey, 'route-66');
  assert.equal(board.queue, 'competitive');
  assert.equal(board.heroKey, 'cassidy');
  assert.equal(board.matchTime, 385);
  assert.equal(matchTime('time 12:05'), 725);
});

test('a whole recording: start, hero select, deaths, scoreboard, end', () => {
  const hud = new HudTracker();
  hud.feed([t('ASSEMBLE YOUR TEAM'), t('KING\'S ROW', 0.4, 0.1)], 60);
  hud.feed([t('ASSEMBLE YOUR TEAM'), t('CHANGE HERO')], 70);
  hud.feed([t('PREPARE TO ATTACK')], 100);
  hud.feed([t('ELIMINATED BY GENJI', 0.4, 0.05)], 300);
  hud.feed([t('RESPAWN IN 8', 0.4, 0.1)], 302);
  hud.feed([t('RESPAWN IN 4', 0.4, 0.1)], 310);
  hud.feed([t('SCOREBOARD', 0.05, 0.05), t('ESCORT - COMPETITIVE | KING\'S ROW', 0.2, 0.1, 0.4, 0.02), t('TIME: 9:30', 0.7, 0.1, 0.1, 0.02), t('ANA', 0.8, 0.4, 0.1, 0.03), t('WEAPON ACCURACY', 0.8, 0.48, 0.12, 0.02)], 700);
  hud.feed([t('VICTORY', 0.4, 0.35, 0.2, 0.08)], 760);
  const changes = hud.feed([t('VICTORY', 0.4, 0.35, 0.2, 0.08)], 762);
  assert.equal(changes.endScreen, 'win');
  const f = hud.facts;
  assert.equal(f.matchStart, 60);
  assert.equal(f.heroSelect, 70);
  assert.equal(f.mapKey, 'kings-row');
  assert.deepEqual(f.heroKeys, ['ana']);
  assert.equal(f.endScreen, 760);
  assert.deepEqual(hud.deaths(), [{ time: 300, killer: 'GENJI' }, { time: 310, killer: null }]);
  assert.deepEqual(hud.range(800), { start: 58, end: 766 });
  assert.equal(hud.matchLength(), 630);
  assert.equal(hud.finalScoreboard().videoTime, 700);
  assert.deepEqual(hud.hints().map((h) => h.kind), ['deathScreen', 'deathScreen', 'endScreen']);
});

// ---------- Kill feed (port of the Mac's KillFeedParserTests) ----------
import { fromCrop, KILL_FEED_REGION, killFeedEvents, killFeedHits } from '../src/shared/hud.js';

test('kill feed: your name on the left is a kill, on the right a death', () => {
  const row = (y, left, right) => [t(left, 0.70, y, 0.08, 0.02), t(right, 0.88, y, 0.08, 0.02)];
  assert.deepEqual(killFeedHits(row(0.05, 'ROMABICEPS', 'Kiriko99'), 'RomaBiceps'), [{ side: 'killer', other: 'Kiriko99' }]);
  assert.deepEqual(killFeedHits(row(0.08, 'Genjiman', 'R0MABICEPS'), 'RomaBiceps'), [{ side: 'victim', other: 'Genjiman' }]);
  // Windows' OCR often joins the row into one line; icons read as stray marks are ignored.
  assert.deepEqual(killFeedHits([t('Genjiman » ROMABICEPS', 0.7, 0.1, 0.25, 0.02)], 'RomaBiceps'), [{ side: 'victim', other: 'Genjiman' }]);
  assert.deepEqual(killFeedHits([t('ROMABICEPS Ana', 0.7, 0.1, 0.25, 0.02)], 'RomaBiceps'), [{ side: 'killer', other: 'Ana' }]);
  // Outside the kill-feed corner, or with no name set: nothing.
  assert.deepEqual(killFeedHits(row(0.6, 'ROMABICEPS', 'Ana'), 'RomaBiceps'), []);
  assert.deepEqual(killFeedHits(row(0.05, 'ROMABICEPS', 'Ana'), ''), []);
});

test('kill feed repeats merge into one event; close misreads count as the same player', () => {
  const events = killFeedEvents([
    { time: 10, hits: [{ side: 'killer', other: 'Kiriko99' }] },
    { time: 12, hits: [{ side: 'killer', other: 'Kiriko98' }] },
    { time: 17, hits: [{ side: 'killer', other: 'Kiriko99' }] },
    { time: 20, hits: [{ side: 'victim', other: 'Genjiman' }] },
    { time: 30, hits: [{ side: 'victim', other: 'Genjiman' }] },
  ]);
  assert.deepEqual(events.map((e) => [e.time, e.side]), [[10, 'killer'], [17, 'killer'], [20, 'victim']]);
});

test('kill feed hints: kills, and only deaths no death screen explains', () => {
  const hud = new HudTracker();
  const feed = (time, left, right) => hud.feed([], time, { feed: [t(left, 0.7, 0.05, 0.08, 0.02), t(right, 0.88, 0.05, 0.08, 0.02)], playerName: 'RomaBiceps' });
  feed(30, 'ROMABICEPS', 'Ana');
  feed(60, 'Genjiman', 'ROMABICEPS');
  hud.feed([t('ELIMINATED BY GENJI', 0.4, 0.05)], 66);
  feed(120, 'Reaper', 'ROMABICEPS');
  assert.deepEqual(hud.hints().map((h) => [h.time, h.kind, h.payload]), [
    [30, 'ownElimination', 'Ana'], [66, 'deathScreen', 'killed by GENJI'], [120, 'ownDeath', 'killed by Reaper'],
  ]);
});

test('boxes read from the enlarged kill-feed corner map back into the frame', () => {
  const [box] = fromCrop([{ text: 'X', x: 0.5, y: 0.5, w: 0.1, h: 0.1 }], KILL_FEED_REGION);
  assert.ok(Math.abs(box.x - 0.775) < 1e-9 && Math.abs(box.y - 0.17) < 1e-9 && Math.abs(box.w - 0.045) < 1e-9 && Math.abs(box.h - 0.03) < 1e-9);
});
