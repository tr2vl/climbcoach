// Trends, sessions, the weekly report, the comparison with your recent matches and dispute stats.
// Worked out on your PC from your saved reports, no AI. (Port of MatchSummary, TrendMath, SessionMath,
// WeeklyDigest, FocusRules, MatchComparison and DisputeStats.)
import { CATEGORIES, categoryName, confidenceRank, scoreBand } from './rubric.js';
import { roleName } from './catalog.js';
import { deathsOf, findingsOf, latestCompletedRun, topMistakes } from './match.js';

export const WINDOW = 10;
const time = (date) => new Date(date).getTime();
export const mean = (values) => values.reduce((a, b) => a + b, 0) / Math.max(values.length, 1);
const byDate = (a, b) => time(a.playedAt) - time(b.playedAt);

// ---------- Summaries ----------

/** One analysed match, reduced to what trends need; null without a report and for reference matches. */
export function summarize(match, run = latestCompletedRun(match)) {
  if (!run || match.isReference || run.status !== 'completed') return null;
  const scores = Object.fromEntries((run.scores ?? []).filter((s) => s.score != null).map((s) => [s.category, s.score]));
  const mistakes = findingsOf(run).filter((f) => f.kind === 'mistake' && f.confidence !== 'low' && !f.isDisputed);
  const deaths = deathsOf(run);
  return {
    id: match.id, playedAt: match.playedAt, heroKeys: match.heroKeys ?? [], mapKey: match.mapKey ?? null, result: match.result ?? 'unknown',
    overall: run.overallScore ?? null, scores,
    topMistakes: topMistakes(run).filter((f) => !f.isDisputed).map((f) => f.category),
    mistakeCategories: new Set(mistakes.map((f) => f.category)),
    deathCauses: deaths.map((d) => d.cause),
    role: match.role ?? null,
    durationSeconds: match.stats?.durationSeconds ?? match.video?.matchDuration ?? match.video?.durationSeconds ?? null,
    deaths: match.stats?.deaths ?? null,
    reviewedDeaths: deaths.length,
    avoidableDeaths: deaths.filter((d) => d.avoidable === 'yes').length,
    firstDeaths: deaths.filter((d) => d.isFirstDeathOfFight).length,
  };
}

export const summaries = (matches) => matches.map((m) => summarize(m)).filter(Boolean);

// ---------- Trends ----------

export function rollingAverage(values, window = WINDOW, minimum = 3) {
  return values.map((_, index) => {
    const slice = values.slice(Math.max(0, index - window + 1), index + 1);
    return slice.length >= Math.min(minimum, window) ? mean(slice) : null;
  });
}

/** Last `window` values against the `window` before them (oldest first). */
export function trend(values, window = WINDOW) {
  if (!values.length) return null;
  const recent = values.slice(-window);
  const earlier = values.slice(0, values.length - recent.length).slice(-window);
  const result = { recent: mean(recent), previous: earlier.length ? mean(earlier) : null };
  result.delta = result.previous == null ? null : result.recent - result.previous;
  result.direction = result.delta == null || Math.abs(result.delta) < 0.3 ? 'flat' : result.delta > 0 ? 'improving' : 'declining';
  return result;
}

export const overallSeries = (list) => [...list].sort(byDate).filter((s) => s.overall != null).map((s) => ({ date: s.playedAt, score: s.overall }));
export const categorySeries = (category, list) => [...list].sort(byDate).filter((s) => s.scores[category] != null).map((s) => ({ date: s.playedAt, score: s.scores[category] }));

function group(list, keys) {
  const buckets = new Map();
  for (const s of list) for (const key of new Set(keys(s))) buckets.set(key, [...(buckets.get(key) ?? []), s]);
  return [...buckets].map(([key, matches]) => {
    const overall = matches.map((m) => m.overall).filter((v) => v != null);
    const decided = matches.filter((m) => m.result === 'win' || m.result === 'loss');
    const wins = decided.filter((m) => m.result === 'win').length;
    return { key, matches: matches.length, wins, decided: decided.length, averageOverall: overall.length ? mean(overall) : null,
      winRate: decided.length ? wins / decided.length : null };
  }).sort((a, b) => (b.matches - a.matches) || b.key.localeCompare(a.key));
}

