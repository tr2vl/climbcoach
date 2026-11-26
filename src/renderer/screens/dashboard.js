// Dashboard: where you stand right now, and what the coach says before you play.
import { heroName, rankText, roleName } from '../../shared/catalog.js';
import { latestCompletedRun } from '../../shared/match.js';
import { compareMatch, currentSession, overallSeries, played, recurringMistakes, summaries, tilt, TILT_STREAK, trend } from '../../shared/progress.js';
import { categoryName, scoreBand } from '../../shared/rubric.js';
import { kitChangeSummary, queryKey, shifts } from '../../shared/meta.js';
import { activeHabit, briefing, coachFacts, debrief, habitMatches, nudges } from '../../shared/training.js';
import { coachAvatar, coachSays } from '../coach.js';
import { matchRow, percent } from '../components.js';
import { button, h, icon, panel, screen, sectionTitle, statTile } from '../ui.js';
import { recordPanel } from './recording.js';

export function dashboard(app) {
  const matches = app.data.matches;
  const own = matches.filter((m) => !m.isReference);
  const weekAgo = Date.now() - 7 * 86_400_000;
  return screen('Dashboard', 'Where you stand right now.',
    tiltBanner(app),
    recordPanel(app),
    coachPanel(app),
    matches.length ? [
      h('div', { class: 'stat-tiles' },
        statTile('Matches', String(own.length)),
        statTile('Last 7 days', String(own.filter((m) => new Date(m.playedAt) >= weekAgo).length)),
        statTile('With video', String(own.filter((m) => m.video && !m.video.deletedAt).length)),
        statTile('Analysed', String(own.filter((m) => latestCompletedRun(m)).length))),
      patchRadarHint(app),
      trendPanel(app),
      panel({}, sectionTitle('Recent matches'),
        [...matches].sort((a, b) => new Date(b.playedAt) - new Date(a.playedAt)).slice(0, 5).map((m) => matchRow(m, { onclick: () => app.showMatch(m.id) }))),
      rolesPanel(app),
    ] : panel({},
      sectionTitle('No matches yet'),
      h('div', { class: 'muted' }, 'Record your next match above, or import a video file you already have.'),
      h('div', {}, button('Import a match (Ctrl+2)', () => app.navigate('importMatch'), { kind: 'accent' }))));
}

function tiltBanner(app) {
  const list = played(app.data.matches);
  const session = currentSession(list);
  if (!session || session.trailingLosses < TILT_STREAK) return null;
  const t = tilt(list);
  let detail = 'Take a short break before you queue again, or play the next one with only your habit in mind.';
  if (t.canCompare && t.onStreak.winRate != null && t.otherwise.winRate != null) {
    detail = `After a streak like this you have won ${percent(t.onStreak.winRate)} of your matches, against ${percent(t.otherwise.winRate)} otherwise.`
      + (t.onStreak.winRate < t.otherwise.winRate - 0.05 ? ' A short break before the next queue is worth it.' : ' So far a streak hasn\'t hurt your results, but keep an eye on it.');
  }
  return panel({ accent: 'var(--danger)' }, h('div', { class: 'row top' },
    h('div', { style: { color: 'var(--danger)' } }, icon('alert', 24)),
    h('div', { class: 'stack', style: { gap: '4px' } }, h('div', { class: 'heading' }, `${session.trailingLosses} losses in a row this session`), h('div', { class: 'muted' }, detail))));
}

