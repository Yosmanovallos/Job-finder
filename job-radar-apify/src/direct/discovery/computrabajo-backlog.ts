import { z } from "zod";
import { companyKey } from "./company-key.js";
import type { ComputrabajoCoverageRow } from "../../db/direct-discovery-repository.js";

const Review = z.object({
  company: z.string().min(1),
  status: z.enum([
    "official_incomplete", "official_no_colombia", "form_only", "blocked",
    "computrabajo_hosted", "third_party_only", "no_public_listing", "attribution_unverified"
  ]),
  evidenceUrl: z.string().url().startsWith("https://"),
  reviewedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
}).strict();

export type OfficialReview = z.infer<typeof Review>;

export function parseOfficialReviews(input: unknown): Map<string, OfficialReview> {
  const parsed = z.object({ reviews: z.array(Review) }).strict().parse(input);
  const reviews = new Map<string, OfficialReview>();
  for (const review of parsed.reviews) {
    const key = companyKey(review.company);
    if (reviews.has(key)) throw new Error(`Revisión duplicada: ${key}`);
    reviews.set(key, review);
  }
  return reviews;
}

/** Manual review is separate from the automated ATS name probe (`decision`). */
export function buildComputrabajoBacklog(
  rows: ComputrabajoCoverageRow[],
  agencies: Set<string>,
  reviews: Map<string, OfficialReview>
) {
  return rows.map((row) => {
    const review = reviews.get(row.companyKey);
    return {
      ...row,
      isAgency: agencies.has(row.companyKey),
      status: row.enabledBoards > 0 ? "official_board" : review?.status ?? "pending_review",
      evidenceUrl: review?.evidenceUrl ?? null,
      reviewedAt: review?.reviewedAt ?? null
    };
  });
}
