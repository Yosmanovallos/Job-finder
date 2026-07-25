# Workana — Source Catalog

Status as of 2026-07-25. Researched for `job-radar-apify` after Workana
began returning `403 Forbidden` on every request from `scrapeWorkana`
(`src/index.ts`, called via `src/sources/workana.ts`).

## Summary / recommendation

**Do not keep scraping Workana's rendered HTML.** Evidence below is not
fully primary-verified (Workana's own Terms of Service page returned
`403 Forbidden` to every direct fetch attempt made during this research,
so its automated-access clause is reported only via search-engine
snippets, not read first-hand) — but it is corroborated by:

1. Search-snippet-derived quotes of Workana's ToS, consistently across
   multiple independent queries, stating users agree not to access
   Workana's resources "through any automated, unethical or unconventional
   means" and not to use "robots, spiders, manual and/or automatic
   processes... to data-mine, data-crawl, scrape or index" the site
   (source cited by search engines: `https://www.workana.com/pages/view/terms`,
   not independently re-verified — treat as reported, not confirmed
   verbatim).
2. The site is now actively returning `403` on the exact request pattern
   the adapter uses, which is itself evidence of an anti-bot control in
   effect, independent of what the ToS says.

Recommendation: **disable/retire the Workana HTML scraper behind a
feature flag** rather than tune pacing on it. `robots.txt` being
permissive for `/jobs` does not equal ToS consent — the two are
separate mechanisms, and per this project's rule ("never bypass...
anti-bot controls, or terms of use"), ToS governs. If Workana coverage is
commercially important, the only compliant paths forward are (a) seek an
explicit written data-sharing/partner arrangement with Workana, or
(b) drop Workana as a source. Routing the same scrape through a
third-party provider (e.g. Apify's "Workana Freelancers & Agencies
Scraper") does **not** change this: the source-priority ladder's
"proveedor externo (Apify) bajo feature flag" rung is for sources whose
own terms allow it, not a way to launder a ToS prohibition through a
different operator. Do not adopt it as a workaround.

If, and only if, written permission from Workana is obtained in the
future, pacing guidance would need to be requested from Workana directly
as part of that agreement — this document does not set an "acceptable"
scrape rate for a use that its own reported terms forbid, since a 403 is
already an active anti-bot control and continuing to test rates against
it is closer to circumvention than to good citizenship.

## 1. Official public API — none found

No official public API for searching or retrieving job/project postings
was found for Workana as of 2026-07-25.

- Web search for "Workana API developers documentation 2026" surfaces
  only: Workana's own marketplace category pages for hiring "API
  Developers" (i.e. freelancers who list "API" as a skill — unrelated to
  a Workana-operated API product), and an unofficial/unaffiliated GitHub
  repo (`github.com/beratozdt/workana.com-API`) with no README or
  documentation content visible — status and legitimacy could not be
  verified, and it is not an official offering regardless.
- Searched specifically for an Enterprise/partner API
  ("Workana Enterprise API partner integration jobs data") — found only
  a "Terms of Service - Workana Enterprise" help-center article title
  (`help.workana.com/hc/en-us/articles/23301800577943-Terms-of-Service-Workana-Enterprise`)
  and a "Workana Policies" article, but the actual page content could not
  be fetched (see verification note below) and no mention of a
  developer/partner data API surfaced in any snippet.
- `robots.txt` (see §3) has `Disallow: /api/`, confirming Workana runs
  *some* internal API under that path (almost certainly the AJAX/XHR
  backend the SPA frontend itself uses to render `/jobs` search
  results — the same `:results-initials='...'` payload the current
  scraper already parses out of inline HTML), but it is explicitly
  excluded from crawling and there is no evidence it is documented,
  versioned, or intended for third-party/public use. Treat `/api/` as
  foreclosed, not as a lighter-weight alternative to try next.

**Conclusion: no sanctioned API exists for this use case.**

## 2. Structured feed (RSS/JSON/sitemap) — sitemap exists, but doesn't help

