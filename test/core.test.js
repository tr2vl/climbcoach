// Tests of the ported coach logic, mirroring the Mac app's tests. Run: npm test
import assert from 'node:assert/strict';
import test from 'node:test';
import { bannedPhrases, formatTimestamp, overallScore, parseTimestamp, scoreBand } from '../src/shared/rubric.js';
import { heroKeyFor } from '../src/shared/catalog.js';
import { ReportValidator } from '../src/main/analysis/validator.js';
import { runPipeline } from '../src/main/analysis/pipeline.js';
import { checksHabit, drillTask, matchFacts } from '../src/main/analysis/prompts.js';
import { RUBRIC_TEXT } from '../src/shared/rubric-text.js';
import { GeminiState, nextReset, quotaDay } from '../src/main/gemini/quota.js';
import { ModelRouter } from '../src/main/gemini/router.js';
import { GeminiError, errorFromResponse } from '../src/main/gemini/errors.js';
import { encodeRequest, makeRequest, part, wholeMatchFPS } from '../src/main/gemini/request.js';
import { Database, resolveKiller } from '../src/main/db.js';
import { Training } from '../src/main/training.js';
import { compare, summaries, weeklyDigest } from '../src/shared/progress.js';
import { coachFacts, habitBrief, habitMatches, habitStreak, isLearned, isStalled, libraryCard, nudges, rankStruggles, struggleSamples } from '../src/shared/training.js';
import { looksLikeGoogleKey, testKey } from '../src/main/keys.js';

// ---------- Fake Gemini, answering by the system prompt ----------

class FakeEngine {
  constructor(verdicts = [FakeEngine.goodVerdict]) {
    this.verdicts = verdicts;
    this.requests = [];
    this.uploads = 0;
  }

  static goodVerdict = JSON.stringify({ summary: 'You lost the fights at 1:10 and 2:05 by standing in the open.', topMistakes: [0], strengths: [],
    drill: { title: 'Cover first', steps: ['Name your cover before every shot.'] }, contradictions: [] });

  async upload() { this.uploads += 1; return { name: 'files/x', uri: 'https://x/files/x', mimeType: 'video/mp4', state: 'ACTIVE' }; }

  async generate(request) {
    this.requests.push(request);
    const system = request.system ?? '';
    let text;
    if (system.startsWith('You are the scout pass')) {
      text = JSON.stringify({ fights: [{ start: '1:00', end: '1:20', outcome: 'lost', killsFor: 1, killsAgainst: 3 }, { start: '2:00', end: '2:15', outcome: 'won', killsFor: 3, killsAgainst: 1 }],
        deaths: [{ timestamp: '1:12', killerHero: 'Genji' }, { timestamp: '9:99', killerHero: '' }], eliminations: ['2:05'], result: 'loss', heroes: ['Soldier: 76', 'Unknown Hero'], map: 'Hollywood' });
    } else if (system.startsWith('You are the head coach')) {
      text = this.verdicts.length > 1 ? this.verdicts.shift() : this.verdicts[0];
    } else {
      const categories = ['aim', 'movement', 'positioning', 'engagement', 'targetPriority', 'cooldowns', 'ultEconomy', 'gameSense', 'deathQuality', 'heroMechanics'].filter((c) => system.includes(`(${c})`));
      const answer = {
        categories: categories.map((category) => ({ category, assessable: true, score: 3, confidence: 'high', rationale: 'Matches the 3–4 anchor.', evidence: ['1:05', '1:10'] })),
        findings: [
          { category: categories[0], timestamp: '1:10', kind: 'mistake', evidence: 'In the open on main.', confidence: 'high', impact: 4, fix: 'Use the left wall.' },
          { category: categories[0], timestamp: '5:00', kind: 'mistake', evidence: 'Walked into the choke alone.', confidence: 'medium', impact: 2, fix: 'Wait for the tank.' },
        ],
      };
      if (categories.includes('deathQuality')) answer.deaths = [{ timestamp: '1:12', cause: 'positioning', avoidable: 'yes', firstDeathOfFight: true, killerHero: 'Genji', whatToDoInstead: 'Stay behind the tank.', confidence: 'high' }];
      if (system.includes('Habit check (rubric')) {
        answer.habitChecks = [{ timestamp: '1:10', done: false, evidence: 'Peeked main before the tank.' }, { timestamp: '1:12', done: true, evidence: 'Same moment.' }, { timestamp: '2:05', done: true, evidence: 'Waited behind the tank.' }];
      }
      text = JSON.stringify(answer);
    }
    return { result: { text, usage: { input: 1000, output: 100 } }, model: 'fake-model' };
  }
}

