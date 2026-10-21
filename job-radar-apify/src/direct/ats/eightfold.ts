import { z } from "zod";
import { isAllowed } from "../discovery/robots.js";
import { htmlToText, isoDate, safeJson, text } from "../text.js";
import type { BoardListing, HttpGet, ListOptions, RawAtsPosting, Workplace } from "../types.js";
import { readRobots } from "./site.js";

/**
 * Eightfold career sites (docs/source-catalog/eightfold.md). The official API
 * needs the customer's OAuth; the public career page uses one of two JSON
 * endpoints, both explicitly allowed by robots.txt (`Allow: /api/apply`,
 * `Allow: /api/pcsx` under a `Disallow: /`):
 *   - PCSX: GET /api/pcsx/search?domain=&location=Colombia&start=N
 *   - v2:   GET /api/apply/v2/jobs?domain=&location=Colombia&start=N
 * A tenant answers 403 on the mode it doesn't use. `location` is a fuzzy
 * text search, so the Colombia filter re-checks every location.
 *
 * ats_ref = `{host}@{domain}` (`bayer.eightfold.ai@bayer.com`,
 * `apply.careers.microsoft.com@microsoft.com`). Hosts throttle hard: 6 s
 * between requests, and a 429 is an incomplete read.
 */

const PAGE_STEP = 10; // `num` is ignored: pages are always 10
const MAX_PAGES = 30;
let pauseMs = 6_000;

/** Offline tests only: the real pause would make each fixture test wait 6 s per request. */
export function setEightfoldPauseForTests(ms: number): void {
  pauseMs = ms;
}

const HOST = "[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)+";
export const EIGHTFOLD_REF = new RegExp(`^(?!\\d+\\.\\d+\\.\\d+\\.\\d+@)(${HOST})@(${HOST})$`);

const WORKPLACE: Record<string, Workplace> = { onsite: "onsite", hybrid: "hybrid", remote: "remote" };
const workplace = (value: string | null | undefined): Workplace | null => WORKPLACE[(value ?? "").toLowerCase()] ?? null;

const Pcsx = z.object({
  id: z.union([z.number(), z.string()]),
  name: z.string(),
  locations: z.array(z.string()).nullable().optional(),
  standardizedLocations: z.array(z.string()).nullable().optional(),
  postedTs: z.number().nullable().optional(),
  department: z.string().nullable().optional(),
  workLocationOption: z.string().nullable().optional(),
  positionUrl: z.string().nullable().optional()
});
const PcsxPage = z.object({ data: z.object({ count: z.number(), positions: z.array(Pcsx) }) });

const V2 = z.object({
  id: z.union([z.number(), z.string()]),
  name: z.string(),
  locations: z.array(z.string()).nullable().optional(),
  location: z.string().nullable().optional(),
  t_create: z.number().nullable().optional(),
  department: z.string().nullable().optional(),
  work_location_option: z.string().nullable().optional(),
  job_description: z.string().nullable().optional(),
  canonicalPositionUrl: z.string().nullable().optional()
});
const V2Page = z.object({ count: z.number(), positions: z.array(V2) });

const epoch = (seconds: number | null | undefined) => (typeof seconds === "number" && seconds > 0 ? isoDate(seconds * 1000) : null);
const pause = () => new Promise((resolve) => setTimeout(resolve, pauseMs));

/** "Bogotá, Bogota, CO" → "CO". */
function alpha2(standardized: string): string | null {
  const last = standardized.split(",").pop()?.trim() ?? "";
  return /^[A-Z]{2}$/.test(last) ? last : null;
}

type Mode = "pcsx" | "v2";

async function readAll(
  origin: string,
  domain: string,
  mode: Mode,
  http: HttpGet
): Promise<{ total: number; rows: unknown[] } | { forbidden: true } | { error: string }> {
  const rows: unknown[] = [];
  let total = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    if (page > 0) await pause();
    const path = mode === "pcsx" ? "/api/pcsx/search" : "/api/apply/v2/jobs";
    const response = await http(`${origin}${path}?domain=${encodeURIComponent(domain)}&location=Colombia&start=${page * PAGE_STEP}`);
    if (response.status === 403 && page === 0) return { forbidden: true };
    if (response.status !== 200) return { error: `HTTP ${response.status} en la página ${page + 1}` };
    const body = safeJson(response.body);
    const parsed = mode === "pcsx" ? PcsxPage.safeParse(body) : V2Page.safeParse(body);
    if (!parsed.success) return { error: `forma inesperada en la página ${page + 1}` };
    const { count, positions } = "data" in parsed.data ? parsed.data.data : parsed.data;
    if (page > 0 && count !== total) return { error: "el total cambió entre páginas: listado inconsistente" };
    total = count;
    rows.push(...positions);
    if (positions.length === 0 || rows.length >= total) break;
  }
  if (rows.length !== total) return { error: `se leyeron ${rows.length} de ${total} vacantes: listado incompleto` };
  return { total, rows };
}

