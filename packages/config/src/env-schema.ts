import { z } from "zod";

export const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z
    .string({ required_error: "DATABASE_URL is required, e.g. postgres://user:pass@localhost:5432/job_radar" })
    .url("DATABASE_URL must be a valid postgres:// connection string"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  TIMEZONE: z.string().default("America/Bogota"),
  /** Notion projection (plan §14). Optional: sync commands fail fast without them. */
  NOTION_TOKEN: z.string().min(1).optional(),
  NOTION_DATA_SOURCE_ID: z.string().min(1).optional()
});

export type Env = z.infer<typeof EnvSchema>;