const context = { inGameName: 'Rookie', role: 'damage', rank: { tier: 'bronze', division: 1 }, heroKeys: ['soldier-76'], mapName: 'Hollywood', mode: 'hybrid',
  result: 'loss', duration: 600, videoDuration: 600, hasAudio: true, isLiveRecording: false };

// ---------- Rubric basics ----------

test('timestamps parse and format like the Mac app', () => {
  assert.equal(parseTimestamp('4:07'), 247);
  assert.equal(parseTimestamp('04:07.5'), 247.5);
  assert.equal(parseTimestamp('1:02:05'), 3725);
  assert.equal(parseTimestamp('9:99'), null);
  assert.equal(parseTimestamp('1:60:00'), null);
  assert.equal(formatTimestamp(3725), '1:02:05');
  assert.equal(formatTimestamp(72), '1:12');
});

test('banned phrases match on word boundaries only', () => {
  assert.deepEqual(bannedPhrases('Great job holding the angle'), ['great job']);
  assert.deepEqual(bannedPhrases('You’re doing great'), ['you\'re doing great']);
  assert.deepEqual(bannedPhrases('trashcan cover'), []);
});

test('overall score needs 5 assessed categories and uses role weights', () => {
  assert.equal(overallScore({ aim: 3, movement: 3, positioning: 3, engagement: 3 }, 'damage'), null);
  assert.equal(overallScore({ aim: 3, movement: 3, positioning: 3, engagement: 3, deathQuality: 3 }, 'damage'), 3);
  assert.equal(scoreBand(3.4), 'Bronze–Silver');
});

test('the rubric copy drops the owner-specific column', () => {
  assert.ok(RUBRIC_TEXT.includes('## Honesty rules'));
  assert.ok(!RUBRIC_TEXT.includes('Meaning for you'));
  assert.ok(!RUBRIC_TEXT.includes('Bronze 1)'));
});

test('hero names from the kill feed or the AI map to keys', () => {
  assert.equal(heroKeyFor('Soldier: 76'), 'soldier-76');
  assert.equal(heroKeyFor('LUCIO'), 'lucio');
  assert.equal(heroKeyFor('Torbjorn'), 'torbjorn');
  assert.equal(heroKeyFor('SomePlayer'), null);
});

// ---------- Validator ----------

test('strengths need two moments in their category, whatever the score', () => {
  const validator = new ReportValidator({ videoDuration: 600, role: 'damage' });
  const strength = (timestamp, category = 'aim', confidence = 'high') => ({ category, timestamp, kind: 'strength', evidence: 'Clean tracking.', confidence, impact: 2, fix: null });
  const merged = { categories: [], findings: [strength('1:00'), strength('2:00'), strength('3:00', 'movement'), strength('4:00', 'positioning', 'low')], deaths: [], habitChecks: [] };
  const { report } = validator.validate(merged, { summary: 'S.', topMistakes: [], strengths: [], drill: { title: 'D', steps: ['x'] }, contradictions: [] });
  assert.deepEqual(report.findings.map((f) => f.category), ['aim', 'aim']);
  assert.equal(report.strengths.length, 2);
});

test('habit checks need a time and evidence, and one moment counts once', () => {
  const validator = new ReportValidator({ videoDuration: 600, role: 'damage' });
  const issues = [];
  const kept = validator.habitChecks([
    { timestamp: '3:00', done: true, evidence: 'Waited.' }, { timestamp: '1:00', done: false, evidence: 'Peeked first.' },
    { timestamp: '1:03', done: true, evidence: 'Same moment.' }, { timestamp: '12:00', done: true, evidence: 'After the video.' },
    { timestamp: '2:00', done: true, evidence: '  ' }, { timestamp: '2:30', done: true, evidence: 'Great job waiting.' },
  ], issues);
  assert.deepEqual(kept.map((c) => c.timestamp), ['1:00', '3:00']);
  assert.equal(issues.length, 3);
});

test('a score of 7 needs 3 timestamps', () => {
  const validator = new ReportValidator({ videoDuration: 600, role: 'damage' });
  const merged = { categories: [{ category: 'aim', score: 8, confidence: 'high', rationale: 'Sharp.', evidence: ['1:00', '2:00'] }], findings: [], deaths: [] };
  const { report } = validator.validate(merged, { summary: 'S.', topMistakes: [], strengths: [], drill: { title: 'D', steps: ['x'] }, contradictions: [] });
  assert.equal(report.categories.find((c) => c.category === 'aim').score, 6);
});

