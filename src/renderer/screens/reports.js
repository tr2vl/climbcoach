// Match Reports: your matches on the left, the selected match's video, coach report and details on the right.
import { capitalize, gameMap, HEROES, heroName, MAPS, modeName, RANK_TIERS, rankText, roleName, ROLES } from '../../shared/catalog.js';
import { categoryScores, deathsOf, findingsOf, heroLine, latestCompletedRun, matchTitle, runsOf, STAT_FIELDS, strengthsOf, topMistakes } from '../../shared/match.js';
import { COMPARISON_NOTE, compareMatch } from '../../shared/progress.js';
import { categoryName, formatTimestamp, scoreBand } from '../../shared/rubric.js';
import { habitCheckSummary } from '../../shared/training.js';
import { coachAvatar, coachSays } from '../coach.js';
import { analysisLine, analysisMood, categoryScoreRow, dateTime, emptyState, findingCard, killerPicker, matchRow, resultTag, scoreColor, timestampButton, videoPlayer } from '../components.js';
import { button, h, icon, panel, screen, sectionTitle, tag } from '../ui.js';

export function reportsScreen(app) {
  const matches = [...app.data.matches].sort((a, b) => new Date(b.playedAt) - new Date(a.playedAt));
  const ui = app.ui.reports ?? (app.ui.reports = {});
  if (!matches.length) {
    return screen('Match Reports', 'Every match you recorded or imported, with its coach report.',
      panel({}, emptyState('reports', 'No reports yet', 'Every imported match gets a report here: video, timestamped findings and scores.', 'Go to Dashboard (Ctrl+1)', () => app.navigate('dashboard'))));
  }
  const selected = matches.find((m) => m.id === ui.selected) ?? matches[0];
  ui.selected = selected.id;
  return h('div', { class: 'screen' }, h('div', { class: 'screen-inner', style: { maxWidth: '1400px' } },
    h('div', { class: 'split' },
      h('div', { class: 'list-column' },
        h('div', { class: 'row', style: { marginBottom: '8px' } }, h('h2', { class: 'section-title' }, h('span', {}, 'Matches')), h('div', { class: 'grow' }), h('span', { class: 'heading muted' }, matches.length)),
        h('div', { class: 'list-panel', style: { maxHeight: 'calc(100vh - 140px)' } },
          matches.map((m) => matchRow(m, { selected: m.id === selected.id, onclick: () => { ui.selected = m.id; ui.editing = false; ui.showStart = false; app.refresh(); } })))),
      h('div', { class: 'grow stack', style: { gap: '18px', minWidth: 0 } }, matchDetail(app, selected)))));
}

function matchDetail(app, match) {
  const ui = app.ui.reports;
  const map = gameMap(match.mapKey);
  const subtitle = [dateTime(match.playedAt), match.mode ? modeName(match.mode) : null, { competitive: 'Competitive', quickPlay: 'Quick Play' }[match.queue] ?? 'Other',
    match.isReference ? 'Reference match' : null].filter(Boolean).join(' · ');
  return [
    h('header', { class: 'screen-header' }, h('h1', {}, map?.name ?? 'Unknown map'), h('div', { class: 'rule' }), h('p', {}, subtitle)),
    h('div', { class: 'row', style: { flexWrap: 'wrap' } },
      resultTag(match),
      h('span', { class: 'title-xl' }, heroLine(match)),
      h('span', { class: 'muted' }, `${roleName(match.role)} · ${rankText(match.rank)}`),
      match.replayCode ? h('span', { class: 'code', style: { color: 'var(--blue)' } }, match.replayCode) : null,
      h('div', { class: 'grow' }),
      button('Edit details', () => { ui.editing = !ui.editing; app.refresh(); }),
      ui.confirmDelete
        ? [h('span', { class: 'caption' }, match.video?.isAppOwned ? 'Delete the match and its recording?' : 'Delete the match? Your video file stays.'),
          button('Delete', async () => { await app.climb.matches.delete(match.id); ui.confirmDelete = false; ui.selected = null; }, { kind: 'accent danger' }),
          button('Keep', () => { ui.confirmDelete = false; app.refresh(); })]
        : button('Delete…', () => { ui.confirmDelete = true; app.refresh(); })),
    ui.editing ? editDetails(app, match) : null,
    videoPanel(app, match),
    analysisPanel(app, match),
    match.notes ? panel({}, sectionTitle('Your notes'), h('div', { style: { whiteSpace: 'pre-wrap' } }, match.notes)) : null,
  ];
}

