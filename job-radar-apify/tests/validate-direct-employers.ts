import "./require-isolated-database.js";
import { readFile } from "node:fs/promises";
import { pool } from "../src/db/client.js";
import {
  closeConfirmedGone,
  employerReport,
  pickDueSources,
  purgeClosedDirectJobs,
  recordSourceOutcome,
  saveListing,
  upsertEmployer
} from "../src/db/direct-repository.js";
import { liveDirectJobSql } from "../src/direct/ingest.js";
import { MIN_INTERVAL_HOURS, runSource, type TickDeps } from "../src/direct/tick.js";
import type { HttpGet } from "../src/direct/types.js";

/**
 * Official employer vacancies against the disposable Postgres
 * (docs/adr/0006-direct-employers.md): real SQL for the migration block, the
 * idempotent upsert, closure only on complete evidence, the mass-drop guard,
 * the 30-day read window, the purge, the report — and `jobs` untouched.
 * No ATS is contacted (HTTP injected).
 */
let failures = 0;
function check(condition: boolean, pass: string, fail: string): void {
  if (condition) console.log(`OK  ${pass}`);
  else {
    console.error(`ERR ${fail}`);
    failures++;
  }
}

const DAY = 86_400_000;
const LEVER_URL = "https://api.lever.co/v0/postings/acme-test?mode=json";

function leverPosting(id: string, location: string, daysAgo: number | null) {
  return {
    id,
    text: `Analista ${id}`,
    hostedUrl: `https://jobs.lever.co/acme-test/${id}`,
    workplaceType: "hybrid",
    createdAt: daysAgo === null ? null : Date.now() - daysAgo * DAY,
    categories: { location, allLocations: [location] }
  };
}

let board: { status: number; body: unknown } = { status: 200, body: [] };
// Per-posting endpoint (https://api.lever.co/v0/postings/acme-test/<id>):
// 404 only for ids in `gone`, 200 otherwise.
const gone = new Set<string>();
const http: HttpGet = async (url) => {
  if (url === LEVER_URL) return { status: board.status, body: JSON.stringify(board.body) };
  const id = /^https:\/\/api\.lever\.co\/v0\/postings\/acme-test\/([^/?]+)$/.exec(url)?.[1];
  if (id) return { status: gone.has(id) ? 404 : 200, body: "{}" };
  return { status: 404, body: "" };
};
const deps: TickDeps = { http, saveListing, recordOutcome: recordSourceOutcome, closeConfirmed: closeConfirmedGone };

async function jobsFingerprint(): Promise<string> {
  const result = await pool.query(`SELECT COUNT(*)::text || ':' || COALESCE(md5(string_agg(id::text || title || COALESCE(company, ''), ',' ORDER BY id)), '') AS f FROM jobs`);
  return result.rows[0].f;
}

async function sourceRow() {
  const [source] = await pickDueSources({ limit: 10, minIntervalHours: 0, employerSlug: "acme-test" });
  return source;
}

async function openRows() {
  const result = await pool.query(
    `SELECT external_id, id, missing_count, closed_at FROM direct_jobs WHERE employer_id = (SELECT id FROM employers WHERE slug = 'acme-test') ORDER BY external_id`
  );
  return result.rows;
}

