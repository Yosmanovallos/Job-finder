/**
 * Verificación de SOLO LECTURA de la observabilidad P2 (openspec
 * p2-run-observability). No escribe, no borra, no modifica nada: cada
 * consulta es un SELECT sobre catálogos del sistema o sobre las dos tablas
 * nuevas (`scrape_runs`, `source_attempts`).
 *
 * Uso:
 *   npx tsx scripts/verify-p2-observability.ts
 *   npx tsx scripts/verify-p2-observability.ts --url https://tu-sitio.com
 *
 * Con `--url` mide además el p95 de GET /api/runs (30 peticiones GET al
 * sitio indicado; ninguna escribe nada).
 */
import dotenv from "dotenv";
import { pool } from "../src/db/client.js";

dotenv.config();

const urlIndex = process.argv.indexOf("--url");
const siteUrl = urlIndex >= 0 ? process.argv[urlIndex + 1] : undefined;
const P95_REQUESTS = 30;

let failures = 0;

function report(ok: boolean, label: string, detail: string): void {
  if (!ok) failures++;
  console.log(`${ok ? "✅" : "❌"} ${label}: ${detail}`);
}

async function main(): Promise<void> {
  console.log("🔎 Verificación P2 (solo lectura) — no modifica ninguna tabla.\n");

  // 1. ¿Existen las dos tablas nuevas?
  const tables = await pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('scrape_runs', 'source_attempts')
      ORDER BY table_name`
  );
  const found = tables.rows.map((row) => row.table_name);
  const migrated = found.length === 2;
  report(migrated, "Migración aplicada", migrated ? "scrape_runs y source_attempts existen" : `faltan tablas (encontradas: ${found.join(", ") || "ninguna"}) — corre: npx tsx scripts/migrate.ts`);

  if (!migrated) {
    console.log("\nSin las tablas no hay más que verificar. Las vacantes no se ven afectadas: el tick sigue guardándolas y /api/runs responde 503 hasta aplicar la migración.");
    await pool.end();
    process.exitCode = 1;
    return;
  }

  // 2. RLS activo (protección de Supabase para la clave pública del navegador).
  const rls = await pool.query<{ relname: string; relrowsecurity: boolean }>(
    `SELECT relname, relrowsecurity FROM pg_class
      WHERE relname IN ('scrape_runs', 'source_attempts') ORDER BY relname`
  );
  const rlsOk = rls.rows.length === 2 && rls.rows.every((row) => row.relrowsecurity);
  report(rlsOk, "RLS activo en ambas tablas", rls.rows.map((row) => `${row.relname}=${row.relrowsecurity}`).join(", "));

  // 3. Cero permisos para los roles públicos de Supabase.
  const grants = await pool.query<{ total: string }>(
    `SELECT COUNT(*) AS total FROM information_schema.role_table_grants
      WHERE grantee IN ('anon', 'authenticated')
        AND table_name IN ('scrape_runs', 'source_attempts')`
  );
  const grantCount = Number(grants.rows[0]?.total ?? "0");
  report(grantCount === 0, "Sin permisos para anon/authenticated", `${grantCount} grants`);

  // 4. Tamaño ocupado (límite de almacenamiento del plan de Supabase).
  const size = await pool.query<{ runs: string; attempts: string; run_rows: string; attempt_rows: string }>(
    `SELECT pg_size_pretty(pg_total_relation_size('scrape_runs')) AS runs,
            pg_size_pretty(pg_total_relation_size('source_attempts')) AS attempts,
            (SELECT COUNT(*) FROM scrape_runs)::text AS run_rows,
            (SELECT COUNT(*) FROM source_attempts)::text AS attempt_rows`
  );
  const sizeRow = size.rows[0];
  console.log(`ℹ️  Tamaño: scrape_runs ${sizeRow.runs} (${sizeRow.run_rows} filas), source_attempts ${sizeRow.attempts} (${sizeRow.attempt_rows} filas).`);
  console.log("   Referencia: si en una semana source_attempts pasa de ~15 MB, conviene bajar la retención de 30 a 14 días.");

  // 5. Últimas ejecuciones y estado de cada fuente.
  const runs = await pool.query<{ workflow: string; country: string | null; status: string; reason: string | null; started_at: Date; jobs_new: number }>(
    `SELECT workflow, country, status, reason, started_at, jobs_new
       FROM scrape_runs ORDER BY started_at DESC LIMIT 5`
  );
  if (runs.rows.length === 0) {
    console.log("ℹ️  Todavía no hay ejecuciones registradas (normal antes del primer tick con el código desplegado).");
  } else {
    console.log("\nÚltimas ejecuciones:");
    for (const run of runs.rows) {
      console.log(`   ${run.started_at.toISOString()} ${run.workflow} ${run.country ?? "—"} → ${run.status}${run.reason ? ` (${run.reason})` : ""}, ${run.jobs_new} vacantes nuevas`);
    }
    const bySource = await pool.query<{ source_name: string; status: string; reason: string | null; n: string }>(
      `SELECT source_name, status, reason, COUNT(*)::text AS n
         FROM source_attempts
        WHERE started_at > NOW() - INTERVAL '24 hours' AND stage = 'listing'
        GROUP BY source_name, status, reason
        ORDER BY source_name`
    );
    if (bySource.rows.length > 0) {
      console.log("\nFuentes en las últimas 24 h (esto es lo que antes se veía como '0 resultados'):");
      for (const row of bySource.rows) {
        const flag = ["success", "empty", "skipped"].includes(row.status) ? " " : "⚠️";
        console.log(`   ${flag} ${row.source_name}: ${row.status}${row.reason ? ` / ${row.reason}` : ""} (${row.n})`);
      }
    }
    const stuck = await pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM scrape_runs
        WHERE status = 'running' AND heartbeat_at < NOW() - INTERVAL '30 minutes'`
    );
    const stuckCount = Number(stuck.rows[0]?.total ?? "0");
    report(stuckCount === 0, "Sin ejecuciones muertas pendientes de reconciliar", `${stuckCount} (se reconcilian solas en el siguiente tick)`);
  }

  // 6. p95 de /api/runs (opcional, solo GET).
  if (siteUrl) {
    const endpoint = new URL("/api/runs", siteUrl).toString();
    const times: number[] = [];
    let lastStatus = 0;
    for (let i = 0; i < P95_REQUESTS; i++) {
      const started = performance.now();
      const response = await fetch(endpoint);
      await response.text();
      lastStatus = response.status;
      times.push(performance.now() - started);
    }
    times.sort((a, b) => a - b);
    const p95 = Math.round(times[Math.ceil(times.length * 0.95) - 1]);
    report(lastStatus === 200, `Respuesta de ${endpoint}`, `HTTP ${lastStatus}${lastStatus === 503 ? " — falta aplicar la migración" : ""}`);
    report(p95 < 800, "p95 de /api/runs", `${p95} ms (mediana ${Math.round(times[Math.floor(times.length / 2)])} ms, objetivo < 800 ms)`);
  } else {
    console.log("\nℹ️  Para medir la velocidad de /api/runs vuelve a correr con: --url https://tu-sitio.com");
  }

  await pool.end();
  console.log(failures === 0 ? "\n🎉 Todo correcto." : `\n⚠️  ${failures} verificación(es) fallida(s) — revisa arriba.`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch(async (error: unknown) => {
  console.error("❌ Falló la verificación:", error instanceof Error ? error.message : error);
  await pool.end();
  process.exitCode = 1;
});
