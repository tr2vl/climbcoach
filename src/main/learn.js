// Learn: YouTube guides for your common mistakes and your heroes, studied by Gemini against your own reports.
// (Port of YouTubeClient, StudyService, StudyContext, StudyPlan, MistakeMiner, LearnStore and LearnCenter.)
import path from 'node:path';
import { heroName, rankText, roleName } from '../shared/catalog.js';
import { deathsOf, findingsOf, latestCompletedRun, matchTitle } from '../shared/match.js';
import { categoryAverages, summaries, WINDOW } from '../shared/progress.js';
import { bannedPhrases, CATEGORIES, categoryName, formatTimestamp, parseTimestamp } from '../shared/rubric.js';
import { GeminiEngine } from './gemini/engine.js';
import { makeRequest, part } from './gemini/request.js';
import { STUDY_MODELS } from './gemini/router.js';
import { decodeAnswer } from './analysis/schemas.js';
import { readJSON, writeJSON } from './jsonfile.js';

// ---------- YouTube ----------

export class YouTubeError extends Error {}

export class YouTubeClient {
  static base = 'https://www.googleapis.com/youtube/v3';

  constructor(apiKey, fetchImpl = fetch) {
    this.apiKey = apiKey;
    this.fetch = fetchImpl;
  }

  async #get(endpoint, parameters) {
    const url = `${YouTubeClient.base}/${endpoint}?${new URLSearchParams(Object.entries(parameters).sort())}`;
    const response = await this.fetch(url, { headers: { 'X-Goog-Api-Key': this.apiKey }, signal: AbortSignal.timeout(30_000) });
    const body = await response.text();
    if (response.status !== 200) {
      if (response.status === 403 && /quotaExceeded|dailyLimitExceeded/.test(body)) throw new YouTubeError('Today\'s free YouTube search quota is used up (about 100 searches a day). Try again tomorrow.');
      if ((response.status === 400 || response.status === 403) && /API_KEY|keyInvalid|API key/.test(body)) throw new YouTubeError('YouTube rejected the API key. Check it in Settings (YouTube Data API v3 must be enabled for it).');
      throw new YouTubeError(`YouTube answered with error ${response.status}.`);
    }
    try { return JSON.parse(body); } catch { throw new YouTubeError('YouTube sent data ClimbCoach doesn\'t understand.'); }
  }

  static #video(item, id) {
    const s = item.snippet;
    return { id, title: s.title, channelTitle: s.channelTitle, publishedAt: s.publishedAt ?? null,
      thumbnail: s.thumbnails?.medium?.url ?? s.thumbnails?.high?.url ?? null };
  }

  /** Medium-length (4–20 min) English videos from the last two years, most relevant first. 100 units. */
  async search(query, maxResults = 8, now = new Date()) {
    const since = new Date(now);
    since.setFullYear(since.getFullYear() - 2);
    const data = await this.#get('search', { part: 'snippet', type: 'video', q: query, maxResults: String(maxResults), videoDuration: 'medium',
      relevanceLanguage: 'en', safeSearch: 'moderate', order: 'relevance', publishedAfter: since.toISOString() });
    return (data.items ?? []).filter((i) => i.id?.videoId).map((i) => YouTubeClient.#video(i, i.id.videoId));
  }

  async videos(ids) {
    if (!ids.length) return [];
    const data = await this.#get('videos', { part: 'snippet', id: ids.slice(0, 50).join(','), maxResults: '50' });
    return (data.items ?? []).map((i) => YouTubeClient.#video(i, i.id));
  }

  /** Length and views (1 unit per 50 videos), to pick a solid guide among results. */
  async details(ids) {
    if (!ids.length) return {};
    const data = await this.#get('videos', { part: 'contentDetails,statistics', id: ids.slice(0, 50).join(','), maxResults: '50' });
    return Object.fromEntries((data.items ?? []).map((i) => [i.id, { seconds: isoSeconds(i.contentDetails?.duration ?? ''), views: i.statistics?.viewCount ? Number(i.statistics.viewCount) : null }]));
  }
}

