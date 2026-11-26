// Heroes, maps, roles and ranks. Copied from the Mac app's catalogs (HeroCatalog+Seed, MapCatalog+Seed).

export const ROLES = [
  { key: 'tank', name: 'Tank', short: 'TANK' },
  { key: 'damage', name: 'Damage', short: 'DPS' },
  { key: 'support', name: 'Support', short: 'SUP' },
];

export const HEROES = [
  { key: 'ana', name: 'Ana', role: 'support' },
  { key: 'anran', name: 'Anran', role: 'damage' },
  { key: 'ashe', name: 'Ashe', role: 'damage' },
  { key: 'baptiste', name: 'Baptiste', role: 'support' },
  { key: 'bastion', name: 'Bastion', role: 'damage' },
  { key: 'brigitte', name: 'Brigitte', role: 'support' },
  { key: 'cassidy', name: 'Cassidy', role: 'damage' },
  { key: 'dmon', name: 'D.Mon', role: 'tank' },
  { key: 'doctrine', name: 'Doctrine', role: 'support' },
  { key: 'domina', name: 'Domina', role: 'tank' },
  { key: 'doomfist', name: 'Doomfist', role: 'tank' },
  { key: 'dva', name: 'D.Va', role: 'tank' },
  { key: 'echo', name: 'Echo', role: 'damage' },
  { key: 'emre', name: 'Emre', role: 'damage' },
  { key: 'freja', name: 'Freja', role: 'damage' },
  { key: 'genji', name: 'Genji', role: 'damage' },
  { key: 'hanzo', name: 'Hanzo', role: 'damage' },
  { key: 'hazard', name: 'Hazard', role: 'tank' },
  { key: 'illari', name: 'Illari', role: 'support' },
  { key: 'jetpack-cat', name: 'Jetpack Cat', role: 'support' },
  { key: 'junker-queen', name: 'Junker Queen', role: 'tank' },
  { key: 'junkrat', name: 'Junkrat', role: 'damage' },
  { key: 'juno', name: 'Juno', role: 'support' },
  { key: 'kiriko', name: 'Kiriko', role: 'support' },
  { key: 'lifeweaver', name: 'Lifeweaver', role: 'support' },
  { key: 'lucio', name: 'Lúcio', role: 'support' },
  { key: 'mauga', name: 'Mauga', role: 'tank' },
  { key: 'mei', name: 'Mei', role: 'damage' },
  { key: 'mercy', name: 'Mercy', role: 'support' },
  { key: 'mizuki', name: 'Mizuki', role: 'support' },
  { key: 'moira', name: 'Moira', role: 'support' },
  { key: 'orisa', name: 'Orisa', role: 'tank' },
  { key: 'pharah', name: 'Pharah', role: 'damage' },
  { key: 'ramattra', name: 'Ramattra', role: 'tank' },
  { key: 'reaper', name: 'Reaper', role: 'damage' },
  { key: 'reinhardt', name: 'Reinhardt', role: 'tank' },
  { key: 'roadhog', name: 'Roadhog', role: 'tank' },
  { key: 'shion', name: 'Shion', role: 'damage' },
  { key: 'sierra', name: 'Sierra', role: 'damage' },
  { key: 'sigma', name: 'Sigma', role: 'tank' },
  { key: 'sojourn', name: 'Sojourn', role: 'damage' },
  { key: 'soldier-76', name: 'Soldier: 76', role: 'damage' },
  { key: 'sombra', name: 'Sombra', role: 'support' },
  { key: 'symmetra', name: 'Symmetra', role: 'damage' },
  { key: 'torbjorn', name: 'Torbjörn', role: 'damage' },
  { key: 'tracer', name: 'Tracer', role: 'damage' },
  { key: 'vendetta', name: 'Vendetta', role: 'damage' },
  { key: 'venture', name: 'Venture', role: 'damage' },
  { key: 'widowmaker', name: 'Widowmaker', role: 'damage' },
  { key: 'winston', name: 'Winston', role: 'tank' },
  { key: 'wrecking-ball', name: 'Wrecking Ball', role: 'tank' },
  { key: 'wuyang', name: 'Wuyang', role: 'support' },
  { key: 'zarya', name: 'Zarya', role: 'tank' },
  { key: 'zenyatta', name: 'Zenyatta', role: 'support' },
];

