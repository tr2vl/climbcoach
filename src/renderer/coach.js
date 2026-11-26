// The coach character: the same drawing as the Mac app's CoachAvatar (a 200 × 220 box), as SVG with
// CSS animation. An original character (cap with the ClimbCoach chevrons, headset, whistle, clipboard).
import { h } from './ui.js';

export const MOODS = ['idle', 'watching', 'thinking', 'ready', 'sleeping', 'talking', 'puzzled'];

const style = `
.cc .st{display:none}
.cc[data-mood=watching] .m-watching,.cc[data-mood=thinking] .m-thinking,.cc[data-mood=ready] .m-ready,
.cc[data-mood=sleeping] .m-sleeping,.cc[data-mood=talking] .m-talking,.cc[data-mood=puzzled] .m-puzzled,
.cc[data-mood=idle] .m-open,.cc[data-mood=watching] .m-open,.cc[data-mood=thinking] .m-open,.cc[data-mood=talking] .m-open,.cc[data-mood=puzzled] .m-open,
.cc[data-mood=idle] .m-smile,.cc[data-mood=watching] .m-smile,.cc[data-mood=thinking] .m-smile{display:inline}
.cc *{transform-box:fill-box}
.cc .figure{animation:cc-bob 3s ease-in-out infinite}
.cc[data-mood=ready] .figure{animation:cc-hop 1.2s ease-in-out infinite}
.cc[data-mood=sleeping] .figure{animation:none;transform:rotate(-4deg);transform-origin:50% 70%}
.cc .eyes{transform-origin:center;animation:cc-blink 4s infinite}
.cc[data-mood=watching] .pupils{animation:cc-look 2.4s ease-in-out infinite}
.cc[data-mood=thinking] .pupils{transform:translate(3px,-3px)}
.cc[data-mood=puzzled] .pupils{transform:translateX(-2px)}
.cc[data-mood=puzzled] .brow-r{transform:translateY(-5px)}
.cc[data-mood=talking] .brow-r{transform:translateY(-2px)}
.cc .dot{animation:cc-dot 1.2s infinite}
.cc .pencil{animation:cc-scrib .5s ease-in-out infinite alternate}
.cc .zz{animation:cc-zz 2.6s ease-in infinite;opacity:0}
.cc .talk{transform-origin:center;animation:cc-talk .35s ease-in-out infinite alternate}
.cc .scan{animation:cc-scan 1.6s linear infinite}
.cc[data-mood=ready] .board{transform:translateY(-6px)}
.cc .q{animation:cc-q 1.4s ease-in-out infinite}
@keyframes cc-bob{50%{transform:translateY(-3px)}}
@keyframes cc-hop{0%,100%{transform:translateY(0)}30%{transform:translateY(-8px)}}
@keyframes cc-blink{0%,93%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}
@keyframes cc-look{0%,100%{transform:translateX(-4px)}50%{transform:translateX(4px)}}
@keyframes cc-dot{0%,100%{opacity:.25}50%{opacity:1}}
@keyframes cc-scrib{to{transform:translate(8px,-3px)}}
@keyframes cc-zz{0%{opacity:0;transform:translate(0,6px)}30%{opacity:1}100%{opacity:0;transform:translate(10px,-18px)}}
@keyframes cc-talk{from{transform:scaleY(1)}to{transform:scaleY(.3)}}
@keyframes cc-scan{from{transform:translateX(0)}to{transform:translateX(34px)}}
@keyframes cc-q{50%{transform:translateY(2px)}}
@media (prefers-reduced-motion:reduce){.cc *{animation:none!important}}
`;

let styled = false;

const labels = {
  idle: 'The coach', watching: 'The coach, watching your match', thinking: 'The coach, thinking',
  ready: 'The coach, holding up your report', sleeping: 'The coach, asleep until the daily reset',
  talking: 'The coach, talking', puzzled: 'The coach, puzzled',
};

