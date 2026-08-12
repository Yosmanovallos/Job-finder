import { extractStructuredFromHtml, htmlEntities } from "../utils.js";
import { JobDetail } from "../sources/types.js";

// Google for Jobs requires site owners to embed a schema.org `JobPosting`
// <script type="application/ld+json"> block on every job detail page — a
// widely-adopted SEO standard, not something specific to one source. This
// project's own src/lib/job-seo.ts emits the exact same schema for
// BuscoTrabajo's own job pages. Confirmed live (2026-08-11) present on both
// Computrabajo and Magneto detail pages with real description/employmentType/
// baseSalary/skills — reused here as ONE parser instead of a bespoke scraper
// per source, since any source implementing this standard needs no
// source-specific HTML/CSS-selector work at all.
const SCHEMA_EMPLOYMENT_TYPE_LABELS: Record<string, string> = {
  FULL_TIME: "Tiempo completo",
  PART_TIME: "Medio tiempo",
  CONTRACTOR: "Contrato",
  TEMPORARY: "Temporal",
  INTERN: "Prácticas",
  VOLUNTEER: "Voluntariado",
  PER_DIEM: "Por día"
  // OTHER deliberately unmapped — not informative enough to show as a badge.
};

function findJobPostingNode(html: string): any | null {
  const scripts = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const raw of scripts) {
    const content = raw.replace(/<script[^>]*>/i, "").replace(/<\/script>/i, "").trim();
    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch {
      continue;
    }
    const nodes: any[] = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.["@graph"]) ? parsed["@graph"] : [parsed];
    for (const node of nodes) {
      if (node && node["@type"] === "JobPosting") return node;
    }
  }
  return null;
}

/**
 * Parses a JobPosting node's fields into the same JobDetail shape every
 * other detail fetcher produces. Only reads fields the node actually has —
 * a source that omits baseSalary/skills simply doesn't get those fields,
 * never a guessed fallback.
 */
function buildJobDetail(node: any): Partial<JobDetail> {
  const detail: Partial<JobDetail> = {};

  if (typeof node.description === "string" && node.description.trim()) {
    // Confirmed live (2026-08-11): LinkedIn's description is HTML-entity-
    // escaped INSIDE the JSON string (literal "&lt;p&gt;", not "<p>") —
    // Computrabajo/Magneto's JSON already contains real "<br/>"/"<li>"
    // characters (a JSON < escape, resolved by JSON.parse itself, not
    // an HTML entity). Decoding entities first is a no-op for the latter
    // and reveals the real tags for the former, so it's safe to apply
    // unconditionally rather than branching per source.
    const decoded = htmlEntities(node.description);
    const { description, requirements } = extractStructuredFromHtml(decoded);
    if (description) detail.description = description;
    if (requirements.length > 0) detail.requirements = requirements;
  }

  if (typeof node.skills === "string" && node.skills.trim()) {
    // Confirmed live: Magneto's `skills` is a comma-separated string, not
    // an array (e.g. "COMUNICATIVAS,OPERATIVAS").
    detail.technologies = node.skills
      .split(/[,;]/)
      .map((s: string) => s.trim())
      .filter(Boolean);
  } else if (Array.isArray(node.skills)) {
    const skills = node.skills.filter((s: unknown): s is string => typeof s === "string" && s.trim().length > 0);
    if (skills.length > 0) detail.technologies = skills;
  }

  if (typeof node.employmentType === "string") {
    // Confirmed live: Computrabajo/Magneto use the schema.org enum literally
    // ("FULL_TIME"), WeRemoto uses human-readable spacing ("Full Time") —
    // normalizing spaces to underscores covers both against the same map.
    const key = node.employmentType.trim().toUpperCase().replace(/\s+/g, "_");
    const label = SCHEMA_EMPLOYMENT_TYPE_LABELS[key];
    if (label) detail.employmentType = label;
  }

  const salaryValue = node.baseSalary?.value;
  if (salaryValue && typeof salaryValue === "object") {
    // Different sites shape this differently (confirmed live: Computrabajo
    // uses a single `value`, Magneto uses `minValue`/`maxValue`) — read
    // whichever is actually present rather than assuming one shape.
    const rawMin = typeof salaryValue.minValue === "number" ? salaryValue.minValue : typeof salaryValue.value === "number" ? salaryValue.value : undefined;
    const rawMax = typeof salaryValue.maxValue === "number" ? salaryValue.maxValue : typeof salaryValue.value === "number" ? salaryValue.value : undefined;
    // Bug real encontrado y corregido 2026-08-12: Magneto's JobPosting JSON-LD
    // literally returned `maxValue: 0` (confirmed live, "Jefe De Tienda Ara"
    // posting) while minValue was a real number — same "0 = not specified"
    // sentinel src/index.ts's RemoteOK fetcher already guards against, just
    // not previously applied here. An unguarded 0 rendered as a nonsensical
    // "COP 3,176,000 – 0" badge.
    const min = typeof rawMin === "number" && rawMin > 0 ? rawMin : undefined;
    const max = typeof rawMax === "number" && rawMax > 0 ? rawMax : undefined;
    if (min != null) detail.salaryMin = min;
    if (max != null) detail.salaryMax = max;
  }
  const currency = node.baseSalary?.currency || node.salaryCurrency;
  if (typeof currency === "string" && currency.trim()) detail.salaryCurrency = currency.trim();

  return detail;
}

