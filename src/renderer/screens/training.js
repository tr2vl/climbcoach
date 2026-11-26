// Training: the one habit you train, your own moments of it, your warm-up and your drills.
import { categoryAverages, summaries } from '../../shared/progress.js';
import { CATEGORIES, categoryName, formatTimestamp } from '../../shared/rubric.js';
import { activeHabit, habitHistory, habitMatches, habitProgressText, habitReel, HABIT, learnedTitles, rankStruggles, struggleSamples, WARM_UPS } from '../../shared/training.js';
import { coachAvatar, coachSays } from '../coach.js';
import { emptyState } from '../components.js';
import { button, h, icon, panel, screen, sectionTitle } from '../ui.js';

export const STARTER_WARMUP = [
  { title: 'Practice Range: track the moving bots, crosshair on the head', minutes: 3 },
  { title: 'Practice Range: flick between bots, then reset to centre', minutes: 3 },
  { title: 'Deathmatch or an aim workshop map on your main hero', minutes: 5 },
  { title: 'Read your habit on the Training screen and decide how you\'ll notice its moment', minutes: 1 },
];

export function trainingScreen(app) {
  return screen('Training', 'The one habit you train, your own moments of it, your warm-up and your drills.',
    habitPanel(app), reelPanel(app), warmUpPanel(app), drillsPanel(app));
}

function habitPanel(app) {
  const habit = activeHabit(app.data.habits);
  const struggles = rankStruggles(struggleSamples(app.data.matches), app.learn.mistakes?.patterns ?? [], learnedTitles(app.data.habits));
  const learned = habitHistory(app.data.habits).filter((h0) => h0.endReason === 'learned');
  const labeled = (label, text) => h('div', { class: 'stack', style: { gap: '1px' } }, h('div', { class: 'overline' }, label), h('div', {}, text));
  const picker = struggles.length ? h('select', { class: 'input', style: { width: '260px' }, 'aria-label': 'Pick another habit',
    onchange: (e) => { const s = struggles.find((x) => x.id === e.target.value); if (s) app.climb.training.start(s); } },
  h('option', { value: '' }, 'Pick another habit…'),
  struggles.map((s) => h('option', { value: s.id, disabled: s.card.title === habit?.title }, `${s.card.title} · ${categoryName(s.category)}`))) : null;
  if (!habit) {
    return panel({ accent: 'var(--orange)' }, sectionTitle('Your habit', picker),
      coachSays('idle', 70, h('div', {}, struggles.length ? 'No habit yet. Pick one above, or wait: I pick the costliest one at the next launch or report.'
        : 'Once 2 of your matches have reports, I\'ll pick the habit that costs you the most.')));
  }
  const checked = habitMatches(habit.id, app.data.matches);
  return panel({ accent: 'var(--orange)' }, sectionTitle('Your habit', picker),
    h('div', { class: 'row top', style: { gap: '16px' } }, coachAvatar('idle', 76),
      h('div', { class: 'stack grow', style: { gap: '8px' } }, h('div', { class: 'title-xl' }, habit.title),
        labeled('When', habit.trigger), labeled('Do', habit.action), labeled('The coach looks for', habit.check))),
    habit.reason ? h('div', { class: 'muted', style: { fontSize: '13px' } }, `Why this one: ${habit.reason}`) : null,
    progressBars(checked),
    h('div', { class: 'caption' }, habitProgressText(checked)),
    habit.drill?.length ? h('div', { class: 'stack', style: { gap: '6px' } },
      h('div', { class: 'overline' }, 'Drill for your next session'),
      h('ol', { class: 'steps-list' }, habit.drill.map((s) => h('li', {}, h('span', {}, s)))),
      h('div', { class: 'row muted', style: { gap: '6px', fontSize: '13px' } }, icon('flame', 14), h('span', {}, `Warm-up for it: ${WARM_UPS[habit.category]}`))) : null,
    learned.length ? [h('div', { class: 'overline' }, 'Learned'),
      learned.map((l) => h('div', { class: 'row', style: { gap: '6px', color: 'var(--success)' } }, icon('check', 16), h('span', {}, `${l.title} · ${new Date(l.endedAt).toLocaleDateString()}`)))] : null);
}

