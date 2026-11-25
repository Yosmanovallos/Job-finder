// AI Resume Studio R4: pass catalog (ADR 0017 §5, doc 06 §9.3, doc 11 §6).
// One-time payments with NO automatic renewal. Prices include IVA and are
// constants on purpose: the final price (D2) and the tax status are still
// open with the owner and the accountant. Pure module with no Node imports,
// shared by the server and the pass screen.

export const PASS_IDS = ["pass_7d", "pass_1m", "pass_3m"] as const;
export type PassId = (typeof PASS_IDS)[number];

export interface PassDefinition {
  id: PassId;
  name: string;
  /** Total charged once, COP, IVA included. */
  priceCop: number;
  durationDays: number;
  /** Adaptations allowed in each period of `periodDays`. */
  adaptationsPerPeriod: number;
  periodDays: number;
  recommended: boolean;
}

export const RESUME_PASSES: Record<PassId, PassDefinition> = {
  pass_7d: { id: "pass_7d", name: "Pase 7 días", priceCop: 6900, durationDays: 7, adaptationsPerPeriod: 10, periodDays: 7, recommended: false },
  pass_1m: { id: "pass_1m", name: "Pase 1 mes", priceCop: 14900, durationDays: 30, adaptationsPerPeriod: 30, periodDays: 30, recommended: false },
  pass_3m: { id: "pass_3m", name: "Pase 3 meses", priceCop: 29700, durationDays: 90, adaptationsPerPeriod: 30, periodDays: 30, recommended: true }
};

/**
 * Adaptations without a pass, per calendar month (Colombia time). The task
 * and the docs do not fix this number: owner decision, kept small so the
 * free tier cannot outspend the paid one.
 */
export const RESUME_FREE_ADAPTATIONS = 2;

export const RESUME_PASS_REFERENCE_PREFIX = "rs_pass_";

export function isPassId(value: unknown): value is PassId {
  return typeof value === "string" && (PASS_IDS as readonly string[]).includes(value);
}

export function passAmountInCents(passId: PassId): number {
  return RESUME_PASSES[passId].priceCop * 100;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Start of the quota period that contains `now` for a pass that began at `startsAt`. */
export function passPeriodStart(startsAt: Date, periodDays: number, now: Date): Date {
  const elapsed = Math.max(0, now.getTime() - startsAt.getTime());
  const index = Math.floor(elapsed / (periodDays * DAY_MS));
  return new Date(startsAt.getTime() + index * periodDays * DAY_MS);
}

export function passPeriodEnd(startsAt: Date, periodDays: number, now: Date, expiresAt: Date): Date {
  const end = new Date(passPeriodStart(startsAt, periodDays, now).getTime() + periodDays * DAY_MS);
  return end < expiresAt ? end : expiresAt;
}

/** First instant of the calendar month in Colombia (UTC−5, no DST) that contains `now`. */
export function freePeriodStart(now: Date): Date {
  const local = new Date(now.getTime() - 5 * 60 * 60 * 1000);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1, 5, 0, 0));
}

export function freePeriodEnd(now: Date): Date {
  const start = freePeriodStart(now);
  const local = new Date(start.getTime() - 5 * 60 * 60 * 1000);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1, 5, 0, 0));
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export function formatCop(value: number): string {
  return `COP ${value.toLocaleString("es-CO")}`;
}
