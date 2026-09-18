# Job SEO V2 — rollout and recovery

Nothing in this document authorizes production execution. Every command below
requires a reviewed production environment and an operator-approved window.

## Order

1. `npm run seo:migrate-v2` — preflight only.
2. `npm run seo:migrate-v2 -- --apply` — additive columns and non-unique indexes.
3. `npm run jobs:classify-readiness -- --json`, then human review.
4. `npm run jobs:classify-readiness -- --apply --snapshot-out=<absolute-path-outside-repo>`.
5. Deploy the matching application revision.
6. `npx tsx scripts/backfill-indexing-queue.ts --dry-run`, then review.
7. `npm run seo:cleanup-indexing-queue`, then review.
8. `npm run seo:cleanup-indexing-queue -- --apply --snapshot-out=<absolute-path-outside-repo>`.
9. `npm run seo:finalize-queue-index`; only when it reports zero duplicate pending groups.
10. `npm run seo:finalize-queue-index -- --apply`.

The final index command fails closed when duplicates remain. It is deliberately
not part of the schema migration.

## Recovery

Classifier and queue cleanup refuse `--apply` without an absolute
`--snapshot-out` path. They create that snapshot before their first write. The
standalone `seo:backup-state -- --out=<absolute-path-outside-repo>` command is
available for an extra operator-held checkpoint. Snapshots contain IDs and
mutable readiness/queue fields, never credentials or descriptions. Verify
their location and access controls outside the repository.

`npm run seo:restore-state -- --from=<snapshot> --apply` restores those fields
in 500-row transactions. It cannot recreate deleted jobs or undo an external
deployment. Application rollback should deploy the prior application release;
the additive columns and indexes may safely remain because older code ignores
them. Never drop these columns as an emergency rollback step.

## Readiness mutation matrix

`mutateReadinessRelevantJobs()` is the required transactional path for an
existing row when changing title, company, location, country, source URL,
publication date, description metadata/content, requirements, employment or
salary data, remote eligibility, expiry, or active state. It persists the
verdict/hash and reconciles pending `URL_UPDATED` in that same transaction.
The country and dedupe administrative scripts use it.

New inserts are immediately evaluated by `saveJobs`; detail enrichment calls
the same shared refresher after it stores source content. URL rediscovery and
source-array merging update only `last_seen_at`/`sources`, which are not
readiness facts. `content_fingerprint` is a legacy dedupe lookup key, not a
Google readiness input; changing it does not change the canonical SQL rule.
Purge removes the page through its own deletion transaction and supersedes
updates while queuing a legitimate `URL_DELETED`. Time passing beyond
`valid_through` is intentionally rechecked identically at every consumer in
TypeScript and SQL because no database write occurs at the instant of expiry.
