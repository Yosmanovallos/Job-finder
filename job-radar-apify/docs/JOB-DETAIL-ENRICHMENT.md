# Job Detail Enrichment — contract, state machine, source coverage

**Status:** B + C implemented locally (2026-09-18, `feat/job-seo-v2`; see JOB-SEO-ARCHITECTURE-V2 §8).
E (historical backfill) **not started — requires explicit authorization**. Parent: [JOB-SEO-ARCHITECTURE-V2.md](JOB-SEO-ARCHITECTURE-V2.md).

## 1. Invariant

> A job enters the public SEO corpus (JobPosting, sitemap shard, Indexing API) only after a real,
> source-derived description has been obtained **and** has passed the shared gate `evaluateGoogleJobReadiness()` (which applies `assessDescription()`).
> Nothing is inferred, generated or completed by AI. Missing is `NULL`, never a guess.

## 2. State machine (`jobs.detail_status`)

| State | Meaning | Next |
|---|---|---|
| `NULL` | Legacy row, not yet classified (only before the Phase B classification run) | → any, via `scripts/classify-job-readiness.ts` |
| `pending` | New, listing incomplete, adapter has `fetchDetail`, not tried yet | → `complete` / `retry` / `no_detail` / `rejected` |
| `retry` | Transient fault (timeout, 5xx, 429, 403, open circuit). `detail_next_attempt_at` set | → same as `pending`; → `failed` at max attempts |
| `no_detail` | Page fetched, yielded nothing usable (`fetchDetail → null`). Circuit-neutral (P4) | re-tried at most twice more with long backoff (listings sometimes lag) → `failed` |
| `rejected` | Content obtained but failed the completeness contract (reasons recorded) | terminal until content changes |
| `unsupported` | No complete listing text and no `fetchDetail` for this source | re-evaluated only when an adapter gains detail support |
| `failed` | Attempts exhausted | terminal; Phase E may reset with a new budget |
| `complete` | Validated complete description stored | readiness then decided by the shared gate |
| `backlog` | Legacy row (pre-V2) with no description from a detail-capable source | **never claimed by the tick**; only the Phase E backfill |

As implemented: `no_detail` is recorded as `retry` (`detail_last_error = NO_DETAIL`) until the 2nd
empty answer, then terminal `no_detail`. An `unsupported` row inserted by an adapter that DOES
implement `fetchDetail` is promoted to `pending` by the in-tick claim (the adapter is the runtime
evidence). Google readiness is not a detail state: it lives in `seo_ready` (evaluator verdict).

Backoff (implemented, pinned by tests/validate-job-seo-v2.ts): 30 min → 2 h → 8 h → 24 h, `max_attempts = 4`. A 429 with
`Retry-After` uses `max(backoff, Retry-After)`, capped by `SourcePolicy.maxRetryAfterMs` for in-tick
waits and **stored** for anything longer. The job is never hammered.

Transitions are single `UPDATE … WHERE id = $1 AND detail_status IN (…)` statements (compare-and-set),
so a crashed tick leaves a row in `pending/retry` and the next tick simply picks it up. The drain
claims rows with `FOR UPDATE SKIP LOCKED`, so two ticks (CO and VE run concurrently) never double-fetch.

## 3. Completeness contract — `assessDescription()` (src/lib/job-description-quality.ts)

Deterministic, pure, returns `{ ok, reasons[], signals }`; reason codes as implemented: `MISSING_DESCRIPTION`, `DESCRIPTION_SNIPPET`, `DESCRIPTION_IS_METADATA`, `DESCRIPTION_TOO_THIN`, `DESCRIPTION_ERROR_PAGE`, `DESCRIPTION_NAVIGATION_JUNK`, `DESCRIPTION_DUPLICATED_BLOCKS`, `DESCRIPTION_TRUNCATED`, `DESCRIPTION_DUPLICATED_TEMPLATE`, `DESCRIPTION_APPLICATION_ONLY`. It deliberately has **no
"≥ 300 words" rule**: 150 specific words can pass and 900 words of navigation fail. Checks, in order:

| # | Rule | Rejects | Evidence it is needed |
|---|---|---|---|
| 1 | Non-empty after normalization | `empty` | 38,034 rows |
| 2 | Adapter declared `descriptionKind = "snippet"` | `snippet_source` | Torre `tagline` (p50 94 chars), Jooble `snippet` |
| 3 | Not equal / near-equal to title, company or location | `metadata_only` | 3 rows = title |
| 4 | Minimum information floor: ≥ 2 distinct sentences/lines **or** ≥ 3 list items, and ≥ 120 letters | `too_short` | 5,204 rows < 100 chars. A floor, not a quality score |
| 5 | Error / challenge / interstitial text (captcha, "access denied", "enable JavaScript", Cloudflare, cookie-consent, login wall, 404 copy) | `error_page` | 42 rows |
| 6 | Page-chrome density: phone numbers, street addresses, menu-label lines ("Acceso", "Inicio", "Transparencia Activa"), ratio of ≤ 3-word lines | `page_chrome` | LinkedIn `c53b3c52…` (Chilean hospital navigation) |
| 7 | Internal duplication: the same ≥ 2-line block repeated | `duplicated_block` | Same sample, requirements repeated verbatim |
| 8 | Truncation: ends with `…`/`...`/"Ver más"/"Leer más" or mid-word cut | `truncated` | Listing snippets |
| 9 | BuscoTrabajo boilerplate ("Vacante agregada de", "Aplica directamente en…") | `own_boilerplate` | Guards against the template ever being stored as a description |

