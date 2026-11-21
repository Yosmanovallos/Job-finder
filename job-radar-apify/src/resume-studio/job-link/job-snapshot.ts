import { z } from "zod";

// AI Resume Studio R2 — JobSnapshot: the vacancy the CV will be adapted to
// (doc 11 §5.3). Every text field comes from outside (a job page, an ATS, or
// a user's paste), so it is UNTRUSTED: it may contain instructions aimed at
// the R3 model. `untrusted: true` is a literal — R3 must wrap these fields in
// delimiters and treat them as data (AGENTS.md rule 6). Fields the source
// doesn't state stay null: nothing is inferred (rule 5).

export const SNAPSHOT_VIAS = ["buscotrabajo", "our_index", "greenhouse", "lever", "ashby", "jsonld", "pasted"] as const;
export type SnapshotVia = (typeof SNAPSHOT_VIAS)[number];

export const SNAPSHOT_TEXT_MAX = 20_000;
export const SNAPSHOT_TITLE_MAX = 200;

const shortText = (max: number) => z.string().min(1).max(max).nullable();

export const jobSnapshotSchema = z
  .object({
    version: z.literal(1),
    untrusted: z.literal(true),
    via: z.enum(SNAPSHOT_VIAS),
    /** The link as the user gave it (for «Ir a la vacante»). */
    sourceUrl: z.string().max(2000).nullable(),
    canonicalUrl: z.string().max(2000).nullable(),
    fetchedAt: z.string().datetime(),
    title: z.string().min(1).max(SNAPSHOT_TITLE_MAX),
    company: shortText(200),
    location: shortText(300),
    remote: z.enum(["remote", "hybrid", "onsite"]).nullable(),
    employmentType: shortText(100),
    description: z.string().min(1).max(SNAPSHOT_TEXT_MAX),
    datePosted: z.string().datetime().nullable(),
    validThrough: z.string().datetime().nullable(),
    salary: z
      .object({
        min: z.number().nonnegative().nullable(),
        max: z.number().nonnegative().nullable(),
        currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
        period: z.enum(["HOUR", "DAY", "WEEK", "MONTH", "YEAR"]).nullable()
      })
      .strict()
      .nullable(),
    /** Where to apply, when the source states it. */
    applyUrl: z.string().max(2000).nullable()
  })
  .strict();
export type JobSnapshot = z.infer<typeof jobSnapshotSchema>;

/** Drops control and bidi-override characters, collapses blank runs, caps length. */
export function cleanExternalText(value: string | null | undefined, max: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value
    .replace(/\r\n?/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‏‪-‮⁦-⁩﻿]/g, "")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!cleaned) return null;
  return cleaned.length > max ? cleaned.slice(0, max).trimEnd() : cleaned;
}

export function isoOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const date = typeof value === "number" ? new Date(value) : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function httpUrlOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value.trim());
    return (url.protocol === "https:" || url.protocol === "http:") && value.length <= 2000 ? url.toString() : null;
  } catch {
    return null;
  }
}

export type SnapshotDraft = Omit<JobSnapshot, "version" | "untrusted" | "fetchedAt" | "sourceUrl" | "canonicalUrl" | "via">;

/** Builds and validates a snapshot; null when the source didn't give a title and a description. */
export function buildSnapshot(
  draft: Partial<SnapshotDraft>,
  meta: { via: SnapshotVia; sourceUrl: string | null; canonicalUrl: string | null; now?: Date }
): JobSnapshot | null {
  const title = cleanExternalText(draft.title ?? null, SNAPSHOT_TITLE_MAX)?.replace(/\n/g, " ") ?? null;
  const description = cleanExternalText(draft.description ?? null, SNAPSHOT_TEXT_MAX);
  if (!title || !description) return null;
  const one = (value: string | null | undefined, max: number) => cleanExternalText(value ?? null, max)?.replace(/\n/g, " ") ?? null;
  const candidate = {
    version: 1 as const,
    untrusted: true as const,
    via: meta.via,
    sourceUrl: meta.sourceUrl,
    canonicalUrl: meta.canonicalUrl,
    fetchedAt: (meta.now ?? new Date()).toISOString(),
    title,
    company: one(draft.company, 200),
    location: one(draft.location, 300),
    remote: draft.remote ?? null,
    employmentType: one(draft.employmentType, 100),
    description,
    datePosted: draft.datePosted ?? null,
    validThrough: draft.validThrough ?? null,
    salary: draft.salary ?? null,
    applyUrl: draft.applyUrl ?? null
  };
  const parsed = jobSnapshotSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}
