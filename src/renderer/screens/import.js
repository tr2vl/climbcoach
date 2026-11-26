// Import: a match from a video file you already have (console captures, clips you recorded yourself).
import { formatTimestamp } from '../../shared/rubric.js';
import { button, h, panel, screen, sectionTitle } from '../ui.js';
import { matchForm } from './reports.js';

/** Reads a video's length, size and sound through the browser's own player. */
function probe(url) {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    const done = (info) => { video.removeAttribute('src'); video.load(); resolve(info); };
    video.onloadedmetadata = () => {
      const finish = () => done({ durationSeconds: video.duration, width: video.videoWidth, height: video.videoHeight,
        hasAudio: video.mozHasAudio ?? Boolean(video.webkitAudioDecodedByteCount ?? true) });
      // Recorded WebM files report no length until the player seeks to their end.
      if (!Number.isFinite(video.duration)) {
        video.ontimeupdate = () => { video.ontimeupdate = null; video.currentTime = 0; finish(); };
        video.currentTime = 1e9;
      } else finish();
    };
    video.onerror = () => done(null);
    video.src = url;
  });
}

export function importScreen(app) {
  const ui = app.ui.import ?? (app.ui.import = {});
  const profile = app.settings.profile;
  const main = profile.roles[0];
  ui.draft ??= { mapKey: null, mode: null, queue: 'competitive', result: 'unknown', role: main?.role ?? 'damage', rank: main?.rank ?? null,
    heroKeys: [], stats: {}, notes: '', isReference: false, replayCode: '', playedAt: new Date().toISOString().slice(0, 16) };
  const draft = ui.draft;
  const pick = async () => {
    const file = await app.climb.matches.pickVideo();
    if (!file) return;
    ui.file = file;
    ui.info = await probe(file.url);
    app.refresh();
  };
  const save = async () => {
    const { replayCode, playedAt, ...rest } = draft;
    const match = await app.climb.matches.add({
      ...rest, replayCode: replayCode || null, playedAt: new Date(playedAt).toISOString(),
      video: ui.file ? { source: 'import', path: ui.file.path, isAppOwned: false, sizeBytes: ui.file.sizeBytes, durationSeconds: ui.info?.durationSeconds ?? 0,
        width: ui.info?.width ?? 0, height: ui.info?.height ?? 0, hasAudio: ui.info?.hasAudio ?? true, createdAt: new Date().toISOString() } : null,
    });
    app.ui.import = {};
    if (match.video) await app.climb.analysis.start(match.id, { mode: 'lean' }).catch((e) => app.toast(e.message));
    app.showMatch(match.id);
  };
  return screen('Import', 'Add a match from a video file you already have. ClimbCoach fills in what it can see; correct anything below.',
    panel({ accent: 'var(--blue)' }, sectionTitle('Video'),
      ui.file ? h('div', { class: 'row' },
        h('div', { class: 'grow' }, h('div', { class: 'heading' }, ui.file.name),
          h('div', { class: 'caption' }, ui.info ? `${formatTimestamp(ui.info.durationSeconds)} · ${ui.info.width}×${ui.info.height} · ${Math.round(ui.file.sizeBytes / 1e6)} MB` : 'This file can\'t be played here, so ClimbCoach can\'t analyse it. MP4 (H.264) works best.')),
        button('Pick another', pick))
        : h('div', { class: 'row' }, button('Pick a video file', pick, { kind: 'accent' }), h('span', { class: 'caption' }, 'A whole match, ideally 1080p, with the end screen and your Tab scoreboard in it.'))),
    panel({}, sectionTitle('Match'),
      h('div', { class: 'field', style: { maxWidth: '240px' } }, h('label', {}, 'Played at'),
        h('input', { class: 'input', type: 'datetime-local', value: draft.playedAt, oninput: (e) => { draft.playedAt = e.target.value; } })),
      matchForm(app, draft)),
    h('div', { class: 'row' },
      button(ui.file ? 'Save and analyse' : 'Save without video', save, { kind: 'accent', disabled: Boolean(ui.file && !ui.info) }),
      h('span', { class: 'caption' }, ui.file ? 'The analysis starts by itself; you can keep using the app.' : 'Without a video there is nothing to analyse; the match still counts for your win rates.')));
}
