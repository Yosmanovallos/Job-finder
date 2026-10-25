# Dashboard performance runbook

This document protects the production behavior of the first visit to
`https://buscotrabajo.co/dashboard`. Read it before modifying dashboard SSR,
job-list queries, cache lifetimes, server startup or Render configuration.

## Production and cost invariants

- `job-radar-apify` is the critical service and remains on Render Starter at
  USD 7/month.
- `buscotrabajo-social-automation` remains on Render Free.
- Intended Render spend stays below USD 10/month. Do not create, duplicate or
  upgrade paid Render services without explicit user approval.
- Performance changes start from the current production `origin/main` in an
  isolated `codex/` worktree. Do not include any CV Generator change.

## Incident and root cause

Before commit `d67fc32` (2026-09-17), the first dashboard request could spend
up to 8,562 ms inside Render and jobs became visible after about 9.48 seconds.
The personalized `/api/jobs` path reached 2,140 ms. Warm responses were already
fast at 78-115 ms.

The delay was not caused by the React client or the Render Starter plan. A cold
SSR request synchronously executed the PostgreSQL canonical job projection:
`DISTINCT ON`, normalization and `COUNT(*) OVER()` across more than 61,000 jobs.
The old in-process cache expired after 15 seconds, so visitors repeatedly paid
the full query cost.

## Protected design

Commit `d67fc32` introduced the following production contract:

- A bounded 64-entry LRU cache for job pages.
- Entries are fresh for 5 minutes and may be served stale for 6 hours while a
  single background refresh runs per key.
- Defensive copies prevent callers from mutating shared cache values.
- Before the production server opens its port, it warms the first 24 detailed
  jobs for Colombia (`CO`) and Venezuela (`VE`).
- Warmup has a 20-second timeout and a safe fallback; failure must not prevent
  startup. A successful startup logs `dashboard_cache_warmed`.

The implementation currently lives in:

- `src/lib/stale-while-revalidate-cache.ts`
- `src/db/job-repository.ts`
- `src/server.ts`
- `tests/validate-stale-cache.test.ts`

### Homepage figures stay out of the dashboard cache

Since 2026-10-25 the homepage reads all its figures from one endpoint,
`GET /api/home-stats?country=CO|VE`, instead of about 13 `/api/jobs` and
`/api/companies/search` calls per visit. Those calls used to be keys in the
64-entry job-page LRU above (about 26 for CO and VE), where homepage traffic
competed with, and could evict, the warmed dashboard pages.

- The endpoint has its own two stale-while-revalidate caches
  (`getHomeJobCounts` and `getHomeCompanies` in `src/db/job-repository.ts`):
  8 entries each, the same 5-minute fresh and 6-hour stale policy, with
  single-flight refresh. They never touch the dashboard LRU or
  `companySearchCache`.
- The job figures come from one statement: the dashboard's canonical
  projection read once, with every count a `COUNT(*) FILTER` built from
  `buildJobWhere()`, and the latest six jobs as `LATERAL` rows.
  `tests/validate-home-stats.ts` (`npm run test:home-stats`, also part of
  `test:integration`) checks that each figure equals the `/api/jobs` or
  `/api/companies/search` total for the same filter.
- Only known countries are accepted (400 otherwise), and the city list is
  fixed (`getHomeCities`), so the endpoint can't run arbitrary filters.
- A complete response is `public, max-age=60, s-maxage=300,
  stale-while-revalidate=600`. A partial one (one query failed; its figures
  are `null` and the page hides them) is `private, no-store`, so the edge
  never pins a degraded payload.
- No startup warmup: the startup gate above stays dashboard-only. The first
  homepage visit after a deploy pays for one cold statement, instead of 13
  as before.

These files may evolve, but the user-visible latency, bounded memory behavior,
single-flight refresh, startup safety and cost constraints must be preserved or
improved with measurements.

## Verified production baseline

Immediately after deploying `d67fc32`, three unique URLs all produced
Cloudflare `MISS` responses:

| Measurement | Before | After |
| --- | ---: | ---: |
| Render `/dashboard` processing | up to 8,562 ms | 92 ms, 12 ms, 9 ms |
| External total on unique URL | about 9.48 s to jobs | 480 ms, 273 ms, 273 ms |
| Startup warmup | absent | 10,496 ms for CO and VE |

The deploy reached `Live` only after the warmup completed. Normal network,
Cloudflare and browser variation is expected; compare trends and internal
Render duration rather than requiring an identical millisecond value.

## Required regression check

For any change that can affect this path:

1. Run the build and unit tests, including the stale-cache tests.
2. Start from a cold process and confirm the warmup succeeds or falls back
   safely within 20 seconds.
3. Test `/dashboard` with a unique query parameter or otherwise verify an edge
   cache `MISS`; a normal reload is not a valid cold-path measurement.
4. Inspect Render logs for request duration and `dashboard_cache_warmed`.
5. Compare cold and warm results with the baseline above. Investigate a
   material regression before deploying; do not mask it by upgrading Render.
6. Before merging or deploying, inspect the complete diff and confirm it has
   no CV Generator files and no paid-service configuration change.

If the expensive SQL projection is optimized or replaced, retain the cache and
warmup until production evidence proves they are no longer necessary. Record
new measurements and update this runbook in the same change.

## Known verification context

For `d67fc32`, `npm run build`, `npm run test:unit`, focused TypeScript checks
and `git diff --check` passed. Repository-wide typecheck still had unrelated,
pre-existing errors. Docker Desktop was unavailable, so the isolated PostgreSQL
suite was not run. Do not treat those two limitations as new failures from the
dashboard optimization, and do not use them to waive validation of future code.