export const byHero = (list) => group(list, (s) => s.heroKeys);
export const byMap = (list) => group(list, (s) => (s.mapKey ? [s.mapKey] : []));

/** A mistake category is recurring when it shows up in ≥ 3 of the last 10 matches and ≥ 40 % of them. */
export function recurringMistakes(list, window = WINDOW) {
  const recent = [...list].sort(byDate).slice(-window);
  return CATEGORIES.map((category) => {
    const matches = recent.filter((s) => s.mistakeCategories.has(category)).length;
    const inTopThree = recent.filter((s) => s.topMistakes.includes(category)).length;
    return { category, matches, outOf: recent.length, inTopThree, share: matches / Math.max(recent.length, 1) };
  }).filter((r) => r.matches >= 3 && r.share >= 0.4).sort((a, b) => (b.inTopThree - a.inTopThree) || (b.matches - a.matches));
}

export function deathCauses(list, window = WINDOW) {
  const causes = [...list].sort(byDate).slice(-window).flatMap((s) => s.deathCauses);
  if (!causes.length) return [];
  const counts = new Map();
  for (const cause of causes) counts.set(cause, (counts.get(cause) ?? 0) + 1);
  return [...counts].map(([cause, count]) => ({ cause, count, share: count / causes.length })).sort((a, b) => b.count - a.count);
}

export function categoryAverages(list, window = WINDOW) {
  const recent = [...list].sort(byDate).slice(-window);
  const result = {};
  for (const category of CATEGORIES) {
    const values = recent.map((s) => s.scores[category]).filter((v) => v != null);
    if (values.length) result[category] = mean(values);
  }
  return result;
}

// ---------- Sessions ----------

export const SESSION_GAP = 60 * 60 * 1000;
export const TILT_STREAK = 2;

/** Your own matches with a result, analysed or not. */
export const played = (matches) => matches.filter((m) => !m.isReference)
  .map((m) => ({ id: m.id, playedAt: m.playedAt, result: m.result ?? 'unknown', overall: latestCompletedRun(m)?.overallScore ?? null }));

export function sessions(list) {
  const result = [];
  for (const match of [...list].sort(byDate)) {
    const last = result.at(-1)?.at(-1);
    if (last && time(match.playedAt) - time(last.playedAt) <= SESSION_GAP) result.at(-1).push(match);
    else result.push([match]);
  }
  return result.map((matches) => ({ matches, start: matches[0].playedAt, trailingLosses: lossesInARow(matches.length, matches),
    wins: matches.filter((m) => m.result === 'win').length, losses: matches.filter((m) => m.result === 'loss').length }));
}

export function lossesInARow(before, matches) {
  let count = 0;
  for (const match of matches.slice(0, before).reverse()) {
    if (match.result === 'loss') count += 1;
    else if (match.result === 'unknown') continue;
    else return count;
  }
  return count;
}

function sessionGroup(matches) {
  const decided = matches.filter((m) => m.result === 'win' || m.result === 'loss');
  const scores = matches.map((m) => m.overall).filter((v) => v != null);
  const wins = decided.filter((m) => m.result === 'win').length;
  return { matches: matches.length, wins, decided: decided.length, winRate: decided.length ? wins / decided.length : null,
    averageOverall: scores.length ? mean(scores) : null, scored: scores.length };
}

export function tilt(list) {
  const onStreak = [];
  const otherwise = [];
  for (const session of sessions(list)) {
    session.matches.forEach((match, index) => (lossesInARow(index, session.matches) >= TILT_STREAK ? onStreak : otherwise).push(match));
  }
  const result = { onStreak: sessionGroup(onStreak), otherwise: sessionGroup(otherwise) };
  result.canCompare = result.onStreak.matches >= 3 && result.otherwise.matches >= 3;
  return result;
}

