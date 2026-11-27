# OpenSpec Change: seo-phase1-hygiene

## Summary

Phase 1 SEO technical hygiene and crawl/render stabilization for `buscotrabajo.co` (Colombia and Venezuela), branched cleanly from `origin/main` (`bac357d0367decf32dc65e902f7499c2789a942a`) in an isolated worktree without modifying production dashboard caching, startup warmup, `auth` conversion events, or `/dashboard` indexability.

## Why

Audits against Google Search Console (`sc-domain:buscotrabajo.co`), GA4 (`547156816`), Chrome UX Report / Mobile INP, and live production SSR routes identified low-risk, high-leverage technical defects:

1. **Dashboard cache eviction by category hubs:** Un-guarded category/role/city hubs currently hit `getJobsPage`/`peekJobsPage`, evicting warmed `/dashboard` and `/ve/dashboard` entries from the `64`-entry LRU `jobsPageCache`. Isolating category hubs into a dedicated `120`-entry `categoryHubCache` protects cold/warm dashboard latency (`d67fc32` invariant).
2. **Stale fallback sitemap window & error caching:** `sendLastGoodSitemap()` serves `lastGoodJobsSitemap` indefinitely without a staleness cutoff, and `404`/`410` category/report responses + `/informes` SSR HTML lack explicit `Cache-Control: private, no-store`.
3. **Mobile INP / main-thread contention on third-party scripts:** Synchronous injection of both `gtag.js` and `adsbygoogle.js` in the same event turn blocks interactivity on mobile (`INP` pressure). Scheduling via `requestIdleCallback` and staggering `adsbygoogle.js` by `600 ms` preserves `bt-ads="on"` gating while reducing main-thread jank.
4. **Colombia vs Venezuela cross-bleed in UI, links, guides & sources:**
   - Country switcher in `Header` loses `/empleos` and `/empleos/remoto` context.
   - `HomeLanding` `/ve` remote card displays `/empleos/remoto` instead of `/ve/empleos/remoto`, and CO lacks direct high-intent discovery links (`Remoto`, `Sin experiencia`, `Inglés`, `Tiempo parcial`).
   - `Footer` mixes Colombia copy/links on `/ve/*` routes.
   - Career guides targeting Colombia are suggested on `/ve/*` pages (`guideTagsForHub` / `guideTagsForJob`).
   - `Remotive` remains listed in `SOURCES_BY_COUNTRY` despite deprecation/policy mismatch.
5. **Google `JobPosting` structured data gaps:**
   - Multi-municipality Colombia location strings (e.g., `"Medellín, Envigado, Itagüí"`, `"Bosconia, Codazzi, San Diego"`) fail DIVIPOLA department mapping or omit `"Bosconia"` (`Cesar`), while still respecting compound regions like `"Bello, Valle de Aburrá"`.
   - `hiringOrganization.name` is not trimmed when `job.company` carries trailing/leading whitespace.

## What Changes

- `src/db/job-repository.ts`: add `CATEGORY_HUB_CACHE_ENTRIES = 120`, `categoryHubCache`, `getCategoryHubPage`, `peekCategoryHubPage`.
- `src/server.ts`: route unguarded category hubs and job-detail peeks through `categoryHubCache`, bound `lastGoodJobsSitemap` staleness (`MAX_STALE_SITEMAP_AGE_MS = 60 * 60_000`), add `Cache-Control: private, no-store` on category `404`/`410` and `/informes` SSR responses, pass `visible.country` into `guideTagsForJob`.
- `index.html` & `tests/fixtures/job-page-golden/{official,third-party}.html`: defer/idle-schedule `loadThirdParties()` and stagger `adsbygoogle.js` (`600 ms`) while keeping the `bt-ads="on"` guard intact.
- `src/sections/Header.tsx`, `src/sections/HomeLanding.tsx`, `src/sections/Footer.tsx`: preserve `/empleos` & `/empleos/remoto` across `CO <-> VE` switcher, fix `/ve` remote card path, add CO-only intent nav links, scope Footer links and tagline for Venezuela.
- `src/lib/guides.ts` & `src/countries/index.ts`: suppress CO guides on `country === "VE"`, remove `Remotive` from `SOURCES_BY_COUNTRY`.
- `src/lib/co-departments.ts`, `src/lib/google-job-readiness.ts`, `src/lib/job-seo.ts`: add `"Bosconia"` to `Cesar`, export `isCoDepartment`, resolve multi-city CO regions safely, and `trim()` `hiringOrganization.name`.
- `tests/` & `scripts/run-isolated-tests.ts`: unit and regression tests for all Phase 1 guarantees.

## Non-Goals & Rollback

- Does NOT modify `/dashboard` cache size/warmup (`d67fc32`), `static/sitemap.xml`, `AuthCallback.tsx`, `auth-analytics.ts`, `home-city-discovery.ts`, `BT.png`, or CV Generator/BYOK (removed).
- Isolated on local branch `codex/seo-phase1-hygiene`; reversible with `git worktree remove` or branch reset with zero production impact.
