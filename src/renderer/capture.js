// Records the game window in the window process (Chromium's screen capture and MediaRecorder), sends the
// video to the main process in 2-second pieces and about one frame a second for the HUD reader, with the
// kill-feed corner enlarged. Also reads the HUD of imported videos (seeking through them second by second)
// and cuts the death and habit clips by replaying a recording. Runs in the real app only.
import { KILL_FEED_REGION } from '../shared/hud.js';

const TYPES = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1.640028,opus', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'];
const pickType = () => TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
const FULL = { x: 0, y: 0, w: 1, h: 1 };
// The top of the screen, where your death screens are; the whole frame near the end for the end banner.
const DEATH_BAND = { x: 0, y: 0, w: 1, h: 0.2 };

/**
 * A muted video of one of the app's own files, readable frame by frame. It sits in the page, invisible:
 * Chromium treats a video outside the page as a background player and seeks it ~20× slower.
 */
function workVideo(url, { withSound = false } = {}) {
  const video = Object.assign(document.createElement('video'), { crossOrigin: 'anonymous', src: url, preload: 'auto', muted: !withSound, playsInline: true });
  // A clip keeps its sound: the video plays at volume 0 instead of muted, which would silence the copy.
  if (withSound) video.volume = 0;
  Object.assign(video.style, { position: 'fixed', left: '0', top: '0', width: '4px', height: '4px', opacity: '0', pointerEvents: 'none', zIndex: '-1' });
  document.body.append(video);
  video.dispose = () => { video.removeAttribute('src'); video.load(); video.remove(); };
  return video;
}

/** A JPEG of `region` of the video's current frame, scaled by `scale` but at most `maxWidth` wide. */
async function grab(video, canvas, region = FULL, { scale = 1, maxWidth = 1920 } = {}) {
  const sx = region.x * video.videoWidth;
  const sy = region.y * video.videoHeight;
  const sw = region.w * video.videoWidth;
  const sh = region.h * video.videoHeight;
  const w = Math.round(Math.min(maxWidth, sw * scale));
  const h = Math.round((w * sh) / sw);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  canvas.getContext('2d').drawImage(video, sx, sy, sw, sh, 0, 0, w, h);
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
  return blob.arrayBuffer();
}

