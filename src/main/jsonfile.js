import fs from 'node:fs';
import path from 'node:path';

/** Reads a JSON file, or returns `fallback` when it is missing or unreadable. */
export function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/** Writes through a temporary file and a rename, so a crash never leaves half a file. */
export function writeJSON(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2));
  fs.renameSync(temporary, file);
}
