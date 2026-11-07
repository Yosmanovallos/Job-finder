# ADR 0013 — Bounded anonymous API sample

Date 2026-11-07. Status accepted for implementation by the owner's request.

## Decision

Keep the agent interfaces anonymous and read-only, with a deliberately small
free sample. Search returns at most three jobs, defaults to three, and accepts
only offset zero. Existing clients requesting larger pages receive HTTP 400
or a tool validation error. Pagination hasMore is false for this sample.

All runtime requests to /api/v1/* (except CORS OPTIONS), /mcp and /a2a share
sliding quotas per IP of 5/minute and 25/24 hours. Include HEAD, invalid requests,
protocol negotiation and metadata. Discovery documents remain independently
cacheable. WebMCP uses the same REST routes. No paid capabilities are advertised.

Process-wide caps of 30/minute, 500/24 hours and two in-flight requests protect
the database even when client identity varies. Reject before parsing request
bodies or importing database modules. Store bounded timestamp arrays, expire
inactive clients and fail closed on capacity. Release concurrency in finally.
API data and quota errors are private/no-store so shared caches cannot bypass
origin admission. Request bodies are capped at 16 KiB with a five-second deadline.

## Limits and deployment

Counters reset on process restart and are independent per replica. This is a
load safeguard for the current single-process service, not billing enforcement
or DDoS protection. IP attribution currently follows the existing server proxy
configuration. Global caps remain effective even if a forwarded IP is spoofed.
Durable commercial quotas and edge enforcement require a separate change.

The dashboard, its queries, protected caches and warmup keep their behavior.
No new paid infrastructure is introduced. Tests use synthetic inputs and the
isolated runners. Rollback reverts this change and restores the old public limits.
