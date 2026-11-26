// The six analyzer agents and their footage (port of Specialist, AnalysisMode, ClipPlanner, ClipGuard, MatchTimeline).
import { parseTimestamp } from '../../shared/rubric.js';

export const SPECIALISTS = {
  aim: { title: 'Aim', categories: ['aim'], footage: { kind: 'fightClips', fps: 5 },
    brief: 'Judge crosshair placement before contact, tracking and flicks during contact, and shot discipline.' },
  movement: { title: 'Movement', categories: ['movement'], footage: { kind: 'fightClips', fps: 5 },
    brief: 'Judge duel movement, cover-to-cover travel, use of mobility abilities and rotation paths.' },
  positioning: { title: 'Positioning', categories: ['positioning'], footage: { kind: 'fullMatch', fps: 1 },
    brief: 'Judge where the player stands relative to cover, high ground, enemy sightlines, team spacing and healer line of sight, especially 3–10 s before each death.' },
  decisionMaking: { title: 'Decision-making', categories: ['engagement', 'targetPriority', 'cooldowns', 'ultEconomy', 'gameSense'], footage: { kind: 'fullMatch', fps: 1 },
    brief: 'Judge fight timing (numbers, staggering, disengaging), target or resource priority, cooldown discipline, ultimate economy and awareness of audible and visible threats.' },
  deathReview: { title: 'Death review', categories: ['deathQuality'], footage: { kind: 'deathClips', fps: 3 },
    brief: 'Review every one of the player\'s deaths, starting about 10 s before the death frame, and classify it with the per-death fields of the rubric.' },
  heroMechanics: { title: 'Hero mechanics', categories: ['heroMechanics'], footage: { kind: 'fightClips', fps: 5 },
    brief: 'Judge use of the hero kit against the hero checklist below. Without a checklist for a played hero, mark the category not assessable.' },
};

/** Lean mode groups specialists so a match costs fewer free requests; full mode runs one call each. */
export const MODES = {
  lean: [['aim', 'movement', 'heroMechanics'], ['positioning', 'decisionMaking'], ['deathReview']],
  full: [['aim'], ['movement'], ['positioning'], ['decisionMaking'], ['deathReview'], ['heroMechanics']],
};

export const requestsNeeded = (mode) => MODES[mode].length + 2;

export const CLIPS = { maxFight: 6, maxFightLength: 25, maxDeath: 10, deathPreRoll: 12, deathPostRoll: 2 };

const clipContains = (clip, time, tolerance = 2) => time >= clip.start - tolerance && time <= clip.end + tolerance;

/**
 * Clips for a footage type; null means the whole match. `range` is the part of the recording that is the match.
 */
export function planClips(footage, timeline, duration) {
  if (footage.kind === 'fullMatch') return null;
  if (footage.kind === 'fightClips') {
    return [...timeline.fights]
      .sort((a, b) => ((b.killsFor + b.killsAgainst) - (a.killsFor + a.killsAgainst)) || ((b.end - b.start) - (a.end - a.start)))
      .slice(0, CLIPS.maxFight)
      .sort((a, b) => a.start - b.start)
      .map((fight) => {
        const start = Math.max(0, fight.start - 2);
        return { label: 'fight', start, end: Math.min(duration, fight.end + 2, start + CLIPS.maxFightLength), fps: footage.fps };
      });
  }
  return timeline.deaths.slice(0, CLIPS.maxDeath).map((death) => ({
    label: 'death', start: Math.max(0, death.time - CLIPS.deathPreRoll), end: Math.min(duration, death.time + CLIPS.deathPostRoll), fps: footage.fps,
  }));
}

export const clipsUnsupported = (footage, clips) => footage.kind !== 'fullMatch' && !(clips?.length);

/** A specialist that only saw clips can't report moments outside them. */
export function restrictToClips(report, clips) {
  const inside = (timestamp) => {
    const time = parseTimestamp(timestamp);
    return time == null || clips.some((clip) => clipContains(clip, time));
  };
  const issues = [];
  return {
    report: {
      ...report,
      findings: report.findings.filter((finding) => {
        const keep = inside(finding.timestamp);
        if (!keep) issues.push({ severity: 'corrected', message: `${finding.category} finding at ${finding.timestamp} dropped: outside the clips this specialist saw.` });
        return keep;
      }),
      categories: report.categories.map((c) => ({ ...c, evidence: c.evidence.filter(inside) })),
      deaths: report.deaths.filter((d) => inside(d.timestamp)),
      habitChecks: (report.habitChecks ?? []).filter((c) => inside(c.timestamp)),
    },
    issues,
  };
}
