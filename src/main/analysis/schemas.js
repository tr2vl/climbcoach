// JSON schemas for Gemini's structured output, and decoding of its answers (port of ResponseSchemas and WireFormat).
import { HEROES, MAPS, heroKeyFor } from '../../shared/catalog.js';
import { CONFIDENCES, parseTimestamp } from '../../shared/rubric.js';
import { GeminiError } from '../gemini/errors.js';

const strings = (values) => ({ type: 'string', enum: values });
const confidence = strings(CONFIDENCES);
const timestamp = { type: 'string', description: 'Absolute video time as m:ss' };
export const DEATH_CAUSES = ['positioning', 'timing', 'cooldown', 'awareness', 'mechanics', 'unavoidable', 'unknown'];

/** A hero on the current roster, or "" when not clearly visible. */
const killerHero = { type: 'string', enum: [...HEROES.map((h) => h.name), ''], description: 'Empty unless the killer\'s hero is clearly visible' };

export function specialistSchema(categories, includesDeaths, includesHabit = false) {
  const properties = {
    categories: { type: 'array', items: { type: 'object', properties: {
      category: strings(categories), assessable: { type: 'boolean' },
      score: { type: 'integer', minimum: 0, maximum: 10, description: '1–10, or 0 when not assessable' },
      confidence, rationale: { type: 'string' }, evidence: { type: 'array', items: timestamp },
    }, required: ['category', 'assessable', 'score', 'confidence', 'rationale', 'evidence'] } },
    findings: { type: 'array', items: { type: 'object', properties: {
      category: strings(categories), timestamp, kind: strings(['mistake', 'strength']),
      evidence: { type: 'string', description: 'What is visible or audible at that moment' }, confidence,
      impact: { type: 'integer', minimum: 1, maximum: 5 }, fix: { type: 'string', description: 'One concrete alternative; empty for strengths' },
    }, required: ['category', 'timestamp', 'kind', 'evidence', 'confidence', 'impact', 'fix'] } },
  };
  const required = ['categories', 'findings'];
  if (includesDeaths) {
    properties.deaths = { type: 'array', items: { type: 'object', properties: {
      timestamp, cause: strings(DEATH_CAUSES), avoidable: strings(['yes', 'no', 'unclear']), firstDeathOfFight: { type: 'boolean' },
      killerHero, whatToDoInstead: { type: 'string' }, confidence,
    }, required: ['timestamp', 'cause', 'avoidable', 'firstDeathOfFight', 'killerHero', 'whatToDoInstead', 'confidence'] } };
    required.push('deaths');
  }
  if (includesHabit) {
    properties.habitChecks = { type: 'array', items: { type: 'object', properties: {
      timestamp, done: { type: 'boolean', description: 'Whether the player did the habit at this moment' },
      evidence: { type: 'string', description: 'What is visible at that moment' },
    }, required: ['timestamp', 'done', 'evidence'] } };
    required.push('habitChecks');
  }
  return { type: 'object', properties, required };
}

const scoreboard = { type: 'object', properties: {
  visible: { type: 'boolean', description: 'false if no scoreboard or no row of the player is readable' },
  eliminations: { type: 'integer', minimum: 0 }, assists: { type: 'integer', minimum: 0 }, deaths: { type: 'integer', minimum: 0 },
  damage: { type: 'integer', minimum: 0 }, healing: { type: 'integer', minimum: 0 }, mitigation: { type: 'integer', minimum: 0 },
}, required: ['visible', 'eliminations', 'assists', 'deaths', 'damage', 'healing', 'mitigation'] };

