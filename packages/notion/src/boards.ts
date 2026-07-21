// Remote job boards → CanonicalJob, for projection into the "Vacantes" Notion
// board. Compliant access only (verified robots.txt 2026-07-19, AGENTS.md r.8):
//   RemoteOK  → public JSON API (robots: User-agent:* Allow:/). Attribution required.
//   Remotive  → public category RSS feeds (/api is disallowed; RSS is not).
//   WWR       → public RSS feed (docs: "attribute the links back").
// External text is untrusted (r.6): stored as data, never drives tool calls.
// Fields the source does not state stay null/unknown (r.5).
import { createHash } from "node:crypto";
import { CanonicalJobSchema, type CanonicalJob } from "@job-radar/domain";
import { normalizeTitle } from "@job-radar/matching";

const UA = "job-radar-local (+contact: yosmanovallos123@gmail.com)";

/** Deterministic UUIDv5 (stable id ⇒ idempotent Notion "Job ID"). */
const NS = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
function uuidv5(name: string): string {
  const ns = Buffer.from(NS.replace(/-/g, ""), "hex");
  const hash = createHash("sha1")
    .update(Buffer.concat([ns, Buffer.from(name, "utf8")]))
    .digest();
  const b = hash.subarray(0, 16);
  b[6] = (b[6]! & 0x0f) | 0x50;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = b.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&nbsp;/g, " ");
}

function stripHtml(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function isoOrNull(raw: string | null): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// QA / testing / AI keywords used to keep only relevant postings.
const KEYWORDS = [
  "qa",
  "quality assurance",
  "tester",
  "test engineer",
  "test automation",
  "automation engineer",
  "sdet",
  "manual test",
  "software testing",
  "machine learning",
  "ml engineer",
  "mlops",
  "ai engineer",
  "artificial intelligence",
  "deep learning",
  "llm",
  "prompt engineer",
  "data scientist",
  "computer vision",
  "nlp"
];
function matchesQaAi(text: string): string[] {
  const t = text.toLowerCase();
  return KEYWORDS.filter((k) => {
    // Bare "qa"/"ml"/"ai" only as whole words to avoid substring noise.
    if (k.length <= 3) return new RegExp(`\\b${k}\\b`).test(t);
    return t.includes(k);
  });
}

export interface BuildInput {
  source: string;
  externalId: string;
  url: string;
  title: string;
  company: string;
  descriptionText: string;
  tags: string[];
  location: string | null;
  publishedAt: string | null;
  expiresAt: string | null;
  compMin: number | null;
  compMax: number | null;
  compCurrency: string | null;
  /** Source-stated employment type, verbatim. null when the source omits it. */
  employmentType: string | null;
  extractionMethod: CanonicalJob["extractionMethod"];
  now: string;
}

/**
 * Normalizes the source-stated employment type to a stable vocabulary.
 * Returns [] for null/unrecognized input rather than guessing — an unmapped
 * value must not become a fabricated job fact (regla 5).
 */
export function normalizeEmploymentType(raw: string | null): string[] {
  if (!raw) return [];
  const key = raw.toLowerCase().replace(/[\s_-]+/g, "");
  const map: Record<string, string> = {
    fulltime: "full_time",
    parttime: "part_time",
    contract: "contract",
    contractor: "contract",
    freelance: "freelance",
    temporary: "temporary",
    internship: "internship",
    intern: "internship"
  };
  const mapped = map[key];
  return mapped ? [mapped] : [];
}

/** Builds a schema-valid CanonicalJob; never invents unstated facts. */
export function buildCanonicalJob(input: BuildInput): CanonicalJob {
  const url = input.url;
  const hasComp = input.compMin !== null || input.compMax !== null;
  // Stateless bridge (no Postgres): anchor seen/verified to the posting's own
  // date so re-runs are idempotent (unchanged content ⇒ identical syncHash ⇒
  // no-op). The real last-run time is shown by Notion's "Actualizado por sistema".
  const seen = input.publishedAt ?? input.now;
  const job: CanonicalJob = {
    id: uuidv5(`${input.source}:${input.externalId}`),
    sourceId: input.source,
    sourceJobId: input.externalId,
    sourceUrl: url,
    canonicalUrl: url,
    applyUrl: url,
    titleRaw: input.title,
    titleNormalized: normalizeTitle(input.title),
    titleFamily: null,
    seniority: "unknown",
    companyNameRaw: input.company,
    companyId: null,
    companyNameNormalized: input.company.toLowerCase().trim(),
    companyDomain: null,
    descriptionText: input.descriptionText,
    responsibilities: [],
    requiredSkills: input.tags.slice(0, 30),
    preferredSkills: [],
    requiredExperienceYears: null,
    educationRequirements: [],
    languageRequirements: [],
    locations: input.location
      ? [{ raw: input.location, city: null, region: null, countryCode: null }]
      : [],
    // These boards are remote-only by design (source-stated, not inferred).
    workMode: "remote",
    remoteRegion: input.location,
    employmentTypes: normalizeEmploymentType(input.employmentType),
    compensation: {
      min: input.compMin,
      max: input.compMax,
      currency: input.compCurrency,
      period: hasComp ? "year" : null,
      source: hasComp ? "estimated" : "unknown"
    },
    visaSponsorship: "unknown",
    publishedAt: input.publishedAt,
    expiresAt: input.expiresAt,
    firstSeenAt: seen,
    lastSeenAt: seen,
    lastVerifiedAt: seen,
    status: "active",
    extractionMethod: input.extractionMethod,
    extractionConfidence: input.extractionMethod === "api" ? 0.8 : 0.7,
    contentHash: createHash("sha256")
      .update(`${input.title}|${input.company}|${input.descriptionText}`)
      .digest("hex"),
    evidence: [
      { field: "title", quote: input.title.slice(0, 200), sourceUrl: url },
      { field: "workMode", quote: `${input.source}: remote-only job board`, sourceUrl: url }
    ]
  };
  return CanonicalJobSchema.parse(job);
}

// ---- RSS helpers ---------------------------------------------------------

function items(xml: string): string[] {
  return [...xml.matchAll(/<item\b[\s\S]*?<\/item>/g)].map((m) => m[0]);
}
function tag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? decodeEntities(m[1]!).trim() : null;
}

