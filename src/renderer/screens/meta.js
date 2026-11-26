// Heroes & Meta: what wins at your rank right now, next to how you do on your heroes. And Maps.
import { HEROES, MAPS, hero, heroName, modeName, RANK_TIERS, capitalize } from '../../shared/catalog.js';
import { byHero, byMap, summaries } from '../../shared/progress.js';
import { kitChangeSummary, queryKey, queryLabel, shifts } from '../../shared/meta.js';
import { percent, scoreColor } from '../components.js';
import { button, h, icon, panel, screen, sectionTitle } from '../ui.js';

const PATCH_NOTES = 'https://overwatch.blizzard.com/en-us/news/patch-notes/';

export function metaScreen(app) {
  const ui = app.ui.meta ?? (app.ui.meta = {});
  const query = ui.query ?? app.meta.defaultQuery ?? { division: null, region: 'europe', platform: 'pc', gamemode: 'competitive' };
  const snapshots = (app.data.heroStats ?? []).filter((s) => s.query === queryKey(query)).sort((a, b) => new Date(a.fetchedAt) - new Date(b.fetchedAt));
  const latest = snapshots.at(-1);
  const myRoles = app.settings.profile.roles.map((r) => r.role);
  const myHeroes = new Set(app.settings.profile.roles.flatMap((r) => r.heroKeys));
  const mine = new Map(byHero(summaries(app.data.matches)).map((g) => [g.key, g]));
  const role = ui.role ?? myRoles[0] ?? 'damage';
  const setQuery = (patch) => { ui.query = { ...query, ...patch }; app.refresh(); app.climb.meta.refresh(ui.query); };
  const rows = latest ? Object.entries(latest.stats).filter(([key]) => hero(key)?.role === role).sort((a, b) => b[1].winrate - a[1].winrate) : [];
  const radar = shifts(snapshots.map((s) => ({ date: s.fetchedAt, stats: s.stats })), [...myHeroes]).filter((s) => s.kind !== 'steady');
  return screen('Heroes & Meta', 'What wins at your rank right now, next to how you do on your heroes.',
    panel({}, sectionTitle('Rank bracket', h('span', { class: 'caption' }, latest ? `Updated ${new Date(latest.fetchedAt).toLocaleString()}` : '')),
      h('div', { class: 'row', style: { flexWrap: 'wrap' } },
        h('select', { class: 'input', style: { width: '160px' }, 'aria-label': 'Rank', onchange: (e) => setQuery({ division: e.target.value || null }) },
          h('option', { value: '' }, 'All ranks'), RANK_TIERS.filter((t) => t !== 'champion').map((t) => h('option', { value: t, selected: query.division === t }, capitalize(t)))),
        h('select', { class: 'input', style: { width: '140px' }, 'aria-label': 'Region', onchange: (e) => setQuery({ region: e.target.value }) },
          ['americas', 'europe', 'asia'].map((r) => h('option', { value: r, selected: query.region === r }, capitalize(r)))),
        h('select', { class: 'input', style: { width: '120px' }, 'aria-label': 'Platform', onchange: (e) => setQuery({ platform: e.target.value }) },
          [['pc', 'PC'], ['console', 'Console']].map(([v, t]) => h('option', { value: v, selected: query.platform === v }, t))),
        button(app.meta.refreshing ? 'Loading…' : 'Refresh', () => app.climb.meta.refresh(query), { disabled: app.meta.refreshing }),
        h('div', { class: 'grow' }),
        h('div', { class: 'segmented' }, ['tank', 'damage', 'support'].map((r) => h('button', { class: r === role ? 'on' : '', onclick: () => { ui.role = r; app.refresh(); } }, capitalize(r))))),
      app.meta.error ? h('div', { class: 'message bad' }, app.meta.error) : null,
      h('div', { class: 'caption' }, `${queryLabel(query)} · win, pick and ban rates from the community OverFast API (built from Blizzard's public pages; no key needed).`)),
    latest ? panel({}, sectionTitle(`${capitalize(role)} heroes at ${query.division ? capitalize(query.division) : 'all ranks'}`),
      h('table', { class: 'table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Hero'), h('th', {}, 'Win rate'), h('th', {}, 'Pick rate'), h('th', {}, 'Ban rate'), h('th', {}, 'Your matches'), h('th', {}, 'Your win rate'), h('th', {}, 'Your score'))),
        h('tbody', {}, rows.map(([key, s]) => {
          const g = mine.get(key);
          return h('tr', { class: myHeroes.has(key) ? 'mine' : '' }, h('td', { class: myHeroes.has(key) ? 'heading' : '' }, heroName(key)),
            h('td', {}, `${s.winrate.toFixed(1)} %`), h('td', {}, `${s.pickrate.toFixed(1)} %`), h('td', {}, s.banrate != null ? `${s.banrate.toFixed(1)} %` : '–'),
            h('td', {}, g?.matches ?? '–'), h('td', {}, g?.winRate != null ? percent(g.winRate) : '–'),
            h('td', { style: { color: scoreColor(g?.averageOverall) } }, g?.averageOverall != null ? g.averageOverall.toFixed(1) : '–'));
        }))),
      h('div', { class: 'caption' }, 'Highlighted: the heroes you play. Your columns come from your own analysed matches.'))
      : panel({}, h('div', { class: 'row', style: { padding: '12px 0' } }, h('span', { class: 'muted grow' }, `No hero stats loaded for ${queryLabel(query)} yet.`), button('Load them', () => app.climb.meta.refresh(query), { kind: 'accent' }))),
    panel({ accent: 'var(--warning)' }, sectionTitle('Patch radar · your heroes'),
      radar.length ? radar.map((s) => h('div', {}, `${s.winDelta < 0 ? '↘' : '↗'} ${heroName(s.heroKey)}: ${s.winDelta >= 0 ? '+' : ''}${s.winDelta.toFixed(1)} win-rate points since ${new Date(s.since).toLocaleDateString()}${s.kind === 'morePicked' || s.kind === 'lessPicked' ? `, pick rate ${s.pickBefore.toFixed(1)} → ${s.pickNow.toFixed(1)} %` : ''}`))
        : h('div', { class: 'muted' }, 'No big moves on your heroes. The radar compares today\'s rates with about a week ago, so it needs a few days of data.'),
      (app.meta.kitChanges ?? []).slice(0, 8).map((c) => h('div', { class: 'row', style: { gap: '6px' } }, icon('settings', 14), h('span', {}, kitChangeSummary(c)), h('span', { class: 'caption' }, new Date(c.detectedAt).toLocaleDateString()))),
      h('div', { class: 'row' }, h('span', { class: 'caption grow' }, 'Hero kits are checked daily for ability, perk and health changes. Patch notes aren\'t read automatically: Blizzard\'s website terms don\'t allow it.'),
        button('Official patch notes', () => app.climb.open(PATCH_NOTES)))));
}

