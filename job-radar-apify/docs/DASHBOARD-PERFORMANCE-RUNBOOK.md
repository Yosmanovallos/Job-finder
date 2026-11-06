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

### Company pages stay out of the dashboard cache

Since 2026-10-27, `GET /api/companies/:slug` and the `/empresas/:slug` SSR
page share one loader (`loadCompanyPage` in `src/server.ts`). Before, every
visit ran five or six queries one after another, with no cache for the
resolution steps: 0.9-4.4 s cold and ~0.4 s warm, measured on production.
Each company's first page also took a key in the 64-entry job-page LRU
above, where thousands of employers competed with the warmed dashboard
pages.

- `companyPageCache`: 128 entries, the same 5-minute fresh and 6-hour stale
  policy, with single-flight refresh. It holds the whole result: display
  name, logo, reputation, careers link, the first 60 jobs and the total.
  Unknown and placeholder slugs are cached too, so repeated bad slugs don't
  reach the database. Tier masking (`maskLockedFields`) runs per request,
  after the cache.
- Jobs come from `queryCompanyJobsPage()`, which skips the job-page LRU.
  The dashboard's company filter (`/api/jobs?company=`) still uses it as
  before.
- `activeCompanyNamesCache`: 4 entries (one per country scope). This is the
  `SELECT DISTINCT company` over every live row that slug resolution falls
  back to when the curated alias table doesn't match.
- Reputation and jobs run in parallel once the display name is known.
- The client keeps a 5-minute, 24-entry cache (`src/lib/company-page-client.ts`).
  Links from `/empresas` and the homepage prefetch on hover, focus and press,
  and pass the name, logo and count, so the page header paints before the
  jobs arrive.
- `CompanyLanding` paints the SSR payload on its first render instead of
  waiting for the auth session. While it waited, a short skeleton let the
  footer rise into view and jump: CLS 1.1 in 3 of 5 throttled loads.
- `tests/validate-companies-search.ts` Test 12 (`test:companies-search`,
  also part of `test:integration`) checks that cached answers keep the 404s
  and that the API and the SSR page agree.
- **After deploy:** request 3 slugs nobody has opened since the deploy, then
  the same 3 again. Expect the cold time of the old path (about 1-4 s) the
  first time and well under 0.4 s the second time. The Render log must show
  no `[company-page-cache]` warnings.
- **Verified 2026-10-27** after PR #50 (`3212d1c`, live 17:21 UTC): cold
  slugs `arroz-federal`, `as-transportes` and `aseos-la-perfeccion` took
  1.14-1.18 s, then 0.21-0.24 s on both repeats. Their SSR pages took
  0.25-0.31 s to first byte. The CLS of `/empresas/bancolombia` and
  `/empresas/mercado-libre` was 0.002 and 0.018 on all 5 throttled loads
  (before: 1.1 on 3 of 5). The `verify` CI check passed.

### The auth client loads after the first render

Since 2026-10-27, `@supabase/supabase-js` is its own chunk, loaded by
`getSupabase()` in `src/auth/auth-provider.tsx` right after the first
render. The client only uses `.auth`, but the full library (auth, storage,
postgrest, realtime) was in the main chunk that every page waits for.

- Main chunk: 148.2 KB → 98.1 KB gzip (515 → 316 KB raw). Supabase chunk:
  50.6 KB gzip, not preloaded.
- Same host, throttled phone (CPU 4x, 1.6 Mbps, 150 ms), median of 5,
  uncompressed local preview: React mounts 0.8-1.2 s earlier and LCP comes
  0.55-0.9 s earlier on `/`, `/dashboard` and `/empresas`. Production serves
  compressed assets, so expect a smaller gain there.
- `loading` stays true until the session resolves, as before.
  `AuthCallback` and `ResetPassword` already wait for it. While it's true,
  the header lays out the signed-out buttons invisibly, so nothing moves
  when they appear.
- If the chunk fails to load, the visitor stays signed out (`loading` ends)
  instead of waiting forever.

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
- Render deploy log (source `9e80c3c`, shared by the owner): startup
  logged `dashboard_cache_warmed` with `durationMs: 2003` for CO and VE
  before the port opened (baseline warmup: 10,496 ms), then "Your service
  is live" with `/api/health` 200.

### 2026-10-27 after deploying PR #48 (`bdc843a`, live 15:52 UTC)

