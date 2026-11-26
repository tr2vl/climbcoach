// The coach's training: one habit at a time, picked by what costs you most, checked in every report,
// learned after 3 good matches in a row. Plus his briefing, debrief and nudges, all worked out on your
// PC. (Port of StruggleFinder, HabitLibrary, HabitProgress, CoachNotes, HabitReel, HabitCheckSummary.)
import { heroName } from './catalog.js';
import { HABIT_LIBRARY } from './habit-library.js';
import { deathsOf, findingsOf, habitChecksOf, latestCompletedRun, matchTitle } from './match.js';
import { CATEGORIES, categoryName } from './rubric.js';

export const BEST_MODEL = 'gemini-4-hydrogen';

export const libraryCard = (category) => ({ ...HABIT_LIBRARY[category], category, drill: [...HABIT_LIBRARY[category].drill] });

/** "When …: …" as one sentence. */
export function cue(card) {
  const action = card.action.charAt(0).toLowerCase() + card.action.slice(1);
  return `${card.trigger.replace(/[. ]+$/, '')}: ${action}${card.action.endsWith('.') ? '' : '.'}`;
}

// ---------- Struggles ----------

export const STRUGGLE_WINDOW = 10;

/** The rubric category a death cause trains. Unavoidable and unknown deaths train nothing. */
export const deathCategory = (cause) => ({ positioning: 'positioning', timing: 'engagement', cooldown: 'cooldowns', awareness: 'gameSense', mechanics: 'aim' }[cause] ?? null);
const deathLabel = (category) => ({ positioning: 'positioning', engagement: 'timing', cooldowns: 'cooldown', gameSense: 'awareness', aim: 'lost-duel' }[category] ?? categoryName(category).toLowerCase());

/** Your last 10 analysed matches as samples; disputed and low-confidence findings left out. */
export function struggleSamples(matches) {
  return matches.filter((m) => !m.isReference && latestCompletedRun(m))
    .sort((a, b) => new Date(b.playedAt) - new Date(a.playedAt)).slice(0, STRUGGLE_WINDOW)
    .map((m) => {
      const run = latestCompletedRun(m);
      return {
        deaths: deathsOf(run).map((d) => ({ cause: d.cause, first: d.isFirstDeathOfFight })),
        mistakes: findingsOf(run).filter((f) => f.kind === 'mistake' && f.confidence !== 'low' && !f.isDisputed)
          .map((f) => ({ category: f.category, impact: f.impact, isTop: f.topRank > 0 })),
      };
    });
}

/**
 * Costliest first. Deaths weigh 3, first deaths 2 more, each finding its impact, each costliest mistake 2.
 * Average category scores are not used: a weak model's flat 3s say little, while a death is a death.
 */
export function rankStruggles(samples, patterns = [], learned = new Set()) {
  if (samples.length < 2) return [];
  const deaths = samples.flatMap((s) => s.deaths);
  const mistakes = samples.flatMap((s) => s.mistakes);
  const ranked = [];
  for (const category of CATEGORIES) {
    const own = deaths.filter((d) => deathCategory(d.cause) === category);
    const firsts = own.filter((d) => d.first).length;
    const found = mistakes.filter((m) => m.category === category);
    const impact = found.reduce((sum, m) => sum + m.impact, 0);
    const tops = found.filter((m) => m.isTop).length;
    const cost = 3 * own.length + 2 * firsts + impact + 2 * tops;
    if (cost <= 0) continue;
    const sentences = [];
    if (own.length) sentences.push(`${own.length} of your ${deaths.length} deaths in the last ${samples.length} matches were ${deathLabel(category)} deaths${firsts ? `, ${firsts} of them the first death of a fight.` : '.'}`);
    if (found.length) sentences.push(`The reports found ${found.length} ${categoryName(category).toLowerCase()} mistake${found.length === 1 ? '' : 's'}${tops ? `, ${tops} among the costliest of their match.` : '.'}`);
    const pattern = patterns.find((p) => p.category === category && p.habit && !learned.has(p.habit.title));
    if (pattern) {
      const card = { ...pattern.habit, category, drill: pattern.habit.drill?.length ? pattern.habit.drill : pattern.fix?.steps ?? libraryCard(category).drill };
      sentences.push(`"${pattern.title}" came up in ${pattern.matches} of your last ${pattern.outOf} analysed matches.`);
      ranked.push({ id: card.title, category, card, cost, reason: sentences.join(' '), source: 'pattern', sourceID: pattern.id });
    } else {
      const card = libraryCard(category);
      if (learned.has(card.title)) continue;
      ranked.push({ id: card.title, category, card, cost, reason: sentences.join(' '), source: 'category', sourceID: null });
    }
  }
  return ranked.sort((a, b) => (b.cost - a.cost) || a.category.localeCompare(b.category));
}

// ---------- Progress ----------

export const HABIT = { goal: 0.7, streakNeeded: 3, minimumMoments: 2, stallAfter: 5 };

