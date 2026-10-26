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

### Pages after the first are served from 96-row blocks

Since 2026-10-25, `getJobsPage()` serves any page at offset 24 or later that
fits inside a block (24-119, 120-215, ...) by running the canonical query once
with `LIMIT 96` at the block start and slicing the requested page out of it.
The block is stored in the same bounded LRU, under the same freshness policy.
Infinite scroll asks for 24 jobs at a time, and before this change every new
offset was its own cold projection.

- Offset 0 is unchanged: same query, same cache key. The startup warmup, the
  `/dashboard` SSR page and the category/company first pages behave exactly
  as before.
- A request that would cross a block boundary (for example `limit=100`)
  keeps its own direct query.
- Measured on production's public API, cold and with fresh offsets (median
  of 5): `LIMIT 24` about 1.14 s (one run 6.6 s), `LIMIT 96` about 1.30 s.
  One block costs about 0.15 s more, once, and replaces three more cold
  queries (pages 3-5).
- Memory: a block holds up to 96 jobs with details instead of 24. In the
  worst case, 64 such entries are a few MB of the 512 MB instance. Database
  egress per block is up to 4x a single page, but only for visitors who
  scroll past the first page, and it replaces the per-page queries they
  would otherwise trigger (see `SEO-IMPROVEMENT-PLAN.md` §1.21 for the
  egress history).
- `tests/validate-job-pagination.ts` (part of `test:integration`) checks
  that pages 2-4 cost one database query, match a direct query row for row,
  share one total and don't repeat jobs.
- **After deploy:** with unique filters (so every key is cold), request
  offsets 24, 48, 72 and 96. Expect one cold response of about 1.3 s and
  then cached ones of about 0.25 s. Verified 2026-10-25 (see the
  after-deploy table below).

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

### 2026-10-25 baseline before the dashboard redesign (branch `codex/homepage-redesign`)

Production as deployed (`origin/main`), measured from outside before the
redesign ships. Each request used a unique `?coldcheck=` URL, and Cloudflare
answered `MISS` on every one:

| Measurement | Result |
| --- | ---: |
| `/dashboard` time to first byte (3 unique URLs) | 444 ms, 259 ms, 252 ms |
| `/ve/dashboard` time to first byte (3 unique URLs) | 303 ms, 268 ms, 248 ms |
| Lighthouse `/dashboard` mobile (3 runs, unique URLs) | score 70-71, LCP 5.4-5.7 s, TBT 137-169 ms |
| Lighthouse `/dashboard` desktop (3 runs, unique URLs) | score 94, LCP 1.4-1.5 s |

The redesign (phase E) only changes client components: `Dashboard.tsx`
markup, `JobListItem`, `JobCard`, `FilterBar` and an opt-in `variant="ink"`
on `JobDetailPanel`. It does not touch `server.ts`, the SSR branch, the
job-page cache or the startup warmup, so the server-side cold path is
unchanged by construction. (The same release also added the 96-row block
cache and `/api/home-stats` described above, which do touch the server.)

### 2026-10-25 after deploying PR #40 (`9e80c3c`, live 02:55 UTC)

Same method as the baseline above: unique URLs, all Cloudflare `MISS` (`/`
answers `BYPASS`):

| Measurement | Before | After |
| --- | ---: | ---: |
| `/dashboard` time to first byte | 444, 259, 252 ms | 301, 248, 274 ms |
| `/ve/dashboard` time to first byte | 303, 268, 248 ms | 293, 266, 239 ms |
| `/` time to first byte | n/a | 239, 223, 243 ms |
| Lighthouse `/dashboard` desktop | 94, LCP 1.4-1.5 s | 98, LCP 1.06-1.11 s |
| Lighthouse `/dashboard` mobile | 70-71, LCP 5.4-5.7 s, CLS 0 | 66-81, LCP 4.5-5.7 s, CLS 0-0.095 |
| Lighthouse `/` mobile / desktop | n/a | 92-95 / 96-98 |

- Blocks, with a filter no one had requested (cold keys): offset 0
  1.27 s and offset 24 1.22 s (cold), offsets 48/72/96 0.25-0.26 s (served
  from the block), offset 120 1.19 s (next block). As designed.
- `/api/home-stats`: CO 0.23 s (warmed by the deploy check), VE 1.54 s
  cold, CO again 0.07 s; complete responses carry the public edge
  `Cache-Control`; `country=XX` returns 400. The figures match `/api/jobs`
  (CO 28,535 vs 28,534, read minutes apart from two caches).
- `dashboard_cache_warmed` in the Render logs: not checked from here (no
  Render log access in this environment); the owner should confirm it on
  the deploy's log.

**CLS found while verifying.** With a throttled phone (4x CPU, slow 4G),
the server-rendered `/dashboard` body (H1 and job list, before React
mounts) shifted 24 px when the Google web fonts swapped in: CLS 0.416 on
every run. Serving the pre-redesign render-blocking font stylesheet gives
the same 0.416, so it predates this release; the old Lighthouse baseline
missed it. `/` and `/empresas` measure 0.000. Fixed by metric-matched
fallback fonts (`index.css`): the same test with the fixed CSS measures
0.000, 0.000, 0.001. Re-measure after that change deploys.

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