/** "PT12M34S" → 754; null for anything else. */
export function isoSeconds(text) {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(text);
  if (!match) return null;
  const total = Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
  return total > 0 ? total : null;
}

export const watchURL = (id, seconds) => `https://www.youtube.com/watch?v=${id}${seconds ? `&t=${Math.floor(seconds)}s` : ''}`;

// ---------- What the study coach knows about you ----------

export const SEARCH_TERMS = { aim: 'aim crosshair placement', movement: 'movement', positioning: 'positioning', engagement: 'when to engage',
  targetPriority: 'target priority', cooldowns: 'cooldown usage', ultEconomy: 'ultimate usage', gameSense: 'game sense', deathQuality: 'how to die less', heroMechanics: 'advanced tips' };

export function studyContext(matches, profile) {
  const averages = categoryAverages(summaries(matches));
  const weakest = Object.entries(averages).sort((a, b) => a[1] - b[1]).slice(0, 3);
  const runs = matches.filter((m) => !m.isReference).sort((a, b) => new Date(b.playedAt) - new Date(a.playedAt)).slice(0, WINDOW).map(latestCompletedRun).filter(Boolean);
  const weaknesses = weakest.map(([category, average]) => ({ category, average,
    examples: runs.flatMap(findingsOf).filter((f) => f.category === category && f.kind === 'mistake' && f.confidence !== 'low' && !f.isDisputed).slice(0, 3).map((f) => f.evidence) }));
  const main = profile.roles.find((r) => r.rank) ?? profile.roles[0] ?? { role: 'damage', rank: null, heroKeys: [] };
  return { role: main.role, rank: main.rank, heroNames: main.heroKeys.map(heroName), weaknesses };
}

// ---------- Common mistakes ----------

export const MINER = { minimumMatches: 2, maximumPatterns: 4 };

/** Mistakes from the newest report of your last 10 analysed matches; disputed and low-confidence ones left out. */
export function recentMistakeFindings(matches) {
  return matches.filter((m) => !m.isReference && latestCompletedRun(m)).sort((a, b) => new Date(b.playedAt) - new Date(a.playedAt)).slice(0, WINDOW)
    .flatMap((m) => {
      const place = matchTitle(m) + (m.heroKeys?.[0] ? `, ${heroName(m.heroKeys[0])}` : '');
      return findingsOf(latestCompletedRun(m)).filter((f) => f.kind === 'mistake' && f.confidence !== 'low' && !f.isDisputed)
        .map((f) => ({ matchID: m.id, place, playedAt: m.playedAt, heroKey: m.heroKeys?.[0] ?? null, timestamp: f.timestamp, category: f.category, impact: f.impact, evidence: f.evidence, fix: f.fix }));
    });
}

export function mistakesFingerprint(matches) {
  const runs = matches.filter((m) => !m.isReference).map(latestCompletedRun).filter(Boolean);
  return `${runs.map((r) => r.id).sort().join(',')}|${runs.flatMap((r) => r.findings ?? []).filter((f) => f.isDisputed).length}`;
}