export const resultText = (r) => `${r.done} of ${r.total}`;
const rate = (r) => (r.total > 0 ? r.done / r.total : 0);

/** The checks of one habit across your matches, oldest first (each match's newest report). */
export function habitMatches(habitID, matches) {
  return matches.filter((m) => !m.isReference).map((m) => {
    const run = latestCompletedRun(m);
    const checks = run ? habitChecksOf(run).filter((c) => c.habitID === habitID) : [];
    return checks.length ? { matchID: m.id, playedAt: m.playedAt, title: matchTitle(m), result: { done: checks.filter((c) => c.done).length, total: checks.length } } : null;
  }).filter(Boolean).sort((a, b) => new Date(a.playedAt) - new Date(b.playedAt));
}

export const countedMatches = (list) => list.filter((m) => m.result.total >= HABIT.minimumMoments).sort((a, b) => new Date(a.playedAt) - new Date(b.playedAt));

export function habitStreak(list) {
  let streak = 0;
  for (const m of countedMatches(list).reverse()) { if (rate(m.result) >= HABIT.goal - 1e-9) streak += 1; else break; }
  return streak;
}

export const isLearned = (list) => habitStreak(list) >= HABIT.streakNeeded;

export function isStalled(list) {
  const counted = countedMatches(list);
  if (counted.length < HABIT.stallAfter || isLearned(list)) return false;
  const avg = (items) => items.reduce((s, m) => s + rate(m.result), 0) / items.length;
  return avg(counted.slice(-3)) <= avg(counted.slice(0, 2)) + 1e-9;
}

export const activeHabit = (habits) => [...(habits ?? [])].filter((h) => !h.endedAt).sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))[0] ?? null;
export const habitHistory = (habits) => [...(habits ?? [])].filter((h) => h.endedAt).sort((a, b) => new Date(b.endedAt) - new Date(a.endedAt));
export const learnedTitles = (habits) => new Set(habitHistory(habits).filter((h) => h.endReason === 'learned').map((h) => h.title));
export const habitCard = (h) => ({ title: h.title, category: h.category, trigger: h.trigger, action: h.action, check: h.check, drill: h.drill ?? [] });

/** What the report prompts need: the card and your last 3 checked matches before `date`. */
export function habitBrief(habits, matches, date) {
  const habit = activeHabit(habits);
  if (!habit) return null;
  const earlier = habitMatches(habit.id, matches).filter((m) => new Date(m.playedAt) < new Date(date));
  return { id: habit.id, card: habitCard(habit), recent: earlier.slice(-3).map((m) => m.result) };
}

// ---------- Briefing, debrief, nudges ----------

export const WARM_UPS = {
  aim: '3 minutes in the Practice Range: walk around and keep your crosshair at head height on the bots.',
  movement: '3 minutes against the strafing bots, strafing yourself the whole time.',
  positioning: 'Before you queue: pick the cover you\'ll peek from and the cover you\'ll fall back to on the first point.',
  deathQuality: 'In the Practice Range, practise stepping behind a wall the moment you say "out".',
  engagement: 'Decide your rule before you queue: no duel while the team is a player down.',
  gameSense: 'Turn footstep audio up and check the flank routes of your first map.',
  cooldowns: 'Name your escape ability out loud: it\'s for the moment you\'re dived, nothing else.',
  targetPriority: 'In the Practice Range, switch between bots behind a barrier and the ones you can reach.',
  ultEconomy: 'Decide now: your next charged ult goes in the first seconds of the next fight.',
  heroMechanics: 'Pick one item of your hero\'s checklist and practise it for 3 minutes in the Practice Range.',
};

export function habitProgressText(list) {
  const goal = `${Math.round(HABIT.goal * 100)} %`;
  const last = list.at(-1);
  if (!last) return `Not checked yet: your next report checks it in every fight. It counts as learned at ${goal} in ${HABIT.streakNeeded} matches in a row.`;
  return `Last match: ${resultText(last.result)} moments${last.result.total < HABIT.minimumMoments ? ' (too few to count).' : '.'} ${habitStreak(list)} of ${HABIT.streakNeeded} matches in a row at ${goal} or better.`;
}

export const briefing = (card, list) => ({ title: card.title, cue: cue(card), check: card.check, warmUp: WARM_UPS[card.category], progress: habitProgressText(list) });

export function debrief(habitTitle, latest, previous, comparison) {
  const lines = [];
  if (habitTitle && latest) {
    let line = `${habitTitle}: done in ${resultText(latest.result)} checked moments`;
    if (previous) {
      const change = rate(latest.result) - rate(previous.result);
      line += Math.abs(change) < 0.05 ? `, about the same as the match before (${resultText(previous.result)}).`
        : change > 0 ? `, better than the match before (${resultText(previous.result)}).` : `, worse than the match before (${resultText(previous.result)}).`;
    } else line += '.';
    lines.push(line);
  }
  const moved = comparison?.lines.find((l) => l.trend !== 'same');
  if (moved) lines.push(`${moved.label}: ${moved.currentText}, your usual ${moved.usualText} (${moved.trendLabel.toLowerCase()}).`);
  return lines;
}

