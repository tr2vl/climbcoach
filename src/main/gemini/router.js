// Runs a Gemini call on the preferred free model and falls back when it's overloaded, out of free
// quota or gone (port of ModelRouter). A per-minute limit is waited out; a daily limit skips the model
// until Google resets it.
import { GeminiError, limitText } from './errors.js';

export const FREE_TIER_MODELS = ['gemini-4-hydrogen', 'gemini-3.8-flash', 'gemini-3.5-flash-lite'];
/** Guide studying never uses gemini-4-hydrogen: its free requests are for match reports. */
export const STUDY_MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
export const LITE_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.8-flash'];

export class ModelRouter {
  constructor({ models = FREE_TIER_MODELS, state = null, overloadRetries = 2, maxQuotaWait = 70, quotaWaits = 2,
    fallsBackOnBadRequest = false, sleep = (s) => new Promise((r) => setTimeout(r, s * 1000)) } = {}) {
    Object.assign(this, { models, state, overloadRetries, maxQuotaWait, quotaWaits, fallsBackOnBadRequest, sleep });
  }

  async run(operation) {
    let lastError = new GeminiError('modelUnavailable', { message: 'no models configured' });
    const reasons = [];
    let onlyLimits = true;
    for (const model of this.models) {
      const until = this.state?.exhaustedUntil(model);
      if (until) {
        reasons.push(`${model}: daily limit reached earlier, resets ${until.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
        lastError = new GeminiError('quotaExceeded', { limit: { period: 'day', metric: 'unknown', value: null } });
        continue;
      }
      const limit = this.state?.limit(model);
      if (limit && this.state.requestsToday(model) >= limit.requestsPerDay) {
        reasons.push(`${model}: all ${limit.requestsPerDay} free requests used today`);
        lastError = new GeminiError('quotaExceeded', { limit: { period: 'day', metric: 'requests', value: limit.requestsPerDay } });
        continue;
      }
      let overloads = 0;
      let waits = 0;
      for (;;) {
        try {
          return { value: await operation(model), model };
        } catch (error) {
          if (!(error instanceof GeminiError)) throw error;
          if (error.kind === 'overloaded' && overloads < this.overloadRetries) {
            overloads += 1;
            await this.sleep(2 << overloads);
            continue;
          }
          if (error.kind === 'quotaExceeded' && error.retryAfter != null && error.limit?.period !== 'day'
            && error.retryAfter <= this.maxQuotaWait && waits < this.quotaWaits) {
            waits += 1;
            this.state?.recordLimit(model, error.limit ? limitText(error.limit) : 'per-minute limit');
            await this.sleep(error.retryAfter + 1);
            continue;
          }
          if (error.isAccountRefusal) {
            this.state?.markAccountRefused();
            this.state?.recordLimit(model, 'refused by Google (plan/billing)');
            throw new GeminiError('accountRefused', { message: error.detailMessage });
          }
          if (error.kind === 'quotaExceeded') {
            if (error.limit?.period === 'day') this.state?.markDailyLimit(model);
            const text = error.limit ? limitText(error.limit) : error.detailMessage ? `refused: ${error.detailMessage}` : 'refused (quota), no reason given';
            this.state?.recordLimit(model, text);
            reasons.push(`${model}: ${text}`);
            lastError = error;
          } else if (error.kind === 'overloaded') {
            reasons.push(`${model}: overloaded`);
            lastError = error;
          } else if (error.kind === 'modelUnavailable') {
            onlyLimits = false;
            reasons.push(`${model}: not available (${error.detailMessage})`);
            lastError = error;
          } else if (error.kind === 'badRequest' && this.fallsBackOnBadRequest) {
            onlyLimits = false;
            lastError = error;
          } else {
            throw error;
          }
          break;
        }
      }
    }
    if (onlyLimits && reasons.length > 1) throw new GeminiError('noFreeModel', { reasons });
    throw lastError;
  }
}
