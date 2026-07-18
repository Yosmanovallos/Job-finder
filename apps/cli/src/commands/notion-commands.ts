import { join } from "node:path";
import type { Profile } from "@job-radar/domain";
import type { Database } from "@job-radar/db";
import { rowToCanonical } from "@job-radar/ingestion";
import { rankResults, scoreJob, type ScoringConfig } from "@job-radar/matching";
import {
  checkSchema,
  createDbStateStore,
  createFileDlq,
  createNotionApi,
  executeSync,
  planSync,
  pullHumanFields,
  reconcile,
  renderPlan,
  type NotionApi,
  type SyncItem
} from "@job-radar/notion";

export interface NotionEnv {
  NOTION_TOKEN?: string | undefined;
  NOTION_DATA_SOURCE_ID?: string | undefined;
}

/** Fails fast with an actionable message; never prints secret values. */
export function requireNotionConfig(env: NotionEnv): { token: string; dataSourceId: string } {
  const missing: string[] = [];
  if (!env.NOTION_TOKEN) {
    missing.push("NOTION_TOKEN");
  }
  if (!env.NOTION_DATA_SOURCE_ID) {
    missing.push("NOTION_DATA_SOURCE_ID");
  }
  if (missing.length > 0) {
    throw new Error(
      `Faltan variables en .env: ${missing.join(", ")}. ` +
        "Crea una integración en notion.so/my-integrations, comparte la página del radar " +
        "con ella y copia el data_source_id de la base Vacantes."
    );
  }
  return { token: env.NOTION_TOKEN!, dataSourceId: env.NOTION_DATA_SOURCE_ID! };
}

export async function notionSchemaCheck(api: NotionApi, dataSourceId: string): Promise<{
  ok: boolean;
  report: ReturnType<typeof checkSchema>;
}> {
  const dataSource = await api.retrieveDataSource(dataSourceId);
  const report = checkSchema(dataSource);
  return { ok: report.ok, report };
}

/**
 * Loads jobs from Postgres, scores them and keeps the rows worth projecting:
 * ranked view (blockers excluded by ranking) capped at `top`.
 */
export async function collectSyncItems(
  db: Database,
  profile: Profile,
  scoring: ScoringConfig,
  top: number
): Promise<SyncItem[]> {
  const rows = await db.query.jobs.findMany();
  const canonicalById = new Map(rows.map((row) => [row.id, rowToCanonical(row)]));
  const results = [...canonicalById.values()].map((job) => scoreJob(profile, job, scoring));
  return rankResults(results, "high_recall")
    .slice(0, top)
    .map((match) => ({ job: canonicalById.get(match.jobId)!, match }));
}

export interface NotionSyncDeps {
  db: Database;
  profile: Profile;
  scoring: ScoringConfig;
  root: string;
  env: NotionEnv;
  top: number;
  execute: boolean;
  /** Test seam; production uses the real SDK client. */
  apiFactory?: (token: string) => NotionApi;
}

export async function runNotionSync(deps: NotionSyncDeps): Promise<Record<string, unknown>> {
  const store = createDbStateStore(deps.db);
  const items = await collectSyncItems(deps.db, deps.profile, deps.scoring, deps.top);
  const plan = await planSync(items, store);

  if (!deps.execute) {
    return {
      ok: true,
      mode: "dry-run",
      counts: plan.counts,
      preview: renderPlan(plan),
      nota: "Ninguna escritura se ejecutó. Revisa el preview y corre con --execute."
    };
  }

  const { token, dataSourceId } = requireNotionConfig(deps.env);
  const api = (deps.apiFactory ?? createNotionApi)(token);

  // Read human edits BEFORE pushing, so local state reflects them first.
  const pull = await pullHumanFields(api, store);
  const dlq = createFileDlq(join(deps.root, "var/notion/dlq.jsonl"));
  const result = await executeSync(plan, { api, store, dlq, dataSourceId });
  return {
    ok: result.failed === 0,
    mode: "execute",
    counts: plan.counts,
    result,
    human_fields_pulled: pull.pulled,
    dlq_path: result.failed > 0 ? join(deps.root, "var/notion/dlq.jsonl") : null
  };
}

export async function runNotionReconcile(deps: {
  db: Database;
  env: NotionEnv;
  execute: boolean;
  apiFactory?: (token: string) => NotionApi;
}): Promise<Record<string, unknown>> {
  const { token, dataSourceId } = requireNotionConfig(deps.env);
  const api = (deps.apiFactory ?? createNotionApi)(token);
  const store = createDbStateStore(deps.db);
  const report = await reconcile(api, store, dataSourceId, { dryRun: !deps.execute });
  return {
    ok: true,
    mode: deps.execute ? "execute" : "dry-run",
    duplicates: report.duplicates,
    adopted: report.adopted,
    missing_pages: report.missingPages,
    unidentified: report.unidentified,
    nota: "Reconcile nunca borra páginas ni contenido humano; los duplicados requieren acción manual."
  };
}
