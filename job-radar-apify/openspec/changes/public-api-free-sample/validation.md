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
Post-deploy checks and deployment identity are pending.

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
