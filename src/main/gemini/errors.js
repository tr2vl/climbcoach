// Gemini errors, mapped from the API's error responses (port of GeminiError).

export class GeminiError extends Error {
  /**
   * @param {string} kind invalidKey | quotaExceeded | noFreeModel | accountRefused | searchNotFree | overloaded |
   *   modelUnavailable | badRequest | server | fileProcessingFailed | blocked | malformedResponse | cancelled
   */
  constructor(kind, details = {}) {
    super(GeminiError.describe(kind, details));
    const { message, ...rest } = details;
    this.kind = kind;
    Object.assign(this, rest);
    /** Google's own words, when it gave some. */
    this.detailMessage = message ?? null;
  }

  static describe(kind, d) {
    switch (kind) {
      case 'invalidKey': return 'Gemini rejected the API key. Check it in Settings.';
      case 'quotaExceeded':
        if (d.limit && d.limit.period !== 'unknown') {
          return `Gemini's free ${limitText(d.limit)} was reached${d.retryAfter != null ? `; it frees up in about ${Math.round(d.retryAfter)} s.` : '.'}`;
        }
        return `Gemini refused the request (quota)${d.message ? `. Google says: ${d.message}` : '.'}${d.retryAfter != null ? ` Retry in about ${Math.round(d.retryAfter)} s.` : ''}`;
      case 'accountRefused':
        return `Google refuses every request for this key, although the free limits aren't used up. Google says: "${d.message}" `
          + 'This usually means the key\'s Google project isn\'t on the free tier any more, for example after billing was switched on with no credit. '
          + 'Check aistudio.google.com → Rate limits: it should say "Free tier". If the project stays stuck, create a new API key in a new project there and save it in Settings.';
      case 'searchNotFree': return 'This needs Google Search inside Gemini, which isn\'t part of the free tier. Your key itself is fine.';
      case 'noFreeModel': return `No free Gemini model could take the request right now:\n${(d.reasons ?? []).map((line) => `• ${line}`).join('\n')}`;
      case 'overloaded': return 'Gemini is overloaded right now. Try again in a few minutes.';
      case 'modelUnavailable': return `Model not available: ${d.message}`;
      case 'badRequest': return `Gemini rejected the request: ${d.message}`;
      case 'server': return `Gemini error ${d.status}: ${d.message}`;
      case 'fileProcessingFailed': return `Gemini couldn't process the uploaded video (${d.name}).`;
      case 'blocked': return `Gemini blocked the response (${d.reason}).`;
      case 'malformedResponse': return `Gemini returned something unexpected: ${d.detail}`;
      case 'cancelled': return 'Cancelled.';
      default: return 'Gemini error.';
    }
  }

  /** The generic refusal Google gives when the project's plan or billing blocks requests. */
  get isAccountRefusal() {
    if (this.kind === 'accountRefused') return true;
    return this.kind === 'quotaExceeded' && !this.limit && /plan and billing/i.test(this.detailMessage ?? '');
  }

  get isDailyLimit() {
    return this.kind === 'quotaExceeded' && this.limit?.period === 'day';
  }
}

export function limitText(limit) {
  const amount = limit.value != null ? `${limit.value.toLocaleString('en-US')} ` : '';
  const unit = { requests: 'requests', inputTokens: 'tokens' }[limit.metric] ?? 'units';
  if (limit.period === 'day') return `daily limit (${amount}${unit} a day)`;
  if (limit.period === 'minute') return `per-minute limit (${amount}${unit} a minute)`;
  return 'free-tier limit';
}

/** From a quota id like "GenerateRequestsPerDayPerProjectPerModel-FreeTier" and its value. */
export function quotaLimit(quotaID, value) {
  return {
    period: quotaID.includes('PerDay') ? 'day' : quotaID.includes('PerMinute') ? 'minute' : 'unknown',
    metric: quotaID.includes('Token') ? 'inputTokens' : quotaID.includes('Request') ? 'requests' : 'unknown',
    value: value != null && !Number.isNaN(Number(value)) ? Number(value) : null,
  };
}

const short = (text) => {
  const line = String(text).split('\n')[0];
  return line.length > 220 ? `${line.slice(0, 220)}…` : line;
};

/** Maps an error response body from the Gemini API. */
export function errorFromResponse(status, bodyText) {
  let body = null;
  try { body = JSON.parse(bodyText)?.error ?? null; } catch { /* not JSON */ }
  const message = body?.message ?? String(bodyText).slice(0, 300);
  const details = body?.details ?? [];
  if (details.some((d) => d.reason === 'API_KEY_INVALID') || status === 401 || status === 403) return new GeminiError('invalidKey');
  switch (status) {
    case 429: {
      const delayText = details.map((d) => d.retryDelay).find(Boolean);
      const retryAfter = delayText ? Number(String(delayText).replace('s', '')) : null;
      const limits = details.flatMap((d) => d.violations ?? []).filter((v) => v.quotaId).map((v) => quotaLimit(v.quotaId, v.quotaValue));
      const limit = limits.find((l) => l.period === 'day') ?? limits[0] ?? null;
      return new GeminiError('quotaExceeded', { retryAfter: Number.isFinite(retryAfter) ? retryAfter : null, limit, message: limit ? null : (body?.message ? short(body.message) : null) });
    }
    case 503: return new GeminiError('overloaded');
    case 404: return new GeminiError('modelUnavailable', { message });
    case 400: return new GeminiError('badRequest', { message });
    default: return new GeminiError('server', { status, message });
  }
}
