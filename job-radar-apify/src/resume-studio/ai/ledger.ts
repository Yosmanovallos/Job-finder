import type { AiCaps } from "./config.js";

// AI Resume Studio R3 — the cost ledger and the hard caps (ADR 0017 §4).
// A row never holds content: ids, prompt id/version, model, token counts,
// cost and status. Before every model call the gateway RESERVES the worst
// case (estimated input + max_tokens at list price) and only calls when all
// four caps still hold after that reservation:
//   adaptation · user per day · global per day · global per month
// Days and months are Colombian (UTC−5, no DST). The PostgreSQL ledger
// does the check-and-insert under one advisory lock, so two concurrent
// requests can't both squeeze under a cap.

export type UsageStatus = "start" | "reserved" | "ok" | "invalid_json" | "error" | "cache_hit";

export type CapName = "adaptation" | "user_daily" | "global_daily" | "global_monthly" | "chat_turns";

export interface ReserveRequest {
  userId: string;
  adaptationId: string;
  purpose: string;
  promptId: string;
  promptVersion: number;
  alias: string;
  model: string;
  attempt: number;
  maxCostMicros: number;
  caps: AiCaps;
  /** For «chat»: max first attempts allowed in this adaptation. */
  maxPurposeTurns?: number;
  now?: Date;
}

export type ReserveResult = { ok: true; reservationId: string } | { ok: false; cap: CapName };

export interface SettleUsage {
  status: Exclude<UsageStatus, "start" | "reserved" | "cache_hit">;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  costMicros: number;
  latencyMs: number;
}

export interface UsageRow {
  id: string;
  userId: string | null;
  adaptationId: string | null;
  purpose: string;
  promptId: string | null;
  promptVersion: number | null;
  alias: string | null;
  model: string | null;
  attempt: number;
  status: UsageStatus;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  costMicros: number;
  cacheHit: boolean;
  latencyMs: number;
  createdAt: Date;
}

export interface UsageLedger {
  startAdaptation(userId: string, adaptationId: string, now?: Date): Promise<void>;
  ownsAdaptation(userId: string, adaptationId: string): Promise<boolean>;
  /** R4c: inserts the «start» row only if the id is new (atomic). True when this call created it. */
  claimAdaptation(userId: string, adaptationId: string, now?: Date): Promise<boolean>;
  /** R4c: undoes a claim that never started (quota refused). Only a bare «start» row is removed. */
  unclaimAdaptation(userId: string, adaptationId: string): Promise<void>;
  reserve(request: ReserveRequest): Promise<ReserveResult>;
  settle(reservationId: string, usage: SettleUsage): Promise<void>;
  recordCacheHit(request: Omit<ReserveRequest, "maxCostMicros" | "caps" | "maxPurposeTurns">): Promise<void>;
}

const DAY_MS = 86_400_000;
const CO_OFFSET_MS = 5 * 3_600_000;

/** Start of the Colombian day and month containing `now`, as UTC instants. */
export function colombiaWindows(now: Date): { dayStart: Date; monthStart: Date } {
  const local = new Date(now.getTime() - CO_OFFSET_MS);
  const dayStart = new Date(Math.floor(local.getTime() / DAY_MS) * DAY_MS + CO_OFFSET_MS);
  const monthStart = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) + CO_OFFSET_MS);
  return { dayStart, monthStart };
}

export const usd = (micros: number) => micros / 1_000_000;
const micros = (usdValue: number) => Math.floor(usdValue * 1_000_000);

/** Which cap a reservation would break, given current sums (all in micro-USD). */
export function capBroken(
  sums: { adaptation: number; userDaily: number; globalDaily: number; globalMonthly: number },
  add: number,
  caps: AiCaps
): CapName | null {
  if (sums.adaptation + add > micros(caps.adaptationUsd)) return "adaptation";
  if (sums.userDaily + add > micros(caps.userDailyUsd)) return "user_daily";
  if (sums.globalDaily + add > micros(caps.globalDailyUsd)) return "global_daily";
  if (sums.globalMonthly + add > micros(caps.globalMonthlyUsd)) return "global_monthly";
  return null;
}

