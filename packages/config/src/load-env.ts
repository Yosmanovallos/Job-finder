import { EnvSchema, type Env } from "./env-schema.js";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function formatIssues(issues: { path: (string | number)[]; message: string }[]): string {
  return issues
    .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
}

/**
 * Parses and validates environment variables. Throws ConfigError with an
 * actionable, per-field message instead of a raw Zod error dump.
 */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const details = formatIssues(result.error.issues);
    throw new ConfigError(
      `Invalid environment configuration. Fix the following and retry:\n${details}\n` +
        `Hint: copy .env.example to .env and fill in the missing values.`
    );
  }
  return result.data;
}
