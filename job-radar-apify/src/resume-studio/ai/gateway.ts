import { createHash } from "node:crypto";
import { costMicros, type ResumeAiConfig } from "./config.js";
import type { CapName, UsageLedger } from "./ledger.js";
import { estimateTokens, type PromptSpec } from "./prompts.js";

// AI Resume Studio R3 — the only door to a model (ADR 0017 §4, AGENTS.md
// rules 11–12). Per call: provider switch → input budget → in-memory cache
// → reserve the worst-case cost under the four hard caps → call (no
// thinking, JSON mode, no tools) → strict schema → settle the real cost.
// At most 2 attempts, and the 2nd only when the JSON was invalid. No
// prompt, CV or answer text is ever logged or written to the ledger.

export interface TransportRequest {
  /** Not sent to the provider; lets the mock know which task it is. */
  promptId: string;
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  timeoutMs: number;
}

export interface TransportResponse {
  content: string;
  usage: { promptTokens: number; completionTokens: number; cachedTokens: number } | null;
  /** «stop», «length»… when the provider says it. */
  finishReason?: string | null;
}

/** Why an answer was rejected — field paths only, never content. */
export interface InvalidInfo {
  promptId: string;
  attempt: number;
  kind: "parse" | "schema" | "truncated";
  paths: string[];
}

/** R4c: one line per model call for diagnostics. Sizes and codes only, never content. */
export interface CallInfo {
  promptId: string;
  promptVersion: number;
  attempt: number;
  outcome: "ok" | "invalid" | "provider_error";
  /** Provider's finish_reason («stop», «length»…), when it sends one. */
  finishReason: string | null;
  completionTokens: number | null;
  maxOutputTokens: number;
  /** Characters of the answer (not the answer). */
  contentChars: number;
  latencyMs: number;
  invalidKind?: InvalidInfo["kind"];
}

export type Transport = (request: TransportRequest) => Promise<TransportResponse>;

export class ProviderError extends Error {
  constructor(readonly code: "timeout" | "http" | "network" | "too_large" | "bad_response", readonly status: number | null = null) {
    super(`proveedor IA: ${code}${status ? ` ${status}` : ""}`);
    this.name = "ProviderError";
  }
}

export interface CallContext {
  userId: string;
  adaptationId: string;
  purpose: string;
  /** Turn cap for this purpose inside the adaptation (chat: 8). */
  maxTurns?: number;
}

export type GatewayFailure = "ai_off" | "too_long" | "invalid_output" | "provider_error" | CapName;

export type GatewayResult<O> =
  | { ok: true; data: O; cached: boolean; attempts: number; costMicros: number }
  | { ok: false; code: GatewayFailure };

interface CacheEntry {
  value: unknown;
  expires: number;
}

export interface GatewayOptions {
  config: ResumeAiConfig;
  ledger: UsageLedger;
  transport: Transport | null;
  clock?: () => Date;
  cacheSize?: number;
  cacheTtlMs?: number;
  /** Diagnostics for invalid answers (evals). Receives no content. */
  onInvalid?: (info: InvalidInfo) => void;
  /** R4c: called after every provider call (runtime logs it). Receives no content. */
  onCall?: (info: CallInfo) => void;
}

export interface ResumeAiGateway {
  readonly enabled: boolean;
  readonly config: ResumeAiConfig;
  complete<I, O>(spec: PromptSpec<I, O>, input: I, ctx: CallContext): Promise<GatewayResult<O>>;
}

