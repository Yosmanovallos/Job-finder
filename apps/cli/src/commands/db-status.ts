import { sql } from "drizzle-orm";
import { createDb } from "@job-radar/db";
import type { Logger } from "@job-radar/observability";

export interface DbStatusResult {
  ok: boolean;
  detail: string;
}

export async function checkDbStatus(databaseUrl: string, logger: Logger): Promise<DbStatusResult> {
  const { db, close } = createDb(databaseUrl, 1);
  try {
    await db.execute(sql`select 1`);
    logger.info("database connection healthy");
    return { ok: true, detail: "connected" };
  } catch (error) {
    logger.error({ err: error }, "database connection failed");
    return { ok: false, detail: error instanceof Error ? error.message : "unknown error" };
  } finally {
    await close();
  }
}
