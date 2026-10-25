# Job trust requirements

## Publication date

- A recognized relative date MUST preserve its stated unit, including minutes.
- A missing or unrecognized source date MUST NOT become the current time or “Hoy” during ingestion.
- A relative date label MUST be recalculated from the stored timestamp when displayed later.
- A source-stated unknown date MUST remain visibly unknown.

## Availability

- A Computrabajo listing MUST remain visible under the owner's current decision. Its detail MUST explain near **Aplicar** that the date does not confirm availability, without a prominent unverified-availability badge.
- A Computrabajo listing MUST NOT gain a “Nueva” badge merely from an unverified date.
- A failed, blocked or inconclusive source response MUST NOT be treated as proof of closure.
- The system MUST NOT extend an anti-bot bypass to check availability.

## Application action

- Opening a public job detail MUST NOT require authentication.
- An unauthenticated **Aplicar** action MUST open only the registration/login modal; its control MUST NOT expose an external `href`.
- The modal MUST NOT include an anonymous continuation link.
- An authenticated **Aplicar** action MAY open the original source in a new tab.
- The post-login continuation MUST resolve the job by internal id, not a user-supplied external redirect URL.
