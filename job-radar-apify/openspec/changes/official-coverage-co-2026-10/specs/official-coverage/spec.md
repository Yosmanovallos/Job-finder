# Official employer coverage — Colombia

- Every employer key with at least one currently visible Colombian job-board posting MUST be eligible for discovery; a one-posting company MUST NOT be skipped by a default minimum.
- The coverage denominator MUST exclude official job projections and employer keys absent from a complete live job-board snapshot. Retiring a missing key MUST preserve its evidence and allow reactivation on a later sighting. An empty, partial or capped snapshot MUST NOT retire keys.
- A scheduled discovery run MUST use a concurrency group separate from the official-board tick, while preserving bounded candidates, requests, deadline and promotions.
- Manual discovery MUST default to a dry run. Production promotion MUST be insert-only and use the existing evidence checks.
- Discovery MUST NOT infer a portal, posting, date or closure from a missing or blocked response.
- Coverage MUST report the total candidate denominator, how many were probed, how many have a verified official board, and the unresolved groups separately. A verified board MUST NOT imply that every job-board posting has an official counterpart.
