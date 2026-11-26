// Hero-mechanics checklists (rubric §10), one per hero, read from HERO_CHECKLISTS.md (copied in by
// scripts/sync-checklists.mjs). Versioned because kits and perks change with patches. A hero without a
// checklist (one added to the game after this version) makes Hero mechanics "not assessable".
import { CHECKLISTS_TEXT } from './checklists-text.js';

/** "Version: 2026-11-26", then "## Name · `key`" headings each followed by "- item" lines. */
export function parseChecklists(markdown) {
  let version = 'unknown';
  const lists = {};
  let current = null;
  for (const line of markdown.split('\n')) {
    if (line.startsWith('Version: ')) version = line.slice(9).trim();
    else if (line.startsWith('## ')) current = line.split('`')[1] ?? null;
    else if (line.startsWith('- ') && current) (lists[current] ??= []).push(line.slice(2).trim());
    else if (line.startsWith('#')) current = null;
  }
  return { version, lists };
}

const parsed = parseChecklists(CHECKLISTS_TEXT);
export const CHECKLIST_VERSION = parsed.version;
export const CHECKLISTS = parsed.lists;
export const checklistFor = (heroKey) => CHECKLISTS[heroKey] ?? null;
