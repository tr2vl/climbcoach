// Tiny DOM helpers and the shared pieces of the ClimbCoach design (panels, titles, tags, tiles, icons).

/** h('div', { class: 'x', onclick }, child, 'text', [more]) → element. */
export function h(tag, props = {}, ...children) {
  const svgTags = new Set(['svg', 'path', 'g', 'circle', 'ellipse', 'rect', 'polyline', 'polygon', 'line', 'text', 'defs', 'linearGradient', 'stop']);
  const element = svgTags.has(tag) ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') element.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'style' && typeof value === 'object') Object.assign(element.style, value);
    else if (key === 'html') element.innerHTML = value;
    else if (key === 'value' && 'value' in element) element.value = value;
    else if (key === 'checked') element.checked = Boolean(value);
    else element.setAttribute(key, value === true ? '' : value);
  }
  append(element, children);
  return element;
}

function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export const colors = {
  orange: 'var(--orange)', blue: 'var(--blue)', success: 'var(--success)', danger: 'var(--danger)',
  warning: 'var(--warning)', secondary: 'var(--text-2)',
};

export function panel({ accent = null, className = '' } = {}, ...children) {
  return h('section', { class: `panel ${className}` },
    accent ? h('div', { class: 'accent', style: { background: accent } }) : null,
    h('div', { class: 'stack' }, ...children));
}

export const sectionTitle = (text, ...trailing) => h('div', { class: 'row' },
  h('h2', { class: 'section-title' }, h('span', {}, text)), h('div', { class: 'grow' }), ...trailing);

export const tag = (text, color) => h('span', { class: 'tag', style: { '--tag-color': color } }, text);

export const statTile = (label, value, detail) => h('div', { class: 'stat-tile' },
  h('div', { class: 'overline' }, label), h('div', { class: 'value' }, value), detail ? h('div', { class: 'caption' }, detail) : null);

export const button = (label, onclick, { kind = '', disabled = false, title } = {}) =>
  h('button', { class: `btn ${kind}`, onclick, disabled, title }, label);

export const screen = (title, subtitle, ...content) => h('div', { class: 'screen' },
  h('div', { class: 'screen-inner' },
    h('header', { class: 'screen-header' }, h('h1', {}, title), h('div', { class: 'rule' }), h('p', {}, subtitle)),
    ...content));

/** The ClimbCoach mark: three stacked chevrons climbing from blue to orange. */
export function brandMark(size = 30) {
  const chevron = (y, fill) => h('path', { d: `M0 ${y + 6.3} L15 ${y} L30 ${y + 6.3} L30 ${y + 10.8} L15 ${y + 4.5} L0 ${y + 10.8} Z`, fill });
  return h('svg', { width: size, height: size, viewBox: '0 0 30 30', class: 'mark', 'aria-hidden': 'true' },
    h('defs', {},
      h('linearGradient', { id: 'cc-blue', x1: 0, y1: 0, x2: 0, y2: 1 }, h('stop', { offset: 0, 'stop-color': '#6CC2FF' }), h('stop', { offset: 1, 'stop-color': '#3FA9F5' })),
      h('linearGradient', { id: 'cc-orange', x1: 0, y1: 0, x2: 0, y2: 1 }, h('stop', { offset: 0, 'stop-color': '#FFB54D' }), h('stop', { offset: 1, 'stop-color': '#FF7A0A' }))),
    chevron(17.4, 'rgba(63,169,245,0.4)'), chevron(9.9, 'url(#cc-blue)'), chevron(1.8, 'url(#cc-orange)'));
}

/** Outline icons for the navigation, drawn for ClimbCoach (24 × 24, 1.7 stroke). */
const iconPaths = {
  dashboard: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  importMatch: 'M12 3v11M7.5 9.5 12 14l4.5-4.5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4',
  reports: 'M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h5M14 3l5 5M14 3v5h5M19 8v3M16.5 19.5l3 3M17.5 16.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  progress: 'M4 20h16M4 16l5-5 4 3 7-8M15 6h5v5',
  deaths: 'M5 7h14v13H5zM7 4h10M8 7v13M16 7v13M5 11h3M5 16h3M16 11h3M16 16h3',
  meta: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20a6 6 0 0 1 12 0M17 11a2.5 2.5 0 1 0 0-5M18 14a5 5 0 0 1 3 5',
  maps: 'M9 4 3 6.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5zM9 4v13.5M15 6.5V20',
  learn: 'M3 5h18v14H3zM10 9v6l5-3z',
  practice: 'M12 3v4M12 17v4M3 12h4M17 12h4M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  check: 'M5 12.5 10 17l9-10',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  key: 'M15 7a4 4 0 1 1-3.6 5.7L4 20v-3h3v-3h3l1.4-1.4A4 4 0 0 1 15 7zM16 9h.01',
  record: 'M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12z',
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  arrowLeft: 'M19 12H5M11 6l-6 6 6 6',
  shield: 'M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6z',
  download: 'M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14',
  alert: 'M8.5 3h7L21 8.5v7L15.5 21h-7L3 15.5v-7zM12 8v5M12 16h.01',
  flame: 'M12 21c3.9 0 6-2.7 6-6 0-4-3-6-4-9-1.5 1.5-2 3-2 4.5C11 9 10 8 9.5 6.5 7.5 8.5 6 11 6 15c0 3.3 2.1 6 6 6z',
  bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z',
  play: 'M7 4l13 8-13 8z',
  stop: 'M6 6h12v12H6z',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  folder: 'M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z',
};

export function icon(name, size = 18) {
  return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' }, h('path', { d: iconPaths[name] ?? '' }));
}
