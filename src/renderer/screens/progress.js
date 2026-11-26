// Progress: your scores over time, recurring mistakes, deaths, heroes, sessions and the weekly report.
import { heroName } from '../../shared/catalog.js';
import { activeHabit } from '../../shared/training.js';
import { byHero, byPosition, categoryAverages, deathCauses, disputeStats, longestLossStreak, overallSeries, played, recurringMistakes, rollingAverage, summaries, tilt, trend, weeklyDigest } from '../../shared/progress.js';
import { categoryName, scoreBand } from '../../shared/rubric.js';
import { bar, emptyState, percent, scoreChart, scoreColor } from '../components.js';
import { h, panel, screen, sectionTitle, statTile } from '../ui.js';

export function progressScreen(app) {
  const list = summaries(app.data.matches);
  const subtitle = 'Your scores over time. Averages and recurring mistakes use the last 10 analysed matches.';
  if (!list.length) {
    return screen('Progress', subtitle, panel({}, emptyState('progress', 'No analysed matches yet', 'Trends start with your first report. Record a match from the Dashboard; the analysis runs by itself.', 'Go to Dashboard (Ctrl+1)', () => app.navigate('dashboard'))));
  }
  const series = overallSeries(list);
  const t = trend(series.map((p) => p.score));
  const averages = categoryAverages(list);
  const ranked = Object.entries(averages).sort((a, b) => b[1] - a[1]);
  const habit = activeHabit(app.data.habits);
  const arrow = { improving: '↑ Improving', declining: '↓ Declining', flat: '→ Flat' };
  return screen('Progress', subtitle,
    h('div', { class: 'stat-tiles' },
      statTile('Analysed matches', String(list.length)),
      statTile('Last 10 average', t ? t.recent.toFixed(1) : '–', t ? `${arrow[t.direction]}${t.previous != null ? ` (from ${t.previous.toFixed(1)})` : ''}` : null),
      ranked[0] ? statTile('Best category', categoryName(ranked[0][0]), ranked[0][1].toFixed(1)) : null,
      ranked.at(-1) ? statTile('Weakest category', categoryName(ranked.at(-1)[0]), ranked.at(-1)[1].toFixed(1)) : null),
    panel({ accent: 'var(--orange)' }, sectionTitle('Overall score', h('span', { class: 'caption' }, 'Dots: each match · Line: 10-match average')),
      series.length ? scoreChart(series, rollingAverage(series.map((p) => p.score))) : h('div', { class: 'muted' }, 'No overall score yet: too few categories were assessable.')),
    panel({}, sectionTitle('Categories, last 10 matches'),
      h('div', { class: 'grid-2' }, ranked.map(([category, value]) => h('div', { class: 'stack', style: { gap: '4px' } },
        h('div', { class: 'row' }, h('span', { class: 'heading grow' }, categoryName(category)), h('span', { class: 'heading', style: { color: scoreColor(value) } }, value.toFixed(1))),
        bar(value / 10, scoreColor(value)), h('div', { class: 'caption' }, scoreBand(value)))))),
    recurringPanel(list),
    deathsPanel(list),
    heroesPanel(list),
    sessionsPanel(app),
    weeklyPanel(list, habit),
    disputesPanel(app));
}

function recurringPanel(list) {
  const items = recurringMistakes(list);
  return panel({ accent: 'var(--warning)' }, sectionTitle('Recurring mistakes'),
    items.length ? items.map((r) => h('div', { class: 'row' }, h('span', { class: 'heading', style: { width: '200px' } }, categoryName(r.category)),
      h('div', { class: 'grow' }, bar(r.share, 'var(--warning)')),
      h('span', { class: 'caption', style: { width: '260px' } }, `${r.matches} of ${r.outOf} matches · ${r.inTopThree}× among the costliest`)))
      : h('div', { class: 'muted' }, 'No mistake category shows up in 3 or more of your last 10 matches.'));
}

