// Scout → specialists (one call at a time) → head coach → validator (port of AnalysisPipeline).
import fs from 'node:fs';
import { gameMap } from '../../shared/catalog.js';
import { CATEGORIES, formatTimestamp } from '../../shared/rubric.js';
import { GeminiError } from '../gemini/errors.js';
import { makeRequest, mimeTypeFor, part, wholeMatchFPS } from '../gemini/request.js';
import * as prompts from './prompts.js';
import { decodeAnswer, scoutHeroKeys, scoutMapKey, scoutSchema, scoutScoreboard, scoutTimeline, specialistReport, specialistSchema, verdictSchema } from './schemas.js';
import { clipsUnsupported, MODES, planClips, restrictToClips, SPECIALISTS } from './specialists.js';
import { checklistFor } from '../../shared/checklists.js';
import { ReportValidator } from './validator.js';
import { hero as heroCatalog } from '../../shared/catalog.js';

export const PROGRESS_LABELS = {
  readingHUD: (fraction) => `Reading the HUD on this PC (${Math.round(fraction * 100)} %)…`,
  uploading: (fraction) => (fraction != null ? `Uploading the video to Gemini (${Math.round(fraction * 100)} %)…` : 'Uploading the video to Gemini…'),
  scouting: () => 'Mapping fights and deaths…',
  specialists: (done, total) => `Specialists reviewing (${done}/${total})…`,
  orchestrating: () => 'Head coach merging and checking…',
};

/**
 * @param {object} options
 * @param {object} options.engine   GeminiEngine (or a fake in tests)
 * @param {object} options.context  match context (see prompts.matchFacts)
 * @param {string} options.video    local video file
 * @param {object|null} options.remote  a still-valid upload of this video
 * @param {string[]} options.hints  on-device HUD events
 * @param {string|null} options.scoreboardImage  final Tab scoreboard (JPEG/PNG)
 * @param {(progress: object) => void} options.progress
 */