/** In-process ledger for unit tests and offline evals. */
export class MemoryLedger implements UsageLedger {
  rows: UsageRow[] = [];
  private seq = 0;

  private add(row: Omit<UsageRow, "id">): UsageRow {
    const full = { ...row, id: String(++this.seq) };
    this.rows.push(full);
    return full;
  }

  async startAdaptation(userId: string, adaptationId: string, now = new Date()): Promise<void> {
    this.add(blankRow({ userId, adaptationId, purpose: "start", status: "start", createdAt: now }));
  }

  async ownsAdaptation(userId: string, adaptationId: string): Promise<boolean> {
    return this.rows.some((r) => r.status === "start" && r.userId === userId && r.adaptationId === adaptationId);
  }

  async claimAdaptation(userId: string, adaptationId: string, now = new Date()): Promise<boolean> {
    if (this.rows.some((r) => r.status === "start" && r.adaptationId === adaptationId)) return false;
    await this.startAdaptation(userId, adaptationId, now);
    return true;
  }

  async unclaimAdaptation(userId: string, adaptationId: string): Promise<void> {
    if (this.rows.some((r) => r.adaptationId === adaptationId && r.status !== "start")) return;
    this.rows = this.rows.filter((r) => !(r.status === "start" && r.userId === userId && r.adaptationId === adaptationId));
  }

  async reserve(request: ReserveRequest): Promise<ReserveResult> {
    const now = request.now ?? new Date();
    const { dayStart, monthStart } = colombiaWindows(now);
    const sum = (pred: (r: UsageRow) => boolean) => this.rows.filter(pred).reduce((acc, r) => acc + r.costMicros, 0);
    if (request.maxPurposeTurns !== undefined) {
      const turns = this.rows.filter(
        (r) => r.adaptationId === request.adaptationId && r.purpose === request.purpose && r.attempt === 1 && r.status !== "start"
      ).length;
      if (request.attempt === 1 && turns >= request.maxPurposeTurns) return { ok: false, cap: "chat_turns" };
    }
    const broken = capBroken(
      {
        adaptation: sum((r) => r.adaptationId === request.adaptationId),
        userDaily: sum((r) => r.userId === request.userId && r.createdAt >= dayStart),
        globalDaily: sum((r) => r.createdAt >= dayStart),
        globalMonthly: sum((r) => r.createdAt >= monthStart)
      },
      request.maxCostMicros,
      request.caps
    );
    if (broken) return { ok: false, cap: broken };
    const row = this.add({
      ...blankRow({ userId: request.userId, adaptationId: request.adaptationId, purpose: request.purpose, status: "reserved", createdAt: now }),
      promptId: request.promptId,
      promptVersion: request.promptVersion,
      alias: request.alias,
      model: request.model,
      attempt: request.attempt,
      costMicros: request.maxCostMicros
    });
    return { ok: true, reservationId: row.id };
  }

  async settle(reservationId: string, usage: SettleUsage): Promise<void> {
    const row = this.rows.find((r) => r.id === reservationId);
    if (row) Object.assign(row, usage);
  }

  async recordCacheHit(request: Omit<ReserveRequest, "maxCostMicros" | "caps" | "maxPurposeTurns">): Promise<void> {
    this.add({
      ...blankRow({ userId: request.userId, adaptationId: request.adaptationId, purpose: request.purpose, status: "cache_hit", createdAt: request.now ?? new Date() }),
      promptId: request.promptId,
      promptVersion: request.promptVersion,
      alias: request.alias,
      model: request.model,
      attempt: request.attempt,
      cacheHit: true
    });
  }
}

function blankRow(base: { userId: string; adaptationId: string; purpose: string; status: UsageStatus; createdAt: Date }): Omit<UsageRow, "id"> {
  return {
    ...base,
    promptId: null,
    promptVersion: null,
    alias: null,
    model: null,
    attempt: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    costMicros: 0,
    cacheHit: false,
    latencyMs: 0
  };
}
