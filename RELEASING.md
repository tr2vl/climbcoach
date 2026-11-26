# Releasing ClimbCoach for Windows

Updates reach your friend by themselves: you publish a release on GitHub, their app downloads it in the
background and installs it at the next restart.

## One-time setup (about 15 minutes)

1. **GitHub account.** Make a free account at github.com if you don't have one. Then, on github.com,
   **Settings → Emails**: tick **Keep my email addresses private**. The code is public, and this keeps
   your email address out of it.
2. **GitHub Desktop.** Install it from desktop.github.com, open it and sign in. When it asks how to
   configure Git, pick the private `…@users.noreply.github.com` address as the email.
3. **Make this folder a repository.** In GitHub Desktop: **File → Add Local Repository… → Choose…**, pick the
   `windows` folder inside `OW Analyzer`, click **Add Repository**. It says this isn't a Git repository yet:
   click **create a repository**. Leave the name as `windows` (that's the folder on your Mac), leave
   README, Git ignore and License as they are, and click **Create Repository**.
   If files are still listed on the left afterwards, type `ClimbCoach for Windows 1.0.0` under Summary and
   click **Commit to main**.
4. **Publish it.** Click **Publish repository** at the top. Change the name to `climbcoach`, **untick
   "Keep this code private"**, click **Publish Repository**. Don't create the repository on github.com
   first: Publish creates it.
   Public means anyone can read the code. Your API keys are never in it: each player enters their own.
5. GitHub now runs **Check** on a Windows PC: the tests (including Windows' own text recognition) and a
   test build. Watch it under the **Actions** tab of your repository on github.com (Repository → View on
   GitHub). A green tick after about 10 minutes means it passed.

### Website only, without GitHub Desktop

Instead of steps 2–4: Claude puts a folder `climbcoach-upload` next to `windows` holding only the files that
belong on GitHub (no `node_modules`, no `dist`).

1. On github.com: **+** (top right) **→ New repository**. Name `climbcoach`, **Public**, and leave README,
   .gitignore and license **off**. Click **Create repository**.
2. On the next page, click the **uploading an existing file** link.
3. Open `climbcoach-upload` in Finder and press **Cmd+Shift+.** so the hidden `.github` folder and
   `.gitignore` show (`.github` holds the build instructions; without it nothing gets built). Press
   **Cmd+A** and drag everything onto the GitHub page. Don't drag the `climbcoach-upload` folder itself,
   or everything ends up one folder too deep.
4. Wait until all files are listed, type `ClimbCoach for Windows 1.0.0` as the message, click
   **Commit changes**. Check that `.github` is in the file list on the repository's main page.

## Publishing a version

1. Make sure the version in `package.json` is new (1.0.0 for the first release, then 1.0.1, 1.0.2, …).
   When Claude changes the app for you, it raises the version too.
2. Commit and push the change (GitHub Desktop: Commit, then Push origin). Website only: Claude refreshes
   `climbcoach-upload`; on your repository's main page click **Add file → Upload files**, drag everything
   in again as above (unchanged files stay unchanged) and click **Commit changes**. If Claude says a file
   was removed, open it on github.com and delete it there (**…** → **Delete file**).
3. On github.com, open your repository → **Actions → Release → Run workflow → Run workflow**.
4. After about 10 minutes the release appears under **Releases** with `ClimbCoach-Setup-x.y.z.exe`.

**First time:** send your friend the link `https://github.com/<your-username>/climbcoach/releases/latest`
and the install steps in README.md.

**After that:** nothing. Their app updates itself within about 4 hours of being open, or at its next start.

## If something goes wrong

- **Release says "already released":** raise the version in `package.json`, commit, push, run it again.
- **A red cross under Actions:** open it to read which test failed; ask Claude to fix it.
- **Your friend's app doesn't update:** they need ClimbCoach open for a moment, then restart it.
  Settings → Updates shows what it found and has a "Check now" button.
