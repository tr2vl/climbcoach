// Learn: your most common mistakes with fixes from guides, the daily auto-study, studied guides, and search.
import { heroName } from '../../shared/catalog.js';
import { categoryName, formatTimestamp } from '../../shared/rubric.js';
import { coachSays } from '../coach.js';
import { button, h, icon, panel, screen, sectionTitle, tag } from '../ui.js';

const watch = (id, seconds) => `https://www.youtube.com/watch?v=${id}${seconds ? `&t=${Math.floor(seconds)}s` : ''}`;

export function learnScreen(app) {
  const ui = app.ui.learn ?? (app.ui.learn = {});
  const view = app.learn;
  const keys = app.ui.keyStatus;
  if (!keys) app.climb.keys.status().then((status) => { app.ui.keyStatus = status; app.refresh(); });
  const studied = [...(app.data.learnVideos ?? [])].filter((v) => v.insights?.length).sort((a, b) => new Date(b.fetchedAt) - new Date(a.fetchedAt));
  const filter = ui.filter ?? 'all';
  const heroes = [...new Set(studied.map((v) => v.heroKey).filter(Boolean))];
  const shown = studied.filter((v) => filter === 'all' || (filter === 'weak' ? v.category : v.heroKey === filter));
  return screen('Learn', 'ClimbCoach finds your most common mistakes, studies guides that fix them and guides for every hero you play, and tells you how to fix each one.',
    keys && (!keys.youtube || !keys.gemini) ? panel({ accent: 'var(--warning)' }, h('div', { class: 'row' },
      h('span', { class: 'grow' }, !keys.youtube && !keys.gemini ? 'Add your YouTube Data API key (to find guides) and your Gemini key (to study them) in Settings.'
        : !keys.youtube ? 'Add your YouTube Data API key in Settings so ClimbCoach can find guides.' : 'Add your Gemini key in Settings so ClimbCoach can study guides.'),
      button('Open Settings', () => app.navigate('settings')))) : null,
    mistakesPanel(app),
    autoStudyPanel(app),
    studied.length ? [
      h('div', { class: 'segmented' },
        [['all', `All guides (${studied.length})`], ['weak', 'Mistakes & weak spots'], ...heroes.map((k) => [k, heroName(k)])].map(([key, label]) =>
          h('button', { class: filter === key ? 'on' : '', onclick: () => { ui.filter = key; app.refresh(); } }, label))),
      shown.map((video) => studiedPanel(app, video)),
    ] : panel({}, h('div', { class: 'muted' }, view.status?.kind === 'studying' || view.status?.kind === 'searching'
      ? 'The first guides appear here as soon as Gemini has watched them.' : 'No guides studied yet. Press "Study now" above, or wait for the daily batch.')),
    searchPanel(app),
    h('div', { class: 'caption' }, 'Search: YouTube Data API (each daily batch uses a few hundred of your 10,000 free daily units). Studying: Gemini watches public YouTube videos (up to 25 minutes per guide) on the Flash models, so your best-model requests stay for match reports. Saved YouTube titles are refreshed or removed after 30 days, as YouTube\'s rules require.'));
}

function mistakesPanel(app) {
  const view = app.learn;
  const patterns = view.mistakes?.patterns ?? [];
  return panel({ accent: 'var(--orange)' },
    sectionTitle('Your most common mistakes', view.findingMistakes ? h('span', { class: 'caption' }, 'Grouping your mistakes…') : null),
    patterns.length ? patterns.map((p) => h('div', { class: 'finding', style: { flexDirection: 'column', gap: '6px' } },
      h('div', { class: 'row' }, h('span', { class: 'heading grow', style: { fontSize: '17px' } }, p.title), tag(categoryName(p.category), 'var(--text-2)'),
        h('span', { class: 'caption' }, `${p.matches} of ${p.outOf} matches`)),
      p.examples.map((e) => h('div', { class: 'caption' }, `${e.place} at ${formatTimestamp(e.timestamp)}: ${e.evidence}`)),
      p.fix ? h('div', { class: 'stack', style: { gap: '4px', marginTop: '4px' } },
        h('div', { class: 'overline', style: { color: 'var(--success)' } }, 'How to fix it'),
        h('div', {}, p.fix.summary),
        h('ol', { class: 'steps-list' }, p.fix.steps.map((s) => h('li', {}, h('span', {}, s)))),
        p.fix.check ? h('div', { class: 'row', style: { gap: '6px', color: 'var(--blue)' } }, icon('check', 14), h('span', {}, `Next match, check: ${p.fix.check}`)) : null,
        h('div', { class: 'caption' }, 'From ', h('a', { href: watch(p.fix.videoID), target: '_blank', style: { color: 'var(--orange)' } }, p.fix.videoTitle)))
        : h('div', { class: 'row' }, h('span', { class: 'caption grow' }, 'No fix yet. The daily batch studies a guide for it, or:'),
          button('Find a fix now', () => app.climb.learn.findFix(p.id).catch((e) => app.toast(e.message))))))
      : h('div', { class: 'muted' }, 'Common mistakes appear once the same mistake shows up in 2 or more of your analysed matches.'),
    view.mistakes?.source === 'local' && patterns.length ? h('div', { class: 'caption' }, 'Grouped by category on this PC; Gemini groups them more precisely once your key works.') : null);
}