export function coachPanel(app) {
  const matches = app.data.matches;
  const habit = activeHabit(app.data.habits);
  const list = habit ? habitMatches(habit.id, matches) : [];
  const notes = nudges(coachFacts(matches, app.data.habits));
  const newest = matches.filter((m) => !m.isReference && latestCompletedRun(m)).sort((a, b) => new Date(b.playedAt) - new Date(a.playedAt))[0];
  let lines = [];
  if (newest) {
    const latest = list.findLast((m) => m.matchID === newest.id) ?? null;
    const previous = latest ? list.filter((m) => new Date(m.playedAt) < new Date(latest.playedAt)).at(-1) ?? null : null;
    lines = debrief(habit?.title ?? null, latest, previous, compareMatch(newest, latestCompletedRun(newest), matches));
  }
  const mood = app.ui.dashboardTalked ? 'idle' : 'talking';
  if (!app.ui.dashboardTalked) setTimeout(() => { app.ui.dashboardTalked = true; }, 3500);
  const update = app.trainingUpdate;
  return panel({ accent: 'var(--orange)' },
    sectionTitle('Your coach', button('Open Training (Ctrl+9)', () => app.navigate('practice'), { kind: 'link' })),
    update ? h('div', { class: 'row', style: { color: update.kind === 'learned' ? 'var(--success)' : 'var(--blue)' } },
      h('span', { class: 'grow' }, update.kind === 'learned' ? `Learned: ${update.title}.${update.next ? ` Next habit: ${update.next}.` : ''}` : `New habit: ${update.title}. The next report checks it in every fight.`),
      button('Dismiss', () => { app.trainingUpdate = null; app.refresh(); }, { kind: 'link' })) : null,
    habit ? (() => {
      const b = briefing({ ...habit, drill: habit.drill ?? [] }, list);
      return coachSays(mood, 84,
        h('div', { class: 'heading' }, `Today's habit: ${b.title}`),
        h('div', {}, b.cue),
        h('div', { class: 'row muted', style: { gap: '6px', alignItems: 'flex-start', fontSize: '13px' } }, h('span', { style: { flex: 'none', marginTop: '2px' } }, icon('flame', 14)), h('span', {}, `Warm-up: ${b.warmUp}`)),
        h('div', { class: 'caption' }, b.progress));
    })() : coachSays(mood, 84, h('div', {}, matches.length
      ? 'Once 2 of your matches have reports, I\'ll pick the one habit that costs you the most and check it in every report.'
      : 'Welcome. Record your first match, and once 2 matches have reports I\'ll pick the habit that costs you the most.')),
    lines.length ? h('div', { class: 'stack', style: { gap: '4px' } }, h('div', { class: 'overline' }, 'After your last match'), lines.map((line) => h('div', {}, line))) : null,
    notes.map((note) => h('div', { class: 'row top', style: { padding: '10px', background: 'rgba(33,44,64,0.6)', clipPath: 'var(--cut-6)' } },
      h('span', { style: { color: 'var(--warning)', flex: 'none' } }, icon('bulb', 18)),
      h('div', { class: 'stack grow', style: { gap: '3px' } }, h('div', {}, note.text), h('div', { class: 'caption' }, note.detail)),
      note.actionTitle ? button(note.actionTitle, () => app.perform(note.action)) : null)));
}

function trendPanel(app) {
  const list = summaries(app.data.matches);
  const latest = [...list].sort((a, b) => new Date(b.playedAt) - new Date(a.playedAt))[0];
  if (!latest) return null;
  const t = trend(overallSeries(list).map((p) => p.score));
  const recurring = recurringMistakes(list)[0];
  const arrow = { improving: '↑ Improving', declining: '↓ Declining', flat: '→ Flat' };
  return panel({ accent: 'var(--orange)' },
    sectionTitle('Your trend', button('Open Progress (Ctrl+4)', () => app.navigate('progress'), { kind: 'link' })),
    h('div', { class: 'stat-tiles' },
      statTile('Last report', latest.overall != null ? latest.overall.toFixed(1) : 'N/A', latest.overall != null ? scoreBand(latest.overall) : null),
      statTile('Last 10 average', t ? t.recent.toFixed(1) : '–', t ? arrow[t.direction] : null)),
    recurring ? h('div', { class: 'row' }, h('span', {}, '↻'), h('span', {}, `Recurring: ${categoryName(recurring.category)} in ${recurring.matches} of your last ${recurring.outOf} matches.`)) : null);
}

function patchRadarHint(app) {
  const heroes = [...new Set(app.settings.profile.roles.flatMap((r) => r.heroKeys))];
  const history = (app.data.heroStats ?? []).filter((s) => app.meta.defaultQuery && s.query === queryKey(app.meta.defaultQuery)).map((s) => ({ date: s.fetchedAt, stats: s.stats }));
  const moved = shifts(history, heroes).filter((s) => s.kind !== 'steady').slice(0, 3);
  const kits = (app.meta.kitChanges ?? []).filter((c) => Date.now() - new Date(c.detectedAt) < 14 * 86_400_000).slice(0, 3);
  if (!moved.length && !kits.length) return null;
  return panel({ accent: 'var(--warning)' },
    sectionTitle('Patch radar', button('Open Heroes & Meta', () => app.navigate('meta'), { kind: 'link' })),
    moved.map((s) => h('div', {}, `${s.winDelta < 0 ? '↘' : '↗'} ${heroName(s.heroKey)}: ${s.winDelta >= 0 ? '+' : ''}${s.winDelta.toFixed(1)} win-rate points at your rank since ${new Date(s.since).toLocaleDateString()} (${s.kind === 'stronger' ? 'stronger' : s.kind === 'weaker' ? 'weaker' : 'pick rate moved'})`)),
    kits.map((c) => h('div', { class: 'row', style: { gap: '6px' } }, icon('settings', 14), h('span', {}, kitChangeSummary(c)))));
}

function rolesPanel(app) {
  const roles = app.settings.profile.roles;
  if (!roles.length) return null;
  return panel({ accent: 'var(--blue)' }, sectionTitle('Your roles'),
    roles.map((r) => h('div', { class: 'row' }, h('span', { class: 'heading', style: { width: '90px' } }, roleName(r.role)),
      h('span', { style: { color: 'var(--orange)', width: '110px' } }, rankText(r.rank)), h('span', { class: 'muted' }, r.heroKeys.map(heroName).join(', ') || 'No heroes picked'))));
}

export { coachAvatar, icon };
