/**
 * Job SEO V2 — classifies LEGACY rows (detail_status IS NULL) through the
 * shared Google gate, from what is already stored. NO NETWORK: never fetches
 * a source page. Also the read-only backfill-candidate report.
 *
 *   npx tsx scripts/classify-job-readiness.ts                 # dry-run report (default)
 *   npx tsx scripts/classify-job-readiness.ts --json          # same, machine-readable
 *   npx tsx scripts/classify-job-readiness.ts --apply         # write verdicts
 *   options: --batch-size=500 (max 2000) --limit=N --source=LinkedIn
 *
 * What --apply writes, per legacy row, and nothing else:
 *   detail_status   complete | rejected | backlog | unsupported
 *                   ('backlog' = no description, source HAS fetchDetail: left for
 *                    the historical backfill, which needs separate authorization;
 *                    the tick's detail drain never claims it)
 *   description_source / description_kind (derived from the source's known shape)
 *   seo_ready, seo_reasons, seo_evaluated_at, content_hash
 *   seo_ready_at = NOW() for ready rows (first readiness)
 * It does NOT write content_updated_at (real change time unknown → the sitemap
 * omits <lastmod>), does NOT enqueue any Indexing API notification (the hourly
 * reconcile does that, bounded, in the lowest lane) and never deletes anything.
 * Every write is verified against the real rowCount (job-radar-apify/CLAUDE.md).
 */
import dotenv from "dotenv";
import { pool } from "../src/db/client.js";
import { assessDescription } from "../src/lib/job-description-quality.js";
import {
  computeContentHash,
  evaluateRow,
  IS_CANONICAL_SQL,
  ROW_COLUMNS,
  type DetailStatus,
  type ReadinessRow
} from "../src/db/job-readiness-repository.js";
import { sourceSupportsDetail } from "../src/sources/detail-capability.js";

dotenv.config();

// Sources whose listing text is a teaser field, never the posting.
const SNIPPET_SOURCES = new Set(["Torre", "Jooble"]);

function flag(name: string): string | undefined {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg?.slice(name.length + 3);
}

const APPLY = process.argv.includes("--apply");
const JSON_OUTPUT = process.argv.includes("--json");
const BATCH_SIZE = Math.min(Math.max(Number(flag("batch-size") ?? 500) || 500, 1), 2000);
const LIMIT = flag("limit") ? Math.max(Number(flag("limit")) || 0, 0) : Infinity;
const SOURCE = flag("source") ?? null;

interface SourceReport {
  active: number;
  missingDescription: number;
  invalidDescription: number;
  fetchDetailSupported: boolean;
  remoteAmbiguity: number;
  seoReady: number;
  notSeoReady: number;
  byStatus: Record<string, number>;
  age: Record<string, number>;
}

function ageBucket(publishedAt: string | Date): string {
  const days = (Date.now() - new Date(publishedAt).getTime()) / 86_400_000;
  if (days < 7) return "a_<7d";
  if (days < 30) return "b_7-30d";
  return "c_>30d";
}

type LegacyRow = ReadinessRow & { source: string; is_canonical: boolean };

function classify(row: LegacyRow): { status: DetailStatus; kind: string | null; origin: string | null } {
  const hasText = Boolean(row.description && row.description.trim());
  const supports = sourceSupportsDetail(row.source);
  const kind = hasText ? (SNIPPET_SOURCES.has(row.source) ? "snippet" : "full") : null;
  const origin = hasText ? (supports ? "detail" : "listing") : null;
  if (!hasText) return { status: supports ? "backlog" : "unsupported", kind, origin };
  const quality = assessDescription({
    title: row.title,
    company: row.company,
    location: row.location,
    description: row.description,
    requirements: Array.isArray(row.requirements) ? (row.requirements as string[]) : [],
    descriptionKind: kind
  });
  if (quality.ok) return { status: "complete", kind, origin };
  return { status: supports ? "rejected" : "unsupported", kind, origin };
}

