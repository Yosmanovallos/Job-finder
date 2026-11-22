import type { ModelAlias } from "./prompts.js";

// AI Resume Studio R3 — gateway configuration (ADR 0017 §4). Read from the
// environment by the caller (never from .env files here). Fail closed: a
// qwen provider without workspace, key or a known price becomes "none".

export type AiProvider = "none" | "mock" | "qwen";

export interface ModelPrice {
  /** USD per million input tokens. */
  input: number;
  /** USD per million output tokens. */
  output: number;
}

export interface AiCaps {
  adaptationUsd: number;
  userDailyUsd: number;
  globalDailyUsd: number;
  globalMonthlyUsd: number;
}

export interface ResumeAiConfig {
  provider: AiProvider;
  /** Why the configured provider was turned off, if it was. */
  disabledReason: string | null;
  baseUrl: string | null;
  apiKey: string | null;
  models: Record<ModelAlias, string>;
  prices: Record<ModelAlias, ModelPrice>;
  caps: AiCaps;
  copPerUsd: number;
  timeoutMs: number;
}

// Official price page, Virginia / «United States» scope, read 2026-11-21
// (lowest input tier; our prompts stay under 32K input tokens).
export const KNOWN_PRICES: Record<string, ModelPrice> = {
  "qwen3.7-flash": { input: 0.03, output: 0.13 },
  "qwen3.8-flash": { input: 0.15, output: 0.47 },
  "qwen3.7-plus": { input: 0.4, output: 1.6 }
};

// Adaptation cap ≈ COP 140 at TRM 4.000: below the R3 exit criterion (≤ COP 150) by construction.
export const DEFAULT_CAPS: AiCaps = { adaptationUsd: 0.035, userDailyUsd: 0.25, globalDailyUsd: 5, globalMonthlyUsd: 60 };

const WORKSPACE = /^[a-z0-9][a-z0-9-]{2,62}$/;
const MODEL = /^[a-z0-9][a-z0-9.\-_]{1,60}$/;

function num(value: string | undefined, fallback: number, max: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= max ? n : fallback;
}

export function usBaseUrl(workspaceId: string): string {
  if (!WORKSPACE.test(workspaceId)) throw new Error("RESUME_AI_WORKSPACE_ID no válido");
  return `https://${workspaceId}.us-east-1.maas.aliyuncs.com/compatible-mode/v1`;
}

export function parseResumeAiConfig(env: Record<string, string | undefined>): ResumeAiConfig {
  const raw = (env.RESUME_AI_PROVIDER ?? "none").trim().toLowerCase();
  let provider: AiProvider = raw === "mock" || raw === "qwen" ? raw : "none";
  let disabledReason: string | null = raw !== provider ? "proveedor desconocido" : null;

  const pick = (value: string | undefined, fallback: string) => (value && MODEL.test(value.trim()) ? value.trim() : fallback);
  const models: Record<ModelAlias, string> = {
    fast: pick(env.RESUME_AI_MODEL_FAST, "qwen3.7-flash"),
    rewrite: pick(env.RESUME_AI_MODEL_REWRITE, "qwen3.7-plus")
  };
  const price = (alias: ModelAlias, prefix: string): ModelPrice | null => {
    const known = KNOWN_PRICES[models[alias]];
    const input = num(env[`RESUME_AI_PRICE_${prefix}_IN`], known?.input ?? -1, 100);
    const output = num(env[`RESUME_AI_PRICE_${prefix}_OUT`], known?.output ?? -1, 100);
    return input >= 0 && output >= 0 ? { input, output } : null;
  };
  const fastPrice = price("fast", "FAST");
  const rewritePrice = price("rewrite", "REWRITE");

  let baseUrl: string | null = null;
  const apiKey = env.RESUME_AI_API_KEY?.trim() || null;
  if (provider === "qwen") {
    const workspace = env.RESUME_AI_WORKSPACE_ID?.trim() ?? "";
    if (!WORKSPACE.test(workspace)) disabledReason = "falta RESUME_AI_WORKSPACE_ID";
    else if (!apiKey) disabledReason = "falta RESUME_AI_API_KEY";
    else if (!fastPrice || !rewritePrice) disabledReason = "modelo sin precio conocido (RESUME_AI_PRICE_*)";
    else baseUrl = usBaseUrl(workspace);
    if (disabledReason) provider = "none";
  }

  return {
    provider,
    disabledReason,
    baseUrl,
    apiKey: provider === "qwen" ? apiKey : null,
    models,
    // The mock is priced like the configured models so evals report a real-looking cost.
    prices: {
      fast: fastPrice ?? KNOWN_PRICES["qwen3.8-flash"],
      rewrite: rewritePrice ?? KNOWN_PRICES["qwen3.7-plus"]
    },
    caps: {
      adaptationUsd: num(env.RESUME_AI_CAP_ADAPTATION_USD, DEFAULT_CAPS.adaptationUsd, 10),
      userDailyUsd: num(env.RESUME_AI_CAP_USER_DAILY_USD, DEFAULT_CAPS.userDailyUsd, 50),
      globalDailyUsd: num(env.RESUME_AI_CAP_GLOBAL_DAILY_USD, DEFAULT_CAPS.globalDailyUsd, 500),
      globalMonthlyUsd: num(env.RESUME_AI_CAP_GLOBAL_MONTHLY_USD, DEFAULT_CAPS.globalMonthlyUsd, 5000)
    },
    copPerUsd: num(env.RESUME_AI_COP_PER_USD, 4000, 20000),
    timeoutMs: num(env.RESUME_AI_TIMEOUT_MS, 30000, 120000)
  };
}

/** Cost in micro-USD (integer, rounded up) for a number of tokens at a price per million. */
export function costMicros(price: ModelPrice, inputTokens: number, outputTokens: number): number {
  return Math.ceil(inputTokens * price.input + outputTokens * price.output);
}
