# Observable requirements

- JRD-001: a readable live job retains its title/description after React
  mounts even when /api/jobs is blocked, without an anonymous detail fetch.
- JRD-002: payload is id-scoped, script-safe, public fields only; no payload
  from a different job, locked page or privileged session is reused.
- JRD-003: network/5xx/malformed responses show retry; only 404/410 show absent.
- JRD-004: aborted old requests cannot replace a newly navigated job.
- JRD-005: Google live retest recognizes the same fixed URL as available,
  or records the remaining reason honestly; no indexing guarantee.
