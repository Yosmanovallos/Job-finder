import { z } from "zod";
import { htmlToText, isoDate, safeJson, text } from "./text.js";
import type { BoardListing, DirectAtsType, EmployerSourceRef, HttpGet, RawAtsPosting, Workplace } from "./types.js";

/**
 * Public, documented job-board APIs (ADR 0006 §5, phase D1). Each connector
 * returns the WHOLE board as the ATS states it; the Colombia filter runs
 * afterwards (src/direct/ingest.ts). Schemas are tolerant: they validate only
 * the fields we read and ignore the rest, because the providers add fields
 * without notice. A field the ATS doesn't state stays null — never inferred.
 */

// Ref formats: a board token for Greenhouse/Lever/Ashby, the company
// identifier for SmartRecruiters. Each connector declares its own pattern;
// anything else is refused before any URL is built from it.
const TOKEN_REF = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

// Board pages read per run (SmartRecruiters is the only paginated API here):
// 20 x 100 = 2,000 postings for one country, far above any board measured.
const MAX_PAGES = 20;

// ---------- Greenhouse: GET /v1/boards/{token}/jobs?content=true ----------

const GreenhouseBoard = z.object({
  jobs: z.array(
    z.object({
      id: z.number(),
      title: z.string(),
      absolute_url: z.string(),
      location: z.object({ name: z.string().nullable().optional() }).nullable().optional(),
      offices: z.array(z.object({ name: z.string().nullable().optional() })).optional(),
      departments: z.array(z.object({ name: z.string().nullable().optional() })).optional(),
      first_published: z.string().nullable().optional(),
      application_deadline: z.string().nullable().optional(),
      content: z.string().nullable().optional(),
      company_name: z.string().nullable().optional()
    })
  )
});

function greenhouse(body: unknown): RawAtsPosting[] | null {
  const parsed = GreenhouseBoard.safeParse(body);
  if (!parsed.success) return null;
  return parsed.data.jobs.map((job) => {
    const locationTexts = [job.location?.name, ...(job.offices ?? []).map((office) => office.name)]
      .map(text)
      .filter((value): value is string => value !== null);
    return {
      externalId: String(job.id),
      title: job.title.trim(),
      applyUrl: job.absolute_url,
      locationTexts,
      countryCodes: [],
      structuredCity: null,
      workplace: null,
      descriptionText: job.content ? htmlToText(job.content) || null : null,
      department: text(job.departments?.[0]?.name),
      employmentType: null,
      publishedAt: isoDate(job.first_published),
      validThrough: isoDate(job.application_deadline),
      companyName: text(job.company_name)
    };
  });
}

// ---------- Lever: GET /v0/postings/{site}?mode=json ----------

const LeverBoard = z.array(
  z.object({
    id: z.string(),
    text: z.string(),
    hostedUrl: z.string(),
    country: z.string().nullable().optional(),
    workplaceType: z.string().nullable().optional(),
    createdAt: z.number().nullable().optional(),
    descriptionPlain: z.string().nullable().optional(),
    categories: z
      .object({
        location: z.string().nullable().optional(),
        allLocations: z.array(z.string()).nullable().optional(),
        commitment: z.string().nullable().optional(),
        department: z.string().nullable().optional(),
        team: z.string().nullable().optional()
      })
      .partial()
      .nullable()
      .optional()
  })
);

const LEVER_WORKPLACE: Record<string, Workplace> = { remote: "remote", hybrid: "hybrid", "on-site": "onsite", onsite: "onsite" };

function lever(body: unknown): RawAtsPosting[] | null {
  const parsed = LeverBoard.safeParse(body);
  if (!parsed.success) return null;
  return parsed.data.map((posting) => {
    const categories = posting.categories ?? {};
    const allLocations = categories.allLocations?.length ? categories.allLocations : [categories.location ?? ""];
    const locationTexts = allLocations.map(text).filter((value): value is string => value !== null);
    // `country` describes only the primary location; with several locations
    // it would wrongly veto a secondary Colombian one, so it's used alone.
    const countryCodes = locationTexts.length <= 1 && text(posting.country) ? [posting.country!.toUpperCase()] : [];
    return {
      externalId: posting.id,
      title: posting.text.trim(),
      applyUrl: posting.hostedUrl,
      locationTexts,
      countryCodes,
      structuredCity: null,
      workplace: LEVER_WORKPLACE[(posting.workplaceType ?? "").toLowerCase()] ?? null,
      descriptionText: text(posting.descriptionPlain),
      department: text(categories.department) ?? text(categories.team),
      employmentType: text(categories.commitment),
      publishedAt: isoDate(posting.createdAt),
      validThrough: null,
      companyName: null
    };
  });
}

// ---------- Ashby: GET /posting-api/job-board/{name} ----------

const AshbyAddress = z
  .object({
    postalAddress: z
      .object({
        addressCountry: z.string().nullable().optional(),
        addressLocality: z.string().nullable().optional()
      })
      .partial()
      .nullable()
      .optional()
  })
  .partial()
  .nullable()
  .optional();

