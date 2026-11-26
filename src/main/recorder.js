// Recording a live match (port of CaptureController, WindowRecorder and RecordingFinalizer). The window
// captures the game window and sends the video here in pieces, plus about one frame a second that is read
// with Windows' OCR: hero select, the scoreboard, your death screens, the kill feed and the end banner.
// At the end the recording is cut to the match, saved with what the HUD showed, and its report starts.
import fs from 'node:fs';
import path from 'node:path';
import { desktopCapturer } from 'electron';
import { hero } from '../shared/catalog.js';
import { gameMap } from '../shared/catalog.js';
import { fromCrop, HudTracker, KILL_FEED_REGION } from '../shared/hud.js';
import { trimRecording } from './trim.js';

const stamp = (date) => date.toISOString().slice(0, 16).replace('T', ' ').replace(':', '-');

export class Recorder {
  constructor({ paths, db, settings, analysis, ocr, notify, afterSave = () => {} }) {
    Object.assign(this, { paths, db, settings, analysis, ocr, notify, afterSave });
    this.status = { state: 'idle' };
    this.session = null;
    this.chosen = null;
  }

  #set(status) {
    this.status = status;
    this.notify(status);
  }

  /** Windows you can record, with small previews. */
  async pick() {
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: false });
    const list = sources.filter((s) => s.name && !/ClimbCoach/i.test(s.name))
      .map((s) => ({ id: s.id, name: s.name, thumbnail: s.thumbnail.isEmpty() ? null : s.thumbnail.toDataURL() }))
      .sort((a, b) => Number(/overwatch|geforce now/i.test(b.name)) - Number(/overwatch|geforce now/i.test(a.name)));
    this.#set({ state: 'picking', sources: list });
    return list;
  }

  /** The window's capture request asks for this source (see setDisplayMediaRequestHandler in main.js). */
  choose(sourceId, options = {}) {
    this.chosen = { sourceId, sound: options.sound !== false, windowName: options.windowName ?? '' };
    return this.chosen;
  }

  async displayMediaSource() {
    if (!this.chosen) return null;
    const sources = await desktopCapturer.getSources({ types: ['window', 'screen'] });
    return sources.find((s) => s.id === this.chosen.sourceId) ?? null;
  }

  cancel() {
    this.chosen = null;
    this.#set({ state: 'idle' });
  }

  /** The window started recording: open the file. */
  begin({ extension = 'mp4', width = 0, height = 0 } = {}) {
    const startedAt = new Date();
    fs.mkdirSync(this.paths.videos, { recursive: true });
    const file = path.join(this.paths.videos, `ClimbCoach ${stamp(startedAt)}.${extension}`);
    this.session = { file, stream: fs.createWriteStream(file), startedAt, size: 0, width, height, hud: new HudTracker(), ocrBusy: false,
      frameDir: fs.mkdtempSync(path.join(this.paths.screenshots, 'frames-')), scoreboard: null, heroStill: null };
    this.#set({ state: 'recording', startedAt: startedAt.toISOString(), windowName: this.chosen?.windowName ?? '', sizeBytes: 0, endScreen: null });
  }

  chunk(buffer) {
    const s = this.session;
    if (!s) return;
    s.stream.write(Buffer.from(buffer));
    s.size += buffer.byteLength;
    if (s.size - (this.status.sizeBytes ?? 0) > 20e6) this.#set({ ...this.status, sizeBytes: s.size });
  }

  /**
   * One frame (JPEG) at `time` seconds into the recording, and the kill-feed corner enlarged (JPEG, when
   * your in-game name is set). Skipped while the previous one is still being read.
   */
  async frame(buffer, time, feedBuffer = null) {
    const s = this.session;
    if (!s || s.ocrBusy || !this.ocr.available) return null;
    s.ocrBusy = true;
    const file = path.join(s.frameDir, `frame-${Math.round(time * 10)}.jpg`);
    const feedFile = path.join(s.frameDir, `feed-${Math.round(time * 10)}.jpg`);
    try {
      fs.writeFileSync(file, Buffer.from(buffer));
      const texts = await this.ocr.read(file);
      const playerName = this.settings.get().profile.inGameName?.trim() ?? '';
      let feed = null;
      if (feedBuffer && playerName) {
        fs.writeFileSync(feedFile, Buffer.from(feedBuffer));
        feed = fromCrop(await this.ocr.read(feedFile), KILL_FEED_REGION);
      }
      const changes = s.hud.feed(texts, time, { feed, playerName });
      // Keep the frames worth keeping: your hero at hero select, and the latest scoreboard.
      if (changes.heroSelect) s.heroStill = this.#keep(file, s.heroStill);
      if (changes.scoreboard) s.scoreboard = this.#keep(file, s.scoreboard);
      if (changes.endScreen && this.status.state === 'recording') this.#set({ ...this.status, endScreen: changes.endScreen, sizeBytes: s.size });
      return changes.endScreen ?? null;
    } catch (error) {
      if (this.ocr.error) this.#set({ ...this.status, ocrProblem: this.ocr.error });
      return null;
    } finally {
      fs.rmSync(file, { force: true });
      fs.rmSync(feedFile, { force: true });
      s.ocrBusy = false;
    }
  }

  #keep(file, previous) {
    const target = path.join(this.paths.screenshots, `${path.basename(this.session.file, path.extname(this.session.file))}-${path.basename(file)}`);
    fs.copyFileSync(file, target);
    if (previous && previous !== target) fs.rmSync(previous, { force: true });
    return target;
  }

  /** The window stopped recording: close the file, save the match, start its report. */
  async finish({ duration, hasAudio = true, error = null }) {
    const s = this.session;
    if (!s) return null;
    this.session = null;
    this.#set({ state: 'preparing', progress: 0.5 });
    await new Promise((resolve) => s.stream.end(resolve));
    fs.rmSync(s.frameDir, { recursive: true, force: true });
    if (error || s.size < 100_000) {
      fs.rmSync(s.file, { force: true });
      this.#set({ state: 'failed', error: error ?? 'The recording was empty. Make sure the game window stayed open while recording.' });
      return null;
    }
    // Cut the recording to the match (hero select to a few seconds of the end screen), like the Mac app.
    let matchRange = s.hud.range(duration);
    let hints = s.hud.hints();
    let length = duration;
    if (path.extname(s.file) === '.mp4' && (matchRange.start > 0 || matchRange.end < duration)) {
      this.#set({ state: 'preparing', step: 'cutting', progress: 0 });
      let shown = 0;
      const cut = await trimRecording(s.file, matchRange.start, matchRange.end, {
        onProgress: (fraction) => { if (fraction - shown >= 0.02) { shown = fraction; this.#set({ state: 'preparing', step: 'cutting', progress: fraction }); } },
      });
      if (cut) {
        length = cut.duration;
        const shift = (time) => time - cut.offset;
        hints = hints.map((hint) => ({ ...hint, time: shift(hint.time) })).filter((hint) => hint.time >= 0 && hint.time <= length);
        matchRange = { start: Math.max(0, shift(matchRange.start)), end: Math.min(length, shift(matchRange.end)) };
        s.size = fs.statSync(s.file).size;
      }
    }
    const profile = this.settings.get().profile;
    const f = s.hud.facts;
    const heroKey = f.heroKeys[0] ?? null;
    const role = (heroKey && hero(heroKey)?.role) ?? profile.roles[0]?.role ?? 'damage';
    const map = gameMap(f.mapKey);
    const finalBoard = s.hud.finalScoreboard();
    if (s.scoreboard && !finalBoard) fs.rmSync(s.scoreboard, { force: true });
    const match = this.db.addMatch({
      playedAt: s.startedAt.toISOString(), mapKey: f.mapKey, mode: map?.modes.length === 1 ? map.modes[0] : null, queue: f.queue ?? 'competitive',
      role, rank: profile.roles.find((r) => r.role === role)?.rank ?? null, result: f.result ?? 'unknown', heroKeys: f.heroKeys,
      stats: { durationSeconds: s.hud.matchLength() ?? null },
      screenshots: finalBoard && s.scoreboard ? [{ id: path.basename(s.scoreboard), path: s.scoreboard, addedAt: new Date().toISOString() }] : [],
      video: { source: 'liveCapture', path: s.file, isAppOwned: true, width: s.width, height: s.height, frameRate: 30, durationSeconds: length, hasAudio,
        sizeBytes: s.size, createdAt: s.startedAt.toISOString(), deletedAt: null, range: matchRange, heroStill: s.heroStill, hudScannedAt: new Date().toISOString() },
      events: hints.map((hint) => ({ timestamp: hint.time, kind: hint.kind, payload: hint.payload, confidence: 'medium', source: 'ocr' })),
    });
    this.#set({ state: 'idle' });
    this.chosen = null;
    try { this.analysis.start(match.id, { mode: 'lean' }); } catch { /* no key yet: the match waits on its page */ }
    await this.afterSave(match);
    return match;
  }
}

/** Deletes the oldest recordings this app made, beyond your newest N with a finished report. Reports and clips stay. */
export function applyRetention(db, keep) {
  if (!keep) return 0;
  const owned = db.data.matches.filter((m) => m.video?.isAppOwned && !m.video.deletedAt && (m.runs ?? []).some((r) => r.status === 'completed'))
    .sort((a, b) => new Date(b.playedAt) - new Date(a.playedAt));
  let removed = 0;
  for (const match of owned.slice(keep)) {
    fs.rmSync(match.video.path, { force: true });
    match.video.deletedAt = new Date().toISOString();
    removed += 1;
  }
  if (removed) db.changed();
  return removed;
}
