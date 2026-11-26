import { app, BrowserWindow, dialog, ipcMain, net, protocol, safeStorage, session, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AnalysisCenter } from './analysis/center.js';
import { Database } from './db.js';
import { exportReport } from './export.js';
import { GeminiState } from './gemini/quota.js';
import { KeyVault, testKey } from './keys.js';
import { Clips } from './clips.js';
import { HudScanner } from './hudscan.js';
import { Learn } from './learn.js';
import { Meta } from './meta.js';
import { OcrWorker } from './ocr.js';
import { applyRetention, Recorder } from './recorder.js';
import { Settings } from './settings.js';
import { Training } from './training.js';
import { Updates } from './updates.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

// app://climbcoach/… serves the window's pages like a normal secure website; media://local/… streams your
// videos and clips (with seeking) from the folders ClimbCoach knows about.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  // corsEnabled + the header below let the window read frames of its own videos (HUD scan, clips).
  { scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true, corsEnabled: true } },
]);

const services = {};
let window = null;

const send = (channel, payload) => {
  if (!window || window.isDestroyed()) return false;
  window.webContents.send(channel, payload);
  return true;
};

function serveFiles() {
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url);
    const file = path.normalize(path.join(root, decodeURIComponent(pathname)));
    const allowed = [path.join(root, 'renderer'), path.join(root, 'shared')];
    if (!allowed.some((folder) => file.startsWith(folder + path.sep))) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  protocol.handle('media', (request) => {
    const file = decodeURIComponent(new URL(request.url).pathname.slice(1));
    if (!mediaAllowed(file) || !fs.existsSync(file)) return new Response('Not found', { status: 404 });
    return streamFile(file, request.headers.get('range'));
  });
}

/** Only your match videos, scoreboard pictures and the app's clip folders are served to the window. */
function mediaAllowed(file) {
  const normalized = path.normalize(file);
  const folders = [services.paths.videos, services.paths.clips, services.paths.screenshots];
  if (folders.some((folder) => normalized.startsWith(folder + path.sep))) return true;
  if (services.pickedFiles.has(normalized)) return true;
  return services.db.data.matches.some((m) => m.video?.path && path.normalize(m.video.path) === normalized);
}

const TYPES = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska', '.jpg': 'image/jpeg', '.png': 'image/png' };