export function scoutSchema(withScoreboard) {
  const schema = { type: 'object', properties: {
    fights: { type: 'array', items: { type: 'object', properties: {
      start: timestamp, end: timestamp, outcome: strings(['won', 'lost', 'even', 'unclear']),
      killsFor: { type: 'integer', minimum: 0 }, killsAgainst: { type: 'integer', minimum: 0 },
    }, required: ['start', 'end', 'outcome', 'killsFor', 'killsAgainst'] } },
    deaths: { type: 'array', items: { type: 'object', properties: { timestamp, killerHero }, required: ['timestamp', 'killerHero'] } },
    eliminations: { type: 'array', items: timestamp },
    result: strings(['win', 'loss', 'draw', 'unknown']),
    heroes: { type: 'array', items: strings(HEROES.map((h) => h.name)), description: 'Heroes the player played, in order' },
    map: strings([...MAPS.map((m) => m.name), 'unknown']),
  }, required: ['fights', 'deaths', 'eliminations', 'result', 'heroes', 'map'] };
  if (withScoreboard) {
    schema.properties.scoreboard = scoreboard;
    schema.required.push('scoreboard');
  }
  return schema;
}

export const verdictSchema = { type: 'object', properties: {
  summary: { type: 'string' },
  topMistakes: { type: 'array', items: { type: 'integer' }, description: 'Finding indices, most costly first' },
  strengths: { type: 'array', items: { type: 'integer' } },
  drill: { type: 'object', properties: { title: { type: 'string' }, steps: { type: 'array', items: { type: 'string' } } }, required: ['title', 'steps'] },
  contradictions: { type: 'array', items: { type: 'object', properties: { droppedFinding: { type: 'integer' }, reason: { type: 'string' } }, required: ['droppedFinding', 'reason'] } },
}, required: ['summary', 'topMistakes', 'strengths', 'drill', 'contradictions'] };

/** Parses Gemini's JSON answer (with or without a ``` fence). */
export function decodeAnswer(text) {
  const trimmed = String(text).trim().replace(/^```(json)?\s*|\s*```$/g, '');
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    throw new GeminiError('malformedResponse', { detail: `answer didn't match the expected JSON (${error.message})` });
  }
}

export function specialistReport(answer) {
  return {
    categories: (answer.categories ?? []).map((c) => ({ category: c.category, score: c.assessable ? c.score : null, confidence: c.confidence, rationale: c.rationale ?? '', evidence: c.evidence ?? [] })),
    findings: (answer.findings ?? []).map((f) => ({ ...f, fix: String(f.fix ?? '').trim() ? f.fix : null })),
    deaths: (answer.deaths ?? []).map((d) => ({ ...d, killerHero: d.killerHero ? d.killerHero : null })),
    habitChecks: answer.habitChecks ?? [],
  };
}

/** Fights, deaths and eliminations with readable, in-range times (port of ScoutAnswer.timeline). */
export function scoutTimeline(answer, duration) {
  const time = (text) => {
    const value = parseTimestamp(text);
    return value != null && value <= duration + 1 ? value : null;
  };
  return {
    fights: (answer.fights ?? []).map((f) => ({ ...f, start: time(f.start), end: time(f.end) })).filter((f) => f.start != null && f.end != null && f.end > f.start),
    deaths: (answer.deaths ?? []).map((d) => ({ time: time(d.timestamp), killerHero: d.killerHero || null })).filter((d) => d.time != null),
    eliminations: (answer.eliminations ?? []).map(time).filter((t) => t != null),
    result: answer.result ?? 'unknown',
  };
}

export const scoutHeroKeys = (answer) => [...new Set((answer.heroes ?? []).map(heroKeyFor).filter(Boolean))];

export function scoutMapKey(answer) {
  const fold = (text) => String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const folded = fold(answer.map ?? '');
  return [...MAPS].sort((a, b) => fold(b.name).length - fold(a.name).length).find((map) => folded.includes(fold(map.name)))?.key ?? null;
}

export function scoutScoreboard(answer) {
  const board = answer.scoreboard;
  if (!board?.visible) return null;
  const { eliminations, assists, deaths, damage, healing, mitigation } = board;
  return { eliminations, assists, deaths, damage, healing, mitigation };
}