The official-vacancy identity query changed; the cache, warmup and Render
plan stayed intact. Three unique URLs per country produced Cloudflare `MISS`
before and after this deploy:

| Measurement | Before | After |
| --- | ---: | ---: |
| `/dashboard` time to first byte | 363, 269, 249 ms | 298, 257, 276 ms |
| `/ve/dashboard` time to first byte | 336, 241, 253 ms | 258, 261, 256 ms |

Render's [deploy log](https://dashboard.render.com/web/srv-d9i11d7abvsc73a8db4g/deploys/dep-dbgch9jbc2fs73a676bg)
shows `dashboard_cache_warmed` for CO/VE in 2,194 ms before the server
listened, followed by `/api/health` 200 and Live. The sampled internal
`/dashboard` requests took 14, 6 and 6 ms; `/ve/dashboard` took 8, 7 and
8 ms. The public Altipal filter returned 44 cards with 44 unique IDs, no
identical title/location/description groups, and two distinct official detail
IDs returned 200. This measurement was captured while `bdc843a` was Live;
later deploys may change the active revision.

**CLS found while verifying.** With a throttled phone (4x CPU, slow 4G),
the server-rendered `/dashboard` body (H1 and job list, before React
mounts) shifted 24 px when the Google web fonts swapped in: CLS 0.416 on
every run. Serving the pre-redesign render-blocking font stylesheet gives
the same 0.416, so it predates this release; the old Lighthouse baseline
missed it. `/` and `/empresas` measure 0.000. Fixed by metric-matched
fallback fonts (`index.css`): the same test with the fixed CSS measures
0.000, 0.000, 0.001. Re-measure after that change deploys.

### 2026-11-02 job page blocks B1-B3 (`codex/job-page-blocks-b1-b3`, before deploy)

`/empleos/:id` gained the employer's other vacancies (B1), reputation in the
raw HTML (B2) and the official-employer mark (B3). The dashboard cache, its
warmup and `companyPageCache` are untouched.

- B1 has its own `companyJobsCache` with these rules:
  - Policy: SWR 5 min / 6 h, 512 entries, light rows only.
  - Reads: only through `peek`.
  - Concurrency: one background load at a time; a load requested while one
    is running is dropped. The pool has 5 connections.
  - Timing: a cold load starts only after the response is sent.
  - No startup warmup.
- Queries per `/empleos/:id` response with warm caches: 2 anonymous and 2 with
  a session, the same as `origin/main` 109f392. This is pinned by
  `tests/validate-job-page-blocks.ts` (JPD-008).
- Production before (5 job pages × 3 unique URLs, all Cloudflare `MISS`): TTFB
  median 266 ms, range 248-322 ms.
- Local cold process (disposable PostgreSQL, 9 fresh processes per side,
  alternating):

  | Measurement | `origin/main` | Branch |
  | --- | ---: | ---: |
  | First request of each process (median) | 65 ms | 70 ms |
  | The 5 job pages | 15.1 ms | 14.9 ms |

  The first-request numbers are noisy: 61-78 ms on `main` and 59-89 ms on the
  branch.
- **After deploy (pending):** the same 5 URLs with unique query strings and
  `MISS`. The limit is +10 % of 266 ms. Re-check at +1 and +14 days. Revert B1
  if a regression is traced to its cache.

### 2026-11-02 `$` in source text (`codex/ssr-replace-dollar`, before deploy)

SSR insertions now use function replacers (`() => html`) instead of
replacement strings, so `$&`, `` $` ``, `$'` and `$$` in source text are no
longer expanded. There are no new queries, caches or warmups. The bytes change
only when the source text contains `$`.

- Production before (the same 5 job pages × 3 unique URLs, 15/15 Cloudflare
  `MISS`): TTFB median 264 ms, range 248-410 ms.
- Local cold process (disposable PostgreSQL, 9 fresh processes per side,
  alternating, against `codex/job-meta-f5`):

  | Measurement | Base | Branch |
  | --- | ---: | ---: |
  | First request of each process (median) | 75.5 ms | 73.2 ms |
  | The 5 job pages | 17.8 ms | 18.5 ms |

- **After deploy (pending):** the same 5 URLs with unique query strings and
  `MISS`. The limit is +10 % of 264 ms.

### 2026-11-02 searches read only the matching vacancy groups (`codex/search-latency`, before deploy)