function autoStudyPanel(app) {
  const status = app.learn.status ?? { kind: 'idle' };
  const prefs = app.settings.prefs ?? {};
  const enabled = prefs.learnAutoStudy ?? true;
  const perDay = prefs.learnGuidesPerDay ?? 3;
  const text = {
    idle: app.learn.lastRun ? `Last batch: ${new Date(app.learn.lastRun).toLocaleString()}.` : 'No batch yet.',
    searching: `Searching YouTube: ${status.topic}…`,
    studying: `Studying "${status.video}" for ${status.topic} (${(status.done ?? 0) + 1} of ${status.budget})…`,
    finished: `Studied ${status.studied} guide${status.studied === 1 ? '' : 's'} at ${status.at ? new Date(status.at).toLocaleTimeString() : ''}.`,
    stopped: status.message,
  }[status.kind] ?? '';
  const busy = status.kind === 'searching' || status.kind === 'studying';
  const save = async (patch) => { app.settings = await app.climb.settings.update({ prefs: { ...prefs, ...patch } }); app.refresh(); };
  return panel({ accent: 'var(--blue)' }, sectionTitle('Daily study'),
    coachSays(busy ? 'thinking' : 'idle', 64, h('div', {}, text)),
    h('div', { class: 'row', style: { flexWrap: 'wrap' } },
      button(busy ? 'Studying…' : 'Study now', () => app.climb.learn.autoStudy().catch((e) => app.toast(e.message)), { kind: 'accent', disabled: busy }),
      h('label', { class: 'row', style: { gap: '6px', cursor: 'pointer' } }, h('input', { type: 'checkbox', checked: enabled, onchange: (e) => save({ learnAutoStudy: e.target.checked }) }), 'Study guides by myself once a day'),
      h('select', { class: 'input', style: { width: '150px' }, 'aria-label': 'Guides per day', onchange: (e) => save({ learnGuidesPerDay: Number(e.target.value) }) },
        [1, 2, 3, 4, 5].map((n) => h('option', { value: n, selected: n === perDay }, `${n} guide${n === 1 ? '' : 's'} a day`)))),
    h('div', { class: 'caption' }, 'Order: your most common mistakes first, then every hero you play. A topic rests a week (a hero two weeks) after it got a guide.'));
}

function studiedPanel(app, video) {
  return panel({}, h('div', { class: 'row' },
    h('div', { class: 'grow' }, h('div', { class: 'heading' }, video.title), h('div', { class: 'caption' }, [video.channelTitle, video.heroKey ? heroName(video.heroKey) : null, video.category ? categoryName(video.category) : null].filter(Boolean).join(' · '))),
    button('Watch on YouTube', () => app.climb.open(watch(video.youtubeID)))),
  video.insights.map((i) => h('div', { class: 'finding', style: { flexDirection: 'column', gap: '4px' } },
    h('div', { class: 'row', style: { gap: '8px' } },
      h('a', { class: 'timestamp', href: watch(video.youtubeID, i.timestamp), target: '_blank' }, formatTimestamp(i.timestamp)),
      h('span', { class: 'caption', style: { fontWeight: 600 } }, categoryName(i.category))),
    h('div', {}, h('b', {}, 'They: '), i.whatTheyDo),
    i.whatYouDo ? h('div', { class: 'muted' }, h('b', {}, 'You: '), i.whatYouDo) : null,
    h('div', { style: { color: 'var(--blue)' } }, h('b', {}, 'Try: '), i.howToAdapt))));
}

function searchPanel(app) {
  const ui = app.ui.learn;
  const results = app.learn.results ?? [];
  const studied = new Set((app.data.learnVideos ?? []).map((v) => v.youtubeID));
  const run = () => ui.query?.trim() && app.climb.learn.search(ui.query.trim()).catch((e) => app.toast(e.message));
  return h('details', { open: ui.searchOpen ?? false, ontoggle: (e) => { ui.searchOpen = e.target.open; } },
    h('summary', { style: { fontSize: '14px' } }, 'Search YouTube yourself'),
    h('div', { class: 'stack', style: { marginTop: '12px' } },
      h('div', { class: 'row' },
        h('input', { class: 'input grow', placeholder: 'e.g. Cassidy positioning guide', value: ui.query ?? '', oninput: (e) => { ui.query = e.target.value; },
          onkeydown: (e) => { if (e.key === 'Enter') run(); } }),
        button('Search', run, { kind: 'accent' })),
      results.map((video) => h('div', { class: 'row', style: { padding: '6px 0' } },
        video.thumbnail ? h('img', { src: video.thumbnail, alt: '', style: { width: '120px', aspectRatio: '16 / 9', objectFit: 'cover' } }) : null,
        h('div', { class: 'grow' }, h('div', { class: 'heading' }, video.title), h('div', { class: 'caption' }, video.channelTitle)),
        studied.has(video.id) ? h('span', { class: 'caption' }, 'Studied')
          : button(app.learn.studying?.includes(video.id) ? 'Studying…' : 'Study', () => app.climb.learn.study(video).catch((e) => app.toast(e.message)), { disabled: app.learn.studying?.includes(video.id) })))));
}