// ---------- Pipeline ----------

test('a lean report takes 5 requests and drops bad times', async () => {
  const engine = new FakeEngine();
  const outcome = await runPipeline({ engine, context, video: '/tmp/m.mp4', progress: () => {} });
  assert.equal(engine.uploads, 1);
  assert.equal(outcome.requestCount, 5);
  assert.deepEqual(outcome.timeline.deaths.map((d) => d.time), [72]);
  assert.equal(outcome.report.overallScore, 3);
  assert.equal(outcome.report.deaths.length, 1);
  assert.deepEqual(outcome.detected.heroKeys, ['soldier-76']);
  assert.equal(outcome.detected.mapKey, 'hollywood');
  // Clip specialists can't report moments outside their clips; the full-match group can.
  const late = outcome.report.findings.filter((f) => f.timestamp === '5:00').map((f) => f.category);
  assert.deepEqual(new Set(late), new Set(['positioning']));
});

test('every analyzer prompt embeds the rubric', async () => {
  const engine = new FakeEngine();
  await runPipeline({ engine, mode: 'full', context, video: '/tmp/m.mp4' });
  assert.equal(engine.requests.length, 8);
  for (const request of engine.requests.filter((r) => !r.system.startsWith('You are the scout pass'))) assert.ok(request.system.includes(RUBRIC_TEXT));
});

test('only the group that owns the habit checks it, with no extra request', async () => {
  const card = libraryCard('positioning');
  const withHabit = { ...context, habit: { id: 'h1', card, recent: [{ done: 1, total: 6 }, { done: 2, total: 5 }] } };
  const engine = new FakeEngine();
  const outcome = await runPipeline({ engine, context: withHabit, video: '/tmp/m.mp4' });
  assert.equal(outcome.requestCount, 5);
  assert.deepEqual(outcome.report.habitChecks.map((c) => c.timestamp), ['1:10', '2:05']);
  const habitPrompts = engine.requests.filter((r) => r.system.includes('Habit check (rubric'));
  assert.equal(habitPrompts.length, 1);
  assert.ok(habitPrompts[0].system.startsWith('You are the Positioning, Decision-making specialists'));
  const head = engine.requests.find((r) => r.system.startsWith('You are the head coach')).system;
  assert.ok(head.includes('This match: done in 1 of 2 checked moments (1:10 missed, 2:05 done).'));
  assert.ok(head.includes('Earlier matches, oldest first: 1 of 6, 2 of 5.'));
  assert.ok(head.includes('title "Second through the door"'));
  assert.equal(checksHabit(['positioning'], { ...withHabit, isReference: true }), false);
  assert.ok(!drillTask({ ...withHabit, isReference: true }).includes('Second through the door'));
});

test('a recording that wasn\'t cut sends only the match range', async () => {
  const engine = new FakeEngine();
  const ranged = { ...context, videoDuration: 900, range: { start: 120, end: 720 }, duration: 600 };
  await runPipeline({ engine, context: ranged, video: '/tmp/m.mp4' });
  const scout = engine.requests[0];
  const video = scout.parts.find((p) => p.kind === 'video');
  assert.equal(video.start, 120);
  assert.equal(video.end, 720);
  assert.ok(matchFacts(ranged).includes('The match itself runs from 2:00 to 12:00 of the video'));
  assert.deepEqual(encodeRequest(scout).contents[0].parts[0].videoMetadata, { fps: video.fps, startOffset: '120.0s', endOffset: '720.0s' });
});

test('a report that breaks the honesty rules twice is discarded', async () => {
  const bad = JSON.stringify({ summary: 'Great job!', topMistakes: [], strengths: [], drill: { title: 'D', steps: ['x'] }, contradictions: [] });
  await assert.rejects(runPipeline({ engine: new FakeEngine([bad, bad]), context, video: '/tmp/m.mp4' }), /broke the honesty rules twice/);
});

// ---------- Gemini quota and routing ----------

test('the quota day follows Pacific time', () => {
  assert.equal(quotaDay(new Date('2026-11-26T07:30:00Z')), '2026-11-25');
  assert.equal(nextReset(new Date('2026-11-26T07:30:00Z')).toISOString(), '2026-11-26T08:00:00.000Z');
  assert.equal(wholeMatchFPS(600), 1);
  assert.equal(wholeMatchFPS(2400), 0.4);
  assert.equal(wholeMatchFPS(3600), 0.2);
});

