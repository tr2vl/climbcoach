// Enforces the rubric mechanically on the AI's output: evidence and timestamps, score caps, banned
// phrases, strengths, the 3 costliest mistakes (port of ReportValidator).
import { CATEGORIES, bannedPhrases, categoryName, confidenceRank, formatTimestamp, overallScore, parseTimestamp, STRENGTH_MOMENTS } from '../../shared/rubric.js';

export const MAXIMUM_HABIT_CHECKS = 15;

export class ReportValidator {
  constructor({ videoDuration, role, assessable = new Set(CATEGORIES) }) {
    this.videoDuration = videoDuration;
    this.role = role;
    this.assessable = assessable;
  }

  seconds(timestamp) {
    const value = parseTimestamp(timestamp);
    return value != null && value <= this.videoDuration + 1 ? value : null;
  }

  validate(merged, verdict) {
    const issues = [];
    const corrected = (message) => issues.push({ severity: 'corrected', message });
    const categories = CATEGORIES.map((category) => this.#category(category, merged, corrected));
    const scores = Object.fromEntries(categories.filter((c) => c.score != null).map((c) => [c.category, c.score]));
    const { findings, indexMap } = this.#findings(merged.findings, verdict, corrected);
    const deaths = merged.deaths.filter((death) => {
      const keep = this.seconds(death.timestamp) != null && bannedPhrases(death.whatToDoInstead).length === 0;
      if (!keep) corrected(`Death review at "${death.timestamp}" dropped: invalid timestamp or banned phrase.`);
      return keep;
    });
    const topMistakes = this.#topMistakes(verdict.topMistakes.map((i) => indexMap.get(i)).filter((i) => i != null), findings, corrected);
    const strengths = this.#strengths(verdict.strengths.map((i) => indexMap.get(i)).filter((i) => i != null), findings);
    this.#checkVerdictText(verdict, issues);
    return {
      report: {
        categories, findings, deaths, summary: verdict.summary, topMistakes, strengths, drill: verdict.drill,
        overallScore: overallScore(scores, this.role),
        habitChecks: this.habitChecks(merged.habitChecks ?? [], issues),
      },
      issues,
    };
  }

  /** Habit checks need a valid time and visible evidence; two within 4 s are the same moment. */
  habitChecks(checks, issues) {
    const kept = [];
    for (const check of checks) {
      const time = this.seconds(check.timestamp);
      if (time == null || !String(check.evidence ?? '').trim() || bannedPhrases(check.evidence).length) {
        issues.push({ severity: 'corrected', message: `Habit check at "${check.timestamp}" dropped: no valid time or evidence.` });
        continue;
      }
      if (kept.some((k) => Math.abs(k.time - time) < 4)) continue;
      kept.push({ time, check: { ...check, timestamp: formatTimestamp(time) } });
    }
    return kept.sort((a, b) => a.time - b.time).slice(0, MAXIMUM_HABIT_CHECKS).map((k) => k.check);
  }

  #category(category, merged, corrected) {
    const matches = merged.categories.filter((c) => c.category === category);
    if (matches.length > 1) corrected(`${categoryName(category)} was scored twice; kept the first.`);
    if (!matches.length) return { category, score: null, confidence: 'low', rationale: 'Not assessed.', evidence: [] };
    const assessment = { ...matches[0] };
    const evidence = new Set(assessment.evidence.map((t) => this.seconds(t)).filter((t) => t != null));
    const downgrade = (reason) => { corrected(`${categoryName(category)}: ${reason}`); assessment.score = null; };
    const score = assessment.score;
    if (score != null) {
      if (!this.assessable.has(category)) downgrade('the footage can\'t support this category, set to not assessable.');
      else if (score < 1 || score > 10) downgrade(`score ${score} is outside 1–10, set to not assessable.`);
      else if (evidence.size < 2) downgrade('fewer than 2 valid evidence timestamps, set to not assessable.');
      else if (bannedPhrases(assessment.rationale).length) downgrade('rationale contains a banned phrase, set to not assessable.');
      else if (score >= 7 && evidence.size < 3) {
        corrected(`${categoryName(category)}: ${score} needs ≥ 3 timestamps, capped at 6.`);
        assessment.score = 6;
      }
    }
    return assessment;
  }

