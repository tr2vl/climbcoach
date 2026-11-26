import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HEROES } from '../src/shared/catalog.js';
import { CHECKLIST_VERSION, CHECKLISTS, checklistFor, parseChecklists } from '../src/shared/checklists.js';

test('every hero in the catalog has a checklist of at least 5 items', () => {
  const missing = HEROES.map((h) => h.key).filter((key) => !checklistFor(key));
  assert.deepEqual(missing, []);
  for (const hero of HEROES) assert.ok(checklistFor(hero.key).length >= 5, `${hero.key} needs at least 5 items`);
  assert.deepEqual(Object.keys(CHECKLISTS).filter((key) => !HEROES.some((h) => h.key === key)), []);
});

test('checklists are parsed from the shared markdown', () => {
  const parsed = parseChecklists('# Title\nVersion: 2027-01-02\n- not a hero item\n## Ana · `ana`\n- First.\n- Second.\n## Notes\n- ignored\n');
  assert.equal(parsed.version, '2027-01-02');
  assert.deepEqual(parsed.lists, { ana: ['First.', 'Second.'] });
  assert.equal(CHECKLIST_VERSION, '2026-11-26');
  assert.match(checklistFor('soldier-76')[0], /Heavy Pulse Rifle/);
});