/** One bar per checked match: the share of moments where you did the habit, with the 70 % goal line. */
function progressBars(list) {
  const shown = list.slice(-10);
  if (!shown.length) return null;
  const height = 70;
  return h('div', { class: 'stack', style: { gap: '4px', maxWidth: `${shown.length * 34 + 80}px` } },
    h('div', { style: { position: 'relative', height: `${height}px`, display: 'flex', alignItems: 'flex-end', gap: '8px' } },
      shown.map((m) => {
        const counts = m.result.total >= HABIT.minimumMoments;
        return h('div', { title: `${m.title}: ${m.result.done} of ${m.result.total} moments${counts ? '' : ' (too few to count)'}`,
          style: { width: '26px', height: `${Math.max(2, (m.result.done / m.result.total) * height)}px`, background: 'var(--blue)', opacity: counts ? 1 : 0.35, borderRadius: '3px 3px 0 0' } });
      }),
      h('div', { style: { position: 'absolute', left: 0, right: 0, bottom: `${HABIT.goal * height}px`, height: '1px', background: 'var(--text-2)' } }),
      h('div', { class: 'caption', style: { position: 'absolute', right: 0, bottom: `${HABIT.goal * height + 2}px`, fontSize: '10px' } }, `goal ${Math.round(HABIT.goal * 100)} %`)),
    h('div', { style: { display: 'flex', gap: '8px' } }, shown.map((m) => h('div', { class: 'caption', style: { width: '26px', textAlign: 'center', fontSize: '10px' } }, `${m.result.done}/${m.result.total}`))));
}

function reelPanel(app) {
  const habit = activeHabit(app.data.habits);
  if (!habit) return null;
  const ui = app.ui.reel ?? (app.ui.reel = {});
  const filter = ui.filter ?? 'misses';
  const all = habitReel(habit.id, app.data.matches);
  const shown = all.filter((e) => filter === 'all' || (filter === 'done') === e.done);
  const selected = shown.find((e) => e.id === ui.selected) ?? shown[0] ?? null;
  return panel({ accent: 'var(--blue)' },
    sectionTitle('Habit reel', h('div', { class: 'segmented' }, [['misses', 'Misses'], ['done', 'Done'], ['all', 'All']].map(([key, label]) =>
      h('button', { class: key === filter ? 'on' : '', onclick: () => { ui.filter = key; ui.selected = null; app.refresh(); } }, label)))),
    all.length ? h('div', { class: 'split' },
      h('div', { class: 'list-column', style: { width: '320px' } }, h('div', { class: 'list-panel', style: { maxHeight: '340px' } },
        shown.length ? shown.map((e) => h('button', { class: `match-row ${e.id === selected?.id ? 'selected' : ''}`, onclick: () => { ui.selected = e.id; app.refresh(); } },
          h('span', { style: { color: e.done ? 'var(--success)' : 'var(--danger)', fontWeight: 800 } }, e.done ? '✓' : '✗'),
          h('div', { class: 'grow' }, h('div', { class: 'row', style: { gap: '8px' } }, h('span', { class: 'code', style: { color: 'var(--blue)' } }, formatTimestamp(e.timestamp)), h('span', { class: 'caption' }, e.matchTitle)),
            h('div', { class: 'caption', style: { color: 'var(--text)' } }, e.evidence))))
          : h('div', { class: 'muted', style: { padding: '10px' } }, 'Nothing here yet.'))),
      h('div', { class: 'grow stack', style: { minWidth: 0 } }, selected ? reelDetail(app, selected) : h('div', { class: 'muted' }, 'Pick a moment to watch it.')))
      : h('div', { class: 'muted' }, `Your next report marks every moment "${habit.title}" came up. They appear here to watch back to back.`));
}

function reelDetail(app, entry) {
  const match = app.data.matches.find((m) => m.id === entry.matchID);
  const clip = app.clipFor?.(entry.matchID, entry.timestamp, 'habit');
  const video = match?.video && !match.video.deletedAt ? match.video.path : null;
  let player = h('div', { class: 'muted' }, 'No video for this moment: the recording was removed before its clip was kept.');
  let caption = '';
  if (clip || video) {
    const el = h('video', { class: 'video', controls: true, preload: 'auto', src: app.media(clip ?? video) });
    el.addEventListener('loadedmetadata', () => { el.currentTime = clip ? 0 : Math.max(0, entry.timestamp - 6); el.play().catch(() => {}); }, { once: true });
    player = el;
    caption = clip ? 'Clip: 6 s before the moment to 4 s after.' : 'Full recording, from 6 s before the moment.';
  }
  return [player, caption ? h('div', { class: 'caption' }, caption) : null,
    h('div', { style: { color: entry.done ? 'var(--success)' : 'var(--danger)', fontWeight: 700 } }, entry.done ? '✓ Done' : '✗ Missed'),
    h('div', {}, entry.evidence), h('div', {}, button('Open match report', () => app.showMatch(entry.matchID)))];
}

