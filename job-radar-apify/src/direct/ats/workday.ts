import { z } from "zod";
import { isAllowed } from "../discovery/robots.js";
import { htmlToText, isoDate, safeJson, text } from "../text.js";
import type { BoardListing, HttpGet, ListOptions, RawAtsPosting } from "../types.js";
import { readRobots } from "./site.js";

/**
 * Workday career sites through the JSON endpoint their own public page uses
 * (`POST /wday/cxs/{tenant}/{site}/jobs`), docs/source-catalog/workday.md.
 * Undocumented by Workday: every field is observed, so the schemas are
 * tolerant and anything unexpected makes the listing incomplete, never a
 * guess.
 *
 * - ats_ref = `tenant/wdN/site` on `{tenant}.wd{N}.myworkdayjobs.com`.
 * - robots.txt is read on every read; a site the employer disallows, or one
 *   left out of an explicit Allow list, is not read (the CXS path itself is
 *   never disallowed, but the employer's intent is per site).
 * - Up to 200 postings the board is read whole; above that only through the
 *   tenant's own Colombia country facet (its name varies by tenant:
 *   `locationCountry`, `alocationCountry`…). A big board without a country
 *   facet can't be read completely and is reported as such.
 * - The listing's date is relative ("Posted 5 Days Ago"; "30+" is already
 *   past the 30-day window). The absolute date, the country (alpha-2), the
 *   description and the end date come from the posting detail, read only
 *   for new postings within the detail budget.
 */

const PAGE_SIZE = 20; // the endpoint rejects more (HTTP 400)
const MAX_FULL_LISTING = 200;
const MAX_PAGES = 15;
const PAUSE_MS = 1_000; // per board, between requests: some tenants throttle hard

export const WORKDAY_REF =
  /^([a-z0-9][a-z0-9_-]{0,62})\/(wd\d{1,3})\/([A-Za-z0-9][A-Za-z0-9_-]{0,99})$/;

const FacetValue = z
  .object({ descriptor: z.string().optional(), id: z.string().optional(), count: z.number().optional() })
  .passthrough();
type Facet = { facetParameter?: string; values?: unknown[] };

const ListPage = z.object({
  total: z.number(),
  jobPostings: z.array(
    z.object({
      title: z.string(),
      externalPath: z.string(),
      locationsText: z.string().nullable().optional(),
      postedOn: z.string().nullable().optional(),
      timeType: z.string().nullable().optional()
    })
  ),
  facets: z.array(z.unknown()).optional()
});
type ListRow = z.infer<typeof ListPage>["jobPostings"][number];

const Detail = z.object({
  jobPostingInfo: z.object({
    title: z.string(),
    jobDescription: z.string().nullable().optional(),
    location: z.string().nullable().optional(),
    startDate: z.string().nullable().optional(),
    endDate: z.string().nullable().optional(),
    timeType: z.string().nullable().optional(),
    externalUrl: z.string().nullable().optional(),
    jobRequisitionLocation: z
      .object({
        descriptor: z.string().nullable().optional(),
        country: z
          .object({ alpha2Code: z.string().nullable().optional() })
          .partial()
          .nullable()
          .optional()
      })
      .partial()
      .nullable()
      .optional()
  }),
  hiringOrganization: z
    .object({ name: z.string().nullable().optional() })
    .partial()
    .nullable()
    .optional()
});

