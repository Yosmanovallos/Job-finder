# Job SEO Architecture V2 — BuscoTrabajo

**Status:** Phase A complete (approved 2026-09-18). **Phases B + C + D implemented locally on
`feat/job-seo-v2`, all isolated gates green, NOT deployed, NOT migrated, production queue NOT
cleaned** — see §8. P5 and historical backfill not started (require authorization).

| | |
|---|---|
| Base commit | `512b7c7` (= `origin/main`, what Render serves in production) |
| Branch / worktree | `feat/job-seo-v2` in `Job-finder-seo-v2/` (isolated; the main checkout is on `feature/cv-engine-v3`, 64 commits of unrelated CV work that is **not** in production) |
| Inventory taken | 2026-09-18 03:55 UTC, one `BEGIN READ ONLY` transaction against production, aggregates only — raw output in [`seo-baseline/`](seo-baseline/) |
| Companion docs | [JOB-DETAIL-ENRICHMENT.md](JOB-DETAIL-ENRICHMENT.md) · [JOBPOSTING-GOOGLE-CONTRACT.md](JOBPOSTING-GOOGLE-CONTRACT.md) · [SEARCH-CONSOLE-BASELINE-2026-09.md](SEARCH-CONSOLE-BASELINE-2026-09.md) |

## 0. Relationship to the existing roadmap (read first)

This work is not a parallel universe. `docs/PROD-IMPROVEMENTS-PLAN.md` already owns it:

| This document | PROD-IMPROVEMENTS-PLAN | Note |
|---|---|---|
| Phase B (completeness contract + lifecycle state) | **P6** "Cola persistente de enriquecimiento + calidad" | P6 already names `EnrichmentTask`, `retryable/unavailable`, "distinguir descripción completa/extracto/no disponible". |
| Phase C (mandatory detail enrichment for new jobs) | **P6** | |
| Phase D (JobPosting aligned with Google) | **P8** "`JobPosting` condicionado a datos suficientes, vigencia y permiso" + **P7** (remote ≠ geographic eligibility) | |
| Phase E (historical backfill) | **P6** "backfill acotado" | Depends on **P5** for Computrabajo (its detail parser returns 0 usable details, P5 priority 1). |
| Phases F, G, H (shards, Indexing API, Search Console) | **P8** | P8 draft proposed ~5,000-URL shards; see §6. |
| Phases I, J (snippets, categories) | new | Not in the roadmap. |
| Phase K (mobile perf) | **P10** | |

**Proposed sequencing change:** Phases B/C/D ship before P5 finishes. Rationale: they stop new damage
(thin pages entering Google), while P5 only increases supply. P5 remains the prerequisite for
backfilling Computrabajo (Phase E). The roadmap table is updated only once this is approved.

## 1. Architecture BEFORE — the lifecycle as it actually runs

```
GitHub Actions (scrape-jobs.yml / -ve.yml, */30; scrape-browser-tick.yml every 2 days)
  └─ scripts/run-scrape-tick.ts → ScrapeWorker.processRoleJob()      src/queue/scrape-worker.ts:88
       ├─ LISTING   adapter.fetchResult ?? adapter.fetch               scrape-worker.ts:160
       ├─ VALIDATE  validateJobs(): title>3, http url, KNOWN_SOURCES   src/db/job-validator.ts
       ├─ DEDUPE    content_fingerprint (title|company|location) → merge sources[]
       │            else INSERT … ON CONFLICT (url_hash) → last_seen_at = NOW()
       │                                                              src/db/job-repository.ts:62
       ├─ PUBLISH   ← implicit: the row is public the instant it is INSERTed
       ├─ INDEXING  URL_UPDATED enqueued for every new row passing
       │            isPubliclyDescribable()                            job-repository.ts:186-199
       └─ DETAIL    only if adapter.fetchDetail, only rows new THIS tick,
                    max 8 per adapter per role, budget-permitting;
                    failures are never retried                         scrape-worker.ts:22,177,216
Render web (server.ts, read-only against the same Postgres)
  ├─ /empleos/:id/:slug  getJobById (canonical check) → 200 + <h1> + one <p> + JobPosting
  │                       if isPubliclyDescribable; 410 if URL_DELETED tombstone; else 404
  │                                                                   src/server.ts:2133-2230
  ├─ /sitemap.xml        index → pages, jobs, categories              server.ts:2681
  └─ /sitemap-jobs.xml   streamed cursor, ORDER BY published_at DESC LIMIT 50,000
                                                                      server.ts:2714, job-repository.ts:446
GitHub Actions indexing-tick.yml (hourly)
  ├─ scripts/backfill-indexing-queue.ts: enqueue URL_UPDATED for EVERY describable
  │  active job with no queue history (self-heal)
  └─ scripts/run-indexing-tick.ts: FIFO oldest-first, 200/day, stop after 5 consecutive failures
Expiration: purgeOldJobs() hard-DELETEs rows unseen for 30 days (last_seen_at),
  enqueues URL_DELETED; the queue row doubles as the 410 tombstone  src/db/scheduler-repository.ts:145
```

