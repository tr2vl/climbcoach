// Pieces shared by the screens: match rows, the video player, findings, scores, killers, charts.
import { HEROES, heroName, rankText, roleName } from '../shared/catalog.js';
import { heroLine, matchTitle, resultColor } from '../shared/match.js';
import { checklistFor, CHECKLIST_VERSION } from '../shared/checklists.js';
import { categoryName, formatTimestamp, scoreNote, scoreNoteHelp } from '../shared/rubric.js';
import { coachSays } from './coach.js';
import { button, h, icon, tag } from './ui.js';

export const dateTime = (date) => new Date(date).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export const dateOnly = (date) => new Date(date).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
export const percent = (value) => `${Math.round(value * 100)} %`;

export function scoreColor(score) {
  if (score == null) return 'var(--text-2)';
  const value = Math.round(score);
  if (value < 3) return 'var(--danger)';
  if (value < 5) return 'var(--warning)';
  if (value < 7) return 'var(--blue)';
  return 'var(--success)';
}

export const resultTag = (match) => tag(match.isReference ? 'Ref' : ({ win: 'Win', loss: 'Loss', draw: 'Draw' }[match.result] ?? 'N/A'),
  match.isReference ? 'var(--blue)' : resultColor(match.result));

export function matchRow(match, { selected = false, onclick } = {}) {
  return h('button', { class: `match-row ${selected ? 'selected' : ''}`, onclick },
    h('div', { style: { width: '64px' } }, resultTag(match)),
    h('div', { class: 'grow' }, h('div', { class: 'heading' }, matchTitle(match)), h('div', { class: 'caption' }, heroLine(match))),
    h('div', { class: 'caption', style: { textAlign: 'right' } }, dateTime(match.playedAt),
      match.replayCode ? h('div', { style: { color: 'var(--blue)' } }, match.replayCode) : null));
}

export function emptyState(iconName, title, message, actionTitle, action) {
  return h('div', { class: 'row', style: { gap: '18px', padding: '18px 6px' } },
    h('div', { style: { color: 'var(--text-2)' } }, icon(iconName, 40)),
    h('div', { class: 'stack grow', style: { gap: '6px' } }, h('div', { class: 'heading', style: { fontSize: '18px' } }, title), h('div', { class: 'muted' }, message)),
    actionTitle ? button(actionTitle, action, { kind: 'accent' }) : null);
}

// ---------- Video ----------

/** A video with a seek handle on `app.player`, so timestamps elsewhere can jump it. */
export function videoPlayer(app, url, { start = null } = {}) {
  const video = h('video', { class: 'video', controls: true, preload: 'metadata', src: url });
  app.player = {
    video,
    seek(seconds, leadIn = 3) {
      video.currentTime = Math.max(0, seconds - leadIn);
      video.play().catch(() => {});
      video.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    },
  };
  if (start != null) video.addEventListener('loadedmetadata', () => { video.currentTime = start; }, { once: true });
  return video;
}

export function timestampButton(app, seconds) {
  return h('button', { class: 'timestamp', title: `Jump the video to ${formatTimestamp(seconds)}`, onclick: () => app.player?.seek(seconds) },
    h('svg', { width: 10, height: 10, viewBox: '0 0 10 10', 'aria-hidden': 'true' }, h('path', { d: 'M1 0 9 5 1 10z', fill: 'currentColor' })),
    formatTimestamp(seconds));
}

// ---------- Findings and scores ----------

