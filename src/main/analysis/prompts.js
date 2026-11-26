// The system prompts. Every analyzer prompt embeds the rubric verbatim, honesty rules included.
// (Port of PromptBuilder p5; Windows adds the match range of a recording that wasn't cut.)
import { heroName, modeName, rankText, roleName } from '../../shared/catalog.js';
import { categoryName, formatTimestamp } from '../../shared/rubric.js';
import { RUBRIC_TEXT } from '../../shared/rubric-text.js';
import { checklistFor, CHECKLIST_VERSION } from '../../shared/checklists.js';
import { SPECIALISTS } from './specialists.js';

export const PROMPT_VERSION = 'p5w';

const lowerFirst = (text) => text.charAt(0).toLowerCase() + text.slice(1);
const heroNames = (context) => context.heroKeys.map(heroName).join(', ') || 'unknown';

export function scout(context, hints, readsScoreboard = false) {
  return `You are the scout pass of ClimbCoach, an Overwatch coaching app. You map one recording of the player's own match so that specialist coaches know where to look. You do not judge the play.

${matchFacts(context)}

Find, using absolute video time (m:ss):
- Every team fight: start at the first real damage exchange, end at the last kill or when one team backs off. Outcome from the player's team's view, and kills for and against from the kill feed.
- Every death of the player: the kill feed line with the player as victim, or the view switching to the death or spectator screen. Give the killer's hero only if you clearly see it (the "ELIMINATED BY" banner, the killer on screen, or the kill feed icon); otherwise an empty string. The roster has heroes newer than your training data: never map an unfamiliar hero to a similar-looking older one. A wrong hero is worse than none.
- Every elimination by the player in the kill feed.
- The match result from the end screen, or "unknown".
- The heroes the player played, in order (from the weapon, abilities and HUD), and the map.
List only what you can actually see or hear. Leave out anything you are unsure about.
${readsScoreboard ? scoreboardTask(context.inGameName) : ''}
${hintBlock(hints)}`;
}

export function scoreboardTask(playerName) {
  const row = playerName?.trim() ? `the row of the player "${playerName.trim()}" (highlighted)` : 'the player\'s own row (it is highlighted)';
  return `The image after the video is the final Tab scoreboard. Also fill "scoreboard": find ${row} and copy its numbers exactly as shown: E (eliminations), A (assists), D (deaths), DMG (damage), H (healing), MIT (mitigation), as plain integers. If the row isn't readable, set visible to false and every number to 0. Never guess a number.`;
}

export function specialists(group, context, clips, unsupported, timeline) {
  const specs = group.map((key) => SPECIALISTS[key]);
  const categories = specs.flatMap((s) => s.categories);
  return `You are the ${specs.map((s) => s.title).join(', ')} specialist${group.length > 1 ? 's' : ''} of ClimbCoach, a strict Overwatch coach. You review one recording of the player's own match.
${specs.map((s) => `- ${s.title}: ${s.brief}`).join('\n')}

You score only these categories, each exactly once: ${categories.map((c) => `${categoryName(c)} (${c})`).join(', ')}.

${matchFacts(context)}

${footageText(clips)}
${unsupportedText(unsupported)}
${checklistText(group, context)}
${timelineText(timeline)}
${habitTask(group, context)}

How to answer:
1. Follow the rubric below exactly, including its evidence rules and honesty rules.
2. Set assessable to false and score to 0 whenever the rubric's "Not assessable when" applies or you have fewer than 2 independent timestamps for a category.
3. Every finding is one moment: absolute timestamp, what is visible or audible then (evidence), impact 1–5 (1 minor, 3 cost a duel or tempo, 5 lost the fight or the objective), and for mistakes one concrete fix that follows the rubric's fix rule: when it applies and what to do instead (a position, a timing or a target), never just "use cover".
4. Report the most important findings, about 3–8 per category. Also report strengths: moments where the play matches the category's 5–6 anchor or higher (honesty rule 6), whatever the category's score. Only real moments with visible evidence. No padding.
5. ${voiceRule(context)} Critique the play, never the person. English only.

--- RUBRIC ---
${RUBRIC_TEXT}`;
}

