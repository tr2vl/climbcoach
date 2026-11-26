// The window: title bar, navigation rail, screens, get started, the tour and the update notice.
import { rankText } from '../shared/catalog.js';
import { captureController } from './capture.js';
import { getStarted } from './getstarted.js';
import { screens } from './screens/index.js';
import { startTour } from './tour.js';
import { brandMark, h, icon } from './ui.js';

const NAV = [
  { group: 'Play', items: [
    { key: 'dashboard', title: 'Dashboard', shortcut: '1' },
    { key: 'importMatch', title: 'Import', shortcut: '2' },
    { key: 'reports', title: 'Match Reports', shortcut: '3' },
    { key: 'progress', title: 'Progress', shortcut: '4' },
    { key: 'deaths', title: 'Death Reel', shortcut: '5' },
  ] },
  { group: 'Intel', items: [
    { key: 'meta', title: 'Heroes & Meta', shortcut: '6' },
    { key: 'maps', title: 'Maps', shortcut: '7' },
    { key: 'learn', title: 'Learn', shortcut: '8' },
    { key: 'practice', title: 'Training', shortcut: '9' },
  ] },
];
const SETTINGS = { key: 'settings', title: 'Settings', shortcut: ',' };
const ALL = [...NAV.flatMap((group) => group.items), SETTINGS];

/** The demo draws Windows' minimise, maximise and close buttons; in the real app Windows draws them. */
function captionButtons() {
  const glyph = (d) => h('svg', { width: 10, height: 10, viewBox: '0 0 10 10', fill: 'none', stroke: 'currentColor', 'stroke-width': 1 }, h('path', { d }));
  return h('div', { class: 'caption-buttons', 'aria-hidden': 'true' },
    h('span', {}, glyph('M0 5.5h10')), h('span', {}, glyph('M.5.5h9v9h-9z')), h('span', { class: 'close' }, glyph('M0 0l10 10M10 0 0 10')));
}