Reason codes are stored in `detail_last_error` (for `rejected`) and counted by every script, so
"why isn't this job ready?" is always one query away. Thresholds live in one exported constant and
are calibrated in Phase B against **sampled real rows per source**, not only against counts (the
generic-word lesson from role matching: sample the matches, don't trust the total).

## 4. Safe storage and rendering (one content model, two outputs)

```
source HTML / JSON-LD / API text   (untrusted)
  → extractStructuredFromHtml()     already strips ALL tags → plain text lines + list items
  → assessDescription() via evaluateGoogleJobReadiness()
  → stored: description (text, \n-separated), requirements (JSON string[])
  → renderJobDescriptionHtml()      (new, Phase D): escapeHtml every string, emit only <p>, <ul>, <li>
       ├─ SSR visible body
       └─ JobPosting.description    ← byte-identical source, so no structured-data mismatch
```

No source HTML is ever stored or echoed. The output tag allow-list is fixed in code (`p`, `ul`, `li`),
so there is no sanitizer to configure or bypass. F12's mislabeling (every `<li>` → "Requisitos") is
fixed in the server-rendered body and JSON-LD (lists sit inside a neutral "Descripción de la vacante" section). The hydrated React panel still titles them "Requisitos" — same text, different label; relabeling the client is a P10/UX follow-up.

## 5. Source coverage for detail (Phase A snapshot)

| Source | Detail capability | 7-day detail attempts (valid / received) | Classification for B/C |
|---|---|---|---|
| Elempleo | ✅ JSON-LD direct | 92 / 100 | supported |
| Magneto | ✅ JSON-LD direct | 91 / 184 | supported |
| LinkedIn / LinkedIn-VE | ✅ JSON-LD direct | 414 / 1,118 · 162 / 234 | supported, **chrome-risk** (F4) |
| Computrabajo / -VE | ✅ via translate.goog | 19 / 409 · 17 / 51 | supported but **broken** (P5 priority 1). New jobs will sit in `retry`/`no_detail` until P5 fixes the parser |
| WeRemoto, RemoteOK, Remotive, GetOnBoard, Workana | full text in listing | n/a | listing-complete → evaluated at insert |
| Torre | tagline only, no detail | — | `unsupported` until an official per-opportunity endpoint is researched (`source-researcher` → `docs/source-catalog/torre.md`) |
| Jooble | snippet only | — | `unsupported` (and rejected by validation today) |
| Glassdoor | detail implemented, unwired (403 risk) | — | `unsupported`. Wiring it requires evidence it won't degrade the listing |
| Indeed | none | — | `unsupported` |

"received" includes the per-tick cap (`filtered`), so valid/received understates per-request success.

## 6. Historical backfill (Phase E — design only; do not run without authorization)

`scripts/backfill-job-details.ts`, npm `jobs:backfill-details`. Flags: `--dry-run` (default),
`--apply`, `--source=`, `--country=CO|VE`, `--limit=` (default 25, hard max 500), `--max-attempts=`
(default 2), `--job-id=`, `--newer-than=`/`--older-than=`, `--concurrency=` (default 1, max 2).

- Candidates: canonical active rows with `detail_status IN (NULL,'pending','retry','no_detail','failed')`
  and a source whose adapter has `fetchDetail`. Everything else is reported as `unsupported`, never
  fetched through a generic browser.
- Priority: recently published → URLs with Search Console impressions (optional CSV input; the script
  works without it) → sources with healthy detail (Elempleo, Magneto, LinkedIn) → the rest. Random
  order is never used.
- Same stack as the tick: `resolvePolicy(source,'detail')`, `circuitKeyFor`,
  `executeWithResilienceResult`, jitter 1–3 s, `FetchContext` deadline. **Stop that source** on an
  open circuit, 403, 429 or 3 consecutive `no_detail`, and continue with other sources.
- Output: examined · attempted · success · no_detail · retry scheduled · blocked · unsupported ·
  failed · became SEO-ready. Each is read back from real `rowCount`s after the write.
- Rollout: dry-run → 10 jobs of one healthy source (Elempleo) → inspect DB row, rendered HTML,
  JobPosting, no duplicates, request count → 50 → 200 → per-source ramps. Never tens of thousands in
  one go.

## 7. Observability

Every transition increments `source_attempts` (stage `detail`) counters as today, plus a read-only
`seo:inventory` script (productized from the Phase A queries in `seo-baseline/`) that prints the
per-status/per-source/per-reason table. It is the before/after instrument for every later phase.