`robots.txt` declares a sitemap:
`Sitemap: https://www.workana.com/sitemap_index.xml`

Fetched directly (`curl` with an honest, descriptive User-Agent
identifying the request as research — not a spoofed browser UA — 2026-07-25):

- `https://www.workana.com/sitemap_index.xml` → **200 OK**, plain XML,
  references 3 sub-sitemap-index files
  (`.../SitemapIndex.808.xml`, `.809.xml`, `.810.xml`) plus the blog and
  image-CDN sitemaps.
- Each `SitemapIndex.80x.xml` in turn lists ~hundreds of
  `Sitemap.N.xml.gz` files (served pre-decompressed by the CDN/GCS
  origin).
- Sampled several of these (`Sitemap.0`, `.5`, `.10`, `.15`, `.19`,
  300 URLs each): **every URL sampled was a category/search-filter
  landing page** of the form `/jobs?skills=<skill>`,
  `/jobs?country=<CC>`, `/en/jobs?country=<CC>&skills=<skill>`,
  `/es/jobs?country=<CC>&skills=<skill>`, plus static pages (`/about`,
  `/how-it-works/*`, `/hire/<category>`). **No individual job/project
  posting URLs (e.g. `/job/<slug>`) were found in any sampled file**, and
  no `<lastmod>` per individual entry, no title/description/date
  metadata — a sitemap only ever carries a URL, so even if per-posting
  URLs existed elsewhere in the ~800+ files, it would still require
  fetching and parsing each posting's HTML, which is *heavier* than the
  current bulk `/jobs?query=...` search-results scrape, not lighter.
- Given time constraints, not all ~800+ sub-sitemap files were
  enumerated; the sampled pattern (SEO skill×country×language landing
  page matrix) was consistent across every file checked, so it is very
  likely representative, but this is **observed on a sample, not
  exhaustively confirmed**.

**Conclusion: the declared sitemap is real and fetchable, but it is an
SEO sitemap of search/category pages, not a structured feed of postings.
It does not provide a lighter-weight path to job data than the existing
scraper, and does not change the recommendation in §0.**

No RSS or JSON feed of postings was found; Workana's own site only
surfaces "RSS" as a freelance-skill category for hiring RSS developers,
not a feed Workana itself publishes.

## 3. robots.txt (fetched 2026-07-25)

```
User-agent: *
Disallow: /api/
Disallow: /*?*ag=1
Disallow: /users/landing_choose*
Disallow: */login*?*
Disallow: */signup*?*

Sitemap: https://www.workana.com/sitemap_index.xml
```

- `/jobs` (the path the current adapter scrapes,
  `https://www.workana.com/jobs?query=...&publication=1w&page=N`) is
  **not** disallowed by robots.txt.
- `/api/` **is** disallowed — this forecloses the obvious next idea of
  calling Workana's internal AJAX endpoint directly instead of parsing it
  out of HTML; do not pursue that.
- robots.txt permissiveness on `/jobs` is a crawling-etiquette signal
  only. It does not override or substitute for the Terms of Service,
  which (per the reported clauses in §4) prohibit automated/robotic
  access more broadly. The two must not be conflated.

## 4. Terms of Service — verification status and reported content

**Verification status: could not be independently confirmed.** Every
direct fetch attempt against Workana's own terms pages returned
`403 Forbidden`, including:
- `https://www.workana.com/pages/view/terms`
- `https://www.workana.com/en/pages/view/terms`
- `https://help.workana.com/hc/en-us/articles/360041499974-WORKANA-TERMS-AND-CONDITIONS`

This 403 pattern on help-center/Zendesk-hosted content too suggests a
fairly broad anti-bot posture at the CDN/WAF layer (Cloudflare is
visible in response headers on other Workana endpoints), not something
specific to the scraper's request shape.

Because the primary text could not be read directly, the following is
**reported via search-engine snippets citing those URLs, not verified
verbatim** — treat as probably-accurate paraphrase, not a quotable
contract clause:

