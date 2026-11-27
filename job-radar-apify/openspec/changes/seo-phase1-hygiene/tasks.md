# Tasks: seo-phase1-hygiene

- [x] 1. Isolate category hub cache (`CATEGORY_HUB_CACHE_ENTRIES = 120`, `categoryHubCache`, `getCategoryHubPage`, `peekCategoryHubPage`) in `src/db/job-repository.ts`.
- [x] 2. Update `src/server.ts` for category hub cache isolation, bounded stale sitemap (`MAX_STALE_SITEMAP_AGE_MS`), `Cache-Control: private, no-store` headers on `404`/`410` and `/informes`, and passing `country` to `guideTagsForJob`.
- [x] 3. Schedule third-party tags via `requestIdleCallback` with `600 ms` AdSense stagger in `index.html` and sync golden fixtures (`official.html`, `third-party.html`) loader block only.
- [x] 4. Fix `CO <-> VE` navigation, `/ve` remote card, CO-only intent links, and `VE` Footer scoping (`Header.tsx`, `HomeLanding.tsx`, `Footer.tsx`).
- [x] 5. Suppress CO guides on `VE` (`src/lib/guides.ts`) and remove `Remotive` from `SOURCES_BY_COUNTRY` (`src/countries/index.ts`).
- [x] 6. Add `"Bosconia"` (`Cesar`), export `isCoDepartment`, fix multi-city `addressRegion` resolution, and trim `hiringOrganization.name` (`co-departments.ts`, `google-job-readiness.ts`, `job-seo.ts`).
- [x] 7. Add unit/regression tests and register `validate-phase1-seo-hygiene.test.ts` in `scripts/run-isolated-tests.ts`.
- [x] 8. Run full verification gates (`tsc --noEmit`, `npm run build`, `test:unit`, `test:job-render`, `test:seo`, `test:sitemap`, `test:agent-readiness`, `test:home-stats`, `test:job-pagination`, `test:integration`, `test:baseline`, `home-cold`), verify diffs, and commit locally on `codex/seo-phase1-hygiene`.