  #findings(findings, verdict, corrected) {
    const contradicted = new Set((verdict.contradictions ?? []).map((c) => c.droppedFinding));
    const basicReason = (index) => {
      const f = findings[index];
      if (contradicted.has(index)) return 'contradicted by another specialist';
      if (this.seconds(f.timestamp) == null) return 'no valid timestamp';
      if (!String(f.evidence ?? '').trim()) return 'no evidence';
      if (bannedPhrases(`${f.evidence} ${f.fix ?? ''}`).length) return 'banned phrase';
      if (f.kind === 'strength' && f.confidence === 'low') return 'low-confidence strength';
      if (f.kind === 'strength' && !this.assessable.has(f.category)) return 'strength in a category the footage can\'t support';
      return null;
    };
    const strengthMoments = new Map();
    findings.forEach((f, index) => {
      if (f.kind === 'strength' && basicReason(index) == null) strengthMoments.set(f.category, (strengthMoments.get(f.category) ?? 0) + 1);
    });
    const kept = [];
    const indexMap = new Map();
    findings.forEach((finding, index) => {
      const reason = basicReason(index) ?? (finding.kind === 'strength' && (strengthMoments.get(finding.category) ?? 0) < STRENGTH_MOMENTS
        ? `a strength needs ${STRENGTH_MOMENTS} or more medium- or high-confidence moments in its category` : null);
      if (reason) {
        corrected(`${categoryName(finding.category)} finding at "${finding.timestamp}" dropped: ${reason}.`);
        return;
      }
      indexMap.set(index, kept.length);
      kept.push({ ...finding, impact: Math.min(Math.max(finding.impact, 1), 5) });
    });
    return { findings: kept, indexMap };
  }

  /** Higher impact first, then higher confidence. */
  static #byWeight(findings) {
    return (a, b) => (findings[b].impact - findings[a].impact) || (confidenceRank(findings[b].confidence) - confidenceRank(findings[a].confidence));
  }

  /** Ranked by impact; ties keep the coach's order. */
  static #rank(list, findings) {
    return list.map((index, order) => ({ index, order }))
      .sort((a, b) => (findings[b.index].impact - findings[a.index].impact) || (a.order - b.order))
      .map((x) => x.index);
  }

  #strengths(picks, findings) {
    const chosen = [];
    for (const pick of picks) if (findings[pick].kind === 'strength' && !chosen.includes(pick)) chosen.push(pick);
    const rest = findings.map((_, i) => i).filter((i) => findings[i].kind === 'strength' && !chosen.includes(i)).sort(ReportValidator.#byWeight(findings));
    return ReportValidator.#rank([...chosen, ...rest].slice(0, 3), findings);
  }

  #topMistakes(picks, findings, corrected) {
    const eligible = (i) => findings[i].kind === 'mistake' && findings[i].confidence !== 'low';
    const chosen = [];
    for (const pick of picks) {
      if (chosen.includes(pick)) continue;
      if (eligible(pick)) chosen.push(pick);
      else corrected(`Top mistake at "${findings[pick].timestamp}" removed: low confidence or not a mistake.`);
    }
    const rest = findings.map((_, i) => i).filter((i) => eligible(i) && !chosen.includes(i)).sort(ReportValidator.#byWeight(findings));
    return ReportValidator.#rank([...chosen, ...rest].slice(0, 3), findings);
  }

  #checkVerdictText(verdict, issues) {
    const text = [verdict.summary, verdict.drill?.title, ...(verdict.drill?.steps ?? [])].join('\n');
    const banned = bannedPhrases(text);
    if (banned.length) issues.push({ severity: 'fatal', message: `Summary or drill uses banned phrases: ${banned.join(', ')}.` });
    if (!String(verdict.summary ?? '').trim()) issues.push({ severity: 'fatal', message: 'The summary is empty.' });
    if (!String(verdict.drill?.title ?? '').trim() || !verdict.drill?.steps?.length) issues.push({ severity: 'fatal', message: 'The drill is missing.' });
  }
}
