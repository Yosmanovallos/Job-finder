# Controlled free API sample

The owner requests same-day containment of anonymous API consumption and
protection of the existing dashboard. Scope is one hardening phase covering
REST, MCP, A2A and WebMCP. See ADR 0013 for the intentional pagination change.

Keep three results per search and offset zero. Admit at most 5 requests/minute
and 25/24 hours per IP, with shared process caps of 30/minute, 500/24 hours and
two concurrent requests. Reject before body parsing or database work, return
HTTP 429 with Retry-After, bound protocol bodies and disable shared data caching.
Update discovery artifacts and their digests with the effective policy.

Preserve read-only semantics, dashboard routes, SQL, warmup, existing cache
policies, hosting plans and human subscription behavior. Commercial access,
billing, persistent quotas and edge-provider changes are outside this phase.

## Gates

- Focused and repository lint, application and monorepo typecheck.
- Offline unit tests including quota windows, cross-protocol use, body bounds,
  documentation alignment and concurrency release.
- Disposable PostgreSQL integration tests including real route contracts.
- Synthetic build and baseline checks, unique dashboard URLs from a cold process.
- Report pre-existing failures independently. No load tests against production.
- Deployment evidence must distinguish local checks from live safeguards.

## Rollback

Revert the commit for this phase. There are no database migrations, new services
or paid dependencies. Reverting restores the previous large anonymous pages.
