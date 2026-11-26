// The AI back end seen by the pipeline: client + router + pacing + usage log (port of GeminiEngine and RequestPacer).
import { GeminiClient } from './client.js';
import { estimatedInputTokens, mimeTypeFor } from './request.js';
import { ModelRouter } from './router.js';

/** Spaces requests so each model stays under its per-minute limits: waiting a minute beats being refused. */
export class RequestPacer {
  constructor({ now = () => Date.now(), sleep = (s) => new Promise((r) => setTimeout(r, s * 1000)) } = {}) {
    this.history = new Map();
    this.now = now;
    this.sleep = sleep;
    this.counter = 0;
  }

  async reserve(model, tokens, limit) {
    const id = ++this.counter;
    if (!limit) return id;
    for (;;) {
      const current = this.now();
      const window = (this.history.get(model) ?? []).filter((e) => current - e.time < 60_000);
      this.history.set(model, window);
      const used = window.reduce((sum, e) => sum + e.tokens, 0);
      const fits = window.length < limit.requestsPerMinute && (used + tokens <= limit.tokensPerMinute || window.length === 0);
      if (fits) {
        window.push({ id, time: current, tokens });
        return id;
      }
      const oldest = Math.min(...window.map((e) => e.time));
      await this.sleep(Math.max(1, 60 - (current - oldest) / 1000 + 0.5));
    }
  }

  settle(id, model, tokens) {
    const entry = (this.history.get(model) ?? []).find((e) => e.id === id);
    if (entry) entry.tokens = tokens;
  }
}

export const sharedPacer = new RequestPacer();

export class GeminiEngine {
  constructor({ apiKey, models, state, pacer = sharedPacer, client = new GeminiClient(apiKey), fallsBackOnBadRequest = false }) {
    this.client = client;
    this.state = state;
    this.pacer = pacer;
    this.router = new ModelRouter({ models, state, fallsBackOnBadRequest });
  }

  async upload(file, { signal, onProgress } = {}) {
    return this.client.uploadVideo(file, { displayName: `climbcoach-${Math.random().toString(36).slice(2, 10)}`, mimeType: mimeTypeFor(file), signal, onProgress });
  }

  async generate(request, { signal } = {}) {
    const estimate = estimatedInputTokens(request);
    const { value: result, model } = await this.router.run(async (model) => {
      const booking = await this.pacer.reserve(model, estimate, this.state?.limit(model));
      try {
        const answer = await this.client.generate(model, request, { signal });
        this.pacer.settle(booking, model, answer.usage.input);
        return answer;
      } catch (error) {
        // A refused request still counts against the minute's requests, but not its tokens.
        this.pacer.settle(booking, model, 0);
        throw error;
      }
    });
    this.state?.recordSuccess(model, result.usage);
    return { result, model };
  }

  async delete(remote) {
    await this.client.delete(remote);
  }
}
