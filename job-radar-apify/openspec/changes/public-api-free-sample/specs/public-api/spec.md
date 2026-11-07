# Public API sample requirements

## Search

Search SHALL default to three results and accept integer limits from one to
three. Only offset zero is supported. Larger pages, duplicates, malformed
limits and nonzero offsets SHALL fail before a database query. A response
SHALL contain no more than three jobs and SHALL set pagination.hasMore false.

## Shared admission

Runtime REST requests, including HEAD and invalid parameters, MCP requests and
A2A requests SHALL share per-client and process admission. Changing protocol,
filters or requesting job details SHALL NOT obtain a separate quota. CORS
OPTIONS and static discovery SHALL NOT consume the sample quota. WebMCP SHALL
use these same REST routes and matching input schemas.

The process SHALL admit at most two concurrent runtime requests, 30/minute and
500/24 hours globally, and 5/minute and 25/24 hours per client. Windows SHALL
slide and rejected requests SHALL NOT prolong them. Concurrency SHALL release
on completion and exceptions. Client state SHALL expire and have a hard bound.

An exhausted quota or concurrency capacity SHALL return HTTP 429, no-store and
a positive Retry-After before reading a body or calling the database. Protocol
routes SHALL retain JSON-RPC error envelopes. Response data SHALL be private,
no-store so shared caches do not bypass admission.

## Request budget and discovery

Protocol bodies SHALL be limited to 16 KiB and five seconds, including incomplete
bodies and disconnects. Timers and body listeners SHALL be cleaned up. Docs,
OpenAPI, llms.txt, tool schemas and served Agent Skills digests SHALL agree.
The policy SHALL disclose process-local resets and shared global capacity.
