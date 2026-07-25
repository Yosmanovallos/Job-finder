/**
 * Randomized pause between requests to the same fragile source (no official
 * API, "Ninguna" protección per the master plan's per-source table).
 * `ai-role-agent.ts` expands one role into ~15-20 keyword variants — without
 * this, an adapter fires that many requests back-to-back with nothing but
 * network latency between them, which reads as bot traffic to the portal.
 */
export async function jitterDelay(minMs = 1000, maxMs = 3000): Promise<void> {
  const delay = minMs + Math.random() * (maxMs - minMs);
  await new Promise((resolve) => setTimeout(resolve, delay));
}