export async function runPipeline({ engine, mode = 'lean', context: initial, video, remote: existing = null, hints = [], scoreboardImage = null, progress = () => {}, signal }) {
  const context = { ...initial };
  const check = () => { if (signal?.aborted) throw new GeminiError('cancelled'); };
  progress({ step: 'uploading', fraction: 0 });
  const remote = existing ?? await engine.upload(video, { signal, onProgress: (fraction) => progress({ step: 'uploading', fraction }) });
  const mime = remote.mimeType ?? mimeTypeFor(video);
  const range = context.range ?? { start: 0, end: context.duration };
  const matchLength = range.end - range.start;
  const wholeMatch = () => part.video(remote.uri, mime, wholeMatchFPS(matchLength), context.range ? range.start : null, context.range ? range.end : null);
  check();

  progress({ step: 'scouting' });
  const board = scoreboardImage && fs.existsSync(scoreboardImage) ? fs.readFileSync(scoreboardImage) : null;
  const scoutParts = [wholeMatch()];
  if (board) scoutParts.push(part.image(board, scoreboardImage.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg'));
  scoutParts.push(part.text(board ? 'Map this match and read the scoreboard. Answer with the JSON.' : 'Map this match. Answer with the JSON.'));
  const scoutCall = await engine.generate(makeRequest({
    system: prompts.scout(context, hints, Boolean(board)), parts: scoutParts, schema: scoutSchema(Boolean(board)), videoSeconds: matchLength,
  }), { signal });
  const scout = decodeAnswer(scoutCall.result.text);
  const timeline = scoutTimeline(scout, context.videoDuration ?? context.duration);
  const detected = { heroKeys: scoutHeroKeys(scout), mapKey: scoutMapKey(scout), scoreboard: scoutScoreboard(scout) };
  // A recording saved without details: the specialists get what the scout saw.
  if (!context.heroKeys.length && detected.heroKeys.length) {
    context.heroKeys = detected.heroKeys;
    context.role = heroCatalog(detected.heroKeys[0])?.role ?? context.role;
  }
  if (!context.mapName && detected.mapKey) {
    const map = gameMap(detected.mapKey);
    context.mapName = map.name;
    context.mode = context.mode ?? (map.modes.length === 1 ? map.modes[0] : null);
  }
  check();

  const groups = MODES[mode];
  const unsupported = new Set();
  const plans = groups.map((group) => {
    const footage = SPECIALISTS[group[0]].footage;
    const clips = planClips(footage, timeline, context.videoDuration ?? context.duration);
    const missing = clipsUnsupported(footage, clips) ? group.flatMap((key) => SPECIALISTS[key].categories) : [];
    if (group.includes('heroMechanics') && context.heroKeys.every((key) => !checklistFor(key))) missing.push('heroMechanics');
    missing.forEach((category) => unsupported.add(category));
    return { group, clips, unsupported: missing };
  });

  progress({ step: 'specialists', done: 0, total: plans.length });
  const results = [];
  for (const plan of plans) {
    results.push(await specialistCall(engine, plan, context, timeline, remote, mime, wholeMatch, signal));
    progress({ step: 'specialists', done: results.length, total: plans.length });
    check();
  }

  const validator = new ReportValidator({ videoDuration: context.videoDuration ?? context.duration, role: context.role,
    assessable: new Set(CATEGORIES.filter((c) => !unsupported.has(c))) });
  const habitIssues = [];
  const merged = {
    categories: results.flatMap((r) => r.report.categories),
    findings: results.flatMap((r) => r.report.findings),
    deaths: results.flatMap((r) => r.report.deaths),
    // Checked before the head coach sees them, so its sentence uses the numbers that are kept.
    habitChecks: validator.habitChecks(results.flatMap((r) => r.report.habitChecks), habitIssues),
  };
  progress({ step: 'orchestrating' });
  let usage = [scoutCall.result.usage, ...results.map((r) => r.usage)].reduce((a, b) => ({ input: a.input + b.input, output: a.output + b.output }), { input: 0, output: 0 });
  const models = [scoutCall.model, ...results.map((r) => r.model).filter(Boolean)];
  let requests = 1 + results.filter((r) => r.model).length;
  let rejected = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const call = await engine.generate(makeRequest({
      system: prompts.orchestrator(context, merged, rejected), parts: [part.text('Merge the specialist material. Answer with the JSON.')], schema: verdictSchema,
    }), { signal });
    usage = { input: usage.input + call.result.usage.input, output: usage.output + call.result.usage.output };
    models.push(call.model);
    requests += 1;
    const verdict = decodeAnswer(call.result.text);
    const { report, issues } = validator.validate(merged, verdict);
    rejected = issues.filter((issue) => issue.severity === 'fatal');
    if (!rejected.length) {
      return {
        report, detected, timeline, usage, requestCount: requests, remote,
        issues: [...results.flatMap((r) => r.issues), ...habitIssues, ...issues],
        models: [...new Set(models)],
      };
    }
  }
  const error = new Error(`The AI's report broke the honesty rules twice, so it was discarded: ${rejected.map((i) => i.message).join(' ')}`);
  error.kind = 'validationFailed';
  throw error;
}

async function specialistCall(engine, plan, context, timeline, remote, mime, wholeMatch, signal) {
  const categories = plan.group.flatMap((key) => SPECIALISTS[key].categories);
  if (categories.every((c) => plan.unsupported.includes(c))) {
    // Nothing this group could see; don't spend a free request on it.
    return { report: { categories: categories.map((category) => ({ category, score: null, confidence: 'low', rationale: 'The footage doesn\'t support this category.', evidence: [] })), findings: [], deaths: [], habitChecks: [] }, issues: [], usage: { input: 0, output: 0 }, model: null };
  }
  const parts = [];
  if (plan.clips) {
    plan.clips.forEach((clip, index) => {
      parts.push(part.text(`Clip ${index + 1} (${clip.label}): video time ${formatTimestamp(clip.start)}–${formatTimestamp(clip.end)}`));
      parts.push(part.video(remote.uri, mime, clip.fps, clip.start, clip.end));
    });
  } else {
    parts.push(wholeMatch());
  }
  parts.push(part.text('Review the footage above. Answer with the JSON.'));
  const habit = prompts.checksHabit(plan.group, context);
  const call = await engine.generate(makeRequest({
    system: prompts.specialists(plan.group, context, plan.clips, plan.unsupported, timeline), parts,
    schema: specialistSchema(categories, plan.group.includes('deathReview'), habit),
    videoSeconds: context.range ? context.range.end - context.range.start : context.duration,
  }), { signal });
  let report = specialistReport(decodeAnswer(call.result.text));
  if (!habit) report.habitChecks = [];
  report.categories = report.categories.filter((c) => categories.includes(c.category));
  report.findings = report.findings.filter((f) => categories.includes(f.category));
  let issues = [];
  if (plan.clips) ({ report, issues } = restrictToClips(report, plan.clips));
  return { report, issues, usage: call.result.usage, model: call.model };
}
