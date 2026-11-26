// Reading plain match objects from the database (port of MatchRecord+Domain and the run accessors).
import { gameMap, heroName } from './catalog.js';
import { CATEGORIES } from './rubric.js';

export const QUEUES = ['competitive', 'quickPlay', 'other'];
export const RESULTS = ['win', 'loss', 'draw', 'unknown'];

export const matchTitle = (match) => gameMap(match.mapKey)?.name ?? 'Unknown map';
export const heroLine = (match) => (match.heroKeys?.length ? match.heroKeys.map(heroName).join(' → ') : 'Hero unknown');

/** Newest first. */
export const runsOf = (match) => [...(match.runs ?? [])].sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
export const latestCompletedRun = (match) => runsOf(match).find((run) => run.status === 'completed') ?? null;

export const categoryScores = (run) => [...(run.scores ?? [])].sort((a, b) => CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category));
export const findingsOf = (run) => [...(run.findings ?? [])].sort((a, b) => a.timestamp - b.timestamp);
export const topMistakes = (run) => findingsOf(run).filter((f) => f.topRank > 0).sort((a, b) => a.topRank - b.topRank);
export const strengthsOf = (run) => findingsOf(run).filter((f) => f.kind === 'strength');
export const deathsOf = (run) => [...(run.deaths ?? [])].sort((a, b) => a.timestamp - b.timestamp);
export const habitChecksOf = (run) => [...(run.habitChecks ?? [])].sort((a, b) => a.timestamp - b.timestamp);

export const videoExists = (match) => Boolean(match.video && !match.video.deletedAt && match.video.exists !== false);

/** Scoreboard numbers and match length; null where unknown. */
export const STAT_FIELDS = ['eliminations', 'assists', 'deaths', 'damage', 'healing', 'mitigation'];
export const statsOf = (match) => ({ ...Object.fromEntries(STAT_FIELDS.map((f) => [f, match.stats?.[f] ?? null])), durationSeconds: match.stats?.durationSeconds ?? null });

export const resultColor = (result) => ({ win: 'var(--success)', loss: 'var(--danger)', draw: 'var(--warning)' }[result] ?? 'var(--text-2)');
export const resultName = (result) => ({ win: 'Victory', loss: 'Defeat', draw: 'Draw' }[result] ?? 'Unknown');
