# Job rendering SEO — 2026-10-24

**Continuation 2026-10-28/29:** current-code lint/types, 10 render tests,
19 integration suites and 18-route baseline pass; five Google live examples
are indexable. New Soft 404 validation accepted 28-Oct, still initiated on
29-Oct. This supersedes the historical local gate failures below, but does
not certify all URLs recovered. See `SEO-SOFT404-RECHECK-2026-10-28.md`,
`SEO-ALERTS-TRIAGE-2026-10-29.md` and the change's
`validation-2026-10-29.md` for evidence and remaining original checklist.

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

## Release gates still pending

GitHub isolated integration/baseline, production health/metadata comparison,
and repeat Google live inspection of the identical URL. Rollback: revert the
single implementation commit; no database rollback needed. Search inclusion,
Google Jobs report recovery and traffic growth require subsequent evidence.
