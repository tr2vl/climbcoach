// Reading the Overwatch HUD from text found in frames (port of MatchFrameMatchers, EndScreenMatcher,
// EndScreenTracker, DeathScreenMatcher, KillFeedParser, KillFeedTimeline and RecordingFacts). Boxes are normalised, origin top-left:
// { text, x, y, w, h } with 0…1 coordinates. Pure functions; the text comes from Windows' own OCR.
import { heroKeyFor, MAPS } from './catalog.js';
import { parseTimestamp } from './rubric.js';

export const letters = (text) => String(text).toUpperCase().replace(/[^A-Z]/g, '');
const fold = (text) => String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const midX = (t) => t.x + t.w / 2;
const midY = (t) => t.y + t.h / 2;

/** Levenshtein distance for short words. */
export function distance(a, b) {
  if (!a.length || !b.length) return Math.max(a.length, b.length);
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = row[j];
      row[j] = Math.min(above + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length];
}

// The end banner in the game's languages (English first; the coach doesn't know which one you play in).
const RESULT_WORDS = {
  win: ['VICTORY', 'SIEG', 'VICTOIRE', 'VICTORIA', 'VITTORIA', 'VITORIA', 'ZWYCIESTWO'],
  loss: ['DEFEAT', 'NIEDERLAGE', 'DEFAITE', 'DERROTA', 'SCONFITTA', 'PORAZKA'],
  draw: ['DRAW', 'UNENTSCHIEDEN', 'EGALITE', 'EMPATE', 'PAREGGIO', 'REMIS'],
};
const LEAVING = ['LEAVINGGAME', 'VERLASSESPIEL', 'SPIELWIRDVERLASSEN', 'QUITTELAPARTIE', 'ABANDONANDOPARTIDA', 'ABBANDONO'];

/** The result a single line stands for, allowing one misread letter in the long words ("DEFEHT"). */
export function resultWord(text) {
  const word = fold(text).replace(/[0-9]/g, '');
  for (const [result, words] of Object.entries(RESULT_WORDS)) {
    for (const candidate of words) {
      if (word === candidate) return result;
      if (candidate.length >= 6 && word.length >= 5 && word.length <= candidate.length + 1 && distance(word, candidate) <= 1) return result;
    }
  }
  return null;
}

const BANNER_MIN_HEIGHT = 0.04;

/** The match result if the frame shows the end banner (large, centred) or the results screen. */
export function endResult(texts) {
  const leaving = texts.some((t) => LEAVING.some((l) => fold(t.text).includes(l)));
  for (const t of texts) {
    const result = resultWord(t.text);
    if (!result) continue;
    const isBanner = t.h >= BANNER_MIN_HEIGHT && midX(t) >= 0.25 && midX(t) <= 0.75 && midY(t) < 0.7;
    if (isBanner || leaving) return result;
  }
  return null;
}

/** Trusts the end screen once it is read twice within 10 s; `firstSeen` dates the banner. */
export class EndScreenTracker {
  constructor() {
    this.hits = [];
    this.firstSeen = null;
  }

  record(result, time) {
    this.hits = this.hits.filter((h) => time - h.time <= 45);
    if (!result) return null;
    this.hits.push({ time, result });
    if (this.hits.filter((h) => h.result === result && time - h.time <= 10).length < 2) return null;
    this.firstSeen = this.hits.find((h) => h.result === result)?.time ?? time;
    return result;
  }
}

/** Your own death screens, in the top band: "ELIMINATED BY <hero>", "RESPAWN IN", "DEATH SPECTATING". */
export function deathScreen(texts) {
  let dead = false;
  for (const t of texts.filter((t) => midY(t) <= 0.2)) {
    const upper = t.text.toUpperCase();
    const at = upper.indexOf('ELIMINATED BY');
    if (at >= 0) {
      const name = upper.slice(at + 'ELIMINATED BY'.length).replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, '');
      return { killer: name || null };
    }
    const l = letters(upper);
    if (l.includes('RESPAWNIN') || l.includes('DEATHSPECTATING')) dead = true;
  }
  return dead ? { killer: null } : null;
}