/** The tenant's country facet and Colombia's id in it, wherever the facet is nested. */
export function colombiaFacet(
  facets: unknown[] | undefined
): { name: string; colombiaId: string | null; count: number } | null {
  const stack = [...(facets ?? [])] as Facet[];
  while (stack.length > 0) {
    const facet = stack.shift()!;
    if (!facet || typeof facet !== "object") continue;
    const values = Array.isArray(facet.values) ? facet.values : [];
    if (
      typeof facet.facetParameter === "string" &&
      /locationcountry$/i.test(facet.facetParameter)
    ) {
      const colombia = values
        .map((value) => FacetValue.safeParse(value))
        .find((parsed) => parsed.success && /^colombia$/i.test(parsed.data.descriptor ?? ""));
      return {
        name: facet.facetParameter,
        colombiaId: colombia?.success ? (colombia.data.id ?? null) : null,
        count: colombia?.success ? (colombia.data.count ?? 0) : 0
      };
    }
    stack.push(
      ...(values.filter(
        (value) => value && typeof value === "object" && "facetParameter" in (value as object)
      ) as Facet[])
    );
  }
  return null;
}

/** "Posted 30+ Days Ago" is already outside the 30-day window. */
export function postedOver30Days(postedOn: string | null | undefined): boolean {
  return /30\+/.test(postedOn ?? "");
}

/** The posting id: last segment of externalPath (`{slug}_{reqId}[-n]`), stable across city renames. */
export function workdayExternalId(externalPath: string): string | null {
  const id = externalPath.split("/").filter(Boolean).pop() ?? "";
  return /^[A-Za-z0-9._-]{1,200}$/.test(id) ? id : null;
}

const pause = () => new Promise((resolve) => setTimeout(resolve, PAUSE_MS));

async function readRows(
  base: string,
  appliedFacets: Record<string, string[]>,
  http: HttpGet
): Promise<{ total: number; rows: ListRow[]; facets?: unknown[] } | { error: string }> {
  const rows: ListRow[] = [];
  let total = 0;
  let facets: unknown[] | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    if (page > 0) await pause();
    const response = await http(`${base}/jobs`, {
      json: { appliedFacets, limit: PAGE_SIZE, offset: page * PAGE_SIZE, searchText: "" }
    });
    if (response.status !== 200)
      return { error: `HTTP ${response.status} en la página ${page + 1}` };
    const parsed = ListPage.safeParse(safeJson(response.body));
    if (!parsed.success) return { error: `forma inesperada en la página ${page + 1}` };
    // `total` is only reliable on the first page (later pages may say 0).
    if (page === 0) {
      total = parsed.data.total;
      facets = parsed.data.facets;
      if (total > MAX_PAGES * PAGE_SIZE && Object.keys(appliedFacets).length === 0)
        return { total, rows, facets };
    }
    rows.push(...parsed.data.jobPostings);
    if (parsed.data.jobPostings.length === 0 || rows.length >= total) break;
  }
  if (rows.length !== total)
    return { error: `se leyeron ${rows.length} de ${total} vacantes: listado incompleto` };
  if (new Set(rows.map((row) => row.externalPath)).size !== rows.length)
    return { error: "vacantes repetidas en el listado" };
  return { total, rows, facets };
}