const AshbyBoard = z.object({
  jobs: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      jobUrl: z.string(),
      location: z.string().nullable().optional(),
      secondaryLocations: z
        .array(z.object({ location: z.string().nullable().optional(), address: AshbyAddress }).partial())
        .nullable()
        .optional(),
      address: AshbyAddress,
      isListed: z.boolean().nullable().optional(),
      isRemote: z.boolean().nullable().optional(),
      workplaceType: z.string().nullable().optional(),
      publishedAt: z.string().nullable().optional(),
      descriptionPlain: z.string().nullable().optional(),
      employmentType: z.string().nullable().optional(),
      department: z.string().nullable().optional()
    })
  )
});

const ASHBY_WORKPLACE: Record<string, Workplace> = { remote: "remote", hybrid: "hybrid", onsite: "onsite" };

/** Ashby writes the country as a name ("Colombia"); only Colombia matters here. */
function ashbyCountryCode(country: string | null | undefined): string | null {
  const value = text(country);
  if (!value) return null;
  const folded = value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return folded === "colombia" || folded === "co" ? "CO" : value.toUpperCase();
}

function ashby(body: unknown): RawAtsPosting[] | null {
  const parsed = AshbyBoard.safeParse(body);
  if (!parsed.success) return null;
  return parsed.data.jobs
    .filter((job) => job.isListed !== false)
    .map((job) => {
      const secondary = job.secondaryLocations ?? [];
      const locationTexts = [job.location, ...secondary.map((entry) => entry.location)]
        .map(text)
        .filter((value): value is string => value !== null);
      const countries = [job.address, ...secondary.map((entry) => entry.address)]
        .map((address) => ashbyCountryCode(address?.postalAddress?.addressCountry))
        .filter((value): value is string => value !== null);
      const primaryIsColombia = ashbyCountryCode(job.address?.postalAddress?.addressCountry) === "CO";
      return {
        externalId: job.id,
        title: job.title.trim(),
        applyUrl: job.jobUrl,
        locationTexts,
        // A board that leaves some addresses empty can't veto by country.
        countryCodes: countries.length === 1 + secondary.length ? [...new Set(countries)] : [],
        structuredCity: primaryIsColombia ? text(job.address?.postalAddress?.addressLocality) : null,
        workplace:
          ASHBY_WORKPLACE[(job.workplaceType ?? "").toLowerCase().replace(/[^a-z]/g, "")] ??
          (job.isRemote === true ? "remote" : null),
        descriptionText: text(job.descriptionPlain),
        department: text(job.department),
        employmentType: text(job.employmentType),
        publishedAt: isoDate(job.publishedAt),
        validThrough: null,
        companyName: null
      };
    });
}

// ---------- SmartRecruiters: GET /v1/companies/{id}/postings?country=co ----------
// Disabled by default per docs/adr/0002 (robots.txt vs documented public API).

const SmartRecruitersPage = z.object({
  totalFound: z.number(),
  content: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      releasedDate: z.string().nullable().optional(),
      company: z.object({ name: z.string().nullable().optional() }).partial().nullable().optional(),
      location: z
        .object({
          city: z.string().nullable().optional(),
          country: z.string().nullable().optional(),
          fullLocation: z.string().nullable().optional(),
          remote: z.boolean().nullable().optional(),
          hybrid: z.boolean().nullable().optional()
        })
        .partial()
        .nullable()
        .optional(),
      department: z.object({ label: z.string().nullable().optional() }).partial().nullable().optional(),
      typeOfEmployment: z.object({ label: z.string().nullable().optional() }).partial().nullable().optional()
    })
  )
});

function smartRecruitersPosting(
  identifier: string,
  posting: z.infer<typeof SmartRecruitersPage>["content"][number]
): RawAtsPosting {
  const location = posting.location ?? {};
  const workplace: Workplace | null =
    location.remote === true ? "remote" : location.hybrid === true ? "hybrid" : location.remote === false && location.hybrid === false ? "onsite" : null;
  return {
    externalId: posting.id,
    title: posting.name.trim(),
    applyUrl: `https://jobs.smartrecruiters.com/${identifier}/${posting.id}`,
    locationTexts: [text(location.fullLocation) ?? text(location.city)].filter((value): value is string => value !== null),
    countryCodes: text(location.country) ? [location.country!.toUpperCase()] : [],
    structuredCity: text(location.city),
    workplace,
    // The listing has no body; the detail call is left for a later phase.
    descriptionText: null,
    department: text(posting.department?.label),
    employmentType: text(posting.typeOfEmployment?.label),
    publishedAt: isoDate(posting.releasedDate),
    validThrough: null,
    companyName: text(posting.company?.name)
  };
}

// ---------- registry ----------

/**
 * One entry per ATS with a connector. `list` reads the whole board and never
 * throws (listBoard wraps it); `postingUrl` exists only where the ATS answers
 * a clean 404 once a posting is gone (measured 2026-10-19 with live and
 * nonexistent ids). Ashby has none and its public page is an SPA that
 * answers 200 for any id; SmartRecruiters answers 400 for an unknown id,
 * which is not proof of closure — those close on missing listings only.
 */
