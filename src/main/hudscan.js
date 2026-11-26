// Reads the HUD of a video that wasn't recorded live in ClimbCoach (an imported match), on this PC and
// before its report, like the Mac app's HUDScanner: your death screens, your kills and deaths in the kill
// feed, and the end screen. The window seeks through the video (to its keyframes, which is fast; see
// keyframes.js) and sends the parts of each frame that matter; Windows' OCR reads them here. Live
// recordings are read while you play instead.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fromCrop, HudTracker, KILL_FEED_REGION } from '../shared/hud.js';
import { keyframeTimes, sampleTimes } from './keyframes.js';

export class HudScanner {
  constructor({ ocr, send, folder, settings, mediaURL }) {
    Object.assign(this, { ocr, send, folder, settings, mediaURL });
    this.jobs = new Map();
  }

  /** Whether this match's video still needs reading. */
  needsScan(match) {
    const video = match?.video;
    return Boolean(this.ocr.available && video && !video.deletedAt && video.source !== 'liveCapture' && !video.hudScannedAt);
  }

  /** Hints for the match's video, or null when it doesn't need reading, can't be read here, or was cancelled. */
  async scan(match, progress = () => {}, signal = null) {
    if (!this.needsScan(match)) return null;
    const times = sampleTimes(await keyframeTimes(match.video.path), match.video.durationSeconds);
    if (!times.length) return null;
    const id = crypto.randomUUID();
    const playerName = match.isReference ? '' : this.settings.get().profile.inGameName?.trim() ?? '';
    fs.mkdirSync(this.folder, { recursive: true });
    const dir = fs.mkdtempSync(path.join(this.folder, 'scan-'));
    return new Promise((resolve) => {
      this.jobs.set(id, { hud: new HudTracker(), dir, playerName, progress, resolve, stall: null });
      signal?.addEventListener('abort', () => this.#finish(id, 'cancelled'));
      this.#watch(id);
      const sent = this.send('scan:job', { id, url: this.mediaURL(match.video.path), duration: match.video.durationSeconds, times, killFeed: Boolean(playerName) });
      if (!sent) this.#finish(id, 'The window is closed.');
    });
  }

  /** Gives up when the window stops sending frames (it was closed or reloaded), so the report goes on. */
  #watch(id) {
    const job = this.jobs.get(id);
    if (!job) return;
    clearTimeout(job.stall);
    job.stall = setTimeout(() => this.#finish(id, 'The window stopped reading the video.'), 90_000);
  }

  /** One sampled frame from the window; answers whether to keep going. */
  async frame(id, { time, duration, region, frame, feed }) {
    const job = this.jobs.get(id);
    if (!job) return false;
    this.#watch(id);
    const file = path.join(job.dir, 'frame.jpg');
    const feedFile = path.join(job.dir, 'feed.jpg');
    try {
      fs.writeFileSync(file, Buffer.from(frame));
      const texts = fromCrop(await this.ocr.read(file), region);
      let feedTexts = null;
      if (feed && job.playerName) {
        fs.writeFileSync(feedFile, Buffer.from(feed));
        feedTexts = fromCrop(await this.ocr.read(feedFile), KILL_FEED_REGION);
      }
      job.hud.feed(texts, time, { feed: feedTexts, playerName: job.playerName });
    } catch {
      // The text reader can't start (no OCR language): no hints this time.
      if (this.ocr.error) { this.#finish(id, this.ocr.error); return false; }
    }
    if (duration > 0) job.progress(Math.min(1, (time + 1) / duration));
    return this.jobs.has(id);
  }

  done(id, error) {
    this.#finish(id, error);
  }

  #finish(id, error) {
    const job = this.jobs.get(id);
    if (!job) return;
    this.jobs.delete(id);
    clearTimeout(job.stall);
    fs.rmSync(job.dir, { recursive: true, force: true });
    job.resolve(error ? null : job.hud.hints());
  }
}
