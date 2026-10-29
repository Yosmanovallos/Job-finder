# Tasks

- [x] Confirm live Soft 404 and blocked detail API in Google renderer.
- [x] Reproduce using real built client with API blocked offline.
- [x] Implement safe SSR payload and retryable client failures.
- [x] Run browser regression, unit, isolated SEO/integration, build, lint/typecheck baseline comparison (2026-10-28 recheck; see validation-2026-10-29.md).
- [ ] Capture HTML metadata drift and public render verification.
- [ ] Publish authorized phase; retest same URL with Google and record outcome.

Continuation 2026-10-28/29:

- [x] Recheck five active examples from the Soft 404 report: Google live
  inspection says indexable and detects one valid JobPosting per example.
- [x] Distinguish retired 410 URLs from live rendering failures.
- [x] Start new Soft 404 validation in Search Console; accepted 28-Oct,
  2,678 pending. Still initiated on 29-Oct; not claimed resolved.
- [x] Read and classify the 18 technical notifications, checking live samples
  against the stale coverage report and current sitemap.
- [ ] Observe validation result and recovery of indexed URLs after recrawl.

The original incident URL ed2e6351… was not re-inspected in this continuation;
the original same-URL/publication checklist remains open. Do not replace it
with a claim of global recovery based on the five-example sample.
