// Patch radar and hero kit changes (port of PatchRadar and HeroKitWatch). Pure functions.
import { heroName } from './catalog.js';

export const WIN_THRESHOLD = 2.0;
const DAY = 86_400_000;

const pickJumped = (before, now) => Math.abs(now - before) >= 0.5 && Math.abs(now - before) >= 0.3 * Math.max(before, 0.1);

/** Snapshot 6+ days older than the newest (else the oldest one at least 2 days older). */
export function baseline(history) {
  const latest = history.at(-1);
  if (!latest) return null;
  const older = history.slice(0, -1).filter((s) => new Date(latest.date) - new Date(s.date) >= 2 * DAY);
  return [...older].reverse().find((s) => new Date(latest.date) - new Date(s.date) >= 6 * DAY) ?? older[0] ?? null;
}

export function shifts(history, heroes = null) {
  const latest = history.at(-1);
  const base = baseline(history);
  if (!latest || !base) return [];
  return (heroes ?? Object.keys(latest.stats)).map((key) => {
    const now = latest.stats[key];
    const before = base.stats[key];
    if (!now || !before) return null;
    const shift = { heroKey: key, since: base.date, winBefore: before.winrate, winNow: now.winrate, pickBefore: before.pickrate, pickNow: now.pickrate };
    shift.winDelta = shift.winNow - shift.winBefore;
    shift.pickDelta = shift.pickNow - shift.pickBefore;
    shift.kind = shift.winDelta >= WIN_THRESHOLD ? 'stronger' : shift.winDelta <= -WIN_THRESHOLD ? 'weaker'
      : pickJumped(shift.pickBefore, shift.pickNow) ? (shift.pickDelta > 0 ? 'morePicked' : 'lessPicked') : 'steady';
    return shift;
  }).filter(Boolean).sort((a, b) => Math.abs(b.winDelta) - Math.abs(a.winDelta));
}

const normalized = (text) => String(text).toLowerCase().replace(/[^a-z0-9]/g, '');

export function kitDiff(old, next, heroKey, date) {
  const compare = (before, after, part) => [...new Set([...Object.keys(before), ...Object.keys(after)])].sort().map((item) => {
    const was = before[item];
    const now = after[item];
    if (was == null && now != null) return { heroKey, part, item, kind: 'added', before: null, after: now, detectedAt: date };
    if (was != null && now == null) return { heroKey, part, item, kind: 'removed', before: was, after: null, detectedAt: date };
    if (was != null && normalized(was) !== normalized(now)) return { heroKey, part, item, kind: 'changed', before: was, after: now, detectedAt: date };
    return null;
  }).filter(Boolean);
  const hitpoints = [...new Set([...Object.keys(old.hitpoints ?? {}), ...Object.keys(next.hitpoints ?? {})])].sort()
    .filter((key) => old.hitpoints?.[key] !== next.hitpoints?.[key])
    .map((key) => ({ heroKey, part: 'hitpoints', item: key.charAt(0).toUpperCase() + key.slice(1), kind: 'changed',
      before: old.hitpoints?.[key] != null ? String(old.hitpoints[key]) : null, after: next.hitpoints?.[key] != null ? String(next.hitpoints[key]) : null, detectedAt: date }));
  return [...compare(old.abilities ?? {}, next.abilities ?? {}, 'ability'), ...compare(old.perks ?? {}, next.perks ?? {}, 'perk'), ...hitpoints];
}

export function kitChangeSummary(change) {
  const name = heroName(change.heroKey);
  if (change.part === 'hitpoints') return `${name}: ${change.item} ${change.before ?? '–'} → ${change.after ?? '–'}`;
  if (change.kind === 'added') return `${name}: new ${change.part} ${change.item}`;
  if (change.kind === 'removed') return `${name}: ${change.part} ${change.item} removed`;
  return `${name}: ${change.item} description changed`;
}

/** OverFast's division for a rank; it has no Champion bracket. */
export function metaQuery(rank, region = 'europe', platform = 'pc') {
  const division = rank?.tier ? (rank.tier === 'champion' ? 'grandmaster' : rank.tier) : null;
  return { division, region, platform, gamemode: 'competitive' };
}

export const queryKey = (q) => `${q.division ?? 'all'}|${q.region}|${q.platform}|${q.gamemode}`;
export const queryLabel = (q) => [q.division ? q.division.charAt(0).toUpperCase() + q.division.slice(1) : 'All ranks',
  q.region.charAt(0).toUpperCase() + q.region.slice(1), q.platform.toUpperCase(), 'Competitive'].join(' · ');
