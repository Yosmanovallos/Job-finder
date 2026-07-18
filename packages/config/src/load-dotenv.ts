import { existsSync } from "node:fs";

/**
 * Loads a .env file into process.env if present. Never throws when the file
 * is missing — callers rely on loadEnv() to report missing variables.
 */
export function loadDotEnv(path = ".env"): void {
  if (!existsSync(path)) {
    return;
  }
  process.loadEnvFile(path);
}
