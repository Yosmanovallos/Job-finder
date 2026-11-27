import { jobPostingFromMicrodata } from "./microdata.js";
import { jobPostingFromPageText } from "./page-text.js";
import type { AtsRead } from "./ats.js";
import { jobPostingFromHtml } from "./jsonld.js";
import { buildSnapshot, cleanExternalText, SNAPSHOT_TEXT_MAX, SNAPSHOT_TITLE_MAX, type JobSnapshot, type SnapshotDraft, type SnapshotVia } from "./job-snapshot.js";
import { canonicalizeJobUrl, classifyLink, urlKey, type AtsPostingRef } from "./link-kind.js";
import { SafeFetchError, type SafeFetchResult } from "./safe-fetch.js";

// AI Resume Studio R2 — link → JobSnapshot, in the fixed order of doc 11
// §5.3 (AGENTS.md source priority). No LLM: when nothing structured is
// found the answer is «pega la descripción» (R3 will add the LLM step there).
// Every dependency is injected, so the order and the fallbacks are tested
// without a network or a database.

export type PasteReason =
  | "linkedin" // LinkedIn §8.2: never fetched
  | "login_wall" // known login/anti-bot site, or 401/403, or a redirect to a login page
  | "anti_bot" // a challenge page came back
  | "robots" // robots.txt says no
  | "no_structured_data" // page read, no usable JobPosting
  | "not_found" // 404/410, or the ATS says it doesn't exist
  | "fetch_failed"; // timeout, too large, not HTML, network

export type JobLinkResult =
  | { status: "resolved"; snapshot: JobSnapshot; cached: boolean }
  | { status: "paste_required"; reason: PasteReason; sourceUrl: string; canonicalUrl: string | null }
  | { status: "invalid"; reason: "invalid_url" | "not_public" };

export interface ResolverDeps {
  ourJobDraft(jobId: string): Promise<Partial<SnapshotDraft> | null>;
  findJobIdByUrl(url: string): Promise<string | null>;
  findSameJob(company: string, title: string): Promise<string | null>;
  getCached(key: string): Promise<JobSnapshot | null>;
  putCached(key: string, snapshot: JobSnapshot): Promise<void>;
  readAts(ref: AtsPostingRef): Promise<AtsRead>;
  fetchHtml(url: string): Promise<SafeFetchResult>;
  now?(): Date;
}

const LOGIN_PATH = /\/(login|log-in|signin|sign-in|sign_in|auth|authwall|account\/login|cuenta\/ingresar|ingresar|iniciar-sesion|registro)(\/|$|\?)/i;
const CHALLENGE = /cf-chl-|challenge-platform|cf_chl_opt|captcha-delivery|px-captcha|g-recaptcha|h-captcha|hcaptcha\.com|_incapsula_|datadome/i;

function pasteRequired(reason: PasteReason, sourceUrl: string, canonicalUrl: string | null): JobLinkResult {
  return { status: "paste_required", reason, sourceUrl, canonicalUrl };
}