export async function start(climb) {
  const app = {
    climb,
    settings: await climb.settings.get(),
    info: await climb.info(),
    selection: 'dashboard',
    update: await climb.updates.status(),
    data: await climb.data.snapshot(),
    analysis: await climb.analysis.status(),
    learn: await climb.learn.view(),
    meta: await climb.meta.view(),
    trainingUpdate: null,
    recordingStatus: (await climb.recording?.status?.()) ?? { state: 'idle' },
    /** The kept clip of a death or habit moment, when there is one. */
    clipFor(matchID, timestamp, kind) {
      const name = `${kind}-${Math.round(timestamp * 10)}.mp4`;
      if (!app.data.clips?.[matchID]?.includes(name)) return null;
      const sep = app.data.clipFolder?.includes('\\') ? '\\' : '/';
      return `${app.data.clipFolder}${sep}${matchID}${sep}${name}`;
    },
    /** Per-screen state that survives redraws (selected match, filters, …). */
    ui: {},
    navigate(key) { app.selection = key; renderShell(); },
    refresh() { renderShell(); },
    /** A short message at the bottom of the window. */
    toast(text) {
      document.querySelectorAll('.toast').forEach((node) => node.remove());
      const node = h('div', { class: 'toast', role: 'status' }, text);
      document.body.append(node);
      setTimeout(() => node.remove(), 4500);
    },
    showMatch(id) { app.ui.reports = { ...(app.ui.reports ?? {}), selected: id }; app.navigate('reports'); },
    media: (file) => (climb.isDemo ? file : `media://local/${encodeURIComponent(file)}`),
    async perform(action) {
      if (action.kind === 'study') { app.ui.learn = { ...(app.ui.learn ?? {}), query: action.query, searchOpen: true }; app.navigate('learn'); climb.learn.search(action.query).catch(() => {}); }
      if (action.kind === 'reanalyse') { await climb.analysis.start(action.matchID, { mode: 'lean' }).catch(() => {}); app.showMatch(action.matchID); }
      if (action.kind === 'openTraining') app.navigate('practice');
      if (action.kind === 'openHabitReel') { app.ui.reel = { filter: 'misses' }; app.navigate('practice'); }
    },
  };
  // Recording: in the Windows app the window captures the game; the demo pretends.
  if (!climb.isDemo && climb.recording) {
    const capture = captureController(climb);
    app.rec = { pick: () => climb.recording.pick(), cancel: () => climb.recording.cancel(), dismiss: () => climb.recording.dismiss(), start: capture.start, stop: capture.stop };
  } else {
    app.rec = climb.recording;
  }
  const body = document.body;
  body.append(h('div', { class: 'backdrop' }));
  const titlebar = h('header', { class: 'titlebar' });
  const host = h('div');
  body.append(titlebar, host);

  climb.updates.onChange((status) => { app.update = status; renderTitlebar(); });
  let dirty = false;
  /** Redraws the screen for new data, unless you're typing in it (then it waits until you leave the field). */
  const dataChanged = () => {
    const active = document.activeElement;
    if (active && host.contains(active) && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) { dirty = true; return; }
    renderShell({ quiet: true });
  };
  document.addEventListener('focusout', () => { if (dirty) { dirty = false; setTimeout(() => renderShell({ quiet: true }), 0); } });
  climb.data.onChange(async () => { app.data = await climb.data.snapshot(); dataChanged(); });
  climb.analysis.onChange((status) => { app.analysis = status; dataChanged(); });
  climb.learn.onChange((view) => { app.learn = view; dataChanged(); });
  climb.meta.onChange((view) => { app.meta = view; dataChanged(); });
  climb.training.onUpdate((update) => { app.trainingUpdate = update; dataChanged(); });
  climb.recording?.onChange((status) => { app.recordingStatus = status; renderShell({ quiet: true }); });

  function renderTitlebar() {
    const update = app.update;
    titlebar.replaceChildren(...[
      brandMark(16),
      h('span', {}, 'ClimbCoach'),
      update?.state === 'ready'
        ? h('button', { class: 'update-pill', onclick: () => climb.updates.install(), title: 'ClimbCoach restarts and opens again on the new version' },
          icon('download', 13), `Update ${update.version} ready · restart`)
        : update?.state === 'downloading' ? h('span', { class: 'caption' }, `Downloading update ${update.version ?? ''}… ${update.progress ?? 0} %`) : null,
      climb.isDemo && app.settings.onboardingDone ? h('button', { class: 'btn', style: { marginLeft: 'auto', padding: '2px 10px', fontSize: '12px', WebkitAppRegion: 'no-drag' },
        onclick: () => { climb.fillSample(); renderTitlebar(); } }, climb.hasSample() ? 'Demo · sample data shown (made up)' : 'Demo · fill with sample matches') : null,
      climb.isDemo ? h('button', { class: 'btn', style: { marginLeft: app.settings.onboardingDone ? '6px' : 'auto', padding: '2px 10px', fontSize: '12px', WebkitAppRegion: 'no-drag' },
        onclick: () => climb.restart() }, 'Demo · start over') : null,
      climb.isDemo ? captionButtons() : null,
    ].filter(Boolean));
  }

  function renderShell({ quiet = false } = {}) {
    if (!app.settings.onboardingDone) {
      if (quiet) return;
      host.replaceChildren(getStarted({ climb, settings: app.settings, onFinish: (settings, withTour) => {
        app.settings = settings;
        app.selection = 'dashboard';
        renderTitlebar();
        renderShell();
        if (withTour) startTour(app);
      } }));
      return;
    }
    // A redraw for new data keeps your scroll position and doesn't replay the panels' entrance.
    const previous = host.querySelector('.screen');
    const scroll = quiet && previous ? previous.scrollTop : 0;
    const content = screens[app.selection]?.(app) ?? h('div');
    host.classList.toggle('quiet', quiet);
    host.replaceChildren(h('div', { class: 'shell' }, rail(), content));
    if (scroll) host.querySelector('.screen')?.scrollTo(0, scroll);
  }

  function rail() {
    const profile = app.settings.profile;
    const name = profile.inGameName?.trim() || 'Set your name';
    const ranked = profile.roles.filter((role) => role.rank);
    const short = { tank: 'TANK', damage: 'DPS', support: 'SUP' };
    const navButton = (item) => h('button', {
      class: `nav ${item.key === app.selection ? 'selected' : ''}`, 'data-tour': item.key,
      'aria-current': item.key === app.selection ? 'page' : null, onclick: () => app.navigate(item.key),
    }, icon(item.key), h('span', { class: 'label' }, item.title), h('span', { class: 'shortcut' }, `Ctrl+${item.shortcut}`));
    return h('nav', { class: 'rail', 'aria-label': 'Navigation' },
      h('div', { class: 'brand' }, brandMark(30), h('div', {},
        h('div', { class: 'wordmark' }, 'CLIMB', h('b', {}, 'COACH')), h('div', { class: 'tagline' }, 'REVIEW · SCORE · CLIMB'))),
      NAV.map((group) => [
        h('div', { class: 'rail-group' }, group.group.toUpperCase()),
        group.items.map(navButton),
        h('div', { class: 'rail-gap' }),
      ]),
      h('div', { class: 'rail-spacer' }),
      navButton(SETTINGS),
      h('button', { class: 'profile-chip panel', style: { padding: '10px' }, onclick: () => app.navigate('settings'), 'data-tour': 'profile' },
        h('div', { class: 'stack', style: { gap: 0 } }, h('div', { class: 'row', style: { gap: '10px' } },
          h('div', { class: 'avatar-letter' }, name.charAt(0).toUpperCase()),
          h('div', { class: 'grow' },
            h('div', { class: 'name' }, name),
            ranked.length ? ranked.map((role) => h('div', { class: 'ranks' }, `${short[role.role]} · ${rankText(role.rank)}`))
              : h('div', { class: 'ranks' }, 'No ranks set'))))));
  }

  window.addEventListener('keydown', (event) => {
    if (!event.ctrlKey || !app.settings.onboardingDone) return;
    const item = ALL.find((candidate) => candidate.shortcut === event.key);
    if (item) {
      event.preventDefault();
      app.navigate(item.key);
    }
  });

  renderTitlebar();
  renderShell();
  return app;
}
