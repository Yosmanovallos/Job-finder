/**
 * Verificación de SOLO LECTURA de P3 (openspec p3-execution-deadlines).
 * No escribe, no borra, no modifica nada: cada consulta es un SELECT sobre
 * `scrape_runs` / `source_attempts`.
 *
 * Compara ejecuciones antes y después de un despliegue, fuente por fuente,
 * que es el método que exige `tasks.md` §4. Reutilizable para el canario
 * pendiente de Node 24.
 *
 * Uso:
 *   npx tsx scripts/verify-p3-deadlines.ts
 *   npx tsx scripts/verify-p3-deadlines.ts --limit 10
 */
import dotenv from "dotenv";
import { pool } from "../src/db/client.js";

dotenv.config();

const limitIndex = process.argv.indexOf("--limit");
const limit = limitIndex >= 0 ? Number(process.argv[limitIndex + 1]) : 6;

interface RunRow {
  id: string;
  country: string | null;
  status: string;
  reason: string | null;
  started_at: Date;
  secs: number | null;
  git_sha: string | null;
  jobs_new: number | null;
}

async function main(): Promise<void> {
  console.log("🔎 Verificación P3 (solo lectura) — compara ejecuciones antes/después.\n");

  const runs = await pool.query<RunRow>(
    `SELECT id, country, status, reason, started_at, git_sha, jobs_new,
            EXTRACT(EPOCH FROM (finished_at - started_at))::int AS secs
       FROM scrape_runs
      WHERE workflow = 'scrape-tick'
      ORDER BY started_at DESC
      LIMIT $1`,
    [limit]
  );

  console.log("Ejecuciones (más reciente primero):");
  console.log("  fecha              país commit   estado / motivo                  dur    nuevas");
  for (const r of runs.rows) {
    const when = r.started_at.toISOString().slice(0, 16).replace("T", " ");
    const sha = (r.git_sha ?? "—").slice(0, 7).padEnd(8);
    const outcome = `${r.status} / ${r.reason ?? "—"}`.padEnd(32);
    const dur = r.secs === null ? "en curso" : `${Math.floor(r.secs / 60)}m${String(r.secs % 60).padStart(2, "0")}s`;
    const flag = r.status === "timeout" ? " ⚠️" : "";
    console.log(`  ${when}  ${(r.country ?? "—").padEnd(4)} ${sha} ${outcome} ${dur.padEnd(7)} ${String(r.jobs_new ?? 0).padStart(4)}${flag}`);
  }

  // Gate EXE-006: ninguna ejecución debe terminar por vencimiento del plazo.
  const timedOut = runs.rows.filter((r) => r.status === "timeout");
  console.log(
    `\n${timedOut.length === 0 ? "✅" : "⚠️"} Ejecuciones terminadas por plazo vencido: ${timedOut.length}/${runs.rows.length}`
  );

  // Gate EXE-002/006: duración real frente al presupuesto de 20 min.
  const over = runs.rows.filter((r) => (r.secs ?? 0) > 20 * 60);
  console.log(`${over.length === 0 ? "✅" : "⚠️"} Ejecuciones por encima de los 20 min: ${over.length}`);

  // Comparación por fuente entre las dos ejecuciones más recientes del mismo país.
  const byCountry = new Map<string, RunRow[]>();
  for (const r of runs.rows) {
    const key = r.country ?? "—";
    if (!byCountry.has(key)) byCountry.set(key, []);
    byCountry.get(key)!.push(r);
  }

  for (const [country, list] of byCountry) {
    if (list.length < 2) continue;
    const [after, before] = list;
    if (after.git_sha === before.git_sha) continue;

    console.log(`\n── ${country}: ${String(before.git_sha).slice(0, 7)} → ${String(after.git_sha).slice(0, 7)} ──`);
    const rows = await pool.query<{ source_name: string; run_id: string; status: string; reason: string | null; received: number | null }>(
      `SELECT source_name, run_id::text, status, reason, received_count AS received
         FROM source_attempts
        WHERE run_id = ANY($1::uuid[]) AND stage = 'listing'
        ORDER BY source_name`,
      [[before.id, after.id]]
    );

    const sources = [...new Set(rows.rows.map((r) => r.source_name))].sort();
    console.log("  fuente            antes                 después");
    for (const source of sources) {
      const b = rows.rows.find((r) => r.source_name === source && r.run_id === before.id);
      const a = rows.rows.find((r) => r.source_name === source && r.run_id === after.id);
      const fmt = (x?: { status: string; reason: string | null; received: number | null }) =>
        x ? `${x.status}/${x.reason ?? "—"} (${x.received ?? 0})` : "ausente";
      // Una fuente que pasa de presente a ausente, o de éxito a bloqueo, es
      // lo que hay que mirar: ahí es donde un cambio de runtime se nota.
      const worse = b && a && b.status === "success" && a.status !== "success";
      const gone = b && !a;
      const mark = worse || gone ? " ⚠️" : "";
      console.log(`  ${source.padEnd(17)} ${fmt(b).padEnd(21)} ${fmt(a)}${mark}`);
    }
  }

  await pool.end();
}

main().catch(async (err) => {
  console.error("❌", err?.message || err);
  await pool.end();
  process.exit(1);
});