export function orchestrator(context, merged, rejected) {
  return `You are the head coach of ClimbCoach. Specialist coaches reviewed one recording of the player's match. Their scores, numbered findings and death reviews are below. You don't see the video; work only from this material.

${matchFacts(context)}

Your tasks:
1. contradictions: when two findings or a finding and a score contradict each other (for example "in cover" and "in the open" at the same moment), drop the weaker-evidenced finding by its number and give the reason.
2. topMistakes: the numbers of the up to 3 mistakes that cost the most, most costly first. Never a low-confidence finding.
3. strengths: the numbers of up to 3 strength findings worth keeping, strongest first, only from categories with 2 or more medium- or high-confidence strength moments (honesty rule 6). Otherwise an empty list.
4. ${drillTask(context)}
5. summary: 2–4 sentences in the voice of a strict pro coach: what decided the fights, with timestamps. Critique the play, not the person. No praise the rubric doesn't allow.${habitSummaryTask(context, merged)}
${rejectedText(rejected)}

--- SPECIALIST MATERIAL ---
${material(merged)}

--- RUBRIC ---
${RUBRIC_TEXT}`;
}

export function matchFacts(context) {
  const name = context.inGameName?.trim() ?? '';
  const lines = [
    'Match facts:',
    context.isReference
      ? '- Reference recording: a better player\'s match from their first-person view, which the app\'s user studies. It is not the user\'s match. Score it with exactly the same rubric and anchors: a higher rank earns no extra points.'
      : `- The video is the player's own first-person view${name ? `. In-game name: "${name}".` : '.'}`,
    `- Role: ${roleName(context.role)}, rank ${context.rank ? rankText(context.rank) : 'unranked'}. Heroes: ${heroNames(context)}.`,
    `- Map: ${context.mapName ?? 'unknown'}${context.mode ? ` (${modeName(context.mode)})` : ''}.`,
    `- Result: ${context.result && context.result !== 'unknown' ? context.result.charAt(0).toUpperCase() + context.result.slice(1) : 'unknown'}. Video length: ${formatTimestamp(context.videoDuration ?? context.duration)}.`,
  ];
  const range = context.range;
  if (range && (range.start > 1 || range.end < (context.videoDuration ?? range.end) - 1)) {
    lines.push(`- The match itself runs from ${formatTimestamp(range.start)} to ${formatTimestamp(range.end)} of the video; queue and menus outside that are not part of it. Timestamps are still absolute video time.`);
  }
  if (!context.hasAudio) lines.push('- The video has no audio track: score audio cues as not observable.');
  if (context.isLiveRecording) {
    lines.push('- Recorded live, not from the replay viewer: there is no ult bar for all 10 players, so enemy ult status can\'t be read.');
    lines.push('- Voice chat between the player\'s friends may be audible. Never score, quote or judge voice comms.');
  } else {
    lines.push('- Recorded from the replay viewer or imported: the top bar may show ult % for all 10 players.');
  }
  return lines.join('\n');
}

export const voiceRule = (context) => (context.isReference ? 'Refer to the player as "they"; the user is studying them.' : 'Speak to the player as "you".');

function footageText(clips) {
  if (!clips) return 'Footage: the whole match at 1 frame per second, with audio if present.';
  const fps = clips[0] ? `${clips[0].fps}` : '?';
  return `Footage: ${clips.length} clips of the match at ${fps} frames per second. A line before each clip gives its absolute start and end time. Report every timestamp as absolute video time (the time in the full recording), never relative to a clip. Never report a moment outside the clips.`;
}

const unsupportedText = (categories) => (categories.length
  ? `This footage can't support these categories; mark them not assessable: ${categories.map(categoryName).join(', ')}.` : '');

function checklistText(group, context) {
  if (!group.includes('heroMechanics')) return '';
  const blocks = context.heroKeys.map((key) => {
    const items = checklistFor(key);
    return items ? `${heroName(key)} checklist:\n${items.map((item) => `- ${item}`).join('\n')}` : `${heroName(key)}: no checklist, so don't assess this hero's mechanics.`;
  });
  return `Hero checklists (version ${CHECKLIST_VERSION}):\n${blocks.join('\n')}`;
}

