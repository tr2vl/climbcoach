// Minimal Gemini REST client: Files API upload, generateContent with JSON output, file deletion.
// The key travels only in the x-goog-api-key header, never in a URL. (Port of GeminiClient.)
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { GeminiError, errorFromResponse } from './errors.js';
import { encodeRequest } from './request.js';

export const BASE = 'https://generativelanguage.googleapis.com';
// A full-match video call normally answers within 2 minutes. Google counts a request it took even when it never
// answers, so ClimbCoach waits long for a busy model rather than giving up and sending it again.
const GENERATE_TIMEOUT = 480_000;

export class GeminiClient {
  constructor(apiKey, { fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
    this.apiKey = apiKey;
    this.fetch = fetchImpl;
    this.sleep = sleep;
  }

  async #send(url, options = {}, timeout = 60_000) {
    const signal = AbortSignal.any([AbortSignal.timeout(timeout), ...(options.signal ? [options.signal] : [])]);
    let response;
    try {
      response = await this.fetch(url, { ...options, signal, headers: { 'x-goog-api-key': this.apiKey, ...(options.headers ?? {}) } });
    } catch (error) {
      if (options.signal?.aborted) throw new GeminiError('cancelled');
      // An overloaded model can hang instead of answering 503.
      if (error.name === 'TimeoutError') throw new GeminiError('noAnswer', { minutes: Math.round(timeout / 60_000) });
      throw error;
    }
    if (!response.ok) throw errorFromResponse(response.status, await response.text());
    return response;
  }

  /** Resumable upload of a local video; returns the file once Google has processed it. */
  async uploadVideo(file, { displayName, mimeType, signal, onProgress } = {}) {
    const size = fs.statSync(file).size;
    const start = await this.#send(`${BASE}/upload/v1beta/files`, {
      method: 'POST', signal,
      headers: {
        'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(size), 'X-Goog-Upload-Header-Content-Type': mimeType,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ file: { display_name: displayName } }),
    });
    const uploadURL = start.headers.get('x-goog-upload-url');
    if (!uploadURL) throw new GeminiError('malformedResponse', { detail: 'no upload URL' });
    let sent = 0;
    const stream = fs.createReadStream(file, { highWaterMark: 4 * 1024 * 1024 });
    stream.on('data', (chunk) => { sent += chunk.length; onProgress?.(sent / size); });
    const response = await this.#send(uploadURL, {
      method: 'POST', signal, duplex: 'half', body: Readable.toWeb(stream),
      headers: { 'Content-Length': String(size), 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' },
    }, 30 * 60_000);
    const remote = (await response.json()).file;
    return this.waitUntilActive(remote, { signal });
  }

  async waitUntilActive(remote, { signal, every = 3000, maxPolls = 200 } = {}) {
    let current = remote;
    for (let poll = 0; poll < maxPolls; poll += 1) {
      if (current.state === 'ACTIVE') return current;
      if (current.state === 'FAILED') throw new GeminiError('fileProcessingFailed', { name: remote.name });
      await this.sleep(every);
      if (signal?.aborted) throw new GeminiError('cancelled');
      current = await (await this.#send(`${BASE}/v1beta/${remote.name}`, { signal })).json();
    }
    throw new GeminiError('fileProcessingFailed', { name: remote.name });
  }

  async generate(model, request, { signal } = {}) {
    const response = await this.#send(`${BASE}/v1beta/models/${model}:generateContent`, {
      method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(encodeRequest(request)),
    }, GENERATE_TIMEOUT);
    const body = await response.json();
    if (body.promptFeedback?.blockReason) throw new GeminiError('blocked', { reason: body.promptFeedback.blockReason });
    const candidate = body.candidates?.[0];
    if (!candidate) throw new GeminiError('malformedResponse', { detail: 'no candidates' });
    if (candidate.finishReason && !['STOP', 'MAX_TOKENS'].includes(candidate.finishReason)) {
      throw new GeminiError('blocked', { reason: candidate.finishReason });
    }
    const text = (candidate.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join('');
    if (!text) throw new GeminiError('malformedResponse', { detail: 'empty answer' });
    const usage = body.usageMetadata ?? {};
    return {
      text,
      usage: { input: usage.promptTokenCount ?? 0, output: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0) },
      modelVersion: body.modelVersion ?? null,
    };
  }

  async delete(remote) {
    try { await this.#send(`${BASE}/v1beta/${remote.name}`, { method: 'DELETE' }); } catch { /* Google deletes it after 48 h anyway */ }
  }
}
