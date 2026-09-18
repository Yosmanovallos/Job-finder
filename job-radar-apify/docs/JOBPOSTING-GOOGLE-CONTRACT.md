# JobPosting ↔ Google contract — property-by-property verdict

**Authority:** Google Search Central, "Job posting (JobPosting) structured data", page last updated
**2026-09-08**, re-read 2026-09-18. Where Google and this repo disagree, Google wins. Where Google
allows something but our data cannot back it truthfully, we omit it (AGENTS.md #5).
Implementation owner: **Phase D**. Current emitter: `buildJobPosting()` in `src/lib/job-seo.ts:267`.

## 1. Eligibility (emit JobPosting at all?)

Emit exactly one JobPosting **only** when all hold:

1. Single-job page, canonical, active. Today ✓: only `/empleos/:id` emits it.
2. `isSeoReady(row)`: `detail_status = 'ready'` (validated source description, JOB-DETAIL-ENRICHMENT §3).
3. Required fields truthfully available (§2). If one is missing, emit nothing (no partial JobPosting).
4. There is a way to apply: a working source URL **reachable by the visitor**. Google: "We don't
   allow job postings that don't have a way to apply". See §4 and open decision F11.
5. The description is readable without login. Today ✓.

Otherwise the page still serves 200 with visible content, but no JobPosting and (proposed) `noindex,follow`.

## 2. Properties

| Property | Google | Today | Verdict (Phase D) |
|---|---|---|---|
| `title` | Required. Job title only: no company, location, salary, dates, codes | Source title ✓ | Keep the source title verbatim. The HTML `<title>` may add context. |
| `description` | Required. **Complete** representation, **HTML** (`<p>`, `<ul>`, `<li>`, `<br>`) | Plain-text BuscoTrabajo template + source text (F2) | Output of `renderJobDescriptionHtml()` from validated source fields only. No template sentences, no company counts, no "Vacante agregada de…". Byte-identical to the visible body. |
| `datePosted` | Required | `published_at`, falls back to scrape time | Keep. Scrape-time fallback affects 86 rows; tracked, not fixed in D. |
| `hiringOrganization` | Required | company string | Keep a real name. For "Confidencial": emit `name: "Confidencial"` only if the source itself said confidential (truthful value per the brief), else not ready. |
| `jobLocation` | Required for non-remote. `addressCountry` required | Whole location string as `addressLocality` | Parse only what the source stated: locality/region when separable; `addressCountry` from `country`. Never infer an address. Remove "Remoto -"/"Híbrido -" prefixes from locality. |
| `jobLocationType` | `TELECOMMUTE` **only** if 100% remote | Any bare "Remoto" location, incl. Torre rows with no location (F6) | Emit only when the source explicitly marks the job fully remote (JSON-LD `TELECOMMUTE`, API `remote: true`). "No location" is not remote. Hybrid is never TELECOMMUTE. |
| `applicantLocationRequirements` | For TELECOMMUTE: **at least one eligible country is required** (or `jobLocation` country) | Defaults to Colombia (fabricated, F6) | Only countries the source names. **Remote job with no source-stated country and no `jobLocation` → not eligible for JobPosting.** |
| `employmentType` | Recommended; fixed enum | Reverse map of the Spanish label ✓ | Keep; only source-stated values. Workana "Proyecto"/"Por hora" have no mapping → omitted ✓. Never inferred from the title. |
| `validThrough` | Required **if** the job has an expiration; "if you do not know when the job will expire, do not include this property" | `published_at + 30 d`: false for 14,500 live pages (F5) | **Omit** unless a source supplies a real expiration (no parser reads one today; adding one is a Phase D/E extraction item). Expiry is signaled by 410 + URL_DELETED instead. |
| `baseSalary` | Recommended; "as provided by the employer… **Only employers can provide baseSalary**" | Not emitted ✓ | **Do not emit.** BuscoTrabajo is a third party. Keep the salary visible when the source published it. Workana budgets are shown as "Presupuesto", not salary. |
| `directApply` | Only if a short on-site application exists | Not emitted ✓ | Keep omitted: we send users to the source. |
| `identifier` | Recommended | `{name: source, value: our uuid}` | `value` should be the **source's** job id when known (it is the employer/source identifier); omit otherwise. |
| `skills`, `qualifications`, `responsibilities`, `educationRequirements`, `experienceRequirements` | schema.org / beta | `skills` = extracted tech names; `qualifications` = every `<li>` (F12) | Emit only from source-labeled sections, and only if the same text is visible. Unlabeled list items stay inside `description`. |

## 3. Visible-page parity (rule E)

Everything in JSON-LD is rendered visibly from the same object: title (H1), company, location,
remote/hybrid label, publication date, full description HTML, labeled sections, employment type,
salary (visible only), source attribution, application link. A test asserts that each emitted JSON-LD
string appears in the SSR body.

## 4. Application path (rule N)

- Raw SSR HTML must contain the source link (today it exists only after hydration, F11).
- Anonymous visitors currently hit a login-only modal before the source link. Google does not forbid a
  login to **apply**, but "a way to apply" must exist for the visitor. **User decision required**: make
  the modal skippable ("Continuar a {source}") or keep it. Recommendation: skippable.
- Link health: the scraper's `last_seen_at` is the existing liveness signal; dead source links are
  covered by purge → 410.

## 5. HTML `<title>` and meta description (Phase I, informational here)

`<title>`: `{title} en {city} – {company} | BuscoTrabajo`, trimmed to about 60 chars with the job
title never cut. Meta description: title, company, location, plus the first meaningful source sentence
and employment type when real. That replaces today's identical "Vacante agregada de X en BuscoTrabajo…"
boilerplate on 66k pages.

## 6. Expiration (rule M): preserved

`purgeOldJobs()` → URL_DELETED → `wasJobPurged()` 410 tombstone stays as is. Phase G makes the queue
coalesce UPDATED/DELETED per URL (F7: 39,298 URLs have both today).

## 7. Test matrix (Phase D)

Full source description → one JobPosting, HTML description, parity. Thin → no JobPosting. 100% remote
with a source country → TELECOMMUTE + that country. Remote without a country → no JobPosting. Hybrid →
jobLocation, no TELECOMMUTE. Salary known → visible, **not** in JSON-LD. Malicious HTML in the source →
escaped, tag allow-list only. Expired → 410. No `validThrough` without a source date. Title unchanged
from the source.