// ---------- Kill feed ----------

/** Where the kill feed sits (top right). The window sends this corner enlarged, because its text is small. */
export const KILL_FEED_REGION = { x: 0.55, y: 0.02, w: 0.45, h: 0.30 };
const ROW_TOLERANCE = 0.012;

/** Boxes read from a crop of the frame, moved back into the whole frame's coordinates. */
export const fromCrop = (texts, region) => texts.map((t) => ({ ...t, x: region.x + t.x * region.w, y: region.y + t.y * region.h, w: t.w * region.w, h: t.h * region.h }));

/** Uppercased letters and digits, with OCR look-alikes folded (0→O, 1/I/|→L, 5→S). */
export function feedFold(text) {
  const swaps = { 0: 'O', 1: 'L', I: 'L', '|': 'L', 5: 'S' };
  return [...String(text).toUpperCase()].map((c) => swaps[c] ?? c).join('').replace(/[^\p{L}\p{N}]/gu, '');
}

/**
 * Kill-feed lines with your name in one frame: did you get the kill or die? A line reads
 * "killer → victim", so the name on the right of its row is the victim. `other` is the other player's name.
 */
export function killFeedHits(texts, playerName) {
  const name = feedFold(playerName ?? '');
  if (name.length < 3) return [];
  const inFeed = texts.filter((t) => t.x + t.w > KILL_FEED_REGION.x && midY(t) >= KILL_FEED_REGION.y && midY(t) <= KILL_FEED_REGION.y + KILL_FEED_REGION.h);
  const hits = [];
  const usedRows = [];
  for (const text of inFeed) {
    if (!feedFold(text.text).includes(name)) continue;
    const y = midY(text);
    if (usedRows.some((row) => Math.abs(row - y) <= ROW_TOLERANCE)) continue;
    usedRows.push(y);
    const row = inFeed.filter((t) => Math.abs(midY(t) - y) <= ROW_TOLERANCE).sort((a, b) => a.x - b.x);
    if (row.length >= 2) {
      const isRightmost = row.at(-1) === text;
      hits.push({ side: isRightmost ? 'victim' : 'killer', other: (isRightmost ? row[0] : row.at(-1)).text.trim() || null });
      continue;
    }
    // One line holding the whole row (Windows' OCR joins words on a line): where does the name sit in it?
    const words = text.text.split(/\s+/).filter((w) => feedFold(w).length >= 2);
    const at = words.findIndex((w) => feedFold(w).includes(name));
    if (words.length < 2 || at < 0) continue;
    const victim = at === words.length - 1;
    const other = (victim ? words.slice(0, at) : words.slice(at + 1)).join(' ').trim();
    hits.push({ side: victim ? 'victim' : 'killer', other: other || null });
  }
  return hits;
}

/** OCR misreads names ("ROMABICEPS" / "ROMABICERS"), so close spellings count as the same player. */
function sameName(a, b) {
  if (!a || !b) return true;
  const [x, y] = [feedFold(a), feedFold(b)];
  return distance(x, y) <= Math.max(2, Math.floor(Math.min(x.length, y.length) / 3));
}

/**
 * Per-frame hits merged into events: a kill-feed line stays on screen about 5 s, so repeats are one event.
 * You can't die again before respawning (~10 s), so your deaths merge over a longer window.
 */
export function killFeedEvents(frames) {
  const events = [];
  for (const frame of [...frames].sort((a, b) => a.time - b.time)) {
    for (const hit of frame.hits) {
      const span = hit.side === 'victim' ? 12 : 6;
      const repeat = events.some((e) => e.side === hit.side && frame.time - e.time <= span && sameName(e.other, hit.other));
      if (!repeat) events.push({ time: frame.time, side: hit.side, other: hit.other });
    }
  }
  return events;
}

export const START_PHRASES = ['ASSEMBLEYOURTEAM', 'PREPARETOATTACK', 'PREPAREYOURDEFENSES', 'PREPARETODEFEND', 'ESCORTTHEPAYLOAD', 'STOPTHEPAYLOAD',
  'CAPTURETHEOBJECTIVE', 'DEFENDTHEOBJECTIVE', 'PUSHTHEROBOT'];