export const MODES = ['push', 'control', 'escort', 'hybrid', 'flashpoint'];

export const MAPS = [
  { key: 'aatlis', name: 'Aatlis', modes: ['flashpoint'] },
  { key: 'antarctic-peninsula', name: 'Antarctic Peninsula', modes: ['control'] },
  { key: 'blizzard-world', name: 'Blizzard World', modes: ['hybrid'] },
  { key: 'busan', name: 'Busan', modes: ['control'] },
  { key: 'circuit-royal', name: 'Circuit Royal', modes: ['escort'] },
  { key: 'colosseo', name: 'Colosseo', modes: ['push'] },
  { key: 'dorado', name: 'Dorado', modes: ['escort'] },
  { key: 'eichenwalde', name: 'Eichenwalde', modes: ['hybrid'] },
  { key: 'esperanca', name: 'Esperança', modes: ['push'] },
  { key: 'grimsvotn', name: 'Grímsvötn', modes: ['escort'] },
  { key: 'havana', name: 'Havana', modes: ['escort'] },
  { key: 'hollywood', name: 'Hollywood', modes: ['hybrid'] },
  { key: 'ilios', name: 'Ilios', modes: ['control'] },
  { key: 'junkertown', name: 'Junkertown', modes: ['escort'] },
  { key: 'kings-row', name: 'King’s Row', modes: ['hybrid'] },
  { key: 'lijiang-tower', name: 'Lijiang Tower', modes: ['control'] },
  { key: 'midtown', name: 'Midtown', modes: ['hybrid'] },
  { key: 'neon-junction', name: 'Neon Junction', modes: ['hybrid'] },
  { key: 'nepal', name: 'Nepal', modes: ['control'] },
  { key: 'new-junk-city', name: 'New Junk City', modes: ['flashpoint'] },
  { key: 'new-queen-street', name: 'New Queen Street', modes: ['push'] },
  { key: 'numbani', name: 'Numbani', modes: ['hybrid'] },
  { key: 'oasis', name: 'Oasis', modes: ['control'] },
  { key: 'paraiso', name: 'Paraíso', modes: ['hybrid'] },
  { key: 'rialto', name: 'Rialto', modes: ['escort'] },
  { key: 'route-66', name: 'Route 66', modes: ['escort'] },
  { key: 'runasapi', name: 'Runasapi', modes: ['push'] },
  { key: 'samoa', name: 'Samoa', modes: ['control'] },
  { key: 'shambali-monastery', name: 'Shambali Monastery', modes: ['escort'] },
  { key: 'suravasa', name: 'Suravasa', modes: ['flashpoint'] },
  { key: 'watchpoint-gibraltar', name: 'Watchpoint: Gibraltar', modes: ['escort'] },
];

export const RANK_TIERS = ['bronze', 'silver', 'gold', 'platinum', 'emerald', 'diamond', 'master', 'grandmaster', 'champion'];

const heroByKey = new Map(HEROES.map((hero) => [hero.key, hero]));
const mapByKey = new Map(MAPS.map((map) => [map.key, map]));

export const hero = (key) => heroByKey.get(key) ?? null;
export const heroName = (key) => heroByKey.get(key)?.name ?? key;
export const heroesFor = (role) => HEROES.filter((h) => h.role === role);
export const gameMap = (key) => mapByKey.get(key) ?? null;
export const roleName = (key) => ROLES.find((r) => r.key === key)?.name ?? key;
export const modeName = (mode) => mode.charAt(0).toUpperCase() + mode.slice(1);
export const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/** "Bronze 1"; division 5 is the lowest of a tier, 1 the highest. */
export const rankText = (rank) => (rank ? `${capitalize(rank.tier)} ${rank.division}` : 'Unranked');

/** Bronze 5 = 1 … Champion 1 = 45. */
export const ladderValue = (rank) => RANK_TIERS.indexOf(rank.tier) * 5 + (6 - rank.division);

/** Matches a hero name as written in the kill feed or by the AI ("Soldier: 76", "soldier-76", "Lucio"). */
export function heroKeyFor(text) {
  if (!text) return null;
  const trimmed = String(text).trim();
  if (heroByKey.has(trimmed.toLowerCase())) return trimmed.toLowerCase();
  const fold = (value) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const wanted = fold(trimmed);
  return HEROES.find((h) => fold(h.name) === wanted || fold(h.key) === wanted)?.key ?? null;
}
