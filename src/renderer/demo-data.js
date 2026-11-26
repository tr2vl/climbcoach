// Sample matches for the demo, built around the heroes picked in get started. Clearly made up: no real
// player, no real results, no real videos.
import { heroesFor, MAPS } from '../shared/catalog.js';
import { CATEGORIES } from '../shared/rubric.js';
import { libraryCard } from '../shared/training.js';

const HOUR = 3_600_000;
let counter = 0;
const id = (prefix) => `${prefix}-${++counter}`;

/** A seeded pseudo-random sequence, so the demo looks the same every time. */
function random(seed) {
  let value = seed;
  return () => { value = (value * 16807) % 2147483647; return (value - 1) / 2147483646; };
}

const MISTAKES = {
  positioning: ['Peeked the main choke before your tank had taken space; two enemies shot you first.', 'Stood on the open payload with no cover within a step when the fight started.', 'Took a wide angle alone while your team grouped on the other side of the point.'],
  engagement: ['Pushed into a 4v5 right after your tank died instead of falling back to regroup.', 'Started a duel while two teammates were still walking back from spawn.'],
  gameSense: ['Missed the enemy flanker\'s footsteps behind you for about 3 seconds.', 'Didn\'t react to the enemy ultimate voice line and stayed in the open.'],
  aim: ['Crosshair rested at chest height on the doorway, so the first shots missed the head.', 'Lost tracking on a strafing target at mid range.'],
  cooldowns: ['Used your movement ability to open the fight, then had no escape when the dive came.'],
  deathQuality: ['Stayed in sight at low health instead of stepping back for heals.', 'First death of the fight again, before your team had used anything.'],
  ultEconomy: ['Held a charged ultimate through a whole fight your team lost.'],
  targetPriority: ['Spent most of the fight shooting the barrier instead of the support you could reach.'],
};
const FIXES = {
  positioning: 'When your tank walks through the choke, wait behind the pillar until the enemy shoots at him, then peek from it.',
  engagement: 'When the kill feed shows your tank down, walk back to the next teammate and wait for the regroup.',
  gameSense: 'After each kill-feed line, turn and check the flank route behind you.',
  aim: 'While you wait for the enemy, hold your crosshair at head height on the corner they come from.',
  cooldowns: 'Keep your escape for the moment a diver lands on you.',
  deathQuality: 'When your health drops below half, step behind the nearest cover toward your healers.',
  ultEconomy: 'Use a charged ultimate in the first seconds of the next fight, with your tank\'s push.',
  targetPriority: 'When a barrier is up, move to an angle around it and shoot the support behind it.',
};