export async function resolveJobLink(rawUrl: string, deps: ResolverDeps): Promise<JobLinkResult> {
  const sourceUrl = rawUrl.trim().slice(0, 2000);
  const canonicalUrl = canonicalizeJobUrl(sourceUrl);
  const kind = canonicalUrl ? classifyLink(sourceUrl) : null;
  if (!canonicalUrl || !kind) return { status: "invalid", reason: "invalid_url" };
  const now = deps.now?.() ?? new Date();
  const snapshotOf = (draft: Partial<SnapshotDraft> | null, via: SnapshotVia) =>
    draft ? buildSnapshot(draft, { via, sourceUrl, canonicalUrl, now }) : null;

  // 4. LinkedIn and login/anti-bot sites: nothing is downloaded.
  if (kind.kind === "paste_only") return pasteRequired(kind.reason, sourceUrl, canonicalUrl);

  // 1. Our own vacancy page: our base, same masking as the public page. Not cached (always fresh).
  if (kind.kind === "buscotrabajo") {
    const snapshot = snapshotOf(await deps.ourJobDraft(kind.jobId), "buscotrabajo");
    return snapshot ? { status: "resolved", snapshot, cached: false } : pasteRequired("not_found", sourceUrl, canonicalUrl);
  }

  // 5. 24 h cache by canonical URL.
  const key = urlKey(canonicalUrl);
  const cached = await deps.getCached(key);
  if (cached) return { status: "resolved", snapshot: { ...cached, sourceUrl }, cached: true };
  const done = async (snapshot: JobSnapshot): Promise<JobLinkResult> => {
    await deps.putCached(key, snapshot);
    return { status: "resolved", snapshot, cached: false };
  };

  // 1b. A page we already stored (Computrabajo, Elempleo, Magneto, ATS…): no request to the site.
  const knownId = (await deps.findJobIdByUrl(sourceUrl)) ?? (canonicalUrl !== sourceUrl ? await deps.findJobIdByUrl(canonicalUrl) : null);
  if (knownId) {
    const snapshot = snapshotOf(await deps.ourJobDraft(knownId), "our_index");
    if (snapshot) return done(snapshot);
  }

  // 2. Public ATS API for this exact posting.
  if (kind.kind === "ats") {
    const read = await deps.readAts(kind.ref);
    if (read.kind === "found") {
      const snapshot = snapshotOf(read.draft, kind.ref.ats);
      if (snapshot) return done(snapshot);
    }
    if (read.kind === "not_found") return pasteRequired("not_found", sourceUrl, canonicalUrl);
    // An API error falls through to the posting's public page (JSON-LD).
  }

  // 3. Any other site: SSRF-safe GET → JobPosting JSON-LD.
  let page: SafeFetchResult;
  try {
    page = await deps.fetchHtml(sourceUrl);
  } catch (error) {
    if (error instanceof SafeFetchError) {
      if (["blocked_scheme", "blocked_port", "blocked_credentials", "blocked_host", "blocked_address"].includes(error.code)) {
        return { status: "invalid", reason: "not_public" };
      }
      if (error.code === "invalid_url") return { status: "invalid", reason: "invalid_url" };
      if (error.code === "robots_disallowed") return pasteRequired("robots", sourceUrl, canonicalUrl);
    }
    return pasteRequired("fetch_failed", sourceUrl, canonicalUrl);
  }
  if (page.status === 401 || page.status === 403 || page.status === 407) return pasteRequired("login_wall", sourceUrl, canonicalUrl);
  if (page.status === 404 || page.status === 410) return pasteRequired("not_found", sourceUrl, canonicalUrl);
  if (page.status < 200 || page.status >= 300) return pasteRequired("fetch_failed", sourceUrl, canonicalUrl);
  if (LOGIN_PATH.test(new URL(page.finalUrl).pathname)) return pasteRequired("login_wall", sourceUrl, canonicalUrl);
  const snapshot = snapshotOf(jobPostingFromHtml(page.body), "jsonld");
  if (snapshot) return done(snapshot);
  // R4d: the same schema.org JobPosting written as microdata (SAP SuccessFactors…).
  const micro = snapshotOf(jobPostingFromMicrodata(page.body), "microdata");
  if (micro) return done(micro);
  // R4d: last automatic try, the page's visible text when it clearly reads like a vacancy.
  if (!CHALLENGE.test(page.body)) {
    const visible = snapshotOf(jobPostingFromPageText(page.body), "page_text");
    if (visible) return done(visible);
  }
  return pasteRequired(CHALLENGE.test(page.body) ? "anti_bot" : "no_structured_data", sourceUrl, canonicalUrl);
}

export interface PastedJob {
  url?: string | null;
  title: string;
  company?: string | null;
  text: string;
}

export const PASTE_TEXT_MIN = 80;

export type PasteResult =
  | { status: "resolved"; snapshot: JobSnapshot; matched: boolean }
  | { status: "invalid"; reason: "title_required" | "text_too_short" | "invalid_url" };

/**
 * The «pega la descripción» path. With company + title, we first look for
 * THE SAME vacancy in our base (exact match); if it's there its structured
 * version is used. Otherwise the pasted text becomes the snapshot. Pasted
 * text is never cached and never shared between users.
 */
export async function resolvePastedJob(input: PastedJob, deps: Pick<ResolverDeps, "findSameJob" | "ourJobDraft" | "now">): Promise<PasteResult> {
  const now = deps.now?.() ?? new Date();
  const title = cleanExternalText(input.title, SNAPSHOT_TITLE_MAX)?.replace(/\n/g, " ") ?? null;
  const company = cleanExternalText(input.company ?? null, 200)?.replace(/\n/g, " ") ?? null;
  const text = cleanExternalText(input.text, SNAPSHOT_TEXT_MAX);
  if (!title) return { status: "invalid", reason: "title_required" };
  if (!text || text.length < PASTE_TEXT_MIN) return { status: "invalid", reason: "text_too_short" };
  let sourceUrl: string | null = null;
  let canonicalUrl: string | null = null;
  if (input.url && input.url.trim()) {
    canonicalUrl = canonicalizeJobUrl(input.url);
    if (!canonicalUrl) return { status: "invalid", reason: "invalid_url" };
    sourceUrl = input.url.trim().slice(0, 2000);
  }
  if (company) {
    const id = await deps.findSameJob(company, title);
    const draft = id ? await deps.ourJobDraft(id) : null;
    const snapshot = draft ? buildSnapshot(draft, { via: "our_index", sourceUrl, canonicalUrl, now }) : null;
    if (snapshot) return { status: "resolved", snapshot, matched: true };
  }
  const snapshot = buildSnapshot({ title, company, description: text }, { via: "pasted", sourceUrl, canonicalUrl, now });
  if (!snapshot) return { status: "invalid", reason: "text_too_short" };
  return { status: "resolved", snapshot, matched: false };
}
