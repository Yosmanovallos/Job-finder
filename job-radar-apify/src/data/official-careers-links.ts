import { companyKey } from "../lib/company-key.js";

// Employers whose official vacancies BuscoTrabajo can't read without breaking
// their rules (ADR 0006 §10, owner decision 2026-10-22: "use other
// alternatives"), so their company page links a person to the employer's own
// careers search instead. A link only — nothing is fetched from these sites,
// no posting is copied or projected, and their job-board copies stay as they
// are. Each URL is on the employer's own careers domain and answered 200 on
// 2026-10-22, except metacareers.com, which answers 400 to any non-browser
// client (the domain is Meta's, docs/source-catalog/meta.md). Why each one
// isn't read: docs/source-catalog/{amazon,meta,ibm,globant,oracle-recruiting-cloud}.md.
//
// Keyed by companyKey() (case, accents, legal form and a trailing country
// folded), so "Accenture Colombia" and "ACCENTURE S.A.S." share one entry.
// Add an employer here only when its own site is confirmed by hand — never a
// guessed domain (regla 5 de AGENTS.md).
const OFFICIAL_CAREERS_URLS: Record<string, string> = {
  // amazon.jobs: Conditions of Use forbid automated collection without written permission.
  amazon: "https://www.amazon.jobs/es/search?country%5B%5D=COL",
  // metacareers.com: terms forbid automated collection.
  meta: "https://www.metacareers.com/jobs",
  // ibm.com/careers: terms forbid automated collection.
  ibm: "https://www.ibm.com/careers/search?field_keyword_05%5B0%5D=Colombia",
  // career.globant.com: robots.txt forbids /search/, the only listing.
  globant: "https://career.globant.com/",
  // accenture.com: answers 429 to any automated read.
  accenture: "https://www.accenture.com/co-es/careers/jobsearch",
  // Deloitte: no Colombian board identified (docs/source-catalog/avature.md).
  deloitte: "https://www.deloitte.com/latam/es/careers.html",
  // Tiendas D1: no public listing, only a CV form.
  d1: "https://www.d1.com.co/pagina/trabaja-con-nosotros",
  tiendasd1: "https://www.d1.com.co/pagina/trabaja-con-nosotros",
  koba: "https://www.d1.com.co/pagina/trabaja-con-nosotros",
  // Oracle Recruiting Cloud tenants: endpoint documented as Oracle-internal.
  oracle: "https://careers.oracle.com/",
  jpmorganchase: "https://www.jpmorganchase.com/careers",
  jpmorgan: "https://www.jpmorganchase.com/careers",
  hilton: "https://jobs.hilton.com/",
  nokia: "https://www.nokia.com/careers/"
};

/** The employer's own careers search for the first of these spellings that has one, or null. */
export function getOfficialCareersUrl(names: readonly string[]): string | null {
  for (const name of names) {
    const url = OFFICIAL_CAREERS_URLS[companyKey(name)];
    if (url) return url;
  }
  return null;
}
