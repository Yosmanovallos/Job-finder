/**
 * Read-only weekly checkpoint report (Fase A): real signups per day
 * (America/Bogota), by first-touch source and by landing page type.
 *
 *   npx tsx scripts/report-signup-attribution.ts            (last 14 days)
 *   npx tsx scripts/report-signup-attribution.ts --days 28
 *   npx tsx scripts/report-signup-attribution.ts --json
 *
 * Real signups = `auth.users` without test accounts (yopmail, example-test),
 * the same definition as docs/seo-baseline/2026-11-06-*. Runs inside
 * BEGIN READ ONLY; never prints e-mails, ids or full paths of vacancies —
 * only day, channel and page type counts. Accounts created before the
 * signup-attribution migration (or without a stored first touch) appear as
 * "sin dato".
 */
import dotenv from "dotenv";
import { classifyLandingPath, classifySource } from "../src/lib/first-touch.js";

dotenv.config();

interface Row {
  day: string;
  path: string | null;
  referrer_host: string | null;
  utm_source: string | null;
  utm_medium: string | null;
}

function parseDays(argv: string[]): number {
  const index = argv.indexOf("--days");
  const value = index >= 0 ? Number(argv[index + 1]) : 14;
  if (!Number.isInteger(value) || value < 1 || value > 120) {
    throw new Error("--days debe ser un entero entre 1 y 120.");
  }
  return value;
}

function table(title: string, counts: Map<string, Map<string, number>>, days: string[]): string {
  const columns = [...new Set([...counts.values()].flatMap((byKey) => [...byKey.keys()]))].sort(
    (a, b) =>
      [...counts.values()].reduce((sum, m) => sum + (m.get(b) ?? 0), 0) -
      [...counts.values()].reduce((sum, m) => sum + (m.get(a) ?? 0), 0)
  );
  const lines = [`\n## ${title}\n`, `| Día | Total | ${columns.join(" | ")} |`, `| --- | ---: | ${columns.map(() => "---:").join(" | ")} |`];
  const totals = new Map<string, number>();
  for (const day of days) {
    const byKey = counts.get(day) ?? new Map<string, number>();
    const total = [...byKey.values()].reduce((a, b) => a + b, 0);
    for (const column of columns) totals.set(column, (totals.get(column) ?? 0) + (byKey.get(column) ?? 0));
    lines.push(`| ${day} | ${total} | ${columns.map((column) => byKey.get(column) ?? 0).join(" | ")} |`);
  }
  const grand = [...totals.values()].reduce((a, b) => a + b, 0);
  lines.push(`| **Total** | **${grand}** | ${columns.map((column) => `**${totals.get(column) ?? 0}**`).join(" | ")} |`);
  return lines.join("\n");
}

async function main(): Promise<void> {
  const days = parseDays(process.argv);
  const asJson = process.argv.includes("--json");
  const { pool } = await import("../src/db/client.js");
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const hasColumns =
      (
        await client.query(
          `SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'first_touch_at'`
        )
      ).rowCount === 1;
    const touch = hasColumns
      ? `u.first_touch_path AS path, u.first_touch_referrer_host AS referrer_host,
         u.first_touch_utm_source AS utm_source, u.first_touch_utm_medium AS utm_medium`
      : `NULL::text AS path, NULL::text AS referrer_host, NULL::text AS utm_source, NULL::text AS utm_medium`;
    const result = await client.query<Row>(
      `SELECT to_char(a.created_at AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD') AS day, ${touch}
       FROM auth.users a
       LEFT JOIN public.users u ON u.id = a.id
       WHERE a.created_at >= (date_trunc('day', NOW() AT TIME ZONE 'America/Bogota') - make_interval(days => $1 - 1))
                             AT TIME ZONE 'America/Bogota'
         AND a.email NOT ILIKE '%yopmail%'
         AND a.email NOT ILIKE '%example-test%'`,
      [days]
    );
    await client.query("COMMIT");

    const bySource = new Map<string, Map<string, number>>();
    const byLanding = new Map<string, Map<string, number>>();
    const bump = (target: Map<string, Map<string, number>>, day: string, key: string) => {
      const inner = target.get(day) ?? new Map<string, number>();
      inner.set(key, (inner.get(key) ?? 0) + 1);
      target.set(day, inner);
    };
    for (const row of result.rows) {
      bump(
        bySource,
        row.day,
        classifySource({
          utmSource: row.utm_source,
          utmMedium: row.utm_medium,
          referrerHost: row.referrer_host,
          landingPath: row.path
        })
      );
      bump(byLanding, row.day, classifyLandingPath(row.path));
    }
    const allDays: string[] = [];
    const today = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Bogota" }));
    for (let offset = days - 1; offset >= 0; offset--) {
      const day = new Date(today);
      day.setDate(today.getDate() - offset);
      allDays.push(
        `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`
      );
    }

    if (asJson) {
      const plain = (m: Map<string, Map<string, number>>) =>
        Object.fromEntries(allDays.map((day) => [day, Object.fromEntries(m.get(day) ?? new Map())]));
      console.log(
        JSON.stringify(
          {
            measuredAt: new Date().toISOString(),
            days,
            attributionColumns: hasColumns,
            signups: result.rowCount,
            bySource: plain(bySource),
            byLandingType: plain(byLanding)
          },
          null,
          2
        )
      );
      return;
    }
    console.log(`# Registros reales por primer contacto — últimos ${days} días (America/Bogota)`);
    console.log(`Medido: ${new Date().toISOString()}. Registros: ${result.rowCount}.`);
    if (!hasColumns) {
      console.log("Aviso: la migración signup-attribution no está aplicada; todo aparece como «sin dato».");
    }
    console.log(table("Por fuente", bySource, allDays));
    console.log(table("Por tipo de página de llegada", byLanding, allDays));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[report-signup-attribution] Falló:", (error as Error)?.message || error);
  process.exit(1);
});