function videoPanel(app, match) {
  const video = match.video;
  if (!video) return panel({}, sectionTitle('Video'), h('div', { class: 'muted' }, 'No video for this match. Edit the details to add one, or import the match again with its recording.'));
  if (video.deletedAt) return panel({}, sectionTitle('Video'), h('div', { class: 'muted' }, 'The recording was deleted to save space. The report and its clips stay.'));
  const facts = [formatTimestamp(video.durationSeconds ?? 0), video.width ? `${video.width}×${video.height}` : null, video.frameRate ? `${Math.round(video.frameRate)} fps` : null,
    video.hasAudio === false ? 'no audio' : 'audio', video.sizeBytes ? `${Math.round(video.sizeBytes / 1e6)} MB` : null].filter(Boolean).join(' · ');
  return panel({}, sectionTitle('Video', app.climb.isDemo ? null : button('Show in folder', () => app.climb.showInFolder(video.path), { kind: 'link' })),
    videoPlayer(app, app.media(video.path), { start: video.range?.start ?? null }),
    h('div', { class: 'caption' }, facts + (video.range ? ` · the match runs ${formatTimestamp(video.range.start)}–${formatTimestamp(video.range.end)}` : '')));
}

// ---------- Analysis states ----------

function analysisPanel(app, match) {
  const job = app.analysis.jobs?.[match.id];
  const queued = app.analysis.queue?.find((q) => q.matchID === match.id);
  const ui = app.ui.reports;
  const run = latestCompletedRun(match);
  if (job) {
    const [line, label] = analysisLine(job.progress);
    const timer = h('span', {}, label);
    const tick = () => {
      if (!timer.isConnected && timer.dataset.started) return;
      timer.dataset.started = '1';
      const seconds = Math.floor((Date.now() - new Date(job.startedAt)) / 1000);
      timer.textContent = `${label} ${formatTimestamp(seconds)}`;
      setTimeout(tick, 1000);
    };
    tick();
    return panel({ accent: 'var(--blue)' }, sectionTitle('Coach report'),
      coachSays(analysisMood(job.progress), 84, h('div', { class: 'heading' }, line), h('div', { class: 'caption' }, timer)),
      h('div', { class: 'caption' }, 'You can keep using the app; the analysis continues in the background.'),
      h('div', {}, button('Cancel analysis', () => app.climb.analysis.cancel(match.id))));
  }
  if (queued) {
    const resumes = new Date(app.analysis.resumesAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return panel({ accent: 'var(--warning)' }, sectionTitle('Coach report · waiting for the best model'),
      coachSays('sleeping', 84, h('div', { class: 'heading' }, `Out of free requests for today. I'll start this one at ${resumes}.`),
        h('div', { class: 'caption' }, 'Gemini 4 Hydrogen\'s free requests for today are used up. This report starts by itself then, or the next time you open ClimbCoach after that, so it gets the best judgment.')),
      h('div', { class: 'row' },
        button('Run now with a weaker model', () => app.climb.analysis.start(match.id, { mode: queued.mode, allowFallback: true }).catch((e) => app.toast(e.message)),
          { title: 'gemini-3.8-flash or Flash Lite write the report now; their judgment is less reliable' }),
        button('Don\'t analyse', () => app.climb.analysis.dequeue(match.id), { kind: 'link' })));
  }
  if (run && !ui.showStart) return reportView(app, match, run);
  return startPanel(app, match);
}

function startPanel(app, match) {
  const ui = app.ui.reports;
  const lastFailure = runsOf(match)[0]?.status === 'failed' ? runsOf(match)[0] : null;
  const mode = ui.mode ?? 'lean';
  const minutes = Math.round((match.video?.range ? match.video.range.end - match.video.range.start : match.video?.durationSeconds ?? 0) / 60);
  return panel({ accent: 'var(--blue)' }, sectionTitle('Coach report'),
    lastFailure && !ui.showStart ? h('div', { class: 'row top' }, coachAvatar('puzzled', 60),
      h('div', { class: 'stack grow', style: { gap: '4px' } }, h('div', { class: 'heading', style: { color: 'var(--danger)' } }, 'The last analysis failed'), h('div', { class: 'muted' }, lastFailure.errorMessage ?? 'Unknown error.'))) : null,
    match.video ? h('div', { class: 'stack', style: { gap: '8px' } },
      h('div', { class: 'row' },
        h('div', { class: 'segmented' },
          h('button', { class: mode === 'lean' ? 'on' : '', onclick: () => { ui.mode = 'lean'; app.refresh(); } }, 'Lean (3 specialist calls)'),
          h('button', { class: mode === 'full' ? 'on' : '', onclick: () => { ui.mode = 'full'; app.refresh(); } }, 'Full (6 specialist calls)'))),
      h('div', { class: 'caption' }, `About ${mode === 'lean' ? 5 : 8} free requests and 3–6 minutes for this ${minutes}-minute match. ${app.analysis.reportsLeft != null ? `Best-model reports left today: ${app.analysis.reportsLeft}.` : ''}`),
      h('div', { class: 'caption' }, 'The video is uploaded to Google\'s Gemini API (free tier). Google may use free-tier content to improve its products. The upload is deleted by Google after 48 h.'))
      : h('div', { class: 'muted' }, 'Attach a video or record the match to analyse it.'),
    h('div', { class: 'row' },
      button(latestCompletedRun(match) ? 'Analyse again' : 'Analyse match', async () => {
        try {
          const result = await app.climb.analysis.start(match.id, { mode });
          ui.showStart = false;
          if (result.queued) app.toast('Queued for the best model\'s daily reset.');
        } catch (error) { app.toast(error.message); }
      }, { kind: 'accent', disabled: !match.video }),
      ui.showStart ? button('Back to report', () => { ui.showStart = false; app.refresh(); }) : null));
}

// ---------- The report ----------

function section(title, accent, ...content) {
  return panel({ accent }, sectionTitle(title), ...content);
}

export function reportView(app, match, sourceRun) {
  const run = { ...sourceRun, isReference: match.isReference };
  const ui = app.ui.reports;
  const comparison = compareMatch(match, run, app.data.matches);
  const habit = habitCheckSummary(run, app.data.habits);
  const top = topMistakes(run);
  const strengths = strengthsOf(run);
  return [
    panel({ accent: 'var(--blue)' }, h('div', { class: 'row top', style: { gap: '20px' } },
      h('div', { style: { width: '160px', flex: 'none' } },
        h('div', { class: 'overline' }, 'Overall'),
        h('div', { style: { font: '900 48px var(--font-condensed)', fontStretch: 'condensed', color: scoreColor(run.overallScore) } }, run.overallScore != null ? run.overallScore.toFixed(1) : 'N/A'),
        h('div', { class: 'caption' }, run.overallScore != null ? scoreBand(run.overallScore) : 'Too few categories assessable')),
      h('div', { class: 'stack grow', style: { gap: '8px' } }, sectionTitle('Coach report'), h('div', {}, run.summary ?? '')))),
    comparison && !comparison.isEmpty ? section(`Compared with ${comparison.basis}`, 'var(--blue)', comparisonRows(comparison)) : null,
    habit ? section(`Habit check · ${habit.title}`, 'var(--orange)',
      h('div', { class: 'heading', style: { color: habit.done * 10 >= habit.moments.length * 7 ? 'var(--success)' : 'var(--text)' } }, habit.resultText),
      habit.moments.map((m) => h('div', { class: 'row' }, timestampButton(app, m.timestamp),
        h('span', { style: { color: m.done ? 'var(--success)' : 'var(--danger)' }, 'aria-label': m.done ? 'Done' : 'Missed' }, m.done ? '✓' : '✗'), h('span', {}, m.evidence))),
      h('div', { class: 'caption' }, 'Habit checks never change a score.')) : null,
    top.length ? section('3 costliest mistakes', 'var(--orange)', top.map((f, i) => findingCard(app, run, f, i + 1))) : null,
    strengths.length ? section(match.isReference ? 'What they did right' : 'What you did right', 'var(--success)', strengths.map((f) => findingCard(app, run, f))) : null,
    run.drillTitle ? section('Drill for your next session', 'var(--blue)', h('div', { class: 'heading' }, run.drillTitle),
      h('ol', { class: 'steps-list' }, (run.drillSteps ?? []).map((step) => h('li', {}, h('span', {}, step))))) : null,
    section('Category scores', null, h('div', { class: 'grid-2' }, categoryScores(run).map((score) => categoryScoreRow(score, match.heroKeys ?? [])))),
    deathsOf(run).length ? section('Death review', 'var(--warning)', deathsOf(run).map((death) => h('div', { class: 'row top' },
      timestampButton(app, death.timestamp),
      tag(death.cause, death.avoidable === 'yes' ? 'var(--danger)' : 'var(--text-2)'),
      h('div', { class: 'stack grow', style: { gap: '3px' } },
        h('div', { class: 'row', style: { gap: '10px' } }, h('span', { class: 'caption' }, `Avoidable: ${death.avoidable}${death.isFirstDeathOfFight ? ' · first death of the fight' : ''}`), killerPicker(app, run, death)),
        h('div', {}, death.whatToDoInstead))))) : null,
    panel({}, timeline(app, match, run)),
    h('div', { class: 'stack', style: { gap: '6px' } },
      h('div', { class: 'row' },
        h('span', { class: 'caption grow' }, `Rubric v${run.rubricVersion} · ${run.modelID} · ${run.requestCount} requests · ${Math.round((run.inputTokens + run.outputTokens) / 1000)}k tokens · ${dateTime(run.startedAt)}`),
        exportMenu(app, match, run),
        button('Analyse again…', () => { ui.showStart = true; app.refresh(); })),
      run.validationIssues?.length ? h('details', {}, h('summary', {}, 'Validator corrections'), h('div', { class: 'caption', style: { whiteSpace: 'pre-wrap', userSelect: 'text' } }, run.validationIssues.join('\n'))) : null),
  ];
}

export function comparisonRows(comparison) {
  const trendColor = (t) => ({ better: 'var(--success)', worse: 'var(--danger)' }[t] ?? 'var(--text-2)');
  const row = (l) => h('tr', {}, h('td', {}, l.label), h('td', { class: 'heading' }, l.currentText), h('td', { class: 'muted' }, l.usualText),
    h('td', {}, tag(l.trend === 'same' ? l.trendLabel : `${l.trendLabel} ${l.changeText}`, trendColor(l.trend))));
  return [
    h('table', { class: 'table' }, h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'This match'), h('th', {}, 'Your usual'), h('th', {}, 'Change'))),
      h('tbody', {}, comparison.lines.map(row),
        comparison.movedCategories.length ? [h('tr', {}, h('th', { colspan: 4 }, 'Category scores')), comparison.movedCategories.map(row)] : null)),
    comparison.steadyCategoriesText ? h('div', { class: 'caption' }, comparison.steadyCategoriesText) : null,
    comparison.repeats.map((r) => h('div', { class: 'row', style: { gap: '8px', color: r.isBack ? 'var(--warning)' : 'var(--text-2)' } }, h('span', {}, r.isBack ? '↻' : '↘'), h('span', { style: { color: 'var(--text)' } }, r.text))),
    h('div', { class: 'caption' }, COMPARISON_NOTE),
  ];
}

