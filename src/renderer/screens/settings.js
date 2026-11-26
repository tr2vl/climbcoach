// Settings: how you play, your keys, reports, Gemini usage, studying, clips, storage and updates.
import { heroName, rankText, roleName } from '../../shared/catalog.js';
import { button, h, icon, panel, screen, sectionTitle } from '../ui.js';

const PLATFORMS = { battlenet: 'Battle.net on this PC', steam: 'Steam on this PC', geforcenow: 'GeForce NOW', xcloud: 'Xbox Cloud Gaming', console: 'PlayStation, Xbox or Switch' };
const REGIONS = { americas: 'Americas', europe: 'Europe', asia: 'Asia' };

export function settingsScreen(app) {
  const profile = app.settings.profile;
  const prefs = app.settings.prefs ?? {};
  const ui = app.ui.settings ?? (app.ui.settings = {});
  if (!ui.loaded) {
    ui.loaded = true;
    Promise.all([app.climb.keys.status(), app.climb.usage?.()]).then(([keys, usage]) => { ui.keys = keys; ui.usage = usage; app.refresh(); });
  }
  const savePrefs = async (patch) => { app.settings = await app.climb.settings.update({ prefs: { ...prefs, ...patch } }); app.refresh(); };
  const rerun = async () => { app.settings = await app.climb.settings.update({ onboardingDone: false }); app.refresh(); };
  const toggle = (label, detail, value, onchange) => h('label', { class: 'row top', style: { cursor: 'pointer' } },
    h('input', { type: 'checkbox', checked: value, onchange: (e) => onchange(e.target.checked), style: { marginTop: '4px' } }),
    h('div', {}, h('div', {}, label), detail ? h('div', { class: 'caption' }, detail) : null));
  const update = app.update ?? {};
  return screen('Settings', 'How you play, your keys, updates and storage.',
    panel({}, sectionTitle('How you play', button('Change in get started', rerun)),
      row('Platform', PLATFORMS[profile.platform] ?? 'Not set'),
      row('Region', REGIONS[profile.region] ?? 'Not set'),
      row('In-game name', profile.inGameName || 'Not set'),
      profile.roles.map((r) => h('div', { class: 'row top' }, h('div', { class: 'overline', style: { width: '130px', paddingTop: '2px' } }, roleName(r.role)),
        h('div', {}, h('div', { class: 'heading' }, rankText(r.rank)), h('div', { class: 'muted' }, r.heroKeys.map(heroName).join(', ') || 'No heroes picked'))))),
    panel({}, sectionTitle('Your API keys'),
      ['gemini', 'youtube'].map((kind) => keyRow(app, kind)),
      h('div', { class: 'caption' }, 'Stored on this PC only, encrypted with your Windows account. ClimbCoach never sends them anywhere except to Google with your own requests.')),
    panel({}, sectionTitle('Reports'),
      toggle('Only Gemini 4 Hydrogen writes reports', 'Best judgment first: when its free requests are used up, reports wait for the daily reset instead of using a weaker model. You can still start one with a weaker model from the match.',
        prefs.reportsBestModelOnly ?? true, (v) => savePrefs({ reportsBestModelOnly: v })),
      usageTable(ui.usage)),
    panel({}, sectionTitle('Recording and clips'),
      toggle('Record game sound', 'Includes everything you hear, voice chat too. Only with people who agree.', prefs.recordSound ?? true, (v) => savePrefs({ recordSound: v })),
      toggle('Keep short clips of every reviewed death and habit moment', 'The Death Reel and habit reel play these after the full recording is gone. About 10 MB per clip.', prefs.keepClips ?? true, (v) => savePrefs({ keepClips: v })),
      h('div', { class: 'row' }, h('span', { class: 'grow' }, 'Keep the full recordings of your last'),
        h('select', { class: 'input', style: { width: '160px' }, 'aria-label': 'Recordings to keep', onchange: (e) => savePrefs({ keepRecordings: Number(e.target.value) }) },
          [5, 10, 20, 50, 0].map((n) => h('option', { value: n, selected: (prefs.keepRecordings ?? 20) === n }, n ? `${n} matches` : 'All matches'))),
        app.climb.isDemo ? null : button('Open video folder', () => app.climb.openVideos?.())),
      h('div', { class: 'caption' }, 'Older recordings are deleted after their report is written; reports, clips and scoreboard pictures stay. An hour of 1080p recording takes about 2–4 GB.')),
    panel({}, sectionTitle('Updates'),
      h('div', { class: 'row' },
        h('div', { class: 'grow' }, h('div', { class: 'heading' }, `ClimbCoach ${app.info.version}`), h('div', { class: 'muted' }, updateText(update))),
        update.state === 'ready' ? button('Restart and update', () => app.climb.updates.install(), { kind: 'accent' })
          : button('Check now', async () => { app.update = await app.climb.updates.check(); app.refresh(); })),
      h('div', { class: 'caption' }, 'Updates download by themselves in the background and install the next time ClimbCoach starts. Your matches, keys and settings stay as they are.')),
    panel({}, sectionTitle('Privacy'),
      h('div', { class: 'muted', style: { fontSize: '13px' } }, 'Your matches, reports and notes stay on this PC. For a report, your match video is uploaded to Google\'s Gemini API with your own key and deleted by Google after 48 hours; on the free tier Google may use it to improve its products. Learn sends YouTube searches with your own key. Hero stats come from the community OverFast API without any data about you.')));
}

