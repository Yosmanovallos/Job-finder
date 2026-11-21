import { z } from "zod";
import { ashby, greenhouse, lever, SmartRecruitersPage, smartRecruitersPosting, type RawAtsPosting } from "../../lib/ats-posting-parsers.js";
import { htmlToText, safeJson } from "../../lib/ats-text.js";
import { httpUrlOrNull, type SnapshotDraft } from "./job-snapshot.js";
import type { AtsPostingRef } from "./link-kind.js";

// AI Resume Studio R2 — one linked posting from a public ATS API (doc 11
// §5.3 step 2), parsed by the SAME parsers the direct-employers pipeline
// uses (src/lib/ats-posting-parsers.ts, shared so the web server never
// imports src/direct/, ADR 0006 §9). The hosts are fixed here and board/id
// were validated by classifyLink, so the user's URL never chooses where we
// connect. Never throws: null means "not resolved this way".

/** GET returning status + body text; injectable for tests. */
export type JsonGet = (url: string) => Promise<{ status: number; body: string }>;

const ATS_TIMEOUT_MS = 8_000;
const ATS_MAX_BYTES = 8 * 1024 * 1024;
const USER_AGENT = "BuscoTrabajoBot/1.0 (+https://buscotrabajo.co)";

/**
 * Bounded GET for the four fixed ATS API hosts only (the URL is built here
 * from validated board/id, never taken from the user): 8 s, 8 MB, no
 * redirects followed, JSON only.
 */
export const atsJsonGet: JsonGet = async (url) => {
  if (!/^https:\/\/(boards-api\.greenhouse\.io|api\.lever\.co|api\.ashbyhq\.com|api\.smartrecruiters\.com)\//.test(url)) {
    throw new Error("host de ATS no permitido");
  }
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    redirect: "manual",
    signal: AbortSignal.timeout(ATS_TIMEOUT_MS)
  });
  if (Number(response.headers.get("content-length") || 0) > ATS_MAX_BYTES) {
    await response.body?.cancel();
    return { status: 413, body: "" };
  }
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > ATS_MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        return { status: 413, body: "" };
      }
      chunks.push(value);
    }
  }
  return { status: response.status, body: Buffer.concat(chunks).toString("utf8") };
};

export type AtsRead = { kind: "found"; draft: Partial<SnapshotDraft> } | { kind: "not_found" } | { kind: "error" };

function draftOf(posting: RawAtsPosting, extraDescription: string[] = []): Partial<SnapshotDraft> {
  const description = [posting.descriptionText, ...extraDescription].filter((part): part is string => Boolean(part && part.trim())).join("\n\n");
  return {
    title: posting.title,
    company: posting.companyName,
    location: posting.locationTexts.length ? [...new Set(posting.locationTexts)].join(" · ") : null,
    remote: posting.workplace,
    employmentType: posting.employmentType,
    description: description || undefined,
    datePosted: posting.publishedAt,
    validThrough: posting.validThrough,
    salary: null,
    applyUrl: httpUrlOrNull(posting.applyUrl)
  };
}

// Lever keeps requirements in `lists` and the closing text in `additional`;
// the board parser reads only descriptionPlain, so these are added here.
const LeverExtras = z
  .object({
    lists: z.array(z.object({ text: z.string().nullable().optional(), content: z.string().nullable().optional() }).partial()).nullable().optional(),
    additionalPlain: z.string().nullable().optional()
  })
  .partial();

const SmartRecruitersDetail = z
  .object({
    jobAd: z
      .object({
        sections: z
          .record(z.string(), z.object({ title: z.string().nullable().optional(), text: z.string().nullable().optional() }).partial().nullable())
          .nullable()
          .optional()
      })
      .partial()
      .nullable()
      .optional()
  })
  .partial();

export async function readAtsPosting(ref: AtsPostingRef, http: JsonGet = atsJsonGet): Promise<AtsRead> {
  try {
    if (ref.ats === "greenhouse") {
      const response = await http(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(ref.board)}/jobs/${ref.id}`);
      if (response.status === 404) return { kind: "not_found" };
      if (response.status !== 200) return { kind: "error" };
      const posting = greenhouse({ jobs: [safeJson(response.body)] })?.[0];
      return posting ? { kind: "found", draft: draftOf(posting) } : { kind: "error" };
    }
    if (ref.ats === "lever") {
      const response = await http(`https://api.lever.co/v0/postings/${encodeURIComponent(ref.board)}/${ref.id}`);
      if (response.status === 404) return { kind: "not_found" };
      if (response.status !== 200) return { kind: "error" };
      const body = safeJson(response.body);
      const posting = lever([body])?.[0];
      if (!posting) return { kind: "error" };
      const extras = LeverExtras.safeParse(body);
      const lists = extras.success
        ? (extras.data.lists ?? []).map((list) => [list.text, list.content ? htmlToText(list.content) : null].filter(Boolean).join("\n"))
        : [];
      return { kind: "found", draft: draftOf(posting, [...lists, extras.success ? (extras.data.additionalPlain ?? "") : ""]) };
    }
    if (ref.ats === "ashby") {
      // No single-posting endpoint: the public board, then the one id.
      const response = await http(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(ref.board)}`);
      if (response.status === 404) return { kind: "not_found" };
      if (response.status !== 200) return { kind: "error" };
      const postings = ashby(safeJson(response.body));
      if (!postings) return { kind: "error" };
      const posting = postings.find((entry) => entry.externalId.toLowerCase() === ref.id);
      return posting ? { kind: "found", draft: draftOf(posting) } : { kind: "not_found" };
    }
    // SmartRecruiters: the documented public posting endpoint (not the
    // country-filtered listing the direct pipeline uses).
    const response = await http(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(ref.board)}/postings/${ref.id}`);
    if (response.status === 404 || response.status === 400) return { kind: "not_found" };
    if (response.status !== 200) return { kind: "error" };
    const body = safeJson(response.body);
    const item = SmartRecruitersPage.shape.content.element.safeParse(body);
    if (!item.success) return { kind: "error" };
    const posting = smartRecruitersPosting(ref.board, item.data);
    const detail = SmartRecruitersDetail.safeParse(body);
    const sections = detail.success ? Object.values(detail.data.jobAd?.sections ?? {}) : [];
    const texts = sections
      .map((section) => (section?.text ? [section.title, htmlToText(section.text)].filter(Boolean).join("\n") : null))
      .filter((part): part is string => Boolean(part));
    return { kind: "found", draft: draftOf(posting, texts) };
  } catch {
    return { kind: "error" };
  }
}