export function sampleData(profile) {
  counter = 0;
  const rnd = random(7);
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const role = profile.roles[0]?.role ?? 'damage';
  const pool = profile.roles[0]?.heroKeys?.length ? profile.roles[0].heroKeys : heroesFor(role).slice(0, 3).map((h) => h.key);
  const rank = profile.roles[0]?.rank ?? null;
  const enemies = ['genji', 'tracer', 'widowmaker', 'sombra', 'reaper', 'cassidy', 'kiriko', 'winston'].filter((k) => !pool.includes(k));
  const habit = { id: 'habit-1', ...libraryCard('positioning'), reason: 'Example: 19 of your 31 deaths in the last 10 matches were positioning deaths, 11 of them the first death of a fight.',
    source: 'category', sourceID: null, startedAt: new Date(Date.now() - 4 * 24 * HOUR).toISOString(), endedAt: null, endReason: null };
  const habitRates = [[1, 5], [2, 5], [2, 4], [3, 5], [4, 5]];
  const matches = [];
  for (let i = 0; i < 10; i += 1) {
    const playedAt = new Date(Date.now() - (6 - i * 0.55) * 24 * HOUR - (i % 3) * HOUR).toISOString();
    const map = MAPS[(i * 7) % MAPS.length];
    const heroKeys = [pool[i % pool.length]];
    const result = ['loss', 'win', 'loss', 'loss', 'win', 'win', 'loss', 'win', 'loss', 'win'][i];
    const base = 2.6 + i * 0.12;
    const scores = CATEGORIES.map((category, c) => ({ category, score: Math.max(1, Math.min(10, Math.round(base + [0.8, 0.2, -0.9, 0.3, 0.5, -0.2, -0.4, 0, -0.6, 0.4][c] + (rnd() - 0.5)))),
      confidence: c === 6 ? 'medium' : 'high', rationale: 'Example rationale: matches the anchor at the timestamps the specialist listed.' }));
    const categories = ['positioning', 'positioning', 'engagement', 'gameSense', 'aim', 'deathQuality', 'cooldowns'];
    const findings = categories.slice(0, 4 + (i % 3)).map((category, f) => ({ id: id('f'), category, timestamp: 60 + f * 95 + i * 3, evidence: pick(MISTAKES[category]),
      confidence: f === 5 ? 'low' : 'high', kind: 'mistake', impact: [5, 4, 4, 3, 3, 2, 2][f], fix: FIXES[category], topRank: f < 3 ? f + 1 : 0, isDisputed: false, disputeNote: null }));
    if (i >= 6) {
      findings.push({ id: id('f'), category: 'aim', timestamp: 410, evidence: 'Example strength: tracked a strafing target for a full magazine and finished the kill.', confidence: 'high', kind: 'strength', impact: 3, fix: null, topRank: 0, isDisputed: false, disputeNote: null });
      findings.push({ id: id('f'), category: 'aim', timestamp: 530, evidence: 'Example strength: pre-aimed the doorway at head height and won the first shot.', confidence: 'high', kind: 'strength', impact: 2, fix: null, topRank: 0, isDisputed: false, disputeNote: null });
    }
    const deathCount = 5 - (i > 6 ? 2 : i > 3 ? 1 : 0);
    const deaths = Array.from({ length: deathCount }, (_, d) => ({ id: id('d'), timestamp: 75 + d * 120 + i * 2, cause: ['positioning', 'positioning', 'awareness', 'timing', 'positioning'][d],
      avoidable: d === 3 ? 'unclear' : 'yes', isFirstDeathOfFight: d % 2 === 0, killerHeroKey: d === 4 ? null : enemies[(i + d) % enemies.length], confidence: 'high',
      whatToDoInstead: FIXES[{ positioning: 'positioning', awareness: 'gameSense', timing: 'engagement' }[['positioning', 'positioning', 'awareness', 'timing', 'positioning'][d]]] }));
    const checks = i >= 5 ? Array.from({ length: habitRates[i - 5][1] }, (_, c) => ({ habitID: habit.id, timestamp: 80 + c * 110, done: c < habitRates[i - 5][0],
      evidence: c < habitRates[i - 5][0] ? 'Example: waited behind cover until the enemy shot at your tank, then peeked.' : 'Example: walked through the choke first; the enemy\'s first shots went at you.' })) : [];
    const overall = Math.round((scores.reduce((s, x) => s + x.score, 0) / scores.length) * 10) / 10;
    matches.push({
      id: id('m'), createdAt: playedAt, playedAt, replayCode: null, patchLabel: null, mapKey: map.key, mode: map.modes[0], queue: 'competitive', role, result, rank, heroKeys,
      stats: { eliminations: 8 + i, assists: 3, deaths: deathCount + 1, damage: 5200 + i * 310, healing: 0, mitigation: 0, durationSeconds: 600 + i * 20 },
      notes: '', focusAdherence: null, isReference: false, screenshots: [], video: null, fights: [],
      runs: [{ id: id('r'), engine: 'gemini', modelID: i === 9 ? 'gemini-3.5-flash-lite' : 'gemini-4-hydrogen', rubricVersion: '1.4', promptVersion: 'p5w-lean',
        startedAt: new Date(new Date(playedAt).getTime() + 0.3 * HOUR).toISOString(), finishedAt: playedAt, status: 'completed', errorMessage: null, requestCount: 5,
        inputTokens: 251_000, outputTokens: 14_000, overallScore: overall,
        summary: 'Example report: you lost the fights in their first seconds by being seen first on the choke (1:15), which put your team 4v5. When you waited for your tank (6:50) the fight went your way.',
        drillTitle: habit.title, drillSteps: habit.drill.slice(0, 3), validationIssues: [], scores, findings, deaths, habitChecks: checks }],
    });
  }
  // A match recorded a moment ago, its report being written right now.
  matches.push({ id: 'm-live', createdAt: new Date().toISOString(), playedAt: new Date(Date.now() - 0.2 * HOUR).toISOString(), replayCode: null, patchLabel: null,
    mapKey: 'kings-row', mode: 'hybrid', queue: 'competitive', role, result: 'win', rank, heroKeys: [pool[0]], stats: {}, notes: '', isReference: false,
    screenshots: [], video: null, fights: [], runs: [] });
  const stats = (shift) => Object.fromEntries([...pool, ...enemies, ...heroesFor(role).map((h) => h.key)].map((key, k) => [key,
    { winrate: 47 + ((k * 37) % 9) + (pool.includes(key) ? shift : 0), pickrate: 2 + ((k * 13) % 9) * 0.8, banrate: (k * 7) % 5 }]));
  return {
    data: {
      version: 1, matches, habits: [habit], weeklyReports: [], focusGoals: [], drills: [
        { id: 'drill-1', name: 'Example: strafing bot tracking', workshopCode: '', category: 'aim', minutes: 10, details: 'Track the strafing bots in the Practice Range, head height only.', createdAt: new Date().toISOString(), practicedCount: 2, lastPracticedAt: null },
      ],
      mapNotes: { [matches[2].mapKey]: { text: 'Example note: take the left high ground on first point; the enemy flanks through the right door.', updatedAt: new Date().toISOString() } },
      learnVideos: [{ youtubeID: 'example', title: 'Example guide: positioning for damage heroes', channelTitle: 'Example channel', publishedAt: null, fetchedAt: new Date().toISOString(),
        category: 'positioning', heroKey: pool[0], insights: [
          { timestamp: 95, category: 'positioning', whatTheyDo: 'Waits behind the corner until the tank has drawn the enemy\'s attention, then peeks with cover one step away.', whatYouDo: 'Peeked the main choke before your tank had taken space.', howToAdapt: 'Count to two after your tank is shot at, then peek.' },
          { timestamp: 260, category: 'gameSense', whatTheyDo: 'Checks the flank route after every kill in the feed.', whatYouDo: '', howToAdapt: 'Turn once after each kill-feed line.' }] }],
      heroStats: [
        { query: 'placeholder', fetchedAt: new Date(Date.now() - 8 * 24 * HOUR).toISOString(), stats: stats(0) },
        { query: 'placeholder', fetchedAt: new Date().toISOString(), stats: stats(-2.4) },
      ],
      patchNotes: [],
    },
    learn: { mistakes: { fingerprint: 'demo', minedAt: new Date().toISOString(), source: 'gemini', patterns: [
      { id: 'p1', title: 'Peeking the choke before your tank', category: 'positioning', heroKey: pool[0], matches: 7, outOf: 10, query: 'positioning guide Overwatch',
        examples: matches.slice(-3).map((m) => ({ matchID: m.id, place: m.mapKey, playedAt: m.playedAt, timestamp: 75, evidence: MISTAKES.positioning[0] })),
        fix: { summary: 'Let your tank be shot at first, then peek from cover you can step back behind.', steps: ['Pick your peek cover before the fight.', 'Count to two after your tank is first shot at.', 'Step back the moment the enemy turns to you.'],
          check: 'The enemy\'s first shots go at your tank, not at you.', videoID: 'example', videoTitle: 'Example guide: positioning for damage heroes', createdAt: new Date().toISOString() },
        habit: null },
      { id: 'p2', title: 'Fighting on after your tank dies', category: 'engagement', heroKey: pool[0], matches: 4, outOf: 10, query: 'when to engage Overwatch',
        examples: matches.slice(-2).map((m) => ({ matchID: m.id, place: m.mapKey, playedAt: m.playedAt, timestamp: 190, evidence: MISTAKES.engagement[0] })), fix: null, habit: null },
    ] }, status: { kind: 'finished', studied: 1, at: new Date().toISOString() }, results: [], studying: [], lastRun: new Date().toISOString(), topicDates: {}, findingMistakes: false },
    kitChanges: [{ heroKey: pool[0], part: 'perk', item: 'Example perk (minor perk)', kind: 'changed', before: 'old', after: 'new', detectedAt: new Date(Date.now() - 2 * 24 * HOUR).toISOString() }],
  };
}