export function findingCard(app, run, finding, rank = null) {
  const disputed = finding.isDisputed;
  const ui = app.ui.dispute ?? (app.ui.dispute = {});
  const editing = ui[finding.id];
  const card = h('div', { class: 'finding', style: { opacity: disputed ? 0.7 : 1 } },
    rank ? h('div', { class: 'rank-badge', style: { background: finding.kind === 'mistake' ? 'var(--orange)' : 'var(--success)' } }, rank) : null,
    h('div', { class: 'stack grow', style: { gap: '4px' } },
      h('div', { class: 'row', style: { gap: '8px' } },
        timestampButton(app, finding.timestamp),
        h('span', { class: 'caption', style: { fontWeight: 600 } }, categoryName(finding.category)),
        finding.kind === 'mistake' ? h('span', { class: 'caption' }, `Impact ${finding.impact}/5`) : null,
        h('div', { class: 'grow' }),
        run.isReference ? null : button(disputed ? 'Disputed · undo' : 'Dispute', () => {
          if (disputed) app.climb.reports.dispute(run.id, finding.id, null);
          else { ui[finding.id] = { note: '' }; app.refresh(); }
        }, { kind: 'link', title: 'Mark this finding as wrong; it stops counting toward your trends' })),
      h('div', { style: { textDecoration: disputed ? 'line-through' : 'none' } }, finding.evidence),
      disputed && finding.disputeNote ? h('div', { class: 'caption' }, `Your note: ${finding.disputeNote}`) : null,
      editing ? h('div', { class: 'row' },
        h('input', { class: 'input grow', placeholder: 'What did the coach get wrong? (optional)', value: editing.note, oninput: (e) => { editing.note = e.target.value; } }),
        button('Dispute', () => { app.climb.reports.dispute(run.id, finding.id, editing.note || ''); delete ui[finding.id]; }, { kind: 'accent' }),
        button('Cancel', () => { delete ui[finding.id]; app.refresh(); })) : null,
      finding.fix ? h('div', { class: 'row muted', style: { gap: '6px', alignItems: 'flex-start' } }, h('span', {}, '↳'), h('span', {}, finding.fix)) : null));
  return card;
}

/** What Hero mechanics was scored against: the checklist of each hero played. */
function checklistDetails(heroKeys) {
  const lists = heroKeys.map((key) => [key, checklistFor(key)]).filter(([, items]) => items);
  if (!lists.length) return null;
  return h('details', { class: 'checklist' },
    h('summary', { class: 'caption', style: { cursor: 'pointer' } }, `What was checked (checklists ${CHECKLIST_VERSION})`),
    lists.map(([key, items]) => h('div', { class: 'stack', style: { gap: '3px', marginTop: '6px' } },
      lists.length > 1 ? h('div', { class: 'caption', style: { color: 'var(--text-1)' } }, heroName(key)) : null,
      items.map((item) => h('div', { class: 'caption row', style: { gap: '6px', alignItems: 'flex-start' } }, h('span', {}, '•'), h('span', {}, item))))));
}

export function categoryScoreRow(score, heroKeys = []) {
  const note = score.score != null ? scoreNote(score.confidence) : null;
  const color = scoreColor(score.score);
  return h('div', { class: 'stack', style: { gap: '5px' } },
    h('div', { class: 'row' },
      h('div', { class: 'heading grow', style: { fontSize: '16px' } }, categoryName(score.category)),
      note ? h('span', { title: scoreNoteHelp(score.confidence) }, tag(note, score.confidence === 'low' ? 'var(--warning)' : 'var(--text-2)')) : null,
      h('div', { class: 'heading', style: { color, fontSize: '20px' } }, score.score ?? 'N/A')),
    h('div', { class: 'meter' }, h('div', { style: { width: `${(score.score ?? 0) * 10}%`, background: color } })),
    h('div', { class: 'caption' }, score.score == null ? `Not assessable. ${score.rationale}` : score.rationale),
    score.category === 'heroMechanics' ? checklistDetails(heroKeys) : null);
}

/** Who killed you, correctable; the correction carries over to other deaths by the same enemy player. */
export function killerPicker(app, run, death) {
  const select = h('select', { class: 'input', style: { height: '26px', fontSize: '12px', width: '170px' }, 'aria-label': 'Killed by',
    onchange: async (e) => {
      const others = await app.climb.reports.killer(run.id, death.id, e.target.value || null);
      if (others) app.toast?.(`Also changed ${others} other death${others === 1 ? '' : 's'} by the same player.`);
    } },
  h('option', { value: '' }, 'Killer unknown'),
  HEROES.map((hero) => h('option', { value: hero.key, selected: death.killerHeroKey === hero.key }, `Killed by ${hero.name}`)));
  return select;
}