A search on `/api/jobs` that is not cached cost about 1.0-1.4 s in
production, against about 0.25 s once cached. `EXPLAIN (ANALYZE, BUFFERS)` on
a disposable PostgreSQL 16 shows the cause. The canonical projection
(country-only sibling window, sort and `DISTINCT ON` over every live row)
took about 380 ms of a 590 ms `contador` search. The search predicate over
the ~38k canonical rows took about 175 ms. `COUNT(*) OVER()`, the `details`
join and the `LIMIT` took under 40 ms.

Two tweaks were measured and discarded:

- Dropping `description` from the projection: no change.
- `COLLATE "C"` on the identity keys: slower, because it loses the
  incremental sort.

What changed (`queryJobsPage`, searches only):

- A `search_hits` CTE (`MATERIALIZED`, hash semi-join) collects the
  `(identity_title, identity_company, identity_instance)` keys
  (`vacancyGroupKeySql`) of the live rows that pass the same WHERE.
- The canonical projection then reads only the live rows of those groups.
- A `DISTINCT ON` group only adds the location, and a `has_city_sibling`
  partition only adds the country. Every kept group therefore elects the
  same canonical row. The unchanged WHERE then gives the same rows, total
  and order.
- None of the three keys can be NULL.
- Broad searches skip the narrowing. `search_hits` stops at
  `SEARCH_NARROW_MAX_HITS` + 1 rows (10,001). If it fills up, the projection
  reads every live row as before. Otherwise it holds every match.
  - Without this cutoff, `empresa`, which matches ~96 % of the synthetic
    rows, went from 560 to 808 ms.
  - With it, `empresa` takes 504 ms against 564 ms before.
- `tests/validate-search-narrowing.ts` (`test:integration`, `test:job-pagination`)
  compares every page of 91 queries with and without the narrowing. The
  queries cover:
  - a canonical row that fails while an older sibling passes;
  - country-only rows;
  - official postings;
  - confidential employers;
  - NULL company/location;
  - the same title in CO and VE;
  - the modality filters;
  - a search with 10,050 hits (the broad branch).

  A naive pre-filter (rows instead of groups) fails it.
- Queries without a search (dashboard, warmup, category and company pages,
  home stats) send exactly the same SQL as before. The job-page LRU, the
  block cache and the CO/VE warmup are untouched. No migration.

Local measurement, `scripts/bench-search-latency.ts`:

- Setup: disposable PostgreSQL 16 in Docker with `--cpus 1` and 512 MB.
  56.5k synthetic rows, 49.9k active, including 1.5k official projections.
- Method: old and new SQL timed alternately in the same process, 9 rounds,
  median (range). Parity was identical on every page of all 28 queries.
- The old SQL is bimodal (about 0.5 s or about 1.0 s per run, depending on
  whether its sort spills), so look at both columns, not one number.

| Query (`country=CO`, `limit=20`) | Before (median) | After (median) |
| --- | ---: | ---: |
| contador / analista / vendedor | 635 / 999 / 827 ms | 417 / 296 / 426 ms |
| auxiliar / desarrollador | 527 / 514 ms | 277 / 332 ms |
| AI Engineer / community manager / marketing | 647 / 528 / 514 ms | 434 / 302 / 282 ms |
| markerting / zzzzqx (0 results) | 1,026 / 519 ms | 213 / 194 ms |
| AI Engineer + remoto / marketing + hibrido / contador + presencial | 580 / 525 / 603 ms | 377 / 262 / 318 ms |
| analista offset 24 / 120 (blocks) | 1,105 / 1,186 ms | 298 / 328 ms |
| Broad: empresa (33k hits) / colombia (4.6k) | 564 / 753 ms | 504 / 331 ms |
| No search (dashboard) / modality only | 470 / 858 ms | 494 / 865 ms (same SQL) |

Cold process, measured locally:

- Setup: `NODE_ENV=production` and the same disposable database, with only
  synthetic environment variables and no `.env`.
- Startup logged `dashboard_cache_warmed` for CO/VE in 1,183 ms before the
  port opened.
- `/dashboard` on 5 unique URLs: 6-24 ms.
- New searches through HTTP: `contador`, `analista`, `vendedor`, `auxiliar`
  and `desarrollador` took 0.27-0.50 s; `markerting` took 0.13 s. Repeats
  took about 5 ms, served from cache.