async function run(): Promise<void> {
  console.log("\n--- Empresas y vacantes oficiales (ATS directo) ---\n");

  const schema = await readFile(new URL("../src/db/schema.sql", import.meta.url), "utf8");
  const block = /-- BEGIN direct-employers\r?\n([\s\S]*?)-- END direct-employers/.exec(schema)?.[1];
  check(Boolean(block), "schema.sql contiene el bloque direct-employers.", "Falta el bloque direct-employers.");
  await pool.query(block!);
  await pool.query(block!);
  check(true, "El bloque es idempotente (aplicado dos veces).", "");

  // A scraped job-board row for the same employer, written before anything
  // else: the report must count it, and nothing below may change `jobs`.
  await pool.query(
    `INSERT INTO jobs (url_hash, title, company, location, url, source, published_at)
     VALUES (md5(random()::text), 'Analista de bolsa', 'Acme Test LA', 'Bogotá', 'https://example.com/board/1', 'LinkedIn', NOW() - INTERVAL '2 days')`
  );
  const jobsBefore = await jobsFingerprint();

  const seed = {
    slug: "acme-test",
    displayName: "Acme Test",
    websiteDomain: "acme.test",
    origin: "seed" as const,
    aliases: ["Acme Test LA", "ACME TEST S.A.S."],
    sources: [{ atsType: "lever" as const, atsRef: "acme-test", portalUrl: "https://jobs.lever.co/acme-test", enabled: true }]
  };
  const first = await upsertEmployer(seed);
  const again = await upsertEmployer(seed);
  const counts = await pool.query(
    `SELECT (SELECT COUNT(*)::int FROM employers WHERE slug = 'acme-test') AS employers,
            (SELECT COUNT(*)::int FROM employer_aliases WHERE employer_id = $1) AS aliases,
            (SELECT COUNT(*)::int FROM employer_sources WHERE employer_id = $1) AS sources`,
    [first.employerId]
  );
  check(
    again.employerId === first.employerId && counts.rows[0].employers === 1 && counts.rows[0].sources === 1,
    "Re-sembrar no duplica la empresa ni su tablero.",
    `Re-sembrar duplicó filas: ${JSON.stringify(counts.rows[0])}`
  );
  // "Acme Test" and "ACME TEST S.A.S." share one identity key (legal suffix folded).
  check(counts.rows[0].aliases === 2, "Los alias se guardan por company_key (Acme Test = ACME TEST S.A.S.).", `Alias inesperados: ${counts.rows[0].aliases}`);

  const other = await upsertEmployer({ ...seed, slug: "acme-other", displayName: "Acme Other", aliases: ["Acme Test LA"], sources: [] });
  check(other.aliasConflicts.length === 1, "Un alias de otra empresa no se reasigna en silencio.", "Un alias cambió de empresa sin aviso.");

  // 0) Cadence with real timestamps: a board read ~6 h ago by the previous
  // cron tick (stamped minutes after it started) must be due again now.
  const due = async (lastRun: string) => {
    await pool.query(`UPDATE employer_sources SET last_run_at = NOW() - $1::interval WHERE ats_ref = 'acme-test'`, [lastRun]);
    return (await pickDueSources({ limit: 10, minIntervalHours: MIN_INTERVAL_HOURS, employerSlug: "acme-test" })).length;
  };
  const dueAfterCron = await due("5 hours 50 minutes");
  const dueTooSoon = await due("1 hour");
  await pool.query(`UPDATE employer_sources SET last_run_at = NULL WHERE ats_ref = 'acme-test'`);
  check(
    dueAfterCron === 1 && dueTooSoon === 0,
    "Cadencia: un tablero leído en el tick anterior (~6 h) vuelve a tocar; uno de hace 1 h no.",
    `Cadencia incorrecta: tras ~6 h=${dueAfterCron}, tras 1 h=${dueTooSoon}`
  );

  // 1) First complete listing: 3 Colombian postings (one undated), 1 abroad.
  board = {
    status: 200,
    body: [
      leverPosting("a", "Bogotá", 3),
      leverPosting("b", "Medellín, Colombia", null),
      leverPosting("c", "Cali", 10),
      leverPosting("d", "Lima, Peru", 1)
    ]
  };
  let report = await runSource(await sourceRow(), deps);
  check(report.status === "ok" && report.saved?.inserted === 3, "Primer listado: 3 vacantes de Colombia guardadas.", `Primer listado: ${JSON.stringify(report)}`);
  const idsBefore = (await openRows()).map((row) => row.id).join(",");

  report = await runSource(await sourceRow(), deps);
  const idsAfter = (await openRows()).map((row) => row.id).join(",");
  check(
    report.saved?.inserted === 0 && report.saved?.updated === 3 && idsBefore === idsAfter,
    "Re-correr no crea filas nuevas y conserva los ids (sin churn de URLs).",
    `Re-correr cambió filas: ${JSON.stringify(report.saved)}`
  );
  const undated = await pool.query(`SELECT published_at FROM direct_jobs WHERE external_id = 'b'`);
  check(undated.rows[0].published_at === null, "Una fecha que el ATS no da queda NULL.", "Se inventó una fecha de publicación.");

  // 2) "a" disappears: one miss does not close; the second complete one does.
  board = { status: 200, body: [leverPosting("b", "Medellín, Colombia", null), leverPosting("c", "Cali", 10)] };
  await runSource(await sourceRow(), deps);
  let rows = await openRows();
  check(rows.find((row) => row.external_id === "a")?.closed_at === null, "Una sola ausencia no cierra la vacante.", "Se cerró con una sola ausencia.");

  // 3) A failed fetch in between proves nothing.
  board = { status: 500, body: "" };
  report = await runSource(await sourceRow(), deps);
  rows = await openRows();
  check(
    report.status === "error" && rows.find((row) => row.external_id === "a")?.missing_count === 1,
    "Un listado fallido no suma ausencias ni cierra.",
    `Un listado fallido tocó vacantes: ${JSON.stringify(rows)}`
  );

  board = { status: 200, body: [leverPosting("b", "Medellín, Colombia", null), leverPosting("c", "Cali", 10)] };
  report = await runSource(await sourceRow(), deps);
  rows = await openRows();
  check(
    report.saved?.closed === 1 && rows.find((row) => row.external_id === "a")?.closed_at !== null,
    "Dos listados completos sin la vacante la cierran.",
    `No se cerró tras dos ausencias: ${JSON.stringify(report.saved)}`
  );

  // 3b) A posting the ATS confirms gone (per-posting 404) closes on its
  // first miss: its apply link is already dead.
  board = { status: 200, body: [leverPosting("b", "Medellín, Colombia", null), leverPosting("c", "Cali", 10), leverPosting("e", "Bogotá", 1)] };
  await runSource(await sourceRow(), deps);
  gone.add("e");
  board = { status: 200, body: [leverPosting("b", "Medellín, Colombia", null), leverPosting("c", "Cali", 10)] };
  report = await runSource(await sourceRow(), deps);
  rows = await openRows();
  check(
    report.saved?.closed === 1 && rows.find((row) => row.external_id === "e")?.closed_at !== null,
    "Una vacante que el ATS confirma borrada (404) se cierra en la primera ausencia.",
    `No se cerró la vacante confirmada: ${JSON.stringify(report.saved)}`
  );

  // 4) Mass-drop guard: the board had 20 postings, now lists 1 → nothing closes.
  await pool.query(`UPDATE employer_sources SET last_board_total = 20 WHERE ats_ref = 'acme-test'`);
  board = { status: 200, body: [leverPosting("c", "Cali", 10)] };
  report = await runSource(await sourceRow(), deps);
  rows = await openRows();
  const source = await pool.query(`SELECT status, last_board_total FROM employer_sources WHERE ats_ref = 'acme-test'`);
  check(
    report.status === "suspect" && rows.find((row) => row.external_id === "b")?.missing_count === 0 && source.rows[0].last_board_total === 20,
    "Una caída masiva del tablero queda 'suspect' y no cierra nada.",
    `La guardia de caída masiva falló: ${JSON.stringify({ report, rows, source: source.rows[0] })}`
  );

  // 4b) The board keeps its size but its Colombian subset collapses (a
  // location-format change): same guard on the subset.
  await pool.query(
    `UPDATE employer_sources SET last_board_total = NULL, last_colombia_total = 20, consecutive_suspect = 0 WHERE ats_ref = 'acme-test'`
  );
  const abroad = Array.from({ length: 19 }, (_, index) => leverPosting(`x${index}`, "Remote, CO", 2));
  board = { status: 200, body: [leverPosting("c", "Cali", 10), ...abroad] };
  report = await runSource(await sourceRow(), deps);
  check(
    report.status === "suspect" && /Colombia/.test(report.detail ?? "") && report.saved?.markedMissing === 0,
    "Si solo cae el subconjunto de Colombia (cambio de formato), tampoco se cierra nada.",
    `La guardia del subconjunto Colombia falló: ${JSON.stringify(report)}`
  );

  // 4c) The same drop three listings in a row is real: accepted, closures run.
  await runSource(await sourceRow(), deps);
  report = await runSource(await sourceRow(), deps);
  const accepted = await pool.query(`SELECT status, last_colombia_total, consecutive_suspect FROM employer_sources WHERE ats_ref = 'acme-test'`);
  check(
    report.status === "ok" && report.saved?.markedMissing === 1 && accepted.rows[0].last_colombia_total === 1 && accepted.rows[0].consecutive_suspect === 0,
    "Tras 3 listados sospechosos seguidos la caída se acepta como real (la guardia no congela el tablero).",
    `La caída no se aceptó: ${JSON.stringify({ report, source: accepted.rows[0] })}`
  );

  // 5) Read window: undated postings age by first sighting; closed ones never show.
  await pool.query(`UPDATE direct_jobs SET first_seen_at = NOW() - INTERVAL '40 days' WHERE external_id = 'b'`);
  const live = await pool.query(`SELECT external_id FROM direct_jobs WHERE ${liveDirectJobSql()} AND employer_id = $1 ORDER BY external_id`, [first.employerId]);
  check(
    live.rows.map((row) => row.external_id).join(",") === "c",
    "Ventana de 30 días en lectura: sin fecha cuenta desde que se vio; las cerradas no se muestran.",
    `Ventana incorrecta: ${live.rows.map((row) => row.external_id).join(",")}`
  );

  // 6) Purge: only rows closed more than a day ago; listed rows stay even when out of the window.
  await pool.query(`UPDATE direct_jobs SET closed_at = NOW() - INTERVAL '2 days' WHERE external_id = 'a'`);
  const purged = await purgeClosedDirectJobs();
  const remaining = await pool.query(`SELECT external_id FROM direct_jobs WHERE employer_id = $1 ORDER BY external_id`, [first.employerId]);
  check(
    // "e" closed minutes ago: kept a day for audit, then purged.
    purged === 1 && remaining.rows.map((row) => row.external_id).join(",") === "b,c,e",
    "La purga borra solo cerradas; una vacante aún listada no se borra (no resucita con fecha nueva).",
    `Purga inesperada: ${purged} · quedan ${remaining.rows.map((row) => row.external_id).join(",")}`
  );

  // 7) Report joins the scraped boards through the aliases.
  const row = (await employerReport()).find((entry) => entry.slug === "acme-test");
  check(row?.officialLive === 1 && row?.boardsLive === 1, "El reporte cruza oficiales y bolsas por alias.", `Reporte: ${JSON.stringify(row)}`);

  check((await jobsFingerprint()) === jobsBefore, "La tabla jobs quedó intacta.", "Se modificó la tabla jobs.");

  await pool.query(`DELETE FROM employers WHERE slug IN ('acme-test', 'acme-other')`);
  await pool.query(`DELETE FROM jobs WHERE company = 'Acme Test LA'`);
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
    console.log("\nEmpresas y vacantes oficiales: todo verde.");
  });