test('a daily limit makes the router skip the model and remember it', async () => {
  const state = new GeminiState(null);
  const daily = () => errorFromResponse(429, JSON.stringify({ error: { message: 'quota', details: [{ violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', quotaValue: '20' }] }] } }));
  const router = new ModelRouter({ models: ['a', 'b'], state, sleep: async () => {} });
  const { value, model } = await router.run(async (m) => { if (m === 'a') throw daily(); return 'ok'; });
  assert.equal(value, 'ok');
  assert.equal(model, 'b');
  assert.ok(state.exhaustedUntil('a'));
  const error = daily();
  assert.ok(error.isDailyLimit);
  assert.match(error.message, /daily limit \(20 requests a day\)/);
});

test('a plan and billing refusal stops instead of trying every model', async () => {
  const state = new GeminiState(null);
  const router = new ModelRouter({ models: ['a', 'b'], state, sleep: async () => {} });
  let calls = 0;
  await assert.rejects(router.run(async () => { calls += 1; throw errorFromResponse(429, JSON.stringify({ error: { message: 'Please check your plan and billing details.' } })); }), (e) => e.kind === 'accountRefused');
  assert.equal(calls, 1);
  assert.ok(state.accountRefusedRecently());
});

test('an invalid key is reported as such', () => {
  assert.equal(errorFromResponse(400, JSON.stringify({ error: { message: 'API key not valid', details: [{ reason: 'API_KEY_INVALID' }] } })).kind, 'invalidKey');
  assert.ok(new GeminiError('overloaded').message.includes('overloaded'));
});

test('requests encode the way the Gemini API expects', () => {
  const body = encodeRequest(makeRequest({ system: 'S', parts: [part.youtube('https://youtu.be/x', 60), part.text('T')], schema: { type: 'object' }, lowMediaResolution: true }));
  assert.deepEqual(body.systemInstruction, { parts: [{ text: 'S' }] });
  assert.deepEqual(body.contents[0].parts[0], { fileData: { fileUri: 'https://youtu.be/x' }, videoMetadata: { endOffset: '60.0s' } });
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.equal(body.generationConfig.mediaResolution, 'MEDIA_RESOLUTION_LOW');
});

// ---------- Keys ----------

test('keys are checked for their shape before Google is asked', async () => {
  assert.ok(looksLikeGoogleKey(`AIza${'x'.repeat(35)}`));
  assert.ok(!looksLikeGoogleKey('hello'));
  let asked = 0;
  const fake = async (url, options) => { asked += 1; assert.equal(options.headers['x-goog-api-key'], `AIza${'x'.repeat(35)}`); assert.ok(!url.includes('AIza')); return { ok: true }; };
  assert.equal((await testKey('gemini', 'nope', fake)).ok, false);
  assert.equal(asked, 0);
  assert.equal((await testKey('gemini', `AIza${'x'.repeat(35)}`, fake)).ok, true);
});

// ---------- Database, training and the coach ----------

const day = Date.parse('2026-11-20T18:00:00Z');
const at = (hour) => new Date(day + hour * 3600_000).toISOString();

function addAnalysed(db, hour, { deaths = [], findings = [], checks = [], model = 'gemini-4-hydrogen', overall = 3, scores = {} } = {}) {
  const match = db.addMatch({ playedAt: at(hour), mapKey: 'route-66', heroKeys: ['sierra'], result: 'loss', stats: { deaths: deaths.length, durationSeconds: 600 } });
  match.runs.push({ id: `run-${hour}`, status: 'completed', modelID: model, startedAt: at(hour + 0.2), overallScore: overall,
    scores: Object.entries(scores).map(([category, score]) => ({ category, score, confidence: 'high', rationale: '' })),
    findings: findings.map((f, i) => ({ id: `f-${hour}-${i}`, timestamp: 60, evidence: 'x', confidence: 'high', kind: 'mistake', impact: 3, topRank: 0, isDisputed: false, ...f })),
    deaths: deaths.map((d, i) => ({ id: `d-${hour}-${i}`, timestamp: 60 + i * 30, avoidable: 'yes', isFirstDeathOfFight: false, killerHeroKey: null, whatToDoInstead: '', confidence: 'high', ...d })),
    habitChecks: checks });
  return match;
}

test('deaths outweigh average scores when picking the struggle', () => {
  const samples = [
    { deaths: [{ cause: 'positioning', first: true }, { cause: 'positioning', first: false }, { cause: 'awareness', first: false }], mistakes: [{ category: 'aim', impact: 3, isTop: false }] },
    { deaths: [{ cause: 'positioning', first: true }], mistakes: [{ category: 'positioning', impact: 4, isTop: true }] },
  ];
  const ranked = rankStruggles(samples);
  assert.equal(ranked[0].card.title, 'Second through the door');
  assert.equal(ranked[0].cost, 19);
  assert.equal(ranked[0].reason, '3 of your 4 deaths in the last 2 matches were positioning deaths, 2 of them the first death of a fight. The reports found 1 positioning mistake, 1 among the costliest of their match.');
  assert.deepEqual(rankStruggles(samples.slice(0, 1)), []);
});

test('the coach picks a habit, then moves on once it is learned', () => {
  const db = new Database(null);
  for (const hour of [0, 1, 2]) addAnalysed(db, hour, { deaths: [{ cause: 'positioning', isFirstDeathOfFight: true }, { cause: 'awareness' }] });
  const training = new Training(db);
  assert.deepEqual(training.refresh(), { kind: 'started', title: 'Second through the door' });
  const habit = db.data.habits[0];
  assert.match(habit.reason, /^3 of your 6 deaths in the last 3 matches were positioning deaths/);
  assert.deepEqual(training.refresh(), { kind: 'unchanged' });
  const check = (done, total) => Array.from({ length: total }, (_, i) => ({ habitID: habit.id, timestamp: 60 + i * 30, done: i < done, evidence: 'x' }));
  addAnalysed(db, 10, { checks: check(3, 4) });
  addAnalysed(db, 11, { checks: check(4, 5) });
  addAnalysed(db, 12, { checks: check(7, 10) });
  assert.deepEqual(habitBrief(db.data.habits, db.data.matches, at(20)).recent, [{ done: 3, total: 4 }, { done: 4, total: 5 }, { done: 7, total: 10 }]);
  assert.equal(habitStreak(habitMatches(habit.id, db.data.matches)), 3);
  assert.deepEqual(training.refresh(), { kind: 'learned', title: 'Second through the door', next: 'Check the flank after every pick' });
});

test('a habit with no progress after 5 matches is stalled', () => {
  const m = (h, done) => ({ matchID: String(h), playedAt: at(h), title: '', result: { done, total: 5 } });
  assert.ok(isStalled([m(1, 2), m(2, 3), m(3, 2), m(4, 1), m(5, 2)]));
  assert.ok(!isStalled([m(1, 2), m(2, 3), m(3, 2), m(4, 1)]));
  assert.ok(isLearned([m(1, 4), m(2, 4), m(3, 5)]));
});

test('nudges come with their numbers', () => {
  const facts = { matches: 9, deaths: 53, killers: [...Array(9).fill('sierra'), ...Array(5).fill('kiriko'), ...Array(33).fill('moira')],
    latestReport: { matchID: 'm', model: 'gemini-3.5-flash-lite', videoExists: true }, habitTitle: null, habitMatches: [], recentlyLearned: null };
  const notes = nudges(facts);
  const killer = notes.find((n) => n.id.startsWith('killer-'));
  assert.equal(killer.detail, 'Moira killed you 33 times in your last 9 analysed matches: 70 % of the 47 deaths with a known killer.');
  assert.deepEqual(killer.action, { kind: 'study', query: 'how to play against Moira Overwatch' });
  assert.ok(notes.some((n) => n.action?.kind === 'reanalyse'));
  assert.deepEqual(nudges({ ...facts, killers: ['sierra', 'sierra', 'sierra', 'sierra', 'kiriko'], latestReport: { ...facts.latestReport, model: 'gemini-4-hydrogen' } }), []);
});

test('comparison with your last matches', () => {
  const db = new Database(null);
  for (const hour of [1, 2, 3]) addAnalysed(db, hour, { deaths: Array(6).fill({ cause: 'positioning' }), overall: 3, scores: { positioning: 2 } });
  addAnalysed(db, 10, { deaths: Array(3).fill({ cause: 'positioning' }), overall: 3.2, scores: { positioning: 3 } });
  const all = summaries(db.data.matches);
  const current = all.find((s) => s.playedAt === at(10));
  const comparison = compare(current, all.filter((s) => s !== current));
  assert.equal(comparison.basis, 'your last 3 Damage matches');
  const rate = comparison.lines.find((l) => l.label === 'Deaths per 10 min');
  assert.equal(rate.currentText, '3.0');
  assert.equal(rate.usualText, '6.0');
  assert.equal(rate.trend, 'better');
  assert.equal(rate.changeText, '−3.0');
  assert.equal(comparison.lines.find((l) => l.label === 'Overall score').trend, 'same');
  assert.deepEqual(comparison.movedCategories.map((c) => c.label), ['Positioning']);
});

test('reports are saved with killers from the banner and habit checks', () => {
  const db = new Database(null);
  const match = db.addMatch({ playedAt: at(1), video: { path: '/tmp/x.mp4', durationSeconds: 600 } });
  db.replaceHUDEvents(match.id, [{ time: 75, kind: 'deathScreen', payload: 'killed by REAPER' }]);
  const report = { categories: [{ category: 'aim', score: 3, confidence: 'high', rationale: 'r', evidence: [] }], findings: [{ category: 'aim', timestamp: '1:10', kind: 'mistake', evidence: 'e', confidence: 'high', impact: 4, fix: 'f' }],
    deaths: [{ timestamp: '1:12', cause: 'positioning', avoidable: 'yes', firstDeathOfFight: true, killerHero: 'Genji', whatToDoInstead: 'w', confidence: 'high' }],
    summary: 'S.', topMistakes: [0], strengths: [], drill: { title: 'D', steps: ['s'] }, overallScore: null, habitChecks: [{ timestamp: '1:10', done: false, evidence: 'x' }] };
  const run = db.saveReport(match.id, { report, detected: { heroKeys: ['reaper'], mapKey: 'route-66', scoreboard: { deaths: 7 } }, issues: [], usage: { input: 1, output: 1 },
    requestCount: 5, models: ['gemini-4-hydrogen'], timeline: { fights: [], deaths: [], eliminations: [], result: 'loss' }, remote: { name: 'files/x', uri: 'https://x/files/x' }, rubricVersion: '1.3' },
  { mode: 'lean', startedAt: at(1), profile: { roles: [{ role: 'damage', rank: { tier: 'gold', division: 2 }, heroKeys: [] }] }, habitID: 'h1', promptVersion: 'p5w' });
  assert.equal(run.deaths[0].killerHeroKey, 'reaper'); // the banner beats Gemini's "Genji"
  assert.equal(run.findings[0].topRank, 1);
  assert.equal(run.habitChecks[0].habitID, 'h1');
  assert.deepEqual(match.heroKeys, ['reaper']);
  assert.equal(match.mapKey, 'route-66');
  assert.equal(match.result, 'loss');
  assert.equal(match.stats.deaths, 7);
  assert.ok(db.reusableUpload(match.id));
  assert.equal(resolveKiller(72, 'Soldier: 76', []), 'soldier-76');
  assert.equal(resolveKiller(72, 'Nobody', []), null);
});

test('the weekly report and coach facts', () => {
  const db = new Database(null);
  addAnalysed(db, 1, { deaths: [{ cause: 'positioning' }], findings: [{ category: 'positioning', topRank: 1 }], scores: { aim: 6, positioning: 2 } });
  addAnalysed(db, 2, { deaths: [{ cause: 'positioning' }], findings: [{ category: 'positioning', topRank: 1 }], scores: { aim: 6, positioning: 3 } });
  const digest = weeklyDigest(summaries(db.data.matches), new Date(at(3)));
  assert.equal(digest.matches, 2);
  assert.match(digest.doingRight, /^Aim averaged 6.0 over 2 matches/);
  assert.match(digest.fixNext, /^Positioning:/);
  const facts = coachFacts(db.data.matches, []);
  assert.equal(facts.matches, 2);
  assert.equal(struggleSamples(db.data.matches).length, 2);
});

test('the Markdown export lists every section', async () => {
  const { markdown, reportDocument } = await import('../src/shared/export.js');
  const { sampleData } = await import('../src/renderer/demo-data.js');
  const { data } = sampleData({ roles: [{ role: 'damage', rank: { tier: 'gold', division: 2 }, heroKeys: ['ashe'] }] });
  const match = data.matches[8];
  const text = markdown(reportDocument(match, match.runs[0], data.matches, data.habits));
  assert.ok(text.startsWith('# '));
  for (const heading of ['## Overall', '## Compared with your last 5 Damage matches', '## Habit check: Second through the door', '## 3 costliest mistakes', '## Category scores', '## Death review']) {
    assert.ok(text.includes(heading), heading);
  }
});