export function byPosition(list) {
  const buckets = [[], [], [], []];
  for (const session of sessions(list)) session.matches.forEach((m, index) => buckets[Math.min(index, 3)].push(m));
  return ['1st match', '2nd match', '3rd match', '4th and later'].map((label, i) => ({ label, group: sessionGroup(buckets[i]) })).filter((x) => x.group.matches);
}

export function longestLossStreak(list) {
  let longest = 0;
  let current = 0;
  for (const match of [...list].sort(byDate)) {
    if (match.result === 'loss') { current += 1; longest = Math.max(longest, current); } else if (match.result !== 'unknown') current = 0;
  }
  return longest;
}

export function currentSession(list, now = new Date()) {
  const last = sessions(list).at(-1);
  return last && now - time(last.matches.at(-1).playedAt) <= SESSION_GAP ? last : null;
}

// ---------- Weekly report ----------

/** Monday 00:00 of the week containing `date`, local time. */
export function weekStart(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

export const FOCUS_RULES = {
  aim: 'Hold your crosshair at head height on the corner the enemy will come from, before every fight.',
  movement: 'Strafe in every duel and never cross open ground without a reason.',
  positioning: 'Before each fight, name your cover and your escape route. Never be the first player the enemy can see.',
  engagement: 'Check the kill feed before you engage: take no fight while your team is down a player.',
  targetPriority: 'Shoot the squishiest target you can reach, not the tank or the shield.',
  cooldowns: 'Keep your escape ability for the moment you are focused. Never open a fight with it.',
  ultEconomy: 'Once your ultimate is charged, use it in the next fight, at the start, not after it is lost.',
  gameSense: 'After every kill feed line, check behind you, and react to every enemy ultimate voice line.',
  deathQuality: 'Don\'t be the first death: back off to cover at half health before the fight is decided.',
  heroMechanics: 'Pick one item of your hero checklist and practise only that for the whole session.',
};

const format1 = (v) => v.toFixed(1);

export function weeklyDigest(list, date = new Date(), habit = null) {
  const start = weekStart(date);
  const end = new Date(start.getTime() + 7 * 86_400_000);
  const previousStart = new Date(start.getTime() - 7 * 86_400_000);
  const week = list.filter((s) => time(s.playedAt) >= start && time(s.playedAt) < end);
  const previous = list.filter((s) => time(s.playedAt) >= previousStart && time(s.playedAt) < start);
  const average = (matches) => { const v = matches.map((m) => m.overall).filter((x) => x != null); return v.length ? mean(v) : null; };
  if (!week.length) {
    return { weekStart: start, matches: 0, wins: 0, losses: 0, averageOverall: null, previousAverage: average(previous),
      doingRight: 'No analysed matches this week.', doingWrong: 'No analysed matches this week.',
      fixNext: 'Record and analyse at least 3 matches so the week can be judged.', focus: null };
  }
  const averages = {};
  for (const category of CATEGORIES) {
    const values = week.map((s) => s.scores[category]).filter((v) => v != null);
    if (values.length >= 2) averages[category] = { average: mean(values), matches: values.length };
  }
  const strong = Object.entries(averages).filter(([, a]) => a.average >= 5).sort((a, b) => b[1].average - a[1].average);
  const doingRight = strong.length
    ? strong.map(([c, a]) => `${categoryName(c)} averaged ${format1(a.average)} over ${a.matches} matches (${scoreBand(a.average)}).`).join(' ')
    : 'Nothing reached the 5–6 anchor this week.';
  const sentences = [];
  const weakest = Object.entries(averages).sort((a, b) => a[1].average - b[1].average)[0];
  if (weakest) sentences.push(`${categoryName(weakest[0])} averaged ${format1(weakest[1].average)} over ${weakest[1].matches} matches (${scoreBand(weakest[1].average)}).`);
  const cause = deathCauses(week, week.length)[0];
  if (cause && cause.cause !== 'unknown') sentences.push(`${Math.round(cause.share * 100)} % of your deaths were ${cause.cause} deaths.`);
  const topCounts = new Map();
  for (const c of week.flatMap((s) => s.topMistakes)) topCounts.set(c, (topCounts.get(c) ?? 0) + 1);
  const top = [...topCounts].sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] >= 2) sentences.push(`${categoryName(top[0])} was one of the 3 costliest mistakes in ${top[1]} of ${week.length} matches.`);
  const focus = [...topCounts].sort((a, b) => (b[1] - a[1]) || ((averages[a[0]]?.average ?? 10) - (averages[b[0]]?.average ?? 10)))[0]?.[0]
    ?? Object.entries(averages).sort((a, b) => a[1].average - b[1].average)[0]?.[0] ?? null;
  return {
    weekStart: start, matches: week.length, wins: week.filter((s) => s.result === 'win').length, losses: week.filter((s) => s.result === 'loss').length,
    averageOverall: average(week), previousAverage: average(previous), doingRight,
    doingWrong: sentences.length ? sentences.join(' ') : 'Too few assessed categories this week to name a weakness.',
    fixNext: habit ? `Keep training your habit "${habit.title}": ${habit.action}.` : focus ? `${categoryName(focus)}: ${FOCUS_RULES[focus]}` : 'Not enough assessed categories this week to pick a focus.',
    focus,
  };
}