export function createGateway(options: GatewayOptions): ResumeAiGateway {
  const { config, ledger, transport } = options;
  const clock = options.clock ?? (() => new Date());
  const cacheSize = options.cacheSize ?? 500;
  const cacheTtlMs = options.cacheTtlMs ?? 6 * 3_600_000;
  // In memory only (never Postgres): entries hold model output derived from a CV.
  const cache = new Map<string, CacheEntry>();
  const enabled = config.provider !== "none" && transport !== null;

  const cacheGet = (key: string): unknown => {
    const hit = cache.get(key);
    if (!hit) return undefined;
    if (hit.expires < clock().getTime()) {
      cache.delete(key);
      return undefined;
    }
    cache.delete(key);
    cache.set(key, hit);
    return hit.value;
  };
  const cacheSet = (key: string, value: unknown) => {
    cache.set(key, { value, expires: clock().getTime() + cacheTtlMs });
    while (cache.size > cacheSize) cache.delete(cache.keys().next().value as string);
  };

  return {
    enabled,
    config,
    async complete<I, O>(spec: PromptSpec<I, O>, input: I, ctx: CallContext): Promise<GatewayResult<O>> {
      if (!enabled || !transport) return { ok: false, code: "ai_off" };
      const rendered = spec.render(input);
      const inputTokens = estimateTokens(rendered.system) + estimateTokens(rendered.user);
      if (inputTokens > spec.maxInputTokens) return { ok: false, code: "too_long" };

      const model = config.models[spec.alias];
      const price = config.prices[spec.alias];
      const key = createHash("sha256")
        .update(JSON.stringify([config.provider, model, spec.id, spec.version, rendered.system, rendered.user]))
        .digest("hex");
      const base = {
        userId: ctx.userId,
        adaptationId: ctx.adaptationId,
        purpose: ctx.purpose,
        promptId: spec.id,
        promptVersion: spec.version,
        alias: spec.alias,
        model
      };

      const cached = cacheGet(key);
      if (cached !== undefined) {
        await ledger.recordCacheHit({ ...base, attempt: 1, now: clock() });
        return { ok: true, data: cached as O, cached: true, attempts: 0, costMicros: 0 };
      }

      let spent = 0;
      let hint = "";
      for (let attempt = 1; attempt <= 2; attempt++) {
        const worst = costMicros(price, inputTokens, spec.maxOutputTokens);
        const reservation = await ledger.reserve({
          ...base,
          attempt,
          maxCostMicros: worst,
          caps: config.caps,
          maxPurposeTurns: ctx.maxTurns,
          now: clock()
        });
        if (!reservation.ok) return { ok: false, code: reservation.cap };

        const started = Date.now();
        let response: TransportResponse;
        try {
          response = await transport({
            promptId: spec.id,
            model,
            system: rendered.system + hint,
            user: rendered.user,
            maxTokens: spec.maxOutputTokens,
            timeoutMs: Math.max(config.timeoutMs, spec.timeoutMs ?? 0)
          });
        } catch (error) {
          // Unknown whether the provider billed the input: count it.
          const cost = costMicros(price, inputTokens, 0);
          await ledger.settle(reservation.reservationId, {
            status: "error",
            inputTokens,
            outputTokens: 0,
            cachedTokens: 0,
            costMicros: cost,
            latencyMs: Date.now() - started
          });
          console.warn(`[resume-ai] ${spec.id}@${spec.version} falló: ${error instanceof ProviderError ? error.code : "unknown"}`);
          options.onCall?.({
            promptId: spec.id,
            promptVersion: spec.version,
            attempt,
            outcome: "provider_error",
            finishReason: null,
            completionTokens: null,
            maxOutputTokens: spec.maxOutputTokens,
            contentChars: 0,
            latencyMs: Date.now() - started
          });
          return { ok: false, code: "provider_error" };
        }

        const usedIn = response.usage?.promptTokens ?? inputTokens;
        const usedOut = response.usage?.completionTokens ?? estimateTokens(response.content);
        const cachedTokens = response.usage?.cachedTokens ?? 0;
        // Alibaba bills cached input at ~20 % (implicit cache): conservative 20 % here.
        const cost = costMicros(price, Math.max(0, usedIn - cachedTokens) + cachedTokens * 0.2, usedOut);
        spent += cost;
        const parsed = parseJsonObject(response.content);
        const valid = parsed === undefined ? null : spec.schema.safeParse(parsed);
        await ledger.settle(reservation.reservationId, {
          status: valid?.success ? "ok" : "invalid_json",
          inputTokens: usedIn,
          outputTokens: usedOut,
          cachedTokens,
          costMicros: cost,
          latencyMs: Date.now() - started
        });
        const latencyMs = Date.now() - started;
        const callInfo: CallInfo = {
          promptId: spec.id,
          promptVersion: spec.version,
          attempt,
          outcome: valid?.success ? "ok" : "invalid",
          finishReason: response.finishReason ?? null,
          completionTokens: response.usage?.completionTokens ?? null,
          maxOutputTokens: spec.maxOutputTokens,
          contentChars: response.content.length,
          latencyMs
        };
        if (valid?.success) {
          options.onCall?.(callInfo);
          cacheSet(key, valid.data);
          return { ok: true, data: valid.data, cached: false, attempts: attempt, costMicros: spent };
        }
        const kind = response.finishReason === "length" ? "truncated" : parsed === undefined ? "parse" : "schema";
        const paths = valid && !valid.success ? [...new Set(valid.error.issues.map((i) => i.path.join(".") || "(raíz)"))].slice(0, 8) : [];
        options.onInvalid?.({ promptId: spec.id, attempt, kind, paths });
        options.onCall?.({ ...callInfo, invalidKind: kind });
        // The retry says what was wrong (field names only, nothing from the answer).
        hint =
          "\n\nCORRECCIÓN: tu respuesta anterior no fue válida (" +
          (kind === "truncated" ? "se cortó: responde más corto" : kind === "parse" ? "no era un objeto JSON" : `claves con problema: ${paths.join(", ")}`) +
          "). Responde SOLO el objeto JSON, con exactamente las claves del formato.";
      }
      return { ok: false, code: "invalid_output" };
    }
  };
}

/** The first JSON object of the content, or undefined. Tolerates ```json fences. */
export function parseJsonObject(content: string): unknown {
  const trimmed = content.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  const attempt = (text: string): unknown => {
    try {
      const value = JSON.parse(text);
      return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
    } catch {
      return undefined;
    }
  };
  const direct = attempt(trimmed);
  if (direct !== undefined) return direct;
  // «Claro, aquí está: {…}»: the outermost object, if it parses as a whole.
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  return first >= 0 && last > first ? attempt(trimmed.slice(first, last + 1)) : undefined;
}
