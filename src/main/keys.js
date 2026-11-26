import path from 'node:path';
import { readJSON, writeJSON } from './jsonfile.js';

/**
 * Your own API keys, encrypted with Windows' data protection for your user account (Electron safeStorage).
 * They never leave this PC except in requests to Google, and they are never part of the app or an update.
 */
export class KeyVault {
  static kinds = ['gemini', 'youtube'];

  constructor(folder, safeStorage) {
    this.file = path.join(folder, 'keys.json');
    this.safeStorage = safeStorage;
  }

  #all() {
    return readJSON(this.file, {});
  }

  status() {
    const stored = this.#all();
    return Object.fromEntries(KeyVault.kinds.map((kind) => [kind, Boolean(stored[kind])]));
  }

  read(kind) {
    const stored = this.#all()[kind];
    if (!stored) return null;
    try {
      return this.safeStorage.decryptString(Buffer.from(stored, 'base64'));
    } catch {
      return null;
    }
  }

  save(kind, value) {
    if (!KeyVault.kinds.includes(kind)) throw new Error(`Unknown key: ${kind}`);
    const clean = String(value ?? '').trim();
    const stored = this.#all();
    if (clean) {
      if (!this.safeStorage.isEncryptionAvailable()) throw new Error('Windows encryption is not available, so the key can\'t be stored safely.');
      stored[kind] = this.safeStorage.encryptString(clean).toString('base64');
    } else {
      delete stored[kind];
    }
    writeJSON(this.file, stored);
  }
}

/**
 * Whether a pasted key could be a Google API key. Since May 2026 Google AI Studio makes keys starting with
 * "AQ." (older ones start with "AIza" and are 39 characters long) and doesn't publish their length, so this
 * only catches obvious slips: nothing pasted, spaces inside, or far too short. Google's answer decides the rest.
 */
export function looksLikeGoogleKey(value) {
  return /^[\x21-\x7e]{20,}$/.test(String(value ?? '').trim());
}

const SHAPE_MESSAGE = 'That doesn\'t look like an API key. Copy it again with the copy button next to it '
  + '(Gemini keys start with "AQ." or, if older, "AIza").';

/**
 * Checks a key with a request that costs nothing from the daily free requests:
 * Gemini lists its models, YouTube looks up one video id (1 of 10,000 daily units).
 */
export async function testKey(kind, key, fetchImpl = fetch) {
  const clean = String(key ?? '').trim();
  if (!looksLikeGoogleKey(clean)) {
    return { ok: false, message: SHAPE_MESSAGE };
  }
  const url = kind === 'gemini'
    ? 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1'
    : 'https://www.googleapis.com/youtube/v3/videos?part=id&id=jNQXAC9IVRw';
  try {
    const response = await fetchImpl(url, { headers: { 'x-goog-api-key': clean } });
    if (response.ok) return { ok: true, message: kind === 'gemini' ? 'The key works. Your coach can watch matches.' : 'The key works. Learn can search for guides.' };
    const body = await response.json().catch(() => ({}));
    const reason = body?.error?.message ?? `HTTP ${response.status}`;
    if (kind === 'youtube' && /has not been used|is disabled/i.test(reason)) {
      return { ok: false, message: 'The key is real, but "YouTube Data API v3" isn\'t switched on for its project yet. Do step 2 again, wait a minute, then test again.' };
    }
    if (/API key not valid|API_KEY_INVALID/i.test(reason)) return { ok: false, message: 'Google says this key isn\'t valid. Copy it again with the copy button next to it.' };
    // Some new "AQ." keys are refused this way; Google's advice is to delete the key and create a fresh one.
    const reasons = (body?.error?.details ?? []).map((d) => d.reason);
    if (kind === 'gemini' && (reasons.includes('ACCESS_TOKEN_TYPE_UNSUPPORTED') || response.status === 401)) {
      return { ok: false, message: 'Google didn\'t accept this key. In AI Studio, delete it, press Create API key again and paste the new one. (Google: ' + reason + ')' };
    }
    return { ok: false, message: `Google refused the key: ${reason}` };
  } catch (error) {
    return { ok: false, message: `Couldn't reach Google. Check your internet connection. (${error.message})` };
  }
}