export const isMatchFrame = (texts) => texts.some((t) => START_PHRASES.some((p) => letters(t.text).includes(p)));
export const isHeroPicked = (texts) => texts.some((t) => letters(t.text).includes('ASSEMBLEYOURTEAM')) && texts.some((t) => letters(t.text).includes('CHANGEHERO'));
export const isRoundUnderway = (texts) => texts.some((t) => START_PHRASES.some((p) => p !== 'ASSEMBLEYOURTEAM' && letters(t.text).includes(p)));

/** Longest names first, so "Hollywood" can't hide inside a longer name. */
const MAP_NAMES = [...MAPS].map((m) => ({ folded: fold(m.name), key: m.key })).sort((a, b) => b.folded.length - a.folded.length);
export const mapIn = (text) => MAP_NAMES.find((m) => fold(text).includes(m.folded))?.key ?? null;

export function heroSelectMap(texts) {
  if (!texts.some((t) => letters(t.text).includes('ASSEMBLEYOURTEAM'))) return null;
  for (const t of texts) {
    const key = mapIn(t.text);
    if (key) return key;
  }
  return null;
}

/** "TIME: 6:25" → 385 s: the game's own match clock on the Tab scoreboard. */
export function matchTime(text) {
  const match = /TIME\s*:?\s*(\d{1,2}:\d{2})/.exec(String(text).toUpperCase());
  return match ? parseTimestamp(match[1]) : null;
}

/** The Tab scoreboard: header with mode, queue, map and TIME; the hero name sits above "WEAPON ACCURACY". */
export function scoreboard(texts, videoTime) {
  if (!texts.some((t) => ['SCOREBOARD', 'HEROINFO'].some((w) => letters(t.text).includes(w)))) return null;
  const header = texts.find((t) => t.text.toUpperCase().includes('TIME') && matchTime(t.text) != null)
    ?? texts.find((t) => /COMPETITIVE|QUICK PLAY/.test(t.text.toUpperCase()));
  if (!header) return null;
  const headerText = texts.filter((t) => Math.abs(midY(t) - midY(header)) < 0.02).map((t) => t.text).join(' ');
  const anchor = texts.find((t) => letters(t.text).includes('WEAPONACCURACY'));
  const candidates = texts.map((t) => ({ t, key: heroKeyFor(t.text) })).filter((c) => c.key);
  let heroKey = null;
  if (anchor) {
    heroKey = candidates.filter((c) => midY(c.t) < midY(anchor) && midY(anchor) - midY(c.t) < 0.12 && Math.abs(midX(c.t) - midX(anchor)) < 0.08)
      .sort((a, b) => midY(b.t) - midY(a.t))[0]?.key ?? null;
  } else heroKey = candidates.find((c) => midX(c.t) > 0.55)?.key ?? null;
  const queueLetters = letters(headerText);
  return {
    videoTime, heroKey, mapKey: mapIn(headerText),
    matchTime: texts.map((t) => matchTime(t.text)).find((v) => v != null) ?? null,
    queue: queueLetters.includes('COMPETITIVE') ? 'competitive' : queueLetters.includes('QUICKPLAY') || queueLetters.includes('UNRANKED') ? 'quickPlay' : null,
  };
}

/**
 * Follows a recording frame by frame (about once a second) and collects what the Mac app finds in its
 * scan: match start and end, map, queue, heroes, scoreboards, your death screens.
 */
export class HudTracker {
  static bannerGap = 4;

  constructor() {
    this.end = new EndScreenTracker();
    this.facts = { matchStart: null, endScreen: null, result: null, mapKey: null, queue: null, heroKeys: [], scoreboards: [], heroSelect: null };
    this.roundStarted = false;
    this.banners = [];
    this.feedFrames = [];
  }

