import "./require-isolated-database.js";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { pool } from "../src/db/client.js";
import { deleteClosedJobs } from "../src/db/scheduler-repository.js";
import { markClosureChecked, pickJobsForClosureCheck } from "../src/db/source-closure-repository.js";
import { verifyTorreClosures, type ClosureDeps } from "../src/queue/source-closure.js";
import type { TorreStatusVerdict } from "../src/sources/torre-status.js";

/**
 * Source-closure check against the disposable Postgres: real SQL for the
 * migration block, the rotation cursor, the delete and the 410 tombstone.
 * Torre itself is never contacted (verdicts injected).
 */
let failures = 0;
function check(condition: boolean, pass: string, fail: string): void {
  if (condition) console.log(`OK  ${pass}`);
  else {
    console.error(`ERR ${fail}`);
    failures++;
  }
}

const tag = randomUUID().slice(0, 8);
const ids = { closed: `C${tag}`, open: `O${tag}`, gone: `G${tag}` };

function depsWith(verdicts: Record<string, TorreStatusVerdict>): ClosureDeps {
  return {
    pick: pickJobsForClosureCheck,
    markChecked: markClosureChecked,
    deleteClosed: deleteClosedJobs,
    check: async (externalId) => verdicts[externalId] ?? { kind: "unknown", reason: "not_in_test" }
  };
}

async function run(): Promise<void> {
  console.log("\n--- Cierre confirmado por la fuente (Torre) ---\n");

  // Before the migration: a clean skip, not a crash of the tick.
  const hasColumn = await pool.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = 'jobs' AND column_name = 'source_checked_at'`
  );
  if (hasColumn.rowCount === 0) {
    const skipped = await verifyTorreClosures(undefined, { deps: depsWith({}) });
    check(skipped.skipped === "missing_column", "Sin migración el chequeo se omite limpio.", "Sin migración el chequeo no se omitió.");
  }

  const schema = await readFile(new URL("../src/db/schema.sql", import.meta.url), "utf8");
  const block = /-- BEGIN source-closure\r?\n([\s\S]*?)-- END source-closure/.exec(schema)?.[1];
  check(Boolean(block), "schema.sql contiene el bloque source-closure.", "Falta el bloque source-closure.");
  await pool.query(block!);
  await pool.query(block!);
  check(true, "El bloque es idempotente (aplicado dos veces).", "");

  const inserted = await pool.query(
    `INSERT INTO jobs (url_hash, title, company, location, url, source, published_at)
     VALUES ($1, 'Business Analyst - M&A Strategy', 'Tech Talent International', 'Remoto', $2, 'Torre', NOW() - INTERVAL '20 days'),
            ($3, 'Analista Abierta', 'Empresa Abierta', 'Remoto', $4, 'Torre', NOW() - INTERVAL '10 days'),
            ($5, 'Analista Borrada', 'Empresa Borrada', 'Remoto', $6, 'Torre', NOW() - INTERVAL '5 days')
     RETURNING id, url`,
    [
      `t-${tag}-1`, `https://torre.ai/jobs/${ids.closed}`,
      `t-${tag}-2`, `https://torre.ai/jobs/${ids.open}`,
      `t-${tag}-3`, `https://torre.ai/jobs/${ids.gone}`
    ]
  );
  const idByUrl = new Map(inserted.rows.map((row) => [row.url as string, row.id as string]));
  const closedId = idByUrl.get(`https://torre.ai/jobs/${ids.closed}`)!;
  const openId = idByUrl.get(`https://torre.ai/jobs/${ids.open}`)!;
  const goneId = idByUrl.get(`https://torre.ai/jobs/${ids.gone}`)!;

  const verdicts: Record<string, TorreStatusVerdict> = {
    [ids.closed]: { kind: "closed", status: "closed", deadline: "2026-09-25T17:53:09.000Z" },
    [ids.open]: { kind: "open", deadline: null },
    [ids.gone]: { kind: "not_found" }
  };

  // Dry-run: nothing written.
  const dry = await verifyTorreClosures(undefined, { deps: depsWith(verdicts), dryRun: true, limit: 5000 });
  const afterDry = await pool.query(`SELECT COUNT(*)::int AS n FROM jobs WHERE id = ANY($1::uuid[]) AND source_checked_at IS NULL`, [
    [closedId, openId, goneId]
  ]);
  check(
    dry.closedJobIds.includes(closedId) && afterDry.rows[0].n === 3,
    "Dry-run reporta la cerrada sin escribir nada.",
    "Dry-run escribió en la base o no reportó la cerrada."
  );

  const report = await verifyTorreClosures(undefined, { deps: depsWith(verdicts), limit: 5000 });
  const remaining = await pool.query(`SELECT id, source_checked_at FROM jobs WHERE id = ANY($1::uuid[])`, [
    [closedId, openId, goneId]
  ]);
  const remainingIds = new Set(remaining.rows.map((row) => row.id));
  check(!remainingIds.has(closedId), "La vacante cerrada en Torre se elimina.", "La vacante cerrada sigue activa.");
  check(remainingIds.has(openId), "La vacante abierta se conserva.", "Se eliminó una vacante abierta.");
  check(
    report.degraded || !remainingIds.has(goneId),
    "La vacante 404 se elimina (pasada no degradada).",
    "La vacante 404 se conservó en una pasada sana."
  );
  check(
    remaining.rows.find((row) => row.id === openId)?.source_checked_at != null,
    "La abierta queda marcada como verificada (rota en la cola).",
    "La abierta no quedó marcada."
  );

  const tombstone = await pool.query(
    `SELECT status, superseded_reason FROM indexing_queue WHERE job_id = $1 AND notification_type = 'URL_DELETED'`,
    [closedId]
  );
  check(
    tombstone.rowCount === 1,
    "La eliminación deja la lápida URL_DELETED (410) igual que la purga por antigüedad.",
    "La eliminación no registró la lápida URL_DELETED."
  );

  // Rotation: the open row was just checked, so it is not picked again inside the window.
  const picked = await pickJobsForClosureCheck("Torre", 5000);
  check(!picked.some((row) => row.id === openId), "Una fila recién verificada no se vuelve a pedir.", "La fila recién verificada se volvió a pedir.");

  await pool.query(`DELETE FROM jobs WHERE id = ANY($1::uuid[])`, [[openId, goneId]]);
}

run()
  .catch((error) => {
    console.error(error);
    failures++;
  })
  .finally(async () => {
    await pool.end();
    if (failures > 0) {
      console.error(`\n${failures} verificación(es) fallaron.`);
      process.exit(1);
    }
    console.log("\nCierre por fuente: todo verde.");
  });