async function getText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "application/xml, application/json" }
  });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.text();
}

// ---- RemoteOK (JSON API) -------------------------------------------------

interface RemoteOkJob {
  id?: string;
  slug?: string;
  position?: string;
  company?: string;
  tags?: string[];
  description?: string;
  location?: string;
  url?: string;
  apply_url?: string;
  date?: string;
  salary_min?: number;
  salary_max?: number;
}

export async function fetchRemoteOk(now: string): Promise<CanonicalJob[]> {
  const raw = JSON.parse(await getText("https://remoteok.com/api")) as RemoteOkJob[];
  const out: CanonicalJob[] = [];
  for (const j of raw) {
    if (!j.id || !j.position || !j.url) continue; // skip legal-notice element
    const tags = (j.tags ?? []).map((t) => String(t));
    const hay = `${j.position} ${tags.join(" ")} ${stripHtml(j.description ?? "")}`;
    if (matchesQaAi(hay).length === 0) continue;
    const min = typeof j.salary_min === "number" && j.salary_min > 0 ? j.salary_min : null;
    const max = typeof j.salary_max === "number" && j.salary_max > 0 ? j.salary_max : null;
    out.push(
      buildCanonicalJob({
        source: "RemoteOK",
        externalId: j.id,
        url: j.url,
        title: j.position,
        company: j.company ?? "(empresa no indicada)",
        descriptionText: stripHtml(j.description ?? ""),
        tags,
        location: j.location && j.location.trim() ? j.location.trim() : null,
        publishedAt: isoOrNull(j.date ?? null),
        expiresAt: null,
        compMin: min,
        compMax: max,
        compCurrency: min || max ? "USD" : null,
        // RemoteOK exposes no contract-type field: neither the flat API nor the
        // tags carry it (verified 2026-07-20, 0/303 sampled). Left null rather
        // than a second fetch per job for a signal that isn't there.
        employmentType: null,
        extractionMethod: "api",
        now
      })
    );
  }
  return out;
}

