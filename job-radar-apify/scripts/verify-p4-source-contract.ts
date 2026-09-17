/**
 * Verificación de SOLO LECTURA para P4 (openspec p4-source-contract).
 * Cada consulta es un SELECT sobre `source_attempts` / `scrape_runs`.
 *
 * Responde la pregunta que el borrador de P4 exige contestar ANTES de
 * diseñar: qué fuentes se quedan sin presupuesto, cuáles fallan de verdad y
 * cuáles solo vienen vacías. Ese orden — y no la intuición — es el que
 * prioriza la adopción del contrato nuevo.
 *
 * Uso:
 *   npx tsx scripts/verify-p4-source-contract.ts
 *   npx tsx scripts/verify-p4-source-contract.ts --days 14
 */
import dotenv from "dotenv";
import { pool } from "../src/db/client.js";

dotenv.config();

const daysIndex = process.argv.indexOf("--days");
const days = daysIndex >= 0 ? Number(process.argv[daysIndex + 1]) : 7;

function pad(value: string | number | null, width: number): string {
  const text = value === null ? "—" : String(value);
  return text.length >= width ? text.slice(0, width) : text.padEnd(width);
}

async function main(): Promise<void> {
  console.log(`🔎 P4 (solo lectura) — source_attempts últimos ${days} días.\n`);

  const byStatus = await pool.query(
    `SELECT source_name, stage, status, reason, COUNT(*)::int AS n,
            AVG(duration_ms)::int AS avg_ms,
            SUM(COALESCE(received_count, 0))::int AS received,
            SUM(COALESCE(valid_count, 0))::int AS valid
       FROM source_attempts
      WHERE started_at > NOW() - ($1 || ' days')::interval
      GROUP BY 1, 2, 3, 4
      ORDER BY 1, 2, 5 DESC`,
    [days]
  );

  console.log("── Fuente × etapa × estado ──");
  console.log(
    pad("FUENTE", 18) + pad("ETAPA", 14) + pad("ESTADO", 16) +
      pad("RAZÓN", 30) + pad("N", 6) + pad("AVG_MS", 9) + pad("RECIB", 8) + "VÁLID"
  );
  for (const r of byStatus.rows) {
    console.log(
      pad(r.source_name, 18) + pad(r.stage, 14) + pad(r.status, 16) +
        pad(r.reason, 30) + pad(r.n, 6) + pad(r.avg_ms, 9) + pad(r.received, 8) + r.valid
    );
  }

  // Cuántas veces cada fuente ni siquiera arrancó por falta de presupuesto:
  // eso es lo que ordena la adopción, no el número bruto de fallos.
  const skipped = await pool.query(
    `SELECT source_name,
            COUNT(*) FILTER (WHERE status = 'skipped')::int AS skipped,
            COUNT(*)::int AS total,
            ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'skipped') / COUNT(*), 1) AS pct
       FROM source_attempts
      WHERE started_at > NOW() - ($1 || ' days')::interval AND stage = 'listing'
      GROUP BY 1 HAVING COUNT(*) FILTER (WHERE status = 'skipped') > 0
      ORDER BY pct DESC`,
    [days]
  );
  console.log("\n── Se quedan sin presupuesto (listing skipped) ──");
  if (skipped.rowCount === 0) console.log("(ninguna)");
  for (const r of skipped.rows) {
    console.log(`${pad(r.source_name, 18)} ${pad(r.skipped, 6)}/${pad(r.total, 6)} = ${r.pct}%`);
  }

  // Percentiles reales de duración: recalibran SOURCE_LISTING_ESTIMATE_MS
  // sin inventar constantes (lección de P3).
  const durations = await pool.query(
    `SELECT source_name, COUNT(*)::int AS n,
            PERCENTILE_DISC(0.5) WITHIN GROUP (ORDER BY duration_ms)::int AS p50,
            PERCENTILE_DISC(0.95) WITHIN GROUP (ORDER BY duration_ms)::int AS p95,
            MAX(duration_ms)::int AS max_ms
       FROM source_attempts
      WHERE started_at > NOW() - ($1 || ' days')::interval
        AND stage = 'listing' AND duration_ms IS NOT NULL
        AND status NOT IN ('skipped', 'running')
      GROUP BY 1 ORDER BY p50 DESC NULLS LAST`,
    [days]
  );
  console.log("\n── Duración de listado (recalibra SOURCE_LISTING_ESTIMATE_MS) ──");
  console.log(pad("FUENTE", 18) + pad("N", 6) + pad("P50", 10) + pad("P95", 10) + "MAX");
  for (const r of durations.rows) {
    console.log(pad(r.source_name, 18) + pad(r.n, 6) + pad(r.p50, 10) + pad(r.p95, 10) + r.max_ms);
  }

  // La distinción que P4 lleva al contrato: ¿"vacío" es de verdad vacío?
  const emptiness = await pool.query(
    `SELECT source_name,
            COUNT(*) FILTER (WHERE status = 'success')::int AS ok,
            COUNT(*) FILTER (WHERE status = 'empty')::int AS empty,
            COUNT(*) FILTER (WHERE status IN ('failed','blocked','timeout','rate_limited',
                                              'quota_exhausted','misconfigured','schema_changed'))::int AS bad,
            SUM(COALESCE(received_count,0))::int AS received,
            SUM(COALESCE(valid_count,0))::int AS valid
       FROM source_attempts
      WHERE started_at > NOW() - ($1 || ' days')::interval AND stage = 'listing'
      GROUP BY 1 ORDER BY bad DESC, empty DESC`,
    [days]
  );
  console.log("\n── ¿El vacío es vacío? (listing) ──");
  console.log(pad("FUENTE", 18) + pad("OK", 6) + pad("EMPTY", 7) + pad("MALO", 7) + pad("RECIB", 8) + "VÁLID");
  for (const r of emptiness.rows) {
    console.log(
      pad(r.source_name, 18) + pad(r.ok, 6) + pad(r.empty, 7) + pad(r.bad, 7) +
        pad(r.received, 8) + r.valid
    );
  }

  // ¿Se abre alguna vez el circuito de detalle? `executeWithResilience` llama
  // a `recordSuccess` con CUALQUIER array, y el sitio de llamada convierte
  // `fetchDetail() === null` en `[]` — así que un detalle nulo cuenta como
  // éxito y reinicia el contador. Si esto es cierto, `failures` nunca sube.
  const circuits = await pool.query(
    `SELECT source_name, failures, open_until,
            (open_until IS NOT NULL AND open_until > NOW()) AS is_open
       FROM source_circuit_state ORDER BY source_name`
  );
  console.log("\n── Estado del circuito por fuente (listado vs. -detail) ──");
  console.log(pad("FUENTE", 26) + pad("FALLOS", 8) + pad("ABIERTO", 9) + "OPEN_UNTIL");
  for (const r of circuits.rows) {
    console.log(
      pad(r.source_name, 26) + pad(r.failures, 8) + pad(String(r.is_open), 9) +
        (r.open_until ? new Date(r.open_until).toISOString() : "—")
    );
  }

  // Coste real por página de detalle: calibra BUDGET_ESTIMATES.detailFetch
  // (distinto de SOURCE_LISTING_ESTIMATE_MS, que se recalibra aparte con
  // verify-p3-deadlines.ts --durations).
  //
  // Se mide POR INTENTO (duration_ms / páginas de ese intento) y se reportan
  // percentiles, no una media global: una media reparte el coste de los
  // intentos lentos entre las páginas de los rápidos y subestima justo el
  // caso que el presupuesto tiene que cubrir. `hasBudgetFor` decide si vale
  // la pena EMPEZAR una página más, así que la cifra útil es el p95.
  //
  // Incluye la pausa deliberada (3-6 s antes de la primera página, 1-3 s
  // entre páginas — ver enrichNewJobs), así que es coste de pared, no de
  // transporte: que es exactamente lo que el plazo tiene que pagar.
  const detailCost = await pool.query(
    `WITH per_attempt AS (
       SELECT source_name,
              LEAST(COALESCE(received_count, 0) - COALESCE(filtered_count, 0), 8) AS pages,
              duration_ms
         FROM source_attempts
        WHERE started_at > NOW() - ($1 || ' days')::interval
          AND stage = 'detail' AND duration_ms IS NOT NULL
          AND LEAST(COALESCE(received_count, 0) - COALESCE(filtered_count, 0), 8) > 0
     )
     SELECT source_name, COUNT(*)::int AS attempts, SUM(pages)::int AS pages,
            PERCENTILE_DISC(0.5)  WITHIN GROUP (ORDER BY duration_ms / pages)::int AS p50,
            PERCENTILE_DISC(0.95) WITHIN GROUP (ORDER BY duration_ms / pages)::int AS p95,
            MAX(duration_ms / pages)::int AS max_ms
       FROM per_attempt GROUP BY 1 ORDER BY p95 DESC`,
    [days]
  );
  console.log("\n── ms por página de detalle (calibra BUDGET_ESTIMATES.detailFetch) ──");
  console.log(pad("FUENTE", 20) + pad("INT", 6) + pad("PÁGS", 7) + pad("P50", 8) + pad("P95", 8) + "MAX");
  for (const r of detailCost.rows) {
    console.log(
      pad(r.source_name, 20) + pad(r.attempts, 6) + pad(r.pages, 7) +
        pad(r.p50, 8) + pad(r.p95, 8) + r.max_ms
    );
  }

  const detailGlobal = await pool.query(
    `WITH per_attempt AS (
       SELECT LEAST(COALESCE(received_count, 0) - COALESCE(filtered_count, 0), 8) AS pages, duration_ms
         FROM source_attempts
        WHERE started_at > NOW() - ($1 || ' days')::interval
          AND stage = 'detail' AND duration_ms IS NOT NULL
          AND LEAST(COALESCE(received_count, 0) - COALESCE(filtered_count, 0), 8) > 0
     )
     SELECT COUNT(*)::int AS attempts,
            PERCENTILE_DISC(0.5)  WITHIN GROUP (ORDER BY duration_ms / pages)::int AS p50,
            PERCENTILE_DISC(0.95) WITHIN GROUP (ORDER BY duration_ms / pages)::int AS p95,
            MAX(duration_ms / pages)::int AS max_ms
       FROM per_attempt`
  , [days]);
  const g = detailGlobal.rows[0];
  console.log(
    `GLOBAL  intentos=${g.attempts}  p50=${g.p50}ms  p95=${g.p95}ms  max=${g.max_ms}ms`
  );

  await pool.end();
}

main().catch(async (error) => {
  console.error("❌", error instanceof Error ? error.message : error);
  await pool.end().catch(() => {});
  process.exit(1);
});