// ---------- Warm-up ----------

function warmUpPanel(app) {
  const prefs = app.settings.prefs ?? {};
  const steps = prefs.warmUpSteps ?? STARTER_WARMUP;
  const ui = app.ui.warmup ?? (app.ui.warmup = {});
  const total = steps.reduce((s, x) => s + Math.max(0, x.minutes), 0);
  const save = async (next) => { app.settings = await app.climb.settings.update({ prefs: { ...prefs, warmUpSteps: next } }); app.refresh(); };
  if (ui.editing) {
    const draft = ui.draft ?? (ui.draft = structuredClone(steps));
    return panel({ accent: 'var(--orange)' }, sectionTitle(`Warm-up · ${draft.reduce((s, x) => s + Math.max(0, Number(x.minutes) || 0), 0)} min`,
      button('Done', () => { save(draft.filter((s) => s.title.trim()).map((s) => ({ title: s.title.trim(), minutes: Number(s.minutes) || 0 }))); ui.editing = false; ui.draft = null; })),
    draft.map((step, index) => h('div', { class: 'row' },
      h('input', { class: 'input grow', value: step.title, oninput: (e) => { step.title = e.target.value; } }),
      h('input', { class: 'input', type: 'number', min: 0, style: { width: '80px' }, value: step.minutes, oninput: (e) => { step.minutes = e.target.value; } }), h('span', { class: 'caption' }, 'min'),
      button(icon('trash', 14), () => { draft.splice(index, 1); app.refresh(); }, { title: 'Remove step' }))),
    h('div', { class: 'row' }, button('Add step', () => { draft.push({ title: '', minutes: 3 }); app.refresh(); }),
      button('Back to the starter routine', () => { ui.draft = structuredClone(STARTER_WARMUP); app.refresh(); }, { kind: 'link' })));
  }
  const running = ui.running;
  const stepAt = running ? running.index : -1;
  if (running && !ui.ticking) {
    ui.ticking = true;
    const tick = () => {
      const r = ui.running;
      if (!r) { ui.ticking = false; return; }
      if (!r.paused) r.remaining -= 1;
      if (r.remaining <= 0) {
        r.index += 1;
        if (r.index >= steps.length) { ui.running = null; ui.ticking = false; app.toast('Warm-up done. Queue up.'); app.refresh(); return; }
        r.remaining = steps[r.index].minutes * 60;
      }
      const label = document.querySelector('[data-warmup-time]');
      if (label) label.textContent = formatTimestamp(r.remaining);
      if (r.remaining % 60 === 0 || r.remaining <= 0) app.refresh();
      setTimeout(tick, 1000);
    };
    setTimeout(tick, 1000);
  }
  return panel({ accent: 'var(--orange)' },
    sectionTitle(`Warm-up · ${total} min`, running ? null : button('Edit steps', () => { ui.editing = true; app.refresh(); })),
    steps.map((step, index) => h('div', { class: 'row', style: { opacity: running && index < stepAt ? 0.5 : 1 } },
      h('span', { style: { color: index === stepAt ? 'var(--orange)' : 'var(--text-2)' } }, index < stepAt ? '✓' : index === stepAt ? '▶' : '○'),
      h('span', { class: 'grow', style: { fontWeight: index === stepAt ? 700 : 400 } }, `${index + 1}. ${step.title}`),
      index === stepAt ? h('span', { class: 'heading', 'data-warmup-time': '', style: { color: 'var(--orange)' } }, formatTimestamp(running.remaining))
        : h('span', { class: 'caption' }, `${step.minutes} min`))),
    h('div', { class: 'row' }, running
      ? [button(running.paused ? 'Resume' : 'Pause', () => { running.paused = !running.paused; app.refresh(); }),
        button('Next step', () => { running.remaining = 0; }), button('Stop', () => { ui.running = null; app.refresh(); }, { kind: 'link' })]
      : button('Start warm-up', () => { ui.running = { index: 0, remaining: steps[0].minutes * 60, paused: false }; app.refresh(); }, { kind: 'accent', disabled: !steps.length })));
}

