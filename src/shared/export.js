// A report as text blocks (Markdown) and as a printable page (PDF, dark or light). Port of ReportExport and
// the Mac app's PDF layout.
import { heroName, modeName, rankText } from './catalog.js';
import { categoryScores, deathsOf, findingsOf, heroLine, matchTitle, strengthsOf, topMistakes } from './match.js';
import { COMPARISON_NOTE, compareMatch } from './progress.js';
import { categoryName, formatTimestamp, scoreBand, scoreNote } from './rubric.js';
import { habitCheckSummary } from './training.js';

const dateTime = (date) => new Date(date).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const queueName = (q) => ({ competitive: 'Competitive', quickPlay: 'Quick Play' }[q] ?? 'Other');
const resultName = (r) => ({ win: 'Victory', loss: 'Defeat', draw: 'Draw' }[r] ?? 'Result unknown');

function findingLine(f) {
  let line = `[${formatTimestamp(f.timestamp)}] ${categoryName(f.category)}: ${f.evidence}`;
  if (f.fix) line += ` Fix: ${f.fix}`;
  if (f.isDisputed) line += ` (Disputed${f.disputeNote ? `: ${f.disputeNote}` : ''})`;
  return line;
}

export function reportDocument(match, run, allMatches = [], habits = []) {
  const facts = [dateTime(match.playedAt), match.mode ? modeName(match.mode) : null, queueName(match.queue), resultName(match.result), rankText(match.rank),
    match.stats?.durationSeconds ? formatTimestamp(match.stats.durationSeconds) : null].filter(Boolean);
  const blocks = [{ kind: 'meta', text: facts.join(' · ') }];
  if (match.isReference) blocks.push({ kind: 'paragraph', text: 'Reference match: another player\'s play, kept for comparison.' });
  blocks.push({ kind: 'heading', text: `Overall ${run.overallScore != null ? `${run.overallScore.toFixed(1)} / 10 (${scoreBand(run.overallScore)})` : 'N/A (too few categories assessable)'}` });
  if (run.summary) blocks.push({ kind: 'paragraph', text: run.summary });
  const comparison = compareMatch(match, run, allMatches);
  if (comparison && !comparison.isEmpty) {
    blocks.push({ kind: 'heading', text: `Compared with ${comparison.basis}` }, { kind: 'bullets', items: comparison.textLines }, { kind: 'meta', text: COMPARISON_NOTE });
  }
  const habit = habitCheckSummary(run, habits);
  if (habit) {
    blocks.push({ kind: 'heading', text: `Habit check: ${habit.title}` }, { kind: 'paragraph', text: habit.resultText },
      { kind: 'bullets', items: habit.moments.map((m) => `[${formatTimestamp(m.timestamp)}] ${m.done ? 'Done' : 'Missed'}: ${m.evidence}`) });
  }
  const top = topMistakes(run);
  if (top.length) blocks.push({ kind: 'heading', text: '3 costliest mistakes' }, { kind: 'numbered', items: top.map(findingLine) });
  const strengths = strengthsOf(run);
  if (strengths.length) blocks.push({ kind: 'heading', text: 'What you did right' }, { kind: 'bullets', items: strengths.map(findingLine) });
  if (run.drillTitle) blocks.push({ kind: 'heading', text: `Drill for your next session: ${run.drillTitle}` }, { kind: 'numbered', items: run.drillSteps ?? [] });
  const scores = categoryScores(run);
  if (scores.length) {
    blocks.push({ kind: 'heading', text: 'Category scores' }, { kind: 'bullets', items: scores.map((s) => (s.score == null
      ? `${categoryName(s.category)}: not assessable. ${s.rationale}`
      : `${categoryName(s.category)}: ${s.score}${scoreNote(s.confidence) ? ` (${scoreNote(s.confidence).toLowerCase()})` : ''}. ${s.rationale}`)) });
  }
  const deaths = deathsOf(run);
  if (deaths.length) {
    blocks.push({ kind: 'heading', text: 'Death review' }, { kind: 'bullets', items: deaths.map((d) => `[${formatTimestamp(d.timestamp)}] ${d.cause}, avoidable: ${d.avoidable}${d.isFirstDeathOfFight ? ', first death of the fight' : ''}${d.killerHeroKey ? `, killed by ${heroName(d.killerHeroKey)}` : ''}. ${d.whatToDoInstead}`) });
  }
  const others = findingsOf(run).filter((f) => !f.topRank && f.kind !== 'strength');
  if (others.length) blocks.push({ kind: 'heading', text: 'All other findings' }, { kind: 'bullets', items: others.map(findingLine) });
  blocks.push({ kind: 'meta', text: `ClimbCoach · rubric v${run.rubricVersion} · ${run.modelID} · analysed ${dateTime(run.startedAt)}` });
  return { title: `${matchTitle(match)} · ${match.heroKeys?.length ? heroLine(match) : 'hero unknown'}`, blocks };
}

