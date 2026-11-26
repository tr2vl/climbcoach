// The habit you train, one at a time, stored in the database (port of TrainingStore).
import crypto from 'node:crypto';
import { activeHabit, habitMatches, isLearned, learnedTitles, rankStruggles, struggleSamples } from '../shared/training.js';

export class Training {
  constructor(db) {
    this.db = db;
  }

  get habits() {
    return this.db.data.habits;
  }

  /** Starts training a struggle's habit; the current one ends as swapped. */
  start(struggle, now = new Date()) {
    const current = activeHabit(this.habits);
    if (current) this.#end(current, 'swapped', now);
    const habit = {
      id: crypto.randomUUID(), ...struggle.card, reason: struggle.reason, source: struggle.source, sourceID: struggle.sourceID ?? null,
      startedAt: now.toISOString(), endedAt: null, endReason: null,
    };
    this.habits.push(habit);
    this.db.changed();
    return habit;
  }

  #end(habit, reason, now) {
    habit.endedAt = now.toISOString();
    habit.endReason = reason;
  }

  /** Picks a habit when there is none, and moves on when the current one is learned. */
  refresh(patterns = [], now = new Date()) {
    const matches = this.db.data.matches;
    const samples = struggleSamples(matches);
    const current = activeHabit(this.habits);
    if (current) {
      if (!isLearned(habitMatches(current.id, matches))) return { kind: 'unchanged' };
      this.#end(current, 'learned', now);
      const next = rankStruggles(samples, patterns, new Set([...learnedTitles(this.habits), current.title]))[0];
      if (next) this.start(next, now);
      else this.db.changed();
      return { kind: 'learned', title: current.title, next: next?.card.title ?? null };
    }
    const first = rankStruggles(samples, patterns, learnedTitles(this.habits))[0];
    if (!first) return { kind: 'unchanged' };
    this.start(first, now);
    return { kind: 'started', title: first.card.title };
  }
}