function minerPrompt(findings) {
  const ids = [...new Set(findings.map((f) => f.matchID))];
  const letter = (id) => String.fromCharCode(65 + Math.min(ids.indexOf(id), 25));
  const lines = findings.map((f, i) => `[${i}] match ${letter(f.matchID)} (${f.place}) ${formatTimestamp(f.timestamp)} ${f.category}, impact ${f.impact}: ${f.evidence}`);
  return `You are the analyst of ClimbCoach, a strict Overwatch coach. Below are the mistake findings from the player's last ${ids.length} analysed matches (matches A, B, …), numbered in brackets.

Group them into the player's most common mistakes: the same underlying error that shows up in at least ${MINER.minimumMatches} different matches. Return up to ${MINER.maximumPatterns}, most frequent and costly first. For each:
- title: the mistake as the action the player keeps doing, at most 8 words, e.g. "Peeking main before your tank takes space"
- category: the rubric category it belongs to
- findings: the numbers of every finding that is this exact mistake (at least 2, from at least 2 matches)
- search: a YouTube search for a guide that teaches the fix, with the hero name and "Overwatch", e.g. "Sierra when to peek guide Overwatch"
- habit: the habit that replaces the mistake, at most 6 words, e.g. "Second through the door"
- when: the situation that triggers the mistake, as seen in the findings, e.g. "When a fight starts on a choke"
- instead: the one concrete thing to do in that situation, with a position, a timing or a target, e.g. "Let your tank be shot at first, then peek from the pillar next to him". Not "use cover".
- check: what a coach watching the recording sees when the player does it, e.g. "The enemy's first shots go at the tank, not at you"
Only group findings that really describe the same error. Never invent findings. If no mistake repeats across matches, return an empty list. Critique the play, not the person.

Findings:
${lines.join('\n')}`;
}

const minerSchema = { type: 'object', properties: { patterns: { type: 'array', items: { type: 'object', properties: {
  title: { type: 'string' }, category: { type: 'string', enum: CATEGORIES }, findings: { type: 'array', items: { type: 'integer' } }, search: { type: 'string' },
  habit: { type: 'string' }, when: { type: 'string' }, instead: { type: 'string' }, check: { type: 'string' },
}, required: ['title', 'category', 'findings', 'search', 'habit', 'when', 'instead', 'check'] } } }, required: ['patterns'] };

/** The habit card of a mined pattern, when every part is there and clean. */
export function patternCard(p) {
  const parts = [p.habit, p.when, p.instead, p.check].map((x) => String(x ?? '').trim());
  if (!parts.every((x) => x && x.length <= 220) || parts[0].length > 60 || parts.some((x) => bannedPhrases(x).length)) return null;
  return { title: parts[0], category: p.category, trigger: parts[1], action: parts[2], check: parts[3], drill: [] };
}

const mostCommon = (keys) => [...keys.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map())].sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))[0]?.[0] ?? null;