export const KILLER = { share: 0.15, minimum: 5 };

/** Facts from your saved matches, for the nudges. */
export function coachFacts(matches, habits, now = new Date()) {
  const analysed = matches.filter((m) => !m.isReference && latestCompletedRun(m)).sort((a, b) => new Date(b.playedAt) - new Date(a.playedAt)).slice(0, STRUGGLE_WINDOW);
  const deaths = analysed.flatMap((m) => deathsOf(latestCompletedRun(m)));
  const newest = analysed[0];
  const habit = activeHabit(habits);
  const learned = habitHistory(habits).find((h) => h.endReason === 'learned' && now - new Date(h.endedAt) < 3 * 86_400_000);
  return {
    matches: analysed.length, deaths: deaths.length, killers: deaths.map((d) => d.killerHeroKey).filter(Boolean),
    latestReport: newest ? { matchID: newest.id, model: latestCompletedRun(newest).modelID, videoExists: Boolean(newest.video && !newest.video.deletedAt && newest.video.exists !== false) } : null,
    habitTitle: habit?.title ?? null, habitMatches: habit ? habitMatches(habit.id, matches) : [],
    recentlyLearned: learned ? { title: learned.title, next: habit?.title ?? null } : null,
  };
}

/** What the coach points out, each with the numbers behind it and what he offers to do. */
export function nudges(facts) {
  const notes = [];
  if (facts.recentlyLearned) {
    const { title, next } = facts.recentlyLearned;
    notes.push({ id: `learned-${title}`, text: `You've learned "${title}".${next ? ` Next habit: "${next}".` : ''}`,
      detail: `It reached ${Math.round(HABIT.goal * 100)} % in ${HABIT.streakNeeded} checked matches in a row. Keep doing it; the reports stop checking it now.`,
      actionTitle: next ? 'See the new habit' : null, action: next ? { kind: 'openTraining' } : null });
  }
  if (facts.habitTitle && isStalled(facts.habitMatches)) {
    const counted = countedMatches(facts.habitMatches);
    notes.push({ id: `stalled-${facts.habitTitle}`, text: `"${facts.habitTitle}" isn't improving yet. Watch your habit reel before the next match.`,
      detail: `Over ${counted.length} checked matches: ${counted.map((m) => resultText(m.result)).join(', ')}. Seeing your own misses back to back usually shows the moment you decide too late.`,
      actionTitle: 'Open the habit reel', action: { kind: 'openHabitReel' } });
  }
  const known = facts.killers.length;
  if (known) {
    const counts = new Map();
    for (const key of facts.killers) counts.set(key, (counts.get(key) ?? 0) + 1);
    const [key, count] = [...counts].sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))[0];
    if (count >= KILLER.minimum && count / known >= KILLER.share - 1e-9) {
      const name = heroName(key);
      notes.push({ id: `killer-${key}`, text: `${name} kills you more than any other hero. Learn how to play against them.`,
        detail: `${name} killed you ${count} times in your last ${facts.matches} analysed matches: ${Math.round((count / known) * 100)} % of the ${known} deaths with a known killer.`,
        actionTitle: 'Find a guide', action: { kind: 'study', query: `how to play against ${name} Overwatch` } });
    }
  }
  const report = facts.latestReport;
  if (report?.videoExists && !report.model.includes(BEST_MODEL)) {
    notes.push({ id: `model-${report.matchID}`, text: 'Your newest report was written by a weaker model. Have it written again by Gemini 4 Hydrogen.',
      detail: `It came from ${report.model}. Weaker models give flatter scores and miss moments; the recording is still there, and a new report uses the same 5 free requests.`,
      actionTitle: 'Write it again', action: { kind: 'reanalyse', matchID: report.matchID } });
  }
  return notes;
}

// ---------- Habit reel and the report's habit check ----------

export function habitReel(habitID, matches) {
  return matches.filter((m) => !m.isReference).sort((a, b) => new Date(b.playedAt) - new Date(a.playedAt)).flatMap((m) => {
    const run = latestCompletedRun(m);
    return run ? habitChecksOf(run).filter((c) => c.habitID === habitID).map((c) => ({
      id: `${m.id}-${Math.round(c.timestamp * 10)}`, matchID: m.id, playedAt: m.playedAt, matchTitle: matchTitle(m), timestamp: c.timestamp, done: c.done, evidence: c.evidence,
    })) : [];
  });
}

export function habitCheckSummary(run, habits) {
  const checks = habitChecksOf(run);
  if (!checks.length) return null;
  const habitID = checks[0].habitID;
  const moments = checks.filter((c) => c.habitID === habitID);
  const done = moments.filter((c) => c.done).length;
  return { title: (habits ?? []).find((h) => h.id === habitID)?.title ?? 'Your habit', moments, done,
    resultText: `Done in ${done} of ${moments.length} moments where it came up.` };
}
