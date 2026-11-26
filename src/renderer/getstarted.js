// Get started: asks how you play (nothing is assumed), sets up your own API keys, explains recording.
import { HEROES, RANK_TIERS, ROLES, capitalize, heroesFor, roleName } from '../shared/catalog.js';
import { coachAvatar, coachSays } from './coach.js';
import { button, h, icon, panel, sectionTitle } from './ui.js';

const PLATFORMS = [
  { key: 'battlenet', title: 'Battle.net on this PC', detail: 'ClimbCoach records the Overwatch window.' },
  { key: 'steam', title: 'Steam on this PC', detail: 'ClimbCoach records the Overwatch window.' },
  { key: 'geforcenow', title: 'GeForce NOW', detail: 'ClimbCoach records the GeForce NOW app or browser window.' },
  { key: 'xcloud', title: 'Xbox Cloud Gaming', detail: 'ClimbCoach records the browser window you play in.' },
  { key: 'console', title: 'PlayStation, Xbox or Switch', detail: 'The PC can\'t record a console. You import videos you captured yourself.' },
];

export const STEPS = ['welcome', 'play', 'roles', 'heroes', 'gemini', 'youtube', 'recording', 'done'];
const MAX_HEROES = 6;

/**
 * @param {object} options
 * @param {object} options.climb  the app bridge (window.climb)
 * @param {object} options.settings  current settings
 * @param {(settings: object) => void} options.onFinish  called with the saved settings when you're done
 */
