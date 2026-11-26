// Runs analyses in the background, one at a time, keeps their progress, and queues reports for the
// best model's daily reset (port of AnalysisCenter and ReportModelPolicy).
import fs from 'node:fs';
import path from 'node:path';
import { gameMap } from '../../shared/catalog.js';
import { RUBRIC_VERSION } from '../../shared/rubric-text.js';
import { habitBrief } from '../../shared/training.js';
import { GeminiEngine } from '../gemini/engine.js';
import { nextReset } from '../gemini/quota.js';
import { FREE_TIER_MODELS } from '../gemini/router.js';
import { readJSON, writeJSON } from '../jsonfile.js';
import { runPipeline } from './pipeline.js';
import { ReportProgress, ResumableEngine, stoppedByGemini, stoppedMessage } from './progress.js';
import { PROMPT_VERSION } from './prompts.js';
import { requestsNeeded } from './specialists.js';

export const BEST_MODEL = 'gemini-4-hydrogen';

export class AnalysisCenter {
  constructor({ db, folder, keys, state, settings, scanHUD = null, afterReport = () => {}, notify = () => {}, makeEngine = (options) => new GeminiEngine(options) }) {
    Object.assign(this, { db, keys, state, settings, scanHUD, afterReport, notify, makeEngine });
    this.folder = folder ?? null;
    this.queueFile = folder ? path.join(folder, 'analysis-queue.json') : null;
    this.queue = this.queueFile ? readJSON(this.queueFile, []) : [];
    this.jobs = new Map();
    this.wake = null;
    this.pausedUntil = null;
  }

  get bestOnly() {
    return this.settings.get().prefs?.reportsBestModelOnly ?? true;
  }

  /** The best model's free requests left today by our own count; null on a paid key (no daily limit). */
  requestsLeft() {
    const limit = this.state.limit(BEST_MODEL);
    if (!limit) return null;
    if (this.state.exhaustedUntil(BEST_MODEL)) return 0;
    return Math.max(0, limit.requestsPerDay - this.state.requestsToday(BEST_MODEL));
  }

  status() {
    return {
      jobs: Object.fromEntries([...this.jobs].map(([id, job]) => [id, { startedAt: job.startedAt, progress: job.progress }])),
      queue: this.queue, resumesAt: nextReset().toISOString(), requestsLeft: this.requestsLeft(), reportsLeft: this.#reportsLeft(),
    };
  }