// ---------- Compared with your last matches ----------

export const COMPARISON = { window: 5, minimumMatches: 2, minimumSamples: 2, minimumLength: 120 };
export const COMPARISON_NOTE = 'Worked out on this PC from your saved reports, with no AI. One match swings a lot: read it as a hint, not a trend.';

function line(label, current, usual, format, lowerIsBetter, threshold) {
  const change = current - usual;
  const trendValue = Math.abs(change) < threshold - 1e-9 ? 'same' : (change < 0) === lowerIsBetter ? 'better' : 'worse';
  const text = (v) => (format === 'share' ? `${Math.round(v * 100)}%` : v.toFixed(1));
  const sign = change > 0 ? '+' : change < 0 ? '−' : '±';
  return {
    label, current, usual, format, lowerIsBetter, threshold, trend: trendValue,
    trendLabel: { better: 'Better', worse: 'Worse', same: 'About the same' }[trendValue],
    currentText: text(current), usualText: text(usual),
    changeText: format === 'share' ? `${sign}${Math.round(Math.abs(change) * 100)} pts` : `${sign}${Math.abs(change).toFixed(1)}`,
  };
}

export function deathRate(s) {
  return s.deaths != null && s.durationSeconds >= COMPARISON.minimumLength ? (s.deaths / s.durationSeconds) * 600 : null;
}

const share = (part, total) => (total > 0 ? part / total : null);