function deathsPanel(list) {
  const causes = deathCauses(list);
  if (!causes.length) return null;
  const totals = list.slice(-10);
  const reviewed = totals.reduce((s, m) => s + m.reviewedDeaths, 0);
  const avoidable = totals.reduce((s, m) => s + m.avoidableDeaths, 0);
  const first = totals.reduce((s, m) => s + m.firstDeaths, 0);
  return panel({}, sectionTitle('Deaths, last 10 matches'),
    h('div', { class: 'stat-tiles' }, statTile('Reviewed deaths', String(reviewed)),
      statTile('Avoidable', reviewed ? percent(avoidable / reviewed) : '–'), statTile('First death of a fight', reviewed ? percent(first / reviewed) : '–')),
    causes.map((c) => h('div', { class: 'row' }, h('span', { style: { width: '140px', textTransform: 'capitalize' } }, c.cause), h('div', { class: 'grow' }, bar(c.share, 'var(--danger)')),
      h('span', { class: 'caption', style: { width: '90px', textAlign: 'right' } }, `${c.count} · ${percent(c.share)}`))));
}

function heroesPanel(list) {
  const rows = byHero(list);
  if (!rows.length) return null;
  return panel({}, sectionTitle('By hero'),
    h('table', { class: 'table' }, h('thead', {}, h('tr', {}, h('th', {}, 'Hero'), h('th', {}, 'Matches'), h('th', {}, 'Win rate'), h('th', {}, 'Average score'))),
      h('tbody', {}, rows.map((r) => h('tr', {}, h('td', {}, heroName(r.key)), h('td', {}, r.matches), h('td', {}, r.winRate != null ? percent(r.winRate) : '–'),
        h('td', { style: { color: scoreColor(r.averageOverall) } }, r.averageOverall != null ? r.averageOverall.toFixed(1) : '–'))))));
}

function sessionsPanel(app) {
  const list = played(app.data.matches);
  if (list.length < 3) return null;
  const t = tilt(list);
  const positions = byPosition(list);
  return panel({}, sectionTitle('Sessions and streaks'),
    h('div', { class: 'stat-tiles' },
      statTile('Longest loss streak', String(longestLossStreak(list))),
      statTile('After 2+ losses in a row', t.onStreak.winRate != null ? percent(t.onStreak.winRate) : '–', `${t.onStreak.matches} matches`),
      statTile('Otherwise', t.otherwise.winRate != null ? percent(t.otherwise.winRate) : '–', `${t.otherwise.matches} matches`)),
    t.canCompare ? null : h('div', { class: 'caption' }, 'Win rates on a streak are compared once both groups have 3 or more matches.'),
    h('table', { class: 'table' }, h('thead', {}, h('tr', {}, h('th', {}, 'Match in the session'), h('th', {}, 'Matches'), h('th', {}, 'Win rate'), h('th', {}, 'Average score'))),
      h('tbody', {}, positions.map((p) => h('tr', {}, h('td', {}, p.label), h('td', {}, p.group.matches), h('td', {}, p.group.winRate != null ? percent(p.group.winRate) : '–'),
        h('td', {}, p.group.averageOverall != null ? p.group.averageOverall.toFixed(1) : '–'))))));
}

function weeklyPanel(list, habit) {
  const digest = weeklyDigest(list, new Date(), habit);
  const block = (label, text) => h('div', { class: 'stack', style: { gap: '2px' } }, h('div', { class: 'overline' }, label), h('div', {}, text));
  return panel({ accent: 'var(--blue)' },
    sectionTitle(`This week · since ${digest.weekStart.toLocaleDateString([], { day: 'numeric', month: 'short' })}`,
      h('span', { class: 'caption' }, `${digest.matches} analysed · ${digest.wins} W · ${digest.losses} L${digest.averageOverall != null ? ` · average ${digest.averageOverall.toFixed(1)}` : ''}${digest.previousAverage != null ? ` (last week ${digest.previousAverage.toFixed(1)})` : ''}`)),
    block('What went right', digest.doingRight), block('What went wrong', digest.doingWrong), block('Fix next', digest.fixNext),
    h('div', { class: 'caption' }, 'Worked out on this PC from your reports, with no AI. Praise only where a category reached the 5–6 anchor.'));
}

function disputesPanel(app) {
  const stats = disputeStats(app.data.matches);
  if (!stats.disputed) return null;
  return panel({}, sectionTitle('Findings you disputed', h('span', { class: 'caption' }, `${stats.disputed} of ${stats.total}`)),
    stats.byCategory.map((r) => h('div', { class: 'row' }, h('span', { style: { width: '220px' } }, categoryName(r.key)), h('span', { class: 'caption' }, `${r.disputed} of ${r.total} (${percent(r.share)})`))),
    h('div', { class: 'caption' }, 'Disputed findings stop counting toward your trends, your common mistakes and your habit.'));
}
