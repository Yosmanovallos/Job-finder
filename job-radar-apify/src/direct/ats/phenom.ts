import { z } from "zod";
import { decodeEntities, htmlToText, isoDate, safeJson, text } from "../text.js";
import type { BoardListing, HttpGet, ListOptions, RawAtsPosting } from "../types.js";
import { allowedUrl, readRobots } from "./site.js";

/**
 * Phenom career sites on the employer's own domain (docs/source-catalog/
 * phenom.md). No public API: the site's own search widget endpoint
 * (`POST /widgets`, ddoKey `refineSearch`), allowed by robots.txt, filtered
 * by the site's own country facet ("Colombia"). The tenant parameters
 * (endpoint, locale, country, pageId) are read from the search page on every
 * read, never hard-coded. The facet also returns postings whose primary
 * country is another one but list a Colombian location: every location is
 * passed on and the Colombia filter decides per segment.
 *
 * ats_ref = host + locale path (`careers.dhl.com/amer/es`, `www.pgcareers.com/latam/en`).
 */

const PAGE_SIZE = 50;
const MAX_PAGES = 20;

export const PHENOM_REF = /^(?!\d+\.\d+\.\d+\.\d+(\/|$))[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)+(?:\/[a-z]{2,10}(?:-[a-z]{2,10})?){1,2}$/;

export interface PhenomSite {
  endpoint: string;
  locale: string;
  country: string;
  pageId: string;
}