/** This report against your last 5 earlier matches in the same role; null with fewer than 2. */
export function compare(current, earlier) {
  const recent = earlier.filter((s) => s.id !== current.id && time(s.playedAt) < time(current.playedAt))
    .filter((s) => current.role == null || s.role === current.role)
    .sort((a, b) => time(b.playedAt) - time(a.playedAt)).slice(0, COMPARISON.window);
  if (recent.length < COMPARISON.minimumMatches) return null;
  const make = (label, value, format, lowerIsBetter, threshold) => {
    const now = value(current);
    if (now == null) return null;
    const before = recent.map(value).filter((v) => v != null);
    return before.length >= COMPARISON.minimumSamples ? line(label, now, mean(before), format, lowerIsBetter, threshold) : null;
  };
  const lines = [
    make('Overall score', (s) => s.overall, 'score', false, 0.3),
    make('Deaths per 10 min', deathRate, 'rate', true, 0.5),
    make('Avoidable deaths', (s) => share(s.avoidableDeaths, s.reviewedDeaths), 'share', true, 0.1),
    make('First death of the fight', (s) => share(s.firstDeaths, s.reviewedDeaths), 'share', true, 0.1),
  ].filter(Boolean);
  const categories = CATEGORIES.map((c) => make(categoryName(c), (s) => s.scores[c] ?? null, 'score', false, 0.5)).filter(Boolean);
  const repeats = [];
  for (const category of current.topMistakes) {
    if (repeats.some((r) => r.category === category)) continue;
    let streak = 1;
    for (const s of recent) { if (s.topMistakes.includes(category)) streak += 1; else break; }
    if (streak >= 2) repeats.push({ category, streak });
  }
  for (const category of recent[0].topMistakes) {
    if (!current.topMistakes.includes(category) && !repeats.some((r) => r.category === category)) repeats.push({ category, streak: 0 });
  }
  const role = current.role ? ` ${roleName(current.role)}` : '';
  const moved = categories.filter((c) => c.trend !== 'same');
  const steady = categories.length - moved.length;
  const comparison = {
    basis: recent.length === 1 ? `your last${role} match` : `your last ${recent.length}${role} matches`,
    matches: recent.length, lines, categories, movedCategories: moved,
    steadyCategoriesText: steady > 0 ? (moved.length ? `${steady === 1 ? '1 other category' : `${steady} other categories`} within half a point of your usual.` : `All ${categories.length} compared categories are within half a point of your usual.`) : null,
    repeats: repeats.map((r) => ({ ...r, isBack: r.streak > 0,
      text: r.streak > 0 ? `${categoryName(r.category)}: among the costliest mistakes ${r.streak} matches in a row.`
        : `${categoryName(r.category)}: among the costliest mistakes last match, not in this one.` })),
  };
  comparison.isEmpty = !lines.length && !categories.length && !comparison.repeats.length;
  comparison.textLines = [...lines, ...moved].map((l) => `${l.label}: ${l.currentText} vs your usual ${l.usualText} (${l.trend === 'same' ? 'about the same' : `${l.trendLabel.toLowerCase()}, ${l.changeText}`})`)
    .concat(comparison.steadyCategoriesText ? [comparison.steadyCategoriesText] : [], comparison.repeats.map((r) => r.text));
  return comparison;
}

/** A report compared with your matches played before it (never for reference matches). */
export function compareMatch(match, run, allMatches) {
  const current = summarize(match, run);
  if (!current) return null;
  const earlier = allMatches.filter((m) => !m.isReference && time(m.playedAt) < time(match.playedAt)).map((m) => summarize(m)).filter(Boolean);
  return compare(current, earlier);
}

// ---------- Disputes ----------

export function disputeStats(matches) {
  const items = matches.filter((m) => !m.isReference).flatMap((m) => {
    const run = latestCompletedRun(m);
    return run ? (run.findings ?? []).map((f) => ({ category: f.category, model: run.modelID.split(', ').at(-1) || 'unknown', isDisputed: f.isDisputed })) : [];
  });
  const rows = (key) => {
    const buckets = new Map();
    for (const item of items) buckets.set(item[key], [...(buckets.get(item[key]) ?? []), item]);
    return [...buckets].map(([k, list]) => ({ key: k, disputed: list.filter((i) => i.isDisputed).length, total: list.length }))
      .filter((r) => r.disputed > 0).map((r) => ({ ...r, share: r.disputed / Math.max(r.total, 1) }))
      .sort((a, b) => (b.share - a.share) || (b.disputed - a.disputed) || a.key.localeCompare(b.key));
  };
  return { disputed: items.filter((i) => i.isDisputed).length, total: items.length, byCategory: rows('category'), byModel: rows('model') };
}

export { confidenceRank };
