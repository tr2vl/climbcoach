// The ten scored categories of the rubric, weights, confidence, the overall score, honesty rules and
// video timestamps (port of RubricCategory, ScoreAggregator, ScoreBand, HonestyRules, MatchTimestamp).

export const CATEGORIES = ['aim', 'movement', 'positioning', 'engagement', 'targetPriority', 'cooldowns', 'ultEconomy', 'gameSense', 'deathQuality', 'heroMechanics'];

const NAMES = {
  aim: 'Aim', movement: 'Movement', positioning: 'Positioning', engagement: 'Engagement & tempo',
  targetPriority: 'Target priority', cooldowns: 'Cooldown discipline', ultEconomy: 'Ultimate economy',
  gameSense: 'Game sense & awareness', deathQuality: 'Death quality', heroMechanics: 'Hero mechanics',
};
export const categoryName = (category) => NAMES[category] ?? category;

/** Weights from the rubric's "Overall score" table. Tank uses the DPS weights. */
export function weight(category, role) {
  const support = role === 'support';
  return {
    aim: support ? 8 : 14, movement: 8, positioning: support ? 16 : 15, engagement: 12,
    targetPriority: support ? 14 : 10, cooldowns: support ? 10 : 9, ultEconomy: support ? 10 : 8,
    gameSense: 8, deathQuality: support ? 10 : 12, heroMechanics: 4,
  }[category];
}

export const CONFIDENCES = ['high', 'medium', 'low'];
export const confidenceRank = (c) => ({ high: 2, medium: 1, low: 0 }[c] ?? 0);

/** The note next to a category score; null when the coach is sure. */
export const scoreNote = (confidence) => ({ medium: 'Less sure', low: 'Unsure' }[confidence] ?? null);
export const scoreNoteHelp = (confidence) => ({
  high: 'The coach saw clear evidence for this score.',
  medium: 'The coach saw less clear evidence for this score than usual, so it may be a point off.',
  low: 'The coach had little clear evidence for this score. Treat it as a rough guess.',
}[confidence] ?? '');

export const MINIMUM_ASSESSED = 5;

/** Weighted mean of the assessable categories; null with fewer than 5. */
export function overallScore(scores, role) {
  const assessed = Object.entries(scores).filter(([, value]) => value >= 1 && value <= 10);
  if (assessed.length < MINIMUM_ASSESSED) return null;
  const total = assessed.reduce((sum, [category]) => sum + weight(category, role), 0);
  const weighted = assessed.reduce((sum, [category, value]) => sum + weight(category, role) * value, 0);
  return Math.round((weighted / total) * 10) / 10;
}

export function scoreBand(score) {
  const value = Math.round(score);
  if (value < 3) return 'Below typical Bronze';
  if (value < 5) return 'Bronze–Silver';
  if (value < 7) return 'Gold–Platinum';
  if (value < 9) return 'Diamond–Master';
  return 'Grandmaster–Champion';
}

/** Rule 6: moments of the same good habit a category needs before its strengths are shown. */
export const STRENGTH_MOMENTS = 2;
export const FILLER_PRAISE = ['great job', 'good job', 'well done', 'nice work', 'good effort', 'keep it up', 'you\'re doing great',
  'don\'t be too hard on yourself', 'solid game overall', 'overall not bad', 'amazing', 'awesome', 'fantastic', 'impressive', 'proud of you'];
export const PERSONAL_ATTACKS = ['you suck', 'you\'re bad', 'trash', 'hopeless', 'no talent'];
export const BANNED_PHRASES = [...FILLER_PRAISE, ...PERSONAL_ATTACKS];

/** Banned phrases in `text`, case-insensitive on word boundaries. */
export function bannedPhrases(text) {
  const normalized = String(text ?? '').toLowerCase().replaceAll('’', '\'');
  return BANNED_PHRASES.filter((phrase) => new RegExp(`(?<![a-z])${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z])`).test(normalized));
}

/** "4:07", "04:07.5" or "1:02:05" → seconds; null when it isn't a time. */
export function parseTimestamp(text) {
  const parts = String(text ?? '').trim().split(':');
  if (parts.length < 2 || parts.length > 3) return null;
  const last = Number(parts.at(-1));
  if (parts.at(-1) === '' || !Number.isFinite(last) || last < 0 || last >= 60) return null;
  const whole = parts.slice(0, -1).map((p) => (/^\d+$/.test(p) ? Number(p) : NaN));
  if (whole.some((v) => Number.isNaN(v))) return null;
  if (whole.length === 2 && whole[1] >= 60) return null;
  const minutes = whole.length === 2 ? whole[0] * 60 + whole[1] : whole[0];
  return minutes * 60 + last;
}

export function formatTimestamp(seconds) {
  const total = Math.floor(Math.max(0, seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${secs}` : `${minutes}:${secs}`;
}

/** "12:05" style match length. */
export const formatDuration = (seconds) => formatTimestamp(seconds);