async function main() {
  const perSource: Record<string, SourceReport> = {};
  const reasons: Record<string, number> = {};
  let examined = 0;
  let written = 0;
  let lastId = "00000000-0000-0000-0000-000000000000";

  while (examined < LIMIT) {
    const take = Math.min(BATCH_SIZE, LIMIT - examined);
    const result = await pool.query<LegacyRow>(
      `SELECT ${ROW_COLUMNS}, j.source, ${IS_CANONICAL_SQL} AS is_canonical
       FROM jobs j
       WHERE j.is_active = TRUE AND j.detail_status IS NULL AND j.id > $1
         AND ($3::text IS NULL OR j.source = $3)
       ORDER BY j.id
       LIMIT $2`,
      [lastId, take, SOURCE]
    );
    const rows = result.rows;
    if (rows.length === 0) break;
    lastId = rows[rows.length - 1].id;
    examined += rows.length;

    const updates = rows.map((row) => {
      const derived = classify(row);
      const withKind = { ...row, description_kind: derived.kind };
      const verdict = evaluateRow(withKind);
      const report = (perSource[row.source] ??= {
        active: 0,
        missingDescription: 0,
        invalidDescription: 0,
        fetchDetailSupported: sourceSupportsDetail(row.source),
        remoteAmbiguity: 0,
        seoReady: 0,
        notSeoReady: 0,
        byStatus: {},
        age: {}
      });
      report.active++;
      if (!row.description || !row.description.trim()) report.missingDescription++;
      else if (derived.status !== "complete") report.invalidDescription++;
      if (verdict.reasons.includes("INVALID_REMOTE_LOCATION")) report.remoteAmbiguity++;
      if (verdict.ready) report.seoReady++;
      else report.notSeoReady++;
      report.byStatus[derived.status] = (report.byStatus[derived.status] ?? 0) + 1;
      const bucket = ageBucket(row.published_at);
      report.age[bucket] = (report.age[bucket] ?? 0) + 1;
      for (const reason of verdict.reasons) reasons[reason] = (reasons[reason] ?? 0) + 1;
      return {
        id: row.id,
        detail_status: derived.status,
        detail_last_error: derived.status === "complete" ? null : verdict.reasons.find((r) => r.startsWith("DESCRIPTION") || r === "MISSING_DESCRIPTION") ?? null,
        description_kind: derived.kind,
        description_source: derived.origin,
        seo_ready: verdict.ready,
        seo_reasons: verdict.reasons,
        content_hash: computeContentHash(withKind)
      };
    });

    if (APPLY) {
      const res = await pool.query(
        `UPDATE jobs j SET
           detail_status = u.detail_status,
           detail_last_error = u.detail_last_error,
           description_kind = u.description_kind,
           description_source = u.description_source,
           seo_ready = u.seo_ready,
           seo_reasons = u.seo_reasons,
           seo_evaluated_at = NOW(),
           seo_ready_at = CASE WHEN u.seo_ready THEN COALESCE(j.seo_ready_at, NOW()) ELSE j.seo_ready_at END,
           content_hash = u.content_hash
         FROM jsonb_to_recordset($1::jsonb) AS u(
           id uuid, detail_status text, detail_last_error text, description_kind text,
           description_source text, seo_ready boolean, seo_reasons jsonb, content_hash text)
         WHERE j.id = u.id AND j.detail_status IS NULL`,
        [JSON.stringify(updates)]
      );
      if ((res.rowCount ?? 0) !== updates.length) {
        throw new Error(
          `Escritura incompleta: se esperaban ${updates.length} filas y se actualizaron ${res.rowCount}. Detenido sin continuar.`
        );
      }
      written += res.rowCount ?? 0;
    }
  }

  const totals = Object.values(perSource).reduce(
    (acc, r) => ({ active: acc.active + r.active, ready: acc.ready + r.seoReady, notReady: acc.notReady + r.notSeoReady }),
    { active: 0, ready: 0, notReady: 0 }
  );
  const output = { mode: APPLY ? "apply" : "dry-run", examined, written, totals, reasons, perSource };
  if (JSON_OUTPUT) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(`\n📋 [classify] ${APPLY ? "APPLY" : "DRY-RUN (sin escrituras)"} — filas legadas examinadas: ${examined}, escritas: ${written}`);
    console.log(`   Aptas para Google: ${totals.ready} · No aptas: ${totals.notReady}`);
    console.table(
      Object.entries(perSource)
        .sort((a, b) => b[1].active - a[1].active)
        .map(([source, r]) => ({
          source,
          active: r.active,
          sinDescripcion: r.missingDescription,
          descripcionInvalida: r.invalidDescription,
          fetchDetail: r.fetchDetailSupported ? "sí" : "no",
          remotoAmbiguo: r.remoteAmbiguity,
          aptas: r.seoReady,
          noAptas: r.notSeoReady,
          edad: Object.entries(r.age).map(([k, v]) => `${k}:${v}`).join(" "),
          estados: Object.entries(r.byStatus).map(([k, v]) => `${k}:${v}`).join(" ")
        }))
    );
    console.log("   Motivos (una vacante puede tener varios):");
    console.table(Object.entries(reasons).sort((a, b) => b[1] - a[1]).map(([reason, count]) => ({ reason, count })));
  }
  if (APPLY && written !== examined) {
    throw new Error(`Filas examinadas (${examined}) ≠ escritas (${written}).`);
  }
  await pool.end();
}

main().catch(async (error) => {
  console.error("❌ [classify]", error instanceof Error ? error.message : "Error");
  await pool.end().catch(() => undefined);
  process.exit(1);
});