/**
 * Extracts JobDetail from a detail page's own HTML via its embedded
 * JobPosting JSON-LD, if any. Fetching is deliberately the caller's job —
 * each source needs its own request technique (Computrabajo's translate.goog
 * proxy vs Magneto's direct fetch vs a Cloudflare-aware fetcher elsewhere) —
 * this function only ever parses, so it stays reusable across all of them.
 * Returns null (not a partial guess) when the page has no such block, or
 * none of its fields parsed into anything usable — callers treat null
 * exactly like "this source has no detail for this job."
 */
export function extractJobPostingDetail(html: string): Partial<JobDetail> | null {
  if (!html) return null;
  const node = findJobPostingNode(html);
  if (!node) return null;

  const detail = buildJobDetail(node);
  return Object.keys(detail).length > 0 ? detail : null;
}

function extractLocationLabel(node: any): string | undefined {
  // schema.org's own documented pattern for a fully-remote posting: no
  // `jobLocation` at all, `jobLocationType: "TELECOMMUTE"` instead —
  // confirmed live on WeRemoto. "Remoto" matches the pseudo-city convention
  // every other source already uses (see job-filters.ts CITY_OPTIONS).
  if (node.jobLocationType === "TELECOMMUTE") return "Remoto";

  const address = node.jobLocation?.address;
  if (address && typeof address === "object") {
    const parts = [address.addressLocality, address.addressRegion].filter(
      (p): p is string => typeof p === "string" && p.trim().length > 0
    );
    if (parts.length > 0) return parts.join(", ");
  }

  const applicantCountry = node.applicantLocationRequirements?.name;
  if (typeof applicantCountry === "string" && applicantCountry.trim()) return applicantCountry.trim();

  return undefined;
}

export interface FullJobPosting extends Partial<JobDetail> {
  title?: string;
  company?: string;
  location?: string;
}

/**
 * Like extractJobPostingDetail, but also reads title/hiringOrganization/
 * location off the node — for sources where the JobPosting page IS the
 * only place the job's basic identity lives too (WeRemoto: its sitemap
 * gives a URL and a timestamp, nothing else — every field comes from this
 * one fetch). Computrabajo/Magneto/LinkedIn don't need this: their search
 * results already carry title/company/location, so extractJobPostingDetail
 * (detail fields only) is the right function there.
 */
export function extractFullJobPosting(html: string): FullJobPosting | null {
  if (!html) return null;
  const node = findJobPostingNode(html);
  if (!node) return null;

  const result: FullJobPosting = buildJobDetail(node);
  if (typeof node.title === "string" && node.title.trim()) result.title = node.title.trim();
  if (typeof node.hiringOrganization?.name === "string" && node.hiringOrganization.name.trim()) {
    result.company = node.hiringOrganization.name.trim();
  }
  const location = extractLocationLabel(node);
  if (location) result.location = location;

  return result.title ? result : null;
}