/** Tenant parameters as the search page declares them; null when any is missing. */
export function phenomSiteParams(html: string, origin: string): PhenomSite | null {
  const config = /"widgetApiEndpoint":"([^"]+)","country":"([^"]+)","deviceType":"[^"]*","locale":"([^"]+)"/.exec(html);
  const pageId = /phApp\.pageId\s*=\s*"([^"]+)"/.exec(html)?.[1];
  if (!config || !pageId) return null;
  const endpoint = config[1].replace(/\\\//g, "/");
  // Never post outside the employer's own site.
  if (new URL(endpoint, origin).origin !== origin) return null;
  return { endpoint: new URL(endpoint, origin).toString(), country: config[2], locale: config[3], pageId };
}

const Job = z
  .object({
    jobSeqNo: z.string(),
    title: z.string(),
    postedDate: z.string().nullable().optional(),
    country: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    location: z.string().nullable().optional(),
    cityStateCountry: z.string().nullable().optional(),
    multi_location: z.array(z.string()).nullable().optional(),
    category: z.string().nullable().optional(),
    type: z.string().nullable().optional()
  })
  .passthrough();

const Page = z.object({
  refineSearch: z.object({
    status: z.number(),
    totalHits: z.number(),
    data: z.object({ jobs: z.array(Job) })
  })
});

/** "2026-06-25T16:06:48.533+0000" → ISO; null when absent or unreadable. */
export function phenomDate(value: string | null | undefined): string | null {
  return isoDate(value ? value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2") : null);
}

function slug(title: string): string {
  return (
    title
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "empleo"
  );
}

/** JobPosting description from a posting page's JSON-LD. */
export function phenomDescription(html: string): string | null {
  for (const match of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    const data = safeJson(match[1]) as { "@type"?: unknown; description?: unknown } | undefined;
    if (data && data["@type"] === "JobPosting" && typeof data.description === "string") {
      return htmlToText(decodeEntities(data.description)) || null;
    }
  }
  return null;
}

export async function listPhenom(ref: string, http: HttpGet, options: ListOptions): Promise<BoardListing> {
  const slash = ref.indexOf("/");
  const origin = `https://${ref.slice(0, slash)}`;
  const base = `https://${ref}`;
  const robots = await readRobots(origin, http);
  const searchPage = `${base}/search-results`;
  if (!allowedUrl(robots, searchPage)) return { kind: "error", detail: "robots.txt no permite search-results" };
  const page = await http(searchPage, { accept: "text/html" });
  if (page.status !== 200) return { kind: page.status === 404 ? "not_found" : "error", detail: `HTTP ${page.status} en search-results` };
  const site = phenomSiteParams(page.body, origin);
  if (!site) return { kind: "error", detail: "no se hallaron los parámetros del sitio Phenom" };
  if (!allowedUrl(robots, site.endpoint)) return { kind: "error", detail: "robots.txt no permite /widgets" };

  const jobs: z.infer<typeof Job>[] = [];
  let total = -1;
  for (let index = 0; index < MAX_PAGES; index++) {
    const response = await http(site.endpoint, {
      json: {
        lang: site.locale,
        deviceType: "desktop",
        country: site.country,
        pageName: "search-results",
        ddoKey: "refineSearch",
        sortBy: "",
        subsearch: "",
        from: index * PAGE_SIZE,
        jobs: true,
        counts: true,
        all_fields: ["category", "country", "state", "city", "type"],
        size: PAGE_SIZE,
        clearAll: false,
        jdsource: "facets",
        isSliderEnable: false,
        pageId: site.pageId,
        siteType: "external",
        keywords: "",
        global: true,
        selected_fields: { country: ["Colombia"] },
        locationData: {}
      }
    });
    if (response.status !== 200) return { kind: "error", detail: `HTTP ${response.status} en la página ${index + 1}` };
    const parsed = Page.safeParse(safeJson(response.body));
    if (!parsed.success || parsed.data.refineSearch.status !== 200) return { kind: "error", detail: `forma inesperada en la página ${index + 1}` };
    const search = parsed.data.refineSearch;
    if (total >= 0 && search.totalHits !== total) return { kind: "error", detail: "el total cambió entre páginas: listado inconsistente" };
    total = search.totalHits;
    jobs.push(...search.data.jobs);
    if (search.data.jobs.length === 0 || jobs.length >= total) break;
  }
  if (jobs.length !== total) return { kind: "error", detail: `se leyeron ${jobs.length} de ${total} vacantes: listado incompleto` };
  if (new Set(jobs.map((job) => job.jobSeqNo)).size !== jobs.length) return { kind: "error", detail: "ids repetidos en el listado" };

  const known = options.knownIds ?? new Set<string>();
  let budget = options.detailBudget ?? 0;
  let deferred = 0;
  const postings: RawAtsPosting[] = [];
  for (const job of jobs) {
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(job.jobSeqNo)) return { kind: "error", detail: "jobSeqNo inesperado" };
    const jobUrl = `${base}/job/${job.jobSeqNo}/${slug(job.title)}`;
    const locations = job.multi_location?.length ? job.multi_location : [text(job.cityStateCountry) ?? text(job.location) ?? ""];
    const posting: RawAtsPosting = {
      externalId: job.jobSeqNo,
      title: job.title.trim(),
      applyUrl: jobUrl,
      locationTexts: locations.map((value) => value.trim()).filter(Boolean),
      countryCodes: [],
      structuredCity: /^colombia$/i.test(job.country ?? "") ? text(job.city) : null,
      workplace: null,
      descriptionText: null,
      department: text(job.category),
      employmentType: text(job.type),
      publishedAt: phenomDate(job.postedDate),
      validThrough: null,
      companyName: null,
      partial: true
    };
    if (known.has(job.jobSeqNo) || !allowedUrl(robots, jobUrl)) {
      postings.push(posting);
      continue;
    }
    if (budget <= 0) {
      deferred++;
      continue;
    }
    budget--;
    const detail = await http(jobUrl, { accept: "text/html" }).catch(() => null);
    const description = detail?.status === 200 ? phenomDescription(detail.body) : null;
    // The listing already has the date and the place; a missing description
    // is stored as unknown, not deferred.
    postings.push({ ...posting, descriptionText: description, partial: description === null });
  }
  return { kind: "complete", boardTotal: total, postings, deferred };
}
