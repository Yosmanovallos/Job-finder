# Search Console & indexation baseline — 2026-09

The "before" snapshot every later phase is measured against. Two kinds of numbers are kept apart:
**provided** (from the Search Console UI, supplied by the owner in the Phase A brief) and **measured**
(collected in this session by the repo's own read-only tooling). Nothing here is estimated.

Property: `sc-domain:buscotrabajo.co`. Service account permission: `siteOwner` (measured).

## 1. Performance (provided, 28-day windows)

| Window | Clicks | Impressions | Avg. position | CTR |
|---|---:|---:|---:|---:|
| Previous 28 d | 28 | 539 | 20.0 | 5.19% |
| Latest 28 d | 43 | 1,670 | 11.4 | 2.57% |

The CTR drop is read together with a 3.1× jump in impressions and a 8.6-position ranking gain. It is
more exposure at positions that click less, not a regression. About 137 pages had ≥ 1 impression.

Search appearance (provided): **JOB_LISTING** 16 clicks / 154 impr. / CTR 10.39% / pos 8.5 ·
**JOB_DETAILS** 11 / 483 / 2.28% / 3.2. Both must be tracked separately after Phase D. Some drop in
JOB_DETAILS impressions from thin pages losing JobPosting is **expected**, not a regression.

High-impression / zero-click pages (provided, Phase I input): `/empresas/elempleo` 123 impr. pos 9.9 ·
`/empresas/brenntag` 46 / 8.0 · `/dashboard` 29 / 7.7 · `/empleos/neiva` 30 / 19.4.

## 2. Page indexing (provided, previous snapshot)

| Status | URLs |
|---|---:|
| Discovered – currently not indexed | 43,592 |
| Crawled – currently not indexed | 9,632 |
| Soft 404 | 2,498 |
| Blocked by robots.txt | 341 |
| Not found (404) | 285 |
| Duplicate, Google chose different canonical | 7 |
| Page with redirect | 2 |
| **Indexed** | **≈ 140** |

## 3. Sitemaps (measured 2026-09-18, `seo:check-search-console`, dry-run)

| Sitemap | lastSubmitted | lastDownloaded | submitted | indexed* |
|---|---|---|---:|---:|
| `sitemap-pages.xml` | 2026-08-03 | 2026-09-10 | 14 | 0 |
| `sitemap-categories.xml` | 2026-08-03 | 2026-09-13 | 91 | 0 |
| `sitemap.xml` (index) | 2026-08-01 | 2026-09-14 | **105** | 0 |
| `sitemap-jobs.xml` | not registered | — | — | — |

\* `indexed=0` from the Sitemaps API is not trusted as evidence (it has read 0 for months while pages
were indexed). It is corroborated with URL Inspection samples and Performance instead.

**Measured anomaly:** the index's 105 = 14 + 91, so it currently counts **zero** job URLs. On
2026-08-11 it reported 36,089 (SEO-PLAN.md §11). The live `sitemap-jobs.xml` fetched once with a
Googlebot UA today returns HTTP 200, `application/xml`, 4.9 s, 10.4 MB, valid, **exactly 50,000
`<loc>`** (66,590 canonical jobs exist → 16,590 never listed). The static `sitemap-pages.xml` has
18 URLs in the repo vs 14 counted.

## 4. Corpus and pipeline (measured, production, read-only)

Full tables: [`seo-baseline/2026-09-18-inventory.json`](seo-baseline/2026-09-18-inventory.json);
queries: [`seo-baseline/inventory-queries.mjs`](seo-baseline/inventory-queries.mjs).

| Metric | Value |
|---|---:|
| Active canonical jobs | 66,590 (CO 49,842 · VE 5,533 · remote/NULL 11,215) |
| Emitting JobPosting today | 66,590 (100%; the gate excludes nothing) |
| With any description / ≥ 300 chars | 28,556 / 22,001 |
| Without description | 38,034 |
| With requirements / employment type / visible salary | 11,984 / 27,537 / 9,056 |
| Published > 30 d ago (emitting a past `validThrough` while live) | 14,500 |
| Bare "Remoto" location (→ TELECOMMUTE + fabricated Colombia eligibility) | 6,918 |
| New rows last 24 h / with description | 1,253 / 485 |

Indexing API queue ([`2026-09-18-inventory-queue-samples.json`](seo-baseline/2026-09-18-inventory-queue-samples.json)):

| Metric | Value |
|---|---:|
| Pending URL_UPDATED (oldest) | 98,529 (2026-07-30) |
| Pending URL_DELETED (oldest) | 41,921 (2026-08-24) |
| Sent last 24 h | 200 (quota exhausted), 0 failed |
| …of which the target job still exists | **48 / 200** |
| URLs carrying both UPDATED and DELETED | 39,298 |
| Drain time at 200/day | ≈ 700 days for the full backlog |

## 5. Live page samples (measured 2026-09-18)

| Job | Source | Finding |
|---|---|---|
| `f313da08…` | Glassdoor | 200, JobPosting whose description is 100% BuscoTrabajo template. |
| `c53b3c52…` | LinkedIn | 200, `validThrough` 2026-09-15 (past). Description/qualifications are Chilean hospital navigation + duplicated blocks. |
| `e645a519…` | Torre | 200, New Zealand role as TELECOMMUTE with fabricated `applicantLocationRequirements: Colombia`. 1-sentence description. |

None of the three raw HTML bodies contains an application link.

## 6. Follow-up protocol

After each deploying phase (D, F, G, H), re-record at +7 d, +14 d and +28 d:

- **Search Console Pages:** indexed, Discovered/Crawled not indexed, Soft 404.
- **Performance:** clicks, impressions, CTR and position, including JOB_LISTING and JOB_DETAILS.
- **Pages with ≥ 1 impression.**
- **Per-shard submitted counts.**
- **URL Inspection** on a fixed 10-URL sample (5 ready jobs, 2 non-ready, 3 categories).
- **Rich Results Test** on 3 ready jobs.
- **`seo:inventory` output.**

No indexed-URL target is promised: Google decides what it indexes.