function timeline(app, match, run) {
  const ui = app.ui.reports;
  const filter = ui.timelineFilter ?? 'all';
  const duration = match.video?.durationSeconds || Math.max(60, ...findingsOf(run).map((f) => f.timestamp + 30), ...deathsOf(run).map((d) => d.timestamp + 30));
  const items = [
    ...findingsOf(run).map((f) => ({ time: f.timestamp, kind: f.kind === 'strength' ? 'strengths' : 'mistakes', color: f.kind === 'strength' ? 'var(--success)' : 'var(--danger)', title: categoryName(f.category), text: f.evidence })),
    ...deathsOf(run).map((d) => ({ time: d.timestamp, kind: 'deaths', color: 'var(--warning)', title: `Death · ${d.cause}`, text: d.whatToDoInstead })),
  ].filter((i) => filter === 'all' || i.kind === filter).sort((a, b) => a.time - b.time);
  const choose = (key) => { ui.timelineFilter = key; app.refresh(); };
  return [
    sectionTitle('Timeline', h('span', { class: 'caption' }, 'Show'), h('div', { class: 'segmented' },
      [['all', 'All'], ['mistakes', 'Mistakes'], ['strengths', 'Strengths'], ['deaths', 'Deaths']].map(([key, label]) => h('button', { class: filter === key ? 'on' : '', onclick: () => choose(key) }, label)))),
    h('div', { class: 'timeline-bar' }, items.map((i) => h('span', { style: { left: `${(i.time / duration) * 100}%`, background: i.color }, title: `${formatTimestamp(i.time)} ${i.title}`, onclick: () => app.player?.seek(i.time) }))),
    items.map((i) => h('div', { class: 'row top' },
      h('span', { style: { width: '8px', height: '8px', borderRadius: '4px', background: i.color, marginTop: '8px', flex: 'none' } }),
      timestampButton(app, i.time),
      h('div', { class: 'stack', style: { gap: '2px' } }, h('span', { class: 'caption', style: { fontWeight: 600 } }, i.title), h('span', {}, i.text)))),
  ];
}

