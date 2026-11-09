import { pool } from "./client.js";
import type { FeedbackInput, OpinionsSummary, PublishedOpinion } from "../lib/site-feedback.js";

// "Opiniones y ayuda" (schema.sql's site-feedback block). Inserts come only
// from POST /api/feedback after validateFeedback; reads expose published
// opinions only. Publishing, replying and resolving are manual (SQL) for now.

export const PUBLISHED_OPINIONS_LIMIT = 30;

/** The table doesn't exist yet (migration not applied): the API answers 503. */
export class SiteFeedbackUnavailableError extends Error {
  constructor() {
    super("Site feedback is not available yet.");
  }
}

function rethrow(error: unknown): never {
  // 42P01 = undefined_table.
  if (isUnavailable(error)) throw new SiteFeedbackUnavailableError();
  throw error;
}

/** Not migrated yet: 42P01 (no table) or 42703 (no user_id column). */
function isUnavailable(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  return code === "42P01" || code === "42703" || code === "42P10";
}

/**
 * Stores a report or an opinion. `userId` is the account verifySession
 * resolved from the JWT (never a value from the body). An opinion requires
 * it and REPLACES that account's previous opinion, which goes back to
 * review (status pending, unpublished) since its text or stars changed.
 */
export async function insertFeedback(input: FeedbackInput, userAgent: string | null, userId: string | null): Promise<void> {
  try {
    if (input.kind === "opinion") {
      if (!userId) throw new Error("An opinion needs a signed-in account.");
      await pool.query(
        `INSERT INTO site_feedback (kind, category, message, rating, display_name, user_id)
         VALUES ('opinion', $1, $2, $3, $4, $5)
         ON CONFLICT (user_id) WHERE kind = 'opinion' DO UPDATE SET
           category = EXCLUDED.category, message = EXCLUDED.message, rating = EXCLUDED.rating,
           display_name = EXCLUDED.display_name, status = 'pending', published_at = NULL,
           team_reply = NULL, created_at = NOW()`,
        [input.category, input.message, input.rating, input.displayName, userId]
      );
      return;
    }
    await pool.query(
      `INSERT INTO site_feedback (kind, category, message, rating, page_path, search_text, user_agent, user_id)
       VALUES ('problem', $1, $2, $3, $4, $5, $6, $7)`,
      [input.category, input.message, userId ? input.rating : null, input.pagePath, input.search, userAgent, userId]
    );
  } catch (error) {
    if (isUnavailable(error)) throw new SiteFeedbackUnavailableError();
    throw error;
  }
}

interface OpinionRow {
  id: string;
  category: string;
  message: string;
  display_name: string;
  city: string | null;
  published_at: Date | string;
  team_reply: string | null;
  rating: number;
}

// Only opinions tied to an account are ever public (rows sent anonymously
// before 2026-11-03 stay private forever).
const PUBLISHED = `kind = 'opinion' AND status = 'published' AND published_at IS NOT NULL AND display_name IS NOT NULL AND rating IS NOT NULL AND user_id IS NOT NULL`;

export async function listPublishedOpinions(limit = PUBLISHED_OPINIONS_LIMIT): Promise<PublishedOpinion[]> {
  try {
    const result = await pool.query<OpinionRow>(
      `SELECT id, category, message, display_name, city, published_at, team_reply, rating
       FROM site_feedback
       WHERE ${PUBLISHED}
       ORDER BY published_at DESC
       LIMIT $1`,
      [Math.min(Math.max(1, limit), PUBLISHED_OPINIONS_LIMIT)]
    );
    return result.rows.map((row) => ({
      id: row.id,
      category: row.category,
      message: row.message,
      displayName: row.display_name,
      city: row.city,
      publishedAt: (row.published_at instanceof Date ? row.published_at : new Date(row.published_at)).toISOString(),
      teamReply: row.team_reply,
      rating: Number(row.rating)
    }));
  } catch (error) {
    rethrow(error);
  }
}

export async function getOpinionsSummary(): Promise<OpinionsSummary> {
  try {
    const result = await pool.query<{ rating: number; n: number }>(
      `SELECT rating, COUNT(*)::int AS n FROM site_feedback WHERE ${PUBLISHED} GROUP BY rating`
    );
    const distribution: OpinionsSummary["distribution"] = [0, 0, 0, 0, 0];
    let count = 0;
    let total = 0;
    for (const row of result.rows) {
      const stars = Number(row.rating);
      distribution[5 - stars] = row.n;
      count += row.n;
      total += stars * row.n;
    }
    return { count, average: count ? Math.round((total / count) * 10) / 10 : null, distribution };
  } catch (error) {
    rethrow(error);
  }
}
