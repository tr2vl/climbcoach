// Recording a match: pick the game window, play, and the report follows after the end screen.
import { coachAvatar } from '../coach.js';
import { button, h, icon, panel, sectionTitle } from '../ui.js';
import { formatTimestamp } from '../../shared/rubric.js';

const WINDOW_NAMES = { battlenet: 'Overwatch', steam: 'Overwatch', geforcenow: 'GeForce NOW', xcloud: 'browser' };

export function recordPanel(app) {
  const profile = app.settings.profile;
  const status = app.recordingStatus ?? { state: 'idle' };
  const left = app.analysis.reportsLeft;
  const quota = h('span', { class: 'caption' }, left != null ? `Free best-model reports left today: ${left}` : '');
  if (profile.platform === 'console') {
    return panel({ accent: 'var(--orange)' }, sectionTitle('Your next match'),
      h('div', { class: 'muted' }, 'You play on a console, so matches come in as video files. Capture the whole match with your console or a capture card, press Tab near the end, then import the video.'),
      h('div', { class: 'row' }, h('button', { class: 'btn accent', 'data-tour': 'record', onclick: () => app.navigate('importMatch') }, 'Import a match'), quota));
  }
  const windowName = WINDOW_NAMES[profile.platform] ?? 'Overwatch';
  const recording = app.rec;
  switch (status.state) {
    case 'picking': return pickPanel(app, windowName);
    case 'recording': return livePanel(app, status);
    case 'finishing':
    case 'preparing':
      return panel({ accent: 'var(--orange)' }, sectionTitle('Live match'),
        h('div', { class: 'row' }, coachAvatar('thinking', 56), h('div', { class: 'stack grow', style: { gap: '6px' } },
          h('div', { class: 'meter' }, h('div', { style: { width: `${Math.round((status.progress ?? 0) * 100)}%`, background: 'var(--orange)' } })),
          h('div', { class: 'caption' }, status.state === 'finishing' ? 'Finishing the video file…'
            : status.step === 'cutting' ? 'Cutting the recording to the match…' : 'Finding the match in your recording, reading map, hero, result and scoreboard…'))));
    case 'failed':
      return panel({ accent: 'var(--danger)' }, sectionTitle('Live match'),
        h('div', { class: 'row top' }, coachAvatar('puzzled', 56), h('div', { class: 'stack grow', style: { gap: '6px' } },
          h('div', { class: 'heading', style: { color: 'var(--danger)' } }, 'Recording problem'), h('div', { class: 'muted' }, status.error ?? 'Unknown problem.'),
          h('div', {}, button('OK', () => recording?.dismiss())))));
    default:
      return panel({ accent: 'var(--orange)' }, sectionTitle('Live match'),
        h('div', { class: 'muted' }, `Start any time before the match. ClimbCoach records the ${windowName} window, stops at the end screen, and fills in map, hero, result and length by itself. Press Tab once near the end so your scoreboard is read too. Nothing appears in the game; the report comes after the match.`),
        h('div', { class: 'row' },
          h('button', { class: 'btn accent', 'data-tour': 'record', onclick: () => recording?.pick() ?? app.toast('Recording works in the Windows app.') }, icon('record', 16), 'Record a match'),
          quota));
  }
}

function pickPanel(app, windowName) {
  const status = app.recordingStatus;
  const sources = status.sources ?? [];
  const sound = app.ui.recordSound ?? app.settings.prefs?.recordSound ?? true;
  return panel({ accent: 'var(--orange)' }, sectionTitle(`Pick the ${windowName} window`, button('Cancel', () => app.rec.cancel(), { kind: 'link' })),
    sources.length ? h('div', { class: 'grid-2', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' } }, sources.map((source) => h('button', {
      class: 'option', onclick: () => app.rec.start(source.id, { sound, windowName: source.name, killFeed: Boolean(app.settings.profile.inGameName?.trim()) }),
    }, source.thumbnail ? h('img', { src: source.thumbnail, alt: '', style: { width: '100%', aspectRatio: '16 / 9', objectFit: 'cover', background: '#000' } }) : null,
    h('span', { class: 'option-title', style: { fontSize: '13px' } }, source.name))))
      : h('div', { class: 'muted' }, `No windows found. Start ${windowName} first, then press Refresh.`),
    h('div', { class: 'row' },
      button('Refresh', () => app.rec.pick()),
      h('label', { class: 'row', style: { cursor: 'pointer', gap: '8px' } },
        h('input', { type: 'checkbox', checked: sound, onchange: (e) => { app.ui.recordSound = e.target.checked; } }),
        h('span', {}, 'Record sound (includes voice chat; only with people who agree)'))));
}

function livePanel(app, status) {
  const timer = h('span', { class: 'heading' });
  const tick = () => {
    if (timer.dataset.on && !timer.isConnected) return;
    timer.dataset.on = '1';
    timer.textContent = `REC ${formatTimestamp((Date.now() - new Date(status.startedAt)) / 1000)}`;
    setTimeout(tick, 1000);
  };
  tick();
  return panel({ accent: 'var(--danger)' }, sectionTitle('Live match'),
    h('div', { class: 'row top', style: { gap: '14px' } }, coachAvatar('watching', 64),
      h('div', { class: 'stack grow', style: { gap: '8px' } },
        h('div', { class: 'row', style: { gap: '10px' } }, h('span', { style: { width: '12px', height: '12px', borderRadius: '6px', background: 'var(--danger)' } }), timer,
          status.sizeBytes ? h('span', { class: 'caption' }, `${Math.round(status.sizeBytes / 1e6)} MB`) : null),
        h('div', { class: 'caption' }, status.windowName ?? ''),
        status.endScreen ? h('div', { style: { color: 'var(--success)' } }, `${status.endScreen === 'win' ? 'Victory' : status.endScreen === 'loss' ? 'Defeat' : 'End'} screen detected, stopping in a few seconds.`)
          : h('div', { class: 'caption' }, 'Play normally. Nothing is shown in the game. The recording stops at the end screen, or press Stop.'),
        h('div', {}, button('Stop recording', () => app.rec.stop(), { kind: 'accent danger' })))));
}