function exportMenu(app, match, run) {
  if (!app.climb.exports) return null;
  const select = h('select', { class: 'input', style: { width: '120px' }, 'aria-label': 'Export',
    onchange: async (e) => {
      const format = e.target.value;
      e.target.value = '';
      if (!format) return;
      try {
        const file = await app.climb.exports.save(match.id, run.id, format);
        if (file) app.toast(`Saved ${file}`);
      } catch (error) { app.toast(`Couldn't export the report: ${error.message}`); }
    } },
  h('option', { value: '' }, 'Export'), h('option', { value: 'pdf' }, 'PDF…'), h('option', { value: 'pdf-print' }, 'PDF for printing (light)…'), h('option', { value: 'markdown' }, 'Markdown…'));
  return select;
}

// ---------- Editing a match ----------

function editDetails(app, match) {
  const ui = app.ui.reports;
  const draft = ui.draft?.id === match.id ? ui.draft : (ui.draft = structuredClone({ id: match.id, mapKey: match.mapKey, mode: match.mode, queue: match.queue, result: match.result,
    role: match.role, rank: match.rank, heroKeys: match.heroKeys ?? [], stats: { ...match.stats }, notes: match.notes ?? '', isReference: Boolean(match.isReference), replayCode: match.replayCode ?? '' }));
  return panel({ accent: 'var(--orange)' }, sectionTitle('Edit details'), matchForm(app, draft),
    h('div', { class: 'row' },
      button('Save', async () => {
        const { id, ...patch } = draft;
        await app.climb.matches.update(match.id, { ...patch, replayCode: patch.replayCode || null });
        ui.editing = false;
        ui.draft = null;
      }, { kind: 'accent' }),
      button('Cancel', () => { ui.editing = false; ui.draft = null; app.refresh(); })));
}

