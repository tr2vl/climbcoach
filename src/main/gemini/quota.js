// The free tier's limits, the models whose daily limit is used up, and today's usage per model
// (port of FreeTierLimits, QuotaMemory and GeminiUsageLog). Stored next to the app's data.
import path from 'node:path';
import { readJSON, writeJSON } from '../jsonfile.js';

/** From the AI Studio rate-limit page (2026-11-25). Google changes them now and then. */
export const FREE_TIER = {
  'gemini-4-hydrogen': { requestsPerMinute: 5, tokensPerMinute: 250_000, requestsPerDay: 20 },
  'gemini-3.8-flash': { requestsPerMinute: 5, tokensPerMinute: 250_000, requestsPerDay: 20 },
  'gemini-3.6-flash': { requestsPerMinute: 5, tokensPerMinute: 250_000, requestsPerDay: 20 },
  'gemini-3-flash': { requestsPerMinute: 5, tokensPerMinute: 250_000, requestsPerDay: 20 },
  'gemini-3.5-flash-lite': { requestsPerMinute: 15, tokensPerMinute: 250_000, requestsPerDay: 500 },
  'gemini-3.1-flash-lite': { requestsPerMinute: 15, tokensPerMinute: 250_000, requestsPerDay: 500 },
};

const PACIFIC = 'America/Los_Angeles';

function pacificParts(date) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: PACIFIC, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  return Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, Number(p.value)]));
}

/** Google's quota day (Pacific time), e.g. "2026-11-26". */
export function quotaDay(date = new Date()) {
  const p = pacificParts(date);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** The next reset of Gemini's daily quotas (midnight Pacific time) after `date`. */
export function nextReset(date = new Date()) {
  const p = pacificParts(date);
  const sinceMidnight = (p.hour * 3600 + p.minute * 60 + p.second) * 1000 + date.getMilliseconds();
  let reset = new Date(date.getTime() - sinceMidnight + 86_400_000);
  // Around a daylight-saving change the day is 23 or 25 hours long.
  const q = pacificParts(reset);
  if (q.hour === 23) reset = new Date(reset.getTime() + 3_600_000);
  if (q.hour === 1) reset = new Date(reset.getTime() - 3_600_000);
  return reset;
}

export class GeminiState {
  static refusalPause = 3_600_000;

  constructor(folder, { isPaidTier = () => false } = {}) {
    this.file = folder ? path.join(folder, 'gemini-usage.json') : null;
    this.data = { dailyLimitUntil: {}, refusedAt: null, usage: [], ...(this.file ? readJSON(this.file, {}) : {}) };
    this.isPaidTier = isPaidTier;
  }

  #save() {
    if (this.file) writeJSON(this.file, this.data);
  }

  limit(model) {
    return this.isPaidTier() ? null : FREE_TIER[model] ?? null;
  }

  markDailyLimit(model, at = new Date()) {
    this.data.dailyLimitUntil[model] = nextReset(at).toISOString();
    this.#save();
  }

  exhaustedUntil(model, now = new Date()) {
    const until = this.data.dailyLimitUntil[model];
    return until && new Date(until) > now ? new Date(until) : null;
  }

  markAccountRefused(at = new Date()) {
    this.data.refusedAt = at.toISOString();
    this.#save();
  }

  clearAccountRefusal() {
    if (!this.data.refusedAt) return;
    this.data.refusedAt = null;
    this.#save();
  }

  accountRefusedRecently(now = new Date()) {
    const at = this.data.refusedAt ? new Date(this.data.refusedAt) : null;
    return at && now - at < GeminiState.refusalPause ? at : null;
  }

  #update(model, at, change) {
    const day = quotaDay(at);
    const yesterday = quotaDay(new Date(at.getTime() - 86_400_000));
    this.data.usage = this.data.usage.filter((entry) => entry.day >= yesterday);
    let entry = this.data.usage.find((e) => e.day === day && e.model === model);
    if (!entry) {
      entry = { day, model, requests: 0, inputTokens: 0, outputTokens: 0, lastLimit: null, lastLimitAt: null };
      this.data.usage.push(entry);
    }
    change(entry);
    this.#save();
  }

  recordSuccess(model, usage, at = new Date()) {
    this.#update(model, at, (entry) => {
      entry.requests += 1;
      entry.inputTokens += usage.input;
      entry.outputTokens += usage.output;
    });
    // A refusal is about the key: one answered request means the key works again.
    for (const entry of this.data.usage) {
      if (entry.lastLimit?.startsWith('refused')) { entry.lastLimit = null; entry.lastLimitAt = null; }
    }
    this.data.refusedAt = null;
    this.#save();
  }

  recordLimit(model, description, at = new Date()) {
    this.#update(model, at, (entry) => { entry.lastLimit = description; entry.lastLimitAt = at.toISOString(); });
  }

  today(now = new Date()) {
    const day = quotaDay(now);
    return this.data.usage.filter((e) => e.day === day).sort((a, b) => a.model.localeCompare(b.model));
  }

  requestsToday(model, now = new Date()) {
    return this.today(now).find((e) => e.model === model)?.requests ?? 0;
  }
}