What remains of a search:

- Two sequential scans: the predicate over the live rows (about 90 ms) and
  the group join (about 110 ms).
- A precomputed normalized title with a trigram index could remove the first.
  That is an additive migration, deferred until production numbers show it
  is needed.
- Network time to the database is unchanged, so expect production to drop by
  the database share only, roughly 0.3-0.6 s of the 1.0-1.4 s.

**After deploy:**

- Request `/api/jobs?country=CO&search=<term>&limit=20` for `contador`,
  `analista`, `vendedor`, `auxiliar` and `desarrollador`, with a unique
  `&coldcheck=<random>` so the edge answers `MISS`. Then repeat each URL once.
- Keep `limit=20` exactly. The dashboard asks for 24, so visitors never warm
  these app-cache keys. `coldcheck` only defeats the edge.
- Also request one broad term, `search=colombia`, which matches most
  production locations. It must not be slower than before (about 1-1.4 s).
- Compare the first requests with the 2026-11-02 baseline of 1.03-1.39 s.
  The repeats should stay at about 0.25 s.
- `/dashboard` on unique URLs must stay at 250-330 ms. The Render log must
  show `dashboard_cache_warmed`.

**Verified 2026-11-03** after PR #106 (`15feb3f`):

- Deploy: merged 11:25 UTC; the process restarted at about 11:25:45 UTC
  (`/api/health` uptime). No other restart followed in the next 9 minutes.
- `/api/jobs` answers Cloudflare `BYPASS`, so every request reached Render.
  "Cold" means an app-cache key nobody had requested.
- Cold samples: before = the same day on the old code; after = varying
  `limit` (11-20) on the new code, which gives new cache keys for the same
  SQL work.

| `/api/jobs?country=CO&search=…` | Before | After |
| --- | ---: | ---: |
| analista | 1.20 s | 0.72-0.75 s (6 samples) |
| auxiliar / desarrollador | 1.19 / 1.17 s | 0.75 / 0.81 s |
| contador | 2.30 s (2026-11-02: 1.03-1.39 s) | 0.81-0.92 s (5 samples), one 1.50 s |
| vendedor | 1.47 s | 1.18 s |
| colombia (16,529 results, broad path = old SQL) | 1.26 s | 1.21-1.34 s (5 samples), one 2.03 s |
| Repeats (cached) | ~0.25 s | 0.23-0.32 s |

- Selective searches lost about 0.35-0.5 s. A cached response, which is
  mostly network and server overhead, takes ~0.25 s; so the database part of
  `analista` went from ~0.95 s to ~0.48 s.
- The broad search stays where it was, as designed.
- `/dashboard` with Cloudflare `MISS`: 257, 266 and 312 ms. `/ve/dashboard`:
  260, 276 and 284 ms. Both are inside the 250-330 ms baseline.
- The Render deploy log was not read in this check, so `dashboard_cache_warmed`
  is not confirmed from the log. The fast `MISS` responses of the SSR first
  page are consistent with a successful warmup.

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

## SEO Fase B: copia de vacantes aptas recientes (2026-11-06, sin desplegar)

- Una consulta de solo lectura (aptas publicadas en 72 h) alimenta `/sitemap-jobs-recent.xml`, «Nuevas hoy» de los hubs e IndexNow. Tiene su propia caché (`recentReadyCache`, 1 entrada, 10 min fresca, 2 h usable), separada de `jobsPageCache`, así que no desaloja las primeras páginas del dashboard.
- Arranque: se carga **después** del warmup del dashboard y antes de `listen`, con 5 s como máximo (evento `recent_ready_cache_warmed`). Si el warmup del dashboard falla o se pasa de tiempo, no se carga y los hubs omiten el bloque hasta que la copia exista.
- Los hubs solo hacen `peek()`: nunca esperan a Postgres. Medición local en frío (3 procesos por lado, mediana): Bogotá 63→68 ms, VE project-manager 37→32 ms, Medellín 29→31 ms. Producción antes (MISS, URL única): 0,26–0,30 s con caché de app caliente.
- Tras desplegar: comprobar `dashboard_cache_warmed` y `recent_ready_cache_warmed` en los logs de Render, y el TTFB MISS de `/empleos/bogota`, `/empleos/medellin`, `/empleos/cali`, `/empleos/asesor-comercial` y `/ve/empleos/project-manager`.