/** The match form shared by Import and Edit details. Edits `draft` in place. */
export function matchForm(app, draft) {
  const select = (label, value, options, onchange) => h('div', { class: 'field' }, h('label', {}, label),
    h('select', { class: 'input', onchange: (e) => { onchange(e.target.value || null); app.refresh(); } },
      options.map(([key, text]) => h('option', { value: key ?? '', selected: (value ?? '') === (key ?? '') }, text))));
  const heroesForRole = HEROES.filter((hero) => hero.role === draft.role);
  return h('div', { class: 'stack' },
    h('div', { class: 'grid-2', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' } },
      select('Map', draft.mapKey, [[null, 'Unknown'], ...MAPS.map((m) => [m.key, m.name])], (v) => { draft.mapKey = v; const map = gameMap(v); if (map?.modes.length === 1) draft.mode = map.modes[0]; }),
      select('Mode', draft.mode, [[null, 'Unknown'], ...['push', 'control', 'escort', 'hybrid', 'flashpoint'].map((m) => [m, modeName(m)])], (v) => { draft.mode = v; }),
      select('Queue', draft.queue, [['competitive', 'Competitive'], ['quickPlay', 'Quick Play'], ['other', 'Other']], (v) => { draft.queue = v; }),
      select('Result', draft.result, [['unknown', 'Unknown'], ['win', 'Win'], ['loss', 'Loss'], ['draw', 'Draw']], (v) => { draft.result = v; }),
      select('Role', draft.role, ROLES.map((r) => [r.key, r.name]), (v) => { draft.role = v; draft.heroKeys = draft.heroKeys.filter((k) => HEROES.find((x) => x.key === k)?.role === v); }),
      select('Rank', draft.rank ? `${draft.rank.tier}-${draft.rank.division}` : null,
        [[null, 'Unranked'], ...RANK_TIERS.flatMap((t) => [1, 2, 3, 4, 5].map((d) => [`${t}-${d}`, `${capitalize(t)} ${d}`]))],
        (v) => { draft.rank = v ? { tier: v.split('-')[0], division: Number(v.split('-')[1]) } : null; })),
    h('div', { class: 'field' }, h('label', {}, `Heroes played (${roleName(draft.role)}), in order`),
      h('div', { class: 'chips' }, heroesForRole.map((hero) => {
        const index = draft.heroKeys.indexOf(hero.key);
        return h('button', { class: `choice ${index >= 0 ? 'selected' : ''}`, onclick: () => {
          if (index >= 0) draft.heroKeys.splice(index, 1); else draft.heroKeys.push(hero.key);
          app.refresh();
        } }, index >= 0 ? `${index + 1}. ${hero.name}` : hero.name);
      }))),
    h('div', { class: 'field' }, h('label', {}, 'Your scoreboard (optional; read from the recording when it has your Tab screen)'),
      h('div', { class: 'row', style: { flexWrap: 'wrap' } }, [...STAT_FIELDS, 'durationSeconds'].map((field) => h('input', {
        class: 'input', style: { width: '120px' }, type: 'number', min: 0, placeholder: { eliminations: 'Elims', assists: 'Assists', deaths: 'Deaths', damage: 'Damage', healing: 'Healing', mitigation: 'Mitigated', durationSeconds: 'Length (s)' }[field],
        value: draft.stats?.[field] ?? '', 'aria-label': field,
        oninput: (e) => { draft.stats = { ...draft.stats, [field]: e.target.value === '' ? null : Number(e.target.value) }; },
      })))),
    h('div', { class: 'grid-2', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' } },
      h('div', { class: 'field' }, h('label', {}, 'Replay code (optional)'),
        h('input', { class: 'input mono', value: draft.replayCode ?? '', maxlength: 8, oninput: (e) => { draft.replayCode = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); } })),
      h('label', { class: 'row', style: { cursor: 'pointer', marginTop: '20px' } },
        h('input', { type: 'checkbox', checked: draft.isReference, onchange: (e) => { draft.isReference = e.target.checked; } }),
        h('span', {}, 'Reference match: another, better player\'s play you study (never part of your trends)'))),
    h('div', { class: 'field' }, h('label', {}, 'Notes'),
      h('textarea', { class: 'input', placeholder: 'Anything you want to remember about this match', oninput: (e) => { draft.notes = e.target.value; } }, draft.notes ?? '')));
}

export { heroName };
