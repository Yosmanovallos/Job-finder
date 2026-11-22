import { createHash } from "node:crypto";

// AI Resume Studio R2 — what a pasted link is, before anything is fetched
// (doc 11 §5.3). Pure functions: no network, no database.

const TRACKING_PARAMS = /^(utm_[a-z]+|fbclid|gclid|gbraid|wbraid|msclkid|mc_cid|mc_eid|_hsenc|_hsmi|igshid|yclid|ref_src|trk|trackingid)$/i;

/** One stable key per vacancy page: lower-case host, no tracking, sorted query, no fragment. */
export function canonicalizeJobUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  url.hash = "";
  url.username = "";
  url.password = "";
  url.hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";
  const kept = [...url.searchParams.entries()].filter(([key]) => !TRACKING_PARAMS.test(key)).sort(([a], [b]) => a.localeCompare(b));
  url.search = "";
  for (const [key, value] of kept) url.searchParams.append(key, value);
  // http and https of the same page are one vacancy.
  url.protocol = "https:";
  const text = url.toString();
  return text.length <= 2000 ? text : null;
}

export function urlKey(canonicalUrl: string): string {
  return createHash("sha256").update(canonicalUrl, "utf8").digest("hex");
}

export type AtsPostingRef =
  | { ats: "greenhouse"; board: string; id: string }
  | { ats: "lever"; board: string; id: string }
  | { ats: "ashby"; board: string; id: string };

export type LinkKind =
  | { kind: "buscotrabajo"; jobId: string }
  | { kind: "ats"; ref: AtsPostingRef }
  | { kind: "paste_only"; reason: "linkedin" | "login_wall" }
  | { kind: "web" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BOARD = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

function hostIs(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

// Sites whose terms forbid automated reading, that need an account, or
// that answer bots with a challenge: nothing is downloaded (AGENTS.md rule 8;
// LinkedIn User Agreement §8.2). The user pastes the text instead.
const LOGIN_WALL_DOMAINS = ["indeed.com", "glassdoor.com", "glassdoor.com.co", "facebook.com", "fb.com", "instagram.com", "x.com", "twitter.com", "tiktok.com", "whatsapp.com", "wa.me", "t.me", "docs.google.com", "forms.gle", "drive.google.com"];

export function classifyLink(raw: string): LinkKind | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const segments = url.pathname.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment));

  if (host === "buscotrabajo.co" || host === "www.buscotrabajo.co") {
    const base = segments[0] === "ve" ? segments.slice(1) : segments;
    if (base[0] === "empleos" && base[1] && UUID.test(base[1])) return { kind: "buscotrabajo", jobId: base[1].toLowerCase() };
    return { kind: "web" };
  }
  if (hostIs(host, "linkedin.com") || host === "lnkd.in") return { kind: "paste_only", reason: "linkedin" };
  if (LOGIN_WALL_DOMAINS.some((domain) => hostIs(host, domain)) || /(^|\.)indeed\.[a-z.]+$/.test(host)) {
    return { kind: "paste_only", reason: "login_wall" };
  }

  // Greenhouse: boards.greenhouse.io/{board}/jobs/{id}, job-boards(.eu).greenhouse.io/…,
  // and the embed form …/embed/job_app?for={board}&token={id}.
  if (/^(boards|job-boards)(\.eu)?\.greenhouse\.io$/.test(host)) {
    if (segments[0] === "embed") {
      const board = url.searchParams.get("for");
      const id = url.searchParams.get("token") ?? url.searchParams.get("gh_jid");
      if (board && BOARD.test(board) && id && /^\d{1,20}$/.test(id)) return { kind: "ats", ref: { ats: "greenhouse", board: board.toLowerCase(), id } };
    } else if (segments[0] && BOARD.test(segments[0]) && segments[1] === "jobs" && /^\d{1,20}$/.test(segments[2] ?? "")) {
      return { kind: "ats", ref: { ats: "greenhouse", board: segments[0].toLowerCase(), id: segments[2] } };
    }
    return { kind: "web" };
  }
  // jobs.eu.lever.co lives behind api.eu.lever.co: read as a web page (JSON-LD).
  if (host === "jobs.lever.co") {
    if (segments[0] && BOARD.test(segments[0]) && UUID.test(segments[1] ?? "")) {
      return { kind: "ats", ref: { ats: "lever", board: segments[0].toLowerCase(), id: segments[1].toLowerCase() } };
    }
    return { kind: "web" };
  }
  if (host === "jobs.ashbyhq.com") {
    if (segments[0] && BOARD.test(segments[0]) && UUID.test(segments[1] ?? "")) {
      return { kind: "ats", ref: { ats: "ashby", board: segments[0], id: segments[1].toLowerCase() } };
    }
    return { kind: "web" };
  }
  // SmartRecruiters: its API host's robots.txt says Disallow: / (ADR 0002,
  // root docs/adr), so the pipeline keeps that adapter opt-in. A user's link
  // goes the web way instead: robots.txt of jobs.smartrecruiters.com, then
  // the page's JSON-LD.
  return { kind: "web" };
}