### Source capability matrix (adapters in `src/sources/`)

| Adapter(s) | Listing method | Description at listing | `fetchDetail` | Notes |
|---|---|---|---|---|
| LinkedIn, LinkedIn-VE | HTML guest search | none | ✅ JSON-LD on `/jobs/view` | Largest source (29,350 canonical). |
| Computrabajo, Computrabajo-VE | HTML via translate.goog proxy | none | ✅ JSON-LD via proxy | Detail returns 0 usable in most attempts (P5 #1). |
| Elempleo | HTML | none | ✅ JSON-LD direct | Healthy: 92/100 detail success in 7 d. |
| Magneto | HTML | none | ✅ JSON-LD direct | |
| WeRemoto | sitemap + JSON-LD | **full** (fetches each page) | n/a | |
| RemoteOK, Remotive, GetOnBoard | public JSON API | **full HTML** in API | none needed | |
| Workana / WorkanaV2 | HTML payload / catalog | full project text | none | Freelance projects; `salary_raw` is a project **budget**. |
| Torre | public search API | **`tagline` (1 sentence)** | ❌ | `index.ts:647`. p50 = 94 chars. |
| Jooble, Jooble-VE | API | **`snippet`** | ❌ | Currently 100% rejected by `KNOWN_SOURCES` (P5 #4). |
| Glassdoor | browser + residential proxy | none | ❌ (implemented, deliberately unwired: 403 risk) | `index.ts:1590`. |
| Indeed | browser + residential proxy | none | ❌ | |

## 2. Findings (evidence-backed, severity ordered)

Numbers are from the 2026-09-18 inventory unless stated. Canonical active = **66,590**. The unique
index `idx_jobs_content_fingerprint` makes canonical = active today, and there are no inactive rows.

**F1 — The only publication gate discriminates nothing.** `isPubliclyDescribable()`
(`job-seo.ts:131`) checks company + location + url. It passes **66,590 / 66,590** rows, so every row
gets a 200 page, a JobPosting, a sitemap slot and an Indexing API notification. `seo_ready` therefore
has to be a **new** predicate, not an extension of this one.

**F2 — 57% of public JobPostings have no source description at all.** 38,034 canonical jobs have
`description IS NULL`. Their JobPosting `description` is pure BuscoTrabajo template: title, company,
"Modalidad", date, company count, "Vacante agregada de X". Live example: Glassdoor job
`f313da08…`, 269-char description, zero source text. This violates Google's "complete representation"
requirement at scale. It is also the most plausible driver of the 9,632 "Crawled – currently not
indexed" and 2,498 Soft 404 entries.

**F3 — "Has a description" overstates real coverage.** Of the 28,556 rows with text, 5,204 are
under 100 chars and 1,351 are 100–299. Torre (6,050 rows, 89.7% "with description") stores a
one-sentence `tagline` (p50 94 chars, **0 rows ≥ 300**), i.e. a teaser. A naive `has_desc` gate
would publish all of them.

**F4 — Extracted descriptions can be page chrome, not the job.** Live example: LinkedIn job
`c53b3c52…`. The "description" starts with "Emergencias: +56 72 2 335100 / Acceso / Hospital San
Fernando Informa". `qualifications` carries "Transparencia Activa; Gobierno Transparente; Ley del
Lobby", and the requirements block is duplicated verbatim. An error-token check catches none of this
(only 42 rows hit captcha/cloudflare/cookies). The completeness validator needs chrome/duplication
signals (see JOB-DETAIL-ENRICHMENT §3).

**F5 — `validThrough` is false for 14,500 live pages.** It is computed as `published_at + 30 d`
(`job-seo.ts:13,274`), but purge keys off `last_seen_at`. So 14,500 active pages (published > 30 d
ago) emit a `validThrough` already in the past while serving HTTP 200. 986 of them were re-seen by
the scraper within the last 2 days. Live example: `c53b3c52…` has `validThrough` 2026-09-15, fetched
2026-09-17, HTTP 200. No parser reads a source expiration date (`job-posting-jsonld.ts` never reads
`validThrough`), so the only truthful option is to **omit** it.

**F6 — Fabricated remote eligibility.** Every bare-"Remoto" job gets
`applicantLocationRequirements: {Country: <country or Colombia>}` (`job-seo.ts:332`). Remote jobs have
`country = NULL`, so they all claim "Colombia". Torre also labels a job remote when it has **no
locations at all** (`index.ts:626`). Live example: `e645a519…`, a New Zealand ("North Canterbury")
role emitted as `TELECOMMUTE` + applicants in Colombia. 6,012 Torre rows follow this path.
Google (page updated 2026-09-08) **requires** at least one eligible country for TELECOMMUTE jobs, so a
remote job whose source states no eligible country cannot truthfully carry JobPosting at all.

**F7 — The Indexing API queue spends almost all quota on dead URLs.** 98,529 pending URL_UPDATED
(oldest 2026-07-30) plus 41,921 pending URL_DELETED sit in a FIFO drained at 200/day, which is ~490 days for
the URL_UPDATED rows alone and ~700 days for the full 140,450-row backlog. Every one of the last 24 h's 200 sends came from the single 2026-07-30 backfill
batch, and **152 of the 200 (76%) targeted jobs that no longer exist** (they return 410). 39,298 URLs
carry both an UPDATED and a DELETED row. A job that becomes READY tomorrow would wait behind 98k rows,
so Phase C's "enqueue on READY" acceptance **cannot be observed end-to-end** until the queue is fixed.
This moves part of Phase G forward (see §5).

**F8 — The hourly reconcile would bypass any ingestion gate.** `backfill-indexing-queue.ts` enqueues
URL_UPDATED for every describable job with no queue history, every hour. A gate added only in
`saveJobs()` would be undone within an hour. The same eligibility predicate must be used here.

**F9 — Sitemap truncation.** 66,590 canonical rows vs. `LIMIT 50,000` ordered by `published_at DESC`
(`job-repository.ts:446`). The live file has exactly 50,000 `<loc>`, 10.4 MB, 4.9 s, valid XML. The
16,590 oldest (still live) jobs are never listed. `<lastmod>` = `published_at`, which is stable but
not a content-change time.

**F10 — Search Console counts zero job URLs.** `sitemaps.list` (read-only, 2026-09-18): the index
`sitemap.xml` shows `submitted=105` (= 14 pages + 91 categories). On 2026-08-11 the same index
showed 36,089. The jobs child is not tracked separately. The file serves fine today, and the cause of
the drop is not provable from here (candidates: failed fetches during the pre-P1 OOM period, or 503
under the one-stream limit). Phase H registers the shards explicitly, so each gets its own counter.

**F11 — Raw HTML has no application path.** The SSR body for a job is `<h1>` plus one `<p>`. The
outbound "Aplicar en {source}" link exists only after hydration. For anonymous visitors
`handleApplyClick` intercepts it and opens `ApplyGateModal`, which offers only login/sign-up
(`JobDetailPanel.tsx:150`). The description itself is readable without login. **This is a product
decision (lead capture) that conflicts with Google rule N / §19 and is flagged, not changed** (see §7).

**F12 — Everything `<li>` becomes "Requisitos".** `extractStructuredFromHtml()` (`utils.ts:267`)
routes every list item into `requirements`: responsibilities, benefits, even nav links (F4). The
panel titles them "Requisitos" and JSON-LD emits them as `qualifications`, so a responsibilities list
is mislabeled as qualifications on both surfaces.

**F13 — Visible copy contradicts the goal.** The panel footer says "La descripción completa … están en
la página de {source}". Once the page carries a validated complete description, that sentence is
false and must change with Phase D.

**F14 — Minor/confirmed OK.** JobPosting is emitted only on single-job pages (rule A ✓). There is no
`directApply` (✓). There is no `baseSalary` in JSON-LD, so no salary mismatch today (✓), but Workana
project budgets ("Menos de USD 50") show in the visible salary badge. `description_fetched_at` exists
and is **never written** (0 rows), so it can be reused (Phase B). `last-modified` header on
`/sitemap-jobs.xml` = request time (cosmetic). `datePosted` falls back to scrape time when a source
gives no date (`job-repository.ts:95`): 86 canonical rows have `published_at ≈ created_at`, too few to
act on in Milestone 1.

## 3. Coverage today and the honest SEO-ready estimate

| | Count | % of 66,590 |
|---|---:|---:|
| No description | 38,034 | 57.1% |
| Description < 300 chars (mostly Torre taglines) | 6,555 | 9.8% |
| Description ≥ 300 chars | 22,001 | 33.0% |
| With requirements / employment type / salary (visible) | 11,984 / 27,537 / 9,056 | |

By source (desc ≥ 300 chars / canonical): LinkedIn 10,868/29,350 · Computrabajo 1,211/15,186 ·
Torre 0/6,050 · Magneto 3,099/5,634 · Workana 4,021/4,072 · Elempleo 2,192/2,774 · Glassdoor 0/2,400
· Indeed 0/339 · WeRemoto 284/300 · RemoteOK 244/249 · GetOnBoard 68/221 · Remotive 14/15.

**Upper bound for SEO-ready at rollout: ≈ 22,000 (≈ 33%).** The real number will be lower once the
chrome/duplication checks (F4) run. It is computed deterministically in Phase B, not estimated. The
other ~44,600 pages lose JobPosting, sitemap membership and Indexing API notifications until
enrichment makes them compliant.

New-job flow (last 24 h): 1,253 new rows, 485 (39%) with any description. Glassdoor + Indeed alone add
~190 rows/day that **can never** become READY without a new detail adapter. Under the invariant that is
the correct outcome, and it is stated here so it is not a surprise later.

## 4. Architecture AFTER (target)

```
LISTING → VALIDATE → DEDUPE → INSERT (detail_status set at insert, never "public by default")
   │  listing carried a complete description?  ── yes ──► evaluate → ready | rejected
   │  adapter has fetchDetail?                 ── no  ──► unsupported
   └─ else ─► pending ─► DETAIL FETCH (in-tick slice + bounded drain step)
                          ├─ ok + passes hasCompleteJobDescription ─► ready
                          ├─ page yielded nothing (no_detail)       ─► no_detail (bounded re-tries)
                          ├─ 429/403/timeout/5xx                    ─► retry (backoff, next_attempt_at)
                          └─ attempts exhausted                     ─► failed
ready ─► first time only: seo_ready_at = now() + enqueue URL_UPDATED (same transaction)

ONE predicate, isSeoReady(row) (TS) mirrored by SEO_READY_SQL (SQL), consumed by:
   SSR JobPosting · sitemap shards · saveJobs enqueue · hourly reconcile · public stats
Non-ready canonical pages: HTTP 200, visible content as today, NO JobPosting, robots noindex,follow
Expiration unchanged: purge → URL_DELETED → 410 tombstone
```

Design principles carried from P4/P6: the adapter says what it knows (`descriptionKind: full |
snippet`), state lives in Postgres (restart-safe), every loop has a cap/budget/deadline, and there is
one eligibility module instead of scattered checks.

## 5. Implementation plan

### Phase B — Completeness contract + lifecycle state (next session)

**Schema (additive, `-- BEGIN job-seo-v2-B` block, run explicitly with authorization):**

| Column | Type | Why it is needed (not just listed) |
|---|---|---|
| `detail_status` | `VARCHAR(20)` NULL | `pending/retry/ready/no_detail/unsupported/failed/rejected`. NULL = legacy, not yet classified. |
| `detail_attempts` | `SMALLINT NOT NULL DEFAULT 0` | Bounds retries (restart-safe; memory counters reset every tick). |
| `detail_next_attempt_at` | `TIMESTAMPTZ` | Backoff + drain ordering. |
| `detail_last_error` | `VARCHAR(100)` | Error **class** only (P4 rule: never raw messages/URLs). |
| `description_fetched_at` | *(exists, unused)* | Reused as "detail content obtained at". No new column. |
| `description_source` | `VARCHAR(20)` | `listing` / `detail`: provenance of the text. |
| `content_hash` | `VARCHAR(64)` | SHA-256 of normalized description+requirements+employment+salary+location. Drives Phase G re-notification and `<lastmod>`. |
| `content_updated_at` | `TIMESTAMPTZ` | Real content-change time for `<lastmod>` (Phase F). **Stays NULL for legacy rows classified from stored text** (the change time is unknown). Phase F omits `<lastmod>` when NULL, with no fallback to `published_at` and never the classification run time. |
| `seo_ready_at` | `TIMESTAMPTZ` | First READY transition. `UPDATE … WHERE seo_ready_at IS NULL RETURNING` = exactly-once enqueue. |

Indexes: partial `(detail_next_attempt_at) WHERE detail_status IN ('pending','retry')` and partial
`(published_at DESC, id DESC) WHERE detail_status = 'ready'` for the sitemap. **No separate queue
table:** the row *is* the task, which keeps the sitemap predicate a single-table filter.

**Code:**
- `src/lib/job-completeness.ts`: `evaluateJobDescription(fields) → { complete, reasons[] }`
  (pure, deterministic; rules in JOB-DETAIL-ENRICHMENT §3).
- `src/lib/job-eligibility.ts`: `isSeoReady(row)` + exported `SEO_READY_SQL` fragment. The contract
  test asserts TS and SQL agree on a fixture table.
- `Job.descriptionKind?: "full" | "snippet"`, set by Torre/Jooble adapters to `snippet`.
- `scripts/classify-job-details.ts` (`--dry-run` default, `--apply`): classifies legacy rows from
  stored text only (**no network**). Prints counts per status/source/reason and verifies `rowCount`
  after the write (CLAUDE.md rule).

**Deploy order matters:** migration → classification `--apply` → code that reads the state. Reversed,
the gate would read NULL everywhere and drop every JobPosting at once.

**Tests (isolated runner, `test:unit` / `test:integration` + new `test:job-completeness`):** fixtures
for full description, Torre tagline, LinkedIn chrome sample (F4), captcha page, cookie banner,
title-only, truncated "…", duplicated blocks, BuscoTrabajo boilerplate. These are pure functions in the
**`unit`** suite (offline, no DB). TS↔SQL predicate parity and the classification dry-run need Postgres,
so they go in **`integration`** (disposable DB). No test touches production.

### Phase C — Mandatory detail enrichment for new jobs (session after B)

- `saveJobs()` sets `detail_status` at INSERT (listing-complete → evaluate; no `fetchDetail` →
  `unsupported`; else `pending`) and enqueues URL_UPDATED **only** for rows that are ready at insert,
  via `seo_ready_at` in the same transaction as the queue insert.
- `ScrapeWorker.enrichNewJobs` writes the state machine instead of fire-and-forget. `null` →
  `no_detail`, fault → `retry` + backoff, pass → `ready`. It reuses `executeWithResilienceResult`,
  `circuitKeyFor(…,'detail')`, `resolvePolicy`, jitter and `FetchContext`.
- New bounded **drain step** in `run-scrape-tick.ts`: after listings, claim due `pending/retry` rows
  per source with `FOR UPDATE SKIP LOCKED` and cap them with `SourcePolicy.maxRequestsPerAttempt`,
  the tick budget and an open-circuit stop. Only jobs inserted after rollout (the historical backlog is
  Phase E).
- `backfill-indexing-queue.ts` filters with `SEO_READY_SQL` (F8).
- **Queue triage (from F7, needs explicit authorization since it mutates production data):**
  URL_UPDATED rows whose job no longer exists are marked `superseded` (no DELETE). This stops the 76%
  quota waste and makes "new READY job → notified" observable. The full Phase G redesign stays in G.

**Milestone 1 acceptance (from the brief):** new job with a full source description → `ready` →
`seo_ready_at` + one URL_UPDATED. Thin new job → `pending`/`unsupported` → no JobPosting, not in the
sitemap query, no URL_UPDATED. Failed detail → `retry` with backoff → bounded → `failed`. All proven
in the isolated DB, then one real tick observed by log before anything else changes.

Phases D–K are scoped in the companion docs and PROD-IMPROVEMENTS-PLAN. Each gets its own session,
baseline, tests and commit.

### Rollback

Every step is additive. Removing the gate = revert the commit; the columns stay harmless.
Classification writes only the new columns. No DELETE anywhere in B/C.

## 6. Decisions deliberately deferred to their phase

- Shard size (P8 draft says ~5,000; the brief says 20–25k): decided in Phase F by measuring stream
  time and Search Console per-shard reporting. Recommendation: **10,000**, so shards are small enough
  to diagnose and there are few enough to submit by hand if the API fails.
- JobPosting for Workana freelance projects (budget ≠ salary; eligibility of project gigs): Phase D.

## 7. Decisions (approved 2026-09-18)

1. Non-compliant real jobs stay USER_VISIBLE (200, readable body, source link, dashboard) but are
   out of the Google corpus: `noindex,follow`, no JobPosting, no sitemap entry, no URL_UPDATED.
   USER_VISIBLE (`is_active`) and GOOGLE_READY (`seo_ready`) are separate columns and concepts.
2. Indexing queue: clean with explicit state transitions (`superseded`, never DELETE, never an
   UPDATE turned into a DELETE); dry-run first; send order 1 legit deletions → 2 newly ready →
   3 meaningful updates.
3. Lead capture is optional: the modal offers "Continuar a la oferta original"; the source link is
   in the server-rendered HTML.
4. Order: B → C → D, then P5 (Computrabajo detail), then — with separate authorization — the
   historical backfill.

## 8. Implementation record — phases B + C + D (local, 2026-09-18)

### What changed

| Area | Change | Files |
|---|---|---|
| Contract (B) | One evaluator `evaluateGoogleJobReadiness()` → `{ready, reasons[], qualitySignals, location}`; deterministic description rules with reason codes; stored verdict read by all four consumers through `isGoogleReadyNow()` / `seoReadySql()` | `src/lib/google-job-readiness.ts`, `src/lib/job-description-quality.ts`, `src/lib/country-codes.ts` |
| Schema (B) | Additive `-- BEGIN job-seo-v2` block (jobs: detail state, provenance, remote evidence, source `valid_through`, `seo_ready*`, `content_hash`, `content_updated_at`; indexing_queue: `job_id`, `priority`, `content_hash`, `superseded_*`, indexes, conditional unique index) | `src/db/schema.sql` |
| Persistence (B/C) | `refreshGoogleReadiness()` stores the verdict and enqueues URL_UPDATED in the same transaction only on a real transition; supersedes pending updates when a job stops being ready; detail state machine with bounded backoff; SKIP LOCKED claims with a lease | `src/db/job-readiness-repository.ts` |
| New-job pipeline (C) | `saveJobs()` decides the detail state at insert and never enqueues thin rows; in-tick detail slice + bounded end-of-tick drain per market; adapters declare `descriptionKind`/`remoteType`/`applicantCountries`/`validThrough` only when the source states them | `src/db/job-repository.ts`, `src/queue/detail-enrichment.ts`, `src/queue/scrape-worker.ts`, `scripts/run-scrape-tick.ts`, `src/index.ts`, `src/lib/job-posting-jsonld.ts`, `src/sources/*` |
| Indexing API (C) | Priority lanes, idempotent enqueue, pre-send target check (superseded rows use no quota), purge prioritizes deletions Google knew about, hourly reconcile only for Google-ready rows | `src/db/indexing-repository.ts`, `src/db/scheduler-repository.ts`, `scripts/run-indexing-tick.ts`, `scripts/backfill-indexing-queue.ts` |
| JobPosting + page (D) | HTML description from one renderer (`<p>/<ul>/<li>` only) shared by JSON-LD and the visible body; no synthetic `validThrough`, no invented remote country, no `baseSalary`/`identifier`/`skills`/`qualifications`; `noindex,follow` for non-ready; full SSR body with source link; sitemap filtered by the gate with real-or-omitted `<lastmod>` | `src/lib/job-seo.ts`, `src/server.ts`, `src/db/job-repository.ts` |
| Apply path (D) | Optional lead capture; "Continuar a la oferta original" in the modal; honest footer copy | `src/components/ApplyGateModal.tsx`, `src/components/JobDetailPanel.tsx` |
| Tooling | `jobs:classify-readiness` (legacy classification + read-only candidate report), `seo:cleanup-indexing-queue` (dry-run/--apply), `test:job-seo` | `scripts/classify-job-readiness.ts`, `scripts/cleanup-indexing-queue.ts`, `package.json` |

### Expected production effect (read-only estimate, same evaluator, 2026-09-18)

[`seo-baseline/2026-09-18-readiness-estimate.json`](seo-baseline/2026-09-18-readiness-estimate.json):
**15,676 / 66,590 (23.5%) Google-ready**; 50,914 stay user-visible but `noindex,follow`.
Ready by source: LinkedIn 10,548 · Elempleo 2,276 · Magneto 1,632 · Computrabajo 1,217 ·
Remotive 2 · RemoteOK 1 · all others 0. Detail status after classification: complete 21,781 ·
backlog 34,556 · unsupported 8,942 · rejected 1,311. Top reasons: MISSING_DESCRIPTION 37,928 ·
MISSING_LOCATION 11,970 · INVALID_REMOTE_LOCATION 7,058 · DESCRIPTION_TOO_THIN 5,641 ·
DESCRIPTION_SNIPPET 5,428 · DESCRIPTION_NAVIGATION_JUNK 943 · DESCRIPTION_DUPLICATED_BLOCKS 308.
The sitemap drops from 50,000 (truncated) to ≈15.7k complete entries, so truncation disappears as a
consequence and sharding (Phase F) is no longer urgent.

### Migration plan (NOT executed — requires explicit authorization per step)

1. Review the `job-seo-v2` block diff. All `ADD COLUMN` statements use constant defaults, which are
   metadata-only on PG 15. There are 4 `CREATE INDEX` (on ~66k jobs and ~150k queue rows, seconds of
   write lock). The unique queue index is skipped because production has pending duplicates.
2. `scripts/migrate.ts` (idempotent; applies the whole `schema.sql`), run from the main checkout's
   `job-radar-apify` with the worktree's script path (the `.env` pattern already in use).
3. `npm run jobs:classify-readiness` (dry-run) → review → `-- --apply`. Old code is still live and
   ignores the columns.
4. Deploy (fast-forward `main`, Render auto-deploy).
5. `jobs:classify-readiness -- --apply` again. It is idempotent and picks up rows the old code
   inserted between steps 3 and 4.
6. `npm run seo:cleanup-indexing-queue` (dry-run, optionally `-- --http-sample=20`) → review →
   `-- --apply`. The apply also creates the unique index.
7. Verify: `/sitemap-jobs.xml` 200 + valid XML, 5 ready and 5 non-ready sample pages (robots, JSON-LD,
   apply link), Rich Results Test on 3, `/seo drift compare` against the baseline URLs.

### Rollback

Revert the merge commit. The old code ignores every new column (defaults are harmless) and old
queue readers select only `pending` (they skip `superseded`). The unique index is compatible with
the old enqueue paths (they never insert a second pending row for the same URL+type); if needed:
`DROP INDEX uq_indexing_queue_pending_url_type`. No data is deleted anywhere, so there is nothing to
restore; superseded queue rows keep their full history.

### Known limitations / decisions still open

- **Country-only locations** (e.g. Magneto "Colombia", 1,262 rows) are not Google-ready:
  `addressCountry` alone is allowed by Google, but "Colombia" doesn't say where the employee reports
  to work (it may be nationwide or remote). Kept conservative; relaxing it is a one-line rule change
  if approved.
- **Workana** (4,072) is never ready: its `location` is the client's country on freelance projects,
  and its `salary_raw` is a project budget. It stays excluded until a Phase D follow-up decides
  JobPosting eligibility for project gigs.
- **GetOnBoard** sends only `attrs.description` (the API also has `functions`, `desirable`,
  `benefits`), and `remote_local` has no stated geography → P5.
- **Legacy remote rows** have no stored remote evidence → not ready. New WeRemoto/GetOnBoard/
  JSON-LD rows carry it and can become ready.
- **`datePosted`** still falls back to scrape time when a source gives no date (86 rows).
