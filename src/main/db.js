// The app's database: one JSON file of your matches, reports, habits, notes and studied guides.
// Replaces the Mac app's Core Data store; written atomically, with a backup per app version.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { hero, gameMap, heroKeyFor } from '../shared/catalog.js';
import { parseTimestamp } from '../shared/rubric.js';
import { readJSON, writeJSON } from './jsonfile.js';

export const DB_VERSION = 1;
const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

export function emptyDatabase() {
  return { version: DB_VERSION, matches: [], habits: [], weeklyReports: [], focusGoals: [], mapNotes: {}, drills: [], learnVideos: [], heroStats: [], patchNotes: [] };
}

export class Database {
  constructor(folder, { onChange = () => {} } = {}) {
    this.file = folder ? path.join(folder, 'climbcoach-data.json') : null;
    this.data = { ...emptyDatabase(), ...(this.file ? readJSON(this.file, {}) : {}) };
    this.onChange = onChange;
    this.timer = null;
  }

  /** Saves soon (several changes in a row are written once). */
  changed() {
    this.onChange();
    if (!this.file) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 300);
  }

  flush() {
    clearTimeout(this.timer);
    if (this.file) writeJSON(this.file, this.data);
  }

  /** Before an update changes anything, keep a copy of the data as it was. */
  backup(label) {
    if (!this.file || !fs.existsSync(this.file)) return null;
    const folder = path.join(path.dirname(this.file), 'backups');
    fs.mkdirSync(folder, { recursive: true });
    const target = path.join(folder, `climbcoach-data-${label}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.copyFileSync(this.file, target);
    return target;
  }

  /** Everything the window shows, without the bulky on-device HUD events. */
  snapshot() {
    return structuredClone({ ...this.data, matches: this.data.matches.map(({ events, ...match }) => ({ ...match, events: undefined })) });
  }

  match(id) {
    return this.data.matches.find((m) => m.id === id) ?? null;
  }

  // ---------- Matches ----------

  addMatch(draft) {
    const match = {
      id: uuid(), createdAt: now(), playedAt: draft.playedAt ?? now(), replayCode: draft.replayCode ?? null, patchLabel: draft.patchLabel ?? null,
      mapKey: draft.mapKey ?? null, mode: draft.mode ?? null, queue: draft.queue ?? 'competitive', role: draft.role ?? 'damage',
      result: draft.result ?? 'unknown', rank: draft.rank ?? null, heroKeys: draft.heroKeys ?? [], stats: draft.stats ?? {},
      notes: draft.notes ?? '', focusAdherence: null, isReference: Boolean(draft.isReference),
      screenshots: draft.screenshots ?? [], video: draft.video ?? null, events: draft.events ?? [], fights: [], runs: [],
    };
    this.data.matches.push(match);
    this.changed();
    return match;
  }

  updateMatch(id, patch) {
    const match = this.match(id);
    if (!match) return null;
    Object.assign(match, patch);
    this.changed();
    return match;
  }

  deleteMatch(id) {
    const match = this.match(id);
    this.data.matches = this.data.matches.filter((m) => m.id !== id);
    this.changed();
    return match;
  }

  /** Replaces the on-device HUD events (source "ocr") of a match, read from its video just now. */
  replaceHUDEvents(id, hints) {
    const match = this.match(id);
    if (match.video) match.video.hudScannedAt = new Date().toISOString();
    match.events = [...(match.events ?? []).filter((e) => e.source !== 'ocr'),
      ...hints.map((hint) => ({ timestamp: hint.time, kind: hint.kind, payload: hint.payload ?? null, confidence: 'medium', source: 'ocr' }))];
    this.changed();
  }

  /** HUD events read on this PC, as hints for the scout pass. */
  ocrHints(id) {
    return (this.match(id)?.events ?? []).filter((e) => e.source === 'ocr').sort((a, b) => a.timestamp - b.timestamp)
      .map((e) => `${formatHint(e.timestamp)} ${e.kind}${e.payload ? ` ${e.payload}` : ''}`);
  }

  // ---------- Reports ----------

  /** Stores a finished report (port of AnalysisStore.save). */
  saveReport(matchId, outcome, { mode, startedAt, profile, habitID = null, promptVersion }) {
    const match = this.match(matchId);
    const report = outcome.report;
    const hints = (match.events ?? []).filter((e) => e.source === 'ocr');
    const run = {
      id: uuid(), engine: 'gemini', modelID: outcome.models.join(', '), rubricVersion: outcome.rubricVersion, promptVersion: `${promptVersion}-${mode}`,
      startedAt, finishedAt: now(), status: 'completed', errorMessage: null, requestCount: outcome.requestCount,
      inputTokens: outcome.usage.input, outputTokens: outcome.usage.output, overallScore: report.overallScore,
      summary: report.summary, drillTitle: report.drill.title, drillSteps: report.drill.steps,
      validationIssues: outcome.issues.map((i) => i.message),
      scores: report.categories.map((c) => ({ category: c.category, score: c.score, confidence: c.confidence, rationale: c.rationale })),
      findings: report.findings.map((f, index) => ({
        id: uuid(), category: f.category, timestamp: parseTimestamp(f.timestamp) ?? 0, evidence: f.evidence, confidence: f.confidence,
        kind: f.kind, impact: f.impact, fix: f.fix ?? null, topRank: report.topMistakes.indexOf(index) + 1, isDisputed: false, disputeNote: null,
      })),
      deaths: report.deaths.map((d) => {
        const time = parseTimestamp(d.timestamp) ?? 0;
        return { id: uuid(), timestamp: time, cause: d.cause, avoidable: d.avoidable, isFirstDeathOfFight: d.firstDeathOfFight,
          killerHeroKey: resolveKiller(time, d.killerHero, hints), whatToDoInstead: d.whatToDoInstead, confidence: d.confidence };
      }),
      habitChecks: habitID ? (report.habitChecks ?? []).map((c) => ({ habitID, timestamp: parseTimestamp(c.timestamp) ?? 0, done: c.done, evidence: c.evidence })) : [],
    };
    match.runs = [...(match.runs ?? []), run];
    // The scout's map of fights; gemini events replace earlier ones.
    match.fights = outcome.timeline.fights.map((f, index) => ({ index, ...f,
      ownDeaths: outcome.timeline.deaths.filter((d) => d.time >= f.start && d.time <= f.end).length }));
    match.events = [...(match.events ?? []).filter((e) => e.source !== 'gemini'),
      ...outcome.timeline.deaths.map((d) => ({ timestamp: d.time, kind: 'ownDeath', payload: null, confidence: 'medium', source: 'gemini' })),
      ...outcome.timeline.eliminations.map((t) => ({ timestamp: t, kind: 'ownElimination', payload: null, confidence: 'medium', source: 'gemini' }))];
    this.#fillMissingDetails(match, outcome.detected, profile);
    if (match.result === 'unknown' && outcome.timeline.result !== 'unknown') match.result = outcome.timeline.result;
    if (match.video) {
      match.video.remoteFileURI = outcome.remote.uri;
      match.video.remoteName = outcome.remote.name;
      match.video.remoteMimeType = outcome.remote.mimeType ?? null;
      match.video.remoteExpiresAt = new Date(Date.now() + 47 * 3600_000).toISOString();
    }
    this.changed();
    return run;
  }

  saveFailure(matchId, error, { mode, startedAt, promptVersion }) {
    const match = this.match(matchId);
    match.runs = [...(match.runs ?? []), { id: uuid(), engine: 'gemini', modelID: '', rubricVersion: '', promptVersion: `${promptVersion}-${mode}`,
      startedAt, finishedAt: now(), status: 'failed', errorMessage: error.message, requestCount: 0, inputTokens: 0, outputTokens: 0,
      scores: [], findings: [], deaths: [], habitChecks: [] }];
    this.changed();
  }

  /** The Gemini upload of this match's video if it is still alive, so analysing again doesn't upload again. */
  reusableUpload(matchId) {
    const video = this.match(matchId)?.video;
    if (!video?.remoteFileURI || !video.remoteExpiresAt || new Date(video.remoteExpiresAt) <= new Date()) return null;
    return { name: video.remoteName ?? video.remoteFileURI.slice(video.remoteFileURI.indexOf('files/')), uri: video.remoteFileURI, mimeType: video.remoteMimeType ?? null, state: 'ACTIVE' };
  }

  /** Only fills what is empty; anything you entered or corrected stays as it is. */
  #fillMissingDetails(match, detected, profile) {
    if (!match.heroKeys.length && detected.heroKeys.length) {
      match.heroKeys = detected.heroKeys;
      const role = hero(detected.heroKeys[0])?.role;
      if (role && role !== match.role) {
        match.role = role;
        if (!match.isReference) match.rank = profile.roles.find((r) => r.role === role)?.rank ?? null;
      }
    }
    if (!match.mapKey && detected.mapKey) {
      const map = gameMap(detected.mapKey);
      if (map) {
        match.mapKey = map.key;
        if (!match.mode && map.modes.length === 1) match.mode = map.modes[0];
      }
    }
    if (detected.scoreboard) {
      match.stats = { ...match.stats };
      for (const [field, value] of Object.entries(detected.scoreboard)) if (match.stats[field] == null) match.stats[field] = value;
    }
  }

  // ---------- Findings and deaths ----------

  findRun(runId) {
    for (const match of this.data.matches) {
      const run = (match.runs ?? []).find((r) => r.id === runId);
      if (run) return { match, run };
    }
    return null;
  }

  dispute(runId, findingId, note) {
    const { run } = this.findRun(runId) ?? {};
    const finding = run?.findings.find((f) => f.id === findingId);
    if (!finding) return;
    finding.isDisputed = note != null;
    finding.disputeNote = note || null;
    this.changed();
  }

  /** Sets the killer of one death (null = unknown) and of the match's other deaths by the same enemy player. */
  correctKiller(runId, deathId, heroKey) {
    const found = this.findRun(runId);
    if (!found) return 0;
    const { match, run } = found;
    const death = run.deaths.find((d) => d.id === deathId);
    if (!death) return 0;
    death.killerHeroKey = heroKey;
    const hints = (match.events ?? []).filter((e) => e.source === 'ocr');
    const player = playerName(death.timestamp, hints);
    let others = 0;
    if (player) {
      for (const other of run.deaths) {
        if (other === death) continue;
        const name = playerName(other.timestamp, hints);
        if (name && sameName(name, player) && other.killerHeroKey !== heroKey) {
          other.killerHeroKey = heroKey;
          others += 1;
        }
      }
    }
    this.changed();
    return others;
  }
}

const formatHint = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

// ---------- Who killed you (port of KillerResolver) ----------

const WINDOW = [-3, 12];

function hintName(hint) {
  if (!(hint.kind === 'deathScreen' || hint.kind === 'ownDeath') || !hint.payload) return null;
  const text = hint.payload.startsWith('killed by ') ? hint.payload.slice('killed by '.length) : hint.payload;
  const trimmed = text.replace(/^[\s\p{P}\p{S}]+|[\s\p{P}\p{S}]+$/gu, '');
  return trimmed || null;
}

const near = (time, hints) => hints.filter((h) => h.timestamp - time >= WINDOW[0] && h.timestamp - time <= WINDOW[1])
  .sort((a, b) => Math.abs(a.timestamp - time) - Math.abs(b.timestamp - time));

/** The kill cam banner beats Gemini; Gemini's answer counts only if it names a current hero. */
export function resolveKiller(time, gemini, hints) {
  const banner = near(time, hints).filter((h) => h.kind === 'deathScreen').map((h) => heroKeyFor(hintName(h) ?? '')).find(Boolean);
  if (banner) return banner;
  return gemini ? heroKeyFor(gemini) : null;
}

function playerName(time, hints) {
  return near(time, hints).map(hintName).find((name) => name && !heroKeyFor(name)) ?? null;
}

const sameName = (a, b) => a.toUpperCase().replace(/[^A-Z0-9]/g, '') === b.toUpperCase().replace(/[^A-Z0-9]/g, '');
