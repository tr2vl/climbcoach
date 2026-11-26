import electronUpdater from 'electron-updater';

const { autoUpdater } = electronUpdater;

/**
 * Updates come from the GitHub releases of the ClimbCoach repository. The app checks at launch and
 * every 4 hours, downloads in the background, and installs when you restart (or quit) the app.
 */
export class Updates {
  static interval = 4 * 60 * 60 * 1000;

  constructor({ isPackaged, send }) {
    this.isPackaged = isPackaged;
    this.send = send;
    this.status = { state: isPackaged ? 'idle' : 'dev', version: null, progress: 0, error: null };
  }

  #set(patch) {
    this.status = { ...this.status, ...patch };
    this.send(this.status);
  }

  start() {
    if (!this.isPackaged) return;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('checking-for-update', () => this.#set({ state: 'checking', error: null }));
    autoUpdater.on('update-available', (info) => this.#set({ state: 'downloading', version: info.version, progress: 0 }));
    autoUpdater.on('update-not-available', () => this.#set({ state: 'current' }));
    autoUpdater.on('download-progress', (progress) => this.#set({ state: 'downloading', progress: Math.round(progress.percent) }));
    autoUpdater.on('update-downloaded', (info) => this.#set({ state: 'ready', version: info.version, progress: 100 }));
    autoUpdater.on('error', (error) => this.#set({ state: 'error', error: error.message }));
    this.check();
    setInterval(() => this.check(), Updates.interval);
  }

  async check() {
    if (!this.isPackaged) return this.status;
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      this.#set({ state: 'error', error: error.message });
    }
    return this.status;
  }

  install() {
    if (this.status.state === 'ready') autoUpdater.quitAndInstall(false, true);
  }
}