export function coachAvatar(mood = 'idle', size = 96) {
  if (!styled) {
    document.head.append(h('style', {}, style));
    styled = true;
  }
  const P = (d, attrs) => h('path', { d, ...attrs });
  const C = (cx, cy, r, fill, cls) => h('circle', { cx, cy, r, fill, class: cls });
  const ink = '#24262B', mouth = '#712B13', skin = '#F5C4B3', shade = '#E39A7E', paper = '#F1EFE8', line = '#B4B2A9';
  const round = { stroke: ink, 'stroke-width': 3, fill: 'none', 'stroke-linecap': 'round' };
  const svg = h('svg', { class: 'cc coach-svg', 'data-mood': mood, viewBox: '0 0 200 220', width: size, height: size * 1.1,
    role: 'img', 'aria-label': labels[mood] ?? labels.idle },
    // Props behind the figure
    h('g', { class: 'st m-watching' },
      h('rect', { x: 10, y: 22, width: 52, height: 36, rx: 4, fill: ink }), h('rect', { x: 14, y: 26, width: 44, height: 22, fill: '#185FA5' }),
      h('polygon', { points: '31,31 31,43 42,37', fill: paper }), h('rect', { x: 14, y: 51, width: 44, height: 3, fill: '#5F5E5A' }),
      h('rect', { class: 'scan', x: 14, y: 51, width: 10, height: 3, fill: '#FF8A1F' })),
    h('g', { class: 'st m-thinking' },
      C(150, 52, 4, '#A9B4C6', 'dot'), h('circle', { cx: 162, cy: 40, r: 5, fill: '#A9B4C6', class: 'dot', style: 'animation-delay:.2s' }),
      h('circle', { cx: 177, cy: 27, r: 6.5, fill: '#A9B4C6', class: 'dot', style: 'animation-delay:.4s' })),
    h('g', { class: 'st m-sleeping', fill: '#A9B4C6', 'font-weight': 900, 'font-family': 'system-ui, sans-serif' },
      h('text', { class: 'zz', x: 140, y: 58, 'font-size': 14 }, 'z'),
      h('text', { class: 'zz', x: 152, y: 46, 'font-size': 18, style: 'animation-delay:.9s' }, 'z'),
      h('text', { class: 'zz', x: 164, y: 34, 'font-size': 12, style: 'animation-delay:1.8s' }, 'z')),
    h('g', { class: 'st m-puzzled' }, h('text', { class: 'q', x: 150, y: 50, 'font-size': 30, 'font-weight': 900, fill: '#FFC44D', 'font-family': 'system-ui, sans-serif' }, '?')),
    h('g', { class: 'figure' },
      // Body
      P('M38 220 C38 172 68 152 100 152 C132 152 162 172 162 220 Z', { fill: '#1D4F8C' }),
      P('M58 220 L66 176', { stroke: '#FF8A1F', 'stroke-width': 5 }), P('M142 220 L134 176', { stroke: '#FF8A1F', 'stroke-width': 5 }),
      h('rect', { x: 91, y: 132, width: 18, height: 24, fill: shade }),
      P('M92 152 L100 176 L108 152', { stroke: '#FAC775', 'stroke-width': 2.5, fill: 'none' }),
      h('rect', { x: 94, y: 175, width: 13, height: 8, rx: 2, fill: line }),
      // Head
      C(61, 104, 7, shade), C(100, 102, 40, skin),
      P('M58 92 C58 52 142 52 142 92 Z', { fill: '#FF8A1F' }),
      P('M58 92 Q100 82 156 94 Q158 101 148 101 Q100 94 58 98 Z', { fill: '#C2650F' }),
      P('M89 76 L100 68 L111 76', { stroke: '#FFF1DE', 'stroke-width': 3.5, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
      P('M89 84 L100 76 L111 84', { stroke: '#FFF1DE', 'stroke-width': 3.5, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
      h('g', { class: 'st m-open' }, h('g', { class: 'eyes' }, h('g', { class: 'pupils' },
        h('ellipse', { cx: 86, cy: 110, rx: 4.5, ry: 6, fill: ink }), h('ellipse', { cx: 114, cy: 110, rx: 4.5, ry: 6, fill: ink })))),
      h('g', { class: 'st m-ready' }, P('M80 112 Q86 104 92 112', round), P('M108 112 Q114 104 120 112', round)),
      h('g', { class: 'st m-sleeping' }, P('M80 111 Q86 115 92 111', round), P('M108 111 Q114 115 120 111', round), C(100, 126, 3, mouth)),
      P('M79 100 L92 98', { stroke: mouth, 'stroke-width': 2.5, 'stroke-linecap': 'round' }),
      P('M108 98 L121 100', { class: 'brow-r', stroke: mouth, 'stroke-width': 2.5, 'stroke-linecap': 'round' }),
      h('g', { class: 'st m-smile' }, P('M91 123 Q100 130 109 123', { ...round, stroke: mouth })),
      h('g', { class: 'st m-ready' }, P('M88 121 Q100 134 112 121 Z', { fill: mouth })),
      h('g', { class: 'st m-talking' }, h('ellipse', { class: 'talk', cx: 100, cy: 125, rx: 7, ry: 5, fill: mouth })),
      h('g', { class: 'st m-puzzled' }, P('M93 126 L107 123', { ...round, stroke: mouth })),
      // Headset
      C(140, 104, 8, ink), P('M140 112 Q140 128 118 128', { stroke: ink, 'stroke-width': 3, fill: 'none' }), C(116, 128, 3.5, ink),
      // Clipboard
      h('g', { class: 'board' },
        h('rect', { x: 118, y: 164, width: 42, height: 52, rx: 3, fill: paper, stroke: '#5F5E5A', 'stroke-width': 2 }),
        h('rect', { x: 131, y: 159, width: 16, height: 8, rx: 2, fill: '#5F5E5A' }),
        P('M125 180 H152 M125 189 H148 M125 198 H152', { stroke: line, 'stroke-width': 2.5 }),
        h('g', { class: 'st m-ready' }, P('M128 192 L136 200 L152 180', { stroke: '#2E9E6B', 'stroke-width': 4, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })),
        C(120, 206, 7, skin)),
      h('g', { class: 'st m-thinking' }, h('g', { class: 'pencil' },
        P('M128 196 L144 178', { stroke: '#BA7517', 'stroke-width': 4, 'stroke-linecap': 'round' }), C(146, 196, 6.5, skin)))));
  return svg;
}

export function setMood(svg, mood) {
  svg.setAttribute('data-mood', mood);
  svg.setAttribute('aria-label', labels[mood] ?? labels.idle);
}

/** The coach with a speech bubble. */
export function coachSays(mood, size, ...content) {
  return h('div', { class: 'coach-says' }, coachAvatar(mood, size), h('div', { class: 'bubble' }, ...content));
}
