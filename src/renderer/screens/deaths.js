// Death Reel: every reviewed death across your matches, filterable, with the seconds before it.
import { heroName } from '../../shared/catalog.js';
import { deathsOf, latestCompletedRun, matchTitle } from '../../shared/match.js';
import { formatTimestamp } from '../../shared/rubric.js';
import { emptyState, killerPicker, percent } from '../components.js';
import { button, h, panel, sectionTitle, tag } from '../ui.js';

export function deathEntries(matches) {
  return matches.filter((m) => !m.isReference).sort((a, b) => new Date(b.playedAt) - new Date(a.playedAt)).flatMap((m) => {
    const run = latestCompletedRun(m);
    return run ? deathsOf(run).map((d) => ({ id: `${m.id}-${d.id}`, match: m, run, death: d })) : [];
  });
}

const counts = (keys) => [...keys.reduce((map, k) => map.set(k, (map.get(k) ?? 0) + 1), new Map())].sort((a, b) => b[1] - a[1]);

export function deathsScreen(app) {
  const ui = app.ui.deaths ?? (app.ui.deaths = { filter: {} });
  const all = deathEntries(app.data.matches);
  const f = ui.filter;
  const shown = all.filter((e) => (!f.cause || e.death.cause === f.cause) && (!f.killer || e.death.killerHeroKey === f.killer)
    && (!f.hero || e.match.heroKeys?.includes(f.hero)) && (!f.avoidable || e.death.avoidable === 'yes') && (!f.first || e.death.isFirstDeathOfFight));
  const selected = shown.find((e) => e.id === ui.selected) ?? shown[0] ?? null;
  const header = h('header', { class: 'screen-header' }, h('h1', {}, 'Death Reel'), h('div', { class: 'rule' }),
    h('p', {}, 'Every reviewed death from your matches. Pick one to watch it; ↑ and ↓ step through the list.'));
  if (!all.length) {
    return h('div', { class: 'screen' }, h('div', { class: 'screen-inner' }, header,
      panel({}, emptyState('deaths', 'No reviewed deaths yet', 'Deaths appear here once a match has a report. Record a match from the Dashboard; the analysis runs by itself.', 'Go to Dashboard (Ctrl+1)', () => app.navigate('dashboard')))));
  }
  const set = (key, value) => { ui.filter = { ...ui.filter, [key]: value || null }; app.refresh(); };
  const picker = (label, key, options) => h('select', { class: 'input', style: { width: '190px' }, 'aria-label': label, onchange: (e) => set(key, e.target.value) },
    h('option', { value: '' }, label), options.map(([value, text]) => h('option', { value, selected: f[key] === value }, text)));
  const step = (delta) => {
    const index = shown.findIndex((e) => e.id === selected?.id);
    const next = shown[Math.max(0, Math.min(shown.length - 1, index + delta))];
    if (next) { ui.selected = next.id; app.refresh(); }
  };
  const avoidableShare = shown.length ? shown.filter((e) => e.death.avoidable === 'yes').length / shown.length : 0;
  const topCause = counts(shown.map((e) => e.death.cause))[0];
  const list = h('div', { class: 'list-panel', tabindex: 0, style: { maxHeight: 'calc(100vh - 260px)' },
    onkeydown: (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); step(1); } if (e.key === 'ArrowUp') { e.preventDefault(); step(-1); } } },
  shown.length ? shown.map((e) => h('button', { class: `match-row ${e.id === selected?.id ? 'selected' : ''}`, onclick: () => { ui.selected = e.id; app.refresh(); } },
    h('div', { class: 'stack grow', style: { gap: '3px' } },
      h('div', { class: 'row', style: { gap: '8px' } }, h('span', { class: 'code', style: { color: 'var(--blue)' } }, formatTimestamp(e.death.timestamp)),
        tag(e.death.cause, e.death.avoidable === 'yes' ? 'var(--danger)' : 'var(--text-2)'), e.death.isFirstDeathOfFight ? h('span', { class: 'caption', style: { color: 'var(--warning)', fontWeight: 800 } }, 'FIRST') : null),
      h('div', { class: 'caption' }, `${matchTitle(e.match)} · ${(e.match.heroKeys ?? []).map(heroName).join(', ')}${e.death.killerHeroKey ? ` · by ${heroName(e.death.killerHeroKey)}` : ''}`))))
    : h('div', { class: 'muted', style: { padding: '12px' } }, 'No deaths match these filters.'));
  return h('div', { class: 'screen' }, h('div', { class: 'screen-inner', style: { maxWidth: '1300px' } }, header,
    h('div', { class: 'row', style: { flexWrap: 'wrap' } },
      picker('All causes', 'cause', counts(all.map((e) => e.death.cause)).map(([c, n]) => [c, `${c.charAt(0).toUpperCase() + c.slice(1)} (${n})`])),
      picker('Killed by any hero', 'killer', counts(all.map((e) => e.death.killerHeroKey).filter(Boolean)).map(([k, n]) => [k, `${heroName(k)} (${n})`])),
      picker('You played any hero', 'hero', counts(all.flatMap((e) => e.match.heroKeys ?? [])).map(([k, n]) => [k, `${heroName(k)} (${n})`])),
      h('label', { class: 'row', style: { gap: '6px', cursor: 'pointer' } }, h('input', { type: 'checkbox', checked: Boolean(f.avoidable), onchange: (e) => set('avoidable', e.target.checked) }), 'Avoidable only'),
      h('label', { class: 'row', style: { gap: '6px', cursor: 'pointer' } }, h('input', { type: 'checkbox', checked: Boolean(f.first), onchange: (e) => set('first', e.target.checked) }), 'First deaths only'),
      Object.values(f).some(Boolean) ? button('Clear filters', () => { ui.filter = {}; app.refresh(); }, { kind: 'link' }) : null),
    shown.length ? h('div', { class: 'muted' }, `${shown.length} deaths · ${percent(avoidableShare)} avoidable${topCause ? ` · most often ${topCause[0]} (${topCause[1]})` : ''}`) : null,
    h('div', { class: 'split' }, h('div', { class: 'list-column' }, list), h('div', { class: 'grow', style: { minWidth: 0 } }, detail(app, selected)))));
}

