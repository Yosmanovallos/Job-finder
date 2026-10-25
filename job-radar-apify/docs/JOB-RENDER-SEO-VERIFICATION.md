# Job rendering SEO — 2026-10-24

Scope: `openspec/changes/job-render-seo/`, production base `bb8a01d`.

## Evidence and correction

Google URL Inspection live test returned HTTP 200, crawl/index allowed and a
self canonical, but Soft 404 for job `ed2e6351-2f8f-45fd-ab16-cee5dd966080`.
The rendered screenshot said the vacancy was unavailable. Its only failed
resource was `/api/jobs/:id`, blocked by robots.txt. Ordinary HTTP returned
the real job and the raw HTML contained its title, description and JobPosting.

The client now initializes from an allowlisted public SSR snapshot, so a
blocked detail API cannot erase a live vacancy. Authenticated and client
navigation requests remain fresh. Only 404/410 means absent; transient
failures expose retry. Public employer badges use the existing exact-company
lookup (one employer, optional failure fallback), moved from the subsequent
browser API call into anonymous SSR. No schema migration, dashboard/cache,
startup, Render plan, robots or indexing quota changes.

## Validation before publication

- Real compiled client with every network request intercepted: 10/10 pass,
  desktop/mobile API block, stale navigation, cancellation, 404/410,
  malformed response, 503, retry, safe serialization and badge allowlist.
- Full isolated unit runner: pass; no live sources or production credentials.
- TypeScript: 24 pre-existing errors remain, same as base (server line shifts).
- Repository lint: baseline 263 errors, after change 261; no new rule/file
  increases. Focused lint for new state/browser tests, client and runner passes.
- Local Docker cannot start (Docker Desktop ingest socket rename error).
  Disposable PostgreSQL integration and SSR baseline must run in GitHub CI.
- Legacy lint/typecheck gates are still failing; do not call the phase closed
  or claim those commands passed.

## Publication and live verification

PR #15 merged to production `main` as `badb4974833367bfe00929903eb68aeac2844c1a`.
GitHub run `40155054874` passed browser rendering, unit, dedicated job SEO,
public baseline and all 15 isolated integration suites. The first run
`40154844524` failed the existing sitemap heap limit (66.1 MB against 64 MB);
the unchanged control passed in the next run at +40.9 MB heap / 192.7 MB RSS.
Keep this variability visible; no threshold or sitemap implementation changed.

After release, public job snapshot exists with matching id, 3263-character
description and one employer badge. Home CO/VE, dashboard, Bogotá, Venezuela
Project Manager, login, robots and both sitemaps return 200. Status, title,
H1, canonical and robots comparisons show no drift. Fresh edge MISS dashboard:
374 ms after versus 722 ms before (single external measurements, not a
statistical performance claim). Health returns ok; unauthenticated `/api/me`
remains 401.

Search Console repeated live inspection of the IDENTICAL vacancy on
2026-10-24 21:42 America/Bogota reports: "La URL está disponible para Google",
"La página se puede indexar", one valid JobPosting, noncritical warnings.
Before release that same live inspection reported Soft 404 at 21:17.

This proves removal of the rendering blocker, not actual index inclusion or
traffic growth. Monitor subsequent index/report/traffic changes. Legacy
lint/typecheck remain open, so the phase is not administratively closed or
archived. Rollback: revert `badb497`; no database rollback needed.
