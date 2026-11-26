import path from 'node:path';
import { readJSON, writeJSON } from './jsonfile.js';

/** Nothing is assumed about how you play: the get-started screen asks. */
export const emptyProfile = () => ({ inGameName: '', platform: null, region: null, roles: [] });

export class Settings {
  constructor(folder) {
    this.file = path.join(folder, 'settings.json');
    this.data = { profile: emptyProfile(), onboardingDone: false, tourDone: false, prefs: {}, ...readJSON(this.file, {}) };
  }

  get() {
    return structuredClone(this.data);
  }

  update(patch) {
    this.data = { ...this.data, ...patch };
    writeJSON(this.file, this.data);
    return this.get();
  }
}
