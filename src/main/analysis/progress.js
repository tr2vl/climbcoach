// The answers a report already got from Gemini, kept until the report is saved (port of ReportProgress and
// ResumableEngine). When a report stops halfway (Gemini too busy, the daily limit reached), trying again reuses
// them and only asks for the parts still missing, so the requests already spent aren't spent again.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { encodeRequest } from '../gemini/request.js';
import { readJSON, writeJSON } from '../jsonfile.js';

/** Answers older than this are asked for again. */
export const KEEP_FOR = 3 * 86_400_000;

/**
 * A request's fingerprint: everything Gemini is sent except the uploaded video's name, which changes with each
 * upload. The prompts are part of it, so a changed prompt or match detail asks Gemini again.
 */
export function fingerprint(request) {
  const text = JSON.stringify(encodeRequest(request)).replace(/"fileUri":"[^"]*"/g, '"fileUri":""');
  return createHash('sha256').update(text).digest('hex');
}

export class ReportProgress {
  constructor(file) {
    this.file = file;
  }

  static forMatch(folder, matchID) {
    return new ReportProgress(path.join(folder, 'report-progress', `${matchID}.json`));
  }

  #load() {
    return readJSON(this.file, {});
  }

  /** A kept answer for this request, if one of `models` wrote it: { result, model }. */
  answer(request, models, now = Date.now()) {
    const saved = this.#load()[fingerprint(request)];
    if (!saved || !models.includes(saved.model) || now - new Date(saved.savedAt) >= KEEP_FOR) return null;
    return { result: { text: saved.text, usage: { input: saved.input, output: saved.output }, modelVersion: null }, model: saved.model };
  }

  keep(result, model, request, now = Date.now()) {
    const all = Object.fromEntries(Object.entries(this.#load()).filter(([, saved]) => now - new Date(saved.savedAt) < KEEP_FOR));
    all[fingerprint(request)] = { text: result.text, model, input: result.usage.input, output: result.usage.output, savedAt: new Date(now).toISOString() };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    writeJSON(this.file, all);
  }

  /** How many answers are kept (and still fresh). */
  count(now = Date.now()) {
    return Object.values(this.#load()).filter((saved) => now - new Date(saved.savedAt) < KEEP_FOR).length;
  }

  /** The report was saved: its answers aren't needed any more. */
  clear() {
    fs.rmSync(this.file, { force: true });
  }
}

/** Gives the pipeline the answers a stopped report already got and keeps each new one as it arrives. */
export class ResumableEngine {
  /** Only answers from `models` are reused (a weaker model's answer doesn't stand in for the best one's). */
  constructor(engine, progress, models) {
    Object.assign(this, { engine, progress, models });
  }

  upload(...args) {
    return this.engine.upload(...args);
  }

  async generate(request, options) {
    const kept = this.progress.answer(request, this.models);
    if (kept) return kept;
    const call = await this.engine.generate(request, options);
    this.progress.keep(call.result, call.model, request);
    return call;
  }

  delete(remote) {
    return this.engine.delete(remote);
  }
}

/** True when the report stopped because Gemini took no more requests (busy, limits, no connection). */
export function stoppedByGemini(error) {
  if (['overloaded', 'noAnswer', 'quotaExceeded', 'noFreeModel', 'server'].includes(error?.kind)) return true;
  // fetch() failed before Google answered: no connection.
  return error instanceof TypeError && /fetch failed/i.test(error.message);
}

/** The failure text when the parts already done are kept. */
export function stoppedMessage(error, partsKept) {
  return `${error.message} The ${partsKept} part${partsKept === 1 ? '' : 's'} of this report already done `
    + `${partsKept === 1 ? 'is' : 'are'} kept: trying again only asks Gemini for the rest.`;
}