function searchQuery(text, hero, category) {
  const cleaned = String(text ?? '').trim().replace(/^["']+|["']+$/g, '');
  if (!cleaned || cleaned.length > 100) return [hero ? heroName(hero) : null, SEARCH_TERMS[category], 'guide Overwatch'].filter(Boolean).join(' ');
  return /overwatch/i.test(cleaned) ? cleaned : `${cleaned} Overwatch`;
}

const examples = (items) => [...items].sort((a, b) => (new Date(b.playedAt) - new Date(a.playedAt)) || (b.impact - a.impact)).slice(0, 3)
  .map((f) => ({ matchID: f.matchID, place: f.place, playedAt: f.playedAt, timestamp: f.timestamp, evidence: f.evidence }));

export function validatePatterns(patterns, findings) {
  const outOf = new Set(findings.map((f) => f.matchID)).size;
  const used = new Set();
  const result = [];
  for (const p of patterns) {
    const cited = [...new Set((p.findings ?? []).filter((i) => i >= 0 && i < findings.length && !used.has(i)))].sort((a, b) => a - b);
    const items = cited.map((i) => findings[i]);
    const matches = new Set(items.map((f) => f.matchID)).size;
    const title = String(p.title ?? '').trim();
    if (matches < MINER.minimumMatches || !title || title.length > 90 || bannedPhrases(title).length) continue;
    cited.forEach((i) => used.add(i));
    const hero = mostCommon(items.map((f) => f.heroKey).filter(Boolean));
    result.push({ id: crypto.randomUUID(), title, category: p.category, heroKey: hero, matches, outOf, examples: examples(items),
      query: searchQuery(p.search, hero, p.category), fix: null, habit: patternCard(p) });
  }
  return result.slice(0, MINER.maximumPatterns);
}

/** Categories with mistakes in at least 2 matches: the fallback when grouping isn't possible. */
export function localPatterns(findings) {
  const outOf = new Set(findings.map((f) => f.matchID)).size;
  return CATEGORIES.map((category) => {
    const items = findings.filter((f) => f.category === category);
    return { category, items, matches: new Set(items.map((f) => f.matchID)).size, impact: items.reduce((s, f) => s + f.impact, 0) };
  }).filter((x) => x.matches >= MINER.minimumMatches).sort((a, b) => (b.matches - a.matches) || (b.impact - a.impact)).slice(0, MINER.maximumPatterns)
    .map(({ category, items, matches }) => {
      const hero = mostCommon(items.map((f) => f.heroKey).filter(Boolean));
      return { id: `local-${category}`, title: `${categoryName(category)} mistakes`, category, heroKey: hero, matches, outOf, examples: examples(items), query: searchQuery('', hero, category), fix: null, habit: null };
    });
}

const similarity = (a, b) => {
  const stop = new Set(['the', 'a', 'an', 'your', 'you', 'to', 'of', 'in', 'on', 'before', 'after', 'with', 'and', 'for', 'while']);
  const words = (t) => new Set(t.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !stop.has(w)));
  const x = words(a); const y = words(b);
  if (!x.size && !y.size) return 1;
  return [...x].filter((w) => y.has(w)).length / new Set([...x, ...y]).size;
};

/** Keeps a known mistake's id, fix and habit when a fresh grouping finds it again. */
export function mergePatterns(fresh, old) {
  return fresh.map((p) => {
    const match = old.find((o) => o.category === p.category && similarity(o.title, p.title) >= 0.5);
    return match ? { ...p, id: match.id, fix: match.fix, habit: p.habit ?? match.habit } : p;
  });
}

// ---------- Studying a guide ----------

const MAX_MINUTES = 25;

function topicText(topic) {
  if (!topic) return '';
  if (topic.kind === 'weakness') return `This guide was picked for ${categoryName(topic.category)} on ${heroName(topic.heroKey)}. Focus on that category first.`;
  if (topic.kind === 'hero') return `This guide was picked as a ${heroName(topic.heroKey)} guide. Take the techniques for that hero that address the weaknesses above; if the guide covers none of them, take the techniques that matter most at the player's rank on that hero.`;
  return `This guide was picked to fix one of the player's most common mistakes: "${topic.title}" (${categoryName(topic.category)}). Focus on techniques that fix exactly this.`;
}

function mistakeText(mistake) {
  if (!mistake) return '';
  return `The mistake showed up in ${mistake.matches} of the player's last ${mistake.outOf} analysed matches, for example:
${mistake.examples.map((e) => `- ${e.place} at ${formatTimestamp(e.timestamp)}: ${e.evidence}`).join('\n')}
Also write a fix for this mistake, based only on what the guide shows:
- summary: one sentence on what to do instead
- steps: 2–4 concrete steps for the next match, each something the player can do or check
- check: how the player can tell in their next match whether they fixed it (something countable or visible)
If the guide doesn't address this mistake, return an empty insights list and leave summary and steps empty.`;
}

export function studyPrompt(context, topic = null, mistake = null) {
  const weaknesses = context.weaknesses.length
    ? context.weaknesses.map((w) => `- ${categoryName(w.category)} (${w.category}): average ${w.average.toFixed(1)} of 10.${w.examples.length ? ` From the player's reports: ${w.examples.map((e) => `"${e}"`).join('; ')}` : ''}`).join('\n')
    : `No analysed matches yet: pick the techniques most useful for a player at ${context.rank ? rankText(context.rank) : 'their rank'} on these heroes.`;
  return `You are the study coach of ClimbCoach, a strict Overwatch coach. The player watches a YouTube guide to fix their weaknesses. Player: ${roleName(context.role)}, rank ${context.rank ? rankText(context.rank) : 'unranked'}, heroes ${context.heroNames.join(', ')}.
Their weakest categories, from their own match reports:
${weaknesses}
${topicText(topic)}
${mistakeText(mistake)}
Watch the video and pick up to 6 techniques it shows or explains that address these weaknesses. For each:
- timestamp: where in the video it is shown or explained (m:ss)
- category: the rubric category it fixes
- whatTheyDo: what the guide does or says, concretely
- whatYouDo: what the player's reports say they do instead, quoted from the reports above; empty if the reports say nothing about it
- howToAdapt: one concrete practice step for the player's next session
Only use what is really in the video; never invent a timestamp or a technique. If the video isn't an Overwatch guide, or shows an old version of the game (Overwatch 1 or an old hero kit), return an empty list. Critique the play, not the person. No praise.`;
}

function studySchema(withFix) {
  const schema = { type: 'object', properties: { insights: { type: 'array', items: { type: 'object', properties: {
    timestamp: { type: 'string', description: 'm:ss in the video' }, category: { type: 'string', enum: CATEGORIES },
    whatTheyDo: { type: 'string' }, whatYouDo: { type: 'string' }, howToAdapt: { type: 'string' },
  }, required: ['timestamp', 'category', 'whatTheyDo', 'whatYouDo', 'howToAdapt'] } } }, required: ['insights'] };
  if (withFix) {
    schema.properties.fix = { type: 'object', properties: { summary: { type: 'string' }, steps: { type: 'array', items: { type: 'string' } }, check: { type: 'string' } }, required: ['summary', 'steps', 'check'] };
    schema.required.push('fix');
  }
  return schema;
}

export function validInsight(insight) {
  const time = parseTimestamp(insight.timestamp);
  if (time == null || time > MAX_MINUTES * 60) return false;
  return Boolean(String(insight.whatTheyDo ?? '').trim()) && !bannedPhrases([insight.whatTheyDo, insight.whatYouDo, insight.howToAdapt].join(' ')).length;
}

export async function studyVideo(engine, video, context, topic = null, mistake = null, now = new Date()) {
  const { result } = await engine.generate(makeRequest({
    system: studyPrompt(context, topic, mistake),
    parts: [part.youtube(watchURL(video.id), MAX_MINUTES * 60), part.text(`Study "${video.title}" by ${video.channelTitle}. Answer with the JSON.`)],
    schema: studySchema(Boolean(mistake)), lowMediaResolution: true,
  }));
  const answer = decodeAnswer(result.text);
  const insights = (answer.insights ?? []).filter(validInsight);
  let fix = null;
  if (mistake && answer.fix) {
    const steps = (answer.fix.steps ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 4);
    const summary = String(answer.fix.summary ?? '').trim();
    // A fix needs the guide to back it up: no fix without at least one technique from the video.
    if (insights.length && summary && steps.length && !bannedPhrases([summary, answer.fix.check, ...steps].join(' ')).length) {
      fix = { summary, steps, check: String(answer.fix.check ?? '').trim(), videoID: video.id, videoTitle: video.title, createdAt: now.toISOString() };
    }
  }
  return { insights, fix };
}

// ---------- Which topics get studied ----------

export function topicId(topic) {
  if (topic.kind === 'weakness') return `weak:${topic.category}:${topic.heroKey}`;
  if (topic.kind === 'hero') return `hero:${topic.heroKey}`;
  return `mistake:${topic.patternID}`;
}

export function topicQuery(topic) {
  if (topic.kind === 'weakness') return `${heroName(topic.heroKey)} ${SEARCH_TERMS[topic.category]} guide Overwatch`;
  if (topic.kind === 'hero') return `${heroName(topic.heroKey)} guide Overwatch`;
  return topic.query;
}

export function topicTitle(topic) {
  if (topic.kind === 'weakness') return `${categoryName(topic.category)} on ${heroName(topic.heroKey)}`;
  if (topic.kind === 'hero') return `${heroName(topic.heroKey)} guide`;
  return `Fix: ${topic.title}`;
}

const restDays = (topic) => (topic.kind === 'hero' ? 14 : 7);

/** Your most common mistakes first (or your weakest categories), then every hero you play. */
export function studyTopics(mistakes, weaknesses, heroes) {
  const unique = [...new Set(heroes)];
  const main = unique[0];
  if (!main) return [];
  const first = mistakes.length
    ? mistakes.map((p) => ({ kind: 'mistake', patternID: p.id, title: p.title, category: p.category, query: p.query, heroKey: p.heroKey ?? main }))
    : weaknesses.map((category) => ({ kind: 'weakness', category, heroKey: main }));
  return [...first, ...unique.map((heroKey) => ({ kind: 'hero', heroKey }))];
}

/** Heroes from your recent matches by how often you played them, then the rest of your hero pool. */
export function studyHeroes(matches, profile) {
  const recent = matches.filter((m) => !m.isReference).sort((a, b) => new Date(b.playedAt) - new Date(a.playedAt)).slice(0, WINDOW);
  const counts = new Map();
  for (const key of recent.flatMap((m) => m.heroKeys ?? [])) counts.set(key, (counts.get(key) ?? 0) + 1);
  const played = [...counts].sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0])).map(([k]) => k);
  return [...played, ...profile.roles.flatMap((r) => r.heroKeys).filter((k) => !played.includes(k))];
}

