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

The user authorized implementation. Push/merge/deploy is a separate pending
step under the production roadmap; this change is not deployed or archived.
After authorized deployment verify the auth bundle, monitor normal organic
usage over complete days, compare event count with event users and reconcile
real verified account counts excluding tests using an authorized aggregate
data source. Do not generate synthetic signups in production. Start a new
measurement baseline at deployment; do not reinterpret historical inflated
events as registrations. Do not claim growth from their subsequent reduction.

Remaining audit phases: explain zero detected JobPosting items with targeted
URL inspections; improve permanent city/occupation pages based on queries.
