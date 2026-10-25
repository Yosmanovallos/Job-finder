# Contract

Embed one allowlisted public job in window.__SSR_JOB__ on readable anonymous
job pages, safely escaped with escapeJsonForScriptTag. No session/token/user
data or privileged payload; locked/404/410 pages never get the payload.
Initialize client state from a matching jobId without deleting the payload
(React StrictMode must be safe). Anonymous mounts need no detail fetch.
Client-side navigation and authenticated sessions still fetch fresh detail.
Abort obsolete requests; never show the previous job under another id.

Only HTTP 404/410 means missing. Network/5xx/invalid responses show retryable
error, preserving existing matching public content if available. Same data,
title, canonical, robots and JobPosting as before; no database schema, cache, startup,
Render, indexing quota or robots changes. Rollback by reverting this phase.

Preserve employer badges using the existing one-company reputation lookup in
anonymous SSR instead of the former browser detail API. Optional failure
falls back to the readable vacancy; nested badge fields are allowlisted too.

Tests: offline browser with all network requests intercepted, real compiled
app, blocked API as in Google's renderer; stale payload/navigation, retry,
true missing statuses, script escaping and field allowlist. Disposable DB
integration checks payload originates from the real public SSR route.