// ---------- Coach status ----------

export function analysisLine(progress) {
  switch (progress?.step) {
    case 'readingHUD': return [`Reading your HUD: deaths, kill feed and the end screen.`, `Reading the HUD on this PC (${Math.round((progress.fraction ?? 0) * 100)} %)…`];
    case 'uploading': return ['Getting the video ready to watch.', `Uploading the video to Gemini${progress.fraction != null ? ` (${Math.round(progress.fraction * 100)} %)` : ''}…`];
    case 'scouting': return ['Watching your match. Mapping fights and deaths…', 'Mapping fights and deaths…'];
    case 'specialists': return ['Going through every fight with the specialists…', `Specialists reviewing (${progress.done}/${progress.total})…`];
    case 'orchestrating': return ['Checking the specialists\' notes and picking what cost you most.', 'Head coach merging and checking…'];
    default: return ['Starting…', ''];
  }
}

export const analysisMood = (progress) => (['specialists', 'orchestrating'].includes(progress?.step) ? 'thinking' : 'watching');

export function coachLine(mood, size, title, detail) {
  return coachSays(mood, size, h('div', { class: 'heading' }, title), detail ? h('div', { class: 'muted' }, detail) : null);
}

// ---------- Charts ----------

/**
 * A line of 0–10 scores over matches with its 10-match average. Points are your matches, oldest left.
 * @param {{date: string, score: number}[]} points
 */
export function scoreChart(points, rolling, { height = 180 } = {}) {
  const width = 640;
  const pad = { left: 28, right: 12, top: 10, bottom: 22 };
  const x = (i) => pad.left + (points.length <= 1 ? 0 : (i / (points.length - 1)) * (width - pad.left - pad.right));
  const y = (v) => pad.top + (1 - v / 10) * (height - pad.top - pad.bottom);
  const grid = [0, 2, 4, 6, 8, 10].map((v) => [
    h('line', { x1: pad.left, x2: width - pad.right, y1: y(v), y2: y(v), stroke: 'var(--stroke)', 'stroke-width': 1, opacity: 0.5 }),
    h('text', { x: pad.left - 8, y: y(v) + 4, 'text-anchor': 'end', fill: 'var(--text-2)', 'font-size': 10 }, v),
  ]);
  const path = (values) => values.map((v, i) => (v == null ? null : `${x(i)},${y(v)}`)).filter(Boolean);
  const avg = path(rolling);
  return h('svg', { viewBox: `0 0 ${width} ${height}`, class: 'chart', role: 'img', 'aria-label': `Overall score in your last ${points.length} matches` },
    grid,
    avg.length > 1 ? h('polyline', { points: avg.join(' '), fill: 'none', stroke: 'var(--orange)', 'stroke-width': 2 }) : null,
    points.map((p, i) => h('circle', { cx: x(i), cy: y(p.score), r: 4, fill: 'var(--blue)', stroke: 'var(--surface)', 'stroke-width': 2 },
      h('title', {}, `${dateOnly(p.date)}: ${p.score.toFixed(1)}`))),
    points.length ? h('text', { x: x(points.length - 1), y: height - 6, 'text-anchor': 'end', fill: 'var(--text-2)', 'font-size': 10 }, dateOnly(points.at(-1).date)) : null,
    points.length > 1 ? h('text', { x: pad.left, y: height - 6, fill: 'var(--text-2)', 'font-size': 10 }, dateOnly(points[0].date)) : null);
}

/** A horizontal bar for a share or a 0–10 score. */
export const bar = (fraction, color = 'var(--blue)') => h('div', { class: 'meter' }, h('div', { style: { width: `${Math.max(0, Math.min(1, fraction)) * 100}%`, background: color } }));

export const roleRank = (role) => `${roleName(role.role)} · ${rankText(role.rank)}`;
export { heroName };
