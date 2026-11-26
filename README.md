# ClimbCoach for Windows

Your Overwatch coach. Record a match, and after it ClimbCoach reviews the recording with Google's Gemini AI
and writes an honest report: the 3 costliest mistakes with timestamps, your deaths, category scores and a
drill. Then it trains you on one habit at a time until it sticks.

## Install (for players)

1. Open the **[latest release](../../releases/latest)** and download `ClimbCoach-Setup-….exe`.
2. Run it. Windows shows **"Windows protected your PC"** the first time, because ClimbCoach isn't signed
   with a paid certificate. Click **More info**, then **Run anyway**. You only see this once.
3. ClimbCoach installs for your Windows account only (no administrator password), adds a desktop shortcut and opens.
4. Follow **Get started**: it asks how you play, and walks you through getting your own free Gemini key
   (and, if you like, a YouTube key for guides). Your keys stay on your PC, encrypted by Windows.

**Updates install themselves.** ClimbCoach checks for a new version when it starts and every 4 hours,
downloads it in the background and installs it the next time you restart it. Your matches, keys and
settings stay as they are.

**What ClimbCoach never does:** show anything in the game, read the game's files or memory, or send your
data anywhere except your own match video to Google for your report (deleted by Google after 48 hours).

## For the developer

- `npm install`, then `npm start` runs the app, `npm test` runs the tests, `npm run demo` serves the
  screens in a browser with sample data.
- `src/main` is the back end (database, Gemini, recording, Windows OCR), `src/renderer` the window,
  `src/shared` the coaching logic both use. The rubric is copied from the Mac app by
  `node scripts/sync-rubric.mjs`.
- Releasing an update: see [RELEASING.md](RELEASING.md).
