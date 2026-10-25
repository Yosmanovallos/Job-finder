# Validation — 2026-10-24

Base: origin/main `516c8b8`; branch `codex/signup-analytics` in isolated worktree.

- Analytics regression suite: 11/11 passed (8 auth cases + 3 existing).
- `npm run test:unit`: passed, all 27 selected suites, sanitized environment
  and blocked TCP. Evidence: OS temporary directory
  `job-radar-test-088b41c0d87fba0489613c0db3a70092-5Ox6Cg/results.json`.
  The run included the first six new auth tests; the final two were run in
  the focused 11/11 suite after adding dispatch-failure and INITIAL_SESSION cases.
- First full-unit attempt hit the existing EXE-004 deadline timing assertion;
  a single retry passed without changing that test or its implementation.
- Typecheck: 24 existing diagnostics, byte-for-byte identical before/after.
- ESLint entire package: 263 existing errors, identical file/rule counts.
  New module and analytics tests lint clean. Provider retains two existing
  no-explicit-any diagnostics in unrelated methods.
- Build: passed with `node --import tsx --input-type=module` and Vite's
  programmatic build, `envDir:false`, synthetic Supabase settings. Initial
  invocation without the tsx preload failed loading Tailwind config; using
  the same preload as the isolated build runner resolved it without edits.
- `git diff --check`: passed.
- No live auth, GA event submission, database writes or production changes.
  Integration/SEO database suites are not applicable to this client-only patch.

## Publication and acceptance

The user authorized implementation and subsequently authorized push, merge
and deployment with post-deploy production checks and rollback on regression.
PR #14 merged as `bb8a01d6244836c4c00e99bbfa3caa37a87cf5b8` on
2026-10-24 (Bogota). The deployed public bundle `index-Dv9h-688.js`
contains the dedupe ledger and confirmation check, excludes synthetic
settings and no longer contains the previous timestamp-only signup trigger.

Post-deploy checks: homepage, dashboard, login, auth callback, Armenia,
Neiva, Santa Marta, Ibague and Caracas returned 200; local page titles and
canonicals remained correct. AuthCallback, Dashboard and Login chunks
returned 200 JavaScript. Health stayed `ok` with uptime increasing from
37 to 99 seconds. Anonymous /api/me remained 401. Sitemap returned 200
with 7,772 URLs (live inventory, not a fixed test fixture).

During rollout some cached HTML briefly referenced the previous bundle,
which returned 404 when checked after the rollout. Rechecking the exact
dashboard/login/Armenia URLs showed the new bundle, as did unique URLs
with an edge MISS. No cache or server behavior was changed in this patch.
This transient deploy/cache risk should be addressed in a separate phase;
no persistent failure remained in the checked routes. No real login,
registration, payment or GA event was submitted during public verification.

The implementation is deployed; subsequent natural conversion observation
is still pending. Future monitoring should follow these steps:
Monitor normal organic usage over complete days, compare event count with event users and reconcile
real verified account counts excluding tests using an authorized aggregate
data source. Do not generate synthetic signups in production. Start a new
measurement baseline at deployment; do not reinterpret historical inflated
events as registrations. Do not claim growth from their subsequent reduction.

Remaining audit phases: explain zero detected JobPosting items with targeted
URL inspections; improve permanent city/occupation pages based on queries.