export function mapsScreen(app) {
  const groups = new Map(byMap(summaries(app.data.matches)).map((g) => [g.key, g]));
  const ownMatches = app.data.matches.filter((m) => !m.isReference);
  const records = new Map();
  for (const m of ownMatches) {
    if (!m.mapKey) continue;
    const r = records.get(m.mapKey) ?? { wins: 0, losses: 0, matches: 0 };
    r.matches += 1;
    if (m.result === 'win') r.wins += 1;
    if (m.result === 'loss') r.losses += 1;
    records.set(m.mapKey, r);
  }
  const ui = app.ui.maps ?? (app.ui.maps = {});
  const maps = [...MAPS].sort((a, b) => ((records.get(b.key)?.matches ?? 0) - (records.get(a.key)?.matches ?? 0)) || a.name.localeCompare(b.name));
  const selected = MAPS.find((m) => m.key === ui.selected) ?? maps[0];
  const note = app.data.mapNotes?.[selected.key]?.text ?? '';
  return screen('Maps', 'Your record on every map, and notes you write for yourself before you queue.',
    h('div', { class: 'split' },
      h('div', { class: 'list-column' }, h('div', { class: 'list-panel', style: { maxHeight: 'calc(100vh - 220px)' } }, maps.map((map) => {
        const r = records.get(map.key);
        return h('button', { class: `match-row ${map.key === selected.key ? 'selected' : ''}`, onclick: () => { ui.selected = map.key; app.refresh(); } },
          h('div', { class: 'grow' }, h('div', { class: 'heading' }, map.name), h('div', { class: 'caption' }, map.modes.map(modeName).join(', '))),
          h('div', { class: 'caption', style: { textAlign: 'right' } }, r ? `${r.wins}W ${r.losses}L` : '–', app.data.mapNotes?.[map.key]?.text ? h('div', { style: { color: 'var(--orange)' } }, 'Note') : null));
      }))),
      h('div', { class: 'grow stack', style: { gap: '18px', minWidth: 0 } },
        panel({ accent: 'var(--orange)' }, sectionTitle(selected.name),
          (() => {
            const r = records.get(selected.key);
            const g = groups.get(selected.key);
            return h('div', { class: 'muted' }, r ? `${r.matches} matches · ${r.wins} wins · ${r.losses} losses${r.wins + r.losses ? ` · ${percent(r.wins / (r.wins + r.losses))} win rate` : ''}${g?.averageOverall != null ? ` · average score ${g.averageOverall.toFixed(1)}` : ''}` : 'You haven\'t played this map in a recorded match yet.');
          })()),
        panel({}, sectionTitle('Your notes', h('span', { class: 'caption' }, 'Saved when you leave the field')),
          h('textarea', { class: 'input', style: { minHeight: '180px' }, placeholder: 'Where to stand on first point, the flank route that keeps killing you, the high ground to take…',
            onchange: (e) => app.climb.maps.note(selected.key, e.target.value) }, note)))));
}

export { HEROES };
