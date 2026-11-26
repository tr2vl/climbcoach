// Win, pick and ban rates per hero from the community OverFast API (no key), kept daily, and the kits of
// your heroes, watched for changes (port of OverFastClient, MetaCenter, MetaStore, HeroKitStore).
import path from 'node:path';
import { heroKeyFor } from '../shared/catalog.js';
import { kitDiff, metaQuery, queryKey } from '../shared/meta.js';
import { readJSON, writeJSON } from './jsonfile.js';

const BASE = 'https://overfast-api.tekrop.fr';
// Identifies the app without any personal data.
const USER_AGENT = 'ClimbCoach/1.0 (personal Overwatch coaching app)';

export class OverFast {
  constructor(fetchImpl = fetch) {
    this.fetch = fetchImpl;
  }

  async #get(route) {
    const response = await this.fetch(`${BASE}${route}`, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(30_000) });
    if (response.status !== 200) throw new Error(`The OverFast service answered with error ${response.status}. Try again later.`);
    try { return await response.json(); } catch { throw new Error('The OverFast service sent data ClimbCoach doesn\'t understand.'); }
  }

  async heroStats(query) {
    const params = new URLSearchParams({ platform: query.platform, gamemode: query.gamemode, region: query.region });
    if (query.division) params.set('competitive_division', query.division);
    return (await this.#get(`/heroes/stats?${params}`)).map((s) => ({ hero: s.hero, pickrate: s.pickrate, winrate: s.winrate, banrate: s.banrate ?? null }));
  }

  async heroKit(heroKey) {
    const details = await this.#get(`/heroes/${heroKey}`);
    const abilities = Object.fromEntries((details.abilities ?? []).map((a) => [a.name, a.description ?? '']));
    const perks = Object.fromEntries(Object.entries(details.perks ?? {}).flatMap(([tier, items]) => items.map((p) => [`${p.name} (${tier} perk)`, p.description ?? ''])));
    return { abilities, perks, hitpoints: details.hitpoints ?? {} };
  }
}

export class Meta {
  constructor({ db, folder, settings, notify = () => {}, client = new OverFast() }) {
    Object.assign(this, { db, settings, notify, client });
    this.kitFile = folder ? path.join(folder, 'hero-kits.json') : null;
    this.kits = { kits: {}, fetchedAt: {}, changes: [], ...(this.kitFile ? readJSON(this.kitFile, {}) : {}) };
    this.refreshing = false;
    this.error = null;
  }

  view() {
    return { refreshing: this.refreshing, error: this.error, kitChanges: [...this.kits.changes].sort((a, b) => new Date(b.detectedAt) - new Date(a.detectedAt)),
      kitsCheckedAt: Object.values(this.kits.fetchedAt).sort().at(-1) ?? null, defaultQuery: this.defaultQuery() };
  }

  /** The bracket of your highest-ranked role, in the region you play in. */
  defaultQuery() {
    const profile = this.settings.get().profile;
    const tiers = ['bronze', 'silver', 'gold', 'platinum', 'emerald', 'diamond', 'master', 'grandmaster', 'champion'];
    const best = profile.roles.map((r) => r.rank).filter(Boolean).sort((a, b) => (tiers.indexOf(b.tier) * 5 - b.division) - (tiers.indexOf(a.tier) * 5 - a.division))[0] ?? null;
    return metaQuery(best, profile.region ?? 'europe', profile.platform === 'console' ? 'console' : 'pc');
  }

  isStale(query, now = new Date()) {
    const last = this.db.data.heroStats.filter((s) => s.query === queryKey(query)).map((s) => s.fetchedAt).sort().at(-1);
    return !last || now - new Date(last) > 20 * 3600_000;
  }

  async refreshStats(query = this.defaultQuery()) {
    if (this.refreshing) return;
    this.refreshing = true;
    this.notify(this.view());
    try {
      const stats = await this.client.heroStats(query);
      const fetchedAt = new Date().toISOString();
      const byKey = {};
      for (const s of stats) {
        const key = heroKeyFor(s.hero) ?? s.hero;
        byKey[key] = { pickrate: s.pickrate, winrate: s.winrate, banrate: s.banrate };
      }
      this.db.data.heroStats.push({ query: queryKey(query), fetchedAt, stats: byKey });
      // Keep 60 days of snapshots: the patch radar compares against about a week ago.
      this.db.data.heroStats = this.db.data.heroStats.filter((s) => Date.now() - new Date(s.fetchedAt) < 60 * 86_400_000);
      this.db.changed();
      this.error = null;
    } catch (error) {
      this.error = error.message;
    } finally {
      this.refreshing = false;
      this.notify(this.view());
    }
  }

  /** Fetches the kits of your heroes not checked in the last day and records what changed. */
  async refreshKits(now = new Date()) {
    const heroes = [...new Set(this.settings.get().profile.roles.flatMap((r) => r.heroKeys))];
    for (const hero of heroes.filter((h) => !this.kits.fetchedAt[h] || now - new Date(this.kits.fetchedAt[h]) > 20 * 3600_000)) {
      try {
        const kit = await this.client.heroKit(hero);
        const changes = this.kits.kits[hero] ? kitDiff(this.kits.kits[hero], kit, hero, now.toISOString()) : [];
        this.kits.kits[hero] = kit;
        this.kits.fetchedAt[hero] = now.toISOString();
        this.kits.changes = [...this.kits.changes, ...changes].filter((c) => now - new Date(c.detectedAt) < 90 * 86_400_000);
      } catch { /* the next refresh tries again */ }
    }
    if (this.kitFile) writeJSON(this.kitFile, this.kits);
    this.notify(this.view());
  }

  async refreshIfStale() {
    const query = this.defaultQuery();
    if (this.isStale(query)) await this.refreshStats(query);
    await this.refreshKits();
  }
}
