import { htmlToText } from "../../lib/ats-text.js";
import { httpUrlOrNull, isoOrNull, type SnapshotDraft } from "./job-snapshot.js";

// AI Resume Studio R2 — schema.org JobPosting from a page's JSON-LD (doc 11
// §5.3 step 3; AGENTS.md source priority «HTML + JSON-LD»). Only the
// <script type="application/ld+json"> blocks are read; the page's visible
// text is never used here. Values are copied as the page states them; a
// field the page doesn't state stays null.

const MAX_BLOCKS = 20;
const MAX_BLOCK_CHARS = 512 * 1024;
const MAX_NODES = 2_000;

function typesOf(node: Record<string, unknown>): string[] {
  const type = node["@type"];
  return (Array.isArray(type) ? type : [type]).filter((value): value is string => typeof value === "string").map((value) => value.replace(/^.*[/#:]/, ""));
}

/** Every JobPosting node in the JSON-LD blocks, @graph and nested arrays included. */
export function findJobPostings(html: string): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const blocks = html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi);
  let seenBlocks = 0;
  for (const block of blocks) {
    if (++seenBlocks > MAX_BLOCKS) break;
    const raw = block[1].trim().replace(/^<!--|-->$/g, "").trim();
    if (!raw || raw.length > MAX_BLOCK_CHARS) continue;
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      // Some sites put raw newlines inside strings; one tolerant retry.
      try {
        data = JSON.parse(raw.replace(/[\r\n\t]+/g, " "));
      } catch {
        continue;
      }
    }
    const stack: unknown[] = [data];
    let visited = 0;
    while (stack.length && visited++ < MAX_NODES) {
      const node = stack.pop();
      if (Array.isArray(node)) {
        stack.push(...node);
      } else if (node && typeof node === "object") {
        const record = node as Record<string, unknown>;
        if (typesOf(record).includes("JobPosting")) found.push(record);
        else if (record["@graph"]) stack.push(record["@graph"]);
        else if (record.mainEntity) stack.push(record.mainEntity);
        else if (record.itemListElement) stack.push(record.itemListElement);
        else if (record.item) stack.push(record.item);
      }
    }
  }
  return found;
}

function str(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number") return String(value);
  return null;
}

function nameOf(value: unknown): string | null {
  if (Array.isArray(value)) return nameOf(value[0]);
  if (value && typeof value === "object") return str((value as Record<string, unknown>).name);
  return str(value);
}

function locationOf(value: unknown): string | null {
  const places = (Array.isArray(value) ? value : [value]).slice(0, 5);
  const labels = places
    .map((place) => {
      if (!place || typeof place !== "object") return str(place);
      const address = (place as Record<string, unknown>).address;
      if (!address || typeof address !== "object") return str(address) ?? nameOf(place);
      const a = address as Record<string, unknown>;
      const parts = [str(a.addressLocality), str(a.addressRegion), nameOf(a.addressCountry)].filter((part): part is string => part !== null);
      return parts.length ? [...new Set(parts)].join(", ") : null;
    })
    .filter((label): label is string => label !== null);
  return labels.length ? [...new Set(labels)].join(" · ") : null;
}

const PERIODS: Record<string, "HOUR" | "DAY" | "WEEK" | "MONTH" | "YEAR"> = { HOUR: "HOUR", DAY: "DAY", WEEK: "WEEK", MONTH: "MONTH", YEAR: "YEAR" };

function num(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value.replace(/[^\d.]/g, "")) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function salaryOf(value: unknown): SnapshotDraft["salary"] {
  if (!value || typeof value !== "object") return null;
  const salary = value as Record<string, unknown>;
  const amount = (salary.value && typeof salary.value === "object" ? salary.value : salary) as Record<string, unknown>;
  const min = num(amount.minValue ?? amount.value);
  const max = num(amount.maxValue ?? amount.value);
  if (min === null && max === null) return null;
  const currency = str(salary.currency)?.toUpperCase() ?? null;
  const unit = str(amount.unitText)?.toUpperCase() ?? null;
  return {
    min,
    max,
    currency: currency && /^[A-Z]{3}$/.test(currency) ? currency : null,
    period: unit ? (PERIODS[unit] ?? null) : null
  };
}

function remoteOf(posting: Record<string, unknown>): SnapshotDraft["remote"] {
  const type = JSON.stringify(posting.jobLocationType ?? "").toUpperCase();
  return type.includes("TELECOMMUTE") ? "remote" : null;
}

function employmentOf(value: unknown): string | null {
  const list = (Array.isArray(value) ? value : [value]).map(str).filter((entry): entry is string => entry !== null);
  return list.length ? list.join(", ") : null;
}

function textOf(value: unknown): string | null {
  const raw = str(value);
  return raw ? htmlToText(raw) || null : null;
}

/** The first usable JobPosting on the page as a snapshot draft, or null. */
export function jobPostingFromHtml(html: string): Partial<SnapshotDraft> | null {
  for (const posting of findJobPostings(html)) {
    const title = textOf(posting.title) ?? textOf(posting.name);
    const sections = [posting.description, posting.responsibilities, posting.qualifications, posting.skills, posting.experienceRequirements, posting.educationRequirements]
      .map((value) => (Array.isArray(value) ? value.map(textOf).filter(Boolean).join("\n") : textOf(value && typeof value === "object" ? (value as Record<string, unknown>).description ?? null : value)))
      .filter((value): value is string => Boolean(value));
    const description = [...new Set(sections)].join("\n\n") || null;
    if (!title || !description) continue;
    return {
      title,
      description,
      company: nameOf(posting.hiringOrganization),
      location: locationOf(posting.jobLocation),
      remote: remoteOf(posting),
      employmentType: employmentOf(posting.employmentType),
      datePosted: isoOrNull(posting.datePosted),
      validThrough: isoOrNull(posting.validThrough),
      salary: salaryOf(posting.baseSalary),
      applyUrl: httpUrlOrNull(posting.url)
    };
  }
  return null;
}
