// Building generateContent requests (port of GenerateRequest and its token estimate).

/** Measured 2026-11-25: ~100 tokens per frame on gemini-4-hydrogen, 32 per audio second. */
export const TOKENS_PER_FRAME = 100;
export const TOKENS_PER_LOW_RES_FRAME = 40;
export const AUDIO_TOKENS_PER_SECOND = 32;

const offset = (seconds) => `${Math.max(0, seconds).toFixed(1)}s`;

export const part = {
  text: (text) => ({ text }),
  /** A stretch of an uploaded video, sampled at `fps`. */
  video: (fileUri, mimeType, fps, start = null, end = null) => ({ fileUri, mimeType, fps, start, end, kind: 'video' }),
  image: (data, mimeType) => ({ kind: 'image', data, mimeType }),
  youtube: (url, end = null) => ({ kind: 'youtube', url, end }),
};

/**
 * @param {object} options
 * @param {string|null} options.system
 * @param {object[]} options.parts
 * @param {object|null} options.schema  JSON schema of the answer
 */
export function makeRequest({ system = null, parts, schema = null, temperature = 0, lowMediaResolution = false, videoSeconds = null }) {
  return { system, parts, schema, temperature, lowMediaResolution, videoSeconds };
}

/** The REST body for generateContent. */
export function encodeRequest(request) {
  const encodePart = (p) => {
    if (p.kind === 'video') {
      const videoMetadata = { fps: p.fps };
      if (p.start != null) videoMetadata.startOffset = offset(p.start);
      if (p.end != null) videoMetadata.endOffset = offset(p.end);
      return { fileData: { mimeType: p.mimeType, fileUri: p.fileUri }, videoMetadata };
    }
    if (p.kind === 'image') return { inlineData: { mimeType: p.mimeType, data: Buffer.from(p.data).toString('base64') } };
    if (p.kind === 'youtube') return { fileData: { fileUri: p.url }, ...(p.end != null ? { videoMetadata: { endOffset: offset(p.end) } } : {}) };
    return { text: p.text };
  };
  const body = {
    contents: [{ role: 'user', parts: request.parts.map(encodePart) }],
    generationConfig: { temperature: request.temperature ?? 0 },
  };
  if (request.system) body.systemInstruction = { parts: [{ text: request.system }] };
  if (request.schema) {
    body.generationConfig.responseMimeType = 'application/json';
    body.generationConfig.responseJsonSchema = request.schema;
  }
  if (request.lowMediaResolution) body.generationConfig.mediaResolution = 'MEDIA_RESOLUTION_LOW';
  return body;
}

/** A rough input size, for pacing. Whole-video parts use `videoSeconds` (or assume 15 minutes). */
export function estimatedInputTokens(request) {
  const frame = request.lowMediaResolution ? TOKENS_PER_LOW_RES_FRAME : TOKENS_PER_FRAME;
  let total = (request.system?.length ?? 0) / 4;
  for (const p of request.parts) {
    if (p.kind === 'image') total += 1500;
    else if (p.kind === 'video') {
      const seconds = p.start != null && p.end != null ? p.end - p.start : request.videoSeconds ?? 900;
      total += seconds * (p.fps * frame + AUDIO_TOKENS_PER_SECOND);
    } else if (p.kind === 'youtube') total += (p.end ?? 1200) * (frame + AUDIO_TOKENS_PER_SECOND);
    else total += (p.text?.length ?? 0) / 4;
  }
  return Math.round(total);
}

/** The frame rate for a whole-match pass that keeps the request under `budget` tokens (at most 1 fps). */
export function wholeMatchFPS(duration, budget = 180_000) {
  if (!(duration > 0)) return 1;
  const fps = (budget / duration - AUDIO_TOKENS_PER_SECOND) / TOKENS_PER_FRAME;
  return Math.min(1, Math.max(0.2, Math.floor(fps * 10) / 10));
}

export const mimeTypeFor = (file) => {
  const ext = String(file).toLowerCase().split('.').pop();
  return { mov: 'video/mov', webm: 'video/webm', mkv: 'video/x-matroska', avi: 'video/avi' }[ext] ?? 'video/mp4';
};
