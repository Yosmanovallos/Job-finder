import { pool } from "./client.js";

export interface CompanyReviewInput {
  userId: string;
  companyName: string;
  rating: number;
  comment: string | null;
}

export interface CompanyReviewEntry {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MyCompanyReview extends CompanyReviewEntry {
  status: "visible" | "hidden";
}

export interface CompanyReviewsResult {
  average: number | null;
  count: number;
  entries: CompanyReviewEntry[];
  myReview: MyCompanyReview | null;
}

function toEntry(row: any): CompanyReviewEntry {
  return {
    id: row.id,
    rating: row.rating,
    comment: row.comment,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

// ON CONFLICT keeps this a rewrite, not an accumulation — UNIQUE(user_id,
// company_name) in schema.sql is what makes that guarantee real. `status`
// is deliberately left untouched on update: a review a moderator hid via
// SQL stays hidden even if the author edits it, instead of silently
// resurfacing.
export async function upsertCompanyReview(input: CompanyReviewInput): Promise<void> {
  await pool.query(
    `INSERT INTO company_user_reviews (user_id, company_name, rating, comment, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (user_id, company_name) DO UPDATE SET
       rating = EXCLUDED.rating,
       comment = EXCLUDED.comment,
       updated_at = NOW()`,
    [input.userId, input.companyName, input.rating, input.comment]
  );
}

export async function deleteCompanyReview(userId: string, companyName: string): Promise<void> {
  await pool.query(`DELETE FROM company_user_reviews WHERE user_id = $1 AND company_name = $2`, [
    userId,
    companyName
  ]);
}

// viewerUserId is whatever verifySession() resolved for the caller — a
// visible review is never a substitute for the caller's own row: myReview
// always reflects the caller's real row (visible or hidden), while entries
// only ever contains status='visible' rows from anyone.
export async function getCompanyReviews(
  companyName: string,
  viewerUserId: string | null
): Promise<CompanyReviewsResult> {
  const [entriesResult, aggResult, mineResult] = await Promise.all([
    pool.query(
      `SELECT id, rating, comment, created_at, updated_at
       FROM company_user_reviews
       WHERE company_name = $1 AND status = 'visible'
       ORDER BY created_at DESC
       LIMIT 20`,
      [companyName]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS count, AVG(rating)::numeric AS average
       FROM company_user_reviews
       WHERE company_name = $1 AND status = 'visible'`,
      [companyName]
    ),
    viewerUserId
      ? pool.query(
          `SELECT id, rating, comment, status, created_at, updated_at
           FROM company_user_reviews
           WHERE company_name = $1 AND user_id = $2`,
          [companyName, viewerUserId]
        )
      : Promise.resolve({ rows: [] as any[] })
  ]);

  const aggRow = aggResult.rows[0];
  const mineRow = mineResult.rows[0];

  return {
    average: aggRow?.average !== null && aggRow?.average !== undefined ? Number(aggRow.average) : null,
    count: aggRow?.count ?? 0,
    entries: entriesResult.rows.map(toEntry),
    myReview: mineRow ? { ...toEntry(mineRow), status: mineRow.status } : null
  };
}
