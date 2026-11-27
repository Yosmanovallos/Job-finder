# OpenSpec Change: seo-phase2-ve-jobs-hubs

## Summary

Phase 2 of the organic SEO growth roadmap for `buscotrabajo.co` (Colombia and Venezuela), branched cleanly from `origin/main` (`d37024fc44b2523ea6d7b90f432907b4a6401c6d`) on `codex/seo-phase2-ve-jobs-hubs` in an isolated worktree under a strict **`USD 0`** budget and zero impact to live `/dashboard` caching, `d67fc32`, `AuthCallback`/`sign_up`, `src/server.ts`, or existing Google rankings.

## Why

Live workflow telemetry, PostgreSQL production inventory checks (`2026-11-27`), and technical audits on `origin/main` established five safe, high-leverage bottlenecks holding back organic crawl velocity and non-brand search capture:

1. **2A — Venezuela crawl starvation (`ADR 0010` breach):** Over the last 24 runs of `scrape-jobs-ve.yml`, GitHub fired only 2 `schedule` runs and 22 `workflow_dispatch` runs. Because `VE` has only 2 per-role sources (`LinkedIn-VE`, `Computrabajo-VE`, both paced) and 0 unpaced global sources, `PACED_FALLBACK_MS = 7 h` restricted VE to ~3 ticks/day (`< 1` full sweep across 35 roles/day) instead of `ADR 0010`'s baseline `~5/day` (`p50 = 4.85 h`).
2. **2B-1 — Workday `HTTP 429` burst collisions:** In `direct-employers-tick.yml` (run `46000607197`), 24 of 30 board failures were `Workday HTTP 429 en la página 1`, while sibling boards on the exact same Workday pods (`wd1`, `wd3`, `wd5`, `wd12`) succeeded. `runDirectTick` processed clustered Workday boards with `CONCURRENCY = 3` and zero per-pod serialization/cooldown, while `boundedGet` + `workday.ts` stacked 2×2 retry bursts.
3. **2B-2 — Official portals excluded from free `200/day` Indexing API:** Official employer postings (`Portal oficial`, `direct_job_id IS NOT NULL`) convert at higher trust with verifiable closures, yet `syncProjections()` passed `notify: false` and `backfill-indexing-queue.ts` filtered `j.direct_job_id IS NULL`, giving official vacancies `0%` of the free `200/day` Indexing API quota (`USD 0`).
4. **2C-1 — Duplicate `<title>` tags across multi-city vacancies (PR `#142`):** Long titles dropped `en {city}` while falling back to the bare `job.title`, causing multi-city postings to share identical `<title>` values.
5. **2C-2 — Safe guarded city hubs (`0%–10%` verified live overlap):** Four cities with live inventory well above the 10-job guard and negligible pairwise overlap with existing hubs were missing curated pages: `Chía` (`228`, `0%` vs Bogotá), `Sincelejo` (`34`, `0%` vs Bogotá), `Anzoátegui` (`136`, `10%` vs Lechería / `0%` vs Caracas), and `San Cristóbal` (`39`, `0%` vs Caracas; `1.3 K–5.5 K` search demand). Note: `Palmira` (`284`) already has an active unguarded city hub in `COUNTRIES.CO.cities`.

## Explicitly Excluded (Safety & SEO Protection)

- `Glassdoor-VE` Cloudflare WAF (`403`): never bypass anti-bot controls (`AGENTS.md` Rule 8).
- `Magneto` / `Elempleo` `employmentType`: keep `UNRELIABLE_EMPLOYMENT_TYPE_SOURCES` (`PR #130`) untouched.
- `TELECOMMUTE` heuristic on physical city jobs: rejected (`PR #143`).
- Aburrá satellites (`Itagüí` 392, `Envigado` 340, `Bello` 344): live Top-40 pairwise overlap is `55.0%–62.5%`; deferred to avoid doorway/scaled-content overlap (`ADR 0014`).
- `/empleos/puerto-ordaz`: stays `404` per `SIW-020/052` (`validate-intent-pages.ts`); `/empleos/ciudad-guayana` already matches `"Puerto Ordaz"` via `CITY_HUB_LOCATION_ALIASES`.
- Indexing API quota increase (`200 -> 1,500/day`): requires Google Cloud billing (`USD 0` constraint).
- Zero edits to `src/server.ts`, `src/pages/**`, `src/components/**`, `src/lib/job-filters.ts`, `src/countries/index.ts`, or `CITY_OPTIONS`.

## What Changes

- `src/queue/source-pacing.ts` (+ `docs/adr/0010-external-dispatch-cadence.md`): add `PACED_FALLBACK_MS_VE = 4.5 h` and `pacedFallbackMsFor(country)`, leaving `PACED_FALLBACK_MS = 7 h` untouched for `CO`.
- `src/direct/types.ts`, `src/direct/http.ts`, `src/direct/ats/workday.ts`, `src/direct/tick.ts`: add `noRetryOn429` + bounded `Retry-After` handling in Workday (`listCalls === 2` contract preserved) and interleave + per-pod Workday serialization, pause (`2.5 s`), 429 cooldown (`10 s`), and per-tick 3×429 pod circuit break in `runDirectTick()`.
- `src/db/indexing-repository.ts`, `src/db/direct-projection-repository.ts`, `scripts/backfill-indexing-queue.ts` (+ `docs/adr/0006-direct-employers.md` §15): prioritize Google-ready official vacancies (`direct_job_id IS NOT NULL`) inside the free `200/day` Indexing API behind rollback flag `DIRECT_INDEXING_ENABLED` (default enabled), keeping `50/50` new/delete budget split and `ADR 0004` policy D2 intact.
- `src/lib/job-seo.ts` (+ `docs/adr/0014-empleos-index-and-guarded-city-hubs.md`): absorb PR `#142` (`buildJobTitleTag` retains `en {city}` before dropping city) and add the 4 verified low-overlap hubs (`Chía`, `Sincelejo`, `Anzoátegui`, `San Cristóbal`) to `GUARDED_CITY_HUBS`.
- `tests/` & `scripts/run-isolated-tests.ts`: unit and disposable-Postgres integration coverage (`validate-job-meta.test.ts`, `validate-empleos-coverage.test.ts`, `validate-source-pacing.test.ts`, `validate-direct-projection.ts`, `validate-phase2-seo-growth.test.ts`).

## Rollback

- `DIRECT_INDEXING_ENABLED=false` (no code deploy): stops official `URL_UPDATED` notifications/backfill and restores strict chronological ordering in `new` lane immediately.
- `EMPLEOS_COVERAGE_ENABLED=false` (no code deploy) or removing entries from `GUARDED_CITY_HUBS`: withdraws guarded hubs cleanly (`410`).
- Worktree isolation on local branch `codex/seo-phase2-ve-jobs-hubs`.
