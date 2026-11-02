import { pool } from "./client.js";
import type { FeedbackInput, PublishedOpinion } from "../lib/site-feedback.js";

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
  if ((error as { code?: string })?.code === "42P01") throw new SiteFeedbackUnavailableError();
  throw error;
}

export async function insertFeedback(input: FeedbackInput, userAgent: string | null): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO site_feedback (kind, category, message, display_name, city, page_path, search_text, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [input.kind, input.category, input.message, input.displayName, input.city, input.pagePath, input.search, userAgent]
    );
  } catch (error) {
    rethrow(error);
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
}

export async function listPublishedOpinions(limit = PUBLISHED_OPINIONS_LIMIT): Promise<PublishedOpinion[]> {
  try {
    const result = await pool.query<OpinionRow>(
      `SELECT id, category, message, display_name, city, published_at, team_reply
       FROM site_feedback
       WHERE kind = 'opinion' AND status = 'published' AND published_at IS NOT NULL AND display_name IS NOT NULL
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
      teamReply: row.team_reply
    }));
  } catch (error) {
    rethrow(error);
  }
}
