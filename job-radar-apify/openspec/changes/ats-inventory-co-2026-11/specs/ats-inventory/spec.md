# ATS board inventory — Colombia

## Inventory

- **INV-001** The system MUST keep an inventory of ATS board references (`ats_type`, normalized `ats_ref`) with their provenance, independent of job-board company names.
- **INV-002** Inventory sources MUST be free and permitted: Common Crawl, ATS links found in stored postings, site-probe evidence and ATS sitemaps allowed by robots.txt. Paid search APIs MUST NOT be used.
- **INV-003** A source that fails or times out MUST be reported as "no data", never as zero boards.
- **INV-004** Text from postings MUST be treated as untrusted: only references that match a strict per-ATS pattern are stored, and no foreign domain is followed.
- **INV-005** Inventory writes MUST be idempotent and insert-only (an existing row may only gain a new provenance); manual runs MUST default to dry run.
- **INV-006** Every source MUST go through one normalizer per ATS, and references MUST be unique case-insensitively, so the same board from two sources is one row. A board no connector can read MUST be stored as `unsupported_ats`; one already in `employer_sources` as `owned`.

Scenario: running the inventory twice with the same input produces the same rows and no updates to existing evidence.

## Automatic enablement

- **INV-010** A board MUST be enabled without human review only when every condition holds: the ATS declares the employer name; the listing was complete (HTTP 200, valid shape, all pages); at least one posting is explicitly in Colombia or `Internacional`; the name is not a known agency; and its company key is at least 4 characters and not generic.
- **INV-011** The employer name MUST come from the ATS, not from a job board.
- **INV-012** A board already owned by another employer, a company key already linked to another board of the same ATS type, or an ATS that does not declare a name MUST go to `ambiguous` and MUST NOT be enabled.
- **INV-013** Each run MUST enable at most `--max-enable` boards and stop at its deadline.
- **INV-014** Every inventory row MUST end in a classified state with evidence: `enabled`, `no_colombia`, `agency`, `ambiguous`, `blocked`, `error`, `owned` or `unsupported_ats`. A blocked or failed probe MUST NOT be classified as `no_colombia`.

Scenario: an ATS board declaring "Acme Colombia SAS" with 3 Bogotá postings and no conflicts is enabled; the same board with name "Adecco" is classified `agency`.

## No duplicates and official priority

- **INV-020** A board reference MUST appear at most once in the inventory and in `employer_sources`.
- **INV-021** Two official postings of the same employer with the same title key and location key MUST be shown once. The winner is from the board that declares a publication date, then the oldest board.
- **INV-022** An official posting MUST replace its job-board copies on every public read, using the existing supersede rules (ADR 0006 §10.6 and §12).
- **INV-023** New aliases MUST come only from exact company-key equality with the ATS-declared name, or from a copy that links to the same board. Fuzzy matching MUST NOT be used. An alias owned by another employer MUST go to review.
- **INV-024** A read-only duplicate audit MUST report visible groups with the same company, title and location in more than one row. The exit target is zero.
- **INV-025** Discovery and tick budgets MUST serve ATS boards before name-based job-board discovery.

Scenario: a Workday board and a Phenom front of the same employer list "Analista de Datos – Bogotá"; the dashboard shows one posting, and the LinkedIn copy is hidden.

## International remote

- **INV-030** A posting MUST be labelled `Internacional` only when the ATS explicitly declares remote work with a regional or global scope (LATAM, Latin America, Americas, South America, Anywhere, Worldwide, Global) and no structured country or segment restricts it to another country.
- **INV-031** An `Internacional` posting MUST NOT receive a Colombian city, `country = 'CO'` or a remote flag the ATS did not declare.
- **INV-032** "Remote – US", "Remote, Brazil", "LATAM except Colombia" and similar MUST NOT be labelled `Internacional`.

## Tick and cost

- **INV-040** Enabled boards with eligible postings MUST be read at least every 6 hours; boards with no eligible postings in their last 3 reads at least every 7 days; failing boards with capped exponential backoff.
- **INV-041** The change MUST NOT add workflows, schedules, paid services or Render resources. Existing schedules, timeouts and deadlines stay unchanged. If tier A does not fit, enablement slows down and the deficit is reported.
- **INV-042** `Internacional` postings MUST NOT enter the sitemap, JSON-LD or the Indexing API in this change.
- **INV-043** Database size MUST be measured before and after enablement batches. The rollout stops if the total approaches the plan's disk limit.

## Reporting

- **INV-050** Coverage MUST report separately: inventory size by source and ATS, rows by status, enabled boards, tier freshness, official postings by scope, hidden copies, and duplicate audit result. It MUST report both company- and posting-weighted coverage.
- **INV-051** Reports MUST NOT claim that a company lacks a portal because the inventory did not find one.
