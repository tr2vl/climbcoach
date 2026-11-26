// Short clips around each reviewed death (10 s before, 3 after) and each habit moment (6 before, 4 after),
// so the reels still play after a recording is deleted. The window cuts them by replaying the recording;
// this side lists what's missing and stores what comes back. (Port of DeathClips and HabitClips.)
import fs from 'node:fs';
import path from 'node:path';
import { deathsOf, habitChecksOf, latestCompletedRun } from '../shared/match.js';

export const CLIP_SPANS = { death: { before: 10, after: 3 }, habit: { before: 6, after: 4 } };
export const clipName = (kind, timestamp) => `${kind}-${Math.round(timestamp * 10)}.mp4`;

export class Clips {
  constructor(folder) {
    this.folder = folder;
  }

  file(matchID, kind, timestamp) {
    return path.join(this.folder, matchID, clipName(kind, timestamp));
  }

  /** { matchID: ['death-123.mp4', …] } for the window. */
  index() {
    const result = {};
    if (!fs.existsSync(this.folder)) return result;
    for (const id of fs.readdirSync(this.folder)) {
      const dir = path.join(this.folder, id);
      if (fs.statSync(dir).isDirectory()) result[id] = fs.readdirSync(dir).filter((f) => f.endsWith('.mp4'));
    }
    return result;
  }

  /** Clips still to cut for matches whose recording exists. */
  missing(matches) {
    const jobs = [];
    for (const match of matches.filter((m) => !m.isReference && m.video && !m.video.deletedAt && fs.existsSync(m.video.path))) {
      const run = latestCompletedRun(match);
      if (!run) continue;
      const moments = [...deathsOf(run).map((d) => ['death', d.timestamp]), ...habitChecksOf(run).map((c) => ['habit', c.timestamp])];
      for (const [kind, timestamp] of moments) {
        if (fs.existsSync(this.file(match.id, kind, timestamp))) continue;
        const span = CLIP_SPANS[kind];
        const start = Math.max(0, timestamp - span.before);
        const end = Math.min(match.video.durationSeconds || timestamp + span.after, timestamp + span.after);
        if (end - start >= 1) jobs.push({ matchID: match.id, kind, timestamp, video: match.video.path, start, end });
      }
    }
    return jobs;
  }

  save(matchID, kind, timestamp, buffer) {
    const file = this.file(matchID, kind, timestamp);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(buffer));
    return file;
  }
}