function detail(app, entry) {
  if (!entry) return panel({}, sectionTitle('Pick a death'), h('div', { class: 'muted' }, 'Select a death on the left to watch the seconds before it.'));
  const { match, run, death } = entry;
  const clip = app.clipFor?.(match.id, death.timestamp, 'death');
  const video = match.video && !match.video.deletedAt ? match.video.path : null;
  let player = h('div', { class: 'muted', style: { padding: '30px 0' } }, 'No video for this death: the recording was removed before death clips were kept.');
  let caption = '';
  if (clip || video) {
    const el = h('video', { class: 'video', controls: true, preload: 'auto', src: app.media(clip ?? video) });
    el.addEventListener('loadedmetadata', () => { el.currentTime = clip ? 0 : Math.max(0, death.timestamp - 10); el.play().catch(() => {}); }, { once: true });
    player = el;
    caption = clip ? `Clip: 10 s before the death at ${formatTimestamp(death.timestamp)} to 3 s after.` : `Full recording, from 10 s before the death at ${formatTimestamp(death.timestamp)}.`;
  }
  return panel({ accent: 'var(--warning)' }, player, caption ? h('div', { class: 'caption' }, caption) : null,
    h('div', { class: 'row' }, tag(death.cause, death.avoidable === 'yes' ? 'var(--danger)' : 'var(--text-2)'),
      h('span', { class: 'caption grow' }, `Avoidable: ${death.avoidable}${death.isFirstDeathOfFight ? ' · first death of the fight' : ''}`),
      button('Open match report', () => app.showMatch(match.id))),
    killerPicker(app, run, death),
    h('div', { class: 'stack', style: { gap: '2px' } }, h('div', { class: 'overline' }, 'What to do instead'), h('div', {}, death.whatToDoInstead)));
}
