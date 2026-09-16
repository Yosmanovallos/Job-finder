import { sleepWithContext, type FetchContext } from "./fetch-context.js";

/**
 * Randomized pause between requests to the same fragile source (no official
 * API, "Ninguna" protección per the master plan's per-source table).
 * `ai-role-agent.ts` expands one role into ~15-20 keyword variants — without
 * this, an adapter fires that many requests back-to-back with nothing but
 * network latency between them, which reads as bot traffic to the portal.
 *
 * P3: with a `ctx`, the wait ends when the tick's deadline passes instead of
 * sleeping through it. These pauses are small individually but add up to
 * ~50s per adapter during detail enrichment — time that was being spent
 * waiting to start work the tick had already run out of budget for.
 */
export async function jitterDelay(minMs = 1000, maxMs = 3000, ctx?: FetchContext): Promise<void> {
  const delay = minMs + Math.random() * (maxMs - minMs);
  await sleepWithContext(delay, ctx);
}
