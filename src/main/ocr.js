// Reads text from images with Windows' built-in OCR, through a long-running Windows PowerShell worker
// (ocr.ps1). One image at a time; frames that arrive while it is busy are skipped by the caller.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// PowerShell can't read inside app.asar, so the script ships unpacked next to it.
export const SCRIPT = path.join(here, 'ocr.ps1').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

export class OcrWorker {
  constructor({ spawnImpl = spawn, script = SCRIPT } = {}) {
    this.spawn = spawnImpl;
    this.script = script;
    this.process = null;
    this.pending = [];
    this.buffer = '';
    this.ready = null;
    this.error = null;
  }

  get available() {
    return process.platform === 'win32' || this.spawn !== spawn;
  }

  #start() {
    if (this.process) return this.ready;
    this.process = this.spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.script], { windowsHide: true });
    this.ready = new Promise((resolve, reject) => { this.onReady = resolve; this.onFatal = reject; });
    this.process.stdout.setEncoding('utf8');
    this.process.stdout.on('data', (data) => this.#read(data));
    // Windows' own error text, kept short, so a failure can be diagnosed from a log.
    this.stderr = '';
    this.process.stderr?.setEncoding?.('utf8');
    this.process.stderr?.on('data', (data) => { this.stderr = (this.stderr + data).slice(-2000); });
    this.process.on('exit', () => {
      this.process = null;
      const detail = this.stderr.trim().split('\n').slice(-6).join(' ').slice(0, 600);
      const error = new Error(this.error ?? `The text reader stopped.${detail ? ` ${detail}` : ''}`);
      this.onFatal?.(error);
      for (const job of this.pending.splice(0)) job.reject(error);
    });
    return this.ready;
  }

  #read(data) {
    this.buffer += data;
    let index;
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      if (message.ready) { this.onReady(message.language); continue; }
      if (message.fatal) { this.error = message.fatal; this.onFatal(new Error(message.fatal)); continue; }
      const job = this.pending.shift();
      if (!job) continue;
      if (message.error) job.reject(new Error(message.error));
      else job.resolve((Array.isArray(message.lines) ? message.lines : message.lines ? [message.lines] : []).filter((l) => l.text));
    }
  }

  /** The text lines of an image file, with normalised boxes. */
  async read(file) {
    await this.#start();
    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject });
      this.process.stdin.write(`${file}\n`);
    });
  }

  stop() {
    this.process?.stdin.end();
    this.process?.kill();
    this.process = null;
  }
}
