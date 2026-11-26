// The demo: the real ClimbCoach screens in a browser, with a stand-in for the Windows app's back end.
// Nothing here is sent anywhere. Keys typed into the demo are only checked for their shape.
import { metaQuery, queryKey } from '../shared/meta.js';
import { sampleData } from './demo-data.js';

const DEMO_KEY = 'climbcoach-demo-settings';

export function createDemoBridge() {
  const fresh = { profile: { inGameName: '', platform: null, region: null, roles: [] }, onboardingDone: false, tourDone: false, prefs: {} };
  // sessionStorage keeps the demo where you left it on reload; some embedded pages don't allow it.
  let memory = null;
  const read = () => {
    try { return JSON.parse(sessionStorage.getItem(DEMO_KEY) ?? 'null') ?? memory ?? structuredClone(fresh); } catch { return memory ?? structuredClone(fresh); }
  };
  const write = (value) => {
    memory = value;
    try { sessionStorage.setItem(DEMO_KEY, JSON.stringify(value)); } catch { /* memory only */ }
  };
  const keys = { gemini: false, youtube: false };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const listeners = { data: [], analysis: [], learn: [], meta: [], training: [], recording: [] };
  const emit = (kind, payload) => listeners[kind].forEach((fn) => fn(payload));

  let data = { version: 1, matches: [], habits: [], weeklyReports: [], focusGoals: [], mapNotes: {}, drills: [], learnVideos: [], heroStats: [], patchNotes: [] };
  let learn = { mistakes: null, status: { kind: 'idle' }, results: [], studying: [], lastRun: null, topicDates: {}, findingMistakes: false };
  let kitChanges = [];
  const jobs = {};
  const defaultQuery = () => { const p = read().profile; return metaQuery(p.roles.find((r) => r.rank)?.rank ?? null, p.region ?? 'europe', p.platform === 'console' ? 'console' : 'pc'); };
  const analysis = () => ({ jobs, queue: [], resumesAt: new Date(Date.now() + 9 * 3600_000).toISOString(), requestsLeft: 15, reportsLeft: 3 });
  const metaView = () => ({ refreshing: false, error: null, kitChanges, kitsCheckedAt: new Date().toISOString(), defaultQuery: defaultQuery() });
  const changed = () => emit('data');

  function fill() {
    const sample = sampleData(read().profile);
    data = sample.data;
    const key = queryKey(defaultQuery());
    data.heroStats.forEach((s) => { s.query = key; });
    learn = sample.learn;
    kitChanges = sample.kitChanges;
    jobs['m-live'] = { startedAt: new Date(Date.now() - 95_000).toISOString(), progress: { step: 'specialists', done: 1, total: 3 } };
    changed();
    emit('analysis', analysis());
    emit('learn', learn);
    emit('meta', metaView());
  }

  const findRun = (runId) => data.matches.flatMap((m) => m.runs.map((r) => ({ m, r }))).find((x) => x.r.id === runId);

  return {
    isDemo: true,
    hasSample: () => data.matches.length > 0,
    fillSample: fill,
    info: async () => ({ version: '1.0.0', platform: 'win32', isPackaged: true }),
    settings: {
      get: async () => read(),
      update: async (patch) => { const next = { ...read(), ...patch }; write(next); return next; },
    },
    keys: {
      status: async () => ({ ...keys }),
      save: async (kind, value) => { keys[kind] = Boolean(value); return { ...keys }; },
      test: async (kind, value) => {
        await wait(900);
        if (!/^AIza[0-9A-Za-z_-]{35}$/.test(value ?? '')) {
          return { ok: false, message: 'That doesn\'t look like a Google API key. It starts with "AIza" and is 39 characters long.' };
        }
        return { ok: true, message: kind === 'gemini' ? 'The key works. Your coach can watch matches. (Demo: only the format was checked.)' : 'The key works. Learn can search for guides. (Demo: only the format was checked.)' };
      },
    },
    open: async (url) => {
      // A real link: embedded pages may refuse window.open.
      const link = Object.assign(document.createElement('a'), { href: url, target: '_blank', rel: 'noopener' });
      document.body.append(link);
      link.click();
      link.remove();
    },
    restart: () => {
      try { sessionStorage.removeItem(DEMO_KEY); } catch { /* nothing stored */ }
      memory = null;
      location.reload();
    },
    updates: { status: async () => ({ state: 'current' }), check: async () => ({ state: 'current' }), install: async () => {}, onChange: () => () => {} },
    usage: async () => ({ today: [{ model: 'gemini-4-hydrogen', requests: 5, inputTokens: 251_000, outputTokens: 14_000, lastLimit: null }], bestLeft: 15 }),
    data: { snapshot: async () => structuredClone(data), onChange: (fn) => listeners.data.push(fn) },
    matches: {
      pickVideo: async () => null,
      add: async (draft) => { const match = { id: `m-${Date.now()}`, createdAt: new Date().toISOString(), runs: [], screenshots: [], fights: [], stats: {}, ...draft }; data.matches.push(match); changed(); return match; },
      update: async (matchID, patch) => { Object.assign(data.matches.find((m) => m.id === matchID), patch); changed(); },
      delete: async (matchID) => { data.matches = data.matches.filter((m) => m.id !== matchID); changed(); },
    },
    reports: {
      dispute: async (runId, findingId, note) => { const f = findRun(runId)?.r.findings.find((x) => x.id === findingId); if (f) { f.isDisputed = note != null; f.disputeNote = note || null; changed(); } },
      killer: async (runId, deathId, heroKey) => { const d = findRun(runId)?.r.deaths.find((x) => x.id === deathId); if (d) { d.killerHeroKey = heroKey; changed(); } return 0; },
    },
    analysis: {
      status: async () => analysis(),
      start: async () => { throw new Error('In the demo, reports are sample data. In the Windows app this starts the analysis with your Gemini key.'); },
      cancel: async (matchID) => { delete jobs[matchID]; emit('analysis', analysis()); },
      dequeue: async () => {},
      onChange: (fn) => listeners.analysis.push(fn),
    },
    training: {
      refresh: async () => {},
      start: async (struggle) => {
        const now = new Date().toISOString();
        data.habits.filter((x) => !x.endedAt).forEach((x) => { x.endedAt = now; x.endReason = 'swapped'; });
        data.habits.push({ id: `habit-${Date.now()}`, ...struggle.card, reason: struggle.reason, source: struggle.source, startedAt: now, endedAt: null, endReason: null });
        changed();
        emit('training', { kind: 'started', title: struggle.card.title });
      },
      onUpdate: (fn) => listeners.training.push(fn),
    },
    learn: {
      view: async () => learn,
      search: async () => { throw new Error('Searching YouTube works in the Windows app with your own YouTube key.'); },
      study: async () => {},
      autoStudy: async () => { throw new Error('Studying guides works in the Windows app with your own keys.'); },
      findFix: async () => { throw new Error('Studying guides works in the Windows app with your own keys.'); },
      onChange: (fn) => listeners.learn.push(fn),
    },
    meta: { view: async () => metaView(), refresh: async () => {}, onChange: (fn) => listeners.meta.push(fn) },
    maps: { note: async (mapKey, text) => { data.mapNotes[mapKey] = { text, updatedAt: new Date().toISOString() }; changed(); } },
    drills: {
      save: async (drill) => {
        const existing = data.drills.find((d) => d.id === drill.id);
        if (existing) Object.assign(existing, drill); else data.drills.push({ ...drill, id: `drill-${Date.now()}`, practicedCount: 0, createdAt: new Date().toISOString() });
        changed();
      },
      delete: async (drillID) => { data.drills = data.drills.filter((d) => d.id !== drillID); changed(); },
      practiced: async (drillID) => { const d = data.drills.find((x) => x.id === drillID); if (d) { d.practicedCount += 1; changed(); } },
    },
    recording: {
      pick: async () => emit('recording', { state: 'picking', sources: [{ id: 'w1', name: 'Overwatch', thumbnail: null }, { id: 'w2', name: 'Discord', thumbnail: null }] }),
      cancel: async () => emit('recording', { state: 'idle' }),
      start: async (_source, options) => {
        emit('recording', { state: 'recording', startedAt: new Date().toISOString(), windowName: options.windowName, sizeBytes: 0 });
      },
      stop: async () => {
        emit('recording', { state: 'preparing', progress: 0.4 });
        await wait(2500);
        emit('recording', { state: 'idle' });
      },
      dismiss: async () => emit('recording', { state: 'idle' }),
      status: async () => ({ state: 'idle' }),
      onChange: (fn) => listeners.recording.push(fn),
    },
  };
}
