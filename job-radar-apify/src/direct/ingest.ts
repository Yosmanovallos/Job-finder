import { createHash } from "node:crypto";
import { jobStaleReason, MAX_JOB_AGE_DAYS } from "../lib/job-freshness.js";
import { matchColombia, workplaceFromText } from "./colombia-location.js";
import type { DirectPosting, RawAtsPosting } from "./types.js";

/**
 * Pure part of the official-vacancy tick (ADR 0006): which postings of a
 * board are stored, and whether a listing may close anything. No I/O here.
 */

export interface SelectionStats {
  boardTotal: number;
  notColombia: number;
  stale: number;
  testPostings: number;
  kept: number;
}

/**
 * A posting the employer itself marks as a test ("Test 09222026 AI
 * interview", measured on a live board 2026-10-19). Only explicit markers:
 * a messy real title ("CL_Template_Analista de Laboratorio") stays as the
 * ATS publishes it.
 */
export function isTestPosting(title: string): boolean {
  return /^\s*(test|prueba)\b[^a-z]*\d/i.test(title) || /\b(do not apply|no aplicar|test posting|vacante de prueba)\b/i.test(title);
}

/**
 * Colombian postings that are live by the shared freshness rule (ADR 0005).
 * A posting older than 30 days by the ATS's own date, or past its
 * validThrough, is not stored — and if it was stored before, it counts as
 * gone from the board, so it closes and is purged instead of lingering.
 */
export function selectColombianPostings(
  postings: RawAtsPosting[],
  now: Date = new Date()
): { postings: DirectPosting[]; stats: SelectionStats } {
  const stats: SelectionStats = { boardTotal: postings.length, notColombia: 0, stale: 0, testPostings: 0, kept: 0 };
  const kept = new Map<string, DirectPosting>();
  for (const raw of postings) {
    if (isTestPosting(raw.title)) {
      stats.testPostings++;
      continue;
    }
    const match = matchColombia(raw);
    if (!match) {
      stats.notColombia++;
      continue;
    }
    if (jobStaleReason(raw.publishedAt, raw.validThrough, now)) {
      stats.stale++;
      continue;
    }
    const posting: Omit<DirectPosting, "contentHash"> = {
      externalId: raw.externalId,
      title: raw.title.slice(0, 500),
      applyUrl: raw.applyUrl,
      locationRaw: match.locationRaw,
      city: match.city,
      country: "CO",
      workplace: raw.workplace ?? workplaceFromText([match.locationRaw]),
      descriptionText: raw.descriptionText,
      department: raw.department?.slice(0, 255) ?? null,
      employmentType: raw.employmentType?.slice(0, 100) ?? null,
      publishedAt: raw.publishedAt,
      validThrough: raw.validThrough
    };
    // A board that lists the same id twice keeps one row (the upsert key).
    kept.set(raw.externalId, { ...posting, contentHash: contentHash(posting) });
  }
  stats.kept = kept.size;
  return { postings: [...kept.values()], stats };
}

function contentHash(posting: Omit<DirectPosting, "contentHash">): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        posting.title,
        posting.locationRaw,
        posting.workplace,
        posting.descriptionText,
        posting.employmentType,
        posting.validThrough
      ])
    )
    .digest("hex");
}

/**
 * Mass-drop guard (ADR 0006 §3): a board that suddenly lists nothing, or a
 * fifth of what it listed before, most likely moved ATS or changed its API.
 * Closing every posting on that evidence would be wrong, so the tick marks
 * the board `suspect` and closes nothing.
 */
export function isSuspectDrop(previousBoardTotal: number | null, boardTotal: number): boolean {
  if (previousBoardTotal === null || previousBoardTotal === 0) return false;
  if (boardTotal === 0) return true;
  return previousBoardTotal >= 10 && boardTotal < previousBoardTotal * 0.2;
}

/** Consecutive complete listings a posting must be missing from to close. */
export const MISSING_LISTINGS_TO_CLOSE = 2;

/**
 * SQL predicate: an official vacancy that may be shown — open, within the
 * same 30-day window as `jobs` (by the ATS's date, or by when we first saw
 * it when the ATS states none) and not past its validThrough.
 */
export function liveDirectJobSql(alias = ""): string {
  const col = (name: string) => (alias ? `${alias}.${name}` : name);
  return (
    `(${col("closed_at")} IS NULL` +
    ` AND COALESCE(${col("published_at")}, ${col("first_seen_at")}) >= NOW() - INTERVAL '${MAX_JOB_AGE_DAYS} days'` +
    ` AND (${col("valid_through")} IS NULL OR ${col("valid_through")} > NOW()))`
  );
}