export async function listEightfold(ref: string, http: HttpGet, options: ListOptions): Promise<BoardListing> {
  const match = EIGHTFOLD_REF.exec(ref);
  if (!match) return { kind: "error", detail: "ats_ref con formato inválido" };
  const [, host, domain] = match;
  const origin = `https://${host}`;
  const robots = await readRobots(origin, http);
  if (!isAllowed(robots, "/api/pcsx/search") && !isAllowed(robots, "/api/apply/v2/jobs")) return { kind: "error", detail: "robots.txt no permite la API de búsqueda" };

  let mode: Mode = "pcsx";
  await pause();
  let read = isAllowed(robots, "/api/pcsx/search") ? await readAll(origin, domain, "pcsx", http) : ({ forbidden: true } as const);
  if ("forbidden" in read) {
    mode = "v2";
    if (!isAllowed(robots, "/api/apply/v2/jobs")) return { kind: "error", detail: "robots.txt no permite la API v2" };
    await pause();
    read = await readAll(origin, domain, "v2", http);
    if ("forbidden" in read) return { kind: "error", detail: "Eightfold respondió 403 en ambos modos" };
  }
  if ("error" in read) return { kind: "error", detail: read.error };

  const known = options.knownIds ?? new Set<string>();
  let budget = options.detailBudget ?? 0;
  let deferred = 0;
  const postings: RawAtsPosting[] = [];
  for (const row of read.rows) {
    const base: RawAtsPosting & { detailPath: string } =
      mode === "pcsx"
        ? (() => {
            const position = row as z.infer<typeof Pcsx>;
            const standardized = position.standardizedLocations ?? [];
            const codes = standardized.map(alpha2);
            return {
              externalId: String(position.id),
              title: position.name.trim(),
              applyUrl: `${origin}/careers/job/${position.id}`,
              locationTexts: [...(position.locations ?? []), ...standardized],
              // Only when every location states its country.
              countryCodes: codes.length > 0 && codes.every((code) => code) ? [...new Set(codes as string[])] : [],
              structuredCity: null,
              workplace: workplace(position.workLocationOption),
              descriptionText: null,
              department: text(position.department),
              employmentType: null,
              publishedAt: epoch(position.postedTs),
              validThrough: null,
              companyName: null,
              partial: true,
              detailPath: `/api/pcsx/position_details?position_id=${position.id}&domain=${encodeURIComponent(domain)}&hl=en`
            };
          })()
        : (() => {
            const position = row as z.infer<typeof V2>;
            const canonical = text(position.canonicalPositionUrl);
            return {
              externalId: String(position.id),
              title: position.name.trim(),
              applyUrl: canonical && /^https:\/\//.test(canonical) ? canonical : `${origin}/careers/job/${position.id}`,
              locationTexts: position.locations?.length ? position.locations : [text(position.location) ?? ""].filter(Boolean),
              countryCodes: [],
              structuredCity: null,
              workplace: workplace(position.work_location_option),
              descriptionText: position.job_description ? htmlToText(position.job_description) || null : null,
              department: text(position.department),
              employmentType: null,
              publishedAt: epoch(position.t_create),
              validThrough: null,
              companyName: null,
              partial: !position.job_description,
              detailPath: `/api/apply/v2/jobs/${position.id}?domain=${encodeURIComponent(domain)}`
            };
          })();
    const { detailPath, ...posting } = base;
    if (!/^[0-9A-Za-z_-]{1,40}$/.test(posting.externalId)) return { kind: "error", detail: "id inesperado" };
    if (known.has(posting.externalId) || !posting.partial || !isAllowed(robots, detailPath)) {
      postings.push(posting);
      continue;
    }
    if (budget <= 0) {
      deferred++;
      continue;
    }
    budget--;
    await pause();
    const response = await http(`${origin}${detailPath}`).catch(() => null);
    const raw = response?.status === 200 ? (safeJson(response.body) as Record<string, unknown> | undefined) : undefined;
    // PCSX wraps the position in `data` ({status, error, data, metadata}); v2 does not.
    const body = raw && typeof raw.data === "object" && raw.data !== null ? (raw.data as Record<string, unknown>) : raw;
    const html = typeof body?.jobDescription === "string" ? body.jobDescription : typeof body?.job_description === "string" ? body.job_description : null;
    const description = html ? htmlToText(html) || null : null;
    postings.push({ ...posting, descriptionText: description, partial: description === null });
  }
  return { kind: "complete", boardTotal: read.total, postings, deferred };
}