// ---------- Drills ----------

function drillsPanel(app) {
  const drills = app.data.drills ?? [];
  const ui = app.ui.drills ?? (app.ui.drills = {});
  const averages = categoryAverages(summaries(app.data.matches));
  const weakest = Object.entries(averages).sort((a, b) => a[1] - b[1]).slice(0, 3).map(([c]) => c);
  const suggested = drills.filter((d) => weakest.includes(d.category));
  const editor = ui.draft ? h('div', { class: 'stack', style: { padding: '12px', background: 'var(--surface-raised)', clipPath: 'var(--cut-8)' } },
    h('div', { class: 'row', style: { flexWrap: 'wrap' } },
      h('input', { class: 'input grow', placeholder: 'Name, e.g. Tracking on strafing bots', value: ui.draft.name, oninput: (e) => { ui.draft.name = e.target.value; } }),
      h('input', { class: 'input mono', style: { width: '150px' }, placeholder: 'Workshop code', value: ui.draft.workshopCode ?? '', oninput: (e) => { ui.draft.workshopCode = e.target.value.toUpperCase(); } }),
      h('select', { class: 'input', style: { width: '200px' }, onchange: (e) => { ui.draft.category = e.target.value; } }, CATEGORIES.map((c) => h('option', { value: c, selected: ui.draft.category === c }, categoryName(c)))),
      h('input', { class: 'input', type: 'number', min: 0, style: { width: '80px' }, value: ui.draft.minutes, oninput: (e) => { ui.draft.minutes = Number(e.target.value) || 0; } }), h('span', { class: 'caption' }, 'min')),
    h('textarea', { class: 'input', placeholder: 'How to do it (optional)', oninput: (e) => { ui.draft.details = e.target.value; } }, ui.draft.details ?? ''),
    h('div', { class: 'row' }, button('Save drill', () => { if (!ui.draft.name.trim()) return; app.climb.drills.save({ ...ui.draft, name: ui.draft.name.trim() }); ui.draft = null; }, { kind: 'accent' }),
      button('Cancel', () => { ui.draft = null; app.refresh(); }))) : null;
  const row = (d) => h('div', { class: 'row', style: { padding: '8px 0', borderBottom: '1px solid rgba(52,66,92,0.5)' } },
    h('div', { class: 'grow' }, h('div', { class: 'heading' }, d.name),
      h('div', { class: 'caption' }, [categoryName(d.category), d.workshopCode ? `Code ${d.workshopCode}` : null, d.practicedCount ? `practised ${d.practicedCount}×` : null].filter(Boolean).join(' · ')),
      d.details ? h('div', { class: 'muted', style: { fontSize: '13px' } }, d.details) : null),
    h('span', { class: 'caption' }, `${d.minutes} min`),
    d.workshopCode ? button('Copy code', () => navigator.clipboard?.writeText(d.workshopCode).then(() => app.toast('Workshop code copied.')).catch(() => app.toast(d.workshopCode))) : null,
    button('Practised', () => app.climb.drills.practiced(d.id)),
    button('Edit', () => { ui.draft = structuredClone(d); app.refresh(); }, { kind: 'link' }),
    button(icon('trash', 14), () => app.climb.drills.delete(d.id), { title: 'Delete drill' }));
  return panel({}, sectionTitle('Drill library', ui.draft ? null : button('Add drill', () => { ui.draft = { name: '', workshopCode: '', category: weakest[0] ?? 'aim', minutes: 10, details: '' }; app.refresh(); })),
    weakest.length ? h('div', { class: 'caption' }, `Your weakest categories over the last 10 reports: ${weakest.map(categoryName).join(', ')}.`) : null,
    editor,
    drills.length ? [
      suggested.length ? [h('div', { class: 'overline', style: { color: 'var(--orange)' } }, 'Suggested for your weak spots'), suggested.map(row)] : null,
      h('div', { class: 'overline' }, 'All drills'), drills.map(row),
    ] : emptyState('practice', 'No drills yet', 'Add the workshop codes and routines you use, and link each to the category it trains. ClimbCoach then suggests them when that category is one of your weakest.'));
}