  #reportsLeft() {
    const left = this.requestsLeft();
    return left == null ? null : Math.floor(left / requestsNeeded('lean'));
  }

  #changed() {
    this.notify(this.status());
  }

  #saveQueue() {
    if (this.queueFile) writeJSON(this.queueFile, this.queue);
    this.#changed();
  }

  dequeue(matchID) {
    this.queue = this.queue.filter((q) => q.matchID !== matchID);
    this.#saveQueue();
  }

  #enqueue(matchID, mode) {
    if (!this.queue.some((q) => q.matchID === matchID)) this.queue.push({ matchID, mode, queuedAt: new Date().toISOString() });
    this.#saveQueue();
    this.#scheduleWake();
  }

  #scheduleWake() {
    clearTimeout(this.wake);
    if (!this.queue.length) return;
    const delay = Math.max(60_000, nextReset() - Date.now() + 60_000);
    this.wake = setTimeout(() => this.processQueue(), Math.min(delay, 2 ** 31 - 1));
  }

  /** Starts waiting reports, oldest first, while the best model has enough requests left today. */
  processQueue() {
    if (this.jobs.size || !this.queue.length) return;
    if (this.state.accountRefusedRecently() || (this.pausedUntil && this.pausedUntil > new Date())) return this.#scheduleWake();
    const next = this.queue[0];
    const match = this.db.match(next.matchID);
    if (!match?.video) {
      this.dequeue(next.matchID);
      return this.processQueue();
    }
    const left = this.requestsLeft();
    if (this.bestOnly && left != null && left < this.#requestsStillNeeded(next.matchID, next.mode)) return this.#scheduleWake();
    this.dequeue(next.matchID);
    try { this.start(next.matchID, { mode: next.mode }); } catch { /* shown on the match */ }
  }

  /** Starts the analysis, or queues it when the best model hasn't enough free requests left today. */
  start(matchID, { mode = 'lean', allowFallback = false } = {}) {
    if (this.jobs.has(matchID)) return { started: true };
    const key = this.keys.read('gemini');
    if (!key) throw new Error('Add your free Gemini API key in Settings first.');
    const match = this.db.match(matchID);
    if (!match?.video) throw new Error('Attach a video or record the match first.');
    if (!fs.existsSync(match.video.path)) throw new Error('The video file was moved or deleted. Locate it in the Video panel.');
    const bestOnly = this.bestOnly && !allowFallback;
    const left = this.requestsLeft();
    if (bestOnly && left != null && left < this.#requestsStillNeeded(matchID, mode)) {
      this.#enqueue(matchID, mode);
      return { queued: nextReset().toISOString() };
    }
    this.dequeue(matchID);
    const settings = this.settings.get();
    const context = this.#context(match, settings.profile);
    const controller = new AbortController();
    const job = { startedAt: new Date().toISOString(), progress: { step: 'readingHUD', fraction: 0 }, controller };
    this.jobs.set(matchID, job);
    this.#changed();
    const models = bestOnly ? [BEST_MODEL] : FREE_TIER_MODELS;
    // Answers this report already got before it stopped are reused, so they aren't paid for twice.
    const kept = this.folder ? ReportProgress.forMatch(this.folder, matchID) : null;
    const gemini = this.makeEngine({ apiKey: key, models, state: this.state });
    const engine = kept ? new ResumableEngine(gemini, kept, models) : gemini;
    const progress = (value) => { job.progress = value; this.#changed(); };
    (async () => {
      try {
        if (this.scanHUD) {
          const hints = await this.scanHUD(match, (fraction) => progress({ step: 'readingHUD', fraction }), controller.signal);
          if (hints) this.db.replaceHUDEvents(matchID, hints);
        }
        const scoreboard = match.screenshots?.at(-1)?.path ?? null;
        const outcome = await runPipeline({
          engine, mode, context, video: match.video.path, remote: this.db.reusableUpload(matchID), hints: this.db.ocrHints(matchID),
          scoreboardImage: scoreboard, progress, signal: controller.signal,
        });
        outcome.rubricVersion = RUBRIC_VERSION;
        this.db.saveReport(matchID, outcome, { mode, startedAt: job.startedAt, profile: settings.profile, habitID: context.habit?.id ?? null, promptVersion: PROMPT_VERSION });
        kept?.clear();
        await this.afterReport(matchID);
      } catch (error) {
        if (error.kind === 'cancelled' || controller.signal.aborted) {
          // Cancelled by you: nothing to store.
        } else if (bestOnly && error.isDailyLimit) {
          // The best model ran out mid-report: wait for its reset instead of failing.
          this.pausedUntil = nextReset();
          this.#enqueue(matchID, mode);
        } else {
          // Kept answers only help when Gemini stopped taking requests; after any other failure one of them may be
          // the cause (an answer that didn't fit), so the next try asks again from the start.
          const done = kept?.count() ?? 0;
          if (!stoppedByGemini(error)) kept?.clear();
          const failure = stoppedByGemini(error) && done > 0 ? new Error(stoppedMessage(error, done)) : error;
          this.db.saveFailure(matchID, failure, { mode, startedAt: job.startedAt, promptVersion: PROMPT_VERSION });
        }
      } finally {
        this.jobs.delete(matchID);
        this.#changed();
        this.processQueue();
      }
    })();
    return { started: true };
  }

  /** Requests a report still has to make: those whose answers were kept from a try that stopped aren't made again. */
  #requestsStillNeeded(matchID, mode) {
    const done = this.folder ? ReportProgress.forMatch(this.folder, matchID).count() : 0;
    return Math.max(1, requestsNeeded(mode) - done);
  }

  cancel(matchID) {
    this.jobs.get(matchID)?.controller.abort();
  }

  /** What the prompts need about the match; the habit you train is checked in your own matches only. */
  #context(match, profile) {
    const video = match.video;
    const map = gameMap(match.mapKey);
    const range = video.range ?? null;
    return {
      inGameName: match.isReference ? '' : profile.inGameName ?? '', role: match.role, rank: match.rank, heroKeys: match.heroKeys ?? [],
      mapName: map?.name ?? null, mode: match.mode ?? null, result: match.result ?? 'unknown',
      duration: range ? range.end - range.start : video.durationSeconds, videoDuration: video.durationSeconds, range,
      hasAudio: video.hasAudio !== false, isLiveRecording: video.source === 'liveCapture', isReference: Boolean(match.isReference),
      habit: match.isReference ? null : habitBrief(this.db.data.habits, this.db.data.matches, match.playedAt),
    };
  }
}