  /**
   * Feeds one frame's text (whole-frame coordinates); returns what changed: { heroSelect, scoreboard,
   * endScreen }. `feed` is the text of the enlarged kill-feed corner, read when your in-game name is known.
   */
  feed(texts, time, { feed = null, playerName = '' } = {}) {
    const f = this.facts;
    const changes = {};
    if (feed && playerName) this.feedFrames.push({ time, hits: killFeedHits(feed, playerName) });
    if (f.matchStart == null && isMatchFrame(texts)) f.matchStart = time;
    f.mapKey ??= heroSelectMap(texts);
    if (!this.roundStarted) {
      if (isHeroPicked(texts)) { f.heroSelect = time; changes.heroSelect = true; } else if (f.heroSelect != null && isRoundUnderway(texts)) this.roundStarted = true;
    }
    const board = scoreboard(texts, time);
    if (board) {
      f.scoreboards.push(board);
      f.mapKey = board.mapKey ?? f.mapKey;
      f.queue = board.queue ?? f.queue;
      if (board.heroKey && !f.heroKeys.includes(board.heroKey)) f.heroKeys.push(board.heroKey);
      changes.scoreboard = board;
    }
    const death = deathScreen(texts);
    if (death) this.banners.push({ time, killer: death.killer });
    if (f.endScreen == null) {
      const result = this.end.record(endResult(texts), time);
      if (result) {
        f.endScreen = this.end.firstSeen ?? time;
        f.result = result;
        changes.endScreen = result;
      }
    }
    return changes;
  }

  /** One death per run of death-screen frames: the first frame's time and the first readable killer. */
  deaths() {
    const deaths = [];
    let last = null;
    let open = null;
    for (const b of [...this.banners].sort((a, c) => a.time - c.time)) {
      if (last != null && b.time - last <= HudTracker.bannerGap && open) open.killer ??= b.killer;
      else {
        if (open) deaths.push(open);
        open = { ...b };
      }
      last = b.time;
    }
    if (open) deaths.push(open);
    return deaths;
  }

  /**
   * Hints for the scout pass, as stored events, checked against a real match on the Mac:
   * - "deathScreen": your death screens, which appear ~6 s after the death itself;
   * - "ownDeath": a kill-feed death no death screen explains;
   * - "ownElimination": your kills in the kill feed;
   * - nothing after the end screen (Play of the Game replays kills).
   */
  hints() {
    const end = this.facts.endScreen ?? Infinity;
    const deaths = this.deaths();
    const list = deaths.map((d) => ({ time: d.time, kind: 'deathScreen', payload: d.killer ? `killed by ${d.killer}` : null }));
    for (const event of killFeedEvents(this.feedFrames)) {
      if (event.side === 'killer') list.push({ time: event.time, kind: 'ownElimination', payload: event.other });
      else if (!deaths.some((d) => d.time - event.time <= 12 && event.time - d.time <= 4)) {
        list.push({ time: event.time, kind: 'ownDeath', payload: event.other ? `killed by ${event.other}` : null });
      }
    }
    const result = list.filter((hint) => hint.time < end);
    if (this.facts.endScreen != null) result.push({ time: this.facts.endScreen, kind: 'endScreen', payload: this.facts.result });
    return result.sort((a, b) => a.time - b.time);
  }

  /** The part of the recording that is the match: a little before the start, a few seconds of the end screen. */
  range(duration) {
    const start = this.facts.matchStart != null ? Math.max(0, this.facts.matchStart - 2) : 0;
    const end = this.facts.endScreen != null ? Math.min(duration, this.facts.endScreen + 6) : duration;
    return start < end ? { start, end } : { start: 0, end: duration };
  }

  /** Match length by the game clock: last scoreboard TIME plus what followed until the end screen. */
  matchLength() {
    const f = this.facts;
    const last = [...f.scoreboards].reverse().find((s) => s.matchTime != null);
    if (last) return last.matchTime + Math.max(0, (f.endScreen ?? last.videoTime) - last.videoTime);
    return f.matchStart != null && f.endScreen != null && f.endScreen > f.matchStart ? f.endScreen - f.matchStart : null;
  }

  /** The last scoreboard, if it was opened in the last 2 minutes before the end. */
  finalScoreboard() {
    const last = this.facts.scoreboards.at(-1);
    if (!last) return null;
    return this.facts.endScreen == null || this.facts.endScreen - last.videoTime <= 120 ? last : null;
  }
}