export function dueTopics(topics, lastStudied, now = new Date()) {
  return topics.map((topic, index) => ({ topic, index, last: lastStudied[topicId(topic)] ? new Date(lastStudied[topicId(topic)]) : null }))
    .filter(({ topic, last }) => !last || now - last >= restDays(topic) * 86_400_000)
    .sort((a, b) => ((a.last?.getTime() ?? 0) - (b.last?.getTime() ?? 0)) || (a.index - b.index)).map((x) => x.topic);
}

/** Among the top 5 results you haven't studied, the most-watched one of a useful length (3–30 min). */
export function pickVideo(results, details, studied) {
  const candidates = results.filter((v) => !studied.has(v.id)).slice(0, 5).filter((v) => {
    const seconds = details[v.id]?.seconds;
    return seconds == null || (seconds >= 180 && seconds <= 1800);
  });
  return candidates.map((v, i) => ({ v, i, views: details[v.id]?.views ?? 0 })).sort((a, b) => (b.views - a.views) || (a.i - b.i))[0]?.v ?? null;
}

// ---------- The Learn center ----------

const API_DATA_LIFETIME = 30 * 86_400_000;

export class Learn {
  constructor({ db, folder, keys, state, settings, notify = () => {}, makeEngine = (o) => new GeminiEngine(o), makeYouTube = (k) => new YouTubeClient(k) }) {
    Object.assign(this, { db, keys, state, settings, notify, makeEngine, makeYouTube });
    this.file = folder ? path.join(folder, 'learn-state.json') : null;
    this.data = { mistakes: null, lastRun: null, topicDates: {}, ...(this.file ? readJSON(this.file, {}) : {}) };
    this.status = { kind: 'idle' };
    this.results = [];
    this.studying = new Set();
    this.findingMistakes = false;
  }