export function markdown(document) {
  const lines = [`# ${document.title}`, ''];
  for (const block of document.blocks) {
    if (block.kind === 'heading') lines.push(`## ${block.text}`, '');
    if (block.kind === 'paragraph') lines.push(block.text, '');
    if (block.kind === 'meta') lines.push(`_${block.text}_`, '');
    if (block.kind === 'bullets') lines.push(...block.items.map((item) => `- ${item}`), '');
    if (block.kind === 'numbered') lines.push(...block.items.map((item, i) => `${i + 1}. ${item}`), '');
  }
  return lines.join('\n');
}

// ---------- The printable page ----------

const escape = (text) => String(text ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const STYLES = {
  screen: { bg: '#0E1420', surface: '#172031', raised: '#212C40', stroke: '#34425C', text: '#F2F5FA', secondary: '#A9B4C6', orange: '#FF8A1F', blue: '#3FA9F5', success: '#3DDC97', danger: '#FF6B6B', warning: '#FFC44D', onAccent: '#0E1420' },
  print: { bg: '#FFFFFF', surface: '#F5F7FA', raised: '#E9EDF3', stroke: '#C9D1DD', text: '#141A24', secondary: '#4A5568', orange: '#C25A00', blue: '#1D6FB8', success: '#1E7A4F', danger: '#C53030', warning: '#8A6100', onAccent: '#FFFFFF' },
};

export function reportHTML(match, run, { allMatches = [], habits = [], style = 'screen', heroImage = null } = {}) {
  const c = STYLES[style];
  const scoreColor = (s) => (s == null ? c.secondary : Math.round(s) < 3 ? c.danger : Math.round(s) < 5 ? c.warning : Math.round(s) < 7 ? c.blue : c.success);
  const comparison = compareMatch(match, run, allMatches);
  const habit = habitCheckSummary(run, habits);
  const section = (title, accent, body) => `<section><h2><i style="background:${accent}"></i>${escape(title)}</h2>${body}</section>`;
  const finding = (f, badge) => `<div class="card">${badge ? `<b class="badge" style="background:${f.kind === 'strength' ? c.success : c.orange}">${badge}</b>` : ''}
    <div><div class="line"><span class="time">${formatTimestamp(f.timestamp)}</span><span class="cat">${escape(categoryName(f.category))}</span>${f.kind === 'mistake' ? `<span class="cat">Impact ${f.impact}/5</span>` : ''}${f.isDisputed ? '<span class="cat">Disputed</span>' : ''}</div>
    <p>${escape(f.evidence)}</p>${f.fix ? `<p class="fix">↳ ${escape(f.fix)}</p>` : ''}</div></div>`;
  const stats = ['eliminations', 'assists', 'deaths', 'damage', 'healing', 'mitigation'].filter((k) => match.stats?.[k] != null)
    .map((k) => `<div class="stat"><small>${k === 'mitigation' ? 'Mitigated' : k.charAt(0).toUpperCase() + k.slice(1)}</small><b>${Number(match.stats[k]).toLocaleString('de-DE')}</b></div>`).join('');
  const chips = [dateTime(match.playedAt), match.mode ? modeName(match.mode) : null, queueName(match.queue), rankText(match.rank), match.stats?.durationSeconds ? formatTimestamp(match.stats.durationSeconds) : null]
    .filter(Boolean).map((x) => `<span class="chip">${escape(x)}</span>`).join('');
  const resultColor = { win: c.success, loss: c.danger, draw: c.warning }[match.result] ?? c.secondary;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(matchTitle(match))}</title><style>
@page { size: A4; margin: 0; }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; background: ${c.bg}; color: ${c.text}; font: 10.5pt/1.45 "Segoe UI", system-ui, sans-serif; }
.page { padding: 26pt 30pt 30pt; }
.top { display: flex; align-items: center; gap: 10pt; border-bottom: 1px solid ${c.stroke}; padding-bottom: 10pt; }
.brand { font: 900 14pt "Bahnschrift", "Arial Narrow", sans-serif; letter-spacing: 1.5pt; } .brand b { color: ${c.orange}; }
.where { color: ${c.secondary}; font: 700 10pt "Bahnschrift", sans-serif; letter-spacing: 1pt; text-transform: uppercase; }
.result { margin-left: auto; border: 1px solid ${resultColor}; color: ${resultColor}; padding: 2pt 8pt; font-weight: 800; letter-spacing: 1pt; text-transform: uppercase; font-size: 9pt; }
.hero { position: relative; margin: 14pt 0 10pt; min-height: 120pt; overflow: hidden; }
.hero img { position: absolute; right: 0; top: 0; height: 100%; width: 55%; object-fit: cover; object-position: center 30%; opacity: ${style === 'screen' ? 0.35 : 0.25};
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 40%); }
.hero h1 { position: relative; margin: 6pt 0 2pt; font: 900 38pt/1 "Bahnschrift", "Arial Narrow", sans-serif; text-transform: uppercase; }
.hero .heroes { position: relative; color: ${c.orange}; font: 800 14pt "Bahnschrift", sans-serif; text-transform: uppercase; letter-spacing: 1pt; }
.chips { position: relative; display: flex; flex-wrap: wrap; gap: 5pt; margin-top: 8pt; }
.chip { border: 1px solid ${c.stroke}; padding: 1pt 6pt; font-size: 8pt; font-weight: 700; letter-spacing: .6pt; text-transform: uppercase; color: ${c.secondary}; }
.score { display: grid; grid-template-columns: 130pt 1fr; gap: 10pt; margin: 10pt 0; }
.box { background: ${c.surface}; border: 1px solid ${c.stroke}; padding: 10pt 12pt; }
.big { font: 900 40pt/1 "Bahnschrift", sans-serif; }
small { color: ${c.secondary}; font-size: 8pt; font-weight: 700; letter-spacing: .8pt; text-transform: uppercase; }
.stats { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6pt; margin: 8pt 0 4pt; }
.stat { background: ${c.surface}; border: 1px solid ${c.stroke}; padding: 6pt 8pt; } .stat b { display: block; font: 800 14pt "Bahnschrift", sans-serif; }
section { break-inside: avoid-page; margin-top: 14pt; }
h2 { display: flex; align-items: center; gap: 7pt; font: 800 12pt "Bahnschrift", sans-serif; letter-spacing: 1.4pt; text-transform: uppercase; margin: 0 0 7pt; }
h2 i { width: 3pt; height: 12pt; display: inline-block; }
.card { display: flex; gap: 9pt; background: ${c.surface}; border: 1px solid ${c.stroke}; padding: 8pt 10pt; margin-bottom: 6pt; break-inside: avoid; }
.badge { width: 22pt; height: 22pt; flex: none; display: grid; place-items: center; color: ${c.onAccent}; font: 900 13pt "Bahnschrift", sans-serif; }
.line { display: flex; gap: 8pt; align-items: baseline; } .time { color: ${c.blue}; font: 700 10pt Consolas, monospace; } .cat { color: ${c.secondary}; font-size: 8.5pt; font-weight: 600; }
p { margin: 2pt 0; } .fix { color: ${c.secondary}; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6pt; }
.cell { background: ${c.surface}; border: 1px solid ${c.stroke}; padding: 7pt 9pt; break-inside: avoid; }
.cell .head { display: flex; align-items: baseline; gap: 6pt; } .cell .head b { flex: 1; font: 700 11pt "Bahnschrift", sans-serif; } .cell .head span { font: 900 15pt "Bahnschrift", sans-serif; }
.meter { height: 4pt; background: ${c.raised}; margin: 4pt 0; } .meter div { height: 100%; }
.cell p { color: ${c.secondary}; font-size: 8.5pt; }
table { width: 100%; border-collapse: collapse; font-size: 9pt; } th { text-align: left; color: ${c.secondary}; font-size: 7.5pt; letter-spacing: .8pt; text-transform: uppercase; }
td, th { padding: 3pt 5pt; border-bottom: 1px solid ${c.stroke}; }
.note { color: ${c.secondary}; font-size: 8pt; }
footer { margin-top: 16pt; color: ${c.secondary}; font-size: 7.5pt; letter-spacing: .6pt; border-top: 1px solid ${c.stroke}; padding-top: 6pt; }
</style></head><body><div class="page">
<div class="top"><span class="brand">CLIMB<b>COACH</b></span><span class="where">Match report</span><span class="result">${escape(resultName(match.result))}</span></div>
<div class="hero">${heroImage ? `<img src="${heroImage}" alt="">` : ''}<h1>${escape(matchTitle(match))}</h1><div class="heroes">— ${escape(heroLine(match))}</div><div class="chips">${chips}</div></div>
<div class="score"><div class="box"><small>Overall</small><div class="big" style="color:${scoreColor(run.overallScore)}">${run.overallScore != null ? run.overallScore.toFixed(1) : 'N/A'}<span style="font-size:12pt;color:${c.secondary}"> /10</span></div><small>${escape(run.overallScore != null ? scoreBand(run.overallScore) : 'Too few categories assessable')}</small></div>
<div class="box"><h2><i style="background:${c.orange}"></i>Coach's summary</h2><p>${escape(run.summary)}</p></div></div>
${stats ? `<div class="stats">${stats}</div>` : ''}
${comparison && !comparison.isEmpty ? section(`Compared with ${comparison.basis}`, c.blue, `<table><tr><th></th><th>This match</th><th>Your usual</th><th>Change</th></tr>${[...comparison.lines, ...comparison.movedCategories].map((l) => `<tr><td>${escape(l.label)}</td><td><b>${l.currentText}</b></td><td>${l.usualText}</td><td style="color:${{ better: c.success, worse: c.danger }[l.trend] ?? c.secondary}">${l.trend === 'same' ? l.trendLabel : `${l.trendLabel} ${l.changeText}`}</td></tr>`).join('')}</table>${comparison.steadyCategoriesText ? `<p class="note">${escape(comparison.steadyCategoriesText)}</p>` : ''}${comparison.repeats.map((r) => `<p>${r.isBack ? '↻' : '↘'} ${escape(r.text)}</p>`).join('')}<p class="note">${escape(COMPARISON_NOTE)}</p>`) : ''}
${habit ? section(`Habit check · ${habit.title}`, c.orange, `<p><b>${escape(habit.resultText)}</b></p>${habit.moments.map((m) => `<p><span style="color:${m.done ? c.success : c.danger}">${m.done ? '✓' : '✗'}</span> <span class="time">${formatTimestamp(m.timestamp)}</span> ${escape(m.evidence)}</p>`).join('')}<p class="note">Habit checks never change a score.</p>`) : ''}
${topMistakes(run).length ? section(`${topMistakes(run).length} costliest mistakes`, c.orange, topMistakes(run).map((f, i) => finding(f, i + 1)).join('')) : ''}
${strengthsOf(run).length ? section(match.isReference ? 'What they did right' : 'What you did right', c.success, strengthsOf(run).map((f) => finding(f, '✓')).join('')) : ''}
${run.drillTitle ? section('Drill for your next session', c.blue, `<p><b>${escape(run.drillTitle)}</b></p><ol>${(run.drillSteps ?? []).map((s) => `<li>${escape(s)}</li>`).join('')}</ol>`) : ''}
${section('Category scores', c.orange, `<div class="grid">${categoryScores(run).map((s) => `<div class="cell"><div class="head"><b>${escape(categoryName(s.category))}</b>${s.score != null && scoreNote(s.confidence) ? `<small>${scoreNote(s.confidence)}</small>` : ''}<span style="color:${scoreColor(s.score)}">${s.score ?? 'N/A'}</span></div><div class="meter"><div style="width:${(s.score ?? 0) * 10}%;background:${scoreColor(s.score)}"></div></div><p>${escape(s.score == null ? `Not assessable. ${s.rationale}` : s.rationale)}</p></div>`).join('')}</div>`)}
${deathsOf(run).length ? section('Death review', c.warning, deathsOf(run).map((d) => `<div class="card"><div><div class="line"><span class="time">${formatTimestamp(d.timestamp)}</span><span class="cat" style="color:${d.avoidable === 'yes' ? c.danger : c.secondary}">${escape(d.cause)} · avoidable: ${escape(d.avoidable)}${d.isFirstDeathOfFight ? ' · first death of the fight' : ''}</span>${d.killerHeroKey ? `<span class="cat">killed by ${escape(heroName(d.killerHeroKey))}</span>` : ''}</div><p>${escape(d.whatToDoInstead)}</p></div></div>`).join('')) : ''}
<footer>CLIMBCOACH MATCH REPORT · RUBRIC V${escape(run.rubricVersion)} · ${escape(run.modelID)} · ${escape(dateTime(run.startedAt))}${heroImage ? ' · HERO PICTURE FROM YOUR OWN RECORDING' : ''}<br>Overwatch is a trademark of Blizzard Entertainment, Inc. ClimbCoach is not affiliated with Blizzard.</footer>
</div></body></html>`;
}