export function captureController(climb) {
  let session = null;

  async function start(sourceId, { sound = true, windowName = '', killFeed = true } = {}) {
    await climb.recording.choose(sourceId, { sound, windowName });
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: sound });
    } catch (error) {
      await climb.recording.finish({ duration: 0, error: `Windows didn't let ClimbCoach record that window (${error.message}).` });
      return;
    }
    const mimeType = pickType();
    // A keyframe every 2 s: each 2-second piece of the file then starts on one, so the recording can be
    // cut to the match afterwards without re-encoding (trim.js).
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 160_000, videoKeyFrameIntervalDuration: 2000 });
    const track = stream.getVideoTracks()[0];
    const { width = 0, height = 0 } = track.getSettings();
    await climb.recording.begin({ extension: mimeType.includes('mp4') ? 'mp4' : 'webm', width, height });
    const video = Object.assign(document.createElement('video'), { muted: true, srcObject: stream });
    await video.play().catch(() => {});
    const canvas = new OffscreenCanvas(16, 16);
    const feedCanvas = new OffscreenCanvas(16, 16);
    session = { stream, recorder, video, startedAt: performance.now(), writes: Promise.resolve(), stopTimer: null, sampler: null, error: null };
    const s = session;
    recorder.ondataavailable = (event) => {
      if (!event.data.size) return;
      s.writes = s.writes.then(async () => climb.recording.chunk(await event.data.arrayBuffer())).catch((error) => { s.error = error.message; });
    };
    recorder.onstop = async () => {
      await s.writes;
      const duration = (performance.now() - s.startedAt) / 1000;
      const hasAudio = s.stream.getAudioTracks().length > 0;
      s.stream.getTracks().forEach((t) => t.stop());
      session = null;
      await climb.recording.finish({ duration, hasAudio, error: s.error });
    };
    recorder.start(2000);
    // About once a second: a frame for the HUD reader, and the kill feed enlarged (its text is small).
    // The end banner stops the recording 8 s later.
    s.sampler = setInterval(async () => {
      if (!video.videoWidth || s.grabbing) return;
      s.grabbing = true;
      try {
        const time = (performance.now() - s.startedAt) / 1000;
        const frame = await grab(video, canvas);
        const feed = killFeed ? await grab(video, feedCanvas, KILL_FEED_REGION, { scale: 2, maxWidth: 1800 }) : null;
        const end = await climb.recording.frame(frame, time, feed);
        if (end && !s.stopTimer) s.stopTimer = setTimeout(stop, 8000);
      } finally {
        s.grabbing = false;
      }
    }, 1000);
    // The game window closed: stop and keep what was recorded.
    track.addEventListener('ended', stop);
  }

  function stop() {
    const s = session;
    if (!s) return;
    clearInterval(s.sampler);
    clearTimeout(s.stopTimer);
    if (s.recorder.state !== 'inactive') s.recorder.stop();
  }

  // ---------- Reading the HUD of an imported video ----------

  /**
   * Seeks to each of `job.times` (the video's keyframes, mostly) and sends the top of each frame (death
   * screens) and the kill-feed corner to the main process, the whole frame in the last 3 minutes (end
   * banner). The main process reads them and answers false once the scan was cancelled.
   */
  async function scan(job) {
    const video = workVideo(job.url);
    const canvas = new OffscreenCanvas(16, 16);
    const feedCanvas = new OffscreenCanvas(16, 16);
    try {
      await new Promise((resolve, reject) => { video.onloadedmetadata = resolve; video.onerror = () => reject(new Error('Windows can\'t play this video.')); });
      const duration = Number.isFinite(video.duration) ? video.duration : job.duration;
      for (const time of job.times.filter((t) => t < duration)) {
        video.currentTime = time;
        const seeked = await Promise.race([new Promise((resolve) => { video.onseeked = () => resolve(true); }), new Promise((resolve) => setTimeout(() => resolve(false), 8000))]);
        if (!seeked || !video.videoWidth) continue;
        const region = time > duration - 180 ? FULL : DEATH_BAND;
        const frame = await grab(video, canvas, region);
        const feed = job.killFeed ? await grab(video, feedCanvas, KILL_FEED_REGION, { scale: 2, maxWidth: 1800 }) : null;
        const go = await climb.scan.frame(job.id, { time, duration, region, frame, feed });
        if (!go) break;
      }
      await climb.scan.done(job.id, null);
    } catch (error) {
      await climb.scan.done(job.id, error.message);
    } finally {
      video.dispose();
    }
  }

  climb.scan?.onJob((job) => scan(job));

  // ---------- Clips ----------

  let cutting = false;
  const queue = [];

  async function cut(job) {
    const video = workVideo(job.url, { withSound: true });
    try {
      await new Promise((resolve, reject) => { video.onloadedmetadata = resolve; video.onerror = () => reject(new Error('unplayable')); });
      video.currentTime = job.start;
      await new Promise((resolve) => { video.onseeked = resolve; });
      const stream = video.captureStream();
      const recorder = new MediaRecorder(stream, { mimeType: pickType(), videoBitsPerSecond: 6_000_000 });
      const chunks = [];
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      const stopped = new Promise((resolve) => { recorder.onstop = resolve; });
      recorder.start();
      await video.play();
      // Checked on a timer, not per animation frame: those stop while the window is minimised.
      await new Promise((resolve) => {
        const timer = setInterval(() => { if (video.currentTime >= job.end || video.ended) { clearInterval(timer); resolve(); } }, 100);
        setTimeout(() => { clearInterval(timer); resolve(); }, (job.end - job.start + 5) * 1000);
      });
      recorder.stop();
      video.pause();
      await stopped;
      const blob = new Blob(chunks, { type: chunks[0]?.type ?? 'video/mp4' });
      if (blob.size > 10_000) await climb.clips.save(job.matchID, job.kind, job.timestamp, await blob.arrayBuffer());
    } finally {
      video.dispose();
    }
  }

  async function cutAll(jobs) {
    queue.push(...jobs.filter((j) => !queue.some((q) => q.matchID === j.matchID && q.kind === j.kind && q.timestamp === j.timestamp)));
    if (cutting) return;
    cutting = true;
    while (queue.length) {
      // Never while you're recording: it would compete with the game for the graphics card.
      if (session) { await new Promise((r) => setTimeout(r, 30_000)); continue; }
      await cut(queue.shift()).catch(() => {});
    }
    cutting = false;
    await climb.clips.done();
  }

  climb.clips?.onJobs((jobs) => cutAll(jobs));
  return { start, stop, get recording() { return Boolean(session); } };
}