export function getStarted({ climb, settings, onFinish }) {
  const state = {
    step: 0,
    profile: structuredClone(settings.profile),
    keys: { gemini: '', youtube: '' },
    keyResult: { gemini: null, youtube: null },
    testing: null,
    stored: { gemini: false, youtube: false },
    recordSound: settings.prefs?.recordSound ?? true,
  };
  const root = h('div', { class: 'onboarding' });
  climb.keys.status().then((status) => { state.stored = status; render(); });

  const save = () => climb.settings.update({ profile: state.profile });
  const go = (delta) => {
    state.step = Math.max(0, Math.min(STEPS.length - 1, state.step + delta));
    save();
    render();
    root.scrollTop = 0;
  };

  function render() {
    const step = STEPS[state.step];
    const body = { welcome, play, roles, heroes, gemini: () => keyStep('gemini'), youtube: () => keyStep('youtube'), recording, done }[step]();
    root.replaceChildren(h('div', { class: 'onboarding-inner' },
      h('div', { class: 'row' },
        h('div', { class: 'overline' }, `Get started · step ${state.step + 1} of ${STEPS.length}`),
        h('div', { class: 'grow' }),
        state.step > 0 && step !== 'done' ? h('div', { class: 'caption' }, 'You can change all of this later in Settings.') : null),
      h('div', { class: 'steps', 'aria-hidden': 'true' },
        STEPS.map((_, index) => h('span', { class: index < state.step ? 'done' : index === state.step ? 'now' : '' }))),
      body));
  }

  // ---------- Steps ----------

  function welcome() {
    return [
      panel({ accent: 'var(--orange)' },
        h('div', { class: 'row top', style: { gap: '22px' } },
          coachAvatar('talking', 150),
          h('div', { class: 'stack grow', style: { gap: '10px' } },
            h('div', { class: 'title-xl', style: { fontSize: '30px' } }, 'Hi, I\'m your coach.'),
            h('p', { style: { margin: 0 } }, 'I watch your Overwatch matches after you play them and tell you, honestly, what cost you the fights. Then I train you on one habit at a time until it sticks.'),
            h('ul', { class: 'steps-list' },
              h('li', {}, h('span', {}, h('b', {}, 'You play. '), 'Press Record before a match. I never show anything in the game, and I never touch the game\'s files or memory.')),
              h('li', {}, h('span', {}, h('b', {}, 'I review. '), 'After the match, Google\'s Gemini AI watches the recording with my rules. You get a report with timestamps you can click.')),
              h('li', {}, h('span', {}, h('b', {}, 'You climb. '), 'I pick the habit that costs you the most, check it in every match, and tell you when you\'ve got it.'))),
            h('p', { class: 'muted', style: { margin: 0 } }, 'Setting up takes about 10 minutes. You\'ll need a free Google account for the AI key.')))),
      footer(null, button('Get started', () => go(1), { kind: 'accent' })),
    ];
  }

  function play() {
    const profile = state.profile;
    return [
      coachSays('talking', 84,
        h('div', { class: 'heading' }, 'First: how do you play?'),
        h('div', {}, 'I don\'t want to guess anything about you. Pick where and in which region you play, and tell me the name the kill feed shows for you.')),
      panel({},
        sectionTitle('Where do you play Overwatch?'),
        h('div', { class: 'option-grid' }, PLATFORMS.map((platform) => h('button', {
          class: `option ${profile.platform === platform.key ? 'selected' : ''}`,
          onclick: () => { profile.platform = platform.key; render(); },
        }, h('span', { class: 'option-title' }, platform.title), h('span', { class: 'option-detail' }, platform.detail))))),
      panel({},
        sectionTitle('Which region do you play in?'),
        h('div', { class: 'option-grid' }, [['americas', 'Americas'], ['europe', 'Europe'], ['asia', 'Asia']].map(([key, title]) => h('button', {
          class: `option ${profile.region === key ? 'selected' : ''}`, onclick: () => { profile.region = key; render(); },
        }, h('span', { class: 'option-title' }, title)))),
        h('div', { class: 'caption' }, 'Heroes & Meta shows win rates for players at your rank in this region.')),
      panel({},
        sectionTitle('Your in-game name'),
        h('div', { class: 'field', style: { maxWidth: '360px' } },
          h('label', { for: 'ign' }, 'As it appears in the kill feed, without the # and numbers'),
          h('input', { id: 'ign', class: 'input', value: profile.inGameName, placeholder: 'e.g. ShadowStep', maxlength: 32,
            oninput: (event) => { profile.inGameName = event.target.value; } })),
        h('div', { class: 'caption' }, 'I use it to find your kills and deaths in the kill feed and your row on the scoreboard. You can leave it empty, but reports get less exact.')),
      footer(back(), button('Next', () => go(1), { kind: 'accent', disabled: !profile.platform || !profile.region })),
    ];
  }

  function roles() {
    const profile = state.profile;
    const has = (role) => profile.roles.some((r) => r.role === role);
    const toggle = (role) => {
      profile.roles = has(role) ? profile.roles.filter((r) => r.role !== role) : [...profile.roles, { role, rank: null, heroKeys: [] }];
      profile.roles.sort((a, b) => ROLES.findIndex((r) => r.key === a.role) - ROLES.findIndex((r) => r.key === b.role));
      render();
    };
    const roleIcons = { tank: 'Holds space and soaks damage', damage: 'Gets the kills', support: 'Heals and enables the team' };
    return [
      coachSays('talking', 84,
        h('div', { class: 'heading' }, 'Which roles do you play?'),
        h('div', {}, 'Pick every role you queue for, and your rank in each. Your rank tells me what level to compare you with. It never makes a score higher or lower.')),
      panel({},
        sectionTitle('Your roles'),
        h('div', { class: 'option-grid' }, ROLES.map((role) => h('button', {
          class: `option ${has(role.key) ? 'selected' : ''}`, onclick: () => toggle(role.key), 'aria-pressed': String(has(role.key)),
        }, h('span', { class: 'option-title' }, role.name), h('span', { class: 'option-detail' }, roleIcons[role.key]))))),
      profile.roles.length ? panel({},
        sectionTitle('Your rank in each role'),
        ...profile.roles.map((roleProfile) => rankRow(roleProfile)),
        h('div', { class: 'caption' }, 'Not sure, or not placed yet? Leave it on "Unranked". Division 1 is the highest in a tier, 5 the lowest.')) : null,
      footer(back(), button('Next', () => go(1), { kind: 'accent', disabled: profile.roles.length === 0 })),
    ];
  }

  function rankRow(roleProfile) {
    const tierSelect = h('select', {
      class: 'input', 'aria-label': `${roleName(roleProfile.role)} rank`,
      onchange: (event) => {
        const tier = event.target.value;
        roleProfile.rank = tier ? { tier, division: roleProfile.rank?.division ?? 3 } : null;
        render();
      },
    }, h('option', { value: '' }, 'Unranked'), RANK_TIERS.map((tier) => h('option', { value: tier, selected: roleProfile.rank?.tier === tier }, capitalize(tier))));
    const divisionSelect = h('select', {
      class: 'input', 'aria-label': `${roleName(roleProfile.role)} division`, disabled: !roleProfile.rank,
      onchange: (event) => { roleProfile.rank.division = Number(event.target.value); },
    }, [1, 2, 3, 4, 5].map((division) => h('option', { value: division, selected: roleProfile.rank?.division === division }, `Division ${division}`)));
    return h('div', { class: 'row' },
      h('div', { class: 'heading', style: { width: '90px' } }, roleName(roleProfile.role)),
      h('div', { style: { width: '170px' } }, tierSelect),
      h('div', { style: { width: '140px' } }, divisionSelect));
  }

  function heroes() {
    const profile = state.profile;
    return [
      coachSays('talking', 84,
        h('div', { class: 'heading' }, 'Who do you play most?'),
        h('div', {}, `Click your heroes in order, most played first (up to ${MAX_HEROES} per role). I study guides for them and check their abilities in your matches.`)),
      ...profile.roles.map((roleProfile) => panel({},
        sectionTitle(`${roleName(roleProfile.role)} heroes`, h('span', { class: 'caption' }, roleProfile.heroKeys.length ? `${roleProfile.heroKeys.length} picked` : 'None picked yet')),
        h('div', { class: 'hero-grid' }, heroesFor(roleProfile.role).map((hero) => {
          const position = roleProfile.heroKeys.indexOf(hero.key);
          return h('button', {
            class: `option hero-chip ${position >= 0 ? 'selected' : ''}`, 'aria-pressed': String(position >= 0),
            onclick: () => {
              if (position >= 0) roleProfile.heroKeys.splice(position, 1);
              else if (roleProfile.heroKeys.length < MAX_HEROES) roleProfile.heroKeys.push(hero.key);
              render();
            },
          }, h('span', { class: 'option-title' }, hero.name), position >= 0 ? h('span', { class: 'order' }, position + 1) : null);
        })))),
      footer(back(), button('Next', () => go(1), { kind: 'accent', disabled: !profile.roles.some((r) => r.heroKeys.length) })),
    ];
  }

  function keyStep(kind) {
    const isGemini = kind === 'gemini';
    const result = state.keyResult[kind];
    const input = h('input', {
      class: 'input mono grow', type: 'password', value: state.keys[kind], placeholder: 'AIza…', spellcheck: 'false', autocomplete: 'off',
      'aria-label': isGemini ? 'Gemini API key' : 'YouTube API key',
      oninput: (event) => { state.keys[kind] = event.target.value.trim(); state.keyResult[kind] = null; },
    });
    const test = async () => {
      state.testing = kind;
      render();
      const value = state.keys[kind];
      const outcome = await climb.keys.test(kind, value || undefined);
      if (outcome.ok && value) state.stored = await climb.keys.save(kind, value);
      state.keyResult[kind] = outcome;
      state.testing = null;
      render();
    };
    const ready = state.stored[kind] && (result?.ok ?? true);
    const steps = isGemini ? geminiSteps() : youtubeSteps();
    return [
      coachSays('talking', 84,
        h('div', { class: 'heading' }, isGemini ? 'Your own free AI key' : 'Optional: a YouTube key for guides'),
        h('div', {}, isGemini
          ? 'Gemini is the AI that watches your matches with my rules. The key is yours, it\'s free, and it stays on this PC, encrypted by Windows. Nobody else\'s key is in this app.'
          : 'With a YouTube key, I find guides for your weak spots and your heroes and pull out what applies to you. You can skip this and add it later.')),
      panel({ accent: 'var(--blue)' },
        sectionTitle(isGemini ? 'Get your Gemini API key' : 'Get your YouTube Data API key', h('span', { class: 'caption' }, isGemini ? 'About 3 minutes' : 'About 5 minutes')),
        steps,
        h('div', { class: 'screenshot-hint' }, 'Google changes these pages now and then, so a button may be named slightly differently. Look for the closest match.')),
      panel({},
        sectionTitle('Paste your key'),
        h('div', { class: 'row' }, input,
          button(state.testing === kind ? 'Testing…' : 'Test and save', test, { kind: 'accent', disabled: state.testing === kind })),
        result ? h('div', { class: `message ${result.ok ? 'ok' : 'bad'}` }, result.ok ? icon('check', 16) : null, result.message)
          : state.stored[kind] ? h('div', { class: 'message ok' }, icon('check', 16), 'A key is saved. Paste a new one to replace it.') : null,
        h('div', { class: 'caption' }, isGemini
          ? 'The test asks Google which AI models your key can use. It doesn\'t use any of your free daily requests.'
          : 'The test looks up one video. It uses 1 of your 10,000 free daily YouTube units.')),
      isGemini ? panel({},
        sectionTitle('Good to know'),
        h('ul', { class: 'steps-list' },
          h('li', {}, h('span', {}, h('b', {}, 'Free, no card. '), 'Don\'t turn on billing in Google AI Studio; ClimbCoach only uses the free tier.')),
          h('li', {}, h('span', {}, h('b', {}, 'About 4 reports a day. '), 'The best model has about 20 free requests a day and one report needs 5. Extra matches wait for the next day by themselves.')),
          h('li', {}, h('span', {}, h('b', {}, 'Privacy. '), 'Your match video is uploaded to Google for the review and deleted by Google after 48 hours. On the free tier, Google may use what you send to improve its products.')),
          h('li', {}, h('span', {}, h('b', {}, 'Keep it to yourself. '), 'Anyone with your key can use your free requests. If it ever leaks, delete it in AI Studio and make a new one.')))) : null,
      footer(back(),
        isGemini ? null : button(state.stored.youtube ? 'Next' : 'Skip for now', () => go(1), { kind: state.stored.youtube ? 'accent' : '' }),
        isGemini ? button('Next', () => go(1), { kind: 'accent', disabled: !ready }) : null),
    ];
  }

  function link(label, url) {
    return h('button', { class: 'btn', onclick: () => climb.open(url) }, label, icon('external', 14));
  }

  function geminiSteps() {
    return h('ol', { class: 'steps-list' },
      h('li', {}, h('div', { class: 'stack', style: { gap: '6px' } },
        h('span', {}, 'Open Google AI Studio in your browser.'), h('div', {}, link('Open aistudio.google.com/apikey', 'https://aistudio.google.com/apikey')))),
      h('li', {}, h('span', {}, 'Sign in with your Google account. Any free Gmail account works.')),
      h('li', {}, h('span', {}, 'If AI Studio shows terms of service, read them and accept to continue.')),
      h('li', {}, h('span', {}, 'Click ', h('b', {}, 'Create API key'), '. If it asks for a project, choose ', h('b', {}, 'Create API key in new project'), '.')),
      h('li', {}, h('span', {}, 'Copy the key with the copy button next to it. It starts with ', h('span', { class: 'code' }, 'AIza'), ' and is 39 characters long.')),
      h('li', {}, h('span', {}, 'Paste it below and press ', h('b', {}, 'Test and save'), '.')));
  }

  function youtubeSteps() {
    return h('ol', { class: 'steps-list' },
      h('li', {}, h('div', { class: 'stack', style: { gap: '6px' } },
        h('span', {}, 'Open the YouTube Data API page in Google Cloud and sign in with the same Google account.'),
        h('div', {}, link('Open YouTube Data API v3', 'https://console.cloud.google.com/apis/library/youtube.googleapis.com')))),
      h('li', {}, h('span', {}, 'At the top, pick a project. The one AI Studio made for you works (often named ', h('i', {}, 'Gemini API'), '). Or choose ', h('b', {}, 'New project'), ', call it ClimbCoach, and press ', h('b', {}, 'Create'), '.')),
      h('li', {}, h('span', {}, 'Press ', h('b', {}, 'Enable'), '.')),
      h('li', {}, h('div', { class: 'stack', style: { gap: '6px' } },
        h('span', {}, 'Open Credentials, press ', h('b', {}, '+ Create credentials'), ' and choose ', h('b', {}, 'API key'), '. Copy the key.'),
        h('div', {}, link('Open Credentials', 'https://console.cloud.google.com/apis/credentials')))),
      h('li', {}, h('span', {}, 'Recommended: click the new key, set ', h('b', {}, 'API restrictions'), ' to ', h('b', {}, 'Restrict key'), ', tick ', h('b', {}, 'YouTube Data API v3'), ' and press ', h('b', {}, 'Save'), '.')),
      h('li', {}, h('span', {}, 'Paste it below and press ', h('b', {}, 'Test and save'), '.')));
  }

  function recording() {
    const onConsole = state.profile.platform === 'console';
    const windowName = state.profile.platform === 'geforcenow' ? 'GeForce NOW' : state.profile.platform === 'xcloud' ? 'your browser' : 'Overwatch';
    return [
      coachSays('watching', 84,
        h('div', { class: 'heading' }, onConsole ? 'How your matches get to me' : 'How recording works'),
        h('div', {}, onConsole
          ? 'Your PC can\'t record a console. Capture your match with your console\'s capture feature or a capture card, then import the video file.'
          : `Before each match you press Record and pick the ${windowName} window. That's all you do.`)),
      onConsole ? panel({},
        sectionTitle('Importing a match'),
        h('ul', { class: 'steps-list' },
          h('li', {}, h('span', {}, 'Record the whole match at 1080p if you can, including the end screen.')),
          h('li', {}, h('span', {}, 'Press ', h('span', { class: 'kbd' }, 'Tab'), ' near the end so the scoreboard is in the video.')),
          h('li', {}, h('span', {}, 'Copy the file to this PC and open ', h('b', {}, 'Import'), ' in ClimbCoach.')))) :
      panel({},
        sectionTitle('Each match'),
        h('ul', { class: 'steps-list' },
          h('li', {}, h('span', {}, 'On the Dashboard, press ', h('b', {}, 'Record'), ' and pick the ', h('b', {}, windowName), ' window. Start any time before the match.')),
          h('li', {}, h('span', {}, 'Play normally. Nothing appears in the game, and ClimbCoach never reads the game\'s files or memory.')),
          h('li', {}, h('span', {}, 'Press ', h('span', { class: 'kbd' }, 'Tab'), ' once near the end, so your scoreboard row gets recorded.')),
          h('li', {}, h('span', {}, 'At the Victory or Defeat screen, recording stops by itself, cuts the queue and menus away and starts your report.')))),
      onConsole ? null : panel({},
        sectionTitle('Sound'),
        h('label', { class: 'row', style: { cursor: 'pointer' } },
          h('input', { type: 'checkbox', checked: state.recordSound, onchange: (event) => { state.recordSound = event.target.checked; } }),
          h('span', {}, 'Record game sound (footsteps and ability sounds help the review)')),
        h('div', { class: 'caption' }, 'The sound recording includes everything you hear on this PC, voice chat too. Only keep it on if the people you play with are fine with that. You can switch it for each recording.')),
      footer(back(), button('Next', () => { climb.settings.update({ prefs: { ...(settings.prefs ?? {}), recordSound: state.recordSound } }); go(1); }, { kind: 'accent' })),
    ];
  }

  function done() {
    const heroes = state.profile.roles.flatMap((r) => r.heroKeys).map((key) => HEROES.find((hero) => hero.key === key)?.name).filter(Boolean);
    return [
      panel({ accent: 'var(--success)' },
        h('div', { class: 'row top', style: { gap: '22px' } },
          coachAvatar('ready', 140),
          h('div', { class: 'stack grow', style: { gap: '10px' } },
            h('div', { class: 'title-xl', style: { fontSize: '30px' } }, 'You\'re set.'),
            h('p', { style: { margin: 0 } }, `${heroes.length ? `${heroes.slice(0, 4).join(', ')}${heroes.length > 4 ? ' and more' : ''}: noted.` : ''} Record your first match, and after it I'll write your first report. Once two matches have reports, I pick your first habit.`),
            h('p', { class: 'muted', style: { margin: 0 } }, 'Want a quick tour of where everything is? It takes a minute.')))),
      footer(back(),
        button('Skip the tour', () => finish(false)),
        button('Show me around', () => finish(true), { kind: 'accent' })),
    ];
  }

  async function finish(withTour) {
    const saved = await climb.settings.update({ profile: state.profile, onboardingDone: true, tourDone: !withTour });
    onFinish(saved, withTour);
  }

  function back() {
    return button(h('span', { class: 'row', style: { gap: '6px' } }, icon('arrowLeft', 14), 'Back'), () => go(-1));
  }

  function footer(left, ...right) {
    return h('div', { class: 'footer-actions' }, left, h('div', { class: 'grow' }), ...right);
  }

  render();
  return root;
}