interface Connector {
  refPattern: RegExp;
  portalUrl(ref: string): string;
  list(ref: string, http: HttpGet): Promise<BoardListing>;
  postingUrl?(ref: string, id: string): string;
}

function singlePage(url: (ref: string) => string, parse: (body: unknown) => RawAtsPosting[] | null) {
  return async (ref: string, http: HttpGet): Promise<BoardListing> => {
    const response = await http(url(ref));
    if (response.status === 404) return { kind: "not_found", detail: "el ATS respondió 404 para este tablero" };
    if (response.status !== 200) return { kind: "error", detail: `HTTP ${response.status}` };
    const postings = parse(safeJson(response.body));
    if (!postings) return { kind: "error", detail: "respuesta con forma inesperada" };
    return { kind: "complete", boardTotal: postings.length, postings };
  };
}

const CONNECTORS: Record<DirectAtsType, Connector> = {
  greenhouse: {
    refPattern: TOKEN_REF,
    portalUrl: (ref) => `https://job-boards.greenhouse.io/${ref}`,
    list: singlePage((ref) => `https://boards-api.greenhouse.io/v1/boards/${ref}/jobs?content=true`, greenhouse),
    postingUrl: (ref, id) => `https://boards-api.greenhouse.io/v1/boards/${ref}/jobs/${id}`
  },
  lever: {
    refPattern: TOKEN_REF,
    portalUrl: (ref) => `https://jobs.lever.co/${ref}`,
    list: singlePage((ref) => `https://api.lever.co/v0/postings/${ref}?mode=json`, lever),
    postingUrl: (ref, id) => `https://api.lever.co/v0/postings/${ref}/${id}`
  },
  ashby: {
    refPattern: TOKEN_REF,
    portalUrl: (ref) => `https://jobs.ashbyhq.com/${ref}`,
    list: singlePage((ref) => `https://api.ashbyhq.com/posting-api/job-board/${ref}`, ashby)
  },
  smartrecruiters: {
    refPattern: TOKEN_REF,
    portalUrl: (ref) => `https://jobs.smartrecruiters.com/${ref}`,
    list: listSmartRecruiters
  }
};

/** True when `ref` is a well-formed reference for that ATS. */
export function isValidRef(ref: EmployerSourceRef): boolean {
  return CONNECTORS[ref.atsType]?.refPattern.test(ref.atsRef) ?? false;
}

export function portalUrl(ref: EmployerSourceRef): string {
  return CONNECTORS[ref.atsType].portalUrl(ref.atsRef);
}

export function canConfirmClosure(atsType: EmployerSourceRef["atsType"]): boolean {
  return Boolean(CONNECTORS[atsType]?.postingUrl);
}

/**
 * True only when the ATS itself says the posting no longer exists (404/410).
 * Errors, timeouts and anything else are "not proven" — never a closure.
 */
export async function confirmPostingGone(ref: EmployerSourceRef, externalId: string, http: HttpGet): Promise<boolean> {
  const build = CONNECTORS[ref.atsType]?.postingUrl;
  if (!build || !isValidRef(ref) || !/^[A-Za-z0-9-]{1,100}$/.test(externalId)) return false;
  try {
    const response = await http(build(ref.atsRef, externalId));
    return response.status === 404 || response.status === 410;
  } catch {
    return false;
  }
}

function errorDetail(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 200);
}

/** Reads one employer board end to end. Never throws. */
export async function listBoard(ref: EmployerSourceRef, http: HttpGet): Promise<BoardListing> {
  const connector = CONNECTORS[ref.atsType];
  if (!connector) return { kind: "error", detail: `ATS sin conector: ${ref.atsType}` };
  if (!connector.refPattern.test(ref.atsRef)) return { kind: "error", detail: "ats_ref con formato inválido" };
  try {
    return await connector.list(ref.atsRef, http);
  } catch (error) {
    return { kind: "error", detail: errorDetail(error) };
  }
}

async function listSmartRecruiters(identifier: string, http: HttpGet): Promise<BoardListing> {
  const postings: RawAtsPosting[] = [];
  const pageSize = 100;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `https://api.smartrecruiters.com/v1/companies/${identifier}/postings?country=co&limit=${pageSize}&offset=${page * pageSize}`;
    const response = await http(url);
    if (response.status === 404) return { kind: "not_found", detail: "el ATS respondió 404 para esta empresa" };
    if (response.status !== 200) return { kind: "error", detail: `HTTP ${response.status} en la página ${page + 1}` };
    const parsed = SmartRecruitersPage.safeParse(safeJson(response.body));
    if (!parsed.success) return { kind: "error", detail: `forma inesperada en la página ${page + 1}` };
    postings.push(...parsed.data.content.map((posting) => smartRecruitersPosting(identifier, posting)));
    if (parsed.data.content.length < pageSize || postings.length >= parsed.data.totalFound) {
      // totalFound is the Colombia count (country=co), so the board total
      // used for the mass-drop guard is the same subset.
      return { kind: "complete", boardTotal: parsed.data.totalFound, postings };
    }
  }
  return { kind: "error", detail: `más de ${MAX_PAGES} páginas: listado incompleto, no se cierra nada` };
}