function timelineText(timeline) {
  const lines = [];
  if (timeline.deaths.length) {
    lines.push(`Deaths found by the scout pass (verify them; they can be wrong): ${timeline.deaths.map((d) => formatTimestamp(d.time) + (d.killerHero ? ` by ${d.killerHero}` : '')).join(', ')}.`);
  }
  if (timeline.fights.length) {
    lines.push(`Fights found by the scout pass: ${timeline.fights.map((f) => `${formatTimestamp(f.start)}–${formatTimestamp(f.end)} (${f.outcome})`).join(', ')}.`);
  }
  return lines.join('\n');
}

function hintBlock(hints) {
  if (!hints.length) return '';
  return 'On-device text recognition read these HUD events (they can be wrong; verify them). "deathScreen" is when the death or spectator screen became visible; the death itself is a few seconds earlier.\n'
    + hints.map((hint) => `- ${hint}`).join('\n');
}

/** Whether this group checks the habit: the group that owns the habit's category does. */
export function checksHabit(group, context) {
  if (!context.habit || context.isReference) return false;
  return group.flatMap((key) => SPECIALISTS[key].categories).includes(context.habit.card.category);
}

function habitTask(group, context) {
  if (!checksHabit(group, context)) return '';
  const card = context.habit.card;
  return `Habit check (rubric "Habit checks"): the player is training one habit, "${card.title}".
- When: ${card.trigger}.
- Do: ${card.action}.
- A coach sees it when: ${card.check}.
For every moment in the footage where the "when" situation comes up, add a habitChecks entry: the absolute timestamp, done true or false, and the evidence visible then. Only moments you can actually see; if the situation never comes up, return an empty list. Habit checks never change a score and are not findings.`;
}

export function drillTask(context) {
  const card = context.habit?.card;
  if (!card || context.isReference) {
    return 'drill: one drill for the next session that targets the costliest mistake. A short title and 2–4 concrete, checkable steps.';
  }
  return `drill: the player trains the habit "${card.title}" (when ${lowerFirst(card.trigger)}, ${lowerFirst(card.action)}). The drill keeps training it: title "${card.title}" and 2–4 concrete, checkable steps for the next session that build on this match's habit misses.`;
}

function habitSummaryTask(context, merged) {
  const habit = context.habit;
  if (!habit || context.isReference) return '';
  const checks = merged.habitChecks ?? [];
  const now = checks.length
    ? `This match: done in ${checks.filter((c) => c.done).length} of ${checks.length} checked moments (${checks.map((c) => `${c.timestamp} ${c.done ? 'done' : 'missed'}`).join(', ')}).`
    : 'No moment in this match was checked for the habit.';
  const before = habit.recent.length
    ? `Earlier matches, oldest first: ${habit.recent.map((r) => `${r.done} of ${r.total}`).join(', ')}.`
    : 'There are no earlier checked matches.';
  return ` Add one sentence on the habit "${habit.card.title}", using only these numbers: ${now} ${before}`;
}

const rejectedText = (issues) => (issues.length
  ? `\nYour previous answer was rejected for these reasons. Fix them:\n${issues.map((i) => `- ${i.message}`).join('\n')}` : '');

export function material(merged) {
  const lines = ['Category scores:'];
  for (const c of merged.categories) {
    lines.push(`- ${categoryName(c.category)}: ${c.score ?? 'not assessable'} (${c.confidence}). ${c.rationale} Evidence: ${c.evidence.join(', ')}.`);
  }
  lines.push('Findings:');
  merged.findings.forEach((f, index) => {
    lines.push(`[${index}] ${f.timestamp} ${categoryName(f.category)} ${f.kind}, impact ${f.impact}, confidence ${f.confidence}: ${f.evidence}${f.fix ? ` Fix: ${f.fix}` : ''}`);
  });
  if (merged.deaths.length) {
    lines.push('Death reviews:');
    for (const d of merged.deaths) {
      lines.push(`- ${d.timestamp}: cause ${d.cause}, avoidable ${d.avoidable}, first death of fight ${d.firstDeathOfFight ? 'yes' : 'no'}${d.killerHero ? `, killed by ${d.killerHero}` : ''}. Instead: ${d.whatToDoInstead}`);
    }
  }
  return lines.join('\n');
}
