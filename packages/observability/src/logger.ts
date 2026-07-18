import pino, { type Logger } from "pino";

export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace";

export interface CreateLoggerOptions {
  service: string;
  level?: LogLevel;
  /** Additional dot-paths to redact on top of the built-in PII defaults. */
  extraRedactPaths?: string[];
}

/**
 * Fields that must never appear in logs per the security policy: PII,
 * secrets, tokens and full HTML/CV bodies. Redaction happens at the pino
 * serializer level so a forgotten field never leaks raw.
 */
const DEFAULT_REDACT_PATHS = [
  "*.password",
  "*.token",
  "*.apiKey",
  "*.api_key",
  "*.email",
  "*.phone",
  "*.cvText",
  "*.cv_text",
  "*.html",
  "*.cookies",
  "req.headers.authorization",
  "req.headers.cookie"
];

export function createLogger(options: CreateLoggerOptions): Logger {
  return pino({
    level: options.level ?? "info",
    base: { service: options.service },
    redact: {
      paths: [...DEFAULT_REDACT_PATHS, ...(options.extraRedactPaths ?? [])],
      censor: "[REDACTED]"
    },
    timestamp: pino.stdTimeFunctions.isoTime
  });
}

export type { Logger };