/** A file with HTTP range support, so the video player can seek. Only the app's own page may read it. */
function streamFile(file, range) {
  const size = fs.statSync(file).size;
  const type = TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  const match = range && /bytes=(\d*)-(\d*)/.exec(range);
  const shared = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': 'app://climbcoach' };
  if (!match) {
    return new Response(Readable.toWeb(fs.createReadStream(file)), { status: 200, headers: { ...shared, 'Content-Length': String(size) } });
  }
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), {
    status: 206,
    headers: { ...shared, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${size}` },
  });
}

function createWindow() {
  window = new BrowserWindow({
    width: 1360, height: 880, minWidth: 1100, minHeight: 700, backgroundColor: '#0E1420', title: 'ClimbCoach', show: false,
    // Our own dark title bar; Windows still draws its minimise, maximise and close buttons on the right.
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0A0F18', symbolColor: '#A9B4C6', height: 36 },
    // No background throttling: the recording and its HUD reader keep running while you play.
    webPreferences: { preload: path.join(root, 'preload', 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
  });
  window.once('ready-to-show', () => { if (!process.env.CLIMBCOACH_SMOKE) window.show(); });
  if (process.env.CLIMBCOACH_SMOKE) {
    // Self-check used while developing: load the page, report what rendered, quit.
    window.webContents.on('console-message', (event) => console.log('[page]', event.message));
    window.webContents.once('did-finish-load', async () => {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      if (process.env.CLIMBCOACH_SMOKE_SCAN) {
        // Reads the HUD of a video with a stand-in for Windows' OCR: checks seeking, frames and timing.
        let reads = 0;
        services.ocr.read = async () => { reads += 1; return []; };
        Object.defineProperty(services.ocr, 'available', { get: () => true });
        const started = Date.now();
        const hints = await services.hudScan.scan({ id: 'smoke', video: { path: process.env.CLIMBCOACH_SMOKE_SCAN, durationSeconds: Number(process.env.CLIMBCOACH_SMOKE_SECONDS) } }, () => {});
        console.log('SCAN', JSON.stringify({ hints, reads, seconds: (Date.now() - started) / 1000 }));
      }
      const result = await window.webContents.executeJavaScript(process.env.CLIMBCOACH_SMOKE_JS ??
        'JSON.stringify({ bridge: typeof window.climb, onboarding: Boolean(document.querySelector(".onboarding")), screen: document.querySelector(".screen-header h1")?.textContent })');
      console.log('SMOKE', result);
      app.quit();
    });
  }
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  window.loadURL('app://climbcoach/renderer/index.html');
}

/** After a report: the coach updates your training, missing clips get cut, old recordings make room. */
async function afterReport() {
  await refreshCoach();
  sendClipJobs();
}

function sendClipJobs() {
  if (services.settings.get().prefs?.keepClips === false) return;
  const jobs = services.clips.missing(services.db.data.matches);
  if (jobs.length) send('clips:jobs', jobs.map((job) => ({ ...job, url: mediaURL(job.video) })));
  else applyRetention(services.db, services.settings.get().prefs?.keepRecordings ?? 20);
}

/** Picks a habit or moves on from a learned one, after the common mistakes were regrouped. */
async function refreshCoach() {
  await services.learn.refreshMistakes().catch(() => {});
  const update = services.training.refresh(services.learn.patterns);
  if (update.kind !== 'unchanged') send('training:update', update);
}

function registerIPC() {
  const { settings, keys, db, analysis, learn, meta, updates, state } = services;
  const handle = (channel, fn) => ipcMain.handle(channel, (_event, ...args) => fn(...args));

  handle('app:info', () => ({ version: app.getVersion(), platform: process.platform, isPackaged: app.isPackaged }));
  handle('settings:get', () => settings.get());
  handle('settings:update', (patch) => {
    const next = settings.update(patch);
    if (patch.profile) meta.refreshIfStale().catch(() => {});
    return next;
  });
  handle('keys:status', () => keys.status());
  handle('keys:save', (kind, value) => { keys.save(kind, value); return keys.status(); });
  handle('keys:test', (kind, value) => testKey(kind, value ?? keys.read(kind)));
  handle('shell:open', (url) => { if (typeof url === 'string' && url.startsWith('https://')) shell.openExternal(url); });
  handle('shell:show', (file) => { if (typeof file === 'string' && fs.existsSync(file)) shell.showItemInFolder(file); });
  handle('updates:status', () => updates.status);
  handle('updates:check', () => updates.check());
  handle('updates:install', () => updates.install());
  handle('gemini:usage', () => ({
    today: state.today().map((entry) => ({ ...entry, busyUntil: state.busyUntil(entry.model)?.toISOString() ?? null })),
    bestLeft: analysis.requestsLeft(),
  }));

  handle('data:snapshot', () => ({ ...db.snapshot(), clips: services.clips.index(), clipFolder: services.paths.clips }));
  handle('shell:videos', () => shell.openPath(services.paths.videos));

  const { recorder, clips } = services;
  handle('recording:status', () => recorder.status);
  handle('recording:pick', () => recorder.pick());
  handle('recording:cancel', () => recorder.cancel());
  handle('recording:choose', (sourceId, options) => recorder.choose(sourceId, options));
  handle('recording:begin', (info) => recorder.begin(info));
  handle('recording:chunk', (buffer) => recorder.chunk(buffer));
  handle('recording:frame', (buffer, time, feed) => recorder.frame(buffer, time, feed));
  handle('recording:finish', (info) => recorder.finish(info));
  handle('recording:dismiss', () => recorder.cancel());
  handle('clips:save', (matchID, kind, timestamp, buffer) => { clips.save(matchID, kind, timestamp, buffer); db.changed(); });
  handle('clips:done', () => applyRetention(db, settings.get().prefs?.keepRecordings ?? 20));
  handle('scan:frame', (id, frame) => services.hudScan.frame(id, frame));
  handle('scan:done', (id, error) => services.hudScan.done(id, error));
  handle('matches:pickVideo', async () => {
    const result = await dialog.showOpenDialog(window, { title: 'Pick a match video', properties: ['openFile'],
      filters: [{ name: 'Videos', extensions: ['mp4', 'webm', 'mov', 'mkv'] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    const file = result.filePaths[0];
    services.pickedFiles.add(path.normalize(file));
    return { path: file, name: path.basename(file), sizeBytes: fs.statSync(file).size, url: mediaURL(file) };
  });
  handle('matches:add', (draft) => db.addMatch(draft));
  handle('matches:update', (id, patch) => db.updateMatch(id, patch));
  handle('matches:delete', (id) => {
    const match = db.deleteMatch(id);
    if (match?.video?.isAppOwned && match.video.path) fs.rmSync(match.video.path, { force: true });
    for (const shot of match?.screenshots ?? []) fs.rmSync(shot.path, { force: true });
    fs.rmSync(path.join(services.paths.clips, id), { recursive: true, force: true });
    return true;
  });
  handle('reports:dispute', (runId, findingId, note) => db.dispute(runId, findingId, note));
  handle('reports:killer', (runId, deathId, heroKey) => db.correctKiller(runId, deathId, heroKey));
  handle('exports:save', (matchID, runID, format) => exportReport({ window, db, matchID, runID, format }));

  handle('analysis:status', () => analysis.status());
  handle('analysis:start', (id, options) => analysis.start(id, options));
  handle('analysis:cancel', (id) => analysis.cancel(id));
  handle('analysis:dequeue', (id) => analysis.dequeue(id));

  handle('training:refresh', () => refreshCoach());
  handle('training:start', (struggle) => {
    services.training.start(struggle);
    send('training:update', { kind: 'started', title: struggle.card.title });
  });

  handle('learn:view', () => learn.view());
  handle('learn:search', (query) => learn.search(query));
  handle('learn:study', (video) => learn.study(video));
  handle('learn:autoStudy', () => learn.autoStudy({ includeResting: true }));
  handle('learn:findFix', (id) => learn.findFix(id));

  handle('meta:view', () => meta.view());
  handle('meta:refresh', (query) => meta.refreshStats(query));

  handle('maps:note', (mapKey, text) => {
    db.data.mapNotes[mapKey] = { text, updatedAt: new Date().toISOString() };
    db.changed();
  });
  handle('drills:save', (drill) => {
    const existing = db.data.drills.find((d) => d.id === drill.id);
    if (existing) Object.assign(existing, drill);
    else db.data.drills.push({ ...drill, id: crypto.randomUUID(), createdAt: new Date().toISOString(), practicedCount: 0, lastPracticedAt: null });
    db.changed();
  });
  handle('drills:delete', (id) => { db.data.drills = db.data.drills.filter((d) => d.id !== id); db.changed(); });
  handle('drills:practiced', (id) => {
    const drill = db.data.drills.find((d) => d.id === id);
    if (drill) { drill.practicedCount += 1; drill.lastPracticedAt = new Date().toISOString(); db.changed(); }
  });
}

export const mediaURL = (file) => `media://local/${encodeURIComponent(file)}`;

app.whenReady().then(() => {
  const folder = app.getPath('userData');
  const paths = {
    data: folder,
    videos: path.join(app.getPath('videos'), 'ClimbCoach'),
    clips: path.join(folder, 'clips'),
    screenshots: path.join(folder, 'screenshots'),
  };
  for (const dir of [paths.videos, paths.clips, paths.screenshots]) fs.mkdirSync(dir, { recursive: true });
  let pushTimer = null;
  const settings = new Settings(folder);
  const db = new Database(folder, { onChange: () => { clearTimeout(pushTimer); pushTimer = setTimeout(() => send('data:changed'), 120); } });
  const keys = new KeyVault(folder, safeStorage);
  const state = new GeminiState(folder);
  Object.assign(services, { paths, settings, db, keys, state, pickedFiles: new Set() });
  services.training = new Training(db);
  services.learn = new Learn({ db, folder, keys, state, settings, notify: (view) => send('learn:changed', view) });
  services.meta = new Meta({ db, folder, settings, notify: (view) => send('meta:changed', view) });
  services.ocr = new OcrWorker();
  // Imported videos get their HUD read before the report, like on the Mac (live recordings while you play).
  services.hudScan = new HudScanner({ ocr: services.ocr, send, folder: path.join(paths.screenshots, 'scans'), settings, mediaURL });
  services.analysis = new AnalysisCenter({ db, folder, keys, state, settings, notify: (status) => send('analysis:changed', status), afterReport,
    scanHUD: (match, progress, signal) => services.hudScan.scan(match, progress, signal) });
  services.clips = new Clips(paths.clips);
  services.recorder = new Recorder({ paths, db, settings, analysis: services.analysis, ocr: services.ocr, notify: (status) => send('recording:changed', status) });
  // The window's capture request gets the game window you picked, with the PC's sound when you want it.
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    const source = await services.recorder.displayMediaSource();
    if (!source) return callback({});
    callback(services.recorder.chosen.sound && process.platform === 'win32' ? { video: source, audio: 'loopback' } : { video: source });
  });
  services.updates = new Updates({ isPackaged: app.isPackaged, send: (status) => send('updates:changed', status) });
  serveFiles();
  registerIPC();
  createWindow();
  services.updates.start();
  // Background work at launch: waiting reports, the coach, rank stats, the daily guides.
  setTimeout(async () => {
    services.analysis.processQueue();
    await refreshCoach();
    await services.meta.refreshIfStale().catch(() => {});
    await services.learn.refreshStale().catch(() => {});
    await services.learn.autoStudyIfDue().catch(() => {});
    sendClipJobs();
  }, 1500);
});

app.on('before-quit', () => { services.db?.flush(); services.ocr?.stop(); });
app.on('window-all-closed', () => app.quit());