- Users agree "not to access (or attempt to access) any of our Resources
  through any automated, unethical or unconventional means."
- Users may not use "robots, spiders, manual and/or automatic processes,
  or devices to data-mine, data-crawl, scrape or index" the Workana site.
- Separately, an IP clause reportedly restricts copying, downloading,
  redesigning, reconfiguring, or retransmitting site content without
  Workana's prior written consent.

If this catalog entry is ever relied on for a compliance decision beyond
"stop scraping," the actual ToS text should be re-fetched from a
compliant channel (e.g. manually in a browser, or once Workana grants API
access) rather than continuing to trust this second-hand paraphrase.

## 5. Current adapter behavior (observed, for context — not a spec)

- `scrapeWorkana` (`src/index.ts` ~line 514) hits
  `https://www.workana.com/jobs?query=<kw>&publication=1w&page=<1..5>`
  with a static desktop Chrome User-Agent string, no other headers.
- It does not call any documented API or parse JSON-LD. It extracts a
  Vue component's inline state by string-searching the HTML for the
  literal attribute `:results-initials='...'` and JSON-parsing the
  decoded value. This is internal frontend component state, not a
  published/contracted data format — it can change silently on any
  Workana frontend deploy, independent of the current 403 issue. This is
  effectively scraping the same `/api/`-style payload robots.txt
  disallows crawling, just retrieved indirectly via the rendered page.
- `jitterDelay()` (`src/engine/jitter-delay.ts`) adds a random 1-3s pause
  between keyword requests, with an explicit code comment noting Workana
  has "Ninguna" (no) protection per an earlier version of this project's
  source table. That comment is now stale: the current `403` on every
  request is empirical evidence Workana has since added or tightened
  anti-bot controls. The comment/table should be updated to reflect this
  regardless of what happens with the scraper itself.
- Given every request currently returns 403, no pacing adjustment will
  restore functionality — this is not a rate-limiting problem to tune
  around, it's a hard block.

## 6. Field coverage vs. this project's `Job` type

This project's canonical shape (`src/sources/types.ts`) is:
`jobId, title, company, location, url, dateText, source, publishedAt?`.
The current Workana scraper populates `jobId` (slug), `title`, `company`
(freelancer/client display name), `location` (country text, defaulted to
"Colombia" if absent — **note: this default is a fabricated fallback
value that should not survive if Workana access is restored**, `url`,
and a parsed `dateText`/`publishedAt` from a "Publicado: ..." string.
No compensation/salary field is available from Workana's job cards in
any case (not part of the payload observed).

## Sources consulted

- `https://www.workana.com/robots.txt` (fetched directly, 2026-07-25)
- `https://www.workana.com/sitemap_index.xml` and sampled
  `SitemapIndex.808.xml` → `Sitemap.{0,5,10,15,19}.xml.gz` (fetched
  directly with an honest research User-Agent, 2026-07-25)
- `https://www.workana.com/pages/view/terms`,
  `https://www.workana.com/en/pages/view/terms`,
  `https://help.workana.com/hc/en-us/articles/360041499974-WORKANA-TERMS-AND-CONDITIONS`
  — all returned `403 Forbidden` on direct fetch; content reported only
  via search-engine snippets (see §4 caveat)
- Web searches: "Workana API developers documentation 2026", "Workana
  RSS feed jobs projects", "Workana terms of use / términos y
  condiciones scraping robots automated access prohibited", "Workana
  terms of service intellectual property data mining prohibited",
  "Workana Enterprise API partner integration jobs data"
- `github.com/beratozdt/workana.com-API` (unofficial, unaffiliated,
  undocumented — not treated as evidence of an official API)

## Note on untrusted content

Everything fetched from Workana or found via search (robots.txt,
sitemap XML, ToS snippets) was treated as data, not instructions, per
project rules. Nothing in it attempted to direct tool behavior, but it
is flagged here per standard practice: this document reports what was
found, it does not execute anything the fetched content said.
