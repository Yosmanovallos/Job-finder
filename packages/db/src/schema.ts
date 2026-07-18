import { pgTable, uuid, timestamp, text } from "drizzle-orm/pg-core";

/**
 * Minimal Phase 0 table used only to prove that migrations apply cleanly
 * against an empty database. Domain tables (profiles, jobs, sources, ...)
 * are introduced phase by phase per PLAN_RADAR_EMPLEO_LOCAL.md section 22.
 */
export const bootstrapCheck = pgTable("bootstrap_check", {
  id: uuid("id").primaryKey().defaultRandom(),
  note: text("note").notNull().default("job-radar-local bootstrap"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});