const row = (label, value) => h('div', { class: 'row' }, h('div', { class: 'overline', style: { width: '130px' } }, label), h('div', {}, value));

function keyRow(app, kind) {
  const ui = app.ui.settings;
  const saved = ui.keys?.[kind];
  const editing = ui.editKey === kind;
  const label = kind === 'gemini' ? 'Gemini API key' : 'YouTube Data API key';
  const help = kind === 'gemini' ? 'Needed for reports · aistudio.google.com/apikey' : 'Optional, for guides in Learn';
  return h('div', { class: 'stack', style: { gap: '6px' } },
    h('div', { class: 'row' },
      h('div', { style: { color: saved ? 'var(--success)' : 'var(--text-2)' } }, icon(saved ? 'check' : 'key', 18)),
      h('div', { class: 'grow' }, h('div', { class: 'heading' }, label), h('div', { class: 'caption' }, help)),
      h('span', { class: saved ? '' : 'muted' }, saved ? 'Saved' : 'Not set'),
      button(editing ? 'Cancel' : saved ? 'Replace' : 'Add', () => { ui.editKey = editing ? null : kind; ui.keyValue = ''; ui.keyResult = null; app.refresh(); })),
    editing ? h('div', { class: 'row' },
      h('input', { class: 'input mono grow', type: 'password', placeholder: 'Paste your key', oninput: (e) => { ui.keyValue = e.target.value.trim(); } }),
      button('Test and save', async () => {
        ui.keyResult = await app.climb.keys.test(kind, ui.keyValue);
        if (ui.keyResult.ok) { ui.keys = await app.climb.keys.save(kind, ui.keyValue); ui.editKey = null; app.toast(ui.keyResult.message); }
        app.refresh();
      }, { kind: 'accent' })) : null,
    editing && ui.keyResult && !ui.keyResult.ok ? h('div', { class: 'message bad' }, ui.keyResult.message) : null);
}

function usageTable(usage) {
  if (!usage?.today?.length) return h('div', { class: 'caption' }, 'No Gemini requests yet today (days follow Google\'s quota day, Pacific time).');
  return [h('table', { class: 'table' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Model, today'), h('th', {}, 'Requests'), h('th', {}, 'Tokens in / out'), h('th', {}, 'Last limit'))),
    h('tbody', {}, usage.today.map((e) => h('tr', {}, h('td', {}, e.model),
      h('td', {}, String(e.requests), e.unanswered ? h('div', { class: 'caption' }, `+${e.unanswered} unanswered`) : null),
      h('td', {}, `${Math.round(e.inputTokens / 1000)}k / ${Math.round(e.outputTokens / 1000)}k`),
      h('td', { class: 'caption' }, e.busyUntil
        ? `Too busy to answer · asked again from ${new Date(e.busyUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
        : e.lastLimit ?? '–'))))),
  usage.bestLeft != null ? h('div', { class: 'caption' }, `Gemini 4 Hydrogen: about ${usage.bestLeft} free requests left today (${Math.floor(usage.bestLeft / 5)} reports).`) : null,
  usage.today.some((e) => e.unanswered) ? h('div', { class: 'caption' }, '"Unanswered" are requests a model was too busy to answer. Google may count them against the day\'s limit too, so ClimbCoach leaves a busy model alone for 20 minutes instead of asking again and again.') : null];
}

function updateText(update) {
  switch (update.state) {
    case 'checking': return 'Checking for updates…';
    case 'downloading': return `Downloading version ${update.version ?? ''} (${update.progress ?? 0} %)…`;
    case 'ready': return `Version ${update.version} is downloaded and installs when you restart.`;
    case 'current': return 'You have the newest version.';
    case 'error': return `Couldn't check for updates: ${update.error}`;
    case 'dev': return 'Development build: updates are off.';
    default: return 'Checks for updates when ClimbCoach starts and every 4 hours.';
  }
}