export async function listWorkday(
  ref: string,
  http: HttpGet,
  options: ListOptions
): Promise<BoardListing> {
  const match = WORKDAY_REF.exec(ref);
  if (!match) return { kind: "error", detail: "ats_ref con formato inválido" };
  const [, tenant, pod, site] = match;
  const origin = `https://${tenant}.${pod}.myworkdayjobs.com`;
  const base = `${origin}/wday/cxs/${tenant}/${site}`;

  const robots = await readRobots(origin, http);
  if (!isAllowed(robots, `/wday/cxs/${tenant}/${site}/jobs`) || !isAllowed(robots, `/${site}/`)) {
    return { kind: "error", detail: "robots.txt no permite este site" };
  }
  // An explicit Allow list that names other sites but not this one: the
  // employer only opened those.
  if (
    robots.kind === "rules" &&
    robots.rules.some((rule) => rule.allow) &&
    !robots.rules.some(
      (rule) => rule.allow && `/${site}/`.startsWith(rule.pattern.replace(/\*.*$/, ""))
    )
  ) {
    return { kind: "error", detail: "robots.txt solo abre otros sites de este tenant" };
  }

  const first = await readRows(base, {}, http);
  if ("error" in first)
    return first.error.startsWith("HTTP 404")
      ? { kind: "not_found", detail: "Workday respondió 404 para este site" }
      : { kind: "error", detail: first.error };
  let listing = first;
  if (first.total > MAX_FULL_LISTING) {
    const facet = colombiaFacet(first.facets);
    if (!facet)
      return {
        kind: "error",
        detail: `tablero de ${first.total} vacantes sin faceta de país: no se puede leer completo`
      };
    // Colombia absent from the facet = no Colombian posting today.
    if (!facet.colombiaId) return { kind: "complete", boardTotal: 0, postings: [] };
    await pause();
    const filtered = await readRows(base, { [facet.name]: [facet.colombiaId] }, http);
    if ("error" in filtered) return { kind: "error", detail: `faceta Colombia: ${filtered.error}` };
    listing = filtered;
  }

  const known = options.knownIds ?? new Set<string>();
  let budget = options.detailBudget ?? 0;
  let deferred = 0;
  const postings: RawAtsPosting[] = [];
  for (const row of listing.rows) {
    const externalId = workdayExternalId(row.externalPath);
    if (!externalId || !row.externalPath.startsWith("/job/"))
      return { kind: "error", detail: "externalPath inesperado" };
    const applyUrl = `${origin}/${site}${row.externalPath}`;
    if (known.has(externalId)) {
      // Only Colombian postings are ever stored: a known id is one. Partial
      // row — the stored date, description and end date stay.
      postings.push({
        externalId,
        title: row.title.trim(),
        applyUrl,
        locationTexts: [text(row.locationsText) ?? "Colombia"],
        countryCodes: ["CO"],
        structuredCity: null,
        workplace: null,
        descriptionText: null,
        department: null,
        employmentType: text(row.timeType),
        publishedAt: null,
        validThrough: null,
        companyName: null,
        partial: true
      });
      continue;
    }
    if (postedOver30Days(row.postedOn)) continue;
    // Tenants that prefix the location with the ISO-3 country ("PER-Lima",
    // "BRA-São Paulo", "COL-Bogotá") say it is not Colombian without a detail
    // request; the Colombia filter drops it.
    const prefix = /^([A-Z]{3})-/.exec(row.locationsText ?? "")?.[1];
    if (prefix && prefix !== "COL") {
      postings.push({
        externalId,
        title: row.title.trim(),
        applyUrl,
        locationTexts: [row.locationsText!],
        countryCodes: [prefix],
        structuredCity: null,
        workplace: null,
        descriptionText: null,
        department: null,
        employmentType: null,
        publishedAt: null,
        validThrough: null,
        companyName: null,
        partial: true
      });
      continue;
    }
    if (budget <= 0) {
      deferred++;
      continue;
    }
    budget--;
    await pause();
    const response = await http(`${base}${row.externalPath}`).catch(() => null);
    const detail = response?.status === 200 ? Detail.safeParse(safeJson(response.body)) : null;
    if (!detail?.success) {
      deferred++;
      continue;
    }
    const info = detail.data.jobPostingInfo;
    const alpha2 = text(info.jobRequisitionLocation?.country?.alpha2Code);
    const location = text(info.location) ?? text(info.jobRequisitionLocation?.descriptor);
    postings.push({
      externalId,
      title: info.title.trim(),
      applyUrl,
      locationTexts: location ? [location] : [],
      countryCodes: alpha2 ? [alpha2] : [],
      structuredCity: null,
      workplace: null,
      descriptionText: info.jobDescription ? htmlToText(info.jobDescription) || null : null,
      department: null,
      employmentType: text(info.timeType),
      publishedAt: isoDate(info.startDate),
      validThrough: isoDate(info.endDate),
      companyName: text(detail.data.hiringOrganization?.name),
      partial: false
    });
  }
  return { kind: "complete", boardTotal: listing.total, postings, deferred };
}
