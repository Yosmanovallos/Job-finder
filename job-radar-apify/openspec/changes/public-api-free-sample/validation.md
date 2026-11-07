# Validation â€” 2026-11-07

Base origin/main `62ab35d`. Isolated branch `codex/free-api-limits`.
Before publication, rebase onto `c42719c` adds only a separately merged roadmap
document update.

## Local evidence

- Repository lint passes. The base had five errors in analytics.ts, job-seo.ts
  and an unused server import. Minimal equivalent regex rewrites and removal
  of the unused import clear them. Regression tests cover ASCII/C1 control
  handling and emoji component cleanup.
- Monorepo typecheck and application `tsc --noEmit` pass.
- Monorepo tests pass with 214 passed and eight pre-existing skips.
- Isolated offline unit runner passes, including 11 new quota, concurrency,
  body-budget, discovery and cross-protocol tests.
- Disposable PostgreSQL integration passes all 23 suites. The first attempt
  lacked the compiled HTML in this fresh checkout. After the synthetic build,
  the complete runner passed. No production database or live adapters were used.
- Dedicated agent-readiness integration passes with real HTTP requests. Five
  metadata calls followed by REST HEAD, MCP and A2A all yield 429, no-store and
  positive Retry-After. The same client's dashboard still yields 200.
- The default search returns at most three jobs with limit three and hasMore
  false. Nonzero offset returns 400. Schemas and served skill digests agree.
- Synthetic baseline builds successfully and checks 19 routes on desktop and
  mobile. Generated public assets remain ignored test artifacts.
- A new isolated server's first unique dashboard request took 57 ms against
  synthetic PostgreSQL. Production warmup is intentionally skipped by the
  existing isolated-test environment and is not claimed from this measurement.
- Whitespace verification with `git -c core.whitespace=cr-at-eol diff --check` passes.
  The CRLF setting recognizes the original binary-detected analytics file endings. Full diff reviewed, including text inspection of
  analytics.ts, whose base contains an actual NUL and is detected as binary.

Temporary evidence includes `free-api-unit.txt`, `free-api-integration.txt`,
`free-api-agent.txt`, `free-api-baseline.txt` and `free-api-root-tests.txt` in
the host OS temporary directory. Integration JSON report is under
`job-radar-test-31e492b06c12b3d6db76e27cc8ce1ade-iuwiVX/results.json`.

## Production measurements

Before deployment, unique Cloudflare MISS requests returned dashboard CO 200
in 400 ms and dashboard VE 200 in 243 ms. This includes network and TLS overhead.
PR 126 merged as `108582cb99e877b0ec6da0d783677af7b1b02666` at
2026-11-07 18.21 UTC (13.21 Bogotá). Both GitHub checks passed. Production
OpenAPI advertised limit three at 18.23 UTC and health showed a freshly
restarted process.

Restrained production smoke passed at 18.23 UTC. The default search returned
three real jobs, limit three and hasMore false with private/no-store and edge
BYPASS. Limit four and offset one returned 400. After five total admitted calls
across REST and MCP, A2A, REST search and REST HEAD returned 429 with Retry-After
58–59 seconds. They were not served from a shared cache.

After exhausting the sample quota, all six unique dashboard URLs returned 200
with Cloudflare MISS. CO measured 246, 254 and 209 ms. VE measured 241, 221 and
221 ms. These stay within or improve the runbook's 250–330 ms typical baseline.
Health remained 200. Evidence is `free-api-production-smoke.json` in OS temp.

Render's startup logs and explicit Live label could not be inspected. Browser
control timed out twice and then stopped because the safety system could not
verify Chrome's current URL. No further UI actions were attempted. The live
route behavior and restart are independently confirmed by HTTP, but this does
not substitute for reading dashboard_cache_warmed in Render logs. That audit
item remains open, so this OpenSpec change is not archived yet.

## Operational limits

This phase protects anonymous agent runtime routes. The website's own APIs
retain their existing controls. Quotas are process-local and reset on restart.
Forwarded client identity follows the existing proxy configuration, so global
quotas and concurrency also limit work when identities rotate. This is not a
durable billing quota or an edge DDoS control. The existing open security PR
114 separately proposes trusted-header IP attribution and is not included.

Two simultaneous incomplete protocol bodies can hold the sample slots for at
most five seconds. Large or incomplete bodies fail without a database call.
The global admission history and expiry bound client state to 500 identities
and 500 admitted timestamps in a rolling 24-hour interval per process.
