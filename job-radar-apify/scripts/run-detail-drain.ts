/**
 * Dedicated detail drain (Fase 5, 2026-10-25), run as its own workflow step
 * right after the scrape tick.
 *
 * The tick's own end-of-run drain only gets whatever time the listings leave,
 * which in practice was none: on 2026-10-25 it reached 8 LinkedIn rows and
 * never Magneto (0 attempts in 48 h, 1,309 pending). This step has its own
 * budget, so descriptions advance without taking a second from listing
 * ingestion. Same state machine, caps, circuits, jitter and refusal handling
 * as the tick; healthy robots-allowed sources first (DETAIL_ADAPTERS order),
 * each with a fair slice of the budget.
 */
import dotenv from "dotenv";
import { allAdapters } from "../src/sources/index.js";
import { pool } from "../src/db/client.js";
import { createFetchContext } from "../src/engine/fetch-context.js";
import { drainDetailQueue, formatDrainLine } from "../src/queue/detail-enrichment.js";

dotenv.config();

const TICK_COUNTRY = (process.env.TICK_COUNTRY || "CO").toUpperCase();
const DEFAULT_BUDGET_MS = 7 * 60 * 1000;
const MAX_BUDGET_MS = 10 * 60 * 1000;
const POOL_CLOSE_TIMEOUT_MS = 10 * 1000;

function budgetMs(): number {
  const requested = Number(process.env.DETAIL_DRAIN_BUDGET_MS);
  if (!Number.isFinite(requested) || requested <= 0) return DEFAULT_BUDGET_MS;
  return Math.min(requested, MAX_BUDGET_MS);
}

async function main(): Promise<void> {
  const budget = budgetMs();
  const ctx = createFetchContext(budget);
  console.log(`🧾 [Drain] TICK_COUNTRY=${TICK_COUNTRY} · presupuesto ${Math.round(budget / 1000)}s`);
  const marketAdapters = allAdapters.filter((adapter) =>
    TICK_COUNTRY === "VE" ? adapter.name.endsWith("-VE") : !adapter.name.endsWith("-VE")
  );
  try {
    const drained = await drainDetailQueue(marketAdapters, ctx);
    let lines = 0;
    for (const [name, counters] of Object.entries(drained)) {
      const line = formatDrainLine(name, counters);
      if (line) {
        console.log(line);
        lines++;
      }
    }
    if (lines === 0) console.log("🧾 [Drain] Nada pendiente de detalle en este mercado.");
  } finally {
    ctx.dispose();
    await Promise.race([pool.end(), new Promise((resolve) => setTimeout(resolve, POOL_CLOSE_TIMEOUT_MS).unref?.())]);
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error("⚠️ [Drain] Falló:", (error as Error)?.name);
    process.exit(1);
  }
);
