# Design and limitations

Only confirmed, recent authenticated sessions at /auth/callback count.
INITIAL_SESSION is supported for callback reloads. Explicit email signup
with an immediate session uses the same tracker. Email signup without a
session waits for confirmation. Non-callback SIGNED_IN and token refresh
never emit signup/login. Returning email password login stays unchanged.

A first Google login is within five minutes of creation; a first email
login is within five minutes of its initial email confirmation (which may
be days after creation). Invalid/future/stale dates and unknown providers
fail closed. A bounded 100-entry local browser ledger and module memory
dedupe account creation and login timestamps. No email, user id or token
is sent to GA4. Ledger identifiers remain in local browser storage.

Browser deduplication is best effort: storage clearing/denial, simultaneous
tabs, multiple devices and delayed callbacks can duplicate or lose events.
This is not a server-side exactly-once account ledger. Real registrations
must still be reconciled against authenticated database aggregates excluding
test accounts. No production data is queried or rewritten by this patch.

Rollback: revert the patch; historical GA4 data is not repaired. No database
migration, new service, account creation or authentication change is needed.