// ---- Remotive (category RSS) ---------------------------------------------

const REMOTIVE_CATEGORIES = ["qa", "artificial-intelligence", "software-development"];

export async function fetchRemotive(now: string): Promise<CanonicalJob[]> {
  const out: CanonicalJob[] = [];
  const seen = new Set<string>();
  for (const cat of REMOTIVE_CATEGORIES) {
    let xml: string;
    try {
      xml = await getText(`https://remotive.com/remote-jobs/${cat}/feed`);
    } catch {
      continue;
    }
    for (const block of items(xml)) {
      const link = tag(block, "link") ?? tag(block, "guid");
      const title = tag(block, "title");
      if (!link || !title) continue;
      const jobId = tag(block, "jobId") ?? link;
      if (seen.has(jobId)) continue;
      const description = stripHtml(tag(block, "description") ?? "");
      const category = tag(block, "category") ?? "";
      // software-development is broad: keep only QA/AI-relevant ones.
      if (cat === "software-development" && matchesQaAi(`${title} ${description}`).length === 0)
        continue;
      seen.add(jobId);
      out.push(
        buildCanonicalJob({
          source: "Remotive",
          externalId: jobId,
          url: link,
          title,
          company: tag(block, "company") ?? "(empresa no indicada)",
          descriptionText: description,
          tags: category ? [category] : [],
          location: tag(block, "location"),
          publishedAt: isoOrNull(tag(block, "pubDate")),
          expiresAt: null,
          compMin: null,
          compMax: null,
          compCurrency: null,
          employmentType: tag(block, "type"),
          extractionMethod: "api",
          now
        })
      );
    }
  }
  return out;
}

// ---- We Work Remotely (general RSS) --------------------------------------

export async function fetchWwr(now: string): Promise<CanonicalJob[]> {
  const xml = await getText("https://weworkremotely.com/remote-jobs.rss");
  const out: CanonicalJob[] = [];
  for (const block of items(xml)) {
    const link = tag(block, "link") ?? tag(block, "guid");
    const rawTitle = tag(block, "title");
    if (!link || !rawTitle) continue;
    const description = stripHtml(tag(block, "description") ?? "");
    if (matchesQaAi(`${rawTitle} ${description}`).length === 0) continue;
    // WWR titles are "Company: Position"; split on the first ": ".
    const idx = rawTitle.indexOf(": ");
    const company = idx > 0 ? rawTitle.slice(0, idx) : "(empresa no indicada)";
    const title = idx > 0 ? rawTitle.slice(idx + 2) : rawTitle;
    const region = tag(block, "region");
    out.push(
      buildCanonicalJob({
        source: "We Work Remotely",
        externalId: link,
        url: link,
        title,
        company,
        descriptionText: description,
        tags: tag(block, "category") ? [tag(block, "category")!] : [],
        location: region,
        publishedAt: isoOrNull(tag(block, "pubDate")),
        expiresAt: isoOrNull(tag(block, "expires_at")),
        compMin: null,
        compMax: null,
        compCurrency: null,
        employmentType: tag(block, "type"),
        extractionMethod: "api",
        now
      })
    );
  }
  return out;
}

export async function fetchAllBoards(now: string): Promise<{
  jobs: CanonicalJob[];
  perSource: Record<string, number>;
  errors: { source: string; error: string }[];
}> {
  const errors: { source: string; error: string }[] = [];
  const perSource: Record<string, number> = {};
  const jobs: CanonicalJob[] = [];
  const fetchers: [string, (n: string) => Promise<CanonicalJob[]>][] = [
    ["RemoteOK", fetchRemoteOk],
    ["Remotive", fetchRemotive],
    ["We Work Remotely", fetchWwr]
  ];
  for (const [name, fn] of fetchers) {
    try {
      const result = await fn(now);
      perSource[name] = result.length;
      jobs.push(...result);
    } catch (e) {
      errors.push({ source: name, error: e instanceof Error ? e.message : String(e) });
      perSource[name] = 0;
    }
  }
  return { jobs, perSource, errors };
}
