// The guided tour after get started: the coach points at each part of the app once.
import { coachAvatar } from './coach.js';
import { button, h } from './ui.js';

const STOPS = [
  { target: 'dashboard', screen: 'dashboard', title: 'Dashboard', text: 'Start here before you play. Press Record before each match. I\'ll also leave you today\'s habit and anything I noticed in your matches.' },
  { target: 'record', screen: 'dashboard', title: 'Record', text: 'This is the button. Pick the Overwatch window, play, and press Tab once near the end. I stop by myself at the end screen.' },
  { target: 'reports', screen: 'reports', title: 'Match Reports', text: 'Every match gets a report here: the 3 costliest mistakes, your habit check, deaths, and timestamps that jump the video to the moment.' },
  { target: 'practice', screen: 'practice', title: 'Training', text: 'Your one habit lives here, with a drill and a reel of your own moments. When you\'ve got it, I pick the next one.' },
  { target: 'progress', screen: 'progress', title: 'Progress', text: 'How your scores and deaths move over your last matches, and how you play on a losing streak.' },
  { target: 'learn', screen: 'learn', title: 'Learn', text: 'I study YouTube guides for your common mistakes and your heroes, and write down what applies to you.' },
  { target: 'settings', screen: 'settings', title: 'Settings', text: 'Your ranks, heroes and keys. When I get an update, it downloads by itself and installs when you restart me.' },
];

export function startTour(app, index = 0) {
  const stop = STOPS[index];
  if (!stop) {
    app.climb.settings.update({ tourDone: true }).then((settings) => { app.settings = settings; });
    return;
  }
  if (app.selection !== stop.screen) app.navigate(stop.screen);
  requestAnimationFrame(() => {
    document.querySelectorAll('.tour-shade, .tour-spot, .tour-card').forEach((node) => node.remove());
    const target = document.querySelector(`[data-tour="${stop.target}"]`);
    const rect = target?.getBoundingClientRect() ?? { left: 300, top: 120, width: 0, height: 0, right: 300, bottom: 120 };
    const close = () => document.querySelectorAll('.tour-shade, .tour-spot, .tour-card').forEach((node) => node.remove());
    const next = () => { close(); startTour(app, index + 1); };
    const previous = () => { close(); startTour(app, index - 1); };
    const card = h('div', { class: 'tour-card panel', role: 'dialog', 'aria-label': `Tour: ${stop.title}` },
      h('div', { class: 'accent', style: { background: 'var(--orange)' } }),
      h('div', { class: 'stack' },
        h('div', { class: 'row top' }, coachAvatar('talking', 64), h('div', { class: 'stack grow', style: { gap: '4px' } },
          h('div', { class: 'overline' }, `Tour · ${index + 1} of ${STOPS.length}`),
          h('div', { class: 'heading', style: { fontSize: '18px' } }, stop.title),
          h('div', {}, stop.text))),
        h('div', { class: 'row' },
          button('End tour', () => { close(); startTour(app, STOPS.length); }, { kind: 'link' }),
          h('div', { class: 'grow' }),
          index > 0 ? button('Back', previous) : null,
          button(index === STOPS.length - 1 ? 'Done' : 'Next', next, { kind: 'accent' }))));
    const spot = h('div', { class: 'tour-spot', style: {
      left: `${rect.left - 4}px`, top: `${rect.top - 4}px`, width: `${rect.width + 8}px`, height: `${rect.height + 8}px` } });
    const left = Math.min(window.innerWidth - 440, rect.right + 20);
    const top = Math.max(50, Math.min(window.innerHeight - 260, rect.top - 20));
    Object.assign(card.style, { left: `${left}px`, top: `${top}px` });
    document.body.append(h('div', { class: 'tour-shade' }), spot, card);
    card.querySelector('.btn.accent')?.focus();
  });
}