  #save() {
    if (this.file) writeJSON(this.file, this.data);
    this.#changed();
  }

  #changed() {
    this.notify(this.view());
  }

  view() {
    return { mistakes: this.data.mistakes, status: this.status, results: this.results, studying: [...this.studying], lastRun: this.data.lastRun,
      topicDates: this.data.topicDates, findingMistakes: this.findingMistakes };
  }

  get patterns() {
    return this.data.mistakes?.patterns ?? [];
  }

  #prefs() {
    const prefs = this.settings.get().prefs ?? {};
    return { enabled: prefs.learnAutoStudy ?? true, perDay: prefs.learnGuidesPerDay > 0 ? prefs.learnGuidesPerDay : 3 };
  }

  #engine() {
    const key = this.keys.read('gemini');
    return key ? this.makeEngine({ apiKey: key, models: STUDY_MODELS, state: this.state }) : null;
  }

  /** Groups your last 10 reports' mistakes when the reports changed (one small Gemini text request). */
  async refreshMistakes(now = new Date()) {
    if (this.findingMistakes) return;
    const matches = this.db.data.matches;
    const fingerprint = mistakesFingerprint(matches);
    const current = this.data.mistakes;
    const engine = this.#engine();
    if (current && current.fingerprint === fingerprint && (current.source === 'gemini' || !engine || now - new Date(current.minedAt) < 12 * 3600_000)) return;
    this.findingMistakes = true;
    this.#changed();
    try {
      const findings = recentMistakeFindings(matches);
      let patterns = null;
      let source = 'local';
      if (engine && !this.state.accountRefusedRecently() && new Set(findings.map((f) => f.matchID)).size >= MINER.minimumMatches) {
        try {
          const { result } = await engine.generate(makeRequest({ system: minerPrompt(findings), parts: [part.text('Group the findings. Answer with the JSON.')], schema: minerSchema }));
          patterns = validatePatterns(decodeAnswer(result.text).patterns ?? [], findings);
          source = 'gemini';
        } catch { /* falls back to categories */ }
      }
      patterns = mergePatterns(patterns ?? localPatterns(findings), current?.patterns ?? []);
      this.data.mistakes = { fingerprint, minedAt: now.toISOString(), source, patterns };
      this.#save();
    } finally {
      this.findingMistakes = false;
      this.#changed();
    }
  }

  async search(query) {
    const key = this.keys.read('youtube');
    if (!key) throw new Error('Add your YouTube Data API key in Settings to search.');
    this.results = await this.makeYouTube(key).search(query);
    this.#changed();
    return this.results;
  }

  #remember(video, category, heroKey, insights, now = new Date()) {
    let record = this.db.data.learnVideos.find((v) => v.youtubeID === video.id);
    if (!record) {
      record = { youtubeID: video.id, insights: [] };
      this.db.data.learnVideos.push(record);
    }
    Object.assign(record, { title: video.title, channelTitle: video.channelTitle, publishedAt: video.publishedAt ?? null, fetchedAt: now.toISOString(),
      category: category ?? record.category ?? null, heroKey: heroKey ?? record.heroKey ?? null });
    if (insights) {
      record.insights = insights.map((i) => ({ timestamp: parseTimestamp(i.timestamp) ?? 0, category: i.category, whatTheyDo: i.whatTheyDo, whatYouDo: i.whatYouDo, howToAdapt: i.howToAdapt, createdAt: now.toISOString() }));
    }
    this.db.changed();
  }

  /** Studies one search result right away. */
  async study(video) {
    const engine = this.#engine();
    if (!engine) throw new Error('Add your free Gemini API key in Settings to study guides.');
    this.studying.add(video.id);
    this.#changed();
    try {
      const context = studyContext(this.db.data.matches, this.settings.get().profile);
      const { insights } = await studyVideo(engine, video, context, null, null);
      this.#remember(video, context.weaknesses[0]?.category ?? null, null, insights);
    } finally {
      this.studying.delete(video.id);
      this.#changed();
    }
  }

  async autoStudyIfDue() {
    const { enabled } = this.#prefs();
    if (!enabled || !this.keys.read('youtube') || !this.keys.read('gemini') || this.state.accountRefusedRecently()) return;
    if (this.data.lastRun && Date.now() - new Date(this.data.lastRun) < 20 * 3600_000) return;
    await this.autoStudy();
  }

  /** Finds and studies up to `budget` guides for the topics that are due. Stops at the first quota or key problem. */
  async autoStudy({ budget = null, includeResting = false, onlyTopicID = null, now = new Date() } = {}) {
    if (this.status.kind === 'searching' || this.status.kind === 'studying') return;
    const youtubeKey = this.keys.read('youtube');
    const engine = this.#engine();
    if (!youtubeKey || !engine) {
      this.status = { kind: 'stopped', message: 'Automatic studying needs your YouTube and Gemini keys in Settings.' };
      return this.#changed();
    }
    if (!onlyTopicID) this.data.lastRun = now.toISOString();
    this.status = { kind: 'searching', topic: 'your most common mistakes' };
    this.#changed();
    await this.refreshMistakes(now);
    const patterns = this.patterns;
    const profile = this.settings.get().profile;
    const matches = this.db.data.matches;
    const context = studyContext(matches, profile);
    const all = studyTopics(patterns, context.weaknesses.map((w) => w.category), studyHeroes(matches, profile)).filter((t) => !onlyTopicID || topicId(t) === onlyTopicID);
    const due = dueTopics(all, this.data.topicDates, now);
    const resting = all.filter((t) => !due.includes(t)).sort((a, b) => new Date(this.data.topicDates[topicId(a)] ?? 0) - new Date(this.data.topicDates[topicId(b)] ?? 0));
    const topics = includeResting ? [...due, ...resting] : due;
    const youtube = this.makeYouTube(youtubeKey);
    const studied = new Set(this.db.data.learnVideos.map((v) => v.youtubeID));
    const limit = budget ?? this.#prefs().perDay;
    let done = 0;
    let searches = 0;
    for (const topic of topics) {
      if (done >= limit || searches >= limit * 2) break;
      searches += 1;
      this.status = { kind: 'searching', topic: topicTitle(topic) };
      this.#changed();
      try {
        const results = await youtube.search(topicQuery(topic));
        const details = await youtube.details(results.map((v) => v.id)).catch(() => ({}));
        const video = pickVideo(results, details, studied);
        if (!video) {
          this.data.topicDates[topicId(topic)] = now.toISOString();
          continue;
        }
        this.status = { kind: 'studying', video: video.title, topic: topicTitle(topic), done, budget: limit };
        this.#changed();
        const pattern = topic.kind === 'mistake' ? patterns.find((p) => p.id === topic.patternID) : null;
        const result = await studyVideo(engine, video, context, topic, pattern, now);
        this.#remember(video, topic.category ?? null, topic.heroKey ?? null, result.insights, now);
        studied.add(video.id);
        if (pattern && result.fix) pattern.fix = result.fix;
        // A mistake without a fix yet gets another guide in the next batch instead of resting a week.
        if (!pattern || result.fix) this.data.topicDates[topicId(topic)] = now.toISOString();
        done += 1;
        this.#save();
      } catch (error) {
        this.status = { kind: 'stopped', message: `Stopped after ${done} guide${done === 1 ? '' : 's'}: ${error.message}` };
        this.#save();
        return;
      }
    }
    this.status = { kind: 'finished', studied: done, at: now.toISOString() };
    this.#save();
  }

  /** Studies a guide for one mistake right away. */
  findFix(patternID) {
    return this.autoStudy({ budget: 1, includeResting: true, onlyTopicID: `mistake:${patternID}` });
  }

  /** YouTube data older than 30 days is refreshed (1 unit per 50 videos) or removed, per YouTube's policies. */
  async refreshStale(now = new Date()) {
    const stale = this.db.data.learnVideos.filter((v) => now - new Date(v.fetchedAt) >= API_DATA_LIFETIME);
    if (!stale.length) return;
    const key = this.keys.read('youtube');
    const found = key ? await this.makeYouTube(key).videos(stale.map((v) => v.youtubeID)).catch(() => []) : [];
    for (const record of stale) {
      const fresh = found.find((v) => v.id === record.youtubeID);
      if (fresh) Object.assign(record, { title: fresh.title, channelTitle: fresh.channelTitle, publishedAt: fresh.publishedAt, fetchedAt: now.toISOString() });
      else if (!record.insights?.length) this.db.data.learnVideos = this.db.data.learnVideos.filter((v) => v !== record);
      else Object.assign(record, { title: `YouTube video ${record.youtubeID}`, channelTitle: '', publishedAt: null, fetchedAt: now.toISOString() });
    }
    this.db.changed();
  }
}

export { deathsOf };
