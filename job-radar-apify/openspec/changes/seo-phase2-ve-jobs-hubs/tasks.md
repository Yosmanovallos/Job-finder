# Tasks: seo-phase2-ve-jobs-hubs

- [x] 1. Branch clean isolated worktree `codex/seo-phase2-ve-jobs-hubs` from `origin/main` (`d37024f`), install deps (`npm ci`), and verify baseline `npx tsc --noEmit`.
- [x] 1. Branch clean isolated worktree `codex/seo-phase2-ve-jobs-hubs` from `origin/main` (`d37024f`), install deps (`npm ci`), and verify baseline `npx tsc --noEmit`.
- [x] 2. Author OpenSpec proposal/tasks and amend `ADR 0006` (§15), `ADR 0010` (VE fallback addendum), and `ADR 0014` (wave-2 guarded hubs addendum).
- [x] 3. Implement 2A VE pacing fix (`PACED_FALLBACK_MS_VE = 4.5 h`, `pacedFallbackMsFor`) in `src/queue/source-pacing.ts` and extend `tests/validate-source-pacing.test.ts`.
- [x] 4. Implement 2B-1 Workday anti-429 retry coordination (`noRetryOn429`, bounded `Retry-After`) and per-pod serialization/cooldown/3x429 skip in `src/direct/{types,http,ats/workday,tick}.ts`.
- [x] 5. Implement 2B-2 official-vacancy Indexing API priority behind `directIndexingEnabled()` in `src/db/indexing-repository.ts`, `src/db/direct-projection-repository.ts`, `scripts/backfill-indexing-queue.ts`, and extend `tests/validate-direct-projection.ts`.
- [x] 6. Implement 2C-1 (absorb PR `#142` `buildJobTitleTag`) and 2C-2 (4 low-overlap guarded hubs `Chía`, `Sincelejo`, `Anzoátegui`, `San Cristóbal`) in `src/lib/job-seo.ts` and update `tests/validate-job-meta.test.ts` + `tests/validate-empleos-coverage.test.ts`.
- [x] 7. Add `tests/validate-phase2-seo-growth.test.ts` and register in `scripts/run-isolated-tests.ts` (`suites.unit`).
- [x] 8. Pass all P0 gates (`tsc --noEmit`, `npm run build`, `test:unit`, `test:job-render`, `test:seo`, `test:integration`, `test:baseline`, `bench:intent-pages`, `home-cold` A/B comparison) and commit locally ONLY on `codex/seo-phase2-ve-jobs-hubs`.
