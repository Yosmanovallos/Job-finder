---
name: run-job-radar-apify
description: Build, run, and screenshot job-radar-apify (the BuscoTrabajo.co web app). Use when asked to start job-radar-apify, build it, take a screenshot of its UI (login, dashboard, landing), or verify a frontend change actually renders.
---

Standalone Vite/React + Node app (job board dashboard, Supabase auth,
Postgres via a direct `pg` pool). Drive it via
`.claude/skills/run-job-radar-apify/driver.mjs` — a small Playwright
wrapper, needed because `chromium-cli` is not installed in this
container and the downloaded Chromium binary is missing OS shared libs
that normally need `sudo` to install (see Gotchas — the driver works
around both without root).

All paths below are relative to `job-radar-apify/`.

## Prerequisites

No `apt-get install` needed — the driver downloads the missing shared
libs itself (see Gotchas), no root required.

`playwright` is a real `devDependency` (added after this skill's first
use, when it turned out to be `extraneous` and got silently pruned by
an unrelated `npm install`) — `npm install` at Setup below covers it.
Just make sure the Chromium binary itself is downloaded:

```bash
npx playwright install chromium
```

Node 20+ (repo targets Node 22).

## Setup

```bash
npm install
```

Needs `job-radar-apify/.env` with at least `DATABASE_URL` (Postgres —
in prod this is Supabase, session pooler mode), `VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY`. `.env` is git-ignored and denied to coding
agents (see repo's `.claude/settings.json`) — if it's missing, ask the
user for it, don't try to work around the read-deny.

## Build

```bash
npx vite build --outDir public   # public/ is git-ignored, safe to rebuild anytime
```

## Run (agent path)

```bash
node .claude/skills/run-job-radar-apify/driver.mjs smoke /tmp/job-radar-smoke
```

Builds, starts the full server (frontend + `/api/*`) on `:3000` against
whatever `DATABASE_URL` points at, screenshots `/`, `/login`, and
`/dashboard`, prints console errors per route, stops the server, and
exits non-zero if any route had a console error. This is the fastest
way to confirm "does the app still render" after a change — used to
verify the JobCard/Login/ResetPassword redesign in this repo.

Screenshots land at the path you pass (here `/tmp/job-radar-smoke/smoke_*.png`).

For anything beyond the three smoke routes — a specific dashboard
state, a filled form, a click — drive it directly:

| command | what it does |
|---|---|
| `node driver.mjs build` | `vite build --outDir public` |
| `node driver.mjs serve` | build-free; starts `tsx src/server.ts` on `:3000`, waits for `/api/health`, returns once up |
| `node driver.mjs stop` | kills whatever's listening on `:3000` and `:5173` |
| `node driver.mjs screenshot <url> <outfile> [waitForSelector]` | one navigate+screenshot against an already-running server |
| `node driver.mjs smoke [outDir]` | build + serve + screenshot `/`,`/login`,`/dashboard` + stop |

For a custom interaction (click a button, fill a form, check `/dashboard`
with real job data, applied/saved card states, mobile viewport), copy
the `screenshot()` function's body out of `driver.mjs` into a one-off
script — it already has the working `chromium.launch` + lib-path setup;
see `page.click(...)`, `page.fill(...)`, `newContext({ viewport })` in
Playwright's API for the rest. `serve()` leaves the server running
(`stop` doesn't auto-run after `screenshot`/`serve`) so you can screenshot
multiple times against it before calling `node driver.mjs stop`.

`/dashboard` doesn't require login to render real data — `verifySession`
returns `null` for no session and the API falls back to the free tier,
so job cards show up unauthenticated (some locked behind `PaywallCard`).
To see an authenticated view you'd need a real Supabase session token —
not attempted here.

## Run (human path)

```bash
npm run dev      # vite, :5173, frontend only — /api/* calls will fail, no backend
npm run server   # tsx src/server.ts, :3000, needs public/ already built
npm start        # build + server together, :3000 — closest to prod
```

Ctrl-C to stop, or `node .claude/skills/run-job-radar-apify/driver.mjs stop`.

## Test

```bash
npm run test:adapters
npm run test:dedupe
npm run test:paywall
npm run test:password-reset
npm run test:payment-flow
npm run test:dashboard-filters
npm run test:social-publisher
```

Each is a standalone `tsx tests/validate-*.ts` script (not a test
runner/suite) — run individually, prints pass/fail to stdout, exits
non-zero on failure.

---

## Gotchas

- **`Cannot find package 'playwright'` even though it worked a minute ago**
  — happened once: `playwright` was `npm install`ed without `--save`,
  sat in `node_modules` as `extraneous` (present but undeclared), then a
  *later, unrelated* `npm install <other-package>` pruned it since npm
  doesn't keep undeclared packages around. Now a real `devDependency` (see
  Prerequisites) so `npm install` always restores it — if this error comes
  back, check `package.json` actually still lists it before re-installing.
- **`chromium.launch()` fails with `error while loading shared libraries:
  libnspr4.so: cannot open shared object file`** — the playwright-downloaded
  Chromium (both `chrome-linux64/chrome` and
  `chromium_headless_shell-*/chrome-headless-shell`) dynamically links
  `libnspr4.so`/`libnss3.so`/`libatk*`/etc, which the playwright download
  does NOT include. The normal fix, `npx playwright install-deps`, shells
  out to `sudo apt-get install` — and in this container `sudo` needs an
  interactive TTY (`sudo: interactive authentication is required`), so it
  fails non-interactively. Worked around by `apt-get download <pkg>`
  (downloads the `.deb` with no root needed) + `dpkg-deb -x` (extracts
  without installing, also no root) into
  `~/.cache/job-radar-apify-chromium-libs/`, then launching Chromium with
  `LD_LIBRARY_PATH` pointed at the extracted `usr/lib/x86_64-linux-gnu/`.
  `driver.mjs`'s `ensureChromiumLibs()` does this automatically and caches
  the result outside the repo, so it only downloads once per container.
- **Ubuntu package names have a `t64` suffix** on this image
  (`libatk1.0-0t64`, not `libatk1.0-0`; `libasound2t64`, not `libasound2`)
  — a 64-bit time_t ABI transition. `apt-get download libatk1.0-0` 404s;
  `apt-cache search libatk` shows the real name. `driver.mjs`'s
  `REQUIRED_DEBS` list already has the correct names for this image —
  if `apt-get download` 404s on a fresh container, re-run `apt-cache
  search lib<name>` and fix the list.
- **`/dashboard` renders but shows "0 de 0 vacantes"** if you only ran
  `npx vite --port 5173` (frontend-only, no proxy to an API). Use
  `driver.mjs serve` (or `npm start`/`npm run server`) — the full Node
  server on `:3000` serves both the built frontend and `/api/*` from the
  same origin, no proxy needed.
- **`vite build --outDir public` is safe to run anytime** — `public/` is
  git-ignored (`.gitignore:8`), it's a pure build artifact, not deployed
  by committing it (Render presumably runs its own build).
- **Playwright's `chromium.executablePath()`** picks the currently
  cached download; if `npx playwright install chromium` was never run,
  it points at a path that doesn't exist yet — run that install command
  first (see Prerequisites).
